> 层：架构 · 状态：提案 · 核对：2026-11-14 · 覆盖：第 1 轮五件关键技术的波形与验收

# 第 1 轮计划：五件关键技术的波形与验收

> 依据：`docs/arch/ARCH-key-tech.md` §0.2「应对」与 §7「落地顺序」、`docs/arch/ARCH-knowledge.md`、`docs/arch/ARCH-office.md`、`docs/arch/ARCH-memory.md`、`docs/arch/ARCH-memory-persona-im.md`。
>
> 本文只定计划、口径与验收，不写业务代码；落盘本文不改 `docs/arch/` 既有正文。编排切片执行时对 `ARCH-office.md` 的「只增一节」是唯一例外，见 §2.E。

---

## 0. 本轮判断

### 0.1 基线事实（只列与本轮切片有关的部分）

| 技术 | 现在的状态 | 本轮切到哪 |
|---|---|---|
| ① 解析 | 本地直抽可用；页图已能渲染；**VLM / OCR 兜底仍是空实现**；解析质量**没有任何度量**（`ARCH-key-tech.md` §①） | 只建评测骨架与基线，不碰解析链路 |
| ② 编排 | Mission / 子任务 / delegation / worktree / 审批已落地；办公室是 `State` 的空间化投影；`ARCH-office.md` 有区域与优先级，**没有「3 Agent 并行」的期望映射** | 只补文档映射，不改舞台与调度 |
| ③ 整理 | `plugins/notes` 有确定性的 `wiki.curate`；`wiki.dream` 只返回一次性 issues，**没有持久建议队列、没有后台扫描** | 后台扫描只产建议，绝不改 `reviewed` |
| ④ 记忆 | L2 note 有 TTL / verified / promote；`promoteNote` 目前只拒绝 `rejected`，**对过期、stale、无来源的边界没有收口**；自检覆盖衰减与注入，未覆盖完整晋升边界 | 收口边界 + 补断言，不做新记忆功能 |
| ⑤ 画像 | `asOf` / `valid_to` / 群聊降权已实现；有 import / lifecycle 自检；**没有专门断言这三条契约的脚本** | 只加契约自检，不改抽取算法 |

### 0.2 本轮目标

一句话：**先把「尺子」和「闸门」立起来，再让后台与文档动起来。**

- Wave 1 只做「可量、可验」：解析有评测骨架，记忆有晋升边界，画像有契约断言。不改产品主流程（B 只收口既有边界，不新增记忆功能）。
- Wave 2 才做「会改变行为/口径」的两件事：整理后台建议扫描、办公室 3 Agent 并行映射。
- 本轮**不要求**四项解析指标达标；只要求「能稳定测出来、样本不足会说不够、阈值可一键 gate」。指标达标属于后续 VLM / 表格 / 分块轮次。

### 0.3 本轮不变式（五个切片都适用）

1. **机器只提出，人点头**：建议、晋升、确认都不能由后台自动完成（`ARCH-key-tech.md` §0.2）。
2. **后台绝不静默改 `reviewed`**：整理切片以「扫描前后 reviewed 快照深度相等」为硬验收。
3. **没有度量不优化**：解析切片不修 parser；先出基线，再排 VLM。
4. **没有证据不进队列、不能晋升**：建议必须带 evidence；note 晋升必须可追溯。
5. **不引入服务进程/新原生依赖**：本轮不碰 Docker、Python、向量库、OCR 服务。
6. **不为了让测试变绿而改口径**：阈值、归一化规则、样本数在 Wave 1 第 1 天冻结，之后只允许写明理由的修订。

### 0.4 本轮出口判据

- [ ] A 的评测脚本在干净环境可跑；有 20 份样本时产出基线，不足 20 份时明确说「样本不足」，不假装通过。
- [ ] B 的边界用例全绿：过期 / rejected / stale 不能晋升；晋升后 note 清过期、条目可回查。
- [ ] C 的契约断言全绿：`asOf` 边界、`valid_to` 双向收口、群聊 0.3 / 一对一 0.6；若触发既有 bug，则最小修复或 `KNOWN-FAIL` 登记，不得静默弱化。
- [ ] D 的扫描只写建议队列；reviewed 快照零变化；拒绝后 30 天不重复；接受走既有写入路径。
- [ ] E 的映射表能被人拿去逐行判对错，且列出当前代码的「已知差异」，不是散文。
- [ ] 五个切片的验证命令、证据文件、风险更新都进了同一份收口记录（§4）。

---

## 1. 两个波形

### 1.1 波形总表

| 波形 | 切片 | 谁并行 | 依赖 | 时间盒 |
|---|---|---|---|---|
| **Wave 1 · 立尺** | A 解析 eval 骨架<br>B 记忆 note 边界 + 自检<br>C 画像契约自检 | A、B、C 三路并行 | 无硬依赖；三者写不同目录、互不 import | 1.5–2 人日 |
| **Wave 2 · 动行为** | D 整理后台建议扫描<br>E 编排「3 Agent 并行」映射 | D、E 两路并行 | **D → B（硬依赖）**：复用 B 冻结的建议队列契约<br>E 无代码依赖（软依赖：等 Wave 1 口径定稿再落文档） | 1.5–2 人日 |

```text
Wave 1（并行）
  A 解析 eval ──────────────────────────────┐  产出：4 项指标 + 基线/样本闸门
  B 记忆边界 ───────────────┬───────────────┤  产出：TTL/晋升边界 + 断言
  C 画像契约 ───────────────┘               │  产出：asOf/valid_to/群聊断言
                                            │
Wave 2（并行）                              │
  D 整理扫描 ←──── 复用 B 的队列/证据/冷却契约
  E 编排映射 ←──── 只依赖 State 字段与 §2 优先级（与 D 并行）
```

### 1.2 为什么这样排

**Wave 1 三路并行的理由**

- 三者都是「只加度量/断言」：A 只新增脚本与 fixtures，B 只改 memory 的边界与自检，C 只新增画像脚本；都不改 UI、不吃网络、不动主路径。
- 文件所有权不重叠：A 在 `scripts/knowledge-eval.mjs` + `fixtures/`，B 在 `electron/memory/index.mjs` + `scripts/memory-selftest.mjs`，C 在 `scripts/persona-selftest.mjs`。可以同一天开三路，不需要互相等。
- 先有尺子，后面两轮才不会被「感觉变好了」带着走：解析是唯一「做了但看起来不像做了」的模块（`ARCH-key-tech.md` §6），必须先有数字。

**Wave 2 的依赖理由**

- **D 硬依赖 B**：整理扫描要写「建议队列」，而队列的字段、证据必填、接受/拒绝留痕、同类 30 天冷却、接受后走正常写入路径，这些语义由 `ARCH-memory.md` §7.3 统一规定。B 先把这套契约用测试钉死，D 直接复用同一套字段与状态机，避免插件里再发明第二套「建议」。
- **E 没有代码依赖，但有评审依赖**：它要写的是「期望映射」，必须等 Wave 1 的验收口径（什么算可观察、什么算证据）定稿后再落笔，否则容易写成 Implementation 说明。E 与 D 文件不冲突，放在同一波并行；若 Wave 1 提前完成，E 可以提前启动，D 仍必须等 B。
- **D 不提前到 Wave 1**：在没有 B 的契约前做扫描，最可能的结局是「建议能出，但接受/拒绝/冷却各写一套」，Wave 2 再返工。这是本轮最不值得省的一天。

### 1.3 文件所有权（并行边界）

| 切片 | 主写文件/目录 | 明确不碰 | 共享文件由谁改 |
|---|---|---|---|
| A 解析 | `scripts/knowledge-eval.mjs`、`fixtures/knowledge-eval/**` | `electron/knowledge/**` 解析实现 | `package.json` 脚本由 PM 统一加 |
| B 记忆 | `electron/memory/index.mjs`、`scripts/memory-selftest.mjs` | `plugins/notes/**`、`electron/persona/**` | 同上 |
| C 画像 | `scripts/persona-selftest.mjs` | `electron/persona/**`（除非发现真 bug，见 §3） | 同上 |
| D 整理 | `plugins/notes/main.mjs`、`scripts/notes-scan-selftest.mjs` | `electron/memory/**` | 同上 |
| E 编排 | `docs/arch/ARCH-office.md`（只增一节） | 其余 `docs/arch/**`、舞台代码 | `docs/README.md` 索引由 PM 改 |

> `package.json` 和 `docs/README.md` 是五个切片的主要共享写点。指定 PM 做集成，Owner 不各自改，避免并行冲突。

---

## 2. 逐切片验收

### A. 解析 Owner — `scripts/knowledge-eval.mjs`

**要解决**：解析质量现在零度量；没有基线，后续 VLM、表格、分块的所有「提升」都是猜（`ARCH-key-tech.md` §7 第 1 项）。

**交付物**

- `scripts/knowledge-eval.mjs`：读 fixtures、建临时 `kb.db`、导入、检索、输出 4 项指标。
- `fixtures/knowledge-eval/manifest.json`：样本清单、人工标注、查询集、阈值。
- `fixtures/knowledge-eval/smoke/`：3 份可提交的合成样本（数字原生 PDF、带表格的 DOCX/XLSX、Markdown），用于 CI 冒烟。
- `fixtures/knowledge-eval/local/`：20 份真实材料 + GT，**gitignore**；仓库只提交 manifest 里的 `sha256` 与标注。
- `fixtures/knowledge-eval/baseline.json`：跑完 20 份后生成。
- `package.json`：`knowledge:eval`、`knowledge:eval:smoke`。

**默认行为**：`knowledge:eval` 默认读 `fixtures/knowledge-eval/local`；`knowledge:eval:smoke` 等价于 `knowledge:eval -- --smoke`（读 `smoke/`，不要求 20 份，不出质量结论）。这样 §4.2 里的 `npm run knowledge:eval -- --json` 有确定含义。

**4 项指标口径（必须先冻结）**

| 指标 | 定义 | 本轮输出 | 终态门槛 |
|---|---|---|---|
| `textCoverage` | 抽取文本与人工标注文本的字符级 LCS ÷ 标注文本长度；按样本字符数加权 | 值 + 分子/分母 + 每份样本值；另报 `textNoise = 1 - LCS/抽取长度` 作诊断 | ≥ 95% |
| `tableCellAccuracy` | 标注表格的单元格归一化（trim、压缩空白、统一全/半角标点）后逐格精确匹配；合并单元格按 manifest 约定展开 | 值 + 匹配格数/总格数 + 表格级明细 | ≥ 90% |
| `citationPageHit` | 每条标注查询取 `kb.search` 第一条结果的 `(doc_id, page_no)`；与标注页完全一致算命中 | 命中数/查询数 + 混淆明细 | ≥ 90% |
| `recallAt5` | 标注的 `(doc_id, page_no)` 出现在 top-5 结果中（同页任一 chunk 即可） | 命中数/查询数 + 每查询 top-5 | ≥ 80% |

**边界口径**

- 页眉/页脚、页码、水印在 GT 中剔除；抽取结果里出现不扣 `textCoverage`，但计入 `textNoise` 并在报告里提示。
- 扫描件单独标 `class: scanned`，**不计入四项 headline**，只报数量与「待 VLM」；数字原生样本单独统计。
- 多页表格按页拆；跨页表在 manifest 里显式标 `crossPage: true`，本轮只报告，不设门槛。
- `citationPageHit` / `recallAt5` 是**端到端**指标：解析变差会反映，但分块/索引也会影响。报告必须同时给 page-level 的 `textCoverage`，避免把检索问题误归因给解析。
- 排序必须确定：`doc_id`、`page_no`、`chunk_id` 作为并列时的次序，避免两次跑结果不同。
- LCS 按页/分块计算，不能对整份长文档做 O(n×m) 全量矩阵；20 份样本单次评测目标 < 10 分钟、单份 >50 页不爆内存。

**验收标准**

- [ ] `npm run knowledge:eval:smoke` 在无 `local/` 的干净 checkout 上可跑：建临时目录、导入 3 份 smoke、输出 4 项指标与样本数，退出码 0。
- [ ] `npm run knowledge:eval -- --fixtures fixtures/knowledge-eval/local --json` 输出合法 JSON，至少含 `sample`、`metrics.textCoverage`、`metrics.tableCellAccuracy`、`metrics.citationPageHit`、`metrics.recallAt5`、`fixtures[]`。
- [ ] 同一样本连续跑两次，四项指标数值完全一致（`generatedAt`/耗时除外）；临时 `kb.db` 跑完清理。
- [ ] 非 `--smoke` 且样本 < 20：打印「样本不足：N/20，未给出质量结论」，退出码 2；任何情况下都不打印「通过」。
- [ ] 样本 = 20：生成 `baseline.json`，每项含分子/分母、加权值、逐样本值、样本分类计数；再跑时打印与 baseline 的 delta。
- [ ] `--gate` 才按门槛返回 1；默认只报告。本轮 CI 使用默认模式，不拿未达标当红灯，但 `--gate` 必须有测试。
- [ ] 缺 fixture 文件、manifest 字段缺失、sha256 不匹配：明确报错并退出 3，不静默跳过样本。
- [ ] `fetch` 在评测进程内被 stub 为抛错，证明全程不出网；不需要 Ark key；用 `ELECTRON_RUN_AS_NODE=1` 可跑。
- [ ] `npm run knowledge:selftest` 与 `npm run knowledge:engines:selftest` 仍全绿；`electron/knowledge/**` 零改动。
- [ ] `fixtures/knowledge-eval/README.md` 写清 4 项定义、3 个边界案例（页眉页脚 / 合并单元格 / 跨页表）、如何新增样本、如何更新 baseline。
- [ ] PM 只看输出就能回答：「20 份里数字原生几份、扫描件几份、四项基线各是多少、哪几份最差」。

**证据**：smoke 输出、20 份 baseline.json、manifest、评测 README、两次运行 diff。

**已知风险**：20 份真实材料可能凑不齐或涉隐私（详见 §3 R1）。允许 Wave 1 以「样本不足 + 缺口清单」收口，但**不进入下一轮 VLM**。

---

### B. 记忆 Owner — note 过期/晋升边界 + `scripts/memory-selftest.mjs`

**要解决**：note 的「衰减」和「晋升」现在有代码但没有完整边界；过期 note 仍能被 `promoteNote` 晋升，会把一次性猜测抬成每次会话都注入的 L4 结论（`ARCH-key-tech.md` §④ 头号风险）。

**交付物**

- `electron/memory/index.mjs`：只加边界守卫与明确错误码；不改表结构、不改注入算法。
- `scripts/memory-selftest.mjs`：新增「[边界]」小节。
- 不改 `docs/arch/ARCH-memory.md`（它已经是权威口径；代码对齐它，不是反过来）。

**边界定义（本轮拍板）**

| 场景 | 行为 |
|---|---|
| `guess` 默认 TTL | 14 天；`preference` 90 天；`gotcha` 180 天；`rule` / `decision` 不过期 |
| 显式 `expiresAt: null` | 不过期 |
| 人工 `verified` | 清空 `expires_at`，此后不衰减 |
| 到期 | 行保留、`expired=true`、不进注入；可 `noteList` 查、可 `noteRemove` 删 |
| 晋升源 | 只允许 `new` 或 `verified` |
| 晋升过期 note | 拒绝，错误码 `E_NOTE_EXPIRED`；先人工重新验证，再晋升 |
| 晋升 rejected | 拒绝，`E_NOTE_REJECTED` |
| 晋升 stale | 拒绝，`E_NOTE_STALE` |
| 晋升成功 | note → `verified`、`expires_at=null`；条目的 `sources` 至少含 `note:<id>`，有 `sourceRef` 时一并保留 |
| `supersedes` | 只认显式传入；旧条目 `invalid_at`/`superseded_by` 可回查；不按标题相似度猜 |
| 版本 | 成功的写操作 +1；被拒绝的晋升不 bump `memory_version` |

**验收标准**

- [ ] `npm run memory:selftest` 全绿；新增 case 名称以 `[边界]` 开头，失败时打印期望/实际与 note id。
- [ ] TTL 五类逐项断言：`guess` 14 天、`preference` 90 天、`gotcha` 180 天、`rule`/`decision` 无 `expiresAt`；`expiresAt:null` 无过期；容差 ±5s。
- [ ] `verified` 清空 `expires_at`；把时间推到 TTL 之后，`noteList` 仍返回且 `expired=true`，`inject` 不包含该条。
- [ ] `promoteNote` 对 expired / rejected / stale 分别抛 `E_NOTE_EXPIRED` / `E_NOTE_REJECTED` / `E_NOTE_STALE`；失败后 `entries` 数量不变、note 状态不变、`memory_version` 不变。
- [ ] `promoteNote` 对 `new` 与 `verified` 成功；条目 `sources` 含 `note:<id>`；note 变 `verified` 且 `expiresAt=0/null`。
- [ ] `supersedes`：旧条目的 `invalidAt === 新条目.validFrom`、`supersededBy === 新条目.id`；`entryAsOf(before)` 能看到旧条目，`entryAsOf(now)` 只剩新条目；`entryRestore` 后旧条目回到 active 且新条目 `supersedes` 摘掉。
- [ ] `promoteNote` 拒绝「无来源」的 note：`sourceRef` 为空且 `sourceKind='manual'` 时，要求显式 `sourceKind`/`sourceRef` 或先补证据（错误码 `E_NOTE_NO_SOURCE`）；测试覆盖。
- [ ] 旧库升级：用含旧列的临时 `mem.db` 打开，自动补列后可读写；不要求用户删库。
- [ ] 注入的 `items` 里能看出每条 note 被收录/拒绝的原因；`included=false` 的 note 原因包含「过期」「预算」之一。
- [ ] 生产代码改动只限边界守卫（diff 可读，< 80 行）；不改 DDL、不改 `inject` 排序、不改 score 公式。
- [ ] `npm run typecheck` 通过；`memory:selftest` 在临时目录跑，不碰 `userData`。

**证据**：自检输出、错误码用例、旧库升级用例、diff。

**备注**：如果 `E_NOTE_NO_SOURCE` 会破坏现有手工 note 的晋升，本轮可只对「新建 note」强制；历史 note 走「补来源后晋升」并在错误信息里给出补法。这个决定由 B Owner 在 Wave 1 第 1 天报 PM，不得静默放宽。

---

### C. 画像 Owner — `scripts/persona-selftest.mjs`

**要解决**：`asOf`、`valid_to`、群聊降权是画像可信度的三条硬契约，现在散在 lifecycle/import 自检里；缺一份「只断言契约」的脚本，改动时容易悄悄破坏。

**交付物**

- `scripts/persona-selftest.mjs`：临时目录、纯后端、不联网。
- `package.json`：新增 `persona:contract`；**不改** 现有 `persona:selftest`（仍指向 import 格式自检），避免破坏文档与习惯。
- 不改 `electron/persona/**`；除非断言暴露真 bug（见下）。

**断言矩阵**

| # | 契约 | 固定时间点 | 期望 |
|---|---|---|---|
| 1 | `asOf` 事件口径 | `t1` 之前 | 旧值不可见 |
| 2 | `asOf` 事件口径 | `t1`（旧值 valid_from） | 旧值可见 |
| 3 | `asOf` 事件口径 | `t2`（新值 valid_from） | 新值可见、旧值不可见 |
| 4 | `asOf` 边界 | `old.validTo` 前 1ms / 正好 `old.validTo` | 前 1ms 旧值；正好边界是新值（`valid_to > at` 的语义） |
| 5 | `asOf` 可知口径 | 2024 年事件、2026 年才导入，回看 2024-06 | `event` 看得到，`known` 看不到 |
| 6 | `valid_to` 正向 | 先确认旧、再确认新 | `old.validTo === new.validFrom`；`new.validTo === null`；仅 1 条当前值 |
| 7 | `valid_to` 反向 | 先确认新、再确认旧 | 旧值仍立即收口到新值起点；不回写出「两条同时有效」 |
| 8 | 群聊降权 | 群聊里出现关系事实 | `relations.strength === 0.3`；`context === 'group'` |
| 9 | 一对一 | 私聊里出现关系事实 | `strength === 0.6`；`context === 'direct'` |
| 10 | `groupOnly` | 先群聊、后私聊 | 先 `true`，私聊导入后 `false`（不永久锁死） |
| 11 | 展示 | 仅群聊的人 | 人物卡/标签出现「仅群聊」；不把群聊关系当亲密 |

**验收标准**

- [ ] `npm run persona:contract` 全绿；用固定时间戳（显式 `at`），不依赖 `Date.now()` 漂移。
- [ ] 临时目录建库，结束清理；不读用户 `userData`，不联网，不需要 Ark key。
- [ ] 至少两份导入 fixture：Telegram 一对一 JSON、Telegram 群聊 JSON（`type: private_group`），覆盖 `parseChatAuto` 的 `chatType`。
- [ ] 上表 1–11 全部有独立 case；失败输出含 `field`、`value`、`at(ISO)`、`expected`、`actual`。
- [ ] 反向 `valid_to` 用例必须断言「同一 role 当前只有 1 条」，而不是只看 `validTo != null`——防止「写反了也算过」。
- [ ] `asOf` 的 `event` / `known` 两种 mode 分别断言，不能只测默认。
- [ ] 群聊用例同时断言 `strength` 与 `context`；只断言其中一项视为未通过。
- [ ] `npm run persona:lifecycle` 与 `npm run persona:selftest` 仍全绿；新脚本不复制粘贴 lifecycle 的全部用例，只覆盖契约。
- [ ] 若断言暴露既有 bug：允许在 `electron/persona/index.mjs` 做 **≤20 行**的最小修复，PR 里单列「契约修复」并附失败用例；否则标 `KNOWN-FAIL` + issue，不得把断言改弱。
- [ ] 连续跑两次结果一致；退出码失败非 0，便于 CI。

**证据**：契约输出、失败样例、若修 bug 则附最小 diff。

---

### D. 整理 Owner — `plugins/notes` 后台建议扫描

**要解决**：`wiki.dream` 只返回一次性 issues，没有持久队列、没有冷却、没有接受/拒绝；后台一旦直接改页面，就违反「reviewed 不被静默改写」。

**交付物**

- `plugins/notes/main.mjs`：确定性扫描 + 持久建议队列 + 接受/拒绝入口。
- `scripts/notes-scan-selftest.mjs`：临时插件上下文 + fixture vault。
- `package.json`：`wiki:scan:selftest`。
- 不改 `docs/arch/**`；扫描边界、队列字段、冷却规则写在脚本头注释与 `scripts/notes-scan-selftest.mjs` 的 case 名里，不新增 arch 段落。

**队列形状（与 `ARCH-memory.md` §7.3 同源，不共享存储）**

```json
{
  "id": "sug...",
  "kind": "dedupe | fill-gap | stale",
  "targetKind": "page | source",
  "targetId": "...",
  "payload": { "candidatePageIds": [], "sourceId": "", "quote": "", "locator": "" },
  "evidence": [{ "kind": "page|source|query", "id": "...", "quote": "..." }],
  "sig": "sha256(kind + targetId + evidence-key)",
  "status": "pending | accepted | rejected | expired",
  "createdAt": 0,
  "decidedAt": 0
}
```

**扫描规则**

- 触发：手动 `wiki.scan.run` + 空闲 ≥60s 的 `wiki.scan.tick`；**默认关闭后台定时**（`data.scan.enabled=false`），验收通过后再开。
- 并发 1；重复触发返回 `busy`，不排队堆积。
- 单次最多 20 条建议；只扫变更对象（新增/修改的 page/source），不做全量。
- 三类：
  - `fill-gap`：reviewed/draft 页面缺引用、坏双链、缺页面；证据是页面 + source。
  - `dedupe`：标题 + 摘要 bigram 相似度出候选对；**只出建议，不自动合并**。
  - `stale`：source `sha256` 变化 → 引用页建议标 stale；**建议态，不直接改 status**。
- 无 evidence 的建议直接丢弃，不写队列。
- 不做模型调用；本轮全部确定性。
- **口径收紧说明**：`ARCH-knowledge.md` §5.2 允许「source 变更 → 引用页自动 stale」；本轮按切片要求再收紧一档——`stale` 也只产建议，人接受后才写状态。先证明不误伤，再讨论自动化。

**验收标准**

- [ ] 旧 `wiki.json` 无 `suggestions` 字段时可加载，默认 `[]`；保存后字段保留；重启插件队列仍在。
- [ ] 三类建议至少各 1 条 fixture 命中；每条 `evidence.length >= 1`；`sig` 稳定，重复扫描不产生重复 `sig`。
- [ ] **reviewed 不可变**：扫描前后对所有 `status='reviewed'` 页做深快照（content / summary / status / citations / updatedAt），深度相等；spy 证明扫描期间没有调用 `wiki.addCitation` / `savePage`。
- [ ] 扫描只写 `wiki.json` 的 `suggestions` 与 `log`；不写 `pages/`、`sources/`、`revisions/`。
- [ ] `fill-gap` 接受后调用既有 `wiki.addCitation`；`stale` 接受后才走正常状态写入；`dedupe` 接受只标记 accepted 并打开对比，不自动合并、不改正文。
- [ ] 拒绝写 `status='rejected'` + `decidedAt`；同 `sig` 30 天内不再出现；人工 `force` 可跳过冷却；30 天后可重新建议。
- [ ] 连续两次扫描（无变更）新增 0 条；单次建议上限 20；并发第二次返回 `busy`。
- [ ] 扫描中途取消/异常：队列不出现半条建议，已完成的建议保留，`log` 有失败原因。
- [ ] `npm run wiki:scan:selftest` 全绿：fixture 含 2 个 reviewed（1 有引用、1 无引用）、2 个重复标题、1 个 source 变更、1 个 draft；断言三类建议数、reviewed 快照相等、冷却生效。
- [ ] `npm run verify:plugins` 通过；`plugin.json` 权限不新增；不联网、不调模型。
- [ ] 后台定时默认关闭；只有 `scan.enabled=true` 且空闲 ≥60s 才跑；测试用 `tick({now})` 而不是真等 60s。
- [ ] 本轮不做 UI 列表；建议通过 API + 自检可见。UI 留下轮，避免把「后台正确性」和「界面」混在一个验收里。

**先验证的链路（重要）**：`stale` 依赖 `source.hash` 变更能被同一 `sourceId` 感知。当前导入按 uri/hash 去重，源文件变更可能新建 source 而不是更新旧 source。D 必须先跑这条链路；若现有 API 做不到，**本轮只交付 `fill-gap` / `dedupe`，`stale` 标 blocked 并附复现**，不得用假数据让测试变绿。

**证据**：自检输出、reviewed 前后快照 JSON、队列 dump、并发/冷却用例。

---

### E. 编排 Owner — `ARCH-office.md` 补「3 Agent 并行的期望映射」

**要解决**：`ARCH-office.md` 有区域和优先级，但没有回答「3 个 Agent 并行同一项目时，主界面应该看到什么」。没有这张映射，3 Agent 并行只能靠人盯终端判断，② 就还是玩具（`ARCH-key-tech.md` §② 判据）。

**交付物**

- `docs/arch/ARCH-office.md` 新增一节，标题含 **「3 Agent 并行的期望映射」**；只增不改既有段落。
- 不改 `src/office/**`、不改调度、不改数据库；发现代码不一致只记「已知差异」。

**口径**：「3 Agent 并行」按**3 个执行 Agent 同时有 active run** 来写；主管另计。如果产品口径把这 3 个里包含主管，则把映射表里的 1 个 worker 换成 lead 位（主管自己也在跑），其余行不变。两种形态都要在「已知差异」里说明当前代码更接近哪一种。

**本节必须包含的映射（最低集）**

| 场景 | 数据来源 | 期望 |
|---|---|---|
| 3 个 worker 同时 running | 3 条 active `run` + 各自 `todo` | 3 个不同工位、`pose=working`、`tone=run`；显示任务号 + 已运行时长；互不重叠 |
| 主管等待子任务 | `run.status=waiting_children` / `missionState=waiting_children` | 主管在 lead 区，`pose=lead`，文案「等待子任务完成」；白板进度来自 subtasks |
| 1 个审批 | `approval` 或 `run.waiting_input` | 审批台琥珀灯 + 计数；该 Agent 可离开工位去审批台（宽屏）；`primary=approval` |
| 1 个待验收 | `todo.status=in_review` | 验收架紫色点 + 计数；`pose=reviewing`；`primary=review` |
| 1 个失败 | `run.status=failed/interrupted` | 工位保留、`tone=fail`、`pose=failed`、`primary=retry`；不被 idle 掩盖 |
| queued | `run.status=queued` | 工位等待态、`tone=wait`；优先级低于 running |
| idle | 无 active run | 茶歇/待命；不显示假任务、不伪造进度 |
| 计划评审 | `missionState=plan_review` | 主管 + 白板；`zones.planning=true`；worker 不显示 running |
| 窄屏 | 窗口 <1440px | 按 §4 收敛：会议角隐藏、主管留工位；审批/验收不丢计数；计数仍在 header 可见 |
| delegation | `delegations.agentId` + active status | 每个 worker 只显示自己的 active delegation；不把别人的 delegation 算到自己头上 |

**验收标准**

- [ ] 新增一节标题精确含「3 Agent 并行的期望映射」；`git diff` 只显示新增行，既有段落零改动。
- [ ] 至少 10 行映射，覆盖上表；每行写清 `State` 字段/取值 → `zone` / `pose` / `tone` / `statusLabel` / `primary` / 不应出现。
- [ ] 明确写出优先级与 §2 一致：`approval/waiting_input > failed > in_review > supervisor > running > queued > idle`。
- [ ] 明确「办公室是投影，不是调度器」：不新建表、不伪造任务、不从场景触发派活；与 §1 不矛盾。
- [ ] 明确 3 个 worker 的工位分配规则（宽屏 3 个不同工位；窄屏如何收敛），以及「没有 active run 就不算 running」。
- [ ] 明确 `waiting_children` 的语义：主管等待，不是主管在跑；board 进度来自 subtasks/plan，不用百分比装饰。
- [ ] 有「验收走法」：种子场景分两幕，不要试图一帧同时满足所有行——第一幕 3 个执行 Agent 同时 running + 主管 `waiting_children`；第二幕把其中 1 个 run 置 `waiting_input`（审批）、另 1 个 todo 置 `in_review`，验证优先级切换与工位让位。过验收时用真实 Mission 跑一遍即可。
- [ ] 有「已知差异」：当前代码与本映射不一致的地方逐条列出（字段、现状、影响、后续 owner）；本轮不修，只登记。
- [ ] `npm run verify:docs` 通过；若需 `docs/README.md` 索引，由 PM 加，不在本节里改其他 arch。
- [ ] 由架构 owner 复核一次：能指着任意一行说「这条对/不对」，而不是「写得挺全」。
- [ ] 本轮对 `docs/arch/**` 的改动仅此一节；其他 arch 文档零改动（这是对任务「不改既有 arch」的唯一豁免，且只增不改）。

**证据**：diff、映射表、种子场景走查记录/截图、已知差异清单。

**说明**：任务总则说「不要改 docs/arch 下的既有文档」，而本切片要求给 `ARCH-office.md` 补一节。处理方式是：**本轮 PM 只写计划，不执行 E**；E 执行时把「只增一节、不改旧段」作为豁免条件，并在 PR 描述里引用本条。这样既不违反本轮约束，也不把 E 变成无法交付的切片。

---

## 3. 风险登记

| # | 风险 | 概率/影响 | 触发信号 | 对策 | Owner |
|---|---|---|---|---|---|
| R1 | 20 份真实材料凑不齐 / 涉隐私 / 标注成本超 1 天 | 高 / 高 | `local/` < 20；材料含客户名 | 只用内部可公开材料；raw + GT 本地 gitignore，仓库只存 sha256 与标注；不足则 A 以「样本不足 + 缺口清单」收口，**不启动 VLM 轮** | A |
| R2 | 指标定义被质疑，返工 | 中 / 中 | 评审对「文本覆盖」「表格单元格」理解不一致 | Wave 1 第 1 天冻结定义与归一化规则；README 写 3 个边界案例；变更需 PM 签字 | A + PM |
| R3 | 指标可被「多抽垃圾」刷高 | 中 / 中 | `textCoverage` 高但 `textNoise` 也高 | 同时报 `textNoise`；表格按格精确匹配；样本分类统计；评审看逐样本最差值 | A |
| R4 | 后台扫描误报/打扰 | 高 / 中 | 同一页面反复出建议；用户忽略率上升 | evidence 必填、单次上限 20、30 天冷却、默认关闭定时、先手动跑 | D |
| R5 | 扫描静默改 `reviewed` | 低 / 极高 | 快照 diff 非空；spy 捕获写调用 | 深快照断言；扫描期间禁止写 API；代码 review 卡「只写 suggestions/log」 | D |
| R6 | `stale` 链路走不通（source 变更新建而非更新） | 中 / 中 | 改文件后 sourceId 变化，旧引用页无感 | 先验证链路；不通则本轮只交付 fill-gap/dedupe，stale 标 blocked，不用假数据 | D |
| R7 | 记忆边界改动破坏现有晋升/UI | 中 / 中 | UI 报 `E_NOTE_*`；老 note 无法晋升 | 明确错误码 + UI 文案；历史 note 给「补来源」路径；自检覆盖；不改 DDL | B |
| R8 | 画像断言暴露既有 bug，C 变「修 bug」 | 中 / 中 | `valid_to` 反向用例失败；群聊 strength 不是 0.3 | 允许 ≤20 行最小修复并单列；否则 `KNOWN-FAIL` + issue，不弱化断言 | C |
| R9 | 文档映射与代码漂移，E 变成「写给未来」 | 中 / 中 | 映射表某行在真实 Mission 中不成立 | 必须做种子场景走查；列「已知差异」；本轮不修代码，只登记 | E |
| R10 | 并行写 `package.json` / `docs/README.md` 冲突 | 高 / 低 | 两个 PR 改同一行 | PM 做集成；Owner 只提交自己的脚本名，不排序、不重写整个 scripts 块 | PM |
| R11 | 为了变绿而弱化断言/改阈值 | 中 / 高 | 断言从「等于」改成「非空」；阈值下调无记录 | 验收 review 检查 diff；阈值变更必须附理由与前后基线；负向用例必须存在 | PM |
| R12 | Wave 1 延期拖住 D | 中 / 中 | B 第 2 天仍未绿 | D 不启动，E 可先做；PM 在 D2 结束做 go/no-go；必要时砍 B 的 `E_NOTE_NO_SOURCE`，保 TTL/晋升主边界 | PM |

---

## 4. 收口与证据

### 4.1 整轮验证命令

```sh
npm run typecheck
npm run build
npm run verify:plugins
npm run verify:docs

npm run knowledge:selftest
npm run knowledge:engines:selftest
npm run knowledge:eval:smoke
npm run memory:selftest
npm run persona:contract
npm run persona:lifecycle
npm run wiki:scan:selftest
```

> `knowledge:eval` 的 20 份本地样本不进 CI；CI 只跑 `knowledge:eval:smoke`。`--gate` 留给换解析引擎/换 embedding/升级 Electron 时用。

### 4.2 验收记录模板

| 切片 | 命令 | 证据文件/输出 | 结果 | 备注 |
|---|---|---|---|---|
| A | `npm run knowledge:eval -- --json` | `fixtures/knowledge-eval/baseline.json` | ☐ | 样本数：__/20 |
| B | `npm run memory:selftest` | 终端输出 | ☐ | 新增 __ 条边界用例 |
| C | `npm run persona:contract` | 终端输出 | ☐ | `KNOWN-FAIL`：__ |
| D | `npm run wiki:scan:selftest` | 快照 JSON + 队列 dump | ☐ | reviewed 快照相等：是/否 |
| E | `npm run verify:docs` | diff + 走查记录 | ☐ | 已知差异：__ 条 |

### 4.3 下一轮入口条件

- [ ] A 至少有 20 份样本的 baseline（不要求达标），且 `--gate` 可复现；样本不足则下一轮只做「补样本」，不做 VLM。
- [ ] B 的 TTL / 晋升边界全绿，错误码稳定；否则 D 不得合并。
- [ ] C 全绿，或 `KNOWN-FAIL` 都已登记 issue 且有明确 owner。
- [ ] D 的 reviewed 零变化 + 冷却/证据/接受路径全绿；后台定时才允许打开。
- [ ] E 的映射节合并，且「已知差异」逐条有后续 owner。
- [ ] 五个切片的风险登记已更新；R1/R6/R8 任一触发时，PM 在下一轮计划里显式处理。

---

## 5. 本轮明确不做

| 不做 | 为什么 | 什么时候做 |
|---|---|---|
| VLM / OCR 兜底、扫描件识别 | 先把基线测出来；没有基线就接模型，无法判断是否真的提升（§7 第 1 项先于第 2 项） | Round 2，A 的 20 份 baseline 之后 |
| 表格保结构、分块不切断表格、PDF 阅读顺序、质量闸门 | 都是 §7 的第 3/4/6/7 项，依赖 A 的度量口径 | Round 2+ |
| 任何 `electron/knowledge/parse.mjs` 等解析实现改动 | 本轮 A 只做评测，不改 parser | Round 2 |
| 真正的 3 Agent 并行编排 / 调度 / 舞台代码改动 | E 只补「期望映射」文档；② 的工程实现是 P1 | 后续编排轮 |
| 办公室新区域、新动效、新场景模板 | 与本轮映射验收无关 | 后续 |
| 整理建议的 UI 列表、自动应用、自动合并、模型判定 | 先把「只产建议 + 不改 reviewed」做对；UI 会掩盖后台正确性问题 | 后续 |
| `wiki.dream` 的自动执行 / 定时全量扫描 | 本轮只做变更对象、手动/可关的后台 tick | 后续 |
| 记忆的 LLM Dreaming、自动晋升、表结构重设计 | 头号风险是自动晋升污染每次会话；本轮只收口边界 | 后续 |
| 画像的抽取算法、模型推断、新导入格式、画像 UI | C 只断言既有契约；算法调优是另一个问题 | 后续 |
| 新服务进程 / Docker / Python / 原生编译 / 独立向量库 | 与「极小资源」冲突（`ARCH-key-tech.md` §8） | 不做 |
| 为通过而调低阈值、删断言、跳过样本 | 会让「有度量」变成「有假度量」 | 不做 |
| 把真实用户材料 / 聊天记录提交进仓库 | 隐私红线；只提交 hash 与标注 | 不做 |
| 修改 `docs/arch/**` 其他文档 | 本轮只允许 E 对 `ARCH-office.md` 只增一节 | 后续按需 |

---

## 6. 一页结论

- **Wave 1（A/B/C 并行）**：先把「解析有数字、记忆有闸门、画像有契约」立起来；三路互不依赖，1.5–2 人日。
- **Wave 2（D/E 并行）**：D 复用 B 的建议队列契约，做「只产建议、不改 reviewed」的整理扫描；E 补「3 Agent 并行」的期望映射，只写文档，不改舞台。1.5–2 人日。
- **本轮的成功不是指标达标**，而是：样本不足会诚实说、后台不会静默改 reviewed、过期 note 晋升不了、`asOf/valid_to/群聊` 有可执行断言、3 Agent 并行有可逐行判对错的映射。
- **最大的两个不确定性**：20 份真实材料能否到位（R1），以及 `stale` 的 source 变更链路是否成立（R6）。两者都允许「黄色收口」，但不允许用假数据或弱断言变绿。
