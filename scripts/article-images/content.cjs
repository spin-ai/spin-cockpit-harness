// 生成知乎文章配图：封面 / 界面结构 / 架构 / 时序 / 数据模型 / 状态机 / 调度 / 元素拾取 / 打包
// 用法：npx electron scripts/article-images/render.cjs
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

const C = {
  ink: "#0f172a",
  slate: "#475569",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#cbd5e1",
  lineSoft: "#e2e8f0",
  bg: "#f8fafc",
  white: "#ffffff",
  blue: "#2563eb",
  blueMid: "#3b82f6",
  blueSoft: "#dbeafe",
  bluePale: "#eff6ff",
  green: "#059669",
  greenMid: "#10b981",
  greenSoft: "#d1fae5",
  amber: "#d97706",
  amberMid: "#f59e0b",
  amberSoft: "#fef3c7",
  red: "#dc2626",
  redMid: "#ef4444",
  redSoft: "#fee2e2",
  purple: "#7c3aed",
  purpleSoft: "#ede9fe",
  cyan: "#0891b2",
  cyanSoft: "#cffafe",
  dark: "#0b1220",
  dark2: "#111c33",
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function markerDefs() {
  const mk = (id, color) =>
    `<marker id="${id}" markerWidth="10" markerHeight="10" refX="8.5" refY="3.2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6.4 L9,3.2 z" fill="${color}"/></marker>`;
  return [
    mk("arrow-slate", C.slate),
    mk("arrow-blue", C.blue),
    mk("arrow-green", C.green),
    mk("arrow-amber", C.amber),
    mk("arrow-red", C.red),
    mk("arrow-purple", C.purple),
    mk("arrow-dark", "#334155"),
    `<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.10"/></filter>`,
    `<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
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
  const {
    rx = 0, fill = C.white, stroke = "none", sw = 1,
    dash = "", opacity = 1, shadow = false, filter = "",
  } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ""} opacity="${opacity}" ${shadow ? 'filter="url(#shadow)"' : ""} ${filter} />`;
}

function txt(x, y, t, o = {}) {
  const {
    size = 18, fill = C.ink, weight = 400, anchor = "start",
    family = FONT, opacity = 1, letter = 0, style = "",
  } = o;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${letter}" ${style}>${esc(t)}</text>`;
}

function lines(x, y, arr, o = {}) {
  const { lh = 24, ...rest } = o;
  return arr.map((t, i) => txt(x, y + i * lh, t, rest)).join("");
}

function arrow(x1, y1, x2, y2, o = {}) {
  const {
    color = C.slate, width = 2, dash = "", marker = "arrow-slate", opacity = 1,
  } = o;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#${marker})" opacity="${opacity}" />`;
}

function path(d, o = {}) {
  const {
    color = C.slate, width = 2, dash = "", marker = "arrow-slate", fill = "none", opacity = 1,
  } = o;
  return `<path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#${marker})" opacity="${opacity}" />`;
}

function pill(x, y, w, h, label, o = {}) {
  const {
    fill = C.blueSoft, stroke = "none", color = C.blue, size = 15, weight = 600,
    rx = h / 2, dot = false, family = FONT,
  } = o;
  const tx = x + w / 2 + (dot ? 7 : 0);
  return `${rect(x, y, w, h, { rx, fill, stroke, sw: 1 })}${dot ? `<circle cx="${x + 18}" cy="${y + h / 2}" r="4" fill="${color}"/>` : ""}${txt(tx, y + h / 2 + size * 0.36, label, { size, fill: color, weight, anchor: "middle", family })}`;
}

function entity(x, y, w, h, title, color, fields) {
  const head = 42;
  let out = `${rect(x, y, w, h, { rx: 14, fill: C.white, stroke: C.line, sw: 1.2, shadow: true })}`;
  out += `<path d="M${x + 14},${y} h${w - 28} a14,14 0 0 1 14,14 v${head - 14} h-${w} v-${head - 14} a14,14 0 0 1 14,-14 z" fill="${color}"/>`;
  out += txt(x + 18, y + 28, title, { size: 18, weight: 700, fill: C.white, family: MONO });
  fields.forEach((f, i) => {
    const yy = y + head + 26 + i * 25;
    const highlight = f.startsWith("*");
    const label = f.replace(/^\*/, "");
    if (highlight) out += rect(x + 8, yy - 17, w - 16, 21, { rx: 5, fill: "#fffbeb" });
    const dot = highlight ? `<circle cx="${x + 17}" cy="${yy - 5}" r="3.5" fill="${C.amber}"/>` : "";
    out += dot + txt(x + (highlight ? 26 : 18), yy, label, {
      size: 13.5, family: MONO, fill: highlight ? "#92400e" : C.slate, weight: highlight ? 600 : 400,
    });
  });
  return out;
}

function sectionTitle(title, sub) {
  return `${txt(58, 66, title, { size: 34, weight: 750 })}
  ${txt(58, 100, sub, { size: 17, fill: C.muted })}`;
}

function bandLabel(x, y, label, color = C.blue) {
  return `${rect(x, y, 92, 28, { rx: 14, fill: C.bluePale, stroke: "#bfdbfe" })}
  ${txt(x + 46, y + 19, label, { size: 12, weight: 750, fill: color, anchor: "middle", letter: 1.4 })}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cover
// ─────────────────────────────────────────────────────────────────────────────
const cover = {
  name: "cover",
  width: 1600,
  height: 900,
  html: {
    css: `
      *{box-sizing:border-box}
      html,body{margin:0;width:1600px;height:900px;overflow:hidden;background:#070d1a}
      body{font-family:${FONT};color:#e8eefc}
      .stage{position:relative;width:1600px;height:900px;overflow:hidden;
        background:
          radial-gradient(900px 520px at 76% 24%,rgba(37,99,235,.30),transparent 62%),
          radial-gradient(760px 520px at 68% 82%,rgba(16,185,129,.17),transparent 62%),
          linear-gradient(135deg,#070d1a 0%,#0b1426 58%,#0e1a30 100%);}
      .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.075) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.075) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black 0%,rgba(0,0,0,.65) 65%,transparent 100%)}
      .watermark{position:absolute;right:36px;bottom:-96px;font-size:420px;line-height:1;font-weight:800;color:rgba(96,165,250,.055);letter-spacing:-22px}
      .left{position:absolute;left:96px;top:92px;width:780px}
      .eyebrow{display:flex;align-items:center;gap:12px;font-size:14px;letter-spacing:2.4px;color:#93a4c4;font-weight:600}
      .eyebrow i{display:block;width:34px;height:2px;background:linear-gradient(90deg,#60a5fa,#34d399)}
      h1{margin:30px 0 0;font-size:77px;line-height:1.07;letter-spacing:-2.4px;font-weight:800}
      h1 .small{display:block;font-size:43px;letter-spacing:-1px;color:#9db4da;font-weight:650;margin-bottom:12px}
      h1 em{font-style:normal;background:linear-gradient(92deg,#60a5fa 0%,#38bdf8 45%,#34d399 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
      .sub{margin-top:30px;font-size:22px;color:#a9b9d6;letter-spacing:.6px}
      .sub b{color:#dbeafe;font-weight:600}
      .rule{width:560px;height:1px;background:linear-gradient(90deg,rgba(96,165,250,.75),rgba(52,211,153,.15),transparent);margin:36px 0 30px}
      .pillrow{display:flex;gap:12px;flex-wrap:wrap}
      .pill{border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.55);color:#c7d6ef;border-radius:999px;padding:9px 16px;font-size:14px;letter-spacing:.3px}
      .pill b{color:#93c5fd;font-weight:600}
      .bottom{position:absolute;left:96px;bottom:64px;display:flex;align-items:center;gap:18px;color:#7f91b2;font-size:14px;letter-spacing:.4px}
      .bottom .v{color:#c7d6ef;font-weight:600}
      .right{position:absolute;right:70px;top:108px;width:660px;height:690px}
      .win{position:absolute;inset:0;border-radius:20px;background:linear-gradient(180deg,#0d1729,#0a111f);border:1px solid rgba(148,163,184,.24);box-shadow:0 40px 100px rgba(0,0,0,.55),0 0 80px rgba(37,99,235,.16);overflow:hidden}
      .bar{height:42px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.7)}
      .dot{width:10px;height:10px;border-radius:50%}
      .dot.r{background:#f87171}.dot.y{background:#fbbf24}.dot.g{background:#34d399}
      .bar .title{margin-left:10px;color:#8fa3c4;font-size:12px;letter-spacing:.4px}
      .bar .badge{margin-left:auto;font-size:11px;color:#93c5fd;border:1px solid rgba(96,165,250,.35);background:rgba(37,99,235,.12);padding:3px 9px;border-radius:999px}
      .cols{display:grid;grid-template-columns:48px 158px 180px 1fr 96px;height:648px}
      .nav{background:#070d1a;border-right:1px solid rgba(148,163,184,.12);padding-top:18px;display:flex;flex-direction:column;align-items:center;gap:14px}
      .nav .ico{width:24px;height:24px;border-radius:7px;background:rgba(148,163,184,.15);border:1px solid rgba(148,163,184,.18)}
      .nav .ico.on{background:linear-gradient(135deg,#3b82f6,#2563eb);border-color:#60a5fa;box-shadow:0 0 18px rgba(59,130,246,.5)}
      .col{border-right:1px solid rgba(148,163,184,.10);padding:14px 12px;min-width:0}
      .col h3{margin:0 0 12px;font-size:10px;color:#6f83a5;letter-spacing:1.6px;font-weight:700}
      .grp{font-size:10px;color:#7f91b2;margin:14px 0 7px;display:flex;justify-content:space-between}
      .grp b{color:#c7d6ef;font-weight:600}
      .task{border:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.55);border-radius:9px;padding:8px 9px;margin-bottom:7px}
      .task .t{font-size:11px;color:#dbe7fb;line-height:1.35;margin-bottom:5px}
      .task .m{display:flex;align-items:center;gap:5px;font-size:9px;color:#6f83a5}
      .task .tag{font-size:8px;padding:1px 5px;border-radius:999px;background:rgba(59,130,246,.16);color:#93c5fd;border:1px solid rgba(96,165,250,.25)}
      .task.sel{border-color:rgba(96,165,250,.55);box-shadow:0 0 0 1px rgba(96,165,250,.16),0 8px 24px rgba(0,0,0,.2);background:rgba(30,58,138,.18)}
      .task .barline{height:2px;border-radius:2px;background:linear-gradient(90deg,#3b82f6,#60a5fa);margin-bottom:7px}
      .task.run .barline{background:linear-gradient(90deg,#10b981,#34d399)}
      .task.wait .barline{background:linear-gradient(90deg,#f59e0b,#fbbf24)}
      .chat{background:rgba(8,15,29,.55)}
      .msg{margin-bottom:9px;display:flex}
      .msg.user{justify-content:flex-end}
      .bubble{max-width:94%;border-radius:10px;padding:8px 9px;font-size:10.5px;line-height:1.5}
      .msg.user .bubble{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#eff6ff;border-bottom-right-radius:3px}
      .msg.agent .bubble{background:rgba(30,41,59,.9);border:1px solid rgba(148,163,184,.16);color:#cbd9ef;border-bottom-left-radius:3px}
      .tool{margin:7px 0;border:1px solid rgba(52,211,153,.22);background:rgba(6,78,59,.18);border-radius:8px;padding:7px 8px;font-family:${MONO};font-size:9.5px;color:#6ee7b7}
      .receipt{margin:6px 0 10px;font-size:9px;color:#6ee7b7;display:flex;align-items:center;gap:5px}
      .receipt i{width:5px;height:5px;border-radius:50%;background:#34d399}
      .term{background:#070d1a;padding:0;display:flex;flex-direction:column}
      .tabs{height:34px;display:flex;align-items:flex-end;gap:2px;padding:0 8px;border-bottom:1px solid rgba(148,163,184,.12);background:#0a1424}
      .tab{font-size:9.5px;color:#7f91b2;padding:6px 9px;border-radius:6px 6px 0 0;border:1px solid transparent;border-bottom:0}
      .tab.on{color:#dbeafe;background:#070d1a;border-color:rgba(148,163,184,.16)}
      .termbody{padding:14px 12px;font-family:${MONO};font-size:10.5px;line-height:1.75;color:#cbd5e1}
      .termbody .p{color:#34d399}
      .termbody .c{color:#93c5fd}
      .termbody .ok{color:#34d399}
      .termbody .dim{color:#64748b}
      .termbody .warn{color:#fbbf24}
      .cursor{display:inline-block;width:7px;height:13px;background:#34d399;vertical-align:-2px;animation:none}
      .files{background:rgba(8,15,29,.35)}
      .file{font-family:${MONO};font-size:9.5px;color:#8fa3c4;padding:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .file.dir{color:#c7d6ef}
      .file.sel{color:#93c5fd;background:rgba(37,99,235,.14);border-radius:4px;padding-left:4px;margin-left:-4px}
      .file .ind{color:#475569}
      .chip{position:absolute;display:flex;align-items:center;gap:8px;border-radius:999px;padding:9px 14px;font-size:12px;color:#dbeafe;background:rgba(15,23,42,.82);border:1px solid rgba(96,165,250,.28);box-shadow:0 10px 30px rgba(0,0,0,.35);backdrop-filter:blur(6px)}
      .chip i{width:7px;height:7px;border-radius:50%}
      .chip.c1{left:-56px;top:108px}.chip.c1 i{background:#60a5fa}
      .chip.c2{right:-46px;top:348px}.chip.c2 i{background:#34d399}
      .chip.c3{left:-34px;bottom:78px}.chip.c3 i{background:#fbbf24}
      .cap{position:absolute;right:76px;bottom:44px;color:#7f91b2;font-size:12px;letter-spacing:.6px}
    `,
    body: `
      <div class="stage">
        <div class="grid"></div>
        <div class="watermark">01</div>

        <div class="left">
          <div class="eyebrow"><i></i> COCKPIT HARNESS · 多 AGENT 编排工作台</div>
          <h1><span class="small">从 0 到 1</span>开发一个<br><em>多智能体终端</em></h1>
          <div class="sub">Chat 分派 · 真实 PTY · 任务调度 · <b>ACP 协议</b></div>
          <div class="rule"></div>
          <div class="pillrow">
            <div class="pill"><b>Electron</b> + React</div>
            <div class="pill"><b>node-pty</b> + xterm</div>
            <div class="pill"><b>SQLite</b> 本地优先</div>
            <div class="pill"><b>ACP</b> 结构化执行</div>
          </div>
          <div class="bottom">
            <span class="v">v0.2.0</span><span>·</span><span>macOS / Windows / Linux</span><span>·</span><span>单用户 · 本地优先</span>
          </div>
        </div>

        <div class="right">
          <div class="win">
            <div class="bar">
              <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
              <span class="title">Cockpit Harness — 多智能体工作台</span>
              <span class="badge">2 running</span>
            </div>
            <div class="cols">
              <div class="nav">
                <div class="ico on"></div><div class="ico"></div><div class="ico"></div><div class="ico"></div><div class="ico"></div>
              </div>
              <div class="col">
                <h3>TODO LIST</h3>
                <div class="grp"><span>等待输入</span><b>1</b></div>
                <div class="task wait"><div class="barline"></div><div class="t">确认部署地址</div><div class="m"><span class="tag">@dsh</span><span>spin-cockpit</span></div></div>
                <div class="grp"><span>待确认</span><b>2</b></div>
                <div class="task sel"><div class="barline"></div><div class="t">把首页 Hero 标题改大</div><div class="m"><span class="tag">@dsh</span><span>42s</span></div></div>
                <div class="grp"><span>运行中</span><b>2</b></div>
                <div class="task run"><div class="barline"></div><div class="t">补全统计页失败下钻</div><div class="m"><span class="tag">@dsh</span><span>1:24</span></div></div>
                <div class="grp"><span>待执行</span><b>3</b></div>
                <div class="task"><div class="t">给预览加元素拾取</div><div class="m"><span class="tag">@dsh</span><span>P1</span></div></div>
                <div class="grp"><span>已确认</span><b>8</b></div>
              </div>
              <div class="col chat">
                <h3>CHAT</h3>
                <div class="msg user"><div class="bubble">把首页 Hero 标题改大，副标题换成“让 Agent 真正干活”。</div></div>
                <div class="msg agent"><div class="bubble">已定位 <span style="color:#93c5fd">src/pages/Home.tsx:42</span>，修改 h1.hero 和 .sub。</div></div>
                <div class="tool">● Edit src/pages/Home.tsx +12 −4</div>
                <div class="msg user"><div class="bubble">字号再大一点，40px。</div></div>
                <div class="receipt"><i></i>已注入当前运行</div>
                <div class="msg agent"><div class="bubble">已调整为 40px，并跑了 build。</div></div>
              </div>
              <div class="col term">
                <div class="tabs"><div class="tab on">dsh · 项目</div><div class="tab">预览 :5173</div><div class="tab">Home.tsx</div></div>
                <div class="termbody">
                  <div><span class="p">$</span> dsh --profile acp</div>
                  <div><span class="ok">✔</span> read&nbsp;&nbsp;src/pages/Home.tsx</div>
                  <div><span class="c">●</span> edit&nbsp;&nbsp;src/pages/Home.tsx <span class="ok">+12</span> <span class="warn">−4</span></div>
                  <div><span class="ok">✔</span> run&nbsp;&nbsp;&nbsp;npm run build</div>
                  <div class="dim">&nbsp;&nbsp;vite v6.3.0 building for production...</div>
                  <div class="dim">&nbsp;&nbsp;✓ 142 modules transformed.</div>
                  <div class="dim">&nbsp;&nbsp;dist/index.html&nbsp;&nbsp;0.46 kB</div>
                  <div><span class="ok">✔</span> done in 42.3s</div>
                  <div><span class="p">$</span> <span class="cursor"></span></div>
                </div>
              </div>
              <div class="col files">
                <h3>资源</h3>
                <div class="file dir">▾ spin-cockpit</div>
                <div class="file"><span class="ind">&nbsp;&nbsp;▾</span> src</div>
                <div class="file"><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;▾</span> pages</div>
                <div class="file sel"><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>Home.tsx</div>
                <div class="file"><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;▸</span> components</div>
                <div class="file"><span class="ind">&nbsp;&nbsp;▸</span> electron</div>
                <div class="file"><span class="ind">&nbsp;&nbsp;▸</span> docs</div>
                <div class="file"><span class="ind">&nbsp;&nbsp;</span>README.md</div>
              </div>
            </div>
          </div>
          <div class="chip c1"><i></i>一句话派活</div>
          <div class="chip c2"><i></i>运行中纠偏</div>
          <div class="chip c3"><i></i>状态即看板</div>
        </div>
        <div class="cap">不是多开终端，是让多个 Agent 进入同一套状态机</div>
      </div>
    `,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Five-column layout
// ─────────────────────────────────────────────────────────────────────────────
const layout = {
  name: "layout",
  width: 1600,
  height: 1000,
  html: {
    css: `
      *{box-sizing:border-box}
      html,body{margin:0;width:1600px;height:1000px;overflow:hidden;background:#dfe7f1}
      body{font-family:${FONT};color:${C.ink}}
      .stage{width:1600px;height:1000px;padding:26px 30px 0;background:
        radial-gradient(900px 500px at 12% 0%,rgba(255,255,255,.75),transparent 60%),
        linear-gradient(180deg,#e8eef6,#dbe5f1);}
      .window{width:1540px;height:900px;border-radius:18px;background:#fff;border:1px solid #c4d1e1;box-shadow:0 30px 70px rgba(15,23,42,.18);overflow:hidden}
      .titlebar{height:42px;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid #e2e8f0;background:linear-gradient(180deg,#f8fafc,#f1f5f9)}
      .dot{width:10px;height:10px;border-radius:50%}
      .dot.r{background:#f87171}.dot.y{background:#fbbf24}.dot.g{background:#34d399}
      .titlebar .t{margin-left:10px;font-size:12px;color:#64748b;letter-spacing:.3px}
      .titlebar .right{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:10px;color:#64748b}
      .kbd{border:1px solid #cbd5e1;border-bottom-width:2px;border-radius:5px;padding:1px 5px;background:#fff;font-size:9px;color:#475569}
      .main{display:grid;grid-template-columns:64px 282px 384px 1fr 246px;height:858px}
      .rail{background:linear-gradient(180deg,#0f172a,#0b1220);color:#94a3b8;display:flex;flex-direction:column;align-items:center;padding-top:16px;gap:12px}
      .rail .logo{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#10b981);box-shadow:0 0 18px rgba(59,130,246,.45);margin-bottom:8px}
      .rail .ni{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-size:15px;color:#94a3b8;position:relative}
      .rail .ni.on{background:rgba(59,130,246,.16);color:#93c5fd;border:1px solid rgba(96,165,250,.28)}
      .rail .ni.on:before{content:"";position:absolute;left:-10px;top:9px;width:3px;height:18px;border-radius:3px;background:#60a5fa}
      .rail .badge{position:absolute;right:2px;top:2px;min-width:14px;height:14px;border-radius:999px;background:#ef4444;color:#fff;font-size:8px;display:grid;place-items:center;padding:0 3px}
      .col{min-width:0;display:flex;flex-direction:column;border-right:1px solid #e2e8f0}
      .todo{background:#fff}
      .head{height:54px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #eef2f7;flex:none}
      .head h2{margin:0;font-size:13px;letter-spacing:1.1px;color:#0f172a;font-weight:750}
      .head .n{font-size:10px;color:#64748b;background:#f1f5f9;border-radius:999px;padding:2px 7px}
      .head .grow{margin-left:auto}
      .mini{font-size:10px;color:#64748b;border:1px solid #dbe3ee;border-radius:7px;padding:4px 7px;background:#fff}
      .search{margin:10px 12px 4px;height:30px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;display:flex;align-items:center;padding:0 9px;gap:7px;font-size:10px;color:#94a3b8}
      .filters{display:flex;gap:5px;padding:6px 12px 8px;border-bottom:1px solid #eef2f7;flex:none}
      .filter{font-size:9px;padding:3px 8px;border-radius:999px;border:1px solid #e2e8f0;color:#64748b;background:#fff}
      .filter.on{background:#eff6ff;color:#2563eb;border-color:#bfdbfe}
      .scroll{overflow:hidden;padding:4px 10px 12px;flex:1}
      .grp{display:flex;align-items:center;gap:6px;margin:12px 2px 7px;font-size:10px;color:#64748b;font-weight:650}
      .grp .d{width:6px;height:6px;border-radius:50%}
      .grp .c{margin-left:auto;color:#94a3b8;font-weight:400}
      .card{border:1px solid #e6edf5;background:#fff;border-radius:9px;padding:8px 9px;margin-bottom:7px;position:relative}
      .card:before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:#cbd5e1}
      .card.run:before{background:#10b981}.card.wait:before{background:#f59e0b}.card.review:before{background:#3b82f6}
      .card .tt{font-size:10.5px;line-height:1.4;color:#1e293b;margin-bottom:5px;padding-left:2px}
      .card .mm{display:flex;align-items:center;gap:5px;font-size:8.5px;color:#94a3b8;padding-left:2px}
      .tag{font-size:8px;padding:1px 5px;border-radius:999px;background:#eff6ff;color:#2563eb;border:1px solid #dbeafe}
      .tag.g{background:#ecfdf5;color:#059669;border-color:#d1fae5}
      .tag.a{background:#fffbeb;color:#d97706;border-color:#fef3c7}
      .card.sel{border-color:#bfdbfe;background:linear-gradient(180deg,#f8fbff,#eff6ff);box-shadow:0 0 0 2px rgba(59,130,246,.08)}
      .card.sel .tt{color:#1d4ed8;font-weight:600}
      .proj{margin-top:auto;border-top:1px solid #eef2f7;padding:10px 12px;background:#fbfdff}
      .proj .pt{font-size:9px;color:#94a3b8;letter-spacing:1px;margin-bottom:6px}
      .proj .row{display:flex;align-items:center;gap:7px;font-size:10px;color:#334155}
      .proj .sq{width:7px;height:7px;border-radius:2px;background:#14b8a6}
      .proj .row b{margin-left:auto;font-size:8px;color:#64748b;font-weight:500}
      .chat{background:linear-gradient(180deg,#fbfdff,#f7fafd)}
      .thread{padding:11px 14px 9px;border-bottom:1px solid #e8eef6;background:#fff}
      .thread .line1{display:flex;align-items:center;gap:6px}
      .thread h3{margin:0;font-size:12px;font-weight:650;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pill{font-size:8px;padding:2px 6px;border-radius:999px;background:#eff6ff;color:#2563eb;border:1px solid #dbeafe;white-space:nowrap}
      .pill.g{background:#ecfdf5;color:#059669;border-color:#d1fae5}
      .thread .meta{display:flex;gap:8px;align-items:center;margin-top:6px;font-size:9px;color:#94a3b8}
      .thread .scope{color:#475569;background:#f1f5f9;border-radius:5px;padding:1px 5px}
      .msgs{flex:1;overflow:hidden;padding:12px 13px 4px;display:flex;flex-direction:column;gap:9px}
      .msg{display:flex;flex-direction:column;max-width:100%}
      .msg.user{align-items:flex-end}
      .bubble{font-size:10.5px;line-height:1.55;border-radius:10px;padding:8px 10px;max-width:92%}
      .msg.user .bubble{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#eff6ff;border-bottom-right-radius:3px;box-shadow:0 6px 16px rgba(37,99,235,.18)}
      .msg.agent .bubble{background:#fff;border:1px solid #e2e8f0;color:#334155;border-bottom-left-radius:3px;box-shadow:0 4px 12px rgba(15,23,42,.04)}
      .code{font-family:${MONO};font-size:9px;color:#047857;background:#ecfdf5;border:1px solid #d1fae5;border-radius:7px;padding:6px 8px;margin-top:5px;white-space:nowrap}
      .receipt{display:flex;align-items:center;gap:5px;font-size:8.5px;color:#059669;margin-top:4px;align-self:flex-end}
      .receipt i{width:5px;height:5px;border-radius:50%;background:#10b981}
      .compose{margin:8px 12px 12px;border:1px solid #dbe3ee;background:#fff;border-radius:11px;padding:8px 9px;box-shadow:0 8px 22px rgba(15,23,42,.05)}
      .compose .ctx{display:inline-flex;align-items:center;gap:5px;font-size:8px;color:#2563eb;background:#eff6ff;border:1px solid #dbeafe;border-radius:5px;padding:2px 6px;margin-bottom:5px}
      .compose .ph{font-size:10px;color:#94a3b8;height:28px}
      .compose .row{display:flex;align-items:center;gap:6px;border-top:1px solid #f1f5f9;padding-top:6px;font-size:8.5px;color:#64748b}
      .compose .send{margin-left:auto;width:24px;height:24px;border-radius:7px;background:#2563eb;color:#fff;display:grid;place-items:center;font-size:11px}
      .term{background:#0b1220;border-right:0}
      .tabs{height:38px;background:#0a1424;border-bottom:1px solid #1e293b;display:flex;align-items:flex-end;gap:2px;padding:0 9px;flex:none}
      .tab{font-size:10px;color:#7f91b2;padding:7px 10px 6px;border-radius:7px 7px 0 0;border:1px solid transparent;border-bottom:0;display:flex;align-items:center;gap:5px;white-space:nowrap}
      .tab.on{background:#0b1220;border-color:#1e293b;color:#dbeafe}
      .tab .dotb{width:5px;height:5px;border-radius:50%;background:#34d399}
      .tab .dotp{width:5px;height:5px;border-radius:50%;background:#60a5fa}
      .tbar{height:32px;border-bottom:1px solid #16233a;display:flex;align-items:center;gap:8px;padding:0 12px;color:#64748b;font-size:9px;flex:none}
      .tbar .sp{margin-left:auto;display:flex;gap:6px}
      .tbar .b{border:1px solid #1e293b;background:#0f1a2d;color:#94a3b8;border-radius:5px;padding:2px 6px;font-size:8px}
      .termbody{flex:1;padding:14px 16px;font-family:${MONO};font-size:11px;line-height:1.8;color:#cbd5e1;white-space:pre;overflow:hidden}
      .p{color:#34d399}.c{color:#60a5fa}.ok{color:#34d399}.dim{color:#64748b}.warn{color:#fbbf24}.path{color:#93c5fd}
      .cursor{display:inline-block;width:7px;height:13px;background:#34d399;vertical-align:-2px}
      .termfoot{height:28px;border-top:1px solid #16233a;display:flex;align-items:center;gap:10px;padding:0 12px;font-size:8.5px;color:#64748b;flex:none}
      .termfoot .sp{margin-left:auto}
      .files{background:#fff;border-right:0}
      .tree{padding:8px 9px;font-family:${MONO};font-size:9.5px;line-height:1.85;color:#64748b;flex:1;overflow:hidden}
      .tree .dir{color:#334155;font-weight:600}
      .tree .sel{background:#eff6ff;color:#2563eb;border-radius:4px;margin-left:-3px;padding-left:3px}
      .tree .ind{color:#cbd5e1}
      .preview{border-top:1px solid #eef2f7;background:#fbfdff;padding:9px 10px 10px}
      .preview .ph{font-size:8px;letter-spacing:1px;color:#94a3b8;margin-bottom:6px}
      .preview .file{display:flex;align-items:center;gap:6px;font-size:9.5px;color:#334155;margin-bottom:6px}
      .preview .file .ic{width:16px;height:16px;border-radius:4px;background:#eff6ff;color:#2563eb;display:grid;place-items:center;font-size:8px;font-family:${MONO}}
      .preview .snippet{font-family:${MONO};font-size:8.5px;line-height:1.6;color:#64748b;background:#fff;border:1px solid #e8eef6;border-radius:6px;padding:6px 7px;white-space:pre;overflow:hidden}
      .legend{height:66px;display:flex;align-items:center;gap:26px;padding:0 14px;color:#475569;font-size:12px}
      .legend .item{display:flex;align-items:center;gap:8px;white-space:nowrap}
      .num{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:750;color:#1d4ed8;background:#dbeafe;border:1px solid #bfdbfe}
      .legend .note{margin-left:auto;color:#94a3b8;font-size:11px}
    `,
    body: `
      <div class="stage">
        <div class="window">
          <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="t">Cockpit Harness — 多智能体工作台</span><span class="right"><span class="kbd">⌘K</span><span>命令面板</span><span style="color:#cbd5e1">|</span><span>v0.2.0</span></span></div>
          <div class="main">
            <div class="rail">
              <div class="logo"></div>
              <div class="ni on">▦</div><div class="ni">◫</div><div class="ni">✉<span class="badge">3</span></div><div class="ni">◔</div><div class="ni">⌂</div>
              <div style="margin-top:auto;margin-bottom:16px" class="ni">⚙</div>
            </div>

            <div class="col todo">
              <div class="head"><h2>TODO LIST</h2><span class="n">14</span><span class="grow"></span><span class="mini">＋</span></div>
              <div class="search">⌕ 搜索标题 / 编号 / 标签</div>
              <div class="filters"><span class="filter on">全部</span><span class="filter">进行中</span><span class="filter">待确认</span><span class="filter">已确认</span></div>
              <div class="scroll">
                <div class="grp"><span class="d" style="background:#f59e0b"></span>等待输入<span class="c">1</span></div>
                <div class="card wait"><div class="tt">确认部署地址</div><div class="mm"><span class="tag a">@dsh</span><span>spin-cockpit</span><span>·</span><span>2m</span></div></div>
                <div class="grp"><span class="d" style="background:#3b82f6"></span>待确认<span class="c">2</span></div>
                <div class="card review sel"><div class="tt">把首页 Hero 标题改大</div><div class="mm"><span class="tag">@dsh</span><span>42s</span><span>·</span><span>3 个产物</span></div></div>
                <div class="card review"><div class="tt">统计页失败分类下钻</div><div class="mm"><span class="tag">@dsh</span><span>1:06</span><span>·</span><span>待验收</span></div></div>
                <div class="grp"><span class="d" style="background:#10b981"></span>运行中<span class="c">2</span></div>
                <div class="card run"><div class="tt">补全收件箱未读聚合</div><div class="mm"><span class="tag g">@dsh</span><span>1:24</span><span>·</span><span>编辑中</span></div></div>
                <div class="card run"><div class="tt">给预览加元素拾取</div><div class="mm"><span class="tag g">@dsh</span><span>0:38</span><span>·</span><span>跑测试</span></div></div>
                <div class="grp"><span class="d" style="background:#94a3b8"></span>待执行<span class="c">3</span></div>
                <div class="card"><div class="tt">整理 ACP 错误分类</div><div class="mm"><span class="tag">@dsh</span><span>P1</span></div></div>
                <div class="card"><div class="tt">远端主机并发上限</div><div class="mm"><span class="tag">@dsh</span><span>P2</span></div></div>
                <div class="grp"><span class="d" style="background:#cbd5e1"></span>已确认<span class="c">8</span></div>
              </div>
              <div class="proj">
                <div class="pt">项目</div>
                <div class="row"><span class="sq"></span><span>spin-cockpit-harness</span><b>当前</b></div>
              </div>
            </div>

            <div class="col chat">
              <div class="thread">
                <div class="line1"><h3>把首页 Hero 标题改大</h3><span class="pill">待确认</span></div>
                <div class="meta"><span class="scope">◎ 项目 · spin-cockpit</span><span>@dsh</span><span>·</span><span>run r128</span><span>·</span><span>42s</span></div>
              </div>
              <div class="msgs">
                <div class="msg user"><div class="bubble">把首页 Hero 标题改大，副标题换成“让 Agent 真正干活”。</div></div>
                <div class="msg agent"><div class="bubble">已定位 <span style="color:#2563eb;font-family:${MONO};font-size:9px">src/pages/Home.tsx:42</span>，准备修改 h1.hero 和 .sub。<div class="code">● Edit src/pages/Home.tsx +12 −4</div></div></div>
                <div class="msg user"><div class="bubble">字号再大一点，40px。</div><div class="receipt"><i></i>已注入当前运行</div></div>
                <div class="msg agent"><div class="bubble">已调整为 40px，并跑了 <span style="font-family:${MONO};font-size:9px">npm run build</span>，构建通过。</div></div>
                <div class="msg agent"><div class="bubble" style="color:#64748b">需要我把副标题也一起改掉吗？</div></div>
              </div>
              <div class="compose">
                <span class="ctx">◎ 项目 · spin-cockpit</span>
                <div class="ph">运行中发消息 = 纠偏；Enter 发送</div>
                <div class="row"><span>◎ 全局</span><span>@dsh</span><span>模型 auto</span><span class="send">↑</span></div>
              </div>
            </div>

            <div class="col term">
              <div class="tabs"><div class="tab on"><span class="dotb"></span>dsh · 项目</div><div class="tab"><span class="dotp"></span>预览 :5173</div><div class="tab">Home.tsx</div><div class="tab">zsh</div></div>
              <div class="tbar"><span>⌘D 拆分</span><span>⌘F 查找</span><span>⌘+ 字号</span><span class="sp"><span class="b">120×32</span><span class="b">UTF-8</span></span></div>
              <div class="termbody"><span class="p">$</span> dsh --profile acp
<span class="ok">✔</span> read   <span class="path">src/pages/Home.tsx</span>
<span class="c">●</span> edit   <span class="path">src/pages/Home.tsx</span> <span class="ok">+12</span> <span class="warn">−4</span>
<span class="ok">✔</span> run    npm run build
  <span class="dim">vite v6.3.0 building for production...</span>
  <span class="dim">✓ 142 modules transformed.</span>
  <span class="dim">dist/index.html                  0.46 kB</span>
  <span class="dim">dist/assets/index-4f2a1c.css    18.72 kB</span>
  <span class="ok">✔</span> done in 42.3s
<span class="p">$</span> <span class="cursor"></span></div>
              <div class="termfoot"><span>● dsh 0.2.1-rc.2</span><span>zsh</span><span class="sp">PID 48213</span><span>⌘K 命令</span></div>
            </div>

            <div class="col files">
              <div class="head"><h2>资源管理器</h2><span class="grow"></span><span class="mini">⌕</span></div>
              <div class="tree">
                <div class="dir">▾ spin-cockpit-harness</div>
                <div><span class="ind">&nbsp;&nbsp;▾</span> src</div>
                <div><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;▾</span> components</div>
                <div><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> TaskChat.tsx</div>
                <div><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> TerminalPanel.tsx</div>
                <div><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;▾</span> pages</div>
                <div class="sel"><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span> Home.tsx</div>
                <div><span class="ind">&nbsp;&nbsp;&nbsp;&nbsp;</span> App.tsx</div>
                <div><span class="ind">&nbsp;&nbsp;▸</span> electron</div>
                <div><span class="ind">&nbsp;&nbsp;▸</span> docs</div>
                <div><span class="ind">&nbsp;&nbsp;</span> package.json</div>
                <div><span class="ind">&nbsp;&nbsp;</span> README.md</div>
              </div>
              <div class="preview">
                <div class="ph">预览</div>
                <div class="file"><span class="ic">TSX</span> Home.tsx</div>
                <div class="snippet">&lt;h1 className="hero"&gt;
  Agent 真正干活
&lt;/h1&gt;</div>
              </div>
            </div>
          </div>
        </div>

        <div class="legend">
          <div class="item"><span class="num">1</span>导航 / 收件箱</div>
          <div class="item"><span class="num">2</span>状态分组即看板</div>
          <div class="item"><span class="num">3</span>唯一分派入口</div>
          <div class="item"><span class="num">4</span>真实 PTY 主区域</div>
          <div class="item"><span class="num">5</span>文件 / 预览</div>
        </div>
      </div>
    `,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. Architecture
// ─────────────────────────────────────────────────────────────────────────────
function architecture() {
  const w = 1600, h = 1000;
  let b = "";
  b += sectionTitle("Cockpit Harness 全景架构", "Renderer / Main / Executor / Storage 四层：所有事件先落库，再广播给 UI");

  // Renderer band
  b += bandLabel(58, 138, "RENDERER", C.blue);
  b += rect(178, 128, 1364, 176, { rx: 18, fill: "#f8fbff", stroke: "#dbeafe", sw: 1.4 });
  const ui = [
    ["导航", "工作区 / 项目 / 收件箱", "统计 / 主机 / 设置", C.blue],
    ["TODO LIST", "状态分组即看板", "确认 = 状态", C.green],
    ["Chat", "唯一分派入口", "运行中纠偏", C.purple],
    ["Terminal", "node-pty + xterm", "标签 / 拆分 / 预览", C.amber],
    ["文件 / 预览", "项目树 / 文件预览", "WebView + CDP", C.cyan],
  ];
  ui.forEach(([title, s1, s2, color], i) => {
    const x = 198 + i * 266;
    b += rect(x, 150, 246, 132, { rx: 13, fill: C.white, stroke: "#dbe3ee", sw: 1.2, shadow: true });
    b += rect(x + 14, 164, 30, 6, { rx: 3, fill: color });
    b += txt(x + 16, 200, title, { size: 21, weight: 750 });
    b += txt(x + 16, 228, s1, { size: 13.5, fill: C.muted });
    b += txt(x + 16, 249, s2, { size: 13.5, fill: C.muted });
    b += txt(x + 226, 200, String(i + 1).padStart(2, "0"), { size: 18, weight: 750, fill: "#e2e8f0", anchor: "end", family: MONO });
  });

  // IPC
  b += arrow(860, 306, 860, 338, { color: C.blue, width: 2.2, marker: "arrow-blue" });
  b += rect(178, 342, 1364, 62, { rx: 14, fill: C.bluePale, stroke: "#bfdbfe", sw: 1.4 });
  b += txt(860, 370, "IPC：类型化 RPC + 状态快照广播", { size: 18, weight: 700, fill: "#1d4ed8", anchor: "middle" });
  b += txt(860, 392, "renderer 不直接持有子进程 / 不直接访问文件系统", { size: 12.5, fill: "#3b82f6", anchor: "middle" });

  // Main band
  b += arrow(860, 406, 860, 438, { color: C.blue, width: 2.2, marker: "arrow-blue" });
  b += bandLabel(58, 448, "MAIN", C.purple);
  b += rect(178, 438, 1364, 272, { rx: 18, fill: "#fbfaff", stroke: "#ede9fe", sw: 1.4 });
  const main = [
    ["Send 状态机", "thread 驱动 · 先落消息", "dispatch / steer / note", C.purple],
    ["Scheduler", "全局 / 主机 / Agent 并发", "同 cwd 串行", C.blue],
    ["Run Supervisor", "ACP 生命周期", "取消 / 重试 / 收尾", C.green],
    ["Host Probe", "CLI caps / 心跳", "远端目录 / 并发上限", C.cyan],
    ["Stats & Audit", "耗时 / 排队 / Token", "错误分类 / CSV", C.amber],
    ["Persist", "SQLite（sql.js）", "事件先落库再广播", C.red],
  ];
  main.forEach(([title, s1, s2, color], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 198 + col * 446, y = 462 + row * 116;
    b += rect(x, y, 418, 100, { rx: 12, fill: C.white, stroke: "#e2e8f0", sw: 1.2, shadow: true });
    b += rect(x, y, 5, 100, { rx: 2.5, fill: color });
    b += txt(x + 18, y + 30, title, { size: 18, weight: 750 });
    b += txt(x + 18, y + 55, s1, { size: 12.5, fill: C.muted });
    b += txt(x + 18, y + 76, s2, { size: 12.5, fill: C.muted });
  });

  // Executor
  b += arrow(860, 712, 860, 744, { color: C.blue, width: 2.2, marker: "arrow-blue" });
  b += bandLabel(58, 752, "EXECUTOR", C.amber);
  b += rect(178, 742, 1364, 160, { rx: 18, fill: "#fffdf5", stroke: "#fef3c7", sw: 1.4 });
  const ex = [
    ["ACP Client", "stdio JSON-RPC", "initialize → session/new"],
    ["node-pty", "真实终端会话", "输出回放 / 退出码"],
    ["git worktree", "每个 run 隔离", "harness/<key>-<run>"],
    ["CDP Preview", "只读元素拾取", "webview guest only"],
  ];
  ex.forEach(([title, s1, s2], i) => {
    const x = 198 + i * 335;
    b += rect(x, 760, 315, 120, { rx: 12, fill: C.white, stroke: "#fde68a", sw: 1.2, shadow: true });
    b += txt(x + 16, 790, title, { size: 18, weight: 750, family: MONO });
    b += txt(x + 16, 818, s1, { size: 13, fill: C.muted });
    b += txt(x + 16, 840, s2, { size: 12, fill: "#b45309", family: MONO });
  });

  // External
  b += arrow(860, 904, 860, 932, { color: C.slate, width: 1.8, marker: "arrow-slate", dash: "5 5" });
  const exts = [
    ["dsh --profile acp", C.greenSoft, C.green],
    ["SQLite  harness.db", C.blueSoft, C.blue],
    ["git / ssh", C.amberSoft, C.amber],
    ["webview / CDP", C.cyanSoft, C.cyan],
  ];
  exts.forEach(([label, fill, color], i) => {
    const x = 198 + i * 338;
    b += pill(x, 936, 306, 38, label, { fill, color, size: 14, weight: 650, family: MONO });
  });
  b += txt(1542, 96, "故障隔离：每个 run 一个 dsh 子进程", { size: 12, fill: C.faint, anchor: "end" });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ACP sequence
// ─────────────────────────────────────────────────────────────────────────────
function acpSequence() {
  const w = 1600, h = 1000;
  let b = "";
  b += sectionTitle("一次 run 的 ACP 时序", "UI 发一句话 → 调度 → dsh 执行 → 流式落库 → 审批 / 收尾，全程有状态事件");

  const lanes = [
    { x: 220, label: "UI / Renderer", color: C.blue, fill: C.blueSoft },
    { x: 650, label: "Main Process", color: C.purple, fill: C.purpleSoft },
    { x: 1040, label: "SQLite", color: C.amber, fill: C.amberSoft },
    { x: 1410, label: "dsh（ACP）", color: C.green, fill: C.greenSoft },
  ];
  lanes.forEach((l) => {
    b += rect(l.x - 110, 124, 220, 58, { rx: 12, fill: l.fill, stroke: "none" });
    b += txt(l.x, 160, l.label, { size: 18, weight: 700, fill: l.color, anchor: "middle" });
    b += `<line x1="${l.x}" y1="182" x2="${l.x}" y2="918" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="5 5"/>`;
  });

  const msgs = [
    { y: 232, from: 0, to: 1, color: C.blue, marker: "arrow-blue", label: "send(threadId, text)" },
    { y: 274, from: 1, to: 2, color: C.amber, marker: "arrow-amber", label: "addMessage(thread_id, ...)" },
    { y: 316, from: 1, to: 1, color: C.purple, marker: "arrow-purple", label: "tick() → queueRun()", self: true },
    { y: 364, from: 1, to: 3, color: C.green, marker: "arrow-green", label: "spawn + initialize" },
    { y: 406, from: 1, to: 3, color: C.green, marker: "arrow-green", label: "session/new(cwd)" },
    { y: 448, from: 1, to: 3, color: C.green, marker: "arrow-green", label: "session/prompt(任务)" },
    { y: 490, from: 3, to: 1, color: C.blue, marker: "arrow-blue", label: "session/update*（流式）" },
    { y: 532, from: 1, to: 2, color: C.amber, marker: "arrow-amber", label: "合并 message / tool / artifact" },
    { y: 574, from: 1, to: 0, color: C.blue, marker: "arrow-blue", label: "broadcast(snapshot)" },
    { y: 622, from: 3, to: 1, color: C.red, marker: "arrow-red", label: "request_permission" },
    { y: 664, from: 1, to: 0, color: C.red, marker: "arrow-red", label: "审批弹窗（等待输入）" },
    { y: 706, from: 0, to: 1, color: C.red, marker: "arrow-red", label: "allow / deny" },
    { y: 748, from: 1, to: 3, color: C.red, marker: "arrow-red", label: "outcome.selected" },
    { y: 796, from: 3, to: 1, color: C.green, marker: "arrow-green", label: "prompt result" },
    { y: 838, from: 1, to: 2, color: C.amber, marker: "arrow-amber", label: "completed" },
    { y: 880, from: 1, to: 0, color: C.blue, marker: "arrow-blue", label: "state / 待确认" },
  ];

  msgs.forEach((m) => {
    if (m.self) {
      b += path(`M${lanes[1].x},${m.y} h56 v28 h-56`, { color: m.color, marker: m.marker, width: 2 });
      b += txt(lanes[1].x + 66, m.y + 18, m.label, { size: 14, fill: m.color, family: MONO, weight: 600 });
      return;
    }
    const x1 = lanes[m.from].x;
    const x2 = lanes[m.to].x;
    const dir = x2 > x1 ? 1 : -1;
    b += arrow(x1, m.y, x2 - dir * 8, m.y, { color: m.color, marker: m.marker, width: 2 });
    const mid = (x1 + x2) / 2;
    const labelW = Math.max(150, String(m.label).length * 7.2);
    b += rect(mid - labelW / 2 - 7, m.y - 26, labelW + 14, 20, { rx: 5, fill: "#f8fafc", stroke: "none" });
    b += txt(mid, m.y - 12, m.label, { size: 13.5, fill: m.color, anchor: "middle", family: MONO, weight: 600 });
  });

  b += rect(58, 934, 1484, 44, { rx: 10, fill: "#eff6ff", stroke: "#bfdbfe" });
  b += txt(76, 961, "关键：每个 run 一个 dsh 子进程 · 故障隔离 · run 结束把 pending 纠偏统一标 failed · 没有回执就不算“已注入”", {
    size: 13.5, fill: "#1d4ed8", weight: 600,
  });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Data model
// ─────────────────────────────────────────────────────────────────────────────
function dataModel() {
  const w = 1600, h = 1000;
  let b = "";
  b += sectionTitle("数据模型：消息的宿主从 todo 变成 thread", "这是整个项目最重要的一次重构：没有任务也可以有对话，派活只是会话里的一条消息");

  b += entity(58, 132, 252, 190, "projects", C.blue, ["id", "name", "path", "alias", "last_opened_at"]);
  b += entity(58, 330, 252, 180, "hosts", C.cyan, ["id", "kind", "addr", "caps", "status"]);
  b += entity(360, 330, 270, 190, "agents", C.purple, ["id", "cli", "alias", "host_id", "max_concurrency"]);
  b += entity(360, 132, 270, 205, "todos", C.green, ["id", "key", "title", "status", "project_id", "confirmed"]);

  b += entity(690, 132, 320, 238, "threads", C.purple, ["id", "todo_id（可空）", "project_id", "agent_id", "*model", "*effort", "updated_at"]);
  b += entity(1070, 132, 400, 238, "messages", C.amber, ["id", "*thread_id（宿主）", "todo_id（兼容）", "run_id", "role / kind", "*delivery", "*context"]);
  b += entity(690, 420, 320, 270, "runs", C.red, ["id", "todo_id", "agent_id", "host_id", "status", "cwd / branch", "queue_wait_ms / duration_ms", "tokens / error_class"]);
  b += entity(1070, 420, 400, 190, "artifacts", C.cyan, ["id", "todo_id / run_id", "kind", "ref", "deep_link"]);
  b += entity(1070, 620, 400, 120, "settings / events", C.slate, ["settings(k, v)", "events(id, ts, type, text)"]);

  // relations
  b += arrow(310, 240, 360, 240, { color: C.blue, marker: "arrow-blue" });
  b += txt(335, 230, "1:n", { size: 11, fill: C.blue, anchor: "middle", family: MONO });

  b += arrow(310, 420, 360, 420, { color: C.cyan, marker: "arrow-slate" });
  b += txt(335, 410, "1:n", { size: 11, fill: C.cyan, anchor: "middle", family: MONO });

  b += arrow(630, 220, 690, 220, { color: C.purple, marker: "arrow-purple" });
  b += txt(660, 210, "1:1", { size: 11, fill: C.purple, anchor: "middle", family: MONO });

  b += path("M630,300 C660,300 660,450 690,450", { color: C.red, marker: "arrow-red" });
  b += txt(656, 362, "1:n", { size: 11, fill: C.red, anchor: "middle", family: MONO });

  b += arrow(630, 500, 690, 540, { color: C.purple, marker: "arrow-purple" });
  b += txt(660, 530, "n:1", { size: 11, fill: C.purple, anchor: "middle", family: MONO });

  b += arrow(1010, 230, 1070, 230, { color: C.amber, marker: "arrow-amber" });
  b += txt(1040, 220, "1:n", { size: 11, fill: C.amber, anchor: "middle", family: MONO });

  b += path("M1010,500 C1040,500 1040,330 1070,330", { color: C.amber, marker: "arrow-amber" });
  b += txt(1044, 408, "1:n", { size: 11, fill: C.amber, anchor: "middle", family: MONO });

  b += arrow(1010, 530, 1070, 490, { color: C.cyan, marker: "arrow-slate" });
  b += txt(1040, 520, "1:n", { size: 11, fill: C.cyan, anchor: "middle", family: MONO });

  // callout
  b += rect(58, 792, 1412, 154, { rx: 16, fill: "#fffbeb", stroke: "#fde68a", sw: 1.4 });
  b += rect(58, 792, 6, 154, { rx: 3, fill: C.amber });
  b += txt(84, 826, "关键改造", { size: 18, weight: 750, fill: "#92400e" });
  b += txt(84, 858, "旧：messages.todo_id 是消息宿主 → 新：messages.thread_id 是宿主。todo_id 只保留用于项目过滤与旧数据兼容。", {
    size: 15, fill: "#78350f",
  });
  b += txt(84, 890, "delivery = pending | injected | failed，只描述“这条纠偏消息投递到 run 的结果”，不是任务状态。", {
    size: 15, fill: "#78350f",
  });
  b += txt(84, 922, "thread 可以先于 todo 存在：草稿会话发一句话才生成任务；失败时用户原话仍在会话里。", {
    size: 15, fill: "#78350f",
  });

  // legend
  b += rect(1220, 812, 220, 34, { rx: 8, fill: C.white, stroke: "#fde68a" });
  b += `<circle cx="1240" cy="829" r="4" fill="${C.amber}"/>`;
  b += txt(1252, 834, "本次新增 / 改义字段", { size: 12, fill: "#92400e" });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Send state machine
// ─────────────────────────────────────────────────────────────────────────────
function sendState() {
  const w = 1600, h = 1000;
  let b = "";
  b += sectionTitle("send()：单一入口，六种去向", "先落消息，再按会话状态决定行为；所有分支都写同一条 messages 表");

  // start
  b += rect(58, 404, 260, 112, { rx: 16, fill: C.dark, shadow: true });
  b += txt(188, 444, "send()", { size: 30, weight: 750, fill: "#dbeafe", anchor: "middle", family: MONO });
  b += txt(188, 472, "threadId · text · context", { size: 12, fill: "#93a4c4", anchor: "middle", family: MONO });
  b += txt(188, 495, "先落消息", { size: 12, fill: "#34d399", anchor: "middle", weight: 600 });

  const branches = [
    { y: 100, title: "草稿会话", sub: "thread.todoId == null", mode: "dispatch", color: C.green, fill: C.greenSoft, detail: "建 TODO + queueRun" },
    { y: 220, title: "有 running / waiting_input", sub: "activeRunOf(todo.id)", mode: "steer", color: C.blue, fill: C.blueSoft, detail: "投给同一个 ACP client" },
    { y: 340, title: "有 queued run", sub: "还没开跑", mode: "queued", color: C.amber, fill: C.amberSoft, detail: "挂到本轮，startRun 时拼 prompt" },
    { y: 460, title: "有任务、无 run", sub: "未确认", mode: "run", color: C.purple, fill: C.purpleSoft, detail: "新起一次 run，消息带 runId" },
    { y: 580, title: "已确认", sub: "confirmed == true", mode: "note", color: C.slate, fill: C.lineSoft, detail: "只记录，不新建 run" },
    { y: 700, title: "没有可用 Agent", sub: "没有执行适配器", mode: "error", color: C.red, fill: C.redSoft, detail: "不创建任务，保留草稿" },
  ];

  branches.forEach((br) => {
    b += path(`M318,460 C350,460 330,${br.y + 44} 372,${br.y + 44}`, { color: br.color, marker: `arrow-${br.color === C.slate ? "slate" : br.color === C.blue ? "blue" : br.color === C.green ? "green" : br.color === C.amber ? "amber" : br.color === C.red ? "red" : "purple"}`, width: 1.8, opacity: 0.85 });
    b += rect(372, br.y, 476, 88, { rx: 13, fill: C.white, stroke: br.color, sw: 1.4, shadow: true });
    b += rect(372, br.y, 5, 88, { rx: 2.5, fill: br.color });
    b += txt(392, br.y + 28, br.title, { size: 18, weight: 700 });
    b += txt(392, br.y + 50, br.sub, { size: 12.5, fill: C.muted, family: MONO });
    b += pill(690, br.y + 14, 138, 30, br.mode, { fill: br.fill, color: br.color, size: 14, weight: 750, family: MONO });
    b += txt(392, br.y + 73, br.detail, { size: 12.5, fill: br.color, weight: 600 });
  });

  // steer outcomes
  b += arrow(848, 264, 912, 264, { color: C.blue, marker: "arrow-blue" });
  b += rect(912, 214, 260, 70, { rx: 12, fill: C.greenSoft, stroke: C.green, sw: 1.3 });
  b += txt(1042, 243, "injected", { size: 18, weight: 750, fill: C.green, anchor: "middle", family: MONO });
  b += txt(1042, 266, "prompt 成功 + 回执", { size: 12, fill: "#047857", anchor: "middle" });

  b += arrow(848, 304, 912, 344, { color: C.blue, marker: "arrow-blue" });
  b += rect(912, 320, 260, 70, { rx: 12, fill: C.redSoft, stroke: C.red, sw: 1.3 });
  b += txt(1042, 349, "failed", { size: 18, weight: 750, fill: C.red, anchor: "middle", family: MONO });
  b += txt(1042, 372, "保留消息 · 可重发", { size: 12, fill: "#991b1b", anchor: "middle" });

  // pending
  b += rect(912, 424, 260, 70, { rx: 12, fill: C.bluePale, stroke: "#93c5fd", sw: 1.3 });
  b += txt(1042, 453, "pending →", { size: 18, weight: 750, fill: C.blue, anchor: "middle", family: MONO });
  b += txt(1042, 476, "run 结束 / 停止统一标 failed", { size: 12, fill: "#1d4ed8", anchor: "middle" });
  b += path("M848,264 C880,264 880,459 912,459", { color: C.blue, marker: "arrow-blue", dash: "5 5" });

  // dispatch detail
  b += rect(912, 100, 360, 88, { rx: 12, fill: "#f0fdf4", stroke: "#86efac", sw: 1.2 });
  b += txt(932, 132, "todo = createTodoFromMessage()", { size: 13, fill: "#166534", family: MONO });
  b += txt(932, 156, "run = queueRun(todo, agent, \"chat\")", { size: 13, fill: "#166534", family: MONO });
  b += txt(932, 178, "message.runId = run.id", { size: 13, fill: "#166534", family: MONO });

  // error detail
  b += rect(912, 700, 360, 88, { rx: 12, fill: "#fff1f2", stroke: "#fda4af", sw: 1.2 });
  b += txt(932, 732, "不产生孤儿 todo", { size: 14, fill: "#9f1239", weight: 650 });
  b += txt(932, 756, "输入框内容保留", { size: 14, fill: "#9f1239" });
  b += txt(932, 778, "mode === \"error\"", { size: 12, fill: "#be123c", family: MONO });

  b += rect(58, 842, 1484, 46, { rx: 10, fill: "#eff6ff", stroke: "#bfdbfe" });
  b += txt(78, 871, "为什么只有一个入口：派活 / 纠偏 / 排队补充 / 仅记录 共用同一套状态机，避免每个能力写两遍。", {
    size: 13.5, fill: "#1d4ed8", weight: 600,
  });
  b += txt(58, 928, "改造前：messages 只能挂 todo_id，Chat 被迫分成「分派表单」和「会话」两态；改造后：thread 永远存在。", {
    size: 13, fill: C.muted,
  });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Scheduler
// ─────────────────────────────────────────────────────────────────────────────
function scheduler() {
  const w = 1600, h = 1000;
  let b = "";
  b += sectionTitle("调度器：一个 tick 循环，五道闸门", "每次状态 / 设置 / 任务变化都调用 tick()；排队原因写进 queueReason，不让用户只看到 spinner");

  b += rect(560, 110, 320, 70, { rx: 14, fill: C.dark, shadow: true });
  b += txt(720, 140, "queued run", { size: 24, weight: 750, fill: "#dbeafe", anchor: "middle", family: MONO });
  b += txt(720, 162, "createdAt / queueReason", { size: 12, fill: "#93a4c4", anchor: "middle", family: MONO });

  const gates = [
    ["主机在线？", "host.status !== \"online\"", "主机离线", C.red],
    ["全局并发未满？", "settings.maxConcurrentRuns", "等待全局并发", C.amber],
    ["主机并发未满？", "host.maxConcurrency", "主机并发已满", C.orange || C.amber],
    ["Agent 有空位？", "agent.max || 1", "Agent 忙", C.blue],
    ["同 cwd 没有运行？", "t.cwd === todo.cwd", "同目录串行", C.purple],
  ];

  gates.forEach((g, i) => {
    const y = 214 + i * 106;
    b += arrow(720, y - 26, 720, y - 4, { color: C.slate, marker: "arrow-slate", width: 1.8 });
    b += rect(540, y, 360, 76, { rx: 39, fill: C.white, stroke: g[3], sw: 1.6, shadow: true });
    b += txt(720, y + 31, g[0], { size: 19, weight: 700, anchor: "middle" });
    b += txt(720, y + 54, g[1], { size: 12, fill: C.muted, anchor: "middle", family: MONO });
    b += arrow(900, y + 38, 982, y + 38, { color: g[3], marker: g[3] === C.red ? "arrow-red" : g[3] === C.amber ? "arrow-amber" : g[3] === C.blue ? "arrow-blue" : "arrow-purple", width: 1.8 });
    b += rect(982, y + 8, 300, 58, { rx: 10, fill: "#fff", stroke: g[3], sw: 1.1, dash: "5 4" });
    b += txt(1000, y + 32, "queueReason =", { size: 11, fill: C.muted, family: MONO });
    b += txt(1000, y + 52, `"${g[2]}"`, { size: 14, fill: g[3], weight: 700, family: MONO });
    b += txt(720, y + 92, "是 ↓", { size: 11, fill: C.green, anchor: "middle", weight: 650 });
  });

  b += arrow(720, 728, 720, 760, { color: C.green, marker: "arrow-green", width: 2.4 });
  b += rect(540, 764, 360, 84, { rx: 16, fill: C.greenSoft, stroke: C.green, sw: 1.8, shadow: true });
  b += txt(720, 798, "startRun()", { size: 26, weight: 750, fill: C.green, anchor: "middle", family: MONO });
  b += txt(720, 824, "worktree → ACP → 流式落库", { size: 13, fill: "#047857", anchor: "middle" });

  // left notes
  b += rect(58, 214, 400, 630, { rx: 16, fill: "#f8fafc", stroke: "#e2e8f0", sw: 1.2 });
  b += txt(82, 258, "tick() 读什么", { size: 16, weight: 750, fill: C.slate });
  const notes = [
    ["state.runs", "status === \"queued\""],
    ["state.hosts", "online / maxConcurrency"],
    ["state.agents", "max / hostId"],
    ["state.todos", "cwd / status"],
    ["settings", "maxConcurrentRuns"],
  ];
  notes.forEach(([k, v], i) => {
    b += txt(82, 300 + i * 48, k, { size: 14, fill: C.blue, family: MONO, weight: 650 });
    b += txt(82, 322 + i * 48, v, { size: 12, fill: C.muted, family: MONO });
  });
  b += `<line x1="82" y1="540" x2="434" y2="540" stroke="#e2e8f0"/>`;
  b += txt(82, 574, "为什么同 cwd 串行？", { size: 14, weight: 700, fill: C.purple });
  b += lines(82, 600, ["两个 Agent 同时改同一份文件，", "冲突成本远高于排队。", "跨 worktree 才并行。"], { size: 12.5, fill: C.muted, lh: 22 });

  // right notes
  b += rect(1320, 214, 222, 630, { rx: 16, fill: "#fffbeb", stroke: "#fde68a", sw: 1.2 });
  b += txt(1342, 258, "不做的", { size: 16, weight: 750, fill: "#92400e" });
  b += lines(1342, 296, ["不写守护进程", "不做分布式锁", "不做任务图引擎", "不做自动重试风暴"], { size: 13, fill: "#78350f", lh: 34 });
  b += `<line x1="1342" y1="444" x2="1520" y2="444" stroke="#fde68a"/>`;
  b += txt(1342, 478, "先跑通闭环，", { size: 13, fill: "#92400e", weight: 650 });
  b += txt(1342, 500, "再谈调度性能。", { size: 13, fill: "#92400e", weight: 650 });

  b += rect(58, 900, 1484, 46, { rx: 10, fill: "#eff6ff", stroke: "#bfdbfe" });
  b += txt(78, 929, "为什么一个 tick 够用：单用户桌面应用，run 数量有限；每次变化重算队列，逻辑简单、可解释、可调试。", {
    size: 13.5, fill: "#1d4ed8", weight: 600,
  });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. UI context
// ─────────────────────────────────────────────────────────────────────────────
function uiContext() {
  const w = 1600, h = 1000;
  let b = "";
  b += sectionTitle("让 Agent 看见界面：预览页元素拾取", "点中元素 → 结构化 ElementContext → Chat chip → <ui-context> 注入 prompt");

  const steps = [
    ["PTY 输出", "识别 http://localhost:5173", C.amber],
    ["预览标签", "webview + 独立 partition", C.blue],
    ["拾取元素", "Overlay.setInspectMode", C.purple],
    ["CDP collect", "selector / styles / box / screenshot", C.cyan],
    ["ElementContext", "structured JSON", C.green],
  ];
  steps.forEach(([title, sub, color], i) => {
    const y = 132 + i * 118;
    b += rect(58, y, 520, 88, { rx: 13, fill: C.white, stroke: color, sw: 1.3, shadow: true });
    b += rect(58, y, 5, 88, { rx: 2.5, fill: color });
    b += txt(80, y + 32, title, { size: 18, weight: 700 });
    b += txt(80, y + 55, sub, { size: 12.5, fill: C.muted, family: MONO });
    b += `<circle cx="548" cy="${y + 44}" r="14" fill="${C.white}" stroke="${color}" stroke-width="1.5"/>`;
    b += txt(548, y + 49, String(i + 1), { size: 12, fill: color, anchor: "middle", weight: 750 });
    if (i < steps.length - 1) b += arrow(548, y + 58, 548, y + 108, { color: C.slate, marker: "arrow-slate", width: 1.5, dash: "4 4" });
  });

  // browser mock
  b += arrow(578, 570, 650, 570, { color: C.green, marker: "arrow-green", width: 2.2 });
  b += rect(650, 128, 892, 448, { rx: 14, fill: C.white, stroke: "#cbd5e1", sw: 1.4, shadow: true });
  b += rect(650, 128, 892, 42, { rx: 14, fill: "#f1f5f9" });
  b += rect(650, 156, 892, 14, { fill: "#f1f5f9" });
  b += `<circle cx="674" cy="149" r="5" fill="#f87171"/><circle cx="692" cy="149" r="5" fill="#fbbf24"/><circle cx="710" cy="149" r="5" fill="#34d399"/>`;
  b += rect(736, 137, 500, 24, { rx: 6, fill: C.white, stroke: "#e2e8f0" });
  b += txt(750, 154, "http://localhost:5173/", { size: 11.5, fill: C.muted, family: MONO });
  b += txt(1490, 154, "拾取元素", { size: 11, fill: C.blue, anchor: "end", weight: 650 });

  // page
  b += rect(650, 170, 892, 406, { fill: "#fbfdff" });
  b += rect(690, 218, 812, 58, { rx: 10, fill: C.bluePale, stroke: "#bfdbfe" });
  b += txt(720, 255, "让 Agent 真正干活", { size: 27, weight: 800, fill: "#1e3a8a" });
  b += txt(690, 310, "多智能体终端 · 从 0 到 1", { size: 14, fill: C.muted });
  b += rect(690, 340, 250, 30, { rx: 7, fill: C.blue });
  b += txt(815, 360, "开始使用", { size: 12, fill: C.white, anchor: "middle", weight: 650 });
  b += rect(960, 340, 250, 30, { rx: 7, fill: C.white, stroke: "#cbd5e1" });
  b += txt(1085, 360, "查看文档", { size: 12, fill: C.slate, anchor: "middle" });
  b += rect(690, 406, 812, 136, { rx: 10, fill: "#f1f5f9", stroke: "#e2e8f0" });
  b += txt(716, 442, "▦  任务看板", { size: 14, fill: C.slate, weight: 650 });
  b += rect(716, 462, 240, 52, { rx: 7, fill: C.white, stroke: "#e2e8f0" });
  b += rect(972, 462, 240, 52, { rx: 7, fill: C.white, stroke: "#e2e8f0" });
  b += rect(1228, 462, 240, 52, { rx: 7, fill: C.white, stroke: "#e2e8f0" });
  b += txt(730, 486, "运行中 · 2", { size: 11, fill: C.green, weight: 650 });
  b += txt(986, 486, "待确认 · 2", { size: 11, fill: C.blue, weight: 650 });
  b += txt(1242, 486, "已确认 · 8", { size: 11, fill: C.muted, weight: 650 });

  // highlight
  b += `<rect x="684" y="212" width="824" height="70" rx="11" fill="none" stroke="${C.purple}" stroke-width="2.5" stroke-dasharray="7 5"/>`;
  b += rect(1240, 184, 250, 30, { rx: 15, fill: C.purple });
  b += txt(1365, 204, "h1.hero  ·  HeroTitle", { size: 11.5, fill: C.white, anchor: "middle", family: MONO });
  b += txt(690, 202, "点中元素：高亮 + 尺寸 / 标签提示", { size: 11, fill: C.purple, family: MONO });

  // context card
  b += arrow(1096, 576, 1096, 612, { color: C.green, marker: "arrow-green", width: 2 });
  b += rect(650, 616, 892, 172, { rx: 13, fill: "#0b1220", shadow: true });
  b += txt(672, 646, "ElementContext", { size: 15, weight: 750, fill: "#dbeafe", family: MONO });
  b += txt(1518, 646, "JSON", { size: 11, fill: "#64748b", anchor: "end", family: MONO });
  const rows = [
    ['selector', '"#app > main > h1.hero"'],
    ['source', '"src/pages/Home.tsx:42"'],
    ['component', '"HeroTitle"'],
    ['styles', '"font-size: 32px; color: #111827"'],
    ['screenshot', '"…/userData/ui-context/ctx-m3k2.png"'],
  ];
  rows.forEach(([k, v], i) => {
    const y = 676 + i * 22;
    b += txt(672, y, `"${k}"`, { size: 11.5, fill: "#93c5fd", family: MONO });
    b += txt(790, y, `: ${v}`, { size: 11.5, fill: "#cbd5e1", family: MONO });
  });

  // prompt flow
  b += arrow(1096, 788, 1096, 822, { color: C.blue, marker: "arrow-blue", width: 2 });
  b += rect(650, 826, 892, 62, { rx: 12, fill: C.bluePale, stroke: "#bfdbfe", sw: 1.2 });
  b += txt(672, 854, "Chat chip  →  <ui-context url / selector / source>  →  Agent prompt", {
    size: 14, fill: "#1d4ed8", weight: 700, family: MONO,
  });
  b += txt(672, 875, "消息本身仍只显示用户那句话；chip 单独渲染，注入内容可见。", { size: 12, fill: "#3b82f6" });

  // security
  b += rect(58, 824, 528, 118, { rx: 14, fill: "#fff1f2", stroke: "#fda4af", sw: 1.2 });
  b += txt(80, 854, "安全边界（写死的）", { size: 15, weight: 750, fill: "#9f1239" });
  b += txt(80, 880, "只接受 webContents.getType() === \"webview\"", { size: 11.5, fill: "#be123c", family: MONO });
  b += txt(80, 902, "无 preload · nodeIntegration=no · partition=preview", { size: 11.5, fill: "#be123c", family: MONO });
  b += txt(80, 924, "截图写入 userData/ui-context，不污染 worktree", { size: 11.5, fill: "#be123c", family: MONO });

  return svgDoc(w, h, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Packaging
// ─────────────────────────────────────────────────────────────────────────────
function packaging() {
  const w = 1600, h = 900;
  let b = "";
  b += sectionTitle("打包：把 dsh 运行时塞进 App", "安装即用优先于包体小：单文件运行时约 260–306MB，App 约 350–600MB");

  // app bundle
  b += rect(58, 128, 820, 584, { rx: 16, fill: C.white, stroke: "#cbd5e1", sw: 1.4, shadow: true });
  b += rect(58, 128, 820, 46, { rx: 16, fill: C.dark });
  b += rect(58, 158, 820, 16, { fill: C.dark });
  b += txt(80, 159, "Cockpit Harness.app / Contents", { size: 15, weight: 700, fill: "#dbeafe", family: MONO });
  b += txt(856, 159, "macOS", { size: 11, fill: "#93a4c4", anchor: "end", family: MONO });

  const dirs = [
    ["MacOS/", "Cockpit Harness", "Electron 主程序", C.blue],
    ["Resources/app.asar", "dist/**/* · electron/**/* · package.json", "前端 + 主进程代码", C.purple],
    ["Resources/app.asar.unpacked/", "node_modules/node-pty/** · sql.js/*.wasm", "原生模块 / WASM 必须解包", C.amber],
    ["Resources/dsh/", "dsh · dsh-rg · dsh-spawn-helper · manifest.json", "内置单文件运行时", C.green],
  ];
  dirs.forEach(([name, sub, note, color], i) => {
    const y = 196 + i * 120;
    b += rect(80, y, 776, 100, { rx: 11, fill: "#f8fafc", stroke: "#e2e8f0", sw: 1.1 });
    b += rect(80, y, 5, 100, { rx: 2.5, fill: color });
    b += txt(102, y + 30, name, { size: 16, weight: 750, family: MONO, fill: color });
    b += txt(102, y + 54, sub, { size: 12.5, fill: C.slate, family: MONO });
    b += txt(102, y + 78, note, { size: 12, fill: C.muted });
  });

  // userData
  b += rect(920, 128, 622, 240, { rx: 16, fill: "#fffbeb", stroke: "#fde68a", sw: 1.3, shadow: true });
  b += txt(944, 162, "userData /（不打包，跟着用户走）", { size: 15, weight: 750, fill: "#92400e", family: MONO });
  const ud = [
    ["harness.db", "单文件 SQLite，升级前备份即可"],
    ["ui-context/", "元素截图，不污染项目 worktree"],
    ["worktrees/", "每个 run 一个 git worktree"],
  ];
  ud.forEach(([k, v], i) => {
    const y = 198 + i * 50;
    b += txt(944, y, k, { size: 13, fill: "#92400e", weight: 700, family: MONO });
    b += txt(1120, y, v, { size: 12, fill: "#78350f" });
  });

  // outputs
  b += rect(920, 400, 622, 312, { rx: 16, fill: C.bluePale, stroke: "#bfdbfe", sw: 1.3, shadow: true });
  b += txt(944, 434, "构建产物", { size: 15, weight: 750, fill: "#1d4ed8" });
  const outs = [
    ["macOS", "dmg（arm64 / x64）", "electron-builder"],
    ["Windows", "nsis（x64）", "CI windows-2022"],
    ["Linux", "AppImage（x64 / arm64）", "必须在 Linux 重建 node-pty"],
  ];
  outs.forEach(([os, out, note], i) => {
    const y = 470 + i * 66;
    b += rect(944, y, 574, 54, { rx: 9, fill: C.white, stroke: "#dbeafe" });
    b += txt(962, y + 22, os, { size: 13, weight: 750, fill: C.blue });
    b += txt(1060, y + 22, out, { size: 13, fill: C.slate, family: MONO });
    b += txt(962, y + 42, note, { size: 11, fill: C.muted });
  });

  // runtime priority
  b += rect(58, 744, 1484, 58, { rx: 11, fill: "#f8fafc", stroke: "#e2e8f0" });
  b += txt(78, 779, "运行时优先级", { size: 14, weight: 750, fill: C.slate });
  b += pill(200, 754, 340, 38, "设置里的 dshBinary", { fill: C.blueSoft, color: C.blue, size: 13, family: MONO });
  b += txt(556, 779, ">", { size: 18, fill: C.faint, anchor: "middle" });
  b += pill(590, 754, 340, 38, "Resources/dsh/dsh", { fill: C.greenSoft, color: C.green, size: 13, family: MONO });
  b += txt(946, 779, ">", { size: 18, fill: C.faint, anchor: "middle" });
  b += pill(980, 754, 300, 38, "系统 PATH 里的 dsh", { fill: C.amberSoft, color: C.amber, size: 13, family: MONO });

  b += rect(58, 824, 1484, 46, { rx: 10, fill: "#ecfdf5", stroke: "#a7f3d0" });
  b += txt(78, 853, "取舍：内置运行时换安装成功率；需要轻量包用 npm run dist:system，依赖目标机器自己的 dsh。签名 / 公证 / 自动更新仍未做。", {
    size: 13.5, fill: "#047857", weight: 600,
  });

  return svgDoc(w, h, b);
}

module.exports = {
  images: [
    cover,
    layout,
    { name: "architecture", width: 1600, height: 1000, svg: architecture() },
    { name: "acp-sequence", width: 1600, height: 1000, svg: acpSequence() },
    { name: "data-model", width: 1600, height: 1000, svg: dataModel() },
    { name: "send-state", width: 1600, height: 1000, svg: sendState() },
    { name: "scheduler", width: 1600, height: 1000, svg: scheduler() },
    { name: "ui-context", width: 1600, height: 1000, svg: uiContext() },
    { name: "packaging", width: 1600, height: 900, svg: packaging() },
  ],
};
