/**
 * 插件级自检：用假 ctx 直接驱动 notes 插件的 wiki.* 接口，验证审核门真的关着。
 *
 *   npm run wiki:plugin:selftest
 *
 * 这里不看 UI，只断言三件不能破的事：
 *   1) 整理不碰 reviewed 页面（字节不变），改动只进 suggestions；
 *   2) 建议必须带 baseHash / evidence，页面改过后 accept 只能标 needs_rebase，不许覆盖；
 *   3) accept 写入的就是 payload 原样字节，并且留下一条 revision。
 *
 * 数据写在临时目录，不碰用户 userData。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { activate } from "../plugins/notes/main.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const sha = (text) => crypto.createHash("sha256").update(String(text || "")).digest("hex");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-plugin-selftest-"));
const api = new Map();
const commands = new Map();
const ctx = {
  manifest: { id: "ai.cockpit.notes", name: "notes", version: "0.0.0" },
  dataDir,
  log: { info: () => {}, warn: () => {}, error: () => {} },
  api: { handle: (method, handler) => { api.set(String(method), handler); return () => api.delete(String(method)); } },
  commands: { register: (id, handler) => { commands.set(String(id), handler); return () => commands.delete(String(id)); } },
  events: { on: () => () => {} },
  storage: { get: async () => null, set: async () => true, delete: async () => true },
  settings: { get: async () => null, set: async () => true },
  fs: { pickDirectory: async () => null, reveal: async () => true, writeProjectFile: async () => true },
  todos: { create: async (input) => ({ id: "todo-test", ...input }) },
  links: { attach: async () => true },
  ui: { openView: async () => true },
};
const call = (method, args = {}) => {
  const handler = api.get(String(method));
  if (!handler) throw new Error(`unknown plugin method: ${method}`);
  return handler(args);
};

console.log("知识库插件自检（审核门）\n");
await activate(ctx);

// ── 准备：一个 reviewed 页面 + 一个 draft 页面 ────────────────
console.log("[1] 整理不碰 reviewed");
const human = "# 复盘会议纪要\n\n> 一次事故复盘\n\n## 要点\n\n- 人写的结论：不要重启数据库\n";
const created = await call("wiki.createPage", { title: "复盘会议纪要" });
await call("wiki.savePage", { id: created.id, content: human, summary: "一次事故复盘" });
await call("wiki.review", { id: created.id, decision: "accept" });
const draft = await call("wiki.createPage", { title: "untitled-draft" });
await call("wiki.savePage", { id: draft.id, content: "# untitled-draft\n\n- 草稿要点\n" });

const before = (await call("wiki.getPage", { id: created.id })).content;

// Agent 通道（wiki_upsert_draft）不许把 reviewed 顺手降级成 draft
let agentBlocked = false;
try { await call("wiki.upsertDraft", { title: "复盘会议纪要", content: "# 覆盖\n" }); } catch { agentBlocked = true; }
check("Agent 不能覆盖 reviewed", agentBlocked && (await call("wiki.getPage", { id: created.id })).content === before && (await call("wiki.getPage", { id: created.id })).status === "reviewed");
const res = await call("wiki.curate", {});
const after = (await call("wiki.getPage", { id: created.id })).content;
check("curate 报告了建议数", Number(res.suggested) >= 1, `updated=${res.updated} suggested=${res.suggested}`);
check("reviewed 页面字节完全没变", after === before);
check("draft 被直接改写", (await call("wiki.getPage", { id: draft.id })).content.includes("## 原文摘录"));

const pending = await call("wiki.suggestions", { status: "pending" });
const sug = pending.find((s) => s.targetId === created.id);
check("建议进了队列", Boolean(sug) && sug.kind === "structure", sug ? sug.reasons.join(" · ") : "(无)");
check("建议带理由", Boolean(sug?.reasons?.length));
check("建议带 size / confidence", sug?.size?.lines > 0 && sug?.confidence === "high");

// 同一轮再整理一次：建议不重复堆（sig 去重 / superseded）
await call("wiki.curate", {});
const pendingAgain = await call("wiki.suggestions", { status: "pending" });
check("同一建议不重复入队", pendingAgain.filter((s) => s.targetId === created.id).length === 1, `${pendingAgain.length} 条 pending`);

// ── 2. 页面被改过 → 只能 needs_rebase ───────────────────────────
console.log("\n[2] 页面改过之后不许自动合并");
const full = await call("wiki.suggestion", { id: sug.id });
check("单条建议带 payload", String(full.payload || "").includes("## 要点"));
await call("wiki.savePage", { id: created.id, content: `${before}\n手写补充一行。\n`, summary: "一次事故复盘" });
await call("wiki.review", { id: created.id, decision: "accept" });
const stale = await call("wiki.suggestionResolve", { id: sug.id, decision: "accept" });
check("accept 被降级为 needs_rebase", stale.status === "needs_rebase", stale.status);
check("需要 rebase 时不写盘", (await call("wiki.getPage", { id: created.id })).content.includes("手写补充一行。"));

// ── 3. 重新整理 → 新建议 → 接受写的是原样字节 ─────────────────
console.log("\n[3] 提议即产物");
await call("wiki.curate", {});
const fresh = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.targetId === created.id);
check("重新整理后有一条新建议", Boolean(fresh) && fresh.id !== sug.id);
const payload = (await call("wiki.suggestion", { id: fresh.id })).payload;
const accepted = await call("wiki.suggestionResolve", { id: fresh.id, decision: "accept" });
const page = await call("wiki.getPage", { id: created.id });
check("接受后状态为 accepted", accepted.status === "accepted");
check("写入字节 === payload 字节", page.content === payload);
check("人工补充的行还在", page.content.includes("手写补充一行。"));
check("页面仍是 reviewed", page.status === "reviewed");
const revFile = path.join(dataDir, "revisions", `${created.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.ndjson`);
const revs = fs.readFileSync(revFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const last = revs[revs.length - 1];
check("留了一条 revision 可回滚", last?.reason === `suggest:${fresh.id}` && sha(last.content) === sha(payload), last?.reason);
check("接受后不再出现在 pending", !(await call("wiki.suggestions", { status: "pending" })).some((s) => s.id === fresh.id));

// ── 4. 拒绝留痕 ───────────────────────────────────────────────
console.log("\n[4] 退回");
const second = await call("wiki.createPage", { title: "第二个已审核页面" });
const secondBody = "# 第二个已审核页面\n\n> 摘要\n\n## 要点\n\n- 人写要点\n";
await call("wiki.savePage", { id: second.id, content: secondBody, summary: "摘要" });
await call("wiki.review", { id: second.id, decision: "accept" });
await call("wiki.curate", {});
const third = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.targetId === second.id);
const rejected = await call("wiki.suggestionResolve", { id: third.id, decision: "reject", feedback: "不想这么排" });
check("拒绝后状态 rejected 且记了 feedback", rejected.status === "rejected" && rejected.feedback === "不想这么排");
check("拒绝不写盘", (await call("wiki.getPage", { id: second.id })).content === secondBody);

// ── 5. 人工结论：人改的句子在整理后不能消失 ───────────────────
console.log("\n[5] 人工结论（claim）");
const humanPage = await call("wiki.createPage", { title: "仓库巡检流程" });
await call("wiki.savePage", { id: humanPage.id, content: "# 仓库巡检流程\n\n> 摘要\n\n## 要点\n\n- 占位\n", summary: "摘要" });
const withHuman = "# 仓库巡检流程\n\n> 摘要\n\n## 要点\n\n- 占位\n- 巡检前必须先跑一遍只读检查\n";
await call("wiki.savePage", { id: humanPage.id, content: withHuman, summary: "摘要" });
const mine = await call("wiki.claims", { pageId: humanPage.id });
check("人改出的新句子被记成结论", mine.some((c) => c.quote.includes("只读检查")), mine.map((c) => c.quote).join(" / "));
check("旧行不会全变成结论（只记新增）", !mine.some((c) => c.quote === "占位"));

const guardOk = await call("wiki.claimCheck", { pageId: humanPage.id, content: withHuman });
check("原样正文 → claimCheck 全 ok", guardOk.conflict.length === 0 && guardOk.orphan.length === 0 && guardOk.total === mine.length);
const guardBad = await call("wiki.claimCheck", { pageId: humanPage.id, content: "# 仓库巡检流程\n\n> 摘要\n\n## 要点\n\n- 占位\n" });
check("会把结论洗掉的正文被拦下", guardBad.conflict.length + guardBad.orphan.length === mine.length, `conflict=${guardBad.conflict.length} orphan=${guardBad.orphan.length}`);

// draft 页面：整理本来会直接写盘，但这页的结论会被 8 条要点上限挤掉 → 必须拦下
const ten = Array.from({ length: 10 }, (_, i) => `- 第 ${i + 1} 条结论：这里有真实内容`);
await call("wiki.savePage", { id: humanPage.id, content: `# 仓库巡检流程\n\n> 摘要\n\n## 要点\n\n${ten.concat("- 第 11 条结论：人最后加的一条，绝不能丢").join("\n")}\n`, summary: "摘要" });
const beforeCurate = (await call("wiki.getPage", { id: humanPage.id })).content;
const blocked = await call("wiki.curate", {});
check("整理报告了被人工结论拦下的页面", Number(blocked.blockedByClaims) >= 1, `blockedByClaims=${blocked.blockedByClaims}`);
check("被拦下的 draft 字节完全没变", (await call("wiki.getPage", { id: humanPage.id })).content === beforeCurate);
const claimAfter = await call("wiki.claims", { pageId: humanPage.id });
check("对不上的结论被标成 conflict/orphan", claimAfter.some((c) => c.status !== "active"), claimAfter.map((c) => `${c.status}:${c.quote.slice(0, 10)}`).join(" / "));
const sugForHuman = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.targetId === humanPage.id);
check("改动进了审核队列（人看 diff 再决定）", Boolean(sugForHuman) && sugForHuman.reasons.some((r) => r.includes("人工结论")));
const issues = await call("wiki.claimIssues", {});
check("审核 tab 能列到「结论待确认」的页面", issues.some((i) => i.pageId === humanPage.id && i.claims.length >= 1), issues.map((i) => `${i.title}:${i.claims.length}`).join(" / "));

// 解除锁定后，下一次整理不再被它挡住
for (const c of claimAfter) await call("wiki.claimRemove", { id: c.id });
check("解除后结论列表清空", (await call("wiki.claims", { pageId: humanPage.id })).length === 0);
check("解除后不再出现在「结论待确认」", !(await call("wiki.claimIssues", {})).some((i) => i.pageId === humanPage.id));
const afterUnlock = await call("wiki.curate", {});
check("解除后整理可以正常写", (await call("wiki.getPage", { id: humanPage.id })).content !== beforeCurate && Number(afterUnlock.blockedByClaims) === 0);

// ── 6. 维护扫描：漏引用 / 疑似重复（接受语义各自不同）───────────
console.log("\n[6] 维护扫描");
await call("wiki.review", { id: humanPage.id, decision: "accept" });
const source = await call("wiki.importSource", {
  title: "事故报告",
  content: "# 事故报告\n\n巡检前必须先跑一遍只读检查并留记录。\n",
  kind: "text",
});
const citePage = await call("wiki.createPage", { title: "巡检流程补记" });
const citeBody = "# 巡检流程补记\n\n> 巡检要点\n\n## 要点\n\n- 巡检前必须先跑一遍只读检查并留记录\n";
await call("wiki.savePage", { id: citePage.id, content: citeBody, summary: "巡检要点" });
const maintain = await call("wiki.maintain", {});
check("扫出漏引用与疑似重复", Number(maintain.citations) >= 1 && Number(maintain.added) >= 1, JSON.stringify(maintain));
const queue = await call("wiki.suggestions", { status: "pending" });
const citeSug = queue.find((s) => s.kind === "citation");
check("漏引用进了队列", Boolean(citeSug), queue.map((s) => s.kind).join(" / "));
const citePayload = JSON.parse((await call("wiki.suggestion", { id: citeSug.id })).payload);
check("引用建议带 sourceId + 原文片段", citePayload.sourceId === source.id && citePayload.quote.includes("只读检查"));
const pageBeforeCite = (await call("wiki.getPage", { id: citeSug.targetId })).content;
const acceptedCite = await call("wiki.suggestionResolve", { id: citeSug.id, decision: "accept" });
const afterCite = await call("wiki.getPage", { id: citeSug.targetId });
check("接受引用 = 加出处，不改正文", afterCite.content === pageBeforeCite && afterCite.citations.some((c) => c.sourceId === source.id), `citations=${afterCite.citations.length}`);
check("引用建议状态 accepted", acceptedCite.status === "accepted");

// 重复页面：接受只生成合并草稿，原页面不动
const dupTitleA = "灰度窗口规则";
const dupTitleB = "复盘：灰度窗口";
const dupSummary = "灰度窗口不要跨周末，结论是先演练再发布";
const dupA = await call("wiki.createPage", { title: dupTitleA });
await call("wiki.savePage", { id: dupA.id, content: `# ${dupTitleA}\n\n> ${dupSummary}\n\n## 要点\n\n- 先演练再发布\n`, summary: dupSummary });
const dupB = await call("wiki.createPage", { title: dupTitleB });
await call("wiki.savePage", { id: dupB.id, content: `# ${dupTitleB}\n\n> ${dupSummary}\n\n## 要点\n\n- 回滚要留记录\n`, summary: dupSummary });
await call("wiki.maintain", {});
const mergeSug = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.kind === "merge");
check("疑似重复进了队列", Boolean(mergeSug), mergeSug?.reasons?.join(" · "));
const beforeA = (await call("wiki.getPage", { id: dupA.id })).content;
const beforeB = (await call("wiki.getPage", { id: dupB.id })).content;
const mergeRes = await call("wiki.suggestionResolve", { id: mergeSug.id, decision: "accept" });
check("接受合并 = 生成草稿页", Boolean(mergeRes.createdPageId));
const mergedPage = mergeRes.createdPageId ? await call("wiki.getPage", { id: mergeRes.createdPageId }) : null;
check("合并草稿是 draft 且含两页要点", mergedPage?.status === "draft" && mergedPage.content.includes("回滚要留记录") && mergedPage.content.includes("先演练再发布"));
check("两个原页面都没被动", (await call("wiki.getPage", { id: dupA.id })).content === beforeA && (await call("wiki.getPage", { id: dupB.id })).content === beforeB);

// 拒绝 → 30 天内不再重复提（同一个 sig 不再入队）
const throttleA = await call("wiki.createPage", { title: "备份策略" });
const throttleB = await call("wiki.createPage", { title: "备份策略说明" });
const throttleSummary = "每天增量备份，每周全量备份，保留四周";
await call("wiki.savePage", { id: throttleA.id, content: `# 备份策略\n\n> ${throttleSummary}\n\n## 要点\n\n- 每天增量备份\n`, summary: throttleSummary });
await call("wiki.savePage", { id: throttleB.id, content: `# 备份策略说明\n\n> ${throttleSummary}\n\n## 要点\n\n- 每周全量备份\n`, summary: throttleSummary });
await call("wiki.maintain", {});
const throttleSug = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.kind === "merge" && (s.targetId === throttleA.id || s.targetId === throttleB.id));
check("重复页面提出合并建议", Boolean(throttleSug), throttleSug?.title);
await call("wiki.suggestionResolve", { id: throttleSug.id, decision: "reject", feedback: "不是重复" });
const rescan = await call("wiki.maintain", {});
const reQueued = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.kind === "merge" && (s.targetId === throttleA.id || s.targetId === throttleB.id));
check("拒绝过的合并不再重复入队", !reQueued, `maintain.added=${rescan.added}`);

// ── 7. 模型整理 → 建议（不直接写盘）───────────────────────────
console.log("\n[7] 模型整理产建议");
const llmPage = await call("wiki.createPage", { title: "模型整理测试页" });
const llmBody = "# 模型整理测试页\n\n> 旧摘要\n\n## 要点\n\n- 旧要点\n\n## 原文摘录\n\n原文不要动。\n";
await call("wiki.savePage", { id: llmPage.id, content: llmBody, summary: "旧摘要" });
const llmNext = "# 模型整理测试页\n\n> 新摘要：模型重写过\n\n## 要点\n\n- 新要点一\n- 新要点二\n\n## 原文摘录\n\n原文不要动。\n";
const enq = await call("wiki.suggestSummary", { pageId: llmPage.id, content: llmNext });
check("模型结果进了建议队列", enq.queued === true);
check("页面字节没被直接改", (await call("wiki.getPage", { id: llmPage.id })).content === llmBody);
const again = await call("wiki.suggestSummary", { pageId: llmPage.id, content: llmNext });
check("同一份模型输出不重复入队", again.queued === false);
const llmSug = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.kind === "summary" && s.targetId === llmPage.id);
check("建议类型是 summary 且带依据", llmSug?.kind === "summary" && llmSug.reasons.length > 0);
const llmAccepted = await call("wiki.suggestionResolve", { id: llmSug.id, decision: "accept" });
const llmAfter = await call("wiki.getPage", { id: llmPage.id });
check("接受后写入的就是 payload 字节", llmAfter.content === llmNext && llmAccepted.status === "accepted");
check("原文摘录保持不变", llmAfter.content.includes("原文不要动。"));
check("页面仍是 draft（模型整理不会顺手审核）", llmAfter.status === "draft");

// 页面在建议之后又改过 → 只能 needs_rebase
const enq2 = await call("wiki.suggestSummary", { pageId: llmPage.id, content: `${llmNext}\n> 另一版摘要\n` });
const sug2 = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.kind === "summary" && s.targetId === llmPage.id);
await call("wiki.savePage", { id: llmPage.id, content: `${llmBody}\n人又改了一行。\n`, summary: "旧摘要" });
const stale2 = await call("wiki.suggestionResolve", { id: sug2.id, decision: "accept" });
check("页面改过后模型建议降级 needs_rebase", enq2.queued === true && stale2.status === "needs_rebase");
check("needs_rebase 不覆盖人工改动", (await call("wiki.getPage", { id: llmPage.id })).content.includes("人又改了一行。"));

// ── 8. 人工结论的生命周期：合并接手 / 删除标 orphan / 恢复重生 ──
console.log("\n[8] 人工结论生命周期");
const carrySummary = "第二组灰度窗口：结论是先演练再发布，回滚要留记录";
const carryA = await call("wiki.createPage", { title: "灰度窗口规则（第二组）" });
await call("wiki.savePage", { id: carryA.id, content: "# 灰度窗口规则\n\n> 占位摘要\n\n## 要点\n\n- 占位\n", summary: carrySummary });
await call("wiki.savePage", { id: carryA.id, content: "# 灰度窗口规则\n\n> 占位摘要\n\n## 要点\n\n- 占位\n- 灰度窗口不要跨周末\n", summary: carrySummary });
const carryB = await call("wiki.createPage", { title: "复盘：灰度窗口（第二组）" });
await call("wiki.savePage", { id: carryB.id, content: "# 复盘：灰度窗口\n\n> 占位摘要\n\n## 要点\n\n- 占位\n", summary: carrySummary });
await call("wiki.savePage", { id: carryB.id, content: "# 复盘：灰度窗口\n\n> 占位摘要\n\n## 要点\n\n- 占位\n- 回滚要留记录并写清责任人\n", summary: carrySummary });
check("两页都记下了人工结论", (await call("wiki.claims", { pageId: carryA.id })).length >= 1 && (await call("wiki.claims", { pageId: carryB.id })).length >= 1);
await call("wiki.maintain", {});
const carrySug = (await call("wiki.suggestions", { status: "pending" })).find((s) => s.kind === "merge" && [carryA.id, carryB.id].includes(s.targetId));
check("两页被判定为疑似重复", Boolean(carrySug), carrySug?.title);

const carryRes = await call("wiki.suggestionResolve", { id: carrySug.id, decision: "accept" });
const carriedClaims = carryRes.createdPageId ? await call("wiki.claims", { pageId: carryRes.createdPageId }) : [];
check("合并稿接手了原页面的人工结论", carriedClaims.length >= 2 && carriedClaims.every((c) => c.provenance?.by === "carry"), carriedClaims.map((c) => c.quote.slice(0, 12)).join(" / "));
check("原页面的结论仍指向原页", (await call("wiki.claims", { pageId: carryA.id })).length >= 1);

const delPage = await call("wiki.createPage", { title: "会被删的页面" });
await call("wiki.savePage", { id: delPage.id, content: "# 会被删的页面\n\n> 摘要\n\n## 要点\n\n- 占位\n", summary: "摘要" });
await call("wiki.savePage", { id: delPage.id, content: "# 会被删的页面\n\n> 摘要\n\n## 要点\n\n- 占位\n- 删除也要保住这句结论\n", summary: "摘要" });
const delClaimsBefore = await call("wiki.claims", { pageId: delPage.id });
check("删除前有结论", delClaimsBefore.length === 1, delClaimsBefore[0]?.quote);
await call("wiki.deletePage", { id: delPage.id });
const delClaims = await call("wiki.claims", { pageId: delPage.id });
check("删除页面 → 结论标 orphan（不删）", delClaims.length === 1 && delClaims[0].status === "orphan");
const trash = (await call("wiki.list", {})).trash.find((t) => t.kind === "page" && t.title === "会被删的页面");
await call("wiki.restoreTrash", { id: trash.id });
const restoredClaims = await call("wiki.claims", { pageId: delPage.id });
check("恢复页面 → 结论重新 active", restoredClaims.length === 1 && restoredClaims[0].status === "active");

// wiki.dream 只剩兼容壳：默认 dry-run 不写队列
const pendingBefore = (await call("wiki.suggestions", {})).length;
const dreamDry = await call("wiki.dream", {});
const pendingAfter = (await call("wiki.suggestions", {})).length;
check("wiki.dream 默认 dry-run 不写队列", dreamDry.dryRun === true && pendingBefore === pendingAfter, `issues=${dreamDry.issues.length}`);
const dreamIssues = new Set(dreamDry.issues.map((i) => i.kind));
check("wiki.dream 报的是维护扫描的结果", [...dreamIssues].every((k) => ["missing-citation", "duplicate-page"].includes(k)), [...dreamIssues].join(" / "));

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
