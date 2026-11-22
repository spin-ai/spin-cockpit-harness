> 层：需求 · 状态：提案 · 核对：2026-11-22 · 覆盖：机器人智能度差距（vs ORCA Bot / Rakazo Bot）的 12 条 User Story 与 IR/SR 规格

# 需求 · 机器人智能度（US / IR / SR）

**一句话诊断**：现在的「机器人」是**人格壳 + 事件闸门 + 5 个只读工具**；ORCA 和 Rakazo 的 bot 是**一个真实 agent runtime 的人格壳**。所以"笨"不是模型不够强，是它**看不到东西（无文件/命令/网页）、记不住（2.4KB 记忆 + 10 条历史）、想不长（单轮默认 700 token / 4 轮工具）、不会自己整理、也不知道同事是谁**。

> **快照口径（重要）**：§1–§6、§2 的能力矩阵、§4/§5 的「现状」列记录的是 **2026-11-22 实现前** 的基线，用来说明差距从哪来。**这篇只写「要什么 + 判据」，不写「做了没有」**：§7.1 是实现侧自评进度（可以偏低也可以偏高），真正的验收记录在 [`VERIFY-bot-intelligence.md`](VERIFY-bot-intelligence.md)（日期 + 问题 + 答成什么样）。两者冲突时以验收文件为准；不要把 §2 当今天的现状。

**范围**：bot 的"想得对不对、查得到查不到、做得到几步"——观察面、上下文、推理循环、记忆闭环、自主触发、多 bot 协作、可学习性。
**不含**：Bot 聊天窗口的呈现（见 [`REQ-bot-chat.md`](REQ-bot-chat.md)）、Rakazo 全量产品对照（见 [`COMPARE-rakazo.md`](COMPARE-rakazo.md)）、Mission 编排（见 [`../arch/ARCH-super-agent.md`](../arch/ARCH-super-agent.md)）。

**依据**：本项目源码 + `third-part/orca @ 8e0c267e`（MIT）+ `third-part/rakazo @ 8fba288`（Apache-2.0），源码副本只读、不入库。结论都带 `文件:行`；没验证的写进 §9。

---

## 0. 口径与编号

| 项 | 约定 |
|---|---|
| 用户故事 | `US-BNN`：一句话 + 括号里的**判据**（做到什么算成立） |
| 界面 / 接口规格 | `IR-BNN`：用户或别的 bot **能看见**的行为、状态、失败语义 |
| 系统规格 | `SR-BNN`：系统内部**必须提供**什么（数据、预算、IPC、落库、阈值） |
| 现状 | ✅ 已成立　◐ 部分　✗ 没有 |
| 优先级 | P0 = 现在就觉得"笨"　P1 = "像个同事"的底线　P2 = 差异化 |
| 追溯 | `US → IR → SR`，一条 US 至少一条 IR，一条 IR 至少一条 SR |

**"聪明"的 6 个可测维度**（后面矩阵按它排）：

| 维度 | 问法 |
|---|---|
| C1 观察面 | 它一轮能看到哪些**事实**？（文件、git、运行日志、网页、连接器） |
| C2 上下文 | 它一轮带得动多少**相关**信息，裁剪顺序是什么？ |
| C3 推理循环 | 它能连续查/试几次，单次输出多长？ |
| C4 记忆 | 它自己**写**不写、**整理**不整理、**找得回**找不到？ |
| C5 自主 | 什么事件能让它**自己动**，动了以后在哪回报？ |
| C6 协作 | 多个 bot 怎么**分工**、怎么**交接**、怎么知道彼此职责？ |
| C7 可学习 | 人怎么**教**它（模板 / 技能 / 指令版本），教坏了能不能回滚？ |

---

## 1. 先划清同名不同物

| | 本项目「机器人」 | ORCA Bot | Rakazo Bot |
|---|---|---|---|
| bot 是什么 | 人格卡 + 记忆视图 + 能力档位 + tick 调度 | **一个 agent CLI 会话**（pi / claude / codex…）+ `SOUL.md` / `MEMORY.md` | **一个有电脑的同事**：服务端持久状态 + Docker 沙箱 + 多端 |
| 它的"身体" | 主进程里的 5 个只读函数 + `task_create` | 真实 shell / git / `gh` / Slack / Linear / MCP / worker | 94 个内置工具：文件 / 浏览器 / 电脑 / 连接器 |
| 一轮是什么 | 一次 chat 调用（≤700 token，≤4 轮工具） | agent 的一整轮（工具不限，loop guard 兜底） | run = 可恢复 turn + 工具循环 + checkpoint |
| 记忆在哪 | `harness.db` 四层，注入 2400 字符 | bot home 的 `MEMORY.md`（200 行进上下文）+ topic 文件 | Space / bot 级 markdown，注入 32KB |
| 主动性从哪来 | 60s tick + daily / every / watch | automations（连接器事件 + webhook + 邮件 + 日历） | routines（schedule / change / webhook / git / email / slack） |
| 收口在哪 | 待确认 → TODO（人批） | PR / Slack 线程 / bot items | 审批卡片 + 聊天 |

**结论（推断）**：两家的"聪明"来自**同一条流水线**——真实动作面 → 结果进上下文 → 记忆沉淀 → 下次自己带着记忆再来。我们只做了流水线的头（人格）和尾（审计），中间三段（动作、上下文、沉淀）是断的。换更强的模型只能让第一句话更顺，补不上这三段。

---

## 2. 能力矩阵（带证据）

| 维度 | 本项目 | ORCA | Rakazo |
|---|---|---|---|
| C1 观察面 | ✗ 只有用户手工附的 3 个文件（每个 4000 字）；工具只有记忆/资料/任务/运行 | ✅ shell + git + `gh` + Slack + Linear + MCP + 工作区 | ✅ 文件 / shell / 浏览器 / 电脑 / 连接器 |
| C2 上下文 | ◐ 人格 + 2400 字符记忆 + 10 条历史（每条 ≤2000 字） | ✅ `SOUL.md` + `MEMORY.md` 200 行 + 按需读 topic 文件 + skills + 实时命令 | ✅ 指令 + 32KB 记忆（含 bot / shared 两段）+ 长对话摘要 |
| C3 推理循环 | ✗ 4 轮工具、单轮 `max_tokens` 默认 700、`temperature=0.7` 固定 | ✅ 工具不限；循环由规则兜底（Rakazo：6 次相同 / 25 次近似） | ✅ 同上，另有 turn checkpoint 可续 |
| C4 记忆 | ◐ 读得到、**自己不写**、到量只提示 | ✅ 随时写 `MEMORY.md`（规则要求）+ 每晚 tidy-up（目标 60 条 / 最多 +6 条） | ✅ 随时写 + revision 冲突检测 + 可选语义 provider |
| C5 自主 | ◐ 3 类日程 + todo/run 候选；主动只说一句 | ✅ Slack 3 / GitHub 21 / Linear 4 / webhook / Gmail / 日历；look-around 主动建议 | ✅ 6 类触发；可在对话里让 bot 自己建 |
| C6 协作 | ◐ 群聊 @ 路由 + 主管先回；**无职责目录、无 handoff** | ✅ `bot list` / `orchestration send` / worker / items | ✅ 同伴目录 + `message_bot` + `handoff_to_bot` + 取舍规则 |
| C7 可学习 | ✗ 4 个种子人格；无模板、无技能、无指令版本 | ✅ 6 类模板 + 13 个内置技能 + 指令随聊改 | ✅ 模板 + 技能 + 教学 playbook + 指令 diff |

**证据锚点**

| 结论 | 证据 |
|---|---|
| 单轮 700 token / 每小时 6000 | `electron/bot/index.mjs:43` |
| 记忆注入 2400 字符 | `electron/bot/index.mjs:54`、`electron/bot/index.mjs:587` |
| 工具循环 4 轮 | `electron/bot/index.mjs:820` |
| 只有 4 读 + 1 写工具 | `electron/bot/tools.mjs:12`（`BOT_READ_TOOLS` / `BOT_WRITE_TOOLS`） |
| 历史 10 条、每条截 2000 | `electron/bot/index.mjs:922` |
| 可选模型只有 2 个 | `electron/knowledge/ark.mjs:11`（`CHAT_MODEL_CATALOG`） |
| 温度硬编码 0.7 | `electron/bot/index.mjs:828`（`temperature: 0.7`） |
| 日程只有 3 类 | `electron/bot/routine.mjs:16`（`ROUTINE_KINDS`） |
| 群聊 @ 路由 / 主管先回 | `electron/main.mjs:4052`–`4110` |
| 附件 3 个 × 4000 字 | `src/components/Bot.tsx:1082`、`src/components/Bot.tsx:1122` |
| ORCA 的 SOUL/MEMORY/Tools/Rules 前导 | `third-part/orca/src/main/bots/bot-preamble.ts:14`–`140` |
| ORCA 记忆索引 200 行 | `third-part/orca/src/shared/bot-memory-lines.ts:5` |
| ORCA tidy-up 目标 60 条 / 最多新增 6 | `third-part/orca/src/main/bots/bot-memory-tidy-up.ts:29`、`:31` |
| ORCA 6 类模板 / 13 个技能 | `third-part/orca/src/shared/bots/bot-templates.ts:18`、`:29` |
| ORCA 事件源 | `third-part/orca/src/shared/automation-event-triggers.ts:14`–`41` |
| Rakazo 94 个内置工具名 | `third-part/rakazo/packages/contracts/src/bots/builtin-tools.ts:23` |
| Rakazo loop guard 6 / 25 | `third-part/rakazo/packages/adapters/src/runs/turn/tool-loop.ts:55`–`60` |
| Rakazo 记忆 32KB | `third-part/rakazo/packages/adapters/src/memory/memory-context.prompt.ts:6` |
| Rakazo 同伴目录 / 交接规则 | `third-part/rakazo/packages/core/src/bots/bot-messages.prompt.ts:36`–`49` |

### 2.1 五个「体感」场景，实现对上五条根因（实现前快照）

| 你说的话 | 它现在为什么答不好 | 根因 | 对应 |
|---|---|---|---|
| "这个文件第 20 行是什么？" | 它没有文件工具，只能让你贴 | C1 观察面 | US-B01 |
| "上次我们为什么放弃 A 方案？" | 2400 字符装不下，10 条历史之外全丢 | C2 上下文 | US-B02 |
| "记住：发票走财务目录" | 它只读记忆，自己不写 | C4 记忆 | US-B03 |
| "帮我查一下 CI 为什么红" | 没有命令 / 没有 CI 事件；4 轮也不够 | C1 + C3 | US-B01 / US-B04 |
| "给我一份完整方案" | 700 token，写到一半被截 | C3 循环 | US-B05 |
| 群里两个 bot 同时抢答 | 没有职责目录，@ 不到就按顺序兜底 | C6 协作 | US-B08 |

---

## 3. 用户故事（带判据）

| # | 用户故事（判据） | 现状 | 参照 | 优先级 |
|---|---|---|---|---|
| US-B01 | 我问工作区里的事实，它**去读**再答（判据：能回答"这个文件某行是什么 / 现在 git 改了什么 / 上次运行日志最后 20 行"；答案带 `path:line` 或命令；越界路径明确拒绝） | ✅ 2026-11-22 | ORCA 直接用 shell/git；Rakazo `read_file` / `list_files` / `shell` | P0 |
| US-B02 | 它记得住上个月的决定（判据：200 条记忆 / 30 天对话下，"上次为什么选 X"能引到具体条目；注入预算 ≥ 8KB；引用错了能看出来源） | ◐ 8KB + 相关度上浮；无语义召回 | ORCA 200 行 + topic 文件；Rakazo 32KB | P0 |
| US-B03 | 我说"记住……"，它自己写进**自己的**记忆（判据：一轮内出现在记忆面板；`owner=bot:<id>`；可编辑 / 删除；不写进别人的记忆） | ✅ 2026-11-22 | ORCA 随时写 `MEMORY.md`；Rakazo 写 + revision | P0 |
| US-B04 | 多步任务能连续查 8–12 次工具（判据："看任务 → 读文件 → 读失败日志 → 给结论"一次完成；超过上限说清楚为什么停，不静默截断） | ✅ 8 轮 / 24 次上限 | Rakazo loop guard 6/25 | P0 |
| US-B05 | 一次能说完（判据："给我 10 条验收点 / 一份 800 字方案"输出完整；长文自动进文件或折叠，不出现半句） | ✅ 默认 2048 token | 两家都由 agent / 模型上限决定 | P0 |
| US-B06 | 记忆满了它自己整理（判据：到 80% 自动合并 / 归档 / 删除；归档可查；误删可恢复；整理结果可审阅） | ◐ 80% 可一键归档（可恢复）；无自动合并 / 审阅 | ORCA 每晚 tidy-up | P1 |
| US-B07 | 我在对话里让它排日程（判据："每天 9 点给我早报"→ 生成一条待确认日程，确认后到点执行 ±1 分钟；失败 / 跳过有记录；可停可改） | ◐ 对话可提、可停/改；没有运行历史 | 两家都能在对话里建 | P1 |
| US-B08 | 群里它知道谁该答（判据：@ 精确命中；不 @ 时只有主管接；交接后能看到"从谁到谁 + 为什么"；同一条不被两个 bot 抢答） | ✅ @ 路由 + 同僚目录 + 一跳 handoff | ORCA `bot list` + orchestration；Rakazo 名册 + `message_bot` | P1 |
| US-B09 | 我能用模板教它（判据：新建时选"周报 / 发布 / 客服"模板，预置职责、工具、日程、示例；创建后模板更新不覆盖我改过的字段） | ✅ 4 个内置模板 + 选择面板 | ORCA 6 类模板 + 13 技能 | P2 |
| US-B10 | 外面的事它能被叫醒（判据：接 GitHub / 本地 CI 后，CI 失败 5 分钟内一条；同一事件不重复；没接就明说没接） | ◐ 运行失败会成候选；外部连接器未接 | ORCA 30+ 事件；Rakazo 6 类触发 | P2 |
| US-B11 | 我把它教坏了能回滚（判据：人格 / 职责 / 指令每次保存留版本；能 diff、能一键恢复；记忆删除可从归档恢复） | ✅ 历史 + diff + 恢复 + 并发冲突；记忆归档可恢复 | ORCA 记忆历史；Rakazo 指令 diff | P2 |
| US-B12 | 我知道它为什么停下来（判据：每轮一行"用了 N 轮 / 多少 token / 为什么停（轮数 / 预算 / 报错 / 循环）"，展开能看每次工具调用与耗时） | ✅ 2026-11-22 | Rakazo 停止原因 + checkpoint；ORCA 运行历史 | P1 |

---

## 4. IR（外部可观察行为）

> IR 只写"看得见什么"，不写实现。新增 UI 一律沿用现有形态（面板字段 / 行内展开 / `RowMenu`），不新造卡片体系。

| # | 规格 | 状态与失败语义 | 支撑 |
|---|---|---|---|
| IR-B01 | **证据行**：工具结果在回合里显示为一行"读了 `path:line` / 跑了 `cmd` / 查了 `query`"，点开是原始结果（截断 + "已截断"标注） | 失败显示"没读成：原因"，不吞错 | US-B01 |
| IR-B02 | **上下文条**：右栏"记忆"显示本轮注入字符 / 预算 / 条目数；≥80% 时显示"该整理了"；点开看被裁掉的条目 | 预算为 0 时说明"这一轮没有记忆" | US-B02 / B06 / B12 |
| IR-B03 | **记忆可写**：记忆面板能新增 / 编辑 / 删除 / 归档，显示来源（谁写的、哪一轮）与归属（共享 / 本 bot） | 写失败保留草稿；不弹 `window.prompt` | US-B03 |
| IR-B04 | **本轮轨迹**：已有"已汇报，用时 1 秒"展开；扩展到每次工具调用带 `参数 / 结果 / 耗时 / 是否被拒` | 被拒的工具显示"不在工具表里"而不是空白 | US-B01 / B04 |
| IR-B05 | **长回答形态**：超过 N 字（建议 1200）折成"展开全文"或落成会话附件；不新增第三套卡片 | 超模型上限时明确"被截断，可继续" | US-B05 |
| IR-B06 | **日程**：对话里出现一张"建议日程"卡（名称 / 触发 / 下次 / 启用）；面板沿用现有自动化表格，加"运行历史"与"上次失败原因" | 未确认不创建；创建后立刻出现在列表 | US-B07 / B10 |
| IR-B07 | **群聊路由**：`@` 补全列表显示"名字 · 一句话职责 · 在线状态"；交接产生一条系统行"PM 把「查部署结论」交给 知识 bot" | 找不到人时提示可选成员，不静默丢 | US-B08 |
| IR-B08 | **模板**：新建 bot 面板列出模板，预览职责 / 工具 / 日程 / 示例，确认才创建 | 同名模板重复创建 = 打开已有的 | US-B09 |
| IR-B09 | **历史与回滚**：右栏"历史"看人格 / 职责 / 记忆的版本，diff + 恢复；记忆显示归档 | 恢复 = 生成新版本，不覆盖审计 | US-B06 / B11 |
| IR-B10 | **为什么停**：每轮页脚一行"N 轮 · X token · 停因"；展开看工具序列与耗时 | 停因枚举：轮数 / 预算 / 循环 / 超时 / 报错 / 取消 | US-B12 |

---

## 5. SR（系统规格）

> 落点都在 `electron/bot/*`、`electron/memory/*`、`electron/knowledge/*`、`src/components/Bot.tsx`。**不新增第二套调度器**，不绕过审批。

### 5.1 P0：先让它"看得见、想得长"

| # | 规格 | 判据 / 失败语义 |
|---|---|---|
| SR-B01 | **工具注册表**：每个工具声明 `name / 读写 / 风险 / 超时 / 结果上限 / 是否需要审批`；按 `capability` 生成工具集；未注册的工具回 tool 错误（现有行为保留） | 加一个工具不改主流程；拒绝有可读原因 |
| SR-B02 | **只读工作区工具**：`fs_list / fs_read / fs_grep`（路径 jail 到当前项目 / worktree）、`git_status / git_log / git_diff`、`run_log`（读 run 的 messages / 终端尾部）；单次结果 ≤ 8KB，超出截断并标注 | 越界路径 / 二进制 / 超大文件明确拒绝；不落盘副作用 |
| SR-B03 | **循环与预算**：`maxRounds` 默认 8、硬上限 16；每轮独立 `maxTokens` 默认 2048；同一工具同参连续 3 次 → 停并说明；超预算返回"预算用完"而不是空串 | 停因写进 `bot_turns.reason`；可重试 |
| SR-B04 | **上下文编译器**：`compileContext(bot, turn)` 产出固定顺序分区（人格 → 规则 → 记忆 → 技能 → 历史 → 本轮文件/工具），每区有预算与裁剪顺序，记录实际注入清单 | 同一轮同样输入产出可复现；被裁条目可解释 |
| SR-B05 | **历史压缩**：thread 超过 24 条时生成摘要（存 `threads.summary`，标 `derived`），保留最近 10 条原文；摘要不参与"事实"引用 | 摘要失败退回原文；不丢最近 10 条 |
| SR-B14 | **模型与思考档**：`bot.thinking`（off / low / high）+ 分场景温度（工具轮 0.2、闲聊 0.7）；模型目录不写死 2 个 | 不支持的网关自动退回；温度不合法回默认 |
| SR-B15 | **观测**：`bot_turns` 记录 `context{chars, sections, dropped}`、`tools{name, ms, ok}`、`stopReason`；UI 只读这份记录 | 老回合缺字段时显示"未记录"，不报错 |

### 5.2 P0/P1：记忆闭环

| # | 规格 | 判据 / 失败语义 |
|---|---|---|
| SR-B06 | **记忆写入工具**：`memory_write` / `memory_forget`，只写 `owner=bot:<id>`；写入走 `noteAdd`（待确认），**不能**直接写 L4；写前过敏感过滤 | 越权写共享层直接拒绝；敏感内容不入库 |
| SR-B07 | **记忆整理**：纯函数 `planTidy(memory, budget)` + 后台任务；到 80% 触发，产出"合并 / 归档 / 删除"三张 diff，人可审阅；归档保留原文 | 整理可回滚；失败不改原数据 |
| SR-B08 | **记忆检索**：`inject({ query, owner })` 先按本轮 query 召回再按分数补足；有 embedding 时 hybrid，无则 bigram FTS 兜底 | 检索为空时退回分层抽样；记录命中来源 |
| SR-B13 | **版本与回滚**：`bot_revisions` / `note_revisions` 存 `{ at, by, data }`；恢复 = 新 revision，不删旧记录 | 任意 revision 可恢复；diff 视图与 `expectedRevision` 冲突待做 |

### 5.3 P1/P2：自主与协作

| # | 规格 | 判据 / 失败语义 |
|---|---|---|
| SR-B09 | **日程**：`daily / every / once / watch` 四类（`once` 解决"提醒我 20 分钟后"）；routine 带 prompt 参数；bot 创建需人确认 | 到点 ±60s；跳过一次记 `skipped` + 原因（运行历史待做） |
| SR-B10 | **事件总线**：本地事件（`run.finished / waiting_input / todo.changed / memory.due`）统一成 `events`；外部连接器只做**插件式事件源**，复用现有 routine 调度 | 同一 `(botId, event.ref)` 去重；连接器断线不假装处理 |
| SR-B11 | **群聊路由与 handoff**：bot 带 `purpose`（一句话职责）；`@` 解析用 id；非 @ 只给 lead；`handoff` = 群系统消息 + `turns.handoff={from,to,reason}`；目标 bot 回复回到该群 | 交接失败可见；不出现双答 |
| SR-B12 | **模板包**：`bot_templates(id, category, persona, duty, tools, routines, example)`；创建时**深拷贝**，之后模板更新不跟随 | 重复创建同模板 = 打开已有 bot |
| SR-B16 | **失败语义**：工具超时、429、超预算、循环、取消五类分别落 `reason` 并可重试；取消保留半截（现有 `interrupted` 语义不变） | 不出现"空了但没原因"的回合 |

---

## 6. 追溯矩阵

| US | IR | SR |
|---|---|---|
| US-B01 工作区可见 | IR-B01 / IR-B04 | SR-B01 / SR-B02 |
| US-B02 记忆够用 | IR-B02 | SR-B04 / SR-B05 / SR-B08 |
| US-B03 自己会记 | IR-B03 | SR-B06 / SR-B13 |
| US-B04 多步不截断 | IR-B04 / IR-B10 | SR-B03 / SR-B15 |
| US-B05 一次说完 | IR-B05 | SR-B03 / SR-B14 |
| US-B06 记忆自整理 | IR-B02 / IR-B09 | SR-B07 / SR-B13 |
| US-B07 对话内日程 | IR-B06 | SR-B09 |
| US-B08 群里分工 | IR-B07 | SR-B11 |
| US-B09 模板可教 | IR-B08 | SR-B12 |
| US-B10 事件驱动 | IR-B06 | SR-B10 |
| US-B11 可回滚 | IR-B09 | SR-B13 |
| US-B12 为什么停 | IR-B10 / IR-B02 | SR-B15 / SR-B16 |

---

## 7. 分期与验收

| 期 | 内容 | 解锁的体感 | 验收 |
|---|---|---|---|
| **M1 看得见** | SR-B01 / B02 / B03 / B14 / B15 | "它能读文件、看 git、读失败日志；一次能查 8 步；回答不再半句" | 10 个真实问题里 ≥8 个不需要你贴材料；超 4 轮的请求成功率从 0 到 ≥60%；长回答截断投诉 0 |
| **M2 记得住** | SR-B04 / B05 / B06 / B08 | "我不用重复背景，它自己会记" | 200 条记忆 / 30 天下，"上次为什么"答对 ≥70%；说"记住"后一轮内可查；注入不超预算 |
| **M3 会自己动** | SR-B09 / B10 / B11 | "到点它来找我；群里它知道该谁答" | 日程 ±1 分钟；同一事件不重复；群里双答 0；handoff 100% 可追 |
| **M4 可教可回滚** | SR-B07 / B12 / B13 / B16 | "换个人也能把它调成周报 bot；教坏了能退回去" | 模板创建 ≤2 分钟；每次保存可 diff；任意停因可解释 |

**建议顺序**：M1 的 SR-B03（轮数 / token / 温度）是一个下午的量，但体感提升最大，先做；SR-B02 紧随其后（真正的"看见"）。M2 的记忆写入与 M1 可以并行（互不依赖）。

### 7.1 实现侧自评（2026-11-22，不是验收）

> 这一节是**实现者自己的进度快照**，只用来回答「改到哪了」。它是自评，会偏；
> 真实验收（能不能在真仓库上读出 `path:line`、记忆写完下一轮记不记得）见
> [`VERIFY-bot-intelligence.md`](VERIFY-bot-intelligence.md)。结构检查（`npm test -- bot` 91 项 /
> `npm test -- db` 9/9 / `typecheck` / `build` / `verify:design`）只能证明管道通了，不能证明水通。

| SR | 状态 | 落点与判据 |
|---|---|---|
| SR-B01 工具注册表 | ✅ | `electron/bot/tools.mjs` 的 `BOT_TOOL_META`（风险 / 超时 / 结果上限）；`botReadTool` 统一超时；未注册工具回 tool 错误 |
| SR-B02 只读工作区 | ✅ | `electron/bot/workspace.mjs`：`workspace_list/read/grep` + `git_status/log/diff` + `run_log`；路径 jail（含 realpath）、拒绝 `.env`/密钥/二进制/超大文件；搜索跳过依赖目录 |
| SR-B03 循环与预算 | ✅ | 默认 8 轮（硬上限 16）、单轮 2048、工具轮温度 0.3；同参 3 次 / 总调用 24 次强制停 |
| SR-B04 上下文编译器 | ✅ | `compileContext()` 分区（人格 / 同僚 / 记忆 / 规则）并回报 `sectionChars`；记忆预算 8000 |
| SR-B05 历史压缩 | ✅ | `historyDigest()`：>24 条时把最近 10 条之外压成 `threads.digest`（纯函数，不额外调模型） |
| SR-B06 记忆写入 | ✅ | `memory_write` / `memory_forget`，只写 `owner=bot:<id>`，走 `noteAdd`（不直写 L4）；密钥拒写 |
| SR-B07 记忆整理 | ◐ | `planTidy()`：到 80% 按分数最低 / 最久未更新给候选（置顶与 note 不动），一键归档到 60%，记忆页可恢复；**没有自动整理 / 合并 / diff 审阅** |
| SR-B08 记忆检索 | ✅ | `memory.inject({ query })` 按本轮问题上浮，台账 reason 标「命中本轮问题」；语义 provider 仍未接 |
| SR-B09 日程 | ◐ | 新增 `once`（绝对时间一次）+ `prompt`（到点做什么）；对话里可提草稿（`routine_propose` → 卡片「建日程」），到点 ±60s；**运行历史 / skipped 记录未做** |
| SR-B10 事件总线 | ◐ | 本地 `run.failed` 已成候选（2 小时内、同任务不重复）；**外部连接器（GitHub / CI / 邮件）未接** |
| SR-B11 群聊路由与 handoff | ✅ | `handoff_to_bot`（只在群聊）→ 群系统行「A → B：任务」→ 只跟一跳唤醒目标（已在队列里的不重复）；`bot_turns.handoff` 落库；跨群/私聊未做 |
| SR-B12 模板包 | ✅ | 4 个内置模板（早报 / 发布守护 / 答疑 / 运行观察）+ 新建面板；深拷贝人格 / 职责 / 能力，预置日程默认停用 |
| SR-B13 版本与回滚 | ✅ | `bot_revisions` + 字段 diff + 并发 `expectedUpdatedAt` + 一键恢复；记忆归档可恢复。记忆条目 diff 视图未做 |
| SR-B14 模型与思考档 | ◐ | 思考档 quick / 标准 / deep（4 / 8 / 12 轮，工具轮温度 0.4 / 0.3 / 0.2）；模型目录仍 2 个；网关 `thinking` 未接 |
| SR-B15 观测 | ✅ | `bot_turns.stop_reason` / `context` 落库；UI 显示上下文字符、轮数、停止原因 |
| SR-B16 失败语义 | ◐ | 轮数 / 循环 / 超时 / 网关无 tools 都有停因；重试仍只覆盖已回复的回合 |

**旧数据升级**：`ensureSeed()` 把仍是 700 token / 6000 的旧 bot 一次性迁到 2048 / 12000（加了 `budget.brain2` 标记，不重复迁；手动调过的不碰）。

**还没补的 P0**：没有。剩下的按体感排序：IR-B03 记忆归属可见、SR-B02 观察面跟 worktree、IR-B10 停因进页脚、
外部事件源（SR-B10）；其余是增强项（语义召回、记忆条目 diff、跨群 handoff）。**下一轮验收清单见**
[`VERIFY-bot-intelligence.md`](VERIFY-bot-intelligence.md) §2。

---

## 8. 不做与红线

| 不做 | 理由 |
|---|---|
| **自由 shell / 任意命令** | 与"写操作必须人确认"冲突；只读工具 + 通过 run 执行，写仍走审批（[`../arch/ARCH-bot.md`](../arch/ARCH-bot.md) §3.3） |
| **第二套调度器** | ORCA 的 automations / Rakazo 的 routines 都长在各自 runtime 上；我们用现有 routine + 事件总线扩，不新建 cron 服务 |
| **抄 94 个工具的数量** | 工具越多越难选对；先补 8–12 个高频只读工具，按"它答不好哪类问题"增 |
| **沙箱桌面 / 多租户服务端** | 见 [`COMPARE-rakazo.md`](COMPARE-rakazo.md) §16；与自托管单机冲突 |
| **向量库变必需依赖** | 现有 bigram FTS + 可选 embedding 已够；语义召回作为增强，不是前置 |
| **绕过审批的自主行动** | 这是核心不变量（验收是人的动作）；M3 的事件只能"提议 / 汇报"，不能自批 |

**为什么这次不先换模型**：单轮默认 700 token + 4 轮 + 无文件，换 GPT-5 级模型也只能把"不知道"说得更漂亮。先把 C1–C3 补齐，模型升级才有边际收益。

---

## 9. 未验证 / unknown

| 项 | 状态 |
|---|---|
| ORCA bot 的模型与思考档由 agent CLI 决定到什么粒度（是否 per-bot 可覆盖） | 未逐项验证；只确认 bot 有 `agent` 字段并跑该 CLI |
| ORCA `bot items` 的完整状态机与 worker 回流细节 | 只读了 preamble 的规则文案，未读状态机 |
| Rakazo 长对话摘要的触发阈值与保真度 | 文档提到"摘要留在我方"，源码未追 |
| 我们能否把 dsh / ACP 会话复用为 bot 的只读工具执行器 | 未验证；若可行，SR-B02 可少写一套文件/git 封装 |
| 700 → 2048 后火山 plan 网关的实际吞吐与成本 | 未压测；上线前要按 `tokensPerHour` 重算配额 |

---

## 10. 一句话总账（实现前的诊断）

```text
它们：真实动作面 → 结果进上下文 → 记忆沉淀 → 下次带着记忆再来。
我们：人格 → 事件闸门 → 5 个只读工具 → 审计账。
缺口不在"会不会说话"，在"有没有东西可想"。

最便宜的三刀：单轮默认 700 → 2048、4 轮 → 8 轮 + 循环保护、温度按场景。
最值钱的一刀：只读工作区工具（文件 / git / 运行日志）——它把"我不知道"变成"我去看"。
最容易被忽略的一刀：记忆自己写 + 自己整理——否则 8KB 也只是更大的垃圾场。
```
