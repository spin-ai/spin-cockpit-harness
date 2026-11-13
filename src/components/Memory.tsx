import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Note = { id: string; body: string; sourceKind: string; sourceRef: string; status: string; createdAt: number };
type Entry = { id: string; layer: string; title: string; body: string; status: string; updatedAt: number };
type Sug = { id: string; action: string; title: string; detail: string; targetKind: string; targetId: string; status: string };
type Hit = { kind: string; id: string; at: number; snippet: string; threadId?: string; runId?: string };

const LAYERS = ["L4", "L3", "L2", "L1"];
const ACTION_LABEL: Record<string, string> = { fix: "校正", build: "构建", fill: "补洞", promote: "晋升", prune: "剪枝" };

/** 记忆：四层 / 未验证观察 / Dream 建议 / transcript 回查 / 注入预览 */
export function Memory({ act }: { act: Act }) {
  const [overview, setOverview] = useState<{ byLayer: Record<string, number>; notes: number; notesPending: number; suggestions: number; injectable: number } | null>(null);
  const [layer, setLayer] = useState("L4");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [inject, setInject] = useState<{ markdown: string; chars: number; budget: number; dropped: number } | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

  const load = useCallback(async () => {
    try {
      const [ov, list, ns, ss, inj] = await Promise.all([
        act("memoryOverview"),
        act("memoryEntryList", { layer }),
        act("memoryNoteList", { status: "new" }),
        act("memorySuggestions", { status: "pending" }),
        act("memoryInject", { maxChars: 12000 }),
      ]);
      setOverview(ov); setEntries(list || []); setNotes(ns || []); setSugs(ss || []); setInject(inj);
    } catch (err) { fail(err); }
  }, [act, layer]);

  useEffect(() => { void load(); }, [load]);

  const addNote = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await act("memoryNoteAdd", { body: draft.trim(), sourceKind: "manual", sourceRef: "ui" });
      setDraft(""); setNotice("已记录为未验证观察"); await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const dream = async () => {
    setBusy(true);
    try {
      const res = await act("memoryDream");
      setNotice(`Dream 生成 ${res?.created?.length || 0} 条建议`);
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const resolveSug = async (id: string, accept: boolean) => {
    setBusy(true);
    try {
      const res = await act("memorySuggestionResolve", { id, accept });
      setNotice(accept ? (res?.applied?.applied ? "建议已执行" : "建议已采纳（未自动执行）") : "已拒绝，同类不再打扰");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const search = async (value: string) => {
    setQ(value);
    if (!value.trim()) { setHits([]); return; }
    try { setHits((await act("memoryTranscriptSearch", { query: value, limit: 12 })) || []); } catch { setHits([]); }
  };

  return (
    <div className="notes-page kv-page">
      <PageHeader
        kicker="MEMORY"
        title="记忆"
        subtitle={<div className="notes-stats">
          <span><b>{overview?.byLayer?.L4 || 0}</b> L4</span>
          <span><b>{overview?.byLayer?.L3 || 0}</b> L3</span>
          <span><b>{overview?.notesPending || 0}</b> 待确认观察</span>
          <span className={overview?.suggestions ? "warn" : ""}><b>{overview?.suggestions || 0}</b> Dream 建议</span>
        </div>}
        actions={<>
          <button className="btn primary" onClick={() => void dream()} disabled={busy}>运行 Dream</button>
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
          <div className="kv-tabs">
            {LAYERS.map((l) => (
              <button key={l} className={layer === l ? "on" : ""} onClick={() => setLayer(l)}>
                {l}<em>{overview?.byLayer?.[l] || 0}</em>
              </button>
            ))}
          </div>
          {entries.length === 0 ? (
            <EmptyState compact mark="◍" title={`${layer} 还是空的`} desc={layer === "L4" ? "L4 只放目录、结论与入口；Dream 的晋升建议会往这里写。" : "这一层由 Dream 或手动整理写入。"} />
          ) : (
            <div className="kv-list">
              {entries.map((e) => (
                <div className="kv-row" key={e.id}>
                  <div>
                    <b>{e.title}</b>
                    {e.body && <p>{e.body.slice(0, 200)}</p>}
                  </div>
                  <button className="link tiny" onClick={() => void act("memoryEntryArchive", { id: e.id }).then(load)}>归档</button>
                </div>
              ))}
            </div>
          )}

          <div className="kv-block">
            <div className="notes-meta-title">未验证观察 <em>{notes.length}</em></div>
            <textarea className="kv-ask" rows={3} value={draft} placeholder="记一条还没验证的观察（不会进页面审核流）" onChange={(ev) => setDraft(ev.target.value)} />
            <button className="btn tiny-btn" onClick={() => void addNote()} disabled={busy || !draft.trim()}>记录观察</button>
            {notes.map((n) => (
              <div className="kv-row" key={n.id}>
                <div><b>{n.body.slice(0, 80)}</b><span className="tiny faint">{n.sourceKind} · {new Date(n.createdAt).toLocaleString()}</span></div>
                <div className="row gap6">
                  <button className="link tiny" onClick={() => void act("memoryNoteSet", { id: n.id, status: "verified" }).then(load)}>已验证</button>
                  <button className="link tiny" onClick={() => void act("memoryNoteSet", { id: n.id, status: "stale" }).then(load)}>过期</button>
                </div>
              </div>
            ))}
          </div>

          <div className="kv-block">
            <div className="notes-meta-title">Dream 建议 <em>{sugs.length}</em></div>
            {sugs.length === 0 && <p className="notes-meta-empty">没有待处理建议。Dream 只产建议，不会直接改写 reviewed 页面。</p>}
            {sugs.map((sg) => (
              <div className="kv-row" key={sg.id}>
                <div>
                  <b><span className="kv-type">{ACTION_LABEL[sg.action] || sg.action}</span> {sg.title}</b>
                  {sg.detail && <p>{sg.detail}</p>}
                </div>
                <div className="row gap6">
                  <button className="btn tiny-btn ok" onClick={() => void resolveSug(sg.id, true)} disabled={busy}>接受</button>
                  <button className="btn tiny-btn" onClick={() => void resolveSug(sg.id, false)} disabled={busy}>拒绝</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="kv-side">
          <div className="kv-block">
            <div className="notes-meta-title">本次注入 <em>{inject?.chars || 0} / {inject?.budget || 12000}</em></div>
            <pre className="kv-inject">{inject?.markdown || "（还没有可注入的记忆）"}</pre>
            {inject?.dropped ? <p className="notes-meta-empty">预算不足时做减法：本次省略 {inject.dropped} 条。</p> : null}
          </div>
          <div className="kv-block">
            <div className="notes-meta-title">回查历史</div>
            <input className="notes-search" value={q} placeholder="搜会话 / run / 事件" onChange={(e) => void search(e.target.value)} />
            {hits.map((h) => (
              <div className="kv-hit" key={`${h.kind}-${h.id}`}>
                <span className="kv-type">{h.kind === "message" ? "会话" : h.kind === "run" ? "run" : "事件"}</span>
                <div>
                  <b className="mono">{h.id.slice(0, 12)}</b>
                  <span className="kv-hit-loc">{new Date(h.at).toLocaleString()}</span>
                  <p>{h.snippet}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
