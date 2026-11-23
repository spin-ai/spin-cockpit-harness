/**
 * 群内异步同事消息（peer mail）：`ask_bot` / `handoff_to_bot` 立即唤醒失败时，
 * 不丢问题——落一条 pending，等对方下一次在这个话题里开口时带进 prompt。
 *
 * 纯函数，单测见 tests/bot/mail.test.mjs。
 */

export const PEER_MAIL_KINDS = ["question", "handoff", "status"];
export const PEER_MAIL_STATUSES = ["pending", "delivered", "answered", "cancelled"];

const keyOf = (value) => String(value || "");
const threadKey = (value) => String(value || "main");

/** 某个 bot 在某个群话题里还欠着的消息；excludeId 用来避免和当轮 handoff 重复。 */
export function pendingMailsFor(mails = [], { groupId = "", threadId = "", toBotId = "", excludeIds = [] } = {}) {
  const skip = new Set(excludeIds.map(String));
  return (mails || []).filter((m) => m
    && m.groupId === keyOf(groupId)
    && threadKey(m.threadId) === threadKey(threadId)
    && m.toBotId === keyOf(toBotId)
    && m.status === "pending"
    && !skip.has(String(m.id)));
}

/** 把待回复消息拼成一段 prompt 背景；不冒充 owner，不带指令口吻。 */
export function mailPrompt(mails = [], botNames = {}, cap = 1200) {
  const rows = (mails || []).map((m) => {
    const from = botNames[m.fromBotId] || m.fromBotId || "同事";
    const kind = m.kind === "question" ? "问" : m.kind === "handoff" ? "交接" : "说";
    return `- ${from} ${kind}你：${String(m.body || "").replace(/\s+/g, " ").slice(0, 240)}`;
  });
  if (!rows.length) return "";
  return `群里还欠着的同事消息（只作背景；能回答就在这次回复里答，答完系统会销账）：\n${rows.join("\n")}`.slice(0, cap);
}
