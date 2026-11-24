import { useEffect, useMemo, useState } from "react";
import type { Requirement, RequirementLevel, RequirementStatus, State } from "../types";
import { PageHeader } from "./PageHeader";
import { Overview } from "./Overview";
import { EmptyState } from "./EmptyState";
import { ChevronDownIcon, ChevronLeftIcon, PlusIcon, XIcon } from "./Icons";
import { confirmDialog } from "./ConfirmHost";

type Act = (type: string, payload?: unknown) => Promise<any>;

const LEVELS: RequirementLevel[] = ["ir", "sr", "us"];
const LEVEL_LABEL: Record<RequirementLevel, string> = { ir: "IR", sr: "SR", us: "US" };
const LEVEL_NAME: Record<RequirementLevel, string> = { ir: "初始需求", sr: "系统需求", us: "用户故事" };
const NEXT_LEVEL: Record<RequirementLevel, RequirementLevel | null> = { ir: "sr", sr: "us", us: null };
const STATUS_LABEL: Record<RequirementStatus, string> = {
  draft: "草稿", reviewing: "待评审", approved: "已批准", done: "已完成",
  rejected: "已拒绝", obsolete: "已废弃", in_progress: "实现中", verifying: "待验收",
};
const M0_STATUSES: RequirementStatus[] = ["draft", "reviewing", "approved", "done", "rejected", "obsolete"];
const FIELD_LABEL: Record<string, string> = {
  scope: "范围", outOfScope: "范围外", impact: "影响模块", acceptance: "验收判据",
  role: "角色", value: "价值", children: "子需求", tasks: "任务",
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

function gapOf(req: Requirement, children: Requirement[]): { label: string; tone?: "warn" } | null {
  if ((req.level === "sr" || req.level === "us") && !acceptance(req).length) return { label: "缺验收", tone: "warn" };
  if (req.level !== "us" && !children.length) return { label: "缺下游", tone: "warn" };
  return null;
}

function missingFields(req: Requirement): string[] {
  const missing: string[] = [];
  const required = req.level === "ir" ? ["scope", "outOfScope"] : req.level === "sr" ? ["impact", "acceptance"] : ["role", "value", "acceptance"];
  for (const field of required) {
    if (field === "acceptance") {
      if (!acceptance(req).length) missing.push(field);
    } else if (!String((req as unknown as Record<string, unknown>)[field] || "").trim()) {
      missing.push(field);
    }
  }
  return missing;
}

function gateFor(req: Requirement, next: RequirementStatus, children: Requirement[]): { ok: boolean; missing: string[]; message: string } {
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
    if (req.level === "ir") {
      if (!children.length) return { ok: false, missing: ["children"], message: "IR 还没有子需求" };
      const open = children.filter((c) => !["approved", "done"].includes(c.status));
      if (open.length) return { ok: false, missing: ["children"], message: `还有 ${open.length} 条子需求没批准` };
    }
  }
  return { ok: true, missing: [], message: "" };
}

type DraftKey = "title" | "body" | "priority" | "owner" | "source" | "requester" | "scope" | "outOfScope" | "impact" | "role" | "value";

export function Requirements({ state, act, notify, onBack }: { state: State; act: Act; notify: (message: string) => void; onBack?: () => void }) {
  const requirements = state.requirements ?? [];
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0] ?? null;
  const projectReqs = useMemo(
    () => (project ? requirements.filter((r) => r.projectId === project.id).sort(byCreated) : []),
    [requirements, project?.id],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | RequirementLevel>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RequirementStatus>("all");
  const [creating, setCreating] = useState<{ parentId: string | null; level: RequirementLevel; title: string } | null>(null);
  const [gate, setGate] = useState<{ missing: string[]; message: string } | null>(null);
  const [form, setForm] = useState<Record<DraftKey, string>>({
    title: "", body: "", priority: "P2", owner: "", source: "", requester: "",
    scope: "", outOfScope: "", impact: "", role: "", value: "",
  });
  const [accText, setAccText] = useState("");
  const selected = projectReqs.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    const roots = projectReqs.filter((r) => !r.parentId);
    setExpanded(new Set(roots.map((r) => r.id)));
    setSelectedId((prev) => (prev && projectReqs.some((r) => r.id === prev) ? prev : roots[0]?.id ?? null));
    setGate(null);
    setCreating(null);
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
  const gapCount = projectReqs.filter((r) => gapOf(r, childrenOf(projectReqs, r.id))).length;

  const save = async (field: DraftKey, value: string) => {
    if (!selected) return;
    if (String((selected as unknown as Record<string, unknown>)[field] ?? "") === value) return;
    const res = await act("requirementUpdate", { id: selected.id, [field]: value });
    if (!res) setForm((prev) => ({ ...prev, [field]: String((selected as unknown as Record<string, unknown>)[field] ?? "") }));
  };

  const setStatus = async (next: RequirementStatus) => {
    if (!selected) return;
    if (next === selected.status) return;
    const local = gateFor(selected, next, childrenOf(projectReqs, selected.id));
    if (!local.ok) { setGate(local); return; }
    const res = await act("requirementSetStatus", { id: selected.id, status: next });
    if (res) setGate(null);
    else setGate({ missing: [], message: "状态更新失败，见右下角错误" });
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
    const level: RequirementLevel = parentId ? (NEXT_LEVEL[projectReqs.find((r) => r.id === parentId)?.level || "ir"] || "us") : "ir";
    setCreating({ parentId, level, title: "" });
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
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
    <div className="page req-page">
      <PageHeader
        title="需求"
        subtitle={`${project?.name || "未选择项目"} · IR → SR → US · 先完成需求定义`}
        actions={<div className="row gap8">
          {onBack ? <button className="btn tiny" onClick={onBack} title="返回项目" aria-label="返回项目"><ChevronLeftIcon size={14} /></button> : null}
          <select className="req-select" aria-label="切换项目" value={project?.id || ""} onChange={(e) => void switchProject(e.target.value)}>
            {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn primary" onClick={() => startCreate(null)}><PlusIcon size={14} /> 新建需求</button>
        </div>}
      />

      <Overview items={[
        { label: "需求", value: projectReqs.length },
        { label: "待评审", value: projectReqs.filter((r) => r.status === "reviewing").length },
        { label: "已批准", value: projectReqs.filter((r) => r.status === "approved").length },
        { label: "缺口", value: gapCount, tone: gapCount ? "warn" : undefined },
        { label: "已完成", value: projectReqs.filter((r) => r.status === "done").length },
      ]} />

      <div className="req-shell">
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
                <span className="req-key">IR</span>
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
                <EmptyState compact title="还没有需求" desc="先用一条 IR 记下来源，再往下拆 SR / US。" action={<button className="btn tiny" onClick={() => startCreate(null)}>新建 IR</button>} />
              ))}
          </div>
        </section>

        <section className="req-panel req-detail" aria-label="需求详情">
          {!selected ? (
            projectReqs.length
              ? <EmptyState compact title="选择一条需求" desc="左栏点一行查看 / 修改；点击行尾箭头展开子需求。" />
              : <div className="inline-empty">左侧先建一条 IR；需求先定义，再拆到 SR / US。</div>
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
                  <input className="req-input" value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))} onBlur={() => void save("source", form.source)} placeholder="客户 / 内部 / 数据" />
                </label>
                {selected.status === "draft" && childrenOf(projectReqs, selected.id).length === 0 ? (
                  <button className="btn tiny ghost req-delete" onClick={() => void removeSelected()}>删除草稿</button>
                ) : null}
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
