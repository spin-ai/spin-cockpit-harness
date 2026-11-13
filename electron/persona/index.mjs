/**
 * 人像记忆：从聊天导出里抽「人 / 关系 / 偏好 / 约束 / 事件」，默认进待确认。
 *
 * 独立库：`userData/persona/persona.db`（node:sqlite，可删可重建）。
 * 规则（对齐需求）：
 *  - 抽取结果一律 pending，只有显式确认才生效；拒绝留痕，且不重复打扰
 *  - 没有来源的观察不能确认
 *  - 每条观察带 validFrom/validTo 与 confidence，新旧冲突标记 conflict
 *  - 群聊与一对一分开展示（groupOnly），不把群内单次互动当亲密关系
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const FIELDS = ["identity", "preference", "value", "constraint", "goal", "situation", "event", "stance", "relation"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY, kind TEXT, title TEXT, hash TEXT UNIQUE, chunks INTEGER,
  self_name TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT, relation TEXT,
  strength REAL DEFAULT 0.5, direction TEXT, group_only INTEGER DEFAULT 0,
  is_self INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY, person_id TEXT, person TEXT, field TEXT, value TEXT,
  valid_from INTEGER, valid_to INTEGER, confidence REAL DEFAULT 0.6,
  source_kind TEXT, source_ref TEXT, quote TEXT,
  status TEXT DEFAULT 'pending',            -- pending | confirmed | rejected
  sensitive INTEGER DEFAULT 0, conflict TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, type TEXT, strength REAL DEFAULT 0.5,
  direction TEXT, source_ref TEXT, status TEXT DEFAULT 'pending', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS rejects (sig TEXT PRIMARY KEY, at INTEGER, times INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS obs_status ON observations(status);
CREATE INDEX IF NOT EXISTS obs_person ON observations(person_id, field);
`;

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const J = (v, f) => { try { return v ? JSON.parse(v) : f; } catch { return f; } };
const hash = (text) => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36) + text.length.toString(36);
};

/** 从各种导出文本里切出 (speaker, time, text) —— 只认常见格式，认不出就不猜 */
export function parseChat(text, { format = "auto", selfName = "" } = {}) {
  const raw = String(text || "").replace(/\r/g, "");
  const out = [];
  if (format === "json" || (format === "auto" && /^\s*[[{]/.test(raw))) {
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : data.messages || data.data || [];
      for (const item of list) {
        const speaker = String(item.from || item.sender || item.author || item.name || "").trim();
        const body = String(item.text || item.content || item.message || "").trim();
        const ts = item.date ? new Date(item.date).getTime() : null;
        if (speaker && body) out.push({ speaker, text: body, at: ts });
      }
      if (out.length) return { messages: out, format: "json" };
    } catch { /* 落回文本解析 */ }
  }
  const lines = raw.split("\n");
  let pendingSpeaker = "";
  let pendingAt = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // 2024-01-02 12:34:56 张三
    const head = t.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s+(.{1,24})$/);
    if (head) {
      pendingAt = new Date(`${head[1].replace(/\//g, "-")}T${head[2]}`).getTime() || null;
      pendingSpeaker = head[3].trim();
      continue;
    }
    // 张三: 内容 / 张三：内容
    const m = t.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
    if (m) { out.push({ speaker: m[1].trim(), text: m[2].trim(), at: pendingAt }); continue; }
    if (pendingSpeaker) { out.push({ speaker: pendingSpeaker, text: t, at: pendingAt }); pendingSpeaker = ""; continue; }
    out.push({ speaker: "unknown", text: t, at: pendingAt });
  }
  void selfName;
  return { messages: out, format: "text" };
}

/** 规则抽取：只认高置信句式，宁可漏也不乱猜 */
function extractFacts(messages, { selfName = "" } = {}) {
  const facts = [];
  const push = (speaker, field, value, quote, at, sensitive = false) => {
    if (!value || value.length < 2) return;
    facts.push({ speaker, field, value: value.slice(0, 200), quote: quote.slice(0, 240), at, sensitive });
  };
  for (const m of messages) {
    const text = m.text;
    const speaker = m.speaker;
    const self = selfName && (speaker === selfName || speaker.includes(selfName));
    const subject = self ? "__self__" : speaker;
    const prefs = text.match(/(?:我|他|她)?(?:很|比较|特别)?(?:喜欢|偏好|习惯)([^，。！？;]{2,30})/);
    if (prefs) push(subject, "preference", prefs[1].trim(), text, m.at);
    const hates = text.match(/(?:不喜欢|讨厌|反感)([^，。！？;]{2,30})/);
    if (hates) push(subject, "preference", `不喜欢${hates[1].trim()}`, text, m.at);
    const must = text.match(/(?:不能|不要|必须|务必|禁止)([^，。！？;]{2,40})/);
    if (must) push(subject, "constraint", `${text.match(/(不能|不要|必须|务必|禁止)/)[1]}${must[1].trim()}`, text, m.at);
    const goal = text.match(/(?:目标|计划|打算|想要|希望)([^，。！？;]{2,40})/);
    if (goal) push(subject, "goal", goal[1].trim(), text, m.at);
    const rel = text.match(/(?:是我的|是我|我的)(老板|领导|同事|下属|客户|partner|家人|朋友|妻子|丈夫|父亲|母亲|儿子|女儿)/);
    if (rel && !self) facts.push({ speaker: subject, field: "relation", value: rel[1], quote: text.slice(0, 240), at: m.at, sensitive: false, relationTo: "__self__" });
    const event = text.match(/(生日|入职|离职|结婚|毕业|面试|出差)[^，。！？;]{0,20}/);
    if (event) push(subject, "event", event[0], text, m.at);
    const stance = text.match(/(支持|反对|倾向|担心|不看好)([^，。！？;]{0,30})/);
    if (stance) push(subject, "stance", `${stance[1]}${stance[2] || ""}`.trim(), text, m.at);
  }
  return facts;
}

export function createPersona({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "persona.db"));
  db.exec(SCHEMA);
  const rows = (sql, p = []) => db.prepare(sql).all(...p);
  const one = (sql, p = []) => db.prepare(sql).get(...p);
  const run = (sql, p = []) => db.prepare(sql).run(...p);

  const personRow = (r) => ({
    id: r.id, name: r.name, aliases: J(r.aliases, []), relation: r.relation,
    strength: r.strength, direction: r.direction, groupOnly: !!r.group_only,
    isSelf: !!r.is_self, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const obsRow = (r) => ({
    id: r.id, personId: r.person_id, person: r.person, field: r.field, value: r.value,
    validFrom: r.valid_from, validTo: r.valid_to, confidence: r.confidence,
    sourceKind: r.source_kind, sourceRef: r.source_ref, quote: r.quote,
    status: r.status, sensitive: !!r.sensitive, conflict: r.conflict,
    createdAt: r.created_at, updatedAt: r.updated_at,
  });

  function upsertPerson(name, { isSelf = false, groupOnly = false } = {}) {
    if (!name || name === "unknown") return null;
    const found = rows("SELECT * FROM people").map(personRow).find((p) => p.name === name || p.aliases.includes(name));
    if (found) return found;
    const at = Date.now();
    const id = uid("p");
    run("INSERT INTO people VALUES (?,?,?,?,?,?,?,?,?,?)", [id, name, "[]", "", isSelf ? 1 : 0.45, "", groupOnly ? 1 : 0, isSelf ? 1 : 0, at, at]);
    return personRow(one("SELECT * FROM people WHERE id=?", [id]));
  }

  return {
    dir,
    fields: FIELDS,

    /** 导入聊天导出 / 文档：去重、抽事实、全部进 pending */
    import({ text, format = "auto", kind = "chat", title = "chat export", selfName = "" } = {}) {
      const raw = String(text || "");
      if (raw.trim().length < 10) throw new Error("内容太短");
      const h = hash(raw);
      const dup = one("SELECT * FROM imports WHERE hash=?", [h]);
      if (dup) return { deduped: true, importId: dup.id, added: 0, messages: dup.chunks };
      const { messages, format: fmt } = parseChat(raw, { format, selfName });
      if (!messages.length) throw new Error("没有解析出任何发言");
      const id = uid("i");
      run("INSERT INTO imports VALUES (?,?,?,?,?,?,?)", [id, kind, title.slice(0, 120), h, messages.length, selfName || null, Date.now()]);
      if (selfName) upsertPerson(selfName, { isSelf: true });
      const isGroup = new Set(messages.map((m) => m.speaker)).size > 2;
      const facts = extractFacts(messages, { selfName });
      let added = 0;
      for (const f of facts) {
        const person = f.speaker === "__self__" ? upsertPerson(selfName || "我", { isSelf: true }) : upsertPerson(f.speaker, { groupOnly: isGroup });
        const sig = `${person?.id || f.speaker}:${f.field}:${f.value}`;
        const rejected = one("SELECT sig FROM rejects WHERE sig=?", [sig]);
        if (rejected) continue;
        const exists = one("SELECT id FROM observations WHERE person_id IS ? AND field=? AND value=? AND status!='rejected'", [person?.id || null, f.field, f.value]);
        if (exists) continue;
        run("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
          uid("o"), person?.id || null, f.speaker === "__self__" ? "本人" : f.speaker, f.field, f.value,
          f.at || null, null, 0.55, kind, `${id}:${messages.indexOf(messages.find((m) => m.text === f.quote))}`, f.quote,
          "pending", f.sensitive ? 1 : 0, null, Date.now(), Date.now(),
        ]);
        added += 1;
        if (f.relationTo && person) {
          run("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)", [uid("r"), person.id, "__self__", f.value, 0.6, "affects", id, "pending", Date.now()]);
        }
      }
      return { deduped: false, importId: id, format: fmt, messages: messages.length, people: new Set(messages.map((m) => m.speaker)).size, added };
    },

    pending({ limit = 200 } = {}) {
      return rows("SELECT * FROM observations WHERE status='pending' ORDER BY created_at DESC LIMIT ?", [limit]).map(obsRow);
    },
    /** 确认 / 拒绝：拒绝留痕，同类不再打扰；无来源不能确认 */
    resolve({ id, accept = false, sensitive } = {}) {
      const obs = one("SELECT * FROM observations WHERE id=?", [id]);
      if (!obs) throw new Error("观察不存在");
      if (accept && !obs.source_ref && !obs.quote) throw new Error("没有来源的观察不能确认");
      run("UPDATE observations SET status=?, sensitive=?, updated_at=? WHERE id=?", [accept ? "confirmed" : "rejected", sensitive ? 1 : obs.sensitive, Date.now(), id]);
      if (!accept) run("INSERT INTO rejects VALUES (?,?,1) ON CONFLICT(sig) DO UPDATE SET at=excluded.at, times=times+1", [`${obs.person_id || obs.person}:${obs.field}:${obs.value}`, Date.now()]);
      return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
    },
    /** 冲突检测：同人同字段不同值 → 标 conflict，不静默覆盖 */
    detectConflicts() {
      const groups = rows("SELECT person_id, field, COUNT(DISTINCT value) n FROM observations WHERE status='confirmed' GROUP BY person_id, field HAVING n > 1");
      for (const g of groups) {
        const list = rows("SELECT * FROM observations WHERE person_id=? AND field=? AND status='confirmed' ORDER BY COALESCE(valid_from, created_at) DESC", [g.person_id, g.field]).map(obsRow);
        if (list.length < 2) continue;
        run("UPDATE observations SET conflict=? WHERE id=?", [`与「${list[1].value}」不一致`, list[0].id]);
      }
      return groups.length;
    },

    people({ includeGroup = true } = {}) {
      return rows("SELECT * FROM people ORDER BY is_self DESC, updated_at DESC").map(personRow)
        .filter((p) => includeGroup || !p.groupOnly);
    },
    merge({ keepId, aliasIds = [] } = {}) {
      const keep = one("SELECT * FROM people WHERE id=?", [keepId]);
      if (!keep) throw new Error("目标人不存在");
      const merged = J(keep.aliases, []);
      for (const id of aliasIds) {
        const other = one("SELECT * FROM people WHERE id=?", [id]);
        if (!other) continue;
        merged.push(other.name);
        run("UPDATE observations SET person_id=? WHERE person_id=?", [keepId, id]);
        run("UPDATE relations SET from_id=? WHERE from_id=?", [keepId, id]);
        run("UPDATE relations SET to_id=? WHERE to_id=?", [keepId, id]);
        run("DELETE FROM people WHERE id=?", [id]);
      }
      run("UPDATE people SET aliases=?, updated_at=? WHERE id=?", [JSON.stringify([...new Set(merged)]), Date.now(), keepId]);
      return personRow(one("SELECT * FROM people WHERE id=?", [keepId]));
    },

    /** 画像：本人 / 他人 / 关系 三层 */
    profile({ personId } = {}) {
      const person = personId ? personRow(one("SELECT * FROM people WHERE id=?", [personId])) : null;
      const obs = (pid) => rows("SELECT * FROM observations WHERE person_id=? AND status='confirmed' ORDER BY field, COALESCE(valid_from, created_at) DESC", [pid]).map(obsRow);
      const self = personRow(one("SELECT * FROM people WHERE is_self=1 LIMIT 1") || {});
      const others = rows("SELECT * FROM people WHERE is_self=0").map(personRow);
      const rels = rows("SELECT * FROM relations WHERE status='confirmed'").map((r) => ({
        id: r.id, from: r.from_id, to: r.to_id, type: r.type, strength: r.strength, direction: r.direction, sourceRef: r.source_ref,
      }));
      if (person) {
        return { person, observations: obs(person.id), relations: rels.filter((r) => r.from === person.id || r.to === person.id) };
      }
      return {
        self: self?.id ? { person: self, observations: obs(self.id) } : null,
        others: others.map((p) => ({ person: p, observations: obs(p.id).slice(0, 12) })),
        relations: rels,
        groupOnly: others.filter((p) => p.groupOnly).map((p) => p.name),
      };
    },

    /** 时间线：同一字段的演变过程 */
    timeline({ personId, field } = {}) {
      const list = field
        ? rows("SELECT * FROM observations WHERE person_id=? AND field=? AND status='confirmed' ORDER BY COALESCE(valid_from, created_at)", [personId, field])
        : rows("SELECT * FROM observations WHERE person_id=? AND status='confirmed' ORDER BY COALESCE(valid_from, created_at)", [personId]);
      return list.map(obsRow).map((o) => ({ ...o, at: o.validFrom || o.createdAt }));
    },

    /** 决策辅助：给出依据，信息不足明确说未知 */
    ask({ question = "" } = {}) {
      const q = String(question || "").trim();
      if (!q) throw new Error("问题不能为空");
      const facts = rows("SELECT * FROM observations WHERE status='confirmed'").map(obsRow);
      const people = rows("SELECT * FROM people").map(personRow);
      const rels = rows("SELECT * FROM relations").map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, type: r.type, strength: r.strength }));
      const nameOf = (id) => (id === "__self__" ? (people.find((p) => p.isSelf)?.name || "本人") : people.find((p) => p.id === id)?.name || id);
      // 中文没有空格：除了整段词，再切 2-gram，否则「推进发布计划该找谁」这种整句永远匹配不上
      const words = q.split(/[，。？！、\s,?]+/).filter((t) => t.length >= 2);
      const grams = [];
      for (const w of words) {
        if (!/[\u3400-\u9fff]/.test(w)) continue;
        for (let i = 0; i < w.length - 1; i += 1) grams.push(w.slice(i, i + 2));
      }
      const tokens = [...new Set([...words, ...grams])];
      const hit = (text) => tokens.some((t) => String(text || "").includes(t));
      const hitFact = (f) => hit(f.value) || hit(f.quote) || hit(f.person);
      const citations = [];
      const lines = [];

      const who = people.find((p) => q.includes(p.name));
      const person = who;
      const wantWho = /该找谁|找谁|谁能|通过谁/.test(q);
      const wantReact = /反应|态度|会同意|会反对/.test(q);
      const wantImpact = /影响谁|影响到谁/.test(q);

      if (wantWho || wantReact) {
        const related = person ? facts.filter((f) => f.personId === person.id && (f.field === "stance" || f.field === "preference" || f.field === "constraint")) : facts.filter((f) => f.field === "stance" && hit(f.value));
        for (const f of related.slice(0, 6)) {
          lines.push(`- ${f.person || nameOf(f.personId)} ${f.field === "stance" ? "的立场" : f.field === "preference" ? "的偏好" : "的约束"}：${f.value}`);
          citations.push({ kind: "observation", id: f.id, quote: f.quote, source: f.sourceRef, at: f.validFrom || f.createdAt });
        }
      }
      if (wantWho && !person) {
        // 没点名时：按「与问题关键词相关的已确认事实」挑人，并说明依据
        const scored = people
          .filter((p) => !p.isSelf)
          .map((p) => {
            const mine = facts.filter((f) => f.personId === p.id && (hitFact(f) || hit(f.field)));
            return { p, mine, score: mine.length + (rels.some((r) => r.from === p.id || r.to === p.id) ? 0.5 : 0) };
          })
          .filter((x) => x.mine.length > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
        for (const { p, mine } of scored) {
          const evidence = mine[0];
          if (!evidence) continue;
          lines.push(`- 建议找 ${p.name}${p.relation ? `（${p.relation}）` : ""}：${evidence.value}`);
          if (evidence) citations.push({ kind: "observation", id: evidence.id, quote: evidence.quote, source: evidence.sourceRef, at: evidence.validFrom || evidence.createdAt });
        }
      }
      if (wantWho) {
        const linked = person
          ? rels.filter((r) => r.from === person.id || r.to === person.id).map((r) => (r.from === person.id ? nameOf(r.to) : nameOf(r.from)))
          : [...new Set(rels.map((r) => nameOf(r.to)))].filter((n) => people.some((p) => p.name === n && !p.isSelf));
        if (linked.length) lines.push(`- 关系网络：${[...new Set(linked)].slice(0, 6).join(" / ")}`);
      }
      if (wantImpact) {
        if (person) {
          const affected = rels.filter((r) => r.from === person.id || r.to === person.id).map((r) => (r.from === person.id ? nameOf(r.to) : nameOf(r.from)));
          if (affected.length) lines.push(`- 会牵动：${[...new Set(affected)].join(" / ")}`);
        }
      }
      if (!lines.length) {
        // 兜底：按关键词匹配事实
        for (const f of facts.filter((f) => hitFact(f)).slice(0, 8)) {
          lines.push(`- ${f.person || nameOf(f.personId)} · ${f.field}：${f.value}`);
          citations.push({ kind: "observation", id: f.id, quote: f.quote, source: f.sourceRef, at: f.validFrom || f.createdAt });
        }
      }
      if (!lines.length) {
        // 不猜，但把可用的关系网络摊开，方便人自己判断
        const net = rels
          .map((r) => ({ name: nameOf(r.to === "__self__" ? r.from : r.to), type: r.type }))
          .filter((x) => x.name && people.some((p) => p.name === x.name && !p.isSelf));
        const hint = net.length ? `\n可用关系：${[...new Set(net.map((n) => `${n.name}${n.type ? `（${n.type}）` : ""}`))].slice(0, 6).join(" / ")}` : "";
        return { found: false, answer: `未知：画像里没有能支撑这个判断的记录。${hint}`, citations: [] };
      }
      return { found: true, answer: lines.join("\n"), citations };
    },

    /** 按人 / 时间段 / 来源删除 */
    remove({ personId, from, to, sourcePrefix } = {}) {
      let sql = "DELETE FROM observations WHERE 1=1";
      const p = [];
      if (personId) { sql += " AND person_id=?"; p.push(personId); }
      if (from) { sql += " AND COALESCE(valid_from, created_at)>=?"; p.push(Number(from)); }
      if (to) { sql += " AND COALESCE(valid_from, created_at)<=?"; p.push(Number(to)); }
      if (sourcePrefix) { sql += " AND source_kind=?"; p.push(sourcePrefix); }
      const before = one("SELECT COUNT(*) n FROM observations").n;
      run(sql, p);
      const after = one("SELECT COUNT(*) n FROM observations").n;
      return { removed: before - after };
    },

    stats() {
      return {
        people: one("SELECT COUNT(*) n FROM people").n,
        pending: one("SELECT COUNT(*) n FROM observations WHERE status='pending'").n,
        confirmed: one("SELECT COUNT(*) n FROM observations WHERE status='confirmed'").n,
        relations: one("SELECT COUNT(*) n FROM relations").n,
        imports: one("SELECT COUNT(*) n FROM imports").n,
      };
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
