#!/usr/bin/env node
/**
 * Minimal ACP fake for E2E tests: no model, no network.
 * - first session/prompt emits a chunk and holds for FAKE_DSH_HOLD_MS
 * - later session/prompt calls act as steer and resolve immediately
 */
import fs from "node:fs";
import readline from "node:readline";

const HOLD = Number(process.env.FAKE_DSH_HOLD_MS || 2500);
const LOG = process.env.FAKE_DSH_LOG || "";
function log(line) { if (LOG) { try { fs.appendFileSync(LOG, `${Date.now()} ${line}\n`); } catch { /* ignore */ } } }
log(`start pid=${process.pid} hold=${HOLD} cwd=${process.cwd()} argv=${JSON.stringify(process.argv.slice(2))}`);
process.on("uncaughtException", (err) => { log(`uncaught pid=${process.pid} ${err?.stack || err}`); process.exit(1); });
process.on("unhandledRejection", (err) => { log(`rejection pid=${process.pid} ${err?.stack || err}`); });
process.on("exit", (code) => log(`exit pid=${process.pid} code=${code}`));
let sessionId = "fake-session";
let prompts = 0;

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}
function chunk(text) {
  notify("session/update", {
    sessionId,
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) {
    if (msg.method === "session/cancel") process.exit(0);
    return;
  }
  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: 1,
        agentInfo: { name: "fake-dsh", version: "0.0.0" },
        agentCapabilities: { mcpCapabilities: { http: false }, promptCapabilities: {}, sessionCapabilities: {} },
        authMethods: [],
      });
      break;
    case "session/new":
      sessionId = `fake-${Date.now()}`;
      respond(msg.id, { sessionId, configOptions: [] });
      break;
    case "session/set_config_option":
      respond(msg.id, null);
      break;
    case "session/prompt": {
      prompts += 1;
      const prompt = msg.params?.prompt?.map((p) => p.text || "").join(" ") || "";
      log(`prompt #${prompts} pid=${process.pid} text=${prompt.slice(0,40)}`);
      const steer = prompts > 1;
      setTimeout(() => chunk(`${steer ? "steer" : "fake"}: ${prompt.slice(0, 120)}`), 50);
      if (steer) {
        log(`respond steer #${prompts} pid=${process.pid}`);
        respond(msg.id, { stopReason: "end_turn" });
      } else {
        setTimeout(() => { log(`respond first #${prompts} pid=${process.pid}`); respond(msg.id, { stopReason: "end_turn" }); }, HOLD);
      }
      break;
    }
    case "session/close":
      respond(msg.id, null);
      break;
    default:
      respond(msg.id, null);
  }
});
rl.on("close", () => { log(`stdin close pid=${process.pid}`); });
