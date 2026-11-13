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
type Cite = { index: number; title: string; page_no: number | null; locator: string };
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
export function Knowledge({ act, onOpenPage, onOpenWiki }: {
  act: Act;
  /** 命中页面：带着页面 id 切到「知识库」 */
  onOpenPage?: (id: string) => void;
  onOpenWiki?: () => void;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [pages, setPages] = useState<WikiHit[]>([]);
  const [query, setQuery] = useState("");
  const [askQ, setAskQ] = useState("");
  const [ask, setAsk] = useState<{ answer: string; citations: Cite[]; found: boolean; degraded?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<string>("");
  const [draft, setDraft] = useState<Draft>({ endpoint: "", apiKey: "", token: "", timeoutMs: 600_000 });
  const [engineBusy, setEngineBusy] = useState("");
  const [probes, setProbes] = useState<Record<string, { available: boolean; reason: string }>>({});
  const [adding, setAdding] = useState(false);
  const [newEngine, setNewEngine] = useState({ name: "", endpoint: "", fileTypes: "pdf,docx" });

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

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
      const res = await act("knowledgeSearch", { query: value, limit: 12 });
      setHits(res?.hits || []);
      // 资料与页面同一次查询：页面走 wiki 搜索，结果标类型
      try {
        const wiki = await act("pluginInvoke", { pluginId: "ai.cockpit.notes", method: "wiki.search", args: { query: value, limit: 8 } });
        setPages((wiki || []).map((h: WikiHit) => ({ ...h })));
      } catch { setPages([]); }
    } catch (err) { fail(err); }
  };

  const runAsk = async () => {
    if (!askQ.trim()) return;
    setBusy(true); setAsk(null);
    try {
      const res = await act("knowledgeAsk", { question: askQ.trim(), limit: 6 });
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

  return (
    <div className="notes-page kv-page">
      <PageHeader
        kicker="MATERIALS"
        title="资料"
        subtitle={<div className="notes-stats"><span><b>{docs.length}</b> 资料</span><span><b>{docs.filter((d) => d.status === "ready").length}</b> 已索引</span><span><b>{engines.filter((e) => e.available).length}</b> 引擎可用</span><span className="kv-hint">原始材料只读；页面在「知识库」</span></div>}
        actions={<>
          <button className="btn primary" onClick={() => void ingest()} disabled={busy}>＋ 导入资料</button>
          <button className="btn" onClick={onOpenWiki} title="整理后的页面在知识库">打开知识库</button>
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
          <div className="notes-search-wrap">
            <input
              className="notes-search"
              value={query}
              placeholder="一条查询同时搜资料与页面"
              onChange={(e) => void runSearch(e.target.value)}
            />
          </div>
          {ask && (
            <div className="kv-answer">
              <div className="kv-answer-head">
                <b>{ask.found ? "基于资料的回答" : "材料里没有"}</b>
                <span className="tiny faint">{ask.citations.length} 条引用{ask.degraded ? ` · ${ask.degraded}` : ""}</span>
              </div>
              <div className="kv-answer-body">{ask.answer}</div>
              {ask.citations.length > 0 && (
                <div className="kv-cites">
                  {ask.citations.map((c) => <span key={`${c.index}-${c.title}`} className="kv-cite">[{c.index}] {c.title} · {c.locator || `p${c.page_no ?? 1}`}</span>)}
                </div>
              )}
            </div>
          )}
          {!query && !ask && docs.length === 0 && (
            <EmptyState mark="⌘" title="还没有资料" desc="导入 PDF / Word / Markdown / 网页，问答只基于这些材料，并给出页码出处。" action={<button className="btn primary" onClick={() => void ingest()} disabled={busy}>导入第一份资料</button>} />
          )}
          {(hits.length > 0 || pages.length > 0) && (
            <div className="kv-hits">
              {hits.map((h) => (
                <div className="kv-hit" key={`${h.doc_id}-${h.page_no}-${h.text.slice(0, 12)}`}>
                  <span className="kv-type">资料</span>
                  <div>
                    <b>{h.title}</b>
                    <span className="kv-hit-loc">{h.heading ? `${h.heading} · ` : ""}p{h.page_no ?? 1}</span>
                    <p>{h.text.slice(0, 220)}</p>
                  </div>
                </div>
              ))}
              {pages.map((h) => (
                <button className="kv-hit" key={h.id} onClick={() => onOpenPage?.(h.id)}>
                  <span className="kv-type page">页面</span>
                  <div><b>{h.title}</b><p>{h.snippet}</p></div>
                </button>
              ))}
            </div>
          )}
          {!query && docs.length > 0 && (
            <div className="kv-docs">
              {docs.map((d) => {
                const engine = d.engine || d.parser || "builtin";
                return (
                  <div className="kv-doc" key={d.id}>
                    <span className={`kv-doc-dot ${d.status}`} />
                    <div className="kv-doc-main">
                      <b className="ellipsis" title={d.uri}>{d.title}</b>
                      <span className="tiny faint">
                        <span className="kv-engine-tag">{engine}</span>
                        {" · "}{d.pages_total || 1} 页 · {d.status}
                        {d.status === "failed" && d.error_text ? ` · ${d.error_text.slice(0, 60)}` : ""}
                      </span>
                    </div>
                    <RowMenu title="资料操作">
                      <button onClick={() => { setAskQ(`这份资料讲了什么？${d.title}`); void runAsk(); }}>就这份资料提问</button>
                      <button onClick={() => void reparse(d)}>按当前默认重新解析</button>
                      <button className="danger" onClick={() => void remove(d)}>删除</button>
                    </RowMenu>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <aside className="kv-side">
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
          <div className="kv-block">
            <div className="notes-meta-title">问资料</div>
            <textarea
              className="kv-ask"
              rows={4}
              value={askQ}
              placeholder="只基于已导入的材料回答；没有依据会说「材料里没有」"
              onChange={(e) => setAskQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void runAsk(); } }}
            />
            <button className="btn tiny-btn primary" onClick={() => void runAsk()} disabled={busy || !askQ.trim()}>{busy ? "检索中…" : "提问 ⌘Enter"}</button>
          </div>
          <div className="kv-block">
            <div className="notes-meta-title">规则</div>
            <p className="notes-meta-empty">资料只读；回答只引用候选片段，并标到页 / 段。删除资料会把引用它的页面标为过期。</p>
            <p className="notes-meta-empty">引擎输出统一成 Markdown + 页码。自研引擎只需实现同一份注册接口，不需要改路由。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
