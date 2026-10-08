import { useState, useEffect, useRef } from "react";
import {
  Bookmark,
  CheckSquare2,
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  X,
  Check,
  Loader2,
} from "lucide-react";
import type { Annotation, AnnotationType, Meeting } from "./types";
export const annotationKinds = [
  {
    type: "highlight" as const,
    label: "重点",
    icon: Bookmark,
    color: "#b48b3b",
  },
  {
    type: "action" as const,
    label: "待办",
    icon: CheckSquare2,
    color: "#6684b4",
  },
  {
    type: "decision" as const,
    label: "决策",
    icon: CheckCircle2,
    color: "#4b856d",
  },
  {
    type: "question" as const,
    label: "疑问",
    icon: HelpCircle,
    color: "#9975a7",
  },
];
export type TextSelection = Partial<Annotation> & {
  anchor: { x: number; y: number };
};
export function SelectionBubble({
  meetingId,
  selection,
  onUpdate,
  onClose,
  onError,
}: {
  meetingId: string;
  selection: TextSelection;
  onUpdate: (m: Meeting) => void;
  onClose: () => void;
  onError: (s: string) => void;
}) {
  const [annotation, setAnnotation] = useState<Annotation | null>(null),
    [type, setType] = useState<AnnotationType>("highlight"),
    [note, setNote] = useState(""),
    [expanded, setExpanded] = useState(false),
    [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ annotation, type, note, busy });
  state.current = { annotation, type, note, busy };
  const closeRef = useRef<() => void>(() => {});
  async function choose(t: AnnotationType) {
    if (busy) return;
    setBusy(true);
    try {
      let m: Meeting;
      if (annotation)
        m = await window.shengye.editAnnotation(
          meetingId,
          annotation.id,
          note,
          t,
        );
      else
        m = await window.shengye.annotate(meetingId, {
          ...selection,
          type: t,
          note: "",
        });
      const a = annotation
        ? m.annotations.find((x) => x.id === annotation.id)!
        : m.annotations.at(-1)!;
      setAnnotation(a);
      setType(t);
      onUpdate(m);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    const c = state.current;
    if (c.busy) return;
    if (c.annotation && c.note !== c.annotation.note) {
      setBusy(true);
      try {
        onUpdate(
          await window.shengye.editAnnotation(
            meetingId,
            c.annotation.id,
            c.note,
            c.type,
          ),
        );
      } catch (e) {
        onError((e as Error).message);
        setBusy(false);
        return;
      }
    }
    window.getSelection()?.removeAllRanges();
    onClose();
  }
  closeRef.current = () => {
    void finish();
  };
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        closeRef.current();
      }
    };
    const timer = setTimeout(
      () => document.addEventListener("pointerdown", click),
      0,
    );
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, []);
  const left = Math.max(
    16,
    Math.min(selection.anchor.x - 160, window.innerWidth - 352),
  );
  const top = Math.max(
    70,
    Math.min(
      selection.anchor.y + 9,
      window.innerHeight - (expanded ? 270 : 170),
    ),
  );
  return (
    <div
      className="selection-bubble"
      role="dialog"
      aria-label="原文标注"
      ref={ref}
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bubble-kinds" role="toolbar" aria-label="标记类型">
        {annotationKinds.map((k) => (
          <button
            key={k.type}
            aria-label={`标记为${k.label}`}
            aria-pressed={annotation?.type === k.type}
            className={annotation?.type === k.type ? "selected" : ""}
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void choose(k.type)}
            style={{ "--annotation-color": k.color } as React.CSSProperties}
          >
            <k.icon size={17} />
            <span>{k.label}</span>
          </button>
        ))}
        <button
          className="bubble-close"
          title="关闭标注气泡"
          aria-label="关闭标注气泡"
          disabled={busy}
          onClick={() => void finish()}
        >
          <X size={15} />
        </button>
      </div>
      {annotation ? (
        <div className="bubble-note">
          <div className="bubble-saved">
            <Check size={12} />
            已标记为{annotationKinds.find((k) => k.type === type)?.label}
            <span>标记已自动保存</span>
          </div>
          {expanded ? (
            <>
              <textarea
                aria-label="标注备注"
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="添加备注（可选）"
                rows={3}
              />
              <div className="bubble-note-footer">
                <span>点击外部也会保存备注</span>
                <button disabled={busy} onClick={() => void finish()}>
                  {busy ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  完成
                </button>
              </div>
            </>
          ) : (
            <button
              className="add-bubble-note"
              onClick={() => setExpanded(true)}
            >
              <MessageSquare size={14} />
              添加备注（可选）
            </button>
          )}
        </div>
      ) : (
        <p className="bubble-hint">选择一个类型，立即标记这段原文</p>
      )}
    </div>
  );
}
