/**
 * 群聊路由：谁被 @ 到、这句话该谁回、成员回复里的 @ 又该唤醒谁。
 *
 * 为什么单独一层（对照 `third-part/orca @ 1ab037e` 的 `bot-group-mentions.ts`）：
 *  - 代码块 / 引用 / 文件路径里的 `@` 是数据，不是地址；用一条正则全局匹配会把它们也唤醒。
 *  - 名字要按最长匹配（「PM · 项目经理」和「PM」两种写法都算同一个人）。
 *  - `mentions` 模式的默认收件人是**空**：没 @ 到就没人回；不要退化成「主管 + 第一个成员」双答。
 *
 * 纯函数，单测见 tests/bot/group.test.mjs。
 */

const EVERYONE = "@everyone";
// @ 前必须是开头或非单词字符；避免 `foo@bar` / 邮箱被当成地址
const MENTION_START = /(^|[^\p{L}\p{N}_.@])@/gu;
// 名字后面必须断开：空格 / 标点 / 行尾
const NAME_END = /^(?:$|[\s,:;!?)]|\.(?:\s|$))/u;
// 开头的地址列表：`@A @B 你们看下`；中间的 @ 不要求 leading
const LEADING_GAP = /^[\s,:!?]*$/u;
// 代码 / 引用 / 引号里的 @ 是数据
const UNADDRESSED =
  /```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|`[^`\n]*`|^[ \t]*>.*$|\u201c[^\u201d]*\u201d|"[^"\n]*"|「[^」]*」|『[^』]*』/gmu;
// 文件路径 / URL 形式的 @：`@src/a.ts`、`@/abs/path`、`@C:\...`
const FILE_REF = /@(?:[\\/~]|[a-z]:[\\/])\S*/giu;

/** 把要忽略的片段替换成等长空格：偏移不变，后续仍能定位原句。 */
export function blankUnaddressed(text = "", extra = null) {
  let out = String(text || "");
  if (extra) out = out.replace(extra, (hit) => " ".repeat(hit.length));
  return out
    .replace(FILE_REF, (hit) => " ".repeat(hit.length))
    .replace(UNADDRESSED, (hit) => " ".repeat(hit.length));
}

const handleOf = (member) => String(member?.name || "").split("·")[0].trim();

/** 一个成员的全部可 @ 写法：全名 + 短名 */
export function namesOf(member) {
  return [String(member?.name || "").trim(), handleOf(member)].filter(Boolean);
}

/**
 * 解析一句话里的地址。
 * @returns `{ mentions, ids, everyones, ambiguous }`；`mentions` 保留位置与原始词，便于 UI 高亮/报错。
 */
export function parseGroupMentions(text = "", members = [], { ignoreProse = true } = {}) {
  const prose = ignoreProse ? blankUnaddressed(text) : String(text || "");
  const mentions = [];
  let leadingEnd = 0;
  for (const found of prose.matchAll(MENTION_START)) {
    const start = found.index + found[1].length;
    // 已匹配的长名字内部不再拆出短名字
    if (start < (mentions.at(-1)?.end ?? 0)) continue;
    const rest = prose.slice(start);
    const leading = LEADING_GAP.test(prose.slice(leadingEnd, start));
    if (leading) leadingEnd = start + 1;
    if (rest.slice(0, EVERYONE.length).toLowerCase() === EVERYONE
      && NAME_END.test(rest.slice(EVERYONE.length))) {
      mentions.push({ start, end: start + EVERYONE.length, leading, match: "everyone", ids: [], word: EVERYONE });
      continue;
    }
    // 最长命中：同一位置可能有「PM」和「PM · 项目经理」两个人名写法
    let best = null;
    for (const member of members) {
      for (const name of namesOf(member)) {
        const slice = rest.slice(1, 1 + name.length);
        if (slice.toLowerCase() !== name.toLowerCase()) continue;
        if (!NAME_END.test(rest.slice(1 + name.length))) continue;
        if (!best || name.length > best.length) best = { id: member.id, name, length: name.length };
        else if (name.length === best.length && best.id !== member.id) best.ambiguous = true;
      }
    }
    if (best?.ambiguous) {
      mentions.push({ start, end: start + 1 + best.length, leading, match: "ambiguous", ids: [], word: best.name });
      continue;
    }
    if (best) {
      mentions.push({ start, end: start + 1 + best.length, leading, match: "member", ids: [best.id], word: best.name });
      continue;
    }
    // 没命中成员：记下原位与词，主进程据此给出「没有这个人」而不是静默丢弃
    const word = rest.slice(1).match(/^[\p{L}\p{N}_.·-]+/u)?.[0] || "";
    mentions.push({ start, end: start + 1 + word.length, leading, match: "none", ids: [], word });
  }
  const ids = [...new Set(mentions.filter((m) => m.match === "member").flatMap((m) => m.ids))];
  const everyones = mentions.some((m) => m.match === "everyone");
  const ambiguous = mentions.some((m) => m.match === "ambiguous");
  return { mentions, ids, everyones, ambiguous };
}

/** 成员回复里的 @：只唤醒本机其他成员；代码 / 引用 / 自己不算。 */
export function replyMentions(text = "", members = [], speakerId = "") {
  const { mentions } = parseGroupMentions(text, members);
  const out = [];
  for (const m of mentions) {
    if (m.match !== "member" || !m.ids.length) continue;
    const id = m.ids[0];
    if (!id || id === speakerId) continue;
    if (!members.some((x) => x.id === id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 这一句该谁回。
 * - 有 @：只回被 @ 到的人（`@everyone` = 全体）
 * - 没有 @：`bot` 回固定成员、`all` 回全体、`mentions` 回 0 人
 * - `whoCanAsk = owner` 的 bot 不进群聊
 * @returns `{ ids, addressed, unknown, ambiguous, noOne }`
 */
export function groupAudience({ text = "", members = [], mode = { kind: "mentions" } } = {}) {
  const parsed = parseGroupMentions(text, members);
  const eligible = members.filter((m) => (m.whoCanAsk ?? "group") !== "owner");
  const unknown = parsed.mentions.filter((m) => m.match === "none" && m.leading).map((m) => m.word);
  if (parsed.ambiguous) return { ids: [], addressed: true, unknown, ambiguous: true, noOne: true };
  if (parsed.everyones) return { ids: eligible.map((m) => m.id), addressed: true, unknown, ambiguous: false, noOne: eligible.length === 0 };
  if (parsed.ids.length) {
    return {
      ids: eligible.filter((m) => parsed.ids.includes(m.id)).map((m) => m.id),
      addressed: true, unknown, ambiguous: false, noOne: false,
    };
  }
  if (mode?.kind === "bot") {
    const target = eligible.find((m) => m.id === mode.botId);
    return { ids: target ? [target.id] : [], addressed: false, unknown, ambiguous: false, noOne: !target, replierMissing: !target };
  }
  if (mode?.kind === "all") {
    return { ids: eligible.map((m) => m.id), addressed: false, unknown, ambiguous: false, noOne: eligible.length === 0 };
  }
  return { ids: [], addressed: false, unknown, ambiguous: false, noOne: true };
}

/**
 * 群聊共享上下文：别的成员上一轮 / 更早说过的话（成员自己的话已经在他自己的会话历史里，不重复）。
 * 注意只取本次 owner 消息之前的历史，避免把本轮尚未说完的内容拼进去。
 */
export function groupContextLines(messages = [], { ownerSeq = 0, botId = "", prior = 8, cap = 2600 } = {}) {
  const label = (m) => (m.author === "owner" ? "你" : m.author === "system" ? "系统" : m.botName || "成员");
  const priorLines = messages
    .filter((m) => (m.seq || 0) < ownerSeq && m.author !== "system")
    .filter((m) => m.author === "owner" || (m.botId && m.botId !== botId))
    .slice(-prior)
    .map((m) => `${label(m)}：${String(m.text || "").slice(0, 320)}`);
  const roundLines = messages
    .filter((m) => (m.seq || 0) > ownerSeq && m.author === "bot" && m.botId !== botId)
    .map((m) => `${m.botName || "成员"}：${String(m.text || "").slice(0, 320)}`);
  return [...priorLines, ...roundLines].join("\n").slice(-cap);
}

/**
 * 其他话题最近说了什么：只给 1–2 句，作为背景，不是指令。
 * 目的是解决「新开一个话题就像失忆」——群共识是长期的，这里补最近跨话题的动态。
 */
export function crossTopicDigest(group = {}, messages = [], current = "main", { perTopic = 2, cap = 1200 } = {}) {
  const topics = [{ id: "main", title: "主话题" }, ...(group.threads || [])];
  const label = (m) => (m.author === "owner" ? "你" : m.botName || "成员");
  const parts = [];
  for (const topic of topics) {
    const key = topic.id || "main";
    if (key === current) continue;
    const recent = messages
      .filter((m) => (m.threadId || "main") === key && m.author !== "system" && m.text)
      .slice(-perTopic);
    if (!recent.length) continue;
    parts.push(`[${topic.title || "话题"}] ${recent.map((m) => `${label(m)}：${String(m.text).replace(/\s+/g, " ").slice(0, 160)}`).join(" | ")}`);
  }
  return parts.join("\n").slice(-cap);
}

/**
 * GROUP.md：群档案的只读镜像（DB 是事实源）。成员在自己的 home 里就能看到「这个群是干什么的」，
 * 不必先跑上下文编译器；手改不回写。
 */
/* ── 群里的提问卡片 ────────────────────────────────────────────────────────
 * 1:1 的 ask 挂在 `bot_turns.ask` 上；群消息没有 turn 表，就落在 `meta.ask`。
 * 口径和 1:1 一致：**人一说话就把这个话题里开着的卡一起结掉**，不要求一一对应。
 */
export const GROUP_ASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 当前能答的提问（新的在前，最多 limit 张） */
export function openGroupAsks(messages = [], { now = Date.now(), ttl = GROUP_ASK_TTL_MS, limit = 5 } = {}) {
  return (messages || [])
    .filter((m) => {
      const ask = m?.meta?.ask;
      if (!ask || ask.status !== "open") return false;
      return now - (ask.createdAt || m.createdAt || 0) <= ttl;
    })
    .slice(-limit)
    .reverse()
    .map((m) => ({
      messageId: m.id,
      groupId: m.groupId,
      threadId: m.threadId || "",
      botId: m.botId || null,
      botName: m.botName || "",
      text: String(m.meta.ask.text || m.text || "").slice(0, 300),
      createdAt: m.meta.ask.createdAt || m.createdAt || 0,
    }));
}

/** 人说话了：这个话题里开着的卡一起结掉（原地改 `meta.ask`，调用方负责 persist） */
export function settleGroupAsks(messages = [], { groupId = "", threadId = "", status = "answered", now = Date.now(), ttl = GROUP_ASK_TTL_MS } = {}) {
  let changed = 0;
  for (const m of messages || []) {
    if (groupId && m.groupId !== groupId) continue;
    if ((m.threadId || "") !== (threadId || "")) continue;
    const ask = m?.meta?.ask;
    if (!ask || ask.status !== "open") continue;
    // 超期的先标 expired（和 1:1 的 askOpen 同一口径）：它不该算「被这句话答掉」
    if (now - (ask.createdAt || m.createdAt || 0) > ttl) {
      ask.status = "expired";
      continue;
    }
    ask.status = status;
    ask.answeredAt = now;
    changed += 1;
  }
  return changed;
}

export function groupMarkdown(group = {}, members = []) {
  const lines = [`# ${group.name || "群聊"}`, ""];
  lines.push(group.memo ? `群共识：${group.memo}` : "群共识：还没有写");
  lines.push("", "## 成员", "");
  if (!members.length) lines.push("（还没有成员）");
  for (const m of members) {
    lines.push(`- ${m.name || m.id}${m.duty || m.mission ? `：${m.duty || m.mission}` : ""}`);
  }
  const topics = [{ id: "main", title: "主话题" }, ...(group.threads || [])];
  lines.push("", "## 话题", "");
  if (topics.length === 1) lines.push("- 主话题");
  else for (const t of topics) lines.push(`- ${t.title || "话题"}`);
  lines.push("", "## 回复规则", "");
  lines.push(`- 谁回：${group.replyMode?.kind === "all" ? "全体" : group.replyMode?.kind === "bot" ? "固定成员" : "@ 谁谁回"}`);
  lines.push(`- 节奏：${group.replyMode?.pace === "serial" ? "依次" : "并行"}`);
  lines.push("", "## 说明", "", "这个文件由 Cockpit Harness 从群档案生成，是只读镜像；手改不回写。");
  return `${lines.join("\n")}\n`;
}
