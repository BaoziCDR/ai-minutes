const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { atomic } = require("./store.cjs");
function resolveRoot(value) {
  const expanded =
    value === "~"
      ? os.homedir()
      : String(value || "").replace(/^~\//, os.homedir() + "/");
  if (!path.isAbsolute(expanded)) throw Error("保存根目录必须是绝对路径。");
  return path.resolve(expanded);
}
function validateRoot(value, projectPath) {
  const root = resolveRoot(value);
  const project = path.resolve(projectPath);
  if (root === project || root.startsWith(project + path.sep))
    throw Error("用户数据不能保存在项目源码目录中，请选择其他位置。");
  let parent = root;
  while (parent !== path.dirname(parent)) {
    if (fs.existsSync(path.join(parent, ".git")))
      throw Error("用户数据不能保存在 Git 仓库中。");
    parent = path.dirname(parent);
  }
  return root;
}
function copyMeetings(from, to) {
  if (path.resolve(from) === path.resolve(to)) return;
  if (
    path.resolve(to).startsWith(path.resolve(from) + path.sep) ||
    path.resolve(from).startsWith(path.resolve(to) + path.sep)
  )
    throw Error("目标会议目录不能嵌套在当前会议目录中。");
  fs.mkdirSync(to, { recursive: true });
  if (!fs.existsSync(from)) return;
  // Preflight all collisions before making any copy. Existing records are never overwritten.
  const entries = fs
    .readdirSync(from, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  for (const e of entries)
    if (fs.existsSync(path.join(to, e.name)))
      throw Error("目标目录已有相同 ID 的会议，请选择空目录。");
  const copied = [];
  try {
    for (const e of entries) {
      const dest = path.join(to, e.name);
      copied.push(dest);
      fs.cpSync(path.join(from, e.name), dest, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
  } catch (e) {
    for (const dest of copied)
      fs.rmSync(dest, { recursive: true, force: true });
    throw e;
  }
}
module.exports = { resolveRoot, validateRoot, copyMeetings };
