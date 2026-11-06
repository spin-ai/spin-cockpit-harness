import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync, execFile } from "node:child_process";
import pty from "node-pty";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { fileURLToPath } from "node:url";
import { openDb, DEFAULT_SETTINGS } from "./db.mjs";
import { AcpClient, dshPathEnv } from "./acp.mjs";
import { prepareWorktree, removeWorktree } from "./worktree.mjs";
import { pickElement, cancelPick, detachPreview } from "./preview.mjs";
import { formatContext, detectDevUrl } from "./ui-context.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL;
const workspaceRoot = path.join(app.getPath("documents"), "YieldMind", "workspace");
const DSH_BUNDLE_DIR = "dsh";
const DSH_BUNDLE_ENTRY = process.platform === "win32" ? "dsh.exe" : "dsh";
let dshBundlePathCache; // undefined = 未计算；null = 没有内置运行时
let dshBundleManifestCache; // undefined = 未读取

/** 内置 dsh 单文件运行时的路径（打包后在 Resources/dsh，开发时在仓库 resources/dsh）。 */
function bundledDshPath() {
  if (dshBundlePathCache !== undefined) return dshBundlePathCache;
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, DSH_BUNDLE_DIR, DSH_BUNDLE_ENTRY) : null,
    path.join(app.getAppPath(), "resources", DSH_BUNDLE_DIR, DSH_BUNDLE_ENTRY),
    path.join(__dirname, "..", "resources", DSH_BUNDLE_DIR, DSH_BUNDLE_ENTRY),
  ].filter(Boolean);
  dshBundlePathCache = null;
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) { dshBundlePathCache = candidate; break; } } catch { /* ignore */ }
  }
  return dshBundlePathCache;
}

function bundledDshManifest() {
  if (dshBundleManifestCache !== undefined) return dshBundleManifestCache;
  const bin = bundledDshPath();
  dshBundleManifestCache = null;
  if (bin) {
    try { dshBundleManifestCache = JSON.parse(fs.readFileSync(path.join(path.dirname(bin), "manifest.json"), "utf8")); } catch { /* ignore */ }
  }
  return dshBundleManifestCache;
}

/** 实际会被 Chat run 使用的 dsh 来源，给设置页展示。 */
function dshRuntimeInfo() {
  const custom = String(store?.state?.settings?.dshBinary || "").trim();
  if (custom) return { source: "custom", path: custom, version: null };
  const bin = bundledDshPath();
  if (bin) return { source: "bundled", path: bin, version: bundledDshManifest()?.version || null };
  return { source: "system", path: null, version: null };
}

/** 远端 run 只能用远端自己的 dsh；绝对本地路径不能发过去。 */
function remoteDshBin() {
  const custom = String(store.state.settings?.dshBinary || "").trim();
  return custom && !custom.includes("/") && !custom.includes("\\") ? custom : "dsh";
}

// ── Chat 执行适配器 ───────────────────────────────────────────────────
// Agent.cli 只有登记了 executor 的才能从 Chat 派活。目前只有 dsh（ACP）接入；
// 其他 CLI 仍是「终端专用」，不静默回退到 dsh，避免选 pi 实际跑 dsh。
const EXECUTORS = [
  { id: "dsh", label: "dsh · ACP", kind: "acp", implemented: true, supportsSteer: true },
  { id: "pi", label: "pi · 终端专用", kind: "native", implemented: false, supportsSteer: false },
  { id: "claude", label: "claude · 终端专用", kind: "native", implemented: false, supportsSteer: false },
  { id: "codex", label: "codex · 终端专用", kind: "native", implemented: false, supportsSteer: false },
  { id: "opencode", label: "opencode · 终端专用", kind: "native", implemented: false, supportsSteer: false },
];

function executorFor(agentOrCli) {
  const cli = String(typeof agentOrCli === "string" ? agentOrCli : agentOrCli?.cli || "").trim().toLowerCase();
  return EXECUTORS.find((e) => e.id === cli) || null;
}

function chatRunnable(agent) {
  return Boolean(agent && executorFor(agent)?.implemented);
}

function chatAgentError(agent) {
  if (!agent) return "未选择 Agent";
  const executor = executorFor(agent);
  if (!executor) return `Agent「${agent.name}」的 CLI「${agent.cli}」还没有 Chat 执行适配器；目前只有 dsh 可以从 Chat 派活。`;
  if (!executor.implemented) return `「${agent.cli}」还没有接入 Chat 执行适配器；目前只有 dsh 可以从 Chat 派活，其他 CLI 请在终端里运行。`;
  const host = store.state.hosts.find((h) => h.id === agent.hostId);
  if (host?.kind !== "ssh" && !executorList().find((e) => e.id === executor.id)?.available) {
    return `未检测到可用的 ${executor.id}：请先安装，或在设置 → 执行里配置可执行文件路径。`;
  }
  return null;
}

function pickChatAgent(...ids) {
  for (const id of ids) {
    if (!id) continue;
    const agent = store.state.agents.find((a) => a.id === id);
    if (chatRunnable(agent)) return agent;
  }
  return null;
}

/** 草稿会话的默认 Agent：设置里的默认值 → 项目 Agent → 任意可用 Agent。 */
function defaultChatAgent(projectId = store.state.activeProjectId) {
  const preferred = pickChatAgent(store.state.settings?.defaultAgentId);
  if (preferred) return preferred;
  const runnable = store.state.agents.filter(chatRunnable);
  // 不跨项目兜底：当前项目没有可用 Agent 时，让用户显式纳管
  return runnable.find((a) => a.projectId === projectId) || runnable.find((a) => !a.projectId) || null;
}

/** 探测到的 CLI + 内置 dsh，给渲染层展示「哪些能派活」。 */
function executorList() {
  const caps = new Set(store.state.cliCapabilities || []);
  if (store.state.settings?.dshBinary || bundledDshPath()) caps.add("dsh");
  return EXECUTORS.map((e) => ({ ...e, available: caps.has(e.id) }));
}
const active = new Map();
/** 探测连续失败计数（内存级）：连续 2 次才标离线，防一次网络抖动把队列卡住 */
const probeFails = new Map();
let win = null;
let store = null;
const approvals = new Map();
const terminals = new Map();
const terminalUrls = new Map();
const PROJECT_COLORS = ["teal", "indigo", "amber", "slate", "orange"];

function slugify(input) {
  return String(input || "project").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "project";
}

function uniqueAlias(base, self) {
  const taken = new Set([
    ...store.state.projects.filter((p) => p !== self).map((p) => (p.alias || "").toLowerCase()),
    ...store.state.agents.map((a) => (a.alias || "").toLowerCase()),
  ].filter(Boolean));
  let alias = slugify(base);
  let i = 2;
  while (taken.has(alias)) alias = `${slugify(base)}-${i++}`;
  return alias;
}

function uniqueAgentAlias(base, projectId) {
  const taken = new Set(store.state.agents.filter((a) => a.projectId === projectId).map((a) => (a.alias || "").toLowerCase()));
  let alias = slugify(base);
  let i = 2;
  while (taken.has(alias)) alias = `${slugify(base)}-${i++}`;
  return alias;
}

function mentionOf(text) {
  const m = String(text || "").match(/(?:^|\s)@([a-zA-Z0-9_.-]+)/);
  return m ? m[1] : null;
}

function activeProject() {
  const { state } = store;
  return state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0] || null;
}

function activeProjectPath() {
  return activeProject()?.path || store.state.projectPath || workspaceRoot;
}

function ensureProjects() {
  const { state } = store;
  if (!state.projects.length) {
    const dir = state.projectPath || workspaceRoot;
    state.projects.push({
      id: "p-local", name: path.basename(dir) || "默认项目", path: dir, desc: "",
      color: "teal", status: "in_progress", createdAt: Date.now(), lastOpenedAt: Date.now(),
    });
  }
  for (const p of state.projects) {
    if (!p.alias) p.alias = uniqueAlias(p.name || path.basename(p.path) || "project", p);
    if (!p.name) p.name = path.basename(p.path) || p.path;
    if (!p.color) p.color = "slate";
    if (!p.status) p.status = "in_progress";
    if (!p.createdAt) p.createdAt = Date.now();
    if (!p.lastOpenedAt) p.lastOpenedAt = p.createdAt;
  }
  for (const a of state.agents) if (!a.alias) a.alias = uniqueAlias(a.cli || a.name || "agent");
  if (!state.projects.some((p) => p.id === state.activeProjectId)) state.activeProjectId = state.projects[0].id;
  const current = activeProject();
  state.projectPath = current.path;
  for (const todo of state.todos) if (!todo.projectId) todo.projectId = current.id;
  fs.mkdirSync(current.path, { recursive: true });
}

// ── threads ────────────────────────────────────────────────────────────
// 会话（thread）是消息的宿主；任务只是会话的产物，因此 thread 可以先于 todo 存在。
function newThreadRecord({ projectId = null, agentId = null, title = "新任务" } = {}) {
  // projectId 为空 = 全局对话（不绑定项目）；只有显式指定作用域才绑定项目
  const project = projectId ? store.state.projects.find((p) => p.id === projectId) || null : null;
  return {
    id: store.nextId("th"), todoId: null, title,
    projectId: project?.id || null, project: project?.path || "",
    agentId: agentId || defaultChatAgent(project?.id || store.state.activeProjectId)?.id || null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function threadForTodo(todo) {
  let thread = store.state.threads.find((t) => t.todoId === todo.id);
  if (thread) return thread;
  thread = {
    id: store.nextId("th"), todoId: todo.id, title: todo.title || "",
    projectId: todo.projectId || null, project: todo.cwd || activeProjectPath(),
    agentId: todo.agentId || null,
    createdAt: todo.createdAt || Date.now(), updatedAt: Date.now(),
  };
  store.state.threads.push(thread);
  return thread;
}

// 启动时补齐：每个 todo 一个 thread，并且始终保留一个空白的“新任务”会话
function ensureThreads() {
  const project = activeProject();
  for (const todo of store.state.todos) threadForTodo(todo);
  // 一次性迁移：旧版「未派活会话」一律变成全局对话，避免 Chat 跟着项目切换消失
  if (!store.state.chatScopeMigrated) {
    for (const thread of store.state.threads) {
      if (!thread.todoId) { thread.projectId = null; thread.project = ""; }
    }
    store.state.chatScopeMigrated = true;
  }
  for (const thread of store.state.threads) {
    if (thread.projectId && !store.state.projects.some((p) => p.id === thread.projectId)) {
      thread.projectId = thread.todoId ? project?.id || null : null;
    }
    if (!thread.project) thread.project = store.state.projects.find((p) => p.id === thread.projectId)?.path || "";
  }
  const draft = store.state.threads.find((t) => !t.todoId);
  if (draft) {
    if (!draft.agentId || !chatRunnable(store.state.agents.find((a) => a.id === draft.agentId))) {
      draft.agentId = defaultChatAgent(draft.projectId || store.state.activeProjectId)?.id || null;
    }
    return;
  }
  store.state.threads.push(newThreadRecord({ title: "新任务" }));
}

/** 项目切换 / 新增项目时，保证有一个全局空会话（不绑定项目） */
function ensureGlobalDraft() {
  if (store.state.threads.some((t) => !t.todoId)) return;
  store.state.threads.push(newThreadRecord({ title: "新任务" }));
}

function queueRun(todo, agent, trigger = "assign", parentRunId = null) {
  const run = {
    id: store.nextId("r"), todoId: todo.id, agentId: agent.id, status: "queued", trigger,
    startedAt: null, endedAt: null, cost: 0, tokens: null, error: null, parentRunId, cwd: "", branch: null,
    // 统计口径：createdAt 用于排队时长，其余待 run 结束 / ACP 回包后回填（见 docs/ARCH-hosts-stats.md）
    hostId: agent.hostId || null, createdAt: Date.now(), tokensIn: null, tokensOut: null,
    usageSource: "unknown", errorClass: null, exitCode: null, queueWaitMs: null, durationMs: null, queueReason: null,
  };
  store.state.runs.push(run);
  todo.status = "queued";
  todo.updatedAt = Date.now();
  store.addEvent("run.queued", `run.queued ${todo.key} ${agent.name}`);
  return run;
}

function resolveThread({ threadId, projectId, agentId }) {
  let thread = threadId ? store.state.threads.find((t) => t.id === threadId) : null;
  if (!thread) thread = store.state.threads.find((t) => !t.todoId) || null;
  if (!thread) {
    thread = newThreadRecord({ projectId: projectId || null, agentId, title: "新任务" });
    store.state.threads.push(thread);
  }
  const project = store.state.projects.find((p) => p.id === (projectId || thread.projectId));
  if (project && thread.projectId !== project.id) {
    thread.projectId = project.id;
    thread.project = project.path;
  }
  if (agentId) thread.agentId = agentId;
  thread.updatedAt = Date.now();
  return thread;
}

function activeRunOf(todoId) {
  return store.state.runs.find((r) => r.todoId === todoId && ["running", "waiting_input"].includes(r.status)) || null;
}

// 纠偏投递：pending → injected / failed，失败不再伪装成“已注入”
function deliverSteer({ thread, todo, run, messageId, text }) {
  const handle = active.get(run.id);
  if (!handle) {
    store.updateMessage(messageId, { delivery: "failed" });
    store.addMessage(thread.id, run.id, "system", "error", "投递失败：当前运行未连接。可等任务结束后重发。");
    return "failed";
  }
  store.updateMessage(messageId, { delivery: "pending" });
  store.addEvent("run.message", `run.message pending ${todo.key}`);
  handle.client.prompt(text)
    .then(() => {
      // run 可能已结束/已停止（settlePendingSteers 先标 failed），只更新仍 pending 的消息
      const current = store.state.messages.find((m) => m.id === messageId);
      if (current && current.delivery === "pending") {
        store.updateMessage(messageId, { delivery: "injected", injected: true });
        store.addEvent("run.message", `run.message injected ${todo.key}`);
      }
      broadcast();
    })
    .catch((err) => {
      const current = store.state.messages.find((m) => m.id === messageId);
      if (current && current.delivery === "pending") store.updateMessage(messageId, { delivery: "failed" });
      store.addEvent("run.steer_failed", `run.steer_failed ${todo.key} ${String(err?.message || err).slice(0, 160)}`);
      broadcast();
    });
  return "pending";
}

// run 结束时，所有未拿到回执的纠偏消息一律标失败，不留在“投递中”
function settlePendingSteers(runId) {
  for (const msg of store.state.messages) {
    if (msg.runId === runId && msg.delivery === "pending") msg.delivery = "failed";
  }
}

function contextDetail() {
  return store.state.settings?.contextDetail === "compact" ? "compact" : "standard";
}

function snapshot() {
  const current = activeProject();
  return {
    ...store.state,
    summary: {
      activeRuns: store.state.runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length,
      cost: Number(store.state.runs.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)),
      tokens: store.state.runs.reduce((s, r) => s + (r.tokens || 0), 0),
      failures: store.state.runs.filter((r) => r.status === "failed").length,
    },
    activeProjectId: current?.id || null,
    approvals: [...approvals.values()],
    settings: store.state.settings || { ...DEFAULT_SETTINGS },
    // 只给渲染层：哪些 Agent 真的能从 Chat 派活（executor 已接入）
    agents: store.state.agents.map((a) => ({ ...a, chatRunnable: chatRunnable(a) })),
    executors: executorList(),
    dbPath: store.file,
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
    dshRuntime: dshRuntimeInfo(),
    workspacePath: current?.path || store.state.projectPath || workspaceRoot,
    projectPath: current?.path || store.state.projectPath || workspaceRoot,
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("harness:state", snapshot());
  store.persist();
}

function seed() {
  const { state } = store;
  ensureProjects();
  const bins = ["dsh", "pi", "claude", "codex", "opencode"];
  const searchEnv = dshPathEnv();
  state.cliCapabilities = bins.filter((bin) => spawnSync("which", [bin], { encoding: "utf8", env: searchEnv }).status === 0);
  // 内置 dsh 即使不在 PATH 里也算可用
  if (bundledDshPath() && !state.cliCapabilities.includes("dsh")) state.cliCapabilities.unshift("dsh");
  for (const a of state.agents) {
    if (!a.alias) a.alias = uniqueAlias(a.cli || a.name || "agent");
    if (!a.projectId) a.projectId = state.activeProjectId;
  }
  ensureThreads();
  if (state.hosts.length) {
    // 每次启动刷新本机 caps：CLI 在装机/升级后会变，主机页不该长期显示旧版本
    const local = state.hosts.find((h) => h.kind === "local");
    if (local) { try { probeLocalHost(local); } catch { /* 探测失败不影响启动 */ } }
    store.persist();
    return;
  }
  const local = { id: "h-local", name: "local", kind: "local", addr: "127.0.0.1", status: "online", heartbeat: 0, version: "0.2.0", port: 22, user: "", caps: [], lastProbe: null, latencyMs: null, maxConcurrency: 0, defaultCwd: "", probeError: null };
  state.hosts.push(local);
  try { probeLocalHost(local); } catch { /* ignore */ }
  fs.mkdirSync(activeProjectPath(), { recursive: true });
  store.addEvent("host.online", `local host ready · ${(local.caps || []).length} CLI(s) available`);
  store.persist();
}

function tick() {
  const { state } = store;
  const cap = Number(state.settings?.maxConcurrentRuns) || 0;
  const runningCount = () => state.runs.filter((r) => ["running", "waiting_input"].includes(r.status)).length;
  for (const run of state.runs.filter((r) => r.status === "queued")) {
    const todo = state.todos.find((t) => t.id === run.todoId);
    const agent = state.agents.find((a) => a.id === run.agentId);
    if (!todo || !agent) continue;
    const host = state.hosts.find((h) => h.id === agent.hostId);
    if (!host || host.status !== "online") { run.queueReason = "主机离线"; continue; }
    if (cap > 0 && runningCount() >= cap) { run.queueReason = "等待全局并发"; continue; }
    // 主机级并发（reference 的机器负载思路，单机也用来暴露「都挤在一台机器上」）
    const hostCap = Number(host.maxConcurrency) || 0;
    if (hostCap > 0) {
      const hostBusy = state.runs.filter((r) => r.hostId === host.id && ["running", "waiting_input"].includes(r.status)).length;
      if (hostBusy >= hostCap) { run.queueReason = `主机并发已满 · ${host.name}`; continue; }
    }
    const busy = state.runs.filter((r) => r.agentId === agent.id && ["running", "waiting_input"].includes(r.status)).length;
    if (busy >= (agent.max || 1)) continue;
    const sameCwd = state.runs.some((r) => {
      const t = state.todos.find((x) => x.id === r.todoId);
      return t && ["running", "waiting_input"].includes(r.status) && (t.cwd || agent.cwd) === (todo.cwd || agent.cwd);
    });
    if (sameCwd) continue;
    void startRun(run, todo, agent);
  }
}

async function startRun(run, todo, agent) {
  const host = store.state.hosts.find((h) => h.id === agent.hostId);
  const isRemote = host?.kind === "ssh";
  const baseCwd = todo.cwd || agent.cwd || workspaceRoot;
  const thread = threadForTodo(todo);
  // 最后一道闸：没有对应 executor 的 CLI 不能悄悄用 dsh 跑
  const executorErr = chatAgentError(agent);
  if (executorErr) {
    run.status = "failed";
    run.endedAt = Date.now();
    run.error = executorErr;
    run.errorClass = "unsupported_cli";
    todo.status = "todo";
    todo.lastRunFailed = true;
    store.addMessage(thread.id, run.id, "system", "error", `run 失败：${executorErr}`);
    store.addEvent("run.failed", `run.failed todo=${todo.key} ${executorErr}`);
    broadcast();
    tick();
    return;
  }
  let cwd = baseCwd;
  let branch = null;
  if (isRemote) {
    if (!String(baseCwd).startsWith("/")) throw new Error("远程任务需要绝对路径 cwd");
    run.cwd = cwd;
    run.branch = null;
    store.addEvent("run.remote", `run.remote ${host.name} cwd=${cwd}`);
  } else {
    const worktree = prepareWorktree({ cwd: baseCwd, todoKey: todo.key, runId: run.id });
    cwd = worktree.cwd;
    branch = worktree.branch;
    run.cwd = cwd;
    run.branch = branch;
    fs.mkdirSync(cwd, { recursive: true });
    if (worktree.created) store.addEvent("run.worktree", `run.worktree ${cwd} @ ${worktree.branch}`);
    else if (worktree.error) store.addEvent("run.worktree", `worktree skipped: ${worktree.error}`);
  }
  run.status = "running";
  run.startedAt = Date.now();
  run.hostId = host?.id || run.hostId || null;
  run.queueReason = null;
  run.queueWaitMs = run.createdAt ? Math.max(0, run.startedAt - run.createdAt) : null;
  todo.status = "in_progress";
  todo.lastRunFailed = false;
  store.addMessage(thread.id, run.id, "system", "system", `run ${run.id} started · ${agent.name}`);
  store.addEvent("run.started", `run.started todo=${todo.key} agent=${agent.name} cwd=${cwd}`);
  broadcast();

  const client = new AcpClient({
    cwd,
    ssh: isRemote ? { host: host.addr, port: host.port, user: host.user } : null,
    // 本地：设置覆盖 > 内置单文件运行时 > PATH 里的 dsh
    bin: isRemote ? remoteDshBin() : (store.state.settings?.dshBinary || bundledDshPath() || undefined),
    home: store.state.settings?.dshHome || undefined,
    model: store.state.settings?.model || undefined,
    effort: store.state.settings?.effort || undefined,
  });
  const handle = { client, threadId: thread.id, streamId: null, thoughtId: null, tools: new Map(), done: false, stderr: "" };
  active.set(run.id, handle);

  client.on("stderr", (text) => {
    handle.stderr = (handle.stderr + text).slice(-16000);
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^Error: |Cannot find (module|package)|plugin tree failed|failed to import loader entry/.test(line)) {
        store.addEvent("run.stderr", `run.stderr ${line.slice(0, 300)}`);
      }
    }
  });
  client.on("permission", (params) => {
    const policy = store.state.settings?.approvalPolicy || "ask";
    if (policy === "allow" || policy === "deny") {
      const allow = policy === "allow";
      const ok = client.respondPermission(params.requestId, allow);
      store.addEvent("run.approval", `run.approval auto ${allow ? "allow" : "deny"} ok=${ok}`);
      store.addMessage(thread.id, run.id, "system", "system", `自动${allow ? "批准" : "拒绝"}：${params.title || "工具调用"}`);
      broadcast();
      return;
    }
    run.status = "waiting_input";
    const approval = {
      id: `ap-${params.requestId}`,
      requestId: params.requestId,
      runId: run.id,
      todoId: todo.id,
      title: params.title || "需要审批",
      description: params.description || "",
      options: (params.options || []).map((o) => ({ id: o.optionId, name: o.name, kind: o.kind })),
    };
    approvals.set(approval.id, approval);
    store.addEvent("run.permission", `run.permission ${approval.title} waiting`);
    store.addMessage(thread.id, run.id, "system", "system", `等待审批：${approval.title}`);
    broadcast();
  });
  client.on("notification", (method, params) => {
    if (method !== "session/update") return;
    handleUpdate(run, todo, handle, params?.update || {});
  });

  try {
    await client.start();
    const session = await client.newSession(cwd);
    await client.configure();
    // 本轮 run 绑定的用户指令（派活/纠偏重跑）；派活原话已由任务标题承载，不重复。
    const userMessages = store.state.messages
      .filter((m) => m.threadId === thread.id && m.runId === run.id && m.role === "user");
    const instructions = userMessages
      .map((m) => String(m.content || "").trim())
      .filter((text) => text && text !== todo.title && text.replace(/@[a-zA-Z0-9_.-]+/g, "").trim() !== todo.title);
    const contexts = userMessages
      .filter((m) => m.context)
      .map((m) => formatContext(m.context, contextDetail()))
      .filter(Boolean);
    const prompt = [
      `任务：${todo.title}`,
      todo.desc ? `描述：${todo.desc}` : "",
      todo.acceptance?.length ? `验收：${todo.acceptance.join("；")}` : "",
      instructions.length ? `补充指令：\n${instructions.map((text) => `- ${text}`).join("\n")}` : "",
      contexts.length ? `界面上下文：\n${contexts.join("\n\n")}` : "",
      "完成后给出结论；如需改文件请直接修改。",
    ].filter(Boolean).join("\n");
    const res = await client.prompt(prompt);
    for (const [id, a] of approvals) if (a.runId === run.id) approvals.delete(id);
    run.status = "completed";
    run.endedAt = Date.now();
    applyRunUsage(run, res);
    todo.status = "in_review";
    store.addMessage(thread.id, run.id, "system", "system", `run 结束 · ${res?.stopReason || "end_turn"}`);
    store.addEvent("run.finished", `run.finished todo=${todo.key}`);
    store.state.inbox.unshift({ id: store.nextId("i"), todoId: todo.id, kind: "review", title: `待验收 · ${todo.title}`, at: Date.now(), read: false });
    await client.close();
  } catch (err) {
    for (const [id, a] of approvals) if (a.runId === run.id) approvals.delete(id);
    if (!handle.done) {
      run.status = "failed";
      run.endedAt = Date.now();
      const base = String(err?.message || err);
      const detail = summarizeStderr(handle.stderr || err?.stderr || "");
      run.error = (detail ? `${base} · ${detail}` : base).slice(0, 800);
      run.errorClass = classifyError(run.error, err?.code ?? err?.exitCode);
      run.exitCode = Number.isFinite(err?.exitCode) ? err.exitCode : null;
      todo.status = "todo";
      todo.lastRunFailed = true;
      store.addMessage(thread.id, run.id, "system", "error", `run 失败：${run.error}`);
      store.addEvent("run.failed", `run.failed todo=${todo.key} ${run.error}`);
      store.state.inbox.unshift({ id: store.nextId("i"), todoId: todo.id, kind: "failed", title: `失败 · ${todo.title}`, at: Date.now(), read: false });
      try { await client.close(); } catch { /* ignore */ }
    }
  } finally {
    handle.done = true;
    if (run.endedAt && run.startedAt) run.durationMs = Math.max(0, run.endedAt - run.startedAt);
    settlePendingSteers(run.id);
    active.delete(run.id);
    broadcast();
    tick();
  }
}

function handleUpdate(run, todo, handle, u) {
  const threadId = handle.threadId || threadForTodo(todo).id;
  handle.threadId = threadId;
  if (u.sessionUpdate === "agent_message_chunk") {
    const text = u.content?.text;
    if (!text) return;
    if (!handle.streamId) handle.streamId = store.addMessage(threadId, run.id, "agent", "text", text).id;
    else {
      const m = store.state.messages.find((x) => x.id === handle.streamId);
      store.updateMessage(handle.streamId, { content: (m?.content || "") + text });
    }
  } else if (u.sessionUpdate === "agent_thought_chunk") {
    const text = u.content?.text;
    if (!text) return;
    if (!handle.thoughtId) handle.thoughtId = store.addMessage(threadId, run.id, "agent", "thought", text).id;
    else {
      const m = store.state.messages.find((x) => x.id === handle.thoughtId);
      store.updateMessage(handle.thoughtId, { content: (m?.content || "") + text });
    }
  } else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
    const key = u.toolCallId || store.nextId("tool");
    const title = u.title || u.kind || "tool";
    const content = `${title}${u.status ? ` · ${u.status}` : ""}`;
    const existing = handle.tools.get(key);
    if (existing) store.updateMessage(existing, { content });
    else handle.tools.set(key, store.addMessage(threadId, run.id, "tool", "tool", content).id);
    store.addEvent("run.tool", `run.tool ${title} ${u.status || ""}`);
    const raw = u.rawInput || {};
    const rawFile = raw.path || raw.file_path || raw.filePath;
    if (rawFile) {
      const file = path.isAbsolute(String(rawFile)) ? String(rawFile) : path.join(run.cwd || todo.cwd || workspaceRoot, String(rawFile));
      if (!store.state.artifacts.some((a) => a.todoId === todo.id && a.ref === file)) {
        store.state.artifacts.push({
          id: store.nextId("a"), todoId: todo.id, runId: run.id, kind: "file",
          title: path.basename(file), origin: "agent", ref: file,
          deepLink: `yieldmind-ide://open?path=${encodeURIComponent(file)}`, createdAt: Date.now(),
        });
        store.addEvent("artifact.created", `artifact.created ${file}`);
      }
    }
  } else if (u.sessionUpdate === "plan") {
    store.addEvent("run.plan", `run.plan ${(u.entries || []).length} steps`);
  }
  broadcast();
}

async function probeHost(host) {
  if (!host) throw new Error("host not found");
  if (host.kind === "local") return probeLocalHost(host);
  const started = Date.now();
  const target = host.user ? `${host.user}@${host.addr}` : host.addr;
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"];
  if (host.port) args.push("-p", String(host.port));
  // 一次往返拿全部信息：CLI 路径 + 版本、git、远端目录是否存在。避免逐个 CLI 建连。
  const script = [
    "for c in dsh pi claude codex opencode; do",
    "  p=$(command -v \"$c\" 2>/dev/null) || continue",
    "  v=$($c --version 2>/dev/null | head -1)",
    '  echo "cli|$c|$p|$v"',
    "done",
    'git --version 2>/dev/null | head -1 | sed "s/^/git|/"',
  ].join("\n");
  const cwd = String(host.defaultCwd || "").trim();
  const cwdCheck = cwd ? `; test -d ${shellQuote(cwd)} && echo cwd_ok || echo cwd_missing` : "";
  args.push(target, `sh -lc ${shellQuote(script + cwdCheck)}`);
  try {
    const { stdout } = await execFileAsync("ssh", args, { timeout: 12000 });
    const caps = parseProbeOutput(stdout);
    const wasOffline = host.status !== "online";
    host.status = "online";
    host.caps = caps;
    host.lastProbe = Date.now();
    host.latencyMs = Date.now() - started;
    host.heartbeat = 0;
    host.version = caps.find((c) => c.cli === "dsh")?.version || (caps.length ? `${caps.length} CLI` : "—");
    host.probeError = null;
    if (cwd && !String(stdout).includes("cwd_ok")) host.probeError = `远端目录不存在：${cwd}`;
    if (wasOffline) store.addEvent("host.online", `host.online ${host.name}`);
    return { ok: true, host: hostView(host), caps };
  } catch (err) {
    const strike = (probeFails.get(host.id) || 0) + 1;
    probeFails.set(host.id, strike);
    host.lastProbe = Date.now();
    host.latencyMs = null;
    host.caps = [];
    host.probeError = String(err?.message || err).slice(0, 160) || "SSH 失败";
    // 连抖两次才标离线：一次网络抖动不该把队列全卡住
    if (strike >= 2 && host.status !== "offline") {
      host.status = "offline";
      store.addEvent("host.offline", `host.offline ${host.name}: ${host.probeError}`);
    }
    return { ok: false, error: host.probeError, pendingOffline: strike < 2 };
  }
}

/** 同一主机同一时刻只跑一个探测：心跳与手点可能重叠，串行化避免 ssh 堆积 */
const probingHosts = new Set();
async function withProbe(host) {
  if (probingHosts.has(host.id)) return { ok: false, skipped: true, error: "探测进行中" };
  probingHosts.add(host.id);
  try { return await probeHost(host); } finally { probingHosts.delete(host.id); }
}

const LOCAL_CLIS = ["dsh", "pi", "claude", "codex", "opencode"];

/** CLI 的 --version 有时把 Node 警告 / 堆栈写到 stderr：只认带版本号的那行，认不出就当「已安装」。 */
function cleanVersion(text) {
  const lines = String(text || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const versionish = lines.find((l) => /\d+\.\d+/.test(l) && !/node:internal|package_json_reader/.test(l));
  return (versionish || "").slice(0, 40);
}

/** 本机探测：不建连，直接读 PATH 里的 CLI 版本。 */
function probeLocalHost(host) {
  const started = Date.now();
  const env = dshPathEnv();
  const caps = [];
  for (const cli of LOCAL_CLIS) {
    const which = spawnSync("which", [cli], { encoding: "utf8", env });
    if (which.status !== 0) continue;
    const path = String(which.stdout || "").trim();
    const v = spawnSync(cli, ["--version"], { encoding: "utf8", env, timeout: 4000 });
    // 只认 stdout：stderr 常是 Node 警告 / 堆栈，不能当版本号
    const version = cleanVersion(v.stdout) || "已安装";
    caps.push({ cli, path, version });
  }
  if (bundledDshPath() && !caps.some((c) => c.cli === "dsh")) {
    caps.unshift({ cli: "dsh", path: bundledDshPath(), version: bundledDshManifest()?.version || "bundled" });
  }
  host.caps = caps;
  host.status = "online";
  host.version = caps.find((c) => c.cli === "dsh")?.version || `${caps.length} CLI`;
  host.lastProbe = Date.now();
  host.latencyMs = Date.now() - started;
  host.probeError = null;
  probeFails.delete(host.id);
  store.state.cliCapabilities = caps.map((c) => c.cli);
  return { ok: true, host: hostView(host), caps };
}

function parseProbeOutput(stdout) {
  const caps = [];
  for (const line of String(stdout || "").split("\n")) {
    const parts = line.trim().split("|");
    if (parts[0] !== "cli" || !parts[1]) continue;
    caps.push({ cli: parts[1], path: parts[2] || "", version: (parts[3] || "").trim().slice(0, 40) || "已安装" });
  }
  return caps;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** 渲染层用的主机视图：caps 已经解析好，未探测与「0」区分开。 */
function hostView(host) {
  if (!host) return null;
  if (host.kind === "local" && (!host.caps || !host.caps.length)) probeLocalHost(host);
  return { ...host, agents: store.state.agents.filter((a) => a.hostId === host.id).map((a) => ({ id: a.id, name: a.name, alias: a.alias, cli: a.cli })) };
}

/** ACP PromptResponse.usage → run 用量；没上报就记 unknown，绝不写假的 0。 */
function applyRunUsage(run, res) {
  const raw = res?.usage || res?.promptResponse?.usage || res?._meta?.usage || null;
  if (raw && typeof raw === "object") store.addEvent("run.usage", `run.usage ${run.id} ${JSON.stringify(raw).slice(0, 180)}`);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const input = num(raw?.inputTokens ?? raw?.input_tokens ?? raw?.promptTokens);
  const output = num(raw?.outputTokens ?? raw?.output_tokens ?? raw?.completionTokens);
  const total = num(raw?.totalTokens ?? raw?.total_tokens) ?? (input != null || output != null ? (input || 0) + (output || 0) : null);
  if (total == null) { run.usageSource = "unknown"; return; }
  run.tokensIn = input;
  run.tokensOut = output;
  run.tokens = total;
  run.usageSource = "acp";
}

/** 错误归 4 类（认证 / 限流 / 超时 / 其他），便于统计页聚合与重试入口。 */
function classifyError(message, code) {
  const m = String(message || "").toLowerCase();
  if (/\b(401|403)\b|unauthor|forbidden|credential|api.?key|not logged in|login|认证/.test(m)) return "auth";
  if (/\b429\b|rate.?limit|too many requests|quota|usage limit|限流|额度/.test(m)) return "rate_limit";
  if (/timeout|timed out|etimedout|\b408\b|deadline|超时/.test(m)) return "timeout";
  if (code === 401 || code === 403) return "auth";
  if (code === 429) return "rate_limit";
  return "other";
}

/** 从 dsh stderr 里挑出真正有用的原因，避免只看得到「dsh exited 1」。 */
function summarizeStderr(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const compact = (l) => l.replace(/\s+/g, " ");
  const imports = lines.filter((l) => /^Error: failed to import loader entry/.test(l)).slice(0, 2);
  if (imports.length) return imports.map(compact).join(" | ").slice(0, 700);
  const errors = lines.filter((l) => /^Error: /.test(l)).slice(0, 2);
  if (errors.length) return errors.map(compact).join(" | ").slice(0, 500);
  const cannot = lines.find((l) => /Cannot find (module|package)/.test(l));
  return compact(cannot || lines.at(-1) || "").slice(0, 400);
}

function now() { return Date.now(); }

const SETTINGS_SPEC = {
  defaultView: { kind: "enum", values: ["workspace", "projects", "stats", "hosts"], fallback: "workspace" },
  theme: { kind: "enum", values: ["light", "dark", "system"], fallback: "system" },
  chatFontSize: { kind: "number", min: 11, max: 16, fallback: 13 },
  enterToSend: { kind: "boolean", fallback: true },
  confirmStop: { kind: "boolean", fallback: false },
  defaultAgentId: { kind: "string", nullable: true, fallback: null, max: 80 },
  maxConcurrentRuns: { kind: "number", min: 0, max: 20, fallback: 0 },
  approvalPolicy: { kind: "enum", values: ["ask", "allow", "deny"], fallback: "ask" },
  dshBinary: { kind: "string", fallback: "", max: 500 },
  dshHome: { kind: "string", fallback: "", max: 1000 },
  model: { kind: "string", fallback: "", max: 200 },
  effort: { kind: "string", fallback: "", max: 50 },
  terminalFontSize: { kind: "number", min: 10, max: 18, fallback: 12 },
  terminalScrollback: { kind: "number", min: 1000, max: 50000, fallback: 5000 },
  shellPath: { kind: "string", fallback: "", max: 1000 },
  autoDetectDevServerUrl: { kind: "boolean", fallback: true },
  previewHomeUrl: { kind: "string", fallback: "http://localhost:5173/", max: 500 },
  elementScreenshots: { kind: "boolean", fallback: true },
  contextDetail: { kind: "enum", values: ["compact", "standard"], fallback: "standard" },
};

function sanitizeSettings(patch = {}) {
  const next = {};
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    if (spec.kind === "boolean") next[key] = Boolean(raw);
    else if (spec.kind === "number") {
      const n = Number(raw);
      next[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.round(n))) : spec.fallback;
    } else if (spec.kind === "enum") next[key] = spec.values.includes(raw) ? raw : spec.fallback;
    else if (raw === null && spec.nullable) next[key] = null;
    else next[key] = String(raw ?? spec.fallback ?? "").slice(0, spec.max || 500);
  }
  return next;
}

const VIEW_TARGETS = {
  工作区: "workspace", workspace: "workspace",
  项目: "projects", projects: "projects",
  统计: "stats", stats: "stats",
  主机: "hosts", hosts: "hosts",
  设置: "settings", settings: "settings",
};

const COCKPIT_HELP = [
  "/project [路径]   添加项目",
  "/task <标题>     新建任务",
  "/view <页面>     切换页面（工作区/项目/统计/主机/设置）",
  "/help            查看命令",
  "也可以直接说：添加项目、新建任务 xxx、打开设置",
].join("\n");

function cockpitCommandOf(raw) {
  const text = String(raw || "").trim();
  const slash = text.match(/^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i);
  if (slash) {
    const name = slash[1].toLowerCase();
    const arg = (slash[2] || "").trim();
    if (name === "project" || name === "add-project" || name === "open-project") return { kind: "project", arg };
    if (name === "task" || name === "new-task") return { kind: "task", arg };
    if (name === "view") return { kind: "view", arg };
    if (name === "help") return { kind: "help" };
    return { kind: "unknown", arg: name };
  }
  const addProject = text.match(/^(?:帮我|请)?\s*(?:添加|新建|导入)\s*(?:一个)?\s*项目(?:\s*[:：,，]?\s*)([\s\S]*)$/);
  if (addProject) return { kind: "project", arg: addProject[1].trim() };
  const openProject = text.match(/^(?:帮我|请)?\s*打开项目\s+([\s\S]+)$/);
  if (openProject) return { kind: "project", arg: openProject[1].trim() };
  const addTask = text.match(/^(?:帮我|请)?\s*(?:新建|创建|添加)\s*(?:一个)?\s*任务(?:\s*[:：,，]?\s*)([\s\S]*)$/);
  if (addTask) return { kind: "task", arg: addTask[1].trim() };
  const view = text.match(/^(?:帮我|请)?\s*(?:打开|进入|切到|切换到|去)\s*(工作区|项目|统计|主机|设置)\s*$/);
  if (view) return { kind: "view", arg: view[1] };
  return null;
}

async function runCockpitCommand(command, thread) {
  if (command.kind === "help") return { message: COCKPIT_HELP };
  if (command.kind === "unknown") return { message: `未知命令：/${command.arg}\n\n${COCKPIT_HELP}` };
  if (command.kind === "project") {
    const dir = command.arg || await pickProjectFolder();
    if (!dir) return { message: "已取消添加项目" };
    try {
      const project = actions.addProject({ path: dir });
      if (!thread.todoId) { thread.projectId = project.id; thread.project = project.path; }
      return { message: `已添加项目：${project.name}`, view: "workspace", projectId: project.id };
    } catch (err) {
      return { message: `添加项目失败：${err?.message || err}` };
    }
  }
  if (command.kind === "task") {
    if (!command.arg) return { message: "用法：/task <标题>" };
    try {
      const todo = actions.createTodo({ title: command.arg });
      if (!thread.todoId) {
        const generated = store.state.threads.find((t) => t.todoId === todo.id && t.id !== thread.id);
        if (generated) store.state.threads = store.state.threads.filter((t) => t !== generated);
        thread.todoId = todo.id;
        thread.title = todo.title;
        thread.projectId = todo.projectId;
        thread.project = todo.cwd;
        thread.updatedAt = Date.now();
      }
      return { message: `已创建任务 ${todo.key} ${todo.title}`, view: "workspace", todoId: todo.id };
    } catch (err) {
      return { message: `创建任务失败：${err?.message || err}` };
    }
  }
  if (command.kind === "view") {
    const view = VIEW_TARGETS[command.arg];
    if (!view) return { message: `未知页面：${command.arg}\n\n${COCKPIT_HELP}` };
    return { message: `已打开${command.arg}`, view };
  }
  return { message: COCKPIT_HELP };
}

const actions = {
  setSettings: (patch) => {
    const next = sanitizeSettings(patch || {});
    store.state.settings = { ...(store.state.settings || DEFAULT_SETTINGS), ...next };
    store.addEvent("settings.changed", `settings.changed ${Object.keys(next).join(",") || "noop"}`);
    if ("defaultAgentId" in next) {
      for (const thread of store.state.threads) if (!thread.todoId && !thread.agentId) thread.agentId = next.defaultAgentId || null;
    }
    if ("maxConcurrentRuns" in next) tick();
    return store.state.settings;
  },
  resetSettings: () => {
    store.state.settings = { ...DEFAULT_SETTINGS };
    store.addEvent("settings.reset", "settings.reset");
    return store.state.settings;
  },
  openDataDir: () => shell.openPath(app.getPath("userData")),
  exportData: async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const res = await dialog.showSaveDialog(win, {
      title: "导出数据库备份",
      defaultPath: path.join(app.getPath("desktop"), `harness-backup-${stamp}.db`),
      filters: [{ name: "SQLite", extensions: ["db"] }],
    });
    if (res.canceled || !res.filePath) return null;
    store.flush();
    fs.copyFileSync(store.file, res.filePath);
    store.addEvent("data.export", `data.export ${res.filePath}`);
    return res.filePath;
  },
  clearInbox: () => { store.state.inbox = []; store.addEvent("inbox.cleared", "inbox.cleared"); return { ok: true }; },
  addProject: ({ path: dirPath, name = "", desc = "", color = "" }) => {
    if (!dirPath) throw new Error("请选择项目目录");
    const abs = path.resolve(String(dirPath));
    try { fs.mkdirSync(abs, { recursive: true }); } catch { /* ignore */ }
    if (!fs.statSync(abs).isDirectory()) throw new Error("项目路径不是目录");
    const existing = store.state.projects.find((p) => p.path === abs);
    if (existing) {
      existing.lastOpenedAt = now();
      store.state.activeProjectId = existing.id;
      store.state.projectPath = existing.path;
      ensureGlobalDraft();
      store.addEvent("project.switched", `project.switched ${existing.name}`);
      return existing;
    }
    const project = {
      id: store.nextId("p"), name: String(name).trim() || path.basename(abs) || abs, path: abs, desc,
      color: color || PROJECT_COLORS[store.state.projects.length % PROJECT_COLORS.length],
      status: "in_progress", createdAt: now(), lastOpenedAt: now(), alias: "",
    };
    project.alias = uniqueAlias(project.name, project);
    store.state.projects.push(project);
    store.state.activeProjectId = project.id;
    store.state.projectPath = project.path;
    ensureGlobalDraft();
    store.addEvent("project.added", `project.added ${project.name} path=${project.path}`);
    return project;
  },
  switchProject: ({ id }) => {
    const project = store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在");
    store.state.activeProjectId = project.id;
    project.lastOpenedAt = now();
    store.state.projectPath = project.path;
    ensureGlobalDraft();
    store.addEvent("project.switched", `project.switched ${project.name}`);
    return project;
  },
  renameProject: ({ id, name }) => {
    const project = store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在");
    const next = String(name || "").trim();
    if (!next) throw new Error("项目名称不能为空");
    project.name = next;
    store.addEvent("project.renamed", `project.renamed ${next}`);
    return project;
  },
  setProjectStatus: ({ id, status }) => {
    const project = store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在");
    project.status = status;
    store.addEvent("project.status", `project.status ${project.name} → ${status}`);
    return project;
  },
  removeProject: ({ id }) => {
    const project = store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在");
    if (store.state.projects.length <= 1) throw new Error("至少保留一个项目");
    const count = store.state.todos.filter((t) => t.projectId === id).length;
    if (count) throw new Error(`项目下还有 ${count} 个任务，不能移除`);
    store.state.projects = store.state.projects.filter((p) => p.id !== id);
    if (store.state.activeProjectId === id) {
      const fallback = store.state.projects[0];
      store.state.activeProjectId = fallback.id;
      store.state.projectPath = fallback.path;
    }
    store.addEvent("project.removed", `project.removed ${project.name}`);
    return { ok: true };
  },
  revealProject: ({ id }) => {
    const project = store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在");
    return shell.openPath(project.path);
  },
  planToday: () => {
    const titles = ["核对昨日未完成项", "生成今日实验计划", "准备周会材料"];
    const project = activeProject();
    for (const title of titles) {
      const id = store.nextId("t");
      const todo = {
        id, key: `#${store.state.seq}`, title, desc: "由每日模板生成。", acceptance: [], status: "todo", agentId: null,
        priority: "P2", due: "今天", parentId: null, tags: ["daily"], subtasks: [], blockedBy: [],
        missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: project?.id || null,
        cwd: project?.path || workspaceRoot, createdAt: Date.now(), updatedAt: Date.now(),
      };
      store.state.todos.unshift(todo);
      threadForTodo(todo);
    }
    store.addEvent("todo.created", `todo.created count=3 source=template`);
  },
  createTodo: ({ title, desc = "", agentId = null, cwd = "", priority = "P2" }) => {
    if (!title) throw new Error("title required");
    const project = activeProject();
    const id = store.nextId("t");
    const todo = {
      id, key: `#${store.state.seq}`, title, desc, acceptance: [], status: "todo", agentId,
      priority, due: "今天", parentId: null, tags: [], subtasks: [], blockedBy: [],
      missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: project?.id || null,
      cwd: cwd || project?.path || workspaceRoot, createdAt: now(), updatedAt: now(),
    };
    store.state.todos.unshift(todo);
    threadForTodo(todo);
    store.addEvent("todo.created", `todo.created ${todo.key} ${title}`);
    return todo;
  },
  /**
   * 任务文字字段的就地修改（TODO 行内双击标题 / 描述）。
   * 只改传进来的字段；标题变更同步会话标题，历史列表不会继续显示旧标题。
   */
  updateTodo: ({ id, title, desc, acceptance, priority, due, tags }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    const changed = [];
    if (typeof title === "string") {
      const next = title.trim().replace(/\s+/g, " ").slice(0, 200);
      if (!next) throw new Error("标题不能为空");
      if (next !== todo.title) { todo.title = next; changed.push("title"); }
    }
    if (typeof desc === "string" && desc !== todo.desc) { todo.desc = desc; changed.push("desc"); }
    if (Array.isArray(acceptance)) {
      const next = acceptance.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
      if (JSON.stringify(next) !== JSON.stringify(todo.acceptance || [])) { todo.acceptance = next; changed.push("acceptance"); }
    }
    if (typeof priority === "string" && ["P0", "P1", "P2", "P3"].includes(priority) && priority !== todo.priority) {
      todo.priority = priority; changed.push("priority");
    }
    if (typeof due === "string" && due !== todo.due) { todo.due = due; changed.push("due"); }
    if (Array.isArray(tags)) {
      const next = [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))].slice(0, 12);
      if (JSON.stringify(next) !== JSON.stringify(todo.tags || [])) { todo.tags = next; changed.push("tags"); }
    }
    if (!changed.length) return todo;
    todo.updatedAt = now();
    if (changed.includes("title")) {
      const thread = threadForTodo(todo);
      thread.title = todo.title;
      thread.updatedAt = now();
    }
    store.addEvent("todo.updated", `todo.updated ${todo.key} ${changed.join(",")}`);
    return todo;
  },
  /**
   * 收集箱 → TODO：一次把「我今天想到的一堆事」变成任务。
   * 一行一条；自动去掉 - * • / 1. 1) / [ ] 前缀，去重，最多 100 条。
   */
  createTodos: ({ text = "", titles = [] }) => {
    const raw = Array.isArray(titles) && titles.length ? titles.map(String) : String(text).split("\n");
    const seen = new Set();
    const list = [];
    for (const line of raw) {
      const title = line.replace(/^\s*(?:[-*•—]|\d+[.)、]|\[\s?x?\])\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!title || seen.has(title)) continue;
      seen.add(title);
      list.push(title);
      if (list.length >= 100) break;
    }
    if (!list.length) throw new Error("没有可添加的内容");
    const project = activeProject();
    const created = list.map((title) => {
      const id = store.nextId("t");
      return {
        id, key: `#${store.state.seq}`, title, desc: "", acceptance: [], status: "todo", agentId: null,
        priority: "P2", due: "今天", parentId: null, tags: [], subtasks: [], blockedBy: [],
        missingWriteback: false, lastRunFailed: false, confirmed: false,
        projectId: project?.id || null, cwd: project?.path || workspaceRoot, createdAt: now(), updatedAt: now(),
      };
    });
    store.state.todos.unshift(...created.reverse());
    for (const todo of created) threadForTodo(todo);
    store.addEvent("todo.created", `todo.created count=${created.length} source=capture`);
    return { count: created.length, todos: created };
  },
  setStatus: ({ id, status }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    todo.status = status; todo.updatedAt = now();
    store.addEvent("todo.status", `todo.status ${todo.key} → ${status}`);
    if (["done", "cancelled"].includes(status)) {
      for (const r of store.state.runs.filter((x) => x.todoId === id && ["running", "waiting_input", "queued"].includes(x.status))) {
        active.get(r.id)?.client.cancel();
      }
    }
  },
  assign: ({ id, agentId }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    todo.agentId = agentId; todo.updatedAt = now();
    const thread = threadForTodo(todo);
    thread.agentId = agentId;
    store.addEvent("todo.assigned", `todo.assigned ${todo.key}`);
  },
  /**
   * 纳管一个 Chat 可用的 Agent（不需要先开终端）。
   * 目前只有 dsh 有 Chat 执行适配器；其他 CLI 仍只能在终端里运行。
   */
  createAgent: ({ cli = "dsh", projectId, name = "" } = {}) => {
    const id = String(cli || "").trim().toLowerCase();
    const executor = EXECUTORS.find((e) => e.id === id);
    if (!executor) throw new Error(`未知 CLI：${cli}`);
    if (!executor.implemented) throw new Error(`${executor.id} 还没有接入 Chat 执行适配器；请在终端里运行，或选择 dsh`);
    if (!executorList().find((e) => e.id === executor.id)?.available) throw new Error(`未检测到可用的 ${executor.id}：请先安装，或在设置 → 执行里配置可执行文件路径`);
    const pid = projectId || store.state.activeProjectId;
    const project = store.state.projects.find((p) => p.id === pid) || activeProject();
    const existing = store.state.agents.find((a) => a.cli === executor.id && (a.projectId || null) === (pid || null) && !a.terminalId);
    if (existing) return existing;
    const agent = {
      id: store.nextId("ag"),
      name: String(name).trim() || `${project?.name || "project"} · ${executor.id}`,
      hostId: "h-local", cli: executor.id, cwd: project?.path || workspaceRoot,
      max: 1, approval: "ask", skills: [], color: PROJECT_COLORS[store.state.agents.length % PROJECT_COLORS.length],
      alias: uniqueAgentAlias(executor.id, pid), projectId: pid || null, terminalId: "",
    };
    store.state.agents.push(agent);
    store.addEvent("agent.created", `agent.created ${agent.name} @${agent.alias} (${executor.id})`);
    return agent;
  },
  // ── 会话：单一输入路径 ────────────────────────────────────────────────
  newThread: ({ projectId } = {}) => {
    // 默认新建全局对话；显式传 projectId 时才创建项目作用域的会话
    const empty = projectId
      ? store.state.threads.find((t) => !t.todoId && t.projectId === projectId)
      : store.state.threads.find((t) => !t.todoId && !t.projectId);
    if (empty) {
      if (!empty.agentId || !chatRunnable(store.state.agents.find((a) => a.id === empty.agentId))) {
        empty.agentId = defaultChatAgent(empty.projectId || store.state.activeProjectId)?.id || null;
      }
      empty.updatedAt = now();
      return empty;
    }
    const thread = newThreadRecord({ projectId: projectId || null, title: "新任务" });
    store.state.threads.push(thread);
    store.addEvent("thread.created", `thread.created ${thread.id} scope=${thread.projectId || "global"}`);
    return thread;
  },
  setThreadAgent: ({ threadId, agentId }) => {
    const thread = store.state.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error("thread not found");
    const agent = store.state.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error("agent not found");
    thread.agentId = agent.id;
    thread.updatedAt = now();
    const todo = thread.todoId ? store.state.todos.find((t) => t.id === thread.todoId) : null;
    const busy = todo && store.state.runs.some((r) => r.todoId === todo.id && ["queued", "running", "waiting_input"].includes(r.status));
    if (todo && !busy) { todo.agentId = agent.id; todo.updatedAt = now(); }
    store.addEvent("thread.agent", `thread.agent ${thread.id} → ${agent.name}`);
    return thread;
  },
  // 对话作用域：projectId=null 表示全局（不绑定项目），否则绑定到指定项目。
  // 注意：只改会话目标，不切换整个工作区，避免「改对话作用域把整个应用切走」。
  setThreadProject: ({ threadId, projectId }) => {
    const thread = store.state.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error("thread not found");
    if (thread.todoId) throw new Error("任务已绑定项目，不能切换；请新建任务");
    const project = projectId ? store.state.projects.find((p) => p.id === projectId) : null;
    if (projectId && !project) throw new Error("项目不存在");
    thread.projectId = project?.id || null;
    thread.project = project?.path || "";
    thread.updatedAt = now();
    store.addEvent("thread.project", `thread.project ${thread.id} → ${project?.name || "全局"}`);
    return thread;
  },
  /**
   * 唯一发送入口。按会话当前状态决定行为，永远先落消息：
   *   draft thread       → 分派（建任务 + 排队）
   *   active run         → steer（pending → injected / failed）
   *   todo 未确认无运行   → 新起一次 run，消息作为补充指令
   *   todo 已确认         → 仅记录
   *   /project /task /view → cockpit 命令，直接执行
   */
  send: async ({ threadId, text, agentId, projectId, context }) => {
    const value = String(text || "").trim();
    if (!value) throw new Error("内容不能为空");
    const thread = resolveThread({ threadId, projectId, agentId });
    const extra = context ? { context } : {};
    const command = cockpitCommandOf(value);
    if (command) {
      store.addMessage(thread.id, null, "user", "text", value, extra);
      const result = await runCockpitCommand(command, thread);
      store.addMessage(thread.id, null, "system", "system", result.message);
      return { mode: "command", threadId: thread.id, ...result };
    }
    const boundTodo = thread.todoId ? store.state.todos.find((t) => t.id === thread.todoId) : null;
    // 显式选择的 Agent 优先（即使是终端专用，也要在下面明确报错，不能静默换成 dsh）
    const requestedAgent = store.state.agents.find((a) => a.id === (agentId || thread.agentId || boundTodo?.agentId)) || null;
    const agent = requestedAgent || defaultChatAgent(thread.projectId || projectId) || null;

    if (!boundTodo) {
      const mention = mentionOf(value);
      const userMsg = store.addMessage(thread.id, null, "user", "text", value, extra);
      // 草稿会话默认派活：没有 @别名 / 元素上下文也直接交给当前 Agent
      if (!mention && !agent) {
        store.addMessage(thread.id, null, "system", "error", "未检测到可执行的 Agent：请先在终端启动 Agent，或在 Chat 里点「＋ dsh」纳管。");
        return { mode: "error", threadId: thread.id };
      }
      const alias = mention ? mention.toLowerCase() : "";
      const mentionProject = alias ? store.state.projects.find((p) => (p.alias || "").toLowerCase() === alias) || null : null;
      const mentionAgent = !mention
        ? agent
        : mentionProject
          ? pickChatAgent(thread.agentId) || defaultChatAgent(projectId || thread.projectId) || null
          : store.state.agents.find((a) => (a.alias || "").toLowerCase() === alias) || null;
      if (!mentionAgent) {
        store.addMessage(thread.id, null, "system", "error", `未找到别名 @${mention}：请先在项目终端里启动 Agent，或使用可用别名 ${[...store.state.projects.map((p) => "@" + p.alias)].join(" ")}`);
        return { mode: "error", threadId: thread.id };
      }
      const agentErr = chatAgentError(mentionAgent);
      if (agentErr) {
        store.addMessage(thread.id, null, "system", "error", agentErr);
        return { mode: "error", threadId: thread.id };
      }
      const project = mentionProject
        || store.state.projects.find((p) => p.id === (thread.projectId || projectId))
        || store.state.projects.find((p) => p.id === mentionAgent.projectId)
        || activeProject();
      const cwd = project?.path || thread.project || workspaceRoot;
      const title = mention ? (value.replace(/@[a-zA-Z0-9_.-]+/, "").trim() || value) : value;
      const todo = {
        id: store.nextId("t"), key: `#${store.state.seq}`, title: title.slice(0, 120), desc: "", acceptance: [], status: "todo",
        agentId: mentionAgent.id, priority: "P1", due: "今天", parentId: null, tags: ["chat"], subtasks: [], blockedBy: [],
        missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: project?.id || null,
        cwd, createdAt: now(), updatedAt: now(),
      };
      store.state.todos.unshift(todo);
      thread.todoId = todo.id;
      thread.title = todo.title;
      thread.agentId = mentionAgent.id;
      thread.projectId = project?.id || null;
      thread.project = cwd;
      thread.updatedAt = now();
      store.addEvent("todo.created", `todo.created ${todo.key} ${mention ? `via @${mention}` : "via element"}`);
      const run = queueRun(todo, mentionAgent, "chat");
      // 把这条消息绑定到本轮 run，startRun 才能收集到它的 context
      store.updateMessage(userMsg.id, { runId: run.id });
      tick();
      return { mode: "dispatch", threadId: thread.id, todoId: todo.id };
    }

    const activeRun = activeRunOf(boundTodo.id);
    if (activeRun) {
      const userMsg = store.addMessage(thread.id, activeRun.id, "user", "text", value, { delivery: "pending", ...extra });
      const delivered = context ? `${value}\n\n${formatContext(context, contextDetail())}` : value;
      const delivery = deliverSteer({ thread, todo: boundTodo, run: activeRun, messageId: userMsg.id, text: delivered });
      return { mode: "steer", delivery, threadId: thread.id, todoId: boundTodo.id };
    }

    // 还没开跑：挂到已排队的 run 上，作为本轮补充指令，不另开一个 run
    const queued = store.state.runs.find((r) => r.todoId === boundTodo.id && r.status === "queued");
    if (queued) {
      store.addMessage(thread.id, queued.id, "user", "text", value, extra);
      store.addEvent("run.message", `run.message queued ${boundTodo.key}`);
      return { mode: "queued", threadId: thread.id, todoId: boundTodo.id };
    }

    const userMsg = store.addMessage(thread.id, null, "user", "text", value, extra);
    if (!agent) {
      store.addMessage(thread.id, null, "system", "error", "未检测到可执行的 Agent：这条消息只记录，未起运行。");
      return { mode: "note", threadId: thread.id, todoId: boundTodo.id };
    }
    if (boundTodo.confirmed) {
      store.addMessage(thread.id, null, "system", "system", "任务已确认，这条消息仅记录。");
      return { mode: "note", threadId: thread.id, todoId: boundTodo.id };
    }
    const agentErr = chatAgentError(agent);
    if (agentErr) {
      store.addMessage(thread.id, null, "system", "error", agentErr);
      return { mode: "error", threadId: thread.id, todoId: boundTodo.id };
    }
    boundTodo.agentId = agent.id;
    thread.agentId = agent.id;
    thread.updatedAt = now();
    const run = queueRun(boundTodo, agent, "chat");
    store.updateMessage(userMsg.id, { runId: run.id });
    tick();
    return { mode: "run", threadId: thread.id, todoId: boundTodo.id, runId: run.id };
  },
  retryMessage: ({ id }) => {
    const msg = store.state.messages.find((m) => m.id === id);
    if (!msg || msg.role !== "user") throw new Error("只能重发用户消息");
    const thread = store.state.threads.find((t) => t.id === msg.threadId);
    const todo = thread?.todoId ? store.state.todos.find((t) => t.id === thread.todoId) : null;
    if (!thread || !todo) return { mode: "note" };
    const run = activeRunOf(todo.id);
    if (!run) {
      store.addMessage(thread.id, null, "system", "error", "没有可投递的当前运行；请等任务结束后重新发送。");
      return { mode: "note" };
    }
    store.updateMessage(msg.id, { runId: run.id });
    const delivered = msg.context ? `${msg.content}\n\n${formatContext(msg.context, contextDetail())}` : msg.content;
    const delivery = deliverSteer({ thread, todo, run, messageId: msg.id, text: delivered });
    return { mode: "steer", delivery };
  },
  // 兼容旧调用：纯记录，不投递
  comment: ({ id, text }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    const thread = threadForTodo(todo);
    store.addMessage(thread.id, null, "user", "text", String(text || "").trim());
    store.addEvent("todo.comment", `todo.comment ${todo.key}`);
  },
  // 兼容旧调用：等价于向该 todo 的会话发送
  dispatch: ({ text, agentId }) => actions.send({ threadId: null, text, agentId }),
  confirm: ({ id }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    todo.confirmed = true;
    todo.status = "done";
    todo.updatedAt = now();
    for (const item of store.state.inbox) if (item.todoId === id) item.read = true;
    store.addMessage(threadForTodo(todo).id, null, "system", "system", `已确认 · ${todo.key}`);
    store.addEvent("todo.confirmed", `todo.confirmed ${todo.key}`);
  },
  run: ({ id, agentId }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    const agent = store.state.agents.find((a) => a.id === (agentId || todo.agentId));
    if (!agent) throw new Error("no agent: 先在左侧选择/创建一个 Agent");
    const agentErr = chatAgentError(agent);
    if (agentErr) throw new Error(agentErr);
    todo.agentId = agent.id;
    const thread = threadForTodo(todo);
    thread.agentId = agent.id;
    const run = queueRun(todo, agent, "assign");
    store.addMessage(thread.id, run.id, "system", "system", `派活 · ${agent.name}`);
    tick();
  },
  broadcast: ({ id, agentIds }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    const ids = (agentIds && agentIds.length ? agentIds : store.state.agents.slice(0, 2).map((a) => a.id));
    if (ids.length < 2) throw new Error("广播至少需要 2 个 Agent");
    const thread = threadForTodo(todo);
    const agents = ids.map((agentId) => store.state.agents.find((a) => a.id === agentId)).filter(Boolean);
    const blocked = agents.map((a) => chatAgentError(a)).filter(Boolean);
    if (blocked.length) throw new Error(blocked[0]);
    for (const agent of agents) queueRun(todo, agent, "broadcast");
    thread.updatedAt = now();
    store.addEvent("run.broadcast", `run.broadcast ${todo.key} agents=${ids.length}`);
    tick();
  },
  adopt: ({ runId }) => {
    const run = store.state.runs.find((r) => r.id === runId);
    if (!run || run.status !== "completed") throw new Error("run 未完成，不能采纳");
    const todo = store.state.todos.find((t) => t.id === run.todoId);
    if (!todo) throw new Error("todo not found");
    for (const other of store.state.runs.filter((r) => r.todoId === todo.id && r.id !== run.id && ["queued", "running", "waiting_input"].includes(r.status))) {
      active.get(other.id)?.client.cancel();
      other.status = "cancelled";
      other.endedAt = Date.now();
    }
    todo.status = "done";
    todo.agentId = run.agentId;
    todo.missingWriteback = false;
    store.addMessage(threadForTodo(todo).id, run.id, "system", "system", `采纳 run ${run.id}${run.branch ? ` · ${run.branch}` : ""}`);
    store.addEvent("run.adopted", `run.adopted ${todo.key} ${run.id}`);
    for (const [id, a] of approvals) if (a.todoId === todo.id) approvals.delete(id);
  },
  stop: ({ runId }) => {
    const run = store.state.runs.find((r) => r.id === runId);
    if (!run) return;
    for (const [id, a] of approvals) if (a.runId === runId) approvals.delete(id);
    const handle = active.get(runId);
    if (handle) { handle.done = true; handle.client.cancel(); handle.client.close(); active.delete(runId); }
    if (["running", "queued", "waiting_input"].includes(run.status)) {
      run.status = "cancelled"; run.endedAt = now();
      if (run.startedAt) run.durationMs = Math.max(0, run.endedAt - run.startedAt);
      const todo = store.state.todos.find((t) => t.id === run.todoId);
      if (todo) {
        todo.status = "todo";
        store.addMessage(threadForTodo(todo).id, run.id, "system", "system", "运行已停止");
      }
      settlePendingSteers(runId);
      store.addEvent("run.cancelled", `run.cancelled ${todo?.key}`);
    }
  },
  retry: ({ id }) => {
    const todo = store.state.todos.find((t) => t.id === id);
    if (!todo) throw new Error("todo not found");
    const last = store.state.runs.filter((r) => r.todoId === id).slice(-1)[0];
    const agent = pickChatAgent(todo.agentId, last?.agentId) || defaultChatAgent(todo.projectId || store.state.activeProjectId);
    if (!agent) throw new Error("no agent");
    const agentErr = chatAgentError(agent);
    if (agentErr) throw new Error(agentErr);
    const run = queueRun(todo, agent, "retry", last?.id || null);
    store.addMessage(threadForTodo(todo).id, run.id, "system", "system", "重试");
    tick();
  },
  readInbox: ({ id }) => {
    const item = store.state.inbox.find((i) => i.id === id);
    if (item) item.read = true;
  },
  readAllInbox: () => { store.state.inbox.forEach((i) => { i.read = true; }); },
  setContext: (payload) => {
    store.state.context = { ...payload, updatedAt: now(), stale: false, source: "ide" };
    store.addEvent("context.changed", "context.changed source=ide");
  },
  approval: ({ id, allow }) => {
    const approval = approvals.get(id);
    if (!approval) throw new Error("approval not found");
    const handle = active.get(approval.runId);
    const ok = handle?.client.respondPermission(approval.requestId, Boolean(allow));
    approvals.delete(id);
    const run = store.state.runs.find((r) => r.id === approval.runId);
    if (run && run.status === "waiting_input") run.status = "running";
    store.addEvent("run.approval", `run.approval ${approval.title} ${allow ? "allow" : "deny"} ok=${ok}`);
    const approvalTodo = store.state.todos.find((t) => t.id === approval.todoId);
    store.addMessage(approvalTodo ? threadForTodo(approvalTodo).id : null, approval.runId, "system", "system", `审批：${allow ? "允许" : "拒绝"} · ${approval.title}`);
  },
  cleanupWorktree: ({ runId }) => {
    const run = store.state.runs.find((r) => r.id === runId);
    if (run?.cwd && run.branch) {
      const ok = removeWorktree(run.cwd);
      store.addEvent("run.worktree", `worktree cleanup ${ok ? "ok" : "failed"} ${run.cwd}`);
    }
  },
  addHost: async ({ name, addr, user = "", port = 22, path = "" }) => {
    if (!name || !addr) throw new Error("主机名和地址必填");
    const host = {
      id: store.nextId("h"), name, kind: "ssh", addr, port, user, status: "offline", heartbeat: 0, version: "—",
      caps: [], lastProbe: null, latencyMs: null, maxConcurrency: 0, defaultCwd: path || "", probeError: null,
    };
    store.state.hosts.push(host);
    store.addEvent("host.added", `host.added ${name} ${addr}`);
    const result = await withProbe(host);
    if (result.ok) probeFails.delete(host.id);
    return result;
  },
  probeHost: async ({ id }) => {
    const host = store.state.hosts.find((h) => h.id === id);
    if (!host) throw new Error("host not found");
    const result = await probeHost(host);
    // 本机探测是同步的、不会失败；SSH 探测成功才清掉失败计数
    if (result.ok && host.kind !== "local") probeFails.delete(host.id);
    return result;
  },
  /** 页面可见时的心跳：一次探全部远端主机（本机自己会刷）。 */
  probeHosts: async ({ id } = {}) => {
    const targets = store.state.hosts.filter((h) => (id ? h.id === id : h.kind === "ssh"));
    const results = [];
    for (const host of targets) {
      const r = await withProbe(host);
      if (r.ok) probeFails.delete(host.id);
      results.push({ id: host.id, ...r });
    }
    const local = store.state.hosts.find((h) => h.kind === "local");
    if (local) try { probeLocalHost(local); } catch { /* ignore */ }
    return results;
  },
  removeHost: async ({ id }) => {
    const host = store.state.hosts.find((h) => h.id === id);
    if (!host) throw new Error("host not found");
    if (host.kind === "local") throw new Error("本机不能移除");
    const bound = store.state.agents.filter((a) => a.hostId === id);
    if (bound.length) throw new Error(`${bound.length} 个 Agent 还绑定在该主机上，先把它们移回本机`);
    const busy = store.state.runs.filter((r) => r.hostId === id && ["running", "waiting_input", "queued"].includes(r.status));
    if (busy.length) throw new Error("该主机还有运行中的任务");
    store.state.hosts = store.state.hosts.filter((h) => h.id !== id);
    probeFails.delete(id);
    store.addEvent("host.removed", `host.removed ${host.name}`);
    return true;
  },
  setHostMax: async ({ id, max = 0 }) => {
    const host = store.state.hosts.find((h) => h.id === id);
    if (!host) throw new Error("host not found");
    host.maxConcurrency = Math.max(0, Number(max) || 0);
    store.addEvent("host.max", `host.max ${host.name} = ${host.maxConcurrency}`);
    tick();
    return host.maxConcurrency;
  },
  /** Agent 换运行位置：远端主机必须给绝对 cwd（远端不建 worktree）。 */
  setAgentHost: async ({ agentId, hostId }) => {
    const agent = store.state.agents.find((a) => a.id === agentId);
    const host = store.state.hosts.find((h) => h.id === hostId);
    if (!agent || !host) throw new Error("agent / host not found");
    if (host.kind === "ssh") {
      const cwd = String(host.defaultCwd || "").trim();
      if (!cwd.startsWith("/")) throw new Error("远端主机需要先设置远端 cwd（绝对路径）");
      agent.cwd = cwd;
    }
    agent.hostId = host.id;
    store.addEvent("agent.host", `agent.host ${agent.name} → ${host.name}`);
    return hostView(host);
  },
  readArtifact: ({ id }) => {
    const art = store.state.artifacts.find((a) => a.id === id);
    if (!art) throw new Error("artifact not found");
    const file = art.ref;
    const ext = path.extname(file).toLowerCase();
    const image = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext);
    const meta = { title: art.title, kind: art.kind, ref: file, origin: art.origin, image, text: null, size: 0 };
    try {
      const stat = fs.statSync(file);
      meta.size = stat.size;
      if (stat.size > 2 * 1024 * 1024) return { ...meta, error: "文件大于 2MB，不预览" };
      if (image) return { ...meta, dataUrl: `data:image/${ext === ".svg" ? "svg+xml" : ext.slice(1)};base64,${fs.readFileSync(file).toString("base64")}` };
      meta.text = fs.readFileSync(file, "utf8");
      return meta;
    } catch (err) {
      return { ...meta, error: String(err.message || err) };
    }
  },
  openArtifact: ({ id }) => {
    const art = store.state.artifacts.find((a) => a.id === id);
    if (art?.deepLink) shell.openExternal(art.deepLink).catch(() => {});
    return art?.deepLink || null;
  },
};

ipcMain.handle("harness:state", () => snapshot());

async function pickProjectFolder() {
  const res = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
}

ipcMain.handle("harness:pickProjectFolder", () => pickProjectFolder());

ipcMain.handle("harness:chooseProject", async () => {
  const dir = await pickProjectFolder();
  if (!dir) return null;
  const project = actions.addProject({ path: dir });
  broadcast();
  return project.path;
});

function rootOf(root) {
  const candidate = root ? path.resolve(String(root)) : path.resolve(activeProjectPath());
  try {
    if (fs.statSync(candidate).isDirectory()) return candidate;
  } catch { /* fall through */ }
  return path.resolve(activeProjectPath());
}

ipcMain.handle("files:list", (_e, { rel = "", root } = {}) => {
  const base = rootOf(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("path outside project");
  const entries = fs.readdirSync(full, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".git") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, dir: e.isDirectory(), path: path.relative(base, path.join(full, e.name)) }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { root: base, rel, entries };
});

ipcMain.handle("files:read", (_e, { rel, root } = {}) => {
  const base = rootOf(root);
  const full = path.resolve(base, rel || "");
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("path outside project");
  const stat = fs.statSync(full);
  if (stat.isDirectory()) throw new Error("is directory");
  if (stat.size > 2 * 1024 * 1024) return { error: ">2MB" };
  const ext = path.extname(full).toLowerCase();
  const image = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext);
  if (image) return { image: true, dataUrl: `data:image/${ext === ".svg" ? "svg+xml" : ext.slice(1)};base64,${fs.readFileSync(full).toString("base64")}` };
  return { text: fs.readFileSync(full, "utf8"), size: stat.size, ext };
});

// ── files：编辑器外的文件操作（右键菜单 / 新建 / 重命名 / 复制 / 删除）──
function filesInside(base, rel) {
  const full = path.resolve(base, rel || "");
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("path outside project");
  return full;
}

function safeEntryName(raw) {
  const name = String(raw || "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new Error("非法文件名");
  return name;
}

ipcMain.handle("files:create", (_e, { rel = "", root, kind = "file", name } = {}) => {
  const base = rootOf(root);
  const parent = filesInside(base, rel);
  const fileName = safeEntryName(name);
  const full = path.join(parent, fileName);
  if (!full.startsWith(base + path.sep)) throw new Error("path outside project");
  if (fs.existsSync(full)) throw new Error("同名文件或目录已存在");
  if (kind === "folder") fs.mkdirSync(full, { recursive: true });
  else fs.writeFileSync(full, "", { flag: "wx" });
  return { path: path.relative(base, full), name: fileName };
});

ipcMain.handle("files:rename", (_e, { rel, root, name } = {}) => {
  const base = rootOf(root);
  const full = filesInside(base, rel);
  if (full === base) throw new Error("不能重命名项目根目录");
  const fileName = safeEntryName(name);
  const next = path.join(path.dirname(full), fileName);
  if (!next.startsWith(base + path.sep)) throw new Error("path outside project");
  if (fs.existsSync(next)) throw new Error("同名文件或目录已存在");
  fs.renameSync(full, next);
  return { path: path.relative(base, next), name: fileName };
});

ipcMain.handle("files:duplicate", (_e, { rel, root } = {}) => {
  const base = rootOf(root);
  const full = filesInside(base, rel);
  if (full === base) throw new Error("不能复制项目根目录");
  const ext = path.extname(full);
  const stem = path.basename(full, ext);
  let target = "";
  for (let i = 1; ; i++) {
    target = path.join(path.dirname(full), `${stem} copy${i > 1 ? ` ${i}` : ""}${ext}`);
    if (!fs.existsSync(target)) break;
  }
  if (fs.statSync(full).isDirectory()) fs.cpSync(full, target, { recursive: true });
  else fs.copyFileSync(full, target);
  return { path: path.relative(base, target), name: path.basename(target) };
});

ipcMain.handle("files:trash", async (_e, { rel, root } = {}) => {
  const base = rootOf(root);
  const full = filesInside(base, rel);
  if (full === base) throw new Error("不能删除项目根目录");
  await shell.trashItem(full);
  return true;
});

ipcMain.handle("files:reveal", (_e, { rel, root } = {}) => {
  const base = rootOf(root);
  const full = filesInside(base, rel);
  if (!fs.existsSync(full)) throw new Error("文件不存在");
  shell.showItemInFolder(full);
  return true;
});

ipcMain.handle("terminal:create", async (_e, { cwd, command, projectId, cols, rows } = {}) => {
  const id = `term-${Date.now().toString(36)}`;
  const settings = store.state.settings || {};
  const shell = settings.shellPath || (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh");
  const fallbackShell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh";
  const cwdResolved = cwd || activeProjectPath();
  const spawnOptions = {
    name: "xterm-256color",
    cols: Math.max(20, Math.min(500, Number(cols) || 120)),
    rows: Math.max(2, Math.min(300, Number(rows) || 32)),
    cwd: cwdResolved,
    env: { ...process.env, TERM: "xterm-256color" },
  };
  const spawnArgs = command ? [] : (process.platform === "win32" ? [] : ["-l"]);
  let term;
  try {
    term = pty.spawn(command || shell, spawnArgs, spawnOptions);
  } catch (err) {
    if (command) throw err;
    store.addEvent("terminal.shell_fallback", `terminal.shell_fallback ${shell} → ${fallbackShell}: ${String(err?.message || err).slice(0, 120)}`);
    // cwd 可能已被删除（worktree 清理等）：回落到项目根目录，避免终端直接起不来
    let safeCwd = cwdResolved;
    try { fs.accessSync(safeCwd); } catch { safeCwd = activeProjectPath(); }
    term = pty.spawn(fallbackShell, spawnArgs, { ...spawnOptions, cwd: safeCwd });
  }
  let agent = null;
  if (command) {
    const pid = projectId || store.state.activeProjectId;
    const project = store.state.projects.find((p) => p.id === pid) || activeProject();
    agent = {
      id: store.nextId("ag"), name: `${project?.name || "project"} · ${command}`, hostId: "h-local",
      cli: command, cwd: cwdResolved, max: 1, approval: "ask", skills: [], color: "teal",
      alias: uniqueAgentAlias(command, pid), projectId: pid, terminalId: id,
    };
    store.state.agents.push(agent);
    store.addEvent("agent.started", `agent.started ${agent.name} @${agent.alias}`);
  }
  const send = (data) => { if (win && !win.isDestroyed()) win.webContents.send("terminal:data", { id, data }); };
  // attached=false 时先把输出攒起来：终端可能在渲染进程挂载前就已经打印了 banner
  // （例如从下拉框启动 Agent），挂载后通过 terminal:attach 一次性回放，避免首屏空白。
  const info = { url: null, tail: "", attached: false, buffer: "", exited: false, exitCode: null };
  terminalUrls.set(id, info);
  term.onData((data) => {
    if (info.attached) send(data);
    else info.buffer = (info.buffer + data).slice(-512 * 1024);
    if (settings.autoDetectDevServerUrl === false) return;
    // dev server 地址探测：去 ANSI 后跨 chunk 保留尾部，发现变化就通知渲染进程
    info.tail = (info.tail + data).slice(-4000);
    const url = detectDevUrl(info.tail);
    if (url && url !== info.url) {
      info.url = url;
      if (win && !win.isDestroyed()) win.webContents.send("terminal:url", { id, url });
    }
  });
  term.onExit(({ exitCode, signal } = {}) => {
    terminals.delete(id);
    info.exited = true;
    info.exitCode = typeof exitCode === "number" ? exitCode : null;
    // 保留 buffer：退出可能发生在渲染进程 attach 之前，仍需回放最后一段输出
    if (win && !win.isDestroyed()) win.webContents.send("terminal:exit", { id, exitCode: info.exitCode, signal: signal ?? null });
  });
  terminals.set(id, term);
  return { id, cwd: cwdResolved, agent };
});

// 渲染进程挂载后调用：返回挂载前的输出，并切换为实时推送（之后的输出只走 terminal:data）
ipcMain.handle("terminal:attach", (_e, { id } = {}) => {
  const info = terminalUrls.get(id);
  if (!info) return { data: "", url: null, exited: true, exitCode: null, missing: true };
  const data = info.buffer;
  info.buffer = "";
  info.attached = true;
  return { data, url: info.url, exited: info.exited, exitCode: info.exitCode };
});

ipcMain.handle("terminal:input", (_e, { id, data }) => {
  terminals.get(id)?.write(data);
});

ipcMain.handle("terminal:resize", (_e, { id, cols, rows }) => {
  try { terminals.get(id)?.resize(cols, rows); } catch { /* ignore */ }
});

ipcMain.handle("terminal:close", (_e, { id }) => {
  const term = terminals.get(id);
  if (term) { try { term.kill(); } catch { /* ignore */ } terminals.delete(id); }
  terminalUrls.delete(id);
});

ipcMain.handle("clipboard:read", () => clipboard.readText());

ipcMain.handle("clipboard:write", (_e, { text } = {}) => {
  clipboard.writeText(String(text ?? ""));
});

ipcMain.handle("shell:openExternal", async (_e, { url } = {}) => {
  const value = String(url || "");
  if (!/^(https?:|mailto:)/i.test(value)) return false;
  await shell.openExternal(value);
  return true;
});


ipcMain.handle("preview:pick", async (_e, { webContentsId, root } = {}) => {
  let abs;
  if (root) {
    const candidate = path.resolve(String(root));
    try { if (fs.statSync(candidate).isDirectory()) abs = candidate; } catch { /* ignore */ }
  }
  return pickElement(webContentsId, { root: abs, screenshots: store.state.settings?.elementScreenshots !== false });
});
ipcMain.handle("preview:cancel", async (_e, { webContentsId } = {}) => cancelPick(webContentsId));
ipcMain.handle("preview:detach", (_e, { webContentsId } = {}) => detachPreview(webContentsId));

// ── Grape HTML：把 spin-grape-html 编辑器作为预览页打开 ─────────────────
let grapeProc = null;
let grapeStarting = null;

function grapeRepo() {
  const candidates = [
    process.env.SPIN_GRAPE_HTML,
    path.join(app.getAppPath(), "..", "spin-grape-html"),
    path.join(__dirname, "..", "..", "spin-grape-html"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try { if (fs.existsSync(path.join(dir, "server", "index.js"))) return path.resolve(dir); } catch { /* ignore */ }
  }
  return null;
}

async function grapeReachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function ensureGrape() {
  const url = "http://127.0.0.1:8787/";
  if (await grapeReachable(url)) return { url, started: false };
  if (grapeStarting) return grapeStarting;
  const repo = grapeRepo();
  if (!repo) throw new Error("找不到 spin-grape-html（可用 SPIN_GRAPE_HTML 指定仓库路径）");
  grapeStarting = (async () => {
    let stderr = "";
    const child = spawn(process.execPath, [path.join(repo, "server", "index.js")], {
      cwd: repo,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: "8787" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    grapeProc = child;
    child.stdout.on("data", () => {});
    child.stderr.on("data", (b) => { stderr = (stderr + b.toString()).slice(-4000); });
    child.on("exit", () => { if (grapeProc === child) grapeProc = null; });
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (child.exitCode !== null) break;
      if (await grapeReachable(url)) return { url, started: true };
    }
    const tail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || "";
    throw new Error(`Grape 启动失败${tail ? `：${tail.slice(0, 240)}` : ""}`);
  })().finally(() => { grapeStarting = null; });
  return grapeStarting;
}

ipcMain.handle("grape:ensure", () => ensureGrape());

ipcMain.handle("harness:action", async (_e, { type, payload }) => {
  const fn = actions[type];
  if (!fn) throw new Error(`unknown action ${type}`);
  const result = await fn(payload || {});
  broadcast();
  return { ok: true, result };
});

function installMenu() {
  // 去掉默认菜单里的几个冲突加速键：⌘W（关窗口而不是关终端标签）、
  // ⌘+/-/0（webContents 缩放而不是终端字号）、⌘R（重载应用）、⌘A（全选文本域而不是终端缓冲区）。
  // 编辑菜单保留 copy/paste 角色：悬浮终端 / 输入框的复制粘贴依赖 Electron 的菜单加速键。
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    ...(isMac ? [] : [{ label: "文件", submenu: [{ role: "quit" }] }]),
    {
      label: "编辑",
      submenu: [
        { role: "undo" }, { role: "redo" },
        { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" },
        { type: "separator" },
        { role: "delete" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    ...(isMac ? [{ role: "windowMenu" }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 980, minWidth: 1180, minHeight: 760,
    backgroundColor: "#f2f5f7", title: "YieldMind Harness",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
  // 预览用 <webview>：强制去掉 preload / nodeIntegration，并禁止弹新窗口
  win.webContents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
  win.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    // 预览 webview 有独立焦点，宿主收不到键盘事件：把标签级快捷键转回 TerminalPanel
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const accel = process.platform === "darwin" ? input.meta : input.control;
      const key = String(input.key || "").toLowerCase();
      if (!accel || input.shift || input.alt) return;
      if (key === "w") { event.preventDefault(); win?.webContents.send("harness:close-terminal"); }
      else if (key === "t") { event.preventDefault(); win?.webContents.send("harness:new-terminal"); }
    });
  });
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(async () => {
  installMenu();
  // 多实例 / E2E 隔离：显式指定 userData 目录，避免与正在使用的窗口抢同一个 harness.db
  if (process.env.YMH_USER_DATA) app.setPath("userData", process.env.YMH_USER_DATA);
  store = await openDb(app.getPath("userData"));
  seed();
  await createWindow();
  broadcast();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { try { grapeProc?.kill(); } catch { /* ignore */ } });
