// 录一段舞台动图（GIF），给文章用。
//
//   npx vite --port 5288 --strictPort
//   OFFICE_GIF_NAME=19-office-live npx electron scripts/article-images/render-office-gif.cjs
//
// 离屏窗口不会自己重绘，capturePage 会强制出一帧；按墙钟采样 + 记录真实时间戳，
// 编码时用 concat 的每帧 duration 还原真实节奏（采不满帧率也不会变成快放）。
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.OFFICE_PREVIEW_URL || "http://localhost:5288/office-preview.html";
const OUT = path.resolve(__dirname, "../../docs/assets/article");
const TMP = path.join(os.tmpdir(), "office-gif-frames");
const QUERY = process.env.OFFICE_GIF_QUERY || "template=office&theme=light&hour=10&tab=live&select=none&script=1&mission=plan_review";
const NAME = process.env.OFFICE_GIF_NAME || "office-live";
const W = 1600, H = 1000, SCALE = 1, FPS = 12, SECONDS = 9;

const wrap = (url) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${W * SCALE}px;height:${H * SCALE}px;overflow:hidden;background:#fff}
.shot{width:${W}px;height:${H}px;transform:scale(${SCALE});transform-origin:top left}
iframe{width:${W}px;height:${H}px;border:0;display:block}</style></head><body><div class="shot"><iframe src="${url}"></iframe></div></body></html>`;

app.whenReady().then(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: W * SCALE, height: H * SCALE, show: false, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false },
  });
  win.setContentSize(W * SCALE, H * SCALE);
  const file = path.join(TMP, "wrap.html");
  fs.writeFileSync(file, wrap(`${BASE}?${QUERY}`));
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 1500));

  const times = [];
  const started = Date.now();
  let i = 0;
  while (Date.now() - started < SECONDS * 1000) {
    const image = await win.webContents.capturePage();
    times.push(Date.now() - started);
    fs.writeFileSync(path.join(TMP, `f-${String(i).padStart(4, "0")}.png`), image.toPNG());
    i += 1;
  }
  console.log(`  共 ${i} 帧`);
  win.destroy();
  if (i < 10) throw new Error("没有采到帧");

  const lines = [];
  for (let k = 0; k < i; k += 1) {
    const next = k + 1 < i ? times[k + 1] : times[k] + 1000 / FPS;
    const dur = Math.min(0.4, Math.max(0.04, (next - times[k]) / 1000));
    lines.push(`file 'f-${String(k).padStart(4, "0")}.png'`);
    lines.push(`duration ${dur.toFixed(3)}`);
  }
  lines.push(`file 'f-${String(i - 1).padStart(4, "0")}.png'`);
  fs.writeFileSync(path.join(TMP, "frames.txt"), lines.join("\n") + "\n");

  const gif = path.join(OUT, `${NAME}.gif`);
  const tmpGif = path.join(TMP, `${NAME}.gif`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", path.join(TMP, "frames.txt"),
    "-vf", "scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=176:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-loop", "0", tmpGif], { stdio: "inherit" });
  fs.copyFileSync(tmpGif, gif);
  console.log(`✓ ${NAME}.gif  ${(fs.statSync(gif).size / 1024 / 1024).toFixed(2)} MB`);
  fs.rmSync(TMP, { recursive: true, force: true });
  app.quit();
  process.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
