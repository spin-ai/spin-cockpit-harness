import { useEffect, useState } from "react";
import type { Project, ProjectStatus, State } from "../types";
import { ERROR_CLASS, fmtMs, missingKeyInfo, p50, pct, timeAgo, tokens } from "../ui";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";
import { SceneConfigModal } from "./SceneConfigModal";

type Act = (type: string, payload?: unknown) => Promise<any>;

const PROJECT_STATUS: Record<ProjectStatus, string> = {
  planned: "计划中", in_progress: "进行中", paused: "已暂停", completed: "已完成", cancelled: "已取消",
};

export function Projects({ state, now, act, notify, onAdd, onSwitch, onNewTask }: {
  state: State; now: number; act: Act; notify: (m: string) => void; onAdd: () => void; onSwitch: (id: string) => void; onNewTask: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "open" | "paused">("all");
  const [sceneProject, setSceneProject] = useState<Project | null>(null);
  const [sort, setSort] = useState<"recent" | "name" | "running" | "status">("recent");
  const [layout, setLayout] = useState<"cards" | "list">(() => {
    try { return localStorage.getItem("ymh.projects.layout") === "list" ? "list" : "cards"; } catch { return "cards"; }
  });
  useEffect(() => { try { localStorage.setItem("ymh.projects.layout", layout); } catch { /* ignore */ } }, [layout]);
  const active = state.projects.find((p) => p.id === state.activeProjectId) ?? null;
  const activeTodos = state.todos.filter((t) => t.projectId === state.activeProjectId);
  const running = state.runs.filter((r) => activeTodos.some((t) => t.id === r.todoId) && ["queued", "running", "waiting_input"].includes(r.status)).length;
  const enriched = state.projects.map((p) => {
    const todos = state.todos.filter((t) => t.projectId === p.id);
    const isActive = p.id === state.activeProjectId;
    const open = todos.filter((t) => !t.confirmed).length;
    const confirmed = todos.filter((t) => t.confirmed).length;
    const busy = state.runs.filter((r) => todos.some((t) => t.id === r.todoId) && ["queued", "running", "waiting_input"].includes(r.status)).length;
    return { p, todos, isActive, open, confirmed, busy };
  });
  const filtered = enriched
    .filter(({ p }) => {
      const q = query.trim().toLowerCase();
      return !q || `${p.name} ${p.alias} ${p.path}`.toLowerCase().includes(q);
    })
    .filter(({ open, busy, p }) => {
      if (filter === "running") return busy > 0;
      if (filter === "open") return open > 0;
      if (filter === "paused") return p.status === "paused";
      return true;
    })
    .sort((a, b) => {
      if (sort === "name") return a.p.name.localeCompare(b.p.name, "zh");
      if (sort === "running") return b.busy - a.busy || (b.p.lastOpenedAt || 0) - (a.p.lastOpenedAt || 0);
      if (sort === "status") return a.p.status.localeCompare(b.p.status) || a.p.name.localeCompare(b.p.name, "zh");
      return (b.p.lastOpenedAt || 0) - (a.p.lastOpenedAt || 0) || a.p.name.localeCompare(b.p.name, "zh");
    });
  const filterLabel = { all: "全部", running: "运行中", open: "未完成", paused: "已暂停" }[filter];
  const totalOpen = state.todos.filter((t) => !t.confirmed).length;
  const totalConfirmed = state.todos.filter((t) => t.confirmed).length;

  const startRename = (p: Project) => { setEditing(p.id); setDraft(p.name); };
  const saveRename = async (id: string) => {
    const name = draft.trim();
    if (!name) return;
    const res = await act("renameProject", { id, name });
    if (!res) return; // 失败时保留编辑态；act 已经弹过错误
    setEditing(null);
    notify("项目已重命名");
  };
  const remove = async (p: Project) => {
    if (!window.confirm(`移除项目“${p.name}”？不会删除磁盘上的文件。`)) return;
    const res = await act("removeProject", { id: p.id });
    if (res) notify("项目已移除");
  };

  const actionsFor = (p: Project, isActive: boolean) => (
    editing === p.id ? (
      <>
        <button className="btn tiny-btn primary" onClick={() => void saveRename(p.id)}>保存</button>
        <button className="btn tiny-btn" onClick={() => setEditing(null)}>取消</button>
      </>
    ) : (
      <>
        <button className="btn tiny-btn primary" disabled={isActive} onClick={() => onSwitch(p.id)}>{isActive ? "使用中" : "打开"}</button>
        <button className="btn tiny-btn" onClick={() => onNewTask(p.id)} title="在当前项目中新建任务">＋ 任务</button>
        <RowMenu title="更多项目操作">
          <button onClick={() => act("revealProject", { id: p.id })}>在 Finder 中显示</button>
          <button onClick={() => setSceneProject(p)}>执行配置</button>
          <button onClick={() => startRename(p)}>重命名</button>
          <label className="row-menu-label">状态
            <select className="project-status-select" value={p.status} onChange={(e) => act("setProjectStatus", { id: p.id, status: e.target.value })}>
              {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS[s]}</option>)}
            </select>
          </label>
          <button className="danger" onClick={() => void remove(p)}>移除项目</button>
        </RowMenu>
      </>
    )
  );

  return (
    <div className="page project-page">
      <PageHeader
        title="项目"
        subtitle={`${state.projects.length} 个项目 · 本地目录即项目；任务、终端和文件树跟随当前项目`}
        actions={<div className="row gap8">
          <div className="view-switch" role="group" aria-label="项目视图">
            <button className={layout === "cards" ? "on" : ""} onClick={() => setLayout("cards")} title="卡片视图">▦ 卡片</button>
            <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} title="列表视图">☰ 列表</button>
          </div>
          <button className="btn primary" onClick={onAdd}>＋ 添加项目</button>
        </div>}
      />

      <div className="project-overview">
        <div className="project-overview-item"><b>{state.projects.length}</b><span>项目</span></div>
        <div className="project-overview-item"><b>{totalOpen}</b><span>未完成</span></div>
        <div className={`project-overview-item ${running ? "run" : ""}`}><b>{running}</b><span>运行中</span></div>
        <div className="project-overview-item"><b>{totalConfirmed}</b><span>已确认</span></div>
        <div className="project-overview-item active-name"><span>当前项目</span><b>{active?.name || "—"}</b></div>
      </div>

      <section className="panel project-list-panel">
        <div className="project-list-head">
          <div className="row gap8">
            <b>工作区项目</b>
            <span className="tiny faint">{filtered.length}/{state.projects.length}{filter !== "all" ? ` · ${filterLabel}` : ""}</span>
          </div>
          <div className="project-list-tools">
            <select className="project-filter" aria-label="筛选项目" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">全部项目</option>
              <option value="running">运行中</option>
              <option value="open">有未完成任务</option>
              <option value="paused">已暂停</option>
            </select>
            <select className="project-filter" aria-label="项目排序" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="recent">最近打开</option>
              <option value="name">名称</option>
              <option value="running">运行中优先</option>
              <option value="status">状态</option>
            </select>
            <input
              className="project-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称 / 别名 / 路径"
              aria-label="搜索项目"
            />
          </div>
        </div>

        {filtered.length > 0 ? (
          layout === "cards" ? (
          <div className="project-grid">
            {filtered.map((entry) => {
              const { p, todos, isActive, open, confirmed, busy } = entry;
              return (
                <article className={`project-card ${isActive ? "on" : ""}`} key={p.id}>
                  <header className="project-card-head">
                    <div className={`project-mark ${p.color}`}>{p.name.trim().slice(0, 1).toUpperCase() || "P"}</div>
                    <div className="project-card-title">
                      <div className="row gap6 wrap">
                        {editing === p.id ? (
                          <input
                            className="project-name-input"
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") void saveRename(p.id); if (e.key === "Escape") setEditing(null); }}
                          />
                        ) : <b className="ellipsis">{p.name}</b>}
                        <span className="tag mono">@{p.alias}</span>
                        {isActive && <span className="tag ok">当前</span>}
                        <span className={`tag project-status ${p.status}`}>{PROJECT_STATUS[p.status] || p.status}</span>
                      </div>
                      <div className="project-card-path mono tiny muted ellipsis" title={p.path}>{p.path}</div>
                    </div>
                  </header>

                  <div className="project-card-stats">
                    <span><b>{todos.length}</b>任务</span>
                    <span><b>{open}</b>未完成</span>
                    <span className={busy ? "run" : ""}><b>{busy}</b>运行中</span>
                    <span><b>{confirmed}</b>已确认</span>
                  </div>

                  <footer className="project-card-foot">
                    <span className="tiny faint">最近打开 {timeAgo(p.lastOpenedAt, now)} 前</span>
                    <div className="project-actions">{actionsFor(p, isActive)}</div>
                  </footer>
                </article>
              );
            })}
          </div>
          ) : (
            <div className="project-list-rows">
              {filtered.map((entry) => {
                const { p, todos, isActive, open, confirmed, busy } = entry;
                return (
                  <div className={`project-list-item ${isActive ? "on" : ""}`} key={p.id}>
                    <div className="project-list-main">
                      <div className={`project-mark ${p.color}`}>{p.name.trim().slice(0, 1).toUpperCase() || "P"}</div>
                      <div className="project-list-title">
                        <div className="row gap6 wrap">
                          {editing === p.id ? (
                            <input
                              className="project-name-input"
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") void saveRename(p.id); if (e.key === "Escape") setEditing(null); }}
                            />
                          ) : <b className="ellipsis">{p.name}</b>}
                          <span className="tag mono">@{p.alias}</span>
                          {isActive && <span className="tag ok">当前</span>}
                          <span className={`tag project-status ${p.status}`}>{PROJECT_STATUS[p.status] || p.status}</span>
                        </div>
                        <div className="project-card-path mono tiny muted ellipsis" title={p.path}>{p.path}</div>
                      </div>
                    </div>
                    <div className="project-list-stats">
                      <span><b>{todos.length}</b>任务</span>
                      <span><b>{open}</b>未完成</span>
                      <span className={busy ? "run" : ""}><b>{busy}</b>运行中</span>
                      <span><b>{confirmed}</b>已确认</span>
                    </div>
                    <span className="project-list-time tiny faint">最近打开 {timeAgo(p.lastOpenedAt, now)} 前</span>
                    <div className="project-actions">{actionsFor(p, isActive)}</div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <EmptyState compact title={query ? "没有匹配的项目" : "还没有项目"} desc={query ? "换个关键词试试。" : "添加一个本地目录，任务、终端和文件树会跟随项目。"} action={!query ? <button className="btn primary" onClick={onAdd}>＋ 添加项目</button> : undefined} />
        )}
      </section>

      {sceneProject && (
        <SceneConfigModal
          key={sceneProject.id}
          project={sceneProject}
          text={(state.scenes || []).find((s) => s.projectId === sceneProject.id)?.text || ""}
          act={act}
          notify={notify}
          onClose={() => setSceneProject(null)}
        />
      )}
    </div>
  );
}

const HOST_STATUS: Record<string, string> = { online: "在线", offline: "离线", probing: "检测中" };

export function Hosts({ state, act, notify, now }: { state: State; act: Act; notify: (m: string) => void; now: number }) {
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [probingAll, setProbingAll] = useState(false);
  const [editingHost, setEditingHost] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", addr: "", user: "", port: "22", path: "" });
  const [layout, setLayout] = useState<"cards" | "list">(() => {
    try { return localStorage.getItem("ymh.hosts.layout") === "list" ? "list" : "cards"; } catch { return "cards"; }
  });
  useEffect(() => { try { localStorage.setItem("ymh.hosts.layout", layout); } catch { /* ignore */ } }, [layout]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const online = state.hosts.filter((h) => h.status === "online").length;
  const activeRuns = state.runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length;

  // 只在「主机页可见」时心跳：离开页面即停，不做常驻守护进程
  useEffect(() => {
    let alive = true;
    const beat = async () => { if (alive) await act("probeHosts", {}); };
    void beat();
    const timer = setInterval(beat, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [act]);

  const resetForm = () => {
    setForm({ name: "", addr: "", user: "", port: "22", path: "" });
    setEditingHost(null);
  };
  const openAdd = () => {
    resetForm();
    setOpen(true);
  };
  const openEdit = (host: State["hosts"][number]) => {
    setEditingHost(host.id);
    setForm({ name: host.name, addr: host.addr, user: host.user || "", port: String(host.port || 22), path: host.defaultCwd || "" });
    setOpen(true);
  };
  const probeAll = async () => {
    setProbingAll(true);
    try { await act("probeHosts", {}); } finally { setProbingAll(false); }
  };
  const probe = async (id: string) => {
    setProbing((p) => ({ ...p, [id]: true }));
    const res = await act("probeHost", { id });
    setProbing((p) => ({ ...p, [id]: false }));
    if (res && res.ok === false) notify(res.error || "探测失败");
  };
  const saveHost = async () => {
    if (!form.name.trim() || !form.addr.trim()) { notify("主机名和地址必填"); return; }
    const payload = { name: form.name.trim(), addr: form.addr.trim(), user: form.user.trim(), port: Number(form.port) || 22, path: form.path.trim() };
    if (editingHost) {
      const res = await act("updateHost", { id: editingHost, ...payload });
      if (!res?.ok) { notify(`探测失败：${res?.error || "未知原因"}`); return; }
      setOpen(false);
      resetForm();
      notify("主机已更新");
      return;
    }
    const res = await act("addHost", payload);
    // addHost 即使探测失败也已经把主机加进列表；这里关闭表单，避免重复添加
    setOpen(false);
    resetForm();
    notify(res?.ok ? "已添加" : `已添加，探测失败：${res?.error || "未知原因"}`);
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`移除主机「${name}」？已绑定的 Agent 需要先移回本机。`)) return;
    const ok = await act("removeHost", { id });
    if (ok) notify("主机已移除");
  };

  const actionsFor = (h: State["hosts"][number], isProbing: boolean) => (
    <>
      <button className="btn tiny-btn" disabled={isProbing} onClick={() => void probe(h.id)}>{isProbing ? "探测中…" : "重新探测"}</button>
      {h.kind !== "local" && <button className="btn tiny-btn" onClick={() => openEdit(h)}>编辑</button>}
      {h.kind !== "local" && <button className="btn tiny-btn danger" onClick={() => void remove(h.id, h.name)}>移除</button>}
    </>
  );

  return (
    <div className="page host-page">
      <PageHeader
        title="主机"
        subtitle={`${online}/${state.hosts.length} 在线 · Agent 的运行位置；本机与 SSH 共用一套并发 / 审批 / 探测`}
        actions={<div className="row gap8">
          <div className="view-switch" role="group" aria-label="主机视图">
            <button className={layout === "cards" ? "on" : ""} onClick={() => setLayout("cards")} title="卡片视图">▦ 卡片</button>
            <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} title="列表视图">☰ 列表</button>
          </div>
          <button className="btn" disabled={probingAll} onClick={() => void probeAll()}>{probingAll ? "探测中…" : "全部探测"}</button>
          <button className="btn primary" onClick={() => (open ? setOpen(false) : openAdd())}>＋ 添加主机</button>
        </div>}
      />

      <div className="project-overview host-overview-bar">
        <div className="project-overview-item"><b>{online}/{state.hosts.length}</b><span>在线主机</span></div>
        <div className="project-overview-item"><b>{state.agents.length}</b><span>Agent</span></div>
        <div className={`project-overview-item ${activeRuns ? "run" : ""}`}><b>{activeRuns}</b><span>运行中</span></div>
        <div className="project-overview-item"><b>{(state.cliCapabilities || []).length}</b><span>可用 CLI</span></div>
      </div>

      {open && (
        <section className="panel host-form">
          <div className="panel-head">{editingHost ? "编辑主机" : "添加主机"}<span className="tiny muted">保存后会立即探测一次</span></div>
          <div className="form-row">
            <label>名称<input value={form.name} onChange={set("name")} placeholder="lab-gpu" /></label>
            <label>host / IP<input value={form.addr} onChange={set("addr")} placeholder="10.0.8.21" /></label>
            <label>用户<input value={form.user} onChange={set("user")} placeholder="spin" /></label>
            <label>端口<input value={form.port} onChange={set("port")} /></label>
          </div>
          <div className="form-row">
            <label>远端 cwd<input value={form.path} onChange={set("path")} placeholder="/home/spin/work" /></label>
          </div>
          <div className="row gap8" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => { setOpen(false); resetForm(); }}>取消</button>
            <button className="btn primary" onClick={() => void saveHost()} disabled={!form.name.trim() || !form.addr.trim()}>
              {editingHost ? "保存并探测" : "添加并探测"}
            </button>
          </div>
        </section>
      )}

      {state.hosts.length === 0 && (
        <EmptyState compact title="还没有主机" desc="添加本机或 SSH 主机，Agent 才能在上面运行。" action={<button className="btn primary" onClick={openAdd}>＋ 添加主机</button>} />
      )}

      {layout === "cards" ? (
      <div className="host-cards host-grid">
        {state.hosts.map((h) => {
          const caps = h.caps || [];
          const agents = state.agents.filter((a) => a.hostId === h.id);
          const busy = state.runs.filter((r) => r.hostId === h.id && ["queued", "running", "waiting_input"].includes(r.status)).length;
          const limit = h.maxConcurrency || 0;
          const isProbing = probing[h.id];
          return (
            <section className={`panel host-card host-panel ${h.status}`} key={h.id}>
              <header className="host-card-head">
                <div className="host-card-title">
                  <span className={`dot ${h.status === "online" ? "green" : h.status === "offline" ? "red" : "amber"}`} />
                  <div>
                    <div className="row gap6 wrap">
                      <b>{h.name}</b>
                      <span className="tag mono">{h.kind === "local" ? "本机" : "ssh"}</span>
                      <span className={`tag ${h.status === "online" ? "ok" : ""}`}>{isProbing ? "检测中" : HOST_STATUS[h.status] || h.status}</span>
                      {isProbing && <span className="live" title="探测中" />}
                    </div>
                    <span className="mono tiny faint ellipsis" title={h.kind === "ssh" ? `${h.user ? `${h.user}@` : ""}${h.addr}:${h.port || 22}` : h.addr}>
                      {h.kind === "ssh" ? `${h.user ? `${h.user}@` : ""}${h.addr}:${h.port || 22}` : h.addr}
                    </span>
                  </div>
                </div>
                <div className="host-head-actions">{actionsFor(h, Boolean(isProbing))}</div>
              </header>

              <div className="host-panel-body">
                <div className="host-cap-block">
                  <div className="host-block-head"><span>可用 CLI</span><em>{caps.length}</em></div>
                  <div className="host-cap-list">
                    {caps.map((c) => (
                      <div className="host-cap-row" key={c.cli} title={c.path || c.cli}>
                        <b className="mono">{c.cli}</b>
                        <span className="mono tiny muted">{c.version}</span>
                        <em className="mono tiny faint ellipsis">{c.path || "—"}</em>
                      </div>
                    ))}
                    {caps.length === 0 && <span className="tiny muted">{h.kind === "local" ? "未检测到 CLI" : "未探测"}</span>}
                  </div>
                </div>
                <div className="host-meta-grid">
                  <div><span>负载</span><b>{busy}{limit ? `/${limit}` : ""}</b></div>
                  <div><span>延迟</span><b>{h.latencyMs == null ? "—" : `${h.latencyMs}ms`}</b></div>
                  <div><span>探测</span><b>{h.lastProbe ? `${timeAgo(h.lastProbe, now)} 前` : "未探测"}</b></div>
                  <div><span>Agent</span><b>{agents.length}</b></div>
                </div>
              </div>

              <div className="host-concurrency">
                <span className="tiny muted">并发上限</span>
                <HostMaxInput value={limit} onCommit={(max) => void act("setHostMax", { id: h.id, max })} />
                <span className="tiny faint">0 = 不限；新 run 生效</span>
              </div>

              {h.probeError && <div className="host-probe-error tiny red ellipsis" title={h.probeError}>{h.probeError}</div>}

              {agents.length > 0 && (
                <div className="host-agents">
                  <div className="host-block-head"><span>Agent</span><em>{agents.length}</em></div>
                  {agents.map((a) => (
                    <div className="host-agent-row" key={a.id}>
                      <span className={`dot ${a.color}`} />
                      <span className="ellipsis">{a.name}</span>
                      <span className="tag mono">@{a.alias}</span>
                      <select
                        className="project-status-select"
                        value={a.hostId}
                        title="切换 Agent 运行主机（下一次运行生效）"
                        onChange={(e) => {
                          const hostId = e.target.value;
                          const targetName = state.hosts.find((x) => x.id === hostId)?.name || hostId;
                          if (hostId !== a.hostId && !window.confirm(`把「${a.name}」移到 ${targetName}？下一次运行生效。`)) {
                            e.currentTarget.value = a.hostId;
                            return;
                          }
                          void act("setAgentHost", { agentId: a.id, hostId }).then((r) => {
                            if (r) notify(`${a.name} → ${targetName}`);
                          });
                        }}
                      >
                        {state.hosts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      ) : (
        <div className="host-list-rows">
          {state.hosts.map((h) => {
            const caps = h.caps || [];
            const agents = state.agents.filter((a) => a.hostId === h.id);
            const busy = state.runs.filter((r) => r.hostId === h.id && ["queued", "running", "waiting_input"].includes(r.status)).length;
            const limit = h.maxConcurrency || 0;
            const isProbing = probing[h.id];
            return (
              <div className={`panel host-list-item ${h.status} ${h.status === "offline" ? "offline" : ""}`} key={h.id}>
                <div className="host-list-main">
                  <span className={`dot ${h.status === "online" ? "green" : h.status === "offline" ? "red" : "amber"}`} />
                  <div className="host-list-title">
                    <div className="row gap6 wrap">
                      <b>{h.name}</b>
                      <span className="tag mono">{h.kind === "local" ? "本机" : "ssh"}</span>
                      <span className={`tag ${h.status === "online" ? "ok" : ""}`}>{isProbing ? "检测中" : HOST_STATUS[h.status] || h.status}</span>
                    </div>
                    <span className="mono tiny faint ellipsis" title={h.addr}>{h.kind === "ssh" ? `${h.user ? `${h.user}@` : ""}${h.addr}:${h.port || 22}` : h.addr}</span>
                  </div>
                </div>
                <div className="host-list-metrics">
                  <span><b>{caps.length}</b>CLI</span>
                  <span><b>{busy}{limit ? `/${limit}` : ""}</b>负载</span>
                  <span><b>{agents.length}</b>Agent</span>
                  <span><b>{h.latencyMs != null ? `${h.latencyMs}ms` : "—"}</b>延迟</span>
                </div>
                <span className="host-list-probe tiny faint">探测 {h.lastProbe ? `${timeAgo(h.lastProbe, now)} 前` : "—"}</span>
                <div className="host-head-actions">{actionsFor(h, Boolean(isProbing))}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HostMaxInput({ value, onCommit }: { value: number; onCommit: (max: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Math.max(0, Math.round(Number(draft) || 0));
    if (next !== value) onCommit(next);
    else setDraft(String(value));
  };
  return (
    <input
      className="host-max-input"
      value={draft}
      inputMode="numeric"
      aria-label="并发上限（0 为不限）"
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { setDraft(String(value)); e.currentTarget.blur(); }
      }}
    />
  );
}

const RANGES: { id: string; label: string; ms: number }[] = [
  { id: "today", label: "24h", ms: 24 * 3600e3 },
  { id: "7d", label: "7 天", ms: 7 * 24 * 3600e3 },
  { id: "30d", label: "30 天", ms: 30 * 24 * 3600e3 },
  { id: "all", label: "全部", ms: 0 },
];

export function Stats({ state, onOpen }: { state: State; onOpen: (todoId: string) => void }) {
  const [range, setRange] = useState("7d");
  const [scope, setScope] = useState("all");
  const [errFilter, setErrFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"agent" | "project" | "host" | "runtime">("agent");

  const rangeMs = RANGES.find((r) => r.id === range)?.ms ?? 0;
  const cutoff = rangeMs ? Date.now() - rangeMs : 0;
  const runs = state.runs.filter((r) => {
    const ts = r.createdAt || r.startedAt || 0;
    if (ts < cutoff) return false;
    if (scope !== "all") {
      const projectId = state.todos.find((t) => t.id === r.todoId)?.projectId;
      if (projectId !== scope) return false;
    }
    return true;
  });
  const done = runs.filter((r) => r.status === "completed" || r.status === "failed");
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const durations = runs.map((r) => r.durationMs ?? (r.startedAt && r.endedAt ? r.endedAt - r.startedAt : null)).filter((v): v is number => v != null);
  const waits = runs.map((r) => r.queueWaitMs).filter((v): v is number => v != null);
  const reported = done.filter((r) => r.usageSource === "acp" && r.tokens != null);
  const tokensIn = reported.reduce((s, r) => s + (r.tokensIn || 0), 0);
  const tokensOut = reported.reduce((s, r) => s + (r.tokensOut || 0), 0);
  const unreported = done.filter((r) => r.usageSource !== "acp").length;

  const errorCounts = { auth: 0, rate_limit: 0, timeout: 0, other: 0 } as Record<string, number>;
  for (const r of runs.filter((x) => x.status === "failed")) errorCounts[r.errorClass || "other"] += 1;

  // 趋势：按天分桶（全部时最多 14 天，避免柱子细到看不见）
  const days = range === "today" ? 12 : range === "7d" ? 7 : range === "30d" ? 30 : 14;
  const buckets = Array.from({ length: days }, (_, i) => {
    const step = (rangeMs || days * 24 * 3600e3) / days;
    const start = (rangeMs ? Date.now() - rangeMs : Date.now() - days * 24 * 3600e3) + i * step;
    const mine = runs.filter((r) => {
      const ts = r.createdAt || r.startedAt || 0;
      return ts >= start && ts < start + step;
    });
    return { start, ok: mine.filter((r) => r.status === "completed").length, bad: mine.filter((r) => r.status === "failed").length };
  });
  const maxBucket = Math.max(1, ...buckets.map((b) => b.ok + b.bad));
  const yMax = Math.max(4, Math.ceil(maxBucket / 4) * 4);
  const yTicks = [yMax, Math.round((yMax * 3) / 4), Math.round(yMax / 2), Math.round(yMax / 4), 0];
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : 5;
  const bucketLabel = (start: number) => {
    const d = new Date(start);
    if (range === "today") return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (range === "7d") return d.toLocaleDateString(undefined, { weekday: "short" });
    if (range === "30d") return String(d.getDate());
    return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  };

  const groups = (() => {
    const map = new Map<string, { label: string; color: string; runs: number; ok: number; bad: number; ms: number[]; tokens: number }>();
    for (const r of runs) {
      let key = "—"; let label = "未归属"; let color = "slate";
      if (groupBy === "agent") {
        const a = state.agents.find((x) => x.id === r.agentId);
        if (a) { key = a.id; label = a.name; color = a.color; }
      } else if (groupBy === "host") {
        const h = state.hosts.find((x) => x.id === r.hostId);
        if (h) { key = h.id; label = h.name; color = h.status === "online" ? "green" : "red"; }
      } else if (groupBy === "runtime") {
        key = r.runtime || (r.terminalId || r.trigger === "terminal" ? "terminal" : "acp");
        label = key === "terminal" ? "终端 pty" : "ACP";
        color = key === "terminal" ? "amber" : "blue";
      } else {
        const t = state.todos.find((x) => x.id === r.todoId);
        const p = state.projects.find((x) => x.id === t?.projectId);
        if (p) { key = p.id; label = p.name; color = p.color; }
      }
      const g = map.get(key) || { label, color, runs: 0, ok: 0, bad: 0, ms: [] as number[], tokens: 0 };
      g.runs += 1;
      if (r.status === "completed") g.ok += 1;
      if (r.status === "failed") g.bad += 1;
      if (r.durationMs != null) g.ms.push(r.durationMs);
      g.tokens += r.tokens || 0;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.runs - a.runs);
  })();
  const maxGroup = Math.max(1, ...groups.map((g) => g.runs));

  const failures = runs
    .filter((r) => r.status === "failed")
    .filter((r) => !errFilter || (r.errorClass || "other") === errFilter)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, 8);

  const exportCsv = () => {
    const head = ["run", "task", "agent", "host", "runtime", "status", "error_class", "duration_ms", "queue_wait_ms", "tokens_in", "tokens_out", "usage_source", "created_at", "error"];
    const rows = runs.map((r) => {
      const t = state.todos.find((x) => x.id === r.todoId);
      const a = state.agents.find((x) => x.id === r.agentId);
      const h = state.hosts.find((x) => x.id === r.hostId);
      return [r.id, t?.title || "", a?.name || "", h?.name || "", r.runtime || "", r.status, r.errorClass || "", r.durationMs ?? "", r.queueWaitMs ?? "", r.tokensIn ?? "", r.tokensOut ?? "", r.usageSource || "unknown", r.createdAt || r.startedAt || "", (r.error || "").replace(/\s+/g, " ")];
    });
    const csv = [head, ...rows].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `runs-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="page stats-page">
      <PageHeader
        title="统计"
        subtitle={`${scope === "all" ? "全部项目" : state.projects.find((p) => p.id === scope)?.name || "项目"} · ${runs.length} 次运行 / ${completed} 成功 / ${failed} 失败`}
        actions={<div className="row gap6 stats-actions">
          <select className="settings-control stats-scope" value={scope} onChange={(e) => setScope(e.target.value)} title="统计范围">
            <option value="all">全部项目</option>
            {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="seg stats-range">
            {RANGES.map((r) => (
              <button key={r.id} className={`seg-btn ${range === r.id ? "on" : ""}`} onClick={() => setRange(r.id)}>{r.label}</button>
            ))}
          </div>
          <button className="btn tiny-btn" onClick={exportCsv}>导出 CSV</button>
        </div>}
      />

      <div className="stats-overview">
        <article className="stats-tile ok">
          <div className="stats-tile-head"><span>成功率</span><em>{failed ? `${failed} 失败` : done.length ? "运行稳定" : "暂无完成"}</em></div>
          <b>{pct(completed, done.length)}</b>
          <small>{completed}/{done.length} 成功 · {runs.length} 次运行</small>
          <div className="stats-meter"><i style={{ width: `${done.length ? (completed / done.length) * 100 : 0}%` }} /></div>
        </article>
        <article className="stats-tile time">
          <div className="stats-tile-head"><span>中位耗时</span><em>p50</em></div>
          <b>{fmtMs(p50(durations))}</b>
          <small>最慢 {fmtMs(Math.max(...durations, 0) || null)}</small>
        </article>
        <article className="stats-tile queue">
          <div className="stats-tile-head"><span>排队 p50</span><em>{runs.filter((r) => r.status === "queued").length} 排队中</em></div>
          <b>{fmtMs(p50(waits))}</b>
          <small>从入队到开始执行</small>
        </article>
        <article className="stats-tile token">
          <div className="stats-tile-head"><span>Token</span><em>{reported.length ? "ACP usage" : "未上报"}</em></div>
          <b className="stats-token-value">{reported.length ? `${tokens(tokensIn)} ↑ ${tokens(tokensOut)} ↓` : "—"}</b>
          <small>{reported.length}/{done.length} 次有 usage{unreported ? ` · ${unreported} 次未上报` : ""}</small>
        </article>
      </div>

      {runs.length === 0 ? (
        <section className="panel stats-empty-panel">
          <EmptyState compact title="所选范围内没有运行" desc="切换时间或项目范围，或先在工作区派一个任务。" />
        </section>
      ) : (
      <>
      <div className="stats-grid">
        <section className="panel">
          <div className="panel-head">
            每日运行
            <div className="trend-legend">
              <span><i className="ok" />成功 {runs.filter((r) => r.status === "completed").length}</span>
              <span><i className="bad" />失败 {runs.filter((r) => r.status === "failed").length}</span>
            </div>
          </div>
          {done.length === 0 ? <div className="trend-empty">所选范围内还没有完成或失败的运行<div className="tiny faint">排队 / 运行中的任务会在结束后进入趋势图。</div></div> : (
          <div className="trend-chart" role="img" aria-label={`每日运行趋势：成功 ${runs.filter((r) => r.status === "completed").length}，失败 ${runs.filter((r) => r.status === "failed").length}`}>
            <div className="trend-yaxis">
              {yTicks.map((t) => <span key={t}>{t}</span>)}
            </div>
            <div className="trend-plot">
              <div className="trend-grid">
                {yTicks.map((t) => <i key={t} />)}
              </div>
              <div className="trend-bars">
                {buckets.map((b, i) => {
                  const showLabel = i % labelEvery === 0 || i === buckets.length - 1;
                  return (
                    <div className="trend-col" key={i} title={`${new Date(b.start).toLocaleString()} · 成功 ${b.ok} / 失败 ${b.bad}`}>
                      <div className="trend-stack">
                        {(b.bad + b.ok) > 0 && (
                          <b className="trend-value" style={{ bottom: `${((b.bad + b.ok) / yMax) * 100}%` }}>{b.bad + b.ok}</b>
                        )}
                        {b.bad > 0 && <i className="bad" style={{ height: `${(b.bad / yMax) * 100}%` }} />}
                        {b.ok > 0 && <i className="ok" style={{ height: `${(b.ok / yMax) * 100}%` }} />}
                      </div>
                      <span>{showLabel ? bucketLabel(b.start) : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          )}
        </section>
        <section className="panel stats-error-panel">
          <div className="panel-head">失败分类 <span className="tiny muted">{failed} 次</span></div>
          <div className="error-cat-list">
            {Object.entries(ERROR_CLASS).map(([k, label]) => {
              const count = errorCounts[k] || 0;
              const maxError = Math.max(1, ...Object.values(errorCounts));
              return (
                <button
                  key={k}
                  className={`error-cat ${errFilter === k ? "on" : ""}`}
                  onClick={() => setErrFilter(errFilter === k ? null : k)}
                  title={k}
                >
                  <span>{label}</span><b>{count}</b>
                  <i><em style={{ width: `${(count / maxError) * 100}%` }} /></i>
                </button>
              );
            })}
          </div>
          {errFilter && <button className="btn tiny-btn error-clear" onClick={() => setErrFilter(null)}>清除筛选</button>}
          {failed === 0 && <div className="tiny muted stats-error-empty">没有失败记录</div>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          分组
          <div className="seg">
            {([["agent", "按 Agent"], ["project", "按项目"], ["host", "按主机"], ["runtime", "按执行方式"]] as const).map(([id, label]) => (
              <button key={id} className={`seg-btn ${groupBy === id ? "on" : ""}`} onClick={() => setGroupBy(id)}>{label}</button>
            ))}
          </div>
        </div>
        {groups.length > 0 && (
          <div className="agent-stat stats-group-head">
            <span /><span>{{ agent: "Agent", project: "项目", host: "主机", runtime: "执行方式" }[groupBy]}</span><span /><span>运行</span><span>成功率</span><span>中位耗时</span>
          </div>
        )}
        {groups.map((g) => (
          <div className="agent-stat" key={g.label}>
            <span className={`dot ${g.color}`} />
            <span className="name ellipsis">{g.label}</span>
            <div className="bar" title={`${g.runs} runs · ${pct(g.ok, g.ok + g.bad)} 成功`}><i style={{ width: `${(g.runs / maxGroup) * 100}%` }} /></div>
            <span className="mono tiny">{g.runs} run</span>
            <span className="mono tiny">{pct(g.ok, g.ok + g.bad)}</span>
            <span className="tiny muted">{fmtMs(p50(g.ms))}</span>
          </div>
        ))}
        {groups.length === 0 && <EmptyState compact title="没有运行记录" desc="所选时间范围内还没有任务运行。" />}
      </section>

      <section className="panel">
        <div className="panel-head">最近失败</div>
        {failures.map((r) => {
          const todo = state.todos.find((t) => t.id === r.todoId);
          const agent = state.agents.find((a) => a.id === r.agentId);
          const host = state.hosts.find((h) => h.id === r.hostId);
          return (
            <button className="fail-row fail-row-btn" key={r.id} onClick={() => todo && onOpen(todo.id)} disabled={!todo}>
              <span className="tag err-chip on">{ERROR_CLASS[r.errorClass || "other"] || "其他"}</span>
              <b className="ellipsis">{todo?.title || "—"}</b>
              <span className="tiny muted">{agent?.name || "—"}{host ? ` @ ${host.name}` : ""}</span>
              <span className="tiny muted">{fmtMs(r.durationMs)}</span>
              <span className="tiny red ellipsis" title={r.error || ""}>{r.error || "exit"}</span>
              {missingKeyInfo(r.error) && (
                <span
                  className="link tiny"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: { section: "execution", focus: "dshEnv" } }));
                  }}
                >配置密钥</span>
              )}
            </button>
          );
        })}
        {failures.length === 0 && <div className="stats-inline-empty">没有失败记录 · 这段时间内所有运行都正常结束。</div>}
      </section>
      </>
      )}
    </div>
  );
}
