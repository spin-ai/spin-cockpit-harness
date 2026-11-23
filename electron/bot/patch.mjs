/**
 * 作用域增量通知（P0-4，借 ORCA 的 `bot-change-scope` / `bot-change-notices`，但不抄多端字段）。
 *
 * 问题：`broadcast()` 每次都推整份 `snapshot()`。Bot 页回合变多后，每来一行字就全量
 * 重渲染，长会话直接卡（REQ-bot-chat SR-Chat-12 标 ✗）。
 *
 * 做法：
 *  - 主进程把一次写拆成 `{ botId, kinds, ...切片 }`，500ms 合并后推 `harness:bot-patch`；
 *  - 切片只有四样：`botTurns` 尾部 / `botGroupMessages` 尾部 / `botChats` 摘要 / `botChanged`；
 *  - 读者按 `botId` 只替换对应切片；全量 `harness:state` 保留作首帧与兜底。
 *
 * 不抄：`kindBots` / `receivedGroupIds` / `namesItems`（多端与配对电脑的兼容字段）、
 * `itemUids` 协商——我们单机单进程，一个 botId + kinds 就够。
 *
 * 纯函数：`buildBotPatch` / `mergeBotPatch` / `applyBotPatch` 都能在 node 里直接测。
 */

/** 一包里最多带多少：增量不是历史同步，读者手里已经有前面那些 */
export const BOT_PATCH_TURNS = 12;
export const BOT_PATCH_GROUP_MESSAGES = 20;
export const BOT_PATCH_CHATS = 20;
export const BOT_PATCH_MERGE_MS = 500;
export const BOT_TURNS_KEEP = 300;
export const BOT_KINDS = ["turns", "groups", "chats", "items", "bot"];

/** 一回合的线上形态：够渲染（说没说话 / 说了什么 / 为什么），不带整份 trace */
export function trimTurn(turn) {
  if (!turn) return null;
  return {
    id: turn.id,
    botId: turn.botId,
    channel: turn.channel || "local",
    trigger: turn.trigger || {},
    input: String(turn.input || "").slice(0, 400),
    reply: String(turn.reply || "").slice(0, 2000),
    decision: turn.decision || "silent",
    reason: String(turn.reason || "").slice(0, 300),
    threadId: turn.threadId || null,
    todoId: turn.todoId || null,
    ask: turn.ask || null,
    proposal: turn.proposal || null,
    routineProposal: turn.routineProposal || null,
    cost: turn.cost || {},
    stopReason: turn.stopReason || "",
    createdAt: turn.createdAt || 0,
    // 轨迹只留在本地全量里：patch 带 trace 等于把最大的一块又发一遍
    tools: Array.isArray(turn.tools) ? turn.tools.slice(-4).map((t) => ({
      name: t?.name, ok: t?.ok, ms: t?.ms, preview: String(t?.preview || "").slice(0, 160),
    })) : [],
  };
}

/**
 * 打一包增量。`kinds` 决定带哪些切片；没点的字段一律不出现（读者用旧值）。
 * `botChanged` 一定带：读者据此知道自己要不要重读某个 bot。
 */
export function buildBotPatch({ botId, kinds = [], turns, groupMessages, chats, counts, at = Date.now() } = {}) {
  const id = String(botId || "");
  if (!id) return null;
  const clean = [...new Set(kinds.map((k) => String(k || "").trim()).filter(Boolean))];
  const patch = { botId: id, kinds: clean, at };
  if (Array.isArray(turns)) patch.botTurns = turns.slice(-BOT_PATCH_TURNS).map(trimTurn).filter(Boolean);
  if (Array.isArray(groupMessages)) patch.botGroupMessages = groupMessages.slice(-BOT_PATCH_GROUP_MESSAGES);
  if (Array.isArray(chats)) patch.botChats = chats.slice(0, BOT_PATCH_CHATS);
  if (counts && typeof counts === "object") patch.itemCounts = counts;
  patch.botChanged = { botId: id, kinds: clean, at };
  return patch;
}

/** 500ms 窗口里同一个 bot 的两次写合并成一包（kinds 取并集，切片取新的） */
export function mergeBotPatch(prev, next) {
  if (!prev) return next || null;
  if (!next) return prev;
  const merged = { ...prev, ...next };
  merged.botId = next.botId || prev.botId;
  merged.kinds = [...new Set([...(prev.kinds || []), ...(next.kinds || [])])];
  merged.at = Math.max(prev.at || 0, next.at || 0);
  merged.botTurns = mergeById(prev.botTurns, next.botTurns).slice(-BOT_PATCH_TURNS);
  merged.botGroupMessages = mergeById(prev.botGroupMessages, next.botGroupMessages).slice(-BOT_PATCH_GROUP_MESSAGES);
  if (next.botChats) merged.botChats = next.botChats;
  if (next.itemCounts) merged.itemCounts = next.itemCounts;
  merged.botChanged = { botId: merged.botId, kinds: merged.kinds, at: merged.at };
  return merged;
}

function mergeById(a = [], b = []) {
  if (!Array.isArray(b)) return a || [];
  const out = new Map((a || []).map((x) => [x?.id, x]));
  for (const row of b) if (row?.id) out.set(row.id, row);
  return [...out.values()];
}

/**
 * 渲染层应用一包增量：只替换对应切片，别的字段原样。
 * 全量 `harness:state` 到了还是整份覆盖——这条路径永远是兜底。
 */
export function applyBotPatch(state, patch) {
  if (!state || !patch?.botId) return state;
  const next = { ...state };
  if (Array.isArray(patch.botTurns)) {
    const byId = new Map((state.botTurns || []).map((t) => [t.id, t]));
    for (const t of patch.botTurns) byId.set(t.id, t);
    next.botTurns = [...byId.values()]
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .slice(-BOT_TURNS_KEEP);
  }
  if (Array.isArray(patch.botGroupMessages)) {
    const byId = new Map((state.botGroupMessages || []).map((m) => [m.id, m]));
    for (const m of patch.botGroupMessages) byId.set(m.id, m);
    next.botGroupMessages = [...byId.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }
  if (patch.botChats) next.botChats = { ...(state.botChats || {}), [patch.botId]: patch.botChats };
  if (patch.itemCounts) next.itemCounts = { ...(state.itemCounts || {}), [patch.botId]: patch.itemCounts };
  next.botChanged = patch.botChanged || { botId: patch.botId, kinds: patch.kinds || [], at: patch.at || 0 };
  return next;
}
