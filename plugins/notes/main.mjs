/**
 * Cockpit Wiki — native LLM Wiki data store.
 *
 * Sources are imported into the app-owned wiki store; pages are generated or
 * edited as drafts, cite sources, and require human review before becoming
 * reviewed knowledge. No external Obsidian vault is required.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { planCurate, INDEX_TITLE } from "./curate-structure.mjs";
import { claimCandidates, normalizeClaim, evaluateClaims } from "./claims.mjs";
import { buildMergedDraft, findCitationCandidates, findMergeCandidates } from "./maintenance.mjs";

let ctx;
let seq = 0;
let data = {
  version: 2,
  sources: [],
  pages: [],
  citations: [],
  revisions: [],
  reviews: [],
  suggestions: [],
  claims: [],
  log: [],
  trash: [],
  pins: [],
  recents: [],
  backlinks: {},
  layout: null,
  vaultPath: "",
};

function now() { return Date.now(); }
function id(prefix) { seq += 1; return `${prefix}${Date.now().toString(36)}${seq}`; }
/** 资料去重：同路径（uri）或同内容 hash 视为同一份资料 */
function findSource({ uri = "", content = "" } = {}) {
  const cleanUri = String(uri || "").trim();
  const h = hash(content || "");
  return data.sources.find((src) => (cleanUri && src.uri === cleanUri) || (src.hash && src.hash === h)) || null;
}

function hash(text) { return crypto.createHash("sha256").update(String(text || "")).digest("hex"); }
function slugify(text) {
  return String(text || "page").toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
}
function dataFile() { return path.join(ctx.dataDir, "wiki.json"); }
function indexPath() { return path.join(ctx.dataDir, "wiki-index.json"); }
function searchFile() { return path.join(ctx.dataDir, "wiki-search.json"); }
function trashFile() { return path.join(ctx.dataDir, "wiki-trash.json"); }
function pageDir() { return path.join(ctx.dataDir, "pages"); }
function sourceDir() { return path.join(ctx.dataDir, "sources"); }
function revisionDir() { return path.join(ctx.dataDir, "revisions"); }
function safeFile(id) { return String(id || "item").replace(/[^a-zA-Z0-9_-]/g, "_"); }
function pageFile(id) { return path.join(pageDir(), `${safeFile(id)}.md`); }
function sourceFile(id) { return path.join(sourceDir(), `${safeFile(id)}.txt`); }
const dirtyPages = new Set();
const dirtySources = new Set();
let searchCache = null;
let searchDirty = false;
let backlinkIndex = null;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const VAULT_IGNORE = new Set([".obsidian", ".git", ".trash", "node_modules"]);
const VAULT_MAX_BYTES = 5 * 1024 * 1024;
const VAULT_MAX_FILES = 5000;
let vaultCache = null;

function posix(p) { return String(p).replace(/\\/g, "/"); }
function vaultRoot() { return data.vaultPath ? path.resolve(data.vaultPath) : ""; }
function withinVault(rel = "") {
  const root = vaultRoot();
  if (!root) throw new Error("还没有打开本地目录");
  const full = path.resolve(root, String(rel || ""));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("路径必须位于本地目录内");
  return { root, full };
}
function vaultRel(full) { return posix(path.relative(vaultRoot(), full)); }
function vaultTitle(raw, rel) {
  const front = String(raw || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fmTitle = front?.[1]?.match(/^title\s*:\s*(.+)$/mi)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const heading = String(raw || "").match(/^#\s+(.+)$/m)?.[1]?.trim();
  return String(fmTitle || heading || path.basename(rel, path.extname(rel))).slice(0, 200);
}
async function vaultIndex(force = false) {
  if (!data.vaultPath) return { path: "", files: [], indexedAt: 0, error: "" };
  const root = vaultRoot();
  if (!force && vaultCache && vaultCache.path === root && Date.now() - vaultCache.indexedAt < 1500) return vaultCache;
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error("不是目录");
    const files = [];
    async function walk(dir) {
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= VAULT_MAX_FILES) return;
        if (entry.name.startsWith(".") && VAULT_IGNORE.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (VAULT_IGNORE.has(entry.name)) continue;
          await walk(full);
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          try {
            const info = await fs.stat(full);
            if (info.size > VAULT_MAX_BYTES) continue;
            const raw = await fs.readFile(full, "utf8");
            const rel = vaultRel(full);
            files.push({ path: rel, title: vaultTitle(raw, rel), folder: posix(path.dirname(rel) === "." ? "" : path.dirname(rel)), mtime: info.mtimeMs, size: info.size });
          } catch { /* skip unreadable */ }
        }
      }
    }
    await walk(root);
    files.sort((a, b) => a.path.localeCompare(b.path));
    vaultCache = { path: root, files, indexedAt: Date.now(), error: "" };
  } catch (err) {
    vaultCache = { path: root, files: [], indexedAt: Date.now(), error: String(err?.message || err) };
  }
  return vaultCache;
}
async function readVaultFile(rel) {
  const { full } = withinVault(rel);
  if (!/\.md$/i.test(full)) throw new Error("只支持 Markdown 文件");
  const [raw, info] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);
  if (info.size > VAULT_MAX_BYTES) throw new Error("文件超过 5MB");
  const safeRel = vaultRel(full);
  return { path: safeRel, title: vaultTitle(raw, safeRel), folder: posix(path.dirname(safeRel) === "." ? "" : path.dirname(safeRel)), content: raw, mtime: info.mtimeMs, size: info.size };
}
async function pickVault() {
  const chosen = await ctx.fs.pickDirectory({ title: "选择本地 Markdown 目录" });
  if (!chosen) return null;
  data.vaultPath = path.resolve(String(chosen));
  vaultCache = null;
  addLog("vault.open", data.vaultPath);
  await persist();
  return vaultIndex(true);
}

/** 页面正文按 ID 分片；列表/索引只拿 metadata，打开单页时才读这一份。 */
function attachPage(page) {
  let cached;
  if (Object.prototype.hasOwnProperty.call(page, "content")) {
    cached = String(page.content ?? "");
    delete page.content;
    dirtyPages.add(page.id);
  }
  Object.defineProperty(page, "content", {
    configurable: true, enumerable: false,
    get() {
      if (cached === undefined) {
        try { cached = fsSync.readFileSync(pageFile(page.id), "utf8"); } catch { cached = ""; }
      }
      return cached;
    },
    set(value) {
      cached = String(value ?? "");
      dirtyPages.add(page.id);
      searchDirty = true;
      backlinkIndex = null;
    },
  });
  return page;
}

function attachSource(source) {
  let cached;
  if (Object.prototype.hasOwnProperty.call(source, "content")) {
    cached = String(source.content ?? "");
    delete source.content;
    dirtySources.add(source.id);
  }
  Object.defineProperty(source, "content", {
    configurable: true, enumerable: false,
    get() {
      if (cached === undefined) {
        try { cached = fsSync.readFileSync(sourceFile(source.id), "utf8"); } catch { cached = ""; }
      }
      return cached;
    },
    set(value) {
      cached = String(value ?? "");
      dirtySources.add(source.id);
      searchDirty = true;
      backlinkIndex = null;
    },
  });
  return source;
}

function pageMeta(page) { return { ...page }; }
function sourceMeta(source) { return { ...source }; }

function hydrate(raw) {
  data = {
    ...data, ...raw,
    trash: Array.isArray(raw.trash) ? raw.trash : [],
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
    claims: Array.isArray(raw.claims) ? raw.claims : [],
    pins: Array.isArray(raw.pins) ? raw.pins : [],
    recents: Array.isArray(raw.recents) ? raw.recents : [],
    backlinks: raw.backlinks && typeof raw.backlinks === "object" ? raw.backlinks : {},
    revisions: [],
  };
  data.pages = (data.pages || []).map(attachPage);
  data.sources = (data.sources || []).map(attachSource);
  seq = Number(raw.seq) || seq;
  searchDirty = Boolean(raw.searchDirty);
  backlinkIndex = null;
}

function searchEntry(kind, item) {
  if (kind === "page") {
    return { kind: "page", id: item.id, title: item.title, status: item.status, at: item.updatedAt, text: `${item.title}\n${item.summary || ""}\n${item.content || ""}` };
  }
  return { kind: "source", id: item.id, title: item.title, status: "source", at: item.createdAt, text: `${item.title}\n${item.uri || ""}\n${item.content || ""}` };
}

function rebuildBacklinkIndex() {
  const map = new Map();
  for (const entry of searchCache || []) {
    if (entry.kind !== "page") continue;
    for (const match of String(entry.text || "").matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
      const key = match[1].trim().toLowerCase();
      if (!key) continue;
      const list = map.get(key) || [];
      const at = String(entry.text).indexOf(`[[${match[1]}`);
      const snippet = at >= 0 ? String(entry.text).slice(Math.max(0, at - 45), at + 120).replace(/\s+/g, " ").trim() : "";
      list.push({ id: entry.id, title: entry.title, status: entry.status, snippet });
      map.set(key, list);
    }
  }
  backlinkIndex = map;
  data.backlinks = Object.fromEntries(map);
}

function buildSearchCacheFromShards() {
  const pages = data.pages.map((page) => searchEntry("page", page));
  const sources = data.sources.map((source) => searchEntry("source", source));
  searchCache = [...pages, ...sources];
  searchDirty = true;
  backlinkIndex = null;
  return searchCache;
}

/** 搜索索引单独一个文件；单页/列表不读它。 */
function loadSearchSync() {
  if (searchCache && !searchDirty) return searchCache;
  try {
    const raw = JSON.parse(fsSync.readFileSync(searchFile(), "utf8"));
    if (Array.isArray(raw) && !searchDirty) searchCache = raw;
  } catch { /* missing */ }
  if (!searchCache || searchDirty) {
    buildSearchCacheFromShards();
    try { fsSync.mkdirSync(ctx.dataDir, { recursive: true }); writeAtomic(searchFile(), JSON.stringify(searchCache)); searchDirty = false; } catch { /* next persist retries */ }
  }
  if (!backlinkIndex) rebuildBacklinkIndex();
  return searchCache;
}

function updateSearchEntry(kind, item) {
  if (!searchCache) {
    try { loadSearchSync(); } catch { searchDirty = true; }
  }
  if (!searchCache) { searchDirty = true; return; }
  const entry = searchEntry(kind, item);
  const idx = searchCache.findIndex((x) => x.kind === kind && x.id === item.id);
  if (idx >= 0) searchCache[idx] = entry; else searchCache.unshift(entry);
  searchDirty = true;
  backlinkIndex = null;
  if (searchCache) rebuildBacklinkIndex();
}

function removeSearchEntry(kind, id) {
  if (!searchCache) {
    try { loadSearchSync(); } catch { searchDirty = true; }
  }
  if (!searchCache) { searchDirty = true; return; }
  searchCache = searchCache.filter((x) => !(x.kind === kind && x.id === id));
  searchDirty = true;
  backlinkIndex = null;
  if (searchCache) rebuildBacklinkIndex();
}

function writeAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fsSync.writeFileSync(tmp, value, "utf8");
  fsSync.renameSync(tmp, file);
}

async function migrateLegacy(raw) {
  fsSync.mkdirSync(pageDir(), { recursive: true });
  fsSync.mkdirSync(sourceDir(), { recursive: true });
  fsSync.mkdirSync(revisionDir(), { recursive: true });
  hydrate(raw);
  for (const page of data.pages) {
    fsSync.writeFileSync(pageFile(page.id), page.content, "utf8");
    dirtyPages.add(page.id);
  }
  for (const source of data.sources) {
    fsSync.writeFileSync(sourceFile(source.id), source.content, "utf8");
    dirtySources.add(source.id);
  }
  for (const entry of data.trash || []) {
    const obj = entry.page || entry.source;
    if (!obj) continue;
    const kind = entry.page ? "page" : "source";
    if (kind === "page") {
      const content = obj.content ?? "";
      delete obj.content;
      attachPage(obj);
      fsSync.writeFileSync(pageFile(obj.id), content, "utf8");
    } else {
      const content = obj.content ?? "";
      delete obj.content;
      attachSource(obj);
      fsSync.writeFileSync(sourceFile(obj.id), content, "utf8");
    }
  }
  // 旧 revisions 是全局数组；按页面拆成 NDJSON
  const revisions = Array.isArray(raw.revisions) ? raw.revisions : [];
  for (const rev of revisions) {
    try { fsSync.appendFileSync(path.join(revisionDir(), `${safeFile(rev.pageId)}.ndjson`), `${JSON.stringify(rev)}\n`, "utf8"); } catch { /* ignore */ }
  }
  data.revisions = [];
  buildSearchCacheFromShards();
  rebuildBacklinkIndex();
  await persist();
  try { fsSync.renameSync(dataFile(), `${dataFile()}.bak`); } catch { /* keep legacy if rename fails */ }
}

async function load() {
  try {
    const raw = JSON.parse(await fs.readFile(indexPath(), "utf8"));
    hydrate(raw);
  } catch {
    try {
      const legacy = JSON.parse(await fs.readFile(dataFile(), "utf8"));
      await migrateLegacy(legacy);
    } catch { /* first run */ }
  }
  try {
    const trash = JSON.parse(await fs.readFile(trashFile(), "utf8"));
    if (Array.isArray(trash)) data.trash = trash;
  } catch { /* no trash */ }
  // 旧的分片库可能还没有 backlinks 索引：一次性从搜索索引回填
  if ((!data.backlinks || Object.keys(data.backlinks).length === 0) && data.pages.length) {
    try { loadSearchSync(); await persist(); } catch { /* ignore */ }
  }
}

async function persist() {
  await fs.mkdir(pageDir(), { recursive: true });
  await fs.mkdir(sourceDir(), { recursive: true });
  for (const id of dirtyPages) {
    const page = data.pages.find((p) => p.id === id);
    if (page) await fs.writeFile(pageFile(id), page.content, "utf8");
  }
  for (const id of dirtySources) {
    const source = data.sources.find((s) => s.id === id);
    if (source) await fs.writeFile(sourceFile(id), source.content, "utf8");
  }
  if (searchCache && searchDirty) {
    const tmpSearch = `${searchFile()}.tmp`;
    await fs.writeFile(tmpSearch, JSON.stringify(searchCache), "utf8");
    await fs.rename(tmpSearch, searchFile());
    searchDirty = false;
    if (backlinkIndex === null) rebuildBacklinkIndex();
  }
  const tmpTrash = `${trashFile()}.tmp`;
  await fs.writeFile(tmpTrash, JSON.stringify(data.trash || []), "utf8");
  await fs.rename(tmpTrash, trashFile());
  const index = {
    version: 2, seq,
    pages: data.pages.map(pageMeta),
    sources: data.sources.map(sourceMeta),
    citations: data.citations,
    reviews: data.reviews,
    suggestions: data.suggestions,
    claims: data.claims,
    log: data.log,
    pins: data.pins,
    recents: data.recents,
    backlinks: data.backlinks || {},
    layout: data.layout,
    vaultPath: data.vaultPath,
    searchDirty,
  };
  const tmpIndex = `${indexPath()}.tmp`;
  await fs.writeFile(tmpIndex, JSON.stringify(index), "utf8");
  await fs.rename(tmpIndex, indexPath());
  dirtyPages.clear();
  dirtySources.clear();
}

function addLog(kind, text) {
  data.log.unshift({ id: id("log"), kind, text: String(text).slice(0, 2000), at: now() });
  data.log = data.log.slice(0, 500);
}

function pageBySlug(slug) { return data.pages.find((p) => p.slug === slug) || data.pages.find((p) => p.id === slug) || null; }
function sourceView(source, includeContent = false) {
  if (!source) return null;
  const view = clone({ ...source });
  if (includeContent) view.content = source.content;
  return view;
}

function citationsOf(pageId) {
  return data.citations.filter((c) => c.pageId === pageId).map((c) => ({ ...c, source: sourceView(data.sources.find((s) => s.id === c.sourceId)) }));
}

function backlinksOf(page) {
  return (data.backlinks?.[page.title.toLowerCase()] || []).filter((b) => b.id !== page.id);
}

function unlinkedMentionsOf(page) {
  loadSearchSync();
  const linked = new Set((backlinkIndex?.get(page.title.toLowerCase()) || []).map((b) => b.id));
  return (searchCache || [])
    .filter((entry) => entry.kind === "page" && entry.id !== page.id && !linked.has(entry.id) && String(entry.text).includes(page.title))
    .map((entry) => {
      const at = String(entry.text).indexOf(page.title);
      return { id: entry.id, title: entry.title, status: entry.status, snippet: String(entry.text).slice(Math.max(0, at - 45), at + 120).replace(/\s+/g, " ").trim() };
    })
    .slice(0, 20);
}

function pageView(page, includeContent = true) {
  if (!page) return null;
  return {
    ...clone(page),
    content: includeContent ? page.content : undefined,
    citations: citationsOf(page.id),
    backlinks: backlinksOf(page),
  };
}

function pageSummary(page) {
  return { id: page.id, slug: page.slug, title: page.title, summary: page.summary || "", status: page.status, confidence: page.confidence || "medium", updatedAt: page.updatedAt, citations: citationsOf(page.id).length, backlinks: backlinksOf(page).length, claims: claimsOf(page.id).length };
}

function pageRevision(page, reason) {
  const rev = { id: id("rev"), pageId: page.id, content: page.content, status: page.status, reason, createdAt: now() };
  try {
    fsSync.mkdirSync(revisionDir(), { recursive: true });
    fsSync.appendFileSync(path.join(revisionDir(), `${safeFile(page.id)}.ndjson`), `${JSON.stringify(rev)}\n`, "utf8");
  } catch { /* 历史记录失败不影响页面保存 */ }
}

// ── 建议队列（不是直接写入）─────────────────────────────────────────────
// 整理只对 draft 直接落盘；reviewed / stale 的改动一律先变成一条建议，人点头才写。
// 建议里存的是**渲染好的完整正文**，批准时纯字节拷贝 —— 审核者读到的就是发布的字节。
const SUGGESTION_LIMIT = 120;
const SUGGESTION_MAX_CHARS = 200_000;

function suggestionSummary(sug) {
  if (!sug) return null;
  return {
    id: sug.id,
    kind: sug.kind,
    targetKind: sug.targetKind,
    targetId: sug.targetId,
    title: sug.title,
    status: sug.status,
    confidence: sug.confidence || "medium",
    reasons: (sug.evidence || []).map((e) => e.quote).filter(Boolean),
    evidence: (sug.evidence || []).map((e) => ({ kind: e.kind, id: e.id, quote: e.quote })),
    size: sug.size || { lines: 0, chars: 0 },
    createdAt: sug.createdAt,
    decidedAt: sug.decidedAt || null,
    feedback: sug.feedback || "",
  };
}

/** 同一条建议被拒绝后，30 天内不再打扰（复用记忆侧 Dream 建议的节流口径） */
const SUGGESTION_REJECT_COOLDOWN = 30 * 24 * 3600 * 1000;

/**
 * 统一的入队闸门：所有 kind 都走这里。
 * - `sig` 是「这是同一条建议」的身份：pending 去重、拒绝后节流、接受后不重复入队；
 * - 没有 evidence 的一律不入队（机器提出来可以，但必须说得出依据）。
 */
function enqueueSuggestion({ kind, targetKind = "page", targetId, title, payload, baseHash = "", evidence = [], confidence = "high", sig }) {
  if (!payload || !sig) return false;
  if (payload.length > SUGGESTION_MAX_CHARS) return false;
  if (!Array.isArray(data.suggestions)) data.suggestions = [];
  const existing = data.suggestions.find((s) => s.sig === sig);
  if (existing) {
    if (existing.status === "pending") return false;
    if (existing.status === "rejected" && existing.decidedAt && now() - existing.decidedAt < SUGGESTION_REJECT_COOLDOWN) return false;
    if (existing.status === "accepted" && existing.payload === payload) return false;
  }
  if (!evidence.length) return false;
  data.suggestions.unshift({
    id: id("sug"),
    kind,
    targetKind,
    targetId,
    title,
    payload,
    payloadHash: hash(payload),
    baseHash,
    confidence,
    evidence,
    size: { lines: payload.split("\n").length, chars: payload.length },
    sig,
    status: "pending",
    createdAt: now(),
    decidedAt: null,
    feedback: "",
  });
  data.suggestions = data.suggestions.slice(0, SUGGESTION_LIMIT);
  addLog("suggestion.create", `${title}：${kind}`);
  return true;
}

/** 结构整理：同一页面的旧 pending 作废；内容完全相同的建议不重复入队（sig 含 payload hash） */
function upsertStructureSuggestion(page, change) {
  const payload = String(change.after || "");
  if (!payload) return false;
  if (!Array.isArray(data.suggestions)) data.suggestions = [];
  const sig = `structure:${page.id}:${hash(payload).slice(0, 16)}`;
  for (const old of data.suggestions) {
    if (old.kind === "structure" && old.targetId === page.id && old.status === "pending" && old.sig !== sig) old.status = "superseded";
  }
  const reasons = (change.reasons || []).filter(Boolean);
  return enqueueSuggestion({
    kind: "structure",
    targetId: page.id,
    title: page.title,
    payload,
    // 基线：接受时用它判断页面是否已经被别人改过（不一致就不自动合并）
    baseHash: hash(String(page.content || "")),
    evidence: [
      { kind: "rule", id: "curate.structure", quote: reasons.join(" · ").slice(0, 400) || "结构整理" },
      ...(change.blockedClaims || []).slice(0, 6).map((c) => ({ kind: "claim", id: c.id, quote: c.quote })),
    ],
    sig,
  });
}

// ── 人工结论（claim）：人改过的一句话不能在下一次整理里消失 ──────────────
const CLAIMS_PER_PAGE = 40;
const CLAIMS_PER_SAVE = 12;

function claimsOf(pageId, { includeRemoved = false } = {}) {
  return (data.claims || []).filter((c) => c.pageId === pageId && (includeRemoved || c.status !== "removed"));
}

/**
 * 人（不是 Agent、不是系统）保存页面时，把**这次新出现的行**记成 claim。
 * 人自己删掉的那一行视为自己撤销了那条结论 —— 不要留成 orphan 噪声。
 */
function recordHumanClaims(page, prevContent, nextContent) {
  if (!Array.isArray(data.claims)) data.claims = [];
  const kept = new Set(String(nextContent || "").split("\n").map(normalizeClaim).filter(Boolean));
  data.claims = data.claims.filter((c) => c.pageId !== page.id || c.status === "removed" || kept.has(normalizeClaim(c.quote)));

  const existing = new Set(claimsOf(page.id, { includeRemoved: true }).map((c) => normalizeClaim(c.quote)));
  let added = 0;
  for (const quote of claimCandidates(prevContent, nextContent, CLAIMS_PER_SAVE)) {
    if (existing.has(quote)) continue;
    data.claims.push({
      id: id("claim"),
      pageId: page.id,
      quote,
      kind: "line",
      provenance: { by: "human", at: now() },
      status: "active",
      checkedAt: null,
    });
    added += 1;
  }
  // 单页上限：保留最近的一批，别让结论列表变成垃圾场
  const mine = data.claims.filter((c) => c.pageId === page.id);
  if (mine.length > CLAIMS_PER_PAGE) {
    const drop = new Set(mine.slice(0, mine.length - CLAIMS_PER_PAGE).map((c) => c.id));
    data.claims = data.claims.filter((c) => !drop.has(c.id));
  }
  return added;
}

function setClaimStatus(ids, status) {
  const want = new Set(ids || []);
  for (const claim of data.claims || []) {
    if (want.has(claim.id)) { claim.status = status; claim.checkedAt = now(); }
  }
}

/** 合并草稿接手原页面的结论：只带「草稿里确实有」的那些，凭空搬没有意义 */
function carryClaimsTo(targetPageId, sourcePageIds, content) {
  const lines = String(content || "").split("\n").map(normalizeClaim).filter(Boolean);
  const existing = new Set(claimsOf(targetPageId).map((c) => normalizeClaim(c.quote)));
  let carried = 0;
  for (const claim of data.claims || []) {
    if (claim.status === "removed" || !sourcePageIds.includes(claim.pageId)) continue;
    const key = normalizeClaim(claim.quote);
    if (!key || existing.has(key)) continue;
    const present = lines.some((line) => line.includes(key) || (key.includes(line) && line.length >= 8));
    if (!present) continue;
    data.claims.push({
      id: id("claim"),
      pageId: targetPageId,
      quote: claim.quote,
      kind: claim.kind === "explicit" ? "explicit" : "line",
      provenance: { by: "carry", from: claim.pageId, at: now() },
      status: "active",
      checkedAt: null,
    });
    existing.add(key);
    carried += 1;
  }
  return carried;
}

/** 按页面聚合「对不上的结论」：审核 tab 用，右栏之外也要能一眼看到 */
function claimIssuesByPage() {
  const byPage = new Map();
  for (const claim of data.claims || []) {
    if (claim.status !== "conflict" && claim.status !== "orphan") continue;
    const page = data.pages.find((p) => p.id === claim.pageId);
    if (!page) continue;
    if (!byPage.has(page.id)) byPage.set(page.id, { pageId: page.id, title: page.title, status: page.status, claims: [] });
    byPage.get(page.id).claims.push({ id: claim.id, quote: claim.quote, status: claim.status });
  }
  return [...byPage.values()];
}

function claimView(claim) {
  return {
    id: claim.id,
    pageId: claim.pageId,
    quote: claim.quote,
    status: claim.status,
    kind: claim.kind,
    provenance: claim.provenance || null,
    checkedAt: claim.checkedAt || null,
  };
}

/** 页面被删 / 被审核时，顺带把过期的建议关掉，避免队列里堆死条目 */
function expireSuggestions(predicate, status = "expired") {
  let n = 0;
  for (const sug of data.suggestions || []) {
    if (sug.status === "pending" && predicate(sug)) { sug.status = status; sug.decidedAt = now(); n += 1; }
  }
  return n;
}

function ensurePage({ title, summary = "", content = "", sourceIds = [] }) {
  const safeTitle = String(title || "").trim().slice(0, 180) || "Untitled";
  let slug = slugify(safeTitle);
  let n = 2;
  while (data.pages.some((p) => p.slug === slug)) slug = `${slugify(safeTitle)}-${n++}`;
  const page = {
    id: id("pg"), slug, title: safeTitle, summary: String(summary).slice(0, 2000),
    content: String(content || `# ${safeTitle}\n\n`),
    status: "draft", confidence: "medium", createdAt: now(), updatedAt: now(), reviewedAt: null,
  };
  attachPage(page);
  data.pages.unshift(page);
  updateSearchEntry("page", page);
  for (const sourceId of sourceIds) if (data.sources.some((s) => s.id === sourceId)) data.citations.push({ id: id("cite"), pageId: page.id, sourceId, quote: "", locator: "", createdAt: now() });
  pageRevision(page, "create");
  addLog("page.create", page.title);
  return page;
}

/**
 * 搜索评分：
 * - 完整短语优先
 * - 多词 / 中文按字匹配，避免「登录报错」搜不到「登录时……报错」
 * - 英文再做一次子序列模糊匹配
 * - 标题命中加权， reviewed 页面和引用多的页面略微靠前
 */
function searchScore(text, query) {
  const body = String(text || "").toLowerCase();
  const q = String(query || "").toLowerCase().trim();
  if (!body || !q) return null;
  const exact = body.indexOf(q);
  if (exact >= 0) return { score: 20, at: exact };
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => body.includes(t))) return { score: 12, at: Math.max(0, body.indexOf(tokens[0])) };
  const chars = [...q.replace(/\s+/g, "")];
  const hit = chars.filter((ch) => body.includes(ch));
  if (chars.length > 1 && hit.length >= Math.max(2, Math.ceil(chars.length * 0.6))) {
    return { score: 4 + (hit.length / chars.length) * 4, at: Math.max(0, body.indexOf(hit[0])) };
  }
  let cursor = 0;
  for (const ch of q) {
    const at = body.indexOf(ch, cursor);
    if (at < 0) return null;
    cursor = at + ch.length;
  }
  return { score: 2, at: 0 };
}

function searchAll(q, limit = 40) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return [];
  loadSearchSync();
  const out = [];
  for (const entry of searchCache || []) {
    const titleHit = searchScore(entry.title, query);
    const bodyHit = searchScore(entry.text, query);
    const hit = titleHit && bodyHit ? (titleHit.score + 2 >= bodyHit.score ? titleHit : bodyHit) : (titleHit || bodyHit);
    if (!hit) continue;
    const total = hit.score + (titleHit ? 6 : 0) + (entry.kind === "page" && entry.status === "reviewed" ? 2 : 0) + (entry.kind === "page" ? Math.min(3, citationsOf(entry.id).length) : 0);
    const at = Math.max(0, hit.at || 0);
    out.push({
      kind: entry.kind, id: entry.id, title: entry.title, status: entry.status, at: entry.at,
      snippet: String(entry.text).slice(Math.max(0, at - 60), at + 180).replace(/\s+/g, " "), rank: total,
    });
  }
  return out.sort((a, b) => (b.rank || 0) - (a.rank || 0)).slice(0, limit);
}

/** 所有页面里出现过的 #标签，供编辑器补全；附使用次数 */
function allTags() {
  const counts = new Map();
  loadSearchSync();
  for (const entry of (searchCache || []).filter((x) => x.kind === "page")) {
    const text = entry.text || entry.title;
    for (const match of text.matchAll(/(^|[\s（(])#([\p{L}\p{N}_-]{1,40})/gu)) {
      const tag = match[2];
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 200).map(([tag, count]) => ({ tag, count }));
}

function memoryMarkdown(maxChars = 12000) {
  const ranked = [...data.pages].sort((a, b) => {
    const score = (p) => (p.status === "reviewed" ? 20 : p.status === "stale" ? -5 : 8) + (citationsOf(p.id).length ? 3 : 0) + (p.updatedAt || 0) / 1e13;
    return score(b) - score(a);
  });
  const lines = [
    "# Memory",
    "",
    "> 这是 Wiki 的小型顶层索引；详情用 wiki_search / wiki_read_page 读取。",
    "",
    `- pages: ${data.pages.length}`,
    `- sources: ${data.sources.length}`,
    `- drafts: ${data.pages.filter((p) => p.status === "draft").length}`,
    `- stale: ${data.pages.filter((p) => p.status === "stale").length}`,
    "",
  ];
  loadSearchSync();
  const textById = new Map((searchCache || []).filter((x) => x.kind === "page").map((x) => [x.id, x.text]));
  for (const page of ranked) {
    const summary = (page.summary || String(textById.get(page.id) || "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim()).slice(0, 220);
    lines.push(`## ${page.title}`);
    lines.push(`status: ${page.status} · citations: ${citationsOf(page.id).length}`);
    if (summary) lines.push(summary);
    lines.push("");
    if (lines.join("\n").length > maxChars) break;
  }
  const text = lines.join("\n");
  return { markdown: text.slice(0, maxChars), pageCount: ranked.length, chars: text.length };
}

function graphView() {
  const nodes = [
    ...data.pages.map((p) => ({ id: p.id, title: p.title, kind: "page", links: 0 })),
    ...data.sources.map((s) => ({ id: s.id, title: s.title, kind: "source", links: 0 })),
    // 本地目录里的 Markdown 也进图：即使还没导入为 source，打开目录后图谱也不该是空的
    ...(vaultCache?.files || []).map((f) => ({ id: `file:${f.path}`, title: f.title, kind: "file", links: 0 })),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const c of data.citations) {
    if (byId.has(c.pageId) && byId.has(c.sourceId)) {
      edges.push({ source: c.pageId, target: c.sourceId, kind: "citation" });
      byId.get(c.pageId).links += 1; byId.get(c.sourceId).links += 1;
    }
  }
  loadSearchSync();
  const pageText = new Map((searchCache || []).filter((x) => x.kind === "page").map((x) => [x.id, x.text]));
  for (const page of data.pages) {
    for (const m of String(pageText.get(page.id) || "").matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)) {
      const target = pageBySlug(slugify(m[1])) || data.pages.find((p) => p.title.toLowerCase() === m[1].trim().toLowerCase());
      if (target && target.id !== page.id) {
        edges.push({ source: page.id, target: target.id, kind: "link" });
        byId.get(page.id).links += 1; byId.get(target.id).links += 1;
      }
    }
  }
  return { nodes, edges };
}

async function command(name) {
  if (name === "wiki.open" || name === "wiki.graph") return ctx.ui.openView("notes");
  if (name === "wiki.new") return ctx.ui.openView("notes");
  // 「整理 Wiki」命令在 activate 内注册（直接调用 curateWiki），这里只兜底打开视图
  if (name === "wiki.curate") return ctx.ui.openView("notes");
  if (name === "wiki.openFolder") {
    const vault = await pickVault();
    if (vault) await ctx.ui.openView("notes");
    return vault;
  }
  throw new Error(`unknown command: ${name}`);
}

export async function activate(context) {
  ctx = context;
  await load();

  ctx.api.handle("wiki.status", async () => ({ pages: data.pages.length, sources: data.sources.length, drafts: data.pages.filter((p) => p.status === "draft").length, stale: data.pages.filter((p) => p.status === "stale").length, suggestions: (data.suggestions || []).filter((s) => s.status === "pending").length, vaultPath: data.vaultPath }));
  ctx.api.handle("wiki.list", async () => ({
    pages: data.pages.map(pageSummary),
    sources: data.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, uri: s.uri, createdAt: s.createdAt, citations: data.citations.filter((c) => c.sourceId === s.id).length })),
    reviews: data.pages.filter((p) => p.status === "draft").map(pageSummary),
    suggestions: (data.suggestions || []).filter((s) => s.status === "pending").map(suggestionSummary),
    claimIssues: claimIssuesByPage(),
    trash: data.trash.map((t) => ({ id: t.id, kind: t.kind, title: t.title, deletedAt: t.deletedAt })),
    pins: data.pins,
    recents: data.recents.map((r) => ({ id: r.id, at: r.at })),
    log: data.log.slice(0, 40),
    layout: data.layout,
    vaultPath: data.vaultPath,
  }));
  ctx.api.handle("wiki.getPage", async ({ id: pageId }) => pageView(data.pages.find((p) => p.id === pageId || p.slug === pageId)));
  ctx.api.handle("wiki.pin", async ({ id: pageId, pinned } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    const has = data.pins.includes(page.id);
    const next = typeof pinned === "boolean" ? pinned : !has;
    data.pins = next ? [...new Set([page.id, ...data.pins])] : data.pins.filter((id) => id !== page.id);
    addLog("page.pin", `${page.title} ${next ? "pin" : "unpin"}`);
    await persist();
    return data.pins;
  });
  ctx.api.handle("wiki.touch", async ({ id: pageId } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) return [];
    data.recents = [{ id: page.id, at: now() }, ...data.recents.filter((r) => r.id !== page.id)].slice(0, 20);
    await persist();
    return data.recents;
  });
  /** 本地检索式问答：不把整库上传；答案只从页面原文抽句，并强制带页面引用。 */
  /** 导出为项目下的 Markdown 目录（wiki-export/），保留页面正文与引用列表。 */
  ctx.api.handle("wiki.exportMarkdown", async () => {
    const dir = "wiki-export";
    let count = 0;
    const errors = [];
    for (const page of data.pages) {
      const cites = citationsOf(page.id).map((c) => `- ${c.source?.title || c.sourceId}${c.quote ? `：${c.quote}` : ""}`).join("\n");
      const body = `${page.content || ""}\n\n${cites ? `## 引用\n\n${cites}\n` : ""}`;
      const name = `${page.slug || slugify(page.title)}.md`;
      try {
        await ctx.fs.writeProjectFile(`${dir}/${name}`, body);
        count += 1;
      } catch (err) { errors.push(`${name}: ${String(err?.message || err)}`); }
    }
    addLog("wiki.export", `${count} pages → ${dir}`);
    return { dir, count, errors: errors.slice(0, 5) };
  });
  ctx.api.handle("wiki.ask", async ({ question, limit = 3 } = {}) => {
    const q = String(question || "").trim();
    if (!q) throw new Error("问题不能为空");
    const chars = [...q.replace(/\s+/g, "")];
    const scoreSentence = (sentence) => {
      const text = String(sentence || "").toLowerCase();
      let hit = 0;
      for (const ch of chars) if (text.includes(ch.toLowerCase())) hit += 1;
      return chars.length ? hit / chars.length : 0;
    };
    loadSearchSync();
    const textById = new Map((searchCache || []).filter((x) => x.kind === "page").map((x) => [x.id, x.text]));
    const ranked = data.pages.map((page) => {
      const search = searchScore(textById.get(page.id) || `${page.title}\n${page.summary}`, q);
      const sentences = String(textById.get(page.id) || "")
        .replace(/```[\s\S]*?```/g, " ")
        .split(/(?<=[。！？.!?])\s+|\n+/)
        .map((x) => x.replace(/^#+\s*/, "").trim())
        .filter((x) => x.length > 8);
      const picked = sentences.map((text) => ({ text, s: scoreSentence(text) })).filter((x) => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, 2);
      return { page, score: (search?.score || 0) + picked.reduce((n, x) => n + x.s * 4, 0), picked };
    }).filter((x) => x.picked.length > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    if (!ranked.length) {
      return { found: false, answer: "Wiki 里没有找到能回答这个问题的页面或资料。", citations: [] };
    }
    const lines = ranked.map(({ page, picked }) => `- ${picked.map((x) => x.text).join(" ")} [[${page.title}]]`);
    return {
      found: true,
      answer: `根据 Wiki 页面：\n\n${lines.join("\n")}`,
      citations: ranked.map(({ page }) => ({ id: page.id, title: page.title })),
    };
  });
  ctx.api.handle("wiki.unlinked", async ({ id: pageId } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    return page ? unlinkedMentionsOf(page) : [];
  });
  ctx.api.handle("wiki.byTag", async ({ tag } = {}) => {
    const key = String(tag || "").replace(/^#/, "").toLowerCase();
    if (!key) return [];
    loadSearchSync();
    const out = [];
    for (const entry of (searchCache || []).filter((x) => x.kind === "page")) {
      const hit = String(entry.text || "").match(new RegExp(`(^|[\\s（(])#${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s，。；,.;)]|$)`, "iu"));
      if (!hit) continue;
      const page = data.pages.find((p) => p.id === entry.id);
      if (page) out.push(pageSummary(page));
    }
    return out;
  });
  ctx.api.handle("wiki.createPage", async ({ title, summary = "" } = {}) => { const page = ensurePage({ title, summary }); await persist(); return pageView(page); });
  ctx.api.handle("wiki.savePage", async ({ id: pageId, content, title, summary, status, source = "human" } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    const prevContent = String(page.content || "");
    if (typeof title === "string" && title.trim()) page.title = title.trim().slice(0, 180);
    if (typeof summary === "string") page.summary = summary.slice(0, 2000);
    if (typeof content === "string") page.content = content;
    // 只有人保存才记「人工结论」；Agent / 系统写入不产生结论，也不能靠保存洗掉它们
    // 只给「已有页面的人工修改」记结论：新建页面的正文本来就还是草稿，不需要保护
    if (source === "human" && prevContent.trim() && page.content !== prevContent) recordHumanClaims(page, prevContent, page.content);
    // stale 是「来源变了/资料被删」的标记，允许由调用方写入；其余未知值一律回到 draft，
    // 避免绕过审核流直接把页面标成 reviewed。
    page.status = status === "reviewed" ? "reviewed" : status === "stale" ? "stale" : "draft";
    page.updatedAt = now();
    if (page.status === "reviewed") page.reviewedAt = now();
    pageRevision(page, "edit");
    updateSearchEntry("page", page);
    addLog("page.save", page.title);
    await persist();
    return pageView(page);
  });
  ctx.api.handle("wiki.review", async ({ id: pageId, decision, feedback = "" } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    const status = decision === "accept" ? "reviewed" : "draft";
    page.status = status;
    page.reviewedAt = status === "reviewed" ? now() : null;
    page.updatedAt = now();
    data.reviews.unshift({ id: id("review"), pageId: page.id, status, feedback: String(feedback).slice(0, 4000), createdAt: now() });
    pageRevision(page, `review:${status}`);
    updateSearchEntry("page", page);
    addLog("page.review", `${page.title} → ${status}`);
    await persist();
    return pageView(page);
  });
  ctx.api.handle("wiki.deletePage", async ({ id: pageId } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    expireSuggestions((s) => s.targetId === page.id);
    // 页面进了回收站：人工结论标 orphan（不删），恢复时再逐条核对
    setClaimStatus(claimsOf(page.id).map((c) => c.id), "orphan");
    data.trash.unshift({
      id: id("trash"), kind: "page", title: page.title, deletedAt: now(),
      page: clone(page), citations: data.citations.filter((c) => c.pageId === page.id),
    });
    data.trash = data.trash.slice(0, 500);
    data.pages = data.pages.filter((p) => p.id !== page.id);
    data.citations = data.citations.filter((c) => c.pageId !== page.id);
    removeSearchEntry("page", page.id);
    addLog("page.delete", page.title);
    await persist();
    return true;
  });
  ctx.api.handle("wiki.restoreTrash", async ({ id: trashId } = {}) => {
    const entry = data.trash.find((t) => t.id === trashId);
    if (!entry) throw new Error("回收站条目不存在");
    if (entry.kind === "page" && entry.page) {
      if (!data.pages.some((p) => p.id === entry.page.id)) {
        const restored = attachPage(clone(entry.page));
        data.pages.unshift(restored);
        updateSearchEntry("page", restored);
      }
      for (const c of entry.citations || []) {
        if (!data.citations.some((x) => x.id === c.id)) data.citations.push(clone(c));
      }
      // 恢复后按当前正文重新核对结论：还在就 active，不见了就保持 orphan
      const restoredPage = data.pages.find((p) => p.id === entry.page.id);
      if (restoredPage) {
        const verdict = evaluateClaims(claimsOf(restoredPage.id), restoredPage.content);
        setClaimStatus(verdict.ok.map((c) => c.id), "active");
        setClaimStatus([...verdict.conflict, ...verdict.orphan].map((c) => c.id), "orphan");
      }
    } else if (entry.kind === "source" && entry.source) {
      if (!data.sources.some((s) => s.id === entry.source.id)) {
        const restored = attachSource(clone(entry.source));
        data.sources.unshift(restored);
        updateSearchEntry("source", restored);
      }
      for (const c of entry.citations || []) {
        if (!data.citations.some((x) => x.id === c.id)) data.citations.push(clone(c));
      }
    }
    data.trash = data.trash.filter((t) => t.id !== trashId);
    addLog("trash.restore", entry.title);
    await persist();
    return true;
  });
  ctx.api.handle("wiki.purgeTrash", async ({ id: trashId } = {}) => {
    const entries = trashId ? data.trash.filter((t) => t.id === trashId) : data.trash;
    for (const entry of entries) {
      try {
        if (entry.kind === "page" && entry.page) await fs.rm(pageFile(entry.page.id), { force: true });
        if (entry.kind === "source" && entry.source) await fs.rm(sourceFile(entry.source.id), { force: true });
      } catch { /* ignore */ }
    }
    data.trash = trashId ? data.trash.filter((t) => t.id !== trashId) : [];
    addLog("trash.purge", trashId || "all");
    await persist();
    return true;
  });
  ctx.api.handle("wiki.importSource", async ({ title, content, kind = "text", uri = "" } = {}) => {
    const text = String(content || "").trim();
    if (!text) throw new Error("source 内容为空");
    const existed = findSource({ uri, content: text });
    if (existed) {
      // 重复导入：更新标题/内容但不再新增一条，UI 据此提示「已存在」
      if (title && String(title).trim()) existed.title = String(title).trim().slice(0, 200);
      existed.content = text;
      existed.hash = hash(text);
      await persist();
      return { ...existed, deduped: true };
    }
    const source = {
      id: id("src"), title: String(title || uri || "Untitled source").slice(0, 200),
      kind: String(kind || "text"), uri: String(uri || ""), content: text,
      hash: hash(text), createdAt: now(),
    };
    attachSource(source);
    data.sources.unshift(source);
    updateSearchEntry("source", source);
    addLog("source.import", source.title);
    await persist();
    return sourceView(source, true);
  });
  ctx.api.handle("wiki.importUrl", async ({ url, title = "" } = {}) => {
    const target = String(url || "").trim();
    if (!/^https?:\/\//i.test(target)) throw new Error("只支持 http(s) URL");
    const res = await fetch(target, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const source = { id: id("src"), title: String(title || target).slice(0, 200), kind: "url", uri: target, content: text, hash: hash(text), createdAt: now() };
    attachSource(source);
    data.sources.unshift(source);
    updateSearchEntry("source", source);
    addLog("source.import", source.title);
    await persist();
    return sourceView(source, true);
  });
  ctx.api.handle("wiki.sources", async () => data.sources.map((s) => sourceView(s, true)));
  /** 删除资料：连带清掉它产生的 citation（页面保留，只是少了引用） */
  ctx.api.handle("wiki.deleteSource", async ({ id: sourceId, ids = [] } = {}) => {
    const targets = new Set([sourceId, ...(Array.isArray(ids) ? ids : [])].filter(Boolean));
    if (!targets.size) throw new Error("缺少 source id");
    const before = data.sources.length;
    const removedSources = data.sources.filter((s) => targets.has(s.id));
    for (const source of removedSources) {
      data.trash.unshift({
        id: id("trash"), kind: "source", title: source.title, deletedAt: now(),
        source: clone(source), citations: data.citations.filter((c) => c.sourceId === source.id),
      });
    }
    data.trash = data.trash.slice(0, 500);
    for (const id of targets) removeSearchEntry("source", id);
    data.sources = data.sources.filter((s) => !targets.has(s.id));
    const removedCitations = data.citations.filter((c) => targets.has(c.sourceId)).length;
    data.citations = data.citations.filter((c) => !targets.has(c.sourceId));
    const removed = before - data.sources.length;
    if (removed) { addLog("source.delete", `${removed} sources`); await persist(); }
    return { removed, removedCitations };
  });

  ctx.api.handle("wiki.vault.get", async () => vaultIndex());
  ctx.api.handle("wiki.vault.pick", async () => pickVault());
  ctx.api.handle("wiki.vault.open", async ({ path: openPath } = {}) => {
    if (!openPath) throw new Error("目录路径不能为空");
    data.vaultPath = path.resolve(String(openPath));
    vaultCache = null;
    addLog("vault.open", data.vaultPath);
    await persist();
    return vaultIndex(true);
  });
  ctx.api.handle("wiki.vault.file", async ({ path: relPath } = {}) => readVaultFile(relPath));
  ctx.api.handle("wiki.vault.save", async ({ path: relPath, content = "", mtime } = {}) => {
    const { full } = withinVault(relPath);
    if (!/\.md$/i.test(full)) throw new Error("只支持 Markdown 文件");
    if (mtime != null) {
      try {
        const current = await fs.stat(full);
        if (Math.abs(current.mtimeMs - Number(mtime)) > 1.5) throw new Error("文件已被外部修改；请重新打开后再保存");
      } catch (err) {
        if (String(err?.message || err).includes("外部修改")) throw err;
      }
    }
    await fs.writeFile(full, String(content ?? ""), "utf8");
    vaultCache = null;
    addLog("vault.save", vaultRel(full));
    await persist();
    return readVaultFile(vaultRel(full));
  });
  ctx.api.handle("wiki.vault.reveal", async ({ path: relPath } = {}) => {
    const { full } = withinVault(relPath);
    await ctx.fs.reveal(full);
    return true;
  });
  ctx.api.handle("wiki.vault.importSource", async ({ path: relPath } = {}) => {
    const file = await readVaultFile(relPath);
    const existed = findSource({ uri: file.path, content: file.content });
    if (existed) return { ...existed, deduped: true };
    const source = {
      id: id("src"), title: file.title, kind: "local", uri: file.path,
      content: file.content, hash: hash(file.content), createdAt: now(),
    };
    attachSource(source);
    data.sources.unshift(source);
    updateSearchEntry("source", source);
    addLog("source.import", `${file.title} · ${file.path}`);
    await persist();
    return sourceView(source, true);
  });
  ctx.api.handle("wiki.upsertDraft", async ({ title, content = "", summary = "", sourceIds = [] } = {}) => {
    const safeTitle = String(title || "").trim().slice(0, 180);
    if (!safeTitle) throw new Error("title is required");
    let page = data.pages.find((p) => p.title.toLowerCase() === safeTitle.toLowerCase() || p.slug === slugify(safeTitle));
    if (!page) page = ensurePage({ title: safeTitle, summary, content });
    // Agent / 模型只能写 draft：reviewed 页面的改动必须走「审核」（退回成 draft 或变成建议），
    // 不能靠改一次正文顺手把 reviewed 降级 —— 那是静默覆盖。
    if (page.status === "reviewed") {
      throw new Error(`「${page.title}」已审核，Agent 不能直接改写；先在页面里退回草稿，或把改动做成待审建议`);
    }
    page.content = String(content || page.content);
    page.summary = String(summary || page.summary || "");
    page.status = "draft";
    page.updatedAt = now();
    for (const sourceId of Array.isArray(sourceIds) ? sourceIds : []) {
      if (!data.sources.some((s) => s.id === sourceId)) continue;
      if (!data.citations.some((c) => c.pageId === page.id && c.sourceId === sourceId)) data.citations.push({ id: id("cite"), pageId: page.id, sourceId, quote: "", locator: "", createdAt: now() });
    }
    pageRevision(page, "agent.draft");
    updateSearchEntry("page", page);
    addLog("page.draft", page.title);
    await persist();
    return pageView(page);
  });
  ctx.api.handle("wiki.addCitation", async ({ pageId, sourceId, quote = "", locator = "" } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId || p.title.toLowerCase() === String(pageId || "").toLowerCase());
    const source = data.sources.find((s) => s.id === sourceId || s.title.toLowerCase() === String(sourceId || "").toLowerCase());
    if (!page || !source) throw new Error("page/source not found");
    const existing = data.citations.find((c) => c.pageId === page.id && c.sourceId === sourceId);
    if (!existing) data.citations.push({ id: id("cite"), pageId: page.id, sourceId, quote: String(quote).slice(0, 1000), locator: String(locator).slice(0, 200), createdAt: now() });
    page.updatedAt = now();
    await persist();
    return pageView(page);
  });
  ctx.api.handle("wiki.reviewQueue", async () => data.pages.filter((p) => p.status === "draft").map(pageSummary));
  ctx.api.handle("wiki.search", async ({ query, limit = 40 } = {}) => searchAll(query, limit));
  ctx.api.handle("wiki.tags", async () => allTags());
  /**
   * 自动整理 Wiki：统一大纲 + 补「相关」链接 + 重建索引页（确定性，不需要模型）。
   *
   * 硬规则：**只有 draft 允许被整理直接改写。**
   * reviewed / stale 的页面一律只产「待审建议」，人点头才写 —— 整理做错比不做更糟。
   * 计算部分在 ./curate-structure.mjs（纯函数，自检见 scripts/wiki-curate-selftest.mjs）。
   */
  const curateWiki = async ({ dryRun = false } = {}) => {
    const indexPage = data.pages.find((p) => p.title === INDEX_TITLE) || null;
    const plan = planCurate({ pages: data.pages, citations: data.citations, sources: data.sources, claims: data.claims || [], index: indexPage });

    if (dryRun) {
      return {
        dryRun: true,
        wouldUpdate: plan.stats.writable,
        wouldSuggest: plan.stats.reviewOnly,
        blockedByClaims: plan.stats.blockedByClaims,
        renames: plan.renames.map(({ from, to }) => ({ from, to })),
        skippedRenames: plan.skippedRenames.length,
        pages: plan.stats.pages,
        sources: plan.stats.sources,
        hasIndex: Boolean(indexPage),
      };
    }

    // 1) 改名：计划里只包含 draft 页面（reviewed / stale 改名要人点头）
    for (const r of plan.renames) {
      const page = data.pages.find((p) => p.id === r.pageId);
      if (!page) continue;
      page.title = r.to;
      page.slug = slugify(r.to);
      page.updatedAt = now();
    }

    // 2) 直接写：只有 draft 会进这里
    const updated = [];
    for (const change of plan.changes) {
      if (!change.apply) continue;
      const page = data.pages.find((p) => p.id === change.pageId);
      if (!page) continue;
      page.content = change.after;
      page.updatedAt = now();
      // 之前这里没有任何历史：结构整理改坏了只能靠备份。现在每次整理都留一条 revision。
      pageRevision(page, "curate:structure");
      updateSearchEntry("page", page);
      setClaimStatus(change.claimStatus.ok, "active");
      updated.push(page.id);
    }

    // 3) 建议：reviewed / stale / 会动到人工结论的页面一律不落盘
    let suggested = 0;
    let blockedByClaims = 0;
    for (const change of plan.changes) {
      if (change.apply) continue;
      const page = data.pages.find((p) => p.id === change.pageId);
      if (!page) continue;
      // 冲突 / 丢失的人工结论先标出来，页面上能直接看到「哪一句被动了」
      setClaimStatus(change.claimStatus?.conflict, "conflict");
      setClaimStatus(change.claimStatus?.orphan, "orphan");
      if (change.blockedByClaims) blockedByClaims += 1;
      if (upsertStructureSuggestion(page, change)) suggested += 1;
    }

    // 4) 索引页（同样受「reviewed 不静默改写」约束）
    let createdIndex = false;
    const idx = plan.index;
    if (idx && idx.after !== idx.before) {
      const existing = data.pages.find((p) => p.title === INDEX_TITLE);
      if (!idx.exists) {
        ensurePage({ title: INDEX_TITLE, summary: "Wiki 索引（自动维护）", content: idx.after });
        createdIndex = true;
      } else if (existing && idx.apply) {
        existing.content = idx.after;
        existing.updatedAt = now();
        pageRevision(existing, "curate:index");
        updateSearchEntry("page", existing);
      } else if (existing && upsertStructureSuggestion(existing, { ...idx, pageId: existing.id, title: existing.title, status: existing.status })) {
        suggested += 1;
      }
    }

    addLog("wiki.curate", `updated ${updated.length} pages, suggested ${suggested}${createdIndex ? " + index" : ""}`);
    await persist();
    return {
      updated: updated.length,
      renamed: plan.renames.length,
      renames: plan.renames.map(({ from, to }) => ({ from, to })),
      // 这些页面名本该改但状态不允许（reviewed / stale），留给后续的「改名建议」
      skippedRenames: plan.skippedRenames.length,
      suggested,
      // 这些页面的自动整理被人工结论拦下了：改成了待审建议，人看过 diff 才写
      blockedByClaims,
      createdIndex,
      pages: plan.stats.pages,
      sources: plan.stats.sources,
    };
  };
  ctx.api.handle("wiki.curate", (args) => curateWiki(args));
  ctx.api.handle("wiki.suggestions", async ({ status = "pending", pageId = "" } = {}) => (data.suggestions || [])
    .filter((s) => (!status || s.status === status) && (!pageId || s.targetId === pageId))
    .map(suggestionSummary));
  /**
   * 维护扫描：漏引用 + 疑似重复。只产建议，不碰正文。
   * 确定性判定（bigram 重叠 / 标题 Jaccard），同一份库扫两遍结果一致。
   */
  ctx.api.handle("wiki.maintain", async ({ dryRun = false } = {}) => {
    const citationCandidates = findCitationCandidates({
      pages: data.pages, sources: data.sources, citations: data.citations, max: 20,
    });
    const mergeCandidates = findMergeCandidates({ pages: data.pages, max: 10 });
    if (dryRun) return { citations: citationCandidates.length, merges: mergeCandidates.length, added: 0 };
    let added = 0;
    for (const candidate of citationCandidates) {
      const page = data.pages.find((p) => p.id === candidate.pageId);
      const source = data.sources.find((s) => s.id === candidate.sourceId);
      if (!page || !source) continue;
      const queued = enqueueSuggestion({
        kind: "citation",
        targetId: page.id,
        title: page.title,
        payload: JSON.stringify({ op: "addCitation", sourceId: source.id, quote: candidate.quote.slice(0, 1000), locator: "" }),
        baseHash: hash(String(page.content || "")),
        evidence: [
          { kind: "source", id: source.id, quote: String(candidate.quote).slice(0, 300) },
          { kind: "page", id: page.id, quote: String(candidate.claim).slice(0, 300) },
        ],
        confidence: candidate.score >= 0.8 ? "high" : "medium",
        sig: `citation:${page.id}:${source.id}`,
      });
      if (queued) added += 1;
    }
    for (const candidate of mergeCandidates) {
      const a = data.pages.find((p) => p.id === candidate.aId);
      const b = data.pages.find((p) => p.id === candidate.bId);
      if (!a || !b) continue;
      const queued = enqueueSuggestion({
        kind: "merge",
        targetId: a.id,
        title: `${a.title} / ${b.title}`,
        payload: JSON.stringify({
          op: "mergeDraft",
          title: `${a.title}（合并稿）`,
          content: buildMergedDraft({ a, b }),
          pages: [a.id, b.id],
        }),
        evidence: [
          { kind: "page", id: a.id, quote: a.title },
          { kind: "page", id: b.id, quote: b.title },
          { kind: "rule", id: "merge.similarity", quote: candidate.why },
        ],
        confidence: candidate.score >= 0.85 ? "high" : "medium",
        sig: `merge:${[a.id, b.id].sort().join(":")}`,
      });
      if (queued) added += 1;
    }
    addLog("wiki.maintain", `citations=${citationCandidates.length} merges=${mergeCandidates.length} added=${added}`);
    await persist();
    return { citations: citationCandidates.length, merges: mergeCandidates.length, added };
  });
  /**
   * 模型整理（摘要 + 要点）也只产建议：payload 是模型拼好的整段正文，
   * 人看过逐行 diff 才写。以前它直接写 draft —— 等于让模型输出成为页面字节。
   */
  ctx.api.handle("wiki.suggestSummary", async ({ pageId, content = "", evidence = [], confidence = "medium" } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    const payload = String(content || "");
    if (!payload) throw new Error("content is required");
    const sig = `summary:${page.id}:${hash(payload).slice(0, 16)}`;
    for (const old of data.suggestions || []) {
      if (old.kind === "summary" && old.targetId === page.id && old.status === "pending" && old.sig !== sig) old.status = "superseded";
    }
    const queued = enqueueSuggestion({
      kind: "summary",
      targetId: page.id,
      title: page.title,
      payload,
      baseHash: hash(String(page.content || "")),
      confidence,
      evidence: evidence.length ? evidence : [{ kind: "rule", id: "curate.llm", quote: "模型重写摘要与要点（逐行 diff 核对）" }],
      sig,
    });
    await persist();
    return { queued, sig };
  });
  // 单条带正文：渲染进程要用它算逐行 diff（列表接口不带 payload，避免一次拉几十份正文）
  ctx.api.handle("wiki.suggestion", async ({ id: sugId } = {}) => {
    const sug = (data.suggestions || []).find((s) => s.id === sugId);
    if (!sug) throw new Error("suggestion not found");
    return { ...suggestionSummary(sug), payload: sug.payload || "", baseHash: sug.baseHash || "" };
  });
  // ── 人工结论（claim）───────────────────────────────────────────────
  ctx.api.handle("wiki.claims", async ({ pageId = "", status = "" } = {}) => (data.claims || [])
    .filter((c) => c.status !== "removed" && (!pageId || c.pageId === pageId) && (!status || c.status === status))
    .map(claimView));
  /** 结论待确认：整理判定它们对不上，但人还没处理（审核 tab 要能一眼看到） */
  ctx.api.handle("wiki.claimIssues", async () => claimIssuesByPage());
  /** 显式锁一句：人选中一段点「锁定」，后续整理必须原样保留 */
  ctx.api.handle("wiki.claimAdd", async ({ pageId, quote = "" } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    const text = normalizeClaim(quote);
    if (!page) throw new Error("page not found");
    if (text.length < 4) throw new Error("要锁定的内容太短");
    const existing = claimsOf(page.id).find((c) => normalizeClaim(c.quote) === text);
    if (existing) return claimView(existing);
    const claim = { id: id("claim"), pageId: page.id, quote: text.slice(0, 300), kind: "explicit", provenance: { by: "human", at: now() }, status: "active", checkedAt: null };
    data.claims.push(claim);
    addLog("claim.add", `${page.title}：${claim.quote.slice(0, 60)}`);
    await persist();
    return claimView(claim);
  });
  ctx.api.handle("wiki.claimRemove", async ({ id: claimId } = {}) => {
    const claim = (data.claims || []).find((c) => c.id === claimId);
    if (!claim) throw new Error("claim not found");
    claim.status = "removed";
    claim.checkedAt = now();
    await persist();
    return true;
  });
  /**
   * 拿一段「拟写入的正文」校验人工结论还在不在。
   * 模型整理（wikiCurateLLM）在落盘前必须过这一关：会覆盖人写结论的页面直接跳过。
   */
  ctx.api.handle("wiki.claimCheck", async ({ pageId, content } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    const res = evaluateClaims(claimsOf(page.id), typeof content === "string" ? content : page.content);
    return {
      total: res.ok.length + res.conflict.length + res.orphan.length,
      ok: res.ok.length,
      conflict: res.conflict.map((c) => ({ id: c.id, quote: c.quote })),
      orphan: res.orphan.map((c) => ({ id: c.id, quote: c.quote })),
    };
  });
  /**
   * 对待审建议做决定。
   * - 接受 = 把建议里那串字节原样写入（不重新调模型、不重新生成）；
   * - 页面在这一版建议之后被改过 → 标 needs_rebase，不自动合并；
   * - 拒绝也留痕（feedback），后续同类建议可以据此节流。
   */
  ctx.api.handle("wiki.suggestionResolve", async ({ id: sugId, decision = "accept", feedback = "" } = {}) => {
    const sug = (data.suggestions || []).find((s) => s.id === sugId);
    if (!sug) throw new Error("suggestion not found");
    if (sug.status !== "pending") return suggestionSummary(sug);
    const page = data.pages.find((p) => p.id === sug.targetId);
    if (!page) {
      sug.status = "expired";
      sug.decidedAt = now();
      await persist();
      return suggestionSummary(sug);
    }
    if (decision !== "accept") {
      sug.status = "rejected";
      sug.feedback = String(feedback).slice(0, 2000);
      sug.decidedAt = now();
      addLog("suggestion.reject", `${page.title}${sug.feedback ? `：${sug.feedback.slice(0, 80)}` : ""}`);
      await persist();
      return suggestionSummary(sug);
    }
    let createdPageId = "";
    if (sug.kind === "citation") {
      // 加引用不改正文：只补 metadata，仍然留 revision
      let spec = {};
      try { spec = JSON.parse(sug.payload || "{}"); } catch { spec = {}; }
      const source = data.sources.find((s) => s.id === spec.sourceId);
      if (!source) {
        sug.status = "expired";
        sug.decidedAt = now();
        await persist();
        return suggestionSummary(sug);
      }
      if (!data.citations.some((c) => c.pageId === page.id && c.sourceId === source.id)) {
        data.citations.push({ id: id("cite"), pageId: page.id, sourceId: source.id, quote: String(spec.quote || "").slice(0, 1000), locator: String(spec.locator || "").slice(0, 200), createdAt: now() });
      }
      page.updatedAt = now();
      pageRevision(page, `suggest:${sug.id}`);
      updateSearchEntry("page", page);
    } else if (sug.kind === "merge") {
      // 合并只生成草稿：原页面一个字都不动，删不删由人决定
      let spec = {};
      try { spec = JSON.parse(sug.payload || "{}"); } catch { spec = {}; }
      const title = String(spec.title || "").trim().slice(0, 180);
      const content = String(spec.content || "");
      if (!title || !content) {
        sug.status = "rejected";
        sug.feedback = "合并建议内容不完整";
        sug.decidedAt = now();
        await persist();
        return suggestionSummary(sug);
      }
      const existing = data.pages.find((p) => p.title === title);
      if (!existing) {
        const created = ensurePage({ title, summary: `合并自「${sug.title}」`, content });
        createdPageId = created.id;
        // 合并稿接手两边的人工结论 —— 否则人删掉原页面后，那些「人改过的句子」就没人守了
        const pair = Array.isArray(spec.pages) && spec.pages.length ? spec.pages.map(String) : [page.id];
        const carried = carryClaimsTo(created.id, pair, content);
        if (carried) addLog("claim.carry", `${title}：${carried} 条`);
      }
    } else {
      if (hash(String(page.content || "")) !== sug.baseHash) {
        sug.status = "needs_rebase";
        sug.decidedAt = now();
        addLog("suggestion.rebase", `${page.title}（建议已过期，需重新整理）`);
        await persist();
        return suggestionSummary(sug);
      }
      page.content = String(sug.payload || "");
      page.updatedAt = now();
      pageRevision(page, `suggest:${sug.id}`);
      updateSearchEntry("page", page);
    }
    sug.status = "accepted";
    sug.decidedAt = now();
    addLog("suggestion.accept", `${sug.kind} ${page.title}${createdPageId ? " → 生成合并草稿" : ""}`);
    await persist();
    return { ...suggestionSummary(sug), createdPageId };
  });

  ctx.api.handle("wiki.memory", async ({ maxChars = 12000 } = {}) => memoryMarkdown(Number(maxChars) || 12000));
  // @deprecated 记忆维护统一走 electron/memory 的 Dream（记忆页）。这里仅为兼容旧调用保留。
  ctx.api.handle("wiki.dream", async ({ dryRun = true } = {}) => {
    // @deprecated 只是 wiki.maintain 的兼容壳：不再单独维护第二套检查，
    // 默认 dry-run（只报数，不写队列）；要真的入队请调 wiki.maintain。
    const citations = findCitationCandidates({ pages: data.pages, sources: data.sources, citations: data.citations, max: 20 });
    const merges = findMergeCandidates({ pages: data.pages, max: 10 });
    const issues = [
      ...citations.map((c) => ({ kind: "missing-citation", pageId: c.pageId, title: c.pageTitle, sourceId: c.sourceId })),
      ...merges.map((m) => ({ kind: "duplicate-page", pageId: m.aId, title: m.aTitle, other: m.bTitle })),
    ];
    if (!dryRun) {
      for (const c of citations) {
        const page = data.pages.find((p) => p.id === c.pageId);
        const source = data.sources.find((x) => x.id === c.sourceId);
        if (!page || !source) continue;
        enqueueSuggestion({
          kind: "citation",
          targetId: page.id,
          title: page.title,
          payload: JSON.stringify({ op: "addCitation", sourceId: source.id, quote: c.quote.slice(0, 1000), locator: "" }),
          baseHash: hash(String(page.content || "")),
          evidence: [
            { kind: "source", id: source.id, quote: String(c.quote).slice(0, 300) },
            { kind: "page", id: page.id, quote: String(c.claim).slice(0, 300) },
          ],
          confidence: c.score >= 0.8 ? "high" : "medium",
          sig: `citation:${page.id}:${source.id}`,
        });
      }
      await persist();
    }
    return { issues, dryRun: Boolean(dryRun), memory: memoryMarkdown() };
  });
  /**
   * 生成 Wiki 草稿骨架：每份还没有页面的 source 生成一个 draft，并建立 citation。
   * 不依赖模型；生成后可在页面里编辑/审核，或发送到 Chat 让 Agent 精修。
   */
  ctx.api.handle("wiki.generate", async ({ sourceIds = [], limit = 20 } = {}) => {
    const wanted = Array.isArray(sourceIds) && sourceIds.length
      ? data.sources.filter((s) => sourceIds.includes(s.id))
      : data.sources;
    const created = [];
    for (const source of wanted.slice(0, Math.max(1, Number(limit) || 20))) {
      const rawTitle = String(source.title || "Untitled source").replace(/\.[a-z0-9]+$/i, "").trim() || "Untitled source";
      // 优先用资料正文里的一级标题（文件名往往只是 doc-import / table-import 这种弱标题）
      const bodyH1 = (String(source.content || "").match(/^#\s+(.+)$/m) || [])[1]?.trim();
      const pretty = rawTitle.replace(/[._\-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
      const title = bodyH1 && bodyH1.length >= 2 && bodyH1.length <= 60 && !/^untitled/i.test(bodyH1)
        ? bodyH1
        : (/^[a-z0-9._\-]+$/i.test(rawTitle) ? pretty : rawTitle);
      const exists = data.pages.find((p) => p.title.toLowerCase() === title.toLowerCase() || p.slug === slugify(title));
      if (exists) continue;
      const body = String(source.content || "").replace(/\r/g, "").trim();
      const firstPara = body.split(/\n{2,}/).find((x) => x.trim()) || "";
      const summary = firstPara.replace(/^#+\s*/, "").replace(/\s+/g, " ").slice(0, 240);
      const excerpt = body.slice(0, 1200);
      const page = ensurePage({
        title,
        summary,
        content: [
          `# ${title}`,
          "",
          summary ? `> ${summary}` : "",
          "",
          "## 要点",
          "",
          "- 待整理",
          "",
          "## 原文摘录",
          "",
          excerpt || "（source 没有正文）",
          "",
          `来源：[[${title}]]`,
        ].filter(Boolean).join("\n"),
        sourceIds: [source.id],
      });
      if (summary) data.citations.push({ id: id("cite"), pageId: page.id, sourceId: source.id, quote: summary.slice(0, 200), locator: "概要", createdAt: now() });
      created.push(pageSummary(page));
    }
    if (created.length) { addLog("wiki.generate", `${created.length} pages`); await persist(); }
    return { created: created.length, pages: created, totalSources: data.sources.length };
  });
  ctx.api.handle("wiki.graph", async () => graphView());
  ctx.api.handle("wiki.layout.set", async ({ layout } = {}) => { data.layout = layout || null; await persist(); return true; });
  ctx.api.handle("wiki.layout.get", async () => data.layout);
  ctx.api.handle("wiki.log", async () => data.log.slice(0, 100));
  ctx.api.handle("wiki.source", async ({ id: sourceId } = {}) => sourceView(data.sources.find((s) => s.id === sourceId), true));
  ctx.api.handle("wiki.createTask", async ({ id: pageId, title = "" } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    const todo = await ctx.todos.create({ title: String(title || page.title).slice(0, 160), desc: (page.summary || page.content || "").slice(0, 4000), tags: ["wiki"] });
    await ctx.links.attach(todo.id, { kind: "wiki", ref: page.id, title: page.title });
    return todo;
  });
  ctx.commands.register("wiki.open", () => command("wiki.open"));
  ctx.commands.register("wiki.new", () => command("wiki.new"));
  ctx.commands.register("wiki.graph", () => command("wiki.graph"));
  ctx.commands.register("wiki.openFolder", () => command("wiki.openFolder"));
  ctx.commands.register("wiki.curate", async () => {
    await ctx.ui.openView("notes");
    const res = await curateWiki({});
    return res;
  });
  ctx.events.on("mission.finished", async (payload) => {
    addLog("mission.finished", payload?.title || payload?.missionId || "");
    await persist();
  });
  ctx.log.info(`Wiki ready · ${data.pages.length} pages · ${data.sources.length} sources${data.vaultPath ? ` · local ${data.vaultPath}` : ""}`);
}
