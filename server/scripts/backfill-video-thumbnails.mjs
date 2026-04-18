#!/usr/bin/env node
/**
 * 为历史笔记补 COS 侧元数据并写回 cards.media：
 * - 视频 / 图片缺 thumbnailUrl 时生成列表小图（需 ffmpeg 等，与原先一致）
 * - 各类附件缺有效 sizeBytes 时，用 COS 对象元数据补字节数（Range 请求，不整文件下载）
 *
 * 用法（在 server 目录、已配置 DATABASE_URL + COS）：
 *   node scripts/backfill-video-thumbnails.mjs
 *   node scripts/backfill-video-thumbnails.mjs --dry-run
 *   node scripts/backfill-video-thumbnails.mjs --include-trash
 *
 * 非 COS 直链（仅 /uploads/ 本地路径）无法从桶里读大小，会跳过。
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const dryRun = process.argv.includes("--dry-run");
const includeTrash = process.argv.includes("--include-trash");

const { query, closePool } = await import("../src/db.js");
const {
  extractObjectKeyFromCosPublicUrl,
  getCosObjectByteLength,
  isCosConfigured,
} = await import("../src/storage.js");
const {
  generateImagePreviewForExistingCosKey,
  generateVideoThumbnailForExistingCosKey,
} = await import("../src/mediaUpload.js");

if (!isCosConfigured()) {
  console.error("❌ 未配置 COS 环境变量，无法拉取对象。退出。");
  process.exit(1);
}

/** @param {unknown} item */
function wantsThumb(item) {
  if (!item || typeof item !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (item);
  const k = o.kind;
  if (k !== "video" && k !== "image") return false;
  const t = o.thumbnailUrl;
  return !(typeof t === "string" && t.trim());
}

/** @param {unknown} item */
function wantsSizeBytes(item) {
  if (!item || typeof item !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (item);
  const sb = o.sizeBytes;
  if (sb == null) return true;
  if (typeof sb === "number" && Number.isFinite(sb) && sb >= 0) return false;
  if (typeof sb === "string" && /^\d+$/.test(sb.trim())) return false;
  return true;
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
    const url = item.url.trim();
    const key = extractObjectKeyFromCosPublicUrl(url);
    let out = { ...item };
    if (
      typeof out.sizeBytes === "string" &&
      /^\d+$/.test(String(out.sizeBytes).trim())
    ) {
      changed = true;
      out = {
        ...out,
        sizeBytes: parseInt(String(out.sizeBytes).trim(), 10),
      };
    }

    if (wantsThumb(out)) {
      if (!key) {
        console.warn(
          `  跳过缩略图（非本桶 URL 或本地路径）: ${url.slice(0, 80)}`
        );
      } else if (dryRun) {
        console.log(`  [dry-run] 将生成缩略图 ${out.kind} key=${key}`);
      } else if (out.kind === "video" || out.kind === "image") {
        const gen =
          out.kind === "video"
            ? await generateVideoThumbnailForExistingCosKey(key)
            : await generateImagePreviewForExistingCosKey(key);
        if (gen.thumbnailUrl) {
          changed = true;
          out = { ...out, thumbnailUrl: gen.thumbnailUrl };
          console.log(`  ✓ ${out.kind} ${key} → thumb OK`);
        } else {
          console.warn(
            `  ✗ ${out.kind} ${key} thumb skipped: ${gen.skipped ?? "unknown"}`
          );
        }
      }
    }

    if (wantsSizeBytes(out)) {
      if (!key) {
        if (url.startsWith("/uploads/") || url.startsWith("uploads/")) {
          /* 本地盘路径，部署脚本不处理 */
        }
      } else if (dryRun) {
        console.log(`  [dry-run] 将补 sizeBytes key=${key}`);
      } else {
        try {
          const n = await getCosObjectByteLength(key);
          if (Number.isFinite(n) && n >= 0) {
            changed = true;
            out = { ...out, sizeBytes: Math.floor(n) };
            console.log(`  ✓ sizeBytes ${key} → ${n}`);
          }
        } catch (e) {
          console.warn(`  ✗ sizeBytes ${key}: ${e?.message ?? e}`);
        }
      }
    }

    next.push(out);
  }
  return { changed, media: next };
}

/** @param {string} tableAlias @param {string} mediaColumn */
function mediaNeedsWorkExists(tableAlias, mediaColumn) {
  return `EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(${tableAlias}.${mediaColumn}, '[]'::jsonb)) elem
  WHERE COALESCE(NULLIF(trim(elem->>'url'), ''), '') <> ''
  AND (
    (
      (elem->>'kind' IN ('image', 'video'))
      AND (elem->>'thumbnailUrl' IS NULL OR btrim(elem->>'thumbnailUrl') = '')
    )
    OR (
      (elem->>'kind' IN ('image', 'video', 'audio', 'file'))
      AND NOT (
        jsonb_typeof(elem->'sizeBytes') = 'number'
        AND (elem->>'sizeBytes')::numeric >= 0
        AND (elem->>'sizeBytes')::numeric = floor((elem->>'sizeBytes')::numeric)
      )
    )
  )
)`;
}

async function runCards() {
  const { rows } = await query(
    `SELECT id, media FROM cards c
     WHERE c.trashed_at IS NULL AND ${mediaNeedsWorkExists("c", "media")}`
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
    `SELECT id, media FROM cards t
     WHERE t.trashed_at IS NOT NULL AND ${mediaNeedsWorkExists("t", "media")}`
  );
  console.log(`\n[trash] 待处理行数: ${rows.length}`);
  let updated = 0;
  for (const row of rows) {
    const media = Array.isArray(row.media) ? row.media : [];
    const { changed, media: nextMedia } = await patchMediaArray(media);
    if (changed && !dryRun) {
      await query(
        `UPDATE cards SET media = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(nextMedia), row.id]
      );
      updated += 1;
      console.log(`[trash] 已更新 id=${row.id}`);
    }
  }
  if (dryRun) console.log("[trash] dry-run：未写库");
  else console.log(`[trash] 共更新 ${updated} 条回收站卡片`);
}

try {
  await runCards();
  if (includeTrash) await runTrash();
  else console.log("\n（未扫描回收站；需要请加 --include-trash）");
} finally {
  await closePool();
}

console.log("\n完成。");
