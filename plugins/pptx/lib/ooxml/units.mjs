/**
 * 画布与单位。
 *
 * 设计稿固定 1920×1080（16:9）。PPTX 16:9 的 sldSz 是 12192000×6858000 EMU，
 * 正好 1920×6350 / 1080×6350 —— 1 SVG px = 6350 EMU，换算不留误差，不用凑英寸。
 */
export const CANVAS = { width: 1920, height: 1080 };
export const EMU_PER_PX = 6350;
export const SLIDE_EMU = { cx: CANVAS.width * EMU_PER_PX, cy: CANVAS.height * EMU_PER_PX };
/** 10 号字 = 12700 EMU；线宽也用它做单位 */
export const EMU_PER_PT = 12700;

export const px = (value) => Math.round(Number(value || 0) * EMU_PER_PX);
/** SVG font-size 是 px，DrawingML 是 1/100 pt */
export const fontPt = (pxSize) => Math.round(Number(pxSize || 0) * 0.75 * 100);
export const lineEmu = (widthPx) => Math.max(0, Math.round(Number(widthPx || 0) * 0.75 * EMU_PER_PT));
/** DrawingML 的旋转是 1/60000 度 */
export const rotUnits = (deg) => Math.round(Number(deg || 0) * 60000);
