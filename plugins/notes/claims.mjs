/**
 * 「人工结论」（claim）的纯函数部分：抓取、比对、判定。
 *
 * 目的只有一个：**人改过的一句话，不能在下一次整理/重编译里静默消失**。
 * 做法不依赖模型：人保存页面时把新增的行记成 claim；整理前后逐条比对，
 * 找不到就拦下自动写入，让改动变成待审建议（人看 diff 决定）。
 *
 * 判定只有三档：
 *   ok        —— 内容还在（原样或包含关系）
 *   conflict  —— 还在同一话题附近，但被改写了（bigram 重叠高）
 *   orphan    —— 完全不见了（可能被挪到别的页面 / 被别的整理吃掉）
 * 是否允许自动写由调用方决定：本项目里 conflict 与 orphan 都拦。
 */

/** 去掉列表符号 / 多余空白，用来做稳定的比对键 */
export function normalizeClaim(text) {
  return String(text || "")
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 值得当作「人写下的结论」的行：够长、不是标题/摘要/纯链接/占位符 */
export function isClaimLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return false;
  if (/^#{1,6}\s/.test(raw) || /^>/.test(raw) || /^\|/.test(raw)) return false;
  const text = normalizeClaim(raw);
  if (text.length < 8 || text.length > 300) return false;
  if (/^\[\[[^\]]+\]\]$/.test(text)) return false;
  if (/^(待补充|待整理|（暂无摘录）)$/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  // 中文基本可以按字判定；英文至少要像个句子
  return /[\u4e00-\u9fa5]/.test(text) || text.split(/\s+/).length >= 4;
}

/** 这一次人改出来的新行（和旧内容对比），用作 claim 候选 */
export function claimCandidates(prevContent, nextContent, limit = 12) {
  const before = new Set(String(prevContent || "").split("\n").map(normalizeClaim).filter(Boolean));
  const out = [];
  for (const line of String(nextContent || "").split("\n")) {
    if (!isClaimLine(line)) continue;
    const key = normalizeClaim(line);
    if (before.has(key)) continue;
    if (!out.includes(key)) out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

export function bigrams(text) {
  const t = String(text || "").replace(/\s+/g, "");
  const out = new Set();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
}

/** 0–1：两句话共享的 bigram 占较短那句的比例 */
export function overlap(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return hit / Math.min(A.size, B.size);
}

/** 0–1：两句话的 bigram Jaccard（两边词量接近才值得比，避免「A」被「A 复盘」吃掉） */
export function jaccard(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return hit / (A.size + B.size - hit);
}

const CONFLICT_FLOOR = 0.5;

/**
 * 逐条判定 claim 在给定正文里还在不在。
 * 只看行级文本，不看语义 —— 误判的代价是「多问人一次」，不是「悄悄丢掉」。
 */
export function evaluateClaims(claims, content) {
  const lines = String(content || "").split("\n").map(normalizeClaim).filter(Boolean);
  const ok = [];
  const conflict = [];
  const orphan = [];
  for (const claim of claims || []) {
    if (!claim || claim.status === "removed") continue;
    const quote = normalizeClaim(claim.quote);
    if (!quote) continue;
    const kept = lines.some((line) => line.includes(quote) || (quote.includes(line) && line.length >= 8));
    if (kept) { ok.push(claim); continue; }
    const best = lines.reduce((max, line) => Math.max(max, overlap(quote, line)), 0);
    if (best >= CONFLICT_FLOOR) conflict.push(claim);
    else orphan.push(claim);
  }
  return { ok, conflict, orphan };
}

/** 一条 claim 该不该拦下自动写入：不见了（改写或丢失）都拦 */
export function claimsBlockWrite(result) {
  return (result?.conflict?.length || 0) + (result?.orphan?.length || 0) > 0;
}
