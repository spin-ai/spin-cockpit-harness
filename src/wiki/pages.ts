import home from "../../resources/wiki/home.md?raw";
import workflow from "../../resources/wiki/workflow.md?raw";
import architecture from "../../resources/wiki/architecture.md?raw";
import agents from "../../resources/wiki/agents.md?raw";
import terminal from "../../resources/wiki/terminal.md?raw";
import themes from "../../resources/wiki/themes.md?raw";
import plugins from "../../resources/wiki/plugins.md?raw";
import build from "../../resources/wiki/build.md?raw";
import changelog from "../../CHANGELOG.md?raw";

export type WikiPage = {
  id: string;
  title: string;
  group: string;
  summary: string;
  body: string;
};

export const WIKI_GROUPS = ["开始", "系统", "扩展", "发布"] as const;

export const WIKI_PAGES: WikiPage[] = [
  { id: "home", title: "项目介绍", group: "开始", summary: "Cockpit Harness 是什么、解决什么问题，以及一条任务如何走完。", body: home },
  { id: "workflow", title: "工作流", group: "开始", summary: "Chat 分派、run 生命周期、纠偏、worktree 与确认。", body: workflow },
  { id: "architecture", title: "架构", group: "系统", summary: "Electron 主进程、React 渲染层、SQLite、ACP 与 pty 的边界。", body: architecture },
  { id: "agents", title: "Agent 与执行适配器", group: "系统", summary: "哪些 CLI 能从 Chat 派活，dsh ACP 如何驱动一次 run。", body: agents },
  { id: "terminal", title: "终端与预览", group: "系统", summary: "真实 pty、标签拆分、预览和元素拾取上下文。", body: terminal },
  { id: "themes", title: "主题系统", group: "扩展", summary: "13 套主题、深浅色结构与终端 ANSI 配色。", body: themes },
  { id: "plugins", title: "插件与 LLM Wiki", group: "扩展", summary: "插件宿主、Notes 原生 Wiki、MCP 工具与编辑器。", body: plugins },
  { id: "build", title: "构建与发布", group: "发布", summary: "开发、打包、内置 dsh、跨平台与 CI。", body: build },
  { id: "changelog", title: "版本记录", group: "发布", summary: "从仓库 CHANGELOG 渲染的版本变更。", body: changelog },
];

export function wikiPage(id: string): WikiPage {
  return WIKI_PAGES.find((page) => page.id === id) ?? WIKI_PAGES[0];
}
