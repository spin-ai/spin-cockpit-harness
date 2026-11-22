> 层：需求 · 状态：记录 · 核对：2026-11-22 · 覆盖：Bot 会话窗口（对话 / 群聊）vs deepseek-harness 与 Orca 的逐部件对照，含 P0–P2 缺口与最小改法

# 竞品对照 · 聊天窗口

**一句话结论**：我们的聊天窗口已经「能说话」，但还停在**单条文本流**的水平；DeepSeek Harness 和 Orca 的聊天窗口都是**可流式展开的执行过程视图** —— 差的不在样式，在四件事：

1. **流式期间只看得见文字**：工具调用、思考、用量在跑的时候全是黑的，跑完才补一张卡；
2. **跟随只有一根布尔**：`stickRef` + 48px 阈值，没有手势归属、没有阅读位置、没有「N 条新消息」；
3. **composer 是一次性的**：切会话草稿就没了，没有草稿持久化、输入队列、@ 文件、粘贴图；
4. **长会话不设防**：不虚拟化，每次广播推整份 state。

---

## 0. 口径与图例

| 项 | 说明 |
|---|---|
| 快照日期 | 2026-11-22 |
| 本项目 | `src/components/Bot.tsx`（2026-11-22 复核：2938 行，含左栏 / 右栏 / 轨迹 / 群聊）+ `src/styles.css` 的 `.ds-*` / `.bot-*` |
| DeepSeek Harness | `deepseek-harness @ 39163dd3`（2026-11-13，`packages/client/ui-chat`）；本地只读副本在 `~/Documents/GitWorksapce/deepseek-harness` |
| Orca | `stablyai/orca @ 8e0c267e`（2026-11-20，`src/renderer/src/components/native-chat`），副本 `third-part/orca/` |
| 规模对照 | 我们：1 个聊天组件文件；dsh：`ui-chat/src` 105 文件 / 16848 行（其中 `chat/` 33 个 tsx / 3829 行）；Orca：`native-chat` 317 个非测试 tsx / 94529 行 |
| 只统计 | 非测试代码；锚点写作 `文件:行` |

**图例**：✅ 原生支持　◐ 部分支持 / 需绕行　✗ 没有　↔ 形态不同，不算差距

---

## 1. 我们现在的聊天窗口

| 部件 | 现状 | 锚点 |
|---|---|---|
| transcript | 1:1：用户右对齐气泡 + 助手扁平正文；群聊：owner 气泡 + 每个成员的正文块 | `Bot.tsx:1918-1964`（群聊）、`:1966+`（1:1 回合） |
| 轮的元信息 | 轮次头「已完成，用时 N 秒」就是展开开关，展开是思考 / 工具 / 终端；「为什么说」是触发源 / 注入记忆 / 成本 | `Bot.tsx:409`（`BotTrace`）、`Bot.tsx:2026` |
| 流式 | 只追加文本：1:1 一条 `streaming`，群聊按 `botId` 分块 | `Bot.tsx:594-596`、`Bot.tsx:634` |
| 工具事件 | 主进程推 `harness:bot-tool`，**渲染层没有订阅** | `electron/main.mjs:3950+`、`src/global.d.ts:33` |
| 回合导航 | 右侧细线（10px 间距），点击跳回合，悬停单条预览 | `Bot.tsx:1813-1846` |
| 消息动作 | 复制 / 引用 / 分支（分支只在有 thread 时） | `Bot.tsx:2058-2062`、`:2091` |
| composer | 自增高 textarea、附件（仅 1:1）、群聊 @ 提及、模型选择、`enterToSend` 设置 | `Bot.tsx:2200-2262` |
| 跟随 | `stickRef` 布尔 + 「距底 48px」判定；滚到新内容时 `scrollTop = scrollHeight` | `Bot.tsx:678-683`、`Bot.tsx:1890` |
| 持久化 | `bot_turns` 每 800ms 落一次半截文本，被杀后回收成 `interrupted` | `electron/bot/index.mjs:898`（`reply`） |

---

## 2. 三家结构对照

| 维度 | 我们 | DeepSeek Harness | Orca |
|---|---|---|---|
| transcript 单元 | 回合（turn）→ 展开 thinking / tools / terminal | **节点流**（turn / step / input / tool / compaction / approval / context 注入 / quota），每类有独立 renderer | 回合 + 卡片族（agent 卡、quiet 行、bot 卡片、folded mail、worker 上下文） |
| 流式期可见性 | ✗ 只有文字 | ✅ 思考行、工具卡、running 状态、用量边跑边长（`ReasoningRow.tsx`、`TurnProcessNodeView.tsx`、`RunningStatus.tsx`） | ✅ 工具/步骤行与消息同流（`messages/`、`conversation/turns/`） |
| 跟随模型 | ◐ 布尔 + 48px | ✅ `ScrollFollow` 控制器：阈值 24、`target` 目标位、`sample/settle/jump/toBottom/interrupt`，动画与读者手势分别归属（`use-scroll-follow.ts`） | ✅ 独立 reader-scroll 输入层（`viewport/scroll/native-chat-reader-scroll-input.ts`） |
| 阅读位置 | ✗ 重开会话回到顶部 | ✅ 位置采样（500ms）+ 存储 + 恢复 | ✅ 视图 pin / 选择 / 位置（`view-pins.ts`、`view-selection.ts`） |
| 回合导航 | ◐ 细线 + 单条预览 | ✅ 虚拟化导轨（10px 定距、`@tanstack/react-virtual`）+ 预览 + 「正在翻历史」脉冲 + 未加载锚点 | ◐ 时间线 / 清单 |
| 长会话 | ✗ 全量渲染、全量广播 | ✅ 历史分页（`use-chat-navigation.ts`：repage / jump / busy）+ 虚拟化 | ✅ 性能棘轮（`config/scripts/performance/native-chat`） |
| composer | ◐ 文本 + 附件（1:1）+ @（群） | ✅ 草稿、输入队列、斜杠命令、@ 引用、附件、图片、模型与权限预设 | ✅ 草稿（IndexedDB + journal + 启动续写，25 个文件）、@ 提及、引用选区、粘贴图、提交后揭示 |
| 消息动作 | ◐ 复制 / 引用 / 分支 | ✅ 复制 + 分支（含「不可用」说明）+ 时钟 + 每轮用量面板 + 插件插槽 | ✅ 复制 / 分支 / 反馈（赞踩）/ 用量 |
| 失败与中断 | ◐ 页头 banner；1:1 中断丢半截 | ✅ 失败卡、重试、quota 提示、compaction 卡 | ✅ 失败通知卡（`messages/notices/`） |
| 扩展性 | ✗ 全在一个文件 | ✅ slot / renderer 注册（`register-node-renderers.ts`） | ✅ 插件与命令面板 |

---

## 3. 缺口分级

### P0 · 正确性（用着就撞上）

| # | 缺口 | 判据（做到什么算修好） | 最小改法 |
|---|---|---|---|
| 1 | **中文输入法回车误发**：`onKeyDown` 只看 `key === "Enter"`，没有 `isComposing` | 拼音候选里按回车只上屏，不发送；Shift+Enter 换行不变 | `Bot.tsx:2225` 加 `event.nativeEvent.isComposing`，再加一次 `compositionend` 后的首键放行（dsh 的做法：`packages/client/ui-primitives/src/keyboard-composition.ts`） |
| 2 | **流式期看不见工具调用**：`harness:bot-tool` 有推没人收 | 跑的时候聊天里就出现「正在调用 X / X 完成」行 | `Bot.tsx` 订阅 `onBotTool`，维护 `liveTools[botId]`，渲染在 `ds-streaming` 块里（payload 已带 `groupId` / `name`） |
| 3 | **群聊附件静默丢弃**：`+` 按钮群聊也显示，但 `send()` 的群分支只发 text | 群聊要么把附件拼进正文、要么隐藏 `+` 并给出说明 | `Bot.tsx:800` 群分支复用 1:1 的 `withFiles` 拼装 |
| 4 | **长会话不设防**：`rows.map` 全量渲染 + `broadcast()` 推整份 `state` | 1000 条消息滚动不掉帧；广播不随消息数线性增长 | 先做「最近 N 轮 + 向上加载」（分页比虚拟化便宜），`broadcast` 给 bot 增量子频道 |

### P1 · 体验（「像聊天」的最低标准）

| # | 缺口 | 判据 | 最小改法 |
|---|---|---|---|
| 5 | 跟随只有布尔：向上翻一点也会被强行拉回 / 或该跟时不跟 | 只在「确实贴底」时跟随；手势和动画分开归属 | 把 `stickRef` 抽成 `ScrollFollow`（阈值 24 + `target` + `sample/settle/interrupt`），`useEffect` 只调 `toBottom` |
| 6 | 无「新消息」提示与回到底部 | 上翻时新消息进来有「N 条新消息 ↓」；点它回底部 | 抄 dsh 的 follow 控制器顺带就有 |
| 7 | 无阅读位置持久化 | 切走再回来还在原处；主动下滑才跟随 | `botChats` 增 `scroll` 字段，`onScroll` 采样（间隔 ≥500ms） |
| 8 | 消息动作太少 | 重新生成 / 编辑重发 / 赞踩反馈三件至少有两件 | assistant 行加「重试」（用上一条 `input` 再发一次）与 👍/👎（写 `bot_turns.feedback`） |
| 9 | composer 缺能力 | 切会话草稿不丢；粘贴图片能进附件；`/` 出命令；`@` 能引文件 | 草稿先落 `draft` 到 `state`（每 bot 一份）；其余按 dsh `ui-input-trigger` / `ui-commands` 的触发模型做 |
| 10 | 无每轮用量 | 每轮末尾有 tokens / 耗时 /（有就用）TTFT | `bot_turns.cost` 已有，渲染成 `ds-usage` pill 即可 |
| 11 | 无上下文占用 / compaction 提示 | 接近上限时明说，超了给压缩卡 | 先做「本轮注入多少字」的可见化（`injected` 已有），压缩留到后面 |

### P2 · 打磨

| # | 缺口 | 判据 |
|---|---|---|
| 12 | 回合轨不虚拟化、无「正在翻历史」状态 | 200 轮不卡；点未加载的回合有脉冲 |
| 13 | 键盘与无障碍 | Esc 停止、`⌘⇧C` 复制最近一条、发送后焦点回 composer、`prefers-reduced-motion` 关动画 |
| 14 | 失败只有页头 banner | 聊天里出现失败卡 + 「重试」，不丢草稿 |
| 15 | 群聊成员块没有「停止某个成员」以外的控制 | 每个成员块可单独收起 / 重试 |

---

## 4. 建议顺序

1. **P0 四条一次做完**（都在 `Bot.tsx` + 一个 IPC 订阅，改动小）：输入法、工具行、群聊附件、分页加载。做完这一步，聊天窗口才算「不会误事」。
2. **P1 的 5 / 6 / 7 一起做**（同一个 `ScrollFollow` 控制器 + 位置存储）：跟随是这一屏最容易被感知的粗糙点。
3. **P1 的 8 / 9 / 10 按使用频率排**：重试 > 草稿 > 用量 pill > 命令 / 引用。
4. **P2 等有真实长会话数据再做**（先量：多少轮开始掉帧、多少条开始慢）。

**不照抄**（保持我们的形状）：

- dsh 的节点流 / 插件插槽体系：我们一个文件就能覆盖当前需求，过早拆会先付出抽象成本；
- Orca 的 25 个草稿文件（IndexedDB + journal + 崩溃续写）：我们 SQLite 一份 `draft` 就够，先要「切会话不丢」这一条判据；
- 他们的历史分页 + 虚拟化一起上：我们先分页，虚拟化等分页撑不住再说。

---

## 5. 证据锚点

| 结论 | 出处 |
|---|---|
| 流式只追加文本 | `src/components/Bot.tsx:594`、`:634` |
| 工具事件没人收 | `src/global.d.ts:33`（有类型）、`src/components/Bot.tsx`（无订阅）、`electron/main.mjs:3996`（`sendDelta` / `sendTool`） |
| 群聊 `send()` 不带附件 | `src/components/Bot.tsx:797-825` |
| 跟随是布尔 + 48px | `src/components/Bot.tsx:678`、`:1890` |
| 全量广播 | `electron/main.mjs:725`（`broadcast` → `snapshot()`） |
| 半截文本每 800ms 落盘 | `electron/bot/index.mjs:898-960` |
| dsh 跟随控制器 | `deepseek-harness @ 39163dd3` → `packages/client/ui-chat/src/client/chat/use-scroll-follow.ts`（阈值 24、`toBottom`、`interrupt`） |
| dsh 阅读位置 | 同上 → `use-chat-reading.ts`（`FOLLOW_THRESHOLD = 24`、`SCROLL_SAMPLE_INTERVAL_MS = 500`） |
| dsh 导轨虚拟化 | 同上 → `TurnNavigator.tsx`（`TURN_SPACING_PX = 10`、`useVirtualizer`） |
| dsh 历史分页 | 同上 → `use-chat-navigation.ts`（repage / jump / busy） |
| dsh 输入法判定 | 同上 → `packages/client/ui-primitives/src/keyboard-composition.ts` |
| dsh 消息动作 | 同上 → `MessageIconActions.tsx`（复制 / 分支 / 时钟 / 用量插槽） |
| Orca 草稿族 | `third-part/orca/` → `src/renderer/src/components/native-chat/drafts/`（25 个文件） |
| Orca 滚动输入层 | 同上 → `viewport/scroll/native-chat-reader-scroll-input.ts` |
| Orca 失败通知卡 | 同上 → `messages/notices/` |

---

## 6. 运行时证据（craft-anything 实测）

源码之外，又用 **Craft Anything 0.6.1**（`deep_mode`）读了**装好的包**和**跑着的窗口**，两条结论被实测钉死：

| 证据 | 方法 | 结果 |
|---|---|---|
| 装机包结构 | `js_app_map` on `/Applications/Cockpit Harness.app/…/app.asar` | 58 个源文件 / **75 个 IPC 频道（70 成对）**/ 3 个窗口 / 单渲染入口（vite，`dist/assets/index-*.js` 2.4 MB） |
| 对照 Orca.app | 同工具同口径（`Orca.app` 1.4.268） | **5986 个源文件 / 1339 个 IPC 频道 / 11 个窗口 / 3 个 renderer 入口** |
| 聊天窗口实际 DOM | `web_page_show` + CDP（`--remote-debugging-port`，后台启动） | 一个会话 **36 个消息块 → 2415 个 DOM 节点**；内容高 9472px / 视口 560px（16.9 屏）；容器是裸 `div.bot-stream`，**没有 `role`、没有 `aria-live`**；`textarea` 只有 `placeholder`，没有 `aria-label` |
| 工具事件是否被消费 | 装机 bundle 静态计数 | `onBotTool` **0 次**、`onBotDelta` 1 次 → 聊天窗口确实从不订阅工具事件（P0-2 成立） |
| 是否虚拟化 | bundle 标记词 | 我们：`virtualizer` 0 / `IntersectionObserver` 11 / `indexedDB` 0；Orca：`virtualizer` 36 / `IntersectionObserver` 58 / `indexedDB` 8 / `isComposing` 69 / `aria-live` 43 |

**实测修正了三条判断**

1. 「长会话没设防」从推断变实测：36 条就 2415 个节点，且 bundle 里没有任何虚拟化库 —— 分页这件事不能再往后拖。
2. 「无障碍凑合」不成立：`aria-live` 只在流式块上，**完成态的转录容器没有任何 role**；composer 输入框没有 `aria-label`（读屏只念到 placeholder）。
3. 「Orca 更重」有了量级：它的 IPC 频道是我们的 **17 倍**，也说明它把聊天、终端、Agent 全做进了一个 Electron 壳里；这不是要追的数字，而是「我们的单文件聊天迟早要拆」的证据。

**没能测的**：滚动帧率（窗口是后台启动的，`requestAnimationFrame` 被节流，测出来的 worst frame 不可信）；真实流式期的 DOM 写入频率（需要真跑一次模型调用）。要测这两个，得把窗口切到前台或给 preview 注入一段假流。

证据落在本机临时工程 `/tmp/ca-chat`（`core_journal_read` 可读），不随仓库分发。


---

## 2026-11-22 复核补充

- 本轮把机器人设置收成 5 个 tab（身份 / 能力 / 记忆 / 自动化 / 规则），并把「工作」放回会话列顶部；同时删掉了会话底部的能力说明与「打开记忆」footer。**这些是配置与外壳变化，不改变本文对聊天窗口的结论。**
- `Bot.tsx` 行号已随设置重排漂移；本文的 `文件:行` 锚点按函数 / 组件名找，不按旧行号找。
