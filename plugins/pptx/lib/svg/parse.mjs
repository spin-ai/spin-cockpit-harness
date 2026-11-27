/**
 * SVG → 中间模型。
 *
 * 只做「读懂」这一步：解析 XML、解析 path d、解析 transform、解析颜色。
 * 不在这里生成 XML——翻译成 DrawingML 的部分在 translate.mjs，便于单测。
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function decodeEntities(text) {
  return String(text || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name] ?? match;
  });
}

/** 把 SVG 源码解析成简单 DOM：{ tag, attrs, children, text } */
export function parseSvg(source) {
  const text = String(source || "");
  let i = 0;
  const root = { tag: "#document", attrs: {}, children: [] };
  const stack = [root];

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      pushText(text.slice(i));
      break;
    }
    if (lt > i) pushText(text.slice(i, lt));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      pushText(text.slice(lt + 9, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<?", lt) || text.startsWith("<!", lt)) {
      const end = text.indexOf(">", lt);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith("</", lt)) {
      const end = text.indexOf(">", lt);
      const tag = stripNs(text.slice(lt + 2, end < 0 ? text.length : end).trim());
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    // 起始标签：引号里的 ">" 不算结束
    let j = lt + 1;
    let quote = "";
    while (j < text.length) {
      const ch = text[j];
      if (quote) { if (ch === quote) quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
      j += 1;
    }
    const raw = text.slice(lt + 1, j);
    const selfClosing = /\/\s*$/.test(raw);
    const body = selfClosing ? raw.replace(/\/\s*$/, "") : raw;
    const tagMatch = /^\s*([^\s/>]+)/.exec(body);
    if (!tagMatch) { i = j + 1; continue; }
    const node = { tag: stripNs(tagMatch[1]), attrs: parseAttrs(body.slice(tagMatch[0].length)), children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }

  function pushText(chunk) {
    if (!chunk) return;
    let decoded = decodeEntities(chunk);
    const parent = stack[stack.length - 1];
    if (parent === root) return;
    if (!decoded.trim()) {
      // 保留单个空格：<tspan>a</tspan> <tspan>b</tspan> 之间的空格有意义
      if (decoded.includes("\n")) decoded = "";
      else return;
    }
    parent.text += decoded;
  }

  return root.children.find((child) => child.tag === "svg") || root;
}

function stripNs(name) {
  const idx = String(name).indexOf(":");
  return idx < 0 ? String(name) : String(name).slice(idx + 1);
}

function parseAttrs(body) {
  const attrs = {};
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(body))) {
    const rawName = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    // 保留 xlink:href 的前缀信息：图片引用只认 href，但允许两种写法
    const name = rawName.includes(":") ? rawName : rawName;
    attrs[name] = decodeEntities(value);
    if (rawName.includes(":")) attrs[stripNs(rawName)] = decodeEntities(value);
  }
  return attrs;
}

export function num(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/** 长度值允许 px / pt / %（% 只在少数场景有意义，这里按画布比例兜底） */
export function len(value, { fallback = 0, percentBase = 0 } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const s = String(value).trim();
  if (s.endsWith("%")) return (num(s, 0) / 100) * percentBase;
  return num(s, fallback);
}

export function walk(node, visit, parent = null) {
  if (!node || !node.tag) return;
  if (visit(node, parent) === false) return;
  for (const child of node.children || []) walk(child, visit, node);
}

/** defs 里的 id → 节点（渐变 / use / clipPath 都靠它） */
export function collectDefs(root) {
  const byId = new Map();
  walk(root, (node) => {
    if (node.attrs?.id) byId.set(node.attrs.id, node);
  });
  return byId;
}

/** 内联 style + 表现属性：属性优先于 style（SVG 规范里 style 更高，但生成的稿子两者一致） */
export function styleOf(node) {
  const style = {};
  const declarations = String(node.attrs?.style || "");
  for (const part of declarations.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    style[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return { ...style, ...node.attrs };
}
