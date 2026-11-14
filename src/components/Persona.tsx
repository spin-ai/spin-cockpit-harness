import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";
import { ListContextMenu } from "./ListContextMenu";
import { UndoBar, useDensity, type UndoAction } from "./UndoBar";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Evidence = {
  id: string; value: string; quote: string; sourceKind?: string; sourceRef?: string;
  at?: number | null; confidence?: number; conflict?: string | null; verified?: boolean | null;
};
type CardRow = {
  field: string; label: string; values: string[]; support: number; level: string;
  conflict: string | null; evidence: Evidence[]; heat?: number; total?: number; overflow?: number;
};
type CardSection = { id: string; title: string; rows: CardRow[] };
/** 导入格式的中文名，用来在提示里说清「识别成了什么」 */
const FORMAT_LABEL: Record<string, string> = {
  telegram: "Telegram 导出",
  feishu: "飞书导出",
  wechat: "微信 txt",
  csv: "CSV",
  json: "通用 JSON",
  text: "纯文本",
};

type Person = { id: string; name: string; relation: string; groupOnly: boolean; isSelf: boolean };
type PersonRow = Person & { confirmed: number; pending: number; review?: number; completeness: number; lastAt: number; supportMedian?: number; tags?: string[] };
type Network = { id: string; name: string; type: string; strength: number; at: number; context?: string | null; groupOnly?: boolean };
/** 可观测特征：数得出来的，每次建模重算，不算"事实"，因此不参与冲突/漂移 */
type Measure = { key: string; field: string; label: string; value: string; num: number | null; prevValue?: string | null; prevNum?: number | null; times: number; computedAt: number; changedAt: number };
type ReviewItem = { id: string; field: string; label: string; value: string; quote: string; reason: string; expiresAt: number | null; heat: number };
type MergeHint = { field: string; label: string; personId: string; person: string; keep: { id: string; value: string; evidence: number }; drop: { id: string; value: string; evidence: number }; score: number };
type Card = {
  person: Person; sections: CardSection[]; network: Network[]; oneLiner: string; oneLinerAt?: number | null; oneLinerStale?: boolean; completeness: number;
  measures: Measure[]; needsReview: ReviewItem[];
  metrics: { supportMedian: number; conflictRatio: number; needsReview: number; unverified?: number; overflow?: number; measureAt: number };
  counts: { confirmed: number; pending: number; sensitive: number; fields: number; measureFields?: number; total: number };
  empty: boolean;
};
type Obs = {
  id: string; personId: string | null; person: string; field: string; value: string; quote: string;
  sourceKind: string; sourceRef: string; sensitive: boolean; createdAt: number; evidenceCount?: number; reviewAt?: number | null; quoteVerified?: boolean | null; evidenceStat?: boolean;
};
type AsOfField = { field: string; label: string; value?: string; values?: string[]; history?: { value: string; from: number; to: number | null }[]; at: number; confidence: number };
type AsOf = { at: number; mode?: "event" | "known"; fields: AsOfField[]; count: number };
type Drift = { kind: "drift" | "conflict" | "trend"; field: string; label: string; from?: string; to?: string; value?: string; note?: string; at: number; key?: string; times?: number };
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
  const [asOfAt, setAsOfAt] = useState("");
  const [asOfMode, setAsOfMode] = useState<"event" | "known">("event");
  const [asOf, setAsOf] = useState<AsOf | null>(null);
  const [merges, setMerges] = useState<MergeHint[]>([]);
  const [skipMerges, setSkipMerges] = useState<Set<string>>(new Set());
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
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lastPick, setLastPick] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; person: PersonRow } | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const { dense, toggle: toggleDense } = useDensity("persona");
  const [showFilter, setShowFilter] = useState(false);
  const [adding, setAdding] = useState<{ field: string; value: string } | null>(null);
  const [job, setJob] = useState<{ running: boolean; total: number; done: number; current: string; cards: number; llmAdded: number; statsAdded: number; unverified?: number; skippedCache: number; skippedNames?: string[]; cancelled: boolean; failed: string[]; failedCount?: number } | null>(null);
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
      const [c, d, inj, mg] = await Promise.all([
        act("personaCard", { personId: id }),
        act("personaDrift", { personId: id }),
        act("personaInject", { personId: id, maxChars: 6000 }),
        act("personaMergeSuggestions", { personId: id, limit: 5 }).catch(() => []),
      ]);
      setCard(c);
      setDrift(d || []);
      setInject(inj);
      setMerges(mg || []);
      setSkipMerges(new Set());
      setAnswer(null);
      setAsOf(null);
    } catch (err) { fail(err); }
  }, [act]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selected) void openPerson(selected); }, [selected, openPerson]);
  // 到期扫描：只标 stale（不删数据），进页面跑一次，复核队列才不会永远是空的
  useEffect(() => { void act("personaSweep").catch(() => {}); }, [act]);

  const reload = async (id = selected) => {
    await loadList();
    if (id) await openPerson(id);
  };

  // AI/统计建模：动作会一直跑到结束，所以启动后不 await，改为轮询进度
  const startModel = async (mode: "llm" | "stats", limitOverride?: number, names?: string[], ask = true, ignoreCache = false) => {
    if (ask && mode === "llm" && !window.confirm("建模会把联系人的部分发言样本发给模型分析（默认最多 12 人，同一份样本只算一次）。继续？")) return;
    try {
      const st = await act("personaModelStatus");
      if (st?.running) { setNotice("已有建模任务在跑"); return; }
      setJob({ running: true, total: 0, done: 0, current: "", cards: 0, llmAdded: 0, statsAdded: 0, skippedCache: 0, skippedNames: [], cancelled: false, failed: [] });
      setProgress(0);
      const limit = limitOverride ?? (mode === "llm" ? 12 : 0);
      void act("personaModel", { mode, limit, ...(ignoreCache ? { ignoreCache: true } : {}), ...(names?.length ? { names } : {}) })
        .then(() => reload())
        .catch((err) => { setJob(null); setNotice(String((err as Error)?.message || err)); });
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  // 切走再回来：任务是在主进程里跑的，挂载时把状态接回来（否则进度条消失）
  useEffect(() => {
    let alive = true;
    void act("personaModelStatus").then((st) => {
      if (!alive || !st) return;
      const recent = st.finishedAt && Date.now() - st.finishedAt < 30 * 60 * 1000;
      if (st.running || (st.done > 0 && recent)) {
        setJob(st);
        setProgress(st.total ? Math.round((st.done / st.total) * 100) : 0);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [act]);

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
          const skip = st.skippedCache ? ` · 缓存跳过 ${st.skippedCache} 人${st.skippedNames?.length ? `（${st.skippedNames.slice(0, 3).join("、")}${st.skippedCache > 3 ? " 等" : ""}）` : ""}` : "";
          const failed = st.failed?.length ? ` · ${st.failedCount || st.failed.length} 人没出结论：${String(st.failed[0]).slice(0, 60)}` : "";
          const unv = st.unverified ? ` · 其中 ${st.unverified} 条引用在样本里核对不到（已标出、降权）` : "";
          setNotice(`建模完成：${st.cards} 人出卡 · 统计 ${st.statsAdded} 条 · AI 结论 ${st.llmAdded} 条待确认${unv}${skip}${failed}${st.cancelled ? " · 已取消" : ""}`);
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
      setNotice(accept ? "已确认" : "已拒绝；同类事实第二次被观察到时会再问一次，不会永久静音");
      await reload();
    } catch (err) { fail(err); }
  };

  /** 复核：仍然成立就续期，否则用 valid_to 收口（不删除，历史仍可回查） */
  const reviewOne = async (id: string, keep: boolean) => {
    try {
      await act("personaReviewResolve", { id, keep });
      setNotice(keep ? "已续期，重新进人设卡" : "已收口（不删除，可在回看里找到）");
      await reload();
    } catch (err) { fail(err); }
  };

  /** 批量复核：13 条逐个点没人干，但要到人确认，所以给两个整体动作而不是自动处理 */
  const reviewAll = async (keep: boolean) => {
    if (!card) return;
    setBusy(true);
    try {
      const res = await act("personaReviewMany", { personId: card.person.id, keep });
      setNotice(keep ? `${res?.resolved || 0} 条已续期` : `${res?.resolved || 0} 条已收口（回看里仍可查）`);
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const mergeOne = async (m: MergeHint) => {
    try {
      await act("personaMergeApply", { keepId: m.keep.id, dropId: m.drop.id });
      setNotice(`已合并：${m.drop.value} → ${m.keep.value}（证据累加）`);
      await reload();
    } catch (err) { fail(err); }
  };

  /** 旧建模把统计值当证据写的结论：批量拒绝（一次点击，可预见结果） */
  const rejectStat = async () => {
    const list = visibleQueue.filter((o) => o.evidenceStat && !o.sensitive);
    if (!list.length) return;
    if (!window.confirm(`拒绝这 ${list.length} 条「证据是统计值」的结论？\n\n统计结论已经由「可观测特征」承担，这些留着只会让待确认列表变成过时数字的回放。\n拒绝会记入「不再打扰」，同一结论不会再被提出来。`)) return;
    setBusy(true);
    try {
      for (const item of list) await act("personaResolve", { id: item.id, accept: false });
      setNotice(`已拒绝 ${list.length} 条统计值结论`);
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  /** 只确认「有原话可回查」的那批：批量但不盲目 */
  const acceptVerified = async () => {
    if (!confirmable.length) return;
    if (!window.confirm(`确认这 ${confirmable.length} 条？\n\n它们的引用都能在聊天记录里核对上，且不含敏感项。\n其余「引用待核对」和「证据是统计值」的会留在队列里等你逐条看。`)) return;
    setBusy(true);
    try {
      for (const item of confirmable) await act("personaResolve", { id: item.id, accept: true });
      setNotice(`已确认 ${confirmable.length} 条（引用可核对）`);
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
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
      const fmt = res?.format ? `（${FORMAT_LABEL[res.format] || res.format}）` : "";
      const warn = Array.isArray(res?.warnings) && res.warnings.length ? ` · ${res.warnings[0]}` : "";
      const stats = res?.statsPeople ? ` · ${res.statsPeople} 人算出可观测特征` : "";
      setNotice(res?.deduped ? "内容重复，已跳过" : `解析 ${res?.messages || 0} 条发言${fmt}，新增 ${res?.added || 0} 条待确认${stats}${warn}`);
      setPaste("");
      await reload();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const importFile = async () => {
    setBusy(true);
    try {
      const res = await act("personaImportPick");
      const added = res?.added || [];
      const fmts = [...new Set(added.map((a: { format?: string }) => a.format).filter(Boolean))].map((f) => FORMAT_LABEL[String(f)] || String(f));
      const statPeople = added.reduce((n: number, a: { statsPeople?: number }) => n + (a.statsPeople || 0), 0);
      setNotice(added.length
        ? `导入 ${added.length} 个文件${fmts.length ? `（${fmts.join(" / ")}）` : ""}，新增 ${added.reduce((n: number, a: { added?: number }) => n + (a.added || 0), 0)} 条待确认${statPeople ? ` · ${statPeople} 人算出可观测特征` : ""}`
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

  const togglePick = (p: PersonRow, ev?: { metaKey?: boolean; shiftKey?: boolean }) => {
    const ordered = [...listSelf, ...modeled, ...listOthers];
    setPicked((prev) => {
      const next = new Set(prev);
      if (ev?.shiftKey && lastPick) {
        const a = ordered.findIndex((x) => x.id === lastPick);
        const b = ordered.findIndex((x) => x.id === p.id);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) next.add(ordered[i].id);
          return next;
        }
      }
      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
      return next;
    });
    setLastPick(p.id);
  };

  const pickAll = () => setPicked(new Set([...listSelf, ...modeled, ...listOthers].map((p) => p.id)));

  const batchRemove = async () => {
    const ids = [...picked];
    if (!ids.length) return;
    if (!window.confirm(`删除所选 ${ids.length} 人的全部观察？`)) return;
    try {
      const res = await act("personaRemoveMany", { personIds: ids });
      setNotice(`已删除 ${res?.people || 0} 人 / ${res?.removed || 0} 条观察`);
      if (res?.snapshots?.length) {
        setUndo({
          label: `已删除 ${res.people} 人（${res.removed} 条观察）`,
          run: async () => { await act("personaRestore", { snapshots: res.snapshots }); setNotice("已恢复"); await loadList(); },
        });
      }
      setPicked(new Set()); setPicking(false);
      await loadList();
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  const batchModel = async () => {
    const names = [...picked].map((id) => people.find((p) => p.id === id)?.name).filter(Boolean) as string[];
    if (!names.length) return;
    if (!window.confirm(`对所选 ${names.length} 人跑建模（未缓存的会调用模型）？`)) return;
    setPicking(false);
    await startModel("llm", 0, names, false);
  };

  /**
   * 合并人物：同一人从不同导出进来会变成两条（「纸鸢戏」/「纸鸢戏(工作)」）。
   * 合并只搬数据不改结论：观察、关系、可观测特征都并到保留的那个人，旧名字记进别名。
   */
  const batchMerge = async () => {
    const ids = [...picked];
    if (ids.length < 2) return;
    const keep = people.find((p) => p.id === ids[0]);
    const rest = ids.slice(1).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean) as string[];
    if (!keep || !rest.length) return;
    if (!window.confirm(`把 ${rest.join("、")} 合并到「${keep.name}」？\n\n观察 / 关系 / 可观测特征都会并过去，被合并的名字记进别名（同一份导出再导入时不会再建出一个人）。\n这个操作没有撤销。`)) return;
    try {
      await act("personaMerge", { keepId: keep.id, aliasIds: ids.slice(1) });
      setNotice(`已把 ${rest.length} 人合并到「${keep.name}」`);
      setPicked(new Set()); setPicking(false);
      setSelected(keep.id);
      await reload(keep.id);
    } catch (err) { fail(err); }
  };

  const batchCopyCards = async () => {
    try {
      const cards = await act("personaCards", { personIds: [...picked] });
      await navigator.clipboard.writeText(JSON.stringify(cards, null, 2));
      setNotice(`已复制 ${cards?.length || 0} 张角色卡 JSON`);
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  const saveFact = async () => {
    if (!adding || !card || !adding.value.trim()) return;
    try {
      await act("personaObsAdd", { personId: card.person.id, field: adding.field, value: adding.value.trim() });
      setAdding(null); setNotice("已加入人设卡");
      await openPerson(card.person.id);
    } catch (err) { setNotice(String((err as Error)?.message || err)); }
  };

  const removePersonById = async (p: PersonRow) => {
    if (!window.confirm(`删除「${p.name}」的全部观察？人设卡会一起消失。`)) return;
    try {
      const snap = await act("personaRemoveMany", { personIds: [p.id] });
      setNotice(`已删除 ${snap?.removed || 0} 条`);
      if (snap?.snapshots?.length) {
        setUndo({ label: `已删除「${p.name}」`, run: async () => { await act("personaRestore", { snapshots: snap.snapshots }); await loadList(); } });
      }
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
    <div
      key={p.id}
      data-pid={p.id}
      className={`persona-rowwrap ${picked.has(p.id) ? "picked" : ""}`}
      onContextMenu={(ev) => {
        ev.preventDefault();
        setSelected(p.id);
        setCtx({ x: ev.clientX, y: ev.clientY, person: p });
      }}
    >
      {picking && (
        <input
          type="checkbox"
          className="pick-box"
          checked={picked.has(p.id)}
          onChange={() => togglePick(p)}
          onClick={(ev) => ev.stopPropagation()}
          aria-label={`选择 ${p.name}`}
        />
      )}
      <button
        className={`persona-row ${selected === p.id ? "on" : ""}`}
        onClick={(ev) => {
          if (!picking) { setSelected(p.id); return; }
          togglePick(p, { shiftKey: (ev as unknown as { shiftKey: boolean }).shiftKey });
        }}
        onContextMenu={(ev) => { if (picking) { ev.preventDefault(); togglePick(p); } }}
      >
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
  /**
   * 「只确认这些」的选择规则（严格，可解释）：
   *  ① 引用能在聊天记录里核对上（quoteVerified !== false）
   *  ② 证据不是统计值（统计由可观测特征承担）
   *  ③ 不是敏感项（敏感必须逐条判断）
   * 换句话说：只确认「有原话可回查、且不敏感」的那些，其余留在队列里让人一条条看。
   */
  const statCount = visibleQueue.filter((o) => o.evidenceStat && !o.sensitive).length;
  const confirmable = useMemo(
    () => visibleQueue.filter((o) => !o.sensitive && !o.evidenceStat
      && o.quoteVerified === true
      && String(o.quote || "").trim().length >= 6
      && String(o.quote || "").trim() !== "(模型归纳)"),
    [visibleQueue],
  );
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
  const sectionOverflow = (sec: CardSection) => sec.rows.reduce((n, r) => n + (r.overflow || 0), 0);
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
          <em>依据 {sectionSupport(sec)} · 置信 {sectionLevel(sec)}{sectionOverflow(sec) ? ` · 另有 ${sectionOverflow(sec)} 条较早` : ""}</em>
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
                <button
                  className="ev-del"
                  title="删除这条依据"
                  onClick={() => void act("personaObsRemove", { id: e.id }).then(async () => { setNotice("已删除该条事实"); if (card) await openPerson(card.person.id); })}
                >×</button>
                <q>{e.quote || e.value}</q>
                <div className="persona-ev-meta">
                  <span>{row.label}</span>
                  {e.at ? <span>{fmtDate(e.at)}</span> : null}
                  <span>{e.sourceKind === "doc" ? "资料" : "聊天"}</span>
                  {e.verified === false ? <span className="tag warn" title="建模时在样本里核对不到这句引用">引用待核对</span> : null}
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
                  if (!calls) { setNotice(`没有需要建模的人：可建模 ${plan?.eligible || 0} 人，样本都和上次一样（要重建请用「忽略缓存重跑」）`); return; }
                  if (!window.confirm(`一键全部建模：\n\n可建模 ${plan.eligible} 人（已缓存 ${plan.cached} 人跳过）\n本次预计 ${calls} 次模型调用，按顺序逐人跑，可随时取消。\n\n继续？`)) return;
                  await startModel("llm", 0, undefined, false);
                } catch (err) { setNotice(String((err as Error)?.message || err)); }
              }}
            >一键全部建模（未建模的全部跑一遍）</button>
            <button
              disabled={Boolean(job?.running)}
              onClick={() => {
                if (!window.confirm("忽略已分析缓存，重新对前 12 人调模型？\n\n缓存只是为了不重复花钱；如果上次只写了「一句话」却没出结论（旧版本的问题），或者你删过结论，就用这个重跑。")) return;
                void startModel("llm", 12, undefined, false, true);
              }}
            >忽略缓存重跑（默认 12 人）</button>
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
            <b>{job.running ? (job.cancelled ? `正在停止…（已完成 ${job.done}/${job.total || "?"}）` : `建模中 · ${job.done}/${job.total || "?"}`) : `本次建模完成 · ${job.cards} 人出卡`}</b>
            <span className="tiny faint">
              {job.running ? (job.current ? `当前：${job.current}` : "准备中…") : `统计 ${job.statsAdded} 条 · 模型结论 ${job.llmAdded} 条待确认${job.unverified ? `（${job.unverified} 条引用核对不到）` : ""}${job.skippedCache ? ` · 缓存跳过 ${job.skippedCache} 人${job.skippedNames?.length ? `（${job.skippedNames.slice(0, 3).join("、")}${job.skippedCache > 3 ? " 等" : ""}）` : ""}` : ""}${!job.running && job.failed?.length ? ` · ${job.failedCount || job.failed.length} 人未出结论` : ""}`}
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

      <ListContextMenu
        at={ctx ? { x: ctx.x, y: ctx.y } : null}
        onClose={() => setCtx(null)}
        items={ctx ? [
          { label: "打开人设卡", onSelect: () => setSelected(ctx.person.id) },
          { label: "复制注入片段", onSelect: () => void copyInjectFor(ctx.person) },
          { label: "复制角色卡 JSON", onSelect: () => void exportCardFor(ctx.person) },
          { label: picked.size > 1 ? `删除所选 ${picked.size} 人` : "删除此人全部观察", danger: true, onSelect: () => void (picked.size > 1 ? batchRemove() : removePersonById(ctx.person)) },
        ] : []}
      />

      <UndoBar action={undo} onDone={() => setUndo(null)} />

      {picking && (
        <div className="bulk-float">
          <span>已选 {picked.size}</span>
          <button className="link tiny" onClick={pickAll}>全选</button>
          <button className="link tiny" onClick={() => setPicked(new Set())} disabled={!picked.size}>清空</button>
          <span style={{ flex: 1 }} />
          <button className="btn tiny-btn primary" onClick={() => void batchModel()} disabled={!picked.size}>建模所选</button>
          <button className="btn tiny-btn" onClick={() => void batchCopyCards()} disabled={!picked.size}>复制角色卡</button>
          <button
            className="btn tiny-btn"
            onClick={() => void batchMerge()}
            disabled={picked.size < 2}
            title="把所选合并到第一个点选的人（观察 / 关系 / 可观测特征并过去，旧名字记进别名）"
          >合并到「{[...picked].map((id) => people.find((p) => p.id === id)?.name).filter(Boolean)[0] || "第 1 个"}」</button>
          <button className="btn tiny-btn" onClick={() => void batchRemove()} disabled={!picked.size}>删除</button>
          <button className="icon-btn" title="退出多选" onClick={() => { setPicking(false); setPicked(new Set()); }}>×</button>
        </div>
      )}

      <div className={`persona-grid ${dense ? "list-compact" : ""}`}>

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
                <option value="score">完整度</option>
                <option value="recent">最近</option>
                <option value="pending">待确认</option>
                <option value="name">姓名</option>
              </select>
              <button className={`list-chip ${showFilter || tagFilter || onlyModeled ? "on" : ""}`} onClick={() => setShowFilter((v) => !v)}>
                筛选{(tagFilter || onlyModeled) ? " ·1" : ""}
              </button>
              <button className={`list-chip ${picking ? "on" : ""}`} onClick={() => { setPicking((v) => !v); setPicked(new Set()); }}>
                {picking ? "退出" : "多选"}
              </button>
              <button className="list-chip" onClick={toggleDense} title="切换列表密度">{dense ? "舒适" : "紧凑"}</button>
            </div>
            {showFilter && (
              <div className="filter-pop">
                <label className="filter-row">
                  <input type="checkbox" checked={onlyModeled} onChange={(e) => setOnlyModeled(e.target.checked)} /> 只看已建模（{people.filter((p) => (p.tags || []).includes("已建模")).length}）
                </label>
                <div className="filter-tags">
                  {allTags.map(([t, n]) => (
                    <button key={t} className={`list-chip ${tagFilter === t ? "on" : ""}`} onClick={() => setTagFilter(tagFilter === t ? "" : t)}>{t} <em>{n}</em></button>
                  ))}
                </div>
                {(tagFilter || onlyModeled) && (
                  <button className="link tiny" onClick={() => { setTagFilter(""); setOnlyModeled(false); }}>清除筛选</button>
                )}
              </div>
            )}
            {listSelf.length > 0 && <div className="persona-group">本人</div>}
            <div
              className="persona-list"
              tabIndex={0}
              onKeyDown={(ev) => {
                const ordered = [...listSelf, ...modeled, ...listOthers];
                if (!ordered.length) return;
                const idx = Math.max(0, ordered.findIndex((x) => x.id === (picking ? lastPick : selected)));
                if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
                  ev.preventDefault();
                  const next = ordered[Math.min(ordered.length - 1, Math.max(0, idx + (ev.key === "ArrowDown" ? 1 : -1)))];
                  setSelected(next.id);
                  if (picking) setLastPick(next.id);
                  document.querySelector(`[data-pid="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
                } else if (ev.key === " " && picking) {
                  ev.preventDefault();
                  if (lastPick) togglePick(ordered.find((x) => x.id === lastPick) || ordered[idx]);
                } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "a") {
                  ev.preventDefault();
                  setPicking(true);
                  pickAll();
                } else if (ev.key === "Escape") {
                  setPicking(false); setPicked(new Set());
                }
              }}
            >
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
                    <span>证据中位 {card.metrics?.supportMedian || 0}</span>
                    <span>·</span>
                    <span>
                      覆盖 {card.counts.fields}/{card.counts.total} 类字段
                      {card.counts.measureFields ? `（+${card.counts.measureFields} 项可观测）` : ""}
                    </span>
                    {card.counts.pending > 0 && <span>·</span>}
                    {card.counts.pending > 0 && <span>{card.counts.pending} 条待确认</span>}
                    {(card.metrics?.unverified || 0) > 0 && <span>·</span>}
                    {(card.metrics?.unverified || 0) > 0 && <span className="warn">{card.metrics.unverified} 条引用待核对</span>}
                    {(card.needsReview?.length || 0) > 0 && <span>·</span>}
                    {(card.needsReview?.length || 0) > 0 && <span className="warn">{card.needsReview.length} 条待复核</span>}
                  </p>
                </div>
                <div className="row gap6" style={{ alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                    <span className="tiny faint mono">{card.completeness}%</span>
                    <span className="persona-bar" style={{ width: 64 }}>
                      <i style={{ width: `${card.completeness}%` }} />
                    </span>
                  </div>
                  <button className="btn tiny-btn" onClick={() => setAdding({ field: "traits", value: "" })}>＋ 事实</button>
                  <RowMenu title="人物操作">
                    <button onClick={() => void copyInject()}>复制注入片段</button>
                    <button onClick={() => void exportCard()}>导出角色卡 JSON</button>
                    <button
                      onClick={() => void act("personaExportMarkdown", { personId: card.person.id })
                        .then((res) => setNotice(`已写入知识库：${res?.title || ""}`))
                        .catch((err) => setNotice(String((err as Error)?.message || err)))}
                    >写入知识库（Markdown）</button>
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
                      <span>
                        由 {card.counts.confirmed} 条已确认观察归纳 · 可改写；没有依据的推断进不来
                        {card.oneLinerStale ? ` · ${fmtDate(card.oneLinerAt)}写的，之后又有新结论，建议重写` : ""}
                      </span>
                    </p>
                  )}

                  {adding && (
                    <div className="pr-addfact">
                      <select className="list-select" value={adding.field} onChange={(e) => setAdding({ ...adding, field: e.target.value })} aria-label="字段">
                        {[["identity", "身份"], ["role", "角色"], ["situation", "处境"], ["traits", "性格"], ["value", "价值观"], ["goal", "目标"], ["decision", "处事"], ["communication", "沟通"], ["style", "说话"], ["preference", "偏好"], ["constraint", "约束"], ["relation", "关系"]].map(([id, label]) => (
                          <option key={id} value={id}>{label}</option>
                        ))}
                      </select>
                      <input
                        className="kv-input"
                        autoFocus
                        value={adding.value}
                        placeholder="写一条事实，例如：只在上午回消息"
                        onChange={(e) => setAdding({ ...adding, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setAdding(null);
                          if (e.key === "Enter" && adding.value.trim()) void saveFact();
                        }}
                      />
                      <button className="btn tiny-btn" onClick={() => setAdding(null)}>取消</button>
                      <button className="btn tiny-btn primary" disabled={!adding.value.trim()} onClick={() => void saveFact()}>保存</button>
                    </div>
                  )}

                  {card.sections.map(renderSection)}

                  {card.measures.length > 0 && (
                    <section className="persona-sec">
                      <div className="persona-sec-head">
                        <h3>可观测特征</h3>
                        <em>{card.metrics?.measureAt ? `重算于 ${fmtDate(card.metrics.measureAt)}` : "统计"}</em>
                        <span style={{ flex: 1 }} />
                        <span className="tiny faint">数得出来的，每次建模重算，不算事实</span>
                      </div>
                      <div className="persona-beh">
                        {card.measures.map((m) => (
                          <div className="persona-beh-row" key={m.key}>
                            <span className="k">{m.label}</span>
                            <span className="v">
                              {m.value}
                              {m.prevValue && m.prevValue !== m.value
                                ? <span className="tiny faint" style={{ display: "block" }}>上次：{m.prevValue}</span>
                                : null}
                            </span>
                            <span className="m">
                              {m.times > 0 ? <span className="tiny faint">{m.times} 次变化</span> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {card.network.length > 0 && (
                    <section className="persona-sec">
                      <div className="persona-sec-head">
                        <h3>关系网</h3><em>依据 {card.network.length}</em>
                      </div>
                      <div className="persona-rowlist">
                        {card.network.map((n) => (
                          <div className="persona-rel" key={n.id}>
                            <span className="persona-ava">{n.name.slice(0, 1)}</span>
                            <span>
                              <b>{n.name}</b>
                              <em>{n.type || "关系"}</em>
                              {n.groupOnly && <em className="persona-rel-group" title="只在群聊里出现过，强度按群聊计算">仅群聊</em>}
                            </span>
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
            {(statCount > 0 || confirmable.length > 0) && (
              <div className="persona-batch">
                <span>
                  证据质量：
                  {statCount > 0 ? `${statCount} 条是统计值` : ""}
                  {statCount > 0 && confirmable.length > 0 ? " · " : ""}
                  {confirmable.length > 0 ? `${confirmable.length} 条引用可核对` : ""}
                </span>
                <span style={{ flex: 1 }} />
                {statCount > 0 && <button className="link" onClick={() => void rejectStat()} disabled={busy}>拒绝统计值</button>}
                {confirmable.length > 0 && <button className="link" onClick={() => void acceptVerified()} disabled={busy}>只确认核过的</button>}
              </div>
            )}
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
                {o.evidenceStat && (
                  <p className="notes-meta-empty" style={{ margin: "2px 0 4px" }}>
                    这条的「证据」其实是统计值，不是原话 —— 统计结论已经由「可观测特征」承担，多半可以直接拒绝。
                  </p>
                )}
                {!o.evidenceStat && o.quoteVerified === false && (
                  <p className="notes-meta-empty" style={{ margin: "2px 0 4px" }}>
                    这条引用在建模用的样本里核对不到，可能被模型改写或概括过 —— 确认前建议回聊天记录对一下。
                  </p>
                )}
                <div className="qfoot">
                  <span className="src">{o.sourceKind === "doc" ? "资料" : "聊天"} · {fmtDate(o.createdAt)}{(o.evidenceCount || 1) > 1 ? ` · 已见 ${o.evidenceCount} 次` : ""}{o.reviewAt ? " · 复审" : ""}{o.quoteVerified === false ? " · 引用待核对" : ""}</span>
                  <button className="btn tiny-btn" onClick={() => void resolve(o.id, false)}>拒绝</button>
                  <button className="btn tiny-btn ok" onClick={() => void resolve(o.id, true, o.sensitive)}>确认</button>
                </div>
              </div>
            ))}
            {visibleQueue.length > 12 && <p className="notes-meta-empty">还有 {visibleQueue.length - 12} 条未显示。</p>}
          </div>

          {card && card.needsReview.length > 0 && (
            <div className="kv-block">
              <div className="persona-block-title">
              衰减与复核 <em>{card.needsReview.length}</em>
              <button className="link" disabled={busy} onClick={() => void reviewAll(true)}>全部仍然成立</button>
            </div>
              <p className="notes-meta-empty" style={{ marginTop: 0 }}>
                这几条说的时间已经过了，不再进人设卡与注入。「仍然成立」续期，否则用 valid_to 收口 —— 数据不删，回看里还在。
              </p>
              {card.needsReview.slice(0, 8).map((r) => (
                <div className="persona-qitem" key={r.id}>
                  <div className="qhead">{r.label} · <span className="tag warn">{r.reason}</span></div>
                  <q>{r.value}</q>
                  <div className="qfoot">
                    <span className="src">{r.expiresAt ? `到期 ${fmtDate(r.expiresAt)}` : "未到期"}</span>
                    <button className="btn tiny-btn" onClick={() => void reviewOne(r.id, false)}>已过期</button>
                    <button className="btn tiny-btn ok" onClick={() => void reviewOne(r.id, true)}>仍然成立</button>
                  </div>
                </div>
              ))}
              {card.needsReview.length > 8 && <p className="notes-meta-empty">还有 {card.needsReview.length - 8} 条。</p>}
            </div>
          )}

          {merges.filter((m) => !skipMerges.has(`${m.keep.id}:${m.drop.id}`)).length > 0 && (
            <div className="kv-block">
              <div className="persona-block-title">近似说法 <em>{merges.length}</em></div>
              <p className="notes-meta-empty" style={{ marginTop: 0 }}>
                同一个字段里可能有两条在说一件事。合并只累加证据，不是改写结论 —— 是否同一件事由你判断。
              </p>
              {merges.filter((m) => !skipMerges.has(`${m.keep.id}:${m.drop.id}`)).slice(0, 4).map((m) => (
                <div className="persona-qitem" key={`${m.keep.id}:${m.drop.id}`}>
                  <div className="qhead">{m.label} · <span className="tag">相似 {Math.round(m.score * 100)}%</span></div>
                  <q>{m.drop.value} → {m.keep.value}</q>
                  <div className="qfoot">
                    <span className="src">依据 {m.drop.evidence} + {m.keep.evidence}</span>
                    <button className="btn tiny-btn" onClick={() => setSkipMerges((prev) => new Set(prev).add(`${m.keep.id}:${m.drop.id}`))}>不合并</button>
                    <button className="btn tiny-btn ok" onClick={() => void mergeOne(m)}>合并</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="kv-block">
            <div className="persona-block-title">
              回看
              <em>{asOf ? `${new Date(asOf.at).toLocaleDateString()} · ${asOf.mode === "known" ? "当时已知" : "事件时间"}` : "当时什么是真的"}</em>
            </div>
            <div className="row gap6" style={{ marginBottom: 6 }}>
              <button className={`list-chip ${asOfMode === "event" ? "on" : ""}`} onClick={() => setAsOfMode("event")} title="回放事实：那个时间点什么是真的">事件时间</button>
              <button className={`list-chip ${asOfMode === "known" ? "on" : ""}`} onClick={() => setAsOfMode("known")} title="回放认知：系统在那个时间点已经知道什么（双时间）">当时已知</button>
            </div>
            <div className="row gap6" style={{ alignItems: "center" }}>
              <input
                className="kv-input"
                type="date"
                value={asOfAt}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setAsOfAt(e.target.value)}
                aria-label="回看时间点"
              />
              <button
                className="btn tiny-btn"
                disabled={!asOfAt || !selected}
                onClick={() => void (async () => {
                  try { setAsOf(await act("personaAsOf", { personId: selected, at: new Date(`${asOfAt}T23:59:59`).getTime(), mode: asOfMode })); }
                  catch (err) { fail(err); }
                })()}
              >回看</button>
              {asOf && <button className="link tiny" onClick={() => setAsOf(null)}>回到现在</button>}
            </div>
            {asOf ? (
              asOf.fields.length === 0 ? (
                <p className="notes-meta-empty">这个时间点还没有已确认的事实。</p>
              ) : (
                <div className="persona-asof">
                  {asOf.fields.slice(0, 12).map((f) => (
                    <div className="persona-asof-row" key={f.field}>
                      <span className="k">{f.label}</span>
                      <span className="v">
                        {f.values && f.values.length > 1 ? f.values.join(" / ") : f.value}
                        {(f.history?.length || 0) > 1 && <em className="tiny faint">（之后变成「{f.history![0].value}」）</em>}
                      </span>
                    </div>
                  ))}
                  <p className="notes-meta-empty">
                    「事件时间」看那个时间点什么是真的；「当时已知」只算系统当时已经得知的事实（双时间）。
                  </p>
                </div>
              )
            ) : (
              <p className="notes-meta-empty">选一个日期，看当时画像里什么是真的。需要事实带时间且已确认。</p>
            )}
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
                    <span className={`tag ${d.kind === "conflict" ? "warn" : ""}`}>{d.kind === "drift" ? "漂移" : d.kind === "trend" ? "特征变化" : "矛盾"}</span>
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
              敏感项永不注入。按「字段优先级 × 热度（衰减后的权重）× 与问题的相关性」打分填预算，每节有配额上限。
              预算不足时先砍长期事实、再砍关系网。
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
