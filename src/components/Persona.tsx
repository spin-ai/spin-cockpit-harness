import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Evidence = {
  id: string; value: string; quote: string; sourceKind?: string; sourceRef?: string;
  at?: number | null; confidence?: number; conflict?: string | null;
};
type CardRow = {
  field: string; label: string; values: string[]; support: number; level: string;
  conflict: string | null; evidence: Evidence[];
};
type CardSection = { id: string; title: string; rows: CardRow[] };
type Person = { id: string; name: string; relation: string; groupOnly: boolean; isSelf: boolean };
type PersonRow = Person & { confirmed: number; pending: number; completeness: number; lastAt: number; tags?: string[] };
type Network = { id: string; name: string; type: string; strength: number; at: number };
type Card = {
  person: Person; sections: CardSection[]; network: Network[]; oneLiner: string; completeness: number;
  counts: { confirmed: number; pending: number; sensitive: number; fields: number; total: number };
  empty: boolean;
};
type Obs = {
  id: string; personId: string | null; person: string; field: string; value: string; quote: string;
  sourceKind: string; sourceRef: string; sensitive: boolean; createdAt: number;
};
type Drift = { kind: "drift" | "conflict"; field: string; label: string; from?: string; to?: string; value?: string; note?: string; at: number };
type Inject = { markdown: string; chars: number; budget: number; dropped: number };

const FIELD_LABEL: Record<string, string> = {
  identity: "身份", role: "角色 / 职务", situation: "处境", capability: "擅长 / 短板", taboo: "雷区",
  traits: "性格", value: "价值观", goal: "目标 / 动机",
  decision: "决策依据", conflict: "冲突处理", stress: "压力反应", commitment: "承诺可靠性", communication: "沟通方式",
  style: "说话习惯", voice: "语气样本",
  preference: "偏好", constraint: "硬约束", stance: "立场", event: "事件", relation: "关系",
};
/** 多值字段用 chip 展示，其余按「一个结论一行」 */
const CHIP_FIELDS = new Set(["traits", "style", "capability", "preference", "constraint", "stance", "event"]);
const SAMPLE_FIELDS = new Set(["voice"]);

/** 刷新时保持已有人员的位置：只有新出现的人进顶部，操作别人不会让他跳位 */
function mergePeopleOrder(prev: PersonRow[], next: PersonRow[]): PersonRow[] {
  if (!prev.length) return next;
  const rank = new Map(prev.map((p, i) => [p.id, i]));
  const fresh = next.filter((p) => !rank.has(p.id));
  const kept = next.filter((p) => rank.has(p.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...fresh, ...kept];
}

function levelDot(level: string) {
  return level === "高" ? "green" : level === "中" ? "amber" : "slate";
}
function fmtDate(at?: number | null) {
  return at ? new Date(at).toLocaleDateString() : "时间未知";
}

/** 人物：左列表常驻 → 中人设卡（一句话 / 基本信息 / 性格 / 处事 / 说话风格 / 关系网）→ 右复核、漂移、注入预览 */
export function Persona({ act }: { act: Act }) {
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [stats, setStats] = useState<{ people: number; pending: number; confirmed: number; relations: number } | null>(null);
  const [pending, setPending] = useState<Obs[]>([]);
  const [selected, setSelected] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [inject, setInject] = useState<Inject | null>(null);
  const [openEv, setOpenEv] = useState<Record<string, boolean>>({});
  const [onlyMine, setOnlyMine] = useState(false);
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState<{ found: boolean; answer: string; citations: { quote: string }[] } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [paste, setPaste] = useState("");
  const [selfName, setSelfName] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyModeled, setOnlyModeled] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "recent" | "name" | "pending">("score");
  const [tagFilter, setTagFilter] = useState("");
  const [job, setJob] = useState<{ running: boolean; total: number; done: number; current: string; cards: number; llmAdded: number; statsAdded: number; skippedCache: number; cancelled: boolean; failed: string[] } | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const queueRef = useRef<HTMLDivElement | null>(null);

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

  const loadList = useCallback(async () => {
    try {
      const [st, list, pd] = await Promise.all([
        act("personaStats"),
        act("personaPeople"),
        act("personaPending", { limit: 200 }),
      ]);
      setStats(st);
      setPeople((prev) => mergePeopleOrder(prev, list || []));
      setPending(pd || []);
      setSelected((current) => current || (list || []).find((p: PersonRow) => p.isSelf)?.id || (list || [])[0]?.id || "");
    } catch (err) { fail(err); }
  }, [act]);

  const openPerson = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const [c, d, inj] = await Promise.all([
        act("personaCard", { personId: id }),
        act("personaDrift", { personId: id }),
        act("personaInject", { personId: id, maxChars: 6000 }),
      ]);
      setCard(c);
      setDrift(d || []);
      setInject(inj);
      setAnswer(null);
    } catch (err) { fail(err); }
  }, [act]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selected) void openPerson(selected); }, [selected, openPerson]);

  const reload = async (id = selected) => {
    await loadList();
    if (id) await openPerson(id);
  };

  // AI/统计建模：动作会一直跑到结束，所以启动后不 await，改为轮询进度
  const startModel = async (mode: "llm" | "stats", limitOverride?: number) => {
    if (mode === "llm" && !window.confirm("建模会把联系人的部分发言样本发给模型分析（默认最多 12 人，同一份样本只算一次）。继续？")) return;
    try {
      const st = await act("personaModelStatus");
      if (st?.running) { setNotice("已有建模任务在跑"); return; }
      setJob({ running: true, total: 0, done: 0, current: "", cards: 0, llmAdded: 0, statsAdded: 0, skippedCache: 0, cancelled: false, failed: [] });
      setProgress(0);
      const limit = limitOverride ?? (mode === "llm" ? 12 : 0);
      void act("personaModel", { mode, limit })
        .then(() => reload())
        .catch((err) => setNotice(String((err as Error)?.message || err)));
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  useEffect(() => {
    if (!job?.running) return;
    let stopped = false;
    const tick = async () => {
      try {
        const st = await act("personaModelStatus");
        if (stopped || !st) return;
        setJob(st);
        setProgress(st.total ? Math.round((st.done / st.total) * 100) : 0);
        if (!st.running) {
          setNotice(`建模完成：${st.cards} 人出卡 · 统计 ${st.statsAdded} 条 · AI 结论 ${st.llmAdded} 条待确认${st.skippedCache ? ` · 缓存跳过 ${st.skippedCache}` : ""}${st.cancelled ? " · 已取消" : ""}`);
          await reload();
        }
      } catch { /* 结束时动作已抛错，忽略 */ }
    };
    void tick();
    const timer = window.setInterval(tick, 1200);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [job?.running, act]);

  const resolve = async (id: string, accept: boolean, sensitive = false) => {
    try {
      await act("personaResolve", { id, accept, sensitive });
      setNotice(accept ? "已确认" : "已拒绝，同类不再打扰");
      await reload();
    } catch (err) { fail(err); }
  };

  const acceptMine = async () => {
    const list = pending.filter((item) => item.personId === selected && !item.sensitive);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const item of list) await act("personaResolve", { id: item.id, accept: true });
      setNotice(`已确认 ${list.length} 条`);
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const importPaste = async () => {
    if (!paste.trim()) return;
    setBusy(true);
    try {
      const res = await act("personaImport", { text: paste, selfName, title: "手动粘贴", kind: "chat" });
      setNotice(res?.deduped ? "内容重复，已跳过" : `解析 ${res?.messages || 0} 条发言，新增 ${res?.added || 0} 条待确认`);
      setPaste("");
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const importFile = async () => {
    setBusy(true);
    try {
      const res = await act("personaImportPick");
      const added = res?.added || [];
      setNotice(added.length
        ? `导入 ${added.length} 个文件，新增 ${added.reduce((n: number, a: { added?: number }) => n + (a.added || 0), 0)} 条待确认`
        : "没有选择文件");
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const removePerson = async (person: Person) => {
    if (!window.confirm(`删除「${person.name}」的全部观察？人设卡会一起消失。`)) return;
    try {
      const res = await act("personaRemove", { personId: person.id });
      setNotice(`已删除 ${res?.removed || 0} 条`);
      setSelected("");
      await reload("");
    } catch (err) { fail(err); }
  };

  const removePersonById = async (p: PersonRow) => {
    if (!window.confirm(`删除「${p.name}」的全部观察？人设卡会一起消失。`)) return;
    try {
      const res = await act("personaRemove", { personId: p.id });
      setNotice(`已删除 ${res?.removed || 0} 条`);
      if (selected === p.id) setSelected("");
      await loadList();
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  const copyInjectFor = async (p: PersonRow) => {
    try {
      const inj = await act("personaInject", { personId: p.id, maxChars: 6000 });
      if (!inj?.markdown) { setNotice("这个人还没有可注入内容"); return; }
      await navigator.clipboard.writeText(inj.markdown);
      setNotice(`已复制「${p.name}」的注入片段`);
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  const exportCardFor = async (p: PersonRow) => {
    try {
      const c = await act("personaCard", { personId: p.id });
      await navigator.clipboard.writeText(JSON.stringify(c, null, 2));
      setNotice(`已复制「${p.name}」的角色卡 JSON`);
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  const personRow = (p: PersonRow) => (
    <div key={p.id} className="persona-rowwrap">
      <button className={`persona-row ${selected === p.id ? "on" : ""}`} onClick={() => setSelected(p.id)}>
        <span className={`persona-ava ${p.isSelf ? "" : (p.tags || []).includes("已建模") ? "on" : ""}`}>{p.isSelf ? "我" : p.name.slice(0, 1)}</span>
        <span>
          <b>{p.name}</b>
          <em>{p.isSelf ? "本人" : p.relation || "关系未知"}{!p.isSelf && p.groupOnly ? " · 仅群聊" : ""} · {p.completeness}%</em>
          {(p.tags || []).length > 0 && (
            <span className="persona-tags">
              {(p.tags || []).slice(0, 3).map((t) => <i key={t} className={`ptag ${t === "已建模" || t === "人设卡" ? "on" : ""}`}>{t}</i>)}
            </span>
          )}
        </span>
        {p.pending > 0 && <span className="persona-badge">{p.pending}</span>}
      </button>
      <RowMenu title="人物操作">
        <button onClick={() => setSelected(p.id)}>打开人设卡</button>
        <button onClick={() => void copyInjectFor(p)}>复制注入片段</button>
        <button onClick={() => void exportCardFor(p)}>复制角色卡 JSON</button>
        <button className="danger" onClick={() => void removePersonById(p)}>删除此人全部观察</button>
      </RowMenu>
    </div>
  );

  const copyInject = async () => {
    if (!inject?.markdown) return;
    try {
      await navigator.clipboard.writeText(inject.markdown);
      setNotice("注入片段已复制");
    } catch { setNotice("复制失败，可手动选中预览内容"); }
  };

  const exportCard = async () => {
    if (!card) return;
    const payload = {
      name: card.person.name,
      relation: card.person.relation,
      description: card.oneLiner,
      personality: card.sections.find((s) => s.id === "character")?.rows.flatMap((r) => r.values) || [],
      behavior: card.sections.find((s) => s.id === "behavior")?.rows.map((r) => `${r.label}：${r.values[0]}`) || [],
      mes_example: card.sections.find((s) => s.id === "voice")?.rows.find((r) => r.field === "voice")?.evidence.map((e) => e.quote) || [],
      network: card.network.map((n) => `${n.name}${n.type ? `（${n.type}）` : ""}`),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice("角色卡 JSON 已复制（字段对齐 Character Card V2）");
    } catch { setNotice("复制失败"); }
  };

  const runAsk = async () => {
    if (!ask.trim()) return;
    setBusy(true);
    try { setAnswer(await act("personaAsk", { question: ask.trim() })); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const visibleQueue = useMemo(
    () => pending.filter((item) => !onlyMine || item.personId === selected),
    [pending, onlyMine, selected],
  );
  const minePending = pending.filter((item) => item.personId === selected);
  const searchable = useMemo(
    () => people.filter((p) => {
      if (onlyModeled && !(p.tags || []).includes("已建模")) return false;
      if (tagFilter && !(p.tags || []).includes(tagFilter)) return false;
      return !q.trim() || p.name.includes(q.trim()) || (p.relation || "").includes(q.trim());
    }),
    [people, q, onlyModeled, tagFilter],
  );
  const sorter = (a: PersonRow, b: PersonRow) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
    if (sortBy === "recent") return (b.lastAt || 0) - (a.lastAt || 0);
    if (sortBy === "pending") return (b.pending || 0) - (a.pending || 0) || b.completeness - a.completeness;
    return (b.completeness - a.completeness) || a.name.localeCompare(b.name);
  };
  const listSelf = searchable.filter((p) => p.isSelf).sort(sorter);
  const modeled = searchable.filter((p) => !p.isSelf && (p.tags || []).includes("已建模")).sort(sorter);
  const listOthers = searchable.filter((p) => !p.isSelf && !(p.tags || []).includes("已建模")).sort(sorter);
  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of people) for (const t of p.tags || []) map.set(t, (map.get(t) || 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [people]);

  const toggleEv = (key: string) => setOpenEv((prev) => ({ ...prev, [key]: !prev[key] }));
  const sectionSupport = (sec: CardSection) => Math.max(0, ...sec.rows.map((r) => r.support));
  const sectionLevel = (sec: CardSection) => {
    const n = sectionSupport(sec);
    return n >= 4 ? "高" : n >= 2 ? "中" : n ? "低" : "无";
  };

  const renderRow = (row: CardRow, mode: "fact" | "behavior") => {
    if (CHIP_FIELDS.has(row.field)) {
      return (
        <div className="persona-chips" key={row.field}>
          {[...new Set(row.values)].slice(0, 8).map((v) => (
            <span className={`persona-chip ${row.field === "traits" ? "on" : ""}`} key={v}>{v}</span>
          ))}
        </div>
      );
    }
    if (mode === "behavior") {
      return (
        <div className="persona-beh-row" key={row.field}>
          <span className="k">{row.label}</span>
          <span className="v">
            {[...new Set(row.values)].slice(0, 2).join("；")}
            {row.conflict ? <span className="tiny faint" style={{ display: "block" }}>⚠ {row.conflict}</span> : null}
          </span>
          <span className="m">
            <span className="persona-conf"><i className={`dot ${levelDot(row.level)}`} />依据 {row.support}</span>
          </span>
        </div>
      );
    }
    return (
      <div className="persona-fact" key={row.field}>
        <dt>{row.label}</dt>
        <dd title={row.values[0]}>{row.values[0]}</dd>
      </div>
    );
  };

  const renderSection = (sec: CardSection) => {
    const key = `${card?.person.id || ""}:${sec.id}`;
    const hasEvidence = sec.rows.some((r) => r.evidence.length > 0);
    const samples = sec.rows.find((r) => SAMPLE_FIELDS.has(r.field));
    const plainRows = sec.rows.filter((r) => !SAMPLE_FIELDS.has(r.field));
    const factRows = plainRows.filter((r) => !CHIP_FIELDS.has(r.field));
    const chipRows = plainRows.filter((r) => CHIP_FIELDS.has(r.field));
    const evidenceRows = sec.rows.flatMap((r) => r.evidence.map((e) => ({ e, row: r })));
    return (
      <section className="persona-sec" key={sec.id}>
        <div className="persona-sec-head">
          <h3>{sec.title}</h3>
          <em>依据 {sectionSupport(sec)} · 置信 {sectionLevel(sec)}</em>
          <span style={{ flex: 1 }} />
          {hasEvidence && (
            <button className="link" onClick={() => toggleEv(key)}>{openEv[key] ? "收起原话" : "展开原话"}</button>
          )}
        </div>

        {sec.id === "behavior" ? (
          <div className="persona-beh">{plainRows.map((r) => renderRow(r, "behavior"))}</div>
        ) : sec.id === "voice" ? (
          <>
            {samples && samples.evidence.length > 0 && (
              <div className="persona-samples">
                {samples.evidence.slice(0, 2).map((e) => (
                  <div className="persona-sample" key={e.id}>
                    <q>{e.quote}</q>
                    <span>{fmtDate(e.at)} · {e.sourceKind === "doc" ? "资料" : "聊天"}{e.sourceRef ? ` · ${e.sourceRef.slice(0, 18)}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
            {chipRows.map((r) => renderRow(r, "fact"))}
          </>
        ) : (
          <>
            {factRows.length > 0 && <dl className="persona-facts" style={{ margin: 0 }}>{factRows.map((r) => renderRow(r, "fact"))}</dl>}
            {chipRows.map((r) => renderRow(r, "fact"))}
          </>
        )}

        {openEv[key] && (
          <div className="persona-ev">
            {evidenceRows.slice(0, 8).map(({ e, row }) => (
              <div className="persona-ev-item" key={e.id}>
                <q>{e.quote || e.value}</q>
                <div className="persona-ev-meta">
                  <span>{row.label}</span>
                  {e.at ? <span>{fmtDate(e.at)}</span> : null}
                  <span>{e.sourceKind === "doc" ? "资料" : "聊天"}</span>
                  {e.conflict ? <span className="tag warn">{e.conflict}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="notes-page kv-page">
      <PageHeader
        kicker="PERSONA"
        title="人物"
        subtitle={<div className="notes-stats">
          <span><b>{stats?.people || 0}</b> 人物</span>
          <span><b>{people.filter((p) => p.completeness >= 50).length}</b> 人设卡就绪</span>
          <span className={stats?.pending ? "warn" : ""}><b>{stats?.pending || 0}</b> 待确认</span>
          <span><b>{stats?.relations || 0}</b> 关系</span>
        </div>}
        actions={<>
          <button
            className="btn primary"
            onClick={() => { setOnlyMine(false); queueRef.current?.scrollIntoView({ block: "start" }); }}
          >确认待确认 <em>{stats?.pending || 0}</em></button>
          <button className="btn" onClick={() => setShowImport((v) => !v)}>{showImport ? "收起导入" : "导入聊天记录"}</button>
          <button
            className="btn"
            disabled={Boolean(job?.running)}
            title="建模：先用统计算出可观测特征，再让模型逐人分析（同一份样本只算一次）"
            onClick={() => void startModel("llm")}
          >建模</button>
          <RowMenu title="建模选项">
            <button
              disabled={Boolean(job?.running)}
              onClick={async () => {
                try {
                  const plan = await act("personaModelPlan", { minMessages: 30 });
                  const calls = plan?.calls ?? plan?.eligible ?? 0;
                  if (!calls) { setNotice("没有需要建模的人（可能都已缓存）"); return; }
                  if (!window.confirm(`一键全部建模：\n\n可建模 ${plan.eligible} 人（已缓存 ${plan.cached} 人跳过）\n本次预计 ${calls} 次模型调用，按顺序逐人跑，可随时取消。\n\n继续？`)) return;
                  await startModel("llm", 0);
                } catch (err) { setNotice(String((err as Error)?.message || err)); }
              }}
            >一键全部建模（未建模的全部跑一遍）</button>
            <button onClick={() => void startModel("stats")} disabled={Boolean(job?.running)}>只跑统计（不调用模型，不消耗额度）</button>
            <button onClick={() => { setJob(null); setNotice(`上次任务：${job?.cards || 0} 人出卡`); }}>查看上次进度</button>
          </RowMenu>
          <button className="icon-btn" onClick={() => void reload()} title="刷新">↻</button>
        </>}
      />
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }}>×</button>
        </div>
      )}

      {(job?.running || job?.done) && (
        <div className="pr-modeljob">
          <div className="pr-modeljob-main">
            <b>{job.running ? `建模中 · ${job.done}/${job.total || "?"}` : `本次建模完成 · ${job.cards} 人出卡`}</b>
            <span className="tiny faint">
              {job.running ? (job.current ? `当前：${job.current}` : "准备中…") : `统计 ${job.statsAdded} 条 · 模型结论 ${job.llmAdded} 条待确认${job.skippedCache ? ` · 缓存跳过 ${job.skippedCache}` : ""}`}
            </span>
          </div>
          <div className="pr-modeljob-bar"><i style={{ width: `${job.running ? Math.max(4, progress) : 100}%` }} /></div>
          <div className="row gap6">
            {job.running
              ? <button className="btn tiny-btn" onClick={() => void act("personaModelCancel").then(() => setNotice("已请求取消"))}>取消</button>
              : <>
                {job.llmAdded > 0 && <button className="btn tiny-btn primary" onClick={() => void act("personaModelResolve", { accept: true }).then(async () => { setNotice("本次 AI 结论已全部确认"); await reload(); })}>确认本次 AI 结论</button>}
                {job.llmAdded > 0 && <button className="btn tiny-btn" onClick={() => void act("personaModelResolve", { accept: false }).then(async () => { setNotice("本次 AI 结论已全部拒绝"); await reload(); })}>全部拒绝</button>}
                <button className="link tiny" onClick={() => setJob(null)}>收起</button>
              </>}
          </div>
        </div>
      )}

      {showImport && (
        <div className="kv-block kv-paste">
          <div className="notes-meta-title">导入</div>
          <label className="kv-field">
            <span>你的名字（用于区分「本人」）</span>
            <input className="kv-input" value={selfName} onChange={(e) => setSelfName(e.target.value)} placeholder="例如：李雯" />
          </label>
          <textarea
            className="kv-ask" rows={4} value={paste}
            placeholder={"粘贴聊天记录，支持：\n2024-01-02 12:34:56 李雯\n李雯: 内容"}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="row gap6">
            <button className="btn tiny-btn primary" onClick={() => void importPaste()} disabled={busy || !paste.trim()}>解析并进待确认</button>
            <button className="btn tiny-btn" onClick={() => void importFile()} disabled={busy}>选择文件…</button>
            <span className="tiny faint">规则抽取，结果全部进待确认；重复内容按 hash 去重。</span>
          </div>
        </div>
      )}

      <div className="persona-grid">

        {/* ── 左：人物列表常驻 ───────────────────────────── */}
        <aside className="persona-col">
          <div className="kv-block">
            <div className="persona-block-title">人物 <em>{people.length}</em></div>
            <input
              className="notes-search" value={q} placeholder="搜人物 / 关系"
              onChange={(e) => setQ(e.target.value)} aria-label="搜索人物"
            />
            <div className="list-tools">
              <select className="list-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="排序">
                <option value="score">按完整度</option>
                <option value="recent">按最近更新</option>
                <option value="pending">按待确认</option>
                <option value="name">按姓名</option>
              </select>
              <button className={`list-chip ${onlyModeled ? "on" : ""}`} onClick={() => setOnlyModeled((v) => !v)}>已建模 {people.filter((p) => (p.tags || []).includes("已建模")).length}</button>
              <button className={`list-chip ${tagFilter ? "on" : ""}`} onClick={() => setTagFilter("")} hidden={!tagFilter}>清除筛选</button>
            </div>
            <div className="list-chips">
              {allTags.map(([t, n]) => (
                <button key={t} className={`list-chip ${tagFilter === t ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === t ? "" : t)}>{t} <em>{n}</em></button>
              ))}
            </div>
            {listSelf.length > 0 && <div className="persona-group">本人</div>}
            <div className="persona-list">
              {listSelf.map(personRow)}
            </div>
            {modeled.length > 0 && (
              <div className="persona-group">
                已建模 <em>{modeled.length}</em>
              </div>
            )}
            {modeled.map(personRow)}
            {listOthers.length > 0 && <div className="persona-group">未建模 <em>{listOthers.length}</em></div>}
            <div className="persona-list">
              {listOthers.map(personRow)}
            </div>
            {listSelf.length + listOthers.length === 0 && (
              <p className="notes-meta-empty">还没有人物。导入聊天记录后，发言者会出现在这里。</p>
            )}
          </div>
        </aside>

        {/* ── 中：人设卡（唯一主面） ─────────────────────── */}
        <main className="persona-col">
          {!card ? (
            <div className="persona-card">
              <EmptyState
                mark="◔" title="还没有人设卡"
                desc="导入微信 / 飞书 / Telegram 导出的聊天记录，或粘贴一段对话。抽取结果先进待确认，确认后才进人设卡。"
                action={<button className="btn primary" onClick={() => setShowImport(true)}>导入聊天记录</button>}
              />
            </div>
          ) : (
            <article className="persona-card">
              <div className="persona-head">
                <span className="persona-ava">{card.person.isSelf ? "我" : card.person.name.slice(0, 1)}</span>
                <div style={{ minWidth: 0 }}>
                  <h2>
                    {card.person.name}
                    <span className="tag">{card.person.isSelf ? "本人" : card.person.relation || "关系未知"}</span>
                    {(card.person as PersonRow).tags?.map((t) => <span key={t} className={`ptag ${t === "已建模" || t === "人设卡" ? "on" : ""}`}>{t}</span>)}
                  </h2>
                  <p>
                    <span>依据 {card.counts.confirmed} 条原话</span>
                    <span>·</span>
                    <span>覆盖 {card.counts.fields}/{card.counts.total} 类字段</span>
                    {card.counts.pending > 0 && <span>·</span>}
                    {card.counts.pending > 0 && <span>{card.counts.pending} 条待确认</span>}
                  </p>
                </div>
                <div className="row gap6" style={{ alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                    <span className="tiny faint mono">{card.completeness}%</span>
                    <span className="persona-bar" style={{ width: 64 }}>
                      <i style={{ width: `${card.completeness}%` }} />
                    </span>
                  </div>
                  <RowMenu title="人物操作">
                    <button onClick={() => void copyInject()}>复制注入片段</button>
                    <button onClick={() => void exportCard()}>导出角色卡 JSON</button>
                    <button onClick={() => setShowImport(true)}>从聊天记录补全</button>
                    <button className="danger" onClick={() => void removePerson(card.person)}>删除此人全部观察</button>
                  </RowMenu>
                </div>
              </div>

              {card.empty ? (
                <EmptyState
                  compact mark="◔"
                  title={`${card.person.name} 还没有人设卡`}
                  desc={card.counts.pending
                    ? `已有 ${card.counts.pending} 条待确认观察。确认后会按「性格 / 处事 / 关系」归到对应小节。`
                    : "先在右侧确认观察，或导入一段聊天记录。"}
                  action={card.counts.pending
                    ? <button className="btn tiny-btn" onClick={() => { setOnlyMine(true); queueRef.current?.scrollIntoView({ block: "start" }); }}>去确认这 {card.counts.pending} 条</button>
                    : undefined}
                />
              ) : (
                <>
                  {card.oneLiner && (
                    <p className="persona-oneline">
                      {card.oneLiner}
                      <span>由 {card.counts.confirmed} 条已确认观察归纳 · 可改写；没有依据的推断进不来</span>
                    </p>
                  )}

                  {card.sections.map(renderSection)}

                  {card.network.length > 0 && (
                    <section className="persona-sec">
                      <div className="persona-sec-head">
                        <h3>关系网</h3><em>依据 {card.network.length}</em>
                      </div>
                      <div className="persona-rowlist">
                        {card.network.map((n) => (
                          <div className="persona-rel" key={n.id}>
                            <span className="persona-ava">{n.name.slice(0, 1)}</span>
                            <span><b>{n.name}</b><em>{n.type || "关系"}</em></span>
                            <span className="persona-bar"><i style={{ width: `${Math.round((n.strength || 0.5) * 100)}%` }} /></span>
                            <span className="t">{fmtDate(n.at)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {card.counts.sensitive > 0 && (
                    <section className="persona-sec">
                      <div className="persona-locked">
                        <span>🔒 敏感事实</span>
                        <span className="tiny faint mono">{card.counts.sensitive} 条</span>
                        <span style={{ flex: 1 }} />
                        <span className="tiny faint">默认不进人设卡、不进注入</span>
                      </div>
                    </section>
                  )}
                </>
              )}
            </article>
          )}
        </main>

        {/* ── 右：复核队列 / 漂移 / 注入 / 决策辅助 ──────── */}
        <aside className="persona-col side">
          <div className="kv-block" ref={queueRef}>
            <div className="persona-block-title">
              待确认 <em>{visibleQueue.length}</em>
              <button className={`link ${onlyMine ? "on" : ""}`} onClick={() => setOnlyMine((v) => !v)}>
                {onlyMine ? "看全部" : "只看此人"}
              </button>
            </div>
            {minePending.some((item) => !item.sensitive) && (
              <div className="persona-batch">
                <span>{card?.person.name || "此人"} 还有 {minePending.filter((i) => !i.sensitive).length} 条可批量确认</span>
                <span style={{ flex: 1 }} />
                <button className="link" onClick={() => void acceptMine()} disabled={busy}>全部接受</button>
              </div>
            )}
            {visibleQueue.length === 0 && (
              <p className="notes-meta-empty">没有待确认的推断。导入聊天记录后，每条事实都要你确认才生效。</p>
            )}
            {visibleQueue.slice(0, 12).map((o) => (
              <div className="persona-qitem" key={o.id}>
                <div className="qhead">
                  {o.person} · <span className={`tag ${o.sensitive ? "warn" : ""}`}>{FIELD_LABEL[o.field] || o.field}</span>
                </div>
                {o.quote && <q>{o.quote}</q>}
                <div className="qfoot">
                  <span className="src">{o.sourceKind === "doc" ? "资料" : "聊天"} · {fmtDate(o.createdAt)}</span>
                  <button className="btn tiny-btn" onClick={() => void resolve(o.id, false)}>拒绝</button>
                  <button className="btn tiny-btn ok" onClick={() => void resolve(o.id, true, o.sensitive)}>确认</button>
                </div>
              </div>
            ))}
            {visibleQueue.length > 12 && <p className="notes-meta-empty">还有 {visibleQueue.length - 12} 条未显示。</p>}
          </div>

          <div className="kv-block">
            <div className="persona-block-title">变化与矛盾 <em>{drift.length}</em></div>
            {drift.length === 0 ? (
              <p className="notes-meta-empty">没有可对比的变化。同一字段有了不同时间的记录后，这里会显示漂移与矛盾。</p>
            ) : (
              <div className="persona-drift">
                {drift.map((d) => (
                  <div className="persona-drift-row" key={`${d.kind}-${d.field}-${d.at}`}>
                    <span className="d">{new Date(d.at).toLocaleDateString()}</span>
                    <span className="c">
                      <b>{d.label}</b>
                      {d.kind === "drift" ? `：${d.from} → ${d.to}` : `：${d.value}${d.note ? `（${d.note}）` : ""}`}
                    </span>
                    <span className={`tag ${d.kind === "conflict" ? "warn" : ""}`}>{d.kind === "drift" ? "漂移" : "矛盾"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="kv-block">
            <div className="persona-block-title">
              注入预览
              <em>{Math.round((inject?.chars || 0) / 100) / 10}k / {Math.round((inject?.budget || 6000) / 1000)}k</em>
              <button className="link" onClick={() => void copyInject()} disabled={!inject?.markdown}>复制</button>
            </div>
            <div className="persona-budget">
              <span className="track"><i style={{ width: `${Math.min(100, Math.round(((inject?.chars || 0) / (inject?.budget || 6000)) * 100))}%` }} /></span>
              <em>{Math.min(100, Math.round(((inject?.chars || 0) / (inject?.budget || 6000)) * 100))}%</em>
            </div>
            <pre className="kv-inject">{inject?.markdown || "（还没有可注入的人设卡）"}</pre>
            <p className="notes-meta-empty">
              敏感项永不注入。预算不足时先砍关系网、再砍其他事实；一句话概括与处事方式优先保留。
              {inject?.dropped ? `本次省略 ${inject.dropped} 条。` : ""}
            </p>
          </div>

          <div className="kv-block">
            <div className="persona-block-title">决策辅助</div>
            <textarea
              className="kv-ask" rows={3} value={ask}
              placeholder="该找谁推进这件事？他大概率会怎么反应？"
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runAsk(); } }}
            />
            <button className="btn tiny-btn primary" onClick={() => void runAsk()} disabled={busy || !ask.trim()}>查画像</button>
            {answer && (
              <div className="kv-answer">
                <div className="kv-answer-head"><b>{answer.found ? "依据" : "未知"}</b><span className="tiny faint">{answer.citations.length} 条来源</span></div>
                <div className="kv-answer-body">{answer.answer}</div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
