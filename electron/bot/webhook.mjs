/**
 * Webhook 入站（v1）：本机 HTTP 监听，外部服务 POST 一条事件，叫醒某个 bot。
 * 只监听 127.0.0.1，按 bot 的 token 路由；不做公网回调、不引 OAuth。
 */
import crypto from "node:crypto";

export function newWebhookToken() {
  return crypto.randomBytes(12).toString("hex");
}

export function webhookEvent({ botId, payload = {}, now = Date.now() } = {}) {
  const title = String(payload.title || payload.subject || "外部事件").trim().slice(0, 120);
  const text = String(payload.text || payload.body || "").trim().slice(0, 400);
  const url = String(payload.url || "").trim().slice(0, 500);
  const external = String(payload.id || "").trim().slice(0, 80);
  const digest = crypto.createHash("sha1").update(`${title}\n${text}`).digest("hex").slice(0, 16);
  const key = `wh:${external || digest}`;
  return {
    id: `wh-${String(botId).replace(/[^a-zA-Z0-9_-]/g, "")}-${external || digest}`,
    botId,
    source: "webhook",
    key,
    title: text ? `${title}：${text.slice(0, 120)}` : title,
    url,
    at: now,
    seen: false,
  };
}
