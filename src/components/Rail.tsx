type View = "workspace" | "projects" | "inbox" | "stats" | "hosts" | "settings";

const icon = (name: string) => {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "board") return <svg {...common}><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="10" y="4" width="5" height="10" rx="1.2" /><rect x="17" y="4" width="4" height="13" rx="1.2" /></svg>;
  if (name === "workspace") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M3 10h6M15 8h3M15 12h3" /></svg>;
  if (name === "projects") return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M3 11h18" /></svg>;
  if (name === "inbox") return <svg {...common}><path d="M4 5h16v10H4z" /><path d="M4 12h5l1.5 2h3L15 12h5" /><path d="M8 19h8" /></svg>;
  if (name === "hosts") return <svg {...common}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></svg>;
  if (name === "stats") return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
  if (name === "terminal") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
};

export function Rail({ view, onChange, inboxUnread = 0 }: { view: View; onChange: (v: View) => void; inboxUnread?: number }) {
  const items: { id: View; label: string }[] = [
    { id: "workspace", label: "工作区" },
    { id: "projects", label: "项目" },
    { id: "inbox", label: "收件箱" },
    { id: "stats", label: "统计" },
    { id: "hosts", label: "主机" },
  ];
  return (
    <nav className="rail">
      {items.map((it) => (
        <button key={it.id} className={`rail-btn ${view === it.id ? "on" : ""}`} onClick={() => onChange(it.id)}>
          {icon(it.id)}<span>{it.label}</span>
          {it.id === "inbox" && inboxUnread > 0 && <em className="rail-badge">{inboxUnread > 99 ? "99+" : inboxUnread}</em>}
        </button>
      ))}
      <div className="rail-bottom">
        <button className={`rail-btn ${view === "settings" ? "on" : ""}`} onClick={() => onChange("settings")}>{icon("settings")}<span>设置</span></button>
      </div>
    </nav>
  );
}
