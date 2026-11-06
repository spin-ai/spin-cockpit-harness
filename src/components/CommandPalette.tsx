import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";

export type Command = { id: string; label: string; hint?: string; group?: string; run: () => void };

export function CommandPalette({ open, state, onClose, commands }: { open: boolean; state: State; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const list = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      if (!tokens.length) return true;
      const hay = `${c.label} ${c.hint || ""} ${c.group || ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [commands, q]);

  useEffect(() => { if (open) { setQ(""); setIdx(0); } }, [open]);
  useEffect(() => { setIdx(0); }, [q]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".palette-item.on")?.scrollIntoView({ block: "nearest" });
  }, [idx, list.length]);
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const items = () => [...root.querySelectorAll<HTMLElement>("input,button")].filter((el) => !(el as HTMLButtonElement).disabled);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = items();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const exec = (c?: Command) => { if (!c) return; c.run(); onClose(); };
  return (
    <div className="modal-mask" onClick={onClose}>
      <div ref={rootRef} className="modal palette" role="dialog" aria-modal="true" aria-label="命令面板" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); exec(list[idx]); }
          }}
          placeholder="搜索命令、任务、会话…"
        />
        <div className="palette-list" ref={listRef}>
          {list.map((c, i) => {
            const showGroup = Boolean(c.group) && c.group !== list[i - 1]?.group;
            return (
              <Fragment key={c.id}>
                {showGroup && <div className="palette-group">{c.group}</div>}
                <button className={`palette-item ${i === idx ? "on" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
                  <span className="ellipsis">{c.label}</span>{c.hint && <span className="tiny muted ellipsis">{c.hint}</span>}
                </button>
              </Fragment>
            );
          })}
          {list.length === 0 && <div className="pane-empty">没有匹配的命令</div>}
        </div>
      </div>
    </div>
  );
}
