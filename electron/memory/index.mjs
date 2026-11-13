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

  const rows = (sql, params = []) => db.prepare(sql).all(...params);
  const one = (sql, params = []) => db.prepare(sql).get(...params);
  const run = (sql, params = []) => db.prepare(sql).run(...params);

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
      run("INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)", [next, layer, name, String(body).slice(0, 8000), JSON.stringify(sources), "active", at, at]);
      return entryRow(one("SELECT * FROM entries WHERE id=?", [next]));
    },
    entryList({ layer, status = "active", limit = 200 } = {}) {
      const sql = layer
        ? "SELECT * FROM entries WHERE layer=? AND status=? ORDER BY updated_at DESC LIMIT ?"
        : "SELECT * FROM entries WHERE status=? ORDER BY layer, updated_at DESC LIMIT ?";
      return (layer ? rows(sql, [layer, status, limit]) : rows(sql, [status, limit])).map(entryRow);
    },
    entryArchive({ id } = {}) { run("UPDATE entries SET status='archived', updated_at=? WHERE id=?", [Date.now(), id]); return true; },

    // ── 注入：L4 只放目录与结论，超预算做减法 ─────────────────────
    inject({ maxChars = 12000 } = {}) {
      const budget = Math.max(1500, Number(maxChars) || 12000);
      const l4 = rows("SELECT * FROM entries WHERE layer='L4' AND status='active' ORDER BY updated_at DESC").map(entryRow);
      const others = rows("SELECT * FROM entries WHERE layer!='L4' AND status='active' ORDER BY layer, updated_at DESC").map(entryRow);
      const head = "## 记忆（L4 目录 / 结论）";
      let out = head;
      let used = head.length;
      let dropped = 0;
      for (const e of l4) {
        const line = `\n- ${e.title}${e.body ? `：${e.body.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
        if (used + line.length > budget - 600) { dropped += 1; continue; }
        out += line; used += line.length;
      }
      // 还有预算时补少量 L3（页面结论），只给标题与链接
      for (const e of others) {
        const line = `\n- [${e.layer}] ${e.title}`;
        if (used + line.length > budget) { dropped += 1; continue; }
        out += line; used += line.length;
      }
      if (dropped) out += `\n（另有 ${dropped} 条超出 ${budget} 字符预算，已省略；需要详情用 memory_search）`;
      return { markdown: out, chars: out.length, budget, injected: l4.length + others.length - dropped, dropped };
    },

    // ── Dream：五种动作，只产建议 ─────────────────────────────────
    dreamScan({ pages = [], sources = [], noteStats = null } = {}) {
      const rejected = new Set(rows("SELECT sig FROM rejects").map((r) => r.sig));
      const knownSigs = new Set(rows("SELECT sig FROM suggestions WHERE status IN ('pending','accepted')").map((r) => r.sig));
      const add = (action, title, detail, targetKind, targetId, sourcesArr = []) => {
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
