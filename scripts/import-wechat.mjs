#!/usr/bin/env node
/**
 * 把「导出的微信聊天记录」整理成可当数据集用的规范格式。
 *
 * 为什么需要这一步：微信 4.x（xwechat）的 message/*.db 是 SQLCipher 整库加密
 * （文件头不是 "SQLite format 3"），没有 key 读不出来；能直接拿到的是第三方工具
 * 导出的 CSV / JSON / TXT，或者你自己从 WeChat 里「导出聊天记录」得到的内容。
 *
 * 输出（默认 datasets/wechat/）：
 *   <chat>/messages.jsonl   一行一条，{chat, at, speaker, text, out}
 *   <chat>/dataset.json     同样是数组，可直接喂给人像导入（personaImport / 人像页「粘贴」）
 *   manifest.json           统计：条数、时间范围、跳过/去重数、来源文件
 *
 * 用法：
 *   node scripts/import-wechat.mjs <导出目录或文件> [--out datasets/wechat] [--self 我] [--limit N] [--dry-run]
 *   node scripts/import-wechat.mjs --dir <已解密的 db_storage 目录> [--self-wxid wxid_xxx] [--out datasets/wechat]
 *   node scripts/import-wechat.mjs --dir ~/Downloads/wechat4/decrypted/db_storage --self 我 --self-wxid wxid_abc123

说明：微信 4.x 的 message/*.db 是 SQLCipher 加密的，没有 key 读不出来；
--dir 读的是「已解密」的库（node:sqlite 直接读，Msb_/Name2Id/contact 自动解析）；
CSV/JSON/TXT/HTML 导出直接丢目录即可。 [--out datasets/wechat]
 *
 * 支持的输入：
 *   - MemoTrace / WeChatMsg 的 CSV（StrTalker, StrContent, CreateTime, IsSender, NickName, Remark…）
 *   - WeChatMsg / 其他工具导出的 JSON（数组，或 {messages:[…]}，字段 from/text/date 或 sender/content/time）
 *   - JSONL（一行一个对象）
 *   - 纯文本：`时间 说话人` + 内容，或 `说话人: 内容`（与 App 人像导入一致）
 *   - HTML（粗略去标签，仅当包含「说话人: 内容」句式时可用）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (name) => argv.includes(`--${name}`);
const input = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))) || "";
const outRoot = path.resolve(flag("out") || path.join(root, "datasets", "wechat"));
const selfName = flag("self") || "我";
const limit = Number(flag("limit")) || 0;
const dryRun = has("dry-run");
const dbPath = flag("db");
const dbKey = flag("key");

const now = Date.now();
const CJK = /[\u3400-\u9fff]/;

function log(...args) { console.log("[wechat]", ...args); }
function die(msg, code = 1) { console.error(`[wechat] ${msg}`); process.exit(code); }

/** 时间归一化：秒/毫秒/字符串都吃 */
function toMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const text = String(value).trim().replace(/\//g, "-");
  const withT = text.includes("T") ? text : text.replace(" ", "T");
  const ms = Date.parse(withT);
  return Number.isFinite(ms) ? ms : null;
}

/** 极简 CSV 解析（支持引号、逗号、换行、双引号转义） */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function recordsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().replace(/^\ufeff/, ""));
  const idx = (...names) => header.findIndex((h) => names.some((n) => h.toLowerCase() === n.toLowerCase()));
  const iChat = idx("StrTalker", "talker", "chat", "群聊", "联系人");
  const iText = idx("StrContent", "content", "text", "内容", "消息");
  const iTime = idx("CreateTime", "time", "date", "时间");
  const iSelf = idx("IsSender", "isSend", "issender", "是否发送");
  const iName = idx("NickName", "sender", "from", "昵称", "发送人", "Remark");
  if (iText < 0) return [];
  return rows.slice(1).map((r) => {
    const isSelf = iSelf >= 0 ? /^(1|true|yes|是)$/i.test(String(r[iSelf] || "").trim()) : false;
    const chat = iChat >= 0 ? String(r[iChat] || "").trim() : "";
    const speaker = isSelf ? selfName : String((iName >= 0 ? r[iName] : "") || chat || "对方").trim();
    return { chat: chat || "未命名会话", at: iTime >= 0 ? toMs(r[iTime]) : null, speaker, text: String(r[iText] || ""), out: isSelf };
  });
}

function recordsFromJson(text) {
  const pick = (item) => {
    if (!item || typeof item !== "object") return null;
    const speaker = item.from ?? item.sender ?? item.author ?? item.speaker ?? item.NickName ?? item.name ?? "";
    const body = item.text ?? item.content ?? item.message ?? item.StrContent ?? "";
    const at = toMs(item.date ?? item.time ?? item.timestamp ?? item.CreateTime ?? item.at);
    const chat = item.chat ?? item.room ?? item.StrTalker ?? item.talker ?? "";
    const out = typeof item.isSender === "boolean" ? item.isSender : /^(1|true)$/i.test(String(item.IsSender ?? ""));
    if (!speaker && !body) return null;
    return { chat: String(chat || "未命名会话"), at, speaker: String(speaker || (out ? selfName : "对方")), text: String(body), out };
  };
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data) ? data : data.messages || data.data || data.list || [];
      return list.map(pick).filter(Boolean);
    } catch { /* 落回 JSONL */ }
  }
  return trimmed.split("\n").map((line) => {
    const t = line.trim();
    if (!t || !t.startsWith("{")) return null;
    try { return pick(JSON.parse(t)); } catch { return null; }
  }).filter(Boolean);
}

function recordsFromText(text) {
  const out = [];
  let speaker = "";
  let at = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const head = t.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s+(.{1,24})$/);
    if (head) { at = toMs(`${head[1]} ${head[2]}`); speaker = head[3].trim(); continue; }
    const m = t.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
    if (m) { out.push({ chat: "未命名会话", at, speaker: m[1].trim(), text: m[2].trim(), out: m[1].trim() === selfName }); continue; }
    if (speaker) { out.push({ chat: "未命名会话", at, speaker, text: t, out: speaker === selfName }); speaker = ""; continue; }
    out.push({ chat: "未命名会话", at, speaker: "unknown", text: t, out: false });
  }
  return out;
}

function recordsFromHtml(text) {
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
  return recordsFromText(plain);
}


/**
 * 读「已解密」的微信 4.x 库（node:sqlite，无需 sqlcipher）。
 * 结构：message/message_*.db 里是 Msg_<md5(talker)> 表 + Name2Id；
 * 字段：local_type / real_sender_id / create_time / message_content(或 compress_content)。
 * 只取可读的文本类消息（1 文本，49 图文里的 <title>），其它类型跳过。
 */
function recordsFromDecryptedDir(dir) {
  const { DatabaseSync } = nodeSqliteModule();
  const files = [];
  const walk = (base) => {
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.db$/i.test(name) && !/-(wal|shm)$/i.test(name)) files.push(full);
    }
  };
  walk(dir);

  const out = [];
  const sessions = new Map(); // username -> 会话展示名
  const contacts = new Map(); // username -> 联系人展示名
  // 先扫 session / contact 库拿展示名（读不到就退化成 username）
  for (const file of files.filter((f) => /(session|contact)[^/]*\.db$/i.test(f))) {
    const isContact = /contact/i.test(path.basename(file));
    try {
      const db = new DatabaseSync(file);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
        const nameCol = cols.find((c) => /^(user_name|username|talker|str_talker|session_id)$/i.test(c))
          || cols.find((c) => /user_name|username|talker|str_talker|session_id/i.test(c));
        // 展示名：优先备注/昵称；注意排除 username 本身（name$ 会误匹配 user_name）
        const dispCol = cols.find((c) => c !== nameCol && /^(remark|remark_name|nick_name|nickname|display_name|alias|name)$/i.test(c));
        if (!nameCol) continue;
        for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
          const key = String(row[nameCol] || "");
          const label = String((dispCol && row[dispCol]) || key || "");
          if (key && label) (isContact ? contacts : sessions).set(key, label);
        }
      }
      db.close();
    } catch { /* session 读不到就退化成表名 */ }
  }

  const md5Chat = new Map();
  for (const [key, label] of sessions) {
    md5Chat.set(crypto.createHash("md5").update(key).digest("hex"), label);
  }

  for (const file of files) {
    if (/session[^/]*\.db$/i.test(file)) continue;
    let db;
    try { db = new DatabaseSync(file); } catch (err) { log(`跳过 ${path.basename(file)}：${String(err?.message || err).slice(0, 80)}`); continue; }
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      // Name2Id：real_sender_id -> 用户名
      const idMap = new Map();
      for (const t of tables.filter((n) => /name2id/i.test(n))) {
        const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
        const idCol = cols.find((c) => /^id$|rowid|user_id/i.test(c));
        const nameCol = cols.find((c) => /user_name|username|name/i.test(c));
        if (!idCol || !nameCol) continue;
        for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) idMap.set(String(row[idCol]), String(row[nameCol] || ""));
      }
      for (const table of tables.filter((n) => /^Msg_/i.test(n))) {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
        const typeCol = cols.find((c) => /local_type|type/i.test(c));
        const senderCol = cols.find((c) => /real_sender_id|sender/i.test(c));
        const timeCol = cols.find((c) => /create_time|createtime|time/i.test(c));
        const textCol = cols.find((c) => /^(message_content|content|msg|str_content)$/i.test(c));
        if (!timeCol || !textCol) continue;
        const rows = db.prepare(`SELECT * FROM "${table}"`).all();
        // 会话名：Msg_<md5(username)>，用 session 表里的 username 算 md5 对上
        const suffix = table.replace(/^Msg_/i, "").toLowerCase();
        const chat = md5Chat.get(suffix) || `会话_${suffix.slice(0, 8)}`;
        for (const row of rows) {
          const type = Number(row[typeCol] ?? 0);
          let text = String(row[textCol] ?? "");
          if (!text && row.compress_content) continue; // 压缩内容（图片/文件等）跳过
          if (type === 49) {
            const title = text.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
            text = title ? `[链接/分享] ${title[1].trim()}` : "";
          } else if (type !== 1 && type !== 10000 && type !== 3) {
            // 其它类型（语音/视频/转账…）只在能读到文本时保留
            if (!/[\u3400-\u9fff]|[a-zA-Z0-9]/.test(text)) continue;
          }
          if (!String(text).trim()) continue;
          const senderId = idMap.get(String(row[senderCol] ?? "")) || "";
          const selfWxid = flag("self-wxid") || "";
          const isSelf = Boolean((selfWxid && senderId === selfWxid) || (!selfWxid && senderId && senderId === selfName));
          const speakerName = isSelf
            ? (selfName || contacts.get(senderId) || senderId || "我")
            : (contacts.get(senderId) || senderId || "对方");
          out.push({
            chat,
            at: toMs(row[timeCol]),
            speaker: speakerName,
            text: String(text).replace(/\u0000/g, "").trim(),
            out: isSelf,
          });
        }
      }
    } catch { /* 单库失败不影响其它 */ }
    finally { try { db.close(); } catch { /* ignore */ } }
  }
  return out;
}

/** Msg_ 表名是 md5(talker)：在 session.db 里没命中时，用 name2id 反查不到就留空 */
function chatFromMd5Index() { return ""; }

function nodeSqliteModule() {
  const mod = process.getBuiltinModule ? process.getBuiltinModule("node:sqlite") : null;
  if (!mod?.DatabaseSync) die("读已解密的库需要 Node 22+（内置 node:sqlite）");
  return mod;
}

/** 加密库（SQLCipher）导出：需要本机有 sqlcipher 命令 */
function recordsFromEncryptedDb(file, key) {
  let bin = "sqlcipher";
  try { execFileSync(bin, ["-version"], { stdio: "ignore" }); } catch {
    die(`打不开加密库：需要 sqlcipher（brew install sqlcipher）。\n  也可以先用第三方工具把聊天导出成 CSV/JSON，再跑：node scripts/import-wechat.mjs <导出目录>`);
  }
  const sql = [
    `PRAGMA key = "x'${key}'";`,
    "SELECT name FROM sqlite_master WHERE type='table';",
  ].join("\n");
  const tables = execFileSync(bin, ["-batch", "-noheader", file], { input: sql, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter((t) => /^Msg_|^message/i.test(t) || /Msg/.test(t));
  if (!tables.length) die("库里没找到消息表（Msg_*/message）");
  const out = [];
  for (const table of tables) {
    const q = `PRAGMA key = "x'${key}'";\nSELECT * FROM "${table}";`;
    let rows = [];
    try {
      const json = execFileSync(bin, ["-batch", "-json", file], { input: q, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
      rows = JSON.parse(json || "[]");
    } catch { continue; }
    for (const r of rows) {
      const body = r.StrContent ?? r.content ?? r.message ?? "";
      if (!body) continue;
      const isSelf = /^(1|true)$/i.test(String(r.IsSender ?? r.isSender ?? ""));
      out.push({ chat: String(r.StrTalker ?? r.talker ?? table), at: toMs(r.CreateTime ?? r.createTime), speaker: isSelf ? selfName : String(r.NickName || "对方"), text: String(body), out: isSelf });
    }
  }
  return out;
}

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  for (const name of fs.readdirSync(target)) {
    if (name.startsWith(".")) continue;
    const full = path.join(target, name);
    const s = fs.statSync(full);
    if (s.isDirectory()) out.push(...collectFiles(full));
    else if (/\.(csv|json|jsonl|txt|md|html?)$/i.test(name)) out.push(full);
  }
  return out;
}

function readRecords(file) {
  const text = fs.readFileSync(file, "utf8");
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv") return recordsFromCsv(text);
  if (ext === ".json" || ext === ".jsonl") return recordsFromJson(text);
  if (ext === ".html" || ext === ".htm") return recordsFromHtml(text);
  return recordsFromText(text);
}

function safeName(name) {
  return String(name || "chat").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "chat";
}

function main() {
  const decryptedDir = flag("dir");
  if (decryptedDir) {
    const dir = path.resolve(decryptedDir);
    if (!fs.existsSync(dir)) die(`找不到目录：${dir}`);
    const records = recordsFromDecryptedDir(dir);
    if (!records.length) die("目录里没解析出消息（确认指向 db_storage 或含 message_*.db 的目录）");
    return write(records, [dir]);
  }
  if (dbPath) {
    if (!dbKey) die("加密库需要 --key <hex>（SQLCipher 的 raw key）");
    const records = recordsFromEncryptedDb(path.resolve(dbPath), dbKey);
    return write(records, [path.resolve(dbPath)]);
  }
  if (!input) {
    die(`用法：
  node scripts/import-wechat.mjs <导出目录或文件> [--out datasets/wechat] [--self 我] [--limit N] [--dry-run]
  node scripts/import-wechat.mjs --db message_0.db --key <hex>

说明：微信 4.x 的 message/*.db 是 SQLCipher 加密的，没有 key 读不出来；
能直接处理的是第三方工具导出的 CSV/JSON/TXT/HTML。`);
  }
  const target = path.resolve(input);
  if (!fs.existsSync(target)) die(`找不到：${target}`);
  const files = collectFiles(target);
  if (!files.length) die("目录里没有 csv/json/jsonl/txt/html 文件");
  const records = [];
  for (const file of files) {
    try {
      const list = readRecords(file);
      log(`${path.relative(root, file)} → ${list.length} 条`);
      records.push(...list);
    } catch (err) {
      log(`跳过 ${path.basename(file)}：${String(err?.message || err)}`);
    }
  }
  return write(records, files);
}

function write(records, files) {
  const seen = new Set();
  let dup = 0;
  let bad = 0;
  const clean = [];
  for (const r of records) {
    const text = String(r.text || "").replace(/\u0000/g, "").trim();
    if (!text) { bad += 1; continue; }
    const key = `${r.chat}\u0001${r.at || 0}\u0001${r.speaker}\u0001${text}`;
    if (seen.has(key)) { dup += 1; continue; }
    seen.add(key);
    clean.push({ chat: r.chat || "未命名会话", at: r.at || null, speaker: r.speaker || "unknown", text, out: Boolean(r.out) });
    if (limit && clean.length >= limit) break;
  }
  clean.sort((a, b) => (a.at || 0) - (b.at || 0));

  const groups = new Map();
  for (const r of clean) {
    if (!groups.has(r.chat)) groups.set(r.chat, []);
    groups.get(r.chat).push(r);
  }
  const times = clean.map((r) => r.at).filter(Boolean);
  const manifest = {
    generatedAt: new Date(now).toISOString(),
    sources: files.map((f) => path.relative(root, f)),
    total: clean.length,
    chats: [...groups.entries()].map(([chat, list]) => ({
      chat,
      count: list.length,
      selfMessages: list.filter((m) => m.out).length,
      cjkMessages: list.filter((m) => CJK.test(m.text)).length,
      from: list.map((m) => m.at).filter(Boolean).sort((a, b) => a - b)[0] || null,
      to: list.map((m) => m.at).filter(Boolean).sort((a, b) => b - a)[0] || null,
    })),
    skipped: { empty: bad, duplicate: dup },
    range: times.length ? { from: Math.min(...times), to: Math.max(...times) } : null,
    note: "本目录可能包含私人聊天，默认已加入 .gitignore；不要提交或分享。",
  };

  if (dryRun) {
    log(`dry-run：将写入 ${manifest.total} 条 / ${manifest.chats.length} 个会话`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  fs.mkdirSync(outRoot, { recursive: true });
  for (const [chat, list] of groups) {
    const dir = path.join(outRoot, safeName(chat));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "messages.jsonl"), list.map((r) => JSON.stringify(r)).join("\n") + "\n");
    // 人像导入直接吃这个数组（字段按 App 的 from/text/date 约定）
    fs.writeFileSync(path.join(dir, "dataset.json"), JSON.stringify(list.map((r) => ({
      from: r.speaker, text: r.text, date: r.at ? new Date(r.at).toISOString() : null, chat: r.chat, isSender: r.out,
    })), null, 2));
  }
  fs.writeFileSync(path.join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outRoot, "README.md"), [
    "# 微信聊天数据集",
    "",
    `生成于 ${manifest.generatedAt}，共 ${manifest.total} 条 / ${manifest.chats.length} 个会话。`,
    "",
    "- `manifest.json`：统计与来源",
    "- `<会话>/messages.jsonl`：一行一条 `{chat, at, speaker, text, out}`",
    "- `<会话>/dataset.json`：人像导入格式（`from/text/date`）",
    "",
    "## 当作数据集使用",
    "",
    "- 人像：`人像 → 导入` 选 `dataset.json`；或 `personaImport({ text: <dataset.json 内容> })`",
    "- 知识库：`知识库 → 文档 → 粘贴文本` 可直接贴某段记录做检索/引用",
    "",
    "> 隐私：目录已在 `.gitignore` 里；不要 push、不要打包进 release。",
  ].join("\n"));

  log(`写入 ${outRoot}`);
  for (const c of manifest.chats) log(`  ${c.chat}: ${c.count} 条（本人 ${c.selfMessages}）`);
  log(`跳过：空 ${bad} / 重复 ${dup}`);
}

main();
