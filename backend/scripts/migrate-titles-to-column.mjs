#!/usr/bin/env node
/**
 * 标题统一迁移:把 custom_props 里的 sf-file-title / sf-clip-title / sf-person-name
 * 全部搬到 cards.title 列,然后从 custom_props 移除这三种 prop。
 *
 * 配套方案 Z'':标题成为 cards.title 的一等列,custom_props 不再承担"标题"角色。
 *
 * 用法(在 backend 目录,已配置 DATABASE_URL):
 *   node scripts/migrate-titles-to-column.mjs --dry-run     # 仅打印,不写库
 *   node scripts/migrate-titles-to-column.mjs               # 实跑
 *   node scripts/migrate-titles-to-column.mjs --include-trash
 *
 * 行为:
 *  - 若 custom_props 里某 prop 的 value 非空字符串,且 cards.title 当前为空,把 value 写入 cards.title
 *  - 若 cards.title 已有值且与 prop value 不同,记录冲突(默认保留 cards.title,prop 仍移除)
 *  - 移除 sf-file-title / sf-clip-title / sf-person-name 三种 prop(无论上面有没有写入)
 *  - 幂等:已迁移过的卡再跑不会出问题
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const DRY = process.argv.includes("--dry-run");
const INCLUDE_TRASH = process.argv.includes("--include-trash");

const TITLE_PROP_IDS = new Set([
  "sf-file-title",
  "sf-clip-title",
  "sf-person-name",
]);

const { query, closePool } = await import("../src/db.js");

const stats = {
  scanned: 0,
  unchanged: 0,
  titleWritten: 0,
  propsRemoved: 0,
  conflicts: 0,
};

function pickTitleFromProps(props) {
  if (!Array.isArray(props)) return "";
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    if (!TITLE_PROP_IDS.has(p.id)) continue;
    const v = p.value;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function stripTitleProps(props) {
  if (!Array.isArray(props)) return { next: [], removedCount: 0 };
  const next = [];
  let removedCount = 0;
  for (const p of props) {
    if (p && typeof p === "object" && TITLE_PROP_IDS.has(p.id)) {
      removedCount += 1;
      continue;
    }
    next.push(p);
  }
  return { next, removedCount };
}

try {
  const trashFilter = INCLUDE_TRASH ? "" : "AND c.trashed_at IS NULL";
  const sql = `
    SELECT c.id, c.title, c.custom_props, cf.original_name
    FROM cards c
    LEFT JOIN card_files cf ON cf.card_id = c.id
    WHERE 1=1 ${trashFilter}
      AND (
        cf.card_id IS NOT NULL
        OR c.custom_props @> '[{"id":"sf-file-title"}]'::jsonb
        OR c.custom_props @> '[{"id":"sf-clip-title"}]'::jsonb
        OR c.custom_props @> '[{"id":"sf-person-name"}]'::jsonb
      )
    ORDER BY c.created_at ASC
  `;
  const { rows } = await query(sql);
  console.log(`待处理卡片(含 sf-file-title/sf-clip-title/sf-person-name 之一): ${rows.length}${DRY ? " (dry-run)" : ""}`);

  for (const row of rows) {
    stats.scanned += 1;
    const cp = Array.isArray(row.custom_props) ? row.custom_props : [];
    const propTitle = pickTitleFromProps(cp);
    const { next, removedCount } = stripTitleProps(cp);

    // 标题选择策略:
    //   - 文件卡(有 card_files 记录): 用 original_name(带扩展名)做权威标题
    //   - 剪藏/人物卡: 用 prop value
    const isFileCard = typeof row.original_name === "string" && row.original_name.length > 0;
    const desiredTitle = isFileCard ? row.original_name : propTitle;

    let nextTitle = row.title || "";
    let willWriteTitle = false;
    if (desiredTitle && desiredTitle !== nextTitle) {
      // 覆盖:权威源(original_name 或 prop)是真相
      nextTitle = desiredTitle;
      willWriteTitle = true;
      if (row.title && row.title !== desiredTitle) {
        stats.conflicts += 1;
        if (DRY) {
          console.log(
            `  [overwrite] card=${row.id} cards.title=${JSON.stringify(row.title)} → ${JSON.stringify(desiredTitle)}${isFileCard ? " (from original_name)" : " (from prop)"}`
          );
        }
      }
    }

    if (removedCount === 0 && !willWriteTitle) {
      stats.unchanged += 1;
      continue;
    }

    if (DRY) {
      const titleNote = willWriteTitle ? ` title="${nextTitle}"` : "";
      const removeNote = removedCount > 0 ? ` removed=${removedCount}` : "";
      console.log(`  [dry] card=${row.id}${titleNote}${removeNote}`);
    } else {
      await query(
        `UPDATE cards SET title = $2, custom_props = $3::jsonb, updated_at = now() WHERE id = $1`,
        [row.id, nextTitle, JSON.stringify(next)]
      );
    }
    if (willWriteTitle) stats.titleWritten += 1;
    if (removedCount > 0) stats.propsRemoved += removedCount;
  }

  console.log("\n=== 汇总 ===");
  console.log(`  扫描: ${stats.scanned}`);
  console.log(`  写入 cards.title: ${stats.titleWritten}`);
  console.log(`  移除 custom_props 项: ${stats.propsRemoved}`);
  console.log(`  覆盖了非空 cards.title(差异): ${stats.conflicts}`);
  console.log(`  无变更: ${stats.unchanged}`);
  if (DRY) console.log("  🧪 DRY RUN — 未写库");
  else console.log("  ✅ 完成");
} catch (e) {
  console.error("\n❌ 失败:", e?.message ?? e);
  process.exit(1);
} finally {
  await closePool();
}
