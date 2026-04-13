import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardStyle } from "@capacitor/keyboard";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App";
import { AppDataModeProvider } from "./appDataMode";
import { AppUiLangProvider } from "./appUiLang";
import { AuthProvider } from "./auth/AuthContext";
import { LegalPagesProvider } from "./legalPages";
import { installBootDiagnostics } from "./bootDiagnostics";
import { RootErrorBoundary } from "./RootErrorBoundary";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./index.css";

installBootDiagnostics();

/**
 * Tauri 桌面版：⌥（Option）+ 右键 或 Shift + 右键 切换开发者工具，避免占用笔记区普通右键菜单。
 * 与内置快捷键（macOS：⌘⌥I）调用同一后端命令。
 */
function installTauriContextMenuDevtools() {
  if (!isTauri()) return;
  document.addEventListener(
    "contextmenu",
    (e: MouseEvent) => {
      if (!e.altKey && !e.shiftKey) return;
      e.preventDefault();
      void invoke("plugin:webview|internal_toggle_devtools");
    },
    true
  );
}
installTauriContextMenuDevtools();

/**
 * Vercel Analytics / Speed Insights 只应在「部署在 Vercel 上的网页」里加载。
 * localhost、vite preview、Capacitor 包内没有 /_vercel/... 脚本，控制台会报 script.js 失败。
 */
function shouldMountVercelWebInsights(): boolean {
  if (import.meta.env.DEV) return false;
  if (Capacitor.isNativePlatform()) return false;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".local")) {
    return false;
  }
  return true;
}

/**
 * 判断是否为「Mac Silicon 上运行的 iOS App」。
 * 真机 iOS 有触控屏：maxTouchPoints ≥ 1；Mac 运行 iOS App 无触控屏：maxTouchPoints = 0。
 * 结合 Capacitor 平台判断，避免误判普通 Mac 浏览器。
 */
function isIosAppOnMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios" &&
    navigator.maxTouchPoints === 0
  );
}

/** Capacitor iOS：辅助栏 + 浅色键盘（与页面一致，减轻黑底观感） */
function configureCapacitorIosKeyboard() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    return;
  }
  // Mac 上运行的 iOS App 没有软键盘，跳过键盘配置避免副作用
  if (isIosAppOnMac()) return;
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  void Keyboard.setStyle({ style: KeyboardStyle.Light }).catch(() => {});
}
configureCapacitorIosKeyboard();

/**
 * iOS WKWebView：拦截双指捏合缩放（viewport 在部分场景仍可能漏网）。
 * 用 Capacitor 判定 iOS，避免「在 Mac 上运行的 iOS App」里 UA / navigator.platform
 *（如 Mac arm、maxTouchPoints=0）与真机不一致导致漏挂或误挂手势监听。
 */
function disableIosPinchZoom() {
  if (typeof document === "undefined") return;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return;
  const opts: AddEventListenerOptions = { passive: false };
  const block = (e: Event) => e.preventDefault();
  document.addEventListener("gesturestart", block, opts);
  document.addEventListener("gesturechange", block, opts);
  document.addEventListener("gestureend", block, opts);
}
disableIosPinchZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AppDataModeProvider>
        <AppUiLangProvider>
          <LegalPagesProvider>
            <AuthProvider>
              <App />
              {shouldMountVercelWebInsights() ? (
                <>
                  <Analytics />
                  <SpeedInsights />
                </>
              ) : null}
            </AuthProvider>
          </LegalPagesProvider>
        </AppUiLangProvider>
      </AppDataModeProvider>
    </RootErrorBoundary>
  </StrictMode>
);
