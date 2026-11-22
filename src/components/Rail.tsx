import { useT } from "../i18n";

/**
 * rail：只放「对象」和「库」，不放入口性的容器（原型 owner-workspaces.html）。
 *
 *   BOT · 终端 │ 场景 │ 记忆 · 知识 · 人物 │ 视觉
 *
 * 项目 / 机器人 是两个 BOT / 终端工作台里的左栏列表（不占 rail），
 * Git 在终端的右栏「文件 / 会话 / Git」里。
 */
type View = "workspace" | "terminal" | "scene" | "projects" | "bots" | "git" | "settings" | "guide" | "notes" | "knowledge" | "memory" | "persona" | "zhulong" | "bot";

const icon = (name: string) => {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "bot") return <svg {...common}><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V5M9 13h.01M15 13h.01M9 16.5h6" /></svg>;
  if (name === "terminal") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>;
  if (name === "scene") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11M15 9v11" /></svg>;
  if (name === "memory") return <svg {...common}><path d="M12 3v18M5 7v10M19 7v10M8.5 5v14M15.5 5v14" /></svg>;
  if (name === "note") return <svg {...common}><path d="M5 4h9l5 5v11H5z" /><path d="M14 4v5h5M8 13h8M8 17h5" /></svg>;
  if (name === "persona") return <svg {...common}><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
  if (name === "scan") return <svg {...common}><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M8 12h8M12 8v8" /></svg>;
  if (name === "guide") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.7.3-.9.9-.9 1.7M12 17h.01" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
};

export function Rail({ view, onChange, notesEnabled = false, zhulongAvailable = false, badges = {} }: { view: View; onChange: (v: View) => void; notesEnabled?: boolean; zhulongAvailable?: boolean; badges?: Partial<Record<View, number>> }) {
  const t = useT();
  const items: { id: View; label: string }[] = [
    { id: "workspace", label: t("nav.workspace") },
    { id: "terminal", label: t("nav.terminal") },
  ];
  const mid: { id: View; label: string }[] = [{ id: "scene", label: t("nav.scene") }];
  const libs: { id: View; label: string }[] = [
    { id: "memory", label: t("nav.memory") },
    ...(notesEnabled ? [{ id: "notes" as View, label: t("nav.knowledge") }] : []),
    { id: "persona", label: t("nav.people") },
  ];
  const after: { id: View; label: string }[] = zhulongAvailable ? [{ id: "zhulong" as View, label: t("nav.visual") }] : [];

  const renderItem = (it: { id: View; label: string }) => (
    <button key={it.id} className={`rail-btn ${view === it.id ? "on" : ""}`} onClick={() => onChange(it.id)} title={badges[it.id] ? `${it.label} · ${badges[it.id]} 项` : it.label}>
      {icon(it.id === "workspace" ? "bot" : it.id === "notes" ? "note" : it.id === "zhulong" ? "scan" : it.id)}
      <span>{it.label}</span>
      {badges[it.id] ? <em className={`rail-badge ${it.id === "workspace" ? "run" : ""}`}>{badges[it.id]! > 99 ? "99+" : badges[it.id]}</em> : null}
    </button>
  );

  return (
    <nav className="rail">
      {items.map(renderItem)}
      <div className="rail-sep" />
      {mid.map(renderItem)}
      <div className="rail-sep" />
      {libs.map(renderItem)}
      {after.length > 0 && <div className="rail-sep" />}
      {after.map(renderItem)}
      <div className="rail-bottom">
        <button className={`rail-btn ${view === "guide" ? "on" : ""}`} onClick={() => onChange("guide")}>{icon("guide")}<span>{t("nav.guide")}</span></button>
        <button className={`rail-btn ${view === "settings" ? "on" : ""}`} onClick={() => onChange("settings")}>{icon("settings")}<span>{t("nav.settings")}</span></button>
      </div>
    </nav>
  );
}
