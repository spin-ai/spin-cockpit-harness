> 层：架构 · 状态：记录 · 核对：2026-11-14 · 覆盖：记忆 / 人像 / 知识 / IM 一轮落地记录

# 记忆 / 人像 / 知识 / 即时通信（2026-11）

对应需求：`docs/product/REQ-modules-original.md` 的 Knowledge、LLMWiki-06、Memory、Persona、MultiTerminal-01、IMAgent、Chat-01(IM 入口)、Worktree-02、DataRelease-01。

四个新模块都用独立库（`node:sqlite`），删掉即可重建，不动 `harness.db`：

| 模块 | 目录 | 入口 |
|---|---|---|
| 知识索引（已存在，本轮接前端） | `userData/knowledge/kb.db` | 左栏「知识」 |
| 记忆 / note / Dream | `userData/memory/mem.db` | 左栏「记忆」 |
| 人物建模 | `userData/persona/persona.db` | 左栏「人物」 |
| IM 会话映射 | `userData/im/sessions.json` | 设置 → 即时通信 |

## 1. 知识（资料 + 页面）

- 后端本来就支持 PDF / Office / EPUB / 网页、扫描件 VLM 兜底、中文 bigram 检索、页级定位；本轮补前端：
  `src/components/Knowledge.tsx` — 导入、资料列表、一条查询同时返回**资料片段**与**页面**（结果标类型）、带 `p12` 页码引用的问答。
- 「问资料」只基于候选片段，无依据返回「材料里没有」；缺 Ark key 时降级为纯检索并提示。
- 删除资料会顺带把引用它的知识库页面标为 `stale`（`knowledgeRemove` 返回 `staledPages`）。
- Agent 侧新增 MCP 工具：`knowledge_search` / `knowledge_ask`。

## 2. LLMWiki-06：问知识库走模型

`pluginInvoke(wiki.ask)` 现在优先走模型：以 `wiki.search` 命中的页面为候选集调用 Ark，
要求每段结论用 `[[页面]]` 标出处；没有 key 或调用失败时自动落回插件的检索式抽句（原来行为不变）。

## 3. 记忆：L1–L4 / note / Dream / 回查

- `electron/memory/index.mjs`
  - `entries`：四层条目，L4 只放目录/结论/入口
  - `notes`：未验证观察（独立对象，不进页面审核流，必须有来源）
  - `suggestions` + `rejects`：Dream 建议与「拒绝过不再打扰」
- 注入：run 启动时 `inject()` 按预算（`meta.injectBudget`，默认 12000；以前 run 写死 6000、UI 写 12000，两边对不上）做减法，超了显式写「已省略 N 条」；「记忆」页右侧可查看本次注入了什么。

### 3.1 遗忘语义与打分注入（2026-11-15）
上一轮的四层能用，但「忘」只有 `status='archived'` 一个开关，被过期 / 删除 / 剪枝 / 冲突共用。这一轮把它拆开：

- **invalidate**：`entries.invalid_at / superseded_by / supersedes / valid_from`，`promoteNote({ supersedes })` 显式声明推翻哪条；`entryAsOf(at)` 按时间回看。**失效不删行**——L4 每次会话都注入，同主题多条 active 结论就是记忆污染。
- **decay**：`notes.kind / confidence / expires_at`，按 kind 给默认 TTL（guess 14d、preference 90d、gotcha 180d、rule/decision 不过期），人工 `verified` 后清 TTL。
- **evict**：仍是 `status='archived'`，可 restore；「已过期 / 归档」视图现在同时列已失效条目，并标「已失效 · 有新结论取代」。
- **注入改成打分**：置顶 50 / 有来源 30 / 层级（L4=15、L3=8）/ 近两周 10 / log(1+被用)；note 单独预留 `min(2000, 预算×25%)`；**L1 硬排除**（以前被注入了）；每条入选或被裁都带 `reason`。
- **`entrySearch` 换 bigram**：整串 `LIKE` 查不到两字中文词。
- **写入闸门**：`noteAdd` 没 `source_ref` 直接报错（`manual` 也要写清谁写的）；超 400 字符拒绝并提示去写页面；正文归一化后哈希去重，同一句话只存一行，重复写只 `confidence +0.1`。
- **注入台账**：`inject_log` 只在 `inject({ runId })` 时写，预览不写；run 结束后 `markCited` 用本轮 assistant 文本回填（标题片段归一化后 ≥6 字命中就算被用到），命中 `hit_count +1` 进下一次打分；`injectionStats()` 给轮数 / 注入数 / 命中数，记忆页注入预览下方直接显示。归因很粗，只能分「从没被用过」，分不出「用错了」。
- **L1 索引**：`mem.db` 里建 `transcript_fts`（bigram FTS5）+ `transcript_map`（ref → rowid，用于 upsert）；`openDb({ onTranscript })` 钩子在 `addMessage` / `updateMessage` / `addEvent` 时同步一条（包 try/catch，索引失败不弄坏写入）。启动时 `transcriptSync` 清孤儿 + 补缺失（不用条数相等判断，事件是 300 条滚动窗口）。`run_read` 仍未做，runs 还是内存扫。
- **Dream 多两项确定性检查**：`merge`（同 kind 观察的 bigram 包含度 ≥ 0.9 且 token ≥ 4，接受后多余那条标 stale）与 `correct`（结论 `invalid_at` 后，支撑它的 note 产「复核观察」建议）；每日建议预算落 `meta.dreamBudget`，默认 200 条，记忆页显示「今日 N / 上限 M」。
- **改写建议 `rewrite`**：只对 `status = new` 的观察提出（`verified` 是人确认过的，不许被模型改写）；不许引入新事实——新增 token ≤ max(2, 原句 20%) 且原句包含度 ≥ 0.5，两条都过才入队；接受后旧正文进 `note_revisions` 再覆盖，随时可回退。
- **Dream 循环化（2026-11-16）**：提案带 `diff / base_rev / confidence / dream_id`，接受前校验目标版本（人改过就标 `superseded`，不覆盖）；语义 pass 的候选带证据（观察自己的 L1 出处 + 相关会话片段 + 页面引用原句），`correct` 必须有证据且 ref 必须是给过它的；`dreamFingerprint` 幂等（输入没变不重跑）；空闲触发（`idleMinutes`，无 run 在跑才跑）；每轮写 `dream_runs` 台账，记忆页显示「上次 空闲 · N 分钟前 · 几条 · 耗时」。
- **语义 pass（默认关）**：`llmPass` 打开后，Dream 多跑一次模型调用（最近 60 条观察），产出 `merge` / `correct` 建议；三道闸门（开关 / key / 当日调用预算 20 次）+ 入队校验（id 必须存在、keep 必须落在 ids、必须有 reason、同组 id 只入队一次）。解析器 `parseDreamItems` 是纯函数，禁得起脏输出。
- **`run_read`**：单 run 回查（状态 / 耗时 / token / 错误 + 最多 20 条消息 + 提到它的关键事件），与 `memory_search` 分工明确。
- 回归：`npm run memory:selftest`（临时目录，含老库补列）、`npm run memory:preview`（渲染层预览：断言 + 亮/暗截图，不启动 Electron）。
- **记忆页 UI**：观察卡片显示种类（规则/踩坑/偏好/决定）、「已到期」或「至 MM 月」（完整日期在 title，队列行空间窄）；条目显示「置顶」；归档视图把「已失效 · 有新结论取代」和「已归档」分开表达；行内菜单多一项「标记失效（保留溯源）」，与「标为过期」是两个语义。- Dream 五种动作全部落地，只产建议：
  `fix`（失效引用 / 缺摘要）、`build`（有资料无页面）、`fill`（无引用无反链）、`promote`（已验证观察）、`prune`（L3 体积超限）。
  接受后由 `applyMemorySuggestion()` 执行（建 draft / 生成页面 / 标 stale / 归档条目），拒绝写 `rejects`。
- 回查：`memoryTranscriptSearch` 只读检索消息 / run / 事件，带时间与 thread/run id；Agent 通过 `memory_search` 使用。

## 4. 人物（Persona / 人物建模）

- `electron/persona/index.mjs`：导入聊天导出 → 规则抽取（偏好 / 硬约束 / 目标 / 事件 / 立场 / 关系）。
- `electron/persona/chat-import.mjs`：**格式适配层**，认四种导出（`format` 会写进导入结果，UI 提示「识别成了什么」）：

  | 格式 | 判据 | 解析要点 |
  |---|---|---|
  | `telegram` | `messages[]` 里出现 `from_id` / `date_unixtime` | `type!=='message'` 跳过；`text` 可能是数组（`[{type,text}]`），拼接后取；时间优先 `date_unixtime` |
  | `feishu` | `sender.name` + `body.content` / `msg_type` | `body.content` 是 JSON 字符串，取里面的 `{text}`；`create_time` 毫秒 |
  | `wechat` | txt 里出现 `YYYY-MM-DD HH:MM` | 认两种行头（`时间 说话人` / `说话人 时间`）与 `说话人: 内容` |
  | `csv` | 表头含 时间/发送者/内容（或 time/sender/text） | 支持逗号与制表符；无表头按「时间,说话人,内容」假定并给 warning |

  **认不出就不猜**：格式不明时返回空消息 + warning，由调用方决定是否回落到旧的 `parseChat`。
  自检：`npm run persona:selftest`（四种格式 + 兜底/坏 JSON，纯函数、不联网）。

### 4.8 记忆语义：记什么 / 推翻什么 / 什么时候忘（2026-11）

> 上下文是缓冲区，记忆是对显著信息的结构化保留和对噪声的主动遗忘。
> 「遗忘」是四个不同语义的操作，混用会直接损害画像一致性。

| 操作 | 在我们这里是什么 | 实现 |
|---|---|---|
| **记什么** | 只记「重算不出来、需要人确认」的观察（belief）。数得出来的测量值（measure）进 `measures`，只留最新值 + 上一次值 | `commit()` / `setMeasure()` |
| **推翻（invalidate）** | 单值字段（身份/角色/处境/价值观/目标）新值生效时，旧值写 `valid_to = 新值 valid_from`；不删除，`asOf` / `drift` 仍可回查 | `invalidateSiblings()`，`commit()` 与 `resolve()` 共用 |
| **衰减（decay）** | `heat = confidence × 2^(-距上次观察天数/半衰期) × log2(2+证据量)`，读时算、不落库；事件 7 天、承诺 21 天、说话风格 60 天、性格 180 天、身份/价值观 730 天 | `heatOf()`、`HALF_LIFE` |
| **归档（stale）** | 时间敏感事实（事件 / 承诺 / 硬约束）写 `expires_at`（从「下周 / 月底 / 明年」推断，读不到用字段默认 TTL）；到期标 `stale` 进复核队列，不进人设卡与注入，**不删除** | `inferExpiry()`、`sweep()`、`reviewQueue()`、`keepFact()/dropFact()` |
| **逢出视野（evict）** | 多值字段（语气样本 / 说话习惯 / 事件……）在人物卡里只展示 `heat` 最高的 N 条，其余**留在库里当证据** —— 不改状态、不进复核队列，热度回升能再上来 | `FIELD_CAP` + `cardOf` 的 `overflow` |
| **合并（merge）** | 归一化后完全相同的重复值自动合并；近似值（`bigram Jaccard ≥ 0.6`）只出建议，人确认后合并并把证据累加到保留项，旧值标 `merged` | `mergeExactDuplicates()`、`mergeSuggestions()`、`applyMergeValue()` |

- **为什么把 measure 赶出记忆层**：对「群聊 0%」这种每次重跑都会变的测量值做失效管理是徒劳的 —— 失效永远追不上重算，结果就是同一字段堆出多条同时成立的说法。上线前实测：大部分观察集中在 voice/style，`valid_to` 全库一条都没写过，20 组单值字段「同时有效」。现在 measure 只保留最新值，变化记在 `prev_value` / `times` 上，人物卡单独一节展示。
- **证据累积而不是去重丢弃**：`commit()` 命中 `(person, field, value)` 时不丢第二条证据，而是 `evidence_count + 1`、`last_seen_at` 推进、`confidence + 0.03`（封顶 0.95）。人物卡里的「依据 N 条」现在是**证据次数**，不再是「不同值的条数」。
- **拒绝不是永久事实**：`rejects` 保留 `times`，同类事实又独立观察到两次（或距上次拒绝 > 120 天）时会复审一次并在 UI 标「复审」；再次拒绝后计数归零，不会反复打扰。
- **双时间回看**：`asOf({ mode })` 两种口径分开 —— `event` 回放「当时什么是真的」，`known` 回放「系统当时已经知道什么」。人物页右栏可切换。
- **人物级合并走 UI 多选**：合并前必须能看到「合并到『谁』」（按钮直接写名字），合并后跑一遍精确去重（`mergeExactDuplicates`），否则卡片里同一条性格会重复出现两次。
- **run 启动时只注入「任务里点名的人」**（`injectForText`）：任务标题 / 描述 / 补充指令里出现某个联系人名字（≥2 字，含合并后记下的旧名字）时，注入 ≤600 字的画像片段，最多 3 人，敏感项排除；没点名就一个字都不注入。不做全量注入 —— 那是隐私事故 + 预算黑洞。
- **决策辅助只认「问题原词」**（`ask`）：问题里 ≥3 字的词在事实里原样出现 → 采信；否则要至少 2 个不同词命中且 df 加权分够高。只命中一个「这事 / 同意」这类 2 字词根的，一律返回 `found:false` 并摊开可用关系。中文 bigram 检索的误命中率很高，宁可漏也不猜。
- **问「他会怎么反应」但没处事记录**：直接返回 `found:false` 并点名缺哪几个字段（决策依据 / 冲突处理 / 压力反应 / 沟通方式），而不是把语气样本当依据。语气样本回答的是「他怎么说」，不是「他会怎么决定」。
- **一句话概括有时效**（`oneLinerStale`）：`setOneLiner` 记 `one_liner_at`，之后若又有新事实（`created_at` / `last_seen_at` 推进）或新统计（`computed_at`），人物卡会提示「N 天前写的，之后又有新结论」。只看 `created_at`、不看 `updated_at` —— 确认待确认事实也会刷 `updated_at`，那不是新结论。
- **三种「变了」分开呈现**（`drift`）：`drift` = 事实被新说法取代（旧值带 `valid_to`）、`conflict` = 两条同时成立且时间解释不了、`trend` = 可观测特征变了（同一个人不同阶段的测量值，**不是矛盾**）。把 trend 混进 conflict，会让人把「换了工作」和「重算后数值变了」当成同一回事。
- **复核可以批量做**（`reviewMany`）：一个人的到期事实一次「全部仍然成立」或「全部过期」，写回仍然是逐条的 `keepFact` / `dropFact`（没来源、被收口的历史都留着）。
- **到期扫描在启动时跑一次**：注入本来就按 `expires_at` 排除过期项，扫描只是为了让人一打开就能在复核队列里看到它们（只标 `stale`，不删）。
- **注入是检索不是罗列**：`字段优先级 × heat × 与问题相关性`（中文 2-gram）贪心填预算，每节配额上限（处事 40% / 性格 30% / 声音 15% / 基本信息 10% / 事实 5%），分节标题也计入预算，超出的条数如实报 `dropped`。
- **质量指标可见**：`peopleList` / `card.metrics` 给出 `supportMedian`（每字段证据数中位数，恒为 1 就说明记忆没在累积）、`conflictRatio`、`needsReview`、`measureAt`（测量值最后重算时间）。
- **为什么 evict 不做成「标 expired」**：把超出上限的语气样本标 stale，会把复核队列瞬间灌成几百条（老库里 voice 445 条 / 244 人），人就不会再去清它。展示上限是读时的事，回写状态反而把“复核”这个动作稀释了。
- **老库对账**：`npm run persona:reconcile`（先自动备份；`--dry-run` 在副本上跑）。做四件事：`source_kind='stats'` 的观察 → `measures`；单值字段按时间收口；归一化相同的重复值合并；补 `expires_at` 并标 stale。
- **自检**：`npm run persona:lifecycle`（临时目录，四类遗忘 + 证据累积 + 复审 + 双时间 + 注入预算 + 检索上限 + 人物合并 + 点名注入）；`npm run verify:persona` 一次跑接线 + 导入格式 + 生命周期。
- **统计特征不再依赖「建模」**（不花钱的部分人人都有）：`applyStats()` 是唯一写入路径，`import()` 在解析完就给「本批发言 ≥10 条」的人算一遍特征（返回 `statsUpdated` 条数 / `statsPeople` 人数，导入提示里说「N 人算出可观测特征」），`personaModel` 复用同一条路径。历史数据用 `npm run persona:stats`（`--apply` 才写）回填：本机 118 人 / 1360 项，跳过 566 个库里没有的发言人、146 个发言不足 10 条的。
- **待确认队列按「证据质量」分三组**（`personaPending` 返回 `evidenceStat` + 三态 `quoteVerified`）：
  ① 引用核过（`quoteVerified === true`，且引用 ≥6 字）→ 「只确认这些」，批量但不盲目
  ② 核不到（`false`）→ 统计值那部分给「这些直接拒绝」，其余标「引用待核对」逐条看
  ③ 没有可用引用（`null`：模型归纳 / 太短）→ 必须逐条判断
  敏感项永不进任何批量动作。本机实测：142 条 pending = 49 可确认 + 49 核不到（41 统计值 / 8 找不到）+ 44 无可用引用。
- **存量结论的回查**（`npm run persona:verify-quotes`，`--apply` 才写）：旧版本的 evidence 从来没校验过。按语料（该人发言 + 紧邻上下文）回查分三类 —— 原话找得到 / **证据其实是统计值** / 找不到原话。本机实测 111 条带引用的模型结论：49 条找得到、41 条证据是统计值、8 条找不到、13 条无法判定。前两类已标 `quote_verified=0`；「证据是统计值」那批在待确认块里单独提示并给「这些直接拒绝」入口（统计结论已由 measures 承担）。
- **引用可核对**（`quote_verified`）：模型给的 `evidence` 必须能在「它当时看到的样本」里核对上（宽松归一化 + 允许截断）。核不到的不删不拦，标 `quoteVerified:false`、`heat × 0.6` 降权、卡片与待确认队列标「引用待核对」，建模汇总里报条数。**存量 pending 无法回溯核对**（没存当时的样本），新跑的一律核对。
- **面向人的方法论**写在 `resources/wiki/persona.md`：App 内「说明」页（`src/wiki/pages.ts`）和 GitHub Wiki（`scripts/publish-wiki.mjs`）同源，人在平台里就能读到四种「忘」的判据与踩过的坑。
- **接线自检**（`npm run verify:persona` 第一段）：这个模块的接线是「渲染层 `act("x")` → 主进程动作表 → MCP 工具名」三处手抄，改名字不会报错、只会静默失灵（踩过：`autoConfirmStats` 成了死参数）。脚本静态校验 ① 人物页调用的每个动作主进程都有 ② 新增动作的字段名与后端一致 ③ MCP 工具都有 `name === "…"` 分支。
- **UI 预览**：`npm run persona:preview`（headless Chrome + vite，注入 mock `window.harness`，不启动 Electron、不抢焦点），断言页面能把四种状态表达出来并出亮/暗两版截图到 `.preview/`。

### 4.7 时间演变与回看（`US-Persona-03`）

- **`valid_to` 由「确认」驱动**：确认一条单值字段（`identity / role / situation / value / goal`）时，两个方向都处理——
  ① 比我旧的收口到我生效的时刻；② 若已有比我新的事实，我立刻收口。
  只做方向 ① 会出 bug：先确认新的、再确认旧的时候，新旧关系会被写反（实测踩过）。
- **`asOf(personId, at)`**：`valid_from <= at` 且（`valid_to` 为空或 `> at`）的已确认事实，按字段分组。单值字段给 `value` + `history`（含 `to`），多值字段给去重后的 `values`。
- **回看 UI**：人物页右栏「回看」选日期 → 显示当时的值，并提示「之后变成 X」；「回到现在」清除。
- **矛盾 vs 漂移**：`detectConflicts` 只在**两条同时有效**（`validTo` 都为空）时标 `conflict`；时间顺序能解释的一律算「漂移」，且每次检测先清旧标记，避免把正常更替当成矛盾。

### 4.6 群聊 / 一对一分权（`US-Persona-02` / `US-Persona-05`）

- **上下文来源**：优先用导出自己声明的会话类型（Telegram `type`、飞书 `chat_type`），认不出才按「发言人数 > 2 → 群聊」推断；结果写进 `observations.context` / `relations.context`（`group` | `direct`）。
- **`group_only` 的唯一含义**：此人**只在群聊里出现过**。每次导入后重算：

  ```sql
  UPDATE people SET group_only = CASE
    WHEN EXISTS (SELECT 1 FROM observations o
                 WHERE o.person_id = people.id AND o.context='direct' AND o.status!='rejected')
    THEN 0 ELSE group_only END
  ```

  即：先群聊后私聊，私聊一进来就自动降级，不会把人永久锁在「仅群聊」。
- **强度**：一对一关系 `0.6`，群聊里的一句话 `0.3`——「不把群里的单次互动当成亲密关系」在数据层就成立，不用靠 UI 判断。
- **展示**：人物卡「关系网」对 `context='group'` 的关系标「仅群聊」。
- **坑**：`observations` 原本是全列占位 INSERT，加了 `context` 列后立刻炸（`17 columns but 16 values`）。所有写入已改成**显式列名**，后续加列不会再坏。
- 所有抽取结果 **pending**，确认才生效；拒绝留痕不重复打扰；无来源不能确认；敏感项单独标记。
- 三层：本人 / 他人 / 关系；群聊标记 `groupOnly`，不把群内互动当亲密关系。
- 时间线按字段给出演变，矛盾值标 `conflict`。
- **字段分五组**（`FIELD_GROUPS`）：基本信息 / 性格与价值观 / 处事方式 / 说话风格 / 其他事实。
  处事（`decision` `conflict` `stress` `commitment` `communication`）与说话风格（`style` `voice`）是后补的：
  只靠偏好、立场这类陈述性事实回答不了「他大概率会怎么反应 / 怎么说」。旧库不用迁移，新字段只是多几类观察。
- **人物卡** `personaCard`：一句话概括 + 分节 + 每节证据（quote / 来源 / 时间 / 支撑条数 / 置信级别）。
  一句话只用已确认观察拼，不调模型；敏感观察不进卡，只报数量。
- **注入预览** `personaInject`：按「处事 > 性格 > 说话风格 > 基本信息 > 其他事实」拼 Markdown，超出预算逐条裁剪并报 `dropped`；敏感项永不注入。
- **变化与矛盾** `personaDrift`：只有「新说法取代旧说法」的字段（身份 / 角色 / 处境 / 价值观 / 目标）判漂移与矛盾；
  处事类多条观察是互补的面，不判为矛盾。
- **列表** `personaPeople`：每人带已确认 / 待确认计数与人设卡完整度（按 15 类字段覆盖率，事实类不计入）。
- 角色卡导出（菜单项「导出角色卡 JSON」）字段对齐 Character Card V2（`description` / `personality` / `mes_example`），方便和外部生态互换。
- 决策辅助（`personaAsk`）：该找谁 / 会怎么反应 / 关系网络 / 影响谁；没证据时返回 `found:false` 并摊开可用关系，不猜。
- Agent 通过 `persona_lookup` 使用。

## 4.5 人物建模（2026-11）

之前「人物」只是把聊天记录里能正则命中的句子存成事实，页面看起来就是聊天摘要。现在补了一层**可观测建模**：

| 特征 | 怎么算 | 写进哪 |
|---|---|---|
| 话量 / 活跃天数 / 每日条数 | 该人消息数、按自然日聚合 | `traits` |
| 句长结构 | 字数中位数（转发长文不污染均值） | `traits` |
| 回复时延 | 在**整段会话时间线**上找「别人说完 → 他接话」的间隔，取中位数 | `communication` |
| 提问 / 礼貌用语 | 问句比例、谢谢/收到/好的 比例 | `communication` |
| 语气与符号 | 笑声（哈哈/笑死/233）、表情、省略号、感叹号、口语化词 | `style` |
| 活跃时段 / 高频词 / 群私聊结构 / 最常互动的人 | 时间分布、词频（去停用词）、相邻发言配对 | `situation` |

- 统计出来的结论**直接生效**（`status=confirmed`），因为它们数出来、不是推断；证据原话写进 `quote`
- 入口与两种模式：人物页头「建模」（默认 12 人）→ `personaModel({ mode: "llm" | "stats", limit, minMessages, names, concurrency, model, ignoreCache })`；`⋯` 里另有「一键全部建模」（`limit=0`）、「只跑统计（不调用模型，不消耗额度）」、「忽略缓存重跑（默认 12 人）」；侧栏多选后是「建模所选」。
- **在主进程里跑**：`personaModelStatus()` 给进度（`running / done / total / current / stage / cards / llmAdded / statsAdded / skippedCache / skippedNames / failed / failedCount`），`personaModelCancel()` 立刻 abort；切页返回会从 `personaModelStatus` 把进度接回来。
- **并发与超时**：默认 2 路并发（`concurrency` 夹在 1–4），每人的请求挂自己的 `AbortController`，90s 传输超时 + 95s 兜底 race，取消立即释放连接。
- 模型结论写 **pending** 等人工确认；统计事实按 `autoConfirmStats` 默认直接 confirmed。
- 幂等：按 (person, field, value) 去重；重复跑新增 0 条是**正常**（去重，不是失败）。

### 4.5.1 模型调用的 key 与缓存（踩过的坑）

- **key 必须走设置**：`arkKeyFromSettings()` 取「设置 → 执行 → 模型密钥 / 环境变量」里的 `ARK_API_KEY`，再无 key 才回落 `resolveArkKey`（进程环境变量）。
  以前 `personaModel` 只读 `process.env.ARK_API_KEY`：从 Finder 双击启动的 App 没有这个环境变量，`analyzePersonWithLLM` 每人立即 `return null`，整轮跑完显示「0 人出卡 · 0 条结论」，**一条错误都不报**（实测）。现在缺 key 直接抛错并指路设置页。
- **缓存键**：`analysisCacheHash = sha1(契约版本 | 模型 | 姓名 | 样本)`，实现在 `electron/persona/model.mjs`；`personaModel` 与 `personaModelPlan` **必须用同一个函数**（计划页原来只看「有没有缓存」，样本变了也会说「预计 0 次调用」，把「一键全部建模」挡死）。
- **只在有结论时写缓存**：`ANALYSIS_CACHE_VERSION`（现在 `v2`）递增会让全部旧缓存失效。旧逻辑是「卡片能解析就写缓存 + 写一句话」，模型换了输出结构（比如 traits 从对象数组变成字符串数组）时一条结论都落不了库，缓存却写上了 → 同一份样本永远命中缓存，卡片永远只有统计事实。
  现在只有 `produced > 0`（模型真的给出非空、非「未知」的结论）才 `setAnalysisCache`；字段结构对不上就记入 `failed`、不写缓存，下一轮还能重试。
- **跳过/失败要说出来**：完成提示与进度卡显示「缓存跳过 N 人（前 3 个名字）」与「N 人未出结论：首个原因」，不再只报 0。
- **缓存不是「删掉结论」的同义词**：逐条删观察（`personaObsRemove`）/拒绝结论不会清缓存，要重建就用「忽略缓存重跑」（`ignoreCache: true`）。

实测（旧口径，万级条微信）：60 人建模 → 数百条特征（traits / situation / style / communication）；
「纸鸢戏」完整度 34% → 52%（平均每个活跃日 15 条、中位时延 2 分钟、爱用笑声、活跃 11–14 点、最常互动 A/B/C）。
**完整度≥50 需要 identity/role/value/goal 这类字段**，统计只能覆盖行为面，所以「人设卡就绪」只从 1 人涨到 2 人 —— 要更多就绪只能手工补或跑模型模式。

## 5. 即时通信（IM）

> 渠道范围已收窄为**只做飞书**（2026-11-15）。本节是当时的一轮落地记录；边界、飞书接入路径与未做项以 [`ARCH-im-gateway.md`](ARCH-im-gateway.md) 为准。

- `electron/im/gateway.mjs`：Telegram（`getUpdates` 长轮询，真实可用，现为非目标渠道）+ 飞书/微信出站 webhook + 本地入站 HTTP（`POST {chat_id, text}`）。
- 安全：只处理 allowlist；陌生会话忽略并留日志；入站要求 `Bearer` token。
- 入站消息走 `actions.send()` → 同一套 thread/todo/run；`im/sessions.json` 记录 chat ↔ todo。
- run 结束回传三段式卡片（结果 / 步骤 / 协议身份）；审批时推「回复数字」卡片，数字消息即选择。
- 桌面关闭时：Telegram 侧消息留在 offset 队列，下次启动继续；飞书/微信入站需要公网可达（或用内网转发），这条限制在设置里写明。

## 6. 其余补齐

- **MultiTerminal-01**：终端 5 分钟无新输出 → 主进程 `terminalIdleOf()` 标记 `stalled`（事件 `terminal.stalled`），终端标签显示 ⚠。
- **Worktree-02**：手工终端「接入任务」时可选择保持当前目录或切到该任务最近的 worktree（只影响后续 run）。
- **DataRelease-01**：`dshEnv`（含 API key）用 Electron `safeStorage` 加密存放（`enc:` 前缀），启动时自动迁移明文；UI 读取时解密，行为不变。
