/**
 * Cockpit Wiki — native LLM Wiki data store.
 *
 * Sources are imported into the app-owned wiki store; pages are generated or
 * edited as drafts, cite sources, and require human review before becoming
 * reviewed knowledge. No external Obsidian vault is required.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

let ctx;
let seq = 0;
let data = {
  version: 1,
  sources: [],
  pages: [],
  citations: [],
  revisions: [],
  reviews: [],
  log: [],
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

async function load() {
  try {
    const raw = JSON.parse(await fs.readFile(dataFile(), "utf8"));
    data = { ...data, ...raw };
    seq = Number(raw.seq) || seq;
  } catch { /* first run */ }
}

async function persist() {
  await fs.mkdir(ctx.dataDir, { recursive: true });
  const tmp = `${dataFile()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...data, seq }, null, 2), "utf8");
  await fs.rename(tmp, dataFile());
}

function addLog(kind, text) {
  data.log.unshift({ id: id("log"), kind, text: String(text).slice(0, 2000), at: now() });
  data.log = data.log.slice(0, 500);
}

function pageBySlug(slug) { return data.pages.find((p) => p.slug === slug) || data.pages.find((p) => p.id === slug) || null; }
function sourceView(source) { return source ? clone(source) : null; }

function citationsOf(pageId) {
  return data.citations.filter((c) => c.pageId === pageId).map((c) => ({ ...c, source: sourceView(data.sources.find((s) => s.id === c.sourceId)) }));
}

function backlinksOf(page) {
  return data.pages.filter((p) => p.id !== page.id && new RegExp(`\\[\\[${page.title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:\\|[^\\]]+)?\\]\\]`).test(p.content)).map((p) => ({ id: p.id, title: p.title, status: p.status }));
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
  return { id: page.id, slug: page.slug, title: page.title, summary: page.summary || "", status: page.status, confidence: page.confidence || "medium", updatedAt: page.updatedAt, citations: citationsOf(page.id).length, backlinks: backlinksOf(page).length };
}

function pageRevision(page, reason) {
  data.revisions.unshift({ id: id("rev"), pageId: page.id, content: page.content, status: page.status, reason, createdAt: now() });
  data.revisions = data.revisions.slice(0, 300);
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
  data.pages.unshift(page);
  for (const sourceId of sourceIds) if (data.sources.some((s) => s.id === sourceId)) data.citations.push({ id: id("cite"), pageId: page.id, sourceId, quote: "", locator: "", createdAt: now() });
  pageRevision(page, "create");
  addLog("page.create", page.title);
  return page;
}

function sourceText(source) {
  return `${source.title}\n${source.uri || ""}\n${source.content || ""}`;
}

function searchAll(q, limit = 40) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return [];
  const out = [];
  for (const page of data.pages) {
    const body = `${page.title}\n${page.summary}\n${page.content}`.toLowerCase();
    const at = body.indexOf(query);
    if (at >= 0) {
      const titleHit = page.title.toLowerCase().includes(query) ? 3 : 0;
      const rank = titleHit + (page.status === "reviewed" ? 2 : 0) + Math.min(3, citationsOf(page.id).length);
      out.push({ kind: "page", id: page.id, title: page.title, snippet: page.content.slice(Math.max(0, at - 60), at + 180).replace(/\s+/g, " "), rank });
    }
  }
  for (const source of data.sources) {
    const at = sourceText(source).toLowerCase().indexOf(query);
    if (at >= 0) out.push({ kind: "source", id: source.id, title: source.title, snippet: source.content.slice(Math.max(0, at - 60), at + 180).replace(/\s+/g, " ") });
  }
  return out.sort((a, b) => (b.rank || 0) - (a.rank || 0)).slice(0, limit);
}

function memoryMarkdown(maxChars = 12000) {
  const ranked = [...data.pages].sort((a, b) => {
    const score = (p) => (p.status === "reviewed" ? 20 : p.status === "stale" ? -5 : 8) + (p.citations ? 3 : 0) + (p.updatedAt || 0) / 1e13;
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
  for (const page of ranked) {
    const summary = (page.summary || page.content.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim()).slice(0, 220);
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
  for (const page of data.pages) {
    for (const m of page.content.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)) {
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

  ctx.api.handle("wiki.status", async () => ({ pages: data.pages.length, sources: data.sources.length, drafts: data.pages.filter((p) => p.status === "draft").length, stale: data.pages.filter((p) => p.status === "stale").length, vaultPath: data.vaultPath }));
  ctx.api.handle("wiki.list", async () => ({
    pages: data.pages.map(pageSummary),
    sources: data.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, uri: s.uri, createdAt: s.createdAt, citations: data.citations.filter((c) => c.sourceId === s.id).length })),
    reviews: data.pages.filter((p) => p.status === "draft").map(pageSummary),
    log: data.log.slice(0, 40),
    layout: data.layout,
    vaultPath: data.vaultPath,
  }));
  ctx.api.handle("wiki.getPage", async ({ id: pageId }) => pageView(data.pages.find((p) => p.id === pageId || p.slug === pageId)));
  ctx.api.handle("wiki.createPage", async ({ title, summary = "" } = {}) => { const page = ensurePage({ title, summary }); await persist(); return pageView(page); });
  ctx.api.handle("wiki.savePage", async ({ id: pageId, content, title, summary, status } = {}) => {
    const page = data.pages.find((p) => p.id === pageId || p.slug === pageId);
    if (!page) throw new Error("page not found");
    if (typeof title === "string" && title.trim()) page.title = title.trim().slice(0, 180);
    if (typeof summary === "string") page.summary = summary.slice(0, 2000);
    if (typeof content === "string") page.content = content;
    page.status = status === "reviewed" ? "reviewed" : "draft";
    page.updatedAt = now();
    if (page.status === "reviewed") page.reviewedAt = now();
    pageRevision(page, "edit");
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
    addLog("page.review", `${page.title} → ${status}`);
    await persist();
    return pageView(page);
  });
  ctx.api.handle("wiki.deletePage", async ({ id: pageId } = {}) => {
    data.pages = data.pages.filter((p) => p.id !== pageId);
    data.citations = data.citations.filter((c) => c.pageId !== pageId);
    addLog("page.delete", pageId);
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
    data.sources.unshift(source);
    addLog("source.import", source.title);
    await persist();
    return source;
  });
  ctx.api.handle("wiki.importUrl", async ({ url, title = "" } = {}) => {
    const target = String(url || "").trim();
    if (!/^https?:\/\//i.test(target)) throw new Error("只支持 http(s) URL");
    const res = await fetch(target, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const source = { id: id("src"), title: String(title || target).slice(0, 200), kind: "url", uri: target, content: text, hash: hash(text), createdAt: now() };
    data.sources.unshift(source);
    addLog("source.import", source.title);
    await persist();
    return source;
  });
  ctx.api.handle("wiki.sources", async () => data.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, uri: s.uri, createdAt: s.createdAt, content: s.content })));
  /** 删除资料：连带清掉它产生的 citation（页面保留，只是少了引用） */
  ctx.api.handle("wiki.deleteSource", async ({ id: sourceId, ids = [] } = {}) => {
    const targets = new Set([sourceId, ...(Array.isArray(ids) ? ids : [])].filter(Boolean));
    if (!targets.size) throw new Error("缺少 source id");
    const before = data.sources.length;
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
    data.sources.unshift(source);
    addLog("source.import", `${file.title} · ${file.path}`);
    await persist();
    return source;
  });
  ctx.api.handle("wiki.upsertDraft", async ({ title, content = "", summary = "", sourceIds = [] } = {}) => {
    const safeTitle = String(title || "").trim().slice(0, 180);
    if (!safeTitle) throw new Error("title is required");
    let page = data.pages.find((p) => p.title.toLowerCase() === safeTitle.toLowerCase() || p.slug === slugify(safeTitle));
    if (!page) page = ensurePage({ title: safeTitle, summary, content });
    page.content = String(content || page.content);
    page.summary = String(summary || page.summary || "");
    page.status = "draft";
    page.updatedAt = now();
    for (const sourceId of Array.isArray(sourceIds) ? sourceIds : []) {
      if (!data.sources.some((s) => s.id === sourceId)) continue;
      if (!data.citations.some((c) => c.pageId === page.id && c.sourceId === sourceId)) data.citations.push({ id: id("cite"), pageId: page.id, sourceId, quote: "", locator: "", createdAt: now() });
    }
    pageRevision(page, "agent.draft");
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
  /**
   * 自动整理 Wiki：统一大纲 + 补「相关」链接 + 重建索引页（确定性，不需要模型）。
   * - 每个页面保证 `# 标题`、`## 要点`、`## 原文摘录`、`## 相关` 四段
   * - 引用同一份 source、或标题互相提及的页面，互相加 [[双链]]
   * - 维护一个 `Wiki 索引` 页面（按状态分组列出所有页面）
   */
  const curateWiki = async ({ dryRun = false } = {}) => {
    const INDEX_TITLE = "Wiki 索引";
    const indexPage = data.pages.find((p) => p.title === INDEX_TITLE);
    const realPages = data.pages.filter((p) => p.title !== INDEX_TITLE);

    // 1) 页面之间的关系：共享 source 或标题互现
    const related = new Map(); // pageId -> Set(pageId)
    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!related.has(a)) related.set(a, new Set());
      related.get(a).add(b);
    };
    const sourcesOf = new Map();
    for (const c of data.citations) {
      if (!sourcesOf.has(c.pageId)) sourcesOf.set(c.pageId, new Set());
      sourcesOf.get(c.pageId).add(c.sourceId);
    }
    const ids = realPages.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = sourcesOf.get(ids[i]) || new Set();
        const b = sourcesOf.get(ids[j]) || new Set();
        let shared = false;
        for (const x of a) if (b.has(x)) { shared = true; break; }
        if (shared) { link(ids[i], ids[j]); link(ids[j], ids[i]); }
      }
    }

    const updated = [];
    for (const page of realPages) {
      const title = page.title;
      const body = String(page.content || "");
      const summary = String(page.summary || "").trim();
      // 保留原有正文：剥离我们自己维护的段落，避免重复堆叠
      const stripped = body
        .replace(/^#\s+.*$/m, "")
        .replace(/##\s*要点[\s\S]*?(?=\n##\s|$)/, "")
        .replace(/##\s*原文摘录[\s\S]*?(?=\n##\s|$)/, "")
        .replace(/##\s*相关[\s\S]*$/, "")
        .trim();
      // 摘要要点：从整页正文里的列表提取（跳过「相关」里的双链，去重、限 8 条）
      const bullets = [...new Set((body.match(/^\s*[-*]\s+.+$/gm) || [])
        .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
        .filter((l) => l && !/^\[\[[^\]]+\]\]/.test(l) && l !== "待整理"))].slice(0, 8);
      // 原文摘录：把摘录里自带的一级/二级标题降级成加粗，避免和本页的 ## 段落打架
      const excerpt = stripped
        .split(/\n{2,}/)
        .slice(0, 4)
        .join("\n\n")
        .slice(0, 1200)
        .replace(/^#{1,6}\s+(.+)$/gm, "**$1**");
      const rel = [...(related.get(page.id) || [])]
        .map((id) => realPages.find((p) => p.id === id))
        .filter(Boolean)
        .slice(0, 6);

      const next = [
        `# ${title}`,
        "",
        summary ? `> ${summary}` : "",
        "",
        "## 要点",
        "",
        ...(bullets.length ? bullets.map((b) => `- ${b}`) : ["- 待补充"]),
        "",
        "## 原文摘录",
        "",
        excerpt || "（暂无摘录）",
        "",
        "## 相关",
        "",
        ...(rel.length ? rel.map((r) => `- [[${r.title}]]`) : [`- [[${INDEX_TITLE}]]`]),
        "",
      ].filter((x) => x !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

      if (next !== body) {
        page.content = next;
        page.updatedAt = now();
        updated.push(page.id);
      }
    }

    // 2) 索引页
    const groups = [
      ["已审核", realPages.filter((p) => p.status === "reviewed")],
      ["草稿", realPages.filter((p) => p.status === "draft")],
      ["已过期", realPages.filter((p) => p.status === "stale")],
    ];
    const indexBody = [
      `# ${INDEX_TITLE}`,
      "",
      `> 自动生成：${realPages.length} 个页面 · ${data.sources.length} 份资料。改页面内容不会被覆盖（只重写本索引）。`,
      "",
      ...groups.flatMap(([label, list]) => (list.length
        ? [`## ${label}（${list.length}）`, "", ...list.map((p) => `- [[${p.title}]]${p.summary ? ` — ${p.summary}` : ""}`), ""]
        : [])),
      "## 资料",
      "",
      ...(data.sources.length ? data.sources.slice(0, 50).map((s) => `- ${s.title}${s.kind ? `（${s.kind}）` : ""}`) : ["- 还没有资料"]),
      "",
    ].join("\n");

    let createdIndex = false;
    if (dryRun) {
      return { dryRun: true, wouldUpdate: updated.length, pages: realPages.length, sources: data.sources.length, hasIndex: Boolean(indexPage) };
    }
    if (!indexPage) { ensurePage({ title: INDEX_TITLE, summary: "Wiki 索引（自动维护）", content: indexBody }); createdIndex = true; }
    else if (indexPage.content !== indexBody) { indexPage.content = indexBody; indexPage.updatedAt = now(); }
    addLog("wiki.curate", `updated ${updated.length} pages${createdIndex ? " + index" : ""}`);
    await persist();
    return { updated: updated.length, createdIndex, pages: realPages.length, sources: data.sources.length };
  };
  ctx.api.handle("wiki.curate", (args) => curateWiki(args));

  ctx.api.handle("wiki.memory", async ({ maxChars = 12000 } = {}) => memoryMarkdown(Number(maxChars) || 12000));
  ctx.api.handle("wiki.dream", async () => {
    // Deterministic first pass: surface maintenance work without mutating reviewed pages.
    const issues = [];
    for (const page of data.pages) {
      if (!citationsOf(page.id).length) issues.push({ kind: "missing-citation", pageId: page.id, title: page.title });
      if (page.status === "draft" && page.updatedAt < now() - 7 * 24 * 3600 * 1000) issues.push({ kind: "stale-draft", pageId: page.id, title: page.title });
    }
    const seen = new Map();
    for (const page of data.pages) {
      const key = page.title.toLowerCase();
      if (seen.has(key)) issues.push({ kind: "duplicate-title", pageId: page.id, title: page.title });
      else seen.set(key, page.id);
    }
    return { issues, memory: memoryMarkdown() };
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
      const title = String(source.title || "Untitled source").replace(/\.[a-z0-9]+$/i, "").trim() || "Untitled source";
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
  ctx.api.handle("wiki.source", async ({ id: sourceId } = {}) => sourceView(data.sources.find((s) => s.id === sourceId)));
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
