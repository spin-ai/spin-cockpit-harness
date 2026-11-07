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

## [0.2.0-alpha.2] - 2026-11-07

### Added

- **Git / Source Control**：独立 Git 页（分支 / ahead-behind / 暂存 / Diff +N -M / 提交（⌘Enter）/ Amend / 推送 / 拉取 / 分支切换与新建 / 最近提交 / 非仓库一键 init）；右侧栏新增 Git 迷你面板（会话历史旁）；资源管理器带 git 装饰（修改·新增·暂存·删除着色，`.gitignore` 文件与目录淡色斜体，目录有改动显示状态点）
- **文件预览（照 reference）**：Markdown 富文本 / 源码切换 + 目录（TOC，跳过代码围栏，点击跳转高亮）；HTML 预览 / 可视化 / 源码三段，可视化内建 **GrapesJS** 画布（拖组件、改文字、调样式，保存回写完整 HTML 并保留 head，CSS 写入唯一 `<style data-grapes>`；懒加载）
- **缺模型密钥的可操作引导**：Chat 错误卡片列出要设的环境变量与两种配法，一键跳到 设置 → 执行 → 模型密钥 并聚焦；设置里新增 `dshEnv`（KEY=VALUE 注入本地 dsh）；统计页失败行也可直接去配置
- **设置易用性（参考 reference）**：跨分区搜索（⌘F，命中跳转并高亮）、逐项「恢复默认」、本页恢复默认、「已自动保存」提示、分区 ↑↓ 导航
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
