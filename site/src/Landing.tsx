import { useEffect } from "react";

const REPO = "https://github.com/spin-ai/spin-cockpit-harness";
const RELEASES = `${REPO}/releases`;

const PILLARS = [
  {
    kicker: "01 · MULTI-AGENT TERMINAL",
    title: "多智能体终端",
    body: "Chat、真实 PTY、TODO、worktree。一个窗口里看见每个 Agent 的运行现场。",
    image: "./wiki/cover-terminal.png",
    alt: "多智能体终端",
    href: "#/wiki/home",
  },
  {
    kicker: "02 · SUPER AGENT",
    title: "Super Agent",
    body: "Mission / Plan / Delegation。主管拆解、审批、委派、汇总，人只做批准和确认。",
    image: "./wiki/cover-super-agent.png",
    alt: "Super Agent / Mission",
    href: "#/wiki/super-agent",
  },
  {
    kicker: "03 · LLM WIKI",
    title: "LLM Wiki",
    body: "笔记插件：Source → Page → Citation → Review。Agent 可检索、写 draft，reviewed 由人审核。",
    image: "./wiki/cover-llm-wiki.png",
    alt: "LLM Wiki",
    href: "#/wiki/llm-wiki",
  },
];

export function Landing({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  useEffect(() => {
    const scroll = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (id === "pillars") document.getElementById("pillars")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          <a href="#pillars">三大能力</a>
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
            <div className="landing-eyebrow">MULTI-AGENT TERMINAL · SUPER AGENT · LLM WIKI</div>
            <h1>
              把一句话变成任务，
              <br />
              让多个 Agent
              <br />
              在<em>真实项目</em>里干活
            </h1>
            <p>
              多智能体终端、Super Agent、LLM Wiki 共用一套本地数据。
              Chat 派活、真实 PTY、Mission 编排、可审核知识库。
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

        <section id="pillars" className="landing-section landing-pillars-section">
          <div className="landing-section-head">
            <span className="landing-eyebrow">THREE PILLARS</span>
            <h2>执行、组织、沉淀</h2>
            <p>不是三个拼在一起的产品，是同一套任务、run、消息和本地数据。</p>
          </div>
          <div className="landing-pillars">
            {PILLARS.map((pillar) => (
              <a className="landing-pillar" href={pillar.href} key={pillar.title}>
                <img src={pillar.image} alt={pillar.alt} loading="lazy" />
                <div className="landing-pillar-body">
                  <span className="landing-pillar-kicker">{pillar.kicker}</span>
                  <h3>{pillar.title}</h3>
                  <p>{pillar.body}</p>
                  <em>阅读更多 →</em>
                </div>
              </a>
            ))}
          </div>
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
          <a href="#/wiki/llm-wiki">LLM Wiki</a>
          <a href="#/wiki/design-notes">设计取舍</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT</a>
        </div>
      </footer>
    </div>
  );
}
