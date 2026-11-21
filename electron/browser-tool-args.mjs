// 浏览器工具的参数校验 / 文本裁剪（纯函数，可单测；不 import electron）。
export const MAX_TEXT = 6000;

/** 只允许 http(s)/file；其余协议（javascript: / data: / chrome:）直接拒 */
export function normalizeTargetUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  // 「localhost:5173」「example.com:8080」里的冒号是端口，不是 scheme —— 只有 `xxx://` 和几个已知 scheme 才算显式协议
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(file|about|data|javascript|mailto|blob):/i.test(value);
  const withScheme = explicit ? value : `http://${value}`;
  try {
    const u = new URL(withScheme);
    if (!["http:", "https:", "file:"].includes(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}

/** CSS selector：挡掉空串与明显不是选择器的输入（过长 / 纯自然语言） */
export function normalizeSelector(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (value.length > 400) return null;
  return value;
}

export function clipText(text, max = MAX_TEXT) {
  const value = String(text ?? "");
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

export function formatClickTarget(info) {
  if (!info) return null;
  return {
    tag: String(info.tag || "").toLowerCase(),
    text: clipText(info.text || "", 80).text,
    x: Math.round(Number(info.x) || 0),
    y: Math.round(Number(info.y) || 0),
    width: Math.round(Number(info.w) || 0),
    height: Math.round(Number(info.h) || 0),
  };
}
