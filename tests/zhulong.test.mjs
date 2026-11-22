#!/usr/bin/env node
/**
 * 视觉解析插件的纯函数自测：不联网、不启动窗口、不碰用户 userData。
 *
 * 只覆盖「后端返回 → 统一结构 → 本地核对项」这一段，因为它是三段里最容易静默错的地方：
 * 字段名漂移、bbox 越界、没有 size、空 blocks 都必须被测出来。
 */
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { activate, buildBrief, buildMarkdown, calibrateToImage, chatUrl, imageSize, localChecks, modelsUrl, normalizeResult, thinkingParams, wantsJsonMode } from "../plugins/zhulong/main.mjs";

/** 造一个只带 IHDR 的最小 PNG，用来测尺寸解析 */
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
}

const base = { backend: "zhulong", scene: "arch", bytes: Buffer.from("x"), mime: "image/png", elapsedMs: 12 };
let passed = 0;

async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${String(err?.message || err)}`); process.exitCode = 1; }
}

test("zhulong 的 [x,y,w,h] 必须转成渲染用的 [x1,y1,x2,y2]", () => {
  const out = normalizeResult({
    size: [1024, 768],
    // 真实服务返回的样例：x=418.5 y=482.5 w=146.8 h=120.9
    blocks: [{ id: "d0", type: "box", bbox: [418.5, 482.5, 146.8, 120.9], conf: 0.93 }],
  }, base);
  assert.deepEqual(out.blocks[0].bbox, [418.5, 482.5, 565.3, 603.4]);
});

test("正常结果归一化：blocks / relations / size", () => {
  const out = normalizeResult({
    size: [800, 600],
    blocks: [
      { id: "b1", type: "box", bbox: [10, 10, 200, 120], conf: 0.9 },
      { type: "text", bbox: [20, 30, 180, 60], text: "订单服务", conf: 0.8 },
    ],
    relations: [{ from: "b1", to: "b2", type: "arrow" }, { from: "b1", to: "" }],
  }, base);
  assert.equal(out.blocks.length, 2);
  assert.equal(out.blocks[0].id, "b1");
  assert.equal(out.blocks[1].id, "b2", "缺 id 的区块按序号补");
  assert.equal(out.relations.length, 1, "端点缺失的关系要丢掉");
  assert.deepEqual(out.size, [800, 600]);
});

test("空 blocks 直接报错，并给出可操作原因", () => {
  assert.throws(() => normalizeResult({ size: [10, 10], blocks: [] }, base), /blocks 为空/);
  assert.throws(() => normalizeResult({ size: [10, 10], blocks: [] }, base), /视觉模型|image/);
});

test("OpenAI 兼容地址：v1 / Ark api/v3 / Ark plan 网关 / 完整地址 都要拼对", () => {
  assert.equal(chatUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(chatUrl("https://ark.cn-beijing.volces.com/api/v3"), "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  assert.equal(chatUrl("https://ark.cn-beijing.volces.com/api/plan/v3"), "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions");
  assert.equal(chatUrl("https://ark.cn-beijing.volces.com/api/plan/v3/"), "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions");
  assert.equal(chatUrl("https://x.test/v1/chat/completions"), "https://x.test/v1/chat/completions");
  assert.equal(chatUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080/v1/chat/completions");
  assert.throws(() => chatUrl(""), /服务地址/);
  assert.equal(modelsUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/models");
});

test("bbox 越界 → 核对项 fail", () => {
  const out = normalizeResult({
    size: [100, 100],
    blocks: [{ id: "b1", type: "box", bbox: [200, 200, 300, 300], conf: 0.9 }],
  }, base);
  const check = out.checks.find((c) => c.name === "坐标在图像内");
  assert.equal(check.level, "fail");
});

test("没有 size → 核对项 warn，而不是假装通过", () => {
  const out = normalizeResult({ blocks: [{ id: "b1", type: "text", bbox: [1, 2, 3, 4], text: "x" }] }, base);
  const check = out.checks.find((c) => c.name === "图像尺寸");
  assert.equal(check.level, "warn");
});

test("低置信占比过半 → warn", () => {
  const out = normalizeResult({
    size: [100, 100],
    blocks: [
      { id: "b1", type: "text", bbox: [1, 1, 9, 9], text: "a", conf: 0.2 },
      { id: "b2", type: "text", bbox: [2, 2, 9, 9], text: "b", conf: 0.3 },
    ],
  }, base);
  assert.equal(out.checks.find((c) => c.name === "置信度分布").level, "warn");
});

test("架构图没有关系 → 提示，而不是当成功", () => {
  const checks = localChecks({
    blocks: [{ id: "b1", type: "box", bbox: [0, 0, 5, 5], text: "", conf: 0.9 }],
    relations: [],
    size: [10, 10],
    scene: "arch",
  });
  assert.equal(checks.find((c) => c.name === "关系构建").level, "warn");
});

test("后端自带 checks 与本地 checks 合并，且后端条目保序在后", () => {
  const out = normalizeResult({
    size: [10, 10],
    blocks: [{ id: "b1", type: "text", bbox: [0, 0, 5, 5], text: "x", conf: 0.9 }],
    checks: [{ name: "服务自检", ok: false, level: "fail", detail: "模型未加载" }],
  }, base);
  assert.equal(out.checks.at(-1).name, "服务自检");
  assert.equal(out.checks.find((c) => c.name === "服务自检").level, "fail");
});

/* ── 后端分发：用 stub ctx 验证 multipart 与探针路径，不联网 ── */
const handlers = {};
const calls = [];
const SETTINGS = {
  backend: "zhulong",
  endpoint: "http://127.0.0.1:8000/",
  apiKey: "",
  model: "",
  weights: "",
  imgsz: 800,
  conf: 0.35,
  relations: true,
  ocr: true,
  timeoutMs: 5000,
};
const stubCtx = {
  settings: { get: async (key) => (key in SETTINGS ? SETTINGS[key] : null) },
  net: {
    fetch: async (url, init) => {
      calls.push({ url, init });
      const block = { id: "b1", type: "text", bbox: [1, 1, 9, 9], text: "hi", conf: 0.9 };
      if (String(url).endsWith("/v1/chat/completions")) {
        return { ok: true, status: 200, contentType: "application/json", text: JSON.stringify({ choices: [{ message: { content: `\u0060\u0060\u0060json\n${JSON.stringify({ size: [100, 100], blocks: [block] })}\n\u0060\u0060\u0060` } }] }) };
      }
      return { ok: true, status: 200, contentType: "application/json", text: JSON.stringify({ size: [100, 100], blocks: [block] }) };
    },
  },
  commands: { register: (id, fn) => { handlers[id] = fn; } },
  api: { handle: () => {} },
  log: { info: () => {}, warn: () => {}, error: () => {} },
};
await activate(stubCtx);

await test("zhulong 后端：POST 到 /api/parse 且是 multipart", async () => {
  const out = await handlers["zhulong.parse"]({ scene: "arch", image: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(calls[0].url, "http://127.0.0.1:8000/api/parse", "endpoint 末尾斜杠要归一化");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.body instanceof FormData, "zhulong 后端要发 multipart");
  assert.equal(out.blocks.length, 1);
  assert.equal(out.backend, "zhulong");
});

test("从图片字节读真实尺寸（PNG / GIF / JPEG）", () => {
  assert.deepEqual(imageSize(png(320, 200), "image/png"), { width: 320, height: 200 });
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00]);
  assert.deepEqual(imageSize(gif, "image/gif"), { width: 320, height: 200 });
  // SOF0: FF C0 len=0x0011 precision, height=0x00C8, width=0x0140
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg, "image/jpeg"), { width: 320, height: 200 });
  assert.equal(imageSize(Buffer.from("not an image"), "image/png"), null);
});

test("模型猜错画布尺寸时，bbox 按真实像素校准", () => {
  const raw = normalizeResult({ size: [1600, 1000], blocks: [{ id: "b1", type: "box", bbox: [200, 300, 800, 200] }] }, base);
  const cal = calibrateToImage(raw, { width: 320, height: 200 });
  assert.deepEqual(cal.size, [320, 200]);
  assert.deepEqual(cal.blocks[0].bbox, [40, 60, 200, 100]);
  assert.equal(cal.checks.at(-1).name, "坐标校准");
  assert.equal(cal.checks.at(-1).level, "warn");
});

test("尺寸一致时不缩放，只留一条 ok 的核对", () => {
  const raw = normalizeResult({ size: [320, 200], blocks: [{ id: "b1", type: "text", bbox: [10, 10, 20, 20], text: "x" }] }, base);
  const cal = calibrateToImage(raw, { width: 320, height: 200 });
  assert.deepEqual(cal.blocks[0].bbox, [10, 10, 30, 30]);
  assert.equal(cal.checks.at(-1).level, "ok");
});

test("结构化解析关思考（GLM 除外，它不接受 thinking.type=disabled）", () => {
  assert.deepEqual(thinkingParams("doubao-seed-2.1-turbo"), { type: "disabled" });
  assert.deepEqual(thinkingParams("kimi-k3"), { type: "disabled" });
  assert.deepEqual(thinkingParams("deepseek-v4-1-flash"), { type: "disabled" });
  assert.equal(thinkingParams("glm-5.3"), null);
  assert.equal(thinkingParams("GLM-5-3-flash"), null);
  assert.deepEqual(thinkingParams(""), { type: "disabled" });
  assert.equal(wantsJsonMode("doubao-seed-2.1-turbo"), true);
  assert.equal(wantsJsonMode("glm-5-3-flash"), false);
});

test("探测走后端 health 路径", async () => {
  const res = await handlers["zhulong.probe"]({});
  assert.equal(calls.at(-1).url, "http://127.0.0.1:8000/api/health");
  assert.equal(res.ok, true);
});

await test("非图片 dataURL 直接拒绝，不发请求", async () => {
  const before = calls.length;
  await assert.rejects(() => handlers["zhulong.parse"]({ image: "data:text/plain;base64,aGk=" }), /不支持的图片类型/);
  assert.equal(calls.length, before);
});

await test("外部 API 后端：走 /v1/chat/completions，能剥掉代码围栏", async () => {
  SETTINGS.backend = "openai";
  SETTINGS.model = "qwen-vl-max";
  const out = await handlers["zhulong.parse"]({ scene: "ui", image: "data:image/png;base64,iVBORw0KGgo=" });
  const call = calls.at(-1);
  assert.ok(call.url.endsWith("/v1/chat/completions"), call.url);
  const body = JSON.parse(String(call.init.body));
  assert.equal(body.model, "qwen-vl-max");
  assert.equal(body.messages[1].content[1].image_url.url.startsWith("data:image/png;base64,"), true);
  assert.equal(out.backend, "openai");
  assert.equal(out.blocks[0].text, "hi");
});

await test("外部 API 没填模型名 → 明确报错，不发请求", async () => {
  SETTINGS.model = "";
  const before = calls.length;
  await assert.rejects(() => handlers["zhulong.parse"]({ image: "data:image/png;base64,iVBORw0KGgo=" }), /模型名/);
  assert.equal(calls.length, before);
});

await test("自定义后端：POST 原始 JSON，带 dataURL", async () => {
  SETTINGS.backend = "custom";
  SETTINGS.endpoint = "http://127.0.0.1:9000/parse";
  const out = await handlers["zhulong.parse"]({ scene: "pdf", image: "data:image/jpeg;base64,iVBORw0KGgo=" });
  const call = calls.at(-1);
  assert.equal(call.url, "http://127.0.0.1:9000/parse");
  const body = JSON.parse(String(call.init.body));
  assert.equal(body.scene, "pdf");
  assert.equal(body.image.startsWith("data:image/jpeg;base64,"), true);
  assert.equal(out.backend, "custom");
});

/* ── 交给 Agent：摘要要短、要有待看项、不能把整包响应塞进草稿 ── */
const sample = {
  backend: "zhulong", scene: "arch", size: [1024, 768], elapsedMs: 3200,
  blocks: [
    { id: "b1", type: "text", bbox: [10, 20, 110, 70], text: "任务调度", conf: 0.73 },
    { id: "b2", type: "box", bbox: [200, 20, 300, 70], text: "", conf: 0.9 },
  ],
  relations: [{ id: "r1", from: "b1", to: "b2", type: "arrow", confidence: 0.99 }],
  checks: [
    { name: "检测到区块", ok: true, level: "ok", detail: "2 个" },
    { name: "置信度分布", ok: false, level: "warn", detail: "低于 0.5 的占 50%（1/2）" },
  ],
  warnings: [],
};

await test("摘要：带场景/尺寸/待看项，无文字区块只报数量", () => {
  const text = buildBrief(sample);
  assert.match(text, /视觉解析/);
  assert.match(text, /手绘架构图/);
  assert.match(text, /1024×768/);
  assert.match(text, /待看（1）/);
  assert.match(text, /置信度分布/);
  assert.match(text, /任务调度/);
  assert.match(text, /另有 1 个无文字区块/);
  assert.match(text, /任务调度 → box b2/);
  assert.match(text, /下一步：/);
});

await test("摘要：区块超过 40 条只列前 40，避免草稿失控", () => {
  const many = { ...sample, blocks: Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, type: "text", bbox: [0, 0, 1, 1], text: `块${i}`, conf: 0.9 })) };
  const text = buildBrief(many);
  assert.match(text, /只列前 40/);
  assert.equal((text.match(/\[text\]/g) || []).length, 40);
});

/* ── 取消：in-flight 请求要能被中断，而不是等超时 ── */
let cancelInFlight = null;
const slowCtx = {
  settings: { get: async (key) => ({ backend: "custom", endpoint: "http://127.0.0.1:9/x", timeoutMs: 60000, apiKey: "", model: "", weights: "", imgsz: 800, conf: 0.35, relations: true, ocr: true }[key] ?? null) },
  net: {
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      setTimeout(() => reject(new Error("should-not-reach-timeout")), 8000);
    }),
  },
  commands: { register: (id, fn) => { handlers[id] = fn; } },
  api: { handle: () => {} },
  cancel: { register: (fn) => { cancelInFlight = fn; } },
  log: { info: () => {}, warn: () => {}, error: () => {} },
};
await activate(slowCtx);

await test("取消：解析中途 abort，命令以错误结束而不是等 60s 超时", async () => {
  const p = handlers["zhulong.parse"]({ image: "data:image/png;base64,iVBORw0KGgo=" });
  setTimeout(() => cancelInFlight?.(), 30);
  await assert.rejects(() => p, /abort|已取消/i);
});

/* ── Markdown 导出：给人看 / 给 Agent 读 / 给知识库 ingest 用的是同一份 ── */
await test("Markdown：标题、核对、区块表、关系表都在，竖线被转义", () => {
  const withPipe = {
    ...sample,
    blocks: [
      { id: "b1", type: "text", bbox: [10, 20, 110, 70], text: "A | B", conf: 0.73 },
      { id: "b2", type: "box", bbox: [200, 20, 300, 70], text: "", conf: 0.9 },
    ],
  };
  const md = buildMarkdown(withPipe);
  assert.match(md, /^# 视觉解析 · 手绘架构图/m);
  assert.match(md, /## 核对/);
  assert.match(md, /## 区块/);
  assert.match(md, /## 关系/);
  assert.match(md, /A \\?\| B/, "竖线要转义，否则表格被拆列");
  assert.match(md, /box b2 \| arrow/);
  assert.match(md, /0\.73/);
});

await test("Markdown：区块超过 400 条时标注「前 400 条」", () => {
  const many = { ...sample, blocks: Array.from({ length: 420 }, (_, i) => ({ id: `b${i}`, type: "text", bbox: [0, 0, 1, 1], text: `块${i}`, conf: 0.9 })) };
  const md = buildMarkdown(many);
  assert.match(md, /前 400 条/);
  assert.equal((md.match(/^\| \d+ \|/gm) || []).length, 400);
});

/* ── 保存到项目：路径与内容（stub fs，不落盘） ── */
const saved = [];
const apis = {};
const saveCtx = {
  ...stubCtx,
  api: { handle: (name, fn) => { apis[name] = fn; } },
  fs: { writeProjectFile: async (rel, text) => { saved.push({ rel, text }); return true; } },
};
await activate(saveCtx);

await test("保存：写 zhulong/<时间戳>-<scene>/ 下两个文件", async () => {
  saved.length = 0;
  const res = await apis["zhulong.save"]({ result: sample });
  assert.equal(res.ok, true);
  assert.match(res.dir, /^zhulong\/\d{8}-\d{6}-arch$/);
  assert.deepEqual(saved.map((f) => f.rel.split("/").pop()), ["blocks.json", "result.md"]);
  const payload = JSON.parse(saved[0].text);
  assert.equal(payload.blocks.length, 2);
  assert.equal(payload.scene, "arch");
  assert.match(saved[1].text, /^# 视觉解析/);
});

console.log(`\nZhulong: ${passed} 项 · ${process.exitCode ? "failed" : "passed"}`);
