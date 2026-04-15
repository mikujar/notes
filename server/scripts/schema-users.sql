-- 仅用户表：供 import-users-json-to-pg.js --schema 使用
-- 无需 pgcrypto；合集/卡片见 schema.sql 或 migrate-json-to-pg.js

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'subscriber')),
  avatar_url    TEXT NOT NULL DEFAULT '',
  media_usage_month           TEXT NOT NULL DEFAULT '',
  media_uploaded_bytes_month  BIGINT NOT NULL DEFAULT 0,
  ai_usage_month                TEXT NOT NULL DEFAULT '',
  ai_note_assist_calls_month    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
