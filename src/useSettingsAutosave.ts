import { useRef, useState } from "react";
import type { Settings } from "./types";

// Queue only changed fields. Slow replies cannot overwrite newer edits, and a
// rejected path must not prevent unrelated settings from being saved.
export function useSettingsAutosave(
  initial: Settings,
  onSaved: (s: Settings) => void,
) {
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState("所有更改已自动保存");
  const [error, setError] = useState(false);
  const state = useRef({
    pending: new Map<keyof Settings, unknown>(),
    timers: new Map<keyof Settings, ReturnType<typeof setTimeout>>(),
    versions: new Map<keyof Settings, number>(),
    errors: new Map<keyof Settings, string>(),
    active: 0,
    chain: Promise.resolve(),
  }).current;
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  function report() {
    const failures = [...state.errors.values()];
    setError(failures.length > 0);
    setStatus(
      failures.length
        ? "未保存：" + failures.join("；")
        : state.active || state.pending.size
          ? "正在自动保存…"
          : "所有更改已自动保存",
    );
  }
  function write(key: keyof Settings): Promise<void> {
    clearTimeout(state.timers.get(key));
    state.timers.delete(key);
    if (!state.pending.has(key)) return state.chain;
    const value = state.pending.get(key);
    const version = state.versions.get(key);
    state.pending.delete(key);
    state.active++;
    report();
    const job = state.chain
      .then(async () => {
        if (state.versions.get(key) !== version) return;
        try {
          const next = await window.shengye.saveSettings({ [key]: value });
          savedCallback.current(next);
          setDraft((current) => ({
            ...current,
            secretIdConfigured: next.secretIdConfigured,
            secretKeyConfigured: next.secretKeyConfigured,
            apiKeyConfigured: next.apiKeyConfigured,
          }));
          if (state.versions.get(key) === version) state.errors.delete(key);
        } catch (e) {
          if (state.versions.get(key) === version) {
            state.errors.set(key, (e as Error).message);
            // Invalid shortcut changes retain the previously working binding.
            if (key === "shortcuts") {
              const current = await window.shengye.settings();
              setDraft((d) => ({ ...d, shortcuts: current.shortcuts }));
              state.errors.delete(key);
            }
          }
          throw e;
        }
      })
      .finally(() => {
        state.active--;
        report();
      });
    state.chain = job.catch(() => {});
    return job;
  }
  function change(
    key: keyof Settings,
    value: unknown,
    delay: number | null = 500,
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
    state.versions.set(key, (state.versions.get(key) || 0) + 1);
    state.errors.delete(key);
    state.pending.set(key, value);
    clearTimeout(state.timers.get(key));
    report();
    if (delay === 0) return write(key);
    if (delay !== null)
      state.timers.set(
        key,
        setTimeout(() => {
          void write(key).catch(() => {});
        }, delay),
      );
    return Promise.resolve();
  }
  function cancel(key: keyof Settings) {
    state.versions.set(key, (state.versions.get(key) || 0) + 1);
    state.pending.delete(key);
    state.errors.delete(key);
    clearTimeout(state.timers.get(key));
    setDraft((d) => ({ ...d, [key]: undefined }));
    report();
  }
  async function flush() {
    for (const key of state.pending.keys()) void write(key).catch(() => {});
    await state.chain;
    if (state.errors.size) throw Error([...state.errors.values()].join("；"));
  }
  return { draft, setDraft, change, cancel, flush, status, error };
}
