#!/usr/bin/env node
/**
 * 无 Electron 的命令行入口：给定大纲 JSON 或主题 / Markdown，直接落一个原生 .pptx。
 *
 * 用法：
 *   node plugins/pptx/cli.mjs --topic "季度复盘" --pages 12 --mode quick --out deck.pptx
 *   node plugins/pptx/cli.mjs --outline outline.json --out deck.pptx --concurrency 5
 *   node plugins/pptx/cli.mjs --markdown notes.md --endpoint https://ark.../api/v3 --model doubao-... --api-key $KEY
 *
 * 进度按行输出（等价于 SSE）：`--json` 时 stdout 是 JSONL，最终一行是 `type:"result"`。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { planOutline, generateDeck } from "./lib/runner.mjs";
import { normalizeOutline } from "./lib/outline.mjs";
import { createLlm } from "./lib/llm.mjs";
import { THEME_NAMES } from "./lib/designer.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "json" || key === "help") { args[key] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`用法: node plugins/pptx/cli.mjs [选项]

  --topic <文字>          主题
  --markdown <文件>       素材 Markdown 文件
  --markdown-text <文字>  素材 Markdown 文本
  --outline <文件>        直接使用现成大纲 JSON（跳过生成）
  --pages <数字>          页数（默认 12）
  --mode <quick|precise>  极速 / 精细（默认 quick）
  --concurrency <数字>    页级并发（默认 5）
  --theme <${THEME_NAMES.join("|")}>
  --engine <auto|model|template>
  --endpoint <URL>        OpenAI 兼容根地址（或 PPTX_ENDPOINT）
  --model <id>            模型名（或 PPTX_MODEL）
  --api-key <key>         API Key（或 PPTX_API_KEY）
  --style <文字>          风格补充
  --out <文件>            输出 .pptx（默认 deck.pptx）
  --svg-dir <目录>        额外导出每页 SVG 视觉稿
  --json                  stdout 只输出 JSONL`);
  process.exit(0);
}

const log = (event) => {
  if (args.json) { process.stdout.write(`${JSON.stringify(event)}\n`); return; }
  if (event.type === "phase") process.stderr.write(`· 阶段 ${event.phase}（${event.total || 0} 页，并发 ${event.concurrency || "-"}）\n`);
  else if (event.type === "page") process.stderr.write(`  ${String((event.index ?? 0) + 1).padStart(2, "0")} ${String(event.state).padEnd(11)} ${event.engine || ""} ${event.ms ? `${event.ms}ms` : ""}${event.gates ? ` · ${event.gates.errors} error / ${event.gates.warnings} warn` : ""}\n`);
  else if (event.type === "outline") process.stderr.write(`· 大纲：${event.pages} 页（${event.engine}）\n`);
};

const outPath = path.resolve(String(args.out || "deck.pptx"));
const endpoint = String(args.endpoint || process.env.PPTX_ENDPOINT || "");
const model = String(args.model || process.env.PPTX_MODEL || "");
const apiKey = String(args["api-key"] || process.env.PPTX_API_KEY || "");
const engine = String(args.engine || (endpoint && model ? "auto" : "template"));
const mode = String(args.mode || "quick");
const concurrency = Math.max(1, Math.min(16, Number(args.concurrency || 5)));
const pageCount = Math.max(3, Math.min(20, Number(args.pages || 12)));
const theme = THEME_NAMES.includes(String(args.theme || "")) ? String(args.theme) : "paper";
const styleHint = String(args.style || "");

const markdown = args.markdown
  ? await fs.readFile(path.resolve(String(args.markdown)), "utf8")
  : String(args["markdown-text"] || "");

const llm = createLlm({ endpoint, apiKey, model, timeoutMs: 120000 });

const loaders = {
  fetchBuffer: async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: String(res.headers.get("content-type") || "") };
  },
  readFile: (href) => fs.readFile(path.resolve(String(href))),
};

let outline;
if (args.outline) {
  const raw = JSON.parse(await fs.readFile(path.resolve(String(args.outline)), "utf8"));
  outline = normalizeOutline(raw);
  log({ type: "outline", pages: outline.pages.length, engine: "file" });
} else {
  const planned = await planOutline({ input: { topic: String(args.topic || ""), markdown }, pageCount, llm, engine });
  outline = planned.outline;
  log({ type: "outline", pages: outline.pages.length, engine: planned.engine });
}

const started = Date.now();
const result = await generateDeck({
  outline,
  mode,
  concurrency,
  theme,
  engine,
  llm,
  imageLoader: loaders,
  styleHint,
  runId: `cli-${started}`,
  onProgress: log,
});

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, result.buffer);
const reportPath = outPath.replace(/\.pptx$/i, "") + ".report.json";
await fs.writeFile(reportPath, JSON.stringify(result.report, null, 2), "utf8");
let svgDir = "";
if (args["svg-dir"]) {
  svgDir = path.resolve(String(args["svg-dir"]));
  await fs.mkdir(svgDir, { recursive: true });
  for (let index = 0; index < result.svgs.length; index += 1) {
    await fs.writeFile(path.join(svgDir, `${String(index + 1).padStart(2, "0")}.svg`), result.svgs[index], "utf8");
  }
}

const summary = {
  type: "result",
  file: outPath,
  report: reportPath,
  svgDir,
  bytes: result.buffer.length,
  durationMs: result.report.durationMs,
  peakConcurrency: result.report.peakConcurrency,
  failedPages: result.report.failedPages,
  totals: result.report.totals,
  pages: result.report.pages.map((page) => ({ page_id: page.page_id, state: page.state, engine: page.engine, ms: page.ms, objects: page.objects, errors: page.gates?.errors || 0, warnings: page.gates?.warnings || 0 })),
};

if (args.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
else {
  console.log(`\n✓ ${outPath}`);
  console.log(`  ${summary.totals.slides} 页 · ${summary.totals.objects} 个原生对象 · ${summary.totals.texts} 个文本块 · ${summary.totals.notes} 条备注`);
  console.log(`  耗时 ${(summary.durationMs / 1000).toFixed(1)}s · 并发峰值 ${summary.peakConcurrency} · 失败页 ${summary.failedPages.length}`);
  console.log(`  报告 ${reportPath}${svgDir ? ` · SVG ${svgDir}` : ""}`);
}
process.exitCode = result.report.failedPages.length ? 2 : 0;
