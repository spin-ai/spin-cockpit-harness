# Plugin · Native LLM Wiki

> **状态：P0 已实现（原生 Wiki 数据 + UI），P1 进行中。**
> Notes 不再是 vault-first 的 Obsidian 文件浏览器；它现在是一个 **原生 LLM Wiki**：Source → Page → Citation → Review → Query。本地 Markdown 目录仍可作为可选适配器打开、编辑，并导入为 Source。
> 插件宿主见 [`ARCH-plugins.md`](ARCH-plugins.md)。

---

## 0. 一句话

**Wiki = Source + Page + Citation + Review，不依赖外部 vault。**

Obsidian / Logseq 的 Markdown 可以作为导入/导出格式，也可以通过「打开目录」直接浏览和编辑；但它不是核心存储模型。

---

## 1. 为什么不做 vault-first

原方案的问题：

- 文件路径就是页面身份，结构化字段只能塞 frontmatter；
- source / page / citation / revision / review 都是“文件 + 约定”，无法做强关系；
- 文件 watcher 驱动索引，source 变化很难精确标记哪些页面过期；
- LLM 写文件容易覆盖 reviewed 内容；
- 外部 vault 是用户资产，App 不应该把核心知识模型绑在它上面。

原生模型：

```text
Source      原始资料：文本 / Markdown / URL（后续 PDF、网页剪藏）
Page        LLM 维护的 Wiki 页面
Citation    Page → Source 的引用
Revision    每次生成/编辑的版本
Review      draft / reviewed / stale
```

---

## 2. 数据模型

当前实现使用插件私有 `wiki.json`（可迁移到 SQLite；接口不变）：

```text
sources
  id, title, kind(text|url|markdown), uri,
  content, hash, createdAt

pages
  id, slug, title, summary, content,
  status(draft|reviewed|stale), confidence,
  createdAt, updatedAt, reviewedAt

citations
  id, pageId, sourceId, quote, locator, createdAt

revisions
  id, pageId, content, status, reason, createdAt

reviews
  id, pageId, status, feedback, createdAt

log
  id, kind, text, at

layout
  tabs / split / active / ratio

vaultPath
  可选的本地 Markdown 目录；只做文件适配器，不改变 Source / Page 模型
```

### 页面状态

```text
draft        LLM 生成 / 人工编辑，待审核
reviewed     已审核，默认不允许 LLM 静默覆盖
stale        source 发生变化，需要重新整理
```

### Citation

每条关键结论应绑定 source：

```text
page.citations[] → source
```

后续可以升级到段落级：

```text
quote + locator（行号 / 段落 / 页码）
```

---

## 3. 插件 API

Renderer 通过 `pluginInvoke` 调用：

```text
wiki.status
wiki.list
wiki.getPage
wiki.createPage
wiki.savePage
wiki.review
wiki.deletePage
wiki.importSource
wiki.importUrl
wiki.sources
wiki.source
wiki.addCitation
wiki.markStale
wiki.clearStale
wiki.revisions
wiki.revision
wiki.revert
wiki.reviews
wiki.dismissDream
wiki.ask
wiki.reviewQueue
wiki.search
wiki.graph
wiki.layout.get
wiki.layout.set
wiki.log
wiki.createTask
wiki.upsertDraft

wiki.vault.get
wiki.vault.pick
wiki.vault.open
wiki.vault.file
wiki.vault.save
wiki.vault.reveal
wiki.vault.importSource
```

### Agent tools

插件通过 MCP bridge 暴露给 dsh：

```text
wiki_search
wiki_list_sources
wiki_read_source
wiki_read_page
wiki_upsert_draft
wiki_add_citation
wiki_ask
```

约束（代码强制）：

- 只能写 draft；
- **不能覆盖 reviewed 页面**：`wiki_upsert_draft` 命中 reviewed 会直接报错，必须由人工先退回 draft；
- **写入必须带至少 1 个有效 source_ids**：空数组或无效 id 都会报错（先 `wiki_list_sources`）；
- 人工编辑 reviewed 页面会回到 draft，并写 `reopenReason=edited-after-review`（UI 显示「改过 · 待重新审核」）；
- 所有写入追加 log/revision；
- 读 source 内容视为不可信数据。

### 3.5 Memory hierarchy

当前已有一个小型 top layer：

```text
wiki.memory → MEMORY 索引（最多 12k chars）
  ├─ page 数 / source 数 / draft / stale
  ├─ reviewed / 最近更新页面优先
  └─ 标题 + summary + citation 数
```

- 每次普通 Chat run / Mission worker run 启动时注入这个小索引；
- Agent 需要详情时再用 `wiki_search` / `wiki_read_page`；
- UI 顶部「记忆」可查看同一份索引；
- 不把全部 wiki 全文塞进 prompt，控制 token。

这与 Anthropic 文章里的 “top layer 小、详情下沉、wiki + search” 对齐。

### 3.6 Dreaming

当前有 **deterministic dream pass**：

```text
wiki.dream
  → missing-citation
  → stale-draft
  → duplicate-title
  → 生成新的 Memory 索引
```

它只产出维护项，不自动修改 reviewed 页面。UI 在 Memory 面板点 Dream 打开「维护项」列表：缺引用 / 久放草稿 / 标题重复，可跳到页面处理或「忽略」（忽略记录在 `dreamDismissed`，不再重复提示）。

LLM Dreaming（后续）：

- 读 session/run transcript；
- 对照 source 检查 claim；
- 合并重复页面 / 修复链接 / 剪枝；
- 生成 revision + diff，进入 Review 队列；
- 不自动 reviewed。

---

## 4. LLM Wiki 工作流

```text
导入 Source
  ↓
Curator 计划
  ↓
wiki_upsert_draft（带 source_ids）
  ↓
Review：接受 / 退回
  ↓
reviewed
  ↓
source 变化 → stale → 重新整理
```

### 4.1 导入

UI 支持：

- 文本 / Markdown
- URL（抓取正文）
- **本地目录**：打开一个 Markdown 目录，左侧「本地」按文件夹列出文件；可直接编辑并写回，也可「导入为 Source」
- 后续：PDF、网页剪藏、文件批量导入

Source 不变；page 是派生知识。本地文件是用户资产，不会被 App 改写为 Wiki page，除非显式导入。

### 4.2 Curator

用户在 Source 面板点「发送到 Chat 整理」：

- 把 source 内容和工具说明放进 Chat；
- Agent 先搜索已有页面；
- 用 `wiki_upsert_draft` 创建/更新 draft；
- 用 `wiki_add_citation` 绑定 source；
- 不自动 reviewed。

### 4.3 Review

页面工具栏：

- 接受 → reviewed
- 退回 → 保持 draft + review feedback
- 编辑 → 保存 draft

### 4.4 Stale

已实现：source hash 变化 / source 被删除时，自动找到引用它的页面并标记 `stale`：

- `importSource` 命中同一 uri/hash 且内容变化 → 引用页面 `stale`，`staleReason=source-updated`
- `deleteSource` → 引用页面 `stale`，`staleReason=source-deleted`
- 页面保留原正文，只改状态；`clearStale`（「确认仍有效」）恢复到过期前的状态（通常 reviewed）
- 也可 `markStale` 手动标记；每次状态变化都写 revision + log
- 「生成新 draft + diff」仍走 #10（revision 历史）

---

## 5. UI

```text
Wiki
├─ 左侧：页面 / 资料 / 审核 / 本地
├─ 中间：页面 tabs + 阅读/编辑 + 分屏
└─ 右侧：Status / Citations / Backlinks / Linked Todos
```

### 左侧

- **页面**：标题、draft/reviewed/stale
- **资料**：source 列表、引用数
- **审核**：待审核 draft
- **本地**：打开 / 更换本地 Markdown 目录，按文件夹列出 `.md`；点击直接编辑并写回磁盘
- 搜索：页面 / source / 本地文件名
- 最近 wiki log

### 中间

- 页面 tabs
- 阅读 / CodeMirror 编辑
- `[[Page]]` 内部链接
- 分屏 + 可拖拽比例
- 页面状态 / citations 数
- 编辑模式可直接改标题；保存时同时写回 title / summary

#### 编辑器

- Markdown 工具栏：撤销/重做、H1–H3、粗体/斜体/删除线、行内代码、列表/任务/引用、代码块、Wiki 链接、链接、表格、分隔线、查找替换
- 快捷键：`⌘B` / `⌘I` / `⌘K` 链接 / `⇧⌘K` Wiki 链接 / `⌘S` 保存 / `⌘F` 查找
- Markdown 行为：回车续写列表/引用、退格删除标记、Tab / Shift-Tab 缩进
- `[[` 触发页面补全，`#` 触发 tag 补全
- 编辑器颜色和高亮跟随当前主题（含终端风格主题）
- 底部/工具栏显示词数、字数、选区长度、保存状态

### 右侧

- Status：draft / reviewed / stale
- Citations：source 列表 + 添加引用
- Backlinks
- Linked Todos

### 图谱

- Page / Source 节点
- citation / page link 边
- 本地文件不进入图谱，除非导入为 Source
- 力导向布局
- 点击节点打开页面

---

## 6. 打包与安装

Wiki 是 **内置 first-party 插件**：

```text
plugins/notes/plugin.json
plugins/notes/main.mjs
```

随 App 提供，不需要用户额外安装 `.cockpit-plugin`。第三方插件仍可通过 Settings → 插件安装。

---

## 7. 当前限制

已实现：

- 原生 source/page/citation/review 数据
- CodeMirror 编辑 + Markdown 工具栏 / 快捷键 / 查找替换 / 列表续写
- 标题与摘要编辑回写
- 多 tab / 分屏 / 布局恢复
- 搜索 / backlinks / graph
- Review 接受/退回
- 任务 / Chat 联动
- Wiki MCP tools
- 本地 Markdown 目录：打开 / 编辑写回 / 导入为 Source / Finder 定位

未实现：

- PDF / 网页正文抽取打磨
- 语义搜索 / embedding
- 导出 Markdown / 导入 Obsidian
- 多 Wiki / 团队协作

---

## 8. 分期

### P0（已实现）

- 原生 Wiki store
- Source 导入（文本 / URL）
- Page CRUD
- Citation
- Review
- UI 以 Wiki 为主，保留本地 Markdown 目录适配器（打开 / 编辑 / 导入 Source）
- Wiki MCP tools

### P1

- source hash / stale（已完成）
- revision diff（已完成）
- citation 检查
- Review queue 体验
- 图谱过滤
- Query Chat（已完成，覆盖页面 + 资料）

### P2

- PDF / 网页剪藏
- 语义搜索 / embedding
- 批量导入
- 导出 Markdown / Obsidian 导入
- 多 Wiki
