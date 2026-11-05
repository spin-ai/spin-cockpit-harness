export type TodoStatus = "todo" | "queued" | "in_progress" | "waiting_input" | "in_review" | "done" | "cancelled";
export type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "cancelled";
export interface Project {
  id: string; name: string; path: string; desc: string; color: string;
  status: ProjectStatus; createdAt: number; lastOpenedAt: number; alias: string;
}
export interface Host { id: string; name: string; kind: string; addr: string; status: string; heartbeat: number; version: string; port?: number; user?: string; }
export interface Agent { id: string; name: string; hostId: string; cli: string; cwd: string; max: number; approval: string; color: string; skills: string[]; alias: string; projectId?: string; terminalId?: string; }
export interface Subtask { id: string; title: string; status: string; }
export type Delivery = "pending" | "injected" | "failed";
/** 会话：消息的宿主。todoId 为空时是尚未派活的“新任务”会话。 */
export interface Thread {
  id: string; todoId: string | null; title: string;
  projectId: string | null; project: string; agentId: string | null;
  createdAt: number; updatedAt: number;
}
export interface Todo {
  id: string; key: string; title: string; desc: string; acceptance: string[]; status: TodoStatus;
  agentId: string | null; priority: string; due: string; parentId: string | null; tags: string[];
  subtasks: Subtask[]; blockedBy: string[]; missingWriteback: boolean; lastRunFailed: boolean; confirmed: boolean; projectId?: string;
  cwd: string; createdAt: number; updatedAt: number;
}
export interface Run {
  id: string; todoId: string; agentId: string; status: string; trigger: string;
  startedAt: number | null; endedAt: number | null; cost: number; tokens: number; error: string | null; parentRunId: string | null; cwd?: string; branch?: string | null;
}
export interface Approval { id: string; requestId: string; runId: string; todoId: string; title: string; description: string; options: { id: string; name: string; kind: string }[]; }
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
export type ThemeMode = "light" | "dark" | "system";
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
  model: string;
  effort: string;
  terminalFontSize: number;
  terminalScrollback: number;
  shellPath: string;
  autoDetectDevServerUrl: boolean;
  previewHomeUrl: string;
  elementScreenshots: boolean;
  contextDetail: "compact" | "standard";
}
export interface State {
  hosts: Host[]; agents: Agent[]; todos: Todo[]; runs: Run[]; threads: Thread[]; messages: Message[];
  artifacts: Artifact[]; events: Event[]; inbox: InboxItem[]; context: ContextState;
  approvals: Approval[];
  summary: { activeRuns: number; cost: number; tokens: number; failures: number };
  workspacePath: string;
  projectPath: string;
  projectId: string;
  activeProjectId: string | null;
  projects: Project[];
  cliCapabilities: string[];
  settings: Settings;
  dbPath?: string;
  userDataPath?: string;
  appVersion?: string;
}
