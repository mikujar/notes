#!/usr/bin/env node
/**
 * migrate-json-to-pg.js
 * 将旧版 JSON（COS 或本地 server/data）迁移到 PostgreSQL。
 *
 * 数据源（合集 + 用户）：
 *   · 已配置 COS（COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION）时，
 *     默认从 COS 读（与线上一致）；未配置 COS 时读本地 data/。
 *   · 用户：优先 COS 对象 COS_USERS_KEY（默认 mikujar/users.json），没有再用本地 data/users.json。
 *   · 多用户合集：COS 前缀 COS_COLLECTIONS_PREFIX（默认 mikujar/collections）下各 <userId>.json。
 *   · 单用户 legacy：对象键 COS_KEY（默认 mikujar/collections.json）。
 *
 * 强制仅从 COS 迁移（无 COS 配置则立即退出）：
 *   cd server && MIGRATE_SOURCE=cos npm run migrate
 *   或：node scripts/migrate-json-to-pg.js --from-cos
 *
 * 强制仅本地（忽略 COS）：
 *   MIGRATE_SOURCE=local npm run migrate
 *   或：node scripts/migrate-json-to-pg.js --from-local
 *
 * 脚本幂等（ON CONFLICT DO NOTHING），可重复执行。
 */

import dotenv from "dotenv";
import { readFile, readdir } from "fs/promises";
import { join, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import pg from "pg";
import COS from "cos-nodejs-sdk-v5";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const argv = process.argv.slice(2);
const cosOnly =
  process.env.MIGRATE_SOURCE?.trim().toLowerCase() === "cos" ||
  argv.includes("--from-cos") ||
  argv.includes("--cos-only");
const localOnly =
  process.env.MIGRATE_SOURCE?.trim().toLowerCase() === "local" ||
  argv.includes("--from-local");

if (cosOnly && localOnly) {
  console.error(
    "❌ 不能同时指定 cos 与 local（MIGRATE_SOURCE 或 --from-cos / --from-local）"
  );
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error("❌ 请设置环境变量 DATABASE_URL");
  process.exit(1);
}

const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const SCHEMA_PATH = join(__dirname, "schema.sql");

// ─── COS 工具（可选，仅当配置了 COS 时才用）─────────────────────────────────

function isCosReady() {
  return !!(
    process.env.COS_SECRET_ID?.trim() &&
    process.env.COS_SECRET_KEY?.trim() &&
    process.env.COS_BUCKET?.trim() &&
    process.env.COS_REGION?.trim()
  );
}

function getCosClient() {
  return new COS({
    SecretId: process.env.COS_SECRET_ID.trim(),
    SecretKey: process.env.COS_SECRET_KEY.trim(),
  });
}

/** 从 COS 下载对象，返回 UTF-8 字符串；对象不存在返回 null */
async function cosGetText(key) {
  const cos = getCosClient();
  return new Promise((resolve, reject) => {
    cos.getObject(
      {
        Bucket: process.env.COS_BUCKET.trim(),
        Region: process.env.COS_REGION.trim(),
        Key: key,
      },
      (err, data) => {
        if (err) {
          const code = err.code ?? err.Code;
          if (err.statusCode === 404 || code === "NoSuchKey" || code === "ResourceNotFound") {
            resolve(null);
          } else {
            reject(err);
          }
          return;
        }
        const body = data.Body;
        resolve(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
      }
    );
  });
}

/** 列出 COS 指定前缀下所有对象的 key */
async function cosListKeys(prefix) {
  const cos = getCosClient();
  const keys = [];
  let marker = "";
  while (true) {
    const result = await new Promise((resolve, reject) => {
      cos.getBucket(
        {
          Bucket: process.env.COS_BUCKET.trim(),
          Region: process.env.COS_REGION.trim(),
          Prefix: prefix,
          Marker: marker,
          MaxKeys: 1000,
        },
        (err, data) => (err ? reject(err) : resolve(data))
      );
    });
    for (const obj of result.Contents ?? []) {
      keys.push(obj.Key);
    }
    if (result.IsTruncated === "true" || result.IsTruncated === true) {
      marker = result.NextMarker;
    } else {
      break;
    }
  }
  return keys;
}

// ─── 连接 PG ─────────────────────────────────────────────────────────────────

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 3,
});

async function q(sql, params = []) {
  return pool.query(sql, params);
}

// ─── 运行 schema.sql ──────────────────────────────────────────────────────────

async function runSchema() {
  console.log("📐 运行 schema.sql …");
  const sql = await readFile(SCHEMA_PATH, "utf8");
  await pool.query(sql);
  console.log("   schema 就绪");
}

// ─── 迁移用户 ─────────────────────────────────────────────────────────────────

async function migrateUsers() {
  const usersKey = process.env.COS_USERS_KEY?.trim() || "mikujar/users.json";
  let raw = null;

  if (!localOnly && isCosReady()) {
    raw = await cosGetText(usersKey);
    if (raw) {
      console.log(`📥 从 COS 读取用户 (${usersKey}) …`);
    }
  }

  if (!raw) {
    const usersFile = join(DATA_DIR, "users.json");
    try {
      raw = await readFile(usersFile, "utf8");
      console.log(`📥 从本地读取用户 (${usersFile}) …`);
    } catch (e) {
      if (e.code === "ENOENT") {
        console.log("   users：COS/本地均无 users.json，跳过用户迁移");
        return 0;
      }
      throw e;
    }
  }

  let users;
  try {
    users = JSON.parse(raw);
  } catch (e) {
    console.error("   ❌ users JSON 解析失败：", e.message);
    return 0;
  }
  if (!Array.isArray(users)) {
    console.error("   ❌ users 须为 JSON 数组");
    return 0;
  }

  let count = 0;
  for (const u of users) {
    const res = await q(
      `INSERT INTO users (id, username, password_hash, display_name, role, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        u.id,
        u.username,
        u.passwordHash ?? u.password_hash ?? "",
        u.displayName ?? u.display_name ?? "",
        u.role ?? "user",
        u.avatarUrl ?? u.avatar_url ?? "",
      ]
    );
    if (res.rowCount > 0) count++;
  }
  console.log(`   迁移用户：${count} 条（${users.length - count} 条已存在跳过）`);
  return count;
}

// ─── 平铺合集树 ───────────────────────────────────────────────────────────────

function flattenTree(userId, tree) {
  const collections = [];
  const cards = [];

  function walk(nodes, parentId) {
    nodes.forEach((col, idx) => {
      collections.push({
        id: col.id,
        user_id: userId,
        parent_id: parentId ?? null,
        name: col.name ?? "",
        dot_color: col.dotColor ?? "",
        sort_order: idx,
        hint: typeof col.hint === "string" ? col.hint : "",
      });
      const cardList = col.cards ?? col.blocks ?? [];
      cardList.forEach((card, ci) => {
        cards.push({
          id: card.id,
          collection_id: col.id,
          text: card.text ?? "",
          minutes_of_day: card.minutesOfDay ?? 0,
          added_on: card.addedOn ?? null,
          reminder_on: card.reminderOn ?? null,
          pinned: card.pinned ?? false,
          tags: card.tags ?? [],
          related_refs: card.relatedRefs ?? [],
          media: card.media ?? [],
          sort_order: ci,
        });
      });
      if (Array.isArray(col.children) && col.children.length > 0) {
        walk(col.children, col.id);
      }
    });
  }

  walk(tree, null);
  return { collections, cards };
}

// ─── 迁移单个合集（接受已解析的数组）────────────────────────────────────────

async function migrateCollectionsData(data, userId) {
  if (!Array.isArray(data) || data.length === 0) return { collections: 0, cards: 0 };

  const { collections, cards } = flattenTree(userId, data);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    let colCount = 0;
    for (const c of collections) {
      const res = await client.query(
        `INSERT INTO collections (id, user_id, parent_id, name, dot_color, sort_order, hint)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          c.user_id,
          c.parent_id,
          c.name,
          c.dot_color,
          c.sort_order,
          c.hint ?? "",
        ]
      );
      if (res.rowCount > 0) colCount++;
    }

    let cardCount = 0;
    for (const c of cards) {
      const res = await client.query(
        `INSERT INTO cards
           (id, collection_id, text, minutes_of_day, added_on, reminder_on, pinned, tags, related_refs, media, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          c.collection_id,
          c.text,
          c.minutes_of_day,
          c.added_on,
          c.reminder_on,
          c.pinned,
          c.tags,
          JSON.stringify(c.related_refs),
          JSON.stringify(c.media),
          c.sort_order,
        ]
      );
      if (res.rowCount > 0) cardCount++;
    }

    await client.query("COMMIT");
    return { collections: colCount, cards: cardCount };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function parseJsonSafe(raw, label) {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.warn(`   ⚠️  ${label} JSON 解析失败：${e.message}`);
    return null;
  }
}

/**
 * 从 COS 迁移合集树。
 * @param {{ failIfEmpty?: boolean }} opts — failIfEmpty 时 COS 无任何合集文件则 process.exit(1)
 */
async function migrateCollectionsFromCos(opts = {}) {
  const { failIfEmpty = false } = opts;
  let totalCols = 0;
  let totalCards = 0;

  console.log(`☁️  从 COS 读取合集数据…`);
  const collectionsPrefix = (
    process.env.COS_COLLECTIONS_PREFIX?.trim() || "mikujar/collections"
  ).replace(/\/$/, "");

  const keys = await cosListKeys(collectionsPrefix + "/");
  const userKeys = keys.filter((k) => k.endsWith(".json"));

  if (userKeys.length > 0) {
    console.log(`📂 找到 ${userKeys.length} 个用户合集对象`);
    for (const key of userKeys) {
      const userId = basename(key, ".json");
      const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
      if (userCheck.rowCount === 0) {
        console.log(`   ${userId}: ⚠️  users 表无此用户，跳过（请先把 users.json 放到 COS 或本地 data/）`);
        continue;
      }
      const raw = await cosGetText(key);
      if (!raw) {
        console.log(`   ${userId}: 空对象，跳过`);
        continue;
      }
      const data = await parseJsonSafe(raw, key);
      if (!data) continue;
      const { collections, cards } = await migrateCollectionsData(data, userId);
      totalCols += collections;
      totalCards += cards;
      console.log(`   ${userId}: 合集 ${collections}，卡片 ${cards}`);
    }
  }

  const legacyKey = process.env.COS_KEY?.trim() || "mikujar/collections.json";
  const legacyRaw = await cosGetText(legacyKey);
  if (legacyRaw) {
    console.log(`📂 单用户 legacy 合集 (${legacyKey}) …`);
    const data = await parseJsonSafe(legacyRaw, legacyKey);
    if (data) {
      const { collections, cards } = await migrateCollectionsData(data, null);
      totalCols += collections;
      totalCards += cards;
      console.log(`   单用户：合集 ${collections}，卡片 ${cards}`);
    }
  }

  if (userKeys.length === 0 && !legacyRaw) {
    const hint =
      "COS 中未找到合集：多用户应为 " +
      collectionsPrefix +
      "/<userId>.json，单用户为 " +
      legacyKey +
      "（可用 COS_COLLECTIONS_PREFIX / COS_KEY 修改）";
    if (failIfEmpty) {
      console.error(`❌ ${hint}`);
      process.exit(1);
    }
    console.warn(`   ⚠️  ${hint}`);
  }

  return { totalCols, totalCards };
}

async function migrateCollectionsFromLocal() {
  let totalCols = 0;
  let totalCards = 0;

  console.log("💾 从本地 server/data/ 读取合集…");

  const singleFile = join(DATA_DIR, "collections.json");
  try {
    const raw = await readFile(singleFile, "utf8");
    const data = await parseJsonSafe(raw, singleFile);
    if (data) {
      console.log("📂 单用户 collections.json …");
      const { collections, cards } = await migrateCollectionsData(data, null);
      totalCols += collections;
      totalCards += cards;
      console.log(`   合集：${collections}，卡片：${cards}`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const colDir = join(DATA_DIR, "collections");
  try {
    const files = await readdir(colDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length > 0) {
      console.log(`📂 多用户 data/collections/（${jsonFiles.length} 个文件）…`);
      for (const f of jsonFiles) {
        const userId = basename(f, ".json");
        const raw = await readFile(join(colDir, f), "utf8");
        const data = await parseJsonSafe(raw, f);
        if (!data) continue;
        const { collections, cards } = await migrateCollectionsData(data, userId);
        totalCols += collections;
        totalCards += cards;
        console.log(`   ${userId}: 合集 ${collections}，卡片 ${cards}`);
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  return { totalCols, totalCards };
}

async function main() {
  console.log("🚀 mikujar JSON → PostgreSQL 数据迁移");
  console.log(`   数据库：${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);

  if (cosOnly && !isCosReady()) {
    console.error(
      "❌ 已指定仅从 COS 迁移（MIGRATE_SOURCE=cos 或 --from-cos），但未配置完整 COS："
    );
    console.error(
      "   需要 COS_SECRET_ID、COS_SECRET_KEY、COS_BUCKET、COS_REGION（写入 server/.env）"
    );
    process.exit(1);
  }

  if (cosOnly) {
    console.log("   模式：仅 COS（合集 + 优先 COS 用户 JSON）");
  } else if (localOnly) {
    console.log("   模式：仅本地 data/（忽略 COS）");
  } else if (isCosReady()) {
    console.log("   模式：自动 — 已配置 COS，合集从 COS 迁移");
  } else {
    console.log("   模式：自动 — 未配置 COS，合集从本地迁移");
  }

  await runSchema();
  await migrateUsers();

  let totalCols = 0;
  let totalCards = 0;

  if (cosOnly) {
    const r = await migrateCollectionsFromCos({ failIfEmpty: true });
    totalCols = r.totalCols;
    totalCards = r.totalCards;
  } else if (localOnly) {
    const r = await migrateCollectionsFromLocal();
    totalCols = r.totalCols;
    totalCards = r.totalCards;
  } else if (isCosReady()) {
    const r = await migrateCollectionsFromCos({ failIfEmpty: false });
    totalCols = r.totalCols;
    totalCards = r.totalCards;
  } else {
    const r = await migrateCollectionsFromLocal();
    totalCols = r.totalCols;
    totalCards = r.totalCards;
  }

  console.log(`\n✅ 迁移完成！总计：合集 ${totalCols} 条，卡片 ${totalCards} 条`);

  await pool.end();
}

main().catch((e) => {
  console.error("❌ 迁移失败：", e.message);
  process.exit(1);
});
