/** SVG transform → 2×3 矩阵：[a b c d e f]，与 SVG matrix(a,b,c,d,e,f) 同序 */
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m, n) {
  // m × n：先应用 n，再应用 m
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m, [x, y]) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function translation(tx, ty) {
  return [1, 0, 0, 1, Number(tx) || 0, Number(ty) || 0];
}

export function scaleMatrix(sx, sy = sx) {
  return [Number(sx) || 0, 0, 0, Number(sy) || 0, 0, 0];
}

export function rotation(deg, cx = 0, cy = 0) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return multiply(multiply(translation(cx, cy), [cos, sin, -sin, cos, 0, 0]), translation(-cx, -cy));
}

/** 解析 transform="translate(...) rotate(...)"；未知函数直接跳过 */
export function parseTransform(value) {
  const source = String(value || "").trim();
  if (!source) return IDENTITY;
  let m = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1].toLowerCase();
    const args = match[2].split(/[\s,]+/).map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));
    let next = IDENTITY;
    if (name === "matrix" && args.length >= 6) next = args.slice(0, 6);
    else if (name === "translate") next = translation(args[0] || 0, args[1] || 0);
    else if (name === "scale") next = scaleMatrix(args[0] ?? 1, args[1] ?? args[0] ?? 1);
    else if (name === "rotate") next = rotation(args[0] || 0, args[1] || 0, args[2] || 0);
    else if (name === "skewx") next = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewy") next = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, next);
  }
  return m;
}

/** 从矩阵里拆出近似：轴对齐缩放 / 旋转角 / 平移。用于 rect/text 这类必须给 xfrm 的元素 */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const rotationDeg = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return { sx, sy, rotation: rotationDeg, dx: m[4], dy: m[5], axisAligned: Math.abs(rotationDeg) < 0.01 && Math.abs(m[2]) < 1e-6 && Math.abs(m[3] - sy) < 1e-6 };
}

export function transformPoints(m, points) {
  return points.map((point) => applyMatrix(m, point));
}
