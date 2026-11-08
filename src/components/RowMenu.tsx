import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EllipsisIcon } from "./Icons";

/** 行内低频操作菜单：点击外部 / Esc 关闭，靠近底部时向上展开，portal 避免被滚动容器裁切。 */
export function RowMenu({ children, title = "更多操作" }: { children: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onResize = () => close();
    const onScroll = () => close();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextUp = rect.bottom + 260 > window.innerHeight;
    const left = Math.max(8, Math.min(rect.right - 188, window.innerWidth - 196));
    setUp(nextUp);
    setPos({ left, top: nextUp ? rect.top - 5 : rect.bottom + 5 });
    setOpen((value) => !value);
  };

  return (
    <div className={`row-menu ${open ? "open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="btn tiny-btn row-menu-trigger"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <EllipsisIcon size={14} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className={`row-menu-pop fixed ${up ? "up" : ""}`}
          style={{ left: pos.left, top: pos.top }}
          role="menu"
          onClick={() => close()}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
