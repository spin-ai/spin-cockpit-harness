# 场景与办公室

> 场景是**真实运行状态的空间化投影**，不是独立调度器，也不是演示动画。它只回答一个问题：现在谁在干什么、卡在哪。

![办公室实况](./wiki/cover-office.png)

*图：实况页：舞台按 run / todo 的真实 zone 定位，右侧是 Inspector，底部是时间轴。*

## 一句话与边界

- 数据全部来自现有 `State`：`agents / runs / todos / approvals / terminals / delegations / missionPlans / events`。
- **不新建表、不改主进程、不伪造任务**：没有数据的位置就保持空闲。
- 舞台只负责呈现；点开 Agent 才出现操作（打开任务 / 会话 / 终端、停止、重试、审批）。

## 三套舞台模板

| 模板 | 表现 | 对应什么 |
|---|---|---|
| **办公室** `office` | 2.5D 1340×540 场景：工位、审批台、验收架、机房、茶歇、协调台 | 默认视图；一位 Agent 一张工位 |
| **作战室** `warroom` | three.js 3D：透视房间、视频墙 + 地球、长桌、复盘墙、发布闸门 | `desk / lead` 入席，`review` 去复盘墙，`approval` 去闸门 |
| **航母** `carrier` | three.js 3D：飞行甲板、电磁弹射位、着舰道、升降机 | 弹射位 = 并发 run，着舰道 = 串行 review / approval，失败 = 复飞 |

模板文案收在 `src/office/templates.ts`；旧的 `factory` 场景读成 `carrier`，保存时写回。
3D 场景按需加载，光照跟随应用主题，动效档位与 `reduced-motion` 同样生效。

## 状态映射

区域不新造字段，只表达已有状态：

| 区域 | 对应状态 |
|---|---|
| 工位区 | 有 active run / todo；显示任务号与运行时长 |
| 主管位 + 白板 | `agent.role = supervisor` 或 Mission 进行中 |
| 审批台 | `approval` 或 `run.waiting_input`；琥珀灯 + 待确认计数 |
| 验收架 | `todo.status = in_review` |
| 机房 | 项目内运行中的 terminal |
| 茶歇 | 没有 active run 的 idle Agent |
| 会议 / 协调台 | Mission `planning / plan_review / running / waiting_children` |

同一个角色只能在一个位置，优先级：

```text
approval / waiting_input
  > failed
  > in_review
  > supervisor
  > running
  > queued
  > idle
```

## 页面结构

```text
场景
├─ 场景库      搜索 / 模板筛选 / 排序；卡片改名、复制、导出 JSON、删除
├─ 实况        舞台 + 时间轴 + Inspector 抽屉
├─ 光照        四个时段并排对照，点卡片切回实况并固定时段（仅办公室）
└─ 执行配置    项目列表 + worktree 策略 + 引用
```

- 舞台在格子里等比缩放并居中（`zoom`，`k = min(w/1340, h/540)`），字号不发虚。
- Inspector 是覆盖在舞台上的右侧抽屉，打开时不挤压、不裁切舞台。
- 时间轴记录本次打开后最近 15 分钟的真实状态变化（`zone / tone / pose / status`），可拖动、回放、只看走位。
- 场景库删除在卡片底部二次确认，每个项目至少保留一个场景；删掉当前场景自动回落到第一个。

## 动效与可读性

- 三档动效：`克制 / 完整 / 关闭`，连同走位时长、姿态幅度、打字速度一起存 `config.prefs.motion`。
- 检查器把状态逐个翻译成舞台结果：触发条件 → 区域 → 姿态 → 动效；关闭动效后给出等价检查。
- 姓名牌是投影定位的 DOM 按钮，不只是装饰——键盘可聚焦，点开就是同一个 Inspector。
- 夜间只提升灯光，不改变内容对比度；非当前 pane 不整体降透明度。

## 明确未做

- 协作场景里的**评审门 / 失败升级 / 角色提示注入**目前只是配置默认值，还没有被派活链路消费。
- 3D 舞台只承担呈现与判断，不反过来驱动调度；派活、并发、审批仍走原有链路。

## 继续阅读

- [Super Agent / Mission](#/wiki/super-agent)：Mission、Plan、Delegation 怎么产生这些状态。
- [工作流](#/wiki/workflow)：任务生命周期与 run 状态机。
- [架构](#/wiki/architecture)：Renderer 只读状态、Main 持有唯一可变状态。
