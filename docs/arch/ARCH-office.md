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
  warroom-scene.ts       发射指挥 three.js 场景（房间 / 发射大屏 / 阶梯控制台 / 警示灯 / 3D 人员 / 姓名牌投影）
  WarRoom3D.tsx          发射指挥 3D 的 React 外壳（只把 OfficeModel 推进命令式场景）
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
- **发射指挥 3D**（`prefs.template=warroom`，模板名「发射指挥」）：照真实航天发射指挥大厅做。**阶梯控制台**三排（前排落地、后两排各抬 0.34，台沿有灯带），台面统一朝前方大屏，一排 8 台显示器（RUN / QUEUE / REVIEW 三种底图轮换）；前墙正中的大屏是发射画面，两侧各挂一块 TELEMETRY / TRACK 辅助屏。
- **谁在哪**：`desk` 坐后排工位（席位号从离镜头最近的一排往前排，模型固定 6 席，先坐满近处的那排）、`lead` 坐前排正中的指挥席（面朝大屏）、`review / approval` 站到前墙两侧的复盘墙与发射许可闸门、`meeting` 站在大屏正前方、`tea / standby` 站到两侧过道。同一个工位有多人时左右错开，不叠成一个人。姓名牌是投影定位的 DOM 按钮，点开仍是同一个 Inspector；角色颜色跟随 `tone`。动效档位 / 走位时长 / reduced-motion 都生效；光照跟随应用主题，所以这一台不显示「光照」tab。
- **人**：`createActor` 按真人比例（身高 ~1.70，个体有 ±2.5% 身高差与三种发色）搭骨架——髋 / 膝 / 肩 / 肘四个关节，关节处补球避免断缝；躯干用 `LatheGeometry` 做胸腰轮廓再压成椭圆截面，肩用三角肌球撑线，四肢是锥形；头有颅骨 + 下颌 + 鼻 + 耳 + 眼 + 头发（顶部一层 + 后脑一片，留出发际线），头戴耳机（头梁 + 耳罩 + 耳垫 + 通话杆）+ 工牌 + 工装口袋；鞋分鞋底 / 鞋面 / 圆鞋头。站姿与坐姿共用同一套骨架（坐姿髋落到椅面、大腿前伸、小臂水平前伸搭在台面上）。`tone` 落在肩章、袖标、工牌和耳罩环上，远处也能认状态。
- **发射大屏**（`drawHUD`，一块 2048×768 常驻 canvas，不每帧重建）：左列是**发射检查单**（`model.board.rows` 的 4 步），中间是**发射工位实时画面**（夜空 / 塔架 / 四盏探照灯 / 火箭 / 尾焰 / 地面烟雾，全是 2D canvas 现画，不引入贴图），右边是 **GO / NO-GO 系统状态**：PROP 推进 ← 运行中、GUID 制导 ← board 进度、TELM 遥测 ← 失败数、GATE 发射许可 ← 待确认 / approval、COMM 通讯 ← 运行中的终端；底部是发射时序与下一步。倒计时压在画面底部。
- **机位**：`prefs.view` 里存四个预设——总览（整间大厅）/ 大屏（贴住发射画面）/ 长桌（左前方看长桌）/ 工位（右前方看席位与闸门）。舞台上按住画布拖动是绕当前预设 `look` 点做球面环绕，双击回总览；舞台头下拉与场景配置「呈现 → 舞台机位」写的是同一个字段。航母和这一台共用 `prefs.view`，各自的机位表在 `SceneConfigPanel` 的 `CARRIER_VIEWS` / `WARROOM_VIEWS`，换模板后不属于该舞台的旧机位落回总览。
- **发射演示**（舞台头「演一遍发射」）：`T-4` 起终端倒计时（警示灯同步闪红），`T-0` 点火——画面里的火箭带尾焰爬升、地面腾起烟雾，同时大屏方向打一束暖光扫过桌面（`launchLight`），升空后淡出复位。整段只改画面，不写 State，也不改任何流程判定；动效关闭 / reduced-motion 时不可用。
- **航母 3D**：`prefs.template=carrier` 时换成福建舰甲板。弹射位 = 并发 `run`，着舰道 = `review / approval` 串行，失败 = 复飞，待命 = 升降机 / 停机区，主控 = 甲板弹射官（甲板地勤形象：作训服 + 岗位色马甲 + 防护头盔）。舰载机、姓名牌和引线都由真实角色投影；点姓名牌打开同一个 Inspector。海面 / 天空 / 舰体 / 舰载机的几何与材质移植自 `docs/prototype/carrier-3d.js`，不新增状态字段。
- **弹射流程**：行程长度按弹射位到甲板边缘的射线求交算出（`deckRun`），所以三种弹射位都从甲板边缘离舰。`run` 开始时播放「张紧 → 行程加速 → 离舰」，离舰后持续加速、拉起、带坡度转向飞走（起落架收起、机腹 AO 关闭）。镜头：总览 → 舷侧低机位贴住弹射位 → 机位钉在舰首外侧看它拉起飞远（不追着飞机跑，航母留在画面里）→ 回总览。动效关闭 / reduced-motion 时不放弹射；舞台头「演一遍弹射」可手动触发。
- **机位**：5 个预设机位（总览 / 舰首 / 舰岛 / 着舰道 / 俯视）写在场景 prefs 的 `view` 上（跟着场景存库，重开还是这个机位），舞台头「视角」下拉与场景配置 → 呈现 → 舞台机位是同一份值；切换是按球坐标插值飞到新机位，不硬切。在画布上按住拖动绕预设看点环绕（左右改方位、上下改俯仰，俯仰有上下限），点姓名牌不抢拖动事件；双击回总览并复位拖动角度。弹射 / 着舰期间镜头由 `cine` 接管，结束后回到当前预设机位。
- **着舰流程**：飞出去 6.4s 后不瞬移归位，而是从舰艉后方 46 单位、11 单位高对正下滑道进场（`T_APPROACH` 2.4s，末段拉平），接地瞬间生成拦阻蒸汽、1.5s 内刹停（滑跑 8.5 单位），停稳后交回普通走位滑回自己的机位。`review` 状态变化时也会触发一次着舰，对应「着舰道 = review / approval 串行」。镜头跟在下滑道后上方，看它压向甲板、咬住拦阻索、停稳。舞台头「演一遍着舰」可手动触发。
- **拖船（护航舰）**：左右两条远景舰（驱逐舰 101 / 补给舰 886）都是同一套尺度线（龙骨 / 甲板 / 舰首楔形）推出来的，舰首是接直舷段截面的五面楔形，窗户 / 相控阵 / 舱门贴在各自真实外皮上，吊机吊臂越过货柜而不是穿过它。

## 5. 场景 / 配置的当前边界

- 场景名、阵容、座位、呈现开关落 `coordination_scenes` 表（`electron/db.mjs` + `coordinationSceneSave` / `coordinationSceneRemove`）。**场景是全局列表**：它描述「多个机器人怎么协作」，不属于某个项目，不按当前项目过滤；`project_id` 只作「建议项目」标注（卡片上的来源）。
- **阵容按机器人存**：渲染层写 `botId`，老数据只有执行体 `agentId`（读时用 `bots.executor_agent_id` 反查）。`normalizeCoordinationCast` 必须两种都认——只认 `agentId` 会把 UI 保存的阵容整份丢掉（2026-11-22 已修）。
- 场景库卡片就地管理：双击标题或 `⋯ → 重命名`（Enter 提交 / Esc 取消）、`复制一份`（同模板同阵容的新场景）、`复制为 JSON`（剪贴板导出）、`删除`（先在本卡底部二次确认）；场景可以删到零，删除最后一台后回到空态。全部复用 `coordinationSceneSave` / `coordinationSceneRemove`，不新增 IPC。
- 卡片上方可搜索（场景名 / 舞台模板 / 阵容成员）、按模板筛选、按最近更新 / 最近创建 / 名称排序；卡片只显示自己的「更新于」和非默认配置标记，全局运行统计留在页头摘要里，避免每张卡重复同一组数字。
- 配置里的评审门 / 失败升级 / 角色提示注入目前是「默认值」，不改变现有调度；接入 Mission 派活时再消费。
- 舞台模板：办公室（2.5D）、作战室（three.js 3D）、航母（three.js 3D）均可用。流水线（factory）已下线，旧值按 carrier 呈现并写回。

## 6. 边界 / 后续

- 空项目进入场景页显示空态（不再自动创建办公室场景），由用户从模板新建。
- 场景名、阵容、座位、呈现开关存 `coordination_scenes`（全局；`project_id` 仅作建议项目）；迁移参考 `docs/migrations/002-coordination-scenes.sql`。
- 阵容里的执行体按机器人全局解析：机器人只借「身体」，当前在哪个项目不影响上台；未绑执行体的座位显示「待绑定」。
- 舞台取运行态的项目 = 场景的「建议项目」；老场景没标注时跟随当前项目。所以在任何项目下打开同一台场景，看到的是同一批运行态。
- 会议角在 Mission `plan_review` 时由主控走过去；成员座位仍来自 Mission 子任务的真实 Owner。
- 作战室 3D 来自 `docs/prototype/warroom-3d.html`，航母 3D 来自 `docs/prototype/carrier-3d.js`，分别在 `src/office/warroom-scene.ts` / `carrier-scene.ts` 里接上真实 OfficeModel。
- 不复制 marvis-office 的美术资产；只沿用「空间化状态 + 角色动作」的表达方式。
