import { useEffect, useState, type ReactNode } from "react";
import type { Settings as SettingsModel, State } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Section = "general" | "appearance" | "execution" | "terminal" | "preview" | "data" | "shortcuts" | "about";

const SECTIONS: { id: Section; label: string; desc: string }[] = [
  { id: "general", label: "通用", desc: "启动视图、默认 Agent、发送与停止行为、布局。" },
  { id: "appearance", label: "外观", desc: "主题与字号。跟随系统时会自动切换。" },
  { id: "execution", label: "执行", desc: "Agent 的并发、审批与 dsh 启动参数。新 run 生效。" },
  { id: "terminal", label: "终端", desc: "pty 使用的 shell、字号、回滚缓冲与 dev server 识别。" },
  { id: "preview", label: "预览与元素", desc: "前端预览地址、元素拾取截图与上下文详细度。" },
  { id: "data", label: "数据", desc: "本地数据库位置、备份导出与清理。" },
  { id: "shortcuts", label: "快捷键", desc: "当前版本可用的键盘操作。" },
  { id: "about", label: "关于", desc: "版本、能力与运行环境。" },
];

export function Settings({ state, act, notify }: { state: State; act: Act; notify: (m: string) => void }) {
  const [section, setSection] = useState<Section>("general");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const settings = state.settings;

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(t);
  }, [savedAt]);

  if (!settings) {
    return <div className="pane-empty">设置暂不可用：主进程没有返回 settings（重启应用或检查数据库）。</div>;
  }

  const set = async (patch: Partial<SettingsModel>) => {
    const res = await act("setSettings", patch);
    if (res) setSavedAt(Date.now());
  };

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <div className="settings-nav-head">
          <b>设置</b>
          <span className="tiny muted">{savedAt ? "已自动保存" : "改动即时生效"}</span>
        </div>
        {SECTIONS.map((item) => (
          <button key={item.id} className={`settings-nav-item ${section === item.id ? "on" : ""}`} onClick={() => setSection(item.id)}>
            {item.label}
          </button>
        ))}
        <div className="settings-nav-foot tiny muted">YieldMind Harness {state.appVersion ?? ""}</div>
      </aside>

      <div className="settings-body">
        <header className="settings-head">
          <h2>{current.label}</h2>
          <p>{current.desc}</p>
        </header>

        {section === "general" && (
          <>
            <Card title="启动" hint="下次打开应用时生效">
              <Row title="启动视图" hint="打开应用后默认停留在哪一页">
                <select className="settings-control" value={settings.defaultView} onChange={(e) => void set({ defaultView: e.target.value as SettingsModel["defaultView"] })}>
                  <option value="workspace">工作区</option>
                  <option value="projects">项目</option>
                  <option value="stats">统计</option>
                  <option value="hosts">主机</option>
                </select>
              </Row>
              <Row title="默认 Agent" hint="新建会话 / 派活时的默认执行者">
                <select className="settings-control" value={settings.defaultAgentId ?? ""} onChange={(e) => void set({ defaultAgentId: e.target.value || null })}>
                  <option value="">自动（按项目）</option>
                  {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Row>
            </Card>

            <Card title="聊天与运行">
              <Row title="Enter 直接发送" hint="关闭后 Enter 换行，⌘/Ctrl + Enter 发送">
                <Toggle value={settings.enterToSend} onChange={(v) => void set({ enterToSend: v })} />
              </Row>
              <Row title="停止运行前确认" hint="避免误停正在跑的任务">
                <Toggle value={settings.confirmStop} onChange={(v) => void set({ confirmStop: v })} />
              </Row>
            </Card>

            <Card title="布局">
              <Row title="重置面板尺寸" hint="TODO / Chat / 终端 / 文件四列恢复默认宽度">
                <button className="btn tiny-btn" onClick={() => { window.dispatchEvent(new Event("harness:reset-layout")); notify("面板尺寸已重置"); }}>重置布局</button>
              </Row>
            </Card>
          </>
        )}

        {section === "appearance" && (
          <>
            <Card title="主题">
              <Row title="外观模式" hint="跟随系统会随 macOS 深浅色自动切换">
                <select className="settings-control" value={settings.theme} onChange={(e) => void set({ theme: e.target.value as SettingsModel["theme"] })}>
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </Row>
            </Card>
            <Card title="字号">
              <Row title="Chat 字号" hint="消息气泡与输入框，11–16px">
                <NumberSetting value={settings.chatFontSize} min={11} max={16} onCommit={(v) => void set({ chatFontSize: v })} />
              </Row>
              <Row title="终端字号" hint="xterm 渲染字号，10–18px">
                <NumberSetting value={settings.terminalFontSize} min={10} max={18} onCommit={(v) => void set({ terminalFontSize: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "execution" && (
          <>
            <Card title="并发与审批" hint="新 run 生效">
              <Row title="全局并发上限" hint="0 = 只受每个 Agent 的上限约束；超出时任务显示「等待全局并发」">
                <NumberSetting value={settings.maxConcurrentRuns} min={0} max={20} onCommit={(v) => void set({ maxConcurrentRuns: v })} />
              </Row>
              <Row title="审批策略" hint="ACP session/request_permission 的处理方式">
                <select className="settings-control" value={settings.approvalPolicy} onChange={(e) => void set({ approvalPolicy: e.target.value as SettingsModel["approvalPolicy"] })}>
                  <option value="ask">每次询问（弹窗）</option>
                  <option value="allow">自动批准</option>
                  <option value="deny">自动拒绝</option>
                </select>
              </Row>
            </Card>

            <Card title="dsh 启动" hint="留空则使用 PATH / 默认配置；新 run 生效">
              <Row title="可执行文件" hint="例如 /opt/homebrew/bin/dsh">
                <TextSetting value={settings.dshBinary} placeholder="dsh" onCommit={(v) => void set({ dshBinary: v })} />
              </Row>
              <Row title="DSH_HOME" hint="独立配置目录（可选）">
                <TextSetting value={settings.dshHome} placeholder="默认" onCommit={(v) => void set({ dshHome: v })} />
              </Row>
              <Row title="模型" hint="对应 session/set_config_option: model">
                <TextSetting value={settings.model} placeholder="默认" onCommit={(v) => void set({ model: v })} />
              </Row>
              <Row title="Reasoning effort" hint="对应 session/set_config_option: reasoning_effort">
                <TextSetting value={settings.effort} placeholder="默认" onCommit={(v) => void set({ effort: v })} />
              </Row>
            </Card>

            <Card title="已检测到的 CLI">
              <div className="settings-tags">
                {(state.cliCapabilities ?? []).length
                  ? state.cliCapabilities.map((c) => <span key={c} className="tag ok">{c}</span>)
                  : <span className="muted small">未检测到 dsh / pi / claude / codex / opencode</span>}
              </div>
            </Card>
          </>
        )}

        {section === "terminal" && (
          <>
            <Card title="Shell">
              <Row title="Shell 路径" hint="留空使用 $SHELL（Windows 为 powershell）">
                <TextSetting value={settings.shellPath} placeholder="/bin/zsh" onCommit={(v) => void set({ shellPath: v })} />
              </Row>
              <Row title="回滚缓冲" hint="每行数；1000–50000">
                <NumberSetting value={settings.terminalScrollback} min={1000} max={50000} step={500} onCommit={(v) => void set({ terminalScrollback: v })} />
              </Row>
            </Card>
            <Card title="开发服务器">
              <Row title="自动识别 dev server 地址" hint="从终端输出里抓 localhost 地址，出现「打开预览」">
                <Toggle value={settings.autoDetectDevServerUrl} onChange={(v) => void set({ autoDetectDevServerUrl: v })} />
              </Row>
            </Card>
          </>
        )}

        {section === "preview" && (
          <>
            <Card title="预览">
              <Row title="默认地址" hint="预览页签打开时预填的 URL">
                <TextSetting value={settings.previewHomeUrl} placeholder="http://localhost:5173/" onCommit={(v) => void set({ previewHomeUrl: v })} />
              </Row>
              <Row title="拾取时保存截图" hint="截图写入应用数据目录，并在上下文里给出绝对路径">
                <Toggle value={settings.elementScreenshots} onChange={(v) => void set({ elementScreenshots: v })} />
              </Row>
              <Row title="上下文详细度" hint="简洁：selector + 文本；标准：+ 组件 / 样式 / HTML">
                <select className="settings-control" value={settings.contextDetail} onChange={(e) => void set({ contextDetail: e.target.value as SettingsModel["contextDetail"] })}>
                  <option value="compact">简洁</option>
                  <option value="standard">标准</option>
                </select>
              </Row>
            </Card>
            <Card title="源码定位" hint="元素 → 源文件">
              <div className="settings-note">
                优先级：元素或祖先的 <code>data-ym-src="src/x.tsx:42"</code> → React 开发态的 <code>_debugSource</code> → 组件名 + selector。
                非 React 项目建议在关键元素上手写 <code>data-ym-src</code>。
              </div>
            </Card>
          </>
        )}

        {section === "data" && (
          <>
            <Card title="本地数据库" hint="sql.js 单文件，升级/回滚前建议先导出">
              <Row title="数据库文件" hint={state.dbPath ?? "—"}>
                <button className="btn tiny-btn" onClick={() => { void navigator.clipboard?.writeText(state.dbPath ?? ""); notify("路径已复制"); }}>复制路径</button>
              </Row>
              <Row title="数据目录" hint={state.userDataPath ?? "—"}>
                <button className="btn tiny-btn" onClick={() => void act("openDataDir")}>在 Finder 中打开</button>
              </Row>
              <Row title="导出备份" hint="先落盘再复制，包含设置与全部任务">
                <button className="btn tiny-btn" onClick={async () => { const p = await act("exportData"); if (p) notify(`已导出：${p}`); }}>导出 .db</button>
              </Row>
            </Card>
            <Card title="清理">
              <Row title="清空收件箱" hint="只删通知，不影响任务与会话">
                <button className="btn tiny-btn" onClick={() => { if (window.confirm("清空收件箱？")) void act("clearInbox"); }}>清空</button>
              </Row>
              <Row title="重置所有设置" hint="恢复默认值，不动任务与项目">
                <button className="btn tiny-btn danger" onClick={() => { if (window.confirm("把所有设置恢复为默认值？")) void act("resetSettings"); }}>重置设置</button>
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
          <Card title="YieldMind Harness">
            <div className="about-grid">
              <span>版本</span><b>{state.appVersion ?? "0.2.0"}</b>
              <span>执行</span><b>dsh --profile acp（本地 / SSH）</b>
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
  { keys: "⌘ N", label: "新建会话 / 任务" },
  { keys: "⌘ T", label: "新建终端" },
  { keys: "⌘ W", label: "关闭当前终端" },
  { keys: "⌘ P", label: "打开 / 添加项目" },
  { keys: "⌘ ,", label: "打开设置" },
  { keys: "⌘ 1…9", label: "切换到第 N 个项目" },
  { keys: "J / K", label: "上一条 / 下一条会话" },
  { keys: "Enter", label: "发送（可在通用里改为换行）" },
  { keys: "Shift + Enter", label: "聊天输入换行" },
  { keys: "Esc", label: "取消预览元素拾取" },
];

function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="set-card">
      {(title || hint) && (
        <div className="set-card-head">
          {title && <b>{title}</b>}
          {hint && <span>{hint}</span>}
        </div>
      )}
      <div className="set-card-body">{children}</div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-main">
        <div className="set-row-title">{title}</div>
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
