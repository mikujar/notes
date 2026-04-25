#!/usr/bin/env node
/**
 * 生产容器 / 平台启动链：默认仅启动 API（不自动跑迁移/补全脚本）。
 * 若确需在部署时跑脚本，必须显式设置 ALLOW_STARTUP_SCRIPTS_ON_DEPLOY=1。
 *
 * Docker 默认 CMD 指向本脚本；Railway 等也可将 Start Command 设为：
 *   cd backend && npm run start:deploy
 */
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const serverDir = join(scriptsDir, "..");
const node = process.execPath;
const isProductionDeploy =
  String(process.env.RAILWAY_ENVIRONMENT_NAME || "")
    .toLowerCase()
    .trim() === "production" ||
  String(process.env.NODE_ENV || "")
    .toLowerCase()
    .trim() === "production";
const allowStartupScripts = process.env.ALLOW_STARTUP_SCRIPTS_ON_DEPLOY === "1";

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

if (!allowStartupScripts && isProductionDeploy) {
  console.log(
    "[deploy-start] 生产环境默认禁用启动脚本（迁移/补全）。如需启用，请设置 ALLOW_STARTUP_SCRIPTS_ON_DEPLOY=1。"
  );
} else {
  if (process.env.DATABASE_URL?.trim()) {
    // 若需在部署流程里自动迁移存量库，设 RUN_V2_MIGRATE_ON_DEPLOY=1。
    if (process.env.RUN_V2_MIGRATE_ON_DEPLOY === "1") {
      console.log(
        "[deploy-start] RUN_V2_MIGRATE_ON_DEPLOY=1，执行 migrate-to-v2.js …"
      );
      runNodeScript("scripts/migrate-to-v2.js");
    } else {
      console.log(
        "[deploy-start] 跳过 DB 迁移（RUN_V2_MIGRATE_ON_DEPLOY 未开启）。"
      );
    }
  } else {
    console.log(
      "[deploy-start] 未设置 DATABASE_URL，跳过数据库迁移。"
    );
  }

}

console.log("[deploy-start] 启动 API …");
runNodeScript("src/index.js");
