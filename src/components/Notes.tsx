import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";
import { renderMarkdown } from "../markdown";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "./Icons";
import { NotesEditor } from "./NotesEditor";

type Act = (type: string, payload?: unknown) => Promise<any>;
const PLUGIN_ID = "ai.cockpit.notes";

type PageSummary = {
  id: string; slug: string; title: string; summary: string;
  status: "draft" | "reviewed" | "stale"; confidence: "low" | "medium" | "high";
  updatedAt: number; citations: number; backlinks: number;
};
type Citation = { id: string; pageId: string; sourceId: string; quote?: string; locator?: string; source?: Source };
type Page = PageSummary & { content: string; citations: Citation[]; backlinks: PageSummary[] };
type Source = { id: string; title: string; kind: string; uri?: string; createdAt: number; citations: number; content?: string };
type GraphData = { nodes: { id: string; title: string; kind: "page" | "source"; links: number }[]; edges: { source: string; target: string; kind: string }[] };
type Doc = Page & { dirty: boolean };
type Pane = { tabs: string[]; active: string | null };
type Tab = "pages" | "sources" | "review";
type SourceDraft = { title: string; content: string; url: string; mode: "text" | "url" };

function emptyPane(): Pane { return { tabs: [], active: null }; }
function statusLabel(status: string) { return status === "reviewed" ? "已审核" : status === "stale" ? "已过期" : "Draft"; }

function wikiMarkdown(text: string) {
  return String(text || "").replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_m, target: string, heading: string, alias: string) => {
    const label = alias || (heading ? `${target}#${heading}` : target);
    return `[${label}](#wiki/${encodeURIComponent(target.trim())})`;
  });
}

export function Notes({ state, act, onOpenTodo, openRequest }: {
  state: State; act: Act; onOpenTodo?: (id: string) => void; openRequest?: { path: string; n: number } | null;
}) {
  const plugin = (state.plugins || []).find((p) => p.id === PLUGIN_ID);
  const enabled = Boolean(plugin?.enabled);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [reviews, setReviews] = useState<PageSummary[]>([]);
  const [log, setLog] = useState<{ id: string; kind: string; text: string; at: number }[]>([]);
  const [tab, setTab] = useState<Tab>("pages");
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<{ kind: string; id: string; title: string; snippet: string }[]>([]);
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [left, setLeft] = useState<Pane>(emptyPane);
  const [right, setRight] = useState<Pane>(emptyPane);
  const [split, setSplit] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [focus, setFocus] = useState<"left" | "right">("left");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [graph, setGraph] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [sourceView, setSourceView] = useState<Source | null>(null);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [layoutReady, setLayoutReady] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const invoke = useCallback((method: string, args: Record<string, unknown> = {}) => act("pluginInvoke", { pluginId: PLUGIN_ID, method, args }), [act]);
  const fail = (err: unknown) => setError(String((err as Error)?.message || err));
  const pane = focus === "left" ? left : right;
  const setPane = (which: "left" | "right", update: (p: Pane) => Pane) => which === "left" ? setLeft(update) : setRight(update);
  const activeDoc = pane.active ? docs[pane.active] ?? null : null;
  const linkedTodos = activeDoc ? (state.todoLinks || []).filter((l) => l.pluginId === PLUGIN_ID && l.ref === activeDoc.id) : [];

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await invoke("wiki.list");
      if (!res) return;
      setPages(Array.isArray(res.pages) ? res.pages : []);
      setSources(Array.isArray(res.sources) ? res.sources : []);
      setReviews(Array.isArray(res.reviews) ? res.reviews : []);
      setLog(Array.isArray(res.log) ? res.log : []);
      setError("");
    } catch (err) { fail(err); }
  }, [enabled, invoke]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadPage = useCallback(async (pageId: string) => {
    const existing = docs[pageId];
    if (existing) return existing;
    const page = await invoke("wiki.getPage", { id: pageId });
    if (!page) return null;
    const doc: Doc = { ...page, dirty: false };
    setDocs((current) => ({ ...current, [pageId]: doc }));
    return doc;
  }, [docs, invoke]);

  const openPage = useCallback(async (pageId: string, target: "left" | "right" = focus) => {
    if (!pageId) return;
    const where = split ? target : "left";
    setGraph(false);
    const doc = await loadPage(pageId);
    if (!doc) return;
    setPane(where, (p) => ({ tabs: p.tabs.includes(pageId) ? p.tabs : [...p.tabs, pageId], active: pageId }));
    setFocus(where);
    setMode("preview");
  }, [focus, split, loadPage]);

  useEffect(() => {
    if (!openRequest?.path) return;
    void openPage(openRequest.path, "left");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  // Restore tabs/layout from the wiki store.
  useEffect(() => {
    if (!enabled || layoutReady) return;
    (async () => {
      try {
        const layout = await invoke("wiki.layout.get");
        if (layout && typeof layout === "object") {
          const leftTabs = (layout.left?.tabs || []).filter((x: unknown) => typeof x === "string");
          const rightTabs = (layout.right?.tabs || []).filter((x: unknown) => typeof x === "string");
          for (const pageId of [...new Set([...leftTabs, ...rightTabs])]) await loadPage(pageId);
          setLeft({ tabs: leftTabs, active: layout.left?.active || leftTabs[0] || null });
          setRight({ tabs: rightTabs, active: layout.right?.active || rightTabs[0] || null });
          setSplit(Boolean(layout.split));
          setSplitRatio(Number(layout.ratio) >= 0.2 && Number(layout.ratio) <= 0.8 ? Number(layout.ratio) : 0.5);
          setFocus(layout.focus === "right" ? "right" : "left");
        }
      } catch { /* optional */ }
      setLayoutReady(true);
    })();
  }, [enabled, layoutReady, invoke, loadPage]);

  useEffect(() => {
    if (!layoutReady) return;
    const timer = window.setTimeout(() => { void invoke("wiki.layout.set", { layout: { left, right, split, ratio: splitRatio, focus } }).catch(() => {}); }, 500);
    return () => window.clearTimeout(timer);
  }, [layoutReady, left, right, split, splitRatio, focus, invoke]);

  const updateDoc = (pageId: string, content: string) => {
    setDocs((current) => current[pageId] ? { ...current, [pageId]: { ...current[pageId], content, dirty: true } } : current);
    setNotice("");
  };

  const saveDoc = useCallback(async (pageId: string) => {
    const doc = docs[pageId];
    if (!doc || !doc.dirty) return;
    setBusy(true);
    try {
      const res = await invoke("wiki.savePage", { id: pageId, content: doc.content });
      if (res) setDocs((current) => ({ ...current, [pageId]: { ...res, dirty: false } }));
      setNotice("已保存 draft");
      await refresh();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }, [docs, invoke, refresh]);

  const closeTab = (where: "left" | "right", pageId: string) => {
    const doc = docs[pageId];
    if (doc?.dirty && !window.confirm(`「${doc.title}」有未保存修改，关闭？`)) return;
    setPane(where, (p) => {
      const idx = p.tabs.indexOf(pageId);
      const tabs = p.tabs.filter((x) => x !== pageId);
      return { tabs, active: p.active === pageId ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : p.active };
    });
  };

  const createPage = async () => {
    const title = window.prompt("新建 Wiki 页面", "Untitled");
    if (!title) return;
    setBusy(true);
    try {
      const page = await invoke("wiki.createPage", { title });
      if (page) { setDocs((current) => ({ ...current, [page.id]: { ...page, dirty: false } })); setLeft((p) => ({ tabs: p.tabs.includes(page.id) ? p.tabs : [...p.tabs, page.id], active: page.id })); setFocus("left"); setTab("pages"); setMode("edit"); await refresh(); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const reviewPage = async (pageId: string, decision: "accept" | "reject") => {
    setBusy(true);
    try {
      const feedback = decision === "reject" ? window.prompt("退回原因（可空）", "") || "" : "";
      const page = await invoke("wiki.review", { id: pageId, decision, feedback });
      if (page) setDocs((current) => ({ ...current, [pageId]: { ...page, dirty: false } }));
      setNotice(decision === "accept" ? "已接受为 reviewed" : "已退回 draft");
      await refresh();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const importSource = async () => {
    if (!sourceDraft) return;
    setBusy(true);
    try {
      const source = sourceDraft.mode === "url"
        ? await invoke("wiki.importUrl", { url: sourceDraft.url, title: sourceDraft.title })
        : await invoke("wiki.importSource", { title: sourceDraft.title, content: sourceDraft.content, kind: "text", uri: "" });
      if (source) { setSourceDraft(null); setTab("sources"); await refresh(); setNotice("已导入 source"); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const openSource = async (sourceId: string) => {
    try {
      const source = sources.find((s) => s.id === sourceId) || await invoke("wiki.source", { id: sourceId });
      if (source) setSourceView(source);
    } catch (err) { fail(err); }
  };

  const sendSourceToChat = (source: Source) => {
    const text = `请基于以下 source 整理一个 Wiki draft。\n\nSource id: ${source.id}\nSource: ${source.title}\n${source.content || ""}\n\n要求：使用 wiki_search / wiki_read_source / wiki_upsert_draft / wiki_add_citation 工具；给出页面结构、关键结论，并绑定引用。不要直接标记 reviewed。`;
    window.dispatchEvent(new CustomEvent("harness:view", { detail: "workspace" }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail: { text } })), 100);
  };

  const addCitation = async (sourceId: string) => {
    if (!activeDoc) return;
    setBusy(true);
    try {
      const page = await invoke("wiki.addCitation", { pageId: activeDoc.id, sourceId });
      if (page) setDocs((current) => ({ ...current, [activeDoc.id]: { ...page, dirty: false } }));
      await refresh();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const createTask = async () => {
    if (!activeDoc) return;
    setBusy(true);
    try { const res = await invoke("wiki.createTask", { id: activeDoc.id }); if (res) setNotice(`已创建任务 ${res.key || res.title || ""}`); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const sendPageToChat = () => {
    if (!activeDoc) return;
    const text = `基于这个 Wiki 页面继续：\n\n# ${activeDoc.title}\n\n${activeDoc.content.slice(0, 12000)}`;
    window.dispatchEvent(new CustomEvent("harness:view", { detail: "workspace" }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail: { text } })), 100);
  };

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) { setSearchHits([]); return; }
    try { setSearchHits((await invoke("wiki.search", { query: value })) || []); } catch { /* ignore */ }
  };

  const toggleSplit = () => {
    if (split) { setSplit(false); setRight(emptyPane()); setFocus("left"); return; }
    const pageId = left.active;
    setSplit(true);
    setRight(pageId ? { tabs: [pageId], active: pageId } : emptyPane());
    setFocus("right");
  };

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: PointerEvent) => setSplitRatio(Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left) / Math.max(1, rect.width))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const openGraph = async () => {
    setGraph(true); setGraphLoading(true);
    try { setGraphData((await invoke("wiki.graph")) || { nodes: [], edges: [] }); } catch (err) { fail(err); } finally { setGraphLoading(false); }
  };

  const filteredSources = useMemo(() => sources.filter((s) => !query || `${s.title} ${s.uri || ""}`.toLowerCase().includes(query.toLowerCase())), [sources, query]);
  const filteredPages = useMemo(() => pages.filter((p) => !query || `${p.title} ${p.summary}`.toLowerCase().includes(query.toLowerCase())), [pages, query]);

  if (!enabled) {
    return <div className="notes-page notes-disabled"><div className="notes-disabled-card"><b>Wiki 插件未启用</b><p>在「设置 → 插件」启用内置 Wiki。</p></div></div>;
  }

  const renderPane = (which: "left" | "right") => {
    const current = which === "left" ? left : right;
    const doc = current.active ? docs[current.active] : null;
    return (
      <section className={`notes-editor-pane ${focus === which ? "focused" : ""}`} onMouseDown={() => setFocus(which)}>
        <div className="notes-tabbar">
          {current.tabs.map((pageId) => {
            const d = docs[pageId];
            if (!d) return null;
            return <button key={pageId} className={`notes-tab ${current.active === pageId ? "on" : ""}`} onClick={() => { setFocus(which); setPane(which, (p) => ({ ...p, active: pageId })); }} title={d.title}>{d.dirty && <span className="notes-tab-dirty" />}<span className="ellipsis">{d.title}</span><i onClick={(e) => { e.stopPropagation(); closeTab(which, pageId); }}>×</i></button>;
          })}
          <button className="notes-tab-add" title="新建页面" onClick={() => void createPage()}>＋</button>
        </div>
        {!doc ? (
          <div className="notes-empty notes-empty-pane"><div className="notes-empty-mark">✦</div><b>Wiki</b><p>从左侧打开页面，或导入 source 后让 Curator 整理。</p></div>
        ) : (
          <>
            <div className="notes-note-head">
              <div className="notes-note-title"><b>{doc.title}</b><span className="mono">{statusLabel(doc.status)} · {doc.citations.length} citations</span></div>
              <div className="notes-mode"><button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>阅读</button><button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>编辑</button></div>
              <div className="notes-note-actions">
                {doc.dirty && <button className="btn tiny-btn" onClick={() => void saveDoc(doc.id)} disabled={busy}>保存 draft</button>}
                {doc.status === "draft" && <button className="btn tiny-btn primary" onClick={() => void reviewPage(doc.id, "accept")} disabled={busy}>接受</button>}
                {doc.status === "draft" && <button className="btn tiny-btn" onClick={() => void reviewPage(doc.id, "reject")} disabled={busy}>退回</button>}
                <button className="btn tiny-btn" onClick={() => void createTask()} disabled={busy}>创建任务</button>
                <button className="btn tiny-btn" onClick={sendPageToChat}>发送到 Chat</button>
              </div>
            </div>
            {mode === "preview" ? (
              <div className="notes-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiMarkdown(doc.content)) }} onClick={(e) => {
                const anchor = (e.target as HTMLElement).closest("a");
                const href = anchor?.getAttribute("href") || "";
                if (!href) return;
                if (/^https?:/i.test(href)) { e.preventDefault(); void window.harness.openExternal(href); return; }
                if (href.startsWith("#wiki/")) {
                  e.preventDefault();
                  const title = decodeURIComponent(href.slice(6)).split("#")[0];
                  const target = pages.find((p) => p.title === title || p.slug === title || p.id === title);
                  if (target) void openPage(target.id, which);
                }
              }} />
            ) : (
              <NotesEditor key={doc.id} value={doc.content} pages={pages.map((p) => ({ path: p.id, title: p.title }))} tags={[]} onChange={(value) => updateDoc(doc.id, value)} onSave={() => void saveDoc(doc.id)} />
            )}
          </>
        )}
      </section>
    );
  };

  return (
    <div className="notes-page">
      <header className="notes-head">
        <div><span className="notes-kicker">NATIVE · LLM WIKI</span><h1>Wiki</h1><p>{pages.length} pages · {sources.length} sources · {reviews.length} drafts</p></div>
        <div className="notes-actions">
          <button className="btn" onClick={() => { setSourceDraft({ title: "", content: "", url: "", mode: "text" }); }} disabled={busy}>＋ 导入资料</button>
          <button className="btn" onClick={() => void createPage()} disabled={busy}>＋ 页面</button>
          <button className="btn" onClick={() => void refresh()} title="刷新"><RefreshIcon size={13} /></button>
          <button className={`btn ${split ? "primary" : ""}`} onClick={toggleSplit}>分屏</button>
          <button className={`btn ${graph ? "primary" : ""}`} onClick={() => graph ? setGraph(false) : void openGraph()}>图谱</button>
        </div>
      </header>
      {(error || notice) && <div className={`notes-banner ${error ? "error" : ""}`}>{error || notice}</div>}
      <div className="notes-layout">
        <aside className="notes-sidebar">
          <div className="notes-wiki-tabs">
            <button className={tab === "pages" ? "on" : ""} onClick={() => setTab("pages")}>页面 <em>{pages.length}</em></button>
            <button className={tab === "sources" ? "on" : ""} onClick={() => setTab("sources")}>资料 <em>{sources.length}</em></button>
            <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>审核 <em>{reviews.length}</em></button>
          </div>
          <input className="notes-search" value={query} onChange={(e) => void search(e.target.value)} placeholder="搜索页面 / source" />
          {searchHits.length > 0 && <div className="notes-search-results">{searchHits.slice(0, 12).map((hit) => <button key={hit.id} onClick={() => hit.kind === "page" ? void openPage(hit.id) : void openSource(hit.id)}><b>{hit.title}</b><span>{hit.kind}</span><em>{hit.snippet}</em></button>)}</div>}
          <div className="notes-tree">
            {tab === "pages" && filteredPages.map((p) => <button key={p.id} className={`notes-file ${activeDoc?.id === p.id ? "on" : ""}`} onClick={() => void openPage(p.id)}><span className={`notes-status-dot ${p.status}`} /><span className="ellipsis">{p.title}</span><em>{p.status === "draft" ? "draft" : p.status === "stale" ? "stale" : ""}</em></button>)}
            {tab === "sources" && filteredSources.map((s) => <button key={s.id} className="notes-file" onClick={() => void openSource(s.id)}><span className="notes-source-icon">▤</span><span className="ellipsis">{s.title}</span><em>{s.citations || 0}</em></button>)}
            {tab === "review" && reviews.map((p) => <button key={p.id} className="notes-file" onClick={() => void openPage(p.id)}><span className={`notes-status-dot ${p.status}`} /><span className="ellipsis">{p.title}</span><em>draft</em></button>)}
            {tab === "pages" && filteredPages.length === 0 && <div className="notes-empty-list">还没有页面。创建一个，或导入 source。</div>}
            {tab === "sources" && filteredSources.length === 0 && <div className="notes-empty-list">还没有资料。导入文本或 URL。</div>}
            {tab === "review" && reviews.length === 0 && <div className="notes-empty-list">没有待审核 draft。</div>}
          </div>
          {tab === "sources" && log.length > 0 && <div className="notes-log">{log.slice(0, 5).map((l) => <div key={l.id}>{l.text}</div>)}</div>}
        </aside>

        <main className="notes-main">
          {graph ? <GraphView data={graphData} loading={graphLoading} onOpen={(id) => { setGraph(false); void openPage(id, "left"); }} /> : (
            <div className={`notes-pane-layout ${split ? "split" : ""}`} ref={mainRef as React.RefObject<HTMLDivElement>} style={split ? { gridTemplateColumns: `${splitRatio * 100}% 5px minmax(0,1fr)` } : undefined}>
              {renderPane("left")}
              {split && <div className="notes-split-gutter" onPointerDown={startSplitDrag} />}
              {split && renderPane("right")}
            </div>
          )}
        </main>

        <aside className="notes-meta">
          {activeDoc ? (
            <>
              <div className="notes-meta-block"><div className="notes-meta-title">Status</div><div className={`notes-review-badge ${activeDoc.status}`}>{statusLabel(activeDoc.status)}</div><p className="notes-meta-empty">confidence: {activeDoc.confidence}</p></div>
              <div className="notes-meta-block">
                <div className="notes-meta-title">Citations <em>{activeDoc.citations.length}</em></div>
                {activeDoc.citations.length === 0 && <p className="notes-meta-empty">还没有引用 source</p>}
                {activeDoc.citations.map((c) => <button key={c.id} className="notes-link" onClick={() => c.sourceId && void openSource(c.sourceId)}><b>{c.source?.title || c.sourceId}</b>{c.quote && <span>{c.quote.slice(0, 80)}</span>}</button>)}
                {sources.length > 0 && <select className="notes-cite-select" value="" onChange={(e) => { if (e.target.value) void addCitation(e.target.value); }}><option value="">＋ 引用 source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
              </div>
              <div className="notes-meta-block"><div className="notes-meta-title">Backlinks <em>{activeDoc.backlinks?.length || 0}</em></div>{(activeDoc.backlinks || []).map((b) => <button key={b.id} className="notes-link" onClick={() => void openPage(b.id, focus)}><b>{b.title}</b><span>{statusLabel(b.status)}</span></button>)}</div>
              <div className="notes-meta-block"><div className="notes-meta-title">Linked Todos <em>{linkedTodos.length}</em></div>{linkedTodos.length === 0 && <p className="notes-meta-empty">还没有关联任务</p>}{linkedTodos.map((l) => { const todo = state.todos.find((t) => t.id === l.todoId); return <button key={l.id} className="notes-link" disabled={!todo || !onOpenTodo} onClick={() => todo && onOpenTodo?.(todo.id)}><b>{todo?.title || l.title || l.todoId}</b><span>{todo?.key} {todo?.status}</span></button>; })}</div>
            </>
          ) : <p className="notes-meta-empty">打开页面后显示 citations / backlinks / 任务。</p>}
        </aside>
      </div>

      {sourceDraft && (
        <div className="notes-source-modal">
          <div className="notes-source-card">
            <div className="notes-source-head"><b>导入资料</b><button className="icon-btn" onClick={() => setSourceDraft(null)}>×</button></div>
            <div className="notes-source-mode"><button className={sourceDraft.mode === "text" ? "on" : ""} onClick={() => setSourceDraft({ ...sourceDraft, mode: "text" })}>文本 / Markdown</button><button className={sourceDraft.mode === "url" ? "on" : ""} onClick={() => setSourceDraft({ ...sourceDraft, mode: "url" })}>URL</button></div>
            <input className="notes-source-title" placeholder="标题" value={sourceDraft.title} onChange={(e) => setSourceDraft({ ...sourceDraft, title: e.target.value })} />
            {sourceDraft.mode === "url" ? <input className="notes-source-title" placeholder="https://..." value={sourceDraft.url} onChange={(e) => setSourceDraft({ ...sourceDraft, url: e.target.value })} /> : <textarea className="notes-source-content" placeholder="粘贴资料内容…" value={sourceDraft.content} onChange={(e) => setSourceDraft({ ...sourceDraft, content: e.target.value })} />}
            <div className="notes-source-actions"><button className="btn" onClick={() => setSourceDraft(null)}>取消</button><button className="btn primary" disabled={busy || (sourceDraft.mode === "url" ? !sourceDraft.url.trim() : !sourceDraft.content.trim())} onClick={() => void importSource()}>导入</button></div>
          </div>
        </div>
      )}

      {sourceView && (
        <div className="notes-source-modal" onClick={() => setSourceView(null)}>
          <div className="notes-source-card" onClick={(e) => e.stopPropagation()}>
            <div className="notes-source-head"><div><b>{sourceView.title}</b><span className="mono">{sourceView.kind} {sourceView.uri ? `· ${sourceView.uri}` : ""}</span></div><button className="icon-btn" onClick={() => setSourceView(null)}>×</button></div>
            <div className="notes-source-read">{sourceView.content || "（source 内容未加载）"}</div>
            <div className="notes-source-actions"><button className="btn tiny-btn" onClick={() => sendSourceToChat(sourceView)}>发送到 Chat 整理</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function GraphView({ data, loading, onOpen }: { data: GraphData | null; loading: boolean; onOpen: (id: string) => void }) {
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const positions = useMemo(() => {
    const cap = nodes.slice(0, 280);
    const index = new Map(cap.map((n, i) => [n.id, i]));
    const points = cap.map((_, i) => { const a = (i / Math.max(1, cap.length)) * Math.PI * 2; return { x: 50 + Math.cos(a) * 26, y: 50 + Math.sin(a) * 26 }; });
    const links = edges.filter((e) => index.has(e.source) && index.has(e.target)).slice(0, 1200);
    for (let step = 0; step < 80; step++) {
      const fx = new Array(cap.length).fill(0); const fy = new Array(cap.length).fill(0);
      for (let i = 0; i < cap.length; i++) for (let j = i + 1; j < cap.length; j++) {
        let dx = points[i].x - points[j].x; let dy = points[i].y - points[j].y;
        const d2 = dx * dx + dy * dy + 0.01; if (d2 > 500) continue;
        const f = 3.2 / d2; dx *= f; dy *= f; fx[i] += dx; fy[i] += dy; fx[j] -= dx; fy[j] -= dy;
      }
      for (const e of links) { const a = index.get(e.source)!; const b = index.get(e.target)!; const dx = points[b].x - points[a].x; const dy = points[b].y - points[a].y; fx[a] += dx * .018; fy[a] += dy * .018; fx[b] -= dx * .018; fy[b] -= dy * .018; }
      for (let i = 0; i < cap.length; i++) { fx[i] += (50 - points[i].x) * .008; fy[i] += (50 - points[i].y) * .008; points[i].x = Math.max(6, Math.min(94, points[i].x + fx[i])); points[i].y = Math.max(6, Math.min(94, points[i].y + fy[i])); }
    }
    return new Map(cap.map((n, i) => [n.id, points[i]]));
  }, [nodes, edges]);
  if (loading) return <div className="notes-empty"><div className="notes-empty-mark">✦</div><b>构建 Wiki 图谱…</b></div>;
  if (!nodes.length) return <div className="notes-empty"><div className="notes-empty-mark">✦</div><b>还没有图谱</b><p>导入 source 或创建页面，并建立引用/链接。</p></div>;
  return <div className="notes-graph"><svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">{edges.map((e, i) => { const a = positions.get(e.source); const b = positions.get(e.target); return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null; })}{nodes.map((n) => { const p = positions.get(n.id); if (!p) return null; return <g key={n.id} onClick={() => onOpen(n.id)} className={`notes-graph-node ${n.kind}`}><circle cx={p.x} cy={p.y} r={Math.min(3.2, 1.5 + Math.sqrt(n.links) * .55)} /><text x={p.x} y={p.y - 4.5} textAnchor="middle">{n.title.slice(0, 18)}</text></g>; })}</svg><div className="notes-graph-count">{nodes.length} nodes · {edges.length} links</div></div>;
}
