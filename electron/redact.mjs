/**
 * 运行时脱敏：把人眼能认出的密钥形态换成 [redacted]。
 *
 * 为什么要有它（而不是只靠 `verify:privacy` 扫仓库）：
 *  - `verify:privacy` 管的是「别把密钥提交进 git」；
 *  - 这里管的是「别把用户粘贴的密钥写进本地库 / 推到界面 / 放进通知」。
 * 两件事互不覆盖：一个是入库前，一个是运行时。
 *
 * 原则：
 *  - 只认**形态明确**的东西（前缀 + 长度、JWT 三段、带 key 名的赋值），不做「高熵乱猜」——
 *    宁可漏一个，也不要把正常的 commit hash / 路径 / 变量名涂掉，否则日志不可读；
 *  - 命中即整段替换成 `[redacted]`，不保留长度或前后缀（长度本身也是信息）。
 */

export const REDACTED = "[redacted]";

/** 形态明确的密钥：前缀 + 足够长的尾巴 */
const PATTERNS = [
  // OpenAI / DeepSeek / 通用 sk- 形态
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // AWS access key
  /\bAKIA[0-9A-Z]{16}\b/g,
  // GitHub token
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // Slack token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // JWT（三段 base64url）
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Authorization: Bearer xxx
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  // 32 位以上纯十六进制（openssl rand -hex 16/32 的产物）
  /\b[0-9a-f]{32,}\b/gi,
  // key=value 形态：保留 key 名，值涂掉（值至少 8 位，避免误伤 true/false/端口）
  /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|passwd|credential)[A-Za-z0-9_]*)\s*[:=]\s*["']?([^\s"',;]{8,})["']?/gi,
];

/** 一眼判断有没有中招（用于「要不要提示用户」这类廉价判定） */
export function hasSecret(text) {
  const s = String(text || "");
  if (!s) return false;
  return PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(s);
  });
}

/**
 * 返回脱敏后的文本。`hits` 是命中次数（调用方可以据此决定「提醒一下用户」）。
 * 注意：`key=value` 那条要把值单独换掉、保留 key 名，所以最后一条单独处理。
 */
export function redactSecrets(text) {
  let s = String(text ?? "");
  if (!s) return { text: s, hits: 0 };
  let hits = 0;

  // 前七条：整段替换
  for (const re of PATTERNS.slice(0, 7)) {
    re.lastIndex = 0;
    s = s.replace(re, () => { hits += 1; return REDACTED; });
  }

  // 最后一条：保留 key 名，只涂值
  const kv = PATTERNS[7];
  kv.lastIndex = 0;
  s = s.replace(kv, (match, key, value) => {
    // 值本身已经是占位符就别再涂一次
    if (String(value).includes(REDACTED)) return match;
    hits += 1;
    return match.replace(value, REDACTED);
  });

  return { text: s, hits };
}

/** 只取文本、不关心命中次数的调用方用这个 */
export function redact(text) {
  return redactSecrets(text).text;
}

/**
 * 对象的浅层脱敏：bot 回合这类「几个已知字符串字段」的结构，逐字段过一遍即可。
 * 不做深拷贝遍历——宁可让调用方显式列出要涂的字段，也不要偷偷改掉别的数据。
 */
export function redactFields(obj, fields) {
  const out = { ...obj };
  let hits = 0;
  for (const field of fields) {
    if (typeof out[field] !== "string") continue;
    const res = redactSecrets(out[field]);
    out[field] = res.text;
    hits += res.hits;
  }
  return { value: out, hits };
}
