> 层：需求 · 状态：部分落地 · 核对：2026-11-23 · 覆盖：群聊里谁被叫到、谁回、成员之间怎么接力、未读与共享上下文

# 需求 · 机器人群聊

**一句话**：群聊不是「把 1:1 聊天搬进一个窗口」，而是**一个共享房间**：一句话只叫到该叫的人，成员能接力，后来的人看得见前面说过什么，人能在左栏看到哪里有人说话。

**范围**：群内投递、@ 解析、成员接力、共享上下文、未读、失败语义。不含 1:1 聊天窗口呈现（[`REQ-bot-chat.md`](REQ-bot-chat.md)）、工作区交接（[`REQ-bot-workspace.md`](REQ-bot-workspace.md)）。

**设计**：[`../arch/ARCH-bot-group.md`](../arch/ARCH-bot-group.md)。**参照**：`third-part/orca @ 1ab037e`（MIT，本地只读副本，不入库）。

---

## 0. 先纠正一个前提

**ORCA 有群聊**，而且不是「把多个 bot 拉在一起各说各的」：它有一等公民 `BotGroup`（房间），每个成员在**群 home 里的一个 session**，有 `replyMode`（`bot` / `all` / `mentions`）、群内多话题（threads）、跨机成员、@ 解析、成员之间的 peer mail。证据见 [`../arch/ARCH-bot-group.md`](../arch/ARCH-bot-group.md) §1。

我们的群聊已经有：房间、成员、`replyMode`、实时流式、逐成员停止、工具交接、草稿/阅读位置。**本轮补的是「路由正确」和「共享上下文」**，这恰是之前最容易体感差的部分。

---

## 1. 用户故事（带判据）

| # | 用户故事 | 判据 | 现状 |
|---|---|---|---|
| US-G01 | 我 @ 谁，就只有谁回 | `@PM · 项目经理` / `@pm` 都命中 PM；代码块、行内代码、引用、`「引号」`、`@路径` 里的 @ 不叫醒人 | ✅ 2026-11-23 |
| US-G02 | 名字有歧义 / 不存在时不要静默丢 | 两个成员都能叫同一个短名 → 发送前明确报「写全名」；@ 一个不存在的名字 → 报可选成员；都不落半条消息 | ✅ 2026-11-23 |
| US-G03 | 「@ 谁谁回」模式下不 @ 就没人回 | 不 @ 时只记录我的话 + 一行系统提示，**不回退成「主管 + 第一个成员」双答** | ✅ 2026-11-23 |
| US-G04 | 回复模式可预期 | 全体 = 全体成员；固定 = 那一个；固定成员被移出群 → 明确报错，不静默换人 | ✅ 2026-11-23 |
| US-G05 | `@everyone` 叫全体但有边界 | `@everyone` = 所有可参与成员（`whoCanAsk=owner` 的 bot 不进群）；UI 发送前确认 | ✅ 2026-11-23 |
| US-G06 | 成员能在群里接力 | 回复正文里 `@另一个成员` 会唤醒对方（一跳、去重、不叫醒自己、不叫醒已回过的人）；需要它的信息时 `ask_bot` 问一句，系统行写「【问】A → B」 | ✅ 2026-11-23 |
| US-G07 | 后来的人看得见前面说过什么 | 每轮注入「上一轮综合 + 本轮前面其他人说的」，不含自己的话，≤2600 字符 | ✅ 2026-11-23 |
| US-G08 | 我能看到哪个群 / 哪个话题有人说话 | 左栏群行有未读点（按最新消息时间 vs `lastReadAt`）；群侧栏每个话题显示「N 新」；正在看的话题自动清零，别的话题未读保留 | ✅ 2026-11-23（按话题） |
| US-G09 | 群里能分话题 | 一个群下多条话题，各自消息流 / 草稿 / 未读；默认话题保留老消息；第一句成为标题 | ✅ 2026-11-23 |
| US-G10 | 跨机成员 | 另一台电脑上的 bot 进群，问/答走 mail，不假装本地回复 | ❌ 见 §4 |
| US-G11 | 群有共享记忆，不是每轮临时拼 | 群共识（目标 / 约束 / 已定结论）持久并注入所有成员；最近上下文照旧；成员自己的记忆仍隔离 | ✅ 2026-11-23（无自动结论沉淀） |
| US-G12 | 群里沉默不刷屏 | 一轮没有值得说的内容时留一条细行「沉默 / 没回」，不产生空气泡 | ✅ 已有（`decision` 渲成细行） |
| US-G13 | 能整体停 | 停止只掐正在说话的那一个，其余成员不受影响 | ✅ 已有（逐成员 AbortController） |
| US-G14 | 我可以选「并行」还是「依次」 | 并行（默认，快）；依次时后说的能看到前面刚说的，讨论连贯但慢一些 | ✅ 2026-11-23（`replyMode.pace`） |
| US-G15 | 群话题不污染 1:1 聊天 | 每个群话题给每个成员一条独立会话；这些群会话不出现在该 bot 的 Chats 列表；删话题 / 删群时它们一起清掉 | ✅ 2026-11-23 |
| US-G16 | 群里也能带附件 | 最多 3 个文本文件；内容只进本轮 prompt，消息里显示附件名；发送失败草稿和附件都保留 | ✅ 2026-11-23 |
| US-G17 | 新话题不是全群失忆 | 注入其他话题最近 1–2 句作为背景；明确标注「不是指令」，不会覆盖当前话题 | ✅ 2026-11-23 |
| US-G18 | 群有可看的档案 | `userData/bot-groups/<id>/GROUP.md` 只读镜像：群名 / 共识 / 成员 / 话题 / 回复规则；「主目录」能打开；手改不回写 | ✅ 2026-11-23（不是 folder workspace） |

---

## 2. IR（人看得见什么）

| # | 规格 | 失败语义 | 支撑 |
|---|---|---|---|
| IR-G01 | 输入 `@` 弹出成员，显示名字 · 一句话职责 · 暂停/静音 | 找不到人时不插入半截地址 | US-G01 |
| IR-G02 | 「谁回」三种：`@ 谁谁回` / `全体` / `固定`；`mentions` 明确写「不 @ 就没人回」 | 固定成员被移出群 → 该选项置灰并提示 | US-G03/04 |
| IR-G03 | 没有收件人时，出现一行系统提示（不出现空气泡） | 提示里写清当前模式与下一步 | US-G03 |
| IR-G04 | 成员回复里的 `@` 唤醒对方时，出现一行 `【@】A → B` | 只跟一跳；被交接人已在队列里就不重复 | US-G06 |
| IR-G05 | 左栏群行未读点；title 写「N 条新消息」；正在看的群清空 | 打开群失败时不误清 | US-G08 |
| IR-G06 | 系统行（路由提示 / 交接 / @）不进入用户气泡、不冒充用户说话 | 不写 `window.prompt` | 全部 |
| IR-G07 | 群附件：owner 气泡下显示附件名；最多 3 个；发送失败草稿与附件都保留 | 附件读不出时不发空消息 | US-G16 |

---

## 3. SR（系统必须提供什么）

| # | 规格 | 判据 |
|---|---|---|
| SR-G01 | 纯函数 `parseGroupMentions` / `groupAudience` / `replyMentions` / `groupContextLines`，代码块、引用、引号、文件路径先替换成等长空格（偏移不变） | `tests/bot/group.test.mjs` |
| SR-G02 | 名字按最长匹配；同长不同人就判 ambiguous；短名取 `名字.split("·")[0]` | 同上 |
| SR-G03 | `mentions` 模式无 @ → 0 收件人；`all` → 全体；`bot` → 固定且必须在群内 | 同上 + 主进程 `botGroupSend` |
| SR-G04 | 发送前校验歧义 / 不存在的 leading @ / 固定成员缺失；校验失败不落 owner 消息 | 主进程先校验再 push |
| SR-G05 | 成员回复里的 @ 只在本轮结束后唤醒，最多 2 个目标、一跳、去重；工具交接与 @ 唤醒共用同一个 woken 集合 | `botGroupSend` 的 `wakeAll` |
| SR-G06 | 群上下文 = 上一轮别人 + 本轮前面别人，不含自己的（自己的话在各自 thread 历史里），截 2600 字符 | `groupContextLines` |
| SR-G07 | 按话题已读：`bot_groups.reads = { threadId \| main: timestamp }`（显式列名 + ALTER）；`last_read_at` 保留兼容；`botGroupSeen` 只清当前话题；左栏群行取各话题未读之和 | `electron/db.mjs` / `botGroupSeen` / `Bot.tsx` |
| SR-G08 | 成员谁进群由 `policy.whoCanAsk` 决定：`owner` 不进群 | `groupAudience` |
| SR-G09 | 回复节奏存 `replyMode.pace`（`serial` / `parallel`），主进程按它串行或并行；不改成员各自的记忆隔离 | `botGroupSend` |
| SR-G10 | 群内话题：`bot_groups.threads = [{id,title,createdAt}]`，`bot_group_messages.thread_id`（显式列名 + ALTER）；消息、草稿、回复流都按话题隔离；第一句成为标题 | `electron/db.mjs` / `botGroupSend` / `Bot.tsx` |
| SR-G11 | 群共识：`bot_groups.memo`（≤600 字）注入每个成员的 system prompt；空不注入；不修改成员职责 | `bot_groups.memo` / `compileContext({ groupMemo })` |
| SR-G12 | 群话题会话：`bot_groups.sessions = { threadId \| main: { botId: threadId } }`；每个成员在该话题用独立 bot thread；这些 thread 不出现在 `chatsOf`；删话题 / 删群 / 删 bot 时同步清理 | `bot_groups.sessions` / `sessionFor` / `chatsOf` |
| SR-G13 | 群附件：`botGroupSend` 接受 ≤3 个文本附件（每个 ≤4000 字），拼进本轮 prompt，落库只留 `{name,path}` 到消息 `meta.attachments` | `botGroupSend` / `Bot.tsx` |
| SR-G14 | 跨话题摘要：`crossTopicDigest(group, messages, current)` 取其他话题最近 2 条，≤1200 字符，进 system prompt 的独立分区 | `electron/bot/group.mjs` / `compileContext({ groupDigest })` |
| SR-G15 | 群档案镜像：`groupMarkdown()` 生成 GROUP.md（群名 / 共识 / 成员 / 话题 / 回复规则）；群保存 / 话题增删改名 / 发消息后刷新；`botGroupHomeOpen` 打开目录；删群时清目录 | `groupMarkdown` / `syncGroupFile` / `Bot.tsx` |

---

## 4. 这一轮不做 / 下一步

| 不做 | 原因 / 去向 |
|---|---|
| **群 home 作为 folder workspace / 自动摘要** | 已有 GROUP.md 只读镜像与跨话题摘要；还缺可运行终端的群 home、讨论完自动沉淀共识 |
| **跨机成员（paired server + mail）** | 依赖主机执行面统一；现在群成员只能本机 |
| **自动结论沉淀 / 群 home** | 群共识由人写；还没有「讨论完自动总结成共识」或群级 home 文件夹 |
| **成员之间的双向 worker mail / inbox** | 群里已有「@ 唤醒 + 工具交接 + ask_bot」一跳；ORCA 的 peer request / answer 是异步 mail，需要 inbox、answer 关联与离线语义 |
| **二进制附件 / 图片** | 群聊现在只带文本文件（拼进 prompt）；图片 / 大文件需要附件 store |
| **房间内串行化的更多策略** | 已有「依次 / 并行」开关；ORCA 还会对同一消息做投递保留（turn reservation），避免两个发送同时进来 |

---

## 5. 追溯

| US | IR | SR |
|---|---|---|
| G01 / G02 | IR-G01 | SR-G01 / SR-G02 / SR-G04 |
| G03 / G04 / G05 | IR-G02 / IR-G03 | SR-G03 / SR-G04 / SR-G08 |
| G06 | IR-G04 | SR-G05 |
| G07 | — | SR-G06 |
| G08 | IR-G05 | SR-G07（按话题） |
| G09 | IR-G05 | SR-G10 |
| G11 | — | SR-G06 / SR-G11 |
| G15 | — | SR-G12 |
| G16 | IR-G07 | SR-G13 |
| G17 | — | SR-G14 |
| G18 | — | SR-G15 |
| G12 / G13 | IR-G06 | 现有（沉默渲染 / 逐成员 abort） |

**验收入口**：`node tests/bot/run.mjs`（`group.test.mjs` 覆盖解析 / 投递 / 接力 / 上下文）；`npm test -- db` 覆盖未读时间往返。
