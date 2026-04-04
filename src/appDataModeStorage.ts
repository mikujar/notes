import { isTauri } from "@tauri-apps/api/core";

const STORAGE_KEY = "mikujar.appDataMode";

export type AppDataMode = "local" | "remote";

export function getStoredAppDataMode(): AppDataMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "local" || v === "remote") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 当前模式：未写过存储时默认云端（与服务器同步）。
 * 浏览器环境不提供「本地」数据模式，若曾存过 local 则写回 remote，与 UI 一致。
 */
export function getAppDataMode(): AppDataMode {
  const stored = getStoredAppDataMode() ?? "remote";
  if (!isTauri() && stored === "local") {
    try {
      localStorage.setItem(STORAGE_KEY, "remote");
    } catch {
      /* quota */
    }
    return "remote";
  }
  return stored;
}

export function setAppDataMode(mode: AppDataMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* quota */
  }
}
