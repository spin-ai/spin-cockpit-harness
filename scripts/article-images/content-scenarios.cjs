// 第四篇文章配图：封面 / 场景三层 / 六场景矩阵 / 消费链 / 办公室投影
// 由 render-scenarios.cjs 调用。
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

const C = {
  ink: "#0f172a", slate: "#475569", muted: "#64748b", faint: "#94a3b8",
  line: "#cbd5e1", lineSoft: "#e2e8f0", bg: "#f8fafc", white: "#ffffff",
  blue: "#2563eb", blueSoft: "#dbeafe", bluePale: "#eff6ff",
  green: "#059669", greenSoft: "#d1fae5", greenPale: "#ecfdf5",
  amber: "#b45309", amberSoft: "#fef3c7", amberPale: "#fffbeb",
  red: "#dc2626", redSoft: "#fee2e2", redPale: "#fef2f2",
  purple: "#7c3aed", purpleSoft: "#ede9fe", purplePale: "#f5f3ff",
  cyan: "#0891b2", cyanSoft: "#cffafe", cyanPale: "#ecfeff",
  dark: "#0b1220",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function markerDefs() {
  const mk = (id, color) =>
    `<marker id="${id}" markerWidth="10" markerHeight="10" refX="8.5" refY="3.2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6.4 L9,3.2 z" fill="${color}"/></marker>`;
  return [
    mk("arrow-slate", C.slate), mk("arrow-blue", C.blue), mk("arrow-green", C.green),
    mk("arrow-amber", C.amber), mk("arrow-red", C.red), mk("arrow-purple", C.purple),
    mk("arrow-dark", "#334155"), mk("arrow-muted", C.muted), mk("arrow-cyan", C.cyan),
    `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.10"/></filter>`,
    `<linearGradient id="coverBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#060b16"/><stop offset="0.6" stop-color="#0b1426"/><stop offset="1" stop-color="#101b31"/></linearGradient>`,
    `<radialGradient id="coverGlow" cx="0.74" cy="0.22" r="0.6"><stop offset="0" stop-color="#2563eb" stop-opacity="0.30"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="coverGlow2" cx="0.66" cy="0.82" r="0.52"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.16"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>`,
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

function card(x, y, w, h, o = {}) {
  const { stroke = C.line, fill = C.white, sw = 1.2, dash = "" } = o;
  return rect(x, y, w, h, { rx: 14, fill, stroke, sw, dash, shadow: true });
}

function badgeLabel(x, y, label, o = {}) {
  const { color = C.blue, fill = C.bluePale, stroke = "#bfdbfe", w = 92 } = o;
  return `${rect(x, y, w, 28, { rx: 14, fill, stroke })}
  ${txt(x + w / 2, y + 19, label, { size: 12, weight: 750, fill: color, anchor: "middle", letter: 1.2 })}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 18 · 封面
// ─────────────────────────────────────────────────────────────────────────────
function cover() {
  const w = 1600, h = 900;
  let b = `<rect width="${w}" height="${h}" fill="url(#coverBg)"/>`;
  b += `<rect width="${w}" height="${h}" fill="url(#coverGlow)"/>`;
  b += `<rect width="${w}" height="${h}" fill="url(#coverGlow2)"/>`;
  for (let x = 0; x < w; x += 48) b += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#94a3b8" stroke-opacity="0.055"/>`;
  for (let y = 0; y < h; y += 48) b += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#94a3b8" stroke-opacity="0.055"/>`;

  b += `<line x1="96" y1="104" x2="130" y2="104" stroke="#60a5fa" stroke-width="2"/>`;
  b += txt(144, 110, "COCKPIT HARNESS · 第四篇", { size: 15, fill: "#a9b5cf", weight: 650, letter: 2.2 });
  b += txt(96, 208, "多智能体工作台", { size: 64, weight: 800, fill: "#e8eefc", letter: -2 });
  b += txt(96, 296, "适合干什么", { size: 78, weight: 800, fill: "#93c5fd", letter: -2.4 });
  b += `<line x1="96" y1="356" x2="660" y2="356" stroke="#3b82f6" stroke-opacity="0.5"/>`;
  b += lines(96, 406, [
    "场景不是皮肤，是任务形状的声明。",
    "六个真实场景，一条判据。",
    "以及一串「别这么用」。",
  ], { size: 23, fill: "#a9b9d6", lh: 40 });

  const chips = ["单点小改", "并行重构", "长任务", "排障", "资料整理", "远端"];
  let cx = 96, cy = 560;
  for (const c of chips) {
    const cw = 34 + c.length * 19;
    if (cx + cw > 860) { cx = 96; cy += 56; }
    b += rect(cx, cy, cw, 44, { rx: 22, fill: "rgba(15,23,42,0.55)", stroke: "rgba(148,163,184,0.28)" });
    b += txt(cx + cw / 2, cy + 29, c, { size: 15, fill: "#c7d6ef", anchor: "middle" });
    cx += cw + 12;
  }

  b += txt(96, 812, "Electron · React · SQLite · ACP · worktree", { size: 15, fill: "#7f91b2", letter: 0.6 });
  b += txt(96, 844, "github.com/spin-ai/spin-cockpit-harness", { size: 14, fill: "#6f83a5", family: MONO });

  // right: six scenarios table
  const px = 930, py = 120, pw = 560, ph = 660;
  b += rect(px, py, pw, ph, { rx: 22, fill: "rgba(10,17,31,0.74)", stroke: "rgba(148,163,184,0.24)" });
  b += rect(px + 1, py + 1, pw - 2, 44, { rx: 21, fill: "rgba(15,23,42,0.9)" });
  b += `<circle cx="${px + 22}" cy="${py + 23}" r="5" fill="#f87171"/><circle cx="${px + 40}" cy="${py + 23}" r="5" fill="#fbbf24"/><circle cx="${px + 58}" cy="${py + 23}" r="5" fill="#34d399"/>`;
  b += txt(px + 84, py + 28, "场景判据 · 6 cases", { size: 13, fill: "#8fa3c4", family: MONO });
  b += txt(px + pw - 18, py + 28, "并行 / 介入 / 验收", { size: 12, fill: "#93c5fd", anchor: "end", family: MONO });

  const rows = [
    ["单点小改", "1", "分钟级", "一条命令", "#94a3b8"],
    ["并行重构", "2–4", "计划批准", "集成 build", "#60a5fa"],
    ["长任务", "1–2", "小时级", "失败清单", "#fbbf24"],
    ["排障", "1", "秒级", "页面不白", "#34d399"],
    ["资料整理", "按章节", "逐页审核", "引用可点", "#c084fc"],
    ["远端", "按主机", "看队列", "同左", "#22d3ee"],
  ];
  rows.forEach(([name, par, gate, acc, color], i) => {
    const y = py + 66 + i * 92;
    b += rect(px + 22, y, pw - 44, 78, { rx: 10, fill: "rgba(15,23,42,0.72)", stroke: "rgba(148,163,184,0.2)" });
    b += rect(px + 22, y, 4, 78, { rx: 2, fill: color });
    b += txt(px + 42, y + 32, name, { size: 15, weight: 750, fill: "#e2e8f5" });
    b += txt(px + 42, y + 58, `并行 ${par} · ${gate}`, { size: 11.5, fill: "#8fa3c4", family: MONO });
    b += txt(px + pw - 44, y + 46, acc, { size: 12.5, fill: color, anchor: "end", weight: 700 });
  });

  b += txt(px + 22, py + 626, "能切开 / 多久看一次 / 怎么验收", { size: 11.5, fill: "#8fa3c4", family: MONO });
  b += txt(px + pw - 22, py + 626, "— 三问都过再上编排", { size: 11.5, fill: "#6f83a5", anchor: "end" });

  return svgDoc(w, h, b, C.dark);
}

// ─────────────────────────────────────────────────────────────────────────────
// 19 · 场景三层
// ─────────────────────────────────────────────────────────────────────────────
function sceneLayers() {
  const w = 1600, h = 1000;
  let b = sectionTitle("场景有三层，只有两层参与行为", "舞台模板管长相，协作场景管人和舞台，执行配置管单个任务怎么跑。");

  const blocks = [
    {
      y: 152, hh: 196, tag: "①", name: "舞台模板 · template", color: C.slate, soft: "#f1f5f9", stroke: C.lineSoft,
      rows: [["office", "2.5D 已上线：经理室 / 工位区 / 审批台 / 验收架 / 茶歇区 / 会议室"], ["warroom", "3D 舞台：长桌 / 主屏 / 发布闸门 / 复盘墙（仍标原型）"], ["carrier", "3D 舞台：甲板 / 弹射位 / 拦阻索（流水线已下线，按 carrier 呈现）"]],
      foot: "不参与调度：换舞台不会改变任何 run 的行为",
    },
    {
      y: 376, hh: 236, tag: "②", name: "协作场景 · coordination_scenes", color: C.purple, soft: C.purplePale, stroke: "#ddd6fe",
      rows: [["cast[]", "lead / worker / reviewer · seat · displayName"], ["prefs", "reviewGate / escalate / inject / showLinks / showLabels"], ["一个项目", "可以有多份；新项目自动建一个办公室场景"]],
      foot: "决定阵容与呈现；不复制执行配置",
    },
    {
      y: 640, hh: 232, tag: "③", name: "执行配置 · 每项目一份文本", color: C.blue, soft: C.bluePale, stroke: "#bfdbfe",
      rows: [["worktree / runtime", "auto|always|never · acp|terminal"], ["agent / concurrency", "默认派给谁 · 项目期望并行度"], ["acceptance / notes", "验收命令 · 人话边界（改了 dist 别动）"]],
      foot: "下一次派活生效；不改变已有 run",
    },
  ];

  for (const bl of blocks) {
    b += card(58, bl.y, 860, bl.hh, { stroke: bl.stroke });
    b += rect(58, bl.y, 7, bl.hh, { rx: 3.5, fill: bl.color });
    b += rect(82, bl.y + 20, 34, 30, { rx: 9, fill: bl.soft, stroke: bl.color, sw: 1.2 });
    b += txt(99, bl.y + 41, bl.tag, { size: 15, weight: 800, fill: bl.color, anchor: "middle" });
    b += txt(130, bl.y + 42, bl.name, { size: 19, weight: 750, fill: C.ink });
    bl.rows.forEach(([k, v], i) => {
      const y = bl.y + 78 + i * 34;
      b += txt(84, y, k, { size: 12.5, weight: 700, fill: bl.color, family: MONO });
      b += txt(232, y, v, { size: 12.5, fill: C.slate });
    });
    b += txt(84, bl.y + bl.hh - 18, bl.foot, { size: 11.5, fill: C.muted });
  }

  // right: who reads what
  const rx = 966, rw = 576;
  b += card(rx, 152, rw, 720, { stroke: C.lineSoft });
  b += txt(rx + 26, 190, "谁读它", { size: 20, weight: 800, fill: C.ink });
  b += txt(rx + 26, 216, "判断配置有没有用：删掉这个字段，行为会不会变？", { size: 11.5, fill: C.muted });

  const readers = [
    ["调度器", "执行配置", "worktree / runtime / concurrency / acceptance", C.blue],
    ["Chat 派活", "执行配置 + 项目", "agent 别名、worktree 模式、场景覆盖", C.blue],
    ["舞台", "State + 协作场景", "runs / approvals / terminals → 区域", C.purple],
    ["统计", "runs", "按 run 聚合，不按场景分摊", C.green],
  ];
  readers.forEach(([who, from, what, color], i) => {
    const y = 250 + i * 104;
    b += rect(rx + 26, y, rw - 52, 86, { rx: 10, fill: C.bg, stroke: C.lineSoft });
    b += pill(rx + 42, y + 16, 96, 26, who, { fill: color === C.purple ? C.purpleSoft : color === C.green ? C.greenSoft : C.blueSoft, color, size: 12.5 });
    b += txt(rx + 152, y + 34, from, { size: 13, weight: 700, fill: C.ink });
    b += txt(rx + 42, y + 66, what, { size: 11.5, fill: C.muted, family: MONO });
  });

  // not read
  b += rect(rx + 26, 680, rw - 52, 76, { rx: 10, fill: C.redPale, stroke: "#fecaca" });
  b += txt(rx + 42, 708, "调度器不读：template / cast / seat / prefs", { size: 13, weight: 750, fill: C.red });
  b += txt(rx + 42, 734, "所以「把座位调一下，活就快了」是错觉——它只改呈现。", { size: 11.5, fill: "#991b1b" });

  b += rect(rx + 26, 776, rw - 52, 72, { rx: 10, fill: C.amberPale, stroke: "#fde68a" });
  b += txt(rx + 42, 804, "场景引用执行配置，不复制它", { size: 13.5, weight: 800, fill: C.amber });
  b += txt(rx + 42, 830, "研发小队 · 办公室 → 默认执行配置 project#acp", { size: 11.5, fill: "#92400e", family: MONO });

  // arrows: ② → ③ reference
  b += arrow(500, 612, 500, 640, { color: C.amber, marker: "arrow-amber", width: 2.4 });
  b += txt(514, 632, "引用", { size: 11, fill: C.amber });

  return svgDoc(w, h, b);
}


// ─────────────────────────────────────────────────────────────────────────────
// 23 · 航母甲板 ↔ 多 Agent 调度
// ─────────────────────────────────────────────────────────────────────────────
function carrierMapping() {
  const w = 1600, h = 1000;
  let b = sectionTitle("航母甲板 ↔ 多 Agent 调度", "起飞可以并行，回收只有一条道——这和多 Agent 的调度约束是同构的。");

  const dx = 58, dy = 158, dw = 760, dh = 620;
  b += card(dx, dy, dw, dh, { stroke: "#bfdbfe", fill: "#f2f7fd" });
  b += txt(dx + 24, dy + 32, "甲板（俯视）", { size: 14, weight: 800, fill: C.blue });
  b += txt(dx + dw - 24, dy + 32, "carrier · three.js 3D 舞台", { size: 11, fill: C.muted, anchor: "end", family: MONO });

  // 甲板轮廓
  b += `<path d="M${dx + 250} ${dy + 74} L${dx + 700} ${dy + 108} L${dx + 716} ${dy + 250} L${dx + 700} ${dy + 560} L${dx + 210} ${dy + 560} L${dx + 120} ${dy + 420} L${dx + 150} ${dy + 170} Z"
    fill="#ffffff" stroke="${C.blue}" stroke-width="2" />`;

  // 两条弹射位
  b += `<line x1="${dx + 250}" y1="${dy + 316}" x2="${dx + 566}" y2="${dy + 186}" stroke="${C.green}" stroke-width="3" />`;
  b += `<line x1="${dx + 232}" y1="${dy + 372}" x2="${dx + 548}" y2="${dy + 242}" stroke="${C.green}" stroke-width="3" />`;
  b += rect(dx + 206, dy + 324, 30, 12, { rx: 4, fill: C.greenSoft, stroke: C.green });
  b += rect(dx + 188, dy + 380, 30, 12, { rx: 4, fill: C.greenSoft, stroke: C.green });
  b += txt(dx + 470, dy + 152, "弹射位 ×2", { size: 12, fill: C.green, weight: 800 });
  b += txt(dx + 470, dy + 172, "并行，但各占一个 worktree", { size: 10, fill: C.muted });

  // 着舰道（单条回收）
  b += `<path d="M${dx + 196} ${dy + 474} L${dx + 648} ${dy + 252}" stroke="${C.purple}" stroke-width="2.4" stroke-dasharray="10 8" />`;
  b += txt(dx + 236, dy + 446, "着舰道 · 单条", { size: 12, fill: C.purple, weight: 800 });
  b += txt(dx + 236, dy + 466, "review / approval 只有一条", { size: 10, fill: C.muted });

  // 拦阻索
  for (const i of [0, 1, 2]) {
    b += `<line x1="${dx + 352 + i * 30}" y1="${dy + 444 - i * 12}" x2="${dx + 404 + i * 30}" y2="${dy + 462 - i * 12}" stroke="${C.amber}" stroke-width="2" />`;
  }
  b += txt(dx + 352, dy + 512, "拦阻索 ×3 · 验收", { size: 10.5, fill: C.amber, weight: 700 });

  // 舰岛 / 塔台
  b += rect(dx + 608, dy + 320, 78, 158, { rx: 8, fill: "#e8effa", stroke: C.blue });
  b += txt(dx + 647, dy + 352, "舰岛", { size: 12.5, weight: 800, fill: C.blue, anchor: "middle" });
  b += txt(dx + 647, dy + 374, "塔台", { size: 10.5, fill: C.slate, anchor: "middle" });
  b += txt(dx + 647, dy + 392, "supervisor", { size: 9.5, fill: C.muted, anchor: "middle", family: MONO });
  b += `<circle cx="${dx + 647}" cy="${dy + 434}" r="5" fill="${C.amber}"/>`;
  b += txt(dx + 647, dy + 456, "放行", { size: 9.5, fill: C.amber, anchor: "middle" });

  // 复飞弧线
  b += path(`M${dx + 648} ${dy + 252} C${dx + 726} ${dy + 214} ${dx + 744} ${dy + 470} ${dx + 700} ${dy + 524}`,
    { color: C.red, marker: "arrow-red", width: 2, dash: "7 6" });
  b += txt(dx + 610, dy + 220, "复飞 = 重试", { size: 11, fill: C.red, weight: 700, anchor: "end" });

  // 两个不标名的机位（只为让甲板不像空图纸）
  const blob = (x, y, color) => rect(x, y, 20, 28, { rx: 8, fill: color, stroke: "none" });
  b += blob(dx + 300, dy + 388, "rgba(5,150,105,.55)");
  b += blob(dx + 430, dy + 320, "rgba(124,58,237,.45)");
  b += txt(dx + 250, dy + 570, "每个 blob 是一个 worker；名字牌在真实舞台里显示 @别名", { size: 10, fill: C.faint });

  const rx = 852, rw = 690;
  b += card(rx, 158, rw, 620, { stroke: C.lineSoft });
  b += txt(rx + 26, 194, "同一个状态，换一套说法", { size: 17, weight: 800, fill: C.ink });
  b += txt(rx + 26, 220, "状态机不变；舞台只换「这件事发生在哪」。", { size: 11.5, fill: C.muted });

  const rows = [
    ["queued", "等弹射位", "排队、等闸门", C.green],
    ["running", "已弹射", "空中执行", C.blue],
    ["waiting_input", "塔台放行", "等人点头", C.amber],
    ["in_review", "排队着舰", "回收道只有一条", C.purple],
    ["failed", "复飞", "重试 = 新 worktree", C.red],
    ["done", "入库", "验收后的产物", C.slate],
  ];
  rows.forEach(([state, where, note, color], i) => {
    const y = 246 + i * 82;
    b += rect(rx + 26, y, rw - 52, 68, { rx: 10, fill: C.white, stroke: C.lineSoft });
    b += rect(rx + 26, y, 5, 68, { rx: 2.5, fill: color });
    b += txt(rx + 46, y + 30, state, { size: 12.5, fill: C.slate, family: MONO });
    b += txt(rx + 46, y + 54, note, { size: 11, fill: C.muted });
    b += txt(rx + rw - 46, y + 38, where, { size: 15, weight: 750, fill: color, anchor: "end" });
  });

  b += rect(58, 800, 1484, 140, { rx: 14, fill: C.white, stroke: "#fde68a" });
  b += badgeLabel(78, 824, "三条约束", { color: C.amber, fill: C.amberPale, stroke: "#fde68a", w: 86 });
  const rules = [
    ["并行起飞", "弹射位可以同时用；但每个 worker 一个 worktree"],
    ["单道回收", "review / approval 只有一条道，排进去就得等"],
    ["中止即复飞", "取消不是「慢慢停下」，是回到上一个安全状态"],
  ];
  rules.forEach(([t, d], i) => {
    const x = 78 + i * 486;
    b += txt(x, 872, t, { size: 13.5, weight: 800, fill: C.ink });
    b += txt(x, 898, d, { size: 11, fill: C.muted });
  });
  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 20 · 六场景矩阵
// ─────────────────────────────────────────────────────────────────────────────
function sceneMatrix() {
  const w = 1600, h = 1000;
  let b = sectionTitle("六个场景，四列判据", "并行度、隔离方式、人的介入点、验收方式——写不出第四列的场景，先别交给 Agent。");

  const cols = ["场景 / 任务形状", "并行", "隔离", "人的介入", "验收"];
  const xs = [58, 470, 620, 878, 1236];
  const ws = [412, 150, 258, 358, 306];

  b += rect(58, 140, 1484, 46, { rx: 10, fill: "#eef2f7" });
  cols.forEach((c, i) => b += txt(xs[i] + 18, 170, c, { size: 13, weight: 750, fill: C.slate, letter: 0.4 }));

  const rows = [
    {
      name: "单点小改", shape: "一处改动 · 不可切分", par: "1", iso: "worktree auto（有 git 才建）", gate: "确认交付，不做编排", acc: "一条命令", color: C.slate,
    },
    {
      name: "并行重构", shape: "按目录切 · 20 个文件", par: "2–4", iso: "worktree + blockedBy 依赖", gate: "批准 Plan Card，逐条收子任务", acc: "集成后 build", color: C.blue,
    },
    {
      name: "长任务", shape: "批量测试 / 迁移 · 无人值守", par: "1–2", iso: "worktree 可整条丢弃", gate: "只在审批与预算上点头", acc: "失败清单 + 分类", color: C.amber,
    },
    {
      name: "排障", shape: "信息缺口 · 需要现场", par: "1", iso: "原地，不建 worktree", gate: "秒级；人就在终端里", acc: "页面不再白屏", color: C.green,
    },
    {
      name: "资料整理", shape: "非代码 · 按章节可拆", par: "1 / 章", iso: "不涉及代码仓库", gate: "逐页审核建议，不自动改", acc: "引用能点开", color: C.purple,
    },
    {
      name: "远端 / 多机", shape: "重活在别人机器上", par: "按主机", iso: "远端不建 worktree", gate: "看队列原因与心跳", acc: "同左 + 可改用本机", color: C.cyan,
    },
  ];

  rows.forEach((r, i) => {
    const y = 196 + i * 112;
    b += rect(58, y, 1484, 100, { rx: 12, fill: C.white, stroke: C.lineSoft, shadow: true });
    b += rect(58, y, 6, 100, { rx: 3, fill: r.color });
    b += txt(84, y + 40, r.name, { size: 17.5, weight: 750, fill: C.ink });
    b += txt(84, y + 68, r.shape, { size: 11.5, fill: C.muted });
    b += txt(xs[1] + 18, y + 58, r.par, { size: 15, weight: 750, fill: r.color, family: MONO });
    b += txt(xs[2] + 18, y + 58, r.iso, { size: 12.5, fill: C.slate });
    b += txt(xs[3] + 18, y + 58, r.gate, { size: 12.5, fill: C.slate });
    b += txt(xs[4] + 18, y + 58, r.acc, { size: 12.5, weight: 700, fill: r.color });
  });

  // bottom: three questions
  b += rect(58, 872, 1484, 92, { rx: 14, fill: C.white, stroke: "#bfdbfe" });
  b += badgeLabel(78, 898, "三问", { color: C.blue, fill: C.bluePale, stroke: "#bfdbfe", w: 72 });
  const qs = [
    ["能切开吗", "切片不冲突才并行"],
    ["多久看一次", "秒级就别上编排"],
    ["怎么验收", "写不出来就先别派"],
  ];
  qs.forEach(([q, d], i) => {
    const x = 174 + i * 450;
    b += txt(x, 910, q, { size: 14, weight: 750, fill: C.ink });
    b += txt(x, 936, d, { size: 11.5, fill: C.muted });
  });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 21 · 场景到调度
// ─────────────────────────────────────────────────────────────────────────────
function sceneDispatch() {
  const w = 1600, h = 1000;
  let b = sectionTitle("从一段文本到一次 run：消费链上的每一环都要留痕", "配置 → 解析 → 派活 → 闸门 → run → 验收；失败文案是产品的一部分。");

  // chain
  const chain = [
    ["执行配置文本", "worktree / runtime / agent / concurrency / acceptance / notes", C.blue],
    ["严格解析", "未知键 / 非法值直接报错，保存被拒；notes 吞掉后续所有行", C.cyan],
    ["派活时消费", "项目覆盖全局；下一次派活生效，不追溯", C.green],
    ["run + 事件", "session/update 落库；审批 / 纠偏 / 产物", C.purple],
    ["验收", "in_review → 人接受 → done；总结 ≠ 确认", C.amber],
  ];
  chain.forEach(([t, d, color], i) => {
    const y = 150 + i * 96;
    b += rect(58, y, 660, 78, { rx: 12, fill: C.white, stroke: C.lineSoft });
    b += rect(58, y, 6, 78, { rx: 3, fill: color });
    b += txt(84, y + 30, t, { size: 15.5, weight: 750, fill: C.ink });
    b += txt(84, y + 55, d, { size: 11.5, fill: C.muted });
    if (i < chain.length - 1) b += arrow(388, y + 78, 388, y + 96, { color: C.slate, marker: "arrow-slate", width: 2 });
  });

  // gates
  b += card(760, 150, 782, 630, { stroke: C.lineSoft });
  b += txt(786, 186, "八道闸门，顺序固定", { size: 18, weight: 800, fill: C.ink });
  b += txt(786, 212, "不通过不报错，只写 queueReason；静默的两条是排班不是故障。", { size: 11.5, fill: C.muted });

  const gates = [
    ["1", "主机在线", "主机离线", C.red],
    ["2", "Mission 只许本地 supervisor", "Mission 一期只支持本地 supervisor", C.red],
    ["3", "Supervisor 并发（默认 1）", "等待 Supervisor 并发", C.purple],
    ["4", "全局 worker 并发", "等待全局并发", C.blue],
    ["5", "主机并发上限", "主机并发已满 · <host>", C.cyan],
    ["6", "单 Agent 并发（agent.max）", "静默继续（排班）", C.slate],
    ["7", "依赖未完成", "等待依赖 · N", C.amber],
    ["8", "同 cwd 串行（非 Mission 子任务）", "静默继续（安全阀）", C.slate],
  ];
  gates.forEach(([n, g, reason, color], i) => {
    const y = 236 + i * 66;
    b += rect(786, y, 730, 54, { rx: 9, fill: i % 2 ? C.bg : C.white, stroke: C.lineSoft });
    b += txt(804, y + 33, n, { size: 11.5, weight: 800, fill: C.faint, family: MONO });
    b += txt(832, y + 33, g, { size: 12.5, fill: C.ink });
    b += txt(1200, y + 33, reason, { size: 11, fill: color, family: MONO });
  });

  // bottom: three intervention
  b += rect(58, 660, 660, 200, { rx: 14, fill: C.white, stroke: C.lineSoft });
  b += txt(84, 696, "人的三个动作", { size: 17, weight: 800, fill: C.ink });
  const acts = [
    ["批准", "ACP request_permission → 落库状态，不是弹窗副作用", C.amber],
    ["纠偏", "投递中 → 已注入 → 失败·重发；不假装已注入", C.blue],
    ["验收", "run 结束 = in_review；确认是独立动作", C.green],
  ];
  acts.forEach(([k, v, color], i) => {
    const y = 726 + i * 44;
    b += txt(84, y, k, { size: 13, weight: 750, fill: color });
    b += txt(140, y, v, { size: 11.5, fill: C.muted });
  });

  // right bottom: honest note
  b += rect(760, 800, 782, 152, { rx: 14, fill: C.amberPale, stroke: "#fde68a" });
  b += txt(786, 834, "当前落差（写在图里，别等读者发现）", { size: 14, weight: 800, fill: C.amber });
  b += lines(786, 862, [
    "协作场景的 reviewGate / escalate / inject 已能存、能改、能呈现，",
    "但还没有被派活链路消费——打开评审门，不会真的多一道评审。",
    "场景也不从舞台触发派活：双调度是最贵的坑。",
  ], { size: 11.5, fill: "#92400e", lh: 22 });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 22 · 办公室投影
// ─────────────────────────────────────────────────────────────────────────────
function officeProjection() {
  const w = 1600, h = 1000;
  let b = sectionTitle("办公室是投影，不是调度器", "State → OfficeModel 是纯函数；没有数据就保持空闲，不为好看编造动作。");

  // state chips
  b += card(58, 150, 380, 700, { stroke: C.lineSoft });
  b += txt(84, 188, "State（唯一事实源）", { size: 16, weight: 800, fill: C.ink });
  const stateItems = ["agents", "runs", "todos", "approvals", "terminals", "delegations", "missionPlans", "events"];
  stateItems.forEach((s, i) => {
    const x = 84 + (i % 2) * 172, y = 214 + Math.floor(i / 2) * 48;
    b += rect(x, y, 158, 36, { rx: 8, fill: C.bg, stroke: C.lineSoft });
    b += txt(x + 79, y + 23, s, { size: 12, fill: C.slate, anchor: "middle", family: MONO });
  });
  b += arrow(248, 420, 248, 486, { color: C.blue, marker: "arrow-blue", width: 2.4 });
  b += txt(262, 458, "纯函数 model.ts（无 React）", { size: 11, fill: C.blue });
  b += rect(84, 500, 328, 148, { rx: 12, fill: C.bluePale, stroke: "#bfdbfe" });
  b += txt(104, 532, "OfficeModel", { size: 15, weight: 800, fill: C.blue });
  b += lines(104, 558, ["区域 / 工位 / 角色 / 姿态", "色调 / 主状态 / Inspector 路由", "不写库、不改主进程"], { size: 11.5, fill: C.slate, lh: 22 });

  // zones
  const zx = 476;
  b += card(zx, 150, 560, 700, { stroke: C.lineSoft });
  b += txt(zx + 24, 188, "区域 ↔ 状态字段", { size: 16, weight: 800, fill: C.ink });
  const zones = [
    ["经理室", "role=supervisor · Mission", "白板步骤 / 进度", C.purple],
    ["工位区", "active run / todo", "任务号 + 运行时长", C.blue],
    ["审批台", "approval · run.waiting_input", "琥珀灯 + 计数", C.amber],
    ["验收架", "todo.status=in_review", "紫色状态点", C.green],
    ["会议室", "missionState=plan_review", "主管走进去开会", C.cyan],
    ["茶歇区", "无 active run 的 idle", "沙发 / 空闲标签", C.slate],
    ["待命位", "窄屏收编 · 多余的角色", "底栏 / 待命", C.faint],
  ];
  zones.forEach(([z, src, out, color], i) => {
    const y = 212 + i * 86;
    b += rect(zx + 24, y, 512, 72, { rx: 10, fill: C.white, stroke: C.lineSoft });
    b += rect(zx + 24, y, 5, 72, { rx: 2.5, fill: color });
    b += txt(zx + 44, y + 29, z, { size: 13.5, weight: 750, fill: C.ink });
    b += txt(zx + 44, y + 52, src, { size: 10.5, fill: C.muted, family: MONO });
    b += txt(zx + 512, y + 40, out, { size: 11.5, fill: color, anchor: "end" });
  });

  // priority
  const px = 1084;
  b += card(px, 150, 458, 424, { stroke: "#fecaca", fill: C.white });
  b += txt(px + 24, 188, "一个 Agent 只显示一个主状态", { size: 14.5, weight: 800, fill: C.ink });
  const pri = [
    ["approval / waiting_input", "最优先：需要人", C.red],
    ["failed", "失败不能画成进行中", C.red],
    ["in_review", "等验收", C.amber],
    ["supervisor", "协调中", C.purple],
    ["running", "在执行", C.blue],
    ["queued", "等闸门", C.slate],
    ["idle", "空闲，去茶歇", C.faint],
  ];
  pri.forEach(([k, why, color], i) => {
    const y = 208 + i * 50;
    b += txt(px + 24, y + 22, k, { size: 11.5, fill: color, family: MONO, weight: 700 });
    b += txt(px + 434, y + 22, why, { size: 10.5, fill: C.muted, anchor: "end" });
    if (i < pri.length - 1) b += `<line x1="${px + 24}" y1="${y + 36}" x2="${px + 434}" y2="${y + 36}" stroke="${C.lineSoft}"/>`;
  });

  // three no
  b += card(px, 600, 458, 250, { stroke: C.lineSoft });
  b += txt(px + 24, 638, "三条硬规则", { size: 14.5, weight: 800, fill: C.ink });
  const rules = [
    ["不新建表", "舞台只读，不写主进程"],
    ["不伪造任务", "没 run 就空着"],
    ["操作只在 Inspector", "舞台点击只开抽屉"],
  ];
  rules.forEach(([k, d], i) => {
    const y = 672 + i * 56;
    b += rect(px + 24, y, 410, 44, { rx: 9, fill: C.bg, stroke: C.lineSoft });
    b += txt(px + 40, y + 27, k, { size: 12.5, weight: 750, fill: C.ink });
    b += txt(px + 418, y + 27, d, { size: 11, fill: C.muted, anchor: "end" });
  });

  // motion note
  b += rect(px, 878, 458, 74, { rx: 12, fill: C.bluePale, stroke: "#bfdbfe" });
  b += txt(px + 22, 906, "动效默认克制：只在外置位置变化时走位", { size: 12, weight: 750, fill: C.blue });
  b += txt(px + 22, 930, "cmh.office.motion = 克制 / 完整 / 关闭；刷新不表演", { size: 11, fill: C.slate });

  // projection arrow + note
  b += arrow(412, 574, 470, 574, { color: C.blue, marker: "arrow-blue", width: 2.4 });
  b += txt(428, 560, "投影", { size: 10.5, fill: C.blue, anchor: "middle" });
  b += rect(84, 700, 328, 108, { rx: 12, fill: C.amberPale, stroke: "#fde68a" });
  b += txt(104, 728, "不读它，就无法解释工位", { size: 12.5, weight: 750, fill: C.amber });
  b += lines(104, 752, ["舞台不是第二个事实源；", "所有动作都能落回一个 run。"], { size: 11, fill: "#92400e", lh: 20 });

  return svgDoc(w, h, b);
}

// fig 显式给编号：文章按「先动图、再实况、再映射、再配置」的顺序排
module.exports = {
  images: [
    { fig: 18, name: "cover", width: 1600, height: 900, svg: cover() },
    { fig: 22, name: "scene-layers", width: 1600, height: 1000, svg: sceneLayers() },
    { fig: 23, name: "carrier-mapping", width: 1600, height: 1000, svg: carrierMapping() },
    { fig: 27, name: "scene-matrix", width: 1600, height: 1000, svg: sceneMatrix() },
    { fig: 28, name: "office-projection", width: 1600, height: 1000, svg: officeProjection() },
    { fig: 32, name: "scene-dispatch", width: 1600, height: 1000, svg: sceneDispatch() },
  ],
};
