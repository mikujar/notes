import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardStyle } from "@capacitor/keyboard";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import { AppDataModeProvider } from "./appDataMode";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";

/** Capacitor iOS：辅助栏 + 浅色键盘（与页面一致，减轻黑底观感） */
function configureCapacitorIosKeyboard() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    return;
  }
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  void Keyboard.setStyle({ style: KeyboardStyle.Light }).catch(() => {});
}
configureCapacitorIosKeyboard();

/** iOS WKWebView：拦截双指捏合缩放（viewport 在部分场景仍可能漏网） */
function disableIosPinchZoom() {
  if (typeof document === "undefined") return;
  const ua = navigator.userAgent || "";
  const isIos =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return;
  const opts: AddEventListenerOptions = { passive: false };
  const block = (e: Event) => e.preventDefault();
  document.addEventListener("gesturestart", block, opts);
  document.addEventListener("gesturechange", block, opts);
  document.addEventListener("gestureend", block, opts);
}
disableIosPinchZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppDataModeProvider>
      <AuthProvider>
        <App />
        <Analytics />
        <SpeedInsights />
      </AuthProvider>
    </AppDataModeProvider>
  </StrictMode>
);
