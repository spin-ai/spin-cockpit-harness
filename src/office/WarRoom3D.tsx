import { useEffect, useRef } from "react";
import type { OfficeModel } from "./model";
import type { SceneMotion } from "./SceneConfigPanel";
import { mountWarRoom3D, type WarRoom3DApi, type WarRoomView } from "./warroom-scene";

/**
 * 发射指挥大厅 3D 舞台的 React 外壳。
 * three.js 实例与逐帧投影都在命令式模块里，React 只负责把真实 OfficeModel 推进去，
 * 避免 60fps 重渲染整棵组件树。
 */
export function WarRoom3D({ model, now, selectedId, onSelect, motion, reduced, launchSignal = 0, view = "overview", onViewChange }: {
  model: OfficeModel;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  motion: SceneMotion;
  reduced: boolean;
  /** 舞台头「演一遍发射」的信号 */
  launchSignal?: number;
  /** 机位（存在 prefs.view，场景配置和舞台头共用） */
  view?: WarRoomView;
  onViewChange?: (view: WarRoomView) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<WarRoom3DApi | null>(null);
  const live = useRef({ model, now, selectedId, motion, reduced, onSelect });
  live.current = { model, now, selectedId, motion, reduced, onSelect };
  const signalRef = useRef(launchSignal);
  const viewRef = useRef(view);
  const viewCb = useRef(onViewChange);
  viewCb.current = onViewChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    apiRef.current = mountWarRoom3D({
      host,
      getModel: () => live.current.model,
      getSelected: () => live.current.selectedId,
      getNow: () => live.current.now,
      getMotion: () => ({ tier: live.current.motion.tier, reduced: live.current.reduced, walk: live.current.motion.walk }),
      getTheme: () => (document.documentElement.dataset.mode === "dark" ? "dark" : "light"),
      onSelect: (id) => live.current.onSelect(id),
      onViewChange: (v) => viewCb.current?.(v),
    });
    apiRef.current.setView(viewRef.current);
    return () => {
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, []);

  /* 只在真实状态 / 主屏内容 / 分钟变化时重画纹理，不跟着 now 每秒刷 */
  const signature = [
    model.board.title,
    model.board.key,
    model.board.progress,
    model.board.rows.map((r) => `${r.key}:${r.state}`).join(","),
    model.actors.map((a) => `${a.id}:${a.zone}:${a.tone}:${a.statusLabel}:${a.seat ?? "-"}`).join("|"),
    Math.floor(now / 60_000),
  ].join("~");
  useEffect(() => {
    apiRef.current?.update();
  }, [signature]);

  useEffect(() => {
    apiRef.current?.setSelected(selectedId);
  }, [selectedId]);

  /* 机位跟随 prefs.view（舞台头下拉 / 配置面板 / 双击复位都走这一条） */
  useEffect(() => {
    if (view === viewRef.current) return;
    viewRef.current = view;
    apiRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    if (launchSignal === signalRef.current) return;
    signalRef.current = launchSignal;
    apiRef.current?.launch();
  }, [launchSignal]);

  useEffect(() => {
    apiRef.current?.setMotion(motion.tier, reduced, motion.walk);
  }, [motion.tier, motion.walk, reduced]);

  useEffect(() => {
    const apply = () => apiRef.current?.setTheme(document.documentElement.dataset.mode === "dark" ? "dark" : "light");
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <div className="war3d-frame">
      <div className="war3d" ref={hostRef} />
      <span className="war3d-badge">LAUNCH CONTROL · THREE.JS</span>
      <span className="war3d-hint">发射台 = 主屏实时画面 · GO/NO-GO = 各系统状态 · 拖动环绕 · 双击复位</span>
    </div>
  );
}
