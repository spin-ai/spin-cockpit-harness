/**
 * 「整理结构」的纯函数部分：只算「应该长什么样」，不写盘、不碰 revision。
 *
 * 为什么单独拿出来：
 *   1) 这里是确定性整理唯一会改写正文的地方，必须能不启动 Electron 就跑断言；
 *   2) 硬规则——**reviewed / stale 页面不允许被整理静默改写**。计划里用 `apply`
 *      明确标出「可以直接写」还是「只能变成待审建议」，由调用方据此分流。
 *
 *   node scripts/wiki-curate-selftest.mjs     # 见 [4] 结构整理
 */

import { evaluateClaims, claimsBlockWrite } from "./claims.mjs";

export const INDEX_TITLE = "Wiki 索引";
/** 我们维护的三个小节；其余小节（用户自己写的）一律不动 */
export const SECTIONS = ["要点", "原文摘录", "相关"];
/** 只有 draft 允许被整理直接改写；reviewed / stale 只能产建议 */
export const AUTO_STATUS = "draft";

const weakTitle = (t) => /^[a-z0-9._\-]+$/i.test(t) || /^untitled/i.test(t);
/** 摘要里截出来的一行要像「话」：含中文，或至少 3 个词且不含 CSV/公式符号 */
const looksLikeProse = (t) => /[\u4e00-\u9fa5]/.test(t) || (t.split(/\s+/).length >= 3 && !/[,=]/.test(t));

function deriveTitle(page) {
  const body = String(page.content || "");
  const h1 = (body.match(/^#\s+(.+)$/m) || [])[1]?.trim();
  if (h1 && h1.length >= 2 && h1.length <= 60 && !/^untitled/i.test(h1) && h1 !== page.title) return h1;
  if (/^[a-z0-9._\-]+$/i.test(page.title)) {
    return page.title.replace(/[._\-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() || page.title;
  }
  const firstLine = String(page.summary || "").replace(/[#>*`]/g, "").split(/[。.!?\n]/)[0].trim();
  if (firstLine.length >= 6 && firstLine.length <= 60 && looksLikeProse(firstLine) && weakTitle(page.title)) return firstLine;
  return page.title;
}

/** 页面之间的关系：共享同一份 source 就互相加双链 */
function relatedGraph(ids, citations) {
  const sourcesOf = new Map();
  for (const c of citations) {
    if (!sourcesOf.has(c.pageId)) sourcesOf.set(c.pageId, new Set());
    sourcesOf.get(c.pageId).add(c.sourceId);
  }
  const related = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return;
    if (!related.has(a)) related.set(a, new Set());
    related.get(a).add(b);
  };
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = sourcesOf.get(ids[i]) || new Set();
      const b = sourcesOf.get(ids[j]) || new Set();
      for (const x of a) if (b.has(x)) { link(ids[i], ids[j]); link(ids[j], ids[i]); break; }
    }
  }
  return related;
}

/** 把一段正文重建成固定大纲 */
function renderPage({ title, summary, body, related, indexTitle }) {
  // 按 ## 分块解析我们自己维护的结构（比全文正则稳，避免反复整理时摘录被吃掉）
  const noH1 = body.replace(/^#\s+.*$/m, "");
  const chunks = noH1.split(/^##\s+/m);
  const preamble = String(chunks.shift() || "").trim();
  const blockOf = (name) => String(chunks.find((c) => c.trim().startsWith(name)) || "").replace(/^[^\n]*\n?/, "").trim();
  const ours = new Set(SECTIONS);
  const freeChunks = chunks.filter((c) => !ours.has(c.trim().split(/\s/)[0]));
  const prevExcerpt = blockOf("原文摘录");
  // 摘要行（H1 后面那条 `>`）不是「原文」，重复把它当摘录会很傻；先剥掉再取自由正文
  const preambleBody = String(preamble).replace(/^(?:>[^\n]*\n*)+/, "").trim();
  const freeText = [preambleBody, ...freeChunks.map((c) => c.trim())].filter(Boolean).join("\n\n").trim();
  // 正文被我们完全结构化过时，沿用上一次的摘录，避免每轮都变
  const excerptSource = freeText || prevExcerpt;
  // 摘要要点：优先取自由正文（或上次摘录）里的列表；不足时把**已有的「要点」条目原样保留**。
  // 纯结构整理不许删人写的结论 —— 静默丢掉一条要点，比少加十条严重。
  const listItems = (text) => (String(text || "").match(/^\s*[-*]\s+.+$/gm) || [])
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l && !/^\[\[[^\]]+\]\]$/.test(l) && l !== "待整理" && l !== "待补充");
  const bullets = [...new Set([...listItems(freeText || prevExcerpt), ...listItems(blockOf("要点"))])].slice(0, 8);
  // 「要点」里夹着的普通段落（不是列表项）也原样放回去 —— 整理只做重排，不做删除。
  const kouRest = blockOf("要点").split("\n").filter((l) => l.trim() && !/^\s*[-*]\s+/.test(l)).join("\n").trim();
  // 原文摘录：把摘录里自带的标题降级成加粗，避免和页面结构打架
  // 摘录：已有摘录优先保留（可能是人挑的引文），新出现的自由段落追加在后，去重。
  const paras = (text) => String(text || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const prevParas = paras(prevExcerpt);
  const merged = [...prevParas, ...paras(excerptSource).filter((p) => !prevParas.includes(p))];
  const excerpt = merged
    .slice(0, 6)
    .join("\n\n")
    .slice(0, 2000)
    .replace(/^#{1,6}\s+(.+)$/gm, "**$1**");
  // 相关：算出来的互链在前，**已有的手写链接原样保留**（含指向未来页面的前向链接）。
  // 纯结构整理不删人写的链接，否则「相关」一栏每轮整理都会洗掉用户自己连的东西。
  const prevRelated = [...String(blockOf("相关")).matchAll(/^-\s*\[\[([^\]|]+)/gm)].map((m) => m[1].trim()).filter(Boolean);
  // 「相关」里除了双链之外的文字同样保留（有人会把「待确认」写在这里）
  const relRest = String(blockOf("相关")).split("\n").filter((l) => l.trim() && !/^-\s*\[\[/.test(l.trim())).join("\n").trim();
  const relTitles = [...new Set([...(related || []).map((r) => r.title), ...prevRelated])].slice(0, 8);
  const text = [
    `# ${title}`,
    "",
    summary ? `> ${summary}` : "",
    "",
    "## 要点",
    "",
    ...(bullets.length ? bullets.map((b) => `- ${b}`) : ["- 待补充"]),
    ...(kouRest ? ["", kouRest] : []),
    "",
    "## 原文摘录",
    "",
    excerpt || "（暂无摘录）",
    "",
    "## 相关",
    "",
    ...(relTitles.length ? relTitles.map((t) => `- [[${t}]]`) : [`- [[${indexTitle}]]`]),
    ...(relRest ? ["", relRest] : []),
    "",
  ].filter((x) => x !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { text, relTitles };
}

/** 这次整理到底改了什么 —— 建议卡上给人看的证据 */
function diffReasons({ pageTitle, title, body, original, summary, linkRewrites, relTitles }) {
  const reasons = [];
  if (title !== pageTitle) reasons.push(`标题「${pageTitle}」→「${title}」`);
  const seen = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const missing = SECTIONS.filter((s) => !seen.includes(s));
  if (missing.length) reasons.push(`补齐 ${missing.join(" / ")}`);
  const present = seen.filter((s) => SECTIONS.includes(s));
  if (present.join(">") !== SECTIONS.filter((s) => present.includes(s)).join(">")) reasons.push("重排小节顺序");
  if (summary && !/^>\s*\S/m.test(original)) reasons.push("补摘要行");
  if (linkRewrites) reasons.push(`更新双链 ${linkRewrites} 处`);
  const oldRel = [...String((body.match(/^##\s+相关\s*$[\s\S]*?(?=^##\s+|$)/m) || [""])[0]).matchAll(/^-\s*\[\[([^\]|]+)/gm)].map((m) => m[1].trim());
  if (oldRel.join("|") !== relTitles.join("|")) reasons.push(`更新相关链接（${relTitles.length} 条）`);
  return reasons;
}

/**
 * 算出一次整理的全部结果（纯函数，不改入参）。
 *
 * @returns {{
 *   indexTitle: string,
 *   index: { exists: boolean, title: string, before: string, after: string, apply: boolean, reasons: string[] } | null,
 *   changes: Array<{ pageId, title, status, before, after, apply, reasons }>,
 *   renames: Array<{ pageId, from, to }>,
 *   skippedRenames: Array<{ pageId, title, to, reason }>,
 *   stats: { pages: number, sources: number, writable: number, reviewOnly: number }
 * }}
 */
export function planCurate({ pages = [], citations = [], sources = [], claims = [], index = null, indexTitle = INDEX_TITLE, autoStatus = AUTO_STATUS } = {}) {
  const realPages = pages.filter((p) => p.title !== indexTitle);
  const ids = realPages.map((p) => p.id);
  const related = relatedGraph(ids, citations);

  // 1) 标题：只给 draft 改名；reviewed / stale 改名也要人点头，这一轮直接跳过
  const renames = [];
  const skippedRenames = [];
  const titleOf = new Map(realPages.map((p) => [p.id, p.title]));
  const taken = new Set([indexTitle, ...realPages.map((p) => p.title)]);
  for (const page of realPages) {
    const next = deriveTitle(page);
    if (!next || next === page.title) continue;
    if (page.status !== autoStatus) { skippedRenames.push({ pageId: page.id, title: page.title, to: next, reason: `status:${page.status}` }); continue; }
    let candidate = next;
    let n = 2;
    while ([...taken].some((t) => t !== page.title && t.toLowerCase() === candidate.toLowerCase())) candidate = `${next} ${n++}`;
    taken.delete(page.title);
    taken.add(candidate);
    titleOf.set(page.id, candidate);
    renames.push({ pageId: page.id, from: page.title, to: candidate });
  }
  const renameMap = new Map(renames.map((r) => [r.from, r.to]));

  // 2) 旧标题的双链改指向新标题（只改真正改过名的）
  const bodies = new Map(realPages.map((p) => [p.id, String(p.content || "")]));
  const linkRewrites = new Map();
  if (renameMap.size) {
    for (const [pid, body] of bodies) {
      let content = body;
      let hits = 0;
      for (const [oldTitle, newTitle] of renameMap) {
        for (const pattern of [`[[${oldTitle}]]`, `[[${oldTitle}|`]) {
          hits += content.split(pattern).length - 1;
          content = content.split(pattern).join(pattern.replace(oldTitle, newTitle));
        }
      }
      bodies.set(pid, content);
      linkRewrites.set(pid, hits);
    }
  }

  // 3) 逐页出计划
  const claimsOf = new Map();
  for (const claim of claims) {
    if (!claim || claim.status === "removed") continue;
    if (!claimsOf.has(claim.pageId)) claimsOf.set(claim.pageId, []);
    claimsOf.get(claim.pageId).push(claim);
  }
  const changes = [];
  for (const page of realPages) {
    const title = titleOf.get(page.id);
    const body = bodies.get(page.id);
    const original = String(page.content || "");
    const summary = String(page.summary || "").trim();
    const rel = [...(related.get(page.id) || [])].map((rid) => realPages.find((p) => p.id === rid)).filter(Boolean)
      .map((p) => ({ title: titleOf.get(p.id) || p.title }));
    const { text: after, relTitles } = renderPage({ title, summary, body, related: rel, indexTitle });
    if (after === body) continue;
    // 人工结论校验：不见了（改写或丢失）就拦下自动写入，让改动变成待审建议
    const claimResult = evaluateClaims(claimsOf.get(page.id) || [], after);
    const blockedClaims = [...claimResult.conflict, ...claimResult.orphan];
    const reasons = diffReasons({ pageTitle: page.title, title, body, original, summary, linkRewrites: linkRewrites.get(page.id) || 0, relTitles });
    if (blockedClaims.length) reasons.push(`会动到 ${blockedClaims.length} 条人工结论`);
    changes.push({
      pageId: page.id,
      title: page.title,
      status: page.status,
      before: original,
      after,
      // 分流判据：只有 draft + 没有人工结论被动到，才允许直接写盘
      apply: page.status === autoStatus && !claimsBlockWrite(claimResult),
      blockedByClaims: claimsBlockWrite(claimResult),
      claimStatus: {
        ok: claimResult.ok.map((c) => c.id),
        conflict: claimResult.conflict.map((c) => c.id),
        orphan: claimResult.orphan.map((c) => c.id),
      },
      blockedClaims: blockedClaims.map((c) => ({ id: c.id, quote: c.quote })),
      reasons,
    });
  }

  // 4) 索引页：同样受「reviewed 不静默改写」约束
  const groups = [
    ["已审核", realPages.filter((p) => p.status === "reviewed")],
    ["草稿", realPages.filter((p) => p.status === "draft")],
    ["已过期", realPages.filter((p) => p.status === "stale")],
  ];
  const indexBody = [
    `# ${indexTitle}`,
    "",
    `> 自动生成：${realPages.length} 个页面 · ${sources.length} 份资料。改页面内容不会被覆盖（只重写本索引）。`,
    "",
    ...groups.flatMap(([label, list]) => (list.length
      ? [`## ${label}（${list.length}）`, "", ...list.map((p) => `- [[${titleOf.get(p.id) || p.title}]]${p.summary ? ` — ${p.summary}` : ""}`), ""]
      : [])),
    "## 资料",
    "",
    ...(sources.length ? sources.slice(0, 50).map((s) => `- ${s.title}${s.kind ? `（${s.kind}）` : ""}`) : ["- 还没有资料"]),
    "",
  ].join("\n");
  const indexPlan = index
    ? {
      exists: true, title: indexTitle, before: String(index.content || ""), after: indexBody,
      apply: index.status === autoStatus,
      reasons: String(index.content || "") === indexBody ? [] : ["按状态重排队列 + 刷新资料清单"],
    }
    : { exists: false, title: indexTitle, before: "", after: indexBody, apply: true, reasons: ["新建索引页"] };

  return {
    indexTitle,
    index: indexPlan,
    changes,
    renames,
    skippedRenames,
    stats: {
      pages: realPages.length,
      sources: sources.length,
      writable: changes.filter((c) => c.apply).length + (indexPlan.apply && indexPlan.reasons.length ? 1 : 0),
      reviewOnly: changes.filter((c) => !c.apply).length + (indexPlan.apply ? 0 : 1),
      blockedByClaims: changes.filter((c) => c.blockedByClaims).length,
    },
  };
}
