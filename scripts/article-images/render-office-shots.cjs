// 抓文章用的真实界面截图（办公室 2.5D / 作战室 3D / 航母 3D / 场景库 / 配置）。
//
// 用隔离预览，不开主应用、不抢焦点：
//   1) npx vite --port 5288 --strictPort
//   2) npx electron scripts/article-images/render-office-shots.cjs
//
// 数据来自 src/office/preview.tsx 的 mock State；参数见该文件的注释。
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.OFFICE_PREVIEW_URL || "http://localhost:5288/office-preview.html";
const OUT = path.resolve(__dirname, "../../docs/assets/article");
const W = 1600;
const H = 1000;
const SCALE = 2;

const shots = [
  // 办公室：计划待批（主管在会议室）+ 北正在走去审批台（script 第 0.5 秒）
  { name: "office-live", query: "template=office&theme=light&hour=10&tab=live&select=none&script=1&mission=plan_review", wait: 620, label: "办公室 · 全员在动" },
  // 动效检查器：失败角色（倾斜静止、原地不走位）
  { name: "office-inspector", query: "template=office&theme=light&hour=10&tab=live&select=an&detail=1", wait: 1200, label: "动效检查器 · 失败" },
  // 夜间
  { name: "office-dark", query: "template=office&theme=dark&hour=22&tab=live&select=none&script=1&mission=plan_review", wait: 620, label: "办公室 · 夜间" },
  // 航母 3D
  { name: "stage-carrier", query: "template=carrier&theme=dark&hour=22&tab=live&select=none", wait: 7000, label: "航母 · 3D" },
  // 作战室 3D
  { name: "stage-warroom", query: "template=warroom&theme=dark&hour=22&tab=live&select=none", wait: 7000, label: "作战室 · 3D" },
  // 场景库（三模板）
  { name: "office-gallery", query: "theme=light&hour=10&tab=gallery", wait: 1600, label: "场景库", h: 720 },
  // 场景配置
  { name: "office-config", query: "template=office&theme=light&hour=10&tab=live&mode=config&select=lin", wait: 1600, label: "场景配置" },
  // 执行配置
  { name: "office-execution", query: "theme=light&hour=10&tab=execution", wait: 1600, label: "执行配置", h: 760 },
];

function wrapperHtml(url, h) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${W * SCALE}px;height:${h * SCALE}px;overflow:hidden;background:#fff}
    .shot{width:${W}px;height:${h}px;transform:scale(${SCALE});transform-origin:top left}
    iframe{width:${W}px;height:${h}px;border:0;display:block}
  </style></head><body><div class="shot"><iframe src="${url}"></iframe></div></body></html>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: W * SCALE,
    height: H * SCALE,
    show: false,
    frame: false,
    resizable: true,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false },
  });

  for (const shot of shots) {
    const h = shot.h || H;
    const url = `${BASE}?${shot.query}`;
    const file = path.join(OUT, `.shot-${shot.name}.html`);
    fs.writeFileSync(file, wrapperHtml(url, h));
    win.setContentSize(W * SCALE, h * SCALE);
    await win.loadFile(file);
    await new Promise((r) => setTimeout(r, shot.wait ?? 2000));
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    fs.writeFileSync(path.join(OUT, `${shot.name}.png`), image.toPNG());
    fs.unlinkSync(file);
    console.log(`✓ ${shot.name}.png  ${size.width}×${size.height}  (${shot.label})`);
  }

  win.destroy();
  app.quit();
  process.exit(0);
}

app.whenReady().then(main).catch((err) => {
  console.error(err);
  app.exit(1);
});
