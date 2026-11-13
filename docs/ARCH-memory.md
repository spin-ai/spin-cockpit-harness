# Arch · 记忆（四层 + Dream）

> **状态：方案定稿，待实施（2026-11）。** 本文是 [`REQ-modules-original.md`](REQ-modules-original.md) 第 3 节「记忆」的实现设计。
> 框架来自 Anthropic《The components of agent memory》：**四层记忆 + 一个 Dream 循环**。叙事版见 [`ARTICLE-zhihu-llm-wiki.md`](ARTICLE-zhihu-llm-wiki.md)。
> 关联：[`ARCH-knowledge.md`](ARCH-knowledge.md)（L3 的对象：资料与页面）、[`PLUGIN-notes.md`](PLUGIN-notes.md)、[`ARCH-chat-thread.md`](ARCH-chat-thread.md)。

---

## 0. 一句话与边界

**记忆管“层次与流动”，知识管“对象与检索”。**

```text
L1 Transcripts  →  L2 Memory Notes  →  L3 知识（资料 + 页面）  →  L4 Injected
       ↑                    ↑                    ↑                    ↑
        └────────────── Dream：校正 / 构建 / 补洞 / 晋升 / 剪枝 ─────┘
```

- 本文定义：每层放什么、谁能写、怎么晋升、Dream 怎么跑；
- 本文**不定义**资料与页面的结构、检索与引用——那是 [`ARCH-knowledge.md`](ARCH-knowledge.md)；
- 人像记忆**不在这四层里**：它共享 L1，不共享 L2–L4（§8）。

---

## 1. 四层

| 层 | 内容 | 写入者 | 审核 | 读取方式 |
|---|---|---|---|---|
| **L1 Transcripts** | 会话消息、run、工具调用与结果、事件 | 系统自动落库 | 不需要 | `transcript_search` / `run_read` |
| **L2 Memory Notes** | Agent 的显著观察、未验证猜测、踩过的坑 | Agent（写）+ 人（标 verified） | 不需要，但可错、可过期、可丢弃 | `note_search` / 注入 |
| **L3 知识** | 资料（只读）+ 页面（可审核） | 导入 / 人写 / Agent 写 draft | 需要（内容审核） | `kb_search` / `kb_read` |
| **L4 Injected** | 每次会话预加载的目录，**≤12k 字符** | Dream + 人 | 高影响，晋升需可追溯 | 自动注入 |

规则：

1. **越高层越小**：L4 是目录，不是书；
2. 上层只能**引用**下层，不得复制下层正文；
3. 每条内容都要能回答“这条从哪来的”（`source_kind + source_id` 必填）；
4. L1 不可变：只有系统能写，Agent 只能读——否则 Dream 的 ground truth 就失效了。

---

## 2. 现状与缺口

| 层 | 现状 | 缺口 |
|---|---|---|
| L1 | `messages` / `runs` / `events` 已在 SQLite，数据完整 | **Agent 没有检索通道**；L1 也没有索引 |
| L2 | 只有 Source 摘要、draft 摘要、run 结论 | **不是独立对象**，是 L3 的摘要 |
| L3 | 完整（见 `ARCH-knowledge.md`） | — |
| L4 | `wiki.memory`（≤12k）+ 每 run 注入 | 没有优先级规则与“这次注入了什么”的可查记录 |
| Dream | `wiki.dream` 确定性三项检查（缺引用 / 超 7 天 draft / 重复标题） | 不调模型；没有建议队列；不能校正 |

**结论：四层结构已成立，但 L2 缺对象、L1 缺通道、Dream 缺闭环。本文就是把这三个缺口补上。**

---

## 3. L1 · Transcripts

### 3.1 数据

沿用现有 `messages` / `runs` / `events`（`electron/db.mjs`），**不新建日志系统**。

### 3.2 索引

```sql
CREATE TABLE transcript_fts USING fts5(bigram, text, tokenize='unicode61');
-- 行指向 (kind, ref_id)：message / run / event
```

复用知识侧的 bigram 切分（中文两字词必需，见 `ARCH-knowledge.md` §6.1）。

### 3.3 访问

```text
transcript_search(query, { kind?, since?, run_id?, limit })
run_read(run_id)          → run 元信息 + 关键事件（非全量 stdout）
```

- **只读**，不进 L4 注入（L1 太大）；
- 结果必须带 `time + run_id + session_id`，能跳回原始会话；
- Agent 不能用它伪造历史。

---

## 4. L2 · Memory Notes

### 4.1 对象

```sql
CREATE TABLE memory_notes(
  id TEXT PRIMARY KEY,
  kind TEXT,            -- rule | gotcha | guess | preference | decision
  body TEXT NOT NULL,
  confidence REAL,      -- 0..1
  status TEXT,          -- active | verified | expired | dropped
  expires_at INTEGER,   -- 可空；过期后不注入
  source_kind TEXT NOT NULL,   -- transcript | page | doc | run
  source_id   TEXT NOT NULL,
  created_at INTEGER, updated_at INTEGER
);
CREATE VIRTUAL TABLE note_fts USING fts5(bigram, body, tokenize='unicode61');
```

### 4.2 规则

1. **没有来源不能写**（`source_kind/source_id` 非空）；
2. 默认 `confidence ≤ 0.6`、`status = active`；`verified` 只能由人或审核通过的建议设置；
3. 允许写错——纠错成本必须低于“写错一个页面”，这是 L2 存在的理由；
4. 过期不删除：`expired` 保留可查，不注入；
5. **不进入页面审核流**，也不计入 `reviewed`。

### 4.3 生命周期

```text
active --(人被确认 / Dream 建议被接受)--> verified
active --(到期 / 冲突)-----------------> expired
任意   --(剪枝)------------------------> dropped（保留行，可恢复）
verified --(晋升为页面)----------------> 保留并标 promoted_to
```

### 4.4 工具

```text
note_write(kind, body, confidence, source_kind, source_id)   ← Agent 可写
note_search(query, kind?, status?)
note_verify(id) / note_drop(id)                              ← 仅人
```

---

## 5. L3 · 知识

对象、解析、索引、检索、引用全部见 [`ARCH-knowledge.md`](ARCH-knowledge.md)。本文只规定三点：

1. **L2 → L3 的晋升只能产出 `draft`**，必须过人审核；
2. L3 的删除/过期要同步让引用它的 note 标 `expired`；
3. L3 的体积是“剪枝”的判据：L3 比原始资料还大，说明没有抽象。

---

## 6. L4 · Injected Context

### 6.1 内容

```text
1. 置顶 / 最近审核通过的页面（标题 + 一句摘要 + id）
2. 索引页（主题目录）
3. 高置信度 note（verified，且未过期）—— 最多 N 条
4. 当前项目的约束与偏好
```

**不放**：页面正文、L1 原文、低置信度 note、过期内容。

### 6.2 构建规则

```text
score = 置顶(50) + reviewed 且有引用(30) + verified note(20) + 近 14 天更新(10)
       + log(引用次数 + 1)
按 score 排序，逐行追加，超过 12k 字符即停
```

不是截断——**是排序后自然截止**；同时给被挤掉的条目留入口（“还有 N 个页面”）。

### 6.3 缓存

- 用 `memory_version`（页面/note 变更时自增）做缓存键，**不在每次 run 重建**；
- 记住“这次注入了哪些 id”，可在 UI 查看（排查“Agent 为什么这么做”）。

---

## 7. Dream

### 7.1 五种动作

| 动作 | 输入 | 输出 | 优先级 |
|---|---|---|---|
| **校正** correct | L1 增量 + L2 active notes | 改写后的 note 建议 | P0 |
| **补洞** fill-gap | L3 索引 | 缺引用 / 坏链接 / 缺页面 | P0 |
| **构建** build | L2 notes + 资料 | 新页面草稿 | P1 |
| **晋升** promote | 高置信度 note / 高频引用页面 | L4 目录条目 | P1 |
| **剪枝** prune | L3 体积与引用分布 | 合并 / 下沉 / 留链接 | P2 |

### 7.2 调度与预算

```text
触发：空闲 ≥ 60s 且存在变更（新 run 完成数 ≥ 3，或 source 变更，或 note 新增 ≥ 5）
并发：1
预算：单次 ≤ 8 次模型调用；每日 ≤ 50 次；超预算静默跳过
范围：只处理变更对象，不定时全量扫
开关：设置页可整体关闭；关闭后只保留确定性检查
```

### 7.3 建议队列（不是直接写入）

```sql
CREATE TABLE dream_suggestions(
  id TEXT PRIMARY KEY,
  kind TEXT,        -- correct | fill-gap | build | promote | prune
  target_kind TEXT, target_id TEXT,
  payload TEXT,     -- JSON：拟改内容
  evidence TEXT,    -- JSON：[{kind, id, quote}]，必填
  status TEXT,      -- pending | accepted | rejected | expired
  created_at INTEGER, decided_at INTEGER
);
```

规则：

1. **只产建议，不直接改 `reviewed` 页面、不直接改 L4**；
2. 每条建议必须带 `evidence`，没有证据的不进队列；
3. 拒绝也留痕；同类建议 30 天内不重复打扰；
4. 接受 = 走对应层的正常写入路径（note 改写 / draft 创建 / L4 条目）。

### 7.4 顺序

```text
校正 → 补洞 → 构建 → 晋升 → 剪枝
```

先做便宜的、可验证的；剪枝最后，且只在 L3 体积超阈值时触发。

---

## 8. 与人像记忆的边界

| | 记忆（本文） | 人像记忆 |
|---|---|---|
| 回答 | 做过什么、当时怎么判断 | 这个人随时间什么是真的 |
| 时间语义 | `created_at / expires_at` | `valid_from / valid_to` + `as_of` 回看 |
| 确认 | 内容审核 / 建议接受 | **本人记忆确认** |
| 层次 | L1–L4 | 不属于四层 |

- 两者**共享 L1**（聊天记录、run、事件）——人像不需要第三套日志；
- **不共享 L2–L4**：人像的 `facts` 不进 L4 注入，除非本次对话与之相关；
- 记忆不写人像，人像不写记忆；即时通信按 `sensitivity` 出站过滤。

---

## 9. 观测与评估

| 指标 | 看什么 |
|---|---|
| 注入命中 | 本轮 L4 注入的条目被 Agent 实际引用了几条 |
| 建议采纳率 | Dream 建议 accepted / pending 的比例 |
| 纠错率 | `correct` 类建议里“确实是错的”占比 |
| 记忆膨胀 | L2 note 总数、L3 总字符 / 原始资料总字符 |
| 成本 | Dream 每日模型调用数与 token |

评估方式：跑 20 个跨会话任务，对比「开 Dream / 关 Dream」下的返工次数。

---

## 10. 里程碑

| 阶段 | 内容 | 天 |
|---|---|---|
| M0 | L1 通道：`transcript_fts` + `transcript_search` / `run_read` + MCP 白名单 | 1 |
| M1 | 确定性 Dream → 建议队列（含接受/拒绝、可关、去重打扰） | 1 |
| M2 | L2 对象：`memory_notes` + `note_write/search` + 过期与生命周期 | 1.5 |
| M3 | LLM Dreaming：校正 + 补洞（先这两步） | 1.5 |
| M4 | 晋升 + 剪枝（先 A/B 验证收益再上） | 1–2 |

**M0–M2 = 3.5 天**（无模型、零新依赖）；**M3 起开始产生模型成本**。

---

## 11. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| L4 被自动晋升污染 | **污染每一次会话** | 晋升必须人工接受；L4 条目可追溯；可一键回到上一个 `memory_version` |
| 记忆膨胀 | 检索退化、成本上升 | L3 体积比作剪枝判据；L2 有 `expires_at` |
| 记得越多越差 | Agent 行为漂移 | Anthropic 的对照很直观：413 个文件只拿 1 个徽章，9 个文件拿 4 个——**准 > 多** |
| Dream 是持续支出 | 费用不可控 | 单次/每日预算；只在变更时跑；可关 |
| L1 被 Agent 写入 | ground truth 失效 | L1 只读，写入路径只有系统 |
| L2 变成第二个 L3 | 两套知识互相打架 | L2 不超过 60 字、必须带来源、不进审核流 |

---

## 12. 待定

1. L4 的 12k 上限是否按模型上下文动态调（现在写死）？
2. `verified` note 是否允许自动进 L4，还是必须人点一下？
3. 剪枝的第一版只做“提示不做动作”，还是一开始就产合并建议？
4. Dream 是否需要“白天也有一次轻量校正”（现在只在空闲触发）？
