#!/usr/bin/env node
/**
 * 部署时自动跑一次「媒体元数据补全」脚本（缩略图 + sizeBytes 等，见 backfill-video-thumbnails.mjs）。
 *
 * - 已配置 COS 且库中无 `media_metadata_backfill_v1` 标记时执行；成功后写入 mikujar_deploy_hooks，
 *   并删除旧版 `video_thumb_backfill_v1`（仅缩略图阶段曾用的标记）。
 * - SKIP_VIDEO_THUMB_BACKFILL_ON_DEPLOY=1：跳过（沿用旧变量名）。
 * - FORCE_VIDEO_THUMB_BACKFILL_ON_DEPLOY=1 或 FORCE_MEDIA_METADATA_BACKFILL_ON_DEPLOY=1：清除上述标记后重跑。
 */
import dotenv from "dotenv";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, "..");
dotenv.config({ path: join(serverDir, ".env") });

const HOOK_KEY = "media_metadata_backfill_v1";
const LEGACY_HOOK_KEY = "video_thumb_backfill_v1";

async function main() {
  if (process.env.SKIP_VIDEO_THUMB_BACKFILL_ON_DEPLOY === "1") {
    console.log("[deploy/backfill] SKIP_VIDEO_THUMB_BACKFILL_ON_DEPLOY=1，跳过。");
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.log("[deploy/backfill] 无 DATABASE_URL，跳过。");
    return;
  }

  const { isCosConfigured } = await import("../src/storage.js");
  if (!isCosConfigured()) {
    console.log("[deploy/backfill] 未配置 COS，跳过（补全需从桶读原文件）。");
    return;
  }

  const { query, closePool } = await import("../src/db.js");
  try {
    await query(`
    CREATE TABLE IF NOT EXISTS mikujar_deploy_hooks (
      hook_key     TEXT PRIMARY KEY NOT NULL,
      finished_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

    const force =
      process.env.FORCE_VIDEO_THUMB_BACKFILL_ON_DEPLOY === "1" ||
      process.env.FORCE_MEDIA_METADATA_BACKFILL_ON_DEPLOY === "1";
    if (force) {
      await query(
        `DELETE FROM mikujar_deploy_hooks WHERE hook_key IN ($1, $2)`,
        [HOOK_KEY, LEGACY_HOOK_KEY]
      );
      console.log(
        "[deploy/backfill] FORCE_*=1，已清除媒体元数据补全相关完成标记。"
      );
    }

    const done = await query(
      `SELECT 1 AS x FROM mikujar_deploy_hooks WHERE hook_key = $1`,
      [HOOK_KEY]
    );
    if (done.rows.length > 0) {
      console.log(
        "[deploy/backfill] 本库已记录 media_metadata_backfill_v1，跳过。"
      );
      return;
    }

    console.log(
      "[deploy/backfill] 执行 node scripts/backfill-video-thumbnails.mjs …"
    );
    const r = spawnSync(
      process.execPath,
      ["scripts/backfill-video-thumbnails.mjs"],
      {
        cwd: serverDir,
        stdio: "inherit",
        env: process.env,
      }
    );
    if (r.status !== 0) {
      console.error(
        "[deploy/backfill] 子进程非零退出，不写入完成标记，下次部署会重试。"
      );
      process.exitCode = r.status ?? 1;
      return;
    }

    await query(`INSERT INTO mikujar_deploy_hooks (hook_key) VALUES ($1)`, [
      HOOK_KEY,
    ]);
    await query(`DELETE FROM mikujar_deploy_hooks WHERE hook_key = $1`, [
      LEGACY_HOOK_KEY,
    ]);
    console.log("[deploy/backfill] 已写入完成标记并清理旧版 video_thumb 标记（若有）。");
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
