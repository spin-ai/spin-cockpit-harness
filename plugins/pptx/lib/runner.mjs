/**
 * 编排：大纲 → 页级并发（视觉稿 + 翻译 + 门禁）→ 组装 .pptx → 运行报告。
 *
 * 极速 / 精细的差别只在「交互与门禁是否阻断」，不在原生对象标准：
 * 两条路径都走同一个 svg → DrawingML 翻译器。
 */
import { buildDeterministicOutline, normalizeOutline, outlineToPromptText } from "./outline.mjs";
import { renderPageSvg, resolveTheme, THEME_NAMES } from "./designer.mjs";
import { translateSvg } from "./svg/translate.mjs";
import { collectImageHrefs, loadImages } from "./images.mjs";
import { gatePage, applyMode } from "./gates.mjs";
import { runPool } from "./pool.mjs";
import { buildPptx } from "./ooxml/deck.mjs";

export const MODES = {
  quick: { id: "quick", label: "极速", outlineConfirm: false, retries: 1, blockOnError: false },
  precise: { id: "precise", label: "精细", outlineConfirm: true, retries: 2, blockOnError: true },
};

export function normalizeMode(mode) {
  return MODES[String(mode || "").toLowerCase()] || MODES.precise;
}

export async function planOutline({ input = {}, pageCount = 12, llm = null, engine = "auto", signal } = {}) {
  const topic = String(input.topic || "").trim();
  const markdown = String(input.markdown || "").trim();
  const warnings = [];
  const useModel = engine !== "template" && Boolean(llm?.available);

  if (useModel && (topic || markdown)) {
    try {
      const { raw } = await llm.outline({ topic, markdown, pageCount, signal });
      const outline = normalizeOutline(raw, { title: topic || "未命名演示" });
      if (!outline.theme || !THEME_NAMES.includes(outline.theme)) outline.theme = "";
      return { outline, engine: "model", warnings };
    } catch (err) {
      warnings.push(`模型大纲失败，已回落到本地骨架：${String(err?.message || err)}`);
    }
  }
  const outline = buildDeterministicOutline({ topic, markdown, pageCount });
  return { outline, engine: "template", warnings };
}

export function summarizeIssues(issues) {
  const list = issues || [];
  const errors = list.filter((issue) => issue.level === "error").length;
  const warnings = list.filter((issue) => issue.level === "warn").length;
  return {
    level: errors ? "error" : warnings ? "warn" : "ok",
    errors,
    warnings,
    issues: list.map((issue) => ({ level: issue.level, code: issue.code, message: issue.message, downgraded: Boolean(issue.downgraded) })),
  };
}

function summarizeGates(gates) {
  return summarizeIssues(gates.issues || []);
}

async function producePage({ page, index, total, outline, mode, llm, theme, signal, imageLoader, styleHint, allowModel, onProgress }) {
  const started = Date.now();
  const attempts = [];
  const attemptsAllowed = allowModel && llm?.available ? MODES[mode].retries : 0;
  let lastError = null;

  async function translateAndGate(svgText, engine) {
    const hrefs = collectImageHrefs(svgText);
    const loaded = hrefs.length ? await loadImages(hrefs, imageLoader) : { assets: new Map(), warnings: [] };
    onProgress?.({ type: "page", page_id: page.page_id, index, state: "translating", engine, total });
    const translated = translateSvg(svgText, { resolveImage: (href) => loaded.assets.get(href) || null });
    const gates = gatePage({ outline: page, svgText, translated, pageIndex: index });
    if (loaded.warnings.length) {
      for (const warning of loaded.warnings) gates.issues.push({ level: "warn", code: "IMAGE", message: warning });
      gates.warnings += loaded.warnings.length;
    }
    return { svg: svgText, translated, gates };
  }

  for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
    const attemptStarted = Date.now();
    try {
      onProgress?.({ type: "page", page_id: page.page_id, index, state: "generating", engine: "model", attempt, total });
      const { svg } = await llm.pageSvg({ outline, page, index, total, theme, styleHint, signal });
      const produced = await translateAndGate(svg, "model");
      attempts.push({ engine: "model", attempt, ms: Date.now() - attemptStarted, issues: produced.gates.issues.length, errors: produced.gates.errors });
      if (!produced.gates.errors || mode === "quick") {
        return { ...produced, engine: "model", attempts, ms: Date.now() - started, index };
      }
      lastError = new Error(`模型稿门禁未通过：${produced.gates.issues.filter((i) => i.level === "error").map((i) => i.message).join("；")}`);
    } catch (err) {
      lastError = err;
      attempts.push({ engine: "model", attempt, ms: Date.now() - attemptStarted, error: String(err?.message || err) });
    }
  }

  // 模板兜底：与模型稿同一个翻译器和门禁，差距只在「谁决定版式」
  const attemptStarted = Date.now();
  const svg = renderPageSvg(page, { theme, index, total, deckTitle: outline.title });
  let produced;
  try {
    produced = await translateAndGate(svg, "template");
  } catch (err) {
    return {
      ok: false,
      page_id: page.page_id,
      index,
      title: page.title,
      engine: "template",
      error: String(err?.message || err),
      attempts,
      ms: Date.now() - started,
    };
  }
  attempts.push({ engine: "template", attempt: 1, ms: Date.now() - attemptStarted, issues: produced.gates.issues.length, errors: produced.gates.errors });
  return { ...produced, engine: "template", attempts, ms: Date.now() - started, index, lastError: lastError ? String(lastError?.message || lastError) : "" };
}

/**
 * @returns {Promise<{slides: object[], pages: object[], report: object, svgs: string[], warnings: string[]}>}
 */
export async function generateDeck({
  outline,
  mode = "precise",
  concurrency = 5,
  theme = "",
  engine = "auto",
  llm = null,
  signal,
  onProgress,
  imageLoader = {},
  styleHint = "",
  runId = "",
} = {}) {
  const settings = normalizeMode(mode);
  const resolvedTheme = resolveTheme(theme || outline.theme || "paper");
  const themeName = THEME_NAMES.find((name) => resolveTheme(name) === resolvedTheme) || "paper";
  const total = outline.pages.length;
  const allowModel = engine !== "template" && Boolean(llm?.available);
  const globalWarnings = [];
  if (engine === "model" && !llm?.available) globalWarnings.push("选择了模型版式，但模型未配置：已用本地版式生成");
  const startedAt = new Date();
  const started = Date.now();

  onProgress?.({ type: "phase", phase: "pages", state: "start", total, concurrency });

  const { results, peak } = await runPool(outline.pages, (page, index) => producePage({
    page, index, total, outline, mode: settings.id, llm, theme: resolvedTheme, signal, imageLoader, styleHint, allowModel, onProgress,
  }), {
    concurrency,
    signal,
    onStart: (page, index) => onProgress?.({ type: "page", page_id: page.page_id, index, state: "queued", total }),
    onSettle: (page, result, index) => {
      const value = result.ok ? result.value : null;
      const gates = value?.gates ? summarizeGates(applyMode(value.gates.issues, settings.id)) : null;
      onProgress?.({
        type: "page",
        page_id: page.page_id,
        index,
        state: result.ok ? (gates?.errors ? "failed" : "done") : result.canceled ? "canceled" : "failed",
        engine: value?.engine || "template",
        ms: value?.ms || 0,
        gates,
        attempts: value?.attempts || [],
        total,
      });
    },
  });

  const pages = [];
  const rendered = [];
  results.forEach((result, index) => {
    const page = outline.pages[index];
    if (result.ok) {
      const value = result.value;
      const issues = applyMode(value.gates.issues, settings.id);
      const gates = summarizeGates({ ...value.gates, issues });
      const blocked = Boolean(gates.errors && settings.blockOnError);
      const slide = { shapes: value.translated.shapes, media: value.translated.media, notes: page.notes || "" };
      rendered.push({ page_id: page.page_id, index, slide: blocked ? null : slide });
      pages.push({
        page_id: page.page_id,
        index,
        title: page.title,
        layout_hint: page.layout_hint,
        state: blocked ? "failed" : "done",
        engine: value.engine,
        ms: value.ms,
        attempts: value.attempts,
        gates,
        objects: value.translated.shapes.length,
        texts: value.translated.stats.texts,
        images: value.translated.stats.images,
        note: String(page.notes || ""),
        lastError: value.lastError || "",
        svg: value.svg,
      });
      if (value.lastError) globalWarnings.push(`${page.title}：${value.lastError}`);
    } else {
      rendered.push({ page_id: page.page_id, index, slide: null });
      pages.push({
        page_id: page.page_id,
        index,
        title: page.title,
        state: result.canceled ? "canceled" : "failed",
        engine: "template",
        ms: 0,
        attempts: [],
        gates: { level: "error", errors: 1, warnings: 0, issues: [{ level: "error", code: "PAGE_FAILED", message: result.error || "生成失败" }] },
        objects: 0,
        texts: 0,
        images: 0,
        note: String(page.notes || ""),
      });
    }
  });

  const committed = rendered.filter((entry) => entry.slide);
  const slides = committed.map((entry) => entry.slide);
  const svgs = committed.map((entry) => pages.find((page) => page.page_id === entry.page_id)?.svg || "");
  const failedPages = pages.filter((page) => page.state === "failed").map((page) => page.page_id);
  if (!slides.length) throw new Error("所有页面都失败了，没有可交付的文件");

  const buffer = buildPptx({ slides, title: outline.title, background: resolvedTheme.bg });
  const durationMs = Date.now() - started;
  const report = {
    runId,
    mode: settings.id,
    theme: themeName,
    engine: engine === "template" ? "template" : allowModel ? "model+template" : "template",
    model: allowModel ? llm?.model || "" : "",
    concurrency,
    peakConcurrency: peak,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    pages,
    failedPages,
    warnings: globalWarnings,
    totals: {
      slides: slides.length,
      objects: pages.reduce((sum, page) => sum + page.objects, 0),
      texts: pages.reduce((sum, page) => sum + page.texts, 0),
      images: pages.reduce((sum, page) => sum + page.images, 0),
      notes: slides.filter((slide) => String(slide.notes || "").trim()).length,
      gateErrors: pages.reduce((sum, page) => sum + (page.gates?.errors || 0), 0),
      gateWarnings: pages.reduce((sum, page) => sum + (page.gates?.warnings || 0), 0),
    },
    outlineDigest: outlineToPromptText(outline),
  };

  onProgress?.({ type: "done", report, total });
  return { buffer, slides, pages, report, svgs, rendered, warnings: globalWarnings };
}

/** 单页重试 / 局部重排之后重新装包（report 由调用方合并） */
export function repackage({ outline, rendered, theme = "" }) {
  const resolvedTheme = resolveTheme(theme || outline.theme || "paper");
  const slides = rendered.filter((entry) => entry.slide).map((entry) => entry.slide);
  if (!slides.length) throw new Error("没有可写入的页面");
  return buildPptx({ slides, title: outline.title, background: resolvedTheme.bg });
}

export { producePage };

/** 一步到底：CLI 与「快捷生成」用；精确模式仍然先返回 awaiting_outline */
export async function runDeck({
  input = {}, outline: provided = null, mode = "precise", concurrency = 5, theme = "", engine = "auto",
  pageCount = 12, llm = null, signal, onProgress, imageLoader = {}, styleHint = "", runId = "", writeFile,
} = {}) {
  const warnings = [];
  let outline = provided;
  if (!outline) {
    const planned = await planOutline({ input, pageCount, llm, engine, signal });
    outline = planned.outline;
    warnings.push(...planned.warnings);
  }
  if (!theme && outline.theme) theme = outline.theme;
  const result = await generateDeck({ outline, mode, concurrency, theme, engine, llm, signal, onProgress, imageLoader, styleHint, runId });
  if (writeFile) await writeFile({ buffer: result.buffer, report: result.report, svgs: result.svgs, outline });
  return { ...result, outline, warnings: [...warnings, ...result.warnings] };
}
