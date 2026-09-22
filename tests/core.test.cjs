const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, wavHeader, safeName } = require("../electron/store.cjs");
const { signedURL } = require("../electron/tencent.cjs");
const { validate, mermaid } = require("../electron/summary.cjs");
test("recording crash recovery repairs WAV length and preserves transcript and notes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shengye-test-"));
  try {
    let store = new Store(root);
    const m = store.create("会议");
    m.status = "recording";
    m.segments = [{ id: "a", text: "需要保留的原话" }];
    m.annotations = [{ quote: "原话", note: "备注" }];
    store.save(m);
    const pcm = Buffer.alloc(32000);
    fs.writeFileSync(
      path.join(store.dir(m.id), "recording.wav"),
      Buffer.concat([wavHeader(0), pcm]),
    );
    store = new Store(root);
    const recovered = store.get(m.id);
    assert.equal(recovered.status, "interrupted");
    assert.equal(recovered.durationMs, 1000);
    assert.equal(recovered.segments[0].text, "需要保留的原话");
    assert.equal(recovered.annotations[0].note, "备注");
    assert.equal(
      fs
        .readFileSync(path.join(store.dir(m.id), "recording.wav"))
        .readUInt32LE(40),
      32000,
    );
    assert.throws(() => store.dir("../secrets"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("Tencent URL uses speaker engine, carries recovery identity, never exposes SecretKey", () => {
  const u = new URL(
    signedURL(
      {
        appId: "12345",
        secretId: "id",
        secretKey: "secret-value",
        hotwords: "项目一,项目二",
      },
      "voice",
      "context",
    ),
  );
  assert.equal(
    u.searchParams.get("engine_model_type"),
    "16k_zh_en_speaker_2.0",
  );
  assert.equal(u.searchParams.get("speaker_context_id"), "context");
  assert.equal(u.searchParams.get("hotword_list"), "项目一|5,项目二|5");
  assert.ok(u.searchParams.get("signature"));
  assert.ok(!u.toString().includes("secret-value"));
});
test("summary rejects malformed output and produces inert Mermaid labels", () => {
  assert.throws(() => validate({ overview: "x" }));
  const output = mermaid({
    title: "讨论)\nclick root evil",
    branches: [{ title: "<script>", items: ["主题[1]"] }],
  });
  assert.ok(!output.includes("<script>"));
  assert.ok(output.startsWith("mindmap\n"));
  assert.equal(safeName("../会议/录音"), "..-会议-录音");
});
test("compatible API summary sends notes and validates results; secrets stay in headers", async () => {
  const http = require("node:http");
  const { generate } = require("../electron/summary.cjs");
  let request;
  const summary = {
    overview: "已决定记录原音",
    topics: [],
    decisions: [],
    actions: [],
    openQuestions: [],
    mindmap: { title: "会议", branches: [] },
  };
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      request = { path: req.url, body: b, auth: req.headers.authorization };
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(summary) } }],
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const task = generate(
      {
        title: "test",
        speakers: {},
        segments: [],
        annotations: [{ note: "人工重点" }],
        gaps: [],
      },
      {
        summaryProvider: "api",
        apiBase: `http://127.0.0.1:${server.address().port}/v1`,
        apiKey: "test-secret",
        apiModel: "test",
      },
      os.tmpdir(),
      () => {},
    );
    assert.equal((await task.promise).overview, summary.overview);
    assert.equal(request.path, "/v1/chat/completions");
    assert.equal(request.auth, "Bearer test-secret");
    assert.ok(request.body.includes("人工重点"));
    assert.ok(!request.body.includes("test-secret"));
  } finally {
    server.close();
  }
});
