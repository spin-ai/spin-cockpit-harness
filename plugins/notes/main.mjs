/**
 * Cockpit Notes — Obsidian-like Markdown vault plugin.
 *
 * This is a first-party trusted plugin. It indexes a local vault and exposes
 * a small API to the renderer through PluginHost RPC.
 */
import fs from "node:fs/promises";
import path from "node:path";

const IGNORE_DIRS = new Set([".obsidian", ".git", ".trash", "node_modules"]);
const MAX_NOTE_BYTES = 5 * 1024 * 1024;

let ctx;
let vault = "";
let cache = null;
let scanning = null;
let watcher = null;
let watchedVault = "";
let watchTimer = null;

async function watchVault(nextVault) {
  if (nextVault === watchedVault && watcher) return;
  try { watcher?.close(); } catch { /* ignore */ }
  watcher = null;
  watchedVault = "";
  if (!nextVault) return;
  watchedVault = nextVault;
  try {
    watcher = fs.watch(nextVault, { recursive: true }, (_event, filename) => {
      if (filename && /(^|[\\/])\.obsidian/.test(String(filename))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => { cache = null; }, 350);
    });
    watcher.on?.("error", () => { try { watcher.close(); } catch { /* ignore */ } watcher = null; });
  } catch { /* watcher unsupported; manual refresh still works */ }
}

function normalizeVault(value) {
  return value ? path.resolve(String(value)) : "";
}

function posix(p) {
  return String(p).replace(/\\/g, "/");
}

function within(root, rel) {
  const full = path.resolve(root, String(rel || ""));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("路径必须位于 vault 内");
  return full;
}

function rel(root, full) {
  return posix(path.relative(root, full));
}

function baseName(p) {
  return path.basename(p, path.extname(p));
}

function simpleYaml(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    out[m[1]] = value;
  }
  return out;
}

function parseNote(relPath, raw, mtime) {
  let content = raw;
  let frontmatter = {};
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    frontmatter = simpleYaml(fm[1]);
    content = content.slice(fm[0].length);
  }
  const headings = [];
  for (const [i, line] of content.split(/\r?\n/).entries()) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) headings.push({ level: h[1].length, text: h[2].trim(), line: i + 1 });
  }
  const links = [];
  for (const m of content.matchAll(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g)) {
    links.push({ target: m[1].trim(), heading: (m[2] || "").trim(), alias: (m[3] || "").trim() });
  }
  const tags = new Set();
  for (const m of content.matchAll(/(?:^|\s)#([A-Za-z0-9_\-/]+)/g)) tags.add(m[1]);
  const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : typeof frontmatter.tags === "string" ? [frontmatter.tags] : [];
  for (const t of fmTags) tags.add(String(t).replace(/^#/, ""));
  const title = String(frontmatter.title || headings.find((h) => h.level === 1)?.text || baseName(relPath));
  const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : frontmatter.aliases ? [String(frontmatter.aliases)] : [];
  return {
    path: relPath, name: baseName(relPath), folder: posix(path.dirname(relPath) === "." ? "" : path.dirname(relPath)),
    title, content, frontmatter, headings, links, tags: [...tags], aliases, mtime,
  };
}

async function walk(root) {
  const out = [];
  async function visit(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await visit(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await visit(root);
  return out;
}

async function buildIndex(force = false) {
  const nextVault = normalizeVault(await ctx.settings.get("vaultPath"));
  if (!force && cache && cache.vault === nextVault && Date.now() - cache.updatedAt < 1500) return cache;
  if (scanning) return scanning;
  scanning = (async () => {
    const previous = cache;
    if (!nextVault) {
      cache = { vault: "", files: new Map(), backlinks: new Map(), tags: new Map(), updatedAt: Date.now(), error: null };
      vault = "";
      return cache;
    }
    try {
      const stat = await fs.stat(nextVault);
      if (!stat.isDirectory()) throw new Error("vault 不是目录");
      const paths = await walk(nextVault);
      const files = new Map();
      for (const full of paths) {
        try {
          const info = await fs.stat(full);
          if (info.size > MAX_NOTE_BYTES) continue;
          const raw = await fs.readFile(full, "utf8");
          const parsed = parseNote(rel(nextVault, full), raw, info.mtimeMs);
          files.set(parsed.path, parsed);
        } catch { /* skip unreadable */ }
      }
      const byName = new Map();
      const byPath = new Map();
      for (const file of files.values()) {
        byPath.set(file.path.toLowerCase().replace(/\.md$/, ""), file.path);
        byName.set(file.name.toLowerCase(), file.path);
        for (const alias of file.aliases) byName.set(alias.toLowerCase(), file.path);
      }
      const backlinks = new Map();
      const resolve = (target) => {
        const t = String(target || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
        return byPath.get(t) || byName.get(t) || byPath.get(t.replace(/\.md$/, "")) || null;
      };
      for (const file of files.values()) {
        file.outgoing = [];
        for (const link of file.links) {
          const target = resolve(link.target);
          file.outgoing.push({ ...link, path: target });
          if (!target) continue;
          if (!backlinks.has(target)) backlinks.set(target, []);
          backlinks.get(target).push({ path: file.path, title: file.title, heading: link.heading || "", alias: link.alias || "" });
        }
      }
      const tags = new Map();
      for (const file of files.values()) for (const tag of file.tags) {
        if (!tags.has(tag)) tags.set(tag, []);
        tags.get(tag).push(file.path);
      }
      vault = nextVault;
      cache = { vault, files, backlinks, tags, updatedAt: Date.now(), error: null, previous };
      await watchVault(vault);
      return cache;
    } catch (err) {
      cache = { vault: nextVault, files: new Map(), backlinks: new Map(), tags: new Map(), updatedAt: Date.now(), error: String(err?.message || err) };
      vault = nextVault;
      return cache;
    }
  })().finally(() => { scanning = null; });
  return scanning;
}

function listFiles(idx) {
  return [...idx.files.values()].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({
    path: f.path, name: f.name, folder: f.folder, title: f.title, mtime: f.mtime,
    tags: f.tags, headings: f.headings.length, links: f.links.length,
  }));
}

function tagsView(idx) {
  return [...idx.tags.entries()].map(([name, paths]) => ({ name, count: paths.length })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function noteView(file, idx) {
  if (!file) throw new Error("笔记不存在");
  return {
    path: file.path, name: file.name, folder: file.folder, title: file.title,
    content: file.content, frontmatter: file.frontmatter, headings: file.headings,
    tags: file.tags, outgoing: file.outgoing || [],
    backlinks: idx.backlinks.get(file.path) || [],
    mtime: file.mtime,
  };
}

async function saveFile(relPath, content, expectedMtime = null) {
  const idx = await buildIndex();
  if (!idx.vault) throw new Error("还没有选择 vault");
  const full = within(idx.vault, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  if (expectedMtime != null) {
    try {
      const st = await fs.stat(full);
      if (Math.abs(st.mtimeMs - Number(expectedMtime)) > 1.5) throw new Error("文件已被外部修改；请重新打开后再保存");
    } catch (err) {
      if (String(err?.message || err).includes("外部修改")) throw err;
    }
  }
  await fs.writeFile(full, String(content ?? ""), "utf8");
  cache = null;
  await buildIndex(true);
  return noteView(cache.files.get(posix(relPath)), cache);
}

function todayPath() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function ensureDaily() {
  const folder = String((await ctx.settings.get("dailyFolder")) || "daily").replace(/^\/+|\/+$/g, "");
  const format = String((await ctx.settings.get("dailyFormat")) || "YYYY-MM-DD");
  const date = todayPath();
  const name = format.replace("YYYY", date.slice(0, 4)).replace("MM", date.slice(5, 7)).replace("DD", date.slice(8, 10));
  const relPath = posix(folder ? `${folder}/${name}.md` : `${name}.md`);
  const idx = await buildIndex();
  const existing = idx.files.get(relPath);
  if (existing) return { ...noteView(existing, idx), created: false };
  return { ...(await saveFile(relPath, `# ${date}\n\n`)), created: true };
}

function extMd(name) {
  return /\.md$/i.test(name) ? name : `${name}.md`;
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function indexNow(force = true) {
  cache = null;
  return buildIndex(force);
}

async function command(name) {
  if (name === "notes.open") return ctx.ui.openView("notes");
  if (name === "notes.today") {
    const daily = await ensureDaily();
    await ctx.ui.openView("notes");
    return daily;
  }
  if (name === "notes.refresh") {
    await buildIndex(true);
    return { ok: true };
  }
  throw new Error(`unknown command: ${name}`);
}

export async function activate(context) {
  ctx = context;
  ctx.api.handle("notes.status", async () => {
    const idx = await buildIndex();
    return { vaultPath: idx.vault, count: idx.files.size, indexedAt: idx.updatedAt, error: idx.error };
  });
  ctx.api.handle("notes.list", async () => {
    const idx = await buildIndex();
    return { vaultPath: idx.vault, files: listFiles(idx), tags: tagsView(idx), error: idx.error };
  });
  ctx.api.handle("notes.pickVault", async () => {
    const chosen = await ctx.fs.pickDirectory({ title: "选择 Obsidian vault" });
    if (!chosen) return null;
    await ctx.settings.set("vaultPath", chosen);
    cache = null;
    await buildIndex(true);
    await watchVault(vault);
    return { vaultPath: vault, files: listFiles(cache), tags: tagsView(cache), error: cache.error };
  });
  ctx.api.handle("notes.setVault", async ({ path: vaultPath } = {}) => {
    if (!vaultPath) throw new Error("vault 路径不能为空");
    await ctx.settings.set("vaultPath", String(vaultPath));
    cache = null;
    await buildIndex(true);
    await watchVault(vault);
    return { vaultPath: vault, files: listFiles(cache), tags: tagsView(cache), error: cache.error };
  });
  ctx.api.handle("notes.read", async ({ path: relPath }) => {
    const idx = await buildIndex();
    return noteView(idx.files.get(posix(String(relPath || ""))), idx);
  });
  ctx.api.handle("notes.save", async ({ path: relPath, content, mtime }) => saveFile(String(relPath || ""), content, mtime));
  ctx.api.handle("notes.create", async ({ folder = "", name = "Untitled" } = {}) => {
    const safe = String(name || "Untitled").replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "");
    const relPath = posix(`${String(folder).replace(/^\/+|\/+$/g, "") ? `${String(folder).replace(/^\/+|\/+$/g, "")}/` : ""}${safe}.md`);
    const idx = await buildIndex();
    if (idx.files.has(relPath)) throw new Error("同名笔记已存在");
    return saveFile(relPath, `# ${safe}\n\n`);
  });
  ctx.api.handle("notes.mkdir", async ({ path: relPath = "" } = {}) => {
    const idx = await buildIndex();
    if (!idx.vault) throw new Error("还没有选择 vault");
    const folder = String(relPath || "").replace(/^[/\\]+|[/\\]+$/g, "");
    if (!folder) throw new Error("文件夹名不能为空");
    const full = within(idx.vault, folder);
    await fs.mkdir(full, { recursive: true });
    await indexNow();
    return { path: posix(path.relative(idx.vault, full)) };
  });
  ctx.api.handle("notes.rename", async ({ from, to } = {}) => {
    const idx = await buildIndex();
    if (!idx.vault) throw new Error("还没有选择 vault");
    const source = String(from || "").replace(/^[/\\]+|[/\\]+$/g, "");
    let target = String(to || "").replace(/^[/\\]+|[/\\]+$/g, "");
    if (!source || !target) throw new Error("源路径和目标路径不能为空");
    const sourceFull = within(idx.vault, source);
    if (!source.endsWith("/") && !target.includes(".")) target = extMd(target);
    const targetFull = within(idx.vault, target);
    if (await exists(targetFull)) throw new Error("目标文件已存在");
    await fs.mkdir(path.dirname(targetFull), { recursive: true });
    await fs.rename(sourceFull, targetFull);
    await indexNow();
    return { from: source, to: posix(path.relative(idx.vault, targetFull)) };
  });
  ctx.api.handle("notes.trash", async ({ path: relPath } = {}) => {
    const idx = await buildIndex();
    if (!idx.vault) throw new Error("还没有选择 vault");
    const relPathSafe = String(relPath || "").replace(/^[/\\]+|[/\\]+$/g, "");
    const full = within(idx.vault, relPathSafe);
    const trash = within(idx.vault, ".trash");
    await fs.mkdir(trash, { recursive: true });
    const target = path.join(trash, `${Date.now()}-${path.basename(full)}`);
    await fs.rename(full, target);
    await indexNow();
    return { path: relPathSafe, trashedTo: posix(path.relative(idx.vault, target)) };
  });
  ctx.api.handle("notes.reveal", async ({ path: relPath } = {}) => {
    const idx = await buildIndex();
    if (!idx.vault) throw new Error("还没有选择 vault");
    const full = within(idx.vault, String(relPath || ""));
    await ctx.fs.reveal(full);
    return true;
  });
  ctx.api.handle("notes.daily", () => ensureDaily());
  ctx.api.handle("notes.layout.get", async () => ctx.storage.get("layout"));
  ctx.api.handle("notes.layout.set", async ({ layout } = {}) => { await ctx.storage.set("layout", layout || null); return true; });
  ctx.api.handle("notes.graph", async () => {
    const idx = await buildIndex();
    const nodes = [...idx.files.values()].map((f) => ({ path: f.path, title: f.title, links: (f.outgoing || []).length }));
    const edges = [];
    for (const f of idx.files.values()) for (const o of f.outgoing || []) if (o.path) edges.push({ source: f.path, target: o.path });
    return { nodes, edges };
  });
  ctx.api.handle("notes.search", async ({ query = "" } = {}) => {
    const idx = await buildIndex();
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const file of idx.files.values()) {
      const hay = `${file.title}\n${file.path}\n${file.content}`.toLowerCase();
      const at = hay.indexOf(q);
      if (at < 0) continue;
      const start = Math.max(0, at - 60);
      out.push({ path: file.path, title: file.title, snippet: file.content.slice(start, start + 180).replace(/\s+/g, " ").trim() });
      if (out.length >= 40) break;
    }
    return out;
  });
  ctx.api.handle("notes.createTask", async ({ path: relPath, title = "", content = "" } = {}) => {
    const idx = await buildIndex();
    const file = idx.files.get(posix(String(relPath || "")));
    if (!file) throw new Error("笔记不存在");
    const todo = await ctx.todos.create({
      title: String(title || file.title).slice(0, 160),
      desc: String(content || file.content).slice(0, 4000),
      tags: ["note"],
    });
    await ctx.links.attach(todo.id, { kind: "notes", ref: file.path, title: file.title });
    return todo;
  });
  ctx.api.handle("notes.append", async ({ path: relPath, content = "" } = {}) => {
    const idx = await buildIndex();
    const file = idx.files.get(posix(String(relPath || "")));
    if (!file) throw new Error("笔记不存在");
    return saveFile(file.path, `${file.content.replace(/\s+$/, "")}\n\n${String(content)}`);
  });
  ctx.api.handle("notes.links", async ({ path: relPath } = {}) => {
    const idx = await buildIndex();
    const file = idx.files.get(posix(String(relPath || "")));
    if (!file) return { backlinks: [], outgoing: [] };
    return { backlinks: idx.backlinks.get(file.path) || [], outgoing: file.outgoing || [] };
  });
  ctx.commands.register("notes.open", () => command("notes.open"));
  ctx.commands.register("notes.today", () => command("notes.today"));
  ctx.commands.register("notes.refresh", () => command("notes.refresh"));
  ctx.events.on("mission.finished", async (payload) => {
    const daily = await ensureDaily();
    const line = `- DONE Mission: ${payload?.title || payload?.missionId || ""}${payload?.summary ? `\n  - ${String(payload.summary).slice(0, 1000)}` : ""}`;
    await saveFile(daily.path, `${daily.content.replace(/\s+$/, "")}\n\n${line}\n`);
  });
  ctx.log.info(`Notes ready${vault ? ` · ${vault}` : " · no vault"}`);
  if (vault) await buildIndex().then(() => watchVault(vault)).catch((err) => ctx.log.warn(`index: ${String(err?.message || err)}`));
}
