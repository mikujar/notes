#!/usr/bin/env node
/**
 * 本地 `npm run build` 后同步 Capacitor 原生工程；CI / Docker 仅产出 `dist` 时跳过。
 * 设置 SKIP_CAP_SYNC=1（见 Dockerfile）可避免 Railway 等环境因缺少 www / 未拷贝 cap 配置而失败。
 */
import { spawnSync } from "node:child_process";

if (process.env.SKIP_CAP_SYNC === "1") {
  process.exit(0);
}

const r = spawnSync("npx", ["cap", "sync"], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
