/**
 * SVG → DrawingML（核心资产）。
 *
 * 约束：
 *  - 每个元素变成 PowerPoint 原生对象（p:sp / p:pic / p:grpSp），文本一律进 <a:t>；
 *  - 不做整页位图，也不把文字转曲线；
 *  - 坐标全部先折算到画布绝对 px，再按 1px = 6350EMU 落 xfrm。
 *
 * 覆盖：rect / circle / ellipse / line / polyline / polygon / path / text / image / g（含 use）。
 * 不支持：foreignObject、filter、mask、pattern（记 warning，跳过）。
 */
import { CANVAS, px, fontPt, lineEmu, rotUnits } from "../ooxml/units.mjs";
import { parseSvg, walk, collectDefs, styleOf, num, len } from "./parse.mjs";
import { parsePath, transformSubpaths, subpathsBounds } from "./path.mjs";
import { IDENTITY, multiply, parseTransform, applyMatrix, decompose } from "./transform.mjs";
import { parseColor, alphaValue } from "./color.mjs";
import { estimateTextWidth } from "./metrics.mjs";

const INHERITED = ["fill", "stroke", "stroke-width", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "opacity", "fill-opacity", "stroke-opacity"];

const xmlEscape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const alpha = (a) => (a >= 0.999 ? "" : `<a:alpha val="${alphaValue(a)}"/>`);

function solidFill(color, extraAlpha = 1) {
  if (!color) return "<a:noFill/>";
  const a = Math.max(0, Math.min(1, color.alpha * extraAlpha));
  return `<a:solidFill><a:srgbClr val="${color.hex}">${alpha(a)}</a:srgbClr></a:solidFill>`;
}

function gradientFill(node, defs, extraAlpha = 1) {
  const stops = (node.children || []).filter((child) => child.tag === "stop").map((stop) => {
    const attrs = styleOf(stop);
    const color = parseColor(attrs["stop-color"] || attrs.color || "#000000") || { hex: "000000", alpha: 1 };
    const stopAlpha = attrs["stop-opacity"] === undefined ? 1 : num(attrs["stop-opacity"], 1);
    return { pos: Math.round(Math.max(0, Math.min(1, num(attrs.offset, 0))) * 100000), color, a: stopAlpha };
  });
  if (!stops.length) return null;
  const gs = stops.map((stop) => `<a:gs pos="${stop.pos}"><a:srgbClr val="${stop.color.hex}">${alpha(stop.color.alpha * stop.a * extraAlpha)}</a:srgbClr></a:gs>`).join("");
  if (node.tag === "radialGradient") {
    return `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`;
  }
  const x1 = num(node.attrs?.x1, 0);
  const y1 = num(node.attrs?.y1, 0);
  const x2 = num(node.attrs?.x2, 1);
  const y2 = num(node.attrs?.y2, 0);
  // SVG 的 y 向下，DrawingML 的角度以 3 点钟为 0、顺时针为正，两者刚好一致
  const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) * 60000);
  return `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst><a:lin ang="${angle}" scaled="1"/></a:gradFill>`;
}

function fillXml(attrs, defs, extraAlpha = 1) {
  const fill = attrs.fill;
  if (!fill || fill === "none") return "<a:noFill/>";
  const url = /^url\(\s*#([^)\s]+)\s*\)$/.exec(String(fill));
  if (url) {
    const target = defs.get(url[1]);
    if (target && (target.tag === "linearGradient" || target.tag === "radialGradient")) {
      const gradient = gradientFill(target, defs, extraAlpha);
      if (gradient) return gradient;
    }
    return "<a:noFill/>";
  }
  return solidFill(parseColor(fill), extraAlpha);
}

function strokeXml(attrs, defs, extraAlpha = 1) {
  const stroke = attrs.stroke;
  if (!stroke || stroke === "none") return "<a:ln><a:noFill/></a:ln>";
  const color = parseColor(stroke);
  if (!color) return "<a:ln><a:noFill/></a:ln>";
  const width = lineEmu(Math.max(0, num(attrs["stroke-width"], 1)));
  const cap = ({ round: "rnd", square: "sq", butt: "flat" })[attrs["stroke-linecap"]] || "flat";
  const join = ({ round: "<a:round/>", bevel: "<a:bevel/>", miter: "<a:miter lim=\"800000\"/>" })[attrs["stroke-linejoin"]] || "<a:miter lim=\"800000\"/>";
  const dash = String(attrs["stroke-dasharray"] || "");
  let dashXml = "";
  if (dash && dash !== "none") {
    const values = dash.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const unit = Math.max(1, values[0] || 4);
    const style = unit <= 2 ? "sysDot" : unit <= 5 ? "dash" : "lgDash";
    dashXml = `<a:prstDash val="${style}"/>`;
  }
  return `<a:ln w="${width}" cap="${cap}">${solidFill(color, extraAlpha)}${dashXml}${join}</a:ln>`;
}

export { estimateTextWidth };

/** 文本行只保留一个换行：多行由 tspan / 多个 <text> 表达 */
function splitLines(node) {
  const lines = [];
  let current = { text: String(node.text || ""), attrs: node.attrs || {}, runs: [] };
  const tspans = (node.children || []).filter((child) => child.tag === "tspan" && child.tag !== "defs");
  if (!tspans.length) {
    if (current.text.trim()) { current.text = current.text; lines.push(current); }
    return lines.length ? lines : [{ text: String(node.text || ""), attrs: node.attrs || {}, runs: [] }];
  }
  const direct = String(node.text || "").trim();
  if (direct) lines.push({ text: direct, attrs: node.attrs || {}, runs: [] });
  for (const tspan of tspans) {
    const attrs = { ...node.attrs, ...styleOf(tspan) };
    const text = String(tspan.text || "");
    const isOwnLine = attrs.x !== undefined || attrs.y !== undefined || attrs.dy !== undefined;
    if (isOwnLine) lines.push({ text, attrs, runs: [] });
    else if (lines.length) {
      // 行内 tspan：同一段落里的不同 run
      const previous = lines[lines.length - 1];
      previous.runs = previous.runs || [];
      previous.runs.push({ text, attrs });
      previous.text += text;
    } else {
      lines.push({ text, attrs, runs: [] });
    }
  }
  return lines;
}

function textShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  if (style.display === "none" || style.visibility === "hidden") return null;
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const decomp = decompose(matrix);
  const lines = splitLines(node);
  if (!lines.length) return null;
  const baseSize = Math.max(1, num(style["font-size"], 24) * Math.abs(decomp.sy || 1));
  const anchor = String(style["text-anchor"] || "start");
  const x = num(style.x, 0);
  const y = num(style.y, 0);
  const opacity = num(style.opacity, 1);

  // 每行：先算本行宽度与基线，再折算成文本框
  let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
  const paragraphs = [];
  lines.forEach((line, index) => {
    const attrs = line.attrs || {};
    const size = Math.max(1, num(attrs["font-size"], num(style["font-size"], 24)) * Math.abs(decomp.sy || 1));
    const lineX = attrs.x !== undefined ? num(attrs.x, x) : x;
    const lineY = attrs.y !== undefined ? num(attrs.y, y) : y + index * size * 1.35;
    const width = Math.max(1, estimateTextWidth(line.text, size));
    const lineAnchor = String(attrs["text-anchor"] || anchor);
    const startX = lineAnchor === "middle" ? lineX - width / 2 : lineAnchor === "end" ? lineX - width : lineX;
    left = Math.min(left, startX); right = Math.max(right, startX + width);
    top = Math.min(top, lineY - size * 0.85); bottom = Math.max(bottom, lineY + size * 0.35);

    const align = lineAnchor === "middle" ? "ctr" : lineAnchor === "end" ? "r" : "l";
    const runs = (line.runs && line.runs.length ? line.runs : [{ text: line.text, attrs }]);
    const xmlRuns = runs.map((run) => {
      const runStyle = { ...style, ...run.attrs };
      const runSize = Math.max(1, num(runStyle["font-size"], size / Math.max(0.01, Math.abs(decomp.sy || 1))) * Math.abs(decomp.sy || 1));
      const color = parseColor(runStyle.fill) || parseColor(style.fill) || { hex: "111111", alpha: 1 };
      const bold = /bold|[6-9]00/.test(String(runStyle["font-weight"] || ""));
      const italic = String(runStyle["font-style"] || "") === "italic";
      const underline = /underline/.test(String(runStyle["text-decoration"] || ""));
      const families = String(runStyle["font-family"] || "Helvetica Neue, PingFang SC").split(",").map((name) => name.replace(/["']/g, "").trim()).filter(Boolean);
      const latinFont = families[0] || "Helvetica Neue";
      // 西文与中日韩分开指定：只写一个 latin 字体，PowerPoint / LibreOffice 会拿它排中文，
      // 字体里没有 CJK 字形就整段消失（踩过：中文全部不显示）。
      const eaFont = families.find((name) => /PingFang|Hei|Song|Kai|YaHei|Noto Sans (SC|TC|JP|KR)|Source Han|WenQuanYi|SimSun|SimHei|Hiragino|Ming/i.test(name)) || "PingFang SC";
      const spacing = runStyle["letter-spacing"] ? ` spc="${Math.round(num(runStyle["letter-spacing"], 0) * 75)}"` : "";
      return `<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${fontPt(runSize)}"${bold ? ' b="1"' : ""}${italic ? ' i="1"' : ""}${underline ? ' u="sng"' : ""} dirty="0"${spacing}>${solidFill(color, opacity)}<a:latin typeface="${xmlEscape(latinFont)}"/><a:ea typeface="${xmlEscape(eaFont)}"/></a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`;
    }).join("");
    const spacingAfter = index === lines.length - 1 ? 0 : Math.round((size * 1.35) * 75);
    paragraphs.push(`<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPts val="${Math.round(size * 1.25 * 75)}"/></a:lnSpc>${spacingAfter ? `<a:spcAft><a:spcPts val="${spacingAfter}"/></a:spcAft>` : ""}</a:pPr>${xmlRuns}</a:p>`);
  });

  // 旋转文本：DrawingML 绕形状中心转，所以按中心反算 off
  const localCenter = [(left + right) / 2, (top + bottom) / 2];
  const canvasCenter = applyMatrix(matrix, localCenter);
  const width = Math.max(8, (right - left) * Math.abs(decomp.sx || 1));
  const height = Math.max(8, (bottom - top) * Math.abs(decomp.sy || 1));
  const offsetX = canvasCenter[0] - width / 2;
  const offsetY = canvasCenter[1] - height / 2;
  const bbox = { x: offsetX, y: offsetY, width, height };
  ctx.stats.texts += 1;
  ctx.boxes.push({ ...bbox, kind: "text" });

  const id = ctx.nextId();
  const shapePr = `<p:spPr><a:xfrm${Math.abs(decomp.rotation) > 0.01 ? ` rot="${rotUnits(decomp.rotation)}"` : ""}><a:off x="${px(offsetX)}" y="${px(offsetY)}"/><a:ext cx="${px(width)}" cy="${px(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>`;
  const body = `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.join("")}</p:txBody>`;
  return { xml: `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>${shapePr}${body}</p:sp>`, bbox };
}

function pictureShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const decomp = decompose(matrix);
  const href = String(style.href || style["xlink:href"] || "");
  const asset = href ? ctx.resolveImage(href) : null;
  if (!asset) {
    ctx.warn(`图片无法解析，已跳过：${href || "(空 href)"}`);
    return null;
  }
  const localX = num(style.x, 0);
  const localY = num(style.y, 0);
  const localW = Math.max(1, num(style.width, 0) || asset.width || 100);
  const localH = Math.max(1, num(style.height, 0) || asset.height || 100);
  const corners = [[localX, localY], [localX + localW, localY], [localX + localW, localY + localH], [localX, localY + localH]].map((p) => applyMatrix(matrix, p));
  const minX = Math.min(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const maxY = Math.max(...corners.map((p) => p[1]));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const relId = ctx.addMedia(asset);
  const id = ctx.nextId();
  ctx.stats.images += 1;
  ctx.boxes.push({ x: minX, y: minY, width, height, kind: "image" });
  const xml = `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}" descr="${xmlEscape(style.alt || style["aria-label"] || "")}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm${Math.abs(decomp.rotation) > 0.01 ? ` rot="${rotUnits(decomp.rotation)}"` : ""}><a:off x="${px(minX)}" y="${px(minY)}"/><a:ext cx="${px(width)}" cy="${px(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  return { xml, bbox: { x: minX, y: minY, width, height } };
}

function customGeometryShape(subpaths, ctx, style, inherited, { closed = true } = {}) {
  const bounds = subpathsBounds(subpaths);
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const pathParts = subpaths.map((subpath) => {
    const local = (point) => [point[0] - bounds.x, point[1] - bounds.y];
    let xml = `<a:moveTo><a:pt x="${Math.round(local(subpath.start)[0])}" y="${Math.round(local(subpath.start)[1])}"/></a:moveTo>`;
    for (const segment of subpath.segments) {
      if (segment.cmd === "L") {
        const p = local(segment.points[0]);
        xml += `<a:lnTo><a:pt x="${Math.round(p[0])}" y="${Math.round(p[1])}"/></a:lnTo>`;
      } else if (segment.cmd === "Q") {
        const [c, end] = segment.points.map(local);
        xml += `<a:quadBezTo><a:pt x="${Math.round(c[0])}" y="${Math.round(c[1])}"/><a:pt x="${Math.round(end[0])}" y="${Math.round(end[1])}"/></a:quadBezTo>`;
      } else {
        const points = segment.points.map(local);
        xml += `<a:cubicBezTo>${points.map((p) => `<a:pt x="${Math.round(p[0])}" y="${Math.round(p[1])}"/>`).join("")}</a:cubicBezTo>`;
      }
    }
    if (subpath.closed && closed) xml += "<a:close/>";
    return xml;
  }).join("");

  const fill = closed ? fillXml({ ...style, fill: style.fill ?? "none" }, ctx.defs, num(style.opacity, 1)) : "<a:noFill/>";
  const id = ctx.nextId();
  ctx.stats.shapes += 1;
  ctx.boxes.push({ ...bounds, kind: "path" });
  const xml = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Path ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px(bounds.x)}" y="${px(bounds.y)}"/><a:ext cx="${px(width)}" cy="${px(height)}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${Math.max(1, Math.round(width))}" h="${Math.max(1, Math.round(height))}">${pathParts}</a:path></a:pathLst></a:custGeom>${fill}${strokeXml(style, ctx.defs, num(style.opacity, 1))}</p:spPr></p:sp>`;
  return { xml, bbox: bounds };
}

function presetShape(prst, box, ctx, style, inherited, { extraGeometry = "", text = null } = {}) {
  const opacity = num(style.opacity, 1);
  const id = ctx.nextId();
  ctx.stats.shapes += 1;
  ctx.boxes.push({ ...box, kind: "preset" });
  const fill = fillXml(style, ctx.defs, opacity);
  const stroke = strokeXml(style, ctx.defs, opacity);
  const xml = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${prst} ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px(box.x)}" y="${px(box.y)}"/><a:ext cx="${px(box.width)}" cy="${px(box.height)}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst>${extraGeometry}</a:avLst></a:prstGeom>${fill}${stroke}</p:spPr></p:sp>`;
  return { xml, bbox: box };
}

function rectShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const decomp = decompose(matrix);
  const x = num(style.x, 0);
  const y = num(style.y, 0);
  const width = len(style.width, { fallback: 0, percentBase: CANVAS.width });
  const height = len(style.height, { fallback: 0, percentBase: CANVAS.height });
  if (width <= 0 || height <= 0) return null;
  const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map((p) => applyMatrix(matrix, p));
  const minX = Math.min(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const maxY = Math.max(...corners.map((p) => p[1]));
  const box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  if (!decomp.axisAligned && Math.abs(decomp.rotation) > 0.01) {
    // 旋转矩形：把角点烘进 custGeom，保证选中后还是可改色的原生形状
    const subpaths = [{ start: applyMatrix(matrix, [x, y]), closed: true, segments: [
      { cmd: "L", points: [applyMatrix(matrix, [x + width, y])] },
      { cmd: "L", points: [applyMatrix(matrix, [x + width, y + height])] },
      { cmd: "L", points: [applyMatrix(matrix, [x, y + height])] },
    ] }];
    return customGeometryShape(subpaths, ctx, style, inherited);
  }
  const rx = num(style.rx, num(style["border-radius"], 0)) * Math.abs(decomp.sx || 1);
  const ry = num(style.ry, num(style.rx, num(style["border-radius"], 0))) * Math.abs(decomp.sy || 1);
  if (rx > 0 || ry > 0) {
    const short = Math.min(box.width, box.height);
    const radius = Math.min(short / 2, Math.max(rx, ry));
    const guide = Math.round((radius / short) * 100000);
    return presetShape("roundRect", box, ctx, style, inherited, { extraGeometry: `<a:gd name="adj" fmla="val ${guide}"/>` });
  }
  return presetShape("rect", box, ctx, style, inherited);
}

function ellipseShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const decomp = decompose(matrix);
  const cx = num(style.cx, 0);
  const cy = num(style.cy, 0);
  const isCircle = node.tag === "circle";
  const rx = isCircle ? num(style.r, 0) : num(style.rx, 0);
  const ry = isCircle ? num(style.r, 0) : num(style.ry, 0);
  if (rx <= 0 || ry <= 0) return null;
  const center = applyMatrix(matrix, [cx, cy]);
  const width = rx * 2 * Math.abs(decomp.sx || 1);
  const height = ry * 2 * Math.abs(decomp.sy || 1);
  const box = { x: center[0] - width / 2, y: center[1] - height / 2, width, height };
  if (!decomp.axisAligned && Math.abs(decomp.rotation) > 0.01) {
    // 旋转椭圆：用 4 段贝塞尔曲线落到 custGeom
    const k = 0.5522847498;
    const point = (dx, dy) => applyMatrix(matrix, [cx + dx, cy + dy]);
    const subpaths = [{
      start: point(rx, 0), closed: true, segments: [
        { cmd: "C", points: [point(rx, ry * k), point(rx * k, ry), point(0, ry)] },
        { cmd: "C", points: [point(-rx * k, ry), point(-rx, ry * k), point(-rx, 0)] },
        { cmd: "C", points: [point(-rx, -ry * k), point(-rx * k, -ry), point(0, -ry)] },
        { cmd: "C", points: [point(rx * k, -ry), point(rx, -ry * k), point(rx, 0)] },
      ],
    }];
    return customGeometryShape(subpaths, ctx, style, inherited);
  }
  return presetShape("ellipse", box, ctx, style, inherited);
}

function pointsShape(node, ctx, inherited, closed) {
  const style = { ...inherited, ...styleOf(node) };
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const points = String(style.points || "").trim().split(/\s+/).map((pair) => pair.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (points.length < 2) return null;
  const transformed = points.map((p) => applyMatrix(matrix, p));
  const subpaths = [{ start: transformed[0], closed, segments: transformed.slice(1).map((point) => ({ cmd: "L", points: [point] })) }];
  return customGeometryShape(subpaths, ctx, { ...style, fill: closed ? style.fill : "none" }, inherited, { closed });
}

function pathShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const { subpaths, error } = parsePath(style.d);
  if (error) ctx.warn(error);
  if (!subpaths.length) return null;
  const transformed = transformSubpaths(subpaths, matrix);
  ctx.stats.paths += 1;
  const hasFill = style.fill && style.fill !== "none";
  return customGeometryShape(transformed, ctx, { ...style, fill: hasFill ? style.fill : "none" }, inherited);
}

function lineShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const x1 = num(style.x1, 0); const y1 = num(style.y1, 0);
  const x2 = num(style.x2, 0); const y2 = num(style.y2, 0);
  const a = applyMatrix(matrix, [x1, y1]);
  const b = applyMatrix(matrix, [x2, y2]);
  if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) return null;
  const subpaths = [{ start: a, closed: false, segments: [{ cmd: "L", points: [b] }] }];
  return customGeometryShape(subpaths, ctx, { ...style, fill: "none" }, inherited, { closed: false });
}

function groupShape(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  if (style.display === "none" || style.visibility === "hidden") return null;
  const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
  const children = translateChildren(node, { ...ctx, matrix }, { ...inherited, ...style });
  if (!children.length) return null;
  const minX = Math.min(...children.map((c) => c.bbox.x));
  const minY = Math.min(...children.map((c) => c.bbox.y));
  const maxX = Math.max(...children.map((c) => c.bbox.x + c.bbox.width));
  const maxY = Math.max(...children.map((c) => c.bbox.y + c.bbox.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const id = ctx.nextId();
  ctx.stats.groups += 1;
  ctx.boxes.push({ x: minX, y: minY, width, height, kind: "group" });
  const xml = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${px(minX)}" y="${px(minY)}"/><a:ext cx="${px(width)}" cy="${px(height)}"/><a:chOff x="${px(minX)}" y="${px(minY)}"/><a:chExt cx="${px(width)}" cy="${px(height)}"/></a:xfrm></p:grpSpPr>${children.map((c) => c.xml).join("")}</p:grpSp>`;
  return { xml, bbox: { x: minX, y: minY, width, height } };
}

const SKIP = new Set(["defs", "style", "title", "desc", "metadata", "clippath", "mask", "pattern", "marker", "lineargradient", "radialgradient", "stop", "filter", "script"]);

function translateNode(node, ctx, inherited) {
  const style = { ...inherited, ...styleOf(node) };
  if (style.display === "none" || style.visibility === "hidden") return null;
  switch (node.tag) {
    case "g":
    case "svg":
    case "a":
      return groupShape(node, ctx, inherited);
    case "rect":
      return rectShape(node, ctx, inherited);
    case "circle":
    case "ellipse":
      return ellipseShape(node, ctx, inherited);
    case "line":
      return lineShape(node, ctx, inherited);
    case "polygon":
      return pointsShape(node, ctx, inherited, true);
    case "polyline":
      return pointsShape(node, ctx, inherited, false);
    case "path":
      return pathShape(node, ctx, inherited);
    case "text":
      return textShape(node, ctx, inherited);
    case "image":
      return pictureShape(node, ctx, inherited);
    case "use": {
      const href = String(style.href || style["xlink:href"] || "").replace(/^#/, "");
      const target = ctx.defs.get(href);
      if (!target) { ctx.warn(`use 引用的 id 不存在：${href}`); return null; }
      const matrix = multiply(ctx.matrix, parseTransform(style.transform || node.attrs?.transform));
      const shifted = multiply(matrix, [1, 0, 0, 1, num(style.x, 0), num(style.y, 0)]);
      return translateNode({ ...target, attrs: { ...target.attrs, ...style, transform: "", x: undefined, y: undefined }, children: target.children }, { ...ctx, matrix: shifted }, inherited);
    }
    default:
      if (!SKIP.has(node.tag)) ctx.warn(`不支持的 SVG 元素 <${node.tag}>，已跳过`);
      return null;
  }
}

function translateChildren(node, ctx, inherited) {
  const out = [];
  for (const child of node.children || []) {
    if (!child.tag || SKIP.has(child.tag)) continue;
    if (child.tag === "a" && !child.attrs?.href && !child.attrs?.["xlink:href"]) continue; // <a> 只做超链接包装，当前不支持跳转
    const result = translateNode(child, ctx, inherited);
    if (result) out.push(result);
  }
  return out;
}

/**
 * @param {string} source SVG 源码
 * @param {object} options
 * @param {(href: string) => {data: Buffer, mime: string, ext: string, width?: number, height?: number} | null} options.resolveImage
 */
export function translateSvg(source, { resolveImage = () => null, canvas = CANVAS } = {}) {
  const root = parseSvg(source);
  if (!root || root.tag !== "svg") throw new Error("SVG 根元素不是 <svg>");
  const viewBox = String(root.attrs?.viewBox || "").split(/[\s,]+/).map(Number);
  let baseMatrix = IDENTITY;
  if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    const [minX, minY, width, height] = viewBox;
    const scaleX = canvas.width / (width || canvas.width);
    const scaleY = canvas.height / (height || canvas.height);
    baseMatrix = multiply([scaleX, 0, 0, scaleY, 0, 0], [1, 0, 0, 1, -minX, -minY]);
  }
  const defs = collectDefs(root);
  const media = [];
  let shapeId = 1;
  const warnings = [];
  const stats = { shapes: 0, texts: 0, groups: 0, images: 0, paths: 0 };
  const boxes = [];
  const ctx = {
    matrix: baseMatrix,
    defs,
    warnings,
    stats,
    boxes,
    warn: (message) => { if (!warnings.includes(message)) warnings.push(message); },
    nextId: () => { shapeId += 1; return shapeId; },
    resolveImage,
    addMedia: (asset) => {
      const existing = media.find((item) => item.mime === asset.mime && Buffer.compare(item.data, asset.data) === 0);
      if (existing) return existing.relId;
      const index = media.length + 1;
      const relId = `rId${index + 1}`; // rId1 留给 slideLayout
      media.push({ ...asset, relId, fileName: `image${index}.${asset.ext || "png"}` });
      return relId;
    },
  };
  const children = translateChildren(root, ctx, {});
  return { shapes: children.map((child) => child.xml), media, warnings, stats, boxes, root };
}

export { xmlEscape };
