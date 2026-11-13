#!/usr/bin/env node
/**
 * 引擎注册 / 路由 / HTTP 协议自检（不联网，全部 mock fetch）。
 *
 *   npm run knowledge:engines:selftest
 *
 * 覆盖：自动路由、显式引擎、未知引擎回退、配置加密、MinerU V1/legacy/Cloud、
 * PaddleOCR-VL 自建/Cloud、自研 HTTP 引擎。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { createEngineConfigStore } from "../electron/knowledge/engines/config.mjs";
import { createEngineRegistry } from "../electron/knowledge/engines/registry.mjs";
import { markdownFromMineruLegacy, pagesFromContentList } from "../electron/knowledge/engines/http.mjs";
import { createCustomEngine } from "../electron/knowledge/engines/custom.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-engines-"));
}

function zipBuffer(contentList, markdown = "# zip") {
  const zip = new AdmZip();
  zip.addFile("result/full.md", Buffer.from(markdown));
  if (contentList) zip.addFile("result/content_list.json", Buffer.from(JSON.stringify(contentList)));
  return zip.toBuffer();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fileResponse(buffer) {
  return new Response(new Uint8Array(buffer), { status: 200, headers: { "content-type": "application/zip" } });
}

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || "GET").toUpperCase();
    calls.push(`${method} ${url}`);
    for (const route of routes) {
      if (route.method && route.method !== method) continue;
      if (route.match instanceof RegExp ? route.match.test(url) : url.includes(route.match)) {
        return route.reply(url, init);
      }
    }
    throw new Error(`未 mock 的请求：${method} ${url}`);
  };
  return { fetchImpl, calls };
}

function mineruRoutes({ legacy = false } = {}) {
  const list = [
    { method: "GET", match: /\/v1\/health$/, reply: () => (legacy ? json({ detail: "not found" }, 404) : json({ status: "ok" })) },
  ];
  if (legacy) {
    list.push(
      { method: "GET", match: /\/docs$/, reply: () => new Response("ok") },
      { method: "POST", match: /\/file_parse$/, reply: () => json({ results: { doc: { md_content: "# legacy\n\n正文", content_list: [{ type: "text", text: "legacy page", page_idx: 0 }] } } }) },
    );
  } else {
    const zip = zipBuffer([
      { type: "text", text: "第一页", page_idx: 0 },
      { type: "text", text: "第二页", page_idx: 1, text_level: 1 },
    ]);
    list.push(
      { method: "POST", match: /\/v1\/uploads$/, reply: () => json({ status: "completed", file: { id: "file-1" } }) },
      { method: "POST", match: /\/v1\/parse\/jobs$/, reply: () => json({ job_id: "job-1" }) },
      { method: "GET", match: /\/v1\/parse\/jobs\/job-1$/, reply: () => json({ job_id: "job-1", status: "completed", files: [{ status: "completed", output_files: { zip: { file_id: "zip-1" } } }] }) },
      { method: "GET", match: /\/v1\/files\/zip-1\/content$/, reply: () => fileResponse(zip) },
    );
  }
  return list;
}

function mineruCloudRoutes() {
  const zip = zipBuffer([{ type: "text", text: "云端页", page_idx: 0 }]);
  return [
    { method: "POST", match: /\/file-urls\/batch$/, reply: () => json({ code: 0, data: { batch_id: "batch-1", file_urls: ["https://upload.test/one"] } }) },
    { method: "PUT", match: "https://upload.test/one", reply: () => new Response("", { status: 200 }) },
    { method: "GET", match: /\/extract-results\/batch\/batch-1$/, reply: () => json({ code: 0, data: { extract_result: { state: "done", full_zip_url: "https://cdn.test/out.zip" } } }) },
    { method: "GET", match: "https://cdn.test/out.zip", reply: () => fileResponse(zip) },
  ];
}

function paddleRoutes() {
  return [
    { method: "GET", match: /\/layout-parsing$/, reply: () => new Response("", { status: 405 }) },
    { method: "POST", match: /\/layout-parsing$/, reply: () => json({ errorCode: 0, result: { layoutParsingResults: [{ markdown: { text: "# 页一" } }, { markdown: { text: "页二" } }] } }) },
  ];
}

function paddleCloudRoutes() {
  const jsonl = [
    JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "云页一" } }] } }),
    JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "云页二" } }] } }),
  ].join("\n");
  return [
    { method: "POST", match: /\/api\/v2\/ocr\/jobs$/, reply: () => json({ data: { jobId: "pjob-1" } }) },
    { method: "GET", match: /\/api\/v2\/ocr\/jobs\/pjob-1$/, reply: () => json({ data: { state: "done", resultUrl: { jsonUrl: "https://cdn.test/paddle.jsonl" } } }) },
    { method: "GET", match: "https://cdn.test/paddle.jsonl", reply: () => new Response(jsonl, { headers: { "content-type": "text/plain" } }) },
  ];
}

async function main() {
  console.log("知识引擎注册 / 路由自检\n");
  const dir = tmpDir();
  const dummyPdf = path.join(dir, "sample.pdf");
  fs.writeFileSync(dummyPdf, "%PDF-1.4\n");

  console.log("[1] 配置：默认值、加密、公开脱敏");
  const secret = "sk-test-123456";
  const configFile = path.join(dir, "engines.json");
  const sealedStore = createEngineConfigStore({
    file: configFile,
    seal: (value) => Buffer.from(value, "utf8").toString("base64"),
    open: (value) => Buffer.from(value, "base64").toString("utf8"),
  });
  sealedStore.updateEngine("mineru", { endpoint: "https://mineru.test", apiKey: secret, timeoutMs: 123_000 });
  const raw = fs.readFileSync(configFile, "utf8");
  check("密钥不落明文", !raw.includes(secret), raw.includes("v1:") ? "已加密" : "未加密");
  check("重新读取可解密", sealedStore.load().engines.mineru.apiKey === secret);
  const pub = sealedStore.public();
  check("公开配置不含密钥", !JSON.stringify(pub).includes(secret) && pub.engines.mineru.apiKeySet === true);
  check("超时按引擎独立保存", sealedStore.load().engines.mineru.timeoutMs === 123_000);
  check("默认超时按 WeKnora 分层", sealedStore.load().engines.mineru_cloud.timeoutMs === 1_800_000
    && sealedStore.load().engines.paddleocr_vl_cloud.timeoutMs === 600_000);

  console.log("\n[2] 路由：简单格式 / 显式 / 未知 / 不可用");
  const simpleRegistry = createEngineRegistry({ configStore: sealedStore });
  const md = path.join(dir, "note.md");
  fs.writeFileSync(md, "# 标题\n\n正文");
  const simple = await simpleRegistry.parse({ file: md });
  check("md 自动走 simple", simple.engine === "simple" && simple.route.reason === "simple-format", simple.engine);
  const fallback = simpleRegistry.choose({ fileType: "pdf" });
  check("pdf 自动走 builtin", fallback.engine.name === "builtin" && fallback.route === "fallback", fallback.engine.name);
  const unknown = simpleRegistry.choose({ requested: "no-such-engine", fileType: "pdf" });
  check("未知引擎回退并提示", unknown.engine.name === "builtin" && unknown.route === "unknown-engine"
    && unknown.warnings.length === 1, unknown.warnings[0]);
  let unavailable = "";
  try {
    const emptyStore = createEngineConfigStore({ file: path.join(dir, "empty.json") });
    await createEngineRegistry({ configStore: emptyStore }).parse({ file: dummyPdf, engine: "mineru" });
  } catch (error) {
    unavailable = error.code;
  }
  check("显式引擎未配置直接报错", unavailable === "engine-unavailable", unavailable);
  const defaultStore = createEngineConfigStore({ file: path.join(dir, "default.json") });
  defaultStore.save({ defaultEngine: "mineru" });
  const defaultChoice = createEngineRegistry({ configStore: defaultStore }).choose({ fileType: "pdf" });
  check("默认引擎不可用回退 builtin", defaultChoice.engine.name === "builtin" && defaultChoice.route === "unavailable-fallback", defaultChoice.route);

  console.log("\n[3] MinerU V1");
  const v1Store = createEngineConfigStore({ file: path.join(dir, "v1.json") });
  v1Store.updateEngine("mineru", { endpoint: "https://mineru.test", apiKey: "k" });
  const v1Mock = mockFetch(mineruRoutes());
  const v1Registry = createEngineRegistry({ configStore: v1Store, fetchImpl: v1Mock.fetchImpl });
  v1Store.save({ defaultEngine: "mineru" });
  const forcedDefault = v1Registry.choose({ fileType: "pdf" });
  check("默认引擎可用时按默认路由", forcedDefault.engine.name === "mineru" && forcedDefault.route === "default", forcedDefault.route);
  const v1 = await v1Registry.parse({ file: dummyPdf, engine: "mineru" });
  check("V1 分页", v1.pages.length === 2 && v1.pages[1].markdown.startsWith("#"), v1.pages.map((p) => p.markdown).join(" | "));
  check("V1 记录协议", v1.parser === "mineru/v1", v1.parser);
  check("V1 走完整 upload→job→zip", v1Mock.calls.some((call) => call.includes("/v1/uploads"))
    && v1Mock.calls.some((call) => call.includes("/v1/parse/jobs")), v1Mock.calls.length + " 次请求");

  console.log("\n[4] MinerU legacy");
  const legacyStore = createEngineConfigStore({ file: path.join(dir, "legacy.json") });
  legacyStore.updateEngine("mineru", { endpoint: "https://mineru.test" });
  const legacyMock = mockFetch(mineruRoutes({ legacy: true }));
  const legacyRegistry = createEngineRegistry({ configStore: legacyStore, fetchImpl: legacyMock.fetchImpl });
  const legacy = await legacyRegistry.parse({ file: dummyPdf, engine: "mineru" });
  check("legacy /file_parse", legacy.parser === "mineru/legacy" && legacy.pages.length === 1, legacy.parser);
  check("legacy 响应解析", markdownFromMineruLegacy({ results: { doc: { md_content: "x" } } }, "doc.pdf") === "x");

  console.log("\n[5] MinerU Cloud");
  const cloudStore = createEngineConfigStore({ file: path.join(dir, "cloud.json") });
  cloudStore.updateEngine("mineru_cloud", { apiKey: "cloud-key", baseUrl: "https://mineru.test/api/v4" });
  const cloudMock = mockFetch(mineruCloudRoutes());
  const cloudRegistry = createEngineRegistry({ configStore: cloudStore, fetchImpl: cloudMock.fetchImpl });
  const cloud = await cloudRegistry.parse({ file: dummyPdf, engine: "mineru_cloud" });
  check("Cloud batch → zip", cloud.pages.length === 1 && cloud.parser === "mineru_cloud/v4", cloud.parser);
  check("Cloud 申请上传并 PUT", cloudMock.calls.some((call) => call.startsWith("POST") && call.includes("/file-urls/batch"))
    && cloudMock.calls.some((call) => call.startsWith("PUT")), cloudMock.calls.length + " 次请求");

  console.log("\n[6] PaddleOCR-VL 自建");
  const paddleStore = createEngineConfigStore({ file: path.join(dir, "paddle.json") });
  paddleStore.updateEngine("paddleocr_vl", { endpoint: "https://paddle.test" });
  const paddleMock = mockFetch(paddleRoutes());
  const paddleRegistry = createEngineRegistry({ configStore: paddleStore, fetchImpl: paddleMock.fetchImpl });
  const paddle = await paddleRegistry.parse({ file: dummyPdf, engine: "paddleocr_vl" });
  check("layoutParsingResults 分页", paddle.pages.length === 2 && paddle.pages[0].markdown === "# 页一", paddle.pages.length + " 页");
  check("自建探测接受 404/405", (await paddleRegistry.probe("paddleocr_vl")).available === true);

  console.log("\n[7] PaddleOCR-VL Cloud");
  const paddleCloudStore = createEngineConfigStore({ file: path.join(dir, "paddle-cloud.json") });
  paddleCloudStore.updateEngine("paddleocr_vl_cloud", { token: "t", baseUrl: "https://paddle.test/api/v2/ocr/jobs" });
  const paddleCloudMock = mockFetch(paddleCloudRoutes());
  const paddleCloudRegistry = createEngineRegistry({ configStore: paddleCloudStore, fetchImpl: paddleCloudMock.fetchImpl });
  const paddleCloud = await paddleCloudRegistry.parse({ file: dummyPdf, engine: "paddleocr_vl_cloud" });
  check("Cloud jobs → JSONL", paddleCloud.pages.length === 2 && paddleCloud.pages[1].markdown === "云页二", paddleCloud.parser);

  console.log("\n[8] 自研引擎（extras / 运行时注册）");
  const customStore = createEngineConfigStore({ file: path.join(dir, "custom.json") });
  customStore.addExtra({ name: "my-parser", label: "自研引擎", endpoint: "https://custom.test/parse", fileTypes: ["pdf"] });
  const customMock = mockFetch([
    { method: "POST", match: "https://custom.test/parse", reply: () => new Response("# 自研结果\n\n正文", { headers: { "content-type": "text/markdown" } }) },
  ]);
  const customRegistry = createEngineRegistry({ configStore: customStore, fetchImpl: customMock.fetchImpl });
  const custom = await customRegistry.parse({ file: dummyPdf, engine: "my-parser" });
  check("extras 自动注册并路由", custom.engine === "my-parser" && custom.pages[0].markdown.includes("自研结果"), custom.engine);
  let runtimeOk = false;
  try {
    customRegistry.register(createCustomEngine({ name: "runtime-engine", fileTypes: ["pdf"] }));
    runtimeOk = customRegistry.has("runtime-engine");
  } catch (error) {
    runtimeOk = false;
    check("运行时注册", false, error.message);
  }
  check("运行时注册", runtimeOk);

  console.log("\n[9] 归一化辅助");
  const pages = pagesFromContentList([
    { type: "text", text: "标题", text_level: 1, page_idx: 0 },
    { type: "table", table_body: "| a | b |", page_idx: 1 },
  ]);
  check("content_list 页码", pages.length === 2 && pages[0].markdown === "# 标题" && pages[1].page_no === 2);

  console.log(`\n${failures ? `失败 ${failures} 项` : "全部通过"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
