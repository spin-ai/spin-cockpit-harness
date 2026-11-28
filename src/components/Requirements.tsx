import { useEffect, useMemo, useState } from "react";
import type { Requirement, RequirementLevel, RequirementLinkKind, RequirementStatus, State, Todo } from "../types";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { Overview } from "./Overview";
import { EmptyState } from "./EmptyState";
import { ChevronDownIcon, ChevronLeftIcon, PlusIcon, XIcon } from "./Icons";
import { Tabs } from "./Tabs";
import { confirmDialog } from "./ConfirmHost";
import { STATUS } from "../ui";

type Act = (type: string, payload?: unknown) => Promise<any>;

const LEVELS: RequirementLevel[] = ["rr", "ir", "sr", "us"];
const LEVEL_LABEL: Record<RequirementLevel, string> = { rr: "RR", ir: "IR", sr: "SR", us: "US" };
const LEVEL_NAME: Record<RequirementLevel, string> = { rr: "原始需求", ir: "初始需求", sr: "系统需求", us: "用户故事" };
const NEXT_LEVEL: Record<RequirementLevel, RequirementLevel | null> = { rr: "ir", ir: "sr", sr: "us", us: null };
const STATUS_LABEL: Record<RequirementStatus, string> = {
  draft: "草稿", reviewing: "待评审", approved: "已批准", done: "已完成",
  rejected: "已拒绝", obsolete: "已废弃", in_progress: "实现中", verifying: "待验收",
};
const M0_STATUSES: RequirementStatus[] = ["draft", "reviewing", "approved", "in_progress", "verifying", "done", "rejected", "obsolete"];
const LINK_KIND: Record<RequirementLinkKind, string> = { relates: "相关", duplicates: "重复", conflicts: "冲突" };
const toDateInput = (ts?: number | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromDateInput = (value: string) => (value ? new Date(`${value}T09:00:00`).getTime() : null);
const FIELD_LABEL: Record<string, string> = {
  scope: "范围", outOfScope: "范围外", impact: "影响模块", acceptance: "验收判据",
  role: "角色", value: "价值", children: "子需求", tasks: "任务", source: "来源", requester: "提出人",
};

const byCreated = (a: Requirement, b: Requirement) => (a.createdAt || 0) - (b.createdAt || 0) || a.key.localeCompare(b.key);
const childrenOf = (list: Requirement[], id: string) => list.filter((r) => r.parentId === id).sort(byCreated);
const ancestorsOf = (list: Requirement[], req: Requirement) => {
  const out: Requirement[] = [];
  let cur: Requirement | null = req;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? list.find((r) => r.id === cur!.parentId) || null : null;
  }
  return out;
};
const acceptance = (req: Requirement) => (Array.isArray(req.acceptance) ? req.acceptance : []);

function gapOf(req: Requirement, children: Requirement[], tasks: Todo[] = []): { label: string; tone?: "warn" } | null {
  if ((req.level === "sr" || req.level === "us") && !acceptance(req).length) return { label: "缺验收", tone: "warn" };
  if (req.level === "us" && req.status === "approved" && !tasks.length) return { label: "未派活", tone: "warn" };
  if (req.level !== "us" && !children.length) return { label: "缺下游", tone: "warn" };
  return null;
}

function missingFields(req: Requirement): string[] {
  const missing: string[] = [];
  const required = req.level === "rr" ? ["source", "requester"]
    : req.level === "ir" ? ["scope", "outOfScope"]
      : req.level === "sr" ? ["impact", "acceptance"] : ["role", "value", "acceptance"];
  for (const field of required) {
    if (field === "acceptance") {
      if (!acceptance(req).length) missing.push(field);
    } else if (!String((req as unknown as Record<string, unknown>)[field] || "").trim()) {
      missing.push(field);
    }
  }
  return missing;
}

function gateFor(req: Requirement, next: RequirementStatus, children: Requirement[], tasks: Todo[] = []): { ok: boolean; missing: string[]; message: string } {
  if (next === "in_progress") {
    if (req.status !== "approved") return { ok: false, missing: ["status"], message: "先批准再开始实现" };
    if (req.level === "us" && !tasks.length) return { ok: false, missing: ["tasks"], message: "开始实现前先派活（建一条任务）" };
  }
  if (next === "verifying") {
    if (tasks.length && tasks.some((t) => t.status !== "done")) return { ok: false, missing: ["tasks"], message: "还有任务没完成，不能进待验收" };
  }
  if (next === "approved") {
    const missing = missingFields(req);
    if (missing.length) return { ok: false, missing, message: "批准前还有必填项" };
  }
  if (next === "done") {
    if (req.level === "us" || req.level === "sr") {
      const list = acceptance(req);
      if (!list.length) return { ok: false, missing: ["acceptance"], message: "没有验收判据" };
      if (list.some((a) => !a.done)) return { ok: false, missing: ["acceptance"], message: "验收判据还没全部勾选" };
    }
    if (req.level === "ir" || req.level === "rr") {
      if (!children.length) return { ok: false, missing: ["children"], message: `${LEVEL_LABEL[req.level]} 还没有子需求` };
      const open = children.filter((c) => !["approved", "done"].includes(c.status));
      if (open.length) return { ok: false, missing: ["children"], message: `还有 ${open.length} 条子需求没批准` };
    }
  }
  return { ok: true, missing: [], message: "" };
}

type DraftKey = "title" | "body" | "priority" | "owner" | "source" | "requester" | "scope" | "outOfScope" | "impact" | "role" | "value";

export function Requirements({ state, act, notify, onBack, embedded = false, projectId, focus, createRequest, onOpenTask }: {
  state: State; act: Act; notify: (message: string) => void; onBack?: () => void;
  /** 嵌进项目页的「需求」tab：不画页头 / 概览 / 项目选择器 / 视图 tab */
  embedded?: boolean;
  /** 嵌进项目页时用这一页的项目；不传则用全局当前项目 */
  projectId?: string;
  /** 外部请求选中一条需求（看板卡片 / 计划行点进来）；换 at 才算新请求 */
  focus?: { id: string; at: number } | null;
  /** 外部请求打开「新建需求」；parentId 为空就是新建 RR */
  createRequest?: { parentId?: string | null; at: number } | null;
  /** 点「任务」里的某条 → 去工作台打开它 */
  onOpenTask?: (id: string) => void;
}) {
  const requirements = state.requirements ?? [];
  const project = state.projects.find((p) => p.id === (projectId || state.activeProjectId)) ?? state.projects[0] ?? null;
  const projectReqs = useMemo(
    () => (project ? requirements.filter((r) => r.projectId === project.id).sort(byCreated) : []),
    [requirements, project?.id],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"pool" | "matrix">("pool");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | RequirementLevel>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RequirementStatus>("all");
  const [matrixOnlyGaps, setMatrixOnlyGaps] = useState(false);
  const [matrixCreating, setMatrixCreating] = useState<{ parentId: string; level: RequirementLevel; title: string } | null>(null);
  const [linkAdding, setLinkAdding] = useState(false);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkKind, setLinkKind] = useState<RequirementLinkKind>("relates");
  const [creating, setCreating] = useState<{ parentId: string | null; level: RequirementLevel; title: string } | null>(null);
  const [gate, setGate] = useState<{ missing: string[]; message: string } | null>(null);
  const [form, setForm] = useState<Record<DraftKey, string>>({
    title: "", body: "", priority: "P2", owner: "", source: "", requester: "",
    scope: "", outOfScope: "", impact: "", role: "", value: "",
  });
  const [accText, setAccText] = useState("");
  const selected = projectReqs.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    // 看板 / 计划点进来：选中它并展开祖先，再滚到可见位置
    if (!focus?.id) return;
    setSelectedId(focus.id);
    setGate(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = projectReqs.find((r) => r.id === focus.id);
      while (cur?.parentId) {
        next.add(cur.parentId);
        cur = projectReqs.find((r) => r.id === cur!.parentId);
      }
      return next;
    });
    // 等行渲染出来再滚，别打断点击本身
    const t = window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-req-id="${focus.id}"]`)?.scrollIntoView({ block: "nearest" });
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.at]);

  // 项目页页头「新建需求」：直接把创建行打开（不让人先找按钮）
  useEffect(() => {
    if (!createRequest) return;
    startCreate(createRequest.parentId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest?.at]);

  useEffect(() => {
    // 换项目：展开所有根、选第一条；需求更新不重置用户的选中 / 展开
    const roots = projectReqs.filter((r) => !r.parentId);
    setExpanded(new Set(roots.map((r) => r.id)));
    setSelectedId((prev) => (prev && projectReqs.some((r) => r.id === prev) ? prev : roots[0]?.id ?? null));
    setGate(null);
    setCreating(null);
    setMatrixCreating(null);
    setLinkAdding(false);
    setLinkTarget("");
    // 只跟项目切换走；需求更新不能重置用户的选中 / 展开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      title: selected.title || "", body: selected.body || "", priority: selected.priority || "P2",
      owner: selected.owner || "", source: selected.source || "", requester: selected.requester || "",
      scope: selected.scope || "", outOfScope: selected.outOfScope || "", impact: selected.impact || "",
      role: selected.role || "", value: selected.value || "",
    });
    setGate(null);
    setLinkAdding(false);
    setLinkTarget("");
    setLinkKind("relates");
    // 只在切换选中时同步；保存一个字段时不要把另一个字段里没失焦的草稿冲掉
  }, [selected?.id]);

  const roots = projectReqs.filter((r) => !r.parentId);
  const isFiltering = !!query.trim() || levelFilter !== "all" || statusFilter !== "all";
  const matches = (req: Requirement) => {
    const q = query.trim().toLowerCase();
    if (q && !`${req.key} ${req.title} ${req.body}`.toLowerCase().includes(q)) return false;
    if (levelFilter !== "all" && req.level !== levelFilter) return false;
    if (statusFilter !== "all" && req.status !== statusFilter) return false;
    return true;
  };
  const flat = projectReqs.filter(matches).sort(byCreated);
  /** 需求派出去的任务（看板 / 计划 / 未派活缺口都用它） */
  const tasksOf = (reqId: string) => (state.todos || []).filter((t) => t.requirementId === reqId);
  const gapOfReq = (req: Requirement) => gapOf(req, childrenOf(projectReqs, req.id), tasksOf(req.id));
  const gapCount = projectReqs.filter((r) => gapOfReq(r)).length;
  const matrixColumns: RequirementLevel[] = ["ir", "sr", "us"];
  const buildPaths = (): Requirement[][] => {
    const out: Requirement[][] = [];
    const walk = (req: Requirement, chain: Requirement[]) => {
      const next = NEXT_LEVEL[req.level];
      const children = childrenOf(projectReqs, req.id);
      if (!next || !children.length) { out.push([...chain, req]); return; }
      for (const child of children) walk(child, [...chain, req]);
    };
    for (const root of roots) walk(root, []);
    return out;
  };
  const matrixPaths = buildPaths();
  const pathHasGap = (path: Requirement[]) => {
    if (matrixColumns.some((level) => !path.some((req) => req.level === level))) return true;
    const last = path[path.length - 1];
    return !!gapOfReq(last);
  };
  const matrixShown = matrixPaths.filter((path) => !matrixOnlyGaps || pathHasGap(path));
  const matrixGroups = new Map<string, { root: Requirement; paths: Requirement[][] }>();
  for (const path of matrixShown) {
    const root = path[0];
    if (!matrixGroups.has(root.id)) matrixGroups.set(root.id, { root, paths: [] });
    matrixGroups.get(root.id)!.paths.push(path);
  }

  const save = async (field: DraftKey, value: string) => {
    if (!selected) return;
    if (String((selected as unknown as Record<string, unknown>)[field] ?? "") === value) return;
    const res = await act("requirementUpdate", { id: selected.id, [field]: value });
    if (!res) setForm((prev) => ({ ...prev, [field]: String((selected as unknown as Record<string, unknown>)[field] ?? "") }));
  };

  const setStatus = async (next: RequirementStatus) => {
    if (!selected) return;
    if (next === selected.status) return;
    const local = gateFor(selected, next, childrenOf(projectReqs, selected.id), tasksOf(selected.id));
    if (!local.ok) { setGate(local); return; }
    const res = await act("requirementSetStatus", { id: selected.id, status: next });
    if (res) setGate(null);
    else setGate({ missing: [], message: "状态更新失败，见右下角错误" });
  };

  /** 派活：建任务 → 提示派给了谁、任务号是多少；失败把原因说清楚 */
  const dispatch = async (field: "agentId" | "botId", id: string, who: string) => {
    if (!selected) return;
    try {
      const res = await act("requirementDispatch", { id: selected.id, [field]: id, projectId: project?.id || null });
      if (res) notify(`已派给 ${who}：任务 ${res.key || ""}`.trim());
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  const focusMissing = (missing: string[]) => {
    if (!selected) return;
    const first = missing[0];
    if (first === "acceptance") {
      document.querySelector<HTMLInputElement>("[data-req-accept-input]")?.focus();
      return;
    }
    if (first === "children") {
      document.querySelector<HTMLElement>("[data-req-children]")?.scrollIntoView({ block: "center" });
      return;
    }
    if (first) document.querySelector<HTMLElement>(`[data-req-field="${first}"]`)?.focus();
  };

  const startCreate = (parentId: string | null) => {
    const level: RequirementLevel = parentId ? (NEXT_LEVEL[projectReqs.find((r) => r.id === parentId)?.level || "rr"] || "us") : "rr";
    setCreating({ parentId, level, title: "" });
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
  };

  const submitMatrixCreate = async (titleOverride?: string) => {
    if (!project || !matrixCreating) return;
    const title = String(titleOverride ?? matrixCreating.title).trim();
    if (!title) return;
    const res = await act("requirementCreate", { projectId: project.id, level: matrixCreating.level, parentId: matrixCreating.parentId, title });
    if (res?.id) {
      setMatrixCreating(null);
      setSelectedId(res.id);
      setExpanded((prev) => new Set(prev).add(matrixCreating.parentId));
    }
  };

  const submitCreate = async (titleOverride?: string) => {
    if (!project || !creating) return;
    const title = String(titleOverride ?? creating.title).trim();
    if (!title) return;
    const res = await act("requirementCreate", { projectId: project.id, level: creating.level, parentId: creating.parentId, title });
    if (res?.id) {
      setCreating(null);
      setSelectedId(res.id);
      if (creating.parentId) setExpanded((prev) => new Set(prev).add(creating.parentId!));
    }
  };

  const addAcceptance = async (textOverride?: string) => {
    if (!selected) return;
    const text = String(textOverride ?? accText).trim();
    if (!text) return;
    const res = await act("requirementUpdate", { id: selected.id, acceptance: [...acceptance(selected), { text, done: false }] });
    if (res) setAccText("");
  };

  const toggleAcceptance = async (index: number) => {
    if (!selected) return;
    const next = acceptance(selected).map((item, i) => (i === index ? { ...item, done: !item.done } : item));
    await act("requirementUpdate", { id: selected.id, acceptance: next });
  };

  const editAcceptance = async (index: number, text: string) => {
    if (!selected) return;
    const next = acceptance(selected).map((item, i) => (i === index ? { ...item, text } : item));
    if (JSON.stringify(next[index]) === JSON.stringify(acceptance(selected)[index])) return;
    await act("requirementUpdate", { id: selected.id, acceptance: next });
  };

  const removeAcceptance = async (index: number) => {
    if (!selected) return;
    await act("requirementUpdate", { id: selected.id, acceptance: acceptance(selected).filter((_, i) => i !== index) });
  };

  const removeSelected = async () => {
    if (!selected) return;
    const ok = await confirmDialog({ title: `删除 ${selected.key}？`, desc: "只有草稿能删除；这条需求的正文和验收会一起删除。", ok: "删除", danger: true });
    if (!ok) return;
    const parent = selected.parentId;
    const res = await act("requirementDelete", { id: selected.id });
    if (!res) return;
    const next = parent && projectReqs.some((r) => r.id === parent) ? parent : projectReqs.find((r) => r.id !== selected.id && !r.parentId)?.id ?? null;
    setSelectedId(next);
    notify("已删除需求草稿");
  };

  const linksOf = (req: Requirement) => (state.requirementLinks || []).filter((l) => l.fromId === req.id || l.toId === req.id);
  const addLink = async () => {
    if (!selected || !linkTarget) return;
    const res = await act("requirementLinkAdd", { fromId: selected.id, toId: linkTarget, kind: linkKind });
    if (res) {
      setLinkAdding(false);
      setLinkTarget("");
      setLinkKind("relates");
    }
  };
  const removeLink = async (id: string) => {
    await act("requirementLinkRemove", { id });
  };

  const switchProject = async (id: string) => {
    if (id === project?.id) return;
    setSelectedId(null);
    await act("switchProject", { id });
  };

  const renderRow = (req: Requirement, depth: number, flatMode = false) => {
    const children = childrenOf(projectReqs, req.id);
    const open = expanded.has(req.id);
    const on = selectedId === req.id;
    const gap = gapOf(req, children);
    const path = ancestorsOf(projectReqs, req).slice(0, -1).map((r) => r.key).join(" / ");
    return (
      <div key={req.id}>
        <div
          className={`req-row ${on ? "on" : ""}`}
          data-req-id={req.id}
          style={{ paddingLeft: 6 + (flatMode ? 0 : depth * 14) }}
          onClick={() => { setSelectedId(req.id); setGate(null); }}
          title={`${req.key} · ${req.title}${path ? ` · ${path}` : ""}`}
        >
          {!flatMode && children.length > 0 ? (
            <button
              className={`req-chevron ${open ? "open" : ""}`}
              title={open ? "收起" : "展开"}
              aria-label={open ? "收起" : "展开"}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(req.id)) next.delete(req.id); else next.add(req.id);
                  return next;
                });
              }}
            >
              <ChevronDownIcon size={11} />
            </button>
          ) : <span className="req-chevron-space" />}
          <span className={`req-dot ${req.status}`} title={STATUS_LABEL[req.status]} />
          <span className="req-key">{req.key.replace(/^[A-Z0-9]+-/, "")}</span>
          <span className="req-row-title">{req.title}</span>
          <span className="req-row-end">
            {gap ? <span className={`req-chip warn`}>{gap.label}</span> : null}
          </span>
        </div>
        {!flatMode && open && children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className={embedded ? "req-embedded" : "page req-page"}>
      {!embedded && <PageHeader
        title="需求"
        subtitle={`${project?.name || "未选择项目"} · RR → IR → SR → US · 先完成需求定义`}
        tabs={<Tabs ariaLabel="需求视图" value={tab} onChange={(id) => { setTab(id as "pool" | "matrix"); setMatrixCreating(null); }} items={[
          { id: "pool", label: "需求池" },
          { id: "matrix", label: "追溯矩阵" },
        ]} />}
        actions={<div className="row gap8">
          {onBack ? <button className="btn tiny" onClick={onBack} title="返回项目" aria-label="返回项目"><ChevronLeftIcon size={14} /></button> : null}
          <select className="req-select" aria-label="切换项目" value={project?.id || ""} onChange={(e) => void switchProject(e.target.value)}>
            {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn primary" onClick={() => startCreate(null)}><PlusIcon size={14} /> 新建需求</button>
        </div>}
      />}

      {!embedded && <Overview items={[
        { label: "需求", value: projectReqs.length },
        { label: "待评审", value: projectReqs.filter((r) => r.status === "reviewing").length },
        { label: "已批准", value: projectReqs.filter((r) => r.status === "approved").length },
        { label: "缺口", value: gapCount, tone: gapCount ? "warn" : undefined },
        { label: "已完成", value: projectReqs.filter((r) => r.status === "done").length },
      ]} />}

      {(embedded || tab === "pool") ? <div className="req-shell">
        <section className="req-panel req-tree" aria-label="需求树">
          <div className="req-tree-tools">
            <input className="req-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 key / 标题 / 正文" aria-label="搜索需求" />
            <div className="req-filters">
              <select className="req-select" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)} aria-label="按层级筛选">
                <option value="all">全部层级</option>
                {LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABEL[level]}</option>)}
              </select>
              <select className="req-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="按状态筛选">
                <option value="all">全部状态</option>
                {M0_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
              </select>
            </div>
          </div>
          <div className="req-tree-scroll">
            {creating?.parentId === null ? (
              <div className="req-create-row">
                <span className="req-key">{LEVEL_LABEL[creating.level]}</span>
                <input
                  className="req-input"
                  autoFocus
                  value={creating.title}
                  placeholder="新需求标题，回车创建"
                  onChange={(e) => setCreating((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void submitCreate((e.target as HTMLInputElement).value); }
                    if (e.key === "Escape") setCreating(null);
                  }}
                />
                <button className="btn tiny" onClick={() => setCreating(null)} title="取消" aria-label="取消"><XIcon size={12} /></button>
              </div>
            ) : null}
            {isFiltering
              ? (flat.length ? flat.map((req) => renderRow(req, 0, true)) : <div className="inline-empty">没有匹配的需求</div>)
              : (roots.length ? roots.map((req) => renderRow(req, 0)) : (
                <EmptyState compact title="还没有需求" desc="先用一条 RR 记下来源，再往下拆 IR / SR / US。" action={<button className="btn tiny" onClick={() => startCreate(null)}>新建 RR</button>} />
              ))}
          </div>
        </section>

        <section className="req-panel req-detail" aria-label="需求详情">
          {!selected ? (
            projectReqs.length
              ? <EmptyState compact title="选择一条需求" desc="左栏点一行查看 / 修改；点击行尾箭头展开子需求。" />
              : <EmptyState compact title="还没有需求" desc="需求先定义，再往下拆 IR / SR / 交付层；一条 RR 是一切的起点。" action={<button className="btn tiny" onClick={() => startCreate(null)}>新建 RR</button>} />
          ) : (
            <div className="req-detail-scroll">
              <div className="req-crumbs">
                {ancestorsOf(projectReqs, selected).map((req, index, list) => (
                  <span key={req.id}>
                    <button onClick={() => setSelectedId(req.id)} title={req.title}>{req.key}</button>
                    {index < list.length - 1 ? <span className="req-crumb-sep">→</span> : null}
                  </span>
                ))}
              </div>

              <div className="req-detail-head">
                <div className="req-detail-key">{selected.key} · {LEVEL_NAME[selected.level]}</div>
                <input
                  className="req-title-input"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  onBlur={() => void save("title", form.title)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                  aria-label="需求标题"
                />
              </div>

              <div className="req-meta">
                <label className="req-meta-field"><span>状态</span>
                  <select className="req-select" value={selected.status} onChange={(e) => void setStatus(e.target.value as RequirementStatus)}>
                    {M0_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
                  </select>
                </label>
                <label className="req-meta-field"><span>优先级</span>
                  <select className="req-select" value={form.priority} onChange={(e) => { const v = e.target.value; setForm((p) => ({ ...p, priority: v })); void act("requirementUpdate", { id: selected.id, priority: v }); }}>
                    {["P0", "P1", "P2", "P3"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="req-meta-field grow"><span>负责人</span>
                  <input className="req-input" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} onBlur={() => void save("owner", form.owner)} placeholder="—" />
                </label>
                <label className="req-meta-field grow"><span>来源</span>
                  <input className="req-input" data-req-field="source" value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))} onBlur={() => void save("source", form.source)} placeholder="客户 / 内部 / 数据" />
                </label>
                <label className="req-meta-field grow"><span>提出人</span>
                  <input className="req-input" data-req-field="requester" value={form.requester} onChange={(e) => setForm((p) => ({ ...p, requester: e.target.value }))} onBlur={() => void save("requester", form.requester)} placeholder="谁提的" />
                </label>
                {selected.status === "draft" && childrenOf(projectReqs, selected.id).length === 0 ? (
                  <button className="btn tiny ghost req-delete" onClick={() => void removeSelected()}>删除草稿</button>
                ) : null}
              </div>

              <div className="req-plan-row">
                <label className="req-meta-field"><span>起</span>
                  <input className="req-input" type="date" value={toDateInput(selected.planStart)} onChange={(e) => void act("requirementSetPlan", { id: selected.id, planStart: fromDateInput(e.target.value), planEnd: selected.planEnd ?? null })} aria-label="排期开始" />
                </label>
                <label className="req-meta-field"><span>止</span>
                  <input className="req-input" type="date" value={toDateInput(selected.planEnd)} onChange={(e) => void act("requirementSetPlan", { id: selected.id, planStart: selected.planStart ?? null, planEnd: fromDateInput(e.target.value) })} aria-label="排期结束" />
                </label>
                <span className="req-plan-hint">填了起止日期就会出现在「计划」甘特里</span>
                <span className="spacer" />
                {selected.level === "us" ? (
                  <RowMenu title="派活" trigger={<span className="btn tiny">派活 · {tasksOf(selected.id).length}</span>} triggerClassName="req-dispatch">
                    <div className="row-menu-info"><div><span>已派</span><em>{tasksOf(selected.id).map((t) => t.key).join(" / ") || "还没有"}</em></div></div>
                    {!(state.agents || []).some((a) => (a.role || "worker") !== "supervisor") && !(state.bots || []).some((b) => b.projectId === (project?.id || "")) ? (
                      <div className="row-menu-info"><div><span>没有实现者</span><em>先在「人物」里加一个，或给项目配一个 bot</em></div></div>
                    ) : null}
                    {(state.agents || []).filter((a) => (a.role || "worker") !== "supervisor").map((a) => (
                      <button key={a.id} disabled={selected.status === "draft" || selected.status === "reviewing"}
                        onClick={() => void dispatch("agentId", a.id, a.alias || a.name)}>
                        派给 {a.alias || a.name}
                      </button>
                    ))}
                    {(state.bots || []).filter((b) => b.projectId === (project?.id || "")).map((b) => (
                      <button key={b.id} disabled={selected.status === "draft" || selected.status === "reviewing"}
                        onClick={() => void dispatch("botId", b.id, b.name)}>
                        交给 {b.name}
                      </button>
                    ))}
                    <div className="row-menu-info"><div><span>下一步</span><em>起 run 仍由人确认</em></div></div>
                  </RowMenu>
                ) : <span className="req-plan-hint">只有交付层（US）能派活</span>}
              </div>

              {gate ? (
                <div className="req-gate" role="alert">
                  <span>{gate.message}{gate.missing.length ? `：${gate.missing.map((m) => FIELD_LABEL[m] || m).join(" / ")}` : ""}</span>
                  {gate.missing.length ? <button className="btn tiny" onClick={() => focusMissing(gate.missing)}>去补</button> : null}
                </div>
              ) : null}

              {selected.level === "ir" ? (
                <div className="req-fields">
                  <label className="req-field"><span>范围</span>
                    <textarea className="req-textarea" data-req-field="scope" value={form.scope} onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))} onBlur={() => void save("scope", form.scope)} placeholder="这一期做什么" />
                  </label>
                  <label className="req-field"><span>范围外</span>
                    <textarea className="req-textarea" data-req-field="outOfScope" value={form.outOfScope} onChange={(e) => setForm((p) => ({ ...p, outOfScope: e.target.value }))} onBlur={() => void save("outOfScope", form.outOfScope)} placeholder="明确不做什么" />
                  </label>
                </div>
              ) : null}

              {selected.level === "sr" ? (
                <label className="req-field"><span>影响模块</span>
                  <input className="req-input" data-req-field="impact" value={form.impact} onChange={(e) => setForm((p) => ({ ...p, impact: e.target.value }))} onBlur={() => void save("impact", form.impact)} placeholder="例如 Chat / 会话加载" />
                </label>
              ) : null}

              {selected.level === "us" ? (
                <div className="req-fields two">
                  <label className="req-field"><span>角色</span>
                    <input className="req-input" data-req-field="role" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} onBlur={() => void save("role", form.role)} placeholder="作为谁" />
                  </label>
                  <label className="req-field"><span>价值</span>
                    <input className="req-input" data-req-field="value" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} onBlur={() => void save("value", form.value)} placeholder="为了什么" />
                  </label>
                </div>
              ) : null}

              <label className="req-field"><span>正文</span>
                <textarea className="req-textarea req-body" value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} onBlur={() => void save("body", form.body)} placeholder="背景 / 场景 / 约束 / 设计意图" />
              </label>

              {selected.level === "sr" || selected.level === "us" ? (
                <section className="req-section">
                  <div className="req-section-head"><b>验收判据</b><span>{acceptance(selected).length}</span></div>
                  {acceptance(selected).map((item, index) => (
                    <div className={`req-acc-row ${item.done ? "done" : ""}`} key={index}>
                      <input type="checkbox" checked={item.done} onChange={() => void toggleAcceptance(index)} aria-label={`验收判据 ${index + 1}`} />
                      <input className="req-input" defaultValue={item.text} onBlur={(e) => void editAcceptance(index, e.target.value)} aria-label={`验收判据 ${index + 1} 文本`} />
                      <button className="req-icon-btn" title="删除判据" aria-label="删除判据" onClick={() => void removeAcceptance(index)}><XIcon size={12} /></button>
                    </div>
                  ))}
                  {!acceptance(selected).length ? <div className="inline-empty">还没有验收判据；批准 / 完成前至少要有一条。</div> : null}
                  <div className="req-add-row">
                    <input
                      className="req-input"
                      data-req-accept-input
                      value={accText}
                      onChange={(e) => setAccText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addAcceptance((e.target as HTMLInputElement).value); } }}
                      placeholder="输入一条可判定的验收，回车添加"
                      aria-label="添加验收判据"
                    />
                    <button className="btn tiny" onClick={() => void addAcceptance()}><PlusIcon size={12} /> 添加</button>
                  </div>
                </section>
              ) : null}

              <section className="req-section" data-req-tasks>
                <div className="req-section-head">
                  <b>任务</b><span>{tasksOf(selected.id).length}</span>
                  <span className="req-section-hint">派活后在这里，也在工作台</span>
                </div>
                {tasksOf(selected.id).map((t) => (
                  <button className="req-child-row" key={t.id} onClick={() => onOpenTask?.(t.id)} title={`${t.key} ${t.title}`}>
                    <span className={`req-dot ${t.status === "done" ? "done" : t.status === "in_progress" ? "in_progress" : "approved"}`} />
                    <span className="req-key mono">{t.key}</span>
                    <span className="req-row-title">{t.title}</span>
                    <span className="req-row-end">
                      {t.botId ? <span className="req-row-end-muted">{(state.bots || []).find((b) => b.id === t.botId)?.name || ""}</span> : null}
                      <span className="req-chip">{STATUS[t.status]?.label || t.status}</span>
                    </span>
                  </button>
                ))}
                {!tasksOf(selected.id).length ? (
                  <div className="inline-empty">还没有任务。批准之后点右上「派活」，会建一条带这条需求的任务。</div>
                ) : null}
              </section>

              <section className="req-section" data-req-children>
                <div className="req-section-head">
                  <b>子需求</b><span>{childrenOf(projectReqs, selected.id).length}</span>
                  {NEXT_LEVEL[selected.level] ? <span className="req-section-hint">下一层 {LEVEL_LABEL[NEXT_LEVEL[selected.level]!]}</span> : null}
                </div>
                {childrenOf(projectReqs, selected.id).map((child) => (
                  <button className="req-child-row" key={child.id} onClick={() => setSelectedId(child.id)}>
                    <span className={`req-dot ${child.status}`} />
                    <span className="req-key">{child.key.replace(/^[A-Z0-9]+-/, "")}</span>
                    <span className="req-row-title">{child.title}</span>
                    <span className="req-row-end">{gapOf(child, childrenOf(projectReqs, child.id)) ? <span className="req-chip warn">{gapOf(child, childrenOf(projectReqs, child.id))!.label}</span> : null}</span>
                  </button>
                ))}
                {creating?.parentId === selected.id ? (
                  <div className="req-create-row in-detail">
                    <span className="req-key">{LEVEL_LABEL[creating.level]}</span>
                    <input
                      className="req-input"
                      autoFocus
                      value={creating.title}
                      placeholder={`新 ${LEVEL_LABEL[creating.level]} 标题，回车创建`}
                      onChange={(e) => setCreating((prev) => prev ? { ...prev, title: e.target.value } : prev)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void submitCreate((e.target as HTMLInputElement).value); }
                        if (e.key === "Escape") setCreating(null);
                      }}
                    />
                    <button className="btn tiny" onClick={() => setCreating(null)} title="取消" aria-label="取消"><XIcon size={12} /></button>
                  </div>
                ) : NEXT_LEVEL[selected.level] ? (
                  <button className="btn tiny req-add-child" onClick={() => startCreate(selected.id)}><PlusIcon size={12} /> 新建 {LEVEL_LABEL[NEXT_LEVEL[selected.level]!]}</button>
                ) : (
                  <div className="inline-empty">这是交付层，没有下一级需求。</div>
                )}
              </section>

              <section className="req-section">
                <div className="req-section-head">
                  <b>关联</b><span>{linksOf(selected).length}</span>
                  {linkAdding ? null : <button className="btn tiny req-add-link" onClick={() => setLinkAdding(true)}><PlusIcon size={12} /> 关联</button>}
                </div>
                {linksOf(selected).map((link) => {
                  const targetId = link.fromId === selected.id ? link.toId : link.fromId;
                  const target = projectReqs.find((r) => r.id === targetId);
                  if (!target) return null;
                  return (
                    <div className="req-link-row" key={link.id}>
                      <span className="req-chip">{LINK_KIND[link.kind] || link.kind}</span>
                      <button className="req-link-target" onClick={() => setSelectedId(target.id)} title={target.title}>
                        <span className="req-key">{target.key}</span>
                        <span className="req-row-title">{target.title}</span>
                      </button>
                      <button className="req-icon-btn" title="删除关联" aria-label="删除关联" onClick={() => void removeLink(link.id)}><XIcon size={12} /></button>
                    </div>
                  );
                })}
                {!linksOf(selected).length && !linkAdding ? <div className="inline-empty">没有横向关联；父子关系在「子需求」里。</div> : null}
                {linkAdding ? (
                  <div className="req-link-add">
                    <select className="req-select" value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} aria-label="关联到哪条需求">
                      <option value="">选择需求</option>
                      {projectReqs.filter((r) => r.id !== selected.id).map((r) => <option key={r.id} value={r.id}>{r.key} · {r.title}</option>)}
                    </select>
                    <select className="req-select" value={linkKind} onChange={(e) => setLinkKind(e.target.value as RequirementLinkKind)} aria-label="关联类型">
                      {(Object.keys(LINK_KIND) as RequirementLinkKind[]).map((kind) => <option key={kind} value={kind}>{LINK_KIND[kind]}</option>)}
                    </select>
                    <button className="btn tiny" disabled={!linkTarget} onClick={() => void addLink()}>添加</button>
                    <button className="btn tiny" onClick={() => setLinkAdding(false)}>取消</button>
                  </div>
                ) : null}
              </section>
            </div>
          )}
        </section>
      </div> : (
        <section className="req-panel req-matrix-panel" aria-label="追溯矩阵">
          <div className="req-matrix-tools">
            <label className="req-check"><input type="checkbox" checked={matrixOnlyGaps} onChange={(e) => setMatrixOnlyGaps(e.target.checked)} /> 只看缺口</label>
            <span className="req-legend"><b>✓</b> 已批准 <b>○</b> 进行中 <b>—</b> 缺</span>
            <span className="req-matrix-hint">行 = 一条需求链；缺下游 / 缺验收都算缺口</span>
          </div>
          <div className="req-matrix-scroll">
            {matrixShown.length ? (
              <table className="req-matrix">
                <thead><tr>{matrixColumns.map((level) => <th key={level}>{LEVEL_LABEL[level]}</th>)}</tr></thead>
                <tbody>
                  {[...matrixGroups.values()].flatMap((group) => [
                    <tr key={group.root.id} className="req-matrix-group">
                      <th colSpan={matrixColumns.length}>
                        <span className="req-key">{group.root.key}</span>
                        <span className="req-row-title">{group.root.title}</span>
                        <span className="req-row-end">{gapOf(group.root, childrenOf(projectReqs, group.root.id)) ? <span className="req-chip warn">{gapOf(group.root, childrenOf(projectReqs, group.root.id))!.label}</span> : null}</span>
                      </th>
                    </tr>,
                    ...group.paths.map((path, index) => (
                      <tr key={`${path.map((r) => r.id).join("-")}-${index}`}>
                        {matrixColumns.map((level) => {
                          const item = path.find((req) => req.level === level);
                          if (!item) {
                            const index = matrixColumns.indexOf(level);
                            const prevLevel = index === 0 ? "rr" : matrixColumns[index - 1];
                            const prev = prevLevel === "rr" ? path[0] : path.find((req) => req.level === prevLevel);
                            const creatable = !!prev && prev.level === prevLevel;
                            if (creatable && matrixCreating?.parentId === prev.id && matrixCreating.level === level) {
                              return <td key={level}><input className="req-matrix-input" autoFocus value={matrixCreating.title} placeholder={`${LEVEL_LABEL[level]} 标题，回车新建`} onChange={(e) => setMatrixCreating((current) => current ? { ...current, title: e.target.value } : current)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitMatrixCreate((e.target as HTMLInputElement).value); } if (e.key === "Escape") setMatrixCreating(null); }} /></td>;
                            }
                            if (creatable) {
                              return <td key={level}><button className="req-matrix-add" onClick={() => setMatrixCreating({ parentId: prev.id, level, title: "" })} title={`在 ${prev.key} 下新建 ${LEVEL_LABEL[level]}`}><PlusIcon size={10} /> 新建</button></td>;
                            }
                            return <td key={level}><span className="req-matrix-miss">—</span></td>;
                          }
                          const gap = gapOf(item, childrenOf(projectReqs, item.id));
                          return <td key={level}><button className="req-matrix-chip" onClick={() => { setSelectedId(item.id); setTab("pool"); }} title={`${item.key} · ${STATUS_LABEL[item.status]}`}><span className={`req-dot ${item.status}`} /><span>{item.key}</span>{gap ? <span className="req-chip warn">{gap.label}</span> : null}</button></td>;
                        })}
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            ) : <div className="inline-empty">没有匹配的需求链。</div>}
          </div>
        </section>
      )}
    </div>
  );
}
