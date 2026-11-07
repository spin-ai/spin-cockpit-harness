import { useEffect, useRef, useState } from "react";

export type WikiDemoStep = {
  key: string;
  label: string;
  title: string;
  detail: string;
  tone?: "idle" | "queued" | "running" | "steer" | "review" | "done" | "failed";
};

/** Wiki 里的可播放流程：自动在进入视口后开始，可暂停 / 单步 / 重播。 */
export function WikiFlowDemo({ eyebrow, title, steps }: {
  eyebrow?: string;
  title: string;
  steps: WikiDemoStep[];
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const active = steps[index] ?? steps[0];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setPlaying(true);
        observer.disconnect();
      }
    }, { threshold: 0.35 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || steps.length < 2) return;
    const timer = window.setTimeout(() => {
      if (index >= steps.length - 1) setPlaying(false);
      else setIndex(index + 1);
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [playing, index, steps.length]);

  const go = (next: number) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(steps.length - 1, next)));
  };

  const replay = () => {
    setIndex(0);
    setPlaying(true);
  };

  return (
    <figure className="wiki-demo" ref={ref}>
      <div className="wiki-demo-head">
        <div className="wiki-demo-title">
          {eyebrow && <span className="wiki-demo-eyebrow">{eyebrow}</span>}
          <b>{title}</b>
        </div>
        <button className="wiki-demo-play" type="button" onClick={() => setPlaying((value) => !value)}>
          {playing ? "暂停" : "播放"}
        </button>
      </div>

      <div className="wiki-demo-track" role="tablist" aria-label={title}>
        {steps.map((step, i) => (
          <button
            key={step.key}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`wiki-demo-step ${i === index ? "on" : ""} ${i < index ? "done" : ""}`}
            onClick={() => go(i)}
          >
            <i>{i + 1}</i>
            <span>{step.label}</span>
          </button>
        ))}
      </div>

      <div className={`wiki-demo-body tone-${active.tone || "idle"}`}>
        <div className="wiki-demo-status">
          <span className="wiki-demo-dot" />
          {active.title}
        </div>
        <p aria-live="polite">{active.detail}</p>
        <div className="wiki-demo-progress"><i style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      </div>

      <div className="wiki-demo-foot">
        <button type="button" disabled={index === 0} onClick={() => go(index - 1)}>← 上一步</button>
        <span>{index + 1} / {steps.length}</span>
        <button type="button" disabled={index === steps.length - 1} onClick={() => go(index + 1)}>下一步 →</button>
        <button type="button" className="wiki-demo-replay" onClick={replay}>重播</button>
      </div>
    </figure>
  );
}
