-- mikujar 增量结构迁移（与 pg-migrate-incremental.js 一致，幂等、可重复执行）
-- 用法示例：
--   psql "$DATABASE_URL" -f pg-migrate-incremental.sql
-- 若报错 relation "collections" does not exist，请先对空库执行 schema.sql

-- collections.hint（合集说明）
ALTER TABLE collections ADD COLUMN IF NOT EXISTS hint TEXT NOT NULL DEFAULT '';

-- 星标并入 collections（并迁移旧 user_favorite_collections）
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

-- trashed_notes（回收站快照）
CREATE TABLE IF NOT EXISTS trashed_notes (
  trash_id       TEXT PRIMARY KEY,
  owner_key      TEXT NOT NULL,
  col_id         TEXT NOT NULL,
  col_path_label TEXT NOT NULL DEFAULT '',
  card           JSONB NOT NULL,
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trashed_notes_owner ON trashed_notes(owner_key);

-- cards.reminder_on（笔记提醒日）
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_on TEXT;

CREATE INDEX IF NOT EXISTS idx_cards_reminder_on ON cards(reminder_on);

-- users.email（邮箱注册 / 登录）
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL;

-- email_verification_codes（注册 + 换绑；kind 区分）
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

CREATE INDEX IF NOT EXISTS idx_email_ver_codes_expires ON email_verification_codes (expires_at);

-- 若库中仍有旧表，合并后删除（与 pg-migrate-incremental.js 末步一致）
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

-- 附件套餐与本月上传量（自然月 Asia/Shanghai；删除不退额度）
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_media_plan_check;
ALTER TABLE users ADD CONSTRAINT users_media_plan_check CHECK (media_plan IN ('free', 'subscriber'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_usage_month TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_uploaded_bytes_month BIGINT NOT NULL DEFAULT 0;

-- 身份三档（站长 / 普通 / 订阅），附件额度随 role；废弃 media_plan
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
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'subscriber'));

-- 侧栏等用小体积头像 WebP；原图仍在 avatar_url
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_thumb_url TEXT NOT NULL DEFAULT '';

-- 异步注销队列（与 pg-migrate-incremental.js 一致）
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_users_deletion_pending ON users (deletion_requested_at) WHERE deletion_pending = true;

-- 提醒时间（HH:mm）与提醒备注
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_time TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_note TEXT;

-- 待办勾选完成时间（ISO 8601 文本）
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_completed_at TEXT;

-- 完成时快照的提醒备注
ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminder_completed_note TEXT;

-- 「问 AI」每月调用次数（与 media 同自然月 Asia/Shanghai）
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_usage_month TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_note_assist_calls_month INTEGER NOT NULL DEFAULT 0;

-- 回收站并入 cards（与 pg-migrate-incremental.js 末步一致）
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

-- card_attachments（与 pg-migrate-incremental.js 末步一致）
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
