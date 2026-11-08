#!/usr/bin/env node
/**
 * Markdown 富文本（TipTap / ProseMirror 内核）冒烟：
 * 编辑器加载、Markdown 输入规则（"# " → H1）、⌘B 加粗、⌘S 写回（加粗 / pipe 表格）。
 *
 * 前置：隔离 userData 的实例带调试端口在跑；脚本会重建 /tmp/tiptap-proj 夹具：
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 */
import fs from "node:fs";

const PROJ = "/tmp/tiptap-proj";
fs.rmSync(PROJ, { recursive: true, force: true });
fs.mkdirSync(PROJ, { recursive: true });
fs.writeFileSync(`${PROJ}/doc.md`, "# 富文本测试\n\n第一段原文。\n\n## 小节\n\n- 列表 A\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n");
fs.writeFileSync(`${PROJ}/empty.md`, "");

const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
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
const type = async (text) => { for (const ch of text) { await send("Input.dispatchKeyEvent", { type: "char", text: ch, unmodifiedText: ch }); await new Promise((r) => setTimeout(r, 50)); } };

let r = await ev(`
  window.__w = async (fn, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
  window.prompt = () => "https://example.com";
  await window.harness.action("addProject", { path: "${PROJ}", name: "tiptap" });
  const s = await window.harness.getState();
  const p = s.projects.find((x) => x.name === "tiptap");
  await window.harness.action("switchProject", { id: p.id });
  await new Promise((r) => setTimeout(r, 1200));
  const row = await window.__w(() => [...document.querySelectorAll(".tree-row")].find((el) => el.textContent.trim() === "doc.md" || el.textContent.includes("doc.md")));
  if (!row) return { error: "no doc.md" };
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const prose = await window.__w(() => document.querySelector(".ProseMirror"));
  return { editor: !!prose, h1: prose?.querySelector("h1")?.textContent, table: !!prose?.querySelector("table"), tools: document.querySelectorAll(".md-tool").length };`);
check("TipTap 编辑器加载（ProseMirror + 表格 + 工具栏）", r.editor === true && r.h1 === "富文本测试" && r.table === true && r.tools >= 12, JSON.stringify(r));

// 打开空文件，在空段落里真实键入 "# 标题 " → 应变 H1
r = await ev(`
  const row = [...document.querySelectorAll(".tree-row")].find((el) => el.textContent.includes("empty.md"));
  if (!row) return { error: "no empty.md" };
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1000));
  const prose = document.querySelector(".ProseMirror");
  prose?.focus();
  const rect = prose?.getBoundingClientRect();
  return { ok: !!prose, x: rect ? rect.left + 30 : 0, y: rect ? rect.top + 24 : 0 };`);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
await type("# 标题 ");
await new Promise((res) => setTimeout(res, 500));
r = await ev(`return { h1: document.querySelector(".ProseMirror h1")?.textContent || null, hasText: (document.querySelector(".ProseMirror")?.textContent || "").includes("# ") };`);
check("Markdown 输入规则：# 空格 → H1", (r.h1 || "").trim() === "标题" && r.hasText === false, JSON.stringify(r));

// 回到 doc.md，测加粗与保存
r = await ev(`
  const row = [...document.querySelectorAll(".tree-row")].find((el) => el.textContent.includes("doc.md"));
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1000));
  const prose = document.querySelector(".ProseMirror");
  const p = [...prose.querySelectorAll("p")].find((x) => x.textContent.includes("第一段原文"));
  const range = document.createRange(); range.selectNodeContents(p);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  prose.focus();
  return { ok: !!p };`);
await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 4, key: "b", code: "KeyB", windowsVirtualKeyCode: 66 });
await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, key: "b", code: "KeyB", windowsVirtualKeyCode: 66 });
await new Promise((res) => setTimeout(res, 400));
r = await ev(`return { strong: [...document.querySelectorAll(".ProseMirror p strong")].map((x) => x.textContent) };`);
check("⌘B 加粗选中文本", (r.strong || []).some((t) => t.includes("第一段原文")), JSON.stringify(r));

await ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true })); true;`);
await new Promise((res) => setTimeout(res, 1600));
const disk = fs.readFileSync(`${PROJ}/doc.md`, "utf8");
check("保存：加粗 / pipe 表格（无 <table>）", /\*\*第一段原文。\*\*/.test(disk) && /\| A \| B \|/.test(disk) && !/<table/i.test(disk), JSON.stringify(disk.split("\n").slice(0, 16)));
ws.close();
console.log(fails ? `${fails} 项失败` : "全部通过");
process.exit(fails ? 1 : 0);
