/**
 * 人物建模：从聊天导出里抽「人 / 关系 / 偏好 / 约束 / 事件 / 处事方式 / 说话风格」，默认进待确认。
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

/**
 * 字段分组：从「陈述性事实」扩到「性格 + 处事 + 说话风格」。
 * 旧字段全部保留（已有库不用迁移），新字段只是多几类观察。
 */
export const FIELD_GROUPS = {
  basic: ["identity", "role", "situation", "capability", "taboo"],
  character: ["traits", "value", "goal"],
  behavior: ["decision", "conflict", "stress", "commitment", "communication"],
  voice: ["style", "voice"],
  facts: ["preference", "constraint", "stance", "event", "relation"],
};
const FIELDS = [...new Set(Object.values(FIELD_GROUPS).flat())];
/**
 * 只有这些字段是「新说法取代旧说法」的：用于冲突检测与漂移。
 * 处事/沟通类的多条观察是互补的面，不是矛盾（「不接受电话」+「偏好文字」并不冲突），
 * 所以不做单值判定 —— 宁可漏，也不要给人贴错标签。
 */
const SINGLE_VALUED = ["identity", "role", "situation", "value", "goal"];
/** 人设卡完整度只看这几组：事实类不计入，避免「聊得多 = 建模好」 */
const CARD_FIELDS = [...FIELD_GROUPS.basic, ...FIELD_GROUPS.character, ...FIELD_GROUPS.behavior, ...FIELD_GROUPS.voice];

const FIELD_LABEL = {
  identity: "身份", role: "角色 / 职务", situation: "处境", capability: "擅长 / 短板", taboo: "雷区",
  traits: "性格", value: "价值观", goal: "目标 / 动机",
  decision: "决策依据", conflict: "冲突处理", stress: "压力反应", commitment: "承诺可靠性", communication: "沟通方式",
  style: "说话习惯", voice: "语气样本",
  preference: "偏好", constraint: "硬约束", stance: "立场", event: "事件", relation: "关系",
};

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
/** 新字段的默认置信度：说话风格最弱（单条消息就能触发） */
const BASE_CONFIDENCE = { style: 0.5, voice: 0.65, traits: 0.52, taboo: 0.55 };
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

    // ── 基本信息：角色与能力只认带职称/明确自述的句子 ──
    const role = text.match(/(?:我是|现在是|现任|负责的是?|带领?)([^，。！？;\s]{2,16}?(?:负责人|经理|总监|主管|VP|工程师|设计师|产品))[^，。！？;]?/);
    if (role) push(subject, "role", role[1], text, m.at);
    const cap = text.match(/(不擅长|擅长|不太懂|不懂|熟悉)([^，。！？;]{2,16})/);
    if (cap) push(subject, "capability", `${cap[1]}${cap[2].trim()}`, text, m.at);

    // ── 处事方式：只认明确的说法，单条消息不足以下结论（由 support 计数兜底）──
    const decision = text.match(/(?:看|凭|靠)(数据|直觉|感觉|经验|指标|证据)/);
    if (decision) push(subject, "decision", `依赖${decision[1]}`, text, m.at);
    if (/(拍板|当场定|直接定|一句话的事)/.test(text)) push(subject, "decision", "拍板快", text, m.at);
    if (/(等|要)(老板|领导|上级|上面|VP|老周)[^，。！？;]{0,8}(定|拍|批|签)/.test(text)) push(subject, "decision", "关键决定要上级拍板", text, m.at);
    const conflict = text.match(/(不跟你争|不争这个|你定吧|你们定|都行|随便|这事我不掺和|先放着|听你的|我不同意|必须按|一起看看)/);
    if (conflict) {
      const map = {
        不跟你争: "回避争执", 不争这个: "回避争执", 你定吧: "回避决策", 你们定: "回避决策", 都行: "回避决策",
        随便: "回避决策", 这事我不掺和: "回避冲突", 先放着: "拖延处理", 听你的: "顺应对方",
        我不同意: "直接表达反对", 必须按: "坚持己见", 一起看看: "倾向协作",
      };
      push(subject, "conflict", map[conflict[1]] || conflict[1], text, m.at);
    }
    const stress = text.match(/(这周先别找我|别找我|忙不过来|处理不完|做不完|焦头烂额)/);
    if (stress) push(subject, "stress", "承压时会收窄沟通面", text, m.at);
    const promise = text.match(/(答应你的|我记着)/);
    if (promise) push(subject, "commitment", "答应了会做", text, m.at);
    if (/(下个?迭代|排期|下周给|尽快给)/.test(text)) push(subject, "commitment", "承诺要落到排期才算数", text, m.at);
    if (/(别给我打(?:电话|语音))/i.test(text)) push(subject, "communication", "不接受电话 / 语音", text, m.at);
    if (/(发文字|文字说|看文字)/.test(text)) push(subject, "communication", "偏好文字", text, m.at);
    if (/(开个会|开会)/.test(text)) push(subject, "communication", "常用会议沟通", text, m.at);
    if (/(发邮件|走邮件)/.test(text)) push(subject, "communication", "偏好邮件", text, m.at);
    const taboo = text.match(/(别跟我提|别问|别提|不想聊|不要问)/);
    if (taboo) push(subject, "taboo", `不愿谈：${text.slice(text.indexOf(taboo[1]) + taboo[1].length, text.indexOf(taboo[1]) + taboo[1].length + 12).trim()}`, text, m.at);

    // ── 说话风格：每条消息都能算一个标签，去重后就是口癖 ──
    if (/结论先行|直接说结论|先说结论/.test(text)) push(subject, "style", "习惯结论先行", text, m.at);
    if (/(?:^|[，。])(?:[一两三]是|[一两三]条|[一两三]点|首先)/.test(text)) push(subject, "style", "习惯分条编号", text, m.at);
    if (/——/.test(text)) push(subject, "style", "用破折号断句", text, m.at);
    if (/\p{Extended_Pictographic}/u.test(text)) push(subject, "style", "会用表情", text, m.at);
    if (/(可能|也许|大概|应该是)/.test(text)) push(subject, "style", "说话留余地", text, m.at);
  }

  // 语气样本：每人取 2 条较长、带人称或标点的原话，注入时用来「像他那样说」
  const voice = new Map();
  for (const m of messages) {
    const text = String(m.text || "").trim();
    if (text.length < 16 || text.length > 90) continue;
    if (!/[，。！？,.]/.test(text)) continue;
    const self = selfName && (m.speaker === selfName || m.speaker.includes(selfName));
    const subject = self ? "__self__" : m.speaker;
    const list = voice.get(subject) || [];
    if (list.length >= 2) continue;
    list.push({ speaker: subject, field: "voice", value: text.slice(0, 24), quote: text.slice(0, 240), at: m.at, sensitive: false });
    voice.set(subject, list);
  }
  facts.push(...[...voice.values()].flat());
  return facts;
}

export function createPersona({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "persona.db"));
  db.exec(SCHEMA);
  try { db.exec("ALTER TABLE people ADD COLUMN one_liner TEXT"); } catch { /* 已存在 */ }
  const rows = (sql, p = []) => db.prepare(sql).all(...p);
  const one = (sql, p = []) => db.prepare(sql).get(...p);
  const run = (sql, p = []) => db.prepare(sql).run(...p);

  const metaGet = (k) => { try { return one("SELECT v FROM meta WHERE k=?", [k])?.v || null; } catch { return null; } };
  const metaSet = (k, v) => run("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [k, String(v ?? "")]);

  const personRow = (r) => ({
    id: r.id, name: r.name, aliases: J(r.aliases, []), relation: r.relation,
    strength: r.strength, direction: r.direction, groupOnly: !!r.group_only,
    isSelf: !!r.is_self, createdAt: r.created_at, updatedAt: r.updated_at,
    oneLiner: r.one_liner || "",
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
    // 显式列名：people 表会继续加列（one_liner 已经加过），不能再用 VALUES 全列占位
    run(
      "INSERT INTO people (id, name, aliases, relation, strength, direction, group_only, is_self, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, name, "[]", "", isSelf ? 1 : 0.45, "", groupOnly ? 1 : 0, isSelf ? 1 : 0, at, at],
    );
    return personRow(one("SELECT * FROM people WHERE id=?", [id]));
  }

  const nameOfId = (id) => {
    if (id === "__self__") return personRow(one("SELECT * FROM people WHERE is_self=1 LIMIT 1") || {})?.name || "本人";
    return personRow(one("SELECT * FROM people WHERE id=?", [id]) || {})?.name || id;
  };
  const levelOf = (n) => (n >= 4 ? "高" : n >= 2 ? "中" : n ? "低" : "无");

  /**
   * 人物卡：把已确认观察整理成「一句话 + 分节 + 每节证据」。
   * UI 和注入共用同一份数据，避免页面上写一套、注入里另一套。
   */
  function cardOf(personId) {
    const person = personRow(one("SELECT * FROM people WHERE id=?", [personId]));
    if (!person) throw new Error("人物不存在");
    const obs = rows(
      "SELECT * FROM observations WHERE person_id=? AND status='confirmed' ORDER BY confidence DESC, COALESCE(valid_from, created_at) DESC",
      [personId],
    ).map(obsRow);
    // 敏感项不进人设卡，也不进注入：只报数量，避免「默认不注入」变成一句空话
    const sensitive = obs.filter((o) => o.sensitive).length;
    const safe = obs.filter((o) => !o.sensitive);
    const byField = {};
    for (const o of safe) (byField[o.field] ||= []).push(o);
    const support = (f) => (byField[f] || []).length;
    const rowOf = (f) => ({
      field: f, label: FIELD_LABEL[f] || f,
      values: (byField[f] || []).map((o) => o.value),
      support: support(f), level: levelOf(support(f)),
      conflict: (byField[f] || []).find((o) => o.conflict)?.conflict || null,
      evidence: (byField[f] || []).slice(0, 6).map((o) => ({
        id: o.id, value: o.value, quote: o.quote, sourceKind: o.sourceKind,
        sourceRef: o.sourceRef, at: o.validFrom || o.createdAt, confidence: o.confidence, conflict: o.conflict,
      })),
    });
    const section = (id, title, fields) => ({ id, title, rows: fields.map(rowOf).filter((r) => r.support > 0) });
    const sections = [
      section("basic", "基本信息", FIELD_GROUPS.basic),
      section("character", "性格与价值观", FIELD_GROUPS.character),
      section("behavior", "处事方式", FIELD_GROUPS.behavior),
      section("voice", "说话风格", FIELD_GROUPS.voice),
      section("facts", "其他事实", FIELD_GROUPS.facts.filter((f) => f !== "relation")),
    ].filter((s) => s.rows.length > 0);

    const rels = rows("SELECT * FROM relations WHERE status='confirmed' AND (from_id=? OR to_id=?)", [person.id, person.id]);
    const network = rels.map((r) => ({
      id: r.id,
      name: nameOfId(r.from_id === person.id ? r.to_id : r.from_id),
      type: r.type || "",
      strength: r.strength,
      at: r.created_at,
    }));

    // 一句话概括：只用已确认的观察，不靠模型编
    const pick = (f) => (byField[f] || [])[0]?.value || "";
    const bits = [pick("traits"), pick("decision"), pick("conflict"), pick("communication"), pick("value"), pick("preference")].filter(Boolean);
    const autoOneLiner = bits.length ? `${[...new Set(bits)].slice(0, 3).join("；")}。` : "";
    const oneLiner = person.oneLiner || autoOneLiner;

    const covered = CARD_FIELDS.filter((f) => support(f) > 0).length;
    const completeness = Math.min(100, Math.round((covered / CARD_FIELDS.length) * 100) + Math.min(8, Math.floor(safe.length / 6)));
    const pending = one("SELECT COUNT(*) n FROM observations WHERE person_id=? AND status='pending'", [person.id]).n;

    return {
      person, sections, network, oneLiner, completeness,
      counts: { confirmed: safe.length, pending, sensitive, fields: covered, total: CARD_FIELDS.length },
      empty: obs.length === 0,
    };
  }

  return {
    dir,
    fields: FIELDS,
    fieldGroups: FIELD_GROUPS,

    /** 左栏列表：带已确认 / 待确认计数与人设卡完整度 */
    peopleList() {
      // 按 created_at 排，不按 updated_at：建模 / 改写一句话会刷 updated_at，
      // 用它排序会让「刚操作过的人」在左栏里跳到最前面。
      return rows("SELECT * FROM people WHERE is_self=1 OR EXISTS (SELECT 1 FROM observations o WHERE o.person_id = people.id) ORDER BY is_self DESC, COALESCE(created_at, 0) DESC, name").map(personRow).map((p) => {
        const covered = new Set(
          rows("SELECT DISTINCT field FROM observations WHERE person_id=? AND status='confirmed'", [p.id])
            .map((r) => r.field).filter((f) => CARD_FIELDS.includes(f)),
        );
        const confirmed = one("SELECT COUNT(*) n FROM observations WHERE person_id=? AND status='confirmed'", [p.id]).n;
        const pending = one("SELECT COUNT(*) n FROM observations WHERE person_id=? AND status='pending'", [p.id]).n;
        const lastAt = one("SELECT MAX(updated_at) t FROM observations WHERE person_id=?", [p.id]).t || p.updatedAt;
        const completeness = Math.min(100, Math.round((covered.size / CARD_FIELDS.length) * 100) + Math.min(8, Math.floor(confirmed / 6)));

        // 标签：一眼看出「建模过什么、是什么类型的人」
        const tags = [];
        const values = rows("SELECT field, value, source_kind FROM observations WHERE person_id=? AND status='confirmed'", [p.id]);
        const has = (field, re) => values.some((v) => v.field === field && re.test(v.value));
        if (values.some((v) => v.source_kind === "llm") || p.oneLiner) tags.push("已建模");
        if (completeness >= 50) tags.push("人设卡");
        if (has("role", /营销|官方|客服|公众号|运营/) || /营销号|官方号|公众号/.test(p.oneLiner || "")) tags.push("营销/官方");
        else if (has("role", /技术|开发|工程师|程序|研发/) || has("identity", /技术|开发|工程师|研发/)) tags.push("技术");
        if (has("traits", /话多/)) tags.push("话多");
        else if (has("traits", /话少/)) tags.push("话少");
        if (has("communication", /回复(很快|极快)/)) tags.push("秒回");
        if (values.some((v) => v.field === "situation" && /私聊 100%/.test(v.value))) tags.push("私聊为主");
        if (values.some((v) => v.field === "situation" && /群聊 100%/.test(v.value))) tags.push("群聊为主");
        if (p.groupOnly) tags.push("仅群聊");
        if (rows("SELECT 1 FROM observations WHERE person_id=? AND sensitive=1 LIMIT 1", [p.id]).length) tags.push("敏感");

        return { ...p, confirmed, pending, lastAt, completeness, tags };
      });
    },

    /** 人物卡：一句话 + 分节 + 每节证据 */
    card({ personId } = {}) {
      return cardOf(personId);
    },

    /** 注入预览：分节 + 预算裁剪；敏感项永不注入 */
    inject({ personId, maxChars = 6000 } = {}) {
      const card = cardOf(personId);
      const budget = Math.max(400, Number(maxChars) || 6000);
      const head = [`## ${card.person.name}${card.person.relation ? `（${card.person.relation}）` : ""}`];
      if (card.oneLiner) head.push(`- 一句话：${card.oneLiner}`);
      // 优先级：处事方式 > 性格 > 说话风格 > 基本信息 > 事实；敏感项永不进
      const order = ["behavior", "character", "voice", "basic", "facts"];
      const lines = [];
      let dropped = 0;
      const push = (text) => {
        const next = [...head, ...lines, text].join("\n");
        if (next.length > budget) { dropped += 1; return; }
        lines.push(text);
      };
      for (const id of order) {
        const sec = card.sections.find((s) => s.id === id);
        if (!sec) continue;
        push(`### ${sec.title}`);
        for (const row of sec.rows) {
          if (row.field === "voice") {
            const sample = row.evidence[0]?.quote;
            if (sample) push(`- 语气样本：「${sample.slice(0, 60)}」`);
            continue;
          }
          if (row.field === "style") {
            push(`- 说话习惯：${[...new Set(row.values)].slice(0, 4).join(" / ")}`);
            continue;
          }
          const tail = row.support >= 4 ? "" : `（依据 ${row.support} 条${row.support < 2 ? "，置信低" : ""}）`;
          const value = [...new Set(row.values)].slice(0, 2).join(" / ");
          push(`- ${row.label}：${value}${tail}`);
        }
      }
      for (const n of card.network.slice(0, 4)) push(`- 关系：${n.name}${n.type ? `（${n.type}）` : ""}`);
      if (card.counts.sensitive) push(`- 禁区：${card.counts.sensitive} 条敏感事实，已排除`);
      const markdown = [...head, ...lines].join("\n");
      return { markdown, chars: markdown.length, budget, dropped };
    },

    /** 变化与矛盾：同字段值变化 + 冲突；给右栏「漂移」用 */
    drift({ personId, limit = 8 } = {}) {
      const obs = rows("SELECT * FROM observations WHERE person_id=? AND status='confirmed'", [personId]).map(obsRow);
      const byField = {};
      for (const o of obs) (byField[o.field] ||= []).push(o);
      const out = [];
      for (const [field, list] of Object.entries(byField)) {
        if (!SINGLE_VALUED.includes(field)) continue;
        const sorted = [...list].sort((a, b) => (a.validFrom || a.createdAt) - (b.validFrom || b.createdAt));
        const from = sorted[0];
        const to = sorted[sorted.length - 1];
        if (sorted.length >= 2 && from.value !== to.value) {
          out.push({ kind: "drift", field, label: FIELD_LABEL[field] || field, from: from.value, to: to.value, at: to.validFrom || to.createdAt });
        }
        const bad = [...sorted].reverse().find((o) => o.conflict);
        if (bad) out.push({ kind: "conflict", field, label: FIELD_LABEL[field] || field, value: bad.value, note: bad.conflict, at: bad.updatedAt || bad.createdAt });
      }
      return out.sort((a, b) => b.at - a.at).slice(0, limit);
    },

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
          f.at || null, null, BASE_CONFIDENCE[f.field] ?? 0.55, kind, `${id}:${messages.indexOf(messages.find((m) => m.text === f.quote))}`, f.quote,
          "pending", f.sensitive ? 1 : 0, null, Date.now(), Date.now(),
        ]);
        added += 1;
        if (f.relationTo && person) {
          run("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)", [uid("r"), person.id, "__self__", f.value, 0.6, "affects", id, "pending", Date.now()]);
        }
      }
      return { deduped: false, importId: id, format: fmt, messages: messages.length, people: new Set(messages.map((m) => m.speaker)).size, added };
    },

    /** LLM 分析缓存：同一份样本不重复花钱 */
    analysisCache({ personId } = {}) { return metaGet(`llm:${personId}`); },
    setAnalysisCache({ personId, hash } = {}) { metaSet(`llm:${personId}`, hash); return true; },

    /** 写「一句话概括」（LLM 生成时用；空则回落到事实拼装） */
    setOneLiner({ personId, text } = {}) {
      const value = String(text || "").trim().slice(0, 200);
      run("UPDATE people SET one_liner=?, updated_at=? WHERE id=?", [value || null, Date.now(), personId]);
      return personRow(one("SELECT * FROM people WHERE id=?", [personId]));
    },

    /** 建模写入用：按 (person, field, value) 去重，默认 pending */
    addObservation({ personId, person, field, value, quote = "", sourceKind = "model", sourceRef = "", status = "pending", confidence = 0.7 } = {}) {
      const text = String(value || "").trim();
      if (!personId || !field || !text) return null;
      const dup = one("SELECT id FROM observations WHERE person_id=? AND field=? AND value=?", [personId, field, text]);
      if (dup) return null;
      const id = uid("o");
      const at = Date.now();
      run("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        id, personId, person || "", field, text, null, null, confidence,
        sourceKind, sourceRef || null, String(quote || "").slice(0, 240),
        status, 0, null, at, at,
      ]);
      return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
    },

    /** 批量确认/拒绝：按来源筛选（如把某次 AI 建模的 pending 一次确认） */
    bulkResolve({ sourceKind, accept = true, since = 0, limit = 500 } = {}) {
      const params = [];
      let sql = "SELECT id FROM observations WHERE status='pending'";
      if (sourceKind) { sql += " AND source_kind=?"; params.push(sourceKind); }
      if (since) { sql += " AND created_at>=?"; params.push(Number(since)); }
      sql += " LIMIT ?"; params.push(limit);
      const ids = rows(sql, params).map((r) => r.id);
      for (const id of ids) { try { this.resolve({ id, accept }); } catch { /* ignore */ } }
      return { resolved: ids.length, accept };
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
      const groups = rows("SELECT person_id, field, COUNT(DISTINCT value) n FROM observations WHERE status='confirmed' GROUP BY person_id, field HAVING n > 1")
        .filter((g) => SINGLE_VALUED.includes(g.field));
      for (const g of groups) {
        const list = rows("SELECT * FROM observations WHERE person_id=? AND field=? AND status='confirmed' ORDER BY COALESCE(valid_from, created_at) DESC", [g.person_id, g.field]).map(obsRow);
        if (list.length < 2) continue;
        run("UPDATE observations SET conflict=? WHERE id=?", [`与「${list[1].value}」不一致`, list[0].id]);
      }
      return groups.length;
    },

    people({ includeGroup = true } = {}) {
      return rows("SELECT * FROM people ORDER BY is_self DESC, COALESCE(created_at, 0) DESC, name").map(personRow)
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
      const others = rows("SELECT * FROM people WHERE is_self=0 ORDER BY COALESCE(created_at, 0) DESC, name").map(personRow);
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
        // 处置类字段正是「他会怎么反应」的依据，不能只读立场/偏好/约束
        const reactFields = ["decision", "conflict", "stress", "commitment", "communication", "value", "traits", "stance", "preference", "constraint"];
        const related = person
          ? facts.filter((f) => f.personId === person.id && reactFields.includes(f.field))
          : facts.filter((f) => (f.field === "stance" || f.field === "decision" || f.field === "conflict") && hit(f.value));
        for (const f of related.slice(0, 8)) {
          lines.push(`- ${f.person || nameOf(f.personId)} 的${FIELD_LABEL[f.field] || f.field}：${f.value}`);
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

    /** 删除前快照（用于撤销） */
    snapshotPerson({ personId } = {}) {
      return {
        person: personRow(one("SELECT * FROM people WHERE id=?", [personId])),
        observations: rows("SELECT * FROM observations WHERE person_id=?", [personId]).map(obsRow),
        relations: rows("SELECT * FROM relations WHERE from_id=? OR to_id=?", [personId, personId]).map((r) => ({ ...r })),
      };
    },
    /** 撤销删除：把人、观察、关系写回去 */
    restoreSnapshot({ snapshot } = {}) {
      if (!snapshot?.person?.id) throw new Error("快照无效");
      const p = snapshot.person;
      if (!one("SELECT id FROM people WHERE id=?", [p.id])) {
        run("INSERT INTO people(id,name,aliases,relation,strength,direction,group_only,is_self,created_at,updated_at,one_liner) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
          p.id, p.name, JSON.stringify(p.aliases || []), p.relation || "", p.strength ?? 0.5, p.direction || "",
          p.groupOnly ? 1 : 0, p.isSelf ? 1 : 0, p.createdAt || Date.now(), Date.now(), p.oneLiner || null,
        ]);
      }
      let restored = 0;
      for (const o of snapshot.observations || []) {
        if (one("SELECT id FROM observations WHERE id=?", [o.id])) continue;
        run("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
          o.id, o.personId, o.person, o.field, o.value, o.validFrom ?? null, o.validTo ?? null,
          o.confidence ?? 0.6, o.sourceKind || "manual", o.sourceRef || null, o.quote || "",
          o.status || "confirmed", o.sensitive ? 1 : 0, o.conflict || null, o.createdAt || Date.now(), o.updatedAt || Date.now(),
        ]);
        restored += 1;
      }
      for (const r of snapshot.relations || []) {
        if (one("SELECT id FROM relations WHERE id=?", [r.id])) continue;
        run("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)", [r.id, r.from_id, r.to_id, r.type, r.strength, r.direction, r.source_ref, r.status, r.created_at]);
      }
      return { restored };
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
      // 按人删除时，人物实体与关系边也要一起清掉，否则列表里会留下 0 条观察的空壳
      if (personId && !from && !to && !sourcePrefix) {
        run("DELETE FROM relations WHERE from_id=? OR to_id=?", [personId, personId]);
        run("DELETE FROM people WHERE id=?", [personId]);
        run("DELETE FROM meta WHERE k=?", [`llm:${personId}`]);
      }
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
