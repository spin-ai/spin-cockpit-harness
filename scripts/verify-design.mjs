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

for (const item of checks) console.log(`${item.ok ? "✓" : "✗"} ${item.label}`);
console.log(`\nDesign verification: ${process.exitCode ? "failed" : "passed"}`);
