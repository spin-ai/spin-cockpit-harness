#!/usr/bin/env node
/**
 * Wiki / 笔记冒烟：生成动线（打开目录 → 自动导入 → 生成页面）+ 删除资料/页面 + 审核快捷操作。
 *
 * 前置：隔离 userData 的实例带调试端口在跑：
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 *
 * 用法：node scripts/e2e-notes.mjs [port]
 */
import fs from "node:fs";

const port = Number(process.argv[2] || 9223);
const VAULT = "/tmp/notes-vault";
const DOC_MD = "/tmp/doc-import.md";
const DOC_CSV = "/tmp/table-import.csv";
const DOC_BIN = "/tmp/doc-binary.bin";
fs.rmSync(VAULT, { recursive: true, force: true });
fs.mkdirSync(`${VAULT}/a`, { recursive: true });
fs.mkdirSync(`${VAULT}/b`, { recursive: true });
fs.writeFileSync(`${VAULT}/良率.md`, "# 芯片良率\n\n良率是标量，但缺陷有空间结构。\n\n## 要点\n\n- die 级差分\n");
fs.writeFileSync(`${VAULT}/a/atpg.md`, "# ATPG 笔记\n\nstuck-at 覆盖率 98.9%。\n");
fs.writeFileSync(`${VAULT}/b/agents.md`, "# 多智能体\n\nMission / Plan / Delegation。\n");
fs.writeFileSync(DOC_MD, "# 本地文档测试\n\n这是从磁盘导入的文档。\n");
fs.writeFileSync(DOC_CSV, "name,value\nA,1\nB,2\n");
fs.writeFileSync(DOC_BIN, "PK\u0000\u0003\u0004binary");

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};
let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " · " + d : ""}`); };
const run = ev;

let r = await ev(`
  // confirm 自动确认 + 等待助手
  window.confirm = () => true;
  window.__wait = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
  // 页头动作收进了 ⋯ 菜单：先开菜单再按文字找
  window.__menu = async (label) => {
    const trigger = document.querySelector(".page-header-actions .row-menu-trigger");
    if (trigger) trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    return [...document.querySelectorAll(".row-menu-pop button")].find((b) => b.textContent.includes(label)) || null;
  };
  await window.harness.action("pluginEnable", { id: "ai.cockpit.notes" });
  await new Promise((r) => setTimeout(r, 800));
  await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.vault.open", args: { path: "${VAULT}" } });
  const rail = await window.__wait(() => [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("Wiki")));
  if (!rail) return { error: "no notes rail" };
  rail.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1600));
  const gen = await window.__menu("生成 Wiki");
  if (!gen) return { error: "no generate button", page: !!document.querySelector(".notes-page") };
  gen.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 4000));
  const list = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" });
  return { sources: list?.result?.sources?.length, pages: list?.result?.pages?.length };`);
check("准备：自动导入 3 资料 + 生成 3 页面", r.sources === 3 && r.pages === 3, JSON.stringify(r));

r = await ev(`
  const srcTab = await window.__wait(() => [...document.querySelectorAll(".notes-wiki-tabs button")].find((b) => b.textContent.includes("资料")));
  if (!srcTab) return { error: "no src tab" };
  srcTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const row = await window.__wait(() => document.querySelector(".notes-row"));
  const del = [...(row?.querySelectorAll('.notes-row-actions .link') || [])].find((b) => b.textContent.trim() === "删除");
  if (!del) return { error: "no delete action" };
  del.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const list = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" });
  const g = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.graph" });
  return { sources: list?.result?.sources?.length, edges: g?.result?.edges?.length, rows: document.querySelectorAll(".notes-row").length, notice: document.querySelector(".notes-banner")?.textContent || "" };`);
check("删除资料：列表减少 + 引用边减少", r.sources === 2 && r.edges === 4, JSON.stringify(r));

r = await ev(`
  const pagesTab = await window.__wait(() => [...document.querySelectorAll(".notes-wiki-tabs button")].find((b) => b.textContent.includes("页面")));
  if (!pagesTab) return { error: "no pages tab" };
  pagesTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const before = document.querySelectorAll(".notes-row").length;
  const row = await window.__wait(() => document.querySelector(".notes-row"));
  const del = [...(row?.querySelectorAll('.notes-row-actions .link') || [])].find((b) => b.textContent.trim() === "删除");
  del.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const list = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" });
  return { before, pages: list?.result?.pages?.length, rows: document.querySelectorAll(".notes-row").length };`);
check("删除页面：列表与数据同步", r.before === 3 && r.pages === 2 && r.rows === 2, JSON.stringify(r));

r = await ev(`
  const reviewTab = await window.__wait(() => [...document.querySelectorAll(".notes-wiki-tabs button")].find((b) => b.textContent.includes("审核")));
  if (!reviewTab) return { error: "no review tab" };
  reviewTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const before = (await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" }))?.result?.reviews?.length || 0;
  const row = [...document.querySelectorAll(".notes-row")][0];
  const accept = [...(row?.querySelectorAll(".notes-row-actions .link") || [])].find((b) => b.textContent.trim() === "接受");
  if (!accept) return { error: "no accept", before };
  accept.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  const list = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" });
  return { before, reviews: list?.result?.reviews?.length, notice: document.querySelector(".notes-banner")?.textContent || "" };`);
check("审核 tab：hover 直接接受（待审核 -1）", typeof r.before === "number" && r.reviews === r.before - 1, JSON.stringify(r));
// ── 本地文档导入（docs:read / docsPick）──────────────────────────
r = await run(`
  const docs = await window.harness.docsRead(["/tmp/doc-import.md", "/tmp/table-import.csv", "/tmp/doc-binary.bin"]);
  return docs.map((d) => ({ name: d.name, ok: d.text != null, err: d.error || null }));`);
check("docsRead：读文本 / 拒绝二进制", r[0]?.ok && r[1]?.ok && r[2]?.ok === false && /二进制/.test(r[2]?.err || ""), JSON.stringify(r));

r = await run(`
  const docs = await window.harness.docsRead(["/tmp/doc-import.md", "/tmp/table-import.csv"]);
  for (const d of docs) await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.importSource", args: { title: d.name.replace(/\.[a-z0-9]+$/i, ""), content: d.text, kind: "file", uri: d.path } });
  const list = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" });
  return { sources: list?.result?.sources?.length, kinds: (list?.result?.sources || []).map((s) => s.kind) };`);
check("本地文档变成资料（kind=file）", (r.kinds || []).filter((k) => k === "file").length === 2, JSON.stringify(r));

r = await run(`
  const paste = await window.__menu("粘贴文本");
  paste.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const modes = [...document.querySelectorAll(".notes-source-mode button")].map((b) => b.textContent.trim());
  const fileMode = [...document.querySelectorAll(".notes-source-mode button")].find((b) => b.textContent.trim() === "本地文件");
  fileMode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return { modes, fileHint: !!document.querySelector(".notes-source-file"), pickBtn: [...document.querySelectorAll(".notes-source-actions .btn")].some((b) => b.textContent.includes("选择文件")) };`);
check("导入弹窗三档（文本 / URL / 本地文件）", r.modes?.length === 3 && r.fileHint === true && r.pickBtn === true, JSON.stringify(r));

// ── 自动整理（wiki.curate）：标题 + 大纲 + 索引 ────────────────
r = await run(`
  const created = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.createPage", args: { title: "weak-slug-page" } });
  const p = created.result;
  await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.savePage", args: { id: p.id, content: "# 更好的标题\\n\\n正文第一段。\\n\\n- 要点一\\n- 要点二\\n" } });
  const res = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.curate", args: {} });
  const list = (await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" })).result.pages;
  const full = (await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.getPage", args: { id: p.id } })).result.content;
  const again = await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.curate", args: {} });
  return {
    titles: list.map((x) => x.title),
    index: list.some((x) => x.title === "Wiki 索引"),
    headings: full.match(/^##\\s+.+$/gm),
    points: full.split("## 要点")[1]?.split("##")[0]?.trim(),
    renamedAgain: again?.result?.renamed, updatedAgain: again?.result?.updated,
  };`);
check("整理：弱标题改成正文 H1 + 大纲四段 + 索引",
  r.titles.includes("更好的标题") && !r.titles.includes("weak-slug-page") && r.index === true &&
  JSON.stringify(r.headings) === JSON.stringify(["## 要点", "## 原文摘录", "## 相关"]) && /要点一/.test(r.points || ""),
  JSON.stringify({ titles: r.titles, headings: r.headings }));
check("整理幂等（第二次 renamed/updated 均为 0）", r.renamedAgain === 0 && r.updatedAgain === 0, JSON.stringify({ renamed: r.renamedAgain, updated: r.updatedAgain }));

// ── reviewed 保护 + Agent 写入必须带 citation ─────────────────
r = await run(`
  const call = async (method, args) => { try { return { ok: true, value: (await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method, args })).result }; } catch (e) { return { ok: false, error: String(e?.message || e) }; } };
  const list = (await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.list" })).result;
  const sourceId = list.sources[0]?.id;
  const created = (await call("wiki.createPage", { title: "reviewed-guard" })).value;
  await call("wiki.savePage", { id: created.id, content: "# reviewed-guard\\n\\n原始正文\\n" });
  await call("wiki.review", { id: created.id, decision: "accept" });
  const noCite = await call("wiki.upsertDraft", { title: "reviewed-guard", content: "# 改坏\\n", agent: true });
  const overwrite = await call("wiki.upsertDraft", { title: "reviewed-guard", content: "# 改坏\\n", sourceIds: [sourceId], agent: true });
  const badId = await call("wiki.upsertDraft", { title: "reviewed-guard", content: "# 改坏\\n", sourceIds: ["nope"], agent: true });
  const fresh = await call("wiki.upsertDraft", { title: "agent-draft-ok", content: "# ok\\n", sourceIds: [sourceId], agent: true });
  const after = (await call("wiki.getPage", { id: created.id })).value;
  const human = await call("wiki.savePage", { id: created.id, content: "# reviewed-guard\\n\\n人工补充\\n" });
  const afterHuman = (await call("wiki.getPage", { id: created.id })).value;
  return {
    noCite: noCite.error || "", overwrite: overwrite.error || "", badId: badId.error || "",
    freshOk: fresh.value?.status === "draft", content: after.content, status: after.status,
    humanStatus: human.value?.status, reopen: afterHuman.reopenReason || "", reviewedAt: afterHuman.reviewedAt,
  };`);
check("Agent 无 source_ids 被拒", /source_ids/.test(r.noCite), r.noCite);
check("Agent 覆盖 reviewed 被拒且正文不变", /已审核|reviewed/.test(r.overwrite) && r.content.includes("原始正文") && r.status === "reviewed", JSON.stringify({ err: r.overwrite, status: r.status }));
check("Agent 无效 source_ids 被拒", /无效/.test(r.badId), r.badId);
check("Agent 带有效 source 可以新建 draft", r.freshOk === true);
check("人工编辑 reviewed 后回 draft 且标记待重审", r.humanStatus === "draft" && r.reopen === "edited-after-review" && r.reviewedAt == null, JSON.stringify({ status: r.humanStatus, reopen: r.reopen }));

// ── stale：资料更新/删除让引用页面过期，可确认恢复 ─────────────
r = await run(`
  const call = async (method, args) => { try { return { ok: true, value: (await window.harness.action("pluginInvoke", { pluginId: "ai.cockpit.notes", method, args })).result }; } catch (e) { return { ok: false, error: String(e?.message || e) }; } };
  const src = await call("wiki.importSource", { title: "stale-src", content: "原始内容 A", kind: "text", uri: "test://stale-src" });
  const page = (await call("wiki.createPage", { title: "stale-page" })).value;
  await call("wiki.savePage", { id: page.id, content: "# stale-page\\n\\n正文\\n" });
  await call("wiki.addCitation", { pageId: page.id, sourceId: src.value.id });
  await call("wiki.review", { id: page.id, decision: "accept" });
  await call("wiki.importSource", { title: "stale-src", content: "原始内容 A", kind: "text", uri: "test://stale-src" });
  const afterSame = (await call("wiki.getPage", { id: page.id })).value;
  const updated = await call("wiki.importSource", { title: "stale-src", content: "原始内容 B 改了", kind: "text", uri: "test://stale-src" });
  const afterUpdate = (await call("wiki.getPage", { id: page.id })).value;
  const cleared = await call("wiki.clearStale", { id: page.id });
  const afterClear = (await call("wiki.getPage", { id: page.id })).value;
  const src2 = await call("wiki.importSource", { title: "stale-src-2", content: "内容 C", kind: "text", uri: "test://stale-src-2" });
  const page2 = (await call("wiki.createPage", { title: "stale-page-2" })).value;
  await call("wiki.addCitation", { pageId: page2.id, sourceId: src2.value.id });
  await call("wiki.review", { id: page2.id, decision: "accept" });
  await call("wiki.deleteSource", { id: src2.value.id });
  const afterDelete = (await call("wiki.getPage", { id: page2.id })).value;
  return {
    sameOk: afterSame.status === "reviewed",
    updatedOk: afterUpdate.status === "stale" && afterUpdate.staleReason === "source-updated" && afterUpdate.content.includes("正文"),
    updatedStaled: (updated.value?.staled || []).length,
    clearOk: cleared.value?.status === "reviewed" && !afterClear.staleReason,
    deletedOk: afterDelete.status === "stale" && afterDelete.staleReason === "source-deleted",
  };
`);
check("重复导入相同内容不标 stale", r.sameOk === true);
check("资料更新 → 引用页面 stale（正文不变）", r.updatedOk === true && r.updatedStaled === 1, JSON.stringify(r));
check("确认仍有效 → 恢复 reviewed", r.clearOk === true);
check("资料删除 → 引用页面 stale", r.deletedOk === true);

ws.close();
console.log(fails ? `${fails} 项失败` : "全部通过");
process.exit(fails ? 1 : 0);
