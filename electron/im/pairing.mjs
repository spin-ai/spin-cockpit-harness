/**
 * 扫码配置（局域网一次性配对页）
 *
 * 为什么不是"扫码拿 app_secret"：飞书不会通过二维码下发应用密钥，
 * 自建应用的 app_id / app_secret 只能在开放平台后台看到。所以这里做的是
 * 「让手机当输入设备」：桌面显示二维码 → 手机扫码打开本地表单 → 粘贴
 * app_id / app_secret / open_id → 提交写回桌面。
 *
 * 安全约束（都是硬要求）：
 *  - 只在这段时间内监听：start() 起、成功一次或 TTL 到就停；
 *  - 128-bit 一次性 token 放在 URL 里，校验失败直接 403；
 *  - 只接受 POST /pair?t=<token>，字段长度受限，secret 不进日志；
 *  - 不读、不列目录，除配对页和提交接口之外没有别的路由。
 *
 * 代价：同一局域网内的人理论上能扫到/猜到 token 的概率极低但不为零，
 * 所以页面顶部会写明「仅在可信网络下使用」，并在成功后立刻关闭监听。
 */
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";

const TTL_MS = 10 * 60 * 1000;
const MAX_FIELD = 512;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      out.push(item.address);
    }
  }
  return out;
}

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page({ token, title, body, note = "" }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escape(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;padding:24px 18px 40px;font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#fafafa;color:#111}
  @media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#f0f0f0}input{background:#171717!important;border-color:#333!important;color:#f0f0f0!important}}
  main{max-width:520px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px;letter-spacing:-.02em}
  p.sub{margin:0 0 18px;color:#6b6b6b;font-size:13px}
  label{display:block;margin:14px 0 4px;font-size:12px;color:#6b6b6b}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dcdcdc;border-radius:8px;font:15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#fff}
  button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#111;color:#fff;font-size:16px;font-weight:600}
  .note{margin-top:16px;padding:10px 12px;border:1px solid #e5e5e5;border-radius:8px;font-size:12px;color:#6b6b6b;line-height:1.6}
  .warn{border-color:#f2e3c4;background:#fdf8ee;color:#8a6420}
  .ok{border-color:#d5eedf;background:#edf8f2;color:#256e4a}
  input[type=hidden]{display:none}
</style></head><body><main>
<h1>${escape(title)}</h1>
${note}
${body}
</main></body></html>`;
}

export function createPairing({ onSave, ttlMs = TTL_MS, log = console } = {}) {
  let server = null;
  let token = "";
  let expiresAt = 0;
  let timer = null;
  let saved = false;

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (server) { try { server.close(); } catch { /* ignore */ } server = null; }
    token = "";
    expiresAt = 0;
  }

  function status() {
    return { active: Boolean(server), expiresAt, saved };
  }

  async function start() {
    stop();
    token = crypto.randomBytes(16).toString("hex");
    expiresAt = Date.now() + ttlMs;
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const send = (code, html) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); };

      if (url.pathname !== "/pair") { send(404, page({ title: "没有这个页面", body: "<p class=note>这个地址只在扫码配置期间有效。</p>" })); return; }
      if (url.searchParams.get("t") !== token) { send(403, page({ title: "链接已失效", body: "<p class=note>二维码只能用一次，或已过期。回到桌面端点「重新生成」。</p>" })); return; }

      if (req.method === "GET") {
        send(200, page({
          title: "把飞书应用凭据写到桌面",
          note: `<div class="note warn">仅在可信网络下使用。提交成功后这个页面立刻失效。</div>`,
          body: `<p class="sub">在飞书开放平台 → 应用 →「凭证与基础信息」里复制 App ID 和 App Secret；填完点下面的按钮。</p>
<form method="POST" action="/pair?t=${escape(token)}">
  <label>App ID</label><input name="app_id" placeholder="cli_xxxxxxxx" maxlength="${MAX_FIELD}" autocomplete="off" required>
  <label>App Secret</label><input name="app_secret" type="password" placeholder="只写到本机，加密存储" maxlength="${MAX_FIELD}" autocomplete="off" required>
  <label>允许的 open_id / chat_id（可选，逗号分隔）</label><input name="allow_ids" placeholder="ou_xxx, oc_xxx" maxlength="${MAX_FIELD}" autocomplete="off">
  <button type="submit">写入桌面端</button>
</form>`,
        }));
        return;
      }

      if (req.method === "POST") {
        if (saved) { send(409, page({ title: "已经用过了", body: "<p class=note>一个二维码只能配置一次。</p>" })); return; }
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 8 * 1024) break; }
        const form = new URLSearchParams(raw);
        const appId = String(form.get("app_id") || "").trim().slice(0, MAX_FIELD);
        const appSecret = String(form.get("app_secret") || "").trim().slice(0, MAX_FIELD);
        const allowIds = String(form.get("allow_ids") || "").trim().slice(0, MAX_FIELD);
        if (!/^cli_[A-Za-z0-9]+$/.test(appId) || appSecret.length < 8) {
          send(400, page({ title: "格式不对", body: `<p class=note>App ID 应以 <code>cli_</code> 开头；App Secret 至少 8 位。返回上一页重填。</p>` }));
          return;
        }
        try {
          await onSave?.({ appId, appSecret, allowIds });
          saved = true;
          send(200, page({ title: "已写入桌面端", body: "<div class=note ok>凭据已保存（secret 加密落盘）。可以关闭这个页面，回到桌面点「探测」。</div>" }));
          log.info?.(`[pairing] feishu credentials saved for ${appId}`);
        } catch (err) {
          send(500, page({ title: "写入失败", body: `<p class=note>${escape(String(err?.message || err)).slice(0, 200)}</p>` }));
        } finally {
          setTimeout(stop, 400);
        }
        return;
      }

      send(405, page({ title: "不支持的方法", body: "" }));
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", resolve);
    });
    const port = server.address().port;
    const host = lanAddresses()[0] || "127.0.0.1";
    const url = `http://${host}:${port}/pair?t=${token}`;
    timer = setTimeout(() => { stop(); log.info?.("[pairing] expired"); }, ttlMs);
    timer.unref?.();
    return { url, port, expiresAt };
  }

  return { start, stop, status };
}
