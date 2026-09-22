// All records, settings, API fixtures and exports live in a disposable OS temp directory.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Store, wavHeader } = require("../electron/store.cjs");
async function poll(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Expected state did not arrive");
}
(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-desktop-"));
  const config = path.join(base, "config");
  const root = path.join(config, "data");
  const vault = path.join(base, "basic-memory");
  fs.mkdirSync(vault);
  fs.mkdirSync(config);
  fs.writeFileSync(
    path.join(config, "settings.json"),
    JSON.stringify({ vaultPath: vault }),
  );
  const store = new Store(path.join(root, "meetings"));
  const m = store.create("合成测试 · 新功能验收");
  m.status = "completed";
  m.durationMs = 2000;
  m.peaks = [0.2, 0.4, 0.3];
  m.segments = [
    {
      id: "test-1",
      text: "这里决定采用自动归档，录音也要关联到会议。",
      speaker: "0",
      startMs: 0,
      endMs: 1000,
      final: true,
    },
    {
      id: "test-2",
      text: "请确认一下下次会议的时间。",
      speaker: "1",
      startMs: 1000,
      endMs: 2000,
      final: true,
    },
  ];
  store.save(m);
  fs.writeFileSync(
    path.join(store.dir(m.id), "recording.wav"),
    Buffer.concat([wavHeader(64000), Buffer.alloc(64000)]),
  );
  const summary = {
    overview: "采用自动归档",
    topics: [
      { title: "归档", detail: "自动关联录音与纪要", sourceIds: ["test-1"] },
    ],
    actions: [],
    decisions: [{ text: "采用自动归档", sourceIds: ["test-1"] }],
    openQuestions: ["下次会议时间"],
    mindmap: {
      title: "归档",
      branches: [{ title: "自动化", items: ["关联录音", "生成纪要"] }],
    },
  };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(summary) } }],
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let app;
  try {
    app = await electron.launch({
      args: [path.resolve(__dirname, "..")],
      env: { ...process.env, AI_MINUTES_DATA_DIR: config },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector(".hero");
    await page.getByRole("button", { name: "设置与连接" }).click();
    const rects = [];
    for (const name of [
      "语音识别",
      "录音设备",
      "快捷键",
      "AI 整理",
      "存储与归档",
      "外观",
    ]) {
      await page
        .locator(".settings-nav")
        .getByRole("button", { name, exact: true })
        .click();
      rects.push(await page.locator(".modal.wide").boundingBox());
    }
    assert.ok(
      rects.every(
        (r) =>
          r.width === rects[0].width &&
          r.height === rects[0].height &&
          r.y === rects[0].y,
      ),
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "存储与归档", exact: true })
      .click();
    const nextRoot = path.join(base, "new-root");
    await page.getByLabel("会议数据保存根目录", { exact: true }).fill(nextRoot);
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await poll(() =>
      page.evaluate(
        async (r) => (await window.shengye.settings()).dataRoot === r,
        nextRoot,
      ),
    );
    assert.ok(
      fs.existsSync(path.join(nextRoot, "meetings", m.id, "recording.wav")),
    );
    assert.ok(
      fs.existsSync(path.join(root, "meetings", m.id, "recording.wav")),
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "快捷键", exact: true })
      .click();
    await page
      .getByLabel("开始 / 结束录制快捷键")
      .fill("CommandOrControl+Alt+R");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await poll(() =>
      app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("CommandOrControl+Alt+R"),
      ),
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".meeting-card").first().click();
    await page.evaluate(() => {
      const el = document.querySelector(".segment-text");
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("dialog", { name: "原文标注" }).waitFor();
    assert.equal(await page.locator(".modal-backdrop").count(), 0);
    await page.getByRole("button", { name: "标记为决策", exact: true }).click();
    await page.getByText("已标记为决策", { exact: false }).waitFor();
    await page
      .getByRole("button", { name: "添加备注（可选）", exact: true })
      .click();
    await page
      .getByLabel("标注备注", { exact: true })
      .fill("这是需要保留的验收依据");
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await poll(() =>
      page.evaluate(async (id) => {
        const m = await window.shengye.get(id);
        return (
          m.annotations.length === 1 &&
          m.annotations[0].note === "这是需要保留的验收依据" &&
          m.annotations[0].type === "decision"
        );
      }, m.id),
    );
    await poll(() =>
      page.evaluate(
        async (id) => (await window.shengye.get(id)).syncState === "synced",
        m.id,
      ),
    );
    let saved = await page.evaluate((id) => window.shengye.get(id), m.id);
    assert.ok(fs.existsSync(path.join(saved.exportPath, "录音.wav")));
    assert.match(
      fs.readFileSync(path.join(saved.exportPath, "重点批注.md"), "utf8"),
      /决策/,
    );
    await page.evaluate(
      async (cfg) => {
        await window.shengye.saveSettings(cfg);
      },
      {
        summaryProvider: "api",
        apiKey: "synthetic-test-key",
        apiBase: `http://127.0.0.1:${server.address().port}/v1`,
        apiModel: "fixture",
      },
    );
    await page.getByRole("button", { name: "生成纪要", exact: true }).click();
    await poll(() =>
      page.evaluate(async (id) => {
        const m = await window.shengye.get(id);
        return m.summaryStatus === "completed" && m.syncState === "synced";
      }, m.id),
    );
    saved = await page.evaluate((id) => window.shengye.get(id), m.id);
    for (const f of [
      "会议.md",
      "录音.wav",
      "重点批注.md",
      "纪要.md",
      "思维导图.md",
      "待办.md",
      "决策.md",
    ])
      assert.ok(fs.existsSync(path.join(saved.exportPath, f)));
    assert.ok(fs.existsSync(path.join(vault, "会议记录", "会议索引.md")));
    // Both toolbar and keyboard event paths use the same confirmation; cancel keeps recording.
    const recording = await page.evaluate(async () => {
      const m = await window.shengye.create("合成测试 · 快捷键");
      await window.shengye.start(m.id, true);
      return m;
    });
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0 });
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("app:update", {
        type: "shortcut",
        action: "toggleRecording",
      }),
    );
    await page.waitForTimeout(300);
    assert.equal(
      (await page.evaluate((id) => window.shengye.get(id), recording.id))
        .status,
      "recording",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("app:update", {
        type: "shortcut",
        action: "pauseRecording",
      }),
    );
    await poll(() =>
      page.evaluate(
        async (id) => (await window.shengye.get(id)).status === "paused",
        recording.id,
      ),
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("app:update", {
        type: "shortcut",
        action: "pauseRecording",
      }),
    );
    await poll(() =>
      page.evaluate(
        async (id) => (await window.shengye.get(id)).status === "recording",
        recording.id,
      ),
    );
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send("app:update", {
        type: "shortcut",
        action: "toggleRecording",
      }),
    );
    await poll(() =>
      page.evaluate(
        async (id) => (await window.shengye.get(id)).status === "completed",
        recording.id,
      ),
    );
    await page
      .locator(".recent-list button")
      .filter({ hasText: "合成测试 · 新功能验收" })
      .click();
    await page
      .getByRole("button", { name: "会议原文", exact: false })
      .first()
      .click();
    if (process.env.AI_MINUTES_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.AI_MINUTES_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.AI_MINUTES_SCREENSHOT_DIR,
          "ai-minutes-workspace.png",
        ),
      });
      await page.getByRole("button", { name: "设置与连接" }).click();
      await page
        .locator(".settings-nav")
        .getByRole("button", { name: "存储与归档" })
        .click();
      await page.screenshot({
        path: path.join(
          process.env.AI_MINUTES_SCREENSHOT_DIR,
          "ai-minutes-settings.png",
        ),
      });
    }
    assert.deepEqual(errors, []);
    await app.close();
    app = null;
    // A root change and shortcuts survive a full process restart.
    app = await electron.launch({
      args: [path.resolve(__dirname, "..")],
      env: { ...process.env, AI_MINUTES_DATA_DIR: config },
    });
    const reopened = await app.firstWindow();
    await reopened.waitForSelector(".hero");
    const conf = await reopened.evaluate(() => window.shengye.settings());
    assert.equal(conf.dataRoot, nextRoot);
    assert.equal(conf.shortcuts.toggleRecording, "CommandOrControl+Alt+R");
    assert.ok(
      (await reopened.evaluate(() => window.shengye.list())).some(
        (x) => x.id === m.id,
      ),
    );
    console.log(
      "PASS: fixed settings geometry, typed selection bubble, optional note, automatic audio/AI Obsidian sync, data-root migration/restart, shortcut registration, pause/resume, stop cancellation/confirmation.",
    );
  } finally {
    if (app) await app.close();
    server.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
