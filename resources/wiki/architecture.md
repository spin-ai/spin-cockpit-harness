# 架构

## 进程模型

![全景架构](./wiki/architecture.png)

*图：Renderer / Main / Executor / Storage 四层；每个 run 一个 dsh 子进程。*

- **Main** 持有 SQLite、ACP client、pty、worktree、插件宿主、MCP bridge、预览/CDP。
- **Renderer** 只通过 IPC 读状态、发 action，不直接持有子进程或访问文件系统。
- **Executor** 是 dsh ACP / node-pty / git worktree / webview CDP 的边界。

- **main** 持有唯一可变状态：任务、run、消息、会话、项目、设置、审批。
- **renderer** 不直接读写数据库，所有写操作走 `harness.action`。
- **pty** 只负责真实终端；Chat 的 ACP run 是独立子进程。
- **plugin host** 是内置/第三方插件的沙箱边界；插件通过 `pluginInvoke` 暴露方法。

## 数据

SQLite 是唯一事实来源，主要表：

| 表 | 内容 |
|---|---|
| `todos` | 任务、状态、项目、cwd、确认标记 |
| `runs` | 每次执行、状态、耗时、worktree、错误分类 |
| `threads` | Chat 会话；消息宿主 |
| `messages` | user / agent / tool / system，含投递回执与元素上下文 |
| `runs` / `artifacts` | 产物与文件引用 |
| `projects` / `hosts` / `agents` | 项目、主机、执行体 |
| `settings` | 用户设置（主题、模型、dsh 路径、并发等） |
| `inbox` / `events` | 通知与审计事件 |

## 一次 run 的执行链路

```text
send(threadId, text)
  → 解析 @mention / project / agent
  → 创建 todo（首次派活）
  → queueRun()
  → tick()（并发 + 主机 + cwd 约束）
  → startRun()
      → prepareWorktree()
      → new AcpClient({ cwd, bin })
      → initialize → session/new → configure → prompt
      → session/update → handleUpdate → messages
  → run completed → todo in_review → inbox
```

## 关键模块

| 文件 | 职责 |
|---|---|
| `electron/main.mjs` | 状态机、actions、run 生命周期、IPC |
| `electron/acp.mjs` | dsh ACP JSON-RPC 客户端；stdio / SSH |
| `electron/db.mjs` | SQLite schema、迁移、持久化 |
| `electron/worktree.mjs` | git worktree 创建与清理 |
| `electron/plugins/host.mjs` | 插件加载、权限、命令、MCP bridge |
| `electron/preview.mjs` | 预览窗口、CDP、元素拾取 |
| `src/components/TaskChat.tsx` | Chat / 投递回执 / 元素上下文 |
| `src/components/TaskPane.tsx` | TODO 看板与行内操作 |
| `src/components/TerminalPanel.tsx` | pty、标签、拆分、预览标签 |
| `src/components/Notes.tsx` | 内置 LLM Wiki（Notes 插件） |

## 安全边界

- 任务只能读当前项目 / worktree；远端 runner 走 SSH。
- ACP 权限请求进入审批队列；可配置自动批准 / 拒绝。
- 预览元素上下文只注入结构化 DOM 信息与截图路径，不执行页面脚本。
- 模型凭据不打包，使用 `DSH_HOME` 或用户默认配置。

## 继续阅读

- [设计取舍与踩坑](#/wiki/design-notes)：为什么不是 TUI / IDE、为什么用 ACP、16 条已踩的坑。
- [Super Agent / Mission](#/wiki/super-agent)：Mission、Plan、Delegation 与 MCP 编排。
