import { useEffect, useState } from "react";

export type UndoAction = { label: string; run: () => void | Promise<void> };

/** 底部撤销条：删除/归档后给 6 秒反悔窗口 */
export function UndoBar({ action, onDone }: { action: UndoAction | null; onDone: () => void }) {
  const [left, setLeft] = useState(6);

  useEffect(() => {
    if (!action) return;
    setLeft(6);
    const timer = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) { window.clearInterval(timer); onDone(); return 0; }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [action, onDone]);

  if (!action) return null;
  return (
    <div className="undo-bar" role="status">
      <span>{action.label}</span>
      <button
        className="undo-btn"
        onClick={async () => { await action.run(); onDone(); }}
      >撤销 <em>{left}s</em></button>
    </div>
  );
}

/** 列表密度：紧凑 / 舒适，存在 localStorage */
export function useDensity(key: string) {
  const [dense, setDense] = useState(() => {
    try { return localStorage.getItem(`cmh.density.${key}`) === "1"; } catch { return false; }
  });
  const toggle = () => setDense((v) => {
    const next = !v;
    try { localStorage.setItem(`cmh.density.${key}`, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });
  return { dense, toggle };
}
