export type TodoStatus = "todo" | "queued" | "in_progress" | "waiting_input" | "in_review" | "done" | "cancelled";
export type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "cancelled";
export interface Project {
  id: string; name: string; path: string; desc: string; color: string;
  status: ProjectStatus; createdAt: number; lastOpenedAt: number; alias: string;
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
export interface Agent { id: string; name: string; hostId: string; cli: string; cwd: string; max: number; approval: string; color: string; skills: string[]; alias: string; projectId?: string; terminalId?: string; chatRunnable?: boolean; role?: AgentRole; instructions?: string; maxChildren?: number; }
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
  kind?: "chat" | "mission";
  createdAt: number; updatedAt: number;
}
export interface Todo {
  id: string; key: string; title: string; desc: string; acceptance: string[]; status: TodoStatus;
  agentId: string | null; priority: string; due: string; parentId: string | null; tags: string[];
  subtasks: Subtask[]; blockedBy: string[]; missingWriteback: boolean; lastRunFailed: boolean; confirmed: boolean; projectId?: string;
  cwd: string; createdAt: number; updatedAt: number;
  kind?: "task" | "mission";
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
}
export interface Run {
  id: string; todoId: string; agentId: string; status: string; trigger: string;
  startedAt: number | null; endedAt: number | null; cost: number;
  /** null = 执行器未上报，界面显示「未上报」而不是 0（见 docs/ARCH-hosts-stats.md） */
  tokens: number | null;
  error: string | null; parentRunId: string | null; cwd?: string; branch?: string | null;
  hostId?: string | null; createdAt?: number | null;
  tokensIn?: number | null; tokensOut?: number | null; usageSource?: "acp" | "unknown";
  errorClass?: ErrorClass | null; exitCode?: number | null;
  /** 缺密钥等可操作错误的结构化信息（envVars / provider） */
  errorMeta?: { envVars: string[]; provider: string | null } | null;
  queueWaitMs?: number | null; durationMs?: number | null; queueReason?: string | null;
  kind?: "worker" | "supervisor";
  delegationId?: string | null;
  /** 从终端启动的 run：绑定 pty id，停止 / 退出时用它结算 */
  terminalId?: string | null;
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
    settings?: { key: string; type?: string; title?: string; default?: unknown }[];
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
export interface TodoLink {
  id: string; todoId: string; pluginId: string; kind: string; ref: string; title: string; createdAt: number;
}
export interface Approval { id: string; requestId: string; runId: string; todoId: string; title: string; description: string; options: { id: string; name: string; kind: string }[]; missionId?: string | null; childTitle?: string | null; }
/** 预览区拾取的 UI 元素，随消息注入 Agent（见 docs/ARCH-ui-context.md） */
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
export interface Message { id: string; threadId: string; todoId: string | null; runId: string | null; role: string; kind: string; content: string; injected: boolean; delivery?: Delivery; context?: ElementContext | null; createdAt: number; }
export interface Artifact { id: string; todoId: string; runId: string; kind: string; title: string; origin: string; ref: string; deepLink: string; createdAt: number; }
export interface Event { id: string; ts: number; type: string; text: string; }
export interface InboxItem { id: string; todoId: string; kind: string; title: string; at: number; read: boolean; pinned?: boolean; }
export interface ContextState { dataset?: string; selection?: string[]; figure?: string; canvasElement?: string; activeFile?: string; updatedAt?: number; stale?: boolean; source?: string; }
export type ThemeMode = "system" | "light" | "paper" | "dark" | "midnight" | "forest" | "graphite";
export interface Settings {
  defaultView: "workspace" | "projects" | "stats" | "hosts";
  theme: ThemeMode;
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
  contextDetail: "compact" | "standard";
  superAgentEnabled?: boolean;
  maxSupervisorRuns?: number;
  maxMissionChildren?: number;
  missionBudgetMinutes?: number;
}
export interface State {
  hosts: Host[]; agents: Agent[]; todos: Todo[]; runs: Run[]; threads: Thread[]; messages: Message[];
  missionPlans?: MissionPlanRecord[]; delegations?: Delegation[];
  plugins?: PluginRecord[]; pluginCommands?: PluginCommand[]; todoLinks?: TodoLink[];
  artifacts: Artifact[]; events: Event[]; inbox: InboxItem[]; context: ContextState;
  approvals: Approval[];
  summary: { activeRuns: number; cost: number; tokens: number; failures: number };
  workspacePath: string;
  projectPath: string;
  projectId: string;
  activeProjectId: string | null;
  projects: Project[];
  cliCapabilities: string[];
  executors?: Executor[];
  /** 当前 Chat run 会使用的 dsh 来源（内置 / 自定义 / 系统 PATH） */
  dshRuntime?: { source: "bundled" | "system" | "custom"; path: string | null; version: string | null };
  settings: Settings;
  dbPath?: string;
  userDataPath?: string;
  appVersion?: string;
}
