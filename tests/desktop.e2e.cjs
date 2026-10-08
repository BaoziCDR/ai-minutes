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
    JSON.stringify({
      vaultPath: vault,
      codexPath: path.join(__dirname, "fixtures", "fake-codex.cjs"),
    }),
  );
  const store = new Store(path.join(root, "meetings"));
  const m = store.create("合成测试 · 新功能验收");
  m.status = "completed";
  m.durationMs = 2000;
  m.peaks = [0.014, 0.032, 0.024, 0.035, 0.067, 0.128, 0.061];
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
      "语音供应商",
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
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "AI 整理", exact: true })
      .click();
    const models = page.getByLabel("Codex 模型", { exact: true });
    await poll(async () => (await models.locator("option").count()) === 3);
    assert.equal(
      await page.getByLabel("Codex 推理程度", { exact: true }).inputValue(),
      "medium",
    );
    assert.equal(
      await models.evaluate((el) => getComputedStyle(el).cursor),
      "pointer",
    );
    await models.selectOption("fixture-second");
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.settings())).codexModel ===
        "fixture-second",
    );
    await page
      .getByLabel("Codex 推理程度", { exact: true })
      .selectOption("high");
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.settings()))
          .codexReasoningEffort === "high",
    );
    assert.equal(await page.locator(".settings-security").count(), 0);
    assert.equal(await page.locator(".autosave-footer").count(), 0);
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "存储与归档", exact: true })
      .click();
    const nextRoot = path.join(base, "new-root");
    await page.getByLabel("会议数据保存根目录", { exact: true }).fill(nextRoot);
    await page.getByLabel("会议数据保存根目录", { exact: true }).press("Tab");
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
    const shortcut = page.getByLabel("开始 / 结束录制快捷键");
    await shortcut.click();
    await poll(() => shortcut.inputValue().then((v) => v === "请按组合键…"));
    assert.equal(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("CommandOrControl+Shift+R"),
      ),
      false,
    );
    await shortcut.press("Meta+Alt+R");
    await poll(() =>
      app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Command+Alt+R"),
      ),
    );
    assert.match(await shortcut.inputValue(), /⌘.*⌥.*R/);
    // Existing shortcuts are captured without triggering their associated action.
    const pause = page.getByLabel("暂停 / 继续录制快捷键");
    await pause.click();
    await poll(() => pause.inputValue().then((v) => v === "请按组合键…"));
    await pause.press("Meta+Alt+R");
    await page.getByText("快捷键不能重复。", { exact: true }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.shengye.settings())).shortcuts
        .pauseRecording,
      "CommandOrControl+Shift+P",
    );
    await pause.press("Escape");
    assert.equal(
      await page.getByRole("dialog", { name: "设置与连接" }).count(),
      1,
    );
    await poll(() =>
      app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Command+Alt+R"),
      ),
    );
    // Clear disables a binding and persists immediately; capture can set it again.
    const newMeeting = page.getByLabel("新建会议快捷键");
    await newMeeting.click();
    await poll(() => newMeeting.inputValue().then((v) => v === "请按组合键…"));
    await newMeeting.press("Backspace");
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.settings())).shortcuts
          .newMeeting === "",
    );
    await newMeeting.click();
    await poll(() => newMeeting.inputValue().then((v) => v === "请按组合键…"));
    await newMeeting.press("Meta+Alt+N");
    await poll(() =>
      app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Command+Alt+N"),
      ),
    );
    assert.equal(
      await page.getByRole("button", { name: "保存设置", exact: true }).count(),
      0,
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "外观", exact: true })
      .click();
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await poll(() =>
      page.evaluate(() => document.documentElement.dataset.theme === "dark"),
    );
    await page.getByRole("button", { name: "浅色", exact: true }).click();
    await poll(() =>
      page.evaluate(() => document.documentElement.dataset.theme === "light"),
    );
    // A rejected path cannot block an unrelated setting or replace the working path.
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "存储与归档", exact: true })
      .click();
    await page
      .getByLabel("Obsidian 库位置")
      .fill("/does-not-exist-ai-minutes-test");
    await page.getByLabel("Obsidian 库位置").press("Tab");
    await page
      .getByText("未保存：Obsidian 库路径不存在。", { exact: true })
      .waitFor();
    assert.equal(
      (await page.evaluate(() => window.shengye.settings())).vaultPath,
      vault,
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "外观", exact: true })
      .click();
    await page.getByRole("button", { name: "深色", exact: true }).click();
    await poll(() =>
      page.evaluate(() => document.documentElement.dataset.theme === "dark"),
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "存储与归档", exact: true })
      .click();
    await page.getByLabel("Obsidian 库位置").fill(vault);
    await page.getByLabel("Obsidian 库位置").press("Tab");
    await poll(
      async () => (await page.locator(".autosave-footer").count()) === 0,
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "语音供应商", exact: true })
      .click();
    const hotwords = page.getByLabel("识别热词", { exact: true });
    await hotwords.fill("第一版");
    await hotwords.fill("最终热词，自动保存");
    // Closing before the debounce fires must flush the latest draft.
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.shengye.speechConfig())).profiles[0]
        .hotwords,
      "最终热词，自动保存",
    );
    await page.locator(".meeting-card").first().click();
    const heights = await page
      .locator(".wave-bars i")
      .evaluateAll((bars) => bars.map((b) => b.getBoundingClientRect().height));
    assert.ok(
      Math.max(...heights) >= 30 && new Set(heights).size > 3,
      "Quiet recording should have a visible waveform",
    );
    await page.getByLabel("录音播放进度").click();
    assert.equal(
      await page
        .locator(".waveform")
        .evaluate((el) => getComputedStyle(el).outlineStyle),
      "none",
      "Pointer seeking should not show a focus frame",
    );
    assert.equal(await page.locator(".obsidian-link").count(), 0);
    await page.locator(".saved-label time").waitFor();
    assert.match(
      await page.locator(".saved-label time").innerText(),
      /\d{2}:\d{2}:\d{2}/,
    );

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
    // Speaker changes are a draft until Done; closing discards the whole batch.
    await page
      .getByRole("button", { name: "会议原文", exact: false })
      .first()
      .click();
    await page
      .getByRole("button", { name: "编辑发言人", exact: true })
      .first()
      .click();
    let speakers = page.getByRole("dialog", {
      name: "编辑发言人",
      exact: true,
    });
    assert.equal(
      await speakers.getByRole("button", { name: "保存", exact: true }).count(),
      0,
    );
    assert.equal(await speakers.getByPlaceholder("添加发言人姓名").count(), 0);
    await speakers.getByPlaceholder("填写姓名").first().fill("不应保存");
    await speakers
      .getByRole("button", { name: "删除说话人 B", exact: true })
      .click();
    assert.equal(
      (await page.evaluate((id) => window.shengye.get(id), m.id)).segments
        .length,
      2,
    );
    await speakers.getByRole("button", { name: "关闭", exact: true }).click();
    assert.equal(
      (await page.evaluate((id) => window.shengye.get(id), m.id)).speakers["0"],
      undefined,
    );
    await page
      .getByRole("button", { name: "编辑发言人", exact: true })
      .first()
      .click();
    speakers = page.getByRole("dialog", { name: "编辑发言人", exact: true });
    await speakers.getByPlaceholder("填写姓名").first().fill("验收发言人");
    await speakers
      .getByRole("button", { name: "删除说话人 B", exact: true })
      .click();
    await speakers.getByRole("button", { name: "完成", exact: true }).click();
    await poll(() =>
      page.evaluate(async (id) => {
        const m = await window.shengye.get(id);
        return (
          m.segments.length === 1 &&
          m.speakers["0"] === "验收发言人" &&
          m.syncState === "synced"
        );
      }, m.id),
    );
    saved = await page.evaluate((id) => window.shengye.get(id), m.id);
    assert.equal(saved.speakers["1"], undefined);
    assert.equal(saved.summaryStale, true);
    let archive = JSON.parse(
      fs.readFileSync(path.join(saved.exportPath, "会议数据.json")),
    );
    assert.equal(archive.segments.length, 1);
    assert.equal(archive.speakers["0"], "验收发言人");
    assert.ok(
      !fs
        .readFileSync(path.join(saved.exportPath, "原文.md"), "utf8")
        .includes("请确认一下"),
    );
    // Summary notice is spaced, dismissible across tabs, and never clears stale data.
    await page.getByRole("button", { name: "会议纪要", exact: true }).click();
    await page.getByRole("button", { name: "关闭更新提示" }).waitFor();
    for (const size of [
      { width: 1440, height: 940 },
      { width: 1100, height: 800 },
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
        size,
      );
      await page.waitForTimeout(150);
      const notice = await page.locator(".summary-notice").boundingBox();
      const eyebrow = await page
        .locator(".summary-scroll .document-eyebrow")
        .boundingBox();
      const heading = await page.locator(".annotations-heading").boundingBox();
      const card = await page.locator(".annotation-card").first().boundingBox();
      const headerText = await page
        .locator(".annotations-heading h3")
        .boundingBox();
      assert.ok(eyebrow.y - (notice.y + notice.height) >= 23);
      assert.ok(card.y - (headerText.y + headerText.height) >= 15);
      assert.ok(Math.abs(notice.y - headerText.y) <= 2);
      assert.ok(card.y >= heading.y + heading.height);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      if (process.env.AI_MINUTES_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.AI_MINUTES_SCREENSHOT_DIR, {
          recursive: true,
        });
        await page.evaluate(
          () => (document.documentElement.dataset.theme = "light"),
        );
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(
            process.env.AI_MINUTES_SCREENSHOT_DIR,
            `summary-${size.width}-light.png`,
          ),
        });
        await page.evaluate(
          () => (document.documentElement.dataset.theme = "dark"),
        );
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(
            process.env.AI_MINUTES_SCREENSHOT_DIR,
            `summary-${size.width}-dark.png`,
          ),
        });
        await page.evaluate(
          () => (document.documentElement.dataset.theme = "light"),
        );
      }
    }
    await page.getByRole("button", { name: "关闭更新提示" }).click();
    assert.equal(await page.locator(".summary-notice").count(), 0);
    assert.equal(
      (await page.evaluate((id) => window.shengye.get(id), m.id)).summaryStale,
      true,
    );
    await page
      .getByRole("button", { name: "会议原文", exact: false })
      .first()
      .click();
    await page.getByRole("button", { name: "会议纪要", exact: true }).click();
    assert.equal(await page.locator(".summary-notice").count(), 0);
    await page
      .getByRole("button", { name: "会议原文", exact: false })
      .first()
      .click();
    // Block deletion removes its dependent quote across local and Obsidian stores.
    await page.locator(".segment").first().hover();
    await page
      .getByRole("button", { name: "删除这段原文", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除这段原文" })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    assert.equal(
      (await page.evaluate((id) => window.shengye.get(id), m.id)).segments
        .length,
      1,
    );
    await page.locator(".segment").first().hover();
    await page
      .getByRole("button", { name: "删除这段原文", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除这段原文" })
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await poll(() =>
      page.evaluate(async (id) => {
        const m = await window.shengye.get(id);
        return (
          m.segments.length === 0 &&
          m.annotations.length === 0 &&
          m.syncState === "synced"
        );
      }, m.id),
    );
    saved = await page.evaluate((id) => window.shengye.get(id), m.id);
    const local = JSON.parse(
      fs.readFileSync(path.join(nextRoot, "meetings", m.id, "meeting.json")),
    );
    archive = JSON.parse(
      fs.readFileSync(path.join(saved.exportPath, "会议数据.json")),
    );
    for (const record of [local, archive]) {
      assert.deepEqual(record.segments, []);
      assert.deepEqual(record.annotations, []);
      assert.deepEqual(record.summary.decisions[0].sourceIds, []);
    }
    assert.ok(
      !fs
        .readFileSync(path.join(saved.exportPath, "重点批注.md"), "utf8")
        .includes("验收依据"),
    );
    assert.match(
      fs.readFileSync(path.join(saved.exportPath, "纪要.md"), "utf8"),
      /请重新整理/,
    );
    assert.equal(
      fs.statSync(path.join(nextRoot, "meetings", m.id, "recording.wav")).size,
      64044,
    );
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
    assert.equal(conf.codexModel, "fixture-second");
    assert.equal(conf.codexReasoningEffort, "high");
    assert.equal(conf.shortcuts.toggleRecording, "Command+Alt+R");
    assert.equal(
      (await reopened.evaluate(() => window.shengye.speechConfig())).profiles[0]
        .hotwords,
      "最终热词，自动保存",
    );
    assert.ok(
      (await reopened.evaluate(() => window.shengye.list())).some(
        (x) => x.id === m.id,
      ),
    );
    const persisted = await reopened.evaluate(
      (id) => window.shengye.get(id),
      m.id,
    );
    assert.deepEqual(persisted.segments, []);
    assert.deepEqual(persisted.annotations, []);
    assert.equal(persisted.speakers["0"], "验收发言人");
    console.log(
      "PASS: autosave/close flush/theme, shortcut key capture/cancel/clear/duplicate rollback, fixed settings geometry, typed selection bubble, optional note, automatic audio/AI Obsidian sync, data-root migration/restart, shortcut registration, pause/resume, stop cancellation/confirmation.",
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
