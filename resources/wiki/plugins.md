# 插件与 LLM Wiki

## 插件宿主

插件是受控的本地扩展：

```text
plugins/<id>/
  plugin.json    # 元数据、权限、命令、视图、事件
  main.mjs       # activate(context)
```

- 宿主在 `electron/plugins/host.mjs`；插件通过 `pluginInvoke` 暴露方法。
- 权限在 `plugin.json` 声明：`state:read` / `tasks:write` / `ui:view` / `agent:tools`。
- 内置插件随 App 分发；第三方插件可以从设置页安装。

> LLM Wiki 的产品视角见 [LLM Wiki](#/wiki/llm-wiki)。

## Notes：原生 LLM Wiki

![Wiki 页面](./wiki/notes-wiki.png)

*图：笔记插件里的 Wiki 页面；右侧是 Status / Citations / Backlinks / Linked Todos。*


Notes 不是 Obsidian vault 浏览器，而是 **Source → Page → Citation → Review** 的知识库：

| 对象 | 含义 |
|---|---|
| Source | 原始资料：文本 / Markdown / URL |
| Page | LLM 维护的 Wiki 页面，状态 draft / reviewed / stale |
| Citation | Page 指向 Source 的引用 |
| Revision | 每次生成 / 编辑的版本 |
| Review | 接受 / 退回 / stale 处理 |

Agent 只能写 draft；reviewed 页面不会被静默覆盖。写入会追加 revision 和 log。

后台整理**不直接改页面**，只写建议队列：

- `wiki.curate`（确定性、免费秒级）：draft 直接写并记 revision，`reviewed / stale` 只产建议；
- `wikiCurateLLM`：结果变成 `summary` 待审建议，缓存按整理前正文 hash 去重；
- `wiki.maintain`：漏引用 / 疑似重复进同一条建议队列，`wiki.dream` 是它的兼容壳；
- 建议带 `baseHash` + evidence，人看逐行 diff 才落盘；批准 = 字节拷贝；页面已改过 → `needs_rebase`；
- 人改过的句子记成**人工结论（claim）**，整理会动到它们时整页自动整理被拦下，改成待审建议；
- 页面进回收站 → claim 标 `orphan`，恢复时按正文重新核对。

资料侧的解析 / 索引 / 检索见 [知识库](#/wiki/knowledge)。

## MCP tools

Wiki / 知识库 / 记忆 / 画像共用一条 MCP bridge；每个 run 一个子进程 + 一个 token，run 结束回收：

![MCP bridge](./wiki/mcp-bridge.png)

*图：dsh / MCP 工具 ↔ 主进程 HTTP bridge ↔ 插件与领域动作。*

```text
Wiki      wiki_search · wiki_list_sources · wiki_read_source · wiki_read_page
          wiki_upsert_draft · wiki_add_citation
知识库    knowledge_search · knowledge_ask · knowledge_docs · knowledge_read · knowledge_cite
记忆      memory_inject · memory_search · memory_note_write · memory_entry_write
          memory_promote_note · run_read
画像      persona_lookup · persona_review
```

约定：

- 写入工具只到 draft / note；`reviewed` 与晋升仍由人或审核门完成；
- 资料导入不暴露给 Agent，只能人显式导入；
- 读 source 内容视为不可信数据。

典型流程：导入 source（或知识库资料）→ 发送到 Chat → 工具整理 draft / 补引用 → 人审核。

## Mission MCP

Mission 的 supervisor 也通过同样的 bridge 模式拿到受控工具（`mission_plan` / `task_delegate` / `task_review` / `mission_finish` 等），但不暴露 shell、文件读写或 spawn。每个 supervisor run 一个 token，且校验 `missionId`。详见 [Super Agent / Mission](#/wiki/super-agent)。

## 编辑器

Wiki 页面编辑器基于 CodeMirror：

- Markdown 工具栏、快捷键、查找替换；
- 回车续写列表 / 引用，Tab / Shift-Tab 缩进；
- `[[页面]]` 与 `#tag` 补全；
- 标题可直接编辑，保存时回写 title / summary。

## 第三方插件

在 **设置 → 插件** 里启用 / 停用 / 安装。插件视图会出现在左侧导航；命令会进入 `⌘K` 命令面板。
