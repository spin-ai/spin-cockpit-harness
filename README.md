# spin-cockpit-harness

YieldMind Harness · 多 Agent 编排工作台：**Chat 分派任务 → project 下开 Terminal → agent 执行 → 看板看状态 → 确认后进 TODO LIST**。
Electron 桌面应用，本地 SQLite，执行走 `dsh --profile acp`。

## 运行

```sh
npm install
npm run dev                 # Vite + Electron
# 或
npm run build && npm start
npm run dist                # macOS dmg → release/
```

前置：本机已安装 `dsh` 并配置好模型；启动时自动探测 `dsh / pi / claude / codex / opencode`。

## 界面（五列）

```
导航 | TODO LIST | Chat | Terminal | 资源管理器 / 会话历史 / 预览
```

- **导航**：工作区 / 项目 / 统计 / 主机 / 设置（`⌘,`，左分区导航 + 右行式表单，参考 reference / reference）
- **TODO LIST**：一条任务列表，按状态分组；支持搜索、筛选（全部/进行中/待确认/已确认）、分组折叠、悬停快捷操作
- **项目**：在 TODO LIST 下方的常驻项目区，本地目录即项目；支持添加 / 切换 / 管理 / 在 Finder 中显示，任务、终端、文件树跟随当前项目
- **Chat**：单一输入路径。会话（thread）永远存在：说一句话即派活，运行中发消息即纠偏（带投递回执），已确认任务的消息仅记录
- **Terminal**：任务绑定项目的真实 pty（node-pty + xterm），可多标签、可直接输入；顶部可切到「预览」打开本机 dev server，并**拾取页面元素**
- **UI 上下文**：预览页里点中元素 → Chat 输入框出现元素 chip（selector / 源文件 / 截图）→ 随消息注入当前会话（运行中即 steer）
- **右侧栏**：reference 风格三块
  - **资源管理器**：树形展开 / 折叠、缩进、文件类型标识、名称筛选、刷新、显示点文件、全部折叠
  - **会话历史**：按今天 / 昨天 / 更早分组；每行显示标题、状态、Agent、项目、消息数、最近一条消息；点行回到对应 Chat 会话，可展开最近消息
  - **预览**：点击文件后作为独立 tab 打开，文本 / 图片预览，可关闭回到资源管理器
- **可拖拽布局**：TODO / Chat / Terminal / 文件四列之间的分隔条可左右拖动，TODO 列表与项目区之间的分隔条可上下拖动；尺寸自动记住，`⌘K → 重置面板宽度 / 高度` 可恢复默认
- **可收起面板**：TODO / Chat / Terminal / 右侧栏都能收起成窄条，点击窄条展开；项目区也可单独折叠；状态自动记住
- 状态分组就是看板：纵向排列在 TODO 列里
- 主机只显示机器与可用 CLI；Agent 在项目 Terminal 里启动，带项目内唯一 `@别名`

## 已实现

- Electron + SQLite（Todo/Run/Message/Artifact/Event/Inbox/Project/项目路径）
- 多项目：一个本地目录 = 一个项目，在 TODO LIST 下方切换，任务按项目隔离
- Chat 分派 → 立即创建任务并起 run
- 会话（thread）模型：消息宿主是会话而非任务，派活是会话的一条消息；单一 `send` 路径
- 纠偏投递回执：`投递中 / 已注入 / 投递失败·重发`，run 结束未回执一律标失败
- Chat 内按 run 分组展示；agent 可切换，项目在派活前选择（派活后锁定）
- dsh ACP 真实执行：`session/new → prompt → session/update` 流式落库
- worktree 隔离（cwd 是 git 仓库时自动创建）
- 队列 / 每 agent 并发；停止 / 重试
- 状态分组 + 确认 → 就地进入「已确认」
- 终端（真实 pty）、项目文件树与预览
- 前端预览 + 元素拾取（CDP）：终端打印的 dev server 地址自动识别；拾取元素 → 结构化 `<ui-context>` 注入 Agent；源码位置优先 `data-ym-src` / React `_debugSource`；截图落 `userData/ui-context`，不污染 worktree
- 审批弹窗（ACP `session/request_permission`），可在设置里改为自动批准 / 自动拒绝
- 设置页（通用 / 外观 / 执行 / 终端 / 预览与元素 / 数据 / 快捷键 / 关于）：SQLite 持久化、即时生效；含深浅色主题、默认 Agent、全局并发、dsh 路径/模型、终端字号与回滚、预览地址、备份导出与重置
- 统计页、每日模板、产物预览
- macOS dmg 打包（未签名）

## 未实现

- 任务与 Terminal 会话真正绑定（目前 Terminal 独立于 ACP run，Chat 的 agent 不在 Terminal 里）
- Agent 在 Terminal 内登录后由 harness 捕获完成/回写
- D5 全局自由对话（不绑任务的常驻 ACP 会话，可随时“转成 TODO”）
- 非 React 项目的元素→源文件仍需手写 `data-ym-src`；截图只传路径，未作为图片附件给 Agent
- D4 Agent 主动提问 → 等待输入（目前只有 ACP 审批会进入该状态）
- 长会话虚拟化 / 消息回放控制
- SSH 端到端、远端 worktree、心跳重连
- 签名 / 公证 / 自动更新、Windows/Linux 构建验证
- 未确认任务的“当前运行”聚合视图（看板之外）

## 文档

- [docs/REQ-original.md](docs/REQ-original.md)（纠正版需求）
- [docs/REQ-multi-agent-workspace.md](docs/REQ-multi-agent-workspace.md)（43 条规格）
- [docs/ARCH-multi-agent-workspace.md](docs/ARCH-multi-agent-workspace.md)（4+1 视图）
- [docs/ARCH-chat-thread.md](docs/ARCH-chat-thread.md)（CHAT 单会话模型：thread / send 状态机 / 迁移）
- [docs/ARCH-ui-context.md](docs/ARCH-ui-context.md)（预览元素拾取 → Agent 上下文：CDP / 安全边界 / 协议）
- [docs/ARCH-settings.md](docs/ARCH-settings.md)（设置：分区、逐项生效点、持久化与新增步骤）
- [docs/GAP-chat.md](docs/GAP-chat.md)（CHAT 实现现状与需求差距）
