import { useEffect, useRef } from "react";
import type { OfficeModel } from "./model";
import type { SceneMotion } from "./SceneConfigPanel";
import { mountCarrier3D, type Carrier3DApi, type CarrierView } from "./carrier-scene";

/**
 * 航母 3D 舞台的 React 外壳。
 * 场景在命令式模块里逐帧运行，React 只把真实 OfficeModel / 主题 / 动效推进去。
 */
export function Carrier3D({ model, now, selectedId, onSelect, motion, reduced, launchSignal = 0, landSignal = 0, view = "overview", onViewChange }: {
  model: OfficeModel;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  motion: SceneMotion;
  reduced: boolean;
  launchSignal?: number;
  landSignal?: number;
  /** 机位预设（舞台头的「视角」下拉） */
  view?: CarrierView;
  /** 双击复位时回写，让下拉框跟着回到总览 */
  onViewChange?: (view: CarrierView) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Carrier3DApi | null>(null);
  const live = useRef({ model, now, selectedId, motion, reduced, onSelect, onViewChange });
  live.current = { model, now, selectedId, motion, reduced, onSelect, onViewChange };
  const signalRef = useRef(launchSignal);
  const landRef = useRef(landSignal);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    apiRef.current = mountCarrier3D({
      host,
      getModel: () => live.current.model,
      getSelected: () => live.current.selectedId,
      getNow: () => live.current.now,
      getMotion: () => ({ tier: live.current.motion.tier, reduced: live.current.reduced, walk: live.current.motion.walk }),
      getTheme: () => (document.documentElement.dataset.mode === "dark" ? "dark" : "light"),
      onSelect: (id) => live.current.onSelect(id),
      onViewChange: (v) => live.current.onViewChange?.(v),
    });
    return () => {
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    apiRef.current?.setMotion(motion.tier, reduced, motion.walk);
  }, [motion.tier, motion.walk, reduced]);

  useEffect(() => {
    if (launchSignal === signalRef.current) return;
    signalRef.current = launchSignal;
    apiRef.current?.launch();
  }, [launchSignal]);

  useEffect(() => {
    apiRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    if (landSignal === landRef.current) return;
    landRef.current = landSignal;
    apiRef.current?.land();
  }, [landSignal]);

  useEffect(() => {
    const apply = () => apiRef.current?.setTheme(document.documentElement.dataset.mode === "dark" ? "dark" : "light");
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <div className="carrier3d-frame">
      <div className="carrier3d" ref={hostRef} />
      <span className="carrier3d-hint">弹射位 = 并发 run · 着舰道 = review / approval 串行 · 中止 = 复飞 · 拖动环绕 · 双击回总览</span>
    </div>
  );
}
