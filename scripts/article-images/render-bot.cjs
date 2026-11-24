// 渲染第五篇文章（人格 Bot）的配图：bot-01 .. bot-04
// 用法：npx electron scripts/article-images/render-bot.cjs
// 输出：docs/assets/article/bot-0N-<name>.{svg,png}（1600×1000，PNG 为 2× 截图）
// 原则：给不看代码的人也能看懂。少术语，多「他能干什么 / 代价是什么」。
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";
const OUT = path.resolve(__dirname, "../../docs/assets/article");
const SCALE = 2;

const C = {
  bg: "#f8fafc",
  ink: "#0f172a",
  ink2: "#334155",
  mute: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  white: "#ffffff",
  dark: "#0b1220",
  blue: "#2563eb",
  green: "#059669",
  amber: "#d97706",
  red: "#dc2626",
  purple: "#7c3aed",
  soft: { blue: "#eff6ff", green: "#ecfdf5", amber: "#fffbeb", red: "#fef2f2", purple: "#f5f3ff", slate: "#f1f5f9" },
  edge: { blue: "#bfdbfe", green: "#a7f3d0", amber: "#fde68a", red: "#fecaca", purple: "#ddd6fe", slate: "#e2e8f0" },
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (x, y, t, o = {}) => {
  const { size = 16, fill = C.ink, weight = 600, anchor = "start", mono = false, opacity = 1, ls = 0 } = o;
  return `<text x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${ls}">${esc(t)}</text>`;
};

const lines = (x, y, arr, o = {}) => {
  const { lh = 24, ...rest } = o;
  return arr.map((t, i) => text(x, y + i * lh, t, rest)).join("");
};

const rect = (x, y, w, h, o = {}) => {
  const { rx = 16, fill = C.white, stroke = C.line, sw = 1.2, dash = null, opacity = 1, filter = null } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""} opacity="${opacity}"${filter ? ` filter="url(#${filter})"` : ""}/>`;
};

const line = (x1, y1, x2, y2, o = {}) => {
  const { color = C.line, sw = 1.2, dash = null, arrow = null, opacity = 1 } = o;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}${arrow ? ` marker-end="url(#arrow-${arrow})"` : ""} opacity="${opacity}"/>`;
};

const defs = () => `
<defs>
  ${[["slate", "#475569"], ["blue", C.blue], ["green", C.green], ["amber", C.amber], ["red", C.red], ["purple", C.purple], ["faint", "#cbd5e1"]]
    .map(([id, color]) => `<marker id="arrow-${id}" markerWidth="10" markerHeight="10" refX="8.5" refY="3.2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6.4 L9,3.2 z" fill="${color}"/></marker>`)
    .join("")}
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.10"/></filter>
</defs>`;

const svg = (inner, { w = 1600, h = 1000, bg = C.bg } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs()}<rect width="${w}" height="${h}" fill="${bg}"/>${inner}</svg>`;

const head = (title, sub) => text(58, 70, title, { size: 34, weight: 750 }) + text(58, 106, sub, { size: 17, weight: 400, fill: C.mute });

/* ------------------------------------------- 图 01：给新同事配五样东西（封面） */

function fiveThings() {
  const s = [];
  s.push(`<rect width="1600" height="1000" fill="${C.dark}"/>`);
  for (let x = 0; x <= 1600; x += 80) s.push(line(x, 0, x, 1000, { color: "#16233a", sw: 1, opacity: 0.55 }));
  for (let y = 0; y <= 1000; y += 80) s.push(line(0, y, 1600, y, { color: "#16233a", sw: 1, opacity: 0.55 }));
  s.push(`<circle cx="1350" cy="140" r="230" fill="#1d4ed8" opacity="0.12"/>`);

  s.push(text(60, 132, "Bot 是什么？给新同事配五样东西", { size: 52, weight: 800, fill: "#f8fafc" }));
  s.push(text(62, 176, "少一样，他就不是同事，只是个聊天框。", { size: 21, weight: 400, fill: "#93a4c4" }));

  const cards = [
    { n: "1", name: "工牌", who: "他是谁", items: ["管哪摊事", "怎么说话", "什么不做"], tone: "blue" },
    { n: "2", name: "笔记本", who: "他记得什么", items: ["你翻得开", "记错能改", "换公司能带走"], tone: "green" },
    { n: "3", name: "手", who: "他真能干什么", items: ["查资料、调接口", "会点网页", "会敲命令"], tone: "amber" },
    { n: "4", name: "闹钟", who: "什么时候自己动", items: ["到点提醒", "有事才找你", "更重要的是：什么时候闭嘴"], tone: "purple" },
    { n: "5", name: "工作日志", who: "为什么这么做", items: ["为什么说了这句", "为什么没说", "花了多少钱"], tone: "red" },
  ];
  cards.forEach((c, i) => {
    const x = 60 + i * 302;
    const y = 250;
    s.push(rect(x, y, 272, 380, { rx: 18, fill: "#111c30", stroke: "#24334d" }));
    s.push(text(x + 22, y + 44, c.n, { size: 14, weight: 800, mono: true, fill: C[c.tone] }));
    s.push(text(x + 46, y + 44, c.name, { size: 26, weight: 800, fill: "#f1f5f9" }));
    s.push(text(x + 22, y + 76, c.who, { size: 13, weight: 400, fill: "#93a4c4" }));
    s.push(line(x + 22, y + 96, x + 250, y + 96, { color: "#24334d", sw: 1 }));
    c.items.forEach((t, j) => {
      s.push(`<circle cx="${x + 28}" cy="${y + 130 + j * 46}" r="3" fill="${C[c.tone]}"/>`);
      s.push(text(x + 42, y + 136 + j * 46, t, { size: 13.5, weight: 400, fill: "#cbd5e1" }));
    });
    s.push(rect(x + 18, y + 300, 236, 56, { rx: 10, fill: "#0b1220", stroke: "#24334d" }));
    const hint = { "1": ["好改才不漂", "人格写成字段才能对比"], "2": ["最容易做假的一格", "看不见就等于没有"], "3": ["越往下本事越大", "也越危险"], "4": ["最容易做烦的一格", "会说话不等于该说话"], "5": ["我这次补的", "记的是权责，不是配置"] }[c.n];
    s.push(text(x + 32, y + 324, hint[0], { size: 12, weight: 650, fill: C[c.tone] }));
    s.push(text(x + 32, y + 344, hint[1], { size: 12, weight: 400, fill: "#64748b" }));
  });

  s.push(rect(60, 676, 1480, 150, { rx: 18, fill: "#0e1a2c", stroke: "#24334d" }));
  s.push(text(88, 716, "那四家在比什么？", { size: 18, weight: 750, fill: "#dbeafe" }));
  s.push(
    lines(88, 750, [
      "比的是「手」和「笔记本」：Grok Bot 有一台真电脑，所以没有接口的网站也能点；Orca 住在你自己的文件夹里；",
      "Rakazo 有一个沙箱和 94 个工具；我这边手最少——只会看，动手要人点一下。",
    ], { size: 14.5, weight: 400, fill: "#cbd5e1", lh: 26 }),
  );
  s.push(text(88, 806, "第五样（工作日志）是分水岭：没有它，bot 半夜发消息你查不出为什么。", { size: 14.5, weight: 650, fill: "#7dd3fc" }));

  s.push(text(60, 890, "下面每一节，都在验这五样里的一样。", { size: 17, weight: 600, fill: "#e2e8f0" }));
  s.push(text(60, 944, "对照源码 rakazo @ 8fba288（Apache-2.0）· orca @ 8e0c267e（MIT）· Grok Bot 闭源，口径见文末", { size: 12.5, weight: 400, fill: "#64748b", mono: true }));
  return svg(s.join(""), { bg: C.dark });
}

/* ----------------------------------------------- 图 02：三样只能选两样 */

function tradeoff() {
  const s = [head("想让它什么都能干，就得接受点别的", "本事大 / 分得清 / 不费劲——同时要三样，现在没人做到。")];

  const A = { x: 470, y: 226 };
  const B = { x: 200, y: 716 };
  const D = { x: 740, y: 716 };
  const CX = (A.x + B.x + D.x) / 3;
  const CY = (A.y + B.y + D.y) / 3;

  s.push(`<polygon points="${A.x},${A.y} ${B.x},${B.y} ${D.x},${D.y}" fill="#eef2f8" stroke="#cbd5e1" stroke-width="1.6"/>`);

  const node = (p, w2, title, sub, tone) =>
    rect(p.x - w2 / 2, p.y - 46, w2, 92, { rx: 46, fill: C.white, stroke: C[tone], sw: 1.8, filter: "shadow" }) +
    text(p.x, p.y - 8, title, { size: 20, weight: 750, anchor: "middle" }) +
    text(p.x, p.y + 20, sub, { size: 12.5, weight: 400, fill: C.mute, anchor: "middle" });

  s.push(node(A, 220, "本事大", "真能干活：没接口也能点", "blue"));
  s.push(node(B, 220, "分得清", "出了事查得到是谁", "green"));
  s.push(node(D, 220, "不费劲", "装上就用，不用维护", "amber"));

  s.push(text(CX, CY + 4, "三样都要", { size: 20, weight: 750, anchor: "middle", fill: C.ink2 }));
  s.push(text(CX, CY + 32, "现在付不起", { size: 13, weight: 400, anchor: "middle", fill: C.mute }));

  const rows = [
    { name: "Grok Bot", pick: "本事大 + 不费劲", cost: "所有 Bot 共用一台电脑，一个 Bot 登录过的网站其他也登着；不能选模型、也看不到用了哪个", tone: "blue" },
    { name: "Orca", pick: "本事大 + 分得清", cost: "装在你自己的机器上；得会装、会管；没有托管可用性", tone: "green" },
    { name: "Rakazo", pick: "本事大 + 分得清", cost: "要自己搭服务器、跑 Docker、备份；运维最重", tone: "purple" },
    { name: "我写的这个", pick: "分得清 + 不费劲", cost: "自己的手只会看；真动手要建任务、起 run、等它跑——慢且绕", tone: "amber" },
  ];
  const X = 880;
  s.push(rect(X, 168, 660, 64, { rx: 12, fill: C.soft.slate, stroke: C.line }));
  s.push(text(X + 20, 198, "四家各自选了什么", { size: 16, weight: 750 }));
  s.push(text(X + 20, 220, "右边是代价，不是缺点", { size: 12.5, weight: 400, fill: C.mute }));

  rows.forEach((r, i) => {
    const y = 252 + i * 152;
    s.push(rect(X, y, 660, 132, { rx: 14, fill: C.white, stroke: C.edge[r.tone], sw: 1.2 }));
    s.push(rect(X, y, 6, 132, { rx: 3, fill: C[r.tone], stroke: C[r.tone], sw: 0 }));
    s.push(text(X + 26, y + 34, r.name, { size: 18, weight: 750 }));
    s.push(text(X + 26, y + 62, r.pick, { size: 13.5, weight: 650, fill: C[r.tone] }));
    s.push(text(X + 26, y + 94, r.cost, { size: 12.5, weight: 400, fill: C.mute }));
  });

  s.push(rect(58, 852, 762, 104, { rx: 14, fill: C.soft.blue, stroke: C.edge.blue }));
  s.push(text(80, 886, "为什么「分得清」和「一起干活」总是打架", { size: 15.5, weight: 750, fill: "#1d4ed8" }));
  s.push(
    lines(80, 914, [
      "Grok Bot 的几个 Bot 能接力干同一件事，正因为它们共用登录状态和文件；",
      "一旦每个 Bot 分开，每个都得重新登录一遍你所有应用——省下的麻烦全还回去了。",
    ], { size: 13, weight: 400, fill: "#1e40af", lh: 22 }),
  );
  return svg(s.join(""));
}

/* ------------------------------------------------- 图 03：四家的「手」 */

function hands() {
  const s = [head("四家的手：能看到什么，能碰到什么", "同一个问题「帮我看看这个是不是坏了」，四家能做的事完全不一样。")];

  const cols = [
    {
      name: "Grok Bot",
      tone: "blue",
      rows: [
        ["能", "二十多个现成接口"],
        ["能", "一个完整的浏览器"],
        ["能", "一台真电脑的命令行"],
      ],
      foot: ["没有接口的网站也能干", "代价：电脑是大家共用的"],
    },
    {
      name: "Orca",
      tone: "green",
      rows: [
        ["能", "gh、slack 这类命令"],
        ["不用", "不需要点网页"],
        ["能", "你自己机器上的终端"],
      ],
      foot: ["活在你机器上，看得见摸得着", "代价：装、配、自己维护"],
    },
    {
      name: "Rakazo",
      tone: "purple",
      rows: [
        ["能", "94 个内置工具"],
        ["能", "浏览器自动化"],
        ["能", "沙箱电脑，还能接手你的电脑"],
      ],
      foot: ["手最全，能替你操作电脑", "代价：服务器 + Docker"],
    },
    {
      name: "我写的这个",
      tone: "amber",
      rows: [
        ["能", "看：文件 / git / 日志 / 台账"],
        ["绕一下", "自己没浏览器；起 run 才有"],
        ["绕一下", "自己没终端；交个工作区再起 run"],
      ],
      foot: ["手是借来的", "代价：慢、绕、要审批"],
    },
  ];

  const x0 = 60;
  const colW = (1600 - 120) / 4;
  const y0 = 170;
  cols.forEach((c, i) => {
    const x = x0 + i * colW;
    s.push(rect(x, y0, colW - 22, 640, { rx: 16, fill: C.white, stroke: C.edge[c.tone], sw: 1.4 }));
    s.push(text(x + 22, y0 + 44, c.name, { size: 21, weight: 800, fill: C[c.tone] }));
    s.push(line(x + 22, y0 + 64, x + colW - 44, y0 + 64, { color: C.line, sw: 1 }));
    c.rows.forEach(([mark, t], j) => {
      const y = y0 + 100 + j * 140;
      const tone = mark === "能" ? "green" : mark === "不能" ? "red" : mark === "不用" ? "slate" : "amber";
      const label = mark === "能" ? "能做" : mark === "不能" ? "做不了" : mark === "不用" ? "用不上" : "只能绕一下";
      s.push(rect(x + 22, y, colW - 66, 30, { rx: 15, fill: C.soft[tone], stroke: C.edge[tone], sw: 1 }));
      s.push(text(x + 38, y + 21, label, { size: 12, weight: 700, fill: C[tone] }));
      s.push(`<foreignObject x="${x + 22}" y="${y + 40}" width="${colW - 70}" height="80"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:${FONT};font-size:13.5px;line-height:1.5;color:#334155">${esc(t)}</div></foreignObject>`);
    });
    s.push(line(x + 22, y0 + 540, x + colW - 44, y0 + 540, { color: C.line, sw: 1, dash: "4 4" }));
    s.push(text(x + 22, y0 + 570, c.foot[0], { size: 13, weight: 650, fill: C.ink2 }));
    s.push(text(x + 22, y0 + 596, c.foot[1], { size: 12.5, weight: 400, fill: C.mute }));
  });

  s.push(rect(60, 846, 1480, 112, { rx: 14, fill: C.soft.blue, stroke: C.edge.blue }));
  s.push(text(82, 880, "Grok Bot 自己的说法，比任何评测都直白", { size: 15, weight: 750, fill: "#1d4ed8" }));
  s.push(
    lines(82, 908, [
      "「你的所有 Bot 共享一台分配给你账号的云端电脑……屏幕是分开的工作界面，不是分开的安全边界。」",
      "—— 所以：一个 Bot 登录过的网站，其他 Bot 也登着；严格隔离的是不同用户之间。",
    ], { size: 13, weight: 400, fill: "#1e40af", lh: 24 }),
  );
  return svg(s.join(""));
}

/* ------------------------------------- 图 04：我这边：能看到 / 提方案 / 你签字 */

function signoff() {
  const s = [head("我这边是怎么防的：能看到、能提议、但签字是你的", "它像实习生：可以看资料、写方案、记笔记，但不能自己批自己。")];

  const cols = [
    { name: "它能看", tone: "green", items: ["项目里的文件（带行号）", "git 改了什么", "上次运行为什么失败", "你以前说过的事、定过的决定"], foot: "答案要能指出「第几行」" },
    { name: "它能提议", tone: "blue", items: ["建一条任务（默认不跑）", "改任务的状态 / 负责人 / 验收标准", "给在跑的 worker 发话（纠偏）", "写自己的笔记本、提一条日程"], foot: "每笔都留记录，能查是谁改的" },
    { name: "只有你能定", tone: "red", items: ["确认完成 / 取消任务", "批准一次运行", "改文件、改设置、装插件", "让它直接敲任意命令"], foot: "这几件事根本不在它的按钮里" },
  ];
  const x0 = 60;
  const colW = 470;
  cols.forEach((c, i) => {
    const x = x0 + i * (colW + 35);
    s.push(rect(x, 170, colW, 470, { rx: 16, fill: C.white, stroke: C.edge[c.tone], sw: 1.4 }));
    s.push(rect(x, 170, colW, 64, { rx: 16, fill: C.soft[c.tone], stroke: C.edge[c.tone], sw: 1 }));
    s.push(text(x + 24, 210, c.name, { size: 20, weight: 800, fill: C[c.tone] }));
    c.items.forEach((t, j) => {
      s.push(`<circle cx="${x + 32}" cy="${254 + j * 62}" r="4" fill="${C[c.tone]}"/>`);
      s.push(`<foreignObject x="${x + 46}" y="${244 + j * 62}" width="${colW - 70}" height="50"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:${FONT};font-size:13.5px;line-height:1.5;color:#334155">${esc(t)}</div></foreignObject>`);
    });
    s.push(line(x + 24, 560, x + colW - 24, 560, { color: C.line, sw: 1, dash: "4 4" }));
    s.push(text(x + 24, 590, c.foot, { size: 12.5, weight: 650, fill: C[c.tone] }));
    if (i < cols.length - 1) {
      s.push(line(x + colW + 4, 400, x + colW + 30, 400, { color: C.faint, sw: 2, arrow: "faint" }));
    }
  });

  s.push(rect(60, 676, 700, 250, { rx: 14, fill: C.dark, stroke: "#24334d" }));
  s.push(text(84, 712, "一个我修过的真 bug", { size: 16, weight: 750, fill: "#e2e8f0" }));
  s.push(
    lines(84, 744, [
      "「手动让它跑一次」这个按钮，一开始我把所有限制都跳过了。",
      "结果是：点一下就把每小时配额用光——预算等于装饰。",
      "",
      "现在的规则：手动只放行「别吵我」和「刚说过话，缓一缓」；",
      "次数和花费，谁点都不放行。",
    ], { size: 13, weight: 400, fill: "#cbd5e1", lh: 26 }),
  );

  s.push(rect(790, 676, 750, 250, { rx: 14, fill: C.white, stroke: C.line }));
  s.push(text(814, 712, "所以一句话总结这件事", { size: 16, weight: 750 }));
  s.push(
    lines(814, 746, [
      "bot 不能自己验收自己的活。",
      "",
      "只要「确认完成」永远在你手里，前面那些「自己写笔记、自己建任务」",
      "就可以放心放开——它们都还只是提案，不是结论。",
    ], { size: 13.5, weight: 400, fill: C.ink2, lh: 26 }),
  );
  s.push(text(814, 892, "人当签字人，不是人当保姆。", { size: 14, weight: 700, fill: C.blue }));
  return svg(s.join(""));
}

/* ------------------------------------------------------------------ 渲染 */

const images = [
  { name: "five-things", svg: fiveThings(), width: 1600, height: 1000, dark: true },
  { name: "tradeoff", svg: tradeoff(), width: 1600, height: 1000 },
  { name: "hands", svg: hands(), width: 1600, height: 1000 },
  { name: "signoff", svg: signoff(), width: 1600, height: 1000 },
];

const badgeHtml = (fig, theme) =>
  `<div class="figbadge ${theme}"><span class="fig">图</span><span class="n">${fig}</span></div>`;

const htmlShell = (inner, w, h, badge) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${w * SCALE}px;height:${h * SCALE}px;overflow:hidden;background:#fff}
  .shot{position:relative;width:${w}px;height:${h}px;transform:scale(${SCALE});transform-origin:top left;overflow:hidden}
  .figbadge{position:absolute;top:24px;right:24px;z-index:9;display:flex;align-items:center;gap:8px;padding:7px 13px;border-radius:999px;
    font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:.6px;box-shadow:0 8px 24px rgba(15,23,42,.14)}
  .figbadge.light{background:#fff;border:1px solid #cbd5e1;color:#1d4ed8}
  .figbadge.light .fig{color:#64748b;font-weight:600;font-size:12px}
  .figbadge.dark{background:rgba(8,15,29,.82);border:1px solid rgba(148,163,184,.32);color:#dbeafe}
  .figbadge.dark .fig{color:#93a4c4;font-weight:600;font-size:12px}
  .figbadge .n{font-family:${MONO};font-weight:800}
</style></head><body><div class="shot">${inner}${badge}</div></body></html>`;

async function capture(win, name, html, w, h) {
  const file = path.join(OUT, `.render-${name}.html`);
  fs.writeFileSync(file, html);
  win.setContentSize(w * SCALE, h * SCALE);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 450));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  console.log(`✓ ${name}.png  ${image.getSize().width}×${image.getSize().height}`);
  await new Promise((r) => setTimeout(r, 100));
}

app.whenReady().then(async () => {
  // 硬兜底：渲染完卡在 quit / capture 时进程会一直挂着（窗口没了、Dock 一直跳），到点强制退
  const watchdog = setTimeout(() => {
    console.error("✗ 渲染超时（120s），强制退出");
    app.exit(1);
  }, 120_000);
  watchdog.unref?.();

  fs.mkdirSync(OUT, { recursive: true });
  // 清掉上一版（六张术语图）
  for (const f of fs.readdirSync(OUT)) {
    if (/^bot-0[1-6]-(cover|triangle|memory|ladder|decisions|portability)\.(png|svg)$/.test(f)) {
      fs.unlinkSync(path.join(OUT, f));
      console.log(`– 删除旧图 ${f}`);
    }
  }
  const win = new BrowserWindow({
    width: 3200,
    height: 2000,
    show: false,
    frame: false,
    useContentSize: true,
    resizable: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const fig = String(i + 1).padStart(2, "0");
    const base = `bot-${fig}-${img.name}`;
    try {
      fs.writeFileSync(path.join(OUT, `${base}.svg`), img.svg);
      const data = Buffer.from(img.svg).toString("base64");
      const html = htmlShell(
        `<img src="data:image/svg+xml;base64,${data}" style="display:block;width:${img.width}px;height:${img.height}px">`,
        img.width,
        img.height,
        badgeHtml(fig, img.dark ? "dark" : "light"),
      );
      await capture(win, base, html, img.width, img.height);
    } catch (err) {
      console.error(`✗ ${img.name}:`, err);
    }
  }
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith(".render-")) fs.unlinkSync(path.join(OUT, f));
  }
  win.destroy();
  // app.quit() 在 Electron 45 上会卡住（窗口关了、进程不退，Dock 图标一直跳）；直接 exit
  clearTimeout(watchdog);
  app.exit(0);
});
