#!/usr/bin/env node
/**
 * 把横版母片压成 GitHub Pages 用的 1600×900 版本，并生成 poster。
 * 先跑 `npm run video:wide`，再跑 `npm run video:pages`。
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, ".preview/douyin-wide/cockpit-harness-intro-wide.mp4");
const COVER = path.join(ROOT, ".preview/douyin-wide/cover.png");
const OUT = path.join(ROOT, "public/video");
const MP4 = path.join(OUT, "cockpit-harness-intro.mp4");
const JPG = path.join(OUT, "cockpit-harness-intro-poster.jpg");

if (!fs.existsSync(SRC)) {
  console.error(`缺少横版母片：${SRC}\n先运行 npm run video:wide`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-i", SRC,
  "-vf", "scale=1600:900:flags=lanczos",
  "-c:v", "libx264", "-preset", "slow", "-crf", "25",
  "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
  "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "128k",
  MP4,
], { stdio: "inherit" });

if (fs.existsSync(COVER)) {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", COVER,
    "-vf", "scale=1600:900:flags=lanczos",
    "-q:v", "2",
    JPG,
  ], { stdio: "inherit" });
}

const mb = (file) => (fs.statSync(file).size / 1024 / 1024).toFixed(1);
console.log(`[pages] ${path.relative(ROOT, MP4)} (${mb(MP4)} MB)`);
if (fs.existsSync(JPG)) console.log(`[pages] ${path.relative(ROOT, JPG)} (${mb(JPG)} MB)`);
