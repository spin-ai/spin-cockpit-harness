/**
 * Ark（火山方舟）客户端。
 *
 * 实测（2026-11）：现有 pi 配置的那把 key 是 **agent plan 网关**的 key：
 *   /api/plan/v3  → chat ✅ / embeddings（仅 vision 模型）✅
 *   /api/v3       → 401（标准 OpenAPI 不认这把 key）
 *   rerank        → 404（plan 网关没有可用 rerank 模型）
 * 所以：一把 key 覆盖问答 / VLM / embedding，rerank 第一版不做。
 */

export const ARK_BASE = "https://ark.cn-beijing.volces.com/api/plan/v3";

/** bot 对话可选模型（composer 右下角那个列表的数据源）；只列能走 chat/completions 的 */
export const CHAT_MODEL_CATALOG = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", hint: "便宜、快，默认" },
  { id: "doubao-seed-2.1-turbo", name: "Doubao Seed 2.1 Turbo", hint: "推理更强、贵一些" },
];

export const MODELS = {
  chat: "doubao-seed-2.1-turbo",   // 推理 / 多模态 / 图注 / VLM OCR
  fast: "deepseek-v4-flash",       // 问答 / 汇总，便宜
  embed: "doubao-embedding-vision-250328", // 2048 维，文本 + 图片同空间
};

/**
 * 只认「显式传入」和「本进程环境变量」两种来源，且必须是 ARK_API_KEY。
 *
 * 早期版本还会顺手去读 `~/.pi/agent/models.json` 里任意 provider 的 key ——
 * 那相当于借用别的应用的凭据往火山发数据，用户完全不知情，已删除。
 * 需要 key 的场景（embedding / 问答）必须先在本应用里配置：
 * 设置 → 执行 → 模型密钥 / 环境变量里写 `ARK_API_KEY=...`。
 */
export function resolveArkKey(explicit) {
  if (explicit) return String(explicit).trim() || null;
  const fromEnv = String(process.env.ARK_API_KEY || "").trim();
  return fromEnv || null;
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

/** 从一条 SSE `data:` 负载里取出增量文本；纯函数，便于自测。 */
export function parseSseDelta(payload) {
  const raw = String(payload || "").trim();
  if (!raw || raw === "[DONE]") return "";
  try {
    const json = JSON.parse(raw);
    const choice = json?.choices?.[0];
    return String(choice?.delta?.content ?? choice?.message?.content ?? "");
  } catch { return ""; }
}

/**
 * 流式对话：给 bot 的被动回复用。
 * Ark 的 plan 网关是 OpenAI 兼容的 SSE；如果不是 event-stream（网关降级），
 * 就退回一次性 JSON，仍然按同一份 onDelta 协议吐一次全文。
 *
 * `tools` 是 OpenAI 同构的 function calling：模型可能在流里吐 tool_calls，
 * 这里只负责**把调用拼完整**（id / name / arguments 分片到达），执行与循环在调用方。
 */
export async function chatStream(messages, { key, model = MODELS.fast, temperature = 0.6, maxTokens = 700, signal, onDelta, onReasoning, tools = null, thinking, extra } = {}) {
  if (!key) { const err = new Error("缺少 Ark API key"); err.code = "no-key"; throw err; }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120000);
  if (signal) signal.addEventListener("abort", () => ac.abort(), { once: true });
  const withTools = Array.isArray(tools) && tools.length > 0;
  const startedAt = Date.now();
  try {
    const res = await fetch(`${ARK_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model, messages, temperature, max_tokens: maxTokens, stream: true,
        stream_options: { include_usage: true },
        ...(withTools ? { tools, tool_choice: "auto" } : {}),
        // 「快速」档：能关思考的模型直接关（不关的话推理 token 会先把首字拖到十几秒）
        ...(thinking === "off" ? { thinking: { type: "disabled" } } : {}),
        // 各网关的推理字段（thinking / reasoning_effort …）：认就生效，不认由调用方 400 后重试
        ...(extra && typeof extra === "object" ? extra : {}),
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`Ark ${res.status}: ${detail.slice(0, 200)}`);
      err.code = `http-${res.status}`;
      throw err;
    }
    const type = String(res.headers.get("content-type") || "");
    if (!type.includes("event-stream")) {
      const json = await res.json().catch(() => ({}));
      const message = json?.choices?.[0]?.message || {};
      const text = String(message.content || "");
      const thought = String(message.reasoning_content || message.reasoning || "");
      if (text) onDelta?.(text);
      if (thought) onReasoning?.(thought);
      return { text, reasoning: thought, toolCalls: normalizeToolCalls(message.tool_calls), usage: json?.usage || {}, ttft: text ? Date.now() - startedAt : undefined, model };
    }
    let text = "";
    let reasoning = "";
    let buffer = "";
    let finishReason = "";
    let usage = {};
    let firstTokenAt = 0;
    const calls = [];
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }
        const choice = payload?.choices?.[0] || {};
        if (choice.finish_reason) finishReason = String(choice.finish_reason);
        if (payload?.usage) usage = payload.usage;
        const delta = choice.delta || {};
        if (delta.content) { if (!firstTokenAt) firstTokenAt = Date.now(); text += delta.content; onDelta?.(delta.content); }
        // 推理模型的思考流：以前直接丢掉，界面上就只能看到「正在想…」直到正文开始
        const rdelta = delta.reasoning_content ?? delta.reasoning;
        if (rdelta) { if (!firstTokenAt) firstTokenAt = Date.now(); reasoning += rdelta; onReasoning?.(rdelta); }
        // tool_calls 分片到达：按 index 拼 id / name / arguments
        for (const part of delta.tool_calls || []) {
          const slot = calls[part.index ?? 0] || (calls[part.index ?? 0] = { id: "", name: "", args: "" });
          if (part.id) slot.id = part.id;
          if (part.function?.name) slot.name += part.function.name;
          if (part.function?.arguments) { if (!firstTokenAt) firstTokenAt = Date.now(); slot.args += part.function.arguments; }
        }
      }
    }
    return { text, reasoning, toolCalls: calls.filter((c) => c && c.name), usage, ttft: firstTokenAt ? firstTokenAt - startedAt : undefined, model, finishReason };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tc) => ({ id: String(tc?.id || ""), name: String(tc?.function?.name || ""), args: String(tc?.function?.arguments || "{}") }))
    .filter((tc) => tc.name);
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
