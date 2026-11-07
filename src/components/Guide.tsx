import type { State } from "../types";
import { PageHeader } from "./PageHeader";

type Act = (type: string, payload?: unknown) => Promise<any>;

const SECTION_CARDS = [
  {
    title: "1. 先准备 Agent",
    body: "在 Chat 底部点「＋ dsh」纳管一个 worker；再点「＋ 主管」创建一个 supervisor。主管负责计划和分派，worker 负责执行。",
  },
  {
    title: "2. 新建 Mission",
    body: "点「新任务」建一个空会话，在底部 Agent 选择器里选「✦ 主管」，然后直接描述目标。不要用主管做普通单任务。",
  },
  {
    title: "3. 审批计划",
    body: "主管会先提交 Plan Card，不会立刻改代码。检查步骤、负责人、依赖和风险；可以退回修改，确认后点「批准并分派」。",
  },
  {
    title: "4. 看子任务执行",
    body: "批准后系统会创建 child Todo + worker run；有 git 仓库时每个 child 使用独立 worktree。Mission 面板和 TODO LIST 都会显示进度。",
  },
  {
    title: "5. 审阅与确认",
    body: "子任务结束后主管汇总，Mission 进入「待确认」。打开子任务会话看细节，必要时要求返工/重试；最后点「确认完成」。",
  },
  {
    title: "6. 中断与恢复",
    body: "停止、取消或应用重启后，Mission 会变成「已中断」。在 Mission 面板点「恢复 Mission」，主管会重新接入剩余子任务。",
  },
];

export function Guide({ state, act, onStartMission, onOpenSettings }: {
  state: State;
  act: Act;
  onStartMission: () => void;
  onOpenSettings: () => void;
}) {
  const supervisors = state.agents.filter((a) => a.role === "supervisor");
  const workers = state.agents.filter((a) => (a.role || "worker") !== "supervisor" && a.chatRunnable !== false);
  return (
    <div className="guide-page">
      <PageHeader
        kicker="COCKPIT HARNESS · 使用说明"
        title="Super Agent 怎么用"
        subtitle="一句话目标 → 主管拆解 → 人工批准 → worker 在独立 worktree 执行 → 主管汇总 → 你确认。"
        actions={<div className="guide-actions">
          <button className="btn primary" onClick={onStartMission}>新建 Mission</button>
          <button className="btn" onClick={onOpenSettings}>打开设置</button>
        </div>}
      />

      <div className="guide-status">
        <div><b>{workers.length}</b><span>可用 worker</span></div>
        <div><b>{supervisors.length}</b><span>Supervisor</span></div>
        <div><b>{state.settings?.superAgentEnabled === false ? "关闭" : "开启"}</b><span>Mission 模式</span></div>
        <div><b>{state.settings?.maxMissionChildren ?? 4}</b><span>子任务上限</span></div>
      </div>

      <div className="guide-grid">
        {SECTION_CARDS.map((card) => (
          <section className="guide-card" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.body}</p>
          </section>
        ))}
      </div>

      <section className="guide-card guide-wide">
        <h2>界面在哪</h2>
        <div className="guide-table">
          {[
            ["Chat", "选主管、描述目标、看 Plan Card 和对话；普通任务选 worker。"],
            ["Mission 面板", "Chat 顶部：Mission 状态、计划、子任务卡、确认/取消/恢复。"],
            ["TODO LIST", "✦ Mission 是父任务，子任务缩进显示；两边状态同步。"],
            ["设置 → 执行", "Supervisor 并发、Mission 子任务上限、时长预算、Agent 角色和 instructions。"],
            ["收件箱", "Mission 完成后只有一条「Mission 待确认」，不会每个子任务刷一条。"],
          ].map(([label, text]) => (
            <div className="guide-row" key={label}><b>{label}</b><span>{text}</span></div>
          ))}
        </div>
      </section>

      <section className="guide-card guide-wide">
        <h2>常见问题</h2>
        <details>
          <summary>点「＋ 主管」后发送，为什么没有计划？</summary>
          <p>先确认已有一个可执行的 worker（Chat 底部「＋ dsh」）；再确认设置 → 执行里的 dsh / 模型可用。主管失败时会进收件箱并显示原因。</p>
        </details>
        <details>
          <summary>批准后报「计划尚未批准」或没有子任务？</summary>
          <p>先等 Plan Card 出现并点「批准并分派」。主管不能在计划审批前创建子任务；如果计划没有 worker，批准会提示先纳管 Agent。</p>
        </details>
        <details>
          <summary>为什么子任务没有独立 worktree？</summary>
          <p>worktree 只在项目是 git 仓库时创建；否则会回落到项目目录。并行改文件前建议先 `git init` 或使用已有仓库，避免互相覆盖。</p>
        </details>
        <details>
          <summary>怎么把预览和终端并排？</summary>
          <p>先打开预览标签，再把它拖到某个终端窗格的左/右/上/下边缘；终端右键菜单也有「在右侧打开预览」。拖入后预览会变成 split 里的一个 pane，原预览标签会消失。</p>
        </details>
        <details>
          <summary>能直接让主管改代码吗？</summary>
          <p>不建议。Mission 模式的主管是只读 supervisor，代码改动交给 worker；这样才有 worktree、审批、可回滚的 branch。</p>
        </details>
        <details>
          <summary>Mission 卡在「计划待审批」怎么办？</summary>
          <p>点「批准并分派」或「退回修改」。如果主管进程已停止/应用重启，可在 Mission 面板点「恢复 Mission」再继续。</p>
        </details>
        <details>
          <summary>支持远程主管吗？</summary>
          <p>当前 supervisor 只支持本地；远程主机仍可作为 worker 运行子任务。远程 supervisor（MCP over SSH）和团队/小队是后续能力。</p>
        </details>
      </section>

      <section className="guide-card guide-wide guide-note">
        <b>一句话原则</b>
        <p>普通单任务用 worker；需要拆解、并行、审阅和汇总时用 Mission。不要把主管当成“更快的 worker”。</p>
      </section>
    </div>
  );
}
