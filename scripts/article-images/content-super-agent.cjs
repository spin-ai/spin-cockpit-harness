// 第二篇文章配图：封面 / Mission 全景 / 状态机 / MCP 通道
// 由 render-super-agent.cjs 调用。
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

const C = {
  ink: "#0f172a", slate: "#475569", muted: "#64748b", faint: "#94a3b8",
  line: "#cbd5e1", lineSoft: "#e2e8f0", bg: "#f8fafc", white: "#ffffff",
  blue: "#2563eb", blueMid: "#3b82f6", blueSoft: "#dbeafe", bluePale: "#eff6ff",
  green: "#059669", greenMid: "#10b981", greenSoft: "#d1fae5", greenPale: "#ecfdf5",
  amber: "#d97706", amberMid: "#f59e0b", amberSoft: "#fef3c7",
  red: "#dc2626", redSoft: "#fee2e2",
  purple: "#7c3aed", purpleSoft: "#ede9fe",
  cyan: "#0891b2", cyanSoft: "#cffafe",
  dark: "#0b1220", dark2: "#111c33",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function markerDefs() {
  const mk = (id, color) =>
    `<marker id="${id}" markerWidth="10" markerHeight="10" refX="8.5" refY="3.2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6.4 L9,3.2 z" fill="${color}"/></marker>`;
  return [
    mk("arrow-slate", C.slate), mk("arrow-blue", C.blue), mk("arrow-green", C.green),
    mk("arrow-amber", C.amber), mk("arrow-red", C.red), mk("arrow-purple", C.purple),
    mk("arrow-dark", "#334155"), mk("arrow-muted", C.muted),
    `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.10"/></filter>`,
    `<linearGradient id="coverBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070d1a"/><stop offset="0.6" stop-color="#0b1426"/><stop offset="1" stop-color="#0e1a30"/></linearGradient>`,
    `<radialGradient id="coverGlow" cx="0.76" cy="0.26" r="0.6"><stop offset="0" stop-color="#2563eb" stop-opacity="0.34"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></radialGradient>`,
  ].join("");
}

function svgDoc(w, h, body, bg = C.bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${markerDefs()}</defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  ${body}
</svg>`;
}

function rect(x, y, w, h, o = {}) {
  const { rx = 0, fill = C.white, stroke = "none", sw = 1, dash = "", opacity = 1, shadow = false } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ""} opacity="${opacity}" ${shadow ? 'filter="url(#shadow)"' : ""} />`;
}

function txt(x, y, t, o = {}) {
  const { size = 18, fill = C.ink, weight = 400, anchor = "start", family = FONT, opacity = 1, letter = 0 } = o;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${letter}">${esc(t)}</text>`;
}

function lines(x, y, arr, o = {}) {
  const { lh = 24, ...rest } = o;
  return arr.map((t, i) => txt(x, y + i * lh, t, rest)).join("");
}

function arrow(x1, y1, x2, y2, o = {}) {
  const { color = C.slate, width = 2, dash = "", marker = "arrow-slate", opacity = 1 } = o;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#${marker})" opacity="${opacity}" />`;
}

function path(d, o = {}) {
  const { color = C.slate, width = 2, dash = "", marker = "arrow-slate", fill = "none", opacity = 1 } = o;
  return `<path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#${marker})" opacity="${opacity}" />`;
}

function pill(x, y, w, h, label, o = {}) {
  const { fill = C.blueSoft, stroke = "none", color = C.blue, size = 15, weight = 600, rx = h / 2, family = FONT } = o;
  return `${rect(x, y, w, h, { rx, fill, stroke, sw: 1 })}${txt(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: color, weight, anchor: "middle", family })}`;
}

function sectionTitle(title, sub) {
  return `${txt(58, 66, title, { size: 34, weight: 750 })}
  ${txt(58, 100, sub, { size: 17, fill: C.muted })}`;
}

function badgeLabel(x, y, label, color = C.blue) {
  return `${rect(x, y, 92, 28, { rx: 14, fill: C.bluePale, stroke: "#bfdbfe" })}
  ${txt(x + 46, y + 19, label, { size: 12, weight: 750, fill: color, anchor: "middle", letter: 1.4 })}`;
}

function card(x, y, w, h, o = {}) {
  const { stroke = C.line, fill = C.white, sw = 1.2, dash = "" } = o;
  return rect(x, y, w, h, { rx: 14, fill, stroke, sw, dash, shadow: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 封面
// ─────────────────────────────────────────────────────────────────────────────
function cover() {
  const w = 1600, h = 900;
  let b = `<rect width="${w}" height="${h}" fill="url(#coverBg)"/>`;
  b += `<rect width="${w}" height="${h}" fill="url(#coverGlow)"/>`;
  // grid
  for (let x = 0; x < w; x += 48) b += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#94a3b8" stroke-opacity="0.055"/>`;
  for (let y = 0; y < h; y += 48) b += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#94a3b8" stroke-opacity="0.055"/>`;
  // eyebrow
  b += `<line x1="96" y1="104" x2="130" y2="104" stroke="#60a5fa" stroke-width="2"/>`;
  b += txt(144, 110, "COCKPIT HARNESS · 第二篇", { size: 15, fill: "#93a4c4", weight: 650, letter: 2.2 });
  b += txt(96, 212, "从多智能体终端", { size: 70, weight: 800, fill: "#e8eefc", letter: -2 });
  b += txt(96, 300, "到 Super Agent", { size: 78, weight: 800, fill: "#7dd3fc", letter: -2.4 });
  b += `<line x1="96" y1="360" x2="660" y2="360" stroke="#60a5fa" stroke-opacity="0.55"/>`;
  b += lines(96, 410, [
    "主管不是更强的 worker，而是 Mission 级编排者。",
    "计划要能被审批，委派要能被追踪，",
    "派出去的活要真的收得回来。",
  ], { size: 24, fill: "#a9b9d6", lh: 40 });
  const chips = [
    "Mission", "Plan · revision", "Delegation", "受控 MCP", "worktree 并行", "人工验收",
  ];
  let cx = 96, cy = 540;
  for (const c of chips) {
    const cw = 26 + c.length * 13;
    if (cx + cw > 900) { cx = 96; cy += 54; }
    b += rect(cx, cy, cw, 42, { rx: 21, fill: "rgba(15,23,42,0.55)", stroke: "rgba(148,163,184,0.28)" });
    b += txt(cx + cw / 2, cy + 27, c, { size: 14, fill: "#c7d6ef", anchor: "middle" });
    cx += cw + 12;
  }
  b += txt(96, 812, "Electron · React · SQLite · ACP · MCP", { size: 15, fill: "#7f91b2", letter: 0.6 });
  b += txt(96, 844, "github.com/spin-ai/spin-cockpit-harness", { size: 14, fill: "#6f83a5", family: MONO });

  // right: mission stack
  const rx = 960, ry = 128, rw = 540;
  b += rect(rx, ry, rw, 640, { rx: 22, fill: "rgba(10,17,31,0.72)", stroke: "rgba(148,163,184,0.24)" });
  b += rect(rx + 1, ry + 1, rw - 2, 44, { rx: 21, fill: "rgba(15,23,42,0.9)" });
  b += `<circle cx="${rx + 22}" cy="${ry + 23}" r="5" fill="#f87171"/><circle cx="${rx + 40}" cy="${ry + 23}" r="5" fill="#fbbf24"/><circle cx="${rx + 58}" cy="${ry + 23}" r="5" fill="#34d399"/>`;
  b += txt(rx + 84, ry + 28, "Mission · 登录页改造", { size: 13, fill: "#8fa3c4", family: MONO });
  b += txt(rx + rw - 18, ry + 28, "in_review", { size: 12, fill: "#34d399", anchor: "end", family: MONO });

  const row = (y, key, title, meta, state, color) => {
    let s = rect(rx + 22, y, rw - 44, 74, { rx: 12, fill: "rgba(15,23,42,0.72)", stroke: "rgba(148,163,184,0.18)" });
    s += txt(rx + 40, y + 28, key, { size: 12, fill: "#6f83a5", family: MONO });
    s += txt(rx + 82, y + 28, title, { size: 15, fill: "#dbe7fb", weight: 600 });
    s += txt(rx + 40, y + 52, meta, { size: 12, fill: "#7f91b2", family: MONO });
    s += txt(rx + rw - 40, y + 28, state, { size: 12, fill: color, anchor: "end", family: MONO });
    return s;
  };
  b += rect(rx + 22, ry + 66, rw - 44, 92, { rx: 12, fill: "rgba(30,58,138,0.20)", stroke: "rgba(96,165,250,0.42)" });
  b += txt(rx + 40, ry + 94, "✦ SUPERVISOR", { size: 12, fill: "#93c5fd", weight: 700, letter: 1.2 });
  b += txt(rx + 40, ry + 122, "plan_review → waiting_children", { size: 15, fill: "#dbeafe", family: MONO });
  b += txt(rx + rw - 40, ry + 94, "read-only", { size: 11, fill: "#93c5fd", anchor: "end", family: MONO });
  b += txt(rx + rw - 40, ry + 122, "MCP · 8 tools", { size: 11, fill: "#93c5fd", anchor: "end", family: MONO });

  b += row(ry + 182, "d1", "实现登录页", "@frontend · feat/login", "accepted", "#34d399");
  b += row(ry + 266, "d2", "补登录测试", "@test · test/login", "completed", "#34d399");
  b += row(ry + 350, "d3", "整理变更说明", "@docs · feat/login", "running", "#fbbf24");
  b += row(ry + 434, "d4", "修复边界问题", "@frontend · feat/login", "rework", "#c4b5fd");
  b += row(ry + 518, "—", "Mission 总结 · 3/4 子任务", "等待人工确认", "in_review", "#93c5fd");

  b += txt(rx + 22, ry + 620, "delegations = 唯一事实源", { size: 12, fill: "#6f83a5", family: MONO });
  return svgDoc(w, h, b, C.dark);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission 全景
// ─────────────────────────────────────────────────────────────────────────────
function missionFlow() {
  const w = 1600, h = 1000;
  let b = sectionTitle("Mission：一句话如何变成可验收的结果", "人只做三件事——批准计划、运行中纠偏、最后验收；其余交给状态机。");

  const colY = 152, colH = 660;
  const cols = [
    { x: 58, w: 300, n: "01", title: "目标", color: C.cyan, soft: C.cyanSoft },
    { x: 408, w: 360, n: "02", title: "计划", color: C.blue, soft: C.blueSoft },
    { x: 818, w: 380, n: "03", title: "执行", color: C.green, soft: C.greenSoft },
    { x: 1248, w: 294, n: "04", title: "验收", color: C.purple, soft: C.purpleSoft },
  ];
  for (const c of cols) {
    b += rect(c.x, colY, c.w, colH, { rx: 18, fill: C.white, stroke: C.lineSoft, sw: 1.2 });
    b += rect(c.x, colY, c.w, 52, { rx: 18, fill: c.soft });
    b += rect(c.x, colY + 34, c.w, 18, { fill: c.soft });
    b += txt(c.x + 22, colY + 34, c.n, { size: 12, weight: 800, fill: c.color, family: MONO, letter: 1.2 });
    b += txt(c.x + 62, colY + 34, c.title, { size: 19, weight: 750, fill: C.ink });
  }

  // 01
  let x = 58, cw = 300;
  b += card(x + 18, 232, cw - 36, 118);
  b += txt(x + 38, 264, "用户 · Chat", { size: 12, weight: 700, fill: C.muted, letter: 0.8 });
  b += lines(x + 38, 292, ["把登录页拆成实现 + 测试，", "完成后汇总改动和测试结果。"], { size: 14.5, fill: C.ink, lh: 24 });
  b += pill(x + 38, 376, 92, 26, "✦ 主管", { fill: C.bluePale, color: C.blue, size: 12 });
  b += txt(x + 140, 394, "thread.kind=mission", { size: 11, fill: C.faint, family: MONO });

  b += card(x + 18, 462, cw - 36, 132, { fill: C.bg });
  b += txt(x + 38, 492, "Mission 容器", { size: 12, weight: 700, fill: C.muted, letter: 0.8 });
  b += lines(x + 38, 520, ["todo.kind = mission", "mission_state = planning", "supervisor run 入队"], { size: 12.5, fill: C.slate, family: MONO, lh: 24 });
  b += lines(x + 18, 642, ["普通任务仍然走 worker，", "不经过 Mission。"], { size: 12.5, fill: C.faint, lh: 21 });

  // 02
  x = 408;
  b += card(x + 18, 232, 324, 156, { fill: C.bluePale, stroke: "#bfdbfe" });
  b += txt(x + 38, 262, "MCP · mission_plan", { size: 12, weight: 700, fill: C.blue, family: MONO });
  b += lines(x + 38, 292, ["{ summary, steps:[", "    { key, title, brief,", "      agent, acceptance,", "      dependsOn } ], risks }"], { size: 12.5, fill: C.slate, family: MONO, lh: 21 });
  b += txt(x + 38, 400, "校验：key 唯一 / 依赖存在 / 无环 / 不超上限", { size: 11.5, fill: C.muted });

  b += card(x + 18, 422, 324, 250, { stroke: C.line });
  b += txt(x + 38, 452, "Plan Card · rev 1", { size: 13, weight: 750, fill: C.ink });
  b += pill(x + 250, 434, 74, 24, "待审批", { fill: C.amberSoft, color: C.amber, size: 11 });
  const step = (sy, key, title, who, dep) => {
    let s = rect(x + 32, sy, 296, 56, { rx: 9, fill: C.bg, stroke: C.lineSoft });
    s += txt(x + 46, sy + 23, key, { size: 11, fill: C.faint, family: MONO });
    s += txt(x + 76, sy + 23, title, { size: 13.5, fill: C.ink, weight: 600 });
    s += txt(x + 76, sy + 43, dep, { size: 11, fill: C.muted, family: MONO });
    s += txt(x + 312, sy + 23, who, { size: 11, fill: C.blue, anchor: "end", family: MONO });
    return s;
  };
  b += step(474, "s1", "实现登录页", "@frontend", "验收：表单可提交 · 错误可见");
  b += step(540, "s2", "补登录测试", "@test", "dependsOn: s1 · 测试通过");
  b += txt(x + 38, 632, "风险：登录态依赖后端接口", { size: 11.5, fill: C.amber });
  b += pill(x + 18, 646, 118, 32, "退回修改", { fill: C.white, stroke: C.line, color: C.slate, size: 12 });
  b += pill(x + 146, 646, 132, 32, "批准并分派", { fill: C.blue, color: C.white, size: 12 });

  // 03
  x = 818;
  b += txt(x + 22, 236, "Plan 批准后，先解析全部 worker", { size: 11.5, fill: C.muted });
  const delegation = (dy, key, title, meta, status, color, soft) => {
    let s = card(x + 18, dy, 344, 104);
    s += txt(x + 38, dy + 28, key, { size: 11, fill: C.faint, family: MONO });
    s += txt(x + 70, dy + 28, title, { size: 14, fill: C.ink, weight: 650 });
    s += pill(x + 268, dy + 12, 74, 24, status, { fill: soft, color, size: 11 });
    s += txt(x + 38, dy + 54, meta, { size: 11, fill: C.slate, family: MONO });
    s += txt(x + 38, dy + 78, "branch · cockpit/mission-xxx", { size: 11, fill: C.faint, family: MONO });
    return s;
  };
  b += delegation(256, "d1", "实现登录页", "@frontend · worker run", "执行中", C.green, C.greenSoft);
  b += delegation(378, "d2", "补登录测试", "@test · blockedBy d1", "排队", C.amber, C.amberSoft);
  b += delegation(500, "d3", "整理变更说明", "@docs · 可选补充", "失败", C.red, C.redSoft);
  b += card(x + 18, 622, 344, 92, { fill: C.bg });
  b += txt(x + 38, 650, "每个 child 独立 worktree", { size: 12, weight: 700, fill: C.slate });
  b += lines(x + 38, 676, ["→ 可并行；同 cwd 串行只约束根任务", "→ 审批仍走 child run 自己的策略"], { size: 11.5, fill: C.muted, lh: 20 });
  b += txt(x + 22, 750, "主管：waiting_children（不占 worker 并发）", { size: 11.5, fill: C.green });

  // 04
  x = 1248;
  b += card(x + 18, 232, 258, 180, { fill: C.purpleSoft, stroke: "#ddd6fe" });
  b += txt(x + 38, 264, "Mission 总结", { size: 12, weight: 700, fill: C.purple, letter: 0.8 });
  b += lines(x + 38, 294, ["3/4 子任务完成", "改动：Login.tsx", "测试：9 passed", "分支：cockpit/mission-…"], { size: 12, fill: C.slate, lh: 24 });
  b += txt(x + 38, 398, "in_review", { size: 12, fill: C.purple, family: MONO });

  b += card(x + 18, 440, 258, 132);
  b += txt(x + 38, 470, "人确认", { size: 12, weight: 700, fill: C.muted, letter: 0.8 });
  b += lines(x + 38, 500, ["确认完成 → done", "要求返工 → rework", "取消 → 级联停止"], { size: 12.5, fill: C.slate, lh: 24 });
  b += pill(x + 38, 604, 220, 36, "确认完成", { fill: C.purple, color: C.white, size: 13 });

  b += card(x + 18, 672, 258, 104, { fill: C.bg });
  b += txt(x + 38, 700, "收件箱只一条", { size: 12, weight: 700, fill: C.slate });
  b += txt(x + 38, 726, "Mission 待确认 · 3/4", { size: 11.5, fill: C.muted, family: MONO });
  b += txt(x + 38, 750, "子任务结果不复制进 Mission", { size: 11, fill: C.faint });

  // arrows
  b += arrow(362, 290, 404, 290, { color: C.blue, marker: "arrow-blue" });
  b += arrow(774, 290, 814, 290, { color: C.green, marker: "arrow-green" });
  b += arrow(1204, 290, 1244, 290, { color: C.purple, marker: "arrow-purple" });
  b += txt(366, 278, "目标", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += txt(790, 278, "批准", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += txt(1222, 278, "事件", { size: 10.5, fill: C.muted, anchor: "middle" });

  // bottom band
  b += rect(58, 848, 1484, 88, { rx: 14, fill: C.white, stroke: C.lineSoft });
  b += badgeLabel(78, 878, "唯一事实源", C.blue);
  b += txt(190, 890, "Mission 进度 = delegations 派生；不解析聊天记录，不依赖模型自述，也不假设原生 child session 存在。", { size: 14.5, fill: C.ink, weight: 600 });
  b += txt(190, 916, "运行事实 = runs；计划历史 = mission_plans；子任务合同 = delegations。三者分开，统计才不会重复。", { size: 12.5, fill: C.muted });
  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 状态机
// ─────────────────────────────────────────────────────────────────────────────
function missionState() {
  const w = 1600, h = 1000;
  let b = sectionTitle("两个状态机，一个事实源", "Mission 决定这次工作走到哪；Delegation 决定每个子任务走到哪。");

  const stateBox = (x, y, bw, label, sub, color, soft) => {
    let s = rect(x, y, bw, 76, { rx: 12, fill: soft, stroke: color, sw: 1.4 });
    s += txt(x + bw / 2, y + 32, label, { size: 14.5, weight: 700, fill: color, anchor: "middle", family: MONO });
    s += txt(x + bw / 2, y + 56, sub, { size: 11.5, fill: C.slate, anchor: "middle" });
    return s;
  };

  // Mission lane
  b += rect(58, 148, 1484, 250, { rx: 16, fill: C.white, stroke: C.lineSoft });
  b += rect(58, 148, 1484, 46, { rx: 16, fill: C.bluePale });
  b += rect(58, 176, 1484, 18, { fill: C.bluePale });
  b += txt(78, 177, "Mission", { size: 16, weight: 750, fill: C.blue });
  b += txt(170, 177, "todos.kind = 'mission' · todos.mission_state", { size: 12, fill: C.muted, family: MONO });

  b += stateBox(82, 232, 176, "planning", "主管生成计划", C.blue, C.bluePale);
  b += stateBox(322, 232, 196, "plan_review", "Plan Card 待批准", C.amber, C.amberSoft);
  b += stateBox(582, 232, 228, "waiting_children", "等待子任务结束", C.green, C.greenSoft);
  b += stateBox(874, 232, 176, "in_review", "主管已汇总", C.purple, C.purpleSoft);
  b += stateBox(1114, 232, 130, "done", "人确认", C.green, C.greenSoft);
  b += arrow(258, 270, 318, 270, { color: C.blue, marker: "arrow-blue" });
  b += arrow(518, 270, 578, 270, { color: C.amber, marker: "arrow-amber" });
  b += arrow(810, 270, 870, 270, { color: C.green, marker: "arrow-green" });
  b += arrow(1050, 270, 1110, 270, { color: C.purple, marker: "arrow-purple" });
  b += txt(288, 260, "提交", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += txt(548, 260, "批准", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += txt(840, 260, "汇总", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += txt(1080, 260, "确认", { size: 10.5, fill: C.muted, anchor: "middle" });

  // failure row
  const failY = 342;
  b += stateBox(322, failY, 150, "failed", "预算 / 错误", C.red, C.redSoft);
  b += stateBox(500, failY, 176, "cancelled", "人取消 / 级联", C.red, C.redSoft);
  b += stateBox(704, failY, 196, "interrupted", "应用重启", C.slate, "#f1f5f9");
  b += arrow(410, 308, 396, failY, { color: C.red, marker: "arrow-red", dash: "5 4" });
  b += arrow(470, 308, 588, failY, { color: C.red, marker: "arrow-red", dash: "5 4" });
  b += arrow(760, 308, 800, failY, { color: C.slate, marker: "arrow-slate", dash: "5 4" });
  b += txt(920, 382, "终态不伪造：重启标 interrupted，可恢复为新 supervisor run", { size: 11.5, fill: C.muted });

  // Delegation lane
  b += rect(58, 430, 1484, 300, { rx: 16, fill: C.white, stroke: C.lineSoft });
  b += rect(58, 430, 1484, 46, { rx: 16, fill: C.greenPale });
  b += rect(58, 458, 1484, 18, { fill: C.greenPale });
  b += txt(78, 459, "Delegation", { size: 16, weight: 750, fill: C.green });
  b += txt(190, 459, "delegations.status · child Todo / child Run 的合同", { size: 12, fill: C.muted, family: MONO });

  b += stateBox(82, 512, 160, "proposed", "计划步骤", C.slate, "#f1f5f9");
  b += stateBox(300, 512, 150, "queued", "入队", C.blue, C.bluePale);
  b += stateBox(508, 512, 160, "running", "worker 执行", C.green, C.greenSoft);
  b += stateBox(726, 512, 180, "completed", "run 正常结束", C.green, C.greenSoft);
  b += stateBox(964, 512, 160, "accepted", "验收通过", C.green, C.greenSoft);
  b += arrow(246, 550, 296, 550, { color: C.slate, marker: "arrow-slate" });
  b += arrow(454, 550, 504, 550, { color: C.blue, marker: "arrow-blue" });
  b += arrow(672, 550, 722, 550, { color: C.green, marker: "arrow-green" });
  b += arrow(910, 550, 960, 550, { color: C.green, marker: "arrow-green" });

  // branch row
  b += stateBox(508, 630, 160, "waiting_input", "工具审批", C.amber, C.amberSoft);
  b += stateBox(726, 630, 180, "rework", "返工 → 新 run", C.purple, C.purpleSoft);
  b += stateBox(964, 630, 150, "failed", "失败", C.red, C.redSoft);
  b += stateBox(1160, 630, 160, "cancelled", "取消 / 级联", C.red, C.redSoft);
  b += arrow(566, 588, 580, 626, { color: C.amber, marker: "arrow-amber", dash: "5 4" });
  b += txt(640, 620, "权限请求", { size: 10.5, fill: C.amber });
  b += arrow(816, 588, 816, 626, { color: C.purple, marker: "arrow-purple", dash: "5 4" });
  b += txt(848, 616, "主管 review", { size: 10.5, fill: C.purple });
  b += arrow(880, 588, 980, 626, { color: C.red, marker: "arrow-red", dash: "5 4" });
  b += arrow(640, 588, 1180, 626, { color: C.red, marker: "arrow-red", dash: "4 5", opacity: 0.55 });

  // notes
  b += rect(58, 768, 1484, 74, { rx: 14, fill: C.white, stroke: C.lineSoft });
  b += badgeLabel(78, 792, "两个 kind", C.green);
  b += txt(190, 812, "runs.kind = supervisor | worker；runs.parent_run_id 仍是 retry 语义，编排关系放在 delegations，不混用。", { size: 14, fill: C.ink, weight: 600 });
  b += txt(190, 836, "supervisor run：queued → running → waiting_plan / waiting_children → completed；waiting_children 不计入 worker 并发。", { size: 12.5, fill: C.muted, family: MONO });

  b += rect(58, 870, 1484, 74, { rx: 14, fill: "#fffbeb", stroke: "#fde68a" });
  b += txt(78, 896, "状态收敛由 Main 推导，不靠主管“记住自己该在哪”：", { size: 13.5, fill: "#92400e", weight: 700 });
  b += txt(78, 922, "没有计划 → fallback 解析 / 失败；计划待批 → waiting_plan；有待终态子任务 → waiting_children；全部结束 → in_review。", { size: 12.5, fill: "#a16207" });
  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP 通道
// ─────────────────────────────────────────────────────────────────────────────
function mcpBridge() {
  const w = 1600, h = 1000;
  let b = sectionTitle("MCP：给主管一副受控的手", "transport 不进业务；工具面只保留领域动作。主管没有 shell，也没有文件读写。");

  const boxY = 176, boxH = 300;
  const panel = (x, bw, title, sub, color, soft) => {
    let s = card(x, boxY, bw, boxH, { stroke: C.line, fill: C.white });
    s += rect(x, boxY, bw, 52, { rx: 14, fill: soft });
    s += rect(x, boxY + 34, bw, 18, { fill: soft });
    s += txt(x + 20, boxY + 33, title, { size: 15.5, weight: 750, fill: color });
    s += txt(x + 20, boxY + 78, sub, { size: 11.5, fill: C.muted, family: MONO });
    return s;
  };

  // supervisor
  b += panel(58, 330, "dsh supervisor", "ACP · session/new(cwd, mcpServers)", C.blue, C.bluePale);
  b += lines(78, 292, ["• 多轮 session/prompt", "• read-only sandbox", "• 原生 subagent / Team /", "• workflow 已禁用", "• usage 按轮累加"], { size: 12.5, fill: C.slate, lh: 25 });
  b += rect(78, 414, 290, 46, { rx: 9, fill: C.redSoft, stroke: "#fecaca" });
  b += txt(96, 443, "subagent ✕   team ✕   workflow ✕", { size: 12, fill: C.red, family: MONO, weight: 600 });

  // bridge
  b += panel(440, 300, "mcp-bridge.mjs", "stdio JSON-RPC · 子进程", C.purple, C.purpleSoft);
  b += lines(460, 292, ["initialize", "tools/list", "tools/call", "", "只做协议翻译，", "不持有任何业务状态"], { size: 12.5, fill: C.slate, family: MONO, lh: 26 });
  b += txt(460, 450, "env: MISSION_ID / TOKEN", { size: 11.5, fill: C.purple, family: MONO });

  // main
  b += panel(792, 330, "Electron Main", "HTTP + Bearer · 127.0.0.1 /call", C.green, C.greenPale);
  b += lines(812, 292, ["• Bearer per-run token", "• missionId 二次校验", "• 请求体上限 2MB", "• 终态吊销 token", "• 领域动作 + 审计事件"], { size: 12.5, fill: C.slate, lh: 26 });
  b += rect(812, 414, 290, 46, { rx: 9, fill: C.greenSoft, stroke: "#a7f3d0" });
  b += txt(830, 443, "shell ✕   read_file ✕   spawn ✕", { size: 12, fill: C.green, family: MONO, weight: 600 });

  // mission
  b += panel(1174, 368, "Mission 领域", "todos / runs / delegations / mission_plans", C.amber, C.amberSoft);
  b += lines(1194, 292, ["• child Todo + worker run", "• Delegation 合同", "• Plan revision", "• 收件箱 / 统计 / 事件"], { size: 12.5, fill: C.slate, lh: 26 });
  b += rect(1194, 414, 328, 46, { rx: 9, fill: C.amberSoft, stroke: "#fde68a" });
  b += txt(1212, 443, "进度 = delegations 派生", { size: 12, fill: C.amber, family: MONO, weight: 600 });

  // arrows
  b += arrow(388, 326, 436, 326, { color: C.purple, marker: "arrow-purple", width: 2.4 });
  b += arrow(740, 326, 788, 326, { color: C.green, marker: "arrow-green", width: 2.4 });
  b += arrow(1122, 326, 1170, 326, { color: C.amber, marker: "arrow-amber", width: 2.4 });
  b += txt(412, 314, "stdio", { size: 11, fill: C.muted, anchor: "middle", family: MONO });
  b += txt(764, 314, "HTTP", { size: 11, fill: C.muted, anchor: "middle", family: MONO });
  b += txt(1146, 314, "领域", { size: 11, fill: C.muted, anchor: "middle", family: MONO });

  // tools
  b += rect(58, 522, 1484, 178, { rx: 16, fill: C.white, stroke: C.lineSoft });
  b += txt(78, 556, "八个工具，全部是领域动作", { size: 16, weight: 750, fill: C.ink });
  const tools = [
    ["mission_plan", "提交 / 修订计划", C.blue],
    ["task_delegate", "新增子任务", C.blue],
    ["task_list", "列出子任务", C.slate],
    ["task_get", "查看详情", C.slate],
    ["task_review", "接受 / 返工 / 取消", C.purple],
    ["task_steer", "运行中纠偏", C.amber],
    ["task_retry", "重试失败任务", C.amber],
    ["mission_finish", "提交总结 → in_review", C.green],
  ];
  tools.forEach(([name, desc, color], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const tx = 78 + col * 366, ty = 580 + row * 54;
    b += rect(tx, ty, 348, 44, { rx: 9, fill: C.bg, stroke: C.lineSoft });
    b += txt(tx + 14, ty + 28, name, { size: 12.5, fill: color, family: MONO, weight: 700 });
    b += txt(tx + 168, ty + 28, desc, { size: 11.5, fill: C.muted });
  });

  // guarantees
  b += rect(58, 728, 722, 208, { rx: 16, fill: C.greenPale, stroke: "#a7f3d0" });
  b += txt(78, 764, "通道约束", { size: 15, weight: 750, fill: C.green });
  b += lines(78, 800, ["只监听 127.0.0.1，端口随机", "每个 supervisor run 一个随机 token", "请求里的 missionId 必须与 token 一致", "Mission 结束 / 失败 / 取消时立刻吊销"], { size: 13, fill: "#065f46", lh: 28 });

  b += rect(818, 728, 724, 208, { rx: 16, fill: C.redSoft, stroke: "#fecaca" });
  b += txt(838, 764, "双调度为什么必须禁", { size: 15, weight: 750, fill: C.red });
  b += lines(838, 800, ["模型绕过 task_delegate 调原生 subagent", "→ 内部起 child session，Harness 看不见", "→ 看板为空、统计少算、审批不在队列", "这种错误不报错，只会“看起来跑完了”"], { size: 13, fill: "#991b1b", lh: 28 });

  b += txt(58, 972, "原则：合同唯一、事实源唯一、工具面最小。", { size: 13, fill: C.muted });
  return svgDoc(w, h, b);
}

module.exports = {
  images: [
    { name: "cover", width: 1600, height: 900, svg: cover() },
    { name: "mission-flow", width: 1600, height: 1000, svg: missionFlow() },
    { name: "mission-state", width: 1600, height: 1000, svg: missionState() },
    { name: "mcp-bridge", width: 1600, height: 1000, svg: mcpBridge() },
  ],
};
