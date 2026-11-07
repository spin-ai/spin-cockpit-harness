#!/usr/bin/env node
/**
 * 预览冒烟：Markdown 富文本/源码 + 目录 + HTML 预览/编辑 + ⌘S 保存写盘。
 *
 * 前置：一个隔离 userData 的实例带调试端口在跑（不污染正在用的数据）：
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 *
 * 用法：node scripts/e2e-preview.mjs [port]
 */
import fs from "node:fs";
const PROJ = "/tmp/cockpit-preview-fixture";
fs.rmSync(PROJ, { recursive: true, force: true });
fs.mkdirSync(PROJ, { recursive: true });
fs.writeFileSync(`${PROJ}/doc.md`, `# 标题一\n\n正文段落。\n\n## 小节 A\n\n\`\`\`js\n# 这不是标题\n\`\`\`\n\n### 更深一层\n\n## 小节 B\n\n结尾。\n`);
fs.writeFileSync(`${PROJ}/page.html`, `<html><body><h1 id="h">HTML 预览</h1><p>p1</p></body></html>`);
const port = Number(process.argv[2] || 9223);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};
const run = (code) => evaluate(`(async()=>{ ${code} })()`);
let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " · " + d : ""}`); };
await evaluate(`window.__t={wait:(ms)=>new Promise(r=>setTimeout(r,ms)),click(el){el.dispatchEvent(new MouseEvent("click",{bubbles:true}))},
 setValue(el,v){const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))},
 key(el,k,o={}){el.dispatchEvent(new KeyboardEvent("keydown",{key:k,bubbles:true,...o}))},
 async until(fn,ms=6000){const t0=Date.now();while(Date.now()-t0<ms){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,80));}return null;}}; true`);

// 切项目
let r = await run(`
  await window.harness.action("addProject", { path: "${PROJ}", name: "preview-fixture" });
  const s = await window.harness.getState();
  const p = s.projects.find(x=>x.name==="preview-fixture");
  await window.harness.action("switchProject", { id: p.id });
  await __t.wait(700);
  return { ok: !!p };`);
check("项目就绪", r.ok);

// 打开 doc.md
r = await run(`
  const row = await __t.until(() => [...document.querySelectorAll(".tree-row")].find(el=>el.textContent.includes("doc.md")));
  if (!row) return { error: "no md row" };
  __t.click(row);
  const seg = await __t.until(() => document.querySelector(".file-preview-seg"));
  const md = await __t.until(() => document.querySelector(".md-render h1"));
  return { segs: [...seg.querySelectorAll("button")].map(b=>b.textContent.trim()), h1: md?.textContent, tocBtn: !!document.querySelector('.icon-btn[title^="目录"]') };`);
check("Markdown 打开为富文本，有 富文本/源码 与目录按钮", r.h1 === "标题一" && r.segs.join("/") === "富文本/源码" && r.tocBtn, JSON.stringify(r));

// TOC
r = await run(`
  __t.click(document.querySelector('.icon-btn[title^="目录"]'));
  await __t.wait(300);
  const items = [...document.querySelectorAll(".md-toc-item")].map(b=>b.textContent.trim());
  __t.click([...document.querySelectorAll(".md-toc-item")].find(b=>b.textContent.includes("小节 B")));
  await __t.wait(700);
  const flashed = !!document.querySelector(".md-flash");
  const body = document.querySelector(".preview-surface-body");
  return { items, flashed, scrolled: body.scrollTop > 0 };`);
check("目录：只列真标题（跳过代码块）+ 点击跳转", JSON.stringify(r.items) === JSON.stringify(["标题一","小节 A","更深一层","小节 B"]) && r.flashed, JSON.stringify(r));

// 切源码 → 编辑 → ⌘S 保存
r = await run(`
  const seg = [...document.querySelectorAll(".file-preview-seg button")].find(b=>b.textContent.trim()==="源码");
  __t.click(seg); await __t.wait(400);
  const ta = document.querySelector(".file-source-editor");
  if (!ta) return { error: "no editor" };
  __t.setValue(ta, ta.value + "\\n## 新加的小节\\n\\n内容。\\n");
  await __t.wait(300);
  const saveBtn = [...document.querySelectorAll(".preview-surface-actions .btn")].find(b=>b.textContent.includes("保存"));
  if (!saveBtn) return { error: "no save button" };
  __t.click(saveBtn);
  await __t.wait(700);
  return { savedHint: !!document.querySelector(".preview-saved"), stillDirty: !![...document.querySelectorAll(".preview-surface-actions .btn")].find(b=>b.textContent.includes("保存")) };`);
check("源码编辑 + 保存按钮 → 已保存", r.savedHint === true && r.stillDirty === false, JSON.stringify(r));
const mdOnDisk = fs.readFileSync(`${PROJ}/doc.md`, "utf8");
check("写盘生效", mdOnDisk.includes("## 新加的小节"), `长度 ${mdOnDisk.length}`);

// 回到富文本：新标题进目录
r = await run(`
  const seg = [...document.querySelectorAll(".file-preview-seg button")].find(b=>b.textContent.trim()==="富文本");
  __t.click(seg); await __t.wait(500);
  const items = [...document.querySelectorAll(".md-toc-item")].map(b=>b.textContent.trim());
  return { items, h2: [...document.querySelectorAll(".md-render h2")].map(h=>h.textContent) };`);
check("保存后富文本/目录同步更新", r.items.includes("新加的小节") && r.h2.includes("新加的小节"), JSON.stringify(r.h2));

// HTML：预览/编辑 + 保存
r = await run(`
  const row = await __t.until(() => [...document.querySelectorAll(".tree-row")].find(el=>el.textContent.includes("page.html")));
  __t.click(row);
  const seg = await __t.until(() => document.querySelector(".file-preview-seg"));
  const segs = [...seg.querySelectorAll("button")].map(b=>b.textContent.trim());
  const editBtn = [...seg.querySelectorAll("button")].find(b=>b.textContent.trim()==="编辑");
  __t.click(editBtn); await __t.wait(400);
  const ta = document.querySelector(".file-source-editor");
  if (!ta) return { error: "no html editor", segs };
  __t.setValue(ta, ta.value.replace("p1", "p2"));
  await __t.wait(300);
  const saveBtn = [...document.querySelectorAll(".preview-surface-actions .btn")].find(b=>b.textContent.includes("保存"));
  __t.click(saveBtn); await __t.wait(800);
  return { segs, saved: !!document.querySelector(".preview-saved") };`);
check("HTML 预览/编辑切换 + 保存", JSON.stringify(r.segs) === JSON.stringify(["预览","编辑"]) && r.saved, JSON.stringify(r));
const htmlOnDisk = fs.readFileSync(`${PROJ}/page.html`, "utf8");
check("HTML 写盘生效", htmlOnDisk.includes("p2"), htmlOnDisk.slice(0, 60));
ws.close();

console.log(`\n${fails === 0 ? "全部通过" : `${fails} 项失败`}`);
process.exit(fails ? 1 : 0);
