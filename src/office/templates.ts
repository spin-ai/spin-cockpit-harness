import type { CoordinationTemplate } from "../types";

/**
 * 舞台模板（Stage Pack）的唯一文案来源。
 * 流水线（factory）已下线，改为航母 · 电磁弹射；旧场景里的 factory 按 carrier 呈现。
 */
export const SCENE_TEMPLATES: {
  id: CoordinationTemplate;
  label: string;
  parts: string;
  desc: string;
}[] = [
  {
    id: "office",
    label: "办公室",
    parts: "工位 · 白板 · 审批 · 茶歇 · 会议",
    desc: "工位、审批、验收、机房、茶歇与会议角，全部按真实运行状态呈现。",
  },
  {
    id: "warroom",
    label: "发射指挥",
    parts: "发射大屏 · GO/NO-GO · 工位实时画面",
    desc: "航天发射指挥大厅：大屏是发射工位的实时画面与 GO/NO-GO，席位照真实运行状态就位。",
  },
  {
    id: "carrier",
    label: "航母 · 电磁弹射",
    parts: "甲板 · 弹射位 · 拦阻索",
    desc: "多个 worker 并行弹射，review / approval 排进单条着舰道；中止就是复飞。",
  },
];

const FALLBACK = SCENE_TEMPLATES[0];

export function templateOf(template: CoordinationTemplate | string | null | undefined): CoordinationTemplate {
  if (template === "factory") return "carrier";
  return SCENE_TEMPLATES.some((t) => t.id === template) ? (template as CoordinationTemplate) : "office";
}

export function templateLabel(template: CoordinationTemplate | string | null | undefined) {
  return SCENE_TEMPLATES.find((t) => t.id === templateOf(template))?.label ?? FALLBACK.label;
}

export function templateDesc(template: CoordinationTemplate | string | null | undefined) {
  return SCENE_TEMPLATES.find((t) => t.id === templateOf(template))?.desc ?? FALLBACK.desc;
}
