> 层：架构 · 状态：部分落地 · 核对：2026-11-15 · 覆盖：四层记忆 + 遗忘语义 + L1 索引 + Dream

# Arch · 记忆（四层 + 遗忘 + 索引 + Dream）

> **状态（2026-11-15 复核）：四层 + note（kind/置信度/存活期/去重闸门）+ 失效链 + 打分注入 + 注入台账 + L1 bigram 索引 + Dream 建议队列已落地**（`electron/memory/index.mjs`、`electron/db.mjs` 的 `onTranscript` 钩子、`src/components/Memory.tsx`、MCP `memory_*`、`npm run memory:selftest` / `db:selftest`）；**未做**：注入归因升级（现在是标题片段匹配，只能分「从没被用过」）。本文是 [`REQ-modules-original.md`](../product/REQ-modules-original.md) 第 3 节「记忆」的实现设计。
> 框架来自 Anthropic《The components of agent memory》：**四层记忆 + 一个 Dream 循环**。叙事版见 [`ARTICLE-zhihu-llm-wiki.md`](../articles/ARTICLE-zhihu-llm-wiki.md)。
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
| L1 | `messages` / `runs` / `events` 已在 SQLite；消息与事件进 `mem.db` 的 `transcript_fts`（bigram FTS5），`memory_search` 走索引；runs 数量小，直接扫内存 | `run_read`（按 run 读关键事件）未做 |
| L2 | 独立对象 `notes`：`kind` / `confidence` / `expires_at` / 来源必填（不带 `source_ref` 直接拒）/ 归一化去重（同一句话只存一行，重复写只抬置信度） | — |
| L3 | 完整（见 `ARCH-knowledge.md`） | — |
| L4 | 打分注入（置顶 50 / 有来源 30 / 层级 / 近两周 10 / log 被用）+ note 预留预算 + L1 排除 | — |
| 台账 | `inject_log`：每次 run 注入了哪些 id、是否被回答用到，回填 `hit_count`，`injectionStats()` 算命中率 | 归因很粗（按标题片段是否出现在回答里） |
| 失效 | `entries.invalid_at / superseded_by / supersedes` + `entryAsOf` 回看 | 只能显式指定 `supersedes`，不做主题猜测（故意的，见 §4.5） |
| Dream | 七类确定性检查 + 建议队列 + 每日建议预算；**语义 pass（模型）默认关**，打开后一次调用找「换说法的重复」「已不成立」「该改写的糙句」 | 语义 pass 没有准确率数据（打开的人才知道） |

**结论：四层结构成立，遗忘语义与 L1 索引都已补齐；剩下的是注入台账的准度（归因很粗）与 Dream 的语义 pass。**

---

## 3. L1 · Transcripts

### 3.1 数据

沿用现有 `messages` / `runs` / `events`（`electron/db.mjs`），**不新建日志系统**。

### 3.2 索引

```sql
CREATE VIRTUAL TABLE transcript_fts USING fts5(
  bigram, text UNINDEXED, ref_kind UNINDEXED, ref_id UNINDEXED,
  at UNINDEXED, thread_id UNINDEXED, run_id UNINDEXED, tokenize='unicode61'
);
CREATE TABLE transcript_map(ref_kind, ref_id, rowid_ INTEGER, at, PRIMARY KEY(ref_kind, ref_id));
```

- 入库与查询统一切 **bigram**（复用 `knowledge/bigram.mjs`；中文两字词在 `unicode61` / `trigram` 下都查不到，见 `ARCH-knowledge.md` §6.1）；
- `transcript_map` 存 (kind, ref_id) → rowid，用来做 upsert：改写消息时**先删后插**，不会留旧文本；
- **增量写入**：`openDb` 接受 `onTranscript` 钩子，`addMessage` / `updateMessage` / `addEvent` 每次写入同步一条。钩子内部包 try/catch，**索引失败不能弄坏业务写入**；
- **启动对账**：`transcriptSync` 清孤儿（会话删了 / 事件是 300 条滚动窗口）+ 补缺失。不用「条数相等」判断，因为事件表天然会变少；
- 索引可删可重建（真数据在 `harness.db`），FTS5 不可用时 `transcript_fts` 建不出来也不会把整个记忆层带崩，检索自动回落内存扫。

### 3.3 访问

```text
memory_search(query, limit)   → [{kind, id, at, threadId, runId, snippet}]
```

- **只读**，不进 L4 注入（L1 太大）；
- 结果带 `at + runId + threadId`，能跳回原始会话；孤儿命中（会话已删）在读取时就被滤掉；
- 片段切在**命中词附近**（`makeSnippet`），不是 FTS 自带的 `snippet()`——因为索引的是 bigram、原文是另一列，自带高亮对不上；
- `run_read(run_id)`（IPC `memoryRunRead` / MCP `run_read`）：单个 run 的状态 / token / 错误 + 这轮最多 20 条消息（截断）+ 提到它的关键事件。和 `memory_search` 分工：那个找「哪次提过」，这个看「那一次到底做了什么」。

---

## 4. L2 · Memory Notes

### 4.1 对象

```sql
CREATE TABLE memory_notes(
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  kind TEXT,            -- rule | gotcha | guess | preference | decision
  confidence REAL,      -- 0..1，guess 默认 0.4，其余 0.6
  status TEXT,          -- new | verified | stale | rejected
  expires_at INTEGER,   -- 衰减：到期后不注入，行保留（按 kind 给默认存活期）
  source_kind TEXT NOT NULL,   -- transcript | page | run | manual
  source_id   TEXT NOT NULL,
  created_at INTEGER, updated_at INTEGER
);
```

| kind | 默认存活期 | 为什么 |
|---|---|---|
| `rule` / `decision` | 不过期 | 规则和决定不随时间作废，只会被推翻（走 `invalid_at`） |
| `gotcha` | 180 天 | 坑会随着版本升级消失 |
| `preference` | 90 天 | 偏好会变 |
| `guess` | 14 天 | 猜测本来就该很快消失 |

被人工 `verified` 的 note 自动清掉 `expires_at`：人确认过就不再自动遗忘。

### 4.2 规则

1. **没有来源不能写**（`source_kind / source_ref` 非空）——空 `source_ref` 直接报错，`manual` 也要写清谁写的；
2. **一条观察不超过 400 字符**：超了拒绝并提示去写页面 / 条目（以前是静默 `slice(0,4000)`）；
3. **同一句话只存一行**：正文去空白与标点后哈希做键，重复写入不新增行，只 `confidence +0.1` 并换上新来源；
4. 默认 `confidence`：`guess` 0.4，其余 0.6；`verified` 只能由人或审核通过的建议设置；
5. 允许写错——纠错成本必须低于“写错一个页面”，这是 L2 存在的理由；
6. 过期不删除：`expires_at` 过了行还在、可查，只是不注入；
7. **改写留旧版**：`noteRewrite` 先把旧正文写进 `note_revisions` 再覆盖——Dream 记错一次必须能回退；
8. **不进入页面审核流**，也不计入 `reviewed`。

### 4.3 生命周期

```text
new      --(人验证 / 晋升)---------------------> verified（清 expires_at，不再衰减）
new      --(到 expires_at)--------------------> 仍在 new，但注入时跳过（decay，不是删除）
new      --(拒绝 / 冲突)----------------------> stale | rejected
verified --(据以晋升为条目)-------------------> 保留，条目带来源指针
```

晋升（`promoteNote`）前有三道边界，不满足直接报错而不是静默降级：

1. `status` 不能是 `stale` / `rejected`（已经不成立了）；
2. `expires_at` 不能已过（旧结论应该被重写，而不是被抬进每次会话都注入的 L4）；
3. `source_ref` 必须非空（无法核对的结论不能当目录）。

### 4.4 工具

```text
note_write(kind, body, confidence, source_kind, source_ref)   ← Agent 可写
note_search(query, kind?, status?)
note_verify(id) / note_drop(id)                               ← 仅人
```

### 4.5 四种「忘」不是一件事

混用会直接损害一致性，所以四个动作对应四组字段、四个入口：

| 操作 | 语义 | 写什么 | 入口 | 可回看 |
|---|---|---|---|---|
| **失效** invalidate | 事实被推翻 | `invalid_at = 新条目 valid_from`、`superseded_by` | `entryInvalidate` / `promoteNote({supersedes})` | ✅ `entryAsOf(at)` |
| **衰减** decay | 该自然过期了 | note 的 `expires_at` | `noteAdd` 按 kind 给 TTL | ✅ 行还在 |
| **淘汰** evict | 用不上 / 超体积 | `status='archived'` | `entryArchive` | ✅ `entryRestore` |
| **合并** merge | 两条说同一件事 | 新条目 + 两条 `superseded_by` | Dream `prune` 建议（未实现自动合并） | ✅ |

两条硬规则：

1. **失效永远不删行**。L4 是每次会话都注入的，重复晋升同一主题会堆出一串互相矛盾的 active 结论——那就是「记忆污染」，比忘不掉贵得多。
2. **失效只由显式 `supersedes` 触发，不猜主题**。按标题相似度自动失效，做错一次就把对的结论埋了；猜错比不做更糟（和 [`ARCH-key-tech.md`](ARCH-key-tech.md) ③ 的判据一致）。

---

## 5. L3 · 知识

对象、解析、索引、检索、引用全部见 [`ARCH-knowledge.md`](ARCH-knowledge.md)。本文只规定三点：

1. **L2 → L3 的晋升只能产出 `draft`**，必须过人审核；
2. L3 的删除/过期要同步把引用它的 note 标 `stale`（`expires_at` 管自然衰减，不要拿它代替「依据没了」）；
3. L3 的体积是“剪枝”的判据：L3 比原始资料还大，说明没有抽象。

---

## 6. L4 · Injected Context

### 6.1 内容

```text
1. 条目（L4 结论 / L3 项目 / L2 事实）—— 按 score 排序，超预算自然截止
2. note —— verified 最多 8 条，高置信度未验证最多 4 条（显式标「未验证」）
3. 预算不足时写一行「另有 N 条超出预算，已省略」
```

**不放**：L1 原文（`layer!='L1'` 硬排除）、页面正文、过期 note、置信度 < 0.6 的 note。

### 6.2 构建规则

```text
score = 置顶(50，sort_order 非空) + 有来源(30) + 层级(L4=15 / L3=8)
      + 近 14 天更新(10) + log(1 + 被用次数)
note: score = verified(20)/new(6) + confidence×10 + 近 7 天(5)
```

- 常数写死在 `INJECT` / `scoreEntry`，**不做成配置**——能调的参数只会把「准」变成「调参」；
- note 单独预留 `min(2000, 预算×25%)`，否则永远被 L4 条目挤光（这是修掉的一个真实 bug）；
- 不是截断——**是排序后自然截止**；被裁的每一条都要能说出原因（`inject().items[].reason`）。

### 6.3 台账、预算与归因

- 预算**只有一个来源**：`meta.injectBudget`（默认 12000）。run 注入、MCP `memory_inject`、记忆页预览都走它，不要再在调用处写死（曾经 run 用 6000、UI 用 12000，两边对不上）；
- `memory_version`：任何写入自增，随 `inject()` 返回；
- **台账只记真注入**：`inject({ runId })` 才写 `inject_log`，记忆页预览不写（否则「进过上下文」会被预览刷成假数据）；
- **归因（`markCited`）**：run 结束后把这一轮「Agent 说出来 + 实际执行的工具调用」拿回来（**`role = agent` 的 text 与 `role = tool`，`thought` 不算**），两条判据命中任一条就算被用到，命中后 `hit_count +1`、`last_hit_at` 更新，进下一次的分数：
  - **强**：标题片段（归一化后 ≥6 字）整段被复述；
  - **弱**：这条里的**特征词**（反引号片段 / ASCII 命令与标识符，≥5 字）至少命中 `min(2, 特征词数)` 个，且最长命中 ≥6 字；
  - **踩过的坑**：最初按 `role = 'assistant'` 取文本，而实际角色是 `agent` —— 归因恒为 0，看起来像「记忆从来没被用过」。修完再拿真实数据跑：82 条注入里**强判据命中 0 次、弱判据 21%**。也就是说「标题被复述」这个判据在真实 run 里基本不会发生（照着做了也不会复述那句话），只能靠特征词；
  - 它仍然是口水话判据：能分「从没被用过」，分不出「用错了」，也不证明因果。真正的判据是对照实验（开/关记忆比较返工次数），命中率只是先导指标；
- `injectionStats()` 只给三个数：轮数、注入条数、被用到条数（+ 平均字符）。指标多了一定没人看。

---

## 7. Dream

### 7.1 动作表（代码里是 7 个 action）

| 动作 | 判据 | 现在怎么做 | 成本 |
|---|---|---|---|
| **校正** `correct` | 某条结论被推翻（`invalid_at`），谁在支撑它？ | 找 `sourceRefs` 覆盖的 verified/new note，建议复核；接受 = 标 `stale`（退出注入与晋升） | 免费 |
| **合并** `merge` | 两条观察是同一句话的扩写 | bigram **包含度 ≥ 0.9** 且 token ≥ 4；保留 verified / 更新的那条，其余标 `stale` | 免费 |
| **改写** `rewrite` | 观察写得太糙（一口三条 / 措辞含糊） | 只由语义 pass 提出；**只动 `new`，不动 `verified`**；只许删减或合并自身已有说法（新增 token ≤ max(2, 原句 20%)、原句包含度 ≥ 0.5）；接受后旧正文进 `note_revisions` 再覆盖 | 模型调用 |
| **修引用** `fix` | reviewed 页面的引用源已删 / 缺摘要 | 产建议，接受 = 页面标 `stale` | 免费 |
| **补洞** `fill` | 页面既无引用也无反链 | 同上 | 免费 |
| **构建** `build` | 有资料没有页面 | 接受 = 调 wiki 生成 draft | 有模型调用 |
| **晋升** `promote` | verified note 还没进页面 | 接受 = 建 draft + 写 L4 条目 | 免费（页面生成另算） |
| **剪枝** `prune` | L3 条目 > 12 或正文 > 20000 字符 | 接受 = 归档最大的三分之一 | 免费 |

**为什么不用 Jaccard 做合并判据**：短中文句子换个措辞 Jaccard 就掉到 0.3，阈值一松就误合并；包含度只认「换行 / 加词 / 换标点」这类真·同一句。语义级的「换个说法的同一件事」交给 §7.2 的语义 pass，不靠调阈值凑。

### 7.2 语义 pass（调模型，默认关）

```text
输入：dreamCandidates() 取最近 60 条「new / verified 且未过期」的观察（id + kind + body）
输出：{"items":[{"action":"merge|correct|rewrite","ids":[...],"keep":"...","body":"仅 rewrite","reason":"..."}]}
一次扫描 = 1 次模型调用（不是每条一次）；失败回落非 JSON 模式重试一次
```

三道闸门，任何一道不过就静默跳过并在记忆页看到原因：

1. 设置里 `llmPass` 打开（默认关）；
2. 有模型密钥（`设置 → 执行` 里的 `ARK_API_KEY`）；
3. 当日模型调用预算没用完（`llmDailyCalls`，默认 20）。

**模型说的话不算数，先过校验**（`dreamModelSuggest`）：

- 只能引用**存在的** note id（防幻觉 id）；
- `merge` 至少 2 个 id 且 `keep` 必须落在 ids 里（不合法就回落第一个）；
- `correct` 只能指 1 个 id；
- `rewrite` 只能指 1 个 `status = new` 的 note（`verified` 是人确认过的，不许被模型改写），且必须过「不引入新事实」两条闸门（见 §7.1）；
- 必须有 `reason`（≥4 字），没有理由的建议不进队列；
- 同一组 id 同类建议只入队一次（`sig = llm:action:ids`）；
- 走的是和确定性建议同一个队列与同一个每日**建议**预算（建议条数与模型调用是两笔账，互不覆盖）。

### 7.3 调度与预算

```text
触发：手动点「运行 Dream」（空闲自动触发还没做）
并发：1
预算：单次 ≤ maxSuggestions；每日建议 ≤ dayLimit（默认 200）；语义 pass 每日模型调用 ≤ llmDailyCalls（默认 20）
     两笔账都存在 meta.dreamBudget 里（按本地自然日），写的时候必须一起带上，否则会互相覆盖
范围：只处理候选集（note ≤ 300、L3 条目、reviewed 页面），不做全量历史扫
开关：设置页可整体关闭；关闭后一条建议都不产
```

- 预算**按建议条数**算，不按模型调用——现在这条链路是确定性的，不花钱；
- 但上限仍然必要：建议一天刷 500 条，人就再也不看复核队列了，Dream 等于没跑；
- 预算用尽时**静默返回空**（不报错），记忆页显示「今日 N / 上限 M」。

### 7.4 建议队列（不是直接写入）

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

实现上是 `suggestions` 表（`action / title / detail / target_kind / target_id / sources / sig / status`），`sig` 去重，拒绝写 `rejects`。

规则：

1. **只产建议，不直接改 `reviewed` 页面、不直接改 L4**；
2. 每条建议必须能说清依据（`sources` 指向具体 note / 条目 / 资料）——没依据的不进队列；
3. 拒绝也留痕；同类建议不再重复打扰（`sig` + `rejects`）；
4. 接受 = 走对应层的正常写入路径（note 标 `stale` / note 改写并留旧版 / draft 创建 / L4 条目）。

### 7.5 顺序

```text
fix（页面引用）→ build（资料无页面）→ fill（无依据）→ promote（观察没落地）
→ merge（观察重复）→ correct（依据被推翻）→ prune（体积超阈）
```

先做便宜的、可验证的；合并与校正必须排在「晋升」之后——先让该上来的上来，再谈去重与推翻；剪枝最后，且只在 L3 体积超阈值时触发。

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
- **L4 只有一个来源**：run 注入、MCP 都走 `memory().inject()`；旧的 `wiki.memory`（notes 插件）已弃用，知识库不再有自己的记忆面板；
- 记忆不写人像，人像不写记忆；即时通信按 `sensitivity` 出站过滤。

---

## 9. 观测与评估

| 指标 | 看什么 |
|---|---|
| 注入命中 | `injectionStats().hitRate`：本轮 L4 注入的条目被回答用到的比例 |
| 建议采纳率 | Dream 建议 accepted / pending 的比例 |
| 纠错率 | `correct` 类建议里“确实是错的”占比 |
| 记忆膨胀 | L2 note 总数、L3 总字符 / 原始资料总字符 |
| L1 索引 | `transcriptCount()` 与 harness.db 条数（对账每次启动跑，不用列指标）；检索延迟不随消息数线性涨 |
| 同一主题并存 | L4 里同主题 active 条目数（失效链生效应该 = 1） |
| 成本 | Dream 每日模型调用数与 token |

回归：

- `npm run memory:selftest`（临时目录，不碰 userData）——断言四类遗忘不串味、L1 不进注入、小预算仍有 note、写入闸门、台账归因、索引对账、老库补列；
- `npm run memory:preview`（vite + headless Chrome + mock `window.harness`，不启动 Electron、不抢焦点）——断言记忆页把「已失效 / 已过期 / 置顶 / 被裁原因 / 两笔预算」表达出来，并出亮色 + 暗色 + Dream 三张截图到 `.preview/`。

评估方式：跑 20 个跨会话任务，对比「开 Dream / 关 Dream」下的返工次数。

---

## 10. 里程碑

| 阶段 | 内容 | 天 |
|---|---|---|
| M0 | L1 通道：`transcript_fts` + `transcript_search` / `run_read`（**索引已完成 2026-11-15**；`run_read` 未做） | — |
| M1 | 确定性 Dream → 建议队列（含接受/拒绝、可关、去重打扰） | 1 |
| M2 | L2 对象：`memory_notes` + `note_write/search` + 过期与生命周期 | 1.5 |
| M3 | LLM Dreaming：校正 + 补洞（先这两步） | 1.5 |
| M4 | 晋升 + 剪枝（先 A/B 验证收益再上） | 1–2 |
| **M5** | **遗忘语义：失效链 + note 衰减 + 打分注入（已完成，2026-11-15）** | — |
| M6 | 写入闸门（来源必填 / 去重）+ 注入台账 + 被引用回填（**已完成，2026-11-15**） | — |
| M7 | Dream 的确定性 `correct` / `merge` / 每日预算 + **语义 pass（默认关、带调用预算）** + 改写建议（`rewrite`，留旧版可回退）（**已完成 2026-11-15**）；剩下归因升级成模型自评 | 1.5 |

**M0–M2 = 3.5 天**（无模型、零新依赖）；**M3 起开始产生模型成本**。

---

## 11. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| L4 被自动晋升污染 | **污染每一次会话** | 晋升必须人工接受；L4 条目可追溯；可一键回到上一个 `memory_version` |
| 记忆膨胀 | 检索退化、成本上升 | L3 体积比作剪枝判据；L2 有 `expires_at`（按 kind 给默认值） |
| 记得越多越差 | Agent 行为漂移 | Anthropic 的对照很直观：413 个文件只拿 1 个徽章，9 个文件拿 4 个——**准 > 多** |
| Dream 是持续支出 | 费用不可控 | 单次/每日预算；只在变更时跑；可关 |
| L1 被 Agent 写入 | ground truth 失效 | L1 只读，写入路径只有系统 |
| L2 变成第二个 L3 | 两套知识互相打架 | L2 不超过 60 字、必须带来源、不进审核流 |

---

## 12. 待定

1. L4 的 12k 上限是否按模型上下文动态调（现在写死）？
2. 高置信度 `new` note 自动进注入（现在 ≤4 条、标「未验证」）——是否应该一条都不放，只等人工 `verified`？
3. 剪枝的第一版只做“提示不做动作”，还是一开始就产合并建议？
4. `merge` 合并动作怎么落地：合并后的新条目该继承哪一条的 `valid_from`（取早的？）
5. Dream 是否需要“白天也有一次轻量校正”（现在只在空闲触发）？
