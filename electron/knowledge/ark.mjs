/**
 * Ark（火山方舟）客户端。
 *
 * 实测（2026-11）：现有 pi 配置的那把 key 是 **agent plan 网关**的 key：
 *   /api/plan/v3  → chat ✅ / embeddings（仅 vision 模型）✅
 *   /api/v3       → 401（标准 OpenAPI 不认这把 key）
 *   rerank        → 404（plan 网关没有可用 rerank 模型）
 * 所以：一把 key 覆盖问答 / VLM / embedding，rerank 第一版不做。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ARK_BASE = "https://ark.cn-beijing.volces.com/api/plan/v3";

export const MODELS = {
  chat: "doubao-seed-2.1-turbo",   // 推理 / 多模态 / 图注 / VLM OCR
  fast: "deepseek-v4-flash",       // 问答 / 汇总，便宜
  embed: "doubao-embedding-vision-250328", // 2048 维，文本 + 图片同空间
};

/** 依次尝试：显式传入 → 环境变量 → pi 的 models.json → null */
export function resolveArkKey(explicit) {
  if (explicit) return explicit;
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  const candidates = [
    path.join(os.homedir(), ".pi", "agent", "models.json"),
    path.join(os.homedir(), ".pi", "models.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const provider of Object.values(raw.providers || {})) {
        if (provider?.apiKey) return provider.apiKey;
      }
    } catch { /* 忽略 */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(pathname, body, { key, signal, retries = 3, timeoutMs = 60000 } = {}) {
  if (!key) {
    const err = new Error("缺少 Ark API key");
    err.code = "no-key";
    throw err;
  }
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(8000, 400 * 2 ** attempt));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });
    try {
      const res = await fetch(`${ARK_BASE}${pathname}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Ark ${res.status}: ${await res.text().catch(() => "")}`);
        lastError.retryable = true;
        continue;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json?.error?.message || `Ark ${res.status}`);
        err.code = json?.error?.code || `http-${res.status}`;
        err.status = res.status;
        throw err;
      }
      return json;
    } catch (e) {
      if (e.code && e.status) throw e;   // 业务错误不重试
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Ark 请求失败");
}

/**
 * 文本 / 图片 embedding。
 * @param {string[]} inputs
 * @returns {Promise<{vectors: Float32Array[], dim: number, usage: object, model: string}>}
 */
export async function embed(inputs, { key, model = MODELS.embed, batch = 16, signal } = {}) {
  const list = (Array.isArray(inputs) ? inputs : [inputs]).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!list.length) return { vectors: [], dim: 0, usage: {}, model };
  const vectors = [];
  let usage = { prompt_tokens: 0, total_tokens: 0 };
  let dim = 0;
  for (let i = 0; i < list.length; i += batch) {
    const slice = list.slice(i, i + batch);
    const json = await post("/embeddings", { model, input: slice }, { key, signal });
    for (const item of json.data || []) {
      const vec = Float32Array.from(item.embedding || []);
      dim = vec.length;
      vectors.push(vec);
    }
    usage = {
      prompt_tokens: (usage.prompt_tokens || 0) + (json.usage?.prompt_tokens || 0),
      total_tokens: (usage.total_tokens || 0) + (json.usage?.total_tokens || 0),
    };
  }
  return { vectors, dim, usage, model };
}

/** 纯文本对话（问答 / 结构化抽取 / listwise rerank 都用它）。 */
export async function chat(messages, { key, model = MODELS.fast, temperature = 0, maxTokens = 1024, json = false, signal } = {}) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  const json_ = await post("/chat/completions", body, { key, signal });
  const choice = json_.choices?.[0];
  return {
    text: String(choice?.message?.content || ""),
    reasoning: String(choice?.message?.reasoning_content || ""),
    usage: json_.usage || {},
    model,
  };
}

/** 建索引前的自检：key 是否可用于 embedding。 */
export async function probe({ key } = {}) {
  const k = resolveArkKey(key);
  if (!k) return { ok: false, code: "no-key", message: "未找到 Ark API key" };
  try {
    const res = await embed(["探活"], { key: k });
    return { ok: true, dim: res.dim, model: res.model, usage: res.usage };
  } catch (e) {
    return { ok: false, code: e.code || "error", message: e.message };
  }
}
