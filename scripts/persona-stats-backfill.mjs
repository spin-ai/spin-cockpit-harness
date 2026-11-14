#!/usr/bin/env node
/**
 * 可观测特征回填（不调模型、不花钱、可重复跑）。
 *   node scripts/persona-stats-backfill.mjs                  # 只报告
 *   node scripts/persona-stats-backfill.mjs --apply          # 写入 measures
 *   node scripts/persona-stats-backfill.mjs --min 10 --apply # 少于 10 条发言的跳过
 *   node scripts/persona-stats-backfill.mjs --dataset <dir>
 *
 * 为什么需要：可观测特征以前只在「建模」时算，而建模要调模型、要花钱，
 * 于是 264 个人里只有 13 个人有特征。特征本身是纯统计、零成本，应该人人都有。
 * （导入时已经会自动算了；这个脚本用来回填历史数据。）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPersona } from "../electron/persona/index.mjs";
import { computeFeatures } from "../electron/persona/model.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const min = Number(args.includes("--min") ? args[args.indexOf("--min") + 1] : 10) || 10;
const datasetArg = args.includes("--dataset") ? args[args.indexOf("--dataset") + 1] : "";

const userData = process.env.COCKPIT_USER_DATA || path.join(os.homedir(), "Library", "Application Support", "spin-cockpit-harness");
const personaDir = path.join(userData, "persona");

function resolveDatasetDir() {
  if (datasetArg) return datasetArg;
  const candidates = [path.join(userData, "datasets", "wechat"), path.join(process.cwd(), "datasets", "wechat")];
  return candidates.find((dir) => dir && fs.existsSync(dir)) || "";
}

const datasetDir = resolveDatasetDir();
if (!datasetDir) {
  console.error("找不到聊天语料目录（datasets/wechat）。用 --dataset <dir> 指定。");
  process.exit(1);
}

const persona = createPersona({ dir: personaDir });
const people = new Map(persona.people().map((p) => [p.name, p]));

/** chat → 消息（按时间排序），并给每条补齐 chat 名（群聊按 @chatroom 约定） */
const chats = new Map();
for (const name of fs.readdirSync(datasetDir)) {
  const file = path.join(datasetDir, name, "dataset.json");
  if (!fs.existsSync(file)) continue;
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    const speakers = new Set(list.map((m) => m.from).filter(Boolean));
    const isGroup = speakers.size > 2;
    chats.set(name, {
      isGroup,
      messages: list.map((m) => ({ ...m, chat: isGroup ? `${name}@chatroom` : name }))
        .sort((a, b) => (Date.parse(a.date || "") || 0) - (Date.parse(b.date || "") || 0)),
    });
  } catch { /* 坏文件跳过 */ }
}

// 人 → 他的发言 + 所在会话全文（算回复时延 / 互动对象要用整段会话）
const byPerson = new Map();
for (const [name, chat] of chats) {
  for (const m of chat.messages) {
    const who = String(m.from || "").trim();
    if (!who) continue;
    if (!byPerson.has(who)) byPerson.set(who, { msgs: [], chats: new Set() });
    const bucket = byPerson.get(who);
    bucket.msgs.push(m);
    bucket.chats.add(name);
  }
}

let touched = 0;
let skippedMissing = 0;
let skippedSmall = 0;
const samples = [];
for (const [who, bucket] of byPerson) {
  const person = people.get(who);
  if (!person) { skippedMissing += 1; continue; }
  if (bucket.msgs.length < min) { skippedSmall += 1; continue; }
  const context = [...bucket.chats].flatMap((c) => chats.get(c)?.messages || []);
  const features = computeFeatures(bucket.msgs, who, context);
  if (!features) { skippedSmall += 1; continue; }
  const n = apply ? persona.applyStats({ personId: person.id, features }) : 14;
  touched += 1;
  if (samples.length < 5) samples.push(`${who}：${features.count} 条 / 每日 ${features.perDay} 条${features.replyMedianMin != null ? ` / 中位时延 ${features.replyMedianMin} 分` : ""} → ${n} 项特征`);
}

console.log(`可观测特征回填（${path.basename(datasetDir)}，${chats.size} 个会话 / ${byPerson.size} 个发言人）\n`);
console.log(`  写入（或待写入）：${touched} 人 · 约 ${touched * 14} 项特征${apply ? "" : "（dry-run）"}`);
console.log(`  跳过：库里没这个人 ${skippedMissing} 人 / 发言少于 ${min} 条 ${skippedSmall} 人`);
if (samples.length) {
  console.log("\n  样本：");
  for (const s of samples) console.log(`   - ${s}`);
}
console.log(apply
  ? "\n已写入 measures（只留最新值 + 上一次值，可反复重算；不动事实层）。"
  : "\n这是 dry-run。加 --apply 才会写入。");

persona.close();
