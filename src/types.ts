export type TodoStatus = "todo" | "queued" | "in_progress" | "waiting_input" | "in_review" | "done" | "cancelled";
export type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "cancelled";
export interface Project {
  id: string; name: string; path: string; desc: string; color: string;
  status: ProjectStatus; createdAt: number; lastOpenedAt: number; alias: string;
}
export type RequirementLevel = "rr" | "ir" | "sr" | "us";
export type RequirementStatus = "draft" | "reviewing" | "approved" | "done" | "rejected" | "obsolete" | "in_progress" | "verifying";
export interface RequirementAcceptance { text: string; done: boolean; }
export type RequirementLinkKind = "relates" | "duplicates" | "conflicts";
export interface RequirementLink {
  id: string;
  fromId: string;
  toId: string;
  kind: RequirementLinkKind;
  createdAt: number;
}
/**
 * 需求（RR → IR → SR → US）。
 * 一条需求只有一个父节点：RR 是 root，IR 挂 RR，SR 挂 IR，US 挂 SR。
 */
export interface Requirement {
  id: string;
  projectId: string;
  key: string;
  level: RequirementLevel;
  parentId: string | null;
  title: string;
  body: string;
  status: RequirementStatus;
  priority: string;
  owner: string;
  source: string;
  requester: string;
  scope: string;
  outOfScope: string;
  impact: string;
  role: string;
  value: string;
  acceptance: RequirementAcceptance[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface HostCap { cli: string; path: string; version: string; }
export interface Host {
  id: string; name: string; kind: string; addr: string; status: string; heartbeat: number; version: string;
  port?: number; user?: string;
  caps?: HostCap[]; lastProbe?: number | null; latencyMs?: number | null;
  maxConcurrency?: number; defaultCwd?: string; probeError?: string | null;
}
export type ErrorClass = "auth" | "rate_limit" | "timeout" | "other";
export type AgentRole = "worker" | "supervisor";
export interface Agent { id: string; name: string; hostId: string; cli: string; cwd: string; max: number; approval: string; color: string; skills: string[]; alias: string; projectId?: string; terminalId?: string; chatRunnable?: boolean; chatRuntime?: "acp" | "terminal"; role?: AgentRole; instructions?: string; maxChildren?: number; }
/** Chat 执行适配器：只有 implemented=true 的 CLI 能从 Chat 派活。 */
export interface Executor { id: string; label: string; kind: string; implemented: boolean; supportsSteer: boolean; available: boolean; }
export interface Subtask { id: string; title: string; status: string; }
export type Delivery = "pending" | "injected" | "failed";
/** 会话：消息的宿主。todoId 为空时是尚未派活的“新任务”会话。 */
export interface Thread {
  id: string; todoId: string | null; title: string;
  projectId: string | null; project: string; agentId: string | null;
  /** Chat 里选的模型（ACP config option value，通常是 ["provider","model"] 的 JSON 字符串） */
  model?: string;
  modelName?: string;
  effort?: string;
  /** bot = 人格 bot 的持续会话（todo_id 为空，但**不是**全局空会话） */
  kind?: "chat" | "mission" | "bot";
  botId?: string | null;
  /** 纯聊天：无 Todo 的受管对话 Run 承载；可随时 promoteThreadToTodo 转为任务 */
  chatOnly?: boolean;
  createdAt: number; updatedAt: number;
}
export interface Todo {
  id: string; key: string; title: string; desc: string; acceptance: string[]; status: TodoStatus;
  agentId: string | null; /** 谁派/谁的活：机器人 id（派单链把活挂回 bot 用；老任务为空） */ botId?: string | null; priority: string; due: string; parentId: string | null; tags: string[];
  subtasks: Subtask[]; blockedBy: string[]; missingWriteback: boolean; lastRunFailed: boolean; confirmed: boolean; projectId?: string;
  cwd: string; createdAt: number; updatedAt: number;
  /**
   * 审批档（只影响「dsh 自己要不要逐条问」）：
   *  - 缺省 / "ask"：写操作逐条审批（workspace-write + approval ask）
   *  - "full-access"：这个任务里不再逐条问（danger-full-access + approval never）
   * 人只在「开跑 / 任务设置」里改；bot 不能自己改。
   */
  permission?: "ask" | "full-access";
  kind?: "task" | "mission" | "chat";
  missionState?: MissionState | null;
}
export type MissionState = "planning" | "plan_review" | "running" | "waiting_children" | "in_review" | "done" | "failed" | "cancelled" | "interrupted";
export interface MissionStep {
  key: string; title: string; brief?: string; agent?: string; acceptance?: string[]; dependsOn?: string[];
}
export interface MissionPlan {
  summary?: string; steps: MissionStep[]; risks?: string[]; budget?: { maxChildren?: number; maxMinutes?: number };
}
export interface MissionPlanRecord {
  id: string; missionId: string; revision: number; status: "draft" | "approved" | "superseded";
  plan: MissionPlan; createdAt: number; approvedAt?: number | null;
}
export type DelegationStatus = "proposed" | "queued" | "running" | "waiting_input" | "completed" | "accepted" | "rework" | "failed" | "cancelled";
export interface Delegation {
  id: string; missionId: string; supervisorRunId: string;
  childTodoId: string; childRunId: string | null; agentId: string;
  planStepKey: string; title: string; brief: string; acceptance: string[];
  status: DelegationStatus; resultSummary: string; artifacts: string[]; branch: string | null;
  createdAt: number; updatedAt: number; completedAt: number | null;
  /** 派这条活的机器人；老数据为空（只有 agentId） */
  botId?: string | null;
}
export type WorktreeMode = "auto" | "always" | "never";
export interface SceneConfig {
  worktree: WorktreeMode;
  runtime: "auto" | "acp" | "terminal";
  agents: string[];
  concurrency: number;
  acceptance: string;
  notes: string;
}
export interface Scene { projectId: string; text: string; config: SceneConfig; updatedAt: number; }

/* ── 人格 bot ─────────────────────────────────────────────────────────
 * 舞台上的「人」是 bot：有名字、人格、记忆、会主动开口。
 * Agent（执行体）是它此刻借的身体；bot 可以换执行体，形象不变。 */
export interface BotPersona { mission?: string; tone?: string; address?: string; length?: string; boundary?: string; habit?: string;
  duty?: { goal?: string; scope?: string; deliverable?: string; forbidden?: string; report?: string } }
export interface BotPolicy { maxTurnsPerHour?: number; minGapMs?: number; quietHours?: [number, number]; escalate?: string;
  whoCanAsk?: "owner" | "group" | "anyone"; sensitiveBlocklist?: string[];
  notify?: { proactive?: boolean; needPermission?: boolean; taskDone?: boolean; failed?: boolean };
  standing?: { enabled?: boolean; maxRunsPerHour?: number };
  github?: { enabled?: boolean };
  webhook?: { enabled?: boolean; token?: string } }
export interface Bot {
  id: string;
  name: string;
  avatar?: string;
  avatarClass?: string;
  persona?: BotPersona;
  /** read 只读 / dispatch 可起任务 / work 绑执行体能执行 */
  capability?: "read" | "dispatch" | "work";
  /** supervisor 主管（拆解/分派）/ worker 员工（接任务） */
  role?: "supervisor" | "worker";
  /** 它此刻借的执行体；null = 还没绑定 */
  executorAgentId?: string | null;
  /** 模型 / 思考档（quick / 标准 / deep） */
  model?: string;
  effort?: string;
  /** 内置技能 id 列表（正文在主进程 electron/bot/skills.mjs） */
  skills?: string[];
  /** 默认项目 / 默认主机（空 = 跟随当前项目 / 执行体所在主机） */
  projectId?: string | null;
  hostId?: string | null;
  /** 组织：团队名（自由文本） */
  team?: string;
  channels?: string[];
  policy?: BotPolicy;
  budget?: { tokensPerTurn?: number; tokensPerHour?: number };
  status?: "active" | "paused";
  /** 静音到什么时候（epoch ms） */
  mutedUntil?: number;
  createdAt?: number;
  updatedAt?: number;
}
/** 机器人的日程（daily / every / watch），配置页只读展示条数与下次时间 */
export interface BotRoutine {
  id: string;
  botId: string;
  name?: string;
  kind?: "daily" | "every" | "once" | "watch";
  enabled?: boolean;
  atHour?: number;
  everyMs?: number;
  onceAt?: number;
  prompt?: string;
  mode?: "alongside" | "in-chat" | string;
  watch?: { kind?: "file" | "cmd"; path?: string; cmd?: string };
  when?: string;
  nextAt?: number | null;
  due?: boolean;
  why?: string;
  lastFiredAt?: number;
  lastError?: string;
}
export type BotDecision = "answered" | "replied" | "reported" | "silent" | "blocked" | "escalated" | "asked" | "streaming" | "interrupted" | "failed" | "watching";
/** 一条 bot 回合：说了什么 / 为什么沉默，两者都进审计。 */
export interface BotTurn {
  id: string;
  botId: string;
  channel?: string;
  trigger?: { kind?: string; ref?: string };
  input?: string;
  reply?: string;
  injected?: { layer: string; id: string; title: string }[];
  decision?: BotDecision;
  reason?: string;
  stopReason?: string;
  context?: { chars?: number; memory?: number; memoryRaw?: number; history?: number; digest?: boolean };
  handoff?: { to?: string; toName?: string; task?: string; reason?: string } | null;
  routineProposal?: { name?: string; kind?: string; prompt?: string; when?: string; dismissed?: boolean; acceptedAt?: number } | null;
  routineId?: string | null;
  runId?: string | null;
  todoId?: string | null;
  cost?: { tokens?: number | null; ms?: number };
  /** 这一轮用过哪些工具：name / args / ms / ok / preview（前端渲染「过程」） */
  tools?: { name: string; args?: string; ms?: number; ok?: boolean; rejected?: boolean; preview?: string }[];
  createdAt: number;
}

/** 多 bot 协作场景：与执行配置 Scene 分离；config 里是阵容 / 呈现偏好。 */
export type CoordinationTemplate = "office" | "warroom" | "carrier";
export type CoordinationLight = "auto" | "dawn" | "day" | "dusk" | "night";
/** 3D 舞台机位：总览 / 舰首 / 舰岛 / 着舰道 / 俯视（航母舞台用） */
/* 舞台机位：航母（舰首 / 舰岛 / 着舰道 / 俯视）与发射指挥（大屏 / 长桌 / 工位）共用一份存储 */
export type CoordinationStageView = "overview" | "bow" | "island" | "landing" | "top" | "screen" | "desk" | "gate";
export interface CoordinationMotion {
  tier: "calm" | "full" | "off";
  walk: number;
  amp: number;
  typing: boolean;
}
export interface CoordinationCastMember {
  /** 座位上是谁：机器人。新数据只写这个。 */
  botId?: string;
  /** 老数据：按执行体登记的阵容；读到时用 bots.executor_agent_id 反查成 botId。 */
  agentId?: string;
  role: "lead" | "worker" | "reviewer";
  seat: number | null;
  displayName?: string;
}
export interface CoordinationPrefs {
  reviewGate: boolean;
  escalate: boolean;
  inject: boolean;
  showLinks: boolean;
  showLabels: boolean;
  /** 舞台光照：auto 跟随本地时间，其余手动锁定时段 */
  light?: CoordinationLight;
  /** 动效档位与参数：走位时长 / 姿态幅度 / 打字 */
  motion?: CoordinationMotion;
  /** 航母舞台机位（每个场景记住自己的机位） */
  view?: CoordinationStageView;
}
export interface CoordinationScene {
  id: string;
  name: string;
  projectId: string | null;
  template: CoordinationTemplate;
  config: { cast: CoordinationCastMember[]; prefs: CoordinationPrefs };
  createdAt: number;
  updatedAt: number;
}
export interface TerminalRecord {
  id: string; projectId: string | null; todoId: string | null; runId: string | null; agentId: string | null;
  /** 远端主机；空 = 本机。重启后恢复远端 shell / agent 终端靠它 */
  hostId?: string | null;
  cwd: string; kind: "agent" | "shell"; title: string;
  status: "running" | "exited" | "closed" | "detached" | "failed";
  exitCode: number | null; tail: string; createdAt: number; endedAt: number | null;
  /** 长时间无输出（主进程判定，5 分钟） */
  stalled?: boolean;
  idleMs?: number;
  /** 谁在用这条 pty：null/缺省 = 空着（Agent 可写），"user" = 人接管中（Agent 写入被拒） */
  controlBy?: "user" | null;
}
/**
 * 交给机器人的工作区：项目根 / worktree / 终端目录。
 * 这是一段长期关系，pty 退出不影响它；`status === "released"` 就是人交回了。
 */
export interface BotWorkspace {
  id: string; botId: string; projectId: string | null;
  path: string; branch: string; title: string;
  kind: "project" | "worktree" | "terminal";
  terminalId: string | null; goal: string;
  status: "open" | "released";
  createdAt: number; updatedAt: number;
}
export interface RuntimeView {
  id: string; hostId: string; hostName: string; cli: string; label: string;
  mode: "acp" | "terminal"; available: boolean; caps: string[]; agents: number;
}
export interface Run {
  id: string; todoId: string | null; agentId: string; status: string; trigger: string;
  /** waiting_input 时在等什么："approval" = 有一条权限请求挂着（和「等人回答问题」分开） */
  waitingFor?: "approval";
  /** 消息宿主：纯聊天 / 探索 Run 没有 todoId 时用它挂到会话 */
  threadId?: string | null;
  startedAt: number | null; endedAt: number | null; cost: number;
  /** null = 执行器未上报，界面显示「未上报」而不是 0（见 docs/arch/ARCH-hosts-stats.md） */
  tokens: number | null;
  error: string | null; parentRunId: string | null; cwd?: string; branch?: string | null;
  /** ACP 会话 id：有它就能在被中断后续跑（dsh 的 session/resume） */
  acpSession?: string | null;
  hostId?: string | null; createdAt?: number | null;
  tokensIn?: number | null; tokensOut?: number | null; usageSource?: "acp" | "unknown";
  errorClass?: ErrorClass | null; exitCode?: number | null;
  /** 缺密钥等可操作错误的结构化信息（envVars / provider） */
  errorMeta?: { envVars: string[]; provider: string | null } | null;
  runtime?: "acp" | "terminal" | null;
  worktreeCleaned?: boolean;
  queueWaitMs?: number | null; durationMs?: number | null; queueReason?: string | null;
  kind?: "worker" | "supervisor";
  delegationId?: string | null;
  /** 从终端启动的 run：绑定 pty id，停止 / 退出时用它结算 */
  terminalId?: string | null;
  /** 这次运行的可读产出（尾端最多 8KB）；来源见 resultSource */
  result?: string | null;
  resultSource?: "acp_text" | "pty_tail" | "error" | null;
  resultTruncated?: boolean;
  resultAt?: number | null;
}
export interface PluginManifest {
  id: string; name: string; version: string; apiVersion: number;
  engines?: { cockpit?: string };
  main?: string;
  activation?: string[];
  permissions?: string[];
  contributes?: {
    commands?: { id: string; title: string; description?: string }[];
    events?: string[];
    settings?: {
      key: string;
      type?: string;
      title?: string;
      description?: string;
      default?: unknown;
      placeholder?: string;
      options?: { value: string; label: string }[];
    }[];
    views?: { id: string; title: string; location?: string; icon?: string; entry?: string }[];
    executors?: unknown[];
  };
}
export interface PluginRecord {
  id: string; version: string; path: string; enabled: boolean; builtin: boolean;
  manifest: PluginManifest; permissions: string[]; installedAt: number;
  lastError: string | null; lastRunAt: number | null;
}
export interface PluginCommand { pluginId: string; id: string; title: string; description?: string; }
/** 插件 manifest 声明的 UI view；目前只有已注册组件的 view 会被渲染（notes / zhulong） */
export interface PluginView { pluginId: string; id: string; title: string; location?: string; icon?: string; }
export interface TodoLink {
  id: string; todoId: string; pluginId: string; kind: string; ref: string; title: string; createdAt: number;
}
export interface Approval { id: string; requestId: string; runId: string; todoId: string; title: string; description: string; options: { id: string; name: string; kind: string }[]; missionId?: string | null; childTitle?: string | null; }
/** 预览区拾取的 UI 元素，随消息注入 Agent（见 docs/arch/ARCH-ui-context.md） */
export interface ElementContext {
  kind: "dom-element";
  url: string;
  selector: string;
  tag: string;
  text: string;
  outerHTML: string;
  box?: { x: number; y: number; width: number; height: number };
  styles?: Record<string, string>;
  component?: string | null;
  source?: { file?: string; line?: number } | null;
  screenshot?: string | null;
}
/** 工具消息的结构化 meta：家族 / 状态 / 耗时 / 归属都由主进程写入，前端不再猜文本 */
export interface MessageMeta {
  title?: string; status?: string; hint?: string; description?: string; input?: string; output?: string;
  /** ACP kind（read/edit/execute/search/fetch/think…），家族推导的原始输入 */
  kind?: string;
  /** read / edit / run / search / net / mcp / plan / think / other */
  family?: string;
  /** running / waiting / done / failed / denied / stopped */
  statusKind?: string;
  durationMs?: number;
  /** 子调用指向父工具（子 agent / 嵌套工具） */
  parentToolId?: string | null;
  /** 哪个 Agent / 哪个机器人起的这一步（群聊归属） */
  agentId?: string | null;
  botId?: string | null;
  /** 审批消息：决策文案与原命令描述 */
  decision?: string;
  allow?: boolean;
  optionId?: string | null;
}
export interface Message { id: string; threadId: string; todoId: string | null; runId: string | null; role: string; kind: string; content: string; injected: boolean; delivery?: Delivery; context?: ElementContext | null; /** ACP 工具调用原始参数 / 完整输出（轨迹用） */ meta?: MessageMeta | null; createdAt: number; /** 被编辑后的新版本取代时指向新 run，UI 不再展示 */ supersededBy?: string | null; }
export interface Artifact { id: string; todoId: string; runId: string; kind: string; title: string; origin: string; ref: string; deepLink: string; createdAt: number; }
export interface Event { id: string; ts: number; type: string; text: string; }
export interface ContextState { dataset?: string; selection?: string[]; figure?: string; canvasElement?: string; activeFile?: string; updatedAt?: number; stale?: boolean; source?: string; }
export type ThemeMode = "system" | "light" | "paper" | "vslight" | "dark" | "vsdark" | "midnight" | "forest" | "graphite" | "monokai" | "onedark" | "solarized" | "dracula";
export interface Settings {
  /** 启动视图：统计 / 主机已收进设置，老值 stats|hosts 读到时落成 settings */
  defaultView: "workspace" | "projects" | "settings";
  theme: ThemeMode;
  /** 界面语言：zh | en（en = 标题 / 导航 / 页签 / 页头按钮切英文；正文仍为中文） */
  uiLanguage: "zh" | "en";
  /** 整窗缩放：0 = 自动（跟随屏幕分辨率），80–150 = 手动固定百分比 */
  uiScale: number;
  /** 只读：自动/手动换算后的实际百分比，由主进程算好给设置页显示 */
  uiScaleResolved?: number;
  chatFontSize: number;
  enterToSend: boolean;
  confirmStop: boolean;
  defaultAgentId: string | null;
  maxConcurrentRuns: number;
  approvalPolicy: "ask" | "allow" | "deny";
  dshBinary: string;
  dshHome: string;
  /** KEY=VALUE 每行一条，注入本地 dsh 的环境变量 */
  dshEnv: string;
  model: string;
  effort: string;
  terminalFontSize: number;
  terminalScrollback: number;
  shellPath: string;
  autoDetectDevServerUrl: boolean;
  previewHomeUrl: string;
  elementScreenshots: boolean;
  /** 自签名 https 的 dev server：默认按 Chromium 校验，开了才信任 */
  previewIgnoreCertErrors: boolean;
  /** 预览页站点权限 JSON：{ origin: ["media", "clipboard-read", ...] } */
  previewPermissionSites: string;
  /** Agent 是否可以用 browser_* 工具操作预览页 */
  previewAgentControl: boolean;
  /** 桌面操作（agent-desktop MCP）：默认关，开启后 Agent 可以读/点桌面窗口 */
  agentDesktopEnabled?: boolean;
  contextDetail: "compact" | "standard";
  /** 云端向量索引（Ark embedding）：默认 false = 只做本地关键词索引，正文不出网 */
  knowledgeCloudIndex?: boolean;
  superAgentEnabled?: boolean;
  maxSupervisorRuns?: number;
  maxMissionChildren?: number;
  missionBudgetMinutes?: number;
  worktreeMode?: WorktreeMode;
  /** 即时通信网关（手机继续处理） */
  imEnabled?: boolean;
  /** 飞书自建应用：扫码配置写入；secret 以 enc: 前缀加密，不回显 */
  imFeishuAppId?: string;
  imFeishuAppSecret?: string;
  imFeishuBoundAt?: number;
  imFeishuVerificationToken?: string;
  imFeishuLastChat?: string;
  imFeishuMode?: "ws" | "http";
  imTelegramToken?: string;
  imTelegramAllow?: string;
  imWebhookUrl?: string;
  imWebhookToken?: string;
  imInboundPort?: number;
  imAllowIds?: string;
  /** 人物语料目录（datasets/wechat）；空则按 userData → 仓库顺序找 */
  personaDatasetDir?: string;
}
/** 群聊的一句话发给谁：指定某个成员 / 全体 / 被 @ 的人（ORCA 的 BotGroupReplyMode） */
export type BotGroupReplyMode = (
  | { kind: "bot"; botId: string }
  | { kind: "all" }
  | { kind: "mentions" }
) & {
  /** 成员并行（默认）还是依次说；依次时后说的能看到前面刚说的 */
  pace?: "serial" | "parallel";
};

export interface BotGroup {
  id: string;
  name: string;
  memberIds: string[];
  replyMode: BotGroupReplyMode;
  createdAt: number;
  updatedAt: number;
  /** 左栏未读点：比这个时间新的成员消息算未读 */
  lastReadAt?: number;
  /** 群内多话题：每条话题各自消息流；threadId 为空 = 默认话题 */
  threads?: { id: string; title: string; createdAt: number }[];
  /** 群共识 / 目标：所有成员都注入（不代替各自职责） */
  memo?: string;
  /** 按话题已读：{ threadId | main : timestamp } */
  reads?: Record<string, number>;
  /** 每个话题里各成员用哪条 bot thread：{ threadId | main : { botId: threadId } } */
  sessions?: Record<string, Record<string, string>>;
}

export interface BotPeerMail {
  id: string;
  fromBotId: string;
  toBotId: string;
  groupId: string;
  threadId: string | null;
  kind: "question" | "handoff" | "status";
  body: string;
  status: "pending" | "delivered" | "answered" | "cancelled";
  createdAt: number;
  deliveredAt: number | null;
  answeredAt: number | null;
  answerTurnId: string | null;
}

export interface BotGroupMessage {
  id: string;
  groupId: string;
  seq: number;
  author: "owner" | "bot" | "system";
  botId: string | null;
  botName: string;
  text: string;
  /** 沉默 / 被拦也要留痕：作者是 bot 但没开口 */
  decision: string;
  /** 多话题：归属哪条话题；空 = 默认话题 */
  threadId?: string | null;
  createdAt: number;
  /** 这一句对应的回合：turnId / runId / sessionId / cost / 附件（点开看轨迹用） */
  meta?: {
    turnId?: string | null; runId?: string | null; sessionId?: string | null;
    cost?: { tokens?: number | null; ms?: number } | null;
    attachments?: { name: string; path: string }[];
  } | null;
}

/** Items 台账的计数：每个 bot 一份（needsYou > 0 才出现在行尾 / chrome 上） */
export interface BotItemCount {
  open: number;
  needsYou: number;
}

/** botId → 计数。全量 snapshot 与 P0-4 的增量 patch 用同一份形状 */
export type BotItemCounts = Record<string, BotItemCount>;

export interface BotChatSummary {
  id: string; title: string; createdAt: number; updatedAt: number; count: number; last: string; lastAt: number;
}

export interface State {
  hosts: Host[]; agents: Agent[]; todos: Todo[]; runs: Run[]; threads: Thread[]; messages: Message[];
  missionPlans?: MissionPlanRecord[]; delegations?: Delegation[];
  plugins?: PluginRecord[]; pluginCommands?: PluginCommand[]; pluginViews?: PluginView[]; todoLinks?: TodoLink[];
  artifacts: Artifact[]; events: Event[]; context: ContextState;
  approvals: Approval[];
  summary: { activeRuns: number; cost: number; tokens: number; failures: number };
  workspacePath: string;
  projectPath: string;
  projectId: string;
  activeProjectId: string | null;
  projects: Project[];
  requirements?: Requirement[];
  requirementLinks?: RequirementLink[];
  scenes?: Scene[];
  coordinationScenes?: CoordinationScene[];
  bots?: Bot[];
  botWorkspaces?: BotWorkspace[];
  botTurns?: BotTurn[];
  botGroups?: BotGroup[];
  botGroupMessages?: BotGroupMessage[];
  /** Items 台账的计数（每个 bot 一份；明细走 botItemsList 分页读） */
  itemCounts?: BotItemCounts;
  /** 每个 bot 的会话摘要（增量推送用；老数据没有也不影响） */
  botChats?: Record<string, BotChatSummary[]>;
  /** 最近一次增量通知：渲染层据此决定「这个 bot 要不要重读」 */
  botChanged?: { botId: string; kinds: string[]; at: number } | null;
  botPeerMails?: BotPeerMail[];
  routines?: BotRoutine[];
  terminals?: TerminalRecord[];
  runtimes?: RuntimeView[];
  cliCapabilities: string[];
  executors?: Executor[];
  /** 当前 Chat run 会使用的 dsh 来源（内置 / 自定义 / 系统 PATH） */
  dshRuntime?: { source: "bundled" | "system" | "custom"; path: string | null; version: string | null };
  settings: Settings;
  dbPath?: string;
  userDataPath?: string;
  appVersion?: string;
}
