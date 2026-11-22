> 层：架构 · 状态：部分落地 · 核对：2026-11-22 · 覆盖：多个人格 bot 的身份、记忆、主动开口与起任务边界

# Arch · Bot（人格 bot）

> 目标：让 Agent 以**固定人格**长期存在——本地 Chat 和 IM 是同一个身份、同一套记忆，且**以主动开口为主**。
> 关联：[`ARCH-memory.md`](ARCH-memory.md)（四层记忆与注入预算）、[`ARCH-memory-persona-im.md`](ARCH-memory-persona-im.md)（画像数据模型）、[`ARCH-im-gateway.md`](ARCH-im-gateway.md)（飞书通道）、[`ARCH-super-agent.md`](ARCH-super-agent.md)（起任务）、[`ARCH-multi-agent-workspace.md`](ARCH-multi-agent-workspace.md)（thread/todo/run）、[`REQ-bot-intelligence.md`](../product/REQ-bot-intelligence.md)（vs ORCA / Rakazo 的智能度差距与 IR/SR）。

---

## 0. 已定决策（2026-11-17）

| 问题 | 决定 | 直接影响 |
|---|---|---|
| 一个还是多个 | **多个** | 需要 bot 档案库 + 切换器 + 每个 bot 独立记忆视图与配额 |
| 被动回 vs 主动开口 | **主打主动** | 需要一个 tick 调度器 + 候选事件源 + 抑制策略；「沉默」是默认动作 |
| 能力边界 | **能起 Agent 任务** | bot 可以建 todo / 起 run；但必须走审批档位，不能自批 |
| 记忆边界 | **可读全部四层** | 注入时按预算裁剪；**出站前**仍走敏感过滤 |

**明确不做**：公开社交平台自动发帖/回复（X 等）、冒充真人、绕过审批的自主行动。

---

## 0.1 现状（P0 已落地，2026-11-17）

| 已落地 | 位置 |
|---|---|
| `bots` / `bot_turns` 两张表（含迁移与 300 条回合上限） | `electron/db.mjs` |
| 卡片式人格（tone / address / length / boundary / habit）、出场策略、配额 | `electron/bot/index.mjs` |
| 60s tick：候选（待输入 / 上次失败）→ 打分 → 三道闸（静音 / 间隔 / 每小时配额）→ 生成 → 记 `BotTurn` | 同上 + `electron/main.mjs` 的 `startBotTick()` |
| 沉默 / 被拦也落库，`decision` + `reason` + `injected` 可审计 | `bot_turns` |
| **机器人页（配置）**：rail 上的「机器人」，和项目页同一套骨架（概览条 + 卡片 / 列表 + 行内操作）；管名字 / 人设 / 能力档位 / 绑定执行体 / 日程 / 配额 / 暂停 / 静音，行尾「打开会话」进入会话面 | `src/components/Bots.tsx` |
| **会话（控制台）**：左 bot 列表 / 中回合流（含「为什么」）/ 右人格卡·记忆·策略；暂停 / 静音 1h / 跑一次决策；页头「← 机器人」回配置页 | `src/components/Bot.tsx` |
| **可编辑**：名字 / 语气 / 称呼 / 长短 / 边界 / 习惯（失焦或 Enter 保存）、每小时上限 / 最小间隔 / 静音时段（数字输入）、能力档位（只读 / 可起任务） | 同上，写 `bots.persona` / `bots.policy` |
| 记忆 tab 读**真实四层计数**（`memoryOverview.byLayer`）与可注入字符数；L1 标「只回查，不注入」 | `memoryOverview` |
| 能力档位只有 `read`：不建 todo、不起 run | `collectCandidates` / `speak` 不碰 actions |
| **监视任务**：任务交给 bot 后写一条 `decision=watching` 的回合（不进对话流），run 结束/状态变化时回报；「任务」页签可取消监视 | `botWatchTask` / `bots().watch` |
| **回合清理 + 沉默节流**：清空沉默/被拦记录；同类沉默 30 分钟最多记一条 | `botTurnsClear` / `tickBot` |
| **work 档位（绑定执行体）**：bot 绑定一个 worker Agent；「开跑」= 建 todo + 起 run，跑完回流一条 `decision=reported` 的汇报（带 runId） | `bots.executor_agent_id` / `botAcceptProposal` / `bots().report` |
| **dispatch 档位（可切换）**：主动开口时附一条 `proposal`；「起任务」只建 todo（`confirmed=false`），不起 run，审批仍在桌面 | `bot_turns.proposal` / `botAcceptProposal` / `Bot.tsx` |
| **取消流式**：`botCancel` → AbortController → `chatStream(signal)`；取消不落回合 | `electron/main.mjs` / `ark.chatStream` |
| **主动消息可见**：tick 出 `harness:bot-message` → toast + Rail 「Bot」未读徽标（进页面清零） | `src/App.tsx` |
| **被动对话 + 流式回复**：Bot 页输入框 → `botChat` → SSE 增量推 `harness:bot-delta` → 落一条 `decision=replied` 的回合（user 原文在 `input`） | `electron/knowledge/ark.mjs` 的 `chatStream` / `harness:bot-delta` / `src/components/Bot.tsx` |
| **记忆注入带正文**：不再只给「- [L4] 标题」目录，直接把 `inject().markdown` 当上下文（2400 字符；2026-11-22 起 8000）；`runId = bot:<id>:<turnId>` 落 `inject_log`，回滚 / 归因可查 | `recall()` / `INJECT_CHARS` |
| **记忆按 bot 隔离（owner 维度）**：`entries.owner` / `notes.owner` 为空 = 共享，`bot:<id>` = 私有；bot 只看「共享 + 自己」。当前所有写入方 owner 仍为空，接 bot 记忆写入（P1）后自动生效 | `electron/memory/index.mjs` 的 `inject({ owner })` |
| **token 配额真闸**：`budget.tokensPerHour` 接进 `gatesFor`（此前只定义不校验）；`sensitiveBlocklist` 命中 → `blocked`，正文只留本地审计 | `gatesFor()` / `hitBlocklist()` |
| **候选去重按 bot 各算各的**：A 对某条任务开过口不再挡 B（此前 seen 不过滤 botId） | `collectCandidates({ botId })` |
| **主动说过的话进上下文**：最近 3 条 `answered` 进 system prompt（不拼 history，避免破坏 user/assistant 交替），history 从 6 条提到 10 条 | `recentSaid()` / `buildSystemPrompt({ recentProactive })` |
| **`force` 只放行静音时段与最小间隔**：暂停 / 手动静音 / 条数 / token 配额照旧生效 | `gatesFor({ force })` |
| **self-test 修真**：`test()` 改成 `await`，此前 async 用例的断言在 Promise 里抛，等于「全绿但没测」；并按不变量拆成 11 个文件（失败时文件名就说明是哪条坏了） | `scripts/bot-selftest.mjs`（入口）+ `scripts/bot/*.test.mjs` |
| **日程（routine）**：`daily` / `every` / `once` / `watch` 四类触发，每条带 `prompt`（到点做什么），纯函数判定 + probe 注入（文件 mtime+size / 命令输出 sha1 在主进程）；到点由 bot 自己开口，开口成功才推进 `lastFiredAt`；对话里可让 bot 提一条日程草稿，人点「建日程」才写库 | `electron/bot/routine.mjs` / `routines` 表 / Bot 页「日程」 |
| **创建后先问用途**：种子 bot 第一轮不客套，直接问「你想让我干什么」，用户第一句话落成 `persona.mission` 并进 system prompt | `tickBot()` 的 intro 分支 / `reply()` |
| **事件级防重复**：同一 `trigger.ref` 说满 2 次即压住；与上一条近重复（相似度 ≥0.8）压住，生成后再查一次防「换说法重说」 | `electron/bot/guard.mjs` |
| **通知节流**：180 字上限 / 每小时 3 条 / 未读 ≥5 时只放行「需要你决定」的类别 / 静音不弹 | `electron/bot/notify.mjs` + `startBotTick()` |
| **运行时脱敏**：回合落库前把 `sk-…` / `ghp_…` / `Bearer …` / JWT / 32+ hex / `key=value` 换成 `[redacted]` | `electron/redact.mjs` |
| **记忆容量外显**：注入到 80% 时上下文尾部追加「已用 X/Y 字符 · 条目 N · 观察 M」，让它在保存被拒前自己整理 | `memory.usage()` / `recall()` |
| **建 / 改 / 删的入口**：新建 = 占位名 + 聚焦改名（不弹窗）；`⋯` 在**页头**（新建 / 重命名 / 迁移历史 / 删除）；日程用行内表单。原因见 `AGENTS.md` 第 12 条：Electron 不实现 `window.prompt`，之前这些按钮点了没反应 | `Bot.tsx` / `verify:design` |
| **提问卡片（ask_user）**：模型主动开口时输出 `ASK: 一句话问题` → 落一张**可作答**卡片（`bot_turns.ask = { text, status, answer }`），挂在输入框上方；人不回也不挡聊天，回一句自动结掉；「先不管」→ `dismissed`；7 天懒过期 → `expired` | `askOpen()` / `openAsks()` / `settleAsks()` / Bot 页卡片 |
| **日程落点**：`mode: "alongside"`（到点就跑）/ `"in-chat"`（等这个 bot 空下来，最多等 5 分钟就并进去）；有日程到点时 `gatesFor` 跳过「最小间隔」，否则排好的早报会被刚说的闲话挡掉 | `routine.mjs` / `tickBot()` |
| **持续 chat（bot thread）**：默认会话一条 `threads.kind="bot"`，说出口的部分镜像进 `messages`，沉默/被拦只留 `bot_turns`；`reply()` 的历史改读 thread；老回合用 `botThreadMigrate({dryRun})` 幂等搬家 | `electron/bot/index.mjs` / `ARCH-chat-thread` |
| **窗口三栏：机器人 / 聊天对话框 / 消息·设置**：左栏是 bot 与群聊（联系人，含未读点 / 暂停 / 静音）；中栏是聊天对话框（DeepSeek 式 transcript + composer）；右栏是 `消息 | 调度 | 设置` 三个 tab —— 消息是当前联系人的会话列表（搜索、＋新会话、重命名 / 删除、`N 条执行`）；调度是跨项目的 Mission（计划待审批 / 子任务进度，复用任务详情里的 `MissionOverview`）与未绑定任务的会话（点一条落到工作台的对话标签）；设置是人格卡 / 记忆 / 任务 / 自动化 / 工具与通道 / 出场规则。页面不再有 `PageHeader`：暂停 / 静音 / 跑一次决策 / 重命名 / 删除都收进右栏消息头的 `⋯`，旁边只保留「决策」 | `Bot.tsx` / `.bot-grid` / `.bot-rail-tabs` |
| **多会话（照搬 ORCA 的 Chats）**：一个 bot 可以有多个话题（`threads` 多条 `kind="bot"`）；回合记 `bot_turns.thread_id`，老回合与主动开口落在默认会话；新话题第一句话成为标题 | `chatsOf()` / `newChat()` / `botChats` / `Bot.tsx` |
| **每轮轨迹（思考 / 工具 / 终端）**：`已汇报，用时 1秒` 这一行就是轨迹开关；展开后按时间列思考（可展开全文）、工具调用、终端。工具按族渲染专属卡：终端（命令 + 输出）、编辑（+/- 行 + diff 着色）、读取（路径 + 行数）、搜索/网页、通用 IN/OUT。run 的 `messages` 优先，bot 自己的只读工具用 `bot_turns.tools` 兜底 | `traceStepsOf()` / `ToolCard` / `state.messages` |
| **独立轨迹视图**：中栏 `对话 | 轨迹`。轨迹 = 三轨时间轴（输入 / 模型 / 工具，按记录耗时比例，点击跳回回合）+ 可搜索账本（时间 / 角色 / 工具名 / 原始参数 / 结果 / 用量 / TTFT）；聊天右侧另有回合导航（短细线，**不写序号**，当前轮更长更深） | `BotTrajectoryView` / `.ds-tr-*` / `.ds-turn-rail` |
| **结构化轨迹落库**：`bot_turns.trace` 存每次模型请求（usage / TTFT / 文本）与每次工具调用（`argsRaw` / `result` / `at` / `ms`）；ACP 工具消息写 `messages.meta`（原始 `rawInput` / 完整输出），前端优先读结构字段，旧数据回退到拍平文本 | `chatStreamWithTools()` / `messages.meta` / `electron/db.mjs` 迁移 |
| **会话里的附件 / 引用 / 分支**：附件走 `docsPick` 读文本文件（最多 3 个、每个截 4000 字）拼进这一句；消息上「引用」只带 1–3 行进输入框；「分支」= 复制到当前末尾的新会话（`forkChat`），源会话一条不动 | `Bot.tsx` / `forkChat()` |
| **执行树（worker）**：会话行前面有 `N 条执行`，展开是这条会话起过的任务（`bot_turns.todoId` 反查），点进任务的会话 | `workersOf()` / `Bot.tsx` |
| **接下来 / 未读点**：Chats 顶部收「提问 / 待定建议 / 到点日程」；机器人列表的小圆点由同一份数据算（`attentionOf`） | `upNext` / `attentionOf` |
| **自动化面板**：一行一条（名称 / 下次·上次 / 启用 / 到点就跑·等这一轮 / 删除），新建仍是每天 / 每隔 / 变化才跑 | `Bot.tsx` §routines |
| **工具与通道面板**：只读工具（4 个）、通道（local / group / feishu 未接入 / mobile 不适用）、已装插件 —— 只陈述「它能碰到什么」，写操作仍走审批 | `Bot.tsx` §connectors |
| **出场规则 · 谁能找它**：`policy.whoCanAsk = owner / group / anyone`；`owner` 的 bot 不进群聊（`botGroupSend` 过滤），只在 1:1 回应 | `DEFAULT_POLICY` / `botGroupSend` |
| **群聊实时感**：`botGroupSend` 先落并广播 owner 那句，再逐个成员 `reply`，每个成员都带 `onDelta` / `onTool`（payload 带 `groupId` + `name`）并按 botId 分块流式渲染；成员之间各自一个 `AbortController`，`停止` 只掉正在说的那个；回声到达后乐观气泡让位给真消息 | `botGroupSend` / `sendDelta` / `groupStream` |
| **头像**：人格卡里选 emoji（不存图片），带底色档位 | `Bot.tsx` §persona |
| **会话正文**：agent 回复走 `RichText`（与 Chat 窗口同一套 Markdown / 代码卡 / 列表），用户消息保留纯文本气泡；视觉规范见 `ARCH-chat-ui` | `RichText` / `src/components/TaskChat.tsx` |
| **回合可恢复（bot 侧）**：被动回复先落一条 `decision: "streaming"`，增量每 800ms 节流刷新；成功后同一条改成 `replied`，取消 / 报错则删掉；**应用被杀**留下的 `streaming` 在下次 `ensureSeed()` 收成 `interrupted` 并保留半截正文 | `reply()` / `ensureSeed()` / Bot 页「被打断」行 |
| **只读工具（function calling）**：`read` 档也下发只读工具（记忆 / 资料 / 任务 / 运行 / 工作区 / git / run_log）**+ 只写自己的记忆**；`dispatch` / `work` 再加 `task_create`；`work` 且打开无人值守时再加 `run_start`。工具最多 8 轮、单轮默认 2048 token、工具轮温度 0.3；同一工具同参数 3 次或总调用 24 次强制停，停因落 `bot_turns.stop_reason`。模型自己编一个没注册的工具会被回一条 tool 错误让它改口，不会执行；网关不支持 tools 时自动退回纯对话。用过的工具留痕在 `bot_turns.tools` | `electron/bot/tools.mjs` / `chatStreamWithTools()` / `botReadTool()` |
| **观察面（2026-11-22）**：`workspace_list` / `workspace_read` / `workspace_grep` / `git_status` / `git_log` / `git_diff` / `run_log` 七个只读工具；路径锁在项目根内（含 realpath 防符号链接逃逸），拒绝 `.env` / 密钥 / 二进制 / 超大文件，搜索跳过 `.git`、`node_modules`、`dist` 等 | `electron/bot/workspace.mjs` / `botReadTool()` |
| **上下文编译器（2026-11-22）**：`compileContext()` 分区拼人格 / 记忆 / 同僚目录 / 规则，回报每区占用；记忆预算 2400 → 8000 字符；本轮回合按 query 相关度上浮；超过 24 条消息把最近 10 条之外压成摘要（`threads.digest`，纯函数、不额外调模型）；当前时间与当前项目也写进 system（算“20 分钟后”不用猜） | `compileContext()` / `historyDigest()` / `memory.inject({ query })` |
| **自己的记忆能写（2026-11-22）**：`memory_write` / `memory_forget` 只写 `owner=bot:<id>`，走 `noteAdd`（待确认观察）而不是直接 L4；密钥/令牌命中直接拒写；删除只能删自己的 | `botReadTool()` 的 `memory_write` / `memory_forget` |
| **可解释停止（2026-11-22）**：`bot_turns.stop_reason` / `context` 落库，UI 在「为什么说」里显示上下文占用、轮数、停止原因；旧 bot 的 700 token/预算在 `ensureSeed()` 一次性迁到 2048/12000 | `electron/db.mjs` / `src/components/Bot.tsx` / `ensureSeed()` |
| **对话内排日程（2026-11-22）**：`routine_propose` 只返回草稿，`bot_turns.routine_proposal` 落库；人点「建日程」才写 `routines`。日程新增 `once`（绝对时间一次）与 `prompt`（到点做什么），到点把 prompt 交给模型，不再只念名字 | `electron/bot/tools.mjs` / `routine.mjs` / `botAcceptRoutineProposal` / `Bot.tsx` |
| **人格历史（2026-11-22）**：`bot_revisions` 存人格 / 职责 / 配额上一版（每 bot 20 条）；Bot 页「历史」可一键恢复，恢复本身也记一版，不删旧记录 | `electron/bot/index.mjs` / `electron/db.mjs` / `Bot.tsx` |
| **记忆整理（2026-11-22）**：到 80% 时 `planTidy()` 按分数最低 / 最久未更新给候选（置顶与 note 不动），一键归档到 60%；`entryArchive` / `entryRestore` 可恢复，不删除 | `electron/bot/tidy.mjs` / `botMemoryTidyPlan` / `Bot.tsx` |
| **群聊交接（2026-11-22）**：`handoff_to_bot` 只在群聊可用；主进程写一条 `author=system` 的「A → B：任务」行，并且只跟一跳唤醒目标（本轮已经回过的不重复叫）；交接记在 `bot_turns.handoff` | `electron/bot/tools.mjs` / `botGroupSend` / `Bot.tsx` / `electron/db.mjs` |
| **模板与思考档（2026-11-22）**：4 个内置模板（早报 / 发布守护 / 答疑 / 运行观察），新建面板选一个，深拷贝人格 / 职责 / 能力，预置日程默认停用；`effort` = quick / 标准 / deep（4 / 8 / 12 轮，工具轮温度 0.4 / 0.3 / 0.2） | `electron/bot/templates.mjs` / `Bots.tsx` / `effortPolicy()` |
| **版本 diff 与并发（2026-11-22）**：`botRevisionDiff` 只列有变化的字段；`botSave` 带 `expectedUpdatedAt`，旧页保存会冲突而不是覆盖；恢复仍生成新版本 | `electron/bot/index.mjs` / `botRevisionDiff` / `Bot.tsx` |
| **机器人设置分类（2026-11-22）**：控制台右栏「设置」= 5 个 tab：身份（人格 + 职责 + 历史）/ 能力（档位 + 执行体 + 模型 + 思考档 + 工具 + 技能 + 通道）/ 记忆 / 自动化 / 规则（谁能找它 + 频控 + 静音 + 通知）。**「工作」从设置移出**：待处理、分到的任务、监视任务放到会话列顶部；任务是任务面板的事，不是配置。独立「档案」页已删除 | `src/components/Bot.tsx` |
| **技能包（2026-11-22）**：5 个内置技能（状态简报 / 代码审查 / 发布检查 / 事故记录 / 记忆纪律）；`bots.skills` 存 id，档案页可开关；技能正文进 system prompt，硬上限 2400 字符；模板可预置技能 | `electron/bot/skills.mjs` / `compileContext()` / `Bot.tsx` |
| **项目/主机绑定（2026-11-22）**：`bots.project_id` / `bots.host_id`；能力 tab 选默认项目 / 主机，项目页与主机页的行菜单也能「交给机器人」。`workspace_*` / `git_*` / `task_create` 用绑定项目，executor 只能选绑主机上的 Agent | `electron/db.mjs` / `botReadTool()` / `Views.tsx` / `Bot.tsx` |
| **MEMORY.md（2026-11-22）**：每个 bot 生成 `userData/bots/<id>/MEMORY.md`（共享 + 自己的 L4/L3/L2 + 观察）；**只读镜像，DB 仍是事实源**，手改不回写；记忆写入/删除/归档后自动刷新 | `memory.botMarkdown()` / `botMemoryFile()` / Bot 页「MEMORY.md」 |
| **计划与可续（2026-11-22）**：`plan_set` / `plan_update` 把目标与步骤写进 `bots.plan`；重开应用还在，下一轮进 system prompt；这是计划级续跑，不是 turn checkpoint | `electron/bot/tools.mjs` / `compileContext()` / 会话列「计划」 |
| **无人值守（2026-11-22）**：`policy.standing` 默认关；work 档 + 绑定项目 + 每小时上限才允许 `run_start` 启动**已建好**的任务；越界/超限/在跑都拒绝 | `botReadTool()` 的 `run_start` / Bot 页「规则」 |
| **Webhook 入站（2026-11-22）**：本机 `127.0.0.1` 随机端口监听；每个 bot 一个 token，`POST /hook/<token>` 收 `{title,text,url,id}`；写 `bot_events` 去重，bot 说过一次即 seen | `electron/bot/webhook.mjs` / `startWebhookServer()` / Bot 页「Webhook 入站」 |
| **GitHub 事件（2026-11-22）**：`policy.github.enabled` 打开后每 5 分钟用本机 `gh` 只读拉「等你 review 的 PR」与「失败 CI」；去重键 + seen + 12h TTL；没装/没登录静默跳过 | `electron/bot/github.mjs` / `pollGithubEvents()` / `bot_events` |
| **组织（2026-11-22）**：`bots.team` 自由文本；身份 tab 可改，卡片显示团队标签，群聊名册带团队；Bots 可按团队排序。不做权限体系 | `electron/db.mjs` / `Bot.tsx` / `Bots.tsx` |
| **per-bot 通知开关（2026-11-22）**：`policy.notify` 四个开关（主动开口 / 需要你决定 / 任务完成 / 未能完成）；run 完成与失败也会按开关弹通知，仍受 180 字 / 每小时 3 条 / 未读节流约束 | `electron/bot/notify.mjs` / `startBotTick()` / run 完成与失败路径 / `Bot.tsx` |
| **职责卡（persona.duty）**：目标 / 范围 / 交付物 / 不做什么 / 汇报口径，与 `mission`、`role` 一起进 system prompt —— 只写人设不写职责，PM 和 DE-A 在模型眼里是同一个人 | `buildSystemPrompt()` / Bot 页「职责卡」 |
| **记忆写入按 bot 落 owner**：bot 起的 run（`todo.botId`）经 MCP 写记忆时默认 `owner=bot:<id>`，读侧 `inject({ owner })` 只看「共享 + 自己」；人手开的 run 仍写共享层 | `startWikiMcpServer()` 的 `ownerOf()` |

**人格为什么留在 `bots.persona`**：这是**多 bot** 产品，人格属于「这个 bot」，不属于「我」。`persona` 模块建模的是"人"（含别人的双时态证据链），和 bot 人格不是一张表；两者只在"结构化字段"这一层同构。真要复用画像，也应该是「从某个画像复制一份人格卡」，不是共享一行记录。

## 1. 一句话

```text
Bot = 一条人格（persona.self） + 一份记忆（四层 + 预算） + 一组能力（起任务，需审批） + 一套触发（主动为主）
```

没有这四个面同时绑定，做出来只是「换了头像的 Chat」。反过来，四件都绑住之后，bot 的每一句话都能回答三个问题：**它是谁、它当时记得什么、它为什么现在开口。**

---

## 2. 领域模型

### 2.1 Bot

```ts
type Bot = {
  id: string;
  name: string;
  avatar?: string;              // 先用 emoji/字母，不做上传
  personaId: string;            // 指向 persona 里的「我」档案（subject=self）
  model: { provider: string; model: string; temperature?: number };
  capability: "read" | "dispatch";   // dispatch = 能起 Agent 任务
  channels: ("local" | "feishu")[];  // 首版只有 local；feishu 见 P1
  triggers: Trigger[];
  budget: { tokensPerTurn: number; turnsPerHour: number; quietHours: [number, number] };
  status: "active" | "paused";
};
```

多个 bot 的隔离边界：**人格、记忆读写视图、配额、频道 allowlist 全部按 botId 分开**；同一个 thread 里不混两个 bot 的记忆。

**两个面（2026-11-21）**：机器人不再把「配置」和「说话」混在一页。

- **配置页（`src/components/Bots.tsx`，rail 上的「机器人」）**：管身份与出场规则——名字、头像、职责（`persona.mission`）、能力档位、绑哪个执行体（`executor_agent_id`）、日程数、主动开口配额、暂停 / 静音、删除。行尾「打开会话」才进会话面。
- **会话（`src/components/Bot.tsx`）**：回合流与审计。页头 `← 机器人` 回配置页；`initialBotId` 让「打开会话」直接落到那个机器人。

试过一版把机器人列表放进工作区左栏、项目上面（Orca 的 sidebar split），结论是**配置需要独立的一页**：配额 / 执行体 / 日程是「设置一次、长期生效」的东西，放进左栏会和工作区抢高度，也和工作区的心智（任务 / 终端 / 文件）打架。

**派单链（2026-11-21）**：`todos.bot_id` / `delegations.bot_id` 记住「这条活是谁派的」，`agent_id` 仍然是「谁去干」。`botAcceptProposal` 建的 todo 和 `createMissionChild` 派下去的子任务都会带上它（Mission 自己带 botId 时继承）。协调台回答「谁在干」，所以先认执行体所在的座位，执行体没上场才退回派活的机器人——不再出现「派了活却查不到人」。

**Bot 与 Agent 的关系（2026-11-21 明确）**：bot 是**人**（名字、人格、记忆、主动开口），Agent 是它**此刻借的执行体**。`bots.executor_agent_id` 指向当前借的那个 worker Agent，可以换（换 CLI / 换模型 / 换机器），**换执行体不换人**。

这条关系现在贯穿到舞台：`coordination_scenes.config.cast[]` 存的是 `botId`（老数据 `agentId` 在读的时候按 `executor_agent_id` 反查），`buildOfficeModel` 的人口也从 `state.agents` 换成了 `state.bots`。所以：

- 没绑执行体的 bot 照样上台（待命位，状态「待绑定执行体」），不会静默消失
- 同一个执行体被两个 bot 借用时，舞台上是两个人（各占一席）
- 舞台状态 = 机器状态（run / todo）+ 机器人最近一条回合（`turn / silent / blocked / escalated / watching`），「转人工 / 被拦 / 沉默」与「等待确认」平级——这正是 `bot_turns` 存在的理由

### 2.2 Trigger（主动为主）

> **已落地**（2026-11-20，2026-11-22 补 once / prompt / run.failed）：`todo.changed`（待输入 / 上次失败）、`run.failed`（2 小时内、同任务不重复）、`schedule`（daily / every / once / watch 四类 routine，每条带 prompt）、`created`（创建后先问用途）与 `mention`（被动回复）。`run.finished`（任意 run）与 `memory.due` 仍未接。

| 触发源 | 例子 | 首版 |
|---|---|---|
| `mention` | 本地 Chat @bot、IM 群里被 @ | ✅（被动兜底，必须有） |
| `todo.changed` | 任务进入 `waiting_input`、被标记失败 | ✅ |
| `run.failed` | 一次运行失败（2 小时内、同任务不重复） | ✅ |
| `github.*` | 等你 review 的 PR / 失败 CI（本机 `gh` 轮询，去重 + TTL） | ✅（默认关，需 `policy.github` + 绑定项目） |
| `webhook` | 外部服务 POST 一条 `{title,text,url}` | ✅（默认关，本机 127.0.0.1 + bot token） |
| `run.finished` | 一次 run 结束且结论里有待确认项 | ◐（bot 自己起的 run 会 `report()`；任意 run 不进候选） |
| `memory.due` | L2 条目到期、Dream 生成候选 | ❌（Dream 是独立复核流程，不进 bot tick） |
| `schedule` | 每天 9:00 说一句「今天有三条待确认」 | ✅（60s tick + daily / every / once / watch 四类判定；每条带 prompt） |
| `external` | 日历/邮件（后续） | ❌ |

### 2.3 BotPolicy（抑制策略，主动型的生死线）

```ts
type BotPolicy = {
  requireMentionInGroup: true;      // 群聊只在 @ 时回
  maxTurnsPerHour: number;          // 硬上限，超了只记 BotTurn(decision=blocked)
  minGapMs: number;                 // 两条主动消息之间最小间隔
  quietHours: [number, number];     // 静音时段不主动开口
  escalateRules: { when: string; to: "desktop" }[];  // 需要人决定的事转桌面审批
  sensitiveBlocklist: string[];     // 命中即不外发：落 blocked，正文只留本地审计（已实现）
  escalate: string;                 // 不是闸门，是写进 system prompt 的边界：请人做，别假装办了（已实现）
};
```

**主动开口的三道闸**：`候选事件 → 打分（值不值得说）→ 闸门（静音/频控/敏感）→ 发送`。任何一步不过就记一条 `BotTurn` 并保持沉默。

### 2.4 BotTurn（可解释性）

```ts
type BotTurn = {
  id: string; botId: string;
  channel: "local" | "feishu";
  trigger: { kind: string; ref?: string };   // 事件来自哪个 todo/run/记忆条目
  input: string;                              // 触发内容（被 @ 的原话，或事件摘要）
  injected: { layer: string; id: string; title: string }[];  // 本轮真正注入的记忆
  reply: string;
  decision: "answered" | "silent" | "blocked" | "escalated";
  reason?: string;                            // silent/blocked 的原因（"频控"/"静音"/"不敏感"）
  runId?: string;                             // 若这一轮起了 Agent 任务
  cost: { tokens: number; ms: number };
  createdAt: number;
};
```

**`BotTurn` 是硬要求**：没有它，主动 bot 会变成不可审计的黑箱（不知道它为什么半夜给人发消息）。

---

## 3. 四个面的接线

### 3.1 身份 → persona

现状：`persona` 是**给别人建模**（observation/relation/trait，双时态 + `asOf`）。
需要：新增 `subject: "self"` 的档案，字段复用现有三层（traits / style / communication），语义从「我观察到 TA」变成「我是谁」。

- 人格卡不是一段 prompt，而是**结构化字段**：语气、长短、称呼、边界（不聊什么）、口头禅。
- 人格一致性靠字段稳定 + 每轮注入，而不是靠「你是一个叫 XX 的助手」这句话。

### 3.2 记忆 → memory

- 可读四层（L4 结论 / L3 项目 / L2 事实 / L1 原始），但注入按 `memory.inject({ maxChars })` 裁剪，L1 默认只做回查不注入。
- bot 与人的记忆**同源**（`harness.db`），不做第二套；差异只在「这个 bot 关心哪些项目/人」的视图过滤。
- 视图形状：`inject({ owner: "bot:<id>" })` 只返回「`owner` 为空（共享）+ 自己的」条目；不传 owner 时行为不变（全库）；
- 写入：bot 自己的结论仍走现有「观察 → 待确认 → 晋升」，不能自封 L4；**bot 起的 run** 经 MCP 写记忆时默认带 `owner = bot:<id>`（人手开的 run 不带，仍进共享层）。

### 3.3 能力 → Agent

| 档位 | 能做什么 | 不能做什么 |
|---|---|---|
| `read` | 查记忆/资料/任务/运行/工作区/git，写自己的记忆；总结、解释 | 建 todo、起 run、改文件 |
| `dispatch` | 只读工具 + 自己的记忆 + 建 todo（需人确认） | 自批审批、改设置、装插件、改文件 |
| `work` | 只读工具 + 自己的记忆 + 建 todo 并盯执行体 | 自批审批、改设置、装插件、直接改文件 |

**工具表（2026-11-22）**：

| 组 | 工具 | 数据来源 |
|---|---|---|
| 记忆 | `memory_search` / `memory_write` / `memory_forget` | `entrySearch` / `noteAdd` / `noteRemove`（只到 `owner=bot:<id>`） |
| 资料 | `knowledge_search` | `knowledge().search` |
| 任务 / 运行 | `todo_list` / `run_status` / `run_log` / `plan_set` / `plan_update` | `state.todos` / `state.runs` / run 的 result + messages / `bots.plan` |
| 工作区 | `workspace_list` / `workspace_read` / `workspace_grep` | `electron/bot/workspace.mjs`（路径 jail、拒绝凭据/二进制） |
| git | `git_status` / `git_log` / `git_diff` | `gitRun`（只读） |
| 日程 | `routine_propose`（只出草稿） | 人点「建日程」才写 `routines` |
| 写世界 | `task_create`（dispatch / work）；`run_start`（仅 work + 无人值守） | `createTodo`；`run_start` 只启动已建好、属于绑定项目的任务 |

边界：工具表里**没有**任意命令 / 改文件 / 改设置。写世界只有 `task_create`（建 todo）和受 `standing` 约束的 `run_start`；记忆只写自己的；模型硬编一个未注册工具时回 tool 错误而不执行。

`dispatch` 档位的硬约束：
- 起任务前先回一句「我理解的是 X，要现在开吗」——**一句话确认**，不直接跑；
- 真正的审批仍走 `approvals`（桌面），bot 不能替人点确认；
- 每个 bot 独立配额（tokens/小时），超了降级为 `silent` + 记 `blocked`。

### 3.4 通道 → local / feishu

- **local 首版**：bot 的消息进同一个 thread（`threads`/`messages`），来源标 `bot:<id>`，和人的消息区分展示。
- **feishu（P1）**：先补 `ARCH-im-gateway.md` §3 的 8 项（app_id/secret、tenant token、WSClient、`event_id` 幂等、`im/v1/messages`、allowlist、卡片、离线语义）。群聊只回 @，陌生人忽略留痕。

---

## 4. 运行协议

```text
tick（每 60s）
  ├─ 收集候选：mention / todo.changed / run.finished / memory.due / schedule
  ├─ 对每个 bot：
  │    ├─ 过滤：频道 allowlist、静音时段、minGap、turnsPerHour、tokensPerHour
  │    ├─ 打分：事件重要性（失败 > 待确认 > 到期）+ 与 bot 相关度
  │    ├─ 决策：低于阈值 → BotTurn(silent)；否则组装上下文
  │    ├─ 注入：人格卡 + memory.inject({ maxChars: 8000, owner, query }) 的 markdown + 当前时间/项目 + 同僚目录 + 最近 10 条原文（>24 条时带压缩摘要）+ 最近 3 条主动开口
  │    ├─ 生成：模型 → 一次 chat（工具轮最多 8 轮 / 单轮 2048 token）→ 回复；停因写 stop_reason
  │    └─ 出站：sensitiveBlocklist 命中即 blocked → 发 local/feishu → 记 BotTurn
  └─ 不阻塞主线程：emit 事件，UI 订阅
```

**沉默优先**：`decision: "silent"` 是正常结果，不是异常；连续沉默不报警，但连续 24h 一条没发要能在 UI 里看到（可能是配置错了）。

---

## 5. 数据模型（草案，P0 落地时再定 SQL）

```sql
CREATE TABLE bots(id TEXT PRIMARY KEY, name TEXT, persona_id TEXT, model TEXT,
                  capability TEXT, channels TEXT, triggers TEXT, budget TEXT,
                  status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE bot_policies(bot_id TEXT PRIMARY KEY, policy TEXT);
CREATE TABLE bot_turns(id TEXT PRIMARY KEY, bot_id TEXT, channel TEXT,
                       trigger TEXT, input TEXT, injected TEXT, reply TEXT,
                       decision TEXT, reason TEXT, run_id TEXT, cost TEXT,
                       created_at INTEGER);
-- persona 表加一列 subject；不放 bot 里，保持「人」的模型唯一
```

索引：`bot_turns(bot_id, created_at)`、`bot_turns(decision, created_at)`（UI 过滤与频控统计）。

**写入必须用显式列名**（`electron/db.mjs` 的 `persist()`）：`todo_id` / `proposal` 是之后 `ALTER TABLE` 追加的，物理列序在 `cost` / `created_at` 之后，位置插入会把四列整体错位（`todo_id` 变成 `{}`，于是 `botAcceptProposal` 永远报「这条建议已经建过任务」）。同理 `threads` 的 `kind` / `bot_id` 在老库里也被 ALTER 追加过，位置插入会把两列写反。迁移里保留了两条修复语句：丢弃 `todo_id LIKE '{%'` 的历史错位行；把 `kind` / `bot_id` 互换的线程改回来。回归用例见 `tests/db.test.mjs`「bot_turns / threads 列序」。

---

## 6. UI（P0 最小）

> 可点的静态原型：[`../prototype/bot.html`](../prototype/bot.html)（三栏 + 「为什么说」审计 + 模拟 tick + 起任务确认）。

- 新页面 `Bot`（复用 `.page` + `PageHeader`）：左侧 bot 列表，中间「对话 + 最近开口」，右侧「人格卡 / 记忆注入 / 配额 / 触发」。
- 每条主动消息带一条可折叠的「为什么说」：触发源、注入的记忆条目、耗时、tokens。
- 一键 `暂停`（status=paused）与「静音 1 小时」；暂停后 tick 只记 `silent`。
- 人格卡编辑沿用设置页的 Row 形态，不新造一套表单。

---

## 7. 验收（可测）

| 指标 | 判据 |
|---|---|
| 人格一致性 | 连续 20 轮后人工判断「还是同一个人」；称呼/语气字段在回复中可检出 |
| 记忆有效性 | 注入条目被引用率 ≥ 30%；错误记忆（过期 L2）引用为 0 |
| 主动质量 | 抽 20 条主动消息，人工判「值得发」≥ 70%；静音/频控拦截 100% 留痕 |
| 安全 | 敏感条目外发 0 次；群聊未 @ 回复 0 次；陌生人触发 0 次 |
| 成本 | 每条主动消息 ≤ `tokensPerTurn`；每 bot 每小时 ≤ `turnsPerHour` |
| 可回滚 | 任意 bot_turn 能追到触发事件、注入条目、run（若有） |

---

## 8. 风险与红线

| 风险 | 应对 |
|---|---|
| 人格漂移 | 结构化人格卡 + 每轮注入；漂移靠 20 轮验收发现，不靠感觉 |
| 刷屏 / 半夜发消息 | 三道闸（打分/静音/频控）+ 沉默优先；默认 `quietHours` 非空 |
| 重复回复 | 飞书 `event_id` 幂等；本地按 `(botId, trigger.ref)` 去重 |
| 隐私外泄 | 出站前过 `sensitiveBlocklist`；bot 默认不读 L1 做外发素材 |
| 成本失控 | 每 bot 配额 + 每轮预算；超配额降级 `silent` 并记 `blocked` |
| 自批 | bot 永远不能替人点审批；`dispatch` 也只能「发起 + 请人确认」 |

---

## 9. 分阶段

| 阶段 | 内容 | 估时 | 验收 |
|---|---|---|---|
| **P0 本地人格 bot** | bot 表 + 人格卡（subject=self）+ 本地 tick + `BotTurn` + Bot 页；`read` 档位 | 1–2 天 | 20 轮一致性；「为什么说」可展开；沉默有原因 |
| **P1 起任务** ✅ | `dispatch` 档位：只能建 todo（proposal），run 仍由人确认 | 已完成 | 未经确认不起任务；审批 100% 走人 |
| **P2 飞书** | 长连接 + @ 触发 + 幂等 + 卡片 | 3–5 天 | 重推不重复；断线不假装处理 |
| **P3 多 bot 与人格库** | 多个 bot 并行 tick、配额互不干扰、切换器 | 1–2 天 | 两 bot 同一事件不同反应；互不串记忆 |

---

## 10. 明确未做

- **work 档位能起 run，但仍需一次人工点击**：「开跑」按钮就是那次授权；模型不能自己触发 run。
- **执行回流是摘要不是改稿**：run 结束后只回一条 200 字内的汇报，不重写 agent 的产出。
- **bot 对话不直接改世界**：改文件 / 跑任意命令 / 改设置全部不在工具表里；它只能写**自己的**记忆、建 todo，或在「无人值守」开启时启动已建好的 run。
- **工具调用留痕**：`bot_turns.tools` 记 `{ name, args, argsRaw, result, ms, ok }`，`trace` 记每次模型请求与工具调用；为控制表大小，单条结果按工具元数据截断（默认 6–12KB）。
- **飞书（P2）**：bot 只出本地回合流；群里 @ 触发依赖 `ARCH-im-gateway.md` §3 的长连接。
- **多 bot 并发抢占**：tick 按 bot 顺序串行跑，没有「同一事件两个 bot 都想说」的去重与协商。
- **人格模块打通**：`persona` 还没有 `subject=self`，人格卡暂时只存在 bot 档案里。
- **主动消息不进 Chat**：只有 toast + Rail 未读徽标，回合本身仍只在 Bot 页。
- **取消是硬中断**：没有"保留已生成部分写入回合"的选项。
- ~~**对话不进 thread 模型**~~：2026-11-22 已改——bot 有 `threads.kind="bot"`，回合镜像进 `messages`，工作区 Chat 直接可聊（流式 + 打字中 + 停止）。

- **公开社交平台**（X/微博/Mastodon）：无 API 配额与审核能力，且对外发言不可撤回。
- **语音/形象**（TTS、3D avatar）：先把「说什么、该不该说」做对。
- **bot 自己写人格**（自我修改）：人格只由人改，避免越跑越偏。
- **跨设备同步 bot 状态**：bot 状态在本机 `harness.db`。
- **群聊多 bot 协同**：P3 之后再看，先解决单 bot 在群里的出场规则。
