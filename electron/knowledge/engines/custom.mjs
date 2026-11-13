/**
 * 自研 / 第三方引擎的通用 HTTP 转换器（预留位）。
 *
 * 注册一个新的解析服务不用改核心路由：在 engines.json 的 extras 里写一条，
 * 或在运行时 register() 一个同样形状的 engine。默认支持三种响应：
 *   1. 直接返回 markdown（text/markdown 或 text/plain）
 *   2. JSON：用 markdownPath 取字段，或用 pagesPath 取 [{page_no, markdown}]
 *   3. MinerU / PaddleOCR 形状的 JSON 或 zip 结果包
 */

import {
  EngineError, dotGet, expectOk, extractMineruZip, fileExt, isJsonResponse, markdownFromMineruLegacy,
  multipart, normalizePages, pagesFromContentList, pagesFromPaddleLayout, readText, request,
} from "./http.mjs";

function mimeOf(fileName) {
  const ext = fileExt(fileName);
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" })[ext] || "application/octet-stream";
}

function pagesFromCustomJson(body, spec) {
  const mode = spec.responseMode || "auto";
  if (spec.pagesPath) {
    const pages = normalizePages(dotGet(body, spec.pagesPath));
    if (pages.length) return pages;
  }
  if (mode === "paddleocr") return pagesFromPaddleLayout(body);
  if (mode === "mineru" || mode === "auto") {
    const paddle = pagesFromPaddleLayout(body);
    if (paddle.length) return paddle;
    const contentList = dotGet(body, spec.contentListPath || "content_list")
      || Object.values(body?.results || {}).find((item) => item?.content_list)?.content_list;
    const fromList = pagesFromContentList(contentList);
    if (fromList.length) return fromList;
    const legacy = markdownFromMineruLegacy(body);
    if (legacy.trim()) return [{ page_no: 1, markdown: legacy }];
  }
  const markdown = dotGet(body, spec.markdownPath || "markdown");
  if (typeof markdown === "string" && markdown.trim()) return [{ page_no: 1, markdown }];
  return [];
}

export function createCustomEngine(spec = {}) {
  const name = String(spec.name || "custom");
  return {
    name,
    label: spec.label || name,
    description: spec.description || "自定义 HTTP 解析引擎",
    local: false,
    fileTypes: Array.isArray(spec.fileTypes) && spec.fileTypes.length
      ? spec.fileTypes.map((type) => String(type).replace(/^\./, "").toLowerCase())
      : ["*"],
    requires: ["endpoint"],
    checkAvailable(config) {
      if (config?.enabled === false) return { available: false, reason: "已在设置中停用" };
      if (!String(config?.endpoint || "").trim()) return { available: false, reason: `未配置 ${name} 的 endpoint` };
      return { available: true, reason: "" };
    },
    async probe(config, { fetchImpl, signal } = {}) {
      const endpoint = String(config?.endpoint || "").trim();
      if (!endpoint) return { available: false, reason: "未配置 endpoint" };
      try {
        const res = await request(endpoint, {
          headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
          timeoutMs: 8_000, fetchImpl, signal, retries: 0,
        });
        return { available: res.status < 500, reason: res.status < 500 ? "" : `HTTP ${res.status}` };
      } catch (error) {
        return { available: false, reason: error.message, code: error.code };
      }
    },
    createReader(config) {
      return {
        async read({ bytes, fileName, fileType, fetchImpl, signal }) {
          const endpoint = String(config.endpoint || "").trim();
          if (!endpoint) throw new EngineError("未配置 endpoint", { code: "engine-unavailable" });
          const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
          const extra = config.extraFields && typeof config.extraFields === "object" ? config.extraFields : {};
          let body;
          if (config.requestMode === "json-base64") {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify({
              ...extra,
              file: bytes.toString("base64"),
              fileName,
              fileType,
            });
          } else {
            body = multipart(extra, {
              field: config.fileField || "file",
              name: fileName,
              bytes,
              type: mimeOf(fileName),
            });
          }
          const res = await request(endpoint, {
            method: "POST", headers, body, timeoutMs: config.timeoutMs, fetchImpl, signal, retries: 1,
          });
          await expectOk(res, `${name} 解析`);
          const text = await readText(res);
          const looksJson = config.responseMode !== "markdown"
            && (isJsonResponse(res) || /^[\[{]/.test(text.trim()));
          if (!looksJson) {
            const markdown = text.trim();
            if (!markdown) throw new EngineError("自定义引擎返回空内容", { code: "engine-empty" });
            return { pages: [{ page_no: 1, markdown }], parser: `${name}/text` };
          }
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new EngineError("自定义引擎返回的 JSON 无法解析", { code: "bad-json" });
          }
          const pages = pagesFromCustomJson(parsed, config);
          if (!pages.length) throw new EngineError("自定义引擎返回成功但没有可用内容", { code: "engine-empty" });
          return { pages, parser: `${name}/json` };
        },
      };
    },
  };
}

/** 从 zip 产物还原页（自研引擎也可以直接返回 MinerU 风格结果包）。 */
export { extractMineruZip };
