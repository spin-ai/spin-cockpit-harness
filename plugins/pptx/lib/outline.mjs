/**
 * 大纲：结构化 JSON + 不依赖模型的确定性生成。
 *
 * 两种来源：
 *  1. LLM（orchestrator 里调用 llm.mjs）→ normalizeOutline 收口；
 *  2. 主题 / Markdown → buildDeterministicOutline：把标题、段落、列表拆成页。
 *
 * 字段是固定的：page_id / layout_hint / title / bullets / notes / visual_instruction。
 */

export const LAYOUTS = ["cover", "agenda", "section", "bullets", "two-column", "quote", "metrics", "timeline", "image", "closing"];

const clamp = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function normalizeOutline(raw, { title = "未命名演示" } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const pages = Array.isArray(source.pages) ? source.pages : Array.isArray(source) ? source : [];
  const seen = new Set();
  const normalized = pages.map((page, index) => {
    const layout = LAYOUTS.includes(String(page?.layout_hint || page?.layout)) ? String(page.layout_hint || page.layout) : "bullets";
    const bullets = Array.isArray(page?.bullets) ? page.bullets : [];
    let pageId = clamp(page?.page_id || `p${index + 1}`, 40) || `p${index + 1}`;
    if (seen.has(pageId)) pageId = `${pageId}-${index + 1}`;
    seen.add(pageId);
    return {
      page_id: pageId,
      layout_hint: layout,
      title: clamp(page?.title, 120) || `第 ${index + 1} 页`,
      subtitle: clamp(page?.subtitle, 160),
      bullets: bullets.map((bullet) => clamp(typeof bullet === "string" ? bullet : bullet?.text, 220)).filter(Boolean).slice(0, 6),
      notes: String(page?.notes || "").slice(0, 2000),
      visual_instruction: clamp(page?.visual_instruction || page?.visual, 400),
      image_href: clamp(page?.image_href || page?.image, 2000),
    };
  });
  if (!normalized.length) throw new Error("大纲至少要有一页");
  return {
    title: clamp(source.title || title, 120),
    subtitle: clamp(source.subtitle || "", 160),
    theme: clamp(source.theme || "", 40),
    pages: normalized,
  };
}

const SECTION_SKELETON = [
  { layout_hint: "cover", title: "{title}", bullets: [], visual_instruction: "封面：主题标题 + 一句副标题，几何留白，右侧一块强调色图形" },
  { layout_hint: "agenda", title: "今天讲什么", bullets: ["背景与机会", "问题与判断", "方案与架构", "落地路径", "指标与验收"], visual_instruction: "目录页，左侧大标题，右侧编号列表" },
  { layout_hint: "bullets", title: "背景与机会", bullets: ["市场与用户正在发生的变化", "现有做法为什么不够", "我们看到的切入点"], visual_instruction: "三到四条要点，右侧放一个抽象的对比示意" },
  { layout_hint: "bullets", title: "问题定义", bullets: ["真正要解决的问题", "当前流程的瓶颈", "不解决会付出的代价"], visual_instruction: "问题清单，一条一个色块编号" },
  { layout_hint: "section", title: "方案", bullets: [], visual_instruction: "章节过渡页，超大字 + 细线" },
  { layout_hint: "two-column", title: "整体架构", bullets: ["入口层：任务与对话", "编排层：计划与并发", "执行层：Agent 与工具", "沉淀层：知识与记忆"], visual_instruction: "左文右图，右侧四层架构块" },
  { layout_hint: "bullets", title: "关键能力", bullets: ["页级并发：单页失败不影响整份", "原生对象：文字形状都可直接改", "质量门禁：越界、溢出、空页检查"], visual_instruction: "三条能力，每条一行说明" },
  { layout_hint: "timeline", title: "落地路径", bullets: ["第 1 阶段：骨架与翻译器", "第 2 阶段：并发与门禁", "第 3 阶段：模板与交付", "第 4 阶段：数据回流"], visual_instruction: "横向时间轴，四个节点" },
  { layout_hint: "metrics", title: "指标与验收", bullets: ["12 页 ≤ 2 分钟：极速模式", "100% 原生对象：可编辑率", "失败页可单页重试", "每次运行留结构化报告"], visual_instruction: "四个指标卡，数字大、说明小" },
  { layout_hint: "bullets", title: "风险与对策", bullets: ["模型不稳定：结构化输出 + 单页重试", "版式跑偏：固定栅格与安全区门禁", "维护成本：翻译器优先于页面类型"], visual_instruction: "风险 / 对策两列对照" },
  { layout_hint: "quote", title: "速度不是砍质量，是把任务拆到能并发的粒度", bullets: ["设计原则 01"], visual_instruction: "大字引言 + 一条强调色竖线" },
  { layout_hint: "closing", title: "下一步", bullets: ["选定一个真实场景跑 12 页", "把报告作为优化依据", "再决定做模板还是做风格"], visual_instruction: "收尾页：一句话 + 行动项" },
];

/** 没有模型时也能出一份结构完整的稿子：标题 + 段落 → 页面 */
export function buildDeterministicOutline({ topic = "", markdown = "", pageCount = 12 } = {}) {
  const title = clamp(topic, 120) || firstHeading(markdown) || "未命名演示";
  const parsed = parseMarkdown(markdown);
  const pages = [];

  if (parsed.sections.length >= 2) {
    pages.push({ layout_hint: "cover", title: parsed.title || title, bullets: [], visual_instruction: "封面" });
    if (parsed.intro.length) {
      pages.push({ layout_hint: "bullets", title: "概览", bullets: parsed.intro.slice(0, 5), visual_instruction: "开场总览" });
    }
    for (const section of parsed.sections) {
      pages.push({ layout_hint: "bullets", title: section.title, bullets: section.bullets.slice(0, 6), visual_instruction: "要点页" });
    }
    pages.push({ layout_hint: "closing", title: "小结", bullets: parsed.sections.slice(0, 4).map((section) => `${section.title}：${section.bullets[0] || "已覆盖"}`), visual_instruction: "收尾" });
  } else {
    const wanted = Math.max(3, Math.min(20, Number(pageCount) || 12));
    const skeleton = SECTION_SKELETON.slice(0, wanted).map((page, index) => {
      const next = { ...page, page_id: `p${index + 1}`, notes: `${page.title}：讲清楚这一页只回答一个问题。` };
      if (index === 0) next.title = title;
      if (index === 1 && parsed.intro.length) next.bullets = parsed.intro.slice(0, 5);
      return next;
    });
    // 骨架不够时用「要点 / 案例 / 数据」补页，不重复同一标题
    while (skeleton.length < wanted) {
      const index = skeleton.length;
      skeleton.splice(skeleton.length - 1, 0, {
        page_id: `p${index + 1}`,
        layout_hint: index % 3 === 0 ? "bullets" : index % 3 === 1 ? "quote" : "two-column",
        title: `补充：${["场景拆解", "数据证据", "对比与取舍", "边界与非目标"][index % 4]}`,
        bullets: ["这一页用于补充上一页的论据", "保持每页一个结论", "需要时替换成真实数据"],
        notes: "占位页：确认大纲时替换成真实内容。",
        visual_instruction: "与前后页保持同一栅格",
      });
    }
    pages.push(...skeleton);
  }

  return normalizeOutline({ title, pages }, { title });
}

function firstHeading(markdown) {
  const match = /^\s*#\s+(.+)$/m.exec(String(markdown || ""));
  return match ? match[1].trim() : "";
}

function parseMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const title = firstHeading(markdown);
  const intro = [];
  const sections = [];
  let current = null;
  let buffer = [];
  const flushParagraph = () => {
    if (!buffer.length) return;
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    buffer = [];
    if (!text) return;
    if (current) current.bullets.push(text.slice(0, 180));
    else if (text.length > 20 && intro.length < 5 && text.length < 180) intro.push(text);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushParagraph(); continue; }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      current = { title: heading[2].trim(), bullets: [] };
      sections.push(current);
      continue;
    }
    const item = /^[-*+]\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const text = item[1].replace(/\*\*/g, "").trim();
      if (current) current.bullets.push(text.slice(0, 180));
      else if (intro.length < 6) intro.push(text.slice(0, 180));
      continue;
    }
    buffer.push(line);
  }
  flushParagraph();
  return { title, intro, sections: sections.filter((section) => section.bullets.length || section.title) };
}

/** 给模型看的大纲摘要：确认后改的是这份 JSON */
export function outlineToPromptText(outline) {
  return outline.pages.map((page, index) => `${index + 1}. [${page.layout_hint}] ${page.title}${page.bullets.length ? ` — ${page.bullets.join(" / ")}` : ""}`).join("\n");
}

export function emptyOutline(title = "未命名演示") {
  return normalizeOutline({ title, pages: [{ layout_hint: "cover", title, bullets: [], visual_instruction: "封面" }] }, { title });
}
