/**
 * 知识模块门面：一个 kb.db + 一批方法。
 *
 *   const kb = createKnowledge({ dir, arkKey: () => process.env.ARK_API_KEY });
 *   await kb.ingestFile({ source });
 *   const { answer, citations } = await kb.ask("知识库检索方案怎么定的");
 *
 * 隐私：`embed` 默认关闭（= 只做本地关键词索引，一个字节不出网）。
 * 只有用户显式打开「云端向量索引」后，正文分块与查询串才会发往 Ark embedding。
 * `embed` / `arkKey` 都接受函数，便于设置页开关即时生效（不用重建 store）。
 *
 * 约定：正文/原文件是事实源，kb.db 可删（删了重新 ingest 即可）。
 */

import fs from "node:fs";
import path from "node:path";
import { openKnowledgeDb, stats } from "./db.mjs";
import { pageImage } from "./pageimage.mjs";
import { ingestFile, ingestText, removeDocument, markStale, hashFile } from "./ingest.mjs";
import { search as runSearch } from "./search.mjs";
import { embed as arkEmbed, chat as arkChat, resolveArkKey, probe as arkProbe, MODELS } from "./ark.mjs";
import { createEngineConfigStore } from "./engines/config.mjs";
import { createEngineRegistry } from "./engines/registry.mjs";

const ANSWER_SYSTEM = `你是资料检索助手。只能根据给出的候选片段回答，不允许使用片段之外的知识。
规则：
1. 每条结论后标注来源编号，格式如 [1] 或 [2][5]；
2. 片段里没有依据时，直接回答「材料里没有找到相关内容」，不要猜测、不要补全；
3. 不要输出片段原文的整段抄写，只做归纳；
4. 使用与提问相同的语言作答。`;

export function createKnowledge({
  dir, arkKey, embed = false, logger = console,
  // Electron 主进程传入 safeStorage 适配器；自检脚本不传则退化为明文
  engineSeal, engineOpen, engineFetchImpl, engineConfig,
} = {}) {
  const root = dir || path.join(process.cwd(), ".knowledge");
  fs.mkdirSync(root, { recursive: true });
  const db = openKnowledgeDb(path.join(root, "kb.db"));
  const filesDir = path.join(root, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const embedOn = () => (typeof embed === "function" ? Boolean(embed()) : Boolean(embed));
  /** 每次都重新解析：设置里改了 ARK_API_KEY 或开关，不用重启进程 */
  const keyOf = () => resolveArkKey(typeof arkKey === "function" ? arkKey() : arkKey);
  const engineConfigStore = createEngineConfigStore({
    file: path.join(root, "engines.json"),
    seal: engineSeal,
    open: engineOpen,
    logger,
  });
  if (engineConfig) engineConfigStore.save(engineConfig);
  let registry = createEngineRegistry({
    configStore: engineConfigStore,
    logger,
    fetchImpl: engineFetchImpl,
  });
  const parseDocument = (file, { engine } = {}) => registry.parse({ file, engine });

  const canEmbed = () => Boolean(embedOn() && keyOf());

  async function queryVector(queryText) {
    if (!canEmbed()) return null;
    const { vectors } = await arkEmbed([queryText], { key: keyOf() });
    return vectors[0] || null;
  }

  /**
   * @param {string} query
   * @param {{ limit?: number, kb?: string, mode?: "hybrid"|"fts" }} [opts]
   */
  async function search(query, opts = {}) {
    const docIds = Array.isArray(opts.docIds) ? opts.docIds.filter(Boolean) : null;
    let queryVec = null;
    let degraded = null;
    if ((opts.mode || "hybrid") !== "fts") {
      try {
        queryVec = await queryVector(query);
        // 区分两种降级：没开云向量 vs 开了但缺 key —— UI 文案不同
        if (!queryVec) degraded = embedOn() ? "no-key" : "fts-only";
      } catch (e) {
        degraded = e.code || "embed-failed";
        logger?.warn?.(`[knowledge] query embedding 失败：${e.message}`);
      }
    }
    const res = runSearch(db, query, { ...opts, queryVec, mode: queryVec ? "hybrid" : "fts" });
    return { ...res, degraded: res.degraded || degraded };
  }

  /**
   * 带引用的问答。候选片段是唯一事实来源。
   * @param {string} question
   * @param {{ limit?: number, kb?: string, model?: string }} [opts]
   */
  async function ask(question, { limit = 6, kb, model = MODELS.fast, docIds, extra = [], includeDocs = true } = {}) {
    const { hits, degraded } = includeDocs
      ? await search(question, { limit, kb, docIds })
      : { hits: [], degraded: null };
    // 页面候选（wiki 侧）与资料候选共用同一个编号空间：答案里可以同时引用两边
    const pages = extra.slice(0, 4).map((e) => ({
      kind: "page",
      page_id: e.id,
      doc_id: null, chunk_id: null, page_no: null,
      heading: e.title,
      text: String(e.text || "").slice(0, 1200),
      score: 0, source: "page",
    }));
    const candidates = [...pages, ...hits.map((h) => ({ ...h, kind: "doc" }))];
    if (!candidates.length) {
      return { answer: "材料里没有找到相关内容。", citations: [], hits: [], found: false, degraded };
    }
    const context = candidates
      .map((h, i) => `[${i + 1}] ${h.heading ? `（${h.heading}）` : ""}\n${h.text}`)
      .join("\n\n");
    if (!keyOf()) {
      return { answer: "缺少 Ark API key，无法生成回答。", citations: [], hits: candidates, found: false, degraded: "no-key" };
    }
    const res = await arkChat(
      [
        { role: "system", content: ANSWER_SYSTEM },
        { role: "user", content: `候选片段：\n${context}\n\n问题：${question}` },
      ],
      { key: keyOf(), model, maxTokens: 800 }
    );
    const used = new Set();
    for (const m of res.text.matchAll(/\[(\d+)\]/g)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= candidates.length) used.add(n);
    }
    const citations = [...used].sort((a, b) => a - b).map((n) => {
      const h = candidates[n - 1];
      return {
        ref: n,
        kind: h.kind,
        page_id: h.page_id ?? null,
        title: h.kind === "page"
          ? h.heading
          : (h.title || (db.prepare("SELECT title FROM documents WHERE id=?").get(h.doc_id)?.title ?? "")),
        doc_id: h.doc_id,
        chunk_id: h.chunk_id,
        page_no: h.page_no,
        heading: h.heading,
        quote: String(h.text || "").slice(0, 200),
        locator: h.kind === "page" ? "页面" : `p${h.page_no ?? 1}`,
      };
    });
    return {
      answer: res.text,
      citations,
      hits: candidates,
      found: citations.length > 0,
      degraded,
      usage: res.usage,
      model: res.model,
    };
  }

  /** 文档解析预览：按页给出片段；缺口页标 warn（多是纯图/扫描件未识别） */
  function preview(docId, { maxChars = 4000 } = {}) {
    const doc = db.prepare("SELECT id, title, uri, parser, pages_total, status, indexed_at, error_text FROM documents WHERE id = ?").get(docId);
    if (!doc) return null;
    const rows = db.prepare("SELECT page_no, heading, text FROM chunks WHERE doc_id = ? ORDER BY COALESCE(page_no,0), COALESCE(char_start,0)").all(docId);
    const byPage = new Map();
    for (const r of rows) {
      const page = Number(r.page_no || 1);
      if (!byPage.has(page)) byPage.set(page, { page_no: page, heading: r.heading || "", text: "" });
      const slot = byPage.get(page);
      if (r.heading && !slot.heading) slot.heading = r.heading;
      slot.text = `${slot.text}${slot.text ? "\n" : ""}${r.text || ""}`.slice(0, maxChars);
    }
    const total = Math.max(Number(doc.pages_total) || 0, ...byPage.keys(), 1);
    const pages = [];
    for (let i = 1; i <= total; i += 1) {
      const hit = byPage.get(i);
      pages.push(hit
        ? { page_no: i, heading: hit.heading, text: hit.text, warn: !hit.text.trim() }
        : { page_no: i, heading: "", text: "", warn: true });
    }
    return { doc, pages, chunks: rows.length };
  }

  /**
   * 记录一条「页面 → 资料」引用快照：删除文档后仍可追溯引用了哪一页/哪一段。
   * @returns {{ok: boolean, id: string}}
   */
  function cite({ pageId, docId, chunkId = null, pageNo = null, quote = "", locator = "" } = {}) {
    if (!pageId || !docId) throw new Error("缺少 pageId 或 docId");
    const id = `cite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO citations(id, from_kind, from_id, to_kind, to_id, doc_id, page_no, chunk_id, quote, locator, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, "page", String(pageId), "doc", String(docId), String(docId), pageNo, chunkId, String(quote || "").slice(0, 1000), String(locator || ""), Date.now());
    return { ok: true, id };
  }

  /** 某份资料被哪些页面引用过（删除资料时用来精确标 stale）。 */
  function citationsOfDoc(docId) {
    return db.prepare("SELECT from_id AS pageId, page_no AS pageNo, locator FROM citations WHERE to_kind='doc' AND to_id=?").all(String(docId || ""));
  }

  /**
   * 页图（引用点开看原页）。结果落盘缓存，二次打开不再渲染。
   * @returns {Promise<{dataUrl: string, cached: boolean, bytes: number, width: number, height: number} | null>}
   */
  async function pageImageOf(docId, pageNo = 1, { scale = 1.6 } = {}) {
    const doc = db.prepare("SELECT id, uri, kind FROM documents WHERE id = ?").get(String(docId || ""));
    if (!doc?.uri) return null;
    const dir = path.join(root, "files", doc.id);
    const cacheFile = path.join(dir, `p${Math.max(1, Number(pageNo) || 1)}.png`);
    if (fs.existsSync(cacheFile)) {
      const buf = fs.readFileSync(cacheFile);
      return { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, cached: true, bytes: buf.length, width: 0, height: 0 };
    }
    const img = await pageImage(doc.uri, pageNo, { scale });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile, img.buffer);
    return {
      dataUrl: `data:${img.mime || "image/png"};base64,${img.buffer.toString("base64")}`,
      cached: false,
      bytes: img.buffer.length,
      width: img.width,
      height: img.height,
    };
  }

  return {
    root,
    db,
    preview,
    pageImage: pageImageOf,
    cite,
    citationsOfDoc,
    filesDir,
    get hasKey() { return Boolean(keyOf()); },
    /** 索引模式：UI 用它显示「本地 / 云端」并决定是否给上传提示 */
    embeddingInfo: () => ({
      enabled: embedOn(),
      available: canEmbed(),
      hasKey: Boolean(keyOf()),
      model: MODELS.embed,
    }),
    status: () => stats(db),
    probe: () => arkProbe({ key: keyOf() }),
    search,
    ask,
    listDocuments: ({ kb, limit = 200 } = {}) => {
      const params = [];
      let sql = `SELECT id, kb, uri, title, kind, parser, engine, pages_total, status, index_mode,
                        error_code, error_text, created_at, indexed_at
                 FROM documents WHERE deleted_at IS NULL`;
      if (kb) { sql += " AND kb = ?"; params.push(kb); }
      // 按「导入时间」排，不按 indexed_at：重新解析会刷新 indexed_at，
      // 用它排序会让资料在重解析 / 换引擎后突然跳到最前面，看起来像「一操作就乱序」。
      // rowid 兜底，同一毫秒导入的多份资料也有稳定次序。
      sql += " ORDER BY COALESCE(created_at, indexed_at, 0) DESC, rowid DESC LIMIT ?";
      params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
      return db.prepare(sql).all(...params);
    },
    ingestFile: (file, opts = {}) => ingestFile(
      db,
      { ...file, source: file.source },
      { embed: canEmbed(), arkKey: keyOf(), parse: parseDocument, ...opts }
    ),
    ingestText: (doc, opts = {}) => ingestText(db, doc, { embed: canEmbed(), arkKey: keyOf(), ...opts }),
    remove: (docId) => removeDocument(db, docId),
    engines: () => ({ ...engineConfigStore.public(), engines: registry.list() }),
    probeEngine: (name) => registry.probe(String(name || "")),
    setEngineConfig: ({ name, patch, defaultEngine, fallbackEngine } = {}) => {
      if (name) engineConfigStore.updateEngine(String(name), patch || {});
      const globalPatch = {};
      if (defaultEngine) globalPatch.defaultEngine = String(defaultEngine);
      if (fallbackEngine) globalPatch.fallbackEngine = String(fallbackEngine);
      if (Object.keys(globalPatch).length) engineConfigStore.save(globalPatch);
      registry.reload();
      return { ...engineConfigStore.public(), engines: registry.list() };
    },
    addEngine: (spec) => {
      engineConfigStore.addExtra(spec || {});
      registry.reload();
      return { ...engineConfigStore.public(), engines: registry.list() };
    },
    removeEngine: (name) => {
      engineConfigStore.removeExtra(String(name || ""));
      registry.reload();
      return { ...engineConfigStore.public(), engines: registry.list() };
    },
    engineConfigPath: engineConfigStore.file,
    parseDocument,
    markStale: (docId) => markStale(db, docId),
    hashFile,
    close: () => db.close(),
  };
}
