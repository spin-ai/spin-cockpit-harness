import { useEffect } from "react";

const REPO = "https://github.com/spin-ai/spin-cockpit-harness";
const RELEASES = `${REPO}/releases`;

const FEATURES = [
  {
    title: "Chat 是唯一入口",
    body: "说一句话派活；运行中继续说话就是纠偏。投递有回执，失败可重发。",
    image: "./wiki/send-state.png",
    alt: "单一 send 状态机",
  },
  {
    title: "真实终端",
    body: "node-pty + xterm，多标签、窗格拆分、链接、查找、预览都在同一个工作台。",
    image: "./wiki/layout.png",
    alt: "五列工作台",
  },
  {
    title: "任务看板",
    body: "TODO 状态就是看板。排队 / 运行 / 等待输入 / 待确认 / 已确认，一条列表看完。",
    image: "./wiki/scheduler.png",
    alt: "调度器",
  },
  {
    title: "Agent 能看见界面",
    body: "预览里点元素，把 selector、计算样式、源码位置和截图注入 Chat。",
    image: "./wiki/ui-context.png",
    alt: "元素拾取链路",
  },
  {
    title: "worktree 隔离",
    body: "git 仓库自动为每个 run 创建 worktree + 分支，多个任务并行不互相覆盖。",
    image: "./wiki/architecture.png",
    alt: "架构与 worktree",
  },
  {
    title: "Super Agent / Mission",
    body: "主管拆解、计划审批、委派子任务、事件回灌、提交总结；人保留最终确认。",
    image: "./wiki/mission-flow.png",
    alt: "Mission 流程",
  },
];

const STEPS = [
  {
    number: "01",
    kicker: "DISPATCH",
    title: "一句话进入状态机",
    body: "消息先落库，再创建 TODO + queued run。受全局、主机、Agent 和同 cwd 约束，排队原因可见。",
    image: "./wiki/send-state.png",
    alt: "发送状态机",
  },
  {
    number: "02",
    kicker: "EXECUTE",
    title: "ACP 驱动真实执行",
    body: "每个 run 一个 dsh --profile acp：initialize → session/new → prompt；流式消息、工具调用、审批全部写回。",
    image: "./wiki/acp-sequence.png",
    alt: "ACP 时序",
  },
  {
    number: "03",
    kicker: "REVIEW",
    title: "人确认才算完成",
    body: "Agent 停下来只代表 run 结束。任务进入待确认，人点确认后才进入「已确认」。",
    image: "./wiki/data-model.png",
    alt: "任务与运行数据模型",
  },
];

export function Landing({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  useEffect(() => {
    const scroll = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (id === "features" || id === "how" || id === "mission") {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    scroll();
    window.addEventListener("hashchange", scroll);
    return () => window.removeEventListener("hashchange", scroll);
  }, []);

  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="#/">
          <span className="landing-mark">C</span>
          <b>Cockpit Harness</b>
        </a>
        <nav>
          <a href="#features">特性</a>
          <a href="#how">工作流</a>
          <a href="#mission">Mission</a>
          <a href="#/wiki/home">文档</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <div className="landing-nav-actions">
          <button type="button" className="landing-theme" onClick={onToggleTheme}>
            {dark ? "☀" : "☾"}
          </button>
          <a className="landing-nav-cta" href={RELEASES} target="_blank" rel="noreferrer">下载 Alpha</a>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow">LOCAL-FIRST MULTI-AGENT COCKPIT</div>
            <h1>
              把一句话变成任务，
              <br />
              让多个 Agent
              <br />
              在<em>真实项目</em>里干活
            </h1>
            <p>
              Chat 派活、真实 PTY、worktree 隔离、ACP 执行、看板验收。
              不是多开终端，是让多个执行单元进入同一套状态机。
            </p>
            <div className="landing-hero-actions">
              <a className="landing-button primary" href={RELEASES} target="_blank" rel="noreferrer">下载 Alpha</a>
              <a className="landing-button" href="#/wiki/home">阅读文档 →</a>
            </div>
            <div className="landing-chips">
              <span>Electron</span><span>React</span><span>node-pty</span><span>SQLite</span><span>ACP</span>
            </div>
          </div>
          <figure className="landing-hero-visual">
            <img src="./wiki/cover-multi-agent.png" alt="Cockpit Harness 多智能体工作台" />
            <figcaption><span>v0.2.0-alpha.2</span><span>macOS / Windows / Linux</span></figcaption>
          </figure>
        </section>

        <section className="landing-stats" aria-label="项目概览">
          <div><b>5 列</b><span>TODO / Chat / Terminal / 文件 / 导航</span></div>
          <div><b>真实 PTY</b><span>不是日志窗口</span></div>
          <div><b>worktree</b><span>每个 run 独立目录</span></div>
          <div><b>本地优先</b><span>SQLite + 本地文件</span></div>
        </section>

        <section id="features" className="landing-section">
          <div className="landing-section-head">
            <span className="landing-eyebrow">WHAT IT DOES</span>
            <h2>一个窗口，收拢 Agent 的执行现场</h2>
            <p>分派、执行、纠偏、验收、回溯，共用一套任务 / run / 消息模型。</p>
          </div>
          <div className="landing-features">
            {FEATURES.map((feature) => (
              <article className="landing-feature" key={feature.title}>
                <img src={feature.image} alt={feature.alt} loading="lazy" />
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="landing-section landing-how">
          <div className="landing-section-head">
            <span className="landing-eyebrow">HOW IT WORKS</span>
            <h2>从一句话到验收，只有一条主流程</h2>
            <p>数据模型 → 状态机 → 协议 → UI。没有第二套表单，也没有第二个事实源。</p>
          </div>
          {STEPS.map((step, index) => (
            <article className={`landing-step ${index % 2 ? "reverse" : ""}`} key={step.number}>
              <div className="landing-step-copy">
                <span className="landing-step-number">{step.number}</span>
                <span className="landing-eyebrow">{step.kicker}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <figure>
                <img src={step.image} alt={step.alt} loading="lazy" />
              </figure>
            </article>
          ))}
        </section>

        <section id="mission" className="landing-mission">
          <div className="landing-mission-copy">
            <span className="landing-eyebrow">SUPER AGENT</span>
            <h2>Supervisor 不是更强的 worker，<br />而是 Mission 级编排者</h2>
            <p>
              拆解目标 → 计划审批 → 委派子任务 → 事件回灌 → 提交总结。
              Supervisor 只读，worker 才改代码；Agent 可以建议「做完了」，但验收永远由人确认。
            </p>
            <ul>
              <li>Mission / Supervisor Run / Delegation 三套状态机</li>
              <li>计划必须先由人批准，未批准不创建子任务</li>
              <li>八个 MCP 领域工具，不暴露 shell / 文件读写</li>
            </ul>
            <a className="landing-button" href="#/wiki/super-agent">阅读 Mission 文档 →</a>
          </div>
          <figure>
            <img src="./wiki/mission-state.png" alt="Mission 状态机" loading="lazy" />
          </figure>
        </section>

        <section className="landing-section landing-more">
          <div className="landing-section-head">
            <span className="landing-eyebrow">MORE DIAGRAMS</span>
            <h2>更多架构与流程图</h2>
            <p>终端、调度、MCP、打包与主题，都在文档的「界面与流程」里。</p>
          </div>
          <div className="landing-strip">
            <figure><img src="./wiki/cover-super-agent.png" alt="Super Agent 封面" loading="lazy" /><figcaption>Super Agent</figcaption></figure>
            <figure><img src="./wiki/mcp-bridge.png" alt="MCP bridge" loading="lazy" /><figcaption>MCP bridge</figcaption></figure>
            <figure><img src="./wiki/packaging.png" alt="打包结构" loading="lazy" /><figcaption>发行包</figcaption></figure>
            <figure><img src="./wiki/themes.png" alt="主题系统" loading="lazy" /><figcaption>13 套主题</figcaption></figure>
          </div>
          <a className="landing-more-link" href="#/wiki/gallery">查看全部图片 →</a>
        </section>

        <section className="landing-cta">
          <span className="landing-eyebrow">READY TO RUN</span>
          <h2>把下一个任务交给它</h2>
          <p>本地优先，数据在自己的机器上；Agent 由执行适配器驱动，不绑死一个 CLI。</p>
          <div className="landing-hero-actions">
            <a className="landing-button primary" href={RELEASES} target="_blank" rel="noreferrer">下载 Cockpit Harness</a>
            <a className="landing-button" href="#/wiki/home">从项目介绍开始</a>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-brand"><span className="landing-mark">C</span><b>Cockpit Harness</b></div>
        <div className="landing-footer-links">
          <a href="#/wiki/home">文档</a>
          <a href="#/wiki/gallery">界面与流程</a>
          <a href="#/wiki/design-notes">设计取舍</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT</a>
        </div>
      </footer>
    </div>
  );
}
