> 层：需求 · 状态：部分落地 · 核对：2026-11-24 · 覆盖：Bot 会话窗口 / 群聊的 User Story（US-Chat）与界面规格 IR、系统规格 SR，全部带判据、现状与验证方式

# 需求 · Bot 聊天窗口（US / IR / SR）

**用途**：`COMPARE-chat-window.md` 只回答「差在哪」；本文把它变成**可开工的规格**：先 13 条用户故事（带判据），再拆成 12 条界面规格（IR）与 14 条系统规格（SR），每条都写明现状、依赖与怎么验。

**范围**：`Bot.tsx` 的会话面 —— 1:1 对话、群聊、转录、composer、回合轨、跟随、长会话、对话内预览与轨迹细节。任务会话（`TaskChat`）共用同一套 `.ds-*` 视觉与同一套预览 / 细节组件；它自己的领域语义见 `GAP-chat.md`。

**依据**：源码 + 装机包实测（`COMPARE-chat-window.md` §1–§6）；对照对象 `deepseek-harness @ 39163dd3`、`Orca @ 8e0c267e`。

---

## 0. 图例与编号

| 项 | 约定 |
|---|---|
| 用户故事 | `US-Chat-NN`：一句话 + 括号里的**判据**（做到什么算成立） |
| 界面规格 | `IR-Chat-NN`：放哪、长什么样、有哪几个状态、交互怎么变 |
| 系统规格 | `SR-Chat-NN`：IPC / 字段 / 落库 / 阈值 / 失败语义 |
| 现状 | ✅ 已成立　◐ 部分　✗ 没有 |
| 优先级 | P0 = 用着就撞上；P1 = 「像聊天」的底线；P2 = 打磨 |

**追溯关系**：`US → IR（界面怎么给）→ SR（系统怎么撑）`；一条 US 至少一条 IR，一条 IR 至少一条 SR。

---

## 1. 用户故事（带判据）

| #          | 用户故事（判据）                                                                                     | 现状                            | 参照                                     | 优先级  |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------- | ---- |
| US-Chat-01 | 我说一句话，立刻看到它进了对话（判据：发送后 ≤100ms 出现自己的句子；模型没回时有一行「在回」的占位）                                       | ✅                             | Orca / dsh 都有本地回声                      | P0，改 |
| US-Chat-02 | 说到一半我能叫停（判据：点「停止」≤1s 内该轮停止；那条消息留痕为「已停止」，不是凭空消失）                                              | ◐ 1:1 断掉后不留半截                 | dsh：中断保留已生成前缀                          | P0，改 |
| US-Chat-03 | 跑的时候我知道它在干什么（判据：工具调用发生时，聊天里出现「正在调用 X」，完成后同一行变成结果摘要 + 耗时；不用等整轮结束）                             | ✗ 工具事件无人订阅                    | dsh 工具卡随流程生长；Orca 工具行同流                | P0，改 |
| US-Chat-04 | 长会话不卡（判据：200 轮的会话首屏可交互 ≤1.5s；滚动 p95 帧 ≤16ms；DOM 节点 ≤3000）                                    | ✗ 36 条 = 2415 节点              | dsh 分页 + 虚拟化；Orca `virtualizer` 常驻     | P0，改 |
| US-Chat-05 | 窗口跟着新内容走，但不抢我的位置（判据：贴底时自动跟随；我上翻 ≥24px 后不再跟随；有新内容时出现「N 条新消息 ↓」，点它回底）                          | ✅ 阈值 24 + 手势归属 + 「N 条新消息」 | dsh `ScrollFollow`（阈值 24 + 手势归属）       | P1，改 |
| US-Chat-06 | 切走再回来还在原处（判据：切会话 / 重开应用回到上次位置 ±80px）                                                         | ✅ turnId + offset，500ms 采样，切回来落原处 | dsh 位置采样 500ms + 恢复                    | P1，改 |
| US-Chat-07 | 我打了一半的字不会丢（判据：切会话、崩溃重启后草稿还在；发送失败原文回填输入框）                                                     | ✅ 500ms 节流落库 + 切会话取回 | Orca 草稿（IndexedDB + journal）           | P1，改 |
| US-Chat-08 | 中文输入不出错（判据：拼音候选里按回车只上屏，不发送；Shift+Enter 换行；⌘/Ctrl+Enter 发送）                                   | ✗ 没有 composing 判断             | dsh `keyboard-composition.ts`          | P0，改 |
| US-Chat-09 | 对一条消息能重试、追问、分支（判据：重试用同一条输入重跑且不重复原消息；引用只带 1–3 行；分支复制到新会话而源会话不动）                               | ◐ 复制 / 引用 / 分支 / 重试已做；赞踩未做 | dsh `MessageIconActions`（复制 / 分支 / 用量） | P1，改 |
| US-Chat-10 | 出错时我在聊天里就能看到并重试（判据：失败卡写明原因 + 「重试」；草稿不丢；不只剩页头一条 banner）                                       | ✅ 2026-11-24（`.ds-fail`；重试按 `turnId` 或重发原文） | Orca `messages/notices/`；dsh 失败卡       | P1 |
| US-Chat-11 | 上下文快满时我提前知道（判据：占用 >80% 时 composer 上方有提示；压缩后留下「已压缩 N 轮 → 摘要」卡） | ✅ 2026-11-24（上下文账 + `.ds-digest` 压缩注记；摘要正文仍由主进程维护） | dsh compaction 卡 + quota 提示 | P2 |
| US-Chat-12 | 读屏和键盘也能完整用（判据：转录是 `role=log` 且 `aria-live`；每条有可读发送者 / 状态；输入框有 `aria-label`；Esc 停止；发送后焦点回输入框） | ◐ role=log / article / label 已做；Esc 停止与焦点恢复未做 | dsh 大量 `aria-live` / 语义角色              | P1，改 |
| US-Chat-13 | 群聊里每条回复独立可读、可单独处置（判据：谁回的 / 何时 / 状态标签齐全；能单独停止；失败能单独重试）                                        | ◐ 有标签与停止，无重试                  | Orca 消息卡（sender chip / peer card）      | P2，改 |
| US-Chat-14 | 我读结果不用离开对话（判据：工具行里的文件路径点一下就展开正文，不新增标签、不切页；卡片里仍能「在标签里打开」；再点一次收起） | ✅ 2026-11-24（BOT 与 CHAT 共用 `InlinePreviewCard`） | — | P1 |
| US-Chat-15 | 轨迹能查到「这步传了什么、回了什么」（判据：工具行展开分「参数 / 输出」两段；轨迹视图每字段可整段复制；助手记录带 `tokens · 时长`） | ✅ 2026-11-24 | dsh 的 usage 明细 | P1 |

---

## 2. 界面规格（IR）

> 位置一律相对 `Bot.tsx` 的会话面；尺寸/颜色只取 token（`docs/DESIGN-SYSTEM.md`）。「状态」是必须画出来的状态机，缺一个就不算交付。

### IR-Chat-01 流式块（1:1 与群聊同一套）

| 项 | 规格 |
|---|---|
| 位置 | 转录末尾（群聊按 `botId` 各一块，顺序 = 主进程回复顺序） |
| 结构 | 头（发送者名 · 状态标签 · 「停止」文字按钮）→ 正文（增量文本 + 2px 光标）→ 工具行区（IR-Chat-02） |
| 状态 | `streaming`（光标闪）→ `done`（由正式消息接管，块消失）/ `stopped`（保留半截 + 「已停止」）/ `failed`（IR-Chat-08） |
| 判据 | 块出现 ≤100ms；`stopped` 时半截文本不丢；正式消息落库后不重复显示 |
| 关联 | US-Chat-01/02/03/13 |

### IR-Chat-02 工具行（流式期内）

| 项 | 规格 |
|---|---|
| 位置 | 流式块正文下方，与正文同缩进 |
| 结构 | `状态点 · 工具名 · 参数摘要`（单行省略）+ 右侧耗时；点击展开 3 行（原始参数 / 结果摘要 / 错误） |
| 状态 | `running`（点闪，耗时递增）→ `ok` / `failed`（点变色，`--green` / `--red`，不用彩色底） |
| 判据 | 同一工具重复调用各占一行；一轮结束折叠成「工具 3 次 · 2.1s」 |
| 关联 | US-Chat-03 |

### IR-Chat-03 转录语义与可访问性

| 项 | 规格 |
|---|---|
| 位置 | `.bot-stream` 容器 |
| 规格 | 容器 `role="log"` + `aria-live="polite"` + `aria-relevant="additions text"`；每轮块 `role="article"` + `aria-label="{发送者} · {时间}"`；流式块的「停止」是真实按钮（可 Tab 到） |
| 判据 | 读屏能一次听完「谁在什么时候说了什么」；流式增量不重复朗读整段 |
| 关联 | US-Chat-12 |

### IR-Chat-04 回合轨

| 项 | 规格 |
|---|---|
| 位置 | 会话面右侧贴边 4px，垂直居中区（top 88 / bottom 150） |
| 结构 | 2px 细线：常态 12px、悬停/当前 20px；当前轮 `--fg`、其余 `--border-strong`；hover 出预览卡（248px，头「谁 · 第 N 轮 · 时间」+ 正文 3 行截断，`pointer-events:none`） |
| 状态 | `idle` / `active`（随滚动同步）/ `busy`（P2：该轮正在生成时细线脉冲）/ `unloaded`（P2：历史未加载，虚线） |
| 判据 | 27 轮不重叠、可滚；键盘 `↑/↓` 在轨内移动焦点 |
| 关联 | US-Chat-05/06 |

### IR-Chat-05 新消息提示

| 项 | 规格 |
|---|---|
| 位置 | 转录右下角，距底 12px 浮起 |
| 结构 | chip（高 28px，圆角 14px）「N 条新消息」+ 向下箭头；`role="status"` |
| 状态 | 仅当「不在贴底」且「有新内容」时出现；点击 → 平滑回底并把 follow 置为 active |
| 判据 | 上翻时绝不自动跳；提示数字随新块递增；回底后消失 |
| 关联 | US-Chat-05 |

### IR-Chat-06 消息动作行

| 项 | 规格 |
|---|---|
| 位置 | 每条消息下方 28px 图标行（用户消息靠右、助手靠左） |
| 常驻 | 复制 / 引用 / 分支（有 thread 时）/ 重试（仅助手且非最新一条时隐藏，避免和「继续」打架） |
| 低频 | 赞踩 + 用量明细进 `⋯`（RowMenu） |
| 判据 | 一行 ≤4 个常驻图标；尺寸 `--icon-size` 20px、缝 1–2px；纯图标有 `title` + `aria-label` |
| 关联 | US-Chat-09 |

### IR-Chat-07 composer

| 项 | 规格 |
|---|---|
| 位置 | 底部常驻；群聊多一行「谁回」选择 |
| 结构 | 自增高 textarea（1 行 22px → 5 行 120px）；左「+」（附件，群聊必须与 1:1 同效）；右「模型」（仅 1:1）→「发送」（34px 圆）/ busy 时换「停止」 |
| 状态 | `empty`（发送禁用）/ `draft`（草稿已落库）/ `busy`（发送 → 停止）/ `ime`（composing 中，Enter 不发送） |
| 判据 | 附件在群聊里要么随消息发出、要么隐藏入口并说明；草稿切换不丢；`aria-label="说点什么"` |
| 关联 | US-Chat-07/08 |

### IR-Chat-08 失败卡

| 项 | 规格 |
|---|---|
| 位置 | 转录内、失败那一轮的位置（不是页头） |
| 结构 | hairline 卡：`没回：{原因}`（≤2 行，可展开全文）+「重试」/「换个说法」 |
| 判据 | 重试复用原输入；失败卡不会顶掉用户已经打好的草稿 |
| 关联 | US-Chat-10 |

### IR-Chat-09 上下文占用提示

| 项 | 规格 |
|---|---|
| 位置 | composer 上方 11px 一行，右对齐 |
| 内容 | `上下文 62% · 12.3k / 20k`；>80% 用 `--amber` 文字（不用底色）；压缩发生时追加一行系统注记 |
| 判据 | 数字与真实估计一致（±5%）；不做成进度条 |
| 关联 | US-Chat-11 |

### IR-Chat-10 空态

| 项 | 规格 |
|---|---|
| 群聊 | `群里还没人说话` + 「@名字 / @everyone / 谁回」三条提示（已落地） |
| 1:1 | `还没有回合` + 「点右上跑一次决策」（已落地） |
| 判据 | 两个空态不互相串用（群聊曾错用 1:1 文案） |
| 关联 | — |

### IR-Chat-11 滚动策略

| 项 | 规格 |
|---|---|
| 阈值 | 距底 ≤24px 视为贴底 |
| 手势 | 用户滚轮 / 触摸 / ↑↓ / 拖动滚动条 → 立即退出跟随；程序滚动不改变跟随意图 |
| 动画 | 追底用 `smooth`；用户手势打断时 `instant` 落到当前位置；`prefers-reduced-motion` 一律 `instant` |
| 判据 | 上翻 30px 后新内容不抢位置；回到底部后恢复跟随且不抖动 |
| 关联 | US-Chat-05 |

### IR-Chat-13 对话内预览（US-Chat-14）

| 项 | 规格 |
|---|---|
| 位置 | 该步工具行正下方，同缩进；跟着消息滚动，不浮起、不遮挡转录 |
| 结构 | `文件/结果` 标签 + 文件名 + `N 行 · 从第 M 行` + 复制全文 + 在标签里打开（仅文件）+ 收起 |
| 状态 | `读取中…` / 正文（前 80 行）/ `读取失败`（原文照抄 `docs:read` 的拒绝理由） |
| 唯一性 | 一次一张：点新的换旧的，点同一个收起 |
| 判据 | ≤300ms 出现；不新增标签；收起后滚动位置不变 |

### IR-Chat-14 轨迹细节（US-Chat-15）

| 项 | 规格 |
|---|---|
| 会话工具行 | 展开后「参数 / 输出」两段，等宽可滚动；空段不渲染 |
| 轨迹视图 | 每条记录详情按字段列出（原始参数 / 输出 / 用量），字段头右侧一个复制按钮；工具 / 终端记录另有「复制整步」 |
| 用量 | 任务会话助手记录：`tokens · 时长`；bot 回合：`tokens · TTFT`（`bot_turns.trace`） |
| 判据 | 每个字段都能整段复制；空字段不占位 |

### IR-Chat-12 键盘

| 项 | 规格 |
|---|---|
| 输入框 | Enter 发送（按 `settings.enterToSend`）/ Shift+Enter 换行 / ⌘Enter 发送 / **composing 时一律不发送** |
| 会话面 | Esc 停止当前生成；`⌘⇧C` 复制最近一条助手消息；发送后焦点回输入框 |
| 判据 | 拼音候选回车不发送；焦点不会掉到 body |
| 关联 | US-Chat-08/12 |

---

## 3. 系统规格（SR）

| #          | 规格                                                                                                                                                                          | 现状          | 关联 IR           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| SR-Chat-01 | **工具事件订阅**：渲染层订阅 `harness:bot-tool`，维护 `liveTools: Map<botId, ToolRun[]>`；payload `{ botId, groupId?, name, phase: start|done, args?, result?, ok?, ms? }`；`done` 时合并同名未完成项 | ✗ 无人订阅      | IR-Chat-02，改    |
| SR-Chat-02 | **历史分页 / 窗口化**：转录先画最近 40 块，点「加载更早」再放一页并保持阅读位置（BOT 与 CHAT 同一口径） | ✅ `Bot.tsx`（40 块） / `TaskChat.tsx`（40 块 + `loadEarlier`） | US-Chat-04 |
| SR-Chat-03 | **草稿持久化**：`bot_drafts(botId, threadId, text, attachments, updatedAt)`；输入 500ms 节流写；上限 8k 字符；发送成功即清；同一 bot 多 thread 各一份                                                      | ✅ `bot_ui` 表 + `saveBotUi` 单行写 | IR-Chat-07，改    |
| SR-Chat-04 | **阅读位置**：`bot_ui.scroll = { turnId, offset }`；滚动采样 500ms 写一次；打开会话时按 `turnId` 定位，**还原公式 `contentTop - offset`**（2026-11-24 修正符号错误），每次切回来都还原 | ✅（`offset` 语义：那一轮的视口内 y） | US-Chat-06 |
| SR-Chat-05 | **重试**：`botRetry({ turnId })` 复用原 `turn.input` + 原 `threadId`，新建一轮（不改写原轮）；同一轮重复点击幂等（带 `retryOf`）                                                                            | ✅ `botRetry`：复用原话 + 原会话，`trigger.kind=retry` 指回原轮 | IR-Chat-06，改    |
| SR-Chat-06 | **反馈**：`bot_turns.feedback ∈ {up, down}` + `botFeedback({ turnId, value })`，同一轮可改不可叠加 | ✗ 还没有列与动作（先用重试 / 分支处置） | IR-Chat-06 |
| SR-Chat-07 | **用量字段**：`turn.cost` 增 `ttftMs`（首个增量时间）与 `model`；UI 只读，不估算费用                                                                                                                | ✅ tokens / ms / ttftMs / model | IR-Chat-06/09，改 |
| SR-Chat-08 | **中断语义**：abort → `decision = "interrupted"`，`reply` 保留已生成前缀（≤4000 字）；UI 显示「已停止」；叫停**立刻**收掉本地临时态（发送键马上回来），再刷回合账 | ✅ 2026-11-24（`cancel()` finally 清 streaming / busy，`load()` 取 interrupted 回合） | IR-Chat-01 |
| SR-Chat-09 | **上下文估计**：不另造 `botContextEstimate`；用上一轮落库的真实账（`turn.context`：chars / memoryUsedPct / memoryLines / history），窗口未知就不给百分比；**点这一行去轨迹**看上下文构成 | ✅ 见 SR-Chat-18 | IR-Chat-09 |
| SR-Chat-10 | **输入法状态机**：`compositionstart` → composing；`compositionend` 后吞掉紧随的一次 Enter（`keyCode 229` 兜底）；状态放 `useRef` 不进 React state                                                     | ✗           | IR-Chat-12，改    |
| SR-Chat-11 | **群聊单条重试**：`botGroupRetry({ messageId })` 只让原成员重答同一句——复用原 owner 那句（不重复落 owner 气泡）、只叫这一个成员、新消息 `meta.retryOf` 指回原条 | ✅ 2026-11-24（`botGroupSend` 接受 `retryOf` / `onlyBotId`） | US-Chat-13，IR-Chat-08 |
| SR-Chat-12 | **增量广播**：新增 `harness:bot-patch`（只推 bot 相关切片：`botTurns` 尾部、`botGroupMessages` 尾部、`botChats` 摘要）；`harness:state` 全量保留做兜底与首帧                                                   | ✗ 每次全量      | US-Chat-04，改    |
| SR-Chat-13 | **性能闸门**：`preview-bot.mjs` 断言 200 轮时渲染节点 ≤3000、首屏 `performance.now()` ≤1.5s；基线写进 `COMPARE-chat-window.md` §6                                                                | ◐ 只有功能断言    | US-Chat-04，改    |
| SR-Chat-14 | **可访问性**：转录 `role=log` + `aria-live=polite`；每轮 `aria-label`；textarea / 附件 / 停止按钮均有 `aria-label`；焦点恢复；正文对比度 ≥4.5:1                                                           | ◐ role=log / article / label / Esc / 焦点已做；对比度待核 | IR-Chat-03/07，改 |
| SR-Chat-15 | **对话内预览**：`InlinePreviewCard` 走 `docs:read`（带进程内缓存），相对路径按这次 run 的 `cwd` 解析；同一时刻最多一张；不新增标签 | ✅ `src/components/InlinePreview.tsx` | IR-Chat-13 |
| SR-Chat-16 | **轨迹细节**：工具行 `meta.input` / `meta.output` 分段展示；`TrajectoryView` 字段级复制；运行态带 `tokens / 时长` 与 `TTFT` | ✅ `TaskChat` `ToolRow` / `TrajectoryView` `TrField` | IR-Chat-14 |
| SR-Chat-17 | **失败卡在对话里**：`error` → `.ds-fail`（原因 / 复制 / 收起 / 重试）；重试优先 `retryTurn(turnId)`，无回合时用同一条原文重发 | ✅ `src/components/Bot.tsx` | IR-Chat-08 |
| SR-Chat-18 | **上下文账**：读上一轮 `turn.context`（`chars / memory / memoryUsedPct / memoryLines.budget / history`），不编模型上限；≥80% 琥珀文字 | ✅ `src/components/Bot.tsx`（`lastContext`） | IR-Chat-09 |
| SR-Chat-10（续） | 输入法状态机在任务会话里同样生效（`compositionstart/end` + `isComposing` + `keyCode 229`）；`Esc` 停运行、发送后焦点回输入框 | ✅ 2026-11-24 | IR-Chat-12 |

---

## 4. 验收矩阵（P0 先落地）

| SR | 怎么验 | 通过判据 |
|---|---|---|
| SR-Chat-01 | `preview-bot.mjs`：mock 推两条 `bot-tool`，断言 `.ds-tool-line` 出现 `running` → `ok`，且发生在正式消息之前 | 两态都出现，顺序正确 |
| SR-Chat-02 | **历史分页 / 窗口化**：转录先画最近 40 块，点「加载更早」再放一页并保持阅读位置（BOT 与 CHAT 同一口径） | ✅ `Bot.tsx`（40 块） / `TaskChat.tsx`（40 块 + `loadEarlier`） | US-Chat-04 |
| SR-Chat-08 | **中断语义**：abort → `decision = "interrupted"`，`reply` 保留已生成前缀（≤4000 字）；UI 显示「已停止」；叫停**立刻**收掉本地临时态（发送键马上回来），再刷回合账 | ✅ 2026-11-24（`cancel()` finally 清 streaming / busy，`load()` 取 interrupted 回合） | IR-Chat-01 |
| SR-Chat-10 | 手动：拼音输入「nihao」候选态按 Enter | 只上屏，不发送；再按 Enter 才发 |
| SR-Chat-12 | `npm test`：一遍广播后 renderer 收到的 patch 体积 < 全量 5% | 体积达标且消息不乱序 |

**每条 P0 都要在装机版验证一次**（`npm run build && node scripts/install-renderer.mjs`；改了主进程则 `npm run pack && node scripts/install-mac.mjs`）。

---

## 5. 分期

| 期 | 内容 | 为什么这个顺序 |
|---|---|---|
| M1（P0） | SR-Chat-10 输入法 → SR-Chat-01 工具行 → SR-Chat-02 分页 → SR-Chat-08 中断留痕 | 前三条是「用着就撞上」，第四条是数据语义，越早改越少迁移 |
| M2（跟随） | SR-Chat-04 位置 + IR-Chat-05 新消息提示 + IR-Chat-11 阈值 24 / 手势归属 | 同一套滚动控制器一次做完 |
| M3（composer） | SR-Chat-03 草稿 → SR-Chat-05 重试 → SR-Chat-07 用量 → SR-Chat-06 反馈 | 按使用频率排；草稿是「切会话不丢」的唯一入口 |
| M4（打磨） | SR-Chat-09 占用提示 → SR-Chat-12 增量广播 → SR-Chat-13 性能闸门 → SR-Chat-14 可访问性 | 都要真实长会话数据才有意义 |

**不照抄**：dsh 的节点流 / 插件插槽体系（我们一个文件够用）；Orca 的 25 文件草稿（先要「切会话不丢」一条判据）；虚拟化（先分页，撑不住再上）。

---

## 6. 与现有文档的关系

| 文档 | 关系 |
|---|---|
| [`COMPARE-chat-window.md`](./COMPARE-chat-window.md) | 差异与实测证据（§6 craft-anything）；本文是它的可开工版本 |
| [`GAP-chat.md`](./GAP-chat.md) | 任务会话（TaskChat）的差距，与本文不重叠 |
| [`COMPARE-user-stories.md`](./COMPARE-user-stories.md) | 全产品级 US-01…US-30；本文的 US-Chat 是聊天窗口的细化 |
| [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md) | IR 里的尺寸 / 颜色 / 图标 / 计数规则的来源 |
