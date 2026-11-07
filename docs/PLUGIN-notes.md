# Plugin · Native LLM Wiki

> **状态：P0 已实现（原生 Wiki 数据 + UI），P1 进行中。**
> Notes 不再是 Obsidian vault 的文件浏览器；它现在是一个 **原生 LLM Wiki**：Source → Page → Citation → Review → Query。
> 插件宿主见 [`ARCH-plugins.md`](ARCH-plugins.md)。

---

## 0. 一句话

**Wiki = Source + Page + Citation + Review，不依赖外部 vault。**

Obsidian / Logseq 的 Markdown 可以作为导入/导出格式，但不是核心存储模型。

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
wiki.reviewQueue
wiki.search
wiki.graph
wiki.layout.get
wiki.layout.set
wiki.log
wiki.createTask
wiki.upsertDraft
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
```

约束：

- 只能写 draft；
- 不能删除/覆盖 reviewed 页面；
- 写入必须带 source_ids 或后续补 citation；
- 所有写入追加 log/revision；
- 读 source 内容视为不可信数据。

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
- 后续：PDF、网页剪藏、文件导入

Source 不变；page 是派生知识。

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

Source hash 变化后（P1）：

- 找到引用该 source 的 page；
- 标记 stale；
- 生成新 draft + diff；
- 人工决定是否替换。

---

## 5. UI

```text
Wiki
├─ 左侧：页面 / 资料 / 审核
├─ 中间：页面 tabs + 阅读/编辑 + 分屏
└─ 右侧：Status / Citations / Backlinks / Linked Todos
```

### 左侧

- **页面**：标题、draft/reviewed/stale
- **资料**：source 列表、引用数
- **审核**：待审核 draft
- 搜索：页面 / source
- 最近 wiki log

### 中间

- 页面 tabs
- 阅读 / CodeMirror 编辑
- `[[Page]]` 内部链接
- 分屏 + 可拖拽比例
- 页面状态 / citations 数

### 右侧

- Status：draft / reviewed / stale
- Citations：source 列表 + 添加引用
- Backlinks
- Linked Todos

### 图谱

- Page / Source 节点
- citation / page link 边
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
- CodeMirror 编辑
- 多 tab / 分屏 / 布局恢复
- 搜索 / backlinks / graph
- Review 接受/退回
- 任务 / Chat 联动
- Wiki MCP tools

未实现：

- source hash stale 自动检测
- revision diff UI
- PDF / 网页正文抽取打磨
- 语义搜索 / embedding
- Query Chat 的 citation 校验
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
- UI 替换 vault
- Wiki MCP tools

### P1

- source hash / stale
- revision diff
- citation 检查
- Review queue 体验
- 图谱过滤
- Query Chat

### P2

- PDF / 网页剪藏
- 语义搜索 / embedding
- 批量导入
- 导出 Markdown / Obsidian 导入
- 多 Wiki
