#!/usr/bin/env node
/**
 * 把 App 内置的项目 Wiki 同步到 GitHub Wiki。
 *
 * 前置：仓库已启用 Wiki，并且在 GitHub Wiki 页面创建过首页（这样 .wiki.git 才存在）。
 *
 * 用法：
 *   npm run wiki:publish
 *   WIKI_REMOTE=git@github.com:owner/repo.wiki.git npm run wiki:publish
 *
 * 行为：
 * - clone <repo>.wiki.git 到临时目录；
 * - 用 resources/wiki/*.md + CHANGELOG.md 覆盖同名页面；
 * - #/wiki/<id> 改写成 GitHub Wiki 页面链接；
 * - ./wiki/xxx.png 改写成主仓库 raw 图片地址；
 * - 生成 _Sidebar.md / _Footer.md；
 * - commit + push。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PAGES = [
  { id: "home", file: "Home.md", source: "resources/wiki/home.md", group: "开始", label: "项目介绍" },
  { id: "workflow", file: "Workflow.md", source: "resources/wiki/workflow.md", group: "开始", label: "工作流" },
  { id: "architecture", file: "Architecture.md", source: "resources/wiki/architecture.md", group: "系统", label: "架构" },
  { id: "agents", file: "Agents.md", source: "resources/wiki/agents.md", group: "系统", label: "Agent 与执行适配器" },
  { id: "super-agent", file: "Super-Agent.md", source: "resources/wiki/super-agent.md", group: "系统", label: "Super Agent / Mission" },
  { id: "design-notes", file: "Design-Notes.md", source: "resources/wiki/design-notes.md", group: "系统", label: "设计取舍与踩坑" },
  { id: "terminal", file: "Terminal.md", source: "resources/wiki/terminal.md", group: "系统", label: "终端与预览" },
  { id: "themes", file: "Themes.md", source: "resources/wiki/themes.md", group: "扩展", label: "主题系统" },
  { id: "plugins", file: "Plugins.md", source: "resources/wiki/plugins.md", group: "扩展", label: "插件与 LLM Wiki" },
  { id: "build", file: "Build.md", source: "resources/wiki/build.md", group: "发布", label: "构建与发布" },
  { id: "changelog", file: "Changelog.md", source: "CHANGELOG.md", group: "发布", label: "版本记录" },
];

const GROUPS = ["开始", "系统", "扩展", "发布"];

function git(args, cwd, options = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function wikiRemote(origin) {
  return String(origin).replace(/\.git$/, "") + ".wiki.git";
}

function repoSlug(origin) {
  const match = String(origin).match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

let origin;
try { origin = git(["remote", "get-url", "origin"], root); } catch { origin = ""; }
const remote = process.env.WIKI_REMOTE || (origin ? wikiRemote(origin) : "");
if (!remote) {
  console.error("[wiki] 找不到 origin；请设置 WIKI_REMOTE=git@github.com:owner/repo.wiki.git");
  process.exit(1);
}
const slug = repoSlug(origin);
const rawBase = process.env.WIKI_RAW_BASE || (slug
  ? `https://raw.githubusercontent.com/${slug.owner}/${slug.repo}/main/`
  : "");
const repoUrl = process.env.WIKI_REPO_URL || (slug ? `https://github.com/${slug.owner}/${slug.repo}` : "");

function rewrite(markdown) {
  let out = markdown;
  out = out.replace(/\]\(#\/wiki\/([a-z0-9-]+)\)/g, (full, id) => {
    const page = PAGES.find((item) => item.id === id);
    return page ? `](${page.file.replace(/\.md$/, "")})` : full;
  });
  if (rawBase) {
    out = out.replace(/!\[([^\]]*)\]\(\.\/wiki\/([^)]+)\)/g, (_full, alt, file) => `![${alt}](${rawBase}public/wiki/${file})`);
  }
  return out;
}

function sidebar() {
  const lines = ["### Cockpit Harness", ""];
  for (const group of GROUPS) {
    const pages = PAGES.filter((page) => page.group === group);
    if (!pages.length) continue;
    lines.push(`**${group}**`);
    for (const page of pages) lines.push(`- [${page.label}](${page.file.replace(/\.md$/, "")})`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function footer() {
  const tail = repoUrl ? `[Cockpit Harness](${repoUrl}) · ` : "";
  return `---\n${tail}本 Wiki 由主仓库 \`resources/wiki/*.md\` 同步\n`;
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "cockpit-wiki-"));
try {
  console.log(`[wiki] clone ${remote}`);
  try {
    execFileSync("git", ["clone", "--depth", "1", remote, tmp], { stdio: "inherit" });
  } catch {
    console.error("[wiki] 无法 clone Wiki 仓库。请先在 GitHub 的 Wiki 页面创建首页，然后重试。");
    process.exit(1);
  }

  for (const page of PAGES) {
    const source = path.join(root, page.source);
    if (!existsSync(source)) throw new Error(`缺少源文件：${page.source}`);
    const target = path.join(tmp, page.file);
    if (existsSync(target)) unlinkSync(target);
    writeFileSync(target, rewrite(readFileSync(source, "utf8")), "utf8");
    console.log(`[wiki] ${page.source} → ${page.file}`);
  }
  writeFileSync(path.join(tmp, "_Sidebar.md"), sidebar(), "utf8");
  writeFileSync(path.join(tmp, "_Footer.md"), footer(), "utf8");
  console.log("[wiki] _Sidebar.md, _Footer.md");

  git(["add", "-A"], tmp);
  const changes = git(["status", "--porcelain"], tmp);
  if (!changes) {
    console.log("[wiki] 已是最新，无需提交");
  } else {
    const name = (() => { try { return git(["config", "user.name"], root); } catch { return "cockpit-wiki"; } })();
    const email = (() => { try { return git(["config", "user.email"], root); } catch { return "cockpit-wiki@users.noreply.github.com"; } })();
    execFileSync("git", ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-m", "docs: sync project wiki from main repo"], { cwd: tmp, stdio: "inherit" });
    execFileSync("git", ["push", "origin", "HEAD"], { cwd: tmp, stdio: "inherit" });
    console.log("[wiki] pushed");
  }
  if (repoUrl) console.log(`[wiki] ${repoUrl}/wiki/Home`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
