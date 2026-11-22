import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { newWebhookToken, webhookEvent } from "../../electron/bot/webhook.mjs";

await test("Webhook：token 随机；事件取 title/text/url 并生成稳定 key", () => {
  assert.match(newWebhookToken(), /^[0-9a-f]{24}$/);
  const a = webhookEvent({ botId: "b1", payload: { title: "部署失败", text: "api 502", url: "https://x" }, now: 1000 });
  const b = webhookEvent({ botId: "b1", payload: { title: "部署失败", text: "api 502" }, now: 2000 });
  assert.equal(a.key, b.key, "同样内容应去重");
  assert.equal(a.url, "https://x");
  assert.match(a.title, /部署失败/);
  assert.equal(webhookEvent({ botId: "b1", payload: { id: "evt-1", title: "x" } }).key, "wh:evt-1");
});
