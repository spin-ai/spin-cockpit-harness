import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CoordinationTemplate, State } from "../types";
import { SceneWorkspace } from "../components/SceneWorkspace";
import { TerminalPanel } from "../components/TerminalPanel";
import { PreviewSurface } from "../components/PreviewSurface";
import { Settings } from "../components/Settings";
import { Bots } from "../components/Bots";
import { Rail } from "../components/Rail";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles.css";
import "../design-system.css";

/**
 * 文章截图 / 录屏用的隔离预览（dev-only，不进构建产物）。
 *
 *   ?page=scene|settings|bots  哪一页（默认 scene：协作场景舞台）
 *   ?section=hosts|stats|...    page=settings 时落到哪个设置分区
 *   ?layout=list                page=bots 时用列表排布
 *   ?template=office|warroom|carrier   切舞台（航母 / 发射指挥是 3D）
 *   ?theme=light|dark  ?hour=0-23      主题与光照
 *   ?tab=gallery|live|lights|execution  场景页 tab
 *   ?page=terminal                     终端页（假的 pty 桩，只看 UI：快捷命令 / 右键菜单 / 拆分）
 *   ?select=<botId>|none  ?detail=1  ?mode=config
 *   ?mission=plan_review               主管去会议室（真实 missionState）
 *   ?script=1                          9 秒时间线：审批 → 放行 → 验收 → 派活 → 收工
 *
 * 只改 mock State，不连主进程、不派真实任务。
 */
const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.mode = theme;

const previewHour = Number(params.get("hour"));
const now = (() => {
  if (Number.isFinite(previewHour) && previewHour >= 0 && previewHour <= 23) {
    const pinned = new Date();
    pinned.setHours(previewHour, 0, 0, 0);
    return pinned.getTime();
  }
  return Date.now();
})();
const ago = (min: number) => now - min * 60_000;

const TEMPLATE = (params.get("template") || "office") as CoordinationTemplate;
const SCRIPT = params.get("script") === "1";
const MISSION = params.get("mission");

const baseState: State = {
  hosts: [{ id: "h1", name: "local", kind: "local", addr: "local", status: "online", heartbeat: now, version: "0.2.0" }],
  projects: [{ id: "p1", name: "research", path: "~/work/research", desc: "", color: "teal", status: "in_progress", createdAt: now, lastOpenedAt: now, alias: "research" }],
  activeProjectId: "p1",
  projectId: "p1",
  projectPath: "~/work/research",
  workspacePath: "~/work/research",
  agents: [
    { id: "lan", name: "阿岚", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "slate", skills: [], alias: "alan", projectId: "p1", role: "supervisor", chatRunnable: true },
    { id: "lin", name: "林", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "teal", skills: [], alias: "lin", projectId: "p1", role: "worker", chatRunnable: true },
    { id: "zhou", name: "周", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "indigo", skills: [], alias: "zhou", projectId: "p1", role: "worker", chatRunnable: true },
    { id: "bei", name: "北", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "amber", skills: [], alias: "bei", projectId: "p1", role: "worker", chatRunnable: true },
    { id: "an", name: "安", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "orange", skills: [], alias: "an", projectId: "p1", role: "worker", chatRunnable: true },
    { id: "qiao", name: "乔", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "purple", skills: [], alias: "qiao", projectId: "p1", role: "worker", chatRunnable: true },
    { id: "man", name: "小满", hostId: "h1", cli: "dsh", cwd: "~/work/research", max: 1, approval: "ask", color: "slate", skills: [], alias: "man", projectId: "p1", role: "worker", chatRunnable: true },
  ],
  // 舞台上的「人」= 机器人；executorAgentId 是它此刻借的执行体。起草机故意不绑执行体（演示空态）。
  bots: [
    { id: "b-golo", name: "戈洛", avatar: "戈", avatarClass: "a", capability: "work", executorAgentId: "lan", persona: { mission: "项目值守", tone: "直接、短句" }, status: "active", channels: ["local"], createdAt: ago(300) },
    { id: "b-nan", name: "南", avatar: "南", avatarClass: "b", capability: "dispatch", executorAgentId: "lin", persona: { mission: "资料管家" }, status: "active", channels: ["local"], createdAt: ago(280) },
    { id: "b-zhou", name: "舟", avatar: "舟", avatarClass: "c", capability: "work", executorAgentId: "zhou", persona: { mission: "前端" }, status: "active", channels: ["local"], createdAt: ago(260) },
    { id: "b-bei", name: "北", avatar: "北", avatarClass: "a", capability: "work", executorAgentId: "bei", persona: { mission: "迁移" }, status: "active", channels: ["local"], createdAt: ago(240) },
    { id: "b-an", name: "安", avatar: "安", avatarClass: "b", capability: "work", executorAgentId: "an", persona: { mission: "回归" }, status: "active", channels: ["local"], createdAt: ago(220) },
    { id: "b-qiao", name: "乔", avatar: "乔", avatarClass: "c", capability: "work", executorAgentId: "qiao", persona: { mission: "验收" }, status: "active", channels: ["local"], createdAt: ago(200) },
    { id: "b-man", name: "小满", avatar: "满", avatarClass: "a", capability: "read", executorAgentId: "man", persona: { mission: "巡检" }, status: "active", mutedUntil: now + 3_600_000, channels: ["local"], createdAt: ago(180) },
    { id: "b-draft", name: "起草机", avatar: "起", avatarClass: "b", capability: "dispatch", executorAgentId: null, persona: { mission: "写作" }, status: "active", channels: ["local"], createdAt: ago(120) },
  ],
  botTurns: [
    { id: "turn-1", botId: "b-golo", channel: "local", trigger: { kind: "run.finished", ref: "T-014" }, decision: "reported", reply: "登录页校验跑完了，diff 在 th-t14。", reason: "", createdAt: ago(1) },
    { id: "turn-2", botId: "b-man", channel: "local", trigger: { kind: "todo.changed" }, decision: "silent", reason: "静音中（1 小时）", createdAt: ago(6) },
    { id: "turn-3", botId: "b-draft", channel: "local", trigger: { kind: "mention" }, decision: "blocked", reason: "还没绑定执行体，只能写文本", createdAt: ago(9) },
  ],
  todos: [
    { id: "m3", key: "M-03", title: "发布 v0.3", desc: "", acceptance: [], status: "in_progress", agentId: "lan", priority: "P1", due: "", parentId: null, tags: [], subtasks: [
      { id: "s1", title: "登录页校验", status: "done" },
      { id: "s2", title: "工作台空态", status: "in_progress" },
      { id: "s3", title: "发布检查", status: "todo" },
      { id: "s4", title: "回归验收", status: "todo" },
    ], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: "p1", cwd: "~/work/research", createdAt: ago(60), updatedAt: ago(2), kind: "mission", missionState: "running" },
    { id: "t14", key: "T-014", title: "登录页表单校验", desc: "", acceptance: [], status: "in_progress", agentId: "lin", priority: "P1", due: "", parentId: "m3", tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: "p1", cwd: "~/work/research", createdAt: ago(40), updatedAt: ago(1), kind: "task" },
    { id: "t15", key: "T-015", title: "工作台空态", desc: "", acceptance: [], status: "in_progress", agentId: "zhou", priority: "P1", due: "", parentId: "m3", tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: "p1", cwd: "~/work/research", createdAt: ago(35), updatedAt: ago(1), kind: "task" },
    { id: "t13", key: "T-013", title: "数据迁移脚本", desc: "", acceptance: [], status: "waiting_input", agentId: "bei", priority: "P0", due: "", parentId: "m3", tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: "p1", cwd: "~/work/research", createdAt: ago(30), updatedAt: ago(2), kind: "task" },
    { id: "t11", key: "T-011", title: "回归套件", desc: "", acceptance: [], status: "todo", agentId: "an", priority: "P1", due: "", parentId: "m3", tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: true, confirmed: false, projectId: "p1", cwd: "~/work/research", createdAt: ago(50), updatedAt: ago(3), kind: "task" },
    { id: "t09", key: "T-009", title: "工作台空态验收", desc: "", acceptance: [], status: "in_review", agentId: "qiao", priority: "P1", due: "", parentId: "m3", tags: [], subtasks: [], blockedBy: [], missingWriteback: false, lastRunFailed: false, confirmed: false, projectId: "p1", cwd: "~/work/research", createdAt: ago(45), updatedAt: ago(4), kind: "task" },
  ],
  runs: [
    { id: "r-lead", todoId: "m3", agentId: "lan", status: "running", trigger: "assign", startedAt: ago(14), endedAt: null, cost: 0, tokens: 12000, error: null, parentRunId: null, kind: "supervisor", queueWaitMs: 0, durationMs: null, hostId: "h1", runtime: "acp" },
    { id: "r-lin", todoId: "t14", agentId: "lin", status: "running", trigger: "assign", startedAt: ago(4), endedAt: null, cost: 0, tokens: 8000, error: null, parentRunId: null, kind: "worker", queueWaitMs: 0, durationMs: null, hostId: "h1", runtime: "acp" },
    { id: "r-zhou", todoId: "t15", agentId: "zhou", status: "running", trigger: "assign", startedAt: ago(7), endedAt: null, cost: 0, tokens: 9000, error: null, parentRunId: null, kind: "worker", queueWaitMs: 0, durationMs: null, hostId: "h1", runtime: "acp" },
    { id: "r-bei", todoId: "t13", agentId: "bei", status: "waiting_input", trigger: "assign", startedAt: ago(6), endedAt: null, cost: 0, tokens: 3000, error: null, parentRunId: null, kind: "worker", queueWaitMs: 0, durationMs: null, hostId: "h1", runtime: "acp" },
    { id: "r-an", todoId: "t11", agentId: "an", status: "failed", trigger: "assign", startedAt: ago(8), endedAt: ago(2), cost: 0, tokens: 4000, error: "npm test 退出码 1 · 3 个用例失败", parentRunId: null, kind: "worker", queueWaitMs: 0, durationMs: 360000, hostId: "h1", runtime: "acp" },
    { id: "r-qiao", todoId: "t09", agentId: "qiao", status: "completed", trigger: "assign", startedAt: ago(20), endedAt: ago(5), cost: 0, tokens: 5000, error: null, parentRunId: null, kind: "worker", queueWaitMs: 0, durationMs: 900000, hostId: "h1", runtime: "acp" },
  ],
  threads: [
    { id: "th-m3", todoId: "m3", title: "发布 v0.3", projectId: "p1", project: "research", agentId: "lan", kind: "mission", createdAt: ago(60), updatedAt: ago(2) },
    { id: "th-t14", todoId: "t14", title: "登录页表单校验", projectId: "p1", project: "research", agentId: "lin", kind: "chat", createdAt: ago(40), updatedAt: ago(1) },
    { id: "th-t09", todoId: "t09", title: "工作台空态验收", projectId: "p1", project: "research", agentId: "qiao", kind: "chat", createdAt: ago(45), updatedAt: ago(4) },
  ],
  messages: [], artifacts: [],
  events: [
    { id: "e1", ts: ago(1), type: "run.tool", text: "run.tool 林 read src/auth/Login.tsx" },
    { id: "e2", ts: ago(2), type: "run.permission", text: "run.permission 北 数据迁移 waiting" },
    { id: "e3", ts: ago(3), type: "run.failed", text: "run.failed 安 npm test" },
    { id: "e4", ts: ago(4), type: "run.finished", text: "run.finished 乔 T-009" },
  ],
  context: {},
  approvals: [{ id: "a1", requestId: "req-1", runId: "r-bei", todoId: "t13", title: "执行数据迁移脚本", description: "ALTER TABLE agents ADD COLUMN role TEXT;\n影响 1 张表，预计 0.2s。", options: [{ id: "allow", name: "允许", kind: "allow" }] }],
  summary: { activeRuns: 3, cost: 0, tokens: 41000, failures: 1 },
  terminals: [
    { id: "term-lin", projectId: "p1", todoId: "t14", runId: "r-lin", agentId: "lin", cwd: "~/work/research", kind: "agent", title: "T-014 登录页表单校验", status: "running", exitCode: null, tail: "$ dsh --profile acp\n▸ read src/auth/Login.tsx\n▸ edit 3 files\n▸ run npm test", createdAt: ago(4), endedAt: null },
    { id: "term-shell", projectId: "p1", todoId: null, runId: null, agentId: null, cwd: "~/work/research", kind: "shell", title: "shell", status: "running", exitCode: null, tail: "$ npm run dev", createdAt: ago(9), endedAt: null },
  ],
  missionPlans: [{ id: "plan1", missionId: "m3", revision: 1, status: "approved", plan: { summary: "", steps: [{ key: "s1", title: "登录页校验" }, { key: "s2", title: "工作台空态" }, { key: "s3", title: "发布检查" }, { key: "s4", title: "回归验收" }] }, createdAt: ago(12), approvedAt: ago(11) }],
  delegations: [
    { id: "d1", missionId: "m3", supervisorRunId: "r-lead", childTodoId: "t14", childRunId: "r-lin", agentId: "lin", planStepKey: "s1", title: "登录页校验", brief: "", acceptance: [], status: "running", resultSummary: "", artifacts: [], branch: null, createdAt: ago(12), updatedAt: ago(1), completedAt: null },
    { id: "d2", missionId: "m3", supervisorRunId: "r-lead", childTodoId: "t15", childRunId: "r-zhou", agentId: "zhou", planStepKey: "s2", title: "工作台空态", brief: "", acceptance: [], status: "running", resultSummary: "", artifacts: [], branch: null, createdAt: ago(12), updatedAt: ago(1), completedAt: null },
    { id: "d3", missionId: "m3", supervisorRunId: "r-lead", childTodoId: "t13", childRunId: "r-bei", agentId: "bei", planStepKey: "s3", title: "发布检查", brief: "", acceptance: [], status: "waiting_input", resultSummary: "", artifacts: [], branch: null, createdAt: ago(12), updatedAt: ago(2), completedAt: null },
    { id: "d4", missionId: "m3", supervisorRunId: "r-lead", childTodoId: "t09", childRunId: "r-qiao", agentId: "qiao", planStepKey: "s4", title: "回归验收", brief: "", acceptance: [], status: "completed", resultSummary: "", artifacts: [], branch: null, createdAt: ago(12), updatedAt: ago(4), completedAt: ago(4) },
  ],
  coordinationScenes: [{ id: "cs1", name: "research 小队", projectId: "p1", template: TEMPLATE, config: { cast: [
    { botId: "b-golo", role: "lead", seat: null },
    { botId: "b-nan", role: "worker", seat: 0 },
    { botId: "b-zhou", role: "worker", seat: 1 },
    { botId: "b-bei", role: "worker", seat: 2 },
    { botId: "b-an", role: "worker", seat: 3 },
    { botId: "b-qiao", role: "reviewer", seat: 4 },
    { botId: "b-man", role: "worker", seat: 5 },
    // 没绑执行体的机器人也在阵容里：它上台，但只能等（不是消失）
    { botId: "b-draft", role: "worker", seat: null },
  ], prefs: { reviewGate: true, escalate: true, inject: false, showLinks: true, showLabels: true, light: "auto", motion: { tier: "calm", walk: 900, amp: 100, typing: true }, view: "overview" } }, createdAt: now, updatedAt: now }],
  routines: [
    { id: "r1", botId: "b-nan", name: "早报", kind: "daily", enabled: true, atHour: 8, nextAt: now + 3_600_000 },
    { id: "r2", botId: "b-golo", name: "盯 Mission", kind: "watch", enabled: true },
  ],
  settings: { defaultView: "workspace", uiLanguage: "zh", theme: "light", chatFontSize: 13, enterToSend: true, confirmStop: false, defaultAgentId: null, maxConcurrentRuns: 2, approvalPolicy: "ask", dshBinary: "", dshHome: "", dshEnv: "", model: "", effort: "", terminalFontSize: 12, terminalScrollback: 5000, shellPath: "", autoDetectDevServerUrl: true, previewHomeUrl: "", elementScreenshots: true, previewIgnoreCertErrors: false, previewPermissionSites: "", previewAgentControl: true, contextDetail: "compact", uiScale: 100 },
  cliCapabilities: [],
  runtimes: [],
};

// ?mission=plan_review：计划待批时主管真的会从经理室走到会议室（不是演示动画）
if (MISSION === "plan_review") {
  const mission = baseState.todos.find((t) => t.id === "m3");
  if (mission) mission.missionState = "plan_review";
  const leadRun = baseState.runs.find((r) => r.id === "r-lead");
  if (leadRun) leadRun.status = "waiting_plan";
}

const APPROVAL_SEED = baseState.approvals[0];
const SCRIPT_PERIOD = 9000;

/** ?script=1：审批 → 放行 → 验收 → 派活 → 收工，9 秒一轮；只改 mock State */
function useScriptedState() {
  const [state, setState] = useState<State>(baseState);

  useEffect(() => {
    if (!SCRIPT) return;
    let stopped = false;
    const timers: number[] = [];
    const patch = (fn: (s: State) => void) => {
      setState((s) => {
        const next = structuredClone(s) as State;
        fn(next);
        return next;
      });
    };
    const runStatus = (s: State, id: string, status: string) => {
      const run = s.runs.find((r) => r.id === id);
      if (run) run.status = status;
    };
    const todoStatus = (s: State, id: string, status: State["todos"][number]["status"]) => {
      const todo = s.todos.find((t) => t.id === id);
      if (todo) todo.status = status;
    };
    const approvalOn = (s: State, on: boolean) => {
      if (on) {
        if (!s.approvals.some((a) => a.runId === "r-bei")) s.approvals.push({ ...APPROVAL_SEED });
      } else {
        s.approvals = s.approvals.filter((a) => a.runId !== "r-bei");
      }
    };
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(() => { if (!stopped) fn(); }, ms));
    };

    const cycle = () => {
      if (stopped) return;
      setState(baseState);
      at(1500, () => patch((s) => { approvalOn(s, false); runStatus(s, "r-bei", "running"); todoStatus(s, "t13", "in_progress"); }));
      at(3200, () => patch((s) => { todoStatus(s, "t09", "done"); runStatus(s, "r-qiao", "completed"); }));
      at(4700, () => patch((s) => { todoStatus(s, "t09", "in_review"); }));
      at(6200, () => patch((s) => {
        s.todos.push({ ...s.todos[2], id: "t-man", key: "T-016", title: "空态插画", agentId: "man", status: "in_progress", parentId: null, lastRunFailed: false, updatedAt: Date.now() });
        s.runs.push({ ...s.runs[1], id: "r-man", todoId: "t-man", agentId: "man", status: "running", startedAt: Date.now(), endedAt: null, kind: "worker" });
      }));
      at(7000, () => patch((s) => { approvalOn(s, true); runStatus(s, "r-bei", "waiting_input"); todoStatus(s, "t13", "waiting_input"); }));
      at(8200, () => setState((s) => {
        const next = structuredClone(s) as State;
        next.runs = next.runs.filter((r) => r.id !== "r-man");
        next.todos = next.todos.filter((t) => t.id !== "t-man");
        return next;
      }));
      at(SCRIPT_PERIOD, cycle);
    };
    cycle();

    return () => { stopped = true; timers.forEach((t) => window.clearTimeout(t)); };
  }, []);

  return state;
}

const initialTab = (params.get("tab") as "gallery" | "live" | "lights" | "execution" | null) || "live";
const initialSelectedId = params.get("select") === "none" ? null : (params.get("select") || "b-golo");
type PreviewPage = "scene" | "settings" | "bots" | "terminal" | "file";
const page: PreviewPage = params.get("page") === "settings" ? "settings" : params.get("page") === "bots" ? "bots" : params.get("page") === "terminal" ? "terminal" : params.get("page") === "file" ? "file" : "scene";
const section = (params.get("section") || "hosts") as "general" | "appearance" | "execution" | "terminal" | "preview" | "im" | "hosts" | "stats" | "plugins" | "data" | "shortcuts" | "about";
try { if (params.get("layout") === "list") localStorage.setItem("ymh.bots.layout", "list"); } catch { /* ignore */ }

// 设置页要用到几个 harness 钩子；预览里只给空实现，不连主进程
/* 终端页预览用的最小 harness 桩：pty 全部走假数据，只为看 UI */
const fakeTerm = {
  seq: 0,
  createTerminal: async () => ({ id: `t${++fakeTerm.seq}`, cwd: "/tmp" }),
  attachTerminal: async () => ({ data: "harness@local research % git status --short\r\n M src/app.tsx\r\n", exited: false }),
  terminalInput: async () => {},
  closeTerminal: async () => {},
  terminalResize: async () => {},
  onTerminalData: () => () => {},
  onTerminalExit: () => () => {},
  onTerminalUrl: () => () => {},
  clipboardRead: async () => "",
  clipboardWrite: async () => {},
  openExternal: async () => true,
};

const SAMPLE_TS = `import { useEffect, useRef } from "react";

/** 示例：预览里的代码编辑器（行号 / 折叠 / 括号匹配 / 高亮） */
export function useDebounced<T>(value: T, ms = 200) {
  const timer = useRef<number | null>(null);
  const [last, setLast] = useState(value);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLast(value), ms);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [value, ms]);

  // 12.5px / tab=2 / 折叠 gutter 都在这里体现
  const ratio = 42 / 7;
  return { last, ratio, ok: true, note: "示例字符串" };
}
`;

function fakePdfPage(page: number) {
  const c = document.createElement("canvas");
  c.width = 1190;
  c.height = 1684;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#111";
  ctx.font = "700 46px ui-sans-serif, system-ui";
  ctx.fillText(`测试文档 · 第 ${page} 页`, 96, 160);
  ctx.fillStyle = "#9aa3ad";
  ctx.font = "400 22px ui-monospace, monospace";
  ctx.fillText("pdf.js → skia → PNG（主进程渲染，渲染层只排版）", 96, 206);
  ctx.strokeStyle = "#e3e7ea";
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const y = 280 + i * 46;
    ctx.beginPath();
    ctx.moveTo(96, y);
    ctx.lineTo(96 + (i % 3 === 0 ? 640 : 980), y);
    ctx.stroke();
  }
  ctx.fillStyle = "#c9d2da";
  ctx.fillRect(96, 1540, 300, 10);
  return c.toDataURL("image/png");
}

const fakeFile = {
  filesRead: async () => ({ text: SAMPLE_TS, ext: "ts", size: SAMPLE_TS.length }),
  filesWrite: async () => ({ ok: true, size: 0 }),
  filesPageImage: async (_rel: string, _root: string | undefined, page = 1) => ({
    dataUrl: fakePdfPage(page), width: 1190, height: 1684, pages: 5, page, scale: 1.6,
  }),
  filesPreviewDoc: async () => ({ html: "" }),
};

/* 预览页只关心 UI：没显式实现的方法一律给个空桩（on* → 返回取消函数） */
function stubHarness(base: Record<string, unknown>) {
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop.startsWith("on")) return () => () => {};
      if (prop === "then") return undefined;
      return async () => ({ ok: true });
    },
  });
}

(window as unknown as { harness: unknown }).harness = stubHarness({
  ...fakeTerm,
  ...fakeFile,
  onImPaired: () => () => {},
  previewPermissions: async () => [],
  previewRevokePermission: async () => ({ ok: true }),
  invoke: async () => ({ ok: true }),
});

function Preview() {
  const state = useScriptedState();
  if (page === "file") {
    const isPdf = params.get("ext") === "pdf";
    const file = isPdf
      ? { name: "spec.pdf", rel: "docs/spec.pdf", root: "/tmp/demo" }
      : { name: "use-debounced.ts", rel: "src/use-debounced.ts", root: "/tmp/demo" };
    return (
      <div className="app" style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", height: "100%" }}>
        <Rail view="scene" onChange={() => undefined} />
        <div className="main" style={{ display: "block", minWidth: 0 }}>
          <div style={{ height: "100%", width: 900 }}>
            <PreviewSurface mode="file" file={file} root={file.root} active />
          </div>
        </div>
      </div>
    );
  }
  if (page === "terminal") {
    return (
      <div className="app" style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", height: "100%" }}>
        <Rail view="scene" onChange={() => undefined} />
        <div className="main" style={{ display: "block", minWidth: 0 }}>
          <div style={{ height: "100%", width: 860 }}>
            <TerminalPanel
              state={state}
              todo={null}
              onPickedContext={() => undefined}
              act={async () => ({ ok: true })}
              onToggleMaximize={() => undefined}
            />
          </div>
        </div>
      </div>
    );
  }
  if (page === "settings") {
    return (
      <div className="app" style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", height: "100%" }}>
        <Rail view="settings" onChange={() => undefined} />
        <div className="main" style={{ display: "block", minWidth: 0 }}>
          <div className="wide settings-wide">
            <Settings state={state} act={async () => ({ ok: true })} notify={(message: string) => console.log(message)} now={now} onOpenTodo={() => undefined} initialSection={section} />
          </div>
        </div>
      </div>
    );
  }
  if (page === "bots") {
    return (
      <div className="app" style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", height: "100%" }}>
        <Rail view="bots" onChange={() => undefined} />
        <div className="main" style={{ display: "block", minWidth: 0 }}>
          <div className="wide">
            <Bots state={state} act={async () => ({ ok: true })} notify={(message: string) => console.log(message)} now={now} onOpenBot={() => undefined} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="app" style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", height: "100%" }}>
      <Rail view="scene" onChange={() => undefined} />
      <div className="main" style={{ display: "block", minWidth: 0 }}>
        <div className="wide office-wide">
          <SceneWorkspace
            state={state}
            now={now}
            act={async () => ({ ok: true })}
            notify={(message: string) => console.log(message)}
            onOpenTask={(id: string) => console.log("open task", id)}
            onOpenThread={(id: string) => console.log("open thread", id)}
            onOpenTerminal={(cwd: string) => console.log("open terminal", cwd)}
            onNewThread={() => console.log("new thread")}
            onOpenProjects={() => console.log("open projects")}
            initialTab={initialTab}
            initialSelectedId={initialSelectedId}
            initialDetailOpen={params.get("detail") === "1"}
            initialMode={params.get("mode") === "config" ? "config" : "live"}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Preview /></React.StrictMode>);
