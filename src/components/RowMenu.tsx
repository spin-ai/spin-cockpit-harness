import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EllipsisIcon } from "./Icons";

/** 行内低频操作菜单：点击外部 / Esc 关闭，靠近底部时向上展开，portal 避免被滚动容器裁切。
 *  `openOnHover` 给「一个入口、悬停展开」的场景用：悬停开、移出延迟关（移到弹层里不关），点击仍可切。 */
export function RowMenu({ children, title = "更多操作", popClassName = "", trigger, triggerClassName = "btn tiny row-menu-trigger", openOnHover = false, align = "right", className = "" }: {
  children: ReactNode; title?: string; popClassName?: string;
  trigger?: ReactNode; triggerClassName?: string; openOnHover?: boolean;
  align?: "left" | "right"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  /** 悬停展开的那一次，移出才自动关；点击展开的保持到点击外部 / Esc */
  const hoverOpened = useRef(false);

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

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const nextUp = rect.bottom + 260 > window.innerHeight;
    const left = align === "left"
      ? Math.max(8, Math.min(rect.left, window.innerWidth - 196))
      : Math.max(8, Math.min(rect.right - 188, window.innerWidth - 196));
    setUp(nextUp);
    setPos({ left, top: nextUp ? rect.top - 5 : rect.bottom + 5 });
    return true;
  };

  const toggle = () => {
    if (!place()) return;
    hoverOpened.current = false;
    setOpen((value) => !value);
  };

  const cancelHoverClose = () => {
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };
  const openByHover = () => {
    if (open) { cancelHoverClose(); return; }
    if (!place()) return;
    hoverOpened.current = true;
    setOpen(true);
  };
  const scheduleHoverClose = () => {
    if (!openOnHover || !hoverOpened.current) return;
    cancelHoverClose();
    hoverTimer.current = window.setTimeout(() => { hoverTimer.current = null; hoverOpened.current = false; setOpen(false); }, 180);
  };
  useEffect(() => cancelHoverClose, []);

  return (
    <div
      className={`row-menu ${open ? "open" : ""} ${className}`.trim()}
      onPointerEnter={openOnHover ? openByHover : undefined}
      onPointerLeave={openOnHover ? scheduleHoverClose : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {trigger ?? <EllipsisIcon size={13} />}
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className={`row-menu-pop fixed ${up ? "up" : ""} ${popClassName}`.trim()}
          style={{ left: pos.left, top: pos.top }}
          role="menu"
          onClick={() => close()}
          onPointerEnter={openOnHover ? cancelHoverClose : undefined}
          onPointerLeave={openOnHover ? scheduleHoverClose : undefined}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}
