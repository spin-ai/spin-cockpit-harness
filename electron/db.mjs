import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);
let wasm = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
if (!fs.existsSync(wasm) && wasm.includes("app.asar")) {
  wasm = wasm.replace("app.asar", "app.asar.unpacked");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, desc TEXT, color TEXT, status TEXT, created_at INTEGER, last_opened_at INTEGER, alias TEXT);
CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT, kind TEXT, addr TEXT, status TEXT, heartbeat INTEGER, version TEXT, port INTEGER, user TEXT, caps TEXT, last_probe INTEGER, latency_ms INTEGER, max_concurrency INTEGER, default_cwd TEXT, probe_error TEXT);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT, host_id TEXT, cli TEXT, cwd TEXT, max_concurrency INTEGER, approval TEXT, color TEXT, skills TEXT, alias TEXT, project_id TEXT, terminal_id TEXT);
CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, key TEXT, title TEXT, desc TEXT, acceptance TEXT, status TEXT, agent_id TEXT, priority TEXT, due TEXT, parent_id TEXT, tags TEXT, subtasks TEXT, blocked_by TEXT, missing_writeback INTEGER, last_run_failed INTEGER, cwd TEXT, created_at INTEGER, updated_at INTEGER, confirmed INTEGER, project_id TEXT);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, todo_id TEXT, agent_id TEXT, status TEXT, trigger TEXT, started_at INTEGER, ended_at INTEGER, cost REAL, tokens INTEGER, error TEXT, parent_run_id TEXT, cwd TEXT, branch TEXT, host_id TEXT, created_at INTEGER, tokens_in INTEGER, tokens_out INTEGER, usage_source TEXT, error_class TEXT, exit_code INTEGER, queue_wait_ms INTEGER, duration_ms INTEGER, queue_reason TEXT);
CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, todo_id TEXT, title TEXT, project_id TEXT, project TEXT, agent_id TEXT, created_at INTEGER, updated_at INTEGER, model TEXT, model_name TEXT, effort TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, todo_id TEXT, run_id TEXT, role TEXT, kind TEXT, content TEXT, injected INTEGER, created_at INTEGER, thread_id TEXT, delivery TEXT, context TEXT);
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, todo_id TEXT, run_id TEXT, kind TEXT, title TEXT, origin TEXT, ref TEXT, deep_link TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts INTEGER, type TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, todo_id TEXT, kind TEXT, title TEXT, at INTEGER, read INTEGER, pinned INTEGER);
CREATE TABLE IF NOT EXISTS context (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
`;

/** 应用设置默认值。缺失的键一律从这里补齐。 */
export const DEFAULT_SETTINGS = {
  defaultView: "workspace",        // workspace | projects | stats | hosts
  theme: "system",                // light | dark | system
  chatFontSize: 13,               // 11–16
  enterToSend: true,
  confirmStop: false,
  defaultAgentId: null,
  maxConcurrentRuns: 0,           // 0 = 不限制
  approvalPolicy: "ask",          // ask | allow | deny
  dshBinary: "",                  // 空 = 用 PATH 里的 dsh
  dshHome: "",
  model: "",
  effort: "",
  terminalFontSize: 12,           // 10–18
  terminalScrollback: 5000,       // 1000–50000
  shellPath: "",                  // 空 = $SHELL / powershell
  autoDetectDevServerUrl: true,
  previewHomeUrl: "http://localhost:5173/",
  elementScreenshots: true,
  contextDetail: "standard",      // compact | standard
};

const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };

export async function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "harness.db");
  const SQL = await initSqlJs({ locateFile: () => wasm });
  const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(SCHEMA);
  for (const sql of [
    "ALTER TABLE runs ADD COLUMN cwd TEXT",
    "ALTER TABLE runs ADD COLUMN branch TEXT",
    "ALTER TABLE hosts ADD COLUMN port INTEGER",
    "ALTER TABLE hosts ADD COLUMN user TEXT",
    "ALTER TABLE todos ADD COLUMN confirmed INTEGER",
    "ALTER TABLE todos ADD COLUMN project_id TEXT",
    "ALTER TABLE projects ADD COLUMN desc TEXT",
    "ALTER TABLE projects ADD COLUMN color TEXT",
    "ALTER TABLE projects ADD COLUMN status TEXT",
    "ALTER TABLE projects ADD COLUMN created_at INTEGER",
    "ALTER TABLE projects ADD COLUMN last_opened_at INTEGER",
    "ALTER TABLE projects ADD COLUMN alias TEXT",
    "ALTER TABLE agents ADD COLUMN alias TEXT",
    "ALTER TABLE agents ADD COLUMN project_id TEXT",
    "ALTER TABLE agents ADD COLUMN terminal_id TEXT",
    "ALTER TABLE messages ADD COLUMN thread_id TEXT",
    "ALTER TABLE threads ADD COLUMN model TEXT",
    "ALTER TABLE threads ADD COLUMN model_name TEXT",
    "ALTER TABLE threads ADD COLUMN effort TEXT",
    "ALTER TABLE messages ADD COLUMN delivery TEXT",
    "ALTER TABLE messages ADD COLUMN context TEXT",
    // 主机：能力矩阵 / 探测时间 / 负载上限 / 默认远端目录（见 docs/ARCH-hosts-stats.md）
    "ALTER TABLE hosts ADD COLUMN caps TEXT",
    "ALTER TABLE hosts ADD COLUMN last_probe INTEGER",
    "ALTER TABLE hosts ADD COLUMN latency_ms INTEGER",
    "ALTER TABLE hosts ADD COLUMN max_concurrency INTEGER",
    "ALTER TABLE hosts ADD COLUMN default_cwd TEXT",
    "ALTER TABLE hosts ADD COLUMN probe_error TEXT",
    // run：用量 / 耗时 / 排队 / 错误分类（统计页的唯一事实来源）
    "ALTER TABLE runs ADD COLUMN host_id TEXT",
    "ALTER TABLE runs ADD COLUMN created_at INTEGER",
    "ALTER TABLE runs ADD COLUMN tokens_in INTEGER",
    "ALTER TABLE runs ADD COLUMN tokens_out INTEGER",
    "ALTER TABLE runs ADD COLUMN usage_source TEXT",
    "ALTER TABLE runs ADD COLUMN error_class TEXT",
    "ALTER TABLE runs ADD COLUMN exit_code INTEGER",
    "ALTER TABLE runs ADD COLUMN queue_wait_ms INTEGER",
    "ALTER TABLE runs ADD COLUMN duration_ms INTEGER",
    "ALTER TABLE runs ADD COLUMN queue_reason TEXT",
  ]) { try { db.run(sql); } catch { /* exists */ } }

  const state = {
    hosts: [], projects: [], agents: [], todos: [], runs: [], threads: [], messages: [],
    artifacts: [], events: [], inbox: [], context: {}, seq: 0, activeProjectId: null,
    settings: { ...DEFAULT_SETTINGS },
  };

  const rows = (sql) => {
    const res = db.exec(sql);
    if (!res.length) return [];
    return res[0].values.map((v) => Object.fromEntries(res[0].columns.map((c, i) => [c, v[i]])));
  };

  // 老库没有 probes/caps：一律回落成空值，页面显示「未探测」而不是假的 0
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  state.hosts = rows("SELECT * FROM hosts").map((r) => ({
    id: r.id, name: r.name, kind: r.kind, addr: r.addr, status: r.status, heartbeat: r.heartbeat || 0,
    version: r.version || "—", port: r.port || 22, user: r.user || "",
    caps: J(r.caps, []), lastProbe: num(r.last_probe), latencyMs: num(r.latency_ms),
    maxConcurrency: num(r.max_concurrency) || 0, defaultCwd: r.default_cwd || "", probeError: r.probe_error || null,
  }));
  state.projects = rows("SELECT * FROM projects").map((r) => ({
    id: r.id, name: r.name, path: r.path, desc: r.desc || "", color: r.color || "slate",
    status: r.status || "in_progress", createdAt: r.created_at || Date.now(), lastOpenedAt: r.last_opened_at || r.created_at || 0,
    alias: r.alias || "",
  }));
  state.agents = rows("SELECT * FROM agents").map((r) => ({ id: r.id, name: r.name, hostId: r.host_id, cli: r.cli, cwd: r.cwd, max: r.max_concurrency, approval: r.approval, color: r.color, skills: J(r.skills, []) }));
  state.todos = rows("SELECT * FROM todos").map((r) => ({
    id: r.id, key: r.key, title: r.title, desc: r.desc || "", acceptance: J(r.acceptance, []), status: r.status,
    agentId: r.agent_id || null, priority: r.priority, due: r.due, parentId: r.parent_id || null,
    tags: J(r.tags, []), subtasks: J(r.subtasks, []), blockedBy: J(r.blocked_by, []),
    missingWriteback: !!r.missing_writeback, lastRunFailed: !!r.last_run_failed, confirmed: !!r.confirmed,
    cwd: r.cwd || "", projectId: r.project_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
  state.runs = rows("SELECT * FROM runs").map((r) => ({
    id: r.id, todoId: r.todo_id, agentId: r.agent_id, status: r.status, trigger: r.trigger,
    startedAt: r.started_at, endedAt: r.ended_at, cost: r.cost || 0, tokens: num(r.tokens),
    error: r.error || null, parentRunId: r.parent_run_id || null, cwd: r.cwd || "", branch: r.branch || null,
    hostId: r.host_id || null, createdAt: num(r.created_at) || r.started_at || null,
    tokensIn: num(r.tokens_in), tokensOut: num(r.tokens_out), usageSource: r.usage_source || "unknown",
    errorClass: r.error_class || null, exitCode: num(r.exit_code),
    queueWaitMs: num(r.queue_wait_ms), durationMs: num(r.duration_ms), queueReason: r.queue_reason || null,
  }));
  state.threads = rows("SELECT * FROM threads").map((r) => ({
    id: r.id, todoId: r.todo_id || null, title: r.title || "", projectId: r.project_id || null,
    project: r.project || "", agentId: r.agent_id || null,
    model: r.model || "", modelName: r.model_name || "", effort: r.effort || "",
    createdAt: r.created_at || Date.now(), updatedAt: r.updated_at || r.created_at || Date.now(),
  }));
  state.messages = rows("SELECT * FROM messages").map((r) => ({
    id: r.id, threadId: r.thread_id || null, todoId: r.todo_id || null, runId: r.run_id || null,
    role: r.role, kind: r.kind, content: r.content, injected: !!r.injected,
    delivery: r.delivery || undefined, context: J(r.context, null), createdAt: r.created_at,
  }));
  state.artifacts = rows("SELECT * FROM artifacts").map((r) => ({ id: r.id, todoId: r.todo_id, runId: r.run_id, kind: r.kind, title: r.title, origin: r.origin, ref: r.ref, deepLink: r.deep_link, createdAt: r.created_at }));
  state.events = rows("SELECT * FROM events").map((r) => ({ id: r.id, ts: r.ts, type: r.type, text: r.text }));
  state.inbox = rows("SELECT * FROM inbox").map((r) => ({ id: r.id, todoId: r.todo_id, kind: r.kind, title: r.title, at: r.at, read: !!r.read, pinned: !!r.pinned }));
  state.context = rows("SELECT * FROM context").map((r) => ({ k: r.k, v: J(r.v, null) })).find((x) => x.k === "current")?.v || {};
  state.settings = { ...DEFAULT_SETTINGS, ...J(rows("SELECT v FROM settings WHERE k='app'")[0]?.v, {}) };
  state.seq = Number(rows("SELECT v FROM meta WHERE k='seq'")[0]?.v || 100);
  state.projectPath = rows("SELECT v FROM meta WHERE k='projectPath'")[0]?.v || "";
  state.projectId = rows("SELECT v FROM meta WHERE k='projectId'")[0]?.v || "";
  state.activeProjectId = rows("SELECT v FROM meta WHERE k='activeProjectId'")[0]?.v || null;
  state.chatScopeMigrated = rows("SELECT v FROM meta WHERE k='chatScopeMigrated'")[0]?.v === "1";
  if (!state.projects.length && state.projectPath) {
    state.projects.push({ id: "p-local", name: state.projectPath.split("/").filter(Boolean).slice(-1)[0] || "project", path: state.projectPath, desc: "", color: "teal", status: "in_progress", createdAt: Date.now(), lastOpenedAt: Date.now() });
    state.projectId = "p-local";
    state.activeProjectId = "p-local";
  }

  // ── thread migration ────────────────────────────────────────────────
  // 每个 todo 必须有 thread；旧消息按 todo_id 回填 thread_id。
  let migrated = false;
  const threadByTodo = () => new Map(state.threads.filter((t) => t.todoId).map((t) => [t.todoId, t]));
  let map = threadByTodo();
  for (const todo of state.todos) {
    if (map.has(todo.id)) continue;
    const thread = {
      id: `th${++state.seq}`, todoId: todo.id, title: todo.title,
      projectId: todo.projectId || null, project: todo.cwd || "",
      agentId: todo.agentId || null, model: "", modelName: "", effort: "",
      createdAt: todo.createdAt || Date.now(), updatedAt: Date.now(),
    };
    state.threads.push(thread);
    map.set(todo.id, thread);
    migrated = true;
  }
  map = threadByTodo();
  for (const msg of state.messages) {
    if (msg.threadId) continue;
    const thread = msg.todoId ? map.get(msg.todoId) : null;
    if (thread) { msg.threadId = thread.id; migrated = true; }
  }
  state.messages = state.messages.filter((m) => m.threadId);

  let timer = null;
  const writeNow = () => {
    db.run("BEGIN");
    for (const t of ["hosts", "projects", "agents", "todos", "runs", "threads", "messages", "artifacts", "events", "inbox", "context", "settings", "meta"]) db.run(`DELETE FROM ${t}`);
    for (const h of state.hosts) db.run(
      "INSERT INTO hosts (id,name,kind,addr,status,heartbeat,version,port,user,caps,last_probe,latency_ms,max_concurrency,default_cwd,probe_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [h.id, h.name, h.kind, h.addr, h.status, h.heartbeat || 0, h.version || "—", h.port || 22, h.user || "",
        JSON.stringify(h.caps || []), h.lastProbe ?? null, h.latencyMs ?? null, h.maxConcurrency || 0, h.defaultCwd || "", h.probeError ?? null],
    );
    for (const p of state.projects) db.run("INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?)", [p.id, p.name, p.path, p.desc || "", p.color || "slate", p.status || "in_progress", p.createdAt || Date.now(), p.lastOpenedAt || 0, p.alias || ""]);
    for (const a of state.agents) db.run("INSERT INTO agents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [a.id, a.name, a.hostId, a.cli, a.cwd, a.max, a.approval, a.color, JSON.stringify(a.skills || []), a.alias || "", a.projectId || "", a.terminalId || ""]);
    for (const t of state.todos) db.run("INSERT INTO todos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t.id, t.key, t.title, t.desc || "", JSON.stringify(t.acceptance || []), t.status, t.agentId || null, t.priority, t.due || "", t.parentId || null, JSON.stringify(t.tags || []), JSON.stringify(t.subtasks || []), JSON.stringify(t.blockedBy || []), t.missingWriteback ? 1 : 0, t.lastRunFailed ? 1 : 0, t.cwd || "", t.createdAt || Date.now(), t.updatedAt || Date.now(), t.confirmed ? 1 : 0, t.projectId || null]);
    for (const r of state.runs) db.run(
      "INSERT INTO runs (id,todo_id,agent_id,status,trigger,started_at,ended_at,cost,tokens,error,parent_run_id,cwd,branch,host_id,created_at,tokens_in,tokens_out,usage_source,error_class,exit_code,queue_wait_ms,duration_ms,queue_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [r.id, r.todoId, r.agentId, r.status, r.trigger || "assign", r.startedAt || null, r.endedAt || null, r.cost || 0,
        r.tokens ?? null, r.error || null, r.parentRunId || null, r.cwd || "", r.branch || null, r.hostId || null,
        r.createdAt || null, r.tokensIn ?? null, r.tokensOut ?? null, r.usageSource || "unknown", r.errorClass || null,
        r.exitCode ?? null, r.queueWaitMs ?? null, r.durationMs ?? null, r.queueReason || null],
    );
    for (const t of state.threads) db.run("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?,?,?)", [t.id, t.todoId || null, t.title || "", t.projectId || null, t.project || "", t.agentId || null, t.createdAt || Date.now(), t.updatedAt || Date.now(), t.model || null, t.modelName || null, t.effort || null]);
    for (const m of state.messages) db.run("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?,?,?,?)", [m.id, m.todoId || null, m.runId || null, m.role, m.kind || "text", m.content, m.injected ? 1 : 0, m.createdAt, m.threadId || null, m.delivery || null, m.context ? JSON.stringify(m.context) : null]);
    for (const a of state.artifacts) db.run("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?)", [a.id, a.todoId, a.runId, a.kind, a.title, a.origin, a.ref, a.deepLink, a.createdAt || Date.now()]);
    for (const e of state.events) db.run("INSERT INTO events VALUES (?,?,?,?)", [e.id, e.ts, e.type, e.text]);
    for (const i of state.inbox) db.run("INSERT INTO inbox VALUES (?,?,?,?,?,?,?)", [i.id, i.todoId, i.kind, i.title, i.at, i.read ? 1 : 0, i.pinned ? 1 : 0]);
    db.run("INSERT INTO context VALUES ('current', ?)", [JSON.stringify(state.context)]);
    db.run("INSERT INTO settings VALUES ('app', ?)", [JSON.stringify(state.settings || {})]);
    db.run("INSERT INTO meta VALUES ('seq', ?)", [String(state.seq)]);
    db.run("INSERT INTO meta VALUES ('projectPath', ?)", [state.projectPath || ""]);
    db.run("INSERT INTO meta VALUES ('projectId', ?)", [state.projectId || ""]);
    db.run("INSERT INTO meta VALUES ('activeProjectId', ?)", [state.activeProjectId || ""]);
    db.run("INSERT INTO meta VALUES ('chatScopeMigrated', ?)", [state.chatScopeMigrated ? "1" : "0"]);
    db.run("INSERT INTO meta VALUES ('cliCapabilities', ?)", [JSON.stringify(state.cliCapabilities || [])]);
    db.run("COMMIT");
    fs.writeFileSync(file, Buffer.from(db.export()));
  };
  const persist = () => { clearTimeout(timer); timer = setTimeout(writeNow, 120); };
  const flush = () => { clearTimeout(timer); writeNow(); };

  const nextId = (prefix) => { state.seq += 1; persist(); return `${prefix}${state.seq}`; };
  const addEvent = (type, text) => {
    state.events.unshift({ id: nextId("e"), ts: Date.now(), type, text });
    state.events = state.events.slice(0, 300);
    console.log(`[${type}] ${text}`);
  };
  // 消息的宿主是 thread；todoId 由 thread 派生（保留用于按项目过滤 / 旧数据兼容）
  const addMessage = (threadId, runId, role, kind, content, extra = {}) => {
    const thread = state.threads.find((t) => t.id === threadId);
    const msg = {
      id: nextId("m"), threadId, todoId: thread?.todoId ?? null, runId,
      role, kind, content, createdAt: Date.now(), injected: false, ...extra,
    };
    state.messages.push(msg);
    if (thread) thread.updatedAt = Date.now();
    persist();
    return msg;
  };
  const updateMessage = (id, patch) => {
    const m = state.messages.find((x) => x.id === id);
    if (m) { Object.assign(m, patch); persist(); }
    return m;
  };

  if (migrated) persist();
  return { db, state, persist, flush, nextId, addEvent, addMessage, updateMessage, file };
}
