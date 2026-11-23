/**
 * 记忆的「行」模型（P0-5，借 ORCA 的 `bot-memory-lines.ts`，但**不**把文件变成事实源）。
 *
 * ORCA：`MEMORY.md` 一行一条事实，行尾由 Orca（不是模型）写 ` · from: <来源>`；
 * 装载只取前 200 行，并明说「还有 N 行没载入」。
 *
 * 我们：`harness.db` 仍是唯一事实源，`MEMORY.md` 只是只读镜像。
 * 行模型带来的两件事：
 *  - 面板看到的和模型看到的同一份行（行数一致、来源一致）；
 *  - 超过预算时不再静默裁掉：system 里明说「未载入 N 行 / 预算已用 X%」。
 *
 * 纯函数，不碰 sqlite / fs；memory/index.mjs 生成镜像、bot/index.mjs 注入时都用这一份。
 */

/** 装载上限：一次注入最多读多少行（不是字符预算，字符预算仍由 memory.inject 管） */
export const BOT_MEMORY_LINE_CAP = 200;
/** 行尾来源分隔符：解析与生成共用，改一处就够 */
export const MEMORY_SOURCE_SEPARATOR = " · from: ";
export const MEMORY_SOURCE_LABELS = { bot: "bot", human: "人", shared: "共享" };

/** 本地日期 YYYY-MM-DD（不用 toISOString：那是 UTC，晚上会串到第二天） */
export function dayOf(at) {
  const n = Number(at) || 0;
  if (!n) return "";
  const d = new Date(n);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 这条记忆是谁写的：
 *  - `owner` 为空 = 共享层；
 *  - `owner = bot:<id>` = 这个 bot 自己写的；
 *  - 其它 owner（人 / 别的来源）= 人。
 */
export function memorySourceLabel(owner = "") {
  const o = String(owner || "");
  if (!o) return MEMORY_SOURCE_LABELS.shared;
  if (o.startsWith("bot:")) return MEMORY_SOURCE_LABELS.bot;
  return MEMORY_SOURCE_LABELS.human;
}

/** 一行事实：`- 2026-11-23 事实正文 · from: bot` */
export function formatMemoryLine({ text, at = 0, from = "" } = {}) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const day = dayOf(at);
  const src = String(from || "").trim();
  return `- ${day ? `${day} ` : ""}${body}${src ? `${MEMORY_SOURCE_SEPARATOR}${src}` : ""}`;
}

/** 把镜像 / 注入里的一行拆开：{ bullet, date, text, from } */
export function parseMemoryLine(line) {
  const raw = String(line ?? "").trim();
  const bullet = /^[-*]\s+/.test(raw);
  const body = bullet ? raw.replace(/^[-*]\s+/, "") : raw;
  const cut = body.lastIndexOf(MEMORY_SOURCE_SEPARATOR);
  const from = cut >= 0 ? body.slice(cut + MEMORY_SOURCE_SEPARATOR.length).trim() : "";
  const rest = cut >= 0 ? body.slice(0, cut).trim() : body;
  const m = rest.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
  return { bullet, date: m ? m[1] : "", text: m ? m[2] : rest, from };
}

/**
 * 装载截断：只取前 `cap` 行，并把「未载入多少行」算出来。
 * 空行不算事实行，也不占额度（否则镜像里的分区空行会白吃预算）。
 */
export function capMemoryLines(lines = [], cap = BOT_MEMORY_LINE_CAP) {
  const all = (Array.isArray(lines) ? lines : String(lines ?? "").split("\n"))
    .map((l) => String(l ?? ""))
    .filter((l) => l.trim());
  const limit = Math.max(1, Number(cap) || BOT_MEMORY_LINE_CAP);
  const kept = all.slice(0, limit);
  return { lines: kept, total: all.length, loaded: kept.length, dropped: Math.max(0, all.length - kept.length), cap: limit };
}

/** 来源分布 + 行数：面板与注入说明共用 */
export function memoryLineStats(lines = []) {
  const facts = (Array.isArray(lines) ? lines : String(lines ?? "").split("\n")).filter((l) => String(l).trim() && /^[-*]\s+/.test(String(l).trim()));
  const sources = { bot: 0, human: 0, shared: 0 };
  for (const line of facts) {
    const { from } = parseMemoryLine(line);
    if (from === MEMORY_SOURCE_LABELS.bot) sources.bot += 1;
    else if (from === MEMORY_SOURCE_LABELS.human) sources.human += 1;
    else sources.shared += 1;
  }
  return { lines: facts.length, sources };
}
