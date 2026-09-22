const defaults = {
  toggleRecording: "CommandOrControl+Shift+R",
  pauseRecording: "CommandOrControl+Shift+P",
  newMeeting: "CommandOrControl+Alt+N",
};
function normalize(value) {
  return String(value || "")
    .replace(/CommandOrControl|CmdOrCtrl/g, "CommandOrControl")
    .trim();
}
function validate(shortcuts) {
  const used = new Set();
  for (const [action, value] of Object.entries(shortcuts)) {
    if (!Object.hasOwn(defaults, action)) throw Error("未知快捷键操作");
    if (!value) continue;
    if (
      typeof value !== "string" ||
      !/(CommandOrControl|Command|Control|Alt|Option|Shift)\+/.test(value) ||
      value.length > 80
    )
      throw Error("快捷键需要组合键，例如 CommandOrControl+Shift+R");
    const id = normalize(value)
      .replace(/CommandOrControl|Command/g, "Control")
      .toLowerCase();
    if (used.has(id)) throw Error("快捷键不能重复。");
    used.add(id);
  }
  return shortcuts;
}
function install(globalShortcut, shortcuts, callback) {
  validate(shortcuts);
  globalShortcut.unregisterAll();
  const failures = [];
  for (const [action, accelerator] of Object.entries(shortcuts)) {
    if (!accelerator) continue;
    try {
      if (!globalShortcut.register(accelerator, () => callback(action)))
        failures.push(accelerator);
    } catch {
      failures.push(accelerator);
    }
  }
  if (failures.length)
    throw Error("快捷键被占用或格式不正确：" + failures.join("、"));
}
module.exports = { defaults, validate, install };
