import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  AudioLines,
  Plus,
  Search,
  Settings as SettingsIcon,
  FolderOpen,
  ArrowUpRight,
  Mic,
  Upload,
  Clock,
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  Star,
  Bookmark,
  FileText,
  Network,
  Play,
  Pause,
  Square,
  SkipBack,
  Volume2,
  Download,
  Sparkles,
  Check,
  CheckCircle2,
  X,
  Loader2,
  Trash2,
  MessageSquare,
  Send,
  Users,
  PenLine,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  HardDrive,
  KeyRound,
  ExternalLink,
  Folder,
  Copy,
  Headphones,
  Command,
  ChevronDown,
  Link,
  RotateCcw,
  Radio,
  Sun,
  Moon,
  Monitor,
  CheckCheck,
  Keyboard,
} from "lucide-react";
import type { Meeting, Segment, Annotation, Settings, Summary } from "./types";
import {
  SelectionBubble,
  annotationKinds,
  type TextSelection,
} from "./SelectionBubble";
import { Recorder } from "./recorder";
import "./styles.css";
const api = window.shengye;
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
};
const date = (s: string) =>
  new Date(s).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
const palette = [
  "#467b6d",
  "#bd8a49",
  "#7284ac",
  "#aa7393",
  "#6d91a0",
  "#999454",
];
function label(m: Meeting, s: string) {
  return (
    m.speakers[s] ||
    (s === "-1"
      ? "待确认"
      : `说话人 ${String.fromCharCode(65 + (Number(s.split(":").at(-1)) || 0))}`)
  );
}
function color(s: string) {
  return palette[Math.abs(Number(s.split(":").at(-1)) || 0) % palette.length];
}
function status(m: Meeting) {
  if (m.summaryStatus === "running") return "正在整理";
  return (
    (
      {
        ready: "待开始",
        recording: "录制中",
        paused: "已暂停",
        completed: m.summary ? "已整理" : "待整理",
        interrupted: "已恢复",
        transcribing: "转写中",
      } as Record<string, string>
    )[m.status] || "已保存"
  );
}
function IconButton({
  children,
  title,
  onClick,
  disabled = false,
  className = "",
}: React.PropsWithChildren<{
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <button
      className={"icon-btn " + className}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: React.PropsWithChildren<{
  title: string;
  onClose: () => void;
  wide?: boolean;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const el = ref.current;
    el?.querySelector<HTMLElement>("input,textarea,button")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,[tabindex="0"]',
          ),
        );
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton title="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [page, setPage] = useState("all"),
    [settings, setSettings] = useState<Settings | null>(null),
    [showSettings, setShowSettings] = useState(false),
    [newOpen, setNewOpen] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [query, setQuery] = useState(""),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Record<string, string>>({});
  const recorder = useRef<Recorder | null>(null);
  const [level, setLevel] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 4000);
  }, []);
  const upsert = useCallback(
    (m: Meeting) =>
      setMeetings((ms) =>
        [m, ...ms.filter((x) => x.id !== m.id)].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      ),
    [],
  );
  useEffect(() => {
    if (!api) return;
    Promise.all([api.list(), api.settings()])
      .then(([m, s]) => {
        setMeetings(m);
        setSettings(s);
      })
      .catch((e) => notify(e.message, true));
    return api.onUpdate((d) => {
      if (d.type === "meeting") upsert(d.meeting);
      if (d.type === "summaryProgress")
        setProgress((p) => ({ ...p, [d.id]: d.message }));
      if (d.type === "transcribeProgress")
        setProgress((p) => ({
          ...p,
          [d.id]: `重新转写 ${Math.round(d.progress * 100)}% · 按原速处理`,
        }));
    });
  }, []);
  useEffect(() => {
    const theme = settings?.theme || "light";
    document.documentElement.dataset.theme =
      theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
  }, [settings?.theme]);
  const perform = async <T,>(
    fn: () => Promise<T>,
    success?: string,
  ): Promise<T | undefined> => {
    try {
      const v = await fn();
      if (success) notify(success);
      return v;
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const current = meetings.find((m) => m.id === selected);
  const active = meetings.find((m) =>
    ["recording", "paused", "transcribing"].includes(m.status),
  );
  const makeNew = async () => {
    const m = await perform(() =>
      api.create(newTitle || `${date(new Date().toISOString())}的会议`),
    );
    if (m) {
      upsert(m);
      setSelected(m.id);
      setNewOpen(false);
      setNewTitle("");
    }
  };
  const start = async (m: Meeting, offline = false) => {
    setBusy(true);
    const r = new Recorder();
    r.onLevel = setLevel;
    r.onDeviceError = () => {
      notify("麦克风已断开，正在保存录音。请重新选择设备。", true);
      void r.close().then(() => api.stop());
    };
    try {
      await r.prepare(settings?.micId || "");
      await api.start(m.id, offline);
      recorder.current = r;
      await r.start();
    } catch (e) {
      await r.close();
      await api.stop().catch(() => {});
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const control = async (action: "pause" | "resume" | "stop") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "stop" && !(await api.confirmStop())) return;
      if (action === "pause") {
        await recorder.current?.pause();
        await api.pause();
      } else if (action === "resume") {
        await api.resume();
        await recorder.current?.resume();
      } else {
        await recorder.current?.close();
        recorder.current = null;
        await api.stop();
        notify("录音与转写已保存");
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const importAudio = async () => {
    setBusy(true);
    const m = await perform(() => api.importAudio());
    if (m) {
      upsert(m);
      setSelected(m.id);
      notify("录音已导入，可以播放或开始转写");
    }
    setBusy(false);
  };
  const shortcutHandler = useRef<(action: string) => void>(() => {});
  shortcutHandler.current = (action) => {
    if (busy || showSettings) return;
    if (action === "newMeeting") {
      setNewOpen(true);
      return;
    }
    if (action === "pauseRecording") {
      if (active && ["recording", "paused"].includes(active.status))
        void control(active.status === "paused" ? "resume" : "pause");
      else notify("当前没有正在录制的会议");
      return;
    }
    if (action === "toggleRecording") {
      if (active) {
        setSelected(active.id);
        void control("stop");
      } else if (current && current.status === "ready") void start(current);
      else
        void perform(async () => {
          const m = await api.create(`${date(new Date().toISOString())}的会议`);
          upsert(m);
          setSelected(m.id);
          await start(m);
        });
    }
  };
  useEffect(
    () =>
      api.onUpdate((d) => {
        if (d.type === "shortcut") shortcutHandler.current(d.action);
        if (d.type === "notice") notify(d.message, true);
      }),
    [],
  );
  const showMeetings = meetings.filter(
    (m) =>
      (page !== "favorites" || m.favorite) &&
      (page !== "notes" || m.annotations.length > 0) &&
      (!query ||
        [
          m.title,
          ...m.segments.map((s) => s.text),
          ...m.annotations.map((a) => a.note),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  if (!api)
    return (
      <div className="browser-notice">
        <AudioLines size={48} />
        <h1>AI 纪要</h1>
        <p>请在AI 纪要桌面 App 中打开，以使用本地录音、安全设置和 Codex。</p>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={24} />
          </span>
          <div>
            <strong>AI 纪要</strong>
            <small>AI MINUTES</small>
          </div>
        </div>
        <button className="new-meeting" onClick={() => setNewOpen(true)}>
          <Plus size={18} />
          新建会议
          <span>
            {settings?.shortcuts?.newMeeting
              ?.replace("CommandOrControl", "⌘")
              .replace("Alt", "⌥")
              .replace(/\+/g, " ")}
          </span>
        </button>
        <nav>
          <button
            className={!selected && page === "all" ? "active" : ""}
            onClick={() => {
              setSelected(null);
              setPage("all");
            }}
          >
            <Folder size={18} />
            全部会议<span>{meetings.length}</span>
          </button>
          <button
            className={!selected && page === "favorites" ? "active" : ""}
            onClick={() => {
              setSelected(null);
              setPage("favorites");
            }}
          >
            <Star size={18} />
            收藏会议
            <span>{meetings.filter((m) => m.favorite).length || ""}</span>
          </button>
          <button
            className={!selected && page === "notes" ? "active" : ""}
            onClick={() => {
              setSelected(null);
              setPage("notes");
            }}
          >
            <Bookmark size={18} />
            我的重点
            <span>
              {meetings.reduce((n, m) => n + m.annotations.length, 0) || ""}
            </span>
          </button>
        </nav>
        <div className="sidebar-label">最近会议</div>
        <div className="recent-list">
          {meetings.slice(0, 8).map((m) => (
            <button
              key={m.id}
              className={selected === m.id ? "selected" : ""}
              onClick={() => setSelected(m.id)}
            >
              <span
                className={
                  "recent-dot " +
                  (["recording", "transcribing"].includes(m.status)
                    ? "live"
                    : "")
                }
              />
              <span>{m.title}</span>
            </button>
          ))}
          {!meetings.length && (
            <p className="sidebar-empty">你的讨论，将从这里开始留存。</p>
          )}
        </div>
        {active && (
          <button
            className="active-recording"
            onClick={() => setSelected(active.id)}
          >
            <Radio size={18} />
            <span>
              {status(active)}
              <small>{fmt(active.durationMs)}</small>
            </span>
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="local-label">
            <span className="status-dot" />
            本地保存 · 数据由你掌握
          </div>
          <button
            className="settings-button"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon size={18} />
            设置与连接
            <ChevronRight size={16} />
          </button>
          <div className="sidebar-footer">
            <span>AI 纪要 1.0</span>
            <span>让讨论留下回响</span>
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>
              {current
                ? current.title
                : page === "favorites"
                  ? "收藏会议"
                  : page === "notes"
                    ? "我的重点"
                    : "全部会议"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="cloud-label">
              <ShieldCheck size={14} />
              本地资料库
            </span>
            <button
              className="avatar"
              onClick={() => setShowSettings(true)}
              title="打开设置"
            >
              J
            </button>
          </div>
        </header>
        {current ? (
          <Workspace
            key={current.id}
            m={current}
            busy={busy}
            activeId={active?.id}
            level={level}
            settings={settings}
            progress={progress[current.id]}
            onStart={start}
            onControl={control}
            upsert={upsert}
            perform={perform}
            notify={notify}
            onBack={() => setSelected(null)}
            onDeleted={(id) => {
              setMeetings((ms) => ms.filter((x) => x.id !== id));
              setSelected(null);
            }}
            onSettings={() => setShowSettings(true)}
          />
        ) : (
          <div className="dashboard">
            <div className="page-eyebrow">YOUR MEETING SPACE</div>
            <div className="page-title-row">
              <div>
                <h1>
                  {page === "favorites"
                    ? "值得反复回看的讨论"
                    : page === "notes"
                      ? "留住那些重要的瞬间"
                      : "每一次讨论，都有回响。"}
                </h1>
                <p>专注此刻的交流，把记录与整理交给AI 纪要。</p>
              </div>
              <span className="today-label">
                {new Date().toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </span>
            </div>
            {page === "all" && (
              <div className="hero">
                <div className="hero-copy">
                  <span className="pill">
                    <span className="status-dot" />
                    为面对面的交流而设计
                  </span>
                  <h2>
                    好想法，
                    <br />
                    值得被好好记住。
                  </h2>
                  <p>
                    实时区分每一位发言人，圈出重要的原话。
                    <br />
                    会后，一份清晰的纪要与思维导图就准备好了。
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      onClick={() => setNewOpen(true)}
                    >
                      <Mic size={17} />
                      开始一场会议
                      <ArrowUpRight size={16} />
                    </button>
                    <button
                      className="text-button"
                      onClick={importAudio}
                      disabled={busy}
                    >
                      <Upload size={16} />
                      导入录音
                    </button>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="paper paper-back" />
                  <div className="paper">
                    <span className="paper-eyebrow">FROM VOICE TO CLARITY</span>
                    <div className="art-wave">
                      {Array.from({ length: 28 }, (_, i) => (
                        <i
                          key={i}
                          style={{
                            height:
                              12 +
                              Math.sin(i * 1.9) ** 2 * 34 +
                              Math.sin(i * 0.45) ** 2 * 20,
                          }}
                        />
                      ))}
                    </div>
                    <div className="paper-rule" />
                    <div className="paper-lines">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="paper-bottom">
                      <span>
                        <CheckCircle2 size={13} />
                        重要的，已经记下
                      </span>
                      <Sparkles size={17} />
                    </div>
                  </div>
                  <div className="floating-note">
                    <Bookmark size={15} />
                    <span>一个重点，一段原声</span>
                  </div>
                </div>
              </div>
            )}
            <div className="stats-row">
              <div>
                <span className="stat-icon">
                  <Headphones size={19} />
                </span>
                <strong>{meetings.length}</strong>
                <span>场会议</span>
              </div>
              <div>
                <span className="stat-icon">
                  <Clock size={19} />
                </span>
                <strong>
                  {Math.round(
                    meetings.reduce((n, m) => n + m.durationMs, 0) / 60000,
                  )}
                </strong>
                <span>分钟交流</span>
              </div>
              <div>
                <span className="stat-icon">
                  <Bookmark size={19} />
                </span>
                <strong>
                  {meetings.reduce((n, m) => n + m.annotations.length, 0)}
                </strong>
                <span>个重点</span>
              </div>
              <div>
                <span className="stat-icon">
                  <Sparkles size={19} />
                </span>
                <strong>{meetings.filter((m) => m.summary).length}</strong>
                <span>份纪要</span>
              </div>
            </div>
            <div className="section-toolbar">
              <h2>
                {page === "favorites"
                  ? "收藏会议"
                  : page === "notes"
                    ? "带有批注的会议"
                    : "最近会议"}
                <span>{showMeetings.length}</span>
              </h2>
              <div className="search-field">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索会议、原文或备注"
                  aria-label="搜索会议"
                />
                {query && (
                  <IconButton title="清空搜索" onClick={() => setQuery("")}>
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            </div>
            <div className="meeting-grid">
              {showMeetings.map((m) => (
                <article
                  key={m.id}
                  className="meeting-card"
                  onClick={() => setSelected(m.id)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(m.id);
                  }}
                >
                  <div className="meeting-card-top">
                    <div className="card-icon">
                      <AudioLines size={22} />
                    </div>
                    <span
                      className={
                        "badge " +
                        (["recording", "transcribing"].includes(m.status)
                          ? "recording"
                          : m.summary
                            ? "done"
                            : "")
                      }
                    >
                      {status(m)}
                    </span>
                    <button
                      className={"card-star " + (m.favorite ? "favorited" : "")}
                      aria-label={m.favorite ? "取消收藏" : "收藏会议"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void perform(async () =>
                          upsert(
                            await api.patch(m.id, { favorite: !m.favorite }),
                          ),
                        );
                      }}
                    >
                      <Star
                        size={16}
                        fill={m.favorite ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                  <h3>{m.title}</h3>
                  <p>
                    {m.summary?.overview ||
                      m.segments[0]?.text ||
                      "留出空间，给下一次有价值的讨论。"}
                  </p>
                  <div className="card-meta">
                    <span>{date(m.createdAt)}</span>
                    <span>
                      <Clock size={13} />
                      {fmt(m.durationMs)}
                    </span>
                    <span>
                      <Users size={13} />
                      {new Set(
                        m.segments
                          .map((s) => s.speaker)
                          .filter((s) => s !== "-1"),
                      ).size || "—"}{" "}
                      人
                    </span>
                  </div>
                  <div className="card-bottom">
                    <span>
                      <Bookmark size={13} />
                      {m.annotations.length} 个重点
                    </span>
                    <span>
                      打开记录
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {!showMeetings.length && (
              <div className="empty-meetings">
                <div className="empty-icon">
                  <FileText size={26} />
                </div>
                <h3>
                  {query
                    ? "还没有找到相关记录"
                    : "第一场值得记录的会议，从这里开始"}
                </h3>
                <p>
                  {query
                    ? "试试其他关键词，也可以搜索原文和备注。"
                    : "点击“新建会议”，选择麦克风，就可以开始记录。"}
                </p>
                {!query && (
                  <button
                    className="secondary"
                    onClick={() => setNewOpen(true)}
                  >
                    <Plus size={16} />
                    新建会议
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={"toast " + (toast.error ? "error" : "")}
        >
          <span>
            {toast.error ? (
              <AlertCircle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
          </span>
          {toast.text}
          <IconButton title="关闭提示" onClick={() => setToast(null)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {newOpen && (
        <Modal title="新建会议" onClose={() => setNewOpen(false)}>
          <div className="dialog-illustration">
            <AudioLines size={30} />
          </div>
          <p className="modal-intro">
            给这次交流起个名字，其他的交给 AI 纪要。
          </p>
          <label className="field">
            会议主题
            <input
              autoFocus
              placeholder="例如：产品方案讨论"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void makeNew();
              }}
            />
          </label>
          <div className="info-panel">
            <HardDrive size={17} />
            <span>录音与文字保存在本机，结束后可整理到 Obsidian。</span>
          </div>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setNewOpen(false)}>
              取消
            </button>
            <button className="primary" onClick={makeNew}>
              创建会议
              <ArrowUpRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          onSaved={setSettings}
          onClose={() => setShowSettings(false)}
          notify={notify}
        />
      )}
    </div>
  );
}
type Perform = <T>(
  fn: () => Promise<T>,
  success?: string,
) => Promise<T | undefined>;
function Workspace({
  m,
  busy,
  activeId,
  level,
  settings,
  progress,
  onStart,
  onControl,
  upsert,
  perform,
  notify,
  onBack,
  onSettings,
  onDeleted,
}: {
  m: Meeting;
  busy: boolean;
  activeId?: string;
  level: number;
  settings: Settings | null;
  progress?: string;
  onStart: (m: Meeting, offline?: boolean) => void;
  onControl: (a: "pause" | "resume" | "stop") => void;
  upsert: (m: Meeting) => void;
  perform: Perform;
  notify: (s: string, e?: boolean) => void;
  onBack: () => void;
  onSettings: () => void;
  onDeleted: (id: string) => void;
}) {
  const [tab, setTab] = useState("transcript"),
    [search, setSearch] = useState(""),
    [selection, setSelection] = useState<TextSelection | null>(null),
    [note, setNote] = useState(""),
    [edit, setEdit] = useState<Segment | null>(null),
    [showSpeakers, setShowSpeakers] = useState(false),
    [rename, setRename] = useState(false),
    [title, setTitle] = useState(m.title),
    [menu, setMenu] = useState(false),
    [exportBusy, setExportBusy] = useState(false),
    [annEdit, setAnnEdit] = useState<Annotation | null>(null),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [follow, setFollow] = useState(true);
  const audio = useRef<HTMLAudioElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const live = ["recording", "paused", "transcribing"].includes(m.status);
  const isRecord = m.status === "recording";
  const people = Array.from(new Set(m.segments.map((s) => s.speaker))).filter(
    (s) => s !== "-1",
  );
  useEffect(() => {
    if (follow && isRecord)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [m.segments.length]);
  const seek = (ms: number) => {
    setTab("transcript");
    setPosition(ms);
    if (audio.current) {
      audio.current.currentTime = ms / 1000;
      void audio.current
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
    }
    setTimeout(
      () =>
        document
          .querySelector(
            `[data-segid="${m.segments.find((s) => s.startMs <= ms && s.endMs >= ms)?.id}"]`,
          )
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      100,
    );
  };
  const captureSelection = () => {
    if (selection) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const elements = Array.from(
      scroll.current?.querySelectorAll<HTMLElement>(".segment-text") || [],
    ).filter((el) => range.intersectsNode(el));
    if (!elements.length) return;
    const pieces = elements
      .map((el) => {
        const clipped = document.createRange();
        clipped.selectNodeContents(el);
        if (el.contains(range.startContainer))
          clipped.setStart(range.startContainer, range.startOffset);
        if (el.contains(range.endContainer))
          clipped.setEnd(range.endContainer, range.endOffset);
        return clipped.toString().trim();
      })
      .filter(Boolean);
    const quote = pieces.join("\n");
    if (!quote) return;
    const ids = elements.map((el) => el.dataset.id!);
    const segments = m.segments.filter((s) => ids.includes(s.id));
    const rect = range.getBoundingClientRect();
    setSelection({
      quote,
      segmentIds: ids,
      startMs: segments[0].startMs,
      endMs: segments.at(-1)!.endMs,
      anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
    });
  };
  const exportVault = async () => {
    setExportBusy(true);
    await perform(() => api.exportObsidian(m.id), "已保存到 Obsidian");
    setExportBusy(false);
  };
  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div className="meeting-heading">
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={14} />
            全部会议
          </button>
          <div className="title-line">
            <h1>{m.title}</h1>
            <IconButton
              title="修改会议标题"
              onClick={() => {
                setTitle(m.title);
                setRename(true);
              }}
            >
              <PenLine size={16} />
            </IconButton>
          </div>
          <div className="meeting-meta">
            <span>
              {date(m.createdAt)} ·{" "}
              {new Date(m.createdAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>
              <Clock size={14} />
              {fmt(m.durationMs)}
            </span>
            <button onClick={() => setShowSpeakers(true)}>
              <Users size={14} />
              {people.length} 位发言人
            </button>
            <span className={"badge " + (live ? "recording" : "done")}>
              {status(m)}
            </span>
          </div>
        </div>
        <div className="meeting-actions">
          <div className="more-wrap">
            <IconButton title="更多会议操作" onClick={() => setMenu(!menu)}>
              <MoreHorizontal size={20} />
            </IconButton>
            {menu && (
              <>
                <div className="menu-dismiss" onClick={() => setMenu(false)} />
                <div className="dropdown">
                  <button
                    onClick={() => {
                      setMenu(false);
                      void perform(async () =>
                        upsert(
                          await api.patch(m.id, { favorite: !m.favorite }),
                        ),
                      );
                    }}
                  >
                    <Star size={15} />
                    {m.favorite ? "取消收藏" : "收藏会议"}
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      void perform(
                        () => api.exportBundle(m.id),
                        "会议文件已导出",
                      );
                    }}
                  >
                    <Download size={15} />
                    导出完整会议
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      void perform(
                        () => api.exportHighlights(m.id),
                        "重点音频已导出",
                      );
                    }}
                  >
                    <Headphones size={15} />
                    导出重点音频
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      void perform(() => api.reveal(m.id));
                    }}
                  >
                    <FolderOpen size={15} />
                    打开本地文件
                  </button>
                  <button
                    disabled={live || !!activeId}
                    onClick={() => {
                      setMenu(false);
                      if (
                        confirm(
                          "重新转写会保留旧原文备份，当前批注仍保留其原句和时间。处理将按录音原速进行，并产生腾讯 API 费用。继续？",
                        )
                      )
                        void perform(() => api.retranscribe(m.id));
                    }}
                  >
                    <RefreshCw size={15} />
                    用录音重新转写
                  </button>
                  <button
                    className="danger-text"
                    disabled={live}
                    onClick={() => {
                      setMenu(false);
                      void perform(async () => {
                        if (await api.remove(m.id)) {
                          onDeleted(m.id);
                        }
                      });
                    }}
                  >
                    <Trash2 size={15} />
                    删除会议
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            className="secondary"
            disabled={!m.exportPath}
            onClick={() => void perform(() => api.openObsidian(m.id))}
          >
            <ExternalLink size={16} />在 Obsidian 中查看
          </button>
          {m.summaryStatus === "running" ? (
            <button
              className="secondary"
              onClick={() => void perform(() => api.cancelSummary(m.id))}
            >
              <Loader2 size={16} className="spin" />
              取消整理
            </button>
          ) : (
            <button
              className="primary"
              disabled={live || !m.segments.length}
              onClick={() => {
                setTab("summary");
                void perform(() => api.generate(m.id));
              }}
            >
              <Sparkles size={16} />
              {m.summary ? "重新整理" : "生成纪要"}
            </button>
          )}
        </div>
      </div>
      {(m.lastError || m.gaps.length > 0) && (
        <div className="inline-warning">
          <AlertCircle size={16} />
          <span>
            {m.lastError ||
              `有 ${m.gaps.length} 段转写缺口；录音仍已保留，可从更多菜单重新转写。`}
          </span>
          <button onClick={onSettings}>检查设置</button>
        </div>
      )}
      {m.syncError && (
        <div className="inline-warning">
          <AlertCircle size={16} />
          <span>本地已保存，Obsidian 关联失败：{m.syncError}</span>
          <button onClick={onSettings}>修改设置</button>
          <button onClick={exportVault}>重试同步</button>
        </div>
      )}
      <div className="workspace-tabs">
        <div className="tabs">
          {[
            { id: "transcript", icon: FileText, text: "会议原文" },
            { id: "summary", icon: Sparkles, text: "会议纪要" },
            { id: "mindmap", icon: Network, text: "思维导图" },
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={16} />
              {t.text}
              {t.id === "transcript" && <span>{m.segments.length}</span>}
            </button>
          ))}
        </div>
        <span className="saved-label">
          <CheckCheck size={14} />
          已自动保存
        </span>
      </div>
      <div className="workspace-body">
        <section className="document-pane">
          {tab === "transcript" ? (
            <>
              <div className="transcript-toolbar">
                <div className="search-field">
                  <Search size={15} />
                  <input
                    placeholder="搜索原文"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="搜索原文"
                  />
                </div>
                <button
                  className="text-button"
                  onClick={() => setShowSpeakers(true)}
                >
                  <Users size={15} />
                  编辑发言人
                </button>
                {isRecord && (
                  <button
                    className={"follow-button " + (follow ? "on" : "")}
                    onClick={() => setFollow(!follow)}
                  >
                    跟随字幕 {follow ? "开" : "关"}
                  </button>
                )}
              </div>
              <div
                ref={scroll}
                className="transcript-scroll"
                onMouseUp={(e) => {
                  if ((e.target as HTMLElement).closest(".segment-text"))
                    captureSelection();
                }}
                onKeyUp={(e) => {
                  if (e.shiftKey) captureSelection();
                }}
              >
                {m.segments
                  .filter((s) => !search || s.text.includes(search))
                  .map((s) => (
                    <div
                      data-segid={s.id}
                      key={s.id}
                      className={
                        "segment " +
                        (position >= s.startMs && position < s.endMs
                          ? "playing-segment"
                          : "")
                      }
                    >
                      <button
                        className="speaker-avatar"
                        style={{
                          background: color(s.speaker) + "1c",
                          color: color(s.speaker),
                        }}
                        onClick={() => setShowSpeakers(true)}
                        title="编辑发言人"
                      >
                        {label(m, s.speaker).replace("说话人 ", "").slice(0, 1)}
                      </button>
                      <div className="segment-body">
                        <div className="segment-header">
                          <strong style={{ color: color(s.speaker) }}>
                            {label(m, s.speaker)}
                          </strong>
                          <button
                            className="timestamp"
                            disabled={live}
                            onClick={() => seek(s.startMs)}
                          >
                            <Play size={10} />
                            {fmt(s.startMs)}
                          </button>
                          {!s.final && (
                            <span className="draft-label">识别中</span>
                          )}
                          {s.edited && (
                            <span className="draft-label">已修订</span>
                          )}
                          <IconButton
                            className="segment-edit"
                            title="修改这段原文"
                            onClick={() => setEdit({ ...s })}
                          >
                            <PenLine size={13} />
                          </IconButton>
                        </div>
                        <p className="segment-text" data-id={s.id}>
                          {highlightText(
                            s.text,
                            m.annotations.filter((a) =>
                              a.segmentIds.includes(s.id),
                            ),
                            search,
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                {!m.segments.length && (
                  <div className="transcript-empty">
                    <div
                      className={"empty-wave " + (isRecord ? "listening" : "")}
                    >
                      {[16, 32, 48, 24, 40, 58, 30, 18, 36].map((h, i) => (
                        <i
                          key={i}
                          style={{ height: h, animationDelay: i * 0.08 + "s" }}
                        />
                      ))}
                    </div>
                    <h3>
                      {isRecord
                        ? "正在聆听这场讨论"
                        : m.status === "transcribing"
                          ? "正在转写录音"
                          : "把注意力留给交流"}
                    </h3>
                    <p>
                      {isRecord
                        ? "文字与说话人会出现在这里，你可以随时选择原文添加批注。"
                        : m.durationMs
                          ? "录音已保存。你可以先回听，或使用“重新转写”生成原文。"
                          : "开始录音后，AI 纪要会记录每位发言人的原话。"}
                    </p>
                    {!live && !m.durationMs && (
                      <button
                        className="primary"
                        disabled={busy || !!activeId}
                        onClick={() => onStart(m)}
                      >
                        <Mic size={16} />
                        开始记录
                      </button>
                    )}
                    {!live && m.durationMs > 0 && (
                      <button
                        className="primary"
                        onClick={() =>
                          void perform(() => api.retranscribe(m.id))
                        }
                      >
                        <RefreshCw size={16} />
                        开始转写录音
                      </button>
                    )}
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <div className="document-hint">
                <MessageSquare size={14} />
                选中一段原文，就能划重点、添加备注。<span>点击时间可回听</span>
              </div>
            </>
          ) : tab === "summary" ? (
            <SummaryView m={m} progress={progress} seek={seek} />
          ) : (
            <MindmapView summary={m.summary} stale={m.summaryStale} />
          )}
        </section>
        <aside className="annotation-pane">
          <div className="annotations-heading">
            <div>
              <Bookmark size={17} />
              <h3>重点与备注</h3>
              <span>{m.annotations.length}</span>
            </div>
          </div>
          <p className="annotation-intro">
            你标出的重点，会优先交给 Codex 整理。
          </p>
          <div className="annotation-list">
            {m.annotations.map((a, i) => (
              <div className="annotation-card" key={a.id}>
                <div className="annotation-top">
                  <span className="note-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <button
                    className="timestamp"
                    disabled={live}
                    onClick={() => seek(a.startMs)}
                  >
                    <Play size={10} />
                    {fmt(a.startMs)}
                  </button>
                  <IconButton
                    title="编辑备注"
                    onClick={() => setAnnEdit({ ...a })}
                  >
                    <PenLine size={13} />
                  </IconButton>
                  <IconButton
                    title="删除批注"
                    onClick={() =>
                      void perform(async () =>
                        upsert(await api.deleteAnnotation(m.id, a.id)),
                      )
                    }
                  >
                    <X size={13} />
                  </IconButton>
                </div>
                <blockquote>{a.quote}</blockquote>
                {a.note && <p>{a.note}</p>}
                <div className="annotation-tag">
                  <AnnotationKind type={a.type} />
                </div>
              </div>
            ))}
            {!m.annotations.length && (
              <div className="notes-empty">
                <Bookmark size={26} />
                <h4>留住重要的那一句</h4>
                <p>
                  在左侧选中文字，
                  <br />
                  把你的想法一起记下来。
                </p>
                <div className="selection-demo">
                  这段讨论很重要<span>＋ 添加备注</span>
                </div>
              </div>
            )}
          </div>
          {m.exportedAt && (
            <button
              className="obsidian-link"
              onClick={() => void perform(() => api.openObsidian(m.id))}
            >
              <FolderOpen size={16} />
              <span>
                已归档到 Obsidian
                <small>
                  {new Date(m.exportedAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <ExternalLink size={14} />
            </button>
          )}
        </aside>
      </div>
      <footer className="player">
        <div className="player-controls">
          {live ? (
            <>
              <div className={"record-status " + (isRecord ? "pulse" : "")}>
                <Mic size={20} />
              </div>
              <div>
                <strong>
                  {m.status === "paused"
                    ? "已暂停"
                    : m.status === "transcribing"
                      ? "录音转写中"
                      : "正在录音"}
                </strong>
                <small>
                  {fmt(m.durationMs)}
                  <span className="live-dot" />
                </small>
              </div>
              {m.status === "transcribing" && (
                <button
                  className="stop-record"
                  onClick={() => onControl("stop")}
                >
                  <Square size={13} />
                  停止转写
                </button>
              )}
              {m.status !== "transcribing" && (
                <>
                  <IconButton
                    title={m.status === "paused" ? "继续录音" : "暂停录音"}
                    disabled={busy}
                    onClick={() =>
                      onControl(m.status === "paused" ? "resume" : "pause")
                    }
                  >
                    {m.status === "paused" ? (
                      <Play size={18} />
                    ) : (
                      <Pause size={18} />
                    )}
                  </IconButton>
                  <button
                    className="stop-record"
                    disabled={busy}
                    onClick={() => onControl("stop")}
                  >
                    {busy ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Square size={13} fill="currentColor" />
                    )}
                    结束
                  </button>
                </>
              )}
            </>
          ) : m.durationMs > 0 ? (
            <>
              <IconButton
                title="后退 10 秒"
                onClick={() => {
                  if (audio.current)
                    audio.current.currentTime = Math.max(
                      0,
                      audio.current.currentTime - 10,
                    );
                }}
              >
                <SkipBack size={19} />
              </IconButton>
              <button
                className="play-main"
                aria-label={playing ? "暂停播放" : "播放录音"}
                onClick={() => {
                  if (audio.current) {
                    if (playing) audio.current.pause();
                    else
                      void audio.current
                        .play()
                        .catch((e) =>
                          notify("无法播放录音：" + e.message, true),
                        );
                  }
                }}
              >
                {playing ? (
                  <Pause size={21} />
                ) : (
                  <Play size={21} fill="currentColor" />
                )}
              </button>
              <span className="play-time">
                {fmt(position)}
                <small>/ {fmt(m.durationMs)}</small>
              </span>
            </>
          ) : (
            <>
              <button
                className="primary"
                disabled={busy || !!activeId}
                onClick={() => onStart(m)}
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Mic size={16} />
                )}
                开始录音
              </button>
              <button
                className="text-button"
                disabled={busy || !!activeId}
                onClick={() => onStart(m, true)}
              >
                仅录音
              </button>
            </>
          )}
        </div>
        <div
          className="waveform"
          title={live ? "录音音量" : "点击或拖动定位录音"}
        >
          <div className="wave-bars">
            {Array.from({ length: 96 }, (_, i) => {
              const index = Math.floor((i / 96) * m.peaks.length);
              const peak = live
                ? m.peaks[Math.max(0, m.peaks.length - 96 + i)]
                : m.peaks[index];
              return (
                <i
                  key={i}
                  className={
                    !live && i / 96 < position / m.durationMs ? "played" : ""
                  }
                  style={{ height: Math.max(3, (peak || 0) * 36) }}
                />
              );
            })}
          </div>
          {!live && m.durationMs > 0 && (
            <input
              type="range"
              min={0}
              max={m.durationMs}
              step={100}
              value={position}
              aria-label="录音播放进度"
              onChange={(e) => {
                setPosition(Number(e.target.value));
                if (audio.current)
                  audio.current.currentTime = Number(e.target.value) / 1000;
              }}
            />
          )}
        </div>
        <div className="player-right">
          {live ? (
            <div className="connection-indicator">
              <span
                className={
                  "status-dot " + (m.connection?.state === "error" ? "red" : "")
                }
              />
              <span>
                {m.status === "transcribing"
                  ? progress || "正在转写"
                  : m.connection?.state === "connected"
                    ? "实时转写已连接"
                    : m.connection?.state === "offline"
                      ? "仅本地录音"
                      : m.connection?.state === "error"
                        ? "转写连接异常"
                        : "连接中"}
                <small>
                  {m.status === "recording"
                    ? `麦克风 ${Math.round(level * 100)}%`
                    : "录音已安全保存"}
                </small>
              </span>
            </div>
          ) : (
            <>
              <select
                aria-label="播放速度"
                value={speed}
                onChange={(e) => {
                  setSpeed(Number(e.target.value));
                  if (audio.current)
                    audio.current.playbackRate = Number(e.target.value);
                }}
              >
                {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <Volume2 size={16} />
              <input
                aria-label="播放音量"
                className="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                defaultValue="1"
                onChange={(e) => {
                  if (audio.current)
                    audio.current.volume = Number(e.target.value);
                }}
              />
            </>
          )}
        </div>
        {!live && m.durationMs > 0 && (
          <audio
            ref={audio}
            src={`media://recording/${m.id}?v=${m.durationMs}`}
            onTimeUpdate={() =>
              setPosition((audio.current?.currentTime || 0) * 1000)
            }
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        )}
      </footer>
      {selection && (
        <SelectionBubble
          meetingId={m.id}
          selection={selection}
          onUpdate={upsert}
          onClose={() => setSelection(null)}
          onError={(s) => notify(s, true)}
        />
      )}
      {annEdit && (
        <Modal title="编辑备注" onClose={() => setAnnEdit(null)}>
          <div className="annotation-type-picker">
            {annotationKinds.map((k) => (
              <button
                key={k.type}
                className={
                  (annEdit.type || "highlight") === k.type ? "selected" : ""
                }
                onClick={() => setAnnEdit({ ...annEdit, type: k.type })}
              >
                <k.icon size={16} />
                {k.label}
              </button>
            ))}
          </div>
          <div className="quote-preview">
            <blockquote>{annEdit.quote}</blockquote>
          </div>
          <label className="field">
            备注
            <textarea
              rows={4}
              value={annEdit.note}
              onChange={(e) => setAnnEdit({ ...annEdit, note: e.target.value })}
            />
          </label>
          <div className="modal-actions">
            <button
              className="primary"
              onClick={() =>
                void perform(async () => {
                  upsert(
                    await api.editAnnotation(
                      m.id,
                      annEdit.id,
                      annEdit.note,
                      annEdit.type,
                    ),
                  );
                  setAnnEdit(null);
                })
              }
            >
              保存备注
            </button>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal title="修订原文" onClose={() => setEdit(null)}>
          <label className="field">
            发言人
            <select
              value={edit.speaker}
              onChange={(e) => setEdit({ ...edit, speaker: e.target.value })}
            >
              {Array.from(new Set([...people, edit.speaker])).map((s) => (
                <option key={s} value={s}>
                  {label(m, s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            原文内容
            <textarea
              rows={6}
              value={edit.text}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })}
            />
          </label>
          {edit.originalText && (
            <p className="field-help">最初识别：{edit.originalText}</p>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={() => setEdit(null)}>
              取消
            </button>
            <button
              className="primary"
              onClick={() =>
                void perform(async () => {
                  upsert(
                    await api.editSegment(m.id, edit.id, {
                      text: edit.text,
                      speaker: edit.speaker,
                    }),
                  );
                  setEdit(null);
                })
              }
            >
              保存修订
            </button>
          </div>
        </Modal>
      )}
      {showSpeakers && (
        <Modal title="给发言人一个名字" onClose={() => setShowSpeakers(false)}>
          <p className="modal-intro">
            填写姓名后，该发言人的所有原文会一起更新。
          </p>
          {people.length ? (
            people.map((s) => (
              <SpeakerEditor
                key={s}
                m={m}
                speaker={s}
                onSave={async (name) => {
                  const result = await perform(
                    () => api.renameSpeaker(m.id, s, name),
                    "姓名已更新",
                  );
                  if (result) upsert(result);
                }}
              />
            ))
          ) : (
            <div className="info-panel">
              开始转写后，会自动出现 A、B、C 等发言人。
            </div>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={() => setShowSpeakers(false)}>
              完成
            </button>
          </div>
        </Modal>
      )}
      {rename && (
        <Modal title="修改会议标题" onClose={() => setRename(false)}>
          <label className="field">
            会议标题
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button
              className="primary"
              onClick={() =>
                void perform(async () => {
                  upsert(
                    await api.patch(m.id, { title: title.trim() || m.title }),
                  );
                  setRename(false);
                })
              }
            >
              保存
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function AnnotationKind({ type }: { type?: Annotation["type"] }) {
  const k = annotationKinds.find((x) => x.type === type) || annotationKinds[0];
  return (
    <span className="annotation-kind" style={{ color: k.color }}>
      <k.icon size={12} />
      {k.label}
    </span>
  );
}
function highlightText(text: string, annotations: Annotation[], query: string) {
  const terms = [
    ...annotations.flatMap((a) => a.quote.split(/\n+/).map((s) => s.trim())),
    query,
  ]
    .filter(Boolean)
    .filter((t) => text.includes(t));
  if (!terms.length) return text;
  const ranges = terms
    .map((t) => ({ start: text.indexOf(t), end: text.indexOf(t) + t.length }))
    .sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue;
    parts.push(text.slice(pos, r.start));
    parts.push(<mark key={r.start}>{text.slice(r.start, r.end)}</mark>);
    pos = r.end;
  }
  parts.push(text.slice(pos));
  return parts;
}
function SpeakerEditor({
  m,
  speaker,
  onSave,
}: {
  m: Meeting;
  speaker: string;
  onSave: (s: string) => void;
}) {
  const [name, setName] = useState(m.speakers[speaker] || "");
  return (
    <div className="speaker-editor">
      <span
        className="speaker-avatar"
        style={{ color: color(speaker), background: color(speaker) + "20" }}
      >
        {String.fromCharCode(65 + Number(speaker))}
      </span>
      <label className="field">
        说话人 {String.fromCharCode(65 + Number(speaker))}
        <input
          placeholder="填写姓名"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button className="secondary" onClick={() => onSave(name)}>
        <Check size={15} />
        保存
      </button>
    </div>
  );
}
function SummaryView({
  m,
  progress,
  seek,
}: {
  m: Meeting;
  progress?: string;
  seek: (n: number) => void;
}) {
  const s = m.summary;
  const refs = (ids: string[]) =>
    ids
      ?.map((id) => m.segments.find((x) => x.id === id))
      .filter((x): x is Segment => !!x)
      .map((x) => (
        <button
          className="source-link"
          key={x.id}
          onClick={() => seek(x.startMs)}
        >
          <Link size={11} />
          {fmt(x.startMs)}
        </button>
      ));
  return (
    <div className="summary-scroll">
      {m.summaryStatus === "running" && (
        <div className="generating">
          <Loader2 className="spin" size={22} />
          <div>
            <strong>让讨论变得清晰</strong>
            <p>{progress || "Codex 正在阅读原文与批注…"}</p>
          </div>
        </div>
      )}
      {m.summaryError && (
        <div className="inline-warning">
          <AlertCircle size={16} />
          {m.summaryError}
        </div>
      )}
      {m.summaryStale && (
        <div className="info-panel">
          <RefreshCw size={16} />
          原文或批注已更新，可以点击“重新整理”更新纪要。
        </div>
      )}
      {s ? (
        <>
          <div className="document-eyebrow">MEETING NOTES</div>
          <h2 className="document-title">{m.title}</h2>
          <div className="summary-overview">
            <Sparkles size={20} />
            <div>
              <h3>核心结论</h3>
              <p>{s.overview}</p>
            </div>
          </div>
          <h3 className="doc-section-title">讨论事项</h3>
          {s.topics.map((t, i) => (
            <div className="topic" key={i}>
              <span className="topic-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h4>{t.title}</h4>
                <p>{t.detail}</p>
                <div>{refs(t.sourceIds)}</div>
              </div>
            </div>
          ))}
          <h3 className="doc-section-title">决策记录</h3>
          {s.decisions.length ? (
            s.decisions.map((d, i) => (
              <div className="decision" key={i}>
                <CheckCircle2 size={17} />
                <div>
                  {d.text}
                  <div>{refs(d.sourceIds)}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">本次讨论未形成明确决策。</p>
          )}
          <h3 className="doc-section-title">下一步行动</h3>
          {s.actions.length ? (
            s.actions.map((a, i) => (
              <div className="action-item" key={i}>
                <Square size={15} />
                <div>
                  <strong>{a.text}</strong>
                  <small>
                    {a.owner || "负责人待确认"} · {a.deadline || "期限待确认"}
                  </small>
                  {refs(a.sourceIds)}
                </div>
              </div>
            ))
          ) : (
            <p className="muted">原文中没有明确的待办安排。</p>
          )}
          {s.openQuestions.length > 0 && (
            <>
              <h3 className="doc-section-title">待确认的问题</h3>
              <ul className="questions">
                {s.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
          <div className="document-end">
            由原文与人工批注整理 · 关键结论可点击时间回溯
          </div>
        </>
      ) : (
        m.summaryStatus !== "running" && (
          <div className="transcript-empty">
            <div className="empty-icon">
              <Sparkles size={28} />
            </div>
            <h3>从一场讨论，到一份清晰的记录</h3>
            <p>
              结束录音后，点击右上角“生成纪要”。
              <br />
              Codex 会结合你的重点与备注，整理结论、决策和待办。
            </p>
          </div>
        )
      )}
    </div>
  );
}
function MindmapView({
  summary,
  stale,
}: {
  summary: Summary | null;
  stale?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<number[]>([]);
  return (
    <div className="mindmap-scroll">
      {summary ? (
        <>
          <div className="mindmap-heading">
            <div>
              <div className="document-eyebrow">CONNECT THE IDEAS</div>
              <h2>让思路一目了然</h2>
              <p>
                {stale
                  ? "资料已更新，重新整理后思维导图会一起更新。"
                  : "从主题出发，回看每条思路的走向。点击分支可折叠。"}
              </p>
            </div>
            <Network size={27} />
          </div>
          <div className="mindmap-tree">
            <div className="mindmap-root">
              <AudioLines size={24} />
              <strong>{summary.mindmap.title}</strong>
            </div>
            <div className="mindmap-branches">
              {summary.mindmap.branches.map((b, i) => (
                <div
                  key={i}
                  className="mindmap-branch"
                  style={
                    {
                      "--branch-color": palette[i % palette.length],
                    } as React.CSSProperties
                  }
                >
                  <button
                    onClick={() =>
                      setCollapsed((cs) =>
                        cs.includes(i) ? cs.filter((c) => c !== i) : [...cs, i],
                      )
                    }
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {b.title}
                    <ChevronDown
                      size={16}
                      style={{
                        transform: collapsed.includes(i)
                          ? "rotate(-90deg)"
                          : "",
                      }}
                    />
                  </button>
                  {!collapsed.includes(i) && (
                    <ul>
                      {b.items.map((t, j) => (
                        <li key={j}>{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="document-end">
            思维导图会自动同步到 Obsidian，可继续编辑 Mermaid 源码
          </div>
        </>
      ) : (
        <div className="transcript-empty">
          <div className="empty-icon">
            <Network size={28} />
          </div>
          <h3>把讨论串成一张图</h3>
          <p>生成纪要后，主题、分支与关键结论会在这里展开。</p>
        </div>
      )}
    </div>
  );
}
function SettingsPanel({
  settings,
  onSaved,
  onClose,
  notify,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
  onClose: () => void;
  notify: (s: string, e?: boolean) => void;
}) {
  const [s, setS] = useState<Settings>({ ...settings }),
    [tab, setTab] = useState("tencent"),
    [busy, setBusy] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [health, setHealth] = useState<any>(null),
    [test, setTest] = useState("");
  const change = (key: keyof Settings, value: any) =>
    setS((c) => ({ ...c, [key]: value }));
  const enumerate = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      notify(
        "无法访问麦克风，请在 macOS 隐私设置中允许AI 纪要使用麦克风。",
        true,
      );
    }
  };
  useEffect(() => {
    void api.health().then(setHealth);
    void navigator.mediaDevices
      .enumerateDevices()
      .then((ds) => setDevices(ds.filter((d) => d.kind === "audioinput")));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const next = await api.saveSettings(s);
      setS(next);
      onSaved(next);
      notify("设置已保存");
      return next;
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const testCloud = async () => {
    setBusy(true);
    setTest("正在保存配置并测试连接…");
    try {
      const saved = await api.saveSettings(s);
      onSaved(saved);
      setS(saved);
      if (!saved.appId) {
        const resolved = await api.resolveAppId();
        onSaved(resolved);
        setS(resolved);
      }
      setTest(await api.testTencent());
    } catch (e) {
      setTest((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="设置与连接" wide onClose={onClose}>
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            { id: "tencent", label: "语音识别", icon: AudioLines },
            { id: "recording", label: "录音设备", icon: Mic },
            { id: "shortcuts", label: "快捷键", icon: Keyboard },
            { id: "summary", label: "AI 整理", icon: Sparkles },
            { id: "storage", label: "存储与归档", icon: Folder },
            { id: "appearance", label: "外观", icon: Sun },
          ].map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "active" : ""}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={17} />
              {n.label}
            </button>
          ))}
          <div className="settings-security">
            <ShieldCheck size={23} />
            <p>密钥加密保存在这台 Mac，界面和导出文件不包含密钥。</p>
          </div>
        </nav>
        <div className="settings-content">
          {tab === "tencent" && (
            <>
              <div className="settings-section-title">
                <div className="settings-title-icon">
                  <AudioLines size={21} />
                </div>
                <div>
                  <h3>腾讯云实时语音识别</h3>
                  <p>中文转写 · 实时说话人分离</p>
                </div>
              </div>
              <div className="model-chip">
                16k_zh_en_speaker_2.0<span>固定识别引擎</span>
              </div>
              <label className="field">
                AppID
                <div className="input-with-button">
                  <input
                    value={s.appId}
                    placeholder="腾讯云数字 AppID"
                    onChange={(e) => change("appId", e.target.value)}
                  />
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.saveSettings(s);
                        const next = await api.resolveAppId();
                        setS(next);
                        onSaved(next);
                        notify("AppID 已自动获取");
                      } catch (e) {
                        notify((e as Error).message, true);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    自动获取
                  </button>
                </div>
              </label>
              <div className="settings-fields">
                <label className="field">
                  SecretId{" "}
                  {s.secretIdConfigured && (
                    <span className="configured">
                      <Check size={12} />
                      已配置
                    </span>
                  )}
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      s.secretIdConfigured
                        ? "留空保持现有密钥"
                        : "填写 SecretId"
                    }
                    value={s.secretId ?? ""}
                    onChange={(e) => {
                      if (e.target.value) change("secretId", e.target.value);
                      else
                        setS((c) => {
                          const n = { ...c };
                          delete n.secretId;
                          return n;
                        });
                    }}
                  />
                </label>
                <label className="field">
                  SecretKey{" "}
                  {s.secretKeyConfigured && (
                    <span className="configured">
                      <Check size={12} />
                      已配置
                    </span>
                  )}
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      s.secretKeyConfigured
                        ? "留空保持现有密钥"
                        : "填写 SecretKey"
                    }
                    value={s.secretKey ?? ""}
                    onChange={(e) => {
                      if (e.target.value) change("secretKey", e.target.value);
                      else
                        setS((c) => {
                          const n = { ...c };
                          delete n.secretKey;
                          return n;
                        });
                    }}
                  />
                </label>
              </div>
              <label className="field">
                识别热词
                <textarea
                  rows={3}
                  value={s.hotwords}
                  onChange={(e) => change("hotwords", e.target.value)}
                  placeholder="项目名称、人名、专业术语，用逗号或换行分隔"
                />
              </label>
              <p className="field-help">
                把会议中常见的专有名词放在这里，帮助减少同音字识别错误。
              </p>
              <div className="settings-test-row">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={testCloud}
                >
                  {busy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Radio size={15} />
                  )}
                  保存并测试连接
                </button>
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    change("secretId", "");
                    change("secretKey", "");
                    setS((c) => ({
                      ...c,
                      secretId: "",
                      secretKey: "",
                      secretIdConfigured: false,
                      secretKeyConfigured: false,
                    }));
                  }}
                >
                  清除腾讯密钥
                </button>
              </div>
              {test && (
                <div
                  className={
                    "connection-result " +
                    (test.includes("成功") ? "success" : "")
                  }
                >
                  <AlertCircle size={16} />
                  {test}
                </div>
              )}
            </>
          )}
          {tab === "recording" && (
            <>
              <div className="settings-section-title">
                <div className="settings-title-icon">
                  <Mic size={21} />
                </div>
                <div>
                  <h3>录音设备</h3>
                  <p>选择会议中使用的麦克风</p>
                </div>
              </div>
              <label className="field">
                默认麦克风
                <select
                  value={s.micId}
                  onChange={(e) => change("micId", e.target.value)}
                >
                  <option value="">跟随系统默认设备</option>
                  {devices
                    .filter((d) => d.deviceId !== "default")
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || "麦克风 " + d.deviceId.slice(0, 5)}
                      </option>
                    ))}
                </select>
              </label>
              <button className="secondary" onClick={enumerate}>
                <RefreshCw size={15} />
                授权并刷新设备
              </button>
              <div className="info-panel">
                <Mic size={18} />
                <span>
                  为线下多人会议保留原始收音，关闭自动增益、降噪和回声消除。录音采用
                  16 kHz 单声道 WAV，约 115 MB／小时。
                </span>
              </div>
              <div className="settings-detail">
                <span>麦克风权限</span>
                <strong>
                  {health?.microphone === "granted"
                    ? "已允许"
                    : health?.microphone || "检查中"}
                </strong>
              </div>
              <p className="field-help">
                更换设备在下一次开始录音时生效。拔出正在使用的设备后，请结束当前录音并重新选择。
              </p>
            </>
          )}
          {tab === "summary" && (
            <>
              <div className="settings-section-title">
                <div className="settings-title-icon">
                  <Sparkles size={21} />
                </div>
                <div>
                  <h3>会后 AI 整理</h3>
                  <p>把原文和重点变成纪要与思维导图</p>
                </div>
              </div>
              <div className="provider-options">
                <button
                  className={s.summaryProvider === "codex" ? "selected" : ""}
                  onClick={() => change("summaryProvider", "codex")}
                >
                  <Command size={22} />
                  <strong>Codex</strong>
                  <small>使用本机登录与额度</small>
                  {s.summaryProvider === "codex" && <CheckCircle2 size={16} />}
                </button>
                <button
                  className={s.summaryProvider === "api" ? "selected" : ""}
                  onClick={() => change("summaryProvider", "api")}
                >
                  <KeyRound size={22} />
                  <strong>自有 API</strong>
                  <small>OpenAI 兼容接口</small>
                  {s.summaryProvider === "api" && <CheckCircle2 size={16} />}
                </button>
              </div>
              {s.summaryProvider === "codex" ? (
                <>
                  <label className="field">
                    Codex 可执行文件
                    <div className="input-with-button">
                      <input
                        value={s.codexPath}
                        onChange={(e) => change("codexPath", e.target.value)}
                      />
                      <button
                        className="secondary"
                        onClick={async () => {
                          const p = await api.chooseCodex();
                          if (p) change("codexPath", p);
                        }}
                      >
                        选择
                      </button>
                    </div>
                  </label>
                  <div className="connection-result success">
                    <CheckCircle2 size={16} />
                    {health?.codexInstalled
                      ? "已检测到 Codex CLI"
                      : "尚未找到 Codex CLI"}
                  </div>
                  <p className="field-help">
                    使用 Codex
                    已有登录状态。点击“生成纪要”后启动一次整理任务；资料中的发言只作为数据，原始记录不会被覆盖。
                  </p>
                </>
              ) : (
                <>
                  <label className="field">
                    API Base URL
                    <input
                      value={s.apiBase}
                      onChange={(e) => change("apiBase", e.target.value)}
                      placeholder="https://example.com/v1"
                    />
                  </label>
                  <label className="field">
                    模型名称
                    <input
                      value={s.apiModel}
                      onChange={(e) => change("apiModel", e.target.value)}
                      placeholder="填写你的文字模型 ID"
                    />
                  </label>
                  <label className="field">
                    API Key{" "}
                    {s.apiKeyConfigured && (
                      <span className="configured">已配置</span>
                    )}
                    <input
                      type="password"
                      value={s.apiKey ?? ""}
                      placeholder="填写或替换密钥"
                      onChange={(e) => {
                        if (e.target.value) change("apiKey", e.target.value);
                        else
                          setS((c) => {
                            const n = { ...c };
                            delete n.apiKey;
                            return n;
                          });
                      }}
                    />
                  </label>
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      setS((c) => ({
                        ...c,
                        apiKey: "",
                        apiKeyConfigured: false,
                      }))
                    }
                  >
                    清除 API 密钥
                  </button>
                </>
              )}
              <div className="info-panel">
                <FileText size={17} />
                <span>
                  默认产出：纪要、思维导图、决策、待办及待确认问题。人工重点优先，关键结论保留原文出处。
                </span>
              </div>
            </>
          )}
          {tab === "storage" && (
            <>
              <div className="settings-section-title">
                <div className="settings-title-icon">
                  <Folder size={21} />
                </div>
                <div>
                  <h3>本地存储与 Obsidian</h3>
                  <p>录音、原文与批注始终保存在本机</p>
                </div>
              </div>
              <label className="field">
                会议数据保存根目录
                <div className="input-with-button">
                  <input
                    aria-label="会议数据保存根目录"
                    value={s.dataRoot}
                    onChange={(e) => change("dataRoot", e.target.value)}
                  />
                  <button
                    className="secondary"
                    onClick={async () => {
                      const p = await api.chooseDataRoot();
                      if (p) change("dataRoot", p);
                    }}
                  >
                    选择
                  </button>
                </div>
              </label>
              <p className="field-help">
                默认
                ~/.ai-minutes。切换后迁移现有会议，保留旧目录备份；录制或整理期间不可切换。
              </p>
              <label className="field">
                Obsidian 库位置
                <div className="input-with-button">
                  <input
                    value={s.vaultPath}
                    onChange={(e) => change("vaultPath", e.target.value)}
                  />
                  <button
                    className="secondary"
                    onClick={async () => {
                      const p = await api.chooseVault();
                      if (p) change("vaultPath", p);
                    }}
                  >
                    <FolderOpen size={15} />
                    选择
                  </button>
                </div>
              </label>
              <label className="field">
                库内会议目录
                <input
                  value={s.vaultFolder}
                  onChange={(e) => change("vaultFolder", e.target.value)}
                />
              </label>
              <div className="info-panel">
                <CheckCircle2 size={17} />
                <span>
                  自动关联已开启：开始录音即建立会议入口，录音、原文和分类批注持续关联；AI
                  整理完成后自动更新纪要、思维导图、待办和决策。
                </span>
              </div>
              <label className="field">
                FFmpeg 路径
                <input
                  value={s.ffmpegPath}
                  onChange={(e) => change("ffmpegPath", e.target.value)}
                />
              </label>
              <p className="field-help">
                用于导入其他格式录音和导出重点音频。
                {health?.ffmpeg
                  ? "已检测到。"
                  : "当前未找到，请填写已安装路径。"}
              </p>
              <div className="storage-path">
                <HardDrive size={18} />
                <div>
                  <strong>App 数据目录</strong>
                  <code>{health?.dataPath || "检查中"}</code>
                </div>
              </div>
            </>
          )}
          {tab === "shortcuts" && (
            <>
              <div className="settings-section-title">
                <div className="settings-title-icon">
                  <Keyboard size={21} />
                </div>
                <div>
                  <h3>录制快捷键</h3>
                  <p>在其他应用中也能控制当前会议</p>
                </div>
              </div>
              {[
                {
                  key: "toggleRecording" as const,
                  label: "开始 / 结束录制",
                  help: "未录制时开始当前会议；录制中触发结束确认。",
                },
                {
                  key: "pauseRecording" as const,
                  label: "暂停 / 继续录制",
                  help: "切换当前录制的暂停状态。",
                },
                {
                  key: "newMeeting" as const,
                  label: "新建会议",
                  help: "打开新建会议窗口。",
                },
              ].map((item) => (
                <label className="field" key={item.key}>
                  {item.label}
                  <input
                    aria-label={item.label + "快捷键"}
                    value={s.shortcuts[item.key]}
                    onChange={(e) =>
                      change("shortcuts", {
                        ...s.shortcuts,
                        [item.key]: e.target.value,
                      })
                    }
                  />
                  <span className="shortcut-help">{item.help}</span>
                </label>
              ))}
              <div className="info-panel">
                <Keyboard size={17} />
                <span>
                  使用 CommandOrControl、Shift、Alt 与字母组合，例如
                  CommandOrControl+Shift+R。留空禁用。保存时检查冲突，结束录制始终需要确认。
                </span>
              </div>
            </>
          )}
          {tab === "appearance" && (
            <>
              <div className="settings-section-title">
                <div className="settings-title-icon">
                  <Sun size={21} />
                </div>
                <div>
                  <h3>你喜欢的阅读方式</h3>
                  <p>让每一段文字都舒服地留在眼前</p>
                </div>
              </div>
              <div className="theme-options">
                {[
                  { id: "light", label: "浅色", icon: Sun },
                  { id: "dark", label: "深色", icon: Moon },
                  { id: "system", label: "跟随系统", icon: Monitor },
                ].map((t) => (
                  <button
                    className={s.theme === t.id ? "selected" : ""}
                    key={t.id}
                    onClick={() => change("theme", t.id)}
                  >
                    <div className={"theme-preview " + t.id}>
                      <span />
                      <i />
                      <i />
                    </div>
                    <t.icon size={16} />
                    {t.label}
                    {s.theme === t.id && <Check size={15} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="settings-footer">
        <span>
          <ShieldCheck size={14} />
          更改后点击保存，密钥只在本机加密存储
        </span>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          保存设置
        </button>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
