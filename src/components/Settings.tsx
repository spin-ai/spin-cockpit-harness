import { useEffect, useState, type ReactNode } from "react";
import type { Settings as SettingsModel, State } from "../types";

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

export function Settings({ state, act, notify }: { state: State; act: Act; notify: (m: string) => void }) {
  const [section, setSection] = useState<Section>("general");
  const settings = state.settings;

  if (!settings) {
    return <div className="pane-empty">设置不可用</div>;
  }

  const set = async (patch: Partial<SettingsModel>) => {
    await act("setSettings", patch);
  };

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <div className="settings-nav-head"><b>设置</b></div>
        {SECTIONS.map((item) => (
          <button key={item.id} className={`settings-nav-item ${section === item.id ? "on" : ""}`} onClick={() => setSection(item.id)}>
            {item.label}
          </button>
        ))}
      </aside>

      <div className="settings-body">
        <header className="settings-head">
          <h2>{current.label}</h2>
          <p>{current.desc}</p>
        </header>

        {section === "general" && (
          <>
            <Card title="启动">
              <Row title="启动视图">
                <select className="settings-control" value={settings.defaultView} onChange={(e) => void set({ defaultView: e.target.value as SettingsModel["defaultView"] })}>
                  <option value="workspace">工作区</option>
                  <option value="projects">项目</option>
                  <option value="stats">统计</option>
                  <option value="hosts">主机</option>
                </select>
              </Row>
              <Row title="默认 Agent">
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
              <Row title="Enter 发送">
                <Toggle value={settings.enterToSend} onChange={(v) => void set({ enterToSend: v })} />
              </Row>
              <Row title="停止前确认">
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
              <Row title="外观模式">
                <select className="settings-control" value={settings.theme} onChange={(e) => void set({ theme: e.target.value as SettingsModel["theme"] })}>
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </Row>
            </Card>
            <Card title="字号">
              <Row title="Chat 字号" hint="消息正文和输入框；11–16px">
                <NumberSetting value={settings.chatFontSize} min={11} max={16} onCommit={(v) => void set({ chatFontSize: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "execution" && (
          <>
            <Card title="并发与审批">
              <Row title="全局并发上限">
                <NumberSetting value={settings.maxConcurrentRuns} min={0} max={20} onCommit={(v) => void set({ maxConcurrentRuns: v })} />
              </Row>
              <Row title="审批策略">
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
              <Row title="可执行文件">
                <TextSetting value={settings.dshBinary} placeholder="dsh" onCommit={(v) => void set({ dshBinary: v })} />
              </Row>
              <Row title="DSH_HOME">
                <TextSetting value={settings.dshHome} placeholder="默认" onCommit={(v) => void set({ dshHome: v })} />
              </Row>
              <Row title="默认模型（高级）" hint="推荐在 Chat 底部选择（选项来自 dsh ACP）；这里填 ACP 的 option value，纯模型 ID 可能被 dsh 拒绝">
                <TextSetting value={settings.model} placeholder="默认" onCommit={(v) => void set({ model: v })} />
              </Row>
              <Row title="Reasoning effort">
                <TextSetting value={settings.effort} placeholder="默认" onCommit={(v) => void set({ effort: v })} />
              </Row>
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
              <Row title="Shell 路径" hint="留空使用 $SHELL；Windows 默认 powershell">
                <TextSetting value={settings.shellPath} placeholder="/bin/zsh" onCommit={(v) => void set({ shellPath: v })} />
              </Row>
              <Row title="终端字号" hint="10–18px；也可以在终端里用 ⌘+ / ⌘- 临时缩放">
                <NumberSetting value={settings.terminalFontSize} min={10} max={18} onCommit={(v) => void set({ terminalFontSize: v })} />
              </Row>
              <Row title="回滚缓冲" hint="每个终端保留的历史行数；越大越占内存">
                <NumberSetting value={settings.terminalScrollback} min={1000} max={50000} step={500} onCommit={(v) => void set({ terminalScrollback: v })} />
              </Row>
            </Card>
            <Card title="开发服务器">
              <Row title="识别 dev server 地址">
                <Toggle value={settings.autoDetectDevServerUrl} onChange={(v) => void set({ autoDetectDevServerUrl: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "preview" && (
          <>
            <Card title="预览">
              <Row title="默认地址">
                <TextSetting value={settings.previewHomeUrl} placeholder="http://localhost:5173/" onCommit={(v) => void set({ previewHomeUrl: v })} />
              </Row>
              <Row title="保存截图">
                <Toggle value={settings.elementScreenshots} onChange={(v) => void set({ elementScreenshots: v })} />
              </Row>
              <Row title="上下文详细度">
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

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-main"><div className="set-row-title">{title}</div>{hint && <div className="set-row-hint">{hint}</div>}</div>
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
