const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { SpeechRegistry } = require("../electron/speech/registry.cjs");
const { SpeechRuntime } = require("../electron/speech/runtime.cjs");
const { SpeechTasks } = require("../electron/speech/tasks.cjs");
const { Store, wavHeader } = require("../electron/store.cjs");
const audio = require("../electron/speech/audio.cjs");
const { reviewSummary, reviewRanges } = require("../electron/review.cjs");
const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).map((b) => b ^ 91),
  decryptString: (b) =>
    Buffer.from(b)
      .map((x) => x ^ 91)
      .toString(),
};
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-speech-"));
  const registry = new SpeechRegistry(
    path.join(root, "providers.json"),
    secure,
    {
      appId: "12345678",
      secretId: "fixture-id",
      secretKey: "fixture-secret",
      hotwords: "热词",
    },
  );
  const store = new Store(path.join(root, "meetings"));
  return {
    root,
    registry,
    store,
    clean: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function compatible(registry, kind = "openai-transcription") {
  let c = registry
    .mutate({
      op: "connection",
      patch: {
        type: "compatible",
        name: "测试语音",
        baseUrl: "http://127.0.0.1:8888/v1",
        apiKey: "independent-test-key",
      },
    })
    .connections.at(-1);
  const p = registry
    .mutate({
      op: "profile",
      connectionId: c.id,
      patch: { kind, model: "voice-fixture" },
    })
    .profiles.at(-1);
  return { connectionId: c.id, profileId: p.id, mode: "after" };
}
function recording(store, seconds = 3) {
  const m = store.create("合成测试");
  m.status = "completed";
  m.durationMs = seconds * 1000;
  m.segments = [
    {
      id: "s1",
      text: "金额十元",
      startMs: 0,
      endMs: m.durationMs,
      speaker: "0",
      final: true,
    },
  ];
  store.save(m);
  const file = path.join(store.dir(m.id), "recording.wav");
  fs.writeFileSync(
    file,
    Buffer.concat([wavHeader(seconds * 32000), Buffer.alloc(seconds * 32000)]),
  );
  return m;
}
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
async function collect(stream) {
  const events = [];
  for await (const e of stream) events.push(e);
  return events;
}
test("speech registry migrates once, encrypts secrets, snapshots config and protects references", () => {
  const x = setup();
  try {
    const state = x.registry.public();
    assert.equal(state.connections.length, 1);
    assert.ok(!JSON.stringify(state).includes("fixture-secret"));
    assert.ok(
      !fs
        .readFileSync(path.join(x.root, "providers.json"), "utf8")
        .includes("fixture-secret"),
    );
    const again = new SpeechRegistry(
      path.join(x.root, "providers.json"),
      secure,
      {},
    );
    assert.equal(again.public().connections.length, 1);
    const frozen = again.resolve(state.bindings.meeting);
    again.mutate({
      op: "connection",
      id: "legacy-tencent",
      patch: { secretKey: "new-key" },
    });
    assert.equal(frozen.connection.secretKey, "fixture-secret");
    assert.throws(
      () =>
        again.mutate({
          op: "delete",
          entity: "connection",
          id: "legacy-tencent",
        }),
      /引用/,
    );
    assert.throws(
      () =>
        again.mutate({
          op: "binding",
          role: "review",
          binding: state.bindings.meeting,
        }),
      /不同/,
    );
    const b = compatible(again);
    again.mutate({ op: "binding", role: "review", binding: b });
    assert.equal(
      again.public().profiles.at(-1).capabilities.diarization,
      "unknown",
    );
    again.saveTask("job", again.resolve(b));
    again.mutate({
      op: "connection",
      id: b.connectionId,
      patch: { apiKey: "changed" },
    });
    assert.equal(
      again.loadTask("job").connection.apiKey,
      "independent-test-key",
    );
    assert.ok(!JSON.stringify(again.public()).includes("snapshots"));
  } finally {
    x.clean();
  }
});
test("bounded audio reads support 2-hour WAV, preserve offsets and reject symlink escape", () => {
  const x = setup();
  try {
    const root = x.store.root;
    const file = path.join(root, "long.wav");
    const bytes = 7200 * 32000;
    fs.writeFileSync(file, wavHeader(bytes));
    fs.truncateSync(file, 44 + bytes);
    assert.equal(audio.inspect(file).durationMs, 7200000);
    assert.equal(audio.clip(file, 7140000, 7200000).length, 1920044);
    assert.equal(audio.ranges(7200000).length, 120);
    assert.throws(() => audio.clip(file, -1, 100), /范围/);
    assert.throws(() => audio.clip(file, 0, 61000), /范围/);
    const outside = path.join(x.root, "outside.wav");
    fs.writeFileSync(outside, wavHeader(0));
    fs.symlinkSync(outside, path.join(root, "escape.wav"));
    assert.throws(() => audio.safeFile(root, "escape.wav"), /超出/);
  } finally {
    x.clean();
  }
});
test("compatible adapters send real audio, preserve unknown speakers and expose precise timing only when present", async () => {
  const x = setup();
  try {
    const b = compatible(x.registry);
    let body;
    const runtime = new SpeechRuntime(x.registry, {
      fetchFn: async (url, req) => {
        assert.equal(req.headers.Authorization, "Bearer independent-test-key");
        body = req.body;
        return json({ text: "金额一百元" });
      },
    });
    const r = await collect(
      runtime.run({
        binding: b,
        audio: Buffer.concat([wavHeader(32000), Buffer.alloc(32000)]),
        startMs: 2000,
        endMs: 3000,
        purpose: "review",
        scope: "scope",
      }),
    );
    assert.equal(body.get("file").size, 32044);
    const s = r.find((e) => e.type === "segments").segments[0];
    assert.equal(s.speaker, "-1");
    assert.equal(s.timing, "clip");
    assert.equal(s.startMs, 2000);
    const c = compatible(x.registry, "openai-audio");
    runtime.fetch = async (url, req) => {
      const payload = JSON.parse(req.body);
      assert.equal(payload.messages[1].content[1].input_audio.format, "wav");
      assert.equal(payload.modalities[0], "text");
      return json({ choices: [{ message: { content: "听到一百元" } }] });
    };
    const result = await collect(
      runtime.run({
        binding: c,
        audio: Buffer.concat([wavHeader(32000), Buffer.alloc(32000)]),
        startMs: 0,
        endMs: 1000,
        purpose: "review",
      }),
    );
    assert.equal(result.find((e) => e.type === "evidence").text, "听到一百元");
  } finally {
    x.clean();
  }
});
test("Tencent asynchronous jobs checkpoint before upload, poll, resume without resubmitting and namespace speakers", async () => {
  const x = setup();
  try {
    const p = x.registry
      .mutate({
        op: "profile",
        connectionId: "legacy-tencent",
        patch: { kind: "tencent-file", model: "16k_zh_en_2.0" },
      })
      .profiles.at(-1);
    const b = {
      connectionId: "legacy-tencent",
      profileId: p.id,
      mode: "after",
    };
    let submitted = 0,
      polled = 0;
    const runtime = new SpeechRuntime(x.registry, {
      pollMs: 1,
      fetchFn: async (url, req) => {
        if (req.headers["X-TC-Action"] === "CreateRecTask") {
          submitted++;
          return json({ Response: { Data: { TaskId: 123 } } });
        }
        polled++;
        return json({
          Response: {
            Data:
              polled < 3
                ? { Status: polled - 1 }
                : {
                    Status: 2,
                    ResultDetail: [
                      {
                        FinalSentence: "测试",
                        StartMs: 0,
                        EndMs: 1000,
                        SpeakerId: 0,
                      },
                    ],
                  },
          },
        });
      },
    });
    const events = await collect(
      runtime.run({
        binding: b,
        audio: Buffer.concat([wavHeader(32000), Buffer.alloc(32000)]),
        startMs: 60000,
        endMs: 61000,
        scope: "chunk-1",
      }),
    );
    assert.equal(submitted, 1);
    assert.deepEqual(
      events.filter((e) => e.type === "status").map((e) => e.state),
      ["preparing", "uploading", "queued", "processing"],
    );
    const remote = events.filter((e) => e.type === "checkpoint").at(-1).remote;
    const resumed = await collect(
      runtime.run({
        binding: b,
        remote,
        startMs: 60000,
        endMs: 61000,
        scope: "chunk-1",
      }),
    );
    assert.equal(submitted, 1);
    assert.equal(
      resumed.find((e) => e.type === "segments").segments[0].speaker,
      "chunk-1:0",
    );
    await assert.rejects(
      collect(
        runtime.run({
          binding: b,
          remote: {
            submission: "uncertain",
            createdAt: new Date().toISOString(),
          },
        }),
      ),
      /不确定/,
    );
    assert.equal(submitted, 1);
  } finally {
    x.clean();
  }
});
test("file tasks preserve edited original and annotations, failed tasks do not erase content", async () => {
  const x = setup();
  try {
    const b = compatible(x.registry);
    const m = recording(x.store);
    m.segments[0].edited = true;
    m.annotations = [
      { id: "note", quote: "十元", note: "核对", startMs: 0, endMs: 1000 },
    ];
    x.store.save(m);
    const runtime = new SpeechRuntime(x.registry, {
      fetchFn: async () => json({ text: "一百元" }),
    });
    const tasks = new SpeechTasks(x.store, x.registry, runtime, () => {});
    await tasks.start(m.id, b);
    await tasks.running.get(m.id).promise;
    assert.equal(m.segments[0].text, "金额十元");
    assert.equal(m.annotations.length, 1);
    assert.equal(m.pendingTranscript.segments[0].text, "一百元");
    assert.equal(m.speechTask.state, "completed");
    runtime.fetch = async () => new Response("", { status: 401 });
    await tasks.start(m.id, b);
    await tasks.running.get(m.id).promise;
    assert.equal(m.speechTask.state, "failed");
    assert.equal(m.segments[0].text, "金额十元");
  } finally {
    x.clean();
  }
});
test("review requests merge safely, independent evidence is cached and failure never calls Tencent", async () => {
  const x = setup();
  try {
    assert.deepEqual(
      reviewRanges(
        [
          { startMs: -1, endMs: 10 },
          { startMs: 1000, endMs: 2000, reason: "a", sourceIds: [] },
          { startMs: 3000, endMs: 4000, reason: "b", sourceIds: [] },
        ],
        10000,
      ).map((r) => [r.startMs, r.endMs]),
      [[0, 7000]],
    );
    const b = compatible(x.registry);
    x.registry.mutate({ op: "binding", role: "review", binding: b });
    const m = recording(x.store);
    let calls = 0;
    const runtime = new SpeechRuntime(x.registry, {
      fetchFn: async (url) => {
        assert.ok(url.includes("/audio/transcriptions"));
        calls++;
        return json({ text: "金额一百元" });
      },
    });
    const settings = {
      codexPath: path.join(__dirname, "fixtures", "fake-codex.cjs"),
      codexModel: "fixture-second",
      codexReasoningEffort: "medium",
    };
    const result = await reviewSummary(
      m,
      settings,
      x.store.dir(m.id),
      x.registry,
      runtime,
      () => {},
    ).promise;
    assert.equal(result.audioReview.state, "complete");
    assert.ok(result.openQuestions.some((q) => q.includes("差异")));
    assert.equal(m.segments[0].text, "金额十元");
    assert.equal(calls, 1);
    const again = await reviewSummary(
      m,
      settings,
      x.store.dir(m.id),
      x.registry,
      runtime,
      () => {},
    ).promise;
    assert.equal(calls, 1);
    assert.equal(again.audioReview.clips[0].cached, true);
    x.registry.mutate({
      op: "profile",
      id: b.profileId,
      patch: { model: "other-model" },
    });
    runtime.fetch = async () => {
      calls++;
      return new Response("", { status: 401 });
    };
    const failed = await reviewSummary(
      m,
      settings,
      x.store.dir(m.id),
      x.registry,
      runtime,
      () => {},
    ).promise;
    assert.equal(failed.audioReview.state, "unreviewed");
    assert.equal(calls, 2);
    const files = fs.readdirSync(path.join(x.store.dir(m.id), "ai-runs"));
    for (const id of files)
      assert.ok(
        !fs
          .readFileSync(
            path.join(x.store.dir(m.id), "ai-runs", id, "run.json"),
            "utf8",
          )
          .includes("independent-test-key"),
      );
  } finally {
    x.clean();
  }
});
test("realtime adapter uses frozen configuration, emits segments and terminates cleanly", async () => {
  const x = setup();
  try {
    const { Queue } = require("../electron/speech/runtime.cjs");
    const binding = x.registry.public().bindings.meeting;
    const resolved = x.registry.resolve(binding);
    let config,
      packets = 0;
    const runtime = new SpeechRuntime(x.registry, {
      streamFactory: (c) => {
        config = c;
        const stream = new EventEmitter();
        stream.connect = (offset) => {
          stream.ready = true;
          stream.offset = offset;
        };
        stream.send = (buf) => {
          packets++;
          stream.emit("segments", [
            {
              id: "1",
              text: "测试",
              speaker: "0",
              startMs: stream.offset,
              endMs: stream.offset + 200,
              final: true,
            },
          ]);
          return true;
        };
        stream.finish = () => {
          stream.contextId = "context";
          queueMicrotask(() => stream.emit("finished"));
        };
        stream.close = () => {};
        return stream;
      },
    });
    x.registry.mutate({
      op: "connection",
      id: binding.connectionId,
      patch: { secretKey: "changed" },
    });
    const input = new Queue();
    input.push({ buf: Buffer.alloc(6400), offset: 1000 });
    input.end();
    const events = await collect(
      runtime.run({ resolved, input, startMs: 1000 }),
    );
    assert.equal(packets, 1);
    assert.equal(config.secretKey, "fixture-secret");
    assert.equal(
      events.find((e) => e.type === "segments").segments[0].startMs,
      1000,
    );
    assert.equal(events.at(-1).contextId, "context");
  } finally {
    x.clean();
  }
});
test("review upload budget counts retries and cancellation stops work", async () => {
  const x = setup();
  try {
    const binding = compatible(x.registry);
    x.registry.mutate({ op: "binding", role: "review", binding });
    x.registry.mutate({ op: "budget", seconds: 60 });
    const m = recording(x.store);
    let calls = 0;
    const runtime = new SpeechRuntime(x.registry, {
      fetchFn: async () => {
        calls++;
        return new Response("", { status: 503 });
      },
    });
    const settings = {
      codexPath: path.join(__dirname, "fixtures", "fake-codex.cjs"),
      codexModel: "fixture",
    };
    const r = await reviewSummary(
      m,
      settings,
      x.store.dir(m.id),
      x.registry,
      runtime,
      () => {},
    ).promise;
    assert.equal(calls, 2);
    assert.equal(r.audioReview.uploadedMs, 6000);
    assert.equal(r.audioReview.state, "unreviewed");
    const task = reviewSummary(
      m,
      settings,
      x.store.dir(m.id),
      x.registry,
      runtime,
      () => {},
    );
    task.cancel();
    await assert.rejects(task.promise);
    assert.equal(calls, 2);
  } finally {
    x.clean();
  }
});
test("restart recovery queries an existing remote task using its encrypted snapshot without creating a new job", async () => {
  const x = setup();
  try {
    const p = x.registry
      .mutate({
        op: "profile",
        connectionId: "legacy-tencent",
        patch: { kind: "tencent-file", model: "16k_zh_en_2.0" },
      })
      .profiles.at(-1);
    const binding = {
      connectionId: "legacy-tencent",
      profileId: p.id,
      mode: "after",
    };
    const m = recording(x.store);
    m.segments[0].edited = true;
    x.store.save(m);
    const resolved = x.registry.resolve(binding),
      id = "persisted-job";
    x.registry.saveTask(id, resolved);
    const task = {
      id,
      meetingId: m.id,
      binding,
      source: { model: resolved.profile.model, revision: resolved.revision },
      state: "queued",
      createdAt: new Date().toISOString(),
      inputFingerprint: JSON.stringify([m.segments, m.speakers, m.annotations]),
      audioHash: await audio.hashFile(
        path.join(x.store.dir(m.id), "recording.wav"),
      ),
      chunks: [
        {
          index: 0,
          startMs: 0,
          endMs: 3000,
          state: "queued",
          segments: [],
          remote: {
            taskId: "999",
            submission: "confirmed",
            createdAt: new Date().toISOString(),
          },
        },
      ],
    };
    fs.writeFileSync(
      path.join(x.store.dir(m.id), "speech-task.json"),
      JSON.stringify(task),
    );
    m.speechTask = { state: "queued" };
    x.store.save(m);
    let creates = 0,
      queries = 0;
    const runtime = new SpeechRuntime(x.registry, {
      fetchFn: async (u, req) => {
        if (req.headers["X-TC-Action"] === "CreateRecTask") creates++;
        else queries++;
        return json({ Response: { Data: { Status: 2, Result: "新的原文" } } });
      },
    });
    const tasks = new SpeechTasks(x.store, x.registry, runtime, () => {});
    assert.equal(m.speechTask.state, "interrupted");
    assert.equal(queries, 0);
    await tasks.start(m.id, null, { resume: true });
    await tasks.running.get(m.id).promise;
    assert.equal(creates, 0);
    assert.equal(queries, 1);
    assert.equal(m.pendingTranscript.segments[0].text, "新的原文");
    assert.equal(m.segments[0].text, "金额十元");
  } finally {
    x.clean();
  }
});
test("review independence is checked against actual meeting provenance after default provider changes", async () => {
  const x = setup();
  try {
    const binding = compatible(x.registry);
    x.registry.mutate({ op: "binding", role: "review", binding });
    const m = recording(x.store);
    m.transcriptionSource = {
      connectionId: binding.connectionId,
      kind: "openai-transcription",
      model: "voice-fixture",
    };
    let calls = 0;
    const runtime = new SpeechRuntime(x.registry, {
      fetchFn: async () => {
        calls++;
        return json({ text: "ignored" });
      },
    });
    const result = await reviewSummary(
      m,
      { codexPath: path.join(__dirname, "fixtures", "fake-codex.cjs") },
      x.store.dir(m.id),
      x.registry,
      runtime,
      () => {},
    ).promise;
    assert.equal(calls, 0);
    assert.equal(result.audioReview.state, "unreviewed");
    assert.match(result.audioReview.error, /实际转写模型相同/);
  } finally {
    x.clean();
  }
});
