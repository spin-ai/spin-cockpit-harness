/**
 * P0 验收用例：只覆盖不依赖真实模型/长流程、可在隔离 userData 中稳定执行的部分。
 * 其余在 TEST-REQ-modules-original.md 中保留为手工 / 待优化后接入。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const THEMES = ["system", "light", "paper", "vslight", "dark", "vsdark", "midnight", "forest", "graphite", "monokai", "onedark", "solarized", "dracula"];
const DARK_THEMES = new Set(["dark", "vsdark", "midnight", "forest", "graphite", "monokai", "onedark", "solarized", "dracula"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeProject(ctx, name, files = {}, git = false) {
  const dir = path.join(ctx.tmp, "projects", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  if (git) {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "E2E"], { cwd: dir });
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  }
  return dir;
}

async function openWorkspace(ctx) {
  await ctx.ev(`window.__e2e.rail("工作区") && window.__e2e.click(window.__e2e.rail("工作区")); true`);
  await ctx.sleep(350);
}

export const TESTS = [
  {
    id: "APP-01",
    group: "APP",
    title: "应用启动：state / settings / host 就绪",
    async fn(ctx) {
      const s = await ctx.state();
      assert(s && s.settings, "state/settings 未就绪");
      assert(Array.isArray(s.hosts) && s.hosts.length >= 1, "host 未探测");
      assert(typeof s.appVersion === "string" && s.appVersion.length > 0, "appVersion 缺失");
      assert(Array.isArray(s.projects), "projects 缺失");
    },
  },
  {
    id: "LY-01",
    group: "LAYOUT",
    title: "五列布局：Chat 收起 / 展开",
    async fn(ctx) {
      await openWorkspace(ctx);
      const collapsed = await ctx.ev(`(()=>{
        const btn=[...document.querySelectorAll(".pane-collapse")].find(b=>(b.getAttribute("title")||"").includes("Chat"));
        if(!btn) return false;
        window.__e2e.click(btn);
        return true;
      })()`);
      assert(collapsed, "找不到 Chat 收起按钮");
      await ctx.sleep(250);
      assert(await ctx.ev(`[...document.querySelectorAll(".collapsed-pane")].some(e=>e.textContent.includes("CHAT"))`), "Chat 未收起");
      await ctx.ev(`(()=>{const el=[...document.querySelectorAll(".collapsed-pane")].find(e=>e.textContent.includes("CHAT")); if(el) window.__e2e.click(el); return true;})()`);
      await ctx.sleep(300);
      assert(await ctx.ev(`!!document.querySelector(".chat-pane")`), "Chat 未展开");
    },
  },
  {
    id: "THEME-01",
    group: "THEME",
    title: "13 套主题：data-theme / data-mode / 终端配色",
    async fn(ctx) {
      for (const theme of THEMES) {
        await ctx.action("setSettings", { theme });
        await ctx.sleep(120);
        const r = await ctx.ev(`(()=>{
          const root=document.documentElement;
          const cs=getComputedStyle(root);
          const pane=document.querySelector(".terminal-pane");
          return {
            theme: root.dataset.theme,
            mode: root.dataset.mode,
            termBg: cs.getPropertyValue("--term-bg").trim(),
            paneBg: pane ? getComputedStyle(pane).backgroundColor : "",
          };
        })()`);
        if (theme === "system") {
          assert(["light", "dark"].includes(r.theme), `system 解析异常: ${JSON.stringify(r)}`);
          assert(r.theme === r.mode, `system data-mode 不一致: ${JSON.stringify(r)}`);
        } else {
          assert(r.theme === theme, `主题未生效: ${theme} → ${r.theme}`);
          assert(r.mode === (DARK_THEMES.has(theme) ? "dark" : "light"), `data-mode 错误: ${theme} → ${r.mode}`);
        }
        assert(r.termBg, `终端 --term-bg 为空: ${theme}`);
        assert(r.paneBg, `终端背景为空: ${theme}`);
      }
      await ctx.action("setSettings", { theme: "system" });
    },
  },
  {
    id: "SET-01",
    group: "SETTINGS",
    title: "设置即时生效：Chat 字号 + CSS 变量",
    async fn(ctx) {
      await ctx.action("setSettings", { chatFontSize: 15 });
      await ctx.sleep(150);
      const s = await ctx.state();
      assert(s.settings.chatFontSize === 15, `state 字号=${s.settings.chatFontSize}`);
      const size = await ctx.ev(`getComputedStyle(document.documentElement).getPropertyValue("--chat-font-size").trim()`);
      assert(size === "15px", `CSS 字号=${size}`);
      await ctx.action("setSettings", { chatFontSize: 13 });
    },
  },
  {
    id: "PALETTE-01",
    group: "LAYOUT",
    title: "命令面板：搜索主题并切换",
    async fn(ctx) {
      await ctx.ev(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true})); true`);
      await ctx.sleep(250);
      assert(await ctx.ev(`!!document.querySelector(".palette-input")`), "命令面板未打开");
      await ctx.ev(`(()=>{const i=document.querySelector(".palette-input"); window.__e2e.setValue(i,"主题"); return true;})()`);
      await ctx.sleep(250);
      const labels = await ctx.ev(`[...document.querySelectorAll(".palette-item")].map(b=>b.textContent)`);
      assert(labels.some((l) => l.includes("主题")), `没有主题命令: ${labels.slice(0, 5).join(" | ")}`);
      const clicked = await ctx.ev(`(()=>{
        const b=[...document.querySelectorAll(".palette-item")].find(x=>x.textContent.includes("森林"));
        if(!b) return false; window.__e2e.click(b); return true;
      })()`);
      assert(clicked, "没有森林主题命令");
      await ctx.sleep(250);
      const s = await ctx.state();
      assert(s.settings.theme === "forest", `主题=${s.settings.theme}`);
      await ctx.action("setSettings", { theme: "system" });
    },
  },
  {
    id: "GIT-01",
    group: "GIT",
    title: "Git → 项目 Wiki：页面 / 目录 / 图片",
    async fn(ctx) {
      await ctx.ev(`window.__e2e.click(window.__e2e.rail("Git")); true`);
      await ctx.sleep(500);
      assert(await ctx.ev(`!!document.querySelector(".git-view-tabs")`), "Git tabs 未渲染");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".git-view-tabs button")].find(x=>x.textContent.includes("Wiki")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(450);
      const r = await ctx.ev(`(()=>({
        pages: document.querySelectorAll(".git-wiki-link").length,
        title: document.querySelector(".git-wiki-page-head h1")?.textContent || "",
        toc: document.querySelectorAll(".git-wiki-toc-link").length,
        imgs: [...document.querySelectorAll(".git-wiki-markdown img")].map(i=>({complete:i.complete,w:i.naturalWidth})),
      }))()`);
      assert(r.pages >= 9, `Wiki 页面数=${r.pages}`);
      assert(r.title.length > 0, "Wiki 标题为空");
      assert(r.toc > 0, "Wiki 目录为空");
      assert(r.imgs.length > 0 && r.imgs.every((i) => i.complete && i.w > 0), `Wiki 图片未加载: ${JSON.stringify(r.imgs)}`);
    },
  },
  {
    id: "GIT-02",
    group: "GIT",
    title: "项目 Wiki：搜索 + 页间链接",
    async fn(ctx) {
      await ctx.ev(`window.__e2e.click(window.__e2e.rail("Git")); true`);
      await ctx.sleep(350);
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".git-view-tabs button")].find(x=>x.textContent.includes("Wiki")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(350);
      await ctx.ev(`(()=>{const i=document.querySelector(".git-wiki-search"); if(i) window.__e2e.setValue(i,"主题"); return true;})()`);
      await ctx.sleep(250);
      assert(await ctx.ev(`[...document.querySelectorAll(".git-wiki-link")].some(b=>b.textContent.includes("主题"))`), "Wiki 搜索没命中主题页");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".git-wiki-link")].find(x=>x.textContent.includes("主题")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(350);
      assert((await ctx.ev(`document.querySelector(".git-wiki-page-head h1")?.textContent`)) === "主题系统", "主题页未打开");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".git-wiki-link")].find(x=>x.textContent.includes("项目介绍")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(300);
      const linked = await ctx.ev(`(()=>{const a=document.querySelector('.git-wiki-markdown a[href="#/wiki/architecture"]'); if(!a) return false; window.__e2e.click(a); return true;})()`);
      assert(linked, "首页没有指向架构的页间链接");
      await ctx.sleep(300);
      assert((await ctx.ev(`document.querySelector(".git-wiki-page-head h1")?.textContent`)) === "架构", "页间链接未跳转");
    },
  },
  {
    id: "PJ-01",
    group: "PROJECT",
    title: "项目：添加 / 切换 / 唯一别名",
    async fn(ctx) {
      const dir = makeProject(ctx, "alpha", { "README.md": "# Alpha\n\nalpha-body\n" }, true);
      await ctx.action("addProject", { path: dir, name: "E2E Alpha" });
      await ctx.sleep(450);
      const s = await ctx.state();
      const project = s.projects.find((p) => p.path === dir);
      assert(project, "项目未添加");
      assert(project.alias && project.alias.length > 0, "项目别名缺失");
      await ctx.action("switchProject", { id: project.id });
      await ctx.sleep(350);
      const s2 = await ctx.state();
      assert(s2.activeProjectId === project.id, "项目未切换");
      await openWorkspace(ctx);
    },
  },
  {
    id: "FILES-01",
    group: "FILES",
    title: "文件树跟随项目 + 打开文本预览",
    async fn(ctx) {
      const dir = makeProject(ctx, "files", { "README.md": "# Files\n\nfile-body\n" }, false);
      await ctx.action("addProject", { path: dir, name: "E2E Files" });
      await ctx.sleep(450);
      await openWorkspace(ctx);
      const row = await ctx.ev(`(async()=>{
        const {until}=window.__e2e;
        const r=await until(()=>[...document.querySelectorAll(".tree-row")].find(x=>x.textContent.includes("README.md")));
        if(!r) return false; window.__e2e.click(r); return true;
      })()`);
      assert(row, "文件树没有 README.md");
      await ctx.sleep(700);
      const text = await ctx.ev(`document.body.innerText`);
      assert(text.includes("file-body") || text.includes("Files"), "文件预览未显示内容");
    },
  },
  {
    id: "WIKI-01",
    group: "WIKI",
    title: "Notes：打开 Wiki、创建页面、编辑器就绪",
    async fn(ctx) {
      await ctx.ev(`window.__e2e.click(window.__e2e.rail("笔记")); true`);
      await ctx.sleep(600);
      assert(await ctx.ev(`!!document.querySelector(".notes-page")`), "Wiki 页面未打开");
      assert(await ctx.ev(`document.querySelectorAll(".notes-wiki-tabs button").length >= 3`), "Wiki tabs 不完整");
      await ctx.ev(`window.prompt=()=> "E2E Wiki Page"; true`);
      await ctx.ev(`(()=>{const b=document.querySelector(".notes-tab-add"); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(900);
      const r = await ctx.ev(`(()=>({
        title: document.querySelector(".notes-title-input")?.value || "",
        editor: !!document.querySelector(".cm-content"),
        toolbar: !!document.querySelector(".notes-editor-toolbar"),
      }))()`);
      assert(r.title.includes("E2E Wiki Page"), `新页面标题=${r.title}`);
      assert(r.editor, "CodeMirror 编辑器未就绪");
      assert(r.toolbar, "编辑器工具栏未渲染");
    },
  },
  {
    id: "AGENT-01",
    group: "AGENT",
    title: "执行适配器矩阵 + 不支持 CLI 明确报错",
    async fn(ctx) {
      const s = await ctx.state();
      const dsh = (s.executors || []).find((e) => e.id === "dsh");
      const pi = (s.executors || []).find((e) => e.id === "pi");
      assert(dsh?.implemented === true, "dsh executor 未实现");
      assert(pi && pi.implemented === false, "pi 不应能从 Chat 派活");
      const r = await ctx.ev(`(async()=>{try{await window.harness.action("createAgent",{cli:"pi"});return {ok:true};}catch(e){return {ok:false,error:String(e.message||e)};}})()`);
      assert(r.ok === false && /适配器/.test(r.error || ""), `pi 没有明确报错: ${JSON.stringify(r)}`);
    },
  },
  {
    id: "SC-01",
    group: "SCENE",
    skip: "场景工作台尚未实现（GAP-requirements）",
    title: "场景总览：项目 / 终端 / 配置",
  },
  {
    id: "TK-01",
    group: "TASK",
    skip: "需要稳定的 run 夹具；等并行优化完成后接 fake ACP",
    title: "TODO 4 组 / badge / 等待输入置顶",
  },
  {
    id: "CH-02",
    group: "CHAT",
    skip: "需要 fake ACP 保持 running；等优化完成后接入",
    title: "纠偏回执 pending → injected / failed",
  },
  {
    id: "PV-06",
    group: "PREVIEW",
    skip: "需要 dev server / 多预览夹具；先保留手工用例",
    title: "预览浏览器控制 / 设备宽度 / 多预览",
  },
  {
    id: "WK-06",
    group: "WIKI",
    skip: "自动保存/回收站需配合插件写完；当前先覆盖打开与编辑",
    title: "Wiki 自动保存 / 失败保留 / 回收站",
  },
  {
    id: "WT-01",
    group: "WORKTREE",
    skip: "需要 git run 夹具；等 worktree 策略落地后接入",
    title: "worktree 分支 / 路径展示",
  },
  {
    id: "E2E-01",
    group: "E2E",
    skip: "依赖真实 ACP 模型与长流程；保留为手工 E2E",
    title: "多项目 × 多 Agent 全链路",
  },
  {
    id: "E2E-03",
    group: "E2E",
    skip: "Mission 长流程；保留为手工 E2E",
    title: "Mission 计划审批 → 子任务 → 确认",
  },
  {
    id: "E2E-05",
    group: "E2E",
    skip: "Wiki 生成/审核长流程；保留为手工 E2E",
    title: "Source → Draft → Review → 搜索/提问",
  },
];
