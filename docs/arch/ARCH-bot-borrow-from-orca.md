> 层：架构 · 状态：提案 · 核对：2026-11-27 · 覆盖：ORCA Bot 实现盘点、8e0c267e→59f3122bc→14c614651 的 Bot 变更、按 P0/P1/P2 的可借鉴清单与第一批改动范围

# Arch · 从 ORCA 借 Bot 能力

> 目的：回答「ORCA 的 bot 为什么像个同事，我们的像个壳」并把它变成**可开工的清单**。
> 关联：[`ARCH-bot.md`](ARCH-bot.md)（我们的实现现状）、[`REQ-bot-intelligence.md`](../product/REQ-bot-intelligence.md)（智能度 US/IR/SR）、[`REQ-bot-chat.md`](../product/REQ-bot-chat.md)（会话窗口 IR/SR）。
> 源码副本只读、不入库（`third-part/` 被 git 忽略）。**本文所有结论都能用文末命令重跑**。

---

## 0. 口径

| 项 | 值 |
|---|---|
| 源码副本 | `third-part/orca`（`https://github.com/stablyai/orca.git`，MIT） |
| 旧 commit | `8e0c267e4bf5c47f8f8dda0e9daae4590fad326f` · 2026-11-20 06:36:35 -0800 |
| 首次复核 | `59f3122bc8c16c4f655a5af80ba19bd865aab937` · 2026-11-23 06:10:54 -0800 |
| 本次复核 | `14c6146516c37e59857f0e30c19b64d580ee3e8c` · 2026-11-27 21:53:24 +0800 |
| 首次区间 | 8e0c267e→59f3122bc：991 commits；Bot 五个目录 207 commits、689 个文件、+45673 / −34966、272 个新文件 |
| 本次区间 | 59f3122bc→14c614651：`src/{main,shared}/bots` + `src/cli/bots` 共 289 个文件、+15205 / −3513、**90 个新文件**（items 生命周期、tool-relay/OAuth、team-share、look-around、tidy-up、host 用量闸） |
| 更新方式 | 本机 HTTPS 到 github 不通，用 SSH 只读拉：`git fetch --depth=1 git@github.com:stablyai/orca.git main` → `git checkout -B main FETCH_HEAD`；工作区干净，无我们的改动 |

**收录判据**：一条要同时满足 ① ORCA 有可指的文件与做法 ② 我们能落到具体文件 ③ 有可测判据。
只写读过源码能确认的事；「推断」一律在句中标注。没读透的进 §6，不进清单。

---

## 1. ORCA 的 Bot 是什么

一句话：**ORCA 的 bot 是一个真实 agent CLI 会话的人格外壳**——家里放 `SOUL.md` / `MEMORY.md` / `memory/` / `skills/`，工具就是 shell、`git`、`gh`、Linear、Slack、MCP，产物落在 Items 与 PR 上。

| 层 | 目录 | 职责 |
|---|---|---|
| 事实源 | `src/shared/bot-types.ts` | `Bot` 的持久形状（agent、members、connectors、notifications、lookAround、tidyUp、itemsStale…） |
| 运行时 | `src/main/bots/`（258 个条目） | home 文件夹、preamble 注入、会话/聊天树、items、work 记录、automations、群聊、tidy-up、look-around、工具凭据 |
| 共享契约 | `src/shared/bots/`（167 个条目） | IPC 形状、状态机、文案表、纯函数判定（可在两个端复用） |
| CLI | `src/cli/bots/` + `src/cli/specs/bot-items.ts` | bot 自己调用的动词（`bot reply` / `bot item` / `bot work` / `bot memory` / `bot connectors` / `bot tools`） |
| 渲染 | `mobile/src/bots/`（152 个文件）+ 桌面同名组件 | 桌面与手机同一份数据渲染 |
| 模板/脚本 | `config/scripts/bot-apps/` | bot 可接入的 app 目录冒烟检查（`bot-app-catalog-smoke.mjs`） |

**和我们的根本差别**（决定抄什么）：

| | 我们 | ORCA |
|---|---|---|
| 一轮是什么 | 主进程一次 `chatStreamWithTools()`，默认 8 轮 / 单轮 2048 token（`electron/bot/index.mjs:50`、`:1231`） | agent CLI 的一整轮（工具不限，loop guard 兜底） |
| 身体 | 22 个受控工具（`electron/bot/tools.mjs:149`） | shell / git / gh / 连接器 / MCP，写操作靠审批模式 |
| 记忆 | `harness.db` 四层，注入 8000 字符；`MEMORY.md` 只是只读镜像（`electron/memory/index.mjs:872`） | `MEMORY.md` + `memory/*.md` + `memory/journal/` 就是事实源，文件可手改 |
| 工作状态 | `todos` / `runs` / `bot_turns` | **Items**（独立台账）+ `bot work list` + GitHub |
| 主动性 | 自行实现的 60s tick + `routines` 四类 | automations（30+ 事件源）+ 每晚 tidy-up + look around |

**结论**：不要抄「多 CLI runtime」。要抄的是 **文件化人格与记忆的读写纪律、Items 台账、失败/静默语义、通知作用域、只读自查**——这些在我们的主进程模型里都能原样落地。

---

## 2. 这 3 天窗口里 Bot 发生了什么

按主题（不是按 commit 顺序），只列影响判断的部分：

| 主题 | 代表 commit | 含义 |
|---|---|---|
| **Items 成为工作台账** | `f4b9b45fb` 加 Waiting 状态；`fa251062f` 显示 Waiting 等什么；`6a48dec64` 显示 worker 为什么停；`7f4c81e4e` 列表只取变化的部分 | 「bot 在干什么 / 需要你决定什么」从聊天里搬到一张可查的表，聊天只负责说 |
| **记忆从「整篇重写」改成「行级操作」** | `1e8546ead` Tidy-up ops 试点；`c9c424721` 每个关闭的 item 记一行 journal；`f29e273a4` 明确告诉 bot「工作状态不要写 MEMORY.md」；`8f547e3da` 主人写下的规则行不许被搬走；`6d7915acf` 每行都算事实 | 记忆是可校验的数据结构，不是一段文本；模型只出草稿，Orca 校验后写 |
| **通知变成作用域增量** | `0c93c584e` groups 通知只点名变化的那一间；`7f4c81e4e` items 只重读被点名的 item；`2d38b6874` 复用状态快照 | 一次写只让相关面板重读，替代全量广播 |
| **自动化收口** | `489688e44` 一条命令看 PR（默认 2 小时截止）；`59b901b41` 说清 run 的 agent 为什么没起来 | 把「等外部事件」变成一条可解释、可截止的等待 |
| **群聊/跨机** | `13a964bea` 配对电脑之间的 agent 互相提问；`3bf4c3000` 群房显示远端回答；`6c3313a63` 房内 worker 报告能活过 Stop | 群聊不只是多 bot 同屏，而是有多轮预约与投递语义 |
| **工具与凭据** | `02f3a4cdd`、`c92df60cb`、`9016600ef` 工具保存时保住 Orca 登入 | 凭据是独立、密封、有健康检查的对象 |
| **策略** | `9d9d780e4` 团队策略能关掉 bots | 云侧开关；我们自托管不需要 |

> 数据口径：`git diff --shortstat 8e0c267e..HEAD -- src/main/bots src/shared/bots src/cli/bots mobile/src/bots config/scripts/bot-apps`。

---

## 3. 借鉴清单

> 每条固定七项：**ORCA 的做法 / 对应文件 / 我们的差距 / 抄 / 不抄 / 落点 / 判据**。
> 「不抄」不是客气话，是防止照搬后和我们的红线（审批归人、单机自托管、无第二套调度器）冲突。

### P0-1 静默标记：空跑不打扰

- **ORCA 的做法**：一轮的最终消息以 `NO_REPLY` 结尾就是「没什么值得说」，谁都不通知；容忍模型的装饰（`**NO_REPLY**`、`NO_REPLY.`、代码围栏包住）；如果被叫的人确实问了一句，则把标记前的文字当回答发出。
- **对应文件**：`src/shared/bot-quiet-result.ts`（`BOT_QUIET_MARKER` / `isQuietBotResult` / `addressedBotWords`）；规则写在 `src/main/bots/bot-preamble.ts` 的 `botRules`（「nothing worth reporting … end with NO_REPLY」）。
- **我们的差距**：没有静默概念。日程到点即 `speak()` → 落一条 `decision=replied` 回合 + 一条 toast（`electron/bot/index.mjs`、`electron/bot/notify.mjs`）。用户看到的是「到点了它硬说一句」。
- **抄**：标记 + 宽松匹配 + 「被点名时保留前半句」；`bot_turns.decision` 增 `quiet`，正文仍落库（可审计），但不通知、不进未读。
- **不抄**：Slack DM 的特殊分支（我们没有 Slack）。
- **落点**：`electron/bot/quiet.mjs`（新，纯函数）+ `electron/bot/index.mjs` 的 `speak()` / `reply()` 收口 + `electron/bot/notify.mjs` 的 `notifyDecision`（`quiet` 直接返回）+ `src/components/Bot.tsx` 回合行显示「没说什么」。
- **判据**：日程空跑 100% 不弹通知；被点名时标记前若有正文，正文仍要发给对方；`npm test -- bot` 覆盖 `**NO_REPLY**` / `NO_REPLY.` / `> NO_REPLY` 三种装饰。

### P0-2 密钥封口：入参、结果、链接一起过滤

- **ORCA 的做法**：三处统一过滤——① 工具结果入库前 `redactSecretLike`；② 工具凭据整体密封（agent 只见到中继地址和自己的 token）；③ 建议/链接里出现凭据形状的 query 或 fragment 直接拒收（`linkCarriesCredential`，`token|secret|passw|api_key|signature|auth|session`），而不是发出去再删。
- **对应文件**：`src/shared/crash-reporting/crash-report-redaction.ts`（`containsSecretLike`）；`src/main/bots/bot-tool-redaction.ts`；`src/main/bots/bot-tool-credential-envelope.ts`；`src/shared/bots/bot-look-around.ts` 的 `linkCarriesCredential`。
- **我们的差距**：`electron/redact.mjs` 只在**回合落库前**扫一遍正文；工具入参（模型把 key 当参数传）、工具结果（例如读到的配置文件里就写着 token；`.env` 本身已被 `workspace.mjs` 拒绝）没有单独过滤；`bot_events` 的 `url` 直接存（`electron/bot/webhook.mjs`、`electron/bot/github.mjs`）。
- **抄**：把 `containsSecretLike` 抽成单一判定，三处调用（工具入参、工具结果、外部链接）；命中即 `[redacted]` 且**不保留长度**；命中凭据形状的链接拒绝写入 `bot_events`。
- **不抄**：密封凭据信封 + 中继（我们没有远程 HTTP 工具，见 P2-3）。
- **落点**：`electron/redact.mjs` 增 `containsSecretLike(text)` / `redactDeep(value)` / `linkCarriesCredential(url)`；`electron/bot/tools.mjs` 在 `botReadTool` 的统一出口调用；`electron/bot/webhook.mjs` / `github.mjs` 写 `bot_events` 前调用。
- **判据**：新增用例覆盖「工具结果里的 `sk-…`」「入参里的 `Authorization: Bearer …`」「`?access_token=` 链接」；`bot_turns.trace` 与 `bot_events.url` 中命中数为 0。

### P0-3 Items：一张工作台账，替代「聊天里翻昨天」

- **ORCA 的做法**：每个 bot 一张 Items 表，状态 `planned / working / waiting / needs_you / done / canceled`；`needs_you` 只等主人，`waiting` 等外部（CI、review、配额重置）并写明等什么；一条 ask = 一条普通评论 + 最多 5 个决策 × 8 个选项（`--option` 变快捷回复，`--recommended` 标记建议，`multi` 允许多选）；答案就是一条普通评论；item 有 snooze（Later / Tomorrow 9 / Monday 9 / In a week，上限 366 天）、`stale` 3/5/7/14/never、链接（dispatch/pr/url/file）、事件流与分页（50/100）。
- **对应文件**：`src/shared/bots/bot-items.ts`、`bot-item-ask.ts`、`bot-item-snooze.ts`、`bot-items-notice-parts.ts`；`src/main/bots/bot-items-schema.ts`（迁移 + `item_events` + `mail` 列）、`bot-items-writes.ts`、`bot-items-reads.ts`、`bot-item-question-notice.ts`、`bot-item-waiting-ask-keep.ts`；CLI 在 `src/cli/specs/bot-items.ts`。
- **我们的差距**：没有 items。最接近的是 `bot_turns.ask`（`decision=asked` 的卡片，`openAsks()`）+ 每 bot 的任务页签 + `workersOf()`。结果：①「需要你决定」分散在多个会话的回合里，切走就看不到；② 没有 Waiting（等 CI 和等你决定混在一起）；③ 没有「一条工作到今天什么状态」的稳定编号，汇报只能复述聊天。
- **抄**：状态机 + ask 结构（context/questions/options/recommended/multi）+ 计数 + 分页 + snooze + stale + `bot_item_events`（一次写只发一条通知）。先做单机、单库、无邮箱。
- **不抄**：独立 SQLite 文件（`bot-items-schema.ts` 的 `user_version` 迁移 + 只读降级）、`mail` 列与跨会话投递、`item_waiting_asks` 侧表、手机端页面。
- **落点**：`electron/db.mjs` 新表 `bot_items` / `bot_item_links` / `bot_item_events`（显式列名，按现有 `persist()` 规则）；`electron/bot/items.mjs`（校验 + 读写 + 计数，纯函数部分可单测）；`electron/bot/tools.mjs` 增 `item_add` / `item_set` / `item_comment` / `item_list`（risk=`self`，写自己的台账）；`electron/main.mjs` 的 `bots()` 面增 `items` 分页读；`src/components/Bot.tsx` 右栏「待办」tab（沿用列表面形态，不新造卡片）；`Bots.tsx` 行尾显示 needs-you 计数。
- **判据**：一次「帮我查 CI 为什么红」能在 Items 里留下一条可点开的记录（状态 + 链接 + 结论）；`needs_you > 0` 才出现在 chrome 上；200 条 item 时首屏只读 50、翻页不重排；点开一条不改变列表顺序（`AGENTS.md` 第 19 条）。

### P0-4 变更通知分作用域：别为一行字重发整个世界

- **ORCA 的做法**：`botsChanged` 一条通知携带 `botIds` + `kinds`（`bot / chats / status / workers / automations / threads / lookAround / groups / access / settings / items`）+ 逐 kind 的 `kindBots` + `itemUids` + `groupIds` + `needsYou` 计数；**500ms 合并**，同一批写只发一条；读者只重读自己那个 bot、那个 kind 的部分。旧客户端读不到字段就退回全量。
- **对应文件**：`src/shared/bots/bot-change-scope.ts`、`src/main/bots/bot-change-notices.ts`、`src/shared/bots/bot-items-notice-parts.ts`、`src/main/bots/bot-chat-tree-index.ts`（每 bot 的 base 缓存，从记录提交与 Dispatch 变化就地更新）。
- **我们的差距**：`broadcast()` 每次推整份 `snapshot()`（`electron/main.mjs:772`）；`REQ-bot-chat.md` 的 SR-Chat-12 明确标 ✗。Bot 页回合变多后，每次增量都全量重渲染，长会话直接卡（US-Chat-04 实测 36 轮 2415 节点）。
- **抄**：`harness:bot-patch` 只推 bot 切片（`botTurns` 尾部、`botGroupMessages` 尾部、`botChats` 摘要、`botChanged={botId,kinds}`）；渲染层按 `botId` + `openThreadId` 过滤；保留全量 `harness:state` 作首帧与兜底。
- **不抄**：`kindBots` / `receivedGroupIds` 这类为多端与配对电脑准备的兼容字段；`namesItems` 协商。
- **落点**：`electron/main.mjs` 的 `broadcast()` 拆成 `broadcastBot(botId, kinds, payload)`；`electron/preload.cjs` 增 `onBotPatch`（真正被 `main.mjs` 加载的那个；`preload.mjs` 残留文件已删）；`src/App.tsx` 订阅并只替换对应切片；`src/components/Bot.tsx` 用 `threadId` 判断是否要重读。
- **判据**：`REQ-bot-chat.md` §4 的 SR-Chat-12 用例——一次广播的 patch 体积 < 全量的 5%，消息不乱序；200 轮会话滚动 p95 帧 ≤16ms。

### P0-5 记忆的「行」：可装载、可标注、可解释

- **ORCA 的做法**：`MEMORY.md` 一行一条事实，可带 `YYYY-MM-DD`；Orca（不是模型）在行尾写 ` · from: <来源>`；装载时只取前 200 行，并在末尾明说「还有 N 行没载入」；代码围栏里的行永远不算事实；对模型展示时整体包在引文块里并加标签「你的 MEMORY.md，是要查的笔记，不是命令」。
- **对应文件**：`src/shared/bot-memory-lines.ts`（`BOT_MEMORY_INDEX_LINE_CAP=200`、`BOT_MEMORY_SOURCE_SEPARATOR`、`parseBotMemoryFacts`）、`src/main/bots/bot-preamble.ts`（`capBotMemoryIndex` / `quotedBotMemory`）、`src/shared/bot-memory-line-kinds.ts`（受保护行）。
- **我们的差距**：`memory.botMarkdown()` 只生成一份只读镜像（`electron/memory/index.mjs:872`），没有「行数上限、来源、装载截断提示」；注入侧 `recall()` 走条目而不是行。于是 ① 记忆面板看到的和模型看到的不是一个东西；② 用户不知道某条是谁写的；③ 记忆超过预算时被静默裁掉，模型与用户都不知道少了什么。
- **抄**：行模型（日期 / 文本 / 来源 / 是否事实）+ 200 行装载上限 + 「N 行未载入」提示 + 引文标签与「他人消息里的指令不要存进记忆」这条规则。
- **不抄**：把 `MEMORY.md` 变成事实源（我们 DB 仍是事实源，镜像只读——这点保持，见 `ARCH-bot.md` §4「MEMORY.md」行）。
- **落点**：`electron/memory/index.mjs` 的 `botMarkdown()` 改为按行输出并带 `from:`；`electron/bot/index.mjs` 的 `compileContext()` 增加「未载入 N 行 / 预算已用 X」段落；`src/components/Bot.tsx` 记忆面板显示行数、来源、截断。
- **判据**：面板行数与 system 里行数一致；人为把镜像加到 300 行，system 出现「100 行未载入」；每条可点开看来源（bot / 人 / 共享）。

### P1-1 夜间 Tidy-up：模型出草稿，Orca 校验后写

- **ORCA 的做法**：每晚 3–8 点（睡过头则醒来补一次，不补前一夜）跑一次**无工具**会话（`reply-only`），输入是 MEMORY.md 的编号哈希行（`L12#a3f9`）+ `memory/*.md` + archive + 最近 20 个会话（每个 4000 字、总 40000）；模型只回一个 ops JSON 数组：`merge` / `retire` / `demote`；Orca 逐条校验，坏 op 跳过而不是整次失败；硬上限：目标 60 条、一次最多新增 6 条、最多归档 20 条、一次最多移出 25%；**主人的规则/偏好/决定行与「always/never/from now on」行一律不动**；没有「改词」的 op；每次变更留 90 天历史行，一条 Undo 写回。
- **对应文件**：`src/main/bots/bot-memory-tidy-up.ts`（常量与失败码）、`-ops.ts`（快照与校验）、`-ops-prompt.ts`、`-draft.ts`、`-runner.ts`、`-groups.ts`、`-failures.ts`；历史与归档：`src/shared/bots/bot-memory-history.ts`、`bot-memory-archive.ts`。
- **我们的差距**：`electron/bot/tidy.mjs` 的 `planTidy()` 只在 80% 时按分数/时间给一份「归档到 60%」的候选，人工点一下；**没有自动执行、没有合并、没有主题文件、没有 per-line 历史与 Undo**（`REQ-bot-intelligence.md` 的 SR-B07 标 ◐）。
- **抄**：草稿-校验-写入三段式 + 硬上限 + 受保护行 + 失败码 + 一行一条的历史与 Undo。
- **不抄**：ops pilot 的灰度开关、`memory/journal` 的按月文件（我们已经有 `bot_turns` + （P0-3 之后）item 事件，够查；等 items 上线后再决定要不要把每日一行写成文件）、`salvage`（只有文件被双方同时写才需要，我们单进程单写）。
- **落点**：`electron/bot/tidy.mjs` 扩成 `planTidyOps()` / `applyTidyOps()`；`electron/bot/index.mjs` 加一个每日 tick（复用现有 `startBotTick`，不新建调度器）；`electron/db.mjs` 的 `bot_revisions` 增 `kind='memory'` 行；`Bot.tsx` 记忆页显示「上次整理 / 撤销」。
- **判据**：一次整理移出的行数 ≤25%；主人写的行 100% 不动；撤销后文件逐字节回到整理前；失败时给一条人话原因（超上限 / 草稿读不懂 / 文件期间被改）。

### P1-2 本轮「在办什么」摘要：把台账喂回 system

- **ORCA 的做法**：每个主人回合开始时现算一段（不落库）：
  - 等你决定的 item（≤12 行、≤1500 字符、标题截 60、每条最多 3 个 PR）；
  - 还在跑的 worker；
  - 进行中 / 等外部的 item，**以及「在办但没有任何东西在跑」的 item 会被点名**，让它自己说清为什么等；
  - 已完成但 PR 还没合的 item。
  因为每次现算，item 关了、PR 合了，下一轮自动消失，不会留旧摘要。
- **对应文件**：`src/main/bots/bot-active-work.ts`（`BOT_ACTIVE_WORK` 常量、`BotActiveWorkSection`、`NOTHING_LIVE_KEY`）、`src/shared/bots/bot-work-list.ts`、`src/main/bots/bot-work-record.ts`。
- **我们的差距**：`compileContext()` 只拼人格 / 记忆 / 同僚 / 规则（`electron/bot/index.mjs:371`），**没有「你手上还有什么」**。所以 bot 会重复问「需要我做什么」，或者把自己昨天派的活忘掉；`plan` 字段只在会话列显示。
- **抄**：现算 + 硬上限 + 「没有在办」也要有一行（`[]` 键，避免每轮重复） + idle 项点名。
- **不抄**：PR 状态缓存与远端 workspace 读取（我们 PR 只做事件，不做逐条缓存）。
- **落点**：`electron/bot/active.mjs`（纯函数，输入 `state.todos/runs/bots`）+ `compileContext({ active })`；`Bot.tsx` 右栏消息头加一行「在办 3 · 待你决定 1」。
- **判据**：连续两个回合的摘要不重复同一句（键不变则不重发）；「在办但没在跑」的 item 会被点名；摘要总长 ≤1500 字符。

### P1-3 只读 Look around：让它在没人问的时候自己看一眼

- **ORCA 的做法**：按预设时段（每 4 小时 8/12/16/20 点、每 2 小时、一天两次、每天早上；仅工作日）在自己的 home 起一次**只读**会话；只读由**工具调用处**强制（按程序 + 子命令白名单：`gh pr view/diff/checks`、`git log/show/diff/status`、`orca linear issue`…；并拒绝会让只读命令写盘的参数 `--method/--field/-o/--output/-c` 等），不是靠提示词请求模型配合；产出最多 5 条建议（title 80 / why 400 / ask 2000 / link），按规范化链接去重，链接带凭据形状直接拒收；10 分钟没结束就掐掉并记码；连续失败 N 次自动关掉；建议进 Up next，点「Start」把 `ask` 放进输入框。
- **对应文件**：`src/main/bots/bot-look-around-runner.ts`、`bot-look-around-policy.ts`、`bot-look-around-schedule.ts`、`bot-look-around-failures.ts`、`src/shared/bots/bot-look-around.ts`（`SUGGESTION_LIMITS` / `suggestionKey` / `linkCarriesCredential`）、`bot-look-steps.ts`。
- **我们的差距**：主动性只有事件触发（`run.failed` / `github` 轮询 / webhook / 日程），没有「自己找下一步」；`upNext` 只有提问、待定建议、到点日程三类（`ARCH-bot.md` §0.1）。
- **抄**：只读白名单**在工具调用处**执行 + 建议数据结构与去重 + 连续失败自动关 + 「Start 把 ask 放进输入框」。
- **不抄**：12 小时的时段矩阵与睡醒补跑细节；仅 Claude/Codex 的限制（我们只有一条 `chatStreamWithTools` 通道）。
- **落点**：`electron/bot/look.mjs`（模式 `read-only`，由 `botReadTool` 的统一闸门执行白名单）+ `electron/bot/routine.mjs` 新增 `look` 类型（现有 `ROUTINE_KINDS` 只有 daily / every / once / watch）；`electron/db.mjs` 的 `bot_events` 复用为建议存储（`source='look'`）；`Bot.tsx` 的「接下来」区加建议卡（现有 `.ds-tool-line` 形态，不新造卡片）。
- **判据**：只读会话里 `task_create` 100% 被拒且拒因可读；同一链接第二次不再出现；连续 3 次失败后自动关闭并留一条原因。

### P1-4 请求三型 + 拒绝话术 + 谁能找它

- **ORCA 的做法**：bot 之间的邮件只有三种 `status / handoff / question`——`status` 只告知，**不会等回执、不会回报结果**；拒绝是一组稳定 code（`bots_disabled / bot_not_found / bot_chat_not_found / bot_paused / bot_self / bot_request_type / bot_request_worker`），每条都是「一句话 + 该怎么做」（例如列出本机有哪些 bot）。谁能找它是 `members`（按 connector 的 user id，上限 200），「Request access」每 5 分钟读一次云侧，本地只记「播报到哪」，同一请求不会重复弹。
- **对应文件**：`src/main/bots/bot-request-policy.ts`、`src/shared/bots/bot-access-reach.ts`、`bot-access-copy.ts`、`src/main/bots/bot-access-request-watch.ts`。
- **我们的差距**：只有 `handoff_to_bot`（仅群聊，`electron/bot/tools.mjs`）+ `policy.whoCanAsk = owner|group|anyone` 三档；没有 `status` 型（单向告知），没有按人授权，拒绝理由多为布尔判断。
- **抄**：三型语义（尤其「status 不等回执」）+ 拒绝 code 与「一句话说该怎么做」+ 按人授权的数据形状。
- **不抄**：云端 access request 轮询、connector 身份（我们没有 Slack/Linear 登录）。
- **落点**：`electron/bot/tools.mjs` 的 `handoff_to_bot` 扩成 `bot_send({to, type, subject, body})`；`electron/bot/index.mjs` 的 `botGroupSend` 用同一判定；`electron/db.mjs` 的 `bots.policy.whoCanAsk` 从三档扩成 `{ mode, members[] }`（旧值兼容读）。
- **判据**：`status` 不产生待回执（`bot_turns` 无 watching）；拒绝时给出的名字列表与本机 bot 一致；被暂停的 bot 100% 拒收且理由可见。

### P1-5 日程/等待的运行历史与失败码

- **ORCA 的做法**：每次 look / tidy-up / automation 都留一行结果（时间、耗时、结论、失败码）；失败码集中在一张英文表里（`lookTimedOut`、`tidyUpTooManyRemoved`、`asleep`…），主进程只发 code + 英文，客户端按 code 翻译；睡过头的时段记「错过」而不是「失败」。
- **对应文件**：`src/shared/bots/bot-failure-copy.ts`、`src/main/bots/bot-memory-tidy-up.ts` 的 `TIDY_UP_FAILURE_CODES`、`bot-look-around-failures.ts`、`src/shared/bots/bot-tidy-up.ts`（摘要）。
- **我们的差距**：`routines` 只存 `lastFiredAt`，没有运行历史，也没有 skipped/asleep；失败只有一条 `bot_turns.reason` 字符串（`REQ-bot-intelligence.md` SR-B09 明确「运行历史 / skipped 记录未做」）。用户问「早报今天怎么没来」答不出。
- **抄**：一日志行 + code 表 + 「错过 ≠ 失败」。
- **不抄**：i18n 的 code→译文机制（我们是中文单语，直接一句话）。
- **落点**：`electron/db.mjs` 新表 `routine_runs(id, routine_id, kind, at, status, code, ms, note)`；`electron/bot/routine.mjs` 判定与触发处写行；`Bot.tsx` 自动化面板每行加「历史」展开。
- **判据**：任一日程能回答「上次跑没跑、为什么没跑、跑了多久」；跳过与失败分开计；同一时段不重复补跑。

### P1-6 前导分区与「规则更新」

- **ORCA 的做法**：每个会话开头发一段固定结构：身份一句 → `## Tools`（哪个命令干哪件事，明说「打印出来的才是现在，记忆可能过期」）→ `## SOUL.md` → 名字行（`If SOUL.md names you differently, use X`）→ `## MEMORY.md`（引文 + 标签）→ `## Rules`；工具/规则有版本块，运行中的会话收到一条「[Orca rules update]」**只替换名字 + Tools + Rules**，不碰 SOUL/MEMORY；新建第一轮另有 first-run 规则（先问用途、只做一个真实小结果、然后写 SOUL.md）。
- **对应文件**：`src/main/bots/bot-preamble.ts`（`buildBotPreamble` / `botRulesBlock` / `BOT_FIRST_RUN_RULES`）、`src/main/bots/bot-session-instructions.ts`。
- **我们的差距**：`compileContext()` 已有分区与预算（比 8e0c267e 那版 ORCA 更细），但没有：① 「规则过期」的显式提示；② 运行中改人格/技能后给模型补一条「规则已更新」；③ 名字优先级行；④ 第一轮的特殊规则（我们用 `intro` 分支，一次性写入 `persona.mission`）。
- **抄**：名字优先级 + 工具/规则的版本块与「只替换这两节」的更新消息 + 第一轮规则里「先问用途、做一个真实小结果」的顺序。
- **不抄**：23 个 agent 各自的指令投递差异（`READS_INSTRUCTIONS_EACH_START`）——我们只有一条通道。
- **落点**：`electron/bot/index.mjs` 的 `compileContext()` / `buildSystemPrompt()`；`botSave()` 成功后对活跃 thread 落一条 `role=system, kind=rules-update` 消息。
- **判据**：改完技能后下一轮 system 里出现新技能且旧技能消失（不是两份都在）；改名字后模型自称新名字；老会话不会因为一次保存被塞两份人格。

### P2-1 机器人自己的技能目录

- **ORCA 的做法**：`skills/<name>/SKILL.md` 放在 bot 的 home；启动时把每个技能软链到 `.claude/skills` 与 `.agents/skills`，Orca 只补缺失的链接，**从不删除或改写 agent 目录里的东西**。
- **对应文件**：`src/main/bots/bot-own-skills.ts`、`src/shared/bots/bot-package.ts`（`BOT_OWN_SKILLS_FOLDER` / `BOT_AGENT_SKILLS_FOLDERS`）、`src/main/bots/bot-skill-projects.ts`。
- **我们的差距**：技能是 5 个内置 id（`electron/bot/skills.mjs`），人不能加、不能改；模板也不能带技能正文。
- **抄**：目录结构与「只补不删」的安装纪律；技能正文进 system 的预算上限按现有 2400 字符。
- **不抄**：跨 CLI 的链接矩阵（我们只有一个执行通道）。
- **落点**：`electron/bot/skills.mjs` 增 `readOwnSkills(botDir)`；`userData/bots/<id>/skills/`；`Bot.tsx` 能力 tab 增加「打开技能目录」（不做文件编辑器）。
- **判据**：放一个 `SKILL.md` 进目录后下一轮生效；删掉后下一轮不再出现；预算超限时按 2400 截断并提示。

### P2-2 模板 = 一个可复制的包

- **ORCA 的做法**：模板是「一个 bot package」：SOUL 种子字段 + 技能（13 个共享小技能）+ 连接器 + 日程（创建时默认关闭）+ 事件自动化（第一轮里再提议）；只在创建时深拷贝一次，之后目录更新不碰已有 bot；6 个分类（coding / releases / support / planning / ops / personal）。
- **对应文件**：`src/shared/bots/bot-templates.ts`、`src/shared/bots/bot-template-catalog/*`、`src/shared/bots/bot-package.ts`、`src/main/bots/bot-template-create.ts`。
- **我们的差距**：6 个模板只深拷贝人格 / 职责 / 技能 id / 能力，预置日程默认停用（`electron/bot/templates.mjs`）；没有「模板里带技能正文」和「模板提议事件自动化」。
- **抄**：包形状（soul 种子 + 技能正文 + 日程 + 事件提议）+ 「创建时深拷贝、之后不跟随」。
- **不抄**：连接器与 avatar outfit（我们没有这些连接器；outfit 是纯装饰）。
- **落点**：`electron/bot/templates.mjs` 的模板对象增 `skills: {name, body}[]` 与 `eventSuggestions[]`；`src/components/Bots.tsx` 新建面板显示「这个模板会预置什么」。
- **判据**：模板更新后已建 bot 的字段不变；新建后第一轮能提出模板里的事件自动化草稿。

### P2-3 工具凭据信封与健康检查

- **ORCA 的做法**：每个 bot 的 HTTP 工具凭据整体密封，绑定 bot 目录与 id；agent 只拿到 Orca 的中继地址和它自己的 token；保存时校验目标未变、值未丢、名字未与 agent/Codex stdio 冲突，失败给可读 code。
- **对应文件**：`src/main/bots/bot-tool-credentials.ts`、`bot-tool-credential-envelope.ts`、`bot-tool-health-checks.ts`、`bot-tools-revision.ts`、`src/shared/bots/bot-tool-draft.ts`。
- **我们的差距**：没有远程 HTTP 工具，也没有 MCP 添加；所以「抄」价值有限，但**校验与失败码的形状**值得抄（对应 `REQ-bot-intelligence.md` SR-B01 的「拒绝有可读原因」）。
- **抄**：失败 code + 「值未变/目标未变」的并发校验；不抄密封与中继。
- **落点**：`electron/bot/tools.mjs` 的参数校验统一返回 `{ code, message }`，UI 用 code 出文案。

### P2-4 群聊房的投递语义

- **ORCA 的做法**：群房有 turn 预约（多成员同时被叫时不重复占用）、完成后回复（`bot-group-completed-replies.ts`）、附件（`bot-group-attachments.ts`）、远端提问与回答（`bot-group-remote*.ts`）、房内 worker 报告能活过 Stop 与删房（`6c3313a63`）。
- **对应文件**：`src/main/bots/bot-group-*.ts`（22 个新文件）、`src/shared/bots/bot-group-*.ts`。
- **我们的差距**：已有 @ 路由、主管先回、`handoff_to_bot` 一跳、按 botId 分块流式（`ARCH-bot.md` §0.1「群聊实时感」）。缺：成员并发预约、附件、群内 item、完成后回复。
- **抄**：turn 预约（同一成员同一轮不重复开口）与「完成后回复」。
- **不抄**：跨机/跨云投递、手机端。
- **落点**：`electron/bot/index.mjs` 的 `botGroupSend` 增加 `(groupId, botId, turnId)` 预约表（内存 + 落库二选一，倾向内存）。

### P2-5 团队策略 / 多端 / 增量 chat tree（记录，不抄）

| 项 | ORCA 文件 | 为什么不抄 |
|---|---|---|
| 团队策略关 bots | `src/main/bots/bot-team-policy.ts` | 自托管单机，没有云侧策略；抄了等于加一个我们无法验证的开关 |
| 配对电脑互发邮件 | `bot-group-remote*.ts`、`paired-bot-rosters.ts` | 我们的「主机」模型是任务调度，不是 agent 对等网 |
| 手机端 152 个文件 | `mobile/src/bots/` | 无移动端 |
| 每 bot chat tree 增量索引 | `bot-chat-tree-index.ts` | 数据量到之前，P0-4 的切片推送够用；到 10k 会话再考虑 |

---

## 4. 明确不抄（红线对齐）

| 不抄 | 理由 |
|---|---|
| **给 bot 自由 shell** | 与「写操作必须人确认」冲突（`ARCH-bot.md` §3.3、`REQ-bot-intelligence.md` §8）。ORCA 靠 agent 的审批模式兜底，我们没有那层 |
| **多 CLI runtime（23 个 agent）** | 我们是单通道 + 受控工具；换一套 runtime 等于重写调度、审批、轨迹 |
| **独立 SQLite 文件 + 只读降级** | 我们单进程单库；多一个文件就多一套迁移与锁 |
| **Items 的邮件投递（`mail` 列）** | 单进程内直接发事件即可 |
| **云侧 access request 轮询** | 无云端账号体系 |
| **`MEMORY.md` 作为事实源** | 我们 `harness.db` 是事实源，镜像只读（`ARCH-bot.md` §4）。ORCA 相反是因为它没有 DB 层 |
| **把状态写进记忆** | ORCA 自己在 `f29e273a4` 里纠正过：工作状态进 Items，不进 MEMORY.md。我们更不该把 `bot_turns` 状态再抄进记忆 |

---

## 5. 第一批可开工的 3–5 条

按「一次做完能验收、互不阻塞」排。**第 1 与第 4 条建议同一周做**，它们都是纯函数 + 收口，决定「bot 今天会不会打扰你、会不会漏密钥」。

| # | 范围 | 落点 | 验收 |
|---|---|---|---|
| **1** | 静默标记 + 空跑不通知（P0-1） | `electron/bot/quiet.mjs`（新）、`electron/bot/index.mjs`（`speak` / `reply` 收口）、`electron/bot/notify.mjs`、`Bot.tsx` 回合行 | 日程空跑 0 通知；`**NO_REPLY**` / `NO_REPLY.` / `> NO_REPLY` 三种装饰全中；被点名时前半句保留 |
| **2** | Items 最小台账（P0-3） | `electron/db.mjs`（3 张表 + 显式列名迁移）、`electron/bot/items.mjs`（新）、`electron/bot/tools.mjs`（`item_add/set/comment/list`）、`Bot.tsx` 右栏「待办」、`Bots.tsx` 行尾计数 | 一条真实任务能在台账里看到状态 + 链接 + 结论；`needs_you > 0` 才上 chrome；50 条/页、翻页不重排 |
| **3** | 作用域增量通知（P0-4） | `electron/main.mjs` 的 `broadcast()` 拆 `broadcastBot()`、`electron/preload.cjs`、`src/App.tsx`、`Bot.tsx` | patch 体积 < 全量 5%；200 轮会话滚动 p95 ≤16ms；全量 `harness:state` 仍可兜底 |
| **4** | 密钥封口统一（P0-2） | `electron/redact.mjs`、`electron/bot/tools.mjs` 统一出口、`electron/bot/webhook.mjs` / `github.mjs` | 工具入参 / 工具结果 / 链接三类用例全绿；`bot_turns.trace` 与 `bot_events.url` 命中数为 0 |
| **5** | 记忆行模型与装载上限（P0-5） | `electron/memory/index.mjs` 的 `botMarkdown()`、`electron/bot/index.mjs` 的 `compileContext()`、`Bot.tsx` 记忆面板 | 面板行数 = system 行数；300 行镜像出现「N 行未载入」；每条可看来源 |

**顺序理由**：1 与 4 是纯函数 + 收口，半天到一天，能立刻减少打扰与泄露面；2 是数据语义，越晚做迁移越贵；3 依赖 1/2 产生的数据量才有性价比；5 与 2 无依赖，可并行。

**不要放进第一批**：Tidy-up 自动整理（要先有历史与 Undo 表，P1-1）、Look around（要先有只读闸门与建议存储，P1-3）、请求三型（要先有按人授权的数据形状，P1-4）。

---

## 6. 未验证 / 推断

| 项 | 状态 |
|---|---|
| ORCA bot 的 `bot reply --choice` 在 Slack 上的完整交互（按钮回填） | 只读了 `src/cli/bots/bot-reply-choices.ts` 与规则文案，未跑通端到端 |
| Look around 的只读白名单是否覆盖全部 `gh` 写命令 | 只核对了 `READ_COMMANDS` / `REFUSED_ARGUMENTS` 两张表，未做穷举测试 |
| Items 的 `stale` 迁移在桌面/手机两端是否同一判定 | 只读了 `BotItemsStaleSchema` 与 `bot-items-notice-parts.ts`，未读两端渲染 |
| Tidy-up 的 ops pilot 当前灰度比例 | 只有 `TIDY_UP_OPS_PILOT_FILE` 标记机制，没找到默认开关值（推断：默认关闭、按 bot 试点） |
| `bot-active-work.ts` 与 worker 状态的最终一致性 | 摘要「现算」是确定的；「worker 状态读取失败时怎么降级」未逐行读 |
| 我们能否直接把 `bot_turns` 迁成 Items 而不丢历史 | 未评估。**推断**：应新建表并把旧 `ask` 卡片读时映射，不做原地改表 |

---

## 7. 附录：怎么重跑核对

```bash
cd third-part/orca
git log -1 --format='%H %ad' --date=iso          # 应为 14c6146516c37e59857f0e30c19b64d580ee3e8c
git rev-list --count 8e0c267e..HEAD              # 991
git log --oneline 8e0c267e..HEAD -- src/main/bots src/shared/bots src/cli/bots mobile/src/bots \
  config/scripts/bot-apps | wc -l                # 207
git diff --shortstat 8e0c267e..HEAD -- src/main/bots src/shared/bots src/cli/bots mobile/src/bots \
  config/scripts/bot-apps                        # 689 files, +45673 / -34966
git diff --name-status 8e0c267e..HEAD -- src/main/bots src/shared/bots | grep '^A'   # 新增文件
```

更新这份副本（只更新、不留我们的改动）：

```bash
cd third-part/orca
git fetch origin main --no-tags && git switch main && git reset --hard origin/main
```

> `git fetch --all` 会在一次 RPC 里拉全部分支并可能被重置（本机实测 `RPC failed`）；只拉 `main` 可稳定完成。
> 拉完后把本文 §0 的「新 commit / 日期」和 §2 的主题表按新窗口重写。
