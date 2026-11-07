#!/usr/bin/env node
/** Build a separate .cockpit-plugin archive; never bundled into the app. */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] || "notes";
const source = path.join(root, "plugins", name);
const manifest = JSON.parse(fs.readFileSync(path.join(source, "plugin.json"), "utf8"));
const outDir = path.join(root, "release", "plugins");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${manifest.id}-${manifest.version}.cockpit-plugin`);
const zip = new AdmZip();
zip.addLocalFolder(source);
zip.writeZip(out);
console.log(`[plugin:${name}] ${path.relative(root, out)} · ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
