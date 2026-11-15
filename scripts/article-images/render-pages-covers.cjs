// 生成 GitHub Pages / Wiki 用的两张封面（场景、记忆），与 cover-terminal 同一套版式。
// 用法：npx electron scripts/article-images/render-pages-covers.cjs
// cover-office 依赖本地截图 docs/assets/article/sc-03-office-live.png；
// cover-memory 用纯 HTML 合成卡片（示例数据），不再依赖真实记忆截图，避免把个人内容带进仓库。
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "public/wiki");
const SCALE = 2;
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

const COVERS = [
  {
    name: "cover-office",
    // 场景文章配图有两套命名（数字图号 / sc-*），取先存在的
    files: ["docs/assets/article/sc-03-office-live.png", "docs/assets/article/20-office-live.png"],
    eyebrow: "COCKPIT HARNESS · AGENT OFFICE",
    title: ["从状态到", "舞台"],
    sub: "真实 run / 审批 / 验收，映射成工位、审批台、验收架。",
    pills: ["办公室 2.5D", "作战室 3D", "航母 3D", "同一份 OfficeModel"],
    bar: "场景 · 办公室实况",
    foot: "舞台只读状态，不改调度",
    pos: "26% 34%",
  },
  {
    name: "cover-memory",
    files: [],
    mock: "memory",
    eyebrow: "COCKPIT HARNESS · MEMORY",
    title: ["记住该记的", "忘掉该忘的"],
    sub: "四层记忆 + Dream：机器只提议，人点头才落盘。",
    pills: ["L1 会话", "L2 note", "L3 知识", "L4 注入", "打分预算"],
    bar: "记忆 · 四层 + Dream",
    foot: "越往上越小，每次只喂目录",
    pos: "62% 30%",
  },
];

function picked(cover) {
  for (const file of cover.files) if (fs.existsSync(path.join(ROOT, file))) return file;
  return null;
}

function mockHtml(kind) {
  if (kind !== "memory") return "";
  const rows = [
    ["L4", "g", "注入", "目录 · 每轮按预算选 ≤12k", 34],
    ["L3", "b", "知识", "资料 + 页面 · 可审核", 58],
    ["L2", "y", "note", "观察与猜测 · 必须带来源", 42],
    ["L1", "m", "会话", "原始消息 / run / 事件 · 只读", 76],
  ];
  return `<div class="mem">
    <div class="memtop"><span class="memkicker">MEMORY · 4 LAYERS</span><span class="memtag">示例数据</span></div>
    <div class="membody">
      <div class="memlayers">${rows
        .map(
          ([n, tone, name, desc, w]) =>
            `<div class="memrow ${tone}"><b>${n}</b><div><strong>${name}</strong><span>${desc}</span><i style="--w:${w}%"></i></div></div>`,
        )
        .join("")}</div>
      <div class="memaside">
        <span class="memkicker">DREAM</span>
        <b>只提议，不自动改</b>
        <ul><li>失效 / 衰减 / 到期 / 合并</li><li>打分注入 · 注入台账</li><li>越往上越小</li></ul>
      </div>
    </div>
  </div>`;
}

function html(cover) {
  const shot = cover.mock
    ? mockHtml(cover.mock)
    : `<img src="file://${path.join(ROOT, picked(cover))}" alt=""><div class="fade"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;width:${1600 * SCALE}px;height:${900 * SCALE}px;overflow:hidden;background:#070d1a}
    .stage{position:relative;width:1600px;height:900px;overflow:hidden;font-family:${FONT};color:#e8eefc;
      transform:scale(${SCALE});transform-origin:top left;
      background:
        radial-gradient(900px 520px at 76% 24%,rgba(37,99,235,.30),transparent 62%),
        radial-gradient(760px 520px at 68% 82%,rgba(16,185,129,.17),transparent 62%),
        linear-gradient(135deg,#070d1a 0%,#0b1426 58%,#0e1a30 100%);}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.075) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.075) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black 0%,rgba(0,0,0,.65) 65%,transparent 100%)}
    .watermark{position:absolute;right:24px;bottom:-120px;font-size:400px;line-height:1;font-weight:800;color:rgba(96,165,250,.05);letter-spacing:-22px}
    .left{position:absolute;left:96px;top:104px;width:700px}
    .eyebrow{display:flex;align-items:center;gap:12px;font-size:14px;letter-spacing:2.4px;color:#93a4c4;font-weight:600}
    .eyebrow i{display:block;width:34px;height:2px;background:linear-gradient(90deg,#60a5fa,#34d399)}
    h1{margin:30px 0 0;font-size:76px;line-height:1.08;letter-spacing:-2.4px;font-weight:800}
    h1 em{font-style:normal;display:block;background:linear-gradient(92deg,#60a5fa 0%,#38bdf8 45%,#34d399 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
    .sub{margin-top:28px;font-size:21px;line-height:1.6;color:#a9b9d6;letter-spacing:.4px}
    .rule{width:520px;height:1px;background:linear-gradient(90deg,rgba(96,165,250,.75),rgba(52,211,153,.15),transparent);margin:34px 0 28px}
    .pillrow{display:flex;gap:10px;flex-wrap:wrap;max-width:640px}
    .pill{border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.55);color:#c7d6ef;border-radius:999px;padding:9px 15px;font-size:13.5px;letter-spacing:.3px}
    .bottom{position:absolute;left:96px;bottom:66px;display:flex;align-items:center;gap:16px;color:#7f91b2;font-size:13.5px;letter-spacing:.4px}
    .bottom b{color:#c7d6ef;font-weight:600}
    .right{position:absolute;right:64px;top:96px;width:720px;height:708px}
    .win{position:absolute;inset:0;border-radius:18px;background:linear-gradient(180deg,#0d1729,#0a111f);border:1px solid rgba(148,163,184,.26);box-shadow:0 40px 100px rgba(0,0,0,.55),0 0 80px rgba(37,99,235,.16);overflow:hidden}
    .bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 15px;border-bottom:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.72)}
    .dot{width:10px;height:10px;border-radius:50%}
    .dot.r{background:#f87171}.dot.y{background:#fbbf24}.dot.g{background:#34d399}
    .bar .title{margin-left:10px;color:#8fa3c4;font-size:12px;letter-spacing:.4px}
    .shot{position:relative;height:668px;overflow:hidden;background:#0b1220}
    .shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:${cover.pos}}
    .fade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,13,26,.18),transparent 24%,transparent 72%,rgba(7,13,26,.32))}
    .mem{position:relative;height:668px;padding:24px 26px;background:linear-gradient(160deg,#0b1424,#081020);font-family:${FONT};color:#e8eefc}
    .memtop{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid rgba(148,163,184,.16)}
    .memkicker{font:700 11px "SFMono-Regular",Menlo,Consolas,monospace;letter-spacing:.14em;color:#38bdf8}
    .memtag{padding:3px 9px;border:1px solid rgba(148,163,184,.3);border-radius:999px;color:#93a4c4;font:700 10px "SFMono-Regular",Menlo,Consolas,monospace}
    .membody{display:grid;grid-template-columns:1fr 206px;gap:22px;height:calc(100% - 48px);padding-top:12px}
    .memlayers{display:flex;flex-direction:column;justify-content:center}
    .memrow{display:grid;grid-template-columns:42px 1fr;gap:10px;align-items:center;padding:16px 0;border-bottom:1px solid rgba(148,163,184,.14)}
    .memrow:last-child{border-bottom:0}
    .memrow b{font:700 16px "SFMono-Regular",Menlo,Consolas,monospace;color:#60a5fa}
    .memrow strong{display:block;font:700 20px ${FONT};color:#eaf2ff;letter-spacing:-.2px}
    .memrow span{display:block;margin-top:3px;font:500 13px ${FONT};color:#93a4c4}
    .memrow i{grid-column:2;display:block;height:4px;border-radius:99px;width:var(--w);margin-top:5px;background:linear-gradient(90deg,#60a5fa,#34d399);opacity:.6}
    .memrow.y b{color:#fbbf24}.memrow.y i{background:linear-gradient(90deg,#fbbf24,#f87171)}
    .memrow.m b{color:#7f91b2}.memrow.m i{background:linear-gradient(90deg,#64748b,#94a3b8)}
    .memrow.g b{color:#34d399}
    .memaside{border-left:1px solid rgba(148,163,184,.18);padding-left:22px;display:flex;flex-direction:column;justify-content:center}
    .memaside b{display:block;margin-top:8px;font:700 19px ${FONT};color:#e6effc}
    .memaside ul{margin:14px 0 0;padding-left:15px;color:#9fb0cc;font:500 13px/1.9 ${FONT}}
    .memaside li::marker{color:#34d399}
  </style></head><body>
    <div class="stage">
      <div class="grid"></div>
      <div class="watermark">C</div>
      <div class="left">
        <div class="eyebrow"><i></i>${cover.eyebrow}</div>
        <h1>${cover.title[0]}<em>${cover.title[1]}</em></h1>
        <div class="rule"></div>
        <div class="sub">${cover.sub}</div>
        <div class="rule" style="margin:26px 0 24px;width:420px"></div>
        <div class="pillrow">${cover.pills.map((p) => `<span class="pill">${p}</span>`).join("")}</div>
      </div>
      <div class="right">
        <div class="win">
          <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${cover.bar}</span></div>
          <div class="shot">${shot}</div>
        </div>
      </div>
      <div class="bottom"><b>${cover.foot}</b><span>·</span><span>github.com/spin-ai/spin-cockpit-harness</span></div>
    </div>
  </body></html>`;
}

async function capture(win, cover) {
  const tmp = path.join(OUT, `.render-${cover.name}.html`);
  fs.writeFileSync(tmp, html(cover));
  win.setContentSize(1600 * SCALE, 900 * SCALE);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 700));
  const image = await win.webContents.capturePage();
  const png = image.resize({ width: 1600, height: 900, quality: "best" }).toPNG();
  fs.writeFileSync(path.join(OUT, `${cover.name}.png`), png);
  fs.unlinkSync(tmp);
  console.log(`✓ ${cover.name}.png  ${png.length} bytes`);
}

app.whenReady().then(async () => {
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1600 * SCALE,
    height: 900 * SCALE,
    show: false,
    frame: false,
    useContentSize: true,
    resizable: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  for (const cover of COVERS) {
    if (only && cover.name !== only) continue;
    if (!cover.mock && !picked(cover)) {
      console.warn(`skip ${cover.name}: 缺少本地截图 ${cover.files.join(" / ")}`);
      continue;
    }
    await capture(win, cover);
  }
  win.destroy();
  app.quit();
});
