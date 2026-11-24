/**
 * 1:1 里 `@` 到别的机器人：给当前 agent 的一段「地址上下文」。
 *
 * 为什么需要它：`@` 在群聊里表示「谁回」，但在 1:1 里没有第二个位置——一条会话只属于一个 bot。
 * ORCA 的做法是：`@` 选中的人变成一个**地址**交给当前 agent，由它自己决定要不要
 * `ask_bot` 问一句、或 `handoff_to_bot` 把活交出去（见 third-part/orca @ 59f3122bc，
 * `src/shared/bots/bot-mention-context.ts:214-279` 的 `<orca_context>`）。
 *
 * 这里只做纯函数：把「用户点了谁」翻成一段提示。真正发不发、发什么，交给模型。
 */

const MAX_MENTIONS = 4;

/** 用户点名的目标（只保留真实存在、且不是自己的） */
export function resolveMentions(mentions = [], bots = [], { selfId = "" } = {}) {
  const byId = new Map((bots || []).map((b) => [String(b.id), b]));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(mentions) ? mentions : []) {
    const id = String((raw && raw.id) || "");
    if (!id || id === String(selfId) || seen.has(id)) continue;
    const bot = byId.get(id);
    if (!bot) continue;
    seen.add(id);
    out.push({ id, name: String(bot.name || raw.name || id) });
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/**
 * 1:1 的 @ 上下文。没有可用的目标时返回空串（调用方据此不加 system 段）。
 * 措辞上刻意写成「地址 + 怎么用」，而不是「请转述给他们」：冒充别人说话是明确的禁止项。
 */
export function peerMentionNote(mentions = [], bots = [], { selfId = "" } = {}) {
  const targets = resolveMentions(mentions, bots, { selfId });
  if (!targets.length) return "";
  const lines = targets.map((x) => `- ${x.name}（${x.id}）：需要它的信息就 ask_bot 问它一句；要把活交给它就 handoff_to_bot。不要冒充它说话。`);
  return [
    "用户在刚才那句话里 @ 了下面这些机器人。这是**地址**，不是让你替它们回答：",
    ...lines,
    "这一轮仍然由你自己回；需要它们时再调工具。",
  ].join("\n");
}

/** 交接目标：只按 id 认（名字可能重名/改过）；自己、已停用的都不算 */
export function resolveHandoffTarget(handoff, bots = [], { selfId = "" } = {}) {
  const to = String((handoff && (handoff.to || handoff.toId)) || "");
  if (!to) return null;
  const bot = (bots || []).find((b) => String(b.id) === to);
  if (!bot || String(bot.id) === String(selfId)) return null;
  return bot;
}

/** 被问 / 被交接的那一轮，喂给目标的输入（和群聊里的框法一致，不伪装成 owner 的原话） */
export function handoffPrompt(handoff, fromName) {
  const kind = handoff?.kind === "handoff" ? "handoff" : "question";
  const task = String(handoff?.task || "").trim().slice(0, 600);
  const reason = String(handoff?.reason || "").trim().slice(0, 200);
  const head = kind === "question"
    ? `[${fromName} 问你]：${task}${reason ? `；原因：${reason}` : ""}\necho 一句回答就够，不要重复整段对话。`
    : `[${fromName} 把这件事交给你]：${task}${reason ? `；原因：${reason}` : ""}`;
  return head;
}
