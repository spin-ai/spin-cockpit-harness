// 远端预览：用 `ssh -L` 把远端的 dev server 端口映射到本机回环。
// 设计：docs/arch/ARCH-ui-context.md「远端预览」
// 只在本机 127.0.0.1 上监听，远端不需要对外开放端口，也不改远端任何配置。
// 本文件不 import electron，纯 node：方便 `node scripts/preview-tunnel-selftest.mjs` 直接跑。
import net from "node:net";
import { spawn } from "node:child_process";

const tunnels = new Map(); // key -> record
let closeHook = null;

/** 隧道异常断开时通知上层（主进程转给渲染进程显示原因）。 */
export function onTunnelClosed(fn) { closeHook = fn; }

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** 只有这些地址才值得走隧道：回环 / 内网 / mDNS / 就是这台远端主机自己。 */
export function isPrivateHost(hostname, remoteAddr = "") {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (LOOPBACK.has(h)) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/\.(local|internal|lan)$/.test(h)) return true;
  const addr = String(remoteAddr || "").toLowerCase().replace(/^\[|\]$/g, "");
  return Boolean(addr) && (h === addr || h === addr.split("@").pop());
}

/**
 * 把一个预览地址解析成隧道目标。
 * - 回环 / 0.0.0.0 → 映射到远端自己的 127.0.0.1（Vite 默认只 bind localhost 的关键）
 * - 远端内网 IP / 主机名 → 原样作为目标
 */
export function tunnelTarget(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const targetPort = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return null;
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  const loopback = LOOPBACK.has(u.hostname.toLowerCase()) || LOOPBACK.has(hostname.toLowerCase());
  return {
    remoteOrigin: u.origin,
    remotePath: `${u.pathname || "/"}${u.search || ""}${u.hash || ""}`,
    targetHost: loopback ? "127.0.0.1" : hostname,
    targetPort,
  };
}

export function tunnelKey(host, target) {
  return [host.id, host.addr, host.port || 22, target.targetHost, target.targetPort].join("|");
}

/** 本机回环地址 → 远端原始地址（拾取注入 / 地址栏 / 系统浏览器打开都用它） */
export function toRemoteUrl(localUrl) {
  let u;
  try { u = new URL(String(localUrl || "")); } catch { return null; }
  for (const rec of tunnels.values()) {
    if (u.host !== `127.0.0.1:${rec.localPort}`) continue;
    return `${rec.remoteOrigin}${u.pathname}${u.search}${u.hash}`;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function canConnect(port, timeout = 600) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
  });
}

async function waitForward(rec, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (rec.proc?.exitCode !== null && rec.proc?.exitCode !== undefined) return false;
    if (rec.spawnError) return false;
    if (await canConnect(rec.localPort)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** 把 ssh stderr 变成一句能照做的话。 */
export function sshHint(rec = {}) {
  const lines = String(rec.stderr || "").split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^Warning: Permanently added/i.test(l) && !/^debug\d*:/i.test(l));
  const last = lines[lines.length - 1] || "";
  if (rec.spawnError) return `无法执行 ssh：${rec.spawnError}`;
  if (/Permission denied|publickey|no such identity/i.test(last)) return "SSH 免密未配置：先在本机终端里 ssh 一次，确认能免密登录";
  if (/Could not resolve hostname|Name or service not known/i.test(last)) return "SSH 主机名解析失败，检查主机地址";
  // 「channel N: open failed: connect failed: Connection refused」是转发目标端口不通；
  // 「ssh: connect to host … Connection refused」是 SSH 本身连不上，两者别混
  if (/channel\s+\d*:?\s*open failed/i.test(last)) return "远端该端口没有服务：dev server 起来了吗？";
  if (/^ssh: connect to host .*(Connection refused|Network is unreachable)/i.test(last)) return "SSH 连不上：检查主机地址 / 端口 / sshd 是否在跑";
  if (/timed out|Connection timed out/i.test(last)) return "SSH 连接超时，检查网络 / 端口 / 跳板";
  return last || "SSH 隧道建立失败";
}

/**
 * 打开（或复用）一条隧道。
 * 返回 { url, remote, key, hostName } 或 { direct: true, url }（公网地址不需要隧道）。
 */
export async function openTunnel({ host, url } = {}) {
  if (!host) throw new Error("没有配置远端主机");
  if (host.kind !== "ssh") throw new Error("本机预览不需要隧道");
  const target = tunnelTarget(url);
  if (!target) throw new Error("只支持 http/https 地址");
  if (!isPrivateHost(target.targetHost, host.addr)) return { direct: true, url: String(url) };

  const key = tunnelKey(host, target);
  const existing = tunnels.get(key);
  if (existing && !existing.closed) {
    existing.refs += 1;
    return {
      key, hostName: host.name, reused: true,
      url: `http://127.0.0.1:${existing.localPort}${target.remotePath}`,
      remote: `${target.remoteOrigin}${target.remotePath}`,
    };
  }

  const localPort = await freePort();
  const args = [
    "-N", "-T",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ConnectTimeout=8",
  ];
  if (host.port) args.push("-p", String(host.port));
  // 只绑回环：本机其它程序、局域网都访问不到这个端口
  args.push("-L", `127.0.0.1:${localPort}:${target.targetHost}:${target.targetPort}`);
  args.push(host.user ? `${host.user}@${host.addr}` : host.addr);

  const rec = {
    key, hostId: host.id, hostName: host.name, refs: 1, localPort,
    proc: null, stderr: "", spawnError: null, closed: false, ready: false,
    remoteOrigin: target.remoteOrigin, remotePath: target.remotePath,
    targetHost: target.targetHost, targetPort: target.targetPort,
  };
  const proc = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
  rec.proc = proc;
  proc.stderr?.on("data", (chunk) => { rec.stderr = (rec.stderr + String(chunk)).slice(-1200); });
  proc.on("error", (err) => { rec.spawnError = String(err?.message || err); rec.closed = true; tunnels.delete(key); });
  proc.on("exit", (code, signal) => {
    rec.closed = true;
    if (tunnels.get(key) === rec) tunnels.delete(key);
    if (rec.ready) closeHook?.({ key, hostName: rec.hostName, error: sshHint(rec) || `ssh 退出（${code ?? signal}）` });
  });
  tunnels.set(key, rec);

  const ok = await waitForward(rec);
  if (!ok) {
    rec.closed = true;
    tunnels.delete(key);
    try { proc.kill(); } catch { /* ignore */ }
    throw new Error(sshHint(rec));
  }
  rec.ready = true;
  return {
    key, hostName: host.name,
    url: `http://127.0.0.1:${localPort}${target.remotePath}`,
    remote: `${target.remoteOrigin}${target.remotePath}`,
  };
}

/** 引用计数归零才真正断开：多个预览标签可以共用一条隧道。 */
export function closeTunnel(key) {
  const rec = tunnels.get(String(key || ""));
  if (!rec) return false;
  rec.refs -= 1;
  if (rec.refs > 0) return false;
  rec.closed = true;
  tunnels.delete(rec.key);
  try { rec.proc?.kill(); } catch { /* ignore */ }
  return true;
}

export function closeAllTunnels() {
  for (const rec of [...tunnels.values()]) {
    rec.refs = 0;
    rec.closed = true;
    try { rec.proc?.kill(); } catch { /* ignore */ }
  }
  tunnels.clear();
}

export function tunnelCount() { return tunnels.size; }
