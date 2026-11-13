#!/usr/bin/env node
/**
 * 知识底座自检（不联网，除非加 --ark）。
 *
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/knowledge-selftest.mjs
 *   npm run knowledge:selftest
 *   npm run knowledge:selftest -- --ark    # 额外验证 Ark 探活 / embedding / 问答
 *
 * 用 Electron 的 Node 跑，才能拿到内置 node:sqlite（FTS5）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { explain, queryText } from "../electron/knowledge/bigram.mjs";
import { createKnowledge } from "../electron/knowledge/index.mjs";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const FIXTURES = [
  {
    name: "检索方案.md",
    body: `# 知识检索方案

## 背景

个人资料越来越多，需要能按语义与关键词同时检索。关键词检索保证精确命中，
向量检索保证同义改写也能召回，两者用 RRF 融合。

## 结论

采用 hybrid 检索：FTS5 关键词 + 向量召回，再按 RRF 排序后取前 8 条。
不做 rerank，因为当前模型网关没有可用的 rerank 模型。
`,
  },
  {
    name: "接口设计.md",
    body: `# 接口设计

## 知识库接口

知识库提供 kb_search 与 kb_read 两个只读工具，供 Agent 调用。
写入必须走页面草稿，不能直接改已审核内容。

## 引用格式

资料引用使用 doc 加页码，页面引用使用双方括号。
`,
  },
  {
    name: "天气笔记.md",
    body: `# 天气

今天天气很好，适合出门。与知识库无关，用来验证检索不会误召回。
`,
  },
];

async function main() {
  const withArk = process.argv.includes("--ark");
  console.log("知识底座自检\n");

  console.log("[1] bigram 切分");
  const tokens = explain("知识库检索方案");
  check("中文切 bigram", tokens.includes("知识") && tokens.includes("检索"), tokens);
  check("英文不切", explain("weknora knowledge base").includes("weknora"));
  const q = queryText("检索");
  check("查询切分去重", q === "检索" || q.split(" ").every((t, i, a) => a.indexOf(t) === i), q);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-kb-"));
  const kb = createKnowledge({ dir, embed: false });
  console.log(`\n[2] 摄入（${dir}）`);

  const ids = {};
  for (const fixture of FIXTURES) {
    const file = path.join(dir, fixture.name);
    fs.writeFileSync(file, fixture.body, "utf8");
    const res = await kb.ingestFile({ source: file });
    check(`导入 ${fixture.name}`, res.ok && res.engine === "simple", `${res.chunks ?? 0} chunks / ${res.engine ?? "?"} · ${res.parser}`);
    ids[fixture.name] = res.docId;
  }

  const dup = await kb.ingestFile({ source: path.join(dir, "检索方案.md") });
  check("重复导入被拦住", dup.skipped === "duplicate");

  const status = kb.status();
  check("状态统计", status.chunks > 0 && status.ready === 3, `${status.ready} ready / ${status.chunks} chunks`);

  console.log("\n[3] 中文两字词检索（FTS5 默认查不到的那一类）");
  for (const term of ["检索", "接口", "天气", "引用"]) {
    const { hits } = await kb.search(term, { mode: "fts" });
    check(`关键词「${term}」`, hits.length > 0, hits[0] ? `${hits[0].doc_id.slice(0, 8)} p${hits[0].page_no}` : "无结果");
  }

  const noise = await kb.search("天文望远镜", { mode: "fts" });
  check("无关查询不误召回", noise.hits.length === 0, `${noise.hits.length} hits`);

  console.log("\n[4] 引用定位");
  const hit = (await kb.search("RRF 融合", { mode: "fts" })).hits[0];
  check("命中带页号与标题", Boolean(hit?.page_no) && Boolean(hit?.heading), `p${hit?.page_no} / ${hit?.heading}`);

  console.log("\n[5] 删除传播");
  kb.remove(ids["接口设计.md"]);
  const after = await kb.search("接口", { mode: "fts" });
  const stillThere = after.hits.some((h) => h.doc_id === ids["接口设计.md"]);
  check("删除后不再召回", !stillThere);

  if (withArk) {
    console.log("\n[6] 表格解析");
    try {
      const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([["季度", "收入"], ["Q1", 120], ["Q2", 150]]);
      XLSX.utils.book_append_sheet(wb, ws, "收入表");
      const file = path.join(dir, "收入表.xlsx");
      XLSX.writeFile(wb, file);
      const res = await kb.ingestFile({ source: file });
      check("xlsx 解析", res.ok && res.parser === "xlsx" && res.engine === "builtin", `${res.pages ?? 0} 页 / ${res.engine} · ${res.parser}`);
      const { hits } = await kb.search("收入", { mode: "fts" });
      check("表格内容可检索", hits.length > 0, String(hits[0]?.text || "").slice(0, 30).replace(/\n/g, " "));
    } catch (e) {
      check("xlsx 解析", false, e.message);
    }

    console.log("\n[7] Ark 通道");
    const probe = await kb.probe();
    check("embedding 探活", probe.ok, probe.ok ? `${probe.dim} 维 / ${probe.model}` : `${probe.code}: ${probe.message}`);
    if (probe.ok) {
      const kb2 = createKnowledge({ dir: path.join(dir, "ark"), embed: true });
      const res = await kb2.ingestFile({ source: path.join(dir, "检索方案.md") });
      check("向量索引", res.ok && res.indexMode === "cloud-vector", res.indexMode);
      const { hits } = await kb2.search("用什么方式融合关键词和向量");
      check("混合检索", hits.length > 0, `fts+vec → ${hits.length} hits`);
      const answered = await kb2.ask("关键词和向量怎么融合的？");
      check("问答带引用", answered.found && answered.citations.length > 0, answered.answer.slice(0, 60).replace(/\n/g, " "));
      kb2.close();
    }
  }

  kb.close();
  console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("自检异常：", e);
  process.exit(1);
});
