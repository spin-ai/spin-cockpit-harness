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
  const [editing, setEditing] = useState<{ id: string; title: string; desc: string; acceptance: string; priority: string; due: string; tags: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const createRef = useRef<HTMLTextAreaElement | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ confirmed: true });
  const [projectH, setProjectH] = useStoredSize("cmh.layout.projectH", 150, 80, 420);
  const [projectCollapsed, setProjectCollapsed] = useState(() => {
    try { return localStorage.getItem("cmh.layout.projectCollapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("cmh.layout.projectCollapsed", projectCollapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [projectCollapsed]);
  useEffect(() => {
    const reset = () => setProjectCollapsed(false);
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
    const onNew = () => { setCreating(true); window.setTimeout(() => createRef.current?.focus(), 0); };
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
      if (q && !t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)
        && !(t.desc || "").toLowerCase().includes(q)
        && !(t.tags || []).some((tag) => tag.toLowerCase().includes(q))) return false;
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

  return (
    <aside className="todo-pane">
      <div className="pane-head">
        <span>TODO LIST</span>
        <div className="row gap6">
          <span className="muted">{state.todos.length}</span>
          <button className="pane-add" title="收集想法 / 新建任务（一行一条，⌘⇧N）" onClick={() => { setCreating(true); window.setTimeout(() => createRef.current?.focus(), 0); }}>＋</button>
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
        {creating && (
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
                <button className="btn tiny-btn" onClick={() => { setCreating(false); setCaptureText(""); }}>取消</button>
                <button className="btn tiny-btn primary" disabled={!captureLines.length} onClick={() => void createTasks()}>
                  加入 {captureLines.length || ""} 条
                </button>
              </span>
            </div>
          </div>
        )}
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
                  className={`task-row ${t.id === selectedId ? "on" : ""} ${t.parentId ? "task-child" : ""} ${t.kind === "mission" ? "task-mission" : ""}`}
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
                        <button className="btn tiny-btn" onClick={() => setEditing(null)}>取消</button>
                        <button className="btn tiny-btn primary" onClick={() => void saveEdit()}>保存</button>
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
                    </>
                  )}
                  <div className="row between gap6 tiny muted">
                    <span className="ellipsis">{projectName(t)}{agentOf(state.agents, t.agentId) ? ` · ${agentOf(state.agents, t.agentId)!.name}` : ""}</span>
                    <span className="mono">{elapsed(t, state, now)}</span>
                  </div>
                  <QuickActions todo={t} state={state} act={act} confirmStop={confirmStop} onEdit={() => startEdit(t)} onAsk={() => askInChat(t)} />
                </div>
              ))}
            </section>
          );
        })}
        {visible.length === 0 && !creating && (
          <div className="pane-empty">
            {query.trim() ? "没有匹配的任务" : (
              <>
                <div>还没有任务</div>
                <button className="link" onClick={() => { setCreating(true); window.setTimeout(() => createRef.current?.focus(), 0); }}>＋ 写下来，逐条变成任务</button>
              </>
            )}
          </div>
        )}
      </div>
      {!projectCollapsed && <Splitter orientation="horizontal" onDelta={(d) => setProjectH((h) => h - d)} />}
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

function QuickActions({ todo, state, act, confirmStop, onEdit, onAsk }: { todo: Todo; state: State; act: Act; confirmStop: boolean; onEdit: () => void; onAsk: () => void }) {
  const active = activeRun(todo, state.runs);
  const last = lastRun(todo, state.runs);
  if (todo.kind === "mission") {
    return (
      <div className="task-quick" onClick={(e) => e.stopPropagation()}>
        {todo.missionState === "in_review" && <button className="btn tiny-btn primary" onClick={() => act("confirm", { id: todo.id })}>确认 Mission</button>}
        {active && <button className="btn tiny-btn" onClick={() => { if (!confirmStop || window.confirm("停止主管运行？")) void act("stop", { runId: active.id }); }}>停止主管</button>}
        {!["done", "cancelled"].includes(todo.missionState || "") && <button className="btn tiny-btn" onClick={() => { if (window.confirm("取消整个 Mission？")) void act("cancelMission", { id: todo.id }); }}>取消</button>}
      </div>
    );
  }
  const runnable = state.agents.filter((a) => a.chatRunnable ?? state.executors?.find((e) => e.id === a.cli)?.implemented);
  const chatAgent = runnable.find((a) => a.id === todo.agentId) || runnable[0] || null;
  const stop = (runId: string) => {
    if (confirmStop && !window.confirm(`停止 ${todo.key} 的运行？`)) return;
    void act("stop", { runId });
  };
  return (
    <div className="task-quick" onClick={(e) => e.stopPropagation()}>
      <button className="btn tiny-btn" onClick={onEdit} title="编辑标题 / 描述 / 验收 / 优先级（⌘E）">编辑</button>
      <button className="btn tiny-btn" onClick={onAsk} title="带着预填问题跳到 Chat，先理清再动手">问清楚</button>
      {active && <button className="btn tiny-btn" onClick={() => stop(active.id)}>停止</button>}
      {!active && !todo.confirmed && todo.status === "in_review" && <button className="btn tiny-btn primary" onClick={() => act("confirm", { id: todo.id })}>确认</button>}
      {!active && !todo.confirmed && todo.status === "todo" && (
        <button
          className="btn tiny-btn"
          disabled={!chatAgent}
          title={chatAgent ? undefined : "没有可用的 Agent"}
          onClick={() => chatAgent && act("run", { id: todo.id, agentId: chatAgent.id })}
        >派活</button>
      )}
      {!active && last && ["failed", "cancelled"].includes(last.status) && <button className="btn tiny-btn" onClick={() => act("retry", { id: todo.id })}>重试</button>}
    </div>
  );
}

function missionLabel(value?: string | null) {
  return ({
    planning: "规划中", plan_review: "计划待批", running: "执行中", waiting_children: "等待子任务",
    in_review: "待确认", done: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断",
  } as Record<string, string>)[value || ""] || "Mission";
}
