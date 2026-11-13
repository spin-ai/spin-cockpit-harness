/**
 * 知识模块门面：一个 kb.db + 一批方法。
 *
 *   const kb = createKnowledge({ dir, arkKey });
 *   await kb.ingestFile({ source });
 *   const { answer, citations } = await kb.ask("知识库检索方案怎么定的");
 *
 * 约定：正文/原文件是事实源，kb.db 可删（删了重新 ingest 即可）。
 */

import fs from "node:fs";
import path from "node:path";
import { openKnowledgeDb, stats } from "./db.mjs";
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
  dir, arkKey, embed = true, logger = console,
  // Electron 主进程传入 safeStorage 适配器；自检脚本不传则退化为明文
  engineSeal, engineOpen, engineFetchImpl, engineConfig,
} = {}) {
  const root = dir || path.join(process.cwd(), ".knowledge");
  fs.mkdirSync(root, { recursive: true });
  const db = openKnowledgeDb(path.join(root, "kb.db"));
  const filesDir = path.join(root, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const key = resolveArkKey(arkKey);
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

  const canEmbed = () => Boolean(embed && key);

  async function queryVector(queryText) {
    if (!canEmbed()) return null;
    const { vectors } = await arkEmbed([queryText], { key });
    return vectors[0] || null;
  }

  /**
   * @param {string} query
   * @param {{ limit?: number, kb?: string, mode?: "hybrid"|"fts" }} [opts]
   */
  async function search(query, opts = {}) {
    let queryVec = null;
    let degraded = null;
    if ((opts.mode || "hybrid") !== "fts") {
      try {
        queryVec = await queryVector(query);
        if (!queryVec) degraded = "no-key";
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
  async function ask(question, { limit = 6, kb, model = MODELS.fast } = {}) {
    const { hits, degraded } = await search(question, { limit, kb });
    if (!hits.length) {
      return { answer: "材料里没有找到相关内容。", citations: [], hits: [], found: false, degraded };
    }
    const context = hits
      .map((h, i) => `[${i + 1}] ${h.heading ? `（${h.heading}）` : ""}\n${h.text}`)
      .join("\n\n");
    if (!key) {
      return { answer: "缺少 Ark API key，无法生成回答。", citations: [], hits, found: false, degraded: "no-key" };
    }
    const res = await arkChat(
      [
        { role: "system", content: ANSWER_SYSTEM },
        { role: "user", content: `候选片段：\n${context}\n\n问题：${question}` },
      ],
      { key, model, maxTokens: 800 }
    );
    const used = new Set();
    for (const m of res.text.matchAll(/\[(\d+)\]/g)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= hits.length) used.add(n);
    }
    const citations = [...used].sort((a, b) => a - b).map((n) => {
      const h = hits[n - 1];
      return {
        ref: n,
        doc_id: h.doc_id,
        chunk_id: h.chunk_id,
        page_no: h.page_no,
        heading: h.heading,
        quote: String(h.text || "").slice(0, 200),
        locator: `p${h.page_no ?? 1}`,
      };
    });
    return {
      answer: res.text,
      citations,
      hits,
      found: citations.length > 0,
      degraded,
      usage: res.usage,
      model: res.model,
    };
  }

  return {
    root,
    db,
    filesDir,
    hasKey: Boolean(key),
    status: () => stats(db),
    probe: () => arkProbe({ key }),
    search,
    ask,
    listDocuments: ({ kb, limit = 200 } = {}) => {
      const params = [];
      let sql = `SELECT id, kb, uri, title, kind, parser, engine, pages_total, status, index_mode,
                        error_code, error_text, created_at, indexed_at
                 FROM documents WHERE deleted_at IS NULL`;
      if (kb) { sql += " AND kb = ?"; params.push(kb); }
      sql += " ORDER BY COALESCE(indexed_at, created_at) DESC LIMIT ?";
      params.push(Math.max(1, Math.min(1000, Number(limit) || 200)));
      return db.prepare(sql).all(...params);
    },
    ingestFile: (file, opts = {}) => ingestFile(
      db,
      { ...file, source: file.source },
      { embed: canEmbed(), arkKey: key, parse: parseDocument, ...opts }
    ),
    ingestText: (doc, opts = {}) => ingestText(db, doc, { embed: canEmbed(), arkKey: key, ...opts }),
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
