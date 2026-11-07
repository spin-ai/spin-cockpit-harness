import { useCallback, useEffect, useMemo, useState } from "react";
import type { State } from "../types";
import { renderMarkdown } from "../markdown";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;
const PLUGIN_ID = "ai.cockpit.notes";

type NoteSummary = {
  path: string; name: string; folder: string; title: string; mtime: number;
  tags: string[]; headings: number; links: number;
};
type TagSummary = { name: string; count: number };
type NoteView = {
  path: string; name: string; folder: string; title: string; content: string;
  frontmatter: Record<string, unknown>; headings: { level: number; text: string; line: number }[];
  tags: string[]; outgoing: { target: string; heading?: string; alias?: string; path?: string | null }[];
  backlinks: { path: string; title: string; heading?: string; alias?: string }[];
  mtime: number;
};
type Doc = NoteView & { dirty: boolean };
type Pane = { tabs: string[]; active: string | null };
type GraphData = { nodes: { path: string; title: string; links: number }[]; edges: { source: string; target: string }[] };
type SearchHit = { path: string; title: string; snippet: string };

function emptyPane(): Pane { return { tabs: [], active: null }; }

/** [[Page|Alias]] → 内部锚点，交给 preview 的点击处理器打开笔记 */
function wikiMarkdown(text: string) {
  return String(text || "").replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_m, target: string, heading: string, alias: string) => {
    const label = alias || (heading ? `${target}#${heading}` : target);
    return `[${label}](#note/${encodeURIComponent(target.trim())})`;
  });
}

export function Notes({ state, act, onOpenTodo, openRequest }: {
  state: State; act: Act; onOpenTodo?: (id: string) => void; openRequest?: { path: string; n: number } | null;
}) {
  const plugin = (state.plugins || []).find((p) => p.id === PLUGIN_ID);
  const enabled = Boolean(plugin?.enabled);
  const [status, setStatus] = useState<{ vaultPath: string; count: number; indexedAt: number; error: string | null } | null>(null);
  const [files, setFiles] = useState<NoteSummary[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [docs, setDocs] = useState<Record<string, Doc>>({});
  const [left, setLeft] = useState<Pane>(emptyPane);
  const [right, setRight] = useState<Pane>(emptyPane);
  const [split, setSplit] = useState(false);
  const [focus, setFocus] = useState<"left" | "right">("left");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [graph, setGraph] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});

  const invoke = useCallback((method: string, args: Record<string, unknown> = {}) => act("pluginInvoke", { pluginId: PLUGIN_ID, method, args }), [act]);
  const fail = (err: unknown) => setError(String((err as Error)?.message || err));
  const pane = focus === "left" ? left : right;
  const setPane = (which: "left" | "right", update: (p: Pane) => Pane) => which === "left" ? setLeft(update) : setRight(update);
  const activePath = pane.active;
  const activeDoc = activePath ? docs[activePath] ?? null : null;
  const linkedTodos = activeDoc ? (state.todoLinks || []).filter((l) => l.pluginId === PLUGIN_ID && l.ref === activeDoc.path) : [];

  const refreshList = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await invoke("notes.list");
      if (!res) return;
      setStatus({ vaultPath: res.vaultPath || "", count: res.files?.length || 0, indexedAt: Date.now(), error: res.error || null });
      setFiles(Array.isArray(res.files) ? res.files : []);
      setTags(Array.isArray(res.tags) ? res.tags : []);
      setError(res.error || "");
    } catch (err) { fail(err); } finally { setLoading(false); }
  }, [enabled, invoke]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const loadDoc = useCallback(async (path: string) => {
    if (!path) return null;
    setLoading(true);
    try {
      const res = await invoke("notes.read", { path });
      if (!res) return null;
      const doc: Doc = { ...res, dirty: false };
      setDocs((current) => ({ ...current, [path]: doc }));
      setError("");
      return doc;
    } catch (err) { fail(err); return null; } finally { setLoading(false); }
  }, [invoke]);

  const openNote = useCallback(async (path: string, target: "left" | "right" = focus) => {
    if (!path) return;
    const where = split ? target : "left";
    setGraph(false);
    const doc = docs[path] || await loadDoc(path);
    if (!doc) return;
    setPane(where, (p) => ({ tabs: p.tabs.includes(path) ? p.tabs : [...p.tabs, path], active: path }));
    setFocus(where);
    setMode("preview");
  }, [focus, split, docs, loadDoc]);

  useEffect(() => {
    if (!openRequest?.path) return;
    void openNote(openRequest.path, "left");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  const closeTab = (where: "left" | "right", path: string) => {
    const doc = docs[path];
    if (doc?.dirty && !window.confirm(`「${doc.title}」有未保存修改，关闭？`)) return;
    setPane(where, (p) => {
      const idx = p.tabs.indexOf(path);
      const tabs = p.tabs.filter((x) => x !== path);
      const active = p.active === path ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : p.active;
      return { tabs, active };
    });
    const stillUsed = (where === "left" ? right : left).tabs.includes(path);
    if (!stillUsed) setDocs((current) => { const next = { ...current }; delete next[path]; return next; });
  };

  const updateDoc = (path: string, content: string) => {
    setDocs((current) => current[path] ? { ...current, [path]: { ...current[path], content, dirty: true } } : current);
    setNotice("");
  };

  const saveDoc = useCallback(async (path: string) => {
    const doc = docs[path];
    if (!doc || !doc.dirty) return;
    setBusy(true);
    try {
      const res = await invoke("notes.save", { path, content: doc.content, mtime: doc.mtime });
      if (res) { setDocs((current) => ({ ...current, [path]: { ...res, dirty: false } })); setNotice("已保存"); }
      await refreshList();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }, [docs, invoke, refreshList]);

  const pickVault = async () => {
    setBusy(true);
    try {
      const res = await invoke("notes.pickVault");
      if (!res) return;
      setStatus({ vaultPath: res.vaultPath || "", count: res.files?.length || 0, indexedAt: Date.now(), error: res.error || null });
      setFiles(Array.isArray(res.files) ? res.files : []);
      setTags(Array.isArray(res.tags) ? res.tags : []);
      setDocs({}); setLeft(emptyPane()); setRight(emptyPane()); setSplit(false); setGraph(false); setError(res.error || "");
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const daily = async () => {
    setBusy(true);
    try {
      const res = await invoke("notes.daily");
      if (res) {
        setDocs((current) => ({ ...current, [res.path]: { ...res, dirty: false } }));
        setPane(focus, (p) => ({ tabs: p.tabs.includes(res.path) ? p.tabs : [...p.tabs, res.path], active: res.path }));
        setGraph(false); setMode("preview"); setNotice("");
        await refreshList();
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const createNote = async () => {
    const name = window.prompt("新笔记名称", "Untitled");
    if (!name) return;
    setBusy(true);
    try {
      const res = await invoke("notes.create", { name });
      if (res) {
        setDocs((current) => ({ ...current, [res.path]: { ...res, dirty: false } }));
        setPane(focus, (p) => ({ tabs: p.tabs.includes(res.path) ? p.tabs : [...p.tabs, res.path], active: res.path }));
        setGraph(false); setMode("edit");
        await refreshList();
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const createTask = async () => {
    if (!activeDoc) return;
    setBusy(true);
    try {
      const res = await invoke("notes.createTask", { path: activeDoc.path, title: activeDoc.title, content: activeDoc.content });
      if (res) setNotice(`已创建任务 ${res.key || res.title || ""}`);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const sendToChat = () => {
    if (!activeDoc) return;
    const text = `基于这段笔记继续：\n\n# ${activeDoc.title}\n\n${activeDoc.content.slice(0, 12000)}`;
    window.dispatchEvent(new CustomEvent("harness:view", { detail: "workspace" }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail: { text } })), 100);
  };

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) { setSearchHits([]); return; }
    try { setSearchHits((await invoke("notes.search", { query: value })) || []); } catch { /* ignore */ }
  };

  const toggleSplit = () => {
    if (split) {
      setSplit(false); setRight(emptyPane()); setFocus("left");
      return;
    }
    const path = left.active;
    setSplit(true);
    setRight(path ? { tabs: [path], active: path } : emptyPane());
    setFocus("right");
  };

  const openGraph = async () => {
    setGraph(true); setGraphLoading(true);
    try { setGraphData((await invoke("notes.graph")) || { nodes: [], edges: [] }); } catch (err) { fail(err); } finally { setGraphLoading(false); }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => files.filter((f) => {
    if (tag && !f.tags.includes(tag)) return false;
    if (!normalizedQuery) return true;
    return `${f.title} ${f.path} ${f.tags.join(" ")}`.toLowerCase().includes(normalizedQuery);
  }), [files, tag, normalizedQuery]);
  const folders = useMemo(() => {
    const groups = new Map<string, NoteSummary[]>();
    for (const file of visible) {
      const key = file.folder || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(file);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  if (!enabled) {
    return (
      <div className="notes-page notes-disabled">
        <div className="notes-disabled-card">
          <b>Notes 插件未启用</b>
          <p>请先在「设置 → 插件」安装并启用 Notes，然后回到这里选择 Obsidian vault。</p>
        </div>
      </div>
    );
  }

  const renderPane = (which: "left" | "right") => {
    const current = which === "left" ? left : right;
    const doc = current.active ? docs[current.active] : null;
    return (
      <section className={`notes-editor-pane ${focus === which ? "focused" : ""}`} onMouseDown={() => setFocus(which)}>
        <div className="notes-tabbar">
          {current.tabs.map((path) => {
            const d = docs[path];
            if (!d) return null;
            return (
              <button key={path} className={`notes-tab ${current.active === path ? "on" : ""}`} onClick={() => { setFocus(which); setPane(which, (p) => ({ ...p, active: path })); }} title={path}>
                {d.dirty && <span className="notes-tab-dirty" />}
                <span className="ellipsis">{d.title}</span>
                <i onClick={(e) => { e.stopPropagation(); closeTab(which, path); }}>×</i>
              </button>
            );
          })}
          <button className="notes-tab-add" title="打开/新建笔记" onClick={() => void daily()}>＋</button>
        </div>
        {!doc ? (
          <div className="notes-empty notes-empty-pane"><div className="notes-empty-mark">#</div><b>空窗格</b><p>从左侧打开笔记，或点 ＋ 打开今日笔记。</p></div>
        ) : (
          <>
            <div className="notes-note-head">
              <div className="notes-note-title"><b>{doc.title}</b><span className="mono">{doc.path}</span></div>
              <div className="notes-mode">
                <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>预览</button>
                <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>编辑</button>
              </div>
              <div className="notes-note-actions">
                <button className="btn tiny-btn" onClick={() => void saveDoc(doc.path)} disabled={!doc.dirty || busy}>{doc.dirty ? "保存" : "已保存"}</button>
                <button className="btn tiny-btn" onClick={() => void createTask()} disabled={busy}>创建任务</button>
                <button className="btn tiny-btn" onClick={sendToChat}>发送到 Chat</button>
              </div>
            </div>
            {mode === "preview" ? (
              <div className="notes-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiMarkdown(doc.content)) }} onClick={(e) => {
                const anchor = (e.target as HTMLElement).closest("a");
                const href = anchor?.getAttribute("href") || "";
                if (!href) return;
                if (/^https?:/i.test(href)) { e.preventDefault(); void window.harness.openExternal(href); return; }
                e.preventDefault();
                if (href.startsWith("#note/")) {
                  const target = decodeURIComponent(href.slice(6)).split("#")[0];
                  const file = files.find((f) => f.title === target || f.name === target || f.path === target || f.path === `${target}.md`);
                  if (file) void openNote(file.path, which);
                  return;
                }
                void openNote(href.replace(/^#\/?/, "").replace(/\.md$/, ""), which);
              }} />
            ) : (
              <textarea
                className="notes-editor"
                value={doc.content}
                spellCheck={false}
                onChange={(e) => updateDoc(doc.path, e.target.value)}
                onKeyDown={(e) => { if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveDoc(doc.path); } }}
              />
            )}
          </>
        )}
      </section>
    );
  };

  return (
    <div className="notes-page">
      <header className="notes-head">
        <div>
          <span className="notes-kicker">PLUGIN · NOTES</span>
          <h1>笔记</h1>
          <p>{status?.vaultPath ? status.vaultPath : "选择一个 Obsidian vault 开始。"}{status?.count ? ` · ${status.count} notes` : ""}</p>
        </div>
        <div className="notes-actions">
          <button className="btn" onClick={() => void pickVault()} disabled={busy}>{status?.vaultPath ? "切换 vault" : "选择 vault"}</button>
          <button className="btn" onClick={() => void refreshList()} disabled={loading || !status?.vaultPath} title="刷新索引"><RefreshIcon size={13} /></button>
          <button className="btn" onClick={() => void daily()} disabled={!status?.vaultPath || busy}>今日</button>
          <button className="btn" onClick={() => void createNote()} disabled={!status?.vaultPath || busy}>＋ 新建</button>
          <button className={`btn ${split ? "primary" : ""}`} onClick={toggleSplit} disabled={!status?.vaultPath}>分屏</button>
          <button className={`btn ${graph ? "primary" : ""}`} onClick={() => graph ? setGraph(false) : void openGraph()} disabled={!status?.vaultPath}>图谱</button>
        </div>
      </header>
      {(error || notice) && <div className={`notes-banner ${error ? "error" : ""}`}>{error || notice}</div>}
      {!status?.vaultPath ? (
        <div className="notes-empty">
          <div className="notes-empty-mark">#</div>
          <b>打开一个 Obsidian vault</b>
          <p>Markdown 是唯一事实来源；Cockpit 只建可重建的索引。</p>
          <button className="btn primary" onClick={() => void pickVault()} disabled={busy}>选择 vault 目录</button>
        </div>
      ) : (
        <div className="notes-layout">
          <aside className="notes-sidebar">
            <input className="notes-search" value={query} onChange={(e) => void search(e.target.value)} placeholder="搜索标题 / 路径 / 内容" />
            <div className="notes-tagbar">
              <button className={!tag ? "on" : ""} onClick={() => setTag("")}>全部</button>
              {tags.slice(0, 12).map((t) => <button key={t.name} className={tag === t.name ? "on" : ""} onClick={() => setTag(tag === t.name ? "" : t.name)}>#{t.name}</button>)}
            </div>
            {searchHits.length > 0 && (
              <div className="notes-search-results">
                {searchHits.slice(0, 12).map((hit) => (
                  <button key={hit.path} onClick={() => void openNote(hit.path)}><b>{hit.title}</b><span>{hit.path}</span><em>{hit.snippet}</em></button>
                ))}
              </div>
            )}
            <div className="notes-tree">
              {folders.map(([folder, items]) => {
                const open = folderOpen[folder] ?? true;
                return (
                  <div className="notes-folder" key={folder || "__root"}>
                    {folder && <button className="notes-folder-head" onClick={() => setFolderOpen((f) => ({ ...f, [folder]: !open }))}>{open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}<span>{folder}</span><em>{items.length}</em></button>}
                    {(open || !folder) && items.map((file) => (
                      <button key={file.path} className={`notes-file ${activeDoc?.path === file.path ? "on" : ""}`} onClick={() => void openNote(file.path)} title={file.path}>
                        <span className="notes-file-dot" /><span className="ellipsis">{file.title}</span>{file.tags.length > 0 && <em>#{file.tags[0]}</em>}
                      </button>
                    ))}
                  </div>
                );
              })}
              {visible.length === 0 && <div className="notes-empty-list">没有匹配的笔记</div>}
            </div>
          </aside>

          <main className="notes-main">
            {graph ? (
              <GraphView data={graphData} loading={graphLoading} onOpen={(path) => { setGraph(false); void openNote(path, "left"); }} />
            ) : (
              <div className={`notes-pane-layout ${split ? "split" : ""}`}>
                {renderPane("left")}
                {split && renderPane("right")}
              </div>
            )}
          </main>

          <aside className="notes-meta">
            {activeDoc ? (
              <>
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Backlinks <em>{activeDoc.backlinks.length}</em></div>
                  {activeDoc.backlinks.length === 0 && <p className="notes-meta-empty">还没有反向链接</p>}
                  {activeDoc.backlinks.map((b) => <button key={`${b.path}-${b.heading}`} className="notes-link" onClick={() => void openNote(b.path, focus)}><b>{b.title}</b>{b.heading && <span># {b.heading}</span>}</button>)}
                </div>
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Outgoing <em>{activeDoc.outgoing.length}</em></div>
                  {activeDoc.outgoing.map((o, i) => <button key={i} className="notes-link" disabled={!o.path} onClick={() => o.path && void openNote(o.path, focus)}><b>[[{o.target}]]</b>{o.heading && <span># {o.heading}</span>}{!o.path && <em>未解析</em>}</button>)}
                </div>
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Linked Todos <em>{linkedTodos.length}</em></div>
                  {linkedTodos.length === 0 && <p className="notes-meta-empty">还没有从这篇笔记创建的任务</p>}
                  {linkedTodos.map((l) => {
                    const todo = state.todos.find((t) => t.id === l.todoId);
                    return <button key={l.id} className="notes-link" disabled={!todo || !onOpenTodo} onClick={() => todo && onOpenTodo?.(todo.id)}><b>{todo?.title || l.title || l.todoId}</b><span>{todo?.key} {todo?.status}</span></button>;
                  })}
                </div>
                {activeDoc.tags.length > 0 && <div className="notes-meta-block"><div className="notes-meta-title">Tags</div><div className="notes-taglist">{activeDoc.tags.map((t) => <button key={t} onClick={() => setTag(t)}>#{t}</button>)}</div></div>}
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Frontmatter</div>
                  {Object.keys(activeDoc.frontmatter || {}).length === 0 ? <p className="notes-meta-empty">无</p> : <div className="notes-frontmatter">{Object.entries(activeDoc.frontmatter).map(([k, v]) => <div key={k}><b>{k}</b><span>{Array.isArray(v) ? v.join(", ") : String(v)}</span></div>)}</div>}
                </div>
              </>
            ) : <p className="notes-meta-empty">打开笔记后显示 backlinks / outgoing / tags。</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function GraphView({ data, loading, onOpen }: { data: GraphData | null; loading: boolean; onOpen: (path: string) => void }) {
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const radius = 38;
    nodes.forEach((node, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
      map.set(node.path, { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius });
    });
    return map;
  }, [nodes]);
  if (loading) return <div className="notes-empty"><div className="notes-empty-mark">◎</div><b>构建图谱…</b></div>;
  if (!nodes.length) return <div className="notes-empty"><div className="notes-empty-mark">◎</div><b>还没有可绘制的链接</b><p>给笔记加上 [[wikilink]] 后再试。</p></div>;
  return (
    <div className="notes-graph">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {edges.map((e, i) => {
          const a = positions.get(e.source); const b = positions.get(e.target);
          return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null;
        })}
        {nodes.map((n) => {
          const p = positions.get(n.path);
          if (!p) return null;
          return (
            <g key={n.path} onClick={() => onOpen(n.path)} className="notes-graph-node">
              <circle cx={p.x} cy={p.y} r={Math.min(3.2, 1.5 + Math.sqrt(n.links) * 0.55)} />
              <text x={p.x} y={p.y - 4.5} textAnchor="middle">{n.title.slice(0, 18)}</text>
            </g>
          );
        })}
      </svg>
      <div className="notes-graph-count">{nodes.length} notes · {edges.length} links</div>
    </div>
  );
}
