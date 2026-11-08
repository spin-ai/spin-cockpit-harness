#!/usr/bin/env node
/**
 * Markdown 富文本（ORCA 风格）冒烟：
 * 工具栏（代码块/表格/分割线/删除线）、Markdown 输入规则（"### " → H3）、
 * 斜杠菜单插入块、⌘S 写回 Markdown、⌘⇧M 富文本 ⇄ 源码。
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
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await window.__w(() => document.querySelector(".md-toolbar"));
  const tools = [...document.querySelectorAll(".md-tool")].map((b) => b.title || b.textContent.trim());
  return { tools };`);
check("工具栏含代码块 / 表格 / 分割线 / 删除线", r.tools.includes("代码块") && r.tools.includes("表格") && r.tools.includes("分割线") && r.tools.includes("删除线（⌘⇧X）"), JSON.stringify(r.tools));

// Markdown 输入规则：新建空块输入 "### " → H3
r = await ev(`
  const el = document.querySelector(".md-render");
  el.focus();
  const p = document.createElement("p"); p.textContent = ""; el.appendChild(p);
  const range = document.createRange(); range.selectNodeContents(p); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  p.textContent = "### ";
  const r2 = document.createRange(); r2.selectNodeContents(p); r2.collapse(false); sel.removeAllRanges(); sel.addRange(r2);
  el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return { h3: !!el.querySelector("h3"), text: el.querySelector("h3")?.textContent || null };`);
check("输入「### 」自动变 H3（Markdown 快捷键）", r.h3 === true, JSON.stringify(r));

// 斜杠菜单
r = await ev(`
  const el = document.querySelector(".md-render");
  el.focus();
  const p = document.createElement("p"); p.textContent = ""; el.appendChild(p);
  const range = document.createRange(); range.selectNodeContents(p); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const menu = document.querySelector(".md-slash");
  const items = [...document.querySelectorAll(".md-slash-item")].map((b) => b.textContent.trim());
  const table = [...document.querySelectorAll(".md-slash-item")].find((b) => b.textContent.includes("表格"));
  table?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return { menu: !!menu, items, table: !!el.querySelector("table") };`);
check("斜杠菜单可插入块（表格）", r.menu === true && r.items.length >= 8 && r.table === true, JSON.stringify({ menu: r.menu, count: r.items.length, table: r.table }));

// 保存到 md：表格成 pipe 表格
r = await ev(`
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return { saved: !!document.querySelector(".preview-saved") };`);
const disk = fs.readFileSync("/tmp/rich.md", "utf8");
check("表格/标题写入 Markdown", /\| 列 1 \| 列 2 \|/.test(disk) && /^### /m.test(disk), JSON.stringify(disk.split("\n").slice(0, 12)));

// ⌘⇧M 往返
r = await ev(`
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "M", metaKey: true, shiftKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const src = !!document.querySelector(".file-source-editor");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "M", metaKey: true, shiftKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return { src, back: !!document.querySelector(".md-render") };`);
check("⌘⇧M 富文本 ⇄ 源码", r.src === true && r.back === true, JSON.stringify(r));
ws.close();
console.log(fails ? `${fails} 项失败` : "全部通过");
process.exit(fails ? 1 : 0);
