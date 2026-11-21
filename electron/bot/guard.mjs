/**
 * 事件级防循环 / 防重复：Rakazo 的 loop guard 管的是「模型连续调用同一个工具」，
 * 我们的 bot 不执行工具（工具在 dsh 侧），所以这里管的是另一件事：
 * **同一个事件被反复当成"值得开口"的理由**，以及**说了跟上次几乎一样的话**。
 *
 * 三条规则（任一命中就压住，落 blocked 并写清原因）：
 *   1. 同一 `trigger.ref` 在窗口内已经开过口 ≥ maxSameRef 次 → 这条事件已经说过太多次；
 *   2. 最近一条主动回复与候选标题「高度相似」且间隔 < dedupeMs → 近重复；
 *   3. 最近一条主动回复与**准备要说的话**高度相似 → 同一件事换个说法再说一遍。
 *
 * 相似度用归一化（去空白 / 标点 / 大小写）后的大 bigram 重合率，纯函数、可测。
 */

const HOUR = 60 * 60 * 1000;

/** 归一化：去空白与标点、转小写。只要"说了什么"，不关心格式。 */
export function normText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。！？；：、“”‘’（）《》【】…—·,.!?;:'"()\[\]<>_\-~`|/\\]+/g, "");
}

/** 归一化后的二元组集合：中文按字、英文按字符，够用且不依赖分词 */
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 相似度 0–1：Jaccard（交集 / 并集）。
 * 阈值取 0.8 而不是 0.6——「我理解的是 A，要现在开吗」和「A 还没确认」其实不是重复。
 */
export function similarity(a, b) {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * @param {object} input
 * @param {Array} input.turns    该 bot 的历史回合（新的在后）
 * @param {string} input.botId
 * @param {object} input.candidate { kind, ref, title }
 * @param {number} input.now
 * @param {string} [input.reply] 已经生成、准备发出的文本（生成后可以再查一次）
 * @param {object} [opts]
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function suppressionReason({ turns = [], botId = "", candidate = {}, now = Date.now(), reply = "" } = {}, opts = {}) {
  const windowMs = Number(opts.windowMs) || 6 * HOUR;
  const maxSameRef = Number(opts.maxSameRef) || 2;
  const dedupeMs = Number(opts.dedupeMs) || 30 * 60 * 1000;
  const similarAt = Number(opts.similarity) || 0.8;

  const mine = turns.filter((t) => (!botId || t.botId === botId));
  const ref = candidate?.ref || "";

  // 规则 1：同一事件说过太多次
  if (ref) {
    const said = mine.filter((t) => t.decision === "answered" && t.trigger?.ref === ref && now - t.createdAt < windowMs);
    if (said.length >= maxSameRef) {
      return { blocked: true, reason: `同一事件已开过口 ${said.length} 次（窗口 ${Math.round(windowMs / HOUR)}h），先不再提` };
    }
  }

  const lastAnswered = [...mine].reverse().find((t) => t.decision === "answered" && t.reply);

  // 规则 2：候选标题与刚说过的话近重复
  if (lastAnswered && candidate?.title && now - lastAnswered.createdAt < dedupeMs) {
    const sim = similarity(lastAnswered.reply, candidate.title);
    if (sim >= similarAt) {
      return { blocked: true, reason: `与上一条主动开口近重复（相似度 ${sim.toFixed(2)}）` };
    }
  }

  // 规则 3：准备说的话与上一条几乎一样（生成后复查，防止换说法重说）
  if (lastAnswered && reply && now - lastAnswered.createdAt < dedupeMs) {
    const sim = similarity(lastAnswered.reply, reply);
    if (sim >= similarAt) {
      return { blocked: true, reason: `与上一条主动开口几乎相同（相似度 ${sim.toFixed(2)}），不重说` };
    }
  }

  return { blocked: false };
}
