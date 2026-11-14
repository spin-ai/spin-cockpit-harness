/**
 * 聊天记录导入适配器。
 *
 * 认四种导出格式，认不出就不猜（宁可少抽，也不要造出假事实）：
 *   telegram  result.json（messages[] + from / text / date / date_unixtime）
 *   feishu    飞书导出 JSON（sender.name + body.content 里的 {text}）
 *   wechat    微信导出 txt（"张三 2024-01-02 12:34:56" 行头，或 "张三: 内容"）
 *   csv       表头含 时间/发送者/内容（或 time/sender/text）
 *
 * 输出统一为 { messages: [{speaker, text, at}], format, warnings }。
 */

const SYSTEM_SPEAKERS = new Set(["system", "system message", "系统消息", "系统", "撤回", ""]);

function clean(text) {
  return String(text ?? "")
    .replace(/\u0000/g, "")
    .replace(/\u200b/g, "")
    .trim();
}

/** Telegram 的 text 可能是字符串，也可能是 [{"type":"link","text":"..."} , " 后续"] */
function telegramText(text) {
  if (Array.isArray(text)) {
    return text.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return typeof text === "string" ? text : "";
}

function tsOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 1e11) return n;           // 毫秒
  if (Number.isFinite(n) && n > 1e9) return n * 1000;     // 秒
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function detectFormat(text) {
  const raw = String(text || "").trim();
  if (!raw) return "empty";
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : data.messages || data.data || [];
      if (Array.isArray(list) && list.length) {
        // 只看第一条会误判：Telegram 导出开头常有 service 消息（无 from_id）
        const sample = list.slice(0, 8);
        const has = (key) => sample.some((item) => item && item[key] !== undefined);
        if (has("from_id") || has("date_unixtime")) return "telegram";
        if (sample.some((item) => item?.body?.content || item?.msg_type)) return "feishu";
        if (has("from") || has("author")) return "json";
        if (has("sender")) return "json";
      }
      return "json";
    } catch {
      return "text";
    }
  }
  const head = raw.split("\n").slice(0, 3).join("\n");
  if (/\t/.test(head) && /[tT]ime|时间/.test(head)) return "csv";
  if (/^[^,]{1,20},[^,]{1,40},/m.test(head) && /时间|time|时间戳/i.test(head)) return "csv";
  if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(raw)) return "wechat";
  if (/^[^:：]{1,24}[:：]\s*\S/m.test(raw)) return "wechat";
  return "text";
}

const GROUP_CHAT_TYPES = new Set(["private_group", "private_supergroup", "public_supergroup", "private_channel", "public_channel", "group", "supergroup", "channel"]);
const DIRECT_CHAT_TYPES = new Set(["personal_chat", "saved_messages", "private", "p2p", "direct"]);

function chatTypeOf(value) {
  const t = String(value || "").toLowerCase();
  if (!t) return null;
  if (GROUP_CHAT_TYPES.has(t)) return "group";
  if (DIRECT_CHAT_TYPES.has(t)) return "direct";
  return null;
}

function parseTelegram(data) {
  const messages = [];
  for (const item of data.messages || []) {
    if (item.type && item.type !== "message") continue;
    const speaker = clean(item.from);
    const text = clean(telegramText(item.text));
    if (!speaker || !text) continue;
    messages.push({ speaker, text, at: tsOf(item.date_unixtime) ?? tsOf(item.date) });
  }
  return {
    messages,
    chatType: chatTypeOf(data.type),
    warnings: messages.length ? [] : ["Telegram 导出里没有可用的 message 项"],
  };
}

function parseFeishu(data) {
  const list = Array.isArray(data) ? data : data.messages || data.data || [];
  const messages = [];
  for (const item of list) {
    const speaker = clean(item.sender?.name || item.sender_name || item.from || item.name);
    let text = clean(item.text || item.content);
    if (!text && typeof item.body?.content === "string") {
      try {
        const parsed = JSON.parse(item.body.content);
        text = clean(parsed.text || parsed.content || "");
      } catch {
        text = clean(item.body.content);
      }
    }
    if (!speaker || !text) continue;
    messages.push({ speaker, text, at: tsOf(item.create_time || item.createTime || item.time || item.date) });
  }
  const chatType = chatTypeOf(data.chat_type) || chatTypeOf(list[0]?.chat_type) || chatTypeOf(list[0]?.chatType);
  return { messages, chatType, warnings: messages.length ? [] : ["飞书导出里没有可用的消息"] };
}

function parseWechat(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const out = [];
  const warnings = [];
  let pendingSpeaker = "";
  let pendingAt = null;
  const header1 = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s+(.{1,24})$/;         // 时间 说话人
  const header2 = /^(.{1,24}?)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})[ T](\d{1,2}:\d{2}(?::\d{2})?)$/;      // 说话人 时间
  const inline = /^\[?(\d{4}[-/]\d{1,2}[-/]\d{1,2})?[ T]?(\d{1,2}:\d{2}(?::\d{2})?)?\]?\s*([^:：]{1,24})[:：]\s*(.+)$/;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^-{2,}$/.test(t) || /^={2,}$/.test(t)) continue;
    if (/^(以下为新消息|消息记录|聊天记录)/.test(t)) continue;

    let m = t.match(header1);
    if (m) {
      pendingAt = tsOf(`${m[1].replace(/\//g, "-")}T${m[2]}`);
      pendingSpeaker = clean(m[3]);
      continue;
    }
    m = t.match(header2);
    if (m) {
      pendingSpeaker = clean(m[1]);
      pendingAt = tsOf(`${m[2].replace(/\//g, "-")}T${m[3]}`);
      continue;
    }
    m = t.match(inline);
    if (m && !/^\d+$/.test(clean(m[3]))) {
      const at = m[1] ? tsOf(`${m[1].replace(/\//g, "-")}T${m[2] || "00:00"}`) : pendingAt;
      out.push({ speaker: clean(m[3]), text: clean(m[4]), at });
      continue;
    }
    if (pendingSpeaker) {
      out.push({ speaker: pendingSpeaker, text: t, at: pendingAt });
      pendingSpeaker = "";
      continue;
    }
    out.push({ speaker: "unknown", text: t, at: pendingAt });
  }
  if (!out.length) warnings.push("微信文本里没有识别出「说话人 + 内容」");
  return { messages: out, warnings };
}

/** 极简 CSV：支持逗号/制表符，认识 时间/发送者/内容 三列 */
function parseCsv(text) {
  const rows = String(text).replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!rows.length) return { messages: [], warnings: ["CSV 为空"] };
  const delim = rows[0].includes("\t") ? "\t" : ",";
  const split = (line) => {
    const out = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === delim && !quoted) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(rows[0]).map((s) => s.toLowerCase());
  const idxOf = (names) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iTime = idxOf(["时间", "time", "date"]);
  const iWho = idxOf(["发送者", "sender", "from", "昵称", "name"]);
  const iText = idxOf(["内容", "text", "content", "消息", "message"]);
  if (iText < 0 || iWho < 0) {
    // 没有表头：按「时间,说话人,内容」假定
    const messages = rows.map((line) => {
      const cells = split(line);
      return { speaker: clean(cells[1]), text: clean(cells.slice(2).join(delim)), at: tsOf(cells[0]) };
    }).filter((m) => m.speaker && m.text);
    return { messages, warnings: messages.length ? ["未识别表头，按 时间/说话人/内容 解析"] : ["CSV 没有可用行"] };
  }
  const messages = [];
  for (const line of rows.slice(1)) {
    const cells = split(line);
    const speaker = clean(cells[iWho]);
    const body = clean(cells[iText]);
    if (!speaker || !body) continue;
    messages.push({ speaker, text: body, at: iTime >= 0 ? tsOf(cells[iTime]) : null });
  }
  return { messages, warnings: messages.length ? [] : ["CSV 没有可用行"] };
}

/**
 * 统一入口。
 * @param {string} text
 * @param {{ format?: string, selfName?: string, fallback?: (text: string) => { messages: any[] } }} [opts]
 */
export function parseChatAuto(text, { format = "auto", fallback } = {}) {
  const raw = String(text || "");
  const detected = format && format !== "auto" ? format : detectFormat(raw);
  try {
    if (detected === "telegram") return { ...parseTelegram(JSON.parse(raw)), format: "telegram" };
    if (detected === "feishu") return { ...parseFeishu(JSON.parse(raw)), format: "feishu" };
    if (detected === "csv") return { ...parseCsv(raw), format: "csv" };
    if (detected === "wechat") return { ...parseWechat(raw), format: "wechat" };
  } catch (err) {
    return { messages: [], format: detected, warnings: [`${detected} 解析失败：${String(err?.message || err)}`] };
  }
  if (typeof fallback === "function") {
    const res = fallback(raw) || {};
    return { messages: res.messages || [], format: res.format || detected, warnings: [] };
  }
  return { messages: [], format: detected, warnings: ["没有识别出任何发言"] };
}

export function summarize(messages) {
  const speakers = new Map();
  let oldest = null;
  let newest = null;
  for (const m of messages) {
    speakers.set(m.speaker, (speakers.get(m.speaker) || 0) + 1);
    if (m.at) {
      if (!oldest || m.at < oldest) oldest = m.at;
      if (!newest || m.at > newest) newest = m.at;
    }
  }
  return {
    messages: messages.length,
    people: speakers.size,
    top: [...speakers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n })),
    from: oldest,
    to: newest,
    unknown: messages.filter((m) => SYSTEM_SPEAKERS.has(m.speaker.toLowerCase()) || m.speaker === "unknown").length,
  };
}
