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
