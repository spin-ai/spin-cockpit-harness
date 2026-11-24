/**
 * 需求模型（第一片：IR → SR → US）。
 *
 * 这里只放纯函数：层级顺序、父子校验、key 生成、状态闸门、缺口判断。
 * 主进程 actions / 渲染层 / 测试共用同一套规则，避免 UI 和主进程各写一份。
 *
 * RR 还没进这一期：root = IR；以后加 RR 时只要把 REQUIREMENT_LEVELS 前面补 "rr"，
 * 父子关系和 key 规则不变。
 */

export const REQUIREMENT_LEVELS = ["ir", "sr", "us"];
export const REQUIREMENT_LEVEL_LABEL = { ir: "IR", sr: "SR", us: "US" };
export const REQUIREMENT_LEVEL_NAME = {
  ir: "初始需求",
  sr: "系统需求",
  us: "用户故事",
};

/** 第一片只开放前 6 个；in_progress / verifying 等任务链落地后再开。 */
export const REQUIREMENT_STATUSES = [
  "draft", "reviewing", "approved", "done", "rejected", "obsolete",
  "in_progress", "verifying",
];
export const REQUIREMENT_STATUS_LABEL = {
  draft: "草稿", reviewing: "待评审", approved: "已批准", done: "已完成",
  rejected: "已拒绝", obsolete: "已废弃", in_progress: "实现中", verifying: "待验收",
};
export const M0_STATUSES = ["draft", "reviewing", "approved", "done", "rejected", "obsolete"];

export function normalizeLevel(level) {
  const value = String(level || "").toLowerCase();
  return REQUIREMENT_LEVELS.includes(value) ? value : null;
}

export function levelIndex(level) {
  return REQUIREMENT_LEVELS.indexOf(normalizeLevel(level));
}

/** IR 是 root；SR 的父层是 IR；US 的父层是 SR。 */
export function parentLevelOf(level) {
  const index = levelIndex(level);
  return index > 0 ? REQUIREMENT_LEVELS[index - 1] : null;
}

export function nextLevelOf(level) {
  const index = levelIndex(level);
  return index >= 0 ? REQUIREMENT_LEVELS[index + 1] || null : null;
}

/** 父节点必须存在、同项目、且正好是上一级；root 层不允许父节点。 */
export function validateParent({ level, parent, projectId }) {
  const normalized = normalizeLevel(level);
  if (!normalized) return { ok: false, error: "未知需求层级" };
  const expected = parentLevelOf(normalized);
  if (!expected) {
    if (parent) return { ok: false, error: `${REQUIREMENT_LEVEL_LABEL[normalized]} 是根层，不能挂父需求` };
    return { ok: true };
  }
  if (!parent) return { ok: false, error: `${REQUIREMENT_LEVEL_LABEL[normalized]} 必须挂在 ${REQUIREMENT_LEVEL_LABEL[expected]} 下` };
  if (projectId && parent.projectId !== projectId) return { ok: false, error: "父需求不属于同一个项目" };
  if (parent.level !== expected) {
    return { ok: false, error: `${REQUIREMENT_LEVEL_LABEL[normalized]} 的父层必须是 ${REQUIREMENT_LEVEL_LABEL[expected]}` };
  }
  return { ok: true };
}

/** 项目别名 → key 前缀：大写字母数字；没有 alias 时退回项目 id。 */
export function keyPrefix(project) {
  const raw = String(project?.alias || project?.id || "REQ").toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean || "REQ";
}

/** 同项目 + 同层的最大序号 + 1；删除后不复用已有 key。 */
export function nextRequirementKey(requirements, projectId, level, prefix) {
  const label = REQUIREMENT_LEVEL_LABEL[normalizeLevel(level) || level] || String(level || "REQ").toUpperCase();
  const pattern = new RegExp(`-${label}-(\\d+)$`);
  let max = 0;
  for (const req of requirements || []) {
    if (req.projectId !== projectId || req.level !== level) continue;
    const match = pattern.exec(String(req.key || ""));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `${prefix || "REQ"}-${label}-${String(max + 1).padStart(2, "0")}`;
}

export function normalizeAcceptance(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { text: item.trim(), done: false };
      return { text: String(item?.text || "").trim(), done: !!item?.done };
    })
    .filter((item) => item.text)
    .slice(0, 50);
}

export function acceptanceComplete(req) {
  const list = normalizeAcceptance(req?.acceptance);
  return list.length > 0 && list.every((item) => item.done);
}

/** 每层批准前必须有什么。返回字段 key，给 UI 聚焦用。 */
export function requiredFieldsFor(level) {
  if (level === "ir") return ["scope", "outOfScope"];
  if (level === "sr") return ["impact", "acceptance"];
  if (level === "us") return ["role", "value", "acceptance"];
  return [];
}

export function missingFields(req) {
  const missing = [];
  for (const field of requiredFieldsFor(req?.level)) {
    if (field === "acceptance") {
      if (!normalizeAcceptance(req?.acceptance).length) missing.push("acceptance");
    } else if (!String(req?.[field] || "").trim()) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * 状态闸门。
 * - approved：该层必填字段
 * - done：SR/US 的验收全勾；IR 的子需求全部 approved/done
 * - in_progress / verifying：任务链还没落，先拦住
 * - rejected / obsolete / reviewing / draft：不拦
 */
export function statusGate(req, next, { children = [] } = {}) {
  const normalized = String(next || "");
  if (!REQUIREMENT_STATUSES.includes(normalized)) return { ok: false, missing: ["status"], error: "未知状态" };
  if (normalized === "approved") {
    const missing = missingFields(req);
    if (missing.length) return { ok: false, missing, error: "批准前还有必填项" };
  }
  if (normalized === "done") {
    if (req.level === "us" || req.level === "sr") {
      if (!acceptanceComplete(req)) return { ok: false, missing: ["acceptance"], error: "验收判据还没全部勾选" };
    }
    if (req.level === "ir") {
      if (!children.length) return { ok: false, missing: ["children"], error: "IR 还没有子需求" };
      const open = children.filter((child) => !["approved", "done"].includes(child.status));
      if (open.length) return { ok: false, missing: ["children"], error: `还有 ${open.length} 条子需求没批准` };
    }
  }
  if (normalized === "in_progress" || normalized === "verifying") {
    return { ok: false, missing: ["tasks"], error: "任务链还没接入，先不要用执行态" };
  }
  return { ok: true, missing: [] };
}

/** 列表行尾的缺口：缺验收 / 缺下游；没有缺口返回 null。 */
export function gapFor(req, { children = [] } = {}) {
  if (!req) return null;
  if ((req.level === "sr" || req.level === "us") && !normalizeAcceptance(req.acceptance).length) return { type: "acceptance", label: "缺验收" };
  if (req.level !== "us" && !children.length) return { type: "downstream", label: "缺下游" };
  return null;
}
