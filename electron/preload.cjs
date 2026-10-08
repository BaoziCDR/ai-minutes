const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "list",
  "speechConfig",
  "speechMutate",
  "speechTest",
  "speechResolveAppId",
  "speechTask",
  "resumeSpeechTask",
  "cancelSpeechTask",
  "applyTranscript",
  "get",
  "create",
  "patch",
  "remove",
  "settings",
  "saveSettings",
  "codexModels",
  "setShortcutCapture",
  "health",
  "chooseDataRoot",
  "confirmStop",
  "chooseVault",
  "chooseCodex",
  "start",
  "pause",
  "resume",
  "stop",
  "annotate",
  "deleteAnnotation",
  "editAnnotation",
  "editSegment",
  "deleteSegment",
  "editSpeakers",
  "renameSpeaker",
  "generate",
  "cancelSummary",
  "exportObsidian",
  "exportBundle",
  "exportHighlights",
  "importAudio",
  "retranscribe",
  "reveal",
  "openObsidian",
];
const api = {};
for (const method of methods)
  api[method] = (...args) =>
    ipcRenderer.invoke("app:" + method, ...args).then((r) => {
      if (r.error) throw Error(r.error);
      return r.data;
    });
api.audio = (data) => ipcRenderer.send("app:audio", data);
api.onUpdate = (cb) => {
  const f = (_, d) => cb(d);
  ipcRenderer.on("app:update", f);
  return () => ipcRenderer.removeListener("app:update", f);
};
contextBridge.exposeInMainWorld("shengye", api);
