const { reviewMarkdown } = require("./review.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { atomic, safeName, clock, notes } = require("./store.cjs");
const { mermaid, summaryMarkdown } = require("./summary.cjs");
function write(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function frontmatter(m, kind) {
  return `---\napp: AI Minutes\ntype: ${kind}\nmeeting_id: ${JSON.stringify(m.id)}\ntitle: ${JSON.stringify(m.title)}\ncreated: ${JSON.stringify(m.createdAt)}\nduration_seconds: ${Math.round(m.durationMs / 1000)}\nstatus: ${m.status}\nsummary_stale: ${!!m.summaryStale}\ntags: [ai-minutes, 会议]\n---\n\n${m.summaryStale && ["summary", "mindmap", "actions", "decisions", "audio-review"].includes(kind) ? "> 原文或发言人已更新，请重新整理。\n\n" : ""}`;
}
function destination(m, settings) {
  const vault = path.resolve(settings.vaultPath || "");
  if (!settings.vaultPath || !fs.existsSync(vault))
    throw Error("Obsidian 库不存在，请在设置中选择。");
  const folder = settings.vaultFolder || "会议记录";
  if (path.isAbsolute(folder) || folder.split(/[\\/]/).includes(".."))
    throw Error("会议目录必须位于 Obsidian 库内。");
  const base = path.join(vault, folder);
  // Stable path survives meeting renames. A new vault gets its own copy.
  if (!m.vaultRelativePath)
    m.vaultRelativePath = path.join(
      m.createdAt.slice(0, 4),
      m.createdAt.slice(5, 7),
      `${m.createdAt.slice(0, 10)} ${safeName(m.title)} ${m.id.slice(0, 6)}`,
    );
  if (
    path.isAbsolute(m.vaultRelativePath) ||
    m.vaultRelativePath.split(/[\\/]/).includes("..")
  )
    throw Error("无效会议归档路径");
  return path.join(base, m.vaultRelativePath);
}
function syncMeeting(m, settings, sourceDir) {
  const dest = destination(m, settings);
  fs.mkdirSync(dest, { recursive: true });
  const audio = path.join(sourceDir, "recording.wav"),
    target = path.join(dest, "录音.wav");
  const live = ["recording", "paused", "transcribing"].includes(m.status);
  let audioState = "none";
  if (fs.existsSync(audio)) {
    const stat = fs.statSync(audio);
    let existing;
    try {
      existing = fs.statSync(target);
    } catch {}
    if (existing && stat.ino === existing.ino && stat.dev === existing.dev)
      audioState = "linked";
    else {
      // Hard links keep a live recording associated without repeatedly copying it.
      const temp = target + ".next";
      try {
        fs.linkSync(audio, temp);
        fs.renameSync(temp, target);
        audioState = "linked";
      } catch (e) {
        try {
          fs.unlinkSync(temp);
        } catch {}
        if (!live) {
          fs.copyFileSync(audio, temp);
          fs.renameSync(temp, target);
          audioState = "copied";
        } else audioState = "pending";
      }
    }
  }
  const displaySpeaker = (s) =>
    m.speakers[s] ||
    (s === "-1"
      ? "未区分说话人"
      : `说话人 ${String.fromCharCode(65 + (Number(s.split(":").at(-1)) || 0))}`);
  const body = m.segments
    .map(
      (s) =>
        `### ${s.timing === "clip" ? "片段 " : ""}${clock(s.startMs)} · ${displaySpeaker(s.speaker)}\n\n${s.text}\n\n^seg-${s.id.replace(/[^a-zA-Z0-9-]/g, "-")}\n`,
    )
    .join("\n");
  write(
    path.join(dest, "原文.md"),
    frontmatter(m, "transcript") + `# ${m.title} · 原文\n\n` + body,
  );
  write(
    path.join(dest, "重点批注.md"),
    frontmatter(m, "annotations") + "# 人工重点与备注\n\n" + notes(m),
  );
  const audioMarkdown =
    audioState === "pending"
      ? "> 录音保存在本机，结束录制后自动复制到此库。\n"
      : audioState !== "none"
        ? "![[录音.wav]]\n"
        : "> 尚未开始录音。\n";
  const counts = { highlight: 0, action: 0, decision: 0, question: 0 };
  for (const a of m.annotations) counts[a.type || "highlight"]++;
  write(
    path.join(dest, "会议.md"),
    frontmatter(m, "meeting") +
      `# ${m.title}\n\n${audioMarkdown}\n## 会议资料\n\n| 内容 | 记录 |\n|---|---|\n| 时长 | ${clock(m.durationMs)} |\n| 重点 / 待办 / 决策 / 疑问 | ${counts.highlight} / ${counts.action} / ${counts.decision} / ${counts.question} |\n\n[原文](原文.md) · [重点批注](重点批注.md)${m.summary ? " · [纪要](纪要.md) · [思维导图](思维导图.md) · [待办](待办.md) · [决策](决策.md) · [录音复核](录音复核.md)" : ""}\n\n${m.summary ? "## 核心结论\n\n" + m.summary.overview : "> AI 整理完成后，纪要和思维导图将自动出现。"}\n`,
  );
  if (m.summary) {
    const s = m.summary;
    write(
      path.join(dest, "录音复核.md"),
      frontmatter(m, "audio-review") + reviewMarkdown(s.audioReview),
    );
    write(
      path.join(dest, "纪要.md"),
      frontmatter(m, "summary") + summaryMarkdown(m),
    );
    write(
      path.join(dest, "思维导图.md"),
      frontmatter(m, "mindmap") +
        "# " +
        m.title +
        "\n\n```mermaid\n" +
        mermaid(s.mindmap) +
        "```\n",
    );
    write(
      path.join(dest, "待办.md"),
      frontmatter(m, "actions") +
        "# 待办事项\n\n" +
        (s.actions
          .map((a) => `- [ ] ${a.text} — ${a.owner} / ${a.deadline}`)
          .join("\n") || "没有明确待办。"),
    );
    write(
      path.join(dest, "决策.md"),
      frontmatter(m, "decisions") +
        "# 决策记录\n\n" +
        (s.decisions.map((a) => "- " + a.text).join("\n") || "没有明确决策。"),
    );
  }
  const exported = { ...m };
  delete exported.speakerContextId;
  atomic(path.join(dest, "会议数据.json"), exported);
  return { dest, audioState };
}
function syncIndex(meetings, settings) {
  const base = path.join(
    settings.vaultPath,
    settings.vaultFolder || "会议记录",
  );
  fs.mkdirSync(base, { recursive: true });
  const link = (m) =>
    encodeURI(path.join(m.vaultRelativePath, "会议.md"))
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
  write(
    path.join(base, "会议索引.md"),
    "---\napp: AI Minutes\ntype: meeting-index\n---\n\n# AI 纪要 · 会议索引\n\n| 日期 | 会议 | 时长 | 重点 | AI 整理 |\n|---|---|---|---|---|\n" +
      meetings
        .filter((m) => m.vaultRelativePath)
        .map(
          (m) =>
            `| ${m.createdAt.slice(0, 10)} | [${m.title.replace(/[|\[\]\n]/g, " ")}](${link(m)}) | ${clock(m.durationMs)} | ${m.annotations.length} | ${m.summaryStale ? "待重新整理" : m.summary ? "已整理" : "待整理"} |`,
        )
        .join("\n") +
      "\n",
  );
}
module.exports = { syncMeeting, syncIndex, destination };
