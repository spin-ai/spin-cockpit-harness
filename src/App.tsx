import { useCallback, useEffect, useMemo, useState } from "react";
import type { ElementContext, State } from "./types";
import { Rail } from "./components/Rail";
import { TaskPane } from "./components/TaskPane";
import { TaskChat } from "./components/TaskChat";
import { TerminalPanel } from "./components/TerminalPanel";
import { FilePanel } from "./components/FilePanel";
import { GitView } from "./components/GitView";
import { Hosts, Projects, Stats } from "./components/Views";
import { ApprovalModal } from "./components/ApprovalModal";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Splitter, useStoredSize } from "./components/Splitter";
import { CollapsedPane } from "./components/CollapsedPane";
import { ChatIcon, FilesIcon, ListIcon, TerminalIcon } from "./components/Icons";
import { Settings } from "./components/Settings";
import { Guide } from "./components/Guide";
import { Notes } from "./components/Notes";
import { Memory } from "./components/Memory";
import { Persona } from "./components/Persona";
import { ScenePage } from "./components/ScenePage";
import { requestTerminalAdopt, requestTerminalAt } from "./terminal-events";
import { THEMES, isDarkTheme, resolveTheme } from "./themes";

type View = "workspace" | "scene" | "projects" | "stats" | "hosts" | "git" | "settings" | "guide" | "notes" | "knowledge" | "memory" | "persona";
type PaneId = "todo" | "chat" | "terminal" | "files";
const COLLAPSED_PANE_W = 34;

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [todoAll, setTodoAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingContext, setPendingContext] = useState<ElementContext | null>(null);
  const [notesOpenReq, setNotesOpenReq] = useState<{ path: string; n: number } | null>(null);
  const [guidePage, setGuidePage] = useState("home");
  const [now, setNow] = useState(Date.now());
  const [todoW, setTodoW] = useStoredSize("cmh.layout.todoW", 220, 180, 520);
  const [chatW, setChatW] = useStoredSize("cmh.layout.chatW", 300, 220, 700);
  const [filesW, setFilesW] = useStoredSize("cmh.layout.filesW", 280, 180, 640);
  const [focusedPane, setFocusedPane] = useState<PaneId | null>(null);
  const [collapsed, setCollapsed] = useState<Record<PaneId, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("cmh.layout.collapsed") || "{}");
      return { todo: !!raw.todo, chat: !!raw.chat, terminal: !!raw.terminal, files: !!raw.files };
    } catch {
      return { todo: false, chat: false, terminal: false, files: false };
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cmh.layout.collapsed", JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    const reset = () => setCollapsed({ todo: false, chat: false, terminal: false, files: false });
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
  const togglePane = useCallback((id: PaneId) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  // 工作区焦点：指针进入某个 pane 后记住它，用于主次降噪。
  const markFocusedPane = useCallback((e: React.SyntheticEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".todo-pane,.chat-pane,.terminal-pane,.files-pane");
    const next = el?.classList.contains("todo-pane") ? "todo"
      : el?.classList.contains("chat-pane") ? "chat"
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

  // 「问清楚」/ 统计失败下钻都要落到 Chat：面板被收起时先展开，否则草稿写进不存在的输入框
  useEffect(() => {
    const onFocusChat = () => setCollapsed((current) => (current.chat ? { ...current, chat: false } : current));
    window.addEventListener("harness:focus-chat", onFocusChat);
    return () => window.removeEventListener("harness:focus-chat", onFocusChat);
  }, []);

  // 拖拽时按窗口宽度限制，避免把中间/右侧面板挤出可视区。
  const resizeTodo = useCallback((d: number) => {
    setTodoW((w) => Math.min(w + d, Math.max(180, window.innerWidth - 378 - chatW - filesW)));
  }, [setTodoW, chatW, filesW]);
  const resizeChat = useCallback((d: number) => {
    setChatW((w) => Math.min(w + d, Math.max(220, window.innerWidth - 378 - todoW - filesW)));
  }, [setChatW, todoW, filesW]);
  const resizeFiles = useCallback((d: number) => {
    setFilesW((w) => Math.min(w - d, Math.max(180, window.innerWidth - 378 - todoW - chatW)));
  }, [setFilesW, todoW, chatW]);

  useEffect(() => {
    window.harness.getState().then((s) => {
      setState(s);
      setThreadId((prev) => prev ?? s.threads.find((t) => !t.todoId)?.id ?? s.threads[0]?.id ?? null);
      const dv = s.settings?.defaultView;
      if (dv === "workspace" || dv === "projects" || dv === "stats" || dv === "hosts") setView(dv);
    });
    const off = window.harness.onState(setState);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { off(); clearInterval(t); };
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

  const act = useCallback(async (type: string, payload?: unknown) => {
    try {
      const r = await window.harness.action(type, payload);
      return r.result;
    } catch (e) {
      notify(String((e as Error)?.message || e));
      return null;
    }
  }, [notify]);

  useEffect(() => {
    const onDraft = (detail: { text?: string }) => {
      if (!detail?.text) return;
      setView("workspace");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail })), 100);
    };
    const onNotify = (detail: { message?: string }) => {
      if (detail?.message) notify(detail.message);
    };
    const onPluginView = (detail: { id?: string }) => {
      if (detail?.id === "notes") setView("notes");
    };
    const offDraft = window.harness.onPluginChatDraft(onDraft);
    const offNotify = window.harness.onPluginNotify(onNotify);
    const offView = window.harness.onPluginOpenView(onPluginView);
    return () => { offDraft(); offNotify(); offView(); };
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
    const runs = state.runs.filter((r) => ids.has(r.todoId));
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
  // 文件预览跟随任务的真实工作目录（run 的 worktree 优先），否则看不到 agent 的改动
  const workdir = useMemo(() => {
    if (!state) return "";
    if (!selected) return state.projectPath;
    const runs = state.runs.filter((r) => r.todoId === selected.id);
    const running = runs.find((r) => ["running", "waiting_input"].includes(r.status) && r.cwd);
    const latest = [...runs].reverse().find((r) => r.cwd);
    return running?.cwd || latest?.cwd || selected.cwd || state.projectPath;
  }, [state, selected]);
  const projectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of state?.todos ?? []) if (t.projectId && t.kind !== "chat") counts[t.projectId] = (counts[t.projectId] ?? 0) + 1;
    return counts;
  }, [state?.todos]);
  const notesEnabled = Boolean(state?.plugins?.find((p) => p.id === "ai.cockpit.notes")?.enabled);

  const selectTodo = useCallback(async (todoId: string) => {
    const todo = state?.todos.find((t) => t.id === todoId);
    if (todo?.projectId && todo.projectId !== state?.activeProjectId) {
      await act("switchProject", { id: todo.projectId });
    }
    const t = state?.threads.find((x) => x.todoId === todoId);
    if (t) { setThreadId(t.id); setView("workspace"); }
  }, [state, act]);

  useEffect(() => {
    if (!state) return;
    const threads = state.threads.filter((t) => !t.todoId || !t.projectId || t.projectId === state.activeProjectId);
    setThreadId((prev) => {
      if (threads.some((t) => t.id === prev)) return prev;
      return threads.find((t) => !t.todoId)?.id ?? threads[0]?.id ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.activeProjectId]);

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
    const onToast = (e: Event) => {
      const message = String((e as CustomEvent).detail || "");
      if (message) notify(message);
    };
    window.addEventListener("harness:toast", onToast);
    return () => window.removeEventListener("harness:toast", onToast);
  }, [notify]);

  useEffect(() => {
    const onView = (e: Event) => {
      const detail = (e as CustomEvent<string | { view?: string; page?: string }>).detail;
      const next = typeof detail === "string" ? detail : detail?.view;
      if (!next || !["workspace", "scene", "projects", "stats", "hosts", "settings", "guide", "notes"].includes(next)) return;
      if (next === "guide" && typeof detail === "object" && detail?.page) setGuidePage(detail.page);
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
    if (p?.name) { notify(`已添加项目：${p.name}`); setView("workspace"); }
  }, [act, notify]);

  const switchProject = useCallback(async (id: string) => {
    await act("switchProject", { id });
    setView("workspace");
  }, [act]);

  const newTaskInProject = useCallback(async (id: string) => {
    if (id !== state?.activeProjectId) await switchProject(id);
    else setView("workspace");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:new-task")), 120);
  }, [state?.activeProjectId, switchProject]);

  const newThread = useCallback(async () => {
    // 新对话默认全局；需要项目作用域时在 Chat 的「作用域」里选
    const t = await act("newThread", {}) as { id?: string } | null;
    if (t?.id) { setThreadId(t.id); setView("workspace"); }
  }, [act]);

  const startMission = useCallback(async () => {
    let supervisor = state?.agents.find((a) => a.role === "supervisor" && a.chatRunnable !== false) ?? null;
    if (!supervisor) supervisor = await act("createAgent", { cli: "dsh", role: "supervisor" }) as typeof supervisor;
    const hasWorker = state?.agents.some((a) => (a.role || "worker") !== "supervisor" && a.chatRunnable !== false);
    if (!hasWorker) await act("createAgent", { cli: "dsh", role: "worker" });
    const thread = await act("newThread", {}) as { id?: string } | null;
    if (thread?.id && supervisor?.id) await act("setThreadAgent", { threadId: thread.id, agentId: supervisor.id });
    if (thread?.id) setThreadId(thread.id);
    setView("workspace");
  }, [state, act]);

  const dispatchInWorkspace = useCallback((makeEvent: () => Event) => {
    setView("workspace");
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
    setView("workspace");
  }, [state, act]);

  const openThreadFromPalette = useCallback(async (threadId: string) => {
    const thread = state?.threads.find((t) => t.id === threadId);
    if (!thread) return;
    if (thread.projectId && thread.projectId !== state?.activeProjectId) {
      await act("switchProject", { id: thread.projectId });
    }
    setThreadId(thread.id);
    setView("workspace");
  }, [state, act]);

  const commands: Command[] = useMemo(() => {
    if (!state) return [];
    const list: Command[] = [
      { id: "view-workspace", label: "工作区", hint: "⌘1", group: "导航", run: () => setView("workspace") },
      { id: "view-scene", label: "场景", group: "导航", run: () => setView("scene") },
      { id: "view-projects", label: "项目", group: "导航", run: () => setView("projects") },
      { id: "view-stats", label: "统计", group: "导航", run: () => setView("stats") },
      { id: "view-hosts", label: "主机", group: "导航", run: () => setView("hosts") },
      { id: "view-git", label: "Git / 源码管理", group: "导航", run: () => setView("git") },
      { id: "view-knowledge", label: "资料（知识库 → 文档）", group: "导航", run: () => setView("knowledge") },
      { id: "view-memory", label: "记忆（四层 / Dream）", group: "导航", run: () => setView("memory") },
      { id: "view-persona", label: "人像（画像 / 决策辅助）", group: "导航", run: () => setView("persona") },
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
  }, [state?.projects, state?.todos, state?.threads, state?.activeProjectId, newThread, dispatchInWorkspace, openTodoFromPalette, openThreadFromPalette, addProject, switchProject, act]);

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
      if (view === "workspace") { window.dispatchEvent(make()); return; }
      setView("workspace");
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

  if (!state) return <div className="boot">启动中…</div>;

  const railBadges = {
    workspace: state.runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length,
    hosts: state.hosts.filter((h) => h.status === "offline").length,
  };

  // 终端默认吃掉剩余宽度；终端收起时，由仍展开的最右侧面板吃掉剩余宽度。
  const flexPane: PaneId | null = !collapsed.terminal ? "terminal" : !collapsed.files ? "files" : !collapsed.chat ? "chat" : !collapsed.todo ? "todo" : null;
  const paneCol = (id: PaneId, width: number, min: number) =>
    collapsed[id] ? `${COLLAPSED_PANE_W}px` : flexPane === id ? `minmax(${min}px, 1fr)` : `${width}px`;
  const todoCol = paneCol("todo", todoW, 180);
  const chatCol = paneCol("chat", chatW, 220);
  const terminalCol = collapsed.terminal ? `${COLLAPSED_PANE_W}px` : "minmax(280px, 1fr)";
  const filesCol = paneCol("files", filesW, 180);
  const sep1 = !collapsed.todo && !collapsed.chat ? "6px" : "0px";
  const sep2 = !collapsed.chat && !collapsed.terminal ? "6px" : "0px";
  const sep3 = !collapsed.terminal && !collapsed.files ? "6px" : "0px";
  const gridCols = `64px ${todoCol} ${sep1} ${chatCol} ${sep2} ${terminalCol} ${sep3} ${filesCol}`;

  return (
    <div className="app">
      <div className={`main pane-focus-${focusedPane ?? "none"}`} style={{ gridTemplateColumns: gridCols }} onPointerDownCapture={markFocusedPane} onFocusCapture={markFocusedPane}>
        <Rail view={view} notesEnabled={notesEnabled} badges={railBadges} onChange={(v) => setView(v)} />
        {/* 工作区始终挂载、只切显隐：切到项目/统计再回来时，终端 pty、标签、滚动位置都不能丢 */}
        {scoped && (
          <div className="workspace-view" style={{ display: view === "workspace" ? "contents" : "none" }}>
          <>
            {collapsed.todo ? (
              <CollapsedPane label="TODO" title="TODO 列表" icon={<ListIcon size={16} />} onExpand={() => togglePane("todo")} />
            ) : (
              <TaskPane
                state={todoAll ? state : scoped}
                selectedId={selected?.id ?? null}
                now={now}
                act={act}
                onSelect={selectTodo}
                projectCounts={projectCounts}
                onAddProject={() => void addProject()}
                onManageProjects={() => setView("projects")}
                onSwitchProject={(id) => void switchProject(id)}
                onCollapse={() => togglePane("todo")}
                confirmStop={state.settings?.confirmStop}
                allProjects={todoAll}
                onToggleScope={() => setTodoAll((v) => !v)}
              />
            )}
            {sep1 === "6px" ? <Splitter onDelta={resizeTodo} /> : <div className="splitter-off" />}
            {collapsed.chat ? (
              <CollapsedPane label="CHAT" title="Chat" icon={<ChatIcon size={16} />} onExpand={() => togglePane("chat")} />
            ) : (
              <TaskChat state={scoped} globalState={state} thread={thread} threads={scoped.threads} now={now} act={act} onSelect={selectTodo} onOpenGlobal={(id) => void openTodoFromPalette(id)} onNewThread={() => void newThread()} onOpenThread={(id) => { setThreadId(id); setView("workspace"); }} context={pendingContext} onClearContext={() => setPendingContext(null)} onCollapse={() => togglePane("chat")} enterToSend={state.settings?.enterToSend ?? true} confirmStop={state.settings?.confirmStop ?? false} />
            )}
            {sep2 === "6px" ? <Splitter onDelta={resizeChat} /> : <div className="splitter-off" />}
            {/* 收起只隐藏不卸载：保住 pty / 标签 / 文件预览；展开后 ResizeObserver 会重新 fit */}
            <div className="terminal-slot">
              <div className="terminal-slot-main" style={{ display: collapsed.terminal ? "none" : "flex" }}>
                <TerminalPanel state={state} todo={selected} onOpenProject={() => void addProject()} onPickedContext={setPendingContext} previewRoot={workdir} onCollapse={() => togglePane("terminal")} terminalFontSize={state.settings?.terminalFontSize} terminalScrollback={state.settings?.terminalScrollback} previewHomeUrl={state.settings?.previewHomeUrl} />
              </div>
              {collapsed.terminal && (
                <CollapsedPane label="TERM" title="终端" icon={<TerminalIcon size={16} />} onExpand={() => togglePane("terminal")} />
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
                onSelectThread={(id) => { setThreadId(id); setView("workspace"); }}
                onCollapse={() => togglePane("files")}
              />
            )}
          </>
          </div>
        )}
        {view === "scene" && <div className="wide"><ScenePage state={state} act={act} notify={notify} onOpenProject={(id) => void switchProject(id)} onOpenTerminal={(cwd) => { setView("workspace"); window.setTimeout(() => requestTerminalAt(cwd), 90); }} /></div>}
        {view === "projects" && <div className="wide"><Projects state={state} now={now} act={act} notify={notify} onAdd={() => void addProject()} onSwitch={(id) => void switchProject(id)} onNewTask={(id) => void newTaskInProject(id)} /></div>}
        {view === "stats" && scoped && <div className="wide"><Stats state={state} onOpen={(id) => void openTodoFromPalette(id)} /></div>}
        {view === "hosts" && <div className="wide"><Hosts state={state} act={act} notify={notify} now={now} /></div>}
        {view === "git" && <div className="wide"><GitView state={state} notify={notify} /></div>}
        {view === "settings" && <div className="wide settings-wide"><Settings state={state} act={act} notify={notify} /></div>}
        {view === "guide" && <div className="wide guide-wiki-wide"><Guide pageId={guidePage} /></div>}
        {view === "notes" && <div className="wide"><Notes state={state} act={act} onOpenTodo={selectTodo} openRequest={notesOpenReq} /></div>}
        {view === "knowledge" && <div className="wide"><Notes state={state} act={act} onOpenTodo={selectTodo} openRequest={notesOpenReq} initialTab="docs" /></div>}
        {view === "memory" && <div className="wide"><Memory act={act} /></div>}
        {view === "persona" && <div className="wide"><Persona act={act} /></div>}
      </div>

      <CommandPalette open={paletteOpen} state={state} onClose={() => setPaletteOpen(false)} commands={commands} />
      {state.approvals?.length > 0 && <ApprovalModal approval={state.approvals[0]} pendingCount={state.approvals.length} act={act} />}      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
