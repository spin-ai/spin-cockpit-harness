import { useEffect, useRef, useState } from "react";

/**
 * 应用内确认框（替代原生 `window.confirm`）。
 *
 * 为什么不在每个页面各写一个 `<dialog>`：原生 confirm 是阻塞式全局调用，改起来最省事的是
 * 保持「一句调用拿答案」的形状 —— `await confirmDialog("...")`。这里用一个全局队列 + 一个
 * 常驻宿主实现，页面只管 await，样式沿用 `.modal`（不新造卡片体系）。
 *
 * 规矩：`danger` 只用于删除 / 丢弃这类不可恢复的动作；默认是普通确认。
 */
export type ConfirmOptions = {
  title?: string;
  desc?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
};

type Pending = { opts: ConfirmOptions; resolve: (value: boolean) => void; id: number };

let seq = 0;
let pending: Pending | null = null;
const listeners = new Set<(next: Pending | null) => void>();

const emit = () => { for (const fn of listeners) fn(pending); };

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const normalized: ConfirmOptions = typeof opts === "string" ? { desc: opts } : opts;
  return new Promise((resolve) => {
    // 同一时刻只留一个：后来的把前一个当取消结掉，避免叠窗
    if (pending) { const prev = pending; pending = null; prev.resolve(false); }
    pending = { opts: normalized, resolve, id: ++seq };
    emit();
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Pending | null>(pending);
  const okRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listeners.add(setReq);
    return () => { listeners.delete(setReq); };
  }, []);

  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const root = rootRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); settle(false); return; }
      if (event.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    root?.addEventListener("keydown", onKey);
    return () => root?.removeEventListener("keydown", onKey);
  }, [req?.id]);

  const settle = (value: boolean) => {
    const current = pending;
    pending = null;
    emit();
    current?.resolve(value);
  };

  if (!req) return null;
  const { opts } = req;
  return (
    <div
      className="modal-mask"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) settle(false); }}
    >
      <div ref={rootRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{opts.title || (opts.danger ? "确认删除？" : "确认继续？")}</h3>
        {opts.desc && <div className="approval-desc">{opts.desc}</div>}
        <div className="row between gap8">
          <button className="btn" onClick={() => settle(false)}>{opts.cancel || "取消"}</button>
          <button ref={okRef} className={`btn ${opts.danger ? "danger" : "primary"}`} onClick={() => settle(true)}>
            {opts.ok || (opts.danger ? "删除" : "确定")}
          </button>
        </div>
      </div>
    </div>
  );
}
