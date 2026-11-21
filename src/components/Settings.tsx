import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PluginRecord, Settings as SettingsModel, State } from "../types";
import { THEMES } from "../themes";
import { PageHeader } from "./PageHeader";
import { Hosts, Stats } from "./Views";

type Act = (type: string, payload?: unknown) => Promise<any>;
export type SettingsSection = "general" | "appearance" | "execution" | "terminal" | "preview" | "im" | "hosts" | "stats" | "plugins" | "data" | "shortcuts" | "about";
type Section = SettingsSection;

/**
 * 分区按「先日常、再运行、再连接、最后维护」排；group 只用于导航分组，不参与路由。
 * 文案规范：label 2–4 字名词；desc 一句话、不加句号；row hint 不加句号（见 docs/arch/ARCH-settings.md §1.7）。
 */
type SectionGroup = "基础" | "运行" | "连接" | "观察" | "维护";
const SECTIONS: { id: Section; label: string; desc: string; group: SectionGroup }[] = [
  { id: "general", label: "通用", group: "基础", desc: "启动落到哪一屏、发送与停止、面板尺寸" },
  { id: "appearance", label: "外观", group: "基础", desc: "主题、界面缩放和字号" },
  { id: "execution", label: "执行", group: "运行", desc: "并发与审批、dsh 运行时、模型密钥、Mission 与角色" },
  { id: "hosts", label: "主机", group: "运行", desc: "Agent 跑在哪台机器；本机与 SSH 共用一套并发和审批" },
  { id: "terminal", label: "终端", group: "运行", desc: "shell、字号、回滚缓冲和开发服务器地址识别" },
  { id: "preview", label: "预览", group: "运行", desc: "预览地址、元素拾取和 Agent 的浏览权限" },
  { id: "im", label: "即时通信", group: "连接", desc: "在手机上继续处理：消息进同一套会话，审批回到 IM" },
  { id: "stats", label: "统计", group: "观察", desc: "按时间和项目看运行、成功率、耗时与失败分类" },
  { id: "plugins", label: "插件", group: "维护", desc: "安装与启用本地插件；插件代码按受信代码执行" },
  { id: "data", label: "数据", group: "维护", desc: "本地库、出网边界、语料目录和清理" },
  { id: "shortcuts", label: "快捷键", group: "维护", desc: "当前版本可用的键盘操作" },
  { id: "about", label: "关于", group: "维护", desc: "版本、运行环境和数据位置" },
];

/** 与 electron/db.mjs DEFAULT_SETTINGS 对齐：用于「恢复默认」判定与恢复 */
const DEFAULTS: Partial<Record<keyof SettingsModel, unknown>> = {
  defaultView: "workspace", defaultAgentId: null, enterToSend: true, confirmStop: false,
  theme: "system", uiScale: 0, chatFontSize: 13,
  maxConcurrentRuns: 0, approvalPolicy: "ask", dshBinary: "", dshHome: "", model: "", effort: "",
  superAgentEnabled: true, maxSupervisorRuns: 1, maxMissionChildren: 4, missionBudgetMinutes: 30,
  shellPath: "", terminalFontSize: 12, terminalScrollback: 5000, autoDetectDevServerUrl: true,
  previewHomeUrl: "http://localhost:5173/", elementScreenshots: true, previewIgnoreCertErrors: false, previewPermissionSites: "", previewAgentControl: true, contextDetail: "standard", worktreeMode: "auto",
  knowledgeCloudIndex: false,
  dshEnv: "",
  imEnabled: false, imTelegramToken: "", imTelegramAllow: "", imWebhookUrl: "", imWebhookToken: "", imInboundPort: 0, imAllowIds: "",
  personaDatasetDir: "",
};

/** 恢复本页默认 */
const SECTION_KEYS: Partial<Record<Section, (keyof SettingsModel)[]>> = {
  general: ["defaultView", "defaultAgentId", "enterToSend", "confirmStop"],
  appearance: ["theme", "uiScale", "chatFontSize"],
  execution: ["maxConcurrentRuns", "approvalPolicy", "dshBinary", "dshHome", "dshEnv", "model", "effort", "personaDatasetDir",
    "superAgentEnabled", "maxSupervisorRuns", "maxMissionChildren", "missionBudgetMinutes", "worktreeMode"],
  terminal: ["shellPath", "terminalFontSize", "terminalScrollback", "autoDetectDevServerUrl"],
  preview: ["previewHomeUrl", "elementScreenshots", "previewIgnoreCertErrors", "previewPermissionSites", "previewAgentControl", "contextDetail"],
  im: ["imEnabled", "imTelegramToken", "imTelegramAllow", "imWebhookUrl", "imWebhookToken", "imInboundPort", "imAllowIds"],
};

/** 搜索索引：标题 / 说明 / 分区，命中后跳到对应行 */
const SEARCH_INDEX: { section: Section; title: string; hint?: string; k?: string }[] = [
  { section: "general", title: "启动视图", k: "defaultView", hint: "打开应用时的首屏" },
  { section: "general", title: "默认 Agent", k: "defaultAgentId", hint: "新会话默认派给谁" },
  { section: "general", title: "Enter 发送", k: "enterToSend", hint: "关闭后用 ⌘Enter 发送" },
  { section: "general", title: "停止前确认", k: "confirmStop", hint: "停止运行前弹确认" },
  { section: "general", title: "重置面板尺寸", hint: "TODO / Chat / Terminal / 文件列宽" },
  { section: "appearance", title: "主题", k: "theme", hint: THEMES.map((t) => t.label).join(" / ") },
  { section: "appearance", title: "界面缩放", k: "uiScale", hint: "自动跟随屏幕分辨率；也可固定 80–150%" },
  { section: "appearance", title: "Chat 字号", k: "chatFontSize", hint: "11–16px" },
  { section: "execution", title: "全局并发上限", k: "maxConcurrentRuns", hint: "同时运行的 run 数量，0 = 不限" },
  { section: "execution", title: "审批策略", k: "approvalPolicy", hint: "ACP 权限请求：询问 / 自动批准 / 自动拒绝" },
  { section: "execution", title: "dsh 可执行文件", k: "dshBinary", hint: "留空用 PATH 或内置 dsh" },
  { section: "execution", title: "DSH_HOME", k: "dshHome", hint: "dsh 配置目录" },
  { section: "execution", title: "模型密钥 / 环境变量", k: "dshEnv", hint: "DEEPSEEK_API_KEY 等 KEY=VALUE" },
  { section: "execution", title: "默认模型", k: "model", hint: "ACP model option value" },
  { section: "execution", title: "Reasoning effort", k: "effort", hint: "ACP reasoning_effort" },
  { section: "execution", title: "启用 Mission 模式", k: "superAgentEnabled", hint: "Super Agent / 主管" },
  { section: "execution", title: "Supervisor 并发", k: "maxSupervisorRuns", hint: "同时几个主管会话" },
  { section: "execution", title: "Mission 子任务上限", k: "maxMissionChildren", hint: "每个 Mission 最多子任务" },
  { section: "execution", title: "Mission 时长预算", k: "missionBudgetMinutes", hint: "主管预算提示" },
  { section: "execution", title: "Agent 角色", hint: "worker / supervisor" },
  { section: "execution", title: "Chat 执行方式", hint: "dsh 走 ACP；其他 CLI 走终端 pty" },
  { section: "execution", title: "已检测到的 CLI", hint: "dsh / pi / claude / codex / opencode" },
  { section: "terminal", title: "Shell 路径", k: "shellPath", hint: "留空用 $SHELL" },
  { section: "terminal", title: "终端字号", k: "terminalFontSize", hint: "10–18px" },
  { section: "terminal", title: "回滚缓冲", k: "terminalScrollback", hint: "历史行数" },
  { section: "terminal", title: "识别 dev server 地址", k: "autoDetectDevServerUrl", hint: "终端输出里的 localhost 地址" },
  { section: "preview", title: "默认地址", k: "previewHomeUrl", hint: "预览标签默认打开的 URL" },
  { section: "preview", title: "保存截图", k: "elementScreenshots", hint: "拾取元素时截图" },
  { section: "data", title: "云端向量索引", k: "knowledgeCloudIndex", hint: "开启后资料正文分块会发往 Ark embedding" },
  { section: "preview", title: "上下文详细度", k: "contextDetail", hint: "注入 Chat 的 UI 上下文详略" },
  { section: "preview", title: "忽略证书校验", k: "previewIgnoreCertErrors", hint: "自签名 https 的 dev server" },
  { section: "preview", title: "Agent 可操作预览", k: "previewAgentControl", hint: "browser_* 工具：导航 / 点击 / 输入 / 截图" },
  { section: "preview", title: "站点权限", hint: "摄像头 / 麦克风 / 剪贴板等按站点授权" },
  { section: "plugins", title: "已安装插件", hint: "Notes / 本地插件" },
  { section: "plugins", title: "安装插件包", hint: ".cockpit-plugin / 包含 plugin.json 的目录" },
  { section: "data", title: "数据库文件", hint: "harness.db 路径" },
  { section: "data", title: "数据目录", hint: "userData" },
  { section: "data", title: "导出备份", hint: "导出 .db" },
  { section: "data", title: "重置设置", hint: "恢复全部默认" },
  { section: "hosts", title: "主机列表", hint: "本机 / SSH：探测、编辑、移除" },
  { section: "stats", title: "运行统计", hint: "成功率 / 耗时 / 排队 / 失败分类" },
  { section: "shortcuts", title: "快捷键", hint: "⌘K / ⌘N / ⌘E …" },
  { section: "about", title: "关于", hint: "版本 / 数据位置" },
];

/** 行内「恢复默认」通过 context 读取，避免每个 Row 都传一大串 props */
const ResetCtx = createContext<{ settings: SettingsModel; reset: (k: keyof SettingsModel) => void } | null>(null);

export function Settings({ state, act, notify, now, onOpenTodo, initialSection }: {
  state: State;
  act: Act;
  notify: (m: string) => void;
  /** 主机页的心跳/探测时间需要它；缺省用当前时间 */
  now?: number;
  onOpenTodo?: (todoId: string) => void;
  /** 从命令面板 / 旧版默认视图进来时直接落到某个分区 */
  initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<Section>(initialSection ?? "general");
  useEffect(() => {
    // rail 直接点「设置」= 不带分区（回到通用）；带分区进来时滚到顶部
    setSection(initialSection ?? "general");
    if (initialSection) bodyRef.current?.scrollTo({ top: 0 });
  }, [initialSection]);
  const [query, setQuery] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pair, setPair] = useState<{ qr: string; url: string; expiresAt: number } | null>(null);
  const [setupText, setSetupText] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupStatus, setSetupStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [imInfo, setImInfo] = useState<{ ws?: boolean; wsReady?: boolean; wsError?: string; feishu?: boolean; inbound?: number; recent?: { at: number; line: string }[] } | null>(null);

  const runSetup = async () => {
    setSetupBusy(true);
    setSetupStatus(null);
    try {
      const res = (await act("imFeishuSetup", { text: setupText })) as { ok?: boolean; mode?: string; error?: string; note?: string; appId?: string } | null;
      if (res?.ok) {
        setSetupStatus({ ok: true, text: res.mode === "webhook" ? (res.note || "已保存 webhook") : `凭据可用（${res.appId || "app_id 已保存"}），可以回群里试一句` });
        setSetupText("");
        notify(res.mode === "webhook" ? "已保存自定义机器人 webhook" : "飞书应用凭据已保存并验证通过");
      } else {
        setSetupStatus({ ok: false, text: res?.error || "配置失败" });
      }
    } catch (err) {
      setSetupStatus({ ok: false, text: String((err as Error)?.message || err) });
    } finally {
      setSetupBusy(false);
    }
  };

  // 扫码配置：手机提交成功后主进程发事件，这里关掉二维码
  useEffect(() => {
    const off = window.harness.onImPaired(() => {
      setPair(null);
      notify("飞书凭据已写入（secret 已加密存储）");
    });
    return off;
  }, [notify]);

  const startPair = async () => {
    try {
      const res = (await act("imPairStart", {})) as { ok?: boolean; qr?: string; url?: string; expiresAt?: number } | null;
      if (!res?.ok || !res.qr) throw new Error("没有拿到二维码");
      setPair({ qr: res.qr, url: res.url || "", expiresAt: res.expiresAt || 0 });
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };
  const stopPair = async () => {
    setPair(null);
    try { await act("imPairCancel", {}); } catch { /* ignore */ }
  };
  const searchRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const settings = state.settings;

  if (!settings) {
    return <div className="pane-empty">设置不可用</div>;
  }

  const set = async (patch: Partial<SettingsModel>) => {
    await act("setSettings", patch);
    setSavedAt(Date.now());
  };
  const resetKey = (k: keyof SettingsModel) => {
    const def = DEFAULTS[k];
    if (def === undefined) return;
    void set({ [k]: def } as Partial<SettingsModel>);
  };

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_INDEX.filter((item) => `${item.title} ${item.hint || ""} ${item.k || ""}`.toLowerCase().includes(q));
  }, [query]);

  // 从错误卡片 / 命令面板跳进来：定位分区并聚焦某个设置项
  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: Section; focus?: string }>).detail || {};
      if (detail.section) setSection(detail.section);
      // 分区切换要等 React 提交，再重试几次直到输入框就位（聚焦不能只赌一次）
      let tries = 0;
      const focusTarget = () => {
        tries += 1;
        const el = detail.focus ? bodyRef.current?.querySelector<HTMLElement>(`[data-set-key="${CSS.escape(detail.focus)}"]`) : null;
        if (!el) { if (tries < 20) window.setTimeout(focusTarget, 60); return; }
        el.scrollIntoView({ block: "center" });
        const input = el.matches("textarea,input") ? el : el.querySelector<HTMLElement>("textarea,input");
        if (!input) { if (tries < 20) window.setTimeout(focusTarget, 60); return; }
        input.focus({ preventScroll: true });
        window.setTimeout(() => { if (document.activeElement !== input) input.focus({ preventScroll: true }); }, 120);
      };
      window.setTimeout(focusTarget, 60);
    };
    window.addEventListener("harness:settings-jump", onJump);
    return () => window.removeEventListener("harness:settings-jump", onJump);
  }, []);

  // ⌘F 聚焦搜索；Esc 清空
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        e.preventDefault();
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const jumpTo = (sectionId: Section, key?: string) => {
    setSection(sectionId);
    setQuery("");
    const target = key || "";
    window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(`[data-set-key="${CSS.escape(target)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("set-hit");
      window.setTimeout(() => el.classList.remove("set-hit"), 1600);
    }, 60);
  };

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <ResetCtx.Provider value={{ settings, reset: resetKey }}>
    <div className="settings-page">
      <aside className="settings-nav">
        <div className="settings-nav-head">
          <b>设置</b>
          <input
            ref={searchRef}
            className="settings-search"
            value={query}
            placeholder="搜索设置  ⌘F"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) { e.preventDefault(); jumpTo(hits[0].section, hits[0].k || hits[0].title); }
              if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); window.setTimeout(() => document.querySelector<HTMLElement>(".settings-hits .settings-hit")?.focus(), 0); }
            }}
          />
        </div>
        {query.trim() ? (
          <div className="settings-hits">
            {hits.map((item) => (
              <button key={`${item.section}-${item.title}`} className="settings-hit" onClick={() => jumpTo(item.section, item.k || item.title)}>
                <span className="ellipsis">{item.title}</span>
                <span className="tiny faint">{SECTIONS.find((x) => x.id === item.section)?.label}</span>
              </button>
            ))}
            {hits.length === 0 && <div className="settings-hit-empty">没有匹配的设置</div>}
          </div>
        ) : (
          SECTIONS.map((item, i) => (
            <Fragment key={item.id}>
              {i === 0 || SECTIONS[i - 1].group !== item.group ? (
                <div className="settings-nav-group">{item.group}</div>
              ) : null}
            <button
              className={`settings-nav-item ${section === item.id ? "on" : ""}`}
              onKeyDown={(e) => {
                const idx = SECTIONS.findIndex((x) => x.id === section);
                if (e.key === "ArrowDown") { e.preventDefault(); setSection(SECTIONS[Math.min(idx + 1, SECTIONS.length - 1)].id); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSection(SECTIONS[Math.max(idx - 1, 0)].id); }
              }}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
            </Fragment>
          ))
        )}
      </aside>

      <div className="settings-body" ref={bodyRef}>
        <PageHeader
          title={current.label}
          subtitle={current.desc}
          actions={<div className="row gap8">
            {savedAt != null && <span className="settings-saved">✓ 已自动保存</span>}
            {SECTION_KEYS[section] && (
              <button
                className="btn tiny-btn"
                title="把本页所有项恢复为默认值"
                onClick={() => {
                  const keys = SECTION_KEYS[section] || [];
                  const patch: Record<string, unknown> = {};
                  for (const k of keys) if (DEFAULTS[k] !== undefined) patch[k] = DEFAULTS[k];
                  if (Object.keys(patch).length) void set(patch as Partial<SettingsModel>);
                  notify(`已恢复「${current.label}」默认值`);
                }}
              >本页恢复默认</button>
            )}
          </div>}
        />

        {section === "general" && (
          <>
            <Card title="启动">
              <Row k="defaultView" title="启动视图" hint="打开应用时的首屏">
                <select className="settings-control" value={settings.defaultView} onChange={(e) => void set({ defaultView: e.target.value as SettingsModel["defaultView"] })}>
                  <option value="workspace">工作区</option>
                  <option value="projects">项目</option>
                  <option value="settings">设置</option>
                </select>
              </Row>
              <Row k="defaultAgentId" title="默认 Agent" hint="新会话默认派给谁">
                <select className="settings-control" value={settings.defaultAgentId ?? ""} onChange={(e) => void set({ defaultAgentId: e.target.value || null })}>
                  <option value="">自动</option>
                  {state.agents.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.chatRunnable === false}>
                      {a.name}{a.chatRuntime === "terminal" ? "（终端）" : ""}
                    </option>
                  ))}
                </select>
              </Row>
            </Card>

            <Card title="交互">
              <Row k="enterToSend" title="Enter 发送" hint="关闭后改用 ⌘⏎ 发送">
                <Toggle value={settings.enterToSend} onChange={(v) => void set({ enterToSend: v })} />
              </Row>
              <Row k="confirmStop" title="停止前确认" hint="停止运行前先弹一次确认">
                <Toggle value={settings.confirmStop} onChange={(v) => void set({ confirmStop: v })} />
              </Row>
            </Card>

            <Card title="布局">
              <Row title="重置面板尺寸" hint="任务 / 会话 / 终端 / 文件的列宽恢复默认">
                <button className="btn tiny-btn" onClick={() => { window.dispatchEvent(new Event("harness:reset-layout")); notify("已重置"); }}>重置</button>
              </Row>
            </Card>
          </>
        )}

        {section === "appearance" && (
          <>
            <Card title="主题">
              <div className="theme-grid" data-set-key="theme">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-card ${settings.theme === t.id ? "on" : ""}`}
                    onClick={() => void set({ theme: t.id })}
                    title={`${t.label} · ${t.desc}`}
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {t.swatches.map((color, i) => <i key={i} style={{ background: color }} />)}
                    </span>
                    <span className="theme-card-text">
                      <b>{t.label}</b>
                      <em>{t.desc}</em>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
            <Card title="字号与缩放">
              <Row
                k="uiScale"
                title="界面缩放"
                hint={`自动按屏幕分辨率取值（当前生效 ${settings.uiScaleResolved || 100}%）；⌘+ / ⌘- 手动步进，⌘0 回到自动`}
              >
                <select
                  className="settings-control"
                  value={Number(settings.uiScale) > 0 ? String(settings.uiScale) : "0"}
                  onChange={(e) => void set({ uiScale: Number(e.target.value) })}
                >
                  <option value="0">自动（跟随屏幕）</option>
                  {[80, 90, 100, 110, 120, 130, 150].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
              </Row>
              <Row k="chatFontSize" title="聊天字号" hint="消息正文和输入框，11–16px">
                <NumberSetting value={settings.chatFontSize} min={11} max={16} onCommit={(v) => void set({ chatFontSize: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "execution" && (
          <>
            <Card title="并发与审批">
              <Row k="maxConcurrentRuns" title="并发上限" hint="同时运行的 run 数量，0 表示不限">
                <NumberSetting value={settings.maxConcurrentRuns} min={0} max={20} onCommit={(v) => void set({ maxConcurrentRuns: v })} />
              </Row>
              <Row k="approvalPolicy" title="审批策略" hint="ACP 权限请求的处理方式">
                <select className="settings-control" value={settings.approvalPolicy} onChange={(e) => void set({ approvalPolicy: e.target.value as SettingsModel["approvalPolicy"] })}>
                  <option value="ask">每次询问</option>
                  <option value="allow">自动批准</option>
                  <option value="deny">自动拒绝</option>
                </select>
              </Row>
              <Row k="worktreeMode" title="默认 worktree" hint="auto 只在 git 仓库建 worktree，always 强制要求 git，never 直接用原目录；项目场景配置优先">
                <select className="settings-control" value={settings.worktreeMode || "auto"} onChange={(e) => void set({ worktreeMode: e.target.value as SettingsModel["worktreeMode"] })}>
                  <option value="auto">auto · git 才建</option>
                  <option value="always">always · 强制 git worktree</option>
                  <option value="never">never · 原地目录</option>
                </select>
              </Row>
            </Card>

            <Card title="dsh 运行时">
              <Row title="当前来源" hint="内置 / 自定义路径 / 系统 PATH">
                <span className="muted small ellipsis set-row-value" title={state.dshRuntime?.path || "dsh"}>
                  {state.dshRuntime?.source === "custom"
                    ? `自定义 · ${state.dshRuntime.path}`
                    : state.dshRuntime?.source === "bundled"
                      ? `内置 · ${state.dshRuntime.version || "unknown"}`
                      : state.cliCapabilities.includes("dsh")
                        ? "系统 PATH"
                        : "未检测到"}
                </span>
              </Row>
              <Row k="dshBinary" title="dsh 可执行文件" hint="留空则用 PATH 或内置 dsh">
                <TextSetting value={settings.dshBinary} placeholder="dsh" onCommit={(v) => void set({ dshBinary: v })} />
              </Row>
              <Row k="dshHome" title="DSH_HOME" hint="dsh 的配置目录">
                <TextSetting value={settings.dshHome} placeholder="默认" onCommit={(v) => void set({ dshHome: v })} />
              </Row>
            </Card>

            <Card title="模型与密钥">
              <Row k="model" title="默认模型" hint="推荐在 Chat 底部选择（选项来自 dsh ACP）；这里填 ACP 的 option value，纯模型 ID 可能被拒绝">
                <TextSetting value={settings.model} placeholder="默认" onCommit={(v) => void set({ model: v })} />
              </Row>
              <Row k="effort" title="推理强度（effort）" hint="ACP 的 reasoning_effort，留空用模型默认">
                <TextSetting value={settings.effort} placeholder="默认" onCommit={(v) => void set({ effort: v })} />
              </Row>
              <Row
                k="dshEnv"
                title="额外环境变量"
                hint="每行一条 KEY=VALUE，只注入本机启动的 dsh，远端主机请在目标机自己配；用来填 DEEPSEEK_API_KEY 这类密钥"
              >
                <textarea
                  className="settings-control settings-env"
                  data-set-key="dshEnv"
                  spellCheck={false}
                  rows={3}
                  value={settings.dshEnv ?? ""}
                  placeholder={"DEEPSEEK_API_KEY=sk-…\n# 也支持 export FOO=bar 写法"}
                  onChange={(e) => void set({ dshEnv: e.target.value })}
                />
              </Row>
              <div className="settings-note">
                改完无需重启：下一次 run 会带着这些变量启动 dsh。若报错里点名了别的变量（如 <code>OPENAI_API_KEY</code>），按同样格式加一行即可。
                已经跑过失败 run 的，改完后在 Chat 里点「重试」。
              </div>
            </Card>

            <Card title="Mission">
              <Row k="superAgentEnabled" title="Mission 模式" hint="关闭后不能再创建或运行 Supervisor，已有 Mission 保留">
                <Toggle value={settings.superAgentEnabled !== false} onChange={(v) => void set({ superAgentEnabled: v })} />
              </Row>
              <Row k="maxSupervisorRuns" title="Supervisor 并发" hint="同一时间最多几个主管会话，子任务仍受全局并发限制">
                <NumberSetting value={settings.maxSupervisorRuns ?? 1} min={1} max={4} onCommit={(v) => void set({ maxSupervisorRuns: v })} />
              </Row>
              <Row k="maxMissionChildren" title="子任务上限" hint="每个 Mission 最多创建多少个子任务，Agent 自己的 maxChildren 不能超过它">
                <NumberSetting value={settings.maxMissionChildren ?? 4} min={1} max={12} onCommit={(v) => void set({ maxMissionChildren: v })} />
              </Row>
              <Row k="missionBudgetMinutes" title="时长预算" hint="只作为主管提示和界面约束，真正取消仍要人工或预算硬闸">
                <NumberSetting value={settings.missionBudgetMinutes ?? 30} min={5} max={240} step={5} onCommit={(v) => void set({ missionBudgetMinutes: v })} />
              </Row>
            </Card>

            <Card title="Agent 角色">
              {state.agents.length === 0 && <Row title="还没有 Agent"><span className="muted small">在 Chat 里点「＋ dsh」纳管</span></Row>}
              {state.agents.map((agent) => (
                <div className="settings-agent-row" key={agent.id}>
                  <div className="settings-agent-name">
                    <b>{agent.name}</b>
                    <span className="mono tiny faint">@{agent.alias}</span>
                  </div>
                  <select
                    className="settings-control"
                    value={agent.role || "worker"}
                    title="主管可以创建 Mission；worker 只能接子任务"
                    onChange={(e) => void act("updateAgent", { id: agent.id, role: e.target.value })}
                  >
                    <option value="worker">Worker</option>
                    <option value="supervisor">Supervisor</option>
                  </select>
                  {(agent.role === "supervisor") && (
                    <TextSetting
                      value={agent.instructions || ""}
                      placeholder="主管额外要求（如：先做风险评审）"
                      onCommit={(v) => void act("updateAgent", { id: agent.id, instructions: v })}
                    />
                  )}
                </div>
              ))}
            </Card>

            <Card title="桌面操作（agent-desktop）">
              <Row k="agentDesktopEnabled" title="桌面应用操作" hint="挂载 agent-desktop 的 MCP，可读可访问性树并点按控件；开启后 Agent 能读到当前窗口里的文字">
                <Toggle value={Boolean(settings.agentDesktopEnabled)} onChange={(v) => {
                  if (v && !window.confirm("开启后，Agent 可以读取你桌面上任意窗口的可访问性内容，并点击/输入。只在受控环境下开启。确认开启？")) return;
                  void set({ agentDesktopEnabled: v });
                }} />
              </Row>
              <div className="settings-note">
                依赖外部 CLI：<code>npm i -g agent-desktop</code>（不在安装包里）。macOS 首次需要授予「辅助功能」权限：
                <code>agent-desktop permissions --guide</code>。截图能力需要「屏幕录制」权限，本集成只用可访问性树，不需要截图。
              </div>
            </Card>

            <Card title="运行环境（只读）">
              {(state.executors ?? []).map((e) => (
                <Row key={e.id} title={e.id}>
                  <span className={`tag ${e.available ? "ok" : ""}`}>
                    {e.implemented ? (e.available ? "ACP · 可派活" : "未安装") : (e.available ? "终端 pty · 可派活" : "未安装")}
                  </span>
                </Row>
              ))}
              <div className="settings-note">
                已检测到的 CLI：{(state.cliCapabilities ?? []).length
                  ? state.cliCapabilities.map((c) => <span key={c} className="tag ok">{c}</span>)
                  : <span className="muted small">—</span>}
              </div>
            </Card>

            <Card title="Runtime 视图（只读）">
              <div className="settings-note">Host + CLI + caps 的只读视图；Agent 仍只存 hostId + cli。出现共享并发 / 多账号 / 远程治理时再建 runtimes 表。</div>
              {(state.runtimes || []).map((runtime) => (
                <Row key={runtime.id} title={`${runtime.hostName} · ${runtime.cli}`}>
                  <span className="row gap6 tiny">
                    <span className={`tag ${runtime.available ? "ok" : ""}`}>{runtime.available ? "可用" : "未安装"}</span>
                    <span className="mono faint">{runtime.mode}</span>
                    <span className="muted">{runtime.agents} Agent</span>
                  </span>
                </Row>
              ))}
              {(state.runtimes || []).length === 0 && <Row title="没有运行时"><span className="muted small">先探测主机。</span></Row>}
            </Card>
          </>
        )}

        {section === "terminal" && (
          <>
            <Card title="终端">
              <Row k="shellPath" title="Shell 路径" hint="留空使用 $SHELL，Windows 默认 powershell">
                <TextSetting value={settings.shellPath} placeholder="/bin/zsh" onCommit={(v) => void set({ shellPath: v })} />
              </Row>
              <Row k="terminalFontSize" title="终端字号" hint="10–18px，也可以在终端里用 ⌘+ / ⌘- 临时缩放">
                <NumberSetting value={settings.terminalFontSize} min={10} max={18} onCommit={(v) => void set({ terminalFontSize: v })} />
              </Row>
              <Row k="terminalScrollback" title="回滚缓冲" hint="每个终端保留的历史行数，越大越占内存">
                <NumberSetting value={settings.terminalScrollback} min={1000} max={50000} step={500} onCommit={(v) => void set({ terminalScrollback: v })} />
              </Row>
            </Card>
            <Card title="开发服务器">
              <Row k="autoDetectDevServerUrl" title="识别开发服务器地址" hint="从终端输出里认出 localhost 地址">
                <Toggle value={settings.autoDetectDevServerUrl} onChange={(v) => void set({ autoDetectDevServerUrl: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "preview" && (
          <>
            <Card title="预览与元素">
              <Row k="previewHomeUrl" title="默认预览地址" hint="预览标签默认打开这个地址">
                <TextSetting value={settings.previewHomeUrl} placeholder="http://localhost:5173/" onCommit={(v) => void set({ previewHomeUrl: v })} />
              </Row>
              <Row k="elementScreenshots" title="元素截图" hint="拾取元素时一并保存截图">
                <Toggle value={settings.elementScreenshots} onChange={(v) => void set({ elementScreenshots: v })} />
              </Row>
              <Row k="previewIgnoreCertErrors" title="忽略证书校验" hint="自签名 https 的开发服务器">
                <Toggle value={settings.previewIgnoreCertErrors} onChange={(v) => void set({ previewIgnoreCertErrors: v })} />
              </Row>
              <Row k="previewAgentControl" title="Agent 可操作预览" hint="browser_* 工具：导航、点击、输入、截图">
                <Toggle value={settings.previewAgentControl} onChange={(v) => void set({ previewAgentControl: v })} />
              </Row>
              <Row k="contextDetail" title="上下文详细度" hint="注入 Chat 的界面上下文详略">
                <select className="settings-control" value={settings.contextDetail} onChange={(e) => void set({ contextDetail: e.target.value as SettingsModel["contextDetail"] })}>
                  <option value="compact">简洁</option>
                  <option value="standard">标准</option>
                </select>
              </Row>
            </Card>
            <Card title="站点权限">
              <div data-set-key="站点权限"><PreviewPermissions /></div>
            </Card>
            <Card title="源码定位">
              <div className="settings-note">
                <code>data-ym-src="src/x.tsx:42"</code> → <code>_debugSource</code> → 组件名 + selector
              </div>
            </Card>
          </>
        )}

        {section === "im" && (
          <>
            <Card title="飞书">
              <Row k="imEnabled" title="启用即时通信" hint="总开关；关闭后不再收发 IM 消息">
                <Toggle value={Boolean(settings.imEnabled)} onChange={(v) => void set({ imEnabled: v })} />
              </Row>

              <div className="im-quick">
                <label className="im-quick-label">
                  <b>一次粘贴就配好</b>
                  <span>把飞书的 App ID + App Secret 一起粘进来（分行、冒号、等号都行）；只想收通知就粘自定义机器人的 webhook 地址。</span>
                </label>
                <textarea
                  value={setupText}
                  rows={2}
                  spellCheck={false}
                  placeholder="cli_xxxxxxxx  +  App Secret（可分成两行）&#10;或  https://open.feishu.cn/open-apis/bot/v2/hook/…"
                  onChange={(event) => setSetupText(event.target.value)}
                />
                <div className="im-quick-actions">
                  <button className="btn tiny-btn primary" disabled={setupBusy || !setupText.trim()} onClick={() => void runSetup()}>{setupBusy ? "验证中…" : "保存并测试"}</button>
                  <button className="btn tiny-btn" onClick={() => void (pair ? stopPair() : startPair())}>{pair ? "关闭二维码" : "用手机扫码"}</button>
                  <button className="btn tiny-btn" onClick={async () => {
                    setSetupBusy(true);
                    setSetupStatus(null);
                    try {
                      const res = (await act("imFeishuSetupFromClipboard", {})) as { ok?: boolean; mode?: string; appId?: string; error?: string } | null;
                      setSetupStatus({ ok: Boolean(res?.ok), text: res?.ok ? `已从剪贴板读入（${res.mode === "webhook" ? "webhook" : res.appId || "app 凭据"}）` : (res?.error || "读取失败") });
                      if (res?.ok) notify("已从剪贴板写入飞书配置");
                    } finally { setSetupBusy(false); }
                  }}>从剪贴板读入</button>
                  <button className="btn tiny-btn" onClick={async () => {
                    const res = (await act("imFeishuTest", {})) as { ok?: boolean; error?: string; chat?: string } | null;
                    notify(res?.ok ? `已发到 ${res.chat}（看飞书里有没有收到）` : `发送失败：${res?.error || "未知错误"}`);
                  }}>发送测试消息</button>
                  <button className="btn tiny-btn" onClick={async () => {
                    const res = (await act("imStatus", {})) as { result?: { ws?: boolean; wsReady?: boolean; wsError?: string; feishu?: boolean; inbound?: number; recent?: { at: number; line: string }[] } } | null;
                    setImInfo(res?.result || null);
                  }}>检查连接</button>
                  <button className="btn tiny-btn ghost" onClick={() => setAdvanced((v) => !v)}>{advanced ? "收起高级" : "高级"}</button>
                  <span className="tiny muted">{String(settings.imFeishuAppId || "") ? `已配置 ${String(settings.imFeishuAppId).slice(0, 12)}…` : settings.imWebhookUrl ? "已配置 webhook" : "未配置"}</span>
                </div>
                {setupStatus && <div className={`im-quick-status ${setupStatus.ok ? "ok" : "fail"}`}>{setupStatus.text}</div>}
                {imInfo && (
                  <div className="im-quick-status">
                    长连接 {imInfo.wsReady ? "已就绪" : imInfo.ws ? "连接中" : "未建立"}{imInfo.wsError ? `（${imInfo.wsError}）` : ""} · 凭据 {imInfo.feishu ? "已配置" : "未配置"} · 入站端口 {imInfo.inbound || 0}
                    {(imInfo.recent || []).slice(-6).map((row) => (
                      <div key={`${row.at}-${row.line}`} className="mono tiny faint">{new Date(row.at).toLocaleTimeString("zh-CN")} · {row.line}</div>
                    ))}
                    {(imInfo.recent || []).length === 0 && <div className="tiny faint">还没有事件。到飞书里给 bot 发一句话再看。</div>}
                  </div>
                )}
                {String(settings.imFeishuAppId || "") ? (
                  <div className="settings-note">
                    下一步（只在飞书后台做一次）：权限开通 <code>im:message</code> 与 <code>im:message:send_as_bot</code> → 事件订阅填回调地址 <code>/feishu/event</code>（需公网或内网穿透，入站端口 {Number(settings.imInboundPort) || 0}）并订阅 <code>im.message.receive_v1</code> → 把机器人加进群或开单聊 → 在飞书里发一句话，回来点「发送测试消息」。
                  </div>
                ) : null}
                {pair && (
                  <div className="im-pair">
                    <img src={pair.qr} alt="扫码配置二维码" width={200} height={200} />
                    <div className="im-pair-text">
                      <b>手机扫码，填一次就完成</b>
                      <span>需与电脑同一网络；页面上粘贴 App ID 与 App Secret。</span>
                      <span className="mono tiny ellipsis" title={pair.url}>{pair.url}</span>
                      <span className="faint tiny">一次性链接，10 分钟内有效；成功后立即失效</span>
                    </div>
                  </div>
                )}
              </div>

              {advanced && (
                <>
                  <Row k="imFeishuMode" title="事件接收方式" hint="ws 是长连接（推荐，不需要公网域名），http 是公网回调（需要隧道）；改动会重启网关">
                    <select className="settings-control" value={String(settings.imFeishuMode || "ws")} onChange={(e) => void set({ imFeishuMode: e.target.value as "ws" | "http" })}>
                      <option value="ws">长连接（推荐）</option>
                      <option value="http">公网回调</option>
                    </select>
                  </Row>
                  <Row k="imFeishuVerificationToken" title="校验 Token" hint="开放平台「事件订阅」里的 Verification Token，填了就校验，不填只靠 allowlist">
                    <TextSetting value={String(settings.imFeishuVerificationToken || "")} placeholder="可选" onCommit={(v) => void set({ imFeishuVerificationToken: v })} />
                  </Row>
                  <Row k="imWebhookUrl" title="出站 Webhook" hint="飞书自定义机器人地址，只发它所在的群，收不到 @">
                    <TextSetting value={settings.imWebhookUrl || ""} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…" onCommit={(v) => void set({ imWebhookUrl: v })} />
                  </Row>
                  <Row k="imWebhookToken" title="Webhook Token" hint="出站放在 Authorization 头，入站要求同值">
                    <TextSetting value={settings.imWebhookToken || ""} placeholder="可选" onCommit={(v) => void set({ imWebhookToken: v })} />
                  </Row>
                  <Row k="imAllowIds" title="允许的会话" hint="留空表示允许第一个跟它说话的会话并写日志，填了就只认这些">
                    <TextSetting value={settings.imAllowIds || ""} placeholder="ou_xxx, oc_xxx" onCommit={(v) => void set({ imAllowIds: v })} />
                  </Row>
                </>
              )}
              <div className="settings-note">
                粘贴的是应用凭据时，secret 用 safeStorage 加密存本机；入站需要公网或内网穿透（长连接未做），桌面关闭期间的消息不会被处理。
              </div>
            </Card>
            <Card title="入站端口">
              <Row k="imInboundPort" title="入站端口" hint="本地 POST { chat_id, text }，只绑 127.0.0.1；不是飞书事件协议，0 为关闭">
                <NumberSetting value={Number(settings.imInboundPort) || 0} min={0} max={65535} onCommit={(v) => void set({ imInboundPort: v })} />
              </Row>
            </Card>
            <Card title="其他渠道（实验）">
              <Row k="imTelegramToken" title="Telegram Token" hint="非目标渠道：国内网络不可用，代码保留但不投入；桌面关闭时消息留在平台队列">
                <TextSetting value={settings.imTelegramToken || ""} placeholder="123456:ABC…" onCommit={(v) => void set({ imTelegramToken: v })} />
              </Row>
              <Row k="imTelegramAllow" title="允许的会话 ID" hint="留空则忽略所有消息；支持多个、逗号分隔，* 表示全部" >
                <TextSetting value={settings.imTelegramAllow || ""} placeholder="123456789" onCommit={(v) => void set({ imTelegramAllow: v })} />
              </Row>
            </Card>
            <Card title="规则与边界">
              <div className="settings-note">
                陌生会话一律忽略并留日志；审批卡一次只问一个问题，回复数字即选择；敏感的人物事实默认不推 IM。
                移动端不保存凭据，token 只存在本机设置里（当前是明文存储，共享机器上不要填写）。
              </div>
            </Card>
          </>
        )}

        {section === "hosts" && (
          <Hosts state={state} act={act} notify={notify} now={now ?? Date.now()} embedded />
        )}

        {section === "stats" && (
          <Stats state={state} onOpen={(todoId) => onOpenTodo?.(todoId)} embedded />
        )}

        {section === "data" && (
          <>
            <Card title="本地数据">
              <Row title="数据库" hint="harness.db 的完整路径">
                <span className="mono tiny ellipsis set-row-value" title={state.dbPath}>{state.dbPath ?? "—"}</span>
                <button className="btn tiny-btn" onClick={() => { void navigator.clipboard?.writeText(state.dbPath ?? ""); notify("已复制"); }}>复制</button>
              </Row>
              <Row title="数据目录" hint="导出、备份和语料都放在这里">
                <span className="mono tiny ellipsis set-row-value" title={state.userDataPath}>{state.userDataPath ?? "—"}</span>
                <button className="btn tiny-btn" onClick={() => void act("openDataDir")}>打开</button>
              </Row>
              <Row title="导出备份">
                <button className="btn tiny-btn" onClick={async () => { const p = await act("exportData"); if (p) notify(`已导出：${p}`); }}>导出 .db</button>
              </Row>
            </Card>
            <Card title="人物语料">
              <Row k="personaDatasetDir" title="人物语料目录" hint="datasets/wechat 的位置；装好的 App 读不到仓库时指定一次即可">
                <TextSetting value={settings.personaDatasetDir || ""} placeholder="粘贴 datasets/wechat 的绝对路径" onCommit={(v) => void set({ personaDatasetDir: v })} />
              </Row>
              <Row title="复制到应用目录" hint="把仓库里的 datasets/wechat 复制进应用数据目录（约 250MB），之后无需再指定路径">
                <button
                  className="btn tiny-btn"
                  onClick={async () => {
                    try {
                      const res = await act("personaDatasetCopy");
                      notify(`已复制 ${res?.chats || 0} 个会话到应用目录`);
                      set({ personaDatasetDir: res?.dir || "" });
                    } catch (err) { notify(String((err as Error)?.message || err)); }
                  }}
                >复制数据</button>
              </Row>
            </Card>
            <Card title="出网边界">
              <Row
                k="knowledgeCloudIndex"
                title="云端向量索引"
                hint="关闭时资料只做本地关键词索引，正文不出网；开启后导入与检索会把正文分块和查询串发到火山方舟，需要先在「模型与密钥」里配置 ARK_API_KEY"
              >
                <Toggle
                  value={Boolean(settings.knowledgeCloudIndex)}
                  onChange={(v) => {
                    if (v && !window.confirm("开启后，资料正文分块与检索查询串会发送到火山方舟 embedding 接口。确认开启？")) return;
                    void set({ knowledgeCloudIndex: v });
                  }}
                />
              </Row>
              <div className="settings-note">
                其余出网路径都是显式动作：Agent 运行时发模型请求、云端解析引擎（MinerU / PaddleOCR，需自己填 key）、IM 网关（需开启并填 token）。
                本应用不上报任何遥测，也没有自动更新检查。
              </div>
            </Card>
            <Card title="清理">
              <Row title="重置设置" hint="恢复全部默认值，不影响数据">
                <button className="btn tiny-btn danger" onClick={() => { if (window.confirm("恢复默认设置？")) void act("resetSettings"); }}>重置</button>
              </Row>
            </Card>
          </>
        )}

        {section === "plugins" && (
          <>
            <Card title="已安装插件">
              {(!state.plugins || state.plugins.length === 0) && <Row title="还没有插件"><span className="muted small">Notes 会作为内置 first-party 插件自动出现</span></Row>}
              {(state.plugins || []).map((plugin) => (
                <div className="settings-plugin-row" key={plugin.id}>
                  <div className="settings-plugin-main">
                    <div className="settings-plugin-name">
                      <b>{plugin.manifest?.name || plugin.id}</b>
                      {plugin.builtin && <span className="tag">内置</span>}
                      <span className="mono tiny faint">{plugin.version}</span>
                      <span className={`pill status ${plugin.enabled ? "done" : "cancelled"}`}>{plugin.enabled ? "已启用" : "已禁用"}</span>
                    </div>
                    <div className="settings-plugin-meta">{plugin.id} · {(plugin.permissions || []).join(" · ") || "无权限"}</div>
                    {plugin.lastError && <div className="settings-plugin-error">{plugin.lastError}</div>}
                    <PluginSettings act={act} plugin={plugin} />
                  </div>
                  <div className="settings-plugin-actions">
                    <button className="btn tiny-btn" onClick={() => void act(plugin.enabled ? "pluginDisable" : "pluginEnable", { id: plugin.id })}>{plugin.enabled ? "禁用" : "启用"}</button>
                    {!plugin.builtin && <button className="btn tiny-btn danger" onClick={() => { if (window.confirm(`卸载插件「${plugin.manifest?.name || plugin.id}」？`)) void act("pluginRemove", { id: plugin.id }); }}>卸载</button>}
                  </div>
                </div>
              ))}
            </Card>
            <Card title="安装">
              <Row title="本地插件" hint="选择一个包含 plugin.json 的目录；安装后默认禁用，确认权限后手动启用">
                <button className="btn tiny-btn" onClick={() => void act("pluginInstall")}>安装插件文件 / 目录…</button>
              </Row>
              <Row title="Notes 插件" hint="内置 Obsidian 风格插件；启用后在左侧「知识库」里选择 vault">
                <span className="muted small set-row-value">first-party · fs:vault · tasks:write</span>
              </Row>
            </Card>
            <Card title="插件接口">
              <Row title="API 版本" hint="Host 当前支持的 apiVersion">
                <span className="mono set-row-value">1</span>
              </Row>
              <Row title="隔离方式" hint="每个插件独立 utilityProcess；插件代码仍以当前用户权限运行">
                <span className="muted small set-row-value">utilityProcess（P0）</span>
              </Row>
            </Card>
          </>
        )}

        {section === "shortcuts" && (
          <Card title="全部快捷键">
            {SHORTCUTS.map((s) => (
              <div className="shortcut-row" key={s.keys + s.label}>
                <span className="shortcut-keys">{s.keys}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </Card>
        )}

        {section === "about" && (
          <Card title="版本与运行环境">
            <div className="about-grid">
              <span>版本</span><b>{state.appVersion ?? "0.2.0"}</b>
              <span>执行</span><b>dsh --profile acp（{state.dshRuntime?.source === "bundled" ? `内置 ${state.dshRuntime.version || ""}`.trim() : state.dshRuntime?.source === "custom" ? "自定义路径" : "系统 PATH"}）</b>
              <span>存储</span><b className="mono ellipsis" title={state.dbPath}>{state.dbPath ?? "—"}</b>
              <span>项目 / 任务</span><b>{state.projects.length} / {state.todos.length}</b>
              <span>会话 / 消息</span><b>{state.threads.length} / {state.messages.length}</b>
              <span>已检测 CLI</span><b>{(state.cliCapabilities ?? []).join(" · ") || "—"}</b>
            </div>
          </Card>
        )}
      </div>
    </div>
    </ResetCtx.Provider>
  );
}

const SHORTCUTS = [  { keys: "⌘ K", label: "命令面板" },
  { keys: "⌘ N", label: "新建会话" },
  { keys: "⌘ ⇧ N", label: "新建任务" },
  { keys: "⌘ T", label: "新建终端标签" },
  { keys: "⌘ W", label: "关闭窗格 / 标签" },
  { keys: "⌘ D / ⇧⌘ D", label: "向右 / 向下拆分" },
  { keys: "⌘ ⌥ ←/→/↑/↓", label: "切换窗格" },
  { keys: "⌃ Tab / ⇧⌃ Tab", label: "上一个 / 下一个标签" },
  { keys: "⌘ ⇧ 1…9", label: "切换到第 N 个标签" },
  { keys: "⌘ ⇧ [ / ]", label: "上一个 / 下一个标签" },
  { keys: "⌘ F", label: "终端查找" },
  { keys: "⌘ + / - / 0", label: "界面缩放（终端聚焦时调终端字号）" },
  { keys: "⇧ ⌘ K", label: "清屏" },
  { keys: "⌘ C / ⌘ V", label: "复制 / 粘贴" },
  { keys: "右键 / 双击标签", label: "菜单 / 重命名" },
  { keys: "⌘ P", label: "添加项目" },
  { keys: "⌘ ,", label: "设置" },
  { keys: "⌘ 1…9", label: "切换项目" },
  { keys: "J / K", label: "上一条 / 下一条会话" },
  { keys: "Enter", label: "发送" },
  { keys: "⇧ Enter", label: "换行" },
  { keys: "Esc", label: "取消拾取 / 关闭查找" },
];

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="set-card">
      {title && <div className="set-card-head"><b>{title}</b></div>}
      <div className="set-card-body">{children}</div>
    </section>
  );
}

function Row({ title, hint, k, children }: { title: string; hint?: string; k?: keyof SettingsModel; children: ReactNode }) {
  const ctx = useContext(ResetCtx);
  const def = k ? DEFAULTS[k] : undefined;
  const same = !ctx || !k || def === undefined || ctx.settings[k] === def;
  return (
    <div className="set-row" data-set-key={k ? String(k) : title}>
      <div className="set-row-main">
        <div className="set-row-title">
          {title}
          {ctx && k && !same && (
            <button className="set-row-reset" title="恢复默认值" onClick={() => ctx.reset(k)}>恢复默认</button>
          )}
        </div>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`switch ${value ? "on" : ""}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <i />
    </button>
  );
}

function TextSetting({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft.trim()); };
  return (
    <input
      className="settings-control settings-text"
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

function NumberSetting({ value, min, max, step = 1, onCommit }: { value: number; min: number; max: number; step?: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    const next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="settings-control settings-number"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/** 插件设置：渲染 manifest 里 contributes.settings 声明的项；值存在 plugin kv，secret 不回读 */
function PluginSettings({ act, plugin }: { act: Act; plugin: PluginRecord }) {
  const specs = plugin.manifest?.contributes?.settings || [];
  const probeCommand = (plugin.manifest?.contributes?.commands || []).find((c) => c.id.endsWith(".probe"));
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !plugin.enabled) return;
    let alive = true;
    void (async () => {
      try {
        const loaded = (await act("pluginSettings", { id: plugin.id })) as SettingRow[] | null;
        if (alive) setRows(loaded || []);
      } catch (err) {
        if (alive) setNote(String((err as Error)?.message || err));
      }
    })();
    return () => { alive = false; };
  }, [act, open, plugin.enabled, plugin.id]);

  if (!specs.length) return null;

  const save = async (key: string, value: unknown, type: string) => {
    try {
      await act("pluginSetSetting", { id: plugin.id, key, value });
      setRows((prev) => prev?.map((row) => (row.key === key
        ? { ...row, value: type === "secret" ? "" : value, hasValue: type === "secret" ? Boolean(value) : row.hasValue }
        : row)) ?? prev);
      setNote("");
    } catch (err) {
      setNote(String((err as Error)?.message || err));
    }
  };

  const probe = async () => {
    if (!probeCommand) return;
    setBusy(true);
    setNote("");
    try {
      const res = (await act("pluginRunCommand", { pluginId: plugin.id, commandId: probeCommand.id, args: {} })) as { ok?: boolean; detail?: string } | null;
      setNote(res?.detail || (res?.ok ? "后端可达" : "后端不可用"));
    } catch (err) {
      setNote(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-plugin-settings">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn tiny-btn" onClick={() => setOpen((v) => !v)}>{open ? "收起配置" : "配置"}</button>
        {probeCommand && <button className="btn tiny-btn" disabled={!plugin.enabled || busy} onClick={() => void probe()}>{busy ? "探测中…" : "探测后端"}</button>}
        {!plugin.enabled && <span className="muted small">启用后可配置</span>}
      </div>
      {open && plugin.enabled && (
        <div className="settings-plugin-fields">
          {!rows && <span className="muted small">读取中…</span>}
          {(rows || []).map((row) => (
            <Row key={row.key} title={row.title || row.key} hint={row.description}>
              {row.type === "enum" ? (
                <select className="settings-control" value={String(row.value ?? "")} onChange={(event) => void save(row.key, event.target.value, row.type)}>
                  {(row.options || []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : row.type === "boolean" ? (
                <Toggle value={Boolean(row.value)} onChange={(value) => void save(row.key, value, row.type)} />
              ) : row.type === "number" ? (
                <NumberSetting value={Number(row.value) || 0} min={0} max={600000} onCommit={(value) => void save(row.key, value, row.type)} />
              ) : row.type === "secret" ? (
                <SecretSetting hasValue={Boolean(row.hasValue)} placeholder={row.placeholder} onCommit={(value) => void save(row.key, value, row.type)} />
              ) : (
                <TextSetting value={String(row.value ?? "")} placeholder={row.placeholder} onCommit={(value) => void save(row.key, value, row.type)} />
              )}
            </Row>
          ))}
          {note && <div className="settings-note">{note}</div>}
        </div>
      )}
    </div>
  );
}

/** 密钥输入：不回显已存值，只提示「已设置」；留空提交表示不改 */
function SecretSetting({ hasValue, placeholder, onCommit }: { hasValue: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const value = draft.trim();
    if (!value) return;
    onCommit(value);
    setDraft("");
  };
  return (
    <input
      className="settings-control settings-text"
      type="password"
      value={draft}
      placeholder={hasValue ? "已设置（留空不改）" : (placeholder || "可选")}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
    />
  );
}

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

/** 预览页站点权限：只由用户显式授权，这里只做查看与撤销 */
function PreviewPermissions() {
  const [sites, setSites] = useState<{ origin: string; permissions: { key: string; label: string }[] }[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true;
    window.harness.previewPermissions().then((list) => { if (alive) setSites(list); }).catch(() => { /* 主进程未就绪 */ });
    return () => { alive = false; };
  }, []);
  if (!sites.length) {
    return (
      <div className="settings-note">
        还没有授权记录。预览页请求摄像头 / 麦克风 / 剪贴板 / 通知时，会在预览顶部出现「允许并刷新」。
      </div>
    );
  }
  const revoke = async (origin: string, permission: string) => {
    setBusy(`${origin}|${permission}`);
    try {
      const res = await window.harness.previewRevokePermission(origin, permission);
      setSites(res.sites || []);
    } finally { setBusy(""); }
  };
  return (
    <div className="settings-note" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sites.map((site) => (
        <div key={site.origin} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <code>{site.origin}</code>
          {site.permissions.map((p) => (
            <button
              key={p.key}
              className="btn tiny-btn"
              disabled={busy === `${site.origin}|${p.key}`}
              title={`撤销「${p.label}」授权`}
              onClick={() => void revoke(site.origin, p.key)}
            >
              {p.label} ✕
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
