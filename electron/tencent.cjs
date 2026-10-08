const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const WebSocket = require("ws");
function signedURL(c, voiceId, contextId) {
  const now = Math.floor(Date.now() / 1000);
  const p = {
    engine_model_type: c.model || "16k_zh_en_speaker_2.0",
    expired: now + 86400,
    nonce: crypto.randomInt(1, 2147483647),
    secretid: c.secretId,
    timestamp: now,
    voice_id: voiceId,
    voice_format: 1,
    needvad: 1,
    filter_modal: 0,
    filter_dirty: 0,
    convert_num_mode: 1,
    enable_speaker_context: 1,
  };
  if (contextId) p.speaker_context_id = contextId;
  if (c.hotwords?.trim())
    p.hotword_list = c.hotwords
      .trim()
      .split(/[，,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.includes("|") ? s : `${s}|5`))
      .join(",");
  const query = Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join("&");
  const base = `asr.cloud.tencent.com/asr/v2/${c.appId}?${query}`;
  const sig = crypto
    .createHmac("sha1", c.secretKey)
    .update(base)
    .digest("base64");
  return `wss://asr.cloud.tencent.com/asr/v2/${c.appId}?${new URLSearchParams(p)}&signature=${encodeURIComponent(sig)}`;
}
async function getAppId(c) {
  const service = "cam",
    host = "cam.tencentcloudapi.com",
    action = "GetUserAppId",
    timestamp = Math.floor(Date.now() / 1000),
    date = new Date(timestamp * 1000).toISOString().slice(0, 10),
    body = "{}";
  const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${hash(body)}`;
  const scope = `${date}/${service}/tc3_request`,
    stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const signing = hmac(
    hmac(hmac("TC3" + c.secretKey, date), service),
    "tc3_request",
  );
  const signature = crypto
    .createHmac("sha256", signing)
    .update(stringToSign)
    .digest("hex");
  const r = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": action,
      "X-TC-Version": "2019-01-16",
      "X-TC-Timestamp": String(timestamp),
      Authorization: `TC3-HMAC-SHA256 Credential=${c.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = (await r.json()).Response;
  if (data.Error) throw new Error(`${data.Error.Code}: ${data.Error.Message}`);
  return String(data.AppId);
}
class TencentStream extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ready = false;
    this.done = false;
    this.retry = 0;
    this.contextId = "";
    this.offsetMs = 0;
    this.sentBytes = 0;
    this.generation = 0;
  }
  connect(offsetMs = 0) {
    if (this.done) return;
    this.offsetMs = offsetMs;
    this.sentBytes = 0;
    this.generation++;
    this.ready = false;
    const generation = this.generation;
    const ws = (this.ws = new WebSocket(
      signedURL(this.config, crypto.randomUUID(), this.contextId),
      { handshakeTimeout: 12000 },
    ));
    this.emit("status", {
      state: "connecting",
      message: this.retry
        ? "正在恢复转写连接，录音仍在保存"
        : "正在连接腾讯语音识别",
    });
    const timeout = setTimeout(() => ws.terminate(), 15000);
    ws.on("message", (raw) => {
      let d;
      try {
        d = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (d.code) {
        this.emit("issue", new Error(`腾讯语音 ${d.code}：${d.message}`));
        this.fatal = true;
        ws.close();
        return;
      }
      if (d.speaker_context_id) this.contextId = d.speaker_context_id;
      if (!this.ready) {
        clearTimeout(timeout);
        this.ready = true;
        this.retry = 0;
        this.emit("status", { state: "connected", message: "实时转写已连接" });
        this.emit("ready");
      }
      const list =
        d.sentences?.sentence_list ||
        (Array.isArray(d.sentences) ? d.sentences : []);
      if (list.length)
        this.emit(
          "segments",
          list.map((s) => ({
            id: `${generation}-${s.sentence_id}`,
            text: s.sentence || "",
            speaker: String(s.speaker_id ?? -1),
            startMs: this.offsetMs + Number(s.start_time || 0),
            endMs: this.offsetMs + Number(s.end_time || 0),
            final: s.sentence_type === 1,
          })),
        );
      if (d.final) {
        this.emit("finished");
        ws.close();
      }
    });
    ws.on("error", () =>
      this.emit("status", {
        state: "reconnecting",
        message: "转写连接暂时不可用，本地录音继续保存",
      }),
    );
    ws.on("close", () => {
      clearTimeout(timeout);
      this.ready = false;
      if (!this.done && !this.fatal) {
        this.emit("disconnected");
      }
    });
  }
  send(buf) {
    if (this.ready && this.ws?.readyState === 1) {
      if (this.ws.bufferedAmount > 320000) {
        this.ws.terminate();
        return false;
      }
      this.ws.send(buf);
      this.sentBytes += buf.length;
      return true;
    }
    return false;
  }
  finish() {
    this.done = true;
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: "end" }));
      setTimeout(() => this.ws?.close(), 3500).unref();
    } else this.ws?.terminate();
  }
  close() {
    this.done = true;
    this.ws?.terminate();
  }
}
module.exports = { signedURL, getAppId, TencentStream };
