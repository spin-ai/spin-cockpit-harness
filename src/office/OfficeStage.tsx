import { useId, useMemo } from "react";
import type { CSSProperties } from "react";
import type { OfficeActor, OfficeModel, OfficeTone } from "./model";
import { RobotArt } from "./RobotArt";
import { ZONE_LABEL } from "./motion";
import "./workbench.css";

/** 舞台画布：与原型 docs/prototype/motion-workbench.html 完全一致的坐标 */
export const STAGE_SIZE = { w: 1340, h: 540 };
const STATIONS = [
  { x: 344, y: 158 }, { x: 569, y: 158 }, { x: 794, y: 158 },
  { x: 344, y: 336 }, { x: 569, y: 336 }, { x: 794, y: 336 },
];
const LEAD = { x: 24, y: 176 };
export const ZONE_POS: Record<string, { left: number; top: number }> = {
  approval: { left: 518, top: 196 },
  review: { left: 1180, top: 500 },
  tea: { left: 150, top: 490 },
  standby: { left: 262, top: 500 },
  meeting: { left: 1075, top: 300 },
};
const ACCENT: Record<string, string> = {
  teal: "var(--green)", slate: "var(--fg-2)", indigo: "var(--indigo)", amber: "var(--amber)",
  orange: "var(--amber)", purple: "var(--purple)", red: "var(--red)", green: "var(--green)", brand: "var(--fg)",
};
const PHASE_LABEL: Record<string, string> = { dawn: "DAWN", day: "DAYLIGHT", dusk: "DUSK", night: "NIGHT" };

function phaseOf(ts: number) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

export function seatPosition(actor: OfficeActor) {
  if (actor.zone === "lead") return { left: LEAD.x + 184, top: LEAD.y + 136 };
  if (actor.zone === "desk" && actor.seat !== null) {
    const st = STATIONS[actor.seat];
    if (st) return { left: st.x + 142, top: st.y + 122 };
  }
  return ZONE_POS[actor.seat !== null && actor.zone === "standby" ? "standby" : actor.zone] || ZONE_POS.standby;
}

function Monitor({ keyText, tone, lines }: { keyText: string; tone: OfficeTone; lines?: number[] }) {
  const t = tone === "neutral" ? "idle" : tone === "lead" ? "run" : tone;
  const bars = (lines || [58, 42, 66]).map((w, i) => <i key={i} style={{ width: `${w}%` }} />);
  return (
    <span className={`monitor ${t}`}>
      <span className="monitor-bar"><i className="led" /><em>{keyText || "idle"}</em></span>
      <span className="monitor-screen">{bars}</span>
      <span className="monitor-stand" />
    </span>
  );
}

function Desktop({ lead = false, keyText = "", tone = "neutral", lines }: { lead?: boolean; keyText?: string; tone?: OfficeTone; lines?: number[] }) {
  return (
    <>
      <Monitor keyText={keyText} tone={tone} lines={lines} />
      <span className="chair" />
      <span className="table"><span className="table-top" /><span className="table-front" /></span>
      <span className="desk-mat" /><span className="pedestal" />
      <span className="keyboard" /><span className="papers" /><span className="mug" />
      {lead ? <span className="desk-lamp"><span /></span> : null}
    </>
  );
}

export function OfficeStage({ model, now, selectedId, onSelect, onOpenTask, light = "auto", showPaths = false, showLabels = true, walking, walkFrom, walkMs = 900, interactive = true }: {
  model: OfficeModel;
  now: number;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  light?: string;
  showPaths?: boolean;
  showLabels?: boolean;
  walking?: Set<string>;
  walkFrom?: Record<string, string>;
  walkMs?: number;
  interactive?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  const phase = light && light !== "auto" ? light : phaseOf(now);
  const clock = useMemo(() => {
    const d = new Date(now);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, [now]);
  const lightsOn = phase === "dusk" || phase === "night";
  const hasMeeting = model.actors.some((a) => a.zone === "meeting");
  const hasIdle = model.actors.some((a) => a.zone === "tea");

  const bySeat = useMemo(() => {
    const map = new Map<number, OfficeActor>();
    for (const a of model.actors) if (a.seat !== null) map.set(a.seat, a);
    return map;
  }, [model.actors]);

  const missionTask = model.lead?.task || model.actors.find((a) => a.primary === "mission")?.task || null;

  const paths = useMemo(() => {
    if (!showPaths) return [];
    return model.actors
      .filter((a) => ["approval", "review", "tea", "meeting", "standby"].includes(a.zone))
      .map((a) => {
        const from = a.zone === "lead" ? { left: LEAD.x + 184, top: LEAD.y + 136 } : a.seat !== null ? { left: STATIONS[a.seat].x + 142, top: STATIONS[a.seat].y + 122 } : ZONE_POS.standby;
        const to = seatPosition(a);
        return { id: a.agent.id, from, to, on: selectedId === a.agent.id };
      });
  }, [model.actors, selectedId, showPaths]);

  return (
    <div
      className={`stage ${hasMeeting ? "has-meeting" : ""} ${hasIdle ? "has-idle" : ""}`}
      data-light={phase}
      data-lights={lightsOn ? "1" : "0"}
      data-paths={showPaths ? "1" : "0"}
    >
      <div className="sunbeam" />
      <div className="lights" aria-hidden="true">
        <span className="ceil-lamp c1"><i /></span>
        <span className="ceil-lamp c2"><i /></span>
        <span className="lightpool p1" />
        <span className="lightpool p2" />
        <span className="floor-glow" />
      </div>
      <div className="clock"><b>{clock}</b><span>{PHASE_LABEL[phase] || "DAYLIGHT"}</span></div>

      <div className="window">
        <svg className="win-view" viewBox="0 0 178 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#c9d6e8" stopOpacity=".5" />
              <stop offset="1" stopColor="#f0e3cd" stopOpacity=".32" />
            </linearGradient>
            <linearGradient id={`${uid}-dusk`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8f7fa8" stopOpacity=".55" />
              <stop offset=".62" stopColor="#d9a06a" stopOpacity=".5" />
              <stop offset="1" stopColor="#f0c98d" stopOpacity=".55" />
            </linearGradient>
            <linearGradient id={`${uid}-night`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#141826" />
              <stop offset="1" stopColor="#232335" />
            </linearGradient>
          </defs>
          <rect width="178" height="100" fill={`url(#${uid}-sky)`} />
          <circle cx="132" cy="26" r="12" fill="#e8c88a" opacity=".5" />
          <path d="M0 78h20v22H0zM26 66h16v34H26zM48 74h24v26H48zM80 58h14v42H80zM100 70h22v30h-22zM128 62h18v38h-18zM152 76h26v24h-26z" fill="#8a8f98" opacity=".22" />
          <rect y="94" width="178" height="6" fill="#8a8f98" opacity=".16" />
          <g className="win-dusk">
            <rect width="178" height="100" fill={`url(#${uid}-dusk)`} />
            <circle cx="134" cy="66" r="11" fill="var(--amber)" opacity=".7" />
            <path d="M0 78h20v22H0zM26 66h16v34H26zM48 74h24v26H48zM80 58h14v42H80zM100 70h22v30h-22zM128 62h18v38h-18zM152 76h26v24h-26z" fill="var(--term-bg)" opacity=".55" />
          </g>
          <g className="win-night">
            <rect width="178" height="100" fill={`url(#${uid}-night)`} />
            <g className="win-stars">
              <circle cx="14" cy="14" r=".9" fill="#fff" opacity=".85" />
              <circle cx="42" cy="8" r=".7" fill="#fff" opacity=".6" />
              <circle cx="66" cy="22" r="1" fill="#fff" opacity=".8" />
              <circle cx="94" cy="12" r=".7" fill="#fff" opacity=".55" />
              <circle cx="112" cy="30" r=".8" fill="#fff" opacity=".7" />
              <circle cx="24" cy="34" r=".7" fill="#fff" opacity=".5" />
              <circle cx="156" cy="16" r=".9" fill="#fff" opacity=".75" />
            </g>
            <circle cx="136" cy="26" r="15" fill="var(--amber)" opacity=".12" />
            <circle cx="136" cy="26" r="8" fill="#f4eeda" opacity=".95" />
            <path d="M0 78h20v22H0zM26 66h16v34H26zM48 74h24v26H48zM80 58h14v42H80zM100 70h22v30h-22zM128 62h18v38h-18zM152 76h26v24h-26z" fill="var(--term-bg)" opacity=".85" />
            <g className="win-city">
              {[[6, 82], [12, 88], [30, 70], [34, 84], [54, 78], [64, 86], [84, 62], [87, 74], [106, 74], [114, 82], [132, 66], [140, 74], [158, 80], [164, 88]].map(([x, y], i) => (
                <rect key={i} x={x} y={y} width="2.4" height="2.6" fill="var(--amber)" opacity={i % 3 === 0 ? ".8" : i % 3 === 1 ? ".55" : ".7"} />
              ))}
            </g>
          </g>
        </svg>
        <span className="mullion v" /><span className="mullion h" />
        <span className="sill" />
      </div>

      <div className="pinboard"><i /><i /><i /></div>

      <div className="console">
        <span className="console-top" /><span className="console-body" />
        <i className="console-book b1" /><i className="console-book b2" /><i className="console-book b3" />
        <span className="console-plant"><i /><i /><span /></span>
      </div>

      <div className="whiteboard" role="button" tabIndex={0} title="打开 Mission"
        onClick={() => missionTask && onOpenTask?.(missionTask.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (missionTask) onOpenTask?.(missionTask.id); } }}>
        <div className="wb-head"><b>{model.board.title || "今日任务"}</b><em>{model.board.progress}</em></div>
        <div className="wb-bar"><i style={{ width: `${Math.min(100, Math.max(0, model.board.percent || 0))}%` }} /></div>
        {model.board.rows.slice(0, 3).map((row, i) => (
          <div key={`${row.key}-${i}`} className={`wb-step ${row.state === "doing" ? "doing" : row.state === "done" ? "done" : ""}`}>
            <i>{row.state === "done" ? "✓" : row.state === "doing" ? "◐" : "○"}</i><b>{row.title}</b><span>{row.tag}</span>
          </div>
        ))}
        {!model.board.rows.length ? <div className="wb-step"><i>○</i><b>没有进行中的任务</b><span>—</span></div> : null}
      </div>

      <button type="button" className={`prop approval ${model.approval.count ? "active" : ""}`}
        onClick={() => interactive && model.approval.actor && onSelect?.(model.approval.actor.agent.id)} title="审批台">
        <span className="approval-head"><i className="lamp" />审批台</span>
        <span className="tray-slot" />
        <span className="tray-paper"><i /><span>{model.approval.count ? model.approval.title : "没有待确认"}</span></span>
        <span className="tray-count" style={{ display: model.approval.count ? "block" : "none" }}>{model.approval.count}</span>
      </button>

      <div className="prop shelf" role="button" tabIndex={0} title="验收架"
        onClick={() => interactive && model.review.actor && onSelect?.(model.review.actor.agent.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (interactive && model.review.actor) onSelect?.(model.review.actor.agent.id); } }}>
        <div className="shelf-head">验收架 <em>{model.review.count}</em></div>
        <div className="shelf-paper"><i /><span>{model.review.count ? model.review.title : "没有待验收任务"}</span></div>
        <div className="shelf-paper dim"><i />最近验收记录</div>
        <div className="shelf-books"><i /><i /><i /><i /></div>
        <div className="shelf-plant"><i /><i /><span /></div>
      </div>

      <div className="lounge">
        <span className="rug" />
        <span className="sofa"><i /><i /><i /><span className="arm l" /><span className="arm r" /><span className="throw" /></span>
        <span className="coffee-table"><i /><i /><span className="book" /></span>
        <span className="floor-lamp"><span /></span>
        <span className="coffee-machine"><span className="steam"><i /><i /></span></span>
        <span className="lounge-plant"><i /><i /><span /></span>
      </div>

      <div className="plant p2"><i /><i /><i /><span className="pot" /></div>
      <div className="plant p3"><i /><i /><i /><span className="pot" /></div>
      <div className="plant p4"><i /><i /><i /><span className="pot" /></div>

      <div className="rooms" aria-hidden="true">
        <div className="room room-lead"><span className="room-tag"><b>经理室</b><em>manager</em></span></div>
        <div className="room room-work"><span className="room-tag"><b>工位区</b><em>workspace</em></span></div>
        <div className="room room-lounge"><span className="room-tag"><b>茶歇区</b><em>lounge</em></span></div>
        <div className="room room-meeting">
          <span className="room-tag"><b>会议室</b><em>{hasMeeting ? "会议中" : model.coordination.total ? `${model.coordination.done}/${model.coordination.total}` : "空闲"}</em></span>
          <span className="mr-screen" />
          <span className="mr-table" />
          {[0, 1, 2, 3].map((i) => {
            const m = model.coordination.members[i];
            return (
              <span key={i}
                className={`mr-chair c${i + 1} ${m ? `tone-${m.tone}` : "empty"} ${m && !m.onStage ? "off-stage" : ""}`}
                title={m ? `${m.name} · ${m.status}${m.onStage ? "" : "（不在阵容）"}` : "空位"}>
                {m ? m.name.slice(0, 1) : ""}
              </span>
            );
          })}
        </div>
      </div>

      <svg className="paths" viewBox={`0 0 ${STAGE_SIZE.w} ${STAGE_SIZE.h}`} preserveAspectRatio="none" aria-hidden="true">
        {paths.map((p) => (
          <g key={p.id}>
            <line x1={p.from.left} y1={p.from.top} x2={p.to.left} y2={p.to.top} className={p.on ? "on" : ""} />
            <circle cx={p.to.left} cy={p.to.top} r={p.on ? 6 : 4} className={p.on ? "on" : ""} />
          </g>
        ))}
      </svg>

      <div className="desks">
        {STATIONS.map((st, i) => {
          const actor = bySeat.get(i);
          const away = Boolean(actor && actor.zone !== "desk");
          return (
            <div key={i} className={`desk-unit ${away ? "away" : ""}`} style={{ left: st.x, top: st.y, "--accent": ACCENT[actor?.accent || "slate"] } as CSSProperties}>
              <Monitor keyText={actor?.task?.key || actor?.screen.key || ""} tone={actor?.tone || "neutral"} lines={actor?.screen.lines} />
              <span className="chair" />
              <span className="table"><span className="table-top" /><span className="table-front" /></span>
              <span className="desk-mat" /><span className="pedestal" />
              <span className="keyboard" /><span className="papers" /><span className="mug" />
              <span className="away-tag"><b>{actor ? `${actor.displayName} · ${actor.statusLabel}` : ""}</b><span>已离座</span></span>
            </div>
          );
        })}
        <div className={`desk-unit lead ${model.lead && model.lead.zone !== "lead" ? "away" : ""}`} style={{ left: LEAD.x, top: LEAD.y, width: 220, height: 230, "--accent": ACCENT[model.lead?.accent || "slate"] } as CSSProperties}>
          <Desktop lead keyText={model.lead?.screen.key || "MISSION"} tone={model.lead?.tone || "lead"} lines={model.lead?.screen.lines} />
          <span className="away-tag"><b>{model.lead ? `${model.lead.displayName} · ${model.lead.statusLabel}` : ""}</b><span>已离座</span></span>
        </div>
      </div>

      <div className="actors">
        {model.actors.map((a) => {
          const p = seatPosition(a);
          const seated = a.zone === "desk" || a.zone === "lead";
          const isWalking = Boolean(walking?.has(a.agent.id));
          const fromLabel = walkFrom?.[a.agent.id];
          return (
            <button
              key={a.agent.id}
              type="button"
              className={`actor ${seated ? "seated" : ""} zone-${a.zone} pose-${a.pose} tone-${a.tone} ${selectedId === a.agent.id ? "selected" : ""} ${isWalking ? "walking" : ""}`}
              style={{ left: p.left, top: p.top, "--accent": ACCENT[a.accent] || "var(--fg-2)" } as CSSProperties}
              onClick={(e) => { if (!onSelect) return; e.stopPropagation(); onSelect(a.agent.id); }}
              tabIndex={interactive ? 0 : -1}
              aria-label={`${a.displayName} · ${a.statusLabel}`}
            >
              <span className="bubble"><b>{a.tone === "fail" ? "!" : a.tone === "wait" ? "?" : ""}</b><span>{a.tone === "fail" ? "运行失败" : a.tone === "wait" ? "等待确认" : a.tone === "review" ? "待验收" : ""}</span></span>
              <span className="robot-wrap"><RobotArt tone={a.tone} /></span>
              {showLabels ? <span className={`plate tone-${a.tone}`}><i /><b>{a.displayName}</b><em>{a.statusLabel}</em></span> : null}
              {isWalking ? <span className="walkchip"><i /><span>{fromLabel || "工位"} → {ZONE_LABEL[a.zone]} · {(walkMs / 1000).toFixed(1)}s</span></span> : null}
            </button>
          );
        })}
      </div>

      {STATIONS.map((st, i) => (
        <span key={`cap-${i}`} className="desk-cap" style={{ left: st.x, top: st.y + 106 }} />
      ))}
      <span className="desk-cap lead" style={{ left: LEAD.x, top: LEAD.y + 114 }} />
    </div>
  );
}
