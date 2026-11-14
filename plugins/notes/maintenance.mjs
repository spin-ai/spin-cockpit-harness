/**
 * 知识库维护扫描（纯函数）：找「漏引用」和「疑似重复页面」。
 *
 * 只产建议，不写盘；而且判定全部是确定性的（bigram 重叠 / 标题 Jaccard），
 * 不调模型 —— 这样同一份库扫两遍结果一致，能写断言，也不会突然改口。
 *
 * 两类建议的「接受」语义不同（见 plugins/notes/main.mjs）：
 *   citation —— 加一条引用（页面正文不动，仍记 revision）
 *   merge    —— 生成一份**合并草稿**（原页面一个字都不动，删不删由人决定）
 */
import { bigrams, isClaimLine, jaccard, normalizeClaim, overlap } from "./claims.mjs";

const MAX_SOURCE_LINES = 400;
const MAX_PAGE_LINES = 200;
const INDEX_BUCKET_CAP = 4000;

/** 漏引用：页面里某一行和某份资料的某一行几乎一样，但页面没引用它 */
export function findCitationCandidates({ pages = [], sources = [], citations = [], maxPerPage = 2, max = 20, floor = 0.62 } = {}) {
  const cited = new Set(citations.map((c) => `${c.pageId}:${c.sourceId}`));
  const index = new Map(); // bigram -> sourceId[]
  const sourceLines = new Map(); // sourceId -> [{ line, grams }]
  for (const source of sources) {
    const lines = String(source.content || "")
      .split("\n")
      .map(normalizeClaim)
      .filter((line) => isClaimLine(line))
      .slice(0, MAX_SOURCE_LINES);
    if (!lines.length) continue;
    sourceLines.set(source.id, lines.map((line) => ({ line, grams: bigrams(line) })));
    for (const line of lines) {
      for (const g of bigrams(line)) {
        const bucket = index.get(g);
        if (!bucket) { index.set(g, [source.id]); continue; }
        if (!bucket.includes(source.id) && bucket.length < INDEX_BUCKET_CAP) bucket.push(source.id);
      }
    }
  }

  const found = new Map(); // `${pageId}:${sourceId}` -> candidate
  for (const page of pages) {
    const lines = String(page.content || "")
      .split("\n")
      .map(normalizeClaim)
      .filter((line) => isClaimLine(line))
      .slice(0, MAX_PAGE_LINES);
    for (const line of lines) {
      const grams = bigrams(line);
      const shared = new Map(); // sourceId -> 共享 bigram 数
      for (const g of grams) {
        for (const sourceId of index.get(g) || []) shared.set(sourceId, (shared.get(sourceId) || 0) + 1);
      }
      const near = [...shared.entries()]
        .filter(([, n]) => n >= Math.min(3, Math.max(2, Math.floor(grams.size * 0.25))))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      for (const [sourceId] of near) {
        const key = `${page.id}:${sourceId}`;
        if (cited.has(key)) continue;
        let best = null;
        for (const row of sourceLines.get(sourceId) || []) {
          const score = overlap(line, row.line);
          if (score >= floor && (!best || score > best.score)) best = { score, quote: row.line };
        }
        if (!best) continue;
        const previous = found.get(key);
        if (!previous || best.score > previous.score) {
          found.set(key, {
            pageId: page.id, sourceId, score: best.score, quote: best.quote, claim: line,
            pageTitle: page.title, sourceTitle: sources.find((src) => src.id === sourceId)?.title || sourceId,
          });
        }
      }
    }
  }

  const perPage = new Map();
  const out = [];
  for (const candidate of [...found.values()].sort((a, b) => b.score - a.score)) {
    const used = perPage.get(candidate.pageId) || 0;
    if (used >= maxPerPage) continue;
    perPage.set(candidate.pageId, used + 1);
    out.push(candidate);
    if (out.length >= max) break;
  }
  return out;
}

/** 疑似重复：标题几乎一样（Jaccard 高且长度接近），或摘要高度重合 */
export function findMergeCandidates({ pages = [], indexTitle = "Wiki 索引", max = 10 } = {}) {
  const real = pages.filter((p) => p.title !== indexTitle);
  const out = [];
  for (let i = 0; i < real.length; i += 1) {
    for (let j = i + 1; j < real.length; j += 1) {
      const a = real[i];
      const b = real[j];
      const ta = normalizeClaim(a.title);
      const tb = normalizeClaim(b.title);
      const ratio = Math.min(ta.length, tb.length) / Math.max(1, Math.max(ta.length, tb.length));
      const titleScore = ta && tb ? jaccard(ta, tb) : 0;
      const summaryScore = a.summary && b.summary ? jaccard(normalizeClaim(a.summary), normalizeClaim(b.summary)) : 0;
      // 标题要「几乎一样」才算重复：光共享前缀（发布流程 / 发布流程复盘）不算
      const titleDup = titleScore >= 0.7 && ratio >= 0.8;
      const summaryDup = summaryScore >= 0.75;
      if (!titleDup && !summaryDup) continue;
      out.push({
        aId: a.id, bId: b.id,
        aTitle: a.title, bTitle: b.title,
        score: Math.max(titleScore, summaryScore),
        why: titleDup ? "标题几乎一样" : "摘要高度重合",
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

/** 合并草稿：两页的要点取并集、摘录拼起来、相关互链；原页面不动 */
export function buildMergedDraft({ a, b }) {
  const listOf = (content, section) => {
    const block = String(content || "").match(new RegExp("^##\\s*" + section + "\\s*$[\\s\\S]*?(?=^##\\s+|(?![\\s\\S]))", "m"))?.[0] || "";
    return block.split("\n").map((line) => line.trim()).filter((line) => /^[-*]\s+/.test(line)).map((line) => normalizeClaim(line)).filter(Boolean);
  };
  const bullets = [...new Set([...listOf(a.content, "要点"), ...listOf(b.content, "要点")])].slice(0, 12);
  const excerpt = (page) => {
    const block = String(page.content || "").match(/^##\s*原文摘录\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/m)?.[1]?.trim() || "";
    return block && block !== "（暂无摘录）" ? `### ${page.title}\n\n${block}` : "";
  };
  const excerpts = [excerpt(a), excerpt(b)].filter(Boolean);
  const summary = (a.summary || b.summary || "").slice(0, 160);
  return [
    `# ${a.title}（合并稿）`,
    "",
    summary ? `> ${summary}` : "",
    "",
    "## 要点",
    "",
    ...(bullets.length ? bullets.map((line) => `- ${line}`) : ["- 待补充"]),
    "",
    "## 原文摘录",
    "",
    excerpts.length ? excerpts.join("\n\n") : "（两页都没有摘录，合并后可自己补）",
    "",
    "## 相关",
    "",
    `- [[${a.title}]]`,
    `- [[${b.title}]]`,
    "",
  ].filter((line) => line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
