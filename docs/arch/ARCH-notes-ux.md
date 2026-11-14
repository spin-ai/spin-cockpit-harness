> 层：架构 · 状态：已落地 · 核对：2026-11-14 · 覆盖：Wiki / 笔记界面层

# Wiki / 笔记：易用性与视觉

> 内置 `ai.cockpit.notes` 插件的界面层（`src/components/Notes.tsx` / `NotesEditor.tsx`）。
> 本轮只做「快速改善」：信息层级、空状态、动线、噪音控制；不动插件能力边界。

---

## 1. 信息层级

```
NATIVE · LLM WIKI
Wiki                                  [+ 新建页面] [导入资料] [打开目录] │ 记忆 分屏 图谱 ⟳
1 页面   0 资料   1 待审核   5 本地文件
──────────────────────────────────────────────────────────────
页面│资料│审核│本地         Untitled ×  ＋        详情
[w/search]              Untitled                   页面  10 字 · 更新于 …
Untitled  draft         Draft · 0 citations        STATUS  Draft
                        [阅读|编辑] [接受] 退回 创建任务 发送到 Chat   CITATIONS 0
                        ─ 工具栏（H1 H2 B I … ∥ 1 词 · 12 字 ✓ 已保存 保存）
                        # Untitled
```

- 顶部用 **统计 chips**（页面 / 资料 / 待审核 / 本地文件）代替一行 mono 文本
- 主按钮只有「＋ 新建页面」是 primary，其余降级为普通按钮 / 文本链接
- 文档头把「阅读 / 编辑」做成 segmented，接受/退回/创建任务/发送到 Chat 一律文本链接，避免一堆同权重按钮

## 2. 空状态（首次进入）

中间区从「一句灰字」换成 **三张行动卡**：新建页面 / 导入资料 / 打开本地目录，各带一句用途说明 + 快捷键提示。
右侧详情区改为 3 条虚线占位（引用来源 / 反向链接 / 关联任务），告诉用户打开页面后会出现什么。

## 3. 修掉的两个坑

| 问题 | 处理 |
|---|---|
| 「新建页面」点了没反应 | Electron 不支持 `window.prompt`，原本靠 prompt 取标题 → 直接建 `Untitled`（自动去重 `Untitled 2`），打开后标题输入框自动聚焦全选 |
| 「退回」无反馈 | 同样去掉 prompt，反馈留空，由页面正文承载 |

## 4. 噪音控制

- 顶部提示改成**胶囊**（`fit-content`、可关闭、成功提示 4s 自动消失；错误保留）
- 本地目录列表的文件夹标题改成 sticky 小标题（大写、字号 9.5px、带计数），不再和文件行抢视觉
- 右侧 meta 块之间加分隔线；`Draft` 徽标改为行内宽度，不再拉满整列

## 5. 验证方式

用 CDP 截图对比（`Page.captureScreenshot`）逐轮检查：
首屏空状态 → 新建页面 → 打开本地目录（含分组）→ 编辑器工具栏与右侧详情。

> 备注：本轮未改编辑器内核（CodeMirror 6）与插件 API；快捷键仍是 `⌘S` 保存。

## 6. 生成 Wiki 的完整动线（补上「不知道怎么生成」）

```
打开本地目录 ─┐
导入资料 ─────┼→ 「全部导入为资料」→ 「生成 Wiki」→ 页面（draft）→ 编辑 / 审核
粘贴 URL ────┘        (vault.importSource)     (wiki.generate)      (review accept)
```

- **「全部导入为资料」**：把本地目录里的 `.md`（最多 30 个）逐个 `wiki.vault.file` → `wiki.importSource`，失败单个不阻塞；入口在「本地」和「资料」两个 tab 的底部
- **「生成 Wiki」**：插件内确定性生成（`wiki.generate`）——每份还没有对应页面的 source 生成一个 draft 页面，
  带摘要（首段）、原文摘录、`来源：[[标题]]`，并建立 citation；返回 `{created, pages}`
  - 不依赖模型与 API key；生成后可以在页面里编辑、审核，或用资料页的「发送到 Chat」让 Agent 精修后回写
- 头部的「生成 Wiki」**不置灰**（置灰按钮点不动、也看不到原因）：
  · 有资料 → 直接生成，标签显示 `生成 Wiki (N)`
  · 没资料但已打开本地目录 → 先自动「全部导入为资料」再生成（tooltip 会写清楚）
  · 两样都没有 → 提示「先在本地打开 Markdown 目录，或导入资料」并停在页面 tab

## 7. 图谱为什么之前是空的

`wiki.graph` 之前只包含 `pages + sources`：打开本地目录只写 `vaultPath`，既不产生 source 也不产生 page，于是图谱 0 节点。

现在 `graphView()` 把 **vault 文件也作为 `kind: "file"` 的节点**（`file:<相对路径>`），打开目录后立刻可见；
边依然是「页面→资料」的 citation 与页面之间的 `[[双链]]`。file 节点不可点击打开页面（只是存在性展示）。

## 8. 删除与行内快捷操作（本轮）

| 对象 | 入口 | 行为 |
|---|---|---|
| 资料 source | 「资料」列表行 hover → 删除 | 二次确认；插件 `wiki.deleteSource` 连带清掉它产生的 citation（页面保留），提示「同时移除 N 条引用」 |
| 页面 page | 「页面」列表行 hover → 删除 | 二次确认；`wiki.deletePage` 同时关闭已打开的 tab、清掉 docs 缓存 |
| 待审核 draft | 「审核」列表行 hover → 接受 / 退回 | 不用先打开页面；接受后 `reviews` 立即减一 |
| 搜索 | 输入框右侧 × / `Esc` | 清空关键词与结果 |

实现细节：行结构改成 `.notes-row`（按钮 + `.notes-row-actions`），动作按钮默认 `display:none`，hover 才出现，避免列表噪音；
hover 时隐藏右侧计数（`em`）给动作让位。

验证：`scripts/e2e-notes.mjs`（4/4）—— 自动导入+生成、删除资料（sources 3→2、edges 6→4）、
删除页面（pages 3→2、行数同步）、审核快捷接受。

## 9. 「导入资料」与「本地目录」的关系（去重）

两者都会产生 **source**，但入口语义不同：

| 入口 | 用途 | 结果 |
|---|---|---|
| 导入文本 / URL（原「导入资料」） | 粘贴一段文本、Markdown 或一个 http(s) 链接 | `wiki.importSource` |
| 打开本地目录 | 浏览/编辑仓库里的 `.md`，需要时才导入 | `wiki.vault.open`（只记录目录）；「全部导入为资料」/ 文件右侧「导入为 Source」才产生 source |

为了避免重复堆资料：

- 插件统一 `findSource()` 去重：**同 uri（路径）或同内容 hash** 视为同一份，`wiki.importSource` / `wiki.vault.importSource` 命中时只更新标题与内容并返回 `{ deduped: true }`
- UI 用 `sources.uri` 计算「还没导入的本地文件」：
  · 本地 tab 底部按钮显示「全部导入为资料（待导入数）」，导完变「已全部导入为资料」并置灰
  · 右侧「导入为 Source」在已导入时变成「已在资料中」的说明块
- 「生成 Wiki」本身按标题去重（已有同名页面就跳过），重复点击不会产生重复页面

验证：`scripts/e2e-notes.mjs` + 本地脚本（4/4）——待导入数、导完置灰、重复 importSource 返回 deduped 且 sources 数量不变、重复生成 pages 不变。

## 10. 导入本地文档（本轮）

原来「导入资料」只能粘贴文本 / URL，**不能选磁盘上的文件**。现在：

| 入口 | 说明 |
|---|---|
| 头部「导入文档」 | 直接打开系统文件选择器，可多选 |
| 弹窗「粘贴文本 / URL」→ 第三档「本地文件」 | 选择文件… 按钮同样打开选择器 |

- 主进程 `docs:pick` / `docs:read`：支持 `.md .markdown .mdx .txt .json .csv .tsv .yml .yaml .html .log .ini .conf .rst .org`
  · 单文件上限 5MB；超过 / 二进制（含 NUL 或 >5% 控制字符）逐个返回 `error`，不整体失败
- 导入时 `kind: "file"`、`uri` 用绝对路径 → 与本地目录导入共用同一套去重（同路径 / 同内容 hash）
- 文件名去掉扩展名作为标题；同名不同后缀会按标题合并成一个页面（生成阶段按标题去重），需要区分可改名后再生成

## 11. 自动整理（大纲 / 互链 / 索引）

之前只有「生成 Wiki」一次性产出草稿，没有后续结构维护。现在头部新增 **整理 Wiki**（位于「生成 Wiki」右边，页面 ≥ 1 时可用；命令面板也能搜到「整理 Wiki」）：

| 动作 | 说明 |
|---|---|
| **改标题** | 优先用正文 `# H1`；没有 H1 时把 slug 美化（`table-import` → `Table Import`）；标题太弱（全小写 slug / Untitled）才从摘要里挑一句像话的。重名自动加序号。**只对 `draft` 生效** |
| 统一大纲 | 每个页面规范成 `# 标题` → `## 要点`（从正文列表提取，去重、跳过双链）→ `## 原文摘录`（摘录里的 `#` 降级为加粗，避免和页面结构打架）→ `## 相关` |
| 不删人写的内容 | 已有的「要点」条目与「相关」里的手写链接**原样保留**（含指向未来页面的前向链接），整理只做补充与重排 |
| 补互链 | 引用同一份 source 的页面互相加 `[[双链]]`；没有相关页时链回索引 |
| 重建索引 | 维护 `Wiki 索引` 页：按「已审核 / 草稿 / 已过期」分组列出页面 + 资料清单 |
| 同步链接 | 改标题时把页面里的 `[[旧标题]]` 一起改写到 `[[新标题]]`，索引页也同步；改名只发生在 `draft` 上 |
| 幂等 | 第二次整理不会再改内容（`updated: 0`、`renamed: 0`）；索引页只重写自己 |
| **已审核 / 已过期页面** | **不写盘**：改动变成一条待审建议（带改动理由 + 逐行 diff），在「审核」里批准后才写。索引页本身变成 `reviewed` 后同理 |

另外 `wiki.generate` 生成草稿时也会优先用资料正文的 H1（文件名 `doc-import` 不会再变成页面标题）。

实现：插件 `wiki.curate`（确定性，不需要模型）；计算部分是纯函数 `plugins/notes/curate-structure.mjs`，断言见 `npm run wiki:curate:selftest` 第 [4] 组。UI 在收到结果后刷新列表，并把当前打开的页面重新 `wiki.getPage` 一次（`draft` 可能被改写）。

> 注意：`Wiki 索引` 是自动维护页，**只要它还是 draft** 就会被重写；一旦被审核成 `reviewed`，后续更新也要人点头。其它页面只重写上面四个段落，正文其它内容保留。

### 11.1 建议审核（已审核页面的唯一改动通道）

整理对 `reviewed` / `stale` 页面的改动不会直接落盘，而是进「审核」tab 的建议队列：

| 环节 | 行为 |
|---|---|
| 入队 | 每条建议带 `baseHash`（生成时的页面 hash）、完整渲染正文、改动理由；同一页面旧的 pending 建议自动作废，内容相同的建议不重复入队 |
| 看 | 点建议行弹出逐行 diff（`+` / `−` / 未变），**看到的就是批准后写入的字节** |
| 接受 | 插件纯字节拷贝，不重新调模型；写一条 `revision`（`suggest:<id>`）可回滚 |
| 页面已改过 | `hash(当前正文) !== baseHash` → 标 `needs_rebase`，**不自动合并**，提示重新整理再审核 |
| 退回 | 记 `feedback` 并留痕，不写盘 |
| 人工结论 | 右栏「人工结论」列出人改过的句子；整理会动到它们时页面自动整理被拦下，状态标 `conflict` / `orphan`，改动进建议队列 |
| 结论待确认 | 「审核」tab 顶部列出有 `conflict` / `orphan` 结论的页面（红点，标「结论待确认」），可「查看」或「全部解除」；解除只撤销锁定，不动正文 |
| 漏引用 / 重复 | `⋯ → 查找重复与漏引用` 跑确定性扫描，结果进「审核」：行上标「引用」「合并」，弹层只展示依据（资料原文 / 两页标题），接受时分别「加入引用」「生成合并草稿」 |

断言：`npm run wiki:plugin:selftest`（reviewed 字节不变、`needs_rebase` 不覆盖、写入字节 === payload、留 revision、人工结论被动到就不写）。

### 11.2 模型整理（`wiki.curate.llm`）

上面的「整理结构」只重排大纲 —— 要点是从正文列表里正则抓的，摘要沿用创建时那条，所以内容质量不会提升。
补充一档 **模型整理**（头部按钮「模型整理 (N)」，N = 草稿页数）：

| 维度 | 规则 |
|---|---|
| 改动范围 | **只改「> 摘要」与「## 要点」**；原文摘录 / 相关 / 用户自己写的小节一律不动 |
| 写入方式 | **不落盘**：结果变成一条 `summary` 待审建议（`wiki.suggestSummary`），人看过逐行 diff 才写；`reviewed` / `stale` 默认跳过 |
| 落盘前闸门 | `wiki.claimCheck`：会动到人工结论的页面直接跳过（不进队列，报错里写明原因） |
| 输入 | 标题 + 现有摘要 + 正文（截断 6000 字）+ 已绑定资料的标题与引文片段 |
| 输出 | `{summary, bullets[4–6]}`，JSON；网关不支持 `response_format` 时自动退回纯文本 + 宽容解析 |
| 缓存 | `userData/wiki-curate-cache.json`，按**整理前**正文 hash 去重，页面没变不重复花钱 |
| 接受 | 与结构整理同一条路径：字节拷贝 + `revision(suggest:<id>)`；页面改过 → `needs_rebase`，不自动合并 |
| 成本 | 每页约 2k tokens（deepseek-v4-flash 仍会推理，实测 ~1.8k reasoning）；确认框会写明页数，结果里回显实际 tokens |
| 无 key | 直接报错并提示先用「整理结构」，不静默降级 |

纯函数（拼 prompt / 解析 / 嵌回正文）在 `electron/wiki-curate.mjs`，用 `npm run wiki:curate:selftest` 覆盖；
加 `-- --ark` 会额外发一次真实调用验证解析链路。

## 12. 视觉收口（2026-11）：一个主面 / 收高亮 / 收按钮

按 `docs/DESIGN-SYSTEM.md` 复核后重做了 Wiki 页的表层（不动插件能力）：

| 问题 | 处理 |
|---|---|
| 页面自建 `h1` + 统计行 + 13 个按钮 | 改用 `PageHeader`（`kicker / title / subtitle 统计 / actions`）；顶部只留「＋ 新建页面」primary + 常用动作（导入资料 / 生成 Wiki / 整理 Wiki / 问 Wiki）+ `⋯` 菜单（本地目录 / 图谱 / 记忆 / 分屏 / 导出）+ 刷新 |
| 三块面板各自 `border + 12px 圆角` | 左栏与右栏退回画布，只用 1px hairline 分栏；只有主编辑面是有边界的主面 |
| 顶部四层 chrome（页面头 → tab → 文档头 → 工具栏 → 状态） | 页面头一行；tab 32px；文档头 52px（标题 + 状态 · 引用 · 时间 + 阅读/编辑 + 保存 + `⋯`）；工具栏 24px 图标；字数 / 保存状态沉到编辑器底部状态条 |
| 编辑器整行灰底 + 行号 + 等宽排中文 | `.cm-gutters` 隐藏；正文 `--font-sans` 13.5px/1.72；单栏 660px 居中（`--notes-col`，预览同宽，切换不跳）；当前行无底色无块状高亮 |
| CodeMirror 选中用 brand 22% | 改 `fg` 14% alpha，对齐规范 |
| 右栏 `Status / Citations / Backlinks / Linked Todos` 英文大写 + `confidence:` | 统一中文（状态 / 引用来源 / 反向链接 / 未链接提及 / 关联任务 / 置信度），数字 `tabular-nums`，块之间 hairline，空块给一句「怎么才会有」 |
| 列表行「标题 + 彩点 + draft」一行 | 两行：状态点 + 标题 / 状态 · 相对时间；hover 出 `⋯`（收藏 / 删除）；选中保留左侧 2px hairline |
| 工具栏 glyph 混排（🔗 ❝ ⌕ ▦） | 新增 `UndoIcon / RedoIcon / CodeIcon / TableIcon / RuleIcon / CheckSquareIcon`，工具栏按「撤销 · 标题 · 行内 · 列表 · 插入 · 查找」分组，1px 分隔 |
| 分屏中缝 hover 变实色竖条 | 5px 命中区 + 1px hairline，hover 只加深 |
| 图谱节点全同色、字粗线细 | 页面 brand / 资料 amber / 本地文件 faint；边 `stroke-width:.3`，标签按类型 1.9–2.1px |

验证：`npm run typecheck` / `build` / `verify:plugins` / `verify:design` 全过；
用临时数据目录起 Electron + CDP 截图，亮色（列表 / 阅读 / 编辑）与暗色（编辑）各一张比对。
