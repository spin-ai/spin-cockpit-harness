import type { CSSProperties } from "react";
import type { OfficeActor as OfficeActorModel, OfficeTone } from "./model";

function eyeFor(tone: OfficeTone) {
  if (tone === "wait") return <text className="off-r-char" x="26" y="36" textAnchor="middle" style={{ fill: "var(--amber)" }}>?</text>;
  if (tone === "fail") return <text className="off-r-char" x="26" y="36" textAnchor="middle" style={{ fill: "var(--red)" }}>×</text>;
  if (tone === "run" || tone === "lead") return <path className="off-r-happy" d="M21.4 32.2c1.4-2.1 2.9-2.1 4.3 0M29.1 32.2c1.4-2.1 2.9-2.1 4.3 0" />;
  return <circle className="off-r-eye" cx="26" cy="32" r="2.8" />;
}

export function OfficeRobot({ tone, className = "", withPaper = false }: { tone: OfficeTone; className?: string; withPaper?: boolean }) {
  return (
    <svg className={`off-robot ${className}`} viewBox="0 0 52 72" aria-hidden="true">
      <ellipse className="off-r-shadow" cx="26" cy="68" rx="14" ry="3" />
      <line className="off-r-antenna" x1="26" y1="15" x2="26" y2="7" />
      <circle className="off-r-tip" cx="26" cy="6" r="2.4" />
      <rect className="off-r-body" x="10" y="14" width="32" height="46" rx="16" />
      <ellipse className="off-r-gloss" cx="18" cy="25" rx="3.4" ry="7" transform="rotate(-18 18 25)" />
      <rect className="off-r-visor" x="15" y="23" width="22" height="16" rx="8" />
      {eyeFor(tone)}
      <path className="off-r-scarf" d="M12 47h28v5c0 4-3 7-7 7h-3l-4 5-4-5h-3c-4 0-7-3-7-7z" />
      <rect className="off-r-arm l" x="5" y="37" width="7" height="14" rx="3.5" />
      <rect className="off-r-arm r" x="40" y="37" width="7" height="14" rx="3.5" />
      <circle className="off-r-badge" cx="35" cy="54" r="2" />
      {withPaper || tone === "review" ? <rect className="off-r-paper" x="37" y="49" width="12" height="15" rx="1.5" /> : null}
    </svg>
  );
}


/** 2.5D 小人：身体正面 + 头顶高光（和工位的「桌面 + 桌子正面」同一投影） */
export function OfficeAvatarIso({ tone, accent = "slate" }: { tone: OfficeTone; accent?: string }) {
  const ring = tone === "run" ? "var(--green)" : tone === "wait" ? "var(--amber)" : tone === "fail" ? "var(--red)" : tone === "review" ? "var(--purple)" : "var(--border-strong)";
  const body = `var(--off-${accent}-soft, var(--surface-hover))`;
  return (
    <svg className="off-iso" viewBox="0 0 40 46" aria-hidden="true">
      <ellipse cx="20" cy="42" rx="11.5" ry="3.4" fill="rgba(0,0,0,.18)" />
      {/* 身体：肩宽、下摆略收，右下有一条正面暗边（和桌子正面同色系） */}
      <path d="M8.5 36.5c0-8 3.4-12.5 11.5-12.5s11.5 4.5 11.5 12.5z" fill={body} stroke={ring} strokeWidth="1.3" />
      <path d="M9.6 33.4c1.6 2.4 5.6 3.4 10.4 3.4s8.8-1 10.4-3.4c-.6 2.4-1.2 3.4-2.2 3.9H11.8c-1-.5-1.6-1.5-2.2-3.9z" fill="rgba(0,0,0,.14)" />
      {/* 头：圆形 + 顶部高光 */}
      <circle cx="20" cy="15.5" r="8.6" fill={`var(--off-${accent}, var(--fg-2))`} opacity=".95" />
      <circle cx="20" cy="15.5" r="8.6" fill="none" stroke={ring} strokeWidth="1.3" />
      <ellipse cx="17" cy="11.6" rx="3.1" ry="1.9" fill="rgba(255,255,255,.38)" />
      {tone === "wait" ? <text x="20" y="20" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--amber)">?</text> : null}
      {tone === "fail" ? <text x="20" y="20" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--red)">×</text> : null}
    </svg>
  );
}

export function OfficeActorView({ actor, selected, walking, onSelect }: {
  actor: OfficeActorModel;
  selected: boolean;
  walking: boolean;
  onSelect: (id: string) => void;
}) {
  const bubble = actor.tone === "wait"
    ? <span className="off-bubble wait"><b>?</b>{actor.statusLabel}</span>
    : actor.tone === "fail"
      ? <span className="off-bubble fail"><b>!</b>运行失败</span>
      : null;
  const style = { "--off-accent": `var(--off-${actor.accent})` } as CSSProperties;
  return (
    <button
      type="button"
      className={`off-actor zone-${actor.zone} seat-${actor.seat ?? "x"} slot-${actor.slot ?? "x"} pose-${actor.pose} tone-${actor.tone} accent-${actor.accent} ${selected ? "selected" : ""} ${walking ? "walking" : ""}`}
      style={style}
      onClick={(e) => { e.stopPropagation(); onSelect(actor.agent.id); }}
      aria-label={`${actor.displayName}，${actor.statusLabel}，${actor.title}`}
      title={`${actor.displayName} · ${actor.statusLabel}`}
    >
      {bubble}
      <OfficeAvatarIso tone={actor.tone} accent={actor.accent} />
      {/* 坐姿的人：名字写在工位牌上（DeskUnit 里），头顶不再挂标签，避免压住显示器 */}
      {actor.zone === "desk" || actor.zone === "lead" ? null : <span className="off-nameplate" title={`${actor.displayName} · ${actor.role === "lead" ? "主控" : actor.role === "reviewer" ? "评审" : "执行"} · ${actor.statusLabel}`}>
        <b>{actor.displayName}</b>
        <span className="off-name-sub">
          <i className="off-role">{actor.role === "lead" ? "主控" : actor.role === "reviewer" ? "评审" : "执行"}</i>
          <em className={`off-status-pill ${actor.tone === "lead" || actor.tone === "neutral" ? "idle" : actor.tone}`}>{actor.statusLabel}</em>
        </span>
      </span>}
      {/* 正在做什么：来自真实 tool 消息，不点开也能看见 */}
      {actor.activity && actor.zone !== "desk" && actor.zone !== "lead" && (actor.tone === "run" || actor.tone === "wait") ? (
        <span className="off-act-chip" title={`${actor.activity.tool} · ${actor.activity.status} · ${actor.activity.target}`}>
          <b>{actor.activity.tool}</b>
          {actor.activity.target}
        </span>
      ) : null}
    </button>
  );
}
