/**
 * 摄入管道：hash 去重 → 解析 → 分块 → 关键词索引 → 向量索引。
 * 状态机：queued → parsing → indexing → ready / failed，源文件变化 → stale。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bigramText } from "./bigram.mjs";
import { chunkPages } from "./chunk.mjs";
import { parseFile, needsVlm } from "./parse.mjs";
import { packVector } from "./db.mjs";
import { embed as arkEmbed, MODELS } from "./ark.mjs";

export function hashFile(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function now() {
  return Date.now();
}

function upsertDocument(db, doc) {
  db.prepare(
    `INSERT INTO documents(id, kb, uri, title, kind, mime, parser, engine, file_hash, pages_total,
                           status, index_mode, error_code, error_text, created_at, indexed_at, deleted_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       uri=excluded.uri, title=excluded.title, mime=excluded.mime, parser=excluded.parser,
       engine=excluded.engine,
       file_hash=excluded.file_hash, pages_total=excluded.pages_total, status=excluded.status,
       index_mode=excluded.index_mode, error_code=excluded.error_code, error_text=excluded.error_text,
       indexed_at=excluded.indexed_at, deleted_at=excluded.deleted_at`
  ).run(
    doc.id, doc.kb, doc.uri, doc.title ?? null, doc.kind ?? "file", doc.mime ?? null,
    doc.parser ?? null, doc.engine ?? null, doc.file_hash ?? null, doc.pages_total ?? 0,
    doc.status, doc.index_mode ?? null, doc.error_code ?? null, doc.error_text ?? null,
    doc.created_at ?? now(), doc.indexed_at ?? null, doc.deleted_at ?? null
  );
}

function clearChunks(db, docId) {
  db.prepare("DELETE FROM chunk_fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = ?)").run(docId);
  db.prepare("DELETE FROM chunk_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id = ?)").run(docId);
  db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(docId);
}

function insertChunks(db, docId, chunks) {
  const insert = db.prepare(
    "INSERT INTO chunks(doc_id, page_no, heading, char_start, char_end, text) VALUES(?,?,?,?,?,?)"
  );
  const insertFts = db.prepare("INSERT INTO chunk_fts(rowid, bigram) VALUES(?, ?)");
  const ids = [];
  for (const c of chunks) {
    const info = insert.run(docId, c.page_no, c.heading, c.char_start, c.char_end, c.text);
    const id = Number(info.lastInsertRowid);
    insertFts.run(id, bigramText(`${c.heading}\n${c.text}`));
    ids.push(id);
  }
  return ids;
}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ id: string, source: string, kb?: string, title?: string, engine?: string }} file
 * @param {{
 *   embed?: boolean, arkKey?: string, vlm?: (pages: any[]) => Promise<any[]>,
 *   parse?: (file: string, opts: { engine?: string }) => Promise<{ pages: any[], parser?: string, engine?: string }>,
 * }} [opts]
 */
export async function ingestFile(db, { id, source, kb = "default", title, engine }, { embed = false, arkKey, vlm, parse } = {}) {
  const docId = id || crypto.randomUUID();
  const doc = {
    id: docId,
    kb,
    uri: source,
    title: title || path.basename(source),
    kind: "file",
    mime: path.extname(source).toLowerCase(),
    engine: engine || null,
    file_hash: hashFile(source),
    status: "parsing",
    index_mode: embed ? "cloud-vector" : "local-fts-only",
    created_at: now(),
  };

  const existing = db
    .prepare("SELECT id, file_hash, status FROM documents WHERE kb = ? AND file_hash = ? AND deleted_at IS NULL")
    .get(kb, doc.file_hash);
  if (existing && existing.id !== docId) {
    return { ok: true, skipped: "duplicate", docId: existing.id };
  }

  upsertDocument(db, doc);
  try {
    const parsed = typeof parse === "function"
      ? await parse(source, { engine })
      : { ...(await parseFile(source)), engine: engine || "builtin" };
    let { pages, parser } = parsed;
    const usedEngine = parsed.engine || engine || "builtin";
    if (!pages?.length) throw Object.assign(new Error("解析结果为空"), { code: "empty" });

    // 扫描件 / 图片型 PDF：交给 VLM 兜底（可选）
    if (needsVlm(pages) && typeof vlm === "function") {
      pages = await vlm(pages);
      parser = `${parser}+vlm`;
    }

    const chunks = chunkPages(pages);
    if (!chunks.length) throw Object.assign(new Error("没有可索引的分块"), { code: "no-chunks" });

    db.exec("BEGIN");
    clearChunks(db, docId);
    const chunkIds = insertChunks(db, docId, chunks);
    db.exec("COMMIT");

    let indexMode = "local-fts-only";
    if (embed) {
      upsertDocument(db, { ...doc, engine: usedEngine, parser, pages_total: pages.length, status: "indexing", index_mode: "cloud-vector" });
      const res = await arkEmbed(chunks.map((c) => `${c.heading}\n${c.text}`), { key: arkKey });
      if (res.vectors.length !== chunkIds.length) {
        throw Object.assign(new Error(`向量数量不匹配：${res.vectors.length}/${chunkIds.length}`), { code: "embed-short" });
      }
      const insertVec = db.prepare("INSERT OR REPLACE INTO chunk_vec(chunk_id, dim, vec) VALUES(?,?,?)");
      db.exec("BEGIN");
      chunkIds.forEach((cid, i) => insertVec.run(cid, res.dim, packVector(res.vectors[i])));
      db.exec("COMMIT");
      db.prepare("INSERT INTO meta(k, v) VALUES('embedding_model', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
        .run(res.model || MODELS.embed);
      db.prepare("INSERT INTO meta(k, v) VALUES('embedding_dim', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
        .run(String(res.dim));
      indexMode = "cloud-vector";
    }

    upsertDocument(db, {
      ...doc,
      engine: usedEngine,
      parser,
      pages_total: pages.length,
      status: "ready",
      index_mode: indexMode,
      indexed_at: now(),
    });
    return {
      ok: true, docId, chunks: chunks.length, pages: pages.length,
      parser, engine: usedEngine, indexMode, route: parsed.route || null,
    };
  } catch (error) {
    upsertDocument(db, {
      ...doc,
      engine: error.engine || doc.engine,
      status: "failed",
      error_code: error.code || "parse-error",
      error_text: String(error.message || error).slice(0, 500),
    });
    return {
      ok: false, docId, code: error.code || "parse-error", message: error.message,
      engine: error.engine || engine || null,
    };
  }
}

/** 纯文本摄入（网页正文 / 剪藏 / 笔记片段）。 */
export async function ingestText(db, { id, kb = "default", title, markdown, uri }, { embed = false, arkKey } = {}) {
  const docId = id || crypto.randomUUID();
  const hash = crypto.createHash("sha256").update(String(markdown || "")).digest("hex");
  const doc = {
    id: docId, kb, uri: uri || `text:${docId}`, title: title || "未命名",
    kind: "text", mime: "text/markdown", parser: "text", engine: "simple", file_hash: hash,
    status: "parsing", index_mode: embed ? "cloud-vector" : "local-fts-only", created_at: now(),
  };
  const existing = db
    .prepare("SELECT id FROM documents WHERE kb = ? AND file_hash = ? AND deleted_at IS NULL")
    .get(kb, hash);
  if (existing && existing.id !== docId) return { ok: true, skipped: "duplicate", docId: existing.id };

  upsertDocument(db, doc);
  try {
    const pages = [{ page_no: 1, markdown: String(markdown || "") }];
    const chunks = chunkPages(pages);
    db.exec("BEGIN");
    clearChunks(db, docId);
    const chunkIds = insertChunks(db, docId, chunks);
    db.exec("COMMIT");

    let indexMode = "local-fts-only";
    if (embed && chunkIds.length) {
      const res = await arkEmbed(chunks.map((c) => `${c.heading}\n${c.text}`), { key: arkKey });
      const insertVec = db.prepare("INSERT OR REPLACE INTO chunk_vec(chunk_id, dim, vec) VALUES(?,?,?)");
      db.exec("BEGIN");
      chunkIds.forEach((cid, i) => insertVec.run(cid, res.dim, packVector(res.vectors[i])));
      db.exec("COMMIT");
      indexMode = "cloud-vector";
    }
    upsertDocument(db, { ...doc, pages_total: 1, status: "ready", index_mode: indexMode, indexed_at: now() });
    return { ok: true, docId, chunks: chunks.length, pages: 1, parser: "text", indexMode };
  } catch (error) {
    upsertDocument(db, { ...doc, status: "failed", error_code: error.code || "index-error", error_text: String(error.message).slice(0, 500) });
    return { ok: false, docId, code: error.code || "index-error", message: error.message };
  }
}

/** 软删除：文档下线，引用它的页面应标 stale（由调用方触发）。 */
export function removeDocument(db, docId) {
  db.prepare("UPDATE documents SET status = 'deleted', deleted_at = ? WHERE id = ?").run(now(), docId);
  clearChunks(db, docId);
  return { ok: true, docId };
}

/** 源文件变化：标 stale，等用户点重建。 */
export function markStale(db, docId) {
  db.prepare("UPDATE documents SET status = 'stale' WHERE id = ?").run(docId);
}
