import { useCallback, useEffect, useMemo, useState } from "react";
import type { ElementContext, State } from "./types";
import { Rail } from "./components/Rail";
import { TaskPane } from "./components/TaskPane";
import { TaskChat } from "./components/TaskChat";
import { TerminalPanel } from "./components/TerminalPanel";
import { FilePanel } from "./components/FilePanel";
import { Hosts, Projects, Stats } from "./components/Views";
import { ApprovalModal } from "./components/ApprovalModal";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Splitter, useStoredSize } from "./components/Splitter";
import { CollapsedPane } from "./components/CollapsedPane";
import { ChatIcon, FilesIcon, ListIcon, TerminalIcon } from "./components/Icons";
import { Settings } from "./components/Settings";

type View = "workspace" | "projects" | "stats" | "hosts" | "settings";
type PaneId = "todo" | "chat" | "terminal" | "files";
const COLLAPSED_PANE_W = 34;

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingContext, setPendingContext] = useState<ElementContext | null>(null);
  const [now, setNow] = useState(Date.now());
  const [todoW, setTodoW] = useStoredSize("ymh.layout.todoW", 220, 180, 520);
  const [chatW, setChatW] = useStoredSize("ymh.layout.chatW", 300, 220, 700);
  const [filesW, setFilesW] = useStoredSize("ymh.layout.filesW", 280, 180, 640);
  const [collapsed, setCollapsed] = useState<Record<PaneId, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("ymh.layout.collapsed") || "{}");
      return { todo: !!raw.todo, chat: !!raw.chat, terminal: !!raw.terminal, files: !!raw.files };
    } catch {
      return { todo: false, chat: false, terminal: false, files: false };
    }
  });
  useEffect(() => {
    try { localStorage.setItem("ymh.layout.collapsed", JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    const reset = () => setCollapsed({ todo: false, chat: false, terminal: false, files: false });
    window.addEventListener("harness:reset-layout", reset);
    return () => window.removeEventListener("harness:reset-layout", reset);
  }, []);
  const togglePane = useCallback((id: PaneId) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  // 拖拽时按窗口宽度限制，避免把中间/右侧面板挤出可视区。
  const resizeTodo = useCallback((d: number) => {
    setTodoW((w) => Math.min(w + d, Math.max(180, window.innerWidth - 362 - chatW - filesW)));
  }, [setTodoW, chatW, filesW]);
  const resizeChat = useCallback((d: number) => {
    setChatW((w) => Math.min(w + d, Math.max(220, window.innerWidth - 362 - todoW - filesW)));
  }, [setChatW, todoW, filesW]);
  const resizeFiles = useCallback((d: number) => {
    setFilesW((w) => Math.min(w - d, Math.max(180, window.innerWidth - 362 - todoW - chatW)));
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

  // 主题：light / dark / system（跟随系统时监听媒体查询）
  useEffect(() => {
    const mode = state?.settings?.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mode === "dark" || (mode === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
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

  const scoped = useMemo(() => {
    if (!state) return null;
    const pid = state.activeProjectId;
    if (!pid) return state;
    const todos = state.todos.filter((t) => t.projectId === pid);
    const ids = new Set(todos.map((t) => t.id));
    const agents = state.agents.filter((a) => !a.projectId || a.projectId === pid);
    const threads = state.threads.filter((t) => !t.projectId || t.projectId === pid);
    const tids = new Set(threads.map((t) => t.id));
    const runs = state.runs.filter((r) => ids.has(r.todoId));
    return {
      ...state,
      todos, runs, threads, agents,
      messages: state.messages.filter((m) => tids.has(m.threadId)),
      artifacts: state.artifacts.filter((a) => ids.has(a.todoId)),
      inbox: state.inbox.filter((i) => ids.has(i.todoId)),
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
    for (const t of state?.todos ?? []) if (t.projectId) counts[t.projectId] = (counts[t.projectId] ?? 0) + 1;
    return counts;
  }, [state?.todos]);
  const unread = scoped?.inbox.filter((i) => !i.read).length ?? 0;

  const selectTodo = useCallback((todoId: string) => {
    const t = state?.threads.find((x) => x.todoId === todoId);
    if (t) { setThreadId(t.id); setView("workspace"); }
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const threads = state.threads.filter((t) => !t.projectId || t.projectId === state.activeProjectId);
    setThreadId((prev) => {
      if (threads.some((t) => t.id === prev)) return prev;
      return threads.find((t) => !t.todoId)?.id ?? threads[0]?.id ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.activeProjectId]);

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

  const newThread = useCallback(async () => {
    const t = await act("newThread", { projectId: state?.activeProjectId }) as { id?: string } | null;
    if (t?.id) { setThreadId(t.id); setView("workspace"); }
  }, [act, state?.activeProjectId]);

  const commands: Command[] = useMemo(() => {
    if (!state) return [];
    const list: Command[] = [
      { id: "view-workspace", label: "前往：工作区", hint: "⌘1", run: () => setView("workspace") },
      { id: "view-projects", label: "前往：项目", run: () => setView("projects") },
      { id: "view-stats", label: "前往：统计", run: () => setView("stats") },
      { id: "view-hosts", label: "前往：主机", run: () => setView("hosts") },
      { id: "new-thread", label: "新建会话 / 任务", hint: "⌘N", run: () => void newThread() },
      { id: "new-terminal", label: "新建终端", hint: "⌘T", run: () => window.dispatchEvent(new Event("harness:new-terminal")) },
      { id: "close-terminal", label: "关闭当前终端", hint: "⌘W", run: () => window.dispatchEvent(new Event("harness:close-terminal")) },
      { id: "open-project", label: "打开 / 添加项目…", hint: "⌘P", run: () => void addProject() },
      { id: "open-settings", label: "打开设置", hint: "⌘,", run: () => setView("settings") },
      { id: "reset-layout", label: "重置面板宽度 / 高度", hint: "拖拽分隔条可自由调整", run: () => window.dispatchEvent(new Event("harness:reset-layout")) },
    ];
    for (const p of state.projects) {
      list.push({ id: `switch-${p.id}`, label: `切换项目：${p.name}`, hint: p.path, run: () => void switchProject(p.id) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.projects, newThread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); window.dispatchEvent(new Event("harness:new-terminal")); return; }
      if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); window.dispatchEvent(new Event("harness:close-terminal")); return; }
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); void addProject(); return; }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void newThread(); return; }
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
  }, [state?.projects, scoped?.threads, threadId, paletteOpen]);

  if (!state) return <div className="boot">正在启动本地控制面…</div>;

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
      <div className="main" style={{ gridTemplateColumns: gridCols }}>
        <Rail view={view} inboxUnread={unread} onChange={(v) => setView(v)} />
        {view === "workspace" && scoped && (
          <>
            {collapsed.todo ? (
              <CollapsedPane label="TODO" title="TODO 列表" icon={<ListIcon size={16} />} onExpand={() => togglePane("todo")} />
            ) : (
              <TaskPane
                state={scoped}
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
              />
            )}
            {sep1 === "6px" ? <Splitter onDelta={resizeTodo} title="拖拽调整 TODO 列宽度" /> : <div className="splitter-off" />}
            {collapsed.chat ? (
              <CollapsedPane label="CHAT" title="Chat" icon={<ChatIcon size={16} />} onExpand={() => togglePane("chat")} />
            ) : (
              <TaskChat state={scoped} thread={thread} now={now} act={act} onSelect={selectTodo} onNewThread={() => void newThread()} context={pendingContext} onClearContext={() => setPendingContext(null)} onCollapse={() => togglePane("chat")} enterToSend={state.settings?.enterToSend ?? true} confirmStop={state.settings?.confirmStop ?? false} />
            )}
            {sep2 === "6px" ? <Splitter onDelta={resizeChat} title="拖拽调整 Chat 列宽度" /> : <div className="splitter-off" />}
            {collapsed.terminal ? (
              <CollapsedPane label="TERM" title="终端" icon={<TerminalIcon size={16} />} onExpand={() => togglePane("terminal")} />
            ) : (
              <TerminalPanel state={state} todo={selected} onOpenProject={() => void addProject()} onPickedContext={setPendingContext} previewRoot={workdir} onCollapse={() => togglePane("terminal")} terminalFontSize={state.settings?.terminalFontSize} terminalScrollback={state.settings?.terminalScrollback} previewHomeUrl={state.settings?.previewHomeUrl} />
            )}
            {sep3 === "6px" ? <Splitter onDelta={resizeFiles} title="拖拽调整文件列宽度" /> : <div className="splitter-off" />}
            {collapsed.files ? (
              <CollapsedPane label="文件" title="文件 / 会话" icon={<FilesIcon size={16} />} onExpand={() => togglePane("files")} />
            ) : (
              <FilePanel
                state={scoped}
                root={workdir}
                now={now}
                onSelectThread={(id) => { setThreadId(id); setView("workspace"); }}
                onCollapse={() => togglePane("files")}
              />
            )}
          </>
        )}
        {view === "projects" && <div className="wide"><Projects state={state} now={now} act={act} notify={notify} onAdd={() => void addProject()} onSwitch={(id) => void switchProject(id)} /></div>}
        {view === "stats" && scoped && <div className="wide"><Stats state={scoped} /></div>}
        {view === "hosts" && <div className="wide"><Hosts state={state} act={act} notify={notify} /></div>}
        {view === "settings" && <div className="wide settings-wide"><Settings state={state} act={act} notify={notify} /></div>}
      </div>

      <CommandPalette open={paletteOpen} state={state} onClose={() => setPaletteOpen(false)} commands={commands} />
      {state.approvals?.length > 0 && <ApprovalModal approval={state.approvals[0]} act={act} />}      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
