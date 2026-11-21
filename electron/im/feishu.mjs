/**
 * 飞书开放接口的最小封装（只做 bot 需要的三件事）：
 *   1. tenant_access_token 获取与缓存（提前 5 分钟过期，401 时强刷一次）
 *   2. im/v1/messages 发文本（receive_id 支持 open_id / chat_id）
 *   3. 事件 v2 的规范化：url_verification 握手 + im.message.receive_v1 → 统一消息
 *
 * 不引 SDK：长连接（WSClient）需要额外的 protobuf 依赖，等凭据到位再决定；
 * 现在走「本地 HTTP 回调 + 自己解析事件体」，这样没有公网也能用内网穿透联调。
 * fetch 可注入，便于离线自测。
 */
const BASE = "https://open.feishu.cn";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** 事件去重：event_id 会重推，必须幂等（Feishu 3s 内未 ack 就重发） */
export function createDedup({ limit = 500, ttlMs = 30 * 60 * 1000 } = {}) {
  const seen = new Map();
  return {
    has(id) {
      const at = seen.get(id);
      if (!at) return false;
      if (Date.now() - at > ttlMs) { seen.delete(id); return false; }
      return true;
    },
    add(id) {
      seen.set(id, Date.now());
      if (seen.size > limit) {
        for (const [key, at] of seen) { if (Date.now() - at > ttlMs || seen.size > limit) seen.delete(key); if (seen.size <= limit) break; }
      }
    },
  };
}

/** 从飞书消息 content（JSON 字符串）里取纯文本，并去掉 @ 占位符 */
export function textOfContent(content) {
  let text = "";
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    text = String(parsed?.text ?? "");
  } catch {
    text = String(content ?? "");
  }
  return text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 规范化事件体。返回：
 *   { kind: "challenge", challenge }               url_verification 握手
 *   { kind: "message", eventId, chatId, chatType, openId, text, messageType }
 *   { kind: "ignore", reason }                     其它事件
 */
export function normalizeEvent(payload) {
  if (!payload || typeof payload !== "object") return { kind: "ignore", reason: "empty" };
  if (payload.type === "url_verification" || payload.challenge) {
    return { kind: "challenge", challenge: String(payload.challenge || "") };
  }
  const header = payload.header || {};
  const event = payload.event || {};
  const message = event.message || {};
  const sender = event.sender || {};
  const eventType = String(header.event_type || payload.event_type || "");
  if (eventType && eventType !== "im.message.receive_v1") return { kind: "ignore", reason: eventType };
  const chatId = String(message.chat_id || payload.open_chat_id || "");
  const text = textOfContent(message.content ?? payload.content ?? "");
  if (!chatId || !text) return { kind: "ignore", reason: "no-chat-or-text" };
  return {
    kind: "message",
    eventId: String(header.event_id || payload.uuid || ""),
    chatId,
    chatType: String(message.chat_type || "p2p"),
    openId: String(sender.sender_id?.open_id || payload.open_id || ""),
    messageType: String(message.message_type || "text"),
    text,
  };
}

/**
 * 一次粘贴就能配好：接受几种常见粘法，自动判断是「自建应用」还是「群机器人 webhook」。
 *
 *   cli_xxx:secret            冒号/等号/空白/换行分隔都行
 *   cli_xxx
 *   <secret>                  （两行）
 *   {"app_id":"cli_x","app_secret":"..."}   OpenAPI 后台的 JSON 片段
 *   https://open.feishu.cn/open-apis/bot/v2/hook/xxx   自定义机器人
 *
 * 返回 { mode: "app"|"webhook", appId, appSecret, webhookUrl }；认不出返回 null。
 */
export function parseFeishuSetup(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    return /open\.feishu\.cn\/open-apis\/bot\/v2\/hook\//i.test(raw)
      ? { mode: "webhook", webhookUrl: raw }
      : null;
  }
  try {
    const json = JSON.parse(raw);
    const appId = String(json.app_id || json.appId || "").trim();
    const appSecret = String(json.app_secret || json.appSecret || "").trim();
    if (/^cli_[A-Za-z0-9]+$/.test(appId) && appSecret) return { mode: "app", appId, appSecret };
  } catch { /* 不是 JSON，继续按文本解析 */ }
  const parts = raw.split(/[\s,;:=]+/).map((x) => x.trim()).filter(Boolean);
  const appId = parts.find((x) => /^cli_[A-Za-z0-9]+$/.test(x)) || "";
  const rest = parts.filter((x) => x !== appId);
  const appSecret = rest.find((x) => x.length >= 8) || "";
  if (appId && appSecret) return { mode: "app", appId, appSecret };
  return null;
}

export function createFeishu({ getCredentials, fetchImpl = fetch, log = console, now = () => Date.now() }) {
  let cache = null; // { token, expireAt }

  const creds = () => {
    const raw = getCredentials?.() || {};
    return { appId: String(raw.appId || "").trim(), appSecret: String(raw.appSecret || "").trim() };
  };

  async function call(pathname, { method = "POST", body, token } = {}) {
    const res = await fetchImpl(`${BASE}${pathname}`, {
      method,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  }

  /** 拿 token：缓存到过期前 5 分钟；force 时强刷 */
  async function token({ force = false } = {}) {
    const { appId, appSecret } = creds();
    if (!appId || !appSecret) { const err = new Error("未配置飞书 app_id / app_secret"); err.code = "no-credentials"; throw err; }
    if (!force && cache && cache.expireAt - REFRESH_MARGIN_MS > now()) return cache.token;
    const { status, json } = await call("/open-apis/auth/v3/tenant_access_token/internal", { body: { app_id: appId, app_secret: appSecret } });
    const value = String(json?.tenant_access_token || "");
    if (!value) {
      const err = new Error(json?.msg || `飞书 token 获取失败（HTTP ${status}）`);
      err.code = json?.code ? `feishu-${json.code}` : "token-failed";
      throw err;
    }
    const expire = Number(json?.expire) || 7200;
    cache = { token: value, expireAt: now() + expire * 1000 };
    log.info?.(`[feishu] tenant token refreshed, expire in ${expire}s`);
    return value;
  }

  /** 发文本；401/99991663 时强刷 token 重试一次 */
  async function sendText({ receiveId, receiveIdType = "open_id", text }) {
    const body = { receive_id: String(receiveId || ""), msg_type: "text", content: JSON.stringify({ text: String(text || "") }) };
    if (!body.receive_id || !text) throw new Error("sendText 需要 receiveId 与 text");
    const attempt = async (force = false) => {
      const t = await token({ force });
      return call(`/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, { body, token: t });
    };
    let res = await attempt(false);
    if (res.status === 401 || Number(res.json?.code) === 99991663) res = await attempt(true);
    if (!res.ok || Number(res.json?.code || 0) !== 0) {
      const err = new Error(`飞书发送失败 HTTP ${res.status}：${res.json?.msg || "unknown"}`);
      err.code = res.json?.code ? `feishu-${res.json.code}` : "send-failed";
      throw err;
    }
    return { ok: true, messageId: String(res.json?.data?.message_id || "") };
  }

  /** 列出机器人所在的群（用于自检：确认 bot 到底被加进了哪个会话） */
  async function listChats() {
    const t = await token();
    const res = await fetchImpl(`${BASE}/open-apis/im/v1/chats?page_size=20`, {
      headers: { authorization: `Bearer ${t}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || Number(json?.code || 0) !== 0) throw new Error(json?.msg || `listChats HTTP ${res.status}`);
    return (json?.data?.items || []).map((c) => ({ chatId: String(c.chat_id || ""), name: String(c.name || ""), type: String(c.chat_mode || "") }));
  }

  function status() {
    const { appId, appSecret } = creds();
    return { configured: Boolean(appId && appSecret), tokenCached: Boolean(cache), appId };
  }

  return { token, sendText, listChats, status, _reset: () => { cache = null; } };
}
