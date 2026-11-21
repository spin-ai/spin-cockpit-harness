#!/usr/bin/env node
/**
 * 扫码配置自测（纯本地，不联网）：
 * 一次性 token、非法请求 403、字段校验、成功只写一次、停止后端口关闭。
 */
import assert from "node:assert/strict";
import { createPairing } from "../electron/im/pairing.mjs";

let passed = 0;
const logs = [];
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${String(err?.message || err)}`); process.exitCode = 1; }
};

const saved = [];
const pairing = createPairing({
  onSave: async (payload) => { saved.push(payload); },
  ttlMs: 60_000,
  log: { info: (line) => logs.push(String(line)) },
});

const started = await pairing.start();
const base = new URL(started.url);
const token = base.searchParams.get("t");
const local = `http://127.0.0.1:${base.port}/pair`;
const post = (body, t = token) => fetch(`${local}?t=${t}`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
});

await test("start() 返回带一次性 token 的地址，并且服务在监听", async () => {
  assert.ok(token && token.length === 32, "token 应为 128-bit");
  assert.ok(started.expiresAt > Date.now());
  const res = await fetch(`${local}?t=${token}`);
  assert.equal(res.status, 200);
});

await test("没有 token / 错 token 一律 403", async () => {
  assert.equal((await fetch(local)).status, 403);
  assert.equal((await fetch(`${local}?t=deadbeef`)).status, 403);
});

await test("配对页包含两个必填项，且不把 secret 预填进去", async () => {
  const html = await (await fetch(`${local}?t=${token}`)).text();
  assert.match(html, /name="app_id"/);
  assert.match(html, /name="app_secret"/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /value="[A-Za-z0-9]{16,}"/, "表单不应回填任何凭据");
});

await test("App ID 格式不对 → 400，且不写设置", async () => {
  const res = await post({ app_id: "wrong", app_secret: "12345678" });
  assert.equal(res.status, 400);
  assert.equal(saved.length, 0);
});

await test("合法提交 → 200，只写一次，字段被 trim", async () => {
  const res = await post({ app_id: " cli_a1b2c3 ", app_secret: "secret-value-123", allow_ids: "ou_1, oc_2" });
  assert.equal(res.status, 200);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].appId, "cli_a1b2c3");
  assert.equal(saved[0].appSecret, "secret-value-123");
  assert.equal(saved[0].allowIds, "ou_1, oc_2");
  const again = await post({ app_id: "cli_zzz", app_secret: "another-secret" });
  assert.equal(again.status, 409, "第二次提交应被拒绝");
  assert.equal(saved.length, 1);
});

await test("成功后自动关闭监听（端口不再接受连接）", async () => {
  await new Promise((r) => setTimeout(r, 700));
  await assert.rejects(() => fetch(`${local}?t=${token}`), /fetch failed|ECONNREFUSED/i);
  assert.equal(pairing.status().active, false);
});

await test("日志里没有 secret", () => {
  assert.ok(logs.length >= 1);
  assert.ok(logs.every((line) => !line.includes("secret-value-123")), "不得记录 secret");
});

console.log(`\nPairing: ${passed} 项 · ${process.exitCode ? "failed" : "passed"}`);
