import React from "react";
import { createRoot } from "react-dom/client";
import type { State } from "./types";
import { Settings } from "./components/Settings";
import { Bots } from "./components/Bots";
import { Rail } from "./components/Rail";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import "./design-system.css";

/**
 * UI 隔离预览（dev-only，不进构建产物）：设置页分区、机器人配置页的截图检查。
 *
 *   ?page=settings|bots            哪一页（默认 settings）
 *   ?section=hosts|stats|general   设置页落到哪个分区
 *   ?layout=list                   机器人页用列表布局
 *   ?theme=light|dark              主题
 *
 * 只 mock State，act 一律返回 ok——不连主进程、不写你的库。
 */
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.mode = theme;

const now = Date.now();
const ago = (min: number) => now - min * 60_000;

const state: State = {
  hosts: [
    { id: "h1", name: "local", kind: "local", addr: "local", status: "online", heartbeat: now - 8_000, version: "0.2.0", port: 22, user: "", caps: [{ cli: "dsh", path: "/usr/local/bin/dsh", version: "0.2.0" }, { cli: "claude", path: "/usr/local/bin/claude", version: "1.9.0" }], lastProbe: now - 8_000, latencyMs: 2, maxConcurrency: 4, defaultCwd: "~/work/research", probeError: null },
    { id: "h2", name: "lab-gpu", kind: "ssh", addr: "10.0.8.21", status: "online", heartbeat: now - 42_000, version: "0.2.0", port: 22, user: "spin", caps: [{ cli: "dsh", path: "/usr/local/bin/dsh", version: "0.2.0" }, { cli: "claude", path: "/usr/local/bin/claude", version: "1.9.0" }], lastProbe: now - 42_000, latencyMs: 38, maxConcurrency: 2, defaultCwd: "/srv/work", probeError: null },
    { id: "h3", name: "lab-old", kind: "ssh", addr: "10.0.8.9", status: "offline", heartbeat: ago(220), version: "0.1.4", port: 22, user: "spin", caps: [], lastProbe: ago(220), latencyMs: null, maxConcurrency: 1, defaultCwd: "/home/spin", probeError: "ssh: connect to host 10.0.8.9 port 22: Connection refused" },
  ],
  agents: [
    { id: "lan", name: "阿岚", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "slate", skills: [], alias: "alan", projectId: "p1", role: "supervisor", chatRunnable: true },
    { id: "lin", name: "林", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "teal", skills: [], alias: "lin", projectId: "p1", role: "worker", chatRunnable: true },
    { id: "gpu", name: "GPU 跑批", hostId: "h2", cli: "claude", cwd: "/srv/work", max: 2, approval: "ask", color: "indigo", skills: [], alias: "gpu", projectId: "p1", role: "worker", chatRunnable: true },
  ],
  projects: [{ id: "p1", name: "research", path: "~/work/research", desc: "", color: "teal", status: "in_progress", createdAt: now, lastOpenedAt: now, alias: "research" }],
  activeProjectId: "p1",
  projectId: "p1",
  projectPath: "~/work/research",
  workspacePath: "~/work/research",
  todos: [
    { id: "t1", key: "T-001", title: "登录页表单校验", desc: "", acceptance: [], status: "done", agentId: "lin", priority: "P1", due: "", parentId: null, tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: true, projectId: "p1", cwd: "", createdAt: ago(600), updatedAt: ago(120) },
    { id: "t2", key: "T-002", title: "工作台空态", desc: "", acceptance: [], status: "in_progress", agentId: "lan", priority: "P1", due: "", parentId: null, tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: true, projectId: "p1", cwd: "", createdAt: ago(500), updatedAt: ago(30) },
  ],
  runs: [
    { id: "r1", todoId: "t1", agentId: "lin", status: "completed", trigger: "assign", startedAt: ago(600), endedAt: ago(480), cost: 0, tokens: 12_000, tokensIn: 9_000, tokensOut: 3_000, usageSource: "acp", error: null, parentRunId: null, kind: "worker", queueWaitMs: 1_200, durationMs: 7_200_000, hostId: "h1", runtime: "acp", errorClass: null, createdAt: ago(600) },
    { id: "r2", todoId: "t1", agentId: "gpu", status: "failed", trigger: "assign", startedAt: ago(300), endedAt: ago(280), cost: 0, tokens: 4_000, error: "ssh: connect to host 10.0.8.9 port 22: Connection refused", parentRunId: null, kind: "worker", queueWaitMs: 400, durationMs: 1_200_000, hostId: "h2", runtime: "terminal", errorClass: "timeout", createdAt: ago(300) },
    { id: "r3", todoId: "t2", agentId: "lan", status: "running", trigger: "assign", startedAt: ago(24), endedAt: null, cost: 0, tokens: 2_400, error: null, parentRunId: null, kind: "worker", queueWaitMs: 0, durationMs: null, hostId: "h1", runtime: "acp", createdAt: ago(24) },
  ],
  threads: [
    { id: "th1", todoId: "t1", title: "登录页表单校验", projectId: "p1", project: "research", agentId: "lin", kind: "chat", createdAt: ago(600), updatedAt: ago(480) },
  ],
  messages: [], artifacts: [], events: [], approvals: [], delegations: [], missionPlans: [], terminals: [],
  context: {}, summary: { activeRuns: 1, cost: 0, tokens: 20_000, failures: 1 },
  cliCapabilities: ["dsh", "claude"],
  settings: {
    defaultView: "workspace", theme: theme as "light" | "dark", chatFontSize: 13, enterToSend: true, confirmStop: false,
    defaultAgentId: null, maxConcurrentRuns: 2, approvalPolicy: "ask", dshBinary: "", dshHome: "", dshEnv: "", model: "", effort: "",
    terminalFontSize: 12, terminalScrollback: 5000, shellPath: "", autoDetectDevServerUrl: true, previewHomeUrl: "",
    elementScreenshots: true, previewIgnoreCertErrors: false, previewPermissionSites: "", previewAgentControl: true,
    contextDetail: "standard", uiScale: 0, superAgentEnabled: true, maxSupervisorRuns: 1, maxMissionChildren: 4,
    missionBudgetMinutes: 30, worktreeMode: "auto",
  } as State["settings"],
  // 机器人配置页的样张：一个绑了执行体、一个没绑、一个静音
  bots: [
    { id: "b-golo", name: "戈洛", avatar: "戈", avatarClass: "a", capability: "work", executorAgentId: "lan", status: "active", persona: { mission: "项目值守：盯 Mission 进展，需要你定的事先问一句", tone: "直接、短句" }, policy: { maxTurnsPerHour: 8 }, createdAt: ago(4000) },
    { id: "b-nan", name: "南", avatar: "南", avatarClass: "b", capability: "dispatch", executorAgentId: "lin", status: "active", persona: { mission: "资料管家：导入、检索、引用出处", tone: "温和、给依据" }, policy: { maxTurnsPerHour: 4 }, createdAt: ago(3600) },
    { id: "b-draft", name: "起草机", avatar: "起", avatarClass: "c", capability: "dispatch", executorAgentId: null, status: "active", persona: { mission: "写作：按语气要求出两版", tone: "克制、书面" }, createdAt: ago(2000) },
    { id: "b-man", name: "小满", avatar: "满", avatarClass: "d", capability: "read", executorAgentId: null, status: "paused", mutedUntil: now + 3_600_000, persona: { mission: "巡检：每天看一遍服务与日志", tone: "简短" }, createdAt: ago(1200) },
  ],
  botTurns: [
    { id: "t1", botId: "b-golo", channel: "local", decision: "reported", reply: "T-001 跑完了，diff 在会话里。", createdAt: ago(3) },
    { id: "t2", botId: "b-golo", channel: "local", decision: "silent", reason: "同类事件 10 分钟内已说过一次", createdAt: ago(28) },
    { id: "t3", botId: "b-nan", channel: "local", decision: "answered", reply: "昨天那份 PDF 有 3 页没抽到文字，要看吗？", createdAt: ago(46) },
    { id: "t4", botId: "b-nan", channel: "local", decision: "blocked", reason: "本小时配额已用完", createdAt: ago(70) },
    { id: "t5", botId: "b-draft", channel: "local", decision: "escalated", reason: "对外发布必须人来点", createdAt: ago(120) },
    { id: "t6", botId: "b-man", channel: "local", decision: "silent", reason: "静音中", createdAt: ago(180) },
  ],
  routines: [
    { id: "r1", botId: "b-nan", name: "早报", kind: "daily", enabled: true, atHour: 8, nextAt: now + 3_600_000 },
    { id: "r2", botId: "b-golo", name: "盯 Mission", kind: "watch", enabled: true },
  ],
};

// 最小 window.harness 桩：设置页只用到这几个；不连主进程
(window as unknown as { harness: unknown }).harness = {
  onImPaired: () => () => {},
  previewPermissions: async () => [],
  previewRevokePermission: async () => ({ ok: true }),
  invoke: async () => ({ ok: true }),
};

const act = async () => ({ ok: true });
const section = params.get("section");

const page = params.get("page") === "bots" ? "bots" : "settings";
// ?layout=list 定格列表排布（页面本身把这套偏好存在 localStorage）
try { if (params.get("layout") === "list") localStorage.setItem("ymh.bots.layout", "list"); } catch { /* ignore */ }
const initialView: "settings" | "bots" = page === "bots" ? "bots" : "settings";

function Preview() {
  const [view, setView] = React.useState<"settings" | "bots">(initialView);
  return (
    <div className="app">
      <div className="main" style={{ gridTemplateColumns: "64px minmax(0,1fr)" }}>
        <Rail view={view} onChange={(v) => setView(v === "bots" ? "bots" : "settings")} />
        <div className="wide settings-wide">
          {view === "bots" ? (
            <Bots state={state} act={act} notify={() => {}} now={now} onOpenBot={() => {}} />
          ) : (
            <Settings
              state={state}
              act={act}
              notify={() => {}}
              now={now}
              onOpenTodo={() => {}}
              initialSection={(section as "hosts" | "stats" | "general" | undefined) ?? "hosts"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
