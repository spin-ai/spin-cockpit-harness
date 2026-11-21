> 层：架构 · 状态：部分落地 · 核对：2026-11-14 · 覆盖：办公室舞台的状态映射 / 交互 / 协作场景边界

# 办公室（Agent Office）

入口：Rail → 场景 → 实况。  
相关：[`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md)、[`ARCH-multi-agent-workspace.md`](ARCH-multi-agent-workspace.md)、[`ARCH-super-agent.md`](ARCH-super-agent.md)

**未做**：协作场景里的评审门 / 失败升级 / 角色提示注入目前只是默认值，还没有被派活链路消费。作战室与航母均已接入 three.js 3D 舞台。

## 1. 定位

办公室是 **真实运行状态的空间化投影**，不是独立调度器，也不是演示动画。

- 数据来自现有 `State`：`agents / runs / todos / approvals / terminals / delegations / missionPlans / events`。
- 不新建表、不改主进程、不伪造任务。
- 工位、审批台、验收架、机房、茶歇、会议角只表达已有状态；没有数据就保持空闲。
- 场景只负责呈现；点击 Agent 的详情抽屉才提供操作（打开任务 / 会话 / 终端 / 停止 / 重试 / 审批）。

## 2. 区域与状态映射

| 区域 | 对应状态 | 呈现 |
|---|---|---|
| 工位区 | 有 active run / todo | 显示器、任务号、运行持续时间 |
| 主管位 + 白板 | `agent.role=supervisor` / Mission | 计划步骤、进度、协调中 |
| 审批台 | `approval` 或 `run.waiting_input` | 琥珀灯、待确认计数 |
| 验收架 | `todo.status=in_review` | 紫色状态点、待验收任务 |
| 机房 | 项目内运行中的 terminal | 机柜 LED、终端数 |
| 茶歇 · 休息 | 无 active run 的 idle Agent | 沙发、咖啡机、空闲标签 |
| 会议 / 协作角 | Mission `planning / plan_review / running / waiting_children` | 小圆桌、指示灯 |

优先级：

```
approval / waiting_input
  > failed
  > in_review
  > supervisor
  > running
  > queued
  > idle
```

## 3. 代码结构

页面结构：

```
场景
├─ 场景库
├─ 实况（办公室 2.5D / 作战室 3D / 航母 3D + 时间轴 + Inspector / 配置抽屉）
├─ 光照（仅办公室：四个时段并排对照，点卡片切回实况并固定时段）
└─ 执行配置（ExecutionConfigTab）
```

```text
src/components/
  SceneWorkspace.tsx     场景页：场景库 / 实况 / 光照 / 执行配置 + 动效档位 / 回放入口
  SceneGallery.tsx       场景库（搜索 / 模板筛选 / 排序 / 卡片重命名 / 复制 / 导出 / 删除 / 新建）
  OfficeLive.tsx         实况舞台 + 时间轴 + Inspector / 配置抽屉
  ExecutionConfigTab.tsx 执行配置（项目列表 + 编辑器 + 引用）
src/office/
  model.ts               State → OfficeModel（纯函数，无 React）
  motion.ts              区域 / 姿态 / 触发 / reduced-motion 检查规则
  RobotArt.tsx           舞台和抽屉共用的机器人 SVG
  OfficeStage.tsx        办公室 1340×540 舞台、区域、工位、actor 位置、走位路径
  warroom-scene.ts       作战室 three.js 场景（房间 / 主屏 / 地球 / 长桌 / 3D 角色 / 姓名牌投影）
  WarRoom3D.tsx          作战室 3D 的 React 外壳（只把 OfficeModel 推进命令式场景）
  carrier-scene.ts       航母 three.js 场景（舰体 / 甲板 / 舰载机 / 海面 / 夕阳 / 姓名牌投影）
  Carrier3D.tsx          航母 3D 的 React 外壳
  OfficeInspector.tsx    动效检查器抽屉（状态→舞台 / 走位 / a11y / 参数 / 真实操作）
  SceneConfigPanel.tsx   场景配置抽屉（阵容 / 编排 / 呈现）
  workbench.css          舞台样式（作用域 .offp）
  office.css             场景页 / 配置面板样式（off- 前缀）
```

## 4. 交互与动效

- 舞台在 `.stage-area` 里等比缩放并居中（`k = min(w/1340, h/540)`，`zoom` 而不是 `transform`）；Inspector 是覆盖在舞台上的右侧抽屉，默认收起，打开时不挤压舞台。
- 点击 Agent / 白板 / 审批台 / 验收架 → 打开检查器；`详情` 在没有选中角色时打开总览（状态变化 / 走位 / 风险统计）。
- 动效三档：`克制 / 完整 / 关闭`，连同走位时长 / 姿态幅度 / 打字存 `config.prefs.motion`，检查器里即时生效。
- 状态变化导致 `zone / tone / pose / statusLabel` 改变时，actor 用 CSS `left/top` 按 `--walk-dur` 过渡走位；失败 / 重试 / 计划批注只改姿态，不走位。
- 时间轴是最近 15 分钟的只读快照环（内存）：可拖动、回放、只看走位；点记录定位到那一刻，抽屉里可反查触发条件。
- 首次进入直接定位，不在加载时表演；`prefers-reduced-motion`、`模拟 reduced-motion` 与 `动效=关闭` 都不走位。
- Mission `plan_review` 时主控从经理室走到会议室，会议室标签变「会议中」；`dawn / day / dusk / night` 只改舞台光照，手动覆盖存 `config.prefs.light`（含 `dawn`）。
- **时段光照**：舞台按本地时间分 `dawn / day / dusk / night`，只改变舞台的地面、墙面和灯具，不影响页面其它区域；黄昏与夜间点亮顶灯、台灯、落地灯，窗外换星空 / 月亮 / 城市亮灯。手动覆盖存 `config.prefs.light`（`auto | dawn | day | dusk | night`），默认 `auto`。
- **区域划分**：工位区 / 主控区 / 审批台 / 验收架 / 机房 / 茶歇区 / 协调台各有低透明地面色块与标牌；色块放在 `z-index:1`，永远在工位、角色之下，不遮挡交互。
- **作战室 3D**：`prefs.template=warroom` 时舞台换成 three.js 房间。长桌席位 = `desk / lead`，复盘墙 = `review`，发布闸门 = `approval`，主屏 = `meeting`，两侧 = `tea / standby`；姓名牌是投影定位的 DOM 按钮，点开仍是同一个 Inspector。主屏 HUD 用 `model.board / stats` 现画，角色颜色跟随 `tone`。动效档位 / 走位时长 / reduced-motion 都生效；光照跟随应用主题，所以作战室不显示「光照」tab。
- **航母 3D**：`prefs.template=carrier` 时换成福建舰甲板。弹射位 = 并发 `run`，着舰道 = `review / approval` 串行，失败 = 复飞，待命 = 升降机 / 停机区，主控 = 甲板弹射官。舰载机、姓名牌和引线都由真实角色投影；点姓名牌打开同一个 Inspector。海面 / 天空 / 舰体 / 舰载机的几何与材质移植自 `docs/prototype/carrier-3d.js`，不新增状态字段。`run` 开始时播放「张紧 → 弹射 → 爬升」（JBD / 尾焰 / 蒸汽 / 镜头震动），起飞后保持空中待命，状态变化时降落到对应甲板位；舞台头「演一遍弹射」可手动触发。

## 5. 场景 / 配置的当前边界

- 场景名、阵容、座位、呈现开关落 `coordination_scenes` 表（`electron/db.mjs` + `coordinationSceneSave` / `coordinationSceneRemove`）；一个项目可以有多个场景。
- 场景库卡片就地管理：双击标题或 `⋯ → 重命名`（Enter 提交 / Esc 取消）、`复制一份`（同模板同阵容的新场景）、`复制为 JSON`（剪贴板导出）、`删除`（先在本卡底部二次确认）；每个项目至少保留一个场景。全部复用 `coordinationSceneSave` / `coordinationSceneRemove`，不新增 IPC。
- 卡片上方可搜索（场景名 / 舞台模板 / 阵容成员）、按模板筛选、按最近更新 / 最近创建 / 名称排序；卡片只显示自己的「更新于」和非默认配置标记，全局运行统计留在页头摘要里，避免每张卡重复同一组数字。
- 配置里的评审门 / 失败升级 / 角色提示注入目前是「默认值」，不改变现有调度；接入 Mission 派活时再消费。
- 舞台模板：办公室（2.5D）、作战室（three.js 3D）、航母（three.js 3D）均可用。流水线（factory）已下线，旧值按 carrier 呈现并写回。

## 6. 边界 / 后续

- 新项目首次进入场景页会自动创建一个办公室场景；之后可在场景库新建多个。
- 场景名、阵容、座位、呈现开关存 `coordination_scenes`（按项目过滤；一项目多场景）；迁移参考 `docs/migrations/002-coordination-scenes.sql`。
- 会议角在 Mission `plan_review` 时由主控走过去；成员座位仍来自 Mission 子任务的真实 Owner。
- 作战室 3D 来自 `docs/prototype/warroom-3d.html`，航母 3D 来自 `docs/prototype/carrier-3d.js`，分别在 `src/office/warroom-scene.ts` / `carrier-scene.ts` 里接上真实 OfficeModel。
- 不复制 marvis-office 的美术资产；只沿用「空间化状态 + 角色动作」的表达方式。
