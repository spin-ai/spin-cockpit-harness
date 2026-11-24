import { useCallback, useEffect, useMemo, useState } from "react";
import type { ElementContext, State } from "./types";
import { Rail } from "./components/Rail";
import { TaskPane } from "./components/TaskPane";
import { TaskChat } from "./components/TaskChat";
import { TerminalPanel } from "./components/TerminalPanel";
import { FilePanel } from "./components/FilePanel";
import { GitView } from "./components/GitView";
import { Projects } from "./components/Views";
import { Requirements } from "./components/Requirements";
import { ApprovalModal } from "./components/ApprovalModal";
import { ConfirmHost } from "./components/ConfirmHost";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Splitter, useStoredSize } from "./components/Splitter";
import { LangProvider } from "./i18n";
import { CollapsedPane } from "./components/CollapsedPane";
import { FilesIcon, ListIcon, TerminalIcon, XIcon } from "./components/Icons";
import { Settings, type SettingsSection } from "./components/Settings";
import { Guide } from "./components/Guide";
import { Notes } from "./components/Notes";
import { Zhulong } from "./components/Zhulong";
import { PluginMarket } from "./components/PluginMarket";
import { BotConsole } from "./components/Bot";
import { applyBotPatch } from "../electron/bot/patch.mjs";
import { Bots } from "./components/Bots";
import { Memory } from "./components/Memory";
import { Persona } from "./components/Persona";
import { SceneWorkspace } from "./components/SceneWorkspace";
import { requestTerminalAdopt, requestTerminalAt } from "./terminal-events";
import { THEMES, isDarkTheme, resolveTheme } from "./themes";

type View = "workspace" | "terminal" | "scene" | "projects" | "requirements" | "bots" | "git" | "settings" | "guide" | "notes" | "knowledge" | "memory" | "persona" | "zhulong" | "plugins" | "bot";
type PaneId = "todo" | "terminal" | "files";
const COLLAPSED_PANE_W = 34;

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [todoAll, setTodoAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 错误不跟 toast 共用槽位：toast 3 秒就消失，报错一闪而过根本来不及看。
  // 错误单独堆在右下角，永不自动消失，可复制全文，直到手动关掉。
  const [errors, setErrors] = useState<{ id: number; action: string; text: string; at: number }[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notesOpenReq, setNotesOpenReq] = useState<{ path: string; n: number } | null>(null);
  const [guidePage, setGuidePage] = useState("home");
  /** 跳场景时指定要打开哪个场景（Chat → 航母一键入口）；空 = 回到该项目上次看的场景 */
  const [sceneFocusId, setSceneFocusId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [botUnread, setBotUnread] = useState(0);
  /** 打开设置时落到哪个分区（主机 / 统计已经从 rail 收进设置） */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  /** 从机器人页点「打开会话」进来时要落到哪个 bot */
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  /** 工作区右侧的机器人配置抽屉：当前在看哪个 bot */

  /** 预览里拾取的元素上下文：随下一次派活发出去 */
  const [pendingContext, setPendingContext] = useState<ElementContext | null>(null);
  /** 对话面聚焦哪一次运行（点运行记录 / 从终端「在对话里继续」进来时设它） */
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [todoW, setTodoW] = useStoredSize("cmh.layout.todoW.v2", 360, 240, 560);
  const [filesW, setFilesW] = useStoredSize("cmh.layout.filesW", 280, 180, 640);
  const [focusedPane, setFocusedPane] = useState<PaneId | null>(null);
  // 窗口变窄（或整窗放大）时，固定宽度的侧栏要跟着收，否则工作区会横向溢出
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [collapsed, setCollapsed] = useState<Record<PaneId, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("cmh.layout.collapsed.v2") || "{}");
      // 右栏（文件 / 会话 / Git）默认收起：终端吃满剩下的宽度，需要时点窄条或打开文件再展开
      return { todo: !!raw.todo, terminal: !!raw.terminal, files: raw.files !== false };
    } catch {
      return { todo: false, terminal: false, files: true };
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cmh.layout.collapsed.v2", JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    const reset = () => {
      setCollapsed({ todo: false, terminal: false, files: false });
      setMaximized(null);
    };
    window.addEventListener("harness:reset-layout", reset);
    return () => window.removeEventListener("harness:reset-layout", reset);
  }, []);

  // 资源管理器里的「预览 / 在终端中打开」：如果终端面板收起了，先展开再交给 TerminalPanel
  useEffect(() => {
    const expandTerminal = () => setCollapsed((c) => (c.terminal ? { ...c, terminal: false } : c));
    const events = ["harness:open-file-preview", "harness:open-terminal-at", "harness:adopt-terminal", "harness:new-terminal", "harness:open-preview", "harness:split-terminal"];
    for (const name of events) window.addEventListener(name, expandTerminal);
    return () => { for (const name of events) window.removeEventListener(name, expandTerminal); };
  }, []);
  // 面板最大化：把面板铺满工作区（绝对定位），其余面板只隐藏不卸载，pty / 标签都保住
  const [maximized, setMaximized] = useState<PaneId | null>(() => {
    try {
      const raw = localStorage.getItem("cmh.layout.maximized");
      return raw && ["todo", "terminal", "files"].includes(raw) ? (raw as PaneId) : null;
    } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem("cmh.layout.maximized", maximized ?? ""); } catch { /* ignore */ }
  }, [maximized]);
  const toggleMaximize = useCallback((id: PaneId) => {
    setMaximized((current) => (current === id ? null : id));
  }, []);
  const togglePane = useCallback((id: PaneId) => {
    // 收起被最大化的面板时先还原，否则会把整屏收成一条窄带
    setMaximized((current) => (current === id ? null : current));
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);
  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMaximized(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  // 工作区焦点：指针进入某个 pane 后记住它，用于主次降噪。
  const markFocusedPane = useCallback((e: React.SyntheticEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".todo-pane,.terminal-pane,.files-pane");
    const next = el?.classList.contains("todo-pane") ? "todo"
      : el?.classList.contains("terminal-pane") ? "terminal"
        : el?.classList.contains("files-pane") ? "files" : null;
    if (next) setFocusedPane(next);
  }, []);

  // 右侧 Git 面板的「全屏」：切到 Git 页
  useEffect(() => {
    const onOpenGit = () => setView("git");
    window.addEventListener("harness:open-git", onOpenGit);
    return () => window.removeEventListener("harness:open-git", onOpenGit);
  }, []);

  // 错误卡片 / 统计失败行：跳到设置页并定位到某个分区（可带 focus 字段）
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: string; focus?: string }>).detail;
      setView("settings");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:settings-jump", { detail })), 80);
    };
    window.addEventListener("harness:open-settings", onOpen);
    return () => window.removeEventListener("harness:open-settings", onOpen);
  }, []);

  /** 打开一条会话：对话现在是终端窗格的第一个标签（⌘J 同一条路） */
  const openSession = useCallback((threadId?: string | null) => {
    if (threadId) setThreadId(threadId);
    setView("terminal");
    window.setTimeout(() => window.dispatchEvent(new Event("harness:chat-tab")), 30);
  }, []);

  // 「问清楚」/ 点任务 / 插件草稿都落到会话：先切到终端页，再定位到对话标签
  useEffect(() => {
    const onFocusChat = () => {
      setView("terminal");
      window.setTimeout(() => window.dispatchEvent(new Event("harness:chat-tab")), 30);
    };
    window.addEventListener("harness:focus-chat", onFocusChat);
    return () => window.removeEventListener("harness:focus-chat", onFocusChat);
  }, []);

  // 拖拽时按窗口宽度限制，避免把中间/右侧面板挤出可视区。
  const resizeTodo = useCallback((d: number) => {
    setTodoW((w) => Math.min(w + d, Math.max(180, window.innerWidth - 378 - filesW)));
  }, [setTodoW, filesW]);
  const resizeFiles = useCallback((d: number) => {
    setFilesW((w) => Math.min(w - d, Math.max(180, window.innerWidth - 378 - todoW)));
  }, [setFilesW, todoW]);

  useEffect(() => {
    window.harness.getState().then((s) => {
      setState(s);
      setThreadId((prev) => prev ?? s.threads.find((t) => !t.todoId && t.kind !== "bot")?.id ?? s.threads[0]?.id ?? null);
      const dv = String(s.settings?.defaultView || "");
      if (dv === "workspace" || dv === "terminal" || dv === "projects" || dv === "settings") setView(dv);
      // 老库的 defaultView 可能还是 stats / hosts：落到设置里对应的分区
      else if (dv === "stats" || dv === "hosts") { setView("settings"); setSettingsSection(dv); }
    });
    const off = window.harness.onState(setState);
    // 作用域增量：只替换这个 bot 变了的切片，不再为一行字重渲染整个世界
    const offPatch = window.harness.onBotPatch((patch) => {
      setState((prev) => (prev ? applyBotPatch(prev, patch) : prev));
    });
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { off(); offPatch(); clearInterval(t); };
  }, []);

  // 主题：data-theme 决定调色板，data-mode 决定深浅色下的结构覆盖
  useEffect(() => {
    const mode = state?.settings?.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(mode, media.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.mode = isDarkTheme(resolved) ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [state?.settings?.theme]);

  // Chat 字号走 CSS 变量，切设置即时生效
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-font-size", `${state?.settings?.chatFontSize ?? 13}px`);
  }, [state?.settings?.chatFontSize]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), 3000);
  }, []);

  /** 去掉 Electron IPC 的包装前缀，只留人话；完整原文仍在卡片里可复制 */
  const cleanError = (raw: unknown) => String((raw as Error)?.message || raw || "未知错误")
    .replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  const notifyError = useCallback((action: string, raw: unknown) => {
    const text = cleanError(raw);
    setErrors((prev) => {
      // 同一个动作 + 同一句话 10 秒内不重复堆（轮询失败会每 1.2s 报一次）
      const near = prev.find((e) => e.action === action && e.text === text && Date.now() - e.at < 10000);
      if (near) return prev.map((e) => (e.id === near.id ? { ...e, at: Date.now() } : e));
      return [{ id: Date.now() + Math.random(), action, text, at: Date.now() }, ...prev].slice(0, 5);
    });
  }, []);

  const act = useCallback(async (type: string, payload?: unknown) => {
    try {
      const r = await window.harness.action(type, payload);
      return r.result;
    } catch (e) {
      notifyError(type, e);
      return null;
    }
  }, [notifyError]);

  useEffect(() => {
    const onDraft = (detail: { text?: string }) => {
      if (!detail?.text) return;
      setView("terminal");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail })), 120);
    };
    const onNotify = (detail: { message?: string }) => {
      if (detail?.message) notify(detail.message);
    };
    const onPluginView = (detail: { id?: string }) => {
      if (detail?.id === "notes") setView("notes");
    };
    const offBot = window.harness.onBotMessage((payload) => {
      if (!payload?.text) return;
      notify(payload.text.length > 60 ? `${payload.text.slice(0, 60)}…` : payload.text);
      setBotUnread((n) => n + 1);
    });
    const offDraft = window.harness.onPluginChatDraft(onDraft);
    const offNotify = window.harness.onPluginNotify(onNotify);
    const offView = window.harness.onPluginOpenView(onPluginView);
    return () => { offBot(); offDraft(); offNotify(); offView(); };
  }, [notify]);


  const scoped = useMemo(() => {
    if (!state) return null;
    const pid = state.activeProjectId;
    if (!pid) return state;
    const todos = state.todos.filter((t) => t.projectId === pid);
    const ids = new Set(todos.map((t) => t.id));
    const agents = state.agents.filter((a) => !a.projectId || a.projectId === pid);
    // 全局对话（未绑定项目）在任何项目下都可见
    const threads = state.threads.filter((t) => !t.todoId || !t.projectId || t.projectId === pid);
    const tids = new Set(threads.map((t) => t.id));
    const runs = state.runs.filter((r) => r.todoId != null && ids.has(r.todoId));
    const missionIds = new Set(todos.filter((t) => t.kind === "mission").map((t) => t.id));
    const delegations = (state.delegations ?? []).filter((d) => missionIds.has(d.missionId));
    const missionPlans = (state.missionPlans ?? []).filter((p) => missionIds.has(p.missionId));
    return {
      ...state,
      todos, runs, threads, agents, delegations, missionPlans,
      messages: state.messages.filter((m) => tids.has(m.threadId)),
      artifacts: state.artifacts.filter((a) => ids.has(a.todoId)),
      approvals: state.approvals.filter((a) => ids.has(a.todoId)),
      summary: {
        activeRuns: runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length,
        cost: Number(runs.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2)),
        tokens: runs.reduce((s, r) => s + (r.tokens || 0), 0),
        failures: runs.filter((r) => r.status === "failed").length,
      },
    };
  }, [state]);

  const thread = useMemo(() => scoped?.threads.find((t) => t.id === threadId) ?? null, [scoped, threadId]);
  const selected = useMemo(() => (thread?.todoId ? scoped?.todos.find((t) => t.id === thread.todoId) ?? null : null), [scoped, thread]);
  /**
   * 对话面的「当前运行」：显式点过某条运行就用它，否则用这条任务最近一次运行。
   * 对话和终端说的是同一次 run 的两面——这是把两边对齐的那根轴。
   */
  const focusRun = useMemo(() => {
    if (!state) return null;
    if (focusRunId) return state.runs.find((r) => r.id === focusRunId) ?? null;
    if (!selected) return null;
    const mine = state.runs.filter((r) => r.todoId === selected.id);
    return mine.length ? mine[mine.length - 1] : null;
  }, [state, focusRunId, selected]);
  // 文件预览跟随任务的真实工作目录（run 的 worktree 优先），否则看不到 agent 的改动
  const workdir = useMemo(() => {
    if (!state) return "";
    if (!selected) return state.projectPath;
    const runs = state.runs.filter((r) => r.todoId === selected.id);
    const running = runs.find((r) => ["running", "waiting_input"].includes(r.status) && r.cwd);
    const latest = [...runs].reverse().find((r) => r.cwd);
    return running?.cwd || latest?.cwd || selected.cwd || state.projectPath;
  }, [state, selected]);
  // 预览跟着“这个任务跑在哪台机器上”：远端 Agent 的 dev server 在本机不可达，PreviewSurface 会用 ssh -L 隧道
  const previewHost = useMemo(() => {
    if (!state) return null;
    const runs = selected ? state.runs.filter((r) => r.todoId === selected.id) : [];
    const running = runs.find((r) => ["running", "waiting_input"].includes(r.status) && r.hostId);
    const latest = [...runs].reverse().find((r) => r.hostId);
    const agent = state.agents.find((a) => a.id === (thread?.agentId || selected?.agentId));
    const host = state.hosts.find((h) => h.id === (running?.hostId || latest?.hostId || agent?.hostId));
    return host && host.kind === "ssh" ? { id: host.id, name: host.name || host.addr, root: workdir } : null;
  }, [state, thread, selected, workdir]);
  /** BOT 模式右列检查器的对象：正在看的 BOT 会话，否则第一个 BOT */
  const inspectorBotId = (thread?.kind === "bot" ? thread.botId : null) ?? state?.bots?.[0]?.id ?? null;
  const projectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of state?.todos ?? []) if (t.projectId && t.kind !== "chat") counts[t.projectId] = (counts[t.projectId] ?? 0) + 1;
    return counts;
  }, [state?.todos]);
  const notesEnabled = Boolean(state?.plugins?.find((p) => p.id === "ai.cockpit.notes")?.enabled);
  // 只要插件被安装就露出入口：未启用时视图里给出「去设置启用」，否则入口会被藏起来
  const zhulongAvailable = Boolean(state?.plugins?.find((p) => p.id === "ai.cockpit.zhulong"));

  const selectTodo = useCallback(async (todoId: string) => {
    const todo = state?.todos.find((t) => t.id === todoId);
    if (todo?.projectId && todo.projectId !== state?.activeProjectId) {
      await act("switchProject", { id: todo.projectId });
    }
    const t = state?.threads.find((x) => x.todoId === todoId);
    if (t) setThreadId(t.id);
    // 留在当前页：BOT 页看回合流，终端页看终端；不做隐式跳转，也不强制展开 dock
    setView((v) => (v === "terminal" || v === "workspace" ? v : "terminal"));
  }, [state, act]);

  useEffect(() => {
    if (!state) return;
    const threads = state.threads.filter((t) => !t.todoId || !t.projectId || t.projectId === state.activeProjectId);
    setThreadId((prev) => {
      if (threads.some((t) => t.id === prev)) return prev;
      return threads.find((t) => !t.todoId && t.kind !== "bot")?.id ?? threads[0]?.id ?? null;
    });
    // 也要跟 threads 走：清空任务后当前 threadId 会指向已删的会话，得回落到草稿会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.activeProjectId, state?.threads]);

  // 主进程自动起的终端 Agent（普通多 Agent / Mission child）：接管成终端标签
  useEffect(() => window.harness.onTerminalAdopt((p) => {
    if (p?.terminalId) requestTerminalAdopt({ ...p, title: p.title || "Agent 终端" });
  }), []);

  // 全局快速记录（⌘⇧K）：先切到知识库，再让 Notes 弹输入框  // 全局快速记录（⌘⇧K）：先切到知识库，再让 Notes 弹输入框
  useEffect(() => {
    return window.harness.onQuickCapture(() => {
      if (!notesEnabled) { notify("先在设置 → 插件里启用 Notes"); return; }
      setView("notes");
      window.setTimeout(() => window.dispatchEvent(new Event("harness:quick-capture")), 120);
    });
  }, [notesEnabled, notify]);

  useEffect(() => {
    if (view === "bot" || view === "workspace") setBotUnread(0);
  }, [view]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const message = String(typeof detail === "string" ? detail : detail?.message || "");
      if (!message) return;
      // 带 level 的显式报错，或者文案明显是失败/异常：进常驻报错区，不要 3 秒就消失
      const isError = detail?.level === "error" || /失败|错误|出错|异常|超时|不可用|缺少|无权|拒绝|error|failed|exception/i.test(message);
      if (isError) notifyError("toast", message);
      else notify(message);
    };
    window.addEventListener("harness:toast", onToast);
    return () => window.removeEventListener("harness:toast", onToast);
  }, [notify, notifyError]);

  useEffect(() => {
    const onView = (e: Event) => {
      const detail = (e as CustomEvent<string | { view?: string; page?: string; sceneId?: string }>).detail;
      const next = typeof detail === "string" ? detail : detail?.view;
      if (!next || !["workspace", "terminal", "scene", "projects", "bots", "stats", "hosts", "settings", "guide", "notes", "knowledge", "memory", "persona", "zhulong", "plugins", "bot"].includes(next)) return;
      if (next === "guide" && typeof detail === "object" && detail?.page) setGuidePage(detail.page);
      if (next === "scene") setSceneFocusId(typeof detail === "object" && detail?.sceneId ? detail.sceneId : null);
      // 统计 / 主机已收进设置：保留旧入口，落到设置对应分区
      if (next === "stats" || next === "hosts") { setSettingsSection(next); setView("settings"); return; }
      setView(next as View);
    };
    window.addEventListener("harness:view", onView);
    return () => window.removeEventListener("harness:view", onView);
  }, []);

  useEffect(() => {
    // 切会话时丢掉未发送的元素上下文，避免把 A 任务的元素发给 B
    setPendingContext(null);
  }, [threadId]);

  const addProject = useCallback(async () => {
    const dir = await window.harness.pickProjectFolder();
    if (!dir) return;
    const p = await act("addProject", { path: dir }) as { name?: string } | null;
    if (p?.name) { notify(`已添加项目：${p.name}`); setView("terminal"); }
  }, [act, notify]);

  const switchProject = useCallback(async (id: string) => {
    await act("switchProject", { id });
    // 项目是终端模式的对象；在 BOT 页切项目时不要把人踢走
    setView((v) => (v === "workspace" ? v : "terminal"));
  }, [act]);

  const openRequirements = useCallback(async (projectId?: string) => {
    if (projectId && projectId !== state?.activeProjectId) await act("switchProject", { id: projectId });
    setView("requirements");
  }, [act, state?.activeProjectId]);

  const newTaskInProject = useCallback(async (id: string) => {
    if (id !== state?.activeProjectId) await switchProject(id);
    setView("terminal");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:new-task")), 120);
  }, [state?.activeProjectId, switchProject]);

  const newThread = useCallback(async () => {
    // 新对话默认全局；需要项目作用域时在 Chat 的「作用域」里选
    const t = await act("newThread", {}) as { id?: string } | null;
    if (t?.id) openSession(t.id);
  }, [act, openSession]);

  const dispatchInWorkspace = useCallback((makeEvent: () => Event) => {
    setView("terminal");
    // 等 workspace / TaskPane / TerminalPanel 挂载后再派发，避免跨页面命令静默空操作
    window.setTimeout(() => window.dispatchEvent(makeEvent()), 90);
  }, []);

  const openTodoFromPalette = useCallback(async (todoId: string) => {
    const todo = state?.todos.find((t) => t.id === todoId);
    if (!todo) return;
    if (todo.projectId && todo.projectId !== state?.activeProjectId) {
      await act("switchProject", { id: todo.projectId });
    }
    const thread = state?.threads.find((t) => t.todoId === todoId);
    if (thread) setThreadId(thread.id);
    setView((v) => (v === "terminal" || v === "workspace" ? v : "terminal"));
  }, [state, act]);

  /** 点机器人 = 打开它那条会话（同一个 Chat）；管理仍进机器人控制台 */
  const openBotConversation = useCallback(async (botId: string) => {
    setBotUnread(0);
    try {
      const res = (await act("botThread", { botId })) as { threadId?: string } | null;
      if (res?.threadId) {
        setThreadId(res.threadId);
        setView("workspace");
      }
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  }, [act, notify]);

  // 离开机器人会话时，右侧配置一起收起（换回普通任务 / 别的页面不占着位置）
  useEffect(() => {
  }, [thread]);

  const openThreadFromPalette = useCallback(async (threadId: string) => {
    const thread = state?.threads.find((t) => t.id === threadId);
    if (!thread) return;
    if (thread.projectId && thread.projectId !== state?.activeProjectId) {
      await act("switchProject", { id: thread.projectId });
    }
    openSession(thread.id);
  }, [state, act, openSession]);

  /** 打开设置并落到某个分区；rail 直接点「设置」时不带分区（回到通用） */
  const openSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    setView("settings");
  }, []);

  const commands: Command[] = useMemo(() => {
    if (!state) return [];
    const list: Command[] = [
      { id: "view-bot", label: "机器人：回合流 + 人格 / 记忆", group: "导航", run: () => setView("workspace") },
      { id: "view-terminal", label: "工作台：项目 / 终端 / 任务表", group: "导航", run: () => setView("terminal") },
      { id: "view-scene", label: "场景", group: "导航", run: () => setView("scene") },
      { id: "view-projects", label: "项目花名册（统计 / 场景 / 切换）", group: "导航", run: () => setView("projects") },
      { id: "view-requirements", label: "需求（IR → SR → US）", group: "导航", run: () => void openRequirements() },
      { id: "view-stats", label: "统计", group: "导航", hint: "设置 → 统计", run: () => openSettingsSection("stats") },
      { id: "view-hosts", label: "主机", group: "导航", hint: "设置 → 主机", run: () => openSettingsSection("hosts") },
      { id: "view-git", label: "Git / 源码管理", group: "导航", run: () => setView("git") },
      { id: "view-knowledge", label: "资料（知识库 → 文档）", group: "导航", run: () => setView("knowledge") },
      { id: "view-memory", label: "记忆（四层 / Dream）", group: "导航", run: () => setView("memory") },
      { id: "view-persona", label: "人物（建模 / 决策辅助）", group: "导航", run: () => setView("persona") },
      { id: "view-bots", label: "机器人库（配置：人设 / 执行体 / 日程）", group: "导航", run: () => setView("bots") },
      { id: "view-plugins", label: "插件市场（本机插件 / 已注册视图）", group: "导航", run: () => setView("plugins") },
      { id: "quick-capture", label: "快速记录到知识库", hint: "⌘⇧K", group: "任务", run: () => void act("openQuickCapture") },
      { id: "new-thread", label: "新建会话", hint: "⌘N", group: "任务", run: () => void newThread() },
      { id: "new-task", label: "新建任务", hint: "⌘⇧N", group: "任务", run: () => dispatchInWorkspace(() => new Event("harness:new-task")) },
      { id: "new-terminal", label: "新建终端标签", hint: "⌘T", group: "终端", run: () => dispatchInWorkspace(() => new Event("harness:new-terminal")) },
      { id: "split-right", label: "向右拆分终端", hint: "⌘D", group: "终端", run: () => dispatchInWorkspace(() => new CustomEvent("harness:split-terminal", { detail: "row" })) },
      { id: "split-down", label: "向下拆分终端", hint: "⇧⌘D", group: "终端", run: () => dispatchInWorkspace(() => new CustomEvent("harness:split-terminal", { detail: "col" })) },
      { id: "open-preview", label: "打开预览（文件 / dev server / URL）", group: "终端", run: () => dispatchInWorkspace(() => new Event("harness:open-preview")) },
      { id: "close-terminal", label: "关闭窗格", hint: "⌘W", group: "终端", run: () => dispatchInWorkspace(() => new Event("harness:close-terminal")) },
      { id: "edit-todo", label: "编辑任务", hint: "⌘E", group: "任务", run: () => dispatchInWorkspace(() => new Event("harness:edit-todo")) },
      { id: "open-project", label: "打开 / 添加项目…", hint: "⌘P", group: "项目", run: () => void addProject() },
      { id: "open-settings", label: "打开设置", hint: "⌘,", group: "导航", run: () => setView("settings") },
      { id: "open-model-key", label: "配置模型密钥（DEEPSEEK_API_KEY 等）", group: "导航", hint: "设置 → 执行", run: () => window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: { section: "execution", focus: "dshEnv" } })) },
      { id: "open-guide", label: "使用说明 / Super Agent 怎么用", group: "导航", run: () => setView("guide") },
      ...(notesEnabled ? [{ id: "open-notes", label: "打开知识库", group: "插件", run: () => setView("notes") }] : []),
      ...(zhulongAvailable ? [{ id: "open-zhulong", label: "打开视觉解析", group: "插件", run: () => setView("zhulong") }] : []),
      ...((state.pluginCommands ?? []).map((c) => ({
        id: `plugin-${c.pluginId}-${c.id}`,
        label: c.title,
        hint: c.pluginId,
        group: "插件",
        run: () => { void act("pluginRunCommand", { pluginId: c.pluginId, commandId: c.id }).then((res) => { const r = res as { vaultPath?: string; path?: string } | null; if (r?.vaultPath || r?.path) { setView("notes"); if (r.path) setNotesOpenReq({ path: r.path, n: Date.now() }); } }); },
      }))),
      { id: "reset-layout", label: "重置面板尺寸", group: "布局", run: () => window.dispatchEvent(new Event("harness:reset-layout")) },
    ];
    for (const p of state.projects) {
      list.push({
        id: `switch-${p.id}`, label: `切换项目：${p.name}`,
        hint: `${p.id === state.activeProjectId ? "当前 · " : ""}${p.path}`,
        group: "项目", run: () => void switchProject(p.id),
      });
    }
    for (const t of state.todos) {
      list.push({
        id: `todo-${t.id}`, label: `任务：${t.key} ${t.title}`, hint: t.projectId ? state.projects.find((p) => p.id === t.projectId)?.name : "全局",
        group: "任务", run: () => void openTodoFromPalette(t.id),
      });
    }
    for (const t of state.threads) {
      list.push({
        id: `thread-${t.id}`, label: `会话：${t.title || "新任务"}`, hint: t.projectId ? state.projects.find((p) => p.id === t.projectId)?.name : "全局",
        group: "会话", run: () => void openThreadFromPalette(t.id),
      });
    }
    for (const t of THEMES) {
      list.push({
        id: `theme-${t.id}`, label: `主题：${t.label}`, hint: t.desc,
        group: "外观", run: () => void act("setSettings", { theme: t.id }),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.projects, state?.todos, state?.threads, state?.activeProjectId, newThread, dispatchInWorkspace, openTodoFromPalette, openThreadFromPalette, addProject, switchProject, openRequirements, act]);

  useEffect(() => {
    // 自定义菜单去掉了 Select All 角色（否则 ⌘A 会被应用菜单吞掉，终端无法选择缓冲区）。
    // 文本输入框仍需要 ⌘A 全选，这里补一条针对 input/textarea 的处理。
    const onSelectAll = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "a") return;
      const el = e.target as HTMLElement | null;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
      if (el.classList.contains("xterm-helper-textarea")) return; // 终端的 ⌘A 由 TerminalPanel 处理
      e.preventDefault();
      el.select();
    };
    window.addEventListener("keydown", onSelectAll, true);
    return () => window.removeEventListener("keydown", onSelectAll, true);
  }, []);

  useEffect(() => {
    const runInWorkspace = (make: () => Event) => {
      if (view === "terminal") { window.dispatchEvent(make()); return; }
      setView("terminal");
      window.setTimeout(() => window.dispatchEvent(make()), 90);
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      // 终端内的 ⌘T / ⌘W 由 TerminalPanel 自己处理；也避免 Windows/Linux 的 ⌃T / ⌃W 抢 shell 按键
      const inTerminal = !!(e.target as HTMLElement)?.closest?.(".term-instance");
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (mod && e.key.toLowerCase() === "t" && !inTerminal) { e.preventDefault(); runInWorkspace(() => new Event("harness:new-terminal")); return; }
      if (mod && e.key.toLowerCase() === "w" && !inTerminal) { e.preventDefault(); window.dispatchEvent(new Event("harness:close-terminal")); return; }
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); void addProject(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); runInWorkspace(() => new Event("harness:new-task")); return; }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void newThread(); return; }
      if (mod && e.key.toLowerCase() === "e" && !inTerminal) { e.preventDefault(); runInWorkspace(() => new Event("harness:edit-todo")); return; }
      if (mod && e.key === ",") { e.preventDefault(); setView("settings"); return; }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "j" && view === "terminal") {
        e.preventDefault();
        // Chat 现在是终端的第一个标签：⌘J 原意不变，切到对话并把光标放进输入框
        window.dispatchEvent(new Event("harness:chat-tab"));
        window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".dispatch-input")?.focus(), 40);
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const p = state?.projects[Number(e.key) - 1];
        if (p) { e.preventDefault(); void switchProject(p.id); }
        return;
      }
      if (!mod && !typing && !paletteOpen && (e.key === "j" || e.key === "k")) {
        e.preventDefault();
        const threads = scoped?.threads ?? [];
        if (!threads.length) return;
        const idx = Math.max(0, threads.findIndex((t) => t.id === threadId));
        const next = e.key === "j" ? Math.min(idx + 1, threads.length - 1) : Math.max(idx - 1, 0);
        setThreadId(threads[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.projects, scoped?.threads, threadId, paletteOpen, view]);

  // 整窗缩放：⌘+ / ⌘- / ⌘0。终端里这个组合是终端字号，留给 xterm
  useEffect(() => {
    const onZoomKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const inTerminal = !!(e.target as HTMLElement)?.closest?.(".term-instance, .xterm");
      if (inTerminal) return;
      // 0 = 自动（按屏幕分辨率）；手动调一下就从当前生效值开始步进
      const raw = Number(state?.settings?.uiScale);
      const cur = raw > 0 ? raw : Number(state?.settings?.uiScaleResolved) || 100;
      const clamp = (v: number) => Math.min(150, Math.max(80, Math.round(v / 10) * 10));
      let next: number | null = null;
      if (e.key === "=" || e.key === "+") next = clamp(cur + 10);
      else if (e.key === "-" || e.key === "_") next = clamp(cur - 10);
      else if (e.key === "0") next = 0;
      if (next === null) return;
      e.preventDefault();
      void act("setSettings", { uiScale: next });
    };
    window.addEventListener("keydown", onZoomKey, true);
    return () => window.removeEventListener("keydown", onZoomKey, true);
  }, [act, state?.settings?.uiScale, state?.settings?.uiScaleResolved]);

  if (!state) return <div className="boot">启动中…</div>;

  const railBadges = {
    workspace: state.runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length,
    // 主机离线提示挂在「设置」上：主机/统计已经是设置里的分区，rail 不再单独占位
    settings: state.hosts.filter((h) => h.status === "offline").length,
  };

  // 终端默认吃掉剩余宽度；终端收起时，由仍展开的最右侧面板吃掉剩余宽度。
  // BOT 模式主面 = 会话；终端模式主面 = 终端网格（原型 owner-workspaces.html）
  const flexOrder: PaneId[] = ["terminal", "files", "todo"];
  const flexPane: PaneId | null = flexOrder.find((id) => !collapsed[id]) ?? null;
  // 可用宽度 = 窗口 - 左栏 - 终端最小宽 - 分隔条；固定列按比例收缩，保底 140px
  // 固定列只算「不是主面」的那几列：主面吃 1fr，算进 fixedSum 会把别的列挤小
  const fixedW = (id: PaneId, w: number) => (collapsed[id] || flexPane === id ? 0 : w);
  const fixedSum = fixedW("todo", todoW) + fixedW("files", filesW);
  const usable = Math.max(420, viewportW - 64 - 300 - 18);
  const shrink = fixedSum > usable ? usable / fixedSum : 1;
  const shrunk = (w: number) => Math.max(140, Math.round(w * shrink));

  const paneCol = (id: PaneId, width: number, min: number) =>
    collapsed[id] ? `${COLLAPSED_PANE_W}px` : flexPane === id ? `minmax(${min}px, 1fr)` : `${width}px`;
  const todoCol = paneCol("todo", shrunk(todoW), 140);
  const terminalCol = collapsed.terminal ? `${COLLAPSED_PANE_W}px` : "minmax(240px, 1fr)";
  const filesCol = paneCol("files", shrunk(filesW), 140);
  // 左栏只剩任务列表：Chat 已合进终端窗格，作为它的第一个标签（⌘J 直达）
  const sep1 = !collapsed.todo && !collapsed.terminal ? "6px" : "0px";
  const sep3 = !collapsed.terminal && !collapsed.files ? "6px" : "0px";
  // 网格只有：TODO · 终端（主面）· 文件；Chat 是终端窗格里的第一个标签
  const gridCols = `64px ${todoCol} ${sep1} ${terminalCol} ${sep3} ${filesCol}`;

  return (
    <LangProvider lang={state.settings?.uiLanguage === "en" ? "en" : "zh"}>
    <div className="app">
      <div className={`main pane-focus-${focusedPane ?? "none"}${maximized ? " pane-max" : ""}`} style={{ gridTemplateColumns: gridCols }} onPointerDownCapture={markFocusedPane} onFocusCapture={markFocusedPane}>
        <Rail view={view} notesEnabled={notesEnabled} badges={railBadges} onChange={(v) => { if (v === "settings") setSettingsSection(undefined); setView(v); }} />
        {/* 工作区始终挂载、只切显隐：切到项目 / 设置再回来时，终端 pty、标签、滚动位置都不能丢 */}
        {/* 网格（TODO / 终端 / 文件）只在终端模式显示；BOT 模式是下面那张独立页面 */}
        {scoped && (
          <div className="workspace-view" style={{ display: view === "terminal" ? "contents" : "none" }}>
          <>
            <div className={`left-stack${collapsed.todo ? " todo-collapsed" : ""}`}>
            {collapsed.todo ? (
              <CollapsedPane label="TODO" title="TODO 列表" icon={<ListIcon size={16} />} onExpand={() => togglePane("todo")} />
            ) : (
              <TaskPane
                mode="terminal"
                state={todoAll ? state : scoped}
                selectedId={selected?.id ?? null}
                now={now}
                act={act}
                onSelect={selectTodo}
                projectCounts={projectCounts}
                onAddProject={() => void addProject()}
                onManageProjects={() => setView("projects")}
                onSwitchProject={(id) => void switchProject(id)}
                maximized={maximized === "todo"}
                onToggleMaximize={() => toggleMaximize("todo")}
                confirmStop={state.settings?.confirmStop}
                allProjects={todoAll}
                onToggleScope={() => setTodoAll((v) => !v)}
                onOpenBot={(id) => void openBotConversation(id)}
                onManageBots={() => setView("bots")}
                botUnread={botUnread}
                activeBotId={thread?.kind === "bot" ? thread.botId ?? null : null}
              />
            )}
            </div>
            {sep1 === "6px" ? <Splitter onDelta={resizeTodo} /> : <div className="splitter-off" />}
            <div className={`terminal-slot is-stacked${maximized === "terminal" ? " pane-max-target" : ""}`}>
              <div className="terminal-slot-main" style={{ display: collapsed.terminal ? "none" : "flex" }}>
                <TerminalPanel state={state} todo={selected} act={act} onOpenThread={openSession} threadId={threadId} onFocusThread={(id) => setThreadId(id)} onPickedContext={setPendingContext} previewRoot={workdir} previewHost={previewHost} onCollapse={() => togglePane("terminal")} terminalFontSize={state.settings?.terminalFontSize} terminalScrollback={state.settings?.terminalScrollback} previewHomeUrl={state.settings?.previewHomeUrl} maximized={maximized === "terminal"} onToggleMaximize={() => toggleMaximize("terminal")} chat={<TaskChat state={scoped} globalState={state} thread={thread} threads={scoped.threads} now={now} act={act} onSelect={selectTodo} onOpenGlobal={(id) => void openTodoFromPalette(id)} onNewThread={() => void newThread()} onOpenThread={openSession} context={pendingContext} onClearContext={() => setPendingContext(null)} enterToSend={state.settings?.enterToSend ?? true} confirmStop={state.settings?.confirmStop ?? false} embedded focusRun={focusRun} onClearFocusRun={() => setFocusRunId(null)} />} onOpenRunFocus={(runId) => { setFocusRunId(runId); window.setTimeout(() => window.dispatchEvent(new Event("harness:chat-tab")), 20); }} onContinueInChat={(taskId) => { const runs = state.runs.filter((r) => r.todoId === taskId); const last = runs.length ? runs[runs.length - 1] : null; setFocusRunId(last?.id ?? null); const th = state.threads.find((t) => t.todoId === taskId); if (th) setThreadId(th.id); window.setTimeout(() => window.dispatchEvent(new Event("harness:chat-tab")), 20); }} />
              </div>
              {collapsed.terminal && (
                <CollapsedPane label="工作" title="工作台" icon={<TerminalIcon size={16} />} onExpand={() => togglePane("terminal")} />
              )}
            </div>
            {sep3 === "6px" ? <Splitter onDelta={resizeFiles} /> : <div className="splitter-off" />}
            {collapsed.files ? (
              <CollapsedPane label="文件" title="文件 / 会话" icon={<FilesIcon size={16} />} onExpand={() => togglePane("files")} />
            ) : (
              <FilePanel
                state={scoped}
                root={workdir}
                now={now}
                notify={notify}
                onSelectThread={openSession}
                onCollapse={() => togglePane("files")}
                maximized={maximized === "files"}
                onToggleMaximize={() => toggleMaximize("files")}
              />
            )}
          </>
          </div>
        )}
        {view === "workspace" && (
          <div className="wide bot-workspace">
            <BotConsole
              act={act}
              notify={notify}
              state={state}
              initialBotId={inspectorBotId}
              onOpenThread={openSession}
              onOpenTodo={(id) => void openTodoFromPalette(id)}
              onBackToBots={() => setView("bots")}
            />
          </div>
        )}
        {view === "scene" && (
          <div className="wide office-wide">
            <SceneWorkspace
              state={state}
              now={now}
              act={act}
              notify={notify}
              onOpenTask={(id) => void openTodoFromPalette(id)}
              onOpenThread={openSession}
              onOpenTerminal={(cwd, terminalId) => {
                setView("terminal");
                window.setTimeout(() => {
                  if (terminalId) requestTerminalAdopt({ terminalId, cwd, title: "Agent 终端" });
                  else requestTerminalAt(cwd);
                }, 90);
              }}
              onNewThread={() => void newThread()}
              onOpenProjects={() => setView("projects")}
              initialSelectedId={sceneFocusId}
            />
          </div>
        )}
        {view === "projects" && <div className="wide"><Projects state={state} now={now} act={act} notify={notify} onAdd={() => void addProject()} onSwitch={(id) => void switchProject(id)} onNewTask={(id) => void newTaskInProject(id)} onOpenRequirements={(id) => void openRequirements(id)} /></div>}
        {view === "requirements" && <div className="wide"><Requirements state={state} act={act} notify={notify} onBack={() => setView("projects")} /></div>}
        {view === "git" && <div className="wide"><GitView state={state} notify={notify} /></div>}
        {view === "settings" && <div className="wide settings-wide"><Settings state={state} act={act} notify={notify} now={now} onOpenTodo={(id) => void openTodoFromPalette(id)} initialSection={settingsSection} /></div>}
        {view === "guide" && <div className="wide guide-wiki-wide"><Guide pageId={guidePage} /></div>}
        {view === "notes" && <div className="wide"><Notes state={state} act={act} onOpenTodo={selectTodo} openRequest={notesOpenReq} /></div>}
        {view === "knowledge" && <div className="wide"><Notes state={state} act={act} onOpenTodo={selectTodo} openRequest={notesOpenReq} initialTab="docs" /></div>}
        {view === "memory" && <div className="wide"><Memory act={act} /></div>}
        {view === "persona" && <div className="wide"><Persona act={act} /></div>}
        {view === "bots" && <div className="wide"><Bots state={state} act={act} notify={notify} now={now} onOpenBot={(id) => { setActiveBotId(id); setView("bot"); }} /></div>}
        {view === "bot" && <div className="wide bot-workspace"><BotConsole act={act} notify={notify} state={state} initialBotId={activeBotId} onBackToBots={() => setView("bots")} onOpenThread={(id) => void openThreadFromPalette(id)} onOpenTodo={(id) => void openTodoFromPalette(id)} /></div>}
        {view === "plugins" && <div className="wide"><PluginMarket state={state} onOpenView={(target) => setView(target)} onOpenSettings={() => window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: { section: "plugins" } }))} /></div>}
        {view === "zhulong" && <div className="wide"><Zhulong state={state} act={act} notify={notify} onBack={() => setView("plugins")} onOpenSettings={() => window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: { section: "plugins" } }))} /></div>}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ConfirmHost />
      {state.approvals?.length > 0 && <ApprovalModal approval={state.approvals[0]} pendingCount={state.approvals.length} act={act} />}
      {errors.length > 0 && (
        <div className="errstack" role="alert" aria-live="assertive">
          {errors.map((e) => (
            <div className="errcard" key={e.id}>
              <div className="errcard-head">
                <b>出错了</b>
                {e.action && <code className="errcard-action">{e.action}</code>}
                <time>{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <button
                  className="errcard-btn"
                  onClick={() => void navigator.clipboard?.writeText(e.action ? `${e.action}: ${e.text}` : e.text)}
                  title="复制完整报错，便于贴出来定位"
                >复制</button>
                <button className="errcard-btn" title="关闭这条报错" aria-label="关闭这条报错" onClick={() => setErrors((prev) => prev.filter((x) => x.id !== e.id))}><XIcon size={14} /></button>
              </div>
              <pre className="errcard-body">{e.text}</pre>
            </div>
          ))}
          {errors.length > 1 && (
            <button className="errcard-clear" onClick={() => setErrors([])}>清空全部（{errors.length}）</button>
          )}
        </div>
      )}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
    </LangProvider>
  );
}
