import { useEffect, useMemo, useState } from "react";
import type { State } from "../types";

export type Command = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ open, state, onClose, commands }: { open: boolean; state: State; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return commands.filter((c) => !query || c.label.toLowerCase().includes(query) || (c.hint || "").toLowerCase().includes(query));
  }, [commands, q]);

  useEffect(() => { if (open) { setQ(""); setIdx(0); } }, [open]);
  useEffect(() => { setIdx(0); }, [q]);

  if (!open) return null;
  const exec = (c?: Command) => { if (!c) return; c.run(); onClose(); };
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal palette" onClick={(e) => e.stopPropagation()}>
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
          placeholder="搜索…"
        />
        <div className="palette-list">
          {list.map((c, i) => (
            <button key={c.id} className={`palette-item ${i === idx ? "on" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(c)}>
              <span>{c.label}</span>{c.hint && <span className="tiny muted">{c.hint}</span>}
            </button>
          ))}
          {list.length === 0 && <div className="pane-empty">没有匹配的命令</div>}
        </div>
      </div>
    </div>
  );
}
