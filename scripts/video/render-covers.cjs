#!/usr/bin/env node
/**
 * 用办公室暗色实况图生成抖音封面：
 *   - 竖版 1080×1920（抖音）
 *   - 横版 1920×1080（B 站 / 公众号 / Pages）
 *
 * 用法：npx electron scripts/video/render-covers.cjs
 * 产物：.preview/douyin/covers/
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "../..");
const IMAGE = path.join(ROOT, "docs/assets/article/sc-09-office-dark.jpg");
const OUT = path.join(ROOT, ".preview/douyin/covers");
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";

function stage(mode) {
  const vertical = mode === "vertical";
  const w = vertical ? 1080 : 1920;
  const h = vertical ? 1920 : 1080;
  const bg = pathToFileURL(IMAGE).href;
  const copyTop = vertical ? 270 : 176;
  const copyLeft = vertical ? 76 : 108;
  const titleSize = vertical ? 94 : 92;
  const subSize = vertical ? 34 : 29;
  const footTop = vertical ? 1270 : 812;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:${w}px;height:${h}px;overflow:hidden;background:#05080f}
    .stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;font-family:${FONT};color:#f2f7ff}
    .bg{position:absolute;inset:0;background-image:url('${bg}');background-size:cover;background-position:50% ${vertical ? "45%" : "48%"};filter:saturate(.92) brightness(.92)}
    .shade{position:absolute;inset:0;background:${
      vertical
        ? "linear-gradient(180deg,rgba(5,8,15,.995) 0%,rgba(5,8,15,.985) 34%,rgba(5,8,15,.86) 46%,rgba(5,8,15,.34) 58%,rgba(5,8,15,.04) 68%,rgba(5,8,15,.16) 74%,rgba(5,8,15,.78) 82%,#05080f 92%,#05080f 100%),linear-gradient(90deg,rgba(5,8,15,.6),transparent 62%)"
        : "linear-gradient(90deg,rgba(5,8,15,.995) 0%,rgba(5,8,15,.96) 38%,rgba(5,8,15,.62) 56%,rgba(5,8,15,.05) 82%,transparent 100%),linear-gradient(180deg,rgba(5,8,15,.7) 0%,transparent 22%,transparent 68%,rgba(5,8,15,.86) 92%,#05080f 100%)"
    }}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.055) 1px,transparent 1px);background-size:${vertical ? 72 : 84}px ${vertical ? 72 : 84}px;mask-image:linear-gradient(to bottom,black 0%,transparent 72%)}
    .vignette{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 38%,transparent 52%,rgba(0,0,0,.55) 100%)}
    .brand{position:absolute;left:${copyLeft}px;top:${vertical ? 72 : 54}px;display:flex;align-items:center;gap:12px;z-index:5}
    .mark{width:${vertical ? 44 : 40}px;height:${vertical ? 44 : 40}px;border-radius:${vertical ? 12 : 11}px;display:grid;place-items:center;background:linear-gradient(150deg,#3b82f6,#34d399);color:#06101f;font:800 ${vertical ? 24 : 22}px ${FONT};box-shadow:0 8px 24px rgba(59,130,246,.35)}
    .brand b{font:600 ${vertical ? 22 : 20}px ${FONT};letter-spacing:.01em;color:#dbe7f8}
    .alpha{padding:3px 8px;border:1px solid rgba(125,211,252,.38);border-radius:999px;color:#7dd3fc;font:700 ${vertical ? 12 : 11}px ${MONO};letter-spacing:.14em}
    .copy{position:absolute;left:${copyLeft}px;top:${copyTop}px;width:${vertical ? 900 : 900}px;z-index:4}
    .kicker{display:flex;align-items:center;gap:12px;color:#38bdf8;font:700 ${vertical ? 19 : 17}px ${MONO};letter-spacing:.2em}
    .kicker:before{content:"";width:${vertical ? 38 : 34}px;height:2px;background:linear-gradient(90deg,#60a5fa,#34d399)}
    h1{margin-top:${vertical ? 24 : 18}px;font-size:${titleSize}px;line-height:1.06;letter-spacing:-.045em;font-weight:800;text-shadow:0 10px 50px rgba(0,0,0,.65)}
    h1 em{font-style:normal;display:block;background:linear-gradient(100deg,#60a5fa 0%,#38bdf8 46%,#34d399 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
    p{margin-top:${vertical ? 24 : 18}px;color:#c6d5ec;font-size:${subSize}px;line-height:1.55;font-weight:500;letter-spacing:.01em;text-shadow:0 6px 26px rgba(0,0,0,.55)}
    .chip{display:inline-flex;align-items:center;gap:10px;margin-top:${vertical ? 26 : 22}px;padding:${vertical ? "10px 16px" : "8px 14px"};border:1px solid rgba(248,113,113,.55);border-radius:999px;background:rgba(248,113,113,.13);color:#fecaca;font:700 ${vertical ? 18 : 16}px ${FONT};letter-spacing:.01em}
    .chip i{display:block;width:8px;height:8px;border-radius:50%;background:#f87171;box-shadow:0 0 14px rgba(248,113,113,.8)}
    .foot{position:absolute;left:${vertical ? 0 : copyLeft}px;right:${vertical ? 0 : "auto"}px;top:${footTop}px;bottom:${vertical ? 0 : "auto"}px;z-index:5;display:flex;flex-direction:column;gap:10px;${vertical ? "padding:26px 76px 0;background:linear-gradient(180deg,rgba(5,8,15,.12) 0%,rgba(5,8,15,.9) 18%,#05080f 46%,#05080f 100%);" : ""}}
    .foot b{font:700 ${vertical ? 34 : 28}px ${FONT};letter-spacing:-.02em;color:#f2f7ff}
    .foot span{font:500 ${vertical ? 20 : 17}px ${MONO};color:#93a4c4;letter-spacing:.02em}
    .foot .line{width:${vertical ? 76 : 64}px;height:3px;border-radius:99px;background:linear-gradient(90deg,#60a5fa,#34d399);margin-bottom:2px}
    .tag{position:absolute;right:${vertical ? 140 : 84}px;top:${vertical ? 78 : 56}px;z-index:5;text-align:right;font:600 ${vertical ? 13 : 12}px ${MONO};color:#7f92b0;letter-spacing:.12em;line-height:1.7;display:${vertical ? "block" : "none"}}
    .tag b{display:block;color:#b9c8e0;font-weight:700}
    .bottom{position:absolute;left:${copyLeft}px;right:${vertical ? 76 : 84}px;bottom:${vertical ? 64 : 44}px;display:${vertical ? "none" : "flex"};justify-content:space-between;gap:20px;z-index:5;color:#64748b;font:500 ${vertical ? 13 : 12}px ${MONO};letter-spacing:.06em}
    .bottom span:last-child{text-align:right;color:#7f92b0}
  </style></head><body>
    <div class="stage">
      <div class="bg"></div><div class="shade"></div><div class="grid"></div><div class="vignette"></div>
      <div class="brand"><span class="mark">C</span><b>Cockpit Harness</b><span class="alpha">ALPHA</span></div>
      <div class="copy">
        <div class="kicker">THE LIMIT · 5 AGENTS</div>
        <h1>一个人最多<em>盯 5 个 Agent</em></h1>
        <p>我开了 6 个，<br>然后开始写工具。</p>
        <div class="chip"><i></i>第 6 个 · 顾不过来</div>
      </div>
      <div class="foot"><span class="line"></span><b>多智能体工作台</b><span>GitHub 搜 Cockpit Harness</span></div>
      <div class="tag"><b>AGENT OFFICE</b><span>22:00 · 6 个终端</span></div>
      <div class="bottom"><span>LOCAL-FIRST · macOS / Windows / Linux</span><span>不是发布会，是我自己在用</span></div>
    </div>
  </body></html>`;
}

async function render(win, mode) {
  const vertical = mode === "vertical";
  const w = vertical ? 1080 : 1920;
  const h = vertical ? 1920 : 1080;
  const html = stage(mode);
  const tmp = path.join(OUT, `.cover-${mode}.html`);
  fs.writeFileSync(tmp, html);
  win.setContentSize(w, h);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 600));
  const image = await win.webContents.capturePage();
  const fixed = image.getSize().width === w ? image : image.resize({ width: w, height: h });
  const png = path.join(OUT, `cover-${mode}.png`);
  const jpg = path.join(OUT, `cover-${mode}.jpg`);
  fs.writeFileSync(png, fixed.toPNG());
  fs.writeFileSync(jpg, fixed.toJPEG(92));
  fs.unlinkSync(tmp);
  console.log(`[cover] ${png}`);
  console.log(`[cover] ${jpg}`);
}

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(async () => {
  if (!fs.existsSync(IMAGE)) throw new Error(`缺少底图：${IMAGE}`);
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1080,
    height: 1920,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: "#05080f",
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  for (const mode of ["vertical", "horizontal"]) await render(win, mode);
  win.destroy();
  app.quit();
}).catch((err) => {
  console.error("[cover] failed:", err);
  app.quit();
  process.exitCode = 1;
});
