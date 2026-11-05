import { useState } from "react";
import type { Project, ProjectStatus, State } from "../types";
import { money, timeAgo, tokens } from "../ui";

type Act = (type: string, payload?: unknown) => Promise<any>;

const PROJECT_STATUS: Record<ProjectStatus, string> = {
  planned: "计划中", in_progress: "进行中", paused: "已暂停", completed: "已完成", cancelled: "已取消",
};

export function Projects({ state, now, act, notify, onAdd, onSwitch }: {
  state: State; now: number; act: Act; notify: (m: string) => void; onAdd: () => void; onSwitch: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const active = state.projects.find((p) => p.id === state.activeProjectId) ?? null;
  const activeTodos = state.todos.filter((t) => t.projectId === state.activeProjectId);
  const running = state.runs.filter((r) => activeTodos.some((t) => t.id === r.todoId) && ["queued", "running", "waiting_input"].includes(r.status)).length;

  const startRename = (p: Project) => { setEditing(p.id); setDraft(p.name); };
  const saveRename = async (id: string) => {
    const name = draft.trim();
    if (!name) return;
    await act("renameProject", { id, name });
    setEditing(null);
    notify("项目已重命名");
  };
  const remove = async (p: Project) => {
    if (!window.confirm(`移除项目“${p.name}”？不会删除磁盘上的文件。`)) return;
    const res = await act("removeProject", { id: p.id });
    if (res) notify("项目已移除");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>项目</h2><span className="muted">{state.projects.length} 个项目{active ? ` · 当前 ${active.name}` : ""}</span></div>
        <button className="btn primary" onClick={onAdd}>＋ 添加项目</button>
      </div>

      <div className="kpis">
        <div className="kpi"><span>项目</span><b>{state.projects.length}</b><small>本地目录</small></div>
        <div className="kpi"><span>当前任务</span><b>{activeTodos.length}</b><small>{active?.name || "未选择"}</small></div>
        <div className="kpi"><span>运行中</span><b>{running}</b><small>排队 + 执行</small></div>
        <div className="kpi"><span>已完成</span><b>{activeTodos.filter((t) => t.confirmed).length}</b><small>当前项目已确认</small></div>
      </div>

      <section className="panel project-list">
        <div className="panel-head">工作区项目 <span className="tiny muted">每个项目绑定一个本地目录，任务与终端跟随当前项目</span></div>
        {state.projects.map((p) => {
          const todos = state.todos.filter((t) => t.projectId === p.id);
          const isActive = p.id === state.activeProjectId;
          const open = todos.filter((t) => !t.confirmed).length;
          const busy = state.runs.filter((r) => todos.some((t) => t.id === r.todoId) && ["queued", "running", "waiting_input"].includes(r.status)).length;
          return (
            <div className={`project-row ${isActive ? "on" : ""}`} key={p.id}>
              <div className={`project-mark ${p.color}`}>{p.name.trim().slice(0, 1).toUpperCase() || "P"}</div>
              <div className="project-main">
                <div className="row gap6 wrap">
                  {editing === p.id ? (
                    <input className="project-name-input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveRename(p.id); if (e.key === "Escape") setEditing(null); }} />
                  ) : (
                    <b className="ellipsis">{p.name}</b>
                  )}
                  <span className="tag mono">@{p.alias}</span>
                  {isActive && <span className="tag ok">当前</span>}
                  <span className={`tag project-status ${p.status}`}>{PROJECT_STATUS[p.status] || p.status}</span>
                </div>
                <div className="tiny mono muted ellipsis" title={p.path}>{p.path}</div>
                <div className="row gap10 wrap tiny muted">
                  <span>{todos.length} 任务</span>
                  <span>{open} 未完成</span>
                  {busy > 0 && <span className="live" />}<span>{busy} 运行中</span>
                  <span>最近打开 {timeAgo(p.lastOpenedAt, now)}前</span>
                </div>
              </div>
              <div className="project-actions">
                {editing === p.id ? (
                  <>
                    <button className="btn tiny-btn primary" onClick={() => void saveRename(p.id)}>保存</button>
                    <button className="btn tiny-btn" onClick={() => setEditing(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button className="btn tiny-btn primary" disabled={isActive} onClick={() => onSwitch(p.id)}>{isActive ? "使用中" : "打开"}</button>
                    <button className="btn tiny-btn" onClick={() => act("revealProject", { id: p.id })}>Finder</button>
                    <button className="btn tiny-btn" onClick={() => startRename(p)}>重命名</button>
                    <select className="project-status-select" value={p.status} onChange={(e) => act("setProjectStatus", { id: p.id, status: e.target.value })} title="项目状态">
                      {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS[s]}</option>)}
                    </select>
                    <button className="btn tiny-btn danger" onClick={() => void remove(p)}>移除</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {state.projects.length === 0 && <div className="muted small">还没有项目，点右上角添加一个本地目录。</div>}
      </section>
    </div>
  );
}

export function Inbox({ state, now, act, onOpen }: { state: State; now: number; act: Act; onOpen: (id: string) => void }) {
  return (
    <div className="page">
      <div className="page-head"><div><h2>收件箱</h2><span className="muted">{state.inbox.filter((i) => !i.read).length} 未读</span></div><button className="btn" onClick={() => act("readAllInbox")}>全部已读</button></div>
      <div className="panel">
        {state.inbox.map((i) => (
          <button key={i.id} className={`inbox-row ${i.read ? "read" : ""}`} onClick={() => { act("readInbox", { id: i.id }); onOpen(i.todoId); }}>
            <span className={`kind ${i.kind}`}>{i.kind === "failed" ? "!" : "✓"}</span>
            <span className="inbox-title">{i.title}</span>
            <span className="muted tiny">{timeAgo(i.at, now)} 前</span>
          </button>
        ))}
        {state.inbox.length === 0 && <div className="muted small">没有通知</div>}
      </div>
    </div>
  );
}

export function Hosts({ state, act, notify }: { state: State; act: Act; notify: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [cwd, setCwd] = useState("/home");
  const add = async () => {
    if (!name || !addr) return;
    await act("addHost", { name, addr, user, port: Number(port) || 22, path: cwd });
    setOpen(false); setName(""); setAddr(""); setUser(""); setCwd("/home");
    notify("主机已加入；状态取决于 SSH 测试结果");
  };
  return (
    <div className="page">
      <div className="page-head"><div><h2>主机</h2><span className="muted">{state.hosts.filter((h) => h.status === "online").length}/{state.hosts.length} 在线 · Agent 由项目终端启动</span></div><button className="btn" onClick={() => setOpen((v) => !v)}>＋ 添加主机</button></div>
      {open && (
        <section className="panel host-form">
          <div className="form-row"><label>名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="lab-gpu" /></label><label>host / IP<input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="10.0.8.21" /></label></div>
          <div className="form-row"><label>用户<input value={user} onChange={(e) => setUser(e.target.value)} placeholder="spin" /></label><label>端口<input value={port} onChange={(e) => setPort(e.target.value)} /></label><label>远端 cwd<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/home/spin/work" /></label></div>
          <div className="row gap8" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={() => setOpen(false)}>取消</button><button className="btn primary" onClick={() => void add()}>添加并测试</button></div>
        </section>
      )}
      <section className="panel">
        <table className="table">
          <thead><tr><th>主机</th><th>kind</th><th>地址</th><th>状态</th><th>版本</th></tr></thead>
          <tbody>{state.hosts.map((h) => <tr key={h.id}><td><span className={`dot ${h.status === "online" ? "green" : "red"}`} /> {h.name}</td><td className="mono">{h.kind}</td><td className="mono tiny">{h.kind === "ssh" ? `${h.user ? h.user + "@" : ""}${h.addr}:${h.port || 22}` : h.addr}</td><td>{h.status}{h.kind === "ssh" && <button className="link" style={{ marginLeft: 8 }} onClick={() => act("testHost", { id: h.id })}>测试</button>}</td><td className="mono">{h.version}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="panel">
        <div className="panel-head">可用 CLI <span className="tiny muted">仅表示本机可启动，不代表已纳管 Agent</span></div>
        <div className="row gap6 wrap">
          {(state.cliCapabilities || []).map((c) => <span className="tag mono" key={c}>{c}</span>)}
          {(state.cliCapabilities || []).length === 0 && <span className="muted small">未检测到 Agent CLI</span>}
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>Agent 在项目终端里启动后才会出现，并带项目内唯一的 @别名。</div>
      </section>
    </div>
  );
}

export function Stats({ state }: { state: State }) {
  const perAgent = state.agents.map((a) => {
    const runs = state.runs.filter((r) => r.agentId === a.id);
    return { agent: a, runs: runs.length, cost: runs.reduce((s, r) => s + r.cost, 0), tokens: runs.reduce((s, r) => s + r.tokens, 0), failed: runs.filter((r) => r.status === "failed").length };
  });
  const max = Math.max(1, ...perAgent.map((x) => x.tokens));
  const failures = state.runs.filter((r) => r.status === "failed").slice(-5).reverse();
  return (
    <div className="page">
      <div className="page-head"><div><h2>统计</h2><span className="muted">全部 run · 本地</span></div></div>
      <div className="kpis">
        <div className="kpi"><span>费用</span><b>{money(state.summary.cost)}</b><small>估算</small></div>
        <div className="kpi"><span>Token</span><b>{tokens(state.summary.tokens)}</b><small>输入 + 输出</small></div>
        <div className="kpi"><span>运行数</span><b>{state.runs.length}</b><small>{state.summary.failures} 失败</small></div>
        <div className="kpi"><span>进行中</span><b>{state.summary.activeRuns}</b><small>含排队</small></div>
      </div>
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">按 Agent</div>
          {perAgent.map((x) => (
            <div className="agent-stat" key={x.agent.id}>
              <span className={`dot ${x.agent.color}`} />
              <span className="name">{x.agent.name}</span>
              <div className="bar"><i style={{ width: `${(x.tokens / max) * 100}%` }} /></div>
              <span className="mono tiny">{tokens(x.tokens)}</span>
              <span className="mono tiny">{money(x.cost)}</span>
              <span className="tiny muted">{x.runs} run{x.failed ? ` · ${x.failed} 失败` : ""}</span>
            </div>
          ))}
          {state.agents.length === 0 && <div className="muted small">未检测到 Agent</div>}
        </section>
        <section className="panel">
          <div className="panel-head">最近失败</div>
          {failures.map((r) => (
            <div className="fail-row" key={r.id}>
              <span className="dot red" />
              <b className="mono tiny">{r.id}</b>
              <span className="ellipsis">{state.todos.find((t) => t.id === r.todoId)?.title || "—"}</span>
              <span className="tiny red ellipsis">{r.error || "exit"}</span>
            </div>
          ))}
          {failures.length === 0 && <div className="muted small">没有失败记录</div>}
        </section>
      </div>
    </div>
  );
}
