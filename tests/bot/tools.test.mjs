/**
 * 机器人「工具 + 职责卡」的不变量：
 *
 * 1. 工具表分三档：只读（含工作区）、自己的记忆、建任务。
 *    「只读」不等于「看不见」——read 档也能读文件/git/运行；
 *    写世界（改文件、跑任意命令、改设置）永远不在工具表里。
 * 2. 职责卡（角色 / 目标 / 范围 / 交付物 / 不做 / 汇报口径）必须进 system prompt；
 *    只写人设不写职责，PM 和 DE-A 在模型眼里就是同一个人。
 * 3. 工具循环有上限和循环保护：同参 3 次 / 最多 8 轮，停下来的原因要落库。
 */

import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { buildSystemPrompt, createBots, MAX_TOOL_ROUNDS } from "../../electron/bot/index.mjs";
import {
  BOT_READ_TOOL_NAMES, BOT_SELF_TOOL_NAMES, BOT_TOOL_META, BOT_WRITE_TOOL_NAMES,
  botToolsFor, parseToolArgs,
} from "../../electron/bot/tools.mjs";

const EXPECTED_READ = [
  "git_diff", "git_log", "git_status", "knowledge_search", "memory_search",
  "run_log", "run_status", "todo_list", "workspace_grep", "workspace_list", "workspace_read",
];

await test("工具表：只读含工作区；写世界的一个都没有", () => {
  assert.deepEqual([...BOT_READ_TOOL_NAMES].sort(), EXPECTED_READ);
  assert.deepEqual([...BOT_SELF_TOOL_NAMES].sort(), ["handoff_to_bot", "memory_forget", "memory_write", "routine_propose"]);
  assert.deepEqual([...BOT_WRITE_TOOL_NAMES].sort(), ["task_create"]);
  for (const t of botToolsFor("work")) {
    assert.equal(t.type, "function");
    assert.ok(t.function?.description, `${t.function?.name} 缺描述`);
    assert.equal(t.function?.parameters?.type, "object");
    assert.ok(BOT_TOOL_META[t.function.name], `${t.function.name} 缺元数据`);
  }
  assert.equal(BOT_READ_TOOL_NAMES.some((n) => /exec|shell|terminal|write_file|rm|settings/.test(n)), false);
});

await test("档位：read 能看工作区、能记自己的记忆，但没有 task_create", () => {
  const read = botToolsFor("read").map((t) => t.function.name);
  assert.ok(read.includes("workspace_read"));
  assert.ok(read.includes("memory_write"));
  assert.equal(read.includes("task_create"), false);
  const work = botToolsFor("work").map((t) => t.function.name);
  assert.ok(work.includes("task_create"));
  const dispatch = botToolsFor("dispatch").map((t) => t.function.name);
  assert.ok(dispatch.includes("task_create"));
});

await test("工具参数：坏 JSON / 空值都退回空对象，不抛", () => {
  assert.deepEqual(parseToolArgs("{"), {});
  assert.deepEqual(parseToolArgs(""), {});
  assert.deepEqual(parseToolArgs('{"query":"STDF"}'), { query: "STDF" });
  assert.deepEqual(parseToolArgs({ query: "对象直传" }), { query: "对象直传" });
});

await test("职责卡进 prompt：角色 / 目标 / 范围 / 交付物 / 不做 / 汇报口径都在", () => {
  const prompt = buildSystemPrompt({
    name: "PM", role: "supervisor", capability: "work",
    persona: {
      mission: "拆解与分派",
      duty: {
        goal: "STDF 工具按期交付",
        scope: "只做拆解、分派、验收，不改代码",
        deliverable: "计划 + 子任务 + 验收结论",
        forbidden: "不直接改仓库文件",
        report: "先结论，再风险，各一句",
      },
    },
  }, "", { proactive: false });
  for (const line of ["角色：主管", "职责（用户亲口说的）：拆解与分派", "目标：STDF 工具按期交付", "范围：只做拆解", "交付物：计划 + 子任务", "不做什么：不直接改仓库文件", "汇报口径：先结论"]) {
    assert.ok(prompt.includes(line), `prompt 缺「${line}」`);
  }
});

await test("read 档 prompt：列出只读工具，不列 task_create，也不声称能写", () => {
  const prompt = buildSystemPrompt({ name: "看客", capability: "read", persona: {} }, "", { proactive: false });
  for (const name of ["workspace_read", "git_diff", "run_log", "memory_write"]) {
    assert.ok(prompt.includes(name), `read 档缺工具 ${name}`);
  }
  assert.equal(prompt.includes("task_create"), false);
  assert.match(prompt, /不能建任务/);
});

await test("work 档 prompt：列出全部工具与写操作边界", () => {
  const prompt = buildSystemPrompt({ name: "能干", capability: "work", persona: {} }, "", { proactive: false });
  for (const name of BOT_READ_TOOL_NAMES) assert.ok(prompt.includes(name), `work 档缺工具 ${name}`);
  assert.ok(prompt.includes("task_create"), "work 档缺建任务工具");
  assert.ok(prompt.includes("不能改文件"));
});

const store = { state: { bots: [], botTurns: [] }, persist() {} };
const called = [];

await test("工具循环：先查再答，工具结果回灌，答复落库并留痕", async () => {
  let round = 0;
  const bots = createBots({
    store,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async (name, args) => {
      called.push({ name, args });
      return { rows: [{ title: "STDF V4 解析与展示工具", status: "todo" }] };
    },
    chatStream: async (messages, { onDelta, tools }) => {
      round += 1;
      assert.ok(Array.isArray(tools) && tools.length, "work 档必须带工具表");
      if (round === 1) {
        const toolMsg = messages.at(-1);
        assert.equal(toolMsg.role, "user");
        return { text: "", toolCalls: [{ id: "call_1", name: "todo_list", args: '{"limit":5}' }] };
      }
      const toolResult = messages.find((m) => m.role === "tool");
      assert.ok(toolResult, "第二轮必须带上工具结果");
      assert.ok(toolResult.content.includes("STDF V4 解析与展示工具"));
      onDelta?.("目前只");
      onDelta?.("有一条待办。");
      return { text: "目前只有一条待办。", toolCalls: [] };
    },
  });
  bots.ensureSeed();
  const target = { id: "bx", name: "PM", capability: "work", persona: {}, status: "active", policy: {} };
  const turn = await bots.reply(target, "现在有什么任务？", { onDelta: () => {} });
  assert.deepEqual(called, [{ name: "todo_list", args: { limit: 5 } }]);
  assert.equal(turn.reply, "目前只有一条待办。");
  assert.equal(turn.tools?.[0]?.name, "todo_list");
  assert.equal(store.state.botTurns.at(-1).tools?.[0]?.name, "todo_list");
  assert.equal(turn.cost.rounds, 2);
  assert.ok(turn.context?.chars > 0, "要记录本轮上下文占用");
});

await test("循环保护：同一工具同参数第 4 次就停，并把原因落库", async () => {
  called.length = 0;
  const bots = createBots({
    store,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async (name) => { called.push({ name }); return { rows: [] }; },
    chatStream: async () => ({ text: "", toolCalls: [{ id: `c${called.length}`, name: "todo_list", args: '{"status":"all"}' }] }),
  });
  bots.ensureSeed();
  const target = { id: "bloop", name: "循环", capability: "work", persona: {}, status: "active", policy: {} };
  const turn = await bots.reply(target, "查一下", { onDelta: () => {} });
  assert.equal(called.length, 3, "第 4 次重复应该被拦下，不执行");
  assert.match(turn.stopReason, /同一工具同参数/);
  assert.match(turn.reply, /查到这里停下了/);
});

await test("轮数上限：不同参数也最多 8 轮，停因可解释", async () => {
  let rounds = 0;
  const bots = createBots({
    store,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async () => ({ ok: true }),
    chatStream: async () => {
      rounds += 1;
      return { text: "继续查。", toolCalls: [{ id: `c${rounds}`, name: "workspace_read", args: JSON.stringify({ path: `f${rounds}.md` }) }] };
    },
  });
  bots.ensureSeed();
  const target = { id: "bround", name: "轮数", capability: "work", persona: {}, status: "active", policy: {} };
  const turn = await bots.reply(target, "继续", { onDelta: () => {} });
  assert.equal(rounds, MAX_TOOL_ROUNDS);
  assert.match(turn.stopReason, /轮工具上限/);
  assert.equal(turn.cost.rounds, MAX_TOOL_ROUNDS);
});

await test("模型硬编一个没注册的工具（file_write）：不执行，也不崩", async () => {
  called.length = 0;
  let round = 0;
  const bots = createBots({
    store,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async (name) => { called.push({ name }); return { ok: true }; },
    chatStream: async () => {
      round += 1;
      if (round === 1) return { text: "", toolCalls: [{ id: "c1", name: "file_write", args: "{}" }] };
      return { text: "这个我不能自己写，得你确认。", toolCalls: [] };
    },
  });
  bots.ensureSeed();
  const target = { id: "by", name: "PM", capability: "work", persona: {}, status: "active", policy: {} };
  const turn = await bots.reply(target, "把这条写进文件", { onDelta: () => {} });
  assert.deepEqual(called, []);
  assert.equal(turn.reply, "这个我不能自己写，得你确认。");
  assert.equal(turn.tools?.[0]?.rejected, true);
});

await test("日程建议：工具只出草稿，回合上挂 proposal，确认前不建", async () => {
  const st = { state: { bots: [], botTurns: [] }, persist() {} };
  let round = 0;
  const b = createBots({
    store: st,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async (name) => {
      assert.equal(name, "routine_propose");
      return { ok: true, routine: { name: "早报", kind: "daily", prompt: "汇总今天的待确认任务", when: "每天 09:00", nextAt: 0 } };
    },
    chatStream: async () => {
      round += 1;
      if (round === 1) return { text: "", toolCalls: [{ id: "c1", name: "routine_propose", args: '{"name":"早报","instruction":"汇总今天的待确认任务"}' }] };
      return { text: "给你排好了，确认就建。", toolCalls: [] };
    },
  });
  b.ensureSeed();
  const target = { id: "br", name: "排程", capability: "work", persona: {}, status: "active", policy: {} };
  const turn = await b.reply(target, "每天 9 点给我早报", { onDelta: () => {} });
  assert.equal(turn.routineProposal?.name, "早报");
  assert.equal(turn.routineProposal?.prompt, "汇总今天的待确认任务");
  assert.equal(turn.routineId, undefined, "确认前不能建");
  assert.equal((st.state.routines || []).length, 0, "确认前不能建");
});

await test("人格历史：改一次存一版，恢复生成新版本（旧记录不删）", async () => {
  const st = { state: { bots: [], botTurns: [] }, persist() {} };
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  b.ensureSeed();
  const target = b.list()[0];
  const before = target.name;
  b.save({ id: target.id, name: "新名字" });
  const revs = b.revisions(target.id);
  assert.equal(revs.length, 1);
  assert.equal(revs[0].name, before, "存的是改动前的那一版");
  b.save({ id: target.id, name: "再改" });
  assert.equal(b.revisions(target.id).length, 2);
  b.restore(target.id, revs[0].id);
  assert.equal(b.list().find((x) => x.id === target.id).name, before);
  assert.equal(b.revisions(target.id).length, 3, "恢复也要记一版");
});

await test("群聊 handoff：回合上挂交接对象，prompt 带群聊交接规则", async () => {
  let system = "";
  let round = 0;
  const st = { state: { bots: [], botTurns: [] }, persist() {} };
  const b = createBots({
    store: st,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async (name, args, ctx) => {
      assert.equal(name, "handoff_to_bot");
      assert.equal(ctx.groupId, "g1", "群聊里才带 groupId");
      return { ok: true, handoff: { to: "b2", toName: "小B", task: "查部署", reason: "它管知识库" } };
    },
    chatStream: async (messages) => {
      system = messages[0].content;
      round += 1;
      if (round === 1) return { text: "", toolCalls: [{ id: "h1", name: "handoff_to_bot", args: '{"to":"小B","task":"查部署"}' }] };
      return { text: "我交给小B了。", toolCalls: [] };
    },
  });
  b.ensureSeed();
  const target = { id: "bh", name: "小A", capability: "read", persona: {}, status: "active", policy: {} };
  const turn = await b.reply(target, "查一下部署结论", { onDelta: () => {}, groupId: "g1" });
  assert.equal(turn.handoff?.to, "b2");
  assert.equal(turn.handoff?.task, "查部署");
  assert.match(system, /handoff_to_bot/);
  assert.match(system, /你在群聊里/);
});

await test("人格历史：旧页保存会冲突；diff 只列改动字段", () => {
  let clock = NOON;
  const st = { state: { bots: [], botTurns: [] }, persist() {} };
  const b = createBots({ store: st, now: () => clock, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  b.ensureSeed();
  const target = b.list()[0];
  const seen = target.updatedAt;
  clock += 1000;
  b.save({ id: target.id, name: "新名字", expectedUpdatedAt: seen });
  clock += 1000;
  assert.throws(() => b.save({ id: target.id, name: "旧页覆盖", expectedUpdatedAt: seen }), /别处修改/);
  b.save({ id: target.id, persona: { ...(target.persona || {}), mission: "新职责" } });
  const initial = b.revisions(target.id).find((r) => r.name !== "新名字" && r.name !== "旧页覆盖");
  assert.ok(initial, "应该留着一版改名前的人格");
  const diff = b.revisionDiff(target.id, initial.id);
  assert.ok(diff.some((d) => d.label === "名字"));
  assert.ok(diff.some((d) => d.label === "职责"));
  assert.equal(diff.some((d) => d.label === "角色"), false, "没变的字段不列");
});

await test("read 档：发只读工具表，但不发 task_create", async () => {
  called.length = 0;
  let sawTools = null;
  const bots = createBots({
    store,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "test-key",
    runTool: async (name) => { called.push({ name }); return {}; },
    chatStream: async (_messages, { tools }) => { sawTools = tools; return { text: "只读档只回答。", toolCalls: [] }; },
  });
  bots.ensureSeed();
  const target = { id: "bz", name: "看客", capability: "read", persona: {}, status: "active", policy: {} };
  const turn = await bots.reply(target, "现在有什么任务？", { onDelta: () => {} });
  const names = (sawTools || []).map((t) => t.function.name);
  assert.ok(names.includes("workspace_read"));
  assert.ok(names.includes("memory_write"));
  assert.equal(names.includes("task_create"), false);
  assert.deepEqual(called, []);
  assert.equal(turn.reply, "只读档只回答。");
});

/**
 * 记忆归属：bot 起的 run 写的记忆要落在 `bot:<id>`，别的 bot 注入时不漏。
 * 读取端（inject owner 过滤）早就有；写入端不传 owner 时这里就是防回归的那根线。
 */
await test("记忆归属：bot 私有的写入不外溢，共享写入两边都看得到", async () => {
  const fsMod = await import("node:fs");
  const osMod = await import("node:os");
  const pathMod = await import("node:path");
  const { createMemory } = await import("../../electron/memory/index.mjs");
  const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), "bot-owner-"));
  const mem = createMemory({ dir });
  mem.entryUpsert({ layer: "L4", title: "PM 私有", body: "只有 PM 该知道", owner: "bot:pm" });
  mem.entryUpsert({ layer: "L4", title: "团队共享", body: "谁都能看", owner: "" });
  const asPm = mem.inject({ maxChars: 4000, owner: "bot:pm" }).markdown;
  const asDe = mem.inject({ maxChars: 4000, owner: "bot:de" }).markdown;
  assert.match(asPm, /只有 PM 该知道/);
  assert.doesNotMatch(asDe, /只有 PM 该知道/, "别的 bot 不能看到 PM 私有记忆");
  assert.match(asDe, /谁都能看/, "共享层对所有人可见");
  assert.equal(mem.entrySearch({ query: "只有 PM", owner: "bot:de" }).length, 0, "entrySearch 也不能绕过 owner");
  assert.equal(mem.entrySearch({ query: "只有 PM", owner: "bot:pm" }).length, 1);
  mem.close?.();
  fsMod.rmSync(dir, { recursive: true, force: true });
});
