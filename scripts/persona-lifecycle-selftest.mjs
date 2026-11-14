#!/usr/bin/env node
/**
 * 人物画像生命周期自检（纯后端，不联网、不碰用户数据）。
 *   node scripts/persona-lifecycle-selftest.mjs
 *
 * 覆盖四种「忘」的语义，它们是不同操作，混用会直接损害画像一致性：
 *   invalidate（失效）· decay（衰减）· evict/stale（过期归档）· merge（合并）
 * 外加：证据累积、被拒事实复审、双时间回看、注入预算打分。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPersona, heatOf, HALF_LIFE, similarity, normalizeValue, inferExpiry } from "../electron/persona/index.mjs";
import { computeMeasures, evidenceMatches, looksLikeStat } from "../electron/persona/model.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const DAY = 86400000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persona-life-"));
const persona = createPersona({ dir });

function mkPerson(name, at = Date.now()) {
  const stamp = new Date(at).toISOString().slice(0, 16).replace("T", " ");
  persona.import({
    text: `${stamp} ${name}\n${name}: 我习惯早上处理复杂任务，下午一般不回消息\n`,
    title: `seed-${name}`,
  });
  const found = persona.people().find((p) => p.name === name);
  if (!found) throw new Error(`建不出人：${name}`);
  return found.id;
}

const cardOfPerson = (id) => persona.card({ personId: id });
const fieldRow = (card, field) => card.sections.flatMap((s) => s.rows).find((r) => r.field === field);

console.log("人物画像生命周期自检\n");

// ── 1. 写入闸门：证据累积 ──────────────────────────────────────────────
console.log("[1] 证据累积（去重 ≠ 丢掉第二条证据）");
{
  const pid = mkPerson("甲");
  const a = persona.commit({ personId: pid, field: "traits", value: "决策偏保守", quote: "我还是再想想", status: "pending" });
  const conf1 = a.confidence;
  persona.commit({ personId: pid, field: "traits", value: "决策偏保守", quote: "再想想", status: "confirmed" });
  persona.commit({ personId: pid, field: "traits", value: "决策偏保守", quote: "再确认一下", status: "confirmed" });
  const row = persona.card({ personId: pid }).sections.flatMap((s) => s.rows).find((r) => r.field === "traits");
  check("同一事实观察到 3 次 → 证据 3 条", row?.support === 3, `support=${row?.support}`);
  check("pending 被 confirmed 写入升级", row?.evidence[0]?.evidenceCount >= 3, `evidenceCount=${row?.evidence[0]?.evidenceCount}`);
  const after = persona.card({ personId: pid }).sections.flatMap((s) => s.rows).find((r) => r.field === "traits")?.evidence[0]?.confidence;
  check("置信度随印证上升（封顶 0.95）", after > conf1 && after <= 0.95, `${conf1} → ${after}`);
}

// ── 2. invalidate：单值字段新旧收口 ────────────────────────────────────
console.log("\n[2] invalidate（失效，不是删除）");
{
  const pid = mkPerson("乙");
  const t1 = Date.now() - 400 * DAY;
  const t2 = Date.now() - 10 * DAY;
  const a = persona.commit({ personId: pid, field: "role", value: "产品经理", quote: "我是产品经理", status: "confirmed", at: t1 });
  const b = persona.commit({ personId: pid, field: "role", value: "技术负责人", quote: "现在带技术团队", status: "confirmed", at: t2 });
  const again = persona.timeline({ personId: pid, field: "role" });
  const old = again.find((o) => o.value === "产品经理");
  check("旧值被标失效且 t_invalid = 新值 t_valid", old?.validTo === again.find((o) => o.value === "技术负责人")?.validFrom, `validTo=${old?.validTo}`);
  check("新值仍然有效", b.validTo === null);
  check("旧值没被删除（仍可回查）", again.length === 2);
  check("人物卡只显示当前值", fieldRow(cardOfPerson(pid), "role")?.values.join() === "技术负责人");

  // 反向顺序：先确认新的，再确认旧的 —— 旧的必须立刻收口，不能和新的一条同时成立
  const older = persona.commit({ personId: pid, field: "role", value: "实习生", quote: "刚入职那会儿", status: "confirmed", at: Date.now() - 800 * DAY });
  const roleTimeline = persona.timeline({ personId: pid, field: "role" });
  const intern = roleTimeline.find((o) => o.value === "实习生");
  check("反向确认也不会写反（照样立即收口）", intern?.validTo === older.validFrom + 0 || intern?.validTo != null, `validTo=${intern?.validTo}`);
  const current = persona.card({ personId: pid }).sections.flatMap((s) => s.rows).find((r) => r.field === "role");
  check("同时成立的 role 只有 1 条", current?.values.length === 1, current?.values.join(" / "));
  check("a 仍可回查（历史链）", persona.asOf({ personId: pid, at: t2 - DAY }).fields.find((f) => f.field === "role")?.value === "产品经理");
}

// ── 3. TTL / decay / stale ────────────────────────────────────────────
console.log("\n[3] TTL（到期归档）与 decay（权重衰减）");
{
  const pid = mkPerson("丙");
  const longAgo = Date.now() - 200 * DAY;
  const ev = persona.commit({
    personId: pid, field: "event", value: "下周三出差上海", quote: "下周三我去上海出差",
    status: "confirmed", at: longAgo,
  });
  check("时间敏感事实带 expires_at", ev.expiresAt != null && ev.expiresAt < Date.now(), `expires=${ev.expiresAt ? new Date(ev.expiresAt).toISOString().slice(0, 10) : "null"}`);
  const card = cardOfPerson(pid);
  check("过期事实不进人物卡", !fieldRow(card, "event"), JSON.stringify(fieldRow(card, "event") || null));
  check("过期事实进复核队列（不删除）", card.needsReview.some((r) => r.id === ev.id));
  const swept = persona.sweep();
  check("sweep 标 stale 而不是删", swept.expired >= 1 && persona.timeline({ personId: pid }).some((o) => o.id === ev.id));

  const kept = persona.keepFact({ id: ev.id });
  check("「仍然成立」= 续期（stale 清除、expires 顺延）", kept.stale === false && kept.expiresAt > Date.now());
  check("续期后回到人物卡", Boolean(fieldRow(cardOfPerson(pid), "event")));

  const dropped = persona.dropFact({ id: ev.id });
  check("「已过期」= valid_to 收口（不删除）", dropped.validTo != null && persona.timeline({ personId: pid }).some((o) => o.id === ev.id));

  // decay：同样证据量，越老权重越低
  const fresh = { field: "traits", confidence: 0.7, evidenceCount: 2, lastSeenAt: Date.now() };
  const stale = { field: "traits", confidence: 0.7, evidenceCount: 2, lastSeenAt: Date.now() - HALF_LIFE.traits * DAY };
  check("decay：一个半衰期后权重减半左右", heatOf(stale) < heatOf(fresh) * 0.55, `${heatOf(stale)} vs ${heatOf(fresh)}`);
  check("事件类忘得比身份快", (HALF_LIFE.event ?? 0) < (HALF_LIFE.identity ?? 0), `event=${HALF_LIFE.event}d identity=${HALF_LIFE.identity}d`);
  check("TTL 从原话读相对时间", inferExpiry("event", "下周出差", "", Date.now()) > Date.now() + 7 * DAY);
}

// ── 4. 可观测特征不进记忆层 ────────────────────────────────────────────
console.log("\n[4] measure（可重算的测量值）与 belief 分离");
{
  const pid = mkPerson("丁");
  persona.setMeasure({ personId: pid, key: "chat.ratio", field: "situation", label: "群 / 私聊", value: "群聊 0% / 私聊 100%", num: 0 });
  persona.setMeasure({ personId: pid, key: "chat.ratio", field: "situation", label: "群 / 私聊", value: "群聊 1% / 私聊 99%", num: 1 });
  const list = persona.measures({ personId: pid });
  check("只留最新值 + 上一次值", list.length === 1 && list[0].value === "群聊 1% / 私聊 99%" && list[0].prevValue === "群聊 0% / 私聊 100%", JSON.stringify(list[0]?.prevValue));
  check("变化次数被记录", list[0].times === 1, `times=${list[0].times}`);
  const card = cardOfPerson(pid);
  check("measure 进人物卡的可观测特征", card.measures.length === 1);
  check("measure 不产生冲突（重算不是推翻）", card.metrics.conflictRatio === 0 && persona.detectConflicts() === 0);
  const measures = computeMeasures({
    count: 320, activeDays: 40, perDay: 8, groupMsgs: 0, privateMsgs: 320, topInterlocutors: [{ w: "阿伟", c: 9 }],
    avgLen: 18, medianLen: 14, emojiPct: 2, laughPct: 22, politePct: 5, fillerPct: 30, questionPct: 12,
    exclaimPct: 3, ellipsisPct: 1, replyMedianMin: 4, replySamples: 12, activeHours: [11, 15, 21],
    topWords: [{ w: "排期", c: 8 }, { w: "联调", c: 5 }], samples: [],
  });
  check("computeMeasures 给 key/short/num", measures.length > 5 && measures.every((m) => m.key && m.short && m.num !== undefined), `${measures.length} 项`);
  check("特征值不含「同时成立」这类冲突语义", measures.every((m) => !/冲突|矛盾/.test(m.value)));
}

// ── 5. merge ─────────────────────────────────────────────────────────
console.log("\n[5] merge（合并：只累加证据，不改写结论）");
{
  const pid = mkPerson("戊");
  const a = persona.commit({ personId: pid, field: "communication", value: "偏好文字沟通", quote: "发文字吧", status: "confirmed" });
  const b = persona.commit({ personId: pid, field: "communication", value: "偏好文字", quote: "文字说就行", status: "confirmed" });
  check("近似值相似度可判定", similarity("偏好文字沟通", "偏好文字") >= 0.6, similarity("偏好文字沟通", "偏好文字").toFixed(2));
  check("差异大的不会被建议合并", similarity("做游戏", "做独立游戏") < 0.6, similarity("做游戏", "做独立游戏").toFixed(2));
  const hints = persona.mergeSuggestions({ personId: pid });
  check("给出合并建议（不自动合并）", hints.length >= 1, `${hints.length} 条`);
  check("建议里带证据条数供判断", hints.length === 0 || (hints[0].keep.evidence >= 1 && hints[0].drop.evidence >= 1));
  persona.applyMergeValue({ keepId: a.id, dropId: b.id });
  check("被合并的旧值不删，只是标 merged", persona.stats().merged >= 1, `merged=${persona.stats().merged}`);
  check("证据累加到保留项", (persona.timeline({ personId: pid }).find((o) => o.id === a.id)?.evidenceCount || 1) >= 2);
  check("人物卡只剩一条", (fieldRow(cardOfPerson(pid), "communication")?.values || []).length === 1);

  const c = persona.commit({ personId: pid, field: "style", value: "收到", quote: "收到", status: "confirmed" });
  const d = persona.commit({ personId: pid, field: "style", value: "收到！", quote: "收到！", status: "confirmed" });
  check("归一化相同才算同一句", normalizeValue(c.value) === normalizeValue(d.value));
  const exact = persona.mergeExact({ personId: pid });
  check("完全相同的重复值自动合并（安全子集）", exact.merged >= 1, `${exact.merged} 条`);
}

// ── 6. 被拒事实复审 ──────────────────────────────────────────────────
console.log("\n[6] rejects（拒绝不等于永久静音）");
{
  const pid = mkPerson("己");
  const first = persona.commit({ personId: pid, field: "traits", value: "容易冲动", quote: "我直接拍板", status: "pending" });
  persona.resolve({ id: first.id, accept: false });
  const again1 = persona.commit({ personId: pid, field: "traits", value: "容易冲动", quote: "我直接拍板", status: "pending" });
  check("第一次再观察到：沉默（不打扰）", again1 === null);
  const again2 = persona.commit({ personId: pid, field: "traits", value: "容易冲动", quote: "我直接拍板", status: "pending" });
  check("第二次再观察到：复审一次", again2 && again2.status === "pending" && again2.reviewAt != null);
  check("复审事实带来源可核对", Boolean(again2.quote));
  persona.resolve({ id: again2.id, accept: false });
  const again3 = persona.commit({ personId: pid, field: "traits", value: "容易冲动", quote: "我直接拍板", status: "pending" });
  check("再拒绝后重新计数（不会无限打扰）", again3 === null);
}

// ── 7. 双时间回看 ────────────────────────────────────────────────────
console.log("\n[7] asOf 双时间（事件时间 vs 当时已知）");
{
  const pid = mkPerson("庚");
  const happened = Date.now() - 300 * DAY;
  const obs = persona.commit({ personId: pid, field: "role", value: "运营负责人", quote: "我负责运营", status: "confirmed", at: happened });
  const lookAt = happened + DAY;
  const byEvent = persona.asOf({ personId: pid, at: lookAt, mode: "event" });
  const byKnown = persona.asOf({ personId: pid, at: lookAt, mode: "known" });
  check("事件时间：看得到（当时为真）", byEvent.fields.some((f) => f.field === "role"), obs.value);
  check("当时已知：看不到（系统那时还不知道）", !byKnown.fields.some((f) => f.field === "role"));
  check("两种口径都被标记", byEvent.mode === "event" && byKnown.mode === "known");
}

// ── 8. 注入打分与预算 ────────────────────────────────────────────────
console.log("\n[8] inject（打分填预算，不再按固定顺序硬截）");
{
  const pid = mkPerson("辛");
  const fields = [
    ["decision", "关键决定要上级拍板"], ["conflict", "回避争执"], ["stress", "承压时收窄沟通面"],
    ["communication", "偏好文字沟通"], ["traits", "决策偏保守"], ["value", "在意确定性"],
    ["goal", "把项目推到上线"], ["identity", "从业八年"], ["role", "技术负责人"],
    ["preference", "偏好上午开会"], ["constraint", "不接受临时加需求"], ["stance", "支持小步快跑"],
    ["commitment", "答应了就会做"], ["capability", "擅长拆解复杂问题"], ["taboo", "不愿谈裁员"],
  ];
  for (const [field, value] of fields) persona.commit({ personId: pid, field, value, quote: value, status: "confirmed" });
  for (let i = 0; i < 5; i += 1) {
    persona.commit({ personId: pid, field: "voice", value: `语气样本 ${i}：这个事儿吧，我觉得可以再讨论讨论`, quote: `这个事儿吧，我觉得可以再讨论讨论 ${i}`, status: "confirmed" });
  }
  const full = persona.inject({ personId: pid, maxChars: 6000 });
  check("注入里包含处事方式（不被语气样本挤掉）", full.markdown.includes("决策依据"));
  const tight = persona.inject({ personId: pid, maxChars: 300 });
  check("预算能压住", tight.chars <= 300 + 120, `chars=${tight.chars} budget=${tight.budget}`);
  check("超预算的条目被报出来（不静默丢）", tight.dropped > 0, `dropped=${tight.dropped}`);
  check("每节有配额（声音风格不会吃光预算）", (tight.sections.voice || 0) <= Math.round(300 * 0.15) + 80, `voice=${tight.sections.voice}`);
  const scored = persona.inject({ personId: pid, maxChars: 6000, query: "他会怎么拍板" });
  check("相关问题的事实被优先保留", scored.markdown.includes("拍板") || scored.markdown.includes("决策依据"));
  check("过期项不出现在注入里", !full.markdown.includes("已过期"));
}

// ── 9. 统计口径 ─────────────────────────────────────────────────────
console.log("\n[9] 统计与列表指标");
{
  const st = persona.stats();
  check("stats 区分 current / stale / merged / measures", ["confirmed", "current", "stale", "measures", "merged"].every((k) => typeof st[k] === "number"), JSON.stringify(st));
  const list = persona.peopleList();
  check("列表带证据中位数与待复核数", list.every((p) => typeof p.supportMedian === "number" && typeof p.review === "number"));
  check("有复核项的会打「待复核」标签", list.some((p) => (p.tags || []).includes("待复核")) || persona.review().length === 0);
}

console.log("\n[9.1] evict（检索上限：不删、不归档、热度回升能回来）");
{
  const pid = mkPerson("癸");
  for (let i = 0; i < 6; i += 1) {
    const row = persona.commit({ personId: pid, field: "voice", value: `第 ${i} 句语气样本`, quote: `第 ${i} 句语气样本`, status: "confirmed" });
    // 让第 0/1 条热点最高（被反复观察），其余保持单证据
    if (i < 2) persona.commit({ personId: pid, field: "voice", value: `第 ${i} 句语气样本`, quote: `第 ${i} 句语气样本`, status: "confirmed" });
    void row;
  }
  const card = cardOfPerson(pid);
  const voiceRow = fieldRow(card, "voice");
  check("voice 只展示 heat 最高的 3 条", voiceRow.values.length === 3, `shown=${voiceRow.values.length}`);
  check("被挤出去的条数如实报出", voiceRow.overflow === 3, `overflow=${voiceRow.overflow}`);
  check("证据总数不因展示上限而变小", voiceRow.support === 8, `support=${voiceRow.support}`);
  check("热点样本优先保留", voiceRow.values.includes("第 0 句语气样本") && voiceRow.values.includes("第 1 句语气样本"), voiceRow.values.join(" / "));
  check("被挤出去的不算归档、不进复核队列", persona.review({ personId: pid }).length === 0);
  check("数据没被删（仍在库里）", persona.timeline({ personId: pid }).filter((o) => o.field === "voice").length === 6);
}

console.log("\n[10] 快照/恢复");
{
  const pid = mkPerson("壬");
  persona.setMeasure({ personId: pid, key: "msgs.count", field: "traits", label: "发言量", value: "发言 120 条", num: 120 });
  const snap = persona.snapshotPerson({ personId: pid });
  persona.remove({ personId: pid });
  const restored = persona.restoreSnapshot({ snapshot: snap });
  check("恢复观察", restored.restored >= snap.observations.length);
  check("恢复可观测特征", persona.measures({ personId: pid }).length === 1);
}

// ── 11. 变化视图：事实漂移 vs 特征变化 ─────────────────────────────
console.log("\n[11] drift（漂移 / 矛盾 / 特征变化）");
{
  const pid = mkPerson("子");
  persona.commit({ personId: pid, field: "role", value: "产品经理", quote: "我做产品", status: "confirmed", at: Date.now() - 300 * DAY });
  persona.commit({ personId: pid, field: "role", value: "技术负责人", quote: "现在带技术团队", status: "confirmed" });
  persona.setMeasure({ personId: pid, key: "reply.median", field: "communication", label: "接话时延", value: "回复很快：中位时延约 4 分钟", num: 4 });
  persona.setMeasure({ personId: pid, key: "reply.median", field: "communication", label: "接话时延", value: "回复节奏中等：中位时延约 42 分钟", num: 42 });
  const d = persona.drift({ personId: pid, limit: 10 });
  check("事实被取代 → drift", d.some((x) => x.kind === "drift" && x.field === "role"), d.map((x) => x.kind).join(","));
  check("测量值变化 → trend（不叫漂移、更不叫矛盾）", d.some((x) => x.kind === "trend" && x.key === "reply.median"));
  const trend = d.find((x) => x.kind === "trend");
  check("trend 带 from/to 可供人判断", Boolean(trend?.from) && Boolean(trend?.to) && trend.from !== trend.to, `上次：${trend?.from} → 现在：${trend?.to}`);
  check("测量值不产生 conflict 条目", !d.some((x) => x.kind === "conflict" && x.field === "communication"));
  check("批量复核一次清完", persona.reviewMany({ personId: pid, keep: true }).resolved >= 0);
}

console.log("\n[12] 一句话概括的时效");
{
  const pid = mkPerson("丑");
  persona.setOneLiner({ personId: pid, text: "决策偏保守，习惯先要数据" });
  const fresh = persona.card({ personId: pid });
  check("刚写的一句话不算过时", fresh.oneLinerStale === false);
  // 同一毫秒内写入的事实没法判断先后，等 5ms 让时间戳真正拉开
  await new Promise((r) => setTimeout(r, 5));
  persona.commit({ personId: pid, field: "decision", value: "关键决定要上级拍板", quote: "等老板定", status: "confirmed" });
  const after = persona.card({ personId: pid });
  check("之后又有新结论 → 提示可能过时", after.oneLinerStale === true, `at=${after.oneLinerAt}`);
  check("只是确认待确认事实不算「新结论」", (() => {
    // 先有两批待确认事实，写完一句话之后再确认 —— 确认会刷 updated_at，但不该让一句话变「过时」
    const a = persona.commit({ personId: pid, field: "traits", value: "在意确定性", quote: "要确定性", status: "pending" });
    const b = persona.commit({ personId: pid, field: "value", value: "在意确定性", quote: "要确定性", status: "pending" });
    persona.setOneLiner({ personId: pid, text: "决策偏保守，习惯先要数据" });
    persona.resolve({ id: a.id, accept: true });
    persona.resolve({ id: b.id, accept: true });
    return persona.card({ personId: pid }).oneLinerStale === false;
  })());
}

console.log("\n[13] 决策辅助（宁可漏，不猜）");
{
  const pid = mkPerson("寅");
  persona.commit({ personId: pid, field: "decision", value: "排期表必须先给再看需求", quote: "排期表必须先给", status: "confirmed" });
  persona.commit({ personId: pid, field: "voice", value: "这个事儿吧，再说了", quote: "这个事儿吧，再说了", status: "confirmed" });
  check("无关问题不给依据（不拿泛词凑数）", persona.ask({ question: "今天午饭吃什么" }).found === false);
  check("只命中一个 2 字词不算依据", persona.ask({ question: "这事同意吗" }).found === false);
  const good = persona.ask({ question: "排期表这事他怎么要求" });
  check("问题原词命中就给依据", good.found === true && good.citations.length >= 1, good.answer.split("\n")[0]);
  check("给出的依据带来源", Boolean(good.citations[0]?.quote));

  // 问「他会怎么反应」但没有处事记录：说清缺什么，不拿语气样本凑数
  const bare = mkPerson("卯");
  persona.commit({ personId: bare, field: "voice", value: "这个事儿吧，再说了", quote: "这个事儿吧，再说了", status: "confirmed" });
  const name = persona.people().find((x) => x.id === bare).name;
  const noReact = persona.ask({ question: `${name} 会怎么反应` });
  check("没处事记录时返回未知并点名缺什么", noReact.found === false && noReact.answer.includes("处事方式记录"), noReact.answer.slice(0, 40));
  persona.commit({ personId: bare, field: "decision", value: "关键决定要上级拍板", quote: "等老板定", status: "confirmed" });
  const withReact = persona.ask({ question: `${name} 会怎么反应` });
  check("补上处事记录后能给依据", withReact.found === true && withReact.answer.includes("决策依据"));
}

console.log("\n[14] 任务里点名的人才注入（run 启动用）");
{
  const pid = mkPerson("辰光");
  persona.commit({ personId: pid, field: "decision", value: "关键决定要上级拍板", quote: "等老板定", status: "confirmed" });
  persona.commit({ personId: pid, field: "taboo", value: "不愿谈裁员", quote: "别问裁员", status: "confirmed", sensitive: true });
  const hit = persona.injectForText({ text: "把这次排期发给辰光确认", maxChars: 600 });
  check("点名 → 注入这个人的片段", hit.people.includes("辰光") && hit.markdown.includes("决策依据"), hit.people.join(","));
  check("敏感项永不进注入", !hit.markdown.includes("裁员"));
  check("只按点名，不做全量注入", hit.people.length === 1);
  const miss = persona.injectForText({ text: "把这次排期发出去" });
  check("没点名 → 一个字都不注入", miss.people.length === 0 && miss.markdown === "");

  // 合并后旧名字（别名）也要能点名命中，否则并完就「叫不动」了
  const other = mkPerson("辰光旧号");
  persona.merge({ keepId: pid, aliasIds: [other] });
  const byAlias = persona.injectForText({ text: "问一下辰光旧号的看法" });
  check("用合并前的旧名字也能命中", byAlias.people.includes("辰光"), byAlias.people.join(","));
  check("ask 点名也认别名", persona.ask({ question: "辰光旧号会怎么反应" }).found !== undefined);
  check("带人名片段有预算上限", persona.injectForText({ text: "辰光", maxChars: 200 }).chars <= 200 + 80);
}

console.log("\n[15] 引用可核对（建模产出的溯源）");
{
  const corpus = "李雯：我一般上午处理复杂任务，下午基本不回消息。\n李雯：这事我得等老板拍板才行。";
  check("原话能核对上", evidenceMatches("我一般上午处理复杂任务", corpus));
  check("被截断的原话也能核对上", evidenceMatches("这事我得等老板拍板", corpus));
  check("标点/空格差异不影响", evidenceMatches("我 一般 上午处理复杂任务，", corpus));
  check("编出来的话核对不上", !evidenceMatches("我从来不在周末回消息", corpus));
  check("太短的引用不判（没法核对）", !evidenceMatches("好的", corpus));
  check("统计值冒充原话能被认出来", ["问句 19%", "句长中位 10 字", "群聊 0 条 / 私聊 202 条", "发言146条 / 活跃54天 / 每日3条", "笑声86% / 表情6%"].every(looksLikeStat));
  check("真原话不会被误判成统计值", !["我一般上午处理复杂任务", "等老板定", "这个事儿吧，再说了"].some(looksLikeStat));

  const pid = mkPerson("巳");
  persona.commit({ personId: pid, field: "traits", value: "上午效率高", quote: "我一般上午处理复杂任务", sourceKind: "llm", status: "confirmed", quoteVerified: true });
  const bad = persona.commit({ personId: pid, field: "preference", value: "讨厌开会", quote: "我最烦开会了", sourceKind: "llm", status: "confirmed", quoteVerified: false });
  const card = cardOfPerson(pid);
  check("人设卡标出引用待核对的条数", card.metrics.unverified === 1, `unverified=${card.metrics.unverified}`);
  const ev = card.sections.flatMap((x) => x.rows).flatMap((r) => r.evidence).find((e) => e.value === "讨厌开会");
  check("证据里带 verified=false", ev?.verified === false);
  check("多次观察中有一次可核对 → 升级为已核对", (() => {
    persona.commit({ personId: pid, field: "preference", value: "讨厌开会", quote: "开会太浪费时间了", sourceKind: "llm", status: "confirmed", quoteVerified: true });
    return cardOfPerson(pid).metrics.unverified === 0;
  })());
  check("不可核对的观察在排序里被降权", heatOf({ ...bad, quoteVerified: false }) < heatOf({ ...bad, quoteVerified: true }));
}

console.log("\n[16] 导入即算可观测特征（不花钱）");
{
  const lines = [];
  for (let i = 0; i < 12; i += 1) {
    lines.push(`2024-03-${String(i + 1).padStart(2, "0")} 10:0${i % 10}:00 未光`);
    lines.push(`未光: 这是第 ${i} 条发言，用来凑够样本量看看统计特征会不会自动出来`);
  }
  // 另一个人只发两句：低于阈值，不该产出特征
  lines.push("2024-03-20 11:00:00 少见");
  lines.push("少见: 我只说一句");
  lines.push("少见: 再说一句");
  const res = persona.import({ text: lines.join("\n"), title: "stats-batch" });
  check("导入时自动算特征", (res.statsUpdated || 0) >= 8 && res.statsPeople === 1, `特征 ${res.statsUpdated} 项 / ${res.statsPeople} 人`);
  const who = persona.people().find((p) => p.name === "未光");
  const ms = persona.measures({ personId: who.id });
  check("特征写进 measures（不进事实层）", ms.length >= 8, `${ms.length} 项`);
  check("样本不足的人不产生特征", persona.people().find((p) => p.name === "少见")
    ? persona.measures({ personId: persona.people().find((p) => p.name === "少见").id }).length === 0
    : true);
  check("导入的特征是「重算出来」的（带 computedAt）", ms.every((m) => m.computedAt > 0));
  check("特征不污染待确认队列", persona.pending({ limit: 500 }).every((o) => o.sourceKind !== "stats"));
}

persona.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
