/**
 * Webhook 入站（v1）：本机 HTTP 监听，外部服务 POST 一条事件，叫醒某个 bot。
 * 只监听 127.0.0.1，按 bot 的 token 路由；不做公网回调、不引 OAuth。
 */
import crypto from "node:crypto";
import { redactSecrets, safeLink } from "../redact.mjs";

export function newWebhookToken() {
  return crypto.randomBytes(12).toString("hex");
}

/** 标题里也可能夹着 token（贴日志时很常见）：进 bot_events 前一起涂 */
function redactText(text) {
  return redactSecrets(text).text;
}

export function webhookEvent({ botId, payload = {}, now = Date.now() } = {}) {
  const title = String(payload.title || payload.subject || "外部事件").trim().slice(0, 120);
  const text = String(payload.text || payload.body || "").trim().slice(0, 400);
  // 落库前封口：凭据形状的链接直接拒收（不存、不推导），正文里命中密钥形态的一律涂掉
  const url = safeLink(payload.url);
  const external = String(payload.id || "").trim().slice(0, 80);
  const digest = crypto.createHash("sha1").update(`${title}\n${text}`).digest("hex").slice(0, 16);
  const key = `wh:${external || digest}`;
  return {
    id: `wh-${String(botId).replace(/[^a-zA-Z0-9_-]/g, "")}-${external || digest}`,
    botId,
    source: "webhook",
    key,
    title: redactText(text ? `${title}：${text.slice(0, 120)}` : title),
    url,
    at: now,
    seen: false,
  };
}
