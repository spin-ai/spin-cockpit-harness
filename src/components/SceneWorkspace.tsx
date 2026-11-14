import { useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { SceneGallery } from "./SceneGallery";
import { ExecutionConfigTab } from "./ExecutionConfigTab";
import { SCENE_TEMPLATES, templateLabel, templateOf } from "../office/templates";
import { OfficeLive } from "./OfficeLive";
import { buildOfficeModel, type OfficeCastMember } from "../office/model";
import { DEFAULT_MOTION, MOTION_LABEL, motionOf, type ScenePrefs } from "../office/SceneConfigPanel";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Tab = "gallery" | "live" | "lights" | "execution";

function defaultPrefs(projectName: string): ScenePrefs {
  return {
    name: `${projectName || "研发"} 小队`,
    template: "office",
    reviewGate: true,
    escalate: true,
    inject: false,
    showLinks: true,
    showLabels: true,
    light: "auto",
    motion: { ...DEFAULT_MOTION },
  };
}

function prefsOf(scene: { name: string; template: ScenePrefs["template"]; config: { prefs: Partial<ScenePrefs> } }, fallbackName: string): ScenePrefs {
  const base = defaultPrefs(fallbackName);
  const saved = scene.config.prefs ?? {};
  return { ...base, ...saved, name: scene.name, template: templateOf(scene.template), motion: { ...DEFAULT_MOTION, ...(saved.motion ?? {}) } };
}

export function SceneWorkspace({ state, now, act, notify, onOpenTask, onOpenThread, onOpenTerminal, onNewThread, onOpenProjects, initialTab = "live", initialSelectedId = null, initialDetailOpen = false, initialMode = "live" }: {
  state: State;
  now: number;
  act: Act;
  notify: (message: string) => void;
  onOpenTask: (todoId: string) => void;
  onOpenThread: (threadId: string) => void;
  onOpenTerminal: (cwd: string, terminalId?: string) => void;
  onNewThread: () => void;
  onOpenProjects: () => void;
  initialTab?: Tab;
  initialSelectedId?: string | null;
  initialDetailOpen?: boolean;
  initialMode?: "live" | "config";
}) {
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? null;
  const projectKey = state.activeProjectId || "global";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [newScene, setNewScene] = useState<{ name: string; template: ScenePrefs["template"] } | null>(null);
  const [localCast, setLocalCast] = useState<OfficeCastMember[] | null>(null);
  const [localPrefs, setLocalPrefs] = useState<ScenePrefs | null>(null);
  const [replaySignal, setReplaySignal] = useState(0);
  const ensuring = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const scenes = useMemo(() => (state.coordinationScenes ?? []).filter((s) => (s.projectId || null) === (state.activeProjectId || null)), [state.coordinationScenes, state.activeProjectId]);
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0] ?? null;

  useEffect(() => {
    setSceneId((prev) => (prev && scenes.some((s) => s.id === prev) ? prev : scenes[0]?.id ?? null));
  }, [scenes]);

  useEffect(() => {
    if (!state.activeProjectId || scenes.length) return;
    if (ensuring.current === projectKey) return;
    ensuring.current = projectKey;
    void act("coordinationSceneSave", {
      projectId: state.activeProjectId,
      name: `${project?.name || "研发"} 小队`,
      template: "office",
      config: { cast: [], prefs: {} },
    }).then((created) => {
      if (created?.id) setSceneId(created.id);
    }).catch(() => { ensuring.current = null; });
  }, [act, project?.name, projectKey, scenes.length, state.activeProjectId]);

  const scenePrefs = scene ? prefsOf(scene as any, project?.name || "研发") : defaultPrefs(project?.name || "研发");
  const prefs = localPrefs ?? scenePrefs;
  const cast = localCast ?? ((scene?.config.cast ?? []) as OfficeCastMember[]);

  useEffect(() => {
    setLocalCast(null);
    setLocalPrefs(null);
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
  }, [scene?.id]);

  /* 四时段光照对照只覆盖办公室；作战室 3D / 航母没有对应光照页，切模板时回到实况 */
  useEffect(() => {
    if (prefs.template !== "office" && tab === "lights") setTab("live");
  }, [prefs.template, tab]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const persist = (patch: Partial<ScenePrefs>, nextCast?: OfficeCastMember[]) => {
    if (!scene) return;
    const next = { ...prefs, ...patch };
    const nextCastValue = nextCast ?? cast;
    setLocalPrefs(next);
    setLocalCast(nextCastValue);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void act("coordinationSceneSave", {
        id: scene.id,
        projectId: scene.projectId,
        name: next.name,
        template: next.template,
        config: {
          cast: nextCastValue,
          prefs: {
            reviewGate: next.reviewGate,
            escalate: next.escalate,
            inject: next.inject,
            showLinks: next.showLinks,
            showLabels: next.showLabels,
            light: next.light,
            motion: next.motion ?? DEFAULT_MOTION,
          },
        },
      });
    }, 300);
  };

  const openNewScene = (template: ScenePrefs["template"] = "office") => {
    setNewScene({ name: `${project?.name || "研发"} 小队`, template });
  };
  const createScene = () => {
    if (!newScene) return;
    void act("coordinationSceneSave", {
      projectId: state.activeProjectId,
      name: newScene.name.trim() || `${project?.name || "研发"} 小队`,
      template: newScene.template,
      config: { cast: [], prefs: {} },
    }).then((created) => {
      if (created?.id) setSceneId(created.id);
      setNewScene(null);
      setTab("live");
      notify(newScene.template === "office" ? "已创建办公室场景" : `已创建${templateLabel(newScene.template)}场景；该舞台仍在原型阶段`);
    });
  };

  /* 场景库卡片的增删改：全部走已有的 coordinationSceneSave / Remove，不改主进程 */
  const renameScene = (id: string, name: string) => {
    void act("coordinationSceneSave", { id, name }).then((saved) => {
      if (saved) notify(`已重命名为「${name}」`);
    });
  };

  const duplicateScene = (id: string) => {
    const source = scenes.find((s) => s.id === id);
    if (!source) return;
    const name = `${source.name} 副本`;
    void act("coordinationSceneSave", {
      projectId: source.projectId,
      name,
      template: source.template,
      config: source.config ?? { cast: [], prefs: {} },
    }).then((created) => {
      if (!created?.id) return;
      setSceneId(created.id);
      notify(`已复制为「${name}」`);
    });
  };

  const deleteScene = (id: string) => {
    const source = scenes.find((s) => s.id === id);
    if (!source || scenes.length <= 1) return;
    void act("coordinationSceneRemove", { id }).then((done) => {
      if (!done) return;
      setSceneId((prev) => (prev === id ? null : prev));
      notify(`已删除场景「${source.name}」`);
    });
  };

  const exportScene = (id: string) => {
    const source = scenes.find((s) => s.id === id);
    if (!source) return;
    if (!navigator.clipboard?.writeText) { notify("剪贴板不可用，无法导出场景"); return; }
    const payload = {
      kind: "coordination-scene",
      version: 1,
      name: source.name,
      template: templateOf(source.template),
      config: source.config ?? { cast: [], prefs: {} },
      exportedAt: new Date().toISOString(),
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      .then(() => notify(`「${source.name}」已复制为 JSON`))
      .catch(() => notify("复制失败：剪贴板不可用"));
  };

  const galleryModel = useMemo(() => buildOfficeModel(state, {
    projectId: state.activeProjectId,
    now,
    wide: window.innerWidth >= 1440,
    cast,
  }), [state, now, cast]);

  const subtitle = tab === "gallery"
    ? "多 Agent 协作的拟人化配置。办公室只是其中一种舞台。"
    : tab === "live"
      ? "舞台只从真实状态取位置和姿态。这里回放最近 15 分钟内记录到的走位、核对触发条件，并当场调参。"
      : tab === "lights"
        ? "同一时刻、同一批状态，只换光照；点任意一张切到实况并固定该时段。"
        : "执行配置只决定单个任务怎么跑；协作场景决定多 Agent 如何协作与呈现。";

  const staged = tab === "live" || tab === "lights";
  const clock = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const motion = motionOf(prefs);

  return (
    <div className={`page off-page ${staged ? "off-page-staged" : ""}`}>
      <PageHeader
        kicker={staged ? "SCENE / LIVE · MOTION" : "SCENE"}
        title={staged ? "动效工作台" : "场景"}
        subtitle={subtitle}
        actions={(
          <div className="off-page-actions">
            {tab === "gallery" ? <button className="btn primary" onClick={() => openNewScene()}>新建场景</button> : null}
            {staged && tab === "live" ? (
              <select className="off-motion-select" value={motion.tier} title="动效档位" aria-label="动效档位"
                onChange={(e) => persist({ motion: { ...motion, tier: e.target.value as typeof motion.tier } })}>
                <option value="calm">动效 · {MOTION_LABEL.calm}</option>
                <option value="full">动效 · {MOTION_LABEL.full}</option>
                <option value="off">动效 · {MOTION_LABEL.off}</option>
              </select>
            ) : null}
            {staged ? <button className="btn" onClick={() => { setTab("live"); onNewThread(); }}>派活</button> : null}
            {staged ? <button className="btn primary" onClick={() => { setTab("live"); setReplaySignal((v) => v + 1); }}>回放状态变化</button> : null}
          </div>
        )}
        tabs={(
          <div className="off-tabs">
            <button className={`off-tab ${tab === "gallery" ? "on" : ""}`} onClick={() => setTab("gallery")}>场景库</button>
            <button className={`off-tab ${tab === "live" ? "on" : ""}`} onClick={() => setTab("live")}>实况 <span className="off-live-dot" /></button>
            {prefs.template === "office" ? <button className={`off-tab ${tab === "lights" ? "on" : ""}`} onClick={() => setTab("lights")}>光照</button> : null}
            <button className={`off-tab ${tab === "execution" ? "on" : ""}`} onClick={() => setTab("execution")}>执行配置</button>
            <span className="off-tab-fill" />
            <span className="off-tab-clock" title="舞台挂钟">{clock}</span>
          </div>
        )}
      />

      {tab === "gallery" ? (
        <SceneGallery
          state={state}
          model={galleryModel}
          scenes={scenes}
          activeSceneId={scene?.id ?? null}
          onSelectScene={setSceneId}
          onEnter={() => setTab("live")}
          onNewScene={openNewScene}
          onRenameScene={renameScene}
          onDuplicateScene={duplicateScene}
          onDeleteScene={deleteScene}
          onExportScene={exportScene}
        />
      ) : staged && scene ? (
        <OfficeLive
          state={state}
          now={now}
          act={act}
          notify={notify}
          cast={cast}
          onCast={(next) => persist({}, next)}
          prefs={prefs}
          onPrefs={(patch) => persist(patch)}
          onOpenTask={onOpenTask}
          onOpenThread={onOpenThread}
          onOpenTerminal={onOpenTerminal}
          onOpenProjects={onOpenProjects}
          initialSelectedId={initialSelectedId}
          initialDetailOpen={initialDetailOpen}
          initialMode={initialMode}
          lightsOnly={tab === "lights"}
          onPickLight={(light) => { persist({ light }); setTab("live"); }}
          replaySignal={replaySignal}
        />
      ) : staged ? (
        <EmptyState
          mark="⌂"
          title="还没有协作场景"
          desc="新建一个办公室场景，或先从场景库选择模板。"
          action={<button className="btn primary" onClick={() => openNewScene("office")}>新建办公室场景</button>}
        />
      ) : (
        <ExecutionConfigTab
          state={state}
          act={act}
          notify={notify}
          onOpenScene={(id) => { setSceneId(id); setTab("live"); }}
        />
      )}

      {newScene ? (
        <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewScene(null); }}>
          <div className="modal off-scene-modal" role="dialog" aria-modal="true" aria-label="新建协作场景">
            <div className="modal-head"><div><h3>新建协作场景</h3><p>先选舞台模板，再配阵容与编排。创建后先进入实况。</p></div><button className="off-icon-btn" onClick={() => setNewScene(null)} aria-label="关闭">✕</button></div>
            <div className="off-modal-field"><span>场景名称</span><input value={newScene.name} onChange={(e) => setNewScene((s) => s ? { ...s, name: e.target.value } : s)} autoFocus /></div>
            <div className="off-modal-field"><span>舞台模板</span>
              <div className="off-modal-templates">
                {SCENE_TEMPLATES.map((t) => (
                  <button key={t.id} className={`off-modal-template ${newScene.template === t.id ? "on" : ""}`} onClick={() => setNewScene((s) => s ? { ...s, template: t.id } : s)}>
                    <b>{t.label}</b>
                    <span>{t.parts}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="off-modal-note">办公室 / 作战室 3D / 航母 3D 共用同一套 SceneModel；流水线模板已下线。</div>
            <div className="modal-foot"><button className="btn" onClick={() => setNewScene(null)}>取消</button><button className="btn primary" onClick={createScene}>创建场景</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
