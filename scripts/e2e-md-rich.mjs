#!/usr/bin/env node
/**
 * Markdown 富文本编辑冒烟：contentEditable → ⌘S/保存 → turndown 写回 Markdown。
 *
 * 前置：隔离 userData 的实例带调试端口在跑；脚本会写 /tmp/rich.md 夹具：
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 */
import fs from "node:fs";

fs.writeFileSync("/tmp/rich.md", "# 富文本编辑测试\n\n第一段原文。\n\n## 小节\n\n- 列表 A\n- 列表 B\n");

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

let r = await ev(`
  window.__w = async (fn, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); } return null; };
  await window.harness.action("addProject", { path: "/tmp", name: "rich" });
  const s = await window.harness.getState();
  const p = s.projects.find((x) => x.name === "rich");
  await window.harness.action("switchProject", { id: p.id });
  await new Promise((r) => setTimeout(r, 900));
  const row = await window.__w(() => [...document.querySelectorAll(".tree-row")].find((el) => el.textContent.includes("rich.md")));
  if (!row) return { error: "no md row", rows: [...document.querySelectorAll(".tree-row")].map((e) => e.textContent.trim()).slice(0, 6) };
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const ed = await window.__w(() => [...document.querySelectorAll(".preview-surface-actions .btn")].find((b) => b.textContent.includes("编辑富文本")));
  return { editorButton: !!ed, segs: [...document.querySelectorAll(".file-preview-seg button")].map((b) => b.textContent.trim()) };`);
check("Markdown 富文本模式有「编辑富文本」按钮", r.editorButton === true, JSON.stringify(r));

r = await ev(`
  const btn = [...document.querySelectorAll(".preview-surface-actions .btn")].find((b) => b.textContent.includes("编辑富文本"));
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const el = document.querySelector(".md-render");
  const editable = el?.getAttribute("contenteditable");
  // 模拟用户改标题与段落
  const h1 = el.querySelector("h1");
  if (h1) h1.textContent = "富文本改过的标题";
  const p = el.querySelector("p");
  if (p) p.textContent = "第一段被富文本改过。";
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const save = [...document.querySelectorAll(".preview-surface-actions .btn")].find((b) => b.textContent.trim() === "保存");
  return { editable, hint: !!document.querySelector(".preview-hint.visual"), save: !!save };`);
check("进入可编辑：contentEditable + 提示条 + 保存按钮", r.editable === "true" && r.hint === true && r.save === true, JSON.stringify(r));

r = await ev(`
  const save = [...document.querySelectorAll(".preview-surface-actions .btn")].find((b) => b.textContent.trim() === "保存");
  save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  const btn = [...document.querySelectorAll(".preview-surface-actions .btn")].find((b) => b.textContent.includes("完成编辑"));
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  const h1 = document.querySelector(".md-render h1")?.textContent;
  return { h1 };`);
const disk = fs.readFileSync("/tmp/rich.md", "utf8");
check("保存写回 Markdown（标题变 # 富文本改过的标题）", /^# 富文本改过的标题/m.test(disk) && /第一段被富文本改过/.test(disk), JSON.stringify(disk.slice(0, 80)));
check("退出编辑后渲染同步", (r.h1 || "") === "富文本改过的标题", JSON.stringify(r));

r = await ev(`
  const btn = [...document.querySelectorAll(".preview-surface-actions .btn")].find((b) => b.textContent.includes("编辑富文本"));
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const el = document.querySelector(".md-render");
  const li = el.querySelector("li");
  if (li) li.textContent = "列表 A 改过";
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return { saved: !!document.querySelector(".preview-saved") };`);
const disk2 = fs.readFileSync("/tmp/rich.md", "utf8");
check("⌘S 保存富文本；列表保持 Markdown 语法", /^- 列表 A 改过/m.test(disk2), JSON.stringify(disk2.split("\n").slice(-4)));
ws.close();
console.log(fails ? `${fails} 项失败` : "全部通过");
process.exit(fails ? 1 : 0);
