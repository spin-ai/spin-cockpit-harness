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

/** 特征 → 可读结论（带证据），每条都写清楚「依据是什么」 */
export function describePerson(name, f) {
  if (!f) return [];
  const out = [];
  const add = (field, value, quote) => out.push({ field, value, quote, confidence: 0.7 });

  if (f.count >= 200) add("traits", "话多：发言量大（样本 " + f.count + " 条）", `共 ${f.count} 条发言`);
  else if (f.count < 30) add("traits", "话少：发言稀疏（样本 " + f.count + " 条）", `共 ${f.count} 条发言`);

  // 用中位数判断（转发/文章会把均值拉飞）：中位长 = 长段落，中位短 = 碎片化
  if (f.medianLen >= 40) add("traits", "习惯长段落表达", `中位 ${f.medianLen} 字/条（均值 ${f.avgLen}）`);
  else if (f.medianLen <= 12) add("traits", "习惯短句、碎片化回复", `中位 ${f.medianLen} 字/条`);

  if (f.replyMedianMin != null) {
    const m = f.replyMedianMin;
    const human = m <= 90 ? `${m} 分钟` : `${(m / 60).toFixed(1)} 小时`;
    const tone = m <= 10 ? "回复很快" : m <= 60 ? "回复节奏中等" : "回复偏慢";
    add("communication", `${tone}：中位时延约 ${human}`, `基于 ${f.replySamples} 次跨人回复间隔`);
  }
  if (f.activeDays >= 5) add("traits", `平均每个活跃日 ${f.perDay} 条发言（共 ${f.activeDays} 天）`, "按自然日统计");
  if (f.groupMsgs || f.privateMsgs) {
    const total = f.groupMsgs + f.privateMsgs;
    add("situation", `群聊 ${Math.round((f.groupMsgs / total) * 100)}% / 私聊 ${Math.round((f.privateMsgs / total) * 100)}%`, `群 ${f.groupMsgs} 条，私聊 ${f.privateMsgs} 条`);
  }
  if (f.topInterlocutors?.length) {
    add("situation", `最常互动：${f.topInterlocutors.map((x) => x.w).join(" / ")}`, `按相邻发言配对：${f.topInterlocutors.map((x) => `${x.w}×${x.c}`).join(" ")}`);
  }
  if (f.questionPct >= 25) add("communication", "常用提问推进对话", `问句占 ${f.questionPct}%`);
  if (f.politePct >= 20) add("communication", "礼貌用语高频（谢谢 / 收到 / 好的）", `礼貌用语占 ${f.politePct}%`);
  if (f.laughPct >= 10) add("style", "爱用笑声 / 网络语气（哈哈、笑死、233）", `出现率 ${f.laughPct}%`);
  if (f.emojiPct >= 15) add("style", "常用表情符号", `表情出现率 ${f.emojiPct}%`);
  if (f.ellipsisPct >= 12) add("style", "常用省略号语气（…、。。。）", `出现率 ${f.ellipsisPct}%`);
  if (f.exclaimPct >= 25) add("style", "语气偏强烈（感叹号多）", `感叹号出现率 ${f.exclaimPct}%`);
  if (f.fillerPct >= 25) add("style", "口语化明显（然后 / 其实 / 就是）", `口语化用词占 ${f.fillerPct}%`);
  if (f.activeHours.length) add("situation", `活跃时段集中在 ${f.activeHours.map((h) => `${h}:00`).join(" / ")}`, "按发言时间统计");
  if (f.topWords.length) add("situation", `高频词：${f.topWords.slice(0, 5).map((w) => w.w).join("、")}`, `词频 ${f.topWords.map((w) => `${w.w}×${w.c}`).join(" ")}`);
  void name;
  return out;
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
  const sampleText = samples.slice(-12).map((s) => `- ${String(s.text || "").slice(0, 100)}`).join("\n");
  if (sampleText.length < 40) return null;
  const contextText = context.slice(-12).map((c) => `- ${c.from}: ${String(c.text || "").slice(0, 80)}`).join("\n");
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
    maxTokens: 1200,
    // 外部 signal（取消任务）+ 单次超时；任一触发都中断当前请求
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
    ...(model ? { model } : {}),
  });
  const text = String(res.text || "").trim();
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
  catch { return null; }
}

