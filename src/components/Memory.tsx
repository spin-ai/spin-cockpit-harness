import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Note = { id: string; body: string; sourceKind: string; sourceRef: string; status: string; createdAt: number };
type Entry = { id: string; layer: string; title: string; body: string; sourceRefs: string[]; status: string; updatedAt: number };
type Sug = { id: string; action: string; title: string; detail: string; targetKind: string; targetId: string; status: string };
type Hit = { kind: string; id: string; at: number; snippet: string };
type InjectItem = { id: string; layer: string; title: string; chars: number; included: boolean; reason: string };
type Inject = { markdown: string; chars: number; budget: number; dropped: number; items: InjectItem[] };

/** 层级用语义名，不用 L1–L4 这类内部编号 */
const LAYERS = [
  { id: "L4", name: "结论", desc: "目录、结论、入口；注入时最优先" },
  { id: "L3", name: "项目", desc: "进行中的事与它们的边界" },
  { id: "L2", name: "事实", desc: "稳定的、可复用的判断与偏好" },
  { id: "L1", name: "原始", desc: "会话与 run 原文，只用于回查" },
] as const;

const ACTION_LABEL: Record<string, string> = { fix: "校正", build: "构建", fill: "补洞", promote: "晋升", prune: "剪枝" };
const SOURCE_LABEL: Record<string, string> = { transcript: "来自会话", page: "来自资料", manual: "人工写入", dream: "Dream" };

function timeAgo(at?: number) {
  if (!at) return "";
  const diff = Date.now() - at;
  const min = Math.round(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  return day < 30 ? `${day} 天前` : new Date(at).toLocaleDateString();
}

/** 记忆：左选层级/来源 → 中看条目 → 右处理复核、注入与回查 */
export function Memory({ act }: { act: Act }) {
  const [overview, setOverview] = useState<{ byLayer: Record<string, number>; notes: number; notesPending: number; suggestions: number } | null>(null);
  const [layer, setLayer] = useState<string>("L4");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [inject, setInject] = useState<Inject | null>(null);
  const [tab, setTab] = useState<"notes" | "dream">("notes");
  const [openInjectId, setOpenInjectId] = useState<string>("");
  const [srcFilter, setSrcFilter] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));
  const layerMeta = LAYERS.find((l) => l.id === layer) || LAYERS[0];

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

  const addEntry = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const firstLine = draft.trim().split("\n")[0].slice(0, 60);
      await act("memoryEntryUpsert", { layer, title: firstLine, body: draft.trim() });
      setDraft(""); setNotice("已写入这一层"); await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await act("memoryEntryUpsert", { id: editing.id, layer, title: editing.title, body: editing.body });
      setEditing(null); setNotice("已更新"); await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const demote = async (entry: Entry) => {
    try {
      const next = await act("memoryEntryDemote", { id: entry.id });
      setNotice(`已降级到「${LAYERS.find((l) => l.id === next?.layer)?.name || next?.layer}」`);
      await load();
    } catch (err) { fail(err); }
  };

  const archive = async (entry: Entry) => {
    try { await act("memoryEntryArchive", { id: entry.id }); setNotice("已标为过期（可从来源追溯）"); await load(); }
    catch (err) { fail(err); }
  };

  const resolveNote = async (id: string, status: "verified" | "stale") => {
    try { await act("memoryNoteSet", { id, status }); await load(); } catch (err) { fail(err); }
  };

  const verifyAll = async () => {
    if (!notes.length) return;
    setBusy(true);
    try {
      await act("memoryNoteBulk", { ids: notes.map((n) => n.id), status: "verified" });
      setNotice(`已验证 ${notes.length} 条`); await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const dream = async () => {
    setBusy(true);
    try {
      const res = await act("memoryDream");
      setNotice(`Dream 生成 ${res?.created?.length || 0} 条建议`);
      setTab("dream");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const resolveSug = async (id: string, accept: boolean) => {
    setBusy(true);
    try {
      const res = await act("memorySuggestionResolve", { id, accept });
      setNotice(accept ? (res?.applied?.applied ? "已执行并留痕" : "已采纳（未自动执行）") : "已拒绝，同类不再打扰");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const search = async (value: string) => {
    setQ(value);
    if (!value.trim()) { setHits([]); return; }
    try { setHits((await act("memoryTranscriptSearch", { query: value, limit: 12 })) || []); } catch { setHits([]); }
  };

  const shownNotes = srcFilter ? notes.filter((n) => n.sourceKind === srcFilter) : notes;
  const shownEntries = srcFilter ? entries.filter((e) => (e.sourceRefs || []).some((r) => String(r).startsWith(srcFilter))) : entries;
  const budgetPct = inject ? Math.min(100, Math.round((inject.chars / Math.max(1, inject.budget)) * 100)) : 0;
  const included = useMemo(() => (inject?.items || []).filter((i) => i.included), [inject]);
  const cut = useMemo(() => (inject?.items || []).filter((i) => !i.included), [inject]);

  return (
    <div className="notes-page kv-page pr-page">
      <PageHeader
        kicker="MEMORY"
        title="记忆"
        subtitle={<div className="notes-stats">
          <span><b>{overview?.byLayer?.L4 || 0}</b> 结论</span>
          <span><b>{overview?.byLayer?.L3 || 0}</b> 项目</span>
          <span><b>{overview?.byLayer?.L2 || 0}</b> 事实</span>
          <span className={(overview?.notesPending || 0) + (overview?.suggestions || 0) ? "warn" : ""}>
            <b>{(overview?.notesPending || 0) + (overview?.suggestions || 0)}</b> 待复核
          </span>
        </div>}
        actions={<>
          <button className="btn primary" onClick={() => { setTab("notes"); document.querySelector(".pr-side")?.scrollIntoView({ block: "nearest" }); }}>复核</button>
          <button className="btn" onClick={() => void dream()} disabled={busy}>运行 Dream</button>
          <button className="icon-btn" onClick={() => void load()} title="刷新">↻</button>
        </>}
      />
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }}>×</button>
        </div>
      )}

      <div className="pr-grid">
        {/* 左：层级 / 来源 / 其它 */}
        <aside className="pr-col">
          <div className="pr-block">
            <div className="pr-block-head">层级</div>
            {LAYERS.map((l) => (
              <button key={l.id} className={`pr-layer ${layer === l.id ? "on" : ""}`} onClick={() => setLayer(l.id)}>
                <span className="pr-layer-name">{l.name}<em>{overview?.byLayer?.[l.id] || 0}</em></span>
                <span className="pr-layer-desc">{l.desc}</span>
              </button>
            ))}
          </div>
          <div className="pr-block">
            <div className="pr-block-head">来源</div>
            <button className={`pr-layer slim ${srcFilter === "" ? "on" : ""}`} onClick={() => setSrcFilter("")}>
              <span className="pr-layer-name">全部来源</span>
            </button>
            {Object.entries(SOURCE_LABEL).map(([id, label]) => (
              <button key={id} className={`pr-layer slim ${srcFilter === id ? "on" : ""}`} onClick={() => setSrcFilter(srcFilter === id ? "" : id)}>
                <span className="pr-layer-name">{label}<em>{notes.filter((n) => n.sourceKind === id).length}</em></span>
              </button>
            ))}
            <p className="notes-meta-empty">来源只用于筛选；注入时不看来源，只看层级与预算。</p>
          </div>
          <div className="pr-block">
            <div className="pr-block-head">其它</div>
            <button className={`pr-layer slim ${tab === "notes" ? "on" : ""}`} onClick={() => setTab("notes")}>
              <span className="pr-layer-name">未验证观察<em>{notes.length}</em></span>
            </button>
            <button className={`pr-layer slim ${tab === "dream" ? "on" : ""}`} onClick={() => setTab("dream")}>
              <span className="pr-layer-name">Dream 建议<em>{sugs.length}</em></span>
            </button>
          </div>
        </aside>

        {/* 中：当前层级的主面 */}
        <section className="pr-main">
          <div className="pr-layer-head">
            <div>
              <h2>{layerMeta.name}<span className="kv-type">{layer === "L4" ? "注入优先" : layer === "L1" ? "仅回查" : "按预算注入"}</span></h2>
              <p>{layerMeta.desc}。{layer === "L4" ? "写进这里的条目每次 run 都会注入，所以宁少不多。" : ""}</p>
            </div>
            <button className="btn tiny-btn" onClick={() => { setDraft(""); document.querySelector<HTMLTextAreaElement>(".pr-new-entry")?.focus(); }}>＋ 新条目</button>
          </div>

          <div className="kv-block">
            <textarea
              className="pr-ask-input pr-new-entry"
              rows={2}
              value={draft}
              placeholder={`写一条${layerMeta.name}：第一行当标题，后面是正文`}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="pr-ask-row">
              <span className="tiny faint">写入「{layerMeta.name}」· 建议一条只说一件事</span>
              <button className="btn tiny-btn primary" disabled={busy || !draft.trim()} onClick={() => void addEntry()}>写入</button>
            </div>
          </div>

          <div className="pr-entries">
            {shownEntries.length === 0 && (
              <EmptyState compact mark="◍" title={`「${layerMeta.name}」还是空的`} desc={layer === "L4" ? "接受 Dream 的「晋升」建议会写到这里，也可以手动添加。" : "条目只由 Dream 建议或人工写入。"} />
            )}
            {shownEntries.map((e) => (
              <div className="pr-entry" key={e.id}>
                <div className="pr-entry-head">
                  <h3>{e.title}</h3>
                  <RowMenu title="条目操作">
                    <button onClick={() => {
                      void act("memoryEntrySources", { id: e.id }).then((refs) => {
                        setNotice(refs?.length ? `来源 ${refs.length} 条：${refs.slice(0, 3).join(" / ")}` : "这条还没有记录来源");
                      });
                    }}>查看来源与引用</button>
                    <button onClick={() => setEditing({ id: e.id, title: e.title, body: e.body })}>编辑</button>
                    <button onClick={() => void demote(e)}>降级到下一层</button>
                    <button className="danger" onClick={() => void archive(e)}>标为过期</button>
                  </RowMenu>
                </div>
                {editing?.id === e.id ? (
                  <div className="pr-entry-edit">
                    <input className="kv-input" value={editing.title} onChange={(ev) => setEditing({ ...editing, title: ev.target.value })} />
                    <textarea className="kv-ask" rows={3} value={editing.body} onChange={(ev) => setEditing({ ...editing, body: ev.target.value })} />
                    <div className="row gap6" style={{ justifyContent: "flex-end" }}>
                      <button className="btn tiny-btn" onClick={() => setEditing(null)}>取消</button>
                      <button className="btn tiny-btn primary" onClick={() => void saveEdit()} disabled={busy}>保存</button>
                    </div>
                  </div>
                ) : (
                  e.body && <p>{e.body}</p>
                )}
                <div className="pr-entry-meta">
                  <span className="chip">来源 {e.sourceRefs?.length || 0}</span>
                  <span className="time">更新 {timeAgo(e.updatedAt)}</span>
                </div>
                {(e.sourceRefs || []).length > 0 && (
                  <div className="pr-evidence">{e.sourceRefs.slice(0, 3).map((s) => <span key={s} className="em">{s}</span>)}</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 右：复核 → 注入预览 → 回查 */}
        <aside className="pr-col pr-side">
          <div className="pr-block">
            <div className="pr-block-head">复核
              <span className="kv-tabs mini">
                <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>未验证观察{notes.length ? ` ${notes.length}` : ""}</button>
                <button className={tab === "dream" ? "on" : ""} onClick={() => setTab("dream")}>Dream 建议{sugs.length ? ` ${sugs.length}` : ""}</button>
              </span>
            </div>

            {tab === "notes" && (
              <>
                {shownNotes.length === 0 && <p className="notes-meta-empty">队列已清空。下次运行 Dream 或导入后才会再出现。</p>}
                {shownNotes.map((n) => (
                  <div key={n.id} className="pr-qitem">
                    <div className="pr-qh">观察<span className="kv-type">{SOURCE_LABEL[n.sourceKind] || n.sourceKind}</span></div>
                    <p>{n.body.slice(0, 200)}</p>
                    <div className="pr-qf">
                      <span className="src">{n.sourceRef || "无来源"} · {timeAgo(n.createdAt)}</span>
                      <span className="row gap6">
                        <button className="btn tiny-btn" onClick={() => void resolveNote(n.id, "stale")}>拒绝</button>
                        <button className="btn tiny-btn ok" onClick={() => void resolveNote(n.id, "verified")}>验证</button>
                      </span>
                    </div>
                  </div>
                ))}
                {notes.length > 1 && (
                  <div className="pr-batch">
                    <span>同类 {notes.length} 条</span>
                    <button className="link tiny" onClick={() => void verifyAll()} disabled={busy}>全部验证</button>
                  </div>
                )}
              </>
            )}

            {tab === "dream" && (
              <>
                {sugs.length === 0 && <p className="notes-meta-empty">没有待处理建议。Dream 只产建议，不直接改写已复核条目。</p>}
                {sugs.map((sg) => (
                  <div key={sg.id} className="pr-qitem">
                    <div className="pr-qh">
                      <span className={`kv-type ${sg.action === "fix" || sg.action === "prune" ? "page" : ""}`}>{ACTION_LABEL[sg.action] || sg.action}</span>
                      <b>{sg.title}</b>
                    </div>
                    <p>{sg.detail}</p>
                    <div className="pr-qf">
                      <span className="src">影响 1 条 · 只产建议</span>
                      <span className="row gap6">
                        <button className="btn tiny-btn" onClick={() => void resolveSug(sg.id, false)} disabled={busy}>拒绝</button>
                        <button className="btn tiny-btn ok" onClick={() => void resolveSug(sg.id, true)} disabled={busy}>接受</button>
                      </span>
                    </div>
                  </div>
                ))}
                <p className="notes-meta-empty">拒绝后同类不再打扰。</p>
              </>
            )}
          </div>

          <div className="pr-block">
            <div className="pr-block-head">注入预览
              <button className="link tiny" onClick={() => void navigator.clipboard?.writeText(inject?.markdown || "")}>复制</button>
            </div>
            <div className="pr-budget">
              <div className="pr-budget-bar"><i style={{ width: `${budgetPct}%` }} /></div>
              <span className="tiny faint">{inject?.chars || 0} / {inject?.budget || 12000} 字符 · 入选 {included.length} 条{cut.length ? ` · 被裁 ${cut.length} 条` : ""}</span>
            </div>
            {[...included, ...cut].slice(0, 10).map((it) => (
              <div key={it.id} className={`pr-inj ${it.included ? "" : "cut"}`}>
                <button className="pr-inj-item" onClick={() => setOpenInjectId((v) => (v === it.id ? "" : it.id))}>
                  <span className="k">{it.layer}</span>
                  <span className="t ellipsis">{it.title}</span>
                  <span className="k">{it.included ? "入选" : "被裁"}</span>
                </button>
                {openInjectId === it.id && <div className="pr-inj-reason">{it.reason}</div>}
              </div>
            ))}
            {!(inject?.items || []).length && <p className="notes-meta-empty">还没有可注入的条目。</p>}
            <p className="notes-meta-empty">点任意一条看入选 / 被裁原因。预算不足时按「结论 → 项目 → 事实」做减法。</p>
          </div>

          <div className="pr-block">
            <div className="pr-block-head">回查</div>
            <input className="notes-search" value={q} placeholder="搜会话 / run / 事件" onChange={(e) => void search(e.target.value)} />
            {hits.slice(0, 8).map((h) => (
              <div key={`${h.kind}-${h.id}`} className="pr-hit">
                <span className="kv-type">{h.kind === "message" ? "会话" : h.kind === "run" ? "run" : "事件"}</span>
                <span className="pr-hit-main">
                  <span className="pr-hit-loc">{h.id.slice(0, 10)} · {new Date(h.at).toLocaleString()}</span>
                  <p>{h.snippet.slice(0, 140)}</p>
                </span>
              </div>
            ))}
            <p className="notes-meta-empty">回查只读原文，不改动任何条目。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
