// 预览页元素拾取（CDP）。只允许对 webview guest 操作，绝不允许挂到主窗口。
// 设计：docs/ARCH-ui-context.md
import fs from "node:fs";
import path from "node:path";
import { app, webContents } from "electron";
import { COLLECT_DOM_FN, pickSource } from "./ui-context.mjs";

const pending = new Map(); // webContentsId -> { reject, timer }

const HIGHLIGHT = {
  showInfo: true,
  contentColor: { r: 59, g: 130, b: 246, a: 0.22 },
  paddingColor: { r: 16, g: 185, b: 129, a: 0.18 },
  borderColor: { r: 59, g: 130, b: 246, a: 0.7 },
  marginColor: { r: 245, g: 158, b: 11, a: 0.16 },
};

function guestOf(webContentsId) {
  const wc = webContents.fromId(Number(webContentsId));
  if (!wc || wc.isDestroyed()) throw new Error("预览页未就绪");
  // 安全边界：只接受 webview guest，避免把调试器挂到主窗口自己身上。
  if (wc.getType() !== "webview") throw new Error("只能对预览页拾取元素");
  return wc;
}

async function attach(wc) {
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  await wc.debugger.sendCommand("DOM.enable");
  await wc.debugger.sendCommand("Runtime.enable");
  await wc.debugger.sendCommand("Page.enable");
  await wc.debugger.sendCommand("Overlay.enable");
}

async function stopInspect(wc) {
  try { await wc.debugger.sendCommand("Overlay.setInspectMode", { mode: "none", highlightConfig: HIGHLIGHT }); } catch { /* ignore */ }
}

/** 在页面里执行：唯一 selector + 文本 + HTML + 计算样式 + 盒模型 + 源码位置线索。 */

async function collect(wc, backendNodeId, root, screenshots = true) {
  const { object } = await wc.debugger.sendCommand("DOM.resolveNode", { backendNodeId });
  if (!object?.objectId) throw new Error("无法读取该元素");
  let info = null;
  try {
    const res = await wc.debugger.sendCommand("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: COLLECT_DOM_FN,
      returnByValue: true,
    });
    info = res?.result?.value || null;
  } finally {
    try { await wc.debugger.sendCommand("Runtime.releaseObject", { objectId: object.objectId }); } catch { /* ignore */ }
  }
  if (!info) throw new Error("无法读取该元素");

  const ctx = {
    kind: "dom-element",
    url: wc.getURL(),
    selector: info.selector,
    tag: info.tag,
    text: info.text,
    outerHTML: info.outerHTML,
    box: info.box,
    styles: info.styles,
    component: info.component || null,
    source: pickSource({ ymSrc: info.ymSrc, debugSource: info.debugSource, root }),
    screenshot: null,
  };

  // 截图落到应用数据目录（不污染项目 worktree），prompt 里给绝对路径
  if (screenshots) try {
    const box = info.box || {};
    if (box.width >= 2 && box.height >= 2) {
      const clip = {
        x: Math.max(0, box.x + (info.scroll?.x || 0)),
        y: Math.max(0, box.y + (info.scroll?.y || 0)),
        width: Math.min(2400, Math.max(2, box.width)),
        height: Math.min(1600, Math.max(2, box.height)),
        scale: 1,
      };
      const shot = await wc.debugger.sendCommand("Page.captureScreenshot", {
        format: "png", clip, captureBeyondViewport: true,
      });
      if (shot?.data) {
        const dir = path.join(app.getPath("userData"), "ui-context");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
        ctx.screenshot = file;
      }
    }
  } catch { /* 截图失败不影响上下文 */ }

  return ctx;
}

function cleanupPicker(wcId) {
  const entry = pending.get(wcId);
  if (!entry) return null;
  pending.delete(wcId);
  return entry;
}

/** 进入拾取模式，用户点中元素后 resolve 上下文；超时/取消会 reject。 */
export async function pickElement(webContentsId, { timeoutMs = 120000, root, screenshots = true } = {}) {
  const wc = guestOf(webContentsId);
  const wcId = wc.id;
  await attach(wc);

  // 同一页重复拾取：先取消上一次
  cleanupPicker(wcId)?.finish(new Error("已开始新的拾取"));

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      pending.delete(wcId);
      try { wc.debugger.off("message", onMessage); } catch { /* ignore */ }
      try { wc.off("destroyed", onDestroyed); } catch { /* ignore */ }
      try { wc.off("before-input-event", onInput); } catch { /* ignore */ }
      void stopInspect(wc);
    };
    const fail = (err) => { if (settled) return; settled = true; cleanup(); reject(err); };
    const onInput = (_event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") fail(new Error("已取消拾取"));
    };
    const onMessage = async (_event, method, params) => {
      if (method !== "Overlay.inspectNodeRequested" || settled) return;
      settled = true;
      cleanup();
      try {
        resolve(await collect(wc, params.backendNodeId, root, screenshots));
      } catch (err) {
        reject(new Error(String(err?.message || err)));
      }
    };
    const onDestroyed = () => fail(new Error("预览页已关闭"));
    const timer = setTimeout(() => fail(new Error("拾取超时，已退出选择模式")), timeoutMs);

    pending.set(wcId, { finish: fail });
    wc.debugger.on("message", onMessage);
    wc.once("destroyed", onDestroyed);
    wc.on("before-input-event", onInput);
    wc.debugger.sendCommand("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig: HIGHLIGHT })
      .catch((err) => fail(new Error(String(err?.message || err))));
  });
}

export async function cancelPick(webContentsId) {
  const wcId = Number(webContentsId);
  cleanupPicker(wcId)?.finish(new Error("已取消拾取"));
  try { await stopInspect(guestOf(wcId)); } catch { /* ignore */ }
}

export function detachPreview(webContentsId) {
  const wcId = Number(webContentsId);
  cleanupPicker(wcId)?.finish(new Error("预览已关闭"));
  try {
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
  } catch { /* ignore */ }
}
