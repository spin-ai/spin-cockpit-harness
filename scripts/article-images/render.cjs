// 用 Electron 的 Chromium 把文章配图渲染成 2x PNG。
// 用法：npx electron scripts/article-images/render.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { images } = require("./content.cjs");

const OUT = path.resolve(__dirname, "../../docs/assets/article");
const SCALE = 2;
fs.mkdirSync(OUT, { recursive: true });

function htmlShell(inner, w, h) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${w * SCALE}px;height:${h * SCALE}px;overflow:hidden;background:#fff}
    .shot{width:${w}px;height:${h}px;transform:scale(${SCALE});transform-origin:top left;overflow:hidden}
  </style></head><body><div class="shot">${inner}</div></body></html>`;
}

function htmlImage(img) {
  const inner = `<style>${img.html.css}</style>${img.html.body}
  <style>html,body{width:${img.width * SCALE}px!important;height:${img.height * SCALE}px!important;overflow:visible!important}</style>`;
  return htmlShell(inner, img.width, img.height);
}

function svgImage(img) {
  const data = Buffer.from(img.svg).toString("base64");
  return htmlShell(
    `<img src="data:image/svg+xml;base64,${data}" style="display:block;width:${img.width}px;height:${img.height}px">`,
    img.width,
    img.height,
  );
}

async function capture(win, name, html, w, h) {
  const file = path.join(OUT, `.render-${name}.html`);
  fs.writeFileSync(file, html);
  win.setContentSize(w * SCALE, h * SCALE);
  await win.loadFile(file);
  await new Promise((r) => setTimeout(r, 550));
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
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
  for (const img of images) {
    try {
      if (img.svg) {
        fs.writeFileSync(path.join(OUT, `${img.name}.svg`), img.svg);
        await capture(win, img.name, svgImage(img), img.width, img.height);
      } else {
        fs.writeFileSync(path.join(OUT, `${img.name}.html`), htmlImage(img));
        await capture(win, img.name, htmlImage(img), img.width, img.height);
      }
    } catch (err) {
      console.error(`✗ ${img.name}:`, err);
    }
  }
  // 清理中间文件
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith(".render-")) fs.unlinkSync(path.join(OUT, f));
  }
  win.destroy();
  app.quit();
});
