const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const http = require("node:http");
async function poll(fn) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Expected provider state not reached");
}
(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ai-minutes-providers-ui-"),
  );
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  fs.writeFileSync(
    path.join(root, "settings.json"),
    JSON.stringify({
      vaultPath: vault,
      codexPath: path.join(__dirname, "fixtures/fake-codex.cjs"),
    }),
  );
  const calls = [];
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on("data", (x) => chunks.push(x));
    req.on("end", () => {
      const bytes = Buffer.concat(chunks);
      calls.push({ auth: req.headers.authorization, body: bytes });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: bytes.includes(Buffer.from("review-model"))
            ? "金额一百元"
            : "金额十元",
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let app;
  try {
    app = await electron.launch({
      args: [
        path.resolve(__dirname, ".."),
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      env: { ...process.env, AI_MINUTES_DATA_DIR: root },
    });
    const page = await app.firstWindow();
    await page.waitForSelector(".hero");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "设置与连接", exact: true }).click();
    await page.getByRole("button", { name: "兼容 API", exact: true }).click();
    await poll(() =>
      page
        .getByLabel("配置名称", { exact: true })
        .inputValue()
        .then((v) => v === "新供应商"),
    );
    const edit = async (label, value, scope = page) => {
      const input = scope.getByLabel(label, { exact: true });
      await input.fill(value);
      await input.press("Tab");
    };
    await edit("配置名称", "独立语音测试");
    await edit("服务地址", `http://127.0.0.1:${server.address().port}/v1`);
    await edit("apiKey", "fixture-ui-secret");
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    await poll(
      async () => (await page.locator(".supplier-model").count()) === 1,
    );
    await edit("模型名称", "会后模型");
    await edit("模型 ID", "batch-model");
    await poll(async () =>
      (await page.evaluate(() => window.shengye.speechConfig())).profiles.some(
        (p) => p.model === "batch-model",
      ),
    );
    const config = await page.evaluate(() => window.shengye.speechConfig());
    const batch = config.profiles.find((p) => p.model === "batch-model");
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "会议转写", exact: true })
      .click();
    await page
      .getByLabel("会议转写模型", { exact: true })
      .selectOption(batch.id);
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.speechConfig())).bindings
          .meeting?.profileId === batch.id,
    );
    assert.equal(
      await page.getByLabel("转写模式", { exact: true }).inputValue(),
      "after",
    );
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "语音供应商", exact: true })
      .click();
    await page
      .getByLabel("供应商配置", { exact: true })
      .selectOption(batch.connectionId);
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    await poll(
      async () => (await page.locator(".supplier-model").count()) === 2,
    );
    await edit("模型名称", "复核模型", page.locator(".supplier-model").nth(1));
    await edit(
      "模型 ID",
      "review-model",
      page.locator(".supplier-model").nth(1),
    );
    await poll(async () =>
      (await page.evaluate(() => window.shengye.speechConfig())).profiles.some(
        (p) => p.model === "review-model",
      ),
    );
    const review = (
      await page.evaluate(() => window.shengye.speechConfig())
    ).profiles.find((p) => p.model === "review-model");
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: "录音复核", exact: true })
      .click();
    await page
      .getByLabel("独立复核模型", { exact: true })
      .selectOption(review.id);
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.speechConfig())).bindings
          .review?.profileId === review.id,
    );
    assert.equal(
      await page
        .getByLabel("独立复核模型")
        .locator(`option[value="${batch.id}"]`)
        .evaluate((el) => el.disabled),
      true,
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("button", { name: "新建会议", exact: false })
      .first()
      .click();
    await page.getByRole("button", { name: "创建会议", exact: true }).click();
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.list()))[0]?.durationMs >
        2000,
    );
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page.getByRole("button", { name: "结束", exact: true }).click();
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.list()))[0]?.speechTask
          ?.state === "completed",
    );
    const meeting = (await page.evaluate(() => window.shengye.list()))[0];
    assert.equal(meeting.segments[0].text, "金额十元");
    assert.equal(meeting.segments[0].speaker, "-1");
    assert.equal(meeting.segments[0].timing, "clip");
    await page.getByText("未区分说话人", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "生成纪要", exact: true }).click();
    await poll(async () => {
      const m = await page.evaluate((id) => window.shengye.get(id), meeting.id);
      if (m.summaryStatus === "failed") throw Error(m.summaryError);
      return m.summaryStatus === "completed" && m.syncState === "synced";
    });
    const saved = await page.evaluate(
      (id) => window.shengye.get(id),
      meeting.id,
    );
    assert.equal(saved.summary.audioReview.state, "complete");
    assert.equal(saved.summary.audioReview.clips[0].text, "金额一百元");
    assert.equal(saved.segments[0].text, "金额十元");
    await page.getByRole("button", { name: "会议纪要", exact: true }).click();
    await page.locator(".audio-review summary").click();
    await page.getByText("金额一百元", { exact: true }).waitFor();
    assert.ok(
      fs
        .readFileSync(path.join(saved.exportPath, "录音复核.md"), "utf8")
        .includes("金额一百元"),
    );
    assert.equal(calls.length, 2);
    assert.ok(
      calls.every(
        (c) =>
          c.auth === "Bearer fixture-ui-secret" &&
          c.body.includes(Buffer.from("RIFF")),
      ),
    );
    assert.ok(
      !fs
        .readFileSync(path.join(root, "speech-providers.json"), "utf8")
        .includes("fixture-ui-secret"),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: provider settings autosave, shared credentials, capability-filtered bindings, recording → automatic file transcription → independent review → Obsidian evidence; original preserved.",
    );
  } finally {
    if (app) await app.close();
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
