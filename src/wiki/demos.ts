import type { WikiDemoStep } from "../components/WikiFlowDemo";

export type WikiDemo = { eyebrow?: string; title: string; steps: WikiDemoStep[] };

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
};
