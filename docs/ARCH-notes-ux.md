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
