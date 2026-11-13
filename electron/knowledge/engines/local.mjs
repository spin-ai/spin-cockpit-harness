/**
 * 本地引擎：不联网，直接调用仓库里已有的解析库。
 *
 * simple  = 纯文本类（md/txt/csv/json/html...），永远可用
 * builtin = PDF / Office / EPUB，走 unpdf / mammoth / xlsx / officeparser / epub2
 *
 * 对应 WeKnora 的 simple + builtin（它把 builtin 放在 Python docreader，
 * 这里落到本地 Node 库，保持"离线可用"）。
 */

import { parseFile } from "../parse.mjs";
import { EngineError, normalizePages } from "./http.mjs";

export const SIMPLE_FILE_TYPES = [
  "md", "markdown", "txt", "text", "log", "csv", "json", "yaml", "yml",
  "ini", "toml", "sql", "js", "mjs", "ts", "tsx", "jsx", "py", "go", "rs",
  "java", "c", "h", "cpp", "sh", "zsh", "html", "htm",
];

const BUILTIN_FILE_TYPES = ["pdf", "docx", "xlsx", "xls", "pptx", "pptm", "odt", "ods", "odp", "epub"];

export const simpleEngine = {
  name: "simple",
  label: "本地文本",
  description: "Markdown / TXT / CSV / JSON / 代码，离线直接读，不交给外部引擎。",
  local: true,
  fileTypes: SIMPLE_FILE_TYPES,
  checkAvailable: (config) => (config?.enabled === false
    ? { available: false, reason: "已在设置中停用" }
    : { available: true, reason: "" }),
  probe: (config) => simpleEngine.checkAvailable(config),
  createReader: () => ({
    async read({ file, fileType }) {
      if (fileType && !SIMPLE_FILE_TYPES.includes(fileType)) {
        throw new EngineError(`simple 不处理 .${fileType}`, { code: "unsupported" });
      }
      const { pages, parser } = await parseFile(file);
      return { pages: normalizePages(pages), parser: parser || "text" };
    },
  }),
};

export const builtinEngine = {
  name: "builtin",
  label: "本地文档",
  description: "PDF / Word / Excel / PPT / EPUB，用本地库解析；扫描件仍会走 VLM 兜底。",
  local: true,
  fileTypes: BUILTIN_FILE_TYPES,
  checkAvailable: (config) => (config?.enabled === false
    ? { available: false, reason: "已在设置中停用" }
    : { available: true, reason: "" }),
  probe: (config) => builtinEngine.checkAvailable(config),
  createReader: () => ({
    async read({ file }) {
      const { pages, parser } = await parseFile(file);
      if (!pages?.length) throw new EngineError("本地解析结果为空", { code: "empty" });
      return { pages: normalizePages(pages), parser: parser || "builtin" };
    },
  }),
};

export const localEngines = [simpleEngine, builtinEngine];
