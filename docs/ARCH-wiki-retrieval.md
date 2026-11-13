# Wiki 检索架构与 SAG2 评估

> **状态**：设计评估（2026-11）。SAG2 尚未接入，本文只记录判断、边界与试点方案。
> **归属**：知识模块的整体设计见 [`ARCH-knowledge.md`](ARCH-knowledge.md)；本文只覆盖检索质量与 SAG2 评估。
> 相关：`PLUGIN-notes.md`（Wiki 数据/API）、`ARCH-notes-ux.md`（界面）、issue #15 / #18。

---

## 0. 一句话结论

**不把 SAG2 当作知识库主存储，也不为了"比 RAG 先进"而换架构；**
把它作为 `wiki.ask` 的可选检索后端做试点：先评测，再决定是否落地 SAG2-lite，最后才考虑本地 rerank。

理由：现有 Wiki 已经是「编译式知识 + 按需检索」（Source → Page → Citation → Review → Revision），
它在**可追溯、可审核、可回滚、查询成本**上明显优于裸 RAG；SAG2 补的是**大语料多跳证据召回**，
这是当前 `wiki.ask` 的真实短板，但不影响主存储与审核模型。

---

## 1. 当前检索链路

| 层 | 实现 | 文件 | 现状 |
|---|---|---|---|
| 存储 | `wiki-index.json` + `pages/<id>.md` + `sources/<id>.txt` + `wiki-search.json` | `plugins/notes/main.mjs` | 分片 + 轻量索引，按需读正文 |
| 搜索 | 关键词 + 中文按字 + 子序列模糊，标题加权 | `wiki.search` / `searchAll` | 单轮、字面为主 |
| 问答 | 2-gram 句子打分，页面 + 资料候选，引用只来自候选集 | `wiki.ask` | 单轮抽句，跨页多跳弱 |
| 图谱 | page / source / file 节点 + citation / `[[双链]]` 边 | `wiki.graph` | 结构可见，但不参与问答检索 |
| 记忆 | Memory 顶层索引（≤12k） | `wiki.memory` | 给 Agent 的小索引，不含全文 |
| Agent | `wiki_search` / `wiki_ask` / `wiki_read_page` / `wiki_read_source` … | `electron/wiki-mcp-bridge.mjs`、`electron/main.mjs` | 只读为主，写入必须带 citation |

已有的安全/质量边界（不能因为换检索而丢）：

- Agent 不能覆盖 `reviewed`，写入必须带有效 `source_ids`（#7）
- 引用只能存真实 `source.id`，可增删改（#8）
- source 更新 / 删除会让引用页面 `stale`（#9）
- 每次改动有 revision，可 diff / 回滚（#10）
- 答案引用必须来自候选集，无依据时 `found:false`（#12）

### 当前短板

1. `wiki.ask` 是单轮抽句：问题需要跨 3+ 资料时，召回不到全部证据。
2. 字面 / 2-gram 对同义改写泛化有限。
3. `wiki.graph` 有结构，但检索不利用它做多跳。

---

## 2. SAG2 是什么

来源：论文 [`arXiv:2610.22588`](https://arxiv.org/abs/2610.22588)，官方仓库 [`Zleap-AI/SAG-Benchmark`](https://github.com/Zleap-AI/SAG-Benchmark)（MIT，`sag2/` 为 Python 3.11 + `uv` + SQLite FTS5 排序扩展）。

### 2.1 机制

```
原文段落 ──► SQLite FTS5 + BM25 索引（无 embedding / 无离线 LLM / 无实体图）
                     │
问题 ──► BM25 检索 ──► 已选证据里的词项做查询扩展 ──► 再检索（多跳）
                     │
               JEV 对候选做证据判断/打分 ──► 多样性排序 ──► 前 K 段原文
```

- **建库零模型调用**：11,656 段建库 2.36s、25.87 MiB。
- **JEV 是模型调用**：默认走 JEV API；完全离线时换成**本地 reranker**（Qwen3-Reranker-0.6B / Jina v3.5）。
  所以"SAG2 不调模型"只对建库成立，检索阶段仍有模型。
- **Agentic SAG2**：LLM 把 SAG2 当工具，自行决定下一跳/停止/排序；效果更好，但需要模型 API 与多轮调用。

### 2.2 论文数据（1,000 题子集）

| 方法 | MuSiQue R@5 / R@10 | 2Wiki R@5 / R@10 | HotpotQA R@5 / R@10 |
|---|---:|---:|---:|
| SAG（原论文） | 80.36 / 83.37 | 93.34 / 93.57 | 96.50 / 97.70 |
| SAG2 | 80.68 / 86.62 | 97.35 / 97.43 | 98.45 / 99.00 |
| Agentic SAG2 | 92.20 / 95.39 | 99.88 / 99.88 | 99.30 / 99.65 |

另外：EnterpriseRAG-Bench（511,962 文档）文档 R@10 81.10%。

### 2.3 它不解决什么

- 不做知识编译/去重/结构化，不提供审核与引用绑定；
- 不保证答案正确，只保证"证据段落召回"；
- 评测集中在实体/多跳 QA，对开放式总结、观点类问题没有覆盖；
- 默认流程需要 Python 运行时；本地 rerank 需要下载模型权重。

---

## 3. 对比

| 维度 | 当前 Wiki | SAG2 |
|---|---|---|
| 知识形态 | 编译后的 Page + Source 原文 | 原文段落 |
| 索引 | 关键词 + 2-gram + 子序列 | FTS5 + BM25 |
| 多跳 | 靠 `[[双链]]` / citation / graph | 检索时证据驱动的词项扩展 |
| 证据判断 | 引用必须来自候选集（#12） | JEV / 本地 rerank |
| 查询时模型 | 无（本地抽句） | 默认 JEV，可换本地 reranker |
| 建库成本 | 导入即建，无模型 | 极低，无模型 |
| 人审 / 回滚 | reviewed + revision + stale | 无 |
| 运行时 | Node（Electron 内置） | Python 3.11 + uv + C 编译器；或 Node 重写 |

**结论：互补，不替代。** 我们保留 Page/Citation/Review/Revision；只在检索层引入 SAG2 的思路。

---

## 4. 决策

| 问题 | 决定 |
|---|---|
| 换掉 Wiki 存储 / 改成向量库？ | 否 |
| 把 SAG2 作为主检索？ | 否，先做可选策略 |
| 默认引入 Python sidecar？ | 否，先做 Node 版 SAG2-lite |
| 引入 embedding / 上传语料？ | 否（保持 local-first） |
| 本地 reranker 默认用 Jina？ | 否（CC BY-NC，非商用）；优先 Qwen3-Reranker-0.6B（Apache-2.0） |
| 检索结果能直接变 reviewed？ | 不能，只能写 draft 或作为答案引用 |

---

## 5. 试点方案

### Step 1 · 评测（不改架构）

交付：

- `docs/eval/wiki-ask.json`：20–30 题，覆盖单跳 / 多跳 / 负样本，标注期望页面或资料 id。
- `scripts/eval-wiki-ask.mjs`：调 `wiki.ask`（现有策略）逐题跑，输出指标。
- 可选对照：把 `sources` 导出成 SAG2 的 `[{title,text}]`，用官方 `search_local.py` 跑同一批题。

指标与门槛：

| 指标 | 说明 | 门槛 |
|---|---|---|
| hit@5 | 期望页面/资料出现在 citations 前 5 | 多跳题相对现状 +10% |
| citation precision | 引用里真实相关占比 | 不低于现状 |
| 负样本 | 无依据时 `found:false` | 100% |
| 延迟 | p50 | 不高于现状 2× |

> 如果 Step 1 赢不了，停止；把 #18 的预算放在分页/索引重建/保留策略上。

### Step 2 · SAG2-lite（纯 Node，不加依赖）

- 新模块 `plugins/notes/sag2.mjs`：
  - 复用现有搜索索引做 BM25（不引第三方库，避免打包体积）；
  - 用首轮 top 段落的证据词项做 1–2 轮查询扩展；
  - 证据打分先用现有关键词/引用覆盖启发式，等 Step 3 再换 rerank。
- `wiki.ask({ question, strategy: "local" | "sag2" })`，MCP `wiki_ask` 透传 `strategy`。
- 保持不变量：答案引用只来自候选集、无依据 `found:false`、只写 draft、不改 reviewed。
- 索引范围：**sources 原文段落**（Page 已编译，避免重复召回）；答案仍回填 Page 并走审核。

### Step 3 · 可选本地 rerank

只在 Step 2 证明"召回够、排序差"时启动：

- 优先 Qwen3-Reranker-0.6B（Apache-2.0）；
- 形态二选一：Python sidecar（贴近论文、重）或 ONNX/llama.cpp 本地推理（轻、要写胶水）；
- 打包前必须评估安装体积、首次下载、无 GPU 机器的延迟。

---

## 6. 不做什么

1. 不把 `wiki.json` / 分片存储换成 SAG2 的 SQLite（数据模型不变）。
2. 不让检索层直接写 `reviewed` 或跳过 citation（#7 / #12 的边界不变）。
3. 不默认打包 Python + 模型权重（先 Step 1/2）。
4. 不做"整库塞 prompt"或"每次查询重跑一遍全语料"。
5. 不为 SAG2 单独维护第二套页面/来源概念。

---

## 7. 与现有 issue 的关系

| Issue | 关系 |
|---|---|
| #15 采集能力 | SAG2 只吃"已导入的 sources"；PDF/网页/图片采集是它的上游 |
| #18 检索与规模 | Step 1/2 应并入 #18：embedding 可选项与 SAG2 策略二选一或并存 |
| #12 问 Wiki | 入口与引用校验已具备；SAG2 只替换 `ask` 的检索实现 |
| #10 / #9 / #7 | 审核、过期、写保护边界，SAG2 试点不得绕过 |

---

## 8. 参考资料

- 论文：<https://arxiv.org/abs/2610.22588>
- 仓库（MIT）：<https://github.com/Zleap-AI/SAG-Benchmark>
- 仓库文档：`sag2/docs/agentic.md`、`sag2/docs/local-rerank.md`
- 中文介绍（CSDN）：<https://blog.csdn.net/xx_nm98/article/details/170294978>（有反爬，建议以论文/仓库为准）
- 现有实现：`plugins/notes/main.mjs`（`searchAll` / `wiki.ask` / `wiki.graph`）、`electron/wiki-mcp-bridge.mjs`
