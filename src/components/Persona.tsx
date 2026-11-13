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
type PersonRow = Person & { confirmed: number; pending: number; completeness: number; lastAt: number };
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
      setPeople(list || []);
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

  const others = useMemo(() => people.filter((p) => !p.isSelf && (!q.trim() || p.name.includes(q.trim()))), [people, q]);
  const visibleQueue = useMemo(
    () => pending.filter((item) => !onlyMine || item.personId === selected),
    [pending, onlyMine, selected],
  );
  const minePending = pending.filter((item) => item.personId === selected);
  const searchable = useMemo(
    () => people.filter((p) => !q.trim() || p.name.includes(q.trim()) || (p.relation || "").includes(q.trim())),
    [people, q],
  );
  const listSelf = searchable.filter((p) => p.isSelf);
  const listOthers = searchable.filter((p) => !p.isSelf);

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
            disabled={busy}
            title="把聊天记录算成可观测特征（话量 / 句长 / 回复速度 / 语气 / 话题 / 活跃时段），结果进待确认"
            onClick={async () => {
              setBusy(true);
              try {
                const res = await act("personaModel", { limit: 60, useModel: false });
                setNotice(`建模 ${res?.people || 0} 人，新增 ${res?.added || 0} 条待确认`);
                await reload();
              } catch (err) { setNotice(String((err as Error)?.message || err)); }
              finally { setBusy(false); }
            }}
          >建模</button>
          <button className="icon-btn" onClick={() => void reload()} title="刷新">↻</button>
        </>}
      />
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }}>×</button>
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
            {listSelf.length > 0 && <div className="persona-group">本人</div>}
            <div className="persona-list">
              {listSelf.map((p) => (
                <button key={p.id} className={`persona-row ${selected === p.id ? "on" : ""}`} onClick={() => setSelected(p.id)}>
                  <span className="persona-ava">我</span>
                  <span>
                    <b>{p.name}</b>
                    <em>本人 · {p.completeness}%</em>
                  </span>
                  {p.pending > 0 && <span className="persona-badge">{p.pending}</span>}
                </button>
              ))}
            </div>
            {listOthers.length > 0 && <div className="persona-group">他人</div>}
            <div className="persona-list">
              {listOthers.map((p) => (
                <button key={p.id} className={`persona-row ${selected === p.id ? "on" : ""}`} onClick={() => setSelected(p.id)}>
                  <span className="persona-ava">{p.name.slice(0, 1)}</span>
                  <span>
                    <b>{p.name}</b>
                    <em>{p.relation || "关系未知"}{p.groupOnly ? " · 仅群聊" : ""} · {p.completeness}%</em>
                  </span>
                  {p.pending > 0 && <span className="persona-badge">{p.pending}</span>}
                </button>
              ))}
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
                    {card.person.groupOnly && <span className="tag warn">仅群聊</span>}
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
