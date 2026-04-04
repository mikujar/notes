#!/usr/bin/env node
/**
 * migrate-json-to-pg.js
 * 将旧版 JSON 文件数据迁移到 PostgreSQL。
 *
 * 用法：
 *   cd server && DATABASE_URL="postgresql://..." node scripts/migrate-json-to-pg.js
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
  const usersFile = join(DATA_DIR, "users.json");
  let users = [];
  try {
    const raw = await readFile(usersFile, "utf8");
    users = JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") {
      console.log("   users.json 不存在，跳过用户迁移");
      return 0;
    }
    throw e;
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
      });
      const cardList = col.cards ?? col.blocks ?? [];
      cardList.forEach((card, ci) => {
        cards.push({
          id: card.id,
          collection_id: col.id,
          text: card.text ?? "",
          minutes_of_day: card.minutesOfDay ?? 0,
          added_on: card.addedOn ?? null,
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
        `INSERT INTO collections (id, user_id, parent_id, name, dot_color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.user_id, c.parent_id, c.name, c.dot_color, c.sort_order]
      );
      if (res.rowCount > 0) colCount++;
    }

    let cardCount = 0;
    for (const c of cards) {
      const res = await client.query(
        `INSERT INTO cards
           (id, collection_id, text, minutes_of_day, added_on, pinned, tags, related_refs, media, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          c.collection_id,
          c.text,
          c.minutes_of_day,
          c.added_on,
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

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function parseJsonSafe(raw, label) {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.warn(`   ⚠️  ${label} JSON 解析失败：${e.message}`);
    return null;
  }
}

async function main() {
  console.log("🚀 mikujar JSON → PostgreSQL 数据迁移");
  console.log(`   数据库：${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);

  await runSchema();
  await migrateUsers();

  let totalCols = 0;
  let totalCards = 0;

  if (isCosReady()) {
    // ── 从 COS 读取 ──────────────────────────────────────────────────────────
    console.log(`☁️  检测到 COS 配置，从 COS 读取合集数据…`);
    const collectionsPrefix = (
      process.env.COS_COLLECTIONS_PREFIX?.trim() || "mikujar/collections"
    ).replace(/\/$/, "");

    // 多用户模式：列出 {prefix}/*.json
    const keys = await cosListKeys(collectionsPrefix + "/");
    const userKeys = keys.filter((k) => k.endsWith(".json"));

    if (userKeys.length > 0) {
      console.log(`📂 找到 ${userKeys.length} 个用户合集文件`);
      for (const key of userKeys) {
        const userId = basename(key, ".json");
        // 检查用户是否存在，孤立的合集文件直接跳过
        const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
        if (userCheck.rowCount === 0) {
          console.log(`   ${userId}: ⚠️  用户不存在，跳过（孤立数据）`);
          continue;
        }
        const raw = await cosGetText(key);
        if (!raw) { console.log(`   ${userId}: 空文件，跳过`); continue; }
        const data = await parseJsonSafe(raw, key);
        if (!data) continue;
        const { collections, cards } = await migrateCollectionsData(data, userId);
        totalCols += collections;
        totalCards += cards;
        console.log(`   ${userId}: 合集 ${collections}，卡片 ${cards}`);
      }
    }

    // 单用户 legacy：{COS_KEY} 默认 mikujar/collections.json
    const legacyKey = process.env.COS_KEY?.trim() || "mikujar/collections.json";
    const legacyRaw = await cosGetText(legacyKey);
    if (legacyRaw) {
      console.log(`📂 找到单用户 legacy 合集 (${legacyKey})…`);
      const data = await parseJsonSafe(legacyRaw, legacyKey);
      if (data) {
        const { collections, cards } = await migrateCollectionsData(data, null);
        totalCols += collections;
        totalCards += cards;
        console.log(`   单用户：合集 ${collections}，卡片 ${cards}`);
      }
    }

    if (userKeys.length === 0 && !legacyRaw) {
      console.warn("   ⚠️  COS 中未找到任何合集文件，请检查 COS_COLLECTIONS_PREFIX 配置");
    }
  } else {
    // ── 从本地文件读取（fallback）────────────────────────────────────────────
    console.log("💾 未检测到 COS 配置，从本地 data/ 目录读取…");

    // 单用户模式：data/collections.json
    const singleFile = join(DATA_DIR, "collections.json");
    try {
      const raw = await readFile(singleFile, "utf8");
      const data = await parseJsonSafe(raw, singleFile);
      if (data) {
        console.log("📂 迁移单用户合集 (collections.json) …");
        const { collections, cards } = await migrateCollectionsData(data, null);
        totalCols += collections;
        totalCards += cards;
        console.log(`   合集：${collections}，卡片：${cards}`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }

    // 多用户模式：data/collections/{userId}.json
    const colDir = join(DATA_DIR, "collections");
    try {
      const files = await readdir(colDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length > 0) {
        console.log(`📂 迁移多用户合集（${jsonFiles.length} 个用户）…`);
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
  }

  console.log(`\n✅ 迁移完成！总计：合集 ${totalCols} 条，卡片 ${totalCards} 条`);

  await pool.end();
}

main().catch((e) => {
  console.error("❌ 迁移失败：", e.message);
  process.exit(1);
});
