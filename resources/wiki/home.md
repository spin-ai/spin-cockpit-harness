# Cockpit Harness

> 本地优先的多 Agent 编排工作台：把一句话变成任务，让 Agent 在真实项目里执行，人只负责确认。

Cockpit Harness（仓库名 `spin-cockpit-harness`）是一个 Electron 桌面应用。它不试图替代 IDE，也不把 Agent 循环塞进产品本体，而是把 **分派、执行、验收** 收拢到一个五列工作台里。

## 它是什么

- **Chat 是唯一入口**：说一句话派活，运行中继续说话就是纠偏。
- **TODO 是唯一看板**：排队 / 运行 / 等待输入 / 待确认 / 已确认都在一条列表里。
- **Terminal 是真实执行现场**：node-pty 拉起真实 shell，可多标签、可拆分、可直接输入。
- **项目就是本地目录**：一个目录一个项目；git 仓库会自动使用 worktree 隔离。
- **执行引擎外置**：Agent CLI 通过适配器接入；目前 Chat 派活走 dsh 的 ACP profile。
- **数据本地**：SQLite + 本地文件；模型配置和凭据不随 App 分发。

## 五个区域

![五列工作台](./wiki/layout.png)

*图：TODO / Chat / Terminal / 文件预览在同一屏内联动。*

| 区域 | 职责 |
|---|---|
| 导航 | 工作区 / 项目 / 收件箱 / 统计 / 主机 / Git / 笔记 / 设置 |
| TODO LIST | 按状态分组的任务列表；行内派活、停止、确认、重试 |
| Chat | 分派、纠偏、投递回执；agent / project / 元素上下文 |
| Terminal | 真实 pty、多标签、窗格拆分、预览与元素拾取 |
| 右侧栏 | 资源管理器 / 会话历史 / Git / 预览 |

## 一条任务的旅程

```text
Chat 说一句话
  → 解析 @agent / @project（或使用当前选择）
  → 创建 TODO + queued run
  → worktree 隔离（git 仓库）
  → dsh --profile acp 执行
  → session/update 流式写回 Chat
  → 运行中消息 → 纠偏回执
  → 完成后进入「待确认」
  → 人确认 → 「已确认」
```

## 设计原则

1. **单入口**：不在 Chat 之外再放一套新建/派活表单。
2. **执行可替换**：Run 不绑死某个 CLI，Agent 由执行适配器驱动。
3. **不假装**：不支持 steer 的 CLI 明确显示「终端专用」，不静默换引擎。
4. **人保留最终判断**：Agent 只能写 draft；reviewed 由人确认。
5. **本地优先**：项目、终端、数据库、日志都在本机；远端只通过 SSH 执行。

## 继续阅读

- [工作流](#/wiki/workflow)
- [架构](#/wiki/architecture)
- [Agent 与执行适配器](#/wiki/agents)
- [Super Agent / Mission](#/wiki/super-agent)
- [设计取舍与踩坑](#/wiki/design-notes)
- [终端与预览](#/wiki/terminal)
- [主题系统](#/wiki/themes)
- [插件与 LLM Wiki](#/wiki/plugins)
- [构建与发布](#/wiki/build)
- [版本记录](#/wiki/changelog)
