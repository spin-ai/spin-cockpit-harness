# LLM Wiki

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

当前有一个确定性的 dream pass：

```text
wiki.dream
  → missing-citation
  → stale-draft
  → duplicate-title
  → 重新生成 Memory 索引
```

它只产出维护项，不自动修改 reviewed 页面。后续的 LLM Dreaming 会读 session transcript、对照 source 检查 claim、生成 revision + diff，再进入 Review 队列——仍然不自动 reviewed。

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
