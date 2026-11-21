> 层：架构 · 状态：部分落地 · 核对：2026-11-14 · 覆盖：知识库：解析 / 索引 / 检索 / 引用

# Arch · 知识（资料 + 页面）

> **状态：K0 已落地（2026-11）；K1 解析引擎注册/路由已落地（MinerU / PaddleOCR-VL / 自研 HTTP 引擎）；K1 其余与 K2–K5 待实施。** 本文是 [`REQ-modules-original.md`](../product/REQ-modules-original.md) 第 2 节「知识」的实现设计。
> 已实现：`electron/knowledge/`（bigram + node:sqlite FTS5 + 向量 + RRF + 解析 + 摄入状态机 + Ark 客户端）、`scripts/knowledge-selftest.mjs`。
> 自检：`npm run knowledge:selftest`（不联网） / `npm run knowledge:engines:selftest`（引擎注册、路由、MinerU/Paddle 协议，全 mock） / `npm run knowledge:selftest:ark`（含 embedding 与问答）。
> **分层与流动（四层记忆、Dream）见 [`ARCH-memory.md`](ARCH-memory.md)。** 本文只管 L3 里的**对象**：资料与页面本身。
> 关联：[`ARCH-wiki-retrieval.md`](ARCH-wiki-retrieval.md)（检索评估与 SAG2 附录）、[`PLUGIN-notes.md`](PLUGIN-notes.md)（Notes 数据/API）、[`ARCH-plugins.md`](ARCH-plugins.md)。

---

## 0. 一句话与边界

**资料回答"材料里写了什么"，页面沉淀"我整理过的结论"。两者共用一套索引与检索入口，只在写入侧分权。**

- 资料（source / document）：只读，摄入状态机。
- 页面（page）：可写，审核状态机；Agent 只能写 `draft`。
- 两者**共用**解析、分块、索引、检索、引用解析、过期传播。
- 与人像记忆**互不写入，不共用检索入口**（人像回答“这个人随时间什么是真的”）。
- 本文不定义“层次”与“晋升”：四层怎么流动、Dream 怎么校正，见 [`ARCH-memory.md`](ARCH-memory.md)。

### 0.1 决策记录：不引入 WeKnora

曾定稿过一版「WeKnora Lite 单二进制 sidecar」方案，已废弃。原因：

1. 它的唯一实优势（高精度解析矩阵）只在**标准版 + Docker**里，Lite 仅 Simple 引擎；
2. GitHub Release 无预编译产物，需自建 Go + CGO + Node 构建链并长期维护；
3. 它需要的 embedding / 多模态 / 图片检索，现在用一把已有 Ark key + Electron 内置 `node:sqlite` 即可覆盖；
4. 它自带的 Wiki / Agent / 记忆子系统会形成第三套事实源，与 `notes` 插件的 review / revision / stale 边界冲突。

保留原方案的好东西：**引用格式**（§7）、**MCP 只读白名单**（§9.1）、**状态机与降级语义**（§9.4），以及 2026-11 新增的 **引擎注册与路由层**（§3.1–3.3，借鉴 WeKnora 的 `EngineRegistration` / `NewReader` 思路，但不引入它的 Go/Python 服务）。

---

## 1. 形态

```text
一个库（kb.db，可重建索引）
 ├─ 材料侧（只读）  documents → chunks → chunk_fts / chunk_vec
 └─ 页面侧（可写）  pages → page_revisions / page_citations / page_links
一个检索入口        kb.search(q) → 混合结果，带 kind
一组 MCP 工具       kb_search / kb_ask / kb_read / doc_list / doc_view / chunk_list
```

**正文永远是事实源**（`pages/*.md`、`sources/*`、原文件），`kb.db` 只是索引，删了能重建。这条保证了 §07 的"不被锁定"。

---

## 2. 目录与存储

```text
userData/knowledge/
  kb.db                     # node:sqlite，索引 + 映射（可重建）
  files/<doc_id>/orig.*     # 原始文件
  files/<doc_id>/p<nn>.png  # 页图（引用预览用）
  files/<doc_id>/blocks.json # 可选：块级 sidecar（视觉解析结果，不参与索引）
```

`blocks.json` 由解析侧写（`saveBlocks(docId, payload)`，读 `blocks(docId)`），存 `blocks/relations/checks` 与 bbox；**不进 chunk、不进向量**，Reader 契约仍是 `Page[] = { page_no, markdown }`。

`pages/*.md`、`sources/*` 仍由 Notes 插件维护在原 vault 目录，不搬进 `files/`。

### 2.1 表

```sql
-- 材料侧
CREATE TABLE documents(id, kind, uri, file_hash, mime, parser, engine,
                       pages_total, status, error_code, indexed_at, deleted_at);
CREATE TABLE chunks(id, doc_id, page_no, heading, char_start, char_end, text);
CREATE VIRTUAL TABLE chunk_fts USING fts5(bigram, tokenize='unicode61');
CREATE TABLE chunk_vec(chunk_id INTEGER PRIMARY KEY, dim INTEGER, vec BLOB);

-- 页面侧索引（正文不在库里）
CREATE TABLE pages(id, slug, title, status, updated_at, reviewed_at);
CREATE VIRTUAL TABLE page_fts USING fts5(bigram, title, tokenize='unicode61');

-- 两侧共用
CREATE TABLE citations(id, from_kind, from_id, to_kind, to_id, quote, locator, created_at);
```

### 2.2 索引可重建

```text
reindex(doc_id | all)：重解析 → 重分块 → 重写 chunk_fts / chunk_vec
```

`embedding_model`、`dim`、`index_version` 写 `meta` 表；任一变化则必须全量重建，不允许混用。

---

## 3. 材料侧 · 解析矩阵

**三层降级，产出统一为 `Page[]`——后续所有环节只依赖这个结构。**

| 层 | 输入 | 选型 | 备注 |
|---|---|---|---|
| L1 | PDF（有文本层） | `unpdf@2.1.0`（0 依赖） | 逐页取文，保留页号 |
| L1 | DOCX | `mammoth@1.13.0` | → HTML → MD，保标题层级 |
| L1 | XLSX | `xlsx@0.18.5` | 每 sheet → MD 表格 |
| L1 | PPTX / ODT / ODS / ODP | `officeparser@8.7.1` | 一个库覆盖四种 |
| L1 | EPUB | `epub2@3.0.2` | xhtml → MD |
| L1 | MD / TXT / 代码 | 直读 | |
| L2 | PDF → 页图 | `unpdf` render + `@napi-rs/canvas@1.1.1` | skia **预编译**，无编译步骤 |
| L3 | 扫描件 / 乱码 / 复杂版式 | **Ark `doubao-seed-2.1-turbo`** 逐页 → MD | 现有 plan key，已实测可用 |

### 3.1 引擎注册与路由（K1，2026-11）

> 对应 WeKnora `internal/infrastructure/docparser/engine_registry.go`。核心不是"多接几个模型"，而是**把解析引擎做成可插拔注册项**，路由只认接口，不认具体服务。

```text
electron/knowledge/engines/
  registry.mjs    # 注册表 + 路由 + 统一 Page[] 归一化
  config.mjs      # userData/knowledge/engines.json（密钥 safeStorage）
  http.mjs        # fetch / multipart / zip / content_list / 错误码
  local.mjs       # simple（纯文本）+ builtin（PDF/Office/EPUB）
  mineru.mjs      # mineru（V1 + legacy）+ mineru_cloud
  paddle.mjs      # paddleocr_vl + paddleocr_vl_cloud
  custom.mjs      # 自研 / 第三方 HTTP 转换器（extras 自动注册）
```

每个引擎只需要实现：

```js
{
  name, label, description, fileTypes: ["pdf", "docx"],
  checkAvailable(config) -> { available, reason },   // 纯配置，不联网
  probe(config) -> { available, reason },            // 用户点「探测」才联网
  createReader(config) -> { read({ file, bytes, fileName, fileType }) }
}
```

Reader 的输出**必须**收敛为 `Page[]`（`page_no` + `markdown`）。图片、表格、VLM 全都归一到 markdown；引用只依赖页号，不依赖 bbox。

路由（`registry.parse`）：

1. 显式指定 `engine` 且已注册 → 用它；**不可用直接报 `engine-unavailable`，不静默换引擎**。
2. 未指定 + 简单格式（md/txt/csv/json/html/代码）→ `simple`，离线、零网络。
3. 未指定 + 其余 → `defaultEngine`（默认 `builtin` 本地文档解析）。
4. 未知引擎 → `fallbackEngine`，并把 `route.warnings` 带回摄入结果。
5. `auto` 下目标引擎不可用 / 不支持该扩展名 → 回退 `builtin` 并记录 warning，不让导入直接失败。

摄入结果会写 `documents.engine`（引擎名）与 `documents.parser`（协议，如 `mineru/v1`），UI 行内显示；`kb.db` 仍是可重建索引。

### 3.2 引擎矩阵与超时

| 引擎 | 类型 | 接入方式 | 默认超时 | 可用条件 |
|---|---|---|---|---|
| `simple` | 本地 | 直读 | 60s | 永远可用 |
| `builtin` | 本地 | unpdf / mammoth / xlsx / officeparser / epub2 | 600s | 永远可用 |
| `mineru` | HTTP | 自建 MinerU；自动识别 4.x V1（`/v1/uploads` → job → zip）与 3.x `/file_parse` | **1000s** | endpoint 已配置 |
| `mineru_cloud` | HTTP | mineru.net v4 batch（申请上传 → PUT → 轮询 → zip） | **30m** | API Key 已配置 |
| `paddleocr_vl` | HTTP | 自建 PaddleX `POST /layout-parsing`（base64 文件） | **1000s** | endpoint 已配置 |
| `paddleocr_vl_cloud` | HTTP | AI Studio OCR jobs（multipart → 轮询 → JSONL） | **600s** | token 已配置 |
| `custom` / `extras` | HTTP | 通用转换器：multipart / json-base64，响应可为 markdown、JSON 或 MinerU/Paddle 形状 | 600s（可改） | endpoint 已配置 |

超时**按引擎独立**，不共用全局值；自研引擎在 `engines.json` 里给自己的 `timeoutMs`。云端 MinerU 的 30m 与 WeKnora 一致，自建 MinerU / Paddle 的 1000s 也一致。

### 3.3 配置与密钥

```text
userData/knowledge/engines.json   # 0600；密钥字段经 safeStorage 加密（v1:...）
  defaultEngine: "auto"
  fallbackEngine: "builtin"
  engines: { mineru: { endpoint, timeoutMs }, ... }
  extras: [{ name, label, endpoint, fileTypes, timeoutMs, ... }]
```

- 渲染进程只能拿到**脱敏配置**（`apiKeySet` / `tokenSet`），拿不到密钥；
- 自研引擎 = 知识页「＋ 自研引擎」/ `extras` 加一条，或运行时 `registry.register(engine)`；
- 新引擎接上后自动出现在引擎列表，不需要改路由代码；
- 引擎的 `checkAvailable` 不联网，避免打开知识页时批量打外部服务；联网探测是显式动作。

### 3.4 自动切换判据

```text
每页可抽字符数 < 100                   → L3
中文文档且 CJK 占比 < 0.3              → L3
表格行数 / 文本行数 > 0.4              → L3（让 VLM 保表结构）
抽样 FTS 命中率 < 20%                  → 标 reparse
```

### 3.5 引用定位

**定为「页级 + 段序号」，不做 bbox。** VLM 返回的坐标不稳定，画框反而误导。原文预览用 `page_no` 跳页图。

块级信息只以 sidecar 旁挂（`files/<doc_id>/blocks.json`），用于「点引用 → 在原图上高亮这个块」的后续升级；在没有稳定坐标的解析器上不画框。

---

## 4. 材料侧 · 摄入状态机

```text
queued → parsing → indexing → ready
              └──────────────→ failed（可 reparse）
ready → stale（源文件 hash 变化）→ queued
ready → deleting → deleted
```

规则：

1. **用户显式导入**，Agent 不能触发导入；
2. 入库前算 `sha256`，与 `documents.file_hash` 比对，重复跳过并提示；
3. 解析与索引分两段提交：解析失败不污染索引，索引失败可单独重跑；
4. embedding 按 `doc_id` 整份提交，**不允许半份文档进索引**；
5. 失败保留错误码与日志入口，UI 可 `reparse`；
6. 删除 → `deleted_at` 打标 → 引用它的页面标 `stale` → 可选彻底删除（chunk/向量/页图一并清理）。

并发：解析 2、embedding 批 16–64 条、失败指数退避；不做实时文件监听。

---

## 5. 页面侧

### 5.1 已有能力（不改）

`plugins/notes/main.mjs`：Source → Page → Citation → Review → Revision（每页独立 NDJSON）、`draft / reviewed / stale`、回收站、双链、图谱、`wiki.memory`、MCP 工具。

### 5.2 后台任务（新增）

插件内定时（空闲 60s 触发）+ 队列，**限并发 1、可中断**：

| 任务 | 做法 | 约束 |
|---|---|---|
| 去重 | 标题 + 摘要 bigram 相似度出候选对，模型只判“是否合并” | 只产建议，不自动合并 |
| 补引用 | bigram 检索 source → 建议 `source_id` + 原文片段 | 需人确认后写入 |
| 标过期 | source `sha256` 变更 → 引用页 `stale` | 自动，可撤销 |

这三项 = Dream 的“补洞 / 构建”动作在知识侧的落地；**调度、预算、建议队列与接受/拒绝记录统一由 [`ARCH-memory.md`](ARCH-memory.md) 定义**。

**后台任务不直接改 `reviewed` 页面**——这是 §US-LLMWiki-01 的硬约束。

### 5.3 建议队列与审核门（2026-11 落地）

整理的定位不是「自动改对」，而是**把低置信度的改动变成可审阅的建议**（`ARCH-key-tech.md` ③）。
落地部分是「结构整理」这一类；其余类型复用同一张表、同一套闸门。

```text
wiki.curate（确定性，免费）
   ├─ draft              → 直接写 + revision(reason=curate:structure)
   └─ reviewed / stale   → 只产建议，不写盘
```

**建议对象**（存在 `wiki-index.json` 的 `suggestions[]`，上限 120 条）：

```js
{
  id, kind: "structure" | "summary" | "citation" | "merge" | "stale-fix",
  targetKind: "page", targetId, title,
  payload,          // 完整渲染后的正文（不是 diff 指令）
  baseHash,         // 生成建议时的页面 hash，用来检测「页面已改过」
  payloadHash, confidence,
  evidence: [{ kind: "rule"|"source"|"page", id, quote }],   // 空则不入队
  size: { lines, chars },
  sig,              // structure:<pageId>:<payloadHash 前 16 位>，内容相同不重复入队
  status,           // pending | accepted | rejected | superseded | expired | needs_rebase
  createdAt, decidedAt, feedback
}
```

**闸门**（每一条都可被单测断言，不靠 prompt 自觉）：

1. 只改确定性的、有界的部分：大纲 / 摘要行 / `## 要点` / `## 相关`；用户自己写的小节一律不动；
2. **不删人写的内容**：已有要点条目、夹在「要点 / 相关」里的非列表文字、已有 `[[相关]]` 链接（含前向链接）原样保留；
   「不丢行」是可测的：原页面每一行非标题正文都必须出现在整理结果里（`wiki:curate:selftest` 断言）；
3. `evidence` 为空不入队；同页面旧的 `pending` 自动标 `superseded`；
4. 大小上限：`payload` ≤ 200 KB；`kind: summary` 仍走 `spliceCurated`（只动两处）；
5. **提议即产物**：批准时纯字节拷贝（不重新调模型、不重新生成），审核者读到的 diff 就是发布的字节；
6. `hash(page.content) !== baseHash` → `needs_rebase`，**不自动三路合并**；
7. 建议本身不写 `reviewed` 的 `confidence` / `status`；接受后页面状态不变（仍是 `reviewed`）；
8. 拒绝也留痕（`feedback` + `decidedAt`），供后续节流（复用 `ARCH-memory.md` §7.3 的「同类 30 天不重复打扰」）。

实现：`plugins/notes/curate-structure.mjs`（纯函数，`apply` 字段就是分流的唯一判据）、
插件 API `wiki.curate` / `wiki.suggestions` / `wiki.suggestion` / `wiki.suggestionResolve`、
审核 UI「逐行 diff → 接受并写入 / 退回」。
自检：`npm run wiki:curate:selftest`（计划层，含 reviewed 分诊、不丢行、漏引用 / 重复扫描、合并草稿）、
`npm run wiki:plugin:selftest`（插件层：假 ctx 驱动真实 API，验「字节不变 / needs_rebase / 提议即产物 + revision / 引用只加不改正文 / 合并只产草稿 / 拒绝后不重复打扰」）。

**判据**（`npm run wiki:curate:selftest` 第 [4] 组覆盖前三项）：

| 指标 | 门槛 |
|---|---|
| 静默丢失（reviewed 页字节在无人接受时改变） | **0** |
| 建议的 `evidence` 缺失率 | 0 |
| 建议采纳率 / `needs_rebase` 占比 | 观测，不下硬指标 |
| 整理幂等（第二次 `updated = 0`） | 100% |

**三类建议共用一条通道**（2026-11）：

| kind | 谁产 | 接受 = 什么 | 拒绝后 |
|---|---|---|---|
| `structure` | `wiki.curate`（确定性） | 把 payload 字节原样写回页面 + revision | 30 天不再提同类（按 payload hash 的 sig） |
| `summary` | `wikiCurateLLM`（模型，每页一次调用） | 同上（模型只重写摘要与要点，且必须过 `claimCheck`） | 同上 |
| `citation` | `wiki.maintain`（确定性） | 加一条引用（**正文不动**）+ revision | 30 天不再提这条 page+source |
| `merge` | `wiki.maintain`（确定性） | 生成一份**合并草稿**（两个原页面一个字都不动） | 30 天不再提这一对 |

`wiki.maintain` 的判定全是确定性的、可写断言：

- **漏引用**：页面某一行与资料某一行 bigram 重叠 ≥ 0.62 且该页没引用这份资料 → 建议带资料原文片段作证据；
  用 bigram 倒排表先缩小候选资料，再逐行算重叠（不读整库）。
- **疑似重复**：标题 Jaccard ≥ 0.7 **且长度比 ≥ 0.8**（防止「发布流程」吃掉「发布流程复盘」），或摘要 Jaccard ≥ 0.75。
- 合并草稿 = 两页要点并集（≤12 条）+ 两边摘录 + 互链；**不删、不改、不合并原页面**，删哪份由人决定。

节流口径统一：`sig` 是「同一条建议」的身份，pending 去重、拒绝后 30 天不再打扰、已接受且 payload 相同不重复入队。

`wiki.dream` 现在只是 `wiki.maintain` 的兼容壳（默认 `dryRun: true`，只报 `missing-citation` / `duplicate-page` 数，不写队列）；
不再有第二套维护检查，也不再有 `stale-draft` 这类靠时间瞎猜的项。

**未做**：Agent 主动提建议（现在只有确定性扫描 + 结构整理）；合并的自动执行（永远是生成草稿，不自动删）。

### 5.4 人工结论（claim）：人改的一句不能在下一次整理里消失

「draft 才可写」只防住了**整页**层面的覆盖；页内的一句话仍可能被重排吃掉（例如要点 8 条上限、段落被重写）。
claim 就是补这一层的逐条保护，**不依赖模型**：

```js
data.claims[] = {
  id, pageId, quote,        // 归一化后的那一行（去列表符号 / 压空白）
  kind: "line" | "explicit",// line = 人保存时自动抓取；explicit = 人显式锁定
  provenance: { by: "human", at },
  status: "active" | "conflict" | "orphan" | "removed",
  checkedAt
}
```

**抓取**（`plugins/notes/claims.mjs`，纯函数）：

- 只给**已有页面**的人保存抓：新建页面的正文本来就是草稿，不需要保护；
- 只抓**这次新出现的行**（和保存前内容对比），并过滤标题 / 摘要 / 纯双链 / 占位符 / 短句；
- 人自己删掉的那一行 = 自己撤销了结论，直接移除，不留成 orphan 噪声；
- 单次最多 12 条、单页最多 40 条；
- Agent / 系统写入（`source: "agent"`）既不产生结论，也不能靠保存洗掉它们。

**生命周期**（`plugins/notes/main.mjs`）：

| 事件 | 处理 |
|---|---|
| 人保存已有页面 | 新增的行记成 claim；人自己删掉的行视为撤销（直接移除，不留 orphan） |
| 接受合并建议 | 合并草稿**接手**两边「草稿里确实有」的 claim（`provenance.by = "carry"`），原页面各自保留 |
| 页面进回收站 | claim 标 `orphan`（不删）；建议队列里对应条目 `expired` |
| 从回收站恢复 | 按恢复后的正文重新核对：还在 → `active`，不见了 → 保持 `orphan` |
| 页面被删/重命名 | 删 → orphan；重命名不改 `pageId`，claim 不受影响 |

`wiki.claimIssues` 按页面聚合「对不上」的结论，`wiki.list` 也带 `claimIssues` ——
「审核」tab 用它列「结论待确认」，人不用翻到右栏才发现。

**判定**（整理前逐条跑，行级文本，不看语义）：

| 档 | 判据 | 结果 |
|---|---|---|
| ok | 新正文里仍能找到这句（包含关系） | 保留 |
| conflict | 找不到原句，但和某一行 bigram 重叠 ≥ 0.5（被改写） | **拦下自动写入** |
| orphan | 完全不见（被挪走 / 被上限挤掉 / 被删） | **拦下自动写入** |

**拦住之后走同一条通道**：该页的改动进 `suggestions`，evidence 里带上被动的结论原文，
右栏「人工结论」标 `conflict` / `orphan`，页面的自动整理只字不写。

**模型整理同一关**：`wikiCurateLLM` 落盘前先调 `wiki.claimCheck`，会丢掉人工结论的页面直接跳过并回显原因
（它只调 `spliceCurated` 改摘要/要点，理论上很少撞上，但撞上就是整段被覆盖）。

**判据**：`wiki:curate:selftest` [5] + `wiki:plugin:selftest` [5] ——
丢了结论的 draft 必须字节不变、`blockedByClaims` 必须上报、结论状态必须是 conflict/orphan、解除后必须恢复可写。

**仍未做**：claim 的语义锚点（section 编号 / 引用绑定 / 同义改写识别）——
现在是行级文本比对 + 合并时的显式携带；段落被**非合并**路径搬到别的页面仍会算 orphan（宁可多问人一次）。

---

## 6. 索引

### 6.1 中文关键词：必须自建 bigram

实测（`node:sqlite`，SQLite 3.53.4）：

| 索引方式 | `知识库` | `检索` | `天气` |
|---|---|---|---|
| FTS5 `unicode61` | ❌ 0 | — | ❌ 0 |
| FTS5 `trigram` | ✅ 1 | ❌ 0 | ❌ 0 |

原因：`unicode61` 把整段中文当一个 token；`trigram` 要求查询 ≥3 字，**所有两字词都查不到**。

```text
入库：「知识库检索方案」→ 「知识 识库 库检 检索 索方 方案」
查询：同样切 bigram 后 MATCH
英文/数字：保留原词，不切
```

### 6.2 向量

| 项 | 选择 | 依据 |
|---|---|---|
| 模型 | Ark `doubao-embedding-vision-250328` | 现有 plan key 实测 200，**2048 维**，图文同空间 |
| 存储 | `chunk_vec.vec` BLOB（Float32） | >5 万 chunk 再考虑 int8（约 1/4 体积） |
| 检索 | JS 暴力 cosine | 实测 20k×1024 = 14–18ms；2048 维约 30ms |
| ANN | 暂不引入 | `node:sqlite` 的 `loadExtension` 已实测可用，真到 20 万级再挂 `sqlite-vec` |

维度 2048 的存储估算：2 万 chunk ≈ 164MB（float32）/ ≈ 41MB（int8）。

### 6.3 运行时

`node:sqlite` 是 Electron 45（Node 24.22.2）内置模块，**实测 FTS5 可用、可 `loadExtension`**。因此：

- 不引入 `better-sqlite3`，不需要原生编译；
- 主进程依赖只剩 `node-pty / adm-zip` 两个；`harness.db` 也改用 `node:sqlite`，`ARCH-package-size.md` 已同步。

---

## 7. 检索与引用

### 7.1 检索

```text
FTS top 30（bigram）  +  向量 top 30  →  RRF(k=60)
  →  同文档相邻 chunk 合并、同分只留最高
  →  按库 / 类型 / 标签 / 时间过滤
  →  top 5–8 注入 Agent
```

**FTS 查询必须用 `OR` 连接 token**：FTS5 的空格分隔是 AND，一句自然语言问题会被要求「所有词都出现」，几乎必然 0 命中。实现见 `search.mjs`（token 上限 24，排序交给 bm25）。

- 默认**不做 rerank**；缺口时用 Ark chat listwise（对 top 20 一次判定），不引入第三方 rerank key；
- 无结果时明确返回「材料里没有」，不拼接无关片段。

### 7.2 引用

```text
资料：[doc:<doc_id> · <文件名> · p<页>]
页面：[[<页面标题>]]
```

- 每条结论至少一个引用；没有就标「未在材料中找到依据」；
- 引用**只能来自候选集**，模型不得编造；
- 引用快照存 `citations(quote, locator)`，原文档删除后仍可追溯。

### 7.2.1 引用写回（资料 → 页面）

`knowledge_cite(page_id, doc_id, page, quote)` 三件事：

1. **准备 notes source**：uri 用文档原路径，`wiki.importSource` 自带按 uri/content 去重，不会重复建；
2. **走插件既有写入**：`wiki.addCitation(pageId, sourceId, quote, locator)` —— 页面 UI 直接可见，reviewed 仍然不能被静默覆盖；
3. **kb.db 记快照**：`citations(from_kind='page', from_id, to_id=doc_id, page_no, chunk_id, quote, locator)`。

删除资料时按两条线一起标 stale：`citations` 快照里的 `from_id`（精确）+ 老规则的 uri/标题匹配（兜底）。

> 两个已修的坑：① `wiki.list` 的 `citations` 是**数量**不是数组，旧逻辑 `cites.length` 永远 falsy → 一条都不会标 stale；② `wiki.savePage` 原先把未知 status 一律改回 `draft`，导致「标 stale」被静默吞掉——现在只放行 `stale`，`reviewed` 仍必须走审核流。

### 7.3 页图与图片

- **页图**：引用跳到页之后可以「看原页」——PDF 用 `pdfjs-dist(legacy) + @napi-rs/canvas` 按需渲染 PNG，落盘缓存 `files/<doc_id>/p<n>.png`，二次打开不再渲染；超过 3MB 自动降一档分辨率；
- 不走 `unpdf.renderPageAsImage`：Node 24 下它内部 transfer 会抛「Cannot transfer object of unsupported type」；
- 图片源（png/jpg/webp…）直接返回原图，不渲染；
- 检索返回「图注 + 缩略图 + 所属页」，Agent 上下文只放图注与 id，不塞二进制；
- 聊天里以缩略图展示，点开看原图与所在页。

### 7.3.1 图文同空间与成本红线

**「图文同空间」不是自研能力，是换一个多模态 embedding 模型**（`doubao-embedding-vision-250328`，图文都是 2048 维）。工程侧只保证三件事：同一模型、同一维度、同一份 `space` 标识。

**实测成本（同一把 plan key，长边不同的同一张 A4 页图）**：

| 输入 | prompt tokens | 相对文本 chunk（~300） |
|---|---:|---:|
| 980 px 整页渲染 | **19,738** | 65× |
| 512 px | 9,295 | 30× |
| 256 px | 3,297 | 11× |
| 文本一段 | ~300 | 1× |

结论与红线：

1. **整页图绝不进向量**——1000 页资料就是 2000 万 tokens，只为「能搜到图」；
2. **默认 caption-first**：VLM 生成图注 → 图注走文本 embedding；页图只做展示与引用跳转；
3. **「以图搜图 / 找相似版式」才开图像向量**：只 embed 图片裁块，长边 ≤ 384px，做成开关；
4. 请求格式：`input` 必须是**字符串数组**，图片用 `data:image/png;base64,...` 整串；传 `{"type":"image_url",...}` 会 400；
5. 向量必须带 `space`（模型标识），换模型 = 该 space 全量重建，否则维度相同的旧向量会**静默混用**。

---

## 8. 模型与密钥

**全部走同一把 Ark plan key**（现有），实测结论如下：

| 用途 | 端点 | 模型 | 实测 |
|---|---|---|---|
| 问答 / 汇总 | `/api/plan/v3/chat/completions` | `deepseek-v4-flash` | ✅ 200 |
| VLM OCR / 图注 / listwise rerank | 同上 | `doubao-seed-2.1-turbo` | ✅ 200 |
| embedding（文本 + 图片） | `/api/plan/v3/embeddings` | `doubao-embedding-vision-250328` | ✅ 200，2048 维 |
| rerank API | — | — | ❌ 7 个模型名全 404 |
| 标准 OpenAPI `/api/v3` | — | — | ❌ 401（plan key 不通用） |

注意：

- text embedding 系列（`doubao-embedding-text-*` / `-large-text-*`）在 plan 网关**不可用**，只用 vision 那个；
- key 存 `safeStorage`，不写 `.env`、不进日志；
- 每类调用单独计数，设置页可见成本。

---

## 9. Harness 接入

### 9.1 MCP：只读

知识工具挂在既有的 `electron/wiki-mcp-bridge.mjs` 上（与 wiki / memory / persona 同一座桥、同一个 per-run 子进程与 token 鉴权）：

```text
knowledge_search  knowledge_ask  knowledge_docs  knowledge_read
```

| 工具 | 返回 | 说明 |
|---|---|---|
| `knowledge_search` | chunk 命中（doc / 页 / 标题 / 片段） | 只读，不走模型 |
| `knowledge_ask` | 答案 + 引用（`kind: page / doc`） | `scope` = `all`（默认）/ `pages` / `docs`；页面侧候选来自 wiki 搜索 |
| `knowledge_docs` | 资料清单（id / 标题 / 页数 / 状态 / 索引模式） | Agent 先知道有哪些材料 |
| `knowledge_read` | 某份资料的原文分页（`id` + 可选 `page`） | 核对引用的 ground truth |

- 每个 run 一个子进程，run 结束回收；
- 桥上同时暴露 wiki / memory / persona 工具，token 由 `wikiMcpServers(runId)` 按 run 发放；
- 不放写入工具：写页面走 Notes 插件既有的 draft 通道。

### 9.2 知识页与菜单

```text
tabs   页面 · 来源 · 资料库 · 审核 · 本地 · 回收站
─────────────────────────────────────────────────
资料库 tab（嵌入，不再出现第二个页头）
  工具条  3 份资料 · 3 已索引        [＋ 导入] [粘贴文本] [⋯]
  左栏    范围（全部 / 已索引 / 解析中 / 需处理）+ 勾选决定检索
  主区    提问 → 回答 → 命中
  右栏    本次引用 / 解析与索引（一行摘要 + 配置）/ 规则
```

菜单规则：

- **一个页面只有一个页头**：嵌入时用与 tab 同高的工具条，不重复 `PageHeader`；
- 高频动作用按钮（`＋ 导入` / `粘贴文本` / `提问`），其余进 `⋯`，按「解析与索引 / 范围 / 状态」分组；
- **解析引擎与索引模式是低频配置**：收进 `⋯` 打开的弹层，右栏只留一行摘要；
- 行菜单分三组：查看（解析预览 / 就这份提问）· 索引（重新解析 / 加入或移出检索范围）· 危险（删除资料）；
- tab 命名区分职责：`来源` = 页面引用的原始输入；`资料库` = 导入的多格式材料；
- **解析引擎不是「集合」**：不要按 parser 分组冒充分类，左栏只做状态范围筛选；
- **知识库不提供记忆入口**：L4 注入、note、Dream 全在「记忆」页（`ARCH-memory.md`）；知识库只保留 `⋯` 里的「打开记忆页…」跳转；
- **引用可回原页**：资料引用跳到页后，页头有「看原页」，弹层看 PDF 渲染图；右栏引用卡也可直接「看原页」；
- **扫描件自动切图**：跳到 `warn` 页（无文本/纯图）时自动弹原页——那种页面上文字核对没有意义。

### 9.2.1 提问只有一个入口（问答交给 Chat）

- 页头不再放「问知识库」：问答属于 Chat，不属于资料库页。页头按钮改为 **「在 Chat 中问」** ——
  `harness:view=workspace` + `harness:chat-draft`，预填「只基于本地知识库回答，并给出页面引用（[[页面标题]]）」，
  用户可以追问、纠偏、交给 Agent 去做；
- 资料库页只做浏览与整理，「资料」tab 里保留的是**检索式问答**（范围三档 + 页码引用），不是聊天；
- 旧的 `wiki.ask`（抽句、无模型）保留 API 兼容，但不再有 UI 入口；
- 提问范围三档：`页面 + 资料`（默认）/ `只看页面` / `只看资料`；
- 检索范围三档：`页面 + 资料`（默认）/ `只看页面` / `只看资料`；
- 页面候选与资料候选**共用同一个引用编号**：`[1]` 可能指向页面、也可能指向资料的某一页；
- 引用渲染必须标类型（`页面` / `资料`）；点击按类型跳转：页面 → 打开页面；资料 → 打开页图。右栏引用卡另有次要动作「看原页 / 打开页面」，不等跳转；
- 不重复实现分块编辑器、图片库、图谱编辑器；
- 引擎面板：默认引擎（auto / 具体引擎）、每个引擎的可用状态与「探测」、端点 / 密钥 / 独立超时；自研引擎也在同一列表里；
- 资料行显示 `engine`（如 `mineru`、`paddleocr_vl`、`builtin`）与失败原因；
- 空态、解析中、失败、不可用四种状态都要有明确文案。

### 9.3 降级

- `knowledge_status`：`ready | degraded | unavailable`；
- 模型不可用 → 检索仍可走 FTS（**本地关键词不依赖网络**），UI 明示"已降级为关键词检索"；
- **不静默回落到其它来源**，避免引用错乱。

---

## 10. 与人像记忆、与记忆层的边界

| 问题 | 谁回答 |
|---|---|
| 材料里写了什么 | 知识（本文） |
| 我自己整理过的结论 | 知识（页面侧） |
| 做过什么、当时怎么判断的 | 记忆——L1 / L2（[`ARCH-memory.md`](ARCH-memory.md)） |
| 这个人随时间什么是真的 | 人像记忆 |
| 过去类似决定和结果 | 人像记忆 + 决策记录 |

- 本文的页面与资料就是**记忆四层里的 L3**；L4 注入目录由 `wiki.memory` 提供，上限 ≤12k；
- 同一个 `kb.db` 文件、**表完全隔离**；人像侧不读 chunk，知识侧不读 facts；
- 检索入口不共用：混在一起会让 Agent 把“他自己说过”当成“材料里写过”；
- 即时通信只接收摘要与引用，敏感内容出站过滤。

---

## 11. 隐私与安全

- 全部数据在本地；只绑本地进程，不起服务端口，不做端口转发；
- 模型 key 存 `safeStorage`；
- **每个库有 `index_mode`**：
  - `local-fts-only`：只做本地关键词检索，**一个字节不出网**；
  - `cloud-vector`：启用 Ark embedding，正文分块会发送到火山引擎（建索引阶段）。
- **默认 `local-fts-only`**：`createKnowledge({ embed })` 默认 `false`，开关是设置里的 `knowledgeCloudIndex`（设置 → 数据 → 出网边界），默认关；
- 开启前必须显式确认（设置页弹窗 + 资料页侧栏常驻「索引模式」说明），关闭后导入 / 检索都不再出网（已入库的向量留在库里，但不再被检索使用）；
- **key 只认自己配的**：`resolveArkKey` 只看显式传入和 `ARK_API_KEY`（设置 → 执行 → 模型密钥 / 环境变量），不再去读 `~/.pi/agent/models.json` 里别的应用的 key；
- 发给模型的内容只有本次命中的 5–8 个片段，不发送整库。

> **已定（A 案）**：资料侧云端向量可选且默认关，页面侧只做本地 FTS。`US-LLMWiki-06` 的「不上传整库」按「默认不开启、开启时明示会上传」执行，
> 回归用例在 `npm run knowledge:selftest` 的 `[1.5] 出网边界`：默认模式下 fetch 调用数必须为 0。

---

## 12. 评估

- 黄金问题集 30–50 条，覆盖：资料问答 / 页面问答 / 跨两侧 / 图片 / 无依据。
- 指标：recall@5、引用准确率、无依据识别率、p95 延迟。
- 必跑时机：换解析引擎、换 embedding 模型、升级 Electron（`node:sqlite` 与 FTS5 行为可能变）。
- 不达标不升级。

---

## 13. 备份与重建

1. 备份 = `kb.db` + `files/` + Notes vault 目录；
2. `kb.db` 可删；重建时全量重解析 + 重嵌入；
3. 导出 Markdown 目录作为可读副本（已有）；
4. 换 embedding 模型 → 必须重建，旧向量不兼容。

---

## 14. 里程碑与验收

### K0 底座（2 天）

`kb.db` DDL、`node:sqlite` 封装、bigram 切分、FTS5 验证、Ark 客户端（批处理/退避/计费）。

**验收**：20 条真实中文查询（含两字词）命中正确；`kb.db` 删除后可重建。

### K1 材料侧（2 天）

L1 解析矩阵、hash 去重、摄入状态机、`documents/chunks` 落库。

**验收**：20 份混合格式导入成功；重复导入被拦；失败可 reparse；切换 `mineru` / `paddleocr_vl` / `auto` 后路由与 `documents.engine` 正确；`npm run knowledge:engines:selftest` 全绿。

### K2 检索与引用（2 天）

向量 + RRF + 过滤；`[doc:… · p12]` 引用与页图跳转；MCP 白名单桥。

**验收**：任一回答可点回原文页；Agent 能调 `kb_search`、调不到写入工具。

### K3 页面侧收敛（1 天）

`pages/page_fts` 索引、统一搜索入口、`kb_ask` 混合回答、答案存 draft。

**验收**：一次查询同时命中资料与页面；答案可一键转 draft 并走 review。

### K4 后台任务（1 天）

去重 / 补引用 / 标过期，只产建议。

**验收**：reviewed 页面不被后台静默改写；source 变更后引用页自动 stale。

### K5 图片（2 天）

页图抽取、图注、vision embedding、图片库与预览。

**验收**：20 图 recall@5 达到设定基线。

**K0–K3 = 7 天；K4 = 8 天；K5 = 10 天。**

---

## 15. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 中文两字词检索失效 | 搜不到等于没做 | 必建 bigram；K0 就验 20 条真实查询 |
| 无 rerank | recall 上限偏低 | top_k 放大到 30 + RRF；不足再上 listwise |
| embedding 出网 | 隐私承诺变弱 | `index_mode` 分库；默认 `local-fts-only`（`knowledgeCloudIndex=false`），开启走设置页显式确认 |
| 解析质量（双栏 / 表格 / 扫描件） | 引用不准 | 20 份真实材料先测；不达标调 L3 判据，或用 MinerU / PaddleOCR-VL 覆盖 |
| 外部引擎不可达 | 导入失败 | 自动路由回退 `builtin`；显式指定引擎时明确报错，不静默换 |
| 云端引擎上传整份文件 | 隐私承诺变弱 | 默认 `builtin`；云端引擎必须手动配置 key/token，UI 明示"会上传" |
| 向量维度 2048 | 存储膨胀 | >5 万 chunk 转 int8；或换更小模型 |
| Electron 升级改 `node:sqlite` 行为 | 索引层失效 | 锁版本 + 升级跑 FTS5/cosine 契约测试 |
| 半份文档进索引 | 引用缺页 | embedding 按 doc 整份提交 |

---

## 16. 待定

1. `index_mode` 默认值：页面侧 `local-fts-only`、资料侧 `cloud-vector`？（§11 待拍板项）
2. 资料与页面是否共用一套标签？还是资料只读标签、页面可自定义？
3. 图片检索第一版就做（K5），还是等文本链路稳定？
4. 删除资料后，引用快照保留多久？
5. 是否需要连接器（飞书 / Notion / GitLab）？每接一个约 1 天。
6. 自研引擎的图片落盘（K5）：当前只把 markdown 里的相对图片引用带入索引，页图 / 图注 / vision embedding 仍按 K5 做。
