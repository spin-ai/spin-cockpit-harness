import { useEffect, useState } from "react";
import type { Project, ProjectStatus, State } from "../types";
import { ERROR_CLASS, fmtMs, missingKeyInfo, p50, pct, timeAgo, tokens } from "../ui";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";

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

  return (
    <div className="page">
      <PageHeader
        title="项目"
        subtitle={`${state.projects.length} 个项目`}
        actions={<button className="btn primary" onClick={onAdd}>＋ 添加项目</button>}
      />

      <div className="kpis">
        <div className="kpi"><span>项目</span><b>{state.projects.length}</b></div>
        <div className="kpi"><span>当前任务</span><b>{activeTodos.length}</b></div>
        <div className="kpi"><span>运行中</span><b>{running}</b></div>
        <div className="kpi"><span>已完成</span><b>{activeTodos.filter((t) => t.confirmed).length}</b></div>
      </div>

      <section className="panel project-list">
        <div className="panel-head">工作区项目</div>
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
                    <RowMenu title="更多项目操作">
                      <button onClick={() => act("revealProject", { id: p.id })}>在 Finder 中显示</button>
                      <button onClick={() => startRename(p)}>重命名</button>
                      <label className="row-menu-label">状态
                        <select className="project-status-select" value={p.status} onChange={(e) => act("setProjectStatus", { id: p.id, status: e.target.value })}>
                          {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS[s]}</option>)}
                        </select>
                      </label>
                      <button className="danger" onClick={() => void remove(p)}>移除项目</button>
                    </RowMenu>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {state.projects.length === 0 && <EmptyState compact title="还没有项目" desc="添加一个本地目录，任务、终端和文件树会跟随项目。" action={<button className="btn primary" onClick={onAdd}>＋ 添加项目</button>} />}
      </section>
    </div>
  );
}

export function Inbox({ state, now, act, onOpen }: { state: State; now: number; act: Act; onOpen: (id: string) => void }) {
  return (
    <div className="page">
      <PageHeader
        title="收件箱"
        subtitle={`${state.inbox.filter((i) => !i.read).length} 未读`}
        actions={<button className="btn" onClick={() => act("readAllInbox")}>全部已读</button>}
      />
      <div className="panel">
        {state.inbox.map((i) => (
          <button key={i.id} className={`inbox-row ${i.read ? "read" : ""}`} onClick={() => { act("readInbox", { id: i.id }); onOpen(i.todoId); }}>
            <span className={`kind ${i.kind}`}>{i.kind === "failed" ? "!" : "✓"}</span>
            <span className="inbox-title">{i.title}</span>
            <span className="muted tiny">{timeAgo(i.at, now)} 前</span>
          </button>
        ))}
        {state.inbox.length === 0 && <EmptyState compact title="收件箱是空的" desc="任务完成、失败或等待确认时会出现在这里。" />}
      </div>
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
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const online = state.hosts.filter((h) => h.status === "online").length;

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

  return (
    <div className="page">
      <PageHeader
        title="主机"
        subtitle={`${online}/${state.hosts.length} 在线`}
        actions={<div className="row gap8">
          <button className="btn" disabled={probingAll} onClick={() => void probeAll()}>{probingAll ? "探测中…" : "全部探测"}</button>
          <button className="btn primary" onClick={() => (open ? setOpen(false) : openAdd())}>＋ 添加主机</button>
        </div>}
      />

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

      <div className="hosts-layout">
      <div className="host-cards">
        {state.hosts.map((h) => {
          const caps = h.caps || [];
          const agents = state.agents.filter((a) => a.hostId === h.id);
          const busy = state.runs.filter((r) => r.hostId === h.id && ["queued", "running", "waiting_input"].includes(r.status)).length;
          const limit = h.maxConcurrency || 0;
          const isProbing = probing[h.id];
          return (
            <section className={`panel host-card ${h.status}`} key={h.id}>
              <div className="host-card-head">
                <div className="row gap8" style={{ minWidth: 0 }}>
                  <span className={`dot ${h.status === "online" ? "green" : h.status === "offline" ? "red" : "amber"}`} />
                  <b className="ellipsis">{h.name}</b>
                  <span className="tag mono">{h.kind === "local" ? "本机" : "ssh"}</span>
                  {isProbing && <span className="live" title="探测中" />}
                </div>
                <div className="row gap6">
                  <span className="tiny muted mono">{h.kind === "ssh" ? `${h.user ? `${h.user}@` : ""}${h.addr}:${h.port || 22}` : h.addr}</span>
                  <span className={`tag ${h.status === "online" ? "ok" : ""}`}>{isProbing ? "检测中" : HOST_STATUS[h.status] || h.status}</span>
                </div>
              </div>

              <div className="host-caps">
                {caps.map((c) => (
                  <span className="tag mono host-cap" key={c.cli} title={c.path || c.cli}>
                    {c.cli}<i>{c.version}</i>
                  </span>
                ))}
                {caps.length === 0 && <span className="tiny muted">{h.kind === "local" ? "未检测到 CLI" : "未探测"}</span>}
              </div>

              <div className="host-meta tiny muted">
                <span>负载 {busy}{limit ? `/${limit}` : ""}</span>
                <span>延迟 {h.latencyMs == null ? "—" : `${h.latencyMs}ms`}</span>
                <span>{h.lastProbe ? `${timeAgo(h.lastProbe, now)}前探测` : "未探测"}</span>
                {agents.length > 0 && <span>{agents.length} Agent</span>}
              </div>

              {h.probeError && <div className="tiny red ellipsis" title={h.probeError}>{h.probeError}</div>}

              {agents.length > 0 && (
                <div className="host-agents">
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

              <div className="host-actions">
                <button className="btn tiny-btn" disabled={isProbing} onClick={() => void probe(h.id)}>{isProbing ? "探测中…" : "重新探测"}</button>
                <label className="tiny muted row gap6" title="并发上限；0 = 不限">
                  并发
                  <HostMaxInput value={limit} onCommit={(max) => void act("setHostMax", { id: h.id, max })} />
                </label>
                {h.kind !== "local" && <button className="btn tiny-btn" onClick={() => openEdit(h)}>编辑</button>}
                {h.kind !== "local" && <button className="btn tiny-btn danger" onClick={() => void remove(h.id, h.name)}>移除</button>}
              </div>
            </section>
          );
        })}
      </div>
      <aside className="hosts-side">
        <section className="panel">
          <div className="panel-head">主机概览</div>
          <div className="host-overview">
            <div><span>在线主机</span><b>{online}/{state.hosts.length}</b></div>
            <div><span>Agent</span><b>{state.agents.length}</b></div>
            <div><span>运行中</span><b>{state.runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length}</b></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">可用 CLI</div>
          <div className="row gap6 wrap">
            {(state.cliCapabilities || []).map((c) => <span className="tag mono" key={c}>{c}</span>)}
            {(state.cliCapabilities || []).length === 0 && <span className="muted small">—</span>}
          </div>
        </section>
      </aside>
      </div>
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
    <div className="page">
      <PageHeader
        title="统计"
        subtitle={scope === "all" ? "全部项目" : state.projects.find((p) => p.id === scope)?.name || "项目"}
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

      <div className="kpis">
        <div className="kpi"><span>成功率</span><b>{pct(completed, done.length)}</b><small>{completed}/{done.length} · {failed} 失败</small></div>
        <div className="kpi"><span>中位耗时</span><b>{fmtMs(p50(durations))}</b><small>最慢 {fmtMs(Math.max(...durations, 0) || null)}</small></div>
        <div className="kpi"><span>排队 p50</span><b>{fmtMs(p50(waits))}</b><small>{runs.filter((r) => r.status === "queued").length} 排队中</small></div>
        <div className="kpi"><span>Token</span><b>{reported.length ? `${tokens(tokensIn)} ↑ ${tokens(tokensOut)} ↓` : "未上报"}</b><small>{reported.length}/{done.length} 已完成 run 有 usage{unreported ? ` · ${unreported} 未上报` : ""}</small></div>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            每日运行
            <div className="trend-legend">
              <span><i className="ok" />成功 {runs.filter((r) => r.status === "completed").length}</span>
              <span><i className="bad" />失败 {runs.filter((r) => r.status === "failed").length}</span>
            </div>
          </div>
          {runs.length === 0 ? <div className="muted small">所选范围内没有运行</div> : (
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
        <section className="panel">
          <div className="panel-head">失败分类</div>
          <div className="row gap6 wrap">
            {Object.entries(ERROR_CLASS).map(([k, label]) => (
              <button
                key={k}
                className={`tag err-chip ${errFilter === k ? "on" : ""}`}
                onClick={() => setErrFilter(errFilter === k ? null : k)}
                title={k}
              >
                {label} {errorCounts[k] || 0}
              </button>
            ))}
            {errFilter && <button className="btn tiny-btn" onClick={() => setErrFilter(null)}>清除筛选</button>}
          </div>
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
        {failures.length === 0 && <EmptyState compact title="没有失败记录" desc="这段时间内所有运行都正常结束。" />}
      </section>
    </div>
  );
}
