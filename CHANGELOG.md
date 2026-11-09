# Changelog

所有值得注意的变更都记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added

- Super Agent / Mission 模式：主管 Agent（`role=supervisor`）、Plan Card 人工审批、child Todo + Delegation + worker run、Mission 面板与收件箱
- Mission MCP：`electron/mcp-bridge.mjs`（stdio ↔ Main HTTP）+ `mission_plan` / `task_delegate` / `task_review` / `task_steer` / `task_retry` / `mission_finish`
- Mission 调度：worktree 并行、依赖 `blockedBy`、Supervisor/子任务并发上限、Mission 时长预算、取消级联、重启恢复
- `dsh-supervisor.patch.yml`：关闭 dsh 原生 subagent / Team / workflow，保证 Mission 单一调度源
- `npm run verify:mission`：SQLite + MCP bridge + dsh supervisor profile 的 keyless 验证
- 应用内「说明」页 + `docs/USAGE-super-agent.md`：Super Agent 从准备 Agent 到确认 Mission 的完整使用路径、常见问题与限制
- 终端：预览标签可拖入 split 窗格（左/右/上/下），终端右键「在右侧打开预览」；预览成为可拆分的 pane
- 插件宿主：utilityProcess 插件、manifest、命令、事件、storage、设置页、目录安装/启停
- Wiki 内置 first-party 插件：原生 Source / Page / Citation / Review、Memory 顶层索引 + run prompt 注入、Dream 维护检查、CodeMirror 编辑、多 tab、可拖拽左右分屏、布局恢复、搜索、Graph、Wiki MCP tools、任务 / Chat 联动；恢复「打开本地目录」，可浏览 / 编辑 Markdown 并导入为 Source

### Added

- **Chat 对齐 DeepSeek 网页对话**：消息阅读列居中（宽面板最大 760px）、助手 Markdown 支持标题 / 列表 / 引用 / 分隔线、思考过程默认折叠、助手消息底部复制 / 重新生成、空态快捷任务卡片
- **WADE 开发环境迁移**：从 YieldMind 迁入 `.wade.yml`（worktree / feature-plan label / PR 流程 / bot review），模型切换到本机已认证的 DeepSeek，新增 `npm run verify:wade` 预检（配置 / 模型 / label / git 身份）
- **场景工作台**：每个项目一份文字场景配置（worktree / runtime / agent / concurrency / acceptance / notes），支持校验、AI 建议、项目进展与终端总览
- **运行时与终端元数据**：`runtimes` 派生视图（host + CLI + caps + 模式 + 可用性）、`terminals` 持久化（项目 / 任务 / run / agent / cwd / 状态 / exitCode / 最近输出）
- **多 Agent 并行**：普通 TODO 可选多个 Agent，每个独立 run / worktree；终端 Agent 自动开标签；Chat 可选择纠偏目标 run
- **分配预览 / 纯聊天 / 全局进展**：Chat 派活前建议、只聊会话、可选范围的进展 dock
- **场景与 worktree 策略**：`worktree: auto | always | never`，项目 Scene 覆盖全局；任务行可打开 / 清理 worktree
- **Mission terminal child**：Mission 子任务可使用终端 Agent，退出后结算 delegation
- **Wiki 存储拆分**：`wiki-index.json` 轻量 metadata + `pages/<id>.md` / `sources/<id>.txt` 正文分片 + `wiki-search.json` 搜索索引；单页按需读，旧 `wiki.json` 自动迁移并保留 `.bak`；1000 页面实测 list 23ms / search 5ms / 单页 1ms
- **Wiki 增强**：问 Wiki（本地检索抽句 + 引用）、收藏 / 最近、标签筛选、`#tag` 点击、双链 hover / 红链创建 / 反链上下文 / unlinked mentions / 图谱筛选、Markdown/PDF 导出、全量本地导入
- **快速记录独立小窗**：`⌘⇧K` 不切主窗口，剪贴板预填，直接存为 draft
- **统计 / 设置 / 数据迁移**：统计按 runtime 分组；设置增加 worktree 默认与 Runtime 视图；新增 `scenes` / `terminals` 表与 run 的 runtime / worktree_cleaned 迁移

### Changed

- **中断收口**：应用退出 / 重启时仍在跑的 ACP run 会被结算为 `interrupted`（退出时立即结算，启动时兜底扫描），`endedAt` 用最后一条消息时间，任务回到待执行并在会话里留一条 system 说明 —— 不再出现永远「进行中」的僵尸 run

- TODO 收敛为 4 组（待执行 / 进行中 / 待确认 / 已完成），新增「待处理」筛选；等待输入置顶高亮，已完成组可撤销确认
- 移除独立收件箱页，待确认 / 失败 / 等待输入统一进 TODO「待处理」；导航与设置里的收件箱入口同步移除
- 终端新增「＋ Agent」：不先建任务即可起原生 CLI Agent；终端可「接入」当前选中任务，运行进入 TODO
- 任务行显示当前 / 最近 run 的 worktree 分支与路径，点击在 Finder 打开
- 预览 Surface 补齐后退 / 前进 / 停止 / 硬刷新 / 缩放 / 页内查找 / DevTools / 外部打开 / 设备宽度
- LLM Wiki：停笔 1s 自动保存；删除页面 / 资料进回收站，可恢复或彻底删除；`⌘⇧K` 全局快速记录；中文按字模糊搜索；`#标签` 补全
- **Wiki 视觉收口**：页面改用 `PageHeader`，低频动作收进 `⋯`；左栏 / 编辑面 / 右栏合成一个主面（hairline 分栏）；编辑器改无衬线单栏 660px、隐藏行号、取消整行高亮；字数与保存状态下沉到底部状态条；右栏统一中文标签与 tabular 数字；图谱按 页面 / 资料 / 文件 分级着色
- **全站视觉收口**：语义色 / 中性色 / 圆角全部改走 Design System token（`--green/--amber/--red/--purple`、`--radius-*`、`--surface-hover`、`--faint`），暗色不再单独硬编码；选中与运行色从蓝色收成中性 `--brand`；`.page-head` 标题统一 22px；按 CDP 文本审计把 13 处内容型中文提到 ≥11.5px
- **Chat 思考与工具可读**：`tool_call` 消息首行改成 `Bash · 完成 · ls -1`（状态中文化、带命令/路径），把 `tool_call_update.content` 里的输出并入正文；思考过程（`agent_thought_chunk`）从折叠工具组拆成独立「思考」块，默认两行可展开
- **Chat 详情面板可拖选**：展开后冻结计时、历史行按 10s 粒度刷新，展开时把面板带进视野 —— 拖选文字不再被每秒重渲染打断
- **Chat 详情更有料**：老消息的 `bash · completed` 在渲染时归一化成「Bash · 完成」并补上命令/路径第二行；默认最近 6 步，可「看全部」展开该 run 的所有步骤
- **Chat 运行中进展可见**
## [0.2.0-alpha.2] - 2026-11-07

### Added

- **Git / Source Control**：独立 Git 页（分支 / ahead-behind / 暂存 / Diff +N -M / 提交（⌘Enter）/ Amend / 推送 / 拉取 / 分支切换与新建 / 最近提交 / 非仓库一键 init）；右侧栏新增 Git 迷你面板（会话历史旁）；资源管理器带 git 装饰（修改·新增·暂存·删除着色，`.gitignore` 文件与目录淡色斜体，目录有改动显示状态点）
- **文件预览**：Markdown 富文本 / 源码切换 + 目录（TOC，跳过代码围栏，点击跳转高亮）；HTML 预览 / 可视化 / 源码三段，可视化内建 **GrapesJS** 画布（拖组件、改文字、调样式，保存回写完整 HTML 并保留 head，CSS 写入唯一 `<style data-grapes>`；懒加载）
- **缺模型密钥的可操作引导**：Chat 错误卡片列出要设的环境变量与两种配法，一键跳到 设置 → 执行 → 模型密钥 并聚焦；设置里新增 `dshEnv`（KEY=VALUE 注入本地 dsh）；统计页失败行也可直接去配置
- **设置易用性**：跨分区搜索（⌘F，命中跳转并高亮）、逐项「恢复默认」、本页恢复默认、「已自动保存」提示、分区 ↑↓ 导航
- **主机与统计**：主机 caps 探测 / 页面可见时心跳 / 主机级并发 / Agent 运行位置；统计改为运行健康口径（成功率 / 中位耗时 / 排队 p50 / Token（未上报不写 0））+ 趋势 + 4 类失败 + 分组 + 下钻 + CSV
- **TODO**：多行收集箱批量建任务（去前缀/去重/上限 100）、行内编辑（标题/描述/验收/优先级/截止/标签）、分配执行 Agent、「问清楚」预填 Chat

### Fixed

- 切到收件箱 / 统计再回工作区时终端丢失（工作区改为常驻挂载、只切显隐）
- TODO 编辑提示文案移除（保留双击 / ⌘E 与行内「编辑」按钮）

### Changed

- 产品名统一为 **Cockpit Harness**（窗口标题 / 安装包 / ACP 客户端标识），旧 userData 与 `ymh.*` 本地键自动迁移
- 依赖升级：electron 45 / TypeScript 7 / Vite 8（rolldown）
- 文档：`docs/ARCH-hosts-stats.md`、`ARCH-git.md`、`ARCH-terminal-ux.md`（预览与可视化）、`ARCH-settings.md`（易用性）；知乎文章与对比截图改为本地素材不入库

## [0.2.0-alpha.1] - 2026-11-06

首个公开 Alpha，代号 **Liftoff**。

### Added

- Chat 分派 → TODO → Agent run 的完整闭环；支持 steer / 排队 / 停止 / 重试
- 终端：多标签、任意窗格拆分、拖拽比例、窗格焦点切换
- 终端：查找高亮、右键菜单、链接打开、字号缩放、退出重启、挂载前输出回放
- 预览：dev server 预览与本地 HTML 文件共用一个 `PreviewSurface`，支持渲染/源码切换、元素拾取
- 文件预览：Markdown 渲染（marked + DOMPurify）、HTML sandboxed webview、相对文档链接跳转
- 资源管理器：右键菜单、新建/重命名/复制/删除/Finder/在终端打开、行内编辑
- 项目 / 收件箱 / 统计 / 主机 / 设置五套页面；Rail 带未读徽标
- 统计：项目范围切换、按 Agent/项目/主机分组、失败分类、CSV 导出
- 主机：SSH 添加/编辑/探测、并发上限、Agent 运行位置切换
- 命令面板：命令 + 任务 + 会话全局搜索、分组、上下文安全调度
- 设置：终端字号/回滚、模型选择、预览地址、数据备份/恢复
- 深浅色主题、柔和卡片化布局、窄视口工具栏降级
- GitHub Actions 三平台打包与 Release 附件

### Changed

- Chat / Terminal 的工具栏与状态提示统一为低饱和、紧凑风格
- 终端 split / 文件预览切换不再重建 webContents，减少白屏与重新加载
- ACP 审批支持完整 optionId，显示审批队列；模型按会话保存
- 主机并发输入改为失焦/Enter 提交，避免逐字符写库

### Known limitations

- Alpha 阶段：数据库 schema / IPC / UI 仍可能变更，升级前请备份
- 未做代码签名 / 公证；macOS Gatekeeper 与 Windows SmartScreen 会提示
- 未实现：附件/图片粘贴、消息重新生成、文件树多选/拖拽、会话置顶/删除、run 日志详情、自定义快捷键
- Linux 构建为 x86_64；macOS 首发为 Apple Silicon（arm64）
