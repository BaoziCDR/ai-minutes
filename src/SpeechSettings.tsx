import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import type {
  SpeechConfig,
  SpeechBinding,
  SpeechProfile,
  SpeechConnection,
} from "./types";
const api = window.shengye;
const kindNames: Record<string, string> = {
  "tencent-realtime": "腾讯实时识别",
  "tencent-file": "腾讯文件异步识别",
  "openai-transcription": "兼容录音转写",
  "openai-audio": "兼容音频理解",
};
export function SpeechBindingSelect({
  config,
  value,
  onChange,
  review = false,
  label = "语音模型",
}: {
  config: SpeechConfig;
  value: SpeechBinding | null;
  onChange: (b: SpeechBinding | null) => void;
  review?: boolean;
  label?: string;
}) {
  const primary = config.bindings.meeting;
  return (
    <label className="field">
      {label}
      <select
        aria-label={label}
        value={value?.profileId || ""}
        onChange={(e) => {
          const p = config.profiles.find((p) => p.id === e.target.value);
          onChange(
            p
              ? {
                  connectionId: p.connectionId,
                  profileId: p.id,
                  mode: p.kind === "tencent-realtime" ? "realtime" : "after",
                }
              : null,
          );
        }}
      >
        <option value="">{review ? "未配置" : "请选择模型"}</option>
        {config.profiles.map((p) => {
          const c = config.connections.find((c) => c.id === p.connectionId)!;
          const same =
            review &&
            primary?.connectionId === c.id &&
            config.profiles.find((x) => x.id === primary.profileId)?.kind ===
              p.kind &&
            config.profiles.find((x) => x.id === primary.profileId)?.model ===
              p.model;
          const reason =
            !p.enabled || !c.enabled
              ? "已停用"
              : !review && p.kind === "openai-audio"
                ? "仅用于复核"
                : same
                  ? "与主转写相同"
                  : !p.model
                    ? "未填写模型"
                    : "";
          return (
            <option key={p.id} value={p.id} disabled={!!reason}>
              {c.name} · {p.name || p.model}
              {reason ? `（${reason}）` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
export function SpeechSettings({
  mode = "providers",
  onError,
}: {
  mode?: "providers" | "meeting" | "review";
  onError?: (message: string) => void;
}) {
  const [config, setConfig] = useState<SpeechConfig | null>(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [testing, setTesting] = useState("");
  const latest = useRef<SpeechConfig | null>(null),
    queue = useRef(Promise.resolve()),
    mounted = useRef(true);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const reload = async () => {
    const c = await api.speechConfig();
    if (mounted.current) {
      latest.current = c;
      setConfig(c);
      setSelected((s) => s || c.connections[0]?.id || "");
    }
  };
  useEffect(() => {
    mounted.current = true;
    void reload().catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, []);
  const mutate = (action: any) => {
    const run = queue.current.then(async () => {
      try {
        const c = await api.speechMutate(action);
        latest.current = c;
        if (mounted.current) {
          setConfig(c);
          setError("");
        }
        return c;
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
        else onError?.((e as Error).message);
        throw e;
      }
    });
    queue.current = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  const save = (action: any) => void mutate(action).catch(() => {});
  if (!config) return <p>正在读取供应商…</p>;
  const connection = config.connections.find((c) => c.id === selected);
  const refs = (id: string) =>
    [
      config.bindings.meeting?.connectionId === id ? "会议转写" : "",
      config.bindings.review?.connectionId === id ? "录音复核" : "",
    ]
      .filter(Boolean)
      .join("、");
  const text = (
    label: string,
    value: string,
    action: (v: string) => any,
    password = false,
  ) => (
    <label className="field">
      {label}
      <input
        aria-label={label}
        type={password ? "password" : "text"}
        defaultValue={value}
        key={selected + label + value}
        onBlur={(e) => {
          if (e.target.value !== value) save(action(e.target.value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
  return (
    <div className="speech-settings">
      {mode === "providers" ? (
        <>
          <div className="settings-section-title">
            <h3>语音供应商</h3>
          </div>
          <div className="supplier-toolbar">
            <select
              aria-label="供应商配置"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setKeys({});
              }}
            >
              {config.connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.enabled ? "" : "（已停用）"}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              onClick={() =>
                void mutate({ op: "connection", patch: { type: "compatible" } })
                  .then((c) => setSelected(c.connections.at(-1)!.id))
                  .catch(() => {})
              }
            >
              <Plus size={14} />
              兼容 API
            </button>
            <button
              className="secondary"
              onClick={() =>
                void mutate({ op: "connection", patch: { type: "tencent" } })
                  .then((c) => setSelected(c.connections.at(-1)!.id))
                  .catch(() => {})
              }
            >
              <Plus size={14} />
              腾讯云
            </button>
          </div>
          {connection && (
            <div key={connection.id}>
              <div className="settings-fields">
                {text("配置名称", connection.name, (v) => ({
                  op: "connection",
                  id: selected,
                  patch: { name: v },
                }))}
                {text("服务地址", connection.baseUrl, (v) => ({
                  op: "connection",
                  id: selected,
                  patch: { baseUrl: v },
                }))}
              </div>
              {connection.type === "tencent" && (
                <div className="input-with-button">
                  {text("AppID", connection.appId || "", (v) => ({
                    op: "connection",
                    id: selected,
                    patch: { appId: v },
                  }))}
                  <button
                    className="secondary"
                    onClick={() =>
                      void api
                        .speechResolveAppId(selected)
                        .then((c) => {
                          latest.current = c;
                          setConfig(c);
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    自动获取
                  </button>
                </div>
              )}
              <div className="settings-fields">
                {(connection.type === "tencent"
                  ? ["secretId", "secretKey"]
                  : ["apiKey"]
                ).map((k) => (
                  <label className="field" key={k}>
                    {k}
                    {connection[k + "Configured"] && (
                      <span className="configured">已配置</span>
                    )}
                    <input
                      type="password"
                      aria-label={k}
                      autoComplete="off"
                      placeholder="输入以替换"
                      value={keys[k] || ""}
                      onChange={(e) =>
                        setKeys((c) => ({ ...c, [k]: e.target.value }))
                      }
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value)
                          void mutate({
                            op: "connection",
                            id: selected,
                            patch: { [k]: value },
                          })
                            .then(() => {
                              if (mounted.current)
                                setKeys((c) =>
                                  c[k] === value ? { ...c, [k]: "" } : c,
                                );
                            })
                            .catch(() => {});
                      }}
                    />
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        save({
                          op: "connection",
                          id: selected,
                          patch: { [k]: "" },
                        })
                      }
                    >
                      清除
                    </button>
                  </label>
                ))}
              </div>
              <div className="supplier-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={connection.enabled}
                    onChange={(e) =>
                      save({
                        op: "connection",
                        id: selected,
                        patch: { enabled: e.target.checked },
                      })
                    }
                  />{" "}
                  启用
                </label>
                <span>{refs(selected) && `引用：${refs(selected)}`}</span>
                <button
                  className="text-button danger-text"
                  onClick={() =>
                    void mutate({
                      op: "delete",
                      entity: "connection",
                      id: selected,
                    })
                      .then((c) => setSelected(c.connections[0]?.id || ""))
                      .catch(() => {})
                  }
                >
                  <Trash2 size={14} />
                  删除连接
                </button>
              </div>
              {config.profiles
                .filter((p) => p.connectionId === selected)
                .map((profile) => (
                  <div className="supplier-model" key={profile.id}>
                    <div className="settings-fields">
                      {text("模型名称", profile.name, (v) => ({
                        op: "profile",
                        id: profile.id,
                        patch: { name: v },
                      }))}
                      <label className="field">
                        接口类型
                        <select
                          aria-label={"接口类型 " + profile.name}
                          value={profile.kind}
                          onChange={(e) =>
                            save({
                              op: "profile",
                              id: profile.id,
                              patch: { kind: e.target.value },
                            })
                          }
                        >
                          {Object.entries(kindNames)
                            .filter(([k]) =>
                              k.startsWith(
                                connection.type === "tencent"
                                  ? "tencent"
                                  : "openai",
                              ),
                            )
                            .map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    {text("模型 ID", profile.model, (v) => ({
                      op: "profile",
                      id: profile.id,
                      patch: { model: v },
                    }))}
                    {profile.kind === "tencent-realtime" &&
                      text("识别热词", profile.hotwords || "", (v) => ({
                        op: "profile",
                        id: profile.id,
                        patch: { hotwords: v },
                      }))}
                    <div className="capability-tags">
                      <span>
                        {profile.capabilities.execution === "realtime"
                          ? "实时"
                          : profile.capabilities.execution === "async-job"
                            ? "异步任务"
                            : "会后转写"}
                      </span>
                      <span>
                        分人：
                        {profile.capabilities.diarization === "supported"
                          ? "支持"
                          : profile.capabilities.diarization === "unsupported"
                            ? "不支持"
                            : "未知"}
                      </span>
                      <span>
                        时间戳：
                        {profile.capabilities.timestamps === "segment"
                          ? "句级"
                          : "未知"}
                      </span>
                      <span>
                        {profile.test
                          ? profile.test.ok
                            ? "请求已验证"
                            : "测试失败"
                          : "未验证"}
                      </span>
                    </div>
                    <details className="speech-capabilities">
                      <summary>能力详情</summary>
                      <dl>
                        {Object.entries({
                          临时字幕: profile.capabilities.partial,
                          说话人连续性: profile.capabilities.speakerContinuity,
                          音频理解: profile.capabilities.audioUnderstanding,
                          断线恢复: profile.capabilities.reconnect,
                          恢复任务查询: profile.capabilities.resumeQuery,
                          远端取消: profile.capabilities.remoteCancel,
                        }).map(([name, value]) => (
                          <div key={name}>
                            <dt>{name}</dt>
                            <dd>
                              {value === "supported"
                                ? "支持"
                                : value === "unsupported"
                                  ? "不支持"
                                  : "未知"}
                            </dd>
                          </div>
                        ))}
                        <div>
                          <dt>音频</dt>
                          <dd>WAV · 16 kHz · 单段最多 60 秒</dd>
                        </div>
                        <div>
                          <dt>能力来源</dt>
                          <dd>
                            {connection.type === "tencent"
                              ? "适配器接口声明"
                              : "接口协议；模型能力待验证"}
                          </dd>
                        </div>
                        {profile.test && (
                          <div>
                            <dt>最近测试</dt>
                            <dd>
                              {new Date(profile.test.at).toLocaleString(
                                "zh-CN",
                              )}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                    <div className="supplier-actions">
                      <label>
                        <input
                          type="checkbox"
                          checked={profile.enabled}
                          onChange={(e) =>
                            save({
                              op: "profile",
                              id: profile.id,
                              patch: { enabled: e.target.checked },
                            })
                          }
                        />{" "}
                        启用模型
                      </label>
                      <button
                        className="secondary"
                        disabled={!!testing}
                        onClick={async () => {
                          setTesting(profile.id);
                          try {
                            await queue.current;
                            const r = await api.speechTest({
                              connectionId: selected,
                              profileId: profile.id,
                              mode: "after",
                            });
                            setError(r.message);
                            await reload();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setTesting("");
                          }
                        }}
                      >
                        <RefreshCw size={14} />
                        {testing === profile.id ? "测试中…" : "测试音频"}
                      </button>
                      <button
                        className="text-button danger-text"
                        onClick={() =>
                          save({
                            op: "delete",
                            entity: "profile",
                            id: profile.id,
                          })
                        }
                      >
                        删除模型
                      </button>
                    </div>
                  </div>
                ))}
              <button
                className="secondary"
                onClick={() =>
                  save({ op: "profile", connectionId: selected, patch: {} })
                }
              >
                <Plus size={14} />
                添加模型
              </button>
            </div>
          )}
        </>
      ) : mode === "meeting" ? (
        <>
          <h3>会议转写</h3>
          <SpeechBindingSelect
            config={config}
            value={config.bindings.meeting}
            onChange={(b) =>
              save({ op: "binding", role: "meeting", binding: b })
            }
            label="会议转写模型"
          />
          {config.bindings.meeting && (
            <label className="field">
              转写模式
              <select
                aria-label="转写模式"
                value={config.bindings.meeting.mode}
                onChange={(e) =>
                  save({
                    op: "binding",
                    role: "meeting",
                    binding: {
                      ...config.bindings.meeting,
                      mode: e.target.value,
                    },
                  })
                }
              >
                <option
                  value="realtime"
                  disabled={
                    config.profiles.find(
                      (p) => p.id === config.bindings.meeting?.profileId,
                    )?.kind !== "tencent-realtime"
                  }
                >
                  实时字幕
                </option>
                <option value="after">录音结束后自动转写</option>
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          <h3>录音复核</h3>
          <SpeechBindingSelect
            config={config}
            value={config.bindings.review}
            review
            onChange={(b) =>
              save({ op: "binding", role: "review", binding: b })
            }
            label="独立复核模型"
          />
          <label className="field">
            每次最多复核（分钟）
            <input
              type="number"
              min={1}
              max={120}
              aria-label="复核时长上限"
              defaultValue={config.reviewBudgetSeconds / 60}
              onBlur={(e) =>
                save({ op: "budget", seconds: Number(e.target.value) * 60 })
              }
            />
          </label>
        </>
      )}
      {error && (
        <p className="connection-result" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
