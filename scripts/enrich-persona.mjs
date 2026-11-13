#!/usr/bin/env node
/**
 * 人像补充：① 生成关系网络  ② 用本人发言补人设卡字段
 *
 * 前置：
 *   - 已用 scripts/import-wechat.mjs 生成 datasets/wechat/
 *   - 已把聊天记录导入人物（人像 → 导入，或 personaImport）
 *   - 需要 .runtime/wechat4-db-decrypt/decrypted-live（群成员表）才能建「同群」边；
 *     没有也能跑，只是关系只剩私聊与明确角色句式
 *
 * 用法：
 *   node scripts/enrich-persona.mjs [--self 我] [--dry-run]
 *
 * 幂等：关系按 (from,to,type) 去重、观察按 (person,field,value) 去重，重复跑不会翻倍。
 * 只读取本地文件，不上传。写库前建议退出 App，避免两个进程同时写 persona.db。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes("--dry-run");
const SELF_NAME = flag("self") || "我";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const decrypted = path.join(root, ".runtime/wechat4-db-decrypt/decrypted-live");
const dsRoot = path.join(root, "datasets/wechat");
const personaFile = path.join(os.homedir(), "Library/Application Support/spin-cockpit-harness/persona/persona.db");
const pdb = new DatabaseSync(personaFile);
const now = Date.now();
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------- 人物索引 ---------- */
const people = pdb.prepare("SELECT id,name,is_self,group_only FROM people").all();
const byName = new Map(people.map((p) => [p.name, p]));
const self = people.find((p) => p.is_self) || byName.get(SELF_NAME);
if (!self) { console.error(`没找到「${SELF_NAME}」这个人；先导入聊天记录，或用 --self 指定昵称`); process.exit(1); }
const personIdOf = (name) => (byName.get(name) || null)?.id || null;

/* ---------- 微信联系人 / 群成员 ---------- */
const contact = new DatabaseSync(path.join(decrypted, "contact/contact.db"));
const contactRows = contact.prepare("SELECT id, username, remark, nick_name FROM contact").all();
const idToName = new Map();
for (const r of contactRows) {
  const label = String(r.remark || r.nick_name || r.username || "").trim();
  if (r.id != null) idToName.set(String(r.id), label);
}
const roomById = new Map(contact.prepare("SELECT id, username FROM chat_room").all().map((r) => [String(r.id), String(r.username)]));
const roomName = new Map();
for (const [rid, username] of roomById) {
  const c = contactRows.find((x) => x.username === username);
  roomName.set(rid, String(c?.remark || c?.nick_name || username));
}
const members = contact.prepare("SELECT room_id, member_id FROM chatroom_member").all();
contact.close();

/* ---------- 会话消息量（用已生成的数据集，避免再解一遍库） ---------- */
const chatStats = new Map(); // chat -> { total, bySpeaker: Map }
for (const chat of fs.readdirSync(dsRoot)) {
  const file = path.join(dsRoot, chat, "dataset.json");
  if (!fs.existsSync(file)) continue;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
  const bySpeaker = new Map();
  for (const m of list) bySpeaker.set(m.from, (bySpeaker.get(m.from) || 0) + 1);
  chatStats.set(chat, { total: list.length, bySpeaker });
}

/* ---------- 关系 ---------- */
const relIds = new Set(pdb.prepare("SELECT from_id || '|' || to_id || '|' || type k FROM relations").all().map((r) => r.k));
const addRel = (fromId, toId, type, strength, sourceRef) => {
  if (!fromId || !toId || fromId === toId) return 0;
  const key = `${fromId}|${toId}|${type}`;
  if (relIds.has(key)) {
    pdb.prepare("UPDATE relations SET strength=MAX(strength, ?) WHERE from_id=? AND to_id=? AND type=?").run(strength, fromId, toId, type);
    return 0;
  }
  relIds.add(key);
  if (!DRY) pdb.prepare("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?)").run(uid("r"), fromId, toId, type, strength, "affects", sourceRef || "", "confirmed", now);
  return 1;
};

let relCount = 0;
// 1) 私聊：本人 ↔ 对方
for (const [chat, st] of chatStats) {
  if (chat.includes("@chatroom")) continue;
  const pid = personIdOf(chat);
  if (!pid) continue;
  relCount += addRel(self.id, pid, "私聊", Math.min(0.95, 0.5 + st.total / 500), `chat:${chat}`);
}
// 2) 同群：本人 ↔ 群成员（大群只保留活跃成员，避免几千个弱边）
const roomMemberNames = new Map();
for (const m of members) {
  const name = idToName.get(String(m.member_id));
  if (!name) continue;
  if (!roomMemberNames.has(String(m.room_id))) roomMemberNames.set(String(m.room_id), []);
  roomMemberNames.get(String(m.room_id)).push(name);
}
for (const [rid, names] of roomMemberNames) {
  const rname = roomName.get(rid) || "";
  const st = chatStats.get(rname);
  if (!st) continue; // 只处理有消息落地的群
  const active = names
    .map((n) => ({ n, c: st.bySpeaker.get(n) || 0 }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 30);
  for (const { n, c } of active) {
    const pid = personIdOf(n);
    if (!pid) continue;
    relCount += addRel(self.id, pid, "同群", Math.min(0.6, 0.15 + c / 200), `room:${rname}`);
  }
}
// 3) 明确角色句式：我的老板 / 我的同事 …
const ROLE = /(?:是我的|我)(老板|领导|上司|同事|下属|助理|客户|甲方|乙方|家人|爸爸|妈妈|父亲|母亲|老婆|老公|妻子|丈夫|儿子|女儿|朋友|同学|老师|学生)/;
for (const [chat, st] of chatStats) {
  const file = path.join(dsRoot, chat, "dataset.json");
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
  for (const m of list) {
    const hit = String(m.text || "").match(ROLE);
    if (!hit) continue;
    // 「X 是我的老板」：取句中出现的人名
    const target = [...byName.keys()].find((n) => n !== "我" && String(m.text).includes(n));
    if (!target) continue;
    const pid = personIdOf(target);
    if (!pid) continue;
    relCount += addRel(self.id, pid, hit[1], 0.8, `chat:${chat}`);
    relCount += addRel(pid, self.id, hit[1] === "老板" || hit[1] === "领导" || hit[1] === "上司" ? "下属" : hit[1], 0.8, `chat:${chat}`);
  }
}

// 4) 小群内部：活跃成员两两连边（只取最活跃的 5 人，强度权重低）
for (const [rid, names] of roomMemberNames) {
  if (names.length > 15) continue;
  const rname = roomName.get(rid) || "";
  const st = chatStats.get(rname);
  if (!st) continue;
  const top = names.map((n) => ({ n, c: st.bySpeaker.get(n) || 0 })).filter((x) => x.c > 2).sort((a, b) => b.c - a.c).slice(0, 5);
  for (let i = 0; i < top.length; i += 1) {
    for (let j = i + 1; j < top.length; j += 1) {
      const a = personIdOf(top[i].n);
      const b = personIdOf(top[j].n);
      if (!a || !b) continue;
      relCount += addRel(a, b, "同群", 0.2, `room:${rname}`);
    }
  }
}

/* ---------- 本人人设卡补充 ---------- */
const FIELDS = [
  ["identity", /我是(?:一?名|一个|做)?([^\s，。！？,.!?]{2,18}?)(?:的|，|。|$)/],
  ["identity", /我在([^\s，。！？,.!?]{2,20}?)(?:公司|单位|团队|工作|上班)/],
  ["role", /我(?:担任|负责|做)([^\s，。！？,.!?]{2,20})/],
  ["role", /我是([^\s，。！？,.!?]{0,6}(?:经理|总监|工程师|老师|医生|老板|合伙人|设计师|运营|产品|销售|学生|顾问))/],
  ["situation", /我(?:最近|现在|目前)(?:在|正)([^\s，。！？,.!?]{2,24})/],
  ["capability", /我(?:比较)?(?:擅长|不太会|不擅长|会)([^\s，。！？,.!?]{2,20})/],
  ["taboo", /我(?:最)?(?:讨厌|受不了|不接受|不想)([^\s，。！？,.!?]{2,20})/],
  ["traits", /我(?:比较|挺|很|有点)(内向|外向|急躁|谨慎|懒|拖延|完美主义|敏感|乐观|悲观|强势|社恐)/],
  ["value", /我更?看重([^\s，。！？,.!?]{2,20})/],
  ["value", /(?:重要|关键)的是([^\s，。！？,.!?]{2,20})/],
  ["goal", /我(?:要|想要|打算|计划|准备)([^\s，。！？,.!?]{2,24})/],
  ["goal", /今年的?目标是([^\s，。！？,.!?]{2,24})/],
  ["decision", /我(?:一般|通常|习惯)(先[^\s，。！？,.!?]{2,20}|按[^\s，。！？,.!?]{2,20})/],
  ["conflict", /(?:吵架|冲突|生气|争执)的?时候?我会?([^\s，。！？,.!?]{2,20})/],
  ["stress", /我(?:压力大|焦虑|忙不过来)([^\s，。！？,.!?]{0,20})/],
  ["commitment", /我(?:答应|承诺|保证|一定)([^\s，。！？,.!?]{2,20})/],
  ["communication", /我(?:更)?(?:喜欢|偏好|习惯)(文字|语音|电话|当面|异步|开会|发消息|邮件)/],
  ["value", /我(?:觉得|认为)([^\s，。！？,.!?]{2,18}?)(?:很重要|最重要|比较重要|是关键)/],
  ["decision", /我(?:一般|通常|习惯|喜欢)先([^\s，。！？,.!?]{2,20})/],
  ["constraint", /我(?:必须|不能|不要|得)([^\s，。！？,.!?]{2,20})/],
  ["situation", /我这边([^\s，。！？,.!?]{2,24})/],
  ["traits", /我这个人(?:比较|挺|很)?([^\s，。！？,.!?]{2,12})/],
  ["capability", /我不太懂([^\s，。！？,.!?]{2,16})/],
  ["taboo", /别(?:再)?([^\s，。！？,.!?]{2,16})(?:了|，|。)/],
];
const existing = new Set(pdb.prepare("SELECT field || '|' || value k FROM observations WHERE person_id=?").all(self.id).map((r) => r.k));
const insert = pdb.prepare("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const seen = new Set();
let added = 0;
const byFieldAdded = {};
for (const [chat, st] of chatStats) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(dsRoot, chat, "dataset.json"), "utf8")); } catch { continue; }
  const isSelfChat = chat === "文件传输助手";
  // 本人发言遍布私聊/群聊/文件传输助手：全都扫，只看 fromSelf
  list.forEach((m, idx) => {
    const fromSelf = m.from === "我" || isSelfChat;
    if (!fromSelf) return;
    const text = String(m.text || "").trim();
    if (text.length < 4 || text.length > 400) return;
    for (const [field, re] of FIELDS) {
      const hit = text.match(re);
      if (!hit) continue;
      const value = String(hit[1] || hit[0]).trim().replace(/[，。！？,.!?]+$/, "");
      if (value.length < 2 || value.length > 40) continue;
      const key = `${field}|${value}`;
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      if (!DRY) insert.run(uid("o"), self.id, "我", field, value, m.date ? Date.parse(m.date) || null : null, null, 0.75,
        "transcript", `${chat}#${idx}`, text.slice(0, 240), "confirmed", 0, null, now, now);
      added += 1;
      byFieldAdded[field] = (byFieldAdded[field] || 0) + 1;
    }
  });
}

const cardFields = ["identity","role","situation","capability","taboo","traits","value","goal","decision","conflict","stress","commitment","communication","style","voice"];
const covered = pdb.prepare(`SELECT DISTINCT field f FROM observations WHERE person_id=? AND status='confirmed'`).all(self.id).map((r) => r.f).filter((f) => cardFields.includes(f));
const confirmed = pdb.prepare("SELECT COUNT(*) n FROM observations WHERE person_id=? AND status='confirmed'").get(self.id).n;
const completeness = Math.min(100, Math.round((covered.length / cardFields.length) * 100) + Math.min(8, Math.floor(confirmed / 6)));
const relTotal = pdb.prepare("SELECT COUNT(*) n FROM relations").get().n;
console.log(JSON.stringify({ relationsAdded: relCount, relationsTotal: relTotal, selfFactsAdded: added, byFieldAdded, selfFields: covered, completeness }, null, 2));
pdb.close();
