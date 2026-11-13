/**
 * 即时通信网关：把 IM 消息接进同一套会话模型。
 *
 * 支持：
 *  - Telegram（long-poll getUpdates，需要 bot token）
 *  - 飞书 / 微信：出站走自定义 webhook；入站走本地 HTTP 回调（需要公网可达/内网转发）
 *
 * 规则（对齐需求）：
 *  - 只处理 allowlist 里的会话，陌生会话直接忽略并留痕
 *  - 三类事实分开展示：结果 / 执行步骤 / 协议身份
 *  - 桌面不在线时消息留在 IM 侧队列（Telegram 的 offset 机制），下次启动继续处理
 *  - 审批卡一次只问一个问题，回复数字即选择
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const IDENT = "cockpit-harness/im-gateway";

export function createImGateway({ dir, settings, onMessage, onLog = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const offsetFile = path.join(dir, "telegram-offset.json");
  const loadOffset = () => { try { return Number(JSON.parse(fs.readFileSync(offsetFile, "utf8")).offset) || 0; } catch { return 0; } };
  const saveOffset = (offset) => { try { fs.writeFileSync(offsetFile, JSON.stringify({ offset })); } catch { /* ignore */ } };

  let stopped = false;
  let pollTimer = null;
  let server = null;
  let offset = loadOffset();

  const cfg = () => ({
    enabled: Boolean(settings()?.imEnabled),
    telegramToken: String(settings()?.imTelegramToken || "").trim(),
    telegramAllow: String(settings()?.imTelegramAllow || "").split(/[\s,;]+/).filter(Boolean),
    webhook: String(settings()?.imWebhookUrl || "").trim(),
    webhookToken: String(settings()?.imWebhookToken || "").trim(),
    inboundPort: Number(settings()?.imInboundPort) || 0,
    allowIds: String(settings()?.imAllowIds || "").split(/[\s,;]+/).filter(Boolean),
  });

  const allowed = (id) => {
    const c = cfg();
    const list = [...c.telegramAllow, ...c.allowIds];
    return list.length === 0 ? false : list.includes(String(id)) || list.includes("*");
  };

  async function telegramCall(method, payload) {
    const c = cfg();
    if (!c.telegramToken) throw new Error("未配置 Telegram bot token");
    const res = await fetch(`https://api.telegram.org/bot${c.telegramToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.description || `telegram ${method} failed`);
    return data.result;
  }

  /** 出站：按 to 前缀选通道；默认 telegram */
  async function send(text, { to = "", kind = "telegram" } = {}) {
    const c = cfg();
    const body = String(text || "");
    if (!body.trim()) return { sent: false };
    if (kind === "telegram" && c.telegramToken && to) {
      await telegramCall("sendMessage", { chat_id: to, text: body, disable_web_page_preview: true });
      return { sent: true, via: "telegram" };
    }
    if (c.webhook) {
      const res = await fetch(c.webhook, {
        method: "POST",
        headers: { "content-type": "application/json", ...(c.webhookToken ? { authorization: `Bearer ${c.webhookToken}` } : {}) },
        body: JSON.stringify({ to, text: body, from: IDENT }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
      return { sent: true, via: "webhook" };
    }
    throw new Error("没有可用的出站通道（配置 Telegram token 或 webhook）");
  }

  async function pollOnce() {
    const c = cfg();
    if (!c.enabled || !c.telegramToken || stopped) return;
    try {
      const updates = await telegramCall("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
      for (const up of updates || []) {
        offset = Math.max(offset, Number(up.update_id) + 1);
        saveOffset(offset);
        const msg = up.message;
        const chatId = msg?.chat?.id ? String(msg.chat.id) : "";
        const text = String(msg?.text || "").trim();
        if (!chatId || !text) continue;
        if (!allowed(chatId)) { onLog(`ignored stranger chat ${chatId}`); continue; }
        try { await onMessage({ text, chatId, kind: "telegram", from: msg.from?.username || msg.from?.first_name || "" }); }
        catch (err) { await send(`处理失败：${String(err?.message || err).slice(0, 300)}`, { to: chatId }).catch(() => {}); }
      }
    } catch (err) {
      onLog(`telegram poll failed: ${String(err?.message || err).slice(0, 200)}`);
    }
  }

  function loop() {
    if (stopped) return;
    void pollOnce().finally(() => {
      if (stopped) return;
      pollTimer = setTimeout(loop, cfg().telegramToken ? 500 : 5000);
    });
  }

  function startInbound() {
    const c = cfg();
    if (!c.enabled || !c.inboundPort) return;
    server = http.createServer(async (req, res) => {
      const send2 = (code, payload) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (req.method !== "POST") return send2(405, { ok: false });
      const auth = String(req.headers.authorization || "");
      if (c.webhookToken && auth !== `Bearer ${c.webhookToken}`) return send2(403, { ok: false, error: "bad token" });
      let raw = "";
      for await (const chunk of req) raw += chunk;
      try {
        const payload = JSON.parse(raw || "{}");
        const text = String(payload.text || payload.content || payload.message || "").trim();
        const chatId = String(payload.chat_id || payload.from || payload.open_id || "");
        if (!text || !chatId) return send2(400, { ok: false, error: "需要 chat_id 与 text" });
        if (!allowed(chatId)) { onLog(`ignored stranger chat ${chatId}`); return send2(403, { ok: false, error: "not allowed" }); }
        const out = await onMessage({ text, chatId, kind: payload.channel === "feishu" ? "feishu" : "wechat", from: payload.from || "" });
        return send2(200, { ok: true, result: out });
      } catch (err) { return send2(400, { ok: false, error: String(err?.message || err) }); }
    });
    server.listen(c.inboundPort, "127.0.0.1", () => onLog(`inbound listening 127.0.0.1:${c.inboundPort}`));
    server.on("error", (err) => onLog(`inbound error: ${String(err?.message || err)}`));
  }

  return {
    start() {
      const c = cfg();
      if (!c.enabled) { onLog("disabled"); return; }
      loop();
      startInbound();
      onLog(`started${c.telegramToken ? " · telegram" : ""}${c.webhook ? " · webhook" : ""}`);
    },
    stop() {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      try { server?.close(); } catch { /* ignore */ }
    },
    send,
    status() {
      const c = cfg();
      return { enabled: c.enabled, telegram: Boolean(c.telegramToken), webhook: Boolean(c.webhook), inbound: c.inboundPort || 0, allow: [...c.telegramAllow, ...c.allowIds] };
    },
  };
}

/** 结果 / 步骤 / 身份 三段式卡片 */
export function formatImCard({ title, result, steps = [], branch = "", runId = "", agent = "" }) {
  const lines = [];
  lines.push(`【${title || "任务"}】`);
  lines.push("── 结果 ──");
  lines.push(String(result || "（还没有结论）").slice(0, 1200));
  if (steps.length) {
    lines.push("── 执行步骤 ──");
    for (const step of steps.slice(-6)) lines.push(`· ${String(step).slice(0, 100)}`);
  }
  lines.push("── 协议身份 ──");
  lines.push(`${IDENT}${agent ? ` · agent=${agent}` : ""}${runId ? ` · run=${runId}` : ""}${branch ? ` · branch=${branch}` : ""}`);
  return lines.join("\n");
}

export function formatApprovalCard({ title, description, options = [] }) {
  const lines = [`【需要你确认】${title || "审批"}`, String(description || "").slice(0, 600)];
  options.forEach((o, i) => lines.push(`${i + 1}. ${o.name || o.optionId || o.kind}`));
  lines.push("回复数字即可（一次只问这一个问题）。");
  return lines.join("\n");
}
