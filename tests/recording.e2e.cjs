// Exercise renderer AudioContext + PCM worklet + IPC + WAV through real buttons.
// Chromium's synthetic microphone avoids accessing the user's microphone/data.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
async function poll(fn, message, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(message);
}
(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-recording-"));
  let app;
  try {
    const vault = path.join(base, "vault");
    fs.mkdirSync(vault);
    const config = { vaultPath: vault };
    if (process.env.AI_MINUTES_REAL_CLOUD || process.env.AI_MINUTES_REAL_MIC) {
      const current = JSON.parse(
        fs.readFileSync(
          path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "AI 纪要",
            "settings.json",
          ),
          "utf8",
        ),
      );
      for (const key of process.env.AI_MINUTES_REAL_CLOUD
        ? ["appId", "secretId", "secretKey"]
        : ["micId"])
        config[key] = current[key];
    }
    fs.writeFileSync(path.join(base, "settings.json"), JSON.stringify(config), {
      mode: 0o600,
    });
    const speech = path.join(base, "synthetic-speech.wav");
    if (process.env.AI_MINUTES_REAL_CLOUD) {
      execFileSync("/usr/bin/say", [
        "-v",
        "Tingting",
        "-o",
        path.join(base, "speech.aiff"),
        "现在测试会议录音。暂停以后继续说话，系统应该接着保存音频，并且继续显示文字。请记录下一个会议的时间。",
      ]);
      execFileSync("/opt/homebrew/bin/ffmpeg", [
        "-v",
        "error",
        "-i",
        path.join(base, "speech.aiff"),
        "-ar",
        "16000",
        "-ac",
        "1",
        speech,
      ]);
    }
    app = await electron.launch({
      executablePath: process.env.AI_MINUTES_EXECUTABLE,
      args: [
        ...(process.env.AI_MINUTES_EXECUTABLE
          ? []
          : [path.resolve(__dirname, "..")]),
        ...(process.env.AI_MINUTES_REAL_MIC
          ? []
          : [
              "--use-fake-device-for-media-stream",
              "--use-fake-ui-for-media-stream",
            ]),
      ],
      env: { ...process.env, AI_MINUTES_DATA_DIR: base },
    });
    const page = await app.firstWindow();
    await page.waitForSelector(".hero");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (process.env.AI_MINUTES_REAL_CLOUD) {
      const wav = fs.readFileSync(speech);
      const dataOffset = wav.indexOf(Buffer.from("data")) + 8;
      await page.evaluate(async (pcm) => {
        const bytes = Uint8Array.from(atob(pcm), (c) => c.charCodeAt(0));
        const samples = new Int16Array(bytes.buffer);
        const context = new AudioContext({ sampleRate: 16000 });
        const buffer = context.createBuffer(1, samples.length, 16000);
        buffer
          .getChannelData(0)
          .set(Float32Array.from(samples, (x) => x / 32768));
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const output = context.createMediaStreamDestination();
        source.connect(output);
        source.start();
        await context.resume();
        window.__speechSource = { context, source, output };
        navigator.mediaDevices.getUserMedia = async () => output.stream.clone();
      }, wav.subarray(dataOffset).toString("base64"));
    }
    // Log audio context state only, never actual microphone content.
    await page.evaluate(() => {
      const Original = window.AudioContext;
      window.__contexts = [];
      window.AudioContext = class extends Original {
        constructor(...args) {
          super(...args);
          window.__contexts.push(this);
        }
      };
    });
    await page
      .getByRole("button", { name: "新建会议", exact: false })
      .first()
      .click();
    await page.getByRole("button", { name: "创建会议", exact: true }).click();
    await page
      .getByRole("button", {
        name: process.env.AI_MINUTES_REAL_CLOUD ? "开始录音" : "仅录音",
        exact: true,
      })
      .click();
    await poll(
      async () =>
        (await page.evaluate(() => window.shengye.list()))[0]?.durationMs >
        (process.env.AI_MINUTES_REAL_CLOUD ? 5000 : 1000),
      "Initial audio did not arrive",
    );
    const m = (await page.evaluate(() => window.shengye.list()))[0];
    if (process.env.AI_MINUTES_REAL_CLOUD)
      await poll(
        async () =>
          (await page.evaluate((id) => window.shengye.get(id), m.id)).connection
            ?.state === "connected",
        "Initial cloud connection failed",
      );
    const wav = path.join(base, "data", "meetings", m.id, "recording.wav");
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole("button", { name: "暂停录音", exact: true }).click();
      await poll(
        async () =>
          (await page.evaluate((id) => window.shengye.get(id), m.id)).status ===
          "paused",
        "Pause did not complete",
      );
      const size = fs.statSync(wav).size;
      await page.waitForTimeout(process.env.AI_MINUTES_REAL_CLOUD ? 5000 : 650);
      assert.equal(fs.statSync(wav).size, size, "Paused WAV must stop growing");
      if (
        cycle === 1 &&
        !process.env.AI_MINUTES_REAL_CLOUD &&
        !process.env.AI_MINUTES_REAL_MIC
      ) {
        // Simulate the device/AudioContext resume hanging after suspension.
        await page.evaluate(() => {
          window.__contexts.at(-1).resume = () => new Promise(() => {});
        });
      }
      if (
        cycle === 2 &&
        !process.env.AI_MINUTES_REAL_CLOUD &&
        !process.env.AI_MINUTES_REAL_MIC
      ) {
        // resume() can also resolve without producing any PCM.
        await page.evaluate(() => {
          window.__contexts.at(-1).resume = async () => {};
        });
      }
      if (cycle === 2) {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.send("app:update", {
            type: "shortcut",
            action: "pauseRecording",
          }),
        );
      } else
        await page
          .getByRole("button", { name: "继续录音", exact: true })
          .click();
      await poll(
        () =>
          fs.statSync(wav).size >
          size + (process.env.AI_MINUTES_REAL_CLOUD ? 160000 : 16000),
        "Resume failed to write audio",
      );
      if (process.env.AI_MINUTES_REAL_CLOUD)
        await poll(
          async () =>
            (await page.evaluate((id) => window.shengye.get(id), m.id))
              .connection?.state === "connected",
          "Resumed cloud connection failed",
        );
      const state = await page.evaluate(() =>
        window.__contexts.map((c) => c.state),
      );
      console.log(
        JSON.stringify({
          cycle: cycle + 1,
          before: size,
          after: fs.statSync(wav).size,
          audioContexts: state,
        }),
      );
    }
    if (
      !process.env.AI_MINUTES_REAL_CLOUD &&
      !process.env.AI_MINUTES_REAL_MIC
    ) {
      await page.getByRole("button", { name: "暂停录音", exact: true }).click();
      await page
        .getByRole("button", { name: "继续录音", exact: true })
        .waitFor();
      await page.evaluate(() => {
        window.__contexts.at(-1).resume = async () => {};
        const original = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices,
        );
        navigator.mediaDevices.getUserMedia = async (...args) => {
          navigator.mediaDevices.getUserMedia = original;
          throw Error("Synthetic device unavailable");
        };
      });
      await page.getByRole("button", { name: "继续录音", exact: true }).click();
      await page
        .getByText(
          "麦克风未能恢复，会议保持暂停。请检查设备连接后再次继续录音。",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        (await page.evaluate((id) => window.shengye.get(id), m.id)).status,
        "paused",
      );
      const beforeRetry = fs.statSync(wav).size;
      await page.getByRole("button", { name: "继续录音", exact: true }).click();
      await poll(
        () => fs.statSync(wav).size > beforeRetry + 16000,
        "Retry after device recovery failed",
      );
    }
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page.getByRole("button", { name: "结束", exact: true }).click();
    await poll(
      async () =>
        (await page.evaluate((id) => window.shengye.get(id), m.id)).status ===
        "completed",
      "Stop failed",
    );
    if (process.env.AI_MINUTES_REAL_CLOUD) {
      const finished = await page.evaluate(
        (id) => window.shengye.get(id),
        m.id,
      );
      assert.ok(
        finished.segments.some((s) => s.startMs > 10000 && s.text.trim()),
        "No recognized speech after resuming",
      );
      console.log(
        JSON.stringify({
          cloud: "Tencent",
          segments: finished.segments.length,
          lastSegmentMs: finished.segments.at(-1)?.endMs,
        }),
      );
    }
    const bytes = fs.readFileSync(wav);
    assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    assert.ok(
      bytes.subarray(44).some((b) => b !== 0),
      "Recorded waveform should contain synthetic sound",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: microphone pipeline start/pause/resume x3, paused bytes stable, resumed PCM writes, failed-device pause and retry, finalized WAV",
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
