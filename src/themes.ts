import type { ThemeMode } from "./types";

/** 主题元数据：Settings 选择器、命令面板和 App 解析共用同一份。 */
export interface ThemeMeta {
  id: ThemeMode;
  label: string;
  desc: string;
  dark: boolean;
  /** [背景, 表面, 强调色] */
  swatches: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  { id: "system",   label: "跟随系统", desc: "随系统深浅色", dark: false, swatches: ["#f6f7f9", "#151517", "#5b7cf5"] },
  { id: "light",    label: "浅色",     desc: "冷灰 · 蓝",    dark: false, swatches: ["#f6f7f9", "#ffffff", "#5b7cf5"] },
  { id: "paper",    label: "纸感",     desc: "暖米 · 琥珀",  dark: false, swatches: ["#f8f5ee", "#fffdf8", "#b07a3c"] },
  { id: "dark",     label: "深色",     desc: "中性 · 蓝",    dark: true,  swatches: ["#0b0b0d", "#141417", "#60a5fa"] },
  { id: "midnight", label: "午夜蓝",   desc: "深蓝 · 青",    dark: true,  swatches: ["#070b14", "#101827", "#5aa9ff"] },
  { id: "forest",   label: "森林",     desc: "墨绿 · 绿",    dark: true,  swatches: ["#0a0f0c", "#121a15", "#4fbf87"] },
  { id: "graphite", label: "石墨",     desc: "中性 · 灰",    dark: true,  swatches: ["#0b0b0c", "#151517", "#d4d4d8"] },
];

export const DARK_THEME_IDS: ThemeMode[] = ["dark", "midnight", "forest", "graphite"];

export function isDarkTheme(id: ThemeMode): boolean {
  return DARK_THEME_IDS.includes(id);
}

/** system 解析成具体主题；显式主题原样返回。 */
export function resolveTheme(id: ThemeMode, systemDark: boolean): ThemeMode {
  if (id === "system") return systemDark ? "dark" : "light";
  return id;
}
