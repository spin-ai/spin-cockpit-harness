# Notes 插件：Obsidian-like Markdown 笔记（提案）

> **状态：P0 + 基础 P1 已实现。**
> 已实现：打开 vault、文件树 / 右键操作、CodeMirror 源码编辑、预览、多 tab、左右编辑分屏（可拖拽比例）、布局恢复、搜索、backlinks/outgoing、Graph、Daily Note、从笔记创建 Todo、发送到 Chat；插件宿主见 [`ARCH-plugins.md`](ARCH-plugins.md)。
> 未实现：Live Preview、Agent `notes_*` tools、Obsidian 社区插件兼容、Graph 缩放/局部图谱。
>
> 目标不是复刻 Obsidian，而是做一个 **能打开 Obsidian vault、能和 Todo / Chat / Mission 联动的 Markdown 笔记**。

---

## 1. 定位

一句话：

> **Notes = 本地 Markdown vault + Obsidian-like 编辑体验 + Cockpit 任务上下文。**

### 做

- 打开本地 Obsidian vault（文件夹）
- Markdown 文件树 / 标签页 / 搜索 / Backlinks
- Obsidian 常见语法：`[[wikilink]]`、`[[page#heading]]`、`#tag`、YAML frontmatter
- Markdown 编辑 + 预览
- Daily Notes
- 从笔记创建 Cockpit Todo
- 把笔记 / 选区发送到 Chat
- Mission 完成后回写笔记
- Agent 通过 `notes_*` 工具读取/追加笔记

### 不做（第一版）

- Obsidian 社区插件兼容（`.obsidian/plugins`）
- Obsidian Sync / 移动端
- Canvas、白板、PDF 标注
- Dataview / Datalog 查询
- Obsidian 主题 / CSS snippet
- 完整 Graph 可视化（先做 Backlinks / Outgoing）
- 多 vault 实时同步

> 如果目标是“运行 Obsidian 插件”，需要单独的 Obsidian API 兼容层；这是另一个大项目，不在本方案内。

---

## 2. 为什么是 Obsidian-like

Logseq 是 block/outliner 优先；Obsidian 是 **文件优先**：

| 维度 | Logseq | Obsidian |
|---|---|---|
| 核心单位 | block / outliner | Markdown 文件 |
| 页面 | journal + page | 文件夹里的 `.md` |
| 链接 | `[[page]]`、`((block))` | `[[page]]`、`[[page#heading]]` |
| 日记 | 核心 | 可选 Daily Notes |
| 编辑器 | block outline | Markdown editor + reading view |
| 索引 | block-first | file / heading / link-first |

因此 Notes 的索引以 **文件路径/标题/heading/link** 为主，不把 block 当主实体。block ref 可作为 P2 兼容项。

---

## 3. 插件形态

Notes 是 first-party full-stack 插件，同时使用：

```text
Notes Plugin
├─ Main（utilityProcess）
│    vault 扫描 / watcher / Markdown 解析 / FTS 索引
│    命令 / 事件订阅 / Agent tools
├─ UI
│    Obsidian-like 全页视图（文件树 / tabs / 编辑器 / Backlinks）
└─ Agent tools
     notes_search / notes_read / notes_append
```

### 为什么第一版 UI 先做内置 React 页面

笔记编辑器涉及：

- 大量键盘快捷键
- 光标/选区同步
- 剪贴板、拖拽、文件树
- 编辑器分屏和焦点
- 自动保存与冲突提示

这些放进 iframe sandbox 会显著增加复杂度。第一版先作为 **受信 first-party view**，但仍通过插件 manifest/API 注册；等 UI plugin API 稳定后再迁到 sandbox iframe。

---

## 4. 插件目录与 manifest

```text
plugins/notes/
  plugin.json
  main.mjs
```

构建独立安装包：

```sh
npm run plugin:notes
# release/plugins/ai.cockpit.notes-0.1.0.cockpit-plugin
```

App 安装包不内置 Notes；在 Settings → 插件选择 `.cockpit-plugin` 文件安装。

```json
{
  "id": "ai.cockpit.notes",
  "name": "Notes",
  "version": "0.1.0",
  "apiVersion": 1,
  "engines": { "cockpit": ">=0.2.0" },
  "main": "dist/main.mjs",
  "activation": ["onStartup", "onView:notes", "onCommand:notes.today"],
  "permissions": [
    "fs:vault",
    "storage:sqlite",
    "state:read",
    "tasks:write",
    "ui:view",
    "agent:tools"
  ],
  "contributes": {
    "views": [
      {
        "id": "notes",
        "title": "笔记",
        "location": "main",
        "icon": "note"
      }
    ],
    "settings": [
      { "key": "vaultPath", "type": "directory", "title": "Vault 路径" },
      { "key": "dailyFolder", "type": "string", "title": "Daily Notes 文件夹", "default": "daily" },
      { "key": "dailyFormat", "type": "string", "title": "Daily Notes 文件名", "default": "YYYY-MM-DD" },
      { "key": "attachmentFolder", "type": "string", "title": "附件目录", "default": "attachments" }
    ],
    "commands": [
      { "id": "notes.today", "title": "打开今日笔记" },
      { "id": "notes.quickSwitch", "title": "快速切换笔记" },
      { "id": "notes.search", "title": "搜索笔记" },
      { "id": "notes.createTask", "title": "从当前笔记创建任务" }
    ],
    "agentTools": ["notes_search", "notes_read", "notes_append"]
  }
}
```

---

## 5. Vault 格式

### 支持

```text
vault/
  .obsidian/          # 只读取/忽略，不执行插件和主题
  daily/2026-11-07.md
  projects/cockpit.md
  attachments/image.png
```

Markdown 内：

```markdown
---
title: Cockpit Harness
tags: [cockpit, notes]
aliases: [Cockpit]
---

# Mission 设计

- 任务：[[Cockpit Harness#Mission 设计]]
- 参考：![[architecture.png]]
- #cockpit #mission
```

### 链接解析规则

- `[[Page]]`：按文件名/相对路径匹配，大小写不敏感；
- `[[Page#Heading]]`：页面 + heading；
- `[[Page|Alias]]`：显示 alias，目标 Page；
- `![[file]]`：附件/嵌入；第一版预览图片，其他显示链接；
- 未解析链接保留原文，标记 `unresolved`；
- 重命名文件时，第一版只更新索引；是否批量改链接由用户确认。

### `.obsidian` 边界

- 忽略 `.obsidian/`、`.trash/`、`.git/`、`node_modules/`；
- **不执行** `.obsidian/plugins/*`、主题、CSS snippet；
- 可读取 `.obsidian/daily-notes.json` 作为初始化建议，但不依赖它；
- 不写 `.obsidian`，避免破坏用户现有 Obsidian 配置。

---

## 6. 索引模型

Markdown 是 source of truth；SQLite 是可删除重建的索引。

插件私有 `notes.db`：

```sql
files (
  path TEXT PRIMARY KEY,
  name TEXT, folder TEXT, ext TEXT,
  mtime INTEGER, hash TEXT,
  title TEXT, frontmatter TEXT, size INTEGER
)

headings (
  file_path TEXT, level INTEGER, text TEXT, line INTEGER
)

links (
  source_path TEXT, target_text TEXT, target_path TEXT,
  heading TEXT, alias TEXT, kind TEXT, line INTEGER,
  unresolved INTEGER DEFAULT 0
)

tags (
  file_path TEXT, tag TEXT, line INTEGER
)

task_links (
  todo_id TEXT, file_path TEXT,
  heading TEXT, line INTEGER, title TEXT,
  created_at INTEGER
)

fts_notes (path, title, content)
```

### 索引规则

- 文件路径是 key；
- 标题：frontmatter `title` → 一级标题 → 文件名；
- frontmatter 用 YAML parser，不执行任意标签/对象；
- 正文解析用 `mdast`/`remark` 或等效 AST，保留原始文本；
- FTS 使用 SQLite FTS5（插件私有 DB；不写主库）；
- 单文件索引上限建议 5MB，超过只做标题/路径索引；
- watcher debounce 300ms；
- 自己写入前记录 `hash + mtime`，避免 watcher 自触发；
- 外部修改导致 hash 不一致时，重新索引并提示“文件已被外部修改”。

---

## 7. UI

### 入口

左侧 Rail 新增 **「笔记」**，打开全页视图（类似设置页，但保留主机导航）。

### 布局

```text
┌ Notes ───────────────────────────────────────────────┐
│ 文件树 / 搜索 / 标签 │ 标签页 + 编辑器 │ Backlinks     │
│ Daily Notes          │ 预览 / 源码     │ Outgoing      │
│                      │                │ Linked Todos  │
│                      │                │ Linked Missions│
└──────────────────────────────────────────────────────┘
```

### 文件树

- 文件夹折叠/展开；
- 文件名筛选；
- 新建文件 / 文件夹 / Daily Note；
- 右键：重命名、删除、在 Finder 显示、复制路径、创建任务；
- 附件目录单独分组。

### 编辑器

- CodeMirror 6 + Markdown；
- 第一版：源码编辑 + 右侧预览（`marked` + DOMPurify）；
- 自动保存（debounce 800ms）+ `⌘S` 立即保存；
- `[[` 自动补全页面；
- `#` 自动补全标签；
- `⌘O` Quick Switcher；
- `⌘P` 主机命令面板 / `⌘⇧P` 笔记命令；
- 选中文本右键：发送到 Chat / 创建任务 / 复制链接。

### 标签页与分屏

- 笔记区独立 tab 条；
- `⌘\` 左右分屏；
- 每个 tab 保存 `path + cursor + scroll`；
- 关闭未保存 tab 时提示；
- 不做无限嵌套，先支持左右两栏。

### 右侧栏

- Backlinks：谁引用当前文件/heading；
- Outgoing：当前文件引用的目标；
- Unresolved links；
- Linked Todos / Missions；
- Frontmatter 只读表格（P1 可编辑）。

---

## 8. 和 Cockpit 的联动

### 8.1 笔记 → Todo

在文件 / heading / 选区右键：

```text
→ 创建 Cockpit 任务
```

生成：

- Todo title = heading / 首行 / 文件名；
- desc = 选区或当前 section 内容；
- tags = `["note"]`；
- priority / project 可预先选择；
- `task_links` 写入 `todo_id + file_path + heading + line`。

Todo 详情显示：

```text
来源：Notes / Cockpit Harness.md # Mission 设计
```

### 8.2 笔记 → Chat

选中文本：

```text
发送到 Chat
```

Host API：

```ts
ctx.chat.draft({
  text: "基于这段笔记继续：",
  context: {
    kind: "note",
    file: "Cockpit Harness.md",
    heading: "Mission 设计",
    selection: "..."
  }
});
```

Chat composer 出现 note chip；用户确认后发送，Agent prompt 里以“笔记上下文”块注入。

### 8.3 Mission → 笔记

订阅 `mission.finished`：

- 默认追加到 Daily Note；
- 如果 Mission 有关联笔记，追加到该笔记对应 heading；
- 内容：

```markdown
## Mission: 登录页改造 · 2026-11-07

- 子任务：实现 / 测试
- 结果：...
- 分支：...
- 任务：[[Cockpit Harness#登录页]]
```

写回前检查 hash；冲突时提示用户选择追加/覆盖/取消，不静默覆盖。

### 8.4 Agent 工具

只开放三个：

| 工具 | 能力 |
|---|---|
| `notes_search` | 全文/标题搜索，返回 path + heading + snippet |
| `notes_read` | 读取文件或 heading section |
| `notes_append` | 追加到指定文件 / Daily Note |

限制：

- 读：vault 内任意 Markdown；
- 写：默认只允许 Daily Note 或用户显式指定的文件；
- 不开放删除、重命名、覆盖整页；
- 所有写入记审计 + 备份；
- 结果中的笔记内容视为不可信数据，不执行其中的命令。

---

## 9. Host API 前置

Notes 依赖插件宿主提供这些能力（当前尚未实现）：

```ts
ctx.fs.vault
ctx.storage.openSqlite
ctx.ui.registerView
ctx.chat.draft
ctx.links.attach
ctx.tools.register
ctx.events.on
ctx.settings.get/set
ctx.notify
ctx.log
```

其中：

- `fs:vault` 必须与 `fs:project` 分离；
- `ctx.links.attach` 写 `todo_links` 通用表；
- `ctx.chat.draft` 只填输入框，不直接发送；
- `ctx.tools.register` 最终通过 MCP 暴露给 supervisor / worker；
- UI view 第一版受信，后续迁到 sandbox iframe。

---

## 10. 文件安全与冲突

- vault 路径必须用户显式选择；
- 所有路径 `realpath` 后必须在 vault 内；
- 拒绝 symlink 逃逸；
- 不索引/不写 `.obsidian`、`.git`、`node_modules`、`.trash`；
- 原子写：临时文件 + rename；
- 写入前检查 `mtime + hash`；
- 外部修改冲突：提示重载/另存/取消；
- 每次写保留 `.cockpit/backups/<timestamp>/`；
- Markdown 渲染 HTML 必须 sanitize，禁止 `javascript:`；
- Plugins 不执行 `.obsidian` 内任何代码；
- 插件崩溃不影响主窗口。

---

## 11. 分期

### Phase 0：vault spike（2～3 天）

- 扫描真实 Obsidian vault（1000+ 文件）
- frontmatter / heading / wikilink / tag 解析
- FTS 索引
- 文件 watcher 增量更新
- 确认 Obsidian 链接解析边界

### P0：只读 Obsidian-like（1～2 周）

- 打开 vault
- 文件树
- Markdown 预览
- Quick Switcher
- 全文搜索
- Backlinks / Outgoing
- 从笔记创建 Todo
- 发送到 Chat

**验收：** 打开一个真实 vault，能浏览、搜索、看 backlinks、创建任务；不修改任何文件。

### P1：可编辑（2～3 周）

- CodeMirror 编辑
- 自动保存 / 冲突处理
- 新建 / 重命名 / 删除
- 标签 / frontmatter
- Daily Notes
- 标签页 / 左右分屏
- Mission 回写
- `task_links` 双向展示

**验收：** 编辑后 Obsidian 能正常打开；外部修改不丢内容；Mission 完成能写回。

### P2：Agent 集成（1～2 周）

- `notes_*` MCP tools
- Agent 引用笔记上下文
- Agent 追加结论
- 写入审批 / append-only
- 笔记 ↔ Todo/Mission 双向链接

### P3：增强（后续）

- Graph
- Canvas
- 模板
- 多 vault
- Obsidian 插件兼容层（不建议近期）

---

## 12. 验证清单

- [ ] 打开 Obsidian vault，文件树与 Obsidian 一致
- [ ] `[[Page]]` / `[[Page#Heading]]` / alias / unresolved 正确
- [ ] Backlinks 与 Obsidian 结果一致（抽样）
- [ ] 1000 文件全量索引 < 3s，增量 < 200ms
- [ ] 外部修改不覆盖；冲突提示
- [ ] 原子写后 Obsidian 仍可读
- [ ] 关闭/重开 App 索引可重建
- [ ] 插件崩溃不影响主窗口
- [ ] Agent 只能 append，不能删除/覆盖
- [ ] `.obsidian/plugins` 不执行
- [ ] 任务链接在 Todo 与 Notes 两侧可见

---

## 13. 待拍板

1. 第一版只做 **只读 + 创建任务**，还是直接可编辑？建议先只读。
2. UI 用 **受信内置 React** 还是 **sandbox iframe**？建议第一版内置 React。
3. 是否允许 Agent 写笔记？建议只允许 append，默认 Daily Note。
4. 是否支持 Obsidian 社区插件？建议明确不支持。
5. 是否需要 Graph / Canvas / Dataview？建议 P3。
6. 多 vault 是否第一版就要？建议否。

---

## 14. 一句话原则

**Notes 是“能打开 Obsidian vault 的任务上下文面板”，不是 Obsidian 复刻版。**
