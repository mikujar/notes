#!/usr/bin/env node
/**
 * 历史文件卡元数据回填:
 *  1. cards.custom_props 缺 sf-file-resolution / sf-vid-resolution(图片/视频)→ 探测 COS 文件后回填
 *  2. cards.custom_props 缺 sf-vid-duration-sec / sf-aud-duration-sec(视频/音频)→ 探测后回填
 *  3. card_files.bytes 为 NULL 时,从 COS 取 Content-Length 回填
 *
 * 标题不在本脚本范围,见 migrate-titles-to-column.mjs。
 *
 * 用法(在 backend 目录,已配置 DATABASE_URL + COS):
 *   node scripts/backfill-file-card-metadata.mjs               # 实际执行
 *   node scripts/backfill-file-card-metadata.mjs --dry-run     # 仅打印,不写库
 *   node scripts/backfill-file-card-metadata.mjs --include-trash  # 同时处理回收站
 *   node scripts/backfill-file-card-metadata.mjs --limit=100   # 仅处理前 N 张(测试用)
 *
 * 探测失败的卡会跳过(打印 skipped 原因),可重跑;脚本是幂等的——已补齐的字段不会再覆盖。
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const DRY = process.argv.includes("--dry-run");
const INCLUDE_TRASH = process.argv.includes("--include-trash");
const LIMIT = (() => {
  const a = process.argv.find((s) => s.startsWith("--limit="));
  if (!a) return 0;
  const n = parseInt(a.slice("--limit=".length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

const { query, closePool } = await import("../src/db.js");
const {
  objectKeyFromMediaUrl,
  probeMediaMetadataFromCosKey,
} = await import("../src/mediaUpload.js");
const { isCosConfigured } = await import("../src/storage.js");

if (!isCosConfigured()) {
  console.warn("⚠️ 未配置 COS,只能回填标题(分辨率/时长/字节数需要 COS 才能探测)");
}

/** 卡的 custom_props 数组里有没有这个 id */
function hasProp(arr, id) {
  return Array.isArray(arr) && arr.some((p) => p?.id === id);
}

/** 把字段写到 custom_props 里(已存在则按"空才覆盖"原则)。返回是否变更。 */
function upsertProp(arr, prop) {
  const existing = arr.find((x) => x?.id === prop.id);
  if (!existing) {
    arr.push(prop);
    return true;
  }
  if (
    existing.value === null ||
    existing.value === undefined ||
    existing.value === ""
  ) {
    Object.assign(existing, prop);
    return true;
  }
  return false;
}

function inferKindFromSlug(slug) {
  if (typeof slug !== "string") return "file";
  if (slug.includes("image")) return "image";
  if (slug.includes("video")) return "video";
  if (slug.includes("audio")) return "audio";
  return "file";
}

const stats = {
  processed: 0,
  resolutionFilled: 0,
  durationFilled: 0,
  bytesFilled: 0,
  probeSkipped: 0,
  unchanged: 0,
};

async function processOne(row) {
  const cp = Array.isArray(row.custom_props) ? row.custom_props.slice() : [];
  let cpChanged = false;
  let bytesChanged = false;
  let nextBytes = row.bytes;

  // 标题已迁移到 cards.title 列,本脚本不再处理标题(见 migrate-titles-to-column.mjs)

  const slug = row.preset_slug || "";
  const kind = inferKindFromSlug(slug);

  // 涉及 COS 探测
  const needsResolution =
    (kind === "image" || kind === "video") &&
    !hasProp(cp, "sf-file-resolution");
  const needsVidResolution =
    kind === "video" && !hasProp(cp, "sf-vid-resolution");
  const needsVidDuration =
    kind === "video" && !hasProp(cp, "sf-vid-duration-sec");
  const needsAudDuration =
    kind === "audio" && !hasProp(cp, "sf-aud-duration-sec");
  const needsBytes = row.bytes == null;

  const needsProbe =
    isCosConfigured() &&
    row.url &&
    (needsResolution ||
      needsVidResolution ||
      needsVidDuration ||
      needsAudDuration ||
      needsBytes);

  if (needsProbe) {
    const key = objectKeyFromMediaUrl(row.url);
    if (!key) {
      stats.probeSkipped += 1;
    } else {
      let probed;
      try {
        probed = await probeMediaMetadataFromCosKey(key);
      } catch (e) {
        console.warn(
          `  ✗ probe failed card=${row.id} key=${key}: ${e?.message ?? e}`
        );
        stats.probeSkipped += 1;
      }
      if (probed) {
        if (
          (needsResolution || needsVidResolution) &&
          typeof probed.widthPx === "number" &&
          typeof probed.heightPx === "number"
        ) {
          const value = `${probed.widthPx}x${probed.heightPx}`;
          if (needsResolution) {
            if (
              upsertProp(cp, {
                id: "sf-file-resolution",
                name: "分辨率",
                type: "text",
                value,
              })
            ) {
              cpChanged = true;
              stats.resolutionFilled += 1;
            }
          }
          if (needsVidResolution) {
            if (
              upsertProp(cp, {
                id: "sf-vid-resolution",
                name: "分辨率",
                type: "text",
                value,
              })
            ) {
              cpChanged = true;
            }
          }
        }
        if (
          needsVidDuration &&
          typeof probed.durationSec === "number"
        ) {
          if (
            upsertProp(cp, {
              id: "sf-vid-duration-sec",
              name: "时长(秒)",
              type: "number",
              value: probed.durationSec,
            })
          ) {
            cpChanged = true;
            stats.durationFilled += 1;
          }
        }
        if (
          needsAudDuration &&
          typeof probed.durationSec === "number"
        ) {
          if (
            upsertProp(cp, {
              id: "sf-aud-duration-sec",
              name: "时长(秒)",
              type: "number",
              value: probed.durationSec,
            })
          ) {
            cpChanged = true;
            stats.durationFilled += 1;
          }
        }
        if (needsBytes && typeof probed.sizeBytes === "number") {
          nextBytes = probed.sizeBytes;
          bytesChanged = true;
          stats.bytesFilled += 1;
        }
      }
    }
  }

  if (!cpChanged && !bytesChanged) {
    stats.unchanged += 1;
    return;
  }

  if (DRY) {
    console.log(
      `  [dry] card=${row.id}` +
        (cpChanged ? ` props=${cp.length}` : "") +
        (bytesChanged ? ` bytes=${nextBytes}` : "")
    );
    return;
  }

  if (cpChanged) {
    await query(
      `UPDATE cards SET custom_props = $2::jsonb, updated_at = now() WHERE id = $1`,
      [row.id, JSON.stringify(cp)]
    );
  }
  if (bytesChanged) {
    await query(`UPDATE card_files SET bytes = $2 WHERE card_id = $1`, [
      row.id,
      nextBytes,
    ]);
  }
}

try {
  const trashFilter = INCLUDE_TRASH ? "" : "AND c.trashed_at IS NULL";
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";
  const sql = `
    SELECT
      c.id,
      c.title,
      c.custom_props,
      ct.preset_slug,
      cf.url,
      cf.original_name,
      cf.bytes
    FROM cards c
    JOIN card_types ct ON ct.id = c.card_type_id AND ct.kind = 'file'
    JOIN card_files cf ON cf.card_id = c.id
    WHERE 1=1 ${trashFilter}
    ORDER BY c.created_at ASC
    ${limitClause}
  `;
  const { rows } = await query(sql);
  console.log(`待处理文件卡: ${rows.length}${DRY ? " (dry-run)" : ""}`);

  for (const row of rows) {
    stats.processed += 1;
    try {
      await processOne(row);
    } catch (e) {
      console.error(`  ❌ card=${row.id}: ${e?.message ?? e}`);
    }
    if (stats.processed % 50 === 0) {
      console.log(
        `  进度 ${stats.processed}/${rows.length} | 分辨率+${stats.resolutionFilled} 时长+${stats.durationFilled} 字节+${stats.bytesFilled}`
      );
    }
  }

  console.log("\n=== 汇总 ===");
  console.log(`  处理: ${stats.processed}`);
  console.log(`  分辨率回填: ${stats.resolutionFilled}`);
  console.log(`  时长回填: ${stats.durationFilled}`);
  console.log(`  字节数回填: ${stats.bytesFilled}`);
  console.log(`  探测跳过: ${stats.probeSkipped}`);
  console.log(`  无变更: ${stats.unchanged}`);
  if (DRY) console.log("  🧪 DRY RUN — 未写库");
  else console.log("  ✅ 完成");
} catch (e) {
  console.error("\n❌ 失败:", e?.message ?? e);
  process.exit(1);
} finally {
  await closePool();
}
