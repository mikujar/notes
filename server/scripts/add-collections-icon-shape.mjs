#!/usr/bin/env node
/**
 * One-off migration: add `icon_shape` TEXT NOT NULL DEFAULT '' to `collections`.
 * Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node server/scripts/add-collections-icon-shape.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL 未配置");
  process.exit(1);
}

const ssl =
  process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false };
const client = new pg.Client({ connectionString: url, ssl });

await client.connect();
try {
  await client.query(
    `ALTER TABLE collections
       ADD COLUMN IF NOT EXISTS icon_shape TEXT NOT NULL DEFAULT ''`
  );
  console.log("[migrate] collections.icon_shape 列已就绪");
} finally {
  await client.end();
}
