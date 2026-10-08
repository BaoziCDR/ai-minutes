// Opt-in only: short bundled synthetic audio, isolated data/vault, encrypted
// credentials copied from the installed app without logging plaintext.
if (process.env.AI_MINUTES_LIVE_CHECK !== "1") process.exit(0);
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ai-minutes-suppliers-live-"),
  );
  let app;
  try {
    const appData = path.join(
      os.homedir(),
      "Library/Application Support/AI 纪要",
    );
    const previous = JSON.parse(
      fs.readFileSync(path.join(appData, "settings.json"), "utf8"),
    );
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    const config = { vaultPath: vault };
    for (const key of ["appId", "secretId", "secretKey"])
      if (previous[key]) config[key] = previous[key];
    fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify(config), {
      mode: 0o600,
    });
    const providers = path.join(appData, "speech-providers.json");
    if (fs.existsSync(providers))
      fs.copyFileSync(providers, path.join(root, "speech-providers.json"));
    app = await electron.launch({
      executablePath:
        process.env.AI_MINUTES_EXECUTABLE ||
        path.resolve("release/mac-arm64/AI 纪要.app/Contents/MacOS/AI 纪要"),
      args: [],
      env: { ...process.env, AI_MINUTES_DATA_DIR: root },
    });
    const page = await app.firstWindow();
    await page.waitForSelector(".hero");
    let speech = await page.evaluate(() => window.shengye.speechConfig());
    const connection = speech.connections.find(
      (c) => c.type === "tencent" && c.secretKeyConfigured,
    );
    assert.ok(connection, "Tencent credentials must migrate");
    const realtime = speech.profiles.find(
      (p) => p.connectionId === connection.id && p.kind === "tencent-realtime",
    );
    const result = await page.evaluate((b) => window.shengye.speechTest(b), {
      connectionId: connection.id,
      profileId: realtime.id,
      mode: "realtime",
    });
    console.log(
      JSON.stringify({ realtime: result.ok, observed: result.observed }),
    );
    speech = await page.evaluate(
      (id) =>
        window.shengye.speechMutate({
          op: "profile",
          connectionId: id,
          patch: {
            kind: "tencent-file",
            model: "16k_zh_en_2.0",
            name: "合成异步测试",
          },
        }),
      connection.id,
    );
    const file = speech.profiles.at(-1);
    const after = await page.evaluate((b) => window.shengye.speechTest(b), {
      connectionId: connection.id,
      profileId: file.id,
      mode: "after",
    });
    console.log(
      JSON.stringify({ asynchronousFile: after.ok, observed: after.observed }),
    );
    const current = JSON.parse(
      fs.readFileSync(path.join(root, "settings.json"), "utf8"),
    );
    assert.ok(!current.secretKey);
    console.log(
      "PASS: packaged app encrypted migration, Tencent realtime and native asynchronous synthetic-audio requests.",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
