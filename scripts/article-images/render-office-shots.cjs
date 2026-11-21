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
  { fig: "03", name: "office-live", query: "template=office&theme=light&hour=10&tab=live&select=none&script=1&mission=plan_review", wait: 620, label: "办公室 · 全员在动" },
  // 动效检查器：失败角色（倾斜静止、原地不走位）
  { fig: "04", name: "office-inspector", query: "template=office&theme=light&hour=10&tab=live&select=an&detail=1", wait: 1200, label: "动效检查器 · 失败" },
  // 夜间
  { fig: "09", name: "office-dark", query: "template=office&theme=dark&hour=22&tab=live&select=none&script=1&mission=plan_review", wait: 620, label: "办公室 · 夜间" },
  // 航母 3D
  { fig: "07", name: "stage-carrier", query: "template=carrier&theme=dark&hour=22&tab=live&select=none", wait: 7000, label: "航母 · 3D" },
  // 作战室 3D
  { fig: "08", name: "stage-warroom", query: "template=warroom&theme=dark&hour=22&tab=live&select=none", wait: 7000, label: "作战室 · 3D" },
  // 场景库（三模板）
  { fig: "13", name: "office-gallery", query: "theme=light&hour=10&tab=gallery", wait: 1600, label: "场景库", h: 720 },
  // 场景配置
  { fig: "12", name: "office-config", query: "template=office&theme=light&hour=10&tab=live&mode=config&select=lin", wait: 1600, label: "场景配置" },
  // 执行配置
  { fig: "14", name: "office-execution", query: "theme=light&hour=10&tab=execution", wait: 1600, label: "执行配置", h: 760 },
];

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";

function wrapperHtml(url, h, fig) {
  const badge = fig
    ? `<div class="figbadge"><span class="fig">图</span><span class="n">${fig}</span></div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${W * SCALE}px;height:${h * SCALE}px;overflow:hidden;background:#fff}
    .shot{position:relative;width:${W}px;height:${h}px;transform:scale(${SCALE});transform-origin:top left}
    iframe{width:${W}px;height:${h}px;border:0;display:block}
    .figbadge{position:absolute;z-index:9;bottom:18px;right:18px;display:flex;align-items:center;gap:7px;
      padding:6px 12px;border-radius:999px;background:#fff;border:1px solid #cbd5e1;
      box-shadow:0 8px 24px rgba(15,23,42,.14);font-family:${FONT};font-size:13px;font-weight:700;color:#1d4ed8;letter-spacing:.5px}
    .figbadge .fig{font-size:11px;font-weight:600;color:#64748b}
    .figbadge .n{font-family:${MONO};font-weight:800}
  </style></head><body><div class="shot"><iframe src="${url}"></iframe>${badge}</div></body></html>`;
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
    fs.writeFileSync(file, wrapperHtml(url, h, shot.fig));
    win.setContentSize(W * SCALE, h * SCALE);
    await win.loadFile(file);
    await new Promise((r) => setTimeout(r, shot.wait ?? 2000));
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    fs.writeFileSync(path.join(OUT, `sc-${shot.fig}-${shot.name}.png`), image.toPNG());
    fs.unlinkSync(file);
    console.log(`✓ sc-${shot.fig}-${shot.name}.png  ${size.width}×${size.height}  (${shot.label})`);
  }

  win.destroy();
  app.quit();
  process.exit(0);
}

app.whenReady().then(main).catch((err) => {
  console.error(err);
  app.exit(1);
});
