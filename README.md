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
发行版默认把 dsh 的单文件运行时打进 App（`Contents/Resources/dsh`），不再依赖目标机器安装 dsh；开发模式仍可直接用系统 dsh。需要轻量包时用 `npm run dist:system`。

## 界面（五列）

```
导航 | TODO LIST | Chat | Terminal | 资源管理器 / 会话历史
```

- **导航**：工作区 / 项目 / 统计 / 主机 / 设置（`⌘,`，左分区导航 + 右行式表单，参考 ORCA / Multica）
- **TODO LIST**：一条任务列表，按状态分组；支持搜索、筛选（全部/进行中/待确认/已确认）、分组折叠、悬停快捷操作
- **项目**：在 TODO LIST 下方的常驻项目区，本地目录即项目；支持添加 / 切换 / 管理 / 在 Finder 中显示，任务、终端、文件树跟随当前项目
- **Chat**：单一输入路径。会话（thread）永远存在：说一句话即派活，运行中发消息即纠偏（带投递回执），已确认任务的消息仅记录；**未派活的对话是全局的**（切项目不消失），composer 里用 `◎ 全局 / 项目 · xxx` 选择这次对话的作用域
- **Terminal**：任务绑定项目的真实 pty（node-pty + xterm），可多标签、可直接输入；**资源管理器里的文件也在终端区按标签预览**；多标签切换（⌃Tab / ⌘⇧[ ] / ⌘⇧1…9）、**终端窗格任意拆分**（⌘D 右拆 / ⇧⌘D 下拆，递归嵌套 + 拖拽分隔条 + ⌘⌥方向键切焦点）、标签重命名与中键关闭、⌘F 查找、右键菜单（复制 / 粘贴 / 清屏 / 重启）、⌘+/- 字号缩放、链接点击打开、进程退出后可重启；挂载前的输出会回放，不会丢 banner；**预览是终端里的一个标签页**（工具栏「＋ 预览」随时可开，默认地址来自设置；终端识别到 dev server 地址时也可一键打开），可在同一标签条里切换/关闭，并**拾取页面元素**
- **UI 上下文**：预览页里点中元素 → Chat 输入框出现元素 chip（selector / 源文件 / 截图）→ 随消息注入当前会话（运行中即 steer）
- **右侧栏**：ORCA 风格三块
  - **资源管理器**：树形展开 / 折叠、文件类型标识、名称筛选、显示点文件、全部折叠；**右键菜单**（新建文件/文件夹、在终端打开、Finder 显示、复制路径/相对路径、重命名 F2、复制副本、删除 ⌫）、工具栏新建、行内重命名、自动刷新（窗口重新聚焦时）
  - **会话历史**：按今天 / 昨天 / 更早分组；每行显示标题、状态、Agent、项目、消息数、最近一条消息；点行回到对应 Chat 会话，可展开最近消息
  - **会话历史**之外不再挤一个预览 tab：点击文件 / 右键「预览」会在**终端区**新开一个文件预览标签（文本 / 图片 / Markdown / HTML；Markdown 和 HTML 支持「渲染 / 源码」切换，可 Finder 显示、复制路径、刷新、关闭）
- **可拖拽布局**：TODO / Chat / Terminal / 文件四列之间的分隔条可左右拖动，TODO 列表与项目区之间的分隔条可上下拖动；尺寸自动记住，`⌘K → 重置面板宽度 / 高度` 可恢复默认
- **可收起面板**：TODO / Chat / Terminal / 右侧栏都能收起成窄条，点击窄条展开；项目区也可单独折叠；状态自动记住
- 状态分组就是看板：纵向排列在 TODO 列里
- 主机页：本机 + SSH 主机卡片，一次往返探测 CLI / 版本 / git / 远端目录（`caps`），页面可见时 60s 心跳（连续 2 次失败才标离线），每主机并发上限，Agent 运行位置可切；主机离线时 Chat 顶部提示并可一键改用本机（见 [docs/ARCH-hosts-stats.md](docs/ARCH-hosts-stats.md)）
- 统计页：成功率 / 中位耗时 / 排队 p50 / Token（未上报就显示未上报，不写 0）+ 每日趋势 + 4 类失败分类 + 按 Agent/项目/主机分组 + 失败下钻 + CSV 导出；不估算费用
- 主机只显示机器与可用 CLI；Agent 在项目 Terminal 里启动，带项目内唯一 `@别名`

## 已实现

- Electron + SQLite（Todo/Run/Message/Artifact/Event/Inbox/Project/项目路径）
- 多项目：一个本地目录 = 一个项目，在 TODO LIST 下方切换，任务按项目隔离
- Chat 分派 → 立即创建任务并起 run
- 会话（thread）模型：消息宿主是会话而非任务，派活是会话的一条消息；单一 `send` 路径
- 纠偏投递回执：`投递中 / 已注入 / 投递失败·重发`，run 结束未回执一律标失败
- Chat 内按 run 分组展示；agent 可切换，项目在派活前选择（派活后锁定）
- Chat 的 Agent 选择只对有执行适配器的 CLI 开放（当前 dsh/ACP）；可在 Chat 里一键纳管 dsh Agent，其他 CLI 标注「终端专用」
- dsh ACP 真实执行：`session/new → prompt → session/update` 流式落库
- dsh 来源可见：设置页显示当前走 内置 / 自定义 / 系统 PATH，默认不把执行引擎塞进仓库
- worktree 隔离（cwd 是 git 仓库时自动创建）
- 队列 / 每 agent 并发；停止 / 重试
- 状态分组 + 确认 → 就地进入「已确认」
- 终端（真实 pty）、项目文件树；文件预览与网页预览统一在终端标签区
- 终端易用性（参考 ORCA terminal）：多标签快捷键、**窗格拆分**（二进制布局 / 拖拽比例 / 方向键切焦点）、查找高亮、右键菜单、链接打开、字号缩放、标签重命名 / 运行中提示点、退出重启、挂载前输出回放（见 [docs/ARCH-terminal-ux.md](docs/ARCH-terminal-ux.md)）
- 前端预览 + 元素拾取（CDP）：预览作为终端标签页（与 pty 标签并列，⌘W / 中键关闭），终端打印的 dev server 地址自动识别；拾取元素 → 结构化 `<ui-context>` 注入 Agent；源码位置优先 `data-ym-src` / React `_debugSource`；截图落 `userData/ui-context`，不污染 worktree
- 审批弹窗（ACP `session/request_permission`），可在设置里改为自动批准 / 自动拒绝
- 设置页（通用 / 外观 / 执行 / 终端 / 预览与元素 / 数据 / 快捷键 / 关于）：SQLite 持久化、即时生效；含深浅色主题、默认 Agent、全局并发、dsh 路径/模型、终端字号与回滚、预览地址、备份导出与重置
- 每日模板、产物预览
- macOS dmg 打包（未签名）

## 未实现

- 任务与 Terminal 会话真正绑定（目前 Terminal 独立于 ACP run，Chat 的 agent 不在 Terminal 里）
- Agent 在 Terminal 内登录后由 harness 捕获完成/回写
- D5 全局自由对话（不绑任务的常驻 ACP 会话，可随时“转成 TODO”）
- 非 React 项目的元素→源文件仍需手写 `data-ym-src`；截图只传路径，未作为图片附件给 Agent
- D4 Agent 主动提问 → 等待输入（目前只有 ACP 审批会进入该状态）
- pi / claude / codex / opencode 的 Chat 原生执行适配器（目前仅终端可跑，不静默回退到 dsh）
- Chat 多选广播 UI（后端 `broadcast` 已在，界面仍为单 Agent）
- 长会话虚拟化 / 消息回放控制
- 远端 worktree（远端直接用绝对 cwd）、断线重连、守护进程纳管
- 签名 / 公证 / 自动更新、Windows/Linux 构建验证
- 未确认任务的“当前运行”聚合视图（看板之外）

## Agent 选择与执行适配器

Chat 的“Agent”是执行目标，不是探测器里所有 CLI 的并集。每个 CLI 必须登记一个执行适配器才能从 Chat 派活：

| CLI | Chat 派活 | 说明 |
|---|---|---|
| `dsh` | ✅ | ACP（`--profile acp`），支持运行中纠偏 |
| `pi` / `claude` / `codex` / `opencode` | ❌ 终端专用 | 尚未接入 Chat 适配器；选中会明确报错，不会偷偷换成 dsh |

- 新装环境 Chat 里没有 Agent 时，点「＋ dsh」即可纳管一个（不需要先开终端）
- 在终端启动的 Agent 会出现在下拉框；非 dsh 的标记「终端专用」且不可选
- `@别名` 同样遵守适配器规则
- 设置 → 执行 → 「Chat 执行适配器」可以看到矩阵

## 内置 dsh（默认）

`npm run dist` / `npm run pack` 会先从 PyPI 的 `deepseek-harness-runtime-bin` 平台 wheel 取 dsh 单文件运行时（pkg SEA，自带 Node 与依赖），复制进 `resources/dsh`，再打进 `Contents/Resources/dsh`。macOS / Linux x64+arm64 / Windows x64 都有预构建 wheel，所以不需要在目标机器上编译 dsh。

```sh
npm run bundle:dsh        # 当前平台；首次会下载对应 wheel
npm run smoke:dsh         # --version + ACP initialize + session/new
npm run dist              # 当前平台原生包（mac dmg / win nsis / linux AppImage）
```

按平台/架构指定：

```sh
npm run dist:mac
npm run dist:win                    # Windows x64 (nsis)
npm run dist:linux                  # 当前架构 AppImage
npm run dist:linux:x64
npm run dist:linux:arm64
```

离线 / 固定版本：

```sh
DSH_WHEEL_DIR=/path/to/wheels npm run bundle:dsh
DSH_VERSION=0.2.1rc2 npm run bundle:dsh
DSH_WHEEL=/path/to/runtime.whl npm run bundle:dsh
```

仍然支持源码构建产物：`DSH_EXE_DIR=/path/to/dist-exe` 或 `DSH_BIN=/path/to/dsh`。运行时优先级：

```
设置里的「可执行文件」 > Contents/Resources/dsh/dsh > 系统 PATH
```

不需要内置时：

```sh
npm run dist:system   # 轻量包，依赖目标机器的 dsh
npm run pack:system
```

`resources/dsh` 里的二进制被 gitignore，只提交 `.gitignore`；构建机需要能访问 PyPI 或提供 wheel。注意：

- 单文件运行时是平台/架构相关的（约 260–306MB，App 约 350–600MB）。
- 模型配置/凭据没有打包，仍走 `DSH_HOME` 或用户默认配置。
- SSH 远端 run 仍使用远端自己的 dsh。
- Windows / Linux 产物由 CI 在原生 runner 上构建 + `smoke:dsh` 验证（见 `.github/workflows/build.yml`）；本地 macOS 可以交叉准备 dsh 资源并打 Windows 包，但 Linux 的 node-pty 必须在 Linux 上重建。
- 正式分发需要签名/公证，内置的 `dsh`、`dsh-rg`、`dsh-spawn-helper` 也要一起签。

## 文档

- [docs/REQ-original.md](docs/REQ-original.md)（纠正版需求）
- [docs/REQ-multi-agent-workspace.md](docs/REQ-multi-agent-workspace.md)（43 条规格）
- [docs/ARCH-multi-agent-workspace.md](docs/ARCH-multi-agent-workspace.md)（4+1 视图）
- [docs/ARCH-chat-thread.md](docs/ARCH-chat-thread.md)（CHAT 单会话模型：thread / send 状态机 / 迁移）
- [docs/ARCH-ui-context.md](docs/ARCH-ui-context.md)（预览元素拾取 → Agent 上下文：CDP / 安全边界 / 协议）
- [docs/ARCH-settings.md](docs/ARCH-settings.md)（设置：分区、逐项生效点、持久化与新增步骤）
- [docs/ARCH-hosts-stats.md](docs/ARCH-hosts-stats.md)（主机探测/心跳/运行位置 + 统计口径：未上报不写 0）
- [docs/ARCH-terminal-ux.md](docs/ARCH-terminal-ux.md)（终端易用性：标签 / 拆分 / 查找 / 右键菜单 / 输入回放）
- [docs/ARCH-chat-ui.md](docs/ARCH-chat-ui.md)（Chat UI：扁平消息 / 工具折叠 / 卡片 composer，参考 Multica + ORCA）
- [docs/ARCH-file-explorer.md](docs/ARCH-file-explorer.md)（资源管理器：右键菜单 / 文件操作 / 安全边界）
- [docs/GAP-chat.md](docs/GAP-chat.md)（CHAT 实现现状与需求差距）
