#!/usr/bin/env node
/**
 * 聊天导入适配器自检（纯函数，无需 Electron）。
 *   node scripts/persona-import-selftest.mjs
 */

import { parseChatAuto, detectFormat, summarize } from "../electron/persona/chat-import.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const TELEGRAM = JSON.stringify({
  name: "工作群",
  type: "private_group",
  messages: [
    { id: 1, type: "service", date: "2024-01-01T09:00:00", text: "张三 加入了群组" },
    { id: 2, type: "message", from: "张三", from_id: "user1", date: "2024-01-02T10:00:00", date_unixtime: "1704189600",
      text: [{ type: "link", text: "我" }, " 喜欢在早上处理复杂任务"] },
    { id: 3, type: "message", from: "李四", from_id: "user2", date: "2024-01-03T11:30:00", text: "下周三是我妈的生日" },
  ],
});

const FEISHU = JSON.stringify([
  { sender: { name: "王五", type: "user" }, create_time: "1704189600000", msg_type: "text", body: { content: JSON.stringify({ text: "我负责后端，白天基本不在线" }) } },
  { sender: { name: "张三", type: "user" }, create_time: "1704276000000", msg_type: "text", body: { content: JSON.stringify({ text: "客户明天来，需要准备演示" }) } },
]);

const WECHAT = `张三 2024-01-02 10:00:00
我习惯早上处理复杂任务
李四 2024-01-02 10:05:00
下周三是我妈生日
2024-01-03 09:00:00 王五
周末一般不接电话
`;

const CSV = `时间,发送者,内容
2024-01-02 10:00:00,张三,我习惯早上处理复杂任务
2024-01-03 09:00:00,王五,周末一般不接电话
`;

console.log("聊天导入适配器自检\n");

console.log("[1] 格式识别");
check("telegram", detectFormat(TELEGRAM) === "telegram", detectFormat(TELEGRAM));
check("feishu", detectFormat(FEISHU) === "feishu", detectFormat(FEISHU));
check("wechat", detectFormat(WECHAT) === "wechat", detectFormat(WECHAT));
check("csv", detectFormat(CSV) === "csv", detectFormat(CSV));

console.log("\n[2] Telegram");
{
  const r = parseChatAuto(TELEGRAM);
  check("跳过 service 消息", r.messages.every((m) => m.speaker !== ""), `${r.messages.length} 条`);
  check("数组 text 拼成一句", r.messages[0]?.text === "我 喜欢在早上处理复杂任务", r.messages[0]?.text);
  check("时间解析", r.messages[0]?.at > 0, new Date(r.messages[0]?.at).toISOString?.());
  const s = summarize(r.messages);
  check("人数统计", s.people === 2, `${s.people} 人 / ${s.messages} 条`);
}

console.log("\n[2.1] 会话类型（决定群聊降权）");
{
  const groupExport = JSON.stringify({ type: "private_supergroup", messages: [{ type: "message", from: "张三", from_id: "u1", date_unixtime: "1704189600", text: "大家好" }] });
  const directExport = JSON.stringify({ type: "personal_chat", messages: [{ type: "message", from: "张三", from_id: "u1", date_unixtime: "1704189600", text: "在吗" }] });
  check("group → chatType=group", parseChatAuto(groupExport).chatType === "group", String(parseChatAuto(groupExport).chatType));
  check("personal_chat → chatType=direct", parseChatAuto(directExport).chatType === "direct", String(parseChatAuto(directExport).chatType));
  check("文本导出不声明会话类型", parseChatAuto(WECHAT).chatType === undefined, String(parseChatAuto(WECHAT).chatType));
}

console.log("\n[3] 飞书");
{
  const r = parseChatAuto(FEISHU);
  check("body.content 里的 text 被解出来", r.messages[0]?.text.includes("我负责后端"), r.messages[0]?.text);
  check("毫秒时间戳", r.messages[0]?.at === 1704189600000, String(r.messages[0]?.at));
}

console.log("\n[4] 微信 txt");
{
  const r = parseChatAuto(WECHAT);
  check("两种行头都能识别", r.messages.length === 3, `${r.messages.length} 条`);
  check("说话人正确", r.messages.map((m) => m.speaker).join(",") === "张三,李四,王五", r.messages.map((m) => m.speaker).join(","));
  check("内容归属正确", r.messages[1]?.text.includes("生日"), r.messages[1]?.text);
}

console.log("\n[5] CSV");
{
  const r = parseChatAuto(CSV);
  check("按表头取列", r.messages.length === 2 && r.messages[0].speaker === "张三", JSON.stringify(r.messages[0]));
}

console.log("\n[6] 兜底与不猜");
{
  const r = parseChatAuto("随便一段没有说话人的文字");
  check("认不出就不产出消息（不猜）", r.messages.length === 0 && r.warnings.length > 0, JSON.stringify(r.warnings));
  const withFallback = parseChatAuto("随便一段没有说话人的文字", { fallback: (t) => ({ messages: [{ speaker: "unknown", text: t, at: null }] }) });
  check("调用方给了兜底才回落", withFallback.messages.length === 1, String(withFallback.messages.length));
  const bad = parseChatAuto("{ not json");
  check("坏 JSON 不抛异常", Array.isArray(bad.messages), bad.format);
}

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
