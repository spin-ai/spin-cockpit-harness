import type { WikiDemoStep } from "../components/WikiFlowDemo";

type WikiDemo = { eyebrow?: string; title: string; steps: WikiDemoStep[] };

export const WIKI_DEMOS: Record<string, WikiDemo> = {
  home: {
    eyebrow: "PLAYGROUND",
    title: "一条任务的旅程",
    steps: [
      { key: "send", label: "派活", title: "Chat 说一句话", detail: "普通消息默认交给当前 Agent；@别名 / 元素上下文用来指定目标。", tone: "idle" },
      { key: "todo", label: "建任务", title: "TODO + queued run", detail: "消息先落库，再创建任务并排队；失败时原话仍在，不会出现孤儿任务。", tone: "queued" },
      { key: "queue", label: "排队", title: "等一个可用的执行槽", detail: "受全局并发、主机并发、Agent 并发和同 cwd 串行约束；排队原因可见。", tone: "queued" },
      { key: "worktree", label: "隔离", title: "git worktree", detail: "cwd 是 git 仓库时，每个 run 独立 worktree + 分支，并行不互相污染。", tone: "running" },
      { key: "acp", label: "执行", title: "dsh --profile acp", detail: "initialize → session/new → configure → prompt；每个 run 一个 ACP client。", tone: "running" },
      { key: "stream", label: "流式", title: "session/update 写回 Chat", detail: "agent_message / thought / tool_call 逐条落库，按 run 分组展示。", tone: "running" },
      { key: "steer", label: "纠偏", title: "运行中继续说话", detail: "先落 pending，送达后变 injected；失败显示「投递失败 · 重发」。", tone: "steer" },
      { key: "review", label: "待确认", title: "run 结束 → in_review", detail: "完成只代表 Agent 停下来了；任务进入待确认，并出现在「待处理」筛选里。", tone: "review" },
      { key: "done", label: "已确认", title: "人点确认后才 done", detail: "确认是状态，不是另一份数据；之后的消息只记录，不再起 run。", tone: "done" },
    ],
  },
  workflow: {
    eyebrow: "STATE MACHINE",
    title: "任务生命周期",
    steps: [
      { key: "todo", label: "待执行", title: "todo", detail: "任务已创建，还没有 run；可以在 TODO 行内派活或编辑。", tone: "idle" },
      { key: "queued", label: "排队", title: "queued", detail: "run 已创建，等待并发 / 主机 / cwd 约束放行。", tone: "queued" },
      { key: "running", label: "运行中", title: "running", detail: "ACP client 已启动；消息可以 steer，工具调用会实时落库。", tone: "running" },
      { key: "waiting", label: "等待输入", title: "waiting_input", detail: "ACP 审批或等待回答；不计入完成，也不会自动通过。", tone: "steer" },
      { key: "review", label: "待确认", title: "in_review", detail: "run 完成或失败后回到人手里；失败可重试，产物按 run 保留。", tone: "review" },
      { key: "done", label: "已确认", title: "done", detail: "人确认后的终态；取消的任务回到 todo，可再次派活。", tone: "done" },
    ],
  },
  "super-agent": {
    eyebrow: "MISSION",
    title: "从目标到确认",
    steps: [
      { key: "goal", label: "目标", title: "人给出一个 Mission", detail: "Mission 复用 Todo，但有自己的 mission_state；不新增一套看板。", tone: "idle" },
      { key: "plan", label: "计划", title: "Supervisor 提交 Plan", detail: "Plan 按 revision 保存，包含 steps / brief / acceptance；未批准不能派活。", tone: "review" },
      { key: "approve", label: "审批", title: "人只做三个动作", detail: "批准、编辑、退回。批准后计划才成为可执行的合同。", tone: "queued" },
      { key: "delegate", label: "委派", title: "task_delegate", detail: "创建 child Todo + Delegation + worker run；只能派给 worker，不派给自己。", tone: "running" },
      { key: "worker", label: "子任务", title: "worker 在独立 worktree 执行", detail: "复用普通 run 的 worktree / 审批 / 纠偏链路，子任务仍可单独暂停或重试。", tone: "running" },
      { key: "event", label: "回灌", title: "Delegation 事件", detail: "child run 结束 → Main 更新 delegation → 给 supervisor 发紧凑事件，不轮询。", tone: "steer" },
      { key: "summary", label: "汇总", title: "mission_finish", detail: "主管提交总结和 artifacts；有未结束子任务时拒绝，只能进入 in_review。", tone: "review" },
      { key: "confirm", label: "确认", title: "人确认 Mission 完成", detail: "Agent 可以建议「做完了」，但不能替人宣布「验收通过」。", tone: "done" },
    ],
  },
  office: {
    eyebrow: "OFFICE · PROJECTION",
    title: "状态怎么落到舞台上",
    steps: [
      { key: "state", label: "读状态", title: "只读现有 State", detail: "agents / runs / todos / approvals / terminals / delegations；不新建表，也不伪造任务。", tone: "idle" },
      { key: "model", label: "投影", title: "State → OfficeModel", detail: "纯函数算出区域、姿态、tone 与走位；没有数据的位置保持空闲。", tone: "idle" },
      { key: "zone", label: "分区", title: "按优先级落位", detail: "审批 / 等待输入 > 失败 > 待验收 > 主管 > 运行中 > 排队 > 空闲。", tone: "review" },
      { key: "stage", label: "舞台", title: "三套模板共用一份模型", detail: "办公室 2.5D 是默认；作战室与航母是 three.js 3D，按需加载。", tone: "running" },
      { key: "inspect", label: "点开", title: "Inspector 才提供操作", detail: "状态 → 区域 → 姿态 → 动效；打开任务 / 会话 / 终端、停止、重试、审批。", tone: "steer" },
      { key: "motion", label: "动效", title: "克制 / 完整 / 关闭", detail: "走位时长、姿态幅度、打字速度存 config.prefs.motion，reduced-motion 同样生效。", tone: "done" },
    ],
  },
  memory: {
    eyebrow: "MEMORY · DREAM",
    title: "记忆怎么流动",
    steps: [
      { key: "l1", label: "L1", title: "L1 会话不可变", detail: "消息、run、事件由系统落库，建 bigram 索引；Agent 只能读。", tone: "idle" },
      { key: "l2", label: "L2", title: "L2 note 允许写错", detail: "必须带来源，一条 ≤ 400 字符；同一句话只存一行，重复写只抬置信度。", tone: "queued" },
      { key: "l3", label: "L3", title: "L3 知识可审核", detail: "资料只读、页面可写；Agent 只能写 draft。", tone: "running" },
      { key: "dream", label: "Dream", title: "Dream 只出建议", detail: "换说法的重复 / 已不成立 / 缺来源 / 该晋升，进建议队列，不直接改写。", tone: "review" },
      { key: "l4", label: "L4", title: "L4 打分填预算", detail: "置顶 + 有来源 + 层级 + 近两周 + 被用过的 log，按节配额贪心填，≤12k 字符。", tone: "steer" },
      { key: "log", label: "台账", title: "inject_log 回填命中", detail: "记下每次注入了什么、有没有被回答用到；归因目前只到标题片段匹配。", tone: "done" },
    ],
  },
};
