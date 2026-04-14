-- mikujar 增量结构迁移（与 pg-migrate-incremental.js 一致，幂等、可重复执行）
-- 用法示例：
--   psql "$DATABASE_URL" -f pg-migrate-incremental.sql
-- 若报错 relation "collections" does not exist，请先对空库执行 schema.sql

-- collections.hint（合集说明）
ALTER TABLE collections ADD COLUMN IF NOT EXISTS hint TEXT NOT NULL DEFAULT '';

-- user_favorite_collections（星标合集）
CREATE TABLE IF NOT EXISTS user_favorite_collections (
  owner_key      TEXT NOT NULL,
  collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_key, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_user_fav_col_owner ON user_favorite_collections(owner_key);

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

-- email_registration_codes
CREATE TABLE IF NOT EXISTS email_registration_codes (
  email        TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- email_change_codes（个人中心换绑邮箱验证码）
CREATE TABLE IF NOT EXISTS email_change_codes (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
