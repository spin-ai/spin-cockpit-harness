#!/usr/bin/env node
/**
 * 存量建模结论的引用回查（一次性，可重复跑）。
 *   node scripts/persona-verify-quotes.mjs                 # 只报告，不改库
 *   node scripts/persona-verify-quotes.mjs --apply         # 把查不到的标为「引用待核对」
 *   node scripts/persona-verify-quotes.mjs --dataset <dir> # 指定聊天语料目录
 *
 * 为什么需要：`quote_verified` 这一列是这次才加的，之前写进去的结论（model 给的「原文」）
 * 从来没被校验过。这里用同一批聊天语料回查一遍，让人知道哪几条是需要先核对再确认的。
 *
 * 判据（宽松，宁可不判错）：
 *  语料 = 该人自己的发言 + 紧邻的上下文（建模时喂给模型的就是这两部分）
 *  命中 = 归一化后整句在原话里出现，或它的前 80% 出现（模型常截断并加省略号）
 * 注意：语料只能证明「这句话在聊天记录里存在」，不能证明「是这个人说的 / 是在这个语境下说的」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { evidenceMatches, normalizeForMatch, looksLikeStat } from "../electron/persona/model.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rejectStats = args.includes("--reject-stats");
const datasetArg = args.includes("--dataset") ? args[args.indexOf("--dataset") + 1] : "";
const jsonOnly = args.includes("--json");

const userData = process.env.COCKPIT_USER_DATA || path.join(os.homedir(), "Library", "Application Support", "spin-cockpit-harness");
const dbPath = path.join(userData, "persona", "persona.db");
if (!fs.existsSync(dbPath)) {
  console.error(`找不到人物库：${dbPath}`);
  process.exit(1);
}

/** 语料目录：显式参数 → 设置里的 personaDatasetDir → 常见位置 */
function resolveDatasetDir() {
  if (datasetArg) return datasetArg;
  const candidates = [
    path.join(userData, "datasets", "wechat"),
    path.join(process.cwd(), "datasets", "wechat"),
  ];
  try {
    const h = new DatabaseSync(path.join(userData, "harness.db"), { readOnly: true });
    const row = h.prepare("SELECT v FROM settings WHERE k='app'").get();
    h.close();
    const dir = row?.v ? JSON.parse(row.v)?.personaDatasetDir : "";
    if (dir) candidates.unshift(dir);
  } catch { /* 设置读不到就走常见位置 */ }
  return candidates.find((dir) => dir && fs.existsSync(dir)) || "";
}

const datasetDir = resolveDatasetDir();
if (!datasetDir) {
  console.error("找不到聊天语料目录（datasets/wechat）。用 --dataset <dir> 指定，或先跑「复制到应用目录」。");
  process.exit(1);
}

/** 读全部会话：chat 名 → 消息数组（按时间排序） */
function loadChats(dir) {
  const chats = new Map();
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, "dataset.json");
    if (!fs.existsSync(file)) continue;
    try {
      const list = JSON.parse(fs.readFileSync(file, "utf8"));
      chats.set(name, [...list].sort((a, b) => (Date.parse(a.date || "") || 0) - (Date.parse(b.date || "") || 0)));
    } catch { /* 坏文件跳过 */ }
  }
  return chats;
}

/** 该人的发言 + 紧邻上下文，拼成语料（建模时就是这么喂的） */
function corpusFor(chats, person) {
  const parts = [];
  for (const list of chats.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const m = list[i];
      if (String(m.from || "") !== person) continue;
      parts.push(String(m.text || ""));
      // 前后各一句：模型判断互动方式时会看到它们
      if (i > 0) parts.push(String(list[i - 1].text || ""));
      if (i + 1 < list.length) parts.push(String(list[i + 1].text || ""));
    }
  }
  return parts.join("\n");
}

const chats = loadChats(datasetDir);
const db = new DatabaseSync(dbPath);
// 老库还没有这一列（新版本首次打开才加）：先补上，--apply 才有地方写
{
  const cols = db.prepare("PRAGMA table_info(observations)").all().map((c) => c.name);
  if (!cols.includes("quote_verified")) db.exec("ALTER TABLE observations ADD COLUMN quote_verified INTEGER DEFAULT 1");
}
const rows = db.prepare(
  `SELECT id, person, field, value, quote, status, source_kind, source_ref, quote_verified
     FROM observations
    WHERE source_kind='llm' AND COALESCE(quote,'')<>''
      AND quote NOT IN ('(模型归纳)')
    ORDER BY person`,
).all();

const corpusCache = new Map();
const report = { total: rows.length, verified: 0, statIsNotQuote: 0, missing: 0, undecidable: 0, applied: 0, rejected: 0, samples: [], statSamples: [] };

for (const row of rows) {
  const person = String(row.person || "");
  // 「本人」这种占位名对不上语料里的昵称，直接跳过（不判）
  if (!person || person === "本人") { report.undecidable += 1; continue; }
  if (!corpusCache.has(person)) corpusCache.set(person, corpusFor(chats, person));
  const corpus = corpusCache.get(person);
  if (!corpus) { report.undecidable += 1; continue; }
  // 引用太短（「好的」）本来就无法核对 —— 和建模时的判据保持一致
  // ① 证据根本不是原话，而是统计值（老提示词把统计一起喂给模型的后遗症）
  if (looksLikeStat(row.quote)) {
    report.statIsNotQuote += 1;
    if (report.statSamples.length < 6) report.statSamples.push({ person, field: row.field, quote: String(row.quote).slice(0, 40) });
    if (apply && row.quote_verified !== 0) {
      db.prepare("UPDATE observations SET quote_verified=0 WHERE id=?").run(row.id);
      report.applied += 1;
    }
    // 统计结论已经迁到 measures：这批 pending 留着只会让人逐条确认过时的数字
    if (rejectStats && row.status === "pending") {
      const now = Date.now();
      db.prepare("UPDATE observations SET status='rejected', updated_at=? WHERE id=?").run(now, row.id);
      db.prepare("INSERT INTO rejects VALUES (?,?,1) ON CONFLICT(sig) DO UPDATE SET at=excluded.at, times=1")
        .run(`${row.person_id || row.person}:${row.field}:${row.value}`, now);
      report.rejected += 1;
    }
    continue;
  }
  const matched = evidenceMatches(row.quote, corpus);
  const tooShort = normalizeForMatch(row.quote).length < 6;
  if (matched) { report.verified += 1; continue; }
  report.undecidable += tooShort ? 1 : 0;
  if (tooShort) continue;
  report.missing += 1;
  if (report.samples.length < 8) {
    report.samples.push({ person, field: row.field, quote: String(row.quote).slice(0, 50) });
  }
  if (apply && row.quote_verified !== 0) {
    db.prepare("UPDATE observations SET quote_verified=0 WHERE id=?").run(row.id);
    report.applied += 1;
  }
}
db.close();

if (jsonOnly) {
  console.log(JSON.stringify({ datasetDir, ...report }, null, 2));
  process.exit(0);
}

console.log(`引用回查：${path.basename(datasetDir)}（${chats.size} 个会话）\n`);
console.log(`  待回查（模型结论，带引用）：${report.total}`);
console.log(`  ✓ 原话能在聊天记录里找到：${report.verified}`);
console.log(`  ! 证据其实是统计值，不是原话：${report.statIsNotQuote}`);
console.log(`  ✗ 找不到原话（可能被模型改写/概括）：${report.missing}`);
console.log(`  · 无法判定（本人占位名 / 引用太短）：${report.undecidable}`);
if (report.statSamples.length) {
  console.log("\n  「证据是统计值」的样本（这类结论现在应该走 measures，不是事实）：");
  for (const s of report.statSamples) console.log(`   - ${s.person} · ${s.field}：${s.quote}`);
}
if (report.samples.length) {
  console.log("\n  找不到原话的样本：");
  for (const s of report.samples) console.log(`   - ${s.person} · ${s.field}：${s.quote}`);
}
console.log("\n建议：这批 pending 里「证据是统计值」的，直接拒绝 —— 统计结论已经迁到 measures，");
console.log("      留着只会让人在 142 条待确认里逐条确认一遍过时的统计数字。");
if (apply) console.log(`\n已标记 ${report.applied} 条为「引用待核对」（不删除，卡片与待确认队列里会标出来）。`);
if (rejectStats) console.log(`已拒绝 ${report.rejected} 条「证据是统计值」的待确认结论（统计已由 measures 承担）。`);
if (!apply && !rejectStats) console.log("\n这是只读报告。--apply 标「引用待核对」；--reject-stats 顺带拒绝证据是统计值的 pending。");
console.log("注意：语料只能证明「这句话在聊天记录里存在」，不能证明「是他说的 / 是在这个语境下说的」。");
