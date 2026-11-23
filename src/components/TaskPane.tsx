import { useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "./ConfirmHost";
import { UndoBar, type UndoAction } from "./UndoBar";
import { createPortal } from "react-dom";
import type { State, Todo, TodoStatus } from "../types";
import { STATUS, activeRun, agentOf, duration, lastRun } from "../ui";
import { Splitter, useStoredSize } from "./Splitter";
import {
  ChevronDownIcon, ChevronRightIcon, EllipsisIcon, FolderPlusIcon,
  PanelCollapseIcon, PanelExpandIcon, PanelRestoreIcon, PlusIcon, SearchIcon, SlidersIcon, XIcon,
} from "./Icons";
import { ListContextMenu } from "./ListContextMenu";
import { RowMenu } from "./RowMenu";
import { requestTerminalAt } from "../terminal-events";
import { assignmentsForBot } from "../selectors/assignments";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Filter = "all" | "needs" | "active" | "review" | "confirmed";

const GROUPS: { id: string; label: string; statuses: TodoStatus[] }[] = [
  { id: "todo", label: "待执行", statuses: ["todo"] },
  { id: "active", label: "进行中", statuses: ["queued", "in_progress", "waiting_input"] },
  { id: "review", label: "待确认", statuses: ["in_review"] },
  { id: "done", label: "已完成", statuses: ["done"] },
];

function TaskPlan({ items, expanded }: { items: Todo["subtasks"]; expanded: boolean }) {
  const done = items.filter((s) => s.status === "done").length;
  const current = items.find((s) => s.status === "in_progress");
  const shown = expanded ? items : current ? [current] : [];
  return (
    <div className="task-plan">
      <div className="task-plan-head tiny">
        <span className="muted">Agent 计划</span>
        <span className="mono faint">{done}/{items.length}</span>
      </div>
      {shown.length > 0 && (
        <ul className="task-plan-list">
          {shown.map((s) => (
            <li key={s.id} className={`task-plan-step st-${s.status}`}>
              <span className="task-plan-glyph">{s.status === "done" ? "✓" : s.status === "in_progress" ? "◐" : s.status === "cancelled" ? "✕" : "○"}</span>
              <span className="ellipsis" title={s.title}>{s.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskPane({ mode = "bot", state, selectedId, now, act, onSelect, projectCounts, onAddProject, onManageProjects, onSwitchProject, onCollapse, confirmStop = false, allProjects = false, onToggleScope, maximized = false, onToggleMaximize, onOpenBot, onManageBots, botUnread = 0, activeBotId = null }: {
  /** BOT 模式：机器人列表 + 它接的活；工作台模式：项目列表 + TODO 总览 */
  mode?: "bot" | "terminal";
  state: State; selectedId: string | null; now: number; act: Act; onSelect: (id: string) => void;
  projectCounts: Record<string, number>;
  onAddProject: () => void; onManageProjects: () => void; onSwitchProject: (id: string) => void;
  onCollapse?: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  confirmStop?: boolean;
  allProjects?: boolean;
  onToggleScope?: () => void;
  /** 预览里拾取的元素上下文：随下一次派活发出去 */
  /** 机器人：点一行 = 打开它那条会话；管理进机器人控制台 */
  onOpenBot?: (botId: string) => void;
  onManageBots?: () => void;
  botUnread?: number;
  activeBotId?: string | null;
}) {
  /** 左栏顶部：等批准的计划（审批只在终端 —— 原型 owner-workspaces.html） */
  const missionsNeedingPlan = useMemo(() => {
    const plans = state.missionPlans ?? [];
    return (state.todos ?? []).filter((t) => {
      if (t.kind !== "mission") return false;
      if (!["plan_review", "planning"].includes(t.missionState ?? "")) return false;
      const latest = [...plans].filter((p) => p.missionId === t.id).sort((a, b) => b.revision - a.revision)[0];
      return latest?.status === "draft";
    });
  }, [state.todos, state.missionPlans]);
  const [rejecting, setRejecting] = useState<{ id: string; text: string } | null>(null);
  /** 切布局：看板需要宽度，窄栏里展不开 —— 选中看板时自动最大化，切回列表时再还原 */
  const autoMaxed = useRef(false);
  const chooseLayout = (next: "list" | "board") => {
    setLayout(next);
    if (next === "board" && !maximized) {
      autoMaxed.current = true;
      onToggleMaximize?.();
    } else if (next === "list" && autoMaxed.current && maximized) {
      autoMaxed.current = false;
      onToggleMaximize?.();
    }
  };

  /** 项目右键菜单：对话入口只留一条 —— 把项目交给机器人 */
  /** 项目面板的视图设置：分组 / 排序 / 显示 / 筛选（照 ORCA 的侧栏设置浮层） */
  type ProjectView = { sort: "manual" | "recent" | "name"; hideNoTask: boolean };
  const [projectView, setProjectView] = useState<ProjectView>(() => {
    // v2：默认「固定顺序」；旧 v1 的 recent 不再沿用（点一下项目整列就重排，体验很糟）
    const base: ProjectView = { sort: "manual", hideNoTask: false };
    try {
      const saved = JSON.parse(localStorage.getItem("cmh.projects.view.v2") || "{}") as Partial<ProjectView>;
      return { ...base, ...saved };
    } catch { return base; }
  });
  useEffect(() => { try { localStorage.setItem("cmh.projects.view.v2", JSON.stringify(projectView)); } catch { /* ignore */ } }, [projectView]);
  const [projectViewMenu, setProjectViewMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!projectViewMenu) return;
    const close = () => setProjectViewMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [projectViewMenu]);

  const [projectMenu, setProjectMenu] = useState<{ at: { x: number; y: number }; projectId: string } | null>(null);
  const menuProject = projectMenu ? state.projects.find((p) => p.id === projectMenu.projectId) ?? null : null;
  /** 交给谁：优先主管档机器人，其次第一个可用的；纯只读档也能"聊"，只是不能起任务 */
  const handoffBot = useMemo(() => {
    const bots = state.bots ?? [];
    return bots.find((b) => b.role === "supervisor" && b.status !== "paused")
      ?? bots.find((b) => b.status !== "paused")
      ?? null;
  }, [state.bots]);
  /** 可选的机器人：默认的先给一条，其余进「交给 <名字>」，最多 4 个入口 */
  const handoffChoices = useMemo(() => {
    const bots = (state.bots ?? []).filter((b) => b.status !== "paused");
    if (!handoffBot) return [];
    return [handoffBot, ...bots.filter((b) => b.id !== handoffBot.id)].slice(0, 4);
  }, [state.bots, handoffBot]);
  const handoffTo = (botId: string, name: string) => {
    if (!menuProject) return;
    // 真交接：写 bots.project_id + 一条工作区关系；不切当前项目、不抢视图
    void act("botHandOffWorkspace", {
      botId, projectId: menuProject.id, path: menuProject.path,
      title: menuProject.name, kind: "project", projectRoot: true,
    }).then((r) => {
      window.dispatchEvent(new CustomEvent("harness:toast", { detail: { message: r?.ok ? `${name} 接手了「${menuProject.name}」` : "交接失败" } }));
    }).catch((err) => {
      window.dispatchEvent(new CustomEvent("harness:toast", { detail: { message: `交接失败：${String((err as Error)?.message || err)}` } }));
    });
  };

  const [query, setQuery] = useState("");
  /** 一个搜索框同时管「项目」和「任务」（DESIGN-SYSTEM §5 一行 chrome） */
  const searching = query.trim().length > 0;
  const needle = query.trim().toLowerCase();
  const visibleProjects = state.projects
    // 搜索时不理会「隐藏没有任务的项目」：搜到了就得显示，否则像搜不到
    .filter((p) => searching ? (p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle)) : (!projectView.hideNoTask || (projectCounts[p.id] ?? 0) > 0))
    .slice()
    .sort((a, b) => {
      if (projectView.sort === "name") return a.name.localeCompare(b.name);
      if (projectView.sort === "recent") return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || a.name.localeCompare(b.name);
      return 0; // manual：沿用 state.projects 的顺序，点谁都不动
    });
  const [editing, setEditing] = useState<{ id: string; title: string; desc: string; acceptance: string; priority: string; due: string; tags: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const createRef = useRef<HTMLTextAreaElement | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
  const [layout, setLayout] = useState<"list" | "board">(() => {
    try { return localStorage.getItem("cmh.todo.layout") === "board" ? "board" : "list"; } catch { return "list"; }
  });
  const [broadcastFor, setBroadcastFor] = useState<Todo | null>(null);
  const [broadcastPick, setBroadcastPick] = useState<string[]>([]);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  /** 删除任务后的撤销条：挂在 pane 根上，行被删掉也不会跟着卸载 */
  const [undo, setUndo] = useState<UndoAction | null>(null);
  useEffect(() => { try { localStorage.setItem("cmh.todo.layout", layout); } catch { /* ignore */ } }, [layout]);
  const [projectH, setProjectH] = useStoredSize("cmh.layout.projectH", 150, 80, 420);
  const [projectCollapsed, setProjectCollapsed] = useState(() => {
    try { return localStorage.getItem("cmh.layout.projectDock.collapsed") !== "0"; } catch { return true; }
  });
  // TODO 段折叠：只收起列表，不把整个 pane 收成 rail
  // 机器人段：项目上面，可折叠（和项目区一样记住上次状态）
  const [botsCollapsed, setBotsCollapsed] = useState(() => {
    try { return localStorage.getItem("cmh.layout.botsCollapsed") === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("cmh.layout.botsCollapsed", botsCollapsed ? "1" : "0"); } catch { /* ignore */ } }, [botsCollapsed]);
  useEffect(() => {
    try { localStorage.setItem("cmh.layout.projectCollapsed", projectCollapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [projectCollapsed]);
  /** 任务段折叠：只收起筛选 + 列表，段头（任务 / 搜索 / ＋）留在原位 */
  const [tasksFolded, setTasksFolded] = useState(() => {
    try { return localStorage.getItem("cmh.layout.tasksFolded") === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("cmh.layout.tasksFolded", tasksFolded ? "1" : "0"); } catch { /* ignore */ } }, [tasksFolded]);
  useEffect(() => {
    const reset = () => { setProjectCollapsed(false); setTasksFolded(false); };
    window.addEventListener("harness:reset-layout", reset);
    return () => window.removeEventListener("harness:reset-layout", reset);
  }, []);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ⌘K →「编辑当前任务」/ ⌘E：由 App 派发事件，这里负责找到行并进入编辑
  useEffect(() => {
    const onEdit = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail || selectedId;
      const todo = id ? state.todos.find((t) => t.id === id) : null;
      if (todo) startEdit(todo);
    };
    window.addEventListener("harness:edit-todo", onEdit);
    return () => window.removeEventListener("harness:edit-todo", onEdit);
  }, [state.todos, selectedId]);

  useEffect(() => {
    const onNew = () => { setLayout("list"); setTasksFolded(false); setCreating(true); window.setTimeout(() => createRef.current?.focus(), 0); };
    window.addEventListener("harness:new-task", onNew);
    return () => window.removeEventListener("harness:new-task", onNew);
  }, []);

  // 标题 / 描述 / 验收 / 优先级 / 截止 / 标签就地编辑：Enter 保存、Esc 取消
  const startEdit = (t: Todo) => setEditing({
    id: t.id, title: t.title, desc: t.desc || "",
    acceptance: (t.acceptance || []).join("\n"), priority: t.priority || "P2",
    due: t.due || "", tags: (t.tags || []).join(", "),
  });
  const saveEdit = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    if (!title) { setEditing(null); return; }
    const next = { ...editing };
    setEditing(null);
    await act("updateTodo", {
      id: next.id, title, desc: next.desc,
      acceptance: next.acceptance.split("\n").map((x) => x.trim()).filter(Boolean),
      priority: next.priority, due: next.due,
      tags: next.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.todos.filter((t) => {
      if (t.kind === "chat") return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)
        && !(t.desc || "").toLowerCase().includes(q)
        && !(t.tags || []).some((tag) => tag.toLowerCase().includes(q))) return false;
      const run = lastRun(t, state.runs);
      const failed = t.lastRunFailed || run?.status === "failed";
      if (filter === "needs") return !t.confirmed && (t.status === "in_review" || t.status === "waiting_input" || failed || t.missingWriteback);
      if (filter === "active") return !t.confirmed && ["queued", "in_progress", "waiting_input"].includes(t.status);
      if (filter === "review") return t.status === "in_review" && !t.confirmed;
      if (filter === "confirmed") return t.confirmed || t.status === "done" || t.status === "cancelled";
      return true;
    });
  }, [state.todos, query, filter]);

  useEffect(() => {
    if (selectedId) rowRefs.current[selectedId]?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  // 收集箱：一行一条，⌘Enter 一次性全部变成任务（也可以只写一行）
  const captureLines = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of captureText.split("\n")) {
      const title = line.replace(/^\s*(?:[-*•—]|\d+[.)、]|\[\s?x?\])\s*/i, "").replace(/\s+/g, " ").trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      out.push(title);
    }
    return out;
  })();
  const createTasks = async () => {
    if (!captureLines.length) { setCreating(false); return; }
    const res = await act("createTodos", { text: captureText });
    setCaptureText("");
    setCreating(false);
    const first = res?.todos?.[0];
    if (first?.id) onSelect(first.id);
  };

  // 任务描述不清 → 带着预填问题跳到 Chat，先理清再动手
  const askInChat = (todo: Todo) => {
    const text = `先别动手，帮我把这个任务理清楚：${todo.title}\n${todo.desc ? `\n背景：${todo.desc}\n` : ""}\n需要确认：目标、验收标准、涉及哪些文件 / 模块。`;
    window.dispatchEvent(new Event("harness:focus-chat")); // Chat 收起时先展开
    onSelect(todo.id);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail: { todoId: todo.id, text } })), 90);
  };

  const itemsFor = (g: (typeof GROUPS)[number]) => {
    let items = visible.filter((t) => g.id === "done"
      ? (t.confirmed || t.status === "done" || t.status === "cancelled")
      : (!t.confirmed && g.statuses.includes(t.status)));
    if (g.id === "active") {
      const rank = (s: TodoStatus) => s === "waiting_input" ? 0 : s === "in_progress" ? 1 : 2;
      items = [...items].sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt - a.updatedAt);
    }
    return items;
  };
  const acpWorkers = state.agents.filter((a) => (a.role || "worker") !== "supervisor" && a.chatRunnable !== false);

  const openBroadcast = (todo: Todo) => {
    setBroadcastFor(todo);
    setBroadcastPick(acpWorkers.slice(0, 2).map((a) => a.id));
  };

  const startBroadcast = async () => {
    if (!broadcastFor || broadcastPick.length < 2) return;
    setBroadcastBusy(true);
    try {
      const res = await act("broadcast", { id: broadcastFor.id, agentIds: broadcastPick });
      if (res !== null) { setBroadcastFor(null); setBroadcastPick([]); }
    } finally { setBroadcastBusy(false); }
  };

  return (
    <aside className={`todo-pane mode-${mode}${tasksFolded ? " tasks-folded" : ""}${maximized ? " pane-max-target" : ""}`} tabIndex={0} aria-label="TODO 列表">
      <UndoBar action={undo} onDone={() => setUndo(null)} />
      <div className="task-tools">
        {/* 左栏只有一个搜索框：同时过滤下面两个列表（项目 / 任务） */}
        <div className="pane-search">
          <SearchIcon size={14} className="search-ico" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="搜索项目 / 任务…"
            aria-label="搜索项目与任务"
          />
          {searching && <button className="icon-btn" title="清除搜索" aria-label="清除搜索" onClick={() => setQuery("")}><XIcon size={11} /></button>}
        </div>
        <div className="task-search-row">
          {/* 状态筛选收成下拉：和范围 / 图标动作同一行（一个区域只有一行 chrome） */}
          <select className="task-filter-select" value={filter} title="按状态筛选" onChange={(e) => setFilter(e.target.value as Filter)}>
            {([["all", "全部"], ["needs", "待处理"], ["active", "进行中"], ["review", "待确认"], ["confirmed", "已完成"]] as [Filter, string][]).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          {onToggleScope && (
            <button className="task-scope" title="任务范围：只看当前项目 / 看所有项目" onClick={onToggleScope}>
              {allProjects ? "全部项目" : "本项目"}
            </button>
          )}
          <span className="spacer" />
          <div className="pane-actions">
            <button className="pane-add" title="收集想法 / 新建任务（一行一条，⌘⇧N）" aria-label="新建任务" onClick={() => { setLayout("list"); setTasksFolded(false); setCreating(true); window.setTimeout(() => createRef.current?.focus(), 0); }}><PlusIcon size={14} /></button>
            {onToggleMaximize && (
              <button className="pane-collapse" title={maximized ? "还原（Esc）" : "最大化"} aria-label={maximized ? "还原 TODO" : "最大化 TODO"} onClick={onToggleMaximize}>
                {maximized ? <PanelRestoreIcon size={14} /> : <PanelExpandIcon size={14} />}
              </button>
            )}
            {onCollapse && (
              <button className="pane-collapse" title="收起 TODO" aria-label="收起 TODO" onClick={onCollapse}>
                <PanelCollapseIcon size={14} />
              </button>
            )}
            <RowMenu title="任务视图">
              <label className="row-menu-label">视图
                <select value={layout} onChange={(e) => chooseLayout(e.target.value as "list" | "board")}>
                  <option value="list">列表</option>
                  <option value="board">看板</option>
                </select>
              </label>
            </RowMenu>
            <button
              className="pane-collapse"
              title={tasksFolded ? "展开任务列表" : "收起任务列表"}
              aria-label={tasksFolded ? "展开任务列表" : "收起任务列表"}
              aria-expanded={!tasksFolded}
              onClick={() => setTasksFolded((v) => !v)}
            >
              <ChevronDownIcon size={14} className={tasksFolded ? "" : "rot-180"} />
            </button>
          </div>
        </div>
      </div>
      {(!tasksFolded || searching) && (
      <div className="todo-scroll">
        {layout === "board" && (
          <div className="todo-board">
            {GROUPS.map((g) => {
              const items = itemsFor(g);
              return (
                <section key={g.id} className={`todo-board-col ${g.id}`}>
                  <header><span>{g.label}</span><em>{items.length}</em></header>
                  <div className="todo-board-cards">
                    {items.map((t) => (
                      <button key={t.id} className={`todo-board-card ${t.id === selectedId ? "on" : ""} ${t.status === "waiting_input" ? "waiting" : ""}`} onClick={() => onSelect(t.id)} title={t.desc || t.title}>
                        <span className="row between gap4"><span className="mono tiny faint">{t.key}</span><span className={`pill status ${STATUS[t.status].cls}`}>{t.confirmed ? "已确认" : STATUS[t.status].label}</span></span>
                        <b>{t.title}</b>
                        <span className="tiny muted ellipsis">{projectName(t)} · {agentOf(state.agents, t.agentId)?.name || "未分配"}</span>
                      </button>
                    ))}
                    {items.length === 0 && <div className="todo-board-empty">—</div>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {layout === "list" && creating && (
          <div className="task-create">
            <textarea
              ref={createRef}
              rows={4}
              value={captureText}
              placeholder={"把今天想到的都写下来，一行一条\n- 修一下登录报错\n- 补 statistics 接口\n- 问清楚 worktree 清理策略"}
              onChange={(e) => setCaptureText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void createTasks(); }
                if (e.key === "Escape") { e.preventDefault(); setCreating(false); setCaptureText(""); }
              }}
            />
            <div className="task-create-foot">
              <span className="tiny muted">一行一条 · <kbd>⌘Enter</kbd> 加入</span>
              <span className="row gap6">
                <button className="btn tiny" onClick={() => { setCreating(false); setCaptureText(""); }}>取消</button>
                <button className="btn tiny primary" disabled={!captureLines.length} onClick={() => void createTasks()}>
                  加入 {captureLines.length || ""} 条
                </button>
              </span>
            </div>
          </div>
        )}
        {layout === "list" && !(searching && visible.length === 0) && GROUPS.map((g) => {
          const items = itemsFor(g);
          const isCollapsed = collapsed[g.id] ?? (items.length === 0 || g.id === "done");
          return (
            <section className="todo-group" key={g.id}>
              <button className={`todo-group-head ${g.id}`} onClick={() => toggle(g.id)}>
                <span className="row gap6"><span className="chev">{isCollapsed ? "▸" : "▾"}</span>{g.label}</span>
                <span>{items.length}</span>
              </button>
              {!isCollapsed && items.map((t) => (
                <div
                  key={t.id}
                  ref={(el) => { rowRefs.current[t.id] = el; }}
                  className={`task-row ${t.id === selectedId ? "on" : ""} ${t.status === "waiting_input" ? "task-waiting" : ""} ${t.parentId ? "task-child" : ""} ${t.kind === "mission" ? "task-mission" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-current={t.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect(t.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelect(t.id);
                  }}
                >
                  <div className="row between gap6">
                    <span className="row gap4"><span className={`priority-dot ${t.priority}`} /><span className="mono tiny faint">{t.key}</span></span>
                    <span className={`pill status ${STATUS[t.status].cls}`}>{t.confirmed ? "已确认" : t.kind === "mission" ? missionLabel(t.missionState) : STATUS[t.status].label}</span>
                  </div>
                  {editing?.id === t.id ? (
                    <div className="task-edit" onClick={(e) => e.stopPropagation()}>
                      <input
                        className="task-edit-title"
                        autoFocus
                        value={editing.title}
                        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); }
                          if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                        }}
                      />
                      <div className="task-edit-fields">
                        <label>优先级
                          <select className="task-edit-input" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                            {["P0", "P1", "P2", "P3"].map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </label>
                        <label>截止
                          <input className="task-edit-input" value={editing.due} onChange={(e) => setEditing({ ...editing, due: e.target.value })} placeholder="截止" />
                          <label>执行 Agent
                            <select
                              className="task-edit-input"
                              value={state.todos.find((x) => x.id === editing.id)?.agentId || ""}
                              onChange={(e) => void act("assign", { id: editing.id, agentId: e.target.value || null })}
                            >
                              <option value="">未分配</option>
                              {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </label>
                        </label>
                      </div>
                      <textarea
                        className="task-edit-desc"
                        rows={2}
                        placeholder="描述"
                        value={editing.desc}
                        onChange={(e) => setEditing({ ...editing, desc: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEdit(); }
                          if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                        }}
                      />
                      <textarea
                        className="task-edit-desc"
                        rows={2}
                        placeholder="验收条件"
                        value={editing.acceptance}
                        onChange={(e) => setEditing({ ...editing, acceptance: e.target.value })}
                      />
                      <input
                        className="task-edit-input"
                        value={editing.tags}
                        onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                        placeholder="标签"
                      />
                      <div className="row gap6" style={{ justifyContent: "flex-end" }}>
                        <button className="btn tiny" onClick={() => setEditing(null)}>取消</button>
                        <button className="btn tiny primary" onClick={() => void saveEdit()}>保存</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className="task-row-title"
                        onDoubleClick={(e) => { e.stopPropagation(); startEdit(t); }}
                      >
                        {t.kind === "mission" ? "✦ " : ""}{t.title}
                      </div>
                      {t.kind === "mission" && (
                        <div className="task-row-desc ellipsis">
                          {(() => {
                            const ds = (state.delegations ?? []).filter((d) => d.missionId === t.id);
                            const done = ds.filter((d) => ["completed", "accepted"].includes(d.status)).length;
                            return ds.length ? `${done}/${ds.length} 子任务完成` : "等待主管计划";
                          })()}
                        </div>
                      )}
                      {t.kind !== "mission" && t.desc && <div className="task-row-desc ellipsis" title={t.desc}>{t.desc}</div>}
                      {t.subtasks?.length > 0 && <TaskPlan items={t.subtasks} expanded={t.id === selectedId} />}
                    </>
                  )}
                  <div className="row between gap6 tiny muted">
                    <span className="ellipsis">{projectName(t)}{agentOf(state.agents, t.agentId) ? ` · ${agentOf(state.agents, t.agentId)!.name}` : ""}</span>
                    <span className="mono">{elapsed(t, state, now)}</span>
                  </div>
                  <WorktreeLine todo={t} state={state} act={act} />
                  <QuickActions
                    todo={t}
                    state={state}
                    act={act}
                    confirmStop={confirmStop}
                    onEdit={() => startEdit(t)}
                    onAsk={() => askInChat(t)}
                    onBroadcast={() => openBroadcast(t)}
                    onDetail={() => { onSelect(t.id); window.dispatchEvent(new CustomEvent("harness:task-detail")); }}
                    onRemoved={(action) => setUndo(action)}
                  />
                </div>
              ))}
            </section>
          );
        })}
        {layout === "list" && visible.length === 0 && !creating && (
          <div className="inline-empty">
            {query.trim() ? "没有匹配的任务" : (
              <>
                <div>还没有任务</div>
                <button className="link" onClick={() => { setLayout("list"); setCreating(true); window.setTimeout(() => createRef.current?.focus(), 0); }}>＋ 写下来，逐条变成任务</button>
              </>
            )}
          </div>
        )}
      </div>
      )}
      {mode === "bot" && activeBotId && (() => {
        const bot = (state.bots ?? []).find((b) => b.id === activeBotId);
        const rows = bot ? assignmentsForBot(state.todos, state.delegations, bot, state.activeProjectId).rows.slice(0, 6) : [];
        if (!rows.length) return null;
        return (
          <section className="bot-work">
            <div className="bot-panel-head">
              <span className="bot-panel-title"><span>它接的活 <em>{rows.length}</em></span></span>
            </div>
            <div className="bot-panel-list">
              {rows.map((r) => (
                <button key={r.todo.id} className="bot-compact" onClick={() => onSelect(r.todo.id)} title={r.todo.title}>
                  <span className="mono tiny faint">{r.todo.key}</span>
                  <span className="bot-compact-main">
                    <b className="ellipsis">{r.todo.title}</b>
                    <span className="ellipsis">{r.stageLabel}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })()}
      {(state.bots?.length ?? 0) > 0 && (
        <section className={`bot-panel ${botsCollapsed ? "collapsed" : ""}`}>
          <div className="bot-panel-head">
            <span className="bot-panel-title">
              <span>机器人 <em>{state.bots!.length}</em></span>
              {botUnread > 0 && <span className="bot-panel-badge">{botUnread > 99 ? "99+" : botUnread}</span>}
            </span>
            <div className="row gap8">
              {!botsCollapsed && <button className="link" onClick={onManageBots}>管理</button>}
              <button className="icon-btn" title={botsCollapsed ? "展开机器人" : "收起机器人"} aria-label={botsCollapsed ? "展开机器人" : "收起机器人"} onClick={() => setBotsCollapsed((v) => !v)}>
                <ChevronDownIcon size={14} className={botsCollapsed ? "" : "rot-180"} />
              </button>
            </div>
          </div>
          {!botsCollapsed && (
            <div className="bot-panel-list">
              {state.bots!.map((b) => {
                const open = assignmentsForBot(state.todos, state.delegations, b).rows.length;
                const muted = Boolean(b.mutedUntil && b.mutedUntil > now);
                const dot = b.status !== "active" ? "paused" : muted ? "quiet" : "";
                return (
                  <button key={b.id} className={`bot-compact ${activeBotId === b.id ? "on" : ""}`} onClick={() => onOpenBot?.(b.id)} title={`${b.name} · 打开会话`}>
                    <span className={`bot-avatar ${b.avatarClass || "a"}`}>{b.avatar || b.name.slice(0, 1)}</span>
                    <span className="bot-compact-main">
                      <b className="ellipsis">{b.name}</b>
                      <span>{b.role === "supervisor" ? "主管" : "员工"}{open ? ` · ${open} 个任务` : ""}</span>
                    </span>
                    <span className={`bot-dot ${dot}`} title={dot === "paused" ? "已暂停" : dot === "quiet" ? "静音中" : "运行中"} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
      {!projectCollapsed && <Splitter orientation="horizontal" onDelta={(d) => setProjectH((h) => h - d)} />}
      {mode === "terminal" && missionsNeedingPlan.length > 0 && (
        <section className="mission-review" aria-label="Mission 待批">
          <div className="bot-panel-head">
            <span className="bot-panel-title"><span>Mission 待批 <em>{missionsNeedingPlan.length}</em></span></span>
          </div>
          {missionsNeedingPlan.map((m) => {
            const plan = (state.missionPlans ?? []).filter((p) => p.missionId === m.id).sort((a, b) => b.revision - a.revision)[0] ?? null;
            const steps = plan?.plan.steps.length ?? 0;
            const rejectHere = rejecting?.id === m.id;
            return (
              <div className="mission-review-card" key={m.id}>
                <div className="row between gap6">
                  <b className="ellipsis" title={m.title}>{m.title}</b>
                  <span className="pill status review">计划待批</span>
                </div>
                <span className="tiny muted">{steps} 子任务 · rev {plan?.revision ?? 1} · 批准后才建子任务</span>
                {rejectHere ? (
                  <div className="row gap6" style={{ marginTop: 6 }}>
                    <input
                      autoFocus
                      className="task-search"
                      style={{ flex: 1 }}
                      placeholder="退回原因（可空）"
                      value={rejecting.text}
                      onChange={(e) => setRejecting({ id: m.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void act("rejectMissionPlan", { id: m.id, feedback: rejecting.text }); setRejecting(null); }
                        else if (e.key === "Escape") { e.preventDefault(); setRejecting(null); }
                      }}
                    />
                    <button className="btn tiny primary" onClick={() => { void act("rejectMissionPlan", { id: m.id, feedback: rejecting.text }); setRejecting(null); }}>确认退回</button>
                    <button className="btn tiny" onClick={() => setRejecting(null)}>取消</button>
                  </div>
                ) : (
                  <div className="row gap6" style={{ marginTop: 6 }}>
                    <button className="btn tiny primary" onClick={() => void act("approveMissionPlan", { id: m.id })}>批准并分派</button>
                    <button className="btn tiny" onClick={() => setRejecting({ id: m.id, text: "" })}>退回</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      
      <section className={`project-panel ${projectCollapsed && !searching ? "collapsed" : ""}`} style={projectCollapsed || tasksFolded ? undefined : { height: projectH }}>
        <div className="project-panel-head">
          <span className="project-panel-title">项目</span>
          <span className="spacer" />
          <div className="project-panel-actions">
          <button
            className={`icon-btn ${projectViewMenu ? "on" : ""}`}
            title="视图与筛选"
            aria-label="视图与筛选"
            aria-haspopup="dialog"
            aria-expanded={Boolean(projectViewMenu)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setProjectViewMenu((open) => (open ? null : { x: r.left, y: r.bottom + 6 }));
            }}
          >
            <SlidersIcon size={14} />
          </button>
          <button className="icon-btn" title="添加项目" aria-label="添加项目" onClick={onAddProject}><FolderPlusIcon size={14} /></button>
          <button className="icon-btn" title="管理项目" aria-label="管理项目" onClick={onManageProjects}><EllipsisIcon size={13} /></button>
          </div>
          <button
            className="project-panel-chev"
            title={projectCollapsed ? "展开项目列表" : "收起项目列表"}
            aria-label={projectCollapsed ? "展开项目列表" : "收起项目列表"}
            aria-expanded={!projectCollapsed}
            onClick={() => setProjectCollapsed((v) => !v)}
          >
            <ChevronDownIcon size={14} className={projectCollapsed ? "" : "rot-180"} />
          </button>
        </div>
        {(!projectCollapsed || searching) && <div className="project-panel-list">
          {visibleProjects.map((p) => {
            const isCurrent = p.id === state.activeProjectId;
            return (
              <div key={p.id} className="project-node">
                <div className="project-node-row">
                  <button
                    className={`project-compact ${isCurrent ? "on" : ""}`}
                    onClick={() => onSwitchProject(p.id)}
                    onContextMenu={(e) => { e.preventDefault(); setProjectMenu({ at: { x: e.clientX, y: e.clientY }, projectId: p.id }); }}
                    title={`${p.path}\n右键：交给机器人`}
                  >
                    <span className={`dot ${p.color}`} />
                    <span className="ellipsis">{p.name}</span>
                    {isCurrent && <span className="tag ok">当前</span>}
                    {(projectCounts[p.id] ?? 0) > 0 && <span className="count">{projectCounts[p.id]}</span>}
                  </button>
                  <span className="project-row-actions">
                    <button
                      className="icon-btn"
                      title="新建终端"
                      aria-label={`在 ${p.name} 新建终端`}
                      onClick={() => { if (!isCurrent) onSwitchProject(p.id); requestTerminalAt(p.path); }}
                    ><PlusIcon size={14} /></button>
                    <button
                      className="icon-btn"
                      title="项目操作"
                      aria-label={`${p.name} 的项目操作`}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setProjectMenu({ at: { x: r.right - 190, y: r.bottom + 4 }, projectId: p.id });
                      }}
                    >⋯</button>
                  </span>
                </div>
              </div>
            );
          })}
          {state.projects.length === 0 && <div className="inline-empty">还没有项目</div>}
          {state.projects.length > 0 && visibleProjects.length === 0 && <div className="inline-empty">没有匹配的项目</div>}
        </div>}
        <ListContextMenu
          at={projectMenu?.at ?? null}
          onClose={() => setProjectMenu(null)}
          items={menuProject ? [
            {
              label: "新建终端",
              onSelect: () => {
                if (menuProject.id !== state.activeProjectId) onSwitchProject(menuProject.id);
                requestTerminalAt(menuProject.path);
              },
            },
            ...(handoffBot
              ? handoffChoices.map((b, i) => ({
                  label: i === 0 ? `交给机器人 · ${b.name}` : `交给 ${b.name}`,
                  onSelect: () => handoffTo(b.id, b.name),
                }))
              : [{ label: "交给机器人（还没有机器人）", disabled: true, onSelect: () => {} }]),
            { label: "管理机器人…", onSelect: () => onManageBots?.() , disabled: !onManageBots },
            { label: "设为当前项目", disabled: menuProject.id === state.activeProjectId, onSelect: () => onSwitchProject(menuProject.id) },
            { label: "在 Finder 中显示", onSelect: () => void act("revealProject", { id: menuProject.id }) },
          ] : []}
        />
      </section>
      {projectViewMenu && createPortal(
        <div
          className="project-view-pop"
          style={{ left: Math.max(8, Math.min(projectViewMenu.x, window.innerWidth - 300)), top: projectViewMenu.y }}
          role="dialog"
          aria-label="项目视图与筛选"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="pvp-section">
            <div className="pvp-label">Selection</div>
            <div className="pvp-row static"><span>主机</span><em>本机</em><ChevronRightIcon size={14} /></div>
            <div className="pvp-row static"><span>项目</span><em>{visibleProjects.length} / {state.projects.length}</em><ChevronRightIcon size={14} /></div>
          </div>
          <div className="pvp-section">
            <div className="pvp-label">排序方式</div>
            <div className="pvp-seg">
              <button className={projectView.sort === "manual" ? "on" : ""} aria-pressed={projectView.sort === "manual"} onClick={() => setProjectView((v) => ({ ...v, sort: "manual" }))}>固定</button>
              <button className={projectView.sort === "recent" ? "on" : ""} aria-pressed={projectView.sort === "recent"} onClick={() => setProjectView((v) => ({ ...v, sort: "recent" }))}>最近活动</button>
              <button className={projectView.sort === "name" ? "on" : ""} aria-pressed={projectView.sort === "name"} onClick={() => setProjectView((v) => ({ ...v, sort: "name" }))}>名称</button>
            </div>
          </div>
          <div className="pvp-section">
            <div className="pvp-label">筛选条件</div>
            <button className="pvp-toggle" role="switch" aria-checked={projectView.hideNoTask} onClick={() => setProjectView((v) => ({ ...v, hideNoTask: !v.hideNoTask }))}>
              <span>隐藏没有任务的项目</span><span className={`switch ${projectView.hideNoTask ? "on" : ""}`}><i /></span>
            </button>
          </div>
        </div>,
        document.body,
      )}
      {broadcastFor && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="多 Agent 并行">
          <div className="modal">
            <h3>多 Agent 并行 · {broadcastFor.key}</h3>
            <p className="tiny muted">每个 Agent 独立 run / worktree / 终端；ACP 在 Chat/TODO 里看流，原生 CLI 会自动开终端标签。</p>
            <div className="broadcast-list">
              {acpWorkers.map((agent) => (
                <label key={agent.id} className="broadcast-item">
                  <input
                    type="checkbox"
                    checked={broadcastPick.includes(agent.id)}
                    onChange={(e) => setBroadcastPick((cur) => e.target.checked ? [...cur, agent.id] : cur.filter((id) => id !== agent.id))}
                  />
                  <span>{agent.name}</span>
                  <span className="mono tiny faint">{agent.alias || agent.cli}</span>
                </label>
              ))}
            </div>
            <div className="row gap6" style={{ justifyContent: "flex-end" }}>
              <button className="btn tiny" onClick={() => setBroadcastFor(null)} disabled={broadcastBusy}>取消</button>
              <button className="btn tiny primary" disabled={broadcastBusy || broadcastPick.length < 2} onClick={() => void startBroadcast()}>
                {broadcastBusy ? "启动中…" : `开始并行 (${broadcastPick.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function projectName(todo: Todo) {
  return todo.cwd.split("/").filter(Boolean).slice(-1)[0] || "—";
}
function elapsed(todo: Todo, state: State, now: number) {
  const run = activeRun(todo, state.runs) ?? lastRun(todo, state.runs);
  if (!run) return "—";
  return duration(run, now);
}

/** 当前/最近一次运行的 worktree：分支和目录都可点开，避免「跑完不知道改在哪」 */
function WorktreeLine({ todo, state, act }: { todo: Todo; state: State; act: Act }) {
  const current = activeRun(todo, state.runs);
  const run = current ?? lastRun(todo, state.runs);
  if (!run?.cwd || run.worktreeCleaned) return null;
  const label = run.branch || run.cwd;
  const canClean = Boolean(run.branch && !current);
  return (
    <div className="task-worktree-row">
      <button
        className="task-worktree mono tiny ellipsis"
        title={`${run.cwd}${run.branch ? ` · ${run.branch}` : ""} · 点击在 Finder 打开`}
        onClick={(e) => { e.stopPropagation(); void act("revealWorktree", { runId: run.id }); }}
      >
        {run.branch ? "⑂ " : "▸ "}{label}
      </button>
      {canClean && (
        <button
          className="task-worktree-clean tiny"
          title="清理这个 worktree（先确认没有未提交改动）"
          onClick={async (e) => {
            e.stopPropagation();
            if (!(await confirmDialog(`清理 worktree「${run.branch}」？\n${run.cwd}\n未提交的改动会丢失。`))) return;
            const ok = await act("cleanupWorktree", { runId: run.id });
            if (ok === null) return;
            window.dispatchEvent(new CustomEvent("harness:toast", { detail: ok ? "worktree 已清理" : "worktree 清理失败" }));
          }}
        >清理</button>
      )}
    </div>
  );
}

function QuickActions({ todo, state, act, confirmStop, onEdit, onAsk, onBroadcast, onDetail, onRemoved }: { todo: Todo; state: State; act: Act; confirmStop: boolean; onEdit: () => void; onAsk: () => void; onBroadcast: () => void; onDetail: () => void; onRemoved: (action: UndoAction) => void }) {
  const active = activeRun(todo, state.runs);
  const last = lastRun(todo, state.runs);
  const bots = state.bots || [];
  if (todo.kind === "mission") {
    return (
      <div className="task-quick" onClick={(e) => e.stopPropagation()}>
        {todo.missionState === "in_review" && <button className="btn tiny primary" onClick={() => act("confirm", { id: todo.id })}>确认 Mission</button>}
        {active && <button className="btn tiny" onClick={async () => { if (!confirmStop || await confirmDialog("停止主管运行？")) void act("stop", { runId: active.id }); }}>停止主管</button>}
        <RowMenu title="更多 Mission 操作">
          {todo.missionState === "done" && <button onClick={() => act("unconfirm", { id: todo.id })}>撤销确认</button>}
          {!["done", "cancelled"].includes(todo.missionState || "") && <button className="danger" onClick={async () => { if (await confirmDialog("取消整个 Mission？")) void act("cancelMission", { id: todo.id }); }}>取消 Mission</button>}
        </RowMenu>
      </div>
    );
  }
  const runnable = state.agents.filter((a) => a.chatRunnable ?? state.executors?.find((e) => e.id === a.cli)?.implemented);
  const chatAgent = runnable.find((a) => a.id === todo.agentId) || runnable[0] || null;
  const acpWorkers = state.agents.filter((a) => (a.role || "worker") !== "supervisor" && a.chatRunnable !== false);
  const stop = async (runId: string) => {
    if (confirmStop && !(await confirmDialog(`停止 ${todo.key} 的运行？`))) return;
    void act("stop", { runId });
  };
  /** 行内只留当前状态的那一个主动作，其余进 ⋯：一行最多 1 primary + ⋯ */
  const primary = active ? (
    <button className="btn tiny" title="停止这次运行" onClick={() => stop(active.id)}>停止</button>
  ) : todo.confirmed ? (
    <button className="btn tiny" onClick={() => act("unconfirm", { id: todo.id })}>撤销确认</button>
  ) : todo.status === "in_review" ? (
    <button className="btn tiny primary" onClick={() => act("confirm", { id: todo.id })}>确认</button>
  ) : todo.status === "todo" ? (
    <button
      className="btn tiny primary"
      disabled={!chatAgent}
      title={chatAgent ? "派给 Agent 开始执行" : "没有可用的 Agent"}
      onClick={() => chatAgent && act("run", { id: todo.id, agentId: chatAgent.id })}
    >派活</button>
  ) : null;
  return (
    <div className="task-quick" onClick={(e) => e.stopPropagation()}>
      {primary}
      <RowMenu title="更多任务操作">
        <button onClick={onDetail}>详情</button>
        <button onClick={onEdit}>编辑（⌘E）</button>
        <button onClick={onAsk}>问清楚（带到 Chat）</button>
        {!active && !todo.confirmed && todo.status === "todo" && acpWorkers.length >= 2 && (
          <button onClick={onBroadcast}>多 Agent 并行</button>
        )}
        {active && <button onClick={() => stop(active.id)}>停止运行</button>}
        {!active && last && ["failed", "cancelled"].includes(last.status) && <button onClick={() => act("retry", { id: todo.id })}>重试</button>}
        {!active && last && last.status === "interrupted" && Boolean(last.acpSession) && (
          <button onClick={() => act("runResume", { runId: last.id })}>续跑</button>
        )}
        {bots.length > 0 && !todo.confirmed && (
          <>
            <div className="row-menu-label">派给机器人</div>
            {bots.slice(0, 8).map((b) => (
              <button
                key={b.id}
                title={b.persona?.mission || "派给它：任务归它，跑完由它回报"}
                onClick={() => void act("botAssignTask", { todoId: todo.id, botId: b.id })}
              >
                派给 · {b.name}
              </button>
            ))}
          </>
        )}
        {!todo.confirmed && !["done", "cancelled"].includes(todo.status) && (
          <>
            <button onClick={async () => {
              if (!(await confirmDialog({ title: `取消任务「${todo.title}」？`, desc: "任务保留，状态置为已取消；正在跑的运行会停掉。", ok: "取消任务" }))) return;
              await act("cancelTodo", { id: todo.id });
            }}>取消任务</button>
            <button className="danger" onClick={async () => {
              if (!(await confirmDialog({ danger: true, title: `删除任务「${todo.title}」？`, desc: "任务记录会删掉；会话与运行记录保留。6 秒内可以撤销。" }))) return;
              const res = await act("removeTodo", { id: todo.id }) as { ok?: boolean; key?: string } | null;
              if (res?.ok) onRemoved({ label: `已删除 ${res.key || "任务"}`, run: () => act("undoRemoveTodo") });
            }}>删除任务</button>
          </>
        )}
      </RowMenu>
    </div>
  );
}

function missionLabel(value?: string | null) {
  return ({
    planning: "规划中", plan_review: "计划待批", running: "执行中", waiting_children: "等待子任务",
    in_review: "待确认", done: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断",
  } as Record<string, string>)[value || ""] || "Mission";
}
