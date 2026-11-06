import { useEffect, useState } from "react";
import type { Project, ProjectStatus, State } from "../types";
import { ERROR_CLASS, fmtMs, p50, pct, timeAgo, tokens } from "../ui";

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
        <div><h2>项目</h2><span className="muted">{state.projects.length} 个项目</span></div>
        <button className="btn primary" onClick={onAdd}>＋ 添加项目</button>
      </div>

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
        {state.projects.length === 0 && <div className="muted small">还没有项目</div>}
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
const HOST_STATUS: Record<string, string> = { online: "在线", offline: "离线", probing: "检测中" };

export function Hosts({ state, act, notify, now }: { state: State; act: Act; notify: (m: string) => void; now: number }) {
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState<Record<string, boolean>>({});
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

  const probe = async (id: string) => {
    setProbing((p) => ({ ...p, [id]: true }));
    const res = await act("probeHost", { id });
    setProbing((p) => ({ ...p, [id]: false }));
    if (res && res.ok === false) notify(res.error || "探测失败");
  };
  const add = async () => {
    if (!form.name.trim() || !form.addr.trim()) return;
    const res = await act("addHost", { name: form.name.trim(), addr: form.addr.trim(), user: form.user.trim(), port: Number(form.port) || 22, path: form.path.trim() });
    setOpen(false);
    setForm({ name: "", addr: "", user: "", port: "22", path: "" });
    notify(res?.ok ? "已添加" : `探测失败：${res?.error || "未知原因"}`);
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`移除主机「${name}」？已绑定的 Agent 需要先移回本机。`)) return;
    const ok = await act("removeHost", { id });
    if (ok) notify("主机已移除");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h2>主机</h2><span className="muted">{online}/{state.hosts.length} 在线</span></div>
        <div className="row gap8">
          <button className="btn" onClick={() => void act("probeHosts", {})}>全部探测</button>
          <button className="btn primary" onClick={() => setOpen((v) => !v)}>＋ 添加主机</button>
        </div>
      </div>

      {open && (
        <section className="panel host-form">
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
            <button className="btn" onClick={() => setOpen(false)}>取消</button>
            <button className="btn primary" onClick={() => void add()}>添加并探测</button>
          </div>
        </section>
      )}

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
                        onChange={(e) => {
                          const hostId = e.target.value;
                          void act("setAgentHost", { agentId: a.id, hostId }).then((r) => {
                            if (r) notify(`${a.name} → ${state.hosts.find((x) => x.id === hostId)?.name}`);
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
                <button className="btn tiny-btn" disabled={isProbing} onClick={() => void probe(h.id)}>重新探测</button>
                <label className="tiny muted row gap6">
                  并发
                  <input
                    className="host-max-input"
                    value={limit}
                    onChange={(e) => void act("setHostMax", { id: h.id, max: Number(e.target.value) || 0 })}
                  />
                </label>
                {h.kind !== "local" && <button className="btn tiny-btn danger" onClick={() => void remove(h.id, h.name)}>移除</button>}
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel">
        <div className="panel-head">可用 CLI</div>
        <div className="row gap6 wrap">
          {(state.cliCapabilities || []).map((c) => <span className="tag mono" key={c}>{c}</span>)}
          {(state.cliCapabilities || []).length === 0 && <span className="muted small">—</span>}
        </div>
      </section>
    </div>
  );
}

const RANGES: { id: string; label: string; ms: number }[] = [
  { id: "today", label: "今天", ms: 24 * 3600e3 },
  { id: "7d", label: "7 天", ms: 7 * 24 * 3600e3 },
  { id: "30d", label: "30 天", ms: 30 * 24 * 3600e3 },
  { id: "all", label: "全部", ms: 0 },
];

export function Stats({ state, onOpen }: { state: State; onOpen: (todoId: string) => void }) {
  const [range, setRange] = useState("7d");
  const [errFilter, setErrFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"agent" | "project" | "host">("agent");

  const rangeMs = RANGES.find((r) => r.id === range)?.ms ?? 0;
  const cutoff = rangeMs ? Date.now() - rangeMs : 0;
  const runs = state.runs.filter((r) => {
    const ts = r.createdAt || r.startedAt || 0;
    return ts >= cutoff;
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
    const head = ["run", "task", "agent", "host", "status", "error_class", "duration_ms", "queue_wait_ms", "tokens_in", "tokens_out", "usage_source", "created_at", "error"];
    const rows = runs.map((r) => {
      const t = state.todos.find((x) => x.id === r.todoId);
      const a = state.agents.find((x) => x.id === r.agentId);
      const h = state.hosts.find((x) => x.id === r.hostId);
      return [r.id, t?.title || "", a?.name || "", h?.name || "", r.status, r.errorClass || "", r.durationMs ?? "", r.queueWaitMs ?? "", r.tokensIn ?? "", r.tokensOut ?? "", r.usageSource || "unknown", r.createdAt || r.startedAt || "", (r.error || "").replace(/\s+/g, " ")];
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
      <div className="page-head">
        <div><h2>统计</h2></div>
        <div className="row gap6">
          {RANGES.map((r) => (
            <button key={r.id} className={`btn tiny-btn ${range === r.id ? "primary" : ""}`} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
          <button className="btn tiny-btn" onClick={exportCsv}>导出 CSV</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span>成功率</span><b>{pct(completed, done.length)}</b><small>{completed}/{done.length} · {failed} 失败</small></div>
        <div className="kpi"><span>中位耗时</span><b>{fmtMs(p50(durations))}</b><small>最慢 {fmtMs(Math.max(...durations, 0) || null)}</small></div>
        <div className="kpi"><span>排队 p50</span><b>{fmtMs(p50(waits))}</b><small>{runs.filter((r) => r.status === "queued").length} 排队中</small></div>
        <div className="kpi"><span>Token</span><b>{reported.length ? `${tokens(tokensIn)} ↑ ${tokens(tokensOut)} ↓` : "未上报"}</b><small>{reported.length}/{done.length} 已完成 run 有 usage{unreported ? ` · ${unreported} 未上报` : ""}</small></div>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head">每日运行</div>
          <div className="trend">
            {buckets.map((b, i) => (
              <div className="trend-col" key={i} title={`${new Date(b.start).toLocaleString()} · 成功 ${b.ok} / 失败 ${b.bad}`}>
                <div className="trend-stack">
                  <i className="bad" style={{ height: `${(b.bad / maxBucket) * 100}%` }} />
                  <i className="ok" style={{ height: `${(b.ok / maxBucket) * 100}%` }} />
                </div>
                <span>{days <= 7 ? new Date(b.start).toLocaleDateString(undefined, { weekday: "short" }) : new Date(b.start).getDate()}</span>
              </div>
            ))}
          </div>
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
          <div className="row gap6">
            {([["agent", "按 Agent"], ["project", "按项目"], ["host", "按主机"]] as const).map(([id, label]) => (
              <button key={id} className={`btn tiny-btn ${groupBy === id ? "primary" : ""}`} onClick={() => setGroupBy(id)}>{label}</button>
            ))}
          </div>
        </div>
        {groups.map((g) => (
          <div className="agent-stat" key={g.label}>
            <span className={`dot ${g.color}`} />
            <span className="name ellipsis">{g.label}</span>
            <div className="bar"><i style={{ width: `${(g.runs / maxGroup) * 100}%` }} /></div>
            <span className="mono tiny">{g.runs} run</span>
            <span className="mono tiny">{pct(g.ok, g.ok + g.bad)}</span>
            <span className="tiny muted">{fmtMs(p50(g.ms))}</span>
          </div>
        ))}
        {groups.length === 0 && <div className="muted small">没有运行记录</div>}
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
            </button>
          );
        })}
        {failures.length === 0 && <div className="muted small">没有失败记录</div>}
      </section>
    </div>
  );
}
