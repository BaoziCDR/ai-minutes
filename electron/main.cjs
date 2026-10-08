const transcriptEdit = require("./transcript-edit.cjs");
const { SpeechRegistry } = require("./speech/registry.cjs");
const { SpeechRuntime, Queue } = require("./speech/runtime.cjs");
const { SpeechTasks } = require("./speech/tasks.cjs");
const { reviewSummary, reviewMarkdown } = require("./review.cjs");
let speechRegistry, speechRuntime, speechTasks;
const { findCodex, listModels } = require("./codex-models.cjs");
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  protocol,
  systemPreferences,
  Menu,
  powerSaveBlocker,
  globalShortcut,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const {
  Store,
  atomic,
  wavHeader,
  safeName,
  clock,
  transcript,
  notes,
} = require("./store.cjs");
const { getAppId } = require("./tencent.cjs");
const { generate, mermaid, summaryMarkdown } = require("./summary.cjs");
const { validateRoot, copyMeetings } = require("./storage.cjs");
const { syncMeeting, syncIndex } = require("./obsidian.cjs");
const shortcutsModule = require("./shortcuts.cjs");
app.setName("AI 纪要");
if (process.env.AI_MINUTES_DATA_DIR)
  app.setPath("userData", process.env.AI_MINUTES_DATA_DIR);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let win,
  store,
  settings,
  recording = null,
  saveTimer,
  powerId;
const jobs = new Map(),
  syncTimers = new Map();
let migrating = false;
const defaults = {
  dataRoot: path.join(os.homedir(), ".ai-minutes"),
  shortcuts: shortcutsModule.defaults,
  appId: "",
  hotwords: "",
  micId: "",
  vaultPath: path.join(os.homedir(), "basic-memory"),
  vaultFolder: "会议记录",
  codexPath: findCodex(),
  codexModel: "",
  codexReasoningEffort: "medium",
  ffmpegPath: "/opt/homebrew/bin/ffmpeg",
  summaryProvider: "codex",
  apiBase: "https://api.openai.com/v1",
  apiModel: "",
  theme: "light",
  autoExport: true,
};
const secretFields = ["secretId", "secretKey", "apiKey"];
function configPath() {
  return path.join(app.getPath("userData"), "settings.json");
}
function loadSettings() {
  let c = {};
  let legacy = false;
  const previous = path.join(app.getPath("appData"), "声页");
  try {
    c = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    if (
      !process.env.AI_MINUTES_DATA_DIR &&
      fs.existsSync(path.join(previous, "settings.json"))
    ) {
      c = JSON.parse(
        fs.readFileSync(path.join(previous, "settings.json"), "utf8"),
      );
      legacy = true;
    }
  }
  settings = {
    ...defaults,
    ...c,
    shortcuts: { ...shortcutsModule.defaults, ...c.shortcuts },
    autoExport: true,
  };
  if (
    settings.codexPath === "/opt/homebrew/bin/codex" &&
    !fs.existsSync(settings.codexPath)
  )
    settings.codexPath = findCodex();
  settings.dataRoot =
    c.dataRoot ||
    (process.env.AI_MINUTES_DATA_DIR
      ? path.join(process.env.AI_MINUTES_DATA_DIR, "data")
      : defaults.dataRoot);
  for (const k of secretFields) {
    try {
      settings[k] = c[k]
        ? safeStorage.decryptString(Buffer.from(c[k], "base64"))
        : "";
    } catch {
      settings[k] = "";
    }
  }
  fs.mkdirSync(settings.dataRoot, { recursive: true });
  if (legacy && fs.existsSync(path.join(previous, "meetings")))
    copyMeetings(
      path.join(previous, "meetings"),
      path.join(settings.dataRoot, "meetings"),
    );
  persistSettings();
}
let shortcutCapture = false;
function registerShortcuts(values = settings.shortcuts) {
  try {
    shortcutsModule.install(globalShortcut, values, (action) => {
      if (win && !win.isDestroyed()) {
        win.show();
        emit({ type: "shortcut", action });
      }
    });
  } finally {
    if (shortcutCapture) globalShortcut.unregisterAll();
  }
}
function syncNow(m) {
  try {
    const { dest } = syncMeeting(m, settings, store.dir(m.id));
    m.exportPath = dest;
    m.exportedAt = new Date().toISOString();
    m.syncError = "";
    m.syncState = "synced";
    store.save(m);
    syncIndex(store.list(), settings);
    publish(m);
    return dest;
  } catch (e) {
    m.syncState = "error";
    m.syncError = e.message;
    store.save(m);
    publish(m);
    return null;
  }
}
function scheduleSync(m) {
  if (migrating || syncTimers.has(m.id)) return;
  m.syncState = "pending";
  const delay = ["recording", "paused", "transcribing"].includes(m.status)
    ? 5000
    : 500;
  syncTimers.set(
    m.id,
    setTimeout(() => {
      syncTimers.delete(m.id);
      syncNow(m);
    }, delay),
  );
}
async function updateSettings(patch) {
  const previous = settings;
  const next = { ...settings };
  for (const k of [...Object.keys(defaults), ...secretFields])
    if (k in patch) next[k] = patch[k];
  next.autoExport = true;
  if (
    typeof next.codexModel !== "string" ||
    !/^[a-zA-Z0-9._:/-]*$/.test(next.codexModel)
  )
    throw Error("Codex 模型名称无效。");
  if (
    ![
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ].includes(next.codexReasoningEffort)
  )
    throw Error("推理程度无效。");
  if ("appId" in patch && next.appId && !/^\d{5,15}$/.test(next.appId))
    throw Error("AppID 应为数字。");
  if ("dataRoot" in patch)
    next.dataRoot = validateRoot(next.dataRoot, app.getAppPath());
  shortcutsModule.validate(next.shortcuts);
  if (
    "vaultPath" in patch &&
    (!path.isAbsolute(next.vaultPath) || !fs.existsSync(next.vaultPath))
  )
    throw Error("Obsidian 库路径不存在。");
  if (
    path.isAbsolute(next.vaultFolder) ||
    next.vaultFolder.split(/[\\/]/).includes("..")
  )
    throw Error("会议目录必须位于 Obsidian 库内。");
  const rootChanged = next.dataRoot !== settings.dataRoot;
  if (rootChanged && (recording || jobs.size || speechTasks?.running.size))
    throw Error("请结束录制和 AI 整理后，再切换保存根目录。");
  try {
    if ("shortcuts" in patch) registerShortcuts(next.shortcuts);
    if (rootChanged) {
      migrating = true;
      for (const timer of syncTimers.values()) clearTimeout(timer);
      syncTimers.clear();
      store.flush();
      copyMeetings(store.root, path.join(next.dataRoot, "meetings"));
    }
    settings = next;
    persistSettings();
    if (rootChanged) {
      store = new Store(path.join(next.dataRoot, "meetings"));
      if (speechTasks) {
        speechTasks.store = store;
        speechTasks.recover();
      }
    }
  } catch (e) {
    settings = previous;
    try {
      if ("shortcuts" in patch) registerShortcuts();
    } catch {}
    throw e;
  } finally {
    migrating = false;
  }
  if (
    rootChanged ||
    next.vaultPath !== previous.vaultPath ||
    next.vaultFolder !== previous.vaultFolder
  )
    for (const m of store.list()) scheduleSync(m);
  return publicSettings();
}
function persistSettings() {
  if (
    secretFields.some((k) => settings[k]) &&
    !safeStorage.isEncryptionAvailable()
  )
    throw Error("系统安全存储不可用，未保存密钥。");
  const c = { ...settings };
  for (const k of secretFields)
    c[k] = settings[k]
      ? safeStorage.encryptString(settings[k]).toString("base64")
      : "";
  if (speechRegistry)
    for (const k of ["appId", "hotwords", "secretId", "secretKey"]) delete c[k];
  atomic(configPath(), c);
}
function publicSettings() {
  const c = { ...settings };
  for (const k of secretFields) {
    c[k + "Configured"] = !!c[k];
    delete c[k];
  }
  return c;
}
function emit(data) {
  if (win && !win.isDestroyed()) win.webContents.send("app:update", data);
}
function publish(m) {
  emit({ type: "meeting", meeting: m });
}
function save(m, debounce = false) {
  store.save(m, debounce);
  scheduleSync(m);
  if (!debounce) publish(m);
  return m;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    p.on("error", reject);
    p.on("close", (c) =>
      c === 0
        ? resolve(out)
        : reject(Error(`操作失败（${c}）：${err.slice(-500)}`)),
    );
  });
}
function syncHeader(rec) {
  fs.writeSync(rec.fd, wavHeader(rec.bytes), 0, 44, 0);
  fs.fsyncSync(rec.fd);
}
function createCloud(rec) {
  const input = (rec.input = new Queue(150));
  const controller = (rec.controller = new AbortController());
  rec.cloudTask = (async () => {
    try {
      for await (const e of speechRuntime.run(
        {
          resolved: rec.resolved,
          input,
          purpose: "transcribe",
          startMs: rec.m.durationMs,
          contextId: rec.contextId,
        },
        controller.signal,
      )) {
        if (e.type === "status") {
          rec.m.connection = { state: e.state, message: e.message || "" };
          publish(rec.m);
        }
        if (e.type === "segments") {
          for (const segment of e.segments) {
            if (
              rec.m.deletedSegmentIds?.includes(segment.id) ||
              rec.m.deletedSpeakerIds?.includes(segment.speaker)
            )
              continue;
            const old = rec.m.segments.find((s) => s.id === segment.id);
            if (old) {
              if (!old.edited) old.text = segment.text;
              if (!old.speakerEdited) old.speaker = segment.speaker;
              old.endMs = segment.endMs;
              old.final = segment.final;
            } else if (segment.text.trim()) rec.m.segments.push(segment);
          }
          rec.m.segments.sort((a, b) => a.startMs - b.startMs);
          save(rec.m, true);
          publish(rec.m);
        }
        if (e.type === "completed") {
          rec.contextId = e.contextId || rec.contextId;
          rec.m.speakerContextId = rec.contextId;
        }
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      rec.offline = true;
      rec.m.connection = { state: "error", message: e.message };
      rec.m.lastError = e.message;
      rec.m.gaps.push({
        startMs: rec.m.durationMs,
        endMs: rec.m.durationMs,
        reason: "转写连接中断，本地录音继续保存",
      });
      save(rec.m);
    }
  })();
}

async function begin(id, offline = false) {
  if (recording) throw Error("请先结束当前录制。");
  const binding = speechRegistry.public().bindings.meeting;
  const resolved = offline ? null : speechRegistry.resolve(binding);
  const m = store.get(id);
  if (jobs.has(id) || speechTasks.running.has(id))
    throw Error("请等待当前处理完成。");
  const file = path.join(store.dir(id), "recording.wav");
  const exists = fs.existsSync(file);
  const fd = fs.openSync(file, exists ? "r+" : "w+");
  const bytes = exists ? Math.max(0, fs.statSync(file).size - 44) : 0;
  if (!exists) fs.writeSync(fd, wavHeader(0));
  m.durationMs = bytes / 32;
  m.status = "recording";
  m.lastError = "";
  const rec = (recording = {
    m,
    fd,
    bytes,
    queue: [],
    paused: false,
    ending: false,
    offline: offline || binding?.mode === "after",
    after: !offline && binding?.mode === "after",
    binding,
    resolved,
    contextId: m.speakerContextId || "",
  });
  save(m);
  if (!rec.offline) createCloud(rec);
  else
    m.connection = {
      state: rec.after ? "after" : "offline",
      message: rec.after ? "会后自动转写" : "仅录音",
    };
  m.transcriptionSource = resolved
    ? {
        connectionId: binding.connectionId,
        profileId: binding.profileId,
        provider: resolved.connection.name,
        model: resolved.profile.model,
        kind: resolved.profile.kind,
        revision: resolved.revision,
      }
    : null;
  rec.checkpoint = setInterval(() => {
    syncHeader(rec);
    save(m, true);
    publish(m);
  }, 1000);
  powerId = powerSaveBlocker.start("prevent-app-suspension");
  return m;
}
function append(data) {
  const rec = recording;
  if (!rec || rec.paused || rec.ending) return;
  const b = Buffer.from(data);
  if (!b.length || b.length > 64000 || b.length % 2) return;
  const offset = rec.bytes / 32;
  fs.writeSync(rec.fd, b, 0, b.length, 44 + rec.bytes);
  rec.bytes += b.length;
  rec.m.durationMs = rec.bytes / 32;
  let peak = 0;
  for (let i = 0; i < b.length; i += 2)
    peak = Math.max(peak, Math.abs(b.readInt16LE(i)) / 32768);
  rec.m.peaks.push(peak);
  if (!rec.offline) {
    const dropped = rec.input?.push({ buf: b, offset });
    if (dropped)
      rec.m.gaps.push({
        startMs: dropped.offset,
        endMs: dropped.offset + dropped.buf.length / 32,
        reason: "转写积压，原始录音已保存",
      });
  }
}
async function finishCloud(rec) {
  if (!rec.input) return;
  rec.input.end();
  let timer;
  await Promise.race([
    rec.cloudTask,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        rec.controller?.abort();
        resolve();
      }, 15000);
    }),
  ]);
  clearTimeout(timer);
  rec.input = null;
}

async function pause() {
  const rec = recording;
  if (!rec || rec.paused) return;
  rec.paused = true;
  clearTimeout(rec.reconnectTimer);
  await finishCloud(rec);
  syncHeader(rec);
  rec.m.status = "paused";
  save(rec.m);
  return rec.m;
}
async function resume() {
  const rec = recording;
  if (!rec || !rec.paused) throw Error("没有已暂停的录制。");
  rec.paused = false;
  rec.m.status = "recording";
  if (!rec.offline) createCloud(rec);
  save(rec.m);
  return rec.m;
}
async function stop() {
  const rec = recording;
  if (!rec) return null;
  rec.ending = true;
  clearTimeout(rec.reconnectTimer);
  await finishCloud(rec);
  clearInterval(rec.interval);
  clearInterval(rec.checkpoint);
  syncHeader(rec);
  fs.closeSync(rec.fd);
  rec.m.status = "completed";
  rec.m.connection = null;
  save(rec.m);
  recording = null;
  if (powerId !== undefined && powerSaveBlocker.isStarted(powerId))
    powerSaveBlocker.stop(powerId);
  if (rec.after) {
    try {
      await speechTasks.start(rec.m.id, rec.binding, {
        resolved: rec.resolved,
      });
    } catch (e) {
      rec.m.lastError = e.message;
      save(rec.m);
    }
  }
  return rec.m;
}
function exportMeeting(m, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const original = m.segments
    .map(
      (s) =>
        `### ${clock(s.startMs)} · ${m.speakers[s.speaker] || "说话人 " + s.speaker}\n\n${s.text}\n\n^seg-${s.id.replace(/[^a-zA-Z0-9-]/g, "-")}\n`,
    )
    .join("\n");
  fs.writeFileSync(
    path.join(dest, "原文.md"),
    `# ${m.title} · 原文\n\n${original}`,
  );
  fs.writeFileSync(path.join(dest, "重点批注.md"), `# 重点批注\n\n${notes(m)}`);
  atomic(path.join(dest, "会议数据.json"), m);
  const audio = path.join(store.dir(m.id), "recording.wav");
  if (fs.existsSync(audio)) {
    fs.copyFileSync(audio, path.join(dest, "录音.wav"));
    fs.appendFileSync(
      path.join(dest, "原文.md"),
      "\n\n## 完整录音\n\n![[录音.wav]]\n",
    );
  }
  if (m.summary) {
    fs.writeFileSync(path.join(dest, "纪要.md"), summaryMarkdown(m));
    fs.writeFileSync(
      path.join(dest, "思维导图.md"),
      "# " +
        m.title +
        "\n\n```mermaid\n" +
        mermaid(m.summary.mindmap) +
        "```\n",
    );
  }
  return dest;
}
function exportObsidian(m) {
  const dest = syncNow(m);
  if (!dest) throw Error(m.syncError);
  return dest;
}
async function startSummary(id) {
  if (jobs.has(id) || speechTasks.running.has(id))
    throw Error("这场会议正在处理。");
  const m = store.get(id);
  if (!m.segments.length)
    throw Error("还没有转写原文，请录制或重新转写音频后再整理。");
  if (recording?.m.id === id) throw Error("请先结束录制，再生成完整纪要。");
  m.summaryStatus = "running";
  m.summaryError = "";
  save(m);
  const inputFingerprint = JSON.stringify([
    m.segments,
    m.annotations,
    m.speakers,
  ]);
  const task = reviewSummary(
    structuredClone(m),
    structuredClone(settings),
    store.dir(id),
    speechRegistry,
    speechRuntime,
    (message) => emit({ type: "summaryProgress", id, message }),
  );
  jobs.set(id, task);
  task.promise
    .then(async (result) => {
      const current = store.get(id);
      let audioChanged = false;
      if (result.audioReview?.audioHash)
        try {
          audioChanged =
            result.audioReview.audioHash !==
            (await require("./speech/audio.cjs").hashFile(
              path.join(store.dir(id), "recording.wav"),
            ));
        } catch {
          audioChanged = true;
        }
      const valid = new Set(current.segments.map((s) => s.id));
      for (const t of [
        ...result.topics,
        ...result.decisions,
        ...result.actions,
      ])
        t.sourceIds = (t.sourceIds || []).filter((id) => valid.has(id));
      current.summary = result;
      current.summaryStatus = "completed";
      current.summaryGeneratedAt = new Date().toISOString();
      current.summaryStale =
        audioChanged ||
        inputFingerprint !==
          JSON.stringify([
            current.segments,
            current.annotations,
            current.speakers,
          ]);
      save(current);
      if (settings.autoExport)
        try {
          exportObsidian(current);
        } catch (e) {
          current.summaryError = "纪要已生成；自动归档失败：" + e.message;
          save(current);
        }
    })
    .catch((e) => {
      m.summaryStatus = "failed";
      m.summaryError = e.message;
      save(m);
    })
    .finally(() => jobs.delete(id));
  return m;
}
function handle(name, fn) {
  ipcMain.handle("app:" + name, async (event, ...args) => {
    try {
      if (event.sender !== win?.webContents) throw Error("无效调用来源");
      return { data: await fn(...args) };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });
}
function configureIPC() {
  handle("list", () => store.list());
  handle("get", (id) => store.get(id));
  handle("create", (title) => save(store.create(String(title))));
  handle("patch", (id, patch) => {
    const m = store.get(id);
    for (const k of ["title", "favorite"]) if (k in patch) m[k] = patch[k];
    return save(m);
  });
  handle("remove", async (id) => {
    if (recording?.m.id === id || jobs.has(id) || speechTasks.running.has(id))
      throw Error("请先结束录制或整理。");
    const r = await dialog.showMessageBox(win, {
      type: "warning",
      message: "删除这场会议？",
      detail: "本机录音、原文和批注会移入废纸篓。已导出的 Obsidian 文件保留。",
      buttons: ["取消", "移入废纸篓"],
      defaultId: 0,
      cancelId: 0,
    });
    if (r.response !== 1) return false;
    clearTimeout(syncTimers.get(id));
    syncTimers.delete(id);
    await shell.trashItem(store.dir(id));
    store.cache.delete(id);
    return true;
  });
  handle("settings", () => publicSettings());
  handle("saveSettings", updateSettings);
  handle("codexModels", () => listModels(settings.codexPath));
  handle("setShortcutCapture", (active) => {
    shortcutCapture = active === true;
    if (shortcutCapture) globalShortcut.unregisterAll();
    else registerShortcuts();
    return true;
  });
  handle("speechConfig", () => speechRegistry.public());
  handle("speechMutate", (action) => speechRegistry.mutate(action));
  handle("speechTest", async (binding) => {
    const resolved = speechRegistry.resolve(binding);
    const audio = fs.readFileSync(
      path.join(__dirname, "../resources/connection-test.wav"),
    );
    try {
      const result = await speechRuntime.test(binding, audio);
      speechRegistry.recordTest(binding, resolved.revision, { ok: true });
      return result;
    } catch (e) {
      speechRegistry.recordTest(binding, resolved.revision, {
        ok: false,
        message: e.message,
      });
      throw e;
    }
  });
  handle("speechResolveAppId", async (id) => {
    const c = speechRegistry.state.connections.find((c) => c.id === id);
    if (!c || c.type !== "tencent") throw Error("请选择腾讯连接。");
    const appId = await getAppId(c);
    return speechRegistry.mutate({ op: "connection", id, patch: { appId } });
  });
  handle("speechTask", (id) => speechTasks.read(id));
  handle("resumeSpeechTask", (id) =>
    speechTasks.start(id, null, { resume: true }),
  );
  handle("cancelSpeechTask", (id) => speechTasks.cancel(id));
  handle("applyTranscript", (id) => {
    if (jobs.has(id) || speechTasks.running.has(id) || recording?.m.id === id)
      throw Error("请等待当前任务完成。");
    const m = store.get(id);
    if (!m.pendingTranscript) throw Error("没有可采用的新原文。");
    atomic(path.join(store.dir(id), "before-apply-" + Date.now() + ".json"), {
      segments: m.segments,
      speakers: m.speakers,
      annotations: m.annotations,
    });
    m.transcriptionSource = m.pendingTranscript.source;
    m.segments = m.pendingTranscript.segments;
    m.speakers = {};
    m.pendingTranscript = null;
    m.summaryStale = !!m.summary;
    return save(m);
  });
  handle("health", async () => {
    let status = "未安装";
    try {
      status =
        String(await run(settings.codexPath, ["login", "status"])).trim() ||
        "已安装";
    } catch (e) {
      status = e.message;
    }
    return {
      codex: status,
      codexInstalled: fs.existsSync(settings.codexPath),
      ffmpeg: fs.existsSync(settings.ffmpegPath),
      microphone: systemPreferences.getMediaAccessStatus("microphone"),
      dataPath: store.root,
    };
  });
  handle("chooseDataRoot", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "选择会议数据保存根目录",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: settings.dataRoot,
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle("confirmStop", async () => {
    if (!recording) return false;
    const r = await dialog.showMessageBox(win, {
      type: "question",
      message: "结束这次录制？",
      detail: "已录下的音频、原文和批注会保存，并自动关联到 Obsidian。",
      buttons: ["继续录制", "结束并保存"],
      defaultId: 0,
      cancelId: 0,
    });
    return r.response === 1;
  });
  handle("chooseVault", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "选择 Obsidian 库文件夹",
      properties: ["openDirectory"],
      defaultPath: settings.vaultPath,
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle("chooseCodex", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "选择 Codex 可执行文件",
      properties: ["openFile"],
      defaultPath: "/opt/homebrew/bin",
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle("start", begin);
  handle("pause", pause);
  handle("resume", resume);
  handle("stop", stop);
  ipcMain.on("app:audio", (e, d) => {
    if (e.sender === win?.webContents)
      try {
        append(d);
      } catch (err) {
        if (recording) {
          recording.m.lastError = "录音保存失败：" + err.message;
          publish(recording.m);
          void stop();
        }
      }
  });
  handle("annotate", (id, a) => {
    const m = store.get(id);
    const ann = {
      id: crypto.randomUUID(),
      quote: String(a.quote),
      note: String(a.note || ""),
      type: ["highlight", "action", "decision", "question"].includes(a.type)
        ? a.type
        : "highlight",
      segmentIds: a.segmentIds || [],
      startMs: Number(a.startMs) || 0,
      endMs: Number(a.endMs) || 0,
      createdAt: new Date().toISOString(),
    };
    m.annotations.push(ann);
    m.summaryStale = !!m.summary;
    return save(m);
  });
  handle("editAnnotation", (id, aid, note, type) => {
    const m = store.get(id);
    const a = m.annotations.find((x) => x.id === aid);
    if (a) {
      a.note = String(note);
      if (["highlight", "action", "decision", "question"].includes(type))
        a.type = type;
    }
    m.summaryStale = !!m.summary;
    return save(m);
  });
  handle("deleteAnnotation", (id, aid) => {
    const m = store.get(id);
    m.annotations = m.annotations.filter((a) => a.id !== aid);
    m.summaryStale = !!m.summary;
    return save(m);
  });
  handle("editSegment", (id, sid, patch) => {
    const m = store.get(id);
    const s = m.segments.find((x) => x.id === sid);
    if (!s) throw Error("未找到原文片段");
    if (typeof patch.text === "string") {
      if (!("originalText" in s)) s.originalText = s.text;
      s.text = patch.text;
      s.edited = true;
    }
    if (typeof patch.speaker === "string") {
      s.speaker = patch.speaker;
      s.speakerEdited = true;
    }
    m.summaryStale = !!m.summary;
    return save(m);
  });
  handle("deleteSegment", (id, sid) =>
    save(transcriptEdit.deleteSegment(store.get(id), sid)),
  );
  handle("editSpeakers", (id, changes) =>
    save(transcriptEdit.editSpeakers(store.get(id), changes)),
  );
  handle("renameSpeaker", (id, speaker, name) => {
    const m = store.get(id);
    m.speakers[speaker] = String(name).trim();
    m.summaryStale = !!m.summary;
    return save(m);
  });
  handle("generate", startSummary);
  handle("cancelSummary", (id) => {
    jobs.get(id)?.cancel();
    return true;
  });
  handle("exportObsidian", (id) => exportObsidian(store.get(id)));
  handle("exportBundle", async (id) => {
    const m = store.get(id);
    const d = await dialog.showOpenDialog(win, {
      title: "选择会议导出位置",
      properties: ["openDirectory", "createDirectory"],
    });
    if (d.canceled) return null;
    return exportMeeting(
      m,
      path.join(d.filePaths[0], safeName(m.title) + "-" + id.slice(0, 6)),
    );
  });
  handle("exportHighlights", async (id) => {
    const m = store.get(id);
    if (!m.annotations.length) throw Error("请先标注至少一段原文。");
    const audio = path.join(store.dir(id), "recording.wav");
    if (!fs.existsSync(audio)) throw Error("没有可用录音。");
    const r = await dialog.showSaveDialog(win, {
      title: "导出重点音频",
      defaultPath: safeName(m.title) + "-重点.mp3",
      filters: [{ name: "MP3 音频", extensions: ["mp3"] }],
    });
    if (r.canceled) return null;
    const ranges = m.annotations
      .map((a) => [
        Math.max(0, a.startMs / 1000 - 2),
        Math.min(m.durationMs / 1000, a.endMs / 1000 + 2),
      ])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    const filters =
      merged
        .map(
          ([s, e], i) =>
            `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`,
        )
        .join(";") +
      ";" +
      merged.map((_, i) => `[a${i}]`).join("") +
      `concat=n=${merged.length}:v=0:a=1[out]`;
    await run(settings.ffmpegPath, [
      "-y",
      "-i",
      audio,
      "-filter_complex",
      filters,
      "-map",
      "[out]",
      "-b:a",
      "128k",
      r.filePath,
    ]);
    return r.filePath;
  });
  handle("importAudio", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "导入会议录音",
      properties: ["openFile"],
      filters: [
        {
          name: "音频 / 视频",
          extensions: [
            "wav",
            "mp3",
            "m4a",
            "aac",
            "mp4",
            "ogg",
            "flac",
            "webm",
          ],
        },
      ],
    });
    if (r.canceled) return null;
    const m = store.create(
      path.basename(r.filePaths[0], path.extname(r.filePaths[0])),
    );
    const dest = path.join(store.dir(m.id), "recording.wav");
    try {
      await run(settings.ffmpegPath, [
        "-y",
        "-i",
        r.filePaths[0],
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        dest,
      ]);
      const raw = path.join(store.dir(m.id), "import.pcm");
      await run(settings.ffmpegPath, ["-y", "-i", dest, "-f", "s16le", raw]);
      const length = fs.statSync(raw).size;
      const input = fs.openSync(raw, "r"),
        output = fs.openSync(dest, "w");
      try {
        fs.writeSync(output, wavHeader(length));
        const chunk = Buffer.alloc(6400);
        for (let pos = 0; pos < length; pos += chunk.length) {
          const n = fs.readSync(
            input,
            chunk,
            0,
            Math.min(chunk.length, length - pos),
            pos,
          );
          fs.writeSync(output, chunk, 0, n);
          let peak = 0;
          for (let j = 0; j < n; j += 2)
            peak = Math.max(peak, Math.abs(chunk.readInt16LE(j)) / 32768);
          m.peaks.push(peak);
        }
      } finally {
        fs.closeSync(input);
        fs.closeSync(output);
      }
      fs.unlinkSync(raw);
      m.durationMs = length / 32;
      m.status = "completed";
      save(m);
      return m;
    } catch (e) {
      store.remove(m.id);
      throw e;
    }
  });
  handle("retranscribe", async (id, binding) => {
    if (recording?.m.id === id || jobs.has(id))
      throw Error("请先结束当前会议的录制或整理。");
    return speechTasks.start(
      id,
      binding || speechRegistry.public().bindings.meeting,
    );
  });
  handle("reveal", async (id) => {
    shell.showItemInFolder(path.join(store.dir(id), "meeting.json"));
    return true;
  });
  handle("openObsidian", async (id) => {
    const m = store.get(id);
    if (!m.exportPath) throw Error("请先保存到 Obsidian。");
    await shell.openExternal(
      "obsidian://open?path=" +
        encodeURIComponent(path.join(m.exportPath, "会议.md")),
    );
    return true;
  });
}
app.whenReady().then(() => {
  loadSettings();
  store = new Store(path.join(settings.dataRoot, "meetings"));
  const registryFile = path.join(
    app.getPath("userData"),
    "speech-providers.json",
  );
  if (!fs.existsSync(registryFile) && fs.existsSync(configPath()))
    if (
      !fs.existsSync(
        path.join(app.getPath("userData"), "settings-before-speech-v1.json"),
      )
    )
      fs.copyFileSync(
        configPath(),
        path.join(app.getPath("userData"), "settings-before-speech-v1.json"),
        fs.constants.COPYFILE_EXCL,
      );
  speechRegistry = new SpeechRegistry(
    registryFile,
    safeStorage,
    settings,
    () => [
      ...(recording?.binding ? [recording.binding] : []),
      ...[...jobs.values()].map((j) => j.binding).filter(Boolean),
      ...(speechTasks?.activeBindings() || []),
    ],
  );
  speechRuntime = new SpeechRuntime(speechRegistry);
  speechTasks = new SpeechTasks(store, speechRegistry, speechRuntime, (m) => {
    publish(m);
    scheduleSync(m);
  });
  // The registry is now the sole credential store for speech providers.
  for (const k of ["appId", "hotwords", "secretId", "secretKey"])
    delete settings[k];
  persistSettings();
  protocol.handle("media", async (request) => {
    try {
      const u = new URL(request.url);
      const id = u.pathname.slice(1);
      const f = path.join(store.dir(id), "recording.wav");
      const size = fs.statSync(f).size;
      const range = request.headers.get("Range");
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (!match) return new Response(null, { status: 416 });
        const start = Number(match[1]),
          end = Math.min(size - 1, match[2] ? Number(match[2]) : size - 1);
        if (start >= size || end < start)
          return new Response(null, { status: 416 });
        return new Response(
          Readable.toWeb(fs.createReadStream(f, { start, end })),
          {
            status: 206,
            headers: {
              "Content-Type": "audio/wav",
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(end - start + 1),
            },
          },
        );
      }
      return new Response(Readable.toWeb(fs.createReadStream(f)), {
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  configureIPC();
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1050,
    minHeight: 720,
    title: "AI 纪要",
    backgroundColor: "#f8f8f4",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.AI_MINUTES_DATA_DIR)
    win.on("page-title-updated", (e) => {
      e.preventDefault();
      win.setTitle("AI 纪要 · 隔离测试");
    });
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb) =>
    cb(wc === win.webContents && permission === "media"),
  );
  win.webContents.session.setPermissionCheckHandler(
    (wc, permission) => wc === win.webContents && permission === "media",
  );
  const restoreShortcuts = () => {
    if (!shortcutCapture) return;
    shortcutCapture = false;
    try {
      registerShortcuts();
    } catch (e) {
      emit({ type: "notice", message: e.message });
    }
  };
  win.on("blur", restoreShortcuts);
  win.on("closed", restoreShortcuts);
  win.webContents.on("render-process-gone", () => {
    restoreShortcuts();
    if (recording) void stop();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:") && !url.startsWith("http://127.0.0.1"))
      e.preventDefault();
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "AI 纪要",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "显示",
        submenu: [
          { role: "togglefullscreen" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
        ],
      },
    ]),
  );
  try {
    registerShortcuts();
  } catch (e) {
    setTimeout(() => emit({ type: "notice", message: e.message }), 1500);
  }
  for (const m of store.list()) scheduleSync(m);
  if (process.env.AI_MINUTES_DEV_URL)
    win.loadURL(process.env.AI_MINUTES_DEV_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
  let closing = false;
  win.on("close", (e) => {
    if (closing) return;
    if (recording || jobs.size || speechTasks?.running.size) {
      e.preventDefault();
      void dialog
        .showMessageBox(win, {
          type: "question",
          message: "还有录制或整理正在进行",
          detail: "返回继续工作，或停止任务、保存已有内容并退出。",
          buttons: ["返回", "保存并退出"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(async (r) => {
          if (r.response === 1) {
            for (const job of jobs.values()) job.cancel();
            for (const job of speechTasks.running.values()) job.cancel();
            if (recording) {
              recording.after = false;
              await stop();
            }
            closing = true;
            win.close();
          }
        });
    }
  });
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  for (const timer of syncTimers.values()) clearTimeout(timer);
  for (const m of store?.list() || []) syncNow(m);
  store?.flush();
  app.quit();
});
