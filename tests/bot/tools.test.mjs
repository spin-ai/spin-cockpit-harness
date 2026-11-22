/**
 * 机器人「工具 + 职责卡」的两条不变量：
 *
 * 1. 只读工具可以直连（记忆 / 资料 / 任务 / 运行），写操作永远不在工具表里 —— 模型硬编一个
 *    `memory_write` 也必须被拒，不能顺着它执行。
 * 2. 职责卡（角色 / 目标 / 范围 / 交付物 / 不做 / 汇报口径）必须进 system prompt；
 *    只写人设不写职责，PM 和 DE-A 在模型眼里就是同一个人。
 */

import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { buildSystemPrompt, createBots } from "../../electron/bot/index.mjs";
import { BOT_READ_TOOLS, BOT_READ_TOOL_NAMES, parseToolArgs } from "../../electron/bot/tools.mjs";

await test("工具表只有只读四个，没有写操作", () => {
  assert.deepEqual([...BOT_READ_TOOL_NAMES].sort(), ["knowledge_search", "memory_search", "run_status", "todo_list"]);
  for (const t of BOT_READ_TOOLS) {
    assert.equal(t.type, "function");
    assert.ok(t.function?.description, `${t.function?.name} 缺描述`);
    assert.equal(t.function?.parameters?.type, "object");
  }
  assert.equal(BOT_READ_TOOL_NAMES.some((n) => /write|delete|terminal|exec/.test(n)), false);
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

await test("只读档不暴露工具；work 档写明可用工具与写操作边界", () => {
  const readPrompt = buildSystemPrompt({ name: "看客", capability: "read", persona: {} }, "", { proactive: false });
  assert.equal(readPrompt.includes("memory_search"), false);
  const workPrompt = buildSystemPrompt({ name: "能干", capability: "work", persona: {} }, "", { proactive: false });
  for (const name of BOT_READ_TOOL_NAMES) assert.ok(workPrompt.includes(name), `work 档缺工具 ${name}`);
  assert.ok(workPrompt.includes("task_create"), "work 档缺建任务工具");
  assert.ok(workPrompt.includes("不要声称能改文件"));
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
      // 第二轮：上下文里应该已经有一条 tool 结果
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
});

await test("模型硬编一个没授权的工具（memory_write）：不执行，也不崩", async () => {
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
      if (round === 1) return { text: "", toolCalls: [{ id: "c1", name: "memory_write", args: "{}" }] };
      return { text: "这个我不能自己写，得你确认。", toolCalls: [] };
    },
  });
  bots.ensureSeed();
  const target = { id: "by", name: "PM", capability: "work", persona: {}, status: "active", policy: {} };
  const turn = await bots.reply(target, "把这条写进记忆", { onDelta: () => {} });
  assert.deepEqual(called, []);
  assert.equal(turn.reply, "这个我不能自己写，得你确认。");
});

await test("只读档：即使 runTool 在，也不发 tools、不进入工具循环", async () => {
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
  assert.equal(sawTools, null);
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
  mem.close?.();
  fsMod.rmSync(dir, { recursive: true, force: true });
});
