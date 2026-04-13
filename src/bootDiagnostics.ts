import { Capacitor } from "@capacitor/core";

/**
 * 开发时在控制台打出一条固定日志，便于确认「控制台是否连着当前页」；
 * 并挂载全局错误监听，避免部分异常在 Safari 里不明显。
 */
export function installBootDiagnostics(): void {
  if (typeof window === "undefined") return;

  const report = (label: string, payload: unknown) => {
    console.error(`[未来罐] ${label}`, payload);
  };

  window.addEventListener(
    "error",
    (e) => {
      report("window.error", e.error ?? e.message);
    },
    true
  );

  window.addEventListener("unhandledrejection", (e) => {
    report("unhandledrejection", e.reason);
  });

  if (import.meta.env.DEV) {
    console.info("[未来罐] 开发环境已加载", {
      href: window.location.href,
      capacitorNative: Capacitor.isNativePlatform(),
      capacitorPlatform: Capacitor.isNativePlatform()
        ? Capacitor.getPlatform()
        : "web",
    });
  }
}
