// UI 元素 → Agent 上下文。纯函数，便于单独测试。
// 设计：docs/ARCH-ui-context.md
import path from "node:path";

const attr = (value, max = 300) => String(value ?? "").replace(/"/g, "&quot;").slice(0, max);
const oneLine = (value, max = 2000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** 把拾取到的元素渲染成 prompt 里可见的结构化块（K3：注入内容可见，不隐式注入）。 */
export function formatContext(ctx, detail = "standard") {
  if (!ctx || typeof ctx !== "object") return "";
  const compact = detail === "compact";
  const lines = [];
  const source = ctx.source?.file
    ? ` source="${attr(ctx.source.file)}${ctx.source.line ? `:${ctx.source.line}` : ""}"`
    : "";
  lines.push(`<ui-context url="${attr(ctx.url)}" selector="${attr(ctx.selector)}"${source}>`);
  if (ctx.tag) lines.push(`元素：<${ctx.tag}>${ctx.text ? ` 文本「${attr(ctx.text, 200)}」` : ""}`);
  if (!compact) {
    if (ctx.component) lines.push(`组件：${oneLine(ctx.component, 120)}`);
    if (ctx.box) {
      lines.push(`位置尺寸：x=${Math.round(ctx.box.x)} y=${Math.round(ctx.box.y)} w=${Math.round(ctx.box.width)} h=${Math.round(ctx.box.height)}`);
    }
    const styles = ctx.styles ? Object.entries(ctx.styles).filter(([, v]) => v) : [];
    if (styles.length) lines.push(`计算样式：${styles.map(([k, v]) => `${k}=${v}`).join("; ")}`);
    if (ctx.outerHTML) lines.push(`HTML：${oneLine(ctx.outerHTML)}`);
  }
  if (ctx.screenshot) lines.push(`截图（绝对路径）：${ctx.screenshot}`);
  lines.push("</ui-context>");
  return lines.join("\n");
}

/** 从 DOM 属性里解析 `data-ym-src="src/pages/Home.tsx:42"`。 */
export function parseSourceAttr(value) {
  if (!value) return null;
  const m = String(value).match(/^(.+?)(?::(\d+))?$/);
  if (!m) return null;
  return { file: m[1], line: m[2] ? Number(m[2]) : undefined };
}

/**
 * 源码位置：data-ym-src 优先；否则用 React 开发态的 _debugSource。
 * root 用来把绝对路径换成项目相对路径（不同盘/不在 root 下则保留绝对）。
 */
export function pickSource({ ymSrc, debugSource, root } = {}) {
  const fromAttr = parseSourceAttr(ymSrc);
  if (fromAttr) return fromAttr;
  if (!debugSource?.fileName) return null;
  const fileName = String(debugSource.fileName);
  let file = fileName;
  if (root && path.isAbsolute(fileName)) {
    const rel = path.relative(path.resolve(String(root)), fileName);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) file = rel;
  }
  return { file, line: debugSource.lineNumber ? Number(debugSource.lineNumber) : undefined };
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const DEV_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s"'<>`]*)?/gi;

/** 从终端输出里猜 dev server 地址（去 ANSI、取最后一个、0.0.0.0 → localhost）。 */
export function detectDevUrl(text) {
  const clean = String(text || "").replace(ANSI_RE, "");
  const matches = [...clean.matchAll(DEV_URL_RE)].map((m) => m[0].replace(/[),.;:'"`]+$/, ""));
  if (!matches.length) return null;
  return matches[matches.length - 1].replace("0.0.0.0", "localhost").replace("[::1]", "localhost");
}


/** 在预览页里执行：唯一 selector + 文本 + HTML + 计算样式 + 盒模型 + 源码线索。 */
export const COLLECT_DOM_FN = String.raw`function () {
  const el = this;
  if (!el || el.nodeType !== 1) return null;
  const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
  function cssPath(node) {
    const parts = [];
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + "#" + esc(node.id)); break; }
      const cls = Array.from(node.classList).slice(0, 2).map(esc);
      if (cls.length) part += "." + cls.join(".");
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  let component = null;
  let debugSource = null;
  try {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (key) {
      let fiber = el[key];
      while (fiber) {
        if (!component && typeof fiber.type === "function" && fiber.type.name) component = fiber.type.name;
        if (!debugSource && fiber._debugSource && fiber._debugSource.fileName) {
          debugSource = { fileName: fiber._debugSource.fileName, lineNumber: fiber._debugSource.lineNumber };
        }
        fiber = fiber.return;
      }
    }
  } catch (e) { /* ignore */ }
  const srcNode = el.closest ? el.closest("[data-ym-src]") : null;
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
    outerHTML: el.outerHTML.slice(0, 2000),
    box: { x: r.x, y: r.y, width: r.width, height: r.height },
    scroll: { x: window.scrollX || 0, y: window.scrollY || 0 },
    styles: {
      display: cs.display,
      position: cs.position,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      padding: cs.padding,
      margin: cs.margin,
      border: cs.border,
      borderRadius: cs.borderRadius,
      width: cs.width,
      height: cs.height,
    },
    component,
    debugSource,
    ymSrc: srcNode ? srcNode.getAttribute("data-ym-src") : null,
  };
}`;
