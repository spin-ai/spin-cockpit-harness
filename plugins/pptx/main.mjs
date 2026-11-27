/**
 * 演示文稿插件（utilityProcess 内运行）。
 *
 * 职责边界：
 *  - 这里只做「会话态」：run 注册表、配置读取、进度推送、落盘；
 *  - 版式 / 翻译 / 并发 / 门禁全部在 lib/ 里，纯函数、可单独测试（tests/pptx.test.mjs）；
 *  - 每次运行都留结构化报告（每页耗时、并发峰值、失败页、门禁结果）。
 *
 * 与 REQ-pptx-plugin 的差异：宿主是 Electron + Node，所以 ARQ/Redis/SSE 换成
 * 进程内并发池 + run 状态查询 + `ui.post` 推送；页级并发、原生对象、翻译器优先级不变。
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { planOutline, generateDeck, normalizeMode, repackage, producePage, summarizeIssues } from "./lib/runner.mjs";
import { normalizeOutline } from "./lib/outline.mjs";
import { applyMode } from "./lib/gates.mjs";
import { createLlm } from "./lib/llm.mjs";
import { resolveTheme, THEMES, THEME_NAMES } from "./lib/designer.mjs";

const MAX_RUNS = 12;
const runs = new Map();
let ctxRef = null;

const slug = (value, fallback = "deck") => {
  const text = String(value || "").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return text || fallback;
};

const stamp = () => {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
};

function emit(event, payload) {
  try { ctxRef?.ui?.post(event, payload)?.catch?.(() => {}); } catch { /* 旧宿主没有 ui.post */ }
}

async function setting(key, fallback) {
  try {
    const value = await ctxRef.settings.get(key);
    if (value === null || value === undefined || value === "") return fallback;
    return value;
  } catch { return fallback; }
}

async function readConfig() {
  return {
    mode: String(await setting("mode", "precise")),
    engine: String(await setting("engine", "auto")),
    endpoint: String(await setting("endpoint", "")),
    apiKey: String(await setting("apiKey", "")),
    model: String(await setting("model", "")),
    concurrency: Math.max(1, Math.min(12, Number(await setting("concurrency", 5)) || 5)),
    theme: String(await setting("theme", "paper")),
    pageCount: Math.max(3, Math.min(20, Number(await setting("pageCount", 12)) || 12)),
    timeoutMs: Math.max(10000, Number(await setting("timeoutMs", 120000)) || 120000),
    styleHint: String(await setting("styleHint", "")),
  };
}

function makeLlm(config) {
  return createLlm({ endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs });
}

function makeImageLoader() {
  const hasNet = (ctxRef?.manifest?.permissions || []).includes("net");
  return {
    fetchBuffer: async (url) => {
      if (!hasNet) throw new Error("permission denied: net");
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { data: Buffer.from(await res.arrayBuffer()), mime: String(res.headers.get("content-type") || "application/octet-stream") };
    },
    readFile: async (href) => {
      let target = String(href);
      if (!path.isAbsolute(target)) {
        const root = await ctxRef.fs.projectRoot().catch(() => "");
        if (!root) throw new Error("没有项目目录，无法读取相对路径图片");
        target = path.resolve(root, target);
        if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("图片路径越出项目目录");
      }
      return fs.readFile(target);
    },
  };
}

function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
}

function snapshot(run) {
  const pages = (run.outline?.pages || []).map((page, index) => {
    const live = run.pages.get(page.page_id) || {};
    const reported = run.report?.pages?.find((item) => item.page_id === page.page_id) || {};
    return {
      page_id: page.page_id,
      title: page.title,
      layout_hint: page.layout_hint,
      index,
      notes: page.notes || "",
      bullets: page.bullets || [],
      state: live.state || reported.state || "queued",
      engine: live.engine || reported.engine || "",
      ms: live.ms ?? reported.ms ?? 0,
      gates: live.gates || reported.gates || null,
      attempts: live.attempts || reported.attempts || [],
      objects: reported.objects || 0,
      texts: reported.texts || 0,
      svg: reported.svg ? sanitizeSvg(reported.svg) : "",
    };
  });
  return {
    runId: run.id,
    status: run.status,
    mode: run.mode,
    engine: run.engine,
    theme: run.theme,
    concurrency: run.concurrency,
    createdAt: run.createdAt,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
    error: run.error || "",
    warnings: run.warnings || [],
    outline: run.outline,
    pages,
    report: run.report || null,
    output: run.output || null,
    url: run.llmUrl || "",
    model: run.model || "",
  };
}

function pruneRuns() {
  if (runs.size <= MAX_RUNS) return;
  const sorted = [...runs.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const run of sorted.slice(0, runs.size - MAX_RUNS)) {
    if (["running", "planning"].includes(run.status)) continue;
    runs.delete(run.id);
  }
}

function refreshReport(run) {
  if (!run.report) return;
  run.report.pages = (run.outline.pages || []).map((page) => run.pages.get(page.page_id) || { page_id: page.page_id, title: page.title, state: "queued" });
  const failed = run.report.pages.filter((page) => page.state === "failed").map((page) => page.page_id);
  run.report.failedPages = failed;
  run.report.totals = {
    slides: run.report.pages.filter((page) => page.state !== "failed").length,
    objects: run.report.pages.reduce((sum, page) => sum + (page.objects || 0), 0),
    texts: run.report.pages.reduce((sum, page) => sum + (page.texts || 0), 0),
    images: run.report.pages.reduce((sum, page) => sum + (page.images || 0), 0),
    notes: run.report.pages.filter((page) => String(page.note || "").trim()).length,
    gateErrors: run.report.pages.reduce((sum, page) => sum + (page.gates?.errors || 0), 0),
    gateWarnings: run.report.pages.reduce((sum, page) => sum + (page.gates?.warnings || 0), 0),
  };
  run.report.finishedAt = new Date().toISOString();
}

/** 写到项目 pptx/<时间>-<标题>/；没有项目目录时落到插件 data/runs/ */
async function persist(run) {
  const base = `${stamp()}-${slug(run.outline.title)}`;
  const root = await ctxRef.fs.projectRoot().catch(() => "");
  const svgFiles = run.report?.pages || [];
  const reportJson = JSON.stringify(run.report, null, 2);
  const outlineJson = JSON.stringify(run.outline, null, 2);

  if (root) {
    const dir = `pptx/${base}`;
    await ctxRef.fs.writeProjectFile(`${dir}/outline.json`, outlineJson);
    await ctxRef.fs.writeProjectBinary(`${dir}/deck.pptx`, run.buffer.toString("base64"));
    await ctxRef.fs.writeProjectFile(`${dir}/deck.report.json`, reportJson);
    for (let index = 0; index < run.svgs.length; index += 1) {
      await ctxRef.fs.writeProjectFile(`${dir}/slides/${String(index + 1).padStart(2, "0")}.svg`, run.svgs[index]);
    }
    return {
      dir,
      file: `${dir}/deck.pptx`,
      report: `${dir}/deck.report.json`,
      outline: `${dir}/outline.json`,
      slides: `${dir}/slides`,
      absolute: path.join(root, dir, "deck.pptx"),
      absoluteDir: path.join(root, dir),
      bytes: run.buffer.length,
      tracked: svgFiles.length,
    };
  }

  const dir = path.join(ctxRef.dataDir, "runs", base);
  await fs.mkdir(path.join(dir, "slides"), { recursive: true });
  await fs.writeFile(path.join(dir, "outline.json"), outlineJson, "utf8");
  await fs.writeFile(path.join(dir, "deck.pptx"), run.buffer);
  await fs.writeFile(path.join(dir, "deck.report.json"), reportJson, "utf8");
  for (let index = 0; index < run.svgs.length; index += 1) {
    await fs.writeFile(path.join(dir, "slides", `${String(index + 1).padStart(2, "0")}.svg`), run.svgs[index], "utf8");
  }
  return {
    dir,
    file: path.join(dir, "deck.pptx"),
    report: path.join(dir, "deck.report.json"),
    outline: path.join(dir, "outline.json"),
    slides: path.join(dir, "slides"),
    absolute: path.join(dir, "deck.pptx"),
    absoluteDir: dir,
    bytes: run.buffer.length,
    tracked: svgFiles.length,
  };
}

async function execute(run) {
  run.status = "running";
  run.startedAt = new Date().toISOString();
  emit("pptx.progress", { runId: run.id, type: "run", state: "running", mode: run.mode, total: run.outline.pages.length });
  try {
    const result = await generateDeck({
      outline: run.outline,
      mode: run.mode,
      concurrency: run.concurrency,
      theme: run.theme,
      engine: run.engine,
      llm: run.llm,
      signal: run.controller.signal,
      imageLoader: run.imageLoader,
      styleHint: run.styleHint,
      runId: run.id,
      onProgress: (event) => {
        if (event.type === "page" && event.page_id) {
          const previous = run.pages.get(event.page_id) || {};
          run.pages.set(event.page_id, { ...previous, ...event });
        }
        emit("pptx.progress", { runId: run.id, ...event });
      },
    });
    run.buffer = result.buffer;
    run.svgs = result.svgs;
    run.rendered = result.rendered;
    run.report = result.report;
    run.warnings = [...(run.warnings || []), ...result.warnings];
    for (const page of result.pages) run.pages.set(page.page_id, { ...(run.pages.get(page.page_id) || {}), ...page });
    run.output = await persist(run);
    run.status = result.report.failedPages.length ? "done_with_errors" : "done";
    run.finishedAt = new Date().toISOString();
    emit("pptx.progress", { runId: run.id, type: "run", state: run.status, report: { durationMs: run.report.durationMs, peakConcurrency: run.report.peakConcurrency, totals: run.report.totals, failedPages: run.report.failedPages } });
    ctxRef.notify?.(`演示文稿已生成：${run.outline.title}（${run.report.totals.slides} 页 · ${(run.report.durationMs / 1000).toFixed(1)}s）`, { level: run.report.failedPages.length ? "warn" : "info" });
  } catch (err) {
    run.status = run.controller.signal.aborted ? "canceled" : "failed";
    run.error = String(err?.message || err);
    run.finishedAt = new Date().toISOString();
    emit("pptx.progress", { runId: run.id, type: "run", state: run.status, error: run.error });
    ctxRef.log?.error?.(`pptx run ${run.id} failed: ${run.error}`);
  }
}

async function startRun(args = {}, { forceMode = "" } = {}) {
  const config = await readConfig();
  const mode = normalizeMode(forceMode || args.mode || config.mode);
  const engine = String(args.engine || config.engine);
  const pageCount = Math.max(3, Math.min(20, Number(args.pageCount || config.pageCount) || 12));
  const theme = THEME_NAMES.includes(String(args.theme || config.theme)) ? String(args.theme || config.theme) : "paper";
  const concurrency = Math.max(1, Math.min(12, Number(args.concurrency || config.concurrency) || 5));
  const llm = makeLlm(config);
  const run = {
    id: `pptx-${crypto.randomUUID().slice(0, 8)}`,
    status: "planning",
    mode: mode.id,
    engine,
    theme,
    concurrency,
    createdAt: Date.now(),
    controller: new AbortController(),
    pages: new Map(),
    warnings: [],
    llm,
    llmUrl: config.endpoint,
    model: llm.available ? config.model : "",
    imageLoader: makeImageLoader(),
    styleHint: String(args.styleHint || config.styleHint || ""),
    outline: null,
    report: null,
    output: null,
  };
  runs.set(run.id, run);
  pruneRuns();
  emit("pptx.progress", { runId: run.id, type: "run", state: "planning", mode: run.mode });

  try {
    const planned = await planOutline({
      input: { topic: args.topic || "", markdown: args.markdown || "" },
      pageCount,
      llm,
      engine,
      signal: run.controller.signal,
    });
    run.outline = planned.outline;
    run.warnings.push(...planned.warnings);
    if (!run.outline.theme) run.outline.theme = theme;
    run.status = mode.outlineConfirm ? "awaiting_outline" : "running";
    emit("pptx.progress", { runId: run.id, type: "run", state: run.status, outline: run.outline, warnings: run.warnings });
    if (!mode.outlineConfirm) void execute(run);
    return snapshot(run);
  } catch (err) {
    run.status = "failed";
    run.error = String(err?.message || err);
    run.finishedAt = new Date().toISOString();
    return snapshot(run);
  }
}

async function confirmRun({ runId, outline } = {}) {
  const run = runs.get(String(runId));
  if (!run) throw new Error("运行不存在或已过期");
  if (!["awaiting_outline", "planning"].includes(run.status)) throw new Error(`当前状态不能确认：${run.status}`);
  if (outline) run.outline = normalizeOutline(outline, { title: run.outline?.title || "未命名演示" });
  if (!run.outline) throw new Error("还没有大纲");
  void execute(run);
  return snapshot(run);
}

async function retryPage({ runId, pageId } = {}) {
  const run = runs.get(String(runId));
  if (!run) throw new Error("运行不存在或已过期");
  if (run.status === "running" || run.status === "planning") throw new Error("正在生成中，等这一轮结束再重试单页");
  const index = run.outline?.pages?.findIndex((page) => page.page_id === pageId) ?? -1;
  if (index < 0) throw new Error(`找不到页面：${pageId}`);
  const page = run.outline.pages[index];
  const previous = run.pages.get(pageId) || {};
  run.pages.set(pageId, { ...previous, state: "generating", gates: null });
  emit("pptx.progress", { runId: run.id, type: "page", page_id: pageId, index, state: "generating", total: run.outline.pages.length });
  const value = await producePage({
    page, index, total: run.outline.pages.length, outline: run.outline, mode: run.mode,
    llm: run.llm, theme: resolveTheme(run.theme), signal: run.controller.signal,
    imageLoader: run.imageLoader, styleHint: run.styleHint, allowModel: run.engine !== "template",
    onProgress: (event) => emit("pptx.progress", { runId: run.id, ...event }),
  });
  if (!value.ok) {
    run.pages.set(pageId, { ...previous, state: "failed", gates: { level: "error", errors: 1, warnings: 0, issues: [{ level: "error", code: "RETRY_FAILED", message: value.error || "重试失败" }] } });
    emit("pptx.progress", { runId: run.id, type: "page", page_id: pageId, index, state: "failed", total: run.outline.pages.length });
    throw new Error(value.error || "重试失败");
  }
  const issues = applyMode(value.gates.issues, run.mode);
  const gates = summarizeIssues(issues);
  const slide = { shapes: value.translated.shapes, media: value.translated.media, notes: page.notes || "" };
  const blocked = Boolean(gates.errors) && run.mode === "precise";
  run.rendered[index] = { page_id: pageId, index, slide: blocked ? null : slide };
  run.report.pages[index] = {
    page_id: pageId,
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
  };
  run.pages.set(pageId, { ...run.report.pages[index] });
  run.buffer = repackage({ outline: run.outline, rendered: run.rendered, theme: run.theme });
  run.svgs = run.rendered.filter((entry) => entry.slide).map((entry) => run.report.pages.find((item) => item.page_id === entry.page_id)?.svg || "");
  refreshReport(run);
  run.output = await persist(run);
  run.status = run.report.failedPages.length ? "done_with_errors" : "done";
  emit("pptx.progress", { runId: run.id, type: "page", page_id: pageId, index, state: blocked ? "failed" : "done", gates, total: run.outline.pages.length });
  return snapshot(run);
}

export async function activate(ctx) {
  ctxRef = ctx;
  ctx.cancel?.register(() => {
    for (const run of runs.values()) {
      if (run.status === "running" || run.status === "planning") {
        run.controller.abort();
        run.status = "canceled";
        run.finishedAt = new Date().toISOString();
        emit("pptx.progress", { runId: run.id, type: "run", state: "canceled" });
      }
    }
  });

  ctx.commands.register("pptx.plan", (args) => startRun(args || {}, { forceMode: "precise" }));
  ctx.commands.register("pptx.quick", (args) => startRun(args || {}, { forceMode: "quick" }));
  ctx.commands.register("pptx.probe", async () => {
    const config = await readConfig();
    const llm = makeLlm(config);
    if (!llm.available) return { ok: false, error: "未配置 endpoint / model（设置 → 插件 → 演示文稿）" };
    try { return await llm.probe(); } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  ctx.api.handle("pptx.config", async () => {
    const config = await readConfig();
    return {
      defaults: {
        mode: normalizeMode(config.mode).id,
        engine: config.engine,
        concurrency: config.concurrency,
        theme: config.theme,
        pageCount: config.pageCount,
      },
      model: { configured: Boolean(config.endpoint && config.model), url: config.endpoint, model: config.model },
      themes: THEME_NAMES.map((name) => ({ value: name, label: THEMES[name].label })),
      modes: [
        { value: "precise", label: "精细", desc: "先确认大纲，逐页门禁阻断" },
        { value: "quick", label: "极速", desc: "跳过大纲确认，门禁只记 warning" },
      ],
    };
  });
  ctx.api.handle("pptx.start", (args) => startRun(args || {}));
  ctx.api.handle("pptx.confirm", (args) => confirmRun(args || {}));
  ctx.api.handle("pptx.status", ({ runId } = {}) => {
    const run = runs.get(String(runId));
    if (!run) throw new Error("运行不存在或已过期");
    return snapshot(run);
  });
  ctx.api.handle("pptx.runs", () => [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).map((run) => ({
    runId: run.id, status: run.status, title: run.outline?.title || "未命名", mode: run.mode,
    createdAt: run.createdAt, durationMs: run.report?.durationMs || 0, pages: run.outline?.pages?.length || 0,
    file: run.output?.file || "",
  })));
  ctx.api.handle("pptx.cancel", ({ runId } = {}) => {
    const run = runs.get(String(runId));
    if (!run) throw new Error("运行不存在或已过期");
    if (!["running", "planning", "awaiting_outline"].includes(run.status)) return snapshot(run);
    run.controller.abort();
    run.status = "canceled";
    run.finishedAt = new Date().toISOString();
    emit("pptx.progress", { runId: run.id, type: "run", state: "canceled" });
    return snapshot(run);
  });
  ctx.api.handle("pptx.retryPage", (args) => retryPage(args || {}));
  ctx.api.handle("pptx.reveal", async ({ runId } = {}) => {
    const run = runs.get(String(runId));
    if (!run?.output) throw new Error("还没有可打开的输出");
    await ctx.fs.reveal(run.output.absoluteDir);
    return true;
  });
  ctx.api.handle("pptx.probe", async () => {
    const config = await readConfig();
    const llm = makeLlm(config);
    if (!llm.available) return { ok: false, error: "未配置 endpoint / model" };
    try { return await llm.probe(); } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  ctx.log.info("pptx plugin activated");
}

export function deactivate() {
  for (const run of runs.values()) {
    try { run.controller.abort(); } catch { /* ignore */ }
  }
  ctxRef = null;
}
