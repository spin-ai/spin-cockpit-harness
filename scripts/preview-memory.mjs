#!/usr/bin/env node
/**
 * 记忆页渲染层预览（无 Electron 窗口、不抢焦点）。
 *
 *   node scripts/preview-memory.mjs           # 起 vite + headless Chrome，跑断言并截图
 *   node scripts/preview-memory.mjs --shots-only
 *
 * 和 `preview-persona.mjs` 同一套做法：vite 跑渲染层，CDP 注入 mock 的 window.harness，
 * 不需要主进程、不占用户数据。断言的是「记忆页把四种遗忘状态和注入台账表达清楚了」，
 * 不是像素级回归；两侧主题都截一张，只截暗色等于没检查亮色。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsOnly = process.argv.includes("--shots-only");
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

// ── mock harness：记忆页 fixture ─────────────────────────────────────
const MOCK = String.raw`
(() => {
  const now = Date.now();
  const DAY = 86400000;
  const notes = [
    { id: "n1", body: "提交前必须跑 typecheck 和 build", kind: "rule", confidence: 0.9,
      sourceKind: "transcript", sourceRef: "m41", status: "new", expiresAt: 0, expired: false, createdAt: now - 2 * DAY },
    { id: "n2", body: "这个仓库可能用的是 pnpm", kind: "guess", confidence: 0.4,
      sourceKind: "transcript", sourceRef: "m42", status: "new", expiresAt: now - DAY, expired: true, createdAt: now - 20 * DAY },
    { id: "n3", body: "灰度发布前先跑一遍 e2e", kind: "gotcha", confidence: 0.6,
      sourceKind: "run", sourceRef: "r9", status: "new", expiresAt: now + 170 * DAY, expired: false, createdAt: now - DAY },
  ];
  const e = (over) => ({ id: "", layer: "L4", title: "", body: "", sourceRefs: [], status: "active",
    pinned: false, invalidAt: 0, supersededBy: "", supersedes: [], updatedAt: now - DAY, ...over });
  const entries = [
    e({ id: "m1", title: "注入预算只有 meta.injectBudget 一个来源", body: "不要再在调用处写死 6000 / 12000",
      sourceRefs: ["note:m41"], pinned: true }),
    e({ id: "m2", title: "记忆失效用 invalid_at，不删除", body: "旧结论标失效，as_of 仍可回看",
      sourceRefs: ["note:m42"], supersedes: ["m9"] }),
    e({ id: "m3", layer: "L3", title: "进行中的重构：注入改成打分", body: "按分数自然截止" }),
  ];
  const archived = [
    e({ id: "m9", title: "包管理器用 pnpm", body: "pnpm 更快", sourceRefs: [], invalidAt: now - 3 * DAY,
      supersededBy: "m2", updatedAt: now - 3 * DAY }),
    e({ id: "m10", title: "旧的注入规则：按 sort_order 排序", body: "", status: "archived", updatedAt: now - 9 * DAY }),
  ];
  const sugs = [
    { id: "s1", action: "merge", title: "合并观察（模型）：依赖用 pnpm 安装", detail: "两条说的是同一件事（词重合 92%）", targetKind: "note", targetId: "n1", status: "pending" },
    { id: "s2", action: "correct", title: "复核观察（依据已被推翻）：包管理器用 pnpm", detail: "它支撑的结论已失效，建议重新确认", targetKind: "note", targetId: "n2", status: "pending" },
    { id: "s3", action: "promote", title: "晋升观察：部署走 install-mac.mjs", detail: "已验证的观察可以并入页面或 L4 结论", targetKind: "note", targetId: "n3", status: "pending" },
    { id: "s4", action: "rewrite", title: "改写观察（模型）：提交前跑 typecheck → 提交前必须过 typecheck 与 build",
      detail: "去掉口语填充词，意思不变\n\n原句：「提交前必须跑 typecheck 和 build」", targetKind: "note", targetId: "n1",
      payload: { body: "提交前必须过 typecheck 与 build", kind: "rule" }, status: "pending" },
  ];
  const inject = {
    markdown: "## 记忆（L4 目录 / 结论）\n- 注入预算只有一个来源\n\n## 未验证观察\n- 提交前必须跑 typecheck",
    chars: 1840, budget: 12000, dropped: 1, version: 42,
    items: [
      { id: "m1", layer: "L4", title: "注入预算只有 meta.injectBudget 一个来源", chars: 60, included: true, reason: "score 95.0 · 已置顶 · 按分数自然截止", score: 95 },
      { id: "n1", layer: "note", title: "提交前必须跑 typecheck 和 build", chars: 40, included: true, reason: "已验证观察 · score 31.0", score: 31 },
      { id: "m8", layer: "L4", title: "排在最后的旧结论", chars: 150, included: false, reason: "超出预算（条目可用 10000 字符，已用 9980；按 score 12.0 排序）", score: 12 },
    ],
  };
  const injectStats = { runs: 6, injected: 42, cited: 15, hitRate: 0.36, avgChars: 8100, version: 42, recent: [] };
  const dream = { enabled: true, maxSuggestions: 40, dayLimit: 200, llmPass: true, llmBatch: 60, llmDailyCalls: 20,
    budget: { day: "2026-11-15", used: 7, limit: 200 }, modelBudget: { day: "2026-11-15", used: 2, tokens: 4210, limit: 20 } };
  const overview = { byLayer: { L1: 0, L2: 1, L3: 1, L4: 2 }, notes: 3, notesPending: 3, notesExpired: 1,
    suggestions: 3, invalidated: 1, injectable: 1840, version: 42 };
  const state = {
    projects: [], agents: [], hosts: [], threads: [], todos: [], runs: [], messages: [],
    artifacts: [], events: [], approvals: [], terminals: [], runtimes: [], scenes: [], coordinationScenes: [],
    missionPlans: [], delegations: [], plugins: [], pluginCommands: [], todoLinks: [],
    context: { selection: null, elements: [], notes: [] },
    summary: { activeRuns: 0, cost: 0, tokens: 0, failures: 0 },
    workspacePath: "/tmp/ws", projectPath: "/tmp/ws", projectId: "p", activeProjectId: null,
    cliCapabilities: [], executors: [], settings: { theme: "light", notesEnabled: true },
  };
  const calls = [];
  let emit = () => {};
  const api = {
    getState: async () => state,
    onState: (cb) => { emit = cb; setTimeout(() => cb(state), 0); return () => {}; },
    action: async (type, payload) => {
      calls.push({ type, payload });
      let result = {};
      if (type === "memoryOverview") result = overview;
      else if (type === "memoryEntryList") result = entries.filter((x) => x.layer === payload?.layer && x.status === "active" && !x.invalidAt);
      else if (type === "memoryEntryArchived") result = archived;
      else if (type === "memoryNoteList") result = notes;
      else if (type === "memorySuggestions") result = sugs;
      else if (type === "memoryInject") result = inject;
      else if (type === "memoryInjectStats") result = injectStats;
      else if (type === "memoryDreamStatus") result = dream;
      else if (type === "memoryDreamConfig") result = { ...dream, ...(payload?.patch || {}) };
      else if (type === "memoryEntrySources") result = ["note:m41", "run:r9"];
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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-preview-"));
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
  for (const expr of ["location.href", "!!window.harness", "document.querySelector('#root')?.innerHTML.length", "document.body.innerHTML.slice(0,300)"]) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    console.log(`debug ${expr} =>`, JSON.stringify(r.result?.result?.value));
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
  await wait(async () => (await ev(`!!document.querySelector(".rail-btn")`)), 40000, "应用挂载");
} catch (err) {
  const body = await ev(`document.body.innerHTML.slice(0, 400)`);
  console.error(`\n挂载失败：${err.message}`);
  console.error(`body: ${body}`);
  console.error(`console errors:\n${consoleErrors.slice(0, 5).join("\n")}`);
  cleanup();
  process.exit(1);
}

/** 打开记忆页 */
await run(`
  const btn = [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("记忆"));
  if (!btn) throw new Error("没有「记忆」入口");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  let t0 = Date.now();
  while (Date.now() - t0 < 8000 && !document.querySelector(".pr-entries")) await new Promise((r) => setTimeout(r, 80));
  return true;`);

const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent || "")`);
const all = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => el.textContent.trim())`);
const clickText = (sel, needle) => run(`
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(needle)}));
  if (!el) throw new Error("找不到 " + ${JSON.stringify(needle)});
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);

console.log("记忆页渲染层预览（headless，无 Electron 窗口）\n");

// ── 层级与条目 ────────────────────────────────────────────────
check("层级计数按层显示", (await all(".pr-layer-name")).some((t) => t.includes("结论") && t.includes("2")), (await all(".pr-layer-name")).join(" / ").slice(0, 60));
check("条目列表渲染", (await text(".pr-entries")).includes("注入预算只有 meta.injectBudget"));
check("置顶条目标「置顶」", (await all(".pr-entry .chip")).includes("置顶"));

// ── 观察（note）：类型 / 存活期 / 已过期 ───────────────────────
const qitems = (await all(".pr-qitem")).join(" | ");
check("观察显示种类标签（规则 / 踩坑）", qitems.includes("规则") && qitems.includes("踩坑"), qitems.slice(0, 40));
check("过期观察标「已过期」并说明不注入", qitems.includes("已过期") && qitems.includes("已到期"));
check("未过期观察显示剩余寿命（短形式，完整日期在 title）", qitems.includes("至 ") && qitems.includes("已到期"));

// ── Dream：merge / correct 标签 + 两笔预算 ─────────────────────
await clickText(".kv-tabs button", "Dream");
// 复核块是右栏第一块：按内容找，别用 .pr-block（左边层级块也是这个 class）
const dreamText = await ev(`([...document.querySelectorAll(".pr-block")].find((b) => b.textContent.includes("复核"))?.textContent || "")`);
check("Dream 建议出现「合并」与「校正」", dreamText.includes("合并") && dreamText.includes("校正"));
check("建议正文说清依据", dreamText.includes("词重合") && dreamText.includes("结论已失效"));
check("改写建议出现「改写」标签与「拟改为」", dreamText.includes("改写") && dreamText.includes("拟改为") && dreamText.includes("提交前必须过 typecheck 与 build"));
check("语义 pass 开关是勾上的", (await ev(`
  [...document.querySelectorAll(".pr-dreamcfg label")].find((l) => l.textContent.includes("语义 pass"))?.querySelector("input")?.checked ?? null`)) === true);
check("显示当日建议预算", dreamText.includes("今日 7 / 200"), dreamText.match(/今日 \d+ \/ \d+/)?.[0]);
check("显示当日模型调用预算", dreamText.includes("模型 2 / 20"), dreamText.match(/模型 \d+ \/ \d+/)?.[0]);

// ── 注入预览：note 单独一块、命中率、被裁原因可展开 ────────────
const injText = await text(".pr-side");
check("注入预览计入 note 条目", injText.includes("观察"));
check("注入预览显示命中率", injText.includes("36%") && injText.includes("最近 6 轮"), injText.match(/最近 \d+ 轮[^·]*/)?.[0]);
await run(`
  const item = [...document.querySelectorAll(".pr-inj-item")].find((b) => b.textContent.includes("观察"));
  item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
check("点条目能看到分数与被裁原因", (await text(".pr-inj-reason")).includes("score"));
check("被裁条目标「被裁」", (await all(".pr-inj")).some((t) => t.includes("被裁")));

// ── 失效条目：和「归档」分开表达 ──────────────────────────────
await clickText(".pr-layer", "已过期 / 归档");
const arch = await text(".pr-entries");
check("归档视图列出失效条目", arch.includes("包管理器用 pnpm"));
check("失效条目说明「有新结论取代」", arch.includes("已失效") && arch.includes("有新结论取代"));

// ── 行内低频操作：标记失效（保留溯源）─────────────────────────
await run(`
  const trigger = document.querySelector(".pr-entry .row-menu-trigger");
  if (!trigger) throw new Error("没有条目菜单");
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
await clickText(".row-menu-pop button", "标记失效（保留溯源）");
const invalidated = await ev(`(window.__calls || []).find((c) => c.type === "memoryEntryInvalidate")?.payload`);
check("点「标记失效」调用 memoryEntryInvalidate", Boolean(invalidated?.id), JSON.stringify(invalidated));

// ── 亮色 / 暗色都看一遍 ─────────────────────────────────────────
// 上面的交互会在页面上留 toast / undo 条，截图前先重载一次拿干净状态
await send("Page.reload", { ignoreCache: false });
await wait(async () => (await ev(`!!document.querySelector(".rail-btn")`)), 40000, "重载");
await run(`
  const btn = [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("记忆"));
  btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  let t0 = Date.now();
  while (Date.now() - t0 < 8000 && !document.querySelector(".pr-entries")) await new Promise((r) => setTimeout(r, 80));
  return true;`);
fs.mkdirSync(OUT, { recursive: true });
const setTheme = async (theme) => {
  await run(`window.__emit({ ...window.__state, settings: { ...window.__state.settings, theme: "${theme}" } }); return true;`);
  await sleep(700);
  return ev(`document.documentElement.dataset.mode`);
};
check("亮色模式", (await setTheme("light")) === "light");
const lightShot = await shot(path.join(OUT, "memory-light.png"));
check("暗色可切换", (await setTheme("dark")) === "dark", "dark");
const darkShot = await shot(path.join(OUT, "memory-dark.png"));
// 再截一张 Dream 建议页（合并 / 校正 / 两笔预算都在右栏）
await setTheme("light");
await clickText(".kv-tabs button", "Dream");
const dreamShot = await shot(path.join(OUT, "memory-dream-light.png"));
await setTheme("dark");

check("没有 console error / 未捕获异常", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

console.log(`\n截图：${[lightShot, darkShot, dreamShot].map((f) => path.relative(root, f)).join(" / ")}`);
console.log(fails === 0 ? "预览验证通过" : `${fails} 项失败`);

ws.close();
cleanup();
try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Chrome 还在退，留着无妨 */ }
process.exit(fails === 0 ? 0 : 1);
