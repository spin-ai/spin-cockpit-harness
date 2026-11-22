> 层：需求 · 状态：记录 · 核对：2026-11-22 · 覆盖：知识与记忆的用户故事级对照，对象是 WeKnora 与 Anthropic 的记忆机制，附 ZCode 参照

# 竞品对照 · 知识与记忆专项

**一句话结论**：这三个东西不是同一层，别放一张表里比大小 ——

- **WeKnora** 是**知识基础设施**：租户 / 多引擎解析 / 分块编辑 / 混合检索 + GraphRAG / 评估 / MCP 服务。它管"把材料变成可检索的证据"。
- **Anthropic 的记忆**是**机制的最小实现**：应用层一段可编辑 summary、Claude Code 的 `CLAUDE.md` + auto memory、API 的 `/memories` 目录工具。它管"跨会话该带什么进来"。
- **本项目**两头都自己长：知识走 Source → Page → Citation → Review → Revision → stale 闭环，记忆走四层 + 失效链 + Dream。它管"证据变成可审核的结论，经验变成可追溯的注入"。

所以本文的用法是**校准边界**，不是选型：判断"这件事我们做对了没有、还差哪一条"，而不是"要不要换成它们"。
（本项目已经明确否决过引入 WeKnora，见 [`ARCH-knowledge.md`](../arch/ARCH-knowledge.md) §0.1 的决策记录。）

> 横向功能对照（Orca / Multica / ZCode）见 [`COMPARE-user-stories.md`](COMPARE-user-stories.md)；本文只补这两块。
> 本项目的记忆设计见 [`ARCH-memory.md`](../arch/ARCH-memory.md)，知识设计见 [`ARCH-knowledge.md`](../arch/ARCH-knowledge.md)，检索评估见 [`ARCH-wiki-retrieval.md`](../arch/ARCH-wiki-retrieval.md)。

---

## 0. 口径与图例

| 项 | 说明 |
|---|---|
| 快照日期 | 2026-11-17 |
| 本项目依据 | 代码（`electron/knowledge/`、`electron/memory/index.mjs`、`plugins/notes/`）+ ARCH 状态头 |
| WeKnora 依据 | 官方文档 v0.9.0（`weknora.weixin.qq.com/docs`）+ GitHub README；源码副本 `third-part/WeKnora`（`1b3a1fe`，2026-11-20，git 忽略） |
| Anthropic 依据 | Claude 记忆产品说明（2025-09 起逐步开放）、Claude Code 记忆文档、官方 SDK 的 `memory_20250818` 类型定义 |
| 图例 | ✅ 原生 / ◐ 部分或需绕行 / ✗ 未提供 / ？ 官方材料没写明 |

**Anthropic 要分三处看**，混在一起就会得出错误结论：

| 形态 | 记忆是什么 | 谁能看 |
|---|---|---|
| Claude 应用记忆 | 一段 memory summary，按项目隔离 | 用户在设置里看到全文并可改；incognito 会话不写入 |
| Claude Code 记忆 | `CLAUDE.md`（人写的规则，四层作用域）+ auto memory（Claude 自己写的 `MEMORY.md` 索引 + 主题文件） | 纯 Markdown，`/memory` 可浏览、可编辑、可删 |
| API memory tool | 一个 `/memories` 目录，模型用 6 个命令读写 | 不给 UI：**存储、隔离、校验全由接入方实现** |

---

## 1. K 组 · 知识（本项目 vs WeKnora）

| # | 用户故事（判据） | Cockpit Harness | WeKnora |
|---|---|---|---|
| US-K01 | 各种材料都能吃进来（判据：文档/表格/网页/图片都能入库，失败可见、可重试） | ◐ md/txt/csv/json/html + pdf/docx/xlsx/pptx/epub 直抽；无音频、无 URL 抓取 | ✅ PDF/Word/PPT/Excel/EPUB/XMind/文本/URL/HTML-MHTML/图片/音频 |
| US-K02 | 扫描件与版式能处理（判据：能换解析引擎，抽不出来要明说） | ◐ 引擎注册与路由已落地（MinerU / PaddleOCR-VL / 自研 HTTP）；低字符密度降级到 VLM | ✅ builtin / MarkItDown / OpenDataLoader / MinerU 可选，可强制扫描件模式，表格首行表头开关 |
| US-K03 | 分块可以改（判据：能改正文、能重解析、改动有版本） | ◐ 分块可读、带 `page_no` + heading；无分块编辑与版本 | ✅ 自适应三档分块 + 分块编辑 + 版本历史 + 批量重解析 |
| US-K04 | 检索够准（判据：关键词 + 向量混合，有 rerank 与多跳） | ◐ bigram FTS5 + 向量 + RRF 融合；无 rerank；图谱不参与问答 | ✅ 混合检索 + rerank + 父子块 + GraphRAG（Neo4j + APOC） |
| US-K05 | 引用能回到原文（判据：答案 → 具体页/段，而不是只有文档 ID） | ◐ 引用只能来自候选集、指向 `source.id` + `page_no`；`blocks.json` 有 bbox 但不进索引 | ✅ SourceBlock 偏移把 markdown 片段映射回原文件位置（locator） |
| US-K06 | 检索质量能验收（判据：有固定题集与回归数） | ◐ 有 selftest 与 SAG2 评估提案，SAG2 未接入 | ✅ 端到端评估（recall、BLEU/ROUGE） |
| US-K07 | 资料能整理成可审核的页面（判据：草稿 → 审核 → 回滚，且能看出结论出自哪段材料） | ✅ Source/Page/Citation/Review + revision + stale 传播 | ◐ Wiki 页面有版本/回滚/来源标注（pipeline/agent/user/revert），**无审核状态机** |
| US-K08 | 实体关系参与检索（判据：多跳问题命中率高于纯向量） | ✗ 有 page/source/file 图谱，只做可见化 | ✅ 知识图谱在问答时沿关系补召回 |
| US-K09 | 知识能给别人用（判据：外部 Agent/IDE 通过标准协议只读） | ✅ `wiki-mcp-bridge` 只读白名单；写入必须带有效 `source_ids` | ✅ 内置 MCP Server（每工作区独立 endpoint/token/知识库范围/限流/工具分组）+ scoped API keys + CLI |
| US-K10 | 多人分权（判据：知识库级授权、空间隔离、审计） | ✗ 单人本地 | ✅ 租户/用户/角色/组织共享/知识库级权限/审计 |
| US-K11 | 资料变了结论跟着变（判据：源更新或删除时引用页标 stale） | ✅ source 更新/删除 → 引用页面 stale | ◐ 有重新解析与文档偏好；未见 stale 传播语义 |
| US-K12 | Agent 不能覆盖已审核结论（判据：越权写入被拒） | ✅ Agent 只能写 `draft`，`reviewed` 不可覆盖 | ◐ 有执行权限与审批、Wiki 可由 Agent 写，但不以"审核态"为中心 |

### 1.1 K 组差异解读

**不是同一层，所以结论是分工而不是胜负。**

1. **WeKnora 赢在"入口宽"**：音频、URL、MHTML、XMind、图片画廊、多引擎可换 —— 这是把它当**基础设施**重投入的结果。本项目的入口窄是刻意的（[`ARCH-key-tech.md`](../arch/ARCH-key-tech.md) ①：能直抽就直抽，抽不出再渲成图让模型读），窄换来的是零外部服务、零 Docker。
2. **本项目赢在"出口严"**：US-K07/K11/K12 三条（审核状态机、stale 传播、Agent 只能写 draft）WeKnora 都没有等价物 —— 它的 Wiki 有版本和回滚，但没有"谁批准了这条结论"。
3. **最能抄的一条是 US-K05**：WeKnora 的 `source_blocks` 把 markdown 片段按码点偏移映射回原文件位置。本项目引用停在"文档 + 页码"，用户点过去还得自己找。`blocks.json` 里已经有 bbox，缺的是把它接进检索结果。
4. **第二能抄的是 US-K03 的分块编辑**：解析错一行就整篇不可用，是本项目现在最疼的失败模式（`ARCH-knowledge` §2 已记 K2–K5 待实施）。
5. **US-K06 是我们自己写进提案但没接的**（[`ARCH-wiki-retrieval.md`](../arch/ARCH-wiki-retrieval.md)）：WeKnora 已经把 recall / BLEU / ROUGE 做成页面能力，我们还是脚本 + 提案。差距不在算法，在"有没有一个能反复跑的题集"。

---

## 2. M 组 · 记忆（本项目 vs Anthropic / WeKnora / ZCode）

| # | 用户故事（判据） | Cockpit | Anthropic | WeKnora | ZCode |
|---|---|---|---|---|---|
| US-M01 | 记住什么有分类（判据：每类有自己的来源与用途） | ✅ 四层 + note 五类（rule/gotcha/guess/preference/decision） | ✅ 应用=1 段 summary；Code=4 类（user/feedback/project/reference）；API=无 schema | ✅ 五类（资料/偏好/事实/事项/兴趣） | ✅ 4 类（用户/反馈/项目/参考） |
| US-M02 | 谁来写（判据：人写的规则与机器写的经验分开） | ✅ Agent 写 note、人标 verified、Dream 校正 | ✅ Code：`CLAUDE.md` 人写 / auto memory 机器写，明确分开 | ✅ `explicit_only` 与 `auto`（后台抽取，可配延迟与最短间隔） | ✅ 后台在每轮后回顾并写事实文件 |
| US-M03 | 注入有预算与排序（判据：不挤爆上下文，能解释为什么是它） | ✅ 全局 L4 ≤12k；bot 视角 8k + 本轮 query 相关度上浮 + `inject_log` 回填命中率 | ◐ Code：`MEMORY.md` 前 200 行或 25KB + 主题文件按需读；应用：summary 全量 | ◐ 向量召回 + `retrieval_conditioning` 影响问题理解与文档排序 | ◐ `MEMORY.md` 索引自动加载，有大小上限 |
| US-M04 | 人能看、改、删、导出（判据：不是黑箱） | ✅ Memory 页 + note 编辑 + 导出 Markdown | ✅ 应用：设置里看/改 summary，可导入导出迁移；Code：`/memory` + 纯文件；API：宿主自理 | ✅ 个人记忆管理 + 导出 JSON + 清空 + 管理员接口 | ◐ 可在对话里"记住/忘掉"或手改磁盘文件，**无 App 内管理页** |
| US-M05 | 猜测必须过人（判据：推断不确认就不生效，拒绝留有记录） | ◐ note 有 `confidence` + Dream 建议队列需人批准；**无 pending 态** | ✗ 无 pending 概念（直接写文件 / 直接进 summary） | ✅ pending → 确认/拒绝，拒绝留抑制记录 | ◐ 抽取后直接写文件，靠人事后清理 |
| US-M06 | 记错了能改（判据：新事实替代旧事实，能回看当时认知） | ✅ `invalid_at / superseded_by / supersedes` + `entryAsOf` 回看 | ◐ 应用：改 summary；Code：让 Claude 自己改条目 | ✅ 同主题新事实替代旧事实 + 到期归档 + 整理合并 | ◐ 让 Agent 改 / 手改文件 |
| US-M07 | 该忘的忘（判据：有 TTL，清空不能被杀回来的脏数据污染） | ◐ 按类 TTL（rule/decision 不过期，gotcha 180 天，preference 90，guess 14）+ Dream 剪枝；**清空无代次隔离** | ◐ 应用：关开关/删记忆；Code：`cleanupPeriodDays` 明确**排除** memory 文件 | ✅ 到期归档 + 清空时切换写入代次（阻止旧提取写回） | ◐ 关闭只对新会话生效，旧记忆留着 |
| US-M08 | 隔离边界清楚（判据：知道这条记忆属于谁、属于哪个项目） | ✗ **全局一份**：note 没有项目维度 | ✅ 应用按项目；Code 按 git 仓库（同仓 worktree 共享）、机器本地不跨机；API 由宿主按用户隔离 | ✅ 按工作空间 + 调用者身份（含无账号的 IM/嵌入访客）+ 智能体级开关 | ✅ 按项目（workspace）隔离，远程工作区不支持 |
| US-M09 | 隐私可控（判据：能 opt-out、能审计、正文不进日志） | ◐ 本地 SQLite + `verify:privacy` 守卫；无审计视图 | ✅ incognito 会话不写入；企业可整组织关闭；导出/导入可迁移 | ✅ 空间/个人/请求三级开关 + 审计只记元数据不复制正文 | ✅ 默认关闭，本地 Markdown，可删目录完全重置 |
| US-M10 | 记忆与知识分工明确（判据：不形成第三套事实源） | ✅ 记忆管层次与流动，知识管对象与检索，人像不共享 L2–L4 | ◐ Code：`CLAUDE.md`（规则）vs auto memory（经验）vs 仓库代码，边界清楚但无审核 | ◐ 记忆与知识库同库，靠"文档偏好/主题"挂钩检索，边界偏检索优化 | ◐ Memory 与 Wiki 分开，Wiki 是代码导读，Memory 是偏好 |

### 2.1 M 组差异解读

**一句话：我们的语义设计比 Anthropic 细，但闸门和边界比 WeKnora 松。**

1. **US-M05 是最该补的一条（结构性）**。WeKnora 的 pending → 确认/拒绝，把"模型推断"与"可用记忆"隔了一道闸；被拒还留抑制记录，避免反复提取同一条错东西。本项目 note 一写就进注入候选，只靠 `confidence` 排序和 Dream 事后建议 —— **错了是先污染一版回答，再被人发现**。
2. **US-M08 是最该补的一条（低成本）**。Anthropic 按 repo、WeKnora 按身份、ZCode 按项目，本项目 note 表里连 `project_id` 都没有：在 A 项目学到的偏好会带进 B 项目。对一个"多项目工作台"来说这条比缺 GraphRAG 更违和。
3. **US-M07 值得抄"代次隔离"**。WeKnora 清空记忆时切换写入代次、推进历史水位，防止旧提取任务把清空前的内容再写回来。本项目的清空是 `DELETE`，正在跑的 Dream/抽取没有版本号可依。
4. **US-M03 我们反而是最讲究的**：Anthropic 的 summary 是全量注入，Code 是"索引前 200 行 + 主题文件按需读"；本项目做了打分注入 + 注入台账 + 命中率。这条不用改，别为了对齐而简化。
5. **US-M04 的分歧是产品选择**：Anthropic 三处都把记忆当"用户可见的文本资产"（可编辑、可导出迁移），WeKnora 更进一步有 JSON 导出与管理员接口。本项目有 Memory 页和 Markdown 导出，但没有"换机器/换工具带走记忆"的路径 —— 这与我们"不被锁定"的整体主张是一致的，值得补齐。
6. **Anthropic 那条 API 设计对我们是最强的架构背书**：`/memories` 目录 + 6 个命令（view / create / str_replace / insert / delete / rename）+ `view_range`，模型只会"读写文件"，存储、隔离、路径校验全由宿主负责。这正好是本项目"L1–L4 + SQLite/文件双写"的形状 —— **记忆不该被做成一个黑箱服务**。

---

## 3. 结论

### 3.1 已经做对的（不要为了对齐而改）

| 判断 | 依据 |
|---|---|
| 知识与记忆分成两套对象（L3 对象 vs L1–L4 流动） | 对照三家的"记忆塞进知识库"或"知识塞进记忆"，我们的边界最干净（US-M10） |
| 结论必须可审核（draft/reviewed + stale 传播） | WeKnora 的 Wiki 有版本无审核；这条是本项目最有护城河的地方（US-K07/K11/K12） |
| 记"这条从哪来"是硬约束 | `source_kind + source_id` 必填、Agent 写入必须带 citation，两家都是"尽量"（US-K12） |
| 注入要有预算与台账 | Anthropic 无台账；WeKnora 有召回无命中率（US-M03） |

### 3.2 该补的（按性价比）

| 优先 | 缺口 | 学谁 | 为什么现在补 |
|---|---|---|---|
| P0 | 记忆按项目隔离（US-M08） | Anthropic / WeKnora / ZCode | 加一个 `project_id` 就能做的事，不做会持续污染跨项目回答 |
| P0 | 推断过闸门（US-M05） | WeKnora pending | 现在是"先污染再发现"，成本最高的一种错 |
| P1 | 引用定位到原文块（US-K05） | WeKnora SourceBlock | `blocks.json` 已有 bbox，缺的是接进检索结果 |
| P1 | 分块可编辑 + 版本（US-K03） | WeKnora | 当前解析错一行 = 整篇不可用 |
| P2 | 清空的代次隔离（US-M07） | WeKnora | 与 Dream/抽取异步化绑定，越晚改越贵 |
| P2 | 检索验收题集（US-K06） | WeKnora 评估页 | 我们自己已经写了方案（SAG2 提案），缺的是执行 |

### 3.3 明确不学

1. **不引入 WeKnora 做知识底座**：4 条理由已写在 [`ARCH-knowledge.md`](../arch/ARCH-knowledge.md) §0.1（多服务、构建链、第三套事实源）。本次对照没有推翻它。
2. **不把记忆做成托管服务**：Anthropic 的 API 形态（模型读写普通文件、宿主负责隔离）与本项目一致，反过来做会丢掉"本地可编辑、可备份、可删"的全部好处。
3. **不追音频/多引擎解析矩阵**：那是一条持续维护的工程线，与本项目"零外部服务"的底座冲突；需要时用引擎注册 + 外部 HTTP 引擎接。

---

## 4. 来源与未核实项

**读过的官方材料（2026-11-17）**

- WeKnora：`weknora.weixin.qq.com/docs` — 知识库与知识管理 / 文档解析 docreader / Wiki 能力 / 知识图谱 / 跨会话长期记忆 / 检索与评估；GitHub `Tencent/WeKnora` README（v0.9.0）
- Anthropic：Claude 记忆产品说明（Bringing memory to Claude，2025-09-11，含 2025-10-23 扩量更新）；Claude Code 记忆文档（`code.claude.com/docs/en/memory`：`CLAUDE.md` 四级作用域 + auto memory 的 `MEMORY.md` / 主题文件 / 四类 / 200 行 25KB / 按仓库共享 / 机器本地 / 子智能体独立记忆）；官方 SDK 的 `BetaMemoryTool20250818` 类型（6 个命令与字段）
- 本项目：`electron/knowledge/parse.mjs`（三层降级与格式集）、`electron/knowledge/search.mjs`（FTS5 + 向量 + RRF）、`electron/memory/index.mjs`（note 五类 / TTL / 失效链 / 注入台账 / 导出）、`plugins/notes`（review / revision / stale）、`ARCH-knowledge.md` §0.1 决策记录

**明确未核实**

1. `docs.claude.com` 在本次网络环境被区域限制（返回 region unavailable），**API 记忆工具的规范正文没读到**：命令集与字段以 SDK 类型定义为准，"路径必须以 `/memories` 开头""路径穿越防护"这类正文约束未逐条核对。表中因此只写"目录 + 6 命令 + 宿主负责隔离"，不写细节规则。
2. Claude 应用记忆的存储规格（单条上限、条目数上限、summary 的长度预算）未见于公开材料。
3. WeKnora 记忆的召回准确率、评估口径（是否只评检索不评记忆）未见公开数字。
4. 本项目 Dream 语义 pass 的准确率没有数据（`ARCH-memory` 已标注），所以 US-M05 里"Dream 能兜住"只能算补偿，不能算闸门。

**怎么更新**：改结论时同步改 §3 与本日期；不要把"某家新增了某个功能"直接写进 US 行，先判断它改变的是**判据**还是**实现**。


---

## 2026-11-22 刷新（bot 记忆的增量）

- **按 bot 隔离**：`entries.owner` / `notes.owner` 支持 `bot:<id>`；注入与 `entrySearch` 都按「共享 + 自己」过滤。**仍没有项目维度**（US-M08 不变）。
- **预算与检索**：bot 单轮注入 2400 → **8000 字符**；`inject({ query })` 把本轮问题命中的条目上浮（只改排序，不改门槛）；台账 reason 标「命中本轮问题」。
- **整理**：到 80% 给归档候选（分数最低 / 最久未更新，置顶与 note 不动），一键归档到 60%；`entryArchive` / `entryRestore` 可恢复，不删除。自动合并 / diff 审阅仍未做。
- **写入纪律**：bot 只能写 `owner=bot:<id>` 的 note（`noteAdd`，不直写 L4）；密钥命中直接拒写。WeKnora 的 pending→确认→代次隔离仍是参照，不改变 US-M05/M07 的结论。
- **结论不变**：知识闭环与注入台账仍是本项目最强的一侧；项目隔离、清空代次隔离、可携带导出仍是缺口。
