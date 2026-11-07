// 渲染第三篇文章（LLM Wiki）的配图：14-17
// 用法：npx electron scripts/article-images/render-llm-wiki.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { images } = require("./content-llm-wiki.cjs");

const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
const OUT = path.resolve(__dirname, "../../docs/assets/article");
const SCALE = 2;
fs.mkdirSync(OUT, { recursive: true });

function badgeHtml(fig, pos, theme) {
  return `<div class="figbadge ${pos} ${theme}"><span class="fig">图</span><span class="n">${fig}</span></div>`;
}

function htmlShell(inner, w, h, badge = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${w * SCALE}px;height:${h * SCALE}px;overflow:hidden;background:#fff}
    .shot{position:relative;width:${w}px;height:${h}px;transform:scale(${SCALE});transform-origin:top left;overflow:hidden}
    .figbadge{position:absolute;z-index:999;display:flex;align-items:center;gap:8px;padding:7px 13px;border-radius:999px;
      font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:.6px;box-shadow:0 8px 24px rgba(15,23,42,.14)}
    .figbadge.tr{top:24px;right:24px}.figbadge.br{bottom:24px;right:24px}
    .figbadge.light{background:#fff;border:1px solid #cbd5e1;color:#1d4ed8}
    .figbadge.light .fig{color:#64748b;font-weight:600;font-size:12px}
    .figbadge.dark{background:rgba(8,15,29,.82);border:1px solid rgba(148,163,184,.32);color:#dbeafe}
    .figbadge.dark .fig{color:#93a4c4;font-weight:600;font-size:12px}
    .figbadge .n{font-family:${MONO};font-weight:800}
  </style></head><body><div class="shot">${inner}${badge}</div></body></html>`;
}

function svgImage(img, badge) {
  const data = Buffer.from(img.svg).toString("base64");
  return htmlShell(
    `<img src="data:image/svg+xml;base64,${data}" style="display:block;width:${img.width}px;height:${img.height}px">`,
    img.width,
    img.height,
    badge,
  );
}

async function capture(win, name, html, w, h) {
  const file = path.join(OUT, `.render-${name}.html`);
  fs.writeFileSync(file, html);
  win.setContentSize(w * SCALE, h * SCALE);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 550));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  console.log(`✓ ${name}.png  ${image.getSize().width}×${image.getSize().height}`);
  await new Promise((r) => setTimeout(r, 120));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 3200,
    height: 1800,
    show: false,
    frame: false,
    useContentSize: true,
    resizable: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const fig = String(i + 14).padStart(2, "0");
    const base = `${fig}-${img.name}`;
    const theme = img.name === "cover" ? "dark" : "light";
    const badge = badgeHtml(fig, "tr", theme);
    try {
      fs.writeFileSync(path.join(OUT, `${base}.svg`), img.svg);
      await capture(win, base, svgImage(img, badge), img.width, img.height);
    } catch (err) {
      console.error(`✗ ${img.name}:`, err);
    }
  }
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith(".render-")) fs.unlinkSync(path.join(OUT, f));
  }
  win.destroy();
  app.quit();
});
