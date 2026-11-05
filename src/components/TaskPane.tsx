import { useEffect, useMemo, useRef, useState } from "react";
import type { State, Todo, TodoStatus } from "../types";
import { STATUS, activeRun, agentOf, duration, lastRun } from "../ui";
import { Splitter, useStoredSize } from "./Splitter";
import { ChevronDownIcon, PanelCollapseIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Filter = "all" | "active" | "review" | "confirmed";

const GROUPS: { id: string; label: string; statuses: TodoStatus[]; confirmed?: boolean }[] = [
  { id: "waiting", label: "等待输入", statuses: ["waiting_input"] },
  { id: "review", label: "待确认", statuses: ["in_review"] },
  { id: "running", label: "运行中", statuses: ["queued", "in_progress"] },
  { id: "todo", label: "待执行", statuses: ["todo"] },
  { id: "confirmed", label: "已确认", statuses: ["done"], confirmed: true },
];

export function TaskPane({ state, selectedId, now, act, onSelect, projectCounts, onAddProject, onManageProjects, onSwitchProject, onCollapse, confirmStop = false }: {
  state: State; selectedId: string | null; now: number; act: Act; onSelect: (id: string) => void;
  projectCounts: Record<string, number>;
  onAddProject: () => void; onManageProjects: () => void; onSwitchProject: (id: string) => void;
  onCollapse?: () => void;
  confirmStop?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ confirmed: true });
  const [projectH, setProjectH] = useStoredSize("ymh.layout.projectH", 150, 80, 420);
  const [projectCollapsed, setProjectCollapsed] = useState(() => {
    try { return localStorage.getItem("ymh.layout.projectCollapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("ymh.layout.projectCollapsed", projectCollapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [projectCollapsed]);
  useEffect(() => {
    const reset = () => setProjectCollapsed(false);
    window.addEventListener("harness:reset-layout", reset);
    return () => window.removeEventListener("harness:reset-layout", reset);
  }, []);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.todos.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)) return false;
      if (filter === "active") return !t.confirmed;
      if (filter === "review") return t.status === "in_review" && !t.confirmed;
      if (filter === "confirmed") return t.confirmed;
      return true;
    });
  }, [state.todos, query, filter]);

  useEffect(() => {
    if (selectedId) rowRefs.current[selectedId]?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <aside className="todo-pane">
      <div className="pane-head">
        <span>TODO LIST</span>
        <div className="row gap6">
          <span className="muted">{state.todos.length}</span>
          {onCollapse && (
            <button className="pane-collapse" title="收起 TODO" aria-label="收起 TODO" onClick={onCollapse}>
              <PanelCollapseIcon size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="task-tools">
        <input className="task-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题 / 编号" />
        <div className="task-filters">
          {([["all", "全部"], ["active", "进行中"], ["review", "待确认"], ["confirmed", "已确认"]] as [Filter, string][]).map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="todo-scroll">
        {GROUPS.map((g) => {
          const items = visible.filter((t) => (g.confirmed ? t.confirmed : !t.confirmed && g.statuses.includes(t.status)));
          const isCollapsed = collapsed[g.id] ?? items.length === 0;
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
                  className={`task-row ${t.id === selectedId ? "on" : ""}`}
                  onClick={() => onSelect(t.id)}
                >
                  <div className="row between gap6">
                    <span className="row gap4"><span className={`priority-dot ${t.priority}`} /><span className="mono tiny faint">{t.key}</span></span>
                    <span className={`pill status ${STATUS[t.status].cls}`}>{t.confirmed ? "已确认" : STATUS[t.status].label}</span>
                  </div>
                  <div className="task-row-title">{t.title}</div>
                  <div className="row between gap6 tiny muted">
                    <span className="ellipsis">{projectName(t)}{agentOf(state.agents, t.agentId) ? ` · ${agentOf(state.agents, t.agentId)!.name}` : ""}</span>
                    <span className="mono">{elapsed(t, state, now)}</span>
                  </div>
                  <QuickActions todo={t} state={state} act={act} confirmStop={confirmStop} />
                </div>
              ))}
            </section>
          );
        })}
        {visible.length === 0 && <div className="pane-empty">没有匹配的任务</div>}
      </div>
      {!projectCollapsed && <Splitter orientation="horizontal" onDelta={(d) => setProjectH((h) => h - d)} title="拖拽调整项目区高度" />}
      <section className={`project-panel ${projectCollapsed ? "collapsed" : ""}`} style={projectCollapsed ? undefined : { height: projectH }}>
        <div className="project-panel-head">
          <span>项目 <em>{state.projects.length}</em></span>
          <div className="row gap8">
            {!projectCollapsed && <button className="link" onClick={onAddProject} title="添加项目">＋ 添加</button>}
            {!projectCollapsed && <button className="link" onClick={onManageProjects}>管理</button>}
            <button
              className="icon-btn"
              title={projectCollapsed ? "展开项目区" : "收起项目区"}
              aria-label={projectCollapsed ? "展开项目区" : "收起项目区"}
              onClick={() => setProjectCollapsed((v) => !v)}
            >
              <ChevronDownIcon size={12} className={projectCollapsed ? "" : "rot-180"} />
            </button>
          </div>
        </div>
        {!projectCollapsed && <div className="project-panel-list">
          {state.projects.map((p) => (
            <button
              key={p.id}
              className={`project-compact ${p.id === state.activeProjectId ? "on" : ""}`}
              onClick={() => onSwitchProject(p.id)}
              title={p.path}
            >
              <span className={`dot ${p.color}`} />
              <span className="ellipsis">{p.name}</span>
              {p.id === state.activeProjectId && <span className="tag ok">当前</span>}
              <span className="count">{projectCounts[p.id] ?? 0}</span>
            </button>
          ))}
          {state.projects.length === 0 && <div className="pane-empty">还没有项目</div>}
        </div>}
      </section>
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

function QuickActions({ todo, state, act, confirmStop }: { todo: Todo; state: State; act: Act; confirmStop: boolean }) {
  const active = activeRun(todo, state.runs);
  const last = lastRun(todo, state.runs);
  const stop = (runId: string) => {
    if (confirmStop && !window.confirm(`停止 ${todo.key} 的运行？`)) return;
    void act("stop", { runId });
  };
  return (
    <div className="task-quick" onClick={(e) => e.stopPropagation()}>
      {active && <button className="btn tiny-btn" onClick={() => stop(active.id)}>停止</button>}
      {!active && !todo.confirmed && todo.status === "in_review" && <button className="btn tiny-btn primary" onClick={() => act("confirm", { id: todo.id })}>确认</button>}
      {!active && !todo.confirmed && todo.status === "todo" && <button className="btn tiny-btn" onClick={() => act("run", { id: todo.id, agentId: todo.agentId ?? state.agents[0]?.id })}>派活</button>}
      {!active && last && ["failed", "cancelled"].includes(last.status) && <button className="btn tiny-btn" onClick={() => act("retry", { id: todo.id })}>重试</button>}
    </div>
  );
}
