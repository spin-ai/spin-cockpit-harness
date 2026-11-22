> 层：架构 · 状态：已落地 · 核对：2026-11-22 · 覆盖：八个核心概念（Chat / Super Agent / Bot / Terminal / Knowledge / Memory / Persona / Scene）的定义与关系

# 核心概念：八个词与一张关系图

> 这份文档只做一件事：**把日常口头说的八个词钉死**，避免「Chat 是不是任务」「Bot 和 Agent 有什么区别」这类讨论反复漂移。
> 每个概念都指到它自己的 ARCH；本文不复述实现细节，只定义边界。

---

## 1. 一句话定义

| 概念 | 定义 | 管什么 | 详细设计 |
|---|---|---|---|
| **Chat** | 一个会话实体（thread）；消息挂在 thread 上，不挂在任务上 | 说话、派活、纠偏的**唯一对话面** | [`ARCH-chat-thread.md`](ARCH-chat-thread.md) |
| **Super Agent** | Mission 级编排者（supervisor 角色），不是更强的 worker | 目标 → 计划 → 子任务 → 汇总验收 | [`ARCH-super-agent.md`](ARCH-super-agent.md) |
| **Bot（机器人）** | 会主动开口的身份：人格卡 + 记忆 + 能力档位 + 触发规则 | **谁在说、为什么说**；绑定执行体后才能干活 | [`ARCH-bot.md`](ARCH-bot.md) |
| **Terminal** | Agent 干活和人都能用的同一个 pty pane | **在哪执行**：一次 run / 一个 worktree 一个标签 | [`ARCH-terminal-ux.md`](ARCH-terminal-ux.md) |
| **Knowledge** | 资料与页面本身 | 解析、索引、检索、引用（对象与检索） | [`ARCH-knowledge.md`](ARCH-knowledge.md) |
| **Memory** | 四层记忆 + Dream 循环 | 记什么、忘什么、一次 run 注入什么 | [`ARCH-memory.md`](ARCH-memory.md) |
| **Persona** | 给「人」建模：观察、关系、性格，带双时态证据链 | 推断一个人是谁、怎么处事（不是 Bot 自己的字段） | [`ARCH-memory-persona-im.md`](ARCH-memory-persona-im.md) |
| **Scene** | 真实运行状态的空间化投影（Stage Pack：办公室 / 作战室 / 航母） | 谁在哪、什么状态；**不调度** | [`ARCH-office.md`](ARCH-office.md) |

---

## 2. 关系图

```text
                        ┌──────────────── Chat（thread）────────────────┐
  人说话 / 点派活 ─────▶ │  消息挂在 thread 上；一个 thread 可以是：        │
                        │   · 任务会话（todoId）                          │
                        │   · 全局对话（不绑任务）                        │
                        │   · 机器人会话（kind=bot, botId）               │
                        └───────┬───────────────────────┬────────────────┘
                                │ 派活                    │ 机器人说话
                                ▼                         ▼
                        Todo → Run → Terminal      Bot ──executorAgentId──▶ Agent → Run
                                │                         │
                                │ 编排                    │ 上一句说什么
                                ▼                         ▼
                        Super Agent                  Memory（L1–L4）
                     Mission → Plan → Delegation        ▲
                     → 多个 Todo / Run                  │ 检索
                                                        │
                                        Knowledge（资料 / 页面）
                                        Persona（人物模型，独立库）

  Scene ← 读 Todo / Run / Agent / Bot + Stage Pack 配置，只做投影
```

---

## 3. 容易混淆的四对

**Chat ≠ Todo**
Chat 是会话；Todo 是任务。派活 = Chat 里的一条消息同时创建 Todo + Run，原话留在会话里。
任务状态只在 TODO 行内维护，Chat 不复制。

**Bot ≠ Agent**
Agent 是执行体（dsh / CLI，负责跑）；Bot 是身份（人格 + 记忆 + 触发）。
Bot 自身不能改代码；`capability=work` 且绑了 `executorAgentId` 时，由它提议 → 人点「开跑」→ Agent 起 run，跑完回流一条 `reported` 汇报。

**Memory ≠ Knowledge**
Memory 管**层次与流动**（L1 原始 → L2 观察 → L3 页面 → L4 注入，Dream 负责晋升与剪枝）；
Knowledge 管**对象与检索**（资料、页面、分块、引用）。Memory 的 L3 指向 Knowledge 的页面，不重复存正文。

**Persona ≠ Bot 的人格卡**
Persona 建模的是「人」（他人档案、证据链、关系网）；
Bot 的人格是 `bots.persona` 里的结构化字段（语气 / 称呼 / 边界 / 习惯），属于机器人自己。
两者只在「结构化字段」这一层同构，不共享一张表。

---

## 4. 一条目标走完全程

```text
你说一句目标
  └─ Chat：成为一条消息
       └─ 派活 / Super Agent：Mission + Plan
            └─ Delegation：拆成 Todo，分给 Agent
                 └─ Run：在 Terminal 的 worktree 里执行
                      ├─ Memory 注入 L4：这一轮它记得什么
                      ├─ Knowledge：查资料、带页码引用
                      └─ 汇报 / 沉默：进 Bot 回合账，可审计
                           └─ Scene：把 Todo / Run / Agent / Bot 画到舞台上
                                └─ 人验收：仍是人的动作，不是 Bot 自批
```

**一句话记忆**：Chat 是对话面，Todo / Run / Terminal 是执行面，Super Agent 是编排，
Bot 是主动身份，Memory / Knowledge / Persona 是上下文，Scene 是这一切的空间投影。
