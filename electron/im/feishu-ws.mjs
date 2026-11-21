/**
 * 飞书事件长连接（WSClient）。
 *
 * 为什么需要它：飞书后台的「事件订阅」有两种模式——HTTP 回调 或 长连接。
 * 长连接不需要公网域名/加密策略，桌面应用退出即断开。我们的 HTTP 入站只服务
 * 自定义 webhook 与调试；正式接飞书用这条（也是飞书后台标注「推荐」的方式）。
 *
 * SDK 是可选依赖：未安装时 start() 抛错，调用方退回 HTTP 模式，不影响其它渠道。
 */
let sdkPromise = null;
function sdk() {
  if (!sdkPromise) sdkPromise = import("@larksuiteoapi/node-sdk").catch(() => null);
  return sdkPromise;
}

export function createFeishuWs({ getCredentials, onEvent, onLog = console }) {
  let ws = null;
  let started = false;
  let ready = false;
  let lastError = "";

  async function start() {
    const mod = await sdk();
    if (!mod) throw new Error("没有安装 @larksuiteoapi/node-sdk（长连接不可用）");
    const { appId, appSecret } = getCredentials?.() || {};
    if (!appId || !appSecret) throw new Error("未配置飞书 app_id / app_secret");
    if (started) return { ok: true, already: true };
    const dispatcher = new mod.EventDispatcher({});
    dispatcher.register({
      "im.message.receive_v1": async (payload) => {
        try { await onEvent?.(payload); }
        catch (err) { onLog(`feishu ws handler failed: ${String(err?.message || err).slice(0, 200)}`); }
      },
    });
    ws = new mod.WSClient({
      appId,
      appSecret,
      autoReconnect: true,
      onReady: () => { ready = true; onLog("feishu ws ready"); },
      onError: (err) => { ready = false; lastError = String(err?.message || err).slice(0, 200); onLog(`feishu ws error: ${lastError}`); },
      onReconnecting: () => { ready = false; onLog("feishu ws reconnecting"); },
      onReconnected: () => { ready = true; onLog("feishu ws reconnected"); },
    });
    await ws.start({ eventDispatcher: dispatcher });
    started = true;
    lastError = "";
    onLog("feishu ws connected");
    return { ok: true };
  }

  function stop() {
    try { ws?.close?.(); } catch { /* ignore */ }
    ws = null;
    started = false;
    ready = false;
  }

  return { start, stop, status: () => ({ started, ready, lastError }) };
}
