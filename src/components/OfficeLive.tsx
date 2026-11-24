import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CoordinationStageView, State } from "../types";
import { EmptyState } from "./EmptyState";
import { buildOfficeModel, type OfficeCastMember, type OfficeModel, type OfficeTone, type OfficeZone } from "../office/model";
import { OfficeStage, STAGE_SIZE } from "../office/OfficeStage";
import { OfficeInspector } from "../office/OfficeInspector";
import { RobotArt } from "../office/RobotArt";
import { XIcon } from "./Icons";
import { hhmmss } from "../ui";
import { RowMenu } from "./RowMenu";
import { EyeIcon, EyeOffIcon, WrenchIcon } from "./Icons";
import { SceneConfigPanel, DEFAULT_MOTION, motionOf, STAGE_VIEW_LABEL, CARRIER_VIEWS, WARROOM_VIEWS, type ScenePrefs, type SceneMotion } from "../office/SceneConfigPanel";
import { a11yChecks, ZONE_LABEL, triggerOf } from "../office/motion";
import { templateLabel } from "../office/templates";
import "../office/office.css";

type Act = (type: string, payload?: unknown) => Promise<any>;

/* three.js 场景按需加载：办公室用户不下载 3D chunk */
const WarRoom3D = lazy(() => import("../office/WarRoom3D").then((m) => ({ default: m.WarRoom3D })));
const Carrier3D = lazy(() => import("../office/Carrier3D").then((m) => ({ default: m.Carrier3D })));

const HISTORY_MS = 15 * 60_000;
const LIGHTS = [
  { phase: "dawn", name: "清晨", en: "DAWN", range: "05:00 – 08:00", clock: "05:40" },
  { phase: "day", name: "白天", en: "DAYLIGHT", range: "08:00 – 17:00", clock: "12:30" },
  { phase: "dusk", name: "黄昏", en: "DUSK", range: "17:00 – 20:00", clock: "18:30" },
  { phase: "night", name: "夜晚", en: "NIGHT", range: "20:00 – 05:00", clock: "21:30" },
] as const;

interface Snapshot { at: number; model: OfficeModel }
interface ChangeEvent {
  id: string;
  at: number;
  actorId: string;
  name: string;
  tone: OfficeTone;
  fromZone: OfficeZone;
  toZone: OfficeZone;
  fromStatus: string;
  toStatus: string;
  walked: boolean;
  trigger: string;
}

const TONE_PRIORITY: Record<OfficeTone, number> = { fail: 0, wait: 1, review: 2, run: 3, lead: 4, neutral: 5 };

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function LightCard({ page, model, now, onPick }: {
  page: typeof LIGHTS[number];
  model: OfficeModel;
  now: number;
  onPick: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [k, setK] = useState(0.45);
  /* 对照卡用该时段的代表时刻做挂钟，舞台上的状态仍是当前同一批 */
  const pinnedNow = useMemo(() => {
    const d = new Date(now);
    const [h, m] = page.clock.split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }, [now, page.clock]);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const fit = () => setK(Math.max(0.2, el.clientWidth / STAGE_SIZE.w));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="light-card" role="button" tabIndex={0} onClick={onPick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}>
      <div className="light-head"><b>{page.name}</b><span>{page.en}</span><span>· {page.range}</span><code className="mono">light={page.phase}</code></div>
      <div className="light-frame" ref={frameRef}>
        <div className="light-wrap" style={{ "--lk": String(k) } as CSSProperties}>
          <OfficeStage model={model} now={pinnedNow} selectedId={null} light={page.phase} interactive={false} />
        </div>
      </div>
    </div>
  );
}

export function OfficeLive({ state, now, act, notify, cast, onCast, prefs, onPrefs, onOpenTask, onOpenThread, onOpenTerminal, onOpenProjects, projectId = null, initialSelectedId = null, initialDetailOpen = false, initialMode = "live", lightsOnly = false, onPickLight, replaySignal = 0 }: {
  state: State;
  now: number;
  act: Act;
  notify: (message: string) => void;
  cast: OfficeCastMember[];
  onCast: (next: OfficeCastMember[]) => void;
  prefs: ScenePrefs;
  onPrefs: (next: Partial<ScenePrefs>) => void;
  onOpenTask: (todoId: string) => void;
  onOpenThread: (threadId: string) => void;
  onOpenTerminal: (cwd: string, terminalId?: string) => void;
  onOpenProjects: () => void;
  /** 舞台上按哪个项目取运行态：场景的建议项目；没标注就跟随当前项目 */
  projectId?: string | null;
  initialSelectedId?: string | null;
  initialDetailOpen?: boolean;
  initialMode?: "live" | "config";
  lightsOnly?: boolean;
  onPickLight?: (phase: ScenePrefs["light"]) => void;
  replaySignal?: number;
}) {
  const [wide, setWide] = useState(() => window.innerWidth >= 1440);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [detailOpen, setDetailOpen] = useState(initialDetailOpen || Boolean(initialSelectedId));
  const [configOpen, setConfigOpen] = useState(initialMode === "config");
  const [showPaths, setShowPaths] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [launchSignal, setLaunchSignal] = useState(0);
  const [landSignal, setLandSignal] = useState(0);
  /* 机位存在 prefs.view 里：航母和发射指挥共用一份字段，各自的机位表在 SceneConfigPanel。
     换模板后旧机位可能不属于这台舞台，落回总览，避免下拉框空选。 */
  const stageView: CoordinationStageView =
    prefs.view && (prefs.template === "carrier" ? CARRIER_VIEWS : WARROOM_VIEWS).includes(prefs.view) ? prefs.view : "overview";
  const [walkOnly, setWalkOnly] = useState(false);
  const [walking, setWalking] = useState<Set<string>>(new Set());
  const [walkFrom, setWalkFrom] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);
  const [replayEnd, setReplayEnd] = useState<number | null>(null);
  const [cursor, setCursor] = useState(now);
  const [playing, setPlaying] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const motion = motionOf(prefs);
  const setMotion = (patch: Partial<SceneMotion>) => onPrefs({ motion: { ...motion, ...patch } });

  const areaRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const signatureRef = useRef("");
  const previousModel = useRef<OfficeModel | null>(null);
  const walkTimers = useRef<Record<string, number>>({});
  const playTimer = useRef<number | null>(null);
  const signalRef = useRef(replaySignal);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1440);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      /* zoom 重新排版：舞台在自己的格子里等比放大到最大，并且始终居中 */
      setStageScale(Math.max(0.4, Math.min(w / STAGE_SIZE.w, h / STAGE_SIZE.h, 2.6)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => buildOfficeModel(state, {
    projectId: projectId ?? state.activeProjectId,
    now,
    wide,
    cast,
  }), [state, now, wide, cast, projectId]);

  /* ── 状态变化的只读记录：只记真实 zone / tone / pose 变化，不编造事件 ── */
  useEffect(() => {
    const signature = model.actors
      .map((a) => `${a.id}:${a.zone}:${a.seat ?? "-"}:${a.tone}:${a.pose}:${a.statusLabel}`)
      .join("|");
    if (!signatureRef.current) {
      signatureRef.current = signature;
      previousModel.current = model;
      setSnapshots([{ at: now, model }]);
      return;
    }
    if (signature === signatureRef.current) return;
    const prev = previousModel.current;
    const at = now;
    const nextEvents: ChangeEvent[] = [];
    if (prev) {
      for (const actor of model.actors) {
        const before = prev.actors.find((a) => a.id === actor.id);
        if (!before) continue;
        if (before.zone === actor.zone && before.tone === actor.tone && before.pose === actor.pose && before.statusLabel === actor.statusLabel) continue;
        nextEvents.push({
          id: `${actor.id}-${at}`,
          at,
          actorId: actor.id,
          name: actor.displayName,
          tone: actor.tone,
          fromZone: before.zone,
          toZone: actor.zone,
          fromStatus: before.statusLabel,
          toStatus: actor.statusLabel,
          walked: before.zone !== actor.zone,
          trigger: triggerOf(actor),
        });
      }
    }
    signatureRef.current = signature;
    previousModel.current = model;
    setSnapshots((list) => [...list.filter((s) => s.at >= at - HISTORY_MS), { at, model }].slice(-160));
    if (!nextEvents.length) return;
    setChanges((list) => [...list.filter((e) => e.at >= at - HISTORY_MS), ...nextEvents].slice(-120));
    if (motion.tier === "off" || reduced) return;
    const walks = nextEvents.filter((e) => e.walked);
    if (!walks.length) return;
    setWalking((prevSet) => {
      const next = new Set(prevSet);
      walks.forEach((e) => next.add(e.actorId));
      return next;
    });
    setWalkFrom((prevMap) => {
      const next = { ...prevMap };
      walks.forEach((e) => { next[e.actorId] = ZONE_LABEL[e.fromZone] || "工位"; });
      return next;
    });
    for (const e of walks) {
      if (walkTimers.current[e.actorId]) window.clearTimeout(walkTimers.current[e.actorId]);
      walkTimers.current[e.actorId] = window.setTimeout(() => {
        delete walkTimers.current[e.actorId];
        setWalking((prevSet) => {
          const next = new Set(prevSet);
          next.delete(e.actorId);
          return next;
        });
      }, motion.walk + 240);
    }
  }, [model, now, motion.tier, motion.walk, reduced]);

  useEffect(() => () => {
    Object.values(walkTimers.current).forEach((t) => window.clearTimeout(t));
    if (playTimer.current) window.clearInterval(playTimer.current);
  }, []);

  const stopPlay = useCallback(() => {
    setPlaying(false);
    if (playTimer.current) {
      window.clearInterval(playTimer.current);
      playTimer.current = null;
    }
  }, []);

  const startPlay = useCallback((freezeArg?: number | null) => {
    const freeze = freezeArg === undefined ? (replayEnd ?? now) : (freezeArg ?? now);
    const list = changes.filter((e) => e.at >= freeze - HISTORY_MS && (!walkOnly || e.walked));
    if (!list.length) {
      notify("还没有可回放的状态变化 —— 页面打开后发生的真实状态变化会记录在这里");
      return;
    }
    if (playTimer.current) window.clearInterval(playTimer.current);
    setReplayEnd(freeze);
    setSelectedEventId(null);
    setCursor(list[0].at);
    setPlaying(true);
    let i = 0;
    playTimer.current = window.setInterval(() => {
      i += 1;
      if (i >= list.length) {
        if (playTimer.current) window.clearInterval(playTimer.current);
        playTimer.current = null;
        setPlaying(false);
        setCursor(freeze);
        return;
      }
      setCursor(list[i].at);
    }, 1500);
  }, [changes, now, replayEnd, walkOnly, notify]);

  useEffect(() => {
    if (replaySignal === signalRef.current) return;
    signalRef.current = replaySignal;
    stopPlay();
    setReplayEnd(null);
    setSelectedEventId(null);
    startPlay(null);
  }, [replaySignal, stopPlay, startPlay]);

  useEffect(() => {
    if (!selectedId) return;
    if (!model.actors.some((a) => a.id === selectedId)) {
      setSelectedId(null);
      setDetailOpen(false);
    }
  }, [model, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (selectedId || detailOpen) {
        event.preventDefault();
        setSelectedId(null);
        setDetailOpen(false);
      } else if (configOpen) {
        event.preventDefault();
        setConfigOpen(false);
      } else if (playing) {
        event.preventDefault();
        stopPlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [configOpen, detailOpen, playing, selectedId, stopPlay]);

  const displayModel = useMemo(() => {
    if (replayEnd === null) return model;
    const snapshot = [...snapshots].reverse().find((s) => s.at <= cursor);
    return snapshot?.model ?? snapshots[0]?.model ?? model;
  }, [cursor, model, replayEnd, snapshots]);

  const displayNow = replayEnd === null ? now : cursor;
  const selected = displayModel.actors.find((a) => a.id === selectedId) ?? null;

  const windowEnd = replayEnd ?? now;
  const windowStart = windowEnd - HISTORY_MS;
  const cursorAt = replayEnd === null ? now : cursor;
  const sortedChanges = useMemo(() => [...changes].sort((a, b) => a.at - b.at), [changes]);
  const timelineChanges = useMemo(() => sortedChanges.filter((e) => e.at <= windowEnd), [sortedChanges, windowEnd]);
  /* 同一秒内的多个角色变化合成一条，避免时间轴上叠成一团；跨秒的记录进两条泳道 */
  const changeGroups = useMemo(() => {
    const buckets: { at: number; events: ChangeEvent[]; tone: OfficeTone; walked: boolean }[] = [];
    for (const e of timelineChanges) {
      if (walkOnly && !e.walked) continue;
      const last = buckets[buckets.length - 1];
      if (last && last.at === e.at) {
        last.events.push(e);
        if (TONE_PRIORITY[e.tone] < TONE_PRIORITY[last.tone]) last.tone = e.tone;
        last.walked = last.walked || e.walked;
      } else {
        buckets.push({ at: e.at, events: [e], tone: e.tone, walked: e.walked });
      }
    }
    const lastAt = [-Infinity, -Infinity];
    return buckets.map((group) => {
      const lane = group.at - lastAt[0] >= group.at - lastAt[1] ? 0 : 1;
      lastAt[lane] = group.at;
      return { ...group, lane };
    });
  }, [timelineChanges, walkOnly]);

  const pct = (t: number) => Math.min(100, Math.max(0, ((t - windowStart) / HISTORY_MS) * 100));
  const playhead = pct(cursorAt);
  const walkCount = timelineChanges.filter((e) => e.walked).length;

  const detailEvent = selectedEventId
    ? timelineChanges.find((e) => e.id === selectedEventId) ?? null
    : [...timelineChanges].reverse().find((e) => e.at <= cursorAt && (!walkOnly || e.walked)) ?? null;

  const lastWalkOf = (actorId: string) => [...timelineChanges].reverse().find((e) => e.actorId === actorId && e.walked && e.at <= cursorAt) ?? null;

  const select = (id: string) => {
    const closing = selectedId === id && detailOpen;
    setSelectedId(closing ? null : id);
    setDetailOpen(!closing);
    setConfigOpen(false);
  };

  const jumpEvent = (event: ChangeEvent) => {
    stopPlay();
    const freeze = replayEnd ?? now;
    setReplayEnd(freeze);
    setCursor(event.at);
    setSelectedEventId(event.id);
  };

  const jumpNow = () => {
    stopPlay();
    setReplayEnd(null);
    setCursor(now);
    setSelectedEventId(null);
  };

  const scrub = (value: number) => {
    stopPlay();
    const freeze = replayEnd ?? now;
    setReplayEnd(freeze);
    setSelectedEventId(null);
    setCursor(freeze - HISTORY_MS + (value / 900) * HISTORY_MS);
  };

  if (!model.actors.length) {
    return (
      <EmptyState
        mark="⌂"
        title="还没有可上场的 Agent"
        desc="先在项目里添加项目与 Agent，办公室会自动按真实运行状态生成工位、审批台、验收架和茶歇区。"
        action={<button className="btn primary" onClick={onOpenProjects}>去项目页</button>}
      />
    );
  }

  const stats = {
    agents: displayModel.stats.agents,
    bots: displayModel.stats.bots,
    unbound: displayModel.stats.unbound,
    running: displayModel.actors.filter((a) => a.tone === "run" || a.tone === "lead").length,
    waiting: displayModel.actors.filter((a) => a.tone === "wait").length,
    review: displayModel.actors.filter((a) => a.tone === "review").length,
    failed: displayModel.actors.filter((a) => a.tone === "fail").length,
    idle: displayModel.actors.filter((a) => a.tone === "neutral").length,
  };
  const templateName = templateLabel(prefs.template);
  /** Mission 在跑时，舞台上能一键回会话，不用再去左边找任务 */
  const missionTask = displayModel.coordination.missionKey ? displayModel.lead?.task ?? null : null;
  const isWarRoom = prefs.template === "warroom";
  const isCarrier = prefs.template === "carrier";
  const is3D = isWarRoom || isCarrier;
  const lastWalk = selected ? lastWalkOf(selected.id) : null;
  const riskCount = displayModel.actors.filter((a) => a11yChecks(a).some((row) => !row.ok)).length;

  return (
    <div
      className="offp"
      data-motion={motion.tier}
      data-type={motion.typing ? "on" : "off"}
      data-reduced={reduced ? "1" : "0"}
      style={{ "--walk-dur": `${motion.walk}ms`, "--amp": String(motion.amp / 100) } as CSSProperties}
    >
      <div className={`motion-live ${lightsOnly ? "lights-mode" : ""}`}>
        {!lightsOnly ? (
          <>
            <div className="stage-head">
              <div className="section-title">{templateName} · 实况</div>
              <span className="sub">{prefs.name} · @{displayModel.projectAlias}</span>
              <div className="scene-stats">
                <span title={`${stats.agents} 个执行体 · ${stats.bots} 个机器人`}><b>{stats.bots || stats.agents}</b>人</span>
                <span className="run"><b>{stats.running}</b>运行</span>
                <span className="wait"><b>{stats.waiting}</b>待确认</span>
                <span className="review"><b>{stats.review}</b>待验收</span>
                <span className={stats.failed ? "fail" : ""}><b>{stats.failed}</b>失败</span>
                {stats.idle ? <span><b>{stats.idle}</b>空闲</span> : null}
              </div>
              {missionTask ? (
                <button className="link tiny" onClick={() => onOpenTask(missionTask.id)} title="回到这个 Mission 的计划与子任务">回到 Mission</button>
              ) : null}
              <div className="stage-tools">
                {!is3D ? (
                  <select className="mini-select" value={prefs.light} onChange={(e) => onPrefs({ light: e.target.value as ScenePrefs["light"] })} title="舞台光照（默认跟随本地时间）" aria-label="舞台光照">
                    <option value="auto">光照 · 跟随时间</option>
                    <option value="dawn">光照 · 清晨</option>
                    <option value="day">光照 · 白天</option>
                    <option value="dusk">光照 · 黄昏</option>
                    <option value="night">光照 · 夜晚</option>
                  </select>
                ) : (
                  <select className="mini-select" value={stageView} onChange={(e) => onPrefs({ view: e.target.value as CoordinationStageView })} title="舞台机位：快捷切换（也可在场景配置里改，会存进这个场景）" aria-label="舞台机位（快捷切换）">
                    {(isCarrier ? CARRIER_VIEWS : WARROOM_VIEWS).map((v) => <option key={v} value={v}>视角 · {STAGE_VIEW_LABEL[v]}</option>)}
                  </select>
                )}
                <RowMenu title="舞台工具" align="right">
                  {isCarrier ? <button onClick={() => setLaunchSignal((v) => v + 1)}>演一遍弹射</button> : null}
                  {isWarRoom ? <button onClick={() => setLaunchSignal((v) => v + 1)}>演一遍发射</button> : null}
                  {isCarrier ? <button onClick={() => setLandSignal((v) => v + 1)}>演一遍着舰</button> : null}
                  {!is3D ? <button className={showPaths ? "on" : ""} aria-pressed={showPaths} onClick={() => setShowPaths((v) => !v)}><span className="row-menu-title">走位路径</span><span className="row-menu-hint">{showPaths ? "开" : "关"}</span></button> : null}
                  <button className={reduced ? "on" : ""} aria-pressed={reduced} onClick={() => setReduced((v) => !v)}><span className="row-menu-title">模拟 reduced-motion</span><span className="row-menu-hint">{reduced ? "开" : "关"}</span></button>
                </RowMenu>
                <button className={`btn tiny ghost ${configOpen ? "on" : ""}`} aria-pressed={configOpen} title="场景配置" aria-label="场景配置" onClick={() => { setConfigOpen((v) => !v); setSelectedId(null); setDetailOpen(false); }}><WrenchIcon size={14} /></button>
                <button className={`btn tiny ${detailOpen ? "on" : ""}`} aria-pressed={detailOpen} title={detailOpen ? "收起详情" : "详情"} aria-label={detailOpen ? "收起详情" : "详情"} onClick={() => setDetailOpen((v) => !v)}>{detailOpen ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}</button>
              </div>
            </div>

            <div className={`stage-area ${detailOpen || configOpen ? "" : "insp-closed"}`}>
              <div className="stage-fit" ref={areaRef}>
                {is3D ? (
                  <Suspense fallback={<div className="war3d-loading"><span>正在装载 3D 舞台…</span></div>}>
                    {isCarrier ? (
                      <Carrier3D
                        model={displayModel}
                        now={displayNow}
                        selectedId={selectedId}
                        onSelect={select}
                        motion={motion}
                        reduced={reduced}
                        launchSignal={launchSignal}
                        landSignal={landSignal}
                        view={stageView}
                        onViewChange={(v) => onPrefs({ view: v })}
                      />
                    ) : (
                      <WarRoom3D
                        model={displayModel}
                        now={displayNow}
                        selectedId={selectedId}
                        onSelect={select}
                        motion={motion}
                        reduced={reduced}
                        launchSignal={launchSignal}
                        view={stageView}
                        onViewChange={(v) => onPrefs({ view: v })}
                      />
                    )}
                  </Suspense>
                ) : (
                  <div style={{ zoom: stageScale }}>
                    <OfficeStage
                      model={displayModel}
                      now={displayNow}
                      selectedId={selectedId}
                      onSelect={select}
                      onOpenTask={onOpenTask}
                      light={prefs.light}
                      showPaths={showPaths}
                      showLabels={prefs.showLabels}
                      walking={walking}
                      walkFrom={walkFrom}
                      walkMs={motion.walk}
                    />
                  </div>
                )}
              </div>
              {configOpen ? (
                <SceneConfigPanel
                  state={state}
                  model={model}
                  cast={cast}
                  onCast={onCast}
                  prefs={prefs}
                  onPrefs={onPrefs}
                  onClose={() => setConfigOpen(false)}
                  notify={notify}
                />
              ) : detailOpen && selected ? (
                <OfficeInspector
                  actor={selected}
                  model={displayModel}
                  act={act}
                  notify={notify}
                  onOpenTask={onOpenTask}
                  onOpenThread={onOpenThread}
                  onOpenTerminal={onOpenTerminal}
                  onClose={() => { setSelectedId(null); setDetailOpen(false); }}
                  motion={motion}
                  onMotion={setMotion}
                  onResetMotion={() => onPrefs({ motion: { ...DEFAULT_MOTION } })}
                  lastWalk={lastWalk ? { at: lastWalk.at, from: ZONE_LABEL[lastWalk.fromZone], to: ZONE_LABEL[lastWalk.toZone] } : null}
                  onLocate={(at) => { stopPlay(); setReplayEnd(replayEnd ?? now); setCursor(at); setSelectedEventId(sortedChanges.find((e) => e.at === at && e.walked && selected && e.actorId === selected.id)?.id ?? null); }}
                />
              ) : detailOpen ? (
                <aside className="inspector" aria-label="动效检查器">
                  <div className="insp-head">
                    <div className="insp-avatar" style={{ "--accent": "var(--slate)" } as CSSProperties}><RobotArt tone="neutral" /></div>
                    <div className="insp-title"><b>没有选中角色</b><span>舞台上的位置和动作只读真实状态</span></div>
                    <button type="button" className="icon-btn" title="收起详情" onClick={() => setDetailOpen(false)} aria-label="收起详情"><XIcon size={14} /></button>
                  </div>
                  <div className="insp-status">
                    <span className="pill idle">{hhmmss(cursorAt)}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{replayEnd === null ? "实况" : "回放中"}</span>
                    <span className="meta">最近 15 分钟</span>
                  </div>
                  <div className="insp-body">
                    <div className="block">
                      <div className="block-label">这一页在回答什么</div>
                      <p className="empty-line">点角色看它的「状态 → 区域 / 姿态 / 动效 / 依据」，拖动时间轴看它什么时候走、走了多久。走位只在状态真的换了区域时发生；失败、重试、计划批注都停在原地。</p>
                      <div className="stat-grid" style={{ marginTop: 8 }}>
                        <div className="stat"><b>{timelineChanges.length}</b><span>次状态变化</span></div>
                        <div className="stat"><b>{walkCount}</b><span>次走位</span></div>
                        <div className="stat"><b>{timelineChanges.length - walkCount}</b><span>次原地变化</span></div>
                        <div className={`stat ${riskCount ? "warn" : ""}`}><b>{riskCount}</b><span>处动效依赖风险</span></div>
                      </div>
                      <div className="overview-list">
                        {displayModel.actors.map((x) => (
                          <button key={x.id} type="button" onClick={() => select(x.id)}>
                            <i className={`dot ${x.tone === "lead" ? "lead" : x.tone}`} />{x.displayName}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="block">
                      <div className="block-label">关闭动效后</div>
                      <p className="empty-line">选中角色后，这里会逐条检查：位置、姓名牌、气泡能不能替代走位和姿态。目前有 <b>{riskCount}</b> 个角色的状态只靠动效表达。</p>
                    </div>
                  </div>
                  <div className="insp-foot"><span className="faint" style={{ fontSize: 10 }}>状态来自 runs / approvals / todos · 只读</span></div>
                </aside>
              ) : null}
            </div>

            <div className="legend">
              {is3D ? (
                <>
                  <span><i className="dot run" />运行</span>
                  <span><i className="dot wait" />待确认</span>
                  <span><i className="dot review" />待验收</span>
                  <span><i className="dot fail" />失败</span>
                </>
              ) : (
                <>
                  <span><i className="line walk" />走位只发生在真的换区域时</span>
                  <span><i className="line stay" />失败 / 重试 / 计划批注停在原地</span>
                </>
              )}
            </div>

            <div className={`timeline ${timelineChanges.length ? "" : "empty"}`} aria-label="状态变化时间轴">
              <div className="tl-head">
                <div className="tl-title">
                  <b>时间轴</b>
                  <span>{replayEnd === null ? "最近 15 分钟" : `回放 ${hhmmss(cursorAt)}`} · {timelineChanges.length} 次状态变化 · {walkCount} 次走位</span>
                </div>
                {timelineChanges.length ? (
                  <div className="tl-actions">
                    <button className="btn tiny" aria-pressed={playing} onClick={() => (playing ? stopPlay() : startPlay())}>{playing ? "⏸ 暂停" : "▶ 回放"}</button>
                    <button className="btn tiny ghost" onClick={jumpNow}>回到现在</button>
                    <label className="chk"><input type="checkbox" checked={walkOnly} onChange={(e) => setWalkOnly(e.target.checked)} /> 只看走位</label>
                  </div>
                ) : null}
              </div>
              {timelineChanges.length ? (
              <>
              <div className="tl-track">
                <div className="tl-lane l0" />
                <div className="tl-lane l1" />
                {changeGroups.map((group) => {
                  const first = group.events.find((e) => e.walked) ?? group.events[0];
                  const label = group.events.length > 1
                    ? `${group.events[0].name} 等 ${group.events.length} 人`
                    : group.events[0].walked ? `${group.events[0].name}→${ZONE_LABEL[group.events[0].toZone]}` : `${group.events[0].name}·原地`;
                  return (
                    <button
                      key={`${group.at}-${group.events[0].id}`}
                      type="button"
                      className={`ev ${group.at > cursorAt ? "future" : ""} ${group.events.some((e) => e.id === selectedEventId) ? "on" : ""}`}
                      style={{ left: `${pct(group.at)}%`, top: group.lane === 0 ? 4 : 28 }}
                      title={group.events.map((e) => `${hhmmss(e.at)} · ${e.name} ${ZONE_LABEL[e.fromZone]} → ${ZONE_LABEL[e.toZone]} · ${e.trigger}${e.walked ? " · 走位" : " · 原地"}`).join("\n")}
                      onClick={() => jumpEvent(first)}
                    >
                      <i className={`dot ${group.tone === "lead" ? "lead" : group.tone}`} />
                      <b>{hhmm(group.at)}</b>
                      <span>{label}</span>
                    </button>
                  );
                })}
                <div className="tl-ticks">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                    const t = windowStart + (HISTORY_MS / 6) * i;
                    return <span key={i} style={{ left: `${(i / 6) * 100}%` }}>{hhmm(t)}</span>;
                  })}
                </div>
                <div className="tl-playhead" style={{ "--p": `${playhead}%` } as CSSProperties}><i /></div>
                <input
                  id="scrub"
                  type="range"
                  min={0}
                  max={900}
                  step={1}
                  value={Math.round((pct(cursorAt) / 100) * 900)}
                  aria-label="拖动查看最近 15 分钟"
                  onChange={(e) => scrub(Number(e.target.value))}
                />
              </div>
              <div className="tl-detail">
                {detailEvent ? (
                  <>
                    <span className="t">{hhmmss(detailEvent.at)}</span>
                    <b>{detailEvent.name}</b>
                    <span className="r">{ZONE_LABEL[detailEvent.fromZone]} → {ZONE_LABEL[detailEvent.toZone]} · {detailEvent.toStatus}</span>
                    <span className="sep" />
                    <span className="tag">{detailEvent.trigger}</span>
                    <span className="sep" />
                    <span className={`tag ${detailEvent.walked ? "walk" : "stay"}`}>{detailEvent.walked ? `走位 ${(motion.walk / 1000).toFixed(1)}s` : "原地 · 不走位"}</span>
                  </>
                ) : (
                  <span className="r">把时间轴拖回变化发生的那一刻，或点上面的记录。</span>
                )}
              </div>
              </>
              ) : null}
            </div>
          </>
        ) : prefs.template !== "office" ? (
          <div className="lights-view">
            <div className="lights-note"><b>光照对照</b><span>发射指挥 3D 的光照跟随应用主题；四时段对照页目前只覆盖办公室舞台。</span></div>
          </div>
        ) : (
          <div className="lights-view">
            <div className="lights-note"><b>光照对照</b><span>同一时刻、同一批状态，只换光照；点任意一张切到实况并固定该时段。</span></div>
            {LIGHTS.map((page) => (
              <LightCard
                key={page.phase}
                page={page}
                model={model}
                now={now}
                onPick={() => onPickLight?.(page.phase)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
