const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deleteSegment,
  editSpeakers,
} = require("../electron/transcript-edit.cjs");
function meeting() {
  return {
    segments: [
      { id: "a", speaker: "0" },
      { id: "b", speaker: "1" },
      { id: "c", speaker: "1" },
    ],
    speakers: { 0: "甲", 1: "乙" },
    annotations: [
      { id: "keep", segmentIds: ["a"], quote: "保留" },
      { id: "mixed", segmentIds: ["a", "b"], quote: "跨段引用" },
      { id: "gone", segmentIds: ["c"], quote: "删除" },
    ],
    summary: {
      topics: [{ sourceIds: ["a", "b"] }],
      decisions: [],
      actions: [],
    },
  };
}
test("speaker batch validates atomically, deletes all associated blocks and quotes, retains unaffected names", () => {
  const m = meeting(),
    before = structuredClone(m);
  assert.throws(() =>
    editSpeakers(m, [
      { id: "0", name: "新名字", deleted: false },
      { id: "missing", name: "", deleted: true },
    ]),
  );
  assert.deepEqual(m, before);
  editSpeakers(m, [
    { id: "0", name: " 新名字 ", deleted: false },
    { id: "1", name: "乙", deleted: true },
  ]);
  assert.deepEqual(m.segments, [{ id: "a", speaker: "0" }]);
  assert.deepEqual(m.speakers, { 0: "新名字" });
  assert.deepEqual(m.annotations, [
    { id: "keep", segmentIds: ["a"], quote: "保留" },
  ]);
  assert.deepEqual(m.summary.topics[0].sourceIds, ["a"]);
  assert.deepEqual(m.deletedSpeakerIds, ["1"]);
  assert.deepEqual(m.deletedSegmentIds, ["b", "c"]);
  assert.equal(m.summaryStale, true);
  assert.equal(m.transcriptEdited, true);
});
test("single block deletion supports unidentified speakers, retains other blocks and rejects stale IDs", () => {
  const m = meeting();
  m.segments[1].speaker = "-1";
  deleteSegment(m, "b");
  assert.deepEqual(
    m.segments.map((s) => s.id),
    ["a", "c"],
  );
  assert.deepEqual(
    m.annotations.map((a) => a.id),
    ["keep", "gone"],
  );
  const before = structuredClone(m);
  assert.throws(() => deleteSegment(m, "missing"));
  assert.deepEqual(m, before);
});
