const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomic } = require("../store.cjs");
const kinds = [
  "tencent-realtime",
  "tencent-file",
  "openai-transcription",
  "openai-audio",
];
const secrets = ["secretId", "secretKey", "apiKey"];
const clone = (value) => structuredClone(value);
function endpoint(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash)
    throw Error("接口地址不能包含账号、密钥或查询参数。");
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw Error(
      "云端接口请使用 HTTPS，本地接口可使用 localhost 或 127.0.0.1。",
    );
  return u.href.replace(/\/$/, "");
}
function capabilities(profile) {
  const realtime = profile.kind === "tencent-realtime";
  const tencent = profile.kind.startsWith("tencent-");
  const known = realtime
    ? profile.model === "16k_zh_en_speaker_2.0"
    : ["16k_zh_en_2.0", "16k_zh_en_meeting"].includes(profile.model);
  return {
    inputs: realtime ? ["stream", "file"] : ["file"],
    execution: realtime
      ? "realtime"
      : profile.kind === "tencent-file"
        ? "async-job"
        : "request",
    partial: realtime ? "supported" : "unsupported",
    transcript: "supported",
    diarization: tencent && known ? "supported" : "unknown",
    timestamps: tencent && known ? "segment" : "unknown",
    audioUnderstanding:
      profile.kind === "openai-audio" ? "supported" : "unsupported",
    speakerContinuity: realtime && known ? "supported" : "unsupported",
    remoteCancel: "unsupported",
    reconnect: realtime ? "supported" : "unsupported",
    resumeQuery: profile.kind === "tencent-file" ? "supported" : "unsupported",
    formats: ["wav"],
    sampleRate: 16000,
    maxSegmentSeconds: 60,
    maxBytes: 2000000,
    concurrency: 1,
    source: tencent ? "adapter-catalog" : "protocol;model-unverified",
    verifiedAt: profile.test?.at || null,
  };
}
class SpeechRegistry {
  constructor(file, secure, legacy, active = () => []) {
    this.file = file;
    this.secure = secure;
    this.active = active;
    if (fs.existsSync(file)) {
      this.state = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const c of this.state.connections)
        for (const key of secrets)
          c[key] = c[key]
            ? secure.decryptString(Buffer.from(c[key], "base64"))
            : "";
    } else {
      const c = {
        id: "legacy-tencent",
        name: "腾讯云",
        type: "tencent",
        baseUrl: "https://asr.tencentcloudapi.com",
        appId: legacy.appId || "",
        secretId: legacy.secretId || "",
        secretKey: legacy.secretKey || "",
        apiKey: "",
        enabled: true,
        revision: 1,
      };
      const p = {
        id: "legacy-realtime",
        connectionId: c.id,
        kind: "tencent-realtime",
        model: "16k_zh_en_speaker_2.0",
        name: "实时分人转写",
        hotwords: legacy.hotwords || "",
        enabled: true,
        revision: 1,
      };
      this.state = {
        version: 1,
        connections: [c],
        profiles: [p],
        bindings: {
          meeting: { connectionId: c.id, profileId: p.id, mode: "realtime" },
          review: null,
        },
        reviewBudgetSeconds: 300,
      };
      this.persist();
    }
  }
  persist() {
    const output = clone(this.state);
    for (const c of output.connections)
      for (const key of secrets) {
        if (c[key] && !this.secure.isEncryptionAvailable())
          throw Error("本机加密存储不可用，未保存密钥。");
        c[key] = c[key]
          ? this.secure.encryptString(c[key]).toString("base64")
          : "";
      }
    atomic(this.file, output);
  }
  public() {
    const data = clone(this.state);
    delete data.snapshots;
    for (const c of data.connections)
      for (const key of secrets) {
        c[key + "Configured"] = !!c[key];
        delete c[key];
      }
    for (const p of data.profiles) p.capabilities = capabilities(p);
    return data;
  }
  resolve(binding, requireReady = true) {
    if (!binding) throw Error("尚未选择语音模型。");
    const c = this.state.connections.find((c) => c.id === binding.connectionId);
    const p = this.state.profiles.find(
      (p) => p.id === binding.profileId && p.connectionId === c?.id,
    );
    if (!c || !p || (requireReady && (!c.enabled || !p.enabled)))
      throw Error("所选语音供应商或模型不可用。");
    if (requireReady) {
      if (!p.model.trim()) throw Error("请填写语音模型。");
      if (
        c.type === "tencent" &&
        (!c.secretId ||
          !c.secretKey ||
          (p.kind === "tencent-realtime" && !c.appId))
      )
        throw Error("请在语音供应商中配置腾讯账号。");
      if (c.type === "compatible" && !c.baseUrl)
        throw Error("请填写语音接口地址。");
    }
    const bindingKey = [c.id, p.kind, p.model].join(":");
    return clone({
      connection: c,
      profile: p,
      capabilities: capabilities(p),
      bindingKey,
      revision: `${c.revision}:${p.revision}`,
    });
  }
  validateBindings() {
    const { meeting, review } = this.state.bindings;
    if (meeting) {
      const r = this.resolve(meeting, false);
      if (meeting.mode === "realtime" && r.profile.kind !== "tencent-realtime")
        throw Error("该模型不支持实时字幕，请选择会后转写。");
      if (r.profile.kind === "openai-audio")
        throw Error("音频理解模型仅用于录音复核。");
    }
    if (review) {
      const r = this.resolve(review, false);
      if (meeting && this.resolve(meeting, false).bindingKey === r.bindingKey)
        throw Error("录音复核需要与会议转写不同的模型。");
    }
  }
  mutate(action) {
    const previous = clone(this.state);
    try {
      const active = this.active();
      if (action.op === "connection") {
        let c = this.state.connections.find((c) => c.id === action.id);
        if (!c) {
          c = {
            id: crypto.randomUUID(),
            name: "新供应商",
            type: action.patch.type === "tencent" ? "tencent" : "compatible",
            baseUrl:
              action.patch.type === "tencent"
                ? "https://asr.tencentcloudapi.com"
                : "https://api.openai.com/v1",
            appId: "",
            enabled: true,
            revision: 0,
          };
          this.state.connections.push(c);
        }
        const patch = action.patch || {};
        for (const k of ["name", "baseUrl", "appId", ...secrets, "enabled"])
          if (k in patch)
            c[k] = k === "enabled" ? !!patch[k] : String(patch[k]);
        if (!c.name.trim()) throw Error("供应商名称不能为空。");
        c.baseUrl = endpoint(c.baseUrl);
        c.revision++;
        for (const p of this.state.profiles.filter(
          (p) => p.connectionId === c.id,
        ))
          delete p.test;
      } else if (action.op === "profile") {
        let p = this.state.profiles.find((p) => p.id === action.id);
        const c = this.state.connections.find(
          (c) => c.id === (p?.connectionId || action.connectionId),
        );
        if (!c) throw Error("未找到供应商。");
        if (!p) {
          p = {
            id: crypto.randomUUID(),
            connectionId: c.id,
            name: "新模型",
            kind:
              c.type === "tencent" ? "tencent-file" : "openai-transcription",
            model: c.type === "tencent" ? "16k_zh_en_2.0" : "",
            hotwords: "",
            enabled: true,
            revision: 0,
          };
          this.state.profiles.push(p);
        }
        for (const k of ["name", "kind", "model", "hotwords", "enabled"])
          if (k in action.patch)
            p[k] =
              k === "enabled" ? !!action.patch[k] : String(action.patch[k]);
        if (
          !kinds.includes(p.kind) ||
          (c.type === "tencent") !== p.kind.startsWith("tencent-")
        )
          throw Error("接口类型与供应商不匹配。");
        p.revision++;
        delete p.test;
      } else if (action.op === "binding") {
        if (!["meeting", "review"].includes(action.role))
          throw Error("未知用途。");
        this.state.bindings[action.role] = action.binding
          ? {
              connectionId: String(action.binding.connectionId),
              profileId: String(action.binding.profileId),
              mode: action.binding.mode === "after" ? "after" : "realtime",
            }
          : null;
      } else if (action.op === "budget") {
        const n = Number(action.seconds);
        if (!Number.isInteger(n) || n < 60 || n > 7200)
          throw Error("复核上限应为 1～120 分钟。");
        this.state.reviewBudgetSeconds = n;
      } else if (action.op === "delete") {
        const ids =
          action.entity === "connection"
            ? this.state.profiles
                .filter((p) => p.connectionId === action.id)
                .map((p) => p.id)
            : [action.id];
        if (
          Object.values(this.state.bindings).some(
            (b) =>
              b && (b.connectionId === action.id || ids.includes(b.profileId)),
          )
        )
          throw Error("该配置仍被引用，请先更换功能中的选择。");
        if (
          active.some(
            (b) => b.connectionId === action.id || ids.includes(b.profileId),
          )
        )
          throw Error("运行中的任务仍在使用该配置。");
        this.state.profiles = this.state.profiles.filter(
          (p) => !ids.includes(p.id),
        );
        if (action.entity === "connection")
          this.state.connections = this.state.connections.filter(
            (c) => c.id !== action.id,
          );
      } else throw Error("未知配置操作。");
      this.validateBindings();
      this.persist();
      return this.public();
    } catch (e) {
      this.state = previous;
      throw e;
    }
  }
  saveTask(id, resolved) {
    if (!this.secure.isEncryptionAvailable()) throw Error("任务配置加密失败。");
    this.state.snapshots ||= {};
    this.state.snapshots[id] = this.secure
      .encryptString(JSON.stringify(resolved))
      .toString("base64");
    this.persist();
  }
  loadTask(id) {
    const value = this.state.snapshots?.[id];
    return value
      ? JSON.parse(this.secure.decryptString(Buffer.from(value, "base64")))
      : null;
  }
  deleteTask(id) {
    if (this.state.snapshots) {
      delete this.state.snapshots[id];
      this.persist();
    }
  }
  recordTest(binding, revision, result) {
    const p = this.state.profiles.find((p) => p.id === binding.profileId);
    if (p && this.resolve(binding, false).revision === revision) {
      p.test = { at: new Date().toISOString(), ...result };
      this.persist();
    }
    return this.public();
  }
}
module.exports = { SpeechRegistry, capabilities, endpoint };
