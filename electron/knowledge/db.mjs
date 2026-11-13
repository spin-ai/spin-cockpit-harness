/**
 * 知识索引库：node:sqlite（Electron 45 / Node 24 内置，FTS5 可用，零原生依赖）。
 *
 * 事实源永远是原文件与 wiki 正文；kb.db 只是可重建的索引。
 * 删掉 kb.db 不会丢任何用户内容。
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- 材料侧（只读）
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  kb TEXT NOT NULL DEFAULT 'default',
  uri TEXT NOT NULL,
  title TEXT,
  kind TEXT,                 -- file | url | text
  mime TEXT,
  parser TEXT,
  engine TEXT,               -- simple | builtin | mineru | mineru_cloud | paddleocr_vl | ...
  file_hash TEXT,
  pages_total INTEGER DEFAULT 0,
  status TEXT NOT NULL,      -- queued | parsing | indexing | ready | failed | stale | deleted
  index_mode TEXT,           -- local-fts-only | cloud-vector
  error_code TEXT,
  error_text TEXT,
  created_at INTEGER,
  indexed_at INTEGER,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_hash ON documents(kb, file_hash) WHERE file_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  page_no INTEGER,
  heading TEXT,
  char_start INTEGER,
  char_end INTEGER,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(bigram, tokenize='unicode61');

CREATE TABLE IF NOT EXISTS chunk_vec (
  chunk_id INTEGER PRIMARY KEY,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL
);

-- 两侧共用：引用快照（原文档删除后仍可追溯）
CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  from_kind TEXT,            -- page | note | decision
  from_id TEXT,
  to_kind TEXT,              -- doc | page
  to_id TEXT,
  doc_id TEXT,
  page_no INTEGER,
  chunk_id INTEGER,
  quote TEXT,
  locator TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS citations_to ON citations(to_kind, to_id);
`;

/** @param {string} file */
export function openKnowledgeDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  ensureColumn(db, "documents", "engine", "TEXT");
  const current = getMeta(db, "schema_version");
  if (current === null || Number(current) < SCHEMA_VERSION) setMeta(db, "schema_version", String(SCHEMA_VERSION));
  return db;
}

/** 兼容老 kb.db：只加列，不重建。 */
function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getMeta(db, k) {
  const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
  return row?.v ?? null;
}

export function setMeta(db, k, v) {
  db.prepare("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, String(v));
}

export function bumpMemoryVersion(db) {
  const next = Number(getMeta(db, "memory_version") || 0) + 1;
  setMeta(db, "memory_version", String(next));
  return next;
}

export function stats(db) {
  const one = (sql) => db.prepare(sql).get()?.n ?? 0;
  return {
    documents: one("SELECT COUNT(*) AS n FROM documents WHERE deleted_at IS NULL"),
    ready: one("SELECT COUNT(*) AS n FROM documents WHERE status = 'ready' AND deleted_at IS NULL"),
    failed: one("SELECT COUNT(*) AS n FROM documents WHERE status = 'failed' AND deleted_at IS NULL"),
    chunks: one("SELECT COUNT(*) AS n FROM chunks"),
    vectors: one("SELECT COUNT(*) AS n FROM chunk_vec"),
    dim: Number(getMeta(db, "embedding_dim") || 0),
    embeddingModel: getMeta(db, "embedding_model") || "",
    memoryVersion: Number(getMeta(db, "memory_version") || 0),
  };
}

/** Float32Array ↔ BLOB */
export function packVector(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function unpackVector(buf) {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
