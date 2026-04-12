#!/usr/bin/env node
/**
 * 为历史笔记里「视频无 thumbnailUrl / 图片无 thumbnailUrl」补 COS 预览并写回 media JSON。
 *
 * 用法（在 server 目录、已配置 DATABASE_URL + COS；视频截帧另需 ffmpeg）：
 *   node scripts/backfill-video-thumbnails.mjs
 *   node scripts/backfill-video-thumbnails.mjs --dry-run
 *   node scripts/backfill-video-thumbnails.mjs --include-trash
 *
 * 非 COS 直链（仅 /uploads/ 本地路径）无法从桶里拉对象，会跳过。
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const dryRun = process.argv.includes("--dry-run");
const includeTrash = process.argv.includes("--include-trash");

const { query, closePool } = await import("../src/db.js");
const { extractObjectKeyFromCosPublicUrl, isCosConfigured } = await import(
  "../src/storage.js"
);
const {
  generateImagePreviewForExistingCosKey,
  generateVideoThumbnailForExistingCosKey,
} = await import("../src/mediaUpload.js");

if (!isCosConfigured()) {
  console.error("❌ 未配置 COS 环境变量，无法拉取对象。退出。");
  process.exit(1);
}

/**
 * @param {unknown} media
 * @returns {Promise<{ changed: boolean; media: unknown[] }>}
 */
async function patchMediaArray(media) {
  if (!Array.isArray(media)) return { changed: false, media: [] };
  let changed = false;
  const next = [];
  for (const item of media) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.url !== "string" ||
      !item.url.trim()
    ) {
      next.push(item);
      continue;
    }
    if (
      typeof item.thumbnailUrl === "string" &&
      item.thumbnailUrl.trim()
    ) {
      next.push(item);
      continue;
    }
    if (item.kind !== "video" && item.kind !== "image") {
      next.push(item);
      continue;
    }
    const key = extractObjectKeyFromCosPublicUrl(item.url.trim());
    if (!key) {
      console.warn(`  跳过（非本桶 URL 或本地路径）: ${String(item.url).slice(0, 80)}`);
      next.push(item);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry-run] 将处理 ${item.kind} key=${key}`);
      next.push(item);
      continue;
    }
    const out =
      item.kind === "video"
        ? await generateVideoThumbnailForExistingCosKey(key)
        : await generateImagePreviewForExistingCosKey(key);
    if (out.thumbnailUrl) {
      changed = true;
      next.push({ ...item, thumbnailUrl: out.thumbnailUrl });
      console.log(`  ✓ ${item.kind} ${key} → thumb OK`);
    } else {
      next.push(item);
      console.warn(`  ✗ ${item.kind} ${key} skipped: ${out.skipped ?? "unknown"}`);
    }
  }
  return { changed, media: next };
}

async function runCards() {
  const { rows } = await query(
    `SELECT id, media FROM cards c
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements(c.media) elem
       WHERE (elem->>'kind' = 'video' OR elem->>'kind' = 'image')
         AND (elem->>'thumbnailUrl' IS NULL OR btrim(elem->>'thumbnailUrl') = '')
     )`
  );
  console.log(`\n[cards] 待处理行数: ${rows.length}`);
  let updated = 0;
  for (const row of rows) {
    const { changed, media } = await patchMediaArray(row.media);
    if (changed && !dryRun) {
      await query(`UPDATE cards SET media = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(media),
        row.id,
      ]);
      updated += 1;
      console.log(`[cards] 已更新 id=${row.id}`);
    }
  }
  if (dryRun) console.log("[cards] dry-run：未写库");
  else console.log(`[cards] 共更新 ${updated} 张卡片`);
}

async function runTrash() {
  const { rows } = await query(
    `SELECT trash_id, card FROM trashed_notes t
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(t.card->'media', '[]'::jsonb)) elem
       WHERE (elem->>'kind' = 'video' OR elem->>'kind' = 'image')
         AND (elem->>'thumbnailUrl' IS NULL OR btrim(elem->>'thumbnailUrl') = '')
     )`
  );
  console.log(`\n[trash] 待处理行数: ${rows.length}`);
  let updated = 0;
  for (const row of rows) {
    const card =
      row.card && typeof row.card === "object"
        ? { ...row.card }
        : {};
    const media = Array.isArray(card.media) ? card.media : [];
    const { changed, media: nextMedia } = await patchMediaArray(media);
    if (changed && !dryRun) {
      card.media = nextMedia;
      await query(
        `UPDATE trashed_notes SET card = $1::jsonb WHERE trash_id = $2`,
        [JSON.stringify(card), row.trash_id]
      );
      updated += 1;
      console.log(`[trash] 已更新 trash_id=${row.trash_id}`);
    }
  }
  if (dryRun) console.log("[trash] dry-run：未写库");
  else console.log(`[trash] 共更新 ${updated} 条快照`);
}

try {
  await runCards();
  if (includeTrash) await runTrash();
  else console.log("\n（未扫描回收站；需要请加 --include-trash）");
} finally {
  await closePool();
}

console.log("\n完成。");
