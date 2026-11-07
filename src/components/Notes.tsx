import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";
import { renderMarkdown } from "../markdown";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "./Icons";
import { NotesEditor } from "./NotesEditor";

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
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [layoutReady, setLayoutReady] = useState(false);
  const [focus, setFocus] = useState<"left" | "right">("left");
  const mainRef = useRef<HTMLElement | null>(null);
  const restoredVault = useRef("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [graph, setGraph] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string; kind: "file" | "folder" } | null>(null);

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

  useEffect(() => {
    if (!enabled || !status?.vaultPath || restoredVault.current === status.vaultPath) return;
    restoredVault.current = status.vaultPath;
    setLayoutReady(false);
    (async () => {
      try {
        const layout = await invoke("notes.layout.get");
        if (layout && typeof layout === "object") {
          const leftLayout = layout.left || {};
          const rightLayout = layout.right || {};
          const paths = [...new Set([...(leftLayout.tabs || []), ...(rightLayout.tabs || [])])].filter((p: unknown) => typeof p === "string");
          for (const path of paths) await loadDoc(path);
          const valid = (p: string) => docs[p] || paths.includes(p);
          setLeft({ tabs: (leftLayout.tabs || []).filter(valid), active: valid(leftLayout.active) ? leftLayout.active : null });
          setRight({ tabs: (rightLayout.tabs || []).filter(valid), active: valid(rightLayout.active) ? rightLayout.active : null });
          setSplit(Boolean(layout.split));
          setSplitRatio(Number(layout.ratio) >= 0.2 && Number(layout.ratio) <= 0.8 ? Number(layout.ratio) : 0.5);
          setFocus(layout.focus === "right" ? "right" : "left");
        }
      } catch { /* layout is optional */ }
      setLayoutReady(true);
    })();
  }, [enabled, status?.vaultPath, invoke, loadDoc]);

  useEffect(() => {
    if (!layoutReady || !status?.vaultPath) return;
    const timer = window.setTimeout(() => {
      void invoke("notes.layout.set", { layout: { left, right, split, ratio: splitRatio, focus } }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [layoutReady, status?.vaultPath, left, right, split, splitRatio, focus, invoke]);

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

  const forgetPath = (path: string) => {
    const matches = (p: string) => p === path || p.startsWith(`${path}/`);
    setLeft((p) => {
      const tabs = p.tabs.filter((x) => !matches(x));
      return { tabs, active: p.active && matches(p.active) ? (tabs[0] ?? null) : p.active };
    });
    setRight((p) => {
      const tabs = p.tabs.filter((x) => !matches(x));
      return { tabs, active: p.active && matches(p.active) ? (tabs[0] ?? null) : p.active };
    });
    setDocs((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) if (matches(key)) delete next[key];
      return next;
    });
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

  const createFolder = async () => {
    const name = window.prompt("新建文件夹（可包含子目录）", "notes");
    if (!name) return;
    setBusy(true);
    try { await invoke("notes.mkdir", { path: name }); await refreshList(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const renamePath = async (path: string, isFolder: boolean) => {
    setCtxMenu(null);
    const current = isFolder ? path : path.split("/").pop() || path;
    const next = window.prompt("重命名", current);
    if (!next || next === current) return;
    const parent = isFolder ? path.split("/").slice(0, -1).join("/") : path.split("/").slice(0, -1).join("/");
    const target = parent ? `${parent}/${next}` : next;
    setBusy(true);
    try {
      const res = await invoke("notes.rename", { from: path, to: target });
      if (res?.to) {
        if (isFolder) { forgetPath(path); }
        else { forgetPath(path); await loadDoc(res.to); await openNote(res.to); }
        await refreshList();
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const trashPath = async (path: string, isFolder: boolean) => {
    setCtxMenu(null);
    if (!window.confirm(`删除${isFolder ? "文件夹" : "笔记"}「${path}」？会移动到 vault/.trash。`)) return;
    setBusy(true);
    try { await invoke("notes.trash", { path }); forgetPath(path); await refreshList(); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const revealPath = async (path: string) => {
    setCtxMenu(null);
    try { await invoke("notes.reveal", { path }); } catch (err) { fail(err); }
  };

  const copyPath = async (path: string) => {
    setCtxMenu(null);
    try { await window.harness.clipboardWrite(path); setNotice("已复制路径"); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("mousedown", close, true);
    return () => window.removeEventListener("mousedown", close, true);
  }, [ctxMenu]);

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
              <NotesEditor
                key={doc.path}
                value={doc.content}
                pages={files.map((f) => ({ path: f.path, title: f.title }))}
                tags={tags.map((t) => t.name)}
                onChange={(value) => updateDoc(doc.path, value)}
                onSave={() => void saveDoc(doc.path)}
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
            <div className="notes-sidebar-head"><span>VAULT</span><button onClick={() => void createFolder()} title="新建文件夹">＋ 文件夹</button></div>
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
                    {folder && <button className="notes-folder-head" onClick={() => setFolderOpen((f) => ({ ...f, [folder]: !open }))} onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, path: folder, kind: "folder" }); }}>{open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}<span>{folder}</span><em>{items.length}</em></button>}
                    {(open || !folder) && items.map((file) => (
                      <button key={file.path} className={`notes-file ${activeDoc?.path === file.path ? "on" : ""}`} onClick={() => void openNote(file.path)} title={file.path} onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, path: file.path, kind: "file" }); }}>
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
              <div
                className={`notes-pane-layout ${split ? "split" : ""}`}
                ref={mainRef as React.RefObject<HTMLDivElement>}
                style={split ? { gridTemplateColumns: `${splitRatio * 100}% 5px minmax(0,1fr)` } : undefined}
              >
                {renderPane("left")}
                {split && <div className="notes-split-gutter" onPointerDown={startSplitDrag} title="拖动调整分屏比例" />}
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
      {ctxMenu && (
        <div className="notes-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => void renamePath(ctxMenu.path, ctxMenu.kind === "folder")}>重命名</button>
          <button onClick={() => void revealPath(ctxMenu.path)}>在 Finder 中显示</button>
          <button onClick={() => void copyPath(ctxMenu.path)}>复制路径</button>
          <button className="danger" onClick={() => void trashPath(ctxMenu.path, ctxMenu.kind === "folder")}>删除</button>
        </div>
      )}
    </div>
  );
}

function GraphView({ data, loading, onOpen }: { data: GraphData | null; loading: boolean; onOpen: (path: string) => void }) {
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const positions = useMemo(() => {
    // Small deterministic force layout: enough to avoid the "circle of nodes"
    // look without shipping a graph physics dependency in the plugin UI.
    const cap = nodes.slice(0, 280);
    const index = new Map(cap.map((n, i) => [n.path, i]));
    const points = cap.map((_, i) => {
      const angle = (i / Math.max(1, cap.length)) * Math.PI * 2;
      return { x: 50 + Math.cos(angle) * 26, y: 50 + Math.sin(angle) * 26 };
    });
    const links = edges.filter((e) => index.has(e.source) && index.has(e.target)).slice(0, 1200);
    for (let step = 0; step < 80; step++) {
      const fx = new Array(cap.length).fill(0);
      const fy = new Array(cap.length).fill(0);
      for (let i = 0; i < cap.length; i++) {
        for (let j = i + 1; j < cap.length; j++) {
          let dx = points[i].x - points[j].x; let dy = points[i].y - points[j].y;
          const d2 = dx * dx + dy * dy + 0.01;
          if (d2 > 500) continue;
          const f = 3.2 / d2;
          dx *= f; dy *= f;
          fx[i] += dx; fy[i] += dy; fx[j] -= dx; fy[j] -= dy;
        }
      }
      for (const e of links) {
        const a = index.get(e.source)!; const b = index.get(e.target)!;
        const dx = points[b].x - points[a].x; const dy = points[b].y - points[a].y;
        const f = 0.018;
        fx[a] += dx * f; fy[a] += dy * f; fx[b] -= dx * f; fy[b] -= dy * f;
      }
      for (let i = 0; i < cap.length; i++) {
        fx[i] += (50 - points[i].x) * 0.008;
        fy[i] += (50 - points[i].y) * 0.008;
        points[i].x = Math.max(6, Math.min(94, points[i].x + fx[i]));
        points[i].y = Math.max(6, Math.min(94, points[i].y + fy[i]));
      }
    }
    return new Map(cap.map((n, i) => [n.path, points[i]]));
  }, [nodes, edges]);
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
