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
};

function now() { return Date.now(); }
function id(prefix) { seq += 1; return `${prefix}${Date.now().toString(36)}${seq}`; }
function hash(text) { return crypto.createHash("sha256").update(String(text || "")).digest("hex"); }
function slugify(text) {
  return String(text || "page").toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
}
function dataFile() { return path.join(ctx.dataDir, "wiki.json"); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

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
    const at = `${page.title}\n${page.summary}\n${page.content}`.toLowerCase().indexOf(query);
    if (at >= 0) out.push({ kind: "page", id: page.id, title: page.title, snippet: page.content.slice(Math.max(0, at - 60), at + 180).replace(/\s+/g, " ") });
  }
  for (const source of data.sources) {
    const at = sourceText(source).toLowerCase().indexOf(query);
    if (at >= 0) out.push({ kind: "source", id: source.id, title: source.title, snippet: source.content.slice(Math.max(0, at - 60), at + 180).replace(/\s+/g, " ") });
  }
  return out.slice(0, limit);
}

function graphView() {
  const nodes = [
    ...data.pages.map((p) => ({ id: p.id, title: p.title, kind: "page", links: 0 })),
    ...data.sources.map((s) => ({ id: s.id, title: s.title, kind: "source", links: 0 })),
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
  throw new Error(`unknown command: ${name}`);
}

export async function activate(context) {
  ctx = context;
  await load();

  ctx.api.handle("wiki.status", async () => ({ pages: data.pages.length, sources: data.sources.length, drafts: data.pages.filter((p) => p.status === "draft").length, stale: data.pages.filter((p) => p.status === "stale").length }));
  ctx.api.handle("wiki.list", async () => ({
    pages: data.pages.map(pageSummary),
    sources: data.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, uri: s.uri, createdAt: s.createdAt, citations: data.citations.filter((c) => c.sourceId === s.id).length })),
    reviews: data.pages.filter((p) => p.status === "draft").map(pageSummary),
    log: data.log.slice(0, 40),
    layout: data.layout,
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
  ctx.events.on("mission.finished", async (payload) => {
    addLog("mission.finished", payload?.title || payload?.missionId || "");
    await persist();
  });
  ctx.log.info(`Wiki ready · ${data.pages.length} pages · ${data.sources.length} sources`);
}
