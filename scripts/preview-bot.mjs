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
// 低内存机器（1.7G 云开发机）可用 PREVIEW_SCALE=1 跑同一套断言，只牺牲截图清晰度
const SCALE = Number(process.env.PREVIEW_SCALE) || 2;

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
      // 会话面（BotTrace）读 turn.tools；轨迹视图读 turn.trace —— 两处都要有「读取文件」这一步
      tools: [
        { name: "read", args: "src/App.tsx", argsRaw: "src/App.tsx", result: "export default function App() {\n  return null;\n}", at: now - 698500, ms: 120, ok: true, family: "read", statusKind: "done", durationMs: 120 },
      ],
      context: { chars: 12300, memory: 8000, memoryRaw: 8500, history: 10, digest: false, memoryUsedPct: 62, memoryLines: { total: 20, loaded: 18, dropped: 2, cap: 200, budget: 12900 }, sections: {} },
      trace: [
        { kind: "request", round: 0, at: now - 700000, ms: 820, usage: { total_tokens: 180, prompt_tokens: 120, completion_tokens: 60 }, text: "先查一下发布节奏。" },
        { kind: "tool", name: "knowledge_search", argsRaw: "{\"query\":\"发布节奏\",\"limit\":5}", result: "{\"hits\":[{\"title\":\"发布节奏\"},{\"title\":\"构建通过\"}]}", ms: 240, at: now - 699000, ok: true },
        { kind: "tool", name: "read", argsRaw: "src/App.tsx", result: "export default function App() {\n  return null;\n}", ms: 120, at: now - 698500, ok: true },
        { kind: "request", round: 1, at: now - 698000, ms: 600, usage: { total_tokens: 140, prompt_tokens: 80, completion_tokens: 60 }, text: "今天两条：\n\n- 首页标题已改大\n- 构建通过" },
      ] }),
    turn({ id: "t2", decision: "reported", threadId: "th-bot-b1", runId: "r1", todoId: "td1",
      reply: "FEAT-1 完成：首页标题改大\n测试通过，等你确认。", cost: { tokens: 120, ms: 800 },
      context: { chars: 9000, memory: 5200, memoryUsedPct: 40, history: 24, digest: true } }),
    turn({ id: "t3", decision: "silent", threadId: "th-bot-b1", reason: "没有值得说的事件", cost: {} }),
    turn({ id: "t4", decision: "asked", threadId: "th-bot-b1", reply: "要我顺便把副标题也改了吗？", ask: { text: "副标题要不要一起改？", status: "open", createdAt: now - 300000 },
      context: { chars: 16800, memory: 11200, memoryUsedPct: 85, history: 14, memoryLines: { total: 22, loaded: 18, dropped: 4, cap: 200, budget: 12900 }, sections: {} } }),
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
    botGroups: [{ id: "g1", name: "项目群", memberIds: ["b1", "b2"], replyMode: { kind: "mentions" }, createdAt: now - 6e5 }],
    botGroupMessages: [{
      id: "gmsg-fail", groupId: "g1", threadId: null, seq: 0, author: "bot", botId: "b2", botName: "DE-A · 前端",
      text: "模拟：模型网关 502", decision: "failed", createdAt: now - 3.6e6, meta: null,
    }],
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
  const draftStore = {};
  // 窗口化用例：把快照里的回合撑到 n 条（渲染层只该画最近 40 个块）
  snapshot.botUi = draftStore;
  // 审批队列用例：往真实 state 里推一条待审批再广播（不动别的字段）
  window.__pushApprovals = (list) => { state.approvals = list; emit({ ...state }); };
  // 群成员提问卡用例：换一份 groupAsks 并让 BotConsole 重读快照（botChanged 走 group id）
  window.__setGroupAsks = (list) => { snapshot.groupAsks = list; state.botChanged = { botId: "g1", at: Date.now() }; emit({ ...state }); };
  window.__pushGroupOwner = (text) => {
    const seq = state.botGroupMessages.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
    state.botGroupMessages = [...state.botGroupMessages, {
      id: "gmsg-owner-" + seq, groupId: "g1", threadId: null, seq, author: "owner",
      botId: null, botName: "", text, decision: "answered", createdAt: Date.now(), meta: null,
    }];
    state.botChanged = { botId: "g1", at: Date.now() };
    emit({ ...state });
  };
  // 运行状态用例：waiting_input + waitingFor=approval 的文案要和「等你回答」分开
  window.__setRunStatus = (status, waitingFor) => {
    state.runs = state.runs.map((r) => (r.id === "r1" ? { ...r, status, waitingFor: waitingFor || undefined } : r));
    emit({ ...state });
  };
  window.__fillTurns = (n) => {
    snapshot.turns = Array.from({ length: n }, (_, i) => turn({
      id: "tbig" + i, decision: i % 2 ? "replied" : "answered",
      input: "第 " + i + " 问", reply: "第 " + i + " 答", threadId: "th-bot-b1",
      // 窗口化用例之后还要验「上下文账」：最后一轮带真实 context，不让它变成空值
      ...(i === n - 1 ? { context: { chars: 16800, memory: 11200, memoryUsedPct: 85, history: 14, digest: true, memoryLines: { total: 22, loaded: 18, dropped: 4, cap: 200, budget: 12900 }, sections: {} } } : {}),
    }))
      // 没回也留痕：落库的 failed 回合（主进程报错时不再删掉这一轮）
      .concat(turn({ id: "tfail", decision: "failed", threadId: "th-bot-b1", input: "帮我读一下合同.pdf", createdAt: now + 1000,
        reason: "网关 502：模型没回（这一轮已落库，刷新也在）", cost: { ms: 900 } }));
  };
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
      else if (type === "botChat") {
        if (/失败测试/.test(String(payload?.text || ""))) return { ok: false, error: "模拟：模型网关 502（用于验证对话内失败卡）" };
        // 1:1 也要有一小段「在回」的窗口：跟随用例要看内容真的长出来（立刻返回等于没长）
        await new Promise((r) => setTimeout(r, 500));
        result = { ok: true, result: turns[0] };
      }
      else if (type === "botRetry") result = { ok: true };
      // 和主进程 db.saveBotUi 一样「按字段合并」：只写 scroll 时不能把草稿清空，反之亦然
      else if (type === "botGroupRetry") result = { ok: true };
      else if (type === "setTodoPermission") {
        const todo = state.todos.find((t) => t.id === payload.id);
        if (todo) todo.permission = payload.permission === "full-access" ? "full-access" : undefined;
        emit({ ...state });
        result = { ok: true };
      }
      else if (type === "botFeedback") {
        const t = snapshot.turns.find((x) => x.id === payload.turnId);
        if (t) t.feedback = t.feedback === payload.value ? null : payload.value;
        result = { ok: true, turnId: payload.turnId, feedback: t?.feedback || null };
      }
      else if (type === "botUiSave") { const prev = draftStore[payload.key] || { draft: "", scroll: null }; draftStore[payload.key] = { draft: payload.draft !== undefined ? payload.draft : prev.draft, scroll: payload.scroll !== undefined ? payload.scroll : prev.scroll, updatedAt: Date.now() }; result = { ok: true }; }
      else if (type === "botGroupSend") {
        // 模拟群聊：先落自己的话，再逐个成员流式回（和主进程 botGroupSend 一样）
        const text = (head) => head + "\n\n" + "这是一段用来把回合流撑出滚动的正文，验证新内容进来时窗口会不会跟着往下走。\n".repeat(12);
        const say = (botId, delta) => window.__delta?.({ botId, groupId: payload.id, name: botId === "b1" ? "PM · 项目经理" : "DE-A · 前端", delta });
        const uniq = Date.now();
        // 每次广播都换一个新对象（和主进程 IPC 一样），否则 React 按引用比较不会重渲染
        const put = (msg) => { state.botGroupMessages = [...state.botGroupMessages, msg]; emit({ ...state }); };
        const owner = { id: "gm-owner-" + uniq, groupId: payload.id, seq: state.botGroupMessages.length, author: "owner", botId: null, botName: "", text: payload.text, decision: "answered", createdAt: Date.now(), meta: null };
        // 回声故意晚 80ms：模拟 IPC 往返，好在同一个用例里看到「乐观气泡 → 真消息」两态
        setTimeout(() => put(owner), 80);
        await new Promise((r) => setTimeout(r, 220));
        say("b1", text("先说一半。"));
        await new Promise((r) => setTimeout(r, 200));
        say("b1", "，说完了。");
        // 最后一段增量之后再收尾：resolution 之后不该再有 delta（否则块被重新建出来）
        await new Promise((r) => setTimeout(r, 220));
        put({ id: "gm-b1-" + uniq, groupId: payload.id, seq: state.botGroupMessages.length, author: "bot", botId: "b1", botName: "PM · 项目经理", text: text("先说一半，说完了。"), decision: "replied", createdAt: Date.now(), meta: null });
        result = { messages: [] };
      }
      return { ok: true, result };
    },
    docsPick: async () => [{ path: "/tmp/ws/README.md", name: "README.md", text: "# 标题\n正文", size: 20 }],
    docsRead: async (paths) => (paths || []).map((path) => (String(path).includes("App.tsx")
      ? { path, name: "App.tsx", text: "export default function App() {\n  return null;\n}\n" }
      : { path, name: "README.md", text: "# 标题\n正文" })),
    clipboardRead: async () => "",
    clipboardWrite: async () => {},
    onBotDelta: (cb) => { window.__delta = cb; return () => {}; }, onBotTool: () => () => {}, onBotMessage: () => () => {},
    // 每个订阅都要给真函数：mock 是 Proxy 兜底，缺了会返回 async 函数，cleanup 时 offXxx() 直接炸
    onBotPhase: () => () => {}, onBotThought: () => () => {}, onBotGroupMessage: () => () => {},
    onState: (cb) => { emit = cb; setTimeout(() => cb(state), 0); return () => {}; },
    onPluginChatDraft: () => () => {}, onPluginNotify: () => () => {}, onPluginOpenView: () => () => {},
    // App 会用 onBotPatch 做作用域增量渲染；mock 里给一个空订阅，否则 Proxy 兜底返回 async 函数，cleanup 时 offPatch() 报错
    onBotPatch: (_cb) => () => {},
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
  const TRACE_OUT = Boolean(process.env.PREVIEW_TRACE);
  child.stdout.on("data", (d) => { if (TRACE_OUT) process.stderr.write(`[${args[1] ? "child" : "child"}] ${String(d).slice(0, 400)}`); });
  child.stderr.on("data", (d) => { if (TRACE_OUT) process.stderr.write(`[child:err] ${String(d).slice(0, 2000)}`); });
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
  // root / 容器里 Chromium 默认 sandbox 起不来
  ...(process.getuid?.() === 0 ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  `--force-device-scale-factor=${SCALE}`, "--window-size=1600,1000", "about:blank",
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
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleErrors.push(text);
    if (process.env.PREVIEW_TRACE) process.stderr.write(`[console.error] ${text.slice(0, 400)}\n`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const text = msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "exception";
    consoleErrors.push(text);
    if (process.env.PREVIEW_TRACE) process.stderr.write(`[exception] ${String(text).slice(0, 400)}\n`);
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
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: SCALE, mobile: false });
await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  // 冷缓存 / 低内存机器上首屏要更久：PREVIEW_MOUNT_MS 可放宽，默认 20s
  await wait(async () => (await ev(`!!document.querySelector(".rail-btn")`)), Number(process.env.PREVIEW_MOUNT_MS) || 20000, "应用挂载");
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

// 右栏切到「设置」：配置页的标签在这里（菜单是异步挂的，点开要轮询，不能赌固定 sleep）
await run(`
  const pickItem = () => [...document.querySelectorAll(".row-menu-pop button, .row-menu-popup button, [role=menu] button")].find((b) => /机器人设置/.test(b.textContent));
  for (let i = 0; i < 4; i++) {
    const trigger = [...document.querySelectorAll(".bot-msg-col .row-menu-trigger")].find((b) => b.getBoundingClientRect().width > 0);
    if (trigger) trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let k = 0; k < 5 && !pickItem(); k++) await new Promise((r) => setTimeout(r, 60));
    const item = pickItem();
    if (item) {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("没有机器人设置入口");`);
check("自动化面板存在（标签）", (await all(".bot-tabs button")).some((t) => t.includes("自动化")));
const settingTabs = await all(".bot-aside .bot-tabs button");
check("设置分区全部可见", ["身份", "能力", "记忆", "自动化", "规则"].every((x) => settingTabs.some((t) => t.includes(x))), settingTabs.join(" / "));
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
const sendBtn = await ev(`(() => { const b = [...document.querySelectorAll(".ds-send")].find((x) => x.getBoundingClientRect().width > 0); if (!b) return "missing"; const s = getComputedStyle(b); return JSON.stringify({ w: Math.round(b.getBoundingClientRect().width), r: s.borderRadius }); })()`);
check("Chat 窗口：composer 是 34px 圆形发送", sendBtn === '{"w":34,"r":"999px"}', sendBtn);
check("正文渲染 Markdown 代码块", await ev(`!!document.querySelector(".ds-assistant-body pre code")`));
check("正文渲染 Markdown 列表", await ev(`!!document.querySelector(".ds-assistant-body ul li")`));
check("run 汇报带产物", (await text(".bot-stream")).includes("src/App.tsx"));
check("消息动作：引用 / 更多菜单", await ev(`!!document.querySelector('.ds-action[title="引用这条继续问"]') && !!document.querySelector('.ds-actions .row-menu-trigger')`));
check("citations：为什么说 / 注入记忆", (await text(".bot-stream")).includes("为什么说"));
// 回合轨：不写序号，悬停细线预览这一轮的内容
check("回合轨：细线无序号", await ev(`(() => { const marks = [...document.querySelectorAll(".ds-turn-mark")]; return marks.length > 1 && marks.every((m) => m.textContent.trim() === ""); })()`));
await run(`
  const mark = [...document.querySelectorAll(".ds-turn-mark")][1];
  if (!mark) throw new Error("没有回合轨");
  mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  mark.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  await new Promise((r) => setTimeout(r, 220));
  return true;`);
check("回合轨：悬停有内容预览", (await text(".ds-turn-peek")).includes("第 2 轮"));
check("回合轨：预览是浮层（不挤正文）", await ev(`(() => { const p = document.querySelector(".ds-turn-peek"); if (!p) return false; const s = getComputedStyle(p); return s.position === "absolute" && s.pointerEvents === "none"; })()`));
await shot(path.join(OUT, "bot-chat-peek.png"));
await run(`
  const mark = [...document.querySelectorAll(".ds-turn-mark")][1];
  mark.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  return true;`);
await shot(path.join(OUT, "bot-chat.png"));
// 暗色再拍一张：亮暗同构是 Chat 窗口的硬约束
await run(`document.documentElement.dataset.theme = "dark"; document.documentElement.dataset.mode = "dark"; return true;`);
await sleep(250);
await shot(path.join(OUT, "bot-chat-dark.png"));
await run(`document.documentElement.dataset.theme = "light"; document.documentElement.dataset.mode = "light"; return true;`);

// 轨迹：展开一轮的过程（思考 / 工具 / 终端）
// 会话里有多组过程（每轮一组）：一起取，不能只看第一组
const traceText = await ev(`[...document.querySelectorAll(".ds-steps")].map((e) => e.textContent).join(" / ")`);
check("轨迹：有工具调用 / 终端", traceText.includes("npm test") && traceText.includes("终端"), traceText.slice(0, 120));
check("轨迹：工具卡带命令 / 输出", await ev(`!!document.querySelector(".ds-term-cmd") || !!document.querySelector(".ds-card-body") || !!document.querySelector(".ds-tool-row")`));
await shot(path.join(OUT, "bot-trace.png"));

// 独立轨迹 tab：时间轴 + 账本
await run(`
  const tab = [...document.querySelectorAll(".bot-chat-tabs button")].find((b) => b.textContent.trim() === "轨迹");
  if (!tab) throw new Error("没有轨迹 tab");
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("轨迹：时间轴三轨 / 记录账本", await ev(`!!document.querySelector(".ds-tr-lane") && !!document.querySelector(".ds-tr-block") && !!document.querySelector(".ds-tr-row")`));
// 轨迹细节：每一步都能展开看「原始参数 / 输出 / 用量」，字段可整段复制（贴出去的是原文，不是截断）
await run(`
  const row = document.querySelector(".ds-tr-row");
  if (!row) throw new Error("没有轨迹行");
  row.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  return true;`);
const trDetail = await ev(`(() => {
  const fields = [...document.querySelectorAll(".ds-tr-field")];
  return JSON.stringify({
    fields: fields.length,
    labels: fields.map((f) => f.querySelector("span")?.textContent || ""),
    copies: fields.filter((f) => f.querySelector(".icon-btn")).length,
  });
})()`);
const trObj = JSON.parse(trDetail || "{}");
check("轨迹细节：字段展开（参数 / 输出 / 用量）", (trObj.fields || 0) >= 1 && (trObj.labels || []).some((l) => /参数|输出|用量/.test(l)), trDetail);
check("轨迹细节：字段带整段复制", (trObj.copies || 0) === (trObj.fields || 0), trDetail);
await shot(path.join(OUT, "bot-trajectory.png"));
await run(`
  const tab = [...document.querySelectorAll(".bot-chat-tabs button")].find((b) => b.textContent.trim() === "对话");
  if (tab) tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);

// 对话内预览：工具行里的文件 chip 就地展开（不跳标签），再点一次收起
const previewState = await run(`
  const chip = document.querySelector(".ds-file-chip-name");
  if (!chip) { window.__preview = { has: false }; return true; }
  chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 320));
  const card = document.querySelector(".ds-inline-preview");
  window.__preview = {
    has: true,
    open: Boolean(card),
    body: card?.querySelector(".ds-ip-body")?.textContent || "",
    title: card?.querySelector(".ds-ip-title")?.textContent || "",
    openInTab: Boolean(card?.querySelector('[aria-label="在预览标签里打开"]')),
  };
  return true;`);
const pv = JSON.parse(await ev(`JSON.stringify(window.__preview || {})`) || "{}");
check("对话内预览：文件 chip 就地展开（不跳标签）", pv.has === false || (pv.open === true && /App\.tsx/.test(pv.title || "")), JSON.stringify(pv));
check("对话内预览：卡片里带文件正文", pv.has === false || /export default function App/.test(pv.body || ""), JSON.stringify(pv));
check("对话内预览：仍然可以「在标签里打开」", pv.has === false || pv.openInTab === true, JSON.stringify(pv));
await shot(path.join(OUT, "bot-inline-preview.png"));
await run(`
  document.querySelector('.ds-inline-preview [aria-label="收起预览"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  return true;`);

// 引用
await run(`
  const btn = document.querySelector('.ds-action[title="引用这条继续问"]');
  if (!btn) throw new Error("没有引用按钮");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
const quoteValue = await ev(`[...document.querySelectorAll(".ds-composer textarea")].map((t) => t.value).find((v) => v.startsWith(">")) || ""`);
check("点「引用」把原文带进输入框", quoteValue.startsWith(">"), quoteValue.slice(0, 40));

// 附件
await run(`
  const btn = document.querySelector(".ds-add");
  if (!btn) throw new Error("没有附件按钮");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return true;`);
check("附件：读进来变成 chip", (await text(".bot-attach-row")).includes("README.md"));

// 分支（菜单弹出的时机差一拍：最多重试 3 次，避免偶发「菜单里没有分支」）
await run(`
  const pickItem = (re) => [...document.querySelectorAll(".row-menu-pop button, .row-menu-popup button, [role=menu] button")].find((b) => re.test(b.textContent));
  for (let i = 0; i < 3; i++) {
    const menu = document.querySelector(".bot-chat-bar .row-menu-trigger");
    if (!menu) throw new Error("会话头没有操作菜单");
    menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let k = 0; k < 4 && !pickItem(/分支/); k++) await new Promise((r) => setTimeout(r, 60));
    const item = pickItem(/分支/);
    if (item) { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); return true; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("菜单里没有分支");`);
check("分支：调用 botChatFork", await ev(`(window.__calls || []).some((c) => c.type === "botChatFork")`));

// 打开右栏「设置」，后面的配置页断言才在
await run(`
  const pickItem = () => [...document.querySelectorAll(".row-menu-pop button, .row-menu-popup button, [role=menu] button")].find((b) => /机器人设置/.test(b.textContent));
  for (let i = 0; i < 3; i++) {
    const triggers = [...document.querySelectorAll(".row-menu-trigger")].filter((b) => b.getBoundingClientRect().width > 0);
    const trigger = triggers.find((b) => b.closest(".bot-msg-col")) || triggers[0];
    if (!trigger) { await new Promise((r) => setTimeout(r, 200)); continue; }
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let k = 0; k < 4 && !pickItem(); k++) await new Promise((r) => setTimeout(r, 60));
    const item = pickItem();
    if (item) { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); return true; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("没有机器人设置入口");`);

// 连接器 / 自动化 / 谁能找它
await run(`
  const tab = [...document.querySelectorAll(".bot-tabs button")].find((b) => b.textContent.includes("能力"));
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
const conn = await text(".bot-aside");
check("能力：列出通道 / 插件", conn.includes("feishu") && conn.includes("手机端") && conn.includes("插件"), conn.slice(0, 100));
await run(`
  const tab = [...document.querySelectorAll(".bot-tabs button")].find((b) => b.textContent.includes("自动化"));
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
const auto = await text(".bot-aside");
check("自动化：一行一条（名字 / 下次 / 上次失败 / 启用）", auto.includes("早报") && auto.includes("上次") && auto.includes("启用"));
await run(`
  const tab = [...document.querySelectorAll(".bot-tabs button")].find((b) => b.textContent.includes("规则"));
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("出场规则：谁能找它（只有我 / 群里 @ 它 / 群里任何人）", (await all(".bot-seg button")).join("/").includes("只有我") && (await all(".bot-seg button")).join("/").includes("群里任何人"));

// 群聊：发出去立刻能看到「自己那句 + 谁在回、回到哪了」，不等整段跑完
await run(`
  const vis = (el) => el.getBoundingClientRect().width > 0;
  const item = [...document.querySelectorAll(".bot-item")].find((b) => vis(b) && b.textContent.includes("项目群"));
  if (!item) throw new Error("没有群聊入口");
  item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // 群面挂载 + 可见 composer 就位（固定 250ms 在负载高时会读到上一个 surface）
  const ready = () => [...document.querySelectorAll(".ds-composer textarea")]
    .some((t) => vis(t) && (t.getAttribute("placeholder") || "").includes("在群里说一句"));
  for (let i = 0; i < 120 && !ready(); i++) await new Promise((r) => setTimeout(r, 25));
  if (!ready()) throw new Error("群聊面板没打开（还停在上一屏）");
  return true;`);
const groupComposer = await ev(`(() => { const el = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0); return el ? (el.getAttribute("placeholder") || "") : ""; })()`);
const groupRetry = await ev(`(() => {
  const btn = [...document.querySelectorAll(".ds-fail-actions .btn")].find((b) => /重试这一条/.test(b.textContent));
  return JSON.stringify({ shown: Boolean(btn), text: (document.querySelector(".ds-fail-hint")?.textContent || "").slice(0, 40) });
})()`);
const groupRetryObj = JSON.parse(groupRetry || "{}");
check("群聊：失败的那一条能单独重试", groupRetryObj.shown === true, groupRetry);
await run(`
  const btn = [...document.querySelectorAll(".ds-fail-actions .btn")].find((b) => /重试这一条/.test(b.textContent));
  if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
check("群聊：单条重试只叫原成员（botGroupRetry）", await ev(`(() => { const c = window.__calls.filter((x) => x.type === "botGroupRetry"); return c.length >= 1 && c.at(-1).payload.messageId === "gmsg-fail"; })()`));
check("群聊：进去了（在群里说一句）", groupComposer.includes("在群里说一句"), groupComposer);
await run(`
  // 流式块在 mock 里只活几百毫秒：用 MutationObserver 记录它「出现过」，别靠跨 CDP 轮询去赌窗口
  window.__streamSeen = { partial: false, stop: false, clicked: false, cancels: [] };
  window.__mo?.disconnect();
  window.__mo = new MutationObserver(() => {
    const el = document.querySelector(".ds-streaming");
    if (!el) return;
    if ((el.textContent || "").includes("先说一半")) window.__streamSeen.partial = true;
    const btn = el.querySelector(".ds-action-text");
    if (btn) {
      window.__streamSeen.stop = true;
      if (!window.__streamSeen.clicked) {
        window.__streamSeen.clicked = true;
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }
  });
  window.__mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  return true;`);
await run(`
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (!box) throw new Error("没有输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "群里问一句");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const send = [...document.querySelectorAll(".ds-send")].find((b) => b.getBoundingClientRect().width > 0);
  if (!send) throw new Error("没有发送按钮");
  send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // 回声 80ms 后就到：必须在同一段脚本里观察「乐观气泡出现过」，跨 CDP 往返会直接读到回声态
  // 同一窗口顺手记「等待行」（正在想 / 流式块）有没有出现——跨往返再查会正好错过
  let seen = false;
  let waitLine = false;
  for (let i = 0; i < 24 && !seen; i++) {
    seen = Boolean(document.querySelector(".ds-pending"));
    if (document.querySelector(".ds-typing") || document.querySelector(".ds-streaming")) waitLine = true;
    if (!seen) await new Promise((r) => setTimeout(r, 10));
  }
  window.__pendingSeen = seen;
  window.__waitLineSeen = waitLine;
  return true;`);
check("群聊：自己的话立刻出现（不等后端）", await ev(`Boolean(window.__pendingSeen)`));
check("群聊：没人开口时有「正在想」行（不是整段空白）", await ev(`Boolean(window.__waitLineSeen)`), JSON.stringify((await text(".bot-stream")).slice(-160)));
await sleep(250);
check("群聊：后端回声到了就不再画乐观气泡（不重复）", await ev(`!document.querySelector(".ds-pending")`));
// 流式块存在的时间窗很短（mock 是分段吐的）：一次轮询里把「逐字可见」和「块上能停止」都记下来，
// 分两次读会在两次 CDP 往返之间正好错过它
const streamSeen = await ev(`(async () => {
  for (let i = 0; i < 200 && !(window.__streamSeen.partial && window.__streamSeen.stop); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const cancels = window.__calls.filter((c) => c.type === "botCancel").map((c) => c.payload?.botId);
  return JSON.stringify({ partial: window.__streamSeen.partial, stop: window.__streamSeen.stop, cancels });
})()`);
const streamSeenObj = JSON.parse(streamSeen || "{}");
check("群聊：逐字流式可见（不等整段）", streamSeenObj.partial === true, streamSeen);
check("群聊：流式块上能「停止」", streamSeenObj.stop === true, streamSeen);
check("群聊：单条「停止」只叫停这一个成员（不是全员）", JSON.stringify(streamSeenObj.cancels) === JSON.stringify(["b1"]), JSON.stringify(streamSeenObj.cancels));
await shot(path.join(OUT, "bot-group-stream.png"));
await sleep(700);
check("群聊：跑完后落库、临时态收干净", (await text(".bot-stream")).includes("先说一半，说完了。") && await ev(`!document.querySelector(".ds-pending") && !document.querySelector(".ds-streaming")`), JSON.stringify((await text(".bot-stream")).slice(-160)));

// 群聊 @ 选择器：浮在 composer 上方（不挤转录）、列出全体、键盘可选、选完焦点还在输入框
const mentionUi = await ev(`(async () => {
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (!box) return JSON.stringify({ error: "没有输入框" });
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  box.focus();
  setter.call(box, "@");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const pop = document.querySelector(".im-mention-pop");
  const options = [...document.querySelectorAll('.im-mention[role="option"]')];
  const pr = pop && pop.getBoundingClientRect();
  const cr = box.closest(".ds-composer")?.getBoundingClientRect();
  const above = Boolean(pr && cr && pr.bottom <= cr.top + 1);
  const floating = pop ? getComputedStyle(pop).position : "";
  const labelled = box.getAttribute("aria-expanded") === "true" && box.getAttribute("aria-controls") === "im-mention-list" && Boolean(box.getAttribute("aria-activedescendant"));
  const first = document.querySelector(".im-mention.on")?.id || "";
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const moved = document.querySelector(".im-mention.on")?.id || "";
  const sendsBefore = window.__calls.filter((c) => c.type === "botGroupSend").length;
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const sendsAfter = window.__calls.filter((c) => c.type === "botGroupSend").length;
  const value = box.value;
  const inserted = value.length > 2 && value[0] === "@" && value.endsWith(" ");
  const focused = document.activeElement === box;
  const closed = !document.querySelector(".im-mention-pop");
  const caretAtEnd = box.selectionStart === value.length;
  setter.call(box, "@PM 你好");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const spaceClosed = !document.querySelector(".im-mention-pop");
  // Esc 关掉之后，同一个 @ 里继续打字不再弹回来；换位置的新 @ 才弹
  setter.call(box, "@");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const until = async (fn, ms = 600) => { for (let i = 0; i < ms / 30; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 30)); } return fn(); };
  await until(() => Boolean(document.querySelector(".im-mention-pop")));
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const escClosed = await until(() => !document.querySelector(".im-mention-pop"));
  setter.call(box, "@P");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const muted = await until(() => !document.querySelector(".im-mention-pop"), 300);
  setter.call(box, "@P @");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  const newToken = await until(() => Boolean(document.querySelector(".im-mention-pop")));
  // 删干净再打一个 @（真实按键路径：中间会经过没有 @ 的那一帧，静音解除）
  setter.call(box, "");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  setter.call(box, "@");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const reopened = Boolean(document.querySelector(".im-mention-pop"));
  const sendBtn = [...document.querySelectorAll(".ds-send")].find((b) => b.getBoundingClientRect().width > 0);
  if (sendBtn) sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const clearedOnSend = !document.querySelector(".im-mention-pop");
  // 让这一轮群聊跑完再交回给后面的跟随用例：不然发送键还是「停止」，下一个用例点错按钮
  for (let i = 0; i < 100 && ![...document.querySelectorAll(".ds-send")].some((b) => b.getBoundingClientRect().width > 0); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return JSON.stringify({ options: options.length, above, floating, labelled, first, moved, inserted, value, sent: sendsAfter > sendsBefore, focused, closed, caretAtEnd, spaceClosed, escClosed, muted, newToken, reopened, clearedOnSend });
})()`);
const mention = JSON.parse(mentionUi || "{}");
check("群聊 @：浮在 composer 上方（不挤转录）", mention.above === true && mention.floating === "absolute", mentionUi);
check("群聊 @：列出全体成员 + everyone（不再截断到 6 个）", mention.options >= 3, String(mention.options));
check("群聊 @：输入框带 listbox 语义（expanded / controls / activedescendant）", mention.labelled === true, mentionUi);
check("群聊 @：↑↓ 换高亮", Boolean(mention.first) && Boolean(mention.moved) && mention.first !== mention.moved, `${mention.first} → ${mention.moved}`);
check("群聊 @：Enter 插入成员而不是把消息发出去", mention.inserted === true && mention.sent === false, mention.value);
check("群聊 @：点选/插入后焦点仍在输入框、光标在插入内容之后", mention.focused === true && mention.caretAtEnd === true, mentionUi);
check("群聊 @：插入后弹层收起", mention.closed === true, mentionUi);
check("群聊 @：@ 后面打空格就不再算选人（弹层自动收）", mention.spaceClosed === true, mentionUi);
check("群聊 @：Esc 关掉后同一个 @ 不再自动弹回，换位置才弹", mention.escClosed === true && mention.muted === true && mention.newToken === true, mentionUi);
check("群聊 @：发送后弹层不残留", mention.reopened === true && mention.clearedOnSend === true, mentionUi);
await sleep(200);

// 群成员的回答也能复制 / 引用（和 1:1 同一套动作行）
// 群聊面的断言之前先确认还停在这个面（多面同时挂载，切走了就切回来）
const ensureGroup = () => run(`
  const vis = (el) => el.getBoundingClientRect().width > 0;
  const inGroup = () => [...document.querySelectorAll(".ds-composer textarea")].some((t) => vis(t) && (t.getAttribute("placeholder") || "").includes("在群里说一句"));
  if (inGroup()) return true;
  if (!document.querySelector(".bot-item")) {
    window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
    await new Promise((r) => setTimeout(r, 300));
  }
  const item = [...document.querySelectorAll(".bot-item")].find((b) => vis(b) && b.textContent.includes("项目群"));
  if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 120 && !inGroup(); i++) await new Promise((r) => setTimeout(r, 25));
  if (!inGroup()) throw new Error("群聊面板没打开");
  return true;`);
await ensureGroup();
const groupActions = await ev(`(async () => {
  const vis = (el) => el.getBoundingClientRect().width > 0;
  const stream = [...document.querySelectorAll(".bot-stream")].find(vis) || document.querySelector(".bot-stream");
  const arts = [...(stream ? stream.querySelectorAll(".ds-assistant") : [])];
  const art = arts[arts.length - 1];
  const copy = art && art.querySelector('.ds-action[aria-label="复制这条回复"]');
  const quoteBtn = art && art.querySelector('.ds-action[aria-label="引用这条继续问"]');
  const prevWrite = window.harness.clipboardWrite;
  window.__copied = null;
  window.harness.clipboardWrite = async (text) => { window.__copied = text; };
  if (copy) copy.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  if (quoteBtn) quoteBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  window.harness.clipboardWrite = prevWrite;
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  const draft = box ? box.value : "";
  // 收干净：别把引用草稿带进后面的跟随 / 草稿用例
  if (box) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.blur();
  }
  await new Promise((r) => setTimeout(r, 24));
  return JSON.stringify({ copy: Boolean(copy), quote: Boolean(quoteBtn), copied: String(window.__copied || "").slice(0, 20), quoted: draft.startsWith("> ") });
})()`);
const groupActionObj = JSON.parse(groupActions || "{}");
check("群聊：成员的回答能复制", groupActionObj.copy === true && groupActionObj.copied.includes("先说一半"), groupActions);
check("群聊：成员的回答能引用（带进 composer 草稿）", groupActionObj.quote === true && groupActionObj.quoted === true, groupActions);

// 群成员的提问：卡片挂在群里（标出是谁问的），划掉只动这一条
await ensureGroup();
await run(`
  const ask = { messageId: "gmsg-ask", groupId: "g1", threadId: "", botId: "b2", botName: "DE-A · 前端", text: "要我把副标题也改了吗？", createdAt: Date.now() };
  // 群聊面的快照刷新是异步的：等到卡片真的出现（中途再推一次，防止那一次 patch 丢了）
  for (let i = 0; i < 40; i++) {
    if (document.querySelector(".bot-ask-row")) break;
    if (i === 0 || i === 20) window.__setGroupAsks([ask]);
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;`);
const groupAskUi = await ev(`(async () => {
  const card = document.querySelector(".bot-ask");
  const row = card ? card.querySelector(".bot-ask-row") : null;
  const text = (row?.textContent || "").trim();
  const dismiss = [...(row ? row.querySelectorAll("button") : [])].find((b) => /先不管/.test(b.textContent || ""));
  if (dismiss) dismiss.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return JSON.stringify({ shown: Boolean(card), text, dismiss: Boolean(dismiss) });
})()`);
const groupAskObj = JSON.parse(groupAskUi || "{}");
check("群聊：成员的提问卡出现在群里（标出是谁问的）", groupAskObj.shown === true && /DE-A/.test(groupAskObj.text) && /副标题/.test(groupAskObj.text), groupAskUi);
check("群聊：划掉只动这一条（botGroupAskDismiss）", await ev(`(() => { const c = window.__calls.filter((x) => x.type === "botGroupAskDismiss"); return c.length >= 1 && c.at(-1).payload.messageId === "gmsg-ask"; })()`));
await run(`window.__setGroupAsks([]); await new Promise((r) => setTimeout(r, 150)); return true;`);

// 群聊的检索与回合轨：消息行要能被定位（data-turn-id），⌘F 不再只给 1:1
await ensureGroup();
await run(`window.__pushGroupOwner("再看一下发布清单"); await new Promise((r) => setTimeout(r, 400)); return true;`);
const groupRail = await ev(`(() => {
  const rail = document.querySelector(".ds-turn-rail");
  const marks = [...(rail ? rail.querySelectorAll(".ds-turn-mark") : [])];
  const ids = [...document.querySelectorAll(".bot-stream [data-turn-id]")].length;
  return JSON.stringify({ rail: Boolean(rail), marks: marks.length, labels: marks.map((m) => m.getAttribute("aria-label")), ids });
})()`);
const groupRailObj = JSON.parse(groupRail || "{}");
check("群聊：每一轮（你发的那句）在回合轨上", groupRailObj.rail === true && groupRailObj.marks >= 3, groupRail);
check("群聊：消息行带 data-turn-id（跳转 / 阅读位置靠它）", Number(groupRailObj.ids) >= 3, String(groupRailObj.ids));

await run(`
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (box) box.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 200));
  const input = document.querySelector(".chat-search-input");
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "先说一半");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;`);
const groupHits = await ev(`(async () => {
  for (let i = 0; i < 40; i++) {
    const n = document.querySelectorAll(".chat-search-hit").length;
    if (n) return JSON.stringify({ open: Boolean(document.querySelector(".chat-search")), hits: n });
    await new Promise((r) => setTimeout(r, 50));
  }
  return JSON.stringify({ open: Boolean(document.querySelector(".chat-search")), hits: 0 });
})()`);
const groupHitsObj = JSON.parse(groupHits || "{}");
check("群聊：⌘F 能查会话内消息", groupHitsObj.open === true && groupHitsObj.hits > 0, groupHits);
await run(`
  // 检索结果要等一拍才渲染；机器忙时点早了会点空，轮询到闪一下为止
  for (let i = 0; i < 20; i++) {
    const hit = document.querySelector(".chat-search-hit");
    if (hit) hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    if (document.querySelector(".chat-flash")) return true;
  }
  return false;`);
check("群聊：点命中跳到那条并闪一下", await ev(`!!document.querySelector(".chat-flash")`));
await run(`document.querySelector(".chat-search")?.querySelector(".icon-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 150)); return true;`);

// 弹层外观：亮 / 暗各一张（headless 截图，不抢焦点）
await run(`
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (box) {
    box.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "@");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 80));
  return true;`);
await shot(path.join(OUT, "bot-mention.png"));
await run(`document.documentElement.dataset.theme = "dark"; document.documentElement.dataset.mode = "dark"; return true;`);
await sleep(120);
await shot(path.join(OUT, "bot-mention-dark.png"));
await run(`document.documentElement.dataset.theme = "light"; document.documentElement.dataset.mode = "light"; return true;`);
await run(`
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (box) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.blur();
  }
  await new Promise((r) => setTimeout(r, 60));
  return true;`);

// 窗口跟随：回合流自己滚（整页填充），新内容进来时贴底；两条入口都要一样
// 注意：判据是「转录是滚动容器、整页不动」，不是「内容一定超过一屏」——
// 短会话本来就撑不满，用 clientHeight < scrollHeight 判会随 fixture 内容漂。
const streamMetrics = () => ev(`(() => {
  const vis = (node) => node.getBoundingClientRect().width > 0;
  const el = [...document.querySelectorAll(".bot-stream")].find(vis) || document.querySelector(".bot-stream");
  if (!el) return null;
  const page = document.scrollingElement || document.documentElement;
  // 不要靠「挪一下 scrollTop」判可滚：那会触发应用自己的 onScroll，
  // gap>24 时会把 follow 关掉，后面的「贴底」断言就被测量动作本身弄红了
  const scrollable = el.scrollHeight > el.clientHeight + 1;
  return {
    overflow: getComputedStyle(el).overflowY,
    scrolled: scrollable,
    pageScrolled: page.scrollTop > 0,
    gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
  };
})()`);
const followAfterSend = async (label) => {
  await run(`
    const vis = (node) => node.getBoundingClientRect().width > 0;
    const el = [...document.querySelectorAll(".bot-stream")].find(vis) || document.querySelector(".bot-stream");
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    // 页面上可能同时挂着别的（隐藏的）composer：只往看得见的那一个里打字 / 点发送
    const box = [...document.querySelectorAll(".ds-composer textarea")].find(vis);
    if (!box) throw new Error("没有可见的输入框");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "再问一句，看窗口跟不跟");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    const send = [...document.querySelectorAll(".ds-send")].find(vis);
    if (send) send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;`);
  // 采样轮询而不是只取一次：机器忙时 180ms 还没滚到底，会假红（原本就是这个毛病）
  const settle = async (ms) => {
    let last = null;
    for (let i = 0; i < Math.ceil(ms / 120); i++) {
      await sleep(120);
      last = await streamMetrics();
      if (last && last.gap <= 8) return last;
    }
    return last;
  };
  const m = await settle(1200);
  check(`窗口跟随（${label}）：发出去就贴底`, m && m.gap <= 8, JSON.stringify(m));
  const m2 = await settle(1800);
  check(`窗口跟随（${label}）：流式长出来也贴底`, m2 && m2.gap <= 8, JSON.stringify(m2));
};
check("回合流是独立滚动容器（不是整页滚）", (await streamMetrics())?.overflow === "auto");
await followAfterSend("BOT 工作台");
const wsMetrics = await streamMetrics();
check("BOT 工作台：回合流自己滚、整页不动", Boolean(wsMetrics && wsMetrics.overflow === "auto" && !wsMetrics.pageScrolled), JSON.stringify(wsMetrics));

// 另一条入口：从机器人列表 / 派单进来的是 view "bot"，外壳必须同样整页填充
await run(`
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
  for (let i = 0; i < 40 && !document.querySelector(".wide.bot-workspace"); i++) await new Promise((r) => setTimeout(r, 25));
  // 外壳在，但必须真的有一条会话打开着，才有转录可量（会话列表态没有 .bot-stream）
  const item = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (item) { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  for (let i = 0; i < 40 && !document.querySelector(".wide.bot-workspace .bot-stream"); i++) await new Promise((r) => setTimeout(r, 25));
  // 上一段用例可能把「看哪条会话」复位成列表态：这里按用户的路径点开一条会话，再量转录
  if (!document.querySelector(".bot-stream")) {
    const row = document.querySelector(".bot-chat-row-main");
    if (row) { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    for (let i = 0; i < 40 && !document.querySelector(".bot-stream"); i++) await new Promise((r) => setTimeout(r, 25));
  }
  // 刚打开会话时会在恢复上次阅读位置（500ms 落盘节流）：先等它落定并贴到底，
  // 「跟不跟新内容」才是这条用例要测的东西
  await new Promise((r) => setTimeout(r, 400));
  const st = document.querySelector(".bot-stream");
  if (st) { st.scrollTop = st.scrollHeight; st.dispatchEvent(new Event("scroll", { bubbles: true })); }
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("view=bot 也用整页填充外壳（否则整页滚，跟不上）", await ev(`(() => { const shell = document.querySelector(".wide.bot-workspace"); if (!shell) return false; const stream = document.querySelector(".bot-stream"); return !stream || shell.contains(stream); })()`));
await run(`
  const vis = (el) => el.getBoundingClientRect().width > 0;
  const item = [...document.querySelectorAll(".bot-item")].find((b) => vis(b) && b.textContent.includes("项目群"));
  if (item) item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 120 && ![...document.querySelectorAll(".bot-stream")].some(vis); i++) await new Promise((r) => setTimeout(r, 25));
  return true;`);
const botMetrics = await streamMetrics();
check("view=bot：回合流自己滚、整页不动", Boolean(botMetrics && botMetrics.overflow === "auto" && !botMetrics.pageScrolled), JSON.stringify(botMetrics));
await followAfterSend("view=bot");

// 输入法：候选态的回车只上屏，不发送（SR-Chat-10）
await run(`
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
  await new Promise((r) => setTimeout(r, 400));
  const item = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (item) { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); }
  return true;`);
const composerSet = (text) => `
  const box = document.querySelector(".ds-composer textarea");
  if (!box) throw new Error("没有输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, ${JSON.stringify("")} + ${JSON.stringify("")});
  return box;`;
await run(`
  const vis = (sel) => [...document.querySelectorAll(sel)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const box = vis(".ds-composer textarea");
  if (!box) throw new Error("没有可见的输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "nihao");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  box.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  const before = window.__calls.filter((c) => c.type === "botChat").length;
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
  await new Promise((r) => setTimeout(r, 120));
  const afterIme = window.__calls.filter((c) => c.type === "botChat").length;
  box.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 200));
  const afterEnter = window.__calls.filter((c) => c.type === "botChat").length;
  window.__imeResult = { before, afterIme, afterEnter };
  return true;`);
const ime = await ev(`JSON.stringify(window.__imeResult)`);
const imeObj = JSON.parse(ime || "{}");
check("输入法：候选态回车不发送", imeObj.afterIme === imeObj.before, ime);
check("输入法：上屏后再回车才发送", imeObj.afterEnter === imeObj.before + 1, ime);

// 窗口化：200 轮只画最近 40 个块，点「加载更早」再放一页（SR-Chat-02）
await run(`
  window.__fillTurns(200);
  const b2 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("DE-A"));
  const b1 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (b2) { b2.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); }
  if (b1) { b1.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); }
  return true;`);
await run(`window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" })); await new Promise((r) => setTimeout(r, 400)); return true;`);
await sleep(300);
const winStats = () => ev(`(() => { const s = document.querySelector(".bot-stream"); return JSON.stringify({ blocks: s ? s.children.length : 0, nodes: s ? s.querySelectorAll("*").length : 0, hasEarlier: !!document.querySelector(".ds-load-earlier") }); })()`);
const w1 = JSON.parse((await winStats()) || "{}");
check("窗口化：200 轮只渲染最近 40 个块", w1.blocks > 0 && w1.blocks <= 45, JSON.stringify(w1));
check("窗口化：DOM 节点没爆（≤3000）", w1.nodes <= 3000, JSON.stringify(w1));
check("窗口化：顶上给出「加载更早」", w1.hasEarlier === true, JSON.stringify(w1));
await run(`document.querySelector(".ds-load-earlier")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); return true;`);
await shot(path.join(OUT, "bot-windowed.png"));
const w2 = JSON.parse((await winStats()) || "{}");
check("窗口化：加载更早后多出一页", w2.blocks > w1.blocks, JSON.stringify(w2));

// 跟随阈值 24 + 「N 条新消息」chip（SR-Chat-04/05、IR-Chat-05/11）
await run(`
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
  await new Promise((r) => setTimeout(r, 400));
  const item = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("项目群"));
  if (item) { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); }
  const s = document.querySelector(".bot-stream");
  s.scrollTop = 0;
  s.dispatchEvent(new Event("scroll", { bubbles: true }));
  // 读者往上滚一轮：follow 必须立刻退出
  s.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
  await new Promise((r) => setTimeout(r, 60));
  window.__delta?.({ botId: "b1", groupId: "g1", name: "PM · 项目经理", delta: "（新消息）" });
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
const chip = await ev(`(() => { const b = document.querySelector(".ds-new-msg"); return JSON.stringify({ shown: !!b, text: b ? b.textContent.trim() : "", top: document.querySelector(".bot-stream")?.scrollTop }); })()`);
const chipObj = JSON.parse(chip || "{}");
check("跟随：上翻后出新消息有「N 条新消息」", chipObj.shown === true && /条新消息/.test(chipObj.text), chip);
await shot(path.join(OUT, "bot-new-msg.png"));
await run(`document.querySelector(".ds-new-msg")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); return true;`);
const afterJump = await ev(`(() => { const s = document.querySelector(".bot-stream"); return JSON.stringify({ chip: !!document.querySelector(".ds-new-msg"), gap: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight) }); })()`);
const jumpObj = JSON.parse(afterJump || "{}");
check("跟随：点 chip 回到底部并收起提示", jumpObj.chip === false && jumpObj.gap <= 8, afterJump);

// 可访问性：转录是 log，每轮有可读标签（SR-Chat-14）
const a11y = await ev(`(() => { const s = document.querySelector(".bot-stream"); const box = [...document.querySelectorAll(".ds-composer textarea")].find((el) => el.getBoundingClientRect().width > 0); return JSON.stringify({ role: s.getAttribute("role"), live: s.getAttribute("aria-live"), label: s.getAttribute("aria-label"), articles: document.querySelectorAll('[role="article"]').length, inputLabel: box?.getAttribute("aria-label") || "" }); })()`);
const a11yObj = JSON.parse(a11y || "{}");
check("可访问性：转录 role=log + aria-live", a11yObj.role === "log" && a11yObj.live === "polite", a11y);
check("可访问性：每轮有 role=article 标签", a11yObj.articles > 0, a11y);
// 说话人：回合头必须是人（头像 + 名字），不能只写「已完成」——否则重命名会话后就不知道是谁在说
const speaker = await ev(`(() => {
  const arts = [...document.querySelectorAll(".bot-stream .ds-turn, .bot-stream .ds-assistant")];
  const bad = arts.filter((el) => {
    const attr = el.querySelector(":scope > .ds-bot-attr, :scope > * > .ds-bot-attr") || el.querySelector(".ds-assistant > .ds-bot-attr");
    return !attr || !(attr.querySelector("b")?.textContent || "").trim() || !attr.querySelector(".bot-avatar");
  });
  return JSON.stringify({ total: arts.length, bad: bad.length, first: arts.at(-1)?.querySelector(".ds-bot-attr")?.textContent?.trim() || "" });
})()`);
const speakerObj = JSON.parse(speaker || "{}");
check("说话人：每轮回答都有头像 + 名字", speakerObj.total > 0 && speakerObj.bad === 0, speaker);
check("可访问性：输入框有 aria-label", Boolean(a11yObj.inputLabel), a11y);

// 草稿：打一半切到别的 bot 再切回来还在（SR-Chat-03）
await run(`
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
  await new Promise((r) => setTimeout(r, 400));
  const b1 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (b1) { b1.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); }
  const vis = (sel) => [...document.querySelectorAll(sel)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const box = vis(".ds-composer textarea");
  if (!box) throw new Error("没有可见的输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "打了一半的草稿");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800)); // 等 500ms 节流落盘
  return true;`);
const draftSaved = await ev(`JSON.stringify(window.__calls.filter((c) => c.type === "botUiSave").map((c) => c.payload.draft))`);
check("草稿：输入 500ms 后落盘", /打了一半的草稿/.test(draftSaved || ""), draftSaved);
await run(`
  const b2 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("DE-A"));
  if (b2) { b2.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 350)); }
  const b1 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (b1) { b1.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); }
  return true;`);
const draftRestored = await ev(`([...document.querySelectorAll(".ds-composer textarea")].find((el) => el.getBoundingClientRect().width > 0)?.value) || ""`);
check("草稿：切走再回来还在", draftRestored === "打了一半的草稿", JSON.stringify(draftRestored));

// 阅读位置：滚上去停 500ms 记一次，切走再回来落回原处（SR-Chat-04）
await run(`
  const b2 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("DE-A"));
  if (b2) { b2.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 350)); }
  const b1 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (b1) { b1.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 500)); }
  const s = document.querySelector(".bot-stream");
  s.scrollTop = Math.round(s.scrollHeight * 0.4);
  // 采样的节流是 500ms：连发几次滚动，保证有一次真的落盘
  for (let i = 0; i < 4; i++) {
    s.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 260));
  }
  window.__savedScroll = Math.round(s.scrollTop);
  window.__savedKey = (window.__calls.filter((c) => c.type === "botUiSave" && c.payload.scroll).at(-1) || {}).payload?.key || "";
  return true;`);
const scrollSaved = await ev(`JSON.stringify({ saved: window.__savedScroll, calls: window.__calls.filter((c) => c.type === "botUiSave" && c.payload.scroll).map((c) => c.payload.scroll) })`);
check("阅读位置：滚动 500ms 后落盘 turnId + offset", /turnId/.test(scrollSaved || "") && /offset/.test(scrollSaved || ""), scrollSaved);
await run(`
  const b2 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("DE-A"));
  if (b2) { b2.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 350)); }
  const b1 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (b1) { b1.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 500)); }
  // 回到同一个会话：草稿 / 阅读位置是按「bot + 会话」存的
  const row = [...document.querySelectorAll(".bot-chat-row-main")].find((b) => b.textContent.includes("发布节奏"));
  if (row) { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 700)); }
  return true;`);
const restored = await ev(`(() => {
  const s = document.querySelector(".bot-stream");
  const saved = window.__calls.filter((c) => c.type === "botUiSave" && c.payload.scroll).at(-1);
  const turnId = saved?.payload?.scroll?.turnId;
  const node = turnId ? s.querySelector('[data-turn-id="' + turnId + '"]') : null;
  return JSON.stringify({
    top: Math.round(s.scrollTop),
    turn: turnId,
    wantOffset: saved?.payload?.scroll?.offset ?? null,
    nodeFound: !!node,
    nodeTop: node ? Math.round(node.getBoundingClientRect().top - s.getBoundingClientRect().top) : null,
  });
})()`);
const restoredObj = JSON.parse(restored || "{}");
check("阅读位置：切走再回来后那一轮还在同一个视口位置（±120px）",
  restoredObj.nodeFound === true && Math.abs((restoredObj.nodeTop ?? 9999) - (restoredObj.wantOffset ?? 0)) <= 120, restored);

// 重试：助手消息上有「重试这一轮」，点了复用原轮（SR-Chat-05）
await run(`
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
  await new Promise((r) => setTimeout(r, 400));
  const b1 = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (b1) { b1.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); }
  return true;`);
check("重试：助手消息上有「重试这一轮」", await ev(`!!document.querySelector('.ds-action[aria-label="重试这一轮"]')`));
await run(`
  const before = window.__calls.filter((c) => c.type === "botRetry").length;
  document.querySelector('.ds-action[aria-label="重试这一轮"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const calls = window.__calls.filter((c) => c.type === "botRetry");
  window.__retry = { before, after: calls.length, turnId: calls.at(-1)?.payload?.turnId || "" };
  return true;`);
const retry = await ev(`JSON.stringify(window.__retry)`);
const retryObj = JSON.parse(retry || "{}");
check("重试：点了用 turnId 调 botRetry", retryObj.after === retryObj.before + 1 && Boolean(retryObj.turnId), retry);

// 压缩卡：更早的对话被折成摘要时，转录里有一条系统注记（不是消息）
const digestText = await text(".ds-digest");
check("压缩卡：标明「已压缩 · 只作背景」", /已压缩/.test(digestText) && /摘要/.test(digestText), digestText);

// 反馈：⋯ 里有赞 / 踩，评完这一轮带「已赞」标记（同一轮再点同一个 = 撤销）
await run(`
  const row = document.querySelector(".ds-assistant .ds-actions .row-menu-trigger");
  if (!row) throw new Error("消息动作里没有更多菜单");
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  window.__menu = [...document.querySelectorAll(".row-menu-pop button")].map((b) => b.textContent.trim());
  const btn = [...document.querySelectorAll(".row-menu-pop button")].find((b) => b.textContent.trim() === "赞");
  if (!btn) throw new Error("菜单里没有赞");
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 30 && !/已赞/.test(document.querySelector(".ds-assistant .ds-actions")?.parentElement?.textContent || ""); i++) await new Promise((r) => setTimeout(r, 20));
  return true;`);
const fb = await ev(`(() => {
  const c = window.__calls.filter((x) => x.type === "botFeedback");
  const rows = [...document.querySelectorAll(".ds-assistant")].map((el) => (el.querySelector(".ds-actions")?.parentElement?.textContent || "").slice(-40));
  return JSON.stringify({ calls: c.length, value: c.at(-1)?.payload?.value || "", rows, marked: rows.some((t) => /已赞/.test(t)) });
})()`);
const fbObj = JSON.parse(fb || "{}");
check("反馈：赞写回 botFeedback", fbObj.calls >= 1 && fbObj.value === "up", fb);
check("反馈：评过的这一轮带「已赞」标记", fbObj.marked === true, fb);
// 一行只留 4 个图标：轨迹 / 分支 / 评价 / 用量都在 ⋯ 里
const menuItems = await ev(`JSON.stringify(window.__menu || [])`);
check("更多菜单：轨迹 / 分支 / 赞 / 踩 都在 ⋯ 里", ["看这一轮的轨迹", "赞", "踩"].every((k) => menuItems.includes(k)), menuItems);

// 会话内查找：⌘F 面板命中 + 点击跳到消息并闪一下
await run(`
  const row = document.querySelector(".ds-assistant .ds-actions .row-menu-trigger");
  if (row) row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const input = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (input) input.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
const searchUi = await ev(`(() => {
  const panel = document.querySelector(".chat-search");
  return JSON.stringify({ open: Boolean(panel), hits: panel ? panel.querySelectorAll(".chat-search-hit").length : 0 });
})()`);
const searchObj = JSON.parse(searchUi || "{}");
check("会话内查找：⌘F 打开面板", searchObj.open === true, searchUi);
await run(`
  const panel = document.querySelector(".chat-search");
  const box = panel?.querySelector(".chat-search-input");
  if (!box) throw new Error("没有查找输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(box, "第 17");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
// 命中是异步算出来的（快照刷新 + 防抖）：轮询到有结果再判，别用固定 sleep 赌时序
const hitsCount = await ev(`(async () => { for (let i = 0; i < 40; i++) { const n = document.querySelectorAll(".chat-search-hit").length; if (n) return n; await new Promise((r) => setTimeout(r, 50)); } return 0; })()`);
check("会话内查找：命中列出来", Number(hitsCount) > 0, String(hitsCount));
// 命中列表会随快照刷新重渲染：每轮重新取元素再点，轮询到闪一下为止
await run(`
  const hit = document.querySelector(".chat-search-hit");
  if (hit) hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return true;`);
check("会话内查找：点击跳到那一条并闪一下", await ev(`(async () => {
  for (let i = 0; i < 40; i++) {
    if (document.querySelector(".chat-flash")) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
})()`));
await run(`
  const close = document.querySelector('.chat-search [aria-label="关闭查找"]');
  if (close) close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  return true;`);

// 上下文账：composer 上方一行，显示字符数与记忆占比；>80% 用琥珀文字（不铺底色）
const ctxText = await text(".ds-context");
check("上下文账：显示字符 / 记忆占比", /上下文/.test(ctxText) && /16\.8k/.test(ctxText) && /记忆 85%/.test(ctxText), ctxText);
// 琥珀色直接用 token 探一个基准色，别按 RGB 字面值猜（主题不同值不一样）
const ctxColor = await ev(`(() => {
  const el = document.querySelector(".ds-context");
  if (!el) return "missing";
  const probe = document.createElement("span");
  probe.style.color = "var(--amber)";
  document.body.appendChild(probe);
  const amber = getComputedStyle(probe).color;
  probe.remove();
  const span = el.querySelector("span");
  return JSON.stringify({ warn: el.classList.contains("warn"), amber, span: getComputedStyle(span).color, elColor: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor });
})()`);
const ctxColorObj = JSON.parse(ctxColor || "{}");
check("上下文账：>80% 用琥珀文字（不铺底色）", ctxColorObj.warn === true && ctxColorObj.span === ctxColorObj.amber && ctxColorObj.bg === "rgba(0, 0, 0, 0)", ctxColor);
// 上下文账是入口不是装饰：点它就落到轨迹（能看这一轮的上下文构成）
await run(`
  const el = document.querySelector(".ds-context");
  if (!el) throw new Error("没有上下文账");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 220));
  return true;`);
check("上下文账：点它去轨迹（不是死数字）", await ev(`!!document.querySelector(".ds-trajectory")`));
await run(`
  const tab = [...document.querySelectorAll(".bot-chat-tabs button")].find((b) => b.textContent.trim() === "对话");
  if (tab) tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
await shot(path.join(OUT, "bot-context.png"));

// 失败卡：发送失败落在对话里（不再只有页头 banner），重试复用同一句
await run(`
  const vis = (sel) => [...document.querySelectorAll(sel)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const box = vis(".ds-composer textarea");
  if (!box) throw new Error("没有可见的输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "失败测试：让网关报错");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  // 上一拍可能还在生成（composer 会变成「停止」）：先停下来，再等「发送」回来
  const stopBtn = [...document.querySelectorAll(".ds-action-text")].find((b) => b.textContent.trim() === "停止" && b.getBoundingClientRect().width > 0);
  if (stopBtn) { stopBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); }
  for (let i = 0; i < 40 && !vis(".ds-send"); i++) await new Promise((r) => setTimeout(r, 25));
  const send2 = vis(".ds-send");
  if (!send2) throw new Error("没有可见的发送按钮（仍在生成中）");
  send2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 20 && !document.querySelector(".ds-fail"); i++) await new Promise((r) => setTimeout(r, 25));
  return true;`);
const failCard = await ev(`(() => {
  const card = document.querySelector(".ds-fail");
  return JSON.stringify({
    shown: !!card,
    text: card ? card.textContent : "",
    retry: !!card?.querySelector(".btn.tiny.primary"),
    banner: !!document.querySelector(".bot-banner.fail"),
  });
})()`);
const failObj = JSON.parse(failCard || "{}");
check("失败卡：落在对话里（原因 + 重试）", failObj.shown === true && /502/.test(failObj.text || "") && failObj.retry === true, failCard);
check("失败卡：不再只剩页头 banner", failObj.banner === false, failCard);
await shot(path.join(OUT, "bot-fail.png"));
await run(`
  const before = window.__calls.filter((c) => c.type === "botChat").length;
  document.querySelector(".ds-fail .btn.tiny.primary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  window.__failRetry = { before, after: window.__calls.filter((c) => c.type === "botChat").length };
  return true;`);
const fr = JSON.parse(await ev(`JSON.stringify(window.__failRetry || {})`) || "{}");
check("失败卡：重试复用同一句（再发一次，不复制消息）", (fr.after || 0) === (fr.before || 0) + 1, JSON.stringify(fr));
// 没回也留痕：落库的 failed 回合自己带原因 + 重试，不用回屏幕底部找报错卡
await run(`
  const row = [...document.querySelectorAll(".bot-chat-row-main")].find((b) => b.textContent.includes("发布节奏"));
  if (row && !document.querySelector('[data-turn-id="tfail"]')) { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 350)); }
  return true;`);
check("没回也留痕：转录里有失败行（原因 + 重试）", await ev(`(() => { const r = document.querySelector(".ds-fail-row"); return !!r && /网关 502/.test(r.textContent || "") && !!r.querySelector(".btn.tiny"); })()`));
check("没回也留痕：你说的那句还在（不随报错消失）", await ev(`(() => { const r = document.querySelector(".ds-fail-row")?.closest(".ds-turn"); return !!r && (r.textContent || "").includes("帮我读一下合同.pdf"); })()`));
check("没回也留痕：回合头写「没回」而不是「已完成」", await ev(`(() => { const r = document.querySelector(".ds-fail-row")?.closest(".ds-turn"); return /没回/.test(r?.querySelector(".ds-tag")?.textContent || ""); })()`));
await run(`
  document.querySelector('.ds-fail [aria-label="收起这条报错"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  const vis = (sel) => [...document.querySelectorAll(sel)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const box = vis(".ds-composer textarea");
  if (box) { const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set; setter.call(box, ""); box.dispatchEvent(new Event("input", { bubbles: true })); }
  return true;`);

// 审批队列：右下角一叠卡，不是整屏模态；在这里就能批
await run(`
  window.__pushApprovals([{
    id: "ap-preview", requestId: "1", runId: "r-preview", todoId: "td1",
    title: "运行 npm test", description: "npm test -- --runInBand",
    options: [{ id: "o-allow", name: "允许一次", kind: "allow_once" }, { id: "o-deny", name: "拒绝", kind: "reject_once" }],
  }]);
  await new Promise((r) => setTimeout(r, 150));
  return true;`);
await shot(path.join(OUT, "approval-dock.png"));
const dockUi = await ev(`(async () => {
  const before = document.querySelectorAll(".modal-mask").length;
  const dock = document.querySelector(".approval-dock");
  const card = document.querySelector(".approval-card");
  const allow = [...(card ? card.querySelectorAll("button") : [])].find((b) => /允许/.test(b.textContent || ""));
  const callsBefore = window.__calls.filter((c) => c.type === "approval").length;
  if (allow) allow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const call = window.__calls.filter((c) => c.type === "approval").at(-1);
  window.__pushApprovals([]);
  await new Promise((r) => setTimeout(r, 80));
  return JSON.stringify({
    dock: Boolean(dock), mask: before, allow: Boolean(allow),
    clicked: window.__calls.filter((c) => c.type === "approval").length > callsBefore,
    optionId: call?.payload?.optionId, id: call?.payload?.id,
    cleared: !document.querySelector(".approval-dock"),
  });
})()`);
const dockObj = JSON.parse(dockUi || "{}");
check("审批：队列在右下角，不再用整屏模态", dockObj.dock === true && dockObj.mask === 0, dockUi);
check("审批：在这一叠卡里就能批（按 optionId 回传）", dockObj.allow === true && dockObj.clicked === true && dockObj.optionId === "o-allow" && dockObj.id === "ap-preview", dockUi);
check("审批：批完就从队列里消失", dockObj.cleared === true, dockUi);

// 任务审批档：默认逐条问，可改成「本任务放行」（人点确认后才写库）
const permissionUi = await ev(`(async () => {
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }));
  await new Promise((r) => setTimeout(r, 350));
  const row = [...document.querySelectorAll(".task-row")].find((b) => (b.textContent || "").includes("FEAT-1"));
  if (row) row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  window.dispatchEvent(new Event("harness:chat-tab"));
  await new Promise((r) => setTimeout(r, 250));
  const selects = [...document.querySelectorAll(".ds-composer select.composer-select")];
  const sel = selects.find((s) => [...s.options].some((o) => /审批 · 本任务放行/.test(o.textContent || "")));
  if (!sel) return JSON.stringify({ found: false, labels: selects.map((s) => (s.options[0] || {}).textContent) });
  const before = window.__calls.filter((c) => c.type === "setTodoPermission").length;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(sel, "full-access");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  const confirm = [...document.querySelectorAll(".modal button")].find((b) => /放行/.test(b.textContent || ""));
  if (confirm) confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 220));
  const call = window.__calls.filter((c) => c.type === "setTodoPermission").at(-1);
  const title = sel.getAttribute("title") || "";
  await new Promise((r) => setTimeout(r, 150));
  const now = document.querySelector(".ds-composer select.composer-select.warn");
  const probe = document.createElement("span");
  probe.style.color = "var(--amber)";
  document.body.appendChild(probe);
  const amber = getComputedStyle(probe).color;
  probe.remove();
  return JSON.stringify({ found: true, confirm: Boolean(confirm), calls: window.__calls.filter((c) => c.type === "setTodoPermission").length - before, id: call?.payload?.id, permission: call?.payload?.permission, title,
    warn: Boolean(now), color: now ? getComputedStyle(now).color : "", amber });
})()`);
const permissionObj = JSON.parse(permissionUi || "{}");
check("任务审批档：composer 里能选「逐条问 / 本任务放行」", permissionObj.found === true, permissionUi);
check("任务审批档：放宽前要人确认，确认后写 setTodoPermission", permissionObj.confirm === true && permissionObj.calls === 1 && permissionObj.id === "td1" && permissionObj.permission === "full-access", permissionUi);
await shot(path.join(OUT, "task-approval.png"));
check("授权前告知：审批档的说明里带上执行体和它自己的审批设置", /执行体/.test(permissionObj.title || "") && /审批设置/.test(permissionObj.title || "") && /沙箱|sandbox/.test(permissionObj.title || ""), permissionObj.title);check("任务放行是常驻状态：琥珀文字说（不加底色/徽标）", permissionObj.warn === true && permissionObj.color === permissionObj.amber, permissionUi);

// 聚焦：1px hairline（不是整块 ring / 不发蓝），失焦收起
const focusUi = await ev(`(async () => {
  const box = [...document.querySelectorAll(".ds-composer textarea")].find((t) => t.getBoundingClientRect().width > 0);
  if (!box) return JSON.stringify({ error: "没有输入框" });
  const composer = box.closest(".ds-composer");
  const before = getComputedStyle(composer).outlineWidth;
  box.focus();
  await new Promise((r) => setTimeout(r, 80));
  const after = getComputedStyle(composer).outlineWidth;
  box.blur();
  await new Promise((r) => setTimeout(r, 80));
  return JSON.stringify({ before, after, back: getComputedStyle(composer).outlineWidth });
})()`);
const focusObj = JSON.parse(focusUi || "{}");
check("composer 聚焦给 1px hairline，失焦收起", focusObj.after === "1px" && focusObj.before !== "1px" && focusObj.back !== "1px", focusUi);

// 卡在审批时状态写「等你审批」（不是「等你回答」）
await run(`window.__setRunStatus("waiting_input", "approval"); await new Promise((r) => setTimeout(r, 250)); return true;`);
const approvalLabel = await ev(`(() => {
  const text = (document.querySelector(".ds-running-text")?.textContent || "").trim();
  window.__setRunStatus("done", null);
  return JSON.stringify({ text });
})()`);
check("审批卡住时状态是「等你审批」，不和「等你回答」混", /等你审批/.test(JSON.parse(approvalLabel || "{}").text), approvalLabel);
await sleep(120);

// 执行体自己的审批档：设置在「设置 → 执行 → Agent 角色」，跟随全局时为空
await run(`
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "settings" }));
  await new Promise((r) => setTimeout(r, 300));
  const nav = [...document.querySelectorAll(".settings-nav-item")].find((b) => /执行/.test(b.textContent || ""));
  if (nav) nav.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return true;`);
const agentApproval = await ev(`(() => {
  const select = [...document.querySelectorAll(".settings-agent-row select")].find((s) => [...s.options].some((o) => /跟随全局/.test(o.textContent || "")));
  if (!select) return JSON.stringify({ found: false, rows: document.querySelectorAll(".settings-agent-row").length });
  const before = select.value;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, "deny");
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return JSON.stringify({ found: true, before, options: [...select.options].map((o) => o.textContent) });
})()`);
await sleep(200);
const agentApprovalObj = JSON.parse(agentApproval || "{}");
check("执行体审批档：设置里能选（跟随全局 / 每步询问 / 自动批准 / 自动拒绝）", agentApprovalObj.found === true && agentApprovalObj.before === "" && (agentApprovalObj.options || []).length === 4, agentApproval);
check("执行体审批档：改完写 updateAgent({ approval })", await ev(`(() => window.__calls.some((c) => c.type === "updateAgent" && c.payload && c.payload.approval === "deny"))()`));
await run(`document.querySelector(".settings-agent-row")?.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 200)); return true;`);
await shot(path.join(OUT, "settings-agents.png"));

// 1:1 里 @ 到别的机器人：不是「谁回」，是「把地址交给当前 bot」（对齐 ORCA 的 bot: 地址）
await run(`
  // 这一段跑在最后：先把界面带回机器人页，并确保有一条 1:1 会话打开着
  window.dispatchEvent(new CustomEvent("harness:view", { detail: "bot" }));
  await new Promise((r) => setTimeout(r, 400));
  const item = [...document.querySelectorAll(".bot-item")].find((b) => b.textContent.includes("PM"));
  if (item) { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); }
  const vis = (node) => node.getBoundingClientRect().width > 0;
  if (![...document.querySelectorAll(".ds-composer textarea")].some(vis)) {
    const row = [...document.querySelectorAll(".bot-chat-row-main")].find((r) => r.getBoundingClientRect().width > 0);
    if (row) { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 350)); }
  }
  const box = [...document.querySelectorAll(".ds-composer textarea")].find(vis);
  if (!box) throw new Error("1:1 没有可见输入框");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "@");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  return true;`);
const oneToOneMention = await ev(`(() => {
  const options = [...document.querySelectorAll('.im-mention[role="option"]')].map((el) => el.textContent.trim());
  return JSON.stringify({
    open: !!document.querySelector(".im-mention-pop"),
    options,
    everyone: !!document.querySelector("#im-mention-everyone"),
    expanded: document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute("aria-expanded") : null,
  });
})()`);
const oneToOneObj = JSON.parse(oneToOneMention || "{}");
check("1:1 @：能弹出机器人候选（不再只有群聊）", oneToOneObj.open === true && oneToOneObj.options.some((x) => x.includes("DE-A")), oneToOneMention);
check("1:1 @：没有 everyone，也不列自己", oneToOneObj.everyone === false && oneToOneObj.options.every((x) => !x.includes("PM · 项目经理")), oneToOneMention);
await run(`
  const vis = (node) => node.getBoundingClientRect().width > 0;
  const box = [...document.querySelectorAll(".ds-composer textarea")].find(vis);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "@DE-A");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const beforeSend = window.__calls.filter((c) => c.type === "botChat").length;
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 120));
  window.__mentionDraft = { value: box.value, sent: window.__calls.filter((c) => c.type === "botChat").length - beforeSend };
  return true;`);
const mentionDraft = await ev(`JSON.stringify(window.__mentionDraft || {})`);
const md = JSON.parse(mentionDraft || "{}");
check("1:1 @：Enter 插入 @DE-A，不直接把消息发出去", String(md.value || "").startsWith("@DE-A") && md.sent === 0, mentionDraft);
await run(`
  const vis = (node) => node.getBoundingClientRect().width > 0;
  const box = [...document.querySelectorAll(".ds-composer textarea")].find(vis);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(box, "@DE-A 帮我看看首页接口");
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const send = [...document.querySelectorAll(".ds-send")].find(vis);
  if (!send) throw new Error("1:1 没有可见发送按钮");
  send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return true;`);
const mentionPayload = await ev(`(() => {
  const call = window.__calls.filter((c) => c.type === "botChat").at(-1);
  return JSON.stringify({ text: call?.payload?.text || "", mentions: call?.payload?.mentions || null });
})()`);
const mp = JSON.parse(mentionPayload || "{}");
check("1:1 @：发送时带上 mentions（结构化 id，不靠解析文本）", Array.isArray(mp.mentions) && mp.mentions.some((m) => m.id === "b2"), mentionPayload);
await run(`
  const vis = (node) => node.getBoundingClientRect().width > 0;
  const box = [...document.querySelectorAll(".ds-composer textarea")].find(vis);
  if (box) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, "");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.blur();
  }
  const el = [...document.querySelectorAll(".bot-stream")].find(vis);
  if (el) { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll", { bubbles: true })); }
  await new Promise((r) => setTimeout(r, 200));
  return true;`);

check("没有控制台报错", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));


console.log(`\n${fails ? `✗ ${fails} 项失败` : "全部通过"} · 截图：${OUT}/bot-chats.png、bot-chat.png、bot-chat-peek.png、bot-chat-dark.png、bot-group-stream.png、bot-mention.png、bot-mention-dark.png、approval-dock.png、task-approval.png、settings-agents.png`);
ws.close();
cleanup();
process.exit(fails ? 1 : 0);
