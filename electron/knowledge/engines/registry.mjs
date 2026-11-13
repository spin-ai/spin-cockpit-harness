/**
 * 引擎注册表 + 路由层（对应 WeKnora 的 EngineRegistration / NewReader）。
 *
 * 每个引擎只需要提供：
 *   name / label / description / fileTypes
 *   checkAvailable(config)     纯配置检查，不联网（列表用）
 *   probe(config)              联网探测（用户点「探测」时用）
 *   createReader(config)       → { read({ file, bytes, fileName, fileType }) }
 *
 * 路由规则（与 WeKnora 一致，落到本地形态）：
 *   1. 显式 engine 且已注册 → 用它；不可用直接报错，不静默换引擎
 *   2. 未显式指定 + 简单格式 → simple（本地纯文本）
 *   3. 未显式指定 + 其余 → defaultEngine（默认 builtin 本地文档）
 *   4. 未知 engine → fallbackEngine，并记录 routing warning
 */

import fs from "node:fs/promises";
import path from "node:path";
import { EngineError, fileExt, normalizePages, nowMs } from "./http.mjs";
import { localEngines, simpleEngine } from "./local.mjs";
import { createMineruCloudEngine, createMineruEngine } from "./mineru.mjs";
import { createPaddleCloudEngine, createPaddleEngine } from "./paddle.mjs";
import { createCustomEngine } from "./custom.mjs";
import { resolveEngineConfig } from "./config.mjs";

const REQUIRED = ["name", "label", "fileTypes", "checkAvailable", "probe", "createReader"];

export function assertEngine(engine) {
  for (const key of REQUIRED) {
    if (engine?.[key] === undefined) throw new Error(`引擎 ${engine?.name || "?"} 缺少 ${key}`);
  }
  if (!Array.isArray(engine.fileTypes)) throw new Error(`引擎 ${engine.name} 的 fileTypes 必须是数组`);
  return engine;
}

export function isSimpleFormat(fileType) {
  return simpleEngine.fileTypes.includes(String(fileType || "").toLowerCase());
}

function supports(engine, fileType) {
  if (!fileType) return true;
  if (engine.fileTypes.includes("*")) return true;
  return engine.fileTypes.includes(String(fileType).toLowerCase().replace(/^\./, ""));
}

function reasonText(route) {
  switch (route) {
    case "explicit": return "指定引擎";
    case "simple-format": return "简单格式走本地";
    case "default": return "默认引擎";
    case "fallback": return "回退到本地文档引擎";
    case "unknown-engine": return "未知引擎，已回退";
    case "unavailable-fallback": return "目标引擎不可用，已回退";
    case "unsupported-fallback": return "目标引擎不支持该格式，已回退";
    default: return route;
  }
}

/**
 * @param {{
 *   configStore: ReturnType<import("./config.mjs").createEngineConfigStore>,
 *   logger?: Console,
 *   fetchImpl?: typeof fetch,
 *   signal?: AbortSignal,
 * }} opts
 */
export function createEngineRegistry({ configStore, logger = console, fetchImpl, extraEngines = [] } = {}) {
  if (!configStore) throw new Error("createEngineRegistry 需要 configStore");
  const map = new Map();
  const registered = [];

  function rebuild() {
    map.clear();
    for (const engine of [
      ...localEngines,
      createMineruEngine(),
      createMineruCloudEngine(),
      createPaddleEngine(),
      createPaddleCloudEngine(),
      ...extraEngines,
      ...registered,
    ]) {
      assertEngine(engine);
      map.set(engine.name, engine);
    }
    // 用户配置里的自研引擎：一个 name 一个 HTTP 转换器
    for (const extra of configStore.load().extras || []) {
      if (!extra?.name || map.has(extra.name)) continue;
      map.set(extra.name, assertEngine(createCustomEngine(extra)));
    }
    // 显式的 custom 槽位
    if (!map.has("custom")) map.set("custom", assertEngine(createCustomEngine({ name: "custom", label: "自定义引擎" })));
  }
  rebuild();

  function configFor(name) {
    return resolveEngineConfig(configStore.load(), name) || {};
  }

  function availability(name) {
    const engine = map.get(name);
    if (!engine) return { available: false, reason: "未注册" };
    try {
      return engine.checkAvailable(configFor(name)) || { available: true, reason: "" };
    } catch (error) {
      return { available: false, reason: String(error?.message || error) };
    }
  }

  function list() {
    const config = configStore.load();
    const publicCfg = configStore.public();
    const out = [];
    for (const engine of map.values()) {
      const cfg = resolveEngineConfig(config, engine.name) || {};
      const pub = publicCfg.engines?.[engine.name]
        || (publicCfg.extras || []).find((item) => item.name === engine.name)
        || {};
      const { available, reason } = availability(engine.name);
      out.push({
        name: engine.name,
        label: engine.label,
        description: engine.description || "",
        local: Boolean(engine.local),
        fileTypes: engine.fileTypes,
        requires: engine.requires || [],
        available,
        reason,
        enabled: cfg.enabled !== false,
        config: pub,
      });
    }
    return out;
  }

  async function probe(name) {
    const engine = map.get(name);
    if (!engine) throw new EngineError(`未注册的引擎：${name}`, { code: "engine-unknown" });
    try {
      const result = await engine.probe(configFor(name), { fetchImpl, logger });
      return { name, ...(result || { available: true, reason: "" }) };
    } catch (error) {
      return { name, available: false, reason: String(error?.message || error), code: error?.code };
    }
  }

  function choose({ requested, fileType }) {
    const config = configStore.load();
    const fallback = map.has(config.fallbackEngine) ? config.fallbackEngine : "builtin";
    const warnings = [];
    const explicit = requested && requested !== "auto" ? String(requested) : "";
    let name;
    let route;

    if (explicit) {
      if (!map.has(explicit)) {
        name = fallback;
        route = "unknown-engine";
        warnings.push(`未知引擎 ${explicit}，已回退到 ${fallback}`);
      } else {
        name = explicit;
        route = "explicit";
      }
    } else if (isSimpleFormat(fileType)) {
      name = "simple";
      route = "simple-format";
    } else if (config.defaultEngine && config.defaultEngine !== "auto" && map.has(config.defaultEngine)) {
      name = config.defaultEngine;
      route = "default";
    } else {
      name = fallback;
      route = "fallback";
    }

    let engine = map.get(name) || map.get("builtin");
    let status = availability(engine.name);
    if (!status.available && route !== "explicit") {
      const fallbackEngine = map.get(fallback);
      if (fallbackEngine && engine.name !== fallbackEngine.name && availability(fallbackEngine.name).available) {
        warnings.push(`${engine.label || engine.name} 不可用（${status.reason}），已回退到 ${fallbackEngine.label}`);
        engine = fallbackEngine;
        route = "unavailable-fallback";
        status = availability(engine.name);
      }
    }
    if (route !== "explicit" && !supports(engine, fileType)) {
      const fallbackEngine = map.get(fallback);
      if (fallbackEngine && engine.name !== fallbackEngine.name && supports(fallbackEngine, fileType)) {
        warnings.push(`${engine.label || engine.name} 不支持 .${fileType}，已回退到 ${fallbackEngine.label}`);
        engine = fallbackEngine;
        route = "unsupported-fallback";
        status = availability(engine.name);
      }
    }
    if (!status.available) {
      if (route === "explicit") {
        throw new EngineError(`引擎 ${engine.label || engine.name} 不可用：${status.reason}`, {
          code: "engine-unavailable",
          detail: status.reason,
        });
      }
      throw new EngineError(`没有可用的解析引擎：${status.reason}`, { code: "engine-unavailable", detail: status.reason });
    }
    return { engine, route, warnings, explicit };
  }

  /**
   * @param {{ file: string, engine?: string, signal?: AbortSignal }} input
   */
  async function parse({ file, engine: requested, signal } = {}) {
    if (!file) throw new EngineError("缺少待解析文件", { code: "not-found" });
    const fileName = path.basename(file);
    const fileType = fileExt(file);
    const { engine, route, warnings, explicit } = choose({ requested, fileType });
    const config = configFor(engine.name);
    const started = nowMs();
    const reader = engine.createReader(config);
    let bytes = null;
    if (!engine.local) {
      try {
        bytes = await fs.readFile(file);
      } catch (error) {
        throw new EngineError(`读取文件失败：${error.message}`, { code: "not-found" });
      }
    }
    try {
      const result = await reader.read({ file, bytes, fileName, fileType, fetchImpl, signal });
      const pages = normalizePages(result?.pages || result);
      if (!pages.length) throw new EngineError("解析结果为空", { code: "empty" });
      return {
        pages,
        engine: engine.name,
        parser: result?.parser || engine.name,
        route: {
          requested: requested || "auto",
          engine: engine.name,
          reason: route,
          summary: reasonText(route),
          warnings,
          explicit,
        },
        elapsedMs: nowMs() - started,
        meta: result?.meta || {},
      };
    } catch (error) {
      const err = error instanceof EngineError
        ? error
        : new EngineError(String(error?.message || error), { code: error?.code || "engine-error" });
      err.engine = engine.name;
      err.elapsedMs = nowMs() - started;
      throw err;
    }
  }

  return {
    list,
    probe,
    parse,
    choose,
    has: (name) => map.has(name),
    get: (name) => map.get(name),
    /** 运行时注册（插件 / 自研模块用）；同名覆盖。 */
    register(engine, { replace = true } = {}) {
      assertEngine(engine);
      if (!replace && map.has(engine.name)) throw new Error(`引擎已存在：${engine.name}`);
      registered.push(engine);
      rebuild();
      return engine;
    },
    reload: rebuild,
    names: () => [...map.keys()],
  };
}
