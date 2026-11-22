import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";
import { EmptyState } from "./EmptyState";
import { Tabs } from "./Tabs";
import { useT } from "../i18n";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { ZhulongOverlay, type ZhBlock, type ZhRelation } from "./ZhulongOverlay";

type Act = (type: string, payload?: unknown) => Promise<any>;

const PLUGIN_ID = "ai.cockpit.zhulong";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const SCENES = [
  { id: "arch", label: "架构图", desc: "手绘 / 白板，区块 + 箭头关系" },
  { id: "ui", label: "界面截图", desc: "控件与文字，低分辨率不可靠" },
  { id: "pdf", label: "PDF 页面", desc: "版面区块：标题 / 表格 / 图" },
  { id: "ppt", label: "拍照 PPT", desc: "透视与反光会拉低检测" },
] as const;

type CheckRow = { name: string; ok: boolean; level: "ok" | "warn" | "fail"; detail: string };
type ZhResult = {
  backend: string;
  scene: string;
  size: [number, number];
  source: { mime: string; bytes: number };
  blocks: ZhBlock[];
  relations: ZhRelation[];
  checks: CheckRow[];
  warnings: string[];
  elapsedMs: number;
};
type SettingRow = {
  key: string;
  type: string;
  title: string;
  description?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  value: unknown;
  hasValue?: boolean;
};

const BACKEND_LABEL: Record<string, string> = { zhulong: "zhulong-vl", openai: "外部 API", custom: "自定义 HTTP" };
const LEVEL_LABEL: Record<CheckRow["level"], string> = { ok: "通过", warn: "注意", fail: "不通过" };

/**
 * 视图级会话记忆：切到别的页面再回来时，图片与上一次结果还在。
 * 只放内存（不落盘）：图片是 data URL，最多 12MB，写库等于把截图留档，和隐私口径冲突。
 */
type ZhSession = {
  imageUrl: string;
  imageName: string;
  imageBytes: number;
  scene: string;
  result: ZhResult | null;
  tab: "blocks" | "relations" | "json";
  highlight: string[];
};
let session: ZhSession | null = null;

/** 选中区块的坐标读数：线上是 [x,y,w,h]，这里 bbox 已经是 xyxy */
const bboxText = (bbox: [number, number, number, number]) => {
  const [x1, y1, x2, y2] = bbox;
  return `${Math.round(x1)},${Math.round(y1)} · ${Math.round(x2 - x1)}×${Math.round(y2 - y1)}`;
};

/** IPC 抛出来的错误带一长串前缀，界面上只留最后一句 */
function cleanError(err: unknown) {
  return String((err as Error)?.message || err)
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "")
    .replace(/^Error:\s*/, "");
}

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
  reader.readAsDataURL(file);
});

/**
 * 视觉解析（插件视图）
 *
 * 交互骨架来自 zhulong 验证台（选场景 → 选图 → 解析 → 核对 / 区块 / JSON），
 * 版式按本仓库 DESIGN-SYSTEM 重排：
 *   页 = canvas + 一个主面；左侧配置、中间图面、右侧核对，分节用 hairline 不用卡片边框。
 */
export function Zhulong({ state, act, notify, onOpenSettings }: {
  state: State;
  act: Act;
  notify: (message: string) => void;
  onOpenSettings: () => void;
}) {
  const plugin = state.plugins?.find((p) => p.id === PLUGIN_ID);
  const enabled = Boolean(plugin?.enabled);

  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // 选图后自动解析（截图 workflow 的关键：少点一次）；存在 localStorage，不写库
  const [autoParse, setAutoParse] = useState(() => {
    try { return localStorage.getItem("zh.autoParse") !== "0"; } catch { return true; }
  });
  const [scene, setScene] = useState<string>(session?.scene || "arch");
  const [imageUrl, setImageUrl] = useState(session?.imageUrl || "");
  const [imageName, setImageName] = useState(session?.imageName || "");
  const [imageBytes, setImageBytes] = useState(session?.imageBytes || 0);
  const [natural, setNatural] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<ZhResult | null>(session?.result || null);
  const [tab, setTab] = useState<"blocks" | "relations" | "json">(session?.tab || "blocks");
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
  const [showBlocks, setShowBlocks] = useState(true);
  const [showRelations, setShowRelations] = useState(true);
  const [highlight, setHighlight] = useState<string[]>(session?.highlight || []);
  const [hoverId, setHoverId] = useState("");
  const [filter, setFilter] = useState<null | "low" | "notext" | "outside">(null);
  const [drag, setDrag] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  // 状态变化就写回 session（组件卸载后仍可恢复）
  useEffect(() => {
    session = { imageUrl, imageName, imageBytes, scene, result, tab, highlight };
  }, [imageUrl, imageName, imageBytes, scene, result, tab, highlight]);

  const loadSettings = useCallback(async () => {
    if (!enabled) { setSettings({}); return; }
    try {
      const rows = (await act("pluginSettings", { id: PLUGIN_ID })) as SettingRow[] | null;
      const map: Record<string, unknown> = {};
      for (const row of rows || []) map[row.key] = row.value;
      setSettings(map);
      setSettingsLoaded(true);
    } catch (err) {
      setError(String((err as Error)?.message || err));
    }
  }, [act, enabled]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  // 解析要等大模型（3–30s），按钮上给秒数，别让人以为卡死
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  const elapsed = busy && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  const t = useT();
  const backend = String(settings.backend || "zhulong");
  const endpoint = String(settings.endpoint || "");
  const size: [number, number] = result?.size?.[0] ? result.size : natural;

  // 场景 / 自动解析要在回调里拿到最新值（accept 会被 paste / drop 复用）
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const imageRef = useRef(imageUrl);
  imageRef.current = imageUrl;
  const autoRef = useRef(autoParse);
  autoRef.current = autoParse;

  const parseWith = useCallback(async (url: string, sceneArg: string) => {
    if (!url) return;
    setBusy(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    setError("");
    try {
      // 这里不用 act：它会把错误吞成 toast，解析失败原因必须留在 banner 里
      const res = await window.harness.action("pluginRunCommand", {
        pluginId: PLUGIN_ID,
        commandId: "zhulong.parse",
        args: { image: url, scene: sceneArg },
      });
      const out = res?.result as ZhResult | null;
      if (!out) throw new Error("插件没有返回解析结果");
      setResult(out);
      setHighlight([]);
      setTab("blocks");
      notify(`解析完成：${out.blocks.length} 个区块 · ${(out.elapsedMs / 1000).toFixed(1)}s`);
      // 结果表在画布下方，窗口矮的时候要主动滚过去，否则「看不到结果」
      window.setTimeout(() => tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
    } catch (err) {
      const message = cleanError(err);
      const cancelled = /abort|已取消/i.test(message);
      setError(cancelled ? "已取消" : message);
      notify(cancelled ? "已取消解析" : message);
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const cancel = useCallback(async () => {
    try { await window.harness.action("pluginCancel", { pluginId: PLUGIN_ID }); }
    catch (err) { notify(cleanError(err)); }
  }, [notify]);

  const accept = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { notify("只支持图片文件"); return; }
    if (file.size > MAX_IMAGE_BYTES) { notify(`图片太大：${(file.size / 1024 / 1024).toFixed(1)}MB > 12MB`); return; }
    try {
      const url = await readAsDataUrl(file);
      setImageUrl(url);
      setImageName(file.name || "图片");
      setImageBytes(file.size || 0);
      setNatural([0, 0]);
      setResult(null);
      setProbe(null);
      setError("");
      if (autoRef.current) void parseWith(url, sceneRef.current);
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  }, [notify, parseWith]);

  const run = useCallback(() => {
    if (!imageUrl) { notify("先选一张图片，或直接 ⌘V 粘贴截图"); return; }
    void parseWith(imageUrl, scene);
  }, [imageUrl, notify, parseWith, scene]);

  /** 剪贴板图片：截图 workflow 的主入口（比拖文件快） */
  const pasteFromClipboard = useCallback(async () => {
    const res = await window.harness.clipboardReadImage();
    if (!res?.ok || !res.dataUrl) { notify(res?.error || "剪贴板里没有图片"); return; }
    const bytes = Math.round((res.dataUrl.length * 3) / 4);
    setImageUrl(res.dataUrl);
    setImageName("剪贴板图片");
    setImageBytes(bytes);
    setNatural([res.size?.width || 0, res.size?.height || 0]);
    setResult(null);
    setProbe(null);
    setError("");
    if (autoRef.current) void parseWith(res.dataUrl, sceneRef.current);
    else notify("已从剪贴板取图，按 ⌘↵ 解析");
  }, [notify, parseWith]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = [...(event.clipboardData?.items || [])].find((it) => it.kind === "file" && /^image\//.test(it.type));
      const file = item?.getAsFile();
      if (!file) return; // 纯文本粘贴不拦，别影响输入框
      event.preventDefault();
      void accept(file);
    };
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key !== "Enter") return;
      if (!imageRef.current) return;
      event.preventDefault();
      void parseWith(imageRef.current, sceneRef.current);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [accept, parseWith]);

  const runProbe = useCallback(async () => {
    setProbe(null);
    try {
      const res = await window.harness.action("pluginRunCommand", { pluginId: PLUGIN_ID, commandId: "zhulong.probe", args: {} });
      const out = res?.result as { ok: boolean; detail: string } | null;
      setProbe(out ? { ok: out.ok, detail: out.detail } : { ok: false, detail: "探测没有返回结果" });
    } catch (err) {
      setProbe({ ok: false, detail: cleanError(err) });
    }
  }, []);

  const copyJson = useCallback(async () => {
    if (!result) return;
    const text = JSON.stringify({
      backend: result.backend,
      scene: result.scene,
      size: result.size,
      blocks: result.blocks,
      relations: result.relations,
    }, null, 2);
    try { await navigator.clipboard.writeText(text); notify("已复制 JSON"); }
    catch { notify("复制失败：剪贴板不可用"); }
  }, [notify, result]);

  const copyMarkdown = useCallback(async () => {
    if (!result) return;
    try {
      const res = (await act("pluginInvoke", { pluginId: PLUGIN_ID, method: "zhulong.markdown", args: { result } })) as { text?: string } | null;
      if (!res?.text) throw new Error("插件没有返回 Markdown");
      await navigator.clipboard.writeText(res.text);
      notify(`已复制 Markdown（${res.text.length} 字）`);
    } catch (err) {
      notify(cleanError(err));
    }
  }, [act, notify, result]);

  // 存为资料：markdown 进知识库，块级信息走 sidecar（引用仍是页级，后续再升块级）
  const saveToKnowledge = useCallback(async () => {
    if (!result) return;
    try {
      const md = (await act("pluginInvoke", { pluginId: PLUGIN_ID, method: "zhulong.markdown", args: { result } })) as { text?: string } | null;
      if (!md?.text) throw new Error("插件没有返回 Markdown");
      const payload = {
        savedAt: new Date().toISOString(),
        scene: result.scene,
        backend: result.backend,
        size: result.size,
        elapsedMs: result.elapsedMs,
        blocks: result.blocks,
        relations: result.relations,
        checks: result.checks,
        warnings: result.warnings,
      };
      const res = (await act("knowledgeIngestText", {
        title: `视觉解析 · ${SCENES.find((s) => s.id === result.scene)?.label || result.scene}`,
        text: md.text,
        url: `zhulong://${result.scene}/${Date.now()}`,
        blocks: payload,
      })) as { ok?: boolean; docId?: string; skipped?: string } | null;
      if (res?.ok) notify(res.skipped ? "这份解析已经在资料库里（内容相同）" : `已存入资料（${res.docId?.slice(0, 8)}…），块级信息存在 sidecar`);
      else notify("存入资料失败");
    } catch (err) {
      notify(cleanError(err));
    }
  }, [act, notify, result]);

  const save = useCallback(async () => {
    if (!result) return;
    try {
      const res = (await act("pluginInvoke", { pluginId: PLUGIN_ID, method: "zhulong.save", args: { result } })) as { ok?: boolean; dir?: string } | null;
      if (res?.ok) notify(`已保存到 ${res.dir}（blocks.json + result.md）`);
      else notify("保存失败：插件没有返回结果");
    } catch (err) {
      notify(cleanError(err));
    }
  }, [act, notify, result]);

  // 交给 Agent：插件把结构化摘要写进 Chat 草稿，人确认后再发；不自动起 run
  const handoff = useCallback(async () => {
    if (!result) return;
    try {
      const res = (await act("pluginInvoke", {
        pluginId: PLUGIN_ID,
        method: "zhulong.handoff",
        args: { result },
      })) as { ok?: boolean; chars?: number } | null;
      if (res?.ok) notify(`已放进 Chat 草稿（${res.chars || 0} 字），切到工作区确认后发送`);
      else notify("交给 Agent 失败：插件没有返回结果");
    } catch (err) {
      notify(cleanError(err));
    }
  }, [act, notify, result]);

  const stats = useMemo(() => {
    if (!result) return null;
    const failing = result.checks.filter((c) => c.level !== "ok").length;
    const low = result.blocks.filter((b) => b.conf !== null && b.conf < 0.5).length;
    const noText = result.blocks.filter((b) => !b.text.trim()).length;
    const outside = result.blocks.filter((b) => b.bbox[0] < 0 || b.bbox[1] < 0 || b.bbox[2] > result.size[0] || b.bbox[3] > result.size[1]).length;
    return { blocks: result.blocks.length, relations: result.relations.length, failing, low, noText, outside };
  }, [result]);

  // 筛选：核对项下钻、表头 chips 共用同一套语义
  const visibleBlocks = useMemo(() => {
    if (!result) return [];
    if (filter === "low") return result.blocks.filter((b) => b.conf !== null && b.conf < 0.5);
    if (filter === "notext") return result.blocks.filter((b) => !b.text.trim());
    if (filter === "outside") return result.blocks.filter((b) => b.bbox[0] < 0 || b.bbox[1] < 0 || b.bbox[2] > result.size[0] || b.bbox[3] > result.size[1]);
    return result.blocks;
  }, [filter, result]);
  const visibleIds = useMemo(() => new Set(visibleBlocks.map((b) => b.id)), [visibleBlocks]);
  const dimIds = useMemo(() => {
    if (!filter || !result) return undefined;
    return new Set(result.blocks.filter((b) => !visibleIds.has(b.id)).map((b) => b.id));
  }, [filter, result, visibleIds]);
  const blockById = useMemo(() => new Map((result?.blocks || []).map((b, i) => [b.id, { block: b, index: i + 1 }])), [result]);
  const labelOf = (id: string) => {
    const hit = blockById.get(id);
    if (!hit) return id || "?";
    // 没有文字时给「类型 #序号」，不能只显示 box（5 条关系全是 box 就没法核对）
    return hit.block.text.trim() || `${hit.block.type} #${hit.index}`;
  };
  const reveal = () => window.setTimeout(() => tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  const focusBlock = (id: string, { scroll = true } = {}) => {
    setHighlight([id]);
    setTab("blocks");
    if (scroll) window.setTimeout(() => rowRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
  };

  // 核对项 → 下钻动作：结论必须能变成可操作的列表，否则只是一句判断
  const checkAction = (name: string): (() => void) | null => {
    if (!result) return null;
    if (name.includes("置信度")) return () => { setFilter("low"); setTab("blocks"); reveal(); };
    if (name.includes("有文字")) return () => { setFilter("notext"); setTab("blocks"); reveal(); };
    if (name.includes("坐标在图像内")) return () => { setFilter("outside"); setTab("blocks"); reveal(); };
    if (name.includes("关系") || name.includes("箭头")) return () => { setTab("relations"); reveal(); };
    return null;
  };

  if (!enabled) {
    return (
      <div className="page zh-page">
        <PageHeader title={t("page.visual")} subtitle="把手绘架构图 / 界面截图 / PDF 页面解析成区块与关系" />
        <EmptyState
          mark="◇"
          title="视觉解析插件未启用"
          desc="启用后在这里选图和运行；解析后端（zhulong-vl 部署 / 外部 API）在设置 → 插件里配置。"
          action={<button className="btn" onClick={onOpenSettings}>去设置 → 插件</button>}
        />
      </div>
    );
  }

  const unconfigured = settingsLoaded && !endpoint;
  const banner = probe || (error ? { ok: false, detail: error } : null);

  return (
    <div className="page zh-page">
      <PageHeader
        title={t("page.visual")}
        subtitle={(
          <>
            <span>{BACKEND_LABEL[backend] || backend}</span>
            <span className="mono zh-endpoint" title={endpoint}>{endpoint || "未配置服务地址"}</span>
          </>
        )}
        actions={(
          <>
            <button className="btn" onClick={() => void runProbe()}>{t("action.probeBackend")}</button>
            <button className="btn" disabled={!result || busy} onClick={() => void handoff()} title="把结构化摘要写进 Chat 草稿，人确认后再发">{t("action.handToAgent")}</button>
            {busy ? (
              <button className="btn" onClick={() => void cancel()} title="中断这次解析">取消 · {elapsed}s</button>
            ) : (
              <button className="btn primary" disabled={!imageUrl} title="⌘↵" onClick={() => run()}>
                {result ? `${t("action.reparse")} ⌘↵` : `${t("action.startParse")} ⌘↵`}
              </button>
            )}
          </>
        )}
      />

      {unconfigured && (
        <div className="zh-banner fail">
          <i />
          <span>还没有配置解析后端</span>
          <span className="zh-banner-detail">外部 API（OpenAI 兼容 / 火山 Ark）或自部署 zhulong-vl 二选一；填完回来 ⌘V 粘贴截图即可</span>
          <button className="btn tiny-btn" onClick={onOpenSettings}>去设置 → 插件</button>
        </div>
      )}
      {banner && !unconfigured && (
        <div className={`zh-banner ${banner.ok ? "ok" : /已取消/.test(banner.detail) ? "muted" : "fail"}`}>
          <i />
          <span>{banner.ok ? "后端可达" : /已取消/.test(banner.detail) ? "已取消" : "解析不可用"}</span>
          <span className="zh-banner-detail" title={banner.detail}>{banner.detail}</span>
        </div>
      )}

      <div className="zh-grid">
        <aside className="zh-side">
          <section className="zh-block">
            <div className="zh-label">场景</div>
            <div className="zh-list">
              {SCENES.map((item) => (
                <button key={item.id} className={`zh-item ${scene === item.id ? "on" : ""}`} onClick={() => setScene(item.id)}>
                  <b>{item.label}</b>
                  <span>{item.desc}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="zh-block">
            <div className="zh-label">图片</div>
            <div
              className={`zh-drop ${drag ? "on" : ""} ${imageUrl ? "filled" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDrag(false);
                const file = event.dataTransfer.files?.[0];
                if (!file) { notify("没有读到文件：请直接拖入图片文件（不是图片预览窗口）"); return; }
                void accept(file);
              }}
              onClick={() => fileRef.current?.click()}
            >
              <b>{imageUrl ? imageName : "⌘V 粘贴截图"}</b>
              <span>{imageUrl ? "点击换一张" : "或拖入 / 点击选择"}</span>
              <span className="zh-drop-hint">
                {imageBytes ? `${(imageBytes / 1024).toFixed(0)} KB · ${size[0] || "?"}×${size[1] || "?"}` : "PNG / JPG · ≤ 12MB · 只在本次请求内使用"}
              </span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { void accept(event.target.files?.[0]); event.target.value = ""; }} />
            <div className="zh-row">
              <button className="zh-link" onClick={(event) => { event.stopPropagation(); void pasteFromClipboard(); }}>从剪贴板取图</button>
              <label className="zh-toggle" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={autoParse}
                  onChange={(event) => {
                    setAutoParse(event.target.checked);
                    try { localStorage.setItem("zh.autoParse", event.target.checked ? "1" : "0"); } catch { /* ignore */ }
                  }}
                />
                <span>选图后自动解析</span>
              </label>
            </div>
          </section>

          <section className="zh-block">
            <div className="zh-label">参数</div>
            <div className="zh-kv">
              <span>推理边长</span><b>{String(settings.imgsz ?? 800)}</b>
              <span>置信度</span><b>{String(settings.conf ?? 0.35)}</b>
              <span>关系</span><b>{settings.relations === false ? "关" : "开"}</b>
              <span>OCR</span><b>{settings.ocr === false ? "关" : "开"}</b>
            </div>
            <button className="zh-link" onClick={onOpenSettings}>修改后端与参数</button>
          </section>

          <section className="zh-block">
            <div className="zh-label">叠加</div>
            <label className="zh-toggle"><input type="checkbox" checked={showBlocks} onChange={(event) => setShowBlocks(event.target.checked)} /><span>区块框</span></label>
            <label className="zh-toggle"><input type="checkbox" checked={showRelations} onChange={(event) => setShowRelations(event.target.checked)} /><span>关系线</span></label>
          </section>
        </aside>

        <main className="zh-main">
          {imageUrl ? (
            <div className="zh-canvas">
              <ZhulongOverlay
                src={imageUrl}
                size={size}
                blocks={result?.blocks || []}
                relations={result?.relations || []}
                showBlocks={showBlocks}
                showRelations={showRelations}
                highlightIds={highlight}
                hoverId={hoverId}
                dimIds={dimIds}
                onPick={(id) => focusBlock(id)}
                onHover={setHoverId}
                onNaturalSize={setNatural}
              />
              {busy && <div className="zh-canvas-busy">解析中… {elapsed}s · 视觉模型通常 3–30s</div>}
            </div>
          ) : (
            <div className="zh-canvas zh-canvas-empty">
              <EmptyState
                compact
                mark="▧"
                title="⌘V 粘贴截图，立刻解析"
                desc="也可以拖入图片文件或点击选择；解析结果会叠在图上，右侧给出核对项。"
                action={<button className="btn" onClick={(event) => { event.stopPropagation(); void pasteFromClipboard(); }}>从剪贴板取图</button>}
              />
            </div>
          )}

          {result && (
            <>
              <div ref={tabsRef}>
                <Tabs
                  ariaLabel="解析结果视图"
                  value={tab}
                  onChange={(id) => setTab(id as typeof tab)}
                  hint={`${(result.source.bytes / 1024).toFixed(0)} KB · ${result.size[0]}×${result.size[1]} · ${(result.elapsedMs / 1000).toFixed(1)}s`}
                  items={[
                    { id: "blocks", label: "区块", badge: stats?.blocks },
                    { id: "relations", label: "关系", badge: stats?.relations },
                    { id: "json", label: "JSON" },
                  ]}
                  trailing={(
                    <RowMenu title="结果导出">
                      <button onClick={() => void copyMarkdown()}>复制 Markdown</button>
                      <button onClick={() => void copyJson()}>复制 JSON</button>
                      <button onClick={() => void save()}>保存到项目</button>
                      <button onClick={() => void saveToKnowledge()}>存为资料</button>
                    </RowMenu>
                  )}
                />
              </div>

              {tab === "blocks" && (
                <div className="zh-body">
                  <div className="zh-filters">
                    <button className={!filter ? "on" : ""} onClick={() => setFilter(null)}>全部 {stats?.blocks}</button>
                    {Boolean(stats?.low) && <button className={filter === "low" ? "on" : ""} onClick={() => setFilter(filter === "low" ? null : "low")}>低置信 {stats?.low}</button>}
                    {Boolean(stats?.noText) && <button className={filter === "notext" ? "on" : ""} onClick={() => setFilter(filter === "notext" ? null : "notext")}>无文字 {stats?.noText}</button>}
                    {Boolean(stats?.outside) && <button className={filter === "outside" ? "on" : ""} onClick={() => setFilter(filter === "outside" ? null : "outside")}>越界 {stats?.outside}</button>}
                    {filter && <span className="zh-filter-hint">图上压暗其余区块，保留版面上下文</span>}
                  </div>
                  <table className="zh-table">
                    <thead><tr><th className="zh-col-idx">#</th><th className="zh-col-type">类型</th><th>文字</th><th className="zh-col-conf">置信度</th></tr></thead>
                    <tbody>
                      {visibleBlocks.map((block) => (
                        <tr
                          key={block.id}
                          ref={(el) => { if (el) rowRefs.current.set(block.id, el); else rowRefs.current.delete(block.id); }}
                          className={[highlight.includes(block.id) ? "on" : "", hoverId === block.id ? "hover" : ""].filter(Boolean).join(" ")}
                          onMouseEnter={() => setHoverId(block.id)}
                          onMouseLeave={() => setHoverId("")}
                          onClick={() => setHighlight(highlight.includes(block.id) ? [] : [block.id])}
                        >
                          <td className="zh-col-idx mono">{blockById.get(block.id)?.index ?? ""}</td>
                          <td className="zh-col-type"><span className="tag">{block.type}</span></td>
                          <td className="zh-block-text" title={block.text || undefined}>{block.text || <span className="faint">—</span>}</td>
                          <td className="zh-col-conf mono">{block.conf === null ? "—" : block.conf.toFixed(2)}</td>
                        </tr>
                      ))}
                      {!visibleBlocks.length && <tr><td colSpan={4} className="zh-empty-row">这个筛选下没有区块</td></tr>}
                    </tbody>
                  </table>
                  {highlight.length === 1 && blockById.get(highlight[0]) && (
                    <div className="zh-selected">
                      <span className="tag">{blockById.get(highlight[0])!.block.type}</span>
                      <span className="mono">{bboxText(blockById.get(highlight[0])!.block.bbox)}</span>
                      <span className="mono faint">conf {blockById.get(highlight[0])!.block.conf === null ? "—" : blockById.get(highlight[0])!.block.conf!.toFixed(2)}</span>
                      <span className="zh-selected-text" title={blockById.get(highlight[0])!.block.text}>{blockById.get(highlight[0])!.block.text || "（无文字）"}</span>
                    </div>
                  )}
                </div>
              )}

              {tab === "relations" && (
                <div className="zh-body">
                  {result.relations.length ? (
                    <table className="zh-table">
                      <thead><tr><th className="zh-col-idx">#</th><th>从</th><th>到</th><th className="zh-col-type">类型</th><th className="zh-col-rel-conf">置信度</th></tr></thead>
                      <tbody>
                        {result.relations.map((rel, index) => {
                          const on = highlight.includes(rel.from) && highlight.includes(rel.to);
                          return (
                            <tr
                              key={rel.id || `${rel.from}-${rel.to}-${index}`}
                              className={on ? "on" : ""}
                              onMouseEnter={() => setHoverId(rel.from)}
                              onMouseLeave={() => setHoverId("")}
                              onClick={() => setHighlight(on ? [] : [rel.from, rel.to])}
                            >
                              <td className="zh-col-idx mono">{index + 1}</td>
                              <td className="zh-rel-end" title={labelOf(rel.from)}>{labelOf(rel.from)}</td>
                              <td className="zh-rel-end" title={labelOf(rel.to)}>{labelOf(rel.to)}</td>
                              <td className="zh-col-type"><span className="tag">{rel.type}</span></td>
                              <td className="zh-col-rel-conf mono">{typeof rel.confidence === "number" ? rel.confidence.toFixed(2) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="zh-hint">这次没有配对出关系。架构图场景建议在设置里开启「关系」；界面截图 / PDF 场景本来就没有关系，是正常的。</p>
                  )}
                </div>
              )}

              {tab === "json" && (
                <div className="zh-body">
                  <pre className="zh-json mono">{JSON.stringify({
                    backend: result.backend,
                    scene: result.scene,
                    size: result.size,
                    blocks: result.blocks,
                    relations: result.relations,
                  }, null, 2)}</pre>
                </div>
              )}
            </>
          )}
        </main>

        <aside className="zh-aside">
          <section className="zh-block">
            <div className="zh-label">核对 {stats?.failing ? <em className="zh-warn-count">{stats.failing} 项待看</em> : null}</div>
            {result ? (
              <div className="zh-checks">
                {result.checks.map((check) => {
                  const action = checkAction(check.name);
                  const className = `zh-check ${check.level}${action ? " act" : ""}`;
                  const inner = (
                    <>
                      <i />
                      <div className="zh-check-main">
                        <b>{check.name}</b>
                        <span title={check.detail}>{check.detail}</span>
                      </div>
                      <em>{LEVEL_LABEL[check.level]}</em>
                    </>
                  );
                  return action
                    ? <button className={className} key={check.name} onClick={action}>{inner}</button>
                    : <div className={className} key={check.name}>{inner}</div>;
                })}
                {result.warnings.map((warning) => (
                  <div className="zh-check warn" key={warning}>
                    <i />
                    <div className="zh-check-main"><b>后端提示</b><span>{warning}</span></div>
                    <em>注意</em>
                  </div>
                ))}
              </div>
            ) : (
              <p className="zh-hint">解析后在这里逐条核对：区块数、文字、坐标是否越界、低置信占比、架构图关系是否配对。</p>
            )}
          </section>

          {result && (
            <section className="zh-block">
              <div className="zh-label">本次</div>
              <div className="zh-kv">
                <span>区块</span><b>{stats?.blocks}</b>
                <span>关系</span><b>{stats?.relations}</b>
                <span>尺寸</span><b>{result.size[0]}×{result.size[1]}</b>
                <span>耗时</span><b>{(result.elapsedMs / 1000).toFixed(1)}s</b>
                <span>后端</span><b>{BACKEND_LABEL[result.backend] || result.backend}</b>
                <span>{result.backend === "zhulong" ? "权重" : "模型"}</span><b title={String(result.backend === "zhulong" ? (settings.weights || "") : (settings.model || ""))}>{result.backend === "zhulong" ? String(settings.weights || "服务默认") : String(settings.model || "未填")}</b>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
