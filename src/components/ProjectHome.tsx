import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectIssue, ProjectMilestone, Requirement, State } from "../types";
import { Requirements } from "./Requirements";
import { Overview } from "./Overview";
import { RowMenu } from "./RowMenu";
import { confirmDialog } from "./ConfirmHost";
import { EmptyState } from "./EmptyState";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from "./Icons";
import { agentOf } from "../ui";

type Act = (type: string, payload?: unknown) => Promise<any>;

const LEVEL_LABEL: Record<string, string> = { rr: "RR", ir: "IR", sr: "SR", us: "US" };
const REQ_STATUS: Record<string, string> = {
  draft: "草稿", reviewing: "待评审", approved: "已批准", in_progress: "实现中", verifying: "待验收", done: "已完成", rejected: "已拒绝", obsolete: "已废弃",
};
const ISSUE_KIND: Record<string, string> = { legacy: "遗留事项", task: "任务", issue: "问题" };
const ISSUE_STATUS: Record<string, string> = { open: "待处理", doing: "进行中", blocked: "受阻", resolved: "已解决", closed: "已关闭" };
const PROJECT_STATUS: Record<string, string> = { planned: "计划中", in_progress: "进行中", paused: "已暂停", completed: "已完成", cancelled: "已取消" };
const BOARD_COLS = ["draft", "reviewing", "approved", "in_progress", "verifying", "done"];
const DELIVERY = "us";

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayLabel = (ts: number) => { const d = new Date(ts); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmt = (ts: number) => { const d = new Date(ts); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const DAY = 86400000;

/** 需求 → 派出去的任务（看板 / 计划的实现者与「未派活」都由它算） */
function todosOf(state: State, reqId: string) {
  return (state.todos || []).filter((t) => t.requirementId === reqId);
}
function implementersOf(state: State, req: Requirement) {
  const names = new Set<string>();
  for (const t of todosOf(state, req.id)) {
    const agent = t.agentId ? agentOf(state.agents, t.agentId) : null;
    const bot = t.botId ? (state.bots || []).find((b) => b.id === t.botId) : null;
    const name = bot?.name || agent?.alias || agent?.name || "";
    if (name) names.add(name);
  }
  return [...names];
}
/** 责任人：可能是 bot / agent 的 id，也可能只是一个名字（遗留事项常直接写人） */
function ownerLabel(state: State, value?: string | null): string {
  if (!value) return "";
  const bot = (state.bots || []).find((b) => b.id === value);
  if (bot) return bot.name;
  const agent = (state.agents || []).find((a) => a.id === value);
  if (agent) return agent.alias || agent.name;
  return value;
}

function gapOf(state: State, req: Requirement, byId: Map<string, Requirement>) {
  const kids = (state.requirements || []).filter((r) => r.parentId === req.id);
  if ((req.level === "sr" || req.level === "us") && !(req.acceptance || []).length) return { type: "acceptance", label: "缺验收" };
  if (req.level === DELIVERY && req.status === "approved" && !todosOf(state, req.id).length) return { type: "unplanned", label: "未派活" };
  if (req.level !== DELIVERY && !kids.length) return { type: "downstream", label: "缺下游" };
  void byId;
  return null;
}

export function ProjectHome({ state, now, act, notify, onAddProject, onSwitchProject, onOpenTask, onOpenWorkspace }: {
  state: State; now: number; act: Act; notify: (message: string) => void;
  onAddProject: () => void;
  onSwitchProject: (id: string) => void;
  onOpenTask?: (id: string) => void;
  onOpenWorkspace?: () => void;
}) {
  const project = state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0] || null;
  const [tab, setTab] = useState<"pool" | "board" | "plan" | "items" | "sum">(() => {
    try { return (localStorage.getItem("ph.tab") as any) || "pool"; } catch { return "pool"; }
  });
  const [folded, setFolded] = useState<boolean>(() => { try { return localStorage.getItem("ph.fold") === "1"; } catch { return false; } });
  const [projQuery, setProjQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [issueKind, setIssueKind] = useState<string>("all");
  const [issueStatus, setIssueStatus] = useState<string>("all");
  const [issueQuery, setIssueQuery] = useState("");
  const [creatingIssue, setCreatingIssue] = useState<{ kind: string; title: string } | null>(null);
  const [boardBot, setBoardBot] = useState<string>("all");
  const [boardGap, setBoardGap] = useState(false);
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [msDraft, setMsDraft] = useState<{ name: string; date: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { try { localStorage.setItem("ph.tab", tab); } catch { /* ignore */ } }, [tab]);
  useEffect(() => { try { localStorage.setItem("ph.fold", folded ? "1" : "0"); } catch { /* ignore */ } }, [folded]);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const reqs = useMemo(() => (state.requirements || []).filter((r) => r.projectId === project?.id), [state.requirements, project?.id]);
  const byId = useMemo(() => new Map(reqs.map((r) => [r.id, r])), [reqs]);
  const issues = useMemo(() => (state.issues || []).filter((i) => i.projectId === project?.id), [state.issues, project?.id]);
  const gaps = useMemo(() => reqs.filter((r) => gapOf(state, r, byId)), [reqs, state, byId]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { notify(String((err as Error)?.message || err)); }
    void label;
  }, [notify]);

  const saveRename = async () => {
    const name = (renaming || "").trim();
    setRenaming(null);
    if (!name || !project || name === project.name) return;
    await run("rename", () => act("renameProject", { id: project.id, name }));
  };
  const removeProject = async () => {
    if (!project) return;
    if (!(await confirmDialog({ title: `移除项目「${project.name}」？`, desc: "不会删除磁盘上的文件；项目下还有任务或需求时不能移除。", ok: "移除", danger: true }))) return;
    await run("remove", () => act("removeProject", { id: project.id }));
  };

  const filteredProjects = state.projects.filter((p) => !projQuery.trim() || `${p.name} ${p.alias} ${p.path}`.toLowerCase().includes(projQuery.trim().toLowerCase()));

  if (!project) {
    return (
      <div className="ph-empty">
        <EmptyState title="还没有项目" desc="项目 = 一个本地目录。加进来之后，任务、终端、文件树和需求都跟着它。" action={<button className="btn primary" onClick={onAddProject}>添加项目</button>} />
      </div>
    );
  }

  const reqCount = reqs.length;
  const showAlias = Boolean(project.alias) && project.alias !== project.name;

  return (
    <div className={`ph${folded ? " is-folded" : ""}`}>
      <aside className="ph-col" aria-label="项目列表">
        <div className="ph-col-head">
          <b>项目</b><span className="ph-n mono">{state.projects.length}</span>
          <span className="ph-spacer" />
          <button className="icon-btn" title="收起项目列表" aria-label="收起项目列表" aria-expanded={true} onClick={() => setFolded(true)}>
            <ChevronLeftIcon size={14} />
          </button>
        </div>
        <div className="ph-col-tools">
          <SearchIcon size={13} className="ph-search-ico" />
          <input className="ph-search" value={projQuery} onChange={(e) => setProjQuery(e.target.value)} placeholder="搜索项目 / 别名 / 路径" aria-label="搜索项目" />
        </div>
        <div className="ph-proj-scroll">
          {filteredProjects.map((p) => {
            const pr = (state.requirements || []).filter((r) => r.projectId === p.id);
            const open = (state.todos || []).filter((t) => t.projectId === p.id && !t.confirmed).length;
            const on = p.id === project.id;
            return (
              <button key={p.id} className={`ph-proj${on ? " on" : ""}`} onClick={() => onSwitchProject(p.id)} aria-current={on ? "true" : "false"}>
                <span className="ph-row1">
                  <span className={`ph-dot ${p.status === "paused" ? "paused" : "on"}`} />
                  <b className="ellipsis">{p.name}</b>
                </span>
                <span className="ph-row2">
                  {p.alias && p.alias !== p.name ? <span className="mono">{`@${p.alias}`}</span> : null}
                  <span className="ph-cnt">{open ? `未完成 ${open}` : ""}{pr.length ? ` · 需求 ${pr.length}` : ""}</span>
                </span>
              </button>
            );
          })}
          {!filteredProjects.length && <div className="inline-empty">没有匹配的项目</div>}
        </div>
        <div className="ph-col-foot">
          <button className="ph-link" onClick={() => notify("全部需求（跨项目矩阵）还没做")}>全部需求</button>
          <button className="ph-link" onClick={onAddProject}><PlusIcon size={12} /> 添加项目</button>
        </div>
      </aside>

      <div className="ph-main">
        <div className="ph-head">
          <div className="ph-head-main">
            <div className="ph-title-row">
              {folded && (
                <button className="icon-btn" title="展开项目列表" aria-label="展开项目列表" aria-expanded={false} onClick={() => setFolded(false)}>
                  <ChevronRightIcon size={14} />
                </button>
              )}
              {renaming !== null ? (
                <input className="ph-rename" autoFocus value={renaming} aria-label="项目名"
                  onChange={(e) => setRenaming(e.target.value)}
                  onBlur={() => void saveRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setRenaming(null); return; }
                    if (e.key === "Enter") { e.preventDefault(); void saveRename(); }
                  }} />
              ) : (
              <div className="ph-trigger-wrap" ref={menuRef}>
                <button className="ph-trigger" aria-haspopup="menu" aria-expanded={menuOpen} title={`切换项目\n${project.path}`} onClick={() => setMenuOpen((v) => !v)}>
                  <span className="ph-name ellipsis">{project.name}</span>
                  {showAlias && <span className="ph-alias mono">{`@${project.alias}`}</span>}
                  <ChevronDownIcon size={13} className="ph-chev" />
                </button>
                {menuOpen && (
                  <div className="ph-menu" role="menu">
                    {state.projects.map((p) => {
                      const pr = (state.requirements || []).filter((r) => r.projectId === p.id);
                      const open = (state.todos || []).filter((t) => t.projectId === p.id && !t.confirmed).length;
                      return (
                        <button key={p.id} role="menuitemradio" aria-checked={p.id === project.id} className={`ph-menu-row${p.id === project.id ? " on" : ""}`}
                          onClick={() => { setMenuOpen(false); if (p.id !== project.id) onSwitchProject(p.id); }}>
                          <span className={`ph-dot ${p.status === "paused" ? "paused" : "on"}`} />
                          <b className="ellipsis">{p.name}</b>
                          <span className="ph-menu-meta">{open ? `未完成 ${open}` : ""}{pr.length ? ` · 需求 ${pr.length}` : ""}</span>
                          <span className="ph-menu-check">{p.id === project.id ? "✓" : ""}</span>
                        </button>
                      );
                    })}
                    <div className="ph-menu-sep" />
                    <button role="menuitem" className="ph-menu-row" onClick={() => { setMenuOpen(false); onAddProject(); }}>
                      <span className="ph-dot" /><b>＋ 添加项目</b>
                    </button>
                  </div>
                )}
              </div>
              )}
            </div>
            <div className="ph-meta">
              <select className="ph-status" value={project.status} aria-label="项目状态"
                onChange={(e) => void act("setProjectStatus", { id: project.id, status: e.target.value })}>
                {Object.entries(PROJECT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {project.path.split("/").filter(Boolean).at(-1) !== project.name && <span className="mono ellipsis">{project.path}</span>}
              {(state.bots || []).filter((b) => b.projectId === project.id).map((b) => <span key={b.id} className="ph-muted">{b.name} 接手</span>)}
            </div>
          </div>
          <div className="ph-head-actions">
            <button className="btn primary" onClick={() => { setTab("pool"); notify("在需求页点「新建需求」"); }}><PlusIcon size={13} /> 新建需求</button>
            <RowMenu title="项目操作">
              <button onClick={() => act("revealProject", { id: project.id })}>在 Finder 中显示</button>
              <button onClick={() => setTab("sum")}>项目汇总</button>
              <button onClick={() => setTab("items")}>事项台账</button>
              <button onClick={() => setRenaming(project.name)}>重命名</button>
              <button className="danger" onClick={() => void removeProject()}>移除项目</button>
              <button onClick={() => notify("导出追溯矩阵（CSV / Markdown）还没做")}>导出矩阵</button>
            </RowMenu>
          </div>
        </div>

        <Overview items={[
          { label: "任务", value: (state.todos || []).filter((t) => t.projectId === project.id).length },
          { label: "未完成", value: (state.todos || []).filter((t) => t.projectId === project.id && !t.confirmed).length },
          { label: "需求", value: reqCount },
          ...(gaps.length ? [{ label: "缺口", value: gaps.length, tone: "warn" as const }] : []),
        ].filter((x) => Number(x.value) > 0)} />

        <div className="ph-tabs" role="tablist" aria-label="项目视图">
          {([["pool", "需求"], ["board", "看板"], ["plan", "计划"], ["items", "事项"], ["sum", "汇总"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === "pool" && <Requirements state={state} act={act} notify={notify} embedded projectId={project.id} />}

        {tab === "board" && (
          <BoardPane state={state} reqs={reqs} project={project} byId={byId} botFilter={boardBot} gapOnly={boardGap}
            onBot={setBoardBot} onGap={setBoardGap} onOpen={(id) => { setTab("pool"); void id; }} />
        )}

        {tab === "plan" && <PlanPane reqs={reqs} onOpen={() => setTab("pool")} />}

        {tab === "items" && (
          <ItemsPane state={state} project={project} issues={issues} reqs={reqs}
            query={issueQuery} onQuery={setIssueQuery} kind={issueKind} onKind={setIssueKind}
            status={issueStatus} onStatus={setIssueStatus} openId={openIssue} onOpen={setOpenIssue}
            creating={creatingIssue} onCreating={setCreatingIssue}
            run={run} act={act} notify={notify} />
        )}

        {tab === "sum" && (
          <SummaryPane state={state} project={project} reqs={reqs} issues={issues} gaps={gaps} now={now}
            goalDraft={goalDraft} onGoalDraft={setGoalDraft} run={run} act={act}
            msDraft={msDraft} onMsDraft={setMsDraft} onOpenItems={() => setTab("items")} onOpenBoard={() => setTab("board")}
            onOpenWorkspace={onOpenWorkspace} onOpenTask={onOpenTask} />
        )}
      </div>
    </div>
  );
}

/* ── 看板 ───────────────────────────────────────────────────── */
function BoardPane({ state, reqs, project, byId, botFilter, gapOnly, onBot, onGap, onOpen }: {
  state: State; reqs: Requirement[]; project: Project; byId: Map<string, Requirement>;
  botFilter: string; gapOnly: boolean; onBot: (v: string) => void; onGap: (v: boolean) => void; onOpen: (id: string) => void;
}) {
  const delivery = reqs.filter((r) => r.level === DELIVERY);
  let list = delivery;
  if (botFilter === "none") list = list.filter((r) => !todosOf(state, r.id).length);
  else if (botFilter !== "all") list = list.filter((r) => todosOf(state, r.id).some((t) => (t.botId || t.agentId) === botFilter));
  if (gapOnly) list = list.filter((r) => gapOf(state, r, byId));

  const implOptions: { id: string; name: string }[] = [];
  for (const r of delivery) {
    for (const t of todosOf(state, r.id)) {
      const id = t.botId || t.agentId;
      if (!id || implOptions.some((o) => o.id === id)) continue;
      implOptions.push({ id, name: ownerLabel(state, id) || id });
    }
  }
  return (
    <div className="ph-pane">
      <section className="panel ph-board-panel">
        <div className="ph-tools">
          <select className="ph-select" aria-label="按实现者筛选" value={botFilter} onChange={(e) => onBot(e.target.value)}>
            <option value="all">全部实现者</option>
            <option value="none">未派活</option>
            {implOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label className="ph-check"><input type="checkbox" checked={gapOnly} onChange={(e) => onGap(e.target.checked)} /> 只看缺口</label>
          <span className="ph-spacer" />
          <span className="ph-note">交付层 {LEVEL_LABEL[DELIVERY]} · 拖拽与闸门未做</span>
        </div>
        <div className="ph-board">
          {BOARD_COLS.map((col) => {
            const items = list.filter((r) => r.status === col);
            return (
              <div className="ph-board-col" key={col}>
                <div className="ph-board-head"><span className={`req-dot ${col}`} />{REQ_STATUS[col]}<span className="ph-n mono">{items.length}</span></div>
                <div className="ph-board-cards">
                  {items.map((r) => {
                    const impl = implementersOf(state, r);
                    const gap = gapOf(state, r, byId);
                    return (
                      <button key={r.id} className="ph-card" onClick={() => onOpen(r.id)} title={r.title}>
                        <div className="ph-card-key mono">{r.key}</div>
                        <div className="ph-card-title">{r.title}</div>
                        <div className="ph-card-foot">
                          {impl.length
                            ? <span className="ellipsis">{impl.join(" / ")}</span>
                            : todosOf(state, r.id).length
                              ? <span className="ph-muted">待认领</span>
                              : <span className="ph-muted">—</span>}
                          <span className="ph-spacer" />
                          {gap && <span className="req-chip warn">{gap.label}</span>}
                          {(r.acceptance || []).length ? <span className="mono">验收 {(r.acceptance || []).filter((a) => a.done).length}/{(r.acceptance || []).length}</span> : null}
                        </div>
                      </button>
                    );
                  })}
                  {!items.length && <div className="inline-empty">—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div className="ph-hint">看板只读；点卡片回需求池看详情。项目：{project.name}</div>
    </div>
  );
}

/* ── 计划 ───────────────────────────────────────────────────── */
function PlanPane({ reqs, onOpen }: { reqs: Requirement[]; onOpen: () => void }) {
  const list = reqs.filter((r) => r.level === DELIVERY);
  const scheduled = list.filter((r) => r.planStart && r.planEnd);
  const unscheduled = list.filter((r) => !r.planStart || !r.planEnd);
  const span = 14;
  const rangeStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - 3 * DAY; })();
  const todayPct = ((new Date().setHours(0, 0, 0, 0) - rangeStart) / DAY) / span * 100;
  const groupOf = (r: Requirement) => {
    let cur: Requirement | undefined = r;
    while (cur?.parentId) cur = reqs.find((x) => x.id === cur!.parentId);
    return cur || r;
  };
  const groups = new Map<string, { root: Requirement; items: Requirement[] }>();
  for (const r of scheduled) {
    const root = groupOf(r);
    if (!groups.has(root.id)) groups.set(root.id, { root, items: [] });
    groups.get(root.id)!.items.push(r);
  }
  return (
    <div className="ph-pane">
      <section className="panel ph-board-panel">
        <div className="ph-tools">
          <b className="ph-tools-title">计划</b>
          <span className="ph-note">{LEVEL_LABEL[DELIVERY]} · 14 天窗口 · 今天 {dayLabel(Date.now())}</span>
          <span className="ph-spacer" />
          <span className="ph-note">排期在需求详情里填（起止日期）</span>
        </div>
        <div className="ph-gantt-wrap">
          {scheduled.length ? (
            <div className="ph-gantt">
              <div className="ph-gantt-head">
                <div className="ph-gantt-left">需求</div>
                <div className="ph-gantt-days">
                  {Array.from({ length: span }, (_, i) => <div key={i} className="ph-gantt-day mono">{i % 2 === 0 ? dayLabel(rangeStart + i * DAY) : ""}</div>)}
                </div>
              </div>
              {[...groups.values()].map((g) => (
                <div key={g.root.id}>
                  <div className="ph-gantt-group">
                    <div className="ph-gantt-left ellipsis"><span className={`req-dot ${g.root.status}`} />{g.root.key} · {g.root.title}</div>
                    <div className="ph-gantt-track-empty" />
                  </div>
                  {g.items.map((r) => {
                    const s = Math.max(r.planStart!, rangeStart);
                    const e = Math.min(r.planEnd!, rangeStart + span * DAY);
                    const left = Math.max(0, (s - rangeStart) / DAY / span * 100);
                    const width = Math.max(2, (e - s) / DAY / span * 100);
                    return (
                      <div className="ph-gantt-row" key={r.id}>
                        <button className="ph-gantt-left ellipsis" onClick={onOpen} title={`${r.key} ${r.title}`}>
                          <span className={`req-dot ${r.status}`} />{r.key.replace(/^[A-Z]+-/, "")} · {r.title}
                        </button>
                        <div className="ph-gantt-track">
                          <span className="ph-gantt-today" style={{ left: `${todayPct}%` }} />
                          <span className={`ph-gantt-bar s-${r.status}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${dayLabel(r.planStart!)} → ${dayLabel(r.planEnd!)}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="还没有排期" desc="在需求详情里给交付层需求填起止日期，这里就会出现时间线。" action={<button className="btn tiny" onClick={onOpen}>去需求池</button>} />
          )}
          <div className="ph-unscheduled">
            <b>未排期 <span className="ph-n mono">{unscheduled.length}</span></b>
            {unscheduled.length ? unscheduled.map((r) => (
              <button key={r.id} className="ph-u-row" onClick={onOpen}>
                <span className={`req-dot ${r.status}`} /><span className="mono">{r.key.replace(/^[A-Z]+-/, "")}</span><span className="ellipsis">{r.title}</span>
                <span className="ph-spacer" /><span className="req-chip">未排期</span>
              </button>
            )) : <div className="inline-empty">全部已排期</div>}
          </div>
        </div>
      </section>
      <div className="ph-hint">计划的日期与依赖是从需求上取的，不另建排期对象。</div>
    </div>
  );
}

/* ── 事项台账 ───────────────────────────────────────────────── */
function ItemsPane({ state, project, issues, reqs, query, onQuery, kind, onKind, status, onStatus, openId, onOpen, creating, onCreating, run, act, notify }: {
  state: State; project: Project; issues: ProjectIssue[]; reqs: Requirement[];
  query: string; onQuery: (v: string) => void; kind: string; onKind: (v: string) => void;
  status: string; onStatus: (v: string) => void; openId: string | null; onOpen: (id: string | null) => void;
  creating: { kind: string; title: string } | null; onCreating: (v: { kind: string; title: string } | null) => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>; act: Act; notify: (m: string) => void;
}) {
  const list = issues
    .filter((i) => kind === "all" || i.kind === kind)
    .filter((i) => status === "all" || i.status === status)
    .filter((i) => !query.trim() || `${i.key} ${i.title} ${i.body}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const reqKey = (id?: string | null) => (id ? reqs.find((r) => r.id === id)?.key?.replace(/^[A-Z]+-/, "") || "" : "");
  const bots = (state.bots || []).filter((b) => b.projectId === project.id || !b.projectId);

  return (
    <div className="ph-pane">
      <section className="panel ph-board-panel">
        <div className="ph-tools">
          <input className="ph-input" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="搜索编号 / 标题 / 正文" aria-label="搜索事项" />
          <select className="ph-select" value={kind} onChange={(e) => onKind(e.target.value)} aria-label="按类型筛选">
            <option value="all">全部类型</option>
            {Object.entries(ISSUE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="ph-select" value={status} onChange={(e) => onStatus(e.target.value)} aria-label="按状态筛选">
            <option value="all">全部状态</option>
            {Object.entries(ISSUE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="ph-spacer" />
          <button className="btn tiny" onClick={() => onCreating({ kind: "issue", title: "" })}><PlusIcon size={12} /> 新建</button>
        </div>

        {creating && (
          <div className="ph-issue-create">
            <select className="ph-select" value={creating.kind} onChange={(e) => onCreating({ ...creating, kind: e.target.value })} aria-label="事项类型">
              {Object.entries(ISSUE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="ph-input grow" autoFocus value={creating.title} placeholder="一句话说清这条事项，回车创建"
              onChange={(e) => onCreating({ ...creating, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") { onCreating(null); return; }
                if (e.key !== "Enter") return;
                e.preventDefault();
                const title = creating.title.trim();
                if (!title) return;
                void run("issue", async () => {
                  await act("issueCreate", { projectId: project.id, kind: creating.kind, title });
                  notify("已记一条事项");
                });
                onCreating(null);
              }} />
            <button className="btn tiny" onClick={() => onCreating(null)} title="取消" aria-label="取消"><XIcon size={12} /></button>
          </div>
        )}

        <div className="ph-table-wrap">
          <table className="ph-table">
            <thead>
              <tr><th>编号</th><th>类型</th><th>标题</th><th>状态</th><th>关联需求</th><th>责任人</th><th>优先级</th><th>记录</th><th>更新</th></tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const open = openId === i.id;
                return (
                  <tr key={i.id} className={open ? "on" : ""} onClick={() => onOpen(open ? null : i.id)}>
                    <td className="mono">{i.key}</td>
                    <td><span className={`ph-kind ${i.kind}`}>{ISSUE_KIND[i.kind]}</span></td>
                    <td className="ph-cell-title">{i.title}</td>
                    <td><span className={`ph-ist ${i.status}`}>{ISSUE_STATUS[i.status]}</span></td>
                    <td className="mono">{reqKey(i.reqId) || "—"}</td>
                    <td>{i.owner ? ownerLabel(state, i.owner) : <span className="warn">未指派</span>}</td>
                    <td className="mono">{i.priority}</td>
                    <td className="mono">{(i.notes || []).length}</td>
                    <td className="mono">{fmt(i.updatedAt)}</td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={9}><div className="inline-empty">没有匹配的事项</div></td></tr>}
            </tbody>
          </table>
          {openId && (() => {
            const it = list.find((x) => x.id === openId) || issues.find((x) => x.id === openId);
            if (!it) return null;
            return (
              <div className="ph-issue-detail">
                <div className="ph-issue-body">{it.body || "（没有正文）"}</div>
                <div className="ph-issue-actions">
                  {it.status !== "resolved" && <button className="btn tiny primary" disabled={String(it.id).startsWith("tmp")} onClick={() => void run("issue", () => act("issueUpdate", { id: it.id, status: "resolved" }))}>标已解决</button>}
                  {it.status !== "closed" && <button className="btn tiny" onClick={() => void run("issue", () => act("issueUpdate", { id: it.id, status: "closed" }))}>关闭这条</button>}
                  <select className="ph-select" aria-label="指派责任人" value={it.owner || ""} onChange={(e) => void run("issue", () => act("issueUpdate", { id: it.id, owner: e.target.value || null }))}>
                    <option value="">未指派</option>
                    {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <select className="ph-select" aria-label="关联需求" value={it.reqId || ""} onChange={(e) => void run("issue", () => act("issueUpdate", { id: it.id, reqId: e.target.value || null }))}>
                    <option value="">不关联需求</option>
                    {reqs.map((r) => <option key={r.id} value={r.id}>{r.key}</option>)}
                  </select>
                </div>
                <NoteInput onSubmit={(text) => void run("issue", () => act("issueNote", { id: it.id, text }))} />
                <div className="ph-timeline">
                  {[...(it.notes || [])].sort((a, b) => b.at - a.at).map((n, idx) => (
                    <div className="ph-tl-row" key={`${n.at}-${idx}`}><span className="mono">{fmt(n.at)}</span><span><b>{n.by}</b>：{n.text}</span></div>
                  ))}
                  {!(it.notes || []).length && <div className="inline-empty">还没有处理记录</div>}
                </div>
              </div>
            );
          })()}
        </div>
      </section>
      <div className="ph-hint">台账记「遗留事项 / 任务 / 问题」；真正的任务执行在工作台，不在这里重复。</div>
    </div>
  );
}

function NoteInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <input className="ph-note-input" value={text} placeholder="记一笔：进展 / 决定 / 阻塞…" aria-label="记一笔"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (!text.trim()) return;
        onSubmit(text.trim());
        setText("");
      }} />
  );
}

/* ── 汇总（项目周报式）──────────────────────────────────────── */
function SummaryPane({ state, project, reqs, issues, gaps, now, goalDraft, onGoalDraft, run, act, msDraft, onMsDraft, onOpenItems, onOpenBoard, onOpenWorkspace, onOpenTask }: {
  state: State; project: Project; reqs: Requirement[]; issues: ProjectIssue[]; gaps: Requirement[]; now: number;
  goalDraft: string | null; onGoalDraft: (v: string | null) => void;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>; act: Act;
  msDraft: { name: string; date: string } | null; onMsDraft: (v: { name: string; date: string } | null) => void;
  onOpenItems: () => void; onOpenBoard: () => void; onOpenWorkspace?: () => void; onOpenTask?: (id: string) => void;
}) {
  const done = reqs.filter((r) => r.status === "done" || ((r.level === "sr" || r.level === "us") && (r.acceptance || []).length && (r.acceptance || []).every((a) => a.done)));
  const doing = reqs.filter((r) => r.status === "in_progress" || r.status === "verifying");
  const blocked = issues.filter((i) => i.status === "blocked");
  const openIssues = issues.filter((i) => i.status === "open");
  const implName = (r: Requirement) => implementersOf(state, r).join(" / ") || (todosOf(state, r.id).length ? "待认领" : "—");
  const unassigned = issues.filter((i) => !i.owner && ["open", "doing", "blocked"].includes(i.status));
  const nextReqs = reqs.filter((r) => (r.planStart && r.planStart > now) || (r.status === "approved" && r.level === DELIVERY && !todosOf(state, r.id).length));
  const milestones = project.milestones || [];
  const milestonesDone = milestones.filter((m) => m.status === "done").length;
  const nextMs = milestones.find((m) => m.status === "doing") || milestones.find((m) => m.status === "todo") || null;
  const runs = (state.runs || []).filter((r) => (state.todos || []).some((t) => t.id === r.todoId && t.projectId === project.id));
  const failedRuns = runs.filter((r) => r.status === "failed");
  const projectOwner = (state.bots || []).find((b) => b.projectId === project.id)?.name || "";

  const oneLine = [
    done.length ? `验收通过 ${done.length} 条需求` : "还没有需求验收通过",
    doing.length ? `${doing.length} 条在实现` : "",
    nextMs ? `里程碑「${nextMs.name}」${nextMs.status === "doing" ? "进行中" : "未开始"}（${dayLabel(nextMs.date)}）` : "",
    (blocked.length + failedRuns.length) ? `${blocked.length + failedRuns.length} 个问题需要你拍板` : "没有阻塞",
  ].filter(Boolean).join("；") + "。";

  const progressRows = [
    ...doing.map((r) => ({
      key: r.key, title: r.title, kind: "需求", status: REQ_STATUS[r.status],
      owner: implName(r),
      note: `${(r.acceptance || []).filter((a) => a.done).length}/${(r.acceptance || []).length} 验收过`,
      at: r.updatedAt, tone: r.status === "verifying" ? "warn" : "",
    })),
    ...issues.filter((i) => ["doing", "blocked"].includes(i.status)).map((i) => ({
      key: i.key, title: i.title, kind: ISSUE_KIND[i.kind], status: ISSUE_STATUS[i.status],
      owner: ownerLabel(state, i.owner) || "未指派",
      note: (i.notes || []).at(-1)?.text?.slice(0, 26) || "—",
      at: i.updatedAt, tone: i.status === "blocked" ? "warn" : "",
    })),
    ...done.map((r) => ({
      key: r.key, title: r.title, kind: "需求", status: "验收通过",
      owner: implName(r),
      note: `验收 ${(r.acceptance || []).filter((a) => a.done).length}/${(r.acceptance || []).length}`,
      at: r.updatedAt, tone: "ok",
    })),
  ].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);

  const asks = [
    ...blocked.map((i) => ({ key: i.key, what: i.title, owner: ownerLabel(state, i.owner), impact: (i.notes || []).at(-1)?.text || "卡住了", need: "拍板 / 找对接人", tone: "warn" })),
    ...failedRuns.slice(0, 3).map((r) => ({ key: r.id, what: (state.todos || []).find((t) => t.id === r.todoId)?.title || "运行失败", owner: ownerLabel(state, (state.todos || []).find((t) => t.id === r.todoId)?.botId), impact: `运行失败${r.error ? `：${String(r.error).slice(0, 24)}` : ""}`, need: "要不要重试 / 换方案", tone: "warn" })),
    ...(gaps.length ? [{ key: "缺口", what: `${gaps.length} 条需求没接住（缺验收 / 未派活 / 缺下游）`, owner: projectOwner, impact: "验收口径不全，做完也判不了", need: "指派或补验收", tone: "warn" }] : []),
    ...(unassigned.length ? [{ key: "未指派", what: `${unassigned.length} 条事项没有负责人`, owner: "", impact: "没人接就会烂在台账里", need: "指派给谁", tone: "" }] : []),
    ...(nextReqs.length ? [{ key: "未派活", what: `${nextReqs.length} 条已批准的需求还没派活`, owner: "", impact: "批准了但没人动手", need: "确认要不要现在开", tone: "" }] : []),
  ];

  /** 复制出去就是一份能贴群里的周报：一句话进展 → 目标 → 里程碑 → 进展 → 问题 */
  const reportMd = () => {
    const line = (cells: string[]) => `| ${cells.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;
    return [
      `# ${project.name} · 项目周报`,
      `${dayLabel(now - 3 * DAY)} → ${dayLabel(now + 3 * DAY)}`,
      "",
      "## 一句话进展",
      oneLine,
      "",
      "## 目标",
      project.goal || "_还没写目标_",
      "",
      "## 里程碑",
      ...(milestones.length
        ? milestones.map((m) => `- ${m.status === "done" ? "[x]" : m.status === "doing" ? "[~]" : "[ ]"} ${dayLabel(m.date)} ${m.name}`)
        : ["_还没有里程碑_"]),
      "",
      "## 进展",
      line(["编号", "工作项", "类型", "状态", "负责人", "说明"]),
      line(["---", "---", "---", "---", "---", "---"]),
      ...progressRows.map((r) => line([r.key, r.title, r.kind, r.status, r.owner, r.note])),
      "",
      "## 问题与求助",
      ...(asks.length
        ? [line(["问题", "责任人", "影响", "需要你"]), line(["---", "---", "---", "---"]),
          ...asks.map((a) => line([a.what, a.owner || "未指派", a.impact, a.need]))]
        : ["没有需要你拍板的事。"]),
    ].join("\n");
  };

  const saveMs = (list: ProjectMilestone[]) => void run("ms", () => act("projectMilestones", { id: project.id, milestones: list }));

  return (
    <div className="ph-pane">
      <article className="ph-report">
        <header className="ph-report-head">
          <div className="ph-note">项目汇总 · 周报</div>
          <div className="ph-report-meta">
            <span>{dayLabel(now - 3 * DAY)} → {dayLabel(now + 3 * DAY)}</span><span>·</span>
            <span>{fmt(now)}</span>
            {(state.bots || []).filter((b) => b.projectId === project.id).map((b) => <span key={b.id}>· {b.name} 接手</span>)}
          </div>
          <div className="ph-report-actions">
            <button className="btn tiny" onClick={() => { void navigator.clipboard?.writeText(reportMd()); }}>复制为 Markdown</button>
            <button className="btn tiny" onClick={onOpenBoard}>看板</button>
            <button className="btn tiny" onClick={onOpenItems}>台账</button>
          </div>
        </header>

        <section className="ph-sec">
          <div className="ph-sec-head"><h3>一句话进展</h3><span className="ph-sec-rule" /></div>
          <p className="ph-lede">{oneLine}</p>
        </section>

        <section className="ph-sec">
          <div className="ph-sec-head"><h3>目标</h3><span className="ph-sec-rule" />
            {goalDraft === null && <button className="btn tiny" onClick={() => onGoalDraft(project.goal || "")}>编辑</button>}
          </div>
          {goalDraft === null ? (
            <p className="ph-lede">{project.goal || "还没有写目标：一句话说清这个项目要交付什么、什么时候算完成。"}</p>
          ) : (
            <div className="ph-goal-edit">
              <textarea className="ph-textarea" autoFocus value={goalDraft} onChange={(e) => onGoalDraft(e.target.value)} placeholder="一句话说清目标与验收口径" />
              <div className="row gap6">
                <button className="btn tiny primary" onClick={() => { void run("goal", () => act("projectSetGoal", { id: project.id, goal: goalDraft })); onGoalDraft(null); }}>保存</button>
                <button className="btn tiny" onClick={() => onGoalDraft(null)}>取消</button>
              </div>
            </div>
          )}
        </section>

        <section className="ph-sec">
          <div className="ph-sec-head"><h3>里程碑</h3><span className="ph-n mono">{milestonesDone}/{milestones.length}</span><span className="ph-sec-rule" />
            <button className="btn tiny" onClick={() => onMsDraft({ name: "", date: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10) })}>＋ 添加</button>
          </div>
          {milestones.length ? (
            <div className="ph-ms" style={{ gridTemplateColumns: `repeat(${Math.min(6, milestones.length)}, minmax(0, 1fr))` }}>
              <span className="ph-ms-line" />
              {milestones.slice(0, 6).map((m) => (
                <div key={m.id} className={`ph-ms-node ${m.status}`}>
                  <span className="ph-ms-dot" />
                  <span className="ph-ms-date mono">{dayLabel(m.date)}</span>
                  <span className="ph-ms-name">{m.name}</span>
                  <span className="ph-ms-state">{m.status === "done" ? "已完成" : m.status === "doing" ? "进行中" : "未开始"}</span>
                  <RowMenu title="里程碑操作">
                    <button onClick={() => saveMs(milestones.map((x) => x.id === m.id ? { ...x, status: "todo" } : x))}>未开始</button>
                    <button onClick={() => saveMs(milestones.map((x) => x.id === m.id ? { ...x, status: "doing" } : x))}>进行中</button>
                    <button onClick={() => saveMs(milestones.map((x) => x.id === m.id ? { ...x, status: "done" } : x))}>已完成</button>
                    <button className="danger" onClick={() => saveMs(milestones.filter((x) => x.id !== m.id))}>删除</button>
                  </RowMenu>
                </div>
              ))}
            </div>
          ) : <div className="inline-empty">还没有里程碑。加一个：名称 + 日期，状态稍后改。</div>}
          {msDraft && (
            <div className="ph-ms-add">
              <input className="ph-input grow" autoFocus value={msDraft.name} placeholder="里程碑名称" onChange={(e) => onMsDraft({ ...msDraft, name: e.target.value })} />
              <input className="ph-input" type="date" value={msDraft.date} onChange={(e) => onMsDraft({ ...msDraft, date: e.target.value })} aria-label="日期" />
              <button className="btn tiny primary" disabled={!msDraft.name.trim()} onClick={() => {
                const date = new Date(`${msDraft.date}T09:00:00`).getTime() || Date.now();
                saveMs([...milestones, { id: `ms-${Date.now().toString(36)}`, name: msDraft.name.trim(), date, status: "todo" }]);
                onMsDraft(null);
              }}>添加</button>
              <button className="btn tiny" onClick={() => onMsDraft(null)}>取消</button>
            </div>
          )}
        </section>

        <section className="ph-sec">
          <div className="ph-sec-head"><h3>进展</h3><span className="ph-n mono">{progressRows.length}</span><span className="ph-sec-rule" /></div>
          {progressRows.length ? (
            <table className="ph-table report">
              <thead><tr><th>编号</th><th>工作项</th><th>类型</th><th>状态</th><th>负责人</th><th>说明</th><th>更新</th></tr></thead>
              <tbody>
                {progressRows.map((r) => (
                  <tr key={`${r.key}-${r.at}`}>
                    <td className="mono">{r.key}</td>
                    <td className="ph-cell-title">{r.title}</td>
                    <td className="mono">{r.kind}</td>
                    <td><span className={`ph-ist ${r.tone || ""}`}>{r.status}</span></td>
                    <td>{r.owner}</td>
                    <td className="ph-muted">{r.note}</td>
                    <td className="mono">{fmt(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="inline-empty">这周还没有可写的进展</div>}
        </section>

        <section className="ph-sec">
          <div className="ph-sec-head"><h3>问题与求助</h3><span className="ph-n mono">{asks.length}</span><span className="ph-sec-rule" /></div>
          {asks.length ? (
            <table className="ph-table report">
              <thead><tr><th>编号</th><th>问题</th><th>责任人</th><th>影响</th><th>需要你</th></tr></thead>
              <tbody>
                {asks.map((a) => (
                  <tr key={a.key}>
                    <td className="mono">{a.key}</td>
                    <td className="ph-cell-title">{a.what}</td>
                    <td>{a.owner || <span className="warn">未指派</span>}</td>
                    <td className="ph-muted">{a.impact}</td>
                    <td><span className={`ph-ist ${a.tone || ""}`}>{a.need}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="inline-empty">没有需要你处理的问题</div>}
        </section>

        <footer className="ph-report-foot">
          <button className="ph-link" onClick={onOpenWorkspace}>打开工作台</button>
          <button className="ph-link" onClick={onOpenItems}>看事项台账</button>
          {openIssues.length ? <span className="ph-muted">待处理 {openIssues.length} 条</span> : null}
          {onOpenTask ? <span className="ph-muted">点任务 key 可打开任务</span> : null}
        </footer>
      </article>
    </div>
  );
}
