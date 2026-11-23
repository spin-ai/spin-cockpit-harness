/**
 * 通知决策：主动 bot 的"打扰"要有量化规则，否则它会变成骚扰源。
 *
 * 口径抄 Rakazo 的三条量化规则（它写在 run-notifications.ts 里）：
 *  - **最长 180 字符**（通知不是正文，正文在回合流里）；
 *  - **一次最多 5 个收件人**（我们只有一个人，所以这条变成"每小时最多几条"）；
 *  - **发送前查静音与未读**：已有一堆未读时不再叠加，后台类不打扰。
 *
 * 这里是纯函数：把"要不要弹"和"弹什么"分开，UI 只负责弹。
 */

export const NOTIFY_MAX_CHARS = 180;
export const NOTIFY_MAX_PER_HOUR = 3;
export const NOTIFY_UNREAD_SUPPRESS = 5;

/** 每个 bot 自己的通知开关；缺省全开（旧 bot 没有这个字段也按全开算） */
export const DEFAULT_NOTIFY = { proactive: true, needPermission: true, taskDone: true, failed: true };

/** 这个类别要不要通知：只读 policy，不碰节流（节流仍在 notifyDecision） */
export function notifyAllowed(policy, kind = "") {
  const n = { ...DEFAULT_NOTIFY, ...(policy?.notify || {}) };
  if (kind === "quiet") return false;
  if (kind === "asked" || kind === "escalated") return n.needPermission !== false;
  if (kind === "answered") return n.proactive !== false;
  if (kind === "reported" || kind === "run.finished") return n.taskDone !== false;
  if (kind === "run.failed" || kind === "blocked" || kind === "interrupted" || kind === "failed") return n.failed !== false;
  return true;
}

/**
 * @param {object} input
 * @param {string} input.reply       这一轮要说的话
 * @param {string} [input.kind]      turn 的 trigger.kind（routine / todo.* / run.* / intro）
 * @param {number} input.now
 * @param {number[]} [input.sentAt]  最近已发通知的时间戳（任意顺序）
 * @param {number} [input.mutedUntil]
 * @param {number} [input.unread]    bot 页当前的未读数
 * @param {object} [input.policy]    bot.policy（quietHours 复用）
 * @param {boolean} [input.quiet]    调用方已判定的静音时段（有就优先用它）
 */
export function notifyDecision({ reply = "", kind = "", now = Date.now(), sentAt = [], mutedUntil = 0, unread = 0, quiet = false, maxPerHour = NOTIFY_MAX_PER_HOUR } = {}) {
  if (!reply) return { send: false, text: "", reason: "没有内容" };
  // 静默回合（decision=quiet）：正文照旧落库可审计，但不弹、不进未读
  if (kind === "quiet") return { send: false, text: "", reason: "这一轮静默（NO_REPLY）" };
  if (mutedUntil && mutedUntil > now) return { send: false, text: "", reason: "手动静音中" };
  if (quiet) return { send: false, text: "", reason: "静音时段（不弹通知）" };

  const hourAgo = now - 3600_000;
  const recent = sentAt.filter((t) => t > hourAgo).length;
  if (recent >= maxPerHour) return { send: false, text: "", reason: `本小时已弹 ${recent}/${maxPerHour} 条通知` };

  // 未读太多：只有"需要你决定"的类别还能弹，其余只记在回合流里
  const needsYou = kind === "todo.waiting_input" || kind === "routine.failed";
  if (unread >= NOTIFY_UNREAD_SUPPRESS && !needsYou) {
    return { send: false, text: "", reason: `已有 ${unread} 条未读，先不叠加` };
  }

  const text = clip(reply, NOTIFY_MAX_CHARS);
  return { send: true, text, reason: text === String(reply) ? "" : `已截断到 ${NOTIFY_MAX_CHARS} 字符` };
}

function clip(text, max) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
