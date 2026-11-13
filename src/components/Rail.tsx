type View = "workspace" | "scene" | "projects" | "stats" | "hosts" | "git" | "settings" | "guide" | "notes" | "knowledge" | "memory" | "persona";

const icon = (name: string) => {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "board") return <svg {...common}><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="10" y="4" width="5" height="10" rx="1.2" /><rect x="17" y="4" width="4" height="13" rx="1.2" /></svg>;
  if (name === "workspace") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M3 10h6M15 8h3M15 12h3" /></svg>;
  if (name === "scene") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11M15 9v11" /></svg>;
  if (name === "projects") return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M3 11h18" /></svg>;
  if (name === "hosts") return <svg {...common}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></svg>;
  if (name === "git") return <svg {...common}><circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="9" r="2.4" /><path d="M6 8.4v7.2M8.3 6h4.3a3 3 0 0 1 3 3v.2" /></svg>;
  if (name === "stats") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  if (name === "terminal") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
  if (name === "guide") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.7.3-.9.9-.9 1.7M12 17h.01" /></svg>;
  if (name === "note") return <svg {...common}><path d="M5 4h9l5 5v11H5z" /><path d="M14 4v5h5M8 13h8M8 17h5" /></svg>;
  if (name === "knowledge") return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M8 7h7M8 11h5" /></svg>;
  if (name === "memory") return <svg {...common}><path d="M12 3v18M5 7v10M19 7v10M8.5 5v14M15.5 5v14" /></svg>;
  if (name === "persona") return <svg {...common}><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
};

export function Rail({ view, onChange, notesEnabled = false, badges = {} }: { view: View; onChange: (v: View) => void; notesEnabled?: boolean; badges?: Partial<Record<View, number>> }) {
  const items: { id: View; label: string }[] = [
    { id: "workspace", label: "工作区" },
    { id: "scene", label: "场景" },
    { id: "projects", label: "项目" },
    { id: "stats", label: "统计" },
    { id: "hosts", label: "主机" },
    { id: "git", label: "Git" },
    ...(notesEnabled ? [{ id: "notes" as View, label: "知识库" }] : []),
    { id: "memory" as View, label: "记忆" },
    { id: "persona" as View, label: "人像" },
  ];
  return (
    <nav className="rail">
      {items.map((it) => (
        <button key={it.id} className={`rail-btn ${view === it.id ? "on" : ""}`} onClick={() => onChange(it.id)} title={badges[it.id] ? `${it.label} · ${badges[it.id]} 项` : it.label}>
          {icon(it.id === "notes" ? "note" : it.id)}<span>{it.label}</span>
          {badges[it.id] ? <em className={`rail-badge ${it.id === "workspace" ? "run" : ""}`}>{badges[it.id]! > 99 ? "99+" : badges[it.id]}</em> : null}
        </button>
      ))}
      <div className="rail-bottom">
        <button className={`rail-btn ${view === "guide" ? "on" : ""}`} onClick={() => onChange("guide")}>{icon("guide")}<span>说明</span></button>
        <button className={`rail-btn ${view === "settings" ? "on" : ""}`} onClick={() => onChange("settings")}>{icon("settings")}<span>设置</span></button>
      </div>
    </nav>
  );
}
