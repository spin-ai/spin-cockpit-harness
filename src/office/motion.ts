import type { OfficeActor, OfficePose, OfficeTone, OfficeZone } from "./model";

export const ZONE_LABEL: Record<OfficeZone, string> = {
  lead: "经理室",
  desk: "工位区",
  approval: "审批台",
  review: "验收架",
  tea: "茶歇区",
  meeting: "会议室",
  standby: "待命位",
};

export const TONE_LABEL: Record<OfficeTone, string> = {
  run: "运行中",
  wait: "待确认",
  fail: "失败",
  review: "待验收",
  lead: "协调中",
  neutral: "空闲",
};

const POSE_LABEL: Record<OfficePose, string> = {
  lead: "主控呼吸",
  working: "呼吸 + 打字",
  waiting: "摇摆",
  reviewing: "呼吸 + 接收",
  failed: "倾斜静止",
  idle: "静止",
};

export const poseLabel = (pose: OfficePose) => POSE_LABEL[pose] || pose;

/** 舞台上看到的动作：和 workbench.css 的 pose 动画一一对应 */
export function motionOf(actor: OfficeActor): string {
  switch (actor.pose) {
    case "working": return "2.6s 呼吸 + 0.52s 打字（原地）";
    case "waiting": return "3.2s 摇摆（原地）";
    case "reviewing": return "3.6s 呼吸 + 接收（原地）";
    case "failed": return "倾斜 -7° 静止（原地，不走位）";
    case "lead": return "4.2s 呼吸 + 天线脉冲 2.8s";
    default: return "静止，无额外动效";
  }
}

/** 触发条件：只陈述 State 里真实存在的字段，不编造事件名 */
export function triggerOf(actor: OfficeActor): string {
  if (actor.approval) return "approval.pending";
  if (actor.run?.status === "waiting_input") return "run.waiting_input";
  if (actor.task?.status === "waiting_input") return "todo.waiting_input";
  if (actor.tone === "review" || actor.task?.status === "in_review") return "todo.in_review";
  if (actor.tone === "fail") return actor.run?.status === "interrupted" ? "run.interrupted" : "run.failed";
  if (actor.run?.status === "queued") return "run.queued";
  if (actor.run?.status === "waiting_children") return "run.waiting_children";
  if (actor.task?.missionState === "plan_review") return "mission.plan_review";
  if (actor.run?.status === "running") return actor.role === "lead" ? "mission.running" : "run.started";
  if (actor.run?.status === "completed") return "run.completed";
  if (actor.task?.status === "todo") return "todo.assigned";
  return "—";
}

export interface A11yCheck {
  ok: boolean;
  title: string;
  text: string;
}

/**
 * 关闭动效后的等价检查。
 * 判据：位置（在哪个区域）+ 姓名牌状态 + 气泡，三样能不能替代走位和姿态。
 * 不新增状态，只检查现有呈现。
 */
export function a11yChecks(actor: OfficeActor): A11yCheck[] {
  const zone = ZONE_LABEL[actor.zone];
  const seated = actor.zone === "desk" || actor.zone === "lead";
  const rows: A11yCheck[] = [];

  if (actor.tone === "wait") {
    rows.push({
      ok: true,
      title: "待确认不靠动效表达",
      text: `审批台是固定落点；姓名牌「${actor.statusLabel}」和气泡 ? 是静态替代，关掉动效也知道要人处理。`,
    });
  } else if (actor.tone === "fail") {
    rows.push({
      ok: true,
      title: "失败不靠动效表达",
      text: `倾斜 -7° 只是动效；气泡「! 运行失败」和姓名牌「${actor.statusLabel}」是静态替代，关掉动效仍然读得懂。`,
    });
  } else if (actor.tone === "review") {
    rows.push({
      ok: true,
      title: "待验收有文字落点",
      text: `走到验收架的同时姓名牌写「${actor.statusLabel}」，验收架计数也会变，不是单靠动效。`,
    });
  } else if (!seated) {
    const generic = actor.statusLabel === "空闲" || actor.statusLabel === "待命" || actor.statusLabel === "排队";
    rows.push(generic ? {
      ok: false,
      title: `「${actor.statusLabel}」没有说明去了哪`,
      text: `关闭动效后角色直接出现在${zone}，但姓名牌只写「${actor.statusLabel}」。建议补「${zone} · ${actor.statusLabel}」，或让${zone}标签显示人数。`,
    } : {
      ok: true,
      title: "位置和文字一起变",
      text: `走到${zone}的同时，姓名牌写「${actor.statusLabel}」，区域标牌也在；不是单靠动效表达。`,
    });
  } else {
    rows.push({
      ok: true,
      title: "坐在工位上就是静态位置",
      text: "这个状态变化不需要走位；关掉动效后，人仍然在自己的工位，姓名牌写着当前状态。",
    });
  }

  if (actor.role === "lead") {
    rows.push({
      ok: true,
      title: "两个房间都有门",
      text: "计划评审时走到会议室，回来再更新白板；门开在朝走道的墙上，动效关掉也能看出换了房间。",
    });
  }
  return rows;
}
