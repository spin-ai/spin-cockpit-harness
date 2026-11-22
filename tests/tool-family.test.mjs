#!/usr/bin/env node
/**
 * 工具家族 / 状态归类：ACP kind 优先，其次工具名兜底。
 *
 * 这两个函数决定卡片长什么样（终端卡 / diff 卡 / 读取卡 / 外部工具卡），
 * 也决定过程行写「读 2 个文件 · 改 1 处」还是「已完成，用时 3 秒」。
 * 回归点：改成正则家族时别再让 mcp__* 落进「其他」。
 */
import assert from "node:assert/strict";
import { formatToolContent, normalizeToolStatus, toolFamily } from "../electron/tool-format.mjs";

// kind 优先：ACP 的 execute 就是跑命令，哪怕 title 写的是中文
assert.equal(toolFamily({ kind: "execute", title: "运行测试" }), "run");
assert.equal(toolFamily({ kind: "read", title: "读文件" }), "read");
assert.equal(toolFamily({ kind: "edit", title: "改文件" }), "edit");
assert.equal(toolFamily({ kind: "fetch", title: "抓网页" }), "net");
assert.equal(toolFamily({ kind: "think" }), "think");

// 没有 kind 时按名字兜底（旧消息 / bot 只读工具）
assert.equal(toolFamily({ title: "bash" }), "run");
assert.equal(toolFamily({ title: "str_replace_editor" }), "edit");
assert.equal(toolFamily({ title: "read_file" }), "read");
assert.equal(toolFamily({ title: "grep" }), "search");
assert.equal(toolFamily({ title: "todo_write" }), "plan");

// MCP 工具永远落 mcp，不参与家族猜测
assert.equal(toolFamily({ title: "mcp__pdf__create_diagram" }), "mcp");
assert.equal(toolFamily({ title: "whatever", input: '{"name":"mcp__wiki__search"}' }), "mcp");

// 状态归一化
assert.equal(normalizeToolStatus("in_progress"), "running");
assert.equal(normalizeToolStatus("completed"), "done");
assert.equal(normalizeToolStatus("failed"), "failed");
assert.equal(normalizeToolStatus("cancelled"), "stopped");
assert.equal(normalizeToolStatus("awaiting_approval"), "waiting");
assert.equal(normalizeToolStatus("", { rejected: true }), "denied");
assert.equal(normalizeToolStatus("completed", { failed: true }), "failed");

// 首行仍然是「干了什么」：家族改了也不能把正文格式弄坏
const content = formatToolContent({ title: "bash", status: "completed", hint: "ls -1", output: "a\nb" });
assert.ok(content.startsWith("Bash · 完成 · ls -1"), content.split("\n")[0]);
assert.ok(content.includes("a\nb"));

console.log("tool-family: ok");
