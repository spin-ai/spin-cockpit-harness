import { useEffect } from "react";
import pkg from "../../package.json";

const REPO = "https://github.com/spin-ai/spin-cockpit-harness";
const RELEASES = `${REPO}/releases`;

const FEATURES = [
  {
    num: "01",
    kicker: "MULTI-AGENT TERMINAL",
    title: "多智能体终端",
    body: "Chat 说一句话派活，TODO、真实 PTY、worktree 同屏；运行中继续说话就是纠偏，完成后人点确认。",
    href: "#/wiki/home",
  },
  {
    num: "02",
    kicker: "SUPER AGENT · MISSION",
    title: "Super Agent 编排",
    body: "主管不是更强的 worker：出计划、人批准、委派、汇总；子任务在独立 worktree 执行，靠产出物传递。",
    href: "#/wiki/super-agent",
  },
  {
    num: "03",
    kicker: "AGENT OFFICE",
    title: "场景与办公室",
    body: "run / 审批 / 验收映射成工位、审批台、验收架；办公室 2.5D 与作战室、航母 3D 共用一份模型。",
    href: "#/wiki/office",
  },
  {
    num: "04",
    kicker: "LLM WIKI / KNOWLEDGE",
    title: "知识库",
    body: "资料只读、页面可审核；解析 → 索引 → 检索 → 引用，整理只出建议，reviewed 由人点头。",
    href: "#/wiki/knowledge",
  },
  {
    num: "05",
    kicker: "MEMORY & PERSONA",
    title: "记忆与人物画像",
    body: "四层记忆管「记什么、忘什么」，画像管「这个人随时间什么是真的」；两套库互不写入。",
    href: "#/wiki/memory",
  },
];

const SHOTS = [
  { image: "./wiki/cover-terminal.png", alt: "多智能体终端", caption: "多智能体终端 · Chat / TODO / PTY / worktree" },
  { image: "./wiki/cover-super-agent.png", alt: "Super Agent / Mission", caption: "Super Agent · Mission / Plan / Delegation" },
  { image: "./wiki/cover-office.png", alt: "场景与办公室", caption: "场景与办公室 · 2.5D 实况 + 时间轴" },
  { image: "./wiki/cover-llm-wiki.png", alt: "知识库", caption: "知识库 · Source / Page / Citation / Review" },
  { image: "./wiki/cover-memory.png", alt: "记忆与人物画像", caption: "记忆与画像 · 四层 + Dream" },
];

const PROBLEMS = [
  {
    num: "01",
    title: "解析",
    tag: "真技术 · 部分落地",
    hard: "格式是无限长尾：双栏、嵌套表、跨页表、公式、手写，没有单一方法能全覆盖。",
    done: "20 份真实材料：文本覆盖 ≥95%、表格单元格 ≥90%、引用页命中 ≥90%、recall@5 ≥80%。",
    now: "本地直抽（PDF / Office / EPUB）、页图渲染、引擎注册与路由已落地；VLM / OCR 兜底与质量度量还没接。",
  },
  {
    num: "02",
    title: "编排",
    tag: "工程 · 主干已落地",
    hard: "不是「能起多个 Agent」，而是状态一眼看懂、干预后不产生半成品、并发写同一仓库能回滚。",
    done: "3 个 Agent 并行同一项目：不翻终端就能说出谁卡住；中断后仓库回到一致状态。",
    now: "Mission / Plan / Delegation、worktree 隔离、审批落库、终端主动上报已落地；3 Agent 并行的状态可见性还没系统验证。",
  },
  {
    num: "03",
    title: "整理",
    tag: "产品 · 部分落地",
    hard: "整理的「正确性」无法自动验证；合并两页、补引用、标过期，做错比不做更糟。",
    done: "reviewed 从不被静默改写；source 变更后引用页自动 stale；建议采纳率与 needs_rebase 占比可追踪。",
    now: "确定性整理、建议队列、逐行 diff 审核门、人工结论（claim）已落地；采纳率还没攒出稳定数据。",
  },
  {
    num: "04",
    title: "记忆",
    tag: "语义设计 · 部分落地",
    hard: "什么该记、什么该忘：不是存得越多越好，顶层一旦污染会拖累每一次会话。",
    done: "开 / 关 Dream 的返工次数对比；L4 注入条目被实际引用的比例。",
    now: "四层 + note + 打分注入 + 注入台账 + L1 索引 + Dream 建议队列已落地；归因只到标题片段，语义 pass 没有准确率数据。",
  },
  {
    num: "05",
    title: "画像",
    tag: "语义设计 · 主干已落地",
    hard: "推断的可信度：规则宁可漏也不乱猜，模型会编，所以一切推断先进入待确认。",
    done: "确认队列的误报率；asOf 回看与当时的对话是否一致。",
    now: "四格式导入、三层画像、双时态回看、群聊降权、measures 与合并建议已落地；剩下的是调优。",
  },
];

export function Landing({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  useEffect(() => {
    const scroll = () => {
      const id = window.location.hash.replace(/^#/, "");
      if (id === "video" || id === "features" || id === "tech") {
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
          <a href="#video">60 秒</a>
          <a href="#features">五个特性</a>
          <a href="#tech">五个难点</a>
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
            <div className="landing-eyebrow">TERMINAL · MISSION · OFFICE · KNOWLEDGE · MEMORY</div>
            <h1>
              把一句话变成任务，
              <br />
              让多个 Agent
              <br />
              在<em>真实项目</em>里干活
            </h1>
            <p>
              五个主打特性共用一套本地数据：Chat 派活、Mission 编排、场景投影、可审核知识库、四层记忆与人物画像。
              不把 Agent 循环塞进产品本体，只把状态、执行与沉淀放在一个窗口里。
            </p>
            <div className="landing-hero-actions">
              <a className="landing-button primary" href={RELEASES} target="_blank" rel="noreferrer">下载 Alpha</a>
              <a className="landing-button" href="#/wiki/home">阅读文档 →</a>
            </div>
            <div className="landing-chips">
              <span>Electron</span><span>React</span><span>node-pty</span><span>SQLite</span><span>ACP</span><span>three.js</span>
            </div>
          </div>
          <figure className="landing-hero-visual">
            <img src="./wiki/cover-multi-agent.png" alt="Cockpit Harness 多智能体工作台" />
            <figcaption><span>v{pkg.version}</span><span>macOS / Windows / Linux</span></figcaption>
          </figure>
        </section>

        <section id="video" className="landing-section landing-video-section">
          <div className="landing-section-head">
            <span className="landing-eyebrow">60-SECOND WALKTHROUGH</span>
            <h2>先看 60 秒</h2>
            <p>从「一个人盯五个终端」到「把活派出去」：终端、编排、场景、知识、记忆，五件事在同一条时间线上。</p>
          </div>
          <figure className="landing-video">
            <video
              controls
              playsInline
              preload="metadata"
              poster="./video/cockpit-harness-intro-poster.jpg"
            >
              <source src="./video/cockpit-harness-intro.mp4" type="video/mp4" />
              你的浏览器不支持 video 标签，可以直接到 GitHub 看项目。
            </video>
            <figcaption>
              <span>60 秒 · 横版 · 有配音</span>
              <span>本地渲染，无第三方素材</span>
            </figcaption>
          </figure>
        </section>

        <section id="features" className="landing-section landing-features-section">
          <div className="landing-section-head">
            <span className="landing-eyebrow">FIVE FEATURES · ONE DATASET</span>
            <h2>五个主打特性</h2>
            <p>执行、组织、现场、沉淀、人。不是五个产品，是同一套任务、run、消息和本地数据。</p>
          </div>
          <div className="landing-tracks">
            {FEATURES.map((item) => (
              <a className="landing-track" href={item.href} key={item.title}>
                <span className="landing-track-num">{item.num}</span>
                <span className="landing-track-kicker">{item.kicker}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <em>阅读更多 →</em>
              </a>
            ))}
          </div>
          <div className="landing-strip">
            {SHOTS.map((shot) => (
              <figure key={shot.image}>
                <img src={shot.image} alt={shot.alt} loading="lazy" />
                <figcaption>{shot.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="tech" className="landing-section landing-tech-section">
          <div className="landing-section-head">
            <span className="landing-eyebrow">FIVE HARD PROBLEMS</span>
            <h2>五个技术难点</h2>
            <p>判断标准不是「接了多少模型」，而是这件事难在哪、做到什么算做到、现在到哪了。</p>
          </div>
          <div className="landing-tech">
            {PROBLEMS.map((item) => (
              <article className="landing-tech-item" key={item.title}>
                <div className="landing-tech-head">
                  <span className="landing-tech-num">{item.num}</span>
                  <b>{item.title}</b>
                  <span className="landing-tech-tag">{item.tag}</span>
                </div>
                <div className="landing-tech-field">
                  <span>难在哪</span>
                  <p>{item.hard}</p>
                </div>
                <div className="landing-tech-field">
                  <span>做到什么算做到</span>
                  <p>{item.done}</p>
                </div>
                <div className="landing-tech-field">
                  <span>现在到哪了</span>
                  <p>{item.now}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="landing-tech-note">
            共同点：机器只负责提出来，人只负责点头，中间每一步都留证据；五件事共用一套本地底座——
            Electron / Node 24 / node:sqlite，不引入 Docker、Python 或第二个服务进程。
          </p>
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
          <a href="#/wiki/office">场景与办公室</a>
          <a href="#/wiki/memory">记忆</a>
          <a href="#/wiki/llm-wiki">LLM Wiki</a>
          <a href="#/wiki/design-notes">设计取舍</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT</a>
        </div>
      </footer>
    </div>
  );
}
