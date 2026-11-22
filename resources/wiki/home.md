# Cockpit Harness

> 多智能体终端 / Super Agent / LLM Wiki：把一句话变成任务，让 Agent 在真实项目里执行；Mission 负责组织，Wiki 负责沉淀，人只负责确认。

![多智能体工作台](./wiki/cover-multi-agent.png)

*图：Chat 派活、真实终端、任务看板和执行现场在同一个窗口里。*

## 从六个终端说起

桌面上同时开着六个终端：一个跑 Agent，一个跑 dev server，一个在看日志，一个在 `git diff`，另外两个是“等会儿可能要用”的备用标签。Chat 窗口在另一个屏幕，任务清单在一个 Markdown 文件里。

半小时后，人开始记不清：

- 哪个 Agent 还在跑？
- 哪个已经改完了？
- 刚才那句“把按钮改成蓝色”，到底发给了哪个会话？
- 改完的文件在哪个 worktree？

最崩溃的不是切窗口，而是**状态全靠人脑维护**。

Cockpit Harness 的起点就是这句话：能不能把「对话、任务、终端、Agent 运行状态」放进同一套系统里，让多个 Agent 并行干活，而人始终知道发生了什么。

## 它是什么

它不试图替代 IDE，也不把 Agent 循环塞进产品本体。它更像一个多 Agent 编排工作台：

- **Chat 是唯一入口**：说一句话派活，运行中继续说话就是纠偏。
- **TODO 是唯一看板**：排队 / 运行 / 等待输入 / 待确认 / 已确认都在一条列表里。
- **Terminal 是真实执行现场**：node-pty 拉起真实 shell，可多标签、可拆分、可直接输入。
- **项目就是本地目录**：一个目录一个项目；git 仓库会自动使用 worktree 隔离。
- **执行引擎外置**：Agent CLI 通过适配器接入；目前 Chat 派活走 dsh 的 ACP profile。
- **场景是运行状态的空间投影**：办公室 / 作战室 / 航母只读现有状态，不新建表、不伪造任务。
- **知识库与记忆分开**：资料只读、页面可审核；记忆是四层 + Dream；人物画像是另一套库。
- **LLM Wiki**：笔记插件把资料变成可追溯的 Source → Page → Citation → Review，Agent 可检索、人负责审核。
- **数据本地**：SQLite + 本地文件；模型配置和凭据不随 App 分发。

## 五个主打特性

<div class="wiki-gallery">
<figure><img src="./wiki/cover-terminal.png" alt="多智能体终端" loading="lazy" /><figcaption><b>多智能体终端</b><span>Chat / TODO / 真实 PTY / worktree</span></figcaption></figure>
<figure><img src="./wiki/cover-super-agent.png" alt="Super Agent 编排" loading="lazy" /><figcaption><b>Super Agent 编排</b><span>Mission / Plan / Delegation / Supervisor</span></figcaption></figure>
<figure><img src="./wiki/cover-office.png" alt="场景与办公室" loading="lazy" /><figcaption><b>场景与办公室</b><span>状态落到舞台，时间轴记录真实变化</span></figcaption></figure>
<figure><img src="./wiki/cover-llm-wiki.png" alt="知识库" loading="lazy" /><figcaption><b>知识库</b><span>Source → Page → Citation → Review</span></figcaption></figure>
<figure><img src="./wiki/cover-memory.png" alt="记忆与人物画像" loading="lazy" /><figcaption><b>记忆与人物画像</b><span>四层 + Dream；画像另成一套库</span></figcaption></figure>
</div>

不是五个产品，是同一套任务、run、消息和本地数据：

1. **多智能体终端**：Chat 派活、TODO、真实 PTY、worktree；运行中继续说话就是纠偏，完成后人点确认。见 [工作流](#/wiki/workflow)。
2. **Super Agent 编排**：主管不是更强的 worker —— 出计划、人批准、委派、汇总；子任务在独立 worktree 执行。见 [Super Agent / Mission](#/wiki/super-agent)。
3. **场景与办公室**：run / 审批 / 验收映射成工位、审批台、验收架；办公室 2.5D 与作战室、航母 3D 共用一份 `OfficeModel`。见 [场景与办公室](#/wiki/office)。
4. **知识库**：资料只读、页面可审核；解析 → 索引 → 检索 → 引用共用一套可重建索引。见 [知识库](#/wiki/knowledge) 和 [LLM Wiki](#/wiki/llm-wiki)。
5. **记忆与人物画像**：四层记忆管「记什么、忘什么」，画像管「这个人随时间什么是真的」。见 [记忆与 Dream](#/wiki/memory) 和 [人物画像](#/wiki/persona)。

这五件事也对应五个真正的技术难点（解析 / 编排 / 整理 / 记忆 / 画像），见 [五个技术难点](#/wiki/tech)。

## 你的一天大概会这样

1. 早上打开工作区，TODO LIST 里是昨天留下的待确认任务。
2. 在 Chat 里说一句“把首页标题改成品牌蓝，字号再大一点”。
3. 任务自动创建、排队，在项目目录的 worktree 里拉起 Agent。
4. 运行中你发现标题太大，直接在 Chat 补一句“再小两档”；消息作为纠偏送达当前 run。
5. 完成后任务进入「待确认」，你在 TODO 行内点确认，或者让它回到待执行。
6. 下午切到另一个项目，任务、会话、终端、文件树一起切换。

![五列工作台](./wiki/layout.png)

*图：TODO / Chat / Terminal / 文件预览在同一屏内联动。它不要求你记住每个终端在干什么。*

## 五个区域

| 区域 | 职责 |
|---|---|
| 导航 | 工作区 / 场景 / 项目 / 统计 / 主机 / Git / 知识库 / 记忆 / 人物 / 说明 / 设置 |
| TODO LIST | 按状态分组的任务列表；行内派活、停止、确认、重试 |
| Chat | 分派、纠偏、投递回执；agent / project / 元素上下文 |
| Terminal | 真实 pty、多标签、窗格拆分、预览与元素拾取；关标签只关视图，不杀进程 |
| 右侧栏 | 资源管理器 / 会话历史 / Git / 预览 |

## 一条任务的旅程

```text
Chat 说一句话
  → 普通消息默认派给当前 Agent（@别名 / 元素上下文可指定目标）
  → 创建 TODO + queued run
  → worktree 隔离（git 仓库）
  → dsh --profile acp 执行
  → session/update 流式写回 Chat
  → 运行中消息 → 纠偏回执
  → 完成后进入「待确认」
  → 人确认 → 「已确认」
```

![send 状态机](./wiki/send-state.png)

*图：send() 是唯一入口，但去向有六种：派活、纠偏、排队补充、新 run、仅记录、报错。*

## 设计原则

1. **单入口**：不在 Chat 之外再放一套新建/派活表单。
2. **执行可替换**：Run 不绑死某个 CLI，Agent 由执行适配器驱动。
3. **不假装**：不支持 steer 的 CLI 明确显示「终端专用」，不静默换引擎。
4. **人保留最终判断**：Agent 只能写 draft；reviewed 由人确认。
5. **本地优先**：项目、终端、数据库、日志都在本机；远端只通过 SSH 执行。

## 继续阅读

- [工作流](#/wiki/workflow)：一条任务如何从派活走到确认。
- [界面与流程](#/wiki/gallery)：一页看完工作台、ACP、调度、Mission 和打包。
- [架构](#/wiki/architecture)：Main / Renderer / Executor / Storage 的边界。
- [五个技术难点](#/wiki/tech)：解析 / 编排 / 整理 / 记忆 / 画像现在到哪了。
- [场景与办公室](#/wiki/office)：状态怎么落到舞台，三套模板各对应什么。
- [知识库](#/wiki/knowledge)：资料与页面共用一套索引，写入侧分权。
- [记忆与 Dream](#/wiki/memory)：四层、四种「忘」与打分注入。
- [Super Agent / Mission](#/wiki/super-agent)：多个 Agent 由谁组织。
- [LLM Wiki](#/wiki/llm-wiki)：Source → Page → Citation → Review。
- [人物画像](#/wiki/persona)：谁是什么样、什么时候会变、什么时候该忘。
- [设计取舍与踩坑](#/wiki/design-notes)：为什么长成现在这样。
- [终端与预览](#/wiki/terminal)
- [主题系统](#/wiki/themes)
- [插件与 LLM Wiki](#/wiki/plugins)
- [构建与发布](#/wiki/build)
- [版本记录](#/wiki/changelog)
