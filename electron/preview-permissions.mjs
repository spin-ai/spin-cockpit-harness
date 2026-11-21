// 预览页的站点权限策略（纯函数，便于单测）。
// 设计：docs/arch/ARCH-ui-context.md「预览会话与站点权限」
// 只放进「用户可以自己决定」的能力；需要设备/窗口选择器的能力一律拒绝（没有选择器 UI，给了就是假允许）。

/** 不需要询问：不涉及隐私数据，给不给都一样 */
export const ALWAYS_ALLOWED = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write", "keyboardLock", "speaker-selection"]);

/** 需要用户按站点授权（存进设置，跨重启保留） */
export const ASKABLE = new Set([
  "media", "geolocation", "notifications", "clipboard-read", "midi", "midiSysex",
  "idle-detection", "window-management", "storage-access", "top-level-storage-access", "openExternal",
]);

/** 需要 Electron 的选择器回调（USB / 串口 / 蓝牙 / 屏幕共享 / 文件系统）：我们不做，明确拒绝而不是静默挂起 */
export const UNSUPPORTED = new Set(["hid", "serial", "usb", "bluetooth", "display-capture", "fileSystem", "unknown"]);

export const PERMISSION_LABELS = {
  media: "摄像头 / 麦克风",
  geolocation: "位置",
  notifications: "通知",
  "clipboard-read": "读取剪贴板",
  "clipboard-sanitized-write": "写入剪贴板",
  midi: "MIDI 设备",
  midiSysex: "MIDI 系统独占",
  "idle-detection": "空闲检测",
  "window-management": "多窗口",
  "storage-access": "跨站存储",
  "top-level-storage-access": "跨站存储",
  openExternal: "打开外部应用",
  fullscreen: "全屏",
  pointerLock: "鼠标锁定",
  keyboardLock: "键盘锁定",
  "speaker-selection": "音频输出选择",
  "display-capture": "屏幕共享",
  hid: "HID 设备",
  serial: "串口设备",
  usb: "USB 设备",
  bluetooth: "蓝牙设备",
  fileSystem: "文件系统访问",
};

export function describePermission(permission) {
  return PERMISSION_LABELS[permission] || String(permission || "未知能力");
}

/** 归一化 origin：file:// 用 "file://"；非法地址返回 "" */
export function originOf(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol === "file:") return "file://";
    return u.origin && u.origin !== "null" ? u.origin : "";
  } catch { return ""; }
}

function parse(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(String(raw));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const [origin, list] of Object.entries(value)) {
      if (!origin || !Array.isArray(list)) continue;
      const allowed = list.filter((p) => typeof p === "string" && ASKABLE.has(p));
      if (allowed.length) out[origin] = [...new Set(allowed)];
    }
    return out;
  } catch { return {}; }
}

/** 设置里的 JSON 字符串 → 可序列化结构（渲染层 / 设置页共用） */
export function listSites(raw) {
  return Object.entries(parse(raw))
    .map(([origin, permissions]) => ({
      origin,
      permissions: permissions.map((key) => ({ key, label: describePermission(key) })),
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

export function allows(raw, origin, permission) {
  if (ALWAYS_ALLOWED.has(permission)) return true;
  if (UNSUPPORTED.has(permission) || !ASKABLE.has(permission)) return false;
  const site = originOf(origin);
  if (!site) return false;
  return Boolean(parse(raw)[site]?.includes(permission));
}

export function grant(raw, origin, permission) {
  const site = originOf(origin);
  if (!site || !ASKABLE.has(permission)) return String(raw || "");
  const data = parse(raw);
  data[site] = [...new Set([...(data[site] || []), permission])];
  return JSON.stringify(data);
}

export function revoke(raw, origin, permission) {
  const site = originOf(origin);
  const data = parse(raw);
  if (site && permission) {
    data[site] = (data[site] || []).filter((p) => p !== permission);
    if (!data[site].length) delete data[site];
  } else if (site) {
    delete data[site];
  }
  return JSON.stringify(data);
}
