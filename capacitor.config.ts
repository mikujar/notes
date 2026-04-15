import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mikujar.note",
  appName: "未来罐",
  webDir: "dist",
  /** WKWebView / 滚动层底色：与速记白底、浅色键盘接缝一致，避免露灰或黑边 */
  backgroundColor: "#ffffff",
  /**
   * 真工程目录为 ios/App/mikujar.xcodeproj；保留同名符号链接 ios/App/App.xcodeproj → mikujar.xcodeproj，
   * 因 @capacitor/cli 固定查找 App.xcodeproj。Xcode Cloud 请选用 mikujar.xcodeproj（或跟随符号链接）。
   */
  ios: {
    /** 与 Xcode target / scheme「未来罐」一致 */
    scheme: "未来罐",
    backgroundColor: "#ffffff",
  },
  android: {
    backgroundColor: "#ffffff",
  },
  /**
   * iOS WKWebView 本地页默认 Origin 为 `capacitor://localhost`，跨域 fetch 易被 CORS/网关误伤。
   * 设为 `https` 后变为 `https://localhost`，与常见后端白名单（https://localhost）一致，亦利于「Mac 上跑 iPad App」环境。
   * @see https://capacitorjs.com/docs/config
   */
  server: {
    iosScheme: "https",
  },
  /**
   * 真机/模拟器热重载：本机 `npm run dev` 后取消注释，把地址换成电脑的局域网 IP。
   * Android 若 API 为 http 还需在 `android/app/src/main/AndroidManifest.xml` 开 cleartext。
   */
  // server: { url: "http://192.168.1.2:5173", cleartext: true, iosScheme: "https" },
  plugins: {
    Keyboard: {
      /**
       * 须用 native：整页 WebView 随键盘缩小，fixed 底栏（速记层）才会留在键盘上方。
       * 用 body 时 fixed 仍相对大视口贴底，整片会沉到键盘下 → 输入框「消失」。
       */
      resize: "native",
      style: "LIGHT",
    },
  },
};

export default config;
