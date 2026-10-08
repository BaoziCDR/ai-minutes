const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
function findCodex() {
  return (
    [
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
    ].find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) || "/opt/homebrew/bin/codex"
  );
}
// Read-only app-server RPC: no thread or turn is created and no prompts are sent.
function listModels(bin, { spawnProcess = spawn, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let child,
      timer,
      buffer = "",
      settled = false,
      requestId = 1;
    const models = new Map(),
      cursors = new Set();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.stdin.end();
      child?.kill();
      if (error) reject(error);
      else resolve([...models.values()]);
    };
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    const nextPage = (cursor) =>
      send({
        id: ++requestId,
        method: "model/list",
        params: {
          limit: 100,
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        },
      });
    try {
      child = spawnProcess(bin, ["app-server"], {
        cwd: os.tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH:
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" +
            (process.env.PATH || ""),
        },
      });
      timer = setTimeout(
        () => finish(Error("读取 Codex 模型超时，请检查登录或网络后重试。")),
        timeoutMs,
      );
      child.on("error", () =>
        finish(Error("无法启动 Codex，请检查可执行文件路径。")),
      );
      child.on("close", () =>
        finish(Error("Codex 已退出，未能读取模型列表。")),
      );
      child.stdin.on("error", () =>
        finish(Error("Codex 连接已关闭，请重试。")),
      );
      child.stderr.on("data", () => {});
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        buffer += chunk.toString();
        if (buffer.length > 2 * 1024 * 1024)
          return finish(Error("Codex 返回的模型列表过大。"));
        let end;
        while (!settled && (end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let response;
          try {
            response = JSON.parse(line);
          } catch {
            continue;
          }
          if (response.id !== requestId) continue;
          if (response.error)
            return finish(
              Error("Codex 无法返回模型列表，请检查 CLI 版本和登录状态。"),
            );
          if (requestId === 1) {
            send({ method: "initialized", params: {} });
            nextPage();
            continue;
          }
          const result = response.result;
          if (!Array.isArray(result?.data))
            return finish(Error("Codex 模型列表格式不正确。"));
          for (const model of result.data) {
            if (
              model.hidden ||
              (model.inputModalities && !model.inputModalities.includes("text"))
            )
              continue;
            const id = model.model || model.id;
            if (typeof id !== "string" || !id) continue;
            models.set(id, {
              id,
              displayName: model.displayName || id,
              description: model.description || "",
              supportedReasoningEfforts: (model.supportedReasoningEfforts || [])
                .map((e) => e.reasoningEffort)
                .filter((e) => typeof e === "string"),
              defaultReasoningEffort: model.defaultReasoningEffort || "medium",
              isDefault: model.isDefault === true,
            });
          }
          if (!result.nextCursor) return finish();
          if (cursors.has(result.nextCursor))
            return finish(Error("Codex 模型列表分页异常。"));
          cursors.add(result.nextCursor);
          nextPage(result.nextCursor);
        }
      });
      send({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "ai_minutes",
            title: "AI Minutes",
            version: "1.1.3",
          },
        },
      });
    } catch {
      finish(Error("无法读取 Codex 模型，请检查可执行文件路径。"));
    }
  });
}
module.exports = { findCodex, listModels };
