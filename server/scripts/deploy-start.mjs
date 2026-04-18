#!/usr/bin/env node
/**
 * 生产容器 / 平台启动链：增量 SQL 迁移 → 启动 API。
 * 媒体补全（缩略图 + sizeBytes）默认不在此阻塞，避免长时间补全导致健康检查失败、API 永不监听。
 * 需要随部署跑补全时设置环境变量：RUN_MEDIA_METADATA_BACKFILL_ON_DEPLOY=1（仍建议单副本 + 放宽超时）。
 *
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

/** 补全失败不阻断 API 启动（避免线上整站不可用） */
function runBackfillBestEffort() {
  const scriptPath = join(serverDir, "scripts/run-backfill-video-thumbs-on-deploy.mjs");
  const r = spawnSync(node, [scriptPath], {
    cwd: serverDir,
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) {
    console.error("[deploy-start] 补全脚本无法启动:", r.error);
    return;
  }
  if (r.status !== 0) {
    console.error(
      `[deploy-start] 媒体补全退出码 ${r.status}，已忽略并继续启动 API。请查日志或稍后手动: cd server && npm run backfill:media-meta`
    );
  }
}

if (process.env.DATABASE_URL?.trim()) {
  console.log("[deploy-start] 执行增量迁移 pg-migrate-incremental.js …");
  runNodeScript("scripts/pg-migrate-incremental.js");
} else {
  console.log("[deploy-start] 未设置 DATABASE_URL，跳过数据库迁移。");
}

if (process.env.RUN_MEDIA_METADATA_BACKFILL_ON_DEPLOY === "1") {
  console.log(
    "[deploy-start] RUN_MEDIA_METADATA_BACKFILL_ON_DEPLOY=1，执行媒体补全（可能较久）…"
  );
  runBackfillBestEffort();
} else {
  console.log(
    "[deploy-start] 未设置 RUN_MEDIA_METADATA_BACKFILL_ON_DEPLOY=1，跳过启动时媒体补全（避免阻塞健康检查）。需要时可在平台加该变量或手动 npm run backfill:media-meta。"
  );
}

console.log("[deploy-start] 启动 API …");
runNodeScript("src/index.js");
