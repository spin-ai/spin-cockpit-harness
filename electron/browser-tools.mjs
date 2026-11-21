// Agent 操作预览页（浏览器工具）。只对 <webview> 预览页生效，走 CDP，不注入脚本到主窗口。
// 设计：docs/arch/ARCH-ui-context.md「Agent 驱动预览」
import fs from "node:fs";
import path from "node:path";
import { app, webContents } from "electron";
import { MAX_TEXT, clipText, formatClickTarget, normalizeSelector, normalizeTargetUrl } from "./browser-tool-args.mjs";

/** 当前被用户看着的预览页（渲染层在标签激活 / 就绪时上报） */
let activeId = null;

export function setActivePreview(webContentsId) {
  const id = Number(webContentsId);
  activeId = Number.isFinite(id) && id > 0 ? id : null;
}

export function clearActivePreview(webContentsId) {
  const id = Number(webContentsId);
  if (activeId === id) activeId = null;
}

export { clipText, formatClickTarget, MAX_TEXT, normalizeSelector, normalizeTargetUrl } from "./browser-tool-args.mjs";

/* ── CDP ─────────────────────────────────────────────────────────── */

function guestOf(webContentsId) {
  const wc = webContents.fromId(Number(webContentsId));
  if (!wc || wc.isDestroyed()) throw new Error("预览页未打开");
  // 安全边界：只对预览 webview 操作，绝不接受主窗口
  if (wc.getType() !== "webview") throw new Error("只能操作预览页");
  return wc;
}

function resolveGuest(requestedId) {
  const id = Number(requestedId) || activeId;
  if (!id) throw new Error("请先在工作区打开预览页（终端栏「＋ 预览」或识别到的 dev server 地址）");
  return guestOf(id);
}

async function attach(wc) {
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  await wc.debugger.sendCommand("DOM.enable");
  await wc.debugger.sendCommand("Runtime.enable");
  await wc.debugger.sendCommand("Page.enable");
}

async function evaluate(wc, expression, { awaitPromise = false } = {}) {
  const res = await wc.debugger.sendCommand("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (res?.exceptionDetails) {
    throw new Error(String(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "页面脚本执行失败").slice(0, 300));
  }
  return res?.result?.value ?? null;
}

const selectorLiteral = (selector) => JSON.stringify(selector);

async function elementBox(wc, selector) {
  return await evaluate(wc, `(() => {
    const el = document.querySelector(${selectorLiteral(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return {
      x: r.x + r.width / 2, y: r.y + r.height / 2,
      w: r.width, h: r.height,
      tag: el.tagName,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || "").slice(0, 200),
    };
  })()`);
}

/** 打开一个地址（同一个预览页内导航） */
export async function browserOpen({ url, webContentsId } = {}) {
  const target = normalizeTargetUrl(url);
  if (!target) throw new Error("只支持 http / https / file 地址");
  const wc = resolveGuest(webContentsId);
  await attach(wc);
  await wc.loadURL(target);
  return { url: wc.getURL(), title: wc.getTitle() };
}

export async function browserBack({ webContentsId } = {}) {
  const wc = resolveGuest(webContentsId);
  if (!wc.canGoBack()) return { moved: false, url: wc.getURL() };
  wc.goBack();
  await new Promise((r) => setTimeout(r, 300));
  return { moved: true, url: wc.getURL() };
}

export async function browserForward({ webContentsId } = {}) {
  const wc = resolveGuest(webContentsId);
  if (!wc.canGoForward()) return { moved: false, url: wc.getURL() };
  wc.goForward();
  await new Promise((r) => setTimeout(r, 300));
  return { moved: true, url: wc.getURL() };
}

export async function browserReload({ webContentsId } = {}) {
  const wc = resolveGuest(webContentsId);
  wc.reload();
  return { url: wc.getURL() };
}

/** 读页面文本（可指定容器）。默认只取可见正文，不用 innerHTML */
export async function browserRead({ selector, maxChars, webContentsId } = {}) {
  const wc = resolveGuest(webContentsId);
  await attach(wc);
  const sel = normalizeSelector(selector);
  const raw = sel
    ? await evaluate(wc, `(() => {
        const el = document.querySelector(${selectorLiteral(sel)});
        if (!el) return null;
        if (typeof el.value === "string" && el.value) return el.value;
        return el.innerText || el.textContent || "";
      })()`)
    : await evaluate(wc, "(() => document.body ? (document.body.innerText || document.body.textContent || '') : '')()");
  if (raw == null) throw new Error(`页面里没有匹配 ${sel} 的元素`);
  const { text, truncated } = clipText(raw, Number(maxChars) > 0 ? Math.min(Number(maxChars), MAX_TEXT) : MAX_TEXT);
  return { url: wc.getURL(), title: wc.getTitle(), truncated, text };
}

/** 点击：先滚动到可视区，再按元素中心派发真实鼠标事件（比 el.click() 更接近用户） */
export async function browserClick({ selector, webContentsId } = {}) {
  const sel = normalizeSelector(selector);
  if (!sel) throw new Error("click 需要 CSS selector");
  const wc = resolveGuest(webContentsId);
  await attach(wc);
  const box = formatClickTarget(await elementBox(wc, sel));
  if (!box) throw new Error(`页面里没有匹配 ${sel} 的元素`);
  if (box.width < 1 || box.height < 1) throw new Error(`${sel} 尺寸为 0，可能不可见`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1,
    });
  }
  return box;
}

/** 输入：聚焦后用 Input.insertText（走输入法通道，React 受控组件也能收到） */
export async function browserType({ selector, text, submit = false, clear = false, webContentsId } = {}) {
  const value = String(text ?? "");
  const wc = resolveGuest(webContentsId);
  await attach(wc);
  const sel = normalizeSelector(selector);
  if (sel) {
    const focused = await evaluate(wc, `(() => {
      const el = document.querySelector(${selectorLiteral(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      el.focus();
      ${clear ? "if ('value' in el) el.value = '';" : ""}
      return true;
    })()`);
    if (!focused) throw new Error(`页面里没有匹配 ${sel} 的元素`);
  }
  if (value) {
    await wc.debugger.sendCommand("Input.insertText", { text: value });
    // 隐藏 / 未聚焦的窗口里 insertText 可能不落地：校验一次，没进去就用 setter + input 事件（React 受控组件也认）
    if (sel) {
      const landed = await evaluate(wc, `(() => {
        const el = document.querySelector(${selectorLiteral(sel)});
        return el && typeof el.value === "string" ? el.value.includes(${JSON.stringify(value)}) : true;
      })()`).catch(() => false);
      if (!landed) {
        await evaluate(wc, `(() => {
          const el = document.querySelector(${selectorLiteral(sel)});
          if (!el) return false;
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (!setter) { el.value = ${JSON.stringify(value)}; } else { setter.call(el, ${JSON.stringify(value)}); }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()`);
      }
    }
  }
  if (submit) {
    const common = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", ...common });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...common });
  }
  return { url: wc.getURL(), typed: value.length, submit: Boolean(submit) };
}

/** 等元素出现（轮询 querySelector，不做 MutationObserver，避免跨页面泄漏） */
export async function browserWait({ selector, timeoutMs, webContentsId } = {}) {
  const sel = normalizeSelector(selector);
  if (!sel) throw new Error("wait 需要 CSS selector");
  const wc = resolveGuest(webContentsId);
  await attach(wc);
  const budget = Math.min(Math.max(Number(timeoutMs) || 5000, 200), 30000);
  const started = Date.now();
  while (Date.now() - started < budget) {
    const found = await evaluate(wc, `!!document.querySelector(${selectorLiteral(sel)})`).catch(() => false);
    if (found) return { found: true, waitedMs: Date.now() - started, selector: sel };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { found: false, waitedMs: Date.now() - started, selector: sel };
}

/** 截图：落盘到 userData/preview-shots，返回绝对路径（与元素拾取同一套约定） */
export async function browserScreenshot({ fullPage = false, webContentsId } = {}) {
  const wc = resolveGuest(webContentsId);
  await attach(wc);
  const params = { format: "png", captureBeyondViewport: Boolean(fullPage) };
  if (fullPage) {
    const metrics = await wc.debugger.sendCommand("Page.getLayoutMetrics").catch(() => null);
    const size = metrics?.cssContentSize || metrics?.contentSize;
    if (size?.width && size?.height) {
      params.clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 8000), scale: 1 };
    }
  }
  const shot = await wc.debugger.sendCommand("Page.captureScreenshot", params);
  if (!shot?.data) throw new Error("截图失败");
  const dir = path.join(app.getPath("userData"), "preview-shots");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return { url: wc.getURL(), title: wc.getTitle(), path: file, fullPage: Boolean(fullPage) };
}

export async function browserState({ webContentsId } = {}) {
  const wc = resolveGuest(webContentsId);
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
  };
}

/** 工具名 → 实现（MCP 端点与单测共用） */
export const BROWSER_TOOLS = {
  browser_open: browserOpen,
  browser_back: browserBack,
  browser_forward: browserForward,
  browser_reload: browserReload,
  browser_read: browserRead,
  browser_click: browserClick,
  browser_type: browserType,
  browser_wait: browserWait,
  browser_screenshot: browserScreenshot,
  browser_state: browserState,
};

export async function runBrowserTool(name, args = {}) {
  const fn = BROWSER_TOOLS[name];
  if (!fn) throw new Error(`未知浏览器工具：${name}`);
  return await fn(args);
}
