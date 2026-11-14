/**
 * 人物建模：从聊天记录里算出「可观测特征」，而不是只存原始消息。
 *
 * 原则：
 *  - 只写能从数据里数出来的东西（话量、句长、回复速度、表情/语气词、提问比例、活跃时段、高频词），
 *    不猜心理标签（「内向/外向」这类必须由人确认或由模型给建议）。
 *  - 每条结论都带证据原话，写进 observations 时是 pending，等人工确认（或显式 requireConfirm=false）。
 *  - 可选模型模式：把该人最近的若干条发言交给 Ark，产出人设卡草稿；没有 key 时只用统计特征。
 */
import crypto from "node:crypto";
import { chat as arkChat, resolveArkKey } from "../knowledge/ark.mjs";

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const LAUGH = /(哈哈+|嘿嘿+|233+|笑死|hhhh+)/i;
const POLITE = /(谢谢|多谢|麻烦|辛苦了|收到|好的|ok\b|好滴|行)/i;
const FILLER = /(就是|然后|那个|其实|反正|怎么讲|有点|确实|应该|可能)/;
const STOP = new Set(["这个", "那个", "什么", "怎么", "可以", "我们", "你们", "他们", "自己", "现在", "然后", "还是", "就是", "不是", "没有", "知道", "觉得", "因为", "所以", "如果", "但是", "已经", "需要", "一个", "一下", "时候", "今天", "明天", "昨天"]);

function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

/** 把一个人所有发言算成特征表 */
export function computeFeatures(msgs = [], name = "", context = []) {
  const texts = msgs.map((m) => String(m.text || "")).filter(Boolean);
  const n = texts.length;
  if (!n) return null;
  const lens = texts.map((t) => t.length);
  const emoji = texts.filter((t) => EMOJI.test(t)).length;
  const laugh = texts.filter((t) => LAUGH.test(t)).length;
  const polite = texts.filter((t) => POLITE.test(t)).length;
  const filler = texts.filter((t) => FILLER.test(t)).length;
  const question = texts.filter((t) => /[?？]\s*$/.test(t) || /(吗|么|呢|咋|如何|为什么|怎么)\s*[?？]?$/.test(t)).length;
  const exclaim = texts.filter((t) => /[!！]/.test(t)).length;
  const ellipsis = texts.filter((t) => /(\.\.\.|。。。|…)/.test(t)).length;

  const hours = new Array(24).fill(0);
  for (const m of msgs) {
    const at = m.date ? new Date(m.date).getTime() : 0;
    if (at) hours[new Date(at).getHours()] += 1;
  }
  const activeHours = hours.map((c, h) => ({ h, c })).sort((a, b) => b.c - a.c).slice(0, 3).map((x) => x.h);

  // 回复时延 / 互动对象：必须在「整段会话时间线」上算，只用这个人自己的消息会全是同一个人相邻
  const timeline = context.length ? context : msgs;
  const gaps = [];
  const interlocutors = new Map();
  const byChat = new Map();
  for (const m of timeline) {
    const chat = m.chat || "";
    if (!byChat.has(chat)) byChat.set(chat, []);
    byChat.get(chat).push(m);
  }
  for (const list of byChat.values()) {
    const sorted = [...list].sort((a, b) => (Date.parse(a.date || "") || 0) - (Date.parse(b.date || "") || 0));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.from === cur.from) continue;
      const a = Date.parse(prev.date || "");
      const b = Date.parse(cur.date || "");
      if (!a || !b || b < a) continue;
      const gap = (b - a) / 60000;
      // 这个人「接话」的时延
      if (name && cur.from === name && gap >= 0 && gap < 24 * 60) gaps.push(gap);
      if (name) {
        if (prev.from === name && cur.from !== name) interlocutors.set(cur.from, (interlocutors.get(cur.from) || 0) + 1);
        else if (cur.from === name && prev.from !== name) interlocutors.set(prev.from, (interlocutors.get(prev.from) || 0) + 1);
      }
    }
  }

  const words = new Map();
  for (const t of texts) {
    for (const w of (t.match(/[\u4e00-\u9fa5]{2,4}/g) || [])) {
      if (STOP.has(w)) continue;
      words.set(w, (words.get(w) || 0) + 1);
    }
  }
  const topWords = [...words.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, c]) => ({ w, c }));

  // 活跃天 / 每日密度 / 群与私聊分布 / 最常互动的人
  const days = new Set();
  let groupMsgs = 0;
  let privateMsgs = 0;
  for (const m of msgs) {
    const at = m.date ? new Date(m.date).getTime() : 0;
    if (at) days.add(new Date(at).toISOString().slice(0, 10));
    if (String(m.chat || "").includes("@chatroom")) groupMsgs += 1; else privateMsgs += 1;
  }
  const topInterlocutors = [...interlocutors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, c]) => ({ w, c }));

  return {
    count: n,
    activeDays: days.size,
    perDay: days.size ? Math.round(n / days.size) : n,
    groupMsgs,
    privateMsgs,
    topInterlocutors,
    avgLen: Math.round(lens.reduce((a, b) => a + b, 0) / n),
    medianLen: median(lens),
    emojiPct: pct(emoji, n),
    laughPct: pct(laugh, n),
    politePct: pct(polite, n),
    fillerPct: pct(filler, n),
    questionPct: pct(question, n),
    exclaimPct: pct(exclaim, n),
    ellipsisPct: pct(ellipsis, n),
    replyMedianMin: gaps.length >= 3 ? Math.round(median(gaps)) : null,
    replySamples: gaps.length,
    activeHours,
    topWords,
    samples: [...msgs].filter((m) => String(m.text || "").length >= 4).slice(-40).map((m) => ({ at: m.date || "", text: String(m.text).slice(0, 160) })),
  };
}

/**
 * 引用可核对性：模型的 evidence 必须是输入里出现过的原话。
 *
 * 不核对的后果：画像看起来每条都带「原文」，但其中一部分是模型自己编的；
 * 一旦有人拿它当依据，整份画像的可信度就没了。这里只做保守核对（宽松归一化 + 允许截断），
 * 核不过的不删、不拦，只降权并标出来等人看。
 */
export function normalizeForMatch(text) {
  return String(text || "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[，。、；：！？,.;:!?"'“”‘’（）()【】\[\]—…~·]/g, "");
}

export function evidenceMatches(evidence, corpus) {
  const e = normalizeForMatch(evidence);
  if (e.length < 6) return false; // 太短（「等老板定」这种）没法判断真伪
  const c = normalizeForMatch(corpus);
  if (!c) return false;
  if (c.includes(e)) return true;
  // 模型常把原话截断/加省略号：允许「证据的前 80%」在语料里
  const head = e.slice(0, Math.max(6, Math.floor(e.length * 0.8)));
  return c.includes(head);
}

/**
 * 证据是不是「统计值」冒充的原话。
 *
 * 老提示词把统计事实一起喂给模型，模型会把「问句 19%」「句长中位 10 字」当成 evidence 写回来 ——
 * 那不是原话，也没法核对。这类不该标成「引用待核对」，它的问题更根本：这条结论没有原话支撑。
 * 现在统计值走 measures，模型不该再产出这类 evidence，这里用于识别存量脏数据。
 */
const STAT_PATTERNS = [
  /中位\s*\d+\s*字/, /中位时延/, /接话时延中位/, /问句\s*\d+%/, /礼貌用语\s*\d+%/,
  /群聊\s*\d+\s*条/, /私聊\s*\d+\s*条/, /群聊\s*\d+%/, /活跃时段/, /高频词/,
  /样本\s*\d+\s*条/, /平均每个活跃日/, /表情出现率/, /感叹号出现率/, /口语化用词占/,
  // 老版本把「发言人146条 / 活跃54天 / 每日3条」「笑声86%」这类直接当 evidence 写过
  /发言\s*\d+\s*条/, /活跃\s*\d+\s*天/, /每日\s*\d+\s*条/, /笑声\s*\d+%/, /表情\s*\d+%/,
  /词频/, /出现率/,
  /^\d+(?:\.\d+)?%$/,
];

export function looksLikeStat(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return STAT_PATTERNS.some((re) => re.test(t));
}

/**
 * 分析缓存的「契约版本」：提示词 / 输出字段 / 写入逻辑变化时必须递增。
 *
 * 只按样本 hash 缓存有个致命问题：模型换了输出结构（比如 traits 从对象数组变成字符串数组）时，
 * 卡片能解析、缓存被写、但一条结论都落不了库 —— 之后同一份样本永远命中缓存，永远 0 条结论。
 * v2：补上「缓存必须对应已落库的结论」，并让旧版本写出的空缓存（只有一句话、没有结论）作废。
 */
export const ANALYSIS_CACHE_VERSION = "v2";

/** 分析缓存键：契约版本 + 模型 + 人 + 样本。建模与「建模计划」必须用同一个函数算 */
export function analysisCacheHash(name, features, model = "") {
  const samples = (features?.samples || []).map((s) => s.text).join("");
  return crypto.createHash("sha1").update([ANALYSIS_CACHE_VERSION, model || "default", name, samples].join("|")).digest("hex");
}

/**
 * 可观测特征（measure）：数得出来、随时可以重算的东西。
 *
 * 这些**不进记忆层**（observations）：一次建模算出「群聊 0% / 私聊 100%」，下次样本变了算出 1% / 99%，
 * 两条都叫「事实」的话，失效（invalidate）永远追不上重算的速度，人物卡里会堆满互相矛盾的测量值。
 * 记忆层只放「重算不出来、需要人确认」的观察（belief）；measure 进 measures 表，只留最新值 + 上一次值。
 *
 * 返回项：{ key, field, label, value, short, num, quote }
 *  - value 给人看（含阈值判断，例如「话多」/「话少」）
 *  - short 给注入用（只有数字，省预算）
 */
export function computeMeasures(f) {
  if (!f) return [];
  const out = [];
  const add = (key, field, label, value, short, num, quote) => out.push({ key, field, label, value, short, num, quote });

  if (f.count >= 200) add("msgs.count", "traits", "发言量", `话多：发言量大（样本 ${f.count} 条）`, `发言 ${f.count} 条`, f.count, `共 ${f.count} 条发言`);
  else if (f.count < 30) add("msgs.count", "traits", "发言量", `话少：发言稀疏（样本 ${f.count} 条）`, `发言 ${f.count} 条`, f.count, `共 ${f.count} 条发言`);
  else add("msgs.count", "traits", "发言量", `发言量中等（样本 ${f.count} 条）`, `发言 ${f.count} 条`, f.count, `共 ${f.count} 条发言`);

  // 用中位数判断（转发/文章会把均值拉飞）：中位长 = 长段落，中位短 = 碎片化
  if (f.medianLen >= 40) add("len.median", "traits", "句长", `习惯长段落表达（中位 ${f.medianLen} 字）`, `句长中位 ${f.medianLen} 字`, f.medianLen, `中位 ${f.medianLen} 字/条（均值 ${f.avgLen}）`);
  else if (f.medianLen <= 12) add("len.median", "traits", "句长", `习惯短句、碎片化回复（中位 ${f.medianLen} 字）`, `句长中位 ${f.medianLen} 字`, f.medianLen, `中位 ${f.medianLen} 字/条`);
  else add("len.median", "traits", "句长", `句长中位 ${f.medianLen} 字（均值 ${f.avgLen}）`, `句长中位 ${f.medianLen} 字`, f.medianLen, `中位 ${f.medianLen} 字/条`);

  if (f.replyMedianMin != null) {
    const m = f.replyMedianMin;
    const human = m <= 90 ? `${m} 分钟` : `${(m / 60).toFixed(1)} 小时`;
    const tone = m <= 10 ? "回复很快" : m <= 60 ? "回复节奏中等" : "回复偏慢";
    add("reply.median", "communication", "接话时延", `${tone}：中位时延约 ${human}`, `接话时延 ${human}`, m, `基于 ${f.replySamples} 次跨人回复间隔`);
  }
  add("msgs.per_day", "traits", "发言密度", f.activeDays >= 5
    ? `平均每个活跃日 ${f.perDay} 条发言（共 ${f.activeDays} 天）`
    : `活跃 ${f.activeDays} 天，每天 ${f.perDay} 条`, `每日 ${f.perDay} 条`, f.perDay, "按自然日统计");
  if (f.groupMsgs || f.privateMsgs) {
    const total = f.groupMsgs + f.privateMsgs;
    add("chat.ratio", "situation", "群 / 私聊", `群聊 ${Math.round((f.groupMsgs / total) * 100)}% / 私聊 ${Math.round((f.privateMsgs / total) * 100)}%`, `群聊 ${Math.round((f.groupMsgs / total) * 100)}%`, f.groupMsgs, `群 ${f.groupMsgs} 条，私聊 ${f.privateMsgs} 条`);
  }
  if (f.topInterlocutors?.length) {
    add("interlocutors.top", "situation", "最常互动", `最常互动：${f.topInterlocutors.map((x) => x.w).join(" / ")}`, `常互动 ${f.topInterlocutors.map((x) => x.w).join("/")}`, f.topInterlocutors.length, `按相邻发言配对：${f.topInterlocutors.map((x) => `${x.w}×${x.c}`).join(" ")}`);
  }
  add("ratio.question", "communication", "提问比例", f.questionPct >= 25 ? `常用提问推进对话（问句 ${f.questionPct}%）` : `问句占 ${f.questionPct}%`, `问句 ${f.questionPct}%`, f.questionPct, `问句占 ${f.questionPct}%`);
  add("ratio.polite", "communication", "礼貌用语", f.politePct >= 20 ? `礼貌用语高频（谢谢 / 收到 / 好的，${f.politePct}%）` : `礼貌用语占 ${f.politePct}%`, `礼貌 ${f.politePct}%`, f.politePct, `礼貌用语占 ${f.politePct}%`);
  add("ratio.laugh", "style", "笑声", f.laughPct >= 10 ? `爱用笑声 / 网络语气（哈哈、笑死、233，${f.laughPct}%）` : `笑声出现率 ${f.laughPct}%`, `笑声 ${f.laughPct}%`, f.laughPct, `出现率 ${f.laughPct}%`);
  add("ratio.emoji", "style", "表情", f.emojiPct >= 15 ? `常用表情符号（${f.emojiPct}%）` : `表情出现率 ${f.emojiPct}%`, `表情 ${f.emojiPct}%`, f.emojiPct, `表情出现率 ${f.emojiPct}%`);
  if (f.ellipsisPct >= 12) add("ratio.ellipsis", "style", "省略号", `常用省略号语气（…、。。。，${f.ellipsisPct}%）`, `省略号 ${f.ellipsisPct}%`, f.ellipsisPct, `出现率 ${f.ellipsisPct}%`);
  if (f.exclaimPct >= 25) add("ratio.exclaim", "style", "感叹号", `语气偏强烈（感叹号 ${f.exclaimPct}%）`, `感叹号 ${f.exclaimPct}%`, f.exclaimPct, `感叹号出现率 ${f.exclaimPct}%`);
  if (f.fillerPct >= 25) add("ratio.filler", "style", "口语化", `口语化明显（然后 / 其实 / 就是，${f.fillerPct}%）`, `口语化 ${f.fillerPct}%`, f.fillerPct, `口语化用词占 ${f.fillerPct}%`);
  if (f.activeHours.length) {
    add("hours.active", "situation", "活跃时段", `活跃时段集中在 ${f.activeHours.map((h) => `${h}:00`).join(" / ")}`, `活跃 ${f.activeHours.join("/")} 点`, f.activeHours.length, "按发言时间统计");
  }
  if (f.topWords.length) {
    add("words.top", "situation", "高频词", `高频词：${f.topWords.slice(0, 5).map((w) => w.w).join("、")}`, `高频词 ${f.topWords.slice(0, 3).map((w) => w.w).join("/")}`, f.topWords.length, `词频 ${f.topWords.map((w) => `${w.w}×${w.c}`).join(" ")}`);
  }
  return out;
}

/**
 * 特征 → 可读结论（带证据）。
 * 注意：这只是 computeMeasures 的薄包装，**不再写进 observations**；
 * 旧版本把它的输出当事实落库，导致失效（invalidate）永远追不上重算。
 */
export function describePerson(name, f) {
  void name;
  return computeMeasures(f).map((m) => ({ key: m.key, field: m.field, value: m.value, quote: m.quote, confidence: 0.7 }));
}

/**
 * LLM 人像分析：把「这个人的发言 + 上下文 + 统计事实」交给模型，产出结构化画像。
 * 统计只作为事实底座，结论由模型给；每条结论必须带原文证据，材料不足写「未知」。
 */
const ANALYSIS_SYSTEM = [
  "你在做人物画像分析（不是聊天摘要）。输入会给出：某个联系人的发言样本、他与别人/与本人的上下文片段、以及统计事实。",
  "只根据输入作答，不得编造身份、年龄、职业、住址、公司；材料不足就在对应项写「未知」。",
  "输出严格 JSON（不要 markdown 代码块），结构：",
  "{",
  '  "oneLiner": "一句话概括这个人怎么说话、怎么处事（<=45字，不要心理诊断）",',
  '  "identity": {"value": "可确证的身份线索，否则未知", "evidence": "原文<=40字"},',
  '  "role": {"value": "职业/角色线索，否则未知", "evidence": "原文<=40字"},',
  '  "traits": [{"value": "<=12字的性格/行为特征", "evidence": "原文<=40字"}],',
  '  "communication": [{"value": "<=16字沟通方式", "evidence": "原文<=40字"}],',
  '  "values": [{"value": "<=16字价值取向/在意什么", "evidence": "原文<=40字"}],',
  '  "goals": [{"value": "<=16字目标或持续关注的事", "evidence": "原文<=40字"}],',
  '  "decisions": [{"value": "<=16字决策习惯", "evidence": "原文<=40字"}],',
  '  "topics": ["<=10字常聊话题"],',
  '  "relationshipToMe": {"value": "与本人的关系判断（不确定写未知）", "evidence": "原文<=40字"},',
  '  "confidence": 0.0',
  "}",
  "traits/communication/values/goals/decisions 各最多 3 条；没有依据就空数组。evidence 必须是输入里出现过的原话片段。",
].join("\n");

export async function analyzePersonWithLLM({ name, relation = "", stats = null, samples = [], context = [], key, model, signal = null } = {}) {
  const arkKey = key || resolveArkKey("");
  if (!arkKey) return null;
  const sampleText = samples.slice(-8).map((s) => `- ${String(s.text || "").slice(0, 90)}`).join("\n");
  if (sampleText.length < 40) return null;
  const contextText = context.slice(-6).map((c) => `- ${c.from}: ${String(c.text || "").slice(0, 70)}`).join("\n");
  const statText = stats ? [
    `发言 ${stats.count} 条 / 活跃 ${stats.activeDays} 天 / 每日 ${stats.perDay} 条`,
    `句长中位 ${stats.medianLen} 字`,
    stats.replyMedianMin != null ? `接话时延中位 ${stats.replyMedianMin} 分钟（${stats.replySamples} 次）` : "",
    `问句 ${stats.questionPct}% / 礼貌用语 ${stats.politePct}% / 笑声 ${stats.laughPct}% / 表情 ${stats.emojiPct}%`,
    `群聊 ${stats.groupMsgs} 条 / 私聊 ${stats.privateMsgs} 条`,
    `活跃时段 ${stats.activeHours.map((h) => `${h}点`).join(" ")}`,
    stats.topWords?.length ? `高频词 ${stats.topWords.map((w) => w.w).join("、")}` : "",
    stats.topInterlocutors?.length ? `最常互动 ${stats.topInterlocutors.map((x) => x.w).join("、")}` : "",
  ].filter(Boolean).join("\n") : "";
  const res = await arkChat([
    { role: "system", content: ANALYSIS_SYSTEM },
    {
      role: "user",
      content: [
        `联系人：${name}${relation ? `（已知关系：${relation}）` : ""}`,
        statText ? `统计事实：\n${statText}` : "",
        `他的发言样本：\n${sampleText}`,
        contextText ? `上下文（别人说的话，用于判断互动方式）：\n${contextText}` : "",
      ].filter(Boolean).join("\n\n"),
    },
  ], {
    key: arkKey,
    maxTokens: 700,
    // 外部 signal（取消任务）+ 单次超时；任一触发都中断当前请求
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
    ...(model ? { model } : {}),
  });
  const text = String(res.text || "").trim();
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
  catch { return null; }
}

