/**
 * 混合检索：FTS5(bigram) + 向量 → RRF。
 * 没有 rerank（plan 网关不支持），靠 top_k 放大 + RRF + 邻近合并保召回。
 */

import { queryText } from "./bigram.mjs";
import { unpackVector } from "./db.mjs";

export const DEFAULTS = { ftsLimit: 30, vecLimit: 30, topK: 8, rrfK: 60 };

/** 关键词检索。bm25 越小越相关，这里转成越大越好。 */
export function ftsSearch(db, query, { limit = DEFAULTS.ftsLimit, kb, docIds } = {}) {
  const match = queryText(query);
  if (!match) return [];
  const params = [match];
  let sql = `
    SELECT c.id, c.doc_id, c.page_no, c.heading, c.text, bm25(chunk_fts) AS rank
    FROM chunk_fts JOIN chunks c ON c.id = chunk_fts.rowid
    WHERE chunk_fts MATCH ? AND c.id IS NOT NULL`;
  if (kb) { sql += " AND c.doc_id IN (SELECT id FROM documents WHERE kb = ?)"; params.push(kb); }
  if (docIds?.length) { sql += ` AND c.doc_id IN (${docIds.map(() => "?").join(",")})`; params.push(...docIds); }
  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map((row) => ({
    chunk_id: row.id,
    doc_id: row.doc_id,
    page_no: row.page_no,
    heading: row.heading,
    text: row.text,
    score: -Number(row.rank || 0),   // bm25 取负 → 越大越相关
    source: "fts",
  }));
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * 向量检索：暴力 cosine。
 * 实测 Electron 内置 Node：20k × 1024 维 ≈ 15ms/query，够用到十万级。
 */
export function vectorSearch(db, queryVec, { limit = DEFAULTS.vecLimit, kb, docIds } = {}) {
  if (!queryVec?.length) return [];
  const params = [];
  let sql = `SELECT v.chunk_id, v.dim, v.vec FROM chunk_vec v
             JOIN chunks c ON c.id = v.chunk_id WHERE v.dim = ?`;
  params.push(queryVec.length);
  if (kb) { sql += " AND c.doc_id IN (SELECT id FROM documents WHERE kb = ?)"; params.push(kb); }
  if (docIds?.length) { sql += ` AND c.doc_id IN (${docIds.map(() => "?").join(",")})`; params.push(...docIds); }
  const rows = db.prepare(sql).all(...params);
  if (!rows.length) return [];

  const scored = [];
  for (const row of rows) {
    const score = cosine(queryVec, unpackVector(row.vec));
    scored.push({ chunk_id: row.chunk_id, score, source: "vec" });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const meta = new Map();
  if (top.length) {
    const ids = top.map((t) => t.chunk_id);
    const detail = db
      .prepare(`SELECT id, doc_id, page_no, heading, text FROM chunks WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids);
    for (const row of detail) meta.set(row.id, row);
  }
  return top.map((t) => {
    const row = meta.get(t.chunk_id) || {};
    return {
      chunk_id: t.chunk_id,
      doc_id: row.doc_id,
      page_no: row.page_no,
      heading: row.heading,
      text: row.text,
      score: t.score,
      source: "vec",
    };
  });
}

/** Reciprocal Rank Fusion：不需要分数量纲对齐。 */
export function rrf(lists, { k = DEFAULTS.rrfK } = {}) {
  const merged = new Map();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const prev = merged.get(hit.chunk_id);
      const add = 1 / (k + rank + 1);
      if (prev) {
        prev.score += add;
        prev.sources.push(hit.source);
        if (hit.score > prev.best) prev.best = hit.score;
      } else {
        merged.set(hit.chunk_id, { ...hit, score: add, sources: [hit.source], best: hit.score });
      }
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

/** 同文档相邻 chunk 合并成一段，避免引用里出现三条连续碎片。 */
export function mergeAdjacent(hits, limit) {
  const out = [];
  const seenDocs = new Map();
  for (const hit of hits) {
    const prev = out[out.length - 1];
    const sameDoc = prev && prev.doc_id === hit.doc_id && Math.abs((prev.page_no || 0) - (hit.page_no || 0)) <= 1;
    if (sameDoc && out.length <= limit * 2) {
      prev.text = `${prev.text}\n…\n${hit.text}`;
      prev.merged = (prev.merged || 1) + 1;
      continue;
    }
    const count = seenDocs.get(hit.doc_id) || 0;
    if (count >= 3) continue;   // 同一文档最多 3 条，防止单文档刷屏
    seenDocs.set(hit.doc_id, count + 1);
    out.push({ ...hit });
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/**
 * 对外唯一入口。
 * @param {object} db
 * @param {string} query
 * @param {{ queryVec?: Float32Array, limit?: number, kb?: string, docIds?: string[], mode?: "hybrid"|"fts" }} [opts]
 */
export function search(db, query, { queryVec, limit = DEFAULTS.topK, kb, docIds, mode = "hybrid" } = {}) {
  const fts = ftsSearch(db, query, { limit: DEFAULTS.ftsLimit, kb, docIds });
  const useVec = mode !== "fts" && queryVec?.length;
  const vec = useVec ? vectorSearch(db, queryVec, { limit: DEFAULTS.vecLimit, kb, docIds }) : [];
  const fused = vec.length ? rrf([fts, vec]) : fts;
  return {
    hits: mergeAdjacent(fused, limit),
    ftsCount: fts.length,
    vecCount: vec.length,
    degraded: mode === "hybrid" && !useVec ? "no-vector" : null,
  };
}
