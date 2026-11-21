# LLM Wiki

- 写作：停笔 1s 自动保存；页面 / 资料删除进回收站，可恢复或彻底删除；`⌘⇧K` 独立快捕小窗。
- 检索：中文按字模糊匹配、标题加权、命中高亮/定位、搜索历史与状态/时间/来源筛选。
- 双链：hover 摘要、红链创建、反链上下文、unlinked mentions、图谱按类型筛选。
- 问 Wiki：只检索本地页面/资料，抽句回答并带 `[[页面]]` 引用；无依据明确说没有；可存 draft。
- 迁移：本地 Markdown 全量导入；导出 Markdown 目录或当前页面 PDF。

> 不是聊天记录，也不是 Obsidian vault 浏览器。Wiki 是 Source → Page → Citation → Review 的可追溯知识库，Agent 能检索，人负责审核。

![LLM Wiki 封面](./wiki/cover-llm-wiki.png)

*图：笔记插件把资料整理成可审核的知识库；Agent 可检索、可写 draft。*

## 为什么不是 vault-first

一开始最容易做的方案，是把 Markdown 目录当 Wiki：

- 文件路径就是页面身份；
- source / page / citation / revision 只能塞 frontmatter；
- 文件 watcher 驱动索引，source 变化很难精确知道哪些页面过期；
- LLM 写文件容易覆盖 reviewed 内容；
- 外部 vault 是用户资产，App 不应该把核心知识模型绑在它上面。

所以 Notes 改成原生模型：**Source + Page + Citation + Review，不依赖外部 vault。** 本地 Markdown 目录仍然可以打开、编辑、导入为 Source，但它只是一个适配器。

![LLM Wiki 结构](./wiki/llm-wiki.svg)

*图：Source → Page → Citation → Review 的结构；Page 是派生知识，Source 是事实源。*

## 五个对象

| 对象 | 含义 |
|---|---|
| Source | 原始资料：文本 / Markdown / URL |
| Page | LLM 维护的 Wiki 页面 |
| Citation | Page 指向 Source 的引用 |
| Revision | 每次生成 / 编辑的版本 |
| Review | draft / reviewed / stale |

- **draft**：LLM 生成或人工编辑，待审核。
- **reviewed**：已审核，默认不允许 LLM 静默覆盖。
- **stale**：source 变了，需要重新整理。

## 一次整理

```text
导入 Source（文本 / Markdown / URL）
  → 在 Chat 里说「把这份资料整理成 Wiki」
  → Curator 用 wiki_search / wiki_read_source 读资料
  → wiki_upsert_draft 写 draft
  → wiki_add_citation 绑定 source
  → 人在 Review 队列里接受 / 退回
  → reviewed
```

关键约束：

- Agent 只能写 draft；
- reviewed 页面不会被静默覆盖；
- 写入追加 revision + log；
- 读 source 内容视为不可信数据。

## Agent 怎么用 Wiki

每次普通 Chat run / Mission worker run 启动时，会注入一个小型 Memory 索引（最多 12k 字符）：

```text
wiki.memory
  ├─ page / source 数
  ├─ draft / stale 数
  ├─ reviewed / 最近更新页面优先
  └─ 标题 + summary + citation 数
```

Agent 需要详情时，再调用：

```text
wiki_search
wiki_list_sources
wiki_read_source
wiki_read_page
wiki_upsert_draft
wiki_add_citation
```

这样既不把全部 Wiki 塞进 prompt，又能在需要时下钻。

![Memory 索引](./wiki/notes-memory.png)

*图：Memory 是顶层小索引；Agent 需要细节时再调用 wiki_search / wiki_read_page。*

## 维护：Dream pass

维护扫描是确定性的，结果进「审核」队列（人看过 diff 才写）：

```text
wiki.maintain
  → 漏引用（页面某行与资料某行高度重合，且还没引用它）
  → 疑似重复（标题几乎一样，或摘要高度重合）
  → 建议进 suggestions（引用只加出处；合并只生成草稿，原页面不动）
```

`wiki.dream` 只是它的兼容壳（默认 dry-run）。整理/模型整理/维护扫描都不直接改 `reviewed`；
人改过的句子会记成人工结论（claim），整理会动到它们时整页自动整理被拦下，改成待审建议。

## 写入闸门：建议与人工结论

整理的定位不是「自动改对」，而是把低置信度的改动变成**可审阅的建议**。

```text
wiki.curate（确定性，免费秒级）
   ├─ draft              → 直接写 + revision(curate:structure)
   └─ reviewed / stale   → 只产建议，不写盘
```

建议对象存在 `wiki-index.json` 的 `suggestions[]`（上限 120 条）：`kind = structure / summary / citation / merge / stale-fix`，存**完整渲染正文**（不是 diff 指令）+ `baseHash` + evidence。

闸门（每条都能被单测断言，不靠 prompt 自觉）：

1. 只动确定性、有界的部分：大纲 / 摘要行 / `## 要点` / `## 相关`；用户自己写的小节一律不动；
2. **不删人写的内容**：已有要点条目、夹在中间的非列表段落、手写 `[[相关]]` 原样保留；原页面每一行非标题正文都必须出现在整理结果里（`wiki:curate:selftest` 断言）；
3. 批准 = 纯字节拷贝（不重新调模型）+ revision；退回记 feedback；同类 30 天不重复打扰；
4. 页面在建议之后改过 → 标 `needs_rebase`，不自动合并。

**人工结论（claim）保住「人改的那一句」**：人保存已有页面时，把新增的行记成 claim（标题 / 摘要 / 纯双链 / 短句不算，单页上限 40）；整理若会改写或丢掉其中任一条，连 draft 都不自动写，改成待审建议。判定只有三档（原样 / 改写 / 不见），行级文本 + bigram，不依赖模型；`conflict` / `orphan` 会进「结论待确认」，解除只撤销锁定、不动正文。

另外两条硬边界：`wiki.upsertDraft`（Agent 通道）不能覆盖 `reviewed`，会直接拒绝并提示走审核；资料引用走 `knowledge_cite` 写 citation 快照，不让 Agent 伪造出处。

## UI

![Wiki 页面](./wiki/notes-wiki.png)

*图：笔记插件里的 Wiki 页面：状态、Citations、Backlinks 和 Memory 都在同一屏。*

- 左侧：页面 / 资料 / 图谱 / 本地目录。
- 中间：CodeMirror 编辑器 + 预览。
- 右侧：Status / Citations / Backlinks / Linked Todos。
- 顶部：Memory 索引、Review 队列、Dream、生成 Wiki。
- 页面之间用 `[[页面]]` 链接；图谱包含页面 / 资料 / 本地文件三类节点。

![Wiki 图谱](./wiki/notes-graph.png)

*图：页面、资料和引用关系可以直接在图谱里看。*

## 与另两条主线的关系

- **多智能体终端**：终端和 Chat 负责“把事做完”。
- **Super Agent**：Mission 负责“把多个子任务组织起来”。
- **LLM Wiki**：Wiki 负责“把做过的事沉淀成可检索、可审核的知识”。

三者共用同一套本地数据：任务、run、消息、Wiki、插件都在同一个工作台里。


## 存储：索引 + 分片

- `wiki-index.json`：页面 / 资料的轻量 metadata、引用、审核、收藏、最近、日志。
- `pages/<id>.md`、`sources/<id>.txt`：正文按 ID 分片；列表只读 metadata，打开单页才读对应分片。
- `wiki-search.json`：搜索索引，只在搜索 / 问 Wiki / 反链时读取。
- `revisions/<pageId>.ndjson`：修订历史单独追加，不进入索引。
- `wiki-trash.json`：回收站 metadata；删除时保留正文分片，恢复不丢内容，彻底删除才移除。
- 旧 `wiki.json` 首次启动自动迁移为 `wiki.json.bak`。

## 继续阅读

- [知识库](#/wiki/knowledge)：资料侧的解析 / 索引 / 检索与引用。
- [记忆与 Dream](#/wiki/memory)：页面之上的四层与维护扫描。
- [插件与 LLM Wiki](#/wiki/plugins)：插件宿主、Host API 与 MCP bridge。
