import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RowMenu } from "./RowMenu";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Doc = {
  id: string; uri: string; title: string; parser: string; engine?: string | null;
  pages_total: number; status: string; indexed_at: number; error_code?: string | null; error_text?: string | null;
};
type Hit = { doc_id: string; title: string; page_no: number | null; heading: string | null; text: string; score?: number };
type Cite = {
  ref: number;
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

type Draft = { endpoint: string; apiKey: string; token: string; timeoutMs: number };

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
  const [docs, setDocs] = useState<Doc[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [pages, setPages] = useState<WikiHit[]>([]);
  const [query, setQuery] = useState("");
  const [askQ, setAskQ] = useState("");
  const [ask, setAsk] = useState<{ answer: string; citations: Cite[]; found: boolean; degraded?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ doc: Doc; pages: { page_no: number; heading: string; text: string; warn: boolean }[]; chunks: number } | null>(null);
  const [selectedCite, setSelectedCite] = useState<number | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
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

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

  const docIds = () => (checked.size ? [...checked] : undefined);
  const toggleDoc = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChecked = docs.length > 0 && checked.size === docs.length;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(docs.map((d) => d.id)));

  const openPreview = async (doc: Doc, page?: number) => {
    try {
      const res = await act("knowledgePreview", { id: doc.id });
      if (!res) return;
      setPreview({ doc: res.doc || doc, pages: res.pages || [], chunks: res.chunks || 0 });
      if (page) {
        window.setTimeout(() => {
          document.querySelector(`#kv-page-${page}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 60);
      }
    } catch (err) { fail(err); }
  };

  const selectCitation = (c: Cite) => {
    setSelectedCite(c.ref);
    const doc = docs.find((d) => d.id === c.doc_id);
    if (doc) void openPreview(doc, c.page_no || 1);
    else setPreview((p) => p);
  };

  const load = useCallback(async () => {
    try { setDocs((await act("knowledgeList", { limit: 200 })) || []); } catch (err) { fail(err); }
  }, [act]);

  const loadEngines = useCallback(async () => {
    try {
      const res = await act("knowledgeEngines");
      setEngineState(res);
      setSelectedEngine((current) => current || res?.engines?.[0]?.name || "");
    } catch (err) { fail(err); }
  }, [act]);

  useEffect(() => { void load(); void loadEngines(); }, [load, loadEngines]);

  useEffect(() => {
    const engine = engineState?.engines.find((item) => item.name === selectedEngine) || null;
    setDraft(draftOf(engine));
  }, [selectedEngine, engineState]);

  const engines = engineState?.engines || [];
  const selected = useMemo(() => engines.find((item) => item.name === selectedEngine) || null, [engines, selectedEngine]);

  const runSearch = async (value: string) => {
    setQuery(value);
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
      const res = await act("knowledgeAsk", { question, limit: 6, docIds: docIds() });
      setAsk(res);
      if (res?.degraded === "no-key") setNotice("未配置 Ark key：只做了检索，不能生成回答");
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
      setNotice([
        `导入 ${ok} / ${added.length} 份`,
        failure?.message ? `失败：${failure.message}` : "",
        warnings.length ? `路由：${warnings.join("；")}` : "",
      ].filter(Boolean).join(" · "));
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const ingestText = async () => {
    setBusy(true);
    try {
      await act("knowledgeIngestText", { title: pasteTitle || "粘贴的资料", text: pasteText });
      setNotice("已存入资料库");
      setPasting(false); setPasteText(""); setPasteTitle("");
      await load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const remove = async (doc: Doc) => {
    if (!window.confirm(`删除资料「${doc.title}」？引用它的页面会被标为过期。`)) return;
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
    if (!window.confirm(`移除自研引擎「${selected.label}」？已导入的资料不受影响。`)) return;
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

  const body = (
    <div className={embedded ? "kv-embedded pr-page" : "notes-page kv-page pr-page"}>
      {!embedded && (
        <PageHeader
          kicker="MATERIALS"
          title="资料"
          subtitle={<div className="notes-stats">
            <span><b>{docs.length}</b> 资料</span>
            <span><b>{docs.filter((d) => d.status === "ready").length}</b> 已索引</span>
            <span><b>{engines.filter((e) => e.available).length}</b> 引擎可用</span>
          </div>}
          actions={<>
            <button className="btn primary" onClick={() => void ingest()} disabled={busy}>＋ 导入资料</button>
            <button className="btn" onClick={() => setPasting(true)} disabled={busy}>粘贴文本</button>
            <button className="icon-btn" onClick={() => void load()} title="刷新">↻</button>
          </>}
        />
      )}
      {(error || notice) && (
        <div className={`notes-banner ${error ? "error" : ""}`}>
          <span className="ellipsis">{error || notice}</span>
          <button className="notes-banner-x" onClick={() => { setError(""); setNotice(""); }}>×</button>
        </div>
      )}
      {pasting && (
        <div className="kv-block kv-paste">
          <div className="notes-meta-title">粘贴文本</div>
          <input className="kv-input" value={pasteTitle} placeholder="标题（可选）" onChange={(e) => setPasteTitle(e.target.value)} />
          <textarea className="kv-ask" rows={5} value={pasteText} placeholder="粘贴网页正文 / Markdown / 报告，索引后可被检索与引用" onChange={(e) => setPasteText(e.target.value)} />
          <div className="row gap6">
            <button className="btn tiny-btn" onClick={() => { setPasting(false); setPasteText(""); }}>取消</button>
            <button className="btn tiny-btn primary" disabled={busy || !pasteText.trim()} onClick={() => void ingestText()}>存入资料库</button>
          </div>
        </div>
      )}

      <div className="pr-grid">
        {/* 左：集合 + 资料（勾选决定检索范围） */}
        <aside className="pr-col">
          <div className="pr-block">
            <div className="pr-block-head">集合<button className="icon-btn" onClick={() => void load()} title="刷新">↻</button></div>
            <button className={`pr-coll ${checked.size === 0 ? "on" : ""}`} onClick={() => setChecked(new Set())}>
              全部资料<em>{docs.length}</em>
            </button>
            {[...new Set(docs.map((d) => d.parser || "文本"))].slice(0, 4).map((kind) => {
              const subset = docs.filter((d) => (d.parser || "文本") === kind);
              const on = subset.length > 0 && subset.every((d) => checked.has(d.id));
              return (
                <button key={kind} className={`pr-coll ${on ? "on" : ""}`} onClick={() => setChecked(on ? new Set() : new Set(subset.map((d) => d.id)))}>
                  {kind}<em>{subset.length}</em>
                </button>
              );
            })}
          </div>

          <div className="pr-block">
            <div className="pr-block-head">资料<button className="link tiny" onClick={toggleAll}>{allChecked ? "取消全选" : "全选"}</button></div>
            <div className="pr-docs">
              {docs.map((d) => (
                <div key={d.id} className={`pr-doc ${preview?.doc.id === d.id ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked.has(d.id)}
                    onChange={() => toggleDoc(d.id)}
                    title="参与检索与引用"
                  />
                  <button className="pr-doc-main" onClick={() => void openPreview(d)} title={d.uri}>
                    <b className="ellipsis">{d.title}</b>
                    <span className="tiny faint">
                      <span className="kv-engine-tag">{d.engine || d.parser || "builtin"}</span>
                      {" · "}{d.pages_total || 1} 页 · {d.status}
                    </span>
                  </button>
                  <RowMenu title="资料操作">
                    <button onClick={() => void openPreview(d)}>查看解析预览</button>
                    <button onClick={() => { setAskQ(`这份资料讲了什么？${d.title}`); void runAsk(); }}>就这份提问</button>
                    <button onClick={() => void reparse(d)}>按当前默认重新解析</button>
                    <button className="danger" onClick={() => void remove(d)}>删除</button>
                  </RowMenu>
                </div>
              ))}
              {docs.length === 0 && <p className="notes-meta-empty">还没有资料。导入 PDF / Word / Markdown / 网页。</p>}
            </div>
            <p className="notes-meta-empty">只有勾选的资料参与检索与引用；未勾选的仍可单独打开后提问。</p>
          </div>
        </aside>

        {/* 中：唯一主面（提问 / 回答 / 解析预览 / 命中） */}
        <section className="pr-main">
          {preview ? (
            <div className="pr-docview">
              <div className="pr-docview-head">
                <div>
                  <h2>{preview.doc.title}</h2>
                  <span className="tiny faint">
                    {preview.doc.engine || preview.doc.parser} · {preview.doc.pages_total || preview.pages.length} 页 · {preview.doc.status} · {preview.chunks} 个片段
                  </span>
                </div>
                <button className="link" onClick={() => setPreview(null)}>返回提问</button>
              </div>
              <div className="pr-pages">
                {preview.pages.slice(0, 80).map((pg) => (
                  <div key={pg.page_no} id={`kv-page-${pg.page_no}`} className={`pr-page ${pg.warn ? "warn" : ""}`}>
                    <div className="pr-ph">p{pg.page_no}{pg.heading ? ` · ${pg.heading}` : ""}</div>
                    <p>{pg.warn ? "该页只有图像，当前引擎未输出文本。可「按当前默认重新解析」或换 OCR 引擎。" : pg.text.slice(0, 900)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="pr-ask">
                <textarea
                  className="pr-ask-input"
                  rows={3}
                  value={askQ}
                  placeholder="问一个问题，只基于勾选的资料回答"
                  onChange={(e) => setAskQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runAsk(); } }}
                />
                <div className="pr-ask-row">
                  <span className="tiny faint">只基于勾选的 {checked.size || docs.length} 份资料回答 · ⌘Enter 提问</span>
                  <button className="link tiny" onClick={() => { setAskQ(""); setAsk(null); setHits([]); setPages([]); }}>清空</button>
                  <button className="btn tiny-btn primary" onClick={() => void runAsk()} disabled={busy || !askQ.trim()}>{busy ? "检索中…" : "提问 ⌘Enter"}</button>
                </div>
              </div>

              {ask && (
                <div className="pr-answer">
                  <div className="pr-answer-head">
                    <b>{ask.found ? "基于资料的回答" : "材料里没有"}</b>
                    <span className="tiny faint">{ask.citations.length} 条引用{ask.degraded ? ` · ${ask.degraded}` : ""}</span>
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
                          title={`${c.title} · ${c.locator}`}
                        >{c.ref}</button>
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
                  <p className="notes-meta-empty">答案与命中只来自勾选的资料；取消勾选后重新提问即可收窄范围。</p>
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
              <button key={c.ref} className={`pr-cite-card ${selectedCite === c.ref ? "on" : ""}`} onClick={() => selectCitation(c)}>
                <div className="pr-cc-head"><span className="kv-type">{c.ref}</span><b className="ellipsis">{c.title}</b></div>
                <span className="tiny faint">{c.locator}{c.heading ? ` · ${c.heading}` : ""} · 点击打开原页</span>
              </button>
            )) : <p className="notes-meta-empty">提问后这里显示本次回答引用的页 / 段。</p>}
          </div>

          <div className="pr-block">
            <div className="pr-block-head">解析引擎
              <button className="link tiny" onClick={() => setEngineOpen((v) => !v)}>{engineOpen ? "收起" : "配置"}</button>
            </div>
            {engineOpen ? (
              <div className="pr-engine">
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
                    className="btn tiny-btn"
                    disabled={engineBusy === `probe:${engine.name}`}
                    onClick={() => void probe(engine.name)}
                  >{engineBusy === `probe:${engine.name}` ? "…" : "探测"}</button>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn tiny-btn" onClick={() => setAdding((value) => !value)}>＋ 自研引擎</button>
        {adding && (
          <div className="kv-extra-form">
            <input className="kv-input" placeholder="引擎名，如 my-parser" value={newEngine.name} onChange={(e) => setNewEngine({ ...newEngine, name: e.target.value })} />
            <input className="kv-input" placeholder="Endpoint，如 http://127.0.0.1:9000/parse" value={newEngine.endpoint} onChange={(e) => setNewEngine({ ...newEngine, endpoint: e.target.value })} />
            <input className="kv-input" placeholder="支持格式，如 pdf,docx" value={newEngine.fileTypes} onChange={(e) => setNewEngine({ ...newEngine, fileTypes: e.target.value })} />
            <div className="kv-engine-foot">
              <span className="tiny faint">响应可为 markdown 或 JSON；JSON 默认取 markdown 字段</span>
              <button className="btn tiny-btn" onClick={() => void addEngine()} disabled={engineBusy === "add" || !newEngine.name.trim() || !newEngine.endpoint.trim()}>注册</button>
            </div>
          </div>
        )}
      </div>
      {selected && (
        <div className="kv-block">
          <div className="notes-meta-title">{selected.label}</div>
          <p className="kv-engine-desc">{selected.description}</p>
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
              {isExtra && <button className="btn tiny-btn" onClick={() => void removeEngine()} disabled={engineBusy === "remove"}>移除</button>}
              <button className="btn tiny-btn" onClick={() => void saveEngine()} disabled={engineBusy === "save"}>
                {engineBusy === "save" ? "保存中…" : "保存"}
              </button>
            </span>
          </div>
        </div>
      )}
              </div>
            ) : (
              <p className="notes-meta-empty">
                默认 {engineState?.defaultEngine || "auto"} · 可用 {engines.filter((e) => e.available).length}/{engines.length} 个引擎
              </p>
            )}
          </div>

          <div className="pr-block">
            <div className="pr-block-head">规则</div>
            <p className="notes-meta-empty">资料只读；回答只引用候选片段并标到页 / 段。</p>
            <p className="notes-meta-empty">删除资料会把引用它的页面标为过期。</p>
            <p className="notes-meta-empty">引擎输出统一成 Markdown + 页码；换引擎只需重解析，不影响已发布页面。</p>
          </div>
        </aside>
      </div>
    </div>
  );
  return body;
}
