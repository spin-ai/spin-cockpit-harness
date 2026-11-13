# 记忆 / 人像 / 知识 / 即时通信（2026-11）

对应需求：`docs/REQ-modules-original.md` 的 Knowledge、LLMWiki-06、Memory、Persona、MultiTerminal-01、IMAgent、Chat-01(IM 入口)、Worktree-02、DataRelease-01。

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
- 注入：run 启动时 `inject()` 按预算（默认 6000）做减法，超了显式写「已省略 N 条」；「记忆」页右侧可查看本次注入了什么。
- Dream 五种动作全部落地，只产建议：
  `fix`（失效引用 / 缺摘要）、`build`（有资料无页面）、`fill`（无引用无反链）、`promote`（已验证观察）、`prune`（L3 体积超限）。
  接受后由 `applyMemorySuggestion()` 执行（建 draft / 生成页面 / 标 stale / 归档条目），拒绝写 `rejects`。
- 回查：`memoryTranscriptSearch` 只读检索消息 / run / 事件，带时间与 thread/run id；Agent 通过 `memory_search` 使用。

## 4. 人物（Persona / 人物建模）

- `electron/persona/index.mjs`：导入聊天导出（文本 `时间 说话人` / `说话人: 内容`、JSON 导出）→ 规则抽取（偏好 / 硬约束 / 目标 / 事件 / 立场 / 关系）。
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

## 5. 即时通信（IM）

- `electron/im/gateway.mjs`：Telegram（`getUpdates` 长轮询，真实可用）+ 飞书/微信出站 webhook + 本地入站 HTTP（`POST {chat_id, text}`）。
- 安全：只处理 allowlist；陌生会话忽略并留日志；入站要求 `Bearer` token。
- 入站消息走 `actions.send()` → 同一套 thread/todo/run；`im/sessions.json` 记录 chat ↔ todo。
- run 结束回传三段式卡片（结果 / 步骤 / 协议身份）；审批时推「回复数字」卡片，数字消息即选择。
- 桌面关闭时：Telegram 侧消息留在 offset 队列，下次启动继续；飞书/微信入站需要公网可达（或用内网转发），这条限制在设置里写明。

## 6. 其余补齐

- **MultiTerminal-01**：终端 5 分钟无新输出 → 主进程 `terminalIdleOf()` 标记 `stalled`（事件 `terminal.stalled`），终端标签显示 ⚠。
- **Worktree-02**：手工终端「接入任务」时可选择保持当前目录或切到该任务最近的 worktree（只影响后续 run）。
- **DataRelease-01**：`dshEnv`（含 API key）用 Electron `safeStorage` 加密存放（`enc:` 前缀），启动时自动迁移明文；UI 读取时解密，行为不变。
