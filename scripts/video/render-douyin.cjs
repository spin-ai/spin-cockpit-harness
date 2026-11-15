#!/usr/bin/env node
/**
 * 生成介绍视频：竖版 1080×1920 / 横版 1920×1080，30fps。
 *
 * 用法：
 *   npx electron scripts/video/render-douyin.cjs                      # 竖版完整渲染
 *   npx electron scripts/video/render-douyin.cjs --preview            # 竖版关键帧
 *   npx electron scripts/video/render-douyin.cjs --wide --reuse-audio # 横版，复用竖版音频
 *
 * 产物（已 gitignore）：
 *   .preview/douyin/        竖版 mp4 / silent / cover / stage.html
 *   .preview/douyin-wide/   横版 mp4 / silent / cover / stage.html
 *
 * 配音：Edge（默认 Xiaoxiao）或 Volcengine，见 tts.cjs；音乐：music.cjs 合成铺底。
 */
const { app, BrowserWindow } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ROOT, IMG, SCENES } = require("./scenes.cjs");
const TTS = require("./tts.cjs");
const { renderMusic } = require("./music.cjs");

const WIDE = process.argv.includes("--wide");
const REUSE_AUDIO = process.argv.includes("--reuse-audio");
const WIDTH = WIDE ? 1920 : 1080;
const HEIGHT = WIDE ? 1080 : 1920;
const FPS = 30;
const OVERLAP = 0.3;
const OUT = path.join(ROOT, ".preview", WIDE ? "douyin-wide" : "douyin");
const AUDIO = path.join(ROOT, ".preview/douyin/audio");
const PREVIEW = path.join(OUT, "preview");
const CSS = fs.readFileSync(path.join(__dirname, "stage.css"), "utf8");
const WIDE_CSS = fs.readFileSync(path.join(__dirname, "stage-wide.css"), "utf8");

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function has(file) {
  return file && fs.existsSync(file);
}

function fileUrl(file) {
  return pathToFileURL(file).href;
}

function ensureDirs() {
  for (const dir of [OUT, AUDIO, PREVIEW, path.dirname(IMG.qr)]) fs.mkdirSync(dir, { recursive: true });
}

function ensureQr() {
  if (has(IMG.qr)) return true;
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=8&data=${encodeURIComponent(
    "https://github.com/spin-ai/spin-cockpit-harness",
  )}`;
  try {
    sh("curl", ["-sSL", "--max-time", "25", "-o", IMG.qr, url]);
    return has(IMG.qr);
  } catch {
    console.warn("[video] QR 下载失败，CTA 只放链接");
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 1. 配音 + 时间线                                                    */
/* ------------------------------------------------------------------ */

async function buildTimeline() {
  const timeline = [];
  let cursor = 0;
  for (const scene of SCENES) {
    const wav = path.join(AUDIO, `vo-${scene.id}.wav`);
    const voDur = REUSE_AUDIO && has(wav)
      ? TTS.probe(wav)
      : (await TTS.synthesize(scene, wav)).dur;
    const dur = Math.max(3.2, voDur + 1.0);
    const start = timeline.length ? cursor - OVERLAP : 0;
    const voStart = start + (timeline.length ? 0.55 : 0.6);
    timeline.push({ ...scene, voDur, dur, start, voStart, end: start + dur });
    cursor = start + dur;
    console.log(`  [tts] ${scene.id.padEnd(9)} ${voDur.toFixed(2)}s`);
  }
  return timeline;
}

/* ------------------------------------------------------------------ */
/* 2. 音频：VO 按时间线摆放 + 低音量铺底 + loudnorm                      */
/* ------------------------------------------------------------------ */

function buildAudio(timeline) {
  const total = timeline[timeline.length - 1].end;
  const silence = path.join(AUDIO, "silence.wav");
  const voMix = path.join(AUDIO, "vo-mix.wav");
  const music = path.join(AUDIO, "music.wav");
  const mix = path.join(AUDIO, "mix.wav");

  sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(total), "-c:a", "pcm_s16le", silence]);

  const inputs = ["-i", silence];
  const filters = [];
  const labels = ["[0:a]"];
  timeline.forEach((scene, i) => {
    inputs.push("-i", path.join(AUDIO, `vo-${scene.id}.wav`));
    const ms = Math.round(scene.voStart * 1000);
    filters.push(`[${i + 1}:a]adelay=${ms}[a${i + 1}]`);
    labels.push(`[a${i + 1}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0[vo]`);
  sh("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[vo]", "-ar", "48000", "-ac", "1", voMix]);

  console.log("[video] 合成轻量铺底音乐");
  renderMusic(total, music);

  sh("ffmpeg", [
    "-y", "-loglevel", "error", "-i", voMix, "-i", music,
    "-filter_complex", [
      // 人声：轻 EQ + 压缩 + 一点空间感
      "[0:a]highpass=f=80,equalizer=f=220:t=q:w=1:g=1.2,equalizer=f=3200:t=q:w=1:g=-1.2,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=150,aecho=0.8:0.55:22:0.05,asplit=2[voA][voB]",
      // 音乐压低，并被人声 sidechain 自动让位
      "[1:a]volume=0.62[mus]",
      "[mus][voB]sidechaincompress=threshold=0.025:ratio=7:attack=12:release=280[duck]",
      "[voA][duck]amix=inputs=2:weights=1 0.9:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
    ].join(";"),
    "-map", "[a]", "-ar", "48000", "-ac", "1", mix,
  ]);

  return mix;
}

/* ------------------------------------------------------------------ */
/* 3. HTML                                                             */
/* ------------------------------------------------------------------ */

function headHtml(scene) {
  const chips = scene.chips
    ? `<div class="chips">${scene.chips
        .map((chip, i) => `<span class="chip" data-anim="chip" data-delay="${(0.34 + i * 0.07).toFixed(2)}">${chip}</span>`)
        .join("")}</div>`
    : "";
  return `<div class="head">
    <div class="kicker" data-anim="rise" data-delay="0.04">${scene.kicker}</div>
    <h1 class="title" data-anim="rise" data-delay="0.12">${titleHtml(scene)}</h1>
    ${scene.lead ? `<p class="lead" data-anim="rise" data-delay="0.2">${scene.lead}</p>` : ""}
    ${chips}
  </div>`;
}

function titleHtml(scene) {
  const map = {
    hook: ["一个人最多", "盯 <em>5 个</em> Agent"],
    problem: ["开到最后", "<em>我记不住谁在等</em>"],
    reveal: ["我写了个东西", "Cockpit Harness"],
    terminal: ["打一行字", "<em>它开个真终端</em>"],
    super: ["活再大点", "扔给 <em>Super Agent</em>"],
    scene: ["状态能变成", "<em>办公室 · 作战室</em>", "<em>航母甲板</em>"],
    wiki: ["领域内的知识", "<em>进 wiki</em>"],
    memory: ["跑过的活", "<em>都进入记忆</em>"],
    persona: ["构建<em>人物画像</em>"],
    tech: ["五个<em>技术难点</em>"],
    cta: ["代码开源", "<em>跑你自己机器上</em>"],
  };
  return (map[scene.id] || scene.title).join("<br>");
}

function shotHtml(scene, shot, style, opts = {}) {
  const rot = shot.rot || 0;
  return `<div class="shot${opts.small ? " shot-small" : ""}" data-anim="shot" data-delay="${opts.delay ?? 0.26}" data-rot="${rot}"
      style="${style}">
    <div class="shotbar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span class="shotlabel">${shot.label || ""}</span></div>
    <div class="shotimg" data-zoom style="background-image:url('${fileUrl(shot.src)}');background-position:${shot.pos};background-size:${shot.size || "cover"}"></div>
  </div>`;
}


function mockHtml(kind) {
  const tag = '<span class="mock-tag">示例数据</span>';
  if (kind === "memory") {
    const layers = [
      ["L4", "注入", "目录 · 每轮按预算选 ≤12k", 34, "g"],
      ["L3", "知识", "资料 + 页面 · 可审核", 58, "b"],
      ["L2", "note", "观察与猜测 · 必须带来源", 42, "y"],
      ["L1", "会话", "原始消息 / run / 事件 · 只读", 76, "m"],
    ];
    return `<div class="mock" data-anim="shot" data-delay="0.24">
      <div class="shotbar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span class="shotlabel">记忆 · 四层</span>${tag}</div>
      <div class="mock-body cols2">
        <div class="layers">${layers
          .map(
            ([n, name, desc, w, tone]) =>
              `<div class="layer ${tone}"><b>${n}</b><div><strong>${name}</strong><span>${desc}</span></div><i style="--w:${w}%"></i></div>`,
          )
          .join("")}</div>
        <div class="mock-aside">
          <span class="eyebrow">DREAM</span>
          <b>只提议，不自动改</b>
          <ul><li>失效 / 衰减 / 到期 / 合并</li><li>打分注入 · 注入台账</li><li>越往上越小</li></ul>
        </div>
      </div>
    </div>`;
  }
  return `<div class="mock" data-anim="shot" data-delay="0.24">
    <div class="shotbar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span class="shotlabel">人物画像</span>${tag}</div>
    <div class="mock-body persona">
      <div class="persona-head">
        <div class="avatar">示</div>
        <div class="persona-name"><b>示例人物</b><span>同事 · 合作 2 个项目</span></div>
        <span class="score">依据 9 条</span>
      </div>
      <div class="persona-rows">
        <div><span>角色</span><b>技术负责人</b></div>
        <div><span>处事</span><b>先要数据，再给判断</b></div>
        <div><span>偏好</span><b>小范围试点，跑通再推</b></div>
      </div>
      <div class="persona-chips"><span>事实 12</span><span>证据 23</span><span>待确认 3</span><span>双时态回看</span></div>
      <p class="persona-foot">每条结论都能翻回原话与日期</p>
    </div>
  </div>`;
}

function featureHtml(scene) {
  let shots = "";
  let extra = "";
  if (scene.mock) {
    shots = mockHtml(scene.mock);
  } else if (scene.id === "wiki") {
    const [big, small] = scene.shots;
    const bigStyle = WIDE
      ? "left:960px;top:130px;width:720px;height:540px;"
      : "left:76px;top:820px;width:740px;height:520px;";
    const smallStyle = WIDE
      ? "left:1600px;top:560px;width:280px;height:240px;"
      : "left:742px;top:1130px;width:300px;height:240px;";
    shots += shotHtml(scene, big, bigStyle, { delay: 0.24 });
    shots += shotHtml(scene, small, smallStyle, { delay: 0.42, small: true });
  } else {
    const style = WIDE
      ? "left:980px;top:150px;width:860px;height:590px;"
      : "left:80px;top:830px;width:920px;height:570px;";
    shots = shotHtml(scene, scene.shots[0], style, { delay: 0.24 });
  }
  return `<section class="scene" data-scene="${scene.id}">
    ${headHtml(scene)}
    ${shots}
    ${extra}
    ${scene.punch ? `<div class="punchline" data-anim="rise" data-delay="0.55">${scene.punch}</div>` : ""}
  </section>`;
}

function bleedHtml(scene) {
  const bleeds = scene.shots
    .map((shot, i) => `<div class="bleed" data-bleed="${i}" style="background-image:url('${fileUrl(shot.src)}');background-position:${shot.pos || "50% 45%"};filter:${shot.filter || "none"}"></div>`)
    .join("");
  const labels = scene.labels
    .map((label, i) => `<span class="label" data-label="${i}">${label}</span>`)
    .join("");
  return `<section class="scene" data-scene="${scene.id}">
    ${bleeds}
    <div class="veil"></div>
    ${headHtml(scene)}
    <div class="labels" data-anim="fade" data-delay="0.35">${labels}</div>
  </section>`;
}

const WIDE_TILES = [[980, 180], [1460, 180], [980, 450], [1460, 450], [980, 720], [1460, 720]];

const TILES = [
  { x: 58, y: 766, r: -3, title: "dsh · acp", lines: [["b", "$", "dsh --profile acp"], ["g", "✓", "session/new"], ["", " ", "read / edit"], ["m", "…", "42.3s"]] },
  { x: 562, y: 766, r: 2, title: "claude · pty", lines: [["b", "$", "claude"], ["y", "●", "edit src/App.tsx"], ["r", "!", "waiting approval"], ["m", "…", "steer"]] },
  { x: 58, y: 1040, r: 2, title: "codex · pty", lines: [["b", "$", "codex"], ["g", "✓", "tests passed"], ["", " ", "3 files changed"], ["m", "…", "done"]] },
  { x: 562, y: 1040, r: -2, title: "pi · pty", lines: [["b", "$", "pi"], ["y", "●", "queued"], ["", " ", "waiting slot"], ["m", "…", "…"]] },
  { x: 58, y: 1314, r: -2, title: "opencode · pty", lines: [["b", "$", "opencode"], ["g", "✓", "review ready"], ["", " ", "1 comment"], ["m", "…", "…"]] },
  { x: 562, y: 1314, r: 3, over: true, title: "dsh · acp #2", lines: [["b", "$", "dsh --profile acp"], ["r", "!", "第 6 个"], ["", " ", "顾不过来"], ["m", "…", "…"]] },
];

function tilesHtml() {
  return TILES.map((tile, i) => {
    const lines = tile.lines
      .map(([cls, mark, text]) => `<span class="${cls}">${mark}</span> ${text}`)
      .join("\n");
    const [x, y] = WIDE ? WIDE_TILES[i] : [tile.x, tile.y];
    return `<div class="tile${tile.over ? " over" : ""}" data-tile="${i}" data-x="${x}" data-y="${y}" data-r="${tile.r}">
      <div class="tilebar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span>${tile.title}</span></div>
      ${tile.over ? '<span class="tile-badge">第 6 个</span>' : ""}
      <pre>${lines}</pre>
    </div>`;
  }).join("");
}

function hookHtml(scene) {
  return `<section class="scene" data-scene="${scene.id}">
    <div class="head hook-a">
      <div class="kicker">${scene.kicker}</div>
      <h1 class="title">${titleHtml(scene)}</h1>
      <div class="rule"></div>
    </div>
    <div class="hook-punch">${scene.punch}</div>
    <div class="hook-sub">${scene.sub}</div>
    ${tilesHtml()}
  </section>`;
}

function problemHtml(scene) {
  const notes = [
    ["n1", "", "谁在跑？"],
    ["n2", "red", "改完了吗？"],
    ["n3", "blue", "发给哪个会话？"],
    ["n4", "", "worktree 在哪？"],
    ["n5", "red", "谁批准的？"],
  ]
    .map(([cls, tone, text], i) => `<span class="note ${cls} ${tone}" data-anim="chip" data-delay="${(0.3 + i * 0.08).toFixed(2)}">${text}</span>`)
    .join("");
  return `<section class="scene" data-scene="${scene.id}">
    ${headHtml(scene)}
    <div class="notes">${notes}</div>
    <div class="problem-foot" data-anim="fade" data-delay="0.8">不是记性问题，是系统问题</div>
  </section>`;
}

function revealHtml(scene) {
  const strip = (WIDE ? [IMG.terminal, IMG.super] : [IMG.terminal, IMG.super, IMG.wiki])
    .map((src) => `<div class="rs" style="background-image:url('${fileUrl(src)}')"></div>`)
    .join("");
  return `<section class="scene" data-scene="${scene.id}">
    <div class="reveal-core">
      <div class="bigmark" data-anim="shot" data-delay="0.06">C</div>
      <h2 data-anim="rise" data-delay="0.14">我写了个东西</h2>
      <div class="reveal-brand" data-anim="rise" data-delay="0.2">Cockpit Harness</div>
      <p data-anim="rise" data-delay="0.28">让 Agent 为我打工</p>
      <div class="badges" data-anim="rise" data-delay="0.34">
        <span>Electron</span><span>node:sqlite</span><span>ACP</span><span>Local-first</span><span>MIT</span>
      </div>
    </div>
    <div class="reveal-strip" data-anim="fade" data-delay="0.4">${strip}</div>
    <div class="reveal-foot" data-anim="fade" data-delay="0.55">不是发布会，是我自己在用</div>
  </section>`;
}

function techHtml(scene) {
  const rows = scene.rows
    .map(
      ([num, name, desc, tag], i) => `<div class="row" data-anim="rise" data-delay="${(0.22 + i * 0.08).toFixed(2)}">
        <span class="rnum">${num}</span><b class="rname">${name}</b><span class="rdesc">${desc}</span><span class="rtag">${tag}</span>
      </div>`,
    )
    .join("");
  return `<section class="scene" data-scene="${scene.id}">
    ${headHtml(scene)}
    <div class="rows">${rows}</div>
  </section>`;
}

function ctaHtml(scene) {
  const qr = has(IMG.qr)
    ? `<div class="qr-wrap" data-anim="rise" data-delay="0.36">
        <img src="${fileUrl(IMG.qr)}" alt="QR">
        <div class="qr-copy"><b>扫码打开 GitHub</b><span>${scene.repo}</span></div>
      </div>`
    : `<div class="qr-wrap" data-anim="rise" data-delay="0.36"><div class="qr-copy"><b>GitHub</b><span>${scene.repo}</span></div></div>`;
  return `<section class="scene" data-scene="${scene.id}">
    <div class="cta-top" data-anim="rise" data-delay="0.04">
      <div class="cta-mark">C</div>
      <div><div class="cta-name">Cockpit Harness</div><div class="cta-sub">MULTI-AGENT WORKSPACE</div></div>
    </div>
    <div class="cta-title">${titleHtml(scene)}</div>
    <div class="cta-lead" data-anim="rise" data-delay="0.2">${scene.lead}</div>
    ${qr}
    <div class="cta-pill" data-anim="rise" data-delay="0.46">开源 Alpha · macOS / Windows / Linux</div>
    <div class="cta-foot" data-anim="fade" data-delay="0.56">本地优先 · 数据不离开本机 · Agent 可替换</div>
  </section>`;
}

function sceneHtml(scene) {
  switch (scene.kind) {
    case "hook": return hookHtml(scene);
    case "problem": return problemHtml(scene);
    case "reveal": return revealHtml(scene);
    case "bleed": return bleedHtml(scene);
    case "tech": return techHtml(scene);
    case "cta": return ctaHtml(scene);
    default: return featureHtml(scene);
  }
}

function buildHtml(timeline) {
  const tl = timeline.map((scene) => ({ id: scene.id, start: scene.start, dur: scene.dur }));
  const total = timeline[timeline.length - 1].end;
  const images = new Set([IMG.layout, IMG.terminal, IMG.super, IMG.office, IMG.warroom, IMG.carrier, IMG.wiki, IMG.graph]);
  if (has(IMG.qr)) images.add(IMG.qr);
  const urls = [...images].filter(Boolean).map(fileUrl);

  return `<!doctype html><html lang="zh-CN" class="${WIDE ? "wide" : ""}"><head><meta charset="utf-8"><style>${CSS}${WIDE ? WIDE_CSS : ""}</style></head>
<body class="${WIDE ? "wide" : ""}">
<div id="stage">
  <div class="bg"></div><div class="halo"></div><div class="grid"></div><div class="vignette"></div>
  <div class="brand"><span class="mark">C</span><span>Cockpit Harness</span><span class="alpha">ALPHA</span></div>
  <div class="progress"></div>
  ${timeline.map(sceneHtml).join("\n")}
</div>
<script>
const TL = ${JSON.stringify(tl)};
const TOTAL = ${total.toFixed(3)};
const WIDE = ${WIDE ? "true" : "false"};
const clamp = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, p) => a + (b - a) * p;

function renderAt(t) {
  document.querySelector(".progress").style.width = (clamp(t / TOTAL) * 100).toFixed(2) + "%";

  for (const scene of document.querySelectorAll(".scene")) {
    const item = TL.find((s) => s.id === scene.dataset.scene);
    if (!item) continue;
    const local = t - item.start;
    let alpha = item.start === 0
      ? Math.min(1, clamp((item.dur - local) / 0.26))
      : Math.min(clamp(local / 0.26), clamp((item.dur - local) / 0.26));
    if (local < -0.35 || local > item.dur + 0.35) alpha = 0;
    scene.style.opacity = alpha.toFixed(3);
    scene.style.visibility = alpha > 0.002 ? "visible" : "hidden";

    for (const el of scene.querySelectorAll("[data-anim]")) {
      const d = parseFloat(el.dataset.delay || "0");
      const p = clamp((local - d) / 0.5);
      const type = el.dataset.anim;
      el.style.opacity = p.toFixed(3);
      if (type === "rise") {
        el.style.transform = "translateY(" + ((1 - p) * 44).toFixed(1) + "px)";
      } else if (type === "shot") {
        const rot = parseFloat(el.dataset.rot || "0");
        el.style.transform = "translateY(" + ((1 - p) * 84).toFixed(1) + "px) scale(" + (0.96 + 0.04 * p).toFixed(3) + ") rotate(" + rot + "deg)";
      } else if (type === "chip") {
        el.style.transform = "translateY(" + ((1 - p) * 26).toFixed(1) + "px) scale(" + (0.94 + 0.06 * p).toFixed(3) + ")";
      }
    }

    for (const img of scene.querySelectorAll("[data-zoom]")) {
      const q = clamp(local / Math.max(0.6, item.dur));
      img.style.transform = "scale(" + (1.01 + 0.055 * q).toFixed(4) + ")";
    }

    if (scene.dataset.scene === "hook") {
      const a = scene.querySelector(".hook-a");
      const punch = scene.querySelector(".hook-punch");
      const collapseAt = 2.8;
      a.style.opacity = clamp(1 - (local - (collapseAt - 0.16)) / 0.35).toFixed(3);
      a.style.transform = "translateY(" + ((1 - clamp(local / 0.4)) * 26).toFixed(1) + "px)";
      const pp = clamp((local - (collapseAt + 0.12)) / 0.4);
      punch.style.opacity = pp.toFixed(3);
      punch.style.transform = "translateY(" + ((1 - pp) * 30).toFixed(1) + "px)";
      const sub = scene.querySelector(".hook-sub");
      sub.style.opacity = (pp * 0.9).toFixed(3);
      sub.style.transform = "translateY(" + ((1 - pp) * 24).toFixed(1) + "px)";
      for (const tile of scene.querySelectorAll("[data-tile]")) {
        const i = Number(tile.dataset.tile);
        const sx = Number(tile.dataset.x);
        const sy = Number(tile.dataset.y);
        const sr = Number(tile.dataset.r);
        const inP = clamp((local - 0.05 - i * 0.035) / 0.32);
        const c = clamp((local - collapseAt - i * 0.02) / 0.55);
        const x = lerp(sx, WIDE ? 1440 : 310, c);
        const y = lerp(sy, WIDE ? 450 : 880, c);
        const s = lerp(1, WIDE ? 0.32 : 0.34, c);
        tile.style.opacity = (inP * Math.max(0, 1 - c * 1.15)).toFixed(3);
        tile.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + s.toFixed(3) + ") rotate(" + (sr * (1 - c)).toFixed(2) + "deg)";
      }
    }

    if (scene.dataset.scene === "scene") {
      const q = clamp(local / item.dur) * 3;
      scene.querySelectorAll("[data-bleed]").forEach((el, i) => {
        el.style.opacity = clamp(1 - Math.abs(q - (i + 0.5)) / 0.72).toFixed(3);
      });
      const idx = Math.max(0, Math.min(2, Math.floor(q)));
      scene.querySelectorAll("[data-label]").forEach((el, i) => el.classList.toggle("on", i === idx));
    }
  }
  return true;
}

window.renderAt = renderAt;
window.__ready = false;
(async () => {
  await Promise.all(${JSON.stringify(urls)}.map((src) => new Promise((res) => {
    const img = new Image();
    img.onload = img.onerror = () => res();
    img.src = src;
  })));
  await document.fonts.ready;
  renderAt(0);
  window.__ready = true;
})();
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* 4. Electron 渲染                                                    */
/* ------------------------------------------------------------------ */

async function waitReady(win, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await win.webContents.executeJavaScript("window.__ready === true").catch(() => false);
    if (ready) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("stage 页面没有就绪");
}

async function paint(win, t) {
  await win.webContents.executeJavaScript(`new Promise((resolve) => {
    window.renderAt(${t});
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  // offscreen 下 capturePage 拿到的是上一帧；先空抓一次逼一次合成，再等一会儿
  await win.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 45));
}

async function capturePng(win, t) {
  await paint(win, t);
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const fixed = size.width === WIDTH && size.height === HEIGHT ? image : image.resize({ width: WIDTH, height: HEIGHT });
  return fixed.toPNG();
}

async function captureJpeg(win, t) {
  await paint(win, t);
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const fixed = size.width === WIDTH && size.height === HEIGHT ? image : image.resize({ width: WIDTH, height: HEIGHT });
  return fixed.toJPEG(94);
}

function writeAsync(stream, buf) {
  return new Promise((resolve, reject) => {
    const ok = stream.write(buf, (err) => (err ? reject(err) : null));
    if (ok) resolve();
    else stream.once("drain", resolve);
  });
}

async function renderFrames(win, total, mixWav) {
  const out = path.join(OUT, WIDE ? "cockpit-harness-intro-wide.mp4" : "cockpit-harness-douyin.mp4");
  const frames = Math.max(1, Math.round(total * FPS));
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-i", mixWav,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
    out,
  ]);
  let stderr = "";
  ff.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
  const closed = new Promise((resolve) => ff.on("close", (code) => resolve(code)));

  for (let i = 0; i < frames; i += 1) {
    const jpg = await captureJpeg(win, i / FPS);
    await writeAsync(ff.stdin, jpg);
    if (i % 45 === 0) console.log(`[video] ${i}/${frames} frames (${Math.round((i / frames) * 100)}%)`);
  }
  ff.stdin.end();
  const code = await closed;
  if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}\n${stderr}`);
  console.log(`[video] ${out}`);
  return out;
}

function writeSilent(input) {
  const out = path.join(OUT, WIDE ? "cockpit-harness-intro-wide-silent.mp4" : "cockpit-harness-douyin-silent.mp4");
  sh("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-an", "-c:v", "copy", "-movflags", "+faststart", out]);
  console.log(`[video] ${out}`);
  return out;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(async () => {
  ensureDirs();
  ensureQr();
  console.log(`[video] 配音 ${TTS.describe()}`);
  const timeline = await buildTimeline();
  const total = timeline[timeline.length - 1].end;
  console.log(`[video] 时间线 ${total.toFixed(1)}s`);
  for (const scene of timeline) console.log(`  ${scene.id.padEnd(9)} ${scene.start.toFixed(2)}–${scene.end.toFixed(2)}s  vo=${scene.voDur.toFixed(2)}s`);

  const sharedMix = path.join(AUDIO, "mix.wav");
  const mixWav = REUSE_AUDIO && has(sharedMix) ? sharedMix : buildAudio(timeline);
  const html = buildHtml(timeline);
  const htmlFile = path.join(OUT, "stage.html");
  fs.writeFileSync(htmlFile, html);

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: "#05080f",
    webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: 1 },
  });
  win.setContentSize(WIDTH, HEIGHT);
  await win.loadFile(htmlFile);
  await waitReady(win);

  if (process.argv.includes("--preview")) {
    const times = WIDE
      ? [0.8, 2.0, 3.6, 6.5, 9.0, 12.5, 16.5, 19.0, 24.0, 28.0, 33.0, 38.0, 41.5, 46.0, 49.0, 53.0, 57.0, 59.0, total - 1.2]
      : [0.8, 2.0, 3.6, 6.5, 9.0, 12.5, 16.5, 19.0, 24.0, 28.0, 33.0, 38.0, 41.5, 45.0, 49.0, 53.0, 57.0, 59.0, total - 1.2];
    for (const t of times) {
      const png = await capturePng(win, Math.min(t, total - 0.2));
      const file = path.join(PREVIEW, `t-${t.toFixed(1).padStart(5, "0")}.png`);
      fs.writeFileSync(file, png);
      console.log(`[preview] ${file}`);
    }
    const cover = await capturePng(win, 1.5);
    fs.writeFileSync(path.join(OUT, "cover.png"), cover);
    console.log(`[preview] ${path.join(OUT, "cover.png")}`);
    win.destroy();
    app.quit();
    return;
  }

  fs.writeFileSync(path.join(OUT, "cover.png"), await capturePng(win, 1.5));
  fs.writeFileSync(path.join(OUT, "cover-alt.png"), await capturePng(win, 2.6));
  console.log("[video] cover.png / cover-alt.png");

  const mp4 = await renderFrames(win, total, mixWav);
  writeSilent(mp4);
  win.destroy();
  app.quit();
}).catch((err) => {
  console.error("[video] failed:", err);
  app.quit();
  process.exitCode = 1;
});
