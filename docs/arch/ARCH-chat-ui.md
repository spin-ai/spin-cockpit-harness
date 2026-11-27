> 层：架构 · 状态：已落地 · 核对：2026-11-24 · 覆盖：Chat 窗口视觉结构（transcript + composer）、对话内预览 / 轨迹细节 / 长会话窗口化与查找，BOT / CHAT 共用

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

## 3.5 长会话与会话内查找（2026-11-24）

| 项 | 规格 |
|---|---|
| 窗口化 | 转录先渲染**最近 40 块**；顶部一行「加载更早 · 还有 N 块」，加载时用 `scrollHeight - scrollTop` 保持当前阅读位置（BOT 与 CHAT 同一口径） |
| 跟随阈值 | 距底 **≤24px** 视为贴底；上翻即停止跟随，出现「N 条新消息 ↓」 |
| 会话内查找 | `⌘F` 打开一条浮动查找条（1:1 / 群聊 / CHAT 同一套）：1:1 按回合、群聊按群消息（含系统行）匹配，最多 12 条按时间倒序，Enter 跳第一条、点击跳到对应位置；命中块闪一下 8% fg（0.9s 淡出），不做整段高亮 |
| 回合轨 | 1:1 一条回复一个刻度；**群聊一轮 = 你发的那一句**（不按每条消息画，否则几十条就成了一把尺子）。两种面都靠行上的 `data-turn-id` 定位，阅读位置 / 查找跳转 / 当前轮高亮共用同一套 |
| 复制 | `⌘⇧C` 复制最近一条回答；`⋯` 里「复制整段对话（Markdown）」按消息拼成可直接贴出去的文本 |
| 反馈 | 助手消息的 `⋯` 里有「赞 / 踩」（同一轮可改，再点同一个 = 撤销）；评过的那一轮带「已赞 / 已踩」小字；`⋯` 里同时展示 tokens / 耗时 / TTFT / 模型 |
| 附件 | composer 左侧 `＋` 选文本文件（≤3 个、每个 4000 字），正文后附「附件 …（path）```内容```」；发送成功即清空 |
| 判据 | 200 轮会话 DOM 不爆；加载更早不跳位；查找命中能定位；附件只在发送时进上下文 |

**不做**：虚拟化（先窗口化）、跨会话搜索结果（用 ⌘K / Chats 搜索）。

## 3.6 对话内预览（2026-11-24）

读结果时不想离开这段对话：工具行里的文件路径**就地**展开一张卡，而不是跳去预览标签。

| 项 | 规格 |
|---|---|
| 位置 | 就在那一步工具行下面（同缩进、同列宽），跟着消息走，不浮起来 |
| 结构 | 头（`文件 / 结果` 标签 + 文件名 + 行数/开窗位置 + 复制全文 + 在标签里打开 + 收起）→ 正文（前 80 行，等宽；结果类可用正文字体） |
| 数据 | `docs:read`（已过滤二进制 / 超大 / 凭据文件）+ 进程内缓存；相对路径按这条 run 的 `cwd` 解析（worktree 里的改动不在项目根） |
| 状态 | `读取中…` / 正常 / `读取失败`（原文照抄 docs:read 的拒绝理由，不吞掉） |
| 唯一性 | **一次只留一张卡**：点新的把旧的换掉，再点同一个收起——转录不能变成文件管理器 |
| 入口 | 只有文件 chip 一个常驻入口；「在标签里打开」是卡片里的次要动作（要编辑 / 看目录时才用） |
| 判据 | 点 chip ≤300ms 出现正文；不新增标签、不切页；卡片收起后滚动位置不变 |

**不做的**：不在聊天里嵌 webview（网页预览仍走预览标签，避免第二个 webview 生命周期）。

**群聊里的同一张卡（2026-11-24）**：群消息正文里的文件路径（最多 3 个）渲染成 chip，点开就地预览；单聊与群聊共用 `InlinePreviewCard`。

**行号命中**：指到 `path:line` 时窗口居中那一行并给 8% fg 底色（只到页级，不做列级定位）。

## 3.6.1 压缩卡（2026-11-24）

`turn.context.digest = true` 的回合前面加一条 `.ds-digest` 系统注记：「已压缩 · 更早的对话折成摘要（保留最近 N 条），只作背景」。
它不是消息，不进会话镜像；展开的摘要正文由主进程维护（`threads.digest`），UI 只说明状态。

## 3.7 轨迹细节（2026-11-24）

「它在干嘛 / 这步到底传了什么」必须能就地查到，不用去别处翻日志。

| 面 | 内容 |
|---|---|
| 会话里的工具行 | 展开后分两段：**参数**（原始入参）与**输出**（完整结果），等宽、可滚动；空段不渲染 |
| 轨迹视图 | 每条记录的详情按字段列出（原始参数 / 输出 / 用量），每个字段带**整段复制**（贴出去的就是原文，不是截断）；工具 / 终端记录另有「复制整步」 |
| 用量 | 任务会话的助手记录带上这次 run 的 `tokens · 时长`；bot 回合同样带 `tokens · TTFT`（来自 `bot_turns.trace`） |
| 判据 | 字段数与内容可复制；空字段不占位；`preview-bot` 断言 `.ds-tr-field` 至少一个且每个都带复制按钮 |

## 3.8 输入的顺滑（2026-11-24）

| 场景 | 规则 |
|---|---|
| 中文输入法 | `compositionstart/end` + `isComposing` + `keyCode 229` 三重判断：候选态的回车**只上屏**，不发消息（BOT 与 CHAT 同一套） |
| 停止 | `Esc` 停当前生成 / 运行；CHAT 里先撤「待发送的界面上下文」，再停运行 |
| 流式 | 增量按帧合并（`requestAnimationFrame`）后再 setState；BOT 另有短打字机（只影响观感，不改落库） |
| 焦点 | 发送成功把焦点交回输入框；失败保留草稿并把焦点留在输入框 |
| 聚焦可见 | composer `:focus-within` 给 **1px hairline**（`outline:1px solid var(--border-strong)`，`outline-offset:-1px`）；不发蓝、不做整块 ring（以前 `:focus-within` 和默认是同一条 `box-shadow`，等于没有反馈） |
| 失败卡 | 发送失败落在**对话里**（`.ds-fail`：原因两行 + 复制 + 收起 + 重试），不再只有页头 banner；重试有回合就按 `turnId` 重跑，没有回合就把原文再发一次（不复制消息、不动草稿） |
| 上下文账 | composer 上方一行：`上下文 12.3k 字符 · 记忆 62% · 8.0k/12.9k · 历史 10 条`；`memoryUsedPct ≥80%` 用琥珀**文字**（不做进度条，不编模型上限） |
| 阅读位置 | 采样 `offset = 那一轮的视口内 y`；还原用 `contentTop - offset`（2026-11-24 修正：原先写 `contentTop + offset`，落点整体偏出两倍）；切走再回来每次都还原，不是只还原第一次 |
| 草稿 | `bot_ui` 按字段合并（只写 scroll 不清草稿）；**切换会话的那一帧不落盘**——那一帧 `draft` 还是上一条的值，写进新 key 会冲掉那条会话的草稿 |

## 3.9 群聊 @ 选择器（2026-11-24）

| 项 | 规格 |
|---|---|
| 位置 | **浮在 composer 上方**（`position:absolute`，左 / 右与 composer 对齐，`bottom:100%+8`），不再占转录高度；打开时消息区不缩、composer 不位移 |
| 尺寸 | `max-height:min(360px,45vh)`，超出由列表自己滚（`overscroll-behavior:contain`）；**命中项不截断**，列全体成员 + `@everyone`，头上一行 `@筛选 / N 人` |
| 键盘 | `↑/↓` 移动高亮、`Enter` / `Tab` 插入、`Esc` 关闭（关掉后同一个 `@` 里继续打字不再弹回，换位置才弹）；打开时 `Enter` **不发送**（避免把半截 `@` 发出去） |
| 打开条件 | `@` 在行首或空白之后，且 `@ → 光标` 之间没有空白；`@张三 你好` 这类「已经在写正文」的自动收起 |
| 收起 | 插入 / 失焦 / 发送 / 光标移出 token 都收起；发送后不留残影 |
| 焦点 | 点选不抢焦点：`mousedown preventDefault`，插入后把光标放到插入内容之后（继续打字不掉） |
| 歧义 | 短名撞车时插入**全名**，否则发送端会按「写法有歧义」把整句拒掉（见 [`REQ-bot-group`](../product/REQ-bot-group.md) SR-G02） |
| 可访问性 | 弹层 `role=listbox` + 每行 `role=option` / `aria-selected`；输入框带 `aria-expanded` / `aria-controls` / `aria-activedescendant` |
| 判据 | `preview-bot` 断言：弹层在 composer 上方、列出全体、`↑↓` 换高亮、`Enter` 插入不发送、焦点回输入框且光标在末尾、空格收层、发送不残留 |

## 3.10 审批：不挡界面，粒度跟任务走（2026-11-24）

**问题**：ACP 每要写一个文件 / 跑一条命令就发一次 `session/request_permission`，而人已经在「开跑」时授权过这件事。
原来每次弹一个整屏模态（一次只画 `approvals[0]`），人在任务跑起来之后既不能改文件也不能看日志，只能连点。
与 ORCA `@ 14c614651` 的差距：它的权限是**按会话选一次**（`ask / accept-edits / auto / full-access`，ACP 只给 ask / full-access），
审批卡贴在 composer 上方、可折叠可堆叠；我们是按调用弹一次、整屏挡。

| 项 | 规格 |
|---|---|
| 队列位置 | 右下角一叠卡（`.approval-dock`，和 `.errcard` 同一套位置语言），**没有 `modal-mask`**；有多条时顶部一行「还有 N 个等你批」 |
| 每条 | 标题 · 子任务（`childTitle`）· 原始描述（等宽、最多 120px 高、可滚）· 选项（按 ACP `options` 渲染，第一个 allow 是 primary）· 「去会话」 |
| 不做 | 不抢焦点；不用 `role=dialog` / 焦点陷阱（它不是模态）；不再一次只画一条 |
| 任务审批档 | `todo.permission`: `ask`（缺省）/ `full-access`。入口是 composer 里的「审批 · 逐条问 / 审批 · 本任务放行」，放宽前要人确认；**bot 不能改**（`tools.mjs` 不暴露） |
| 落到哪 | `startRun` 按任务注入 `DSH_PERMISSION_MODE`：`ask → workspace-write`（approval ask）、`full-access → danger-full-access`（approval never）。本地走 env，远端拼进 ssh 环境前缀；`run.permission` 与一条 system 行留痕 |
| 为什么不是 harness 代答 | dsh 的 acp profile 里 approval policy 由这个环境变量推导（`--dump-config` 可见），所以「不再逐条问」是 agent 侧的真实语义，sandbox 一起变；ACP 面本身没有权限档（`session/new` 的 `configOptions` 只有 model / reasoning_effort） |
| 只影响下一次 | 改档不会动已经在跑的进程；`settings.dshEnv` 里的同名变量会被任务档覆盖（任务的决定更具体） |
| 授权前告知 | 选择器 title 写清「执行体是谁 + 它自己的审批设置（跟随全局 / 每步询问 / 自动批准 / 自动拒绝）+ 放行档下 dsh 不发请求」；选了放行之后选择器常驻**琥珀文字**（`--amber`，不加底色 / 徽标），一眼能看出这个任务现在是敞开状态 |
| 执行体级 override | 设置 → 执行 → Agent 角色：`agent.approval`（空 = 跟随全局）。它只决定「收到请求时怎么答」，任务级的「本任务放行」在它上游 |
| 超时 | ACP 权限请求没有时限：**有人看着 10 分钟、无人值守 3 分钟**没人处理 → 按拒绝收尾（`respondPermission(..., false)`）、run 回 `running`、会话里写「审批超时（N 分钟…）：按拒绝处理 · 那一步是什么」。`COCKPIT_APPROVAL_TIMEOUT_MS` 可覆盖，`0` = 不限时 |
| 状态文案 | `waiting_input` 有两种：挂着审批时 run 带 `waitingFor: "approval"` → 进展行写「等你审批」；其余（agent 问了问题）写「等你回答」。两者在任务列表里仍是同一个状态，不改调度 |
| 自动策略 | `approvalPolicy = allow` 时**不逐条写 system 行**（长任务会被「自动批准：…」刷满）：逐条只记 `run.approval` 事件 + 计数，run 结束时写一条「自动批准 N 次（明细在轨迹里）」；`deny` 会改变这次 run 能做什么，仍然立刻留痕 |
| 无人值守的前提 | `run_start` 要求任务已是 `full-access`，否则直接回「无人值守要先把这个任务设成「本任务放行」」（`electron/bot/approval.mjs` 的 `UNATTENDED_NEEDS_RELEASE`） |
| 判据 | `preview-bot`：队列出现时 `modal-mask` 数为 0、点选项按 `optionId` 回传、批完消失；任务审批档选择器可改、放宽要先确认、确认后写 `setTodoPermission`。`tests/bot/approval.test.mjs`：时限默认值 / 覆盖 / 无人值守判定 / 超时说明 |

## 4. 代码位置

| 内容 | 位置 |
|---|---|
| Chat 窗口（项目 / 任务会话） | `src/components/TaskChat.tsx`（`ChatMessage` / `ThoughtBlock` / `ToolGroup` / `ToolRow` / `LiveStatus` / composer） |
| Chat 的挂载位置 | 工作台里它是**终端窗格的第一个标签**（`TerminalPanel` 的 `CHAT_TAB_ID`，内容由 `src/App.tsx` 传 `chat` 节点）：跟当前选中的任务走，⌘J 直达；左栏只剩任务 / 项目两段 |
| 机器人的会话面（BOT 页） | `src/components/Bot.tsx`（`bot-stream` / `bot-composer`） |
| 共用视觉 | `src/styles.css` 末尾「Chat 窗口：照搬 deepseek-harness」一节（`.ds-*`） |
| 对话内预览 | `src/components/InlinePreview.tsx`（`useInlinePreview` / `InlinePreviewCard`）；挂点：`TaskChat`（工具行）与 `Bot.tsx`（`ToolCard` 的 read 家族） |
| 轨迹细节 | `src/components/TrajectoryView.tsx`（`TrField` 字段复制）；`TaskChat` 的 `ToolRow` 参数/输出两段 |
| 圆角 token | `src/design-system.css` 的 `--radius-chat-bubble` / `--radius-chat-composer` |
| 渲染层截图 | `npm run preview:bot` → `.preview/bot-chat.png` / `bot-chat-dark.png` |

## 5. 验证

- `npm run typecheck` / `npm run build` / `npm run verify:design`
- `npm run preview:bot`：亮暗各一张截图（含 `bot-mention*.png` 的 @ 弹层）；断言消息正文（代码块 / 列表）、动作（引用 / 分支）、附件、分支 IPC、@ 选择器的键盘 / 焦点 / 收起都在。
- 重点看：内容列是否居中、用户气泡是否右对齐、工具行是否 24px 一步一行、composer 是否 28px 且发送为圆形、暗色是否同构。

## 6. 明确未做

| 能力 | 说明 |
|---|---|
| token 级流式动画 | 消息按 run 落库，靠「正在深入处理」提示 |
| 消息虚拟化 | 长会话仍一次性渲染 |
| 附件图片 / 拖拽上传 | 只有文本文件附件（BOT 页最多 3 个） |
| 会话内搜索 | 未做；用 ⌘K 或左侧 Chats 搜索 |
| 聊天内嵌网页预览 / 图片预览 | 未做：网页与图片仍走预览标签（不引入第二个 webview 生命周期） |
| 图片附件 / 拖拽上传 | 未做：目前只收文本文件（`docsPick`） |
| ~~消息反馈（赞 / 踩）~~ | 2026-11-24 已做：`bot_turns.feedback` + `botFeedback`，只改一列、可撤销 |
| 隐藏 surface 收敛 | 未做：工作台始终挂载（pty 需要），Bot 页上仍挂着一份 `TaskChat`；查找 / 附件/快捷键都按「可见」判定 |
| 虚拟化 | 未做：窗口化后先观察 200+ 轮的实际节点数，再决定要不要上 virtualizer |
| 行内按行号高亮定位 | 未做：文件卡只按行号开窗，不跳转到那一行并高亮 |
| Turn 折叠的动画差分 | 只保留基础 100–160ms 过渡，不做 DeepSeek 的布局动画编排 |
