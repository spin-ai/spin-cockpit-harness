/**
 * 快速质量门禁：锁无关、纯函数，只看「这一页的 SVG + 翻译结果」。
 *
 * 极速模式：error 降级为 warning，不阻断交付；
 * 精细模式：error 触发单页重试（重试仍失败则用确定性版式兜底，并记录在报告里）。
 */
import { CANVAS } from "./ooxml/units.mjs";

const MAX_IMAGE_RATIO = 0.9; // 一张图覆盖 90% 画布 = 整页截图路线，直接判不达标

export function gatePage({ outline, svgText, translated, pageIndex = 0 }) {
  const issues = [];
  const add = (level, code, message, detail = {}) => issues.push({ level, code, message, ...detail });

  if (!translated || !translated.shapes?.length) {
    add("error", "EMPTY_PAGE", "这一页没有任何可编辑对象");
    return { issues, ok: false };
  }

  const boxes = translated.boxes || [];
  const tolerance = 2;
  const outside = boxes.filter((box) => box.x < -tolerance || box.y < -tolerance || box.x + box.width > CANVAS.width + tolerance || box.y + box.height > CANVAS.height + tolerance);
  if (outside.length) {
    const worst = outside[0];
    add("error", "GEOMETRY_BOUNDS", `${outside.length} 个对象超出画布（首个：x=${Math.round(worst.x)}, y=${Math.round(worst.y)}, w=${Math.round(worst.width)}, h=${Math.round(worst.height)}）`, { count: outside.length });
  }
  const safeMargin = 48;
  const outsideSafe = boxes.filter((box) => box.x < safeMargin || box.y < safeMargin || box.x + box.width > CANVAS.width - safeMargin || box.y + box.height > CANVAS.height - safeMargin);
  if (outsideSafe.length && !outside.length) {
    add("warn", "SAFE_AREA", `${outsideSafe.length} 个对象超出安全区（48px）`);
  }

  const fullPageImage = boxes.find((box) => box.kind === "image" && (box.width * box.height) / (CANVAS.width * CANVAS.height) >= MAX_IMAGE_RATIO);
  if (fullPageImage) {
    add("error", "FULL_PAGE_IMAGE", "检测到整页位图：必须把元素翻译成原生对象，不能贴一整张图");
  }

  const textBoxes = boxes.filter((box) => box.kind === "text");
  if (!textBoxes.length) {
    add("error", "NO_TEXT", "这一页没有可编辑文字");
  } else if (textBoxes.length < 3 && pageIndex > 0) {
    add("warn", "TEXT_THIN", `只有 ${textBoxes.length} 个文本块，内容可能过少`);
  }

  if (/<foreignObject/i.test(String(svgText || ""))) {
    add("error", "FOREIGN_OBJECT", "禁止使用 <foreignObject>：翻译器无法把它变成原生对象");
  }
  if (!/<text[\s>]/i.test(String(svgText || ""))) {
    add("error", "TEXT_AS_PATH", "SVG 里没有 <text>：文字不能转成路径");
  }
  const viewBox = /viewBox="([^"]+)"/.exec(String(svgText || ""));
  if (!viewBox) {
    add("warn", "NO_VIEWBOX", "缺少 viewBox，按 1920×1080 兜底");
  } else {
    const [minX, minY, width, height] = viewBox[1].split(/[\s,]+/).map(Number);
    if (Math.abs(minX) > 0.5 || Math.abs(minY) > 0.5 || Math.abs(width - CANVAS.width) > 1 || Math.abs(height - CANVAS.height) > 1) {
      add("warn", "CANVAS_SIZE", `viewBox 不是 1920×1080（当前 ${width}×${height}），已按比例缩放`);
    }
  }

  const emptyPage = !outline?.bullets?.length && !outline?.image_href && !outline?.visual_instruction && translated.stats.texts <= 1;
  if (emptyPage) {
    add("error", "EMPTY_CONTENT", "只有标题、没有实质内容");
  }
  if (translated.warnings?.length) {
    for (const warning of translated.warnings) add("warn", "SVG_TRANSLATOR", warning);
  }

  const errors = issues.filter((issue) => issue.level === "error");
  return { issues, ok: errors.length === 0, errors: errors.length, warnings: issues.length - errors.length };
}

/** 极速模式：error 只记录，不阻断 */
export function applyMode(issues, mode) {
  if (mode !== "quick") return issues;
  return issues.map((issue) => (issue.level === "error" ? { ...issue, level: "warn", downgraded: true } : issue));
}
