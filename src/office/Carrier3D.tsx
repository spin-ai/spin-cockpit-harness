import { useEffect, useRef } from "react";
import type { OfficeModel } from "./model";
import type { SceneMotion } from "./SceneConfigPanel";
import { mountCarrier3D, type Carrier3DApi } from "./carrier-scene";

/**
 * 航母 3D 舞台的 React 外壳。
 * 场景在命令式模块里逐帧运行，React 只把真实 OfficeModel / 主题 / 动效推进去。
 */
export function Carrier3D({ model, now, selectedId, onSelect, motion, reduced, launchSignal = 0 }: {
  model: OfficeModel;
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  motion: SceneMotion;
  reduced: boolean;
  launchSignal?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<Carrier3DApi | null>(null);
  const live = useRef({ model, now, selectedId, motion, reduced, onSelect });
  live.current = { model, now, selectedId, motion, reduced, onSelect };
  const signalRef = useRef(launchSignal);

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
    model.actors.map((a) => `${a.agent.id}:${a.zone}:${a.tone}:${a.statusLabel}:${a.seat ?? "-"}`).join("|"),
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
    const apply = () => apiRef.current?.setTheme(document.documentElement.dataset.mode === "dark" ? "dark" : "light");
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <div className="carrier3d-frame">
      <div className="carrier3d" ref={hostRef} />
      <span className="carrier3d-badge">CARRIER · THREE.JS</span>
      <span className="carrier3d-hint">弹射位 = 并发 run · 着舰道 = review / approval 串行 · 拖动看视角</span>
    </div>
  );
}
