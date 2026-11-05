import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import pty from "node-pty";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { fileURLToPath } from "node:url";
import { openDb, DEFAULT_SETTINGS } from "./db.mjs";
import { AcpClient } from "./acp.mjs";
import { prepareWorktree, removeWorktree } from "./worktree.mjs";
import { pickElement, cancelPick, detachPreview } from "./preview.mjs";
import { formatContext, detectDevUrl } from "./ui-context.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL;
const workspaceRoot = path.join(app.getPath("documents"), "YieldMind", "workspace");
const active = new Map();
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
  const project = store.state.projects.find((p) => p.id === projectId) || activeProject();
  return {
    id: store.nextId("th"), todoId: null, title,
    projectId: project?.id || null, project: project?.path || workspaceRoot,
    agentId: agentId || store.state.settings?.defaultAgentId || store.state.agents.find((a) => a.projectId === (project?.id || store.state.activeProjectId))?.id || null,
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
  for (const thread of store.state.threads) {
    if (thread.projectId && !store.state.projects.some((p) => p.id === thread.projectId)) thread.projectId = project?.id || null;
    if (!thread.project) thread.project = store.state.projects.find((p) => p.id === thread.projectId)?.path || project?.path || workspaceRoot;
  }
  const draft = store.state.threads.find((t) => !t.todoId);
  if (draft) {
    if (!draft.agentId) draft.agentId = store.state.settings?.defaultAgentId || store.state.agents[0]?.id || null;
    return;
  }
  store.state.threads.push(newThreadRecord({ projectId: project?.id || null, title: "新任务" }));
}

function ensureDraftThread(project) {
  if (!project) return;
  if (store.state.threads.some((t) => t.projectId === project.id && !t.todoId)) return;
  store.state.threads.push(newThreadRecord({ projectId: project.id, title: "新任务" }));
}

function queueRun(todo, agent, trigger = "assign", parentRunId = null) {
  const run = {
    id: store.nextId("r"), todoId: todo.id, agentId: agent.id, status: "queued", trigger,
    startedAt: null, endedAt: null, cost: 0, tokens: 0, error: null, parentRunId, cwd: "", branch: null,
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
    thread = newThreadRecord({ projectId: projectId || store.state.activeProjectId, agentId, title: "新任务" });
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
    dbPath: store.file,
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
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
  state.cliCapabilities = bins.filter((bin) => spawnSync("which", [bin], { encoding: "utf8" }).status === 0);
  for (const a of state.agents) {
    if (!a.alias) a.alias = uniqueAlias(a.cli || a.name || "agent");
    if (!a.projectId) a.projectId = state.activeProjectId;
  }
  ensureThreads();
  if (state.hosts.length) { store.persist(); return; }
  const local = { id: "h-local", name: "local", kind: "local", addr: "127.0.0.1", status: "online", heartbeat: 0, version: "0.2.0" };
  state.hosts.push(local);
  fs.mkdirSync(activeProjectPath(), { recursive: true });
  store.addEvent("host.online", `local host ready · ${state.cliCapabilities.length} CLI(s) available`);
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
  todo.status = "in_progress";
  todo.lastRunFailed = false;
  store.addMessage(thread.id, run.id, "system", "system", `run ${run.id} started · ${agent.name}`);
  store.addEvent("run.started", `run.started todo=${todo.key} agent=${agent.name} cwd=${cwd}`);
  broadcast();

  const client = new AcpClient({
    cwd,
    ssh: isRemote ? { host: host.addr, port: host.port, user: host.user } : null,
    bin: store.state.settings?.dshBinary || undefined,
    home: store.state.settings?.dshHome || undefined,
    model: store.state.settings?.model || undefined,
    effort: store.state.settings?.effort || undefined,
  });
  const handle = { client, threadId: thread.id, streamId: null, thoughtId: null, tools: new Map(), done: false };
  active.set(run.id, handle);

  client.on("stderr", (text) => {
    const line = text.trim();
    if (line) store.addEvent("run.stderr", `run.stderr ${line.slice(0, 160)}`);
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
      run.error = String(err?.message || err).slice(0, 240);
      todo.status = "todo";
      todo.lastRunFailed = true;
      store.addMessage(thread.id, run.id, "system", "error", `run 失败：${run.error}`);
      store.addEvent("run.failed", `run.failed todo=${todo.key} ${run.error}`);
      store.state.inbox.unshift({ id: store.nextId("i"), todoId: todo.id, kind: "failed", title: `失败 · ${todo.title}`, at: Date.now(), read: false });
      try { await client.close(); } catch { /* ignore */ }
    }
  } finally {
    handle.done = true;
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

async function testHost(host) {
  const target = host.user ? `${host.user}@${host.addr}` : host.addr;
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"];
  if (host.port) args.push("-p", String(host.port));
  args.push(target, "sh -lc 'command -v dsh >/dev/null 2>&1'");
  try {
    await execFileAsync("ssh", args, { timeout: 12000 });
    host.status = "online";
    host.heartbeat = 0;
    store.addEvent("host.online", `host.online ${host.name}`);
    return { ok: true };
  } catch (err) {
    host.status = "offline";
    store.addEvent("host.offline", `host.offline ${host.name}: ${String(err.message || err).slice(0, 120)}`);
    return { ok: false, error: "SSH 失败，或远端未安装 dsh" };
  }
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
      ensureDraftThread(existing);
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
    ensureDraftThread(project);
    store.addEvent("project.added", `project.added ${project.name} path=${project.path}`);
    return project;
  },
  switchProject: ({ id }) => {
    const project = store.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在");
    store.state.activeProjectId = project.id;
    project.lastOpenedAt = now();
    store.state.projectPath = project.path;
    ensureDraftThread(project);
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
  // ── 会话：单一输入路径 ────────────────────────────────────────────────
  newThread: ({ projectId } = {}) => {
    const project = store.state.projects.find((p) => p.id === (projectId || store.state.activeProjectId)) || activeProject();
    const empty = store.state.threads.find((t) => !t.todoId);
    if (empty) {
      if (project) { empty.projectId = project.id; empty.project = project.path; }
      if (!empty.agentId) empty.agentId = store.state.agents[0]?.id || null;
      empty.updatedAt = now();
      return empty;
    }
    const thread = newThreadRecord({ projectId: project?.id || null, title: "新任务" });
    store.state.threads.push(thread);
    store.addEvent("thread.created", `thread.created ${thread.id}`);
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
  setThreadProject: ({ threadId, projectId }) => {
    const thread = store.state.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error("thread not found");
    if (thread.todoId) throw new Error("任务已绑定项目，不能切换；请新建任务");
    const project = store.state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("项目不存在");
    thread.projectId = project.id;
    thread.project = project.path;
    thread.updatedAt = now();
    // 草稿会话切项目 = 整个工作区切项目，否则该会话会从当前视图消失
    store.state.activeProjectId = project.id;
    store.state.projectPath = project.path;
    project.lastOpenedAt = now();
    store.addEvent("thread.project", `thread.project ${thread.id} → ${project.name}`);
    return thread;
  },
  /**
   * 唯一发送入口。按会话当前状态决定行为，永远先落消息：
   *   draft thread       → 分派（建任务 + 排队）
   *   active run         → steer（pending → injected / failed）
   *   todo 未确认无运行   → 新起一次 run，消息作为补充指令
   *   todo 已确认         → 仅记录
   */
  send: ({ threadId, text, agentId, projectId, context }) => {
    const value = String(text || "").trim();
    if (!value) throw new Error("内容不能为空");
    const thread = resolveThread({ threadId, projectId, agentId });
    const boundTodo = thread.todoId ? store.state.todos.find((t) => t.id === thread.todoId) : null;
    const agent = store.state.agents.find((a) => a.id === (agentId || thread.agentId || boundTodo?.agentId))
      || store.state.agents.find((a) => a.id === store.state.settings?.defaultAgentId)
      || store.state.agents[0] || null;
    const extra = context ? { context } : {};

    if (!boundTodo) {
      const mention = mentionOf(value);
      const userMsg = store.addMessage(thread.id, null, "user", "text", value, extra);
      // 拾取了 UI 元素 = 明确的改界面意图：即使没写 @别名也直接派活
      if (!mention && !(context && agent)) {
        if (context && !agent) {
          store.addMessage(thread.id, null, "system", "error", "未检测到可执行的 Agent：无法把元素发给 Agent。");
          return { mode: "error", threadId: thread.id };
        }
        return { mode: "chat", threadId: thread.id };
      }
      const alias = mention ? mention.toLowerCase() : "";
      const mentionProject = alias ? store.state.projects.find((p) => (p.alias || "").toLowerCase() === alias) || null : null;
      const mentionAgent = !mention
        ? agent
        : mentionProject
          ? store.state.agents.find((a) => a.id === thread.agentId) || store.state.agents[0] || null
          : store.state.agents.find((a) => (a.alias || "").toLowerCase() === alias) || null;
      if (!mentionAgent) {
        store.addMessage(thread.id, null, "system", "error", `未找到别名 @${mention}：请先在项目终端里启动 Agent，或使用可用别名 ${[...store.state.projects.map((p) => "@" + p.alias)].join(" ")}`);
        return { mode: "error", threadId: thread.id };
      }
      const project = mentionProject || store.state.projects.find((p) => p.id === (thread.projectId || projectId)) || activeProject();
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
    for (const agentId of ids) {
      const agent = store.state.agents.find((a) => a.id === agentId);
      if (!agent) continue;
      queueRun(todo, agent, "broadcast");
    }
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
    const agent = store.state.agents.find((a) => a.id === (todo.agentId || last?.agentId)) || store.state.agents[0];
    if (!agent) throw new Error("no agent");
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
    const host = { id: store.nextId("h"), name, kind: "ssh", addr, port, user, status: "offline", heartbeat: 0, version: "—" };
    store.state.hosts.push(host);
    store.addEvent("host.added", `host.added ${name} ${addr}`);
    return testHost(host);
  },
  testHost: async ({ id }) => {
    const host = store.state.hosts.find((h) => h.id === id);
    if (!host) throw new Error("host not found");
    return testHost(host);
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

ipcMain.handle("terminal:create", async (_e, { cwd, command, projectId } = {}) => {
  const id = `term-${Date.now().toString(36)}`;
  const settings = store.state.settings || {};
  const shell = settings.shellPath || (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh");
  const fallbackShell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh";
  const cwdResolved = cwd || activeProjectPath();
  const spawnOptions = {
    name: "xterm-256color",
    cols: 120,
    rows: 32,
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
    term = pty.spawn(fallbackShell, spawnArgs, spawnOptions);
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
  const info = { url: null, tail: "" };
  terminalUrls.set(id, info);
  term.onData((data) => {
    send(data);
    if (settings.autoDetectDevServerUrl === false) return;
    // dev server 地址探测：去 ANSI 后跨 chunk 保留尾部，发现变化就通知渲染进程
    info.tail = (info.tail + data).slice(-4000);
    const url = detectDevUrl(info.tail);
    if (url && url !== info.url) {
      info.url = url;
      if (win && !win.isDestroyed()) win.webContents.send("terminal:url", { id, url });
    }
  });
  term.onExit(() => { terminals.delete(id); terminalUrls.delete(id); send("\r\n[terminal exited]\r\n"); });
  terminals.set(id, term);
  return { id, cwd: cwdResolved, agent };
});

ipcMain.handle("terminal:input", (_e, { id, data }) => {
  terminals.get(id)?.write(data);
});

ipcMain.handle("terminal:resize", (_e, { id, cols, rows }) => {
  try { terminals.get(id)?.resize(cols, rows); } catch { /* ignore */ }
});

ipcMain.handle("terminal:close", (_e, { id }) => {
  const term = terminals.get(id);
  if (term) { try { term.kill(); } catch { /* ignore */ } terminals.delete(id); terminalUrls.delete(id); }
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

ipcMain.handle("harness:action", async (_e, { type, payload }) => {
  const fn = actions[type];
  if (!fn) throw new Error(`unknown action ${type}`);
  const result = await fn(payload || {});
  broadcast();
  return { ok: true, result };
});

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
  });
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(async () => {
  store = await openDb(app.getPath("userData"));
  seed();
  await createWindow();
  broadcast();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
