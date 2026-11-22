import { useEffect, useState, type MouseEvent } from "react";
import { MinusIcon, PlusIcon } from "./Icons";

export type ZhBlock = { id: string; type: string; cls?: string; bbox: [number, number, number, number]; text: string; conf: number | null };
export type ZhRelation = { id?: string; from: string; to: string; type: string; confidence?: number | null };

const ZOOMS = [1, 1.5, 2, 3, 4];

/**
 * 图片 + 区块/关系叠加，带缩放与双向 hover。
 *
 * 坐标：`bbox` 已是渲染用的 [x1,y1,x2,y2]（插件里统一转过，线上是 [x,y,w,h]）。
 * 颜色全走 token；框和线都垫了白色描边，因为图片底色不可知（白截图 / 深色截图都要看得见）。
 * 缩放用「相对适应宽度的倍数」实现：frame 宽度 = 倍数 × 容器宽，平移交给原生滚动，不做 transform 计算。
 */
export function ZhulongOverlay({
  src,
  size,
  blocks,
  relations,
  showBlocks = true,
  showRelations = true,
  highlightIds = [],
  hoverId = "",
  dimIds,
  onPick,
  onHover,
  onNaturalSize,
}: {
  src: string;
  size: [number, number];
  blocks: ZhBlock[];
  relations: ZhRelation[];
  showBlocks?: boolean;
  showRelations?: boolean;
  highlightIds?: string[];
  hoverId?: string;
  /** 筛选时把不在结果里的框压暗（不隐藏，保留上下文） */
  dimIds?: Set<string>;
  onPick?: (id: string) => void;
  onHover?: (id: string) => void;
  onNaturalSize?: (size: [number, number]) => void;
}) {
  const box = new Map(blocks.map((b) => [b.id, b.bbox] as const));
  const center = (id: string): [number, number] | null => {
    const bbox = box.get(id);
    if (!bbox) return null;
    return [bbox[0] + (bbox[2] - bbox[0]) / 2, bbox[1] + (bbox[3] - bbox[1]) / 2];
  };
  const [w, h] = size[0] > 0 && size[1] > 0 ? size : [1000, 1000];
  const [zoom, setZoom] = useState(1);
  const selected = new Set(highlightIds);
  const pick = (event: MouseEvent, id: string) => { event.stopPropagation(); onPick?.(id); };

  // 换图 / 重新解析后回到适应宽度，避免停在上一次的放大位置
  useEffect(() => { setZoom(1); }, [src]);

  return (
    <div className="zh-zoom">
      <div className="zh-zoom-head">
        <span className="zh-zoom-meta mono">{w}×{h}</span>
        <div className="zh-zoom-bar">
          <button className="zh-zoom-btn" disabled={zoom === 1} onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])} title="缩小" aria-label="缩小"><MinusIcon size={14} /></button>
          <button className={`zh-zoom-btn wide ${zoom === 1 ? "on" : ""}`} onClick={() => setZoom(1)} title="适应宽度">适应</button>
          <button className="zh-zoom-btn" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])} title="放大" aria-label="放大"><PlusIcon size={14} /></button>
          <span className="zh-zoom-label">{Math.round(zoom * 100)}%</span>
        </div>
      </div>
      <div className="zh-zoom-scroll">
        <div className="zh-frame" style={{ width: `${zoom * 100}%` }}>
          <img
            src={src}
            alt="待解析图片"
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth && (!size[0] || !size[1])) onNaturalSize?.([img.naturalWidth, img.naturalHeight]);
            }}
          />
          <svg className="zh-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden={!blocks.length}>
            <defs>
              <marker id="zh-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L6 3 L0 6 z" className="zh-arrow-head" />
              </marker>
            </defs>
            {showRelations && relations.map((rel, index) => {
              const a = center(rel.from);
              const b = center(rel.to);
              if (!a || !b) return null;
              const on = selected.has(rel.from) || selected.has(rel.to);
              return (
                <g key={rel.id || `${rel.from}-${rel.to}-${index}`} className={on ? "on" : ""}>
                  <line className="zh-rel-halo" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
                  <line className="zh-rel" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} markerEnd="url(#zh-arrow)" />
                </g>
              );
            })}
            {showBlocks && blocks.map((block) => {
              const [x1, y1, x2, y2] = block.bbox;
              const wd = Math.max(1, x2 - x1);
              const ht = Math.max(1, y2 - y1);
              const cls = [selected.has(block.id) ? "on" : "", hoverId === block.id ? "hover" : "", dimIds?.has(block.id) ? "dim" : ""].filter(Boolean).join(" ");
              return (
                <g
                  key={block.id}
                  className={cls}
                  onClick={(event) => pick(event, block.id)}
                  onMouseEnter={() => onHover?.(block.id)}
                  onMouseLeave={() => onHover?.("")}
                >
                  <rect className="zh-box-halo" x={x1} y={y1} width={wd} height={ht} />
                  <rect className={`zh-box zh-type-${block.type}`} x={x1} y={y1} width={wd} height={ht}>
                    <title>{`${block.type}${block.text ? ` · ${block.text.slice(0, 40)}` : ""}`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
