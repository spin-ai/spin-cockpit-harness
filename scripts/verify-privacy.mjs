#!/usr/bin/env node
/**
 * 隐私守卫：扫描「已跟踪 + 未忽略的新文件」，挡住不该进仓库的个人信息。
 *
 * 背景见 docs/ 的隐私约定：datasets/、.runtime/、.preview/ 永不入库；
 * 真实微信账号、手机号、个人邮箱、本机用户名路径、密钥同样不允许。
 *
 * 规则命中时只打印 file:line + 打码片段，绝不把原文写进 CI 日志。
 * 需要放行某一行时在该行加 `privacy:ignore`。
 *
 * 用法：node scripts/verify-privacy.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|dmg|exe|appimage|wasm|mp4|mov|mp3|wav|webm|onnx|bin)$/i;

/** 不应该出现在版本库里的路径（即使被 git add -f 强行加入） */
const PATH_RULES = [
  { label: "聊天/私有数据目录", re: /(^|\/)(datasets|\.runtime|\.preview)\// },
  { label: "本地文章素材目录", re: /^docs\/(articles|assets\/article)\// },
  { label: "环境变量文件", re: /(^|\/)\.env(\.|$)/, allow: /(^|\/)\.env\.example$/ },
  { label: "密钥/数据库文件", re: /(^|\/)(id_rsa|id_ed25519)$|\.(pem|p12|p8|key|sqlite|sqlite3|db)$/i },
];

/** 文本内容规则：命中即失败；mask 只展示打码片段 */
const CONTENT_RULES = [
  {
    label: "微信账号",
    re: /wxid_[a-z0-9]{10,}/g,
    mask: (m) => `${m.slice(0, 8)}…`,
  },
  {
    label: "手机号",
    re: /(^|[^0-9])1[3-9][0-9]{9}(?![0-9])/g,
    mask: () => "1**…****",
  },
  {
    label: "手机号（带分隔符）",
    re: /(^|[^0-9])1[3-9][0-9][- ]?[0-9]{4}[- ]?[0-9]{4}(?![0-9])/g,
    mask: () => "1**…****",
  },
  {
    label: "身份证号",
    re: /(^|[^0-9])[1-9][0-9]{16}[0-9Xx](?![0-9Xx])/g,
    mask: () => "********…****",
  },
  {
    label: "个人邮箱",
    re: /[\w.+-]+@(qq|163|126|foxmail|gmail|outlook|hotmail|yahoo|icloud|proton)\.(com|cn|me)/gi,
    mask: (m) => `${m.slice(0, 3)}***@***`,
  },
  {
    label: "本机绝对路径",
    re: /(^|[^A-Za-z0-9])(\/(?:Users|home)\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\)/g,
    mask: () => "…/Users/***/",
  },
  {
    label: "私钥",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    mask: () => "-----BEGIN … PRIVATE KEY-----",
  },
  {
    label: "访问令牌",
    re: /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
    mask: (m) => `${m.slice(0, 6)}…`,
  },
];

function listFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

const findings = [];
const seen = new Set();
let scanned = 0;

for (const rel of listFiles()) {
  if (seen.has(rel)) continue;
  seen.add(rel);
  if (SKIP_FILES.has(rel) || BINARY_EXT.test(rel)) continue;

  for (const rule of PATH_RULES) {
    if (rule.allow?.test(rel)) continue;
    if (rule.re.test(rel)) findings.push({ rel, line: 0, label: rule.label, sample: rel.replace(/.*\//, "…/") });
  }

  const abs = path.join(root, rel);
  if (!existsSync(abs)) continue;
  const stat = statSync(abs);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;

  const buf = readFileSync(abs);
  if (isBinary(buf)) continue;
  scanned += 1;

  const lines = buf.toString("utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes("privacy:ignore")) continue;
    for (const rule of CONTENT_RULES) {
      rule.re.lastIndex = 0;
      const match = rule.re.exec(line);
      if (!match) continue;
      const hit = match[0].trim();
      findings.push({ rel, line: i + 1, label: rule.label, sample: rule.mask(hit) });
    }
  }
}

for (const item of findings) {
  const where = item.line ? `${item.rel}:${item.line}` : item.rel;
  console.log(`✗ ${where} · ${item.label} · ${item.sample}`);
}
console.log(`\nPrivacy: ${scanned} files scanned · ${findings.length} findings`);
if (findings.length) {
  console.log("Privacy verification: failed");
  process.exitCode = 1;
} else {
  console.log("Privacy verification: passed");
}
