> 层：指南 · 状态：已落地 · 核对：2026-11-14 · 覆盖：文档地图、阅读路径、写作与校验规则

# 文档地图

`docs/` 的**唯一入口**。找不到东西时从这里往下走，不要靠 `grep` 文件名。

---

## 1. 30 秒看全局

```text
              ┌──────────────────────────────────────────────┐
   为什么做 →  │ product/   REQ（要什么） GAP（差什么） TEST（怎么验）│
              └───────────────────┬──────────────────────────┘
                                  │ 一条需求 → 一份设计 → 一份差距
              ┌───────────────────▼──────────────────────────┐
   怎么做的 →  │ arch/      ARCH-*（一个子系统一篇）+ PLUGIN-notes │
              └───────────────────┬──────────────────────────┘
                                  │ 落地后回填状态与代码位置
              ┌───────────────────▼──────────────────────────┐
   怎么用 →    │ guides/    用法 · DESIGN-SYSTEM（UI 硬规则）· WADE │
              └────────────────────────────────────────────────┘
              ┌────────────────────────────────────────────────┐
   怎么讲 →    │ articles/  对外叙事（知乎三篇，事实以 arch/ 为准） │
              └────────────────────────────────────────────────┘
```

一句话：**`product/` 说为什么，`arch/` 说怎么做和做到哪，`guides/` 说怎么用和怎么改，`articles/` 说给外人听。**

## 2. 四层：每层回答什么问题、什么时候读

| 层 | 目录 | 回答 | 什么时候读 | 谁写 |
|---|---|---|---|---|
| 需求 | [`product/`](product/) | 为什么做、要什么、差什么 | 接新模块前；判断「这算不算范围外」 | 产品 / 提需求的人 |
| 架构 | [`arch/`](arch/) | 边界在哪、数据结构、状态机、IPC、取舍 | 改代码前；review 时对齐边界 | 实现者 |
| 指南 | [`guides/`](guides/)、[`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md)、[`WADE.md`](WADE.md) | 怎么用、UI 硬规则、怎么提 PR | 动手前必须先读的约束 | 维护者 |
| 叙事 | [`articles/`](articles/) | 对外讲这个故事 | 写文章、做分享 | 作者 |

辅助目录（不属于四层，但有引用关系）：[`migrations/`](migrations/) SQL 迁移、[`prototype/`](prototype/) 静态交互原型、[`assets/`](assets/) 文章配图。

## 3. 三条阅读路径

**A. 第一天就上手（30 分钟）**
[`../README.md`](../README.md) 界面五列 → [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) 改 UI 前必读 → [`WADE.md`](WADE.md) 开发流程 → [`arch/ARCH-multi-agent-workspace.md`](arch/ARCH-multi-agent-workspace.md) 4+1 视图（**先看这张总图，其余 ARCH 都是它的一个格子的放大**）→ [`arch/ARCH-key-tech.md`](arch/ARCH-key-tech.md) 五件关键技术（判断「这件事难在哪、做到什么算做到」）。

**B. 改一个模块（按依赖顺序读，不要跳）**

1. `product/REQ-*.md` 里这个模块的条目 —— 确认「要什么」；
2. `arch/ARCH-<模块>.md` —— 确认「边界在哪、不能碰什么」；
3. 文档末尾的**代码位置**与**明确未做**两节 —— 确认「改哪里、别越界」；
4. `product/GAP-*.md` —— 确认「这是已知差距还是新需求」。

对应关系：Chat → `ARCH-chat-thread` + `ARCH-chat-ui` · 终端/预览 → `ARCH-terminal-ux` + `ARCH-ui-context` · 任务/Mission → `ARCH-super-agent` · 文件/Git/设置/主机 → 同名 ARCH。

**C. 对外写东西**
[`articles/`](articles/) 拿叙事骨架 → 数字和结论回 `arch/` 核对（**文章里的实现细节可能已经过期，永远以 `arch/` 为准**）。

## 4. 追踪链：需求 → 设计 → 差距

| 需求文档 | 覆盖它的设计 | 差距基线 |
|---|---|---|
| [`product/REQ-original.md`](product/REQ-original.md)（纠正版） | `ARCH-multi-agent-workspace`、`ARCH-chat-*`、`ARCH-git`、`ARCH-terminal-ux`、`ARCH-file-explorer`、`ARCH-settings` | [`product/GAP-requirements.md`](product/GAP-requirements.md) |
| [`product/REQ-multi-agent-workspace.md`](product/REQ-multi-agent-workspace.md)（76 条） | `ARCH-multi-agent-workspace`、`ARCH-hosts-stats`、`ARCH-ui-context`、`ARCH-super-agent` | 同上 |
| [`product/REQ-modules-original.md`](product/REQ-modules-original.md)（按模块） | `ARCH-knowledge`、`ARCH-memory`、`ARCH-wiki-retrieval`、`ARCH-memory-persona-im`、`ARCH-plugins`、`PLUGIN-notes` | 同上；用例见 [`product/TEST-REQ-modules-original.md`](product/TEST-REQ-modules-original.md) |
| 跨模块（§1/§2/§3/§4 的能力总览） | `ARCH-key-tech`（五件关键技术：解析 / 编排 / 整理 / 记忆 / 画像） | 同上 |
| **（缺）Super Agent / Mission** | `ARCH-super-agent` + `USAGE-super-agent` | — |

**已确认的两个编排缺口：**

1. **Super Agent 没有 REQ** —— 需求只存在于 Chat 对话和 `ARCH-super-agent.md` 的第 1 节。想让「验收是人的动作」这类不变量可追溯，得补一份 `product/REQ-super-agent.md`（只写目标、范围外、不变量，不写实现）。
2. **GAP 是快照，不是活文档** —— `GAP-*.md` 的勾选没逐条复核过。**单条状态一律以 `arch/ARCH-*.md` 的状态头为准**；改功能时顺手翻一下对应 GAP 条目。

## 5. 全量索引

状态词表：`已落地`（代码在、能用）· `部分落地`（主干在、有明确未做项）· `提案`（只有设计）· `记录`（冻结的原始材料 / 流水账）· `已取代`。

| 文件 | 层 | 状态 | 一句话 |
|---|---|---|---|
| [`product/REQ-original.md`](product/REQ-original.md) | 需求 | 记录 | 原始需求（纠正版） |
| [`product/REQ-multi-agent-workspace.md`](product/REQ-multi-agent-workspace.md) | 需求 | 记录 | 多智能体工作台规格（76 条） |
| [`product/REQ-modules-original.md`](product/REQ-modules-original.md) | 需求 | 记录 | 按模块的原始需求与验收 |
| [`product/GAP-requirements.md`](product/GAP-requirements.md) | 需求 | 记录 | 需求落地清单 P0/P1/P2（快照） |
| [`product/GAP-chat.md`](product/GAP-chat.md) | 需求 | 记录 | Chat 差距基线 |
| [`product/TEST-REQ-modules-original.md`](product/TEST-REQ-modules-original.md) | 需求 | 记录 | 需求对应测试用例（未执行） |
| [`product/DATASET-wechat.md`](product/DATASET-wechat.md) | 需求 | 记录 | 微信语料样本与标注口径 |
| [`arch/ARCH-key-tech.md`](arch/ARCH-key-tech.md) | 架构 | 部分落地 | **五件关键技术**：解析 / 编排 / 整理 / 记忆 / 画像的边界、现状、判据、风险与一句话应对 |
| [`arch/ARCH-tech-landscape.md`](arch/ARCH-tech-landscape.md) | 架构 | 记录 | 五件关键技术的开源 / 闭源实现对照、可复用度、许可证红线 |
| [`arch/ARCH-multi-agent-workspace.md`](arch/ARCH-multi-agent-workspace.md) | 架构 | 部分落地 | **总图**：4+1 视图（宿主 / 执行 / 存储 / 远程） |
| [`arch/ARCH-super-agent.md`](arch/ARCH-super-agent.md) | 架构 | 部分落地 | Mission / Delegation / MCP / 迁移 |
| [`arch/ARCH-chat-thread.md`](arch/ARCH-chat-thread.md) | 架构 | 已落地 | thread 模型与 send 状态机 |
| [`arch/ARCH-chat-ui.md`](arch/ARCH-chat-ui.md) | 架构 | 已落地 | Chat 视觉结构与 composer |
| [`arch/ARCH-terminal-ux.md`](arch/ARCH-terminal-ux.md) | 架构 | 已落地 | 终端易用性 / pane 拆分 / 回放 |
| [`arch/ARCH-ui-context.md`](arch/ARCH-ui-context.md) | 架构 | 已落地 | 预览拾取 → Agent 上下文 |
| [`arch/ARCH-file-explorer.md`](arch/ARCH-file-explorer.md) | 架构 | 已落地 | 资源管理器与文件操作 IPC |
| [`arch/ARCH-git.md`](arch/ARCH-git.md) | 架构 | 已落地 | Source Control |
| [`arch/ARCH-hosts-stats.md`](arch/ARCH-hosts-stats.md) | 架构 | 已落地 | 主机探测与统计口径 |
| [`arch/ARCH-settings.md`](arch/ARCH-settings.md) | 架构 | 已落地 | 设置项、持久化、生效链路 |
| [`arch/ARCH-plugins.md`](arch/ARCH-plugins.md) | 架构 | 部分落地 | 插件宿主 / manifest / Host API |
| [`arch/PLUGIN-notes.md`](arch/PLUGIN-notes.md) | 架构 | 部分落地 | first-party Notes：Source / Page / Citation / Review |
| [`arch/ARCH-notes-ux.md`](arch/ARCH-notes-ux.md) | 架构 | 已落地 | Wiki / 笔记界面层 |
| [`arch/ARCH-knowledge.md`](arch/ARCH-knowledge.md) | 架构 | 部分落地 | 知识库：解析 / 索引 / 检索 / 引用 |
| [`arch/ARCH-wiki-retrieval.md`](arch/ARCH-wiki-retrieval.md) | 架构 | 提案 | 检索质量与 SAG2 评估 |
| [`arch/ARCH-memory.md`](arch/ARCH-memory.md) | 架构 | 部分落地 | 四层记忆 + Dream |
| [`arch/ARCH-memory-persona-im.md`](arch/ARCH-memory-persona-im.md) | 架构 | 记录 | 记忆 / 人像 / 知识 / IM 一轮落地记录 |
| [`arch/ARCH-office.md`](arch/ARCH-office.md) | 架构 | 部分落地 | 办公室舞台：状态映射 / 交互 / 协作场景边界 |
| [`arch/ARCH-usability-pass.md`](arch/ARCH-usability-pass.md) | 架构 | 已落地 | 易用性一轮改动 |
| [`arch/ARCH-package-size.md`](arch/ARCH-package-size.md) | 架构 | 已落地 | 打包体积与瘦身 |
| [`guides/USAGE-super-agent.md`](guides/USAGE-super-agent.md) | 指南 | 已落地 | Mission 用法 |
| [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) | 指南 | 已落地 | UI 视觉与组件硬规则 |
| [`WADE.md`](WADE.md) | 指南 | 已落地 | WADE 开发流程 |
| [`articles/ARTICLE-zhihu-multi-agent-terminal.md`](articles/ARTICLE-zhihu-multi-agent-terminal.md) | 叙事 | 记录 | 对外文章：多智能体终端 |
| [`articles/ARTICLE-zhihu-super-agent.md`](articles/ARTICLE-zhihu-super-agent.md) | 叙事 | 记录 | 对外文章：Super Agent |
| [`articles/ARTICLE-zhihu-llm-wiki.md`](articles/ARTICLE-zhihu-llm-wiki.md) | 叙事 | 记录 | 对外文章：LLM Wiki 与记忆 |
| [`articles/ARTICLE-zhihu-scenarios.md`](articles/ARTICLE-zhihu-scenarios.md) | 叙事 | 记录 | 对外文章：多智能体工作台的场景 |
| [`plan-round1.md`](plan-round1.md) | 架构 | 提案 | 第 1 轮计划：五件关键技术的波形与验收（只定计划与口径，不写业务代码） |
| [`prototype/README.md`](prototype/README.md) | 架构 | 记录 | 交互原型说明（静态 HTML，不是实现） |

## 6. 已知重复与冲突（改之前先看这一节）

| 现象 | 处理方式 |
|---|---|
| `ARCH-memory.md` 与 `ARCH-memory-persona-im.md` 都讲记忆，后者是**实施流水账** | 语义以 `ARCH-memory` 为准；`ARCH-memory-persona-im` 只当历史记录读，新增内容不要再往里写 |
| `ARCH-knowledge` / `ARCH-wiki-retrieval` / `PLUGIN-notes` 三篇都涉及检索 | 分工：`ARCH-knowledge` = 资料侧（解析→索引→引用），`PLUGIN-notes` = 页面侧数据与 API，`ARCH-wiki-retrieval` = 检索质量评估。**新增检索相关内容按这三条边界归属** |
| `docs/` 与 `resources/wiki/` 是两套语料 | `resources/wiki/*.md` 由 `npm run wiki:publish` 发布到 GitHub Wiki，**不从 `docs/` 生成**。改 `docs/` 不会自动改 Wiki；两者冲突时以 `docs/arch/` 为准 |
| 四篇 ARTICLE 占全部文档行数的三分之一 | 刻意保留（对外资产）。不要在 `articles/` 里维护实现细节，改实现只改 `arch/` |
| `GAP-*.md` 勾选与 ARCH 状态不一致 | 以 ARCH 状态头为准，见 §4 |

## 7. 写作规则

**每篇文档第一行必须是状态头**，格式固定（`npm run verify:docs` 会校验）：

```markdown
> 层：架构 · 状态：已落地 · 核对：2026-11-14 · 覆盖：一句话说清这篇管什么
```

- `层` ∈ `需求 / 架构 / 指南 / 叙事`
- `状态` ∈ `已落地 / 部分落地 / 提案 / 记录 / 已取代`
- `核对`：最后一次**对着代码确认**的日期。改了这个子系统的代码，就要改这个日期；没核对过不要动它。
- `覆盖`：一句话，不换行，不出现 ` · `（会破坏解析）。

**内容规则**

1. **写完就写清「明确未做」**。`部分落地` 必须有对应的「未做」清单，否则会被读成 `已落地`。
2. **不写流水账**。「本轮改了什么」属于 `CHANGELOG.md`；ARCH 只写**当前状态 + 为什么是这样**。
3. **不写「待实施」当挡箭牌**。没人认领的写 `提案`，有人做了但没做完的写 `部分落地` + 未做清单。
4. **链接用相对路径**，跨层引用写 `../product/xxx.md`，不要写绝对路径或 `docs/` 前缀（否则移动目录就断）。
5. **新增文档先在本文件 §5 登记**，否则校验失败。

## 8. 校验

```bash
npm run verify:docs
```

检查四件事：每篇有合法状态头、状态词在词表内、文内链接都能解析、每篇都在 §5 登记。
