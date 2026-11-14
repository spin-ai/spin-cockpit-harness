import type { OfficeTone } from "./model";

/**
 * 舞台 / 检查器共用的机器人造型。
 * 颜色全部来自 workbench.css 的 .r-* 规则（--accent / actor-body / actor-visor），
 * 所以同一个组件放在舞台和抽屉里都不会跑色。
 */
export function RobotArt({ tone, className = "" }: { tone: OfficeTone; className?: string }) {
  const eye = tone === "wait"
    ? <text className="r-char" x="26" y="36" textAnchor="middle">?</text>
    : tone === "fail"
      ? <text className="r-char" x="26" y="36" textAnchor="middle">×</text>
      : tone === "run" || tone === "lead"
        ? <path className="r-happy" d="M21.4 32.2c1.4-2.1 2.9-2.1 4.3 0M29.1 32.2c1.4-2.1 2.9-2.1 4.3 0" />
        : <circle className="r-eye" cx="26" cy="32" r="2.8" />;
  return (
    <svg className={`robot ${className}`.trim()} viewBox="0 0 52 72" aria-hidden="true">
      <ellipse className="r-shadow" cx="26" cy="68" rx="14" ry="3" />
      <line className="r-antenna" x1="26" y1="15" x2="26" y2="7" />
      <circle className="r-tip" cx="26" cy="6" r="2.4" />
      <rect className="r-body" x="10" y="14" width="32" height="46" rx="16" />
      <ellipse className="r-gloss" cx="18" cy="25" rx="3.4" ry="7" transform="rotate(-18 18 25)" />
      <rect className="r-visor" x="15" y="23" width="22" height="16" rx="8" />
      {eye}
      <path className="r-scarf" d="M12 47h28v5c0 4-3 7-7 7h-3l-4 5-4-5h-3c-4 0-7-3-7-7z" />
      <rect className="r-arm l" x="5" y="37" width="7" height="14" rx="3.5" />
      <rect className="r-arm r" x="40" y="37" width="7" height="14" rx="3.5" />
      <circle className="r-badge" cx="35" cy="54" r="2" />
      {tone === "review" ? <rect className="r-paper" x="37" y="49" width="12" height="15" rx="1.5" /> : null}
    </svg>
  );
}
