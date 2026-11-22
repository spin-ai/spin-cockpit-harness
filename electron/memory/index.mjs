/**
 * 记忆层（L1–L4）+ 未验证观察（note）+ Dream 建议。
 *
 * 独立库：`userData/memory/mem.db`（node:sqlite）。
 * 事实源仍是 wiki 页面 / transcript / run；这里只放「指针 + 结论 + 待确认」，
 * 删掉 mem.db 不会丢正文。
 *
 * 四种「忘」是不同操作，不要混用（详见 docs/arch/ARCH-memory.md §6）：
 *   invalidate 失效 → `invalid_at + superseded_by`，不删、不进注入、可 as_of 回看
 *   decay      衰减 → note 的 `expires_at` 到期后不再注入，行还在
 *   evict      淘汰 → `status='archived'`，可 restore
 *   merge      合并 → 产建议后由人接受，被合并的两条标 `superseded_by`
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tokens as bigramTokens } from "../knowledge/bigram.mjs";

const LAYERS = ["L1", "L2", "L3", "L4"];
const ACTIONS = ["fix", "build", "fill", "promote", "prune", "merge", "correct", "rewrite"];
const NOTE_KINDS = ["rule", "gotcha", "guess", "preference", "decision"];

/** note 默认存活期（天）。null = 不过期；被人 `verified` 之后也改为不过期。 */
const NOTE_TTL_DAYS = { rule: null, decision: null, gotcha: 180, preference: 90, guess: 14 };

/**
 * 注入常数写死，不做成配置：能调的参数只会把「准」变成「调参」。
 * note 单独预留一小块预算，否则永远被 L4 条目挤掉（以前的 bug）。
 */
const INJECT = {
  verifiedNotes: 8,
  pendingNotes: 4,
  noteRatio: 0.25,
  noteMax: 2000,
  noteChars: 120,
  entryChars: 160,
};

const DAY = 86400000;
/** 一条观察的上限。超过这个长度就不是「观察」而是文档，应该去写页面或条目。 */
const NOTE_MAX_CHARS = 400;
/** Dream 每天最多产多少条建议（确定性扫描不花钱，但没有上限会淹掉复核队列） */
const DREAM_DAY_LIMIT = 200;
/** 两条观察多像才算合并候选：用「包含度」（一条的 token 基本被另一条盖住） */
const MERGE_CONTAINMENT = 0.9;
/** 太短的观察不参与合并判断：「用 pnpm」和「用 npm」只差一个字符，删错了更贵 */
const MERGE_MIN_TOKENS = 4;
/**
 * 改写建议的闸门：改写只允许「删减 / 纠正措辞 / 合并已有说法」，不许引入新事实。
 * 多出来的 token 就算「新事实」，允许量按原句长度的 20% 给（至少 2 个，照顾「把 A 和 B 都对」这种连接词）。
 */
const REWRITE_EXTRA_RATIO = 0.2;
const REWRITE_EXTRA_MIN = 2;
/** 改写后必须还保留原句的主体，否则就是把原句扔掉重写了 */
const REWRITE_MIN_CONTAINMENT = 0.5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'guess',      -- rule | gotcha | guess | preference | decision
  confidence REAL NOT NULL DEFAULT 0.4,
  source_kind TEXT,                        -- transcript | page | run | manual
  source_ref TEXT,                         -- message id / page id / run id
  status TEXT NOT NULL,                    -- new | verified | stale | rejected
  tags TEXT,
  owner TEXT,                              -- 空 = 全局共享；非空 = 只给这个 owner（bot:<id>）注入
  expires_at INTEGER,                      -- decay：到期后不注入，行保留
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,                     -- L1..L4
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_refs TEXT,                        -- JSON array
  status TEXT NOT NULL,                    -- active | archived
  valid_from INTEGER,                      -- 这条从什么时候成立
  invalid_at INTEGER,                      -- 被推翻的时刻（invalidate，不等于删除）
  superseded_by TEXT,                      -- 取代它的新条目
  supersedes TEXT,                         -- 它取代了哪些旧条目（JSON array）
  hit_count INTEGER DEFAULT 0,             -- 被注入次数（M3 换成被引用）
  last_hit_at INTEGER,
  sort_order INTEGER,                      -- 非空 = 置顶（决定注入分数）
  owner TEXT,                              -- 空 = 全局共享；非空 = 只给这个 owner 注入
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,                    -- fix | build | fill | promote | prune | merge | correct | rewrite
  title TEXT NOT NULL,
  detail TEXT,
  payload TEXT,                            -- JSON：rewrite 的拟改正文等
  target_kind TEXT,                        -- page | source | note | entry
  target_id TEXT,
  sources TEXT,                            -- JSON array
  sig TEXT NOT NULL,
  status TEXT NOT NULL,                    -- pending | accepted | rejected | superseded
  diff TEXT,                               -- 人一眼能看：这条建议会改掉什么
  base_rev INTEGER,                        -- 建议基于目标的哪一版（note/entry 的 updated_at）
  confidence REAL,                        -- 1 = 确定性检查，0.5 = 模型判断
  dream_id TEXT,                           -- 属于哪一轮 Dream（dream_runs.id）
  created_at INTEGER, resolved_at INTEGER
);
-- 每一轮 Dream 的台账：输入指纹、耗时、产出、模型结果。没有它就没法回答「上次跑出过什么」。
CREATE TABLE IF NOT EXISTS dream_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT,                            -- manual | idle | import
  fingerprint TEXT,                        -- 输入指纹：一样就不重跑
  pages INTEGER, sources INTEGER, notes INTEGER,
  created INTEGER, ms INTEGER,
  semantic TEXT,                           -- JSON：语义 pass 摘要（skipped / items / created / reason）
  at INTEGER
);
CREATE TABLE IF NOT EXISTS rejects (sig TEXT PRIMARY KEY, at INTEGER, times INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS inject_log (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  at INTEGER,
  budget INTEGER,
  chars INTEGER,
  version INTEGER,
  dropped INTEGER,
  items TEXT,                              -- JSON：[{id, layer, title, included, reason, score}]
  cited TEXT                               -- JSON：run 结束后回填，被实际用到的 id
);
CREATE TABLE IF NOT EXISTS entry_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,                      -- 被改掉的那一版
  at INTEGER,
  source TEXT                              -- human | dream | bot
);
CREATE TABLE IF NOT EXISTS note_revisions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  body TEXT NOT NULL,                      -- 被改掉的那一版
  at INTEGER,
  source TEXT                              -- dream | human
);
CREATE TABLE IF NOT EXISTS transcript_map (
  ref_kind TEXT NOT NULL,                  -- message | event
  ref_id TEXT NOT NULL,
  rowid_ INTEGER NOT NULL,
  at INTEGER,
  PRIMARY KEY (ref_kind, ref_id)
);
`;

/** 索引单独建：依赖后补的列（invalid_at / expires_at），必须等补列之后再执行。 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS entries_layer ON entries(layer, status);
CREATE INDEX IF NOT EXISTS entries_valid ON entries(invalid_at, valid_from);
CREATE INDEX IF NOT EXISTS notes_status ON notes(status, expires_at);
CREATE INDEX IF NOT EXISTS notes_dedupe ON notes(dedupe_key);
CREATE INDEX IF NOT EXISTS suggestions_status ON suggestions(status);
CREATE INDEX IF NOT EXISTS inject_log_at ON inject_log(at);
CREATE INDEX IF NOT EXISTS transcript_map_at ON transcript_map(at);
CREATE INDEX IF NOT EXISTS note_revisions_note ON note_revisions(note_id, at);
CREATE INDEX IF NOT EXISTS entry_revisions_entry ON entry_revisions(entry_id, at);
CREATE INDEX IF NOT EXISTS dream_runs_at ON dream_runs(at);
`;

/**
 * L1 索引：中文两字词在默认分词下查不到，所以入库与查询统一切 bigram（复用知识侧的实现）。
 * 索引本身可重建（真数据在 harness.db），所以 mem.db 删了不丢东西。
 */
const TRANSCRIPT_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  bigram,
  text UNINDEXED,
  ref_kind UNINDEXED,
  ref_id UNINDEXED,
  at UNINDEXED,
  thread_id UNINDEXED,
  run_id UNINDEXED,
  tokenize='unicode61'
);
`;

/** 老库补列：加字段不想让用户删 mem.db，CREATE IF NOT EXISTS 不会补。 */
const COLUMNS = [
  ["notes", "kind", "TEXT NOT NULL DEFAULT 'guess'"],
  ["notes", "confidence", "REAL NOT NULL DEFAULT 0.4"],
  ["notes", "expires_at", "INTEGER"],
  ["notes", "dedupe_key", "TEXT"],
  ["entries", "valid_from", "INTEGER"],
  ["entries", "invalid_at", "INTEGER"],
  ["entries", "superseded_by", "TEXT"],
  ["entries", "supersedes", "TEXT"],
  ["entries", "hit_count", "INTEGER DEFAULT 0"],
  ["entries", "last_hit_at", "INTEGER"],
  ["entries", "sort_order", "INTEGER"],
  ["notes", "owner", "TEXT"],
  ["entries", "owner", "TEXT"],
  ["suggestions", "payload", "TEXT"],
  ["suggestions", "diff", "TEXT"],
  ["suggestions", "base_rev", "INTEGER"],
  ["suggestions", "confidence", "REAL"],
  ["suggestions", "dream_id", "TEXT"],
];

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const J = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : 0));

/** 比对用的归一化：去空白与标点、转小写。用来去重，也用来判断「注入的条目是否被用到」。 */
const normalize = (s) => String(s ?? "").toLowerCase()
  .replace(/[\s\u3000]+/g, "")
  .replace(/[，。！？；：、“”‘’（）《》【】…—·,.!?;:'"()\[\]<>_\-~`|/\\]+/g, "");

/** 观察去重键：FNV-1a（非安全哈希，只用来挡重复写入，不用于校验）。 */
function dedupeKey(text) {
  const norm = normalize(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i += 1) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${norm.length}:${h.toString(36)}`;
}

/** 通用 FNV-1a：只用来比较「一批输入是不是同一批」，不做安全哈希。 */
function hashText(text) {
  const s = String(text || "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(36)}`;
}

/**
 * 提案 diff：裁掉公共前后缀，只留「改了什么」那一小段。
 * 不做字符级对齐——观察只有一句话，人要看的是「删了什么、加了什么」，不是 patch。
 */
function makeDiff(before, after, limit = 160) {
  const a = String(before ?? "").replace(/\s+/g, " ").trim();
  const b = String(after ?? "").replace(/\s+/g, " ").trim();
  if (a === b) return "";
  if (!a && !b) return "";
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  const oldMid = clip(a.slice(p, a.length - s), limit) || "（空）";
  const newMid = clip(b.slice(p, b.length - s), limit) || "（空）";
  const head = p > 0 ? "…" : "";
  const tail = s > 0 ? "…" : "";
  return [`- ${head}${oldMid}${tail}`, `+ ${head}${newMid}${tail}`].join("\n");
}

/**
 * 宽容解析 Dream 语义 pass 的模型输出。
 * 实际见过三种脏法：包 ```json 围栏、前面加一段解释、直接返回数组。
 * 解析不出来就返回 null（调用方据此判断「这次没建议」，而不是崩）。
 */
export function parseDreamItems(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const candidates = [stripped];
  const objAt = stripped.indexOf("{");
  const arrAt = stripped.indexOf("[");
  const at = objAt < 0 ? arrAt : arrAt < 0 ? objAt : Math.min(objAt, arrAt);
  if (at > 0) candidates.push(stripped.slice(at));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.items)) return parsed.items;
      return [];
    } catch { /* 试下一个 */ }
  }
  return null;
}

/**
 * 注入打分：常数来自 docs/arch/ARCH-memory.md §6.2。
 * 分数只决定「谁先被装进去」，装进去的顺序就是给 Agent 的优先级。
 */
function scoreEntry(e, now) {
  let s = 0;
  if (e.pinned) s += 50;                                     // 置顶（人工拖出来的顺序）
  if (e.sourceRefs.length) s += 30;                          // 有依据 / 被引用
  s += e.layer === "L4" ? 15 : e.layer === "L3" ? 8 : 0;     // 越高层越优先
  if (now - (e.updatedAt || 0) < 14 * DAY) s += 10;          // 近两周更新过
  s += Math.log1p(e.hitCount || 0);                          // 被用过（M3 回填被引用次数）
  return s;
}

function scoreNote(n, now) {
  let s = (n.status === "verified" ? 20 : 6) + n.confidence * 10;
  if (now - (n.updatedAt || 0) < 7 * DAY) s += 5;
  return s;
}

function expiryFor(kind, at) {
  const days = NOTE_TTL_DAYS[kind];
  return days == null ? null : at + days * DAY;
}

/** 本地日历日：Dream 预算按自然日算，不用 UTC（晚上跑会跨天） */
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 观察包含度：一条的 token 有多大比例被另一条盖住（取两个方向的最大值）。
 * 为什么不用 Jaccard：短中文句子换个措辞 Jaccard 就掉到 0.3，阈值一松就误合并。
 * 包含度只认「换行/加词/换标点」这类真·同一句，语义级的合并交给模型（M7）。
 */
function containment(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / Math.min(a.size, b.size);
}

/**
 * 从一行文字里抽「特征词」：命令、标识符、带反引号的片段。
 * 只用来做注入归因的弱判据——中文散文抽不出东西，那就只认强判据（标题被复述）。
 */
function signatureTokens(text) {
  const raw = String(text ?? "").match(/`[^`]{3,40}`|[a-zA-Z][a-zA-Z0-9_.:/-]{4,}/g) || [];
  const out = [];
  for (const t of raw) {
    const norm = normalize(t.replace(/`/g, ""));
    if (norm.length >= 5 && !out.includes(norm)) out.push(norm);
  }
  return out.slice(0, 6);
}

/** 检索命中处截一段上下文：比 FTS 自带的 snippet() 好用的地方在于能自己挑窗口。 */
function makeSnippet(text, toks, len = 130) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const low = flat.toLowerCase();
  let at = -1;
  for (const tok of toks) {
    const i = low.indexOf(tok);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, len);
  const start = Math.max(0, at - 40);
  const head = start > 0 ? "…" : "";
  const tail = start + len < flat.length ? "…" : "";
  return `${head}${flat.slice(start, start + len)}${tail}`;
}

/** 乐观并发失败：库里的版本和你看到的不一致（不是致命错误，重读再来一次即可） */
export class MemoryConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryConflictError";
    this.code = "memory_conflict";
  }
}

export function createMemory({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "mem.db"));
  db.exec(SCHEMA);
  for (const [table, column, ddl] of COLUMNS) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`); } catch { /* 已存在 */ }
  }
  db.exec(INDEXES);
  // FTS5 不可用时不影响记忆主体：索引功能自动退化（transcriptSearch 回落在内存扫）
  let ftsReady = true;
  try { db.exec(TRANSCRIPT_FTS); } catch { ftsReady = false; }
  // 老条目没有 valid_from：用创建时间回填，as_of 才有意义
  try { db.exec("UPDATE entries SET valid_from = COALESCE(valid_from, created_at) WHERE valid_from IS NULL"); } catch { /* ignore */ }
  try { db.exec("UPDATE entries SET supersedes='[]' WHERE supersedes IS NULL"); } catch { /* ignore */ }

  const rows = (sql, params = []) => db.prepare(sql).all(...params);
  const one = (sql, params = []) => db.prepare(sql).get(...params);
  const run = (sql, params = []) => db.prepare(sql).run(...params);

  const metaGet = (k) => { try { return J(one("SELECT v FROM meta WHERE k=?", [k])?.v, null); } catch { return null; } };
  const metaSet = (k, v) => run("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [k, JSON.stringify(v)]);
  const DREAM = () => ({
    enabled: true,
    maxSuggestions: 40,
    dayLimit: DREAM_DAY_LIMIT,
    // 语义 pass：要调模型，所以默认关；开了也受「每日调用数」硬预算约束
    llmPass: false,
    llmBatch: 60,
    llmDailyCalls: 20,
    // 空闲多久之后自动跑一轮（分钟，0 = 只手动）。只在没有 run 在跑时生效
    idleMinutes: 30,
    ...(metaGet("dream") || {}),
  });

  /** 记忆版本：任何写入都 +1。注入按版本缓存，也用来回答「这次和上次差了什么」 */
  const bumpVersion = () => {
    const next = (Number(metaGet("memory_version")) || 0) + 1;
    metaSet("memory_version", next);
    return next;
  };
  const version = () => Number(metaGet("memory_version")) || 0;

  /** Dream 预算累加：建议条数与模型调用是两笔账，但都存在 dreamBudget 里，写的时候要一起带上 */
  const bumpDreamBudget = ({ day, addCount = 0, addCalls = 0, addTokens = 0 }) => {
    const b = metaGet("dreamBudget") || {};
    const sameDay = b.day === day;
    const next = {
      day,
      count: (sameDay ? (Number(b.count) || 0) : 0) + addCount,
      modelCalls: (sameDay ? (Number(b.modelCalls) || 0) : 0) + addCalls,
      tokens: (sameDay ? (Number(b.tokens) || 0) : 0) + addTokens,
    };
    metaSet("dreamBudget", next);
    return next;
  };

  const noteRow = (r) => ({
    id: r.id, body: r.body,
    kind: NOTE_KINDS.includes(r.kind) ? r.kind : "guess",
    confidence: Number(r.confidence ?? 0.4),
    sourceKind: r.source_kind, sourceRef: r.source_ref,
    status: r.status, tags: J(r.tags, []),
    owner: r.owner || "",
    expiresAt: r.expires_at || 0,
    expired: Boolean(r.expires_at && r.expires_at <= Date.now()),
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const entryRow = (r) => ({
    id: r.id, layer: r.layer, title: r.title, body: r.body,
    sourceRefs: J(r.source_refs, []), status: r.status,
    owner: r.owner || "",
    validFrom: r.valid_from || r.created_at || 0,
    invalidAt: r.invalid_at || 0,
    supersededBy: r.superseded_by || "",
    supersedes: J(r.supersedes, []),
    hitCount: r.hit_count || 0,
    lastHitAt: r.last_hit_at || 0,
    sortOrder: r.sort_order ?? null,
    pinned: r.sort_order != null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const sugRow = (r) => ({
    id: r.id, action: r.action, title: r.title, detail: r.detail,
    payload: J(r.payload, null),
    targetKind: r.target_kind, targetId: r.target_id, sources: J(r.sources, []),
    sig: r.sig, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at,
    baseRev: r.base_rev || 0,
    diff: r.diff || "",
    confidence: r.confidence == null ? null : Number(r.confidence),
    dreamId: r.dream_id || "",
  });
  const dreamRunRow = (r) => ({
    id: r.id, trigger: r.trigger || "manual", fingerprint: r.fingerprint || "",
    pages: r.pages || 0, sources: r.sources || 0, notes: r.notes || 0,
    created: r.created || 0, ms: r.ms || 0,
    semantic: J(r.semantic, null), at: r.at || 0,
  });
  /**
   * 目标当前版本：note / entry 用 updated_at。
   * 页面与资料的真版本在插件库里，主进程接受建议前自己再校验一次。
   */
  const targetRev = (kind, id) => {
    if (!id) return 0;
    try {
      if (kind === "note") return Number(one("SELECT updated_at AS u FROM notes WHERE id=?", [id])?.u) || 0;
      if (kind === "entry") return Number(one("SELECT updated_at AS u FROM entries WHERE id=?", [id])?.u) || 0;
    } catch { /* ignore */ }
    return 0;
  };

  return {
    dir,
    layers: LAYERS,
    actions: ACTIONS,
    noteKinds: NOTE_KINDS,
    version,

    // ── L1 索引（transcript）：真数据在 harness.db，这里只有 bigram 索引 ──
    transcriptIndexReady: () => ftsReady,
    transcriptCount() {
      if (!ftsReady) return 0;
      try { return one("SELECT COUNT(*) n FROM transcript_fts").n; } catch { return 0; }
    },
    /** 单条写入 / 更新（同 ref 先删后插，保证编辑后不会留下旧文本） */
    transcriptPut({ kind = "message", refId, at, text, threadId = "", runId = "" } = {}) {
      if (!ftsReady) return false;
      const body = String(text || "").trim();
      if (!refId || !body) return false;
      const clipped = body.slice(0, 20000);
      const bigram = [...new Set(bigramTokens(clipped))].join(" ");
      if (!bigram) return false;
      const when = Number(at) || Date.now();
      const prev = one("SELECT rowid_ FROM transcript_map WHERE ref_kind=? AND ref_id=?", [kind, refId]);
      if (prev) run("DELETE FROM transcript_fts WHERE rowid=?", [prev.rowid_]);
      run(
        "INSERT INTO transcript_fts(bigram, text, ref_kind, ref_id, at, thread_id, run_id) VALUES (?,?,?,?,?,?,?)",
        [bigram, clipped, kind, refId, when, threadId || "", runId || ""],
      );
      const rid = one("SELECT last_insert_rowid() AS r").r;
      run(
        "INSERT INTO transcript_map(ref_kind, ref_id, rowid_, at) VALUES (?,?,?,?) ON CONFLICT(ref_kind, ref_id) DO UPDATE SET rowid_=excluded.rowid_, at=excluded.at",
        [kind, refId, rid, when],
      );
      return true;
    },
    /** 全量重建：手动 / 自检用；日常启动走 transcriptSync（只补差量，不重新分词全部） */
    transcriptRebuild(list = []) {
      if (!ftsReady) return { rebuilt: 0, total: list.length, skipped: true };
      let n = 0;
      db.exec("BEGIN");
      try {
        run("DELETE FROM transcript_fts");
        run("DELETE FROM transcript_map");
        for (const row of list) if (this.transcriptPut(row)) n += 1;
        db.exec("COMMIT");
      } catch (err) {
        try { db.exec("ROLLBACK"); } catch { /* ignore */ }
        throw err;
      }
      return { rebuilt: n, total: list.length, skipped: false };
    },
    /**
     * 启动对账：清孤儿（会话删了 / 事件滚动淘汰）+ 补缺失。
     * 不用「条数相等」判断，因为事件本来就是 300 条滚动窗口。
     */
    transcriptSync(list = []) {
      if (!ftsReady) return { pruned: 0, filled: 0, total: list.length };
      const keep = new Map();
      for (const r of list) {
        if (!keep.has(r.kind)) keep.set(r.kind, new Set());
        keep.get(r.kind).add(r.refId);
      }
      let pruned = 0;
      for (const r of rows("SELECT ref_kind, ref_id, rowid_ FROM transcript_map")) {
        const ids = keep.get(r.ref_kind);
        if (ids && ids.has(r.ref_id)) continue;
        run("DELETE FROM transcript_fts WHERE rowid=?", [r.rowid_]);
        run("DELETE FROM transcript_map WHERE ref_kind=? AND ref_id=?", [r.ref_kind, r.ref_id]);
        pruned += 1;
      }
      const have = new Set(rows("SELECT ref_kind || ':' || ref_id AS k FROM transcript_map").map((r) => r.k));
      let filled = 0;
      for (const row of list) {
        if (have.has(`${row.kind}:${row.refId}`)) continue;
        if (this.transcriptPut(row)) filled += 1;
      }
      return { pruned, filled, total: list.length, indexed: this.transcriptCount() };
    },
    /** L1 检索：只读，带时间 / 会话 / run，能跳回原文 */
    transcriptSearch({ query, limit = 8, kind = "" } = {}) {
      if (!ftsReady) return [];
      const toks = [...new Set(bigramTokens(String(query || ""), { maxTokens: 12 }))];
      if (!toks.length) return [];
      const match = toks.map((t) => `"${t.replace(/"/g, "")}"`).join(" ");
      const take = Math.max(1, Math.min(200, Number(limit) || 8));
      const params = [match];
      let sql = "SELECT ref_kind, ref_id, at, thread_id, run_id, text FROM transcript_fts WHERE transcript_fts MATCH ?";
      if (kind) { sql += " AND ref_kind = ?"; params.push(kind); }
      sql += " ORDER BY at DESC LIMIT ?";
      params.push(take);
      try {
        return rows(sql, params).map((r) => ({
          kind: r.ref_kind, id: r.ref_id, at: r.at,
          threadId: r.thread_id || "", runId: r.run_id || "",
          snippet: makeSnippet(r.text, toks),
        }));
      } catch {
        return [];
      }
    },

    // ── note：未验证观察（L2） ────────────────────────────────────
    /**
     * 写入闸门（M2）：
     *   1. 没来源不写——否则 Dream 推着一条无法核对的结论往 L4 跑；
     *   2. 太长不写——观察只放一句结论，长内容应该去写页面；
     *   3. 同一句话只存一行，重复写 = 多一个佐证（confidence +0.1）。
     */
    noteAdd({ body, kind = "guess", confidence, sourceKind = "manual", sourceRef = "", tags = [], expiresAt, owner = "" } = {}) {
      const text = String(body || "").trim();
      if (!text) throw new Error("note 内容不能为空");
      if (!String(sourceRef || "").trim()) {
        throw new Error("写观察必须带来源：source_kind + source_ref（哪条消息 / 哪个 run / 哪个页面）");
      }
      if (text.length > NOTE_MAX_CHARS) {
        throw new Error(`观察太长（${text.length} 字符 > ${NOTE_MAX_CHARS}）：观察只放一条结论，长内容请写成记忆条目或页面`);
      }
      const k = NOTE_KINDS.includes(kind) ? kind : "guess";
      const conf = clamp(confidence ?? (k === "guess" ? 0.4 : 0.6));
      const at = Date.now();
      // expiresAt === undefined → 按 kind 给默认存活期；显式 null → 不过期
      const expires = expiresAt === undefined ? expiryFor(k, at) : (Number(expiresAt) || null);
      const key = dedupeKey(text);
      const dup = one("SELECT * FROM notes WHERE dedupe_key=?", [key]);
      if (dup) {
        // 同一条观察又出现一次：不新增行，抬高置信度并换上新来源（视为多一个佐证）
        // 未被人工 verified 的观察顺带续期：又抓到一次，说明它没过时
        const refreshed = dup.status === "verified" ? null : (expires ?? dup.expires_at);
        run(
          "UPDATE notes SET confidence=?, source_kind=?, source_ref=?, expires_at=?, updated_at=? WHERE id=?",
          [clamp(Math.max(Number(dup.confidence) || 0, conf) + 0.1), sourceKind || dup.source_kind, sourceRef, refreshed, at, dup.id],
        );
        bumpVersion();
        return { ...noteRow(one("SELECT * FROM notes WHERE id=?", [dup.id])), deduped: true };
      }
      const id = uid("n");
      run(
        "INSERT INTO notes(id, body, kind, confidence, source_kind, source_ref, status, tags, owner, expires_at, dedupe_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, text, k, conf, sourceKind || "manual", sourceRef, "new", JSON.stringify(tags), String(owner || ""), expires, key, at, at],
      );
      bumpVersion();
      return { ...noteRow(one("SELECT * FROM notes WHERE id=?", [id])), deduped: false };
    },
    noteList({ status, kind, limit = 100 } = {}) {
      const where = [];
      const params = [];
      if (status) { where.push("status=?"); params.push(status); }
      if (kind) { where.push("kind=?"); params.push(kind); }
      const sql = `SELECT * FROM notes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
      return rows(sql, [...params, limit]).map(noteRow);
    },
    noteSetStatus({ id, status } = {}) {
      if (!["new", "verified", "stale", "rejected"].includes(status)) throw new Error("非法状态");
      const at = Date.now();
      // 人确认过的观察不再衰减：verified = 长期有效
      if (status === "verified") run("UPDATE notes SET status=?, expires_at=NULL, updated_at=? WHERE id=?", [status, at, id]);
      else run("UPDATE notes SET status=?, updated_at=? WHERE id=?", [status, at, id]);
      bumpVersion();
      return noteRow(one("SELECT * FROM notes WHERE id=?", [id]));
    },
    noteRemove({ id } = {}) { run("DELETE FROM notes WHERE id=?", [id]); bumpVersion(); return true; },
    /**
     * 改写一条观察：把旧正文存进 note_revisions，再覆盖。
     * 「改写」是有历史的动作——不能像以前那样覆盖掉，否则 Dream 记错一次就没法回退。
     */
    noteRewrite({ id, body, source = "dream" } = {}) {
      const row = one("SELECT * FROM notes WHERE id=?", [id]);
      if (!row) throw new Error("观察不存在");
      const next = String(body || "").trim();
      if (!next) throw new Error("改写后的内容不能为空");
      if (next.length > NOTE_MAX_CHARS) throw new Error(`改写后太长（${next.length} > ${NOTE_MAX_CHARS}）`);
      if (next === row.body) throw new Error("改写没有任何变化");
      const at = Date.now();
      run("INSERT INTO note_revisions(id, note_id, body, at, source) VALUES (?,?,?,?,?)", [uid("rv"), id, row.body, at, source]);
      run("UPDATE notes SET body=?, updated_at=? WHERE id=?", [next, at, id]);
      bumpVersion();
      return noteRow(one("SELECT * FROM notes WHERE id=?", [id]));
    },
    noteRevisions({ id, limit = 20 } = {}) {
      return rows("SELECT * FROM note_revisions WHERE note_id=? ORDER BY at DESC LIMIT ?", [id, limit])
        .map((r) => ({ id: r.id, body: r.body, at: r.at, source: r.source }));
    },

    // ── 四层条目 ─────────────────────────────────────────────────
    /**
     * 写条目。带 `expectedUpdatedAt` 时做**乐观并发**：库里的 updated_at 和它不一致就抛
     * MemoryConflictError —— 两个人（或 bot + 人）同时改一条结论时，后来的不能悄悄覆盖。
     */
    entryUpsert({ id, layer = "L4", title, body = "", sources = [], owner, expectedUpdatedAt } = {}) {
      if (!LAYERS.includes(layer)) throw new Error("layer 必须是 L1–L4");
      const name = String(title || "").trim();
      if (!name) throw new Error("条目标题不能为空");
      const at = Date.now();
      if (id && expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
        const live = one("SELECT updated_at AS u, title, body FROM entries WHERE id=?", [id]);
        const liveAt = Number(live?.u) || 0;
        if (!live) throw new MemoryConflictError("条目不存在（可能已被删除）");
        if (liveAt !== Number(expectedUpdatedAt)) {
          throw new MemoryConflictError(`条目已被改过（库 ${liveAt} ≠ 你看到的 ${Number(expectedUpdatedAt)}）：先读一遍再改`);
        }
      }
      if (id && one("SELECT id FROM entries WHERE id=?", [id])) {
        // 原地编辑：不动 valid_from / invalid_at（失效链只由 invalidate/restore 改）
        run("UPDATE entries SET layer=?, title=?, body=?, source_refs=?, status='active', updated_at=? WHERE id=?", [layer, name, String(body).slice(0, 8000), JSON.stringify(sources), at, id]);
        bumpVersion();
        return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
      }
      const next = id || uid("m");
      run(
        "INSERT INTO entries(id, layer, title, body, source_refs, status, valid_from, supersedes, owner, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [next, layer, name, String(body).slice(0, 8000), JSON.stringify(sources), "active", at, "[]", String(owner || ""), at, at],
      );
      bumpVersion();
      return entryRow(one("SELECT * FROM entries WHERE id=?", [next]));
    },
    /**
     * 改写一条条目：旧版存进 entry_revisions，再覆盖。
     * 与 noteRewrite 的区别：条目有 title，所以判定"有没有变化"要同时看 title 与 body。
     */
    entryRewrite({ id, title, body, source = "human", expectedUpdatedAt } = {}) {
      const row = one("SELECT * FROM entries WHERE id=?", [id]);
      if (!row) throw new Error("条目不存在");
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && Number(row.updated_at) !== Number(expectedUpdatedAt)) {
        throw new MemoryConflictError("条目已被改过，先读一遍再改");
      }
      const nextTitle = title === undefined ? row.title : String(title).trim();
      const nextBody = body === undefined ? row.body : String(body);
      if (!nextTitle) throw new Error("标题不能为空");
      if (nextTitle === row.title && nextBody === row.body) throw new Error("改写没有任何变化");
      const at = Date.now();
      run("INSERT INTO entry_revisions(id, entry_id, title, body, at, source) VALUES (?,?,?,?,?,?)", [uid("erv"), id, row.title, row.body, at, source]);
      run("UPDATE entries SET title=?, body=?, updated_at=? WHERE id=?", [nextTitle, nextBody.slice(0, 8000), at, id]);
      bumpVersion();
      return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
    },
    entryRevisions({ id, limit = 20 } = {}) {
      return rows("SELECT * FROM entry_revisions WHERE entry_id=? ORDER BY at DESC LIMIT ?", [id, limit])
        .map((r) => ({ id: r.id, title: r.title, body: r.body, at: r.at, source: r.source }));
    },
    /** 回滚到某一版（本身也是一次改写，所以能再回滚回去） */
    entryRestoreRevision({ revisionId, source = "human" } = {}) {
      const rev = one("SELECT * FROM entry_revisions WHERE id=?", [revisionId]);
      if (!rev) throw new Error("修订不存在");
      return this.entryRewrite({ id: rev.entry_id, title: rev.title, body: rev.body, source });
    },
    entryList({ layer, status = "active", limit = 200, includeInvalidated = false } = {}) {
      const where = ["status=?"];
      const params = [status];
      if (!includeInvalidated) where.push("invalid_at IS NULL");
      if (layer) { where.push("layer=?"); params.push(layer); }
      const sql = `SELECT * FROM entries WHERE ${where.join(" AND ")} ORDER BY COALESCE(sort_order, 1e12), updated_at DESC LIMIT ?`;
      return rows(sql, [...params, limit]).map(entryRow);
    },
    /**
     * 失效（invalidate）：事实被推翻，但不删除。
     * 旧条目的 invalid_at = 新条目的 valid_from，溯源链两头都能走。
     */
    entryInvalidate({ id, supersededBy = "" } = {}) {
      const row = one("SELECT * FROM entries WHERE id=?", [id]);
      if (!row) throw new Error("条目不存在");
      const at = Date.now();
      run("UPDATE entries SET invalid_at=?, superseded_by=?, updated_at=? WHERE id=?", [at, supersededBy || null, at, id]);
      bumpVersion();
      return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
    },
    /** as_of 回看：某个时间点上「同时成立」的条目（失效的不删，所以能回看） */
    entryAsOf({ at, layer, limit = 200 } = {}) {
      const when = Number(at) || Date.now();
      const params = [when, when];
      let sql = "SELECT * FROM entries WHERE (valid_from IS NULL OR valid_from <= ?) AND (invalid_at IS NULL OR invalid_at > ?)";
      if (layer) { sql += " AND layer=?"; params.push(layer); }
      sql += " ORDER BY layer, COALESCE(sort_order, 1e12), updated_at DESC LIMIT ?";
      return rows(sql, [...params, limit]).map(entryRow);
    },
    /** 拖拽排序：按给定顺序写 sort_order（非空即置顶，注入时 +50 分） */
    entryReorder({ ids = [] } = {}) {
      let i = 0;
      for (const id of ids) { run("UPDATE entries SET sort_order=? WHERE id=?", [i, id]); i += 1; }
      if (ids.length) bumpVersion();
      return { count: ids.length };
    },
    entryArchive({ id } = {}) {
      run("UPDATE entries SET status='archived', updated_at=? WHERE id=?", [Date.now(), id]);
      bumpVersion();
      return true;
    },
    /** 恢复：同时撤销失效（清 invalid_at / superseded_by，并从新条目的 supersedes 里摘掉） */
    entryRestore({ id } = {}) {
      const row = one("SELECT * FROM entries WHERE id=?", [id]);
      if (!row) throw new Error("条目不存在");
      const at = Date.now();
      run("UPDATE entries SET status='active', invalid_at=NULL, superseded_by=NULL, updated_at=? WHERE id=?", [at, id]);
      if (row.superseded_by) {
        const newer = one("SELECT * FROM entries WHERE id=?", [row.superseded_by]);
        if (newer) {
          const keep = J(newer.supersedes, []).filter((x) => x !== id);
          run("UPDATE entries SET supersedes=?, updated_at=? WHERE id=?", [JSON.stringify(keep), at, newer.id]);
        }
      }
      bumpVersion();
      return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
    },
    /** 已归档 / 已失效条目（可恢复），供「其它」视图 */
    entryArchived({ limit = 100 } = {}) {
      return rows("SELECT * FROM entries WHERE status='archived' OR invalid_at IS NOT NULL ORDER BY COALESCE(invalid_at, updated_at) DESC LIMIT ?", [limit]).map(entryRow);
    },
    /** 搜条目（标题 + 正文）。中文用 bigram 切分后 AND 匹配，整串 LIKE 查不到两字词 */
    entrySearch({ query, limit = 30, owner = "" } = {}) {
      const q = String(query || "").trim();
      if (!q) return [];
      const toks = [...new Set(bigramTokens(q, { maxTokens: 8 }))];
      const where = toks.length
        ? toks.map(() => "(title LIKE ? OR body LIKE ?)").join(" AND ")
        : "(title LIKE ? OR body LIKE ?)";
      const params = toks.length
        ? toks.flatMap((t) => [`%${t}%`, `%${t}%`])
        : [`%${q}%`, `%${q}%`];
      // owner：和 inject 同一条口径（空 = 全库；传了 = 共享 + 自己的）
      const own = String(owner || "");
      const ownSql = own ? " AND (COALESCE(owner,'')='' OR owner=?)" : "";
      const sql = `SELECT * FROM entries WHERE status='active' AND invalid_at IS NULL AND ${where}${ownSql} ORDER BY updated_at DESC LIMIT ?`;
      return rows(sql, [...params, ...(own ? [own] : []), limit]).map(entryRow);
    },
    /**
     * 晋升高置信 note：写条目，并把 note 标 verified。
     * `supersedes` 显式给旧条目 id —— 不靠模型猜主题，猜错比不做更糟。
     */
    promoteNote({ id, layer = "L4", supersedes = [] } = {}) {
      const note = one("SELECT * FROM notes WHERE id=?", [id]);
      if (!note) throw new Error("观察不存在");
      // 边界收口：只有「现在还成立、且有来源」的观察才配进 L4
      if (note.status === "rejected") throw new Error("已拒绝的观察不能晋升");
      if (note.status === "stale") throw new Error("已标为不成立的观察不能晋升");
      if (note.expires_at && note.expires_at <= Date.now()) throw new Error("观察已过期（expires_at 已过）：先重写一条再晋升");
      if (!String(note.source_ref || "").trim()) throw new Error("没有来源的观察不能晋升：补上 source_ref 或重写一条");
      const body = String(note.body);
      const entry = this.entryUpsert({
        layer,
        title: clip(body, 60),
        body: body.slice(0, 800),
        sources: [note.sourceRef || note.id],
      });
      const invalidated = [];
      for (const oldId of [].concat(supersedes || []).filter(Boolean)) {
        if (oldId === entry.id) continue;
        try { invalidated.push(this.entryInvalidate({ id: oldId, supersededBy: entry.id })); } catch { /* 旧条目不存在就跳过 */ }
      }
      if (invalidated.length) {
        run("UPDATE entries SET supersedes=? WHERE id=?", [JSON.stringify(invalidated.map((e) => e.id)), entry.id]);
      }
      run("UPDATE notes SET status='verified', expires_at=NULL, updated_at=? WHERE id=?", [Date.now(), id]);
      bumpVersion();
      return {
        entry: entryRow(one("SELECT * FROM entries WHERE id=?", [entry.id])),
        note: noteRow(one("SELECT * FROM notes WHERE id=?", [id])),
        invalidated,
      };
    },
    /** Dream 配置：可关闭、限制单次建议条数、每日预算；顺便报「今天已经产了多少」 */
    dreamConfig({ patch } = {}) {
      if (patch && Object.keys(patch).length) metaSet("dream", { ...DREAM(), ...patch });
      const cfg = DREAM();
      const b = metaGet("dreamBudget") || {};
      const day = dayKey();
      return {
        ...cfg,
        budget: { day, used: b.day === day ? (Number(b.count) || 0) : 0, limit: Math.max(1, Number(cfg.dayLimit) || DREAM_DAY_LIMIT) },
        modelBudget: this.dreamModelCallBudget(),
        lastRun: this.dreamLastRun(),
      };
    },
    setInjectBudget({ maxChars } = {}) {
      const n = Math.max(800, Math.min(60000, Number(maxChars) || 12000));
      metaSet("injectBudget", n);
      return n;
    },
    currentInjectBudget() { return Number(metaGet("injectBudget")) || 12000; },
    /**
     * 容量账：注入方（尤其人格 bot）要能说出「你还能记多少」。
     * 没有这个数，bot 只会在"保存被拒"那一刻才知道装不下了——那已经晚了。
     */
    usage({ maxChars } = {}) {
      const budget = Math.max(800, Number(maxChars) || Number(metaGet("injectBudget")) || 12000);
      const ctx = this.inject({ maxChars: budget });
      const active = Number(one("SELECT COUNT(*) n FROM entries WHERE status='active' AND invalid_at IS NULL AND layer!='L1'")?.n) || 0;
      const notes = Number(one("SELECT COUNT(*) n FROM notes WHERE status IN ('verified','new') AND (expires_at IS NULL OR expires_at > ?)", [Date.now()])?.n) || 0;
      return {
        budget,
        chars: ctx.chars,
        ratio: budget ? Math.round((ctx.chars / budget) * 100) / 100 : 0,
        entries: active,
        notes,
        dropped: ctx.dropped || 0,
      };
    },
    /**
     * 单个 bot 视角的 MEMORY.md：共享 + 自己的条目 / 观察。
     * 只读镜像，DB 仍是事实源；给「打开 MEMORY.md」用，不参与注入。
     */
    botMarkdown({ owner = "", maxChars = 60000 } = {}) {
      const own = String(owner || "");
      const ownSql = own ? " AND (COALESCE(owner,'')='' OR owner=?)" : "";
      const entries = rows(
        `SELECT * FROM entries WHERE status='active' AND invalid_at IS NULL AND layer!='L1'${ownSql} ORDER BY layer, updated_at DESC`,
        own ? [own] : [],
      ).map(entryRow);
      const notes = rows(
        `SELECT * FROM notes WHERE status IN ('verified','new') AND (expires_at IS NULL OR expires_at > ?)${ownSql} ORDER BY updated_at DESC`,
        own ? [Date.now(), own] : [Date.now()],
      ).map(noteRow);
      const lines = [
        "# MEMORY.md",
        "",
        `> 由记忆库生成的只读镜像（${own || "全局"}）；DB 才是事实源，手改不会自动回写。`,
        "",
      ];
      const layerNames = { L4: "结论", L3: "项目", L2: "事实" };
      for (const layer of ["L4", "L3", "L2"]) {
        const list = entries.filter((e) => e.layer === layer);
        if (!list.length) continue;
        lines.push(`## ${layer} · ${layerNames[layer]}`);
        for (const e of list) {
          lines.push(`- ${e.title}${e.body ? `：${String(e.body).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
        }
        lines.push("");
      }
      if (notes.length) {
        lines.push("## 未验证观察");
        for (const n of notes) {
          lines.push(`- ${n.status === "verified" ? "" : "未验证 · "}${String(n.body || "").replace(/\s+/g, " ").slice(0, 240)}`);
        }
        lines.push("");
      }
      const text = lines.join("\n").trimEnd() + "\n";
      return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
    },

    /** 导出全部记忆（Markdown），用于备份 / 迁移；失效条目单独列出以保留溯源 */
    exportMarkdown() {
      const lines = [`# 记忆导出 ${new Date().toISOString()}`, ""];
      for (const layer of LAYERS) {
        const list = rows("SELECT * FROM entries WHERE layer=? AND status='active' AND invalid_at IS NULL ORDER BY updated_at DESC", [layer]).map(entryRow);
        if (!list.length) continue;
        lines.push(`## ${layer}`, "");
        for (const e of list) {
          lines.push(`### ${e.title}`);
          if (e.body) lines.push(e.body);
          if (e.sourceRefs?.length) lines.push(`\n来源：${e.sourceRefs.join(" / ")}`);
          lines.push("");
        }
      }
      const verifiedNotes = rows("SELECT * FROM notes WHERE status='verified' ORDER BY updated_at DESC LIMIT 200").map(noteRow);
      if (verifiedNotes.length) {
        lines.push("## 已验证观察", "");
        for (const n of verifiedNotes) lines.push(`- ${n.body}${n.sourceRef ? `（${n.sourceRef}）` : ""}`);
      }
      const dead = rows("SELECT * FROM entries WHERE invalid_at IS NOT NULL ORDER BY invalid_at DESC LIMIT 200").map(entryRow);
      if (dead.length) {
        lines.push("", "## 已失效（保留溯源，不注入）", "");
        for (const e of dead) {
          lines.push(`- ${e.title} · 失效于 ${new Date(e.invalidAt).toISOString()}${e.supersededBy ? ` · 由 ${e.supersededBy} 取代` : ""}`);
        }
      }
      return lines.join("\n");
    },

    /** 条目来源：sources 里保存的 id/链接，原样返回给 UI 展示 */
    entrySources({ id } = {}) {
      const row = one("SELECT * FROM entries WHERE id=?", [id]);
      return row ? entryRow(row).sourceRefs : [];
    },
    /** 降级：L4→L3→L2→L1（最后一次不再降） */
    entryDemote({ id } = {}) {
      const row = one("SELECT * FROM entries WHERE id=?", [id]);
      if (!row) throw new Error("条目不存在");
      const idx = LAYERS.indexOf(row.layer);
      // LAYERS = [L1, L2, L3, L4]：降级是往「更原始」走，索引减一
      const next = LAYERS[Math.max(0, idx - 1)];
      run("UPDATE entries SET layer=?, updated_at=? WHERE id=?", [next, Date.now(), id]);
      bumpVersion();
      return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
    },

    // ── 注入：按分数排序后自然截止，超预算做减法 ─────────────────
    inject({ maxChars, runId = "", owner = "", query = "" } = {}) {
      const stored = Number(metaGet("injectBudget")) || 12000;
      const budget = Math.max(800, Number(maxChars) || stored);
      const now = Date.now();
      // query：本轮问题相关的条目先上浮（不改变「谁被注入」的门槛，只改排序）
      const q = String(query || "").trim().toLowerCase();
      const hit = (text) => Boolean(q) && String(text || "").toLowerCase().includes(q);
      // owner：空 = 全库共享（默认）；传了 owner（如 bot:<id>）就只看「共享 + 自己的」
      const own = String(owner || "");
      const ownSql = own ? " AND (COALESCE(owner,'')='' OR owner=?)" : "";

      // L1 永不进注入：原文太大，且把原文塞进上下文等于让 Agent 自己编历史
      const entries = rows(
        `SELECT * FROM entries WHERE status='active' AND invalid_at IS NULL AND layer!='L1'${ownSql}`,
        own ? [own] : [],
      )
        .map(entryRow)
        .map((e) => {
          const matched = hit(e.title) || hit(e.body);
          return { ...e, matched, score: scoreEntry(e, now) + (matched ? 4 : 0) };
        })
        .sort((a, b) => b.score - a.score || (a.sortOrder ?? 1e12) - (b.sortOrder ?? 1e12) || b.updatedAt - a.updatedAt);

      // note 只取未过期的：verified 全取（有上限），new 只取高置信度
      const freshNotes = rows(
        `SELECT * FROM notes WHERE status IN ('verified','new') AND (expires_at IS NULL OR expires_at > ?)${ownSql}`,
        own ? [now, own] : [now],
      )
        .map(noteRow)
        .filter((n) => n.status === "verified" || n.confidence >= 0.6)
        .map((n) => {
          const matched = hit(n.body);
          return { ...n, matched, score: scoreNote(n, now) + (matched ? 3 : 0) };
        })
        .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
      const pickedNotes = [
        ...freshNotes.filter((n) => n.status === "verified").slice(0, INJECT.verifiedNotes),
        ...freshNotes.filter((n) => n.status === "new").slice(0, INJECT.pendingNotes),
      ];

      const items = [];
      const push = (ref, layer, title, chars, included, reason, score, extra = {}) => items.push({
        id: ref.id, layer, title, chars, included, reason, score: Math.round((score || 0) * 10) / 10, ...extra,
      });

      const head = "## 记忆（L4 目录 / 结论）";
      const noteHead = "\n\n## 未验证观察（可用于校正，不要当结论）";

      // ① 先算 note 那一块：预留预算，避免被 L4 条目挤光
      const noteBudget = entries.length ? Math.min(INJECT.noteMax, Math.floor(budget * INJECT.noteRatio)) : budget;
      let notesOut = "";
      let notesUsed = 0;
      for (const n of pickedNotes) {
        const tag = n.kind !== "guess" ? `（${n.kind}）` : "";
        const line = `\n- ${n.status === "verified" ? "" : "未验证 · "}${clip(n.body, INJECT.noteChars)}${tag}`;
        if (notesUsed + line.length > noteBudget) {
          push(n, "note", clip(n.body, 24), line.length, false, `note 预留 ${noteBudget} 字符已用尽（已用 ${notesUsed}）`, n.score);
          continue;
        }
        if (!notesUsed) notesOut += noteHead;
        notesOut += line;
        notesUsed += line.length;
        push(n, "note", clip(n.body, 24), line.length, true,
          `${n.status === "verified" ? "已验证观察" : `置信度 ${n.confidence.toFixed(2)}，标注未验证后注入`} · score ${n.score.toFixed(1)}${n.matched ? " · 命中本轮问题" : ""}`,
          n.score);
      }

      // ② 没进注入的观察也要出现在台账里：队列 11 条、预览只显示 4 条会让人以为丢了
      const pickedIds = new Set(pickedNotes.map((n) => n.id));
      for (const n of freshNotes) {
        if (pickedIds.has(n.id)) continue;
        push(n, "note", clip(n.body, 24), 0, false,
          n.status === "verified" ? `已验证观察注入上限 ${INJECT.verifiedNotes} 条` : `未验证观察上限 ${INJECT.pendingNotes} 条：先验证一条，它才有机会进来`,
          n.score);
      }

      // ③ 条目按分数装填，装不下不算截断，是自然截止
      const entryBudget = budget - notesUsed;
      let out = head;
      let used = head.length;
      let dropped = 0;
      for (const e of entries) {
        const line = e.layer === "L4"
          ? `\n- ${e.title}${e.body ? `：${clip(e.body, INJECT.entryChars)}` : ""}`
          : `\n- [${e.layer}] ${e.title}`;
        if (used + line.length > entryBudget) {
          dropped += 1;
          push(e, e.layer, e.title, line.length, false,
            `超出预算（条目可用 ${entryBudget} 字符，已用 ${used}；按 score ${e.score.toFixed(1)} 排序）`, e.score,
          { pinned: Boolean(e.pinned), updatedAt: e.updatedAt });
          continue;
        }
        out += line;
        used += line.length;
        push(e, e.layer, e.title, line.length, true,
          `score ${e.score.toFixed(1)}${e.matched ? " · 命中本轮问题" : ""}${e.pinned ? " · 已置顶" : ""} · 按分数自然截止`, e.score,
          { pinned: Boolean(e.pinned), updatedAt: e.updatedAt });
      }
      const includedEntries = items.filter((i) => i.included && i.layer !== "note").length;
      const includedNotes = items.filter((i) => i.included && i.layer === "note").length;
      if (!includedEntries) out = "";
      out += notesOut;
      if (!includedEntries && includedNotes) out = out.replace(/^\n+/, "");
      if (dropped) out += `\n（另有 ${dropped} 条条目超出 ${budget} 字符预算，已省略；需要详情用 memory_search）`;
      if (!includedEntries && !includedNotes) out = "";
      // 只有绑定 run 的注入才落台账：记忆页的预览不算「真正进过上下文」
      let logId = "";
      if (runId) {
        logId = uid("l");
        run(
          "INSERT INTO inject_log(id, run_id, at, budget, chars, version, dropped, items, cited) VALUES (?,?,?,?,?,?,?,?,?)",
          [logId, String(runId), now, budget, out.length, version(), dropped, JSON.stringify(items), "[]"],
        );
      }
      return {
        markdown: out,
        chars: out.length,
        budget,
        version: version(),
        logId,
        injected: items.filter((i) => i.included).length,
        dropped,
        items,
      };
    },

    /**
     * 注入归因：run 结束后把回答文本拿回来，看注入的条目到底有没有被用到。
     * 判据是「标题/正文的关键片段是否出现在回答里」——很粗，但比拍脑袋强；
     * 比它更准的做法（模型自评、工具参数引用）留到 M7。
     */
    markCited({ logId, text } = {}) {
      const row = one("SELECT * FROM inject_log WHERE id=?", [logId]);
      if (!row) return { cited: 0, total: 0, ids: [] };
      const hay = normalize(text);
      const items = J(row.items, []);
      const included = items.filter((i) => i.included);
      if (!hay) return { cited: 0, total: included.length, ids: [] };
      const ids = [];
      for (const it of included) {
        const needle = normalize(it.title).slice(0, 24);
        // 强判据：标题整段被复述
        if (needle.length >= 6 && hay.includes(needle)) { ids.push(it.id); continue; }
        // 弱判据：这条里的「特征词」（命令 / 标识符）出现在这轮的文本或工具调用里。
        // 真实数据说明只看标题没用：run 照着「跑 typecheck」做了，但回答里不会复述那句话。
        const sig = signatureTokens(it.title);
        if (sig.length) {
          const hits = sig.filter((t) => hay.includes(t));
          if (hits.length >= Math.min(2, sig.length) && hits.some((t) => t.length >= 6)) ids.push(it.id);
        }
      }
      run("UPDATE inject_log SET cited=? WHERE id=?", [JSON.stringify(ids), logId]);
      const at = Date.now();
      for (const id of ids) {
        run("UPDATE entries SET hit_count=COALESCE(hit_count,0)+1, last_hit_at=? WHERE id=?", [at, id]);
      }
      return { cited: ids.length, total: included.length, ids };
    },

    /** 还没回填归因的台账（升级后补历史用；只取绑了 run 的） */
    logsNeedingCitation({ limit = 60 } = {}) {
      return rows(
        "SELECT id, run_id FROM inject_log WHERE run_id IS NOT NULL AND run_id != '' AND (cited IS NULL OR cited='[]') ORDER BY at DESC LIMIT ?",
        [Math.max(1, Math.min(500, Number(limit) || 60))],
      ).map((r) => ({ id: r.id, runId: r.run_id }));
    },

    /** 注入效果：判据就这三个数，不要多造指标 */
    injectionStats({ limit = 20 } = {}) {
      const logs = rows("SELECT * FROM inject_log ORDER BY at DESC LIMIT ?", [limit]).map((r) => ({
        id: r.id, runId: r.run_id, at: r.at, budget: r.budget, chars: r.chars,
        version: r.version, dropped: r.dropped,
        items: J(r.items, []), cited: J(r.cited, []),
      }));
      let injected = 0;
      let cited = 0;
      let chars = 0;
      for (const l of logs) {
        injected += l.items.filter((i) => i.included).length;
        cited += l.cited.length;
        chars += l.chars;
      }
      return {
        runs: logs.length,
        injected,
        cited,
        hitRate: injected ? cited / injected : 0,
        avgChars: logs.length ? Math.round(chars / logs.length) : 0,
        version: version(),
        recent: logs.slice(0, 5),
      };
    },

    // ── Dream：五种动作，只产建议 ─────────────────────────────────
    /**
     * 输入指纹：这一轮 Dream 要处理的对象有没有变（观察、L3、页面、资料）。
     * 输入没变就不该再跑一轮：同一批输入重复跑只会出重复提案、重复调模型。
     */
    dreamFingerprint({ pages = [], sources = [] } = {}) {
      const live = rows("SELECT id, updated_at FROM notes WHERE status IN ('new','verified') ORDER BY id");
      const l3 = rows("SELECT id, updated_at FROM entries WHERE layer='L3' AND status='active' ORDER BY id");
      const pageParts = (Array.isArray(pages) ? pages : [])
        .map((p) => `${p.id}:${p.updatedAt || 0}:${(Array.isArray(p.citations) ? p.citations.length : 0)}`).sort();
      const sourceParts = (Array.isArray(sources) ? sources : [])
        .map((s) => `${s.id}:${s.updatedAt || s.updated_at || s.chars || 0}`).sort();
      return hashText([
        DREAM().llmPass ? "llm" : "det",
        ...live.map((n) => `${n.id}@${n.updated_at}`),
        ...l3.map((e) => `${e.id}@${e.updated_at}`),
        ...pageParts, ...sourceParts,
      ].join("\n"));
    },
    dreamUnchanged({ fingerprint = "" } = {}) {
      const last = this.dreamLastRun();
      return Boolean(fingerprint) && Boolean(last) && last.fingerprint === fingerprint;
    },
    dreamLastRun() {
      const r = one("SELECT * FROM dream_runs ORDER BY at DESC LIMIT 1");
      return r ? dreamRunRow(r) : null;
    },
    dreamRuns({ limit = 10 } = {}) {
      return rows("SELECT * FROM dream_runs ORDER BY at DESC LIMIT ?", [Math.max(1, Math.min(50, Number(limit) || 10))]).map(dreamRunRow);
    },
    /** 语义 pass 跑完之后回填结果（一轮 Dream = 确定性扫描 + 可选模型 pass） */
    dreamRunSemantic({ id = "", semantic = null } = {}) {
      if (!id) return null;
      run("UPDATE dream_runs SET semantic=? WHERE id=?", [JSON.stringify(semantic || null), id]);
      const r = one("SELECT * FROM dream_runs WHERE id=?", [id]);
      return r ? dreamRunRow(r) : null;
    },
    dreamScan({ pages = [], sources = [], noteStats = null, trigger = "manual", force = false } = {}) {
      const cfg = DREAM();
      if (!cfg.enabled) return [];
      // 输入指纹：没变就不跑（force = 人手点的，允许重跑一次）
      const fingerprint = this.dreamFingerprint({ pages, sources });
      if (!force && this.dreamUnchanged({ fingerprint })) return [];
      const runId = uid("dr");
      const startedAt = Date.now();
      // 每日预算：确定性扫描不花钱，但没上限会把复核队列淹掉（人一旦不看队列，Dream 就白跑）
      const day = dayKey();
      const budget = metaGet("dreamBudget") || {};
      const usedToday = budget.day === day ? (Number(budget.count) || 0) : 0;
      const dayLimit = Math.max(1, Number(cfg.dayLimit) || DREAM_DAY_LIMIT);
      if (usedToday >= dayLimit) return [];
      const rejected = new Set(rows("SELECT sig FROM rejects").map((r) => r.sig));
      const knownSigs = new Set(rows("SELECT sig FROM suggestions WHERE status IN ('pending','accepted')").map((r) => r.sig));
      const add = (action, title, detail, targetKind, targetId, sourcesArr = [], extra = {}) => {
        if (created.length >= cfg.maxSuggestions) return null;
        if (usedToday + created.length >= dayLimit) return null;
        const sig = `${action}:${targetKind}:${targetId}:${title}`;
        if (rejected.has(sig) || knownSigs.has(sig)) return null;
        const id = uid("s");
        run(
          "INSERT INTO suggestions(id, action, title, detail, payload, target_kind, target_id, sources, sig, status, diff, base_rev, confidence, dream_id, created_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [id, action, title.slice(0, 200), detail || "", extra.payload ? JSON.stringify(extra.payload) : null, targetKind, targetId || null, JSON.stringify(sourcesArr), sig, "pending",
            extra.diff || "", extra.baseRev === undefined ? targetRev(targetKind, targetId) : (Number(extra.baseRev) || 0), extra.confidence == null ? 1 : Number(extra.confidence), runId, Date.now(), null],
        );
        knownSigs.add(sig);
        return sugRow(one("SELECT * FROM suggestions WHERE id=?", [id]));
      };

      const sourceIds = new Set(sources.map((s) => s.id));
      const cited = new Set();
      const created = [];
      for (const page of pages) {
        const cites = Array.isArray(page.citations) ? page.citations : [];
        cites.forEach((c) => cited.add(c.sourceId));
        // fix：reviewed 页面的引用源已不存在 / 页面缺摘要
        const missing = cites.filter((c) => !sourceIds.has(c.sourceId));
        if (page.status === "reviewed" && missing.length) {
          const s = add("fix", `修正「${page.title}」的失效引用`, `${missing.length} 条引用指向已删除的资料`, "page", page.id, missing.map((c) => c.sourceId), {
            baseRev: page.updatedAt, diff: `- ${clip(missing.map((c) => c.sourceId).join(", "), 80)}\n+ （重指到现存资料或删掉该引用）`,
          });
          if (s) created.push(s);
        }
        if (page.status === "reviewed" && !String(page.summary || "").trim()) {
          const s = add("fix", `补摘要「${page.title}」`, "reviewed 页面没有摘要，检索与注入都读不到结论", "page", page.id, [], {
            baseRev: page.updatedAt, diff: "+ 补一段能被检索与注入读到的摘要",
          });
          if (s) created.push(s);
        }
        // fill：页面没有引用也没有反链
        if (!cites.length && !(page.backlinks || 0)) {
          const s = add("fill", `补依据「${page.title}」`, "页面既没有引用资料，也没有被别的页面链接", "page", page.id, [], {
            baseRev: page.updatedAt, diff: "+ 补一条引用或互链（不自动编造依据）",
          });
          if (s) created.push(s);
        }
      }
      // build：有资料没有页面
      for (const src of sources) {
        if (cited.has(src.id)) continue;
        const s = add("build", `为资料「${src.title}」建页面`, "这份资料还没有对应页面", "source", src.id, [src.id], {
          baseRev: src.updatedAt || src.updated_at || 0, diff: `+ 新建 draft 页面「${clip(src.title, 60)}」`,
        });
        if (s) created.push(s);
      }
      // promote：已验证的 note 还没进页面
      for (const note of this.noteList({ status: "verified", limit: 50 })) {
        const s = add("promote", `晋升观察：${note.body.slice(0, 40)}`, "已验证的观察可以并入页面或 L4 结论", "note", note.id, [note.sourceRef].filter(Boolean), {
          baseRev: note.updatedAt, diff: `+ 晋升为 L4 条目：${clip(note.body, 80)}`,
        });
        if (s) created.push(s);
      }
      // merge：两条观察说的是同一件事 → 建议合并（只产建议，接受后把多余的那条标 stale）
      const liveNotes = this.noteList({ limit: 300 })
        .filter((n) => n.status === "new" || n.status === "verified")
        .filter((n) => !n.expired);
      const tokensOf = new Map(liveNotes.map((n) => [n.id, new Set(bigramTokens(n.body, { maxTokens: 400 }))]));
      for (let i = 0; i < liveNotes.length; i += 1) {
        for (let j = i + 1; j < liveNotes.length; j += 1) {
          const a = liveNotes[i];
          const b = liveNotes[j];
          if (a.kind !== b.kind) continue;
          if (a.body === b.body) continue; // 完全相同的已经被 dedupe 挡在写入时
          const ta = tokensOf.get(a.id);
          const tb = tokensOf.get(b.id);
          if (Math.min(ta.size, tb.size) < MERGE_MIN_TOKENS) continue;
          const sim = containment(ta, tb);
          if (sim < MERGE_CONTAINMENT) continue;
          // 保留：已验证的优先，否则留新的
          const keep = a.status === "verified" && b.status !== "verified" ? a : (b.status === "verified" && a.status !== "verified" ? b : (a.updatedAt >= b.updatedAt ? a : b));
          const drop = keep.id === a.id ? b : a;
          const s = add(
            "merge",
            `合并观察：${clip(keep.body, 24)}`,
            `两条说的是同一件事（词重合 ${(sim * 100).toFixed(0)}%）：「${clip(keep.body, 60)}」/「${clip(drop.body, 60)}」。接受后保留前者，把后者标为不成立。`,
            "note", keep.id, [keep.id, drop.id], {
              baseRev: keep.updatedAt,
              diff: `- ${clip(drop.body, 80)}\n+ （并入保留项：${clip(keep.body, 60)}）`,
            },
          );
          if (s) created.push(s);
        }
      }

      // correct：某条结论被推翻了，支撑它的观察就该重新确认
      const invalidated = rows("SELECT * FROM entries WHERE invalid_at IS NOT NULL AND invalid_at > ?", [Date.now() - 90 * DAY]).map(entryRow);
      if (invalidated.length) {
        const candidates = this.noteList({ limit: 300 }).filter((n) => n.status === "verified" || n.status === "new");
        for (const dead of invalidated) {
          const refs = new Set(dead.sourceRefs);
          for (const note of candidates) {
            if (!refs.has(note.id) && !(note.sourceRef && refs.has(note.sourceRef))) continue;
            const s = add(
              "correct",
              `复核观察（依据已被推翻）：${clip(note.body, 24)}`,
              `它支撑的结论「${dead.title}」已失效（被 ${dead.supersededBy || "新结论"} 取代），这条观察需要重新确认；接受 = 先标为不成立、退出注入与晋升队列。`,
              "note", note.id, [dead.id], {
                baseRev: note.updatedAt,
                diff: `- 状态：${note.status}\n+ 状态：stale（依据已失效，行与来源保留）`,
              },
            );
            if (s) created.push(s);
          }
        }
      }

      // prune：L3/L2 体积超过原始资料时给减法建议
      const entriesL3 = this.entryList({ layer: "L3" });
      const total = entriesL3.reduce((n, e) => n + e.body.length, 0);
      if (entriesL3.length > 12 || total > 20000) {
        const victims = Math.max(1, Math.ceil(entriesL3.length / 3));
        const s = add("prune", `压缩 L3（${entriesL3.length} 条 / ${total} 字符）`, "L3 体积偏大，建议合并同类条目、正文下沉成页面，只留链接", "entry", entriesL3[0]?.id || "", [], {
          // 剪枝作用于「体积最大的三分之一」，不是某一条：不给 baseRev，免得一条被改就把整条建议作废
          baseRev: 0, diff: `+ 归档 L3 里体积最大的 ${victims} 条（可恢复）`,
        });
        if (s) created.push(s);
      }
      void noteStats;
      if (created.length) bumpDreamBudget({ day, addCount: created.length });
      // 台账：这一轮看到了什么、产出多少、花了多久。语义 pass 的结果稍后回填
      const liveCount = one("SELECT COUNT(*) n FROM notes WHERE status IN ('new','verified')").n;
      run(
        "INSERT INTO dream_runs(id, trigger, fingerprint, pages, sources, notes, created, ms, semantic, at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [runId, trigger, fingerprint, pages.length, sources.length, liveCount, created.length, Date.now() - startedAt, null, startedAt],
      );
      return created;
    },
    // ── Dream 的语义 pass（调模型，默认关）──────────────────────
    /**
     * 一条观察的证据：先给它自己的出处（最强），再按正文关键词去会话索引里找回相关片段。
     * 只给能找到的；找不到就少给——模型看不见的结论不应该被“确认”。
     */
    noteEvidence({ body = "", sourceKind = "", sourceRef = "", max = 3 } = {}) {
      const out = [];
      const push = (src, ref, at, snippet) => {
        const text = clip(snippet || "", 160);
        if (!ref || !text) return;
        if (out.some((e) => e.ref === ref && e.snippet === text)) return;
        out.push({ src, ref, at: Number(at) || 0, snippet: text });
      };
      if (sourceRef) {
        // 观察自己的出处（哪条消息 / 哪个 run）是最强证据：直接回索引取原文
        try {
          const row = one(
            "SELECT t.text AS text, t.at AS at, t.ref_kind AS kind, t.ref_id AS id FROM transcript_map m JOIN transcript_fts t ON t.rowid = m.rowid_ WHERE m.ref_id = ? LIMIT 1",
            [sourceRef],
          );
          if (row) {
            const toks = [...bigramTokens(body, { maxTokens: 24 })].slice(0, 6);
            // 证据只取索引里真实存在的原文片段，不做二次改写
            push(row.kind || sourceKind || "transcript", `${row.kind}:${row.id}`, row.at, makeSnippet(row.text, toks));
          }
        } catch { /* 索引不可用 / 来源不在会话里：只给检索证据 */ }
      }
      // 取最长的几个 bigram 当检索词：短词（“要用”）命中一片，没有证据价值
      const query = [...new Set(bigramTokens(body, { maxTokens: 40 }))]
        .filter((t) => t.length >= 2)
        .slice(0, 4)
        .join(" ");
      if (query) {
        for (const hit of this.transcriptSearch({ query, limit: max })) {
          push(hit.kind, `${hit.kind}:${hit.id}`, hit.at, hit.snippet);
        }
      }
      return out.slice(0, max + 1);
    },
    /** 交给模型的候选集：只在「还活着」的观察里挑，按最近更新排；withEvidence 时带上证据片段 */
    dreamCandidates({ limit = 60, withEvidence = false } = {}) {
      return this.noteList({ limit: 400 })
        .filter((n) => n.status === "new" || n.status === "verified")
        .filter((n) => !n.expired)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, Math.max(2, Math.min(200, Number(limit) || 60)))
        .map((n) => ({
          id: n.id, kind: n.kind, status: n.status, confidence: n.confidence, body: n.body,
          sourceKind: n.sourceKind, sourceRef: n.sourceRef,
          ...(withEvidence
            ? { evidence: this.noteEvidence({ body: n.body, sourceKind: n.sourceKind, sourceRef: n.sourceRef }) }
            : {}),
        }));
    },
    /** 模型调用预算（按本地自然日），和「建议条数」预算是两笔账 */
    dreamModelCallBudget() {
      const cfg = DREAM();
      const b = metaGet("dreamBudget") || {};
      const day = dayKey();
      return {
        day,
        used: b.day === day ? (Number(b.modelCalls) || 0) : 0,
        tokens: b.day === day ? (Number(b.tokens) || 0) : 0,
        limit: Math.max(1, Number(cfg.llmDailyCalls) || 20),
      };
    },
    noteDreamModelCall({ calls = 1, tokens = 0 } = {}) {
      bumpDreamBudget({ day: dayKey(), addCalls: Math.max(0, Number(calls) || 0), addTokens: Math.max(0, Number(tokens) || 0) });
      return this.dreamModelCallBudget();
    },
    /**
     * 模型产出的建议落库。**只收能校验的**：
     *   - 只能对存在的 note 说话（防幻觉 id）；
     *   - merge 必须 ≥2 个 id 且 keep 在 ids 里；
     *   - correct 必须带证据，且证据必须是这次真的给过它的（证据链不许凭空造）；
     *   - rewrite 必须过「不引入新事实」两道闸门；
     *   - 必须有 reason，同一天同类（同 id 集合）不重复入队。
     * 每条都带 diff / base_rev / confidence：人看的不是「我改好了」，是改了什么、基于哪一版。
     */
    dreamModelSuggest({ items = [], model = "", dreamId = "", evidenceRefs = null } = {}) {
      const cfg = DREAM();
      const day = dayKey();
      const budget = metaGet("dreamBudget") || {};
      const usedToday = budget.day === day ? (Number(budget.count) || 0) : 0;
      const dayLimit = Math.max(1, Number(cfg.dayLimit) || DREAM_DAY_LIMIT);
      const rejected = new Set(rows("SELECT sig FROM rejects").map((r) => r.sig));
      const known = new Set(rows("SELECT sig FROM suggestions WHERE status IN ('pending','accepted')").map((r) => r.sig));
      const notes = new Map(this.noteList({ limit: 500 }).map((n) => [n.id, n]));
      const created = [];
      for (const raw of Array.isArray(items) ? items : []) {
        const action = String(raw?.action || "").trim();
        if (!["merge", "correct", "rewrite"].includes(action)) continue;
        const ids = [...new Set((Array.isArray(raw?.ids) ? raw.ids : []).map((v) => String(v || "")).filter(Boolean))]
          .filter((id) => notes.has(id));
        const reason = String(raw?.reason || "").trim();
        if (!reason || reason.length < 4) continue;
        if (action === "merge" && ids.length < 2) continue;
        if (action !== "merge" && ids.length !== 1) continue;
        const evidence = [...new Set((Array.isArray(raw?.evidence) ? raw.evidence : []).map((v) => String(v || "")))]
          .filter(Boolean)
          .slice(0, 4);
        // 校正必须有依据：没给证据 / 引用了没给它的 ref 一律丢（不许拿「我觉得」改别人的记忆）
        if (action === "correct") {
          if (!evidence.length) continue;
          if (evidenceRefs && !evidence.every((r) => evidenceRefs.has(r))) continue;
        }
        const keep = action === "merge"
          ? (ids.includes(String(raw?.keep || "")) ? String(raw.keep) : ids[0])
          : ids[0];
        const keepNote = notes.get(keep);
        if (!keepNote) continue;
        const dropNotes = ids.filter((id) => id !== keep).map((id) => notes.get(id)).filter(Boolean);
        let payload = evidence.length ? { evidence } : null;
        let sig = `llm:${action}:${ids.slice().sort().join("+")}`;
        let diff = "";
        // 改写：只允许动「还没被人确认过」的观察，且不许引入新事实
        if (action === "rewrite") {
          if (keepNote.status !== "new") continue; // verified 是人确认过的，只能走 correct / merge
          const next = String(raw?.body || "").trim();
          if (!next || next.length > NOTE_MAX_CHARS || next === keepNote.body) continue;
          const oldTokens = new Set(bigramTokens(keepNote.body, { maxTokens: 400 }));
          const newTokens = new Set(bigramTokens(next, { maxTokens: 400 }));
          if (!newTokens.size) continue;
          const allowedExtra = Math.max(REWRITE_EXTRA_MIN, Math.ceil(oldTokens.size * REWRITE_EXTRA_RATIO));
          const extras = [...newTokens].filter((t) => !oldTokens.has(t));
          if (extras.length > allowedExtra) continue;            // 引入了原句没有的内容 → 当新事实，拒
          if (containment(oldTokens, newTokens) < REWRITE_MIN_CONTAINMENT) continue; // 把原句扔了
          payload = { body: next, kind: keepNote.kind, ...(evidence.length ? { evidence } : {}) };
          diff = makeDiff(keepNote.body, next);
          sig = `llm:rewrite:${keep}:${dedupeKey(next)}`;
        } else if (action === "merge") {
          diff = [...dropNotes.map((n) => `- ${clip(n.body, 80)}`), `+ （并入保留项：${clip(keepNote.body, 60)}）`].join("\n");
        } else {
          diff = `- 状态：${keepNote.status}\n+ 状态：stale（依据已失效，行与来源保留）`;
        }
        if (rejected.has(sig) || known.has(sig)) continue;
        if (usedToday + created.length >= dayLimit || created.length >= cfg.maxSuggestions) break;
        const title = action === "merge"
          ? `合并观察（模型）：${clip(keepNote.body, 24)}`
          : action === "correct"
            ? `复核观察（模型判断不成立）：${clip(keepNote.body, 24)}`
            : `改写观察（模型）：${clip(keepNote.body, 20)} → ${clip(payload.body, 20)}`;
        const reasonLine = evidence.length ? `${reason.slice(0, 240)}\n\n依据：${evidence.join(" / ")}` : reason.slice(0, 240);
        const detail = action === "rewrite"
          ? `${reasonLine}\n\n原句：「${clip(keepNote.body, 80)}」`
          : `${reasonLine}\n\n${ids.map((id) => `「${clip(notes.get(id).body, 60)}」`).join(" / ")}`;
        const id = uid("s");
        run(
          "INSERT INTO suggestions(id, action, title, detail, payload, target_kind, target_id, sources, sig, status, diff, base_rev, confidence, dream_id, created_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [id, action, title.slice(0, 200), detail, payload ? JSON.stringify(payload) : null, "note", keep, JSON.stringify(ids), sig, "pending",
            diff, targetRev("note", keep), 0.5, dreamId || "", Date.now(), null],
        );
        known.add(sig);
        created.push(sugRow(one("SELECT * FROM suggestions WHERE id=?", [id])));
      }
      if (created.length) bumpDreamBudget({ day, addCount: created.length });
      void model;
      return created;
    },
    suggestionList({ status = "pending", limit = 100 } = {}) {
      return rows("SELECT * FROM suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?", [status, limit]).map(sugRow);
    },
    suggestionResolve({ id, accept = false } = {}) {
      const sug = one("SELECT * FROM suggestions WHERE id=?", [id]);
      if (!sug) throw new Error("建议不存在");
      // 版本闸门：目标在这条建议之后被人改过 → 作废，绝不覆盖人的修改
      if (accept) {
        const baseRev = Number(sug.base_rev) || 0;
        const cur = baseRev ? targetRev(sug.target_kind, sug.target_id) : 0;
        if (baseRev && cur && cur !== baseRev) {
          return this.suggestionSuperseded({ id, reason: `目标在建议之后被改过（基础版本 ${baseRev} ≠ 当前 ${cur}），不覆盖` });
        }
      }
      run("UPDATE suggestions SET status=?, resolved_at=? WHERE id=?", [accept ? "accepted" : "rejected", Date.now(), id]);
      // 拒绝过的同类不再反复打扰
      if (!accept) run("INSERT INTO rejects VALUES (?,?,1) ON CONFLICT(sig) DO UPDATE SET at=excluded.at, times=times+1", [sug.sig, Date.now()]);
      return sugRow(one("SELECT * FROM suggestions WHERE id=?", [id]));
    },
    /** 建议作废：目标已被改动（人改过 / 被另一条建议改过）。不进 rejects——这不是“人拒绝了它”。 */
    suggestionSuperseded({ id, reason = "" } = {}) {
      const sug = one("SELECT * FROM suggestions WHERE id=?", [id]);
      if (!sug) throw new Error("建议不存在");
      run("UPDATE suggestions SET status='superseded', resolved_at=? WHERE id=?", [Date.now(), id]);
      return { ...sugRow(one("SELECT * FROM suggestions WHERE id=?", [id])), superseded: true, reason };
    },

    overview() {
      const byLayer = {};
      for (const layer of LAYERS) {
        byLayer[layer] = one("SELECT COUNT(*) n FROM entries WHERE layer=? AND status='active' AND invalid_at IS NULL", [layer]).n;
      }
      return {
        byLayer,
        notes: one("SELECT COUNT(*) n FROM notes WHERE status IN ('new','verified')").n,
        notesPending: one("SELECT COUNT(*) n FROM notes WHERE status='new'").n,
        notesExpired: one("SELECT COUNT(*) n FROM notes WHERE status IN ('new','verified') AND expires_at IS NOT NULL AND expires_at <= ?", [Date.now()]).n,
        suggestions: one("SELECT COUNT(*) n FROM suggestions WHERE status='pending'").n,
        invalidated: one("SELECT COUNT(*) n FROM entries WHERE invalid_at IS NOT NULL").n,
        injectable: this.inject({}).chars,
        version: version(),
      };
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
