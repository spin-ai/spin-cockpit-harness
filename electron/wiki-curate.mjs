/**
 * 「模型整理」的纯函数部分：拼 prompt、解析模型输出、把结果嵌回页面正文。
 *
 * 为什么把这三步单独拿出来：这是唯一会改写用户笔记的地方，必须能不联网就跑测试。
 *   node scripts/wiki-curate-selftest.mjs           # 只用 fixture，不发请求
 *   node scripts/wiki-curate-selftest.mjs --ark     # 额外发一次真实调用，看模型输出能不能解析
 *
 * 约定（和 plugins/notes 的页面结构一致）：
 *   # 标题
 *   > 摘要
 *   ## 要点
 *   - ...
 *   ## 原文摘录
 *   ## 相关
 */

export const CURATE_SYSTEM = `你在整理个人知识库的单个页面。只输出 JSON，不要解释。

格式：{"summary": "...", "bullets": ["...", "..."]}

规则：
1. summary 一句话说清这页讲什么，不超过 60 字，不要以「本文」「该页面」开头。
2. bullets 4–6 条，每条不超过 40 字，必须是页面正文或引用资料里能看到的事实。
3. 不要编造数字、结论、时间；信息不足就少写几条。
4. 不要输出 Markdown 标记，不要重复页面标题。
5. 用页面本身的语言（中文页面用中文）。`;

const head = (text, n) => String(text || "").slice(0, n);

/** 拼一次整理的对话：页面正文 + 已绑定资料片段（都截断，避免把整库塞进去） */
export function curateMessages(page, { maxContent = 6000, maxSource = 2500 } = {}) {
  const sources = (page.citations || [])
    .map((c) => `- ${c.title || c.sourceId}${c.quote ? `：${head(c.quote, 300)}` : ""}`)
    .join("\n");
  const user = [
    `标题：${page.title}`,
    page.summary ? `现有摘要：${head(page.summary, 300)}` : "",
    "",
    "页面正文：",
    head(page.content, maxContent),
    sources ? `\n引用资料：\n${sources}` : "",
  ].filter(Boolean).join("\n");
  return [
    { role: "system", content: CURATE_SYSTEM },
    { role: "user", content: user },
  ];
}

/** 解析模型输出：容忍 ```json 围栏、前后废话、bullets 里混进 markdown */
export function parseCurated(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { summary: "", bullets: [], ok: false };
  let obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { summary: "", bullets: [], ok: false };
  }
  const clean = (v) => String(v || "")
    .replace(/^[-*•\d.\s]+/, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const summary = clean(obj.summary).slice(0, 120);
  const bullets = (Array.isArray(obj.bullets) ? obj.bullets : [])
    .map((b) => clean(typeof b === "string" ? b : b?.text))
    .filter((b) => b.length >= 2)
    .slice(0, 6);
  return { summary, bullets, ok: Boolean(summary || bullets.length) };
}

/**
 * 把模型结果嵌回页面正文：只改「> 摘要」和「## 要点」两处。
 * 原文摘录 / 相关 / 用户自己写的其他小节一律不动。
 */
export function spliceCurated(content, { summary = "", bullets = [] } = {}) {
  const body = String(content || "");
  if (!summary && !bullets.length) return body;

  const lines = body.split("\n");
  // 1) 摘要：替换 H1 之后第一条 `> ` 引用行；没有就插在 H1 后面
  if (summary) {
    const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
    const quote = lines.findIndex((l, i) => /^>\s*/.test(l) && (h1 < 0 || i > h1) && i < (h1 < 0 ? 6 : h1 + 4));
    if (quote >= 0) lines[quote] = `> ${summary}`;
    else if (h1 >= 0) lines.splice(h1 + 1, 0, "", `> ${summary}`);
    else lines.unshift(`> ${summary}`, "");
  }

  // 2) 要点：替换 `## 要点` 小节的列表项，遇到下一个 `## ` 停
  const bulletText = bullets.map((b) => `- ${b}`);
  const startIdx = lines.findIndex((l) => /^##\s+要点\s*$/.test(l.trim()));
  if (startIdx >= 0) {
    let endIdx = lines.findIndex((l, i) => i > startIdx && /^##\s+/.test(l.trim()));
    if (endIdx < 0) endIdx = lines.length;
    const kept = lines.slice(startIdx + 1, endIdx).filter((l) => !/^\s*[-*]\s+/.test(l) && l.trim() !== "");
    lines.splice(startIdx + 1, endIdx - startIdx - 1, "", ...(bulletText.length ? bulletText : ["- 待补充"]), ...(kept.length ? ["", ...kept] : []), "");
  } else if (bulletText.length) {
    const anchor = lines.findIndex((l) => /^##\s+原文摘录\s*$/.test(l.trim()));
    const block = ["## 要点", "", ...bulletText, ""];
    if (anchor >= 0) lines.splice(anchor, 0, ...block);
    else lines.push("", ...block);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 内容指纹：内容没变就不重复花 token */
export function contentHash(text) {
  let h = 5381;
  const s = String(text || "");
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}
