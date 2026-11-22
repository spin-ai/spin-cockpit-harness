> 层：架构 · 状态：已落地 · 核对：2026-11-22 · 覆盖：Chat 窗口视觉结构（transcript + composer），BOT / CHAT 共用

# Chat UI（会话界面）

> 唯一参考：**deepseek-harness 的浏览器 Chat**（`packages/client/ui-chat`、`ui-conversation`、`ui-primitives`）。
> 本仓库的 Chat 窗口不再自创一套：用户气泡、agent 扁平正文、过程折叠、运行行、composer 全部照搬它的结构 / 字号 / 间距 / 圆角。
> 会话数据模型见 [`ARCH-chat-thread.md`](ARCH-chat-thread.md)，机器人链路见 [`ARCH-bot.md`](ARCH-bot.md)。

---

## 1. 照搬对照（DeepSeek → 本项目）

| DeepSeek 结构 | 本项目类名 | 取值 |
|---|---|---|
| 用户消息右对齐气泡（`UserMessageBubble`） | `.ds-user` / `.ds-bubble` | 最大 82% / 560px，`radius 20`，padding 10/16，14/22，浅蓝 `#edf3fe`（暗色 `#2c2c2e`） |
| Agent 正文（`AssistantMarkdown`） | `.ds-assistant` / `.ds-assistant-body` | 扁平、无气泡、14/24，块间距 16 |
| 消息动作（`MessageIconActions`） | `.ds-actions` / `.ds-action` | 28px 图标行，15px 图标，hover 才出底色 |
| Turn 头（`TurnProcessNodeView`） | `.ds-turn-head` / `.ds-process-head` | 33px 行 + 下方 `.5px` hairline；chevron 14；标题 13 |
| 思考行（`ReasoningRow`） | `.ds-reason` | 24px 一行：图标 + 「已深度思考」+ 摘要；正文缩进 22px |
| 工具行（`ToolRow` + `DisclosureRow`） | `.ds-tool-row` | 24px 一步一行：16px 图标位 / 14px glyph + 标题 + 2px 圆点 + 摘要；hover 露 chevron / 复制 |
| 运行中（`RunningStatus`） | `.ds-running` | 蓝色 shimmer 一行：图标 + 「正在深入处理 · 已用 12s」；展开看步骤 |
| 历史 / 状态分割线 | `.ds-system` / `.ds-divider` | 两侧 hairline + 居中说明 |
| Composer（`InputBar`） | `.ds-composer` | `radius 28`、soft elevation、14/24 输入；工具栏 28px；发送 34px 圆形蓝底箭头 |
| 内容列 | `.chat-pane .chat-scroll > *` / `.bot-main .bot-stream > *` | `max-width 748`（DeepSeek 默认列宽）居中；scroller 满宽、正文不撑满 |

颜色只落在两处：运行 / 发送用 DeepSeek 蓝（`#416ee6`，暗色 `#7aaaff`），用户气泡用 `#edf3fe` / `#2c2c2e`。
其余全部走现有 token（`--fg` / `--muted` / `--faint` / `--border` / `--surface` / `--page-canvas`）。

## 2. 结构

```
.chat-pane / .bot-main                 ← 共用同一套 .ds-* 语言
├─ transcript（.chat-scroll / .bot-stream）
│  ├─ .ds-divider                      日期 / run 边界
│  ├─ .ds-user + .ds-bubble            右对齐用户消息
│  ├─ .ds-assistant                    扁平 agent 正文
│  │  ├─ .ds-assistant-body            Markdown（代码卡 10px 圆角）
│  │  └─ .ds-actions                   复制 / 重新生成 / 时间
│  ├─ .ds-reason                       思考摘要（点开全文）
│  ├─ .ds-process                      工具 / 步骤折叠（33px + hairline）
│  │  └─ .ds-tool-row                  一步一行；展开 .ds-tool-body
│  ├─ .ds-running                      运行中 shimmer（展开步骤）
│  └─ .ds-system                       系统说明 / 继承分割线
└─ .ds-composer                        28px 卡片
   ├─ textarea.ds-composer-input       14/24，最多 200px 高
   └─ .ds-composer-bar
      ├─ .ds-composer-tools            ＋ 附件 / Agent / 作用域 / 工具开关
      └─ .ds-composer-trailing         模型 / 34px 圆形发送
```

## 3. 关键细节

### 3.1 用户消息

- 右对齐、无头像、无 meta 行；时间与复制 / 编辑放在气泡下方的 `.ds-actions`。
- 气泡 `white-space: pre-wrap`；代码块用同一套轻量 Markdown。
- 编辑态是同一位置的 20px 圆角文本域 + 「保存并发送 / 取消」。

### 3.2 Agent 消息

- 每条回复上方先有一行 **Turn 头**：`已完成，用时 1秒` / `已汇报，用时 1秒`，下方 `.5px` hairline；有工具时这一行就是过程折叠的开关。
- 不包气泡、不加头像、不再逐条写 sender 名；正文 14/24，最大宽度跟随内容列。
- 动作行在正文下方 8px：复制、重新生成（最后一条且未确认时）、引用 / 分支、时间。
- 失败 / 缺密钥卡片仍是独立块，不塞进正文。

### 3.3 过程与工具

- 连续 `tool` / `thought` 收成 `.ds-process`；默认 ≤2 步展开、>2 步折叠；头部只写「已完成，用时 X秒」+ chevron，不重复步数 / 成功数。
- 工具行按工具名自动选 glyph（bash / read / edit / search / web / 通用扳手），一步一行，不画卡片。
- 输出展开是 10px 圆角的 code 卡（最多 240px 高，独立滚动）。
- 思考块不再用紫色左边框，改为 DeepSeek 的一行摘要 + 缩进正文。

### 3.4 运行与 composer

- 运行中只有一行蓝色 shimmer；项目 / Agent / 步数细节收进右侧 chevron。
- Composer 是 DeepSeek 的 28px 卡片：上方输入、下方两栏；发送是 34px 圆形箭头（disabled = 0.4）。
- 作用域 / Agent / 模型保留为无边框 chip select；不再显示 Enter 提示文案。
- 发送按钮的颜色语义（派活 / 纠偏 / 只聊）只通过 `title` / `aria-label` 体现，圆形仍是蓝色。

### 3.5 窄面板

- 内容列 `748` 是上限，面板不足时自动收窄；composer 比正文列宽 32px（左右各 16 的顺手边距）。
- `.ds-composer-bar` 允许换行：先收工具栏，再换 trailing（模型 + 发送）到第二行。
- 用户气泡最大 82% / 560px，不会在 280px 面板里撑破。

## 4. 代码位置

| 内容 | 位置 |
|---|---|
| Chat 窗口（项目 / 任务会话） | `src/components/TaskChat.tsx`（`ChatMessage` / `ThoughtBlock` / `ToolGroup` / `ToolRow` / `LiveStatus` / composer） |
| 机器人的会话面（BOT 页） | `src/components/Bot.tsx`（`bot-stream` / `bot-composer`） |
| 共用视觉 | `src/styles.css` 末尾「Chat 窗口：照搬 deepseek-harness」一节（`.ds-*`） |
| 圆角 token | `src/design-system.css` 的 `--radius-chat-bubble` / `--radius-chat-composer` |
| 渲染层截图 | `npm run preview:bot` → `.preview/bot-chat.png` / `bot-chat-dark.png` |

## 5. 验证

- `npm run typecheck` / `npm run build` / `npm run verify:design`
- `npm run preview:bot`：亮暗两张截图；断言消息正文（代码块 / 列表）、动作（引用 / 分支）、附件、分支 IPC 都在。
- 重点看：内容列是否居中、用户气泡是否右对齐、工具行是否 24px 一步一行、composer 是否 28px 且发送为圆形、暗色是否同构。

## 6. 明确未做

| 能力 | 说明 |
|---|---|
| token 级流式动画 | 消息按 run 落库，靠「正在深入处理」提示 |
| 消息虚拟化 | 长会话仍一次性渲染 |
| 附件图片 / 拖拽上传 | 只有文本文件附件（BOT 页最多 3 个） |
| 会话内搜索 | 未做；用 ⌘K 或左侧 Chats 搜索 |
| Turn 折叠的动画差分 | 只保留基础 100–160ms 过渡，不做 DeepSeek 的布局动画编排 |
