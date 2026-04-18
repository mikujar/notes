#!/usr/bin/env node
/**
 * 生产容器 / 平台启动链：增量 SQL 迁移 →（可选）媒体元数据补全（列表缩略图 + COS sizeBytes）→ 启动 API。
 * Docker 默认 CMD 指向本脚本；Railway 等也可将 Start Command 设为：
 *   cd server && npm run start:deploy
 */
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const serverDir = join(scriptsDir, "..");
const node = process.execPath;

function runNodeScript(relativeFromServer, extraArgs = []) {
  const scriptPath = join(serverDir, relativeFromServer);
  const r = spawnSync(node, [scriptPath, ...extraArgs], {
    cwd: serverDir,
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.env.DATABASE_URL?.trim()) {
  console.log("[deploy-start] 执行增量迁移 pg-migrate-incremental.js …");
  runNodeScript("scripts/pg-migrate-incremental.js");
} else {
  console.log("[deploy-start] 未设置 DATABASE_URL，跳过数据库迁移。");
}

console.log("[deploy-start] 检查是否执行媒体元数据补全（见 run-backfill-video-thumbs-on-deploy.mjs）…");
runNodeScript("scripts/run-backfill-video-thumbs-on-deploy.mjs");

console.log("[deploy-start] 启动 API …");
runNodeScript("src/index.js");
