/**
 * 视觉解析插件的解析内核（跑在 utilityProcess 里）。
 *
 * 三种后端，配置来自插件设置（设置 → 插件 → 视觉解析）：
 *  - zhulong：自部署的 zhulong-vl 验证台服务，POST {endpoint}/api/parse（multipart）
 *  - openai：OpenAI 兼容多模态接口，POST {endpoint}/v1/chat/completions（image_url）
 *  - custom：任意 HTTP 解析服务，POST {endpoint}（JSON：{ scene, image, mime, model }）
 *
 * 返回给渲染层的结构统一：
 *   { backend, scene, size, blocks[{id,type,bbox,text,cls,conf}], relations[], checks[], warnings[], elapsedMs }
 *
 * 这里不落盘、不写项目文件：图片只在一次请求内进内存，避免截图/证件照被静默留档。
 */

const SCENES = {
  arch: { label: "手绘架构图", expect: ["box", "text", "arrow"] },
  ui: { label: "界面截图", expect: ["text", "button", "input", "container"] },
  pdf: { label: "PDF 页面", expect: ["text", "table", "image"] },
  ppt: { label: "拍照 PPT", expect: ["text", "image"] },
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

let ctxRef = null;
/** 当前解析请求的取消句柄；用户点「取消」时由 runtime 的 cancel 通道触发 */
let currentAbort = null;

async function cfg(key, fallback) {
  const value = await ctxRef.settings.get(key);
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

async function readConfig() {
  return {
    backend: String(await cfg("backend", "zhulong")),
    endpoint: String(await cfg("endpoint", "http://127.0.0.1:8000")).replace(/\/+$/, ""),
    apiKey: String(await cfg("apiKey", "")),
    model: String(await cfg("model", "")),
    weights: String(await cfg("weights", "")),
    imgsz: Number(await cfg("imgsz", 800)) || 800,
    conf: Number(await cfg("conf", 0.35)) || 0.35,
    relations: Boolean(await cfg("relations", true)),
    ocr: Boolean(await cfg("ocr", true)),
    timeoutMs: Math.max(5000, Number(await cfg("timeoutMs", 60000)) || 60000),
  };
}

function splitDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!match) throw new Error("图片数据需要是 data URL");
  const mime = match[1] || "image/png";
  if (!/^image\//.test(mime)) throw new Error(`不支持的图片类型：${mime}`);
  const base64 = match[3] || "";
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("图片内容为空");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`图片过大：${(bytes.length / 1024 / 1024).toFixed(1)}MB > 12MB`);
  return { mime, base64, bytes };
}

/**
 * 坐标约定：**线上格式是 [x, y, w, h]**（与 zhulong 的 block.schema.json 一致），
 * 内部统一转成 [x1, y1, x2, y2] 再交给渲染与核对，避免两边混用。
 * 之前把 [x,y,w,h] 当 [x1,y1,x2,y2] 画，框宽会算成负数被兜成 1px——这里必须显式转。
 */
function toXyxy(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [0, 0, 0, 0];
  const [x, y, w, h] = bbox.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return [0, 0, 0, 0];
  // 不做「像 xyxy 就猜一下」的容错：假设写死了反而会把正常框拉飞。约定只有一种，写进文档与 prompt。
  return [x, y, x + w, y + h];
}

/**
 * 从图片字节里读真实像素尺寸。视觉模型经常自己「猜」一个画布尺寸
 * （实测 doubao 把 320×200 的图报成 1600×1000），bbox 也是按它猜的尺寸给的，
 * 不校准就会画到图外面去。
 */
export function imageSize(bytes, mime) {
  try {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const type = String(mime || "").toLowerCase();
    if (type.includes("png") || (buf[0] === 0x89 && buf[1] === 0x50)) {
      if (buf.length < 24) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type.includes("jpeg") || type.includes("jpg") || (buf[0] === 0xff && buf[1] === 0xd8)) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (type.includes("gif") || buf.subarray(0, 3).toString() === "GIF") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (type.includes("webp") || buf.subarray(8, 12).toString() === "WEBP") {
      const kind = buf.subarray(12, 16).toString();
      if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch { /* 认不出就返回 null */ }
  return null;
}

/**
 * 把模型给的 bbox 从「它猜的画布」换算到真实像素；比例接近 1 就不动。
 * 返回新的结果对象（不改入参），并补一条核对项说明是否校准过。
 */
export function calibrateToImage(result, real) {
  if (!real || !(real.width > 0) || !(real.height > 0)) return result;
  const [w, h] = result.size || [0, 0];
  const sx = w > 0 ? real.width / w : 1;
  const sy = h > 0 ? real.height / h : 1;
  const scale = (w > 0 && h > 0) && (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01);
  const blocks = scale
    ? result.blocks.map((b) => ({
        ...b,
        bbox: [b.bbox[0] * sx, b.bbox[1] * sy, b.bbox[2] * sx, b.bbox[3] * sy],
      }))
    : result.blocks;
  const check = {
    name: "坐标校准",
    level: scale ? "warn" : "ok",
    ok: true,
    detail: scale
      ? `模型给的画布是 ${w}×${h}，按真实 ${real.width}×${real.height} 换算（×${sx.toFixed(2)}, ×${sy.toFixed(2)}）`
      : `模型画布与真实尺寸一致（${real.width}×${real.height}）`,
  };
  return { ...result, size: [real.width, real.height], blocks, checks: [...result.checks, check] };
}

function normalizeBlock(raw, index, fallbackType = "text") {
  return {
    id: String(raw?.id || `b${index + 1}`),
    type: String(raw?.type || raw?.cls || fallbackType),
    cls: String(raw?.cls || raw?.type || fallbackType),
    bbox: toXyxy(raw?.bbox),
    text: String(raw?.text ?? ""),
    conf: Number.isFinite(Number(raw?.conf)) ? Number(raw.conf) : null,
  };
}

/** 后端各自返回的形状 → 统一结构；认不出就报错，不猜 */
export function normalizeResult(body, { backend, scene, bytes, mime, elapsedMs }) {
  const blocksRaw = Array.isArray(body?.blocks) ? body.blocks
    : Array.isArray(body?.elements) ? body.elements
      : Array.isArray(body?.result?.blocks) ? body.result.blocks : [];
  if (!blocksRaw.length) {
    throw new Error(
      "解析服务没有返回区块（blocks 为空）。"
      + "可能是图片里没有可识别内容、模型不是视觉模型，或模型只回了说明文字没回 JSON。"
      + "先跑「探测视觉解析后端」确认模型可用，再确认模型名是 image 能力（如 doubao-seed-2.1-turbo / kimi-k2.6）。",
    );
  }
  const blocks = blocksRaw.map((raw, i) => normalizeBlock(raw, i));
  const relations = (Array.isArray(body?.relations) ? body.relations : []).map((rel, i) => ({
    id: String(rel?.id || `r${i + 1}`),
    from: String(rel?.from ?? ""),
    to: String(rel?.to ?? ""),
    type: String(rel?.type || "arrow"),
    confidence: Number.isFinite(Number(rel?.confidence)) ? Number(rel.confidence) : null,
  })).filter((rel) => rel.from && rel.to);
  const sizeRaw = body?.size || body?.image_size || [0, 0];
  const size = [Number(sizeRaw?.[0]) || 0, Number(sizeRaw?.[1]) || 0];
  const backendChecks = Array.isArray(body?.checks) ? body.checks.map((c) => ({
    name: String(c?.name || "后端检查"),
    ok: Boolean(c?.ok),
    level: ["ok", "warn", "fail"].includes(c?.level) ? c.level : (c?.ok ? "ok" : "fail"),
    detail: String(c?.detail || ""),
  })) : [];
  return {
    backend,
    scene,
    size,
    source: { mime, bytes: bytes.length },
    blocks,
    relations,
    checks: [...localChecks({ blocks, relations, size, scene }), ...backendChecks],
    warnings: Array.isArray(body?.warnings) ? body.warnings.map(String) : [],
    elapsedMs,
  };
}

/**
 * 本地核对项：与具体后端无关，只看「解析结果本身说不说得过去」。
 * 这些是验证台上最值钱的部分——把「静默失败」变成可见的弱。
 */
export function localChecks({ blocks, relations, size, scene }) {
  const checks = [];
  const textBlocks = blocks.filter((b) => b.type === "text" || b.text.trim());
  checks.push({
    name: "检测到区块",
    level: blocks.length ? "ok" : "fail",
    ok: blocks.length > 0,
    detail: `${blocks.length} 个`,
  });
  checks.push({
    name: "有文字内容",
    level: textBlocks.some((b) => b.text.trim()) ? "ok" : "warn",
    ok: textBlocks.some((b) => b.text.trim()),
    detail: `${textBlocks.filter((b) => b.text.trim()).length} / ${blocks.length} 个区块带文字`,
  });
  if (size[0] > 0 && size[1] > 0) {
    const outside = blocks.filter((b) => b.bbox[2] <= 0 || b.bbox[3] <= 0 || b.bbox[0] >= size[0] || b.bbox[1] >= size[1]);
    checks.push({
      name: "坐标在图像内",
      level: outside.length ? "fail" : "ok",
      ok: outside.length === 0,
      detail: outside.length ? `${outside.length} 个区块越界` : `${size[0]}×${size[1]}`,
    });
  } else {
    checks.push({ name: "图像尺寸", level: "warn", ok: false, detail: "后端没有返回 size，无法判断坐标是否越界" });
  }
  const withConf = blocks.filter((b) => Number.isFinite(b.conf));
  if (withConf.length) {
    const low = withConf.filter((b) => b.conf < 0.5).length;
    const ratio = low / withConf.length;
    checks.push({
      name: "置信度分布",
      level: ratio > 0.5 ? "warn" : "ok",
      ok: ratio <= 0.5,
      detail: `低于 0.5 的占 ${(ratio * 100).toFixed(0)}%（${low}/${withConf.length}）`,
    });
  }
  if (SCENES[scene]?.expect?.includes("arrow")) {
    checks.push({
      name: "关系构建",
      level: relations.length ? "ok" : "warn",
      ok: relations.length > 0,
      detail: relations.length ? `${relations.length} 条关系` : "没有配对出箭头关系（架构图场景强烈建议开启）",
    });
  }
  return checks;
}

/* ------------------------------------------------------------------ 后端 */

async function parseZhulong(config, { bytes, mime, scene, signal }) {
  const form = new FormData();
  form.set("scene", scene);
  form.set("weights", config.weights);
  form.set("imgsz", String(config.imgsz));
  form.set("conf", String(config.conf));
  form.set("relations", String(config.relations));
  form.set("ocr", String(config.ocr));
  form.set("file", new Blob([bytes], { type: mime }), `input.${mime.split("/")[1] || "png"}`);
  const res = await ctxRef.net.fetch(`${config.endpoint}/api/parse`, {
    method: "POST",
    body: form,
    signal: signal || AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`解析服务 ${res.status}：${res.text.slice(0, 300)}`);
  try { return JSON.parse(res.text); } catch { throw new Error(`解析服务返回的不是 JSON：${res.text.slice(0, 200)}`); }
}

const VISION_SYSTEM = [
  "你是文档与界面截图的结构化解析器。",
  "只输出一个 JSON 对象，不要 markdown 代码块，不要解释。",
  "JSON 形状：{\"size\":[宽,高],\"blocks\":[{\"id\":\"b1\",\"type\":\"text|box|button|input|table|image|icon|container\",\"bbox\":[x,y,宽,高],\"text\":\"框内文字\",\"conf\":0.0-1.0}],\"relations\":[{\"from\":\"b1\",\"to\":\"b2\",\"type\":\"arrow\"}]}",
  "bbox 用原图像素坐标，左上原点，格式为 [x, y, 宽, 高]；看不清的文字留空字符串，不要编造。",
].join("\n");

function userPrompt(scene) {
  const label = SCENES[scene]?.label || "图片";
  return `解析这张${label}：先给出所有文字/控件/图形区块，再给出区块之间的关系（有箭头才写）。只输出 JSON。`;
}

function extractJson(text) {
  const raw = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON 对象");
  try { return JSON.parse(raw.slice(start, end + 1)); } catch (err) { throw new Error(`模型返回的 JSON 无法解析：${String(err?.message || err)}`); }
}

/**
 * OpenAI 兼容的 chat 地址。不能写死 `${endpoint}/v1/chat/completions`：
 * - OpenAI / 大多数网关：https://host/v1 + /chat/completions
 * - 火山 Ark：https://ark.cn-beijing.volces.com/api/v3 + /chat/completions
 * - Ark plan 网关（coding plan）：https://ark.cn-beijing.volces.com/api/plan/v3 + /chat/completions
 * - 用户直接贴完整 .../chat/completions：原样用
 */
export function chatUrl(endpoint) {
  const base = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("还没有填写服务地址");
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;      // .../v1、.../api/v3、.../api/plan/v3
  return `${base}/v1/chat/completions`;
}

/** 同上的 /models 地址（只用于探测；有的网关不提供，会回落到一次最小 chat 请求） */
export function modelsUrl(endpoint) {
  const chat = chatUrl(endpoint);
  return chat.replace(/\/chat\/completions$/i, "/models");
}

/**
 * 结构化解析不需要长思考：实测 doubao-seed-2.1-turbo 同一张图
 * 思考开 12.8s / 关 3.0s，输出 token 621 → 100。
 * GLM（zai）不接受 thinking.type=disabled（会 400），对它就不发这个字段。
 */
export function thinkingParams(model) {
  const name = String(model || "").toLowerCase();
  if (/^glm|zhipu|z-ai/.test(name)) return null;
  return { type: "disabled" };
}

/** 要不要要求模型走 JSON 模式（GLM 这条网关不保证支持，就不发） */
export function wantsJsonMode(model) {
  const name = String(model || "").toLowerCase();
  return !/^glm|zhipu|z-ai/.test(name);
}

async function parseOpenAI(config, { base64, mime, scene, signal }) {
  if (!config.model) throw new Error("外部 API 后端需要填写模型名");
  const thinking = thinkingParams(config.model);
  const jsonMode = wantsJsonMode(config.model);
  const res = await ctxRef.net.fetch(chatUrl(config.endpoint), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 4096,
      ...(thinking ? { thinking } : {}),
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: VISION_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt(scene) },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
    signal: signal || AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`外部 API ${res.status}：${res.text.slice(0, 300)}`);
  let body;
  try { body = JSON.parse(res.text); } catch { throw new Error(`外部 API 返回的不是 JSON：${res.text.slice(0, 200)}`); }
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part?.text || "").join("") : String(content || "");
  return extractJson(text);
}

async function parseCustom(config, { base64, mime, scene, signal }) {
  const res = await ctxRef.net.fetch(config.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ scene, mime, model: config.model || undefined, image: `data:${mime};base64,${base64}` }),
    signal: signal || AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`自定义服务 ${res.status}：${res.text.slice(0, 300)}`);
  try { return JSON.parse(res.text); } catch { throw new Error(`自定义服务返回的不是 JSON：${res.text.slice(0, 200)}`); }
}

/* ------------------------------------------------------------------ 入口 */

async function probe() {
  const config = await readConfig();
  if (!config.endpoint) return { ok: false, backend: config.backend, detail: "还没有填写服务地址" };
  const timeout = Math.min(config.timeoutMs, 20000);
  const headers = config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
  // 外部 API：/models 常常没有（Ark plan 网关就没有），直接用一次最小 chat 判断「能不能解析」
  if (config.backend === "openai") {
    if (!config.model) return { ok: false, backend: config.backend, detail: "外部 API 需要填写模型名" };
    const url = chatUrl(config.endpoint);
    try {
      const res = await ctxRef.net.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(timeout),
      });
      return {
        ok: res.ok,
        backend: config.backend,
        status: res.status,
        detail: res.ok ? `${url} 可用（模型 ${config.model}）` : `${url} 返回 ${res.status}：${res.text.slice(0, 240)}`,
      };
    } catch (err) {
      return { ok: false, backend: config.backend, detail: `${url} 不可达：${String(err?.message || err)}` };
    }
  }
  const url = config.backend === "zhulong" ? `${config.endpoint}/api/health` : config.endpoint;
  try {
    const res = await ctxRef.net.fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 15000)),
    });
    return {
      ok: res.ok,
      backend: config.backend,
      status: res.status,
      detail: res.ok ? `${url} 可达` : `${url} 返回 ${res.status}：${res.text.slice(0, 200)}`,
    };
  } catch (err) {
    return { ok: false, backend: config.backend, detail: `${url} 不可达：${String(err?.message || err)}` };
  }
}

async function parse(args = {}) {
  const scene = SCENES[String(args.scene || "arch")] ? String(args.scene || "arch") : "arch";
  const { mime, base64, bytes } = splitDataUrl(args.image);
  const config = await readConfig();
  const started = Date.now();
  const controller = new AbortController();
  currentAbort = controller;
  // 超时与用户取消合并成一个 signal：任一触发都中断请求
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs)]);
  const attempt = () => {
    if (controller.signal.aborted) throw new Error("已取消");
    if (config.backend === "zhulong") return parseZhulong(config, { bytes, mime, scene, signal });
    if (config.backend === "openai") return parseOpenAI(config, { base64, mime, scene, signal });
    if (config.backend === "custom") return parseCustom(config, { base64, mime, scene, signal });
    throw new Error(`未知解析后端：${config.backend}`);
  };
  // 大模型偶发吐坏 JSON（一个字符的偏差就整段废）。视觉模型 3s 一次，重试一次比报错划算。
  const tries = config.backend === "openai" ? 2 : 1;
  let body;
  let lastError = null;
  for (let i = 0; i < tries; i += 1) {
    try { body = await attempt(); break; } catch (err) {
      lastError = err;
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (body === undefined) throw lastError || new Error("解析失败");
  if (controller.signal.aborted) throw new Error("已取消");
  const normalized = normalizeResult(body, { backend: config.backend, scene, bytes, mime, elapsedMs: Date.now() - started });
  // 视觉模型给的画布尺寸经常是猜的：按图片真实像素校准 bbox，再算「坐标在图像内」
  return calibrateToImage(normalized, imageSize(bytes, mime));
}


const SCENE_NEXT = {
  arch: "把它重画成 SVG，并检查分层与依赖方向是否与文字描述一致",
  ui: "评估这个界面的层级与可点区域，指出明显的可用性问题",
  pdf: "按版面结构复刻，或抽取要点并标注出处",
  ppt: "还原页面结构，并整理成可复用的提纲",
};

/**
 * 交给 Agent 的说明书：只给结构化事实 + 待看项，不给整包响应。
 * 上限写死（40 个文字区块 / 20 条关系），避免把一份解析结果塞成几千 token。
 */
export function buildBrief(result) {
  if (!result || !Array.isArray(result.blocks)) throw new Error("没有可交给 Agent 的解析结果");
  const sceneLabel = SCENES[result.scene]?.label || result.scene || "图片";
  const [w, h] = result.size || [0, 0];
  const texts = result.blocks.filter((b) => String(b.text || "").trim());
  const others = result.blocks.length - texts.length;
  const pending = (result.checks || []).filter((c) => c.level !== "ok");
  const lines = [];
  lines.push(`【视觉解析】${sceneLabel} · ${w}×${h} · ${result.blocks.length} 区块 / ${(result.relations || []).length} 关系`);
  lines.push(`后端 ${result.backend}${result.elapsedMs ? ` · 用时 ${(result.elapsedMs / 1000).toFixed(1)}s` : ""}`);
  if (pending.length) {
    lines.push("");
    lines.push(`待看（${pending.length}）：`);
    for (const c of pending) lines.push(`- ${c.name}：${c.detail}`);
  }
  if (texts.length) {
    lines.push("");
    lines.push(`文字区块（${texts.length} 条${texts.length > 40 ? "，只列前 40" : ""}）：`);
    for (const b of texts.slice(0, 40)) {
      const [x1, y1, x2, y2] = b.bbox;
      lines.push(`- ${String(b.text).replace(/\s+/g, " ").trim()}  [${b.type}] (${Math.round(x1)},${Math.round(y1)}) ${Math.round(x2 - x1)}×${Math.round(y2 - y1)}${b.conf === null ? "" : ` conf ${b.conf.toFixed(2)}`}`);
    }
  }
  if (others > 0) lines.push(`- 另有 ${others} 个无文字区块（图形/容器），坐标见原始 JSON`);
  if ((result.relations || []).length) {
    lines.push("");
    lines.push(`关系（${result.relations.length} 条${result.relations.length > 20 ? "，只列前 20" : ""}）：`);
    const label = (id) => {
      const hit = result.blocks.find((b) => b.id === id);
      if (!hit) return id;
      return String(hit.text || "").trim() || `${hit.type} ${id}`;
    };
    for (const rel of result.relations.slice(0, 20)) {
      lines.push(`- ${label(rel.from)} → ${label(rel.to)}  ${rel.type}${typeof rel.confidence === "number" ? ` ${rel.confidence.toFixed(2)}` : ""}`);
    }
  }
  lines.push("");
  lines.push(`下一步：${SCENE_NEXT[result.scene] || "基于以上结构继续处理"}。`);
  return lines.join("\n");
}


const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";

/**
 * 结果 → Markdown：给人看、给 Agent 读、给知识库 ingest 都用这一份。
 * 只导事实（区块 / 关系 / 核对），不导原始响应，避免把 llm payload 写进项目。
 */
export function buildMarkdown(result) {
  if (!result || !Array.isArray(result.blocks)) throw new Error("没有可导出的解析结果");
  const sceneLabel = SCENES[result.scene]?.label || result.scene || "图片";
  const [w, h] = result.size || [0, 0];
  const lines = [];
  lines.push(`# 视觉解析 · ${sceneLabel}`);
  lines.push("");
  lines.push(`- 尺寸：${w}×${h}`);
  lines.push(`- 区块：${result.blocks.length} · 关系：${(result.relations || []).length}`);
  lines.push(`- 后端：${result.backend}${result.elapsedMs ? ` · 用时 ${(result.elapsedMs / 1000).toFixed(1)}s` : ""}`);
  const checks = result.checks || [];
  if (checks.length) {
    lines.push("");
    lines.push("## 核对");
    lines.push("");
    lines.push("| 项 | 级别 | 说明 |");
    lines.push("| --- | --- | --- |");
    for (const c of checks) lines.push(`| ${cell(c.name)} | ${cell(c.level)} | ${cell(c.detail)} |`);
  }
  const limit = 400;
  const blocks = result.blocks.slice(0, limit);
  lines.push("");
  lines.push(`## 区块${result.blocks.length > limit ? `（前 ${limit} 条）` : ""}`);
  lines.push("");
  lines.push("| # | 类型 | 文字 | 位置 x,y | 尺寸 w×h | 置信度 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  blocks.forEach((b, i) => {
    const [x1, y1, x2, y2] = b.bbox;
    lines.push(`| ${i + 1} | ${cell(b.type)} | ${cell(b.text)} | ${Math.round(x1)},${Math.round(y1)} | ${Math.round(x2 - x1)}×${Math.round(y2 - y1)} | ${b.conf === null || b.conf === undefined ? "—" : Number(b.conf).toFixed(2)} |`);
  });
  if ((result.relations || []).length) {
    const label = (id) => {
      const hit = result.blocks.find((b) => b.id === id);
      if (!hit) return id;
      return String(hit.text || "").trim() || `${hit.type} ${id}`;
    };
    lines.push("");
    lines.push("## 关系");
    lines.push("");
    lines.push("| 从 | 到 | 类型 | 置信度 |");
    lines.push("| --- | --- | --- | --- |");
    for (const rel of result.relations) {
      lines.push(`| ${cell(label(rel.from))} | ${cell(label(rel.to))} | ${cell(rel.type)} | ${typeof rel.confidence === "number" ? rel.confidence.toFixed(2) : "—"} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function stamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

export async function activate(ctx) {
  ctxRef = ctx;
  ctx.commands.register("zhulong.parse", async (args) => {
    try { return await parse(args); }
    finally { currentAbort = null; }
  });
  ctx.commands.register("zhulong.probe", () => probe());
  ctx.cancel?.register(() => currentAbort?.abort());
  ctx.api.handle("zhulong.scenes", () => SCENES);
  ctx.api.handle("zhulong.brief", ({ result }) => ({ text: buildBrief(result) }));
  ctx.api.handle("zhulong.markdown", ({ result }) => ({ text: buildMarkdown(result) }));
  // 保存到项目：只写 blocks.json + result.md，不写图片（图片是 base64，落盘等于把截图留档）
  ctx.api.handle("zhulong.save", async ({ result }) => {
    const markdown = buildMarkdown(result);
    const dir = `zhulong/${stamp()}-${result.scene || "image"}`;
    const payload = {
      savedAt: new Date().toISOString(),
      scene: result.scene,
      backend: result.backend,
      size: result.size,
      elapsedMs: result.elapsedMs,
      blocks: result.blocks,
      relations: result.relations || [],
      checks: result.checks || [],
      warnings: result.warnings || [],
    };
    await ctx.fs.writeProjectFile(`${dir}/blocks.json`, JSON.stringify(payload, null, 2));
    await ctx.fs.writeProjectFile(`${dir}/result.md`, markdown);
    return { ok: true, dir, files: [`${dir}/blocks.json`, `${dir}/result.md`], chars: markdown.length };
  });
  // 交给 Agent：只往 Chat 输入框塞草稿，不自动发送——发不发由人决定
  ctx.api.handle("zhulong.handoff", async ({ result }) => {
    const text = buildBrief(result);
    await ctx.chat.draft({ text });
    return { ok: true, chars: text.length };
  });
  ctx.log.info("zhulong plugin activated");
}

export function deactivate() {
  ctxRef = null;
}
