/**
 * 周报导出：xlsx（SheetJS）/ eml（MIME + HTML）/ Markdown，模板取舍与文件名。
 * 只测纯函数，不落盘、不开对话框。
 */
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  REPORT_TEMPLATES, REPORT_TEMPLATE_LABEL, buildEml, buildHtmlReport, buildMarkdown, buildXlsxBuffer,
  encodeHeader, reportFileName, safeName, sheetNamesFor,
} from "../electron/reports/weekly.mjs";

const payload = {
  projectName: "spin-cockpit-harness",
  periodLabel: "本周 11-23 → 11-29",
  weekStartLabel: "11-23",
  weekEndLabel: "11-29",
  generatedLabel: "生成于 11-28 23:40",
  goal: "让一个项目跑完定义到复盘",
  oneLine: "2 条在实现；没有阻塞。",
  stats: [{ label: "需求", value: 36 }, { label: "缺口", value: 15 }],
  progress: [
    { key: "US-09", title: "拖卡片改状态", kind: "需求", status: "实现中", owner: "DE-B", note: "0/2 验收过", updatedLabel: "11-28 23:16" },
    { key: "TASK-01", title: "接 GitHub 任务源", kind: "任务", status: "进行中", owner: "SE", note: "—", updatedLabel: "11-28 20:02" },
  ],
  asks: [
    { key: "未派活", what: "15 条已批准的需求还没派活", owner: "PM", impact: "批准了但没人动手", need: "派给谁" },
    { key: "ISSUE-01", what: "拖动没有撤销", owner: "", impact: "状态会错", need: "加撤销" },
  ],
  milestones: [
    { name: "需求链可用", dateLabel: "11-18", statusLabel: "已完成" },
    { name: "ORCA 对照收口", dateLabel: "12-05", statusLabel: "进行中" },
  ],
  acceptance: [
    { key: "US-09", title: "拖卡片改状态", items: [{ text: "拖完顺序不变", done: true }, { text: "闸门拒绝时状态不动", done: false }] },
  ],
};

/* 文件名：路径分隔符 / 空白被换掉，扩展到项目名 */
assert.equal(safeName("spin cockpit/harness"), "spin-cockpit-harness");
assert.equal(safeName("   "), "project");
assert.equal(reportFileName(payload, "xlsx"), "spin-cockpit-harness-周报-11-23_11-29.xlsx");
assert.equal(reportFileName(payload, "eml"), "spin-cockpit-harness-周报-11-23_11-29.eml");

/* 模板 → sheet 取舍 */
assert.deepEqual(REPORT_TEMPLATES, ["standard", "brief", "delivery"]);
assert.deepEqual(sheetNamesFor("standard"), ["概览", "进展", "里程碑", "问题与求助"]);
assert.deepEqual(sheetNamesFor("brief"), ["概览", "进展", "问题与求助"]);
assert.deepEqual(sheetNamesFor("delivery"), ["概览", "里程碑", "验收", "问题与求助"]);
assert.deepEqual(sheetNamesFor("不认识"), sheetNamesFor("standard"));
assert.equal(REPORT_TEMPLATE_LABEL.delivery, "交付验收");

/* xlsx：能被重新读出来，表头与行对得上 */
for (const tpl of REPORT_TEMPLATES) {
  const buf = buildXlsxBuffer(payload, tpl);
  assert.ok(buf.length > 4000, `${tpl} 的 xlsx 太小`);
  const wb = XLSX.read(buf, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, sheetNamesFor(tpl), `${tpl} 的 sheet 不一致`);

  const overview = XLSX.utils.sheet_to_json(wb.Sheets["概览"], { header: 1 }).flat().join(" ");
  assert.ok(overview.includes("spin-cockpit-harness"));
  assert.ok(overview.includes("本周 11-23 → 11-29"));
  assert.ok(overview.includes("精简周报") || overview.includes(REPORT_TEMPLATE_LABEL[tpl]));

  if (tpl !== "brief") assert.ok(overview.includes("让一个项目跑完定义到复盘"), "标准/交付模板应带目标");
  else assert.ok(!overview.includes("让一个项目跑完定义到复盘"), "精简模板不该带目标");

  if (wb.SheetNames.includes("进展")) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["进展"], { header: 1 });
    assert.deepEqual(rows[0], ["编号", "工作项", "类型", "状态", "负责人", "说明", "更新"]);
    assert.equal(rows.length, payload.progress.length + 1);
    assert.equal(rows[1][0], "US-09");
  }
  if (wb.SheetNames.includes("验收")) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["验收"], { header: 1 });
    assert.deepEqual(rows[0], ["需求", "验收判据", "是否完成"]);
    assert.equal(rows.length, 3); // 表头 + 两条判据
    assert.ok(rows.some((r) => r[2] === "已完成"));
    assert.ok(rows.some((r) => r[2] === "未完成"));
  }
}

/* xlsx：空数据也要给出表头（打开是空表，不是坏文件） */
const emptyBuf = buildXlsxBuffer({ projectName: "p" }, "standard");
const emptyWb = XLSX.read(emptyBuf, { type: "buffer" });
const emptyRows = XLSX.utils.sheet_to_json(emptyWb.Sheets["进展"], { header: 1 });
assert.deepEqual(emptyRows[0], ["编号", "工作项", "类型", "状态", "负责人", "说明", "更新"]);

/* 邮件：主题按 RFC 2047 编码；正文是 HTML 表格；X-Unsent 让 Outlook 当草稿 */
const eml = buildEml(payload, "standard");
const [head, ...bodyParts] = eml.split("\r\n\r\n");
assert.ok(head.includes("MIME-Version: 1.0"));
assert.ok(head.includes("Content-Type: text/html; charset=utf-8"));
assert.ok(head.includes("X-Unsent: 1"), "Outlook 需要 X-Unsent 才是未发送草稿");
assert.ok(/^Subject: =\?UTF-8\?B\?/m.test(head), "中文主题必须编码");
assert.ok(!head.includes("Subject: [周报]"), "未编码的中文主题会乱码");
const decodedSubject = Buffer.from(head.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1], "base64").toString("utf8");
assert.ok(decodedSubject.includes("spin-cockpit-harness"));
assert.ok(decodedSubject.includes("11-23 → 11-29"));

const html = bodyParts.join("\r\n\r\n");
assert.ok(html.includes("<table"), "邮件正文要有表格");
assert.ok(html.includes("US-09"));
assert.ok(html.includes("拖卡片改状态"));
assert.ok(!/<script/i.test(html));
assert.ok(!/display:\s*flex/i.test(html), "Outlook 的 HTML 内核不认 flex");

/* 邮件正文：模板决定带不带目标 / 验收 */
assert.ok(buildHtmlReport(payload, "brief").includes("本周 11-23 → 11-29"));
assert.ok(!buildHtmlReport(payload, "brief").includes("<h3") || !buildHtmlReport(payload, "brief").includes("目标"));
assert.ok(buildHtmlReport(payload, "delivery").includes("验收明细"));
assert.ok(!buildHtmlReport(payload, "standard").includes("验收明细"));

/* 转义：标题里带尖括号不能变成标签 */
const evil = buildHtmlReport({ ...payload, oneLine: "<img src=x onerror=alert(1)>" }, "brief");
assert.ok(evil.includes("&lt;img"), "正文要转义");
assert.ok(!evil.includes("<img"), "不能把用户内容当 HTML");

/* 地址：有就给个 To，没有就不写这一行 */
assert.ok(buildEml(payload, "brief", { to: "pm@example.com" }).includes("To: pm@example.com"));
assert.ok(!buildEml(payload, "brief").includes("To: "));

/* Markdown：按模板取舍，表格行数与数据一致 */
const mdStandard = buildMarkdown(payload, "standard");
assert.ok(mdStandard.startsWith("# spin-cockpit-harness · 项目周报"));
assert.ok(mdStandard.includes("| US-09 |"));
assert.ok(mdStandard.includes("## 里程碑"));
assert.ok(mdStandard.includes("## 问题与求助"));
const mdBrief = buildMarkdown(payload, "brief");
assert.ok(!mdBrief.includes("## 里程碑"), "精简模板不带里程碑");
assert.ok(mdBrief.includes("## 进展"));
const mdDelivery = buildMarkdown(payload, "delivery");
assert.ok(mdDelivery.includes("## 验收明细"));
assert.ok(mdDelivery.includes("拖完顺序不变"));

/* 标题编码：纯 ASCII 不加壳 */
assert.equal(encodeHeader("weekly report"), "weekly report");
assert.equal(encodeHeader(""), "");

console.log("report weekly: passed");
