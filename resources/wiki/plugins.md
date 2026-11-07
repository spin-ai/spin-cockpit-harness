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

## MCP tools

Wiki 通过 MCP bridge 向 dsh 暴露工具：

![MCP bridge](./wiki/mcp-bridge.png)

*图：dsh / MCP 工具 ↔ 主进程 HTTP bridge ↔ 插件。*

```text
wiki_search
wiki_list_sources
wiki_read_source
wiki_read_page
wiki_upsert_draft
wiki_add_citation
```

典型流程：导入 source → 发送到 Chat → Curator 用工具整理 draft → 人审核。

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
