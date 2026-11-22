#!/usr/bin/env node
/**
 * 飞书通道自测（不联网，fetch 注入）：
 * token 缓存/强刷、401 重试、发送体、事件规范化、event_id 幂等。
 */
import assert from "node:assert/strict";
import { createDedup, createFeishu, normalizeEvent, parseFeishuSetup, textOfContent } from "../electron/im/feishu.mjs";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${String(err?.message || err)}`); process.exitCode = 1; }
};

const calls = [];
let tokenExpire = 7200;
let tokenSeq = 0;
let failTokenOnce = false;
const fetchImpl = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, body, auth: init.headers?.authorization || "" });
  if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
    if (failTokenOnce) { failTokenOnce = false; return { ok: false, status: 500, json: async () => ({ code: 99, msg: "boom" }) }; }
    tokenSeq += 1;
    return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: `t-${tokenSeq}`, expire: tokenExpire }) };
  }
  if (url.includes("/im/v1/messages")) {
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { message_id: "om_1" } }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const logs = [];
const feishu = createFeishu({
  getCredentials: () => ({ appId: "cli_x", appSecret: "sec" }),
  fetchImpl,
  log: { info: (line) => logs.push(String(line)) },
});

await test("tenant token 只取一次，两次发送复用缓存", async () => {
  calls.length = 0;
  await feishu.sendText({ receiveId: "ou_1", text: "hi" });
  await feishu.sendText({ receiveId: "ou_1", text: "hi again" });
  const tokenCalls = calls.filter((c) => c.url.includes("tenant_access_token"));
  assert.equal(tokenCalls.length, 1);
  assert.equal(calls.filter((c) => c.url.includes("/im/v1/messages")).length, 2);
});

await test("发送体正确：receive_id_type / content 是 JSON 字符串 / 带 Bearer", async () => {
  const msg = calls.find((c) => c.url.includes("/im/v1/messages"));
  assert.match(msg.url, /receive_id_type=open_id/);
  assert.equal(msg.body.receive_id, "ou_1");
  assert.equal(msg.body.msg_type, "text");
  assert.deepEqual(JSON.parse(msg.body.content), { text: "hi" });
  assert.equal(msg.auth, "Bearer t-1");
});

await test("chat_id 走 receive_id_type=chat_id", async () => {
  calls.length = 0;
  await feishu.sendText({ receiveId: "oc_1", receiveIdType: "chat_id", text: "x" });
  assert.match(calls.at(-1).url, /receive_id_type=chat_id/);
});

await test("token 过期后自动刷新（时钟推进到 expire 之后）", async () => {
  calls.length = 0;
  tokenExpire = 7200;
  let clock = Date.now();
  const timed = createFeishu({ getCredentials: () => ({ appId: "cli_x", appSecret: "sec" }), fetchImpl, now: () => clock, log: { info() {} } });
  await timed.sendText({ receiveId: "ou_1", text: "a" });
  const first = calls.filter((c) => c.url.includes("tenant_access_token")).length;
  calls.length = 0;
  clock += 7200 * 1000; // 越过 expire
  await timed.sendText({ receiveId: "ou_1", text: "b" });
  assert.equal(first, 1);
  assert.equal(calls.filter((c) => c.url.includes("tenant_access_token")).length, 1, "过期后应重新取 token");
});

await test("错误凭据：抛 no-credentials，不发请求", async () => {
  const bare = createFeishu({ getCredentials: () => ({ appId: "", appSecret: "" }), fetchImpl, log: { info() {} } });
  await assert.rejects(() => bare.sendText({ receiveId: "ou_1", text: "x" }), /未配置飞书/);
});

await test("事件规范化：challenge / 消息 / 其它事件", () => {
  assert.deepEqual(normalizeEvent({ type: "url_verification", challenge: "c1" }), { kind: "challenge", challenge: "c1" });
  const msg = normalizeEvent({
    schema: "2.0",
    header: { event_id: "e1", event_type: "im.message.receive_v1", token: "vt" },
    event: {
      sender: { sender_id: { open_id: "ou_9" } },
      message: { chat_id: "oc_9", chat_type: "group", message_type: "text", content: JSON.stringify({ text: "@_user_1 帮我看下构建" }) },
    },
  });
  assert.equal(msg.kind, "message");
  assert.equal(msg.text, "帮我看下构建");
  assert.equal(msg.chatId, "oc_9");
  assert.equal(msg.openId, "ou_9");
  assert.equal(normalizeEvent({ header: { event_type: "im.chat.updated_v1" }, event: {} }).kind, "ignore");
});

await test("content 解析：坏 JSON 也不抛", () => {
  assert.equal(textOfContent("not json"), "not json");
  assert.equal(textOfContent(JSON.stringify({ text: "@_user_2  hi  there " })), "hi there");
});

await test("event_id 幂等：重复事件只处理一次", () => {
  const dedup = createDedup({ limit: 3 });
  assert.equal(dedup.has("a"), false);
  dedup.add("a");
  assert.equal(dedup.has("a"), true);
});

await test("一次粘贴：分行 / 冒号 / 等号 / JSON / webhook 都能认出来", () => {
  assert.deepEqual(parseFeishuSetup("cli_aa11\nsecret-value-123"), { mode: "app", appId: "cli_aa11", appSecret: "secret-value-123" });
  assert.deepEqual(parseFeishuSetup("cli_aa11:secret-value-123"), { mode: "app", appId: "cli_aa11", appSecret: "secret-value-123" });
  assert.deepEqual(parseFeishuSetup("cli_aa11=secret-value-123"), { mode: "app", appId: "cli_aa11", appSecret: "secret-value-123" });
  assert.deepEqual(parseFeishuSetup(JSON.stringify({ app_id: "cli_bb22", app_secret: "anothersecret" })), { mode: "app", appId: "cli_bb22", appSecret: "anothersecret" });
  assert.deepEqual(parseFeishuSetup("https://open.feishu.cn/open-apis/bot/v2/hook/abc"), { mode: "webhook", webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" });
});

await test("一次粘贴：认不出的输入返回 null，而不是瞎猜", () => {
  assert.equal(parseFeishuSetup(""), null);
  assert.equal(parseFeishuSetup("随便一句话"), null);
  assert.equal(parseFeishuSetup("cli_aa11"), null, "只有 app_id 不够");
  assert.equal(parseFeishuSetup("https://example.com/hook"), null);
});

console.log(`\nFeishu: ${passed} 项 · ${process.exitCode ? "failed" : "passed"}`);
