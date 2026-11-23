/**
 * 机器人会话能用的工具表。
 *
 * 三档，和 capability 对齐，但**读档也能读工作区**——
 * 「只读」是「不能建任务、不能写世界」，不是「不许看文件」：
 *
 *  - read 档：只读工具 + 自己的记忆写入（memory_write / memory_forget）
 *  - dispatch / work 档：只读工具 + 自己的记忆 + task_create（建 todo，起 run 仍需人确认）
 *
 * 红线（tests/bot/tools.test.mjs 守着）：
 *  - 没有任意命令（exec / shell / terminal）、没有改文件、没有改设置；
 *  - 没注册的名字一律回 tool 错误，不执行（见 electron/bot/index.mjs 的工具循环）。
 *
 * schema 用 OpenAI / Ark 的 function calling 格式；执行在 electron/main.mjs（它才拿得到 store / memory / fs）。
 */

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });
const bool = (description) => ({ type: "boolean", description });

export const BOT_READ_TOOLS = [
  fn("memory_search", "检索长期记忆（条目 + 待确认观察）。返回标题、层级与片段，用来回答“你还记得…”。", {
    query: str("检索词，短比长好"),
    limit: int("返回条数，默认 6，最多 12"),
  }, ["query"]),
  fn("knowledge_search", "检索知识库文档（标题 + 命中片段），用来回答项目里已有资料的问题。", {
    query: str("检索词"),
    limit: int("返回条数，默认 5，最多 10"),
  }, ["query"]),
  fn("todo_list", "看当前项目的任务清单（编号 / 标题 / 状态 / 负责人），用来回答“现在有什么活儿”。", {
    status: str("可选：todo / in_progress / in_review / done / all，默认 all"),
    limit: int("默认 20，最多 50"),
  }),
  fn("todo_get", "读一条任务的详情：背景 brief、验收口径、状态、负责人（执行体 / 机器人）、最近几次运行。回答“这条任务要什么、做到哪了”先用它。", {
    todo: str("任务编号或 id，例如 #12 / t123"),
  }, ["todo"]),
  fn("bot_list", "列出工作区里的机器人：名字、角色、职责、能力档位、绑定的执行体、手里还有几条没完的活。分派前用它看谁合适、谁忙。", {
    busy_only: bool("true = 只看手里有活的"),
  }),
  fn("work_list", "看**交给你的工作区**：项目根 / worktree / 终端目录，以及它们上面的终端、运行和未完成任务。接着在那里干活前先用它；workspace=<id> 后面能传给 workspace_* / git_* / task_create。", {}),
  fn("run_status", "看正在跑 / 排队的运行（Agent、任务、状态、耗时），用来回答“现在在忙什么、卡在哪”。默认只列未结束的。", {
    limit: int("默认 10，最多 30"),
    include_done: bool("true = 连已结束的运行一起看（默认 false）"),
  }),
  fn("workspace_list", "列当前项目的目录（只读）。先用它确认路径，再用 workspace_read / workspace_grep；跳过 .git、node_modules、dist 等。", {
    path: str("相对 root 的路径，空 = 根目录"),
    depth: int("1 或 2 层，默认 1"),
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目根"),
  }),
  fn("workspace_read", "读当前项目里的文本文件（只读，按行分页）。回答“某文件第几行是什么”必须用它，不要猜。", {
    path: str("相对 root 的路径，例如 src/App.tsx"),
    offset: int("从第几行开始，默认 0"),
    limit: int("读多少行，默认 200，最多 400"),
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目根"),
  }, ["path"]),
  fn("workspace_grep", "在当前项目里按子串搜索（只读），返回 path:line:text。找定义、找调用、找报错原文时先搜再读。", {
    query: str("要搜的子串，短比长好"),
    path: str("限定目录或文件，空 = 整个项目"),
    limit: int("最多返回多少条命中，默认 40"),
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目根"),
  }, ["query"]),
  fn("git_status", "看当前项目的 git 状态（分支 + 改动文件）。只读，不会暂存或提交。", {
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目根"),
  }),
  fn("git_log", "看当前项目的最近提交（一行一条）。只读。", {
    limit: int("提交条数，默认 10，最多 30"),
    path: str("只看某个路径的历史，可空"),
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目根"),
  }),
  fn("git_diff", "看当前项目的未提交改动。默认只看统计；要具体改动时传 stat=false。只读。", {
    path: str("只看某个路径，可空"),
    staged: bool("true = 只看已暂存；默认 false"),
    stat: bool("true = 只看统计（默认）；false = 看完整 diff"),
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目根"),
  }),
  fn("run_log", "读一次运行的结果：状态、错误、产出、最近消息和终端尾部。用来回答“这次为什么失败 / 跑出了什么”。", {
    runId: str("运行 id；空 = 最近一次运行"),
    todo_key: str("也可以按任务编号（如 T-12）找它最近一次运行"),
    limit: int("消息条数，默认 8，最多 30"),
    result_limit: int("产出取末尾多少字符，默认 1200，最多 4000"),
  }),
];

/** 自己那一份记忆的写入口：只写 owner=bot:<id>，不是共享层，也不能自封 L4 */
export const BOT_SELF_TOOLS = [
  fn("memory_write", "把一条值得长期记住的事实写进**你自己的**记忆（不是共享记忆）。一句话一条，最多 400 字；密钥/令牌会被拒绝。", {
    body: str("一条事实，短句，例如：发票统一放 finance/ 目录"),
    kind: str("可选：decision / preference / gotcha / rule，默认 decision"),
  }, ["body"]),
  fn("memory_forget", "删掉**你自己**记忆里的一条（只能删自己的；传 id 或一句原文）。删错了不能撤销，先 memory_search 确认。", {
    id: str("记忆 id（memory_search 返回）"),
    query: str("或按原文子串找；命中多条时不会删"),
  }),
  fn("handoff_to_bot", "把这件事交给群里另一个机器人（只在群聊里可用）。只做交接，不要再重复回答；交接后由它接手。", {
    to: str("目标机器人的名字或 id"),
    task: str("要它接什么，一句话"),
    reason: str("为什么交给它（可选）"),
  }, ["to", "task"]),
  fn("ask_bot", "在群里问另一个机器人一句（只在群聊里可用）。问题留在群消息里，它回完你再用 run_log / 群记录看；不要用它代替自己回答问题。", {
    to: str("目标机器人的名字或 id"),
    question: str("要问什么，一句话；越具体越好"),
    reason: str("为什么问它（可选）"),
  }, ["to", "question"]),
  fn("plan_set", "把当前任务拆成一个可续的计划（目标 + 步骤）。重开应用后它还在，下一步从这里接着做。", {
    goal: str("这次要完成什么，一句话"),
    steps: { type: "array", items: { type: "string" }, description: "3–8 步，按顺序" },
  }, ["goal", "steps"]),
  fn("plan_update", "把计划里的某一步标成 doing / done / blocked。只改状态，不改步骤文字。", {
    index: int("第几步，从 0 开始"),
    status: str("doing / done / blocked"),
  }, ["index", "status"]),
  fn("routine_propose", "提议一条日程（到点提醒 / 汇报 / 变化才跑）。这只是提议：用户点「建日程」后才生效，不要声称已经建好。", {
    name: str("短名字，例如「早报」"),
    instruction: str("到点要你做什么，写清楚；例如：汇总今天的待确认任务和失败运行，先结论再风险"),
    kind: str("daily / every / once / watch，默认 daily"),
    atHour: int("daily：0–23 点"),
    everyMinutes: int("every：每多少分钟"),
    onceAt: str("once：本地时间 YYYY-MM-DD HH:mm（必须是未来）"),
    watchPath: str("watch：盯这个文件或目录（绝对路径）"),
    watchCmd: str("watch：或盯这条命令的输出"),
    mode: str("alongside（到点就跑，默认）/ in-chat（等这一轮说完）"),
  }, ["name", "instruction"]),
];

/** 会改变世界的工具：只有 dispatch / work 档下发，而且起 run 仍要人点 */
export const BOT_WRITE_TOOLS = [
  fn("run_start", "启动一条**已经建好**的任务（仅 work 档）。只有 bot 打开了「无人值守」且任务属于它绑定的项目时才允许；每小时有上限。", {
    todo: str("任务编号或 id"),
  }, ["todo"]),
  fn("todo_update", "改一条**已有任务**：状态（todo / in_progress / waiting_input / in_review）、负责人（agent 执行体或 bot 机器人）、优先级、验收口径，或补一条备注。确认完成 / 取消是人的动作，这里一律不允许。", {
    todo: str("任务编号或 id"),
    status: str("todo / in_progress / waiting_input / in_review"),
    agent: str("改派给某个执行体（alias 或名字，如 de-a）"),
    bot: str("改派给某个机器人（会用它绑定的执行体；与 agent 二选一）"),
    priority: str("P0 / P1 / P2 / P3"),
    acceptance: { type: "array", items: { type: "string" }, description: "替换验收口径，1–5 条" },
    comment: str("给这条任务留一句备注（写在它的会话里）"),
  }, ["todo"]),
  fn("worker_send", "给正在跑的 worker 发一句话（纠偏 / 追问 / 补约束）。它会在当前 run 里收到；它接下来的回复用 run_log 读，不要连发。", {
    text: str("一句话，短；说清楚改哪里 / 要它回答什么"),
    run: str("run id；空 = 这条工作区 / 你名下正在跑的 run"),
    workspace: str("可选：work_list 里的 workspace=<id>；空 = 当前项目"),
  }, ["text"]),
  fn("task_create", "创建一个任务并指派给某个 worker 执行体，或派给另一个机器人（bot）。只建 todo；默认不起 run。用于把一句话目标拆成可验收的子任务。", {
    title: str("任务标题，短且可验收"),
    brief: str("背景 / 做到什么算完成"),
    agent: str("派给哪个执行体：Agent 的 alias 或名字（如 SE / DE-A / DE-B）"),
    bot: str("派给哪个机器人（名字或 id）：用它的执行体、任务归它，跑完它自己汇报；与 agent 二选一"),
    workspace: str("可选：work_list 里的 workspace=<id>；在这条工作区里起活，不再另建 worktree"),
    acceptance: { type: "array", items: { type: "string" }, description: "验收口径，1–3 条" },
    start: bool("只有用户明确说「开跑 / 开始 / 直接干」时才传 true；默认 false"),
  }, ["title"]),
];

/**
 * 工具元数据：风险、超时、结果上限。
 * 执行端（main）用它做统一的超时/裁剪，不再每个 case 各写一遍。
 */
export const BOT_TOOL_META = Object.freeze({
  memory_search: { risk: "read", label: "查记忆", timeoutMs: 5000, maxResultChars: 8000 },
  knowledge_search: { risk: "read", label: "查资料", timeoutMs: 8000, maxResultChars: 8000 },
  todo_list: { risk: "read", label: "看任务", timeoutMs: 3000, maxResultChars: 8000 },
  todo_get: { risk: "read", label: "任务详情", timeoutMs: 3000, maxResultChars: 8000 },
  bot_list: { risk: "read", label: "看同事", timeoutMs: 3000, maxResultChars: 8000 },
  run_status: { risk: "read", label: "看运行", timeoutMs: 3000, maxResultChars: 8000 },
  work_list: { risk: "read", label: "看工作区", timeoutMs: 5000, maxResultChars: 12000 },
  workspace_list: { risk: "read", label: "看目录", timeoutMs: 5000, maxResultChars: 12000 },
  workspace_read: { risk: "read", label: "读文件", timeoutMs: 5000, maxResultChars: 12000 },
  workspace_grep: { risk: "read", label: "搜代码", timeoutMs: 10000, maxResultChars: 12000 },
  git_status: { risk: "read", label: "看 git 状态", timeoutMs: 10000, maxResultChars: 12000 },
  git_log: { risk: "read", label: "看提交", timeoutMs: 10000, maxResultChars: 12000 },
  git_diff: { risk: "read", label: "看改动", timeoutMs: 15000, maxResultChars: 12000 },
  run_log: { risk: "read", label: "读运行结果", timeoutMs: 5000, maxResultChars: 12000 },
  memory_write: { risk: "self", label: "记一条", timeoutMs: 3000, maxResultChars: 2000 },
  memory_forget: { risk: "self", label: "忘一条", timeoutMs: 3000, maxResultChars: 2000 },
  handoff_to_bot: { risk: "self", label: "交给同事", timeoutMs: 3000, maxResultChars: 2000 },
  ask_bot: { risk: "self", label: "问同事", timeoutMs: 3000, maxResultChars: 2000 },
  plan_set: { risk: "self", label: "写计划", timeoutMs: 3000, maxResultChars: 4000 },
  plan_update: { risk: "self", label: "更新计划", timeoutMs: 3000, maxResultChars: 2000 },
  routine_propose: { risk: "self", label: "提日程", timeoutMs: 3000, maxResultChars: 4000 },
  task_create: { risk: "write", label: "建任务", timeoutMs: 10000, maxResultChars: 4000, requiresCapability: ["work", "dispatch"] },
  worker_send: { risk: "write", label: "给 worker 发话", timeoutMs: 5000, maxResultChars: 2000, requiresCapability: ["work", "dispatch"] },
  todo_update: { risk: "write", label: "改任务", timeoutMs: 5000, maxResultChars: 4000, requiresCapability: ["work", "dispatch"] },
  run_start: { risk: "write", label: "起运行", timeoutMs: 10000, maxResultChars: 2000, requiresCapability: ["work"] },
});

/**
 * 工具目录：UI 的工具面板 / 流式提示都从这里取，不再在渲染层手写一份清单。
 * `label` 是人话（「看目录」），`risk` 决定分组（只读 / 只写自己的 / 写任务）。
 */
export const BOT_TOOL_CATALOG = Object.entries(BOT_TOOL_META).map(([name, meta]) => ({
  name,
  label: meta.label || name,
  risk: meta.risk,
  requiresCapability: meta.requiresCapability || null,
}));

export const BOT_READ_TOOL_NAMES = BOT_READ_TOOLS.map((t) => t.function.name);
export const BOT_SELF_TOOL_NAMES = BOT_SELF_TOOLS.map((t) => t.function.name);
export const BOT_WRITE_TOOL_NAMES = BOT_WRITE_TOOLS.map((t) => t.function.name);
export const BOT_TOOL_NAMES = [...BOT_READ_TOOL_NAMES, ...BOT_SELF_TOOL_NAMES, ...BOT_WRITE_TOOL_NAMES];

/** 这一档位实际下发的工具表（read 也能看工作区，只是不能建任务） */
export function botToolsFor(capability) {
  const tools = [...BOT_READ_TOOLS, ...BOT_SELF_TOOLS];
  for (const t of BOT_WRITE_TOOLS) {
    const need = BOT_TOOL_META[t.function.name]?.requiresCapability;
    if (!need || need.includes(capability)) tools.push(t);
  }
  return tools;
}

/** 档位对应的工具名（prompt 里列给人看的那一行） */
export function toolNamesFor(capability) {
  return botToolsFor(capability).map((t) => t.function.name);
}

/** 模型给的是字符串参数，坏 JSON 不该让整轮挂掉。 */
export function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

/**
 * 按 id / 全名 / 名字里的 handle（「SE · 系统架构」→ se）找一个机器人。
 * 机器人之间的派活、分派前看同伴都用同一套匹配，别各写一份。
 */
export function matchBotRef(list, ref) {
  const raw = String(ref || "").trim().replace(/^@/, "").toLowerCase();
  if (!raw) return null;
  const handleOf = (b) => String(b.name || "").split("·")[0].trim().toLowerCase();
  return (Array.isArray(list) ? list : []).find((b) => b.id === String(ref || "")
    || String(b.name || "").toLowerCase() === raw
    || handleOf(b) === raw) || null;
}
