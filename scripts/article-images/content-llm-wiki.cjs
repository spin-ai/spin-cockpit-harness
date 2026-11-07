// 第三篇文章配图：封面 / 四层记忆 / Wiki 模型 / Dream 循环
// 由 render-llm-wiki.cjs 调用。
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

const C = {
  ink: "#0f172a", slate: "#475569", muted: "#64748b", faint: "#94a3b8",
  line: "#cbd5e1", lineSoft: "#e2e8f0", bg: "#f8fafc", white: "#ffffff",
  blue: "#2563eb", blueMid: "#3b82f6", blueSoft: "#dbeafe", bluePale: "#eff6ff",
  green: "#059669", greenMid: "#10b981", greenSoft: "#d1fae5", greenPale: "#ecfdf5",
  amber: "#d97706", amberMid: "#f59e0b", amberSoft: "#fef3c7", amberPale: "#fffbeb",
  red: "#dc2626", redSoft: "#fee2e2",
  purple: "#7c3aed", purpleSoft: "#ede9fe", purplePale: "#f5f3ff",
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
    `<radialGradient id="coverGlow" cx="0.74" cy="0.24" r="0.62"><stop offset="0" stop-color="#7c3aed" stop-opacity="0.34"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="coverGlow2" cx="0.66" cy="0.8" r="0.5"><stop offset="0" stop-color="#10b981" stop-opacity="0.18"/><stop offset="1" stop-color="#10b981" stop-opacity="0"/></radialGradient>`,
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
  b += `<rect width="${w}" height="${h}" fill="url(#coverGlow2)"/>`;
  for (let x = 0; x < w; x += 48) b += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#94a3b8" stroke-opacity="0.055"/>`;
  for (let y = 0; y < h; y += 48) b += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#94a3b8" stroke-opacity="0.055"/>`;

  b += `<line x1="96" y1="104" x2="130" y2="104" stroke="#a78bfa" stroke-width="2"/>`;
  b += txt(144, 110, "COCKPIT HARNESS · 第三篇", { size: 15, fill: "#a9b5cf", weight: 650, letter: 2.2 });
  b += txt(96, 212, "从多智能体终端", { size: 66, weight: 800, fill: "#e8eefc", letter: -2 });
  b += txt(96, 300, "到 LLM Wiki", { size: 78, weight: 800, fill: "#a5b4fc", letter: -2.4 });
  b += `<line x1="96" y1="360" x2="660" y2="360" stroke="#818cf8" stroke-opacity="0.5"/>`;
  b += lines(96, 410, [
    "记忆不是存储问题，是维护问题。",
    "四层：Transcripts → Notes → Wiki → Injected。",
    "再加一个后台循环：Dream。",
  ], { size: 23, fill: "#a9b9d6", lh: 40 });

  const chips = ["Source", "Page", "Citation", "Review", "Memory", "Dream"];
  let cx = 96, cy = 552;
  for (const c of chips) {
    const cw = 28 + c.length * 12;
    if (cx + cw > 870) { cx = 96; cy += 54; }
    b += rect(cx, cy, cw, 42, { rx: 21, fill: "rgba(15,23,42,0.55)", stroke: "rgba(148,163,184,0.28)" });
    b += txt(cx + cw / 2, cy + 27, c, { size: 14, fill: "#c7d6ef", anchor: "middle", family: c === "Dream" ? FONT : MONO });
    cx += cw + 12;
  }

  b += txt(96, 812, "Electron · React · SQLite · ACP · MCP", { size: 15, fill: "#7f91b2", letter: 0.6 });
  b += txt(96, 844, "github.com/spin-ai/spin-cockpit-harness", { size: 14, fill: "#6f83a5", family: MONO });

  // right: memory stack
  const px = 930, py = 120, pw = 560, ph = 660;
  b += rect(px, py, pw, ph, { rx: 22, fill: "rgba(10,17,31,0.74)", stroke: "rgba(148,163,184,0.24)" });
  b += rect(px + 1, py + 1, pw - 2, 44, { rx: 21, fill: "rgba(15,23,42,0.9)" });
  b += `<circle cx="${px + 22}" cy="${py + 23}" r="5" fill="#f87171"/><circle cx="${px + 40}" cy="${py + 23}" r="5" fill="#fbbf24"/><circle cx="${px + 58}" cy="${py + 23}" r="5" fill="#34d399"/>`;
  b += txt(px + 84, py + 28, "LLM Wiki · Memory", { size: 13, fill: "#8fa3c4", family: MONO });
  b += txt(px + pw - 18, py + 28, "4 layers", { size: 12, fill: "#a5b4fc", anchor: "end", family: MONO });

  const layer = (y, hh, tag, title, sub, color, fill) => {
    let s = rect(px + 22, y, pw - 44, hh, { rx: 12, fill, stroke: color, sw: 1.3 });
    s += txt(px + 42, y + 28, tag, { size: 11, weight: 800, fill: color, family: MONO, letter: 1.2 });
    s += txt(px + 86, y + 28, title, { size: 15, weight: 700, fill: "#e8eefc" });
    s += txt(px + 42, y + 54, sub, { size: 11.5, fill: "#9fb0cc", family: MONO });
    return s;
  };
  b += layer(py + 66, 108, "L4", "Injected Context", "wiki.memory ≤ 12k chars · every run", "#818cf8", "rgba(49,46,129,0.34)");
  b += layer(py + 188, 128, "L3", "Wiki Representations", "Pages + [[links]] + Citations + Review", "#60a5fa", "rgba(30,58,138,0.26)");
  b += layer(py + 330, 108, "L2", "Memory Notes", "summaries / rules / unverified guesses", "#fbbf24", "rgba(120,53,15,0.26)");
  b += layer(py + 452, 108, "L1", "Transcripts", "messages / runs / events", "#94a3b8", "rgba(51,65,85,0.42)");

  // sources strip
  b += rect(px + 22, py + 574, pw - 44, 54, { rx: 10, fill: "rgba(6,78,59,0.34)", stroke: "#34d399" });
  b += txt(px + 42, py + 600, "SOURCES", { size: 10.5, weight: 800, fill: "#6ee7b7", family: MONO, letter: 1.2 });
  b += txt(px + 130, py + 600, "fact anchor · text / markdown / url / local", { size: 11.5, fill: "#a7f3d0", family: MONO });

  // dream arrow
  b += `<line x1="${px - 26}" y1="${py + 560}" x2="${px - 26}" y2="${py + 180}" stroke="#a78bfa" stroke-width="2.2" stroke-dasharray="6 5" marker-end="url(#arrow-purple)"/>`;
  b += `<text x="${px - 38}" y="${py + 380}" font-family="${FONT}" font-size="12" font-weight="700" fill="#c4b5fd" text-anchor="middle" transform="rotate(-90 ${px - 38} ${py + 380})">DREAM</text>`;
  return svgDoc(w, h, b, C.dark);
}

// ─────────────────────────────────────────────────────────────────────────────
// 四层记忆
// ─────────────────────────────────────────────────────────────────────────────
function memoryLayers() {
  const w = 1600, h = 1000;
  let b = sectionTitle("四层记忆：顶层是目录，不是书", "Anthropic《The components of agent memory》的分层，落到本项目的具体实现。");

  const layers = [
    {
      y: 158, hh: 132, tag: "L4", name: "Injected Context", color: C.purple, soft: C.purplePale,
      desc: "每次会话预加载：wiki.memory ≤ 12k 字符", detail: "贵 · 必须小 · 错误会被带进每一次会话",
      impl: "wiki.memory / run prompt / Mission prompt",
    },
    {
      y: 316, hh: 152, tag: "L3", name: "Memory Representations · Wiki", color: C.blue, soft: C.bluePale,
      desc: "Page + [[链接]] + Citation + Revision + Review", detail: "地图，不是原文；有损但可导航",
      impl: "wiki_upsert_draft → 人审核 → reviewed",
    },
    {
      y: 494, hh: 132, tag: "L2", name: "Memory Notes", color: C.amber, soft: C.amberPale,
      desc: "摘要 / 规则 / 待验证的猜测", detail: "带观点、可能错、可以丢——当前最薄的一层",
      impl: "Source 摘要 / draft summary / run 结论",
    },
    {
      y: 652, hh: 122, tag: "L1", name: "Transcripts", color: C.slate, soft: "#f1f5f9",
      desc: "messages / runs / events", detail: "全量、便宜、不审核；Dream 的事实基准",
      impl: "SQLite：thread transcript + run 事件",
    },
  ];

  for (const l of layers) {
    b += card(72, l.y, 880, l.hh, { stroke: C.lineSoft });
    b += rect(72, l.y, 8, l.hh, { fill: l.color, rx: 4 });
    b += rect(96, l.y + 20, 52, 26, { rx: 8, fill: l.soft, stroke: l.color, sw: 1.2 });
    b += txt(122, l.y + 38, l.tag, { size: 12.5, weight: 800, fill: l.color, anchor: "middle", family: MONO });
    b += txt(166, l.y + 40, l.name, { size: 19, weight: 750, fill: C.ink });
    b += txt(96, l.y + 76, l.desc, { size: 13.5, fill: C.slate, family: MONO });
    b += txt(96, l.y + 102, l.detail, { size: 12, fill: C.muted });
    b += txt(932, l.y + 76, l.impl, { size: 11, fill: l.color, anchor: "end", family: MONO });
  }

  // sources base
  b += rect(72, 796, 880, 66, { rx: 12, fill: C.greenPale, stroke: "#a7f3d0" });
  b += txt(96, 824, "SOURCES", { size: 11, weight: 800, fill: C.green, family: MONO, letter: 1.2 });
  b += txt(190, 825, "事实源，不参与分层：text / Markdown / URL / 本地目录", { size: 13, fill: "#065f46" });
  b += txt(96, 846, "Page 的每个关键结论都应该能回到这里；没有 Source 的 Page 是可疑的。", { size: 11.5, fill: "#047857" });

  // dream panel
  const dx = 992, dy = 158, dw = 550;
  b += card(dx, dy, dw, 704, { fill: C.white, stroke: "#ddd6fe" });
  b += rect(dx, dy, dw, 56, { rx: 14, fill: C.purpleSoft });
  b += rect(dx, dy + 38, dw, 18, { fill: C.purpleSoft });
  b += txt(dx + 22, dy + 36, "Dreaming", { size: 19, weight: 800, fill: C.purple });
  b += txt(dx + dw - 22, dy + 36, "sleep-time compute", { size: 11, fill: "#7c3aed", anchor: "end", family: MONO });
  b += txt(dx + 22, dy + 88, "用后台算力在层之间搬运：", { size: 12.5, fill: C.muted });

  const jobs = [
    ["01", "校正", "拿 transcript / source 校验 note，改掉错的", C.red],
    ["02", "构建", "把散落笔记组织成页面 + 链接", C.blue],
    ["03", "补洞", "坏链接、缺失页面、索引", C.cyan],
    ["04", "晋升", "把稳定、重要的内容推到顶层", C.green],
    ["05", "剪枝", "细节下沉，只留链接，防止地图膨胀", C.amber],
  ];
  jobs.forEach(([n, name, desc, color], i) => {
    const y = dy + 112 + i * 92;
    b += rect(dx + 22, y, dw - 44, 74, { rx: 10, fill: C.bg, stroke: C.lineSoft });
    b += txt(dx + 38, y + 30, n, { size: 11, fill: C.faint, family: MONO });
    b += txt(dx + 74, y + 30, name, { size: 14.5, weight: 750, fill: color });
    b += txt(dx + 38, y + 56, desc, { size: 11.5, fill: C.muted });
  });

  b += rect(dx + 22, dy + 596, dw - 44, 84, { rx: 10, fill: C.purplePale, stroke: "#ddd6fe" });
  b += txt(dx + 38, dy + 624, "产物是提案，不是真相", { size: 13, weight: 750, fill: C.purple });
  b += txt(dx + 38, dy + 648, "issue / proposal / revision", { size: 11.5, fill: C.slate, family: MONO });
  b += txt(dx + 38, dy + 668, "不自动 reviewed；人只做接受 / 退回。", { size: 11, fill: C.muted });

  // arrows from dream to layers
  for (const l of layers) {
    b += arrow(dx - 6, l.y + l.hh / 2, 956, l.y + l.hh / 2, { color: "#a78bfa", marker: "arrow-purple", width: 1.8, dash: "5 4" });
  }

  // left rail
  b += `<line x1="46" y1="820" x2="46" y2="180" stroke="#a78bfa" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#arrow-purple)"/>`;
  b += `<text x="30" y="520" font-family="${FONT}" font-size="12" font-weight="700" fill="#7c3aed" text-anchor="middle" transform="rotate(-90 30 520)">晋升 / 下沉</text>`;

  b += txt(72, 914, "取舍：顶层只放“知道有什么”，细节一律下沉；否则每轮都在为完整付租金。", { size: 13, fill: C.muted });
  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiki 模型
// ─────────────────────────────────────────────────────────────────────────────
function wikiModel() {
  const w = 1600, h = 1000;
  let b = sectionTitle("五个对象：Source / Page / Citation / Revision / Review", "Page 是派生知识，Source 是事实源；Review 是状态，不是弹窗。");

  // Source
  b += card(58, 210, 300, 300, { stroke: C.lineSoft });
  b += rect(58, 210, 300, 56, { rx: 14, fill: C.greenPale });
  b += rect(58, 248, 300, 18, { fill: C.greenPale });
  b += txt(80, 246, "Source", { size: 18, weight: 800, fill: C.green });
  b += txt(80, 292, "原始资料", { size: 11, fill: C.muted, letter: 1 });
  b += lines(80, 328, ["text / markdown / url / local", "content + hash", "uri 去重"], { size: 12, fill: C.slate, family: MONO, lh: 26 });
  b += rect(80, 420, 256, 62, { rx: 9, fill: C.bg, stroke: C.lineSoft });
  b += txt(96, 446, "事实源 · 不可信数据", { size: 12, weight: 700, fill: C.slate });
  b += txt(96, 468, "读的时候当数据，不当指令", { size: 11, fill: C.muted });

  // Page
  b += card(470, 180, 360, 340, { stroke: C.blue, sw: 1.6 });
  b += rect(470, 180, 360, 56, { rx: 14, fill: C.bluePale });
  b += rect(470, 218, 360, 18, { fill: C.bluePale });
  b += txt(492, 216, "Page", { size: 18, weight: 800, fill: C.blue });
  b += pill(726, 196, 80, 24, "draft", { fill: C.amberSoft, color: C.amber, size: 11 });
  b += txt(492, 264, "title / slug / summary", { size: 12, fill: C.slate, family: MONO });
  b += txt(492, 288, "content（Markdown）", { size: 12, fill: C.slate, family: MONO });
  b += txt(492, 312, "status：draft | reviewed | stale", { size: 12, fill: C.slate, family: MONO });
  b += txt(492, 336, "confidence：low | medium | high", { size: 12, fill: C.slate, family: MONO });
  b += txt(492, 372, "[[页面链接]] → backlinks + graph", { size: 11.5, fill: C.blue, family: MONO });
  b += rect(492, 396, 316, 2, { fill: C.lineSoft });
  b += txt(492, 424, "页面身份不依赖文件路径", { size: 11.5, fill: C.muted });
  b += txt(492, 450, "正文写作由人 / Agent 共同完成", { size: 11.5, fill: C.muted });
  b += txt(492, 480, "Agent 只能写 draft", { size: 12, fill: C.red, weight: 700 });

  // Citation
  b += arrow(364, 330, 464, 330, { color: C.green, marker: "arrow-green", width: 2.4 });
  b += txt(414, 316, "Citation", { size: 11, fill: C.green, anchor: "middle", family: MONO });
  b += txt(414, 350, "quote / locator", { size: 10.5, fill: C.muted, anchor: "middle" });

  // Revision
  b += card(470, 540, 360, 96, { fill: C.bg, stroke: C.lineSoft });
  b += txt(492, 570, "Revision", { size: 15, weight: 750, fill: C.slate });
  b += txt(492, 594, "content + status + reason", { size: 11.5, fill: C.slate, family: MONO });
  b += txt(492, 616, "每次写入 / review 追加 · 保留 300 条 · 可回滚", { size: 10.5, fill: C.muted });
  b += arrow(650, 520, 650, 536, { color: C.slate, marker: "arrow-slate", width: 1.6, dash: "5 4" });
  b += txt(668, 538, "保留旧版本", { size: 10.5, fill: C.muted });

  // Review
  b += card(886, 210, 260, 300, { stroke: "#a7f3d0" });
  b += rect(886, 210, 260, 56, { rx: 14, fill: C.greenPale });
  b += rect(886, 248, 260, 18, { fill: C.greenPale });
  b += txt(908, 246, "Review", { size: 18, weight: 800, fill: C.green });
  b += txt(908, 292, "人决定这一步", { size: 11, fill: C.muted, letter: 1 });
  b += lines(908, 326, ["接受 → reviewed", "退回 → draft + feedback", "每次审核写 review + revision"], { size: 11.5, fill: C.slate, lh: 30 });
  b += pill(908, 420, 96, 30, "draft", { fill: C.amberSoft, color: C.amber, size: 12 });
  b += arrow(1010, 435, 1042, 435, { color: C.green, marker: "arrow-green" });
  b += pill(1050, 420, 76, 30, "reviewed", { fill: C.greenSoft, color: C.green, size: 12 });

  b += arrow(836, 330, 882, 330, { color: C.slate, marker: "arrow-slate", width: 2 });
  b += txt(858, 316, "审核", { size: 10.5, fill: C.muted, anchor: "middle" });

  // Memory
  b += card(1190, 210, 350, 300, { fill: C.purplePale, stroke: "#ddd6fe" });
  b += rect(1190, 210, 350, 56, { rx: 14, fill: C.purpleSoft });
  b += rect(1190, 248, 350, 18, { fill: C.purpleSoft });
  b += txt(1212, 246, "Memory", { size: 18, weight: 800, fill: C.purple });
  b += txt(1212, 292, "顶层索引 · ≤ 12k chars", { size: 11, fill: C.muted, letter: 1 });
  b += lines(1212, 326, ["reviewed 优先", "有 citation 优先", "最近更新优先", "标题 + 220 字摘要"], { size: 11.5, fill: C.slate, lh: 26 });
  b += txt(1212, 450, "每次 run 注入", { size: 12, weight: 700, fill: C.purple });
  b += txt(1212, 474, "详情用 search / read_page 下钻", { size: 11, fill: C.muted });
  b += arrow(1140, 360, 1186, 360, { color: C.purple, marker: "arrow-purple", width: 2 });

  // state cycle
  b += rect(58, 655, 1484, 105, { rx: 14, fill: C.white, stroke: C.lineSoft });
  b += txt(80, 687, "状态机", { size: 13, weight: 750, fill: C.slate });
  b += pill(180, 667, 110, 34, "draft", { fill: C.amberSoft, color: C.amber, size: 13, weight: 700 });
  b += arrow(296, 684, 356, 684, { color: C.green, marker: "arrow-green" });
  b += txt(326, 669, "接受", { size: 10, fill: C.muted, anchor: "middle" });
  b += pill(362, 667, 128, 34, "reviewed", { fill: C.greenSoft, color: C.green, size: 13, weight: 700 });
  b += arrow(496, 684, 556, 684, { color: C.red, marker: "arrow-red", dash: "5 4" });
  b += txt(526, 669, "source 变", { size: 10, fill: C.muted, anchor: "middle" });
  b += pill(562, 667, 100, 34, "stale", { fill: C.redSoft, color: C.red, size: 13, weight: 700 });
  b += path("M662,701 C720,745 420,745 235,715", { color: C.amber, marker: "arrow-amber", dash: "5 4" });
  b += txt(700, 737, "重新整理", { size: 10.5, fill: C.amber });
  b += txt(820, 715, "Agent 写入 → 一律 draft；reviewed 需要人重新确认。", { size: 12, fill: C.muted });

  // bottom notes
  b += rect(58, 780, 1484, 64, { rx: 14, fill: C.greenPale, stroke: "#a7f3d0" });
  b += txt(80, 806, "Source 是事实，Page 是派生。", { size: 14, weight: 750, fill: "#065f46" });
  b += txt(80, 830, "没有 citation 的页面不是“知识”，只是一段文本；Dream 会先把它们标出来。", { size: 12, fill: "#047857" });

  b += rect(58, 856, 1484, 64, { rx: 14, fill: C.amberPale, stroke: "#fde68a" });
  b += txt(80, 882, "诚实标注：当前 upsertDraft 会把 reviewed 页面降级为 draft（旧内容进 revision），", { size: 13, fill: "#92400e", weight: 650 });
  b += txt(80, 906, "更严格的“reviewed 只接受 patch 提案”还没做。", { size: 12, fill: "#a16207" });
  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dream 循环
// ─────────────────────────────────────────────────────────────────────────────
function dreamLoop() {
  const w = 1600, h = 1000;
  let b = sectionTitle("Dream：把维护做成后台循环", "输入事实，产出提案；人负责接受，系统负责可回滚。");

  const box = (x, y, bw, bh, title, sub, color, soft) => {
    let s = card(x, y, bw, bh, { stroke: C.lineSoft });
    s += rect(x, y, bw, 46, { rx: 14, fill: soft });
    s += rect(x, y + 30, bw, 16, { fill: soft });
    s += txt(x + 18, y + 30, title, { size: 14.5, weight: 750, fill: color });
    s += txt(x + 18, y + 70, sub, { size: 11.5, fill: C.muted });
    return s;
  };

  // inputs
  b += box(58, 170, 300, 210, "输入 · 事实", "最近 N 个 run / source / 现有页面", C.slate, "#f1f5f9");
  b += lines(78, 268, ["• transcripts（messages / runs）", "• sources（带 citation）", "• pages + revisions", "• 上次 dream 的 issue"], { size: 11.5, fill: C.slate, lh: 24 });

  // dream
  b += card(430, 150, 380, 500, { stroke: "#ddd6fe", fill: C.white });
  b += rect(430, 150, 380, 60, { rx: 14, fill: C.purpleSoft });
  b += rect(430, 192, 380, 18, { fill: C.purpleSoft });
  b += txt(452, 188, "Dream", { size: 20, weight: 800, fill: C.purple });
  b += txt(680, 188, "sleep-time compute", { size: 11, fill: C.purple, anchor: "end", family: MONO });

  const jobs = [
    ["校正", "claim 对回 source，改错", C.red],
    ["构建", "笔记 → 页面 + 链接", C.blue],
    ["补洞", "坏链接 / 缺页 / 索引", C.cyan],
    ["晋升", "稳定内容 → Memory 顶层", C.green],
    ["剪枝", "细节下沉，留链接", C.amber],
  ];
  jobs.forEach(([name, desc, color], i) => {
    const y = 232 + i * 76;
    b += rect(452, y, 336, 62, { rx: 9, fill: C.bg, stroke: C.lineSoft });
    b += txt(468, y + 26, `0${i + 1}`, { size: 10.5, fill: C.faint, family: MONO });
    b += txt(502, y + 26, name, { size: 13.5, weight: 750, fill: color });
    b += txt(466, y + 48, desc, { size: 11, fill: C.muted });
  });

  // proposals
  b += box(870, 170, 300, 210, "输出 · 提案", "issue / proposal / revision + diff", C.blue, C.bluePale);
  b += lines(890, 268, ["• 缺 citation / 过期 draft", "• 重复页面 / 坏链接", "• 带 diff 的修改提案", "• 新 Memory 索引"], { size: 11.5, fill: C.slate, lh: 24 });

  // human
  b += box(870, 430, 300, 220, "人 · 审核", "接受 / 退回（附理由）", C.green, C.greenPale);
  b += lines(890, 528, ["• 看 diff，不看“已整理”", "• 接受 → reviewed", "• 退回 → 保留原状", "• 每次都留 review + revision"], { size: 11.5, fill: C.slate, lh: 24 });

  // result
  b += box(1230, 170, 310, 210, "结果 · 可查", "Wiki + Memory 更新", C.purple, C.purpleSoft);
  b += lines(1250, 268, ["• reviewed 页面", "• revision 历史", "• ≤ 12k 的 Memory", "• 下次 run 自动注入"], { size: 11.5, fill: C.slate, lh: 24 });

  // next session
  b += box(1230, 430, 310, 220, "下一次会话", "顶层小索引 + 按需下钻", C.amber, C.amberSoft);
  b += lines(1250, 528, ["• 先读 Memory", "• 需要细节再 search", "• 需要事实再读 source", "• 新事实回流到 transcript"], { size: 11.5, fill: C.slate, lh: 24 });

  // arrows
  b += arrow(362, 275, 426, 275, { color: C.purple, marker: "arrow-purple", width: 2.4 });
  b += txt(394, 260, "读取", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += arrow(814, 300, 866, 275, { color: C.blue, marker: "arrow-blue", width: 2.4 });
  b += txt(840, 260, "提案", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += arrow(1018, 384, 1018, 426, { color: C.green, marker: "arrow-green", width: 2.4 });
  b += txt(1036, 410, "审核", { size: 10.5, fill: C.muted });
  b += arrow(1174, 275, 1226, 275, { color: C.purple, marker: "arrow-purple", width: 2.4 });
  b += txt(1200, 260, "应用", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += arrow(1174, 540, 1226, 540, { color: C.amber, marker: "arrow-amber", width: 2.4 });
  b += txt(1200, 525, "注入", { size: 10.5, fill: C.muted, anchor: "middle" });
  b += path("M1386,654 C1386,790 200,790 200,392", { color: C.amber, marker: "arrow-amber", width: 2, dash: "6 5" });
  b += txt(780, 776, "下一次 run 产生新 transcript → 回流", { size: 11.5, fill: C.muted, anchor: "middle" });

  // guardrails
  b += rect(58, 800, 1484, 132, { rx: 16, fill: C.white, stroke: C.lineSoft });
  b += badgeLabel(78, 824, "硬约束", C.red);
  const rules = [
    ["不自动 reviewed", "Dream 只能提交提案"],
    ["必须带 diff", "不接受“已整理”这种输出"],
    ["必须能回 source", "不允许凭空生成 citation"],
    ["幂等 + 预算", "重复跑不产生重复提案"],
    ["有节奏", "不每轮都 dream"],
    ["可审计", "谁 / 何时 / 基于什么 / 改了什么"],
  ];
  rules.forEach(([t, d], i) => {
    const x = 78 + (i % 3) * 486, y = 868 + Math.floor(i / 3) * 38;
    b += txt(x, y, `• ${t}`, { size: 12, weight: 750, fill: C.ink });
    b += txt(x + 150, y, d, { size: 11, fill: C.muted });
  });
  return svgDoc(w, h, b);
}

module.exports = {
  images: [
    { name: "cover", width: 1600, height: 900, svg: cover() },
    { name: "memory-layers", width: 1600, height: 1000, svg: memoryLayers() },
    { name: "wiki-model", width: 1600, height: 1000, svg: wikiModel() },
    { name: "dream-loop", width: 1600, height: 1000, svg: dreamLoop() },
  ],
};
