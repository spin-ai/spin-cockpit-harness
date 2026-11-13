import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Obs = { id: string; person: string; personId: string | null; field: string; value: string; status: string; quote: string; sourceKind: string; sourceRef: string; sensitive: boolean; conflict?: string | null; validFrom?: number | null; createdAt: number };
type Person = { id: string; name: string; aliases: string[]; relation: string; strength: number; groupOnly: boolean; isSelf: boolean };
type Profile = {
  self?: { person: Person; observations: Obs[] } | null;
  others?: { person: Person; observations: Obs[] }[];
  relations?: { id: string; from: string; to: string; type: string; strength: number }[];
  groupOnly?: string[];
  person?: Person;
  observations?: Obs[];
};

const FIELD_LABEL: Record<string, string> = {
  identity: "身份", preference: "偏好", value: "价值观", constraint: "硬约束", goal: "目标",
  situation: "处境", event: "事件", stance: "立场", relation: "关系",
};

/** 人像：导入 → 待确认 → 三层画像 → 时间线 → 决策辅助 */
export function Persona({ act }: { act: Act }) {
  const [stats, setStats] = useState<{ people: number; pending: number; confirmed: number; relations: number; imports: number } | null>(null);
  const [pending, setPending] = useState<Obs[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [timeline, setTimeline] = useState<Obs[]>([]);
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState<{ found: boolean; answer: string; citations: { quote: string }[] } | null>(null);
  const [paste, setPaste] = useState("");
  const [selfName, setSelfName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

  const load = useCallback(async () => {
    try {
      const [st, pd, pf] = await Promise.all([act("personaStats"), act("personaPending"), act("personaProfile", {})]);
      setStats(st); setPending(pd || []); setProfile(pf);
    } catch (err) { fail(err); }
  }, [act]);

  useEffect(() => { void load(); }, [load]);

  const openPerson = async (id: string) => {
    setSelected(id);
    try {
      const [pf, tl] = await Promise.all([act("personaProfile", { personId: id }), act("personaTimeline", { personId: id })]);
      setProfile(pf); setTimeline(tl || []);
    } catch (err) { fail(err); }
  };

  const resolve = async (id: string, accept: boolean, sensitive = false) => {
    setBusy(true);
    try {
      await act("personaResolve", { id, accept, sensitive });
      setNotice(accept ? "已确认" : "已拒绝，同类不再打扰");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const importPaste = async () => {
    if (!paste.trim()) return;
    setBusy(true);
    try {
      const res = await act("personaImport", { text: paste, selfName, title: "手动粘贴", kind: "chat" });
      setNotice(res?.deduped ? "内容重复，已跳过" : `解析 ${res?.messages || 0} 条发言，新增 ${res?.added || 0} 条待确认`);
      setPaste("");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const importFile = async () => {
    setBusy(true);
    try {
      const res = await act("personaImportPick");
      const added = res?.added || [];
      setNotice(added.length ? `导入 ${added.length} 个文件，新增 ${added.reduce((n: number, a: { added?: number }) => n + (a.added || 0), 0)} 条待确认` : "没有选择文件");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const runAsk = async () => {
    if (!ask.trim()) return;
    setBusy(true);
    try { setAnswer(await act("personaAsk", { question: ask.trim() })); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const removePerson = async (p: Person) => {
    if (!window.confirm(`删除「${p.name}」的全部观察？`)) return;
    try {
      const res = await act("personaRemove", { personId: p.id });
      setNotice(`已删除 ${res?.removed || 0} 条`);
      setSelected("");
      await load();
    } catch (err) { fail(err); }
  };

  const self = profile?.self;
  const others = profile?.others || [];

  return (
    <div className="notes-page kv-page">
      <PageHeader
        kicker="PERSONA"
        title="人像"
        subtitle={<div className="notes-stats">
          <span><b>{stats?.people || 0}</b> 人</span>
          <span><b>{stats?.confirmed || 0}</b> 已确认</span>
          <span className={stats?.pending ? "warn" : ""}><b>{stats?.pending || 0}</b> 待确认</span>
          <span><b>{stats?.relations || 0}</b> 关系</span>
        </div>}
        actions={<>
          <button className="btn primary" onClick={() => void importFile()} disabled={busy}>导入聊天记录</button>
          <button className="icon-btn" onClick={() => void load()} title="刷新">↻</button>
        </>}
      />
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }}>×</button>
        </div>
      )}
      <div className="kv-grid">
        <section className="kv-main">
          <div className="kv-block">
            <div className="notes-meta-title">待确认 <em>{pending.length}</em></div>
            {pending.length === 0 ? (
              <p className="notes-meta-empty">没有待确认的推断。导入聊天记录后，规则抽取的每条事实都要你确认才生效。</p>
            ) : pending.map((o) => (
              <div className="kv-row" key={o.id}>
                <div>
                  <b>{o.person} · {FIELD_LABEL[o.field] || o.field}：{o.value}</b>
                  {o.quote && <p className="kv-quote">“{o.quote}”</p>}
                  <span className="tiny faint">{o.sourceKind}{o.sourceRef ? ` · ${o.sourceRef}` : ""}</span>
                </div>
                <div className="row gap6">
                  <button className="btn tiny-btn ok" onClick={() => void resolve(o.id, true, o.sensitive)} disabled={busy}>确认</button>
                  <button className="btn tiny-btn" onClick={() => void resolve(o.id, false)} disabled={busy}>拒绝</button>
                </div>
              </div>
            ))}
          </div>

          <div className="kv-block">
            <div className="notes-meta-title">三层画像</div>
            {!self && others.length === 0 ? (
              <EmptyState compact mark="◔" title="还没有画像" desc="导入微信 / 飞书 / Telegram 导出的聊天记录，或粘贴一段对话。抽取结果先进待确认。" />
            ) : (
              <>
                {self && (
                  <div className="kv-person" onClick={() => void openPerson(self.person.id)}>
                    <b>{self.person.name}（本人）</b>
                    <span className="tiny faint">{self.observations.length} 条事实</span>
                  </div>
                )}
                {others.map((o) => (
                  <div className={`kv-person ${selected === o.person.id ? "on" : ""}`} key={o.person.id} onClick={() => void openPerson(o.person.id)}>
                    <b>{o.person.name}</b>
                    <span className="tiny faint">
                      {o.person.relation || "关系未知"} · {o.observations.length} 条{o.person.groupOnly ? " · 仅群聊" : ""}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          {selected && (
            <div className="kv-block">
              <div className="notes-meta-title">
                时间线
                <button className="link tiny" onClick={() => void openPerson(selected)}>刷新</button>
              </div>
              {timeline.length === 0 && <p className="notes-meta-empty">还没有已确认的事实。</p>}
              {timeline.map((o) => (
                <div className="kv-row" key={o.id}>
                  <div>
                    <b>{FIELD_LABEL[o.field] || o.field}：{o.value}</b>
                    <span className="tiny faint">{o.validFrom ? new Date(o.validFrom).toLocaleDateString() : "时间未知"}{o.conflict ? ` · ⚠ ${o.conflict}` : ""}</span>
                  </div>
                  {o.sensitive && <span className="kv-type">敏感</span>}
                </div>
              ))}

            </div>
          )}

          <div className="kv-block">
            <div className="notes-meta-title">导入</div>
            <label className="tiny faint">你的名字（用于区分「本人」）
              <input className="kv-input" value={selfName} onChange={(e) => setSelfName(e.target.value)} placeholder="例如：张三" />
            </label>
            <textarea className="kv-ask" rows={4} value={paste} placeholder={"粘贴聊天记录，支持：\n2024-01-02 12:34:56 张三\n张三: 内容"} onChange={(e) => setPaste(e.target.value)} />
            <div className="row gap6">
              <button className="btn tiny-btn primary" onClick={() => void importPaste()} disabled={busy || !paste.trim()}>解析并进待确认</button>
              <button className="btn tiny-btn" onClick={() => void importFile()} disabled={busy}>选择文件…</button>
              {selected && <button className="link tiny" onClick={() => void removePerson({ id: selected } as Person)}>删除此人全部观察</button>}
            </div>
            <p className="notes-meta-empty">解析只做规则抽取，结果全部进待确认；重复内容按 hash 去重。</p>
          </div>
        </section>

        <aside className="kv-side">
          <div className="kv-block">
            <div className="notes-meta-title">决策辅助</div>
            <textarea className="kv-ask" rows={4} value={ask} placeholder="该找谁推进这件事？他大概率会怎么反应？" onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runAsk(); } }} />
            <button className="btn tiny-btn primary" onClick={() => void runAsk()} disabled={busy || !ask.trim()}>查画像</button>
            {answer && (
              <div className="kv-answer">
                <div className="kv-answer-head"><b>{answer.found ? "依据" : "未知"}</b><span className="tiny faint">{answer.citations.length} 条来源</span></div>
                <div className="kv-answer-body">{answer.answer}</div>
              </div>
            )}
          </div>
          <div className="kv-block">
            <div className="notes-meta-title">隐私</div>
            <p className="notes-meta-empty">推断默认待确认；涉及他人的敏感事实单独标记，默认不推到即时通信。没有来源的推断不能确认。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
