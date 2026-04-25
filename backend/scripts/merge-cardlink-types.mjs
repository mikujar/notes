#!/usr/bin/env node
/**
 * merge-cardlink-types.mjs:把 cardLink(单)和 cardLinks(多)合并为统一的 cardLink。
 *
 * 背景:
 *   历史上 CardProperty 有 cardLink(value 是单 {colId,cardId} 对象)和 cardLinks
 *   (value 是 CardLinkRef[])两种类型。本 PR 合并为单一 cardLink,value 永远是
 *   CardLinkRef[] | null,UI 统一渲染为 chip 列表。
 *
 * 这个脚本一次性把库存数据搬到新形态:
 *   A) cards.custom_props (jsonb 数组)里:
 *      - type === "cardLinks"  → 改名 type: "cardLink"(value 已是数组,保留)
 *      - type === "cardLink"   且 value 是单 {colId, cardId} 对象 → 包成 [value]
 *      - type === "cardLink"   且 value 是 null/undefined/空 → 不动
 *      - type === "cardLink"   且 value 已是数组 → 不动
 *   B) card_types.schema_json.fields (数组)里:
 *      - type === "cardLinks" → 改名 type: "cardLink"
 *
 * 幂等:再跑零变更。
 *
 * 用法(在 backend 目录,需配置好 .env / DATABASE_URL):
 *   node scripts/merge-cardlink-types.mjs              # 默认 dry-run,只统计
 *   node scripts/merge-cardlink-types.mjs --apply      # 真正写库(事务内)
 *   node scripts/merge-cardlink-types.mjs --include-trash  # 顺带处理已回收卡
 *
 * 安全:
 *   - 默认 dry-run 不写库;只有 --apply 才 COMMIT
 *   - 整个迁移包在一个事务里,失败自动回滚
 *   - 失败回退方法:不需要——dry-run 与 apply 之间数据库无任何变化
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const INCLUDE_TRASH = process.argv.includes("--include-trash");

const { getClient, closePool } = await import("../src/db.js");

const stats = {
  cardTypesScanned: 0,
  cardTypesUpdated: 0,
  cardTypeFieldsRenamed: 0,
  cardsScanned: 0,
  cardsUpdated: 0,
  propsRenamed: 0, // cardLinks → cardLink
  propsWrappedToArray: 0, // 单对象 value → [value]
};

/** 返回 { next, changes } 或 null(无变更),不修改原数组 */
function migrateCustomProps(props) {
  if (!Array.isArray(props)) return null;
  let renamed = 0;
  let wrapped = 0;
  const next = props.map((p) => {
    if (!p || typeof p !== "object") return p;
    const t = typeof p.type === "string" ? p.type : "";
    if (t === "cardLinks") {
      renamed += 1;
      // value 已是数组(或 null);保留
      return { ...p, type: "cardLink" };
    }
    if (t === "cardLink") {
      const v = p.value;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // 单对象形态:包成数组(若是无效空对象也包,后端读取时会清洗)
        wrapped += 1;
        return { ...p, value: [v] };
      }
    }
    return p;
  });
  if (renamed === 0 && wrapped === 0) return null;
  return { next, renamed, wrapped };
}

function migrateSchemaFields(fields) {
  if (!Array.isArray(fields)) return null;
  let renamed = 0;
  const next = fields.map((f) => {
    if (!f || typeof f !== "object") return f;
    if (f.type === "cardLinks") {
      renamed += 1;
      return { ...f, type: "cardLink" };
    }
    return f;
  });
  if (renamed === 0) return null;
  return { next, renamed };
}

async function processCardTypes(client) {
  const rows = (
    await client.query(
      `SELECT id, name, kind, schema_json
       FROM card_types
       WHERE schema_json IS NOT NULL`
    )
  ).rows;
  for (const row of rows) {
    stats.cardTypesScanned += 1;
    const sj = row.schema_json;
    if (!sj || typeof sj !== "object") continue;
    const fields = Array.isArray(sj.fields) ? sj.fields : null;
    if (!fields) continue;
    const r = migrateSchemaFields(fields);
    if (!r) continue;
    stats.cardTypesUpdated += 1;
    stats.cardTypeFieldsRenamed += r.renamed;
    console.log(
      `  card_type update: id=${row.id} kind=${row.kind} name=${row.name} renamed=${r.renamed}`
    );
    if (!APPLY) continue;
    const newSchema = { ...sj, fields: r.next };
    await client.query(
      `UPDATE card_types SET schema_json = $1, updated_at = NOW() WHERE id = $2`,
      [newSchema, row.id]
    );
  }
}

async function processCards(client) {
  const trashClause = INCLUDE_TRASH ? "" : "AND c.trashed_at IS NULL";
  const rows = (
    await client.query(
      `SELECT c.id, c.user_id, c.custom_props
       FROM cards c
       WHERE c.custom_props IS NOT NULL
         AND jsonb_typeof(c.custom_props) = 'array'
         ${trashClause}`
    )
  ).rows;
  for (const row of rows) {
    stats.cardsScanned += 1;
    const props = Array.isArray(row.custom_props) ? row.custom_props : [];
    const r = migrateCustomProps(props);
    if (!r) continue;
    stats.cardsUpdated += 1;
    stats.propsRenamed += r.renamed;
    stats.propsWrappedToArray += r.wrapped;
    if (stats.cardsUpdated <= 20) {
      console.log(
        `  card update: id=${row.id} renamed=${r.renamed} wrapped=${r.wrapped}`
      );
    } else if (stats.cardsUpdated === 21) {
      console.log("  …(后续受影响卡省略,见统计)");
    }
    if (!APPLY) continue;
    await client.query(
      `UPDATE cards SET custom_props = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(r.next), row.id]
    );
  }
}

async function main() {
  console.log(
    APPLY
      ? "[APPLY MODE] 将真正写库(事务内,失败自动回滚)"
      : "[DRY-RUN] 默认只统计,不写库;追加 --apply 才会写。"
  );
  console.log(`include_trash=${INCLUDE_TRASH}`);
  console.log("─".repeat(60));

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await processCardTypes(client);
    await processCards(client);
    if (APPLY) {
      await client.query("COMMIT");
      console.log("\n[APPLIED] 已提交。");
    } else {
      await client.query("ROLLBACK");
      console.log("\n[DRY-RUN] 已回滚,未写库。");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n迁移失败,已回滚:", e);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  console.log("─".repeat(60));
  console.log("统计:");
  console.log(`  card_types 扫描:                 ${stats.cardTypesScanned}`);
  console.log(`  card_types 受影响:               ${stats.cardTypesUpdated}`);
  console.log(`  card_types schema 字段改名:       ${stats.cardTypeFieldsRenamed}`);
  console.log(`  cards 扫描:                      ${stats.cardsScanned}`);
  console.log(`  cards 受影响:                    ${stats.cardsUpdated}`);
  console.log(`  custom_props 中 cardLinks→cardLink: ${stats.propsRenamed}`);
  console.log(`  custom_props 中 单对象 value→[v]:    ${stats.propsWrappedToArray}`);

  await closePool();
}

main();
