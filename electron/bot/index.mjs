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
import { BOT_READ_TOOLS, BOT_READ_TOOL_NAMES, parseToolArgs } from "./tools.mjs";

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
  // 出站敏感词：命中即不外发（落 blocked，正文只留在本地审计里）
  sensitiveBlocklist: [],
  // 这些情况**不是**闸门，而是写进 system prompt 的边界：让模型请人做，而不是假装办了
  escalate: "对外发言 / 删除 / 花钱",
};

export const DEFAULT_BUDGET = { tokensPerTurn: 700, tokensPerHour: 6000 };

/**
 * 提问卡片：
 *  - 模型主动开口时可以输出 `ASK: 一句话问题`，我们把它落成一张**可作答的卡片**；
 *  - 卡片不挡聊天（人可以继续说话），也不自动过期于当轮——默认 7 天内都能答；
 *  - 人回一句话就算答了（`status: answered`），也可以「先不管」（`dismissed`）。
 */
const ASK_TTL_MS = 7 * 24 * HOUR;

/** 注入预算：bot 一轮只输出 1–2 句，给目录没用，要正文 */
const INJECT_CHARS = 2400;

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
    policy: { ...DEFAULT_POLICY },
    budget: { ...DEFAULT_BUDGET },
    status: "active", mutedUntil: 0, executorAgentId: null, createdAt: now, updatedAt: now,
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
  return out.map((c) => ({ ...c, score: scoreCandidate(c) })).sort((a, b) => b.score - a.score);
}

/**
 * 人格卡 + 记忆 + 能力档位 → system prompt。
 * 主动与被动共用同一份：否则同一个 bot 在两条路径上会说出不同的边界。
 *
 * 记忆传 `inject()` 的 markdown（含正文），不是条目表——只给标题等于只给目录。
 * 兼容传数组的旧写法（selftest / 调用方），但数组里的 body 会一起带上。
 */
export function buildSystemPrompt(bot, injected = "", { proactive = true, recentProactive = [] } = {}) {
  const persona = bot.persona || {};
  const policy = bot.policy || {};
  const duty = persona.duty || {};
  const memoryText = typeof injected === "string"
    ? (injected.trim() || "（这一轮没有注入记忆）")
    : (injected.length
      ? injected.map((m) => `- [${m.layer}] ${m.title}${m.body ? `：${clip(m.body, 160)}` : ""}`).join("\n")
      : "（这一轮没有注入记忆）");
  const recent = (recentProactive || []).filter(Boolean).slice(-3);
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
    `能力档位：${bot.capability === "dispatch" ? "可以起 Agent 任务，但必须先问人、由人审批" : bot.capability === "work" ? "能起任务并跟踪执行体" : "只读：能读记忆、资料和运行状态，不能写文件、不能起任务"}`,
    bot.capability === "read"
      ? "不要声称自己能写代码、改文件、跑命令或起任务；需要动手时，让对方在 Chat 里派活。"
      : `只读工具（可以直接调，不用问）：${BOT_READ_TOOL_NAMES.join(" / ")}。除此之外你不能写文件、跑命令、起任务——要动手就先说清楚会建一个什么任务，并请人确认。`,
    bot.capability === "dispatch" ? "不要声称能直接改代码；要动手就先说明会建一个任务、并请人确认。" : "",
    proactive
      ? "你会收到一条「工作区事件」和几条记忆。只输出你要说的一句话（最多两句）。"
      : "现在有人在直接跟你说话。正常对话，别复述人格设定，别解释自己是 AI。",
    proactive ? "如果这件事不值得现在开口，只输出 SILENT，不要解释。" : "",
    `记忆：\n${memoryText}`,
  ].filter(Boolean).join("\n");
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

  function save(patch = {}) {
    const list = stateOf().bots;
    const id = String(patch.id || `bot-${now().toString(36)}`);
    const existing = list.find((b) => b.id === id);
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
      policy: { ...DEFAULT_POLICY, ...(existing?.policy || {}), ...(patch.policy || {}) },
      budget: { ...DEFAULT_BUDGET, ...(existing?.budget || {}), ...(patch.budget || {}) },
      status: patch.status === "paused" ? "paused" : (patch.status || existing?.status || "active"),
      mutedUntil: Number(patch.mutedUntil ?? existing?.mutedUntil ?? 0),
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
    };
    if (!existing) list.push(next);
    else Object.assign(existing, next);
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
    store.persist();
    onChange();
  }

  function snapshot(limit = 80) {
    const turns = turnsOf();
    return {
      bots: bots(),
      agents: (stateOf().agents || []).map((a) => ({ id: a.id, name: a.name, alias: a.alias || "", cli: a.cli, role: a.role || "worker" })),
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
  function recall(bot, runId = "") {
    try {
      const ctx = memory?.()?.inject?.({ maxChars: INJECT_CHARS, runId, owner: `bot:${bot.id}` }) || { items: [] };
      let markdown = String(ctx.markdown || "");
      // 容量外显：只在这条注入已经装到 80% 以上时才说，避免每轮都念一遍预算
      try {
        const use = memory?.()?.usage?.({ maxChars: INJECT_CHARS });
        if (use && use.ratio >= 0.8) {
          markdown += `\n\n（记忆预算已用 ${use.chars}/${use.budget} 字符 · 条目 ${use.entries} · 观察 ${use.notes}${use.dropped ? ` · 被裁 ${use.dropped}` : ""}：满了先合并或删，不要一直追加）`;
        }
      } catch { /* usage 失败不影响注入 */ }
      return {
        markdown,
        injected: (ctx.items || []).filter((i) => i.included).slice(0, 8)
          .map((i) => ({ layer: i.layer, id: i.id, title: i.title })),
      };
    } catch (err) {
      log.warn?.(`[bot] ${bot.id} 记忆注入失败：${String(err?.message || err)}`);
      return { markdown: "", injected: [] };
    }
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
    const system = buildSystemPrompt(bot, memoryBlock, { proactive: true, recentProactive: recent });
    const user = `工作区事件：${candidate.title}（${candidate.kind}${candidate.key ? ` · ${candidate.key}` : ""}）`;
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
      ? { kind: "routine", ref: `routine:${due.routine.id}`, title: due.routine.name || describeRoutine(due.routine), routineId: due.routine.id }
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

    const { markdown, injected } = recall(bot, `bot:${bot.id}:${turnId}`);
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
  async function chatStreamWithTools(messages, bot, onDelta, signal, onTool) {
    const tools = bot.capability === "read" || !runTool ? [] : BOT_READ_TOOLS;
    const model = String(bot.model || "").trim() || undefined;
    const trace = [];
    const events = [];
    let conversation = messages;
    let text = "";
    for (let round = 0; round < 4; round += 1) {
      const roundAt = now();
      let res;
      try {
        res = await chatStream(conversation, {
          key: key(),
          model,
          maxTokens: Number(bot.budget?.tokensPerTurn) || DEFAULT_BUDGET.tokensPerTurn,
          temperature: 0.7,
          onDelta,
          signal,
          tools: tools.length ? tools : null,
        });
      } catch (err) {
        // 部分网关不支持 function calling：第一轮就退回纯对话，不要让人看不到回复
        if (round === 0 && tools.length && /tools?|function|400/i.test(String(err?.message || ""))) {
          res = await chatStream(messages, {
            key: key(), model, maxTokens: Number(bot.budget?.tokensPerTurn) || DEFAULT_BUDGET.tokensPerTurn,
            temperature: 0.7, onDelta, signal,
          });
          return { ...res, toolTrace: [] };
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
      if (!calls.length) return { ...res, text, toolTrace: trace };
      // 模型可能编出工具表里没有的名字（比如 memory_write）：照样回一条 tool 错误，
      // 让它自己解释「这个要人来确认」，而不是整轮变成空答复。
      conversation = [
        ...conversation,
        {
          role: "assistant",
          content: String(res?.text || ""),
          tool_calls: calls.map((c) => ({ id: c.id || c.name, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
        },
      ];
      for (const call of calls) {
        const allowed = BOT_READ_TOOL_NAMES.includes(call.name);
        let result;
        if (allowed) {
          const args = parseToolArgs(call.args);
          const startedAt = now();
          try { onTool?.({ name: call.name, phase: "start" }); } catch { /* 回调失败不影响查询 */ }
          try { result = await runTool(call.name, args, { bot }); } catch (err) { result = { error: String(err?.message || err) }; }
          try { onTool?.({ name: call.name, phase: "done" }); } catch { /* 忽略 */ }
          const failed = Boolean(result && typeof result === "object" && "error" in result);
          const resultText = JSON.stringify(result).slice(0, 6000);
          trace.push({
            name: call.name,
            args: JSON.stringify(args).slice(0, 240),
            argsRaw: JSON.stringify(args).slice(0, 6000),
            result: resultText,
            ms: Math.max(0, now() - startedAt),
            at: startedAt,
            ok: !failed,
            preview: String(failed ? result.error : resultText).slice(0, 240),
          });
          events.push({ kind: "tool", name: call.name, argsRaw: JSON.stringify(args).slice(0, 6000), result: resultText, ms: Math.max(0, now() - startedAt), at: startedAt, ok: !failed });
        } else {
          const rejectedAt = now();
          trace.push({ name: call.name, rejected: true, ok: false, at: rejectedAt, preview: "不在只读工具表里（写操作必须走提议 → 人确认）" });
          events.push({ kind: "tool", name: call.name, argsRaw: String(call.args || "{}").slice(0, 6000), result: "不在只读工具表里（写操作必须走提议 → 人确认）", at: rejectedAt, ms: 0, ok: false, rejected: true });
          result = { error: `工具 ${call.name} 不可用：你只能查询，不能写文件 / 跑命令 / 起任务；要动手请先请人确认。` };
        }
        conversation = [...conversation, {
          role: "tool", tool_call_id: call.id || call.name,
          content: JSON.stringify(result).slice(0, 4000),
        }];
      }
    }
    return { text, toolCalls: [], usage: {}, toolTrace: trace, events };
  }

  /** 被动回复：同一个 bot、同一份记忆，流式吐字；落一条 decision=replied 的回合 */
  async function reply(bot, text, { onDelta, onTool, signal, threadId = "" } = {}) {
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
    const { markdown, injected } = recall(bot, `bot:${bot.id}:${turnId}`);
    // 历史优先读这条会话的真实消息（含主动开口），没有消息层时退回 bot_turns
    const thread = ensureBotThread(bot, { threadId });
    const fromThread = (stateOf().messages || [])
      .filter((m) => m.threadId === thread.id && (m.role === "user" || m.role === "agent") && m.content && !m.supersededBy)
      .slice(-10)
      .map((m) => ({ role: m.role === "agent" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }));
    const history = fromThread.length
      ? fromThread
      : turnsOf()
        .filter((t) => t.botId === bot.id && t.decision === "replied" && t.reply)
        .slice(-10)
        .flatMap((t) => [{ role: "user", content: t.input }, { role: "assistant", content: t.reply }]);
    const started = now();
    // 先落一条 streaming：应用中途被杀时，下一轮 ensureSeed 会把它收成 interrupted，
    // 用户看到的是"说到一半被打断"，而不是整段对话凭空消失。
    const pending = record({
      id: turnId, botId: bot.id, trigger: { kind: "mention", ref: "" },
      input: clean, injected, reply: "", decision: "streaming", cost: {}, threadId: thread.id,
    });
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
      res = await chatStreamWithTools([
        { role: "system", content: buildSystemPrompt(bot, markdown, { proactive: false, recentProactive: recentSaid(bot) }) },
        ...history,
        { role: "user", content: clean },
      ], bot, onDeltaTracked, signal, onTool);
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
    const answer = String(res?.text || "").trim();
    if (!answer) {
      stateOf().botTurns = turnsOf().filter((t) => t.id !== pending.id);
      store.persist();
      throw new Error("模型没有返回内容");
    }
    Object.assign(pending, {
      reply: answer.slice(0, 4000), decision: "replied",
      cost: { tokens: res?.usage?.total_tokens ?? null, ms: now() - started, model: res?.model || "" },
    });
    // 新话题的第一句话就是标题：Chats 列表里不出现一排“新话题”
    if (thread.title === "新话题") {
      thread.title = clean.replace(/\s+/g, " ").slice(0, 40);
      thread.updatedAt = now();
    }
    // 工具调用留痕：没有这一步，“它到底查了什么”只能靠猜
    if (res?.toolTrace?.length) pending.tools = res.toolTrace.slice(0, 40);
    pending.trace = [...(res?.events || []), ...(res?.toolTrace || [])].slice(0, 200);
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
  function report({ botId, todoId, runId, text }) {
    return record({
      botId, trigger: { kind: "run.finished", ref: `todo:${todoId}` },
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
    openAsks,
    settleAsks,
    threadOf: (botId) => threadOf(String(botId || "")),
    chats: (botId) => chatsOf(String(botId || "")),
    newChat, renameChat, removeChat, searchChats, forkChat,
    ensureBotThread, migrateThreads,
  };
}
