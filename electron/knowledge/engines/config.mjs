/**
 * 引擎配置：本地 JSON（默认 userData/knowledge/engines.json），可重建。
 *
 * - 端点 / 超时 / 开关直接存明文；
 * - API key / token 交给调用方提供的 seal/open（Electron 下是 safeStorage）；
 *   没有加密能力时退回明文（自检脚本、非 Electron 环境），并在读取时标注。
 * - 公开给渲染进程的配置永远不含密钥，只给 `apiKeySet`。
 */

import fs from "node:fs";
import path from "node:path";

export const SECRET_FIELDS = new Set(["apiKey", "token", "serverApiKey", "secret"]);

export const ENGINE_DEFAULTS = {
  version: 1,
  defaultEngine: "auto", // auto：简单格式走 simple，其余走 fallbackEngine
  fallbackEngine: "builtin",
  engines: {
    simple: { enabled: true, timeoutMs: 60_000 },
    builtin: { enabled: true, timeoutMs: 600_000 },
    mineru: {
      enabled: true, endpoint: "", apiKey: "", timeoutMs: 1_000_000,
      tier: "", ocrMode: "auto", model: "pipeline", language: "ch",
      enableFormula: true, enableTable: true,
    },
    mineru_cloud: {
      enabled: true, apiKey: "", timeoutMs: 1_800_000, baseUrl: "https://mineru.net/api/v4",
      model: "pipeline", language: "ch", enableFormula: true, enableTable: true, enableOcr: true,
    },
    paddleocr_vl: {
      enabled: true, endpoint: "", timeoutMs: 1_000_000,
      useSealRecognition: true, useChartRecognition: false,
    },
    paddleocr_vl_cloud: {
      enabled: true, token: "", timeoutMs: 600_000,
      baseUrl: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
      model: "PaddleOCR-VL-1.6", useSealRecognition: true, useChartRecognition: false,
    },
    custom: {
      enabled: true, endpoint: "", apiKey: "", timeoutMs: 600_000,
      requestMode: "multipart", responseMode: "auto", markdownPath: "markdown",
      fileField: "file", fileTypes: [],
    },
  },
  // 自研引擎预留位：每项都是一个独立的 HTTP 转换器，注册即可路由。
  extras: [],
};

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function mergeConfig(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = isObject(value) && isObject(base?.[key]) ? mergeConfig(base[key], value) : clone(value);
  }
  return out;
}

/** 归一化：补默认值、丢弃未知的旧字段值。 */
export function normalizeConfig(raw = {}) {
  const config = mergeConfig(ENGINE_DEFAULTS, raw);
  if (!config.engines || typeof config.engines !== "object") config.engines = clone(ENGINE_DEFAULTS.engines);
  if (!Array.isArray(config.extras)) config.extras = [];
  config.defaultEngine = String(config.defaultEngine || "auto");
  config.fallbackEngine = String(config.fallbackEngine || "builtin");
  return config;
}

export function resolveEngineConfig(config, name) {
  if (name === "custom") return config.engines.custom;
  if (config.engines[name]) return config.engines[name];
  return config.extras.find((extra) => extra.name === name) || null;
}

function encodeSecrets(value, seal) {
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_FIELDS.has(key) && typeof raw === "string" && raw) {
      if (seal) {
        try {
          out[key] = `v1:${seal(raw)}`;
          continue;
        } catch { /* 退化为明文 */ }
      }
      out[key] = `plain:${raw}`;
    } else if (key === "engines" || key === "extras") {
      out[key] = isObject(raw)
        ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, encodeSecrets(v, seal)]))
        : Array.isArray(raw)
          ? raw.map((item) => encodeSecrets(item, seal))
          : raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

function decodeSecrets(value, open) {
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_FIELDS.has(key) && typeof raw === "string" && raw) {
      if (raw.startsWith("v1:")) {
        try {
          out[key] = open ? open(raw.slice(3)) : "";
        } catch {
          out[key] = "";
        }
      } else if (raw.startsWith("plain:")) {
        out[key] = raw.slice(6);
      } else {
        out[key] = raw; // 旧版本明文
      }
    } else if (key === "engines" || key === "extras") {
      out[key] = isObject(raw)
        ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, decodeSecrets(v, open)]))
        : Array.isArray(raw)
          ? raw.map((item) => decodeSecrets(item, open))
          : raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

function publicEngineConfig(config = {}) {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_FIELDS.has(key)) {
      out[`${key}Set`] = Boolean(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function publicConfig(config) {
  return {
    defaultEngine: config.defaultEngine,
    fallbackEngine: config.fallbackEngine,
    engines: Object.fromEntries(
      Object.entries(config.engines || {}).map(([name, value]) => [name, publicEngineConfig(value)])
    ),
    extras: (config.extras || []).map((extra) => ({
      ...publicEngineConfig(extra),
      name: extra.name,
    })),
  };
}

/**
 * @param {{ file: string, seal?: (v: string) => string, open?: (v: string) => string, logger?: Console }} opts
 */
export function createEngineConfigStore({ file, seal, open, logger = console } = {}) {
  if (!file) throw new Error("缺少引擎配置文件路径");
  let cached = null;

  function load() {
    if (cached) return cached;
    let raw = {};
    try {
      if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      logger?.warn?.(`[knowledge] 引擎配置读取失败，使用默认值：${error.message}`);
      raw = {};
    }
    cached = normalizeConfig(decodeSecrets(raw, open));
    return cached;
  }

  function save(patch) {
    const next = normalizeConfig(mergeConfig(load(), patch || {}));
    cached = next;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = JSON.stringify(encodeSecrets(next, seal), null, 2);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return next;
  }

  function updateEngine(name, patch = {}) {
    const current = load();
    if (name === "custom") {
      return save({ engines: { custom: patch } });
    }
    if (current.engines[name]) {
      return save({ engines: { [name]: patch } });
    }
    const extras = current.extras.map((extra) => (extra.name === name ? mergeConfig(extra, patch) : extra));
    return save({ extras });
  }

  function removeExtra(name) {
    const current = load();
    return save({ extras: current.extras.filter((item) => item.name !== name) });
  }

  function addExtra(extra) {
    if (!extra?.name) throw new Error("自研引擎必须有 name");
    const current = load();
    const extras = current.extras.filter((item) => item.name !== extra.name);
    extras.push(mergeConfig({
      enabled: true, endpoint: "",
      timeoutMs: 600_000, requestMode: "multipart", responseMode: "auto",
      markdownPath: "markdown", fileField: "file", fileTypes: [],
    }, extra));
    return save({ extras });
  }

  return {
    file,
    load,
    save,
    updateEngine,
    addExtra,
    removeExtra,
    public: () => publicConfig(load()),
    engine: (name) => resolveEngineConfig(load(), name),
    setDefaultEngine: (name) => save({ defaultEngine: name }),
    hasSecret: (name) => {
      const config = resolveEngineConfig(load(), name);
      return Boolean(config && [...SECRET_FIELDS].some((field) => config[field]));
    },
  };
}
