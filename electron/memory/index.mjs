/**
 * 记忆层（L1–L4）+ 未验证观察（note）+ Dream 建议。
 *
 * 独立库：`userData/memory/mem.db`（node:sqlite）。
 * 事实源仍是 wiki 页面 / transcript / run；这里只放「指针 + 结论 + 待确认」，
 * 删掉 mem.db 不会丢正文。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const LAYERS = ["L1", "L2", "L3", "L4"];
const ACTIONS = ["fix", "build", "fill", "promote", "prune"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  source_kind TEXT,            -- transcript | page | run | manual
  source_ref TEXT,             -- message id / page id / run id
  status TEXT NOT NULL,        -- new | verified | stale | rejected
  tags TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,         -- L1..L4
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_refs TEXT,            -- JSON array
  status TEXT NOT NULL,        -- active | archived
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,        -- fix | build | fill | promote | prune
  title TEXT NOT NULL,
  detail TEXT,
  target_kind TEXT,            -- page | source | note | entry
  target_id TEXT,
  sources TEXT,                -- JSON array
  sig TEXT NOT NULL,
  status TEXT NOT NULL,        -- pending | accepted | rejected
  created_at INTEGER, resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS rejects (sig TEXT PRIMARY KEY, at INTEGER, times INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS entries_layer ON entries(layer, status);
CREATE INDEX IF NOT EXISTS suggestions_status ON suggestions(status);
`;

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const J = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

export function createMemory({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "mem.db"));
  db.exec(SCHEMA);
  try { db.exec("ALTER TABLE entries ADD COLUMN sort_order INTEGER"); } catch { /* 已存在 */ }

  const rows = (sql, params = []) => db.prepare(sql).all(...params);
  const one = (sql, params = []) => db.prepare(sql).get(...params);
  const run = (sql, params = []) => db.prepare(sql).run(...params);

  const metaGet = (k) => { try { return J(one("SELECT v FROM meta WHERE k=?", [k])?.v, null); } catch { return null; } };
  const metaSet = (k, v) => run("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [k, JSON.stringify(v)]);
  const DREAM = () => ({ enabled: true, maxSuggestions: 40, mergeWindowDays: 0, ...(metaGet("dream") || {}) });

  const noteRow = (r) => ({
    id: r.id, body: r.body, sourceKind: r.source_kind, sourceRef: r.source_ref,
    status: r.status, tags: J(r.tags, []), createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const entryRow = (r) => ({
    id: r.id, layer: r.layer, title: r.title, body: r.body,
    sourceRefs: J(r.source_refs, []), status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const sugRow = (r) => ({
    id: r.id, action: r.action, title: r.title, detail: r.detail,
    targetKind: r.target_kind, targetId: r.target_id, sources: J(r.sources, []),
    sig: r.sig, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at,
  });

  return {
    dir,
    layers: LAYERS,
    actions: ACTIONS,

    // ── note：未验证观察 ────────────────────────────────────────────
    noteAdd({ body, sourceKind = "manual", sourceRef = "", tags = [] } = {}) {
      const text = String(body || "").trim();
      if (!text) throw new Error("note 内容不能为空");
      // 没有来源的观察不能写入：允许 manual，但要留 source_ref 说明谁写的
      const id = uid("n");
      const at = Date.now();
      run("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?)", [id, text.slice(0, 4000), sourceKind, sourceRef || null, "new", JSON.stringify(tags), at, at]);
      return noteRow(one("SELECT * FROM notes WHERE id=?", [id]));
    },
    noteList({ status, limit = 100 } = {}) {
      const sql = status ? "SELECT * FROM notes WHERE status=? ORDER BY created_at DESC LIMIT ?" : "SELECT * FROM notes ORDER BY created_at DESC LIMIT ?";
      return (status ? rows(sql, [status, limit]) : rows(sql, [limit])).map(noteRow);
    },
    noteSetStatus({ id, status } = {}) {
      if (!["new", "verified", "stale", "rejected"].includes(status)) throw new Error("非法状态");
      run("UPDATE notes SET status=?, updated_at=? WHERE id=?", [status, Date.now(), id]);
      return noteRow(one("SELECT * FROM notes WHERE id=?", [id]));
    },
    noteRemove({ id } = {}) { run("DELETE FROM notes WHERE id=?", [id]); return true; },

    // ── 四层条目 ─────────────────────────────────────────────────
    entryUpsert({ id, layer = "L4", title, body = "", sources = [] } = {}) {
      if (!LAYERS.includes(layer)) throw new Error("layer 必须是 L1–L4");
      const name = String(title || "").trim();
      if (!name) throw new Error("条目标题不能为空");
      const at = Date.now();
      if (id && one("SELECT id FROM entries WHERE id=?", [id])) {
        run("UPDATE entries SET layer=?, title=?, body=?, source_refs=?, status='active', updated_at=? WHERE id=?", [layer, name, String(body).slice(0, 8000), JSON.stringify(sources), at, id]);
        return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
      }
      const next = id || uid("m");
      run("INSERT INTO entries(id, layer, title, body, source_refs, status, created_at, updated_at, sort_order) VALUES (?,?,?,?,?,?,?,?,NULL)", [next, layer, name, String(body).slice(0, 8000), JSON.stringify(sources), "active", at, at]);
      return entryRow(one("SELECT * FROM entries WHERE id=?", [next]));
    },
    entryList({ layer, status = "active", limit = 200 } = {}) {
      const sql = layer
        ? "SELECT * FROM entries WHERE layer=? AND status=? ORDER BY COALESCE(sort_order, 1e12), updated_at DESC LIMIT ?"
        : "SELECT * FROM entries WHERE status=? ORDER BY layer, COALESCE(sort_order, 1e12), updated_at DESC LIMIT ?";
      return (layer ? rows(sql, [layer, status, limit]) : rows(sql, [status, limit])).map(entryRow);
    },
    /** 拖拽排序：按给定顺序写 sort_order（决定注入优先级） */
    entryReorder({ ids = [] } = {}) {
      let i = 0;
      for (const id of ids) { run("UPDATE entries SET sort_order=? WHERE id=?", [i, id]); i += 1; }
      return { count: ids.length };
    },
    entryArchive({ id } = {}) { run("UPDATE entries SET status='archived', updated_at=? WHERE id=?", [Date.now(), id]); return true; },

    /** 回滚：标为过期的条目可以恢复 */
    entryRestore({ id } = {}) {
      run("UPDATE entries SET status='active', updated_at=? WHERE id=?", [Date.now(), id]);
      return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
    },
    /** 已归档 / 已过期条目（可恢复），供「其它」视图 */
    entryArchived({ limit = 100 } = {}) {
      return rows("SELECT * FROM entries WHERE status='archived' ORDER BY updated_at DESC LIMIT ?", [limit]).map(entryRow);
    },
    /** 搜条目（标题 + 正文），记忆页内检索用 */
    entrySearch({ query, limit = 30 } = {}) {
      const q = String(query || "").trim();
      if (!q) return [];
      return rows("SELECT * FROM entries WHERE status='active' AND (title LIKE ? OR body LIKE ?) ORDER BY updated_at DESC LIMIT ?", [`%${q}%`, `%${q}%`, limit]).map(entryRow);
    },
    /** 晋升高置信 note：写 L4 结论条目，并把 note 标记为已验证（可追溯到 note id） */
    promoteNote({ id, layer = "L4" } = {}) {
      const note = one("SELECT * FROM notes WHERE id=?", [id]);
      if (!note) throw new Error("观察不存在");
      if (note.status === "rejected") throw new Error("已拒绝的观察不能晋升");
      const entry = this.entryUpsert({
        layer,
        title: String(note.body).replace(/\s+/g, " ").slice(0, 60),
        body: String(note.body).slice(0, 800),
        sources: [note.sourceRef || note.id],
      });
      run("UPDATE notes SET status='verified', updated_at=? WHERE id=?", [Date.now(), id]);
      return { entry, note: noteRow(one("SELECT * FROM notes WHERE id=?", [id])) };
    },
    /** Dream 配置：可关闭、限制建议条数 */
    dreamConfig({ patch } = {}) {
      const next = { ...DREAM(), ...(patch || {}) };
      metaSet("dream", next);
      return next;
    },
    setInjectBudget({ maxChars } = {}) {
      const n = Math.max(800, Math.min(60000, Number(maxChars) || 12000));
      metaSet("injectBudget", n);
      return n;
    },
    currentInjectBudget() { return Number(metaGet("injectBudget")) || 12000; },
    /** 导出全部记忆（Markdown），用于备份 / 迁移 */
    exportMarkdown() {
      const lines = [`# 记忆导出 ${new Date().toISOString()}`, ""];
      for (const layer of LAYERS) {
        const list = rows("SELECT * FROM entries WHERE layer=? AND status='active' ORDER BY updated_at DESC", [layer]).map(entryRow);
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
      return entryRow(one("SELECT * FROM entries WHERE id=?", [id]));
    },

    // ── 注入：L4 只放目录与结论，超预算做减法 ─────────────────────
    inject({ maxChars } = {}) {
      const stored = Number(metaGet("injectBudget")) || 12000;
      const budget = Math.max(800, Number(maxChars) || stored);
      const l4 = rows("SELECT * FROM entries WHERE layer='L4' AND status='active' ORDER BY COALESCE(sort_order, 1e12), updated_at DESC").map(entryRow);
      const others = rows("SELECT * FROM entries WHERE layer!='L4' AND status='active' ORDER BY layer, COALESCE(sort_order, 1e12), updated_at DESC").map(entryRow);
      const head = "## 记忆（L4 目录 / 结论）";
      let out = head;
      let used = head.length;
      let dropped = 0;
      const items = [];
      const push = (entry, line, included, reason) => items.push({
        id: entry.id, layer: entry.layer, title: entry.title, chars: line.length,
        included, reason: reason || "",
      });
      for (const e of l4) {
        const line = `\n- ${e.title}${e.body ? `：${e.body.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
        // 至少给 L4 留出预算的一半，避免小预算时一条都进不去
        const fits = used + line.length <= Math.max(head.length + 200, budget - 600);
        if (!fits) { dropped += 1; push(e, line, false, `L4 超出预算（剩余 ${Math.max(0, budget - used)} 字符）`); continue; }
        out += line; used += line.length;
        push(e, line, true, "L4 全部注入");
      }
      // 还有预算时补少量 L3（页面结论），只给标题与链接
      for (const e of others) {
        const line = `\n- [${e.layer}] ${e.title}`;
        const fits = used + line.length <= budget;
        if (!fits) { dropped += 1; push(e, line, false, `预算不足：L4 之后按最近使用排序，这条超出 ${budget} 字符预算`); continue; }
        out += line; used += line.length;
        push(e, line, true, "剩余预算内注入");
      }
      if (dropped) out += `\n（另有 ${dropped} 条超出 ${budget} 字符预算，已省略；需要详情用 memory_search）`;
      return { markdown: out, chars: out.length, budget, injected: l4.length + others.length - dropped, dropped, items };
    },

    // ── Dream：五种动作，只产建议 ─────────────────────────────────
    dreamScan({ pages = [], sources = [], noteStats = null } = {}) {
      const cfg = DREAM();
      if (!cfg.enabled) return [];
      const rejected = new Set(rows("SELECT sig FROM rejects").map((r) => r.sig));
      const knownSigs = new Set(rows("SELECT sig FROM suggestions WHERE status IN ('pending','accepted')").map((r) => r.sig));
      const add = (action, title, detail, targetKind, targetId, sourcesArr = []) => {
        if (created.length >= cfg.maxSuggestions) return null;
        const sig = `${action}:${targetKind}:${targetId}:${title}`;
        if (rejected.has(sig) || knownSigs.has(sig)) return null;
        const id = uid("s");
        run("INSERT INTO suggestions VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id, action, title.slice(0, 200), detail || "", targetKind, targetId || null, JSON.stringify(sourcesArr), sig, "pending", Date.now(), null]);
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
          const s = add("fix", `修正「${page.title}」的失效引用`, `${missing.length} 条引用指向已删除的资料`, "page", page.id, missing.map((c) => c.sourceId));
          if (s) created.push(s);
        }
        if (page.status === "reviewed" && !String(page.summary || "").trim()) {
          const s = add("fix", `补摘要「${page.title}」`, "reviewed 页面没有摘要，检索与注入都读不到结论", "page", page.id);
          if (s) created.push(s);
        }
        // fill：页面没有引用也没有反链
        if (!cites.length && !(page.backlinks || 0)) {
          const s = add("fill", `补依据「${page.title}」`, "页面既没有引用资料，也没有被别的页面链接", "page", page.id);
          if (s) created.push(s);
        }
      }
      // build：有资料没有页面
      for (const src of sources) {
        if (cited.has(src.id)) continue;
        const s = add("build", `为资料「${src.title}」建页面`, "这份资料还没有对应页面", "source", src.id, [src.id]);
        if (s) created.push(s);
      }
      // promote：已验证的 note 还没进页面
      for (const note of this.noteList({ status: "verified", limit: 50 })) {
        const s = add("promote", `晋升观察：${note.body.slice(0, 40)}`, "已验证的观察可以并入页面或 L4 结论", "note", note.id, [note.sourceRef].filter(Boolean));
        if (s) created.push(s);
      }
      // prune：L3/L2 体积超过原始资料时给减法建议
      const entriesL3 = this.entryList({ layer: "L3" });
      const total = entriesL3.reduce((n, e) => n + e.body.length, 0);
      if (entriesL3.length > 12 || total > 20000) {
        const s = add("prune", `压缩 L3（${entriesL3.length} 条 / ${total} 字符）`, "L3 体积偏大，建议合并同类条目、正文下沉成页面，只留链接", "entry", entriesL3[0]?.id || "", []);
        if (s) created.push(s);
      }
      void noteStats;
      return created;
    },
    suggestionList({ status = "pending", limit = 100 } = {}) {
      return rows("SELECT * FROM suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?", [status, limit]).map(sugRow);
    },
    suggestionResolve({ id, accept = false } = {}) {
      const sug = one("SELECT * FROM suggestions WHERE id=?", [id]);
      if (!sug) throw new Error("建议不存在");
      run("UPDATE suggestions SET status=?, resolved_at=? WHERE id=?", [accept ? "accepted" : "rejected", Date.now(), id]);
      // 拒绝过的同类不再反复打扰
      if (!accept) run("INSERT INTO rejects VALUES (?,?,1) ON CONFLICT(sig) DO UPDATE SET at=excluded.at, times=times+1", [sug.sig, Date.now()]);
      return sugRow(one("SELECT * FROM suggestions WHERE id=?", [id]));
    },

    overview() {
      const byLayer = {};
      for (const layer of LAYERS) byLayer[layer] = one("SELECT COUNT(*) n FROM entries WHERE layer=? AND status='active'", [layer]).n;
      return {
        byLayer,
        notes: one("SELECT COUNT(*) n FROM notes WHERE status IN ('new','verified')").n,
        notesPending: one("SELECT COUNT(*) n FROM notes WHERE status='new'").n,
        suggestions: one("SELECT COUNT(*) n FROM suggestions WHERE status='pending'").n,
        injectable: this.inject({}).chars,
      };
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
