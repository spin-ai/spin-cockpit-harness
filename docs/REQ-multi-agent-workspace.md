# YieldMind Harness（多 Agent 工作台）— 原始需求（v0.3）

> **仓库**：`spin-yieldmind-harness`（与同级目录 `spin-yieldmind-ide` 并列的独立仓）。
> **定位**：**独立发包**的桌面工作台 —— 左侧编排 Agent 与任务，中间是域工具面板（Data / Plot / HTML），右侧是会话与日志，四者共享同一份上下文。
> 冲突时以本文为准；未列入第 11 节的内容一律不做。
>
> **v0.3 变更**：定位由「编排控制台」扩为「工作台」；§3 新增 G–L 六个模块（布局 / 数据 / 绘图 / HTML 画布 / 上下文总线 / Agent–面板接口）；新增第 13 节复用清单；分期重排。
> **v0.2 变更**：形态由「VSCodium 内的侧栏」改为「独立发包的 Electron 应用」（第 1/7/10/11 节）；新增第 8 节分发清单、第 12 节选型结论。

---

## 1. 目标

用**一个界面**管住一支 Agent 队伍（本机 + SSH 远程），把每天的 TODO 变成可追踪、可干预、可收口的执行流。

**形态（已定，不再讨论）**：独立安装包（`.dmg` / `.exe` / `.AppImage`），壳内含本地控制面、本地执行器、SSH 客户端、域面板容器；远程主机只装瘦代理。**不以 VSCodium 为底座，不 fork reference / reference。**

**能力边界（已定）**：不做通用代码编辑器，但**要做工作区布局系统 + 域面板**（数据 / 绘图 / HTML 画布）。域面板必须**插件化**（统一 Panel 契约），否则后续每个新面板都会往核心里糊代码。

| 指标 | 目标值 |
|---|---|
| 早上把当日计划变成已分派任务 | ≤ 5 分钟，≤ 5 次点击 |
| 任一 Agent 在干什么，一屏可见 | 1 屏，无需翻日志 |
| 从发现问题到把纠正送达正在跑的 Agent | ≤ 10 秒 |
| Agent 跑完后"结果落在哪里" | 必须回到原 TODO，不允许只留在会话里 |

---

## 2. 角色

- **用户**：唯一操作者（个人/小队）。团队与权限为 P2。
- **Agent**：一个有名字、有 CLI、有工作目录、有并发上限的执行体。分本地 / 远程（SSH）两类。
- **主机（Host）**：一台机器，装一个代理进程，向控制台上报心跳与 Agent 清单。

---

## 3. 功能需求

### A. Agent 与主机管理（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| A1 | 探测本机已安装的 Agent CLI（claude / codex / pi / opencode …），一键纳管 | 纳管后能在分派下拉框里选到 |
| A2 | 添加远程主机：填 SSH 信息 → 控制台输出一条安装命令 → 在远端执行后自动上线 | 远端 Agent 可被分派并执行命令 |
| A3 | Agent 档案：名称、CLI、工作目录、并发上限、技能/提示词、可用工具白名单 | 修改后新 run 生效 |
| A4 | 心跳与状态：在线 / 离线 / 忙碌(n/m) / 版本 | 掉线 30s 内在界面标红 |
| A5 | Run 与主机绑定，不自动漂移；主机离线时 run 排队等待，恢复后继续 | 断线重连后任务继续，不重复执行 |

### B. TODO 与每日计划（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| B1 | TODO 字段：标题、描述、验收标准、指派人、优先级、截止、状态、父任务、标签、产物链接 | — |
| B2 | 状态：待办 / 排队 / 进行中 / 等待输入 / 待验收 / 完成 / 取消 | 状态只能由用户或 Agent 通过接口变更，且留痕 |
| B3 | 每日计划：支持"模板生成 / 手动新建 / 从上一日未完成项滚动"三种来源 | 一键生成当日列表 |
| B4 | 看板：列 = 状态；可切换泳道 = Agent；卡片显示 Agent、已耗时、当前动作、最后一条消息摘要 | 30 张卡不卡顿，状态变化 1s 内反映 |
| B5 | 定时任务：按 cron 生成/滚动每日 TODO，或把某条 TODO 在指定时间重新唤醒 Agent | 到点自动执行，有执行记录 |

### C. 分派（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| C1 | 单播：一条 TODO → 一个 Agent；支持"只指派、暂不开跑" | 指派后可手动开跑 |
| C2 | 广播：一条 TODO → N 个 Agent 并行，各自独立工作目录/worktree；产出并列展示，用户选中一个作为采纳结果 | N 个 run 同时可见、互不串目录 |
| C3 | 队列：每 Agent 并发上限；同一工作目录串行化并显示"等待目录释放"；排队原因可见 | 超并发时排队而非失败 |
| C4 | 依赖：TODO 之间可设 blocking；前置未完成时不开跑 | 前置完成后自动开跑或提示 |

### D. 对话与纠偏（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| D1 | 每条 TODO 一个会话流：消息、工具调用、命令、文件改动、错误 | 可回放历史 run |
| D2 | 运行中注入消息（steer），立即进入当前 run；界面标注"已注入" | 消息出现在 agent 下一步动作之前 |
| D3 | 暂停 / 继续 / 中止 / 重试；重试生成新 run 且保留旧 run 记录 | 旧 run 不被覆盖 |
| D4 | Agent 提问时置为"等待输入"并置顶提醒；用户回答后继续 | 回答后 run 恢复，不会另起新 run |
| D5 | 全局对话：任选 Agent 一对一聊天，不绑定 TODO，可随时"转成 TODO" | 会话可一键提升为 TODO 并保留上下文 |

### E. 进度、回写与通知（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| E1 | 实时状态推送（排队 / 运行 / 等待输入 / 完成 / 失败 / 取消） | 界面与实际一致，无轮询卡顿 |
| E2 | Agent 收尾必须回写：改状态 + 结论评论 + 产物（分支/PR/文件路径/测试结果） | 未回写则视为未完成，界面标黄 |
| E3 | 收件箱：仅在"需要人决策/失败/待验收"时打扰；可标记已读 | 不产生逐条步骤通知 |
| E4 | 审计：谁触发、run 时长、执行的命令、改动文件数、token/成本（若 CLI 有输出） | 可按 TODO / Agent / 日期查询 |

### F. 远程执行（P1）

| 编号 | 需求 | 验收 |
|---|---|---|
| F1 | SSH 主机管理：密钥、端口转发、连接测试 | 一个界面看全部主机状态 |
| F2 | 远端工作目录准备：clone 或 worktree，支持复用已有 checkout | 首次跑自动准备，之后增量同步 |
| F3 | 断线重连后 tmux/会话恢复，run 不中断 | 网络抖动 60s 内可自动恢复 |

### G. 工作区布局（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| G1 | 可拖拽停靠布局：左 = Agent/任务，中 = 域面板区，右 = 会话，下 = 日志 | 布局可命名保存/恢复 |
| G2 | **面板插件契约**：每个面板声明 `id / title / icon / component / state / context 需求 / 可用工具` | 新增一个面板不需要改内核代码 |
| G3 | 多标签 + 分屏 + 未保存保护 | — |
| G4 | 命令面板 + 快捷键（切面板、派活、注入纠正） | 可自定义 |
| G5 | 主题与设计 token 与 YieldMind 平台一致 | 换主题全局生效 |
| G6 | 面板崩溃隔离：单个面板白屏不影响其他面板与主进程 | 可单独重载该面板 |

### H. 数据面板（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| H1 | 数据集接入：本地 CSV/Excel/Parquet、平台查询结果、Agent 产出文件 | 拖入即用 |
| H2 | 表格：虚拟滚动 ≥ 10 万行，列显隐/排序/筛选/格式化 | 10 万行滚动 60fps |
| H3 | 透视表 + 列类型识别 + 列画像（空值/分布/极值） | — |
| H4 | **Workspace 变量区（MATLAB 式）**：当前数据集/结果集清单，点选即成为“活动数据集” | 活动数据集全局唯一、跨面板共享 |
| H5 | 一键「交给 Agent 分析」，携带当前数据集与选区 | 不需用户重复描述数据 |

### I. 绘图面板（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| I1 | **复用 chartkit**（22 类 recipe + 专用组件），渲染契约 `data/hidden/marks/selected/onPick/onHover/onBrush` 不变 | 直接 import，不复制代码 |
| I2 | Figure 概念：一张画布放多图（1×1 / 2×2 / 自由栅格），每图绑一个 recipe | 整张 Figure 可导出 |
| I3 | 联动：`selected/marks/brush` 在图表与 Data 表格间广播 | 点一个 die，所有图与表同步高亮 |
| I4 | 图表配置复用 `recipeSchema` 生成的编辑器，**AI 出图与手动配置同构** | AI 生成的图可继续改轴/颜色 |
| I5 | 导出 PNG(2× 白底) / SVG / CSV / 复制 TSV | 与平台一致 |
| I6 | **Agent 出图返回 recipe + 数据引用**，面板直接渲染并落成 Figure | 不走截图路线 |

### J. HTML / 可视化编辑面板（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| J1 | **复用 spin-grape-html**：GrapesJS 画布 + 图层/样式面板 | 嵌入后可拖拽编辑 |
| J2 | 选中即改：选元素 → 一句话 → Agent 改源文件 → SSE 刷新，保留滚动与选中（沿用其 ui-context 协议） | 端到端 ≤ 3s |
| J3 | 双向：用户在画布的改动写回源文件，Agent 通过文件监听感知 | 不出现脏读/互相覆盖 |
| J4 | 与编排打通：「改这个页面」可成为一条 TODO，可指派、可纠偏、可回写 | 面板内改动有 run 记录 |

### K. 上下文总线（P0，集成价值的来源）

| 编号 | 需求 | 验收 |
|---|---|---|
| K1 | 统一 Context Envelope：`{ dataset, selection, figure, canvasElement, activeFile }`，面板可发布/订阅 | 面板间零批处理同步 |
| K2 | 发给 Agent 的任务**默认携带**相关 Context，且为结构化而非截图 | Agent 知道“我正在看什么” |
| K3 | 用户可钉住/移除 Context，注入内容在消息里**可见** | 不存在隐式注入 |
| K4 | 反向消费：Agent 产出新 dataset / recipe / HTML → 面板自动打开/渲染/刷新 | 不需要用户手动搬运 |

### L. Agent ↔ 面板 接口（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| L1 | 工具/CLI：`context get/set`、`dataset open`、`figure add --recipe`、`canvas select/get` | Agent 可编程操作面板 |
| L2 | 权限：每个 Agent 配置面板写权限白名单（只读上下文 / 可改画布 / 可改数据） | 越权拒绝并有审计 |
| L3 | 结果落点：run 结束时声明产出了哪些 artifact，界面一键打开 | 可追溯到具体 run |

---

## 4. 三条关键流程（必须端到端跑通）

**① 早会（Plan）**
生成今日 TODO → 看板出现卡片 → 逐条指派（或按模板自动指派）→ Agent 排队并开跑。

**② 纠偏（Steer）**
看板发现某卡片"当前动作"不对 → 打开会话 → 直接发一句纠正 → 消息标注已注入 → Agent 调整后继续，TODO 状态不变。

**③ 收工（Close）**
Agent 改状态为"待验收"+ 评论结论与产物 → 收件箱提醒 → 用户采纳/打回 → 打回则自动新起一个 run，重试计数 +1。

---

## 5. 最小数据模型

```
Host      id, name, kind(local|ssh), addr, status, last_heartbeat, version
Agent     id, host_id, name, cli, cwd, max_concurrency, skills[], tool_policy, enabled
Todo      id, title, desc, acceptance, assignee_agent_id, status, priority,
          due_at, parent_id, project_id, result_links[], created_by, updated_at
Run       id, todo_id, agent_id, host_id, status, started_at, ended_at,
          trigger(assign|mention|schedule|retry|broadcast), parent_run_id
Message   id, run_id, role(user|agent|system|tool), content, injected(bool), created_at
Event     id, type, todo_id, run_id, payload, created_at
Plan      id, date, todo_ids[], generator(template|manual|agent)
Dataset   id, name, source(file|platform|agent), schema[], row_count, ref
Figure    id, name, layout, panels[{recipe_id, rect}]
Recipe    id, type, channels{}, options{}      # 完全复用 recipeSchema
CanvasDoc id, source_path, project_id, updated_at
Artifact  id, run_id, kind(dataset|figure|canvas|file), ref
PanelState id, panel_id, workspace_id, state_json
Context   scope(dataset|figure|canvas|selection), payload, pinned(bool)   # 不持久化，作事件
```

---

## 6. 对外接口

**① 给 Agent 用的 CLI（闭环成立的关键，必须有）**

```
todo list --date today --assignee me
todo show <id>
todo claim <id>
todo status <id> waiting|in_progress|in_review|done
todo comment <id> -m "..."
todo ask <id> -m "..."          # 主动置为等待输入并向用户提问
run log <run_id> --tail
artifact link <todo_id> <url>
```

**② 控制台 API**：REST 管对象 + WebSocket 推事件。
**③ 事件**：`todo.created / todo.assigned / run.started / run.message / run.needs_input / run.finished / run.failed / context.changed / artifact.created`。

**④ Context 注入格式**（发给 Agent，统一一个 envelope，沿用 spin-grape-html 的 `<ui-context>` 思路）

```xml
<context>
  <dataset name="YM3D-FT-1103" rows="48210" path="..."/>
  <selection kind="die" keys="[\"W03,D12\",\"W03,D13\"]"/>
  <figure type="pareto" channels="x=Bin,y=Count"/>
  <canvas selector="#hero > .title" tag="h1" text="良率提升方案"/>
</context>
```

---

## 7. 非功能要求

- **并发**：单控制台支持 ≥ 20 个并发 run，≥ 10 台主机。
- **性能**：状态推送端到端 < 1s；看板 100 张卡首屏 < 1s。
- **可靠**：控制台重启后 run 不丢、可恢复；Agent 进程崩溃需标为失败并可重试。
- **安全**：SSH 凭据本地密钥库存储；每 Agent 单独的工具/命令白名单；所有注入与命令可审计。
- **许可**：仅使用 MIT / Apache-2.0 等无"禁止对外提供服务"限制的依赖；不引入带品牌保留条款的 UI 代码。
- **部署**：主形态是**独立桌面安装包**（见第 8 节），控制面与执行器随壳启动，数据落本地 SQLite，不依赖外部数据库、不依赖 Docker。
- **可降级**：同一套代码支持「headless 服务 + 浏览器访问」，用于无 GUI 的服务器或团队共享（P2）。
- **包体**：安装包 ≤ 200MB（Electron + chartkit + GrapesJS + Monaco diff）。
- **性能**：10 万行表格 60fps；同屏 12 张图表 1s 内出图；冷启动到可交互 ≤ 3s。
- **隔离**：域面板崩溃不得拖死主进程；Agent 子进程与 UI 进程隔离。
- **离线**：数据面板与图表在断网时可用（仅平台数据源需网络）。

---

## 8. 分发与打包清单

### 8.1 壳与运行时

| 项 | 规定 |
|---|---|
| 壳 | Electron（一期）；控制面/执行器为普通 Node 服务，壳只做系统集成，便于日后换 Tauri |
| 进程拓扑 | 主进程 = 控制面 + 本地执行器（pty 拉起 agent CLI）；渲染进程 = UI；远程能力走 `ssh2` |
| 数据 | 本地 SQLite（单文件，可备份/迁移）；不上传云端 |
| 首启 | 探测本机已装 Agent CLI（claude/codex/pi/opencode…）→ 一键纳管；未装时给安装与登录引导 |

### 8.2 产物与签名

- 三平台产物：`.dmg`(arm64/x64)、`.exe`、`.AppImage`
- macOS：Developer ID 签名 + notarization（不签客户装不上）
- Windows：EV 证书；一期无证书则接受 SmartScreen 警告并在安装页说明
- 自动更新：`electron-updater` + 自有 update 端点（签名校验安装包）
- 分发渠道：官网直下 + Homebrew Cask；商店渠道推迟
- 与 YieldMind-IDE **版本解耦**，各自 semver，互不阻塞

### 8.3 远程主机代理

- 安装方式：控制台生成一条 `curl … | sh` 命令（含一次性 token），在远端执行后回连上线
- 代理职责仅限于：领取 run、拉起 CLI、回传事件；不承载业务逻辑
- 断线重连 60s 内恢复，run 不重复执行

---

## 9. 验收清单（最小可交付）

1. 本机 3 个 Agent 同时接到 3 条 TODO 并各自完成、各自回写。
2. 远程主机通过 SSH 纳管，跑完一条 TODO，断网 30s 后重连不重复执行。
3. 一条 TODO 广播给 2 个 Agent，产出并列可对比，采纳其一后另一条自动标为"已放弃"。
4. 运行中注入一条纠偏消息，Agent 在下一步动作前收到。
5. Agent 主动提问 → 界面置顶 → 回答后原 run 继续而非新起。
6. 每日定时任务按时生成当日 TODO 列表，看板刷新正确。
7. 三平台安装包可安装、可自动更新；全新机器首启能在 5 分钟内纳管一个本机 Agent 并跑完一条 TODO。
8. 打开一个 10 万行 CSV，表格滚动流畅，选中一片 die 后图表与表格同步高亮。
9. 让 Agent “画出这几个 Bin 的帕累托图”，图表以 recipe 形式落到 Figure，可在配置里继续改轴。
10. 在 HTML 画布选中元素说“标题更大一点”，源文件被最小 diff 修改，画布保留选中并刷新。
11. 会话里能看到本次注入的 Context（数据集/选区/画布元素），可手动钉住或移除。

---

## 10. 分期

| 阶段 | 内容 | 周期 |
|---|---|---|
| M0 | 骨架：Electron 壳 + **停靠布局 + 面板插件契约** + 本地服务 + SQLite；本机 Agent 探测纳管 | 1.5 周 |
| M1 | A3/A4 + B1–B4 + C1/C3 + D1–D3 + E1/E2 —— **编排闭环可跑** | 2 周 |
| M2 | H1–H5 + I1–I5 + chartkit 抽包 + K1/K2 —— **数据与图表可用** | 3 周 |
| M3 | J1–J4 + K3/K4 + L1–L3 —— **HTML 画布与双向打通** | 2.5 周 |
| M4 | A2/A5 + F1–F3 + 看板泳道 + **三平台打包/签名/自动更新** | 2 周 |
| M5 | C2 广播对比 + B5 定时 + D4/D5 + E3/E4 —— **完整闭环** | 2 周 |
| M6 | 多用户、角色权限、工作区隔离、headless 模式（可选） | 按需 |

**合计 ≈ 13 周出内测版**（M0–M3），M4 后即可对外发版。

---

## 11. 与现有 YieldMind-IDE 的关系

- **替换**：单 Agent 助手（`yieldmind.yieldmind-assistant` 的会话面板）不再是主编排入口。
- **不复用**：**VSCodium 不作架构底座**。IDE 的 216–238MB 包体、底座版本绑定、MS 扩展许可限制与本次需求无关，不作为控制台的运行环境。
- **保留（若 IDE 继续存在）**：便携分发思路、Git 同步通道、`/config/product.json` 构建链、客户品牌入口。
- **衔接**：控制台里「打开代码 / 看 Diff」提供两条路径——① 内置只读 Diff 视图；② 调用外部编辑器（`code <path>` 或 YieldMind-IDE）。IDE 从"底座"降为"可选外挂"。
- **迁移**：旧助手会话可作为一条 TODO 的历史消息导入；不做双向同步。
- **组件来源**：`../spin-yieldmind-app/frontend` 从“平台前端”兼任“组件库与数据源”（chartkit / recipeSchema / tableModel），详见第 13 节。
- **HTML 能力来源**：`spin-grape-html` 的 GrapesJS 画布 + Pi 桥接，拆成可嵌入模块。
- **不做**：模型训练与推理服务、代码托管、CI/CD 编排、UI 设计器、多租户 SaaS、一期手机端。

---

## 12. 选型结论（已定，避免反复）

| 决策 | 结论 | 原因 |
|---|---|---|
| 是否基于 VSCodium | 否 | 用户不写代码，编辑器只提供 diff 审阅；代价是 200MB+ 包体与独立升级线 |
| 是否 fork reference | 否 | MIT 但执行层强、控制层零；2.3GB / 4.2 万文件、每日发版，改造成本高于自研 |
| 是否 fork reference | 否 | 控制层最贴合，但许可禁止嵌入对外售卖产品、禁止改品牌 UI，且 SSH 是 daemon 而非直连 |
| 复用方式 | 只借设计与 MIT 依赖 | xterm.js / node-pty / ssh2 / simple-git / Monaco diff；协议层参考其 run 状态机与 Agent CLI 回写机制，不复制受限代码 |
| 形态 | 独立 Electron 发包 | 与 IDE 解耦、升级独立、客户无需装环境；一期不含手机端与 relay |
| 宿主 | 自研 Electron + 停靠布局（dockview / golden-layout） | 域面板需共享 Context 与选区联动；VSCodium 的 webview 各为 iframe，状态同步与性能代价高，且无法掌控内核 |
| 面板架构 | 插件化 (Panel 契约) | 防止域面板持续膨胀把核心吃掉；后续加面板不改内核 |
| 不做代码编辑器 | 只做只读 Diff + 外部打开 | 避免重走 VSCodium 的老路；用户不写代码 |

---

## 13. 复用与改造清单

> 路径均相对本仓根目录，外部仓以 `../` 开头。

| 资产 | 位置 | 复用方式 | 改造量 |
|---|---|---|---|
| **chartkit**（53 文件 / 744KB，22 recipe + 专用图） | `../spin-yieldmind-app/frontend/src/components/chartkit` | 抽成独立包 `@yieldmind/chartkit`，直接 import | 3–5 天：解开 `../../utils/csv` 与 api 依赖（`PivotTable` / `ChartRecipeEditor` 两处）、theme 参数化、补 peerDeps |
| recipeSchema / recipe / colorScale | 同上 | 随包复用，保证 AI 出图与手动配置同构 | 无（注意后端 AI 白名单 `_RECIPE_TYPES` 需同步） |
| DataTable / PivotTable / tableModel / tableExpr | 同上 | 随包复用 | 随 chartkit 一并解耦 |
| DataFinder / filters / store | 同上 | **不复用**（耦合平台 API） | 用 `DatasetProvider` 适配器重写：`localFile` / `platformApi` |
| **spin-grape-html**（Express + GrapesJS + Pi RPC + SSE） | `../spin-grape-html/` | 拆两半：前端画布+桥接嵌入渲染进程；server 只留 watcher/SSE 或并入本地服务 | 5 天：去 Express 依赖、抽出 `ui-context` 协议为公共模块、接 K 总线 |
| Pi 会话/RPC 封装 | `spin-grape-html/server` + pi CLI | 复用思路，不直接复用代码 | 执行器统一走 §6 的 run 模型 |
| 平台 API（FastAPI / ClickHouse） | `../spin-yieldmind-app/backend` | 仅走 HTTP 适配器 | 不 import 后端代码 |
| VSCodium 底座 / 旧单 Agent 助手面板 | `../spin-yieldmind-ide` | **不复用** | — |

---

## 14. 待定

- D2 的运行中注入依赖各 CLI 能力（Claude Code / Codex 支持较好，其余降级为"排队到下轮"），降级方案需产品确认。
- C2 广播的产物对比是否需要自动 diff 摘要（当前定为人工对比）。
- 是否需要把 reference / reference 作为对照验证基线（只用于对齐交互，不复用其受限代码）。
- 范围风险：G–L 六模块是新范围，须按 M0–M3 的窄切片交付；任何新面板需求一律走「Panel 插件」路径，不改内核。
