/**
 * 解析引擎共用的 HTTP / 归一化工具。
 *
 * 所有外部引擎都遵守同一条约定：
 *   文件字节 → HTTP → 统一成 Page[]（page_no + markdown）
 * 这一层不依赖 Electron，可直接用 node 做契约测试。
 */

import AdmZip from "adm-zip";

export const DEFAULT_HTTP_TIMEOUT = 60_000;
export const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;

export class EngineError extends Error {
  constructor(message, { code = "engine-error", status = 0, detail = "" } = {}) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new EngineError("已取消", { code: "aborted" }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new EngineError("已取消", { code: "aborted" }));
    }, { once: true });
  });

export function joinUrl(base, pathname) {
  const left = String(base || "").replace(/\/+$/, "");
  const right = String(pathname || "").replace(/^\/+/, "");
  return right ? `${left}/${right}` : left;
}

export function fileExt(fileName) {
  const name = String(fileName || "").replace(/\\/g, "/").split("/").pop() || "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function baseName(fileName) {
  return String(fileName || "").replace(/\\/g, "/").split("/").pop() || "document";
}

export function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 带超时与有限重试的 fetch。重试只覆盖网络错误和 429/5xx。
 * @returns {Promise<Response>}
 */
export async function request(url, {
  method = "GET",
  headers = {},
  body,
  timeoutMs = DEFAULT_HTTP_TIMEOUT,
  fetchImpl = globalThis.fetch,
  signal,
  retries = 2,
  retryStatuses = [429, 500, 502, 503, 504],
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new EngineError("当前运行时没有 fetch", { code: "no-fetch" });
  }
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)), signal);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new EngineError(`请求超时（${Math.round(timeoutMs / 1000)}s）`, { code: "engine-timeout" })), timeoutMs);
    const onAbort = () => ac.abort(signal.reason || new EngineError("已取消", { code: "aborted" }));
    signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: ac.signal });
      if (retryStatuses.includes(res.status) && attempt < retries) {
        lastError = new EngineError(`HTTP ${res.status}`, { code: "http-retry", status: res.status });
        continue;
      }
      return res;
    } catch (error) {
      if (ac.signal.aborted) {
        throw error instanceof EngineError ? error : new EngineError("请求超时", { code: "engine-timeout" });
      }
      lastError = error;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }
  throw new EngineError(`请求失败：${lastError?.message || lastError}`, { code: "engine-unreachable" });
}

export async function readText(res, { maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const text = await res.text();
  if (text.length > maxBytes) return text.slice(0, maxBytes);
  return text;
}

export async function readJson(res) {
  const text = await readText(res);
  try {
    return JSON.parse(text);
  } catch {
    throw new EngineError(`响应不是 JSON：${text.slice(0, 300)}`, { code: "bad-json", status: res.status });
  }
}

export async function expectOk(res, label) {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  throw new EngineError(`${label} 返回 HTTP ${res.status}：${text.slice(0, 500)}`, {
    code: res.status === 401 || res.status === 403 ? "engine-auth" : "engine-http",
    status: res.status,
  });
}

export function multipart(fields = {}, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  if (file) {
    const blob = new Blob([file.bytes], { type: file.type || "application/octet-stream" });
    fd.append(file.field || "file", blob, file.name || "document");
  }
  return fd;
}

/** 读取二进制响应，并限制大小。 */
export async function readBytes(res, { maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new EngineError(`响应超过 ${maxBytes} 字节`, { code: "response-too-large" });
  return buf;
}

export function dotGet(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").filter(Boolean).reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

const trim = (s) => String(s ?? "").replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();

/** 统一成 Page[]。任何引擎最后都走这里。 */
export function normalizePages(input) {
  let pages = [];
  if (Array.isArray(input)) pages = input;
  else if (input && Array.isArray(input.pages)) pages = input.pages;
  else if (input && typeof input.markdown === "string") pages = [{ page_no: 1, markdown: input.markdown }];
  else if (typeof input === "string") pages = [{ page_no: 1, markdown: input }];
  return pages
    .map((page, i) => ({
      page_no: Number(page?.page_no) || i + 1,
      markdown: trim(page?.markdown ?? page?.text ?? page?.content ?? ""),
    }))
    .filter((page) => page.markdown)
    .sort((a, b) => a.page_no - b.page_no);
}

/** MinerU content_list → 页级 markdown（保住页码，引用才有落点）。 */
export function pagesFromContentList(contentList) {
  let list = contentList;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const byPage = new Map();
  for (const block of list) {
    const page = Number(block?.page_idx);
    const pageNo = Number.isFinite(page) ? page + 1 : 1;
    const type = String(block?.type || "text");
    let text = "";
    if (type === "text" || type === "title") {
      const level = Math.min(6, Math.max(1, Number(block.text_level) || 0));
      text = `${level ? `${"#".repeat(level)} ` : ""}${block.text || ""}`;
    } else if (type === "table") {
      text = block.table_body || block.table_caption?.join("\n") || "";
    } else if (type === "image") {
      const caption = (block.image_caption || []).join(" ");
      text = block.img_path ? `![${caption}](${block.img_path})` : caption;
    } else if (type === "equation") {
      text = block.text ? `$$${block.text}$$` : "";
    } else {
      text = block.text || block.content || "";
    }
    if (!trim(text)) continue;
    if (!byPage.has(pageNo)) byPage.set(pageNo, []);
    byPage.get(pageNo).push(trim(text));
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page_no, parts]) => ({ page_no, markdown: parts.join("\n\n") }));
}

/**
 * MinerU zip 结果包 → 页级 markdown。
 * 优先 content_list（有页码），退回整份 .md。
 */
export function extractMineruZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (error) {
    throw new EngineError(`MinerU 结果包不是合法 zip：${error.message}`, { code: "bad-zip" });
  }
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const depth = (name) => String(name).split("/").length;
  const mdFile = entries
    .filter((entry) => /\.md$/i.test(entry.entryName))
    .sort((a, b) => depth(a.entryName) - depth(b.entryName) || a.entryName.localeCompare(b.entryName))[0];
  const listFile = entries
    .filter((entry) => /(^|\/)content_list\.json$/i.test(entry.entryName))
    .sort((a, b) => depth(a.entryName) - depth(b.entryName) || a.entryName.localeCompare(b.entryName))[0];
  let markdown = "";
  let contentList = null;
  try {
    if (mdFile) markdown = trim(mdFile.getData().toString("utf8"));
    if (listFile) contentList = JSON.parse(listFile.getData().toString("utf8"));
  } catch (error) {
    throw new EngineError(`读取 MinerU 结果包失败：${error.message}`, { code: "bad-zip-entry" });
  }
  const pages = pagesFromContentList(contentList);
  if (pages.length) return { pages, markdown: pages.map((p) => p.markdown).join("\n\n"), contentList };
  if (!markdown) throw new EngineError("MinerU 结果包里没有 markdown", { code: "empty" });
  return { pages: [{ page_no: 1, markdown }], markdown, contentList };
}

/** PaddleOCR-VL / PaddleX 的 layoutParsingResults → Page[]。 */
export function pagesFromPaddleLayout(data) {
  const results = data?.result?.layoutParsingResults || data?.layoutParsingResults || [];
  if (!Array.isArray(results)) return [];
  return results
    .map((page, i) => ({ page_no: i + 1, markdown: trim(page?.markdown?.text || page?.markdown || "") }))
    .filter((page) => page.markdown);
}

/** MinerU legacy /file_parse 响应 → markdown（兼容 results.<stem> 与顶层字段）。 */
export function markdownFromMineruLegacy(body, fileName) {
  const results = body?.results;
  if (results && typeof results === "object") {
    const stem = baseName(fileName).replace(/\.[^.]+$/, "");
    const candidates = [stem, "document", "files", ...Object.keys(results)];
    for (const key of candidates) {
      const entry = results[key];
      if (entry && (entry.md_content || entry.markdown)) return String(entry.md_content || entry.markdown);
    }
  }
  return String(body?.md_content || body?.markdown || "");
}

export function isJsonResponse(res) {
  return /application\/json|text\/json/i.test(res.headers.get("content-type") || "");
}

export function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
