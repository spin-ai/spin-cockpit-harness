# 知识库

> 资料回答「材料里写了什么」，页面沉淀「我整理过的结论」。两者共用一套索引与检索入口，只在**写入侧**分权。

## 一个库，两半

```text
kb.db（可重建索引）
 ├─ 材料侧（只读）  documents → chunks → chunk_fts / chunk_vec
 └─ 页面侧（可写）  pages → page_revisions / page_citations / page_links
一个检索入口        search(q) → 混合结果，带 kind
一组只读 MCP 工具   knowledge_search / knowledge_ask / knowledge_docs / knowledge_read
```

- **正文永远是事实源**：`pages/*.md`、`sources/*`、导入的原始文件；`kb.db` 只是索引，删了能重建。
- 资料只读、页面可写；页面状态机是 `draft / reviewed / stale`，Agent 只能写 draft。
- 与人像记忆互不写入、不共用检索入口。

## 解析：三层降级 + 引擎注册

产出统一收敛为 `Page[]`（`page_no` + `markdown`），后续环节只依赖这个结构。

| 层 | 处理 | 用什么 |
|---|---|---|
| L1 | 有文本层的常见格式 | `unpdf` / `mammoth` / `xlsx` / `officeparser` / `epub2`，本地、零网络 |
| L2 | PDF 转页图 | `unpdf` 渲染 + `@napi-rs/canvas`（预编译，无编译步骤） |
| L3 | 扫描件、乱码、复杂版式 | Ark VLM 逐页转 Markdown |

解析引擎做成**可插拔注册项**，路由只认接口：

| 引擎 | 类型 | 可用条件 |
|---|---|---|
| `simple` | 本地直读 md / txt / csv / html / 代码 | 永远可用 |
| `builtin` | 本地文档解析（默认） | 永远可用 |
| `mineru` / `mineru_cloud` | HTTP，自建 / 云端 | 配置了 endpoint / key |
| `paddleocr_vl` / `paddleocr_vl_cloud` | HTTP | 配置了 endpoint / token |
| `custom` / `extras` | 通用转换器 | 配置了 endpoint |

路由规则里最要紧的一条：**显式指定的引擎不可用就报错，不静默换引擎**；只有 `auto` 才回退 `builtin` 并把 warning 带进摄入结果。
实际用了哪个引擎写在 `documents.engine` / `documents.parser` 上，UI 行内可见。

## 摄入状态机

```text
queued → parsing → indexing → ready
              └──────────────→ failed（可 reparse）
ready → stale（源文件 hash 变化）→ queued
ready → deleting → deleted
```

- 只有**用户显式导入**，Agent 不能触发导入。
- 入库前算 `sha256`，与已有资料比对，重复直接跳过。
- 解析与索引分两段提交：解析失败不污染索引，索引失败可单独重跑。
- embedding 按 `doc_id` 整份提交，**不允许半份文档进索引**。
- 删除先打标，再让引用它的页面标 `stale`，最后才清 chunk / 向量 / 页图。

## 检索与引用

```text
FTS top 30（bigram）+ 向量 top 30
  → RRF(k=60)
  → 邻近 chunk 合并、同分只留最高
  → 按库 / 类型 / 标签 / 时间过滤
  → top 5–8 交给 Agent
```

- FTS 查询用 `OR` 连接 token：FTS5 的空格是 AND，自然语言问句会被要求「所有词都出现」，几乎必然 0 命中。
- 中文必须自建 **bigram**：两字词在 `unicode61` / `trigram` 下都查不到。
- 默认**不做 rerank**；宁可 top_k 放大 + RRF + 邻近合并。
- 无结果时明确返回「材料里没有」，不拼接无关片段。
- 引用格式：资料 `[doc:<id> · <文件名> · p<页>]`，页面 `[[标题]]`；引用只能来自候选集，模型不得编造。
- 引用快照（`quote` + `locator`）独立保存，原文档删除后仍可追溯；点引用能跳回原页（PDF 按需渲染成 PNG 并缓存）。

## 写入分权

| 动作 | 谁可以做 |
|---|---|
| 导入 / 删除资料 | 只能人 |
| 写页面 draft | 人或 Agent |
| 改 reviewed | 只能人，且要走建议 / 审核门 |
| 后台整理（去重、补引用、标过期） | 只产建议，不直接改页面 |

结构整理、模型整理、漏引用 / 疑似重复都进入同一条建议队列：提议存完整渲染正文 + `baseHash` + 理由，人看逐行 diff 才落盘；页面在建议之后改过就标 `needs_rebase`，不覆盖。详见 [LLM Wiki](#/wiki/llm-wiki)。

## 图文与成本红线

- **整页图绝不进向量**：一张 980px A4 页图约 2 万 tokens，是文本 chunk 的 65 倍。
- 默认 **caption-first**：VLM 生成图注，图注走文本 embedding；页图只用于展示与引用跳转。
- 「以图搜图」是独立开关，只 embed 图片裁块（长边 ≤ 384px），不是默认能力。
- 向量必须带 `space`（模型标识）；换模型 = 该 space 全量重建，否则同维度旧向量会静默混用。

## 降级

- `knowledge_status`：`ready | degraded | unavailable`。
- 模型不可用时检索仍走 FTS（本地关键词不依赖网络），UI 明示「已降级为关键词检索」。
- **不静默回落到其它来源**，避免引用错乱。

## 明确未做

- K5 图片：图片库、vision embedding、「找相似版式」还没做；当前只把 markdown 里的图片引用带进索引。
- 没有 rerank（网关不支持）；连接器（飞书 / Notion / GitLab）未接。
- 解析的自动切换判据仍在按真实材料调，不是成品阈值。

## 继续阅读

- [LLM Wiki](#/wiki/llm-wiki)：页面侧的 Source → Page → Citation → Review。
- [记忆与 Dream](#/wiki/memory)：四层记忆与知识库的边界。
- [人物画像与记忆语义](#/wiki/persona)：另一套库、另一种「忘」。
