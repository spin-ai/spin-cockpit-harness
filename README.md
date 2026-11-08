# Cockpit Harness

[![build](https://github.com/spin-ai/spin-cockpit-harness/actions/workflows/build.yml/badge.svg)](https://github.com/spin-ai/spin-cockpit-harness/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/release/spin-ai/spin-cockpit-harness?include_prereleases&label=release)](https://github.com/spin-ai/spin-cockpit-harness/releases)
[![wiki](https://img.shields.io/badge/wiki-GitHub%20Wiki-blue)](https://github.com/spin-ai/spin-cockpit-harness/wiki)
[![docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://spin-ai.github.io/spin-cockpit-harness/)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![status](https://img.shields.io/badge/status-alpha-orange)

Cockpit Harness · **多智能体终端 / Super Agent / LLM Wiki**：Chat 分派任务 → project 下开 Terminal → agent 执行 → 看板看状态 → 确认后进 TODO LIST；Mission 编排与可审核知识库共用同一套本地数据。
Electron 桌面应用，本地 SQLite，执行走 `dsh --profile acp`；仓库名 `spin-cockpit-harness`。

在线文档（GitHub Pages）：<https://spin-ai.github.io/spin-cockpit-harness/>

> **当前版本：`v0.2.0-alpha.2`（Liftoff，公开 Alpha）**
> Alpha 阶段数据库结构、IPC 与 UI 仍可能变化；升级前请备份本地数据。

## 下载

构建产物在 [GitHub Releases](https://github.com/spin-ai/spin-cockpit-harness/releases)：

| 平台 | 产物 |
|---|---|
| macOS（Apple Silicon / arm64） | `Cockpit.Harness-<version>-arm64.dmg` |
| Windows（x64） | `Cockpit.Harness.Setup.<version>.exe` |
| Linux（x86_64） | `Cockpit.Harness-<version>.AppImage` |

- 发行版默认内置 dsh 单文件运行时，不需要目标机器安装 dsh。
- 未做代码签名/公证：macOS 可能被 Gatekeeper 拦截，Windows 可能触发 SmartScreen；Linux AppImage 需 `chmod +x`。
- 校验和见 Release 的 `SHA256SUMS.txt`。

## 运行

```sh
npm install
npm run dev                 # Vite + Electron
npm run docs:dev            # 文档站（GitHub Pages 同款，http://localhost:5198）
# 或
npm run build && npm start
npm run dist                # macOS dmg → release/，并自动同步到 /Applications（SKIP_LOCAL_INSTALL=1 可跳过）
npm run install:mac         # 只把最新构建装到本机（--open 装完顺手启动）
npm run docs:build          # → dist-pages/（GitHub Pages）
```

前置：本机已安装 `dsh` 并配置好模型；启动时自动探测 `dsh / pi / claude / codex / opencode`。

命名：仓库名 `spin-cockpit-harness`，产品名 **Cockpit Harness**（窗口标题 / 安装包 / ACP 客户端标识统一）；
需要多实例或跑冒烟测试时用 `COCKPIT_USER_DATA=/tmp/xxx` 指定独立的 userData 目录。
`npm run docs:build` 的产物由 `.github/workflows/pages.yml` 部署到 GitHub Pages（仓库 Settings → Pages → Source 选 GitHub Actions）。

发行版默认把 dsh 的单文件运行时打进 App（`Contents/Resources/dsh`），不再依赖目标机器安装 dsh；开发模式仍可直接用系统 dsh。需要轻量包时用 `npm run dist:system`。

## 界面（五列）

```
导航 | TODO LIST | Chat | Terminal | 资源管理器 / 会话历史
工作区 / 项目 / 收件箱 / 统计 / 主机 / 设置
```

- **导航**：工作区 / 项目 / 收件箱 / 统计 / 主机 / Git / 设置（`⌘,`，左分区导航 + 右行式表单；收件箱带未读徽标）
- **TODO LIST**：一条任务列表，按状态分组；支持搜索（标题/编号/描述/标签）、筛选（全部/进行中/待确认/已确认）、分组折叠、悬停或键盘聚焦显示快捷操作
- **项目**：在 TODO LIST 下方的常驻项目区，本地目录即项目；支持添加 / 切换 / 管理 / 在 Finder 中显示，任务、终端、文件树跟随当前项目
- **Chat**：单一输入路径。会话（thread）永远存在：说一句话即派活，运行中发消息即纠偏（带投递回执），已确认任务的消息仅记录；**未派活的对话是全局的**（切项目不消失），composer 里用 `◎ 全局 / 项目 · xxx` 选择这次对话的作用域；**模型可按会话选择**（选项来自 dsh ACP `session/new` 的 configOptions，下一次运行生效）；草稿会话发送 = 派活并创建任务
- **Super Agent / Mission**：在 Chat 里选择 `✦ 主管` 或点「＋ 主管」创建 supervisor；一句话先出计划（Mission Plan Card，可退回修改），人工批准后自动创建 child Todo + Delegation + worker run；worker 在独立 worktree 执行，Mission 面板汇总子任务、可取消/恢复/确认；supervisor 通过受控 MCP 工具读写 Mission，不直接改代码（见 [docs/ARCH-super-agent.md](docs/ARCH-super-agent.md)）
- **Terminal**：任务绑定项目的真实 pty（node-pty + xterm），可多标签、可直接输入；**资源管理器里的文件也在终端区按标签预览**；多标签切换（⌃Tab / ⌘⇧[ ] / ⌘⇧1…9）、**终端窗格任意拆分**（⌘D 右拆 / ⇧⌘D 下拆，递归嵌套 + 拖拽分隔条 + ⌘⌥方向键切焦点）、标签重命名与中键关闭、⌘F 查找、右键菜单（复制 / 粘贴 / 清屏 / 重启）、⌘+/- 字号缩放、链接点击打开、进程退出后可重启；挂载前的输出会回放，不会丢 banner；**预览只有一个标签**：打开 HTML/文本文件就切成文件模式（渲染 / 源码），点地址栏「URL」或终端识别到的 `打开预览 :PORT` 就切成地址模式（dev server / 远程页面），两种模式共用同一 webview、地址栏与**拾取页面元素**；工具栏不再单列「＋ 预览」按钮（避免第二个入口）
- **UI 上下文**：预览页里点中元素 → Chat 输入框出现元素 chip（selector / 源文件 / 截图）→ 随消息注入当前会话（运行中即 steer）
- **插件**：Settings → 插件可安装 `.cockpit-plugin` / 目录、启停；**Notes 是内置 first-party 插件**，无需额外安装，原生 Source / Page / Citation / Review、Memory 顶层索引 / 注入、CodeMirror 编辑、多 tab、可拖拽左右分屏、搜索、Graph、任务 / Chat 联动；也支持打开本地 Markdown 目录，直接编辑写回或导入为 Source（见 [docs/ARCH-plugins.md](docs/ARCH-plugins.md)、[docs/PLUGIN-notes.md](docs/PLUGIN-notes.md)）
- **右侧栏**：三块
  - **资源管理器**：树形展开 / 折叠、文件类型标识、名称筛选（默认隐藏点文件）、全部折叠；**右键菜单**（新建文件/文件夹、在终端打开、Finder 显示、复制路径/相对路径、重命名 F2、复制副本、删除 ⌫）、工具栏新建、行内重命名、自动刷新（窗口重新聚焦时）
  - **会话历史**：按今天 / 昨天 / 更早分组；每行显示标题、状态、Agent、项目、消息数、最近一条消息；点行回到对应 Chat 会话，可展开最近消息
  - **会话历史**之外不再挤一个预览 tab：点击文件 / 右键「预览」会在**终端区唯一的预览标签**里打开（Markdown 默认富文本可编辑 + 格式工具栏 + ⌘⇧M 切源码 + 目录；HTML 预览/可视化/源码三段，可视化是 **GrapesJS 画布**（拖组件、改文字、调样式，保存回写完整 HTML，懒加载）；源码编辑同样 ⌘S 保存）（再次点别的文件是替换，不会堆一排预览标签）（文本 / 图片 / Markdown / HTML；Markdown 和 HTML 支持「渲染 / 源码」切换；HTML 渲染里可直接**拾取元素**并把 selector / 源码位置注入 Chat；Markdown 相对文档链接可直接跳转；HTML 标签切换 / 源码渲染 / 刷新都不会重载 webContents；可 Finder 显示、复制路径、刷新、关闭）
- **可拖拽布局**：TODO / Chat / Terminal / 文件四列之间的分隔条可左右拖动，TODO 列表与项目区之间的分隔条可上下拖动；尺寸自动记住，`⌘K → 重置面板宽度 / 高度` 可恢复默认
- **可收起面板**：TODO / Chat / Terminal / 右侧栏都能收起成窄条，点击窄条展开；项目区也可单独折叠；状态自动记住
- 状态分组就是看板：纵向排列在 TODO 列里
- 资源管理器带 Git 装饰：修改 / 新增 / 已暂存 / 删除各自着色并带状态字母，被 `.gitignore` 忽略的文件与目录淡色斜体，目录内有改动时显示状态点
- Wiki / 笔记：一键「整理 Wiki」自动改标题（正文 H1 / slug 美化，旧 `[[链接]]` 一起改写）+ 统一页面大纲（要点 / 原文摘录 / 相关）+ 页面互链 + 重建「Wiki 索引」，幂等；支持从磁盘导入文档（md/txt/json/csv/yml/html… 可多选，自动跳过二进制与重复项）；资料可删除（连带清引用）、页面可删除、审核列表可直接接受/退回、搜索 Esc 清空；打开本地 Markdown 目录 → 「全部导入为资料」→ 「生成 Wiki」（每份资料生成一个草稿页面 + citation，确定性生成、不依赖模型）→ 编辑 / 审核；图谱包含页面 / 资料 / 本地文件三类节点
- 右侧栏新增 **Git** 标签（资源管理器 / 会话历史旁边）：分支、暂存/取消暂存、全部暂存、提交框（⌘Enter）、拉取/推送、一键「全屏」看 diff
- Git（Source Control）：分支 / 上游 / ahead-behind、文件暂存与丢弃、Diff 查看（+N -M）、提交框（⌘Enter）、推送/拉取、分支切换与新建、最近提交；非仓库可一键 `git init`（见 [docs/ARCH-git.md](docs/ARCH-git.md)）
- Git → 项目 Wiki：内置项目介绍 / 工作流 / 界面与流程 / 架构 / Agent / Super Agent / LLM Wiki / 设计取舍 / 终端 / 主题 / 插件 / 构建 / 版本记录；支持搜索（⌘F）、目录、页间链接、图片灯箱、代码复制和可播放的流程 Demo，带 Git 分支 / HEAD 标识；内容来自 `resources/wiki/*.md` + `CHANGELOG.md`，随仓库版本发布；`npm run wiki:publish` 可同步到 GitHub Wiki（独立 `.wiki.git` 仓库）
- 主机页：本机 + SSH 主机卡片，一次往返探测 CLI / 版本 / git / 远端目录（`caps`），页面可见时 60s 心跳（连续 2 次失败才标离线），每主机并发上限（失焦提交），SSH 主机可编辑地址/用户/端口/远端 cwd，Agent 运行位置切换有确认；主机离线时 Chat 顶部提示并可一键改用本机（见 [docs/ARCH-hosts-stats.md](docs/ARCH-hosts-stats.md)）
- 统计页：**全部项目 / 单项目范围切换** + 成功率 / 中位耗时 / 排队 p50 / Token（未上报就显示未上报，不写 0）+ 每日趋势（图例 + 空态）+ 4 类失败分类 + 按 Agent/项目/主机分组 + 失败下钻 + CSV 导出；不估算费用
- 主机只显示机器与可用 CLI；Agent 在项目 Terminal 里启动，带项目内唯一 `@别名`

## 已实现

- Electron + SQLite（Todo/Run/Message/Artifact/Event/Inbox/Project/项目路径）
- 多项目：一个本地目录 = 一个项目，在 TODO LIST 下方切换，任务按项目隔离
- Chat 分派 → 立即创建任务并起 run
- 会话（thread）模型：消息宿主是会话而非任务，派活是会话的一条消息；单一 `send` 路径
- 纠偏投递回执：`投递中 / 已注入 / 投递失败·重发`，run 结束未回执一律标失败
- Chat 内按 run 分组展示；agent 可切换，项目在派活前选择（派活后锁定）
- Chat 的 Agent 有两种执行方式：`dsh` 走 ACP（结构化流 / 审批 / 纠偏回执）；`pi / claude / codex / opencode` 走真实 pty（Chat 派活后自动开终端标签、在 worktree 里启动 CLI；后续消息直接写入同一个 pty）
- Chat 里可以无终端纳管 dsh，也可以用「＋ Agent」创建 pi 等终端 Agent
- Mission 模式：`agents.role=supervisor`、计划审批、child Todo/Run/Delegation、worktree 并行、取消级联、重启恢复、Mission 级收件箱/统计；supervisor 会话禁用 dsh 原生 subagent/team/workflow，避免双调度
- dsh ACP 真实执行：`session/new → prompt → session/update` 流式落库
- dsh 来源可见：设置页显示当前走 内置 / 自定义 / 系统 PATH，默认不把执行引擎塞进仓库
- worktree 隔离（cwd 是 git 仓库时自动创建）
- 队列 / 每 agent 并发；停止 / 重试
- 状态分组 + 确认 → 就地进入「已确认」
- 终端（真实 pty）、项目文件树；文件预览与网页预览统一在终端标签区
- 终端易用性：多标签快捷键、**窗格拆分**（二进制布局 / 拖拽比例 / 方向键切焦点）、**预览标签拖入拆分的另一半**（或终端右键「在右侧打开预览」）、查找高亮、右键菜单、链接打开、字号缩放、标签重命名 / 运行中提示点、退出重启、挂载前输出回放（见 [docs/ARCH-terminal-ux.md](docs/ARCH-terminal-ux.md)）
- 前端预览 + 元素拾取（CDP）：预览作为终端标签页（与 pty 标签并列，⌘W / 中键关闭），终端打印的 dev server 地址自动识别；拾取元素 → 结构化 `<ui-context>` 注入 Agent；源码位置优先 `data-ym-src` / React `_debugSource`；截图落 `userData/ui-context`，不污染 worktree
- Chat 终端模式：派活时准备 worktree、打开终端标签、启动 CLI 并写入任务；运行中消息直接写回 pty；pty 退出后 run 进入待确认
- 审批弹窗（ACP `session/request_permission`）：按 ACP 选项渲染（允许一次 / 总是允许 / 拒绝），支持多审批队列提示、焦点陷阱/aria；可在设置里改为自动批准 / 自动拒绝
- 设置页（通用 / 外观 / 执行 / 终端 / 预览与元素 / 数据 / 快捷键 / 关于）：SQLite 持久化、即时生效；含分区说明/行内 hint、13 套主题（跟随系统 / 浅色 / 纸感 / Light+ / 深色 / Dark+ / Monokai / One Dark / Solarized / Dracula / 午夜蓝 / 森林 / 石墨；终端配色随主题切换）、默认 Agent、全局并发、dsh 路径/模型、终端字号与回滚、预览地址、备份导出与重置
- 每日模板、产物预览
- macOS dmg 打包（未签名）

## 未实现

- 终端模式的 ACP 级审批 / 结构化事件 / 精确完成回写（目前以 pty 退出为完成信号）
- dsh 的交互式 TUI profile（当前 dsh 只走 ACP；终端模式需要 pi/claude/codex/opencode 这类 CLI）
- D5 全局自由对话（不绑任务的常驻 ACP 会话，可随时“转成 TODO”）
- 非 React 项目的元素→源文件仍需手写 `data-ym-src`；截图只传路径，未作为图片附件给 Agent
- D4 Agent 主动提问 → 等待输入（目前只有 ACP 审批会进入该状态）
- Super Agent：远程 supervisor（MCP over SSH）、团队/小队、Native 模式 UI（当前 Mission supervisor 只支持本地；远程 worker 可用）
- pi / claude / codex / opencode 的 ACP 执行适配器（目前 Chat 走终端 pty，不走 ACP）
- Chat 多选广播 UI（后端 `broadcast` 已在，界面仍为单 Agent）
- 长会话虚拟化 / 消息回放控制
- 远端 worktree（远端直接用绝对 cwd）、断线重连、守护进程纳管
- 签名 / 公证 / 自动更新、Windows/Linux 构建验证
- 未确认任务的“当前运行”聚合视图（看板之外）

## Agent 选择与执行方式

Chat 的“Agent”是执行目标，按 CLI 自动选择执行方式：

| CLI | Chat 执行 | 说明 |
|---|---|---|
| `dsh` | ✅ ACP | `--profile acp`；结构化流、审批、纠偏回执 |
| `pi` / `claude` / `codex` / `opencode` | ✅ 终端 pty | Chat 派活后开终端标签、在 worktree 里启动 CLI；steer 直接写 pty |

- 新装环境 Chat 里没有 Agent 时，点「＋ dsh」即可纳管一个 ACP Agent
- 输入框下方「＋ Agent」可以创建 pi / claude / codex / opencode 终端 Agent
- `@别名` 同样遵守执行方式
- 设置 → 执行 → 「Chat 执行方式」可以看到矩阵

终端模式没有 ACP 的 `session/update`、审批队列和精确完成回执：Chat 负责派活/纠偏，实际输出在终端标签里；pty 退出即结束本轮 run。Mission / supervisor 强制使用 ACP，不能混用。

## 内置 dsh（默认）

`npm run dist` / `npm run pack` 会先从 PyPI 的 `deepseek-harness-runtime-bin` 平台 wheel 取 dsh 单文件运行时（pkg SEA，自带 Node 与依赖），复制进 `resources/dsh`，再打进 `Contents/Resources/dsh`。macOS / Linux x64+arm64 / Windows x64 都有预构建 wheel，所以不需要在目标机器上编译 dsh。

```sh
npm run bundle:dsh        # 当前平台；首次会下载对应 wheel
npm run smoke:dsh         # --version + ACP initialize + session/new
npm run verify:mission    # Mission schema + MCP bridge + supervisor profile
npm run verify:plugins    # 插件 manifest / 入口语法
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

发布构建目标（CI 会在原生 runner 上构建并做 dsh smoke）：

| 平台 | 产物 | 验证 |
|---|---|---|
| macOS arm64 | `Cockpit.Harness-0.2.0-alpha.2-arm64.dmg` | CI `macos-14`；dsh `--version` + ACP initialize/session/new |
| Linux x86_64 | `Cockpit.Harness-0.2.0-alpha.2.AppImage` | CI `ubuntu-24.04`；dsh ACP、node-pty（ELF）与 Electron 启动通过 |
| Windows x64 | `Cockpit.Harness.Setup.0.2.0-alpha.2.exe` | CI `windows-2022`；内置 dsh/PTY 与 `app.asar` 结构通过 |

## 开源与参与

- **License**：[MIT](LICENSE) · 版权归 spin-ai
- **贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- **行为准则**：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **安全报告**：[SECURITY.md](SECURITY.md)（请走私密漏洞报告，不要开公开 Issue）
- **第三方许可**：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)（含内置 dsh 的 MIT 许可）
- **变更记录**：[CHANGELOG.md](CHANGELOG.md) · [Release Notes](RELEASE_NOTES.md)
- 本项目是本地优先工具，不包含遥测；Agent CLI 自身的数据发送取决于对应服务的配置。

## 文档

- [docs/REQ-original.md](docs/REQ-original.md)（纠正版需求）
- [docs/REQ-multi-agent-workspace.md](docs/REQ-multi-agent-workspace.md)（43 条规格）
- [docs/REQ-modules-original.md](docs/REQ-modules-original.md)（原始需求 · 按模块：场景 / 项目 / TODO / Mission / Chat / Terminal / Wiki / 主机 / 设置 / 打包）
- [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)（设计系统：Geist / 中性色 / token / 页面与组件规则）
- [AGENTS.md](AGENTS.md)（Agent / contributor 的 UI 硬规则）
- [docs/ARCH-multi-agent-workspace.md](docs/ARCH-multi-agent-workspace.md)（4+1 视图）
- [docs/ARCH-super-agent.md](docs/ARCH-super-agent.md)（Super Agent：Mission / Delegation / MCP / 迁移与验证）
- [docs/USAGE-super-agent.md](docs/USAGE-super-agent.md)（Super Agent 使用说明：准备 Agent / 审批计划 / 子任务 / 恢复）
- [docs/ARCH-plugins.md](docs/ARCH-plugins.md)（插件宿主：manifest / 权限 / utilityProcess / API / 执行器 / UI）
- [docs/PLUGIN-notes.md](docs/PLUGIN-notes.md)（原生 LLM Wiki：Source / Page / Citation / Review / Graph）
- [docs/ARCH-chat-thread.md](docs/ARCH-chat-thread.md)（CHAT 单会话模型：thread / send 状态机 / 迁移）
- [docs/ARCH-ui-context.md](docs/ARCH-ui-context.md)（预览元素拾取 → Agent 上下文：CDP / 安全边界 / 协议）
- [docs/ARCH-settings.md](docs/ARCH-settings.md)（设置：分区、逐项生效点、持久化与新增步骤）
- [docs/ARCH-git.md](docs/ARCH-git.md)（Git / Source Control：IPC 表、交互要点、明确不做的部分）
- [docs/ARCH-hosts-stats.md](docs/ARCH-hosts-stats.md)（主机探测/心跳/运行位置 + 统计口径：未上报不写 0）
- [docs/ARCH-terminal-ux.md](docs/ARCH-terminal-ux.md)（终端易用性：标签 / 拆分 / 查找 / 右键菜单 / 输入回放）
- [docs/ARCH-chat-ui.md](docs/ARCH-chat-ui.md)（Chat UI：扁平消息 / 工具折叠 / 卡片 composer）
- [docs/ARCH-usability-pass.md](docs/ARCH-usability-pass.md)（易用性改进：已完成项与仍待做的重型能力）
- [docs/ARCH-file-explorer.md](docs/ARCH-file-explorer.md)（资源管理器：右键菜单 / 文件操作 / 安全边界）
- [docs/GAP-chat.md](docs/GAP-chat.md)（CHAT 实现现状与需求差距）
