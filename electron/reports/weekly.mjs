/**
 * 周报导出：把项目页「汇总」那一屏变成能发出去的东西。
 *
 * 只做格式化，不做取数——数据由渲染层按当前模板算好传进来（同一份数据渲染也在用，
 * 避免「页面上一套、导出里另一套」）。见 src/components/ProjectHome.tsx 的 SummaryPane。
 *
 * 两种出口：
 * - XLSX（`xlsx`，SheetJS）：概览 / 进展 / 问题 / 里程碑 / 验收，按模板取舍
 * - Outlook 邮件（.eml，MIME + HTML 表格）：`X-Unsent: 1` 让它以「未发送」草稿打开
 */
import * as XLSX from "xlsx";

/** standard = 完整周报；brief = 只要进展与问题；delivery = 交付验收，多一张验收明细 */
export const REPORT_TEMPLATES = ["standard", "brief", "delivery"];
export const REPORT_TEMPLATE_LABEL = {
  standard: "标准周报",
  brief: "精简周报",
  delivery: "交付验收",
};

const TPL = (t) => (REPORT_TEMPLATES.includes(t) ? t : "standard");

const s = (v) => (v == null ? "" : String(v));

/** 文件名里的项目名/别名：去掉路径分隔符与空白，限长 */
export function safeName(value, fallback = "project") {
  const cleaned = s(value).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return cleaned || fallback;
}

export function reportFileName(payload, ext) {
  const project = safeName(payload?.projectName);
  const range = `${safeName(payload?.weekStartLabel, "week")}_${safeName(payload?.weekEndLabel, "week")}`;
  return `${project}-周报-${range}.${ext}`;
}

/** 表格里要放哪些 sheet（模板决定） */
export function sheetNamesFor(template) {
  const t = TPL(template);
  if (t === "brief") return ["概览", "进展", "问题与求助"];
  if (t === "delivery") return ["概览", "里程碑", "验收", "问题与求助"];
  return ["概览", "进展", "里程碑", "问题与求助"];
}

const MISSING = "";

/** 概览 sheet 的键值对 */
function overviewRows(payload, template) {
  const rows = [
    ["项目", s(payload?.projectName)],
    ["周期", s(payload?.periodLabel)],
    ["导出时间", s(payload?.generatedLabel)],
    ["周报模板", REPORT_TEMPLATE_LABEL[TPL(template)]],
  ];
  if (TPL(template) !== "brief") rows.push(["目标", s(payload?.goal) || MISSING]);
  rows.push(["一句话进展", s(payload?.oneLine)]);
  for (const stat of payload?.stats || []) rows.push([s(stat.label), s(stat.value)]);
  return rows;
}

const PROGRESS_HEAD = ["编号", "工作项", "类型", "状态", "负责人", "说明", "更新"];
const ASK_HEAD = ["编号", "问题", "责任人", "影响", "需要你"];
const MS_HEAD = ["日期", "里程碑", "状态"];
const ACC_HEAD = ["需求", "验收判据", "是否完成"];

function progressRows(payload) {
  return (payload?.progress || []).map((r) => [s(r.key), s(r.title), s(r.kind), s(r.status), s(r.owner), s(r.note), s(r.updatedLabel)]);
}
function askRows(payload) {
  return (payload?.asks || []).map((a) => [s(a.key), s(a.what), s(a.owner) || "未指派", s(a.impact), s(a.need)]);
}
function milestoneRows(payload) {
  return (payload?.milestones || []).map((m) => [s(m.dateLabel), s(m.name), s(m.statusLabel)]);
}
function acceptanceRows(payload) {
  return (payload?.acceptance || []).flatMap((req) =>
    (req.items || []).map((it) => [s(req.key) + " " + s(req.title), s(it.text), it.done ? "已完成" : "未完成"]),
  );
}

function buildSheet(header, rows) {
  const aoa = [header, ...(rows.length ? rows : [header.map(() => "—")])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map((h, i) => ({ wch: Math.min(60, Math.max(8, h.length * 2 + 6 + (i === 1 ? 20 : 0))) }));
  return ws;
}

/** 生成 .xlsx 的 Buffer（纯函数，测试直接重开校验） */
export function buildXlsxBuffer(payload, template = "standard") {
  const t = TPL(template);
  const wb = XLSX.utils.book_new();
  const wanted = sheetNamesFor(t);
  const ov = XLSX.utils.aoa_to_sheet([["项目周报", ""], ...overviewRows(payload, t)]);
  ov["!cols"] = [{ wch: 16 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ov, "概览");
  if (wanted.includes("进展")) XLSX.utils.book_append_sheet(wb, buildSheet(PROGRESS_HEAD, progressRows(payload)), "进展");
  if (wanted.includes("里程碑")) XLSX.utils.book_append_sheet(wb, buildSheet(MS_HEAD, milestoneRows(payload)), "里程碑");
  if (wanted.includes("验收")) XLSX.utils.book_append_sheet(wb, buildSheet(ACC_HEAD, acceptanceRows(payload)), "验收");
  if (wanted.includes("问题与求助")) XLSX.utils.book_append_sheet(wb, buildSheet(ASK_HEAD, askRows(payload)), "问题与求助");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const esc = (v) => s(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Outlook 打开 .eml 时用的是 Word 的 HTML 内核：只用表格 + 内联样式，别用 flex/grid */
function table(head, rows, empty = "—") {
  const body = rows.length ? rows : [[empty]];
  return `<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:12px;font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif">`
    + `<thead><tr>${head.map((h) => `<th align="left" style="border-bottom:1px solid #d8d8d8;padding:6px;font-weight:600;color:#444">${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${body.map((cells) => `<tr>${(Array.isArray(cells) ? cells : [cells]).map((c) => `<td style="border-bottom:1px solid #eee;padding:6px;vertical-align:top;color:#222">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
    + `</table>`;
}

/** 邮件正文（HTML）：窄栏、表格、无脚本，Outlook 与手机都能读 */
export function buildHtmlReport(payload, template = "standard") {
  const t = TPL(template);
  const parts = [];
  const h = (text) => `<h3 style="margin:20px 0 8px;font-size:13px;color:#111;font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif">${esc(text)}</h3>`;
  parts.push(`<div style="max-width:760px;font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;color:#222">`);
  parts.push(`<p style="margin:0 0 4px;font-size:12px;color:#666">${esc(payload?.projectName)} · 项目周报 · ${esc(payload?.periodLabel)}</p>`);
  parts.push(`<h2 style="margin:0 0 12px;font-size:18px;color:#111">${esc(payload?.projectName)}</h2>`);
  parts.push(`<p style="margin:0;font-size:13px;line-height:1.7">${esc(payload?.oneLine)}</p>`);
  if (t !== "brief") {
    parts.push(h("目标"));
    parts.push(`<p style="margin:0;font-size:13px;line-height:1.7">${esc(payload?.goal) || "还没有写目标"}</p>`);
    parts.push(h("里程碑"));
    parts.push(table(MS_HEAD, milestoneRows(payload), "还没有里程碑"));
  }
  if (t === "delivery") {
    parts.push(h("验收明细"));
    parts.push(table(ACC_HEAD, acceptanceRows(payload), "没有验收判据"));
  } else {
    parts.push(h("进展"));
    parts.push(table(PROGRESS_HEAD, progressRows(payload), "本周没有可写的进展"));
  }
  parts.push(h("问题与求助"));
  parts.push(table(ASK_HEAD, askRows(payload), "没有需要你处理的问题"));
  parts.push(`<p style="margin:20px 0 0;font-size:11px;color:#888">${esc(payload?.generatedLabel)} 由 Cockpit Harness 导出 · 模板：${esc(REPORT_TEMPLATE_LABEL[t])}</p>`);
  parts.push("</div>");
  return parts.join("\n");
}

/** RFC 2047：中文主题要编码，否则 Outlook 里是一串乱码 */
export function encodeHeader(value) {
  const text = s(value);
  if (!text) return "";
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

const CRLF = "\r\n";

/** .eml：Outlook / Apple Mail 双击即以「未发送」消息打开 */
export function buildEml(payload, template = "standard", { to = "" } = {}) {
  const t = TPL(template);
  const subject = `[周报] ${s(payload?.projectName)} · ${s(payload?.periodLabel)}`;
  const html = buildHtmlReport(payload, t);
  const headers = [
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    to ? `To: ${s(to)}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "X-Unsent: 1",
  ].filter(Boolean);
  // 正文按 76 列折行不方便，这里整段不折（8bit，UTF-8 直接放）
  return headers.join(CRLF) + CRLF + CRLF + html + CRLF;
}

/** Markdown：贴到群里 / issue 里（保留原有的复制能力，只是不再是主按钮） */
export function buildMarkdown(payload, template = "standard") {
  const t = TPL(template);
  const line = (cells) => `| ${cells.map((c) => s(c).replace(/\|/g, "\\|")).join(" | ")} |`;
  const out = [`# ${s(payload?.projectName)} · 项目周报`, s(payload?.periodLabel), ""];
  out.push("## 一句话进展", s(payload?.oneLine), "");
  if (t !== "brief") {
    out.push("## 目标", s(payload?.goal) || "_还没写目标_", "");
    out.push("## 里程碑", ...(milestoneRows(payload).length
      ? milestoneRows(payload).map(([date, name, status]) => `- ${date} ${name}（${status}）`)
      : ["_还没有里程碑_"]), "");
  }
  if (t === "delivery") {
    out.push("## 验收明细", line(ACC_HEAD), line(ACC_HEAD.map(() => "---")), ...acceptanceRows(payload).map(line), "");
  } else {
    out.push("## 进展", line(PROGRESS_HEAD), line(PROGRESS_HEAD.map(() => "---")), ...progressRows(payload).map(line), "");
  }
  out.push("## 问题与求助");
  out.push(...(askRows(payload).length
    ? [line(ASK_HEAD), line(ASK_HEAD.map(() => "---")), ...askRows(payload).map(line)]
    : ["没有需要你处理的问题。"]));
  return out.join("\n");
}
