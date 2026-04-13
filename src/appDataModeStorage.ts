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
 * - 浏览器：不提供「本地」数据模式，若曾存过 local 则写回 remote。
 * - Tauri 桌面：与当前网页版产品一致，仅云端；曾选 local 的迁移为 remote，便于一进应用即登录墙。
 */
export function getAppDataMode(): AppDataMode {
  const stored = getStoredAppDataMode() ?? "remote";
  if (stored === "local") {
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
    localStorage.setItem(STORAGE_KEY, mode === "local" ? "remote" : mode);
  } catch {
    /* quota */
  }
}
