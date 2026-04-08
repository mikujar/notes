-- mikujar PostgreSQL schema
-- 幂等：全部使用 IF NOT EXISTS / OR REPLACE，可重复执行

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 用户表（替代 data/users.json）─────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  avatar_url    TEXT NOT NULL DEFAULT '',
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL;

-- ─── 合集表（替代 JSON 内 Collection 对象）──────────────────────────────
-- user_id = NULL 表示单用户模式（adminGateEnabled = false）
-- parent_id 自引用 DEFERRABLE INITIALLY DEFERRED：批量插入时无需关心顺序
CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES collections(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  name        TEXT NOT NULL DEFAULT '',
  dot_color   TEXT NOT NULL DEFAULT '',
  hint        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collections_user_id   ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_parent_id ON collections(parent_id);

-- ─── 卡片表（替代 JSON 内 NoteCard 对象）───────────────────────────────
-- user_id 通过 collections 级联删除；查询时须先验证 collection 属于目标用户
CREATE TABLE IF NOT EXISTS cards (
  id              TEXT PRIMARY KEY,
  collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  text            TEXT NOT NULL DEFAULT '',
  minutes_of_day  INTEGER NOT NULL DEFAULT 0,
  added_on        TEXT,                          -- YYYY-MM-DD 字符串，保留原格式
  reminder_on     TEXT,                          -- 提醒日期 YYYY-MM-DD；可与 added_on 不同
  pinned          BOOLEAN NOT NULL DEFAULT false,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  related_refs    JSONB NOT NULL DEFAULT '[]',   -- [{colId, cardId}]
  media           JSONB NOT NULL DEFAULT '[]',   -- [{url, kind, name?, coverUrl?}]
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cards_collection_id ON cards(collection_id);
CREATE INDEX IF NOT EXISTS idx_cards_added_on      ON cards(added_on);
CREATE INDEX IF NOT EXISTS idx_cards_reminder_on   ON cards(reminder_on);

-- ─── 自动更新 updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_col_upd  ON collections;
DROP TRIGGER IF EXISTS trg_card_upd ON cards;

CREATE TRIGGER trg_col_upd
  BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

CREATE TRIGGER trg_card_upd
  BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

-- ─── 侧栏星标合集（按 owner_key 隔离；多用户为 JWT sub，单用户模式为 __single__）────
CREATE TABLE IF NOT EXISTS user_favorite_collections (
  owner_key      TEXT NOT NULL,
  collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_key, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_user_fav_col_owner ON user_favorite_collections(owner_key);

-- ─── 垃圾桶：删除的卡片快照（col_id 不设 FK，合集已删时仍可展示/尝试恢复）────────
CREATE TABLE IF NOT EXISTS trashed_notes (
  trash_id       TEXT PRIMARY KEY,
  owner_key      TEXT NOT NULL,
  col_id         TEXT NOT NULL,
  col_path_label TEXT NOT NULL DEFAULT '',
  card           JSONB NOT NULL,
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trashed_notes_owner ON trashed_notes(owner_key);

-- ─── 邮箱验证码 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_registration_codes (
  email        TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_change_codes (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
