/**
 * 「模型整理」自检：只在本地跑，不碰用户数据。
 *
 *   npm run wiki:curate:selftest          # 拼 prompt / 解析 / 嵌回 三组断言
 *   ARK_API_KEY=sk-... npm run wiki:curate:selftest -- --ark   # 额外发一次真实调用
 *
 * 这里验证的是唯一会改写笔记正文的代码路径，所以断言写得比较死。
 */
import { curateMessages, parseCurated, spliceCurated, contentHash } from "../electron/wiki-curate.mjs";
import { planCurate, INDEX_TITLE } from "../plugins/notes/curate-structure.mjs";
import { claimCandidates, evaluateClaims, isClaimLine, normalizeClaim } from "../plugins/notes/claims.mjs";
import { buildMergedDraft, findCitationCandidates, findMergeCandidates } from "../plugins/notes/maintenance.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const FIXTURE = `# 灰度发布前置检查

> 旧的一句话摘要

## 要点

- 旧要点一
- 旧要点二

## 原文摘录

回滚脚本在预发环境演练一次并留记录。

## 相关

- [[发布流程]]
- [[安全基线]]
`;

console.log("模型整理自检\n");

// ── 1. 拼 prompt ─────────────────────────────────────────────
console.log("[1] 拼 prompt");
const msgs = curateMessages({
  title: "灰度发布前置检查",
  summary: "旧摘要",
  content: FIXTURE,
  citations: [{ title: "发布流程 v3", quote: "回滚脚本在预发环境演练一次并留记录。" }],
});
check("两条消息（system + user）", msgs.length === 2);
check("system 要求 JSON", msgs[0].content.includes("JSON"));
check("user 带标题与正文", msgs[1].content.includes("灰度发布前置检查") && msgs[1].content.includes("## 原文摘录"));
check("带引用资料标题", msgs[1].content.includes("发布流程 v3"));
const longPage = curateMessages({ title: "t", content: "x".repeat(20000), citations: [] });
check("正文被截断", longPage[1].content.length < 8000, `${longPage[1].content.length} 字`);

// ── 2. 解析模型输出 ──────────────────────────────────────────
console.log("\n[2] 解析模型输出");
const clean = parseCurated('{"summary":"讲的是灰度前必须完成的检查","bullets":["回滚脚本先演练","关键接口要有逆向指标","阈值写进发布单"]}');
check("纯 JSON", clean.ok && clean.bullets.length === 3, clean.summary);
const fenced = parseCurated('好的：\n```json\n{"summary":"**摘要**","bullets":["1. 要点一","- 要点二"]}\n```');
check("代码围栏 + markdown 清理", fenced.ok && fenced.summary === "摘要" && fenced.bullets.length === 2, fenced.bullets.join(" / "));
const loose = parseCurated('{"summary":"只有摘要"}');
check("只有摘要也算成功", loose.ok && loose.summary === "只有摘要");
check("非 JSON 不崩", parseCurated("抱歉，我无法整理。").ok === false);
check("空输入不崩", parseCurated("").ok === false);
check("超长摘要被截断", parseCurated(`{"summary":"${"长".repeat(300)}"}`).summary.length <= 120);
check("要点最多 6 条", parseCurated(JSON.stringify({ summary: "s", bullets: Array.from({ length: 12 }, (_, i) => `要点 ${i}`) })).bullets.length === 6);

// ── 3. 嵌回正文 ─────────────────────────────────────────────
console.log("\n[3] 嵌回正文");
const spliced = spliceCurated(FIXTURE, { summary: "新摘要", bullets: ["新要点 A", "新要点 B"] });
check("摘要被替换", spliced.includes("> 新摘要") && !spliced.includes("旧的一句话摘要"));
check("要点被替换", spliced.includes("- 新要点 A") && spliced.includes("- 新要点 B") && !spliced.includes("旧要点一"));
check("原文摘录不动", spliced.includes("回滚脚本在预发环境演练一次并留记录。"));
check("相关不动", spliced.includes("- [[发布流程]]") && spliced.includes("- [[安全基线]]"));
check("没有重复标题", (spliced.match(/^# 灰度发布前置检查$/gm) || []).length === 1);
check("结尾单换行", spliced.endsWith("\n") && !spliced.endsWith("\n\n"));

const noSummary = spliceCurated("# 标题\n\n正文一段。\n", { summary: "新摘要", bullets: ["a", "b"] });
check("无摘要时插在 H1 后", noSummary.startsWith("# 标题\n\n> 新摘要"));
check("无要点时插到原文摘录前", spliceCurated("# 标题\n\n正文。\n\n## 原文摘录\n\n原文。\n", { summary: "", bullets: ["a"] }).includes("## 要点\n\n- a"));

const idempotent = spliceCurated(spliced, { summary: "新摘要", bullets: ["新要点 A", "新要点 B"] });
check("二次整理不再变形", idempotent === spliced);

const empty = spliceCurated(FIXTURE, { summary: "", bullets: [] });
check("空结果不改正文", empty === FIXTURE);
check("正文未变时 hash 相同", contentHash(FIXTURE) === contentHash(empty));
check("正文变化时 hash 不同", contentHash(FIXTURE) !== contentHash(spliced));

// ── 4. 结构整理：谁能被直接改写 ─────────────────────────────────
console.log("\n[4] 结构整理（reviewed 不得静默改写）");

const REVIEWED = `# 复盘会议纪要

> 一次事故复盘

## 要点

- 人写的结论：不要重启数据库

## 原文摘录

口头结论，未留原文。

## 相关

- [[postmortem]]
`;
const pagesFixture = [
  { id: "pg-draft", title: "untitled 1", summary: "", status: "draft", content: "# untitled 1\n\n- 第一条要点\n- 第二条要点\n" },
  { id: "pg-reviewed", title: "复盘会议纪要", summary: "一次事故复盘", status: "reviewed", content: REVIEWED },
  { id: "pg-stale", title: "copilot-notes", summary: "", status: "stale", content: "# copilot-notes\n\n旧笔记。\n" },
  { id: "pg-index", title: INDEX_TITLE, summary: "Wiki 索引（自动维护）", status: "reviewed", content: "# Wiki 索引\n\n旧内容\n" },
];
const citationsFixture = [{ pageId: "pg-draft", sourceId: "src-1" }, { pageId: "pg-reviewed", sourceId: "src-1" }];
const sourcesFixture = [{ id: "src-1", title: "事故报告", kind: "text" }];
const planArgs = { pages: pagesFixture, citations: citationsFixture, sources: sourcesFixture, index: pagesFixture[3] };
const plan = planCurate(planArgs);
const writable = plan.changes.filter((c) => c.apply);
const reviewOnly = plan.changes.filter((c) => !c.apply);
const statusOf = (pid) => pagesFixture.find((p) => p.id === pid).status;

check("只有 draft 进可写集合", writable.length > 0 && writable.every((c) => statusOf(c.pageId) === "draft"), writable.map((c) => `${c.title}:${c.status}`).join(" / "));
check("reviewed 页面只产建议", reviewOnly.some((c) => c.pageId === "pg-reviewed") && !writable.some((c) => c.pageId === "pg-reviewed"));
check("stale 页面只产建议", reviewOnly.some((c) => c.pageId === "pg-stale") && !writable.some((c) => c.pageId === "pg-stale"));
check("索引页 reviewed 时也不同步落盘", plan.index.exists && plan.index.apply === false);
check("每个建议都带改动理由", reviewOnly.every((c) => c.reasons.length > 0), reviewOnly.map((c) => `${c.title}:${c.reasons.join("/")}`).join(" | "));
check("建议正文保留人写的要点", (reviewOnly.find((c) => c.pageId === "pg-reviewed")?.after || "").includes("不要重启数据库"));
check("改名只发生在 draft 上", plan.renames.every((r) => statusOf(r.pageId) === "draft") && plan.skippedRenames.some((r) => r.pageId === "pg-stale"));
check("计划不改入参", pagesFixture[1].content === REVIEWED && pagesFixture[0].title === "untitled 1");

// 幂等：把 draft 改完再算一次，同一页不应再产生变更
const applied = pagesFixture.map((p) => {
  const change = writable.find((c) => c.pageId === p.id);
  return change ? { ...p, content: change.after } : p;
});
const replan = planCurate({ ...planArgs, pages: applied });
check("已整理过的 draft 不再重复变更", !replan.changes.some((c) => writable.some((w) => w.pageId === c.pageId)));
check("建议内容稳定（同一输入两次算出同一份字节）", planCurate(planArgs).changes.find((c) => c.pageId === "pg-reviewed").after === reviewOnly.find((c) => c.pageId === "pg-reviewed").after);
check("共享资料的页面互相出现在「相关」", (reviewOnly.find((c) => c.pageId === "pg-reviewed")?.after || "").includes("## 相关"));

// 不丢行：除了要被重建的标题行，原页面的每一行正文都要出现在整理结果里
const lostLines = (before, after) => before.split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !/^#{1,6}\s/.test(l))
  .filter((l) => !after.includes(l));
const NEEDY = "# 复盘会议纪要\n\n> 一次事故复盘\n\n## 要点\n\n- 人写的结论：不要重启数据库\n";
const needy = planCurate({ pages: [{ id: "pg-needy", title: "复盘会议纪要", summary: "一次事故复盘", status: "reviewed", content: NEEDY }] });
check("整理不删人写的行（reviewed）", Boolean(needy.changes.length) && lostLines(NEEDY, needy.changes[0].after).length === 0, lostLines(NEEDY, needy.changes[0]?.after || "").join(" / "));
check("摘要行不会被当成原文摘录", !/## 原文摘录\n\n> 一次事故复盘/.test(needy.changes[0]?.after || ""));
const messy = "# 标题\n\n> 摘要\n\n## 要点\n\n- 要点一\n\n这段是手写解释，不是列表。\n\n## 相关\n\n- [[旧链接]]\n\n待确认：这条是否还成立\n";
const messPlan = planCurate({ pages: [{ id: "pg-messy", title: "标题", summary: "摘要", status: "reviewed", content: messy }] });
check("夹在要点/相关里的非列表文字也不丢", lostLines(messy, messPlan.changes[0]?.after || "").length === 0, lostLines(messy, messPlan.changes[0]?.after || "").join(" / "));

// ── 5. 人工结论（claim）：整理不许静默丢人写的句子 ─────────────
console.log("\n[5] 人工结论（claim）");

check("列表符号被归一化", normalizeClaim("- 回滚脚本必须先演练") === "回滚脚本必须先演练");
check("人写的一句话算结论", isClaimLine("- 回滚脚本必须先演练一次") === true);
check("标题不算结论", isClaimLine("## 要点") === false);
check("摘要行不算结论", isClaimLine("> 一次事故复盘") === false);
check("太短不算结论", isClaimLine("- 待补充") === false);
check("纯双链不算结论", isClaimLine("- [[发布流程]]") === false);

const cand = claimCandidates(
  "# 页\n\n## 要点\n\n- 旧结论：先演练再发布\n",
  "# 页\n\n## 要点\n\n- 旧结论：先演练再发布\n- 新结论：回滚脚本必须留记录\n\n## 相关\n\n- [[别的页]]\n",
);
check("只抓这次新出现的行", cand.length === 1 && cand[0] === "新结论：回滚脚本必须留记录", cand.join(" / "));

const claimsFixture = [
  { id: "c1", pageId: "p", quote: "回滚脚本必须先演练", status: "active" },
  { id: "c2", pageId: "p", quote: "灰度窗口不要跨周末", status: "active" },
  { id: "c3", pageId: "p", quote: "发布单必须写清失败回滚路径", status: "active" },
];
const survived = evaluateClaims(claimsFixture, "# 页\n\n- 回滚脚本必须先演练\n- 灰度窗口尽量避开周末\n");
check("原样保留 → ok", survived.ok.length === 1 && survived.ok[0].id === "c1");
check("被改写 → conflict", survived.conflict.length === 1 && survived.conflict[0].id === "c2");
check("彻底不见 → orphan", survived.orphan.length === 1 && survived.orphan[0].id === "c3");

// 整理一个 draft：第 10 条要点会被 8 条上限挤掉，而它恰好是人写的结论
const tenBullets = `# 十要点页\n\n> 摘要\n\n## 要点\n\n${Array.from({ length: 10 }, (_, i) => `- 第 ${i + 1} 条结论：这里写的是真实结论内容`).join("\n")}\n`;
const claimOnTen = { id: "c10", pageId: "pg-ten", quote: "第 10 条结论：这里写的是真实结论内容", status: "active" };
const tenPlan = planCurate({ pages: [{ id: "pg-ten", title: "十要点页", summary: "摘要", status: "draft", content: tenBullets }], claims: [claimOnTen] });
check("会丢人工结论的 draft 不再自动写盘", tenPlan.changes.length === 1 && tenPlan.changes[0].apply === false && tenPlan.changes[0].blockedByClaims === true);
check("理由里点名人工结论", tenPlan.changes[0].reasons.some((r) => r.includes("人工结论")));
check("没被动到的页面照常可写", planCurate({ ...planArgs, claims: [claimOnTen] }).stats.blockedByClaims === 0);
const keptClaim = { id: "c-ok", pageId: "pg-needy", quote: "人写的结论：不要重启数据库", status: "active" };
const needyPlan = planCurate({ pages: [{ id: "pg-needy", title: "复盘会议纪要", summary: "一次事故复盘", status: "reviewed", content: NEEDY }], claims: [keptClaim] });
check("结论还在 → 不额外拦截（该来的建议照旧）", needyPlan.changes[0]?.claimStatus.ok.includes("c-ok") && needyPlan.changes[0]?.blockedByClaims === false);

// ── 6. 维护扫描：漏引用 / 疑似重复（只产建议）──────────────────
console.log("\n[6] 维护扫描");

const sourceFixture = { id: "src-1", title: "事故报告", content: "# 事故报告\n\n回滚脚本在预发环境演练一次并留记录。\n其他内容无关。\n" };
const citePage = {
  id: "pg-cite", title: "发布流程复盘", summary: "一次灰度发布的事故复盘",
  content: "# 发布流程复盘\n\n> 一次灰度发布的事故复盘\n\n## 要点\n\n- 回滚脚本在预发环境演练一次并留记录\n",
};
const citeFound = findCitationCandidates({ pages: [citePage], sources: [sourceFixture], citations: [] });
check("找到漏引用", citeFound.length === 1 && citeFound[0].sourceId === "src-1" && citeFound[0].score > 0.8, `score=${citeFound[0]?.score?.toFixed(2)}`);
check("证据是资料原文", (citeFound[0]?.quote || "").includes("演练一次并留记录"));
check("已引用过的不再建议", findCitationCandidates({ pages: [citePage], sources: [sourceFixture], citations: [{ pageId: "pg-cite", sourceId: "src-1" }] }).length === 0);
check("无关资料不瞎建议", findCitationCandidates({ pages: [citePage], sources: [{ id: "src-2", title: "别的", content: "完全不相干的一句话在这里。" }], citations: [] }).length === 0);

const dupA = { id: "pg-a", title: "发布流程复盘", summary: "一次灰度发布的事故复盘，结论是先演练再发布", content: "# 发布流程复盘\n\n## 要点\n\n- 先演练再发布\n\n## 原文摘录\n\n甲原文。\n" };
const dupB = { id: "pg-b", title: "复盘：发布流程", summary: "一次灰度发布的事故复盘，结论是先演练再发布", content: "# 复盘：发布流程\n\n## 要点\n\n- 先演练再发布\n- 回滚要留记录\n" };
const merges = findMergeCandidates({ pages: [dupA, dupB] });
check("摘要高度重合 → 疑似重复", merges.length === 1, merges[0]?.why);
check("前缀相同但不同主题不算重复", findMergeCandidates({ pages: [{ title: "发布流程" }, { title: "发布流程复盘" }] }).length === 0);

const mergedDraft = buildMergedDraft({ a: dupA, b: dupB });
check("合并草稿带两页要点（去重）", mergedDraft.includes("- 回滚要留记录") && (mergedDraft.match(/^- 先演练再发布$/gm) || []).length === 1);
check("合并草稿互链两页", mergedDraft.includes("[[发布流程复盘]]") && mergedDraft.includes("[[复盘：发布流程]]"));
check("合并草稿保留摘录", mergedDraft.includes("甲原文。"));

// ── 7. 可选：真实调用 ───────────────────────────────────────
if (process.argv.includes("--ark")) {
  console.log("\n[7] 真实调用（Ark）");
  const key = String(process.env.ARK_API_KEY || "").trim();
  if (!key) {
    check("ARK_API_KEY 已设置", false, "没有 key 就跳过；用 ARK_API_KEY=... npm run wiki:curate:selftest -- --ark");
  } else {
    const { chat } = await import("../electron/knowledge/ark.mjs");
    try {
      const res = await chat(curateMessages({ title: "灰度发布前置检查", content: FIXTURE, citations: [] }), { key, maxTokens: 700, temperature: 0.2, json: true });
      const parsed = parseCurated(res?.text);
      check("模型返回可解析", parsed.ok, parsed.summary || "(空)");
      check("要点 0–6 条", parsed.bullets.length >= 0 && parsed.bullets.length <= 6, `${parsed.bullets.length} 条：${parsed.bullets.slice(0, 3).join(" / ")}`);
      const out = spliceCurated(FIXTURE, parsed);
      check("嵌回后原文摘录仍在", out.includes("回滚脚本在预发环境演练一次并留记录。"));
      console.log(`  usage: ${JSON.stringify(res?.usage || {})}`);
    } catch (err) {
      check("真实调用成功", false, String(err?.message || err));
    }
  }
}

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
