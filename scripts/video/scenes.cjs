const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const abs = (rel) => path.join(ROOT, rel);
const pick = (...files) => {
  for (const file of files) {
    if (fs.existsSync(abs(file))) return abs(file);
  }
  return abs(files[files.length - 1]);
};

const IMG = {
  layout: pick("public/wiki/layout.png"),
  hero: pick("public/wiki/cover-multi-agent.png"),
  terminal: pick("public/wiki/cover-terminal.png"),
  super: pick("public/wiki/cover-super-agent.png"),
  office: pick("docs/assets/article/sc-03-office-live.png", "public/wiki/cover-office.png"),
  warroom: pick("docs/assets/article/sc-08-stage-warroom.jpg", "public/wiki/cover-office.png"),
  carrier: pick("docs/assets/article/sc-07-stage-carrier.jpg", "public/wiki/cover-office.png"),
  wiki: pick("public/wiki/notes-wiki.png"),
  graph: pick("public/wiki/notes-graph.png"),
  qr: abs(".preview/douyin/assets/qr.png"),
};

/**
 * 11 段文稿来自 WorkBuddy 定稿（第一人称、热点引用、情绪只给四处）。
 * durHint 是文稿里的估算时长，仅在 --silent / TTS 失败时作为兜底。
 */
const SCENES = [
  {
    id: "hook",
    kind: "hook",
    vo: "DeepSeek 上周说，一个人最多盯五个 Agent。多了就顾不过来。",
    minDur: 5.4,
    kicker: "THE LIMIT · 5 AGENTS",
    title: ["一个人最多", "盯 <em>5 个</em> Agent"],
    punch: "多了，就<em>顾不过来</em>。",
    sub: "五个是设计上限，我开了六个",
  },
  {
    id: "problem",
    kind: "problem",
    vo: "我也是这样，开到最后，我记不住谁在等。",
    minDur: 4.5,
    kicker: "THE COST",
    title: ["开到最后", "<em>我记不住谁在等</em>"],
    lead: "六个窗口，六种状态",
  },
  {
    id: "reveal",
    kind: "reveal",
    vo: "于是，我写了个东西，Cockpit Harness。让 Agent 为我打工。",
    minDur: 5.1,
    kicker: "WHAT I BUILT",
    title: ["我写了个东西", "Cockpit Harness"],
    lead: "让 Agent 为我打工",
  },
  {
    id: "terminal",
    kind: "feature",
    vo: "打一行字，它开个真终端，任务排队跑。每个 run 一个独立 worktree，改完我点确认。",
    minDur: 7.9,
    kicker: "MULTI-AGENT TERMINAL",
    title: ["打一行字", "<em>它开个真终端</em>"],
    lead: "任务排队跑，每个 run 一个独立 worktree",
    chips: ["Chat 派活", "TODO 看板", "真实 PTY", "worktree 隔离"],
    punch: "改完，我点确认",
    shots: [{ src: IMG.layout, label: "Cockpit Harness — 工作区", pos: "50% 40%", size: "cover" }],
  },
  {
    id: "super",
    kind: "feature",
    vo: "活再大点，扔给 Super Agent。它拆成几份分下去。以前我最忙，现在我最闲。",
    minDur: 6.7,
    kicker: "SUPER AGENT · MISSION",
    title: ["活再大点", "扔给 <em>Super Agent</em>"],
    lead: "它拆成几份分下去",
    chips: ["Mission", "Plan 审批", "Delegation", "独立 worktree"],
    punch: "以前我最忙 · 现在我最闲",
    shots: [{ src: IMG.super, label: "Mission · plan_review", pos: "94% 40%", size: "235% auto" }],
  },
  {
    id: "scene",
    kind: "bleed",
    vo: "状态能变成办公室、作战室、航母甲板。Agent 也有社会组织了。",
    minDur: 6.2,
    kicker: "AGENT OFFICE",
    title: ["状态能变成", "<em>办公室 · 作战室</em>", "<em>航母甲板</em>"],
    lead: "Agent 也有社会组织了",
    labels: ["办公室 2.5D", "作战室 3D", "航母 3D"],
    shots: [
      { src: IMG.office, pos: "50% 38%", filter: "brightness(.86) contrast(1.04)" },
      { src: IMG.warroom, pos: "50% 45%", filter: "brightness(1.35) saturate(1.05)" },
      { src: IMG.carrier, pos: "50% 45%", filter: "brightness(1.22) saturate(1.05)" },
    ],
  },
  {
    id: "wiki",
    kind: "feature",
    vo: "领域内的知识进 wiki，补进上下文，它就越懂你的活。",
    minDur: 5.3,
    kicker: "LLM WIKI",
    title: ["领域内的知识", "<em>进 wiki</em>"],
    lead: "补进上下文，它就越懂你的活",
    chips: ["Source", "Page", "Citation", "Review"],
    shots: [
      { src: IMG.wiki, label: "Wiki · reviewed / draft", pos: "28% 45%", size: "cover", tall: true },
      { src: IMG.graph, label: "图谱", pos: "50% 50%", size: "cover", small: true },
    ],
  },
  {
    id: "memory",
    kind: "feature",
    vo: "跑过的活都进入记忆。记忆分四层，通过做梦来自我整理。",
    minDur: 6.1,
    kicker: "MEMORY · DREAM",
    title: ["跑过的活", "<em>都进入记忆</em>"],
    lead: "记忆分四层，通过做梦来自我整理",
    chips: ["L1 会话", "L2 note", "L3 知识", "L4 注入"],
    mock: "memory",
  },
  {
    id: "persona",
    kind: "feature",
    vo: "构建人物画像。跟谁合作，说得出凭什么。",
    minDur: 4.5,
    kicker: "PERSONA",
    title: ["构建<em>人物画像</em>"],
    lead: "跟谁合作，说得出凭什么",
    chips: ["事实", "证据", "双时态", "关系"],
    mock: "persona",
  },
  {
    id: "tech",
    kind: "tech",
    vo: "解析、编排、整理、记忆、画像。现在都在讲编排，难的是同时转。",
    minDur: 6.2,
    kicker: "FIVE HARD PROBLEMS",
    title: ["五个<em>技术难点</em>"],
    lead: "现在都在讲编排，难的是同时转",
    rows: [
      ["01", "解析", "长尾格式 · 质量度量", "真技术"],
      ["02", "编排", "状态可见 · 干预一致", "工程"],
      ["03", "整理", "只提议 · 不静默改", "产品"],
      ["04", "记忆", "记什么 · 忘什么", "语义"],
      ["05", "画像", "推断可信度", "语义"],
    ],
  },
  {
    id: "cta",
    kind: "cta",
    vo: "代码开源，跑你自己机器上。GitHub 搜 Cockpit Harness。",
    minDur: 4.0,
    kicker: "OPEN SOURCE · LOCAL FIRST",
    title: ["代码开源", "<em>跑你自己机器上</em>"],
    lead: "GitHub 搜 Cockpit Harness",
    repo: "github.com/spin-ai/spin-cockpit-harness",
  },
];

module.exports = { ROOT, IMG, SCENES };
