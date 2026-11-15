/**
 * 分段配音：火山引擎（Volcengine）优先，Edge 神经语音作为本地占位。
 *
 * 火山引擎环境变量（凭据不要写进仓库）：
 *   VOLC_TTS_APPID
 *   VOLC_TTS_TOKEN
 *   VOLC_TTS_CLUSTER=volcano_tts
 *   VOLC_TTS_VOICE=<voice_type>
 * 可选：
 *   VOLC_TTS_ENDPOINT（默认 https://openspeech.bytedance.com/api/v1/tts）
 *   VOLC_TTS_SPEED（默认 1.0） / VOLC_TTS_PITCH / VOLC_TTS_VOLUME
 *
 * Edge 占位（无需凭据，需要 uvx）：
 *   EDGE_TTS_VOICE（默认 zh-CN-YunjianNeural）
 *   EDGE_TTS_RATE（默认 -6%） / EDGE_TTS_PITCH（默认 -2Hz）
 *
 * 引擎选择：TTS_ENGINE=volcengine | edge；不设时，有火山凭据用火山，否则 Edge。
 */
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * 也支持从 Pi Agent 的本地配置读取语音凭据（可选）：
 *   ~/.pi/agent/models.json → providers.volcengine.tts = { appid, token, cluster, voice }
 *   ~/.pi/agent/volc-tts.json = { appid, token, cluster, voice }
 * 环境变量优先。注意：models.json 里的 apiKey 是 Ark plan 网关 key，不能用于语音合成。
 */
function readPiTts() {
  const home = os.homedir();
  const read = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };
  const direct = read(path.join(home, ".pi/agent/volc-tts.json"));
  if (direct) return direct;
  const models = read(path.join(home, ".pi/agent/models.json"));
  const node = models?.providers?.volcengine;
  return node?.tts || node?.speech || null;
}

function volcConfig() {
  const pi = readPiTts() || {};
  return {
    appid: process.env.VOLC_TTS_APPID || pi.appid || pi.appId || "",
    token: process.env.VOLC_TTS_TOKEN || pi.token || pi.accessToken || "",
    cluster: process.env.VOLC_TTS_CLUSTER || pi.cluster || "volcano_tts",
    voice: process.env.VOLC_TTS_VOICE || pi.voice || pi.voice_type || "",
    endpoint: process.env.VOLC_TTS_ENDPOINT || pi.endpoint || "https://openspeech.bytedance.com/api/v1/tts",
    speed: Number(process.env.VOLC_TTS_SPEED || pi.speed || 1.0),
    pitch: Number(process.env.VOLC_TTS_PITCH || pi.pitch || 1.0),
    volume: Number(process.env.VOLC_TTS_VOLUME || pi.volume || 1.0),
  };
}

const EDGE = {
  voice: process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural",
  rate: process.env.EDGE_TTS_RATE || "+30%",
  pitch: process.env.EDGE_TTS_PITCH || "-2Hz",
};

function hasVolc() {
  const v = volcConfig();
  return Boolean(v.appid && v.token && v.voice);
}

function engine() {
  const forced = String(process.env.TTS_ENGINE || "").trim().toLowerCase();
  if (forced === "volcengine" || forced === "edge") return forced;
  return hasVolc() ? "volcengine" : "edge";
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const stderr = err.stderr?.toString?.() || "";
    throw new Error(`${cmd} 失败：${stderr || err.message}`);
  }
}

function probe(file) {
  return parseFloat(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
  );
}

function toWav(input, output) {
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ar", "48000", "-ac", "1", output]);
  return probe(output);
}

function synthEdge(scene, outWav) {
  const mp3 = outWav.replace(/\.wav$/, ".mp3");
  run("uvx", [
    "--from", "edge-tts", "edge-tts",
    "--voice", EDGE.voice,
    `--rate=${EDGE.rate}`,
    `--pitch=${EDGE.pitch}`,
    "--text", scene.vo,
    "--write-media", mp3,
  ]);
  return toWav(mp3, outWav);
}

async function synthVolc(scene, outWav) {
  const v = volcConfig();
  if (!hasVolc()) {
    throw new Error("缺少火山语音凭据：VOLC_TTS_APPID / VOLC_TTS_TOKEN / VOLC_TTS_VOICE（或 ~/.pi/agent/volc-tts.json）");
  }
  const body = {
    app: { appid: v.appid, token: v.token, cluster: v.cluster },
    user: { uid: "cockpit-harness" },
    audio: {
      voice_type: v.voice,
      encoding: "wav",
      sample_rate: 48000,
      speed_ratio: v.speed,
      volume_ratio: v.volume,
      pitch_ratio: v.pitch,
    },
    request: {
      reqid: crypto.randomUUID(),
      text: scene.vo,
      operation: "query",
    },
  };

  const res = await fetch(v.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer; ${v.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Volcengine TTS HTTP ${res.status}: ${text.slice(0, 300)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Volcengine TTS 返回非 JSON：${text.slice(0, 300)}`);
  }
  if (json.code !== 3000 || !json.data) {
    throw new Error(`Volcengine TTS ${json.code ?? "?"}: ${json.message || text.slice(0, 300)}`);
  }

  const raw = outWav.replace(/\.wav$/, ".volc");
  fs.writeFileSync(raw, Buffer.from(json.data, "base64"));
  return toWav(raw, outWav);
}

async function synthesize(scene, outWav) {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  const name = engine();
  if (name === "volcengine") return { engine: name, dur: await synthVolc(scene, outWav) };
  if (name === "edge") return { engine: name, dur: synthEdge(scene, outWav) };
  throw new Error(`未知 TTS_ENGINE：${name}`);
}

function describe() {
  const name = engine();
  if (name === "volcengine") {
    const v = volcConfig();
    return `Volcengine · ${v.cluster} · ${v.voice}`;
  }
  return `Edge · ${EDGE.voice} · rate ${EDGE.rate} · pitch ${EDGE.pitch}`;
}

module.exports = { synthesize, describe, engine, hasVolc, probe };
