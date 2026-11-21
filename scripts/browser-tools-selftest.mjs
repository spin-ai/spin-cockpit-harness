// 浏览器工具：参数校验（纯函数）+ MCP bridge 协议（黑盒跑子进程）。
// 跑法：node scripts/browser-tools-selftest.mjs
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clipText, formatClickTarget, normalizeSelector, normalizeTargetUrl } from "../electron/browser-tool-args.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err?.message || err}`); process.exitCode = 1; }
}

await check("只放行 http / https / file，其它协议一律拒绝", () => {
  assert.equal(normalizeTargetUrl("localhost:5173/app"), "http://localhost:5173/app");
  assert.equal(normalizeTargetUrl("https://example.com/x?y=1"), "https://example.com/x?y=1");
  assert.equal(normalizeTargetUrl("file:///tmp/a.html"), "file:///tmp/a.html");
  for (const bad of ["javascript:alert(1)", "data:text/html,<h1>x", "chrome://settings", "", "   "]) {
    assert.equal(normalizeTargetUrl(bad), null, bad);
  }
});

await check("selector 校验：空 / 过长拒绝", () => {
  assert.equal(normalizeSelector("#app > main"), "#app > main");
  assert.equal(normalizeSelector(""), null);
  assert.equal(normalizeSelector("x".repeat(401)), null);
});

await check("文本裁剪：默认 6000，标记 truncated", () => {
  assert.deepEqual(clipText("abc"), { text: "abc", truncated: false });
  const big = clipText("a".repeat(7000));
  assert.equal(big.text.length, 6000);
  assert.equal(big.truncated, true);
});

await check("点击目标格式化：坐标取整、文本截断到 80", () => {
  const t = formatClickTarget({ x: 10.6, y: 20.2, w: 30, h: 40, tag: "BUTTON", text: "x".repeat(200) });
  assert.deepEqual(t, { tag: "button", text: "x".repeat(80), x: 11, y: 20, width: 30, height: 40 });
  assert.equal(formatClickTarget(null), null);
});

/* ── bridge 协议：用假端点验证 initialize / tools/list / tools/call ── */

await check("bridge：初始化、列工具、转发调用、错误也回结构化结果", async () => {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const payload = JSON.parse(raw || "{}");
      calls.push({ auth: req.headers.authorization, name: payload.name, args: payload.arguments });
      res.writeHead(200, { "content-type": "application/json" });
      if (payload.name === "browser_state") {
        res.end(JSON.stringify({ ok: true, result: { url: "http://localhost:5173/", title: "demo" } }));
      } else {
        res.end(JSON.stringify({ ok: false, error: "页面里没有匹配 #nope 的元素" }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/call`;

  const child = spawn(process.execPath, [path.join(root, "electron/browser-mcp-bridge.mjs")], {
    env: { ...process.env, COCKPIT_BROWSER_URL: url, COCKPIT_BROWSER_TOKEN: "t0ken" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const at = buf.indexOf("\n");
      if (at < 0) break;
      const line = buf.slice(0, at).trim();
      buf = buf.slice(at + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  let nextId = 1;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 8000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

  const init = await request("initialize", { protocolVersion: "2024-11-05" });
  assert.equal(init.result.serverInfo.name, "cockpit-browser");

  const list = await request("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  for (const name of ["browser_open", "browser_click", "browser_type", "browser_read", "browser_screenshot", "browser_wait", "browser_state"]) {
    assert.ok(names.includes(name), `缺工具 ${name}`);
  }

  const ok = await request("tools/call", { name: "browser_state", arguments: {} });
  assert.equal(ok.result.isError, undefined);
  assert.match(ok.result.content[0].text, /demo/);
  assert.equal(calls[0].auth, "Bearer t0ken");
  assert.equal(calls[0].name, "browser_state");

  const bad = await request("tools/call", { name: "browser_click", arguments: { selector: "#nope" } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /没有匹配/);

  child.kill();
  server.close();
});

console.log(passed ? `\n${passed} 项通过` : "");
