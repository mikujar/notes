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
    label:
      "collections.is_favorite / favorite_sort（星标并入合集表；迁移旧 junction）",
    sql: `
ALTER TABLE collections ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE collections ADD COLUMN IF NOT EXISTS favorite_sort INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_collections_user_favorites
  ON collections (user_id, favorite_sort)
  WHERE is_favorite = true;

DO $$
BEGIN
  IF to_regclass('public.user_favorite_collections') IS NOT NULL THEN
    UPDATE collections c
    SET is_favorite = true,
        favorite_sort = s.rn
    FROM (
      SELECT ufc.collection_id,
             (ROW_NUMBER() OVER (PARTITION BY ufc.owner_key ORDER BY ufc.created_at ASC) - 1)::int AS rn,
             ufc.owner_key
      FROM user_favorite_collections ufc
    ) s
    WHERE c.id = s.collection_id
      AND (
        (s.owner_key = '__single__' AND c.user_id IS NULL)
        OR (c.user_id IS NOT NULL AND c.user_id = s.owner_key)
      );
    DROP TABLE user_favorite_collections;
  END IF;
END $$;
`,
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
    label:
      "email_verification_codes（注册 + 换绑；旧库由后续步骤从两表合并）",
    sql: `
CREATE TABLE IF NOT EXISTS email_verification_codes (
  kind         TEXT NOT NULL CHECK (kind IN ('registration', 'email_change')),
  subject_key  TEXT NOT NULL,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, subject_key),
  CONSTRAINT chk_email_ver_codes_user CHECK (
    (kind = 'registration' AND user_id IS NULL)
    OR (kind = 'email_change' AND user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_email_ver_codes_expires ON email_verification_codes (expires_at)`,
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
  {
    label:
      "card_placements + cards.user_id（多合集归属；删合集不删笔记）",
    sql: `
CREATE TABLE IF NOT EXISTS card_placements (
  card_id         TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  pinned          BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, collection_id)
);
CREATE INDEX IF NOT EXISTS idx_card_placements_col ON card_placements(collection_id);
CREATE INDEX IF NOT EXISTS idx_card_placements_card ON card_placements(card_id);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cards' AND column_name = 'collection_id'
  ) THEN
    UPDATE cards c
    SET user_id = col.user_id
    FROM collections col
    WHERE c.collection_id = col.id;

    INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
    SELECT id, collection_id, COALESCE(pinned, false), COALESCE(sort_order, 0)
    FROM cards
    ON CONFLICT (card_id, collection_id) DO NOTHING;

    ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_collection_id_fkey;
    DROP INDEX IF EXISTS idx_cards_collection_id;
    ALTER TABLE cards DROP COLUMN IF EXISTS collection_id;
    ALTER TABLE cards DROP COLUMN IF EXISTS pinned;
    ALTER TABLE cards DROP COLUMN IF EXISTS sort_order;
  END IF;
END $$;
`,
  },
  {
    label:
      "legacy email_*_codes → email_verification_codes（一次性迁移旧表）",
    sql: `
DO $$
BEGIN
  IF to_regclass('public.email_registration_codes') IS NOT NULL THEN
    INSERT INTO email_verification_codes (kind, subject_key, email, code_hash, expires_at, user_id, created_at)
    SELECT 'registration', email, email, code_hash, expires_at, NULL, created_at
    FROM email_registration_codes
    ON CONFLICT (kind, subject_key) DO NOTHING;
    DROP TABLE email_registration_codes;
  END IF;
  IF to_regclass('public.email_change_codes') IS NOT NULL THEN
    INSERT INTO email_verification_codes (kind, subject_key, email, code_hash, expires_at, user_id, created_at)
    SELECT 'email_change', user_id, email, code_hash, expires_at, user_id, created_at
    FROM email_change_codes
    ON CONFLICT (kind, subject_key) DO NOTHING;
    DROP TABLE email_change_codes;
  END IF;
END $$;
`,
  },
  {
    label: "回收站并入 cards（trashed_at；迁移后删 trashed_notes）",
    sql: `
ALTER TABLE cards ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS trash_col_id TEXT NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS trash_col_path_label TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cards_user_trashed
  ON cards (user_id, trashed_at DESC)
  WHERE trashed_at IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.trashed_notes') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO cards (
    id, user_id, text, minutes_of_day, added_on,
    reminder_on, reminder_time, reminder_note, reminder_completed_at, reminder_completed_note,
    tags, related_refs, media,
    trashed_at, trash_col_id, trash_col_path_label
  )
  SELECT
    trim(t.card->>'id'),
    CASE
      WHEN COALESCE(BTRIM(t.owner_key), '') IN ('', '__single__') THEN NULL
      WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = t.owner_key) THEN t.owner_key
      ELSE NULL
    END,
    COALESCE(t.card->>'text', ''),
    CASE
      WHEN (t.card->>'minutesOfDay') ~ '^-?[0-9]+$'
      THEN (t.card->>'minutesOfDay')::integer
      ELSE 0
    END,
    NULLIF(t.card->>'addedOn', ''),
    NULLIF(t.card->>'reminderOn', ''),
    NULLIF(t.card->>'reminderTime', ''),
    NULLIF(t.card->>'reminderNote', ''),
    NULLIF(t.card->>'reminderCompletedAt', ''),
    NULLIF(t.card->>'reminderCompletedNote', ''),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(t.card->'tags', '[]'::jsonb))),
      '{}'::text[]
    ),
    COALESCE(t.card->'relatedRefs', '[]'::jsonb),
    COALESCE(t.card->'media', '[]'::jsonb),
    t.deleted_at,
    t.col_id,
    t.col_path_label
  FROM (
    SELECT DISTINCT ON (trim(t.card->>'id'))
      t.*
    FROM trashed_notes t
    WHERE t.card->>'id' IS NOT NULL
      AND length(trim(t.card->>'id')) > 0
    ORDER BY trim(t.card->>'id'), t.deleted_at DESC NULLS LAST
  ) t
  WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = trim(t.card->>'id'));

  UPDATE cards c
  SET
    trashed_at = COALESCE(c.trashed_at, t.deleted_at),
    trash_col_id = COALESCE(c.trash_col_id, t.col_id),
    trash_col_path_label = CASE
      WHEN c.trash_col_path_label = '' THEN t.col_path_label
      ELSE c.trash_col_path_label
    END
  FROM (
    SELECT DISTINCT ON (trim(t.card->>'id'))
      t.*
    FROM trashed_notes t
    WHERE t.card->>'id' IS NOT NULL
      AND length(trim(t.card->>'id')) > 0
    ORDER BY trim(t.card->>'id'), t.deleted_at DESC NULLS LAST
  ) t
  WHERE c.id = trim(t.card->>'id')
    AND (
      (t.owner_key = '__single__' AND c.user_id IS NULL)
      OR (c.user_id IS NOT NULL AND c.user_id = t.owner_key)
      OR (
        COALESCE(BTRIM(t.owner_key), '') NOT IN ('', '__single__')
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.owner_key)
      )
    );

  DELETE FROM card_placements p
  USING trashed_notes t
  WHERE p.card_id = trim(t.card->>'id');

  DROP TABLE trashed_notes;
END $$;

DROP INDEX IF EXISTS idx_trashed_notes_owner;
`,
  },
  {
    label: "card_attachments（附件行表 + 与 cards.media 同步触发器）",
    sql: `
CREATE TABLE IF NOT EXISTS card_attachments (
  id              BIGSERIAL PRIMARY KEY,
  card_id         TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  url             TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  thumbnail_url   TEXT NOT NULL DEFAULT '',
  cover_url       TEXT NOT NULL DEFAULT '',
  size_bytes      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_card_attachments_card ON card_attachments(card_id);
CREATE INDEX IF NOT EXISTS idx_card_attachments_user ON card_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_card_attachments_kind ON card_attachments(kind);

CREATE OR REPLACE FUNCTION sync_card_attachments_from_cards_media()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.media, '[]'::jsonb) IS NOT DISTINCT FROM COALESCE(NEW.media, '[]'::jsonb) THEN
    RETURN NEW;
  END IF;
  DELETE FROM card_attachments WHERE card_id = NEW.id;
  INSERT INTO card_attachments (
    card_id, user_id, sort_order, kind, url, name, thumbnail_url, cover_url, size_bytes
  )
  SELECT
    NEW.id,
    NEW.user_id,
    (t.ord - 1)::integer,
    CASE
      WHEN (t.elem->>'kind') IN ('image', 'video', 'audio', 'file') THEN t.elem->>'kind'
      ELSE 'file'
    END,
    COALESCE(NULLIF(trim(t.elem->>'url'), ''), ''),
    COALESCE(t.elem->>'name', ''),
    COALESCE(t.elem->>'thumbnailUrl', ''),
    COALESCE(t.elem->>'coverUrl', ''),
    CASE
      WHEN (t.elem->>'sizeBytes') ~ '^[0-9]+$' THEN (t.elem->>'sizeBytes')::bigint
      ELSE NULL
    END
  FROM jsonb_array_elements(COALESCE(NEW.media, '[]'::jsonb))
    WITH ORDINALITY AS t(elem, ord)
  WHERE COALESCE(NULLIF(trim(t.elem->>'url'), ''), '') <> '';
  RETURN NEW;
END;
$$;

INSERT INTO card_attachments (
  card_id, user_id, sort_order, kind, url, name, thumbnail_url, cover_url, size_bytes
)
SELECT
  c.id,
  c.user_id,
  (t.ord - 1)::integer,
  CASE
    WHEN (t.elem->>'kind') IN ('image', 'video', 'audio', 'file') THEN t.elem->>'kind'
    ELSE 'file'
  END,
  COALESCE(NULLIF(trim(t.elem->>'url'), ''), ''),
  COALESCE(t.elem->>'name', ''),
  COALESCE(t.elem->>'thumbnailUrl', ''),
  COALESCE(t.elem->>'coverUrl', ''),
  CASE
    WHEN (t.elem->>'sizeBytes') ~ '^[0-9]+$' THEN (t.elem->>'sizeBytes')::bigint
    ELSE NULL
  END
FROM cards c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.media, '[]'::jsonb))
  WITH ORDINALITY AS t(elem, ord)
WHERE c.trashed_at IS NULL
  AND COALESCE(NULLIF(trim(t.elem->>'url'), ''), '') <> ''
ON CONFLICT (card_id, sort_order) DO NOTHING;

DROP TRIGGER IF EXISTS trg_cards_sync_attachments ON cards;
CREATE TRIGGER trg_cards_sync_attachments
  AFTER INSERT OR UPDATE ON cards
  FOR EACH ROW EXECUTE PROCEDURE sync_card_attachments_from_cards_media();
`,
  },
  {
    label: "cards.custom_props（笔记自定义属性）",
    sql: `ALTER TABLE cards ADD COLUMN IF NOT EXISTS custom_props JSONB NOT NULL DEFAULT '[]'::jsonb`,
  },
  {
    label: "card_attachments.duration_sec + 同步触发器（媒体 JSON durationSec）",
    sql: `
ALTER TABLE card_attachments ADD COLUMN IF NOT EXISTS duration_sec DOUBLE PRECISION;

CREATE OR REPLACE FUNCTION sync_card_attachments_from_cards_media()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.media, '[]'::jsonb) IS NOT DISTINCT FROM COALESCE(NEW.media, '[]'::jsonb) THEN
    RETURN NEW;
  END IF;
  DELETE FROM card_attachments WHERE card_id = NEW.id;
  INSERT INTO card_attachments (
    card_id, user_id, sort_order, kind, url, name, thumbnail_url, cover_url, size_bytes, duration_sec
  )
  SELECT
    NEW.id,
    NEW.user_id,
    (t.ord - 1)::integer,
    CASE
      WHEN (t.elem->>'kind') IN ('image', 'video', 'audio', 'file') THEN t.elem->>'kind'
      ELSE 'file'
    END,
    COALESCE(NULLIF(trim(t.elem->>'url'), ''), ''),
    COALESCE(t.elem->>'name', ''),
    COALESCE(t.elem->>'thumbnailUrl', ''),
    COALESCE(t.elem->>'coverUrl', ''),
    CASE
      WHEN (t.elem->>'sizeBytes') ~ '^[0-9]+$' THEN (t.elem->>'sizeBytes')::bigint
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(t.elem->'durationSec') = 'number'
        THEN (t.elem->>'durationSec')::double precision
      WHEN (t.elem->>'durationSec') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN (t.elem->>'durationSec')::double precision
      ELSE NULL
    END
  FROM jsonb_array_elements(COALESCE(NEW.media, '[]'::jsonb))
    WITH ORDINALITY AS t(elem, ord)
  WHERE COALESCE(NULLIF(trim(t.elem->>'url'), ''), '') <> '';
  RETURN NEW;
END;
$$;
`,
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
