import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export function displayShortcut(value: string) {
  return value
    .split("+")
    .map(
      (k) =>
        ({
          CommandOrControl: navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
          Command: "⌘",
          Control: "⌃",
          Alt: "⌥",
          Shift: "⇧",
          Space: "空格",
          Up: "↑",
          Down: "↓",
          Left: "←",
          Right: "→",
        })[k] || k,
    )
    .join("  ");
}
function accelerator(e: KeyboardEvent<HTMLInputElement>) {
  if (["Meta", "Control", "Alt", "Shift", "CapsLock"].includes(e.key))
    return null;
  if (!e.metaKey && !e.ctrlKey && !e.altKey)
    throw Error("请搭配 ⌘、Ctrl 或 Option 按键");
  // Physical codes keep Option+letter and non-Latin keyboard layouts stable.
  const key = /^(Key[A-Z]|Digit[0-9])$/.test(e.code)
    ? e.code.replace(/^(Key|Digit)/, "")
    : {
        Space: "Space",
        ArrowUp: "Up",
        ArrowDown: "Down",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        Enter: "Return",
        Backspace: "Backspace",
        Delete: "Delete",
        Home: "Home",
        End: "End",
        PageUp: "PageUp",
        PageDown: "PageDown",
      }[e.code] || (/^F\d{1,2}$/.test(e.code) ? e.code : "");
  if (!key) throw Error("请使用字母、数字、方向键或功能键组合");
  return [
    e.metaKey && "Command",
    e.ctrlKey && "Control",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function ShortcutRecorder({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => Promise<void>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const session = useRef(0);
  const saving = useRef(false);
  const finish = () => {
    session.current++;
    setCapturing(false);
    void window.shengye
      .setShortcutCapture(false)
      .catch((e) => setHint(e.message));
  };
  useEffect(() => {
    const blur = () => {
      input.current?.blur();
    };
    window.addEventListener("blur", blur);
    return () => {
      session.current++;
      window.removeEventListener("blur", blur);
      void window.shengye.setShortcutCapture(false).catch(() => {});
    };
  }, []);
  const begin = async () => {
    if (capturing || saving.current) return;
    const id = ++session.current;
    setHint("准备录入…");
    try {
      await window.shengye.setShortcutCapture(true);
      if (session.current !== id) return;
      setCapturing(true);
      setHint("请按组合键；Esc 取消，Delete 清除");
    } catch (e) {
      setHint((e as Error).message);
    }
  };
  const record = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setHint("");
      input.current?.blur();
      return;
    }
    if (!capturing || e.repeat || saving.current) return;
    try {
      const clear =
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        ["Backspace", "Delete"].includes(e.key);
      const next = clear ? "" : accelerator(e);
      if (next === null) return;
      saving.current = true;
      await onChange(next);
      setHint(clear ? "已禁用" : "已自动保存");
      input.current?.blur();
    } catch (error) {
      setHint((error as Error).message);
    } finally {
      saving.current = false;
    }
  };
  return (
    <div className="shortcut-recorder">
      <input
        ref={input}
        aria-label={label}
        readOnly
        value={
          capturing
            ? "请按组合键…"
            : displayShortcut(value) || "未设置 · 点击录入"
        }
        className={capturing ? "capturing" : ""}
        onFocus={() => void begin()}
        onClick={() => void begin()}
        onBlur={finish}
        onKeyDown={record}
      />
      {hint && (
        <span className="shortcut-capture-hint" role="status">
          {hint}
        </span>
      )}
    </div>
  );
}
