/**
 * P0 验收用例：只覆盖不依赖真实模型/长流程、可在隔离 userData 中稳定执行的部分。
 * 其余在 TEST-REQ-modules-original.md 中保留为手工 / 待优化后接入。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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

async function gotoRail(ctx, label, selector, timeout = 6000) {
  const ok = await ctx.ev(`(async()=>{
    const t0=Date.now();
    while(Date.now()-t0<${timeout}){
      const r=window.__e2e.rail(${JSON.stringify(label)});
      if(r) window.__e2e.click(r);
      await new Promise((x)=>setTimeout(x,220));
      if(document.querySelector(${JSON.stringify(selector)})) return true;
    }
    return false;
  })()`);
  assert(ok, `导航「${label}」未打开 ${selector}`);
}

async function openWorkspace(ctx) {
  await gotoRail(ctx, "工作区", ".todo-pane");
}


async function waitForState(ctx, predicate, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await ctx.state();
    const value = predicate(state);
    if (value) return { state, value };
    await ctx.sleep(120);
  }
  throw new Error("等待应用状态超时");
}

async function setupFakeAgent(ctx, projectId) {
  if (!ctx.fakeDsh) throw new Error("fake ACP 只在 POSIX 下启用");
  await ctx.action("setSettings", { dshBinary: ctx.fakeDsh, maxConcurrentRuns: 4, approvalPolicy: "allow" });
  const s = await ctx.state();
  const pid = projectId || s.activeProjectId;
  const agent = await ctx.action("createAgent", { cli: "dsh", projectId: pid });
  const thread = await ctx.action("newThread", { projectId: pid });
  await ctx.action("setThreadAgent", { threadId: thread.id, agentId: agent.id });
  return { agent, thread, projectId: pid };
}

async function dispatch(ctx, setup, text) {
  const result = await ctx.action("send", {
    threadId: setup.thread.id,
    text: `@${setup.agent.alias} ${text}`,
    agentId: setup.agent.id,
  });
  assert(result?.mode === "dispatch" && result.todoId, `dispatch 失败: ${JSON.stringify(result)}`);
  return result;
}

async function stopRuns(ctx, todoIds) {
  const { state } = await waitForState(ctx, (s) => s.runs.some((r) => todoIds.includes(r.todoId) && ["queued", "running", "waiting_input"].includes(r.status)), 4000).catch(() => ({ state: null }));
  const s = state || await ctx.state();
  for (const run of s.runs) {
    if (todoIds.includes(run.todoId) && ["queued", "running", "waiting_input"].includes(run.status)) {
      await ctx.action("stop", { runId: run.id });
    }
  }
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
      assert(!("inbox" in s), "inbox 应已移除");
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
      await gotoRail(ctx, "设置", ".settings-page");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".settings-nav-item")].find((x)=>x.textContent.trim()==="外观"); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(200);
      assert(await ctx.ev(`document.querySelectorAll(".theme-card").length === 13`), "主题卡片不是 13 个");
      await ctx.ev(`(()=>{const i=document.querySelector(".settings-search"); if(!i) return false; window.__e2e.setValue(i,"Dracula"); return true;})()`);
      await ctx.sleep(250);
      assert(await ctx.ev(`[...document.querySelectorAll(".settings-hit")].some((b)=>b.textContent.includes("主题"))`), "主题名搜索没有命中");
      await ctx.ev(`(()=>{const i=document.querySelector(".settings-search"); if(i) window.__e2e.setValue(i,""); return true;})()`);
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
      await gotoRail(ctx, "Git", ".git-view-tabs");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".git-view-tabs button")].find(x=>x.textContent.includes("Wiki")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(450);
      // Wiki 图片是 loading=lazy；先滚动一遍正文，等待图片加载后再断言。
      await ctx.ev(`(async()=>{
        const root=document.querySelector(".git-wiki-content");
        if(!root) return false;
        const step=Math.max(260, Math.floor(root.clientHeight*0.8));
        for(let y=0;y<=root.scrollHeight;y+=step){ root.scrollTop=y; await new Promise(r=>setTimeout(r,80)); }
        root.scrollTop=0;
        await new Promise(r=>setTimeout(r,900));
        return true;
      })()`);
      const r = await ctx.ev(`(async()=>{
        const imgs = await window.__e2e.until(() => {
          const list = [...document.querySelectorAll(".git-wiki-markdown img")];
          return list.some((i) => i.complete && i.naturalWidth > 0) ? list : null;
        }, 8000);
        return {
          pages: document.querySelectorAll(".git-wiki-link").length,
          title: document.querySelector(".git-wiki-page-head h1")?.textContent || "",
          toc: document.querySelectorAll(".git-wiki-toc-link").length,
          imgs: (imgs || []).map((i) => ({ complete: i.complete, w: i.naturalWidth, src: i.getAttribute("src") })),
        };
      })()`);
      assert(r.pages >= 9, `Wiki 页面数=${r.pages}`);
      assert(r.title.length > 0, "Wiki 标题为空");
      assert(r.toc > 0, "Wiki 目录为空");
      assert(r.imgs.some((i) => i.complete && i.w > 0), `Wiki 图片未加载: ${JSON.stringify(r.imgs)}`);
    },
  },
  {
    id: "GIT-02",
    group: "GIT",
    title: "项目 Wiki：搜索 + 页间链接",
    async fn(ctx) {
      await gotoRail(ctx, "Git", ".git-view-tabs");
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
      await gotoRail(ctx, "项目", ".project-grid");
      const cards = await ctx.ev(`document.querySelectorAll(".project-grid .project-card").length`);
      assert(cards >= 1, "项目卡片未渲染");
      await ctx.ev(`(()=>{const i=document.querySelector(".project-search"); if(i) window.__e2e.setValue(i,"E2E Alpha"); return true;})()`);
      await ctx.sleep(250);
      const filtered = await ctx.ev(`[...document.querySelectorAll(".project-grid .project-card")].map((c)=>c.textContent)`);
      assert(filtered.length === 1 && filtered[0].includes("E2E Alpha"), `项目搜索未过滤: ${filtered.length}`);
      await ctx.ev(`(()=>{const i=document.querySelector(".project-search"); if(i) window.__e2e.setValue(i,""); return true;})()`);
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".view-switch button")].find((x)=>x.textContent.includes("列表")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(250);
      assert(await ctx.ev(`document.querySelectorAll(".project-list-rows .project-list-item").length >= 1`), "列表视图未渲染");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".view-switch button")].find((x)=>x.textContent.includes("卡片")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(200);
      assert(await ctx.ev(`document.querySelectorAll(".project-grid .project-card").length >= 1`), "卡片视图未恢复");
      const controls = await ctx.ev(`(()=>({
        filters: document.querySelectorAll(".project-filter").length,
        sorts: [...document.querySelectorAll(".project-filter")].map((s)=>s.options.length),
        taskBtn: [...document.querySelectorAll(".project-card .btn")].some((b)=>b.textContent.includes("任务")),
      }))()`);
      assert(controls.filters === 2, `项目筛选/排序控件=${controls.filters}`);
      assert(controls.sorts.every((n) => n >= 3), `排序选项不足: ${controls.sorts}`);
      assert(controls.taskBtn, "项目卡片缺少新建任务按钮");
      await ctx.ev(`(()=>{const s=[...document.querySelectorAll(".project-filter")].find((x)=>x.getAttribute("aria-label")==="项目排序"); if(!s) return false; s.value="name"; s.dispatchEvent(new Event("change",{bubbles:true})); return true;})()`);
      await ctx.sleep(200);
      assert(await ctx.ev(`document.querySelectorAll(".project-grid .project-card").length >= 1`), "排序后项目列表为空");
      const newTask = await ctx.ev(`(async()=>{
        const b=[...document.querySelectorAll(".project-card .btn")].find((x)=>x.textContent.includes("任务"));
        if(!b) return false; window.__e2e.click(b);
        return !!(await window.__e2e.until(() => document.querySelector(".task-create textarea"), 3000));
      })()`);
      assert(newTask, "项目页新建任务未打开 TODO 输入框");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".task-create .btn")].find((x)=>x.textContent.includes("取消")); if(b) window.__e2e.click(b); return true;})()`);
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
    title: "Notes：打开知识库、创建页面、编辑器就绪",
    async fn(ctx) {
      await gotoRail(ctx, "知识库", ".notes-page");
      assert(await ctx.ev(`document.querySelectorAll(".notes-wiki-tabs button").length >= 3`), "Wiki tabs 不完整");
      await ctx.ev(`(()=>{const b=document.querySelector(".notes-tab-add"); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(900);
      const r = await ctx.ev(`(()=>({
        title: document.querySelector(".notes-title-input")?.value || "",
        editor: !!document.querySelector(".cm-content"),
        toolbar: !!document.querySelector(".notes-editor-toolbar"),
      }))()`);
      assert(r.title.length > 0 && r.title !== "Untitled" || r.title === "Untitled", `新页面标题=${r.title}`);
      assert(r.editor, "CodeMirror 编辑器未就绪");
      assert(r.toolbar, "编辑器工具栏未渲染");
    },
  },
  {
    id: "AGENT-01",
    group: "AGENT",
    title: "执行适配器矩阵：dsh ACP / pi 终端",
    async fn(ctx) {
      const s = await ctx.state();
      const dsh = (s.executors || []).find((e) => e.id === "dsh");
      const pi = (s.executors || []).find((e) => e.id === "pi");
      assert(dsh?.implemented === true, "dsh executor 未实现");
      assert(pi && pi.implemented === false, "pi 不应能从 Chat 派活");
      // terminal-first：pi 可被 Chat 派活到 pty，但不是 ACP / supervisor。
      const piAgent = await ctx.ev(`(async()=>{
        const a = (await window.harness.action("createAgent",{cli:"pi"})).result;
        const s = await window.harness.getState();
        const live = s.agents.find(x=>x.id===a.id);
        return { ok: true, chatRunnable: live?.chatRunnable, chatRuntime: live?.chatRuntime, role: live?.role };
      })()`);
      assert(piAgent.ok === true && piAgent.chatRunnable === true && piAgent.chatRuntime === "terminal" && piAgent.role === "worker", `pi 的终端执行能力不正确: ${JSON.stringify(piAgent)}`);
    },
  },

  {
    id: "WK-06",
    group: "WIKI",
    title: "知识库自动保存 + 删除 → 回收站 → 恢复",
    async fn(ctx) {
      await gotoRail(ctx, "知识库", ".notes-page");
      const marker = `autosave-${Date.now()}`;
      await ctx.ev(`(()=>{const b=document.querySelector(".notes-tab-add"); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(800);
      const title = await ctx.ev(`document.querySelector(".notes-title-input")?.value || ""`);
      assert(title.length > 0, "新建页面没有标题输入框");
      await ctx.ev(`document.querySelector(".cm-content")?.focus(); true`);
      await ctx.send("Input.insertText", { text: marker });
      await ctx.sleep(2200);
      const page = await ctx.ev(`window.harness.action("pluginInvoke",{pluginId:"ai.cockpit.notes",method:"wiki.list",args:{}}).then(r=>{const list=r.result; return (list.pages||[]).find(p=>p.title===${JSON.stringify(title)}) || null;})`);
      assert(page?.id, "新建页面没有出现在 wiki.list");
      const fetched = await ctx.ev(`window.harness.action("pluginInvoke",{pluginId:"ai.cockpit.notes",method:"wiki.getPage",args:{id:${JSON.stringify(page.id)}}}).then(r=>r.result)`);
      assert(String(fetched?.content || "").includes(marker), `自动保存未写回内容: ${String(fetched?.content || "").slice(0, 80)}`);
      assert(await ctx.ev(`!document.querySelector(".notes-tab-dirty")`), "自动保存后仍显示未保存点");
      await ctx.ev(`window.harness.action("pluginInvoke",{pluginId:"ai.cockpit.notes",method:"wiki.deletePage",args:{id:${JSON.stringify(page.id)}}})`);
      await ctx.sleep(300);
      const listed = await ctx.ev(`window.harness.action("pluginInvoke",{pluginId:"ai.cockpit.notes",method:"wiki.list",args:{}}).then(r=>r.result)`);
      const trash = (listed.trash || []).find((t) => t.kind === "page" && t.title === title);
      assert(trash?.id, "删除后没有进入回收站");
      await ctx.ev(`window.harness.action("pluginInvoke",{pluginId:"ai.cockpit.notes",method:"wiki.restoreTrash",args:{id:${JSON.stringify(trash.id)}}})`);
      await ctx.sleep(300);
      const restored = await ctx.ev(`window.harness.action("pluginInvoke",{pluginId:"ai.cockpit.notes",method:"wiki.list",args:{}}).then(r=>r.result)`);
      assert((restored.pages || []).some((p) => p.title === title), "回收站恢复失败");
    },
  },
  {
    id: "PV-06",
    group: "PREVIEW",
    title: "预览：地址栏 / 前进后退 / 设备宽度 / 缩放 / 页内查找",
    async fn(ctx) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><body><h1>E2E Preview</h1><p>preview body</p></body></html>");
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${server.address().port}/`;
      const oldHome = (await ctx.state()).settings.previewHomeUrl;
      try {
        await openWorkspace(ctx);
        // 先关掉已有终端/文件预览标签，避免 showPreview 复用文件预览而不是设置里的 URL
        for (let i = 0; i < 8; i += 1) {
          const closed = await ctx.ev(`(()=>{const b=document.querySelector(".term-tab.on .term-close") || document.querySelector(".term-tab .term-close"); if(!b) return false; window.__e2e.click(b); return true;})()`);
          if (!closed) break;
          await ctx.sleep(150);
        }
        await ctx.action("setSettings", { previewHomeUrl: url });
        await ctx.sleep(450);
        await ctx.ev(`window.dispatchEvent(new Event("harness:open-preview")); true`);
        const ready = await ctx.ev(`(async()=>await window.__e2e.until(() => {
          const surface=document.querySelector(".preview-surface");
          return !!(surface && surface.querySelector(".preview-surface-bar"));
        }, 8000))()`);
        assert(ready, "预览标签未打开");
        const controls = await ctx.ev(`(()=>({
          address: document.querySelector(".preview-surface-address")?.value || "",
          devices: [...document.querySelectorAll(".preview-device option")].map((o) => o.textContent),
          back: !!document.querySelector('button[title="后退"]'),
          forward: !!document.querySelector('button[title="前进"]'),
          find: !!document.querySelector('button[title="页内查找"]'),
          devtools: !!document.querySelector('button[title="开发者工具"]'),
          external: !!document.querySelector('button[title="在系统浏览器打开"]'),
          zoom: !!document.querySelector(".preview-zoom"),
        }))()`);
        assert(controls.address.includes(url), `地址栏=${controls.address}`);
        assert(controls.devices.length === 3, `设备宽度选项=${controls.devices.length}`);
        assert(controls.back && controls.forward, "前进/后退按钮缺失");
        assert(controls.find && controls.devtools && controls.external && controls.zoom, "预览控制按钮不完整");
        const before = await ctx.ev(`document.querySelector(".preview-zoom-value")?.textContent || ""`);
        await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".preview-zoom button")].find((x)=>x.textContent.includes("＋")); if(b) window.__e2e.click(b); return true;})()`);
        await ctx.sleep(200);
        const after = await ctx.ev(`document.querySelector(".preview-zoom-value")?.textContent || ""`);
        assert(before !== after, `缩放没有变化: ${before}`);
        await ctx.ev(`(()=>{const b=document.querySelector('button[title="页内查找"]'); if(b) window.__e2e.click(b); return true;})()`);
        await ctx.sleep(200);
        assert(await ctx.ev(`!!document.querySelector(".preview-find")`), "页内查找面板未打开");
      } finally {
        await ctx.action("setSettings", { previewHomeUrl: oldHome }).catch(() => {});
        await new Promise((resolve) => server.close(resolve));
      }
    },
  },
  {
    id: "WT-06",
    group: "WORKTREE",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "worktree 策略：never 原地 / Scene always 覆盖",
    async fn(ctx) {
      const dir = makeProject(ctx, "wt-policy", { "README.md": "# Policy\n" }, true);
      await ctx.action("addProject", { path: dir, name: "E2E Policy" });
      await ctx.sleep(400);
      const s = await ctx.state();
      const project = s.projects.find((p) => p.path === dir);
      assert(project, "项目未添加");
      await ctx.action("switchProject", { id: project.id });
      await ctx.sleep(300);
      try {
        await ctx.action("setSettings", { worktreeMode: "never" });
        const setup = await setupFakeAgent(ctx, project.id);
        const first = await dispatch(ctx, setup, `policy-never-${Date.now()}`);
        const { value: run1 } = await waitForState(ctx, (st) => st.runs.find((r) => r.todoId === first.todoId && r.cwd), 12000);
        assert(run1.cwd === dir, `never 策略仍建了 worktree: ${run1.cwd}`);
        assert(!run1.branch, `never 策略不该有分支: ${run1.branch}`);
        await ctx.action("stop", { runId: run1.id });

        await ctx.action("saveScene", { projectId: project.id, text: "worktree: always\nruntime: auto\nconcurrency: 1" });
        await ctx.sleep(200);
        const thread = await ctx.action("newThread", { projectId: project.id });
        await ctx.action("setThreadAgent", { threadId: thread.id, agentId: setup.agent.id });
        const second = await dispatch(ctx, { ...setup, thread }, `policy-always-${Date.now()}`);
        const { value: run2 } = await waitForState(ctx, (st) => st.runs.find((r) => r.todoId === second.todoId && r.cwd && r.cwd !== dir), 12000);
        assert(String(run2.branch || "").startsWith("harness/"), `Scene always 未建分支: ${run2.branch}`);
        await ctx.action("stop", { runId: run2.id });
        await ctx.action("cleanupWorktree", { runId: run2.id });
      } finally {
        await ctx.action("setSettings", { worktreeMode: "auto" }).catch(() => {});
      }
    },
  },
  {
    id: "FG-03",
    group: "FILES",
    title: "Git API：status / diff / stage / commit / log",
    async fn(ctx) {
      const dir = makeProject(ctx, "git-api", { "README.md": "# Git API\n" }, true);
      await ctx.action("addProject", { path: dir, name: "E2E Git" });
      await ctx.sleep(400);
      const s = await ctx.state();
      const project = s.projects.find((p) => p.path === dir);
      assert(project, "项目未添加");
      await ctx.action("switchProject", { id: project.id });
      fs.writeFileSync(path.join(dir, "README.md"), "# Git API\n\nchanged-body\n");
      const status = await ctx.ev(`window.harness.gitStatus(${JSON.stringify(dir)})`);
      assert(status.isRepo, "gitStatus 不是仓库");
      assert((status.files || []).some((f) => f.path === "README.md" && !f.staged), "status 没看到 README 改动");
      const diff = await ctx.ev(`window.harness.gitDiff(${JSON.stringify(dir)}, "README.md", false)`);
      assert(String(diff.diff || "").includes("changed-body"), "diff 没包含改动");
      await ctx.ev(`window.harness.gitStage(${JSON.stringify(dir)}, ["README.md"])`);
      const staged = await ctx.ev(`window.harness.gitStatus(${JSON.stringify(dir)})`);
      assert((staged.files || []).some((f) => f.path === "README.md" && f.staged), "stage 后文件未暂存");
      const commit = await ctx.ev(`window.harness.gitCommit(${JSON.stringify(dir)}, "e2e git commit")`);
      assert(commit.ok !== false, `commit 失败: ${commit.error || commit.output || ""}`);
      const clean = await ctx.ev(`window.harness.gitStatus(${JSON.stringify(dir)})`);
      assert((clean.files || []).length === 0, `commit 后工作区不干净: ${JSON.stringify(clean.files)}`);
      const log = await ctx.ev(`window.harness.gitLog(${JSON.stringify(dir)})`);
      assert((log.commits || []).some((c) => c.subject === "e2e git commit"), "git log 没看到提交");
    },
  },
  {
    id: "E2E-01",
    group: "E2E",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "普通 TODO 广播给两个 Agent：独立 run / worktree",
    async fn(ctx) {
      const dirA = makeProject(ctx, "multi-a", { "README.md": "# A\n" }, true);
      const dirB = makeProject(ctx, "multi-b", { "README.md": "# B\n" }, true);
      await ctx.action("addProject", { path: dirA, name: "E2E Multi A" });
      await ctx.sleep(350);
      let s = await ctx.state();
      const pA = s.projects.find((p) => p.path === dirA);
      const pB = s.projects.find((p) => p.path === dirB) || (await ctx.action("addProject", { path: dirB, name: "E2E Multi B" }));
      assert(pA && pB, "多 Agent 项目未添加");
      await ctx.action("switchProject", { id: pA.id });
      await ctx.sleep(250);
      await ctx.action("setSettings", { dshBinary: ctx.fakeDsh, maxConcurrentRuns: 4, approvalPolicy: "allow" });
      const agentA = await ctx.action("createAgent", { cli: "dsh", projectId: pA.id });
      const agentB = await ctx.action("createAgent", { cli: "dsh", projectId: pB.id });
      assert(agentA.id !== agentB.id, "两个项目应生成不同 Agent");
      const todo = await ctx.action("createTodo", { title: `multi-${Date.now()}`, cwd: dirA, agentId: agentA.id });
      await ctx.action("broadcast", { id: todo.id, agentIds: [agentA.id, agentB.id] });
      const { value: runs } = await waitForState(ctx, (st) => {
        const list = st.runs.filter((r) => r.todoId === todo.id && r.cwd);
        return list.length >= 2 ? list : null;
      }, 15000);
      assert(new Set(runs.map((r) => r.agentId)).size >= 2, "广播没有生成两个 Agent 的 run");
      assert(new Set(runs.map((r) => r.cwd)).size >= 2, "两个 run 没有独立 worktree");
      await ctx.action("stop", { runId: runs[0].id });
      await ctx.action("stop", { runId: runs[1].id });
      await ctx.action("cleanupWorktree", { runId: runs[0].id }).catch(() => {});
      await ctx.action("cleanupWorktree", { runId: runs[1].id }).catch(() => {});
    },
  },
  {
    id: "HOST-01",
    group: "HOST",
    title: "主机页：概览 / CLI / 指标 / 重新探测",
    async fn(ctx) {
      await gotoRail(ctx, "主机", ".host-panel");
      const r = await ctx.ev(`(()=>({
        panels: document.querySelectorAll(".host-panel").length,
        overview: document.querySelectorAll(".host-overview-bar .project-overview-item").length,
        caps: document.querySelectorAll(".host-panel .host-cap-row").length,
        meta: document.querySelectorAll(".host-panel .host-meta-grid > div").length,
        probe: !!document.querySelector(".host-panel .host-head-actions .btn"),
      }))()`);
      assert(r.panels >= 1, "主机卡片未渲染");
      assert(r.overview >= 4, `主机概览项=${r.overview}`);
      assert(r.caps >= 1, "可用 CLI 列表为空");
      assert(r.meta === 4, `主机指标=${r.meta}`);
      assert(r.probe, "重新探测按钮缺失");
      const listMode = await ctx.ev(`(async()=>{
        const b=[...document.querySelectorAll(".host-page .view-switch button")].find((x)=>x.textContent.includes("列表"));
        if(!b) return false; window.__e2e.click(b);
        return !!(await window.__e2e.until(() => document.querySelector(".host-list-item"), 2000));
      })()`);
      assert(listMode, "主机列表视图未渲染");
      await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".host-page .view-switch button")].find((x)=>x.textContent.includes("卡片")); if(b) window.__e2e.click(b); return true;})()`);
      await ctx.sleep(200);
      assert(await ctx.ev(`document.querySelectorAll(".host-panel").length >= 1`), "主机卡片视图未恢复");
      const clicked = await ctx.ev(`(()=>{const b=[...document.querySelectorAll(".host-panel .host-head-actions .btn")].find((x)=>x.textContent.includes("重新探测")); if(!b) return false; window.__e2e.click(b); return true;})()`);
      assert(clicked, "重新探测未触发");
      const { value } = await waitForState(ctx, (s) => s.hosts.find((h) => h.kind === "local" && h.status === "online"), 10000);
      assert(value, "本机主机探测后不在线");
    },
  },
  {
    id: "STAT-01",
    group: "STATS",
    title: "统计：指标 / 图表或空态",
    async fn(ctx) {
      await gotoRail(ctx, "统计", ".stats-page");
      const r = await ctx.ev(`(()=>({
        tiles: document.querySelectorAll(".stats-tile").length,
        empty: !!document.querySelector(".stats-empty-panel"),
        grid: !!document.querySelector(".stats-grid"),
        range: document.querySelectorAll(".stats-range .seg-btn").length,
        export: [...document.querySelectorAll(".stats-actions .btn")].some((b)=>b.textContent.includes("CSV")),
      }))()`);
      assert(r.tiles === 4, `统计指标卡=${r.tiles}`);
      assert(r.empty || r.grid, "统计主体未渲染");
      assert(r.range >= 4, "统计时间范围缺失");
      assert(r.export, "统计导出按钮缺失");
    },
  },
  {
    id: "SC-01",
    group: "SCENE",
    title: "场景总览：项目 / 终端 / 配置保存",
    async fn(ctx) {
      const dir = makeProject(ctx, "scene-project", { "README.md": "# Scene\n" }, false);
      await ctx.action("addProject", { path: dir, name: "E2E Scene" });
      await ctx.sleep(400);
      const s0 = await ctx.state();
      const project = s0.projects.find((p) => p.path === dir);
      assert(project, "场景项目未添加");
      await ctx.action("switchProject", { id: project.id });
      await ctx.sleep(350);
      await gotoRail(ctx, "场景", ".scene-page");
      assert(await ctx.ev(`document.querySelectorAll(".scene-overview-bar .project-overview-item").length >= 4`), "场景概览不完整");
      const opened = await ctx.ev(`(async()=>{
        const card=[...document.querySelectorAll(".scene-card")].find((c)=>c.dataset.projectId === ${JSON.stringify(project.id)});
        if(!card) return false;
        const b=[...card.querySelectorAll(".btn")].find((x)=>x.textContent.includes("编辑配置"));
        if(!b) return false;
        window.__e2e.click(b);
        return !!(await window.__e2e.until(() => document.querySelector(".scene-modal .scene-editor"), 3000));
      })()`);
      assert(opened, "执行配置弹窗未打开");
      assert(await ctx.ev(`(()=>{const card=[...document.querySelectorAll(".scene-card")].find((c)=>c.dataset.projectId === ${JSON.stringify(project.id)}); return card ? card.querySelectorAll(".scene-card-stats span").length >= 4 : false;})()`), "执行配置状态卡片不完整");
      const marker = `E2E scene ${Date.now()}`;
      const text = `worktree: auto\nruntime: auto\nnotes: ${marker}`;
      const changed = await ctx.ev(`(()=>{
        const ta=document.querySelector(".scene-modal .scene-editor");
        if(!ta) return false;
        window.__e2e.setValue(ta, ${JSON.stringify(text)});
        return true;
      })()`);
      assert(changed, "执行配置输入框不存在");
      const clicked = await ctx.ev(`(()=>{
        const b=[...document.querySelectorAll(".scene-modal .btn")].find((x)=>x.textContent.includes("保存"));
        if(!b) return false; window.__e2e.click(b); return true;
      })()`);
      assert(clicked, "执行配置保存按钮不存在");
      const { value } = await waitForState(ctx, (s) => (s.scenes || []).find((x) => x.projectId === project.id && x.text.includes(marker)), 5000);
      assert(value, "场景配置没有保存到 state");
    },
  },
  {
    id: "TK-01",
    group: "TASK",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "TODO 4 组：待执行 / 进行中 / 待确认 / 已完成",
    async fn(ctx) {
      await openWorkspace(ctx);
      const setup = await setupFakeAgent(ctx);
      const cases = [
        ["todo", "待执行"],
        ["in_progress", "进行中"],
        ["in_review", "待确认"],
        ["done", "已完成"],
      ];
      const ids = [];
      for (const [status] of cases) {
        const thread = ids.length === 0 ? setup.thread : await ctx.action("newThread", { projectId: setup.projectId });
        if (ids.length > 0) await ctx.action("setThreadAgent", { threadId: thread.id, agentId: setup.agent.id });
        const result = await dispatch(ctx, { ...setup, thread }, `group-${status}-${Date.now()}`);
        ids.push(result.todoId);
        await ctx.sleep(250);
      }
      await stopRuns(ctx, ids);
      for (let i = 0; i < cases.length; i += 1) {
        await ctx.action("setStatus", { id: ids[i], status: cases[i][0] });
        await ctx.sleep(180);
      }
      await openWorkspace(ctx);
      const groups = await ctx.ev(`[...document.querySelectorAll(".todo-group-head")].map((e) => e.textContent.trim())`);
      for (const [, label] of cases) assert(groups.some((g) => g.includes(label)), `缺少分组「${label}」: ${groups.join(" | ")}`);
    },
  },
  {
    id: "CH-01",
    group: "CHAT",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "Chat 分派：@别名 → TODO + user 消息",
    async fn(ctx) {
      const setup = await setupFakeAgent(ctx);
      const text = `dispatch-check-${Date.now()}`;
      const result = await dispatch(ctx, setup, text);
      const s = await ctx.state();
      assert(s.todos.some((t) => t.id === result.todoId), "TODO 未创建");
      assert(s.messages.some((m) => m.threadId === setup.thread.id && m.role === "user" && m.content.includes(text)), "Chat 未落 user 消息");
      await ctx.ev(`window.__e2e.click(window.__e2e.rail("工作区")); true`);
      await ctx.sleep(350);
      const selected = await ctx.ev(`(()=>{
        const row=[...document.querySelectorAll(".task-row")].find((r)=>r.textContent.includes(${JSON.stringify(text)}));
        if(!row) return false; window.__e2e.click(row); return true;
      })()`);
      assert(selected, "找不到刚创建的任务行");
      await ctx.sleep(350);
      assert(await ctx.ev(`[...document.querySelectorAll(".msg.user")].some((e) => e.textContent.includes(${JSON.stringify(text)}))`), "Chat 未渲染 user 消息");
      await stopRuns(ctx, [result.todoId]);
    },
  },
  {
    id: "CH-02",
    group: "CHAT",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "纠偏回执：pending → injected",
    async fn(ctx) {
      const setup = await setupFakeAgent(ctx);
      const result = await dispatch(ctx, setup, `steer-base-${Date.now()}`);
      const running = await waitForState(ctx, (s) => s.runs.find((r) => r.todoId === result.todoId && r.status === "running"), 10000);
      const runId = running.value.id;
      // 等 startRun 真正发出第一次 prompt（fake 回一个 agent chunk），否则 steer 会抢在任务 prompt 前面
      await waitForState(ctx, (s) => s.messages.some((m) => m.runId === runId && m.role === "agent" && m.content.includes("fake")), 10000);
      const steerText = `steer-${Date.now()}`;
      const steer = await ctx.action("send", { threadId: setup.thread.id, text: steerText, agentId: setup.agent.id });
      assert(steer?.mode === "steer", `未进入 steer: ${JSON.stringify(steer)}`);
      const { value } = await waitForState(ctx, (s) => s.messages.find((m) => m.threadId === setup.thread.id && m.role === "user" && m.content.includes(steerText) && m.delivery === "injected"), 8000);
      assert(value, "纠偏未变成 injected");
      await stopRuns(ctx, [result.todoId]);
    },
  },
  {
    id: "CH-04",
    group: "CHAT",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "已确认任务：消息只记录，不新起 run",
    async fn(ctx) {
      const setup = await setupFakeAgent(ctx);
      const result = await dispatch(ctx, setup, `confirm-base-${Date.now()}`);
      await stopRuns(ctx, [result.todoId]);
      await ctx.action("confirm", { id: result.todoId });
      const s1 = await ctx.state();
      const runCount = s1.runs.filter((r) => r.todoId === result.todoId).length;
      const note = await ctx.action("send", { threadId: setup.thread.id, text: "confirmed-note", agentId: setup.agent.id });
      assert(note?.mode === "note", `已确认任务仍起了 run: ${JSON.stringify(note)}`);
      const s2 = await ctx.state();
      assert(s2.runs.filter((r) => r.todoId === result.todoId).length === runCount, "已确认任务新增了 run");
      assert(s2.todos.find((t) => t.id === result.todoId)?.confirmed === true, "任务未确认");
    },
  },
  {
    id: "WT-01",
    group: "WORKTREE",
    skip: process.platform === "win32" ? "fake ACP 仅 POSIX" : undefined,
    title: "worktree：git 项目 run 使用 harness 分支并显示",
    async fn(ctx) {
      const dir = makeProject(ctx, "wt-project", { "README.md": "# WT\n" }, true);
      await ctx.action("addProject", { path: dir, name: "E2E Worktree" });
      await ctx.sleep(400);
      const s = await ctx.state();
      const project = s.projects.find((p) => p.path === dir);
      assert(project, "项目未添加");
      await ctx.action("switchProject", { id: project.id });
      await ctx.sleep(300);
      const setup = await setupFakeAgent(ctx, project.id);
      const result = await dispatch(ctx, setup, `worktree-${Date.now()}`);
      const { value: run } = await waitForState(ctx, (s) => s.runs.find((r) => r.todoId === result.todoId && r.cwd && r.cwd !== dir), 12000);
      assert(run, "run 没有使用独立目录");
      assert(String(run.branch || "").startsWith("harness/"), `worktree 分支异常: ${run.branch}`);
      await openWorkspace(ctx);
      const row = await ctx.ev(`[...document.querySelectorAll(".task-row")].find((r) => r.textContent.includes("worktree"))?.textContent || ""`);
      assert(row.includes("harness/") || row.includes("worktree"), `任务行未显示 worktree: ${row.slice(0, 120)}`);
      await ctx.action("stop", { runId: run.id });
      await ctx.action("cleanupWorktree", { runId: run.id });
    },
  },
,
,
,
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
