/**
 * OpenAI 兼容模型客户端（大纲 + 单页 SVG 视觉稿）。
 *
 * 不引 SDK：插件跑在 utilityProcess，bare import 在打包后解析不到 app 的 node_modules。
 * 设置页的 endpoint / apiKey / model 与 zhulong 插件同一套写法，默认走火山 Ark。
 */
import { outlineToPromptText } from "./outline.mjs";
import { THEME_NAMES } from "./designer.mjs";

export function chatUrl(endpoint) {
  const base = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/chat/completions`;
}

export function modelsUrl(endpoint) {
  const base = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (/\/chat\/completions$/.test(base)) return base.replace(/\/chat\/completions$/, "/models");
  return `${base}/models`;
}

function extractJson(text) {
  const source = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(source); } catch { /* 继续找花括号 */ }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(source.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

function stripSvg(text) {
  const source = String(text || "");
  const match = /<svg[\s\S]*?<\/svg>/i.exec(source);
  return match ? match[0] : "";
}

const SVG_RULES = `你必须只输出一个 JSON 对象：{"svg": "<完整的 SVG 源码>"}。
SVG 硬性要求：
1. 画布固定 1920×1080，根元素带 width="1920" height="1080" viewBox="0 0 1920 1080"；
2. 只能使用这些元素：rect / circle / ellipse / line / polyline / polygon / path / text / tspan / image / g；
3. 所有文字必须写在 <text> 里（可配 <tspan>），禁止转成 path，禁止 foreignObject；
4. 颜色用 #RRGGBB 或 none；字体用 font-family="Inter, PingFang SC"；
5. 左边距 120px、右边距 120px，页脚 48px 高，禁止内容越界；
6. 不要引用外部 CSS、不要 <style>、不要 <defs><style>、不要 filter / mask / clipPath；
7. 不要整页贴图：可以没有图片，图片只能是局部 <image>；
8. 每页至少 3 个文本块；正文 28–34px，标题 56–72px，日期/页码 18–20px；
9. 只用 4/8/12/16/24/32 的间距节奏；一页只讲一个结论。`;

export function createLlm({ endpoint = "", apiKey = "", model = "", timeoutMs = 120000, fetchImpl = globalThis.fetch } = {}) {
  const url = chatUrl(endpoint);
  const available = Boolean(url && model && typeof fetchImpl === "function");

  async function chat(messages, { json = false, maxTokens = 4096, temperature = 0.4, signal } = {}) {
    if (!available) throw new Error("模型未配置：填写 endpoint 与 model 后再试");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(5000, timeoutMs));
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const body = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      };
      let response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // 有些兼容服务不认 response_format：去掉再试一次，不要因为参数 400 就判模型不可用
      if (!response.ok && json && (response.status === 400 || response.status === 422)) {
        delete body.response_format;
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`模型请求失败 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const text = Array.isArray(content) ? content.map((part) => part?.text || "").join("") : String(content || "");
      if (!text.trim()) throw new Error("模型返回为空");
      return { text, usage: payload?.usage || null };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function outline({ topic = "", markdown = "", pageCount = 12, signal } = {}) {
    const messages = [
      {
        role: "system",
        content: `你是演示文稿架构师。只输出 JSON：{"title":"...","subtitle":"...","theme":"${THEME_NAMES.join("|")}","pages":[{"page_id":"p1","layout_hint":"cover","title":"...","bullets":["..."],"notes":"演讲者备注","visual_instruction":"这一页的视觉意图"}]}。
layout_hint 只能取：cover / agenda / section / bullets / two-column / quote / metrics / timeline / image / closing。
要求：页数 ${pageCount}；每页一个结论；bullets 最多 6 条、每条 ≤ 40 字；notes 写 2–3 句讲稿；visual_instruction 描述版式与图形，不要描述“用一张图表示全部内容”。`,
      },
      {
        role: "user",
        content: `主题：${topic || "未填写"}\n页数：${pageCount}\n${markdown ? `素材（Markdown）：\n${String(markdown).slice(0, 12000)}` : "没有素材，请根据主题搭一份可讲的骨架。"}`,
      },
    ];
    const { text, usage } = await chat(messages, { json: true, maxTokens: 3600, temperature: 0.5, signal });
    const parsed = extractJson(text);
    if (!parsed) throw new Error("大纲不是合法 JSON");
    return { raw: parsed, usage };
  }

  async function pageSvg({ outline: deck, page, index, total, theme, styleHint = "", signal }) {
    const messages = [
      { role: "system", content: `你是资深幻灯片视觉设计师。把一页大纲设计成 1920×1080 的 SVG。${SVG_RULES}` },
      {
        role: "user",
        content: `整份演示：${deck.title}（第 ${index + 1}/${total} 页，主题色系：${theme}）\n本页大纲：${JSON.stringify(page)}\n版式提示：${page.layout_hint}\n${styleHint ? `风格补充：${styleHint}\n` : ""}请直接设计这一页，文字必须来自大纲里的 title / bullets / notes，不要编造新的事实。`,
      },
    ];
    const { text, usage } = await chat(messages, { json: true, maxTokens: 5000, temperature: 0.7, signal });
    const parsed = extractJson(text);
    const svg = parsed?.svg ? String(parsed.svg) : stripSvg(text);
    if (!svg) throw new Error("模型没有返回 SVG");
    return { svg, usage };
  }

  async function probe() {
    if (!url) return { ok: false, error: "未配置 endpoint" };
    if (!model) return { ok: false, error: "未配置 model" };
    const { text } = await chat([{ role: "user", content: "只回复 OK 两个字母" }], { maxTokens: 8, temperature: 0 });
    return { ok: true, url, model, sample: text.slice(0, 40) };
  }

  return { available, url, model, chat, outline, pageSvg, probe };
}

/** 供 UI 预览「大纲会怎么讲」 */
export function outlineDigest(outline) {
  return outlineToPromptText(outline);
}
