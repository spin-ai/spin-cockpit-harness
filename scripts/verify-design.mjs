import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (ok, label) => { checks.push({ ok, label }); if (!ok) process.exitCode = 1; };

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

/**
 * Electron 不实现 window.prompt：调用它不会弹任何东西，点了就是"没反应"。
 * 这条规则是踩出来的——Bot 页的「新建 bot / 新增日程」、Git 的「新建分支」、
 * Mission 的「退回修改」都因此静默失效过。新建/重命名一律用行内输入。
 */
const offenders = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.(ts|tsx)$/.test(entry.name) && /window\.prompt\s*\(/.test(read(rel))) offenders.push(rel);
  }
};
walk("src");
check(offenders.length === 0, `src 里不得用 window.prompt（Electron 不实现）${offenders.length ? "：" + offenders.join("、") : ""}`);

for (const item of checks) console.log(`${item.ok ? "✓" : "✗"} ${item.label}`);
console.log(`\nDesign verification: ${process.exitCode ? "failed" : "passed"}`);
