export type Segment = {
  id: string;
  text: string;
  speaker: string;
  startMs: number;
  endMs: number;
  final: boolean;
  edited?: boolean;
  originalText?: string;
};
export type AnnotationType = "highlight" | "action" | "decision" | "question";
export type Annotation = {
  type?: AnnotationType;
  id: string;
  quote: string;
  note: string;
  segmentIds: string[];
  startMs: number;
  endMs: number;
  createdAt: string;
};
export type Summary = {
  overview: string;
  topics: { title: string; detail: string; sourceIds: string[] }[];
  decisions: { text: string; sourceIds: string[] }[];
  actions: {
    text: string;
    owner: string;
    deadline: string;
    sourceIds: string[];
  }[];
  openQuestions: string[];
  mindmap: { title: string; branches: { title: string; items: string[] }[] };
};
export type Meeting = {
  id: string;
  title: string;
  createdAt: string;
  status: string;
  durationMs: number;
  segments: Segment[];
  annotations: Annotation[];
  speakers: Record<string, string>;
  peaks: number[];
  gaps: { startMs: number; endMs: number; reason: string }[];
  favorite: boolean;
  summary: Summary | null;
  summaryStatus?: string;
  summaryError?: string;
  summaryStale?: boolean;
  connection?: { state: string; message: string };
  lastError?: string;
  exportPath?: string;
  exportedAt?: string;
  syncState?: string;
  syncError?: string;
};
export type Settings = {
  dataRoot: string;
  shortcuts: {
    toggleRecording: string;
    pauseRecording: string;
    newMeeting: string;
  };
  appId: string;
  secretId?: string;
  secretKey?: string;
  secretIdConfigured: boolean;
  secretKeyConfigured: boolean;
  apiKey?: string;
  apiKeyConfigured: boolean;
  hotwords: string;
  micId: string;
  vaultPath: string;
  vaultFolder: string;
  codexPath: string;
  ffmpegPath: string;
  summaryProvider: "codex" | "api";
  apiBase: string;
  apiModel: string;
  theme: string;
  autoExport: boolean;
};
export type API = {
  list: () => Promise<Meeting[]>;
  get: (id: string) => Promise<Meeting>;
  create: (t: string) => Promise<Meeting>;
  patch: (id: string, p: Partial<Meeting>) => Promise<Meeting>;
  remove: (id: string) => Promise<boolean>;
  settings: () => Promise<Settings>;
  saveSettings: (s: Partial<Settings>) => Promise<Settings>;
  resolveAppId: () => Promise<Settings>;
  testTencent: () => Promise<string>;
  health: () => Promise<{
    codex: string;
    codexInstalled: boolean;
    ffmpeg: boolean;
    microphone: string;
    dataPath: string;
  }>;
  chooseDataRoot: () => Promise<string | null>;
  confirmStop: () => Promise<boolean>;
  chooseVault: () => Promise<string | null>;
  chooseCodex: () => Promise<string | null>;
  start: (id: string, offline?: boolean) => Promise<Meeting>;
  pause: () => Promise<Meeting>;
  resume: () => Promise<Meeting>;
  stop: () => Promise<Meeting>;
  audio: (data: ArrayBuffer) => void;
  annotate: (id: string, a: Partial<Annotation>) => Promise<Meeting>;
  editAnnotation: (
    id: string,
    aid: string,
    note: string,
    type?: AnnotationType,
  ) => Promise<Meeting>;
  deleteAnnotation: (id: string, aid: string) => Promise<Meeting>;
  editSegment: (
    id: string,
    sid: string,
    p: Partial<Segment>,
  ) => Promise<Meeting>;
  renameSpeaker: (id: string, s: string, n: string) => Promise<Meeting>;
  generate: (id: string) => Promise<Meeting>;
  cancelSummary: (id: string) => Promise<void>;
  exportObsidian: (id: string) => Promise<string>;
  exportBundle: (id: string) => Promise<string | null>;
  exportHighlights: (id: string) => Promise<string | null>;
  importAudio: () => Promise<Meeting | null>;
  retranscribe: (id: string) => Promise<Meeting>;
  reveal: (id: string) => Promise<void>;
  openObsidian: (id: string) => Promise<void>;
  onUpdate: (cb: (d: any) => void) => () => void;
};
declare global {
  interface Window {
    shengye: API;
  }
}
