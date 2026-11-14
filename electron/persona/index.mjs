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

/**
 * 衰减半衰期（天）：说话的细节忘得快，身份和价值观忘得慢。
 * decay 只降权重、不删数据 —— 画像要能回查「当时为什么这么写」。
 */
export const HALF_LIFE = {
  event: 7, commitment: 21, constraint: 45, situation: 30,
  style: 60, voice: 60, communication: 120, traits: 180, capability: 180,
  goal: 240, stance: 240, decision: 365, conflict: 365, stress: 365, preference: 365,
  identity: 730, role: 365, value: 730, taboo: 730, relation: 730,
};
/**
 * 到期即失效（不是衰减）：这几类观察说的是「某段时间内成立」，过期就该进复核队列。
 * 与 decay 的区别：decay 是权重慢慢降，TTL 是到点直接不再当现在的事实用。
 */
export const TTL_DAYS = { event: 45, commitment: 90, constraint: 90 };

const DAY = 86400000;
const SECTION_OF = Object.entries(FIELD_GROUPS).reduce((acc, [sec, list]) => { for (const f of list) acc[f] = sec; return acc; }, {});
const FIELD_PRIORITY = { behavior: 1, character: 0.92, basic: 0.8, voice: 0.62, facts: 0.5 };
/**
 * 检索上限（evict）：多值字段在人物卡里只展示 heat 最高的 N 条。
 * 其余**留在库里当证据**（不改状态、不进复核队列），热度回升就能再上来 ——
 * 把「不在图上显示」当成「删掉 / 归档」会让复核队列被几百条旧语气样本湮没。
 */
export const FIELD_CAP = {
  voice: 3, style: 8, traits: 12, capability: 8, preference: 8, constraint: 8, stance: 8,
  event: 10, communication: 8, decision: 6, conflict: 6, stress: 4, commitment: 4,
};
/** 注入预算的分配：处事方式最该保住，事实类只做补充 */
const SECTION_QUOTA = { behavior: 0.4, character: 0.3, voice: 0.15, basic: 0.1, facts: 0.05 };

/** 值归一化：合并/去重要先把全半角、空格、标点抹平 */
export function normalizeValue(v) {
  return String(v || "")
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .replace(/[，。、；：！？,.;:!?"'“”‘’（）()【】\[\]]/g, "")
    .toLowerCase();
}

function bigrams(text) {
  const t = normalizeValue(text);
  const out = new Set();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

/** 相似度（bigram Jaccard）：只用来「给建议」，不自动合并 */
export function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const REL_TIME = [
  [/大后天/, 3], [/后天/, 2], [/明天/, 1],
  [/本周|这周|周内/, 7], [/下周|下个?星期/, 14], [/月底/, 31], [/下个?月/, 45],
  [/今年内?底|年底/, 120], [/今年/, 180], [/明年/, 540],
];

/**
 * 时间敏感事实的到期时间：先从原话里读「下周 / 月底 / 明年」，读不到用字段默认 TTL。
 * 返回 null = 不过期（身份、价值观这类长期事实）。
 */
export function inferExpiry(field, value, quote, at = Date.now()) {
  const ttl = TTL_DAYS[field];
  if (!ttl) return null;
  const text = `${value || ""} ${quote || ""}`;
  let days = ttl;
  for (const [re, d] of REL_TIME) if (re.test(text)) { days = Math.max(ttl, d); break; }
  return at + days * DAY;
}

/**
 * heat：读时算的权重，不落库。
 * confidence × 时间衰减 × 证据量 —— 一条被反复印证的事实会浮回来，一条孤证会沉下去。
 */
export function heatOf(o, now = Date.now()) {
  const half = HALF_LIFE[o.field] ?? 180;
  const base = o.lastSeenAt || o.validFrom || o.createdAt || now;
  const days = Math.max(0, (now - base) / DAY);
  const decay = Math.pow(0.5, days / half);
  const evidence = Math.log2(2 + (o.evidenceCount || 1));
  // 引用查不到原文的观察降权：它不是「错」，而是「没法核对」，位置要往后放
  const trust = o.quoteVerified === false ? 0.6 : 1;
  return Math.round((o.confidence || 0.6) * decay * evidence * trust * 1000) / 1000;
}

const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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
-- 可观测特征：数得出来、随时可重算，不进记忆层（否则失效追不上重算）
CREATE TABLE IF NOT EXISTS measures (
  person_id TEXT, key TEXT, field TEXT, label TEXT, value TEXT, num REAL,
  prev_value TEXT, prev_num REAL, times INTEGER DEFAULT 0,
  computed_at INTEGER, changed_at INTEGER,
  PRIMARY KEY (person_id, key)
);
CREATE INDEX IF NOT EXISTS obs_status ON observations(status);
CREATE INDEX IF NOT EXISTS obs_person ON observations(person_id, field);
`;

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const J = (v, f) => { try { return v ? JSON.parse(v) : f; } catch { return f; } };
/** 新字段的默认置信度：说话风格最弱（单条消息就能触发） */
const BASE_CONFIDENCE = { style: 0.5, voice: 0.65, traits: 0.52, taboo: 0.55 };
/** 兼容老 persona.db：只加列，不重建（SQLite 没有 ADD COLUMN IF NOT EXISTS） */
function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
const hash = (text) => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36) + text.length.toString(36);
};

import { parseChatAuto, detectFormat } from "./chat-import.mjs";
import { computeFeatures, computeMeasures } from "./model.mjs";

/** 从各种导出文本里切出 (speaker, time, text) —— 兜底解析，格式适配见 chat-import.mjs */
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
  // 群聊 / 一对一的上下文：老库里没有，补列后旧观察视为未知（NULL）
  ensureColumn(db, "observations", "context", "TEXT");
  ensureColumn(db, "relations", "context", "TEXT");
  // 生命周期列：证据累积 / 上次被观察 / 并值 / 失效标记 / 到期 / 复核过
  ensureColumn(db, "observations", "evidence_count", "INTEGER DEFAULT 1");
  ensureColumn(db, "observations", "last_seen_at", "INTEGER");
  ensureColumn(db, "observations", "merged_into", "TEXT");
  ensureColumn(db, "observations", "stale", "INTEGER DEFAULT 0");
  ensureColumn(db, "observations", "expires_at", "INTEGER");
  ensureColumn(db, "observations", "review_at", "INTEGER");
  // 引用是否能在输入原文里核对上（0 = 模型给的「原文」查不到）
  ensureColumn(db, "observations", "quote_verified", "INTEGER DEFAULT 1");
  // 索引要在补列之后建，否则老库上 SCHEMA 会先拿不存在的 expires_at 报错
  try { db.exec("CREATE INDEX IF NOT EXISTS obs_expiry ON observations(expires_at)"); } catch { /* ignore */ }
  try { db.exec("ALTER TABLE people ADD COLUMN one_liner TEXT"); } catch { /* 已存在 */ }
  try { db.exec("ALTER TABLE people ADD COLUMN one_liner_at INTEGER"); } catch { /* 已存在 */ }
  const rows = (sql, p = []) => db.prepare(sql).all(...p);
  const one = (sql, p = []) => db.prepare(sql).get(...p);
  const run = (sql, p = []) => db.prepare(sql).run(...p);

  const metaGet = (k) => { try { return one("SELECT v FROM meta WHERE k=?", [k])?.v || null; } catch { return null; } };
  const metaSet = (k, v) => run("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [k, String(v ?? "")]);

  const personRow = (r) => ({
    id: r.id, name: r.name, aliases: J(r.aliases, []), relation: r.relation,
    strength: r.strength, direction: r.direction, groupOnly: !!r.group_only,
    isSelf: !!r.is_self, createdAt: r.created_at, updatedAt: r.updated_at,
    oneLiner: r.one_liner || "", oneLinerAt: r.one_liner_at || null,
  });
  const obsRow = (r) => ({
    id: r.id, personId: r.person_id, person: r.person, field: r.field, value: r.value,
    validFrom: r.valid_from, validTo: r.valid_to, confidence: r.confidence,
    sourceKind: r.source_kind, sourceRef: r.source_ref, quote: r.quote,
    status: r.status, sensitive: !!r.sensitive, conflict: r.conflict, context: r.context || null,
    evidenceCount: r.evidence_count || 1, lastSeenAt: r.last_seen_at || null,
    mergedInto: r.merged_into || null, stale: !!r.stale,
    expiresAt: r.expires_at || null, reviewAt: r.review_at || null,
    // 三态：true=核过；false=核不到；null=没有可用引用，谈不上核对
    quoteVerified: r.quote_verified === 0
      ? false
      : (String(r.quote || "").trim().length >= 6 && String(r.quote || "").trim() !== "(模型归纳)" ? true : null),
    createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const measureRow = (r) => ({
    key: r.key, field: r.field, label: r.label, value: r.value, num: r.num,
    prevValue: r.prev_value, prevNum: r.prev_num, times: r.times || 0,
    computedAt: r.computed_at, changedAt: r.changed_at,
  });
  /** 当前成立：没被并掉、没作废、没过期 */
  const isCurrent = (o, now = Date.now()) => !!o && !o.mergedInto && !o.stale && !o.validTo && !(o.expiresAt && o.expiresAt <= now);

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

  // ── 写入闸门 + 生命周期（invalidate / accumulate / decay / TTL / merge）──────

  /**
   * 单值字段的新旧收口：两个方向都处理。
   * ① 比我旧的收口到我生效的时刻；② 已有比我新的事实，我立刻收口。
   * 只做方向 ① 会在「先确认新的、再确认旧的」时把新旧关系写反。
   */
  function invalidateSiblings({ personId, field, id, from, at }) {
    run(`UPDATE observations SET valid_to=?, updated_at=?
         WHERE person_id IS ? AND field=? AND id!=? AND status='confirmed' AND merged_into IS NULL
           AND COALESCE(valid_from, created_at) < ?
           AND (valid_to IS NULL OR valid_to > ?)`, [from, at, personId || null, field, id, from, from]);
    const newer = one(
      `SELECT MIN(COALESCE(valid_from, created_at)) AS t FROM observations
       WHERE person_id IS ? AND field=? AND id!=? AND status='confirmed' AND merged_into IS NULL
         AND COALESCE(valid_from, created_at) > ?`,
      [personId || null, field, id, from],
    )?.t;
    if (newer && Number(newer) > from) run("UPDATE observations SET valid_to=?, updated_at=? WHERE id=?", [Number(newer), at, id]);
  }

  /**
   * 被拒绝过的事实：又独立观察到两次 / 距上次拒绝超过 120 天 → 复审一次。
   * 不是永久静音：人会变，拒绝只是一次判断，不是永久事实。
   */
  function reviewRejected(sig, at = Date.now()) {
    const row = one("SELECT * FROM rejects WHERE sig=?", [sig]);
    if (!row) return null;
    const seen = row.times || 1;
    run("UPDATE rejects SET times=?, at=? WHERE sig=?", [seen + 1, at, sig]);
    // 第一次再观察到只计数（不打扰），第二次才复审
    return { times: seen + 1, reviewable: seen >= 2 || at - (row.at || 0) > 120 * DAY };
  }

  /**
   * 唯一写入入口：规则抽取 / 统计 / 模型 / 人工全部走这里。
   *  - 同一事实再次被观察 → 累加 evidence_count（去重不等于“第二条证据没用”）
   *  - 单值字段确认 → 立刻收口同字段旧值（invalidate）
   *  - 时间敏感事实 → 写 expires_at（TTL），到期不再当“现在”
   *  - 被拒绝过 → 第二次观察才复审，不永久静音
   */
  function commit({ personId, person = "", field, value, quote = "", sourceKind = "manual", sourceRef = "", status = "pending", confidence, sensitive = false, context = null, at = null, review = false, quoteVerified = true } = {}) {
    const text = String(value || "").trim();
    if (!personId || !field || !text) return null;
    const now = Date.now();
    const conf = Number.isFinite(confidence) ? confidence : (BASE_CONFIDENCE[field] ?? 0.55);
    const expiresAt = inferExpiry(field, text, quote, at || now);
    const dup = one(
      "SELECT * FROM observations WHERE person_id=? AND field=? AND value=? AND status!='rejected' AND merged_into IS NULL",
      [personId, field, text],
    );
    if (dup) {
      // 证据累积：confidence 每次 +0.03（封顶 0.95），last_seen_at 推进，到期时间顺延
      const next = Math.min(0.95, (dup.confidence || conf) + 0.03);
      const upgraded = status === "confirmed" && dup.status === "pending" ? "confirmed" : dup.status;
      run(`UPDATE observations
             SET evidence_count=COALESCE(evidence_count,1)+1, last_seen_at=?, confidence=?,
                 status=?, stale=0, quote_verified=CASE WHEN ? THEN 1 ELSE quote_verified END,
                 expires_at=CASE WHEN ? IS NULL THEN expires_at ELSE ? END,
                 updated_at=?
           WHERE id=?`, [now, next, upgraded, quoteVerified ? 1 : 0, expiresAt, expiresAt, now, dup.id]);
      const cur = one("SELECT * FROM observations WHERE id=?", [dup.id]);
      if (upgraded === "confirmed" && SINGLE_VALUED.includes(field)) {
        const from = cur.valid_from || cur.created_at || now;
        run("UPDATE observations SET valid_from=? WHERE id=?", [from, dup.id]);
        invalidateSiblings({ personId, field, id: dup.id, from, at: now });
      }
      return obsRow(cur);
    }

    const sig = `${personId}:${field}:${text}`;
    const rej = reviewRejected(sig, now);
    if (rej && !rej.reviewable) return null;
    // 复审：进 pending 并由人再判一次，review_at 留痕
    const finalStatus = rej ? "pending" : status;
    const id = uid("o");
    run(`INSERT INTO observations
         (id, person_id, person, field, value, valid_from, valid_to, confidence, evidence_count,
          source_kind, source_ref, quote, status, sensitive, conflict, created_at, updated_at, context,
          last_seen_at, expires_at, stale, review_at, quote_verified)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      id, personId, person || "", field, text, at || null, null, conf, 1,
      sourceKind, sourceRef || null, String(quote || "").slice(0, 240), finalStatus, sensitive ? 1 : 0, null,
      now, now, context, now, expiresAt, 0, review || rej ? now : null, quoteVerified ? 1 : 0,
    ]);
    if (finalStatus === "confirmed" && SINGLE_VALUED.includes(field)) {
      run("UPDATE observations SET valid_from=COALESCE(valid_from, created_at) WHERE id=?", [id]);
      const from = one("SELECT * FROM observations WHERE id=?", [id]).valid_from || now;
      invalidateSiblings({ personId, field, id, from, at: now });
    }
    return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
  }

  /** 可观测特征写入：只留最新值 + 上一次值（趋势），不进记忆层 */
  function setMeasure({ personId, key, field = "", label = "", value = "", short = "", num = null, at = Date.now() } = {}) {
    const text = String(value || "").trim();
    if (!personId || !key || !text) return null;
    const prev = one("SELECT * FROM measures WHERE person_id=? AND key=?", [personId, key]);
    if (prev) {
      const changed = String(prev.value) !== text;
      run(`UPDATE measures SET field=?, label=?, prev_value=?, prev_num=?, value=?, num=?,
             times=?, changed_at=?, computed_at=? WHERE person_id=? AND key=?`,
      [field || prev.field, label || prev.label, prev.value, prev.num, text, num,
        changed ? (prev.times || 0) + 1 : (prev.times || 0), changed ? at : prev.changed_at, at, personId, key]);
    } else {
      run(`INSERT INTO measures (person_id,key,field,label,value,num,prev_value,prev_num,times,computed_at,changed_at)
           VALUES (?,?,?,?,?,?,NULL,NULL,0,?,?)`, [personId, key, field, label, text, num, at, at]);
    }
    void short;
    return measureRow(one("SELECT * FROM measures WHERE person_id=? AND key=?", [personId, key]));
  }

  const measuresOf = (personId) => rows("SELECT * FROM measures WHERE person_id=? ORDER BY key", [personId]).map(measureRow);

  /** 到期扫描：只标记 stale，不删任何东西（可审计、可回查） */
  function sweep({ at = Date.now() } = {}) {
    const expired = rows(
      `SELECT id FROM observations
       WHERE status='confirmed' AND merged_into IS NULL AND valid_to IS NULL
         AND COALESCE(stale,0)=0 AND expires_at IS NOT NULL AND expires_at <= ?`, [at]);
    for (const r of expired) run("UPDATE observations SET stale=1, updated_at=? WHERE id=?", [at, r.id]);
    const revived = rows(
      `SELECT id FROM observations
       WHERE status='confirmed' AND merged_into IS NULL AND COALESCE(stale,0)=1
         AND expires_at IS NOT NULL AND expires_at > ?`, [at]);
    for (const r of revived) run("UPDATE observations SET stale=0, updated_at=? WHERE id=?", [at, r.id]);
    return { expired: expired.length, revived: revived.length };
  }

  /** 需要复核的事实：时间到期 / 已归档。给 UI 的「衰减与复核」用 */
  function reviewQueue({ personId = null, limit = 50, at = Date.now() } = {}) {
    const where = ["status='confirmed'", "merged_into IS NULL", "valid_to IS NULL",
      "(COALESCE(stale,0)=1 OR (expires_at IS NOT NULL AND expires_at <= ?))"];
    const params = [at];
    if (personId) { where.push("person_id=?"); params.push(personId); }
    return rows(`SELECT * FROM observations WHERE ${where.join(" AND ")} ORDER BY COALESCE(expires_at, last_seen_at, updated_at) ASC LIMIT ?`,
      [...params, Math.max(1, Math.min(500, Number(limit) || 50))])
      .map(obsRow)
      .map((o) => ({
        ...o, label: FIELD_LABEL[o.field] || o.field,
        heat: heatOf(o, at), reason: o.expiresAt && o.expiresAt <= at ? "时间到期" : "已归档",
      }));
  }

  /** 复核「仍然成立」：续期，不动 valid_to */
  function keepFact({ id } = {}) {
    const row = one("SELECT * FROM observations WHERE id=?", [id]);
    if (!row) throw new Error("观察不存在");
    const now = Date.now();
    run(`UPDATE observations SET stale=0, last_seen_at=?, expires_at=?, review_at=?, updated_at=? WHERE id=?`,
      [now, inferExpiry(row.field, row.value, row.quote, now), now, now, id]);
    return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
  }

  /** 复核「不再成立」：用 valid_to 收口（不是删除，历史仍可回查） */
  function dropFact({ id } = {}) {
    const row = one("SELECT * FROM observations WHERE id=?", [id]);
    if (!row) throw new Error("观察不存在");
    const now = Date.now();
    run("UPDATE observations SET valid_to=COALESCE(valid_to, ?), stale=1, review_at=?, updated_at=? WHERE id=?", [now, now, now, id]);
    return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
  }

  /** 批量复核：一次把某人的到期事实全部续期或全部收口 */
  function reviewResolveMany({ personId = null, keep = true, at = Date.now() } = {}) {
    const list = reviewQueue({ personId, limit: 500, at });
    for (const item of list) {
      try { if (keep) keepFact({ id: item.id }); else dropFact({ id: item.id }); } catch { /* 单条失败不影响其余 */ }
    }
    return { resolved: list.length, keep };
  }

  /** 近似值合并建议：只给建议，不自动合（「做游戏」与「做独立游戏」不是一回事） */
  function mergeSuggestions({ personId = null, threshold = 0.6, limit = 30 } = {}) {
    const base = "status='confirmed' AND merged_into IS NULL AND valid_to IS NULL AND COALESCE(stale,0)=0";
    const list = (personId
      ? rows(`SELECT * FROM observations WHERE ${base} AND person_id=?`, [personId])
      : rows(`SELECT * FROM observations WHERE ${base}`)).map(obsRow);
    const groups = new Map();
    for (const o of list) {
      if (SINGLE_VALUED.includes(o.field)) continue; // 单值字段走失效，不走合并
      const k = `${o.personId}|${o.field}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const out = [];
    for (const items of groups.values()) {
      if (items.length < 2) continue;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const score = similarity(items[i].value, items[j].value);
          if (score < threshold) continue;
          const first = (items[i].evidenceCount || 1) >= (items[j].evidenceCount || 1) ? items[i] : items[j];
          const second = first === items[i] ? items[j] : items[i];
          out.push({
            field: first.field, label: FIELD_LABEL[first.field] || first.field,
            personId: first.personId, person: first.person,
            keep: { id: first.id, value: first.value, evidence: first.evidenceCount || 1 },
            drop: { id: second.id, value: second.value, evidence: second.evidenceCount || 1 },
            score: Math.round(score * 100) / 100,
          });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function applyMergeValue({ keepId, dropId } = {}) {
    const keep = one("SELECT * FROM observations WHERE id=?", [keepId]);
    const drop = one("SELECT * FROM observations WHERE id=?", [dropId]);
    if (!keep || !drop || keep.id === drop.id) throw new Error("合并对象无效");
    if (keep.field !== drop.field) throw new Error("只能合并同字段的观察");
    const now = Date.now();
    run("UPDATE observations SET evidence_count=COALESCE(evidence_count,1)+?, last_seen_at=?, updated_at=? WHERE id=?",
      [drop.evidence_count || 1, now, now, keep.id]);
    run("UPDATE observations SET merged_into=?, status='merged', updated_at=? WHERE id=?", [keep.id, now, drop.id]);
    return obsRow(one("SELECT * FROM observations WHERE id=?", [keep.id]));
  }

  /**
   * 只合并归一化后完全相同的重复值（「收到」/「收到！」/「收到。 」）—— 这是安全子集。
   * 近似值一定要人确认：把「做游戏」并进「做独立游戏」是篡改画像，不是去重。
   */
  function mergeExactDuplicates({ personId = null } = {}) {
    const base = "status='confirmed' AND merged_into IS NULL";
    const list = (personId
      ? rows(`SELECT * FROM observations WHERE ${base} AND person_id=?`, [personId])
      : rows(`SELECT * FROM observations WHERE ${base}`)).map(obsRow);
    const groups = new Map();
    for (const o of list) {
      if (SINGLE_VALUED.includes(o.field)) continue;
      const k = `${o.personId}|${o.field}|${normalizeValue(o.value)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    let merged = 0;
    for (const items of groups.values()) {
      if (items.length < 2) continue;
      const sorted = [...items].sort((a, b) => (b.evidenceCount || 1) - (a.evidenceCount || 1));
      const [head, ...rest] = sorted;
      for (const drop of rest) { applyMergeValue({ keepId: head.id, dropId: drop.id }); merged += 1; }
    }
    return { merged };
  }

  /**
   * 人物卡：把「当前成立」的已确认观察整理成「一句话 + 分节 + 每节证据」。
   * 被收口的历史值、过期项、合并掉的重复值都不再算“现状”，但它们不会消失（回看/漂移里还在）。
   */
  function cardOf(personId, { at = null } = {}) {
    const now = Number(at) || Date.now();
    const person = personRow(one("SELECT * FROM people WHERE id=?", [personId]));
    if (!person) throw new Error("人物不存在");
    const all = rows(
      "SELECT * FROM observations WHERE person_id=? AND status='confirmed' AND merged_into IS NULL ORDER BY COALESCE(valid_from, created_at) DESC",
      [personId],
    ).map(obsRow);
    const current = all.filter((o) => isCurrent(o, now));
    const needsReview = all.filter((o) => !o.validTo && o.expiresAt && o.expiresAt <= now).map((o) => ({
      id: o.id, field: o.field, label: FIELD_LABEL[o.field] || o.field, value: o.value, quote: o.quote,
      reason: o.stale ? "已归档" : "时间到期", expiresAt: o.expiresAt, heat: heatOf(o, now),
    }));
    // 敏感项不进人设卡，也不进注入：只报数量，避免「默认不注入」变成一句空话
    const sensitive = current.filter((o) => o.sensitive).length;
    const safe = current.filter((o) => !o.sensitive).sort((a, b) => heatOf(b, now) - heatOf(a, now));
    const byField = {};
    for (const o of safe) (byField[o.field] ||= []).push(o);
    // support 是「证据次数」，不是「不同值的条数」：同一事实被观察到 5 次就是 5 条依据
    const support = (f) => (byField[f] || []).reduce((n, o) => n + (o.evidenceCount || 1), 0);
    const rowOf = (f) => {
      const list = byField[f] || [];
      const cap = FIELD_CAP[f] ?? list.length;
      const shown = list.slice(0, cap);
      return {
        field: f, label: FIELD_LABEL[f] || f,
        values: shown.map((o) => o.value),
        support: support(f), level: levelOf(support(f)),
        total: list.length, overflow: Math.max(0, list.length - shown.length),
        heat: Math.round((shown.reduce((n, o) => n + heatOf(o, now), 0) / (shown.length || 1)) * 100) / 100,
        conflict: (shown.find((o) => o.conflict) || list.find((o) => o.conflict))?.conflict || null,
        evidence: shown.slice(0, 6).map((o) => ({
          id: o.id, value: o.value, quote: o.quote, sourceKind: o.sourceKind,
          sourceRef: o.sourceRef, at: o.validFrom || o.createdAt, confidence: o.confidence, conflict: o.conflict,
          evidenceCount: o.evidenceCount || 1, lastSeenAt: o.lastSeenAt || null, heat: heatOf(o, now),
          verified: o.quoteVerified,
        })),
      };
    };
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
      // 群聊里出现的关系强度已经压到 0.3，这里再标一次，让 UI 能分开显示
      context: r.context || null,
      groupOnly: r.context === "group",
    }));

    // 一句话概括：只用当前成立的已确认观察，不靠模型编
    const pick = (f) => (byField[f] || [])[0]?.value || "";
    const bits = [pick("traits"), pick("decision"), pick("conflict"), pick("communication"), pick("value"), pick("preference")].filter(Boolean);
    const autoOneLiner = bits.length ? `${[...new Set(bits)].slice(0, 3).join("；")}。` : "";
    const oneLiner = person.oneLiner || autoOneLiner;
    // 手写/模型生成的一句话不会自己更新：之后又有了新的事实或新的统计，就提示它可能需要重写。
    // 看 createdAt / lastSeenAt 而不是 updatedAt —— 确认待确认事实也会刷 updatedAt，那不是「新结论」。
    const oneLinerAt = person.oneLiner ? (person.oneLinerAt || person.updatedAt || null) : null;
    const newestFactAt = Math.max(
      0,
      ...safe.map((o) => Math.max(o.createdAt || 0, o.lastSeenAt || 0)),
      ...measuresOf(person.id).map((m) => m.computedAt || 0),
    );
    const oneLinerStale = Boolean(oneLinerAt) && newestFactAt > oneLinerAt;

    const measureList = measuresOf(person.id);
    const measureFields = new Set(measureList.map((m) => m.field).filter((f) => CARD_FIELDS.includes(f)));
    const covered = CARD_FIELDS.filter((f) => support(f) > 0);
    const measureOnly = [...measureFields].filter((f) => !covered.includes(f)).length;
    // 可观测特征算半个字段：只跑统计的人能到 ~40%，但绝不会因为「聊得多」就满格
    const completeness = Math.min(100, Math.round(((covered.length + measureOnly * 0.5) / CARD_FIELDS.length) * 100) + Math.min(8, Math.floor(safe.length / 6)));
    const pending = one("SELECT COUNT(*) n FROM observations WHERE person_id=? AND status='pending'", [person.id]).n;
    const perFieldSupport = Object.values(byField).map((list) => list.reduce((n, o) => n + (o.evidenceCount || 1), 0));
    const overflow = sections.reduce((n, s) => n + s.rows.reduce((m, r) => m + (r.overflow || 0), 0), 0);

    return {
      person, sections, network, oneLiner, oneLinerAt, oneLinerStale, completeness,
      measures: measureList,
      needsReview,
      metrics: {
        supportMedian: median(perFieldSupport),
        conflictRatio: safe.length ? Math.round((safe.filter((o) => o.conflict).length / safe.length) * 100) : 0,
        needsReview: needsReview.length,
        unverified: safe.filter((o) => o.quoteVerified === false).length,
        overflow,
        measureAt: measureList.reduce((m, x) => Math.max(m, x.computedAt || 0), 0),
      },
      counts: { confirmed: safe.length, pending, sensitive, fields: covered.length, measureFields: measureFields.size, total: CARD_FIELDS.length },
      empty: all.length === 0 && measureList.length === 0,
    };
  }

  return {
    dir,
    fields: FIELDS,
    fieldGroups: FIELD_GROUPS,

    /** 左栏列表：带已确认 / 待确认 / 待复核计数与人设卡完整度 */
    peopleList() {
      const now = Date.now();
      // 按 created_at 排，不按 updated_at：建模 / 改写一句话会刷 updated_at，
      // 用它排序会让「刚操作过的人」在左栏里跳到最前面。
      return rows("SELECT * FROM people WHERE is_self=1 OR EXISTS (SELECT 1 FROM observations o WHERE o.person_id = people.id) ORDER BY is_self DESC, COALESCE(created_at, 0) DESC, name").map(personRow).map((p) => {
        // 列表只统计「当前成立」的事实：被收口的历史值算历史，不算现状
        const live = rows(
          "SELECT * FROM observations WHERE person_id=? AND status='confirmed' AND merged_into IS NULL AND valid_to IS NULL",
          [p.id],
        ).map(obsRow).filter((o) => isCurrent(o, now));
        const covered = new Set(live.map((o) => o.field).filter((f) => CARD_FIELDS.includes(f)));
        const measureList = measuresOf(p.id);
        const measureFields = new Set(measureList.map((m) => m.field).filter((f) => CARD_FIELDS.includes(f)));
        const measureOnly = [...measureFields].filter((f) => !covered.has(f)).length;
        const confirmed = live.filter((o) => !o.sensitive).length;
        const pending = one("SELECT COUNT(*) n FROM observations WHERE person_id=? AND status='pending'", [p.id]).n;
        const review = one(
          `SELECT COUNT(*) n FROM observations
           WHERE person_id=? AND status='confirmed' AND merged_into IS NULL AND valid_to IS NULL
             AND (COALESCE(stale,0)=1 OR (expires_at IS NOT NULL AND expires_at <= ?))`, [p.id, now],
        ).n;
        const lastAt = Math.max(
          one("SELECT MAX(updated_at) t FROM observations WHERE person_id=?", [p.id]).t || 0,
          one("SELECT MAX(computed_at) t FROM measures WHERE person_id=?", [p.id]).t || 0,
        ) || p.updatedAt;
        const completeness = Math.min(100, Math.round(((covered.size + measureOnly * 0.5) / CARD_FIELDS.length) * 100) + Math.min(8, Math.floor(confirmed / 6)));

        // 标签：一眼看出「建模过什么、是什么类型的人」。统计类的特征来自 measures，不再从观察里找
        const tags = [];
        const has = (field, re) => live.some((o) => o.field === field && re.test(o.value));
        const hasMeasure = (re) => measureList.some((m) => re.test(m.value));
        if (review > 0) tags.push("待复核");
        if (live.some((o) => o.sourceKind === "llm") || p.oneLiner) tags.push("已建模");
        if (completeness >= 50) tags.push("人设卡");
        if (has("role", /营销|官方|客服|公众号|运营/) || /营销号|官方号|公众号/.test(p.oneLiner || "")) tags.push("营销/官方");
        else if (has("role", /技术|开发|工程师|程序|研发/) || has("identity", /技术|开发|工程师|研发/)) tags.push("技术");
        if (hasMeasure(/话多/)) tags.push("话多");
        else if (hasMeasure(/话少/)) tags.push("话少");
        if (hasMeasure(/回复很快/) || has("communication", /回复(很快|极快)/)) tags.push("秒回");
        if (hasMeasure(/私聊 100%/)) tags.push("私聊为主");
        if (hasMeasure(/群聊 100%/)) tags.push("群聊为主");
        if (p.groupOnly) tags.push("仅群聊");
        if (rows("SELECT 1 FROM observations WHERE person_id=? AND sensitive=1 LIMIT 1", [p.id]).length) tags.push("敏感");

        const perField = new Map();
        for (const o of live) perField.set(o.field, (perField.get(o.field) || 0) + (o.evidenceCount || 1));
        return {
          ...p, confirmed, pending, review, lastAt, completeness, tags,
          supportMedian: median([...perField.values()]),
          measureFields: measureFields.size,
        };
      });
    },

    /** 人物卡：一句话 + 分节 + 每节证据 + 可观测特征 + 待复核 */
    card({ personId } = {}) {
      return cardOf(personId);
    },

    /**
     * 算好的特征写进 measures（导入 / 建模 / 回填脚本共用这一条路径）。
     * 只传 features，不传卡片：可观测特征永远是「重算」出来的，不接受手写。
     */
    applyStats({ personId, features, at = Date.now() } = {}) {
      if (!personId || !features) return 0;
      let n = 0;
      for (const m of computeMeasures(features)) {
        if (setMeasure({ personId, key: m.key, field: m.field, label: m.label, value: m.value, short: m.short, num: m.num, at })) n += 1;
      }
      return n;
    },

    /** 可观测特征（measure）：数得出来、重算即可，不进记忆层 */
    setMeasure(args = {}) { return setMeasure(args); },
    measures({ personId } = {}) { return measuresOf(personId); },
    /** 衰减扫描 / 复核队列 / 合并建议 */
    sweep(args = {}) { return sweep(args); },
    review(args = {}) { return reviewQueue(args); },
    keepFact({ id } = {}) { return keepFact({ id }); },
    dropFact({ id } = {}) { return dropFact({ id }); },
    reviewMany(args = {}) { return reviewResolveMany(args); },
    mergeSuggestions(args = {}) { return mergeSuggestions(args); },
    applyMergeValue({ keepId, dropId } = {}) { return applyMergeValue({ keepId, dropId }); },
    commit(args = {}) { return commit(args); },

    /**
     * 注入预览：不是「按固定字段顺序截到预算」，而是按热度 × 相关性打分填预算。
     * 每节有配额上限，否则说话风格样本会把整个预算吃光（库里 73% 是 voice/style）。
     */
    inject({ personId, maxChars = 6000, query = "", at = null } = {}) {
      const now = Number(at) || Date.now();
      const card = cardOf(personId, { at: at ? now : null });
      const budget = Math.max(400, Number(maxChars) || 6000);
      const head = [`## ${card.person.name}${card.person.relation ? `（${card.person.relation}）` : ""}`];
      if (at) head.push(`- 以下事实截至 ${new Date(now).toISOString().slice(0, 10)}，更早的说法可能已不成立`);
      if (card.oneLiner) head.push(`- 一句话：${card.oneLiner}`);

      // 相关性：中文没有空格，切 2-gram（与 ask 同一套）；没给 query 就等权
      const terms = [];
      for (const w of String(query || "").split(/[，。？！、\s,?]+/).filter((t) => t.length >= 2)) {
        terms.push(w);
        if (/[\u3400-\u9fff]/.test(w)) for (let i = 0; i < w.length - 1; i += 1) terms.push(w.slice(i, i + 2));
      }
      const relevance = (row) => {
        if (!terms.length) return 1;
        const text = `${row.label} ${row.values.join(" ")} ${row.evidence.map((e) => e.quote).join(" ")}`;
        let hit = 0;
        for (const t of new Set(terms)) if (text.includes(t)) hit += 1;
        return 1 + hit;
      };

      const lineOf = (row) => {
        if (row.field === "voice") {
          const sample = row.evidence[0]?.quote;
          return sample ? `- 语气样本：「${sample.slice(0, 60)}」` : null;
        }
        if (row.field === "style") return `- 说话习惯：${[...new Set(row.values)].slice(0, 4).join(" / ")}`;
        const tail = row.support >= 4 ? "" : `（依据 ${row.support} 条${row.support < 2 ? "，置信低" : ""}）`;
        const value = [...new Set(row.values)].slice(0, 2).join(" / ");
        return `- ${row.label}：${value}${tail}`;
      };

      // 候选打分：字段优先级 × 热度（衰减后的权重）× 相关性
      const entries = [];
      for (const sec of card.sections) {
        for (const row of sec.rows) {
          const text = lineOf(row);
          if (!text) continue;
          entries.push({ sec: sec.id, row, text, score: (FIELD_PRIORITY[sec.id] ?? 0.5) * (0.4 + (row.heat || 0)) * relevance(row) });
        }
      }
      entries.sort((a, b) => b.score - a.score);

      const measureShort = card.measures
        .filter((m) => ["msgs.count", "reply.median", "len.median", "hours.active", "chat.ratio"].includes(m.key))
        .map((m) => m.value.replace(/^[^：]*：/, "").replace(/（[^）]*）/g, ""));
      const taken = [];
      const quotaChars = {};
      const capOf = (sec) => Math.round(budget * (SECTION_QUOTA[sec] ?? 0.1));
      const titleOf = (sec) => card.sections.find((s) => s.id === sec)?.title || sec;
      let chars = [...head, ...(measureShort.length ? [`- 可观测：${measureShort.join(" · ")}`] : [])].join("\n").length;
      const take = (e, strict) => {
        // 分节标题也算预算：只算条目长度会让结果超出上限
        const headerCost = quotaChars[e.sec] ? 0 : titleOf(e.sec).length + 5;
        if (chars + e.text.length + 1 + headerCost > budget) return false;
        if (strict && (quotaChars[e.sec] || 0) + e.text.length > capOf(e.sec)) return false;
        taken.push(e);
        quotaChars[e.sec] = (quotaChars[e.sec] || 0) + e.text.length;
        chars += e.text.length + 1 + headerCost;
        return true;
      };
      const chosen = new Set();
      for (const e of entries) if (take(e, true)) chosen.add(e);
      let dropped = 0;
      for (const e of entries) {
        if (chosen.has(e)) continue;
        if (take(e, false)) chosen.add(e); else dropped += 1;
      }

      // 按分节顺序排版：按分数交错读起来像碎句
      const lines = [];
      let used = [...head].join("\n").length;
      const append = (text) => {
        if (used + text.length + 1 > budget) return false;
        lines.push(text); used += text.length + 1;
        return true;
      };
      if (measureShort.length) append(`- 可观测：${measureShort.join(" · ")}`);
      let tailDropped = 0;
      for (const sid of ["behavior", "character", "voice", "basic", "facts"]) {
        const secTokens = taken.filter((e) => e.sec === sid);
        if (!secTokens.length) continue;
        if (!append(`### ${titleOf(sid)}`)) continue;
        for (const e of secTokens) if (!append(e.text)) tailDropped += 1;
      }
      for (const n of card.network.slice(0, 4)) {
        if (!append(`- 关系：${n.name}${n.type ? `（${n.type}）` : ""}`)) tailDropped += 1;
      }
      if (card.counts.sensitive) append(`- 禁区：${card.counts.sensitive} 条敏感事实，已排除`);
      if (card.needsReview.length) append(`- 待复核：${card.needsReview.length} 条已过期，未注入`);

      const markdown = [...head, ...lines].join("\n");
      return { markdown, chars: markdown.length, budget, dropped: dropped + tailDropped, sections: quotaChars, asOf: at ? now : null };
    },

    /**
     * 任务里点名的人：只在这几个人的名字原样出现在任务文本里时，才返回他们的画像片段。
     * 不做「把所有人都塞进上下文」—— 那是隐私事故 + 预算黑洞；点名就用，没点名就不出现。
     */
    injectForText({ text = "", maxChars = 600, limit = 3 } = {}) {
      const q = String(text || "");
      if (!q.trim()) return { markdown: "", people: [], chars: 0 };
      const named = rows("SELECT * FROM people WHERE is_self=0 ORDER BY COALESCE(created_at, 0) DESC").map(personRow)
        // 单字名（「我」「李」）命中率太高，宁可不注入；合并过的旧名字（aliases）也要能命中
        .filter((p) => [p.name, ...(p.aliases || [])].some((n) => n && n.length >= 2 && q.includes(n)))
        .slice(0, Math.max(1, Number(limit) || 3));
      const chunks = [];
      const used = [];
      for (const p of named) {
        try {
          const res = this.inject({ personId: p.id, maxChars, query: q });
          if (res.markdown.trim()) { chunks.push(res.markdown); used.push(p.name); }
        } catch { /* 单人失败不影响其它人 */ }
      }
      const markdown = chunks.join("\n\n");
      return { markdown, people: used, chars: markdown.length };
    },

    /** 变化与矛盾：同字段值变化 + 冲突；给右栏「漂移」用 */
    /**
     * 变化与矛盾：三种要分开看的东西。
     *  - drift：单值字段被新说法取代（事实变了，旧值标 valid_to）
     *  - conflict：两条同时成立，时间解释不了
     *  - trend：可观测特征变了（同一个人不同阶段的测量值，不是矛盾）
     * 把 trend 混进 conflict 会让人把「换了工作」和「数据重算后数值变了」当成同一回事。
     */
    drift({ personId, limit = 8 } = {}) {
      const obs = rows("SELECT * FROM observations WHERE person_id=? AND status='confirmed' AND merged_into IS NULL", [personId]).map(obsRow);
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
      // 特征变化也进这个视图：否则「上次 42 分钟 → 现在 4 分钟」只藏在卡片里一行小字
      for (const m of rows("SELECT * FROM measures WHERE person_id=? AND times > 0 AND prev_value IS NOT NULL", [personId])) {
        out.push({
          kind: "trend", field: m.field, label: m.label || m.key,
          from: m.prev_value, to: m.value, at: m.changed_at || m.computed_at,
          key: m.key, times: m.times || 1,
        });
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
      const parsed = parseChatAuto(raw, { format, fallback: (t) => parseChat(t, { format, selfName }) });
      const messages = (parsed.messages || []).filter((m) => m && m.speaker && m.text);
      const fmt = parsed.format || detectFormat(raw);
      if (!messages.length) throw new Error("没有解析出任何发言");
      const id = uid("i");
      run("INSERT INTO imports VALUES (?,?,?,?,?,?,?)", [id, kind, title.slice(0, 120), h, messages.length, selfName || null, Date.now()]);
      if (selfName) upsertPerson(selfName, { isSelf: true });
      // 上下文优先用导出里声明的会话类型（Telegram/飞书都有），否则按发言人数判断
      const speakers = new Set(messages.map((m) => m.speaker));
      const context = parsed.chatType || (speakers.size > 2 ? "group" : "direct");
      const isGroup = context === "group";
      const facts = extractFacts(messages, { selfName });
      let added = 0;
      let reviewed = 0;
      for (const f of facts) {
        const person = f.speaker === "__self__" ? upsertPerson(selfName || "我", { isSelf: true }) : upsertPerson(f.speaker, { groupOnly: isGroup });
        // 走统一闸门：重复事实累加证据、被拒过的第二次观察才复审、时间敏感事实写 expires_at
        const wasRejected = one("SELECT times FROM rejects WHERE sig=?", [`${person?.id || f.speaker}:${f.field}:${f.value}`]);
        const row = commit({
          personId: person?.id || null, person: f.speaker === "__self__" ? "本人" : f.speaker,
          field: f.field, value: f.value, quote: f.quote, sourceKind: kind,
          sourceRef: `${id}:${messages.indexOf(messages.find((m) => m.text === f.quote))}`,
          status: "pending", sensitive: f.sensitive, context, at: f.at || null,
        });
        if (!row) continue;
        if (wasRejected) reviewed += 1;
        added += 1;
        if (f.relationTo && person) {
          // 群聊里的一句话不足以说明亲密关系：强度压到 0.3，并标注来源是群聊
          run(`INSERT INTO relations (id, from_id, to_id, type, strength, direction, source_ref, status, created_at, context)
               VALUES (?,?,?,?,?,?,?,?,?,?)`, [
            uid("r"), person.id, "__self__", f.value, isGroup ? 0.3 : 0.6, "affects", id, "pending", Date.now(), context,
          ]);
        }
      }
      // 统计特征（不花钱）：导入批里发言量够的人直接算出可观测特征，
      // 不用等「建模」——以前只有跑过模型的人才有特征，264 人里只有 13 人有。
      let statsUpdated = 0; // 写入的特征条数
      let statsPeople = 0;  // 参与计算的人数
      const bySpeaker = new Map();
      for (const m of messages) {
        const who = String(m.speaker || "").trim();
        if (!who || who === "unknown" || who === selfName) continue;
        if (!bySpeaker.has(who)) bySpeaker.set(who, []);
        // computeFeatures 用 chat 里是否含 "@chatroom" 判断群聊，沿用同一约定
        bySpeaker.get(who).push({ from: who, text: m.text, date: m.at ? new Date(m.at).toISOString() : "", chat: isGroup ? `${title}@chatroom` : title });
      }
      for (const [who, msgs] of bySpeaker) {
        if (msgs.length < 10) continue; // 样本太少算出来全是噪声
        const person = rows("SELECT * FROM people WHERE name=?", [who]).map(personRow)[0];
        if (!person) continue;
        const written = this.applyStats({ personId: person.id, features: computeFeatures(msgs, who, msgs) });
        if (written) { statsUpdated += written; statsPeople += 1; }
      }
      // group_only 的唯一含义：此人**只**在群聊里出现过；有过一对一的要立刻降级为 false
      run(`UPDATE people SET group_only = CASE
             WHEN EXISTS (SELECT 1 FROM observations o WHERE o.person_id = people.id AND o.context = 'direct' AND o.status != 'rejected') THEN 0
             ELSE group_only END`)
      return {
        deduped: false, importId: id, format: fmt, context,
        messages: messages.length, people: speakers.size, added, reviewed, statsUpdated, statsPeople,
        warnings: parsed.warnings || [],
      };
    },

    /** LLM 分析缓存：同一份样本不重复花钱 */
    analysisCache({ personId } = {}) { return metaGet(`llm:${personId}`); },
    setAnalysisCache({ personId, hash } = {}) { metaSet(`llm:${personId}`, hash); return true; },

    /** 写「一句话概括」（LLM 生成时用；空则回落到事实拼装） */
    setOneLiner({ personId, text } = {}) {
      const value = String(text || "").trim().slice(0, 200);
      run("UPDATE people SET one_liner=?, one_liner_at=?, updated_at=? WHERE id=?", [value || null, value ? Date.now() : null, Date.now(), personId]);
      return personRow(one("SELECT * FROM people WHERE id=?", [personId]));
    },

    /**
     * 建模/规则写入用：走统一闸门（commit）。
     * 同一事实重复观察到时**不丢**，而是累加 evidence_count —— 以前这里直接 return null，
     * 结果「50 次对话都印证过的一句话」和「模型一次猜测」在画像里强度完全一样。
     */
    addObservation({ personId, person, field, value, quote = "", sourceKind = "model", sourceRef = "", status = "pending", confidence = 0.7 } = {}) {
      return commit({ personId, person, field, value, quote, sourceKind, sourceRef, status, confidence });
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
    /** 确认 / 拒绝：拒绝留痕（第二次观察才复审）；无来源不能确认 */
    resolve({ id, accept = false, sensitive } = {}) {
      const obs = one("SELECT * FROM observations WHERE id=?", [id]);
      if (!obs) throw new Error("观察不存在");
      if (accept && !obs.source_ref && !obs.quote) throw new Error("没有来源的观察不能确认");
      const at = Date.now();
      run("UPDATE observations SET status=?, sensitive=?, updated_at=? WHERE id=?", [accept ? "confirmed" : "rejected", sensitive ? 1 : obs.sensitive, at, id]);
      // 单值字段：用 valid_to 表达「什么时候不再成立」。
      // 两个方向都在 invalidateSiblings 里处理：先确认新的再确认旧的也不会写反。
      if (accept && SINGLE_VALUED.includes(obs.field)) {
        run("UPDATE observations SET valid_from=COALESCE(valid_from, created_at) WHERE id=?", [id]);
        const from = one("SELECT * FROM observations WHERE id=?", [id]).valid_from || at;
        invalidateSiblings({ personId: obs.person_id, field: obs.field, id, from, at });
      }
      // 拒绝后把计数归零：下一次复审要重新攒「两次独立观察」，否则会变成反复打扰
      if (!accept) run("INSERT INTO rejects VALUES (?,?,1) ON CONFLICT(sig) DO UPDATE SET at=excluded.at, times=1", [`${obs.person_id || obs.person}:${obs.field}:${obs.value}`, Date.now()]);
      return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
    },
    /** 冲突检测：同人同字段不同值，且**同时有效** → 标 conflict，不静默覆盖 */
    detectConflicts() {
      const now = Date.now();
      let flagged = 0;
      const groups = rows("SELECT person_id, field, COUNT(DISTINCT value) n FROM observations WHERE status='confirmed' AND merged_into IS NULL GROUP BY person_id, field HAVING n > 1")
        .filter((g) => SINGLE_VALUED.includes(g.field));
      for (const g of groups) {
        const list = rows("SELECT * FROM observations WHERE person_id=? AND field=? AND status='confirmed' AND merged_into IS NULL ORDER BY COALESCE(valid_from, created_at) DESC", [g.person_id, g.field]).map(obsRow);
        // 先清掉旧标记：时间顺序能解释的不算矛盾
        run("UPDATE observations SET conflict=NULL WHERE person_id IS ? AND field=?", [g.person_id || null, g.field]);
        // 只有「同时成立」的两条才是真矛盾（valid_to 都为空、都没过期）；
        // 旧的有 valid_to 说明是正常更替，属于漂移而不是冲突。
        const active = list.filter((o) => isCurrent(o, now));
        if (active.length < 2) continue;
        run("UPDATE observations SET conflict=? WHERE id=?", [`与「${active[1].value}」同时成立`, active[0].id]);
        flagged += 1;
      }
      return flagged;
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
        // 可观测特征也跟着走：同 key 以目标人已有的为准（追的新样本会重新算）
        run("UPDATE OR IGNORE measures SET person_id=? WHERE person_id=?", [keepId, id]);
        run("DELETE FROM measures WHERE person_id=?", [id]);
        run("UPDATE relations SET from_id=? WHERE from_id=?", [keepId, id]);
        run("UPDATE relations SET to_id=? WHERE to_id=?", [keepId, id]);
        run("DELETE FROM people WHERE id=?", [id]);
      }
      // 合并完两组观察后，同一个字段很可能出现「同一句话的两个写法」：只自动合并**归一化后完全相同**的，
      // 近似值（「做游戏」/「做独立游戏」）走 mergeSuggestions 由人确认。
      mergeExactDuplicates({ personId: keepId });
      run("UPDATE people SET aliases=?, updated_at=? WHERE id=?", [JSON.stringify([...new Set(merged)]), Date.now(), keepId]);
      return personRow(one("SELECT * FROM people WHERE id=?", [keepId]));
    },
    /** 只合并归一化后完全相同的重复值（安全子集），并把证据累加 */
    mergeExact({ personId } = {}) { return mergeExactDuplicates({ personId }); },

    /** 画像：本人 / 他人 / 关系 三层 */
    profile({ personId } = {}) {
      const person = personId ? personRow(one("SELECT * FROM people WHERE id=?", [personId])) : null;
      const obs = (pid) => rows("SELECT * FROM observations WHERE person_id=? AND status='confirmed' AND merged_into IS NULL ORDER BY field, COALESCE(valid_from, created_at) DESC", [pid]).map(obsRow);
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
    /**
     * 按时间点回看。两种口径分开，不要混：
     *  - mode="event"（默认）：当时**什么是真的**（valid_from <= at < valid_to）
     *  - mode="known"：当时系统**知道什么**（created_at <= at，且那时为真）
     * 前者回放事实，后者回放认知 —— 双时间图谱的意义就在这两者的差别：
     * 2024-01 发生的事，系统 2026-11 才得知，在 2024-06 回看里不该出现。
     */
    asOf({ personId, at, mode = "event" } = {}) {
      const ts = Number(at) || Date.parse(String(at)) || 0;
      if (!ts) throw new Error("缺少时间点");
      const known = mode === "known" ? "AND created_at <= ?" : "";
      const params = mode === "known" ? [personId || null, ts, ts, ts] : [personId || null, ts, ts];
      const list = rows(
        `SELECT * FROM observations
         WHERE person_id IS ? AND status='confirmed' AND merged_into IS NULL
           AND COALESCE(valid_from, created_at) <= ?
           AND (valid_to IS NULL OR valid_to > ?)
           ${known}
         ORDER BY field, COALESCE(valid_from, created_at) DESC`,
        params,
      ).map(obsRow);
      const byField = new Map();
      for (const o of list) {
        if (!byField.has(o.field)) byField.set(o.field, []);
        byField.get(o.field).push(o);
      }
      const fields = [...byField.entries()].map(([field, items]) => ({
        field,
        label: FIELD_LABEL[field] || field,
        value: items[0].value,
        // 单值字段保留历史链，多值字段给全部（去重）
        history: SINGLE_VALUED.includes(field) ? items.map((o) => ({ value: o.value, from: o.validFrom || o.createdAt, to: o.validTo })) : [],
        values: SINGLE_VALUED.includes(field) ? undefined : [...new Set(items.map((o) => o.value))],
        at: items[0].validFrom || items[0].createdAt,
        confidence: items[0].confidence,
      }));
      return { personId: personId || null, at: ts, mode: mode === "known" ? "known" : "event", fields, count: list.length };
    },

    timeline({ personId, field } = {}) {
      const list = field
        ? rows("SELECT * FROM observations WHERE person_id=? AND field=? AND status='confirmed' ORDER BY COALESCE(valid_from, created_at)", [personId, field])
        : rows("SELECT * FROM observations WHERE person_id=? AND status='confirmed' ORDER BY COALESCE(valid_from, created_at)", [personId]);
      return list.map(obsRow).map((o) => ({ ...o, at: o.validFrom || o.createdAt }));
    },

    /** 决策辅助：给出依据，信息不足明确说未知。只用当前成立的事实 */
    ask({ question = "" } = {}) {
      const q = String(question || "").trim();
      if (!q) throw new Error("问题不能为空");
      const now = Date.now();
      // 按 heat 排：截断到 8 条时先丢弱证据，别把「模型单次猜测」排在被印证过的结论前面
      const facts = rows("SELECT * FROM observations WHERE status='confirmed' AND merged_into IS NULL")
        .map(obsRow).filter((o) => isCurrent(o, now))
        .sort((a, b) => heatOf(b, now) - heatOf(a, now));
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
      /**
       * 相关性只用一套口径（兜底选事实、没点名时挑人都用它）：
       *  ① 问题里的原词（≥3 字）在事实里原样出现 —— 最可靠
       *  ② 或至少 2 个不同词命中，且 df 加权分够高（泛词权重低）
       * 中文 2-gram 下「这个 / 今天 / 同意」到处都是，命中一个就算依据等于随机引文。
       */
      const texts = facts.map((f) => `${f.value} ${f.quote} ${f.person || ""}`);
      const df = new Map();
      for (const t of tokens) {
        let n = 0;
        for (const text of texts) if (text.includes(t)) n += 1;
        df.set(t, n);
      }
      const phrases = words.filter((w) => w.length >= 3);
      const relevance = (i) => {
        const text = texts[i] || "";
        const matched = [...new Set(tokens.filter((t) => text.includes(t)))];
        const score = matched.reduce((sum, t) => sum + 1 / Math.max(1, df.get(t) || 1), 0);
        const phraseHit = phrases.some((phrase) => text.includes(phrase));
        return { phraseHit, hits: matched.length, score, ok: phraseHit || (matched.length >= 2 && score >= 0.8) };
      };
      const citations = [];
      const lines = [];

      const who = people.find((p) => q.includes(p.name) || (p.aliases || []).some((a) => a && q.includes(a)));
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
      // 问「他会怎么反应」但这个人根本没有处事/沟通类记录：不拿语气样本凑数，直接说缺什么
      if (wantReact && person && !lines.length) {
        const missing = ["decision", "conflict", "stress", "communication"].filter((f) => !facts.some((x) => x.personId === person.id && x.field === f));
        return {
          found: false,
          answer: `未知：画像里没有 ${person.name} 的处事方式记录（缺 ${missing.map((f) => FIELD_LABEL[f] || f).join(" / ")}）。可以先跑一次建模，或在人设卡里手工补一条。`,
          citations: [],
        };
      }
      if (wantWho && !person) {
        // 没点名时：按「与问题关键词相关的已确认事实」挑人，并说明依据
        const scored = people
          .filter((p) => !p.isSelf)
          .map((p) => {
            const mine = facts.filter((f, i) => f.personId === p.id && (relevance(i).ok || hit(f.field)));
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
        // 兜底：同一套 relevance，按「原词命中 > df 加权分 > heat」排序
        const scored = facts
          .map((f, i) => ({ f, ...relevance(i) }))
          .filter((x) => x.ok)
          .sort((a, b) => Number(b.phraseHit) - Number(a.phraseHit) || b.score - a.score || heatOf(b.f, now) - heatOf(a.f, now));
        for (const { f } of scored.slice(0, 8)) {
          lines.push(`- ${f.person || nameOf(f.personId)} · ${FIELD_LABEL[f.field] || f.field}：${f.value}`);
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

    /** 手工改一条观察（值 / 字段）：改了值就重新算到期时间，并重新收口同字段旧值 */
    updateObservation({ id, value, field, status } = {}) {
      const row = one("SELECT * FROM observations WHERE id=?", [id]);
      if (!row) throw new Error("观察不存在");
      const next = {
        value: value !== undefined ? String(value).trim().slice(0, 200) : row.value,
        field: field || row.field,
        status: status || row.status,
      };
      if (!next.value) throw new Error("内容不能为空");
      const now = Date.now();
      const expiresAt = inferExpiry(next.field, next.value, row.quote, now);
      run("UPDATE observations SET value=?, field=?, status=?, expires_at=?, stale=0, last_seen_at=?, updated_at=? WHERE id=?",
        [next.value, next.field, next.status, expiresAt, now, now, id]);
      if (next.status === "confirmed" && SINGLE_VALUED.includes(next.field)) {
        const from = row.valid_from || row.created_at || now;
        run("UPDATE observations SET valid_from=? WHERE id=?", [from, id]);
        invalidateSiblings({ personId: row.person_id, field: next.field, id, from, at: now });
      }
      return obsRow(one("SELECT * FROM observations WHERE id=?", [id]));
    },
    /** 删一条观察（单人单条，不进回收站；卡片上的 × 用这个） */
    removeObservation({ id } = {}) {
      run("DELETE FROM observations WHERE id=?", [id]);
      return { removed: 1 };
    },
    /** 手工加一条（默认 confirmed，因为是人写的） */
    addManual({ personId, field, value, quote = "" } = {}) {
      return commit({ personId, person: "", field, value, quote, sourceKind: "manual", status: "confirmed", confidence: 0.9 });
    },

    /** 删除前快照（用于撤销） */
    snapshotPerson({ personId } = {}) {
      return {
        person: personRow(one("SELECT * FROM people WHERE id=?", [personId])),
        observations: rows("SELECT * FROM observations WHERE person_id=?", [personId]).map(obsRow),
        measures: measuresOf(personId),
        relations: rows("SELECT * FROM relations WHERE from_id=? OR to_id=?", [personId, personId]).map((r) => ({ ...r })),
      };
    },
    /** 撤销删除：把人、观察、可观测特征、关系写回去 */
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
        run(`INSERT INTO observations
             (id, person_id, person, field, value, valid_from, valid_to, confidence, evidence_count,
              source_kind, source_ref, quote, status, sensitive, conflict, created_at, updated_at, context,
              last_seen_at, expires_at, stale, review_at, merged_into)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          o.id, o.personId, o.person, o.field, o.value, o.validFrom ?? null, o.validTo ?? null,
          o.confidence ?? 0.6, o.evidenceCount ?? 1, o.sourceKind || "manual", o.sourceRef || null, o.quote || "",
          o.status || "confirmed", o.sensitive ? 1 : 0, o.conflict || null, o.createdAt || Date.now(), o.updatedAt || Date.now(),
          o.context || null, o.lastSeenAt ?? null, o.expiresAt ?? null, o.stale ? 1 : 0, o.reviewAt ?? null, o.mergedInto ?? null,
        ]);
        restored += 1;
      }
      for (const m of snapshot.measures || []) {
        if (one("SELECT key FROM measures WHERE person_id=? AND key=?", [p.id, m.key])) continue;
        run(`INSERT INTO measures (person_id,key,field,label,value,num,prev_value,prev_num,times,computed_at,changed_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
          p.id, m.key, m.field || "", m.label || "", m.value || "", m.num ?? null,
          m.prevValue ?? null, m.prevNum ?? null, m.times || 0, m.computedAt || Date.now(), m.changedAt || Date.now(),
        ]);
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
      // 按人删除时，人物实体、关系边、可观测特征也要一起清掉，否则列表里会留下 0 条观察的空壳
      if (personId && !from && !to && !sourcePrefix) {
        run("DELETE FROM measures WHERE person_id=?", [personId]);
        run("DELETE FROM relations WHERE from_id=? OR to_id=?", [personId, personId]);
        run("DELETE FROM people WHERE id=?", [personId]);
        run("DELETE FROM meta WHERE k=?", [`llm:${personId}`]);
      }
      return { removed: before - after };
    },

    stats() {
      const now = Date.now();
      return {
        people: one("SELECT COUNT(*) n FROM people").n,
        pending: one("SELECT COUNT(*) n FROM observations WHERE status='pending'").n,
        confirmed: one("SELECT COUNT(*) n FROM observations WHERE status='confirmed' AND merged_into IS NULL").n,
        current: one("SELECT COUNT(*) n FROM observations WHERE status='confirmed' AND merged_into IS NULL AND valid_to IS NULL").n,
        stale: one(
          `SELECT COUNT(*) n FROM observations WHERE status='confirmed' AND merged_into IS NULL AND valid_to IS NULL
             AND (COALESCE(stale,0)=1 OR (expires_at IS NOT NULL AND expires_at <= ?))`, [now],
        ).n,
        measures: one("SELECT COUNT(*) n FROM measures").n,
        merged: one("SELECT COUNT(*) n FROM observations WHERE status='merged'").n,
        relations: one("SELECT COUNT(*) n FROM relations").n,
        imports: one("SELECT COUNT(*) n FROM imports").n,
      };
    },
    close() { try { db.close(); } catch { /* ignore */ } },
  };
}
