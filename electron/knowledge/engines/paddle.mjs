/**
 * PaddleOCR-VL 接入（自建 + 云端）。
 *
 * 自建：PaddleX pipeline 服务的 `POST /layout-parsing`，base64 文件，
 *       同步返回逐页 layoutParsingResults（含 markdown + 内联图片）。
 * 云端：AI Studio OCR jobs，multipart 提交 → 轮询 job → 下载 JSONL。
 *
 * 与 WeKnora 一样，两类引擎共用同一套识别参数，保证自建/云输出尽量一致。
 */

import {
  EngineError, authHeader, baseName, expectOk, fileExt, joinUrl, multipart,
  pagesFromPaddleLayout, readJson, readText, request, sleep,
} from "./http.mjs";

export const PADDLE_FILE_TYPES = ["pdf", "jpg", "jpeg", "png", "bmp", "tiff"];

const CLOUD_POLL_MS = 5_000;

function recognitionParams(config = {}) {
  return {
    markdownIgnoreLabels: ["header", "header_image", "footer", "footer_image", "number", "footnote", "aside_text"],
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    useLayoutDetection: true,
    useChartRecognition: Boolean(config.useChartRecognition),
    useSealRecognition: config.useSealRecognition !== false,
    useOcrForImageBlock: false,
    mergeTables: true,
    relevelTitles: true,
    restructurePages: true,
    layoutShapeMode: "auto",
    promptLabel: "ocr",
    layoutNms: true,
    repetitionPenalty: 1,
    temperature: 0,
    topP: 1,
    minPixels: 147_384,
    maxPixels: 2_822_400,
  };
}

function fileTypeCode(fileType) {
  return String(fileType || "").toLowerCase() === "pdf" ? 0 : 1;
}

function mimeOf(fileName) {
  const ext = fileExt(fileName);
  return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", bmp: "image/bmp", tiff: "image/tiff" })[ext] || "application/octet-stream";
}

function paddleFileName(fileName, fileType) {
  const clean = baseName(fileName);
  if (clean && pathHasExt(clean)) return clean;
  return `document.${fileType || "pdf"}`;
}

function pathHasExt(name) {
  return /\.[a-z0-9]{1,6}$/i.test(name);
}

export function createPaddleEngine() {
  return {
    name: "paddleocr_vl",
    label: "PaddleOCR-VL（自建）",
    description: "自建 PaddleX PaddleOCR-VL pipeline；逐页返回 markdown，表格/印章识别可配。",
    local: false,
    fileTypes: PADDLE_FILE_TYPES,
    requires: ["endpoint"],
    checkAvailable(config) {
      if (config?.enabled === false) return { available: false, reason: "已在设置中停用" };
      if (!String(config?.endpoint || "").trim()) return { available: false, reason: "未配置 PaddleOCR-VL 服务地址" };
      return { available: true, reason: "" };
    },
    async probe(config, { fetchImpl, signal } = {}) {
      const endpoint = String(config?.endpoint || "").replace(/\/+$/, "");
      if (!endpoint) return { available: false, reason: "未配置 PaddleOCR-VL 服务地址" };
      try {
        // pipeline 只暴露 POST /layout-parsing；GET 能拿到 404/405 也说明服务在线
        const res = await request(joinUrl(endpoint, "/layout-parsing"), {
          timeoutMs: 8_000, fetchImpl, signal, retries: 0,
        });
        return res.status < 500
          ? { available: true, reason: "" }
          : { available: false, reason: `服务返回 HTTP ${res.status}` };
      } catch (error) {
        return { available: false, reason: error.message, code: error.code };
      }
    },
    createReader(config) {
      return {
        async read({ bytes, fileName, fileType, fetchImpl, signal }) {
          const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
          if (!endpoint) throw new EngineError("未配置 PaddleOCR-VL 服务地址", { code: "engine-unavailable" });
          const payload = {
            ...recognitionParams(config),
            file: bytes.toString("base64"),
            fileType: fileTypeCode(fileType),
            visualize: false,
          };
          const res = await request(joinUrl(endpoint, "/layout-parsing"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: config.timeoutMs,
            fetchImpl, signal, retries: 1,
          });
          await expectOk(res, "PaddleOCR-VL /layout-parsing");
          const body = await readJson(res);
          if (Number(body?.errorCode || 0) !== 0) {
            throw new EngineError(`PaddleOCR-VL 错误 ${body.errorCode}：${body.errorMsg || ""}`, { code: "engine-parse-failed" });
          }
          const pages = pagesFromPaddleLayout(body);
          if (!pages.length) throw new EngineError("PaddleOCR-VL 返回成功但没有内容", { code: "engine-empty" });
          return { pages, parser: "paddleocr_vl/layout-parsing" };
        },
      };
    },
  };
}

async function cloudPoll({ jobId, baseUrl, config, fetchImpl, signal }) {
  const deadline = Date.now() + Number(config.timeoutMs || 600_000);
  for (;;) {
    if (Date.now() > deadline) {
      throw new EngineError(`PaddleOCR-VL Cloud 超时（${Math.round((config.timeoutMs || 600_000) / 1000)}s）`, { code: "engine-timeout" });
    }
    let body;
    try {
      const res = await request(joinUrl(baseUrl, `/${encodeURIComponent(jobId)}`), {
        headers: authHeader(config.token), timeoutMs: 30_000, fetchImpl, signal, retries: 2,
      });
      if (res.status === 401 || res.status === 403) {
        throw new EngineError("PaddleOCR-VL Cloud Token 无效", { code: "engine-auth", status: res.status });
      }
      if (!res.ok) {
        await sleep(CLOUD_POLL_MS, signal);
        continue;
      }
      body = await readJson(res);
    } catch (error) {
      if (error.code === "engine-auth") throw error;
      await sleep(CLOUD_POLL_MS, signal);
      continue;
    }
    const state = String(body?.data?.state || "").toLowerCase();
    if (state === "done") {
      const jsonUrl = body?.data?.resultUrl?.jsonUrl;
      if (!jsonUrl) throw new EngineError("PaddleOCR-VL Cloud 完成但没有 jsonUrl", { code: "engine-empty" });
      return jsonUrl;
    }
    if (state === "failed") {
      throw new EngineError(`PaddleOCR-VL Cloud 失败：${body?.data?.errorMsg || "unknown"}`, { code: "engine-parse-failed" });
    }
    await sleep(CLOUD_POLL_MS, signal);
  }
}

function pagesFromJsonl(text) {
  const pages = [];
  for (const line of String(text || "").split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const chunk = pagesFromPaddleLayout(parsed);
    for (const page of chunk) pages.push({ page_no: pages.length + 1, markdown: page.markdown });
  }
  return pages;
}

export function createPaddleCloudEngine() {
  return {
    name: "paddleocr_vl_cloud",
    label: "PaddleOCR-VL 云端",
    description: "百度 AI Studio PaddleOCR-VL jobs API；需要 token，文件会上传到云端。",
    local: false,
    fileTypes: PADDLE_FILE_TYPES,
    requires: ["token"],
    checkAvailable(config) {
      if (config?.enabled === false) return { available: false, reason: "已在设置中停用" };
      if (!String(config?.token || "").trim()) return { available: false, reason: "未配置 PaddleOCR-VL Cloud Token" };
      return { available: true, reason: "" };
    },
    async probe(config) {
      // 云端没有轻量健康检查，只验证配置
      if (config?.enabled === false) return { available: false, reason: "已在设置中停用" };
      if (!String(config?.token || "").trim()) return { available: false, reason: "未配置 PaddleOCR-VL Cloud Token" };
      return { available: true, reason: "" };
    },
    createReader(config) {
      return {
        async read({ bytes, fileName, fileType, fetchImpl, signal }) {
          if (!config.token) throw new EngineError("未配置 PaddleOCR-VL Cloud Token", { code: "engine-unavailable" });
          const baseUrl = String(config.baseUrl || "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs").replace(/\/+$/, "");
          const name = paddleFileName(fileName, fileType);
          const form = multipart(
            { model: config.model || "PaddleOCR-VL-1.6", optionalPayload: JSON.stringify(recognitionParams(config)) },
            { field: "file", name, bytes, type: mimeOf(name) }
          );
          const submit = await request(baseUrl, {
            method: "POST",
            headers: { Authorization: `bearer ${config.token}` },
            body: form,
            timeoutMs: 60_000,
            fetchImpl, signal, retries: 1,
          });
          await expectOk(submit, "PaddleOCR-VL Cloud 提交");
          const submitted = await readJson(submit);
          const jobId = submitted?.data?.jobId;
          if (!jobId) {
            throw new EngineError(`PaddleOCR-VL Cloud 未返回 jobId：${JSON.stringify(submitted).slice(0, 300)}`, { code: "engine-empty" });
          }
          const jsonUrl = await cloudPoll({ jobId, baseUrl, config, fetchImpl, signal });
          const result = await request(jsonUrl, { timeoutMs: 120_000, fetchImpl, signal, retries: 2 });
          await expectOk(result, "PaddleOCR-VL Cloud 结果下载");
          const pages = pagesFromJsonl(await readText(result));
          if (!pages.length) throw new EngineError("PaddleOCR-VL Cloud 结果为空", { code: "engine-empty" });
          return { pages, parser: "paddleocr_vl_cloud/jobs" };
        },
      };
    },
  };
}
