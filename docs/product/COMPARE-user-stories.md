> 层：需求 · 状态：记录 · 核对：2026-11-22 · 覆盖：以用户故事为单位对比 Cockpit Harness 与 Orca、Multica、ZCode 的功能覆盖、真实差异与差距

# 竞品对照 · 用户故事级

**一句话结论**：四个产品都能"把活派给 Agent"，但落点完全不同 ——
Orca 是**并行执行环境**（worktree 即工作台），Multica 是**团队管理面**（人 + Agent 共用一个看板），
ZCode 是**单模型官方 Harness**（GLM-5.3 + 长任务目标模式），
Cockpit Harness 是**本地编排 + 可审核知识**（Mission 编排 + Wiki/记忆/画像都在同一个 SQLite 里）。

四家的差别不在"有没有 Agent"，而在**这句话之后谁负责收口**：Orca 收到 PR、Multica 收到任务状态、ZCode 收到目标校验、本项目收到 TODO + 可引用页面。

> 另一个方向的对照（自托管 AI 同事：常驻电脑 + 日程 + 多端）见 [`COMPARE-rakazo.md`](COMPARE-rakazo.md)；知识与记忆专项见 [`COMPARE-knowledge-memory.md`](COMPARE-knowledge-memory.md)。

---

## 0. 口径与图例

| 项 | 说明 |
|---|---|
| 快照日期 | 2026-11-17；**2026-11-20 用源码复核**（Orca `8e0c267e` / Multica `58b5c66` / ZCode `fec97590`），**2026-11-22 用 Orca Bot 配置页实机与 bot 实现回填**（本项目新增模板 / 技能 / handoff / 记忆整理，详见 [`REQ-bot-intelligence.md`](REQ-bot-intelligence.md) §7.1）。竞品迭代以周计，**本表是快照，不是实时承诺** |
| 依据 | 只读官方材料：官网、docs、产品内文档；未抓社区文章与外部分析 |
| 本项目依据 | 代码 + [`README.md`](../../README.md) + `docs/arch/ARCH-*.md` 的状态头；与 README 冲突时以代码为准 |
| 用户故事写法 | 每条一句话，括号里是**判据**（做到什么算这条故事成立） |

**图例**

| 符号 | 含义 |
|---|---|
| ✅ | 原生支持，开箱可用 |
| ◐ | 部分支持，或需要绕行（终端里手敲 / 靠 agent 自身约定 / 只在某一路径可用） |
| ✗ | 官方文档与产品里没有这个能力 |
| ？ | 官方文档没写明，本次**未验证**（不敢当结论用） |

---

## 1. 四家是什么

| | Cockpit Harness | Orca | Multica | ZCode |
|---|---|---|---|---|
| 一句话 | 本地多智能体终端 + Mission 编排 + LLM Wiki | Agent Development Environment（ADE） | 人和 Agent 共用的项目管理 | 智谱官方 Agentic DE（GLM 专用） |
| 形态 | Electron 桌面，本地 SQLite | 桌面（mac/win/linux）+ 移动伴生 | Web 工作区 + 桌面/移动客户端 + 自托管 | 桌面 + 手机远控/IM Bot |
| 执行体 | dsh（ACP）+ pi/claude/codex/opencode（pty） | 45 个 CLI Agent 目录项（源码 `agent-catalog-entries-*.ts`），各自订阅 | 连接电脑上的 daemon 调本机 CLI | 自研 ZCode Agent + GLM-5.3 |
| 隔离单元 | worktree（auto/always/never） | worktree（一等公民） | worktree（**可选**，缺省 `in_place` 串行） | worktree（新建任务可选新 worktree，fork 带未提交改动） |
| 收口物 | 待确认 → TODO 已确认 | PR / diff 批注 | 任务状态 + 评论 | 目标校验通过 |
| 开源 | MIT | MIT（stablyai/orca） | source-available（multica-ai/multica） | 开源（zai-org/ZCode） |

---

## 2. A 入口与纳管

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-01 | 在一个界面里纳管多家 Agent CLI（不用为每家用一个 App） | ✅ dsh + pi/claude/codex/opencode | ✅ 27 种 | ✅ 26+ 种 | ✗ 只有 ZCode Agent |
| US-02 | 让 Agent 在远程机器上跑，断线不换机（run 不漂移） | ◐ SSH 主机卡片 + 运行位置切换；远程 supervisor 未做 | ✅ SSH / orca serve / 每工作区云 VM | ✅ daemon 在线领取，绑定不转移 | ✅ SSH / WSL / Docker |
| US-03 | 看清模型、账号额度还能跑多久 | ◐ 每会话选模型；统计不估算费用 | ✅ 额度 + 重置时间 + 多账号切换 | ◐ 费用/token 统计，非额度 | ✅ Coding Plan 用量 |

**差异**：Orca 与 Multica 都把"用哪家 Agent"当可插拔（也顺带把额度可见做成了刚需）；
ZCode 反向做深（只有一个 Agent，但模型/推理强度/执行模式都可调）。
本项目的独特点是 **ACP 结构化 + pty 两条执行路径并存**，代价是 CLI 覆盖面窄。

---

## 3. B 任务与协作

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-04 | 一句话变成一条可追踪的任务，结果回到原任务上 | ✅ 会话→TODO，未派活对话为全局 | ◐ 任务挂在 worktree 上，状态较轻 | ✅ 任务有描述/评论/状态/运行记录 | ✅ 任务列表 + 分组/时间线 |
| US-05 | 状态不是自由填，按流程规定，且自动交接给下一步 | ✗ 状态分组 = 看板，无工作流 | ◐ workspace-status（todo/in-progress/in-review/completed） | ✅ 工作流：列 + 交给谁 + 完成后/打回 | ✗ 无 |
| US-06 | 人和 Agent 在同一个工作区，有成员、角色、@ | ✗ 单人本地（团队 P2 未做） | ？ 有 Enterprise 页，权限模型未核实 | ✅ 成员/角色/Access/@/收件箱 | ✗ |
| US-07 | 把活交给一支小队，由 leader 决定分给谁 | ◐ Mission supervisor 分派 worker，非花名册路由 | ✅ coordinator 跑 worker（orchestration） | ✅ 小队：leader + 成员 + 派活评论 + evaluation | ✗ |

**差异**：这一组是 Multica 的主场 —— 它把"派活"当成组织问题（谁有权调用谁、下一步交给谁、打回退到哪）。
本项目的 Mission 是**流程问题**（计划 → 批准 → 子任务 → 汇总），缺的是 Multica 那种"人和 Agent 同列花名册"的组织语义。
US-06 全表唯一硬空：本项目连成员概念都没有，因此 US-05 的"交接给成员"也无从谈起。

---

## 4. C 执行与干预

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-08 | 对话即执行，工具调用/命令/改动可见 | ✅ thread + 按 run 分组 + 模型可选 | ✅ 结构化 chat（子集），其余走终端 | ✅ 评论流 + 执行日志 | ✅ 会话 + 变更行数 |
| US-09 | 跑到一半能纠偏，且知道有没有真的送达 | ✅ 回执三态（投递中/已注入/失败·重发） | ◐ 终端直接打字 / 排队消息 | ◐ 评论 @ 触发新运行，不是 steer | ◐ 待发送队列 + 编辑历史消息 |
| US-10 | 多个 Agent 并行互不踩文件 | ✅ worktree auto/always/never | ✅ worktree-native | ◐ worktree 模式可并行；缺省 `in_place` 时第二任务排队（`waiting_local_directory`） | ✅ 任务级 worktree（`managed-worktrees`；`docs/git/worktree.md`） |
| US-11 | 高风险操作先问一句，且能选"总是允许" | ✅ ACP 审批弹窗 + 自动批准/拒绝开关 | ◐ 透传 CLI 自身的 bypass 权限 | ◐ 受 CLI 自身行为约束 | ✅ 四档执行模式 + 四类决策 + 提问超时 |
| US-12 | 长任务设个目标，自动续跑到验收 | ✗ 无 /goal 式续跑（Mission 是另一层） | ✗ 靠 CLI 自身 | ✗ 一次运行结束即结束 | ✅ /goal + 每轮实据校验 |
| US-13 | 把一段活丢给独立上下文的子智能体 | ◐ 依赖 dsh 原生能力，宿主未开配置界面 | ✅ supervisor/worker + nested depth | ✅ 小队（但非独立上下文） | ✅ general-purpose / Explore / 自定义 |
| US-14 | 一句话目标 → 计划 → 人工批准 → 子任务执行 | ✅ Mission：计划卡 + 批准 + Delegation + 汇总 | ◐ orchestration（实验）有 Run/决策门 | ◐ 小队 leader 派活，无计划审批 | ✗ 有计划模式，无私生子任务编排 |

**差异**：
- **US-09 是本项目最干净的一处领先**：四家里只有我们把"纠偏有没有送达"做成可见状态。Orca/Multica 都是"再发一条"，ZCode 是"编辑上一条"，只有本项目区分"已注入 / 排队到下一轮 / 投递失败"。
- **US-12 是本项目最该抄的一条**：ZCode 的目标模式把"继续"从人的动作变成校验动作（没实据不算完成、有待办就不判完成）。本项目的对应物是 Mission 的人工批准，粒度粗一档，普通单 Agent 任务完全没有长跑收口。
- **US-11 两边哲学不同**：本项目按 ACP 选项渲染（允许一次/总是允许/拒绝），ZCode 是任务级的四档执行模式（变更前确认/自动编辑/计划模式/完全访问）。后者更"一次性说清"，前者更"每次都说清"。

---

## 5. D 审阅与交付

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-15 | 逐行审阅 Agent 改动，批注一次性发回 Agent | ✗ 有 diff 查看，无行内批注发回 | ✅ annotate AI diff + 批注跟随行 + 批次发送 | ✗ 交回 GitHub 审 | ◐ Review 面板 + 撤销本轮文件改动 |
| US-16 | 提交、切分支、开 PR 不离开应用 | ◐ 暂存/提交/推拉/切分支；无 PR 创建 | ✅ GitHub/GitLab/Bitbucket + Linear/Jira | ◐ GitHub 集成、PR 状态回写 | ◐ Git 图谱 + 切换/新建分支，只读图 |
| US-17 | 真实终端，多标签与任意拆分 | ✅ node-pty + 回放 + 二进制拆分 | ✅ xterm，split 与标签 | ✗ 无终端 UI | ◐ ADE 内含终端 |
| US-18 | 在应用里读和改文件（Markdown/代码/图片/PDF） | ✅ TipTap 富文本 + GrapesJS + 源码保存 | ✅ Monaco + 富 Markdown + 多格式查看 | ✗ 只读浏览 | ◐ 文件树 + 预览（PDF 等） |

**差异**：这一组 Orca 明显更成熟（编辑器 + 批注 + hosted review 是一条完整链路）。
本项目的落点是"看 diff + 提交"，没有把审阅意见变成 Agent 的输入 —— 而美国 15 恰恰是"人在环上"最值钱的一步。
US-17 本项目不落后（任意深度拆分 + 挂载前输出回放是细节优势）。

---

## 6. E 上下文与知识

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-19 | 浏览器里我点一下，Agent 就知道是哪个元素 | ✅ 元素拾取注入 `<ui-context>` + 10 个浏览器工具 | ✅ Design Mode + browser-use profiles | ✗ | ✅ 元素选取 + Agent 驱动浏览器 |
| US-20 | 资料进来 → 变成可引用、可审核的知识 | ✅ Source/Page/Citation/Review + 整理 Wiki + 图谱 | ✗ 只有编辑器里的 Markdown | ✗ | ◐ 代码库 Wiki（架构导读，非资料库） |
| US-21 | 该记住的记住、该忘的忘掉 | ✅ 四层记忆 + Dream | ◐ 靠 agent 自身 hooks/记忆文件 | ✗ | ✅ 项目级 Memory（Markdown 事实文件） |
| US-22 | 从对话里推断"这个人是谁" | ✅ 人物画像 + 预览 | ✗ | ✗ | ✗ |

**差异**：US-20 与 US-22 是**本项目独有**的两条；US-19 三家都有，但侧重点不同 ——
ZCode 的浏览器是"Agent 自己验证改动"（改完页面自己点一遍），本项目是"人把看到的东西喂给 Agent"。
US-21 值得对照：ZCode 的记忆是 `~/.zcode/.../memory/` 下的普通 Markdown + `MEMORY.md` 索引，默认关闭、按项目隔离、可在对话里"记住/忘掉" —— 与本项目的"四层记忆"相比简单得多，但**可读可改可删**这一点值得学。

> US-20 / US-21 只在本篇做横向占位：**知识**已与本篇之外的 WeKnora 逐条比过，**记忆**已与 Anthropic 的三层机制（应用 summary / Claude Code auto memory / API `/memories`）逐条比过 ——
> 见 [`COMPARE-knowledge-memory.md`](COMPARE-knowledge-memory.md)。那一篇里 US-M05（推断过闸门）与 US-M08（按项目隔离）这两条缺口，本篇矩阵看不出来。

---

## 7. F 自动化与扩展

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-23 | 定时或外部事件触发，我不在场也能跑 | ✗ 只有"每日模板"手动生成 | ✅ cron/RRULE + 立即/暂停 | ✅ cron + Webhook + 任务唤醒 | ✅ 定时任务 + 闲时免费队列 |
| US-24 | 把方法沉淀成技能/插件/命令/钩子 | ◐ 插件 + MCP 桥（wiki/mission/browser）；无 SKILL.md | ✅ skills registry + MCP + CLI | ✅ Skills（可导入 GitHub/ClawHub，可刷新） | ✅ 插件市场：Skill/Command/子智能体/MCP/Hook 打包 |
| US-25 | 人不在电脑前也能收到，并回一句 | ✗ 无系统通知/收件箱；飞书网关部分落地 | ✅ 完成通知 + Inbox + Dock 徽标 + 移动 | ✅ 收件箱 + 订阅 + 微信/飞书/Slack/钉钉/Telegram | ✅ 手机扫码远控 + 微信/飞书 Bot |
| US-26 | 用量、成本与失败原因能对账 | ✅ 成功率/中位耗时/失败四分类/CSV（不估算费用） | ✅ 额度与重置时间 | ✅ 费用估算 + token + 错误页签 | ✅ Coding Plan 额度与工具调用 |

**差异**：US-23 与 US-25 是本项目**最实际的两个缺口**：任务能派出去，但"跑完了没人叫我"。
ZCode 的"闲时任务"是个有意思的设计（排队等算力富余、免费执行、分段续跑），本质是把"不着急的活"变成队列资源；本项目连"着急/不着急"这个维度都还没有。

---

## 8. G 形态与体验

| # | 用户故事（判据） | Cockpit | Orca | Multica | ZCode |
|---|---|---|---|---|---|
| US-27 | 界面按我的习惯长（主题/布局/命令面板） | ✅ 13 主题 + 可拖拽可收起 + ⌘K | ✅ 主题插件 + split + Quick Open | ✅ 主题/快捷键/偏好 | ✅ 命令中心 + 主题 |
| US-28 | 选部署形态：本地 / 云 / 自托管 / 团队多租户 | ◐ 只有本地桌面（mac/win/linux） | ✅ 本地 + 自托管 server + 云 VM | ✅ Cloud + 自托管 | ◐ 桌面 + 远控，无自托管 |
| US-29 | 一屏看懂"现在谁在干什么" | ✅ 场景/办公室舞台（角色按真实状态投影） | ◐ Agents 标签 + 状态点 | ◐ 看板 + 运行状态 | ◐ 任务列表 + 运行状态点 |

**差异**：US-29 本项目的"办公室"是四家里唯一的**空间化**表达（把 run/审批/验收/茶歇投影成舞台）；
Orca/Multica/ZCode 都还是列表 + 状态点。这条属于叙事优势，不是工程护城河。

---

## 9. 结论

### 9.1 三个真差异（别人短期不会补）

1. **纠偏可回执**（US-09）—— 把"注入成功"与"排队到下一轮"分成两种可见状态，只有本项目做。
2. **可审核知识**（US-20）—— Source → Page → Citation → Review 是一条闭环，Orca 没有知识层，ZCode 的 Wiki 是代码导读、没有审核。
3. **人物画像**（US-22）—— 四家里唯一把它当产品能力而非 prompt 技巧。

### 9.2 六个该补的缺口（按性价比排序）

| 优先 | 缺口 | 对照对象 | 说明 |
|---|---|---|---|
| P0 | 完成即通知 + 收件箱（US-25） | Orca / Multica | 现在只有审批弹窗；「跑完没人知道」会直接吃掉并行的收益 |
| P0 | 定时/事件自动化（US-23） | Orca / Multica / ZCode | 已有 tasks/agents/run 全套骨架，差的只是触发层与运行历史 |
| P1 | 长任务目标续跑（US-12） | ZCode | 不必照抄成功学，抄"没有实据不算完成"这一条校验即可 |
| P1 | diff 行内批注发回 Agent（US-15） | Orca | 审阅意见目前在人的脑子里，不在 Agent 的上下文里 |
| P2 | 技能包体系（US-24） | ZCode / Multica | 现在只有插件，缺 SKILL.md 这种"跨 Agent 复用一段方法"的粒度 |
| P2 | 子智能体配置界面（US-13） | ZCode | dsh 原生有 subagent，宿主没开出来，等于只有内部人才用得上 |

### 9.3 三件不建议照抄

1. **27 种 CLI 全覆盖**（Orca）：每多一个 CLI 就多一条 pty 语义与完成信号的分叉，与本项目"ACP 结构化"的主线冲突；用插件 + 探测扩展更合适。
2. **完整浏览器 + 登录态导入 + 移动模拟器**（Orca）：预览的定位是"人喂上下文 + Agent 自检"，不是替代浏览器。
3. **团队多租户与工作流交接**（Multica）：本项目是单人本地编排，一旦引入成员/权限/交接，[`ARCH-multi-agent-workspace.md`](../arch/ARCH-multi-agent-workspace.md) 里"run 必须绑定 todo+agent+host"的不变量要重写一遍，成本远高于收益。

---

## 10. 来源与未核实项

**读取过的官方材料**（2026-11-17）· **源码副本**：`third-part/{orca,multica,ZCode}`（2026-11-20，本地只读，整个目录 git 忽略、不入库）

- Orca：<https://www.onorca.dev/>、<https://orca.dev/docs>（worktrees / native-chat / orchestration / automations / annotate-ai-diff / design-mode / ways-to-run / skills / mobile / notifications / usage-tracking / worktree-checkpoints / review-github）
- Multica：<https://multica.ai/>、<https://multica.ai/docs/zh/*>（concepts / how-multica-works / issues / tasks / workflows / squads / skills / autopilots / daemon-runtimes / environments / project-resources / assigning-issues / analytics）
- ZCode：<https://zcode.z.ai/cn/docs/*>（welcome / agents / goal / browser-use / task-management / repo-wiki / memory / automations / idle-time-tasks / remote-development / remote-control / bot-channel / subagents / plugin / skill / safety-confirm / edit-history / ADE-tools）

**明确未核实（不要当结论引用）**

1. Orca 的团队/权限模型（只有 Enterprise 页面，未读到权限文档）—— US-06 记 `？`。
2. ~~ZCode 是否支持多任务并行与目录隔离~~ —— **2026-11-20 源码复核已确认支持**：`packages/ui/src/managed-worktrees/` + `docs/git/worktree.md`（新建任务可选 worktree、fork 带未提交改动、删除租约）。US-10 已由 `？` 改为 `✅`。
3. Multica 桌面端是否有本地 diff 视图（只确认了 GitHub 集成与执行日志）。
4. 各家的实际并发上限、单 run 时长上限与失败重试次数（只有 ZCode 的定时任务"最多 20 条"是明确的）。

**源码复核带来的三处更正**（2026-11-20）：Orca 的 Agent 目录项是 **45** 个（原写 27，来自官网文案）；Multica 的 worktree 是**可选模式、缺省 `in_place` 串行**（原写"任务即 worktree 默认"，源码见 `packages/core/types/project.ts:150-172`）；ZCode **有**任务级 managed worktree（原写"无 worktree 概念"）。

**怎么更新这篇**：竞品发版后按"改一行结论 + 改快照日期"的方式维护；有源码副本时优先读源码——上面三处更正全部来自源码，官网与文档都没说清；本文只记结论与判据，不抄功能清单 ——
功能清单会在一个季度内全错，判据不会。


---

## 2026-11-22 刷新（只记增量，不改原表）

- **Orca Bot 配置**：单页行式（智能体 / 权限 / 电脑 / 启用 / 条目 / 灵魂 / 记忆 / 连接器 / 谁可以提问 / 工具 / 技能 / 通知 / 删除）；每行写当前值，点进去才是编辑。本项目已把设置收敛到 5 个 tab（身份 / 能力 / 记忆 / 自动化 / 规则），并把「工作」放回会话列。
- **本项目 bot 新增**：模板（早报 / 发布守护 / 答疑 / 运行观察）、5 个内置技能、群聊一跳 handoff、记忆整理归档、人格历史 + diff + 并发冲突、per-bot 通知开关。
- **不改变本表结论**：工作台 / 并行执行 / 任务收口这三条主线仍是 Orca 领先；本轮补的是「bot 像个同事」那部分，细节看 `REQ-bot-intelligence.md`，不把 bot 能力混进工作台评分。
