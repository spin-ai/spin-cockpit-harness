import type {
  Agent, Approval, Bot, BotTurn, CoordinationCastMember, Delegation, MissionPlanRecord, Run, State, TerminalRecord, Thread, Todo,
} from "../types";

export type OfficeTone = "neutral" | "run" | "wait" | "review" | "fail" | "lead";
export type OfficePose = "idle" | "working" | "waiting" | "reviewing" | "failed" | "lead";
export type OfficeZone = "lead" | "desk" | "approval" | "review" | "tea" | "standby" | "meeting";
export type OfficeSlot = "a" | "b" | null;
export type OfficePrimary = "task" | "approval" | "review" | "retry" | "mission" | "session" | "none";
export type OfficeCastRole = "lead" | "worker" | "reviewer";

/** 阵容一行：机器人 + 它在这场戏里的分工（lead / worker / reviewer）。 */
export type OfficeCastMember = CoordinationCastMember;

/** 正在做什么：从真实 tool 消息里解析出来的「工具 · 结果 · 目标」 */
export interface OfficeActivity {
  tool: string;
  status: string;
  target: string;
  at: number;
}

export interface OfficeProgress {
  tools: number;
  thoughts: number;
  replies: number;
}

/** 进展时间线中的一条（tool / 思考 / 回复） */
export interface OfficeFeedItem {
  at: number;
  kind: "tool" | "thought" | "text" | "system";
  text: string;
}

export interface OfficeEventLine {
  time: string;
  text: string;
  bad?: boolean;
}

export interface OfficeBoardRow {
  key: string;
  title: string;
  state: "done" | "doing" | "todo";
  tag: string;
}

export interface OfficeBoard {
  key: string;
  title: string;
  progress: string;
  percent: number;
  rows: OfficeBoardRow[];
}

export interface OfficeActor {
  /** 座位上的身份：机器人 id；没有 bot 的过渡态回落到执行体 id */
  id: string;
  /** 人格 bot（舞台上的「人」）；null = 这排只有执行体 */
  bot: Bot | null;
  /** 它此刻借的执行体；null = 还没绑定 */
  agent: Agent | null;
  /** 最近一条回合：为什么说 / 为什么沉默 */
  botTurn: BotTurn | null;
  displayName: string;
  hostName: string;
  accent: string;
  role: "lead" | "worker" | "reviewer";
  zone: OfficeZone;
  seat: number | null;
  slot: OfficeSlot;
  pose: OfficePose;
  tone: OfficeTone;
  statusLabel: string;
  title: string;
  detail: string;
  elapsed: string;
  screen: { key: string; tone: OfficeTone; lines: number[] };
  task: Todo | null;
  run: Run | null;
  thread: Thread | null;
  terminal: TerminalRecord | null;
  approval: Approval | null;
  delegations: Delegation[];
  events: OfficeEventLine[];
  activity: OfficeActivity | null;
  progress: OfficeProgress;
  feed: OfficeFeedItem[];
  primary: OfficePrimary;
}

/** 协调台：Mission 正在协调谁、做到第几步 */
export interface OfficeCoordination {
  active: boolean;
  stage: string;
  missionKey: string;
  title: string;
  done: number;
  total: number;
  /** onStage=false 表示有任务但那个机器人不在当前阵容（此前会被静默丢弃，见原型 A 第 4 步） */
  members: { id: string; name: string; accent: string; tone: OfficeTone; status: string; onStage: boolean }[];
}

export interface OfficeModel {
  actors: OfficeActor[];
  standby: OfficeActor[];
  lead: OfficeActor | null;
  board: OfficeBoard;
  coordination: OfficeCoordination;
  approval: { count: number; title: string; actor: OfficeActor | null };
  review: { count: number; title: string; actor: OfficeActor | null };
  terminals: { running: number; total: number };
  zones: { waiting: boolean; review: boolean; idle: boolean; planning: boolean; failed: boolean; running: boolean };
  stats: { agents: number; bots: number; unbound: number; running: number; waiting: number; queued: number; review: number; failed: number; idle: number };
  projectName: string;
  projectAlias: string;
}

const ACTIVE_RUN = new Set(["queued", "running", "waiting_input", "waiting_plan", "waiting_children"]);
/** 工具消息的正文形如 `Edit · 完成 · docs/x.md`；解析成 工具 / 结果 / 目标 */
function parseToolText(raw: string): { tool: string; status: string; target: string } {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const parts = text.split(" · ");
  if (parts.length >= 2) {
    return { tool: parts[0].slice(0, 16), status: parts[1].slice(0, 8), target: (parts.slice(2).join(" · ") || parts[0]).slice(0, 72) };
  }
  return { tool: "动作", status: "", target: text.slice(0, 72) };
}

/** 某个 actor 的真实进展：优先按当前 run，其次按会话 */
function feedOf(state: State, run: Run | null, thread: Thread | null, limit = 12): { feed: OfficeFeedItem[]; progress: OfficeProgress; activity: OfficeActivity | null } {
  const all = state.messages ?? [];
  let list = run ? all.filter((m) => m.runId === run.id) : [];
  if (!list.length && thread) list = all.filter((m) => m.threadId === thread.id);
  const ordered = [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const progress: OfficeProgress = { tools: 0, thoughts: 0, replies: 0 };
  const feed: OfficeFeedItem[] = [];
  for (const m of ordered) {
    const kind = m.kind === "tool" ? "tool" : m.kind === "thought" ? "thought" : m.kind === "text" ? "text" : "system";
    if (kind === "tool") progress.tools += 1;
    else if (kind === "thought") progress.thoughts += 1;
    else if (kind === "text" && m.role !== "user") progress.replies += 1;
    feed.push({ at: m.createdAt || 0, kind, text: String(m.content || "").replace(/\s+/g, " ").trim() });
  }
  const lastTool = [...ordered].reverse().find((m) => m.kind === "tool");
  const activity = lastTool
    ? { ...parseToolText(lastTool.content), at: lastTool.createdAt || 0 }
    : null;
  return { feed: feed.slice(-limit).reverse(), progress, activity };
}

const FINISHED = new Set(["completed", "failed", "cancelled", "interrupted"]);
function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? `${s % 60}s` : ""}`;
  return `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ""}`;
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function runTime(run: Run | null, now: number): string {
  if (!run?.startedAt) return "—";
  return shortDuration((run.endedAt ?? now) - run.startedAt);
}

function latestRunForAgent(state: State, agentId: string): { active: Run | null; latest: Run | null } {
  const runs = state.runs.filter((r) => r.agentId === agentId);
  const active = [...runs]
    .filter((r) => ACTIVE_RUN.has(r.status))
    .sort((a, b) => (b.startedAt ?? b.createdAt ?? 0) - (a.startedAt ?? a.createdAt ?? 0))[0] ?? null;
  const latest = [...runs].sort((a, b) => {
    const at = a.endedAt ?? a.startedAt ?? a.createdAt ?? 0;
    const bt = b.endedAt ?? b.startedAt ?? b.createdAt ?? 0;
    return bt - at;
  })[0] ?? null;
  return { active, latest };
}

function missionFor(state: State, projectId: string | null): Todo | null {
  const missions = state.todos
    .filter((t) => t.kind === "mission" && (!projectId || !t.projectId || t.projectId === projectId))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return missions.find((m) => ["planning", "plan_review", "running", "waiting_children", "in_review"].includes(m.missionState ?? "")) ?? missions[0] ?? null;
}

function planFor(state: State, missionId: string): MissionPlanRecord | null {
  return [...(state.missionPlans ?? [])]
    .filter((p) => p.missionId === missionId)
    .sort((a, b) => b.revision - a.revision)[0] ?? null;
}

function makeBoard(state: State, projectId: string | null): OfficeBoard {
  const mission = missionFor(state, projectId);
  if (mission) {
    const plan = planFor(state, mission.id);
    const steps = mission.subtasks.length
      ? mission.subtasks.map((s) => ({ key: s.id, title: s.title, state: s.status === "done" ? "done" as const : s.status === "in_progress" ? "doing" as const : "todo" as const }))
      : (plan?.plan.steps ?? []).map((s, i) => ({ key: s.key || String(i + 1), title: s.title, state: "todo" as const }));
    const rows = steps.slice(0, 4).map((s) => ({
      key: s.key,
      title: s.title,
      state: s.state,
      tag: s.state === "done" ? "完成" : s.state === "doing" ? "进行" : "待办",
    }));
    const done = steps.filter((s) => s.state === "done").length;
    return {
      key: mission.key,
      title: mission.title,
      progress: `${done} / ${steps.length || 0}`,
      percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
      rows,
    };
  }
  const open = state.todos
    .filter((t) => (!projectId || !t.projectId || t.projectId === projectId) && t.status !== "done" && t.status !== "cancelled" && t.kind !== "chat")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);
  const rows = open.map((t) => ({
    key: t.key,
    title: t.title,
    state: t.status === "in_progress" ? "doing" as const : t.status === "in_review" ? "doing" as const : "todo" as const,
    tag: t.status === "in_progress" ? "进行" : t.status === "in_review" ? "待验收" : "待办",
  }));
  return {
    key: "TODAY",
    title: "今日任务",
    progress: `${open.length} open`,
    percent: open.length ? 18 : 0,
    rows,
  };
}

function eventsFor(state: State, agent: Agent | null, task: Todo | null): OfficeEventLine[] {
  const needles = [agent?.name, agent?.alias, task?.key].filter(Boolean) as string[];
  const scoped = (state.events ?? []).filter((e) => needles.some((n) => e.text.includes(n)));
  const chosen = (scoped.length ? scoped : (state.events ?? [])).slice(-3).reverse();
  return chosen.map((e) => ({
    time: fmtClock(e.ts),
    text: e.text.replace(/^[a-z._-]+\s+/i, "").slice(0, 92),
    bad: /failed|error|permission|interrupted/i.test(e.type) || /failed|error/i.test(e.text),
  }));
}

/** 机器人最近的回合；没有就是 null（舞台不编造「为什么没说」） */
function latestTurnForBot(turns: BotTurn[], botId: string): BotTurn | null {
  let out: BotTurn | null = null;
  for (const t of turns) {
    if (t.botId !== botId) continue;
    if (!out || t.createdAt >= out.createdAt) out = t;
  }
  return out;
}

/** 阵容里的一行 → 机器人；老数据（只有 agentId）按 bots.executor_agent_id 反查。 */
function resolveCastBot(entry: OfficeCastMember, bots: Bot[]): Bot | null {
  if (entry.botId) return bots.find((b) => b.id === entry.botId) ?? null;
  if (!entry.agentId) return null;
  return bots.find((b) => b.executorAgentId === entry.agentId) ?? null;
}

/** 座位配色跟人走（bot 的头像色），没绑执行体也有颜色。 */
const BOT_ACCENT: Record<string, string> = { a: "indigo", b: "teal", c: "amber", d: "purple", e: "orange", f: "red" };
function accentForSeat(bot: Bot | null, agent: Agent | null): string {
  if (bot) return BOT_ACCENT[bot.avatarClass || "a"] || "slate";
  return agent ? accentFor(agent) : "slate";
}

function accentFor(agent: Agent): string {
  if (agent.role === "supervisor") return "slate";
  return agent.color || "slate";
}

export function buildOfficeModel(state: State, opts: { projectId?: string | null; now?: number; wide?: boolean; cast?: OfficeCastMember[] } = {}): OfficeModel {
  const now = opts.now ?? Date.now();
  const wide = opts.wide ?? true;
  const cast = opts.cast ?? [];
  const bots = state.bots ?? [];
  const turns = state.botTurns ?? [];
  const projectId = opts.projectId ?? state.activeProjectId ?? null;
  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const projectAgents = state.agents.filter((a) => !a.projectId || a.projectId === projectId);

  // 座位上是「人」= 机器人。执行体只是它借的身体，所以阵容按 bot 找；老阵容按执行体反查。
  const seats: { bot: Bot | null; agent: Agent | null; spec: OfficeCastMember | null }[] = [];
  if (cast.length) {
    // 阵容非空：只呈现阵容里的机器人（没绑执行体的也上台，显示「待绑定」而不是消失）
    for (const entry of cast) {
      const bot = resolveCastBot(entry, bots);
      // 机器人不属于某个项目：它借的身体在哪个项目都得能上这台舞台
      const agent = bot
        ? state.agents.find((a) => a.id === bot.executorAgentId) ?? null
        : state.agents.find((a) => a.id === entry.agentId) ?? null;
      if (!bot && !agent) continue;
      seats.push({ bot, agent, spec: entry });
    }
  } else if (bots.length) {
    // 没有阵容：项目里所有能上台的机器人（执行体在别的项目的先不上）
    for (const bot of bots) {
      const agent = projectAgents.find((a) => a.id === bot.executorAgentId) ?? null;
      if (!agent && bot.executorAgentId) continue;
      seats.push({ bot, agent, spec: null });
    }
  } else {
    // 过渡：一条 bot 都没有的老库，仍然按执行体呈现，不至于空舞台
    for (const agent of projectAgents) seats.push({ bot: null, agent, spec: null });
  }

  const leadId = seats.find((s) => s.spec?.role === "lead")?.bot?.id
    ?? seats.find((s) => s.spec?.role === "lead")?.agent?.id
    ?? seats.find((s) => s.agent?.role === "supervisor")?.bot?.id
    ?? seats.find((s) => s.agent?.role === "supervisor")?.agent?.id
    ?? seats[0]?.bot?.id ?? seats[0]?.agent?.id ?? null;
  const specById = new Map<string, OfficeCastMember>();
  for (const seat of seats) {
    const id = seat.bot?.id ?? seat.agent?.id;
    if (id && seat.spec) specById.set(id, seat.spec);
  }

  const approvals = state.approvals.filter((a) => {
    if (!projectId) return true;
    const todo = state.todos.find((t) => t.id === a.todoId);
    return !todo?.projectId || todo.projectId === projectId;
  });
  const terminals = (state.terminals ?? []).filter((t) => !projectId || !t.projectId || t.projectId === projectId);
  const mission = missionFor(state, projectId);
  const missionDelegations = (state.delegations ?? []).filter((d) => !mission || d.missionId === mission.id);
  const activeDelegations = missionDelegations.filter((d) => ["running", "queued", "waiting_input", "rework"].includes(d.status));

  const baseActors: OfficeActor[] = seats.map((seat) => {
    const { bot, agent, spec } = seat;
    const id = bot?.id ?? agent?.id ?? "";
    const { active, latest } = agent ? latestRunForAgent(state, agent.id) : { active: null, latest: null };
    const turn = bot ? latestTurnForBot(turns, bot.id) : null;
    const run = active ?? (latest && FINISHED.has(latest.status) ? latest : null);
    const task = (run ? state.todos.find((t) => t.id === run.todoId) : null)
      ?? (agent ? state.todos.find((t) => t.agentId === agent.id && ["todo", "queued", "in_progress", "waiting_input", "in_review"].includes(t.status)) : null)
      ?? null;
    const thread = (task ? state.threads.find((t) => t.todoId === task.id) : null)
      ?? (bot ? state.threads.find((t) => t.botId === bot.id && t.kind === "bot") : null)
      ?? (agent ? state.threads.find((t) => t.agentId === agent.id && !t.todoId) : null)
      ?? null;
    const approval = (run ? approvals.find((a) => a.runId === run.id) : null)
      ?? approvals.find((a) => a.todoId === task?.id)
      ?? null;
    const terminal = (run ? terminals.find((t) => t.runId === run.id) : null)
      ?? (agent ? terminals.find((t) => t.agentId === agent.id && t.status === "running") : null)
      ?? null;
    const isLead = id === leadId;
    const isWaiting = Boolean(approval) || run?.status === "waiting_input" || task?.status === "waiting_input";
    const isReview = task?.status === "in_review" && !isWaiting;
    const isFailed = !isWaiting && (run?.status === "failed" || run?.status === "interrupted" || (!active && Boolean(task?.lastRunFailed)));
    const isRunning = !isWaiting && !isFailed && !isReview && (run?.status === "running" || run?.status === "waiting_children");
    const isQueued = !isWaiting && !isFailed && !isReview && !isRunning && (run?.status === "queued" || task?.status === "queued");
    // 机器人自己的状态：没绑执行体、暂停、静音、以及最近一次「为什么没说」
    const unbound = Boolean(bot) && !agent;
    const paused = bot?.status === "paused";
    const muted = Boolean(bot?.mutedUntil && bot.mutedUntil > now);
    const decision = turn?.decision ?? null;
    const escalated = !isWaiting && !isFailed && !isReview && !isRunning && !isQueued && decision === "escalated";
    const tone: OfficeTone = isWaiting || escalated ? "wait" : isFailed ? "fail" : isReview ? "review" : isRunning || isQueued ? "run" : isLead ? "lead" : "neutral";
    const pose: OfficePose = isWaiting || escalated ? "waiting" : isFailed ? "failed" : isReview ? "reviewing" : isRunning ? "working" : isLead ? "lead" : "idle";
    const statusLabel = isWaiting
      ? "等待确认"
      : isFailed
        ? "失败"
        : isReview
          ? "待验收"
          : isRunning
            ? (isLead ? "协调中" : "运行中")
            : isQueued
              ? "排队"
              : unbound
                ? "待绑定执行体"
                : paused
                  ? "已暂停"
                  : muted
                    ? "静音中"
                    : escalated
                      ? "转人工"
                      : decision === "blocked"
                        ? "被拦"
                        : decision === "silent"
                          ? "沉默"
                          : decision === "watching"
                            ? "监视中"
                            : isLead
                              ? (mission?.missionState === "plan_review" ? "计划评审" : mission?.missionState === "running" ? "协调中" : mission ? "规划中" : "待命")
                              : "空闲";
    const title = task
      ? `${task.key} ${task.title}`
      : unbound
        ? (bot?.persona?.mission || "还没绑定执行体")
        : isLead && mission
          ? `${mission.key} ${mission.title}`
          : "没有进行中的任务";
    const detail = isWaiting
      ? (approval ? `${approval.title} · 需要确认` : "等待人工确认")
      : isFailed
        ? (run?.error || (task?.lastRunFailed ? "上一次执行失败，可重试" : "执行失败"))
        : isReview
          ? "产物已生成，等待人工验收"
          : isQueued
            ? (run?.queueReason || "排队等待执行")
            : isRunning
              ? (run?.status === "waiting_children" ? "等待子任务完成" : "正在执行")
              : unbound
                ? "给它选一个执行体（Agent），它才能上台干活；形象和记忆不变"
                : escalated || decision === "blocked" || decision === "silent"
                  ? (turn?.reason || "最近一次没有开口")
                  : isLead && mission
                    ? (mission.missionState === "plan_review" ? "等待计划批准" : "协调当前 Mission")
                    : "待命，没有进行中的 run";
    const primary: OfficePrimary = unbound ? "none" : isWaiting ? (approval ? "approval" : task ? "task" : "session") : isReview ? "review" : isFailed ? "retry" : isLead ? "mission" : task ? "task" : thread ? "session" : "none";
    const screenTone = isWaiting || escalated ? "wait" : isFailed ? "fail" : isReview ? "review" : isRunning ? "run" : isLead ? "lead" : "neutral";
    const seed = [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0);
    const role: "lead" | "worker" | "reviewer" = isLead ? "lead" : spec?.role === "reviewer" ? "reviewer" : spec?.role === "worker" ? "worker" : isReview ? "reviewer" : "worker";
    return {
      id,
      bot,
      agent,
      botTurn: turn,
      displayName: spec?.displayName || bot?.name || agent?.name || "未命名",
      hostName: agent ? (state.hosts.find((h) => h.id === agent.hostId)?.name || agent.hostId || "local") : "—",
      accent: accentForSeat(bot, agent),
      role,
      zone: isLead ? "lead" : "desk",
      seat: null,
      slot: null,
      pose,
      tone,
      statusLabel,
      title,
      detail,
      elapsed: runTime(run, now),
      screen: { key: task?.key || (isLead ? "MISSION" : "—"), tone: screenTone, lines: [54 + (seed % 22), 40 + ((seed * 3) % 30), 58 + ((seed * 7) % 24)] },
      task,
      run,
      thread,
      terminal,
      approval,
      delegations: isLead
        ? activeDelegations
        : (state.delegations ?? []).filter((d) => (bot && d.botId === bot.id) || (agent && d.agentId === agent.id)),
      events: eventsFor(state, agent, task),
      ...feedOf(state, run, thread),
      primary,
    };
  });

  // seat assignment: lead pinned, cast seat overrides first, remaining workers stable order
  const lead = baseActors.find((a) => a.zone === "lead") ?? null;
  // 计划评审是真实 missionState：主控从经理室走到会议室，不是演示动画
  if (lead && mission?.missionState === "plan_review") {
    lead.zone = "meeting";
    lead.pose = "reviewing";
    lead.statusLabel = "计划评审";
  }
  const workerActors = baseActors.filter((a) => a !== lead);
  const seatOf = new Map<string, number>();
  const usedSeats = new Set<number>();
  const explicitStandby = new Set(workerActors.filter((a) => specById.get(a.id)?.seat === null).map((a) => a.id));
  for (const w of workerActors) {
    const spec = specById.get(w.id)?.seat;
    if (spec == null || spec < 0 || spec > 5 || usedSeats.has(spec)) continue;
    seatOf.set(w.id, spec);
    usedSeats.add(spec);
  }
  let nextSeat = 0;
  for (const w of workerActors) {
    if (seatOf.has(w.id) || explicitStandby.has(w.id)) continue;
    while (usedSeats.has(nextSeat)) nextSeat += 1;
    if (nextSeat > 5) break;
    seatOf.set(w.id, nextSeat);
    usedSeats.add(nextSeat);
    nextSeat += 1;
  }
  const assigned = workerActors.filter((w) => seatOf.has(w.id)).slice(0, 6);
  const extras = workerActors.filter((w) => !seatOf.has(w.id));
  assigned.forEach((a) => { a.seat = seatOf.get(a.id) ?? null; });
  const waiting = assigned.filter((a) => a.tone === "wait" && (a.approval || a.run?.status === "waiting_input"));
  const review = assigned.filter((a) => a.tone === "review");
  // 「手头没有正在跑的东西」就算空闲：待办里排着队但没在跑的，也应该去茶歇走动一下
  const idle = assigned.filter((a) => a.tone === "neutral" && !(a.run && ACTIVE_RUN.has(a.run.status)));
  waiting.forEach((a, i) => { a.zone = i === 0 && wide ? "approval" : "desk"; });
  review.forEach((a, i) => { a.zone = i === 0 ? "review" : "desk"; });
  const teaActors = idle.slice(0, 3);
  teaActors.forEach((a, i) => { a.zone = i === 0 ? "tea" : "standby"; a.slot = i === 0 ? "a" : "b"; });
  extras.slice(0, 2).forEach((a, i) => { a.zone = "standby"; a.slot = i === 0 ? "b" : "a"; a.pose = "idle"; a.tone = "neutral"; a.statusLabel = a.statusLabel === "待绑定执行体" ? a.statusLabel : "待命"; });
  const standbyExtras = extras.slice(2);
  extras.slice(0, 2).forEach((a) => assigned.push(a));

  const actors = [lead, ...assigned].filter((a): a is OfficeActor => Boolean(a));
  // 协调台：Mission 的子任务 + 各自 Owner 的当前状态（这是「谁在协作」的唯一来源）
  const missionTodos = state.todos.filter((t) => t.kind === "mission" && (!projectId || t.projectId === projectId));
  const liveMission = missionTodos.find((t) => !["done", "cancelled", "failed"].includes(t.status)) || missionTodos[0] || null;
  const missionChildren = liveMission ? state.todos.filter((t) => t.parentId === liveMission.id) : [];
  const childDone = missionChildren.filter((t) => t.status === "done").length;
  const members = missionChildren.map((t) => {
    // 协调台回答的是「谁在干」：先认执行体所在的座位；执行体没上场才退回派活的机器人（botId）
    const a = (t.agentId ? actors.find((x) => x.agent?.id === t.agentId) : undefined)
      ?? (t.botId ? actors.find((x) => x.id === t.botId) : undefined);
    if (a) {
      return { id: a.id, name: a.displayName, accent: a.accent, tone: a.tone, status: a.statusLabel, onStage: true };
    }
    // 有任务但没在阵容里：保留一行并标注，避免「明明派了活，协调台却少一条」
    // 上场不了的：优先写派活的机器人名字，其次执行体，最后 id
    const owner = t.botId ? bots.find((b) => b.id === t.botId) : undefined;
    const bot = bots.find((b) => b.executorAgentId && b.executorAgentId === t.agentId);
    const known = state.agents.find((x) => x.id === t.agentId);
    const short = owner?.name || bot?.name || known?.name || (t.agentId ? t.agentId.slice(-4) : "未指派");
    return { id: t.agentId || "", name: `${short}（未上场）`, accent: "slate", tone: "neutral" as OfficeTone,
             status: t.status === "in_progress" ? "进行中" : t.status === "done" ? "完成" : "待办", onStage: false };
  });
  const coordination: OfficeCoordination = {
    active: Boolean(liveMission && ["planning", "plan_review", "running", "waiting_children", "in_review"].includes(liveMission.missionState ?? "")),
    stage: liveMission?.missionState === "plan_review" ? "等你批准计划" : liveMission?.missionState === "planning" ? "拆解计划中" : liveMission?.missionState === "in_review" ? "等待汇总" : liveMission ? "并行执行中" : "空闲",
    missionKey: liveMission?.key || "",
    title: liveMission?.title || "等待新的 Mission",
    done: childDone,
    total: missionChildren.length,
    members: members.slice(0, 5),
  };

  const reviewTodos = state.todos.filter((t) => t.status === "in_review" && (!projectId || !t.projectId || t.projectId === projectId));
  const runningTerminals = terminals.filter((t) => t.status === "running");
  const approvalActor = actors.find((a) => a.approval) ?? actors.find((a) => a.zone === "approval") ?? null;
  const reviewActor = actors.find((a) => a.zone === "review") ?? null;

  return {
    actors,
    standby: standbyExtras,
    lead,
    board: makeBoard(state, projectId),
    coordination,
    approval: { count: approvals.length, title: approvals[0]?.title || "没有待确认操作", actor: approvalActor },
    review: { count: reviewTodos.length, title: reviewTodos[0] ? `${reviewTodos[0].key} ${reviewTodos[0].title}` : "没有待验收任务", actor: reviewActor },
    terminals: { running: runningTerminals.length, total: terminals.length },
    zones: {
      waiting: actors.some((a) => Boolean(a.approval)),
      review: reviewTodos.length > 0,
      idle: actors.some((a) => a.zone === "tea"),
      planning: Boolean(mission && ["planning", "plan_review", "running", "waiting_children"].includes(mission.missionState ?? "")),
      failed: actors.some((a) => a.tone === "fail"),
      running: actors.some((a) => a.tone === "run"),
    },
    stats: {
      agents: projectAgents.length,
      bots: seats.filter((s) => s.bot).length,
      unbound: seats.filter((s) => s.bot && !s.agent).length,
      running: actors.filter((a) => a.tone === "run").length,
      waiting: actors.filter((a) => Boolean(a.approval) || a.run?.status === "waiting_input" || a.task?.status === "waiting_input").length,
      queued: actors.filter((a) => a.run?.status === "queued" || a.task?.status === "queued").length,
      review: reviewTodos.length,
      failed: actors.filter((a) => a.tone === "fail").length,
      idle: actors.filter((a) => a.tone === "neutral").length,
    },
    projectName: project?.name || "全局",
    projectAlias: project?.alias || "global",
  };
}
