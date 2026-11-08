/**
 * 轻量 E2E harness：启动隔离 userData 的 Electron + CDP，驱动 renderer 做验收测试。
 * 不引入 Playwright/Puppeteer，依赖 Node >= 22 的 fetch / WebSocket。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function electronBinary(root) {
  if (process.platform === "darwin") return path.join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
  if (process.platform === "win32") return path.join(root, "node_modules", "electron", "dist", "electron.exe");
  return path.join(root, "node_modules", "electron", "dist", "electron");
}

async function waitForPage(port, timeoutMs, logPath) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  let tail = "";
  try { tail = fs.readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n"); } catch { /* ignore */ }
  throw new Error(`等待调试页面超时（${timeoutMs}ms）\n${tail}`);
}

export async function launchApp({ root, port, dataDir }) {
  const dist = path.join(root, "dist", "index.html");
  if (!fs.existsSync(dist)) throw new Error("dist/index.html 不存在；先运行 npm run build");
  const logPath = path.join(dataDir, "app.log");
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const bin = electronBinary(root);
  if (!fs.existsSync(bin)) throw new Error(`找不到 Electron：${bin}`);
  const args = [".", `--remote-debugging-port=${port}`];
  let command = bin;
  let argv = args;
  if (process.platform === "linux" && !process.env.DISPLAY) {
    command = "xvfb-run";
    argv = ["-a", bin, ...args];
  }
  const child = spawn(command, argv, {
    cwd: root,
    env: { ...process.env, COCKPIT_USER_DATA: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const page = await waitForPage(port, 45000, logPath);
  return {
    child,
    page,
    logPath,
    close: async () => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
      if (child.exitCode === null) { try { child.kill("SIGKILL"); } catch { /* ignore */ } }
      log.end();
    },
  };
}

export async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有找到页面");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await Promise.race([
      send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Runtime.evaluate 超时")), 30000)),
    ]);
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text || "eval error");
    }
    return result.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { socket, send, evaluate, close: () => socket.close() };
}

const HELPERS = `
window.__e2e = {
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  until: async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 80)); }
    return null;
  },
  click(el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); },
  setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  rail(label) { return [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes(label)); },
  text(selector) { return document.querySelector(selector)?.textContent?.trim() || ""; },
  all(selector) { return [...document.querySelectorAll(selector)]; },
}; true`;

export async function installHelpers(cdp) {
  await cdp.evaluate(HELPERS);
}

export async function screenshot(cdp, file) {
  try {
    const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(result.result.data, "base64"));
    return file;
  } catch { return null; }
}

export function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-e2e-req-"));
}
