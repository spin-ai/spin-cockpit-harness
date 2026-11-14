#!/usr/bin/env node
/**
 * 人物画像历史数据对账（一次性，可重复跑）。
 *   node scripts/persona-reconcile.mjs            # 默认跑用户目录里的 persona.db
 *   node scripts/persona-reconcile.mjs --dry-run  # 只看会改什么，不落盘
 *   node scripts/persona-reconcile.mjs --db /path/to/persona.db
 *
 * 为什么要跑：旧版本把「统计特征」当事实写进了 observations，并且直插 confirmed、绕过 resolve，
 * 结果全库 valid_to 一条都没有，同一个字段会同时成立好几种说法（群聊 0%/1%/2%…）。
 * 这里按四条语义分别处理，全程只标状态，不删数据：
 *   ① measure 分流：source_kind='stats' 的观察挪进 measures（重算即可，不该进记忆层）
 *   ② invalidate：单值字段里「同时成立」的多条，按时间收口成一条（旧值留 valid_to）
 *   ③ merge：归一化后完全相同的重复值合并（证据累加）
 *   ④ TTL + sweep：时间敏感事实补 expires_at，过期的标 stale 进复核队列
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { inferExpiry, normalizeValue } from "../electron/persona/index.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noBackup = args.includes("--no-backup");
const dbArg = args.includes("--db") ? args[args.indexOf("--db") + 1] : "";
const DAY = 86400000;
const SINGLE_VALUED = ["identity", "role", "situation", "value", "goal"];

const defaultDb = path.join(os.homedir(), "Library", "Application Support", "spin-cockpit-harness", "persona", "persona.db");
const dbPath = dbArg || defaultDb;

if (!fs.existsSync(dbPath)) {
  console.error(`找不到库：${dbPath}\n（装好的 App 也可能在 ~/Library/Application Support/Cockpit Harness/persona/persona.db，用 --db 指定）`);
  process.exit(1);
}

console.log(`对账目标：${dbPath}${dryRun ? "（dry-run：在副本上跑，不碰原库）" : ""}\n`);

let workPath = dbPath;
let tmpDir = "";
if (dryRun) {
  // 真的改一遍才能算出准确结果，所以拿副本跑；原库不动
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "persona-recon-"));
  workPath = path.join(tmpDir, "persona.db");
  fs.copyFileSync(dbPath, workPath);
}

if (!dryRun && !noBackup) {
  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`已备份：${path.basename(backup)}\n`);
}

const db = new DatabaseSync(workPath);
const rows = (sql, p = []) => db.prepare(sql).all(...p);
const one = (sql, p = []) => db.prepare(sql).get(...p);
const run = (sql, p = []) => db.prepare(sql).run(...p);

// 补新列 / 建 measures 表（幂等）：老库不能靠 App 先升级过
const cols = new Set(db.prepare("PRAGMA table_info(observations)").all().map((c) => c.name));
for (const [name, type] of [["evidence_count", "INTEGER DEFAULT 1"], ["last_seen_at", "INTEGER"], ["merged_into", "TEXT"], ["stale", "INTEGER DEFAULT 0"], ["expires_at", "INTEGER"], ["review_at", "INTEGER"]]) {
  if (!cols.has(name)) db.exec(`ALTER TABLE observations ADD COLUMN ${name} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS measures (
  person_id TEXT, key TEXT, field TEXT, label TEXT, value TEXT, num REAL,
  prev_value TEXT, prev_num REAL, times INTEGER DEFAULT 0,
  computed_at INTEGER, changed_at INTEGER,
  PRIMARY KEY (person_id, key)
)`);

const before = {
  observations: one("SELECT COUNT(*) n FROM observations").n,
  stats: one("SELECT COUNT(*) n FROM observations WHERE source_kind='stats'").n,
  measures: one("SELECT COUNT(*) n FROM measures").n,
  validTo: one("SELECT COUNT(*) n FROM observations WHERE valid_to IS NOT NULL").n,
};

/** 旧统计结论 → measure key（认不出就保留成普通观察，不猜） */
const MEASURE_RULES = [
  [/^话多|^话少|^发言量/, "msgs.count", "traits"],
  [/中位 \d+ 字/, "len.median", "traits"],
  [/习惯长段落表达|习惯短句、碎片化回复/, "len.median", "traits"],
  [/^回复(很快|节奏中等|偏慢)/, "reply.median", "communication"],
  [/平均每个活跃日|^活跃 \d+ 天/, "msgs.per_day", "traits"],
  [/^群聊 \d+%/, "chat.ratio", "situation"],
  [/^最常互动/, "interlocutors.top", "situation"],
  [/问句|常用提问/, "ratio.question", "communication"],
  [/礼貌用语/, "ratio.polite", "communication"],
  [/笑声|网络语气/, "ratio.laugh", "style"],
  [/表情/, "ratio.emoji", "style"],
  [/省略号/, "ratio.ellipsis", "style"],
  [/感叹号/, "ratio.exclaim", "style"],
  [/口语化/, "ratio.filler", "style"],
  [/活跃时段/, "hours.active", "situation"],
  [/高频词/, "words.top", "situation"],
  [/常聊话题/, "topics.llm", "situation"],
];
const LABEL = {
  "msgs.count": "发言量", "len.median": "句长", "reply.median": "接话时延", "msgs.per_day": "发言密度",
  "chat.ratio": "群 / 私聊", "interlocutors.top": "最常互动", "ratio.question": "提问比例", "ratio.polite": "礼貌用语",
  "ratio.laugh": "笑声", "ratio.emoji": "表情", "ratio.ellipsis": "省略号", "ratio.exclaim": "感叹号",
  "ratio.filler": "口语化", "hours.active": "活跃时段", "words.top": "高频词", "topics.llm": "常聊话题",
};
const keyOf = (value) => {
  for (const [re, key, field] of MEASURE_RULES) if (re.test(value)) return { key, field };
  return null;
};

// ── ① measure 分流 ───────────────────────────────────────────────────
console.log("[1] 统计特征分流到 measures");
let moved = 0;
let unmapped = 0;
const legacy = rows("SELECT * FROM observations WHERE source_kind='stats'");
for (const o of legacy) {
  const hit = keyOf(o.value);
  if (!hit) { unmapped += 1; continue; }
  const num = Number((String(o.value).match(/-?\d+(?:\.\d+)?/) || [])[0]);
  const at = o.updated_at || o.created_at || Date.now();
  const prev = one("SELECT * FROM measures WHERE person_id=? AND key=?", [o.person_id, hit.key]);
  {
    if (prev) {
      const changed = String(prev.value) !== String(o.value);
      run(`UPDATE measures SET field=?, label=?, prev_value=?, prev_num=?, value=?, num=?, times=?, changed_at=?, computed_at=?
           WHERE person_id=? AND key=?`, [
        hit.field, LABEL[hit.key] || hit.key, prev.value, prev.num, o.value, Number.isFinite(num) ? num : null,
        changed ? (prev.times || 0) + 1 : (prev.times || 0), changed ? at : prev.changed_at, at, o.person_id, hit.key,
      ]);
    } else {
      run(`INSERT INTO measures (person_id,key,field,label,value,num,prev_value,prev_num,times,computed_at,changed_at)
           VALUES (?,?,?,?,?,?,NULL,NULL,0,?,?)`, [o.person_id, hit.key, hit.field, LABEL[hit.key] || hit.key, o.value, Number.isFinite(num) ? num : null, at, at]);
    }
    run("DELETE FROM observations WHERE id=?", [o.id]);
  }
  moved += 1;
}
console.log(`  迁移 ${moved} 条 → measures${unmapped ? `；${unmapped} 条认不出（保留为观察，不猜）` : ""}`);

// ── ② invalidate：单值字段收口 ────────────────────────────────────────
console.log("\n[2] 单值字段收口（invalidate）");
let collapses = 0;
const groups = rows(`SELECT person_id, field, COUNT(DISTINCT value) n FROM observations
  WHERE status='confirmed' AND merged_into IS NULL AND valid_to IS NULL AND field IN (${SINGLE_VALUED.map(() => "?").join(",")})
  GROUP BY person_id, field HAVING n > 1`, SINGLE_VALUED);
for (const g of groups) {
  const list = rows(`SELECT * FROM observations WHERE person_id IS ? AND field=? AND status='confirmed' AND merged_into IS NULL
    ORDER BY COALESCE(valid_from, created_at) ASC`, [g.person_id, g.field]);
  if (list.length < 2) continue;
  for (let i = 0; i < list.length - 1; i += 1) {
    const to = list[i + 1].valid_from || list[i + 1].created_at;
    run("UPDATE observations SET valid_to=?, updated_at=? WHERE id=?", [to, Date.now(), list[i].id]);
    collapses += 1;
  }
}
console.log(`  收口 ${collapses} 条旧值（保留 valid_to，不删除）`);

// ── ③ merge：归一化完全相同的重复值 ───────────────────────────────────
console.log("\n[3] 重复值合并（只合并归一化后完全相同的）");
let mergedCount = 0;
const dupGroups = rows(`SELECT person_id, field FROM observations
  WHERE status='confirmed' AND merged_into IS NULL GROUP BY person_id, field, value HAVING COUNT(*) > 1`);
for (const g of dupGroups) {
  const list = rows(`SELECT * FROM observations WHERE person_id IS ? AND field=? AND status='confirmed' AND merged_into IS NULL
    ORDER BY COALESCE(evidence_count,1) DESC, created_at ASC`, [g.person_id, g.field]);
  const buckets = new Map();
  for (const o of list) {
    const k = normalizeValue(o.value);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(o);
  }
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    const [head, ...rest] = items;
    for (const drop of rest) {
      {
        run("UPDATE observations SET evidence_count=COALESCE(evidence_count,1)+?, last_seen_at=?, updated_at=? WHERE id=?",
          [drop.evidence_count || 1, Date.now(), Date.now(), head.id]);
        run("UPDATE observations SET merged_into=?, status='merged', updated_at=? WHERE id=?", [head.id, Date.now(), drop.id]);
      }
      mergedCount += 1;
    }
  }
}
console.log(`  合并 ${mergedCount} 条（证据累加到保留项）`);

// ── ④ TTL 回填 + sweep ───────────────────────────────────────────────
console.log("\n[4] 时间敏感事实补到期时间");
let expirySet = 0;
for (const o of rows("SELECT * FROM observations WHERE status='confirmed' AND merged_into IS NULL AND expires_at IS NULL AND field IN ('event','commitment','constraint')")) {
  const at = o.valid_from || o.created_at || Date.now();
  const exp = inferExpiry(o.field, o.value, o.quote, at);
  if (!exp) continue;
  run("UPDATE observations SET expires_at=? WHERE id=?", [exp, o.id]);
  expirySet += 1;
}
console.log(`  补 ${expirySet} 条 expires_at`);

const now = Date.now();
const expiring = rows("SELECT id FROM observations WHERE status='confirmed' AND merged_into IS NULL AND valid_to IS NULL AND COALESCE(stale,0)=0 AND expires_at IS NOT NULL AND expires_at <= ?", [now]);
for (const r of expiring) run("UPDATE observations SET stale=1, updated_at=? WHERE id=?", [now, r.id]);
console.log(`  标 stale ${expiring.length} 条（进复核队列，不删除）`);

// 冲突标记用新版口径：先清旧标记，只在「时间上同时成立」时才算矛盾
{
  run("UPDATE observations SET conflict=NULL WHERE conflict IS NOT NULL");
  const live = rows(`SELECT person_id, field, value, id, COALESCE(valid_from, created_at) t FROM observations
    WHERE status='confirmed' AND merged_into IS NULL AND valid_to IS NULL AND COALESCE(stale,0)=0
      AND field IN (${SINGLE_VALUED.map(() => "?").join(",")})
    ORDER BY person_id, field, COALESCE(valid_from, created_at) DESC`, SINGLE_VALUED);
  const byGroup = new Map();
  for (const o of live) {
    const k = `${o.person_id}|${o.field}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(o);
  }
  let flagged = 0;
  for (const items of byGroup.values()) {
    if (new Set(items.map((x) => x.value)).size < 2) continue;
    run("UPDATE observations SET conflict=? WHERE id=?", [`与「${items[1].value}」同时成立`, items[0].id]);
    flagged += 1;
  }
  console.log(`\n重新标记 simultaneous 冲突 ${flagged} 组（时间能解释的不算）`);
}

const after = {
  observations: one("SELECT COUNT(*) n FROM observations").n,
  stats: one("SELECT COUNT(*) n FROM observations WHERE source_kind='stats'").n,
  measures: one("SELECT COUNT(*) n FROM measures").n,
  validTo: one("SELECT COUNT(*) n FROM observations WHERE valid_to IS NOT NULL").n,
  stale: one("SELECT COUNT(*) n FROM observations WHERE COALESCE(stale,0)=1").n,
  merged: one("SELECT COUNT(*) n FROM observations WHERE status='merged'").n,
};
db.close();
if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("\n前后对比");
console.log(`  observations ${before.observations} → ${after.observations}（剩 stats ${after.stats}）`);
console.log(`  measures     ${before.measures} → ${after.measures}`);
console.log(`  valid_to     ${before.validTo} → ${after.validTo}`);
console.log(`  stale        → ${after.stale} · merged → ${after.merged}`);
if (dryRun) console.log("\n这是 dry-run：改的是一份副本，原库没动。去掉 --dry-run 才会落盘（会先自动备份）。");
console.log("\n下一步：打开「人物」页看复核队列，用「仍然成立 / 已过期」清一遍时间敏感的旧说法。");
