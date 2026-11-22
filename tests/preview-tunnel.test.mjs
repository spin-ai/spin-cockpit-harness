// 远端预览隧道：解析 / 判定逻辑的单测（不建连、不需要远端机器）。
// 跑法：npm test -- preview-tunnel
import assert from "node:assert/strict";
import { tunnelTarget, isPrivateHost, tunnelKey, sshHint } from "../electron/preview-tunnel.mjs";

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err?.message || err}`); process.exitCode = 1; }
}

check("回环地址映射到远端自己的 127.0.0.1（Vite 只 bind localhost 的情况）", () => {
  for (const raw of ["http://localhost:5173/", "http://127.0.0.1:5173/app", "http://0.0.0.0:5173/"]) {
    const t = tunnelTarget(raw);
    assert.equal(t.targetHost, "127.0.0.1", raw);
  }
});

check("端口 / 路径 / query 原样带给远端", () => {
  const t = tunnelTarget("http://localhost:5173/dashboard?tab=1#top");
  assert.equal(t.targetPort, 5173);
  assert.equal(t.remotePath, "/dashboard?tab=1#top");
  assert.equal(t.remoteOrigin, "http://localhost:5173");
});

check("省略端口时按协议默认（80 / 443）", () => {
  assert.equal(tunnelTarget("http://box.local/").targetPort, 80);
  assert.equal(tunnelTarget("https://box.local/").targetPort, 443);
});

check("远端内网 IP / 主机名保留为目标主机", () => {
  assert.equal(tunnelTarget("http://10.0.0.8:3000/").targetHost, "10.0.0.8");
  assert.equal(tunnelTarget("http://dev.internal:8080/").targetHost, "dev.internal");
});

check("非 http(s) / 非法地址不建隧道", () => {
  for (const raw of ["", "file:///tmp/a.html", "chrome://devtools", "not a url"]) {
    assert.equal(tunnelTarget(raw), null, raw);
  }
});

check("只有回环 / 内网 / 本项目远端主机才值得走隧道", () => {
  assert.equal(isPrivateHost("localhost"), true);
  assert.equal(isPrivateHost("127.0.0.1"), true);
  assert.equal(isPrivateHost("192.168.1.9"), true);
  assert.equal(isPrivateHost("172.20.0.3"), true);
  assert.equal(isPrivateHost("build.lan"), true);
  assert.equal(isPrivateHost("10.1.2.3", "10.1.2.3"), true);
  assert.equal(isPrivateHost("example.com"), false);
  assert.equal(isPrivateHost("203.0.113.7"), false);
});

check("隧道 key 由主机 + 目标端口组成：同端口可复用，不同端口互不干扰", () => {
  const host = { id: "h1", addr: "10.0.0.8", port: 22 };
  const a = tunnelKey(host, tunnelTarget("http://localhost:5173/"));
  const b = tunnelKey(host, tunnelTarget("http://localhost:5173/other"));
  const c = tunnelKey(host, tunnelTarget("http://localhost:5174/"));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

check("ssh 报错翻成人话", () => {
  assert.match(sshHint({ stderr: "Permission denied (publickey)." }), /免密/);
  assert.match(sshHint({ stderr: "ssh: Could not resolve hostname nope: nodename nor servname provided" }), /解析失败/);
  assert.match(sshHint({ stderr: "channel 2: open failed: connect failed: Connection refused" }), /没有服务/);
  // SSH 本身连不上 ≠ 转发端口没有服务：两者提示不能混
  assert.match(sshHint({ stderr: "ssh: connect to host 10.0.0.8 port 22: Connection refused" }), /sshd/);
  assert.equal(sshHint({ spawnError: "spawn ssh ENOENT" }).includes("ssh"), true);
  assert.equal(sshHint({}), "SSH 隧道建立失败");
});

console.log(passed ? `\n${passed} 项通过` : "");
