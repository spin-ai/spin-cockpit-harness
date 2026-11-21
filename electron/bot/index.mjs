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

/** 首次启动时的内置 bot（可改名/删除，和 Notes 一样是 first-party 默认值） */
export function seedBots() {
  const now = Date.now();
  return [{
    id: "bot-golo", name: "戈洛", avatar: "戈", avatarClass: "a",
    persona: { ...DEFAULT_PERSONA },
    capability: "read", channels: ["local"], intro: true,
    policy: { ...DEFAULT_POLICY },
    budget: { ...DEFAULT_BUDGET },
    status: "active", mutedUntil: 0, createdAt: now, updatedAt: now,
  }];
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
  const memoryText = typeof injected === "string"
    ? (injected.trim() || "（这一轮没有注入记忆）")
    : (injected.length
      ? injected.map((m) => `- [${m.layer}] ${m.title}${m.body ? `：${clip(m.body, 160)}` : ""}`).join("\n")
      : "（这一轮没有注入记忆）");
  const recent = (recentProactive || []).filter(Boolean).slice(-3);
  return [
    `你在扮演「${bot.name}」。用第一人称，不要解释自己是 AI。`,
    persona.mission ? `你的职责（用户亲口说的）：${persona.mission}` : "",
    `语气：${persona.tone || DEFAULT_PERSONA.tone}`,
    `称呼：${persona.address || DEFAULT_PERSONA.address}`,
    `长短：${persona.length || DEFAULT_PERSONA.length}`,
    `边界：${persona.boundary || DEFAULT_PERSONA.boundary}`,
    `习惯：${persona.habit || DEFAULT_PERSONA.habit}`,
    policy.escalate ? `必须请人来做（不要声称已经办了）：${policy.escalate}` : "",
    recent.length ? `你最近主动说过（别自相矛盾、也别重复）：\n${recent.map((t) => `- ${clip(t, 120)}`).join("\n")}` : "",
    `能力档位：${bot.capability === "dispatch" ? "可以起 Agent 任务，但必须先问人、由人审批" : "只读：能读记忆、资料和运行状态，不能写文件、不能起任务"}`,
    bot.capability === "dispatch"
      ? "不要声称能直接改代码；要动手就先说明会建一个任务、并请人确认。"
      : "不要声称自己能写代码、改文件、跑命令或起任务；需要动手时，让对方在 Chat 里派活。",
    proactive
      ? "你会收到一条「工作区事件」和几条记忆。只输出你要说的一句话（最多两句）。"
      : "现在有人在直接跟你说话。正常对话，别复述人格设定，别解释自己是 AI。",
    proactive ? "如果这件事不值得现在开口，只输出 SILENT，不要解释。" : "",
    `记忆：\n${memoryText}`,
  ].filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ 运行时 */

export function createBots({ store, memory, chat, chatStream, key, probeWatch, onChange = () => {}, now = () => Date.now(), log = console } = {}) {
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

  /** 一个 bot 一条 thread（todo_id 为空、kind=bot）；持续 chat 的落点 */
  function threadOf(botId) {
    return threadsOf().find((t) => t.kind === "bot" && t.botId === botId) || null;
  }

  function ensureBotThread(bot) {
    const existing = threadOf(bot.id);
    if (existing) return existing;
    const thread = {
      id: `th-bot-${bot.id}`, todoId: null, title: bot.name || "bot",
      projectId: null, project: "", agentId: null,
      model: "", modelName: "", effort: "",
      kind: "bot", botId: bot.id,
      createdAt: now(), updatedAt: now(),
    };
    threadsOf().push(thread);
    store.persist();
    return thread;
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
    const thread = ensureBotThread(bot);
    if (row.decision === "replied" && row.input) store.addMessage(thread.id, null, "user", "text", row.input);
    if (row.reply) store.addMessage(thread.id, null, "agent", "text", row.reply);
    row.mirrored = true;
    row.threadId = thread.id;
  }

  function record(turn) {
    // 落库前脱敏：用户可能把 key 直接粘进输入框，回合账是本地的但也不该存明文
    const row = {
      id: nextTurnId(),
      channel: "local", input: "", runId: null, cost: {}, ...turn, createdAt: now(),
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
      capability: patch.capability === "dispatch" ? "dispatch" : "read",
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
      turns: turns.slice(-limit),
      routines: listRoutines(),
      routineStatus: routineStatus(),
      asks: openAsks(),
      botThreads: bots().reduce((acc, b) => {
        const t = threadOf(b.id);
        if (t) acc[b.id] = t.id;
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
      bot.intro = false;
      bot.updatedAt = now();
      store.persist();
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
      const last = [...turns].reverse().find((t) => t.botId === bot.id);
      if (last && now() - last.createdAt < 5 * MINUTE) return null; // 静音期不刷屏记账
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
      const last = [...turns].reverse().find((t) => t.botId === bot.id);
      if (last && now() - last.createdAt < 10 * MINUTE) return null;
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

  /** 被动回复：同一个 bot、同一份记忆，流式吐字；落一条 decision=replied 的回合 */
  async function reply(bot, text, { onDelta, signal } = {}) {
    const clean = String(text || "").trim().slice(0, 2000);
    if (!clean) throw new Error("说点什么");
    if (typeof chatStream !== "function") throw new Error("当前环境不支持流式回复");
    if (!key?.()) throw new Error("缺少模型 key：设置 → 执行里配置 ARK_API_KEY");
    const turnId = nextTurnId();
    // 人回话了：把这个 bot 挂着的提问卡片结掉（卡片不挡聊天，所以允许一句话答多张）
    try { settleAsks(bot.id, { answer: clean, status: "answered" }); } catch { /* 卡片结不掉不影响回话 */ }
    // 创建后它先问了"你想让我干什么"：用户的第一句话就是职责（不覆盖已有职责）
    if (!bot.persona?.mission) {
      bot.persona = { ...(bot.persona || {}), mission: redactSecrets(clean).text.slice(0, 200) };
      bot.intro = false;
      bot.updatedAt = now();
      store.persist();
      onChange();
    }
    const { markdown, injected } = recall(bot, `bot:${bot.id}:${turnId}`);
    // 历史优先读这条 thread 的真实消息（含主动开口），没有消息层时退回 bot_turns
    const thread = ensureBotThread(bot);
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
      input: clean, injected, reply: "", decision: "streaming", cost: {},
    });
    let acc = "";
    let lastFlush = 0;
    const onDeltaTracked = (delta) => {
      acc += String(delta || "");
      onDelta?.(delta);
      // 每 800ms 才落一次盘：流式增量每秒几十个，逐条写会把这个库写热
      if (now() - lastFlush > 800) { pending.reply = acc.slice(0, 4000); store.persist(); lastFlush = now(); }
    };
    let res;
    try {
      res = await chatStream([
        { role: "system", content: buildSystemPrompt(bot, markdown, { proactive: false, recentProactive: recentSaid(bot) }) },
        ...history,
        { role: "user", content: clean },
      ], {
        key: key(),
        maxTokens: Number(bot.budget?.tokensPerTurn) || DEFAULT_BUDGET.tokensPerTurn,
        temperature: 0.7,
        onDelta: onDeltaTracked,
        signal,
      });
    } catch (err) {
      // 取消 / 报错：这条回合不该留在账上（半截流式内容只在真崩溃时才有意义）
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
      cost: { tokens: res?.usage?.total_tokens ?? null, ms: now() - started },
    });
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
    listRoutines, saveRoutine, removeRoutine, routineStatus,
    openAsks,
    settleAsks,
    threadOf: (botId) => threadOf(String(botId || "")),
    ensureBotThread, migrateThreads,
  };
}
