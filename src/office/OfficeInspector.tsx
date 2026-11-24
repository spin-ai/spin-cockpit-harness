import type { CSSProperties } from "react";
import type { OfficeActor, OfficeModel, OfficeTone } from "./model";
import { RobotArt } from "./RobotArt";
import { XIcon } from "../components/Icons";
import { CAP_LABEL, DECISION_LABEL } from "../labels";
import { hhmmss } from "../ui";
import type { SceneMotion } from "./SceneConfigPanel";
import { a11yChecks, motionOf, poseLabel, triggerOf, ZONE_LABEL } from "./motion";

type Act = (type: string, payload?: unknown) => Promise<unknown>;

const ACTIVE = new Set(["queued", "running", "waiting_input", "waiting_plan", "waiting_children"]);
/** 回合决策：舞台上「转人工 / 被拦 / 沉默」也是状态，不只是没说话 */
const DELEGATION_STATUS: Record<string, string> = {
  proposed: "待批准", queued: "排队", running: "进行中", waiting_input: "等待确认",
  completed: "已完成", accepted: "已接受", rework: "返工", failed: "失败", cancelled: "已取消",
};
const RUN_STATUS: Record<string, string> = {
  queued: "排队", running: "运行中", waiting_input: "等待确认", waiting_plan: "等待计划",
  waiting_children: "等待子任务", completed: "完成", failed: "失败", cancelled: "已取消", interrupted: "中断",
};
const tokenText = (n: number | null | undefined) => n == null ? "未上报" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function toneClass(tone: OfficeTone) {
  return tone === "lead" ? "idle" : tone === "neutral" ? "idle" : tone;
}

export function OfficeInspector({ actor, model, act, notify, onOpenTask, onOpenThread, onOpenTerminal, onClose, motion, onMotion, onResetMotion, lastWalk, onLocate }: {
  actor: OfficeActor;
  model: OfficeModel;
  act: Act;
  notify: (message: string) => void;
  onOpenTask: (id: string) => void;
  onOpenThread: (id: string) => void;
  onOpenTerminal: (cwd: string, terminalId?: string) => void;
  onClose: () => void;
  motion: SceneMotion;
  onMotion: (patch: Partial<SceneMotion>) => void;
  onResetMotion: () => void;
  lastWalk?: { at: number; from: string; to: string } | null;
  onLocate?: (at: number) => void;
}) {
  const task = actor.task;
  const approval = actor.approval;
  const terminal = actor.terminal;
  const tail = (terminal?.tail || "").replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-5).join("\n");
  const checks = a11yChecks(actor);
  const stop = async () => {
    if (!actor.run) return;
    await act("stop", { runId: actor.run.id });
    notify(`已请求停止 ${actor.run.id}`);
  };
  const retry = async () => {
    if (!task) return;
    await act("retry", { id: task.id });
    notify(`已重试 ${task.key}`);
  };
  const decide = async (allow: boolean) => {
    if (!approval) return;
    await act("approval", { id: approval.id, allow, optionId: approval.options?.[0]?.id });
    notify(allow ? "已批准，任务继续执行" : "已拒绝这次操作");
  };
  const primary = (() => {
    if (approval) return <button className="btn primary" onClick={() => void decide(true)}>批准</button>;
    if (actor.primary === "review" && task) return <button className="btn primary" onClick={() => onOpenTask(task.id)}>去验收</button>;
    if (actor.primary === "retry" && task) return <button className="btn primary" onClick={() => void retry()}>重试</button>;
    if (actor.primary === "mission" && task) return <button className="btn primary" onClick={() => onOpenTask(task.id)}>打开 Mission</button>;
    if (actor.primary === "task" && task) return <button className="btn primary" onClick={() => onOpenTask(task.id)}>打开任务</button>;
    if (actor.primary === "session" && actor.thread) return <button className="btn primary" onClick={() => onOpenThread(actor.thread!.id)}>打开会话</button>;
    return <button className="btn primary" disabled>待命中</button>;
  })();
  const showsTask = Boolean(task) && actor.primary !== "task";
  const zone = ZONE_LABEL[actor.zone];

  return (
    <aside className="inspector" aria-label="动效检查器">
      <div className="insp-head">
        <div className="insp-avatar" style={{ "--accent": `var(--${actor.accent === "teal" ? "green" : actor.accent === "slate" ? "fg-2" : actor.accent === "orange" ? "amber" : actor.accent})` } as CSSProperties}>
          <RobotArt tone={actor.tone} />
        </div>
        <div className="insp-title">
          <b>{actor.displayName} <em>{actor.role === "lead" ? "主控" : actor.role === "reviewer" ? "评审" : "执行"}</em></b>
          <span>
            {actor.role === "lead" ? "主控" : actor.role === "reviewer" ? "评审" : "执行"}
            {actor.bot ? ` · 机器人 · 执行体 ${actor.agent ? (actor.agent.alias || actor.agent.name) : "未绑定"}` : " · 执行体"}
            {actor.agent ? ` · ${actor.hostName}` : ""}
          </span>
        </div>
        <button type="button" className="icon-btn" title="取消选中（Esc）" onClick={onClose} aria-label="取消选中（Esc）"><XIcon size={14} /></button>
      </div>

      <div className="insp-status">
        <span className={`pill ${toneClass(actor.tone)}`}>{actor.statusLabel}</span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{zone}</span>
        <span className="meta">{actor.activity ? `${actor.activity.tool} · ${actor.activity.status} · ${actor.activity.target}` : actor.title}</span>
      </div>

      <div className="insp-body">
        {actor.bot ? (
          <div className="block">
            <div className="block-label">机器人<span>{CAP_LABEL[actor.bot.capability || "read"]}{actor.agent ? "" : " · 未绑定执行体"}</span></div>
            <dl className="map">
              <dt>职责</dt><dd>{actor.bot.persona?.mission || "还没写职责"}</dd>
              <dt>语气</dt><dd>{actor.bot.persona?.tone || "还没写语气"}</dd>
              <dt>最近一次</dt>
              <dd>
                {actor.botTurn
                  ? `${DECISION_LABEL[actor.botTurn.decision || ""] || "回合"}${actor.botTurn.reason ? ` · ${actor.botTurn.reason}` : ""}`
                  : actor.agent ? "还没有回合记录" : "选一个执行体才能干活"}
              </dd>
            </dl>
          </div>
        ) : null}

        <div className="block">
          <div className="block-label">状态 → 舞台<span>只读 · 来自 State</span></div>
          <dl className="map">
            <dt>触发</dt><dd className="mono">{triggerOf(actor)}</dd>
            <dt>区域</dt><dd>{zone} <span className="k">zone-{actor.zone}</span></dd>
            <dt>姿态</dt><dd>{poseLabel(actor.pose)} <span className="k">pose-{actor.pose}</span></dd>
            <dt>动效</dt><dd>{motion.tier === "off" ? "动效已关闭（静态）" : motionOf(actor)}</dd>
          </dl>
        </div>

        <div className="block">
          {lastWalk ? (
            <p className="reason"><b>最近一次走位</b> {hhmmss(lastWalk.at)} · {lastWalk.from} → {lastWalk.to} · {(motion.walk / 1000).toFixed(1)}s · <button className="mini-link" onClick={() => onLocate?.(lastWalk.at)}>在时间轴定位</button></p>
          ) : (
            <p className="reason"><b>最近一次走位</b> 过去 15 分钟没有 —— 这个角色的状态变化都发生在原地。{actor.tone === "fail" ? "失败不是「离开」，是「停在原地」。" : ""}</p>
          )}
        </div>

        <div className="block">
          <div className="block-label">关闭动效后<span>reduced-motion 等价检查</span></div>
          {checks.map((row, i) => (
            <div key={i} className={`a11y-row ${row.ok ? "ok" : "risk"}`}>
              <i>{row.ok ? "✓" : "!"}</i>
              <div><b>{row.title}</b><p>{row.text}</p></div>
            </div>
          ))}
        </div>

        <div className="block">
          <div className="block-label">在做什么<span>{model.projectName}</span></div>
          <dl className="map">
            <dt>任务</dt><dd>{task ? <><span className="k">{task.key}</span>{task.title}</> : actor.title}</dd>
            <dt>详情</dt><dd>{actor.detail}</dd>
          </dl>
          {tail ? (
            <div className="off-term" style={{ marginTop: 6 }}>
              <div className="off-term-head"><span className="off-led" />terminal · {terminal?.kind || "run"}</div>
              <pre>{tail}</pre>
            </div>
          ) : null}
        </div>

        {approval ? (
          <div className="block">
            <div className="block-label">等待你确认</div>
            <div className="off-approval-card">
              <b>{approval.title}</b>
              <p>{approval.description}</p>
            </div>
          </div>
        ) : null}

        {actor.tone === "fail" && actor.run?.error ? (
          <div className="block">
            <div className="block-label">失败原因</div>
            <div className="off-error-box">{actor.run.error}</div>
          </div>
        ) : null}

        {actor.role === "lead" && model.board.rows.length ? (
          <div className="block">
            <div className="block-label">Mission 计划<span>{model.board.progress}</span></div>
            <div className="off-plan-list">
              {model.board.rows.map((row, i) => (
                <div key={`${row.key}-${i}`} className={`off-plan-row ${row.state}`}>
                  <i>{row.state === "done" ? "✓" : row.state === "doing" ? "◐" : "○"}</i>
                  <b>{row.title}</b><span>{row.tag}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {actor.delegations.length ? (
          <div className="block">
            <div className="block-label">真实委派<span>{actor.delegations.length}</span></div>
            {actor.delegations.slice(0, 4).map((d) => (
              <div className="off-rel" key={d.id}><i /><span>{d.title} · {DELEGATION_STATUS[d.status] || d.status}</span></div>
            ))}
          </div>
        ) : null}

        <div className="block">
          <div className="block-label">进展<span>{actor.progress.tools} 步 · {actor.progress.thoughts} 次思考 · {actor.progress.replies} 条回复</span></div>
          {actor.activity ? (
            <div className="off-insp-now">
              <span className="off-mono">{new Date(actor.activity.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>
              <b>{actor.activity.tool}</b>
              <em>{actor.activity.status}</em>
              <span className="off-ellipsis" title={actor.activity.target}>{actor.activity.target}</span>
            </div>
          ) : (
            <p className="empty-line">{actor.statusLabel === "排队" ? "还在排队，尚未开始执行。" : "还没有可显示的动作。"}</p>
          )}
          {actor.feed.length ? (
            <div className="off-feed">
              {actor.feed.slice(0, 8).map((f, i) => (
                <div key={`${f.at}-${i}`} className={`off-feed-row ${f.kind}`}>
                  <span className="off-mono">{new Date(f.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                  <i>{f.kind === "tool" ? "工具" : f.kind === "thought" ? "思考" : f.kind === "text" ? "回复" : "系统"}</i>
                  <span className="off-ellipsis" title={f.text}>{f.text}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {actor.run ? (
          <div className="block">
            <div className="block-label">执行</div>
            <dl className="map">
              <dt>状态</dt><dd>{RUN_STATUS[actor.run.status] || actor.run.status}</dd>
              <dt>方式</dt><dd>{actor.run.runtime === "acp" ? "ACP（结构化）" : actor.run.runtime === "terminal" ? "终端" : actor.run.runtime || "—"}</dd>
              <dt>用时</dt><dd className="mono">{actor.elapsed}</dd>
              <dt>Tokens</dt><dd className="mono">{tokenText(actor.run.tokens)}</dd>
              <dt>执行 ID</dt><dd className="mono" title={actor.run.id}>{actor.run.id}</dd>
            </dl>
          </div>
        ) : null}

        <div className="block">
          <div className="block-label">动效参数<span>全局 · 立即生效</span></div>
          <div className="ctl">
            <label>走位时长 <b>{(motion.walk / 1000).toFixed(1)}s</b></label>
            <input type="range" min={300} max={1400} step={100} value={motion.walk} onChange={(e) => onMotion({ walk: Number(e.target.value) })} aria-label="走位时长" />
          </div>
          <div className="ctl">
            <label>姿态幅度 <b>{motion.amp}%</b></label>
            <input type="range" min={0} max={150} step={10} value={motion.amp} onChange={(e) => onMotion({ amp: Number(e.target.value) })} aria-label="姿态幅度" />
          </div>
          <div className="param-row">
            <label className="row-switch"><input type="checkbox" checked={motion.typing} onChange={(e) => onMotion({ typing: e.target.checked })} /> 打字动作</label>
            <span className="effective">{motion.walk}ms · {motion.amp}% · {motion.tier}</span>
          </div>
        </div>

        <div className="block">
          <div className="block-label">操作</div>
          <div className="off-insp-actions">
            {primary}
            {approval ? <button className="btn danger" onClick={() => void decide(false)}>拒绝</button> : null}
            {showsTask && task ? <button className="btn" onClick={() => onOpenTask(task.id)}>打开任务</button> : null}
            {actor.thread ? <button className="btn" onClick={() => onOpenThread(actor.thread!.id)}>会话</button> : null}
            <button className="btn" onClick={() => onOpenTerminal(terminal?.cwd || actor.agent?.cwd || "", terminal?.status === "running" ? terminal.id : undefined)} disabled={!terminal?.cwd && !actor.agent?.cwd}>终端</button>
            {actor.run && ACTIVE.has(actor.run.status) ? <button className="btn danger" onClick={() => void stop()}>停止</button> : null}
          </div>
        </div>
      </div>

      <div className="insp-foot">
        <button className="btn tiny ghost" onClick={onResetMotion}>还原默认</button>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 10 }}>只影响本场景的呈现</span>
      </div>
    </aside>
  );
}
