#!/usr/bin/env node
/**
 * Markdown 富文本（ORCA 风格）冒烟：默认即可编辑 + 格式工具栏 + ⌘S 写回 + ⌘⇧M 切源码。
 *
 * 前置：隔离 userData 的实例带调试端口在跑；脚本会写 /tmp/rich.md：
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 */
import fs from "node:fs";

fs.writeFileSync("/tmp/rich.md", "# 富文本测试\n\n第一段原文。\n\n## 小节\n\n- 列表 A\n");

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
  window.prompt = () => "https://example.com";
  await window.harness.action("addProject", { path: "/tmp", name: "rich" });
  const s = await window.harness.getState();
  const p = s.projects.find((x) => x.name === "rich");
  await window.harness.action("switchProject", { id: p.id });
  await new Promise((r) => setTimeout(r, 900));
  const row = await window.__w(() => [...document.querySelectorAll(".tree-row")].find((el) => el.textContent.includes("rich.md")));
  if (!row) return { error: "no row" };
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const bar = await window.__w(() => document.querySelector(".md-toolbar"));
  const btns = [...document.querySelectorAll(".preview-surface-actions .btn")].map((b) => b.textContent.trim());
  return { toolbar: !!bar, tools: [...(bar?.querySelectorAll(".md-tool") || [])].map((b) => b.title || b.textContent.trim()), extraButtons: btns };`);
check("富文本默认即可编辑，有格式工具栏（没有「编辑富文本」按钮）", r.toolbar === true && r.tools.length >= 8 && !r.extraButtons.includes("编辑富文本"), JSON.stringify(r));

r = await ev(`
  const el = document.querySelector(".md-render");
  return { editable: el?.getAttribute("contenteditable"), cursor: getComputedStyle(el).cursor };`);
check("渲染容器 contentEditable=true", r.editable === "true", JSON.stringify(r));

r = await ev(`
  const el = document.querySelector(".md-render");
  const h1 = el.querySelector("h1");
  const range = document.createRange(); range.selectNodeContents(h1);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const tool = [...document.querySelectorAll(".md-tool")].find((b) => b.textContent.trim() === "H2");
  tool.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return { h2: el.querySelector("h2")?.textContent || null, h1: el.querySelector("h1")?.textContent || null };`);
check("工具栏可用：选中标题 → H2", r.h2 === "富文本测试" && r.h1 === null, JSON.stringify(r));

r = await ev(`
  const el = document.querySelector(".md-render");
  el.querySelector("p").textContent = "段落被改过。";
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return { saved: !!document.querySelector(".preview-saved") };`);
const disk = fs.readFileSync("/tmp/rich.md", "utf8");
check("⌘S 保存：H2 与段落写入 Markdown", /^## 富文本测试/m.test(disk) && /段落被改过/.test(disk), JSON.stringify(disk.slice(0, 60)));

r = await ev(`
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "M", metaKey: true, shiftKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const seg = [...document.querySelectorAll(".file-preview-seg button")].map((b) => ({ t: b.textContent.trim(), on: b.className.includes("on") }));
  const editor = !!document.querySelector(".file-source-editor");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "M", metaKey: true, shiftKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const back = !!document.querySelector(".md-render");
  return { seg, editor, back };`);
check("⌘⇧M 切源码再切回（ORCA 习惯）", r.editor === true && r.back === true && r.seg[0]?.on === false, JSON.stringify(r));
ws.close();
console.log(fails ? `${fails} 项失败` : "全部通过");
process.exit(fails ? 1 : 0);
