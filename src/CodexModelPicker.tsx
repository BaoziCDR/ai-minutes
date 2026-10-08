import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { CodexModel } from "./types";
const effortNames: Record<string, string> = {
  none: "无",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
  ultra: "极高",
};
export function CodexModelPicker({
  path,
  model,
  effort,
  onModel,
  onEffort,
}: {
  path: string;
  model: string;
  effort: string;
  onModel: (model: string, effort: string) => void;
  onEffort: (effort: string) => void;
}) {
  const [models, setModels] = useState<CodexModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  async function refresh() {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await window.shengye.codexModels();
      if (id === request.current) setModels(result);
    } catch (e) {
      if (id === request.current) setError((e as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    setModels([]);
    void refresh();
    return () => {
      request.current++;
    };
  }, [path]);
  const chosen = model
    ? models.find((m) => m.id === model)
    : models.find((m) => m.isDefault);
  const efforts = chosen?.supportedReasoningEfforts.length
    ? chosen.supportedReasoningEfforts
    : ["medium"];
  return (
    <div className="codex-model-picker">
      <div className="settings-fields">
        <label className="field">
          模型
          <select
            aria-label="Codex 模型"
            value={model}
            disabled={loading}
            onChange={(e) => {
              const next =
                models.find((m) => m.id === e.target.value) ||
                models.find((m) => m.isDefault);
              const nextEffort = next?.supportedReasoningEfforts.includes(
                "medium",
              )
                ? "medium"
                : next?.defaultReasoningEffort || "medium";
              onModel(e.target.value, nextEffort);
            }}
          >
            <option value="">
              Codex 默认
              {models.find((m) => m.isDefault)
                ? `（${models.find((m) => m.isDefault)!.displayName}）`
                : ""}
            </option>
            {model && !models.some((m) => m.id === model) && (
              <option value={model}>{model}</option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          推理程度
          <select
            aria-label="Codex 推理程度"
            value={effort}
            disabled={loading}
            onChange={(e) => onEffort(e.target.value)}
          >
            {!efforts.includes(effort) && (
              <option value={effort} disabled>
                {effortNames[effort] || effort}（当前模型不支持）
              </option>
            )}
            {efforts.map((e) => (
              <option key={e} value={e}>
                {effortNames[e] || e}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="text-button"
        disabled={loading}
        onClick={() => void refresh()}
      >
        <RefreshCw size={14} className={loading ? "spin" : ""} />
        {loading ? "读取模型…" : "刷新模型"}
      </button>
      {error && (
        <p className="field-help danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
