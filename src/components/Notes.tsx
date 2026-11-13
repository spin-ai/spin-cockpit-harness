import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";
import { renderMarkdown } from "../markdown";
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon, FolderOpenIcon, RefreshIcon, SearchIcon, SparkleIcon } from "./Icons";
import { NotesEditor } from "./NotesEditor";
import { Knowledge } from "./Knowledge";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";

type Act = (type: string, payload?: unknown) => Promise<any>;
const PLUGIN_ID = "ai.cockpit.notes";

type PageSummary = {
  id: string; slug: string; title: string; summary: string;
  status: "draft" | "reviewed" | "stale"; confidence: "low" | "medium" | "high";
  updatedAt: number; citations: number; backlinks: number; snippet?: string;
};
type Citation = { id: string; pageId: string; sourceId: string; quote?: string; locator?: string; source?: Source };
type Page = Omit<PageSummary, "citations" | "backlinks"> & { content: string; citations: Citation[]; backlinks: PageSummary[] };
type Source = { id: string; title: string; kind: string; uri?: string; createdAt: number; citations: number; content?: string };
type VaultFile = { path: string; title: string; folder: string; mtime: number; size: number };
type VaultInfo = { path: string; files: VaultFile[]; indexedAt?: number; error?: string };
type GraphData = { nodes: { id: string; title: string; kind: "page" | "source" | "file"; links: number }[]; edges: { source: string; target: string; kind: string }[] };
type Doc = Page & { dirty: boolean; local?: boolean; localPath?: string; mtime?: number };
type Pane = { tabs: string[]; active: string | null };
type Tab = "pages" | "sources" | "docs" | "review" | "vault" | "trash";
type SourceDraft = { title: string; content: string; url: string; mode: "text" | "url" | "file" };
type MemoryData = { markdown: string; pageCount: number; chars: number };
type TrashItem = { id: string; kind: "page" | "source"; title: string; deletedAt: number };
type SearchHit = { kind: string; id: string; title: string; status?: string; at?: number; snippet: string };

function emptyPane(): Pane { return { tabs: [], active: null }; }
function statusLabel(status: string) { return status === "reviewed" ? "已审核" : status === "stale" ? "已过期" : "草稿"; }
function confidenceLabel(level?: string) { return level === "high" ? "高" : level === "low" ? "低" : "中"; }

/** 相对时间：列表第二行用，避免一列绝对时间戳比标题还长 */
function timeAgo(at?: number) {
  if (!at) return "";
  const diff = Date.now() - at;
  const min = Math.round(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(at).toLocaleDateString([], { month: "numeric", day: "numeric" });
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function markText(text: string, query: string) {
  const q = String(query || "").trim();
  if (!q) return text;
  const parts = String(text || "").split(new RegExp(`(${escapeRegExp(q)})`, "ig"));
  return parts.map((part, i) => i % 2 ? <mark key={i}>{part}</mark> : part);
}

function wikiMarkdown(text: string) {
  return String(text || "").replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_m, target: string, heading: string, alias: string) => {
    const label = alias || (heading ? `${target}#${heading}` : target);
    return `[${label}](#wiki/${encodeURIComponent(target.trim())})`;
  }).replace(/(^|\s)#([\p{L}\p{N}_-]{1,40})/gu, "$1[#$2](#tag/$2)");
}

export function Notes({ state, act, onOpenTodo, openRequest, initialTab }: {
  state: State; act: Act; onOpenTodo?: (id: string) => void; openRequest?: { path: string; n: number } | null;
  /** 从「资料（知识库 → 文档）」入口进来时直接打开对应 tab */
  initialTab?: Tab;
}) {
  const plugin = (state.plugins || []).find((p) => p.id === PLUGIN_ID);
  const enabled = Boolean(plugin?.enabled);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [reviews, setReviews] = useState<PageSummary[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<{ id: string; at: number }[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [log, setLog] = useState<{ id: string; kind: string; text: string; at: number }[]>([]);
  const [vault, setVault] = useState<VaultInfo>({ path: "", files: [] });
  const [tab, setTab] = useState<Tab>(initialTab || "pages");
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchStatus, setSearchStatus] = useState("all");
  const [searchKind, setSearchKind] = useState("all");
  const [searchTime, setSearchTime] = useState("all");
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("cmh.wiki.searchHistory") || "[]").slice(0, 8); } catch { return []; }
  });
  const [tagFilter, setTagFilter] = useState("");
  const [tagPages, setTagPages] = useState<PageSummary[]>([]);
  const [highlightQuery, setHighlightQuery] = useState("");
  const [unlinked, setUnlinked] = useState<PageSummary[]>([]);
  const [linkHover, setLinkHover] = useState<{ title: string; summary: string; status: string; x: number; y: number } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<{ found: boolean; answer: string; citations: { id: string; title: string }[] } | null>(null);
  const [askLoading, setAskLoading] = useState(false);
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

  // 全局快捷键进来时：预填剪贴板；不覆盖用户正在写的草稿
  useEffect(() => {
    const onQuick = async () => {
      let text = "";
      try { text = await window.harness.clipboardRead(); } catch { /* 剪贴板不可用 */ }
      setQuickText((cur) => cur || text);
      setQuickOpen(true);
    };
    window.addEventListener("harness:quick-capture", onQuick);
    // 从「资料」页点页面命中：带着 id 直接打开
    const onOpenPage = (evt: Event) => {
      const id = (evt as CustomEvent).detail;
      if (typeof id === "string" && id) void openPage(id);
    };
    window.addEventListener("harness:open-wiki-page", onOpenPage);
    return () => window.removeEventListener("harness:quick-capture", onQuick);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await invoke("wiki.list");
      if (!res) return;
      setPages(Array.isArray(res.pages) ? res.pages : []);
      setSources(Array.isArray(res.sources) ? res.sources : []);
      setReviews(Array.isArray(res.reviews) ? res.reviews : []);
      setTrash(Array.isArray(res.trash) ? res.trash : []);
      setPins(Array.isArray(res.pins) ? res.pins : []);
      setRecents(Array.isArray(res.recents) ? res.recents : []);
      setLog(Array.isArray(res.log) ? res.log : []);
      try { setTags(await invoke("wiki.tags")); } catch { /* tags 可选 */ }
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
    try {
      const next = await invoke("wiki.touch", { id: pageId });
      if (Array.isArray(next)) setRecents(next);
    } catch { /* 最近打开是可选功能 */ }
  }, [focus, split, loadPage, invoke]);

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

  // 停笔约 1s 自动保存；保存失败保留 dirty 并提示，不丢内容
  useEffect(() => {
    const pending = Object.values(docs).filter((d) => d.dirty);
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      for (const doc of pending) void saveDoc(doc.id);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [docs, saveDoc]);

  const saveQuick = async () => {
    const text = quickText.trim();
    if (!text || quickBusy) return;
    setQuickBusy(true);
    try {
      const title = text.split("\n")[0].replace(/^#+\s*/, "").trim().slice(0, 80) || "快速记录";
      const page = await invoke("wiki.createPage", { title });
      if (page) {
        await invoke("wiki.savePage", { id: page.id, title, content: `# ${title}\n\n${text}` });
        setQuickOpen(false);
        setQuickText("");
        await refresh();
        await openPage(page.id);
        setNotice("已存为知识库草稿");
      }
    } catch (err) { fail(err); } finally { setQuickBusy(false); }
  };

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
  /**
   * 按资料生成知识库草稿骨架（确定性生成，不需要模型）。
   * 如果还没有资料但已经打开本地目录，先自动把本地 Markdown 导入为资料再生成。
   */
  const generateWiki = async (sourceIds: string[] = []) => {
    setBusy(true);
    try {
      let res = await invoke("wiki.generate", { sourceIds });
      let created = Number(res?.created || 0);
      // 插件侧真的没有任何资料时：如果已打开本地目录，先导入再生成
      if (!created && Number(res?.totalSources || 0) === 0 && !sourceIds.length) {
        if (!vault.files.length) {
          setError("还没有可用的资料：先「导入文档」、打开本地 Markdown 目录，或粘贴文本 / URL");
          setTab("pages");
          return;
        }
        const imported = await importAllVault();
        if (!imported) { setError("本地目录里没有可导入的 Markdown"); return; }
        res = await invoke("wiki.generate", {});
        created = Number(res?.created || 0);
      }
      setNotice(created ? `已生成 ${created} 个草稿页面，去「页面」里编辑或审核` : "没有新的资料需要生成（已有对应页面）");
      await refresh();
      if (created) { setTab("pages"); setGraph(false); setMemoryOpen(false); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  /** 把本地目录里的 Markdown 全部导入为资料；单个失败不阻塞；返回成功数量 */
  /** 本地目录里还没变成资料的文件（按 uri 判断，避免重复导入） */
  const pendingVaultFiles = useMemo(() => {
    const imported = new Set(sources.map((s) => s.uri).filter(Boolean));
    return vault.files.filter((f) => !imported.has(f.path));
  }, [vault.files, sources]);

  const importAllVault = async (): Promise<number> => {
    const files = pendingVaultFiles;
    if (!vault.files.length) { setError("还没有打开本地目录"); return 0; }
    if (!files.length) { setNotice("本地目录里的 Markdown 都已经导入为资料了"); return sources.length; }
    setBusy(true);
    let ok = 0;
    let skipped = 0;
    try {
      for (const f of files) {
        try {
          const content = await invoke("wiki.vault.file", { path: f.path });
          const text = String((content as { content?: string })?.content || "");
          if (!text.trim()) continue;
          const res = await invoke("wiki.importSource", { title: f.title, content: text, kind: "vault", uri: f.path });
          if (res?.deduped) skipped += 1; else ok += 1;
        } catch { /* 单个文件失败不阻塞 */ }
      }
      setNotice(ok ? `已导入 ${ok} 份本地 Markdown 为资料${skipped ? `（${skipped} 份已存在）` : ""}` : "没有新的可导入内容");
      await refresh();
      setTab("sources");
      return ok;
    } catch (err) { fail(err); return 0; } finally { setBusy(false); }
  };

  /** 自动整理：统一大纲 + 补「相关」链接 + 重建索引页（插件内确定性执行，不需要模型） */
  const curateWiki = async () => {
    setBusy(true);
    try {
      const res = await invoke("wiki.curate", {});
      const updated = Number(res?.updated || 0);
      const renamed = Number(res?.renamed || 0);
      const names = (res?.renames || []).slice(0, 3).map((r: { from: string; to: string }) => `「${r.from}」→「${r.to}」`).join(" ");
      setNotice(
        updated || res?.createdIndex || renamed
          ? `已整理 ${updated} 个页面${renamed ? `，重命名 ${renamed} 个${names ? `：${names}${renamed > 3 ? " …" : ""}` : ""}` : ""}${res?.createdIndex ? "，并生成「知识库索引」" : "，索引已更新"}`
          : "大纲和标题已经是最新的（没有需要改的页面）",
      );
      await refresh();
      const current = pane.active;
      if (current && docs[current] && !docs[current].local) {
        const fresh = await invoke("wiki.getPage", { id: current });
        if (fresh) setDocs((cur) => ({ ...cur, [current]: { ...fresh, dirty: false } }));
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  /** 导入本地文档（md / txt / json / csv …）：调系统文件选择器，逐个变成资料 */
  const importDocuments = async () => {
    setBusy(true);
    try {
      const picked = await window.harness.docsPick();
      if (!picked.length) return;
      let ok = 0;
      let deduped = 0;
      const errors: string[] = [];
      for (const doc of picked) {
        if (doc.error || doc.text == null) { errors.push(`${doc.name}：${doc.error || "读取失败"}`); continue; }
        const res = await invoke("wiki.importSource", { title: doc.name.replace(/\.[a-z0-9]+$/i, ""), content: doc.text, kind: "file", uri: doc.path });
        if (res?.deduped) deduped += 1; else ok += 1;
      }
      setNotice(ok || deduped
        ? `已导入 ${ok} 份文档${deduped ? `（${deduped} 份已存在）` : ""}`
        : "没有可导入的文档");
      if (errors.length) setError(errors.slice(0, 3).join("；"));
      await refresh();
      setTab("sources");
      setSourceDraft(null);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  /** 删除资料（连带其引用）；页面保留 */
  const deleteSource = async (source: { id: string; title: string }) => {
    if (!window.confirm(`把资料「${source.title}」移入回收站？引用它的页面会失去这条引用。`)) return;
    setBusy(true);
    try {
      const res = await invoke("wiki.deleteSource", { id: source.id });
      if (sourceView?.id === source.id) setSourceView(null);
      setNotice(`资料已移入回收站${res?.removedCitations ? `，同时移除 ${res.removedCitations} 条引用` : ""}`);
      await refresh();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  /** 删除页面（关掉相关 tab） */
  const deletePage = async (page: { id: string; title: string }) => {
    if (!window.confirm(`把页面「${page.title}」移入回收站？可在「回收站」恢复。`)) return;
    setBusy(true);
    try {
      await invoke("wiki.deletePage", { id: page.id });
      setDocs((cur) => { const next = { ...cur }; delete next[page.id]; return next; });
      const strip = (p: Pane) => ({ tabs: p.tabs.filter((x) => x !== page.id), active: p.active === page.id ? null : p.active });
      setLeft(strip); setRight(strip);
      setNotice("页面已移入回收站");
      await refresh();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const restoreTrash = async (item: TrashItem) => {
    try {
      await invoke("wiki.restoreTrash", { id: item.id });
      setNotice(`已恢复「${item.title}」`);
      await refresh();
      setTab(item.kind === "page" ? "pages" : "sources");
    } catch (err) { fail(err); }
  };

  const purgeTrash = async (item: TrashItem) => {
    if (!window.confirm(`彻底删除「${item.title}」？此操作不可恢复。`)) return;
    try {
      await invoke("wiki.purgeTrash", { id: item.id });
      setNotice("已彻底删除");
      await refresh();
    } catch (err) { fail(err); }
  };

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
    const text = `请基于以下 source 整理一个知识库草稿。\n\nSource id: ${source.id}\nSource: ${source.title}\n${source.content || ""}\n\n要求：使用 wiki_search / wiki_read_source / wiki_upsert_draft / wiki_add_citation 工具；给出页面结构、关键结论，并绑定引用。不要直接标记 reviewed。`;
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
    const text = `基于这个知识库页面继续：\n\n# ${activeDoc.title}\n\n${activeDoc.content.slice(0, 12000)}`;
    window.dispatchEvent(new CustomEvent("harness:view", { detail: "workspace" }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail: { text } })), 100);
  };

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) { setSearchHits([]); return; }
    try {
      setSearchHits((await invoke("wiki.search", { query: value })) || []);
      const term = value.trim();
      setSearchHistory((current) => {
        const next = [term, ...current.filter((x) => x !== term)].slice(0, 8);
        try { localStorage.setItem("cmh.wiki.searchHistory", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    } catch { /* ignore */ }
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
    return <div className="notes-page notes-disabled"><div className="notes-disabled-card"><b>知识库插件未启用</b><p>在「设置 → 插件」启用内置知识库。</p></div></div>;
  }

  const tabsBar = (
    <div className="notes-wiki-tabs">
      <button className={tab === "pages" ? "on" : ""} onClick={() => setTab("pages")}>页面</button>
      <button className={tab === "sources" ? "on" : ""} onClick={() => setTab("sources")}>资料</button>
      <button className={tab === "docs" ? "on" : ""} onClick={() => setTab("docs")}>文档</button>
      <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>审核{reviews.length ? `·${reviews.length}` : ""}</button>
      <button className={tab === "vault" ? "on" : ""} onClick={() => setTab("vault")}>本地</button>
      <button className={tab === "trash" ? "on" : ""} onClick={() => setTab("trash")}>回收站</button>
    </div>
  );

  const renderPane = (which: "left" | "right") => {
    const current = which === "left" ? left : right;
    const doc = current.active ? docs[current.active] : null;
    return (
      <section className={`notes-editor-pane ${focus === which ? "focused" : ""}`} onMouseDown={() => setFocus(which)}>
        <div className={`notes-tabbar ${current.tabs.length === 0 ? "empty" : ""}`}>
          {current.tabs.map((pageId) => {
            const d = docs[pageId];
            if (!d) return null;
            return <button key={pageId} className={`notes-tab ${current.active === pageId ? "on" : ""}`} onClick={() => { setFocus(which); setPane(which, (p) => ({ ...p, active: pageId })); }} title={d.title}>{d.dirty && <span className="notes-tab-dirty" />}<span className="ellipsis">{d.title}</span><i onClick={(e) => { e.stopPropagation(); closeTab(which, pageId); }}>×</i></button>;
          })}
          <button className="notes-tab-add" title="新建页面" onClick={() => void createPage()}>＋</button>
        </div>
        {!doc ? (
          <div className="notes-hub">
            <div className="notes-hub-mark"><SparkleIcon size={16} /></div>
            <h2>从这里开始</h2>
            <p className="notes-hub-sub">页面是整理后的知识；资料是原始输入；本地目录可以直接编辑 Markdown 并写回磁盘。</p>
            <div className="notes-hub-cards">
              <button className="notes-hub-card" onClick={() => void createPage()} disabled={busy}>
                <span className="notes-hub-ico">＋</span>
                <b>新建页面</b>
                <em>空白 Markdown，先写再整理</em>
              </button>
              <button className="notes-hub-card" onClick={() => setSourceDraft({ title: "", content: "", url: "", mode: "text" })} disabled={busy}>
                <span className="notes-hub-ico"><FileTextIcon size={14} /></span>
                <b>导入资料</b>
                <em>粘贴文本 / Markdown / URL</em>
              </button>
              <button className="notes-hub-card" onClick={() => void pickLocalFolder()} disabled={busy}>
                <span className="notes-hub-ico">⌸</span>
                <b>打开本地目录</b>
                <em>编辑仓库里的 .md 并写回</em>
              </button>
            </div>
            <div className="notes-hub-flow">
              <span>① 打开本地目录 / 导入资料</span><i>→</i>
              <span>② 全部导入为资料</span><i>→</i>
              <span>③ 生成知识库（草稿）</span><i>→</i>
              <span>④ 编辑 / 审核</span>
            </div>
            <div className="notes-hub-tip">「生成知识库」是确定性骨架（把资料变成草稿页面 + 引用）；想要写作质量更高，用资料页的「发送到 Chat」让 Agent 整理后回写。</div>
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
                <span className="notes-note-sub">
                  {doc.local ? (
                    <>
                      <span className="notes-review-badge local">本地文件</span>
                      <span className="ellipsis mono">{doc.localPath}</span>
                      {doc.dirty && <span className="notes-dirty">未保存</span>}
                    </>
                  ) : (
                    <>
                      <span className={`notes-status-dot ${doc.status}`} />
                      {statusLabel(doc.status)}
                      <i>·</i>
                      {doc.citations.length} 引用
                      <i>·</i>
                      {timeAgo(doc.updatedAt)}
                      {doc.dirty && <span className="notes-dirty">未保存</span>}
                    </>
                  )}
                </span>
              </div>
              <div className="notes-doc-actions">
                <div className="notes-mode"><button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>阅读</button><button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>编辑</button></div>
                {doc.dirty && <button className="btn tiny-btn primary" onClick={() => void saveDoc(doc.id)} disabled={busy}>{doc.local ? "保存到文件" : "保存 draft"}</button>}
                {!doc.local && doc.status === "draft" && <button className="btn tiny-btn ok" onClick={() => void reviewPage(doc.id, "accept")} disabled={busy}>接受</button>}
                <RowMenu title="页面操作">
                  {doc.local ? (
                    <>
                      <button onClick={() => void importLocalSource(doc)} disabled={busy}>导入为 Source</button>
                      <button onClick={() => void revealLocalFile(doc)}>在 Finder 显示</button>
                    </>
                  ) : (
                    <>
                      {doc.status === "draft" && <button onClick={() => void reviewPage(doc.id, "reject")} disabled={busy}>退回</button>}
                      <button onClick={() => void createTask()} disabled={busy}>创建任务</button>
                      <button onClick={() => void exportPdf()}>导出 PDF</button>
                    </>
                  )}
                  <button onClick={sendPageToChat}>发送到 Chat</button>
                </RowMenu>
              </div>
            </div>
            {mode === "preview" ? (
              <div className="notes-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiMarkdown(doc.content)) }} onClick={(e) => {
                const anchor = (e.target as HTMLElement).closest("a");
                const href = anchor?.getAttribute("href") || "";
                if (!href) return;
                if (/^https?:/i.test(href)) { e.preventDefault(); void window.harness.openExternal(href); return; }
                if (href.startsWith("#tag/")) {
                  e.preventDefault();
                  void openTag(decodeURIComponent(href.slice(5)));
                  return;
                }
                if (href.startsWith("#wiki/")) {
                  e.preventDefault();
                  const title = decodeURIComponent(href.slice(6)).split("#")[0];
                  const target = pages.find((p) => p.title === title || p.slug === title || p.id === title)
                    || vault.files.find((f) => f.title === title || f.path.replace(/\.md$/i, "").endsWith(title));
                  if (target) {
                    if ("path" in target) void openVaultFile(target.path, which);
                    else void openPage(target.id, which);
                  } else {
                    void createLinkedPage(title);
                  }
                }
              }} />
            ) : (
              <NotesEditor key={doc.id} value={doc.content} pages={[...pages.map((p) => ({ path: p.id, title: p.title })), ...vault.files.map((f) => ({ path: `vault:${f.path}`, title: f.title }))]} tags={tags.map((t) => t.tag)} dirty={doc.dirty} onChange={(value) => updateDoc(doc.id, value)} onSave={() => void saveDoc(doc.id)} />
            )}
          </>
        )}
      </section>
    );
  };

  const openHit = async (hit: SearchHit) => {
    setHighlightQuery(query.trim());
    if (hit.kind === "page") await openPage(hit.id);
    else await openSource(hit.id);
  };

  // 搜索结果点击后：在预览 DOM 里包 <mark> 并滚到第一个命中
  useEffect(() => {
    if (!highlightQuery || mode !== "preview") return;
    const container = document.querySelector<HTMLElement>(".notes-preview");
    if (!container) return;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node as Text).nodeValue?.trim()) nodes.push(node as Text);
    }
    const re = new RegExp(escapeRegExp(highlightQuery), "gi");
    let first: HTMLElement | null = null;
    for (const textNode of nodes) {
      if (!re.test(textNode.nodeValue || "")) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const match of (textNode.nodeValue || "").matchAll(re)) {
        const at = match.index ?? 0;
        if (at > last) frag.appendChild(document.createTextNode((textNode.nodeValue || "").slice(last, at)));
        const mark = document.createElement("mark");
        mark.className = "notes-hit";
        mark.textContent = match[0];
        frag.appendChild(mark);
        if (!first) first = mark;
        last = at + match[0].length;
      }
      if (last < (textNode.nodeValue || "").length) frag.appendChild(document.createTextNode((textNode.nodeValue || "").slice(last)));
      textNode.parentNode?.replaceChild(frag, textNode);
    }
    if (first) {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      first.classList.add("flash");
      window.setTimeout(() => first?.classList.remove("flash"), 1400);
    }
  }, [activeDoc?.id, highlightQuery, mode]);

  useEffect(() => {
    if (!activeDoc || activeDoc.local) { setUnlinked([]); return; }
    let alive = true;
    invoke("wiki.unlinked", { id: activeDoc.id })
      .then((res) => { if (alive) setUnlinked(Array.isArray(res) ? res : []); })
      .catch(() => { if (alive) setUnlinked([]); });
    return () => { alive = false; };
  }, [activeDoc?.id, activeDoc?.local, invoke, pages.length]);

  // 双链样式：已有页面给摘要 tooltip，缺失页面标红，点击可创建
  useEffect(() => {
    if (mode !== "preview") return;
    const root = document.querySelector<HTMLElement>(".notes-preview");
    if (!root) return;
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#wiki/"]')) {
      const title = decodeURIComponent(link.getAttribute("href")?.slice(6) || "").split("#")[0];
      const target = pages.find((p) => p.title === title || p.slug === title || p.id === title)
        || vault.files.find((f) => f.title === title || f.path.replace(/\.md$/i, "").endsWith(title));
      if (target) {
        link.classList.add("wiki-link-ok");
        if ("summary" in target && target.summary) link.title = target.summary;
      } else {
        link.classList.add("wiki-link-missing");
        link.title = `创建「${title}」`;
      }
    }
  }, [activeDoc?.id, activeDoc?.content, mode, pages, vault.files]);

  // 双链 hover 摘要浮层（原生 title 只做兜底）
  useEffect(() => {
    if (mode !== "preview") return;
    const root = document.querySelector<HTMLElement>(".notes-preview");
    if (!root) return;
    const onOver = (event: Event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#wiki/"]');
      if (!link) return;
      const title = decodeURIComponent(link.getAttribute("href")?.slice(6) || "").split("#")[0];
      const page = pages.find((p) => p.title === title || p.slug === title || p.id === title);
      if (!page?.summary) return;
      const rect = link.getBoundingClientRect();
      setLinkHover({ title: page.title, summary: page.summary, status: page.status, x: Math.min(window.innerWidth - 300, rect.left), y: Math.min(window.innerHeight - 130, rect.bottom + 6) });
    };
    const onOut = (event: Event) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#wiki/"]');
      if (link) setLinkHover(null);
    };
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseout", onOut);
    return () => { root.removeEventListener("mouseover", onOver); root.removeEventListener("mouseout", onOut); };
  }, [activeDoc?.id, mode, pages]);

  const createLinkedPage = async (title: string) => {
    if (!title.trim()) return;
    try {
      const page = await invoke("wiki.createPage", { title: title.trim() });
      if (page) {
        await invoke("wiki.savePage", {
          id: page.id, title: title.trim(),
          content: `# ${title.trim()}\n\n来源：[[${activeDoc?.title || "知识库"}]]\n`,
        });
        await refresh();
        await openPage(page.id);
        setNotice(`已创建页面「${title.trim()}」`);
      }
    } catch (err) { fail(err); }
  };

  const askWiki = async () => {
    const question = askQuestion.trim();
    if (!question) return;
    setAskLoading(true);
    setAskResult(null);
    try {
      const res = await invoke("wiki.ask", { question });
      if (res) setAskResult(res);
    } catch (err) { fail(err); } finally { setAskLoading(false); }
  };

  const saveAnswer = async () => {
    if (!askResult?.found) return;
    try {
      const title = askQuestion.trim().slice(0, 60) || "知识库问答";
      const page = await invoke("wiki.upsertDraft", {
        title,
        content: `# ${title}\n\n${askResult.answer}\n`,
        summary: `来自问答：${askQuestion.trim()}`,
      });
      if (page) {
        setAskOpen(false);
        setAskQuestion("");
        setAskResult(null);
        await refresh();
        await openPage(page.id);
        setNotice("问答已存为 draft");
      }
    } catch (err) { fail(err); }
  };

  const exportPdf = async () => {
    if (!activeDoc) return;
    const body = renderMarkdown(wikiMarkdown(activeDoc.content));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c1917;max-width:760px;margin:40px auto;padding:0 24px}pre{background:#f6f2eb;padding:10px;border-radius:6px;overflow:auto}code{font-family:Menlo,monospace}h1,h2,h3{line-height:1.3}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:12px;color:#666}</style></head><body>${body}</body></html>`;
    try {
      const file = await window.harness.exportPdf(html, activeDoc.title);
      if (file) setNotice("PDF 已导出");
    } catch (err) { fail(err); }
  };

  const exportMarkdown = async () => {
    setBusy(true);
    try {
      const res = await invoke("wiki.exportMarkdown");
      if (res) {
        setNotice(`已导出 ${res.count} 个页面到 ${res.dir}/${res.errors?.length ? `（${res.errors.length} 个失败）` : ""}`);
        try { await window.harness.filesReveal(res.dir, state.projectPath); } catch { /* ignore */ }
      }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const pinPage = async (pageId: string) => {
    try {
      const next = await invoke("wiki.pin", { id: pageId });
      if (Array.isArray(next)) setPins(next);
    } catch (err) { fail(err); }
  };

  const openTag = async (tag: string) => {
    const key = tag.replace(/^#/, "");
    setTagFilter(key);
    setTab("pages");
    setGraph(false);
    try { setTagPages((await invoke("wiki.byTag", { tag: key })) || []); } catch { setTagPages([]); }
  };

  const pageRow = (p: PageSummary) => (
    <div key={p.id} className={`notes-row ${activeDoc?.id === p.id ? "on" : ""}`}>
      <button className={`notes-file ${activeDoc?.id === p.id ? "on" : ""}`} onClick={() => void openPage(p.id)} title={p.title}>
        <span className={`notes-status-dot ${p.status}`} />
        <span className="notes-file-main">
          <span className="ellipsis">{p.title}</span>
          <span className="notes-file-sub">{statusLabel(p.status)} · {timeAgo(p.updatedAt)}</span>
        </span>
      </button>
      <span className="notes-row-actions">
        <button className="link tiny" title={pins.includes(p.id) ? "取消收藏" : "收藏 / 置顶"} onClick={(e) => { e.stopPropagation(); void pinPage(p.id); }}>{pins.includes(p.id) ? "★" : "☆"}</button>
        <button className="link tiny" title="删除页面" onClick={(e) => { e.stopPropagation(); void deletePage({ id: p.id, title: p.title }); }}>删除</button>
      </span>
    </div>
  );

  const timeCutoff = searchTime === "7d" ? Date.now() - 7 * 86400e3 : searchTime === "30d" ? Date.now() - 30 * 86400e3 : 0;
  const filteredHits = searchHits.filter((hit) => (searchKind === "all" || hit.kind === searchKind)
    && (searchStatus === "all" || hit.status === searchStatus)
    && (!timeCutoff || (hit.at || 0) >= timeCutoff));
  const pinnedPages = pages.filter((p) => pins.includes(p.id));
  const recentPages = recents.map((r) => pages.find((p) => p.id === r.id)).filter((p): p is PageSummary => Boolean(p)).filter((p) => !pins.includes(p.id)).slice(0, 4);
  const restPages = filteredPages.filter((p) => !pins.includes(p.id) && !recentPages.some((r) => r.id === p.id));

  return (
    <div className="notes-page">
      {askOpen && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="问我的知识库">
          <div className="modal wiki-ask">
            <h3>问知识库</h3>
            <p className="tiny muted">只检索本地页面与资料；每段结论都带页面引用；没有依据会直接说没有。</p>
            <textarea
              autoFocus
              rows={3}
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              placeholder="例如：芯片良率结论是什么？"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void askWiki(); } }}
            />
            <div className="row gap6" style={{ justifyContent: "flex-end" }}>
              <button className="btn tiny-btn" onClick={() => { setAskOpen(false); setAskResult(null); }}>关闭</button>
              <button className="btn tiny-btn primary" disabled={askLoading || !askQuestion.trim()} onClick={() => void askWiki()}>{askLoading ? "检索中…" : "提问"}</button>
            </div>
            {askResult && (
              <div className="wiki-ask-result">
                <div className="notes-preview markdown-body" onClick={(e) => {
                  const a = (e.target as HTMLElement).closest("a");
                  const href = a?.getAttribute("href") || "";
                  if (!href.startsWith("#wiki/")) return;
                  e.preventDefault();
                  const title = decodeURIComponent(href.slice(6)).split("#")[0];
                  const target = pages.find((p) => p.title === title || p.slug === title || p.id === title);
                  if (target) { setAskOpen(false); void openPage(target.id); }
                }} dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiMarkdown(askResult.answer)) }} />
                {askResult.citations.length > 0 && <div className="wiki-ask-cites">{askResult.citations.map((c) => <button key={c.id} onClick={() => { setAskOpen(false); void openPage(c.id); }}>{c.title}</button>)}</div>}
                {askResult.found && <button className="btn tiny-btn" onClick={() => void saveAnswer()}>存为知识库草稿</button>}
              </div>
            )}
          </div>
        </div>
      )}
      {quickOpen && (
        <div className="modal-mask" role="dialog" aria-modal="true" aria-label="快速记录">
          <div className="modal quick-capture">
            <h3>快速记录</h3>
            <p className="tiny muted">⌘⇧K 随时打开 · 剪贴板已预填 · 存为 draft，稍后再整理</p>
            <textarea
              autoFocus
              rows={7}
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder="记下想法、链接或剪贴板内容…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveQuick(); }
                if (e.key === "Escape") { e.preventDefault(); setQuickOpen(false); }
              }}
            />
            <div className="row gap6" style={{ justifyContent: "flex-end" }}>
              <button className="btn tiny-btn" onClick={() => setQuickOpen(false)} disabled={quickBusy}>取消</button>
              <button className="btn tiny-btn primary" onClick={() => void saveQuick()} disabled={quickBusy || !quickText.trim()}>
                {quickBusy ? "保存中…" : "存为知识库草稿"}
              </button>
            </div>
          </div>
        </div>
      )}
      {tab !== "docs" && <PageHeader
        kicker="本地知识库"
        title="知识库"
        subtitle={(
          <div className="notes-stats">
            <span><b>{pages.length}</b> 页面</span>
            <span><b>{sources.length}</b> 资料</span>
            <span className={reviews.length ? "warn" : ""}><b>{reviews.length}</b> 待审核</span>
            {vault.path && <span><b>{vault.files.length}</b> 本地文件</span>}
          </div>
        )}
        actions={(
          <>
            <button className="btn primary" onClick={() => void createPage()} disabled={busy}>＋ 新建页面</button>
            <button
              className="btn"
              onClick={() => setSourceDraft({ title: "", content: "", url: "", mode: "text" })}
              disabled={busy}
              title="导入资料：粘贴文本 / Markdown、URL，或从磁盘选文件"
            >导入资料</button>
            <button
              className="btn"
              onClick={() => void generateWiki()}
              disabled={busy}
              title={sources.length ? `按 ${sources.length} 份资料生成草稿页面` : vault.files.length ? `会先把本地 ${vault.files.length} 个 Markdown 导入为资料再生成` : "先打开本地目录或导入资料"}
            >{busy ? "生成中…" : sources.length ? `生成知识库 (${sources.length})` : "生成知识库"}</button>
            <button
              className="btn"
              onClick={() => void curateWiki()}
              disabled={busy || pages.length === 0}
              title="统一页面大纲（要点 / 原文摘录 / 相关）、补页面互链，并重建「知识库索引」页"
            >整理知识库</button>
            <button className="btn" onClick={() => setAskOpen(true)} title="只基于本地知识库页面回答，带页面引用">问知识库</button>
            <RowMenu title="更多知识库操作" popClassName="notes-menu">
              <div className="row-menu-label">本地目录</div>
              <button onClick={() => void pickLocalFolder()} disabled={busy}>{vault.path ? "更换本地目录…" : "打开本地目录…"}</button>
              <div className="row-menu-label">查看</div>
              <button onClick={() => { setMemoryOpen(false); graph ? setGraph(false) : void openGraph(); }}>{graph ? "关闭图谱" : "图谱"}</button>
              <button onClick={() => { setGraph(false); void openMemory(); }}>{memoryOpen ? "关闭记忆" : "记忆"}</button>
              <button onClick={toggleSplit}>{split ? "取消分屏" : "分屏"}</button>
              <div className="row-menu-label">导出</div>
              <button onClick={() => window.dispatchEvent(new CustomEvent("harness:view", { detail: "knowledge" }))}>打开资料库…</button>
              <button onClick={() => void exportMarkdown()} disabled={busy || pages.length === 0}>导出 Markdown…</button>
              <button onClick={() => void exportPdf()} disabled={!activeDoc}>导出当前页 PDF…</button>
            </RowMenu>
            <button className="icon-btn" onClick={() => void refresh()} title="刷新" aria-label="刷新"><RefreshIcon size={13} /></button>
          </>
        )}
      />}
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }} aria-label="关闭提示">×</button>
        </div>
      )}
      {tab === "docs" && (
        <div className="notes-docs-page">
          {tabsBar}
          <Knowledge act={act} onOpenPage={(id) => { setTab("pages"); void openPage(id); }} />
        </div>
      )}
      <div className="notes-layout" style={tab === "docs" ? { display: "none" } : undefined}>
        <aside className="notes-sidebar">
          {tabsBar}
          {tab !== "docs" && <div className="notes-search-wrap">
            <SearchIcon size={12} className="notes-search-icon" />
            <input
              className="notes-search"
              value={query}
              onChange={(e) => void search(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setQuery(""); void search(""); } }}
              placeholder="搜索页面 / 资料 / 本地"
            />
            {query && <button className="notes-search-clear" title="清除（Esc）" onClick={() => { setQuery(""); void search(""); }}>×</button>}
          </div>}
          {(searchStatus !== "all" || searchKind !== "all" || searchTime !== "all" || searchHits.length > 0) && (
            <div className="notes-search-filters">
              <select value={searchKind} onChange={(e) => setSearchKind(e.target.value)}>
                <option value="all">全部来源</option>
                <option value="page">页面</option>
                <option value="source">资料</option>
              </select>
              <select value={searchStatus} onChange={(e) => setSearchStatus(e.target.value)}>
                <option value="all">全部状态</option>
                <option value="draft">Draft</option>
                <option value="reviewed">已审核</option>
                <option value="stale">已过期</option>
              </select>
              <select value={searchTime} onChange={(e) => setSearchTime(e.target.value)}>
                <option value="all">全部时间</option>
                <option value="7d">最近 7 天</option>
                <option value="30d">最近 30 天</option>
              </select>
            </div>
          )}
          {searchHistory.length > 0 && !query && (
            <div className="notes-search-history">
              {searchHistory.map((term) => <button key={term} onClick={() => void search(term)}>{term}</button>)}
            </div>
          )}
          {filteredHits.length > 0 && <div className="notes-search-results">{filteredHits.slice(0, 12).map((hit) => <button key={hit.kind + hit.id} onClick={() => void openHit(hit)}><b>{markText(hit.title, query)}</b><span>{hit.kind}</span><em>{markText(hit.snippet, query)}</em></button>)}</div>}
          <div className="notes-tree">
            {tab === "pages" && !tagFilter && pinnedPages.length > 0 && (
              <>
                <div className="notes-folder-label">收藏 <em>{pinnedPages.length}</em></div>
                {pinnedPages.map(pageRow)}
              </>
            )}
            {tab === "pages" && !tagFilter && recentPages.length > 0 && (
              <>
                <div className="notes-folder-label">最近 <em>{recentPages.length}</em></div>
                {recentPages.map(pageRow)}
              </>
            )}
            {tab === "pages" && tagFilter && (
              <>
                <div className="notes-folder-label">标签 #{tagFilter} <button className="link tiny" onClick={() => setTagFilter("")}>清除</button></div>
                {tagPages.map(pageRow)}
                {tagPages.length === 0 && <div className="notes-empty-list">没有页面使用这个标签。</div>}
              </>
            )}
            {tab === "pages" && !tagFilter && restPages.map(pageRow)}
            {tab === "sources" && filteredSources.map((s) => (
              <div key={s.id} className="notes-row">
                <button className="notes-file" onClick={() => void openSource(s.id)}>
                  <FileTextIcon size={12} className="notes-source-icon" />
                  <span className="ellipsis">{s.title}</span>
                  <em title="被引用次数">{s.citations || 0}</em>
                </button>
                <span className="notes-row-actions">
                  <button className="link tiny" title="删除资料" onClick={(e) => { e.stopPropagation(); void deleteSource({ id: s.id, title: s.title }); }}>删除</button>
                </span>
              </div>
            ))}
            {tab === "review" && reviews.map((p) => (
              <div key={p.id} className="notes-row">
                <button className="notes-file" onClick={() => void openPage(p.id)}>
                  <span className={`notes-status-dot ${p.status}`} />
                  <span className="ellipsis">{p.title}</span>
                  <em>draft</em>
                </button>
                <span className="notes-row-actions">
                  <button className="link tiny" title="接受" onClick={(e) => { e.stopPropagation(); void reviewPage(p.id, "accept"); }}>接受</button>
                  <button className="link tiny" title="退回" onClick={(e) => { e.stopPropagation(); void reviewPage(p.id, "reject"); }}>退回</button>
                </span>
              </div>
            ))}
            {tab === "vault" && vault.path && (
              <>
                <div className="notes-sidebar-head"><span className="ellipsis" title={vault.path}>{vault.path.split(/[\\/]/).pop() || vault.path}</span><span><button onClick={() => void refreshVault()}>刷新</button><button onClick={() => void pickLocalFolder()}>更换</button></span></div>
                {vault.error && <div className="notes-empty-list">{vault.error}</div>}
                {vaultGroups.map(([folder, files]) => (
                  <div key={folder || "__root"} className="notes-vault-group">
                    <div className="notes-folder-label">{folder || "根目录"} <em>{files.length}</em></div>
                    {files.map((f) => <button key={f.path} className={`notes-file ${activeDoc?.local && activeDoc.localPath === f.path ? "on" : ""}`} title={f.path} onClick={() => void openVaultFile(f.path)}><FileTextIcon size={12} className="notes-source-icon" /><span className="ellipsis">{f.title}</span></button>)}
                  </div>
                ))}
                {filteredVaultFiles.length === 0 && !vault.error && <div className="notes-empty-list">{query ? "没有匹配的本地文件。" : "目录里还没有 Markdown 文件。"}</div>}
                {vault.files.length > 0 && (
                  <div className="notes-sidebar-foot">
                    <button className="link tiny" onClick={() => void importAllVault()} disabled={busy || pendingVaultFiles.length === 0}>
                    {pendingVaultFiles.length === 0 ? "已全部导入为资料" : `全部导入为资料（${pendingVaultFiles.length}）`}
                  </button>
                    <button className="link tiny" onClick={() => void generateWiki()} disabled={busy}>用资料生成页面 →</button>
                  </div>
                )}
              </>
            )}
            {tab === "vault" && !vault.path && (
              <div className="notes-vault-empty">
                <p>打开本地 Markdown 目录，直接编辑并写回磁盘；也可以导入为 Source。</p>
                <button className="btn primary" onClick={() => void pickLocalFolder()} disabled={busy}>打开目录</button>
              </div>
            )}
            {tab === "trash" && trash.filter((item) => !query || item.title.toLowerCase().includes(query.toLowerCase())).map((item) => (
              <div key={item.id} className="notes-row">
                <button className="notes-file" onClick={() => void restoreTrash(item)} title="点击恢复">
                  <FileTextIcon size={12} className="notes-source-icon" />
                  <span className="ellipsis">{item.title}</span>
                  <em>{item.kind === "page" ? "页面" : "资料"}</em>
                </button>
                <span className="notes-row-actions">
                  <button className="link tiny" title="恢复" onClick={(e) => { e.stopPropagation(); void restoreTrash(item); }}>恢复</button>
                  <button className="link tiny" title="彻底删除" onClick={(e) => { e.stopPropagation(); void purgeTrash(item); }}>彻底删除</button>
                </span>
              </div>
            ))}
            {tab === "trash" && trash.length === 0 && <div className="notes-empty-list">回收站是空的。删除的页面和资料会在这里保留，可随时恢复。</div>}
            {tab === "pages" && filteredPages.length === 0 && (
              <div className="notes-empty-list">
                还没有页面。
                <div className="notes-empty-actions">
                  <button className="link tiny" onClick={() => void createPage()} disabled={busy}>＋ 新建</button>
                  <button className="link tiny" onClick={() => void generateWiki()} disabled={busy}>按资料生成</button>
                  <button className="link tiny" onClick={() => void curateWiki()} disabled={busy || pages.length === 0}>自动整理大纲</button>
                  <button className="link tiny" onClick={() => setSourceDraft({ title: "", content: "", url: "", mode: "text" })} disabled={busy}>导入文本 / URL</button>
                </div>
              </div>
            )}
            {tab === "sources" && filteredSources.length === 0 && <div className="notes-empty-list">还没有资料。导入文本或 URL。</div>}
            {tab === "review" && reviews.length === 0 && <div className="notes-empty-list">没有待审核 draft。</div>}
          </div>
          {tab === "sources" && (
            <div className="notes-sidebar-foot">
              {vault.files.length > 0 && (
                <button className="link tiny" onClick={() => void importAllVault()} disabled={busy || pendingVaultFiles.length === 0}>
                  {pendingVaultFiles.length === 0 ? "本地文件已全部导入" : `导入本地 ${pendingVaultFiles.length} 个 .md`}
                </button>
              )}
              <button className="link tiny" onClick={() => void generateWiki()} disabled={busy}>用资料生成页面 →</button>
            </div>
          )}
          {tab === "sources" && log.length > 0 && <div className="notes-log">{log.slice(0, 5).map((l) => <div key={l.id}>{l.text}</div>)}</div>}
        </aside>

        <main className="notes-main">
          {tab === "docs" ? (
            <div className="notes-docs"><Knowledge embedded act={act} onOpenPage={(id) => { setTab("pages"); void openPage(id); }} /></div>
          ) : memoryOpen ? (
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
                {sources.some((s) => s.uri === activeDoc.localPath) ? (
                  <div className="notes-link imported"><b>已在资料中</b><span>重复导入会自动跳过（按路径去重）</span></div>
                ) : (
                  <button className="notes-link" onClick={() => void importLocalSource(activeDoc)} disabled={busy}><b>导入为 Source</b><span>把这份 Markdown 变成知识库资料</span></button>
                )}
                <button className="notes-link" onClick={() => void revealLocalFile(activeDoc)}><b>在 Finder 显示</b><span>打开文件所在位置</span></button>
                <button className="notes-link" onClick={() => void refreshVault()}><b>刷新目录</b><span>重新扫描本地 Markdown</span></button>
              </div>
              <div className="notes-meta-block"><div className="notes-meta-title">目录</div><p className="notes-meta-empty">{vault.path || activeDoc.localPath}</p><button className="notes-link" onClick={() => void pickLocalFolder()} disabled={busy}><b>更换目录</b></button></div>
            </>
          ) : activeDoc ? (
            <>
              <div className="notes-meta-block">
                <div className="notes-meta-title">页面</div>
                <div className="notes-meta-kv">
                  <span>字数</span><b>{String(activeDoc.content || "").replace(/\s+/g, " ").trim().length}</b>
                  <span>更新</span><b>{timeAgo(activeDoc.updatedAt)}</b>
                </div>
              </div>
              <div className="notes-meta-block">
                <div className="notes-meta-title">状态</div>
                <div className="notes-meta-row">
                  <span className={`notes-review-badge ${activeDoc.status}`}>{statusLabel(activeDoc.status)}</span>
                  <span className="notes-meta-hint">置信度 {confidenceLabel(activeDoc.confidence)}</span>
                </div>
              </div>
              <div className="notes-meta-block">
                <div className="notes-meta-title">引用来源 <em>{activeDoc.citations.length}</em></div>
                {activeDoc.citations.length === 0 && <p className="notes-meta-empty">还没有引用资料。用下面的选择器添加，或在正文里标注出处。</p>}
                {activeDoc.citations.map((c) => <button key={c.id} className="notes-link" onClick={() => c.sourceId && void openSource(c.sourceId)}><b>{c.source?.title || c.sourceId}</b>{c.quote && <span>{c.quote.slice(0, 80)}</span>}</button>)}
                {sources.length > 0 && <select className="notes-cite-select" value="" onChange={(e) => { if (e.target.value) void addCitation(e.target.value); }}><option value="">＋ 引用 source</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
              </div>
              <div className="notes-meta-block">
                <div className="notes-meta-title">反向链接 <em>{activeDoc.backlinks?.length || 0}</em></div>
                {(activeDoc.backlinks || []).length === 0 && <p className="notes-meta-empty">还没有页面链接到这里。在别的页面写 [[{activeDoc.title}]] 就会出现在这里。</p>}
                {(activeDoc.backlinks || []).map((b) => <button key={b.id} className="notes-link" onClick={() => void openPage(b.id, focus)}><b>{b.title}</b><span>{statusLabel(b.status)}</span>{b.snippet && <em>{b.snippet}</em>}</button>)}
              </div>
              {unlinked.length > 0 && (
                <div className="notes-meta-block">
                  <div className="notes-meta-title">未链接提及 <em>{unlinked.length}</em></div>
                  {unlinked.map((b) => <button key={b.id} className="notes-link" onClick={() => void openPage(b.id, focus)}><b>{b.title}</b><em>{b.snippet}</em></button>)}
                </div>
              )}
              <div className="notes-meta-block">
                <div className="notes-meta-title">关联任务 <em>{linkedTodos.length}</em></div>
                {linkedTodos.length === 0 && <p className="notes-meta-empty">还没有关联任务。页面右上角「⋯ → 创建任务」可以从这里派活。</p>}
                {linkedTodos.map((l) => { const todo = state.todos.find((t) => t.id === l.todoId); return <button key={l.id} className="notes-link" disabled={!todo || !onOpenTodo} onClick={() => todo && onOpenTodo?.(todo.id)}><b>{todo?.title || l.title || l.todoId}</b><span>{todo?.key} {todo?.status}</span></button>; })}
              </div>
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
            <div className="notes-source-mode three">
              <button className={sourceDraft.mode === "text" ? "on" : ""} onClick={() => setSourceDraft({ ...sourceDraft, mode: "text" })}>文本 / Markdown</button>
              <button className={sourceDraft.mode === "url" ? "on" : ""} onClick={() => setSourceDraft({ ...sourceDraft, mode: "url" })}>URL</button>
              <button className={sourceDraft.mode === "file" ? "on" : ""} onClick={() => setSourceDraft({ ...sourceDraft, mode: "file" })}>本地文件</button>
            </div>
            {sourceDraft.mode === "file" ? (
              <>
                <div className="notes-source-file">
                  <b>从磁盘选择文档</b>
                  <span>支持 .md / .markdown / .txt / .json / .csv / .yml / .html / .log 等文本类文件，可多选；同一路径重复导入会自动跳过。</span>
                </div>
                <div className="notes-source-actions"><button className="btn" onClick={() => setSourceDraft(null)}>取消</button><button className="btn primary" disabled={busy} onClick={() => void importDocuments()}>选择文件…</button></div>
              </>
            ) : (
              <>
                <input className="notes-source-title" placeholder="标题" value={sourceDraft.title} onChange={(e) => setSourceDraft({ ...sourceDraft, title: e.target.value })} />
                {sourceDraft.mode === "url" ? <input className="notes-source-title" placeholder="https://..." value={sourceDraft.url} onChange={(e) => setSourceDraft({ ...sourceDraft, url: e.target.value })} /> : <textarea className="notes-source-content" placeholder="粘贴资料内容…" value={sourceDraft.content} onChange={(e) => setSourceDraft({ ...sourceDraft, content: e.target.value })} />}
                <div className="notes-source-actions"><button className="btn" onClick={() => setSourceDraft(null)}>取消</button><button className="btn primary" disabled={busy || (sourceDraft.mode === "url" ? !sourceDraft.url.trim() : !sourceDraft.content.trim())} onClick={() => void importSource()}>导入</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {linkHover && (
        <div className="wiki-hover-card" style={{ left: linkHover.x, top: linkHover.y }}>
          <b>{linkHover.title}</b>
          <span className={`notes-status-dot ${linkHover.status}`} />
          <p>{linkHover.summary}</p>
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
  const [kindFilter, setKindFilter] = useState<"all" | "page" | "source" | "file">("all");
  const nodes = (data?.nodes || []).filter((n) => kindFilter === "all" || n.kind === kindFilter);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (data?.edges || []).filter((e) => ids.has(e.source) && ids.has(e.target));
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
  if (loading) return <div className="notes-empty"><div className="notes-empty-mark"><SparkleIcon size={16} /></div><b>构建知识库图谱…</b></div>;
  if (!nodes.length) return <div className="notes-empty notes-graph-empty"><div className="notes-empty-mark"><SparkleIcon size={16} /></div><b>还没有图谱</b><p>图谱由「页面」「资料」和「本地 Markdown」组成；页面引用资料、页面之间用 <code>[[双链]]</code> 时才会连线。</p></div>;
  return <div className="notes-graph"><div className="notes-graph-filter">{([["all","全部"],["page","页面"],["source","资料"],["file","本地文件"]] as const).map(([id,label]) => <button key={id} className={kindFilter === id ? "on" : ""} onClick={() => setKindFilter(id)}>{label}</button>)}</div><svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">{edges.map((e, i) => { const a = positions.get(e.source); const b = positions.get(e.target); return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null; })}{nodes.map((n) => { const p = positions.get(n.id); if (!p) return null; return <g key={n.id} onClick={() => { if (n.kind !== "file") onOpen(n.id); }} className={`notes-graph-node ${n.kind}`} style={n.kind === "file" ? { cursor: "default" } : undefined}><circle cx={p.x} cy={p.y} r={Math.min(3.2, 1.5 + Math.sqrt(n.links) * .55)} /><text x={p.x} y={p.y - 4.5} textAnchor="middle">{n.title.slice(0, 18)}</text></g>; })}</svg><div className="notes-graph-count">{nodes.length} nodes · {edges.length} links</div></div>;
}
