import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, path TEXT, desc TEXT, color TEXT, status TEXT, created_at INTEGER, last_opened_at INTEGER, alias TEXT);
CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, name TEXT, kind TEXT, addr TEXT, status TEXT, heartbeat INTEGER, version TEXT, port INTEGER, user TEXT, caps TEXT, last_probe INTEGER, latency_ms INTEGER, max_concurrency INTEGER, default_cwd TEXT, probe_error TEXT);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT, host_id TEXT, cli TEXT, cwd TEXT, max_concurrency INTEGER, approval TEXT, color TEXT, skills TEXT, alias TEXT, project_id TEXT, terminal_id TEXT, role TEXT DEFAULT 'worker', instructions TEXT DEFAULT '', max_children INTEGER DEFAULT 4);
CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, key TEXT, title TEXT, desc TEXT, acceptance TEXT, status TEXT, agent_id TEXT, priority TEXT, due TEXT, parent_id TEXT, tags TEXT, subtasks TEXT, blocked_by TEXT, missing_writeback INTEGER, last_run_failed INTEGER, cwd TEXT, created_at INTEGER, updated_at INTEGER, confirmed INTEGER, project_id TEXT, kind TEXT DEFAULT 'task', mission_state TEXT, bot_id TEXT);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, todo_id TEXT, agent_id TEXT, status TEXT, trigger TEXT, started_at INTEGER, ended_at INTEGER, cost REAL, tokens INTEGER, error TEXT, parent_run_id TEXT, cwd TEXT, branch TEXT, host_id TEXT, created_at INTEGER, tokens_in INTEGER, tokens_out INTEGER, usage_source TEXT, error_class TEXT, exit_code INTEGER, queue_wait_ms INTEGER, duration_ms INTEGER, queue_reason TEXT, kind TEXT DEFAULT 'worker', delegation_id TEXT, terminal_id TEXT, runtime TEXT, worktree_cleaned INTEGER, acp_session TEXT);
CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, todo_id TEXT, title TEXT, project_id TEXT, project TEXT, agent_id TEXT, created_at INTEGER, updated_at INTEGER, model TEXT, model_name TEXT, effort TEXT, kind TEXT DEFAULT 'chat', bot_id TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, todo_id TEXT, run_id TEXT, role TEXT, kind TEXT, content TEXT, injected INTEGER, created_at INTEGER, thread_id TEXT, delivery TEXT, context TEXT, meta TEXT);
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, todo_id TEXT, run_id TEXT, kind TEXT, title TEXT, origin TEXT, ref TEXT, deep_link TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts INTEGER, type TEXT, text TEXT);
CREATE TABLE IF NOT EXISTS context (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS mission_plans (id TEXT PRIMARY KEY, mission_id TEXT, revision INTEGER, status TEXT, plan TEXT, created_at INTEGER, approved_at INTEGER);
CREATE TABLE IF NOT EXISTS delegations (id TEXT PRIMARY KEY, mission_id TEXT, supervisor_run_id TEXT, child_todo_id TEXT, child_run_id TEXT, agent_id TEXT, plan_step_key TEXT, title TEXT, brief TEXT, acceptance TEXT, status TEXT, result_summary TEXT, artifacts TEXT, branch TEXT, created_at INTEGER, updated_at INTEGER, completed_at INTEGER, bot_id TEXT);
CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, version TEXT, path TEXT, enabled INTEGER, builtin INTEGER, manifest TEXT, permissions TEXT, installed_at INTEGER, last_error TEXT, last_run_at INTEGER);
CREATE TABLE IF NOT EXISTS plugin_kv (plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER, PRIMARY KEY (plugin_id, key));
CREATE TABLE IF NOT EXISTS todo_links (id TEXT PRIMARY KEY, todo_id TEXT, plugin_id TEXT, kind TEXT, ref TEXT, title TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS scenes (project_id TEXT PRIMARY KEY, text TEXT, config TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS coordination_scenes (id TEXT PRIMARY KEY, name TEXT, project_id TEXT, template TEXT, config TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS terminals (id TEXT PRIMARY KEY, project_id TEXT, todo_id TEXT, run_id TEXT, agent_id TEXT, cwd TEXT, kind TEXT, title TEXT, status TEXT, exit_code INTEGER, output_tail TEXT, created_at INTEGER, ended_at INTEGER);
-- 人格 bot：身份（人格卡）/ 策略 / 配额都存在档案里；回合另表，便于按时间查与清理
CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, avatar_class TEXT, persona TEXT, capability TEXT, channels TEXT, policy TEXT, budget TEXT, status TEXT, muted_until INTEGER, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS bot_turns (id TEXT PRIMARY KEY, bot_id TEXT, channel TEXT, trigger TEXT, input TEXT, injected TEXT, reply TEXT, decision TEXT, reason TEXT, run_id TEXT, cost TEXT, created_at INTEGER, thread_id TEXT, trace TEXT);
-- 群聊（参考 ORCA 的 bot group）：群、成员、消息；replyMode 决定一句话发给谁
CREATE TABLE IF NOT EXISTS bot_groups (id TEXT PRIMARY KEY, name TEXT, reply_mode TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS bot_group_members (group_id TEXT, bot_id TEXT, PRIMARY KEY (group_id, bot_id));
CREATE TABLE IF NOT EXISTS bot_group_messages (id TEXT PRIMARY KEY, group_id TEXT, seq INTEGER, author TEXT, bot_id TEXT, bot_name TEXT, text TEXT, decision TEXT, created_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, bot_id TEXT, kind TEXT, data TEXT, updated_at INTEGER);
`;

/** 应用设置默认值。缺失的键一律从这里补齐。 */
export const DEFAULT_SETTINGS = {
  defaultView: "workspace",        // workspace | projects | settings（老的 stats|hosts 由渲染层落到 settings）
  uiLanguage: "zh",               // zh | en（en = 界面语言预览：标题 / 导航 / 页签 / 页头按钮）
  theme: "system",                // system | light | paper | vslight | dark | vsdark | midnight | forest | graphite | monokai | onedark | solarized | dracula
  chatFontSize: 13,               // 11–16
  uiScale: 0,                     // 0 = 自动（跟随屏幕分辨率）；80–150 = 手动固定百分比
  enterToSend: true,
  confirmStop: false,
  defaultAgentId: null,
  maxConcurrentRuns: 0,           // 0 = 不限制
  approvalPolicy: "ask",          // ask | allow | deny
  dshBinary: "",                  // 空 = 用 PATH 里的 dsh
  dshEnv: "",                     // 额外环境变量（KEY=VALUE，每行一条），启动 dsh 时注入
  dshHome: "",
  model: "",
  effort: "",
  terminalFontSize: 12,           // 10–18
  terminalScrollback: 5000,       // 1000–50000
  shellPath: "",                  // 空 = $SHELL / powershell
  autoDetectDevServerUrl: true,
  previewHomeUrl: "http://localhost:5173/",
  elementScreenshots: true,
  previewIgnoreCertErrors: false,  // 自签名 https dev server：开了才信任
  previewPermissionSites: "",      // 预览页站点权限 JSON：{ origin: ["media", ...] }
  previewAgentControl: true,
  // 桌面操作（agent-desktop MCP）：默认关；开了会给 Agent 读/点桌面窗口的能力
  // 桌面操作 MCP（agent-desktop）：默认关
  agentDesktopEnabled: false,
  contextDetail: "standard",      // compact | standard
  knowledgeCloudIndex: false,     // 云端向量索引（Ark embedding）：默认关，关 = 资料一个字节不出网
  imEnabled: false,
  // 飞书自建应用（扫码配置写入；secret 以 enc: 前缀加密）
  imFeishuAppId: "",
  imFeishuAppSecret: "",
  imFeishuBoundAt: 0,
  imFeishuVerificationToken: "",
  imFeishuLastChat: "",
  // 飞书事件接收方式：ws（长连接，推荐）| http（公网回调）
  imFeishuMode: "ws",
  imTelegramToken: "",
  imTelegramAllow: "",
  imWebhookUrl: "",
  imWebhookToken: "",
  imInboundPort: 0,
  imAllowIds: "",
  superAgentEnabled: true,
  maxSupervisorRuns: 1,
  maxMissionChildren: 4,
  missionBudgetMinutes: 30,
  worktreeMode: "auto",           // auto | always | never；项目 Scene 可覆盖
};

const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };

export async function openDb(dir, { onTranscript } = {}) {
  // 可选的 L1 索引钩子：消息 / 事件写入时同步给记忆层（主进程传，自检不传）
  // 钩子绝不能让业务写入失败，所以统一包在 try 里
  const indexTranscript = (row) => { try { onTranscript?.(row); } catch { /* 索引失败不影响写入 */ } };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "harness.db");
  // node:sqlite：Electron 内置、零原生依赖，和 knowledge / memory / persona 用同一个引擎
  const db = new DatabaseSync(file);
  // WAL + NORMAL：改动先落 -wal，崩溃可恢复；不再「每次 persist 把整库导出成 Buffer 写盘」
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA busy_timeout=3000");
  db.exec(SCHEMA);

  // 语句缓存：同一批 DELETE / INSERT 每秒可能跑几十次，重复 prepare 是纯开销
  const stmts = new Map();
  const stmt = (sql) => {
    let cached = stmts.get(sql);
    if (!cached) { cached = db.prepare(sql); stmts.set(sql, cached); }
    return cached;
  };
  // node:sqlite 只接受 null / number / bigint / string / Buffer：undefined 与 boolean 先归一化，
  // 否则老状态里少一个字段就会整批写入失败（sql.js 是宽松绑定，不能照搬）
  const bind = (params) => (Array.isArray(params) ? params : []).map((v) => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  });
  const run = (sql, params = []) => stmt(sql).run(...bind(params));
  const rows = (sql, params = []) => stmt(sql).all(...bind(params));
  for (const sql of [
    "ALTER TABLE runs ADD COLUMN cwd TEXT",
    // run 的 ACP 会话 id：进程退出后可以 session/resume 续上（dsh 的 agentCapabilities.sessionCapabilities.resume）
    "ALTER TABLE runs ADD COLUMN acp_session TEXT",
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
    // 人格 bot：一条 thread 归一个 bot（todo_id 为空），见 ARCH-chat-thread「bot thread」
    "ALTER TABLE threads ADD COLUMN bot_id TEXT",
    "ALTER TABLE messages ADD COLUMN delivery TEXT",
    "ALTER TABLE messages ADD COLUMN context TEXT",
    // 人格 bot：主动建议落成任务后记 todo_id；建议本身存 proposal（含 dismissed）
    "ALTER TABLE bot_turns ADD COLUMN todo_id TEXT",
    "ALTER TABLE bot_turns ADD COLUMN proposal TEXT",
    // 机器人这一轮用过哪些只读工具（审计用，见 electron/bot/tools.mjs）
    "ALTER TABLE bot_turns ADD COLUMN tools TEXT",
    // 一个 bot 多个会话（ORCA 的 Chats 列表）：回合归到具体那条 thread
    "ALTER TABLE bot_turns ADD COLUMN thread_id TEXT",
    // bot 绑定执行体：work 档位起 run 时用它当 agent
    "ALTER TABLE bots ADD COLUMN executor_agent_id TEXT",
    // bot 的角色：主管（拆解/分派）/ 员工（接任务）
    "ALTER TABLE bots ADD COLUMN role TEXT",
    // 派单链记住「谁派的」：bot 建的任务 / 它派下去的子任务（舞台用它把活挂回机器人）
    "ALTER TABLE todos ADD COLUMN bot_id TEXT",
    "ALTER TABLE delegations ADD COLUMN bot_id TEXT",
    // 编辑消息后重发：被新版本取代的后续消息打标记（软删除，可追溯）
    "ALTER TABLE messages ADD COLUMN superseded_by TEXT",
    "ALTER TABLE messages ADD COLUMN meta TEXT",
    "ALTER TABLE bot_turns ADD COLUMN trace TEXT",
    // 群消息的回合明细：{ turnId, runId, cost, ms } —— 点开能看这一句对应的 run 轨迹
    "ALTER TABLE bot_group_messages ADD COLUMN meta TEXT",
    // 主机：能力矩阵 / 探测时间 / 负载上限 / 默认远端目录（见 docs/arch/ARCH-hosts-stats.md）
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
    // Super Agent / Mission（见 docs/arch/ARCH-super-agent.md）
    "ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'worker'",
    "ALTER TABLE agents ADD COLUMN instructions TEXT DEFAULT ''",
    "ALTER TABLE agents ADD COLUMN max_children INTEGER DEFAULT 4",
    "ALTER TABLE threads ADD COLUMN kind TEXT DEFAULT 'chat'",
    "ALTER TABLE todos ADD COLUMN kind TEXT DEFAULT 'task'",
    "ALTER TABLE todos ADD COLUMN mission_state TEXT",
    "ALTER TABLE runs ADD COLUMN kind TEXT DEFAULT 'worker'",
    "ALTER TABLE runs ADD COLUMN delegation_id TEXT",
    // 终端启动的 Agent 也要进 TODO / 统计，用 terminal_id 回连 pty
    "ALTER TABLE runs ADD COLUMN terminal_id TEXT",
    "ALTER TABLE runs ADD COLUMN runtime TEXT",
    "ALTER TABLE runs ADD COLUMN worktree_cleaned INTEGER",
    // 修复历史错位：bot_turns 的 todo_id 曾被写成 cost 的 JSON（{}），这类行其余字段也已错位，
    // 无法可靠还原，直接丢弃（回合审计上限 300 条，下一次 persist 会写回正序）
    "DELETE FROM bot_turns WHERE todo_id LIKE {%",
    // 修复历史错位：老库的 threads 物理列序是 …bot_id, kind，位置插入把两列写反；
    // 特征 = kind 里装的是 bot id、bot_id 里装的是 chat/mission/bot 或为 NULL
    "UPDATE threads SET bot_id = CASE WHEN kind LIKE bot-% THEN kind ELSE NULL END, kind = COALESCE(bot_id, (CASE WHEN kind LIKE bot-% THEN bot ELSE chat END)) WHERE (kind IS NULL OR kind LIKE bot-%) AND (bot_id IS NULL OR bot_id IN (chat,mission,bot))",
  ]) { try { run(sql); } catch { /* exists */ } }

  // 独立收件箱已移除；旧版本数据库里的 inbox 表一并清理，避免遗留死数据。
  try { run("DROP TABLE IF EXISTS inbox"); } catch { /* ignore */ }

  const state = {
    hosts: [], projects: [], agents: [], todos: [], runs: [], threads: [], messages: [],
    artifacts: [], events: [], context: {}, seq: 0, activeProjectId: null,
    missionPlans: [], delegations: [],
    plugins: [], pluginKv: [], todoLinks: [], scenes: [], coordinationScenes: [], terminals: [],
    settings: { ...DEFAULT_SETTINGS },
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
  state.agents = rows("SELECT * FROM agents").map((r) => ({
    id: r.id, name: r.name, hostId: r.host_id, cli: r.cli, cwd: r.cwd, max: r.max_concurrency,
    approval: r.approval, color: r.color, skills: J(r.skills, []), alias: r.alias || "",
    projectId: r.project_id || "", terminalId: r.terminal_id || "",
    role: r.role || "worker", instructions: r.instructions || "", maxChildren: r.max_children ?? 4,
  }));
  state.todos = rows("SELECT * FROM todos").map((r) => ({
    id: r.id, key: r.key, title: r.title, desc: r.desc || "", acceptance: J(r.acceptance, []), status: r.status,
    agentId: r.agent_id || null, priority: r.priority, due: r.due, parentId: r.parent_id || null,
    tags: J(r.tags, []), subtasks: J(r.subtasks, []), blockedBy: J(r.blocked_by, []),
    missingWriteback: !!r.missing_writeback, lastRunFailed: !!r.last_run_failed, confirmed: !!r.confirmed,
    cwd: r.cwd || "", projectId: r.project_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
    kind: r.kind || "task", missionState: r.mission_state || null, botId: r.bot_id || null,
  }));
  state.runs = rows("SELECT * FROM runs").map((r) => ({
    id: r.id, todoId: r.todo_id, agentId: r.agent_id, status: r.status, trigger: r.trigger,
    startedAt: r.started_at, endedAt: r.ended_at, cost: r.cost || 0, tokens: num(r.tokens),
    error: r.error || null, parentRunId: r.parent_run_id || null, cwd: r.cwd || "", branch: r.branch || null,
    hostId: r.host_id || null, createdAt: num(r.created_at) || r.started_at || null,
    tokensIn: num(r.tokens_in), tokensOut: num(r.tokens_out), usageSource: r.usage_source || "unknown",
    errorClass: r.error_class || null, exitCode: num(r.exit_code),
    queueWaitMs: num(r.queue_wait_ms), durationMs: num(r.duration_ms), queueReason: r.queue_reason || null,
    kind: r.kind || "worker", delegationId: r.delegation_id || null, terminalId: r.terminal_id || null,
    runtime: r.runtime || null, worktreeCleaned: !!r.worktree_cleaned,
    acpSession: r.acp_session || null,
  }));
  state.threads = rows("SELECT * FROM threads").map((r) => ({
    id: r.id, todoId: r.todo_id || null, title: r.title || "", projectId: r.project_id || null,
    project: r.project || "", agentId: r.agent_id || null,
    model: r.model || "", modelName: r.model_name || "", effort: r.effort || "",
    kind: r.kind || "chat", botId: r.bot_id || null,
    createdAt: r.created_at || Date.now(), updatedAt: r.updated_at || r.created_at || Date.now(),
  }));
  state.messages = rows("SELECT * FROM messages").map((r) => ({
    id: r.id, threadId: r.thread_id || null, todoId: r.todo_id || null, runId: r.run_id || null,
    role: r.role, kind: r.kind, content: r.content, injected: !!r.injected,
    delivery: r.delivery || undefined, context: J(r.context, null), meta: J(r.meta, null), createdAt: r.created_at,
    supersededBy: r.superseded_by || null,
  }));
  state.artifacts = rows("SELECT * FROM artifacts").map((r) => ({ id: r.id, todoId: r.todo_id, runId: r.run_id, kind: r.kind, title: r.title, origin: r.origin, ref: r.ref, deepLink: r.deep_link, createdAt: r.created_at }));
  state.events = rows("SELECT * FROM events").map((r) => ({ id: r.id, ts: r.ts, type: r.type, text: r.text }));
  state.missionPlans = rows("SELECT * FROM mission_plans").map((r) => ({
    id: r.id, missionId: r.mission_id, revision: r.revision || 1, status: r.status || "draft",
    plan: J(r.plan, {}), createdAt: r.created_at || Date.now(), approvedAt: r.approved_at || null,
  }));
  state.delegations = rows("SELECT * FROM delegations").map((r) => ({
    id: r.id, missionId: r.mission_id, supervisorRunId: r.supervisor_run_id,
    childTodoId: r.child_todo_id, childRunId: r.child_run_id || null, agentId: r.agent_id,
    planStepKey: r.plan_step_key || "", title: r.title, brief: r.brief || "",
    acceptance: J(r.acceptance, []), status: r.status || "proposed",
    resultSummary: r.result_summary || "", artifacts: J(r.artifacts, []), branch: r.branch || null,
    createdAt: r.created_at || Date.now(), updatedAt: r.updated_at || Date.now(), completedAt: r.completed_at || null,
    botId: r.bot_id || null,
  }));
  state.plugins = rows("SELECT * FROM plugins").map((r) => ({
    id: r.id, version: r.version || "", path: r.path || "", enabled: !!r.enabled, builtin: !!r.builtin,
    manifest: J(r.manifest, {}), permissions: J(r.permissions, []),
    installedAt: r.installed_at || 0, lastError: r.last_error || null, lastRunAt: r.last_run_at || null,
  }));
  state.pluginKv = rows("SELECT * FROM plugin_kv").map((r) => ({
    pluginId: r.plugin_id, key: r.key, value: J(r.value, null), updatedAt: r.updated_at || 0,
  }));
  state.todoLinks = rows("SELECT * FROM todo_links").map((r) => ({
    id: r.id, todoId: r.todo_id, pluginId: r.plugin_id, kind: r.kind, ref: r.ref, title: r.title || "", createdAt: r.created_at || 0,
  }));
  state.bots = rows("SELECT * FROM bots").map((r) => ({
    id: r.id, name: r.name, avatar: r.avatar || "", avatarClass: r.avatar_class || "a",
    persona: J(r.persona, {}), capability: r.capability || "read",
    role: r.role === "supervisor" ? "supervisor" : "worker",
    executorAgentId: r.executor_agent_id || null,
    channels: J(r.channels, ["local"]), policy: J(r.policy, {}), budget: J(r.budget, {}),
    status: r.status || "active", mutedUntil: r.muted_until || 0,
    createdAt: r.created_at || 0, updatedAt: r.updated_at || 0,
  }));
  state.botGroups = rows("SELECT * FROM bot_groups").map((r) => ({
    id: r.id, name: r.name || "群聊", replyMode: J(r.reply_mode, { kind: "mentions" }),
    memberIds: rows("SELECT bot_id FROM bot_group_members WHERE group_id=?", [r.id]).map((x) => x.bot_id),
    createdAt: r.created_at || 0, updatedAt: r.updated_at || 0,
  }));
  state.botGroupMessages = rows("SELECT * FROM bot_group_messages ORDER BY seq").map((r) => ({
    id: r.id, groupId: r.group_id, seq: r.seq || 0, author: r.author === "owner" ? "owner" : "bot",
    botId: r.bot_id || null, botName: r.bot_name || "", text: r.text || "",
    decision: r.decision || "answered", createdAt: r.created_at || 0,
    meta: J(r.meta, null),
  }));
  state.botTurns = rows("SELECT * FROM bot_turns ORDER BY created_at DESC LIMIT 300").map((r) => ({
    id: r.id, botId: r.bot_id, channel: r.channel || "local",
    trigger: J(r.trigger, {}), input: r.input || "", injected: J(r.injected, []),
    reply: r.reply || "", decision: r.decision || "silent", reason: r.reason || "",
    runId: r.run_id || null, todoId: r.todo_id || null, proposal: J(r.proposal, null), tools: J(r.tools, []), trace: J(r.trace, []),
    threadId: r.thread_id || null,
    cost: J(r.cost, {}), createdAt: r.created_at || 0,
  })).reverse();
  state.routines = rows("SELECT * FROM routines").map((r) => {
    const data = J(r.data, {});
    return { ...data, id: r.id, botId: r.bot_id || "", kind: r.kind || data.kind || "daily", updatedAt: data.updatedAt || r.updated_at || 0 };
  });
  state.scenes = rows("SELECT * FROM scenes").map((r) => ({
    projectId: r.project_id, text: r.text || "", config: J(r.config, {}), updatedAt: r.updated_at || 0,
  }));
  state.coordinationScenes = rows("SELECT * FROM coordination_scenes").map((r) => ({
    id: r.id, name: r.name || "场景", projectId: r.project_id || null,
    template: r.template || "office", config: J(r.config, {}),
    createdAt: r.created_at || Date.now(), updatedAt: r.updated_at || Date.now(),
  }));
  state.terminals = rows("SELECT * FROM terminals").map((r) => ({
    id: r.id, projectId: r.project_id || null, todoId: r.todo_id || null, runId: r.run_id || null,
    agentId: r.agent_id || null, cwd: r.cwd || "", kind: r.kind || "shell", title: r.title || "",
    // pty 随进程退出而消失：历史记录不能继续显示 running
    status: r.status === "running" ? "detached" : (r.status || "detached"),
    exitCode: num(r.exit_code), tail: r.output_tail || "",
    createdAt: r.created_at || 0, endedAt: r.ended_at || null,
  }));
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
  let closed = false;
  const writeNow = () => {
    if (closed) return;
    db.exec("BEGIN IMMEDIATE");
    try {
    for (const t of ["hosts", "projects", "agents", "todos", "runs", "threads", "messages", "artifacts", "events", "mission_plans", "delegations", "plugins", "plugin_kv", "todo_links", "scenes", "coordination_scenes", "terminals", "context", "settings", "meta", "bots", "bot_turns", "routines", "bot_groups", "bot_group_members", "bot_group_messages"]) run(`DELETE FROM ${t}`);
    for (const h of state.hosts) run(
      "INSERT INTO hosts (id,name,kind,addr,status,heartbeat,version,port,user,caps,last_probe,latency_ms,max_concurrency,default_cwd,probe_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [h.id, h.name, h.kind, h.addr, h.status, h.heartbeat || 0, h.version || "—", h.port || 22, h.user || "",
        JSON.stringify(h.caps || []), h.lastProbe ?? null, h.latencyMs ?? null, h.maxConcurrency || 0, h.defaultCwd || "", h.probeError ?? null],
    );
    for (const p of state.projects) run("INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?)", [p.id, p.name, p.path, p.desc || "", p.color || "slate", p.status || "in_progress", p.createdAt || Date.now(), p.lastOpenedAt || 0, p.alias || ""]);
    for (const a of state.agents) run("INSERT INTO agents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [a.id, a.name, a.hostId, a.cli, a.cwd, a.max, a.approval, a.color, JSON.stringify(a.skills || []), a.alias || "", a.projectId || "", a.terminalId || "", a.role || "worker", a.instructions || "", a.maxChildren ?? 4]);
    for (const t of state.todos) run("INSERT INTO todos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [t.id, t.key, t.title, t.desc || "", JSON.stringify(t.acceptance || []), t.status, t.agentId || null, t.priority, t.due || "", t.parentId || null, JSON.stringify(t.tags || []), JSON.stringify(t.subtasks || []), JSON.stringify(t.blockedBy || []), t.missingWriteback ? 1 : 0, t.lastRunFailed ? 1 : 0, t.cwd || "", t.createdAt || Date.now(), t.updatedAt || Date.now(), t.confirmed ? 1 : 0, t.projectId || null, t.kind || "task", t.missionState || null, t.botId || null]);
    for (const r of state.runs) run(
      "INSERT INTO runs (id,todo_id,agent_id,status,trigger,started_at,ended_at,cost,tokens,error,parent_run_id,cwd,branch,host_id,created_at,tokens_in,tokens_out,usage_source,error_class,exit_code,queue_wait_ms,duration_ms,queue_reason,kind,delegation_id,terminal_id,runtime,worktree_cleaned,acp_session) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [r.id, r.todoId, r.agentId, r.status, r.trigger || "assign", r.startedAt || null, r.endedAt || null, r.cost || 0,
        r.tokens ?? null, r.error || null, r.parentRunId || null, r.cwd || "", r.branch || null, r.hostId || null,
        r.createdAt || null, r.tokensIn ?? null, r.tokensOut ?? null, r.usageSource || "unknown", r.errorClass || null,
        r.exitCode ?? null, r.queueWaitMs ?? null, r.durationMs ?? null, r.queueReason || null,
        r.kind || "worker", r.delegationId || null, r.terminalId || null, r.runtime || null, r.worktreeCleaned ? 1 : 0,
        r.acpSession || null],
    );
    // 显式列名：老库经 ALTER 追加过 kind / bot_id，物理列序与新建库不同，位置插入会把两列写反
    for (const t of state.threads) run(
      "INSERT INTO threads (id,todo_id,title,project_id,project,agent_id,created_at,updated_at,model,model_name,effort,kind,bot_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [t.id, t.todoId || null, t.title || "", t.projectId || null, t.project || "", t.agentId || null,
        t.createdAt || Date.now(), t.updatedAt || Date.now(), t.model || null, t.modelName || null, t.effort || null,
        t.kind || "chat", t.botId || null],
    );
    for (const m of state.messages) run("INSERT INTO messages (id,todo_id,run_id,role,kind,content,injected,created_at,thread_id,delivery,context,superseded_by,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [m.id, m.todoId || null, m.runId || null, m.role, m.kind || "text", m.content, m.injected ? 1 : 0, m.createdAt, m.threadId || null, m.delivery || null, m.context ? JSON.stringify(m.context) : null, m.supersededBy || null, m.meta ? JSON.stringify(m.meta) : null]);
    for (const a of state.artifacts) run("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?)", [a.id, a.todoId, a.runId, a.kind, a.title, a.origin, a.ref, a.deepLink, a.createdAt || Date.now()]);
    for (const e of state.events) run("INSERT INTO events VALUES (?,?,?,?)", [e.id, e.ts, e.type, e.text]);
    for (const p of state.missionPlans || []) run("INSERT INTO mission_plans VALUES (?,?,?,?,?,?,?)", [p.id, p.missionId, p.revision || 1, p.status || "draft", JSON.stringify(p.plan || {}), p.createdAt || Date.now(), p.approvedAt || null]);
    for (const d of state.delegations || []) run("INSERT INTO delegations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [d.id, d.missionId, d.supervisorRunId, d.childTodoId, d.childRunId || null, d.agentId, d.planStepKey || "", d.title, d.brief || "", JSON.stringify(d.acceptance || []), d.status || "proposed", d.resultSummary || "", JSON.stringify(d.artifacts || []), d.branch || null, d.createdAt || Date.now(), d.updatedAt || Date.now(), d.completedAt || null, d.botId || null]);
    for (const p of state.plugins || []) run("INSERT INTO plugins VALUES (?,?,?,?,?,?,?,?,?,?)", [p.id, p.version || "", p.path || "", p.enabled ? 1 : 0, p.builtin ? 1 : 0, JSON.stringify(p.manifest || {}), JSON.stringify(p.permissions || []), p.installedAt || 0, p.lastError || null, p.lastRunAt || null]);
    for (const kv of state.pluginKv || []) run("INSERT INTO plugin_kv VALUES (?,?,?,?)", [kv.pluginId, kv.key, JSON.stringify(kv.value), kv.updatedAt || Date.now()]);
    for (const l of state.todoLinks || []) run("INSERT INTO todo_links VALUES (?,?,?,?,?,?,?)", [l.id, l.todoId, l.pluginId, l.kind, l.ref, l.title || "", l.createdAt || Date.now()]);
    for (const sc of state.scenes || []) run("INSERT INTO scenes VALUES (?,?,?,?)", [sc.projectId, sc.text || "", JSON.stringify(sc.config || {}), sc.updatedAt || Date.now()]);
    for (const cs of state.coordinationScenes || []) run("INSERT INTO coordination_scenes VALUES (?,?,?,?,?,?,?)", [cs.id, cs.name || "场景", cs.projectId || null, cs.template || "office", JSON.stringify(cs.config || {}), cs.createdAt || Date.now(), cs.updatedAt || Date.now()]);
    for (const b of state.bots || []) run("INSERT INTO bots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [b.id, b.name, b.avatar || "", b.avatarClass || "a", JSON.stringify(b.persona || {}), b.capability || "read", JSON.stringify(b.channels || ["local"]), JSON.stringify(b.policy || {}), JSON.stringify(b.budget || {}), b.status || "active", b.mutedUntil || 0, b.createdAt || Date.now(), b.updatedAt || Date.now(), b.executorAgentId || null, b.role === "supervisor" ? "supervisor" : "worker"]);
    for (const g of state.botGroups || []) run("INSERT INTO bot_groups VALUES (?,?,?,?,?)", [g.id, g.name || "群聊", JSON.stringify(g.replyMode || { kind: "mentions" }), g.createdAt || Date.now(), g.updatedAt || Date.now()]);
    for (const g of state.botGroups || []) for (const botId of g.memberIds || []) run("INSERT INTO bot_group_members VALUES (?,?)", [g.id, botId]);
    for (const m of state.botGroupMessages || []) run(
      "INSERT INTO bot_group_messages (id,group_id,seq,author,bot_id,bot_name,text,decision,created_at,meta) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [m.id, m.groupId, m.seq || 0, m.author || "owner", m.botId || null, m.botName || "", m.text || "", m.decision || "answered", m.createdAt || Date.now(), m.meta ? JSON.stringify(m.meta) : null],
    );
    for (const rt of state.routines || []) run("INSERT INTO routines VALUES (?,?,?,?,?)", [rt.id, rt.botId || "", rt.kind || "daily", JSON.stringify((({ botId, id, kind, ...rest }) => rest)(rt)), rt.updatedAt || Date.now()]);
    // 显式列名：todo_id / proposal 是后加的列，物理上在 cost / created_at 之后；
    // 以前按位置写会把 cost/created_at/todo_id/proposal 整个错位（todo_id 变成 cost 的 JSON）
    for (const t of state.botTurns || []) run(
      "INSERT INTO bot_turns (id,bot_id,channel,trigger,input,injected,reply,decision,reason,run_id,cost,created_at,todo_id,proposal,tools,thread_id,trace) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [t.id, t.botId, t.channel || "local", JSON.stringify(t.trigger || {}), t.input || "", JSON.stringify(t.injected || []),
        t.reply || "", t.decision || "silent", t.reason || "", t.runId || null, JSON.stringify(t.cost || {}),
        t.createdAt || Date.now(), t.todoId || null, t.proposal ? JSON.stringify(t.proposal) : null, JSON.stringify(t.tools || []), t.threadId || null, JSON.stringify(t.trace || [])],
    );
    for (const tm of state.terminals || []) run("INSERT INTO terminals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [tm.id, tm.projectId || null, tm.todoId || null, tm.runId || null, tm.agentId || null, tm.cwd || "", tm.kind || "shell", tm.title || "", tm.status || "exited", tm.exitCode ?? null, tm.tail || "", tm.createdAt || Date.now(), tm.endedAt ?? null]);
    run("INSERT INTO context VALUES ('current', ?)", [JSON.stringify(state.context)]);
    run("INSERT INTO settings VALUES ('app', ?)", [JSON.stringify(state.settings || {})]);
    run("INSERT INTO meta VALUES ('seq', ?)", [String(state.seq)]);
    run("INSERT INTO meta VALUES ('projectPath', ?)", [state.projectPath || ""]);
    run("INSERT INTO meta VALUES ('projectId', ?)", [state.projectId || ""]);
    run("INSERT INTO meta VALUES ('activeProjectId', ?)", [state.activeProjectId || ""]);
    run("INSERT INTO meta VALUES ('chatScopeMigrated', ?)", [state.chatScopeMigrated ? "1" : "0"]);
    run("INSERT INTO meta VALUES ('cliCapabilities', ?)", [JSON.stringify(state.cliCapabilities || [])]);
    db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* 事务已结束 */ }
      console.error("[db] write failed:", String(err?.message || err));
      throw err;
    }
  };
  // 落盘失败不能杀主进程：writeNow 内部已 rollback + 打日志，下一次 persist 会再试
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { writeNow(); } catch { /* 已记录 */ } }, 120);
  };
  /** 退出前把内存状态写完，并把 WAL 合回主文件，避免留下 -wal 给下次启动 */
  const flush = () => {
    clearTimeout(timer);
    writeNow();
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* 只读或被占用时忽略 */ }
  };
  const close = () => {
    if (closed) return;
    try { flush(); } catch { /* ignore */ }
    closed = true;
    try { stmts.clear(); db.close(); } catch { /* ignore */ }
  };

  const nextId = (prefix) => { state.seq += 1; persist(); return `${prefix}${state.seq}`; };
  const addEvent = (type, text) => {
    const at = Date.now();
    const id = nextId("e");
    state.events.unshift({ id, ts: at, type, text });
    state.events = state.events.slice(0, 300);
    indexTranscript({ kind: "event", refId: id, at, text: `${type} ${text || ""}` });
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
    indexTranscript({ kind: "message", refId: msg.id, at: msg.createdAt, text: content, threadId, runId });
    return msg;
  };
  const updateMessage = (id, patch) => {
    const m = state.messages.find((x) => x.id === id);
    if (m) {
      Object.assign(m, patch);
      persist();
      // 正文被改写（比如流式拼接）时重写索引，否则搜出来的是旧文本
      if (patch && patch.content != null) {
        indexTranscript({ kind: "message", refId: m.id, at: m.createdAt, text: m.content, threadId: m.threadId, runId: m.runId });
      }
    }
    return m;
  };

  if (migrated) persist();
  return { db, state, persist, flush, close, nextId, addEvent, addMessage, updateMessage, file };
}
