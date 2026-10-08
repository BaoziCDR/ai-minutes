// Apply one user edit before saving/publishing, so observers never see a half-edited meeting.
function removeSegments(m, ids) {
  const removed = new Set(ids);
  m.segments = m.segments.filter((s) => !removed.has(s.id));
  // A quote spanning a removed block is no longer a valid quotation.
  m.annotations = m.annotations.filter(
    (a) => !(a.segmentIds || []).some((id) => removed.has(id)),
  );
  m.deletedSegmentIds = [...new Set([...(m.deletedSegmentIds || []), ...ids])];
  m.transcriptEdited = true;
  m.summaryStale = !!m.summary;
  for (const item of [
    ...(m.summary?.topics || []),
    ...(m.summary?.decisions || []),
    ...(m.summary?.actions || []),
  ]) {
    item.sourceIds = (item.sourceIds || []).filter((id) => !removed.has(id));
  }
}
function deleteSegment(m, id) {
  if (!m.segments.some((s) => s.id === id)) throw Error("未找到原文片段");
  removeSegments(m, [id]);
  return m;
}
function editSpeakers(m, changes) {
  if (!Array.isArray(changes)) throw Error("无效发言人修改");
  const existing = new Set([
    ...Object.keys(m.speakers),
    ...m.segments.map((s) => s.speaker),
  ]);
  const seen = new Set();
  // Validate the entire batch before mutating anything.
  for (const c of changes) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !existing.has(c.id) ||
      seen.has(c.id) ||
      typeof c.deleted !== "boolean" ||
      typeof c.name !== "string"
    )
      throw Error("发言人已变化，请重新打开编辑");
    seen.add(c.id);
  }
  const deleted = new Set(changes.filter((c) => c.deleted).map((c) => c.id));
  const ids = m.segments.filter((s) => deleted.has(s.speaker)).map((s) => s.id);
  if (deleted.size) {
    removeSegments(m, ids);
    m.deletedSpeakerIds = [
      ...new Set([...(m.deletedSpeakerIds || []), ...deleted]),
    ];
  }
  for (const c of changes) {
    if (c.deleted) delete m.speakers[c.id];
    else m.speakers[c.id] = c.name.trim();
  }
  m.transcriptEdited = true;
  m.summaryStale = !!m.summary;
  return m;
}
module.exports = { deleteSegment, editSpeakers };
