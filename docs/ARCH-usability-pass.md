# 易用性改进（Usability Pass）

> 范围：Workspace / TODO / Chat / Terminal / 资源管理器 / 项目 / 收件箱 / 统计 / 主机 / 设置 / 命令面板 / 审批。
> 本文只记录本轮已落地项和仍然明确未做的重型能力；细节参考各模块 ARCH 文档。

## 1. P0｜语义与入口

- **Chat 草稿发送 = 派活**：UI 的 `willRun/baseMode` 与后端行为对齐；草稿发送会创建 TODO 并起 run，按钮显示「派活」，placeholder 明确说明。不再出现「显示发送、实际派活」的歧义。
- **统计范围显式化**：Stats 改为使用全量 state，顶部增加「全部项目 / 单项目」范围选择；「按项目」分组现在能看到多个项目；范围切换即时重算。
- **审批选项完整**：`ApprovalModal` 按 ACP `options` 渲染所有选项（allow once / always / reject…），提交 `optionId`；后端 `AcpClient.respondPermission` 支持指定 option；显示还有 N 个待审批；增加 `role=dialog`、焦点陷阱、首项自动聚焦。
- **命令面板上下文安全**：跨页面命令不再静默空操作。执行终端/任务命令时先切回 workspace 并等面板挂载再派发；终端收起时自动展开；命令列表增加分组，并支持搜索任务、会话和项目。
- **TODO 键盘可访问**：任务行 `role=button` + `tabIndex=0`，Enter/Space 选中；`:focus/:focus-within` 时显示快捷操作；搜索扩展到描述和标签。
- **入口补齐**：Rail 增加「项目」「收件箱」，收件箱带未读徽标；`Inbox` 组件真正挂载。

## 2. P1｜日常效率

- **终端窄面板**：container query 下隐藏低优先入口（品牌、打开项目、查找图标），保证 Agent/预览/终端/收起可用；文件预览头在窄标签里换行，网页预览工具栏也允许换行。
- **窗格入口**：单窗格在 hover 时也显示拆分按钮；多窗格保持常显。
- **资源管理器**：默认隐藏点文件；工具栏新建按钮的 title 显示目标目录；Markdown 相对文档链接可直接打开为新的文件预览标签。
- **主机**：SSH 主机支持编辑（地址/用户/端口/远端 cwd）；`并发` 改为失焦/Enter 提交，避免每按一个字符就写库；批量探测有 loading；Agent 切换主机有确认。
- **设置**：分区说明恢复渲染；终端字号移到「终端」分区；关键项补充 hint；默认模型改为「高级」并明确推荐在 Chat 底部选择。
- **统计**：每日趋势支持成功/失败图例和空态；范围「今天」明确标为 24h；失败分类/分组/失败列表保留。
- **命令面板**：分组（导航/任务/终端/项目/布局/会话）、token 搜索、当前项目标记、选中项自动滚入视野、Tab 焦点陷阱。
- **可访问性**：全局 `:focus-visible` ring、`prefers-reduced-motion` 降级、toast `role=status`/`aria-live`。

## 3. 仍然明确未做（重型）

| 能力 | 原因 |
|---|---|
| 附件 / 图片粘贴 / 拖拽上传 | 需要新增上传存储、ACP prompt 附件协议和消息渲染 |
| 消息编辑 / 重新生成 / 导出会话 | 需要新的 run 语义与消息版本 |
| 文件树多选 / 拖拽移动 / 拖入上传 / 深层全文搜索 | 需要后端批量文件操作和索引 |
| 会话历史未读 / 置顶 / 删除 / 虚拟化 | 需要 session 状态与虚拟列表 |
| 统计 run 详情 / stdout / 成本 | 目前 run 未持久化完整日志；需要日志存储与查看器 |
| 原生 confirm 统一为应用内对话框 | 涉及所有删除/停止入口，单独做安全确认组件 |
| 终端新建继承 shell 当前 cwd、运行中关闭确认、文件路径链接、拖放路径 | 需要前台进程/cwd 探测与更深的 pty 集成 |
| Markdown 相对图片、HTML 依赖限制 | 需要本地资源代理或图片内联 |
| 自定义快捷键 / i18n / 跨平台窄屏 | 属于产品级扩展 |
| 全量 state 广播优化 / Chat/文件树虚拟化 | 需要状态分层与虚拟滚动 |

## 4. 验证

- `npx tsc --noEmit`、`node --check electron/{main,db,acp}.mjs`、`npm run build`
- 实机：Rail 项目/收件箱、统计范围与图例、设置说明、命令面板分组/任务搜索、任务行 tabIndex、资源管理器点文件默认隐藏、1180px 下终端栏与文件预览不溢出、跨页面终端命令自动切回 workspace。

## 4. 视觉收口（2026-11）：颜色 / 圆角 / 字号对齐 Design System

按 `docs/DESIGN-SYSTEM.md` 做了一次全站 token 收口，改动集中在 `src/styles.css` / `src/design-system.css`，不动布局与交互。

| 项 | 之前 | 现在 |
|---|---|---|
| 语义色 | 硬编码 `#15803d` / `#92400e` / `#6d28d9` / `#fef2f2` … 约 130 处，暗色另写一套 `#86efac` / `#1d1a10` | 一律 `var(--green/--amber/--purple/--red)` 与 `-soft/ -line`；暗色覆盖块直接吃主题 token |
| 选中 / 运行蓝 | `#1d4ed8` 同时表示选中、运行、链接 | `var(--brand)`（中性），蓝色不再兼职 |
| 中性色 | `#f4f4f5` / `#e4e4e7` / `#a1a1aa` / `#52525b` | `--surface-hover` / `--border` / `--faint` / `--muted` |
| 圆角 | 7 / 9 / 11 / 12 / 13 / 16px 混用 53 处 | `--radius-sm` / `--radius` / `--radius-lg`，0 处一次性值 |
| 一级标题 | `.page-head h2` 18px，与 `PageHeader` 22px 并存 | `var(--text-title)` 22px |
| 中文小字 | 审计出 13 处内容型中文 < 11.5px（终端 Agent 分组、Chat 空态说明、空态提示、右栏说明…） | 正文 11.5–12px；仅时间 / 快捷键 / 状态保留 10–10.5px |

保留的硬编码颜色：终端 / xterm 的深色 chrome（`term-*`、`--term-bg` 等），它们是跨主题恒定深色，不属于语义色。

验证：`typecheck` / `build` / `verify:plugins` / `verify:design`；8 个一级页面 × 亮暗各截图对照；
用 CDP 遍历文本节点做「中文 < 11.5px」审计，改完后仅剩提示类 11px 小字。
