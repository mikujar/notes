#!/usr/bin/env node
/**
 * PostgreSQL 增量结构迁移（无需本机安装 psql）。
 * 包含：collections.hint、星标合集表、回收站表、cards.reminder_on、邮箱验证码相关表。全部幂等，可重复执行。
 *
 * 用法：
 *   cd server && npm run db:migrate
 * 或：
 *   cd server && DATABASE_URL="postgresql://..." node scripts/pg-migrate-incremental.js
 */
import dotenv from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("❌ 未设置 DATABASE_URL。请在 server/.env 中配置，或导出环境变量。");
  process.exit(1);
}

const ssl =
  process.env.PG_SSL === "false"
    ? false
    : { rejectUnauthorized: false };

const pool = new pg.Pool({
  connectionString: url,
  ssl,
  max: 1,
  connectionTimeoutMillis: 15_000,
});

const STEPS = [
  {
    label: "collections.hint（合集说明）",
    sql: `ALTER TABLE collections ADD COLUMN IF NOT EXISTS hint TEXT NOT NULL DEFAULT ''`,
  },
  {
    label: "user_favorite_collections（星标合集）",
    sql: `
CREATE TABLE IF NOT EXISTS user_favorite_collections (
  owner_key      TEXT NOT NULL,
  collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_key, collection_id)
)`,
  },
  {
    label: "idx_user_fav_col_owner",
    sql: `CREATE INDEX IF NOT EXISTS idx_user_fav_col_owner ON user_favorite_collections(owner_key)`,
  },
  {
    label: "trashed_notes（回收站快照）",
    sql: `
CREATE TABLE IF NOT EXISTS trashed_notes (
  trash_id       TEXT PRIMARY KEY,
  owner_key      TEXT NOT NULL,
  col_id         TEXT NOT NULL,
  col_path_label TEXT NOT NULL DEFAULT '',
  card           JSONB NOT NULL,
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  },
  {
    label: "idx_trashed_notes_owner",
    sql: `CREATE INDEX IF NOT EXISTS idx_trashed_notes_owner ON trashed_notes(owner_key)`,
  },
  {
    label: "cards.reminder_on（笔记提醒日）",
    sql: `ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_on TEXT`,
  },
  {
    label: "idx_cards_reminder_on",
    sql: `CREATE INDEX IF NOT EXISTS idx_cards_reminder_on ON cards(reminder_on)`,
  },
  {
    label: "users.email（邮箱注册 / 登录）",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
  },
  {
    label: "users_email_unique（邮箱唯一，允许多条 NULL）",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL`,
  },
  {
    label: "email_registration_codes",
    sql: `
CREATE TABLE IF NOT EXISTS email_registration_codes (
  email        TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  },
  {
    label: "email_change_codes（个人中心换绑邮箱验证码）",
    sql: `
CREATE TABLE IF NOT EXISTS email_change_codes (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  },
  {
    label: "users.media_plan / media_usage_month / media_uploaded_bytes_month",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_media_plan_check;
ALTER TABLE users ADD CONSTRAINT users_media_plan_check CHECK (media_plan IN ('free', 'subscriber'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_usage_month TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_uploaded_bytes_month BIGINT NOT NULL DEFAULT 0`,
  },
  {
    label: "users.role 三档并移除 media_plan",
    sql: `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'media_plan'
  ) THEN
    UPDATE users SET role = 'subscriber' WHERE role = 'user' AND media_plan = 'subscriber';
  END IF;
END $$;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_media_plan_check;
ALTER TABLE users DROP COLUMN IF EXISTS media_plan;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'subscriber'))`,
  },
  {
    label: "users.avatar_thumb_url（侧栏用压缩头像）",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_thumb_url TEXT NOT NULL DEFAULT ''`,
  },
  {
    label: "cards.reminder_time / reminder_note（提醒时间与备注）",
    sql: `
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_time TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_note TEXT`,
  },
  {
    label: "users.deletion_pending / deletion_requested_at（异步注销队列）",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_users_deletion_pending ON users (deletion_requested_at) WHERE deletion_pending = true`,
  },
  {
    label: "cards.reminder_completed_at（待办完成时间）",
    sql: `ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_completed_at TEXT`,
  },
  {
    label: "cards.reminder_completed_note（完成时提醒备注快照）",
    sql: `ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_completed_note TEXT`,
  },
  {
    label: "users.ai_usage_month / ai_note_assist_calls_month（问 AI 月额度）",
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_usage_month TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_note_assist_calls_month INTEGER NOT NULL DEFAULT 0`,
  },
];

async function main() {
  const redacted = url.replace(/:([^:@]+)@/, ":***@");
  console.log("📦 增量迁移（hint + 星标 + 回收站 + 提醒 + 邮箱）");
  console.log(`   ${redacted}\n`);

  for (const { label, sql } of STEPS) {
    try {
      await pool.query(sql);
      console.log(`✅ ${label}`);
    } catch (e) {
      console.error(`❌ 失败: ${label}`);
      console.error(e.message ?? e);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode === 1) {
    console.error(
      "\n若提示 relation \"collections\" does not exist，请先对空库执行 server/scripts/schema.sql（整库建表）。"
    );
  } else {
    console.log("\n✅ 全部完成（已存在的对象会自动跳过）。");
  }

  await pool.end();
}

main();
