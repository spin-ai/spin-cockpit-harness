import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (ok, label) => { checks.push({ ok, label }); if (!ok) process.exitCode = 1; };

function walkTsx(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkTsx(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const design = read("src/design-system.css");
for (const token of ["--font-sans", "--mono", "--radius:10px", "--radius-sm:6px", "--radius-lg:14px", "--brand:#e5e5e5", "--border:rgba(255,255,255,.08)"]) {
  check(design.includes(token), `design-system.css · ${token}`);
}
check(read("src/main.tsx").includes("@fontsource-variable/geist"), "main.tsx · Geist import");
check(read("src/main.tsx").includes("./design-system.css"), "main.tsx · design-system import");
for (const file of ["src/components/Views.tsx", "src/components/GitView.tsx", "src/components/Settings.tsx"]) {
  check(read(file).includes("PageHeader"), `${file} · PageHeader`);
}
check(fs.existsSync(path.join(root, "src/components/PageHeader.tsx")), "PageHeader component");
check(fs.existsSync(path.join(root, "src/components/EmptyState.tsx")), "EmptyState component");
check(fs.existsSync(path.join(root, "docs/DESIGN-SYSTEM.md")), "docs/DESIGN-SYSTEM.md");
check(fs.existsSync(path.join(root, "AGENTS.md")), "AGENTS.md");

// 页面结构规范与 AGENTS 约束必须同时在：只写在一边，后来的 agent 会按另一半执行
check(read("AGENTS.md").includes("页面外壳只有三种") && read("AGENTS.md").includes("主面只用 Surface 三档"),
  "AGENTS.md · 页面结构 / Surface 约束");
const designDoc = read("docs/DESIGN-SYSTEM.md");
check(designDoc.includes("### 4.1 三种外壳") && designDoc.includes("### 4.4 Surface 三档"),
  "DESIGN-SYSTEM.md · 页面外壳 / Surface 规范");

// 一级页面统一 PageHeader；阅读页（Guide→GitWiki）是唯一例外
const pageFiles = ["Views.tsx", "GitView.tsx", "Settings.tsx", "Notes.tsx", "Memory.tsx", "Persona.tsx", "Bots.tsx", "Bot.tsx", "SceneWorkspace.tsx", "Zhulong.tsx", "PluginMarket.tsx"];
const noHeader = pageFiles.filter((f) => {
  const file = path.join(root, "src/components", f);
  return !fs.existsSync(file) || !read(`src/components/${f}`).includes("PageHeader");
});
check(noHeader.length === 0, `一级页面必须用 PageHeader${noHeader.length ? "：" + noHeader.join("、") : ""}`);
// 页面标题单语：不叠加英文 kicker（英文模式整体切换）
const kickerUsers = pageFiles.filter((f) => read(`src/components/${f}`).includes("kicker="));
check(kickerUsers.length === 0 && !read("src/components/PageHeader.tsx").includes("kicker"), `页面标题不得叠加英文 kicker${kickerUsers.length ? "：" + kickerUsers.join("、") : ""}`);
check(read("AGENTS.md").includes("叠加英文 kicker") && read("docs/DESIGN-SYSTEM.md").includes("叠加英文 kicker"), "AGENTS / DESIGN-SYSTEM · 标题单语约束");

// 字符图标：JSX 文本里不得用 ↻ / ▦ / ☰ / ←（键盘快捷键说明除外）
const glyphPages = [];
const walkIcons = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkIcons(rel);
    else if (/\.(ts|tsx)$/.test(entry.name) && />[^<>\n]*(?:↻|▦|☰|←)[^<>\n]*</.test(read(rel))) glyphPages.push(rel);
  }
};
walkIcons("src");
check(glyphPages.length === 0, `控件不得用字符代替图标${glyphPages.length ? "：" + glyphPages.join("、") : ""}`);

// 页面主面不再新增 12px 圆角（统计 tile 已统一 10）
const stylesCss = read("src/styles.css") + "\n" + read("src/office/office.css");
const allCss = ["src/styles.css", "src/design-system.css", "src/wiki.css"].map(read).join("\n");
const deprecatedClasses = /\.(?:view-switch|kv-tabs|off-tabs|off-tab|git-view-tabs|zh-tabs|pane-empty|notes-meta-empty|project-overview|project-list-[a-z]+|notes-page|notes-layout|notes-sidebar|notes-meta|notes-main|notes-stats)(?![\w-])/;
check(!deprecatedClasses.test(stylesCss), "styles.css · 旧外壳 / 旧 tab / 旧空态类已下线");
check(!/border-radius:[^;}]*\b(?:7|9|11|12|13)px\b/.test(stylesCss), "styles.css · 圆角只用 token（6 / 10 / 14）");
check(stylesCss.includes("--page-gutter:24px") && !/\.wide>\.page\{[^}]*margin:0 auto/.test(stylesCss), "styles.css · 左侧留白统一 --page-gutter，页面左对齐");

check(read("AGENTS.md").includes("一个区域只有一行 chrome") && designDoc.includes("### 一行 chrome"),
  "AGENTS / DESIGN-SYSTEM · 一个区域只有一行 chrome");

const deprecatedInTsx = [];
for (const file of walkTsx("src")) {
  if (deprecatedClasses.test(fs.readFileSync(path.join(root, file), "utf8"))) deprecatedInTsx.push(file);
}
check(deprecatedInTsx.length === 0, `组件不得再用旧外壳 / 旧 tab / 旧空态类${deprecatedInTsx.length ? "：" + deprecatedInTsx.join("、") : ""}`);

/**
 * 一个区域一行 chrome：终端区曾经是「工具栏 40px + 标签栏 34px」两行，
 * 那一层工具栏的类（品牌字 / 视图切换 / 图标按钮 / 字号 chip / 打开项目）已经从终端区下线，
 * 不允许悄悄长回来 —— 新入口进菜单 / 右键 / 快捷键（见 DESIGN-SYSTEM §5「一行 chrome」）。
 */
const deadChrome = /\.(?:terminal-bar|term-brand|term-slots?-switch|term-slot-body|term-icon-btn|term-zoom-chip|term-pane-count)(?![\w-])/;
const chromeLeaks = walkTsx("src").filter((file) => deadChrome.test(fs.readFileSync(path.join(root, file), "utf8")));
check(!deadChrome.test(stylesCss) && chromeLeaks.length === 0,
  `区域头不得再叠一行工具栏（旧类已下线）${chromeLeaks.length ? "：" + chromeLeaks.join("、") : ""}`);

/**
 * 计数不挂在 tab / 图标 / 标题上（DESIGN-SYSTEM §5「计数与徽标」）。
 * 会话历史 tab 曾挂过 `5`，机器人「待处理」tab 挂过角标——总数属于列表和概览，
 * 导航上多一个数就是噪音，而且 `title` 里再补一遍会变成读屏噪音。
 */
const deadCounts = /\.(?:tab-count|tab-count-inline|icon-tab-count|bot-tab-count)(?![\w-])/;
const countLeaks = walkTsx("src").filter((file) => deadCounts.test(fs.readFileSync(path.join(root, file), "utf8")));
check(!deadCounts.test(stylesCss) && countLeaks.length === 0,
  `计数不挂在 tab / 图标 / 标题上（旧计数类已下线）${countLeaks.length ? "：" + countLeaks.join("、") : ""}`);
check(designDoc.includes("### 计数与徽标（数字）") && read("AGENTS.md").includes("数字不挂在 tab / 图标 / 标题上"),
  "AGENTS / DESIGN-SYSTEM · 计数与徽标约束");

/**
 * Electron 不实现 window.prompt：调用它不会弹任何东西，点了就是"没反应"。
 * 这条规则是踩出来的——Bot 页的「新建 bot / 新增日程」、Git 的「新建分支」、
 * Mission 的「退回修改」都因此静默失效过。新建/重命名一律用行内输入。
 */
const offenders = [];
const glyphClosers = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const code = read(rel);
      if (/window\.prompt\s*\(/.test(code)) offenders.push(rel);
      // 开合控件：不许用 × / ✕ 字符或裸文字当关闭（用 XIcon / ChevronDown）
      if ((/>\s*(?:×|✕)\s*<\/button>/).test(code) || (/>\s*(?:收起|展开|关闭)\s*<\/button>/).test(code)) glyphClosers.push(rel);
    }
  }
};
walk("src");
check(offenders.length === 0, `src 里不得用 window.prompt（Electron 不实现）${offenders.length ? "：" + offenders.join("、") : ""}`);
check(glyphClosers.length === 0, `开合控件不得用字符 / 裸文字（用 XIcon / ChevronDown）${glyphClosers.length ? "：" + glyphClosers.join("、") : ""}`);

// 图标行（docs/DESIGN-SYSTEM.md「图标行」）：20px 点击区 + 1–2px 缝 + 靠右成组
check(design.includes("--icon-size:20px") && design.includes("--icon-gap:2px"), "design-system.css · 图标行 token");
check(!/\.(icon-btn|preview-icon|zh-zoom-btn|pane-add|pane-collapse)\{[^}]*width:\s*(?:1[5-9]|2[1-9]|[3-9]\d)px/.test(stylesCss), "styles.css · 图标按钮一律 --icon-size（20px）");
check(/\.project-panel-actions\{[^}]*gap:var\(--icon-gap\)/.test(stylesCss), "styles.css · 图标行用 --icon-gap 收缝");
check(designDoc.includes("### 图标行（icon cluster）"), "DESIGN-SYSTEM.md · 图标行规则");
check(designDoc.includes("字形只有三档"), "DESIGN-SYSTEM.md · 字形三档（15 / 11–12 / 19）");
check(/\.pane-actions svg[^{]*\{[^}]*width:15px/.test(stylesCss), "styles.css · 界面图标统一 15px（pane-actions）");
check(/\.right-tabs \.icon-tab svg[^{]*\{[^}]*width:15px/.test(stylesCss), "styles.css · 标签页图标与工具栏同号（15px）");
check(!/\.pane-(?:collapse|add)\{[^}]*width:\s*(?:1[5-9]|2[1-9]|[3-9]\d)px/.test(stylesCss), "styles.css · pane 图标与图标行同尺寸（--icon-size）");
// 字符当图标：＋ / − 不许出现在按钮内容里（× 允许：宽 × 高、报表里是文字排版）
const componentFiles = walkTsx("src/components");
const glyphLeaks = [];
for (const file of componentFiles) {
  const body = read(file);
  if (/>\s*[＋−]\s*</.test(body)) glyphLeaks.push(file);
}
check(glyphLeaks.length === 0, `组件里不得用字符 ＋ / − 当图标（${glyphLeaks.join(", ") || "ok"}）`);
// 列表稳定性（AGENTS.md 第 19 条）：项目列表默认固定排序，且展开态不跟随「当前项目」
const taskPaneSrc = read("src/components/TaskPane.tsx");
check(taskPaneSrc.includes('sort: "manual"'), "TaskPane · 项目列表默认固定排序（不得默认最近活动）");
check(!/expandedProjects\[p\.id\] \?\? p\.id === state\.activeProjectId/.test(taskPaneSrc), "TaskPane · 展开态不得跟随当前项目");

const actionGlyphLeaks = componentFiles.filter((file) => /EllipsisIcon size=\{14\}/.test(read(file)));
check(actionGlyphLeaks.length === 0, `动作图标不得用 14px（${actionGlyphLeaks.join(", ") || "ok"}）`);

const iconGroups = ["pane-actions", "project-panel-actions", "explorer-actions", "term-strip-actions"];
const gapRules = stylesCss.split("\n").filter((line) => line.includes("gap:var(--icon-gap)"));
for (const group of iconGroups) {
  check(gapRules.some((line) => line.includes(`.${group}`)), `styles.css · .${group} 图标间距用 --icon-gap`);
}

/**
 * 视觉收敛的硬指标（docs/DESIGN-SYSTEM.md §3）：字号 / 间距 / 圆角 / 裸色值都要在栅格上。
 * 加这些检查是为了防止"再加一个 12.5px / 9px padding / 5px 圆角"把层次重新搅乱。
 */
const cssText = read("src/styles.css");
const fontSizes = new Set([...cssText.matchAll(/font-size:([0-9.]+)px/g)].map((m) => m[1]));
const allowedFont = new Set(["22", "18", "15", "13", "12", "11", "10.5"]);
check(fontSizes.size <= 7 && [...fontSizes].every((v) => allowedFont.has(v)),
  `styles.css · 字号只用 7 档（${[...fontSizes].sort().join(" / ")}）`);
const spaceValues = new Set([...cssText.matchAll(/(?:padding|margin|gap|row-gap|column-gap):([^;}]+)/g)]
  .flatMap((m) => [...m[1].matchAll(/([0-9]+)px/g)].map((x) => x[1])));
const allowedSpace = new Set(["0", "2", "4", "6", "8", "12", "16", "24", "32", "48"]);
check([...spaceValues].every((v) => allowedSpace.has(v)),
  `styles.css · 间距只用 2/4/6/8/12/16/24/32（越界：${[...spaceValues].filter((v) => !allowedSpace.has(v)).join(",") || "无"}）`);
const radii = new Set([...cssText.matchAll(/border-radius:([^;}]+)/g)].map((m) => m[1].trim()));
const badRadius = [...radii].filter((v) => !/^(0|50%|999px|var\(--radius[\w-]*\)|calc\(var\(--radius\) \+ \d+px\)|var\(--radius-sm\) [\d ]+px [\d ]+px|0 0 var\(--radius\) var\(--radius\))$/.test(v) && /[0-9]+px/.test(v) && !/(var\(--radius)/.test(v));
check(badRadius.length === 0, `styles.css · 圆角只用 6/10/14/999（越界：${badRadius.slice(0, 4).join(" | ") || "无"}）`);
// token 定义里的 hex 是调色板本身；这里只数「属性值里直接写颜色」的情况
const declHex = new Set();
for (const m of cssText.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+)/g)) {
  if (m[1].startsWith("--")) continue;
  for (const h of m[2].matchAll(/#[0-9a-fA-F]{3,8}/g)) declHex.add(h[0].toLowerCase());
}
check(declHex.size <= 60, `styles.css · 属性值里的裸色值 ≤60（现在 ${declHex.size}：${[...declHex].slice(0, 5).join(",")}）`);
// 上一版检查跳过了 `--*`，于是 --ds-send-bg:#416ee6 这类一次性颜色一直藏在自定义属性里
const dsBareHex = [...cssText.matchAll(/(--ds-[a-z-]+)\s*:\s*([^;}]+)/g)]
  .filter((m) => /#[0-9a-fA-F]{3,8}/.test(m[2]) || /\b(?:rgba?|hsla?)\(/.test(m[2]))
  .map((m) => m[1]);
check(dsBareHex.length === 0, `styles.css · --ds-* 只吃调色板 token，不写裸色值（越界：${dsBareHex.slice(0, 4).join(",") || "无"}）`);
// 图标行：点击区 20px（--icon-size），聊天里的动作按钮也算
const wideDsAction = [...cssText.matchAll(/\.ds-action\{([^}]*)\}/g)]
  .filter((m) => {
    const w = m[1].match(/width:([0-9]+)px/);
    const h = m[1].match(/height:([0-9]+)px/);
    return (w && Number(w[1]) > 20) || (h && Number(h[1]) > 20);
  });
check(wideDsAction.length === 0, `styles.css · .ds-action 点击区 ≤20px（--icon-size）；现在 ${wideDsAction.length} 处越界`);
// 字符当图标：聊天两个组件里不许再出现 ＋ × ✕ ⌄ ↻ ▦ ☰ ← → 当图标
const CHAT_FILES = ["src/components/Bot.tsx", "src/components/TaskChat.tsx"];
const charIcons = CHAT_FILES.filter((f) => /<[a-z][^>]*>\s*[＋×✕⌄⌃↻▦☰←→]\s*<\//.test(read(f)) || />\s*[＋×✕⌄⌃↻▦☰←→]\s*[^<{]*</.test(read(f)));
check(charIcons.length === 0, `聊天组件 · 不用字符当图标（缺图标先补 Icons.tsx）：${charIcons.join("、") || "ok"}`);
const bodyFont = cssText.includes("font-size:13px");
check(bodyFont, "styles.css · 正文字号 13px 存在（11–12.5 不再承担正文）");

// 本轮收敛的硬约束（防止回退）
check(!/\.btn\.tiny-btn/.test(cssText), "styles.css · 旧别名 .btn.tiny-btn 已下线");
check(!/--radius-(card|control|float)\b/.test(cssText), "styles.css · 圆角只留 sm / radius / lg（chat 两例外）");
check(!/z-index:\s*\d/.test(cssText), "styles.css · z-index 只走 --z-* 层级表");
check(!/letter-spacing:\s*\.0[48]/.test(cssText) && !/letter-spacing:\s*\.12/.test(cssText), "styles.css · letter-spacing 只留 0 / .02 / .06 / -.02");
const pageHeads = walkTsx("src/components").filter((f) => f !== "src/components/PageHeader.tsx" && /<h[12][ >]/.test(fs.readFileSync(path.join(root, f), "utf8")));
check(pageHeads.length === 0, `组件里不得自己写 h1/h2（${pageHeads.slice(0, 3).join("、") || "ok"}）`);
let borderShadow = 0;
for (const m of cssText.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim(); const body = m[2];
  if (/float|modal|menu|pop|toast|tooltip|dialog|drawer|peek|banner/i.test(sel)) continue;
  if (/border(?:-top|-right|-bottom|-left)?\s*:\s*[0-9.]+px solid/.test(body) && /box-shadow:\s*(?!none)/.test(body)) borderShadow += 1;
}
check(borderShadow === 0, `styles.css · 带描边的块不再叠阴影（剩余 ${borderShadow}）`);
check((cssText.match(/>×</g) || []).length === 0, "styles.css · 不用字符 × 当图标");

// ── 三个样式文件统一口径（styles / design-system / wiki）──────────────────
const allFonts = new Set([...allCss.matchAll(/font-size:([0-9.]+)px/g)].map((m) => m[1]));
const uiFonts = new Set(["22", "18", "15", "13", "12", "11", "10.5"]);
const wikiFonts = new Set(["26", "20", "16", "14", "13", "12", "11", "10.5"]);
const wikiOnly = new Set([...read("src/wiki.css").matchAll(/font-size:([0-9.]+)px/g)].map((m) => m[1]));
const uiOnly = new Set([...read("src/styles.css").matchAll(/font-size:([0-9.]+)px/g)].map((m) => m[1]));
const dsOnly = new Set([...read("src/design-system.css").matchAll(/font-size:([0-9.]+)px/g)].map((m) => m[1]));
check([...uiOnly, ...dsOnly].every((v) => uiFonts.has(v)), `styles+design-system · 字号只用 UI 七档（越界：${[...uiOnly, ...dsOnly].filter((v) => !uiFonts.has(v)).join(",") || "无"}）`);
check([...wikiOnly].every((v) => wikiFonts.has(v)), `wiki.css · 阅读页字号只用八档（越界：${[...wikiOnly].filter((v) => !wikiFonts.has(v)).join(",") || "无"}）`);

const allHexDecl = new Set();
for (const m of allCss.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+)/g)) {
  if (m[1].startsWith("--")) continue;
  for (const h of m[2].matchAll(/#[0-9a-fA-F]{3,8}/g)) allHexDecl.add(h[0].toLowerCase());
}
check(allHexDecl.size <= 60, `三个 css · 属性值裸色值 ≤60（现在 ${allHexDecl.size}）`);
check(!/box-shadow:inset [0-9]+px 0 0 var\(--/.test(allCss), "三个 css · 选中态不再画白条/色条（用底色）");
check(!/z-index:\s*\d/.test(allCss), "三个 css · z-index 只走 --z-* 层级表");
check(!/letter-spacing:\s*\.0[48]|letter-spacing:\s*\.1[26]/.test(allCss), "三个 css · letter-spacing 只留 0 / .02 / .06 / -.02");
const spaceAll = new Set([...allCss.matchAll(/(?:padding|margin|gap|row-gap|column-gap):([^;}]+)/g)]
  .flatMap((m) => [...m[1].matchAll(/([0-9]+)px/g)].map((x) => x[1])));
const allowedSpaceAll = new Set(["0", "1", "2", "3", "4", "6", "8", "12", "16", "24", "32", "48", "64"]);
check([...spaceAll].every((v) => allowedSpaceAll.has(v)), `三个 css · 间距在栅格上（越界：${[...spaceAll].filter((v) => !allowedSpaceAll.has(v)).join(",") || "无"}）`);

/**
 * 数字不挂在 chrome 上（DESIGN-SYSTEM §5「计数与徽标」）。
 * 只认「容器类名带 bar/head/tabs/rail/toolbar/pane-actions」且子节点里出现 `{n} 条/页/个/项` 的写法。
 * 列表行尾、概览、菜单、进度里的数字不算 —— 这些类名在 allow 里。
 */
const CHROME_SEL = /className="[^"]*(?:bar\b|head\b|tabs?\b|rail\b|title-row|toolbar|pane-actions)[^"]*"/;
const COUNT_ALLOW = /list-head|menu|overview|stat|progress|peek|hint|note|empty/i;
const COUNT_RE = /\}[^<>{}]{0,8}(条|页|个|项)\s*</;
const chromeCountHits = [];
for (const file of walkTsx("src")) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!CHROME_SEL.test(lines[i]) || COUNT_ALLOW.test(lines[i])) continue;
    for (let j = i; j < Math.min(i + 8, lines.length); j++) {
      if (COUNT_RE.test(lines[j]) && !COUNT_ALLOW.test(lines[j])) {
        chromeCountHits.push(`${file}:${j + 1}`);
        break;
      }
    }
  }
}
check(chromeCountHits.length === 0, `数字不得挂在 bar/head/tabs/rail 上（${chromeCountHits.slice(0, 3).join("、") || "ok"}）`);

for (const item of checks) console.log(`${item.ok ? "✓" : "✗"} ${item.label}`);
console.log(`\nDesign verification: ${process.exitCode ? "failed" : "passed"}`);
