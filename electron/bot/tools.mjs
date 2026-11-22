/**
 * 机器人会话能用的**只读**工具。
 *
 * 边界（和 capability 三档同一条线）：
 *  - 读：查记忆 / 查资料 / 看任务 / 看运行 —— 直接调，不需要审批；
 *  - 写：改文件、跑命令、起任务，一律不在这里出现，必须「提议 → 人确认 → 走 run」。
 *
 * schema 用 OpenAI / Ark 的 function calling 格式；执行在 main.mjs（它才拿得到 store / memory / knowledge）。
 */

export const BOT_READ_TOOLS = [
  {
    type: "function",
    function: {
      name: "memory_search",
      description: "检索长期记忆（条目 + 待确认观察）。返回标题、层级与片段，用来回答“你还记得…”。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索词，短比长好" },
          limit: { type: "integer", description: "返回条数，默认 6" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "knowledge_search",
      description: "检索知识库文档（标题 + 命中片段），用来回答项目里已有资料的问题。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索词" },
          limit: { type: "integer", description: "返回条数，默认 5" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_list",
      description: "看当前项目的任务清单（编号 / 标题 / 状态 / 负责人），用来回答“现在有什么活儿”。",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "可选：todo / in_progress / in_review / done / all，默认 all" },
          limit: { type: "integer", description: "默认 20" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_status",
      description: "看正在跑 / 排队的运行（Agent、任务、状态、耗时），用来回答“现在在忙什么、卡在哪”。",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "默认 10" },
        },
      },
    },
  },
];

export const BOT_READ_TOOL_NAMES = BOT_READ_TOOLS.map((t) => t.function.name);

/** 模型给的是字符串参数，坏 JSON 不该让整轮挂掉。 */
export function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}
