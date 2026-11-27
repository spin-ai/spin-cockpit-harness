/**
 * SVG path data → 绝对坐标的贝塞尔段。
 *
 * 支持的画法就是设计稿会用的那一套：M L H V C S Q T A Z（大小写都支持）。
 * 圆弧 A/a 先按 SVG 规范转成三次贝塞尔，再统一做矩阵变换（贝塞尔对仿射变换封闭）。
 */
import { applyMatrix } from "./transform.mjs";

const ARG_COUNT = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

export function parsePath(d) {
  const commands = [];
  let i = 0;
  const source = String(d || "");
  let current = [0, 0];
  let start = [0, 0];
  let lastCtrl = null;
  let lastCmd = "";
  let explicitCmd = false;

  const readNumber = () => {
    const re = /^[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/;
    while (i < source.length && /[\s,]/.test(source[i])) i += 1;
    const m = re.exec(source.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const skipSep = () => { while (i < source.length && /[\s,]/.test(source[i])) i += 1; };

  while (i < source.length) {
    skipSep();
    if (i >= source.length) break;
    let cmd = source[i];
    if (/[a-zA-Z]/.test(cmd)) { i += 1; explicitCmd = true; }
    else if (!explicitCmd && ARG_COUNT[lastCmd]) cmd = lastCmd; // 隐式重复上一命令
    else break;
    const lower = cmd.toLowerCase();
    const relative = cmd === lower;
    const count = ARG_COUNT[lower];
    if (count === undefined) break;

    if (lower === "z") {
      commands.push({ cmd: "Z", points: [] });
      current = [...start];
      lastCtrl = null;
      lastCmd = lower;
      continue;
    }

    const args = [];
    for (let k = 0; k < count; k += 1) {
      const n = readNumber();
      if (n === null) return { commands, error: `path 数据在 ${lower} 处不完整` };
      args.push(n);
    }

    const abs = (x, y) => (relative ? [current[0] + x, current[1] + y] : [x, y]);
    if (lower === "m") {
      const point = abs(args[0], args[1]);
      commands.push({ cmd: "M", points: [point] });
      start = [...point];
      current = [...point];
      lastCtrl = null;
      lastCmd = "l"; // moveto 之后的隐式坐标是 lineto
      explicitCmd = false;
      continue;
    }
    if (lower === "l") {
      const point = abs(args[0], args[1]);
      commands.push({ cmd: "L", points: [point] });
      current = point;
      lastCtrl = null;
    } else if (lower === "h") {
      const point = [relative ? current[0] + args[0] : args[0], current[1]];
      commands.push({ cmd: "L", points: [point] });
      current = point;
      lastCtrl = null;
    } else if (lower === "v") {
      const point = [current[0], relative ? current[1] + args[0] : args[0]];
      commands.push({ cmd: "L", points: [point] });
      current = point;
      lastCtrl = null;
    } else if (lower === "c") {
      const c1 = abs(args[0], args[1]);
      const c2 = abs(args[2], args[3]);
      const end = abs(args[4], args[5]);
      commands.push({ cmd: "C", points: [c1, c2, end] });
      lastCtrl = c2;
      current = end;
    } else if (lower === "s") {
      const c1 = lastCtrl ? [2 * current[0] - lastCtrl[0], 2 * current[1] - lastCtrl[1]] : [...current];
      const c2 = abs(args[0], args[1]);
      const end = abs(args[2], args[3]);
      commands.push({ cmd: "C", points: [c1, c2, end] });
      lastCtrl = c2;
      current = end;
    } else if (lower === "q") {
      const c = abs(args[0], args[1]);
      const end = abs(args[2], args[3]);
      commands.push({ cmd: "Q", points: [c, end] });
      lastCtrl = c;
      current = end;
    } else if (lower === "t") {
      const c = lastCtrl ? [2 * current[0] - lastCtrl[0], 2 * current[1] - lastCtrl[1]] : [...current];
      const end = abs(args[0], args[1]);
      commands.push({ cmd: "Q", points: [c, end] });
      lastCtrl = c;
      current = end;
    } else if (lower === "a") {
      const rx = Math.abs(args[0]);
      const ry = Math.abs(args[1]);
      const rotation = args[2];
      const largeArc = args[3] ? 1 : 0;
      const sweep = args[4] ? 1 : 0;
      const end = abs(args[5], args[6]);
      const cubics = arcToCubics(current, end, rx, ry, rotation, largeArc, sweep);
      for (const segment of cubics) commands.push({ cmd: "C", points: segment });
      current = end;
      lastCtrl = cubics.length ? cubics[cubics.length - 1][1] : null;
    }
    lastCmd = lower;
    explicitCmd = false;
  }

  return { commands, subpaths: groupSubpaths(commands) };
}

function groupSubpaths(commands) {
  const subpaths = [];
  let current = null;
  for (const command of commands) {
    if (command.cmd === "M") {
      if (current && current.segments.length) subpaths.push(current);
      current = { start: command.points[0], closed: false, segments: [] };
      continue;
    }
    if (!current) {
      current = { start: [0, 0], closed: false, segments: [] };
    }
    if (command.cmd === "Z") { current.closed = true; continue; }
    current.segments.push(command);
  }
  if (current && current.segments.length) subpaths.push(current);
  return subpaths;
}

export function transformSubpaths(subpaths, matrix) {
  return subpaths.map((subpath) => ({
    ...subpath,
    start: applyMatrix(matrix, subpath.start),
    segments: subpath.segments.map((segment) => ({
      cmd: segment.cmd,
      points: segment.points.map((point) => applyMatrix(matrix, point)),
    })),
  }));
}

/** 所有点（含控制点）的包围盒；控制点略大，但比漏掉形状安全 */
export function subpathsBounds(subpaths) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const subpath of subpaths) {
    for (const point of [subpath.start, ...subpath.segments.flatMap((s) => s.points)]) {
      minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** SVG 规范 F.6.5：端点参数化 → 中心参数化 → 三次贝塞尔 */
export function arcToCubics(from, to, rx, ry, rotationDeg, largeArc, sweep) {
  if (!rx || !ry) return [];
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (from[0] - to[0]) / 2;
  const dy2 = (from[1] - to[1]) / 2;
  const x1 = cosPhi * dx2 + sinPhi * dy2;
  const y1 = -sinPhi * dx2 + cosPhi * dy2;
  // 半径太小：按规范放大到刚好落得下
  let rxs = rx * rx;
  let rys = ry * ry;
  const x1s = x1 * x1;
  const y1s = y1 * y1;
  const lambda = x1s / rxs + y1s / rys;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale; ry *= scale;
    rxs = rx * rx; rys = ry * ry;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = Math.max(0, rxs * rys - rxs * y1s - rys * x1s);
  const denominator = rxs * y1s + rys * x1s;
  const coef = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cosPhi * cx1 - sinPhi * cy1 + (from[0] + to[0]) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const sign2 = ux * vy - uy * vx < 0 ? -1 : 1;
    return sign2 * Math.acos(Math.max(-1, Math.min(1, len === 0 ? 0 : dot / len)));
  };
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (theta) => {
    const x = rx * Math.cos(theta);
    const y = ry * Math.sin(theta);
    return [cosPhi * x - sinPhi * y + cx, sinPhi * x + cosPhi * y + cy];
  };
  const derivative = (theta) => {
    const x = -rx * Math.sin(theta);
    const y = ry * Math.cos(theta);
    return [cosPhi * x - sinPhi * y, sinPhi * x + cosPhi * y];
  };
  const cubics = [];
  for (let index = 0; index < segments; index += 1) {
    const t1 = theta1 + index * step;
    const t2 = t1 + step;
    const p1 = point(t1);
    const p2 = point(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    cubics.push([
      [p1[0] + k * d1[0], p1[1] + k * d1[1]],
      [p2[0] - k * d2[0], p2[1] - k * d2[1]],
      p2,
    ]);
  }
  return cubics;
}

/** 把 path 的所有子路径摊平成折线（几何门禁 / 包围盒用） */
export function flattenSubpaths(subpaths, steps = 8) {
  const out = [];
  for (const subpath of subpaths) {
    let current = subpath.start;
    out.push(current);
    for (const segment of subpath.segments) {
      if (segment.cmd === "L") {
        current = segment.points[0];
        out.push(current);
      } else if (segment.cmd === "Q") {
        const [c, end] = segment.points;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const mt = 1 - t;
          out.push([
            mt * mt * current[0] + 2 * mt * t * c[0] + t * t * end[0],
            mt * mt * current[1] + 2 * mt * t * c[1] + t * t * end[1],
          ]);
        }
        current = end;
      } else if (segment.cmd === "C") {
        const [c1, c2, end] = segment.points;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const mt = 1 - t;
          out.push([
            mt ** 3 * current[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * end[0],
            mt ** 3 * current[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * end[1],
          ]);
        }
        current = end;
      }
    }
  }
  return out;
}
