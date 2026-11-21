#!/usr/bin/env node
/**
 * 浏览器工具 MCP bridge。
 *
 * 普通（非 Mission）Agent run 的 ACP 会话里挂这个 stdio MCP server，
 * 让模型能操作工作区里那个预览页（导航 / 点击 / 输入 / 读文本 / 截图）。
 * 工具调用转发给 Electron 主进程的 loopback HTTP 端点，token 每次 run 一个。
 */
import process from "node:process";

const endpoint = process.env.COCKPIT_BROWSER_URL || "";
const token = process.env.COCKPIT_BROWSER_TOKEN || "";

const tools = [
  {
    name: "browser_state",
    description: "查看当前预览页：url / 标题 / 是否加载中 / 能否前进后退。调其它浏览器工具前先看一眼。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_open",
    description: "在当前预览页里打开一个地址（http / https / file）。只操作已经打开的那个预览页，不会新开标签。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "完整地址，例如 http://localhost:5173/dashboard" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_read",
    description: "读页面正文文本（可限定容器）。用于确认渲染结果、读报错文案、核对文案是否改对。",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector；省略 = 整页正文" },
        maxChars: { type: "number", description: "最多返回多少字符（默认 6000）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "browser_click",
    description: "点击一个元素（先滚动到可视区，再派发真实鼠标事件）。selector 必须唯一命中目标。",
    inputSchema: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector，例如 button[type=submit] 或 #login" } },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_type",
    description: "往输入框里输入文字（走输入法通道，React 受控组件也能收到）；可选回车提交。",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "输入框 CSS selector；省略 = 当前聚焦元素" },
        text: { type: "string" },
        submit: { type: "boolean", description: "输入完按回车" },
        clear: { type: "boolean", description: "先清空原值" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_wait",
    description: "等某个元素出现（最长 30 秒）。用于等异步渲染 / 跳转完成后再读或点。",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        timeoutMs: { type: "number", description: "默认 5000" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_screenshot",
    description: "给当前页面截图，返回落盘的绝对路径。看「改完长什么样」时用它，别用文字猜。",
    inputSchema: {
      type: "object",
      properties: { fullPage: { type: "boolean", description: "整页截图（默认只截视口）" } },
      additionalProperties: false,
    },
  },
  {
    name: "browser_back",
    description: "预览页后退。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_forward",
    description: "预览页前进。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_reload",
    description: "刷新预览页（改完静态文件后用它看效果；dev server 有 HMR 时一般不需要）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function callMain(name, args) {
  if (!endpoint) throw new Error("COCKPIT_BROWSER_URL 未配置");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, arguments: args || {} }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result;
}

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    write({
      jsonrpc: "2.0", id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cockpit-browser", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return;
  if (msg.method === "ping") { write({ jsonrpc: "2.0", id: msg.id, result: {} }); return; }
  if (msg.method === "tools/list") { write({ jsonrpc: "2.0", id: msg.id, result: { tools } }); return; }
  if (msg.method === "tools/call") {
    try {
      const result = await callMain(msg.params?.name || "", msg.params?.arguments || {});
      write({
        jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      write({
        jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: `工具调用失败：${String(err?.message || err)}` }], isError: true },
      });
    }
    return;
  }
  if (msg.id !== undefined) {
    write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unsupported method: ${msg.method}` } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const at = buffer.indexOf("\n");
    if (at < 0) break;
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line) void handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));
