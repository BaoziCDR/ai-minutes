import type { AudioReview } from "./types";
const labels: Record<string, string> = {
  complete: "所请求片段已复核",
  partial: "部分片段已复核",
  unreviewed: "未复核",
  unnecessary: "未请求复核",
  cancelled: "已取消",
};
export function AudioReviewView({
  review,
  seek,
}: {
  review?: AudioReview;
  seek: (ms: number) => void;
}) {
  if (!review) return null;
  return (
    <details className="audio-review">
      <summary>录音复核 · {labels[review.state] || review.state}</summary>
      {review.error && <p>{review.error}</p>}
      <small>本次提交 {(review.uploadedMs / 60000).toFixed(1)} 分钟</small>
      {review.clips.map((c, i) => (
        <article key={i}>
          <button className="source-link" onClick={() => seek(c.startMs)}>
            {Math.floor(c.startMs / 1000)}–{Math.ceil(c.endMs / 1000)} 秒 · 回听
          </button>
          <p>{c.reason}</p>
          <dl>
            <dt>原文</dt>
            <dd>{c.original || "此处没有原文"}</dd>
            <dt>复核文本</dt>
            <dd>{c.text || c.error || "未复核"}</dd>
          </dl>
          <small>
            {c.source?.provider} · {c.source?.model}
            {c.cached ? " · 缓存" : ""}
          </small>
        </article>
      ))}
    </details>
  );
}
