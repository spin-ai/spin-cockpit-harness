> 层：架构 · 状态：记录 · 核对：2026-11-15 · 覆盖：五件关键技术的公开基准盘点与 20–50 条本地闸门可抄项

# Arch · 基准生态与本地闸门

> 本文回答一个问题：**五件关键技术各自「有没有公认基准」，在本机条件（Electron + 单 API + 无 GPU + 无 Docker + 离线）下能抄什么。**
> 分工：开源/闭源实现对照与许可证红线 → [`ARCH-tech-landscape.md`](ARCH-tech-landscape.md)；技术边界与判据 → [`ARCH-key-tech.md`](ARCH-key-tech.md)；本文只谈**评测**。
> **术语严格区分**：数据集（可下载样本 + 标注）· 评测框架（评分流程/分类法）· 基准（数据集 + 指标 + 可执行评分）· leaderboard（公开榜单）。把分类法叫基准是这类讨论里最常见的错误。

---

## 0. 结论先行

| 事项 | 基准成熟度 | 最该抄的东西 | 能否当本地闸门 |
|---|---|---|---|
| ① 文档解析 | **最强**：多个真数据集 + 可执行检查项 | olmOCR-Bench 的二值单元测试 + OmniDocBench 的指标口径 | 能，抽 30 页 |
| ④ 记忆系统 | **强**：成熟数据集，覆盖更新/时间/拒答 + 遗忘 | LongMemEval 的 5 类问题 + Bemula 的遗忘三指标 | 能，抽 30–40 题 |
| ③ 知识库整理 | **中**：生命周期忠实度有真数据集，合并/去重没有 | VERA-LIFE-EVAL 的 claim 四条件 + HoH 的新旧并存 | 能，抽 30 条建议 |
| ⑤ 人物画像 | **弱**：证据链有，双时态 asOf 与关系强度没有 | PAL-Bench 的证据链 + P-ContextBench 的 T3 时间状态 | 能，但关系强度必须自建标注 |
| ② 多智能体编排 | **最弱**：只有失败分类法，无「回滚一致性」数据集 | MAST 的 14 失败模式 + MERGE GYM 的不相交文件冲突 | 只能自建 harness，没有现成分数 |

三句话记住：

1. **静态 ground truth 越容易写下来，基准越成熟** —— 文档解析有 Markdown 可逐字比，记忆有 QA 可判对错；
2. **正确性依赖时序/副作用的地方，基准最弱** —— 「并行改仓库 + 中途中断 + 回滚后一致」的「正确状态」无法冻结成数据集；
3. **没有基准 ≠ 不能定义指标** —— 冲突率、回滚成功率、scope collision 去重叠率都可定义，只是每家 harness 复现不同，不能横向比分。

---

## 1. 文档解析：基准最成熟，「每页置信度」没有现成定义

### OmniDocBench

| 项 | 内容 |
|---|---|
| 类型 | **数据集**（含评测代码） |
| 链接 | https://github.com/opendatalab/OmniDocBench（CVPR 2025） |
| 指标 | 文本 **Normalized Edit Distance**；表格 **TEDS**；公式 **CDM（Character Detection Matching）**；阅读顺序编辑距离；版面检测 COCODet mAP/mAR。端到端 Overall = ((1 − text Edit) × 100 + table TEDS + formula CDM) / 3 |
| 规模/语言 | 1,651 个 PDF 页面，10 种文档类型、5 种排版类型、5 种语言类型，**含中文** |
| 离线小样本 | ✅ Python、CPU、无 Docker、无需联网；抽 20–50 页足够 |
| 状态 | 2024-10 起持续更新；仍是文档解析最常被引用的综合基准 |

### READOC

| 项 | 内容 |
|---|---|
| 类型 | **数据集 + 评测框架**（S3uite：Standardization → Segmentation → Scoring） |
| 链接 | https://aclanthology.org/2025.findings-acl.1128/ · https://github.com/icip-cas/READoc |
| 指标 | 把 DSE 定义为 **PDF → Markdown** 端到端转换；三阶段评分，逐项匹配标题层级、表格结构、阅读顺序 |
| 规模/语言 | 3,576 篇真实文档（arXiv / GitHub / Zenodo），以英文为主，**中文覆盖弱** |
| 离线小样本 | ✅ Python、离线；「三阶段切分」对定义自己的检查项很有用 |
| 状态 | 2024-09 首发，ACL 2025 Findings；端到端 Markdown 评测定义最明确的一篇 |

### olmOCR-Bench

| 项 | 内容 |
|---|---|
| 类型 | **数据集**（单页 PDF + 可执行单元测试） |
| 链接 | https://github.com/allenai/olmocr/tree/main/olmocr/bench |
| 指标 | **不用软编辑距离，用事实级二值单元测试**：某句话必须出现在页面上、某表格单元格必须可定位。按 ArXiv / Old Scans Math / Tables / Old Scans / Headers and Footers / Multi column / Long tiny text 分类给分 |
| 规模/语言 | 1,400+ 单页 PDF，8,413 个可执行单元测试；以英文为主，**中文不覆盖** |
| 离线小样本 | ✅ 只需把解析输出变成 Markdown/纯文本；CPU、离线；二值 pass/fail 不依赖模型评判，最适合做闸门 |
| 状态 | 2025-06 首发，后续随 olmOCR-2 更新分数；细粒度检查项设计最好的一个 |

### MPDocBench-Parse

| 项 | 内容 |
|---|---|
| 类型 | **数据集** |
| 指标 | 专测**多页文档**：截断文本合并、截断表格合并、标题层级深度。补的是 OmniDocBench / READOC 少谈的「跨页合并」 |
| 规模/语言 | 以论文为准，目前规模较小；以英文为主 |
| 离线小样本 | ✅ 抽 20 个多页文档测「跨页表格/段落是否被错误截断」 |
| 状态 | 2026 年新工作，生态尚浅，**不建议作为唯一依据** |

**诚实判断**：文档解析是五件里唯一有多个「真数据集 + 可执行检查项」的。但 **「每页置信度」没有公认指标** —— 现有基准评的是解析结果正确性，不评模型自报置信度是否校准。要做每页置信度，得用 olmOCR-Bench 式 pass/fail 反推校准，而不是找现成基准。

---

## 2. 多智能体编排与人工干预：真基准最弱

### MAST（Multi-Agent System Failure Taxonomy）

| 项 | 内容 |
|---|---|
| 类型 | **评测框架 / 失败分类法**，**不是数据集**，也不是 leaderboard |
| 链接 | arXiv:2503.13657《Why Do Multi-Agent LLM Systems Fail?》 |
| 指标 | 1,600+ 执行轨迹、7 个多智能体框架的 grounded-theory 分析，**14 种失败模式**归为 3 类：系统与规格设计 39.3–41.8% / 智能体间错位 36.9–37.2% / 任务验证与终止 21.3–23.5%。其中过早终止 6.2%、验证不完整 8.2%、验证错误 9.1%；标注者间 κ=0.88，LLM-as-Judge 与人类 κ=0.77 |
| 离线小样本 | ✅ 不要求 GPU，但**不是跑基准而是抄分类法**：自己按 14 类标注 20–50 条失败轨迹 |

### ParallACT

| 项 | 内容 |
|---|---|
| 类型 | **数据集 / 基准**（orchestrator-free 多智能体编码任务） |
| 链接 | https://lingyunxiao18.github.io/ParallACT/（arXiv:2611.00314，**编号待核对**） |
| 指标 | 互补任务 + 矛盾任务两类；矛盾任务中两个 agent 改同一段代码、朴素合并只能满足一个规格。报告 oracle 单 agent vs 并行差距（如 62% → 16%），并比较「告知对方存在」「提供通信通道」能否恢复 |
| 离线小样本 | ⚠️ 基准本身 CPU 可跑，但**需要真实仓库 + agent harness 写权限**；抽 20 对冲突任务可行 |
| 状态 | 2026 年新工作，最贴近「多 agent 并行改同一仓库」的可执行基准，**尚未被独立复现广泛验证** |

### MERGE GYM

| 项 | 内容 |
|---|---|
| 类型 | **基准（三轨）** |
| 链接 | NeurIPS 2026 页面（**以论文/仓库为准**） |
| 指标 | 三轨：open-time scope forecasting / replay-conditioned conflict resolution / scheduling。关键数字：715 对 lineage 中 167 个文本冲突，**79 个（47.3%）发生在 authored 文件集不相交时** —— 文件不重叠 ≠ 不会冲突；lineage-union 规则 held-out AUROC 0.877；33.3% replay 预算恢复 81.2–82.9% 冲突；决策时 gate 去重叠 91.7% scope collision，makespan 膨胀 65.0% |
| 离线小样本 | ✅ 需要能 replay `git merge-tree`，CPU 可跑；抽 20–50 对冲突 |
| 状态 | 2026 年新工作，专对并发 AI coding agent 的合并冲突，尚未被取代 |

### Handoff Debt / Switch-SWE

| 项 | 内容 |
|---|---|
| 类型 | **研究框架 / 预印本**，公开可复现的数据集形态不明确 |
| 指标 | Handoff Debt 测「中断后 successor 接管，四种 handoff 视图下的恢复代价」；Switch-SWE 测「切走再切回原任务还能不能完成」，7 个 agent 平均掉 11.5 个百分点（单个 6.0–15.0） |
| 离线小样本 | ⚠️ 只能抄检查项分类（handoff 视图、聚焦任务完成率），**不能宣称有公认基准** |

**诚实判断**：多智能体编排是五件里真基准最弱的。原因不是「没人关心」，而是**正确性无法用静态数据集定义** —— 取决于执行顺序、时序、外部进程状态、文件系统副作用；「中断发生在哪一刻、回滚前仓库是什么状态」每家 harness 都不同。MAST 只能事后归因，ParallACT / MERGE GYM 用「冲突对」和「lineage replay」逼近，仍要你自备仓库与 harness，**没有一个下载下来跑 50 条就出分数的标准集**。

---

## 3. 知识库整理：有生命周期忠实度基准，合并/去重没有统一标准

### VERA-LIFE-EVAL

| 项 | 内容 |
|---|---|
| 类型 | **数据集 + 评测框架** |
| 链接 | ACL 2026（GroundLM）https://aclanthology.org/2026.groundlm-1.pdf（**以 ACL 页面为准**） |
| 指标 | **lifecycle faithfulness**：一条 claim 必须同时满足 **semantic support / target-time validity / non-supersession / provenance**。规模 8,500 Q、41,203 条版本化证据、6 种 lifecycle 设置（current / past / stale-only / update 等） |
| 离线小样本 | ✅ 不需要 GPU，用它的评测定义逐项检查 30–50 条 claim |
| 状态 | 2026 年新基准，为「可审核、可回滚的知识页面」设计，生态较新 |

### HoH（Outdated Information）

| 项 | 内容 |
|---|---|
| 类型 | **数据集 / 基准** |
| 链接 | https://github.com/0russwest0/HoH（arXiv 2025） |
| 指标 | 第一个专测**过期信息对 RAG 的影响**；token-level diff + LLM pipeline 构造 QA，捕捉事实的时间演化。核心发现：过期信息不只降准确率，还会**误导模型生成有害输出，即使当前信息在检索结果里可见** |
| 离线小样本 | ✅ CPU、离线；抽 20 条「同一事实新旧版本并存」样本 |
| 状态 | 2025 年首发，「过期信息」维度最直接；VERA-LIFE-EVAL 在它之上加了生命周期与来源追溯 |

### VL-Dedup

| 项 | 内容 |
|---|---|
| 类型 | **数据集**（多模态图像-文本去重，**不是知识页面去重**） |
| 指标 | 分级多模态实体解析，50,000 COCO/SOP records、66,788 labeled pairs、三级去重分数 |
| 离线小样本 | ⚠️ 可抄「exact / near / semantic」分级思路，**不能直接当页面去重基准** |

**诚实判断**：知识库整理有 **VERA-LIFE-EVAL** 这个真数据集，覆盖「引用忠实度 + 过期判定」；但 **「合并/去重是否正确」没有统一公开基准**，VL-Dedup 是另一个任务。合并检查项必须自己定义（见 §6 表格）。

---

## 4. 记忆系统：有多个真数据集；「固定注入预算」没有标准基准

### LongMemEval

| 项 | 内容 |
|---|---|
| 类型 | **数据集** |
| 链接 | https://github.com/xiaowu0162/LongMemEval（arXiv:2410.10813，ICLR 2025） |
| 指标 | 500 个问题，每题约 38–62 个 session、~115K token 历史（variant-s）；另有 oracle（1–6 session）与 m（~500 session、~1.5M token）。问题类型：**temporal-reasoning / multi-session / knowledge-update / single-session-user / assistant / preference / abstention**；type-specific LLM-as-Judge（论文报告 97% 人类一致性） |
| 规模/语言/许可 | 500 instances；英文为主；HuggingFace `xiaowu0162/longmemeval-cleaned`，**MIT** |
| 离线小样本 | ✅ 不需要 GPU；抽 20–50 题按 5 类分别统计 + abstention 率；**最适合当 CI 闸门** |
| 状态 | ICLR 2025，长期对话记忆最常被引用；v2 转向 web-agent trajectories，chat 记忆部分仍以 v1 最成熟 |

### Bemula

| 项 | 内容 |
|---|---|
| 类型 | **数据集 / 基准** |
| 链接 | arXiv:2610.18052《Can Agents Forget When Asked?》（2026，**编号待核对**） |
| 指标 | 第一个专测 **memory unlearning（按请求遗忘）**：**efficacy / preservation / scoped deletion**。结果：Replacement 几乎解决但旧值会 verbatim 复现（所有系统 ≤30.5）；Semantic 与 Temporal 请求最难；Mem0 单事实遗忘 efficacy 0.0；A-MEM 例外（F1=46.2 / F2=52.0） |
| 离线小样本 | ✅ CPU、离线；抽 20–30 条 forget 请求统计三指标 |
| 状态 | 2026 年新基准，「该忘什么/忘得对不对」定义最直接；**缺点是合成对话**，不代表真实聊天分布 |

### MemoryAgentBench

| 项 | 内容 |
|---|---|
| 类型 | **评测框架 + 数据集** |
| 链接 | https://github.com/HUST-AI-HYZ/MemoryAgentBench（arXiv:2507.05257） |
| 指标 | 把已有长上下文数据集改造成**增量多轮**格式，覆盖 4 项核心记忆能力（accurate retrieval / test-time learning / long-range understanding / conflict resolution，**以论文为准**）；看的是多轮增量写入下记忆是否保持可用 |
| 离线小样本 | ✅ CPU、离线；当「增量写入下稳定性」闸门 |
| 状态 | 2025 年新基准；与 LongMemEval 部分重叠（知识更新/冲突），**选一个当主闸门即可** |

**诚实判断**：记忆有 LongMemEval（更新/时间推理/拒答）+ Bemula（遗忘）两个真数据集。但 **「固定注入预算」没有标准基准** —— 没有任何公开数据集规定「每次只注入目录、预算 N token」并评测该约束下的表现。注入预算只能作为本仓库 harness 的硬约束，用上面两家的题目去测。

---

## 5. 人物画像：有证据链基准，双时态 + 关系强度几乎没有

### PAL-Bench

| 项 | 内容 |
|---|---|
| 类型 | **数据集 / 基准** |
| 链接 | arXiv 2606.16175（2026，**编号待核对**） |
| 指标 | **evidence-grounded profile reconstruction**：50 个合成用户、36,659 条公开照片记录、2,799 个 target；七指标含 **OFR（owner fact recovery）/ PIR（social identity binding）/ hard-person PIR / relation accuracy / evidence citation**。最佳参考系统 PAL-TRACE：OFR 0.6057、PIR 0.4792、hard-person PIR 0.2684 |
| 离线小样本 | ✅ CPU、离线；可抄「每条属性绑定可公开证据路径，推断进待确认队列」 |
| 状态 | 2026 年新工作，人物画像里「证据链 + 待确认」设计最接近本仓库需求；**基于合成相册而非聊天记录**，不覆盖双时态 asOf |

### P-ContextBench

| 项 | 内容 |
|---|---|
| 类型 | **基准** |
| 指标 | 五层任务：T1 单源事实恢复 / T2 多源事实恢复 / **T3 temporal state tracking** / T4 高层个人模式推断 / T5 agent-oriented behavior |
| 离线小样本 | ✅ 抽 20–30 条 T3 检查 asOf 回看是否用了错误时间点的状态 |
| 状态 | 2026 年新工作，复现生态尚浅 |

### StreamProfileBench

| 项 | 内容 |
|---|---|
| 类型 | **基准** |
| 指标 | 流式场景细粒度画像推断；核心发现 **temporal sensitivity to interest decay 是瓶颈**，decay errors 是四类错误里最大；指标 F1 / NSF |
| 离线小样本 | ✅ 适合当「时间衰减」专项闸门 |
| 状态 | 2026 年新工作；测兴趣衰减，**不测关系强度** |

**诚实判断**：人物画像有 PAL-Bench（证据链 + 待确认最接近）但基于相册；P-ContextBench 覆盖时间状态但不是聊天场景的双时态；**「关系强度（群聊 vs 一对一）」没有任何专门公开基准**。这是五件里第二弱，弱于文档解析和记忆，强于多智能体回滚。

---

## 6. 三个直接回答

### a) 哪些真有公认基准，哪些其实没有

**有可下载数据集 + 可执行指标（可当本地闸门抄）**

- 文档解析：OmniDocBench、READOC、olmOCR-Bench —— 真数据集、指标可执行；中文覆盖看 OmniDocBench，检查项设计看 olmOCR-Bench。
- 记忆系统：LongMemEval（MIT）覆盖更新/时间推理/拒答；Bemula 覆盖遗忘。
- 知识库整理：VERA-LIFE-EVAL 是生命周期忠实度真数据集；HoH 是过期信息真数据集。

**有数据集但任务不完全对得上（只抄检查项，不抄分数）**

- 人物画像：PAL-Bench（相册非聊天）；P-ContextBench（时间状态非双时态聊天）。
- 文档解析：MPDocBench-Parse（多页合并，生态太新）。

**没有公认数据集，只有分类法/框架（不能冒充基准）**

- 多智能体编排：MAST 是失败分类法；ParallACT / MERGE GYM 是 2026 年新可执行基准但无广泛复现 leaderboard；**「中断后回滚 + 仓库一致性」没有专门数据集**；Handoff Debt / Switch-SWE 是预印本/框架。
- 知识库的**合并/去重正确性**：无公开统一基准；VL-Dedup 是图像-文本去重。
- 人物画像的**关系强度（群聊 vs 一对一）**：无专门基准。
- 记忆的**固定注入预算**：无基准，这是 harness 约束而非数据集能测的东西。

### b) 哪一件基准生态最弱，为什么

**多智能体编排与人工干预最弱。** 不是因为没人关心，而是**正确性无法用静态数据集定义**：解析有 ground-truth Markdown 可逐字比，记忆有 QA 可判对错；但「多个 agent 并行改仓库 + 中途人工中断 + 回滚后仓库一致」的正确性取决于执行顺序、时序、外部进程状态、文件系统副作用。MAST 只能事后归因；ParallACT / MERGE GYM 用「冲突对 / lineage replay」逼近，仍要自备仓库与 harness。**指标可定义（冲突率、回滚成功率、scope collision 去重叠率），但可复现的「正确状态」难以冻结成数据集。**

第二弱是**人物画像**：抽取准确率/误报率可定义，但「双时态 asOf」与「关系强度」缺聊天场景 ground truth；PAL-Bench 用合成相册绕开了隐私，也绕开了聊天时序与关系强度。

### c) 只能做 20–50 条本地闸门时，每件最该抄什么

| 事项 | 最该抄的基准 | 抄什么 | 20–50 条怎么抽 |
|---|---|---|---|
| **文档解析** | olmOCR-Bench 检查项 + OmniDocBench 指标口径 | olmOCR-Bench 的**二值单元测试**（某句话必须出现、单元格必须可定位、页眉页脚不得混入正文、双栏阅读顺序）；OmniDocBench 的 Edit / TEDS / CDM / 阅读顺序编辑距离作连续分补充。**不要只抄软编辑距离** | OmniDocBench 抽 30 页：10 页双栏论文 + 10 页含表格财务报告 + 10 页扫描/页眉页脚复杂页；每页 5–10 个二值检查 + 1 个阅读顺序编辑距离 |
| **多智能体编排** | MAST 14 失败模式 + MERGE GYM 的「文件不重叠但语义冲突」 | MAST 三层分类作**失败归因标签体系**；MERGE GYM 的「47.3% 冲突发生在 authored 文件不相交」作「不能只看文件重叠」检查项。回滚一致性自建：**中断后工作树 diff 是否只含预期变更** | 20 条任务，每条 2 个 agent 并行改同仓库不同文件 / 同一文件，在 50% 进度中断其一。记：最终测试通过率、非预期文件修改数、回滚后测试通过率、MAST 归因标签。**没有现成基准分数，这是自建 harness** |
| **知识库整理** | VERA-LIFE-EVAL 四条件 + HoH 新旧并存 | claim 级四条件：语义支持 / 目标时间有效 / 未被取代 / 来源可溯。合并自加一条：**合并后原页面所有 claim 仍可追溯到来源，且不得引入原页面没有的 claim** | 30 条建议：10 条新旧事实冲突（HoH 式）、10 条两页语义重复、10 条过期页面。逐条标：引用是否真支持 claim（人判 0/1）、是否用了过期版本（0/1）、合并后是否丢来源（0/1） |
| **记忆系统** | LongMemEval 5 类 + Bemula 遗忘三指标 | 五类各抽 6–10 题；Bemula 的 efficacy / preservation / scoped deletion 专项。**注入预算作硬约束**：只给目录不给全文，看五类是否崩塌 | 30–40 题：LongMemEval 25 题（每类 5）+ Bemula 10 条 forget。按类报准确率、abstention 误答率、遗忘 efficacy 与过度删除率。**不要只报总分** |
| **人物画像** | PAL-Bench 证据链 + P-ContextBench T3 | 每 target 必须有可公开证据路径，推断与证据分离；待确认队列可操作化为**证据强度低于阈值或证据冲突的推断不得直接写已确认画像**；T3 检查 asOf。关系强度自建三特征：**群聊共现频次 + 一对一天数 + 时间衰减**，输出 0–1 并保留证据 | 30 条推断：10 偏好 + 10 关系 + 10 时间敏感属性（如「住在哪」）。逐条标：抽取是否正确（人判）、证据是否支持（人判）、是否应进待确认（规则判）、asOf 是否用错时间点（人判）。**关系强度无现成基准，只能自建标注** |

**总原则**：本机条件（无 GPU / 无 Docker / 单 API / Node + Electron）决定了**不应追求跑全量 leaderboard**，而应把每个基准的**检查项分类**抄下来，做成 20–50 条**二值/三值本地闸门**。文档解析抄 olmOCR-Bench 的单元测试思路，记忆抄 LongMemEval 的分类口径，知识库抄 VERA-LIFE-EVAL 四条件，编排与画像抄分类法 + 自建 harness。

---

## 7. 引用红线（对外写东西前必看）

1. **本文的 arXiv 编号与链接未全部独立核对**：`2605.xxxxx`、`2606.16175`、`2610.18052`、`2611.00314` 等条目来自检索结果，编号形态可疑，**对外引用前必须回到论文页/仓库确认**；确认不了就只引「有这类工作」，不引编号。
2. **区分「论文报告的数字」与「本仓库实测」**：本文所有百分比都是论文数字，不代表本仓库表现。
3. **许可证未逐个核对**：OmniDocBench / READOC / Bemula / PAL-Bench 的许可需以仓库为准；只有 LongMemEval 明确 MIT。商用/打包前按 [`ARCH-tech-landscape.md`](ARCH-tech-landscape.md) 的红线流程走。
4. **不要把这篇文章的分类法说成「基准」**：MAST 是失败分类法，Handoff Debt / Switch-SWE 是研究框架，说成 leaderboard 是硬错误。

---

## 8. 明确未做

- **没有任何闸门脚本落地**：本文只有口径与抽样方案，`scripts/` 下没有对应 selftest，`npm run verify:*` 里没有基准闸门。
- **没有下载任何数据集**：OmniDocBench / READOC / olmOCR-Bench / LongMemEval / Bemula / PAL-Bench 均未落地到仓库或缓存。
- **没有跑过任何基准分数**：文中所有数字都是论文报告值。
- **没有自建「回滚一致性」harness**：编排一节的 20 条任务方案未实现。
- **没有自建关系强度标注集**：人物画像的三特征（共现频次 / 一对一天数 / 衰减）只是设计，未实现、未标注。
- **没有做注入预算实验**：记忆一节的「只给目录」硬约束未实现。
