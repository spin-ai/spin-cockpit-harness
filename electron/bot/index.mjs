/**
 * 人格 bot 运行时（P0：本地、只读能力、主动为主）。
 *
 * 设计取舍见 docs/arch/ARCH-bot.md：
 *  - 每个 bot = 人格卡 + 记忆注入 + 出场策略 + 配额；按 botId 完全隔离。
 *  - tick 只做「候选事件 → 打分 → 过闸 → 生成 → 记账」；沉默/被拦也记 BotTurn。
 *  - 能力先只给 read：不建 todo、不起 run（dispatch 是 P1）。
 *  - L1 永远不进注入（memory.inject 自身也这么做），这里只记录注入了哪几条。
 */

import { redactSecrets } from "../redact.mjs";
import { suppressionReason } from "./guard.mjs";
import { notifyDecision } from "./notify.mjs";
import { WAIT_LIMIT_MS, describeRoutine, nextRunAt, normalizeRoutine, routineDue } from "./routine.mjs";
import { BOT_TOOL_META, botToolsFor, parseToolArgs, toolNamesFor } from "./tools.mjs";
import { skillsFor } from "./skills.mjs";
import { isFreshEvent } from "./github.mjs";
import { normalizeToolStatus, toolFamily } from "../tool-format.mjs";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** 默认人格卡：结构化字段，不是一段 prompt */
export const DEFAULT_PERSONA = {
  mission: "",                      // 创建时问出来的"你是干什么的"（空 = 还没问）
  tone: "直接、短句，不用感叹号；不确定就说不确定",
  address: "叫你「你」，不自称助手",
  length: "默认 1–2 句；要展开时先给结论",
  boundary: "不评价你的作息，不替你做对外承诺",
  habit: "习惯先说「我理解的是…」再动手",
};

export const DEFAULT_POLICY = {
  requireMentionInGroup: true,
  // 谁能找它：owner = 只在 1:1（Chat / Bot 页）回应，群里 @ 也不回；group = 群里 @ 才回；anyone = 群里按回复模式都可能开口
  whoCanAsk: "group",
  maxTurnsPerHour: 6,
  minGapMs: 2 * MINUTE,
  quietHours: [23, 8],
  // 通知开关：主动开口 / 需要你决定 / 任务完成 / 未能完成
  notify: { proactive: true, needPermission: true, taskDone: true, failed: true },
  // 无人值守：允许 bot 自己启动已建好的 run（默认关；work 档 + 绑定项目 + 每小时上限）
  standing: { enabled: false, maxRunsPerHour: 1 },
  // 出站敏感词：命中即不外发（落 blocked，正文只留在本地审计里）
  sensitiveBlocklist: [],
  // 这些情况**不是**闸门，而是写进 system prompt 的边界：让模型请人做，而不是假装办了
  escalate: "对外发言 / 删除 / 花钱",
};

export const DEFAULT_BUDGET = { tokensPerTurn: 2048, tokensPerHour: 12000 };

/**
 * 提问卡片：
 *  - 模型主动开口时可以输出 `ASK: 一句话问题`，我们把它落成一张**可作答的卡片**；
 *  - 卡片不挡聊天（人可以继续说话），也不自动过期于当轮——默认 7 天内都能答；
 *  - 人回一句话就算答了（`status: answered`），也可以「先不管」（`dismissed`）。
 */
const ASK_TTL_MS = 7 * 24 * HOUR;

/** 注入预算：bot 一轮只输出 1–2 句，给目录没用，要正文 */
const INJECT_CHARS = 8000;

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * 首次启动时的内置机器人（可改名/删除，和 Notes 一样是 first-party 默认值）：
 * 主管小Z + 员工小A/小B/小C。员工先不绑执行体，绑上 Agent 之后才能起 run。
 */
export function seedBots() {
  const now = Date.now();
  const base = (over) => ({
    id: over.id, name: over.name, avatar: over.avatar, avatarClass: over.avatarClass,
    role: over.role, capability: over.capability,
    persona: { ...DEFAULT_PERSONA, ...(over.persona || {}) },
    channels: ["local"], intro: Boolean(over.intro),
    policy: { ...DEFAULT_POLICY, notify: { ...DEFAULT_POLICY.notify }, standing: { ...DEFAULT_POLICY.standing } },
    budget: { ...DEFAULT_BUDGET },
    status: "active", mutedUntil: 0, executorAgentId: null, skills: [], projectId: null, hostId: null, team: "", plan: null, createdAt: now, updatedAt: now,
  });
  return [
    base({ id: "bot-xiaoz", name: "小Z", avatar: "Z", avatarClass: "d", role: "supervisor", capability: "dispatch", intro: true,
      persona: { mission: "拆解目标、分派任务、汇总结果", tone: "先给结论，再给依据" } }),
    base({ id: "bot-xiaoa", name: "小A", avatar: "A", avatarClass: "a", role: "worker", capability: "read",
      persona: { mission: "负责具体执行；被分派到哪条任务就汇报哪条", tone: "简短" } }),
    base({ id: "bot-xiaob", name: "小B", avatar: "B", avatarClass: "b", role: "worker", capability: "read",
      persona: { mission: "负责具体执行；被分派到哪条任务就汇报哪条", tone: "简短" } }),
    base({ id: "bot-xiaoc", name: "小C", avatar: "C", avatarClass: "c", role: "worker", capability: "read",
      persona: { mission: "负责具体执行；被分派到哪条任务就汇报哪条", tone: "简短" } }),
  ];
}

/* ------------------------------------------------------------------ 纯函数 */

/** 静音时段：支持跨午夜（如 [23, 8]） */
export function quietActive(quiet, date = new Date()) {
  if (!Array.isArray(quiet) || quiet.length !== 2) return false;
  const [start, end] = quiet.map(Number);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const hour = date.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** 候选事件打分：越「需要人看」的越高；0 分不开口 */
export function scoreCandidate(candidate) {
  const kind = candidate?.kind || "";
  if (kind === "run.failed") return 0.86;
  if (kind === "todo.waiting_input") return 0.74;
  if (kind === "todo.failed") return 0.8;
  if (kind === "github.ci") return 0.82;
  if (kind === "github.pr") return 0.7;
  if (kind === "webhook") return 0.75;
  if (kind === "memory.due") return 0.55;
  return 0;
}

/**
 * 三道闸：静音时段 → 最小间隔 → 每小时配额。
 * 返回 { ok, decision, reason }；decision 只在 ok=false 时是 silent/blocked。
 */
export function gatesFor(bot, { now = Date.now(), turns = [], force = false, ignoreGap = false } = {}) {
  // force（人手动点「跑一次」）只放行「静音时段 + 最小间隔」；
  // 暂停 / 手动静音 / 条数 / token 配额照旧生效——否则配额等于可以被人一键绕过。
  if (bot.status === "paused") return { ok: false, decision: "silent", reason: "bot 已暂停" };
  if (bot.mutedUntil && bot.mutedUntil > now) return { ok: false, decision: "silent", reason: "手动静音中" };
  if (!force && quietActive(bot.policy?.quietHours, new Date(now))) return { ok: false, decision: "silent", reason: "静音时段" };

  const answered = turns.filter((t) => t.botId === bot.id && t.decision === "answered" && now - t.createdAt < HOUR);
  const limit = Number(bot.policy?.maxTurnsPerHour) || DEFAULT_POLICY.maxTurnsPerHour;
  if (answered.length >= limit) {
    return { ok: false, decision: "blocked", reason: `本小时已说 ${answered.length}/${limit} 条` };
  }
  // token 配额：条数闸管「烦不烦」，token 闸管「花多少」——两个都要，否则长回复能把日预算一次吃完
  const spent = turns
    .filter((t) => t.botId === bot.id && t.decision !== "silent" && now - t.createdAt < HOUR)
    .reduce((sum, t) => sum + (Number(t.cost?.tokens) || 0), 0);
  const tokenLimit = Number(bot.budget?.tokensPerHour) || DEFAULT_BUDGET.tokensPerHour;
  if (spent >= tokenLimit) {
    return { ok: false, decision: "blocked", reason: `本小时 token ${spent}/${tokenLimit}` };
  }
  const gap = Number(bot.policy?.minGapMs) || DEFAULT_POLICY.minGapMs;
  const last = [...turns].reverse().find((t) => t.botId === bot.id && t.decision === "answered");
  // 日程是排好的：允许跳过「最小间隔」，否则"9:00 早报"会被 8:59 的一句闲聊挡掉
  if (!force && !ignoreGap && last && now - last.createdAt < gap) {
    return { ok: false, decision: "blocked", reason: `距上一条 ${Math.round((now - last.createdAt) / 1000)}s < 最小间隔 ${Math.round(gap / 1000)}s` };
  }
  return { ok: true };
}

/** 从任务/运行状态里挑候选；同一事件 30 分钟内不重复提（**按 bot 各算各的**：A 说过不影响 B） */
export function collectCandidates(state, { now = Date.now(), recentTurns = [], botId = "" } = {}) {
  const seen = new Set(
    recentTurns
      .filter((t) => now - t.createdAt < 30 * MINUTE)
      .filter((t) => !botId || t.botId === botId)
      .map((t) => t.trigger?.ref)
      .filter(Boolean),
  );
  const out = [];
  for (const todo of state.todos || []) {
    if (!todo || todo.confirmed === false) continue;
    const ref = `todo:${todo.id}`;
    if (seen.has(ref)) continue;
    if (todo.status === "waiting_input") {
      out.push({ kind: "todo.waiting_input", ref, title: todo.title || todo.key || "任务", todoId: todo.id, key: todo.key });
      continue;
    }
    if (todo.lastRunFailed) {
      out.push({ kind: "todo.failed", ref, title: todo.title || todo.key || "任务", todoId: todo.id, key: todo.key });
    }
  }
  // 外部事件（v1：GitHub PR / CI）：未读 + 未过期才提；去重仍按 trigger.ref
  for (const ev of state.botEvents || []) {
    if (botId && ev.botId !== botId) continue;
    if (ev.seen || !isFreshEvent(ev, now)) continue;
    if (seen.has(ev.key)) continue;
    out.push({
      kind: ev.source === "webhook" ? "webhook" : String(ev.key).startsWith("ci:") ? "github.ci" : "github.pr",
      ref: ev.key, eventId: ev.id, title: ev.title, url: ev.url,
    });
  }
  // 失败的运行也算事件：任务上的 lastRunFailed 覆盖不到「手动起的 / 子运行」
  // 同一任务已经有 todo.failed 候选时不再重复提
  const seenTodo = new Set(out.map((c) => c.todoId).filter(Boolean));
  // 这一轮的 run 已经汇报过（reported 回合带 runId）就不再当成新失败
  const seenRuns = new Set(
    recentTurns
      .filter((t) => now - t.createdAt < 2 * HOUR && t.runId)
      .filter((t) => !botId || t.botId === botId)
      .map((t) => t.runId),
  );
  for (const run of state.runs || []) {
    if (run?.status !== "failed" || !run.endedAt) continue;
    if (now - run.endedAt > 2 * HOUR) continue;
    if (run.todoId && seenTodo.has(run.todoId)) continue;
    if (seenRuns.has(run.id)) continue;
    const ref = `run:${run.id}`;
    if (seen.has(ref)) continue;
    const todo = (state.todos || []).find((t) => t.id === run.todoId);
    out.push({
      kind: "run.failed", ref, runId: run.id, todoId: run.todoId || null,
      title: `${todo ? `${todo.key || ""} ${todo.title}`.trim() : run.id} 运行失败`,
    });
    if (run.todoId) seenTodo.add(run.todoId);
  }
  return out.map((c) => ({ ...c, score: scoreCandidate(c) })).sort((a, b) => b.score - a.score);
}

/**
 * 人格卡 + 记忆 + 能力档位 → system prompt。
 * 主动与被动共用同一份：否则同一个 bot 在两条路径上会说出不同的边界。
 *
 * 记忆传 `inject()` 的 markdown（含正文），不是条目表——只给标题等于只给目录。
 * 兼容传数组的旧写法（selftest / 调用方），但数组里的 body 会一起带上。
 */
export const MAX_TOOL_ROUNDS = 8;
export const MAX_TOOL_ROUNDS_HARD = 16;
export const MAX_TOOL_CALLS = 24;
export const TOOL_REPEAT_LIMIT = 3;
export const HISTORY_KEEP = 10;
export const HISTORY_DIGEST_AT = 24;
export const BOT_INJECT_CHARS = 8000;
const DIGEST_CHARS = 2400;
const SKILL_CHARS = 2400;
const TEAMMATE_CHARS = 1200;

/** 工具轮低温、闲聊正常温：0.7 下模型更爱「聊」而不是「查」 */
export function temperatureFor(hasTools) {
  return hasTools ? 0.3 : 0.7;
}

/** 思考档：只改「最多查几轮 / 工具轮温度」，不改 token 上限（配额不被人一键绕过） */
export function effortPolicy(effort) {
  if (effort === "quick") return { rounds: 4, temperature: 0.4, label: "快速" };
  if (effort === "deep") return { rounds: 12, temperature: 0.2, label: "深入" };
  return { rounds: MAX_TOOL_ROUNDS, temperature: 0.3, label: "标准" };
}

/** 同一工具同参数重复 3 次 → 停：键序不影响签名（`{a,b}` 与 `{b,a}` 算同一次） */
export function toolSignature(name, rawArgs) {
  let args = rawArgs;
  try {
    args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : (rawArgs || {});
  } catch { args = {}; }
  if (!args || typeof args !== "object" || Array.isArray(args)) return `${name}?`;
  const stable = Object.keys(args).sort().map((k) => `${k}=${JSON.stringify(args[k])}`).join("&");
  return `${name}?${stable}`;
}

/**
 * 长对话压缩：超过 `at` 条就把「最近 keep 条」之外的内容压成一段背景。
 * 纯函数（不调模型），所以不会额外花钱、也不会拖慢一轮；标 derived，不作为事实来源。
 */
export function historyDigest(messages, { keep = HISTORY_KEEP, at = HISTORY_DIGEST_AT, maxChars = DIGEST_CHARS } = {}) {
  if (!Array.isArray(messages) || messages.length <= at) return "";
  const older = messages.slice(0, -keep);
  if (!older.length) return "";
  const text = older
    .map((m) => `${m.role === "user" ? "用户" : "我"}：${String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 160)}`)
    .filter((line) => line.length > 3)
    .join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function personaLines(bot, { proactive, recentProactive, inGroup = false }) {
  const persona = bot.persona || {};
  const policy = bot.policy || {};
  const duty = persona.duty || {};
  const recent = (recentProactive || []).filter(Boolean).slice(-3);
  const toolNames = toolNamesFor(bot.capability);
  const canCreate = bot.capability === "dispatch" || bot.capability === "work";
  return [
    `你在扮演「${bot.name}」。用第一人称，不要解释自己是 AI。`,
    bot.role ? `角色：${bot.role === "supervisor" ? "主管（拆解、分派、盯进展、汇总，不亲手改代码）" : "执行者（在自己职责范围内把事做完）"}` : "",
    persona.mission ? `你的职责（用户亲口说的）：${persona.mission}` : "",
    duty.goal ? `目标：${duty.goal}` : "",
    duty.scope ? `范围：${duty.scope}` : "",
    duty.deliverable ? `交付物：${duty.deliverable}` : "",
    duty.forbidden ? `不做什么：${duty.forbidden}` : "",
    duty.report ? `汇报口径：${duty.report}` : "",
    `语气：${persona.tone || DEFAULT_PERSONA.tone}`,
    `称呼：${persona.address || DEFAULT_PERSONA.address}`,
    `长短：${persona.length || DEFAULT_PERSONA.length}`,
    `边界：${persona.boundary || DEFAULT_PERSONA.boundary}`,
    `习惯：${persona.habit || DEFAULT_PERSONA.habit}`,
    policy.escalate ? `必须请人来做（不要声称已经办了）：${policy.escalate}` : "",
    recent.length ? `你最近主动说过（别自相矛盾、也别重复）：\n${recent.map((t) => `- ${clip(t, 120)}`).join("\n")}` : "",
    `能力档位：${bot.capability === "dispatch" ? "可以起 Agent 任务（先建 todo），但必须先问人、由人确认起 run" : bot.capability === "work" ? "可以建任务、并跟踪执行体" : "只读：能读记忆、资料、工作区和运行状态，不能建任务"}`,
    proactive ? "" : (canCreate
      ? `可直接调的工具：${toolNames.join(" / ")}。workspace_* / git_* / run_log 只读；memory_write / memory_forget 只写你自己的记忆；task_create 会真的建一条 todo 并指派给 worker，默认只建任务、不起 run，只有用户明确说「开跑 / 开始 / 直接干」时才可传 start=true。${bot.policy?.standing?.enabled ? "无人值守已开：对已建好、属于你绑定项目的任务，可以 run_start 直接起 run（每小时有上限）。" : "无人值守没开：不能自己起 run。"} 不能改文件、不能跑任意命令。`
      : `可直接调的工具：${toolNames.join(" / ")}。全部只读（workspace_* / git_* / run_log / memory_search / knowledge_search / todo_list / run_status）+ 只写你自己的记忆（memory_write / memory_forget）。不能建任务、不能改文件、不能跑命令。`),
    proactive
      ? "现在没有人在跟你对话：你只负责判断这一刻值不值得说一句，不调用工具。"
      : "看工作区：先用 workspace_list 或 workspace_grep 确认路径，再 workspace_read；引用事实时给 path:line。git_status / git_log / git_diff / run_log 都是只读，路径越界会被拒绝。",
    proactive ? "" : `一轮最多 ${MAX_TOOL_ROUNDS} 轮工具调用；查够了就下结论。同一工具同参数重复 ${TOOL_REPEAT_LIMIT} 次会被强制停下。`,
    bot.capability === "dispatch" ? "不要声称能直接改代码；用 task_create 建任务，起 run 仍请人确认。" : "",
    proactive
      ? "你会收到一条「工作区事件」和几条记忆。普通事件只输出你要说的一句话（最多两句）；日程到点（kind=routine）按它的要求回答，可以多几句。"
      : "现在有人在直接跟你说话。正常对话，别复述人格设定，别解释自己是 AI。",
    proactive ? "如果这件事不值得现在开口，只输出 SILENT，不要解释。" : "",
    inGroup && !proactive
      ? "你在群聊里：如果这件事明显属于另一个机器人，用 handoff_to_bot 交给它（一句话说明接什么、为什么），不要把活揽在自己身上；交接后不要再重复回答同一件事。"
      : "",
  ].filter(Boolean);
}

/**
 * 上下文编译器：人格 / 记忆 / 同僚目录 / 规则分区拼装，并报告每区实际占用。
 * 预算本轮只硬裁记忆（`maxChars`）；人格与规则是固定文本，不参不裁。
 * 以后再加技能/文件区时，只需在 `sectionChars` 里多一项，UI 不用改。
 */
export function compileContext(bot, injected = "", { proactive = true, recentProactive = [], teammates = [], skills = [], plan = null, maxChars = BOT_INJECT_CHARS, workspace = "", inGroup = false, now = Date.now() } = {}) {
  const persona = personaLines(bot, { proactive, recentProactive, inGroup });
  const rawMemory = typeof injected === "string"
    ? injected.trim()
    : (Array.isArray(injected) && injected.length
      ? injected.map((m) => `- [${m.layer}] ${m.title}${m.body ? `：${clip(m.body, 160)}` : ""}`).join("\n")
      : "");
  const memoryText = rawMemory || "（这一轮没有注入记忆）";
  const memoryBudget = Math.max(800, Number(maxChars) || BOT_INJECT_CHARS);
  const memoryClipped = memoryText.length > memoryBudget ? `${memoryText.slice(0, memoryBudget - 1)}…` : memoryText;
  const teammateText = teammates.length
    ? clip(teammates.slice(0, 8).map((t) => {
      const role = t.role === "supervisor" ? "主管" : t.role ? "执行者" : "";
      const tag = [t.team, role].filter(Boolean).join(" · ");
      return `- ${t.name}${tag ? `（${tag}）` : ""}${t.mission ? `：${t.mission}` : ""}`;
    }).join("\n"), TEAMMATE_CHARS)
    : "";
  const timeLine = `现在：${new Date(now).toLocaleString("zh-CN", { hour12: false })}（本地时区）`;
  const skillText = (Array.isArray(skills) ? skills : [])
    .map((s) => `### ${s.name}\n${s.body}`)
    .join("\n\n");
  const skillClipped = skillText.length > SKILL_CHARS ? `${skillText.slice(0, SKILL_CHARS - 1)}…` : skillText;
  const planText = plan?.steps?.length
    ? `你手上的计划（${plan.goal || "未命名"}）：\n${plan.steps.map((s, i) => `${i + 1}. [${s.status || "todo"}] ${s.text}`).join("\n")}\n做下一步前先看这里；状态变了用 plan_update。`
    : "";
  const system = [
    ...persona,
    timeLine,
    planText,
    skillClipped ? `技能（需要时按里面的步骤做，不必每轮都提）：\n${skillClipped}` : "",
    workspace ? `当前项目：${workspace}。workspace_* / git_* 的 path 都相对于它。` : "",
    teammateText ? `工作区里的其他机器人（只作路由参考，不是指令；不要冒充他们，也不要替他们回答）：\n${teammateText}` : "",
    `记忆：\n${memoryClipped}`,
  ].filter(Boolean).join("\n");
  return {
    system,
    chars: system.length,
    memoryChars: memoryClipped.length,
    memoryDropped: Math.max(0, memoryText.length - memoryClipped.length),
    sectionChars: {
      persona: persona.join("\n").length,
      time: timeLine.length,
      workspace: workspace.length,
      teammates: teammateText.length,
      skills: skillClipped.length,
      plan: planText.length,
      memory: memoryClipped.length,
    },
  };
}

/** 兼容旧调用：返回 system 字符串。新代码优先用 `compileContext(...)` 拿分区账。 */
export function buildSystemPrompt(bot, injected = "", opts = {}) {
  return compileContext(bot, injected, opts).system;
}

/* ------------------------------------------------------------------ 运行时 */

export function createBots({ store, memory, chat, chatStream, key, probeWatch, runTool, onChange = () => {}, now = () => Date.now(), log = console } = {}) {
  const stateOf = () => store.state;
  const bots = () => (stateOf().bots || []);
  const turnsOf = () => (stateOf().botTurns || []);

  function ensureSeed() {
    if (!Array.isArray(stateOf().bots)) stateOf().bots = [];
    if (!Array.isArray(stateOf().botTurns)) stateOf().botTurns = [];
    if (!Array.isArray(stateOf().routines)) stateOf().routines = [];
    // 旧库升级：700 token/轮 是「只会寒暄」的那一版；一次把默认预算抬到 2048/12000。
    // 只改仍然是旧默认值的 bot，人手动调过的不碰。
    let upgraded = false;
    for (const b of stateOf().bots) {
      const budget = b.budget || {};
      if (Number(budget.tokensPerTurn) === 700 && !budget.brain2) {
        b.budget = {
          ...budget,
          tokensPerTurn: DEFAULT_BUDGET.tokensPerTurn,
          tokensPerHour: Math.max(Number(budget.tokensPerHour) || 0, DEFAULT_BUDGET.tokensPerHour),
          brain2: 1,
        };
        b.updatedAt = now();
        upgraded = true;
      }
    }
    if (upgraded) store.persist();
    // 上次退出时还在生成的回合：标成被打断，并把已经吐出来的半截留着（不静默丢）
    let healed = false;
    for (const t of stateOf().botTurns) {
      if (t.decision !== "streaming") continue;
      t.decision = "interrupted";
      t.reason = t.reply ? "应用退出时这条回复没写完（下面是已经说出来的部分）" : "应用退出时这条回复还没开始输出";
      t.cost = t.cost || {};
      healed = true;
    }
    if (healed) store.persist();
    if (stateOf().bots.length) return false;
    stateOf().bots.push(...seedBots());
    store.persist();
    return true;
  }

  const nextTurnId = () => `bt${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /* ------------------------------------------------------------ 提问卡片 */

  /** 这张卡片还能不能答（超期的懒标记成 expired） */
  function askOpen(turn) {
    if (!turn?.ask) return false;
    if (turn.ask.status !== "open") return false;
    if (now() - (turn.ask.createdAt || turn.createdAt) > ASK_TTL_MS) {
      turn.ask.status = "expired";
      return false;
    }
    return true;
  }

  /** 某个 bot 现在挂着的提问（新的在前） */
  function openAsks(botId = "") {
    return turnsOf()
      .filter((t) => t.decision === "asked" && (!botId || t.botId === botId) && askOpen(t))
      .slice(-5)
      .reverse()
      .map((t) => ({ turnId: t.id, botId: t.botId, text: t.ask.text || t.reply, createdAt: t.ask.createdAt || t.createdAt }));
  }

  /** 回答 / 忽略：人一说话就把当前所有开着的卡片结掉（不要求一一对应） */
  function settleAsks(botId, { answer = "", status = "answered", turnId = "" } = {}) {
    let changed = 0;
    for (const t of turnsOf()) {
      if (t.decision !== "asked" || !t.ask) continue;
      if (turnId ? t.id !== turnId : t.botId !== botId) continue;
      if (!askOpen(t)) continue;
      t.ask.status = status;
      t.ask.answer = answer.slice(0, 500);
      t.ask.answeredAt = now();
      changed += 1;
    }
    if (changed) store.persist();
    return changed;
  }

  /* -------------------------------------------------------------- bot thread */

  const threadsOf = () => (stateOf().threads = Array.isArray(stateOf().threads) ? stateOf().threads : []);

  /** 一个 bot 的默认 thread（todo_id 为空、kind=bot）：主动开口、老回合、未指定会话的落点 */
  function threadOf(botId) {
    return threadsOf().find((t) => t.kind === "bot" && t.botId === botId) || null;
  }

  /**
   * 这个 bot 的会话列表（照搬 ORCA 的 Chats：一条会话一行）。
   * 默认会话永远在里面（老回合的落点），其余按最近活动排。
   */
  function chatsOf(botId) {
    const threads = threadsOf().filter((t) => t.kind === "bot" && t.botId === botId);
    if (!threads.length) return [];
    const msgs = stateOf().messages || [];
    const out = threads.map((t) => {
      const mine = msgs.filter((m) => m.threadId === t.id && !m.supersededBy);
      const last = mine[mine.length - 1] || null;
      return {
        id: t.id,
        title: t.title || "会话",
        createdAt: t.createdAt || 0,
        updatedAt: t.updatedAt || last?.createdAt || t.createdAt || 0,
        count: mine.length,
        last: last ? String(last.content || "").replace(/\s+/g, " ").slice(0, 120) : "",
        lastAt: last?.createdAt || 0,
      };
    });
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function ensureBotThread(bot, { threadId = "", title = "" } = {}) {
    if (threadId) {
      const hit = threadsOf().find((t) => t.id === threadId && t.kind === "bot" && t.botId === bot.id);
      if (hit) return hit;
    }
    const existing = threadOf(bot.id);
    if (existing) return existing;
    const thread = {
      id: `th-bot-${bot.id}`, todoId: null, title: title || bot.name || "bot",
      projectId: null, project: "", agentId: null,
      model: "", modelName: "", effort: "",
      kind: "bot", botId: bot.id,
      createdAt: now(), updatedAt: now(),
    };
    threadsOf().push(thread);
    store.persist();
    return thread;
  }

  /** 新开一个话题（ORCA 的 New chat）：同一个 bot，不同的会话 */
  function newChat({ botId, title = "" } = {}) {
    const bot = bots().find((b) => b.id === String(botId || ""));
    if (!bot) throw new Error("bot 不存在");
    // 还没有任何会话时，这一次就是默认会话（主动开口和老回合的落点），不再额外造一条
    if (!threadOf(bot.id)) return ensureBotThread(bot, { title: title || "新话题" });
    const thread = {
      id: `th-bot-${bot.id}-${now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      todoId: null, title: String(title || "新话题").slice(0, 60),
      projectId: null, project: "", agentId: null,
      model: "", modelName: "", effort: "",
      kind: "bot", botId: bot.id,
      createdAt: now(), updatedAt: now(),
    };
    threadsOf().push(thread);
    store.persist();
    return thread;
  }

  function renameChat({ threadId, title } = {}) {
    const thread = threadsOf().find((t) => t.id === String(threadId || "") && t.kind === "bot");
    if (!thread) throw new Error("会话不存在");
    thread.title = String(title || "").trim().slice(0, 60) || thread.title;
    thread.updatedAt = now();
    store.persist();
    return thread;
  }

  /** 删会话：连它的消息一起删；默认会话不能删（老回合与主动开口都落在那里） */
  function removeChat({ threadId } = {}) {
    const id = String(threadId || "");
    const thread = threadsOf().find((t) => t.id === id && t.kind === "bot");
    if (!thread) throw new Error("会话不存在");
    if (thread.id === threadOf(thread.botId)?.id) throw new Error("默认会话不能删");
    stateOf().threads = threadsOf().filter((t) => t.id !== id);
    if (Array.isArray(stateOf().messages)) stateOf().messages = stateOf().messages.filter((m) => m.threadId !== id);
    stateOf().botTurns = turnsOf().filter((t) => t.threadId !== id);
    store.persist();
    return { ok: true };
  }

  /**
   * 从某条消息分支出新会话（ORCA 的 fork）：复制到这条为止的消息，标题加「分支」。
   * 源会话一条都不动 —— 分支是用来「换个说法重开」，不是编辑历史。
   */
  function forkChat({ threadId, messageId = "" } = {}) {
    const src = threadsOf().find((t) => t.id === String(threadId || "") && t.kind === "bot");
    if (!src) throw new Error("会话不存在");
    const msgs = (stateOf().messages || []).filter((m) => m.threadId === src.id && !m.supersededBy);
    if (!msgs.length) throw new Error("这条会话还没有消息可以分支");
    const at = messageId ? msgs.findIndex((m) => m.id === messageId) : msgs.length - 1;
    const keep = at >= 0 ? msgs.slice(0, at + 1) : msgs;
    const thread = {
      id: `th-bot-${src.botId}-${now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      todoId: null, title: `${String(src.title || "会话").slice(0, 50)}（分支）`,
      projectId: null, project: "", agentId: null,
      model: "", modelName: "", effort: "",
      kind: "bot", botId: src.botId,
      createdAt: now(), updatedAt: now(),
    };
    threadsOf().push(thread);
    for (const m of keep) {
      try { store.addMessage(thread.id, m.runId ?? null, m.role, m.kind || "text", m.content); }
      catch { /* 极简 store 没有消息层时只建会话 */ }
    }
    store.persist();
    return { thread, copied: keep.length };
  }

  /** 会话内搜索（ORCA 的 Chats 搜索框）：标题 + 消息正文，返回命中的会话与片段 */
  function searchChats({ botId, query = "" } = {}) {
    const q = String(query || "").trim().toLowerCase();
    const chats = chatsOf(String(botId || ""));
    if (!q) return { chats, hits: [] };
    const msgs = stateOf().messages || [];
    const hits = [];
    for (const chat of chats) {
      const mine = msgs.filter((m) => m.threadId === chat.id && !m.supersededBy);
      for (const m of mine) {
        const text = String(m.content || "");
        const at = text.toLowerCase().indexOf(q);
        if (at < 0) continue;
        hits.push({
          threadId: chat.id, messageId: m.id, at: m.createdAt || 0, role: m.role,
          snippet: `${at > 20 ? "…" : ""}${text.slice(Math.max(0, at - 20), at + q.length + 40)}`,
        });
        break; // 一个会话只要一条命中，列表里够用了
      }
    }
    const matched = new Set(hits.map((h) => h.threadId));
    const titled = chats.filter((c) => c.title.toLowerCase().includes(q));
    return {
      chats: chats.filter((c) => matched.has(c.id) || titled.includes(c)),
      hits,
    };
  }

  /**
   * 把一条回合镜像进会话：**说话的部分**进 messages，**沉默/被拦留在 bot_turns 审计里**。
   * 这样 Chat 里看到的就是一条不断的历史，而"为什么没说"仍然可查。
   */
  function mirror(row) {
    if (typeof store.addMessage !== "function") return; // 自测里的极简 store 没有消息层
    const speaks = ["replied", "answered", "asked", "interrupted"].includes(row.decision);
    if (!speaks || (!row.input && !row.reply)) return;
    const bot = bots().find((b) => b.id === row.botId);
    if (!bot) return;
    const thread = ensureBotThread(bot, { threadId: row.threadId || "" });
    // 两条一起写、由调用方最后统一 persist：mirror 在每条回复结束时都会跑，
    // 这里再各触发一次整库重写，对话越长越卡。
    if (row.decision === "replied" && row.input) store.addMessage(thread.id, null, "user", "text", row.input, {}, { defer: true });
    if (row.reply) store.addMessage(thread.id, null, "agent", "text", row.reply, {}, { defer: true });
    row.mirrored = true;
    row.threadId = thread.id;
  }

  function record(turn) {
    // 落库前脱敏：用户可能把 key 直接粘进输入框，回合账是本地的但也不该存明文
    const row = {
      id: nextTurnId(),
      channel: "local", input: "", runId: null, cost: {}, trace: [], ...turn, createdAt: now(),
    };
    if (row.input) row.input = redactSecrets(row.input).text;
    if (row.reply) row.reply = redactSecrets(row.reply).text;
    stateOf().botTurns.push(row);
    // 只保留最近 300 条，避免 tick 把库撑大
    if (stateOf().botTurns.length > 300) stateOf().botTurns = stateOf().botTurns.slice(-300);
    try { mirror(row); } catch (err) { log.warn?.(`[bot] 镜像到会话失败：${String(err?.message || err)}`); }
    store.persist();
    return row;
  }

  const REVISION_LIMIT = 20;
  const revisionsOf = () => (stateOf().botRevisions = Array.isArray(stateOf().botRevisions) ? stateOf().botRevisions : []);

  /** 只存「能教会它什么」的字段；status / mutedUntil 是操作状态，不进历史 */
  function revisionSnapshot(bot) {
    return {
      name: bot.name, avatar: bot.avatar, avatarClass: bot.avatarClass,
      persona: bot.persona || {}, capability: bot.capability, role: bot.role,
      executorAgentId: bot.executorAgentId || null, model: bot.model || "", effort: bot.effort || "",
      channels: bot.channels || ["local"], policy: bot.policy || {}, budget: bot.budget || {},
      skills: Array.isArray(bot.skills) ? bot.skills : [],
      projectId: bot.projectId || null, hostId: bot.hostId || null, team: bot.team || "",
    };
  }

  /** 改之前先把上一版存下来；同一次保存里旧值只存一次 */
  function recordRevision(bot) {
    if (!bot) return;
    const list = revisionsOf();
    list.push({
      id: `rv${now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      botId: bot.id, at: now(), by: "owner", data: revisionSnapshot(bot),
    });
    const mine = list.filter((r) => r.botId === bot.id).slice(-REVISION_LIMIT);
    stateOf().botRevisions = [...list.filter((r) => r.botId !== bot.id), ...mine];
  }

  function revisions(botId = "") {
    return revisionsOf()
      .filter((r) => r.botId === String(botId || ""))
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, REVISION_LIMIT)
      .map((r) => ({
        id: r.id, botId: r.botId, at: r.at, by: r.by || "owner",
        name: r.data?.name || "", mission: r.data?.persona?.mission || "",
      }));
  }

  /** 恢复 = 用旧快照再存一次（会先把当前版记成新历史，旧记录不删） */
  function restore(botId, revisionId) {
    const rev = revisionsOf().find((r) => r.id === String(revisionId || "") && r.botId === String(botId || ""));
    if (!rev) throw new Error("这条历史不存在");
    const bot = save({ id: String(botId), ...rev.data });
    return { bot, revisionId: rev.id };
  }

  const DIFF_FIELDS = [
    ["name", "名字"], ["capability", "能力"], ["role", "角色"], ["model", "模型"], ["effort", "思考档"],
    ["persona.mission", "职责"], ["persona.tone", "语气"],
    ["persona.duty.goal", "目标"], ["persona.duty.scope", "范围"], ["persona.duty.deliverable", "交付物"],
    ["persona.duty.forbidden", "不做什么"], ["persona.duty.report", "汇报口径"],
    ["policy.maxTurnsPerHour", "每小时上限"], ["policy.minGapMs", "最小间隔"],
    ["budget.tokensPerTurn", "单轮 token"], ["skills", "技能"], ["projectId", "默认项目"], ["hostId", "默认主机"], ["team", "团队"],
  ];
  const getPath = (obj, path) => path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);

  /** 对比「当前」与某一版历史，只列有变化的字段（不做行级 diff，够看人格/配额改了什么） */
  function revisionDiff(botId, revisionId) {
    const bot = bots().find((b) => b.id === String(botId || ""));
    if (!bot) throw new Error("bot 不存在");
    const rev = revisionsOf().find((r) => r.id === String(revisionId || "") && r.botId === String(botId || ""));
    if (!rev) throw new Error("这条历史不存在");
    const current = revisionSnapshot(bot);
    return DIFF_FIELDS.map(([path, label]) => {
      const from = getPath(rev.data, path);
      const to = getPath(current, path);
      if (JSON.stringify(from ?? "") === JSON.stringify(to ?? "")) return null;
      return { path, label, from: from ?? "", to: to ?? "" };
    }).filter(Boolean);
  }

  function save(patch = {}) {
    const list = stateOf().bots;
    const id = String(patch.id || `bot-${now().toString(36)}`);
    const existing = list.find((b) => b.id === id);
    // 并发：调用方带上自己看到的 updatedAt；对不上就拒绝，避免两个人（或两个页签）互相覆盖
    if (existing && patch.expectedUpdatedAt !== undefined && Number(patch.expectedUpdatedAt) !== existing.updatedAt) {
      const err = new Error("机器人已被别处修改，刷新后再试");
      err.code = "stale";
      throw err;
    }
    const next = {
      id,
      name: String(patch.name || existing?.name || "新 bot").slice(0, 40),
      avatar: String(patch.avatar || existing?.avatar || "B").slice(0, 2),
      avatarClass: String(patch.avatarClass || existing?.avatarClass || "a"),
      persona: { ...DEFAULT_PERSONA, ...(existing?.persona || {}), ...(patch.persona || {}) },
      capability: ["work", "dispatch", "read"].includes(patch.capability) ? patch.capability : (existing?.capability || "read"),
      role: patch.role === "supervisor" || patch.role === "worker" ? patch.role : (existing?.role || "worker"),
      executorAgentId: String(patch.executorAgentId ?? existing?.executorAgentId ?? "") || null,
      // 模型 / 推理档：只在 bot 上存一份，chatStream 每次读它
      model: String(patch.model ?? existing?.model ?? "").slice(0, 80),
      effort: String(patch.effort ?? existing?.effort ?? "").slice(0, 40),
      channels: Array.isArray(patch.channels) ? patch.channels : (existing?.channels || ["local"]),
      policy: {
        ...DEFAULT_POLICY,
        ...(existing?.policy || {}),
        ...(patch.policy || {}),
        notify: {
          ...DEFAULT_POLICY.notify,
          ...(existing?.policy?.notify || {}),
          ...(patch.policy?.notify || {}),
        },
        standing: {
          ...DEFAULT_POLICY.standing,
          ...(existing?.policy?.standing || {}),
          ...(patch.policy?.standing || {}),
        },
      },
      budget: { ...DEFAULT_BUDGET, ...(existing?.budget || {}), ...(patch.budget || {}) },
      skills: patch.skills !== undefined
        ? (Array.isArray(patch.skills) ? patch.skills.map(String).filter(Boolean).slice(0, 8) : [])
        : (Array.isArray(existing?.skills) ? existing.skills : []),
      projectId: patch.projectId !== undefined ? (String(patch.projectId || "") || null) : (existing?.projectId || null),
      hostId: patch.hostId !== undefined ? (String(patch.hostId || "") || null) : (existing?.hostId || null),
      team: String(patch.team ?? existing?.team ?? "").slice(0, 40),
      plan: existing?.plan || null,
      status: patch.status === "paused" ? "paused" : (patch.status || existing?.status || "active"),
      mutedUntil: Number(patch.mutedUntil ?? existing?.mutedUntil ?? 0),
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
    };
    if (!existing) list.push(next);
    else {
      // 没有实质变化（失焦保存同一句话）不造历史
      if (JSON.stringify(revisionSnapshot(existing)) !== JSON.stringify(revisionSnapshot(next))) recordRevision(existing);
      Object.assign(existing, next);
    }
    store.persist();
    onChange();
    return next;
  }

  /* ------------------------------------------------------------------ 日程 */

  const routinesOf = () => (stateOf().routines = Array.isArray(stateOf().routines) ? stateOf().routines : []);

  function listRoutines(botId = "") {
    const list = routinesOf();
    const mine = botId ? list.filter((r) => r.botId === String(botId)) : list;
    return mine.map((r) => ({ ...r, when: describeRoutine(r), nextAt: nextRunAt(r, now()) }));
  }

  function saveRoutine(patch = {}) {
    const list = routinesOf();
    const botId = String(patch.botId || list.find((r) => r.id === patch.id)?.botId || "");
    if (!botId || !bots().some((b) => b.id === botId)) throw new Error("日程必须先绑定一个 bot");
    const existing = patch.id ? list.find((r) => r.id === String(patch.id)) || null : null;
    const next = { ...normalizeRoutine(patch, existing), botId };
    if (!next.name) next.name = describeRoutine(next);
    if (existing) Object.assign(existing, next);
    else list.push(next);
    store.persist();
    onChange();
    return { ...next, when: describeRoutine(next), nextAt: nextRunAt(next, now()) };
  }

  function removeRoutine(id) {
    stateOf().routines = routinesOf().filter((r) => r.id !== String(id));
    store.persist();
    onChange();
    return true;
  }

  /** 每个日程"现在为什么不动"：UI 用它回答"为什么没跑" */
  function routineStatus(botId = "") {
    return listRoutines(botId).map((r) => {
      const verdict = routineDue(r, { now: now(), probe: probeWatch });
      return { ...r, due: verdict.due, why: verdict.reason };
    });
  }

  function setStatus(id, { status, mutedUntil } = {}) {
    const bot = bots().find((b) => b.id === String(id));
    if (!bot) throw new Error("bot 不存在");
    if (status === "active" || status === "paused") bot.status = status;
    if (mutedUntil !== undefined) bot.mutedUntil = Number(mutedUntil) || 0;
    bot.updatedAt = now();
    store.persist();
    onChange();
    return bot;
  }

  function remove(id) {
    stateOf().bots = bots().filter((b) => b.id !== String(id));
    stateOf().botTurns = turnsOf().filter((t) => t.botId !== String(id));
    stateOf().routines = routinesOf().filter((r) => r.botId !== String(id));
    stateOf().botRevisions = revisionsOf().filter((r) => r.botId !== String(id));
    store.persist();
    onChange();
  }

  function snapshot(limit = 80) {
    const turns = turnsOf();
    return {
      bots: bots(),
      agents: (stateOf().agents || []).map((a) => ({ id: a.id, name: a.name, alias: a.alias || "", cli: a.cli, role: a.role || "worker", hostId: a.hostId || null })),
      turns: turns.slice(-limit),
      routines: listRoutines(),
      routineStatus: routineStatus(),
      asks: openAsks(),
      botThreads: bots().reduce((acc, b) => {
        const t = threadOf(b.id);
        if (t) acc[b.id] = t.id;
        return acc;
      }, {}),
      // 照搬 ORCA 的 Chats：每个 bot 一条会话列表（默认会话 + 自己新开的）
      botChats: bots().reduce((acc, b) => {
        const list = chatsOf(b.id);
        if (list.length) acc[b.id] = list;
        return acc;
      }, {}),
      recent: {
        answeredHour: turns.filter((t) => t.decision === "answered" && now() - t.createdAt < HOUR).length,
        blockedHour: turns.filter((t) => t.decision === "blocked" && now() - t.createdAt < HOUR).length,
        silentHour: turns.filter((t) => t.decision === "silent" && now() - t.createdAt < HOUR).length,
      },
    };
  }

  /**
   * 记忆召回：bot 只看「共享 + 自己的」条目（owner=bot:<id>），注入按 2400 字符裁。
   * 传 runId 是为了落 inject_log 台账——bot 的注入也要能被归因，否则「它当时记得什么」无从查。
   */
  function recall(bot, runId = "", { maxChars = INJECT_CHARS, query = "" } = {}) {
    const budget = Math.max(800, Number(maxChars) || INJECT_CHARS);
    try {
      const ctx = memory?.()?.inject?.({ maxChars: budget, runId, owner: `bot:${bot.id}`, query }) || { items: [] };
      let markdown = String(ctx.markdown || "");
      // 容量外显：只在这条注入已经装到 80% 以上时才说，避免每轮都念一遍预算
      try {
        const use = memory?.()?.usage?.({ maxChars: budget });
        if (use && use.ratio >= 0.8) {
          markdown += `\n\n（记忆预算已用 ${use.chars}/${use.budget} 字符 · 条目 ${use.entries} · 观察 ${use.notes}${use.dropped ? ` · 被裁 ${use.dropped}` : ""}：满了先合并或删，不要一直追加）`;
        }
      } catch { /* usage 失败不影响注入 */ }
      return {
        markdown,
        chars: markdown.length,
        dropped: Number(ctx.dropped) || 0,
        injected: (ctx.items || []).filter((i) => i.included).slice(0, 12)
          .map((i) => ({ layer: i.layer, id: i.id, title: i.title })),
      };
    } catch (err) {
      log.warn?.(`[bot] ${bot.id} 记忆注入失败：${String(err?.message || err)}`);
      return { markdown: "", chars: 0, dropped: 0, injected: [] };
    }
  }

  /** 同僚目录：路由靠「名字 + 一句话职责」，不是靠把群聊记录塞进上下文 */
  function teammatesOf(bot) {
    return bots()
      .filter((b) => b.id !== bot.id && b.status !== "paused")
      .slice(0, 8)
      .map((b) => ({ name: b.name, role: b.role, team: b.team || "", mission: b.persona?.mission || "" }));
  }

  /** 它最近主动说出口的话：进 system prompt，而不是拼进 history（会破坏 user/assistant 交替） */
  function recentSaid(bot, limit = 3) {
    return turnsOf()
      .filter((t) => t.botId === bot.id && t.decision === "answered" && t.reply)
      .slice(-limit)
      .map((t) => t.reply);
  }

  /** 出站敏感词：命中即不外发（正文只留在本地审计里） */
  function hitBlocklist(bot, text) {
    const list = (bot.policy?.sensitiveBlocklist || []).map((w) => String(w || "").trim()).filter(Boolean);
    return list.find((w) => String(text).includes(w)) || "";
  }

  /** 让模型只说一句话；没有 key / 调用失败都算沉默，不编内容 */
  async function speak(bot, candidate, memoryBlock, recent = []) {
    if (typeof chat !== "function" || !key?.()) return { reply: "", reason: "缺少模型 key，只记录沉默" };
    const system = buildSystemPrompt(bot, memoryBlock, { proactive: true, recentProactive: recent, skills: skillsFor(bot.skills), plan: bot.plan || null });
    const user = `工作区事件：${candidate.title}（${candidate.kind}${candidate.key ? ` · ${candidate.key}` : ""}）${candidate.url ? `\n链接：${candidate.url}` : ""}${candidate.instruction ? `\n这次要做的：${candidate.instruction}` : ""}`;
    const res = await chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ], { key: key(), maxTokens: Number(bot.budget?.tokensPerTurn) || DEFAULT_BUDGET.tokensPerTurn, temperature: 0.6 });
    const text = String(res?.text || "").trim();
    if (!text) return { reply: "", reason: "模型没有返回内容" };
    if (/^SILENT\b/i.test(text)) return { reply: "", reason: "模型判断不值得开口" };
    // `ASK: 你想让我先看哪一个？` → 落成一张可作答的卡片（正文只有问题本身）
    const ask = text.match(/^ASK\s*[:：]\s*(.+)$/is);
    if (ask) return { ask: ask[1].trim().slice(0, 300), reply: ask[1].trim().slice(0, 300), usage: res?.usage || null };
    return { reply: text.slice(0, 400), usage: res?.usage || null };
  }

  /** "这个 bot 现在忙不忙"：正在生成，或刚说完不到 2 分钟（in-chat 日程要等这个） */
  function busyReason(bot) {
    const turns = turnsOf();
    if (turns.some((t) => t.botId === bot.id && t.decision === "streaming")) return "正在回上一条";
    const last = [...turns].reverse().find((t) => t.botId === bot.id && (t.decision === "replied" || t.decision === "answered"));
    if (last && now() - last.createdAt < 2 * MINUTE) return "刚说过话不到 2 分钟";
    return "";
  }

  /** 这一轮最该跑的日程（到点 / 到间隔 / 有变化），没有就 null */
  function dueRoutineFor(bot) {
    const mine = routinesOf().filter((r) => r.botId === bot.id && r.enabled);
    for (const r of mine) {
      const verdict = routineDue(r, { now: now(), probe: probeWatch });
      if (verdict.due) return { routine: r, verdict };
      // 第一次建基线：把指纹记下来，否则下次永远"有变化"
      if (verdict.baseline && verdict.hash) { r.lastHash = verdict.hash; store.persist(); }
      if (verdict.hash && !verdict.baseline) { r.lastHash = verdict.hash; store.persist(); }
      if (verdict.reason?.startsWith("看不了")) { r.lastError = verdict.reason; store.persist(); }
    }
    return null;
  }

  /** 跑一个 bot 的一次决策；返回这一轮的 BotTurn */
  async function tickBot(bot, { force = false } = {}) {
    const turns = turnsOf();
    const turnId = nextTurnId();

    // 0) 创建后第一轮：先问用途。不问的话它永远是个"默认 bot"（Rakazo 的 hidden intro 同款做法）
    if (bot.intro && !turns.some((t) => t.botId === bot.id)) {
      const question = `我是${bot.name}。你想让我干什么？说一句就行，我记成职责；以后随时能改。`;
      // 注意：这里不落 `intro = false`——要等用户真答了才结（reply 里落），
      // 否则"第一句话成为职责"永远走不到。重复提问由上面的 `!turns.some` 拦住。
      return record({
        id: turnId, botId: bot.id, trigger: { kind: "intro", ref: "" },
        decision: "asked", reason: "创建后第一次开口：先问用途，不先客套",
        reply: question, injected: [], cost: {},
        ask: { text: question, status: "open", options: [], createdAt: now() },
      });
    }

    // 1) 先看日程（很便宜：读本地状态 + 一次 stat），再走闸门——
    //    因为"到点的日程"要允许跳过最小间隔，否则排好的早报会被刚说的闲话挡掉
    let due = dueRoutineFor(bot);
    const gate = gatesFor(bot, { now: now(), turns, force, ignoreGap: Boolean(due) });
    if (!gate.ok) {
      const lastSilent = [...turns].reverse().find((t) => t.botId === bot.id && (t.decision === "silent" || t.decision === "blocked"));
      if (lastSilent && now() - lastSilent.createdAt < 30 * MINUTE) return null; // 沉默/被拦 30 分钟最多记一条
      return record({ id: turnId, botId: bot.id, trigger: { kind: "tick", ref: "" }, decision: gate.decision, reason: gate.reason, injected: [], reply: "", cost: {} });
    }

    // 2) 落点：in-chat 的日程要等这个 bot 空下来；等满 5 分钟就并进去，不能无限等
    if (due && due.routine.mode === "in-chat") {
      const busy = busyReason(bot);
      const waited = due.routine.waitingSince ? now() - due.routine.waitingSince : 0;
      if (busy && waited < WAIT_LIMIT_MS) {
        if (!due.routine.waitingSince) { due.routine.waitingSince = now(); store.persist(); }
        return null; // 这一轮先不说话（不写静默回合，否则每次 tick 都刷一行）
      }
      if (due.routine.waitingSince) { due.routine.waitingSince = 0; store.persist(); }
    }
    const candidate = due
      ? { kind: "routine", ref: `routine:${due.routine.id}`, title: due.routine.name || describeRoutine(due.routine), routineId: due.routine.id, instruction: due.routine.prompt || "" }
      : collectCandidates(stateOf(), { now: now(), recentTurns: turns, botId: bot.id })[0];

    // 日程是"已经判定该跑"，不参与事件打分（否则会被 0 分当成不值得说）
    const score = due ? 1 : (candidate?.score ?? 0);
    if (!candidate || score < 0.5) {
      const lastSilent = [...turns].reverse().find((t) => t.botId === bot.id && (t.decision === "silent" || t.decision === "blocked"));
      if (lastSilent && now() - lastSilent.createdAt < 30 * MINUTE) return null;
      return record({
        id: turnId,
        botId: bot.id, trigger: candidate ? { kind: candidate.kind, ref: candidate.ref } : { kind: "tick", ref: "" },
        decision: "silent",
        reason: candidate ? `打分 ${Number(score).toFixed(2)} < 0.5` : "没有值得开口的事件",
        injected: [], reply: "", cost: {},
      });
    }

    // 3) 事件级防重复（同一事件说过太多次 / 与上一条近重复）
    const suppress = suppressionReason({ turns, botId: bot.id, candidate, now: now() });
    if (suppress.blocked) {
      return record({
        id: turnId, botId: bot.id, trigger: { kind: candidate.kind || "tick", ref: candidate.ref || "" },
        input: candidate.title, decision: "blocked", reason: suppress.reason, injected: [], reply: "", cost: {},
      });
    }

    const { markdown, injected } = recall(bot, `bot:${bot.id}:${turnId}`, { query: candidate?.title || "" });
    const started = now();
    let result;
    try {
      result = await speak(bot, candidate, markdown, recentSaid(bot));
    } catch (err) {
      log.warn?.(`[bot] ${bot.id} 调用模型失败：${String(err?.message || err)}`);
      return record({
        id: turnId, botId: bot.id, trigger: { kind: candidate.kind, ref: candidate.ref }, decision: "silent",
        reason: `模型调用失败：${String(err?.message || err).slice(0, 120)}`, injected, reply: "", cost: {},
      });
    }
    if (!result.reply) {
      return record({
        id: turnId, botId: bot.id, trigger: { kind: candidate.kind, ref: candidate.ref },
        decision: "silent", reason: result.reason || "无话可说", injected, reply: "", cost: {},
      });
    }

    // 4) 生成之后再查一次"是不是换了个说法重说"
    const dup = suppressionReason({ turns, botId: bot.id, candidate, now: now(), reply: result.reply });
    if (dup.blocked) {
      return record({
        id: turnId, botId: bot.id, trigger: { kind: candidate.kind, ref: candidate.ref },
        input: candidate.title, injected, reply: result.reply, decision: "blocked", proposal: null,
        reason: dup.reason, cost: { tokens: result.usage?.totalTokens ?? null, ms: now() - started },
      });
    }

    // 4.5) 模型要问一句：落卡片（可作答），不占"回话"的位置
    if (result.ask) {
      const asked = record({
        id: turnId, botId: bot.id, trigger: { kind: candidate.kind, ref: candidate.ref },
        input: candidate.title, injected, reply: result.ask, decision: "asked",
        ask: { text: result.ask, status: "open", options: [], createdAt: now() },
        cost: { tokens: result.usage?.totalTokens ?? null, ms: now() - started },
      });
      if (due?.routine) { due.routine.lastFiredAt = now(); due.routine.waitingSince = 0; store.persist(); }
      return asked;
    }

    // 5) 出站敏感词
    const hitWord = hitBlocklist(bot, result.reply);
    if (hitWord) {
      return record({
        id: turnId, botId: bot.id, trigger: { kind: candidate.kind, ref: candidate.ref },
        input: candidate.title, injected, reply: result.reply, decision: "blocked", proposal: null,
        reason: `命中敏感词「${hitWord}」，未发送`,
        cost: { tokens: result.usage?.totalTokens ?? null, ms: now() - started },
      });
    }

    // 6) 日程记账：只有真正开口才算跑过（沉默 / 被拦不推进窗口，下一轮还会重试）
    if (due?.routine) {
      due.routine.lastFiredAt = now();
      due.routine.waitingSince = 0;
      if (due.verdict?.hash) due.routine.lastHash = due.verdict.hash;
      due.routine.lastError = "";
      due.routine.updatedAt = now();
      store.persist();
    }

    // dispatch 档位：建议落成一条待确认的任务；不自动起 run（审批仍在桌面）
    const proposal = bot.capability === "dispatch" && candidate.todoId
      ? {
          title: `处理：${candidate.title}`.slice(0, 80),
          desc: `${bot.name} 主动建议（${candidate.kind}${candidate.key ? ` · ${candidate.key}` : ""}）\n来源：${candidate.ref}\n
先说清楚要做什么再动手；起 run 仍需你在桌面确认。`,
          dismissed: false,
        }
      : null;
    return record({
      id: turnId, botId: bot.id, trigger: { kind: candidate.kind, ref: candidate.ref },
      input: candidate.title, injected, reply: result.reply, decision: "answered",
      runId: null, proposal, cost: { tokens: result.usage?.totalTokens ?? null, ms: now() - started },
    });
  }

  /**
   * 一轮对话可能包含多次只读工具调用：模型要查，就去查；查完再回答。
   *
   * 设计边界（和 capability 三档对齐）：
   *  - 这里**只**能调只读工具（记忆 / 资料 / 任务 / 运行），执行体在 main；
   *  - 写操作（改文件、跑命令、起任务）不在工具表里，只能靠提议给人确认；
   *  - 最多 4 轮，防模型在两个工具之间来回问；网关不支持 tools 时自动退回纯对话。
   */
  async function chatStreamWithTools(messages, bot, onDelta, signal, onTool, { turnId = "", groupId = "" } = {}) {
    // read 档也发工具：只读工具 + 自己的记忆。能力档只决定有没有 task_create。
    const tools = runTool ? botToolsFor(bot.capability) : [];
    const allowed = new Set(tools.map((t) => t.function.name));
    const model = String(bot.model || "").trim() || undefined;
    const maxTokens = Number(bot.budget?.tokensPerTurn) || DEFAULT_BUDGET.tokensPerTurn;
    const policy = effortPolicy(bot.effort);
    const maxRounds = Math.min(Math.max(Number(bot.budget?.maxRounds) || policy.rounds, 1), MAX_TOOL_ROUNDS_HARD);
    const trace = [];
    const events = [];
    const seen = new Map();
    let conversation = messages;
    let text = "";
    let toolCalls = 0;
    let stopReason = "";
    const rounds = { used: 0, max: maxRounds, calls: 0 };

    for (let round = 0; round < maxRounds; round += 1) {
      rounds.used = round + 1;
      const roundAt = now();
      let res;
      try {
        res = await chatStream(conversation, {
          key: key(),
          model,
          maxTokens,
          temperature: tools.length ? policy.temperature : 0.7,
          onDelta,
          signal,
          tools: tools.length ? tools : null,
        });
      } catch (err) {
        // 部分网关不支持 function calling：第一轮就退回纯对话，不要让人看不到回复
        if (round === 0 && tools.length && /tools?|function|400/i.test(String(err?.message || ""))) {
          res = await chatStream(messages, {
            key: key(), model, maxTokens,
            temperature: temperatureFor(false), onDelta, signal,
          });
          return { ...res, toolTrace: [], events, stopReason: "", toolFallback: true, rounds };
        }
        throw err;
      }
      events.push({
        kind: "request", round,
        at: roundAt, ms: Math.max(0, now() - roundAt),
        usage: res?.usage || {}, ttft: res?.ttft, text: String(res?.text || ""),
      });
      text += String(res?.text || "");
      const calls = res?.toolCalls || [];
      if (!calls.length) return { ...res, text, toolTrace: trace, events, stopReason, rounds };

      // 模型可能编出工具表里没有的名字：照样回一条 tool 错误，让它自己改口，不执行。
      conversation = [
        ...conversation,
        {
          role: "assistant",
          content: String(res?.text || ""),
          tool_calls: calls.map((c) => ({ id: c.id || c.name, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
        },
      ];
      for (const call of calls) {
        toolCalls += 1;
        rounds.calls = toolCalls;
        if (toolCalls > MAX_TOOL_CALLS) { stopReason = `工具调用超过 ${MAX_TOOL_CALLS} 次`; break; }
        const sig = toolSignature(call.name, call.args);
        const repeats = (seen.get(sig) || 0) + 1;
        seen.set(sig, repeats);
        if (repeats > TOOL_REPEAT_LIMIT) { stopReason = `同一工具同参数调了 ${repeats} 次`; break; }
        let result;
        if (allowed.has(call.name)) {
          const args = parseToolArgs(call.args);
          const startedAt = now();
          try { onTool?.({ name: call.name, phase: "start" }); } catch { /* 回调失败不影响查询 */ }
          try { result = await runTool(call.name, args, { bot, turnId, groupId }); } catch (err) { result = { error: String(err?.message || err) }; }
          try { onTool?.({ name: call.name, phase: "done" }); } catch { /* 忽略 */ }
          const failed = Boolean(result && typeof result === "object" && "error" in result);
          const cap = Number(BOT_TOOL_META[call.name]?.maxResultChars) || 6000;
          const resultText = JSON.stringify(result).slice(0, cap);
          trace.push({
            name: call.name,
            args: JSON.stringify(args).slice(0, 240),
            argsRaw: JSON.stringify(args).slice(0, 6000),
            result: resultText,
            ms: Math.max(0, now() - startedAt),
            at: startedAt,
            ok: !failed,
            preview: String(failed ? result.error : resultText).slice(0, 240),
            // 和 ACP 侧同一套字段：前端按 family/status 选卡，不再靠工具名正则猜
            family: toolFamily({ title: call.name }),
            statusKind: normalizeToolStatus(failed ? "failed" : "completed", { failed }),
            durationMs: Math.max(0, now() - startedAt),
            agentId: bot.id,
          });
          events.push({ kind: "tool", name: call.name, argsRaw: JSON.stringify(args).slice(0, 6000), result: resultText, ms: Math.max(0, now() - startedAt), at: startedAt, ok: !failed, family: toolFamily({ title: call.name }), statusKind: failed ? "failed" : "done" });
        } else {
          const rejectedAt = now();
          trace.push({ name: call.name, rejected: true, ok: false, at: rejectedAt, preview: "不在工具表里", family: toolFamily({ title: call.name }), statusKind: "denied", durationMs: 0, agentId: bot.id });
          events.push({ kind: "tool", name: call.name, argsRaw: String(call.args || "{}").slice(0, 6000), result: "不在工具表里", at: rejectedAt, ms: 0, ok: false, rejected: true, family: toolFamily({ title: call.name }), statusKind: "denied" });
          result = { error: `工具 ${call.name} 不可用：可用的工具是 ${[...allowed].join(" / ")}；改文件 / 跑任意命令 / 改设置仍不允许。` };
        }
        conversation = [...conversation, {
          role: "tool", tool_call_id: call.id || call.name,
          content: JSON.stringify(result).slice(0, 4000),
        }];
      }
      if (stopReason) break;
    }
    return {
      text, toolCalls: [], usage: {}, toolTrace: trace, events, rounds,
      stopReason: stopReason || `达到 ${maxRounds} 轮工具上限`,
    };
  }

  /** 被动回复：同一个 bot、同一份记忆，流式吐字；落一条 decision=replied 的回合 */
  async function reply(bot, text, { onDelta, onTool, signal, threadId = "", groupContext = "", groupId = "" } = {}) {
    const clean = String(text || "").trim().slice(0, 2000);
    if (!clean) throw new Error("说点什么");
    if (typeof chatStream !== "function") throw new Error("当前环境不支持流式回复");
    if (!key?.()) throw new Error("缺少模型 key：设置 → 执行里配置 ARK_API_KEY");
    const turnId = nextTurnId();
    // 人回话了：把这个 bot 挂着的提问卡片结掉（卡片不挡聊天，所以允许一句话答多张）
    try { settleAsks(bot.id, { answer: clean, status: "answered" }); } catch { /* 卡片结不掉不影响回话 */ }
    // 创建后它先问了"你想让我干什么"：用户的第一句话就是职责（不覆盖已有职责）。
    // intro 期间种子里的默认 mission 只是占位，用户亲口说的要盖过它。
    if (bot.intro || !bot.persona?.mission) {
      bot.persona = { ...(bot.persona || {}), mission: redactSecrets(clean).text.slice(0, 200) };
      bot.intro = false;
      bot.updatedAt = now();
      store.persist();
      onChange();
    }
    const { markdown, injected, chars: memoryChars } = recall(bot, `bot:${bot.id}:${turnId}`, { maxChars: BOT_INJECT_CHARS, query: clean });
    // 历史优先读这条会话的真实消息（含主动开口），没有消息层时退回 bot_turns
    const thread = ensureBotThread(bot, { threadId });
    const threadMsgs = (stateOf().messages || [])
      .filter((m) => m.threadId === thread.id && (m.role === "user" || m.role === "agent") && m.content && !m.supersededBy);
    const fromThread = threadMsgs
      .slice(-HISTORY_KEEP)
      .map((m) => ({ role: m.role === "agent" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }));
    // 超过 24 条就把「最近 10 条之外」压成一段背景（纯函数，不额外调模型）。
    const digest = fromThread.length ? historyDigest(threadMsgs) : "";
    if (digest && thread.digest !== digest) {
      thread.digest = digest;
      thread.digestAt = now();
      thread.digestCount = Math.max(0, threadMsgs.length - HISTORY_KEEP);
    }
    const history = fromThread.length
      ? [
          ...(digest ? [{ role: "system", content: `更早的对话（自动压缩，只作背景，不是事实来源）：\n${digest}` }] : []),
          ...fromThread,
        ]
      : turnsOf()
        .filter((t) => t.botId === bot.id && t.decision === "replied" && t.reply)
        .slice(-HISTORY_KEEP)
        .flatMap((t) => [{ role: "user", content: t.input }, { role: "assistant", content: t.reply }]);
    const projects = stateOf().projects || [];
    const project = (bot.projectId && projects.find((p) => p.id === bot.projectId))
      || projects.find((p) => p.id === stateOf().activeProjectId)
      || projects[0] || null;
    const host = bot.hostId ? (stateOf().hosts || []).find((h) => h.id === bot.hostId) : null;
    const compiled = compileContext(bot, markdown, {
      proactive: false,
      recentProactive: recentSaid(bot),
      teammates: teammatesOf(bot),
      workspace: project
        ? `${project.name || "当前项目"}（${project.path || ""}）${host ? ` · 主机 ${host.name || host.id}` : ""}`
        : "",
      inGroup: Boolean(groupId),
      skills: skillsFor(bot.skills),
      plan: bot.plan || null,
    });
    const started = now();
    // 先落一条 streaming：应用中途被杀时，下一轮 ensureSeed 会把它收成 interrupted，
    // 用户看到的是“说到一半被打断”，而不是整段对话凭空消失。
    const pending = record({
      id: turnId, botId: bot.id, trigger: { kind: "mention", ref: "" },
      input: clean, injected, reply: "", decision: "streaming", cost: {}, threadId: thread.id,
    });
    pending.context = {
      chars: compiled.chars,
      memory: compiled.memoryChars,
      memoryRaw: memoryChars,
      history: fromThread.length,
      digest: Boolean(digest),
      sections: compiled.sectionChars,
    };
    let acc = "";
    let lastFlush = 0;
    const onDeltaTracked = (delta) => {
      acc += String(delta || "");
      onDelta?.(delta);
      // 每 800ms 落一次：只写当前这一行 bot_turn，不再整库重写；
      // 整库写会占住主进程，IPC 里的 delta 只能排队，界面就会一顿一顿。
      if (now() - lastFlush > 800) {
        pending.reply = acc.slice(0, 4000);
        if (typeof store.saveBotTurn === "function") store.saveBotTurn(pending);
        else store.persist();
        lastFlush = now();
      }
    };
    let res;
    try {
      const groupNote = String(groupContext || "").trim();
      res = await chatStreamWithTools([
        { role: "system", content: compiled.system },
        // 群聊里已经说过的话：让 SE 能看到 PM 的分配再讨论，而不是各说各的
        ...(groupNote ? [{ role: "system", content: `群聊里其他人这轮已经说的（只作讨论上下文，不要冒充他们，也不要重复他们的整段）：\n${groupNote}` }] : []),
        ...history,
        { role: "user", content: clean },
      ], bot, onDeltaTracked, signal, onTool, { turnId, groupId });
    } catch (err) {
      // 取消：把已经吐出来的半截留下，标成 interrupted（界面上是「被打断」+ 半截）
      if (signal?.aborted) {
        pending.reply = acc.slice(0, 4000);
        pending.decision = "interrupted";
        pending.reason = pending.reply ? "你中途叫停了" : "还没有吐字就被叫停";
        pending.cost = { ...(pending.cost || {}), ms: now() - started };
        if (typeof store.saveBotTurn === "function") store.saveBotTurn(pending);
        else store.persist();
        throw err;
      }
      // 报错：这条回合不该留在账上（半截流式内容只在真崩溃时才有意义）
      stateOf().botTurns = turnsOf().filter((t) => t.id !== pending.id);
      store.persist();
      throw err;
    }
    const answer = String(res?.text || "").trim()
      || (res?.stopReason ? `我查到这里停下了：${res.stopReason}。要继续的话告诉我从哪一步接。` : "");
    if (!answer) {
      stateOf().botTurns = turnsOf().filter((t) => t.id !== pending.id);
      store.persist();
      throw new Error("模型没有返回内容");
    }
    if (res?.stopReason) pending.stopReason = res.stopReason;
    Object.assign(pending, {
      reply: answer.slice(0, 4000), decision: "replied",
      cost: {
        tokens: res?.usage?.total_tokens ?? null, ms: now() - started,
        ttftMs: res?.ttft ?? null, model: res?.model || "",
        rounds: res?.rounds?.used ?? null, toolCalls: res?.rounds?.calls ?? null,
      },
    });
    // 新话题的第一句话就是标题：Chats 列表里不出现一排“新话题”
    if (thread.title === "新话题") {
      thread.title = clean.replace(/\s+/g, " ").slice(0, 40);
      thread.updatedAt = now();
    }
    // 工具调用留痕：没有这一步，“它到底查了什么”只能靠猜
    if (res?.toolTrace?.length) pending.tools = res.toolTrace.slice(0, 40);
    // 这一轮建过的任务：挂到回合上，Bot 的「任务」页签与看板才能反查到
    const created = (res?.toolTrace || [])
      .filter((t) => t.name === "task_create" && t.ok && t.result)
      .map((t) => { try { return JSON.parse(t.result); } catch { return null; } })
      .filter((x) => x && x.ok && x.todoId);
    if (created.length) {
      pending.todoIds = created.map((x) => x.todoId);
      pending.todoId = pending.todoIds[0];
    }
    pending.trace = [...(res?.events || []), ...(res?.toolTrace || [])].slice(0, 200);
    // 日程建议：工具只返回草稿，确认前不建；卡片挂在回合上（刷新不丢）
    const routineProposal = (res?.toolTrace || [])
      .filter((t) => t.name === "routine_propose" && t.ok && t.result)
      .map((t) => { try { const r = JSON.parse(t.result); return r?.ok && r.routine ? r.routine : null; } catch { return null; } })
      .filter(Boolean)
      .at(-1);
    if (routineProposal) pending.routineProposal = { ...routineProposal, proposedAt: now() };
    // 群聊交接：工具只返回对象；真正写系统消息 / 唤醒目标由 botGroupSend 做
    const handoff = (res?.toolTrace || [])
      .filter((t) => t.name === "handoff_to_bot" && t.ok && t.result)
      .map((t) => { try { const r = JSON.parse(t.result); return r?.ok && r.handoff ? r.handoff : null; } catch { return null; } })
      .filter(Boolean)
      .at(-1);
    if (handoff) pending.handoff = handoff;
    // 成功后补镜像（streaming 阶段还不该进会话，否则 Chat 里会先出现一条空回复）
    try { mirror(pending); } catch (err) { log.warn?.(`[bot] 镜像到会话失败：${String(err?.message || err)}`); }
    store.persist();
    return pending;
  }

  /**
   * 把历史回合补进各自的 thread（老数据一次性搬家）。**幂等**：已镜像过的回合不再写。
   * `dryRun` 只数数，用来先看一眼"将迁移多少条"。
   */
  function migrateThreads({ dryRun = false } = {}) {
    const counts = { bots: 0, turns: 0, messages: 0, dryRun: Boolean(dryRun) };
    for (const bot of bots()) {
      const pending = turnsOf()
        .filter((t) => t.botId === bot.id && !t.mirrored)
        .filter((t) => ["replied", "answered", "asked", "interrupted"].includes(t.decision))
        .filter((t) => t.input || t.reply);
      if (!pending.length) continue;
      counts.bots += 1;
      counts.turns += pending.length;
      for (const t of pending) counts.messages += (t.decision === "replied" && t.input ? 1 : 0) + (t.reply ? 1 : 0);
      if (dryRun) continue;
      const thread = ensureBotThread(bot);
      for (const t of pending) {
        if (t.decision === "replied" && t.input) store.addMessage(thread.id, null, "user", "text", t.input);
        if (t.reply) store.addMessage(thread.id, null, "agent", "text", t.reply);
        t.mirrored = true;
        t.threadId = thread.id;
      }
    }
    if (!dryRun && counts.turns) store.persist();
    return counts;
  }

  /** 监视：把某个任务挂到这个 bot 名下，状态变化时用它口吻汇报 */
  function watch({ botId, todoId, title }) {
    const already = turnsOf().find((t) => t.botId === botId && t.todoId === todoId && t.decision === "watching");
    if (already) return already;
    return record({
      botId, trigger: { kind: "todo.watch", ref: `todo:${todoId}` },
      decision: "watching", todoId, reply: `开始监视 ${title || todoId}`, injected: [], cost: {},
    });
  }

  function unwatch({ botId, todoId }) {
    const before = turnsOf().length;
    stateOf().botTurns = turnsOf().filter((t) => !(t.botId === botId && t.todoId === todoId && t.decision === "watching"));
    if (stateOf().botTurns.length !== before) store.persist();
    return { ok: true, removed: before - stateOf().botTurns.length };
  }

  /** 执行回流：bot 起的 run 结束后，用它自己的口吻汇报一条（decision=reported） */
  function report({ botId, todoId, runId, text, kind = "run.finished" }) {
    return record({
      botId, trigger: { kind, ref: `todo:${todoId}` },
      decision: "reported", reply: String(text || "").slice(0, 400),
      runId: runId || null, injected: [], cost: {},
    });
  }

  async function tick({ botId = "", force = false } = {}) {
    const list = botId ? bots().filter((b) => b.id === botId) : bots();
    const out = [];
    for (const bot of list) {
      if (bot.status !== "active" && !force) continue;
      const turn = await tickBot(bot, { force });
      if (turn) out.push(turn);
    }
    if (out.length) onChange();
    return out;
  }

  return {
    ensureSeed, list: bots, snapshot, turns: turnsOf, save, setStatus, remove, tick, reply,
    report, watch, unwatch,
    listRoutines, saveRoutine, removeRoutine, routineStatus,
    revisions, restore, revisionDiff,
    openAsks,
    settleAsks,
    threadOf: (botId) => threadOf(String(botId || "")),
    chats: (botId) => chatsOf(String(botId || "")),
    newChat, renameChat, removeChat, searchChats, forkChat,
    ensureBotThread, migrateThreads,
  };
}
