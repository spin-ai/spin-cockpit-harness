/**
 * MinerU 接入（自建 + 云端）。
 *
 * 自建：自动识别 MinerU 4.x 的 V1 API（upload → parse job → zip）与
 *       3.x 的 legacy `POST /file_parse`，与 WeKnora 的探测逻辑一致。
 * 云端：mineru.net v4 batch（申请上传 URL → PUT → 轮询 → zip）。
 *
 * 两者输出都归一化成 Page[]；zip 里有 content_list 时按 page_idx 分页，
 * 保证引用能落到页码。
 */

import crypto from "node:crypto";
import path from "node:path";
import {
  EngineError, authHeader, baseName, expectOk, extractMineruZip, fileExt, joinUrl,
  markdownFromMineruLegacy, multipart, pagesFromContentList,
  readBytes, readJson, readText, request, sleep,
} from "./http.mjs";

export const MINERU_FILE_TYPES = ["pdf", "jpg", "jpeg", "png", "bmp", "tiff", "doc", "docx", "ppt", "pptx", "xlsx"];
export const MINERU_CLOUD_FILE_TYPES = ["pdf", "jpg", "jpeg", "png", "bmp", "tiff", "doc", "docx", "ppt", "pptx"];

const POLL_INITIAL = 2_000;
const POLL_MAX = 30_000;

function mimeOf(fileName) {
  const ext = fileExt(fileName);
  const map = {
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", bmp: "image/bmp", tiff: "image/tiff",
  };
  return map[ext] || "application/octet-stream";
}

function uploadName(fileName, fileType) {
  const clean = baseName(fileName).replace(/[\r\n\u0000]/g, "").trim();
  if (clean && clean !== "." && clean !== "..") {
    return path.extname(clean) ? clean : `${clean}.${fileType || fileExt(clean) || "pdf"}`;
  }
  return `document.${fileType || "pdf"}`;
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function authIfSameOrigin(target, endpoint, apiKey) {
  return sameOrigin(target, endpoint) ? authHeader(apiKey) : {};
}

// ── protocol detection ────────────────────────────────────────────────

async function detectProtocol({ endpoint, apiKey, fetchImpl, signal }) {
  let res;
  try {
    res = await request(joinUrl(endpoint, "/v1/health"), {
      headers: authHeader(apiKey), timeoutMs: 8_000, fetchImpl, signal, retries: 0,
    });
  } catch (error) {
    if (error.code === "engine-timeout" || error.code === "engine-unreachable") throw error;
    throw new EngineError(`无法连接 MinerU：${error.message}`, { code: "engine-unreachable" });
  }
  if (res.status === 401) {
    throw new EngineError(apiKey ? "MinerU API Key 无效" : "MinerU 服务已启用鉴权，请配置 API Key", {
      code: "engine-auth", status: 401,
    });
  }
  if (res.status === 200) {
    const body = await readJson(res).catch(() => ({}));
    if (body?.status === "ok") return "v1";
    throw new EngineError(`MinerU /v1/health 返回异常：${JSON.stringify(body).slice(0, 200)}`, { code: "engine-http" });
  }
  if (res.status === 404 || res.status === 405) return "legacy";
  throw new EngineError(`MinerU /v1/health 返回 HTTP ${res.status}`, { code: "engine-http", status: res.status });
}

function v1Error(message, status = 0) {
  const code = status === 401 || status === 403 ? "engine-auth" : "engine-error";
  return new EngineError(message, { code, status });
}

async function v1Json(url, { method = "GET", body, config, fetchImpl, signal, timeoutMs = 30_000 }) {
  const res = await request(url, {
    method,
    headers: { ...authHeader(config.apiKey), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs, fetchImpl, signal, retries: 2,
  });
  if (!res.ok) {
    const raw = await readText(res).catch(() => "");
    throw v1Error(`MinerU API HTTP ${res.status}：${raw.slice(0, 500)}`, res.status);
  }
  if (res.status === 204) return {};
  return readJson(res);
}

async function v1Upload({ bytes, fileName, fileType, endpoint, config, fetchImpl, signal }) {
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const name = uploadName(fileName, fileType);
  const created = await v1Json(joinUrl(endpoint, "/v1/uploads"), {
    method: "POST",
    body: {
      filename: name, bytes: bytes.length, mime_type: mimeOf(name),
      purpose: "parse", sha256sum: sha,
    },
    config, fetchImpl, signal,
  });
  if (created?.status === "completed" && created?.file?.id) return created.file.id;
  if (created?.status !== "pending" || !created?.id || !created?.upload_url) {
    throw v1Error(`MinerU 上传初始化失败：${JSON.stringify(created).slice(0, 300)}`);
  }
  const uploadUrl = new URL(created.upload_url, endpoint).toString();
  const uploadRes = await request(uploadUrl, {
    method: String(created.upload_method || "PUT").toUpperCase(),
    headers: { ...(created.upload_headers || {}), ...authIfSameOrigin(uploadUrl, endpoint, config.apiKey) },
    body: bytes,
    timeoutMs: config.timeoutMs,
    fetchImpl, signal, retries: 1,
  });
  if (!uploadRes.ok) throw v1Error(`MinerU 文件上传 HTTP ${uploadRes.status}`, uploadRes.status);
  const completed = await v1Json(joinUrl(endpoint, `/v1/uploads/${encodeURIComponent(created.id)}/complete`), {
    method: "POST", body: { sha256sum: sha }, config, fetchImpl, signal,
  });
  if (!completed?.file?.id) {
    throw v1Error(`MinerU 上传完成但未返回 file_id：${JSON.stringify(completed).slice(0, 300)}`);
  }
  return completed.file.id;
}

async function v1CreateJob({ fileId, endpoint, config, fetchImpl, signal }) {
  const payload = {
    files: [{ source: { type: "file_id", file_id: fileId } }],
    output_formats: ["zip"],
  };
  if (config.tier) payload.tier = config.tier;
  if (config.ocrMode) payload.ocr_mode = config.ocrMode;
  const job = await v1Json(joinUrl(endpoint, "/v1/parse/jobs"), {
    method: "POST", body: payload, config, fetchImpl, signal,
  });
  if (!job?.job_id) throw v1Error(`MinerU 未返回 job_id：${JSON.stringify(job).slice(0, 300)}`);
  return job.job_id;
}

async function v1WaitJob({ jobId, endpoint, config, fetchImpl, signal }) {
  const deadline = Date.now() + Number(config.timeoutMs || 1_000_000);
  let interval = POLL_INITIAL;
  for (;;) {
    if (Date.now() > deadline) {
      // 尽力取消，避免服务端继续烧 GPU
      void request(joinUrl(endpoint, `/v1/parse/jobs/${encodeURIComponent(jobId)}`), {
        method: "DELETE", headers: authHeader(config.apiKey), timeoutMs: 10_000, fetchImpl, retries: 0,
      }).catch(() => {});
      throw new EngineError(`MinerU 解析超时（${Math.round((config.timeoutMs || 1_000_000) / 1000)}s）`, { code: "engine-timeout" });
    }
    const job = await v1Json(joinUrl(endpoint, `/v1/parse/jobs/${encodeURIComponent(jobId)}`), {
      config, fetchImpl, signal, timeoutMs: 30_000,
    }).catch((error) => {
      if (error.code === "engine-auth") throw error;
      if (error.status === 404) throw new EngineError("MinerU 解析任务已丢失（服务重启过？）", { code: "engine-job-lost" });
      return null; // 单次轮询失败继续等
    });
    const status = String(job?.status || "");
    if (["completed", "partial", "failed", "canceled"].includes(status)) {
      const file = job?.files?.[0];
      if (file?.status !== "completed") {
        const reason = file?.error?.message || file?.error?.code || status;
        throw new EngineError(`MinerU 解析失败：${reason}`, { code: "engine-parse-failed" });
      }
      const ref = file?.output_files?.zip;
      if (!ref?.file_id) throw new EngineError("MinerU 任务完成但没有 zip 产物", { code: "engine-empty" });
      return ref.file_id;
    }
    await sleep(interval, signal);
    interval = Math.min(POLL_MAX, interval * 2);
  }
}

async function v1Download({ fileId, endpoint, config, fetchImpl, signal }) {
  const res = await request(joinUrl(endpoint, `/v1/files/${encodeURIComponent(fileId)}/content`), {
    headers: authHeader(config.apiKey), timeoutMs: config.timeoutMs, fetchImpl, signal, retries: 2,
  });
  await expectOk(res, "MinerU 产物下载");
  return readBytes(res, { maxBytes: 1 << 30 });
}

async function readMineruV1({ bytes, fileName, fileType, endpoint, config, fetchImpl, signal }) {
  const fileId = await v1Upload({ bytes, fileName, fileType, endpoint, config, fetchImpl, signal });
  const jobId = await v1CreateJob({ fileId, endpoint, config, fetchImpl, signal });
  const zipId = await v1WaitJob({ jobId, endpoint, config, fetchImpl, signal });
  const zip = await v1Download({ fileId: zipId, endpoint, config, fetchImpl, signal });
  const { pages, markdown } = extractMineruZip(zip);
  return { pages, markdown, parser: "mineru/v1", meta: { jobId } };
}

async function readMineruLegacy({ bytes, fileName, fileType, endpoint, config, fetchImpl, signal }) {
  const name = uploadName(fileName, fileType);
  const fields = {
    return_md: "true",
    return_images: "true",
    table_enable: String(config.enableTable !== false),
    formula_enable: String(config.enableFormula !== false),
    parse_method: config.ocrMode === "txt" ? "txt" : config.ocrMode === "ocr" ? "ocr" : "auto",
    start_page_id: "0",
    end_page_id: "99999",
    backend: config.model || "pipeline",
    response_format_zip: "false",
    return_middle_json: "false",
    return_model_output: "false",
    return_content_list: "true",
  };
  if (config.language) fields.lang_list = config.language;
  const res = await request(joinUrl(endpoint, "/file_parse"), {
    method: "POST",
    headers: authHeader(config.apiKey),
    body: multipart(fields, { field: "files", name, bytes, type: mimeOf(name) }),
    timeoutMs: config.timeoutMs,
    fetchImpl, signal, retries: 1,
  });
  await expectOk(res, "MinerU /file_parse");
  const body = await readJson(res);
  const markdown = markdownFromMineruLegacy(body, name);
  const contentList = Object.values(body?.results || {}).find((item) => item?.content_list)?.content_list || null;
  const pages = pagesFromContentList(contentList);
  if (pages.length) return { pages, markdown, parser: "mineru/legacy" };
  if (!markdown) throw new EngineError("MinerU 返回成功但没有 markdown", { code: "engine-empty" });
  return { pages: [{ page_no: 1, markdown }], parser: "mineru/legacy" };
}

export function createMineruEngine() {
  return {
    name: "mineru",
    label: "MinerU（自建）",
    description: "自建 MinerU 服务；自动识别 4.x V1 API 与 3.x /file_parse。",
    local: false,
    fileTypes: MINERU_FILE_TYPES,
    requires: ["endpoint"],
    checkAvailable(config) {
      if (config?.enabled === false) return { available: false, reason: "已在设置中停用" };
      if (!String(config?.endpoint || "").trim()) return { available: false, reason: "未配置 MinerU 服务地址" };
      return { available: true, reason: "" };
    },
    async probe(config, { fetchImpl, signal } = {}) {
      const endpoint = String(config?.endpoint || "").replace(/\/+$/, "");
      if (!endpoint) return { available: false, reason: "未配置 MinerU 服务地址" };
      let protocol;
      try {
        protocol = await detectProtocol({ endpoint, apiKey: config.apiKey, fetchImpl, signal });
      } catch (error) {
        return { available: false, reason: error.message, code: error.code };
      }
      if (protocol === "v1") {
        try {
          const res = await request(joinUrl(endpoint, "/v1/parse/jobs?limit=1"), {
            headers: authHeader(config.apiKey), timeoutMs: 8_000, fetchImpl, signal, retries: 0,
          });
          if (res.status === 401) return { available: false, reason: config.apiKey ? "MinerU API Key 无效" : "MinerU 需要 API Key" };
          return { available: res.status < 500, reason: res.status < 500 ? "" : `HTTP ${res.status}`, protocol };
        } catch (error) {
          return { available: false, reason: error.message, code: error.code };
        }
      }
      try {
        const res = await request(joinUrl(endpoint, "/docs"), {
          headers: authHeader(config.apiKey), timeoutMs: 8_000, fetchImpl, signal, retries: 0,
        });
        return { available: res.status < 400, reason: res.status < 400 ? "" : `HTTP ${res.status}`, protocol };
      } catch (error) {
        return { available: false, reason: error.message, code: error.code };
      }
    },
    createReader(config) {
      return {
        async read({ bytes, fileName, fileType, fetchImpl, signal }) {
          const endpoint = String(config.endpoint || "").replace(/\/+$/, "");
          if (!endpoint) throw new EngineError("未配置 MinerU 服务地址", { code: "engine-unavailable" });
          const protocol = await detectProtocol({ endpoint, apiKey: config.apiKey, fetchImpl, signal });
          const args = { bytes, fileName, fileType, endpoint, config, fetchImpl, signal };
          return protocol === "v1" ? readMineruV1(args) : readMineruLegacy(args);
        },
      };
    },
  };
}

// ── MinerU Cloud ─────────────────────────────────────────────────────

async function cloudPoll({ batchId, baseUrl, config, fetchImpl, signal }) {
  const deadline = Date.now() + Number(config.timeoutMs || 1_800_000);
  for (;;) {
    if (Date.now() > deadline) {
      throw new EngineError(`MinerU Cloud 超时（${Math.round((config.timeoutMs || 1_800_000) / 1000)}s）`, { code: "engine-timeout" });
    }
    let body;
    try {
      const res = await request(joinUrl(baseUrl, `/extract-results/batch/${encodeURIComponent(batchId)}`), {
        headers: authHeader(config.apiKey), timeoutMs: 30_000, fetchImpl, signal, retries: 2,
      });
      await expectOk(res, "MinerU Cloud 轮询");
      body = await readJson(res);
    } catch (error) {
      if (error.code === "engine-auth") throw error;
      await sleep(5_000, signal);
      continue;
    }
    if (body?.code && body.code !== 0) {
      throw new EngineError(`MinerU Cloud 轮询失败：${body.msg || body.code}`, { code: "engine-http" });
    }
    const raw = body?.data?.extract_result;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!items.length) {
      await sleep(5_000, signal);
      continue;
    }
    const item = items[0];
    const state = String(item.state || "").toLowerCase();
    if (state === "failed") throw new EngineError(`MinerU Cloud 解析失败：${item.err_msg || "unknown"}`, { code: "engine-parse-failed" });
    if (state === "done") return item;
    await sleep(5_000, signal);
  }
}

async function cloudResult({ item, config, fetchImpl, signal }) {
  const inline = String(item.markdown || item.content || item.text || "").trim();
  if (inline) {
    const contentList = item.content_list || item.layout || null;
    const pages = pagesFromContentList(contentList);
    return pages.length ? { pages, markdown: inline } : { pages: [{ page_no: 1, markdown: inline }], markdown: inline };
  }
  if (!item.full_zip_url) throw new EngineError("MinerU Cloud 完成但既无 markdown 也无 full_zip_url", { code: "engine-empty" });
  const res = await request(item.full_zip_url, {
    timeoutMs: config.timeoutMs, fetchImpl, signal, retries: 2,
  });
  await expectOk(res, "MinerU Cloud 结果包下载");
  const zip = await readBytes(res, { maxBytes: 1 << 30 });
  return extractMineruZip(zip);
}

export function createMineruCloudEngine() {
  return {
    name: "mineru_cloud",
    label: "MinerU 云端",
    description: "mineru.net v4 batch API；需要 API Key，文件会上传到云端。",
    local: false,
    fileTypes: MINERU_CLOUD_FILE_TYPES,
    requires: ["apiKey"],
    checkAvailable(config) {
      if (config?.enabled === false) return { available: false, reason: "已在设置中停用" };
      if (!String(config?.apiKey || "").trim()) return { available: false, reason: "未配置 MinerU Cloud API Key" };
      return { available: true, reason: "" };
    },
    async probe(config, { fetchImpl, signal } = {}) {
      if (!String(config?.apiKey || "").trim()) return { available: false, reason: "未配置 MinerU Cloud API Key" };
      const baseUrl = String(config.baseUrl || "https://mineru.net/api/v4").replace(/\/+$/, "");
      try {
        const res = await request(joinUrl(baseUrl, "/file-urls/batch"), {
          method: "POST",
          headers: { ...authHeader(config.apiKey), "Content-Type": "application/json" },
          body: JSON.stringify({ files: [], model_version: config.model || "pipeline" }),
          timeoutMs: 15_000, fetchImpl, signal, retries: 0,
        });
        if (res.status === 401 || res.status === 403) return { available: false, reason: "MinerU Cloud API Key 无效" };
        return { available: true, reason: "" };
      } catch (error) {
        return { available: false, reason: error.message, code: error.code };
      }
    },
    createReader(config) {
      return {
        async read({ bytes, fileName, fileType, fetchImpl, signal }) {
          if (!config.apiKey) throw new EngineError("未配置 MinerU Cloud API Key", { code: "engine-unavailable" });
          const baseUrl = String(config.baseUrl || "https://mineru.net/api/v4").replace(/\/+$/, "");
          const name = uploadName(fileName, fileType);
          const res = await request(joinUrl(baseUrl, "/file-urls/batch"), {
            method: "POST",
            headers: { ...authHeader(config.apiKey), "Content-Type": "application/json" },
            body: JSON.stringify({
              files: [{ name, data_id: crypto.randomUUID() }],
              model_version: config.model || "pipeline",
              is_ocr: config.enableOcr !== false,
              enable_formula: config.enableFormula !== false,
              enable_table: config.enableTable !== false,
              language: config.language || "ch",
            }),
            timeoutMs: 30_000, fetchImpl, signal, retries: 2,
          });
          await expectOk(res, "MinerU Cloud 申请上传");
          const applied = await readJson(res);
          if (applied?.code && applied.code !== 0) throw new EngineError(`MinerU Cloud：${applied.msg || applied.code}`, { code: "engine-http" });
          const uploadUrl = applied?.data?.file_urls?.[0];
          const batchId = applied?.data?.batch_id;
          if (!uploadUrl || !batchId) throw new EngineError("MinerU Cloud 未返回上传地址", { code: "engine-empty" });
          const upload = await request(uploadUrl, {
            method: "PUT", body: bytes, timeoutMs: config.timeoutMs, fetchImpl, signal, retries: 1,
          });
          if (!upload.ok) throw new EngineError(`MinerU Cloud 上传 HTTP ${upload.status}`, { code: "engine-http", status: upload.status });
          const item = await cloudPoll({ batchId, baseUrl, config, fetchImpl, signal });
          const result = await cloudResult({ item, config, fetchImpl, signal });
          return { ...result, parser: "mineru_cloud/v4" };
        },
      };
    },
  };
}
