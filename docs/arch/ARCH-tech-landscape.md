> 层：架构 · 状态：记录 · 核对：2026-11-14 · 覆盖：五件关键技术的开源 / 闭源实现、可复用度、许可证红线

# Arch · 技术生态对照

> 本文只做一件事：**给五件关键技术各列一遍市面上的实现，并标出能不能进安装包。**
> 五件技术本身的能力边界与判据见 [`ARCH-key-tech.md`](ARCH-key-tech.md)；各模块实现见对应 ARCH。
> 评测基准（有没有可下载数据集、本地闸门抄什么）见 [`ARCH-benchmark-landscape.md`](ARCH-benchmark-landscape.md)。
> **许可证一律以各项目当前仓库为准，上线前逐个复核**——本文的许可标注是"写文档时的认知"，不是法律意见。

---

## 0. 怎么用这份文档

```text
要选型        → 看 §1–§5 的「开源」列 + §6 许可证红线
要判断差异化   → 看每节末尾的「对我们的意义」
要引入新依赖   → 先过 §6 的两条门槛，再回 ARCH-key-tech 的 §0.1 判据
```

---

## 1. 解析精度

| 开源 | 许可 | 特点 |
|---|---|---|
| Docling（IBM） | MIT | 版面 + 表格 + 阅读顺序，PDF/DOCX/PPTX，工程最干净 |
| PaddleOCR / PP-StructureV3 | Apache-2.0 | 中文 OCR 与表格最强档之一，需要 Paddle 运行时 |
| Unstructured | Apache-2.0（部分能力商业版） | 格式覆盖最广，分区/切块成熟 |
| MinerU（OpenDataLab） | **AGPL-3.0** | PDF/PPT 多模态解析，效果好，许可证最严 |
| Marker / Surya | **GPL-3.0**（商用需授权） | PDF→markdown，学术公式强 |
| Tesseract | Apache-2.0 | 老牌 OCR，准但慢 |
| pdfplumber / pdfminer.six / Camelot | MIT | 文本层与表格抽取，轻量 |
| OmniParser（Microsoft） | MIT（研究向） | UI 截图 → 元素树，与 zhulong 的 UI 场景重叠 |
| PyMuPDF | **AGPL-3.0** / 商业双许 | 渲染与抽取都快，许可证要注意 |

**闭源**：Azure Document Intelligence、AWS Textract、Google Document AI、LlamaParse、Mistral OCR、Mathpix（公式最强）、Adobe PDF Extract、Reducto、火山文档智能 / 阿里读光 / 腾讯文档解析。

**对我们的意义**：现有 `unpdf / mammoth / xlsx / officeparser / epub2` 属"轻量直抽"那一档，许可宽松。**AGPL / GPL 那批只能通过 `engines/` 的 HTTP 外部引擎接**，不能打进安装包。

---

## 2. 多智能体编排与干预

| 开源 | 许可 | 定位 |
|---|---|---|
| LangGraph | MIT | 图状态机 + `interrupt`（人工介入） |
| AutoGen / AG2 | MIT | 多 Agent 对话与协作 |
| CrewAI | MIT | 角色化团队，上手快 |
| MetaGPT | MIT | 软件公司式流水线 |
| Letta（MemGPT） | Apache-2.0 | 有状态 Agent + 分层记忆 |
| Temporal | MIT | 不是 agent 框架，但**持久化工作流 + signal 干预**最扎实 |
| Dify / Flowise | Apache-2.0 | 可视化编排，偏应用层 |
| n8n | 各自条款（fair-code） | 集成/自动化 |

**闭源**：Claude Agent SDK、OpenAI Agents SDK / Assistants、AWS Bedrock Agents、Vertex Agent Builder、Microsoft Copilot Studio、Devin、Cursor / Factory 的 agent 模式。

**对我们的意义**：我们用 **ACP（Zed 提出的开放协议）+ 内置 dsh 执行**，本质是自写编排层。上面这些都没解决「真实终端执行 + 审批落库 + 终端状态回主界面」，所以没有直接采用。可借鉴两点：**Temporal 的事件溯源**、**LangGraph 的 interrupt 语义**。

---

## 3. Wiki 整理

| 开源 | 许可 | 定位 |
|---|---|---|
| Logseq | **AGPL-3.0** | 大纲 + 双链 |
| Khoj | **AGPL-3.0** | 笔记 + 检索 + 问答 |
| Reor | **AGPL-3.0** | 本地 AI 笔记 |
| Quartz / Foam | MIT | 静态站点 / 双链工具链 |
| Outline | BSL 1.1 | 团队 wiki（非 OSI） |
| BookStack | MIT | 团队 wiki |
| Wiki.js | AGPL-3.0 | 团队 wiki |
| AFFiNE | MIT（部分模块另议） | 文档 + 白板 |

**闭源**：Notion AI、Mem、Reflect、Tana、Heptabase、Capacities、Glean、Confluence Intelligence、Coda AI。

**对我们的意义**：**没有一家把「审核 + 引用 + 修订 + 过期传播」做成核心** —— 它们要么做双链，要么做 AI 写作。我们那套 `draft / reviewed / stale + revision` 反而构成差异点，不需要对标。

---

## 4. 记忆系统

| 开源 | 许可 | 定位 |
|---|---|---|
| Mem0 | Apache-2.0 | 最流行的「记忆层」库：抽取 + 去重 + 检索 |
| Letta（MemGPT） | Apache-2.0 | 分层内存 + 自管理上下文 |
| Graphiti / Zep | Apache-2.0 | **时序知识图谱记忆**，带 `valid_from/valid_to` |
| Cognee | Apache-2.0 | 图 + 向量混合记忆管道 |
| LangMem | MIT | LangChain 侧提取/更新工具 |
| MemoryOS | MIT（论文实现） | 短期 / 中期 / 长期三层 |

**闭源**：OpenAI ChatGPT memory、Anthropic Claude memory、Mem.ai、Rewind / Limitless、Microsoft Recall、AWS AgentCore Memory、Zep Cloud。

**对我们的意义**：**Graphiti / Zep 的时序边模型**最值得对照（我们用 `valid_from / valid_to` 自己实现）；Mem0 的抽取去重流程可参考。但它们都是「接一个服务」的形态，与「四层 + 注入预算 + 人工晋升」的取舍不同。

---

## 5. 人物画像构建

**这一格几乎没有现成实现**，是五件里唯一没有对标品的一项。

| 类别 | 代表 | 说明 |
|---|---|---|
| 结构化抽取 | [LangExtract](https://github.com/google/langextract)（Google，Apache-2.0）、DeepKE、OpenNRE | 能抽实体/关系，但不解决「分层 + 时间 + 确认」 |
| 时序图谱 | Graphiti / Zep、XTDB（双时态数据库） | 提供底层能力，画像逻辑要自己写 |
| 聊天导出解析 | 各类 telegram / wechat export 小工具 | 只做格式转换 |
| 企业人物数据 | ZoomInfo、Clearbit / Apollo、Affinity、Clay、Palantir Foundry | 卖的是**数据**（B2B 联系人），不是「构建你的私人关系画像」 |
| 个人 AI | Monica、Personal AI 等 | 更像聊天机器人，没有可审核的画像模型 |

**对我们的意义**：§1 那套（四格式导入 + 规则抽取 + 三层 + 双时态 + 群聊降权 + 候选确认）**市面上没有对标品**，是可复用的只有「抽取库」和「时序图模型」两层。这也是它必须自己写的根本原因。

---

## 6. 许可证红线（桌面分发必须过这一关）

```text
宽松许可（MIT / Apache-2.0 / BSD）  → 可以打包进安装包
AGPL / GPL                        → 只能作为「外部引擎」通过 HTTP 调用
商业双许（如 PyMuPDF）              → 要么买，要么外置
非 OSI（BSL / fair-code）           → 需逐条读条款，通常限制竞争性使用
```

| 只能外置（AGPL/GPL） | 可打包（宽松） |
|---|---|
| MinerU（AGPL）、Marker / Surya（GPL）、Logseq / Khoj / Reor / Wiki.js（AGPL）、PyMuPDF（AGPL） | Docling（MIT）、PaddleOCR（Apache）、LangExtract（Apache）、Graphiti（Apache）、Mem0（Apache）、Tesseract（Apache）、pdfplumber / Camelot（MIT） |

补充：

- **AGPL 对「桌面分发」的解释目前仍有争议**。最稳的做法仍是 `engines/` 外部引擎形态（进程外、用户自行安装），我们现有的 `mineru` / `paddle` / `custom` 引擎就是按这个边界设计的；
- Python 栈的解析器即使许可宽松，也会有「要不要打包 Python 运行时」的问题（见 [`ARCH-key-tech.md`](ARCH-key-tech.md) §8），这与许可证无关但要一起决定。

---

## 7. 总览

| 关键技术 | 开源可复用度 | 闭源对标 | 我们的位置 |
|---|---|---|---|
| ① 解析 | **高**（注意 AGPL/GPL） | 一堆云 API | 自建轻量层 + 外部引擎可选 |
| ② 编排 | 中（借鉴 interrupt / 事件溯源） | 各家 Agent SDK | 自研（要真实终端 + 审批） |
| ③ 整理 | 低（没人做审核链） | Notion AI 等 | **差异化** |
| ④ 记忆 | 中高（Graphiti 最值得对照） | ChatGPT / Claude memory | 自研，结构对齐 |
| ⑤ 画像 | **几乎为零** | 企业数据商 ≠ 私人画像 | **无对标，真创新点** |

## 8. 待确认

1. Docling 若打包进桌面（MIT），体积与依赖是否可接受？需要实测（Python 栈 → 只能外置或转 ONNX）。
2. Graphiti / Zep 的时序模型是否比我们现在的 `valid_from/valid_to` 更完备？值得读一遍再决定要不要吸收。
3. LangExtract（Apache-2.0）能否替代我们手写的规则抽取？它带原文定位，正好匹配「每条结论都能给出来源」。
4. OmniParser 与 zhulong 的 UI 场景重叠度：zhulong 自研检测头的优势是否足以不采用它。
