#!/usr/bin/env node
/**
 * 冒烟测试：TODO 编辑 / 新建 / 问清楚 + 主机探测 + 统计采集与下钻。
 *
 * 前置：一个**隔离了 userData** 的实例带调试端口在跑（避免动到正在用的 harness.db）：
 *
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e VITE_DEV_SERVER_URL="http://[::1]:5299/" \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 *
 * 用法：node scripts/e2e-smoke.mjs [port]
 * 说明：
 * - 依赖 Node 内置 WebSocket + fetch（Node ≥ 22）
 * - COCKPIT_USER_DATA 指向临时目录，避免动到正在使用的 harness.db
 * - 「问清楚」会真的失败一次 run（本机 dsh 无 API key 也算预期结果），用于验证统计采集
 */
const port = Number(process.argv[2] || 9223);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.error(`没有找到调试页面：http://127.0.0.1:${port}/json/list`); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval error");
  return r.result?.result?.value;
};
const run = (code) => evaluate(`(async()=>{ ${code} })()`);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); };

await evaluate(`
window.__t = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  setValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  key(el, key, opts = {}) { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts })); },
  click(el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); },
  dblclick(el) { el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); },
  rail(label) { return [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes(label)); },
  async until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 60)); } return null; },
}; true`);

let r = await run(`
  const s = await window.harness.getState();
  const local = s.hosts.find((h) => h.kind === "local");
  return { caps: local?.caps || [], status: local?.status, latency: local?.latencyMs };`);
check("本机 caps 探测", r.caps.length > 0, `${r.caps.map((c) => `${c.cli}@${c.version}`).join(", ")} · ${r.latency}ms`);

r = await run(`
  return { hint: document.querySelector(".task-edit-hint")?.textContent || "", add: !!document.querySelector(".pane-add"), editor: !!document.querySelector(".task-row") };`);
check("TODO 可编辑可感知入口", r.hint.includes("⌘E") && r.add, r.hint.trim());

r = await run(`
  __t.click(document.querySelector(".pane-add"));
  await __t.wait(100);
  const ta = document.querySelector(".task-create textarea");
  if (!ta) return { error: "no capture textarea" };
  __t.setValue(ta, "- 修一下登录报错\\n\\n2) 补 statistics 接口\\n* 补 statistics 接口\\n- 问清楚 worktree 清理策略");
  await __t.wait(120);
  const btn = [...document.querySelectorAll(".task-create .btn")].find((b) => b.textContent.includes("加入"));
  const preview = btn?.textContent.match(/\\d+/)?.[0] || null;
  __t.key(ta, "Enter", { metaKey: true });
  await __t.wait(700);
  const s = await window.harness.getState();
  return {
    preview, panelClosed: !document.querySelector(".task-create"),
    todos: s.todos.length, titles: s.todos.map((t) => t.title),
    threads: s.threads.filter((t) => t.todoId).length,
  };`);
check("收集箱：多行 → 去前缀/去重 → 批量建任务", r.preview === "3" && r.todos >= 3 && r.panelClosed && r.threads >= 3,
  `预览=${r.preview} · ${JSON.stringify(r.titles)}`);

r = await run(`
  let agent = (await window.harness.getState()).agents.find((a) => a.cli === "dsh");
  if (!agent) agent = (await window.harness.action("createAgent", { cli: "dsh" }))?.result;
  const firstTitle = document.querySelector(".task-row-title");
  if (!document.querySelector(".task-edit-fields")) {
    if (!firstTitle) return { error: "no task row" };
    firstTitle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await __t.wait(150);
  }
  const sel = [...document.querySelectorAll(".task-edit-fields select")].find((x) => [...x.options].some((o) => o.textContent === "未分配"));
  if (!sel) return { error: "no agent select" };
  sel.value = agent.id;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await __t.wait(400);
  const s = await window.harness.getState();
  const todo = s.todos[0];
  return { assigned: todo.agentId, threadAgent: s.threads.find((t) => t.todoId === todo.id)?.agentId, agentId: agent.id };`);
check("编辑面板分配执行 Agent", r.assigned === r.agentId && r.threadAgent === r.agentId, JSON.stringify(r));

r = await run(`
  // 编辑面板可能因为上一步分配 Agent 还开着：有就用，没有就双击打开
  let input = document.querySelector(".task-edit-title");
  if (!input) {
    const title = await __t.until(() => document.querySelector(".task-row-title"));
    if (!title) return { error: "no row title" };
    __t.dblclick(title);
    input = await __t.until(() => document.querySelector(".task-edit-title"));
  }
  if (!input) return { error: "no editor" };
  __t.setValue(input, "E2E 冒烟任务（已改）");
  __t.key(input, "Enter");
  await __t.wait(500);
  const s = await window.harness.getState();
  const todo = s.todos.find((t) => t.title === "E2E 冒烟任务（已改）");
  return { title: todo?.title, thread: s.threads.find((t) => t.todoId === todo?.id)?.title };`);
check("行内编辑 + 会话标题同步", r.title === "E2E 冒烟任务（已改）" && r.thread === r.title, JSON.stringify(r));

r = await run(`
  const findAsk = () => {
    const row = [...document.querySelectorAll(".task-row")].find((el) => (el.querySelector(".task-row-title")?.textContent || "").includes("E2E 冒烟任务（已改）"));
    return row ? [...row.querySelectorAll(".task-quick .btn")].find((b) => b.textContent.trim() === "问清楚") : null;
  };
  const ask = await __t.until(findAsk, 4000);
  if (!ask) return { error: "no ask button" };
  __t.click(ask);
  const ta = await __t.until(() => {
    const el = document.querySelector(".composer-shell textarea, .composer textarea");
    return el && el.value.startsWith("先别动手") ? el : null;
  }, 4000);
  return { draft: (ta?.value || "").slice(0, 24), focused: document.activeElement === ta };`);
check("问清楚预填 Chat 草稿", String(r.draft || "").startsWith("先别动手"), `${r.draft || r.error || ""} · focused=${r.focused}（焦点为附加项）`);

r = await run(`
  const s = await window.harness.getState();
  const todo = s.todos[0];
  if (!s.runs.length) {
    const agent = await window.harness.action("createAgent", { cli: "dsh" });
    await window.harness.action("run", { id: todo.id, agentId: agent?.result?.id });
    await __t.wait(6000);
  }
  const after = await window.harness.getState();
  const run = after.runs[0];
  return { runs: after.runs.length, status: run?.status, cls: run?.errorClass, dur: run?.durationMs, wait: run?.queueWaitMs, usage: run?.usageSource, host: run?.hostId };`);
check("run 统计采集（分类/耗时/排队/主机）", r.dur != null && r.wait != null && r.host && ["auth", "rate_limit", "timeout", "other"].includes(r.cls), JSON.stringify(r));

r = await run(`
  __t.click(__t.rail("主机"));
  await __t.wait(500);
  return { cards: document.querySelectorAll(".host-card").length, chip: document.querySelector(".host-cap")?.textContent || "" };`);
check("主机页卡片 + caps 芯片", r.cards >= 1 && r.chip.length > 0, JSON.stringify(r));

r = await run(`
  __t.click(__t.rail("统计"));
  await __t.wait(500);
  return { kpis: document.querySelectorAll(".kpi").length, trend: document.querySelectorAll(".trend-col").length, fail: document.querySelectorAll(".fail-row-btn").length };`);
check("统计页 KPI + 趋势 + 失败列表", r.kpis === 4 && r.trend > 0, JSON.stringify(r));

r = await run(`
  const btn = await __t.until(() => document.querySelector(".fail-row-btn"));
  if (!btn) return { error: "no failure row" };
  __t.click(btn);
  const chat = await __t.until(() => document.querySelector(".composer-shell textarea, .composer textarea"), 4000);
  return { chat: !!chat, todo: !!document.querySelector(".task-row") };`);
check("失败行下钻回 Chat", r.chat === true, JSON.stringify(r));

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
ws.close();
process.exit(results.every(Boolean) ? 0 : 1);
