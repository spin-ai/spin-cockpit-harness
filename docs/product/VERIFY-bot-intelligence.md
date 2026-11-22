> 层：需求 · 状态：记录 · 核对：2026-11-22 · 覆盖：机器人智能度的可观测验收（真实网关探针 + 三问端到端 + 已知不符项）

# 验收 · 机器人智能度

**这份文件只回答一件事：哪天、用什么问题、答成什么样。**
[`REQ-bot-intelligence.md`](REQ-bot-intelligence.md) 只写「要什么 + 判据」，不写「做了没有」；
§7.1 是实现侧自评快照，可以看进度，**不能当验收**。冲突时以本文件最新一条为准。

为什么分开：2026-11-22 的第一版把「诊断 / 规格 / 实现状态」写在同一篇里，结果同一节里
「已落地」和 5 ✅ / 5 ◐ / 2 ✗ 并存；后来核对代码时还发现两处反例（SR-B11 标「未做」实际已做、
`runs.result` 标「落库」实际没落库）。**自评永远会偏高，只有外部可复现的结果不会。**

---

## 1. 2026-11-22 · 第一轮

### 1.1 前提：网关到底支不支持 function calling

```bash
ARK_API_KEY=... node scripts/probe-ark-tools.mjs --verbose
```

一次跑完五件事（生产同一份 `chatStream` + 同一份 `botToolsFor("read")` + 真实 `workspace.mjs`），
目标文件 `README.md:20`：

| 检查 | deepseek-v4-flash | doubao-seed-2.1-turbo |
|---|---|---|
| tools 被接受（不是 4xx） | ✅ | ✅ |
| 真的发起调用（不是只聊） | ✅ `workspace_read` | ✅ `workspace_read` |
| 流式 id / name / arguments 拼装正确 | ✅ `{"path":"README.md","offset":19,"limit":1}` | ✅ 同 |
| tool 结果按 OpenAI 结构回灌不被拒 | ✅ | ✅ |
| 最终回答引用了工具真实读到的内容 | ✅ | ✅ |

**结论**：`/api/plan/v3` 两个模型都能调工具，`tool_choice: "auto"` + 流式 `tool_calls` 都正常。
这一条以前是**整条「观察面」链路未经验证的前提**，现在有复现脚本，不必再猜。
产出：`.preview/probe-ark-tools.json`（不入库）。

### 1.2 端到端：三个真问题（不是单测、不是 mock）

```bash
ARK_API_KEY=... node scripts/probe-bot-answers.mjs --model=deepseek-v4-flash
```

走生产 `createBots`（真实 `reply` → 工具循环 → `bot_turns`），工具执行器在本仓库上真读文件、真跑 git；
记忆库用临时目录，不碰 userData；不启动窗口（AGENTS §5）。

| 问 | 覆盖 | 预期工具 | deepseek-v4-flash | doubao-seed-2.1-turbo |
|---|---|---|---|---|
| `README.md 第 20 行是什么？` | C1 观察面 | `workspace_read` | ✅ 2 轮 · 2940 tok | ✅ 2 轮 · 3275 tok |
| `现在工作区里 git 改了什么？` | C1 + C3 | `git_status` → `git_diff` | ✅ 2 轮 · 4301 tok | ✅ 2 轮 · 4622 tok |
| `r-fail-1 这次运行为什么失败？` | C3 + B12 | `run_log` | ✅ 2 轮 · 3694 tok | ✅ 2 轮 · 3980 tok |

判据是「回答里必须出现真实内容」：第 20 行原文、真实改动过的文件名、夹具里的 `TypeError`。
三轮都没有「先猜后答」，都是 2 轮（查一次 + 答一次），没有触发循环保护。
`context` 每轮 1150 字符（人格 + 规则 + 记忆 11 字符），记录在 `.preview/probe-bot-answers.json`。

**这一轮证明的**：C1 观察面 + C3 单步查证 + B12 查停因，在真实仓库上成立。
**这一轮没证明的**：多步（≥4 轮）任务、长对话摘要、记忆写入后下一轮真的想起来、群聊分工。

### 1.3 验收顺手推翻的两条自评

| 自评 | 实际 | 处理 |
|---|---|---|
| §7.1 曾写「SR-B11 handoff 未做」 | `handoff_to_bot` 已注册（`tools.mjs`）、群内一跳唤醒（`main.mjs`）、`bot_turns.handoff` 已落库并往返 | 表已改 ✅ |
| ARCH-terminal-ux §7 写「产出落库」 | `run.result / resultSource / resultTruncated / resultAt` 只在内存里：`runs` 表没有这四列，INSERT / SELECT 也没带 → **重启即丢** | 已补列 + 往返用例（`tests/db.test.mjs`） |

### 1.4 已知不符（还没修，别当成已完成）

| 规格 | 差在哪 | 影响 |
|---|---|---|
| IR-B03 记忆可写「显示谁写的、哪一轮、共享 / 本 bot」 | `owner` 只在记忆库里，`src/` 无此字段（`types.ts` / `Memory.tsx` 都没有） | 它写了记忆，界面上看不出归属 → 体感仍是「没记住」 |
| SR-B02「路径 jail 到当前项目 / **worktree**」 | 工具统一用 `activeProjectPath()`（全局当前项目），不跟会话 / 任务 / run 的 worktree | 问「agent 这次改了什么」看的是主仓，看不到 worktree 里的改动 |
| IR-B10「每轮页脚一行 N 轮 · token · 停因」 | `stopReason` 只在「轨迹」账本里（`Bot.tsx`） | 聊天里看不到为什么停 |
| IR-B02「≥80% 显示该整理了 / 点开看被裁条目」 | 只显示总字符 + 记忆字符 | 预算不可操作 |

这四条都是「服务端有、界面一端没有」的半条规格：测试不会红，体验也不会变。

---

## 2. 下一轮该验什么（按体感排序）

1. **多步**：给一个必须查 4 次以上的问题（例：「这个功能在哪个文件实现、谁调它、最近一次改动是什么」），
   断言工具链 ≥3 跳且没有触发同参重复保护；
2. **记忆闭环**：说「记住：…」→ 下一轮问同一件事 → 断言回答引用了那条 `note`，且 `owner=bot:<id>`；
3. **长对话**：>24 条后用一句早期上下文提问，断言 `threads.digest` 被带上（`context.digest === true`）；
4. **群聊不双答**：两个 bot 同时在场，@ 其中一个，断言回合数 = 1 + 至多一条 handoff。

每轮加一条，写在本文件新开的小节里，不要改上面的历史记录。

---

## 3. 加一条验收的格式

```markdown
## N. YYYY-MM-DD · 第几轮

### N.1 <前提 / 能力>（一行说清要证明什么）
命令：`...`（能在别人机器上复现；不写本机路径、不写 key）
| 检查 | 结果 |
被判据否掉的结论 / 被推翻的自评，单列一小节
产出：`.preview/*.json`（不入库）
```

硬规则：
- **能复现**：命令 + 输入（问题原文）+ 判据（回答里必须出现什么）；
- **不碰用户数据**：临时目录 / 夹具，不读 userData；
- **不抢焦点**：headless，不开窗口；
- **只写结果**：不写「已完成」，写「3/3 通过 · 用了哪些工具」。
