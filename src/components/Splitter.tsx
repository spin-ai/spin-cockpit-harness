import { useCallback, useEffect, useRef, useState } from "react";

/** 可持久化的面板尺寸；拖拽后写入 localStorage。 */
export function useStoredSize(key: string, initial: number, min: number, max: number) {
  const [value, setValue] = useState(() => {
    try {
      const raw = Number(localStorage.getItem(key));
      if (Number.isFinite(raw) && raw > 0) return Math.min(max, Math.max(min, raw));
    } catch { /* ignore */ }
    return initial;
  });

  const setSize = useCallback((next: number | ((prev: number) => number)) => {
    setValue((prev) => {
      const raw = typeof next === "function" ? next(prev) : next;
      return Math.round(Math.min(max, Math.max(min, raw)));
    });
  }, [min, max]);

  useEffect(() => {
    try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
  }, [key, value]);

  useEffect(() => {
    const reset = () => setValue(initial);
    window.addEventListener("harness:reset-layout", reset);
    return () => window.removeEventListener("harness:reset-layout", reset);
  }, [initial]);

  return [value, setSize] as const;
}

type Orientation = "vertical" | "horizontal";

/**
 * 面板分隔条。
 * - vertical：竖条，左右拖拽调宽度
 * - horizontal：横条，上下拖拽调高度
 */
export function Splitter({ orientation = "vertical", onDelta }: {
  orientation?: Orientation;
  onDelta: (delta: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;

  useEffect(() => {
    if (!dragging) return;
    const bodyClass = orientation === "vertical" ? "resizing-col" : "resizing-row";
    const move = (e: MouseEvent) => {
      const current = orientation === "vertical" ? e.clientX : e.clientY;
      const delta = current - last.current;
      if (!delta) return;
      last.current = current;
      onDeltaRef.current(delta);
    };
    const up = () => setDragging(false);
    document.body.classList.add(bodyClass);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove(bodyClass);
    };
  }, [dragging, orientation]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    if (orientation === "vertical") {
      if (e.key === "ArrowLeft") { e.preventDefault(); onDelta(-step); }
      if (e.key === "ArrowRight") { e.preventDefault(); onDelta(step); }
    } else {
      if (e.key === "ArrowUp") { e.preventDefault(); onDelta(-step); }
      if (e.key === "ArrowDown") { e.preventDefault(); onDelta(step); }
    }
  };

  return (
    <div
      className={`splitter ${orientation} ${dragging ? "on" : ""}`}
      role="separator"
      aria-orientation={orientation}
      tabIndex={0}
      onMouseDown={(e) => {
        e.preventDefault();
        last.current = orientation === "vertical" ? e.clientX : e.clientY;
        setDragging(true);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
