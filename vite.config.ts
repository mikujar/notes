import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, "");
  const apiPort = env.VITE_DEV_API_PORT || "3001";
  const target = `http://127.0.0.1:${apiPort}`;

  return {
    plugins: [react()],
    server: {
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
