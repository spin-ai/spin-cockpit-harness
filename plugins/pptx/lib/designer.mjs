/**
 * 确定性版式生成：大纲页 → SVG 视觉稿。
 *
 * 两个用途：
 *  1. 没有模型 / 模型输出不合法时的兜底（极速模式也能出完整稿）；
 *  2. 给模型一个「可参照的栅格与字号」，LLM 生成的 SVG 走同一个翻译器。
 *
 * 只用翻译器覆盖的元素：rect / circle / line / text / image / g，不用 foreignObject。
 */
import { CANVAS } from "./ooxml/units.mjs";
import { wrapText, estimateTextWidth } from "./svg/metrics.mjs";

export const THEMES = {
  paper: {
    label: "纸白",
    bg: "#F7F7F5", panel: "#FFFFFF", fg: "#14161A", muted: "#5B6472",
    line: "#E2E4E8", accent: "#2F6FED", accent2: "#12A594", onAccent: "#FFFFFF",
  },
  graphite: {
    label: "石墨",
    bg: "#14161A", panel: "#1E222A", fg: "#F5F6F8", muted: "#9AA3B2",
    line: "#2C313B", accent: "#6E9BFF", accent2: "#3ED0BE", onAccent: "#0E1116",
  },
  clay: {
    label: "陶土",
    bg: "#FBF7F2", panel: "#FFFFFF", fg: "#241E1A", muted: "#6B5D52",
    line: "#E8DED3", accent: "#C26B3F", accent2: "#2F6F6A", onAccent: "#FFFFFF",
  },
  ink: {
    label: "墨蓝",
    bg: "#0E1A24", panel: "#16242F", fg: "#EDF3F7", muted: "#93A6B4",
    line: "#253845", accent: "#4FB3D9", accent2: "#F0B36B", onAccent: "#0A1219",
  },
};

export const THEME_NAMES = Object.keys(THEMES);

export function resolveTheme(name) {
  return THEMES[String(name || "paper")] || THEMES.paper;
}

const W = CANVAS.width;
const H = CANVAS.height;
const M = 120;

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function text({ x, y, size = 28, fill = "#111111", weight = 400, anchor = "start", content = "", family = "Helvetica Neue, PingFang SC", opacity = 1, spacing = 0 }) {
  if (!String(content)) return "";
  return `<text x="${round(x)}" y="${round(y)}" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${opacity < 1 ? ` opacity="${opacity}"` : ""}${spacing ? ` letter-spacing="${spacing}"` : ""}>${esc(content)}</text>`;
}

function multiline({ x, y, size = 30, lineHeight = 1.35, fill, weight = 400, anchor = "start", lines = [], opacity = 1 }) {
  if (!lines.length) return "";
  const tspans = lines.map((line, index) => `<tspan x="${round(x)}" y="${round(y + index * size * lineHeight)}"${index === 0 ? "" : ""}>${esc(line)}</tspan>`).join("");
  return `<text font-family="Helvetica Neue, PingFang SC" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${opacity < 1 ? ` opacity="${opacity}"` : ""}>${tspans}</text>`;
}

const round = (n) => Math.round(Number(n) * 10) / 10;

function rect({ x, y, width, height, fill = "none", stroke = "none", rx = 0, opacity = 1, strokeWidth = 1 }) {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" fill="${fill}"${stroke !== "none" ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ""}${rx ? ` rx="${rx}"` : ""}${opacity < 1 ? ` opacity="${opacity}"` : ""}/>`;
}

function circle({ cx, cy, r, fill = "none", stroke = "none", opacity = 1, strokeWidth = 1 }) {
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}"${stroke !== "none" ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ""}${opacity < 1 ? ` opacity="${opacity}"` : ""}/>`;
}

function line({ x1, y1, x2, y2, stroke, width = 1, opacity = 1 }) {
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${width}"${opacity < 1 ? ` opacity="${opacity}"` : ""}/>`;
}

function decor(theme, index) {
  const parts = [];
  // 右下大圆 + 细环：每页都有，但左右交替，避免一眼看出是同一张模板
  const cx = index % 2 === 0 ? W - 120 : 120;
  const cy = index % 2 === 0 ? H - 60 : 60;
  parts.push(circle({ cx, cy, r: 300, fill: theme.accent, opacity: 0.07 }));
  parts.push(circle({ cx, cy, r: 210, stroke: theme.accent, strokeWidth: 1, opacity: 0.16 }));
  parts.push(line({ x1: W - M, y1: 96, x2: W - M, y2: 260, stroke: theme.line, width: 1 }));
  return parts.join("");
}

function footer(theme, { deckTitle, index, total }) {
  return [
    line({ x1: M, y1: H - 76, x2: W - M, y2: H - 76, stroke: theme.line, width: 1, opacity: 0.9 }),
    text({ x: M, y: H - 44, size: 18, fill: theme.muted, content: deckTitle }),
    text({ x: W - M, y: H - 44, size: 18, fill: theme.muted, anchor: "end", content: `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}` }),
  ].join("");
}

function pageHeader(theme, page, { deckTitle, index, total }) {
  const eyebrow = `${String(index + 1).padStart(2, "0")} · ${SECTION_LABEL[page.layout_hint] || "要点"}`;
  const titleLines = wrapText(page.title, 1440, 60).slice(0, 2);
  const titleHeight = titleLines.length * 60 * 1.2;
  return {
    top: [
      text({ x: M, y: 92, size: 18, fill: theme.accent, weight: 600, content: eyebrow, spacing: 2 }),
      ...titleLines.map((_, i) => ""),
      multiline({ x: M, y: 190, size: 60, lineHeight: 1.18, fill: theme.fg, weight: 700, lines: titleLines }),
      rect({ x: M, y: 190 + titleHeight + 20, width: 72, height: 6, fill: theme.accent, rx: 3 }),
    ].join(""),
    bodyTop: 190 + titleHeight + 78,
    footer: footer(theme, { deckTitle, index, total }),
    decor: decor(theme, index),
  };
}

const SECTION_LABEL = {
  cover: "封面", agenda: "目录", section: "章节", bullets: "要点", "two-column": "对照",
  quote: "观点", metrics: "指标", timeline: "路径", image: "图示", closing: "收尾",
};

function bulletRows(theme, bullets, { x, y, width, size = 32, gap = 30, marker = "dot" }) {
  const out = [];
  let cursor = y;
  bullets.forEach((bullet, index) => {
    const lines = wrapText(bullet, width - 46, size);
    out.push(marker === "number"
      ? text({ x, y: cursor + size * 0.92, size: 24, fill: theme.accent, weight: 700, content: String(index + 1).padStart(2, "0") })
      : circle({ cx: x + 6, cy: cursor + size * 0.72, r: 5, fill: theme.accent }));
    out.push(multiline({ x: x + 42, y: cursor + size * 0.92, size, lineHeight: 1.36, fill: theme.fg, lines }));
    cursor += lines.length * size * 1.36 + gap;
  });
  return { xml: out.join(""), bottom: cursor };
}

function visualPanel(theme, { x, y, width, height, instruction, index }) {
  const parts = [
    rect({ x, y, width, height, fill: theme.panel, stroke: theme.line, rx: 18 }),
    rect({ x: x + 32, y: y + 32, width: 6, height: height - 64, fill: theme.accent, rx: 3 }),
  ];
  // 抽象示意图：三条阶梯块，颜色只在第一个用 accent，避免整块发花
  const rows = Math.min(4, Math.max(3, (instruction || "").length % 4 + 2));
  for (let i = 0; i < rows; i += 1) {
    const rowY = y + 58 + i * 84;
    const w = width - 130 - i * 26;
    parts.push(rect({ x: x + 76, y: rowY, width: w, height: 58, fill: i === 0 ? theme.accent : theme.line, opacity: i === 0 ? 0.18 : 0.7, rx: 10 }));
    parts.push(line({ x1: x + 96, y1: rowY + 20, x2: x + 96 + Math.min(w - 48, 150 + i * 30), y2: rowY + 20, stroke: i === 0 ? theme.accent : theme.muted, width: 3, opacity: 0.6 }));
  }
  if (instruction) {
    parts.push(multiline({ x: x + 76, y: y + height - 96, size: 21, lineHeight: 1.4, fill: theme.muted, lines: wrapText(instruction, width - 130, 21).slice(0, 2) }));
  }
  parts.push(text({ x: x + width - 36, y: y + 40, size: 16, fill: theme.muted, anchor: "end", content: String(index + 1).padStart(2, "0") }));
  return parts.join("");
}

function cover(theme, page, { deckTitle, index, total }) {
  const titleLines = wrapText(page.title, 1280, 96).slice(0, 2);
  const subtitle = page.subtitle || page.visual_instruction || "";
  return [
    rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }),
    circle({ cx: W - 40, cy: 170, r: 380, fill: theme.accent, opacity: 0.1 }),
    circle({ cx: W - 40, cy: 170, r: 260, stroke: theme.accent, strokeWidth: 1, opacity: 0.24 }),
    rect({ x: 0, y: 0, width: 14, height: H, fill: theme.accent }),
    text({ x: M, y: 170, size: 20, fill: theme.accent, weight: 600, content: (page.kicker || "PRESENTATION"), spacing: 4 }),
    multiline({ x: M, y: 430, size: 96, lineHeight: 1.1, fill: theme.fg, weight: 700, lines: titleLines }),
    rect({ x: M, y: 430 + titleLines.length * 96 * 1.1 + 36, width: 96, height: 8, fill: theme.accent, rx: 4 }),
    ...(subtitle ? wrapText(subtitle, 900, 28).slice(0, 2).map((line, i) => text({ x: M, y: 430 + titleLines.length * 96 * 1.1 + 118 + i * 44, size: 28, fill: theme.muted, content: line })) : []),
    text({ x: M, y: H - 96, size: 20, fill: theme.muted, content: deckTitle }),
    text({ x: W - M, y: H - 96, size: 20, fill: theme.muted, anchor: "end", content: new Date().toISOString().slice(0, 10) }),
    ...(total > 1 ? [] : []),
  ].join("");
}

function agenda(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const bullets = page.bullets.length ? page.bullets : ["背景与机会", "问题与判断", "方案与架构", "落地路径"];
  const columns = bullets.length > 4 ? 2 : 1;
  const perColumn = Math.ceil(bullets.length / columns);
  const out = [];
  bullets.forEach((bullet, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = M + column * 840;
    const y = header.bodyTop + row * 124;
    out.push(text({ x, y, size: 52, fill: theme.accent, weight: 700, content: String(index + 1).padStart(2, "0"), opacity: 0.5 }));
    out.push(multiline({ x: x + 90, y, size: 34, lineHeight: 1.3, fill: theme.fg, lines: wrapText(bullet, 640, 34).slice(0, 2) }));
    out.push(line({ x1: x, y1: y + 40, x2: x + 740, y2: y + 40, stroke: theme.line, width: 1 }));
  });
  return [rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }), header.decor, header.top, ...out, header.footer].join("");
}

function section(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const titleLines = wrapText(page.title, 1200, 84).slice(0, 2);
  return [
    rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }),
    header.decor,
    text({ x: M, y: 560, size: 240, fill: theme.accent, weight: 700, content: String(ctx.index + 1).padStart(2, "0"), opacity: 0.14 }),
    multiline({ x: M, y: 640, size: 84, lineHeight: 1.16, fill: theme.fg, weight: 700, lines: titleLines }),
    line({ x1: M, y1: 760, x2: M + 240, y2: 760, stroke: theme.accent, width: 6 }),
    header.footer,
  ].join("");
}

function bullets(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const hasVisual = Boolean(page.visual_instruction) && page.layout_hint !== "closing";
  const textWidth = hasVisual ? 1100 : 1600;
  const rows = bulletRows(theme, page.bullets, { x: M, y: header.bodyTop + 10, width: textWidth, size: 32, gap: 34 });
  const visual = hasVisual ? visualPanel(theme, { x: 1320, y: header.bodyTop, width: 480, height: Math.min(520, H - header.bodyTop - 140), instruction: page.visual_instruction, index: ctx.index }) : "";
  return [rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }), header.decor, header.top, rows.xml, visual, header.footer].join("");
}

function twoColumn(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const bullets = page.bullets.length ? page.bullets : ["现状", "方案"];
  const half = Math.ceil(bullets.length / 2);
  const left = bullets.slice(0, half);
  const right = bullets.slice(half);
  const top = header.bodyTop;
  const height = Math.min(560, H - top - 150);
  const card = (x, label, items) => [
    rect({ x, y: top, width: 800, height, fill: theme.panel, stroke: theme.line, rx: 18 }),
    text({ x: x + 40, y: top + 66, size: 22, fill: theme.accent, weight: 600, content: label, spacing: 2 }),
    bulletRows(theme, items, { x: x + 40, y: top + 116, width: 720, size: 29, gap: 26 }).xml,
  ].join("");
  return [
    rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }),
    header.decor,
    header.top,
    card(M, "现状 / 要点", left),
    card(W - M - 800, "方案 / 对照", right.length ? right : left.slice(0, 2)),
    header.footer,
  ].join("");
}

function quote(theme, page, ctx) {
  const lines = wrapText(page.title, 1280, 64);
  const attribution = page.bullets[0] || page.visual_instruction || "";
  return [
    rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }),
    decor(theme, ctx.index),
    rect({ x: M, y: 300, width: 8, height: Math.min(420, lines.length * 64 * 1.3), fill: theme.accent, rx: 4 }),
    multiline({ x: M + 64, y: 400, size: 64, lineHeight: 1.28, fill: theme.fg, weight: 600, lines }),
    ...(attribution ? wrapText(attribution, 900, 26).slice(0, 2).map((line, i) => text({ x: M + 64, y: 400 + lines.length * 64 * 1.28 + 60 + i * 40, size: 26, fill: theme.muted, content: line })) : []),
    footer(theme, { deckTitle: ctx.deckTitle, index: ctx.index, total: ctx.total }),
  ].join("");
}

function metrics(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const bullets = page.bullets.length ? page.bullets : ["12 页", "2 分钟", "100% 原生"];
  const items = bullets.slice(0, 4).map((bullet) => {
    const match = /^([^\s：:]{1,10}?)\s*(?:[：:]\s*)?(.+)$/.exec(bullet);
    const head = match ? match[1] : bullet;
    const tail = match ? match[2] : "";
    const numeric = /(\d+(?:\.\d+)?)\s*([^\d\s]{0,4})/.exec(head);
    return numeric ? { value: `${numeric[1]}${numeric[2] || ""}`, label: `${head.replace(numeric[0], "").trim()} ${tail}`.trim() || head } : { value: head.slice(0, 8), label: tail || bullet };
  });
  const count = items.length;
  const gap = 24;
  const cardWidth = (W - 2 * M - gap * (count - 1)) / count;
  const top = header.bodyTop + 10;
  const height = Math.min(420, H - top - 160);
  const cards = items.map((item, index) => {
    const x = M + index * (cardWidth + gap);
    return [
      rect({ x, y: top, width: cardWidth, height, fill: theme.panel, stroke: theme.line, rx: 18 }),
      rect({ x: x + 32, y: top + 32, width: 44, height: 5, fill: index === 0 ? theme.accent : theme.accent2, rx: 2.5 }),
      text({ x: x + 32, y: top + 150, size: 68, fill: theme.fg, weight: 700, content: item.value }),
      multiline({ x: x + 32, y: top + 210, size: 24, lineHeight: 1.4, fill: theme.muted, lines: wrapText(item.label, cardWidth - 64, 24).slice(0, 4) }),
    ].join("");
  });
  return [rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }), header.decor, header.top, ...cards, header.footer].join("");
}

function timeline(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const bullets = page.bullets.length ? page.bullets : ["阶段一", "阶段二", "阶段三"];
  const step = (W - 2 * M - 80) / Math.max(1, bullets.length - 1);
  const y = 620;
  const solid = line({ x1: M, y1: y, x2: W - M, y2: y, stroke: theme.line, width: 2 });
  const nodes = bullets.map((bullet, index) => {
    const x = M + 40 + index * step;
    return [
      circle({ cx: x, cy: y, r: 14, fill: theme.bg, stroke: theme.accent, strokeWidth: 3 }),
      circle({ cx: x, cy: y, r: 5, fill: theme.accent }),
      text({ x, y: y - 44, size: 20, fill: theme.accent, weight: 700, anchor: "middle", content: String(index + 1).padStart(2, "0") }),
      multiline({ x, y: y + 78, size: 26, lineHeight: 1.36, fill: theme.fg, anchor: "middle", lines: wrapText(bullet, Math.min(300, step - 20), 26).slice(0, 3) }),
    ].join("");
  });
  return [rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }), header.decor, header.top, solid, ...nodes, header.footer].join("");
}

function image(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const top = header.bodyTop;
  const height = Math.min(520, H - top - 140);
  const frameWidth = 1080;
  const href = page.image_href || page.image || "";
  const frame = href
    ? `<image href="${esc(href)}" x="${M}" y="${top}" width="${frameWidth}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    : [
        rect({ x: M, y: top, width: frameWidth, height, fill: theme.panel, stroke: theme.line, rx: 18 }),
        circle({ cx: M + 88, cy: top + 88, r: 30, stroke: theme.accent, strokeWidth: 2 }),
        line({ x1: M + 40, y1: top + height - 120, x2: M + frameWidth - 60, y2: top + height - 230, stroke: theme.line, width: 3 }),
        line({ x1: M + 40, y1: top + height - 60, x2: M + frameWidth - 60, y2: top + height - 170, stroke: theme.accent, width: 3, opacity: 0.4 }),
        text({ x: M + 40, y: top + 40, size: 18, fill: theme.muted, content: "IMAGE / DIAGRAM" }),
      ].join("");
  const caption = [
    text({ x: M + frameWidth + 60, y: top + 50, size: 24, fill: theme.accent, weight: 600, content: "视觉意图" }),
    multiline({ x: M + frameWidth + 60, y: top + 110, size: 27, lineHeight: 1.5, fill: theme.fg, lines: wrapText(page.visual_instruction || page.title, W - M - (M + frameWidth + 60), 27).slice(0, 6) }),
  ].join("");
  return [rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }), header.decor, header.top, frame, caption, header.footer].join("");
}

function closing(theme, page, ctx) {
  const header = pageHeader(theme, page, ctx);
  const rows = bulletRows(theme, page.bullets, { x: M, y: header.bodyTop + 20, width: 1200, size: 30, gap: 28, marker: "number" });
  return [
    rect({ x: 0, y: 0, width: W, height: H, fill: theme.bg }),
    circle({ cx: W - 260, cy: H - 260, r: 340, fill: theme.accent, opacity: 0.08 }),
    header.top,
    rows.xml,
    rect({ x: 0, y: H - 12, width: W, height: 12, fill: theme.accent }),
    header.footer,
  ].join("");
}

const LAYOUTS = { cover, agenda, section, bullets, "two-column": twoColumn, quote, metrics, timeline, image, closing };

/**
 * @param {object} page 大纲页（含 subtitle / image_href 时会被用到）
 * @param {{theme: string|object, index: number, total: number, deckTitle: string}} options
 */
export function renderPageSvg(page, { theme: themeOption = "paper", index = 0, total = 1, deckTitle = "" } = {}) {
  const theme = typeof themeOption === "string" ? resolveTheme(themeOption) : themeOption;
  const layout = LAYOUTS[page.layout_hint] || bullets;
  const body = layout(theme, page, { index, total, deckTitle: deckTitle || page.title });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

export { estimateTextWidth };
