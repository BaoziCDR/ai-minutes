const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { wavHeader } = require("../store.cjs");
function safeFile(root, file) {
  if (fs.lstatSync(root).isSymbolicLink())
    throw Error("会议目录不能使用符号链接。");
  const realRoot = fs.realpathSync(root);
  const full = path.resolve(root, file);
  if (
    fs.lstatSync(full).isSymbolicLink() ||
    !fs.realpathSync(full).startsWith(realRoot + path.sep)
  )
    throw Error("录音路径超出当前会议。");
  return full;
}
function inspect(file) {
  const fd = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    if (
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    )
      throw Error("录音不是 WAV 格式。");
    let pos = 12,
      format,
      data;
    const size = fs.fstatSync(fd).size;
    while (pos + 8 <= size) {
      const h = Buffer.alloc(8);
      fs.readSync(fd, h, 0, 8, pos);
      const n = h.readUInt32LE(4);
      const id = h.toString("ascii", 0, 4);
      if (id === "fmt ") {
        const b = Buffer.alloc(Math.min(n, 16));
        fs.readSync(fd, b, 0, b.length, pos + 8);
        format = b;
      }
      if (id === "data") {
        data = { offset: pos + 8, bytes: Math.min(n, size - pos - 8) };
        break;
      }
      pos += 8 + n + (n % 2);
    }
    if (
      !format ||
      !data ||
      format.length < 16 ||
      format.readUInt16LE(0) !== 1 ||
      format.readUInt16LE(2) !== 1 ||
      format.readUInt32LE(4) !== 16000 ||
      format.readUInt16LE(14) !== 16
    )
      throw Error("需要 16 kHz 单声道 PCM WAV。");
    return { ...data, durationMs: data.bytes / 32 };
  } finally {
    fs.closeSync(fd);
  }
}
function clip(file, startMs, endMs) {
  const info = inspect(file);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > info.durationMs + 1 ||
    endMs - startMs > 60001
  )
    throw Error("音频片段范围无效。");
  const from = Math.floor(startMs * 16) * 2;
  const bytes = Math.min(
    info.bytes - from,
    Math.floor((endMs - startMs) * 16) * 2,
  );
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(bytes);
    const got = fs.readSync(fd, b, 0, bytes, info.offset + from);
    if (got !== bytes) throw Error("录音文件发生变化。");
    return Buffer.concat([wavHeader(bytes), b]);
  } finally {
    fs.closeSync(fd);
  }
}
async function hashFile(file, signal) {
  const hash = crypto.createHash("sha256");
  for await (const b of fs.createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(b);
  }
  return hash.digest("hex");
}
function ranges(durationMs) {
  const out = [];
  for (let startMs = 0; startMs < durationMs; startMs += 60000)
    out.push({ startMs, endMs: Math.min(durationMs, startMs + 60000) });
  return out;
}
module.exports = { safeFile, inspect, clip, hashFile, ranges };
