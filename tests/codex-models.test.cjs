const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { listModels } = require("../electron/codex-models.cjs");
const { generate } = require("../electron/summary.cjs");
const fixture = path.join(__dirname, "fixtures", "fake-codex.cjs");
test("Codex model discovery initializes protocol, paginates and preserves effort capabilities", async () => {
  const models = await listModels(fixture);
  assert.deepEqual(
    models.map((m) => m.id),
    ["fixture-model", "fixture-second"],
  );
  assert.deepEqual(models[0].supportedReasoningEfforts, [
    "low",
    "medium",
    "high",
  ]);
  assert.equal(models[0].defaultReasoningEffort, "low");
});
test("Codex discovery reports missing executables and bounds hanging server lifetimes", async () => {
  await assert.rejects(listModels("/does-not-exist/fixture"), /无法启动/);
  let child;
  await assert.rejects(
    listModels("unused", {
      timeoutMs: 60,
      spawnProcess: () =>
        (child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"])),
    }),
    /超时/,
  );
  assert.equal(child.killed, true);
});
test("Codex generation receives selected model and medium default or explicit reasoning effort", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-model-"));
  try {
    for (const effort of [undefined, "high"]) {
      const result = await generate(
        {
          title: "合成测试",
          speakers: {},
          segments: [],
          annotations: [],
          gaps: [],
        },
        {
          codexPath: fixture,
          codexModel: "fixture-second",
          codexReasoningEffort: effort,
        },
        dir,
        () => {},
      ).promise;
      assert.equal(result.overview, "模型选择验收");
      const args = JSON.parse(
        fs.readFileSync(path.join(dir, "fixture-args.json")),
      );
      assert.equal(args[args.indexOf("--model") + 1], "fixture-second");
      assert.equal(
        args[args.indexOf("-c") + 1],
        `model_reasoning_effort="${effort || "medium"}"`,
      );
      assert.ok(args.includes('default_permissions="meeting-read"'));
      assert.ok(!args.includes("--sandbox"));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
