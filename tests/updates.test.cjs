const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Store, wavHeader } = require("../electron/store.cjs");
const { copyMeetings, validateRoot } = require("../electron/storage.cjs");
const { syncMeeting, syncIndex } = require("../electron/obsidian.cjs");
const shortcuts = require("../electron/shortcuts.cjs");
test("root migration preflights collisions, preserves source, refuses nested destinations", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-move-"));
  try {
    const source = path.join(base, "old");
    const target = path.join(base, "new");
    const store = new Store(source);
    const m = store.create("fixture");
    copyMeetings(source, target);
    assert.ok(fs.existsSync(path.join(source, m.id, "meeting.json")));
    assert.ok(fs.existsSync(path.join(target, m.id, "meeting.json")));
    assert.throws(() => copyMeetings(source, target), /已有相同/);
    assert.throws(
      () => copyMeetings(source, path.join(source, "nested")),
      /嵌套/,
    );
    assert.throws(() => validateRoot("/project/data", "/project"), /源码/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
test("automatic Obsidian structure links live audio, preserves path through rename, and exports typed notes and AI results", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ai-minutes-vault-"));
  try {
    const store = new Store(path.join(base, "store"));
    const vault = path.join(base, "vault");
    fs.mkdirSync(vault);
    const settings = { vaultPath: vault, vaultFolder: "会议记录" };
    const m = store.create("初始会议");
    m.status = "recording";
    const wav = path.join(store.dir(m.id), "recording.wav");
    fs.writeFileSync(wav, wavHeader(0));
    m.annotations = [
      {
        id: "n",
        type: "decision",
        quote: "保留原声",
        note: "验收重点",
        startMs: 0,
        endMs: 1000,
      },
    ];
    let r = syncMeeting(m, settings, store.dir(m.id));
    assert.equal(r.audioState, "linked");
    assert.equal(
      fs.statSync(wav).ino,
      fs.statSync(path.join(r.dest, "录音.wav")).ino,
    );
    fs.appendFileSync(wav, Buffer.alloc(320));
    assert.equal(fs.statSync(path.join(r.dest, "录音.wav")).size, 364);
    assert.match(
      fs.readFileSync(path.join(r.dest, "重点批注.md"), "utf8"),
      /决策/,
    );
    const previous = r.dest;
    m.title = "修改标题";
    m.status = "completed";
    m.summary = {
      overview: "完成记录",
      topics: [],
      decisions: [{ text: "保留录音", sourceIds: [] }],
      actions: [
        {
          text: "确认界面",
          owner: "待确认",
          deadline: "待确认",
          sourceIds: [],
        },
      ],
      openQuestions: [],
      mindmap: { title: "会议", branches: [] },
    };
    r = syncMeeting(m, settings, store.dir(m.id));
    assert.equal(r.dest, previous);
    for (const file of [
      "会议.md",
      "原文.md",
      "重点批注.md",
      "纪要.md",
      "待办.md",
      "决策.md",
      "思维导图.md",
      "录音.wav",
    ])
      assert.ok(fs.existsSync(path.join(r.dest, file)));
    assert.match(
      fs.readFileSync(path.join(r.dest, "会议.md"), "utf8"),
      /^---\napp: AI Minutes/,
    );
    syncIndex([m], settings);
    assert.match(
      fs.readFileSync(path.join(vault, "会议记录", "会议索引.md"), "utf8"),
      /修改标题/,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
test("shortcut duplicate and conflict validation", () => {
  assert.throws(
    () =>
      shortcuts.validate({
        toggleRecording: "CommandOrControl+Shift+R",
        pauseRecording: "CommandOrControl+Shift+R",
      }),
    /重复/,
  );
  const calls = [];
  const mock = {
    unregisterAll() {
      calls.push("reset");
    },
    register(key, fn) {
      calls.push(key);
      return key !== "CommandOrControl+X";
    },
  };
  assert.throws(
    () =>
      shortcuts.install(
        mock,
        { toggleRecording: "CommandOrControl+X" },
        () => {},
      ),
    /占用/,
  );
  shortcuts.install(
    mock,
    { toggleRecording: "", pauseRecording: "CommandOrControl+P" },
    () => {},
  );
  assert.ok(calls.includes("CommandOrControl+P"));
});
