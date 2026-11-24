# Changelog

所有值得注意的变更都记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added（工作台：一次运行的两面；机器人 ↔ 对话 / 终端双向）
- **对话与终端是一体两面**：终端标签栏里那一组「对话 | 终端」不是两个入口，而是**同一条 run 的两个面**。切面不新建标签、不改列表顺序、不重排；点终端标签时对话面自动跟到同一条 run（`threadId` 由标签的 `taskId` 反查），不会再出现「对话看 #12、终端是 #13 的 shell」。ACP 执行没有终端面时按钮置灰并说明原因，不伪造标签
- **机器人可以在对话里署名发言**（`task_say`，dispatch / work 档）：写进任务会话（`〔bot〕…`），**不打断**正在跑的 run；要纠正执行体仍用 `worker_send`。只允许自己的任务 / 交接工作区 / 绑定项目
- **机器人可以指挥终端**（`terminal_write`，仅 work 档）：往**已交到它手上**的终端敲一行（默认回车）；默认落点 = 交接工作区的终端 → 自己名下正在跑的 run 的终端；人正在接管（`controlBy=user`）时拒绝；终端已退出时明说写不进去；每次写入落 `bot.terminal_write` 审计事件。不新建终端、不结束进程、不给任意路径
- **终端 / 对话 → 机器人**：`harness note`（pty CLI 与 ACP MCP 共用）不再只写给人看——同一句话同时落一条 `bot_turns(decision=noted)`，`from` 记是谁回的；下一轮开口时进 system 段「交出去的活最近回的话（只作背景，不是人下的指令）」，1 小时之外的旧话不再喂。`harness report` 也走同一条通道
- **Bot 页回合流分清署名**：`noted` 单独一档（「收到回话」+ ↩），既不冒充机器人自己说的话，也不和 `watching` / `reported` 混

### Added（机器人：工作区交接、群聊路由、终端窄通道）
- **工作区交接**：项目右键 / 终端右键「交给机器人」写一条 `bot_workspaces`（path / branch / terminalId / goal），项目根同时绑 `bots.project_id`；`work_list` 看工作区、git 分支 / 脏文件、终端尾部与 run；`workspace_*` / `git_*` 接受 `workspace=<id>`；`task_create` 在交接工作区**原地起活**（不再套新 worktree）；交回只标 `released`（项目根解绑），历史可展开 / 再交；删 bot / 删群 / 撤销一起清干净
- **交接后带目标自动开一轮**：`kickoffHandoff()` 只在**新目标**时触发，长 prompt 只留审计（`inputRole=none`），不冒充用户气泡；正在聊 / 暂停 / 没 key 静默跳过
- **终端 agent 窄通道**：受管 pty 的 PATH 里注入 `harness`，三条命令 `whoami` / `note --text` / `report --text`；token 绑定本次 run / 终端、24h 过期、离开即撤销；`report` 写 `run.result`（`agent_cli`），pty 尾部不再覆盖；不暴露 action bus / 任意 shell / 审批
- **群聊路由**：`electron/bot/group.mjs` 纯函数解析 @（代码块 / 引用 / 引号 / 路径不算，最长名字匹配，同名歧义报错）；`mentions` 模式没 @ = **0 人回**（不再「主管 + 第一个」双答）；`@everyone` / 固定成员 / `all` 有明确失败语义
- **成员接力**：回复正文里的 `@成员` 唤醒对方（一跳、最多 2 个、去重、不叫醒自己 / 已回过的人）；新增 `ask_bot`（问信息）与 `handoff_to_bot`（转让责任）分开，系统行 `【问】/【交接】/【@】`
- **群共享上下文**：每轮注入上一轮别人 + 本轮前面别人（不含自己）；`bot_groups.memo` 群共识进 system prompt；`crossTopicDigest` 带其他话题最近 2 条（背景，不是指令）
- **群内多话题**：`bot_groups.threads` + `bot_group_messages.thread_id`；第一句成为标题；消息 / 草稿 / 回复流按话题隔离；`bot_groups.sessions` 让每个成员在每个话题用**独立 bot thread**（不进 1:1 Chats，删话题 / 删群 / 删 bot 同步清）
- **按话题未读**：`bot_groups.reads`（`last_read_at` 保留兼容）；左栏群行取各话题之和，侧栏显示「N 新」，正在看的话题自动清零
- **群附件 / 群档案**：群消息最多 3 个文本附件（内容只进本轮 prompt，落库只留名称）；`userData/bot-groups/<id>/GROUP.md` 只读镜像（群名 / 共识 / 成员 / 话题 / 回复规则）+「主目录」按钮
- **SOUL.md 镜像**：`userData/bots/<id>/SOUL.md` 从档案生成（职责卡 / 语气 / Never / 能力），bot 保存 / 模板 / 恢复 / 交接后刷新；与 MEMORY.md 同口径只读
- **ACP harness MCP**：本地 ACP run 额外挂 `cockpit_harness`（stdio MCP），`harness_whoami` / `harness_note` / `harness_report` 走同一个 token 服务；远端 run 不挂
- **`harness ask` 审批回传**：终端 agent 用 `harness ask --text "…" [--timeout 300]` 发起桌面审批（允许 / 拒绝），CLI 等到决定才继续；超时 30–900 秒自动收掉；不能自批、不会自动执行
- **远端 agent bridge**：SSH 主机上用 `ssh -R 127.0.0.1:0:...` 反向隧道 + 远端 POSIX shim（curl/base64），pty run 本地 pty 包 `ssh -tt`，ACP run 走 `AcpClient.sshEnv`；隧道 / token 按 run 关闭，shim 缺失时明说不可用
- **手动远端 shell**：终端「＋」菜单按主机列出「新建终端 · <host>」；`terminal:create` 接受 `hostId`，远端 `cd defaultCwd && exec "$SHELL" -l`；`terminals.host_id` + Pane 落盘恢复，重启仍回同一台
- **远端 harness MCP**：远端有 node 时，把 `harness-mcp.mjs` 装到 `$HOME/.cockpit-harness/bin` 并以 MCP 挂给远端 ACP；没有 node 就退回 CLI shim
- **群内同事消息（peer mail）**：`ask_bot` / `handoff_to_bot` 先落 `bot_peer_mail` pending；对方下一次在同一话题开口时带进 prompt，答完销账（`answered` + `answerTurnId`）；Bot 页「工作」能看到等它下一轮的消息；删 bot 一起清
- **其他**：`harness report` 之后 pty 尾部不覆盖结论；`ask_bot` / `work_list` 进工具表；删除 / 撤销 / 清种子覆盖新增的 workspaces / 群话题草稿 / peer mail

### Security（依赖：把两个 high 清掉，`npm audit` 归零）
- **`xlsx` 换成 0.20.3 构建**：npm 上的 `xlsx@0.18.5` 停在两年前，原型污染 / ReDoS 两个 advisory 一直没有修复版（官方修复只发在 SheetJS CDN，本机访问不到）；改用 npm 上的同版本重发布 `@e965/xlsx@0.20.3`，通过 npm alias 仍以 `xlsx` 引入，调用方零改动
- **0.20 的 ESM 构建不再自带 `fs`**：`doc-preview` 与 `knowledge/parse` 的 xlsx 读取改成「读 buffer + `XLSX.read(buf,{type:'buffer'})`」，不再依赖 `readFile`；用例里的造数据也改成写 buffer
- **`adm-zip` 统一到 0.6.1**：`epub2@3` 自己锁的 `adm-zip@0.5.18` 有 8 条 advisory（内存放大 / 解压软链覆盖 / SUID 位 / 重名条目…），加 `overrides` 强制走 0.6.1；EPUB 解析实测正常
- 结果：`npm audit --registry=https://registry.npmjs.org` → **0 vulnerabilities**（此前 3 high）

### Changed（场景：不再绑项目，舞台上的一行 chrome 收干净）
- **场景是全局列表**：不再按当前项目过滤；`project_id` 只作「建议项目」，卡片显示来源、没标注显示「全局」。舞台取运行态也按场景的建议项目，不再跟着当前项目漂
- **阵容按机器人存**：渲染层写 `botId`，主进程 `normalizeCoordinationCast` 两种都认（老数据按执行体反查成机器人）——以前只认 `agentId` 会把 UI 保存的阵容整份丢掉，场景永远存不下阵容
- **空项目给空态**：不再「没有场景就自动建一个办公室场景」；场景库/实况共用一个空态，空项目进入落在场景库；场景可以删到零
- **舞台头排版修好**：标记名是 `div.section-title` 却只给 `h2` 写样式，标题按 18px 折成三行压在副标题上；现在按实际元素给 13px / nowrap，副标题可收缩省略，统计与工具不再被挤爆，≤1040px 自动折行
- **一行 chrome 收敛**：演一遍弹射 / 着舰、走位路径、模拟 reduced-motion 收进一个 `⋯`；删掉 `CARRIER · THREE.JS` 角标、重复的映射说明与实现说明、页头重复的动效读数
- **时间轴空态**：0 次状态变化时只留一行（不再摆空轨道 + 空详情 + 三个禁用按钮），有变化才出轨道与回放

### Changed（机器人：新建入口合并，建群改弹层）
- **一个「新建」**：侧栏底部只有一个虚线「＋ 新建」，悬停（或点击）展开「新建机器人 / 新建群聊」；列表里那条独立的「新建群聊」删掉
- **建群是弹层**：群名 + 成员多选行（头像 / 全名 / 能力，选中高亮 + 勾选）、已选 n/m、全选 / 清空、空选禁用「建群」、Enter 建群 / Esc 关闭；不再把表单塞进侧栏行里挤成一列
- **`RowMenu` 扩了三个可选参数**：`trigger`（自定义触发器）、`openOnHover`（悬停展开、移出延迟收、移进弹层不收）、`align`；其余调用零影响

### Changed（易用性这一批：删得干净、找得到、说得清）
- **删机器人删干净 + 撤销**：一次清掉回合 / 会话 / 消息 / 日程 / 历史 / 事件 / 草稿 / 群成员（只剩它的群一起删）；6 秒内可撤销
- **会话可清空**：默认会话也能清（消息与回合一起清、会话留着）；删除会话仍有确认
- **任务可取消 / 删除 / 派给机器人**：任务行 `⋯` 新增三项；取消保留历史并停 run，删除可撤销；任务详情显示归属机器人
- **群聊可管理**：建群自己起名选成员；群侧栏改名 / 拉人 / 踢人 / 删群；`@` 列表带职责与状态；`@everyone` 先确认
- **工具清单不再手写**：`BOT_TOOL_CATALOG` 由主进程下发，Bot 页与流式提示共用
- **执行体 / 项目 / 主机不匹配会有警示**；**daily 日程建在当天点之后不补跑**（从明天开始）
- **原生 `window.confirm` 全站下线**：统一走应用内 `ConfirmHost`（危险动作用 danger 样式，Esc / 遮罩取消）
- **机器人页批量操作 + 下次开口**：`⋯` 里全部暂停 / 恢复 / 静音；卡片显示「下次 09:00 早报」
- **i18n 继续**：机器人库与 Bot 控制台 chrome 接入 `t()`；新增 `npm run i18n:report` 作为翻译进度表（只报告不拦）

### Changed（机器人能力增强：能派活、能改任务、能看同事）
- **机器人之间派活**：`task_create` 新增 `bot` 参数——用目标 bot 绑定的执行体、`todos.bot_id` 归它；目标 bot 与派活人各挂一条 `watching`，run 结束两边都会收到一条回报（PM 派给 SE/DE，不用你手动转发）
- **能管任务**：`todo_update` 改未确认任务的状态（todo / in_progress / waiting_input / in_review）/ 负责人（执行体或机器人）/ 优先级 / 验收口径，并能在任务会话里留一句备注；**`done` / `cancelled` / `confirmed` 不在工具里**，仍是人的动作
- **能看同事**：`todo_get`（背景 + 验收 + 最近运行）、`bot_list`（名字 / 职责 / 档位 / 执行体 / 在手任务数，`busy_only` 过滤）——分派前先看谁合适、谁忙；只读档也下发这两个
- 机器人引用统一走 `matchBotRef()`（id / 全名 / `SE · 系统架构` → `se`），派活与改派不会因为叫法不一致找不到人
- 用例：工具表 / 分档 / `matchBotRef` 匹配 / `task_create` 必填项（agent 与 bot 二选一）

### Changed（下线内置演示机器人）
- **不再预置 小Z / 小A / 小B / 小C**：新装直接进「还没有机器人」空态，机器人全靠新建或模板（`electron/bot/index.mjs` 删掉 `seedBots()`）
- **老库一次性清掉这四个种子 bot**：`ensureSeed()` 用固定 id 匹配（`LEGACY_SEED_BOT_IDS`），连同回合 / 日程 / 改动历史 / 会话 / 群成员 / 已读事件一起删；人自己建的 bot 一律不动
- **空白 bot 建出来就带 `intro`**：第一轮先问「你想让我干什么」，答案落成 `persona.mission`；从模板建的已有职责，不再问一遍
- 用例改成自己建 bot（`tests/bot/_harness.mjs` 的 `makeBot()`），不再依赖种子

### Fixed（preload 单一来源 + 忽略软链的 node_modules）
- **删掉 `electron/preload.mjs`**：`main.mjs` 的 `webPreferences.preload` 指的是 `preload.cjs`，`preload.mjs` 是没人加载的 20 行残留副本。P0-4 把 `onBotPatch` 加在了那份死文件里，`App.tsx` 一订阅就抛 `TypeError: window.harness.onBotPatch is not a function`，渲染树整棵挂掉、首屏全白。现在 preload 只剩 `electron/preload.cjs` 一个来源
- **`.gitignore` 的 `node_modules/` 改成 `node_modules`**：带斜杠只匹配目录，worktree 里软链的 `node_modules` 不匹配、会被 `git add -A` 收进提交（本次合并时踩到过）

### Fixed（空态字号：只修漏掉的那一处，不改 Chat 自己的字号）
- **回滚窄 Chat 的字号下调整块**：终端页左栏里的 Chat 恢复到照搬 DeepSeek 的 14/24、空态标题 20px；窄了就收内容列与间距，不另开一套字号（`@container` 下调整块已删除）
- **只保留一处真实 bug 修复**：`.chat-pane .chat-scroll > .chat-empty b` → `> b`（`p` 同理）。之前 20px 的空态标题字号漏到了建议卡片的 `b` 上，所以「实现功能 / 审查改动」比卡片说明大一圈；修正后建议卡回到 12.5 / 11

### Changed（终端页再收一轮：一行 chrome、左栏更宽、右栏默认收起）
- **任务头两行 → 一行**：状态筛选从 5 个 chip 收成 `全部 ▾` 下拉，和搜索 / 范围 chip 同一行；列表 / 看板进 `⋯`（`row-menu-label` + select），任务头现在只有 28px
- **左栏默认 360**（可拖 240–560，存储键 `cmh.layout.todoW.v2`）：Chat 的 composer 在 360 下不再被挤成三行
- **右栏（文件 / 会话 / Git）默认收起**：默认 `collapsed.files = true`（键 `cmh.layout.collapsed.v2`），终端主面吃满剩余宽度（实测 1120px）；需要时点右侧「文件」窄条展开
- **Chat 头只剩 `Chat ⋯ ⤢ ⌃`**：「历史」「进展」收进 `⋯`——菜单里是「历史会话」列表（带条数，当前会话高亮）和「全局进展 N」开关；删掉旧的行内 popover（`.chat-history*`）样式

### Changed（终端页降密度：只留动作，其余进 ⋯ / 空态）
- **任务行快捷操作 7 → 2**：行内只保留当前状态的那一个主动作（派活 / 确认 / 停止 / 撤销确认）+ `⋯`；详情 / 编辑 / 问清楚 / 多 Agent 并行 / 重试 / 续跑 全部进 `RowMenu`（Mission 行同理）
- **Chat 头只留一格动作**：删掉「＋ 新任务」和重复的状态 pill（状态在下面 thread bar 已经是唯一一份），头行变成 `Chat · 历史 · 进展 · ⤢ · ⌃`；空会话时入口放到空态里（一行提示 + 一个「新建会话」）
- **composer 从 3 行回到 2 行**：「发送前预览分派」「工具与思考」收进 `⋯`（窄面板下不再挤出第三行），行内只留 Agent / 项目 / 模型 / 只聊 / 发送
- **runbar 只剩事实**：`run id · #任务 · 状态 · 用时`；「同一份状态：TODO 行 / Chat / 会话 / 终端标签」四个跳转 chip 和 `.rb-chip` 样式一起下线（三块已经同屏可见，不需要跳转）
- **项目列表不再写 0**：只有 `>0` 才渲染计数，13 个项目时不再一排 0 噪声


### Changed（聊天窗口 M5：重试这一轮）
- **助手消息可重试**：新增 `botRetry({ turnId })` —— 复用那一轮的原话与所在会话重跑一轮，原轮不改写，用 `trigger.kind = "retry" | ref = 原轮 id` 指回（不加列）；消息动作行第 4 个常驻图标是「重试这一轮」（复制 / 引用 / 分支 / 重试，仍 ≤4）（REQ-bot-chat SR-Chat-05）
- `preview-bot.mjs` 增 2 条断言：图标在 / 点了带 turnId 调 `botRetry`

### Changed（聊天窗口 M4：阅读位置）
- **切走再回来接着读**：滚动停 500ms 采样一次 `{ turnId, offset }`，落进 `bot_ui.scroll`（单行写、贴底时不算）；重进同一 bot / 会话时把那一轮放回同一视口位置，找不到就落到最新（REQ-bot-chat SR-Chat-04）
- `preview-bot.mjs` 增 2 条断言：滚动 500ms 落盘 turnId+offset / 切回来那一轮在 ±120px 内回到原位

### Changed（聊天窗口 M3：草稿 / 首字延迟 / Esc 停止）
- **草稿不再随会话消失**：新增 `bot_ui` 表（`k / draft / scroll / updated_at` + `saveBotUi` 单行写），渲染层输入 500ms 节流落盘，切 bot / 切会话自动取回（REQ-bot-chat SR-Chat-03）
- **首字延迟可见**：`bots().reply()` 把 `res.ttft` 落进 `cost.ttftMs`，消息用量行显示「· 首字 0.8s」（SR-Chat-07）
- **Esc 停止**：聊天面按 Esc = 停止当前生成（1:1 与群聊都按在场成员逐个 abort）；发送后焦点回输入框（SR-Chat-14 剩余项）
- `botSnapshot` 带上 `botUi`，少一次 IPC；`tests/bot/reply.test.mjs` 增 1 条 ttft 用例，`preview-bot.mjs` 增 2 条草稿断言

### Fixed（聊天窗口 M2：跟随阈值 / 新消息提示 / 可访问性）
- **跟随不再抢位置**：阈值 48px → **24px**，退出跟随由读者手势决定（滚轮上滚 / `touchstart` / PgUp·↑·Home），程序滚动不改变意图（REQ-bot-chat IR-Chat-11）
- **「N 条新消息 ↓」**：不在贴底时新内容按块累积，右下角浮起 chip（sticky，28px），点了直接落底并恢复跟随（IR-Chat-05）
- **转录语义**：`.bot-stream` = `role="log"` + `aria-live="polite"` + `aria-relevant` + 可读 `aria-label`；1:1 回合与群聊每条消息都是 `role="article"` + 「谁 · 时间」；composer `textarea` 补 `aria-label`（SR-Chat-14 主体）
- `preview-bot.mjs` 新增 5 条断言：chip 出现 / 点它回底并收起 / role=log / 每轮 article / 输入框 label

### Fixed（聊天窗口 M1：输入法 / 中断留痕 / 长会话按页加载）
- **中文输入法不再误发**：composer 用 `compositionstart/end` + `isComposing` + `keyCode 229` 三重判断，候选态回车只上屏；结合 `enterToSend`，Shift+Enter 仍是换行（REQ-bot-chat SR-Chat-10）
- **中断留痕**：`bots().reply()` 被 abort 时不再删回合，而是落成 `decision: "interrupted"` 并保留已生成前缀（≤4000 字），聊天里显示「被打断」+ 半截；非取消的报错仍然不落账（SR-Chat-08）
- **长会话按页加载**：转录一次只渲染最近 40 个块（1:1 与群聊同一套），顶上给「加载更早的 N 个回合」，加载时用 `scrollHeight` 差值保持阅读位置；200 轮实测 DOM 从「全量上万」降到 1461 节点、翻页后 2921（SR-Chat-02 前端部分）
- `preview-bot.mjs` 新增 6 条断言：输入法候选态不发送 / 上屏后才发送 / 200 轮只渲染 40 块 / DOM ≤3000 / 有「加载更早」/ 点了多一页；`tests/bot/reply.test.mjs` 的取消用例改为断言「留 interrupted + 半截」，并补一条「非取消报错不落账」

### Changed（终端页：Chat 回到左栏，任务列表在它下面）
- **Chat 重新挂回终端页**：`App.tsx` 左栏换成 `.left-stack`，上段是 `TaskChat`（派活 / 纠偏 / 历史 / 进展），下段是原来的 TODO·项目面板；中间一条横向分隔条调高度（默认 320px，范围 140–900，存 `localStorage.cmh.layout.chatH`）
- **开合 / 最大化照旧**：Chat 可收起成 34px 横条，可最大化铺满工作区（Esc 还原）；任务面板收起时 Chat 自动吃掉整列
- **入口对齐**：`harness:focus-chat`（问清楚 / 插件草稿）和「打开会话」（BOT 页、右栏会话历史、命令行面板）都会展开 Chat 再落到那条 thread；点任务行只切 thread，**不**改展开态、不重排（AGENTS §2.3 第 19 条）
- TerminalPanel 的拾取元素上下文重新接回 Chat（`pendingContext`），runbar 新增「Chat」chip 直跳左栏；删掉从未挂载过的 `.term-dock` 样式

### Fixed（群聊：发出去看不到实时响应）
- **`botGroupSend` 补流式**：之前调 `bots().reply(bot, value, {})`，既没 `onDelta` 也没 `signal` —— UI 要等全部成员都跑完才 `load()`，所以群里发一句后界面一片空白。现在每个成员都带 `onDelta` / `onTool`（payload 加 `groupId` + `name`），并按 botId 分块推到前端
- **自己的话立刻出现**：owner 那句先 `persist + broadcast`；前端再用乐观气泡（`ds-pending`）兑，回声到了就收，不会重复
- **逐字流式 + 可停止**：每个成员一个 `AbortController`，`停止` 只掉正在说的那一个；被停的那条落成 `interrupted`（「已停止这次回复」），不再报成「没回」
- **没有任何成员开口前**显示一行「等成员回…」；群聊空态从「跑一次决策」改成「@名字 / @everyone / 谁回」的真实提示（之前群聊会错用 1:1 的空态）
- `scripts/preview-bot.mjs` 新增 7 项群聊断言（mock 的 `botGroupSend` 会模拟延迟回声 + 两段 delta），截图 `.preview/bot-group-stream.png`

### Changed（回合导航：细线代替序号）
- **右侧回合轨不再写 `1 / 2 / 3…`**：改成 2px 短细线（12px 常态 / 20px 悬停与当前轮），当前轮更深（`--fg`）、其余 `--border-strong`；点仍可跳回合，序号只留在 `title` / `aria-label`
- 新增滚动同步：正文滚动时用 `data-turn-id` 反推「现在读到第几轮」，切 bot / 换会话 / 新增回合都会重算
- **悬停 / 聚焦细线就地预览那一轮**：圆角浮层（`--radius-float` + `--shadow-2`）显示谁说的 / 第几轮 / 时间 / 正文前三行，鼠标离开就收；不占常驻位，不挤正文（`pointer-events:none`）
- 删除 `.ds-turn-dot`，改为 `.ds-turn-mark`；`docs/arch/ARCH-bot.md` 同步（"短细线，不写序号"）

### Changed（计数与徽标：tab / 图标 / 标题上不再挂数字）
- **右栏「会话历史」tab 上的计数下线**：数字挂在图标后面（原来 `5`），既和「智能体会话」头的总数重复，又让导航带上数据；`title` / `aria-label` 里的 `会话历史（5）` 一并去掉，读屏不再多念一个数
- **「智能体会话」面板头的总数下线**：列表已按今天 / 昨天 / 更早分组并在行尾计数，头的总数是冗余；0 个分组时也不再有孤零零的 `0`
- **机器人配置页「待处理」tab 的珀色圆角徽标下线**：数字仍写在待处理面板自己的标题行「待处理 3」，只是不再压在 tab 上
- 删除无引用样式：`.tab-count`、`.tab-count-inline`、`.icon-tab-count`、`.bot-tab-count`
- `docs/DESIGN-SYSTEM.md` §5 新增「计数与徽标（数字）」：允许列表行尾 / 概览统计 / 区块内容头，禁止 tab / 图标旁 / 区域头 / 页头标题；只有「需要你处理」才配出现在 chrome 上且 `>0` 才渲染；计数是 10.5–11px 小字，不用彩色 pill / 徽标球 / 红点；§8、§9 同步
- `AGENTS.md` §2.3 新增硬约束第 19 条（原 §2.4 的 18–20 须延为 20–22）
- `scripts/verify-design.mjs`：新增两项检查——旧计数类不许在 `src/` 里长回来；`AGENTS.md` 与 `DESIGN-SYSTEM.md` 必须同时含这条规则

### Changed（BOT 窗口：联系人 / 消息 / 对话三栏 + 每轮轨迹）
- **三栏布局**：`机器人 | 聊天对话框 | 消息 · 设置`。左栏联系人（bot + 群聊，未读 / 暂停 / 静音）；中栏是 DeepSeek 式对话；右栏两个 tab：消息（会话列表 + 搜索 + 新会话 + 执行树）与设置（人格 / 日程 / 配额 / 连接器）。页面大标题 / 副标题整块删除，机器人操作收进消息头的 `⋯`（只留一个「决策」）
- **每轮轨迹**：轮次头 `已完成 / 已汇报 / 已提问，用时 N秒` 就是展开开关；展开后按时间列出思考（可展开全文）、工具调用（名称 / 参数 / 输出）、终端（可直接「打开终端」）
- 工具按族渲染专属卡：终端（命令 + 输出）、编辑（+/- 行 + diff 着色）、读取（路径 + 行数）、搜索 / 网页、通用 IN/OUT；轨迹数据优先读 run 的 `messages`，只读工具用 `bot_turns.tools` 兜底
- 轨迹升级为中栏主视图 `对话 | 轨迹`：三轨时间轴（输入 / 模型 / 工具）+ 可搜索账本（角色 / 工具名 / 原始参数 / 结果 / 用量 / TTFT）+ 回合分组；聊天右侧加回合导航（短细线，无序号，当前轮更深）；每轮动作行显示 tokens
- 结构化轨迹落库：`bot_turns.trace` 保存每次模型请求（usage / TTFT）与每次工具调用（原始 args / result / 时间）；ACP 工具消息新增 `messages.meta`（rawInput / 完整输出）；数据库迁移自动补列，旧数据回退到拍平文本
- 打开会话自动滚到最新一条；进入对话不再显示逐条 sender 名 / 头像

### Changed（Chat 窗口：照搬 deepseek-harness 的会话界面）
- **transcript 换成 DeepSeek 的扁平结构**：用户消息右对齐浅色气泡（R20、最大 82%/560、无头像无 meta）；agent 消息是 14/24 的扁平正文，不包气泡；时间 / 复制 / 重新生成收进正文下方的 28px 图标行
- **过程收成一行**：思考是「已深度思考 + 摘要」的一行折叠；工具 / 步骤是 33px 的「已处理」行 + hairline，展开后一步一行（16px 图标位 + 标题 + 圆点 + 摘要），不再画工具组卡片
- **运行中是蓝色 shimmer 一行**：`正在深入处理 · 已用 12s`，项目和步数细节收进 chevron；日期 / run 边界改成两侧 hairline + 居中说明
- **composer 换成 28px 卡片**：14/24 输入、28px 工具行、34px 圆形蓝色发送；Agent / 作用域 / 模型保留为无边框 chip select，去掉 Enter 提示与「模型」标签
- **BOT 页和 CHAT 共用同一套 `.ds-*` 语言**：机器人会话的正文、过程、动作、composer 一起改；群聊 / 回合归属降为 12px 渐变说明，不再有头像和 IM 气泡
- 设计系统新增 `--radius-chat-bubble` / `--radius-chat-composer` 两个 token，并把 Chat 窗口记为 Surface 圆角规则的唯一例外；`docs/arch/ARCH-chat-ui.md` 重写为 DeepSeek 对照表 + 新结构
- 预览：`npm run preview:bot` 现在同时输出 `.preview/bot-chat.png` 与 `bot-chat-dark.png`，断言同步到 `.ds-*`

### Changed（终端：整条工具栏删掉，只剩一行标签栏）
- **工具栏整行移除**（`Terminal` 品牌字、`终端 / 任务` 切换、`打开项目`、🔍、⚡、字号 chip、`＋ 新建` 全部下线）：终端区现在只有一行 34px 的标签栏，标签在左、`＋` 与最大化 / 收起在右，高度比原来少约 40px
- 新建入口收成一个 `＋` 菜单：「新建终端（⌘T）/ 新建预览页 / 任务详情 / 起 Agent（不建任务）」，Agent 列表按分组展示，没有可用的就显示「暂无终端 Agent」（原来并排的 `＋ Agent` 下拉 / `＋ 终端` / `＋ 预览` 三个控件）
- **任务详情变成标签**：`Tab.kind = "task"`（id 固定 `task`），TODO 行内「详情」或 `＋` 菜单打开同一个标签；原来占工具栏的 `终端 / 任务` 视图切换和 `localStorage.cmh.term.slot` 一并删除
- 查找回到 `⌘F` / 右键「查找…」，快捷命令回到右键「快捷命令…」，字号复位用 `⌘0`；`打开预览 :PORT`、`接入 #KEY` 作为窄 chip 只在需要时出现在标签栏右侧
- 同步清理：`.terminal-bar`、`.term-icon-btn`、`.term-zoom-chip`、`.term-pane-count`、`.term-slot-switch`、`.term-brand` 规则删除；新增 `.term-strip` / `.term-strip-actions` / `.term-chip` 级样式；`.term-menu` 增加分组标题 `.term-menu-head`

### Docs（设计规范：把「简洁」写成可检查的规则）
- `docs/DESIGN-SYSTEM.md`：§1 新增原则 8「一个区域一行 chrome」；§5 新增「一行 chrome（区域头 / 工具栏）」小节（常驻只放当前对象 + 主操作、一个动作一个常驻入口、「删掉它是否要多点两次」判据、不写区域品牌字、动态信息做条件 chip、菜单条目 ≤ 8）；§8 禁止模式 + §9 检查清单同步
- `AGENTS.md`：新增 §2.4「简洁：一个区域一行 chrome」（第 18–20 条硬约束）
- `scripts/verify-design.mjs`：新增两项检查 —— 两份文档必须同时含该原则；`terminal-bar` / `term-brand` / `term-slot-switch` / `term-slot-body` / `term-icon-btn` / `term-zoom-chip` / `term-pane-count` 这些旧工具栏类不许在 `src/` 里长回来

### Added（预览：代码编辑器 + 自带 PDF 阅读器）
- **代码文件可编辑**：预览里的文本 / 代码一律换成 CodeMirror 6（行号、折叠、括号匹配、自动缩进、行内查找、多光标），改动后出现「保存」按钮，⌘S 写回磁盘（原来只有 HTML / Markdown 能改，其余是只读 `<pre>`）
- **高亮覆盖**：js/ts/jsx/tsx/json、html/vue/svelte、css/scss/less、md 用官方 lang 包；py / go / rs / c / cpp / java / cs / swift / rb / lua / sh / sql / yaml / toml / ini / dockerfile / proto / diff 走 `@codemirror/legacy-modes`；认不出的当纯文本也能编辑
- **PDF 自带阅读器**：新增 `files:pageImage`（主进程 pdfjs + skia 逐页渲 PNG，按 `路径@mtime@页@scale` 缓存最近 24 张），预览里换成自己的阅读器——翻页、页码输入、100–300% 缩放、←→ 翻页、重新渲染；不再依赖 Chromium 的 PDF 插件，暗色主题下也不再是一块白
- `office-preview.html?page=file[&ext=pdf]`：dev-only 的文件预览页，用来单独核对代码编辑器与 PDF 阅读器

### Added（终端：快捷命令 + 文件路径链接）
- **快捷命令**（对照 ORCA quick commands）：工具栏 ⚡ / 右键「快捷命令…」→ 一键把常用命令写进当前 pty；可新建 / 编辑 / 删除，每条带「范围（本项目 / 全部项目）」与「发送后回车」开关；存 `localStorage["harness.terminal.quickCommands.v1"]`，按项目路径分组
- **文件路径链接**：终端输出里的 `src/foo.ts:12` 可点，直接在文件预览标签里打开（只认项目内路径，`..` 与项目外绝对路径忽略）
- 右键菜单补齐：快捷命令…、重置终端显示（只清 xterm 状态，不重启 shell）、均分窗格、重命名标签、复制终端 ID
- `office-preview.html?page=terminal`：dev-only 的终端页预览（假的 pty 桩），用来单独核对终端 UI

### Changed（发射指挥：改成真实指挥大厅 + 真人比例的工作人员）
- **长桌改阶梯控制台**：三排台面统一朝前方大屏（前排落地、后两排各抬 0.34 并带台沿灯带），一排 8 台显示器；前墙大屏两侧加 TELEMETRY / TRACK 辅助屏
- **席位改成三排工位**：`desk` 坐工位、`lead` 坐前排正中指挥席、`review / approval / meeting` 站到前墙与工位前沿、`tea / standby` 站两侧过道；同一工位多人时左右错开
- **人物重做**：按真人比例建模（髋 / 膝 / 肩 / 肘四个关节，关节补球）；躯干用 Lathe 轮廓压成椭圆（有胸腰差），四肢锥形；头部有颅骨 / 下颌 / 鼻 / 耳 / 眼 + 分层头发，头戴耳机（头梁 / 耳罩 / 耳垫 / 通话杆）+ 工牌；白色防静电工装带腰带、胸袋、大腿侧兜、裤脚反光条，鞋分鞋底 / 鞋面 / 圆鞋头；站姿、坐姿共用一套骨架，坐姿改成上臂垂下、小臂水平搭在台面；个体有身高差与三种发色，`tone` 落在肩章、袖标、工牌与耳罩环上
- 机位随布局重调（总览改成俯视阶梯、长桌改成左前方看工位）

### Changed（作战室 → 发射指挥：航天发射场景）
- **模板改名「发射指挥」**（id 仍是 `warroom`，老场景不用迁移）：大屏换成航天发射指挥台——**发射检查单**（`board.rows`）+ **发射工位实时画面**（塔架 / 探照灯 / 火箭 / 尾焰 / 烟雾，2D canvas 现画）+ **GO / NO-GO 系统状态**（推进 / 制导 / 遥测 / 发射许可 / 通讯，各自映射真实 zone 与终端数）+ 发射时序
- **新增发射演示**：舞台头「演一遍发射」→ T−4 倒计时（墙面警示灯同步闪红）→ T−0 点火，火箭带尾焰升空、地面腾烟，大屏方向打一束暖光扫过桌面，之后淡出复位
- **新增机位**：总览 / 大屏 / 长桌 / 工位四个预设，舞台头下拉 + 场景配置「呈现 → 舞台机位」共用 `prefs.view`；画布拖动绕预设 `look` 点环绕，双击回总览
- 去掉了原来浮在大屏前面的地球全息（挡住真正的画面），大屏中间改成大幅发射场画面；顶栏徽标改为 `LAUNCH CONTROL · THREE.JS`

### Changed（航母舞台：地勤形象 / 真起飞 / 护航舰建模）
- **甲板地勤换成穿军装的人**：作训服 + 岗位色救生马甲（含反光带、肩章、腰带）+ 防护头盔（耳罩 / 护目镜 / 下颌带）+ 军靴，带手臂和手；不再是「一根柱子顶一个球」
- **起飞真的飞走**：弹射行程长度改成从弹射位到甲板边缘的射线求交（`deckRun`），三种弹射位都从甲板边缘离舰；离舰后持续加速、拉起、带坡度转向飞走，起落架收起、机腹 AO 关掉，6.4s 飞出画面才回收到甲板位（不再挂在舰边悬停）
- **机头方向修正**：舰载机原来朝艉停放、弹射时尾朝前飞出，现在机头朝舰首；姿态改用 `YXZ`（先偏航再俯仰），拐弯爬升不会歪；航行灯改回左红右绿
- **起飞镜头**：弹射段贴舷侧低机位跟拍，离舰段机位钉在舰首外侧看它拉起飞远（不追着飞机跑，航母一直在画面里），约 4.7s 后回总览
- **视角可切换（并跟着场景记住）**：舞台头新增「视角」下拉、场景配置 → 呈现 → 舞台机位（同一份 `prefs.view`，落库到 `coordination_scenes`），切换按球坐标插值飞过去；画布上按住拖动可以绕看点环绕（原来提示写着「拖动看视角」但其实只有指针视差，现在是真的能转），双击复位回总览
- **修：场景 prefs 的 `motion` / `dawn` 没落库**：主进程 `normalizeCoordinationPrefs` 的白名单漏了 `motion` 和光照 `dawn`，动效档位和清晨光照重开场景就被打回默认；一并补上，并给 `motion` 加了范围钳制
- **新增着舰场景**：飞出去之后不再瞬移归位，而是从舰艉后方对正下滑道进场、末段拉平、接地时冒拦阻蒸汽、1.5s 内刹停，停稳后滑回自己的机位；`review` 状态变化时也放一次着舰（着舰道 = review / approval 串行）。镜头跟在下滑道后上方，舞台头新增「演一遍着舰」手动触发
- **护航舰建模重做**：驱逐舰 / 补给舰统一按一条尺度线（龙骨 / 甲板 / 舰首楔形）推；舰首改成接直舷段截面的五面楔形（原来是一根朝向反了的圆锥戳在舷外），窗户 / 相控阵 / 舱门贴到各自真实外皮上（原来悬在舰桥外面），吊机吊臂越过货柜而不是穿过它，舷号抬到水线以上；两舰改成远近编队，都在画面里

### Changed（脚本目录收口：`scripts/` 只留流程，测试搬进 `tests/`）
- **新增 `tests/` + `npm test`**：19 个后端用例（原 `*-selftest.mjs` / `verify-mission` / `scripts/bot/`）按 core / persona / knowledge / memory / im / bot 分组，`npm test -- persona` 过滤、`npm test --list` 列清单；`knowledge` 两项自动切到 Electron 的 Node 跑（内置 FTS5）。断言逻辑没改，统一的是入口和分组
- **`package.json` 的 script 从 68 条收到 45 条**：`memory:selftest` / `knowledge:selftest` / `persona:selftest` / `verify:preview-*` / `verify:mission` / `db:selftest` / `wiki:*:selftest` 等合并进 `npm test`；`persona:preview` → `preview:persona`、`memory:preview` → `preview:memory`；补上 `install:renderer`
- **E2E 收成一个入口**：`scripts/e2e/run.mjs`，`npm run test:e2e` 跑 requirements，`--suite=smoke|git|notes|preview|md-rich` 跑旧套件（窗口和端口都由 runner 起，套件只负责驱动）；散在根目录的 5 个 `e2e-*.mjs` 收进 `scripts/e2e/suites/`
- **删掉一次性脚本**（逻辑留在 git 历史）：`build-docs-html.py`（docs 已由 `site/` 接管）、`safari-feishu.mjs`、`persona-reconcile.mjs` / `persona-stats-backfill.mjs` / `persona-verify-quotes.mjs`（存量数据已修完）、`article-images/` 与 `video/`（产物已提交，重新出图再捡脚本）

### Fixed
- **`reply()` 盖过种子默认职责**：种子 bot 带了默认 `persona.mission`，而「第一句话成为职责」只在 mission 为空时才写，于是提问卡片问完就再也不会记用户的话。改成 `intro` 期间（问了还没答）优先用用户原话，并且提问后不再立刻把 `intro` 置 false（重复提问仍由 `!turns.some` 拦）
- **requirements E2E 数组里有 3 个裸逗号**（删用例留下的空位），`undefined` 元素让 `--list` 和整跑都炸在 `test.skip` 上
- **`db.test.mjs` 的 `INSERT INTO todos` 写死 22 个占位符**，schema 加到 23 列后直接报错；改成按 `SCHEMA` 推导列名

### Added（机器人配置页，像项目一样）
- **rail 上「机器人」= 配置页**（`src/components/Bots.tsx`）：概览条（机器人 / 绑定执行体 / 本小时开口 / 待绑定 / 静音暂停）+ 卡片·列表两种排布 + 筛选（全部 / 已绑定 / 未绑定执行体 / 静音或暂停）+ 排序（最近开口 / 名称 / 本小时开口）+ 搜索（名字 / 职责 / 执行体）；卡片里是头像、职责、执行体、日程数、最近一条回合（决定 + 原因）
- **行内操作**：「打开会话」进会话面；`⋯` → 人设配额与日程 / 暂停或恢复主动开口 / 静音 1 小时 / 取消静音 / 删除
- **会话面（`Bot.tsx`）不再占 rail**：从配置页带着 `initialBotId` 进来，页头多了「← 机器人」；任务面板的「管理机器人」也指向配置页
- 新增 `routines` 进 `State` 类型（配置页读日程条数）；预览入口统一到 `office-preview.html?page=bots&layout=list`
- 原型侧同步收口：`docs/prototype/bot.html` 回到「会话与审计」单面，README 写明**配置在应用的「机器人」页**，并记下 Orca 式 sidebar split 为什么没采纳（配置要独立一页，左栏只服务工作区）

### Changed（设置：用语、顺序、排版）
- **导航分组**：分区按「基础 / 运行 / 连接 / 观察 / 维护」分节，组间一条 hairline；顺序改为 通用 · 外观 · 执行 · 主机 · 终端 · 预览 · 即时通信 · 统计 · 插件 · 数据 · 快捷键 · 关于（主机跟着执行走，统计单独成组）
- **用语统一**：分区说明一句话、**不带句号**；行 hint 一句话、不带句号、技术值前置、并列用「；」；`settings-note` 才是完整句子（带句号）。术语固定为 Agent / 机器人 / 运行 / 主机 / 会话 / 任务，英文保留 dsh、DSH_HOME、ACP、CLI、worktree、Webhook、Mission、Supervisor
- **标题规范**：卡片标题 2–6 字名词（`dsh 运行时`、`模型与密钥`、`运行环境（只读）`、`全部快捷键`）；行标题 ≤8 字、不带括号补丁（`全局并发上限`→`并发上限`、`默认模型（高级）`→`默认模型`、`Reasoning effort`→`推理强度（effort）`）
- **卡片重排**：执行分区改为 并发与审批 → dsh 运行时 → 模型与密钥 → Mission → Agent 角色 → 桌面操作 → 运行环境（只读，合并「Chat 执行适配器 + 已检测 CLI」）→ Runtime 视图（只读）；模型/effort 从 dsh 卡挪进模型卡；「人物建模」改名「人物语料」并搬进数据分区
- **补齐缺失的 hint**：通用、预览、数据、主机等 20+ 行补上「它影响什么」，空行说明不再只靠标题猜
- **排版**：控件宽度收到三档（下拉/短文本 200 / 数字 88 / 长文本 260），只读值右对齐到同一条边（新增 `.set-row-value`）；`hint` 限宽 56ch；卡片间距 28px、卡片标题降级为 11.5px 小标；窄屏（≤820px）行自动变上下布局
- 飞书「一次粘贴就配好」块只保留一个 primary（保存并测试），小标题与行标题同级

### Changed（统计 / 主机收进设置）
- **rail 不再有「统计」「主机」**：两块内容以 `embedded` 模式嵌进设置分区（`Hosts` / `Stats`，不再自带 `PageHeader`，只留一条右对齐工具条），设置分区顺序：通用 / 外观 / 执行 / 终端 / 预览与元素 / 即时通信 / **主机** / **统计** / 插件 / 数据 / 快捷键 / 关于
- **旧入口都还能用**：命令面板「统计 / 主机」→ 设置对应分区；`defaultView=stats|hosts` 的老库读到时落成 `settings`；`harness:view` 传 `stats|hosts` 同样落到分区。主机离线的红点从 rail 挪到「设置」的角标
- **启动视图选项**：`工作区 / 项目 / 设置`（原来的「统计」换成「设置」）
- dev-only 预览统一到 `office-preview.html`：`?page=settings&section=hosts|stats` 看设置分区，`?page=bots` 看机器人配置页

### Changed（舞台的主角从 Agent 换成 Bot）
- **阵容按机器人登记**：`coordination_scenes.config.cast[]` 从 `agentId` 改成 `botId`（`src/types.ts: CoordinationCastMember`）。人格、头像、配色、走位、名字牌都跟机器人走，执行体（Agent）只是它**此刻借的身体**——换执行体不再等于换人
- **读兼容老数据**：老的 `cast[].agentId` 在 `buildOfficeModel` 里按 `bots.executor_agent_id` 反查成机器人；新的编辑器只写 `botId`
- **不静默丢人**：没绑执行体的机器人照样上台（待命位，状态「待绑定执行体」），协调台里「派了活但没人上场」也标出名字；一条 bot 都没有的老库仍按执行体呈现
- **状态里多一层**：除 run / todo 的机器状态外，舞台上还能读到机器人最近一条回合（`turn / silent / blocked / escalated / watching`）→ 「转人工 / 被拦 / 沉默 / 监视中」与「等待确认」平级；检查器新增「机器人」块（职责 / 语气 / 最近一次）
- 场景统计改口径：`stats.bots` / `stats.unbound` 新增，页头与场景库显示「几位机器人（含未绑定执行体）」；`?select=` 现在接 botId（`office-preview.html?select=b-golo`）
- **派单链记住「谁派的」**：新增 `todos.bot_id` / `delegations.bot_id`（老库启动时 `ALTER`，老数据留空）。`botAcceptProposal` 建的任务、Mission 派下去的子任务都带上它；协调台仍以「谁在干」（执行体所在座位）为先，执行体没上场才退回机器人。机器人检查器里的「真实委派」也按 `botId` 一起算

### Fixed（易用性 · Electron 里点了没反应的按钮）
根因是 `window.prompt`：**Electron 不实现它**，调用不会弹任何东西。以下入口之前都是"点了没反应"，现在全部改成行内输入：

- **Bot 页「＋ 新建 bot」**：直接建一个占位名、切到人格卡、聚焦「名字」输入框，改完失焦即存（不再要求先输名字）
- **Bot 页「＋ 每天 / ＋ 每隔 / ＋ 变化才跑」**：三连 `window.prompt` 改成一张行内表单（名字 + 时间/间隔/路径 + 保存/取消）
- **Bot 页「迁移历史到会话」/「删除」/「重命名」**：从埋在「策略」页签的 `⋯` 挪到**页头 `⋯`**，一眼能找到
- **Git「新建分支」**：改行内输入（Enter 建 / Esc 取消）
- **Mission「退回修改」**：改行内原因输入（之前这个按钮等于失效，计划根本退不回去）
- **Markdown 编辑器 ⌘K 链接**：改工具栏下方的行内地址输入（清空 = 取消链接）
- 新增 `verify:design` 规则：`src` 里出现 `window.prompt(` 直接失败；`AGENTS.md` 补第 12 条 UI 硬规则

### Changed（bot 自测按不变量拆分）
- 45 项断言从 `scripts/bot-selftest.mjs` 一个文件拆成 **11 个按不变量命名的文件**（`scripts/bot/{gates,prompt,reply,dispatch,guard,notify,routine,ask,thread,resume,memory}.test.mjs`），入口只负责按顺序加载 + 汇总；共享的只有 `_harness.mjs`（固定时钟、bot 夹具、`test()`）。断言总数不变（45），失败时文件名直接说明哪条不变量坏了
- `npm run verify:bot` 作为 `bot:selftest` 的别名（两个名字都能跑）

### Added（提问卡片 ask_user）
- 模型主动开口时输出 `ASK: 一句话问题` → 落一张**可作答**的卡片（`bot_turns.ask = { text, status, answer }`），挂在 Bot 页输入框上方；创建时的"你想让我干什么"也走同一套状态机
- **不挡聊天**：卡片挂着也能继续说别的；人回一句就把当前开着的卡片全部结掉（`answered` + 记下答案）；「先不管」→ `dismissed`；7 天没答懒标记 `expired`
- `openAsks()` / `settleAsks()` 导出，`botSnapshot` 顺带返回 `asks`

### Added（记忆修订 / 日程落点 / 终端接管）
- **记忆条目修订与乐观并发**：新增 `entry_revisions` 表 + `entryRewrite()` / `entryRevisions()` / `entryRestoreRevision()`；`entryUpsert` 与 `entryRewrite` 都接受 `expectedUpdatedAt`，版本不一致抛 `MemoryConflictError`（`code: memory_conflict`）。回滚本身也是一次改写，所以能再回滚回去。不传 `expectedUpdatedAt` 的老调用行为不变
- **日程落点**：`mode: "alongside"`（到点就跑）/ `"in-chat"`（等这个 bot 空下来，最多等 5 分钟就并进去）。有日程到点时 `gatesFor` 跳过「最小间隔」——否则 9:00 的早报会被 8:59 的一句闲聊挡掉
- **终端接管**：`terminalTakeControl` / `terminalReleaseControl`。接管期间 Chat 纠偏**直接失败而不是排队**，交回时写一条「它需要重新看当前输出」；标签上 ✋ 提示，右键菜单可切换

### Added（持续 chat · 一个人格 bot 一条会话）
- **bot thread**：人格 bot 与普通 Agent 共用 `threads` / `messages`（`threads.kind="bot"` + `threads.bot_id`，`todo_id` 为空）。**说出口的部分**（提问、回复、主动开口、创建时的提问）镜像进会话，**沉默 / 被拦只留在 `bot_turns` 审计**里，不再让 Chat 变成"两套历史"
- **历史改读会话**：`reply()` 的对话历史取这条 thread 最后 10 条（含主动开口），不再从 `bot_turns` 拼；没有消息层的环境自动退回旧路径
- **老数据迁移**：`botThreadMigrate({ dryRun })` 按时间顺序补齐未镜像的回合，写过的标 `mirrored` 所以**幂等**；Bot 页 `⋯ → 迁移历史到会话` 先 dryRun 报数再确认
- **打开会话**：Bot 页页头「打开会话」→ `botThread` 拿 thread id → 跳到 Chat 的同一条 thread
- `threads.bot_id` 新列（新库建列 + 老库 ALTER）

### Added（可恢复 · ACP 续跑）
- **`session/resume` 实测可用**：内置 dsh 的 `agentCapabilities.sessionCapabilities` 是 `{ close, list, resume }`；新增 `npm run verify:acp-resume`（6 项断言：跨进程恢复、`cwd` 必填、响应不含 sessionId、活跃会话不能同进程 resume、不存在的 id 明确报错）。探针脚本会 SIGKILL 第一个进程再起第二个，模拟真实崩溃
- **run 续跑**：`runs.acp_session` 记录会话 id；`runResume`（任务面板「续跑」按钮，仅在 `interrupted` 且有过 ACP 会话时出现）把 run 放回队列，`startRun` 用 `resumeSession` 接回原会话并追加「先看当前工作区状态再继续」。**cwd 用原 run 的 cwd，不新建 worktree**——否则上次未提交的改动会丢；续不上时明确报「会话已失效，改为新会话」而不是假装续上
- **bot 回合可恢复**：被动回复先落一条 `decision: "streaming"`，增量每 800ms 节流刷新；成功同一条改 `replied`，取消/报错删掉；应用被杀留下的 `streaming` 下次启动收成 `interrupted` 并保留半截正文，Bot 页单独标「被打断」
- `electron/acp.mjs` 新增 `listSessions()` / `resumeSession(sessionId, cwd)`

### Added（人格 bot · 日程 / 先问用途）
- **日程（routine）**：`daily`（每天整点）/ `every`（每隔 N 分钟）/ `watch`（文件或命令输出变了才跑）三类触发。判定是纯函数（`electron/bot/routine.mjs`），探针由主进程注入（文件 `mtime+size`、命令 `stdout` 前 8KB 的 sha1，15s 超时）；到点由 bot 自己开口，**开口成功才推进 `lastFiredAt`**，沉默 / 被拦不推进——否则同一时段会被反复重试。落 `routines` 表（新库自动建，老库补表）。
- **创建后先问用途**：种子 bot 第一轮不客套，直接问「你想让我干什么」；用户第一句话落成 `persona.mission` 并进 system prompt。空职责时输入框占位文案跟着变。
- **Bot 页「日程」页签**：列出每条日程的启停、上次跑的时间、"现在为什么不动"（未到点 / 没变化 / 已停用）与下次时间；`＋ 每天 / ＋ 每隔 / ＋ 变化才跑` 三个入口，`RowMenu` 里启停与删除。

### Fixed（人格 bot · 打扰与泄漏）
- **通知节流**：此前每次主动开口都弹 toast。现在 180 字截断、每小时最多 3 条、未读 ≥5 时只放行「待输入 / 日程失败」两类、静音不弹（`electron/bot/notify.mjs`）
- **运行时脱敏**：回合落库前把 `sk-…` / `ghp_…` / `Bearer …` / JWT / 32+ 位 hex / `key=value` 的值换成 `[redacted]`（`electron/redact.mjs`）。`verify:privacy` 只管仓库，这条管运行时会话与回合账
- **事件级防重复**：同一 `trigger.ref` 在 6 小时内说满 2 次即压住；与上一条主动开口相似度 ≥0.8 的近重复也压住（生成后再查一次，防「换个说法重说」），落 `blocked` 并写清原因（`electron/bot/guard.mjs`）
- **记忆容量外显**：注入用到 80% 时上下文尾部追加「已用 X/Y 字符 · 条目 N · 观察 M」，让它在保存被拒前自己整理（`memory.usage()`）

### Changed（人格 bot · 日程与通知的口径）
- `botSnapshot` 现在顺带返回 `routines` 与 `routineStatus`（含每条"为什么没跑"），并清零未读计数——未读计数是通知抑制的输入，只在 Bot 页打开时归零
- `botRemove` 连带删除该 bot 的日程；`bot_turns` 里新增 `decision: "asked"`（创建后先问一句），UI 单独渲染

### Fixed（人格 bot · 记忆只给目录、多 bot 抢事件）
- **记忆注入只有标题**：`inject().markdown` 被丢弃，bot 只看到「- [L4] 标题」的目录。现在直接注入正文（2400 字符），并以 `bot:<id>:<turnId>` 落 `inject_log`，注入可归因
- **记忆不分 bot**：新增 `entries.owner` / `notes.owner`（老库自动补列），空 = 共享、`bot:<id>` = 私有；`inject({ owner })` 只返回「共享 + 自己」
- **多 bot 抢事件**：候选去重的 `seen` 不过滤 `botId`，A 对某条任务开过口，B 30 分钟看不到同一事件；改为按 bot 各算各的
- **主动说过的话被忘掉**：history 只取 `replied`，半夜主动说的「有三项待确认」在用户回复后不进上下文；现在最近 3 条主动开口进 system prompt（不拼 history，避免破坏 user/assistant 交替），history 6 → 10 条

### Changed（人格 bot · 配额与出站）
- **`budget.tokensPerHour` 从死字段变成真闸**：接进 `gatesFor`，超了记 `blocked`（此前只有条数闸）
- **`policy.sensitiveBlocklist` 真正生效**：命中即 `blocked`、不外发，正文只留在本地审计里
- **`policy.escalate` 明确语义**：不是闸门，而是写进 system prompt 的「必须请人来做」边界（UI 里那格一直是自由文本，此前只存不用）
- **`force`（手动跑一次）只放行静音时段与最小间隔**：暂停 / 手动静音 / 条数 / token 配额照旧生效，配额不能被一键绕过
- **`scripts/bot-selftest.mjs` 的 `test()` 改成 `await`**：此前 async 用例在 Promise 里抛断言，等于「全绿但没测」；新增 8 条 P0 回归用例（记忆正文、per-bot 去重、token 闸、force 边界、敏感词、主动上下文）
- `scripts/memory-selftest.mjs`：新增 owner 隔离断言；顺手修掉 `as_of` 用例的同毫秒抖动

### Fixed（启动崩溃 · 生命周期）
- **`Attempted to register a second handler for 'clipboard:readImage'`**：同一频道被注册两次，主进程在模块加载阶段直接崩、窗口都出不来。已去重，并新增 `npm run verify:ipc`（扫描 `electron/*.mjs` 里重复的 `ipcMain.handle/on` 频道，53 个频道全量查）
- **Electron 45 剪贴板 API 迁移**：`clipboard.readImage()` / `writeImage()` 在 45 已移除（只剩 `readText/writeText/read/write/has/clear`）。`clipboard:readImage` 改为 `clipboard.read()` → `ClipboardItem.getType("image/*")` → Blob → data URL；「预览截图」写入剪贴板改为 `clipboard.write([new ClipboardItem({ "image/png": blob })])`
- 顺带：打包时 `corrupted Electron dist`（缓存的 Electron 45.2.2 包被前面的中断构建弄坏）已清缓存重下

### Fixed（视觉解析 · 叠加图缩放无效）
- **点 +/− 只有百分比数字变、图片不动**：`.zh-frame` 是 flex 项且默认 `flex-shrink:1`，`width:300%` 被缩回容器宽；同时父容器 `justify-content:center` 会让放大后的左半边滚不到。改为 `flex:none` + `flex-start` + 子项 `margin:0 auto`
- 顺手删掉上一轮为「结果贴身」加的 `img{max-height;width:auto}`：它覆盖了缩放依赖的 `width:100%`（两个坑叠加，等于放大完全失效）
- 实测：100% 718px / 150% 1077px / 300% 2154px，可横向滚动到最右；「适应」回 718px

### Changed（视觉解析 · 易用性）
- **⌘V 粘贴即解析**：视图内直接粘贴截图（`clipboardData` → 图片），选完自动开始解析（「选图后自动解析」可关）；另给「从剪贴板取图」按钮（走 `clipboard.readImage()`），不用先存文件再拖
- **⌘↵ 解析 / 重新解析**；空态文案直接写「⌘V 粘贴截图，立刻解析」，并给按钮
- **画布限高** `min(52vh, 560px)`：分析结果（区块表 / 核对项）不用再滚半页才看到
- **未配置后端**：进视图就出带「去设置 → 插件」的引导条，不再等到点解析才报错
- 新增 `clipboard:readImage` IPC（主进程 `clipboard.readImage()` → PNG data URL）

### Fixed（视觉解析 · 解析结果看不到）
- **插件进程空闲自杀**：utilityProcess 的 MessagePort 不 ref 事件循环，插件空转几十秒就 `exit(0)`；宿主又不拒绝该插件的 pending 请求 → 界面「解析中…」卡到 120s 超时。现在 runtime 带 keepAlive，宿主在进程退出时把 pending 全部 reject（可重试）
- **结构化解析关思考**：实测同一张图 doubao-seed-2.1-turbo **12.8s → 3.0s**（输出 token 621 → 100）；GLM 不发 `thinking.type=disabled`（会 400）。另加 `response_format: json_object` + JSON 解析失败自动重试一次
- **结果不再丢**：切走视图再回来，图片 / 结果 / 页签仍在（模块级内存会话，不落盘）
- **错误与进度可见**：解析/探测改走 `window.harness.action` 拿真实错误（不再被 `act` 吞成「插件没有返回解析结果」）；成功后滚动到结果区并 toast「解析完成：N 个区块 · X.Xs」；按钮显示已等待秒数，画布角标提示「视觉模型通常 3–30s」；图片区显示 KB 与真实像素尺寸

### Added（Dream 从「按钮」变成「循环」）
- **提案带 diff / `base_rev` / `confidence`**：`suggestions` 多四列（`diff` / `base_rev` / `confidence` / `dream_id`），记忆页逐行 `-`/`+` 显示「这条建议会改掉什么」，并标注「确定性检查」还是「模型判断」、基于多久以前的版本
- **接受前版本闸门**：`base_rev` 与目标当前版本不一致（人改过 / 另一条建议改过）→ 标 `superseded`，不执行、不覆盖、不进 `rejects`；页面版本在主进程用 `wiki.getPage().updatedAt` 校验
- **语义 pass 带证据**：候选不再只有一句结论——`noteEvidence` 先回 L1 索引取观察自己的出处原文，再按正文 bigram 检索相关会话；来源是页面的再补一段页面摘要 + 引用原句。`correct` 必须带 evidence，且 ref 必须落在这次真的给过它的证据里（`evidenceRefs`），没证据就不进队列
- **输入指纹幂等**：`dreamFingerprint`（观察 / L3 / 页面 / 资料的 `id@updated_at`）与上一轮相同 → 直接返回，不扫描、不调模型
- **空闲触发**：记忆页新增「空闲 N 分」（默认 30，0 = 只手动）；只有没有 run 在跑、且 run / 消息 / 事件都静了 idleMinutes 才跑，和手动共用 `runDreamCycle` 一条路径、串行执行
- **`dream_runs` 台账**：每轮记 trigger / 指纹 / 看到多少对象 / 产出几条 / 耗时 / 语义 pass 为什么没跑；记忆页显示「上次 空闲 · 2 小时前 · 3 条 · 1s」
- 回归：`npm run memory:selftest` 新增版本闸门 / 指纹 / 证据链 22 项；`npm run memory:preview` 新增逐行 diff、基于哪一版、证据引用、台账 4 项断言

### Fixed（视觉解析 · 外部 API 地址与坐标校准）
- **`openai` 后端不再写死 `/v1/chat/completions`**：新增 `chatUrl()`，`…/v1`、`…/api/v3`、`…/api/plan/v3`、完整 `…/chat/completions` 都能拼对；探测改为对 `chatUrl` 发一次 `max_tokens:1` 的最小请求（Ark plan 网关没有 `/models`，原来的探测必然 404）
- **坐标按真实像素校准**：从图片字节读 PNG/JPEG/GIF/WebP 尺寸，模型猜的画布按比例换算 bbox，核对项新增「坐标校准」（实测 doubao 把 320×200 报成 1600×1000，校准后框才落在图上）
- **空 blocks 的错误可操作**：说明「可能不是视觉模型 / 图里没有可识别内容 / 只回了文字没回 JSON」，并提示跑探测
- `npm run zhulong:selftest` 18 项（新增地址拼接、图片尺寸解析、坐标校准用例）

### Changed（Pi Agent 模型配置）
- `~/.pi/agent/models.json` 的 `volcengine`（火山 Ark plan 网关）按实测重写：剔除 5 个 404 模型，按真实能力标注 `input`（图像 / 纯文本）、补 `thinkingFormat: "deepseek"` + `thinkingLevelMap`，GLM 系单独用 `thinkingFormat: "openai"`（它们不接受 `thinking.type=disabled`，会 400）

### Added（预览面板：控制台 / 截图 / 录屏）
- **控制台面板**：预览头部 `</>` 按钮打开，直接看页面 `console.*`（环形 200 条、error 计数角标、`error/warn` 着色、来源 `文件:行号`）；不用再单开 DevTools，Electron 自身的安全告警不占面板
- **截图**：一键把当前预览截图落盘 `userData/preview-shots/` 并复制到剪贴板（与 Agent 的 `browser_screenshot` 共用 CDP 实现）
- **录屏**：主进程 `capturePage` 约 4fps 抓帧 → 渲染层 canvas + `MediaRecorder` 编 WebM → 存 `userData/recordings/*.webm`（无音频、最长 60s、录制中有计时与红点、退出应用自动停）；帧宽 >1280 自动下采样控制体积
- 实测（隐藏窗口 Electron 验证）：8 帧 → `video/webm;codecs=vp9`，EBML 魔数正确；`console-message` 结构化签名与旧签名都覆盖

### Added（预览 · Agent 驱动 + 版式还原）
- **Agent 能操作预览页**：普通（非 Mission）ACP run 也会挂 `cockpit_browser` MCP（`electron/browser-mcp-bridge.mjs` + `electron/browser-tools.mjs`），工具：`browser_state / open / read / click / type / wait / screenshot / back / forward / reload`。只作用于「用户正看着的那个预览页」（渲染层 `preview:active` 上报 + `guestOf` 校验必须是 webview guest），URL 只收 http/https/file，点击走真实鼠标事件、输入走 `Input.insertText` 且未落地时回落 setter + `input` 事件（React 受控组件可用）；每次 run 一个随机 token，run 结束回收。设置 → 预览与元素 → 「Agent 可操作预览」可整体关掉
- **pptx / doc / odt 版式还原**：检测本机 LibreOffice，`soffice --headless --convert-to pdf` 后交给内置 PDF 阅读器，按 `路径+mtime+size` 缓存到 `userData/doc-preview/`；没装 LibreOffice 自动回落 officeparser 抽文本（并提示「装 LibreOffice 可看版式」），转换失败不报错卡住
- **预览标签上限 3 → 6**（`TerminalPanel`），给「多个页面同时开着对照」留出空间
- 新增 `verify:browser-tools`（5 项，含 black-box 起 bridge 子进程验证 MCP 协议）；`verify:preview-doc` 增加 LibreOffice 转换 + 缓存命中用例

### Added（预览 · 对齐工作区浏览器：登录态 / 站点权限 / 视口 / 文档）
- **预览会话持久化**：`partition` 从内存的 `preview` 改为 `persist:preview`，预览页登录态跨重启保留；设置页新增「忽略证书校验」，自签名 https 的 dev server 不再只能看到证书错误页
- **OAuth / 登录弹窗**：`setWindowOpenHandler` 从一律拒绝改为放行 http(s)，子窗口共用同一会话、无 preload / 无 Node —— 需要登录的站点（GitHub / Google 登录）真正可用
- **站点权限**：`configurePreviewSession()` 接入 `setPermissionRequestHandler` / `setPermissionCheckHandler`；摄像头 / 麦克风 / 位置 / 通知 / 读剪贴板 / MIDI / 跨站存储按站点授权，全屏与写剪贴板直接给，USB / 串口 / 蓝牙 / 屏幕共享明确拒绝（没有选择器 UI 就不假装允许）；被拒时预览顶部出现「允许并刷新」，设置页可撤销（`previewPermissionSites`）
- **自由尺寸视口**：原来只有「自适应 / 834 / 390」三个宽度，现在可填任意 宽 × 高（120–4000）+ 预设 + 「适应窗口」；高度也生效，不再只能调宽度
- **文档预览**：`.docx`（mammoth）、`.xlsx/.xlsm/.xls/.ods`（SheetJS → 表格，12 sheet × 400 行 × 60 列截断）、`.pptx/.doc/.odt/…`（officeparser → 文本）统一走 `files:previewDoc`，渲染层再过 DOMPurify；以前这些格式只能看到「二进制，预览不支持」
- 新增 `verify:preview-permissions`（9 项）与 `verify:preview-doc`（6 项，含现造 docx/xlsx 夹具）；`verify:preview-format` 增加 `DOC_EXT` 与主进程 `officeKind` 的一致性校验

### Fixed（预览 · 文件格式兼容）
- **图片 / 音视频 / PDF 走 webview 原生渲染**：以前 `.mp4` `.mp3` `.pdf` `.ico` `.bmp` `.avif` 都被按 UTF-8 读成乱码塞进 `<pre>`；现在统一由 Chromium 画（音视频带播放器），并且不再受「2MB 文本上限」误伤（以前 3MB 的 JPG 会先判成「太大」）
- **二进制不再当文本**：`files:read` 先做 NUL 字节 / 控制字符占比判定，`.docx` `.xlsx` `.zip` `.woff` `.db` `.wasm` 直接给「不支持预览 + 用 Finder 打开」的原因，不再把二进制灌进 DOM
- **文本编码不再只有 UTF-8**：严格 UTF-8 → BOM 的 UTF-16LE/BE → GB18030 兜底；按 GB18030 解码时顶部明确提示「保存会写成 UTF-8」；实在解不出来才判二进制
- **`file://` 地址修正**：`encodeURI` 不转义 `#` / `?`，文件名带这两个字符时预览直接空白；改为逐段 `encodeURIComponent`（同时处理 Windows 盘符 `file:///C:/…` 与 UNC `file://server/share`）
- **口径唯一**：扩展名清单收敛到 `electron/file-kinds.mjs`，`FileVisual.tsx` 的图标清单与之对齐（以前 `.ico/.bmp` 显示图片图标、预览却是乱码），`npm run verify:preview-format` 校验两处不漂移

### Added（预览 · 远端主机的 dev server 也能打开）
- **预览跟随 Agent 的运行位置**：当前任务跑在 `kind=ssh` 的主机上时，预览标签自动用 `ssh -L` 把远端端口映射到本机回环（`127.0.0.1:<随机端口>` → 远端 `127.0.0.1:<端口>`），不再要求用户自己先 `ssh -L` 或手动填一个多半连不上的远端 IP
- **地址栏仍然是远端地址**：`PreviewSurface` 只把隧道地址交给 webview，地址栏 / 「系统浏览器打开」/ 拾取生成的 `ElementContext.url` 都映射回远端原始地址；元素源码也用远端 workdir 相对化（`src/App.tsx:42`），不会把 `127.0.0.1:随机端口` 写进 prompt
- **只建必要的隧道**：回环 / 内网 / mDNS / 该主机自己的地址才走隧道，公网地址直接加载；同一 `主机 + 目标端口` 复用一条（引用计数），换地址 / 关标签 / 退出应用都会释放，监听只绑 `127.0.0.1`
- **失败说人话**：`sshHint()` 把 stderr 翻成「免密未配置 / 主机名解析失败 / SSH 连不上 / 远端端口没服务」；页面级 `ERR_CONNECTION_REFUSED` 补一句「隧道已建，但远端该端口没服务」；隧道中途断开通过 `preview:tunnel:closed` 回到预览区显示原因
- 新增 `electron/preview-tunnel.mjs`（不依赖 electron，可单测）+ `npm run verify:preview-tunnel`；实现见 `docs/arch/ARCH-ui-context.md` 2.3

### Added（内容 · 抖音介绍视频）
- **按 WorkBuddy 定稿的 11 段第一人称脚本重做**：热点开场（5 个 Agent 上限）→ 我也是这样 → 我写了个东西 → 派活 / 分工 / 场景 / 知识 / 记忆 / 画像 → 五个难点 → 开源；成片约 **60s**、1080×1920、30fps
- **视频生成器**：`scripts/video/`（`scenes.cjs` 11 个场景 / `stage.css` 舞台 / `tts.cjs` 分段合成 / `render-douyin.cjs` 时间线 → Electron 逐帧截图 → ffmpeg / `voiceover.md` + `storyboard.md`）；字幕烧进画面，避开抖音底部 400px / 右侧 120px 安全区
- **配音**：改用 Edge 神经语音 `zh-CN-XiaoxiaoNeural`（`rate +30%` / `pitch -2Hz`），更柔和、现代；后期加轻 EQ / 压缩 / 短空间感。火山引擎适配器仍就绪（`VOLC_TTS_APPID / TOKEN / CLUSTER / VOICE`，`TTS_ENGINE=volcengine`）；Pi Agent 的 `models.json` 里 volcengine 是 **Ark plan 网关**，不含 TTS
- **音乐**：`scripts/video/music.cjs` 纯合成 96 BPM 铺底（Am7–Fmaj7–Cmaj7–G6），人声 sidechain 自动让位，无第三方版权素材；静音版仍保留，方便抖音加热门音乐
- **去个人内容**：记忆 / 画像两段不再用真实截图，改成纯 HTML 合成卡片（`示例数据` / `示例人物`），视频里不含真实联系人、真实笔记、本地路径
- **横版 / GitHub Pages**：`--wide` 输出 1920×1080 横版，`publish-web.cjs` 压成 1600×900 / 4.5MB，落到 `public/video/`；Pages 首页新增 `#video` 区块（`<video controls poster>`），工作流监听 `public/video/**`
- **产物**：竖版配音 / 静音 + 横版 1920×1080 + Pages 1600×900 + 封面 / 海报；母片在 `.preview/douyin*`（gitignore），Pages 版入库

### Added（文档 · Wiki 与 Pages）
- **三篇新 Wiki 页**：`场景与办公室`（状态映射 / 三套模板 / 动效 / 明确未做）、`记忆与 Dream`（L1–L4、四种「忘」、打分注入）、`知识库`（解析路由 / 摄入状态机 / 混合检索 / 引用）；同时补了 `office` / `memory` 两段可播放流程图
- **首页与架构页对齐现在的导航**：导航改为 工作区 / 场景 / 项目 / 统计 / 主机 / Git / 知识库 / 记忆 / 人物 / 说明 / 设置；架构页新增「三套库」（`harness.db` / `kb.db` / `mem.db` / `persona.db`）与对应代码入口
- **`publish-wiki.mjs` 补齐 `Gallery.md` / `LLM-Wiki.md`**：以前 `#/wiki/gallery`、`#/wiki/llm-wiki` 在 GitHub Wiki 上是死链，现在一并发布；新页同时登记进 `src/wiki/pages.ts` 与侧栏；`<figure><img>` 的相对图片地址也会像 Markdown 图片一样改写回 raw 地址
- **GitHub Pages 首页重排为「五 + 五」**：五个主打特性（多智能体终端 / Super Agent 编排 / 场景与办公室 / 知识库 / 记忆与人物画像）与五个技术难点（解析 / 编排 / 整理 / 记忆 / 画像）；每个难点写「难在哪 / 做到什么算做到 / 现在到哪了」，口径以 `docs/arch/ARCH-key-tech.md` 为准；下方五张一一对应的封面截图，新增 `cover-office.png` / `cover-memory.png`（由 `scripts/article-images/render-pages-covers.cjs` 生成，与既有封面同一版式）；版本号改为从 `package.json` 读取，标签补 `three.js`
- **Wiki 补齐「五个技术难点」页**：`resources/wiki/tech.md`（解析 / 编排 / 整理 / 记忆 / 画像：难在哪、判据、现状、明确不做）；首页从「三大能力 + 补充」改成「五个主打特性」并换成五张封面；`plugins.md` 更新 MCP 工具矩阵（wiki / knowledge / memory / persona）与建议队列 / 人工结论，`llm-wiki.md` 补「写入闸门」，`design-notes.md` 把 `sql.js` 订正为 `node:sqlite`，`build.md` 补 Pages 部署
- **新增隐私守卫**：`npm run verify:privacy` 扫描「已跟踪 + 未忽略的新文件」里的真实微信账号 / 手机号 / 个人邮箱 / 本机绝对路径 / 私钥，命中时只打印打码片段，不进 CI 日志；已接入 `build.yml`；同时把主机表单里的用户名 / 本机 cwd 占位符改成通用值

### Added（场景 · 场景库卡片管理）
- **场景库卡片就地增删改查**：`⋯` 菜单里 `重命名 / 复制一份 / 复制为 JSON / 删除`，原来的占位提示换成真实操作；标题双击也能改名（Enter 提交、Esc 取消、失焦提交）
- **删除二次确认**在卡片底部完成（不再弹系统 confirm），每个项目至少保留一个场景；删掉当前场景后自动回落到第一个
- **复制一份**直接复制模板、阵容与呈现偏好；**复制为 JSON** 把 `kind / version / name / template / config` 写入剪贴板，方便备份和分享
- **查得快**：按场景名 / 舞台模板 / 阵容成员搜索，按舞台模板筛选，按最近更新 / 最近创建 / 名称排序；无结果时给「清除筛选」
- 卡片改显示自己的「更新于」与非默认配置标记（免评审 / 不升级 / 注入角色提示 / 隐藏连线 / 隐藏姓名），不再把全局运行统计重复印在每张卡上
- 卡片可键盘聚焦（Enter 进入实况），排列与筛选逻辑收敛在 `SceneGallery.tsx`，写入仍走 `coordinationSceneSave` / `coordinationSceneRemove`

### Added（场景 · 航母 3D 舞台）
- **航母接入 three.js 3D 舞台**：参考 `docs/prototype/carrier-3d.js`，`prefs.template=carrier` 时渲染福建舰甲板、海面 / 夕阳 / 舰载机 / 舰岛 / 升降机 / 着舰道
- **状态映射沿用现有字段**：弹射位 = 并发 `run`，着舰道 = `review / approval` 串行，失败 = 复飞，待命 = 升降机 / 停机区，主控 = 甲板弹射官；姓名牌 + 引线投影定位，点开复用同一个 Inspector
- 角色用舰载机（`j15 / j35`）表示，颜色 / 环 / 姓名牌跟随 `tone`；动效档位 / 走位时长 / reduced-motion 生效；光照跟随应用主题
- **电磁弹射起飞动画**：`run` 开始时沿弹射位做「张紧 → 弹射 → 爬升」，JBD 抬起、尾焰、甲板蒸汽和轻微镜头震动；起飞后保持空中待命，状态变化时再降落到对应甲板位。舞台头新增「演一遍弹射」按钮
- **起飞镜头**：镜头从总览平滑推到弹射位侧后方，弹射时收紧 FOV 并跟拍；起飞后不切回总览，而是侧后方跟拍 + 缓慢后拉，把航母留在画面里，再回总览
- 新增 `src/office/Carrier3D.tsx` + `src/office/carrier-scene.ts`，按需加载的 3D chunk

### Added（场景 · 作战室 3D 舞台）
- **作战室接入 three.js 3D 舞台**：参考 `docs/prototype/warroom-3d.html` / `carrier-3d.html`，`prefs.template=warroom` 时渲染透视房间、视频墙 + 3D 地球、长桌、复盘墙、发布闸门与真实角色
- **状态映射不新增字段**：`desk / lead` 在长桌席位，`review` 去复盘墙、`approval` 去闸门、`meeting` 去主屏、`tea / standby` 去两侧；角色颜色跟 `tone`，姓名牌是投影定位的 DOM 按钮，点开复用同一个 Inspector
- 主屏 HUD 由 `model.board / stats` 现画；动效档位 / 走位时长 / reduced-motion 生效；光照跟随应用主题，作战室隐藏四时段「光照」tab
- 新增 `three@0.149.0` 运行时依赖；作战室场景在 `src/office/WarRoom3D.tsx` + `src/office/warroom-scene.ts`

### Added（场景 · 作战室 / 航母舞台原型）
- **作战室舞台原型** `docs/prototype/warroom.html`：长桌 6 席 + 主屏 + GO / NO-GO 发布闸门 + 复盘墙 + 对外同步 / 静默角；点座位与道具打开 Inspector，配置态可看空位与期望拓扑
- **航母 · 电磁弹射原型** `docs/prototype/carrier.html`：2.5D 写实，甲板布局参考福建舰（003）——舰艏 2 条 + 斜角甲板 1 条 EMALS、双升降机、舰岛舷号 18、3 道拦阻索；弹射位对应并发 worker，着舰道对应串行 review；底部「弹射序列」可逐步回放 待命 → 对位 → 通电 → 弹射 → 起飞 → 拦阻 → 复位
- **两个舞台原型改用 `zoom` 整块缩放**（替代 `transform: scale`），1180×560 设计稿在任意窗口下按实际字号排版，文字不发虚
- **流水线（Factory）舞台模板下线**，改为「航母 · 电磁弹射」（`carrier`）：多路并发起飞、单道回收，正好对应 worker 并行与 review / approval 串行；旧场景里的 `factory` 读成 `carrier` 并在保存时写回
- 舞台模板文案收敛到 `src/office/templates.ts`；场景库封面 / 新建弹层 / 执行配置共用同一份标签

### Added（场景 · 航母 3D 仿真原型）
- **航母 WebGL 3D 仿真原型** `docs/prototype/carrier-3d.html` + `carrier-3d.js`：低机位逆光黄昏、程序化舰体 / 飞行甲板 / 舰岛 / 舰载机 / 海面；three.js r149 以 classic script 放在 `docs/prototype/vendor/`，`file://` 双击可离线打开
- **可读的 3D 舞台**：DOM 热点 + SVG 引线跟随相机投影，最多 16 个候选位置做碰撞避让；点飞机 / 人员 / 甲板区打开 Inspector；沿用现有 `zone / pose / tone / seat`，不新增场景字段
- **状态与配置同构**：`待命 → 对位 → 通电 → 弹射 → 起飞 → 拦阻 → 复位` 序列回放；live 10 个角色热点，config 追加 6 个区（CAT 1/2/3、双升降机、着舰道）与光圈；支持 `?mode`、`?seq`、`?detail`、`?select`、`?motion`、`?theme`、`?view`，`?cam` 仅调试
- **材质与海面交互**：甲板防滑颗粒 / 系留点 / 拦阻索 / EMALS 轨道 / 舷号 18；舰体钢板缝 / 锈迹 / 水线 / 舷侧 18；舰岛窗灯 / AESA / 舷号；舰载机面板线 / 红星 / 挂架 / 折翼 / 航行灯；海面只保留水线轮廓、舰岛暖光倒影与随行舰尾流；去掉甲板下整块 deck-shaped rim 板，并删掉舰艏 / 舰尾的 additive Sprite 泡沫——白色 Sprite 在低机位会叠成灰雾；舰体顶/底盖隐藏、舰艏外露的 hangar 平面移除，低机位不再露出灰色长方体；补回薄环 catwalk、海面 shader 近舷泡沫和舰体钢板缝高光；2.5D 舷侧 --hull 也从浅灰压到深灰；亮暗两套主题只换调色板与灯光
- 2.5D `carrier.html` 保留为信息优先的 fallback；3D 版只用于判断「电影感」是否值得进产品，不替换调度

### Added（场景 · 动效工作台）
- **实况页按 `docs/prototype/motion-workbench.html` 重排**：舞台在自己的格子里等比缩放并居中（`zoom`，`k = min(w/1340, h/540)`），Inspector 变成覆盖在舞台上的右侧抽屉；打开抽屉不再挤压 / 裁切舞台
- **时间轴**：记录本次打开后最近 15 分钟的真实状态变化（zone / tone / pose / status 变化才记），可拖动、回放、只看走位；同一秒多个角色变化合并成一片，跨秒记录分两条泳道
- **动效参数外置**：`tier / walk / amp / typing` 存进 `coordination_scenes.config.prefs.motion`，检查器和页头档位改完即时生效
- **检查器**：状态 → 舞台（触发 / 区域 / 姿态 / 动效）、最近一次走位可定位、关闭动效后的等价检查、动效参数与真实操作
- **光照 tab**：同一时刻并排四张舞台（清晨 / 白天 / 黄昏 / 夜晚），点卡片切回实况并写回 `prefs.light`；`dawn` 补进 `CoordinationLight`
- 页头新增动效档位 / 回放状态变化；`?hour=` 隔离预览改成一秒一跳，保留固定起始时段

### Added（场景 · 时段光照与区域划分）
- **舞台光照跟随本地时间**：清晨 / 白天 / 黄昏 / 夜间四档 —— 窗外天空、日月、星空与城市亮灯跟着变；黄昏起顶灯点亮（墙面暖洗 + 地面光斑 + 吊灯光锥），台灯 / 落地灯 / 显示器在夜里提亮
- **区域划分更清楚**：工位区、主控区、审批台、验收架、机房、茶歇区、协调台各有低透明地面色块 + 区域标牌，工位区标牌带当前在座人数
- 场景配置 → 呈现新增「舞台光照」：`自动`（跟随时间）/ `白天` / `黄昏` / `夜间`，随场景存进 `coordination_scenes.config.prefs.light`
- 隔离预览支持 `?hour=22` 固定时段，方便截图核对

### Fixed（知识库 · 整理不再静默改写已审核页面）
- **`wiki.curate` 以前会直接重写所有页面正文**（包括 `reviewed`），而且**一条 revision 都不留** —— 结构整理改坏了只能靠备份。现在只有 `draft` 直接落盘并记 `revision(curate:structure)`；`reviewed` / `stale` 的改动进新的建议队列
- **整理不再删人写的内容**：已有的「要点」条目、夹在「要点 / 相关」里的非列表段落、手写 `[[相关]]` 链接（含前向链接）都原样保留；摘要行不再被当成「原文摘录」
- **建议审核门**（`suggestions`）：提议存完整渲染正文 + `baseHash` + 改动理由；审核侧看逐行 diff，批准 = 纯字节拷贝（不重新调模型）并记 `revision(suggest:<id>)`；页面在这版建议之后改过 → 标 `needs_rebase`，不自动合并；退回记 feedback 留痕
- 插件 API 新增 `wiki.suggestions` / `wiki.suggestion` / `wiki.suggestionResolve`，`wiki.list` 带回 pending 建议；「审核」tab 同时列草稿与建议
- **人工结论（claim）保住「人改的那一句」**：人保存已有页面时把新增的行记成 claim（标题 / 摘要 / 纯双链 / 短句不算，单页上限 40）；整理 / 模型整理若会改写或丢掉其中任何一条，**连 draft 都不自动写**，改成待审建议。判定只有三档（原样 / 改写 / 不见），行级文本 + bigram，不依赖模型；右栏「人工结论」可以看到每条的状态并解除
- 插件 API 新增 `wiki.claims` / `wiki.claimAdd` / `wiki.claimRemove` / `wiki.claimCheck`；`wikiCurateLLM` 落盘前先过 `claimCheck`，会丢结论的页面直接跳过
- **「结论待确认」进审核队列**：`wiki.claimIssues` 按页面聚合 `conflict` / `orphan` 的 claim，`wiki.list` 也带；审核 tab 顶部单列一行（可「查看」/「全部解除」，解除只撤销锁定、不动正文）。以前建议被退回后，右栏的红色结论就再没人提醒处理了
- **人工结论补上生命周期**：接受合并建议时合并草稿接手两边「草稿里确实有」的 claim（`provenance.by="carry"`）；页面进回收站 → claim 标 `orphan` 不删；恢复时按正文重新核对回 `active`。以前删/并之后，人改过的那句话就再没人守了
- `wiki.dream` 退化成 `wiki.maintain` 的兼容壳（默认 dry-run，去掉 `stale-draft` 这种靠时间瞎猜的项），不再有第二套维护入口
- **模型整理（`wikiCurateLLM`）不再直接写页面**：结果变成 `summary` 待审建议（`wiki.suggestSummary`），人看过逐行 diff 才落盘，接受走字节拷贝 + revision；页面在建议之后改过 → `needs_rebase` 不覆盖。缓存改成按「整理前」正文 hash 去重，页面没变不重复花 token
- **漏引用 / 疑似重复也进同一条建议队列**：新增 `wiki.maintain`（确定性扫描，不调模型）+ `⋯ → 查找重复与漏引用`。漏引用判定用 bigram 重叠 ≥ 0.62 且页面还没引用该资料；重复判定要求标题 Jaccard ≥ 0.7 且长度比 ≥ 0.8（或摘要 Jaccard ≥ 0.75）。**接受引用 = 只加出处（正文不动）；接受合并 = 只生成合并草稿（原页面一个字都不动）**；拒绝后 30 天不再提同一条（`sig` 统一节流）
- **`wiki.upsertDraft`（Agent 通道）不再能覆盖 reviewed**：以前它会顺手把 `reviewed` 页面改成 `draft` 并写正文 —— 文档里写的「Agent 不能覆盖 reviewed」因此只是口头约束；现在直接拒绝并提示走审核
- 自检：`npm run wiki:curate:selftest`（计划层：reviewed 分诊 / 幂等 / 不丢行）、`npm run wiki:plugin:selftest`（插件层：假 ctx 驱动真实 API，验字节不变、`needs_rebase` 不覆盖、提议即产物 + revision）

### Changed（人物画像 · 记忆语义）
- **可重算的测量值不再进记忆层**：`describePerson` 的统计结论（话量、句长、接话时延、群/私聊比、活跃时段、高频词……）以前当成事实写进 `observations` 且直插 `confirmed`，绕过了 `resolve()` 的失效逻辑 —— 结果全库 `valid_to` 一条都没写过，同一字段会同时成立「群聊 0%/私聊 100%」和「群聊 1%/私聊 99%」。现在这些值进新的 `measures` 表（只留最新值 + 上一次值 + 变化次数），人物卡多一节「可观测特征」，不再参与冲突/漂移/失效
- **写入收敛到一条闸门 `commit()`**：规则抽取 / 统计 / 模型 / 人工全部走它。同一事实重复观察到时**累加 `evidence_count`**（以前 `addObservation` 直接 `return null`，50 次对话印证过的一句话和模型一次猜测强度完全一样）；单值字段确认后立刻收口同字段旧值；时间敏感事实写 `expires_at`；被拒过的事实攒够两次独立观察才复审
- **四种「忘」拆开**：`invalidate`（`valid_to` 收口，旧值不删、`asOf` 仍可回查）/ `decay`（`heat = confidence × 2^(-天数/半衰期) × log(证据量)`，读时算不落库，事件 7 天、身份 730 天）/ `stale`（TTL 到期归档，进复核队列而不是删除）/ `merge`（近似值建议合并、归一化相同的自动合并，证据累加到保留项）
- **`rejects` 不再永久静音**：又独立观察到两次或距上次拒绝超过 120 天时复审一次，拒绝后计数归零，不会反复打扰
- **注入从「固定字段顺序硬截」改成打分填预算**：`字段优先级 × 热度 × 与问题相关性` 贪心填，每节有配额上限（处事 40% / 性格 30% / 声音 15% / 基本信息 10% / 事实 5%），分节标题也计入预算；`persona_lookup` 会把问题当 query 传下来
- **双时间拆成两种回看口径**：`asOf` 保留「事件时间」（当时什么是真的），新增 `mode:'known'`「当时已知」（`created_at <= at`）—— 2024 年发生、2026 年才得知的事实，在 2024 年的「当时已知」里不该出现

### Added（人物画像 · 生命周期）
- `measures` 表与 `personaMeasures`；`personaSweep`（标 stale，不删）、`personaReview` / `personaReviewResolve`（仍然成立 → 续期；已过期 → `valid_to` 收口）、`personaMergeSuggestions` / `personaMergeApply` / `personaMergeExact`
- **evict 做成读时检索上限而不是回写状态**：多值字段在人物卡里只展示 `heat` 最高的 N 条（`FIELD_CAP`），其余留在库里当证据、不进复核队列 —— 把 400 多条旧语气样本标 stale 会把复核队列灌满，人就不再去清它
- 人物页：卡片多「可观测特征」节（带上次值与变化次数 + 重算时间）、右栏多「衰减与复核」「近似说法」两块、回看支持两种口径、人物头显示证据中位数与「+N 项可观测」，超出上限的分节标「另有 N 条较早」
- **「变了」分成三种**：变化视图里 `drift`（事实被取代）/ `conflict`（同时成立且时间解释不了）/ `trend`（可观测特征变了，不是矛盾）分开标；以前测量值变化只藏在卡片里一行「上次：…」
- **复核可批量**：`personaReviewMany` + 右栏「全部仍然成立」（写回仍是逐条 keep/drop，不删除）
- **启动时扫一次到期事实**（只标 stale），复核队列不用等进「人物」页才出现
- **人物级合并有了入口**：多选 ≥2 人后按钮直接写「合并到『某人』」，观察 / 关系 / 可观测特征并过去、旧名字进 `aliases`，合并完自动跑一遍精确去重（以前只有后端 `personaMerge`，界面上没法用）
- **任务里点名的人会带上画像**：run 启动时若标题 / 描述 / 补充指令里出现联系人名字（≥2 字），注入 ≤600 字画像片段（最多 3 人、敏感项排除）；没点名一个字都不注入。以前画像只能靠 Agent 主动调 `persona_lookup`，等于没人用
- **待确认队列按证据质量分三组**：`quoteVerified` 改成三态（核过 / 核不到 / 没有可用引用），列表头给出「只确认这些」（仅引用核过、非敏感）与「这些直接拒绝」（证据是统计值），敏感项永不进批量动作。本机 142 条 pending = 49 可确认 / 49 核不到 / 44 无可用引用
- **统计特征不再只在建模时产出**：`applyStats()` 成为唯一写入路径，导入完就给「本批发言 ≥10 条」的人算一遍可观测特征（纯统计、零成本）；`npm run persona:stats --apply` 回填历史（本机 118 人 / 1360 项）。以前 264 人里只有 13 人有特征，人物页对绝大多数人是空的
- **存量结论可以回查**：`npm run persona:verify-quotes` 用同一批聊天语料回查旧的模型结论，三类分开报：原话找得到 / **证据其实是统计值**（老提示词把统计喂给模型的后遗症）/ 找不到原话。本机实测 111 条带引用的结论：49 找得到、41 是统计值、8 找不到；前两类已标「引用待核对」，统计值那批在待确认块里单独提示并给「这些直接拒绝」入口
- **建模产出的引用可以核对**：模型说「原话是 X」，X 必须能在它当时看到的样本里找到；找不到就标 `quote_verified=0`、降权 0.6、卡片与待确认队列标「引用待核对」，建模汇总里报「其中 N 条引用核对不到」。不删不拦 —— 但确认前你会看到它
- **建模方法论进到平台里**：新增 `resources/wiki/persona.md`（四种「忘」的判据、measure 与 belief 的分界、建模怎么跑才值、8 条踩过的坑），同时接进 App 内「说明」页（`src/wiki/pages.ts`）和 GitHub Wiki（`scripts/publish-wiki.mjs`）
- **新增 `npm run verify:persona`**：接线自检（人物页 `act("x")` ↔ 主进程动作表 ↔ MCP 工具名，三处手抄，改名字只会静默失灵）+ 导入格式 + 生命周期，一条命令跑完
- **决策辅助不再瞎猜**：`personaAsk` 的兜底原来「命中一个词就算依据」，中文 bigram 下「这个 / 今天 / 同意」到处命中，返回的是一串随机引文。现在要求问题原词（≥3 字）原样命中，或至少 2 个不同词命中且 df 加权分够高，否则明确返回 `found:false`
- **问「他会怎么反应」不再拿语气样本凑数**：没有 decision / conflict / stress / communication 记录时返回 `found:false` 并点名缺哪几项（语气样本回答的是「怎么说」，不是「怎么决定」）
- **一句话概括有时效**：`one_liner_at` + `oneLinerStale`，写完一句话之后又有了新事实/新统计时，人物卡提示「建议重写」（确认待确认事实不算新结论）
- `npm run persona:lifecycle`：临时目录跑四类遗忘语义（失效 / 衰减 / 到期 / 合并）+ 证据累积 + 复审 + 双时间 + 注入预算 + 检索上限，30+ 断言
- `npm run persona:reconcile`：老库一次性对账（统计观察 → measures、单值收口、精确去重、TTL 回填、冲突重算），自动备份、`--dry-run` 在副本上跑
- `npm run persona:preview`：渲染层预览（vite + headless Chrome + mock `window.harness`，不启动 Electron、不抢焦点），跑交互断言并出亮/暗截图到 `.preview/`

### Fixed（UI）
- **`PageHeader` 的 subtitle 用 `<p>` 包 `<div>`**：人物 / 记忆 / 知识库三个页面的头部都传 `subtitle={<div className="notes-stats">…}`，浏览器会提前关掉 `<p>`、把 DOM 拆坏（控制台报 `%s cannot be a descendant of <%s>`）。改成 `<div>`，CSS 已按 class 选择所以样式不变

### Added（记忆 · 写入闸门与注入台账）
- **noise 写入被挡住**：`noteAdd` 现在三条硬规矩 —— 没 `source_ref` 直接拒（`manual` 也得写清谁写的）、超 400 字符拒绝并提示去写页面（以前静默 `slice(0,4000)`）、同一句话去空白标点后哈希去重（重复写不新增行，只 `confidence +0.1` 并换上新来源）。老库自动补 `dedupe_key`
- **注入台账 `inject_log`**：只有 `inject({ runId })` 才落库（记忆页预览不会把「进过上下文」刷成假数据）；run 结束后 `markCited` 拿本轮 assistant 文本回填「这条到底被用到没」，命中就把 `hit_count +1`、`last_hit_at` 更新，进下一次打分。以前公式里的 `log(1+被用次数)` 恒为 0，现在真的有数了（归因很粗，只能分「从没被用过」）
- **`injectionStats()` + 记忆页显示**：最近 20 轮的轮数 / 注入条数 / 被用到条数 / 命中率 / 平均字符
- **晋升边界收口**：`promoteNote` 现在拒绝 `stale` / `rejected` / 已过期 / 无 `source_ref` 的观察（以前只拒 `rejected`，旧结论可以一路抬进每次会话都注入的 L4）

### Added（记忆 · L1 索引）
- **回查不再全量扫内存**：`mem.db` 新增 `transcript_fts`（bigram FTS5）+ `transcript_map`（ref → rowid，用于 upsert）。`openDb` 新增可选 `onTranscript` 钩子，`addMessage` / `updateMessage` / `addEvent` 写入时同步一条；钩子内部包 try/catch，**索引失败不会弄坏业务写入**
- **启动对账而不是全量重建**：`transcriptSync` 清孤儿（会话删了 / 事件是 300 条滚动窗口）+ 补缺失——事件表天然会变少，所以不能拿「条数相等」判断是否重建
- 索引可删可重建（真数据在 `harness.db`）；FTS5 不可用时 `transcriptSearch` 自动回落旧的内存扫，行为不变；片段切在命中词附近（索引的是 bigram、原文在另一列，FTS 自带高亮对不上）
- `npm run db:selftest` 增一节：新增 / 改写消息、新增事件都触发钩子

### Added（记忆 · Dream 合并 / 校正 / 预算 + run_read）
- **`merge`：合并重复观察**（确定性，不调模型）：同 kind 的两条观察，bigram **包含度 ≥ 0.9** 且 token ≥ 4 时产建议；接受后保留 verified / 更新的那条，其余标 `stale`。为什么不用相似度（Jaccard）：短中文句子换个措辞就掉到 0.3，阈值一松就误合并；包含度只认「加词 / 换标点」这类真·同一句
- **`correct`：依据被推翻时回头找观察**：某条结论 `invalid_at` 之后，凡是 `sourceRefs` 支持它的 note 都会产「复核观察」建议（接受 = 标 `stale`，退出注入与晋升队列）。这是「什么应该被推翻」在确定性层面的落地
- **每日建议预算**：`meta.dreamBudget` 按本地自然日计数，默认每天 200 条；用尽后静默返回空，记忆页显示「今日 N / 上限 M」。不花钱但必须有上限——建议一天刷 500 条，人就再也不看复核队列了
- **`run_read`**（IPC `memoryRunRead` / MCP `run_read`）：单个 run 的状态 / 耗时 / token / 错误 + 这轮最多 20 条消息（截断）+ 提到它的关键事件。和 `memory_search` 分工：那个找「哪次提过」，这个看「那一次到底做了什么」

### Added（记忆 · Dream 语义 pass）
- **语义 pass（调模型，默认关）**：一次调用把最近 60 条观察交给模型，找「换个说法的同一件事」（`merge`）和「已经不成立的观察」（`correct`）。三道闸门缺一不可：设置里打开 / 有模型密钥 / 当日模型调用预算没用完（默认 20 次）。**模型说的话不算数**——id 必须存在、merge 的 `keep` 必须落在 ids 里、必须有 reason、同组 id 只入队一次，全部在 `dreamModelSuggest` 里校验；走同一个建议队列与同一个每日建议预算（两笔账分开记在 `meta.dreamBudget`，写的时候一起带上，避免互相覆盖）
- 模型输出解析抽成 `parseDreamItems`（纯函数、可测）：实际见过包 ```json 围栏、前面加解释、直接返回数组三种脏法；解析不出来返回 `null` 以区分「这次没建议」和「乱码」

### Added（记忆 · 渲染层预览）
- **`npm run memory:preview`**：照 `preview-persona` 的做法，vite + headless Chrome + mock `window.harness`，不启动 Electron、不抢焦点。21 条断言覆盖「置顶 / 已失效 · 有新结论取代 / 观察种类与到期 / 注入预览的观察条目与命中率 / 被裁原因 / 两笔预算 / 语义 pass 开关 / 点『标记失效』真的调 `memoryEntryInvalidate`」，并出亮色 + 暗色 + Dream 三张截图到 `.preview/`
- 记忆页细节：观察卡片补种类标签（规则 / 踩坑 / 偏好 / 决定）与「已到期 / 至 MM 月」（完整日期放 `title`，队列行窄，长日期会被截成「存活到 2027/…」）

- **改写建议 `rewrite`**：语义 pass 多一种输出——观察写得太糙时给出改写后的正文。**这是唯一会直接改内容的动作**，所以闸门最严：只对 `status = new` 的观察提（`verified` 是人确认过的，只能走 `correct` / `merge`）；不许引入新事实（新增 token ≤ max(2, 原句 20%)、原句包含度 ≥ 0.5，两条都过才入队）；接受后旧正文先写进 `note_revisions` 再覆盖，随时可回退。建议卡片显示「拟改为」那一版，人看过才生效

### Fixed（记忆 · 注入归因恒为 0）
- **取错了消息角色**：`markCited` 只扫 `role = 'assistant'`，而这个 App 里 Agent 的话是 `role = 'agent'`（`thought` 另算），于是 `cited` 永远是空数组、命中率恒为 0，看起来像「记忆从来没被用过」。改成 agent 的 text + `role = 'tool'` 的实际调用，`thought` 排除（过程独白里什么词都可能出现）
- **判据只有「标题被复述」太严**：拿真实数据（82 条注入、7 轮 run）一跑，强判据命中 **0 次**——run 照着「跑 typecheck」做了，回答里也不会复述那句话。补一条弱判据：从条目文字里抽特征词（反引号片段 / ASCII 命令名，≥5 字），至少命中 `min(2, 特征词数)` 个且最长 ≥6 字才算被用到；同一份数据命中率 0% → 21%
- **旧台账回填**：升级后在启动时把 `cited` 还是空数组、且 run 还能找到的台账补一遍（`logsNeedingCitation`），否则命中率会被旧数据长期拉成 0

### Changed（记忆 · 遗忘语义）
- **四种「忘」拆开**：以前只有一个 `status='archived'`，被「过期 / 删除 / 剪枝 / 冲突」共用。现在 `entries` 增加 `invalid_at / superseded_by / supersedes / valid_from`：事实被推翻时**标失效而不是删除**（旧条目不再注入，但 `entryAsOf(at)` 仍能按时间回看），`entryRestore` 恢复时会一并把新条目上的 `supersedes` 摘掉
- **note 有了类型与存活期**：`kind`（rule / gotcha / guess / preference / decision）+ `confidence` + `expires_at`，按 kind 给默认 TTL（猜测 14 天、偏好 90 天、踩坑 180 天、规则与决定不过期）；人工 `verified` 后清除 TTL，不再自动遗忘。老库自动补列，不用删 `mem.db`
- **`promoteNote` 支持 `supersedes`**：晋升新结论时可以显式声明推翻了哪条旧条目，避免同一主题在 L4 里堆出一串互相矛盾的 active 结论（L4 每次会话都注入，这是「记忆污染」的主要来源）

### Fixed（记忆 · 注入）
- **note 从来没被注入过**：`inject()` 只读 `entries`，Agent 写的观察进不了上下文，Dream 的「晋升」建议等于无源。现在 verified note（≤8 条）与高置信度未验证 note（≤4 条，显式标「未验证」）单独占一块预留预算
- **L1 原文被打进注入**：`layer!='L4'` 把 L1 也算了进去，一条长原文就能吃掉一半预算；现在 L1 硬排除
- **注入排序是手动的**：`ORDER BY sort_order, updated_at` 改成按分数（置顶 50 / 有来源 30 / 层级 / 近两周 10 / 被用过），常数写死不做成配置；每条入选或被裁都能说出原因
- **预算两处不一致**：run 启动写死 6000、UI 与 MCP 用 12000，记忆页显示的「可注入字符数」不是 Agent 实际看到的。现在只有 `meta.injectBudget` 一个来源
- **中文搜不到条目**：`entrySearch` 的整串 `LIKE` 换成 bigram 分词后 AND 匹配（复用知识侧的切分）
- 新增 `npm run memory:selftest`：临时目录跑，断言四类遗忘不串味、L1 不进注入、小预算仍有 note、写入闸门、台账归因、老库补列

## [0.2.0-alpha.3] - 2026-11-14

### Fixed（测试 / 文档）
- **`SC-01` 用例还停在旧场景页**：`ScenePage` 已被 `SceneWorkspace`（场景库 / 实况 / 执行配置 三 tab）取代，用例仍在等 `.scene-page` / `.scene-card` / `.scene-modal`，整轮 e2e 挂着一条红的。重写成对新工作台的断言：三个 tab 都在、场景库有卡、执行配置能写进 `state.scenes`、实况有舞台或空态
- **`docs/ARCH-office.md` 放错位置且没登记**：挪到 `docs/arch/`，补状态头（`部分落地` + 未做清单：作战室/流水线只有模板位、评审门等还没被派活链路消费），修掉两处指向旧路径的链接，并在 `docs/README.md §5` 登记；顺手把 README 里 `ARCH-key-tech` 的状态词从非法值 `进行中` 同步成 `部分落地`。`verify:docs` 现在 0 失败

### Fixed（人物建模 · 统计口径）
- **报错一闪而过，没法定位**：所有 IPC 报错都走 3 秒自动消失的 `toast`（单槽、`white-space:nowrap` + `ellipsis`），报错被截断、被下一条成功提示顶掉，长任务里的失败根本来不及看。新增右下角常驻报错卡（`.errstack`/`.errcard`）：不自动消失、全文可滚动、带动作名 + 时间 + 「复制」、堆 5 条、同句话 10 秒内去重；成功提示继续用 toast。`harness:toast` 里明显是失败/异常的文案也进报错卡；暗色下卡片按 `color-mix(--red, --surface-hover)` 抬高对比，顺带修掉暗色 toast 文字用 `--page-canvas` 的低对比
- **建模静默「0 人出卡」**：`personaModel` 调 `analyzePersonWithLLM` 只认 `process.env.ARK_API_KEY`，从 Finder/Dock 启动的 App 没有这个变量，每人立即 `return null` → 整轮跑完显示「0 人出卡 · 0 条结论」，不计数、不报错（实测：54 人 136 秒跑完，因为一次网都没发）。改为 `arkKeyFromSettings()`（设置里的 `ARK_API_KEY`，回落 `resolveArkKey`）；真缺 key 时直接报错并指路「设置 → 执行 → 模型密钥」
- **分析缓存会被「空结论」永久污染**：旧逻辑只要卡片能解析就写缓存 + 写一句话，模型换输出结构（如 traits 从对象数组变字符串数组）时一条结论都落不了库，之后同一份样本永远命中缓存、卡片永远只有统计事实。现在只有模型真给出可用结论才写缓存；缓存键加入 `ANALYSIS_CACHE_VERSION`（`v2`）+ 模型名，旧版本写出的空缓存自动失效
- **「一键全部建模」被假缓存挡住**：`personaModelPlan` 原来只看「有没有缓存」，样本变了也说「预计 0 次调用」并直接 return；改为与 `personaModel` 共用 `analysisCacheHash`
- **建模失败不可见**：`failed` 从未渲染；完成提示 / 进度卡现在显示「N 人未出结论：首个原因」与「缓存跳过 N 人（前 3 个名字）」
- **`ARCH-key-tech.md` 状态词不合规**：`进行中` 不在 `已落地 / 部分落地 / 提案 / 记录 / 已取代` 里，`verify:docs` 一直红；改为 `部分落地`

### Changed（可读性 · 跟随屏幕）
- **字号整体上调一档**：`styles.css` / `design-system.css` 里 626 条 `font-size` 重排成阶梯——正文 13 → 13.5px，列表主行 12 → 12.5，次级 11.5 → 12，元信息 11 → 11.5，辅助 9.5–10 → 10.5–11。此前 9–11.5px 占了 506/682 条，和 `DESIGN-SYSTEM` 自己写的「中文正文 ≥ 11.5px」不符，也是「整体偏小」的直接原因
- **界面缩放改成默认「自动」**：`uiScale = 0` 时按**窗口所在屏幕**的最长逻辑边取 90 / 100 / 110 / 120 / 130%（4K 原生 130%、2K/2560 120%、1920 110%、小屏 90%），拖到外接屏、改分辨率、插拔显示器都会重算；设置里可固定 80–150%，⌘+ / ⌘- 手动步进、⌘0 回自动
- **窗口默认尺寸跟着屏幕**：`min(1500/980, 90% 工作区)` 并居中，`minWidth/minHeight` 跟着屏幕收（1280 宽的屏不会再让 1180 的最小宽度把人挤到屏幕外）

### Added（任务详情 · 终端区）
- **终端区域新增「任务」视图**：工具栏 `终端 / 任务` 切换，选中任务后能看描述全文、验收清单、最近运行（状态 / 耗时 / token / 错误）、环境（目录 / 分支 / Agent / 终端数）与产物，可「打开会话」「复制详情」；TODO 行内新增「详情」按钮直接切过去。视图只切显隐，**pty 不卸载**（切回终端标签、滚动位置都在），实现见 `src/components/TaskDetail.tsx` + `TerminalPanel` 的 `slotView`
- **任务详情排版**：标题/状态/标签分三层（key·项目·Agent → 标题 → 状态+优先级+标签），操作收到右上；运行记录改成对齐表格（状态 / 结束 / 耗时 / Token / 备注），窄宽度自动折成「一行指标 + 一行备注」；产物同理。布局走**容器查询**：`.task-detail` 默认单列，容器 ≥760px 才上右侧信息栏——终端区常态只有 300–600px，用窗口 `@media` 永远命中宽屏分支。TODO 行标题限两行、行内按钮间距收紧，四个快捷操作不再换行

### Added（统计 · 人物）
- **统计页「本季度」**：自然季度（1/4/7/10 月 1 日起，不是过去 90 天），趋势按周分桶且只画已过完的周、面板标题变「每周运行」，副标题带 `2026 Q4`；`src/components/Views.tsx`
- **人物页「忽略缓存重跑」**：`⋯` 菜单，强制对前 12 人重新调模型（删过结论、或旧版本写出空缓存时用）；`personaModel({ ignoreCache: true })`

### Removed（清理冗余）
- **死代码**：删 `src/components/PreviewPanel.tsx`（375 行，已被 PreviewSurface 取代）；删 20 个无人引用的导出（`missionOfRun` / `missionProgress` / `MAX_EVENT_LOG` / `safeId` / `bumpMemoryVersion` / `SUPPORTED` / `modelCard` / `signatureOf` / `sourceText` / `COLUMNS` / `money` / `FINISHED` / `PanelExpandIcon` / `NoteIcon` 等）
- **死样式**：`styles.css` 删掉 80 条规则 + 6 组里的死选择器（旧 topbar/sidebar/board/detail/kv-* 等原型遗留，~98 行）；`design-system.css` 摘掉 5 个死选择器；删掉不生效的 `.md-flash` 闪烁
- **重复实现**：`timeAgo` 三份合一（`ui.ts` 新增 `relTime`）、`STATUS_LABEL` / `statusTone` 两份合一、`basename` 删掉未用的一份、`main.mjs` 里「选 Agent 并钉到 thread/todo」的重复块抽成 `bindChatAgent`、一行重复注释
- **e2e 脚本**：5 个手抄 CDP 客户端的脚本改用 `scripts/e2e/harness.mjs` 的 `attach()`，共减 ~110 行；顺带修掉两处过期断言（`.page-head` → `.page-header-sub`、`.md-render` → `.md-editor-surface`）
- **静态资源**：删 `public/wiki` 6 个未引用的 svg（124K，构建后还会进 dist）、`resources/icon-gauge.png`、`resources/icon-legacy-y.png`
- **本地构建产物**：清掉 `release/mac-arm64`（747M）、`release/e2e`（9.3M）、`dist-pages`（6.7M）

### Fixed
- **`epub2` 只 import 没声明依赖**：EPUB 导入必然 `parser-missing`，现在补进 `dependencies`（3.0.2），`builtin` 引擎的 epub 能力真正可用
- **`tsconfig` 打开 `noUnusedLocals` / `noUnusedParameters`**：清掉积压的 22 处未用变量/导入，之后不会再长回来
- **Markdown 目录跳转**：`renderMarkdown` 生成的标题 `id` 被 TipTap 丢掉，目录点击定位不到；给 heading 加 `id` 属性（`HeadingWithId`）后恢复
- **可视化编辑器 API 在打包版不可见**：`window.__grapes` 原来只在 dev 暴露，E2E 跑 dist 时拿不到；改为始终暴露（渲染进程内部对象）
- **文档漂移**：`ARCH-settings` 的导航（6 个分区 → 实际 10 个）、「设置搜索未做」、`ARCH-wiki-retrieval` 引用的不存在脚本 `eval-wiki-ask.mjs`、`ARCH-plugins` 的 `net:https` → `net`

### Security
- **资料库默认不再向云端发任何内容**：`createKnowledge` 的 `embed` 默认从 `true` 改成 `false`，云端向量索引改成显式开关（设置 → 数据 → 出网边界，`knowledgeCloudIndex`，默认关）。此前只要求机器上有 `ARK_API_KEY` 或 `~/.pi/agent/models.json` 里有任意 provider 的 key，导入资料就会把**整份文档分块正文**发到火山方舟
- **不再借用别的应用的 key**：`resolveArkKey` 删掉 `~/.pi/models.json` / `~/.pi/agent/models.json` 扫描，只认显式传入与 `ARK_API_KEY`
- **修掉 `wiki.ask` 把整段 dshEnv 当 Bearer**：`resolveArkKey(整个 env 文本)` 会把 `A=1\nB=2` 当成 API key 发出去，现在只解析出 `ARK_API_KEY` 那一行
- **插件 `ctx.api.net.fetchJson` 加权限门**：未声明 `permissions: ["net"]` 的插件直接 `permission denied`（与 `fs:*` / `tasks:*` 一致）
- 资料页侧栏常驻「索引模式」说明，每份资料标「本地索引 / 云向量」，远端解析引擎面板明示「整份文件会上传」；`knowledge:selftest` 新增 `[1.5] 出网边界`（默认模式 fetch 调用数必须为 0）

### Fixed
- **浅色主题文字看不清**：`--faint` 在亮色下只有 **2.52:1**（AA 要求 4.5:1），全应用的小字/辅助信息都靠它。三个亮色主题一起改：`light` faint `#a3a3a3 → #6f6f6f`（5.02:1）、muted `#696969 → #525252`（7.81:1）；`paper` faint `#aaa294 → #6c6659`（5.39:1）、muted `#857e71 → #655f54`；`vslight` faint `#a0a0a0 → #6f6f6f`、muted `#717171 → #686868`。暗色同步把 faint 从 3.78:1 抬到 5.19:1
- 知识库侧栏的资料副标题、分组标题，以及「资料」页文档行的引擎/页数行从 10px 抬到 11px

### Added
- **界面缩放**：设置 → 外观「界面缩放」80–150%，或 ⌘+ / ⌘- / ⌘0（终端聚焦时这组键仍调终端字号）。`setZoomFactor` 整窗生效，启动时按设置恢复
- **窄窗口 / 放大后不再横向溢出**：`body` 去掉 1180px 硬下限（窗口本身已有 minWidth）；工作区四个侧栏按可用宽度等比收缩，固定列保底 140–180px；`≤1080px` 隐藏 TODO/项目头的次要链接与 `≤900px` 再收一级，避免「前 项」「添 加」被挤成竖排；Chat composer 在窄面板下改为换行而不是把模型选择挤出面板

### Changed
- **知识库页不再自带「问知识库」**：问答归 Chat，页头按钮改为「在 Chat 中问」（跳工作区 Chat，预填「只基于本地知识库回答 + 页面引用」）；资料 tab 里保留的只是检索式问答（范围三档 + 页码引用），不再和 Chat 抢心智

### Added
- **模型整理知识库**（`wiki.curate.llm`）：新按钮「模型整理 (N)」逐页调用 Ark 重写摘要与要点，只改这两段、原文摘录与 reviewed 页面不动；按正文 hash 缓存、确认框标页数、结果回显实际 tokens，无 key 时明确报错。纯函数在 `electron/wiki-curate.mjs`，`npm run wiki:curate:selftest`（24 项，加 `-- --ark` 可跑一次真实调用）
- 头部的「整理知识库」改名为「整理结构」，和模型整理区分开：前者免费秒级只重排大纲

### Fixed
- **知识库左栏点一下就置顶**：页面列表内嵌了「最近 4」分组，而 `openPage()` 每次都 `wiki.touch` → `recents.unshift()`，于是点哪页哪页就跳到最前面。现在去掉内嵌分组，列表沿用插件原顺序（新建的在前）并保持稳定，打开页面也不再写 `wiki.touch`（用调试端口在真实数据上复现并验证）
- **人物列表也同样不再跳位**：`peopleList` / `profile` 原来按 `updated_at` 排序，建模或改写「一句话概括」会刷新它，导致刚操作过的人在左栏跳到最前面；改成按 `created_at` + 姓名排，前端刷新时也锁住已有行位置
- **人物导入崩溃**（`people` 表 11 列、INSERT 只给 10 个值）：`one_liner` 列是后来 ALTER 加的，`upsertPerson` 还在用无列名的 `VALUES (?,…)`；改成显式列名，以后再加列也不会再踩
- **资料左栏「集合」顺序固定**：原来按资料顺序取前 4 个 parser，资料一重排集合就跟着挪；现在按数量降序 + 名称固定排序
- **资料列表在任何操作后不再重排**：`listDocuments` 原来按 `COALESCE(indexed_at, created_at)` 排序，而「重新解析 / 换引擎」会刷新 `indexed_at`，于是被操作的那份资料会突然跳到最前面；现在按导入时间排序（`created_at` + `rowid` 兜底），操作只更新索引状态、不再影响顺序
- **勾选集会自动清理已删除的资料**：删除后 `checked` 里残留的 id 会让「只基于勾选的 N 份资料」虚高，现在 `load()` 时对齐现有资料，预览中的资料被删也会退回提问视图

### Changed
- **主库换引擎**：`harness.db` 从 `sql.js`（WASM，每次 persist 整库 `export()` + 写盘）换成内置 `node:sqlite` + WAL；写入走事务与 prepared statement 缓存，`undefined` / `boolean` 参数统一归一化。4720 行的一份库，落盘 p50 **26.8ms → 7.3ms**（`npm run db:bench`）
- **落盘不再可能杀主进程**：`persist()` 定时器内写失败会 rollback + 记日志，下一次 persist 重试；退出时 `flush()` 会把 WAL 合并回主文件再 `close()`，`导出数据库备份` 仍然是单文件
- `sql.js` 从 `dependencies` 移到 `devDependencies`（只给基准脚本用），打包裁剪规则与 `asarUnpack` 的 wasm 条目一并移除
- 新增 `npm run db:selftest`（往返 / 参数归一化 / WAL 合并 / 单文件备份 5 项）与 `npm run db:bench`（sql.js vs node:sqlite 落盘对比）

### Added
- **人物建模**：新增 `electron/persona/model.mjs` + `personaModel` —— 从聊天记录算可观测特征（话量/句长/回复时延/提问与礼貌用语/笑声与表情/活跃时段/高频词/群私聊结构/最常互动的人），带证据原话写入 observations；可选 Ark 生成人设卡草稿（写入 pending）；人物页新增「建模」按钮
- **记忆工具补齐**：条目搜索 / 降级（修正方向 L4→L3→L2→L1）/ 过期-恢复 / 来源查看 / note 晋升 / 批量验证 / 注入预算可调（持久化）/ Dream 可关闭且限制单次建议数 / 整库导出 Markdown；MCP 新增 `memory_entry_write`、`memory_promote_note`
- **人物（原「人像」）改成人物建模页**：左栏人物列表常驻、中间是唯一人设卡、右栏是复核队列 / 变化与矛盾 / 注入预览 / 决策辅助；主 CTA 从「导入聊天记录」改成「确认待确认」，导入收进次级入口
- **人物字段扩到五组**：新增处事方式（`decision` `conflict` `stress` `commitment` `communication`）与说话风格（`style` `voice`）——旧字段全是陈述性事实，回答不了「他会怎么反应 / 怎么说」；旧库不用迁移
- **人物卡 / 注入 / 漂移**：新增 `personaPeople` `personaCard` `personaInject` `personaDrift` 四个动作；卡片每节带 quote 证据与置信级别，敏感观察不进卡也不进注入，注入按预算逐条裁剪
- 左栏导航与文案统一用「人物」，避免和头像 / 人像摄影混淆

### Added
- **微信 key 获取脚本**：`scripts/wechat-key-macos.sh` 串起「Frida Gadget + 调试副本」路线（clone → sip.prepare → keys.hunt → decrypt），`--dry-run` 先看命令、`--yes` 才执行；`docs/product/DATASET-wechat.md` 写清 hardened runtime/SIP 为什么挡住 lldb、以及三条路的取舍

- **知识解析引擎注册与路由（K1）**：借鉴 WeKnora `EngineRegistration` / `NewReader`，新增 `electron/knowledge/engines/`（注册表、路由、独立超时、统一 `Page[]` 归一化）；接入自建 MinerU（V1 + legacy）、MinerU Cloud、自建 PaddleOCR-VL、PaddleOCR-VL Cloud，以及 `custom` / `extras` 自研 HTTP 引擎；知识页新增引擎状态、默认引擎、端点/密钥/超时配置；`npm run knowledge:engines:selftest`
- Super Agent / Mission 模式：主管 Agent（`role=supervisor`）、Plan Card 人工审批、child Todo + Delegation + worker run、Mission 面板与收件箱
- Mission MCP：`electron/mcp-bridge.mjs`（stdio ↔ Main HTTP）+ `mission_plan` / `task_delegate` / `task_review` / `task_steer` / `task_retry` / `mission_finish`
- Mission 调度：worktree 并行、依赖 `blockedBy`、Supervisor/子任务并发上限、Mission 时长预算、取消级联、重启恢复
- `dsh-supervisor.patch.yml`：关闭 dsh 原生 subagent / Team / workflow，保证 Mission 单一调度源
- `npm run verify:mission`：SQLite + MCP bridge + dsh supervisor profile 的 keyless 验证
- 应用内「说明」页 + `docs/guides/USAGE-super-agent.md`：Super Agent 从准备 Agent 到确认 Mission 的完整使用路径、常见问题与限制
- 终端：预览标签可拖入 split 窗格（左/右/上/下），终端右键「在右侧打开预览」；预览成为可拆分的 pane
- 插件宿主：utilityProcess 插件、manifest、命令、事件、storage、设置页、目录安装/启停
- Wiki 内置 first-party 插件：原生 Source / Page / Citation / Review、Memory 顶层索引 + run prompt 注入、Dream 维护检查、CodeMirror 编辑、多 tab、可拖拽左右分屏、布局恢复、搜索、Graph、Wiki MCP tools、任务 / Chat 联动；恢复「打开本地目录」，可浏览 / 编辑 Markdown 并导入为 Source

### Added

- **Chat 进度可见性**：运行状态固定在消息滚动区上方，不再只在「滚到底部」时出现；显示当前阶段（执行命令 / 读取 / 修改 / 搜索）、已用时间、步数、最近动作，可展开完整步骤
- **Chat 对齐 DeepSeek 网页对话**：消息阅读列居中（宽面板最大 760px）、助手 Markdown 支持标题 / 列表 / 引用 / 分隔线、思考过程默认折叠、助手消息底部复制 / 重新生成、空态快捷任务卡片
- **WADE 开发环境迁移**：从 YieldMind 迁入 `.wade.yml`（worktree / feature-plan label / PR 流程 / bot review），模型切换到本机已认证的 DeepSeek，新增 `npm run verify:wade` 预检（配置 / 模型 / label / git 身份）
- **场景工作台**：每个项目一份文字场景配置（worktree / runtime / agent / concurrency / acceptance / notes），支持校验、AI 建议、项目进展与终端总览
- **运行时与终端元数据**：`runtimes` 派生视图（host + CLI + caps + 模式 + 可用性）、`terminals` 持久化（项目 / 任务 / run / agent / cwd / 状态 / exitCode / 最近输出）
- **多 Agent 并行**：普通 TODO 可选多个 Agent，每个独立 run / worktree；终端 Agent 自动开标签；Chat 可选择纠偏目标 run
- **分配预览 / 纯聊天 / 全局进展**：Chat 派活前建议、只聊会话、可选范围的进展 dock
- **场景与 worktree 策略**：`worktree: auto | always | never`，项目 Scene 覆盖全局；任务行可打开 / 清理 worktree
- **Mission terminal child**：Mission 子任务可使用终端 Agent，退出后结算 delegation
- **Wiki 存储拆分**：`wiki-index.json` 轻量 metadata + `pages/<id>.md` / `sources/<id>.txt` 正文分片 + `wiki-search.json` 搜索索引；单页按需读，旧 `wiki.json` 自动迁移并保留 `.bak`；1000 页面实测 list 23ms / search 5ms / 单页 1ms
- **Wiki 增强**：问 Wiki（本地检索抽句 + 引用）、收藏 / 最近、标签筛选、`#tag` 点击、双链 hover / 红链创建 / 反链上下文 / unlinked mentions / 图谱筛选、Markdown/PDF 导出、全量本地导入
- **快速记录独立小窗**：`⌘⇧K` 不切主窗口，剪贴板预填，直接存为 draft
- **统计 / 设置 / 数据迁移**：统计按 runtime 分组；设置增加 worktree 默认与 Runtime 视图；新增 `scenes` / `terminals` 表与 run 的 runtime / worktree_cleaned 迁移

### Added

- **知识视图**：`src/components/Knowledge.tsx` 接上已有知识索引——导入 PDF/Office/EPUB/网页、一条查询同时返回资料与页面、带页码引用的问答；删除资料会把引用它的页面标 stale；新增 MCP 工具 `knowledge_search` / `knowledge_ask`
- **记忆四层 + Dream 五动作**：`electron/memory`（L1–L4 / note / suggestions / rejects），run 启动按预算注入 L4 并可查看「本次注入」；Dream 产出 校正/构建/补洞/晋升/剪枝 建议，接受即执行、拒绝不再打扰；新增 MCP `memory_inject` / `memory_search` / `memory_note_write`
- **人像记忆**：`electron/persona` 导入聊天导出 → 规则抽取进待确认 → 三层画像 / 时间线 / 冲突标记 / 决策辅助（无证据返回未知 + 可用关系）+ MCP `persona_lookup`
- **即时通信网关**：`electron/im`（Telegram 长轮询 + 飞书/微信 webhook 出入站），消息进入同一套会话，结果三段式回传、审批用数字回复；设置新增「即时通信」分区
- **`wiki.ask` 走模型**：有 Ark key 时用知识库页面作候选集生成带引用答案，失败自动回落到检索式

### Fixed
- 修复：终端创建报 `posix_spawnp failed` —— `node-pty` 的 `spawn-helper` 丢失执行位（644）；新增 `scripts/fix-pty-perms.mjs`（postinstall + electron-builder afterPack 都会修）、`npm run verify:pty` 体检，并在 E2E 增加 TERM-01 用例防回归
- 修复：`knowledgeIngestText` 传错字段（text→markdown）导致粘贴资料 0 chunk、搜不到
- 修复：删除资料时页面标过期用 doc id 比 uri，永远不命中；改为按文档 uri/标题匹配
- 修复：`wiki.ask` 模型回答没有 `[[页面]]` 时仍报 found=true，现按引用判定
- 修复：IM 网关启动时若未启用就不再监听，改设置后需要重启才生效；现在 im* 改动会重启网关
- 修复：IM 入站没有出站通道时直接抛错导致消息丢失；现在入站照常落任务，回执可选
- 修复：IM 消息在无可用 Agent 时被丢弃；改为落「待执行」任务并提示等你派活
- 修复：终端 ⚠ 卡住标记按 cwd 匹配会误报；改为 running + todoId 匹配
- 修复：记忆注入预算过小时把 L4 全砍掉；改为至少保留一半预算

- 终端 5 分钟无输出标记 `stalled` 并在标签显示 ⚠；手工终端接入任务可选择保持目录或切到 worktree
- `dshEnv`（含 API key）改用 `safeStorage` 加密存储，启动时自动迁移明文

### Changed

- **Chat 可编辑已发送消息**：用户气泡 hover 出「复制 / 编辑」；编辑后 `⌘Enter` 保存并发送 —— 任务没在跑则按新文本重发（新 run `trigger=edit`，消息重新绑定），正在跑则作为纠偏投递；顺手修掉 `regenerate` 没用上 `lastUser` 导致重跑 prompt 为空的问题
- **编辑后重发不再「结果跑错位置」**：新增 `messages.superseded_by`，编辑时把它之后的旧回答/旧追问软置为已被取代（不删数据），新回答紧跟在编辑后的提问下面，会话里留一条「替换其后 N 条消息」
- **修复存量会话的问答错位**：早期「编辑后重发」只改了文本、没隐藏旧回答，启动时 `repairEditedThreads()` 对每个 edit run 补标 `superseded_by`（幂等、不删数据），历史会话也恢复成「问题 → 新回答」

- **中断收口**：应用退出 / 重启时仍在跑的 ACP run 会被结算为 `interrupted`（退出时立即结算，启动时兜底扫描），`endedAt` 用最后一条消息时间，任务回到待执行并在会话里留一条 system 说明 —— 不再出现永远「进行中」的僵尸 run

- TODO 收敛为 4 组（待执行 / 进行中 / 待确认 / 已完成），新增「待处理」筛选；等待输入置顶高亮，已完成组可撤销确认
- 移除独立收件箱页，待确认 / 失败 / 等待输入统一进 TODO「待处理」；导航与设置里的收件箱入口同步移除
- 终端新增「＋ Agent」：不先建任务即可起原生 CLI Agent；终端可「接入」当前选中任务，运行进入 TODO
- 任务行显示当前 / 最近 run 的 worktree 分支与路径，点击在 Finder 打开
- 预览 Surface 补齐后退 / 前进 / 停止 / 硬刷新 / 缩放 / 页内查找 / DevTools / 外部打开 / 设备宽度
- LLM Wiki：停笔 1s 自动保存；删除页面 / 资料进回收站，可恢复或彻底删除；`⌘⇧K` 全局快速记录；中文按字模糊搜索；`#标签` 补全
- **Wiki 视觉收口**：页面改用 `PageHeader`，低频动作收进 `⋯`；左栏 / 编辑面 / 右栏合成一个主面（hairline 分栏）；编辑器改无衬线单栏 660px、隐藏行号、取消整行高亮；字数与保存状态下沉到底部状态条；右栏统一中文标签与 tabular 数字；图谱按 页面 / 资料 / 文件 分级着色
- **Wiki 页头找回常用动作**：导入资料 / 生成 Wiki / 整理 Wiki / 问 Wiki 回到页头直接可见，`⋯` 只留本地目录 / 图谱 / 记忆 / 分屏 / 导出（仍只有一个 primary）
- **全站视觉收口**：语义色 / 中性色 / 圆角全部改走 Design System token（`--green/--amber/--red/--purple`、`--radius-*`、`--surface-hover`、`--faint`），暗色不再单独硬编码；选中与运行色从蓝色收成中性 `--brand`；`.page-head` 标题统一 22px；按 CDP 文本审计把 13 处内容型中文提到 ≥11.5px
- **Chat 思考与工具可读**：`tool_call` 消息首行改成 `Bash · 完成 · ls -1`（状态中文化、带命令/路径），把 `tool_call_update.content` 里的输出并入正文；思考过程（`agent_thought_chunk`）从折叠工具组拆成独立「思考」块，默认两行可展开
- **Chat 详情面板可拖选**：展开后冻结计时、历史行按 10s 粒度刷新，展开时把面板带进视野 —— 拖选文字不再被每秒重渲染打断
- **Chat 详情更有料**：老消息的 `bash · completed` 在渲染时归一化成「Bash · 完成」并补上命令/路径第二行；默认最近 6 步，可「看全部」展开该 run 的所有步骤
- **Chat 运行中进展可见**
## [0.2.0-alpha.2] - 2026-11-07

### Added

- **Git / Source Control**：独立 Git 页（分支 / ahead-behind / 暂存 / Diff +N -M / 提交（⌘Enter）/ Amend / 推送 / 拉取 / 分支切换与新建 / 最近提交 / 非仓库一键 init）；右侧栏新增 Git 迷你面板（会话历史旁）；资源管理器带 git 装饰（修改·新增·暂存·删除着色，`.gitignore` 文件与目录淡色斜体，目录有改动显示状态点）
- **文件预览**：Markdown 富文本 / 源码切换 + 目录（TOC，跳过代码围栏，点击跳转高亮）；HTML 预览 / 可视化 / 源码三段，可视化内建 **GrapesJS** 画布（拖组件、改文字、调样式，保存回写完整 HTML 并保留 head，CSS 写入唯一 `<style data-grapes>`；懒加载）
- **缺模型密钥的可操作引导**：Chat 错误卡片列出要设的环境变量与两种配法，一键跳到 设置 → 执行 → 模型密钥 并聚焦；设置里新增 `dshEnv`（KEY=VALUE 注入本地 dsh）；统计页失败行也可直接去配置
- **设置易用性**：跨分区搜索（⌘F，命中跳转并高亮）、逐项「恢复默认」、本页恢复默认、「已自动保存」提示、分区 ↑↓ 导航
- **主机与统计**：主机 caps 探测 / 页面可见时心跳 / 主机级并发 / Agent 运行位置；统计改为运行健康口径（成功率 / 中位耗时 / 排队 p50 / Token（未上报不写 0））+ 趋势 + 4 类失败 + 分组 + 下钻 + CSV
- **TODO**：多行收集箱批量建任务（去前缀/去重/上限 100）、行内编辑（标题/描述/验收/优先级/截止/标签）、分配执行 Agent、「问清楚」预填 Chat

### Fixed
- **Wiki/Chat 顺序相关修复**：`recoverMissions` 把 todoId 误写进 `messages.run_id`，导致会话出现 `run-divider t168` 假分隔条与孤立系统消息（改为写 run.id，启动时清理历史遗留）；安装脚本对残留进程补 SIGKILL，应用加单实例锁，避免旧窗口一直显示旧界面
- **进展条回到消息流末尾**：发完问题后进展不再出现在面板顶端（和提问之间隔着上一轮回答），改为紧跟最新一条消息，回答就落在同一位置；顶部只保留头部的「进行中 · 停止」

- 切到收件箱 / 统计再回工作区时终端丢失（工作区改为常驻挂载、只切显隐）
- TODO 编辑提示文案移除（保留双击 / ⌘E 与行内「编辑」按钮）

### Changed

- 产品名统一为 **Cockpit Harness**（窗口标题 / 安装包 / ACP 客户端标识），旧 userData 与 `ymh.*` 本地键自动迁移
- 依赖升级：electron 45 / TypeScript 7 / Vite 8（rolldown）
- 文档：`docs/arch/ARCH-hosts-stats.md`、`ARCH-git.md`、`ARCH-terminal-ux.md`（预览与可视化）、`ARCH-settings.md`（易用性）；知乎文章与对比截图改为本地素材不入库

## [0.2.0-alpha.1] - 2026-11-06

首个公开 Alpha，代号 **Liftoff**。

### Added

- Chat 分派 → TODO → Agent run 的完整闭环；支持 steer / 排队 / 停止 / 重试
- 终端：多标签、任意窗格拆分、拖拽比例、窗格焦点切换
- 终端：查找高亮、右键菜单、链接打开、字号缩放、退出重启、挂载前输出回放
- 预览：dev server 预览与本地 HTML 文件共用一个 `PreviewSurface`，支持渲染/源码切换、元素拾取
- 文件预览：Markdown 渲染（marked + DOMPurify）、HTML sandboxed webview、相对文档链接跳转
- 资源管理器：右键菜单、新建/重命名/复制/删除/Finder/在终端打开、行内编辑
- 项目 / 收件箱 / 统计 / 主机 / 设置五套页面；Rail 带未读徽标
- 统计：项目范围切换、按 Agent/项目/主机分组、失败分类、CSV 导出
- 主机：SSH 添加/编辑/探测、并发上限、Agent 运行位置切换
- 命令面板：命令 + 任务 + 会话全局搜索、分组、上下文安全调度
- 设置：终端字号/回滚、模型选择、预览地址、数据备份/恢复
- 深浅色主题、柔和卡片化布局、窄视口工具栏降级
- GitHub Actions 三平台打包与 Release 附件

### Changed

- Chat / Terminal 的工具栏与状态提示统一为低饱和、紧凑风格
- 终端 split / 文件预览切换不再重建 webContents，减少白屏与重新加载
- ACP 审批支持完整 optionId，显示审批队列；模型按会话保存
- 主机并发输入改为失焦/Enter 提交，避免逐字符写库

### Known limitations

- Alpha 阶段：数据库 schema / IPC / UI 仍可能变更，升级前请备份
- 未做代码签名 / 公证；macOS Gatekeeper 与 Windows SmartScreen 会提示
- 未实现：附件/图片粘贴、消息重新生成、文件树多选/拖拽、会话置顶/删除、run 日志详情、自定义快捷键
- Linux 构建为 x86_64；macOS 首发为 Apple Silicon（arm64）
