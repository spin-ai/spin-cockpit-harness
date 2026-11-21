/**
 * 记忆层自检：只在临时目录跑，不碰用户 userData。
 *
 *   npm run memory:selftest
 *
 * 断言集中在两件最容易做错的事上：
 *   1. 四种「忘」互不串味（失效 / 衰减 / 淘汰 / 恢复）；
 *   2. 注入到底装了什么（L1 不进、note 有预留、按分数截止）。
 * 另外验一遍老库补列，避免升级后有人只能删 mem.db。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMemory, parseDreamItems, MemoryConflictError } from "../electron/memory/index.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mem-selftest-"));
const dir = path.join(tmp, "mem");
const mem = createMemory({ dir });

console.log("记忆层自检\n");

// ── 1. note 的衰减（decay）──────────────────────────────────
console.log("[1] note 存活期");
const guess = mem.noteAdd({ body: "这个仓库可能用的是 pnpm", sourceRef: "run:selftest" });
check("guess 默认 14 天", guess.expiresAt > Date.now() + 13 * DAY && guess.expiresAt <= Date.now() + 15 * DAY, new Date(guess.expiresAt).toISOString().slice(0, 10));
const rule = mem.noteAdd({ body: "提交前必须跑 typecheck", kind: "rule", confidence: 0.9, sourceRef: "run:selftest" });
check("rule 不过期", !rule.expiresAt);
const pinnedNote = mem.noteAdd({ body: "用户偏好简短回答", kind: "preference", confidence: 0.8, expiresAt: null, sourceRef: "run:selftest" });
check("显式 null 也不过期", !pinnedNote.expiresAt);
const verified = mem.noteAdd({ body: "部署走 install-mac.mjs", kind: "decision", confidence: 0.9, sourceRef: "run:selftest" });
check("默认置信度按 kind 给", guess.confidence === 0.4 && rule.confidence === 0.9, `guess=${guess.confidence} rule=${rule.confidence}`);
mem.noteSetStatus({ id: guess.id, status: "verified" });
check("被人验证后不再衰减", !mem.noteList({ status: "verified" }).find((n) => n.id === guess.id)?.expiresAt);

// 直接把它改成过期，验注入过滤
mem.noteAdd({ body: "旧结论：用 yarn", kind: "guess", confidence: 0.9, expiresAt: Date.now() - DAY, sourceRef: "run:selftest" });
check("过期 note 标记为 expired", mem.noteList({ limit: 50 }).some((n) => n.expired));

// ── 2. 失效（invalidate）而不是删除 ──────────────────────────
console.log("[2] 失效链");
const oldEntry = mem.entryUpsert({ layer: "L4", title: "包管理器用 pnpm", body: "pnpm 更快", sources: ["note:1"] });
await sleep(5);
// 同一个毫秒里 "创建" 和 "失效" 会让 as_of 无法区分，所以先睡一下再取分界点
const before = Date.now();
// 同一个毫秒里失效的话，invalid_at === before，as_of(before) 就看不到它了：隔开 2ms
await sleep(2);
const promoted = mem.promoteNote({ id: verified.id, layer: "L4", supersedes: [oldEntry.id] });
const newer = promoted.entry;
check("新条目记下它取代了谁", newer.supersedes.includes(oldEntry.id));
const oldRow = mem.entryList({ limit: 200, includeInvalidated: true }).find((e) => e.id === oldEntry.id);
check("旧条目标了 invalid_at", Boolean(oldRow?.invalidAt));
check("旧条目指向取代者", oldRow?.supersededBy === newer.id);
check("旧条目不再出现在默认列表", !mem.entryList({ limit: 200 }).some((e) => e.id === oldEntry.id));
check("旧条目没有进注入", !mem.inject({ maxChars: 12000 }).markdown.includes("包管理器用 pnpm"));
check("旧条目进了「已过期/归档」", mem.entryArchived().some((e) => e.id === oldEntry.id));
const asOfPast = mem.entryAsOf({ at: before });
const asOfNow = mem.entryAsOf({ at: Date.now() });
check("as_of 过去能看到旧结论", asOfPast.some((e) => e.id === oldEntry.id));
check("as_of 现在只剩新结论", !asOfNow.some((e) => e.id === oldEntry.id) && asOfNow.some((e) => e.id === newer.id));

mem.entryRestore({ id: oldEntry.id });
const restored = mem.entryList({ limit: 200 }).find((e) => e.id === oldEntry.id);
const newerAfter = mem.entryList({ limit: 200 }).find((e) => e.id === newer.id);
check("恢复后旧条目回到 active", Boolean(restored) && !restored.invalidAt);
check("恢复同时摘掉新条目的 supersedes", !newerAfter.supersedes.includes(oldEntry.id));
mem.entryInvalidate({ id: oldEntry.id, supersededBy: newer.id }); // 还原成本轮后续断言的前提

// ── 3. 注入：L1 不进、note 有位置、按分数截止 ────────────────
console.log("[3] 注入");
mem.entryUpsert({ layer: "L1", title: "原始会话片段", body: "用户说……" });
mem.entryUpsert({ layer: "L3", title: "进行中的重构", body: "把注入改成打分" });
const pin = mem.entryUpsert({ layer: "L4", title: "置顶结论", body: "先跑 typecheck" });
mem.entryReorder({ ids: [pin.id] });
const lowConf = mem.noteAdd({ body: "也许该换成 npm", kind: "guess", confidence: 0.2, sourceRef: "run:selftest" });
const big = mem.inject({ maxChars: 12000 });
check("L1 永不注入（即使放在别处也会被排除）", !big.markdown.includes("原始会话片段"));
check("置顶条目排在最前", big.markdown.indexOf("置顶结论") > 0 && big.markdown.indexOf("置顶结论") < big.markdown.indexOf("进行中的重构"));
check("verified note 进注入", big.markdown.includes("部署走 install-mac.mjs"));
check("高置信度未验证 note 标注后注入", big.markdown.includes("用户偏好简短回答") && big.markdown.includes("未验证"));
check("低置信度 note 不进注入", !big.markdown.includes(lowConf.body));
check("过期 note 不进注入", !big.markdown.includes("旧结论：用 yarn"));
check("失效条目不在注入里", !big.markdown.includes("包管理器用 pnpm"));
check("注入项带分数与原因", big.items.every((i) => i.included ? i.reason.length > 0 : true));
check("注入记录版本号", typeof big.version === "number" && big.version > 0);

// owner 维度：空 = 共享；bot:<id> = 只给这个 bot
const botOnly = mem.entryUpsert({ layer: "L4", title: "戈洛专属：怕吵", body: "夜里不要主动找我", owner: "bot:golo" });
const noteBot = mem.noteAdd({ body: "戈洛记得：周报在周五下午发", kind: "preference", confidence: 0.9, expiresAt: null, sourceRef: "run:selftest", owner: "bot:golo" });
const asGolo = mem.inject({ maxChars: 12000, owner: "bot:golo" });
const asOther = mem.inject({ maxChars: 12000, owner: "bot:other" });
check("owner 条目只给本 bot 注入", asGolo.markdown.includes(botOnly.title) && asGolo.markdown.includes(noteBot.body));
check("别的 bot 看不到私有条目", !asOther.markdown.includes(botOnly.title) && !asOther.markdown.includes(noteBot.body));
check("共享条目对所有 bot 都注入", asOther.markdown.includes("置顶结论") && asGolo.markdown.includes("置顶结论"));
check("不传 owner 时不掉私有条目（默认行为不变）", mem.inject({ maxChars: 12000 }).markdown.includes(botOnly.title));

for (let i = 0; i < 20; i += 1) mem.entryUpsert({ layer: "L4", title: `压测条目 ${i}`, body: "x".repeat(150) });
const tiny = mem.inject({ maxChars: 900 });
check("小预算时 note 仍能进去（预留生效）", tiny.markdown.includes("未验证观察"));
check("小预算做减法并说出来", tiny.dropped > 0 && /另有 \d+ 条条目超出/.test(tiny.markdown), `dropped=${tiny.dropped}`);
check("小预算不超太多（只允许省略提示那行）", tiny.chars <= 900 + 120, `${tiny.chars} / 900`);
check("被裁的条目说明原因", tiny.items.filter((i) => !i.included).every((i) => /预算|用尽/.test(i.reason)));
for (let i = 0; i < 6; i += 1) mem.noteAdd({ body: `排队观察第 ${i} 条：每个环境的配置都要单独核对一遍编号 ${i}`, kind: "gotcha", confidence: 0.8, sourceRef: `run:q${i}` });
check("超出 note 上限的观察也出现在台账里（并说明原因）", (() => {
  const many = mem.inject({ maxChars: 12000 });
  const cappedNotes = many.items.filter((i) => i.layer === "note" && !i.included);
  return cappedNotes.length > 0 && cappedNotes.every((i) => /上限/.test(i.reason));
})());

// ── 3.6 条目修订与乐观并发 ─────────────────────────────────
console.log("[3.6] 条目修订 / 冲突");
const revEntry = mem.entryUpsert({ layer: "L4", title: "部署方式", body: "走 install-mac.mjs" });
// 同一毫秒里改两次的话 updated_at 不变，"版本冲突"就测不出来：隔开 2ms
await sleep(2);
const rev1 = mem.entryRewrite({ id: revEntry.id, body: "走 install-mac.mjs --open", expectedUpdatedAt: revEntry.updatedAt });
check("改写写入新正文", rev1.body.includes("--open"));
check("旧版进了 entry_revisions", mem.entryRevisions({ id: revEntry.id }).some((r) => r.body.includes("走 install-mac.mjs") && !r.body.includes("--open")));
let conflict = null;
try { mem.entryUpsert({ id: revEntry.id, title: "部署方式", body: "被人偷偷覆盖", expectedUpdatedAt: revEntry.updatedAt }); }
catch (err) { conflict = err; }
check("版本不一致时写会被拒（乐观并发）", conflict instanceof MemoryConflictError, conflict?.code || "no error");
check("拒绝之后内容没被改掉", (mem.entryList({ limit: 200 }).find((e) => e.id === revEntry.id) || {}).body?.includes("--open"));
let revConflict = null;
try { mem.entryRewrite({ id: revEntry.id, body: "再改一次", expectedUpdatedAt: revEntry.updatedAt }); }
catch (err) { revConflict = err; }
check("改写也认 expectedUpdatedAt", revConflict instanceof MemoryConflictError);
const oldest = mem.entryRevisions({ id: revEntry.id }).at(-1);
const rolledBack = mem.entryRestoreRevision({ revisionId: oldest.id });
check("回滚到旧版（回滚本身也进修订历史）", rolledBack.body.includes("install-mac.mjs") && mem.entryRevisions({ id: revEntry.id }).length >= 2);

// ── 4. 检索用 bigram，不靠整串 LIKE ─────────────────────────
console.log("[4] 检索");
check("两字中文词能搜到", mem.entrySearch({ query: "重构" }).some((e) => e.title.includes("重构")));
check("不相关词搜不到", mem.entrySearch({ query: "量子纠缠" }).length === 0);
check("失效条目不出现在搜索结果", !mem.entrySearch({ query: "pnpm" }).some((e) => e.id === oldEntry.id));

// ── 5. 版本自增 ────────────────────────────────────────────
console.log("[5] memory_version");
const v1 = mem.version();
mem.entryUpsert({ layer: "L4", title: "又一个结论" });
check("写入让版本自增", mem.version() > v1, `${v1} → ${mem.version()}`);

// ── 6. 写入闸门（来源必填 / 长度 / 去重）────────────────────
console.log("[6] 写入闸门");
let gateErr = "";
try { mem.noteAdd({ body: "没有来源也想写" }); } catch (e) { gateErr = e.message; }
check("没来源直接拒", /必须带来源/.test(gateErr), gateErr.slice(0, 26));
gateErr = "";
try { mem.noteAdd({ body: "长".repeat(500), sourceRef: "run:x" }); } catch (e) { gateErr = e.message; }
check("超长直接拒（不静默截断）", /观察太长/.test(gateErr), gateErr.slice(0, 26));
const n1 = mem.noteAdd({ body: "同一条观察写两遍", sourceRef: "run:a" });
const n2 = mem.noteAdd({ body: " 同一条观察，写两遍！ ", sourceRef: "run:b" });
check("去空白标点后视为同一条", n2.id === n1.id && n2.deduped === true);
check("重复写入不新增行", mem.noteList({ limit: 200 }).filter((n) => n.id === n1.id).length === 1);
check("重复写入抬置信度", n2.confidence > n1.confidence, `${n1.confidence} → ${n2.confidence}`);
check("重复写入更新来源", n2.sourceRef === "run:b");
const r1 = mem.noteAdd({ body: "会续期的观察", kind: "guess", sourceRef: "run:t1", expiresAt: Date.now() + 1000 });
const r2 = mem.noteAdd({ body: "会续期的观察", kind: "guess", sourceRef: "run:t2" });
check("未验证的观察重复抓到会续期", r2.expiresAt - Date.now() > 10 * DAY, `${r1.expiresAt === r2.expiresAt ? "未续期" : "已续期"}`);

// 晋升边界：过期 / 不成立 / 无来源 都不配进 L4
console.log("[6.1] 晋升边界");
const expiredNote = mem.noteAdd({ body: "过期结论不该被晋升", kind: "guess", expiresAt: Date.now() - 1000, sourceRef: "run:e" });
let pErr = "";
try { mem.promoteNote({ id: expiredNote.id }); } catch (e) { pErr = e.message; }
check("过期观察不能晋升", /已过期/.test(pErr), pErr.slice(0, 22));
const staleNote = mem.noteAdd({ body: "已判不成立的观察", kind: "gotcha", sourceRef: "run:s" });
mem.noteSetStatus({ id: staleNote.id, status: "stale" });
pErr = "";
try { mem.promoteNote({ id: staleNote.id }); } catch (e) { pErr = e.message; }
check("stale 观察不能晋升", /不成立/.test(pErr), pErr.slice(0, 22));
const rejectedNote = mem.noteAdd({ body: "被拒过的观察", kind: "gotcha", sourceRef: "run:r" });
mem.noteSetStatus({ id: rejectedNote.id, status: "rejected" });
pErr = "";
try { mem.promoteNote({ id: rejectedNote.id }); } catch (e) { pErr = e.message; }
check("rejected 观察不能晋升", /已拒绝/.test(pErr), pErr.slice(0, 22));

// ── 7. 注入台账与被引用回填 ────────────────────────────────
console.log("[7] 注入台账");
const citeTarget = mem.entryUpsert({ layer: "L4", title: "记忆注入要按分数排序而不是手动顺序", body: "测试用" });
const logged = mem.inject({ maxChars: 12000, runId: "run-cite-1" });
check("绑定 run 的注入落台账", Boolean(logged.logId));
check("预览不落台账", !mem.inject({}).logId);
const citedRes = mem.markCited({ logId: logged.logId, text: "这次按「记忆注入要按分数排序而不是手动顺序」处理。" });
check("归因能找到被用到的条目", citedRes.ids.includes(citeTarget.id), `cited=${citedRes.cited}/${citedRes.total}`);
const touched = mem.entryList({ limit: 200 }).find((e) => e.id === citeTarget.id);
check("命中后 hit_count +1", touched.hitCount >= 1, String(touched.hitCount));
const stats = mem.injectionStats();
check("统计能算出命中率", stats.runs >= 1 && stats.injected > 0 && stats.hitRate > 0, `${Math.round(stats.hitRate * 100)}%`);
check("没被用到的条目不上分", mem.entryList({ limit: 200 }).find((e) => e.title === "置顶结论").hitCount === 0);

// 归因判据：强（复述标题）之外还有弱（特征词出现在这一轮的文本/工具调用里）
console.log("[7.1] 归因判据");
const act = mem.entryUpsert({ layer: "L4", title: "提交前跑 typecheck 和 build", body: "改代码后必须验证" });
const mkLog = (runId) => mem.inject({ maxChars: 12000, runId }).logId;
const logWeak = mkLog("run-cite-weak");
const resWeak = mem.markCited({ logId: logWeak, text: "我先执行 npm run typecheck，然后 npm run build，都过了。" });
check("特征词同时出现算被用到（弱判据）", resWeak.ids.includes(act.id), `cited=${resWeak.cited}/${resWeak.total}`);
const logOne = mkLog("run-cite-one");
const resOne = mem.markCited({ logId: logOne, text: "我只执行了 typecheck。" });
check("只命中一个特征词不算（防误判）", !resOne.ids.includes(act.id));
const logNone = mkLog("run-cite-none");
const resNone = mem.markCited({ logId: logNone, text: "今天天气不错，聊点别的。" });
check("完全无关的文本不算", resNone.ids.length === 0);
const logStrong = mkLog("run-cite-strong");
const resStrong = mem.markCited({ logId: logStrong, text: "按「提交前跑 typecheck 和 build」这条结论处理。" });
check("复述标题算被用到（强判据）", resStrong.ids.includes(act.id));
check("未回填的台账能被找出来补", typeof mem.logsNeedingCitation === "function" && Array.isArray(mem.logsNeedingCitation({ limit: 5 })));

// ── 8. L1 索引（transcript）─────────────────────────────────
console.log("[8] L1 索引");
mem.transcriptPut({ kind: "message", refId: "msg-1", at: 1700000000000, text: "用户说：知识库检索要按页定位", threadId: "t1", runId: "r1" });
mem.transcriptPut({ kind: "event", refId: "evt-1", at: 1700000001000, text: "run.finished todo=记忆系统" });
const c1 = mem.transcriptCount();
check("两字中文词能搜到历史消息", mem.transcriptSearch({ query: "检索" }).some((h) => h.id === "msg-1"));
check("命中带会话与 run id", mem.transcriptSearch({ query: "检索" })[0]?.threadId === "t1");
check("事件也能搜到", mem.transcriptSearch({ query: "记忆系统" }).some((h) => h.id === "evt-1" && h.kind === "event"));
check("不相关词查不到", mem.transcriptSearch({ query: "量子纠缠" }).length === 0);
check("按 kind 过滤", mem.transcriptSearch({ query: "检索", kind: "event" }).length === 0);
const snip = mem.transcriptSearch({ query: "页定位" })[0]?.snippet || "";
check("片段切在命中处附近", snip.includes("页定位"), snip.slice(0, 40));
mem.transcriptPut({ kind: "message", refId: "msg-1", at: 1700000000000, text: "用户说：检索改成 bigram 分词", threadId: "t1", runId: "r1" });
check("同一条重写后不新增行", mem.transcriptCount() === c1);
check("重写后旧文本搜不到", mem.transcriptSearch({ query: "按页定位" }).length === 0);
check("重写后新文本能搜到", mem.transcriptSearch({ query: "bigram" }).some((h) => h.id === "msg-1"));
const syncRes = mem.transcriptSync([
  { kind: "message", refId: "msg-1", at: 1700000000000, text: "用户说：检索改成 bigram 分词", threadId: "t1", runId: "r1" },
  { kind: "message", refId: "msg-2", at: 1700000002000, text: "会话二里提到灰度发布", threadId: "t2", runId: "r2" },
]);
check("对账补上缺失的条目", syncRes.filled === 1, `filled=${syncRes.filled}`);
check("对账清掉孤儿（事件已不在源里）", syncRes.pruned === 1 && !mem.transcriptSearch({ query: "记忆系统" }).some((h) => h.id === "evt-1"), `pruned=${syncRes.pruned}`);

// ── 8.1 Dream：合并 / 校正 / 每日预算 ──────────────────────
console.log("[8.1] Dream 合并与校正");
const b0 = mem.dreamConfig({}).budget;
mem.noteAdd({ body: "依赖用 pnpm 安装", kind: "preference", confidence: 0.7, sourceRef: "run:m1" });
mem.noteAdd({ body: "依赖用 pnpm 安装，CI 也一样", kind: "preference", confidence: 0.7, sourceRef: "run:m2" });
const backed = mem.noteAdd({ body: "包管理器用 pnpm 更快", kind: "decision", confidence: 0.9, sourceRef: "run:c1" });
const backedEntry = mem.promoteNote({ id: backed.id }).entry;
mem.entryInvalidate({ id: backedEntry.id, supersededBy: "newer-entry" });
const scan = mem.dreamScan({ pages: [], sources: [] });
const mergeSug = scan.find((x) => x.action === "merge");
const correctSug = scan.find((x) => x.action === "correct");
check("同一句话的扩写产出合并建议", Boolean(mergeSug), mergeSug?.title?.slice(0, 26));
check("合并建议带两条来源且含保留项", Boolean(mergeSug) && mergeSug.sources.length === 2 && mergeSug.sources.includes(mergeSug.targetId));
check("结论被推翻 → 支撑它的观察要复核", Boolean(correctSug), correctSug?.detail?.slice(0, 40));
check("校正建议指向 note 本身", correctSug?.targetKind === "note");
const b1 = mem.dreamConfig({}).budget;
check("建议计入当日预算", b1.used === b0.used + scan.length, `${b0.used} → ${b1.used}（+${scan.length}）`);
mem.dreamConfig({ patch: { dayLimit: b1.used } });
check("预算用尽后不再产建议", mem.dreamScan({ pages: [], sources: [] }).length === 0);
mem.dreamConfig({ patch: { dayLimit: 200 } });
const rerun = mem.dreamScan({ pages: [], sources: [] });
check("同类建议 30 天内不重复打扰", rerun.length === 0, `重复 ${rerun.length} 条`);

// ── 8.2 Dream 语义 pass 的闸门（模型调用本身不在这里测）──────
console.log("[8.2] 语义 pass 闸门");
check("语义 pass 默认关闭", mem.dreamConfig({}).llmPass === false);
const cand = mem.dreamCandidates({ limit: 5 });
check("候选只含活着的新/已验证观察", cand.length > 0 && cand.length <= 5 && !cand.some((c) => /旧结论：用 yarn/.test(c.body)));
const a1 = mem.noteAdd({ body: "语义 pass 测试甲：发布前要跑 e2e", kind: "gotcha", confidence: 0.7, sourceRef: "run:s1" });
const a2 = mem.noteAdd({ body: "语义 pass 测试乙：发布之前先跑 e2e", kind: "gotcha", confidence: 0.7, sourceRef: "run:s2" });
const bad = mem.dreamModelSuggest({ items: [
  { action: "merge", ids: [a1.id, "note-不存在"], keep: a1.id, reason: "看起来是同一件事" },
  { action: "merge", ids: [a2.id], keep: a2.id, reason: "只有一个 id" },
  { action: "correct", ids: [a1.id, a2.id], reason: "correct 只能指一条" },
  { action: "merge", ids: [a1.id, a2.id], keep: a1.id, reason: "" },
  { action: "nonsense", ids: [a1.id], reason: "非法动作" },
] });
check("幻觉 id / 单 id 合并 / 多 id 校正 / 无 reason / 非法动作 全部被丢", bad.length === 0, `收到 ${bad.length} 条`);
const good = mem.dreamModelSuggest({ items: [
  { action: "merge", ids: [a1.id, a2.id], keep: "不存在的 keep", reason: "同一句话的两种写法" },
] });
check("合法合并建议入队", good.length === 1 && good[0].action === "merge");
check("keep 非法时回落第一个 id", good[0]?.targetId === a1.id);
check("建议带全部 id 作依据", JSON.stringify(good[0]?.sources || []) === JSON.stringify([a1.id, a2.id]));
const againItems = mem.dreamModelSuggest({ items: [{ action: "merge", ids: [a1.id, a2.id], keep: a1.id, reason: "再说一遍" }] });
check("同一组 id 不重复入队", againItems.length === 0);
const callBudget0 = mem.dreamModelCallBudget();
const callBudget1 = mem.noteDreamModelCall({ calls: 1, tokens: 1234 });
check("模型调用单独计数", callBudget1.used === callBudget0.used + 1 && callBudget1.tokens >= 1234);
const cfgNow = mem.dreamConfig({});
check("两笔账互不覆盖", cfgNow.budget.used > 0 && cfgNow.modelBudget.used > 0, `建议 ${cfgNow.budget.used} / 模型 ${cfgNow.modelBudget.used}`);

// 模型输出的三种脏法都要能解析（解析不出来要能区分「没建议」和「乱码」）
check("解析 ```json 围栏", parseDreamItems('```json\n{"items":[{"action":"merge"}]}\n```')?.length === 1);
check("解析前面带解释的输出", parseDreamItems('好的，结果如下：\n{"items":[{"action":"correct"}]}')?.length === 1);
check("解析直接返回数组", parseDreamItems('[{"action":"merge"}]')?.length === 1);
check("空 items 视为没建议", parseDreamItems('{"items":[]}')?.length === 0);
check("乱码返回 null（区分于没建议）", parseDreamItems("模型今天不想干活") === null);
check("空串返回 null", parseDreamItems("") === null);

// ── 8.3 改写建议：只动没确认过的、不许引入新事实、留旧版 ────
console.log("[8.3] 改写建议");
const rwBase = mem.noteAdd({ body: "发布前要跑一遍 e2e 和 typecheck 才能合并", kind: "rule", confidence: 0.7, sourceRef: "run:w1" });
const rwVerified = mem.noteAdd({ body: "灰度先放百分之一流量", kind: "rule", confidence: 0.8, sourceRef: "run:w2" });
mem.noteSetStatus({ id: rwVerified.id, status: "verified" });
const rwReject = mem.dreamModelSuggest({ items: [
  { action: "rewrite", ids: [rwVerified.id], body: "灰度先放百分之一流量", reason: "措辞可以更短" },
] });
check("verified 观察不允许被改写", rwReject.length === 0);
const rwInvent = mem.dreamModelSuggest({ items: [
  { action: "rewrite", ids: [rwBase.id], body: "发布前要跑一遍 e2e、typecheck，还要过混沌测试和性能基准才能合并", reason: "补全流程" },
] });
check("引入新事实的改写被拒", rwInvent.length === 0);
const rwOk = mem.dreamModelSuggest({ items: [
  { action: "rewrite", ids: [rwBase.id], body: "发布前跑 e2e 和 typecheck 才能合并", reason: "去掉口语填充词，意思不变" },
] });
check("只做删减的改写可以入队", rwOk.length === 1 && rwOk[0].action === "rewrite");
check("改写建议带拟改正文", rwOk[0]?.payload?.body === "发布前跑 e2e 和 typecheck 才能合并");
const rwDup = mem.dreamModelSuggest({ items: [
  { action: "rewrite", ids: [rwBase.id], body: "发布前跑 e2e 和 typecheck 才能合并", reason: "再说一遍" },
] });
check("同一条改写不重复入队", rwDup.length === 0);
// 接受 = 落库并留旧版
const before2 = mem.noteList({ limit: 400 }).find((n) => n.id === rwBase.id)?.body;
const rewritten = mem.noteRewrite({ id: rwBase.id, body: "发布前必须过 e2e 与 typecheck", source: "dream" });
check("改写后正文更新", rewritten.body === "发布前必须过 e2e 与 typecheck");
const revs = mem.noteRevisions({ id: rwBase.id });
check("旧版本留在 note_revisions 里", revs.length === 1 && revs[0].body === before2);
let rwErr = "";
try { mem.noteRewrite({ id: rwBase.id, body: "发布前必须过 e2e 与 typecheck" }); } catch (e) { rwErr = e.message; }
check("改写没变化时报错", /没有任何变化/.test(rwErr));

// ── 8.4 提案版本闸门：人改过的东西不被旧建议覆盖 ────────────
console.log("[8.4] 版本闸门与台账");
const firstRun = mem.dreamLastRun();
check("每轮 Dream 落台账（trigger / 耗时 / 产出）", Boolean(firstRun) && firstRun.trigger === "manual" && firstRun.ms >= 0, firstRun ? `${firstRun.created} 条 / ${firstRun.ms}ms` : "无");
const targetSug = mem.suggestionList({ status: "pending", limit: 200 }).find((s) => s.targetKind === "note" && s.baseRev > 0);
check("确定性建议带 baseRev / diff", Boolean(targetSug) && Boolean(targetSug.diff), targetSug?.diff?.split("\n")[0]);
await sleep(5);
mem.noteSetStatus({ id: targetSug.targetId, status: "verified" });
const staleResolve = mem.suggestionResolve({ id: targetSug.id, accept: true });
check("目标被改过 → 建议作废，不覆盖人的修改", staleResolve.superseded === true && staleResolve.status === "superseded", staleResolve.reason);
check("作废不进 rejects（不是“人拒绝了它”）", !mem.suggestionList({ status: "pending", limit: 500 }).some((s) => s.id === targetSug.id));

// ── 8.5 输入指纹：同一批输入不重跑 ──────────────────────────
console.log("[8.5] 输入指纹");
const fp1 = mem.dreamFingerprint({ pages: [], sources: [] });
check("同一批输入指纹稳定", fp1 === mem.dreamFingerprint({ pages: [], sources: [] }));
mem.noteAdd({ body: "新增一条改变输入的观察", kind: "guess", sourceRef: "run:fp" });
check("输入变了指纹就变", mem.dreamFingerprint({ pages: [], sources: [] }) !== fp1);
const idleRun = mem.dreamScan({ pages: [], sources: [], trigger: "idle" });
check("空闲触发与手动共用同一条扫描路径", mem.dreamLastRun()?.trigger === "idle", `+${idleRun.length} 条`);
check("输入没变就不该再跑", mem.dreamUnchanged({ fingerprint: mem.dreamFingerprint({ pages: [], sources: [] }) }) === true);
check("输入没变时 dreamScan 直接返回空", mem.dreamScan({ pages: [], sources: [] }).length === 0);
const forced = mem.dreamScan({ pages: [], sources: [], force: true });
check("force 可以重跑一轮（手动按钮）", Array.isArray(forced));
check("台账保留多轮记录", mem.dreamRuns({ limit: 5 }).length >= 3);

// ── 8.6 证据：观察带着自己的出处去给模型看 ──────────────────
console.log("[8.6] 证据链");
mem.transcriptPut({ kind: "message", refId: "msg-e1", at: Date.now(), text: "以后装依赖统一用 pnpm，别再用 npm 了", threadId: "t9", runId: "r9" });
const evNote = mem.noteAdd({ body: "依赖统一用 pnpm 安装", kind: "preference", confidence: 0.6, sourceKind: "transcript", sourceRef: "msg-e1" });
const withEv = mem.dreamCandidates({ limit: 50, withEvidence: true }).find((c) => c.id === evNote.id);
check("候选带自己的出处片段", Boolean(withEv?.evidence?.some((e) => e.ref === "message:msg-e1")), withEv?.evidence?.[0]?.snippet?.slice(0, 24));
check("不开 withEvidence 时不带证据（省上下文预算）", !("evidence" in (mem.dreamCandidates({ limit: 50 }).find((c) => c.id === evNote.id) || {})));
const noEv = mem.dreamModelSuggest({ items: [{ action: "correct", ids: [evNote.id], reason: "看起来已经不成立了" }] });
check("correct 没证据直接丢", noEv.length === 0);
const forgedEv = mem.dreamModelSuggest({ items: [{ action: "correct", ids: [evNote.id], evidence: ["message:伪造"], reason: "这句话不成立了" }], evidenceRefs: new Set(["message:msg-e1"]) });
check("correct 引用没给它的证据被丢", forgedEv.length === 0);
const okEv = mem.dreamModelSuggest({ items: [{ action: "correct", ids: [evNote.id], evidence: ["message:msg-e1"], reason: "后来明确改成 npm 了" }], evidenceRefs: new Set(["message:msg-e1"]), dreamId: "dr-test" });
check("correct 带合法证据可以入队", okEv.length === 1 && okEv[0].payload?.evidence?.[0] === "message:msg-e1");
check("模型建议 confidence 标 0.5（与确定性检查区分）", okEv[0]?.confidence === 0.5);
check("模型建议也带 diff", Boolean(okEv[0]?.diff?.includes("stale")));
check("建议记住属于哪一轮 Dream", okEv[0]?.dreamId === "dr-test");

// ── 9. 老库补列 ────────────────────────────────────────────
console.log("[9] 老库迁移");
const legacyDir = path.join(tmp, "legacy");
fs.mkdirSync(legacyDir, { recursive: true });
const legacy = new DatabaseSync(path.join(legacyDir, "mem.db"));
legacy.exec(`
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL, source_kind TEXT, source_ref TEXT, status TEXT NOT NULL, tags TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE entries (id TEXT PRIMARY KEY, layer TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, source_refs TEXT, status TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
CREATE TABLE suggestions (id TEXT PRIMARY KEY, action TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, target_kind TEXT, target_id TEXT, sources TEXT, sig TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER, resolved_at INTEGER);
CREATE TABLE rejects (sig TEXT PRIMARY KEY, at INTEGER, times INTEGER DEFAULT 1);
INSERT INTO entries(id, layer, title, body, source_refs, status, created_at, updated_at)
  VALUES ('old1', 'L4', '老结论', '升级前写的', '[]', 'active', 1700000000000, 1700000000000);
INSERT INTO notes(id, body, status, created_at, updated_at) VALUES ('oldn', '老观察', 'new', 1700000000000, 1700000000000);
`);
legacy.close();
const migrated = createMemory({ dir: legacyDir });
const migratedOld = migrated.entryList({ limit: 10 }).find((e) => e.id === "old1");
check("老条目补上 valid_from", migratedOld?.validFrom === 1700000000000, String(migratedOld?.validFrom));
check("老条目默认不算失效", migratedOld && !migratedOld.invalidAt);
check("老 note 补上 kind/confidence", migrated.noteList({ limit: 10 })[0]?.kind === "guess" && migrated.noteList({ limit: 10 })[0]?.confidence === 0.4);
check("老库能正常注入", migrated.inject({ maxChars: 2000 }).markdown.includes("老结论"));
check("老库补上 dedupe_key 且能去重", (() => {
  const a = migrated.noteAdd({ body: "老库新观察", sourceRef: "run:m" });
  const b = migrated.noteAdd({ body: "老库新观察", sourceRef: "run:m2" });
  return a.id === b.id && b.deduped === true;
})());
migrated.close();

mem.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n✗ ${failures} 项失败` : "\n✓ 全部通过");
process.exit(failures ? 1 : 0);
