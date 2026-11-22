import type { CoordinationStageView, State } from "../types";
import type { OfficeCastMember, OfficeCastRole, OfficeModel } from "./model";
import { templateLabel } from "./templates";
import { XIcon } from "../components/Icons";

export type SceneLight = "auto" | "dawn" | "day" | "dusk" | "night";
export type SceneMotionTier = "calm" | "full" | "off";
export interface SceneMotion {
  tier: SceneMotionTier;
  /** 走位时长（ms） */
  walk: number;
  /** 姿态幅度（%） */
  amp: number;
  /** 打字动作 */
  typing: boolean;
}
export const DEFAULT_MOTION: SceneMotion = { tier: "calm", walk: 900, amp: 100, typing: true };

export function motionOf(prefs: Pick<ScenePrefs, "motion">): SceneMotion {
  return { ...DEFAULT_MOTION, ...(prefs.motion ?? {}) };
}

export const MOTION_LABEL: Record<SceneMotionTier, string> = { calm: "克制", full: "完整", off: "关闭" };

export interface ScenePrefs {
  name: string;
  template: "office" | "warroom" | "carrier";
  reviewGate: boolean;
  escalate: boolean;
  inject: boolean;
  showLinks: boolean;
  showLabels: boolean;
  light: SceneLight;
  motion?: SceneMotion;
  /** 航母舞台机位 */
  view?: CoordinationStageView;
}

export const STAGE_VIEW_LABEL: Record<CoordinationStageView, string> = {
  overview: "总览", bow: "舰首", island: "舰岛", landing: "着舰道", top: "俯视",
  screen: "大屏", desk: "长桌", gate: "工位",
};
/* 每台舞台各自支持的机位；配置面板与舞台头共用这一份 */
export const CARRIER_VIEWS: CoordinationStageView[] = ["overview", "bow", "island", "landing", "top"];
export const WARROOM_VIEWS: CoordinationStageView[] = ["overview", "screen", "desk", "gate"];

export function SceneConfigPanel({ state, model, cast, onCast, prefs, onPrefs, onClose, notify }: {
  state: State;
  model: OfficeModel;
  cast: OfficeCastMember[];
  onCast: (next: OfficeCastMember[]) => void;
  prefs: ScenePrefs;
  onPrefs: (next: Partial<ScenePrefs>) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  // 阵容里坐的是机器人；执行体只是它们此刻借的身体，所以在行里作为附注显示
  const projectAgents = state.agents.filter((a) => !a.projectId || a.projectId === state.activeProjectId);
  const bots = state.bots ?? [];
  const agentOf = (botId: string) => {
    const bot = bots.find((b) => b.id === botId);
    const agent = bot?.executorAgentId ? projectAgents.find((a) => a.id === bot.executorAgentId) : undefined;
    return { bot, agent };
  };
  const castIds = new Set(cast.map((c) => c.botId ?? bots.find((b) => b.executorAgentId === c.agentId)?.id).filter(Boolean) as string[]);
  const leadId = cast.find((c) => c.role === "lead")?.botId
    ?? cast.find((c) => c.role === "lead")?.agentId
    ?? model.lead?.id
    ?? null;
  const rows = bots.map((bot) => {
    const { agent } = agentOf(bot.id);
    const member = cast.find((c) => c.botId === bot.id) ?? cast.find((c) => !c.botId && c.agentId === bot.executorAgentId);
    const actor = model.actors.find((a) => a.id === bot.id);
    return {
      bot,
      executorName: agent?.alias || agent?.name || null,
      name: actor?.displayName || member?.displayName || bot.name,
      role: (member?.role ?? (bot.id === leadId ? "lead" : actor?.role === "reviewer" ? "reviewer" : "worker")) as OfficeCastRole,
      seat: member?.seat ?? actor?.seat ?? null,
      accent: actor?.accent || "slate",
    };
  });

  const update = (botId: string, patch: Partial<OfficeCastMember>, autoSeat = true) => {
    const current = rows
      .filter((r) => castIds.has(r.bot.id) || r.bot.id === botId)
      .map((r) => ({
        botId: r.bot.id,
        role: r.role,
        seat: r.seat,
        displayName: cast.find((c) => c.botId === r.bot.id)?.displayName,
      })) as OfficeCastMember[];
    let next = current.filter((c) => c.botId !== botId);
    const prev = current.find((c) => c.botId === botId) ?? { botId, role: "worker" as OfficeCastRole, seat: null };
    const merged: OfficeCastMember = { ...prev, ...patch };
    if (merged.role === "lead") {
      next = next.map((c) => (c.role === "lead" ? { ...c, role: "worker" as OfficeCastRole, seat: null } : c));
      merged.seat = null;
    } else if (merged.seat === null && autoSeat) {
      const used = new Set(next.map((c) => c.seat).filter((s): s is number => s !== null));
      const free = [0, 1, 2, 3, 4, 5].find((s) => !used.has(s));
      if (free !== undefined) merged.seat = free;
    }
    next.push(merged);
    onCast(next);
  };

  return (
    <aside className="off-inspector off-config-panel" aria-label="场景配置">
      <div className="off-insp-head">
        <div className="off-insp-title"><b>场景配置</b><span>{prefs.name} · {templateLabel(prefs.template)}</span></div>
        <span className="off-cfg-count">{rows.length} 人</span>
        <button type="button" className="off-icon-btn" title="关闭配置" onClick={onClose} aria-label="关闭配置"><XIcon size={14} /></button>
      </div>
      <div className="off-insp-body">
        <section className="off-insp-block">
          <div className="off-cfg-fields">
            <div className="off-cfg-field"><span>场景名称</span><input value={prefs.name} onChange={(e) => onPrefs({ name: e.target.value })} aria-label="场景名称" /></div>
            <div className="off-cfg-field"><span>舞台模板</span>
              <select value={prefs.template} onChange={(e) => onPrefs({ template: e.target.value as ScenePrefs["template"] })} aria-label="舞台模板">
                <option value="office">办公室 · Office</option>
                <option value="warroom">发射指挥 · Launch Control</option>
                <option value="carrier">航母 · 电磁弹射</option>
              </select>
            </div>
          </div>
        </section>

        <section className="off-insp-block">
          <div className="off-block-label">阵容 <span>{castIds.size || rows.length} 位机器人</span><button className="off-mini-link" onClick={() => { onCast([]); notify("已按机器人自动生成阵容"); }}>自动阵容</button></div>
          <div className="off-cast-list">
            {rows.map(({ bot, executorName, name, role, seat, accent }) => {
              const seatValue = role === "lead" ? "lead" : seat === null ? "standby" : String(seat);
              const onStage = castIds.has(bot.id) || role === "lead";
              return (
                <div className={`off-cast-row ${bot.id === leadId ? "lead" : ""} ${onStage ? "" : "off"}`} key={bot.id}>
                  <span className={`off-cast-dot accent-${accent}`} />
                  <span className="off-cast-name" title={`${bot.name}${executorName ? ` · 执行体 ${executorName}` : " · 未绑定执行体"}`}>
                    {name}
                    <em className="off-cast-sub">{executorName ? `执行体 ${executorName}` : "未绑定执行体"}</em>
                  </span>
                  <select className="off-cast-role" value={role} onChange={(e) => update(bot.id, { role: e.target.value as OfficeCastRole })} aria-label={`${name} 的角色`}>
                    <option value="lead">lead</option>
                    <option value="worker">worker</option>
                    <option value="reviewer">reviewer</option>
                  </select>
                  <select className="off-cast-seat" value={seatValue} onChange={(e) => {
                    const v = e.target.value;
                    update(bot.id, { seat: v === "standby" ? null : v === "lead" ? null : Number(v), ...(v === "lead" ? { role: "lead" as OfficeCastRole } : {}) }, v !== "standby");
                  }} aria-label={`${name} 的座位`}>
                    {role === "lead" ? <option value="lead">lead-desk</option> : null}
                    {[0, 1, 2, 3, 4, 5].map((s) => <option value={String(s)} key={s}>desk-0{s + 1}</option>)}
                    <option value="standby">standby</option>
                  </select>
                </div>
              );
            })}
          </div>
        </section>

        <section className="off-insp-block">
          <div className="off-block-label">编排 <span>默认值</span></div>
          <div className="off-toggle-row"><div><b>评审门</b><span>完成后进入待验收，不自动确认</span></div><button className={`off-switch ${prefs.reviewGate ? "on" : ""}`} onClick={() => onPrefs({ reviewGate: !prefs.reviewGate })} aria-pressed={prefs.reviewGate}><i /></button></div>
          <div className="off-toggle-row"><div><b>失败升级给 lead</b><span>失败后由主控机器人决定重试或换人</span></div><button className={`off-switch ${prefs.escalate ? "on" : ""}`} onClick={() => onPrefs({ escalate: !prefs.escalate })} aria-pressed={prefs.escalate}><i /></button></div>
          <div className="off-toggle-row"><div><b>角色提示注入</b><span>开启后写入 instructions，并记录审计</span></div><button className={`off-switch ${prefs.inject ? "on" : ""}`} onClick={() => { onPrefs({ inject: !prefs.inject }); if (!prefs.inject) notify("角色提示注入默认关闭；开启会改变执行体行为"); }} aria-pressed={prefs.inject}><i /></button></div>
        </section>

        <section className="off-insp-block">
          <div className="off-block-label">呈现</div>
          {prefs.template === "office" ? <div className="off-toggle-row"><div><b>舞台光照</b><span>自动跟随本地时间；也可锁定清晨 / 白天 / 黄昏 / 夜间</span></div>
            <select className="off-light-select" value={prefs.light} onChange={(e) => onPrefs({ light: e.target.value as SceneLight })} aria-label="舞台光照">
              <option value="auto">自动</option>
              <option value="dawn">清晨</option>
              <option value="day">白天</option>
              <option value="dusk">黄昏</option>
              <option value="night">夜间</option>
            </select>
          </div> : null}
          {prefs.template === "carrier" || prefs.template === "warroom" ? <div className="off-toggle-row"><div><b>舞台机位</b><span>{prefs.template === "carrier" ? "舰首 / 舰岛 / 着舰道 / 俯视" : "大屏 / 长桌 / 工位"}；舞台上也能拖动环绕、双击回总览</span></div>
            <select className="off-light-select" value={prefs.view ?? "overview"} onChange={(e) => onPrefs({ view: e.target.value as CoordinationStageView })} aria-label="舞台机位">
              {(prefs.template === "carrier" ? CARRIER_VIEWS : WARROOM_VIEWS).map((v) => <option key={v} value={v}>{STAGE_VIEW_LABEL[v]}</option>)}
            </select>
          </div> : null}
          <div className="off-toggle-row"><div><b>显示真实委派</b><span>只画运行中的 delegation</span></div><button className={`off-switch ${prefs.showLinks ? "on" : ""}`} onClick={() => onPrefs({ showLinks: !prefs.showLinks })} aria-pressed={prefs.showLinks}><i /></button></div>
          <div className="off-toggle-row"><div><b>显示姓名牌</b><span>关闭后只保留角色本体</span></div><button className={`off-switch ${prefs.showLabels ? "on" : ""}`} onClick={() => onPrefs({ showLabels: !prefs.showLabels })} aria-pressed={prefs.showLabels}><i /></button></div>
        </section>

        <div className="off-cfg-note"><b>边界：</b>场景只提供默认值与呈现；执行仍走 Mission / Delegation。</div>
      </div>
      <div className="off-insp-foot"><button className="off-icon-btn" title="关闭配置" aria-label="关闭配置" onClick={onClose}><XIcon size={14} /></button><span className="off-spacer" /><button className="btn primary off-insp-btn" onClick={() => notify("场景配置已保存（本地）")}>保存配置</button></div>
    </aside>
  );
}
