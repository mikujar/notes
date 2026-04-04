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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 合集表（替代 JSON 内 Collection 对象）──────────────────────────────
-- user_id = NULL 表示单用户模式（adminGateEnabled = false）
-- parent_id 自引用 DEFERRABLE INITIALLY DEFERRED：批量插入时无需关心顺序
CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES collections(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  name        TEXT NOT NULL DEFAULT '',
  dot_color   TEXT NOT NULL DEFAULT '',
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
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_card_upd
  BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
