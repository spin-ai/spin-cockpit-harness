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
 * 「像密钥」的单一判定：链接、入参、外部事件三处共用。
 *
 * 和 `hasSecret` 的区别：**不吃裸十六进制**——commit sha / 内容哈希是正常的，
 * 把它们当密钥会把 legit 链接和工具结果涂成不可读。其余形态与 `PATTERNS` 同源。
 */
const STRONG_PATTERNS = PATTERNS.slice(0, 6);

export function containsSecretLike(text) {
  const s = String(text ?? "");
  if (!s) return false;
  if (STRONG_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(s);
  })) return true;
  // key=value 形态（key 名本身足够像凭据）也算
  const kv = PATTERNS[7];
  kv.lastIndex = 0;
  return kv.test(s);
}

/**
 * 强形态脱敏（不含裸十六进制）：工具入参 / 工具结果用这个。
 * commit sha / 内容哈希是正常业务数据，涂掉会让 `git_log`、`workspace_read` 不可读。
 */
function redactStrong(text) {
  let s = String(text ?? "");
  if (!s) return { text: s, hits: 0 };
  let hits = 0;
  for (const re of STRONG_PATTERNS) {
    re.lastIndex = 0;
    s = s.replace(re, () => { hits += 1; return REDACTED; });
  }
  const kv = PATTERNS[7];
  kv.lastIndex = 0;
  s = s.replace(kv, (match, key, value) => {
    if (String(value).includes(REDACTED)) return match;
    hits += 1;
    return match.replace(value, REDACTED);
  });
  return { text: s, hits };
}

/**
 * 对象的**深层**脱敏：工具入参 / 工具结果这类模型可控的任意 JSON 用这个。
 * 返回 `{ value, hits }`；命中一律 `[redacted]`，不保留长度。
 * 深度与数组长度都封顶：宁可丢一半，也不要因为一个大结果把主进程卡住。
 */
export function redactDeep(value, { maxDepth = 8, maxItems = 200 } = {}) {
  let hits = 0;
  const walk = (v, depth) => {
    if (typeof v === "string") {
      const res = redactStrong(v);
      hits += res.hits;
      return res.text;
    }
    if (v == null || typeof v !== "object") return v;
    if (v instanceof Date) return v.toISOString();
    if (depth >= maxDepth) return REDACTED;
    if (Array.isArray(v)) return v.slice(0, maxItems).map((x) => walk(x, depth + 1));
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return REDACTED;
    const out = {};
    for (const [k, inner] of Object.entries(v)) out[k] = walk(inner, depth + 1);
    return out;
  };
  return { value: walk(value, 0), hits };
}

/** 链接里带凭据形状的参数名：token / secret / passw / api_key / signature / auth / session */
const CREDENTIAL_KEY = /token|secret|passw|api[_-]?key|apikey|signature|auth|session/i;

/**
 * 这条链接会不会把凭据发出去（query 或 fragment 里带 token 之类的参数名 / 密钥形态的值）。
 * 命中就足够判「拒收」——不要发出去再删。
 */
export function linkCarriesCredential(url) {
  const s = String(url ?? "").trim();
  if (!s) return false;
  const cut = s.search(/[?#]/);
  const path = cut < 0 ? s : s.slice(0, cut);
  if (cut < 0) return containsSecretLike(path);
  const params = s.slice(cut + 1).split(/[&#;]/).map((p) => p.trim()).filter(Boolean);
  for (const raw of params) {
    const eq = raw.indexOf("=");
    const rawKey = eq < 0 ? raw : raw.slice(0, eq);
    const rawValue = eq < 0 ? "" : raw.slice(eq + 1);
    const decode = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
    if (CREDENTIAL_KEY.test(decode(rawKey))) return true;
    if (rawValue && containsSecretLike(decode(rawValue))) return true;
  }
  return containsSecretLike(path);
}

/**
 * 要落库的链接：凭据形状直接拒收（空串），其余顺手脱敏。
 * `bot_events.url` 走这一个出口，两个入站（webhook / github）就不会各写一份判定。
 */
export function safeLink(url) {
  const s = String(url ?? "").trim();
  if (!s) return "";
  if (linkCarriesCredential(s)) return "";
  return redactSecrets(s).text;
}

/**
 * 对象的浅层脱敏：bot 回合这类「几个已知字符串字段」的结构，逐字段过一遍即可。
 * 不做深拷贝遍历——宁可让调用方显式列出要涂的字段，也不要偷偷改掉别的数据。
 * （模型可控的任意 JSON 用 `redactDeep`。）
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
