import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "./ConfirmHost";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";
import { XIcon } from "./Icons";
import { useT } from "../i18n";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Doc = {
  id: string; uri: string; title: string; parser: string; engine?: string | null;
  pages_total: number; status: string; indexed_at: number; index_mode?: string | null;
  error_code?: string | null; error_text?: string | null;
};
type Hit = { doc_id: string; title: string; page_no: number | null; heading: string | null; text: string; score?: number };
type Cite = {
  ref: number;
  kind?: "doc" | "page";
  page_id?: string | null;
  doc_id: string;
  chunk_id?: number;
  page_no: number | null;
  heading?: string | null;
  quote?: string;
  locator: string;
  title?: string;
};
type WikiHit = { kind: string; id: string; title: string; snippet: string };
type EngineConfig = Record<string, unknown> & {
  endpoint?: string; baseUrl?: string; apiKeySet?: boolean; tokenSet?: boolean; timeoutMs?: number;
};
type Engine = {
  name: string; label: string; description: string; local: boolean; fileTypes: string[];
  available: boolean; reason: string; enabled: boolean; requires: string[]; config: EngineConfig;
};
type EngineState = { defaultEngine: string; fallbackEngine: string; engines: Engine[] };
const DEGRADED_LABEL: Record<string, string> = {
  "fts-only": "仅关键词召回",
  "no-key": "缺 key，仅关键词召回",
  "embed-failed": "向量召回失败",
  "no-vector": "无向量索引",
};
const STATUS_LABEL: Record<string, string> = {
  queued: "排队中", parsing: "解析中", indexing: "建索引", ready: "已索引",
  failed: "失败", stale: "待重建", deleted: "已删除",
};
const statusOf = (s: string) => STATUS_LABEL[s] || s;

/** 索引模式：local-fts-only = 一个字节不出网；cloud-vector = 正文分块发往 Ark embedding */
type EmbeddingInfo = { enabled: boolean; available: boolean; hasKey: boolean; model: string };

type Draft = { endpoint: string; apiKey: string; token: string; timeoutMs: number };

/**
 * 刷新列表时保持已有资料的位置：只把新导入的放到最前面。
 * 这样「重新解析 / 换引擎 / 删除 / 勾选」都不会让侧栏里的某一行突然跳位。
 */
function mergeDocOrder(prev: Doc[], next: Doc[]): Doc[] {
  if (!prev.length) return next;
  const rank = new Map(prev.map((d, i) => [d.id, i]));
  const fresh = next.filter((d) => !rank.has(d.id));
  const kept = next
    .filter((d) => rank.has(d.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...fresh, ...kept];
}

const SECRET_LABEL: Record<string, string> = {
  mineru: "API Key（可选，网关鉴权时填）",
  mineru_cloud: "MinerU API Key",
  paddleocr_vl: "API Key（可选）",
  paddleocr_vl_cloud: "AI Studio Token",
  custom: "API Key（可选）",
};

function draftOf(engine: Engine | null): Draft {
  const config = engine?.config || {};
  return {
    endpoint: String(config.endpoint || config.baseUrl || ""),
    apiKey: "",
    token: "",
    timeoutMs: Number(config.timeoutMs) || 600_000,
  };
}

/** 知识（资料）：导入 PDF / Office / 网页，页级引用问答，和页面共用一次搜索 */
export function Knowledge({ act, onOpenPage, embedded = false }: {
  act: Act;
  /** 命中页面：直接在当前知识库里打开 */
  onOpenPage?: (id: string) => void;
  /** 嵌进知识库时不再重复页头与外边距 */
  embedded?: boolean;
}) {
  const t = useT();
  const [docs, setDocs] = useState<Doc[]>([]);
  const docsRef = useRef<Doc[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [pages, setPages] = useState<WikiHit[]>([]);
  const [askQ, setAskQ] = useState("");
  const [ask, setAsk] = useState<{ answer: string; citations: Cite[]; found: boolean; degraded?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ doc: Doc; pages: { page_no: number; heading: string; text: string; warn: boolean }[]; chunks: number } | null>(null);
  const [selectedCite, setSelectedCite] = useState<number | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [shot, setShot] = useState<{ dataUrl: string; page: number; title: string } | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const [range, setRange] = useState<"all" | "ready" | "busy" | "attention">("all");
  /** 提问范围：页面 / 资料 / 全部（默认全部，一次检索两侧） */
  const [scope, setScope] = useState<"all" | "pages" | "docs">("all");
  const [pasting, setPasting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [notice, setNotice] = useState("");
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<string>("");
  const [draft, setDraft] = useState<Draft>({ endpoint: "", apiKey: "", token: "", timeoutMs: 600_000 });
  const [engineBusy, setEngineBusy] = useState("");
  const [probes, setProbes] = useState<Record<string, { available: boolean; reason: string }>>({});
  const [adding, setAdding] = useState(false);
  const [newEngine, setNewEngine] = useState({ name: "", endpoint: "", fileTypes: "pdf,docx" });
  const [embedding, setEmbedding] = useState<EmbeddingInfo | null>(null);

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

  // 范围筛选：按状态看资料比按解析引擎分组更有用（引擎只是标签，不是集合）
  const counts = useMemo(() => ({
    all: docs.length,
    ready: docs.filter((d) => d.status === "ready").length,
    busy: docs.filter((d) => ["queued", "parsing", "indexing"].includes(d.status)).length,
    attention: docs.filter((d) => ["failed", "stale"].includes(d.status)).length,
  }), [docs]);

  const visibleDocs = useMemo(() => {
    if (range === "all") return docs;
    if (range === "ready") return docs.filter((d) => d.status === "ready");
    if (range === "busy") return docs.filter((d) => ["queued", "parsing", "indexing"].includes(d.status));
    return docs.filter((d) => ["failed", "stale"].includes(d.status));
  }, [docs, range]);

  const docIds = () => (checked.size ? [...checked] : undefined);
  const toggleDoc = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = docs.length > 0 && checked.size === docs.length;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(docs.map((d) => d.id)));

  const openPageImage = async (doc: Doc, page: number) => {
    if (shotBusy) return;
    setShotBusy(true);
    try {
      const res = await act("knowledgePageImage", { id: doc.id, page });
      if (res?.dataUrl) setShot({ dataUrl: res.dataUrl, page, title: doc.title });
      else setError("这份资料没有页图（仅 PDF / 图片支持原页预览）");
    } catch (err) { fail(err); } finally { setShotBusy(false); }
  };

  const openPreview = async (doc: Doc, page?: number) => {
    try {
      const res = await act("knowledgePreview", { id: doc.id });
      if (!res) return;
      setPreview({ doc: res.doc || doc, pages: res.pages || [], chunks: res.chunks || 0 });
      if (page) {
        window.setTimeout(() => {
          document.querySelector(`#kv-page-${page}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 60);
        // 扫描件 / 纯图页：没有文本可看，直接给原页（这才是唯一能核对的东西）
        const target = (res.pages || []).find((pg: { page_no: number; warn?: boolean }) => pg.page_no === page);
        if (target?.warn) void openPageImage(res.doc || doc, page);
      }
    } catch (err) { fail(err); }
  };

  const selectCitation = (c: Cite) => {
    setSelectedCite(c.ref);
    if (c.kind === "page" && c.page_id) { onOpenPage?.(c.page_id); return; }
    const doc = docs.find((d) => d.id === c.doc_id);
    if (doc) void openPreview(doc, c.page_no || 1);
    else setPreview((p) => p);
  };

  const load = useCallback(async () => {
    try {
      const list = (await act("knowledgeList", { limit: 200 })) || [];
      const merged = mergeDocOrder(docsRef.current, list);
      docsRef.current = merged;
      setDocs(merged);
      // 被删掉的资料不要留在勾选集里，否则「只基于勾选的 N 份」会虚高
      setChecked((prev) => {
        if (!prev.size) return prev;
        const ids = new Set(list.map((d: Doc) => d.id));
        const next = new Set([...prev].filter((id) => ids.has(id)));
        return next.size === prev.size ? prev : next;
      });
      // 预览中的资料被删掉时，退回提问视图
      setPreview((prev) => (prev && list.some((d: Doc) => d.id === prev.doc.id) ? prev : null));
    } catch (err) { fail(err); }
  }, [act]);

  const loadEngines = useCallback(async () => {
    try {
      const res = await act("knowledgeEngines");
      setEngineState(res);
      setSelectedEngine((current) => current || res?.engines?.[0]?.name || "");
    } catch (err) { fail(err); }
  }, [act]);

  const loadEmbedding = useCallback(async () => {
    try {
      const res = await act("knowledgeStatus");
      setEmbedding(res?.embedding || null);
    } catch { setEmbedding(null); }
  }, [act]);

  useEffect(() => { void load(); void loadEngines(); void loadEmbedding(); }, [load, loadEngines, loadEmbedding]);

  useEffect(() => {
    const engine = engineState?.engines.find((item) => item.name === selectedEngine) || null;
    setDraft(draftOf(engine));
  }, [selectedEngine, engineState]);

  const engines = engineState?.engines || [];
  const selected = useMemo(() => engines.find((item) => item.name === selectedEngine) || null, [engines, selectedEngine]);

  const runSearch = async (value: string) => {
    if (!value.trim()) { setHits([]); setPages([]); return; }
    try {
      const res = await act("knowledgeSearch", { query: value, limit: 12, docIds: docIds() });
      setHits(res?.hits || []);
      // 资料与页面同一次查询：页面走 wiki 搜索，结果标类型
      try {
        const wiki = await act("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.search", args: { query: value, limit: 8 } });
        setPages((wiki || []).map((h: WikiHit) => ({ ...h })));
      } catch { setPages([]); }
    } catch (err) { fail(err); }
  };

  const runAsk = async () => {
    const question = askQ.trim();
    if (!question) return;
    setBusy(true); setAsk(null); setSelectedCite(null);
    try {
      void runSearch(question);
      const res = await act("knowledgeAsk", { question, limit: 6, docIds: docIds(), scope });
      setAsk(res);
      if (res?.degraded === "no-key") setNotice("未配置 Ark key：本次只用关键词检索，没有向量召回");
      else if (res?.degraded === "fts-only") setNotice("当前是本地关键词检索（未启用云向量），答案仍由模型生成");
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const ingest = async () => {
    setBusy(true);
    try {
      const res = await act("knowledgeIngest");
      const added = res?.added || [];
      const ok = added.filter((a: { error?: string; ok?: boolean }) => a.ok !== false && !a.error).length;
      const warnings = added.flatMap((a: { route?: { warnings?: string[] } }) => a.route?.warnings || []);
      const failure = added.find((a: { ok?: boolean; message?: string }) => a.ok === false);
      const modes = [...new Set(added.map((a: { indexMode?: string }) => a.indexMode).filter(Boolean))] as string[];
      setNotice([
        `导入 ${ok} / ${added.length} 份`,
        modes.length
          ? `索引：${modes.map((m) => (m === "cloud-vector" ? "云端向量（正文已发往火山方舟）" : "本地关键词（不出网）")).join(" / ")}`
          : "",
        failure?.message ? `失败：${failure.message}` : "",
        warnings.length ? `路由：${warnings.join("；")}` : "",
      ].filter(Boolean).join(" · "));
      await load();
      await loadEmbedding();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const ingestText = async () => {
    setBusy(true);
    try {
      const res = await act("knowledgeIngestText", { title: pasteTitle || "粘贴的资料", text: pasteText });
      setNotice(res?.indexMode === "cloud-vector" ? "已存入资料库（云端向量）" : "已存入资料库（本地索引，不出网）");
      setPasting(false); setPasteText(""); setPasteTitle("");
      await load();
      await loadEmbedding();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const remove = async (doc: Doc) => {
    if (!(await confirmDialog(`删除资料「${doc.title}」？引用它的页面会被标为过期。`))) return;
    setBusy(true);
    try {
      const res = await act("knowledgeRemove", { id: doc.id });
      setNotice(`已删除${res?.staledPages ? `，${res.staledPages} 个页面标记为过期` : ""}`);
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const reparse = async (doc: Doc) => {
    setBusy(true);
    try {
      const res = await act("knowledgeReparse", { id: doc.id });
      if (res?.ok === false) throw new Error(res.message || "重新解析失败");
      setNotice(`已重新解析：${doc.title}${res?.engine ? ` · ${res.engine}` : ""}`);
      await load();
      await loadEmbedding();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const setDefaultEngine = async (name: string) => {
    setEngineBusy("default");
    try {
      const res = await act("knowledgeEngineConfig", { defaultEngine: name });
      setEngineState(res);
      setNotice(name === "auto" ? "已切换为自动路由" : `默认引擎：${engines.find((e) => e.name === name)?.label || name}`);
    } catch (err) { fail(err); } finally { setEngineBusy(""); }
  };

  const probe = async (name: string) => {
    setEngineBusy(`probe:${name}`);
    try {
      const res = await act("knowledgeEngineProbe", { name });
      setProbes((prev) => ({ ...prev, [name]: { available: Boolean(res?.available), reason: res?.reason || "" } }));
      setNotice(`${name}：${res?.available ? "可用" : res?.reason || "不可用"}`);
    } catch (err) { fail(err); } finally { setEngineBusy(""); }
  };

  const addEngine = async () => {
    const name = newEngine.name.trim();
    if (!name || !newEngine.endpoint.trim()) return;
    setEngineBusy("add");
    try {
      const res = await act("knowledgeEngineAdd", {
        name,
        label: name,
        endpoint: newEngine.endpoint.trim(),
        fileTypes: newEngine.fileTypes.split(",").map((item) => item.trim().replace(/^\./, "")).filter(Boolean),
        timeoutMs: 600_000,
      });
      setEngineState(res);
      setSelectedEngine(name);
      setAdding(false);
      setNewEngine({ name: "", endpoint: "", fileTypes: "pdf,docx" });
      setNotice(`已注册自研引擎：${name}`);
    } catch (err) { fail(err); } finally { setEngineBusy(""); }
  };

  const removeEngine = async () => {
    if (!selected) return;
    if (!(await confirmDialog(`移除自研引擎「${selected.label}」？已导入的资料不受影响。`))) return;
    setEngineBusy("remove");
    try {
      const res = await act("knowledgeEngineRemove", { name: selected.name });
      setEngineState(res);
      setSelectedEngine("");
      setNotice(`已移除 ${selected.label}`);
    } catch (err) { fail(err); } finally { setEngineBusy(""); }
  };

  const saveEngine = async () => {
    if (!selected) return;
    const patch: Record<string, unknown> = { timeoutMs: Math.max(5_000, Number(draft.timeoutMs) || 600_000) };
    if (selected.name === "mineru_cloud") {
      if (draft.apiKey.trim()) patch.apiKey = draft.apiKey.trim();
    } else if (selected.name === "paddleocr_vl_cloud") {
      if (draft.token.trim()) patch.token = draft.token.trim();
    } else if (selected.name === "simple" || selected.name === "builtin") {
      // 本地引擎只改超时
    } else {
      patch.endpoint = draft.endpoint.trim();
      if (draft.apiKey.trim()) patch.apiKey = draft.apiKey.trim();
    }
    setEngineBusy("save");
    try {
      const res = await act("knowledgeEngineConfig", { name: selected.name, patch });
      setEngineState(res);
      setNotice(`已保存 ${selected.label}`);
      setDraft((prev) => ({ ...prev, apiKey: "", token: "" }));
    } catch (err) { fail(err); } finally { setEngineBusy(""); }
  };

  const usesEndpoint = selected && !["simple", "builtin", "mineru_cloud", "paddleocr_vl_cloud"].includes(selected.name);
  const usesApiKey = Boolean(selected && !selected.local && !["mineru_cloud", "paddleocr_vl_cloud"].includes(selected.name));
  const usesToken = selected?.name === "paddleocr_vl_cloud";
  const usesCloudKey = selected?.name === "mineru_cloud";
  const isExtra = Boolean(selected && !["simple", "builtin", "mineru", "mineru_cloud", "paddleocr_vl", "paddleocr_vl_cloud", "custom"].includes(selected.name));

  const moreMenu = (
    <RowMenu title="更多资料操作" popClassName="notes-menu">
      <div className="row-menu-label">解析与索引</div>
      <button onClick={() => setConfigOpen(true)}>解析引擎与索引模式…</button>
      <div className="row-menu-label">范围</div>
      <button onClick={toggleAll}>{allChecked ? "取消全选" : "全选参与检索"}</button>
      <button onClick={() => setChecked(new Set())}>清空勾选</button>
      <div className="row-menu-label">状态</div>
      <button onClick={() => void load()}>刷新列表</button>
    </RowMenu>
  );

  const body = (
    <div className={embedded ? "kv-embedded pr-page" : "workbench kv-page pr-page"}>
      {embedded ? (
        /* 嵌进知识库时不再出现第二个页头：只保留一条与 tab 同高的工具条 */
        <div className="kv-embedded-bar">
          <div className="stat-strip">
            <span><b>{docs.length}</b> 份资料</span>
            <span><b>{counts.ready}</b> 已索引</span>
            {counts.attention > 0 && <span className="warn"><b>{counts.attention}</b> 需处理</span>}
          </div>
          <span className="spacer" />
          <button className="btn tiny primary" onClick={() => void ingest()} disabled={busy}>＋ {t("action.importMaterials")}</button>
          <button className="btn tiny" onClick={() => setPasting(true)} disabled={busy}>{t("action.pasteText")}</button>
          {moreMenu}
        </div>
      ) : (
        <PageHeader
          title={t("page.materials")}
          subtitle={<div className="stat-strip">
            <span><b>{docs.length}</b> 资料</span>
            <span><b>{counts.ready}</b> 已索引</span>
            <span><b>{engines.filter((e) => e.available).length}</b> 引擎可用</span>
          </div>}
          actions={<>
            <button className="btn primary" onClick={() => void ingest()} disabled={busy}>＋ {t("action.importMaterials")}</button>
            <button className="btn" onClick={() => setPasting(true)} disabled={busy}>{t("action.pasteText")}</button>
            {moreMenu}
          </>}
        />
      )}
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" title="关闭提示" aria-label="关闭提示" onClick={() => { setError(""); setNotice(""); }}><XIcon size={14} /></button>
        </div>
      )}
      {pasting && (
        <div className="kv-block kv-paste">
          <div className="notes-meta-title">粘贴文本</div>
          <input className="kv-input" value={pasteTitle} placeholder="标题（可选）" onChange={(e) => setPasteTitle(e.target.value)} />
          <textarea className="kv-ask" rows={5} value={pasteText} placeholder="粘贴网页正文 / Markdown / 报告，索引后可被检索与引用" onChange={(e) => setPasteText(e.target.value)} />
          <div className="row gap6">
            <button className="btn tiny" onClick={() => { setPasting(false); setPasteText(""); }}>取消</button>
            <button className="btn tiny primary" disabled={busy || !pasteText.trim()} onClick={() => void ingestText()}>存入资料库</button>
          </div>
        </div>
      )}

      <div className="pr-grid">
        {/* 左：范围 + 资料（勾选决定检索范围） */}
        <aside className="pr-col">
          {docs.length > 0 && <div className="pr-block">
            <div className="pr-block-head">范围<span className="tiny faint">勾选决定检索</span></div>
            <div className="kv-range">
              {([["all", "全部", counts.all], ["ready", "已索引", counts.ready], ["busy", "解析中", counts.busy], ["attention", "需处理", counts.attention]] as const).map(([key, label, n]) => (
                <button key={key} className={`kv-range-chip ${range === key ? "on" : ""}`} onClick={() => setRange(key)}>
                  {label}<em>{n}</em>
                </button>
              ))}
            </div>
          </div>}

          <div className="pr-block">
            <div className="pr-block-head">资料
              {checked.size > 0 && <span className="tiny faint">已选 {checked.size}</span>}
              {docs.length > 0 && <button className="link tiny" onClick={toggleAll}>{allChecked ? "取消全选" : "全选"}</button>}
            </div>
            <div className="pr-docs">
              {visibleDocs.map((d) => (
                <div key={d.id} className={`pr-doc ${preview?.doc.id === d.id ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked.has(d.id)}
                    onChange={() => toggleDoc(d.id)}
                    title="参与检索与引用"
                  />
                  <button className="pr-doc-main" onClick={() => void openPreview(d)} title={d.uri}>
                    <b className="ellipsis">{d.title}</b>
                    <span className="tiny faint pr-doc-meta">
                      <span className="kv-engine-tag">{engines.find((e) => e.name === (d.engine || d.parser))?.label || d.engine || d.parser || "本地文本"}</span>
                      {" · "}{d.pages_total || 1} 页 · {statusOf(d.status)}
                    </span>
                  </button>
                  <RowMenu title="资料操作" popClassName="notes-menu">
                    <div className="row-menu-label">查看</div>
                    <button onClick={() => void openPreview(d)}>解析预览</button>
                    <button onClick={() => { setAskQ(`这份资料讲了什么？${d.title}`); void runAsk(); }}>就这份提问</button>
                    <div className="row-menu-label">索引</div>
                    <button onClick={() => void reparse(d)}>重新解析</button>
                    <button onClick={() => toggleDoc(d.id)}>{checked.has(d.id) ? "从检索范围移除" : "加入检索范围"}</button>
                    <div className="row-menu-label">危险</div>
                    <button className="danger" onClick={() => void remove(d)}>删除资料</button>
                  </RowMenu>
                </div>
              ))}
              {docs.length === 0 && <p className="inline-empty">还没有资料。导入 PDF / Word / Markdown / 网页。</p>}
              {docs.length > 0 && visibleDocs.length === 0 && <p className="inline-empty">这个范围里没有资料。</p>}
            </div>
            <p className="inline-empty">只有勾选的资料参与检索与引用；未勾选的仍可单独打开后提问。</p>
          </div>
        </aside>

        {/* 中：唯一主面（提问 / 回答 / 解析预览 / 命中） */}
        <section className="pr-main">
          {preview ? (
            <div className="pr-docview">
              <div className="pr-docview-head">
                <div>
                  <div className="section-title">{preview.doc.title}</div>
                  <span className="tiny faint">
                    {engines.find((e) => e.name === (preview.doc.engine || preview.doc.parser))?.label || preview.doc.engine || preview.doc.parser} · {preview.doc.pages_total || preview.pages.length} 页 · {statusOf(preview.doc.status)} · {preview.chunks} 个片段
                  </span>
                </div>
                <button className="link" onClick={() => setPreview(null)}>返回提问</button>
              </div>
              <div className="pr-pages">
                {preview.pages.slice(0, 80).map((pg) => (
                  <div key={pg.page_no} id={`kv-page-${pg.page_no}`} className={`pr-pageblock ${pg.warn ? "warn" : ""}`}>
                    <div className="pr-ph">
                      <span>p{pg.page_no}{pg.heading ? ` · ${pg.heading}` : ""}</span>
                      <button className="link tiny" onClick={() => void openPageImage(preview.doc, pg.page_no)} disabled={shotBusy}>看原页</button>
                    </div>
                    <p>{pg.warn ? "该页只有图像，当前引擎未输出文本。可「按当前默认重新解析」或换 OCR 引擎。" : pg.text.slice(0, 900)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="pr-ask">
                <div className="pr-ask-scope">
                  <span className="tiny faint">提问范围</span>
                  {([["all", "页面 + 资料"], ["pages", "只看页面"], ["docs", "只看资料"]] as const).map(([key, label]) => (
                    <button key={key} className={`kv-range-chip ${scope === key ? "on" : ""}`} onClick={() => setScope(key)}>{label}</button>
                  ))}
                </div>
                <textarea
                  className="pr-ask-input"
                  rows={3}
                  value={askQ}
                  placeholder="问一个问题：页面与资料一起检索，答案带可点的出处"
                  onChange={(e) => setAskQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runAsk(); } }}
                />
                <div className="pr-ask-row">
                  <span className="tiny faint">只基于勾选的 {checked.size || docs.length} 份资料回答 · ⌘Enter 提问</span>
                  <button className="link tiny" onClick={() => { setAskQ(""); setAsk(null); setHits([]); setPages([]); }}>清空</button>
                  <button className="btn tiny primary" onClick={() => void runAsk()} disabled={busy || !askQ.trim()}>{busy ? "检索中…" : "提问 ⌘Enter"}</button>
                </div>
              </div>

              {ask && (
                <div className="pr-answer">
                  <div className="pr-answer-head">
                    <b>{ask.found ? "基于资料的回答" : "材料里没有"}</b>
                    <span className="tiny faint">{ask.citations.length} 条引用{ask.degraded ? ` · ${DEGRADED_LABEL[ask.degraded] || ask.degraded}` : ""}</span>
                    <button className="link tiny" onClick={() => void navigator.clipboard?.writeText(ask.answer)}>复制</button>
                  </div>
                  <div className="pr-answer-body">{ask.answer.replace(/\[(\d+)\]/g, "")}</div>
                  {ask.citations.length > 0 && (
                    <div className="pr-cites-inline">
                      {ask.citations.map((c) => (
                        <button
                          key={c.ref}
                          className={`pr-cite ${selectedCite === c.ref ? "on" : ""}`}
                          onClick={() => selectCitation(c)}
                          title={c.kind === "page" ? `页面：${c.title || c.heading}` : `${c.title} · ${c.locator}`}
                        >{c.kind === "page" ? `页${c.ref}` : c.ref}</button>
                      ))}
                    </div>
                  )}
                  <div className="tiny faint">没有依据的部分会直接说「资料里没有」，不补全。</div>
                </div>
              )}

              {(hits.length > 0 || pages.length > 0) && (
                <div className="pr-block">
                  <div className="pr-block-head">检索命中<span className="tiny faint">资料与页面同一次查询，结果标类型</span></div>
                  <div className="pr-hits">
                    {hits.map((h) => (
                      <button
                        key={`${h.doc_id}-${h.page_no}-${h.text.slice(0, 12)}`}
                        className="pr-hit"
                        onClick={() => {
                          const doc = docs.find((d) => d.id === h.doc_id);
                          if (doc) void openPreview(doc, h.page_no || 1);
                        }}
                      >
                        <span className="kv-type">资料</span>
                        <span className="pr-hit-main">
                          <b className="ellipsis">{h.title}</b>
                          <span className="pr-hit-loc">{h.heading ? `${h.heading} · ` : ""}p{h.page_no ?? 1}</span>
                          <p>{h.text.slice(0, 220)}</p>
                        </span>
                      </button>
                    ))}
                    {pages.map((h) => (
                      <button className="pr-hit" key={h.id} onClick={() => onOpenPage?.(h.id)}>
                        <span className="kv-type page">页面</span>
                        <span className="pr-hit-main"><b className="ellipsis">{h.title}</b><p>{h.snippet}</p></span>
                      </button>
                    ))}
                  </div>
                  <p className="inline-empty">答案与命中只来自勾选的资料；取消勾选后重新提问即可收窄范围。</p>
                </div>
              )}

              {!ask && docs.length === 0 && (
                <EmptyState
                  mark="⌘"
                  title="还没有资料"
                  desc="导入 PDF / Word / Markdown / 网页，问答只基于这些材料，并给出页码出处。"
                  action={<button className="btn primary" onClick={() => void ingest()} disabled={busy}>导入第一份资料</button>}
                />
              )}
            </>
          )}
        </section>

        {/* 右：本次引用 → 引擎 → 规则 */}
        <aside className="pr-col pr-side">
          <div className="pr-block">
            <div className="pr-block-head">本次引用
              <button className="link tiny" onClick={() => void navigator.clipboard?.writeText((ask?.citations || []).map((c) => `[${c.ref}] ${c.title} · ${c.locator}`).join("\n"))}>导出引用</button>
            </div>
            {ask?.citations?.length ? ask.citations.map((c) => (
              <div key={c.ref} className={`pr-cite-card ${selectedCite === c.ref ? "on" : ""}`}>
                <button className="pr-cc-main" onClick={() => selectCitation(c)}>
                  <div className="pr-cc-head">
                    <span className={`kv-type ${c.kind === "page" ? "page" : ""}`}>{c.kind === "page" ? "页面" : "资料"}</span>
                    <b className="ellipsis">{c.title}</b>
                  </div>
                  <span className="tiny faint">{c.locator}{c.heading ? ` · ${c.heading}` : ""}</span>
                </button>
                {c.kind === "page"
                  ? <button className="link tiny" onClick={() => selectCitation(c)}>打开页面</button>
                  : <button className="link tiny" onClick={() => { const d = docs.find((x) => x.id === c.doc_id); if (d) void openPageImage(d, c.page_no || 1); }}>看原页</button>}
              </div>
            )) : <p className="inline-empty">提问后这里显示本次回答引用的页 / 段。</p>}
          </div>

          <div className="pr-block">
            <div className="pr-block-head">解析与索引
              <button className="link tiny" onClick={() => setConfigOpen(true)}>配置</button>
            </div>
            <p className="inline-empty">
              默认 {engineState?.defaultEngine || "auto"} · {engines.filter((e) => e.available).length}/{engines.length} 个引擎可用
            </p>
            <p className="inline-empty">
              {embedding?.enabled ? `云端向量：${embedding.model}` : "本地关键词索引，正文不出网"}
            </p>
          </div>

          <div className="pr-block">
            <div className="pr-block-head">规则</div>
            <p className="inline-empty">资料只读；回答只引用候选片段并标到页 / 段。</p>
            <p className="inline-empty">删除资料会把引用它的页面标为过期。</p>
            <p className="inline-empty">引擎输出统一成 Markdown + 页码；换引擎只需重解析，不影响已发布页面。</p>
          </div>
        </aside>
      </div>

      {shot && (
        <div className="modal-mask kv-shot-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setShot(null); }}>
          <figure className="kv-shot">
            <figcaption>
              <span className="ellipsis">{shot.title} · p{shot.page}</span>
              <button className="icon-btn" title="关闭" aria-label="关闭截图" onClick={() => setShot(null)}><XIcon size={14} /></button>
            </figcaption>
            <img src={shot.dataUrl} alt={`${shot.title} 第 ${shot.page} 页`} />
          </figure>
        </div>
      )}

      {configOpen && (
        <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfigOpen(false); }}>
          <div className="modal kv-config-modal" role="dialog" aria-modal="true" aria-label="解析与索引">
            <div className="pr-block-head">
              解析与索引
              <button className="icon-btn" title="关闭" aria-label="关闭解析与索引" onClick={() => setConfigOpen(false)}><XIcon size={14} /></button>
            </div>
            <div className="kv-config-body">
              <p className="inline-empty">解析引擎决定文字与页码的抽取质量；索引模式决定正文是否出网。</p>
              <div className="kv-block">
                <div className="notes-meta-title">解析引擎</div>
                <select
                  className="settings-control kv-engine-select"
                  value={engineState?.defaultEngine || "auto"}
                  disabled={engineBusy === "default"}
                  onChange={(e) => void setDefaultEngine(e.target.value)}
                >
                  <option value="auto">自动路由（简单格式本地，其余按默认）</option>
                  {engines.map((engine) => (
                    <option key={engine.name} value={engine.name}>{engine.label}{engine.available ? "" : "（不可用）"}</option>
                  ))}
                </select>
                <div className="kv-engines">
                  {engines.map((engine) => {
                    const probed = probes[engine.name];
                    const available = probed ? probed.available : engine.available;
                    const reason = probed ? probed.reason : engine.reason;
                    return (
                      <div key={engine.name} className={`kv-engine ${selectedEngine === engine.name ? "on" : ""}`}>
                        <button className="kv-engine-main" onClick={() => setSelectedEngine(engine.name)} title={engine.description}>
                          <span className={`kv-doc-dot ${available ? "ready" : "failed"}`} />
                          <b>{engine.label}</b>
                          <em>{engine.local ? "本地" : available ? "可用" : reason || "未配置"}</em>
                        </button>
                        {!engine.local && (
                          <button
                            className="btn tiny"
                            disabled={engineBusy === `probe:${engine.name}`}
                            onClick={() => void probe(engine.name)}
                          >{engineBusy === `probe:${engine.name}` ? "…" : "探测"}</button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button className="btn tiny" onClick={() => setAdding((value) => !value)}>＋ 自研引擎</button>
                {adding && (
                  <div className="kv-extra-form">
                    <input className="kv-input" placeholder="引擎名，如 my-parser" value={newEngine.name} onChange={(e) => setNewEngine({ ...newEngine, name: e.target.value })} />
                    <input className="kv-input" placeholder="Endpoint，如 http://127.0.0.1:9000/parse" value={newEngine.endpoint} onChange={(e) => setNewEngine({ ...newEngine, endpoint: e.target.value })} />
                    <input className="kv-input" placeholder="支持格式，如 pdf,docx" value={newEngine.fileTypes} onChange={(e) => setNewEngine({ ...newEngine, fileTypes: e.target.value })} />
                    <div className="kv-engine-foot">
                      <span className="tiny faint">响应可为 markdown 或 JSON；JSON 默认取 markdown 字段</span>
                      <button className="btn tiny" onClick={() => void addEngine()} disabled={engineBusy === "add" || !newEngine.name.trim() || !newEngine.endpoint.trim()}>注册</button>
                    </div>
                  </div>
                )}
              </div>
              {selected && (
                <div className="kv-block">
                  <div className="notes-meta-title">{selected.label}</div>
                  <p className="kv-engine-desc">{selected.description}</p>
                  {!selected.local && (
                    <p className="inline-empty">
                      远端引擎：导入时整份文件会上传到该服务解析（不是只发片段）。只对可公开的材料使用。
                    </p>
                  )}
                  {usesEndpoint && (
                    <label className="kv-field">
                      <span>{selected.name.endsWith("_cloud") ? "Base URL" : "Endpoint"}</span>
                      <input
                        className="kv-input"
                        value={draft.endpoint}
                        placeholder="http://127.0.0.1:8080"
                        onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
                      />
                    </label>
                  )}
                  {usesApiKey && (
                    <label className="kv-field">
                      <span>{SECRET_LABEL[selected.name] || "API Key"}{selected.config.apiKeySet ? "（已保存）" : ""}</span>
                      <input
                        className="kv-input"
                        type="password"
                        value={draft.apiKey}
                        placeholder={selected.config.apiKeySet ? "留空保持不变" : "粘贴 API Key"}
                        onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      />
                    </label>
                  )}
                  {usesCloudKey && (
                    <label className="kv-field">
                      <span>MinerU API Key{selected.config.apiKeySet ? "（已保存）" : ""}</span>
                      <input
                        className="kv-input"
                        type="password"
                        value={draft.apiKey}
                        placeholder={selected.config.apiKeySet ? "留空保持不变" : "粘贴 mineru.net API Key"}
                        onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      />
                    </label>
                  )}
                  {usesToken && (
                    <label className="kv-field">
                      <span>AI Studio Token{selected.config.tokenSet ? "（已保存）" : ""}</span>
                      <input
                        className="kv-input"
                        type="password"
                        value={draft.token}
                        placeholder={selected.config.tokenSet ? "留空保持不变" : "粘贴 Access Token"}
                        onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="kv-field">
                    <span>超时（秒）</span>
                    <input
                      className="kv-input"
                      type="number"
                      min={5}
                      value={Math.round(draft.timeoutMs / 1000)}
                      onChange={(e) => setDraft({ ...draft, timeoutMs: (Number(e.target.value) || 600) * 1000 })}
                    />
                  </label>
                  <div className="kv-engine-foot">
                    <span className="tiny faint">{selected.fileTypes.slice(0, 8).join(" / ")}{selected.fileTypes.length > 8 ? " …" : ""}</span>
                    <span className="row gap6">
                      {isExtra && <button className="btn tiny" onClick={() => void removeEngine()} disabled={engineBusy === "remove"}>移除</button>}
                      <button className="btn tiny" onClick={() => void saveEngine()} disabled={engineBusy === "save"}>
                        {engineBusy === "save" ? "保存中…" : "保存"}
                      </button>
                    </span>
                  </div>
                </div>
              )}
              <div className="kv-block">
              <div className="notes-meta-title">索引模式</div>
                      {embedding?.enabled ? (
                        <>
                          <p className="inline-empty">
                            正文分块会发往 {embedding.model}（火山方舟）建向量索引；检索时查询串也会发一次。
                            在「设置 → 数据」可关闭。
                          </p>
                          {!embedding.hasKey && (
                            <p className="inline-empty">尚未配置 ARK_API_KEY：设置 → 执行 → 模型密钥 / 环境变量。</p>
                          )}
                        </>
                      ) : (
                        <p className="inline-empty">只做本地关键词索引，资料正文一个字节不出网。</p>
                      )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  return body;
}
