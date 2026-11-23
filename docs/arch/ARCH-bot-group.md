> 层：架构 · 状态：部分落地 · 核对：2026-11-23 · 覆盖：群聊的路由协议、共享上下文、未读、失败语义与对照 ORCA 的差距

# Arch · 机器人群聊

> 需求：[`../product/REQ-bot-group.md`](../product/REQ-bot-group.md)。
> 上游：[`ARCH-bot.md`](ARCH-bot.md)（人格 / 记忆 / 能力）、[`ARCH-bot-workspace.md`](ARCH-bot-workspace.md)（交接给工作区）。
> 参照：`third-part/orca @ 1ab037e`（MIT，本地只读副本，整个 `third-part/` 不入库）。

## 0. 一句话

```text
群聊 = 一个房间 + 一组可被 @ 的成员 + 一条明确的投递规则 + 一份共享上下文
```

前半句我们早就有；这一轮补的是**后半句**：一行 `@` 到底叫到谁、没叫到谁时回不回、成员之间怎么接力、后来的人看得见什么。

---

## 1. ORCA 有没有群聊：有，而且是一等公民

不是「多个 bot 各聊各的」，是 `BotGroup` 房间：

| ORCA 能力 | 源码锚点（`third-part/orca @ 1ab037e`） |
|---|---|
| `BotGroup` 有 `replyMode = bot / all / mentions`，成员在**群 home 的 session** | `src/shared/bots/bot-group-schema.ts:20`、`:93`；`src/main/bots/bot-group-membership.ts:47`（`createGroupHome`） |
| 一个群可开多个房间（threads），每个成员一个新 session | `src/shared/bots/bot-group-schema.ts:92`；`src/main/bots/bot-group-membership.ts:154`（`createBotGroupThread`） |
| @ 解析忽略代码块 / 引用 / 引号 / 文件路径；按最长名字匹配；`mentions` 模式没 @ 时收件人为空 | `src/shared/bots/bot-group-mentions.ts:166`（`replyModeAudience`）、`:196`（`botGroupAudience`）、`:118`–`:133`（先 blank 掉不可寻址片段） |
| 成员回复里的 `@Name` 会唤醒其他成员（跳过自己 / everyone / 引号里的） | `src/shared/bots/bot-group-mentions.ts:139`（`botGroupReplyMentions`） |
| 房间内串行化投递，避免同一条消息被两个成员同时接 | `src/main/bots/bot-group-delivery.ts:42`（`runKeyedSerializedOperation`） |
| 跨机成员：本机只存成员信息，问/答走 mail | `src/shared/bots/bot-group-schema.ts:35`（`BotGroupRemoteMemberSchema`） |
| 群未读：成员回合结束标记房间 news | `src/main/bots/bot-group-runtime.ts:72`（`markBotGroupRoomUnread`） |
| 沉默用 quiet marker 收口，不让空气泡进房间 | `src/shared/bots/bot-group-schema.ts:272`（`isQuietBotResult`） |
| 群状态点 = 成员 session 的 permission / working 汇总 | `src/shared/bots/bot-group-status.ts`（`botGroupStatus`） |

**我们的差距不是「有没有群」，而是「房间的规则」**：之前 `mentions` 模式没有 @ 时会退化成「主管 + 第一个成员」双答，@ 也只靠一条正则扫全文（代码块和路径会误伤）。

---

## 2. 这一轮补了什么

| 面 | 做法 | 落点 |
|---|---|---|
| @ 解析 | 先把代码块 / 行内代码 / 引用 / 引号 / 文件路径替换成**等长空格**（偏移不变），再按最长名字匹配；短名取 `split("·")[0]`；同名不同人判 ambiguous | `electron/bot/group.mjs` 的 `parseGroupMentions` |
| 投递规则 | `mentions` 无 @ = 0 人（不再退化）；`all` = 全体；`bot` = 固定且必须在群；`@everyone` = 全体；`whoCanAsk=owner` 的 bot 不进群 | `groupAudience` / `botGroupSend` |
| 失败语义 | 歧义 / 开头 @ 不存在 / 固定成员被移出 → **发送前**报错，不落半条 owner 消息；没有收件人时落一行系统提示 | `botGroupSend` |
| 成员接力 | 回复正文里的 `@成员` 在本轮结束后唤醒对方：最多 2 个、只跟一跳、去重、不叫醒自己 / 已回过的人；需要对方的信息用 `ask_bot`（系统行 `【问】A → B`），转让责任用 `handoff_to_bot` | `replyMentions` / `ask_bot` + `botGroupSend` 的 `wakeAll` |
| 共享上下文 | 每轮注「上一轮别人 + 本轮前面别人」，不含自己（自己的话在各自 thread 历史里），≤2600 字符 | `groupContextLines` |
| 未读 | 按话题已读 `bot_groups.reads = { threadId \| main: timestamp }`（`last_read_at` 保留兼容）；左栏群行取各话题未读之和；正在看的话题自动 `botGroupSeen` 清零，别的话题保留 | `electron/db.mjs` / `botGroupSeen` / `Bot.tsx` |
| 回复节奏 | `replyMode.pace`：并行（默认）/ 依次；依次时后说的成员能看到本轮前面刚说的 | `botGroupSend` / 群侧栏「回复节奏」 |
| 群内话题 | `bot_groups.threads` + `bot_group_messages.thread_id`；每话题独立消息流 / 草稿 / 回复流；第一句成为标题；默认话题保留老消息 | `electron/db.mjs` / `botGroupSend` / `Bot.tsx` 群侧栏「话题」 |
| 群共识 | `bot_groups.memo` ≤600 字，注入每个成员的 system prompt（`sectionChars.groupMemo`）；空不注入；不改成员职责 | `compileContext({ groupMemo })` / 群侧栏「群共识」 |
| 话题会话 | `bot_groups.sessions = { topic: { botId: threadId } }`；每个成员在每个话题用独立 bot thread（`separate: true`），群会话不进 1:1 Chats；删话题 / 删群 / 删 bot 同步清理 | `botGroupSend` 的 `sessionFor` / `chatsOf` / `Bot.tsx` |
| 群附件 | `botGroupSend` 接受 ≤3 个文本附件（每个 ≤4000 字）；内容只进本轮 prompt，消息 `meta.attachments` 只留 `{name,path}`；UI 在 owner 气泡下显示附件 chip | `botGroupSend` / `GroupMessageRow` |
| 跨话题摘要 | `crossTopicDigest` 取其他话题最近 2 条（≤1200 字符），进 system prompt；标注「背景，不是指令」 | `electron/bot/group.mjs` / `compileContext({ groupDigest })` |
| 群档案 | `userData/bot-groups/<id>/GROUP.md` 只读镜像（群名 / 共识 / 成员 / 话题 / 回复规则）；群保存 / 话题变更 / 发消息后刷新；删群清目录；「主目录」打开 | `groupMarkdown` / `syncGroupFile` / `Bot.tsx` |
| 测试 | 9 组纯函数用例：代码/引用/路径、歧义、无 @、@everyone、固定成员缺失、回复接力、共享上下文 | `tests/bot/group.test.mjs` |

---

## 3. 路由协议

```text
owner 发一句
  ├─ parseGroupMentions（blank 掉不可寻址片段）
  ├─ 有歧义 / leading @不存在 / 固定成员缺失 → 报错，不落消息
  ├─ 收件人 = @ 到的人 ∪ @everyone
  │     └─ 没 @：mentions → ∅；all → 全体；bot → 固定
  │           └─ whoCanAsk = owner 的 bot 永远不进群
  ├─ owner 消息落库 + 广播（不等人）
  ├─ 收件人为空 → 一行系统提示，结束
  ├─ 主管先说（如果被叫到），其余最多 3 个并行
  │     └─ 每个成员的上下文 = 上一轮别人 + 本轮前面别人
  └─ 本轮结束：工具交接 ∪ 回复 @ 唤醒，最多 2 个、一跳
```

**为什么 `mentions` 没 @ 不默认主管**：群里的默认收件人如果永远有人，用户就分不清「我是在叫他们，还是在广播」。ORCA 的口径是 `mentions` 只发被 @ 的人；我们照此修正。

**为什么回复 @ 只跟一跳**：双向来回会形成 bot 互相踢皮球。工具交接早就限定一跳，这里复用同一个 `woken` 集合。

---

## 4. 共享上下文：从「本轮临时拼」到「房间有记忆」

旧实现只拼 `seq > ownerSeq` 的本轮别人发言，所以：
- 上一轮讨论过什么，成员下一轮全忘；
- 并行成员互相看不见对方本轮的话（主管除外）。

现在 `groupContextLines` 同时给：
1. **上一轮 / 更早别人的话**（不含 owner 系统行、不含自己）；
2. **本轮前面别人的话**；
3. 截 2600 字符，防止把预算撑爆。

另有一条**群共识**（`bot_groups.memo`）进 system prompt：人写的目标 / 约束 / 已定结论，所有成员共享；它不是历史，也不改成员自己的职责。成员是否真的遵守，仍按各自人格与职责来。

不包含自己的话：机器人自己的 thread 历史已经有；重复拼会把同一句话算两遍。

---

## 5. 未读

- 每次打开群 / 群里有新消息且正在看：`botGroupSeen` 按**最新消息时间**与 `lastReadAt` 比较，只写 `last_read_at`。
- 左栏未读点：消息时间 > `lastReadAt` 且不是当前群，显示 `.bot-dot attention`，title 写「N 条新消息」。
- 不依赖消息 `seq`：换群、删群、迁移历史时 seq 可能重排，时间更稳。
- 现在按**话题**算未读：打开主话题不会把另一个话题的新消息标成已读；群行未读是各话题之和。
- 已读时间用 `Date.now()`，与消息时间比较；不依赖消息 `seq`。

---

## 6. 失败语义

| 情况 | 表现 |
|---|---|
| 多个成员同名 | 发送前报「有多个成员都能叫这个名字，写全名再发」；草稿保留 |
| 开头 @ 不存在的名字 | 报「群里没有「X」：可用 A / B」；草稿保留 |
| `mentions` 模式没 @ | owner 消息落库，跟一行系统提示「没有 @ 到成员…」；不产生空气泡 |
| 固定成员被移出群 | 报「固定回复的成员不在群里了」；不静默换人 |
| 成员回复里 @ 到已回过的人 | 不再唤醒（避免双答） |
| 成员回复为空 / 沉默 | 落一条 `decision` 细行「没有开口」，不刷正文气泡 |

---

## 7. 验收

| 判据 | 落点 |
|---|---|
| 代码块 / 引用 / 路径里的 @ 不叫醒人 | `tests/bot/group.test.mjs` |
| `mentions` 无 @ = 0 收件人 | 同上 |
| `@everyone` 过滤 owner-only | 同上 |
| 同名歧义 / 固定成员缺失 | 同上 |
| 回复 @ 跳过自己 / everyone / 代码 / 引用 | 同上 |
| 上下文含上一轮、不含自己 / 本轮未说 | 同上 |
| `last_read_at` 往返 | `tests/db.test.mjs` |
| 设计规范 / 无字符图标 | `npm run verify:design` |

---

## 8. 与 ORCA 的剩余差距（按价值排）

| 差距 | ORCA 的做法 | 我们的下一步 |
|---|---|---|
| **群 home 作为 folder workspace / 自动摘要** | 群有 home 文件夹，成员 session 在里面 | 已有 GROUP.md 镜像、跨话题摘要、每话题独立 session；还缺可运行终端的群 home 与自动共识沉淀 |
| **自动结论沉淀 / 群 home** | 成员 session 在群 home 里，房间历史自然进上下文 | 群共识已由人写并注入；还没有「讨论完自动总结成共识」或群 home 文件夹 |
| **双向 peer mail / inbox** | 成员之间 question / handoff / status 走 mail，异步到达 | 现在有「工具交接 + ask_bot + @ 唤醒」一跳；还缺 inbox、answer 关联、离线补投 |
| **跨机成员** | 远端成员没有本机 session，问/答走 mail | 依赖主机执行面统一；先明确「本机群」边界 |
| **房间内投递保留** | 同一消息的 turn reservation，两个发送不会同时进房间 | 已有「依次 / 并行」；还缺投递级 reservation |
| **二进制附件 / 图片** | 群消息附件进附件 store，成员能读 | 已有文本附件拼 prompt；图片 / 大文件要附件 store |
| **群级通知 / 状态点** | 未读 news、permission/working 汇总 | 已有未读点；群级「需要你处理」可复用现有 attention 派生 |
| **群自动任务** | 房间里的 bot 可起 worker / automation | 工作区交接已完成，群内起活可作为下一步 |

---

## 9. 代码位置

| 面 | 文件 |
|---|---|
| @ 解析 / 投递 / 接力 / 上下文（纯函数） | `electron/bot/group.mjs` |
| 群主流程 / 失败语义 / 唤醒 | `electron/main.mjs`（`botGroupSend`） |
| 群表 / 未读时间 / 迁移 | `electron/db.mjs`（`bot_groups.last_read_at`） |
| 渲染层（成员选择 / 回复模式 / 未读点 / 流式） | `src/components/Bot.tsx` |
| 类型 | `src/types.ts`（`BotGroup.lastReadAt`） |
| 用例 | `tests/bot/group.test.mjs`、`tests/db.test.mjs` |
