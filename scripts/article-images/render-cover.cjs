// 图 01 · 封面：三间屋子的实拍拼贴（办公室 / 作战室 / 航母）+ 标题。
//
//   npx electron scripts/article-images/render-cover.cjs
//
// 素材用已经抓好的舞台截图（docs/assets/article/sc-*.png），只做排版，不改内容。
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../docs/assets/article");
const W = 1600;
const H = 900;
const SCALE = 2;

const SHOTS = {
  carrier: path.join(OUT, "sc-07-stage-carrier.png"),
  warroom: path.join(OUT, "sc-08-stage-warroom.png"),
  office: path.join(OUT, "sc-03-office-live.png"),
};

const b64 = (file) => fs.readFileSync(file).toString("base64");

function html() {
  const card = (key, label, meta, cls) => `
    <figure class="card ${cls}">
      <img src="data:image/png;base64,${b64(SHOTS[key])}" alt="">
      <figcaption><b>${label}</b><span>${meta}</span></figcaption>
    </figure>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W * SCALE}px;height:${H * SCALE}px;overflow:hidden;background:#060b16}
  .shot{position:relative;width:${W}px;height:${H}px;transform:scale(${SCALE});transform-origin:top left;overflow:hidden;
    background:
      radial-gradient(900px 600px at 78% 22%, rgba(37,99,235,.30), transparent 62%),
      radial-gradient(700px 520px at 82% 86%, rgba(245,158,11,.16), transparent 60%),
      linear-gradient(135deg,#060b16 0%,#0a1324 58%,#0e1b31 100%);
    font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#e8eefc}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.06) 1px,transparent 1px);background-size:48px 48px}
  .kicker{position:absolute;left:96px;top:96px;display:flex;align-items:center;gap:14px;font-size:14px;letter-spacing:2.4px;color:#a9b5cf;font-weight:600}
  .kicker i{display:block;width:34px;height:2px;background:#60a5fa}
  h1{position:absolute;left:96px;top:186px;margin:0;font-size:62px;line-height:1.14;letter-spacing:-2px;font-weight:800}
  h1 em{display:block;font-style:normal;color:#93c5fd;font-size:74px;letter-spacing:-2.6px}
  .sub{position:absolute;left:96px;top:392px;display:flex;gap:10px}
  .sub span{padding:5px 13px;border-radius:999px;font-size:15px;color:#dbeafe;background:rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.3)}
  .lines{position:absolute;left:96px;top:470px;display:flex;flex-direction:column;gap:13px}
  .lines p{margin:0;font-size:21px;color:#a9b9d6;letter-spacing:.2px}
  .lines p b{color:#e2e8f5;font-weight:700}
  .rule{position:absolute;left:96px;top:432px;width:520px;height:1px;background:linear-gradient(90deg,rgba(96,165,250,.6),rgba(96,165,250,0))}
  .meta{position:absolute;left:96px;bottom:78px;display:flex;flex-direction:column;gap:8px;font-size:13px;color:#7f91b2}
  .meta code{font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:12.5px;color:#6f83a5}
  .stack{position:absolute;right:64px;top:96px;width:576px;height:660px}
  .card{position:absolute;margin:0;border-radius:12px;overflow:hidden;
    border:1px solid rgba(148,163,184,.32);box-shadow:0 26px 60px rgba(2,6,23,.6);background:#0b1220}
  .card img{display:block;width:100%;height:auto}
  .card figcaption{display:flex;align-items:baseline;gap:8px;padding:7px 12px;
    background:linear-gradient(180deg,rgba(8,15,29,.96),rgba(8,15,29,.88));border-top:1px solid rgba(148,163,184,.22)}
  .card figcaption b{color:#dbeafe;font-weight:700;font-size:13px}
  .card figcaption span{margin-left:auto;color:#8fa3c4;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:10.5px}
  .carrier{left:0;top:0;width:576px;transform:rotate(-.7deg)}
  .warroom{left:0;top:428px;width:276px;transform:rotate(.9deg)}
  .office{left:300px;top:428px;width:276px;transform:rotate(-.9deg)}
  .warroom figcaption span,.office figcaption span{display:none}
  .badge{position:absolute;bottom:18px;right:18px;display:flex;align-items:center;gap:7px;
    padding:6px 12px;border-radius:999px;background:rgba(8,15,29,.82);border:1px solid rgba(148,163,184,.32);
    font-size:13px;font-weight:700;color:#dbeafe;letter-spacing:.5px;z-index:9}
  .badge .fig{font-size:11px;font-weight:600;color:#93a4c4}
  .badge .n{font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-weight:800}
  </style></head><body><div class="shot">
    <div class="grid"></div>
    <div class="kicker"><i></i>COCKPIT HARNESS · 第四篇</div>
    <h1>多智能体工作台<em>三间屋子</em></h1>
    <div class="rule"></div>
    <div class="sub"><span>办公室</span><span>作战室</span><span>航母 · 电磁弹射</span></div>
    <div class="lines">
      <p><b>场景不是皮肤</b>，是任务形状的一份可执行声明。</p>
      <p>走位只在真的换区域时发生；<b>关掉动效也读得懂</b>。</p>
      <p>好看只能好看在「呈现」，<b>不能好看在「事实」</b>。</p>
    </div>
    <div class="meta">
      <span>Electron · React · three.js · SQLite · ACP</span>
      <code>github.com/spin-ai/spin-cockpit-harness</code>
    </div>
    <div class="stack">
      ${card("carrier", "航母 · 电磁弹射", "CARRIER · THREE.JS", "carrier")}
      ${card("warroom", "作战室", "WAR ROOM · THREE.JS", "warroom")}
      ${card("office", "办公室", "OFFICE · 2.5D", "office")}
    </div>
    <div class="badge"><span class="fig">图</span><span class="n">01</span></div>
  </div></body></html>`;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W * SCALE,
    height: H * SCALE,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false },
  });
  win.setContentSize(W * SCALE, H * SCALE);
  const file = path.join(OUT, ".cover.html");
  fs.writeFileSync(file, html());
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 900));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, "sc-01-cover.png"), image.toPNG());
  fs.unlinkSync(file);
  console.log(`✓ sc-01-cover.png  ${image.getSize().width}×${image.getSize().height}`);
  win.destroy();
  app.quit();
  process.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
