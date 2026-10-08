const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function atomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function wavHeader(bytes, sampleRate = 16000) {
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(36 + bytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
function safeName(s) {
  return (
    String(s)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .trim()
      .slice(0, 90) || "未命名会议"
  );
}
function clock(ms) {
  const n = Math.floor(ms / 1000);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.cache = new Map();
    this.timers = new Map();
    this.recover();
  }
  dir(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw Error("无效会议 ID");
    return path.join(this.root, id);
  }
  get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const m = JSON.parse(
      fs.readFileSync(path.join(this.dir(id), "meeting.json"), "utf8"),
    );
    this.cache.set(id, m);
    return m;
  }
  list() {
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        try {
          return this.get(e.name);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  create(title) {
    const m = {
      id: crypto.randomUUID(),
      title: title.trim() || "未命名会议",
      createdAt: new Date().toISOString(),
      status: "ready",
      durationMs: 0,
      segments: [],
      annotations: [],
      speakers: {},
      peaks: [],
      gaps: [],
      favorite: false,
      summary: null,
    };
    this.save(m);
    return m;
  }
  save(m, debounce = false) {
    this.cache.set(m.id, m);
    const write = () => {
      const savedAt = new Date().toISOString();
      atomic(path.join(this.dir(m.id), "meeting.json"), { ...m, savedAt });
      m.savedAt = savedAt;
    };
    if (this.timers.has(m.id)) clearTimeout(this.timers.get(m.id));
    if (debounce) {
      this.timers.set(
        m.id,
        setTimeout(() => {
          this.timers.delete(m.id);
          write();
        }, 400),
      );
    } else {
      this.timers.delete(m.id);
      write();
    }
    return m;
  }
  recover() {
    for (const ent of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      try {
        const file = path.join(this.root, ent.name, "meeting.json");
        const m = JSON.parse(fs.readFileSync(file, "utf8"));
        if (["recording", "paused", "transcribing"].includes(m.status)) {
          m.status = "interrupted";
          m.lastError = "上次录制意外结束，已恢复保存的录音和文字。";
          const w = path.join(this.root, ent.name, "recording.wav");
          if (fs.existsSync(w)) {
            const bytes = Math.max(0, fs.statSync(w).size - 44);
            const fd = fs.openSync(w, "r+");
            fs.writeSync(fd, wavHeader(bytes), 0, 44, 0);
            fs.closeSync(fd);
            m.durationMs = bytes / 32;
          }
          atomic(file, m);
        }
        if (m.summaryStatus === "running") {
          m.summaryStatus = "failed";
          m.summaryError = "上次整理被中断，可以重新生成。";
          atomic(file, m);
        }
      } catch {}
    }
  }
  remove(id) {
    clearTimeout(this.timers.get(id));
    this.cache.delete(id);
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }
  flush() {
    for (const m of this.cache.values()) this.save(m);
  }
}
function transcript(m) {
  return m.segments
    .map(
      (s) =>
        `### ${clock(s.startMs)} · ${m.speakers[s.speaker] || (s.speaker === "-1" ? "未区分说话人" : `说话人 ${String.fromCharCode(65 + (Number(s.speaker.split(":").at(-1)) || 0))}`)}\n\n${s.text}`,
    )
    .join("\n\n");
}
const annotationTypes = {
  highlight: "重点",
  action: "待办",
  decision: "决策",
  question: "疑问",
};
function notes(m) {
  return m.annotations
    .map(
      (a) =>
        `> [!${{ highlight: "important", action: "todo", decision: "success", question: "question" }[a.type] || "important"}] ${annotationTypes[a.type] || "重点"} · ${clock(a.startMs)}\n> ${a.quote.replace(/\n/g, "\n> ")}\n${a.note ? "\n备注：" + a.note + "\n" : ""}`,
    )
    .join("\n");
}
module.exports = {
  Store,
  atomic,
  wavHeader,
  safeName,
  clock,
  transcript,
  notes,
};
