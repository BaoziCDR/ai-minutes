const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomic } = require("../store.cjs");
const { safeFile, inspect, clip, ranges, hashFile } = require("./audio.cjs");
const { publicSource } = require("./runtime.cjs");
class SpeechTasks {
  constructor(store, registry, runtime, publish) {
    this.store = store;
    this.registry = registry;
    this.runtime = runtime;
    this.publish = publish;
    this.running = new Map();
    this.recover();
  }
  recover() {
    for (const m of this.store.list()) {
      const task = this.read(m.id);
      if (
        task &&
        !["completed", "cancelled", "failed", "interrupted"].includes(
          task.state,
        )
      ) {
        task.state = "interrupted";
        task.error = "上次转写被中断，可恢复已提交任务的查询。";
        atomic(this.file(m), task);
        m.status = "completed";
        m.speechTask = {
          id: task.id,
          state: task.state,
          error: task.error,
          completed: task.chunks.filter((c) => c.state === "completed").length,
          total: task.chunks.length,
          source: task.source,
        };
        this.store.save(m);
      }
    }
  }
  activeBindings() {
    return this.store
      .list()
      .map((m) => this.read(m.id))
      .filter((t) => t && !["completed", "cancelled"].includes(t.state))
      .map((t) => t.binding);
  }
  file(m) {
    return path.join(this.store.dir(m.id), "speech-task.json");
  }
  read(id) {
    const m = this.store.get(id);
    try {
      return JSON.parse(fs.readFileSync(this.file(m), "utf8"));
    } catch {
      return null;
    }
  }
  async start(id, binding, { resume = false, resolved: provided } = {}) {
    if (this.running.has(id)) throw Error("这场会议正在转写。");
    const m = this.store.get(id);
    const file = safeFile(this.store.dir(id), "recording.wav");
    const audio = inspect(file);
    let task, resolved;
    if (resume) {
      task = this.read(id);
      if (!task || ["completed", "cancelled"].includes(task.state))
        throw Error("没有可恢复的转写任务。");
      resolved = this.registry.loadTask(task.id);
      if (!resolved) throw Error("任务配置已失效，请重新发起。");
      binding = task.binding;
    } else {
      resolved = provided || this.registry.resolve(binding);
      if (resolved.profile.kind === "openai-audio")
        throw Error("音频理解模型仅用于复核。");
      task = {
        id: crypto.randomUUID(),
        meetingId: id,
        binding,
        source: publicSource(resolved),
        createdAt: new Date().toISOString(),
        state: "preparing",
        chunks: ranges(audio.durationMs).map((range, index) => ({
          ...range,
          index,
          state: "pending",
          segments: [],
        })),
        inputFingerprint: JSON.stringify([
          m.segments,
          m.speakers,
          m.annotations,
        ]),
        audioHash: null,
      };
      this.registry.saveTask(task.id, resolved);
    }
    const controller = new AbortController();
    const job = { binding, cancel: () => controller.abort(), promise: null };
    this.running.set(id, job);
    const persist = () => {
      atomic(this.file(m), task);
      m.speechTask = {
        id: task.id,
        state: task.state,
        completed: task.chunks.filter((c) => c.state === "completed").length,
        total: task.chunks.length,
        error: task.error || "",
        source: task.source,
      };
      this.store.save(m);
      this.publish(m);
    };
    m.status = "transcribing";
    task.state = "preparing";
    persist();
    job.promise = (async () => {
      try {
        const hash = await hashFile(file, controller.signal);
        if (task.audioHash && task.audioHash !== hash)
          throw Error("录音已变更，不能恢复旧任务。");
        task.audioHash = hash;
        persist();
        for (const c of task.chunks) {
          controller.signal.throwIfAborted();
          if (c.state === "completed") continue;
          if (resume && !c.remote?.taskId)
            throw Error(
              "恢复仅查询已提交任务；未提交或提交结果不确定的片段需重新发起。",
            );
          c.segments = [];
          for await (const e of this.runtime.run(
            {
              resolved,
              audio: c.remote?.taskId
                ? undefined
                : clip(file, c.startMs, c.endMs),
              startMs: c.startMs,
              endMs: c.endMs,
              remote: c.remote,
              purpose: "transcribe",
              scope: task.id + "-" + c.index,
            },
            controller.signal,
          )) {
            if (e.type === "checkpoint") c.remote = e.remote;
            if (e.type === "segments")
              for (const s of e.segments) {
                const old = c.segments.findIndex((x) => x.id === s.id);
                if (old >= 0) c.segments[old] = s;
                else c.segments.push(s);
              }
            if (e.type === "status")
              task.state = c.state = [
                "preparing",
                "uploading",
                "queued",
                "processing",
              ].includes(e.state)
                ? e.state
                : e.state === "connecting"
                  ? "preparing"
                  : "processing";
            if (e.type === "completed") c.state = "completed";
            persist();
          }
        }
        const output = task.chunks.flatMap((c) => c.segments);
        const unchanged =
          task.inputFingerprint ===
          JSON.stringify([m.segments, m.speakers, m.annotations]);
        // Keep a full version for audit and never overwrite edited source material.
        const dir = path.join(this.store.dir(id), "transcript-versions");
        fs.mkdirSync(dir, { recursive: true });
        atomic(path.join(dir, task.id + ".json"), {
          source: task.source,
          previous: {
            segments: m.segments,
            speakers: m.speakers,
            annotations: m.annotations,
          },
          segments: output,
        });
        const edited =
          m.transcriptEdited ||
          m.segments.some((s) => s.edited || s.speakerEdited);
        if (
          (!m.segments.length && !edited && unchanged) ||
          (unchanged &&
            !edited &&
            !m.annotations.length &&
            !Object.values(m.speakers).some(Boolean))
        ) {
          m.segments = output;
          m.transcriptionSource = task.source;
          m.speakers = {};
          m.gaps = [];
          m.summaryStale = !!m.summary;
        } else
          m.pendingTranscript = {
            taskId: task.id,
            segments: output,
            source: task.source,
          };
        task.state = "completed";
        this.registry.deleteTask(task.id);
      } catch (e) {
        task.state = controller.signal.aborted ? "cancelled" : "failed";
        if (controller.signal.aborted) this.registry.deleteTask(task.id);
        task.error = controller.signal.aborted
          ? "已停止本地处理；已提交的远端任务可能继续运行。"
          : e.message;
      } finally {
        m.status = "completed";
        persist();
        this.running.delete(id);
      }
    })();
    return m;
  }
  cancel(id) {
    const running = this.running.get(id);
    if (running) running.cancel();
    else {
      const task = this.read(id),
        m = this.store.get(id);
      if (task && task.state !== "completed") {
        task.state = "cancelled";
        task.error = "已停止本地处理；远端任务可能继续运行。";
        atomic(this.file(m), task);
        this.registry.deleteTask(task.id);
        if (m.speechTask) {
          m.speechTask.state = task.state;
          m.speechTask.error = task.error;
        }
        this.store.save(m);
        this.publish(m);
      }
    }
    return true;
  }
}
module.exports = { SpeechTasks };
