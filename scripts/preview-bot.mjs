#!/usr/bin/env node
/**
 * 机器人会话页渲染层预览（无 Electron 窗口、不抢焦点）。
 *
 *   node scripts/preview-bot.mjs
 *
 * 为什么这么做：AGENTS.md 要求验证 UI 时不要激活应用窗口。这里用 vite 跑渲染层，
 * 由 CDP 注入 mock 的 window.harness（act 走内存 fixture），因此不需要主进程、不占用户数据。
 * 断言的是「照搬 ORCA 的 Chats 结构」有没有真的渲染出来、点了有没有调对后端动作，不是像素级回归。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

// ── mock harness ────────────────────────────────────────────────────
const MOCK = String.raw`
(() => {
  const now = Date.now();
  const HOUR = 3600000;
  const bot = {
    id: "b1", name: "PM · 项目经理", avatar: "🧭", avatarClass: "a",
    persona: { mission: "盯住发布节奏", duty: { goal: "按时发布", scope: "首页", deliverable: "周报", forbidden: "不改代码", report: "一句话" } },
    capability: "work", role: "supervisor", executorAgentId: "a1", channels: ["local"],
    policy: { maxTurnsPerHour: 6, minGapMs: 120000, quietHours: [23, 8], whoCanAsk: "group" },
    budget: { tokensPerTurn: 700, tokensPerHour: 6000 }, status: "active", mutedUntil: 0, createdAt: now - 9e8, updatedAt: now,
  };
  const bot2 = { ...bot, id: "b2", name: "DE-A · 前端", avatar: "🛠", avatarClass: "b", role: "worker", capability: "read" };
  const chats = [
    { id: "th-bot-b1", title: "发布节奏", createdAt: now - 7200000, updatedAt: now - 600000, count: 4,
      last: "首页标题已经改大，测试过了，等你确认。", lastAt: now - 600000 },
    { id: "th-bot-b1-2", title: "换个说法重开", createdAt: now - 3600000, updatedAt: now - 1800000, count: 1,
      last: "这个话题还没开始", lastAt: now - 1800000 },
  ];
  const turn = (patch) => ({ id: "t" + Math.random().toString(36).slice(2, 8), botId: "b1", channel: "local", createdAt: now - 600000, ...patch });
  const turns = [
    turn({ id: "t1", decision: "replied", input: "发布节奏怎么样？", threadId: "th-bot-b1",
      reply: "今天两条：\n\n- 首页标题已改大\n- 构建通过\n\n\`\`\`bash\nnpm test\n\`\`\`",
      injected: [{ layer: "L4", id: "m1", title: "发布节奏" }], cost: { tokens: 320, ms: 1200 },
      trace: [
        { kind: "request", round: 0, at: now - 700000, ms: 820, usage: { total_tokens: 180, prompt_tokens: 120, completion_tokens: 60 }, text: "先查一下发布节奏。" },
        { kind: "tool", name: "knowledge_search", argsRaw: "{\"query\":\"发布节奏\",\"limit\":5}", result: "{\"hits\":[{\"title\":\"发布节奏\"},{\"title\":\"构建通过\"}]}", ms: 240, at: now - 699000, ok: true },
        { kind: "request", round: 1, at: now - 698000, ms: 600, usage: { total_tokens: 140, prompt_tokens: 80, completion_tokens: 60 }, text: "今天两条：\n\n- 首页标题已改大\n- 构建通过" },
      ] }),
    turn({ id: "t2", decision: "reported", threadId: "th-bot-b1", runId: "r1", todoId: "td1",
      reply: "FEAT-1 完成：首页标题改大\n测试通过，等你确认。", cost: { tokens: 120, ms: 800 } }),
    turn({ id: "t3", decision: "silent", threadId: "th-bot-b1", reason: "没有值得说的事件", cost: {} }),
    turn({ id: "t4", decision: "asked", threadId: "th-bot-b1", reply: "要我顺便把副标题也改了吗？", ask: { text: "副标题要不要一起改？", status: "open", createdAt: now - 300000 } }),
  ];
  const state = {
    projects: [{ id: "p", name: "演示项目", path: "/tmp/ws", branch: "main", createdAt: now }], agents: [{ id: "a1", name: "pi", alias: "pi", cli: "pi", role: "worker", hostId: "h1" }],
    hosts: [{ id: "h1", name: "本机", kind: "local", status: "online" }],
    threads: [{ id: "th-td1", todoId: "td1", title: "FEAT-1", projectId: null, project: "", agentId: "a1", kind: "chat", createdAt: now - 9e5, updatedAt: now - 6e5 }],
    todos: [{ id: "td1", key: "FEAT-1", title: "首页标题改大", status: "in_review", missionState: null, agentId: "a1", projectId: "p", cwd: "/tmp/ws", confirmed: false, createdAt: now - 9e5, updatedAt: now - 6e5 }],
    runs: [{ id: "r1", todoId: "td1", status: "done", terminalId: "term1", cwd: "/tmp/ws" }],
    messages: [{ id: "m1", threadId: "th-td1", runId: "r1", role: "agent", kind: "tool", content: "run: npm test", createdAt: now - 7e5 }],
    artifacts: [{ id: "art1", todoId: "td1", runId: "r1", kind: "file", title: "src/App.tsx", origin: "agent", ref: "src/App.tsx", deepLink: "", createdAt: now - 6.5e5 }],
    events: [], approvals: [], terminals: [], runtimes: [], scenes: [], coordinationScenes: [],
    missionPlans: [], delegations: [], plugins: [{ id: "notes", version: "1.0.0", path: "/x", enabled: true, builtin: true, manifest: { name: "笔记" }, permissions: [], installedAt: now, lastError: null, lastRunAt: null }],
    pluginCommands: [], todoLinks: [],
    bots: [bot, bot2], botTurns: turns, routines: [{ id: "rt1", botId: "b1", name: "早报", kind: "daily", atHour: 9 }],
    botGroups: [], botGroupMessages: [],
    context: { selection: null, elements: [], notes: [] },
    summary: { activeRuns: 0, cost: 0, tokens: 0, failures: 0 },
    workspacePath: "/tmp/ws", projectPath: "/tmp/ws", projectId: "p", activeProjectId: "p",
    cliCapabilities: [], executors: [], settings: { theme: "light", notesEnabled: true },
  };
  const snapshot = {
    bots: [bot, bot2],
    agents: [{ id: "a1", name: "pi", alias: "pi", cli: "pi", role: "worker" }],
    turns,
    routines: state.routines,
    routineStatus: [{ id: "rt1", botId: "b1", name: "早报", kind: "daily", atHour: 9, enabled: true, mode: "alongside", due: true, nextAt: now - 60000, lastError: "上次没跑成：模型没返回" }],
    asks: [{ turnId: "t4", botId: "b1", text: "副标题要不要一起改？", createdAt: now - 300000 }],
    botThreads: { b1: "th-bot-b1", b2: "th-bot-b2" },
    botChats: { b1: chats, b2: [] },
    recent: { answeredHour: 2, blockedHour: 0, silentHour: 1 },
    tasks: [{ id: "td1", key: "FEAT-1", title: "首页标题改大", status: "in_review", missionState: null, agentId: "a1" }],
    recentTodos: [{ id: "td1", key: "FEAT-1", title: "首页标题改大", status: "in_review", missionState: null }],
  };
  const calls = [];
  let emit = () => {};
  const api = {
    getState: async () => state,
    onState: (cb) => { emit = cb; setTimeout(() => cb(state), 0); return () => {}; },
    action: async (type, payload) => {
      calls.push({ type, payload });
      let result = {};
      if (type === "botSnapshot") result = snapshot;
      else if (type === "memoryOverview") result = { byLayer: { L4: 2, L3: 3, L2: 5, L1: 9 }, notes: 1, injectable: 2400 };
      else if (type === "botChats") result = { chats, hits: [] };
      else if (type === "botChatNew") result = { id: "th-bot-b1-3", title: "新话题" };
      else if (type === "botChatFork") result = { thread: { id: "th-bot-b1-fork" }, copied: 2 };
      else if (type === "botChat") result = { ok: true, result: turns[0] };
      return { ok: true, result };
    },
    docsPick: async () => [{ path: "/tmp/ws/README.md", name: "README.md", text: "# 标题\n正文", size: 20 }],
    docsRead: async () => [{ path: "/tmp/ws/README.md", name: "README.md", text: "# 标题\n正文" }],
    clipboardRead: async () => "",
    clipboardWrite: async () => {},
    onBotDelta: () => () => {}, onBotTool: () => () => {}, onBotMessage: () => () => {},
    onState: (cb) => { emit = cb; setTimeout(() => cb(state), 0); return () => {}; },
    onPluginChatDraft: () => () => {}, onPluginNotify: () => () => {}, onPluginOpenView: () => () => {},
    onTerminalAdopt: () => () => {}, onQuickCapture: () => () => {},
    onTerminalData: () => () => {}, onTerminalUrl: () => () => {}, onTerminalExit: () => () => {},
    onQuickCaptureSubmit: () => () => {}, onImPaired: () => () => {},
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
await wait(async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { return false; }
}, 30000, "vite");

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-preview-"));
start(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", "--window-size=1600,1000", "about:blank",
]);
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
await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  await wait(async () => (await ev(`!!document.querySelector(".rail-btn")`)), 20000, "应用挂载");
} catch (err) {
  console.error(`\n挂载失败：${err.message}`);
  console.error(await ev(`document.body.innerHTML.slice(0, 400)`));
  console.error(consoleErrors.slice(0, 5).join("\n"));
  cleanup();
  process.exit(1);
}

/** 机器人配置页 → 打开 b1 的会话 */
const openBot = async () => {
  await run(`
    const btns = [...document.querySelectorAll(".rail-btn")];
    const btn = btns.find((b) => /BOT|机器人/i.test(b.textContent));
    if (!btn) throw new Error("没有「机器人」入口：" + btns.map((b) => b.textContent.trim()).join("|"));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let t0 = Date.now();
    // 直接进的是控制台；如果落在配置页，就点「打开会话」
    while (Date.now() - t0 < 8000 && !document.querySelector(".bot-chats")) {
      const open = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "打开会话");
      if (open) open.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
    }
    return !!document.querySelector(".bot-chats");`);
};
await openBot();
await shot(path.join(OUT, "bot-chats.png"));

const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent || "")`);
const all = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => el.textContent.trim())`);

console.log("机器人会话页渲染层预览（headless，无 Electron 窗口）\n");

const rows = await all(".bot-chat-row-main b");
check("Chats：一条会话一行（标题）", rows.includes("发布节奏") && rows.length === 2, rows.join(" / "));
check("Chats：显示每个会话的最后一句", (await text(".bot-chats")).includes("首页标题已经改大"));
check("Chats：头部有会话数 / 待处理", /个会话/.test(await text(".bot-chats-head")) && /件待处理/.test(await text(".bot-chats-head")));
check("接下来（Up next）：提问 / 建议 / 到点都能看见", (await text(".bot-upnext")).includes("提问") || (await text(".bot-upnext")).includes("建议"));
check("机器人列表有未读点", await ev(`!!document.querySelector(".bot-dot.attention")`));

// 右栏切到「设置」：配置页的标签在这里
await run(`
  const trigger = document.querySelector(".bot-msg-col .row-menu-trigger");
  if (!trigger) throw new Error("消息栏没有操作菜单");
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const item = [...document.querySelectorAll(".row-menu-pop button, .row-menu-popup button, [role=menu] button")].find((b) => /机器人设置/.test(b.textContent));
  if (!item) throw new Error("没有机器人设置入口");
  item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("自动化面板存在（标签）", (await all(".bot-tabs button")).some((t) => t.includes("自动化")));
check("工具与通道面板存在（标签）", (await all(".bot-tabs button")).some((t) => t.includes("工具与通道")));
const settingTabs = await all(".bot-aside .bot-tabs button");
check("设置分区全部可见", ["待处理", "人格卡", "记忆", "任务", "自动化", "工具与通道", "出场规则"].every((x) => settingTabs.some((t) => t.includes(x))), settingTabs.join(" / "));
check("设置 tab：消息列让位，不重叠", await ev(`!document.querySelector(".bot-msg-col") && !!document.querySelector(".bot-aside .bot-tabs")`));
await shot(path.join(OUT, "bot-settings.png"));
await run(`
  const back = [...document.querySelectorAll(".bot-rail-tabs button")].find((b) => b.textContent.trim() === "消息");
  if (back) back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);

// 展开执行树
await run(`
  const twist = document.querySelector(".bot-twist");
  if (!twist) throw new Error("没有展开执行按钮");
  twist.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
const workers = await all(".bot-chat-worker");
check("执行树：会话行展开后列出它起的任务", workers.some((t) => t.includes("FEAT-1")), workers.join(" / "));

// 进会话
await run(`
  const row = [...document.querySelectorAll(".bot-chat-row-main")].find((b) => b.textContent.includes("发布节奏"));
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return true;`);
check("会话头：返回 / 标题 / 条数 / 新会话", (await text(".bot-chat-bar")).includes("发布节奏") && (await text(".bot-chat-bar")).includes("新会话"));
check("BOT 三栏：联系人 / 消息 / 对话", await ev(`!!document.querySelector(".bot-side .bot-item") && !!document.querySelector(".bot-msg-col .bot-chat-row") && !!document.querySelector(".bot-main .bot-stream")`));
check("Chat 窗口：用户气泡 / agent 扁平正文", await ev(`!!document.querySelector(".ds-user .ds-bubble") && !!document.querySelector(".ds-assistant-body")`));
check("Chat 窗口：气泡 R20、composer R28", await ev(`getComputedStyle(document.querySelector(".ds-bubble")).borderRadius === "20px" && getComputedStyle(document.querySelector(".ds-composer")).borderRadius === "28px"`));
check("Chat 窗口：composer 是 34px 圆形发送", await ev(`(() => { const b = document.querySelector(".ds-send"); if (!b) return false; const s = getComputedStyle(b); return Math.round(b.getBoundingClientRect().width) === 34 && s.borderRadius === "999px"; })()`));
check("正文渲染 Markdown 代码块", await ev(`!!document.querySelector(".ds-assistant-body pre code")`));
check("正文渲染 Markdown 列表", await ev(`!!document.querySelector(".ds-assistant-body ul li")`));
check("run 汇报带产物", (await text(".bot-stream")).includes("src/App.tsx"));
check("消息动作：引用 / 分支", await ev(`!!document.querySelector('.ds-action[title="引用这条继续问"]') && !!document.querySelector('.ds-action[title^="复制到新会话"]')`));
check("citations：为什么说 / 注入记忆", (await text(".bot-stream")).includes("为什么说"));
await shot(path.join(OUT, "bot-chat.png"));
// 暗色再拍一张：亮暗同构是 Chat 窗口的硬约束
await run(`document.documentElement.dataset.theme = "dark"; document.documentElement.dataset.mode = "dark"; return true;`);
await sleep(250);
await shot(path.join(OUT, "bot-chat-dark.png"));
await run(`document.documentElement.dataset.theme = "light"; document.documentElement.dataset.mode = "light"; return true;`);

// 轨迹：展开一轮的过程（思考 / 工具 / 终端）
await run(`
  const head = document.querySelector(".ds-trace .ds-process-head");
  if (!head) throw new Error("没有轨迹头");
  head.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
const traceText = await text(".ds-trace .ds-process-body");
check("轨迹：展开后有工具调用 / 终端", traceText.includes("npm test") && traceText.includes("终端"), traceText.slice(0, 80));
check("轨迹：工具卡带命令 / 输出", await ev(`!!document.querySelector(".ds-term-cmd") || !!document.querySelector(".ds-card-body")`));
await shot(path.join(OUT, "bot-trace.png"));

// 独立轨迹 tab：时间轴 + 账本
await run(`
  const tab = [...document.querySelectorAll(".bot-chat-tabs button")].find((b) => b.textContent.trim() === "轨迹");
  if (!tab) throw new Error("没有轨迹 tab");
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("轨迹：时间轴三轨 / 记录账本", await ev(`!!document.querySelector(".ds-tr-lane") && !!document.querySelector(".ds-tr-block") && !!document.querySelector(".ds-tr-row")`));
await shot(path.join(OUT, "bot-trajectory.png"));
await run(`
  const tab = [...document.querySelectorAll(".bot-chat-tabs button")].find((b) => b.textContent.trim() === "对话");
  if (tab) tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);

// 引用
await run(`
  const btn = document.querySelector('.ds-action[title="引用这条继续问"]');
  if (!btn) throw new Error("没有引用按钮");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
check("点「引用」把原文带进输入框", (await ev(`document.querySelector(".ds-composer textarea")?.value || ""`)).startsWith(">"));

// 附件
await run(`
  const btn = document.querySelector(".ds-add");
  if (!btn) throw new Error("没有附件按钮");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return true;`);
check("附件：读进来变成 chip", (await text(".bot-attach-row")).includes("README.md"));

// 分支
await run(`
  const menu = document.querySelector(".bot-chat-bar .row-menu-trigger");
  if (!menu) throw new Error("会话头没有操作菜单");
  menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const item = [...document.querySelectorAll(".row-menu-pop button, .row-menu-popup button, [role=menu] button")].find((b) => b.textContent.includes("分支"));
  if (!item) throw new Error("菜单里没有分支");
  item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return true;`);
check("分支：调用 botChatFork", await ev(`(window.__calls || []).some((c) => c.type === "botChatFork")`));

// 打开右栏「设置」，后面的配置页断言才在
await run(`
  const trigger = document.querySelector(".bot-msg-col .row-menu-trigger");
  if (trigger) trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const item = [...document.querySelectorAll(".row-menu-pop button, .row-menu-popup button, [role=menu] button")].find((b) => /机器人设置/.test(b.textContent));
  if (!item) throw new Error("没有机器人设置入口");
  item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);

// 连接器 / 自动化 / 谁能找它
await run(`
  const tab = [...document.querySelectorAll(".bot-tabs button")].find((b) => b.textContent.includes("工具与通道"));
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
const conn = await text(".bot-aside");
check("工具与通道：列出工具 / 通道 / 插件", conn.includes("memory_search") && conn.includes("feishu") && conn.includes("手机端") && conn.includes("notes"));
await run(`
  const tab = [...document.querySelectorAll(".bot-tabs button")].find((b) => b.textContent.includes("自动化"));
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
const auto = await text(".bot-aside");
check("自动化：一行一条（名字 / 下次 / 上次失败 / 启用）", auto.includes("早报") && auto.includes("上次") && auto.includes("启用"));
await run(`
  const tab = [...document.querySelectorAll(".bot-tabs button")].find((b) => b.textContent.includes("出场规则"));
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("出场规则：谁能找它（只有我 / 群里 @ 它 / 群里任何人）", (await all(".bot-seg button")).join("/").includes("只有我") && (await all(".bot-seg button")).join("/").includes("群里任何人"));
check("没有控制台报错", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));


console.log(`\n${fails ? `✗ ${fails} 项失败` : "全部通过"} · 截图：${OUT}/bot-chats.png、bot-chat.png、bot-chat-dark.png`);
ws.close();
cleanup();
process.exit(fails ? 1 : 0);
