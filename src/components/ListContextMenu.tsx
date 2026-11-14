import { useEffect } from "react";
import { createPortal } from "react-dom";

export type CtxItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

/** 列表右键菜单：定位在鼠标处，点外部 / Esc / 滚动自动关闭 */
export function ListContextMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: CtxItem[]; onClose: () => void }) {
  useEffect(() => {
    if (!at) return;
    const onPointer = (ev: PointerEvent) => {
      const el = ev.target as HTMLElement;
      if (el.closest(".list-ctx")) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [at, onClose]);

  if (!at) return null;
  const width = 190;
  const left = Math.max(8, Math.min(at.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - (items.length * 28 + 16)));
  return createPortal(
    <div className="list-ctx" style={{ left, top, width }} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger ? "danger" : ""}
          disabled={item.disabled}
          onClick={() => { item.onSelect(); onClose(); }}
        >{item.label}</button>
      ))}
    </div>,
    document.body,
  );
}
