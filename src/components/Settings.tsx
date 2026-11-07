import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Settings as SettingsModel, State } from "../types";
import { THEMES } from "../themes";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Section = "general" | "appearance" | "execution" | "terminal" | "preview" | "data" | "shortcuts" | "about";

const SECTIONS: { id: Section; label: string; desc: string }[] = [
  { id: "general", label: "通用", desc: "启动视图、默认 Agent、发送与停止行为；改动即时生效。" },
  { id: "appearance", label: "外观", desc: "主题与字号；跟随系统时会随系统深浅色切换。" },
  { id: "execution", label: "执行", desc: "Agent 并发、审批策略和 dsh 启动参数；新 run 生效。" },
  { id: "terminal", label: "终端", desc: "pty 的 shell、字号、回滚缓冲和 dev server 地址识别。" },
  { id: "preview", label: "预览与元素", desc: "前端预览地址、元素拾取截图和注入 Chat 的上下文详细度。" },
  { id: "data", label: "数据", desc: "本地数据库位置、备份导出和清理。" },
  { id: "shortcuts", label: "快捷键", desc: "当前版本可用的键盘操作。" },
  { id: "about", label: "关于", desc: "版本、运行环境与本地数据。" },
];

/** 与 electron/db.mjs DEFAULT_SETTINGS 对齐：用于「恢复默认」判定与恢复 */
const DEFAULTS: Partial<Record<keyof SettingsModel, unknown>> = {
  defaultView: "workspace", defaultAgentId: null, enterToSend: true, confirmStop: false,
  theme: "system", chatFontSize: 13,
  maxConcurrentRuns: 0, approvalPolicy: "ask", dshBinary: "", dshHome: "", model: "", effort: "",
  superAgentEnabled: true, maxSupervisorRuns: 1, maxMissionChildren: 4, missionBudgetMinutes: 30,
  shellPath: "", terminalFontSize: 12, terminalScrollback: 5000, autoDetectDevServerUrl: true,
  previewHomeUrl: "http://localhost:5173/", elementScreenshots: true, contextDetail: "standard",
  dshEnv: "",
};

/** 恢复本页默认 */
const SECTION_KEYS: Partial<Record<Section, (keyof SettingsModel)[]>> = {
  general: ["defaultView", "defaultAgentId", "enterToSend", "confirmStop"],
  appearance: ["theme", "chatFontSize"],
  execution: ["maxConcurrentRuns", "approvalPolicy", "dshBinary", "dshHome", "dshEnv", "model", "effort",
    "superAgentEnabled", "maxSupervisorRuns", "maxMissionChildren", "missionBudgetMinutes"],
  terminal: ["shellPath", "terminalFontSize", "terminalScrollback", "autoDetectDevServerUrl"],
  preview: ["previewHomeUrl", "elementScreenshots", "contextDetail"],
};

/** 搜索索引：标题 / 说明 / 分区，命中后跳到对应行 */
const SEARCH_INDEX: { section: Section; title: string; hint?: string; k?: string }[] = [
  { section: "general", title: "启动视图", k: "defaultView", hint: "打开应用时的首屏" },
  { section: "general", title: "默认 Agent", k: "defaultAgentId", hint: "新会话默认派给谁" },
  { section: "general", title: "Enter 发送", k: "enterToSend", hint: "关闭后用 ⌘Enter 发送" },
  { section: "general", title: "停止前确认", k: "confirmStop", hint: "停止运行前弹确认" },
  { section: "general", title: "重置面板尺寸", hint: "TODO / Chat / Terminal / 文件列宽" },
  { section: "appearance", title: "主题", k: "theme", hint: "跟随系统 / 浅色 / 纸感 / 深色 / 午夜蓝 / 森林 / 石墨" },
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
  { section: "execution", title: "Chat 执行适配器", hint: "哪些 CLI 能派活" },
  { section: "execution", title: "已检测到的 CLI", hint: "dsh / pi / claude / codex / opencode" },
  { section: "terminal", title: "Shell 路径", k: "shellPath", hint: "留空用 $SHELL" },
  { section: "terminal", title: "终端字号", k: "terminalFontSize", hint: "10–18px" },
  { section: "terminal", title: "回滚缓冲", k: "terminalScrollback", hint: "历史行数" },
  { section: "terminal", title: "识别 dev server 地址", k: "autoDetectDevServerUrl", hint: "终端输出里的 localhost 地址" },
  { section: "preview", title: "默认地址", k: "previewHomeUrl", hint: "预览标签默认打开的 URL" },
  { section: "preview", title: "保存截图", k: "elementScreenshots", hint: "拾取元素时截图" },
  { section: "preview", title: "上下文详细度", k: "contextDetail", hint: "注入 Chat 的 UI 上下文详略" },
  { section: "data", title: "数据库文件", hint: "harness.db 路径" },
  { section: "data", title: "数据目录", hint: "userData" },
  { section: "data", title: "导出备份", hint: "导出 .db" },
  { section: "data", title: "清空收件箱" },
  { section: "data", title: "重置设置", hint: "恢复全部默认" },
  { section: "shortcuts", title: "快捷键", hint: "⌘K / ⌘N / ⌘E …" },
  { section: "about", title: "关于", hint: "版本 / 数据位置" },
];

/** 行内「恢复默认」通过 context 读取，避免每个 Row 都传一大串 props */
const ResetCtx = createContext<{ settings: SettingsModel; reset: (k: keyof SettingsModel) => void } | null>(null);

export function Settings({ state, act, notify }: { state: State; act: Act; notify: (m: string) => void }) {
  const [section, setSection] = useState<Section>("general");
  const [query, setQuery] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
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
    setFlashKey(String(k));
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
              if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
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
          SECTIONS.map((item) => (
            <button
              key={item.id}
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
          ))
        )}
      </aside>

      <div className="settings-body" ref={bodyRef}>
        <header className="settings-head">
          <div className="settings-head-row">
            <h2>{current.label}</h2>
            <div className="row gap8">
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
            </div>
          </div>
          <p>{current.desc}</p>
        </header>

        {section === "general" && (
          <>
            <Card title="启动">
              <Row k="defaultView" title="启动视图">
                <select className="settings-control" value={settings.defaultView} onChange={(e) => void set({ defaultView: e.target.value as SettingsModel["defaultView"] })}>
                  <option value="workspace">工作区</option>
                  <option value="projects">项目</option>
                  <option value="stats">统计</option>
                  <option value="hosts">主机</option>
                </select>
              </Row>
              <Row k="defaultAgentId" title="默认 Agent">
                <select className="settings-control" value={settings.defaultAgentId ?? ""} onChange={(e) => void set({ defaultAgentId: e.target.value || null })}>
                  <option value="">自动</option>
                  {state.agents.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.chatRunnable === false}>
                      {a.name}{a.chatRunnable === false ? "（终端专用）" : ""}
                    </option>
                  ))}
                </select>
              </Row>
            </Card>

            <Card title="聊天与运行">
              <Row k="enterToSend" title="Enter 发送">
                <Toggle value={settings.enterToSend} onChange={(v) => void set({ enterToSend: v })} />
              </Row>
              <Row k="confirmStop" title="停止前确认">
                <Toggle value={settings.confirmStop} onChange={(v) => void set({ confirmStop: v })} />
              </Row>
            </Card>

            <Card title="布局">
              <Row title="重置面板尺寸">
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
            <Card title="字号">
              <Row k="chatFontSize" title="Chat 字号" hint="消息正文和输入框；11–16px">
                <NumberSetting value={settings.chatFontSize} min={11} max={16} onCommit={(v) => void set({ chatFontSize: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "execution" && (
          <>
            <Card title="并发与审批">
              <Row k="maxConcurrentRuns" title="全局并发上限">
                <NumberSetting value={settings.maxConcurrentRuns} min={0} max={20} onCommit={(v) => void set({ maxConcurrentRuns: v })} />
              </Row>
              <Row k="approvalPolicy" title="审批策略">
                <select className="settings-control" value={settings.approvalPolicy} onChange={(e) => void set({ approvalPolicy: e.target.value as SettingsModel["approvalPolicy"] })}>
                  <option value="ask">每次询问</option>
                  <option value="allow">自动批准</option>
                  <option value="deny">自动拒绝</option>
                </select>
              </Row>
            </Card>

            <Card title="dsh">
              <Row title="运行时">
                <span className="muted small ellipsis" title={state.dshRuntime?.path || "dsh"}>
                  {state.dshRuntime?.source === "custom"
                    ? `自定义 · ${state.dshRuntime.path}`
                    : state.dshRuntime?.source === "bundled"
                      ? `内置 · ${state.dshRuntime.version || "unknown"}`
                      : state.cliCapabilities.includes("dsh")
                        ? "系统 PATH"
                        : "未检测到"}
                </span>
              </Row>
              <Row k="dshBinary" title="可执行文件">
                <TextSetting value={settings.dshBinary} placeholder="dsh" onCommit={(v) => void set({ dshBinary: v })} />
              </Row>
              <Row k="dshHome" title="DSH_HOME">
                <TextSetting value={settings.dshHome} placeholder="默认" onCommit={(v) => void set({ dshHome: v })} />
              </Row>
              <Row k="model" title="默认模型（高级）" hint="推荐在 Chat 底部选择（选项来自 dsh ACP）；这里填 ACP 的 option value，纯模型 ID 可能被 dsh 拒绝">
                <TextSetting value={settings.model} placeholder="默认" onCommit={(v) => void set({ model: v })} />
              </Row>
              <Row k="effort" title="Reasoning effort">
                <TextSetting value={settings.effort} placeholder="默认" onCommit={(v) => void set({ effort: v })} />
              </Row>
            </Card>

            <Card title="模型密钥 / 环境变量">
              <Row
                k="dshEnv"
                title="额外环境变量"
                hint="每行一条 KEY=VALUE，只注入本机启动的 dsh（远端主机请在目标机自己配）。用来填 DEEPSEEK_API_KEY 这类密钥。"
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

            <Card title="Super Agent / Mission">
              <Row k="superAgentEnabled" title="启用 Mission 模式" hint="关闭后不能再创建或运行 supervisor；已有 Mission 保留">
                <Toggle value={settings.superAgentEnabled !== false} onChange={(v) => void set({ superAgentEnabled: v })} />
              </Row>
              <Row k="maxSupervisorRuns" title="Supervisor 并发" hint="同一时间最多几个主管会话；子任务仍受全局并发限制">
                <NumberSetting value={settings.maxSupervisorRuns ?? 1} min={1} max={4} onCommit={(v) => void set({ maxSupervisorRuns: v })} />
              </Row>
              <Row k="maxMissionChildren" title="Mission 子任务上限" hint="每个 Mission 最多创建多少个子任务；Agent 自己的 maxChildren 不能超过它">
                <NumberSetting value={settings.maxMissionChildren ?? 4} min={1} max={12} onCommit={(v) => void set({ maxMissionChildren: v })} />
              </Row>
              <Row k="missionBudgetMinutes" title="Mission 时长预算" hint="仅作为主管提示和 UI 约束；真正取消仍需人工或预算硬闸">
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

            <Card title="Chat 执行适配器">
              {(state.executors ?? []).map((e) => (
                <Row key={e.id} title={e.id}>
                  <span className={`tag ${e.implemented && e.available ? "ok" : ""}`}>
                    {e.implemented ? (e.available ? "可派活" : "未安装") : "终端专用"}
                  </span>
                </Row>
              ))}
            </Card>

            <Card title="已检测到的 CLI">
              <div className="settings-tags">
                {(state.cliCapabilities ?? []).length
                  ? state.cliCapabilities.map((c) => <span key={c} className="tag ok">{c}</span>)
                  : <span className="muted small">—</span>}
              </div>
            </Card>
          </>
        )}

        {section === "terminal" && (
          <>
            <Card title="Shell">
              <Row k="shellPath" title="Shell 路径" hint="留空使用 $SHELL；Windows 默认 powershell">
                <TextSetting value={settings.shellPath} placeholder="/bin/zsh" onCommit={(v) => void set({ shellPath: v })} />
              </Row>
              <Row k="terminalFontSize" title="终端字号" hint="10–18px；也可以在终端里用 ⌘+ / ⌘- 临时缩放">
                <NumberSetting value={settings.terminalFontSize} min={10} max={18} onCommit={(v) => void set({ terminalFontSize: v })} />
              </Row>
              <Row k="terminalScrollback" title="回滚缓冲" hint="每个终端保留的历史行数；越大越占内存">
                <NumberSetting value={settings.terminalScrollback} min={1000} max={50000} step={500} onCommit={(v) => void set({ terminalScrollback: v })} />
              </Row>
            </Card>
            <Card title="开发服务器">
              <Row k="autoDetectDevServerUrl" title="识别 dev server 地址">
                <Toggle value={settings.autoDetectDevServerUrl} onChange={(v) => void set({ autoDetectDevServerUrl: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "preview" && (
          <>
            <Card title="预览">
              <Row k="previewHomeUrl" title="默认地址">
                <TextSetting value={settings.previewHomeUrl} placeholder="http://localhost:5173/" onCommit={(v) => void set({ previewHomeUrl: v })} />
              </Row>
              <Row k="elementScreenshots" title="保存截图">
                <Toggle value={settings.elementScreenshots} onChange={(v) => void set({ elementScreenshots: v })} />
              </Row>
              <Row k="contextDetail" title="上下文详细度">
                <select className="settings-control" value={settings.contextDetail} onChange={(e) => void set({ contextDetail: e.target.value as SettingsModel["contextDetail"] })}>
                  <option value="compact">简洁</option>
                  <option value="standard">标准</option>
                </select>
              </Row>
            </Card>
            <Card title="源码定位">
              <div className="settings-note">
                <code>data-ym-src="src/x.tsx:42"</code> → <code>_debugSource</code> → 组件名 + selector
              </div>
            </Card>
          </>
        )}

        {section === "data" && (
          <>
            <Card title="本地数据库">
              <Row title="数据库文件">
                <span className="mono tiny ellipsis" title={state.dbPath}>{state.dbPath ?? "—"}</span>
                <button className="btn tiny-btn" onClick={() => { void navigator.clipboard?.writeText(state.dbPath ?? ""); notify("已复制"); }}>复制</button>
              </Row>
              <Row title="数据目录">
                <span className="mono tiny ellipsis" title={state.userDataPath}>{state.userDataPath ?? "—"}</span>
                <button className="btn tiny-btn" onClick={() => void act("openDataDir")}>打开</button>
              </Row>
              <Row title="导出备份">
                <button className="btn tiny-btn" onClick={async () => { const p = await act("exportData"); if (p) notify(`已导出：${p}`); }}>导出 .db</button>
              </Row>
            </Card>
            <Card title="清理">
              <Row title="清空收件箱">
                <button className="btn tiny-btn" onClick={() => { if (window.confirm("清空收件箱？")) void act("clearInbox"); }}>清空</button>
              </Row>
              <Row title="重置设置">
                <button className="btn tiny-btn danger" onClick={() => { if (window.confirm("恢复默认设置？")) void act("resetSettings"); }}>重置</button>
              </Row>
            </Card>
          </>
        )}

        {section === "shortcuts" && (
          <Card title="键盘">
            {SHORTCUTS.map((s) => (
              <div className="shortcut-row" key={s.keys + s.label}>
                <span className="shortcut-keys">{s.keys}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </Card>
        )}

        {section === "about" && (
          <Card title="Cockpit Harness">
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

const SHORTCUTS = [
  { keys: "⌘ K", label: "命令面板" },
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
  { keys: "⌘ + / - / 0", label: "终端字号" },
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
