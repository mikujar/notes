-- Mikujar notes app — PostgreSQL schema (v2, greenfield)
--
-- One-shot apply to an empty database. NON-idempotent by design — catches
-- accidental double-apply. For existing databases, use migrate-to-v2.js instead.
--
-- Core model:
--   Layer 1  cards (base)
--   Layer 2  card_notes / card_files / card_bookmarks / card_topics /
--            card_works / card_clips / card_tasks / card_projects /
--            card_expenses / card_accounts      (all 1:1 subtables)
--   Layer 3  collections (+ card_placements)
--
-- Every card has card_type_id → card_types (type tree). card_types.kind
-- drives subtable routing. Attachments are first-class file cards linked
-- via card_links(property_key='attachment').

-- =============================================================
-- Extensions
-- =============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================
-- Functions
-- =============================================================
CREATE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================
-- Tables
-- =============================================================

-- users: accounts + monthly usage counters + prefs + deletion state
CREATE TABLE users (
  id                         TEXT PRIMARY KEY,
  username                   TEXT NOT NULL UNIQUE,
  password_hash              TEXT NOT NULL,
  display_name               TEXT NOT NULL DEFAULT '',
  role                       TEXT NOT NULL DEFAULT 'user'
                             CHECK (role IN ('admin', 'user', 'subscriber')),
  avatar_url                 TEXT NOT NULL DEFAULT '',
  avatar_thumb_url           TEXT NOT NULL DEFAULT '',
  email                      TEXT,
  usage_month                DATE,
  media_uploaded_bytes_month BIGINT NOT NULL DEFAULT 0,
  ai_assist_calls_month      INTEGER NOT NULL DEFAULT 0,
  prefs_json                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  deletion_state             TEXT NOT NULL DEFAULT 'active'
                             CHECK (deletion_state IN ('active', 'pending', 'failed')),
  deletion_attempts          INTEGER NOT NULL DEFAULT 0,
  deletion_requested_at      TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL;

-- card_types: tree of types (preset + user-defined). Schema inherits down.
CREATE TABLE card_types (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_type_id TEXT REFERENCES card_types(id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL
                 CHECK (kind IN ('note','file','bookmark','topic','work',
                                 'clip','task','project','expense','account','custom')),
  name           TEXT NOT NULL,
  schema_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_preset      BOOLEAN NOT NULL DEFAULT false,
  preset_slug    TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX card_types_user               ON card_types (user_id);
CREATE INDEX card_types_parent             ON card_types (parent_type_id) WHERE parent_type_id IS NOT NULL;
CREATE INDEX card_types_user_kind          ON card_types (user_id, kind);
CREATE UNIQUE INDEX card_types_user_preset ON card_types (user_id, preset_slug) WHERE preset_slug IS NOT NULL;

-- cards: Layer 1 base. Every card has a type.
CREATE TABLE cards (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_type_id        TEXT NOT NULL REFERENCES card_types(id) ON DELETE RESTRICT,
  title               TEXT NOT NULL DEFAULT '',
  body                TEXT NOT NULL DEFAULT '',
  added_on            DATE,
  minutes_of_day      INTEGER NOT NULL DEFAULT 0,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  custom_props        JSONB NOT NULL DEFAULT '[]'::jsonb,
  cover_thumb_url     TEXT NOT NULL DEFAULT '',
  trashed_at          TIMESTAMPTZ,
  trash_snapshot_json JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cards_user_active      ON cards (user_id)                  WHERE trashed_at IS NULL;
CREATE INDEX cards_added_on         ON cards (user_id, added_on DESC)   WHERE trashed_at IS NULL;
CREATE INDEX cards_trash            ON cards (user_id, trashed_at DESC) WHERE trashed_at IS NOT NULL;
CREATE INDEX cards_card_type        ON cards (card_type_id);
CREATE INDEX cards_created_at       ON cards (user_id, created_at DESC) WHERE trashed_at IS NULL;
CREATE INDEX cards_tags_gin         ON cards USING GIN (tags);
CREATE INDEX cards_custom_props_gin ON cards USING GIN (custom_props jsonb_path_ops);
CREATE INDEX cards_content_trgm_gin ON cards USING GIN ((title || ' ' || body) gin_trgm_ops)
                                    WHERE trashed_at IS NULL;

-- =============================================================
-- Layer 2 subtables (1:1 with cards; card_id PK+FK)
-- =============================================================

CREATE TABLE card_notes (
  card_id        TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  format         TEXT NOT NULL DEFAULT 'plain'
                 CHECK (format IN ('plain','markdown','rich')),
  rich_body_json JSONB
);

CREATE TABLE card_files (
  card_id         TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  original_name   TEXT NOT NULL DEFAULT '',
  thumb_url       TEXT NOT NULL DEFAULT '',
  cover_url       TEXT NOT NULL DEFAULT '',
  cover_thumb_url TEXT NOT NULL DEFAULT '',
  bytes           BIGINT
);

CREATE TABLE card_bookmarks (
  card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  site_name    TEXT NOT NULL DEFAULT '',
  og_title     TEXT NOT NULL DEFAULT '',
  og_image_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE card_topics (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  color   TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT ''
);

CREATE TABLE card_works (
  card_id        TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  author_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  year           INTEGER,
  medium         TEXT NOT NULL DEFAULT '',
  source_url     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX card_works_author ON card_works (author_card_id) WHERE author_card_id IS NOT NULL;

CREATE TABLE card_clips (
  card_id        TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  source_url     TEXT NOT NULL,
  source_id      TEXT NOT NULL DEFAULT '',
  author_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL
);

CREATE INDEX card_clips_source_id ON card_clips (source_id)      WHERE source_id <> '';
CREATE INDEX card_clips_author    ON card_clips (author_card_id) WHERE author_card_id IS NOT NULL;

CREATE TABLE card_tasks (
  card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('todo','doing','done','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ
);

CREATE INDEX card_tasks_active ON card_tasks (status) WHERE status IN ('todo','doing');

CREATE TABLE card_projects (
  card_id  TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  status   TEXT NOT NULL DEFAULT 'active'
           CHECK (status IN ('active','paused','done','archived')),
  start_on DATE,
  end_on   DATE
);

CREATE TABLE card_expenses (
  card_id         TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  amount_cents    BIGINT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'CNY',
  paid_on         DATE NOT NULL,
  category        TEXT NOT NULL DEFAULT '',
  account_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL
);

CREATE INDEX card_expenses_paid_on ON card_expenses (paid_on DESC);
CREATE INDEX card_expenses_account ON card_expenses (account_card_id) WHERE account_card_id IS NOT NULL;

-- Credential storage; secret_enc must be application-encrypted (never plaintext).
CREATE TABLE card_accounts (
  card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL DEFAULT '',
  username     TEXT NOT NULL DEFAULT '',
  secret_enc   TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT ''
);

-- =============================================================
-- Layer 3 grouping: collections + placements
-- =============================================================

CREATE TABLE collections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES collections(id) ON DELETE CASCADE
                DEFERRABLE INITIALLY DEFERRED,
  bound_type_id TEXT REFERENCES card_types(id) ON DELETE SET NULL,
  name          TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  dot_color     TEXT NOT NULL DEFAULT '',
  icon_shape    TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_favorite   BOOLEAN NOT NULL DEFAULT false,
  favorite_sort INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX collections_user       ON collections (user_id);
CREATE INDEX collections_parent     ON collections (parent_id);
CREATE INDEX collections_favorites  ON collections (user_id, favorite_sort) WHERE is_favorite;
CREATE INDEX collections_bound_type ON collections (bound_type_id)          WHERE bound_type_id IS NOT NULL;

CREATE TABLE card_placements (
  card_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  pinned        BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, collection_id)
);

CREATE INDEX card_placements_col  ON card_placements (collection_id);
CREATE INDEX card_placements_card ON card_placements (card_id);

-- =============================================================
-- Reminders, links, link rules
-- =============================================================

CREATE TABLE card_reminders (
  card_id        TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at         TIMESTAMPTZ NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  completed_at   TIMESTAMPTZ,
  completed_note TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX card_reminders_user_due
  ON card_reminders (user_id, due_at) WHERE completed_at IS NULL;
CREATE INDEX card_reminders_user_completed
  ON card_reminders (user_id, completed_at DESC) WHERE completed_at IS NOT NULL;

CREATE TABLE card_links (
  from_card_id   TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  property_key   TEXT NOT NULL,
  to_card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_type_id TEXT REFERENCES card_types(id) ON DELETE SET NULL,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_card_id, property_key, to_card_id),
  CHECK (from_card_id <> to_card_id)
);

CREATE INDEX card_links_to            ON card_links (to_card_id);
CREATE INDEX card_links_user          ON card_links (user_id);
CREATE INDEX card_links_target_type   ON card_links (target_type_id) WHERE target_type_id IS NOT NULL;
CREATE INDEX card_links_from_property ON card_links (from_card_id, property_key, sort_order);

-- User-defined rules driving auto-creation / auto-linking on card save.
CREATE TABLE card_link_rules (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL DEFAULT '',
  enabled              BOOLEAN NOT NULL DEFAULT true,
  source_type_id       TEXT NOT NULL REFERENCES card_types(id) ON DELETE CASCADE,
  source_property_key  TEXT NOT NULL,
  target_type_id       TEXT REFERENCES card_types(id) ON DELETE SET NULL,
  target_collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  link_property_key    TEXT NOT NULL,
  match_strategy       TEXT NOT NULL DEFAULT 'exact_title'
                       CHECK (match_strategy IN ('exact_title','contains_title','alias_tag','custom')),
  auto_create          BOOLEAN NOT NULL DEFAULT false,
  config_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX card_link_rules_user_source
  ON card_link_rules (user_id, source_type_id) WHERE enabled;

-- =============================================================
-- Email verification
-- =============================================================

CREATE TABLE email_verification_codes (
  kind        TEXT NOT NULL CHECK (kind IN ('registration', 'email_change')),
  subject_key TEXT NOT NULL,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, subject_key),
  CHECK (
    (kind = 'registration' AND user_id IS NULL)
    OR (kind = 'email_change' AND user_id IS NOT NULL)
  )
);

CREATE INDEX email_ver_codes_expires ON email_verification_codes (expires_at);

-- =============================================================
-- Triggers
-- =============================================================

CREATE TRIGGER trg_cards_updated
  BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

CREATE TRIGGER trg_collections_updated
  BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

CREATE TRIGGER trg_card_types_updated
  BEFORE UPDATE ON card_types
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

CREATE TRIGGER trg_card_link_rules_updated
  BEFORE UPDATE ON card_link_rules
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();
