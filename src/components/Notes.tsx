import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";
import { renderMarkdown } from "../markdown";
import { ChevronDownIcon, ChevronRightIcon, FolderOpenIcon, RefreshIcon, SearchIcon } from "./Icons";
import { NotesEditor } from "./NotesEditor";

type Act = (type: string, payload?: unknown) => Promise<any>;
const PLUGIN_ID = "ai.cockpit.notes";

type PageSummary = {
  id: string; slug: string; title: string; summary: string;
  status: "draft" | "reviewed" | "stale"; confidence: "low" | "medium" | "high";
  updatedAt: number; citations: number; backlinks: number;
};
type Citation = { id: string; pageId: string; sourceId: string; quote?: string; locator?: string; source?: Source };
type Page = Omit<PageSummary, "citations" | "backlinks"> & { content: string; citations: Citation[]; backlinks: PageSummary[] };
type Source = { id: string; title: string; kind: string; uri?: string; createdAt: number; citations: number; content?: string };
type VaultFile = { path: string; title: string; folder: string; mtime: number; size: number };
type VaultInfo = { path: string; files: VaultFile[]; indexedAt?: number; error?: string };
type GraphData = { nodes: { id: string; title: string; kind: "page" | "source"; links: number }[]; edges: { source: string; target: string; kind: string }[] };
type Doc = Page & { dirty: boolean; local?: boolean; localPath?: string; mtime?: number };
type Pane = { tabs: string[]; active: string | null };
type Tab = "pages" | "sources" | "review" | "vault";
type SourceDraft = { title: string; content: string; url: string; mode: "text" | "url" };
type MemoryData = { markdown: string; pageCount: number; chars: number };

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
  const [vault, setVault] = useState<VaultInfo>({ path: "", files: [] });
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
  const [memory, setMemory] = useState<MemoryData | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [layoutReady, setLayoutReady] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  const invoke = useCallback((method: string, args: Record<string, unknown> = {}) => act("pluginInvoke", { pluginId: PLUGIN_ID, method, args }), [act]);
  // 顶部提示 4s 后自动消失（错误保留，方便排查）
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
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
      try { setMemory(await invoke("wiki.memory", { maxChars: 12000 })); } catch { /* memory is optional */ }
      setError("");
    } catch (err) { fail(err); }
  }, [enabled, invoke]);

  const refreshVault = useCallback(async () => {
    if (!enabled) return;
    try {
      const info = await invoke("wiki.vault.get");
      if (info) setVault({ path: info.path || "", files: Array.isArray(info.files) ? info.files : [], indexedAt: info.indexedAt, error: info.error || "" });
    } catch (err) { fail(err); }
  }, [enabled, invoke]);

  useEffect(() => { void refresh(); void refreshVault(); }, [refresh, refreshVault]);

  const loadPage = useCallback(async (pageId: string) => {
    const existing = docs[pageId];
    if (existing) return existing;
    const page = await invoke("wiki.getPage", { id: pageId });
    if (!page) return null;
    const doc: Doc = { ...page, dirty: false };
    setDocs((current) => ({ ...current, [pageId]: doc }));
    return doc;
  }, [docs, invoke]);

  const loadVaultFile = useCallback(async (relPath: string) => {
    const docId = `vault:${relPath}`;
    const existing = docs[docId];
    if (existing) return existing;
    const file = await invoke("wiki.vault.file", { path: relPath });
    if (!file) return null;
    const doc: Doc = {
      id: docId, slug: "", title: file.title, summary: "", content: file.content,
      status: "draft", confidence: "medium", updatedAt: file.mtime || Date.now(),
      citations: [], backlinks: [], dirty: false, local: true, localPath: file.path, mtime: file.mtime,
    };
    setDocs((current) => ({ ...current, [docId]: doc }));
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

  const openVaultFile = useCallback(async (relPath: string, target: "left" | "right" = focus) => {
    const where = split ? target : "left";
    setGraph(false);
    const doc = await loadVaultFile(relPath);
    if (!doc) return;
    setPane(where, (p) => ({ tabs: p.tabs.includes(doc.id) ? p.tabs : [...p.tabs, doc.id], active: doc.id }));
    setFocus(where);
    setMode("preview");
    setTab("vault");
  }, [focus, loadVaultFile, split]);

  const openDoc = useCallback((docId: string, target: "left" | "right" = focus) => {
    if (docId.startsWith("vault:")) void openVaultFile(docId.slice(6), target);
    else void openPage(docId, target);
  }, [focus, openPage, openVaultFile]);

  useEffect(() => {
    if (!openRequest?.path) return;
    if (openRequest.path.startsWith("vault:")) void openVaultFile(openRequest.path.slice(6), "left");
    else void openPage(openRequest.path, "left");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n, openRequest?.path, openPage, openVaultFile]);

  // Restore tabs/layout from the wiki store.
  useEffect(() => {
    if (!enabled || layoutReady) return;
    (async () => {
      try {
        const layout = await invoke("wiki.layout.get");
        if (layout && typeof layout === "object") {
          const leftTabs = (layout.left?.tabs || []).filter((x: unknown) => typeof x === "string");
          const rightTabs = (layout.right?.tabs || []).filter((x: unknown) => typeof x === "string");
          for (const docId of [...new Set([...leftTabs, ...rightTabs])]) {
            if (docId.startsWith("vault:")) await loadVaultFile(docId.slice(6));
            else await loadPage(docId);
          }
          setLeft({ tabs: leftTabs, active: layout.left?.active || leftTabs[0] || null });
          setRight({ tabs: rightTabs, active: layout.right?.active || rightTabs[0] || null });
          setSplit(Boolean(layout.split));
          setSplitRatio(Number(layout.ratio) >= 0.2 && Number(layout.ratio) <= 0.8 ? Number(layout.ratio) : 0.5);
          setFocus(layout.focus === "right" ? "right" : "left");
        }
      } catch { /* optional */ }
      setLayoutReady(true);
    })();
  }, [enabled, layoutReady, invoke, loadPage, loadVaultFile]);

  useEffect(() => {
    if (!layoutReady) return;
    const timer = window.setTimeout(() => { void invoke("wiki.layout.set", { layout: { left, right, split, ratio: splitRatio, focus } }).catch(() => {}); }, 500);
    return () => window.clearTimeout(timer);
  }, [layoutReady, left, right, split, splitRatio, focus, invoke]);

  const updateDoc = (pageId: string, content: string) => {
    setDocs((current) => current[pageId] ? { ...current, [pageId]: { ...current[pageId], content, dirty: true } } : current);
    setNotice("");
  };

  const updateMeta = (pageId: string, patch: Partial<Pick<Doc, "title" | "summary">>) => {
    setDocs((current) => current[pageId] ? { ...current, [pageId]: { ...current[pageId], ...patch, dirty: true } } : current);
    setNotice("");
  };

  const saveDoc = useCallback(async (pageId: string) => {
    const doc = docs[pageId];
    if (!doc || !doc.dirty) return;
    setBusy(true);
    try {
      if (doc.local && doc.localPath) {
        const res = await invoke("wiki.vault.save", { path: doc.localPath, content: doc.content, mtime: doc.mtime });
        if (res) {
          setDocs((current) => ({ ...current, [pageId]: { ...current[pageId], title: res.title || current[pageId].title, content: res.content ?? current[pageId].content, mtime: res.mtime, dirty: false } }));
          setVault((current) => ({ ...current, files: current.files.map((f) => f.path === doc.localPath ? { ...f, title: res.title || f.title, mtime: res.mtime || f.mtime } : f) }));
        }
        setNotice("已写回本地文件");
      } else {
        const res = await invoke("wiki.savePage", { id: pageId, content: doc.content, title: doc.title, summary: doc.summary });
        if (res) setDocs((current) => ({ ...current, [pageId]: { ...res, dirty: false } }));
        setNotice("已保存 draft");
        await refresh();
      }
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

  // Electron 不支持 window.prompt：直接建「无标题页面」，打开后标题就是可编辑输入框
  const createPage = async () => {
    setBusy(true);
    try {
      const page = await invoke("wiki.createPage", { title: uniqueUntitled() });
      if (page) {
        setDocs((current) => ({ ...current, [page.id]: { ...page, dirty: false } }));
        setLeft((p) => ({ tabs: p.tabs.includes(page.id) ? p.tabs : [...p.tabs, page.id], active: page.id }));
        setFocus("left"); setTab("pages"); setMode("edit");
        await refresh();
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(".notes-title-input");
          input?.focus(); input?.select();
        }, 120);
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  /** 未命名页面：Untitled / Untitled 2 / …，避免撞名 */
  const uniqueUntitled = () => {
    const used = new Set(pages.map((p) => p.title));
    if (!used.has("Untitled")) return "Untitled";
    let i = 2;
    while (used.has(`Untitled ${i}`)) i += 1;
    return `Untitled ${i}`;
  };

  const reviewPage = async (pageId: string, decision: "accept" | "reject") => {
    setBusy(true);
    try {
      const feedback = ""; // 不弹 prompt（Electron 不支持）；退回原因可在页面里写
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

  const pickLocalFolder = async () => {
    setBusy(true);
    try {
      const info = await invoke("wiki.vault.pick");
      if (info) {
        setVault({ path: info.path || "", files: Array.isArray(info.files) ? info.files : [], indexedAt: info.indexedAt, error: info.error || "" });
        setTab("vault");
        setNotice(info.error || `已打开本地目录 · ${info.files?.length || 0} 个 Markdown`);
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const revealLocalFile = async (doc: Doc) => {
    if (!doc.localPath) return;
    try { await invoke("wiki.vault.reveal", { path: doc.localPath }); } catch (err) { fail(err); }
  };

  const importLocalSource = async (file: VaultFile | Doc) => {
    const relPath = "path" in file ? file.path : file.localPath;
    if (!relPath) return;
    setBusy(true);
    try {
      const source = await invoke("wiki.vault.importSource", { path: relPath });
      if (source) { setTab("sources"); await refresh(); setNotice(`已导入 source · ${source.title}`); }
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

  const openMemory = async () => {
    setGraph(false);
    setMemoryOpen(true);
    try { setMemory(await invoke("wiki.memory", { maxChars: 12000 })); } catch (err) { fail(err); }
  };

  const dream = async () => {
    setBusy(true);
    try {
      const res = await invoke("wiki.dream");
      if (res) {
        const issues = Array.isArray(res.issues) ? res.issues : [];
        setMemory(res.memory || memory);
        setNotice(issues.length ? `Dream 发现 ${issues.length} 个维护项（见通知/页面）` : "Dream 未发现明显问题");
        if (issues.length) setSourceDraft(null);
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const openGraph = async () => {
    setGraph(true); setGraphLoading(true);
    try { setGraphData((await invoke("wiki.graph")) || { nodes: [], edges: [] }); } catch (err) { fail(err); } finally { setGraphLoading(false); }
  };

  const filteredSources = useMemo(() => sources.filter((s) => !query || `${s.title} ${s.uri || ""}`.toLowerCase().includes(query.toLowerCase())), [sources, query]);
  const filteredPages = useMemo(() => pages.filter((p) => !query || `${p.title} ${p.summary}`.toLowerCase().includes(query.toLowerCase())), [pages, query]);
  const filteredVaultFiles = useMemo(() => vault.files.filter((f) => !query || `${f.title} ${f.path}`.toLowerCase().includes(query.toLowerCase())), [vault.files, query]);
  const vaultGroups = useMemo(() => {
    const groups = new Map<string, VaultFile[]>();
    for (const file of filteredVaultFiles) {
      const folder = file.folder || "";
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder)!.push(file);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredVaultFiles]);

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
          <div className="notes-hub">
            <div className="notes-hub-mark">✦</div>
            <h2>从这里开始</h2>
            <p className="notes-hub-sub">页面是整理后的知识；资料是原始输入；本地目录可以直接编辑 Markdown 并写回磁盘。</p>
            <div className="notes-hub-cards">
              <button className="notes-hub-card" onClick={() => void createPage()} disabled={busy}>
                <span className="notes-hub-ico">＋</span>
                <b>新建页面</b>
                <em>空白 Markdown，先写再整理</em>
              </button>
              <button className="notes-hub-card" onClick={() => setSourceDraft({ title: "", content: "", url: "", mode: "text" })} disabled={busy}>
                <span className="notes-hub-ico">▤</span>
                <b>导入资料</b>
                <em>粘贴文本 / Markdown / URL</em>
              </button>
              <button className="notes-hub-card" onClick={() => void pickLocalFolder()} disabled={busy}>
                <span className="notes-hub-ico">⌸</span>
                <b>打开本地目录</b>
                <em>编辑仓库里的 .md 并写回</em>
              </button>
            </div>
            <div className="notes-hub-tip">快捷键：⌘S 保存 · ⌘Enter 提交（编辑器内）</div>
          </div>
        ) : (
          <>
            <div className="notes-note-head">
              <div className="notes-note-title">
                {doc.local
                  ? <b>{doc.title}</b>
                  : mode === "edit"
                    ? <input
                        className="notes-title-input"
                        value={doc.title}
                        placeholder="页面标题"
                        onChange={(e) => updateMeta(doc.id, { title: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      />
                    : <b>{doc.title}</b>}
                <span className="mono">{doc.local ? `${doc.localPath || ""}${doc.dirty ? " · 未保存" : ""}` : `${statusLabel(doc.status)} · ${doc.citations.length} citations${doc.dirty ? " · 未保存" : ""}`}</span>
              </div>
              <div className="notes-doc-actions">
                <div className="notes-mode"><button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>阅读</button><button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>编辑</button></div>
                {doc.dirty && <button className="btn tiny-btn primary" onClick={() => void saveDoc(doc.id)} disabled={busy}>{doc.local ? "保存到文件" : "保存 draft"}</button>}
                {doc.local ? (
                  <>
                    <button className="link tiny" onClick={() => void importLocalSource(doc)} disabled={busy}>导入为 Source</button>
                    <button className="link tiny" onClick={() => void revealLocalFile(doc)}>Finder</button>
                  </>
                ) : (
                  <>
                    {doc.status === "draft" && <button className="btn tiny-btn ok" onClick={() => void reviewPage(doc.id, "accept")} disabled={busy}>接受</button>}
                    {doc.status === "draft" && <button className="link tiny" onClick={() => void reviewPage(doc.id, "reject")} disabled={busy}>退回</button>}
                    <button className="link tiny" onClick={() => void createTask()} disabled={busy}>创建任务</button>
                  </>
                )}
                <button className="link tiny" onClick={sendPageToChat}>发送到 Chat</button>
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
                  const target = pages.find((p) => p.title === title || p.slug === title || p.id === title)
                    || vault.files.find((f) => f.title === title || f.path.replace(/\.md$/i, "").endsWith(title));
                  if (target) {
                    if ("path" in target) void openVaultFile(target.path, which);
                    else void openPage(target.id, which);
                  }
                }
              }} />
            ) : (
              <NotesEditor key={doc.id} value={doc.content} pages={[...pages.map((p) => ({ path: p.id, title: p.title })), ...vault.files.map((f) => ({ path: `vault:${f.path}`, title: f.title }))]} tags={[]} dirty={doc.dirty} onChange={(value) => updateDoc(doc.id, value)} onSave={() => void saveDoc(doc.id)} />
            )}
          </>
        )}
      </section>
    );
  };

  return (
    <div className="notes-page">
      <header className="notes-head">
        <div className="notes-head-main">
          <span className="notes-kicker">NATIVE · LLM WIKI</span>
          <h1>Wiki</h1>
          <div className="notes-stats">
            <span><b>{pages.length}</b> 页面</span>
            <span><b>{sources.length}</b> 资料</span>
            <span className={reviews.length ? "warn" : ""}><b>{reviews.length}</b> 待审核</span>
            {vault.path && <span><b>{vault.files.length}</b> 本地文件</span>}
          </div>
        </div>
        <div className="notes-actions">
          <button className="btn primary" onClick={() => void createPage()} disabled={busy}>＋ 新建页面</button>
          <button className="btn" onClick={() => { setSourceDraft({ title: "", content: "", url: "", mode: "text" }); }} disabled={busy}>导入资料</button>
          <button className="btn" onClick={() => void pickLocalFolder()} disabled={busy} title={vault.path ? "更换本地目录" : "打开本地 Markdown 目录"}><FolderOpenIcon size={13} /> {vault.path ? "本地目录" : "打开目录"}</button>
          <div className="notes-actions-sep" />
          <button className={`btn tiny-btn ${memoryOpen ? "primary" : ""}`} onClick={() => { setGraph(false); void openMemory(); }}>记忆</button>
          <button className={`btn tiny-btn ${split ? "primary" : ""}`} onClick={toggleSplit}>分屏</button>
          <button className={`btn tiny-btn ${graph ? "primary" : ""}`} onClick={() => { setMemoryOpen(false); graph ? setGraph(false) : void openGraph(); }}>图谱</button>
          <button className="icon-btn" onClick={() => void refresh()} title="刷新"><RefreshIcon size={13} /></button>
        </div>
      </header>
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }} aria-label="关闭提示">×</button>
        </div>
      )}
      <div className="notes-layout">
        <aside className="notes-sidebar">
          <div className="notes-wiki-tabs">
            <button className={tab === "pages" ? "on" : ""} onClick={() => setTab("pages")}>页面 <em>{pages.length}</em></button>
            <button className={tab === "sources" ? "on" : ""} onClick={() => setTab("sources")}>资料 <em>{sources.length}</em></button>
            <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>审核 <em>{reviews.length}</em></button>
            <button className={tab === "vault" ? "on" : ""} onClick={() => setTab("vault")}>本地 <em>{vault.files.length}</em></button>
          </div>
          <div className="notes-search-wrap">
            <SearchIcon size={12} className="notes-search-icon" />
            <input className="notes-search" value={query} onChange={(e) => void search(e.target.value)} placeholder="搜索页面 / 资料 / 本地" />
          </div>
          {searchHits.length > 0 && <div className="notes-search-results">{searchHits.slice(0, 12).map((hit) => <button key={hit.id} onClick={() => hit.kind === "page" ? void openPage(hit.id) : void openSource(hit.id)}><b>{hit.title}</b><span>{hit.kind}</span><em>{hit.snippet}</em></button>)}</div>}
          <div className="notes-tree">
            {tab === "pages" && filteredPages.map((p) => <button key={p.id} className={`notes-file ${activeDoc?.id === p.id ? "on" : ""}`} onClick={() => void openPage(p.id)}><span className={`notes-status-dot ${p.status}`} /><span className="ellipsis">{p.title}</span><em>{p.status === "draft" ? "draft" : p.status === "stale" ? "stale" : ""}</em></button>)}
            {tab === "sources" && filteredSources.map((s) => <button key={s.id} className="notes-file" onClick={() => void openSource(s.id)}><span className="notes-source-icon">▤</span><span className="ellipsis">{s.title}</span><em>{s.citations || 0}</em></button>)}
            {tab === "review" && reviews.map((p) => <button key={p.id} className="notes-file" onClick={() => void openPage(p.id)}><span className={`notes-status-dot ${p.status}`} /><span className="ellipsis">{p.title}</span><em>draft</em></button>)}
            {tab === "vault" && vault.path && (
              <>
                <div className="notes-sidebar-head"><span className="ellipsis" title={vault.path}>{vault.path.split(/[\\/]/).pop() || vault.path}</span><span><button onClick={() => void refreshVault()}>刷新</button><button onClick={() => void pickLocalFolder()}>更换</button></span></div>
                {vault.error && <div className="notes-empty-list">{vault.error}</div>}
                {vaultGroups.map(([folder, files]) => (
                  <div key={folder || "__root"} className="notes-vault-group">
                    <div className="notes-folder-label">{folder || "根目录"} <em>{files.length}</em></div>
                    {files.map((f) => <button key={f.path} className={`notes-file ${activeDoc?.local && activeDoc.localPath === f.path ? "on" : ""}`} title={f.path} onClick={() => void openVaultFile(f.path)}><span className="notes-source-icon">▤</span><span className="ellipsis">{f.title}</span></button>)}
                  </div>
                ))}
                {filteredVaultFiles.length === 0 && !vault.error && <div className="notes-empty-list">{query ? "没有匹配的本地文件。" : "目录里还没有 Markdown 文件。"}</div>}
              </>
            )}
            {tab === "vault" && !vault.path && (
              <div className="notes-vault-empty">
                <p>打开本地 Markdown 目录，直接编辑并写回磁盘；也可以导入为 Source。</p>
                <button className="btn primary" onClick={() => void pickLocalFolder()} disabled={busy}>打开目录</button>
              </div>
            )}
            {tab === "pages" && filteredPages.length === 0 && <div className="notes-empty-list">还没有页面。创建一个，或导入 source。</div>}
            {tab === "sources" && filteredSources.length === 0 && <div className="notes-empty-list">还没有资料。导入文本或 URL。</div>}
            {tab === "review" && reviews.length === 0 && <div className="notes-empty-list">没有待审核 draft。</div>}
          </div>
          {tab === "sources" && log.length > 0 && <div className="notes-log">{log.slice(0, 5).map((l) => <div key={l.id}>{l.text}</div>)}</div>}
        </aside>

        <main className="notes-main">
          {memoryOpen ? (
            <div className="notes-memory">
              <div className="notes-memory-head"><b>Memory</b><span>{memory?.pageCount || 0} pages · {memory?.chars || 0} chars</span><button className="btn tiny-btn" onClick={() => void dream()} disabled={busy}>Dream</button></div>
              <div className="notes-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiMarkdown(memory?.markdown || "还没有 Memory 索引。")) }} onClick={(e) => {
                const anchor = (e.target as HTMLElement).closest("a");
                const href = anchor?.getAttribute("href") || "";
                if (!href.startsWith("#wiki/")) return;
                e.preventDefault();
                const title = decodeURIComponent(href.slice(6)).split("#")[0];
                const target = pages.find((p) => p.title === title || p.slug === title || p.id === title);
                if (target) { setMemoryOpen(false); void openPage(target.id, "left"); }
              }} />
            </div>
          ) : graph ? <GraphView data={graphData} loading={graphLoading} onOpen={(id) => { setGraph(false); void openPage(id, "left"); }} /> : (
            <div className={`notes-pane-layout ${split ? "split" : ""}`} ref={mainRef as React.RefObject<HTMLDivElement>} style={split ? { gridTemplateColumns: `${splitRatio * 100}% 5px minmax(0,1fr)` } : undefined}>
              {renderPane("left")}
              {split && <div className="notes-split-gutter" onPointerDown={startSplitDrag} />}
              {split && renderPane("right")}
            </div>
          )}
        </main>

        <aside className="notes-meta">
          {activeDoc?.local ? (
            <>
              <div className="notes-meta-block"><div className="notes-meta-title">本地文件</div><div className="notes-review-badge local">Markdown</div><p className="notes-meta-empty">{activeDoc.localPath}</p>{activeDoc.mtime && <p className="notes-meta-empty">修改于 {new Date(activeDoc.mtime).toLocaleString()}</p>}</div>
              <div className="notes-meta-block">
                <div className="notes-meta-title">操作</div>
                <button className="notes-link" onClick={() => void importLocalSource(activeDoc)} disabled={busy}><b>导入为 Source</b><span>让 Curator 基于此文件整理 Wiki</span></button>
                <button className="notes-link" onClick={() => void revealLocalFile(activeDoc)}><b>在 Finder 显示</b><span>打开文件所在位置</span></button>
                <button className="notes-link" onClick={() => void refreshVault()}><b>刷新目录</b><span>重新扫描本地 Markdown</span></button>
              </div>
              <div className="notes-meta-block"><div className="notes-meta-title">目录</div><p className="notes-meta-empty">{vault.path || activeDoc.localPath}</p><button className="notes-link" onClick={() => void pickLocalFolder()} disabled={busy}><b>更换目录</b></button></div>
            </>
          ) : activeDoc ? (
            <>
              <div className="notes-meta-block">
                <div className="notes-meta-title">页面</div>
                <p className="notes-meta-empty">
                  {String(activeDoc.content || "").replace(/\s+/g, " ").trim().length} 字
                  {activeDoc.updatedAt ? ` · 更新于 ${new Date(activeDoc.updatedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                </p>
              </div>
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
          ) : (
            <div className="notes-meta-idle">
              <div className="notes-meta-title">详情</div>
              <div className="notes-meta-idle-row"><span className="notes-status-dot draft" /><div><b>引用来源</b><em>页面引用了哪些资料</em></div></div>
              <div className="notes-meta-idle-row"><span className="notes-status-dot reviewed" /><div><b>反向链接</b><em>哪些页面提到它</em></div></div>
              <div className="notes-meta-idle-row"><span className="notes-status-dot stale" /><div><b>关联任务</b><em>链到 TODO LIST 里的条目</em></div></div>
              <p className="notes-meta-empty">打开一个页面后，这里会显示上面三项。</p>
            </div>
          )}
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
