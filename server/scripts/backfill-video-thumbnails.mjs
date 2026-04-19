#!/usr/bin/env node
/**
 * 为历史笔记补 COS 侧元数据并写回 cards.media：
 * - 视频 / 图片缺 thumbnailUrl 时生成列表小图（需 ffmpeg 等，与原先一致）
 * - 视频缺 durationSec 时探测时长（与 finalize 一致；已有缩略图也会补）
 * - 各类附件缺有效 sizeBytes 时，用 COS 对象元数据补字节数（Range 请求，不整文件下载）
 *
 * 用法（在 server 目录、已配置 DATABASE_URL + COS）：
 *   node scripts/backfill-video-thumbnails.mjs
 *   node scripts/backfill-video-thumbnails.mjs --dry-run
 *   node scripts/backfill-video-thumbnails.mjs --include-trash
 *
 * 非 COS 直链（仅 /uploads/ 本地路径）无法从桶里读大小，会跳过。
 * 外链占位图（如 picsum）不是本桶对象，解析不出 key 属正常，脚本会静默跳过且不刷屏 warn。
 * 以 / 开头但非 /uploads/ 的路径（如微信导入的 /微信图片_xxx.jpg）属客户端本地路径，服务端无法当 COS 处理，同样静默跳过。
 * card_attachments 由 cards.media 触发器同步；补 duration 只更新 cards.media 即可。
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mediaNeedsWorkExists } from "./mediaMetadataPendingSql.mjs";

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
  probeVideoOrAudioDurationFromCosKey,
} = await import("../src/mediaUpload.js");

if (!isCosConfigured()) {
  console.error("❌ 未配置 COS 环境变量，无法拉取对象。退出。");
  process.exit(1);
}

/** 占位图 / 常见外链 CDN：非本桶，不尝试 COS 补全、不打逐条 warn */
function isLikelyNonCosAttachmentUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return (
      h === "picsum.photos" ||
      h.endsWith(".picsum.photos") ||
      h === "placehold.co" ||
      h === "via.placeholder.com" ||
      h === "dummyimage.com" ||
      h.endsWith("unsplash.com") ||
      h === "placekitten.com" ||
      h === "loremflickr.com" ||
      h === "www.w3.org" ||
      h.endsWith(".w3.org") ||
      h === "interactive-examples.mdn.mozilla.net" ||
      h.endsWith(".mdn.mozilla.net") ||
      h.endsWith(".mozillademos.org")
    );
  } catch {
    return false;
  }
}

let cosKeyWarnBudget = 40;
let cosKeyWarnBudgetNoticePrinted = false;

/**
 * 形如 /xxx 的客户端本地绝对路径（常见微信导入），非本服务 uploads，无法在部署环境映射 COS。
 */
function isClientLocalRootPath(url) {
  const s = String(url).trim();
  if (!s.startsWith("/")) return false;
  if (s.startsWith("//")) return false;
  if (/^https?:\/\//i.test(s)) return false;
  if (s.startsWith("/uploads/")) return false;
  return true;
}

/** @param {string} message @param {string} url */
function warnMissingCosKey(message, url) {
  if (isLikelyNonCosAttachmentUrl(url)) return;
  if (url.startsWith("/uploads/") || url.startsWith("uploads/")) return;
  if (isClientLocalRootPath(url)) return;
  if (cosKeyWarnBudget <= 0) {
    if (!cosKeyWarnBudgetNoticePrinted) {
      cosKeyWarnBudgetNoticePrinted = true;
      console.warn(
        "  （无法解析 COS key 的告警已达上限，后续省略；外链/本地路径/占位图已静默跳过）"
      );
    }
    return;
  }
  cosKeyWarnBudget--;
  console.warn(`${message}: ${url.slice(0, 96)}`);
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
  if (typeof sb === "number" && Number.isFinite(sb) && sb >= 0) {
    if (Number.isInteger(sb)) return false;
    return true;
  }
  if (typeof sb === "string" && /^\d+$/.test(sb.trim())) return false;
  return true;
}

/** 视频缺服务端写入的时长（浏览器探测的不写库，此处只补 JSON 空档） */
function wantsVideoDuration(item) {
  if (!item || typeof item !== "object") return false;
  const o = /** @type {Record<string, unknown>} */ (item);
  if (o.kind !== "video") return false;
  const d = o.durationSec;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) return false;
  if (
    typeof d === "string" &&
    /^-?\d+(\.\d+)?$/.test(String(d).trim())
  ) {
    return false;
  }
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
        warnMissingCosKey("  跳过缩略图（非本桶 URL 或本地路径）", url);
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
        if (
          out.kind === "video" &&
          gen.durationSec != null &&
          Number.isFinite(gen.durationSec) &&
          gen.durationSec >= 0
        ) {
          changed = true;
          out = { ...out, durationSec: Math.round(gen.durationSec) };
          console.log(`  ✓ video ${key} duration=${Math.round(gen.durationSec)}s`);
        }
      }
    } else if (
      out.kind === "video" &&
      wantsVideoDuration(out) &&
      key &&
      !dryRun
    ) {
      const pr = await probeVideoOrAudioDurationFromCosKey(key);
      if (
        pr.durationSec != null &&
        Number.isFinite(pr.durationSec) &&
        pr.durationSec >= 0
      ) {
        changed = true;
        out = { ...out, durationSec: Math.round(pr.durationSec) };
        console.log(`  ✓ video ${key} duration only → ${Math.round(pr.durationSec)}s`);
      } else {
        console.warn(
          `  ✗ video ${key} duration skipped: ${pr.skipped ?? "unknown"}`
        );
      }
    }

    if (wantsSizeBytes(out)) {
      if (!key) {
        if (url.startsWith("/uploads/") || url.startsWith("uploads/")) {
          /* 本地盘路径，部署脚本不处理 */
        } else if (/^https?:\/\//i.test(url)) {
          warnMissingCosKey(
            "  跳过 sizeBytes（无法从 URL 解析 COS key，请核对 COS_PUBLIC_BASE 与直链域）",
            url
          );
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
      try {
        await query(`UPDATE cards SET media = $1::jsonb, updated_at = now() WHERE id = $2`, [
          JSON.stringify(media),
          row.id,
        ]);
        updated += 1;
        console.log(`[cards] 已更新 id=${row.id}`);
      } catch (e) {
        console.error(
          `[cards] 写库失败 id=${row.id}（多为 card_attachments 触发器或 JSON 校验；已跳过本条）: ${e?.message ?? e}`
        );
      }
    }
  }
  if (dryRun) console.log("[cards] dry-run：未写库");
  else {
    console.log(`[cards] 共更新 ${updated} 张卡片`);
    const { rows: remRows } = await query(
      `SELECT COUNT(*)::int AS n FROM cards c
       WHERE c.trashed_at IS NULL AND ${mediaNeedsWorkExists("c", "media")}`
    );
    const remaining = remRows[0]?.n ?? 0;
    if (remaining > 0) {
      console.log(
        `[cards] 仍剩 ${remaining} 张卡片含「待补」附件（含外链/本地路径/SVG/本趟探测失败等无法写库的项）；与「本趟更新张数」无必然相等关系。`
      );
    }
  }
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
      try {
        await query(
          `UPDATE cards SET media = $1::jsonb, updated_at = now() WHERE id = $2`,
          [JSON.stringify(nextMedia), row.id]
        );
        updated += 1;
        console.log(`[trash] 已更新 id=${row.id}`);
      } catch (e) {
        console.error(
          `[trash] 写库失败 id=${row.id}: ${e?.message ?? e}`
        );
      }
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
