/**
 * 颜色解析：SVG → DrawingML srgbClr + alpha。
 * 只返回色值，不拼 XML（拼 XML 在 translate.mjs）。
 */

const NAMED = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF",
  yellow: "FFFF00", orange: "FFA500", purple: "800080", gray: "808080", grey: "808080",
  silver: "C0C0C0", navy: "000080", teal: "008080", lime: "00FF00", aqua: "00FFFF",
  cyan: "00FFFF", fuchsia: "FF00FF", magenta: "FF00FF", maroon: "800000", olive: "808000",
  transparent: "000000",
};

/**
 * @returns {{ hex: string, alpha: number } | null} null = 无填充（none / transparent 的 fill）
 */
export function parseColor(value, opacity = 1) {
  const source = String(value ?? "").trim();
  if (!source || source === "none" || source === "currentcolor") return source === "currentcolor" ? { hex: "000000", alpha: opacity } : null;
  if (source.startsWith("#")) {
    const hex = source.slice(1);
    if (hex.length === 3) return { hex: hex.split("").map((c) => c + c).join("").toUpperCase(), alpha: opacity };
    if (hex.length === 4) return { hex: hex.slice(0, 3).split("").map((c) => c + c).join("").toUpperCase(), alpha: opacity * (parseInt(hex[3] + hex[3], 16) / 255) };
    if (hex.length === 6) return { hex: hex.toUpperCase(), alpha: opacity };
    if (hex.length === 8) return { hex: hex.slice(0, 6).toUpperCase(), alpha: opacity * (parseInt(hex.slice(6), 16) / 255) };
    return null;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(source);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map((x) => x.trim());
    const channel = (raw) => {
      if (!raw) return 0;
      if (raw.endsWith("%")) return Math.round((parseFloat(raw) / 100) * 255);
      return Math.round(parseFloat(raw));
    };
    const [r, g, b] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
    const a = parts[3] === undefined ? 1 : (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));
    const clamp = (n) => Math.max(0, Math.min(255, Number.isFinite(n) ? n : 0));
    return { hex: [r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("").toUpperCase(), alpha: opacity * (Number.isFinite(a) ? a : 1) };
  }
  const named = NAMED[source.toLowerCase()];
  if (named) return { hex: named, alpha: opacity };
  return null;
}

/** alpha 1 → 100000（DrawingML 百分比） */
export const alphaValue = (alpha) => Math.max(0, Math.min(100000, Math.round(Number(alpha) * 100000)));

/** 粗算相对亮度，用来自动挑深/浅文字色（设计稿没写颜色时兜底） */
export function luminance(hex) {
  const value = String(hex || "FFFFFF").replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
