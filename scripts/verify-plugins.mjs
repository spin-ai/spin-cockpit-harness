#!/usr/bin/env node
/** Keyless plugin manifest / syntax checks (no Electron runtime). */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = path.join(root, "plugins");
let failed = 0;
let checked = 0;

function check(condition, message) {
  if (!condition) { console.error(`✗ ${message}`); failed++; }
  else console.log(`✓ ${message}`);
}

function checkSyntax(file) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  check(res.status === 0, `syntax ${path.relative(root, file)}`);
}

for (const file of ["electron/plugins/host.mjs", "electron/plugins/runtime.mjs"]) {
  checkSyntax(path.join(root, file));
}

for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(pluginsRoot, entry.name);
  const manifestPath = path.join(dir, "plugin.json");
  if (!fs.existsSync(manifestPath)) continue;
  checked++;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (err) { check(false, `${entry.name}: invalid plugin.json`); continue; }
  check(Boolean(manifest.id && manifest.version && manifest.main), `${entry.name}: manifest fields`);
  check(Number(manifest.apiVersion) === 1, `${entry.name}: apiVersion 1`);
  const main = path.resolve(dir, String(manifest.main || ""));
  check(main.startsWith(dir + path.sep) && fs.existsSync(main), `${entry.name}: main exists and stays inside plugin`);
  checkSyntax(main);
  const commands = manifest.contributes?.commands || [];
  check(commands.every((c) => c.id && c.title), `${entry.name}: commands have id/title`);
}

check(checked > 0, "at least one plugin discovered");
console.log(`\nPlugin verification: ${failed ? "FAILED" : "passed"} · ${checked} plugin(s)`);
process.exitCode = failed ? 1 : 0;
