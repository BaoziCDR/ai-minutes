export type SpeechBinding = {
  connectionId: string;
  profileId: string;
  mode: "realtime" | "after";
};
export type SpeechConnection = {
  id: string;
  name: string;
  type: "tencent" | "compatible";
  baseUrl: string;
  appId: string;
  enabled: boolean;
  revision: number;
  [key: string]: any;
};
export type SpeechProfile = {
  id: string;
  connectionId: string;
  name: string;
  kind: string;
  model: string;
  hotwords: string;
  enabled: boolean;
  revision: number;
  capabilities: any;
  test?: { at: string; ok: boolean };
};
export type SpeechConfig = {
  connections: SpeechConnection[];
  profiles: SpeechProfile[];
  bindings: { meeting: SpeechBinding | null; review: SpeechBinding | null };
  reviewBudgetSeconds: number;
};
export type AudioReview = {
  runId: string;
  state: string;
  uploadedMs: number;
  error: string;
  clips: Array<{
    startMs: number;
    endMs: number;
    reason: string;
    original: string;
    text?: string;
    error?: string;
    state: string;
    cached?: boolean;
    source?: { provider: string; model: string };
  }>;
};
export type CodexModel = {
  id: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
};
export type Segment = {
  id: string;
  text: string;
  speaker: string;
  startMs: number;
  endMs: number;
  final: boolean;
  timing?: "segment" | "clip" | "none";
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
  audioReview?: AudioReview;
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
  summaryGeneratedAt?: string;
  speechTask?: {
    id: string;
    state: string;
    completed: number;
    total: number;
    error: string;
    source: any;
  };
  pendingTranscript?: {
    taskId: string;
    segments: Segment[];
    source: any;
  } | null;
  transcriptionSource?: any;
  summaryStatus?: string;
  summaryError?: string;
  summaryStale?: boolean;
  connection?: { state: string; message: string };
  lastError?: string;
  exportPath?: string;
  exportedAt?: string;
  savedAt?: string;
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
  codexModel: string;
  codexReasoningEffort: string;
  ffmpegPath: string;
  summaryProvider: "codex" | "api";
  apiBase: string;
  apiModel: string;
  theme: string;
  autoExport: boolean;
};
export type API = {
  speechConfig: () => Promise<SpeechConfig>;
  speechMutate: (action: any) => Promise<SpeechConfig>;
  speechTest: (
    binding: SpeechBinding,
  ) => Promise<{ ok: boolean; message: string }>;
  speechResolveAppId: (id: string) => Promise<SpeechConfig>;
  speechTask: (id: string) => Promise<any>;
  resumeSpeechTask: (id: string) => Promise<Meeting>;
  cancelSpeechTask: (id: string) => Promise<boolean>;
  applyTranscript: (id: string) => Promise<Meeting>;

  list: () => Promise<Meeting[]>;
  get: (id: string) => Promise<Meeting>;
  create: (t: string) => Promise<Meeting>;
  patch: (id: string, p: Partial<Meeting>) => Promise<Meeting>;
  remove: (id: string) => Promise<boolean>;
  settings: () => Promise<Settings>;
  codexModels: () => Promise<CodexModel[]>;
  saveSettings: (s: Partial<Settings>) => Promise<Settings>;
  setShortcutCapture: (active: boolean) => Promise<boolean>;
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
  deleteSegment: (id: string, sid: string) => Promise<Meeting>;
  editSpeakers: (
    id: string,
    changes: { id: string; name: string; deleted: boolean }[],
  ) => Promise<Meeting>;
  renameSpeaker: (id: string, s: string, n: string) => Promise<Meeting>;
  generate: (id: string) => Promise<Meeting>;
  cancelSummary: (id: string) => Promise<void>;
  exportObsidian: (id: string) => Promise<string>;
  exportBundle: (id: string) => Promise<string | null>;
  exportHighlights: (id: string) => Promise<string | null>;
  importAudio: () => Promise<Meeting | null>;
  retranscribe: (id: string, binding?: SpeechBinding) => Promise<Meeting>;
  reveal: (id: string) => Promise<void>;
  openObsidian: (id: string) => Promise<void>;
  onUpdate: (cb: (d: any) => void) => () => void;
};
declare global {
  interface Window {
    shengye: API;
  }
}
