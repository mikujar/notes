import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const tauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const apiPort = env.VITE_DEV_API_PORT || "3002";
  const target = `http://127.0.0.1:${apiPort}`;

  return {
    // Capacitor / file 协议下必须用相对资源路径；根路径部署的 SPA 仍可用
    base: "./",
    clearScreen: false,
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("@tiptap") || id.includes("prosemirror")) {
              return "tiptap";
            }
            if (id.includes("@vercel/analytics") || id.includes("@vercel/speed-insights")) {
              return "vercel-insights";
            }
            return undefined;
          },
        },
      },
    },
    envPrefix: ["VITE_", "TAURI_"],
    define: {
      __TAURI_BUILD__: JSON.stringify(tauriBuild),
    },
    server: {
      // 0.0.0.0：本机探测 + 真机/模拟器通过局域网访问 devUrl 时都能连上（仅 localhost 会失败）
      host: process.env.TAURI_DEV_HOST && process.env.TAURI_DEV_HOST !== "localhost"
        ? process.env.TAURI_DEV_HOST
        : true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
        },
        "/uploads": {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
