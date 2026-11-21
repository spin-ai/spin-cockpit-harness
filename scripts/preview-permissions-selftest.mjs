// 站点权限策略：纯函数单测（不需要启动应用）。
// 跑法：node scripts/preview-permissions-selftest.mjs
import assert from "node:assert/strict";
import { ALWAYS_ALLOWED, UNSUPPORTED, allows, grant, revoke, listSites, originOf, describePermission } from "../electron/preview-permissions.mjs";

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err?.message || err}`); process.exitCode = 1; }
}

check("origin 归一化：file:// 单独一类，非法地址不授权", () => {
  assert.equal(originOf("http://localhost:5173/app?x=1"), "http://localhost:5173");
  assert.equal(originOf("https://box.local:8443/"), "https://box.local:8443");
  assert.equal(originOf("file:///srv/app/a.html"), "file://");
  assert.equal(originOf("about:blank"), "");
  assert.equal(originOf(""), "");
});

check("默认全拒：没授权过的站点拿不到摄像头", () => {
  assert.equal(allows("", "http://localhost:5173", "media"), false);
  assert.equal(allows("", "http://localhost:5173", "geolocation"), false);
});

check("授权后按站点生效，不影响别的站点", () => {
  const raw = grant("", "http://localhost:5173", "media");
  assert.equal(allows(raw, "http://localhost:5173", "media"), true);
  assert.equal(allows(raw, "http://localhost:5173", "clipboard-read"), false);
  assert.equal(allows(raw, "http://localhost:6006", "media"), false);
});

check("全屏 / 写入剪贴板这类不需要询问", () => {
  for (const p of ALWAYS_ALLOWED) assert.equal(allows("", "http://x.test", p), true, p);
});

check("USB / 串口 / 屏幕共享永远拒绝（没有选择器 UI，不能假装允许）", () => {
  for (const p of UNSUPPORTED) {
    assert.equal(allows(grant("", "http://x.test", "media"), "http://x.test", p), false, p);
  }
});

check("grant 只接受可询问的能力：乱写的能力不会进设置", () => {
  const raw = grant("", "http://x.test", "usb");
  assert.equal(typeof raw, "string");
  assert.equal(allows(raw, "http://x.test", "usb"), false);
  assert.deepEqual(listSites(raw), []);
});

check("撤销单个能力 / 整个站点", () => {
  let raw = grant(grant("", "http://x.test", "media"), "http://x.test", "notifications");
  raw = revoke(raw, "http://x.test", "media");
  assert.equal(allows(raw, "http://x.test", "media"), false);
  assert.equal(allows(raw, "http://x.test", "notifications"), true);
  raw = revoke(raw, "http://x.test");
  assert.deepEqual(listSites(raw), []);
});

check("坏 JSON / 数组 / 未知能力都不会炸，也不会误放行", () => {
  assert.deepEqual(listSites("{not json"), []);
  assert.deepEqual(listSites("[1,2,3]"), []);
  assert.deepEqual(listSites(JSON.stringify({ "http://a.test": ["media", "bogus", 3] })), [
    { origin: "http://a.test", permissions: [{ key: "media", label: describePermission("media") }] },
  ]);
  assert.equal(allows(JSON.stringify({ "http://a.test": ["bogus"] }), "http://a.test", "bogus"), false);
});

check("设置页拿到的列表带中文标签", () => {
  const sites = listSites(grant("", "http://localhost:5173", "clipboard-read"));
  assert.equal(sites[0].origin, "http://localhost:5173");
  assert.equal(sites[0].permissions[0].label, "读取剪贴板");
});

console.log(passed ? `\n${passed} 项通过` : "");
