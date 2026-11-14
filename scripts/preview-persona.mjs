#!/usr/bin/env node
/**
 * 人物页渲染层预览（无 Electron 窗口、不抢焦点）。
 *
 *   node scripts/preview-persona.mjs           # 起 vite + headless Chrome，跑断言并截图
 *   node scripts/preview-persona.mjs --shots-only
 *
 * 为什么这么做：AGENTS.md 要求验证 UI 时不要激活应用窗口。这里用 vite 跑渲染层，
 * 由 CDP 注入一个 mock 的 window.harness（act 走内存 fixture），因此不需要主进程、不占用户数据。
 * 断言的是「页面能把画像的四种遗忘状态表达出来」，不是像素级回归。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsOnly = process.argv.includes("--shots-only");
// 端口都随机取：仓库里可能已经有别的 vite / 调试实例在跑，不要跟它抢
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once("error", reject);
  srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const PORT = await freePort();
const CDP_PORT = await freePort();
const OUT = path.join(root, ".preview");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome / Chromium；这个预览需要它（headless 跑渲染层）");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, timeout = 15000, label = "") => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`超时等待${label ? `：${label}` : ""}`);
    await sleep(150);
  }
};

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { return await (await fetch(url)).json(); } catch { await sleep(200); }
  }
  throw new Error(`连不上 ${url}`);
}

// ── mock harness（渲染层唯一依赖） ────────────────────────────────────
const MOCK = String.raw`
(() => {
  const now = Date.now();
  const DAY = 86400000;
  const person = { id: "p1", name: "纸鸢戏", relation: "同事", groupOnly: false, isSelf: false };
  const card = {
    person,
    oneLiner: "决策偏保守，习惯先要数据；说话碎、爱用笑声。",
    oneLinerAt: now - 40 * DAY,
    oneLinerStale: true,
    completeness: 42,
    sections: [
      { id: "basic", title: "基本信息", rows: [
        { field: "role", label: "角色 / 职务", values: ["技术负责人"], support: 4, level: "高",
          heat: 0.8, total: 1, overflow: 0, conflict: null,
          evidence: [{ id: "e1", value: "技术负责人", quote: "现在带技术团队", sourceKind: "chat", at: now - 10 * DAY, confidence: 0.8, evidenceCount: 4, heat: 0.8 }] },
      ]},
      { id: "character", title: "性格与价值观", rows: [
        { field: "traits", label: "性格", values: ["决策偏保守", "在意确定性"], support: 3, level: "中",
          heat: 0.6, total: 2, overflow: 0, conflict: null,
          evidence: [{ id: "e2", value: "决策偏保守", quote: "我还是再想想", sourceKind: "chat", at: now - 30 * DAY, confidence: 0.6, evidenceCount: 2, heat: 0.6 }] },
      ]},
      { id: "behavior", title: "处事方式", rows: [
        { field: "decision", label: "决策依据", values: ["关键决定要上级拍板"], support: 2, level: "中",
          heat: 0.5, total: 1, overflow: 0, conflict: null,
          evidence: [{ id: "e3", value: "关键决定要上级拍板", quote: "等老板定", sourceKind: "chat", at: now - 5 * DAY, confidence: 0.7, evidenceCount: 2, heat: 0.5 }] },
      ]},
      { id: "voice", title: "说话风格", rows: [
        { field: "voice", label: "语气样本", values: ["这个事儿吧，我觉得可以先试试", "行，我来盯一下"], support: 7, level: "高",
          heat: 0.9, total: 5, overflow: 2, conflict: null,
          evidence: [{ id: "e4", value: "语气样本", quote: "这个事儿吧，我觉得可以先试试", sourceKind: "chat", at: now - 2 * DAY, confidence: 0.7, evidenceCount: 5, heat: 0.9 }] },
      ]},
    ],
    network: [{ id: "r1", name: "我", type: "同事", strength: 0.6, at: now - 40 * DAY, groupOnly: false }],
    measures: [
      { key: "msgs.count", field: "traits", label: "发言量", value: "话多：发言量大（样本 1240 条）", num: 1240, prevValue: null, prevNum: null, times: 0, computedAt: now - 2 * DAY, changedAt: now - 2 * DAY },
      { key: "reply.median", field: "communication", label: "接话时延", value: "回复很快：中位时延约 4 分钟", num: 4, prevValue: "回复节奏中等：中位时延约 42 分钟", prevNum: 42, times: 1, computedAt: now - 2 * DAY, changedAt: now - 2 * DAY },
      { key: "chat.ratio", field: "situation", label: "群 / 私聊", value: "群聊 12% / 私聊 88%", num: 12, prevValue: "群聊 0% / 私聊 100%", prevNum: 0, times: 1, computedAt: now - 2 * DAY, changedAt: now - 2 * DAY },
    ],
    needsReview: [
      { id: "o9", field: "event", label: "事件", value: "下周三出差上海", quote: "下周三我去上海出差", reason: "时间到期", expiresAt: now - 3 * DAY, heat: 0.1 },
      { id: "o10", field: "event", label: "事件", value: "月底交周报", quote: "月底要交周报", reason: "时间到期", expiresAt: now - 20 * DAY, heat: 0.05 },
    ],
    metrics: { supportMedian: 2, conflictRatio: 0, needsReview: 2, overflow: 2, measureAt: now - 2 * DAY },
    counts: { confirmed: 9, pending: 1, sensitive: 1, fields: 6, measureFields: 3, total: 13 },
    empty: false,
  };
  const people = [
    { ...person, confirmed: 9, pending: 1, review: 2, completeness: 42, lastAt: now - 2 * DAY, supportMedian: 2, tags: ["待复核", "已建模", "话多"] },
    { id: "p2", name: "小满", relation: "客户", groupOnly: true, isSelf: false, confirmed: 3, pending: 0, review: 0, completeness: 18, lastAt: now - 9 * DAY, supportMedian: 1, tags: ["群聊为主"] },
  ];
  const state = {
    projects: [], agents: [], hosts: [], threads: [], todos: [], runs: [], messages: [],
    artifacts: [], events: [], approvals: [], terminals: [], runtimes: [], scenes: [], coordinationScenes: [],
    missionPlans: [], delegations: [], plugins: [], pluginCommands: [], todoLinks: [],
    context: { selection: null, elements: [], notes: [] },
    summary: { activeRuns: 0, cost: 0, tokens: 0, failures: 0 },
    workspacePath: "/tmp/ws", projectPath: "/tmp/ws", projectId: "p", activeProjectId: null,
    cliCapabilities: [], executors: [],
    settings: { theme: "light", notesEnabled: true },
  };
  const calls = [];
  let emit = () => {};
  const api = {
    getState: async () => state,
    onState: (cb) => { emit = cb; setTimeout(() => cb(state), 0); return () => {}; },
    action: async (type, payload) => {
      calls.push({ type, payload });
      let result = {};
      if (type === "personaStats") result = { people: 2, pending: 1, confirmed: 12, stale: 2, measures: 3, relations: 1, imports: 3 };
      else if (type === "personaPeople") result = people;
      else if (type === "personaPending") result = [
        { id: "o1", personId: "p1", person: "纸鸢戏", field: "decision", value: "关键决定要上级拍板", quote: "这事我得等老板拍板才行", sourceKind: "chat", sourceRef: "c1", sensitive: false, createdAt: now - DAY, evidenceCount: 3, reviewAt: now - 1000, evidenceStat: false, quoteVerified: true },
        { id: "o2", personId: "p1", person: "纸鸢戏", field: "communication", value: "问句较多", quote: "问句 19%", sourceKind: "llm", sourceRef: "c2", sensitive: false, createdAt: now - 2 * DAY, evidenceCount: 1, evidenceStat: true },
      ];
      else if (type === "personaCard") result = card;
      else if (type === "personaDrift") result = [
        { kind: "drift", field: "role", label: "角色 / 职务", from: "产品经理", to: "技术负责人", at: now - 10 * DAY },
        { kind: "conflict", field: "goal", label: "目标 / 动机", value: "转管理", note: "与「做技术」同时成立", at: now - 3 * DAY },
        { kind: "trend", field: "communication", label: "接话时延", from: "回复节奏中等：中位时延约 42 分钟", to: "回复很快：中位时延约 4 分钟", at: now - 2 * DAY, times: 1 },
      ];
      else if (type === "personaInject") result = { markdown: "## 纸鸢戏（同事）\n- 一句话：决策偏保守，习惯先要数据。\n### 处事方式\n- 决策依据：关键决定要上级拍板", chars: 96, budget: 6000, dropped: 1 };
      else if (type === "personaMergeSuggestions") result = [
        { field: "voice", label: "语气样本", personId: "p1", person: "纸鸢戏", keep: { id: "e4", value: "这个事儿吧，我觉得可以先试试", evidence: 5 }, drop: { id: "e5", value: "这个事儿吧，我觉得可以先试一试", evidence: 1 }, score: 0.78 },
      ];
      else if (type === "personaSweep") result = { expired: 0, revived: 0 };
      window.__state = state;
      window.__emit = (next) => emit(next);
      return { ok: true, result };
    },
    onPluginChatDraft: () => () => {}, onPluginNotify: () => () => {}, onPluginOpenView: () => () => {},
    onTerminalAdopt: () => () => {}, onQuickCapture: () => () => {},
    onTerminalData: () => () => {}, onTerminalUrl: () => () => {}, onTerminalExit: () => () => {},
    onQuickCaptureSubmit: () => () => {},
  };
  const proxy = new Proxy(api, {
    get: (t, key) => (key in t ? t[key] : (typeof key === "string" ? async () => ({}) : undefined)),
  });
  window.harness = proxy;
  window.__calls = calls;
})();
`;

// ── 进程管理 ────────────────────────────────────────────────────────
const children = [];
const cleanup = () => { for (const c of children) { try { c.kill("SIGTERM"); } catch { /* ignore */ } } };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

function start(cmd, args, env = {}) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

const vite = start(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1", "--logLevel", "error"]);
vite.on("exit", (code) => { if (code && code !== 0 && !shotsOnly) console.error(`vite 退出：${code}`); });
await wait(async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { return false; }
}, 30000, "vite");

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "persona-preview-"));
const chrome = start(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", "--window-size=1600,1000", "about:blank",
]);
void chrome;
const target = await wait(async () => {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    return list.find((t) => t.type === "page");
  } catch { return null; }
}, 30000, "chrome");

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "exception");
  }
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(msg.error.message)); else resolve(msg);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (code) => {
  const res = await send("Runtime.evaluate", { expression: `(async()=>{ ${code} })()`, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
  return res.result?.result?.value;
};
const ev = (expr) => run(`return (${expr});`);
const shot = async (file) => {
  const res = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(res.result.data, "base64"));
  return file;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
// mock 必须在页面脚本之前注入，否则 App 挂载时 window.harness 还不存在
await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });

if (process.argv.includes("--debug")) {
  await sleep(3000);
  for (const expr of ["location.href", "document.readyState", "!!window.harness", "!!!window.__calls", "document.querySelector('#root')?.innerHTML.length", "document.body.innerHTML.slice(0,300)"]) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    console.log(`debug ${expr} =>`, JSON.stringify(r.result?.result?.value), r.result?.exceptionDetails ? "EXC" : "");
  }
  console.log("console:", consoleErrors.slice(0, 3));
  ws.close(); cleanup(); process.exit(0);
}

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  await wait(async () => (await ev(`!!document.querySelector(".rail-btn")`)), 20000, "应用挂载");
} catch (err) {
  const body = await ev(`document.body.innerHTML.slice(0, 400)`);
  console.error(`\n挂载失败：${err.message}`);
  console.error(`body: ${body}`);
  console.error(`console errors:\n${consoleErrors.slice(0, 5).join("\n")}`);
  cleanup();
  process.exit(1);
}

/** 打开人物页 */
const openPersona = async () => {
  await run(`
    const btn = [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("人物"));
    if (!btn) throw new Error("没有「人物」入口");
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let t0 = Date.now();
    while (Date.now() - t0 < 8000 && !document.querySelector(".persona-card .persona-sec")) await new Promise((r) => setTimeout(r, 80));
    return !!document.querySelector(".persona-sec");`);
};
await openPersona();

const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent || "")`);
const all = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => el.textContent.trim())`);

console.log("人物页渲染层预览（headless，无 Electron 窗口）\n");

check("人物卡渲染", (await text(".persona-card")).includes("纸鸢戏"));
check("头部显示证据中位数", (await text(".persona-head p")).includes("证据中位 2"));
check("头部显示待复核数", (await text(".persona-head p")).includes("2 条待复核"));

const sections = await all(".persona-sec-head h3");
check("分节渲染（基本信息/性格/处事/说话风格）", ["基本信息", "性格与价值观", "处事方式", "说话风格"].every((s) => sections.includes(s)), sections.join(" / "));
check("超出检索上限时如实说「另有 N 条较早」", (await text(".persona-card")).includes("另有 2 条较早"));

const measures = await ev(`([...document.querySelectorAll(".persona-sec")].find((s) => s.querySelector("h3")?.textContent === "可观测特征")?.textContent || "")`);
check("可观测特征独立成节", measures.includes("说话风格") === false && measures.includes("发言量"), measures.slice(0, 60));
check("测量值带上次值（趋势）", measures.includes("上次：回复节奏中等") || measures.includes("上次：群聊 0%"));
check("测量值标注重算时间", measures.includes("重算于"));

const side = await text(".persona-col.side");
check("右栏有「衰减与复核」", side.includes("衰减与复核"));
check("头部说清可观测撑着几个字段", (await text(".persona-head p")).includes("+3 项可观测"));
check("一句话写完后又有新结论时提示重写", (await text(".persona-oneline")).includes("之后又有新结论"));
check("变化视图里「特征变化」不跟「矛盾」混", (await text(".persona-drift")) .includes("特征变化"));
check("有批量复核入口", side.includes("全部仍然成立"));
check("复核项显示原因与到期时间", side.includes("时间到期") && side.includes("仍然成立"));
check("复核项有两个动作（仍然成立 / 已过期）", (await all(".persona-qitem .btn")).some((t) => t.includes("仍然成立")) && (await all(".persona-qitem .btn")).some((t) => t.includes("已过期")));
check("右栏有「近似说法」合并建议", side.includes("近似说法") && side.includes("相似 78%"));
check("回看支持两种口径", side.includes("事件时间") && side.includes("当时已知"));
check("待确认项标出「已见 N 次 / 复审」", side.includes("已见 3 次") && side.includes("复审"));
check("证据是统计值的结论有单独提示", side.includes("证据」其实是统计值"));
check("批量动作收在一行「证据质量」里", side.includes("证据质量：") && side.includes("拒绝统计值"));
check("引用核过的给「只确认核过的」入口", side.includes("只确认核过的") && side.includes("引用可核对"));
check("提供拒绝统计值的批量入口", side.includes("拒绝统计值"));

// 交互：合并按钮必须真的调用后端动作
await run(`
  const item = [...document.querySelectorAll(".persona-qitem")].find((el) => el.textContent.includes("近似说法") || el.textContent.includes("78%"));
  const btn = [...(item?.querySelectorAll("button") || [])].find((b) => b.textContent.trim() === "合并");
  if (!btn) throw new Error("找不到合并按钮");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return true;`);
const merged = await ev(`(window.__calls || []).some((c) => c.type === "personaMergeApply")`);
check("点「合并」调用 personaMergeApply", merged);

// 复核交互
await run(`
  const item = [...document.querySelectorAll(".persona-qitem")].find((el) => [...el.querySelectorAll("button")].some((b) => b.textContent.trim() === "仍然成立"));
  const btn = [...item.querySelectorAll("button")].find((b) => b.textContent.trim() === "仍然成立");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return true;`);
const kept = await ev(`(window.__calls || []).some((c) => c.type === "personaReviewResolve" && c.payload?.keep === true)`);
check("点「仍然成立」调用 personaReviewResolve(keep)", kept);

await run(`
  const btn = [...document.querySelectorAll(".persona-block-title .link")].find((b) => b.textContent.trim() === "全部仍然成立");
  if (!btn) throw new Error("找不到批量复核按钮");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return true;`);
check("批量复核调用 personaReviewMany(keep)", await ev(`(window.__calls || []).some((c) => c.type === "personaReviewMany" && c.payload?.keep === true)`));

// 人物合并：多选 ≥2 人时出现，保留第一个点选的人
await run(`
  const chip = [...document.querySelectorAll(".list-chip")].find((b) => b.textContent.trim() === "多选");
  chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const rows = [...document.querySelectorAll(".persona-row")];
  rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return rows.length;`);
const mergeLabel = await ev(`([...document.querySelectorAll(".bulk-float .btn")].map((b) => b.textContent.trim()).find((t) => t.startsWith("合并到")) || "")`);
check("多选后出现人物合并入口，并写明保留谁", mergeLabel.includes("纸鸢戏"), mergeLabel);
await run(`
  window.confirm = () => true;
  const btn = [...document.querySelectorAll(".bulk-float .btn")].find((b) => b.textContent.trim().startsWith("合并到"));
  btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return true;`);
await run(`
  window.confirm = () => true;
  const btn = [...document.querySelectorAll(".persona-batch .link")].find((b) => b.textContent.trim() === "只确认核过的");
  if (!btn) throw new Error("找不到「只确认核过的」");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return true;`);
check("「只确认核过的」只确认引用核过的", await ev(`(window.__calls || []).filter((c) => c.type === "personaResolve" && c.payload?.accept === true).every((c) => c.payload?.id === "o1")`));
const mergedPeople = await ev(`(window.__calls || []).find((c) => c.type === "personaMerge")?.payload`);
check("合并调用 personaMerge(keepId, aliasIds)", Boolean(mergedPeople?.keepId) && (mergedPeople?.aliasIds || []).length === 1, JSON.stringify(mergedPeople));

// 平台内文档：新建的 wiki 页要能在「说明」里读到（内容来自 resources/wiki/persona.md）
await run(`
  const btn = [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("说明"));
  btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  let t0 = Date.now();
  while (Date.now() - t0 < 8000 && !document.querySelector(".guide-wiki")) await new Promise((r) => setTimeout(r, 80));
  return !!document.querySelector(".guide-wiki");`);
const guideText = await text(".guide-wiki");
check("「说明」里有「人物画像与记忆语义」页", guideText.includes("人物画像与记忆语义"), guideText.slice(0, 40));
await run(`
  const item = [...document.querySelectorAll(".guide-wiki a, .guide-wiki button")].find((el) => el.textContent.trim().startsWith("人物画像"));
  item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  return true;`);
const guideBody = await text(".guide-wiki");
check("页面内容渲染出四种「忘」", guideBody.includes("失效 invalidate") && guideBody.includes("到期 stale"), guideBody.slice(0, 40));

// 截图前回到人物页（截图的主体是画像，不是文档）
await openPersona();

// 亮色 / 暗色都看一遍（只截暗色等于没检查亮色）
fs.mkdirSync(OUT, { recursive: true });
const setTheme = async (theme) => {
  await run(`window.__emit({ ...window.__state, settings: { ...window.__state.settings, theme: "${theme}" } }); return true;`);
  await sleep(700);
  return ev(`document.documentElement.dataset.mode`);
};
check("亮色模式", (await setTheme("light")) === "light");
const light = await shot(path.join(OUT, "persona-light.png"));
check("暗色可切换", (await setTheme("dark")) === "dark", "dark");
const darkFile = await shot(path.join(OUT, "persona-dark.png"));

check("没有 console error / 未捕获异常", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

// 文档页单独留一张：它现在是平台的一部分
await run(`
  const btn = [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("说明"));
  btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  let t0 = Date.now();
  while (Date.now() - t0 < 6000 && !document.querySelector(".guide-wiki")) await new Promise((r) => setTimeout(r, 80));
  const item = [...document.querySelectorAll(".guide-wiki a, .guide-wiki button")].find((el) => el.textContent.trim().startsWith("人物画像"));
  item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));
  return true;`);
const wikiShot = await shot(path.join(OUT, "persona-wiki.png"));

console.log(`\n截图：${path.relative(root, light)} / ${path.relative(root, darkFile)} / ${path.relative(root, wikiShot)}`);
console.log(fails === 0 ? "预览验证通过" : `${fails} 项失败`);

ws.close();
cleanup();
try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Chrome 还在退，留着无妨 */ }
process.exit(fails === 0 ? 0 : 1);
