/**
 * storage-pg.js (v2, Stage A)
 * PostgreSQL 数据访问层：CRUD over 新 schema（cards / card_types / collections /
 * card_placements / card_reminders / card_links / card_files + 子表）。
 *
 * Stage A 只覆盖核心 CRUD（集合/卡片/归属/星标/偏好）。附件分页、回收站、图谱、
 * 自动链规则等见 Stage B/C/D。未实现的导出以 notImplemented(stage) 兜底，
 * 让 index.js 在访问这些路径时快速失败。
 *
 * API 契约尽量保持与旧版一致（rowToCard/rowToCollection 的字段名），
 * 以便前端无需改动。内部则走新 schema；object_kind 等旧字符串通过
 * card_types.preset_slug 回推。
 */

import { query, getClient } from "./db.js";
import { PRESET_TREE, seedPresetCardTypesForUser } from "./cardTypePresets.js";

// ─────────────────────────────────────────────────────────────────────────────
// 常量与小工具
// ─────────────────────────────────────────────────────────────────────────────

const LOOSE_NOTES_COLLECTION_ID = "__loose_notes";
const LOOSE_NOTES_DOT_COLOR = "#a8a29e";

/**
 * object_kind 字符串 ↔ preset_slug 是恒等映射：cardTypePresets.js 已与前端 catalog
 * 1:1 对齐。任何前端传来的非空 objectKind 都直接当 slug 使用；resolvePresetCardTypeId
 * 会校验是否真的在 catalog 里（不在则按需种子）。
 */
function objectKindToSlugInternal(s) {
  const v = String(s || "").trim();
  return v ? v : "note";
}
const SLUG_TO_OBJECT_KIND = new Proxy(
  {},
  { get: (_t, k) => (typeof k === "string" ? k : undefined) }
);

/** 文件子类 preset_slug → 旧 media.kind 字符串 */
const FILE_SLUG_TO_MEDIA_KIND = {
  file_image: "image",
  file_video: "video",
  file_audio: "audio",
  file_document: "file",
  file_other: "file",
};
const MEDIA_KIND_TO_FILE_SLUG = {
  image: "file_image",
  video: "file_video",
  audio: "file_audio",
  file: "file_document",
};

/** Stage A 未实现的导出统一用这个抛出，定位清晰。 */
function notImplemented(stage, name) {
  return async (..._args) => {
    throw new Error(`[storage-pg v2] ${name} not implemented (deferred to ${stage})`);
  };
}

/** @param {import("pg").PoolClient} client */
async function safeRollback(client) {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* ignore */
  }
}

function stripExtFilename(s) {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) return "";
  const i = t.lastIndexOf(".");
  if (i <= 0 || i >= t.length - 1) return t;
  return t.slice(0, i);
}

/** 前端 object_kind 字符串 → preset_slug；恒等（slug 与 catalog 已 1:1 对齐）。 */
function objectKindToSlug(objectKind) {
  return objectKindToSlugInternal(objectKind);
}

/** preset_slug → 前端 object_kind；恒等。 */
function slugToLegacyObjectKind(slug) {
  return slug && typeof slug === "string" ? slug : "note";
}

// ─────────────────────────────────────────────────────────────────────────────
// user / card_type 解析
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 在新 schema 下 user_id 必非空；若 caller 传 null（单用户模式遗留），
 * 回退到"第一个 admin"用户。缓存到模块级避免每次查库。
 */
let cachedFallbackUserId = null;
async function resolveUserId(userId, qFn) {
  if (userId && typeof userId === "string") return userId;
  if (cachedFallbackUserId) return cachedFallbackUserId;
  const q = qFn || query;
  const r = await q(
    `SELECT id FROM users WHERE deletion_state = 'active'
      ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1`
  );
  if (r.rowCount === 0) throw new Error("no active user in DB");
  cachedFallbackUserId = r.rows[0].id;
  return cachedFallbackUserId;
}

/** 按 preset_slug 查用户的 card_type_id；缺失则自动种子一次。 */
async function resolvePresetCardTypeId(userId, slug, client) {
  if (!slug) slug = "note";
  const q = client ? (sql, params) => client.query(sql, params) : query;
  let r = await q(
    `SELECT id FROM card_types WHERE user_id = $1 AND preset_slug = $2`,
    [userId, slug]
  );
  if (r.rows[0]) return r.rows[0].id;
  // 预设缺失：为该用户补齐一次
  if (client) {
    await seedPresetCardTypesForUser(userId, client);
  } else {
    const c = await getClient();
    try {
      await c.query("BEGIN");
      await seedPresetCardTypesForUser(userId, c);
      await c.query("COMMIT");
    } catch (e) {
      await safeRollback(c);
      throw e;
    } finally {
      c.release();
    }
  }
  r = await q(
    `SELECT id FROM card_types WHERE user_id = $1 AND preset_slug = $2`,
    [userId, slug]
  );
  if (!r.rows[0]) throw new Error(`preset card_type '${slug}' not found after seeding`);
  return r.rows[0].id;
}

// ─────────────────────────────────────────────────────────────────────────────
// row → API 形状
// ─────────────────────────────────────────────────────────────────────────────

/** 从 cards + card_types.preset_slug + 附带读入的 media/reminder/relatedRefs 拼 API 卡。 */
function assembleCardRow(r, extras) {
  const slug = r.preset_slug || "note";
  const legacyKind = slugToLegacyObjectKind(slug);
  const rem = extras?.reminders?.get(r.id);
  const media = extras?.mediaByCard?.get(r.id) ?? [];
  const related = extras?.relatedByCard?.get(r.id) ?? [];
  // 反向关联：person 卡的 sf-person-works 自动包含所有指向它的 creator/source 卡
  let mergedCustomProps = Array.isArray(r.custom_props) ? r.custom_props : [];
  if (slug === "person") {
    const works = extras?.personWorksByCard?.get(r.id) ?? [];
    if (works.length > 0) {
      mergedCustomProps = mergedCustomProps.slice();
      const idx = mergedCustomProps.findIndex((p) => p?.id === "sf-person-works");
      const prop = {
        id: "sf-person-works",
        name: "作品",
        type: "cardLinks",
        value: works,
      };
      if (idx >= 0) mergedCustomProps[idx] = prop;
      else mergedCustomProps.push(prop);
    }
  }
  // 反向关联：file 卡的 sf-file-source 指向它的"宿主卡"（剪藏 / 笔记 等）
  if (kindFromSlug(slug) === "file") {
    const src = extras?.fileSourceByCard?.get(r.id);
    if (src) {
      mergedCustomProps = mergedCustomProps.slice();
      const idx = mergedCustomProps.findIndex((p) => p?.id === "sf-file-source");
      const prop = {
        id: "sf-file-source",
        name: "来源",
        type: "cardLink",
        value: src,
      };
      if (idx >= 0) mergedCustomProps[idx] = prop;
      else mergedCustomProps.push(prop);
    }
  }
  const out = {
    id: r.id,
    // 旧 API 期望 text = 正文；我们把 title+body 都暴露，但保留 text 兼容
    text: r.body ?? "",
    ...(r.title ? { title: r.title } : {}),
    minutesOfDay: r.minutes_of_day,
    addedOn: r.added_on ?? undefined,
    pinned: r.pinned ?? false,
    tags: r.tags ?? [],
    relatedRefs: related,
    media,
    ...(legacyKind !== "note" ? { objectKind: legacyKind } : {}),
    ...(mergedCustomProps.length > 0 ? { customProps: mergedCustomProps } : {}),
  };
  if (rem) {
    if (rem.due_at) {
      const iso = new Date(rem.due_at).toISOString();
      out.reminderOn = iso.slice(0, 10);
      out.reminderTime = iso.slice(11, 16);
    }
    if (rem.note) out.reminderNote = rem.note;
    if (rem.completed_at) {
      out.reminderCompletedAt = new Date(rem.completed_at).toISOString();
    }
    if (rem.completed_note) out.reminderCompletedNote = rem.completed_note;
  }
  return out;
}

function rowToCollection(r) {
  // cardSchema / presetTypeId / isCategory 需从 bound_type 派生
  const out = {
    id: r.id,
    name: r.name,
    dotColor: r.dot_color,
    parentId: r.parent_id ?? undefined,
    sortOrder: r.sort_order,
  };
  const shape = String(r.icon_shape ?? "").trim();
  if (shape) out.iconShape = shape;
  const desc = String(r.description ?? "").trim();
  if (desc) out.hint = desc;
  if (r.bound_type_id) {
    out.isCategory = true;
    if (r.bound_card_schema && typeof r.bound_card_schema === "object") {
      // Only emit if non-empty
      if (Object.keys(r.bound_card_schema).length > 0) {
        out.cardSchema = r.bound_card_schema;
      }
    }
    if (r.bound_preset_slug) {
      const legacy = mapPresetSlugToLegacyPresetTypeId(r.bound_preset_slug);
      if (legacy) out.presetTypeId = legacy;
    }
  }
  return out;
}

/**
 * preset_slug 直接就是前端 catalog 的 preset_type_id（恒等）。
 * 保留此函数名以减少调用点改动。
 */
function mapPresetSlugToLegacyPresetTypeId(slug) {
  return slug || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量装配：reminders / media / relatedRefs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * file 卡的 "来源" 反向引用：哪张卡通过 attachment 链引用了它。
 * 取首条入站 attachment 链（一卡一个主源即可），转成 { colId, cardId }。
 */
async function loadFileSourceForCards(fileCardIds, q) {
  const out = new Map();
  if (!fileCardIds.length) return out;
  const r = await q(
    `SELECT DISTINCT ON (l.to_card_id) l.to_card_id AS file_id, l.from_card_id AS source_id
       FROM card_links l
       JOIN cards c ON c.id = l.from_card_id AND c.trashed_at IS NULL
      WHERE l.to_card_id = ANY($1) AND l.property_key = 'attachment'
      ORDER BY l.to_card_id, l.sort_order ASC, l.from_card_id ASC`,
    [fileCardIds]
  );
  const sourceIds = [...new Set(r.rows.map((x) => x.source_id))];
  const placement = new Map();
  if (sourceIds.length) {
    const pr = await q(
      `SELECT DISTINCT ON (card_id) card_id, collection_id
         FROM card_placements WHERE card_id = ANY($1)
        ORDER BY card_id, sort_order ASC, collection_id ASC`,
      [sourceIds]
    );
    for (const row of pr.rows) placement.set(row.card_id, row.collection_id);
  }
  for (const row of r.rows) {
    const colId = placement.get(row.source_id);
    if (!colId) continue;
    out.set(row.file_id, { colId, cardId: row.source_id });
  }
  return out;
}

/**
 * person 卡的 "作品" 反向引用：
 * 收集所有指向 person 的入站 card_links（property_key='creator' 或 'source'），
 * 按 person_id 分组，每条产出 { colId, cardId } 形式（colId 取源卡主 placement）。
 */
async function loadPersonWorksForCards(personCardIds, q) {
  const out = new Map();
  if (!personCardIds.length) return out;
  for (const id of personCardIds) out.set(id, []);
  const r = await q(
    `SELECT l.to_card_id AS person_id, l.from_card_id AS work_card_id
       FROM card_links l
       JOIN cards c ON c.id = l.from_card_id AND c.trashed_at IS NULL
      WHERE l.to_card_id = ANY($1) AND l.property_key IN ('creator','source')`,
    [personCardIds]
  );
  const fromIds = [...new Set(r.rows.map((x) => x.work_card_id))];
  const placement = new Map();
  if (fromIds.length) {
    const pr = await q(
      `SELECT DISTINCT ON (card_id) card_id, collection_id
         FROM card_placements WHERE card_id = ANY($1)
        ORDER BY card_id, sort_order ASC, collection_id ASC`,
      [fromIds]
    );
    for (const row of pr.rows) placement.set(row.card_id, row.collection_id);
  }
  for (const row of r.rows) {
    const colId = placement.get(row.work_card_id);
    if (!colId) continue;
    out.get(row.person_id).push({ colId, cardId: row.work_card_id });
  }
  // 去重
  for (const [pid, arr] of out) {
    const seen = new Set();
    out.set(
      pid,
      arr.filter((x) => {
        const k = `${x.colId}|${x.cardId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
    );
  }
  return out;
}

async function loadRemindersForCards(cardIds, q) {
  const out = new Map();
  if (!cardIds.length) return out;
  const r = await q(
    `SELECT card_id, due_at, note, completed_at, completed_note
       FROM card_reminders WHERE card_id = ANY($1)`,
    [cardIds]
  );
  for (const row of r.rows) out.set(row.card_id, row);
  return out;
}

/**
 * media 从 card_links(property_key='attachment') JOIN card_files 取。
 * 返回 Map<fromCardId, mediaArray>
 */
async function loadMediaForCards(cardIds, q) {
  const out = new Map();
  if (!cardIds.length) return out;

  // (a) note 引用的附件 —— 以 attachment 链 sort_order 为准（与写入顺序一致）
  const r = await q(
    `SELECT l.from_card_id AS owner_id, l.sort_order AS link_sort,
            f.url, f.original_name, f.thumb_url, f.cover_url, f.cover_thumb_url, f.bytes,
            ct.preset_slug AS target_slug,
            c.custom_props AS target_custom_props,
            c.created_at AS target_created_at
       FROM card_links l
       JOIN cards c      ON c.id = l.to_card_id AND c.trashed_at IS NULL
       JOIN card_types ct ON ct.id = c.card_type_id
       JOIN card_files f ON f.card_id = c.id
      WHERE l.from_card_id = ANY($1) AND l.property_key = 'attachment'
      ORDER BY l.from_card_id, l.sort_order ASC, c.created_at DESC`,
    [cardIds]
  );

  // (b) 文件卡自身：把 card_files 行也作为 media[0] 暴露给前端，让视频/图片能直接展示
  const r2 = await q(
    `SELECT c.id AS owner_id, 0 AS link_sort,
            f.url, f.original_name, f.thumb_url, f.cover_url, f.cover_thumb_url, f.bytes,
            ct.preset_slug AS target_slug,
            c.custom_props AS target_custom_props
       FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
       JOIN card_files f ON f.card_id = c.id
      WHERE c.id = ANY($1) AND ct.kind = 'file'`,
    [cardIds]
  );

  function rowToMedia(row) {
    const kind = FILE_SLUG_TO_MEDIA_KIND[row.target_slug] || "file";
    const m = { url: row.url, kind };
    if (row.original_name) m.name = row.original_name;
    if (row.thumb_url) m.thumbnailUrl = row.thumb_url;
    if (row.cover_url) m.coverUrl = row.cover_url;
    if (row.cover_thumb_url) m.coverThumbnailUrl = row.cover_thumb_url;
    if (row.bytes != null) m.sizeBytes = Number(row.bytes);
    // 把时长/分辨率类字段还原到 media（兼容旧 sf-vid-resolution 与通用 sf-file-resolution）
    const cp = Array.isArray(row.target_custom_props) ? row.target_custom_props : [];
    for (const p of cp) {
      if (!p || typeof p !== "object") continue;
      if (p.id === "sf-vid-duration-sec" || p.id === "sf-aud-duration-sec") {
        const v = Number(p.value);
        if (Number.isFinite(v)) m.durationSec = v;
      } else if (
        (p.id === "sf-vid-resolution" || p.id === "sf-file-resolution") &&
        typeof p.value === "string"
      ) {
        const m2 = p.value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
        if (m2) {
          m.widthPx = Number(m2[1]);
          m.heightPx = Number(m2[2]);
        }
      }
    }
    return m;
  }

  // 自身先于附件：自身位 0；其他附件按 link_sort 排
  for (const row of r2.rows) {
    out.set(row.owner_id, [rowToMedia(row)]);
  }
  for (const row of r.rows) {
    const arr = out.get(row.owner_id) ?? [];
    arr.push(rowToMedia(row));
    out.set(row.owner_id, arr);
  }
  return out;
}

/**
 * relatedRefs 从 card_links(property_key='related') + 目标卡主要 placement
 * 的 collection_id 组装成旧 API 形状 [{ colId, cardId }]。
 */
async function loadRelatedRefsForCards(cardIds, q) {
  const out = new Map();
  if (!cardIds.length) return out;
  for (const id of cardIds) out.set(id, []);
  const r = await q(
    `SELECT l.from_card_id, l.to_card_id
       FROM card_links l
      WHERE l.from_card_id = ANY($1) AND l.property_key = 'related'`,
    [cardIds]
  );
  const toIds = [...new Set(r.rows.map((x) => x.to_card_id))];
  const placement = new Map();
  if (toIds.length) {
    const pr = await q(
      `SELECT DISTINCT ON (card_id) card_id, collection_id
         FROM card_placements WHERE card_id = ANY($1)
        ORDER BY card_id, collection_id`,
      [toIds]
    );
    for (const row of pr.rows) placement.set(row.card_id, row.collection_id);
  }
  for (const row of r.rows) {
    const colId = placement.get(row.to_card_id);
    if (colId) out.get(row.from_card_id).push({ colId, cardId: row.to_card_id });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 集合树读
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 给一组 cards/card_placements JOIN 得到的行批量装配 reminders / media / relatedRefs /
 * personWorks / fileSource 子数据，返回前端卡片对象数组（顺序对应入参）。
 * getCollectionsTree / getCardsForCollection / getCardById 都复用它。
 */
async function assembleCards(cardRows, q = query) {
  if (!cardRows.length) return [];
  const cardIds = cardRows.map((r) => r.id);
  const personIds = cardRows
    .filter((r) => r.preset_slug === "person")
    .map((r) => r.id);
  const fileIds = cardRows
    .filter((r) => (r.preset_slug || "").startsWith("file"))
    .map((r) => r.id);
  const [
    reminders,
    mediaByCard,
    relatedByCard,
    personWorksByCard,
    fileSourceByCard,
  ] = await Promise.all([
    loadRemindersForCards(cardIds, q),
    loadMediaForCards(cardIds, q),
    loadRelatedRefsForCards(cardIds, q),
    loadPersonWorksForCards(personIds, q),
    loadFileSourceForCards(fileIds, q),
  ]);
  const extras = {
    reminders,
    mediaByCard,
    relatedByCard,
    personWorksByCard,
    fileSourceByCard,
  };
  return cardRows.map((r) => assembleCardRow(r, extras));
}

export async function getCollectionsTree(userIdIn) {
  const userId = await resolveUserId(userIdIn);

  const colRes = await query(
    `SELECT col.id, col.user_id, col.parent_id, col.name, col.dot_color,
            col.icon_shape,
            col.description, col.sort_order, col.bound_type_id,
            ct.preset_slug AS bound_preset_slug, ct.schema_json AS bound_card_schema
       FROM collections col
       LEFT JOIN card_types ct ON ct.id = col.bound_type_id
      WHERE col.user_id = $1
      ORDER BY col.sort_order`,
    [userId]
  );

  const orphanRes = await query(
    `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on,
            c.tags, c.custom_props,
            ct.preset_slug
       FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.user_id = $1 AND c.trashed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM card_placements p WHERE p.card_id = c.id)
      ORDER BY c.updated_at DESC`,
    [userId]
  );

  let cardRes = { rows: [] };
  if (colRes.rows.length > 0) {
    const colIds = colRes.rows.map((r) => r.id);
    cardRes = await query(
      `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on,
              c.tags, c.custom_props,
              ct.preset_slug,
              p.collection_id, p.pinned, p.sort_order
         FROM card_placements p
         JOIN cards c      ON c.id = p.card_id AND c.trashed_at IS NULL
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE p.collection_id = ANY($1)
        ORDER BY p.collection_id, p.sort_order ASC, c.id ASC`,
      [colIds]
    );
  }

  /* 一次性给所有卡片（含孤儿）装配 extras，再按原顺序拆回 placed / orphan 两组。 */
  const allRows = [...cardRes.rows, ...orphanRes.rows];
  const assembled = await assembleCards(allRows, query);
  const placedAssembled = assembled.slice(0, cardRes.rows.length);
  const orphanAssembled = assembled.slice(cardRes.rows.length);

  const cardsByColId = new Map();
  for (let i = 0; i < cardRes.rows.length; i++) {
    const c = cardRes.rows[i];
    const arr = cardsByColId.get(c.collection_id) ?? [];
    arr.push(placedAssembled[i]);
    cardsByColId.set(c.collection_id, arr);
  }

  const map = new Map();
  for (const row of colRes.rows) {
    map.set(row.id, {
      ...rowToCollection(row),
      children: [],
      cards: cardsByColId.get(row.id) ?? [],
    });
  }
  const roots = [];
  for (const row of colRes.rows) {
    const node = map.get(row.id);
    if (row.parent_id) {
      const parent = map.get(row.parent_id);
      if (parent) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  if (orphanRes.rows.length > 0) {
    roots.push({
      id: LOOSE_NOTES_COLLECTION_ID,
      name: "",
      dotColor: LOOSE_NOTES_DOT_COLOR,
      cards: orphanAssembled,
      children: [],
    });
  } else if (colRes.rows.length === 0) {
    return [];
  }

  return roots;
}

// ─────────────────────────────────────────────────────────────────────────────
// 懒加载路径：meta 树 / 按合集分页拉卡 / 单卡
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 仅返回合集元信息树（无 cards），带每合集直接卡片数和子树总数。
 * 前端新架构启动时用这个代替 getCollectionsTree，省掉主要流量。
 */
export async function getCollectionsMetaTree(userIdIn) {
  const userId = await resolveUserId(userIdIn);

  const colRes = await query(
    `SELECT col.id, col.user_id, col.parent_id, col.name, col.dot_color,
            col.icon_shape, col.description, col.sort_order, col.bound_type_id,
            ct.preset_slug AS bound_preset_slug, ct.schema_json AS bound_card_schema,
            (SELECT COUNT(*)::int
               FROM card_placements p
               JOIN cards c ON c.id = p.card_id
              WHERE p.collection_id = col.id AND c.trashed_at IS NULL
            ) AS direct_card_count
       FROM collections col
       LEFT JOIN card_types ct ON ct.id = col.bound_type_id
      WHERE col.user_id = $1
      ORDER BY col.sort_order`,
    [userId]
  );

  const orphanCountRes = await query(
    `SELECT COUNT(*)::int AS n
       FROM cards c
      WHERE c.user_id = $1 AND c.trashed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM card_placements p WHERE p.card_id = c.id)`,
    [userId]
  );

  const map = new Map();
  for (const row of colRes.rows) {
    map.set(row.id, {
      ...rowToCollection(row),
      children: [],
      cardCount: row.direct_card_count ?? 0,
      totalCardCount: row.direct_card_count ?? 0,
    });
  }

  const roots = [];
  for (const row of colRes.rows) {
    const node = map.get(row.id);
    if (row.parent_id) {
      const parent = map.get(row.parent_id);
      if (parent) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  /* 后序递推 totalCardCount（含子合集） */
  function accumulate(node) {
    let sum = node.cardCount;
    for (const child of node.children) sum += accumulate(child);
    node.totalCardCount = sum;
    return sum;
  }
  for (const root of roots) accumulate(root);

  const looseCount = orphanCountRes.rows[0]?.n ?? 0;
  if (looseCount > 0) {
    roots.push({
      id: LOOSE_NOTES_COLLECTION_ID,
      name: "",
      dotColor: LOOSE_NOTES_DOT_COLOR,
      children: [],
      cardCount: looseCount,
      totalCardCount: looseCount,
    });
  }

  return roots;
}

/**
 * 单合集的卡片分页读取。
 * - sort: "sort_order"（默认 = 置顶优先 + placement.sort_order）| "-added_on" | "-updated_at"
 * - 返回 { cards, hasMore, page, limit } 或 null（合集不存在或不属于该用户）
 * - 特殊 collectionId = LOOSE_NOTES_COLLECTION_ID 返回未归属任何合集的卡片
 */
export async function getCardsForCollection(userIdIn, collectionId, opts = {}) {
  const userId = await resolveUserId(userIdIn);
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const offset = (page - 1) * limit;
  const sort = opts.sort || "sort_order";

  let orderBy;
  switch (sort) {
    case "-added_on":
      orderBy =
        "c.added_on DESC NULLS LAST, c.minutes_of_day DESC NULLS LAST, c.id DESC";
      break;
    case "-updated_at":
      orderBy = "c.updated_at DESC, c.id DESC";
      break;
    case "sort_order":
    default:
      orderBy = "p.pinned DESC, p.sort_order ASC, c.id ASC";
      break;
  }

  let rows;
  if (collectionId === LOOSE_NOTES_COLLECTION_ID) {
    /* 孤儿卡：没有 placements 可排，只能按 added_on / updated_at 排 */
    const orderByLoose =
      sort === "-added_on"
        ? "c.added_on DESC NULLS LAST, c.minutes_of_day DESC NULLS LAST, c.id DESC"
        : "c.updated_at DESC, c.id DESC";
    const r = await query(
      `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on,
              c.tags, c.custom_props,
              ct.preset_slug
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM card_placements p WHERE p.card_id = c.id)
        ORDER BY ${orderByLoose}
        LIMIT $2 OFFSET $3`,
      [userId, limit + 1, offset]
    );
    rows = r.rows;
  } else {
    const colCheck = await query(
      `SELECT 1 FROM collections WHERE id = $1 AND user_id = $2`,
      [collectionId, userId]
    );
    if (colCheck.rows.length === 0) return null;

    const r = await query(
      `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on,
              c.tags, c.custom_props,
              ct.preset_slug,
              p.collection_id, p.pinned, p.sort_order
         FROM card_placements p
         JOIN cards c      ON c.id = p.card_id AND c.trashed_at IS NULL
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE p.collection_id = $1
        ORDER BY ${orderBy}
        LIMIT $2 OFFSET $3`,
      [collectionId, limit + 1, offset]
    );
    rows = r.rows;
  }

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const cards = await assembleCards(trimmed);
  return { cards, hasMore, page, limit };
}

/**
 * 按 id 读单卡完整数据（含 reminders / media / relatedRefs / ...）。
 * 从搜索结果 / 提醒视图 / 日历跳转进来查看单卡时用。
 */
export async function getCardById(userIdIn, cardId) {
  const userId = await resolveUserId(userIdIn);
  const r = await query(
    `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on,
            c.tags, c.custom_props,
            ct.preset_slug
       FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.id = $1 AND c.user_id = $2 AND c.trashed_at IS NULL`,
    [cardId, userId]
  );
  if (r.rows.length === 0) return null;
  const [card] = await assembleCards(r.rows);
  return card ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 集合 CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createCollection(userIdIn, data) {
  const userId = await resolveUserId(userIdIn);
  const {
    id,
    name,
    dotColor = "",
    hint = "",
    parentId = null,
    sortOrder,
  } = data || {};
  if (!id || !name) throw new Error("id 和 name 为必填项");

  let order = sortOrder;
  if (order === undefined || order === null) {
    const r = await query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collections WHERE user_id = $1`,
      [userId]
    );
    order = r.rows[0].next;
  }

  await query(
    `INSERT INTO collections (id, user_id, parent_id, name, description, dot_color, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [id, userId, parentId, name, String(hint ?? ""), String(dotColor ?? ""), order]
  );

  return {
    id,
    name,
    dotColor,
    ...(String(hint || "").trim() ? { hint: String(hint).trim() } : {}),
    parentId: parentId ?? undefined,
    sortOrder: order,
  };
}

export async function updateCollection(userIdIn, collectionId, patch) {
  const userId = await resolveUserId(userIdIn);
  const fields = [];
  const params = [];
  let i = 1;

  if (typeof patch.name === "string") {
    fields.push(`name = $${i++}`);
    params.push(patch.name);
  }
  if (typeof patch.dotColor === "string") {
    fields.push(`dot_color = $${i++}`);
    params.push(patch.dotColor);
  }
  if (typeof patch.iconShape === "string") {
    /** 允许传空串清除自定义形状，恢复默认圆点 */
    fields.push(`icon_shape = $${i++}`);
    params.push(patch.iconShape.trim());
  }
  if ("parentId" in patch) {
    fields.push(`parent_id = $${i++}`);
    params.push(patch.parentId ?? null);
  }
  if (typeof patch.sortOrder === "number") {
    fields.push(`sort_order = $${i++}`);
    params.push(patch.sortOrder);
  }
  if (typeof patch.hint === "string") {
    fields.push(`description = $${i++}`);
    params.push(patch.hint);
  }
  // 分类/Schema/预设：写入 bound_type_id（用户已传 cardSchema 或 presetTypeId 时建/选 card_type）
  if ("isCategory" in patch || "cardSchema" in patch || "presetTypeId" in patch) {
    const boundId = await resolveBoundTypeForCollectionPatch(userId, patch);
    fields.push(`bound_type_id = $${i++}`);
    params.push(boundId);
  }

  if (fields.length === 0) throw new Error("未提供任何可更新字段");

  params.push(collectionId);
  params.push(userId);

  const res = await query(
    `UPDATE collections SET ${fields.join(", ")}
       WHERE id = $${i} AND user_id = $${i + 1}
   RETURNING id, user_id, parent_id, name, dot_color, icon_shape, description, sort_order, bound_type_id`,
    params
  );
  if (res.rowCount === 0) throw new Error("合集不存在或无权限");

  // 回一条 bound schema/preset 方便前端
  const row = res.rows[0];
  if (row.bound_type_id) {
    const tr = await query(
      `SELECT preset_slug, schema_json FROM card_types WHERE id = $1`,
      [row.bound_type_id]
    );
    row.bound_preset_slug = tr.rows[0]?.preset_slug || null;
    row.bound_card_schema = tr.rows[0]?.schema_json || null;
  }
  return rowToCollection(row);
}

/**
 * 根据 patch 里的 isCategory / cardSchema / presetTypeId 决策 bound_type_id。
 * - isCategory = false → bound_type_id = NULL
 * - presetTypeId 给定且匹配到已知预设 → 指向该 preset
 * - cardSchema 给定且不匹配预设 → 新建一条 kind=custom 自定义 card_type
 */
async function resolveBoundTypeForCollectionPatch(userId, patch) {
  if (patch.isCategory === false) return null;
  const presetId = typeof patch.presetTypeId === "string" ? patch.presetTypeId.trim() : "";
  if (presetId) {
    const r = await query(
      `SELECT id FROM card_types WHERE user_id = $1 AND preset_slug = $2`,
      [userId, presetId]
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  if (patch.cardSchema && typeof patch.cardSchema === "object") {
    // 自定义 card_type
    const id = `ct_${cryptoRandomHex(8)}`;
    await query(
      `INSERT INTO card_types (id, user_id, parent_type_id, kind, name, schema_json, is_preset, preset_slug)
       VALUES ($1,$2,NULL,'custom',$3,$4::jsonb,false,NULL)`,
      [id, userId, patch.name || "自定义类型", JSON.stringify(patch.cardSchema)]
    );
    return id;
  }
  // isCategory=true but no schema/preset: leave null (caller may set later)
  return null;
}

function cryptoRandomHex(bytes) {
  // 小工具；只在少量位置用
  const arr = new Uint8Array(bytes);
  // node: use globalThis.crypto if available
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(arr);
  else {
    for (let i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deleteCollection(userIdIn, collectionId) {
  const userId = await resolveUserId(userIdIn);
  const res = await query(
    `DELETE FROM collections WHERE id = $1 AND user_id = $2`,
    [collectionId, userId]
  );
  if (res.rowCount === 0) throw new Error("合集不存在或无权限");
}

// ─────────────────────────────────────────────────────────────────────────────
// Placements（已有卡加入/移除合集）
// ─────────────────────────────────────────────────────────────────────────────

export async function addCardToCollectionPlacement(
  userIdIn,
  cardId,
  collectionId,
  opts = {}
) {
  const userId = await resolveUserId(userIdIn);
  const cid = String(cardId || "").trim();
  const colId = String(collectionId || "").trim();
  if (!cid || !colId) throw new Error("缺少卡片或合集");

  const insertAtStart = opts.insertAtStart === true;
  const pinned = Boolean(opts.pinned);

  const colCheck = await query(
    `SELECT id FROM collections WHERE id = $1 AND user_id = $2`,
    [colId, userId]
  );
  if (colCheck.rowCount === 0) throw new Error("合集不存在或无权限");

  let sortOrder;
  if (insertAtStart) {
    const minRes = await query(
      `SELECT MIN(sort_order) AS m FROM card_placements WHERE collection_id = $1`,
      [colId]
    );
    const m = minRes.rows[0]?.m;
    sortOrder = m === null || m === undefined ? 0 : m - 1;
  } else {
    const orderRes = await query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
      [colId]
    );
    sortOrder = orderRes.rows[0].next;
  }

  const existing = await query(
    `SELECT id, trashed_at FROM cards WHERE id = $1 AND user_id = $2`,
    [cid, userId]
  );
  if (existing.rowCount === 0) throw new Error("卡片不存在或无权限");
  if (existing.rows[0].trashed_at != null) throw new Error("该笔记在回收站中，请先恢复");

  await query(
    `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (card_id, collection_id) DO UPDATE SET
       pinned = EXCLUDED.pinned,
       sort_order = EXCLUDED.sort_order`,
    [cid, colId, pinned, sortOrder]
  );

  return { cardId: cid, collectionId: colId, sortOrder, pinned };
}

export async function removeCardFromCollectionPlacement(userIdIn, cardId, collectionId) {
  const userId = await resolveUserId(userIdIn);
  const cid = String(cardId || "").trim();
  const colId = String(collectionId || "").trim();
  if (!cid || !colId) throw new Error("缺少卡片或合集");

  const res = await query(
    `DELETE FROM card_placements p
       USING cards c
      WHERE p.card_id = c.id
        AND p.card_id = $1
        AND p.collection_id = $2
        AND c.user_id = $3
        AND c.trashed_at IS NULL`,
    [cid, colId, userId]
  );
  if (res.rowCount === 0) throw new Error("归属不存在或无权限");
}

// ─────────────────────────────────────────────────────────────────────────────
// 卡片 CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createCard(userIdIn, collectionId, card, pgClient = null) {
  const userId = await resolveUserId(userIdIn);
  const q = pgClient ? (sql, params) => pgClient.query(sql, params) : query;

  const colCheck = await q(
    `SELECT id FROM collections WHERE id = $1 AND user_id = $2`,
    [collectionId, userId]
  );
  if (colCheck.rowCount === 0) throw new Error("合集不存在或无权限");

  const {
    id,
    text = "",
    title = "",
    minutesOfDay = 0,
    addedOn = null,
    reminderOn = null,
    reminderTime = null,
    reminderNote = null,
    reminderCompletedAt = null,
    reminderCompletedNote = null,
    pinned = false,
    tags = [],
    relatedRefs = [],
    media = [],
    customProps = [],
  } = card || {};
  const insertAtStart = card?.insertAtStart === true;
  if (!id) throw new Error("card.id 为必填项");

  // 若卡已存在则走 placement-only 分支（与旧行为一致）
  const existing = await q(
    `SELECT id, trashed_at FROM cards WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (existing.rowCount > 0) {
    if (existing.rows[0].trashed_at != null) throw new Error("该笔记在回收站中，请先恢复");
    await addCardToCollectionPlacement(userId, id, collectionId, { insertAtStart, pinned });
    return await readCardForApi(userId, id);
  }

  // 决议 card_type_id：优先 objectKind → 预设 slug；兜底 'note'
  const slug = objectKindToSlug(card?.objectKind || "note");
  const cardTypeId = await resolvePresetCardTypeId(userId, slug, pgClient);

  let sortOrder;
  if (insertAtStart) {
    const minRes = await q(
      `SELECT MIN(sort_order) AS m FROM card_placements WHERE collection_id = $1`,
      [collectionId]
    );
    const m = minRes.rows[0]?.m;
    sortOrder = m === null || m === undefined ? 0 : m - 1;
  } else {
    const orderRes = await q(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
      [collectionId]
    );
    sortOrder = orderRes.rows[0].next;
  }

  await q(
    `INSERT INTO cards (id, user_id, card_type_id, title, body, added_on,
                        minutes_of_day, tags, custom_props)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      id,
      userId,
      cardTypeId,
      String(title || ""),
      String(text || ""),
      dateOrNull(addedOn),
      Number(minutesOfDay) || 0,
      tags,
      JSON.stringify(customProps || []),
    ]
  );

  // 写对应 1:1 子表
  await writeSubtableForKindFromSlug(q, id, slug);

  await q(
    `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
     VALUES ($1,$2,$3,$4)`,
    [id, collectionId, !!pinned, sortOrder]
  );

  // reminder
  if (reminderOn) {
    await upsertReminderFromLegacy(q, id, userId, {
      reminderOn,
      reminderTime,
      reminderNote,
      reminderCompletedAt,
      reminderCompletedNote,
    });
  }

  // relatedRefs → card_links
  if (Array.isArray(relatedRefs) && relatedRefs.length > 0) {
    await replaceRelatedLinks(q, userId, id, relatedRefs);
  }

  // media → 同步 attachment 链 + file 卡
  if (Array.isArray(media) && media.length > 0) {
    await syncMediaAttachments(q, userId, id, media);
  }

  return await readCardForApi(userId, id, pgClient);
}

function dateOrNull(s) {
  if (!s) return null;
  const t = String(s).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

async function writeSubtableForKindFromSlug(q, cardId, slug) {
  const kind = kindFromSlug(slug);
  if (kind === "file") {
    // 文件卡需要 url；此路径只写占位行以满足 1:1 约束，应用层后续更新
    await q(
      `INSERT INTO card_files (card_id, url) VALUES ($1,'')
       ON CONFLICT (card_id) DO NOTHING`,
      [cardId]
    );
  }
  // note / custom：所有字段存在 cards.custom_props，无需子表
}

function kindFromSlug(slug) {
  if (!slug) return "note";
  const head = slug.split("_")[0];
  if (head === "note") return "note";
  if (head === "file") return "file";
  return "custom";
}

// ─────────────────────────────────────────────────────────────────────────────
// 媒体附件辅助：把 media[] 同步为 attachment 链 + 独立文件卡
// ─────────────────────────────────────────────────────────────────────────────

/** 把前端 media 项规范化为 card_files 字段 + 文件子类 slug。 */
function normalizeIncomingMediaItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url) return null;
  const kindIn = String(raw.kind || "").toLowerCase();
  const kind = ["image", "video", "audio", "file"].includes(kindIn) ? kindIn : "file";
  const slug = MEDIA_KIND_TO_FILE_SLUG[kind] || "file_document";
  const bytesRaw = raw.sizeBytes;
  const bytes =
    typeof bytesRaw === "number" && Number.isFinite(bytesRaw)
      ? Math.trunc(bytesRaw)
      : typeof bytesRaw === "string" && /^\d+$/.test(bytesRaw.trim())
        ? Number(bytesRaw.trim())
        : null;
  const durationRaw = raw.durationSec;
  const durationSec =
    (kind === "audio" || kind === "video") &&
    typeof durationRaw === "number" &&
    Number.isFinite(durationRaw) &&
    durationRaw >= 0 &&
    durationRaw <= 86400000
      ? Math.round(durationRaw)
      : null;
  const widthRaw = raw.widthPx;
  const heightRaw = raw.heightPx;
  const widthPx =
    (kind === "image" || kind === "video") &&
    typeof widthRaw === "number" &&
    Number.isFinite(widthRaw) &&
    widthRaw > 0 &&
    widthRaw <= 32767
      ? Math.round(widthRaw)
      : null;
  const heightPx =
    (kind === "image" || kind === "video") &&
    typeof heightRaw === "number" &&
    Number.isFinite(heightRaw) &&
    heightRaw > 0 &&
    heightRaw <= 32767
      ? Math.round(heightRaw)
      : null;
  return {
    url,
    slug,
    kind,
    name: typeof raw.name === "string" ? raw.name : "",
    thumbnailUrl: typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : "",
    coverUrl: typeof raw.coverUrl === "string" ? raw.coverUrl : "",
    coverThumbnailUrl:
      typeof raw.coverThumbnailUrl === "string"
        ? raw.coverThumbnailUrl
        : typeof raw.coverThumbUrl === "string"
          ? raw.coverThumbUrl
          : "",
    bytes,
    durationSec,
    widthPx,
    heightPx,
  };
}

function derivedFileCardPropsFromMediaItem(item) {
  const props = [];
  if (
    item.kind === "video" &&
    typeof item.durationSec === "number" &&
    Number.isFinite(item.durationSec) &&
    item.durationSec >= 0
  ) {
    props.push({
      id: "sf-vid-duration-sec",
      name: "时长（秒）",
      type: "number",
      value: Math.round(item.durationSec),
    });
  } else if (
    item.kind === "audio" &&
    typeof item.durationSec === "number" &&
    Number.isFinite(item.durationSec) &&
    item.durationSec >= 0
  ) {
    props.push({
      id: "sf-aud-duration-sec",
      name: "时长（秒）",
      type: "number",
      value: Math.round(item.durationSec),
    });
  }
  if (
    (item.kind === "image" || item.kind === "video") &&
    typeof item.widthPx === "number" &&
    Number.isFinite(item.widthPx) &&
    item.widthPx > 0 &&
    typeof item.heightPx === "number" &&
    Number.isFinite(item.heightPx) &&
    item.heightPx > 0
  ) {
    const value = `${Math.round(item.widthPx)}x${Math.round(item.heightPx)}`;
    props.push({
      id: "sf-file-resolution",
      name: "分辨率",
      type: "text",
      value,
    });
    if (item.kind === "video") {
      props.push({
        id: "sf-vid-resolution",
        name: "分辨率",
        type: "text",
        value,
      });
    }
  }
  return props;
}

async function mergeFileCardDerivedProps(q, fileCardId, item) {
  const nextProps = derivedFileCardPropsFromMediaItem(item);
  if (nextProps.length === 0) return;
  const cur = await q(`SELECT custom_props FROM cards WHERE id = $1`, [fileCardId]);
  const arr = Array.isArray(cur.rows[0]?.custom_props)
    ? cur.rows[0].custom_props.slice()
    : [];
  let changed = false;
  for (const np of nextProps) {
    const existing = arr.find((x) => x?.id === np.id);
    if (!existing) {
      arr.push(np);
      changed = true;
    } else if (
      existing.value === null ||
      existing.value === undefined ||
      existing.value === ""
    ) {
      Object.assign(existing, np);
      changed = true;
    }
  }
  if (!changed) return;
  await q(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
    fileCardId,
    JSON.stringify(arr),
  ]);
}

function newCardId(prefix = "card") {
  return `${prefix}_${cryptoRandomHex(10)}`;
}

function stripExt(name) {
  const t = String(name || "").trim();
  if (!t) return "";
  const i = t.lastIndexOf(".");
  if (i <= 0 || i >= t.length - 1) return t;
  return t.slice(0, i);
}

/** 从 URL 推导展示用 title（用于 file 卡的 body/title fallback）。 */
function fileTitleFromItem(item) {
  if (item.name) return stripExt(item.name);
  try {
    const u = new URL(item.url);
    const parts = u.pathname.split("/").filter(Boolean);
    return stripExt(decodeURIComponent(parts[parts.length - 1] || ""));
  } catch {
    const parts = item.url.split("?")[0].split("/").filter(Boolean);
    return stripExt(parts[parts.length - 1] || "");
  }
}

/**
 * 创建一张独立的文件卡（cards + card_files），返回其 id。
 * 不写 placement，不写 card_links（调用方决定）。
 */
async function insertFileCard(q, userId, item) {
  const fileCardId = newCardId("card");
  const cardTypeId = await resolvePresetCardTypeId(userId, item.slug, null);
  await q(
    `INSERT INTO cards (id, user_id, card_type_id, title, body)
     VALUES ($1,$2,$3,$4,'')`,
    [fileCardId, userId, cardTypeId, fileTitleFromItem(item)]
  );
  await q(
    `INSERT INTO card_files (card_id, url, original_name, thumb_url, cover_url, cover_thumb_url, bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      fileCardId,
      item.url,
      item.name,
      item.thumbnailUrl,
      item.coverUrl,
      item.coverThumbnailUrl,
      item.bytes,
    ]
  );
  await mergeFileCardDerivedProps(q, fileCardId, item);
  return fileCardId;
}

/**
 * 用一个 media[] 数组同步某卡的 attachment 链：
 *   - 现有 attachment links 按 url 建 map；如果新数组里有同 url，复用旧 file 卡（更新顺序 + 元数据）
 *   - 新数组里 URL 不在 map → 新建 file 卡 + link
 *   - 旧数组里 URL 不在新数组 → 删 link（文件卡保留，与主卡独立）
 */
async function syncMediaAttachments(q, userId, noteCardId, mediaArr) {
  const items = [];
  for (const raw of mediaArr) {
    const n = normalizeIncomingMediaItem(raw);
    if (n) items.push(n);
  }

  // 当前 attachment links（+ 目标 file 卡的 url）
  const cur = await q(
    `SELECT l.to_card_id, l.sort_order, cf.url
       FROM card_links l
       JOIN card_files cf ON cf.card_id = l.to_card_id
      WHERE l.from_card_id = $1 AND l.property_key = 'attachment'`,
    [noteCardId]
  );
  const urlToFileCard = new Map();
  for (const row of cur.rows) urlToFileCard.set(row.url, row.to_card_id);

  // 删除所有旧 attachment 链（稍后按新数组重建；复用逻辑：若 url 复用则 file 卡不变，只是 link 重新插）
  await q(
    `DELETE FROM card_links WHERE from_card_id = $1 AND property_key = 'attachment'`,
    [noteCardId]
  );

  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    let fileCardId = urlToFileCard.get(it.url);
    if (fileCardId) {
      // 复用 file 卡：更新其 card_files 元数据（填补可能新获取的字段）
      await q(
        `UPDATE card_files
            SET original_name = CASE WHEN $2 <> '' THEN $2 ELSE original_name END,
                thumb_url = CASE WHEN $3 <> '' THEN $3 ELSE thumb_url END,
                cover_url = CASE WHEN $4 <> '' THEN $4 ELSE cover_url END,
                cover_thumb_url = CASE WHEN $5 <> '' THEN $5 ELSE cover_thumb_url END,
                bytes = COALESCE($6, bytes)
          WHERE card_id = $1`,
        [
          fileCardId,
          it.name,
          it.thumbnailUrl,
          it.coverUrl,
          it.coverThumbnailUrl,
          it.bytes,
        ]
      );
      await mergeFileCardDerivedProps(q, fileCardId, it);
    } else {
      fileCardId = await insertFileCard(q, userId, it);
    }

    // 目标类型 id（供 card_links.target_type_id 缓存）
    const tr = await q(
      `SELECT card_type_id FROM cards WHERE id = $1`,
      [fileCardId]
    );
    const targetTypeId = tr.rows[0]?.card_type_id || null;

    await q(
      `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
       VALUES ($1,'attachment',$2,$3,$4,$5)
       ON CONFLICT (from_card_id, property_key, to_card_id) DO UPDATE SET
         sort_order = EXCLUDED.sort_order,
         target_type_id = EXCLUDED.target_type_id`,
      [noteCardId, fileCardId, targetTypeId, userId, i]
    );
  }
}

async function upsertReminderFromLegacy(q, cardId, userId, r) {
  const datePart = String(r.reminderOn || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return;
  const timePart = /^\d{2}:\d{2}/.test(r.reminderTime || "")
    ? String(r.reminderTime).slice(0, 5)
    : "00:00";
  const iso = `${datePart}T${timePart}:00`;
  await q(
    `INSERT INTO card_reminders (card_id, user_id, due_at, note, completed_at, completed_note)
     VALUES ($1,$2,$3::timestamptz,$4,$5::timestamptz,$6)
     ON CONFLICT (card_id) DO UPDATE SET
       due_at = EXCLUDED.due_at,
       note = EXCLUDED.note,
       completed_at = EXCLUDED.completed_at,
       completed_note = EXCLUDED.completed_note`,
    [
      cardId,
      userId,
      iso,
      String(r.reminderNote || ""),
      r.reminderCompletedAt || null,
      String(r.reminderCompletedNote || ""),
    ]
  );
}

async function deleteReminder(q, cardId) {
  await q(`DELETE FROM card_reminders WHERE card_id = $1`, [cardId]);
}

async function replaceRelatedLinks(q, userId, fromCardId, relatedRefs) {
  await q(
    `DELETE FROM card_links
      WHERE user_id = $1 AND property_key = 'related'
        AND (from_card_id = $2 OR to_card_id = $2)`,
    [userId, fromCardId]
  );
  const seen = new Set();
  for (const ref of relatedRefs) {
    const toId = ref && typeof ref.cardId === "string" ? ref.cardId.trim() : "";
    if (!toId || toId === fromCardId || seen.has(toId)) continue;
    seen.add(toId);
    // 确认目标卡属于同用户
    const t = await q(`SELECT card_type_id FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NULL`, [
      toId,
      userId,
    ]);
    if (t.rowCount === 0) continue;
    const targetTypeId = t.rows[0].card_type_id;
    // 双向 related 边
    await q(
      `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
       VALUES ($1,'related',$2,$3,$4,0)
       ON CONFLICT (from_card_id, property_key, to_card_id) DO NOTHING`,
      [fromCardId, toId, targetTypeId, userId]
    );
    await q(
      `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
       VALUES ($1,'related',$2,$3,$4,0)
       ON CONFLICT (from_card_id, property_key, to_card_id) DO NOTHING`,
      [toId, fromCardId, null, userId]
    );
  }
}

/** 用于 createCard/updateCard 的"拉一张卡给前端"。 */
async function readCardForApi(userId, cardId, pgClient = null) {
  const q = pgClient ? (sql, params) => pgClient.query(sql, params) : query;
  const r = await q(
    `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on, c.tags, c.custom_props,
            ct.preset_slug
       FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.id = $1 AND c.user_id = $2`,
    [cardId, userId]
  );
  if (r.rowCount === 0) return null;
  const slug = r.rows[0].preset_slug || "";
  const isPerson = slug === "person";
  const isFile = slug.startsWith("file");
  const [reminders, mediaByCard, relatedByCard, personWorksByCard, fileSourceByCard] =
    await Promise.all([
      loadRemindersForCards([cardId], q),
      loadMediaForCards([cardId], q),
      loadRelatedRefsForCards([cardId], q),
      isPerson ? loadPersonWorksForCards([cardId], q) : Promise.resolve(new Map()),
      isFile ? loadFileSourceForCards([cardId], q) : Promise.resolve(new Map()),
    ]);
  return assembleCardRow(r.rows[0], {
    reminders,
    mediaByCard,
    relatedByCard,
    personWorksByCard,
    fileSourceByCard,
  });
}

export async function updateCard(userIdIn, cardId, patch) {
  const userId = await resolveUserId(userIdIn);

  const placementCollectionId =
    typeof patch.placementCollectionId === "string"
      ? patch.placementCollectionId.trim()
      : "";
  const moveToColId =
    typeof patch.collectionId === "string" && patch.collectionId.trim()
      ? patch.collectionId.trim()
      : null;

  const hasPlacementPatch =
    typeof patch.pinned === "boolean" ||
    (typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)) ||
    Boolean(moveToColId);
  if (hasPlacementPatch && !placementCollectionId) {
    throw new Error("placementCollectionId 为必填（置顶、排序或移动归属时）");
  }
  if (moveToColId) {
    const chk = await query(
      `SELECT 1 FROM collections WHERE id = $1 AND user_id = $2`,
      [moveToColId, userId]
    );
    if (chk.rowCount === 0) throw new Error("目标合集不存在或无权限");
  }

  const hasRelatedSync = Array.isArray(patch.relatedRefs);

  const cardCols = [];
  const cardParams = [];
  let i = 1;
  if (typeof patch.text === "string") {
    cardCols.push(`body = $${i++}`);
    cardParams.push(patch.text);
  }
  if (typeof patch.title === "string") {
    cardCols.push(`title = $${i++}`);
    cardParams.push(patch.title);
  }
  if (Array.isArray(patch.tags)) {
    cardCols.push(`tags = $${i++}`);
    cardParams.push(patch.tags);
  }
  if (Array.isArray(patch.customProps)) {
    cardCols.push(`custom_props = $${i++}::jsonb`);
    cardParams.push(JSON.stringify(patch.customProps));
  }
  if (typeof patch.minutesOfDay === "number") {
    cardCols.push(`minutes_of_day = $${i++}`);
    cardParams.push(patch.minutesOfDay);
  }
  if ("addedOn" in patch) {
    cardCols.push(`added_on = $${i++}`);
    cardParams.push(dateOrNull(patch.addedOn));
  }
  if (typeof patch.objectKind === "string") {
    const slug = objectKindToSlug(patch.objectKind);
    const newTypeId = await resolvePresetCardTypeId(userId, slug);
    cardCols.push(`card_type_id = $${i++}`);
    cardParams.push(newTypeId);
  }

  // reminder：老 API 单字段 patch
  const hasReminderPatch =
    "reminderOn" in patch ||
    "reminderTime" in patch ||
    "reminderNote" in patch ||
    "reminderCompletedAt" in patch ||
    "reminderCompletedNote" in patch;

  if (
    cardCols.length === 0 &&
    !hasPlacementPatch &&
    !hasRelatedSync &&
    !hasReminderPatch &&
    !Array.isArray(patch.media)
  ) {
    throw new Error("未提供任何可更新字段");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    if (hasRelatedSync) {
      await replaceRelatedLinks(
        (sql, params) => client.query(sql, params),
        userId,
        cardId,
        patch.relatedRefs
      );
    }

    if (cardCols.length > 0) {
      cardParams.push(cardId);
      cardParams.push(userId);
      const res = await client.query(
        `UPDATE cards SET ${cardCols.join(", ")}
           WHERE id = $${i} AND user_id = $${i + 1} AND trashed_at IS NULL`,
        cardParams
      );
      if (res.rowCount === 0) throw new Error("卡片不存在或无权限");
    }

    if (hasReminderPatch) {
      // 若 reminderOn 明确为 null → 删提醒；否则 upsert
      if (patch.reminderOn === null) {
        await deleteReminder((sql, params) => client.query(sql, params), cardId);
      } else {
        // 合并现状 + patch（保留 note/completedAt 等）
        const cur = (
          await client.query(
            `SELECT due_at, note, completed_at, completed_note FROM card_reminders WHERE card_id = $1`,
            [cardId]
          )
        ).rows[0];
        const curDate =
          cur?.due_at ? new Date(cur.due_at).toISOString().slice(0, 10) : null;
        const curTime =
          cur?.due_at ? new Date(cur.due_at).toISOString().slice(11, 16) : null;
        const nextOn =
          "reminderOn" in patch ? patch.reminderOn : curDate;
        const nextTime = "reminderTime" in patch ? patch.reminderTime : curTime;
        if (nextOn) {
          await upsertReminderFromLegacy(
            (sql, params) => client.query(sql, params),
            cardId,
            userId,
            {
              reminderOn: nextOn,
              reminderTime: nextTime,
              reminderNote: "reminderNote" in patch ? patch.reminderNote : cur?.note || "",
              reminderCompletedAt:
                "reminderCompletedAt" in patch
                  ? patch.reminderCompletedAt
                  : cur?.completed_at || null,
              reminderCompletedNote:
                "reminderCompletedNote" in patch
                  ? patch.reminderCompletedNote
                  : cur?.completed_note || "",
            }
          );
        }
      }
    }

    if (Array.isArray(patch.media)) {
      await syncMediaAttachments(
        (sql, params) => client.query(sql, params),
        userId,
        cardId,
        patch.media
      );
    }

    if (hasPlacementPatch) {
      const pCols = [];
      const pParams = [];
      let k = 1;
      if (moveToColId) {
        pCols.push(`collection_id = $${k++}`);
        pParams.push(moveToColId);
      }
      if (typeof patch.pinned === "boolean") {
        pCols.push(`pinned = $${k++}`);
        pParams.push(patch.pinned);
      }
      if (typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)) {
        pCols.push(`sort_order = $${k++}`);
        pParams.push(patch.sortOrder);
      }
      if (pCols.length === 0) throw new Error("未提供可更新的归属字段");
      pParams.push(cardId, placementCollectionId, userId);
      const res = await client.query(
        `UPDATE card_placements p
            SET ${pCols.join(", ")}
           FROM cards c
          WHERE p.card_id = c.id
            AND p.card_id = $${k}
            AND p.collection_id = $${k + 1}
            AND c.user_id = $${k + 2}`,
        pParams
      );
      if (res.rowCount === 0) throw new Error("卡片归属不存在或无权限");
    }

    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteCard(userIdIn, cardId) {
  const userId = await resolveUserId(userIdIn);
  const res = await query(`DELETE FROM cards WHERE id = $1 AND user_id = $2`, [cardId, userId]);
  if (res.rowCount === 0) throw new Error("卡片不存在或无权限");
}

// ─────────────────────────────────────────────────────────────────────────────
// 侧栏星标
// ─────────────────────────────────────────────────────────────────────────────

export async function listFavoriteCollectionIds(ownerKey) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const res = await query(
    `SELECT id FROM collections
      WHERE user_id = $1 AND is_favorite = true
      ORDER BY favorite_sort ASC NULLS LAST, sort_order ASC, id ASC`,
    [userId]
  );
  return res.rows.map((r) => r.id);
}

export async function replaceFavoriteCollectionIds(_ownerKey, collectionIds, userIdIn) {
  const userId = await resolveUserId(userIdIn);
  const ids = Array.isArray(collectionIds) ? collectionIds : [];
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE collections SET is_favorite = false, favorite_sort = NULL WHERE user_id = $1`,
      [userId]
    );
    let sort = 0;
    for (const cid of ids) {
      if (typeof cid !== "string" || !cid.trim()) continue;
      const id = cid.trim();
      const r = await client.query(
        `UPDATE collections SET is_favorite = true, favorite_sort = $1 WHERE id = $2 AND user_id = $3`,
        [sort, id, userId]
      );
      if (r.rowCount > 0) sort += 1;
    }
    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 用户偏好（合并进 users.prefs_json）
// ─────────────────────────────────────────────────────────────────────────────

export async function getNotePrefsForOwnerKey(ownerKey) {
  const empty = { disabledAutoLinkRuleIds: [], extraAutoLinkRules: [] };
  try {
    const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
    const r = await query(`SELECT prefs_json FROM users WHERE id = $1`, [userId]);
    const p = r.rows[0]?.prefs_json;
    if (!p || typeof p !== "object") return empty;
    const disabled = Array.isArray(p.disabledAutoLinkRuleIds) ? p.disabledAutoLinkRuleIds : [];
    const extra = Array.isArray(p.extraAutoLinkRules) ? p.extraAutoLinkRules : [];
    const out = {
      disabledAutoLinkRuleIds: disabled.filter((x) => typeof x === "string"),
      extraAutoLinkRules: extra.filter((x) => x && typeof x === "object"),
    };
    if (typeof p.timelineGalleryOnRight === "boolean") {
      out.timelineGalleryOnRight = p.timelineGalleryOnRight;
    }
    if (typeof p.bgGradient === "boolean") {
      out.bgGradient = p.bgGradient;
    }
    if (
      p.clipCreatorTargetCollectionByPreset &&
      typeof p.clipCreatorTargetCollectionByPreset === "object"
    ) {
      out.clipCreatorTargetCollectionByPreset =
        p.clipCreatorTargetCollectionByPreset;
    }
    return out;
  } catch {
    return empty;
  }
}

const NOTE_PREFS_MAX_DISABLED = 80;
const NOTE_PREFS_MAX_EXTRA_RULES = 24;

export function normalizeNotePrefsPayload(body) {
  const o = body && typeof body === "object" ? body : {};
  const dis = Array.isArray(o.disabledAutoLinkRuleIds) ? o.disabledAutoLinkRuleIds : [];
  const disabledAutoLinkRuleIds = [];
  const seen = new Set();
  for (const x of dis) {
    if (typeof x !== "string") continue;
    const id = x.trim();
    if (!id || id.length > 120 || seen.has(id)) continue;
    seen.add(id);
    disabledAutoLinkRuleIds.push(id);
    if (disabledAutoLinkRuleIds.length >= NOTE_PREFS_MAX_DISABLED) break;
  }
  const ex = Array.isArray(o.extraAutoLinkRules) ? o.extraAutoLinkRules : [];
  const extraAutoLinkRules = [];
  for (const r of ex) {
    if (!r || typeof r !== "object") continue;
    const ruleId = typeof r.ruleId === "string" ? r.ruleId.trim() : "";
    if (!ruleId || ruleId.length > 120) continue;
    extraAutoLinkRules.push({ ...r, ruleId });
    if (extraAutoLinkRules.length >= NOTE_PREFS_MAX_EXTRA_RULES) break;
  }
  const normalized = { disabledAutoLinkRuleIds, extraAutoLinkRules };
  if (typeof o.timelineGalleryOnRight === "boolean") {
    normalized.timelineGalleryOnRight = o.timelineGalleryOnRight;
  }
  if (typeof o.bgGradient === "boolean") {
    normalized.bgGradient = o.bgGradient;
  }
  if (
    o.clipCreatorTargetCollectionByPreset &&
    typeof o.clipCreatorTargetCollectionByPreset === "object"
  ) {
    const c = o.clipCreatorTargetCollectionByPreset;
    const out = {};
    if (typeof c.post_xhs === "string" && c.post_xhs.trim().length <= 120) {
      out.post_xhs = c.post_xhs.trim();
    }
    if (
      typeof c.post_bilibili === "string" &&
      c.post_bilibili.trim().length <= 120
    ) {
      out.post_bilibili = c.post_bilibili.trim();
    }
    if (out.post_xhs || out.post_bilibili) {
      normalized.clipCreatorTargetCollectionByPreset = out;
    }
  }
  return normalized;
}

export async function replaceNotePrefsForOwnerKey(ownerKey, prefs) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const normalized = normalizeNotePrefsPayload(prefs);
  await query(`UPDATE users SET prefs_json = $2::jsonb WHERE id = $1`, [
    userId,
    JSON.stringify(normalized),
  ]);
  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage B: Files 页（附件浏览 / 计数 / 总字节）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把前端 filter 字符串拆成 SQL WHERE 片段 + 参数。
 * - image/video/audio 按 preset_slug 直接命中；
 * - document：kind=file 且名字（card_files.original_name 或 url 末段）命中文档扩展名；
 * - other：kind=file 且不是文档扩展名；
 * - all：无额外条件。
 */
const DOC_EXT_REGEX = String.raw`\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|pages|numbers|key|epub|json|xml|yml|yaml)$`;

function buildAttachmentFilterClause(filterKey, nextParamIdx) {
  const key = (filterKey || "all").toLowerCase();
  if (key === "image") {
    return { sql: `AND ct.preset_slug = $${nextParamIdx}`, params: ["file_image"], next: nextParamIdx + 1 };
  }
  if (key === "video") {
    return { sql: `AND ct.preset_slug = $${nextParamIdx}`, params: ["file_video"], next: nextParamIdx + 1 };
  }
  if (key === "audio") {
    return { sql: `AND ct.preset_slug = $${nextParamIdx}`, params: ["file_audio"], next: nextParamIdx + 1 };
  }
  if (key === "document") {
    return {
      sql: `AND ct.preset_slug IN ('file_document','file_other')
            AND (LOWER(COALESCE(NULLIF(cf.original_name,''), regexp_replace(cf.url, '^.*/', ''))) ~* $${nextParamIdx})`,
      params: [DOC_EXT_REGEX],
      next: nextParamIdx + 1,
    };
  }
  if (key === "other") {
    return {
      sql: `AND ct.preset_slug IN ('file_document','file_other')
            AND (LOWER(COALESCE(NULLIF(cf.original_name,''), regexp_replace(cf.url, '^.*/', ''))) !~* $${nextParamIdx})`,
      params: [DOC_EXT_REGEX],
      next: nextParamIdx + 1,
    };
  }
  // 'all' / 'file' / 未知 → 不附加条件
  return { sql: "", params: [], next: nextParamIdx };
}

/** card_files 行 → 前端 NoteMediaItem */
function cardFileRowToMediaItem(r) {
  const kind = FILE_SLUG_TO_MEDIA_KIND[r.preset_slug] || "file";
  const item = { url: r.url, kind };
  if (r.original_name) item.name = r.original_name;
  if (r.thumb_url) item.thumbnailUrl = r.thumb_url;
  if (r.cover_url) item.coverUrl = r.cover_url;
  if (r.cover_thumb_url) item.coverThumbnailUrl = r.cover_thumb_url;
  if (r.bytes != null) item.sizeBytes = Number(r.bytes);
  return item;
}

export async function countCardAttachments(ownerKey, filterKey = "all") {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const params = [userId];
  const flt = buildAttachmentFilterClause(filterKey, 2);
  params.push(...flt.params);
  const r = await query(
    `SELECT COUNT(*)::int AS n
       FROM cards fc
       JOIN card_types ct ON ct.id = fc.card_type_id
       JOIN card_files  cf ON cf.card_id = fc.id
      WHERE fc.user_id = $1
        AND fc.trashed_at IS NULL
        AND ct.kind = 'file'
        ${flt.sql}`,
    params
  );
  return r.rows[0]?.n || 0;
}

export async function listCardAttachmentsPage(ownerKey, opts = {}) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const limit = Math.min(
    200,
    Math.max(1, Number.isFinite(Number(opts.limit)) ? Number(opts.limit) : 40)
  );
  const offset = Math.max(0, Number.isFinite(Number(opts.offset)) ? Number(opts.offset) : 0);
  const params = [userId, limit, offset];
  const flt = buildAttachmentFilterClause(opts.filterKey, 4);
  params.push(...flt.params);

  const res = await query(
    `SELECT fc.id AS file_card_id, fc.created_at,
            cf.url, cf.original_name, cf.thumb_url, cf.cover_url, cf.cover_thumb_url, cf.bytes,
            ct.preset_slug,
            (SELECT l.from_card_id FROM card_links l
               WHERE l.to_card_id = fc.id AND l.property_key = 'attachment'
               ORDER BY l.sort_order ASC, l.from_card_id ASC LIMIT 1) AS note_card_id,
            (SELECT l.sort_order FROM card_links l
               WHERE l.to_card_id = fc.id AND l.property_key = 'attachment'
               ORDER BY l.sort_order ASC, l.from_card_id ASC LIMIT 1) AS media_index
       FROM cards fc
       JOIN card_types ct ON ct.id = fc.card_type_id
       JOIN card_files  cf ON cf.card_id = fc.id
      WHERE fc.user_id = $1
        AND fc.trashed_at IS NULL
        AND ct.kind = 'file'
        ${flt.sql}
      ORDER BY fc.created_at DESC, fc.id DESC
      LIMIT $2 OFFSET $3`,
    params
  );

  const items = [];
  for (const row of res.rows) {
    // 点击附件应直接打开"文件卡"本身（v2 模型下每个附件都是独立卡）。
    // colId 取该文件卡自己的 placement；若无 placement 退回引用它的 note 卡的 placement。
    const fileCardId = row.file_card_id;
    let plRes = await query(
      `SELECT collection_id FROM card_placements
         WHERE card_id = $1 ORDER BY sort_order ASC, collection_id ASC LIMIT 1`,
      [fileCardId]
    );
    let colId = plRes.rows[0]?.collection_id || "";
    if (!colId && row.note_card_id) {
      plRes = await query(
        `SELECT collection_id FROM card_placements
           WHERE card_id = $1 ORDER BY sort_order ASC, collection_id ASC LIMIT 1`,
        [row.note_card_id]
      );
      colId = plRes.rows[0]?.collection_id || "";
    }
    items.push({
      colId,
      cardId: fileCardId,
      // 文件卡只有一项主文件，mediaIndex 固定 0
      mediaIndex: 0,
      item: cardFileRowToMediaItem(row),
    });
  }

  const total = await countCardAttachments(ownerKey, opts.filterKey);
  return { items, total };
}

export async function attachmentStorageBytesByUserId() {
  const r = await query(
    `SELECT fc.user_id, COALESCE(SUM(cf.bytes), 0)::bigint AS bytes
       FROM cards fc
       JOIN card_types ct ON ct.id = fc.card_type_id
       JOIN card_files  cf ON cf.card_id = fc.id
      WHERE fc.trashed_at IS NULL AND ct.kind = 'file'
   GROUP BY fc.user_id`
  );
  const out = new Map();
  for (const row of r.rows) out.set(row.user_id, Number(row.bytes || 0));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C/D 占位导出（未实现；访问时快速失败）
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Stage B: 单条附件级 API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 基于 note 的一条 media 元数据"显式"创建一张独立文件卡，并与 note 建 attachment 链。
 * 与旧 API 行为一致：返回 { fileCardId, noteCardId }；若同 url 已有附件卡则复用。
 * 还会把文件卡加入 placementCollectionId 合集（若提供）。
 */
export async function createFileCardForNoteMedia(userIdIn, noteCardId, body) {
  const userId = await resolveUserId(userIdIn);
  const placementCollectionId =
    typeof body?.placementCollectionId === "string"
      ? body.placementCollectionId.trim()
      : "";
  const raw = body?.media;
  if (!placementCollectionId || !raw || typeof raw !== "object") {
    throw new Error("缺少 placementCollectionId 或 media");
  }
  const item = normalizeIncomingMediaItem(raw);
  if (!item) throw new Error("media.url 为必填");

  // 验证 note 存在且属于当前用户
  const noteRes = await query(
    `SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NULL`,
    [noteCardId, userId]
  );
  if (noteRes.rowCount === 0) throw new Error("笔记不存在或无权限");

  // 验证目标合集属于当前用户
  const colRes = await query(
    `SELECT id FROM collections WHERE id = $1 AND user_id = $2`,
    [placementCollectionId, userId]
  );
  if (colRes.rowCount === 0) throw new Error("目标合集不存在或无权限");

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
      `fileobj:${noteCardId}|${item.url}`,
    ]);

    // 若 note 已有指向同 url 的 attachment 链 → 复用
    const existed = await client.query(
      `SELECT l.to_card_id
         FROM card_links l
         JOIN card_files cf ON cf.card_id = l.to_card_id
        WHERE l.from_card_id = $1 AND l.property_key = 'attachment'
          AND cf.url = $2
        LIMIT 1`,
      [noteCardId, item.url]
    );
    let fileCardId = existed.rows[0]?.to_card_id;

    if (!fileCardId) {
      fileCardId = await insertFileCard(
        (sql, params) => client.query(sql, params),
        userId,
        item
      );
      // 放入 placement 合集
      const ord = (
        await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
          [placementCollectionId]
        )
      ).rows[0].next;
      await client.query(
        `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
         VALUES ($1,$2,false,$3)`,
        [fileCardId, placementCollectionId, ord]
      );
      // note → file 附件链
      const tr = await client.query(`SELECT card_type_id FROM cards WHERE id = $1`, [fileCardId]);
      const nextSort = (
        await client.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_links
            WHERE from_card_id = $1 AND property_key = 'attachment'`,
          [noteCardId]
        )
      ).rows[0].next;
      await client.query(
        `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
         VALUES ($1,'attachment',$2,$3,$4,$5)
         ON CONFLICT (from_card_id, property_key, to_card_id) DO NOTHING`,
        [noteCardId, fileCardId, tr.rows[0]?.card_type_id || null, userId, nextSort]
      );
    }

    await client.query("COMMIT");
    return { fileCardId, noteCardId };
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 只填空：若探测到 durationSec/sizeBytes/widthPx/heightPx 等，更新到目标附件卡的 card_files
 * + 同步把 widthPx/heightPx/durationSec 写到"该附件卡" cards.custom_props（前端需要的话）。
 * 兼容旧路径的 index 语义：sort_order = index 的 attachment link 的目标 file 卡。
 */
export async function patchCardMediaItemAtIndex(userIdIn, cardId, mediaIndex, patch) {
  const userId = await resolveUserId(userIdIn);
  const cid = String(cardId || "").trim();
  if (!cid) throw new Error("缺少卡片 id");
  const idx = Math.floor(Number(mediaIndex));
  if (!Number.isFinite(idx) || idx < 0) throw new Error("附件索引无效");

  // 所属卡必须属于当前用户
  const own = await query(
    `SELECT 1 FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NULL`,
    [cid, userId]
  );
  if (own.rowCount === 0) throw new Error("笔记不存在或无权限");

  // 定位目标 file 卡：优先 attachment link at sort_order=idx（note 场景）；
  // 若该卡本身就是 file 卡（单附件），idx 必须为 0
  let targetFileCardId = null;
  const lnk = await query(
    `SELECT to_card_id FROM card_links
      WHERE from_card_id = $1 AND property_key = 'attachment' AND sort_order = $2
      LIMIT 1`,
    [cid, idx]
  );
  if (lnk.rowCount > 0) {
    targetFileCardId = lnk.rows[0].to_card_id;
  } else if (idx === 0) {
    const self = await query(
      `SELECT 1 FROM card_files WHERE card_id = $1`,
      [cid]
    );
    if (self.rowCount > 0) targetFileCardId = cid;
  }
  if (!targetFileCardId) throw new Error("附件索引无效");

  const p = patch && typeof patch === "object" ? patch : {};

  const normalizeStableMediaUrl = (v) => {
    if (typeof v !== "string") return "";
    const s = v.trim();
    if (!s) return "";
    // 不持久化临时签名地址（如 COS/S3 预签名），避免过期后污染数据
    const lower = s.toLowerCase();
    if (
      lower.includes("x-amz-signature=") ||
      lower.includes("x-amz-security-token=") ||
      lower.includes("x-cos-signature=") ||
      lower.includes("x-cos-security-token=") ||
      lower.includes("signature=")
    ) {
      return "";
    }
    return s;
  };

  // 1) card_files.bytes（仅在当前为空时写入）
  let updatedBytes = false;
  if (
    typeof p.sizeBytes === "number" &&
    Number.isFinite(p.sizeBytes) &&
    p.sizeBytes >= 0 &&
    p.sizeBytes <= Number.MAX_SAFE_INTEGER
  ) {
    const r = await query(
      `UPDATE card_files SET bytes = $2 WHERE card_id = $1 AND (bytes IS NULL OR bytes = 0)`,
      [targetFileCardId, Math.floor(p.sizeBytes)]
    );
    updatedBytes = r.rowCount > 0;
  }

  // 1.5) card_files.thumb_url / cover_url（仅在当前为空时写入）
  const thumbnailUrl = normalizeStableMediaUrl(p.thumbnailUrl);
  const coverUrl = normalizeStableMediaUrl(p.coverUrl);
  let updatedThumbMeta = false;
  if (thumbnailUrl || coverUrl) {
    const r = await query(
      `UPDATE card_files
          SET thumb_url = CASE
                           WHEN (thumb_url IS NULL OR thumb_url = '') AND $2 <> '' THEN $2
                           ELSE thumb_url
                         END,
              cover_url = CASE
                           WHEN (cover_url IS NULL OR cover_url = '') AND $3 <> '' THEN $3
                           ELSE cover_url
                         END
        WHERE card_id = $1
          AND (
            ((thumb_url IS NULL OR thumb_url = '') AND $2 <> '')
            OR ((cover_url IS NULL OR cover_url = '') AND $3 <> '')
          )`,
      [targetFileCardId, thumbnailUrl, coverUrl]
    );
    updatedThumbMeta = r.rowCount > 0;
  }

  // 2) duration / resolution → 写到对应 schema 字段（与 catalog 一致）
  // 取目标卡 preset_slug，决定写哪条 schema field id
  const tt = await query(
    `SELECT ct.preset_slug FROM cards c JOIN card_types ct ON ct.id = c.card_type_id WHERE c.id = $1`,
    [targetFileCardId]
  );
  const slug = tt.rows[0]?.preset_slug || "";
  const propsToSet = []; // [{id, name, type, value}]

  if (
    typeof p.durationSec === "number" &&
    Number.isFinite(p.durationSec) &&
    p.durationSec >= 0 &&
    p.durationSec <= 86400000
  ) {
    if (slug === "file_video") {
      propsToSet.push({
        id: "sf-vid-duration-sec",
        name: "时长（秒）",
        type: "number",
        value: Math.round(p.durationSec),
      });
    } else if (slug === "file_audio") {
      propsToSet.push({
        id: "sf-aud-duration-sec",
        name: "时长（秒）",
        type: "number",
        value: Math.round(p.durationSec),
      });
    }
  }
  if (
    typeof p.widthPx === "number" &&
    Number.isFinite(p.widthPx) &&
    p.widthPx > 0 &&
    p.widthPx <= 32767 &&
    typeof p.heightPx === "number" &&
    Number.isFinite(p.heightPx) &&
    p.heightPx > 0 &&
    p.heightPx <= 32767 &&
    slug.startsWith("file_")
  ) {
    propsToSet.push({
      id: "sf-file-resolution",
      name: "分辨率",
      type: "text",
      value: `${Math.round(p.widthPx)}x${Math.round(p.heightPx)}`,
    });
    if (slug === "file_video") {
      // 兼容旧读取逻辑：视频继续补写历史字段
      propsToSet.push({
        id: "sf-vid-resolution",
        name: "分辨率",
        type: "text",
        value: `${Math.round(p.widthPx)}x${Math.round(p.heightPx)}`,
      });
    }
  }

  let updatedProps = false;
  if (propsToSet.length > 0) {
    const cur = await query(
      `SELECT custom_props FROM cards WHERE id = $1`,
      [targetFileCardId]
    );
    const arr = Array.isArray(cur.rows[0]?.custom_props) ? cur.rows[0].custom_props.slice() : [];
    let changed = false;
    for (const np of propsToSet) {
      const existing = arr.find((x) => x?.id === np.id);
      if (!existing) {
        arr.push(np);
        changed = true;
      } else if (existing.value === null || existing.value === undefined || existing.value === "") {
        Object.assign(existing, np);
        changed = true;
      }
    }
    if (changed) {
      await query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
        targetFileCardId,
        JSON.stringify(arr),
      ]);
      updatedProps = true;
    }
  }

  return { updated: updatedBytes || updatedThumbMeta || updatedProps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage B: 批量替换树（/api/collections PUT）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 最小可用版：清掉该用户所有 collections（及 placements/links 级联）并按新树重建。
 * cards 表不清空（避免误删跨集合数据），仅重建归属与新集合。导入场景如有需要可扩展。
 */
export async function replaceCollectionsTree(userIdIn, collectionsArray) {
  const userId = await resolveUserId(userIdIn);
  if (!Array.isArray(collectionsArray)) throw new Error("collectionsArray 须为数组");

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(`DELETE FROM collections WHERE user_id = $1`, [userId]);

    const walker = async (nodes, parentId) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node || typeof node !== "object") continue;
        const id = String(node.id || "").trim();
        if (!id) continue;
        const name = String(node.name ?? "");
        const dotColor = String(node.dotColor ?? "");
        const description = String(node.hint ?? "");
        await client.query(
          `INSERT INTO collections (id, user_id, parent_id, name, description, dot_color, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, userId, parentId, name, description, dotColor, i]
        );
        // 归属行：如果 node.cards 里有 card id 且存在于当前用户的 cards，建 placement
        const cardList = Array.isArray(node.cards) ? node.cards : [];
        for (let ci = 0; ci < cardList.length; ci += 1) {
          const c = cardList[ci];
          if (!c || typeof c !== "object") continue;
          const cid = String(c.id || "").trim();
          if (!cid) continue;
          const exists = await client.query(
            `SELECT 1 FROM cards WHERE id = $1 AND user_id = $2`,
            [cid, userId]
          );
          if (exists.rowCount === 0) continue;
          await client.query(
            `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (card_id, collection_id) DO UPDATE SET
               pinned = EXCLUDED.pinned, sort_order = EXCLUDED.sort_order`,
            [cid, id, !!c.pinned, ci]
          );
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
          await walker(node.children, id);
        }
      }
    };
    await walker(collectionsArray, null);

    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C: 回收站
// ─────────────────────────────────────────────────────────────────────────────

export async function listTrashedNotes(ownerKey) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const res = await query(
    `SELECT c.id, c.title, c.body, c.minutes_of_day, c.added_on, c.tags, c.custom_props,
            c.trashed_at, c.trash_snapshot_json,
            ct.preset_slug
       FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.user_id = $1 AND c.trashed_at IS NOT NULL
      ORDER BY c.trashed_at DESC`,
    [userId]
  );
  const ids = res.rows.map((r) => r.id);
  const personIds = res.rows.filter((r) => r.preset_slug === "person").map((r) => r.id);
  const fileIds = res.rows
    .filter((r) => (r.preset_slug || "").startsWith("file"))
    .map((r) => r.id);
  const [
    reminders,
    mediaByCard,
    relatedByCard,
    personWorksByCard,
    fileSourceByCard,
  ] = await Promise.all([
    loadRemindersForCards(ids, query),
    loadMediaForCards(ids, query),
    loadRelatedRefsForCards(ids, query),
    loadPersonWorksForCards(personIds, query),
    loadFileSourceForCards(fileIds, query),
  ]);
  return res.rows.map((r) => {
    const snap = r.trash_snapshot_json && typeof r.trash_snapshot_json === "object"
      ? r.trash_snapshot_json
      : {};
    return {
      trashId: r.id,
      colId: String(snap.colId || ""),
      colPathLabel: String(snap.pathLabel || ""),
      card: assembleCardRow(r, {
        reminders,
        mediaByCard,
        relatedByCard,
        personWorksByCard,
        fileSourceByCard,
      }),
      deletedAt:
        r.trashed_at instanceof Date
          ? r.trashed_at.toISOString()
          : String(r.trashed_at || ""),
    };
  });
}

export async function softTrashCard(ownerKey, row) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const { colId, colPathLabel = "", cardId, deletedAt } = row || {};
  if (!colId || !cardId) throw new Error("回收站条目缺少 colId 或 card.id");

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const chk = await client.query(
      `SELECT trashed_at FROM cards WHERE id = $1 AND user_id = $2`,
      [cardId, userId]
    );
    if (chk.rowCount === 0) throw new Error("卡片不存在或无权限");
    if (chk.rows[0].trashed_at != null) {
      // 幂等：重复删除同一卡片时视为成功，避免前端误报失败。
      await client.query("COMMIT");
      return;
    }

    await client.query(`DELETE FROM card_placements WHERE card_id = $1`, [cardId]);
    // 移入回收站时同步断开连接：删除所有入/出边，避免人物等对象被旧连接复现。
    await client.query(
      `DELETE FROM card_links
        WHERE user_id = $1 AND (from_card_id = $2 OR to_card_id = $2)`,
      [userId, cardId]
    );
    // 清理其它卡 custom_props 中指向该卡的 cardLink / cardLinks 值（含 seedTitle），保持属性面板一致。
    const refs = await client.query(
      `SELECT id, custom_props
         FROM cards
        WHERE user_id = $1
          AND id <> $2
          AND trashed_at IS NULL
          AND custom_props IS NOT NULL`,
      [userId, cardId]
    );
    for (const r of refs.rows) {
      const raw = Array.isArray(r.custom_props) ? r.custom_props : [];
      let changed = false;
      const next = raw.map((p) => {
        if (!p || typeof p !== "object") return p;
        if (p.type === "cardLink" && p.value && typeof p.value === "object") {
          const refCardId =
            typeof p.value.cardId === "string" ? p.value.cardId.trim() : "";
          if (refCardId === cardId) {
            changed = true;
            const { seedTitle: _seed, ...rest } = p;
            return { ...rest, value: null };
          }
          return p;
        }
        if (p.type === "cardLinks" && Array.isArray(p.value)) {
          const filtered = p.value.filter((x) => {
            if (!x || typeof x !== "object") return false;
            const refCardId =
              typeof x.cardId === "string" ? x.cardId.trim() : "";
            return refCardId !== cardId;
          });
          if (filtered.length !== p.value.length) {
            changed = true;
            return { ...p, value: filtered.length ? filtered : null };
          }
        }
        return p;
      });
      if (changed) {
        await client.query(
          `UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`,
          [r.id, JSON.stringify(next)]
        );
      }
    }
    const ts = deletedAt ? new Date(deletedAt) : new Date();
    const snap = { colId: String(colId), pathLabel: String(colPathLabel ?? "") };
    const up = await client.query(
      `UPDATE cards SET trashed_at = $1::timestamptz, trash_snapshot_json = $2::jsonb
        WHERE id = $3 AND user_id = $4 AND trashed_at IS NULL`,
      [ts.toISOString(), JSON.stringify(snap), cardId, userId]
    );
    if (up.rowCount === 0) throw new Error("无法移入回收站");
    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

export async function restoreTrashedCard(
  ownerKey,
  cardId,
  targetCollectionId,
  insertAtStart = false
) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const colCheck = await query(
    `SELECT id FROM collections WHERE id = $1 AND user_id = $2`,
    [targetCollectionId, userId]
  );
  if (colCheck.rowCount === 0) throw new Error("合集不存在或无权限");

  const cardChk = await query(
    `SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NOT NULL`,
    [cardId, userId]
  );
  if (cardChk.rowCount === 0) throw new Error("回收站中找不到该笔记或无权恢复");

  let sortOrder;
  if (insertAtStart) {
    const minRes = await query(
      `SELECT MIN(sort_order) AS m FROM card_placements WHERE collection_id = $1`,
      [targetCollectionId]
    );
    const m = minRes.rows[0]?.m;
    sortOrder = m === null || m === undefined ? 0 : m - 1;
  } else {
    const orderRes = await query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
      [targetCollectionId]
    );
    sortOrder = orderRes.rows[0].next;
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const up = await client.query(
      `UPDATE cards SET trashed_at = NULL, trash_snapshot_json = NULL
        WHERE id = $1 AND user_id = $2 AND trashed_at IS NOT NULL`,
      [cardId, userId]
    );
    if (up.rowCount === 0) throw new Error("恢复失败");
    await client.query(
      `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
       VALUES ($1,$2,false,$3)
       ON CONFLICT (card_id, collection_id) DO NOTHING`,
      [cardId, targetCollectionId, sortOrder]
    );
    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }

  return await readCardForApi(userId, cardId);
}

async function listExclusiveAttachmentFileCardIds(client, userId, noteCardIds) {
  if (!Array.isArray(noteCardIds) || noteCardIds.length === 0) return [];
  const r = await client.query(
    `SELECT DISTINCT l.to_card_id AS file_card_id
       FROM card_links l
       JOIN cards fc ON fc.id = l.to_card_id AND fc.user_id = $1
       JOIN card_types fct ON fct.id = fc.card_type_id AND fct.kind = 'file'
      WHERE l.property_key = 'attachment'
        AND l.from_card_id = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1
            FROM card_links l2
            JOIN cards src2 ON src2.id = l2.from_card_id
           WHERE l2.property_key = 'attachment'
             AND l2.to_card_id = l.to_card_id
             AND src2.user_id = $1
             AND l2.from_card_id <> ALL($2::text[])
        )`,
    [userId, noteCardIds]
  );
  return r.rows
    .map((x) => (typeof x.file_card_id === "string" ? x.file_card_id : ""))
    .filter(Boolean);
}

export async function deleteTrashedNote(ownerKey, trashId, opts = {}) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const deleteRelatedFiles = opts?.deleteRelatedFiles === true;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const chk = await client.query(
      `SELECT id FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NOT NULL`,
      [trashId, userId]
    );
    if (chk.rowCount === 0) throw new Error("回收站记录不存在或无权限");

    const fileCardIds = deleteRelatedFiles
      ? await listExclusiveAttachmentFileCardIds(client, userId, [trashId])
      : [];

    await client.query(
      `DELETE FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NOT NULL`,
      [trashId, userId]
    );
    if (fileCardIds.length > 0) {
      await client.query(
        `DELETE FROM cards
          WHERE user_id = $1
            AND id = ANY($2::text[])`,
        [userId, fileCardIds]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

export async function clearTrashedNotes(ownerKey, opts = {}) {
  const userId = await resolveUserId(ownerKey === "__single__" ? null : ownerKey);
  const deleteRelatedFiles = opts?.deleteRelatedFiles === true;
  if (!deleteRelatedFiles) {
    await query(
      `DELETE FROM cards WHERE user_id = $1 AND trashed_at IS NOT NULL`,
      [userId]
    );
    return;
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const trashed = await client.query(
      `SELECT id FROM cards WHERE user_id = $1 AND trashed_at IS NOT NULL`,
      [userId]
    );
    const noteIds = trashed.rows
      .map((r) => (typeof r.id === "string" ? r.id : ""))
      .filter(Boolean);
    const fileCardIds = await listExclusiveAttachmentFileCardIds(
      client,
      userId,
      noteIds
    );
    await client.query(
      `DELETE FROM cards WHERE user_id = $1 AND trashed_at IS NOT NULL`,
      [userId]
    );
    if (fileCardIds.length > 0) {
      await client.query(
        `DELETE FROM cards
          WHERE user_id = $1
            AND id = ANY($2::text[])`,
        [userId, fileCardIds]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C: 图谱查询（card_links 多类型多跳遍历）
// ─────────────────────────────────────────────────────────────────────────────

export async function queryCardGraph(userIdIn, rootCardId, opts = {}) {
  const userId = await resolveUserId(userIdIn);
  const maxDepth = Math.min(Math.max(parseInt(String(opts.depth ?? 1), 10) || 1, 1), 4);
  const linkTypes =
    Array.isArray(opts.linkTypes) && opts.linkTypes.length > 0
      ? opts.linkTypes
      : ["related", "attachment", "creator", "source", "source_url", "contains", "up主"];

  const rootOk = await query(
    `SELECT c.id, ct.preset_slug FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.id = $1 AND c.user_id = $2 AND c.trashed_at IS NULL`,
    [rootCardId, userId]
  );
  if (rootOk.rowCount === 0) throw new Error("卡片不存在或无权限");

  /** @type {Map<string, { id: string, objectKind: string }>} */
  const nodes = new Map();
  nodes.set(rootCardId, {
    id: rootCardId,
    objectKind: slugToLegacyObjectKind(rootOk.rows[0].preset_slug || "note"),
  });
  const edges = [];
  const seenEdge = new Set();
  let frontier = [rootCardId];
  const dist = new Map([[rootCardId, 0]]);

  for (let level = 0; level < maxDepth; level += 1) {
    if (frontier.length === 0) break;
    const lr = await query(
      `SELECT from_card_id, to_card_id, property_key
         FROM card_links
        WHERE user_id = $1
          AND property_key = ANY($2::text[])
          AND (from_card_id = ANY($3::text[]) OR to_card_id = ANY($3::text[]))`,
      [userId, linkTypes, frontier]
    );

    const next = [];
    for (const r of lr.rows) {
      const a = r.from_card_id;
      const b = r.to_card_id;
      const ek = a < b ? `${a}|${b}|${r.property_key}` : `${b}|${a}|${r.property_key}`;
      if (!seenEdge.has(ek)) {
        seenEdge.add(ek);
        edges.push({ from: a, to: b, linkType: r.property_key });
      }
      const other = frontier.includes(a) ? b : a;
      if (!nodes.has(other)) {
        const oc = await query(
          `SELECT c.id, ct.preset_slug FROM cards c
             JOIN card_types ct ON ct.id = c.card_type_id
            WHERE c.id = $1 AND c.user_id = $2 AND c.trashed_at IS NULL`,
          [other, userId]
        );
        if (oc.rowCount === 0) continue;
        nodes.set(other, {
          id: other,
          objectKind: slugToLegacyObjectKind(oc.rows[0].preset_slug || "note"),
        });
      }
      if (!dist.has(other)) {
        dist.set(other, level + 1);
        next.push(other);
      }
    }
    frontier = next;
  }

  return { root: rootCardId, maxDepth, linkTypes, nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C: schema 继承解析 + 预设合集查找
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 解析卡片有效 schema：从 cards.card_type_id 出发沿 parent_type_id 走到根，
 * 自顶向下合并 schema_json（子覆盖父）。
 */
export async function getEffectiveSchemaForCard(userIdIn, cardId) {
  const userId = await resolveUserId(userIdIn);
  const cur = await query(
    `SELECT card_type_id FROM cards WHERE id = $1 AND user_id = $2 AND trashed_at IS NULL`,
    [cardId, userId]
  );
  if (cur.rowCount === 0) throw new Error("卡片不存在或无权限");
  const startTypeId = cur.rows[0].card_type_id;

  // 用 recursive CTE 取整条链
  const chain = await query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_type_id, name, kind, schema_json, 0 AS depth
         FROM card_types WHERE id = $1
       UNION ALL
       SELECT t.id, t.parent_type_id, t.name, t.kind, t.schema_json, up.depth + 1
         FROM card_types t JOIN up ON t.id = up.parent_type_id
     )
     SELECT id, name, kind, schema_json, depth FROM up ORDER BY depth DESC`,
    [startTypeId]
  );

  // 合并：父在前、子在后；fields 数组按 id 去重，子覆盖父
  const fieldsById = new Map();
  let lastKind = null;
  for (const row of chain.rows) {
    lastKind = row.kind;
    const sj = row.schema_json;
    if (!sj || typeof sj !== "object") continue;
    if (Array.isArray(sj.fields)) {
      for (const f of sj.fields) {
        if (!f || typeof f !== "object") continue;
        const key = typeof f.id === "string" ? f.id : typeof f.key === "string" ? f.key : null;
        if (!key) continue;
        fieldsById.set(key, f);
      }
    }
  }
  // 按 order 排序，使前端展示稳定
  // 兼容历史数据：旧版 work 父类型 schema 可能未含“标题”，这里兜底补齐。
  if (lastKind === "work" && !fieldsById.has("sf-work-title")) {
    fieldsById.set("sf-work-title", {
      id: "sf-work-title",
      name: "标题",
      type: "text",
      order: -1,
    });
  }
  const fields = [...fieldsById.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const autoLinkRules = mergeAutoLinkRulesFromChain(chain.rows);
  return {
    cardTypeId: startTypeId,
    kind: lastKind,
    fields,
    autoLinkRules,
  };
}

/**
 * 旧 API：按 legacy presetTypeId（'person' / 'post_xhs' / ...）查找用户名下的"分类合集"。
 * 新 schema 下：先映射到 preset_slug → 找用户对应的 card_type → 找 collections.bound_type_id 指向它的合集。
 */
export async function getPresetCollectionId(userIdIn, presetTypeIdRaw) {
  const userId = await resolveUserId(userIdIn);
  const pid = String(presetTypeIdRaw || "").trim();
  if (!pid) return null;
  const r = await query(
    `SELECT col.id
       FROM collections col
       JOIN card_types ct ON ct.id = col.bound_type_id
      WHERE col.user_id = $1 AND ct.preset_slug = $2
      ORDER BY col.sort_order ASC LIMIT 1`,
    [userId, pid]
  );
  return r.rows[0]?.id || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage C: 自动链规则引擎
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从 card_types 链 chain（自顶向下已排序）中合并 cardSchema.autoLinkRules；
 * 按 ruleId 去重，子覆盖父。
 */
function mergeAutoLinkRulesFromChain(chainRows) {
  const byId = new Map();
  for (const row of chainRows) {
    const sj = row?.schema_json;
    if (!sj || typeof sj !== "object") continue;
    const rules = Array.isArray(sj.autoLinkRules) ? sj.autoLinkRules : [];
    for (const r of rules) {
      if (!r || typeof r !== "object") continue;
      const rid = typeof r.ruleId === "string" ? r.ruleId.trim() : "";
      if (!rid) continue;
      byId.set(rid, r);
    }
  }
  return [...byId.values()];
}

/** 沿 cards.card_type_id 向上走，收集链上 schema_json.autoLinkRules（子覆盖父）。 */
async function collectEffectiveAutoLinkRules(cardTypeId) {
  if (!cardTypeId) return [];
  const chain = await query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_type_id, schema_json, 0 AS depth
         FROM card_types WHERE id = $1
       UNION ALL
       SELECT t.id, t.parent_type_id, t.schema_json, up.depth + 1
         FROM card_types t JOIN up ON t.id = up.parent_type_id
     )
     SELECT id, schema_json, depth FROM up ORDER BY depth DESC`,
    [cardTypeId]
  );
  return mergeAutoLinkRulesFromChain(chain.rows);
}

/**
 * 通用 catalog-形态 AutoLinkRule 执行器：
 * 读取源卡 custom_props 上 target.syncSchemaFieldId 的值作为种子或已关联 cardId；
 * 解析目标合集（优先 targetCollectionId → 用户偏好 override → targetPresetTypeId → 源卡主 placement）；
 * 找/建目标卡，写 card_links(linkType)，并把目标回写到源卡对应 prop.value = {colId, cardId}。
 * 返回是否实际写入了 link（用于去重旧 hardcoded 路径）。
 */
async function applyCatalogAutoLinkRule(
  userId,
  card,
  rule,
  disabledRuleIds,
  creatorTargetCollectionByPreset
) {
  const ruleId = typeof rule?.ruleId === "string" ? rule.ruleId.trim() : "";
  if (!ruleId) return false;
  if (disabledRuleIds?.has?.(ruleId)) return false;

  const targets =
    Array.isArray(rule.targets) && rule.targets.length
      ? rule.targets
      : [
          {
            targetKey: "default",
            targetObjectKind: rule.targetObjectKind,
            linkType: rule.linkType,
            targetPresetTypeId: rule.targetPresetTypeId,
            targetCollectionId: rule.targetCollectionId,
            syncSchemaFieldId: rule.syncSchemaFieldId,
            targetSyncSchemaFieldId: rule.targetSyncSchemaFieldId,
          },
        ];

  let anyLinked = false;
  for (const t of targets) {
    try {
      const linked = await applyCatalogAutoLinkTarget(
        userId,
        card,
        t,
        creatorTargetCollectionByPreset
      );
      if (linked) anyLinked = true;
    } catch (e) {
      console.warn(
        `[auto-link] catalog rule ${ruleId} target ${t?.targetKey || "?"} failed:`,
        e?.message || e
      );
    }
  }
  return anyLinked;
}

async function applyCatalogAutoLinkTarget(
  userId,
  card,
  target,
  creatorTargetCollectionByPreset
) {
  const syncFieldId = String(target?.syncSchemaFieldId || "").trim();
  if (!syncFieldId) return false;
  /** 读最新 custom_props（上一条同规则 target 可能已改过），避免覆盖丢字段 */
  const cur = await query(
    `SELECT custom_props FROM cards WHERE id = $1 AND user_id = $2`,
    [card.id, userId]
  );
  const customPropsArr = Array.isArray(cur.rows[0]?.custom_props)
    ? cur.rows[0].custom_props.slice()
    : [];
  const propIdx = customPropsArr.findIndex(
    (p) => p?.id === syncFieldId || p?.key === syncFieldId
  );
  if (propIdx < 0) return false;
  const prop = customPropsArr[propIdx];

  let targetCardId =
    prop?.value &&
    typeof prop.value === "object" &&
    typeof prop.value.cardId === "string" &&
    prop.value.cardId.trim()
      ? prop.value.cardId.trim()
      : "";
  const seed = personSeedFromProp(prop);

  let targetColId = "";
  if (target.targetCollectionId) {
    const r = await query(
      `SELECT id FROM collections WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [String(target.targetCollectionId).trim(), userId]
    );
    if (r.rowCount) targetColId = r.rows[0].id;
  }
  if (
    !targetColId &&
    creatorTargetCollectionByPreset &&
    typeof creatorTargetCollectionByPreset === "object"
  ) {
    const srcSlug = String(card.preset_slug || "").trim();
    const override =
      typeof creatorTargetCollectionByPreset[srcSlug] === "string"
        ? creatorTargetCollectionByPreset[srcSlug].trim()
        : "";
    if (override) {
      const r = await query(
        `SELECT id FROM collections WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [override, userId]
      );
      if (r.rowCount) targetColId = r.rows[0].id;
    }
  }
  if (!targetColId && target.targetPresetTypeId) {
    const r = await query(
      `SELECT col.id
         FROM collections col
         JOIN card_types ct ON ct.id = col.bound_type_id
        WHERE col.user_id = $1 AND ct.preset_slug = $2
        ORDER BY col.sort_order ASC LIMIT 1`,
      [userId, String(target.targetPresetTypeId).trim()]
    );
    if (r.rowCount) targetColId = r.rows[0].id;
  }

  if (!targetCardId) {
    if (!seed) return false;
    const targetSlug = String(
      target.targetPresetTypeId || target.targetObjectKind || ""
    ).trim();
    if (!targetSlug) return false;
    const targetTypeId = await resolvePresetCardTypeId(userId, targetSlug);
    const hit = await query(
      `SELECT id FROM cards
        WHERE user_id = $1 AND card_type_id = $2 AND trashed_at IS NULL AND title = $3
        ORDER BY created_at ASC LIMIT 1`,
      [userId, targetTypeId, seed]
    );
    targetCardId = hit.rows[0]?.id || "";
    if (!targetCardId) {
      targetCardId = newCardId("card");
      await query(
        `INSERT INTO cards (id, user_id, card_type_id, title, body) VALUES ($1,$2,$3,$4,'')`,
        [targetCardId, userId, targetTypeId, seed]
      );
      const tk = await query(`SELECT kind FROM card_types WHERE id = $1`, [
        targetTypeId,
      ]);
      await writeSubtableForKindFromSlug(
        query,
        targetCardId,
        tk.rows[0]?.kind || "note"
      );
    }
    if (targetColId) {
      const ord = (
        await query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
             FROM card_placements WHERE collection_id = $1`,
          [targetColId]
        )
      ).rows[0]?.next;
      await query(
        `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
         VALUES ($1,$2,false,$3)
         ON CONFLICT (card_id, collection_id) DO NOTHING`,
        [targetCardId, targetColId, Number.isFinite(ord) ? ord : 0]
      );
    }
  }
  if (!targetCardId) return false;

  const tr = await query(`SELECT card_type_id FROM cards WHERE id = $1`, [
    targetCardId,
  ]);
  const targetTypeId = tr.rows[0]?.card_type_id || null;
  const linkType = String(target.linkType || "related").trim() || "related";
  await query(
    `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
     VALUES ($1,$2,$3,$4,$5,0)
     ON CONFLICT (from_card_id, property_key, to_card_id) DO NOTHING`,
    [card.id, linkType, targetCardId, targetTypeId, userId]
  );

  if (!targetColId) {
    const pl = await query(
      `SELECT collection_id FROM card_placements
        WHERE card_id = $1
        ORDER BY sort_order ASC, collection_id ASC
        LIMIT 1`,
      [targetCardId]
    );
    targetColId = pl.rows[0]?.collection_id || "";
  }
  if (!targetColId) {
    const srcPl = await query(
      `SELECT collection_id FROM card_placements
        WHERE card_id = $1
        ORDER BY sort_order ASC, collection_id ASC
        LIMIT 1`,
      [card.id]
    );
    targetColId = srcPl.rows[0]?.collection_id || "";
    if (targetColId) {
      await query(
        `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
         SELECT $1, $2, false, COALESCE(MAX(sort_order), -1) + 1
           FROM card_placements WHERE collection_id = $2
         ON CONFLICT (card_id, collection_id) DO NOTHING`,
        [targetCardId, targetColId]
      );
    }
  }

  const curCardId =
    prop?.value &&
    typeof prop.value === "object" &&
    typeof prop.value.cardId === "string"
      ? prop.value.cardId.trim()
      : "";
  const curColId =
    prop?.value &&
    typeof prop.value === "object" &&
    typeof prop.value.colId === "string"
      ? prop.value.colId.trim()
      : "";
  if (curCardId !== targetCardId || curColId !== targetColId) {
    customPropsArr[propIdx] = {
      ...prop,
      type: "cardLink",
      value: { colId: targetColId, cardId: targetCardId },
      ...(seed ? { seedTitle: seed } : {}),
    };
    await query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
      card.id,
      JSON.stringify(customPropsArr),
    ]);
  }

  /** 可选：把源卡引用写回目标卡的 targetSyncSchemaFieldId（与 extra rule 的 tgtField 语义一致） */
  const tgtField = String(target.targetSyncSchemaFieldId || "").trim();
  if (tgtField) {
    const tr2 = await query(
      `SELECT custom_props FROM cards WHERE id = $1 AND user_id = $2`,
      [targetCardId, userId]
    );
    const tgtCp = Array.isArray(tr2.rows[0]?.custom_props)
      ? tr2.rows[0].custom_props.slice()
      : [];
    const idx = tgtCp.findIndex(
      (p) => p?.id === tgtField || p?.key === tgtField
    );
    const srcPl = await query(
      `SELECT collection_id FROM card_placements
        WHERE card_id = $1 ORDER BY sort_order ASC, collection_id ASC LIMIT 1`,
      [card.id]
    );
    const ref = {
      colId: srcPl.rows[0]?.collection_id || "",
      cardId: card.id,
    };
    if (idx >= 0) {
      const p = tgtCp[idx];
      if (Array.isArray(p.value)) {
        if (!p.value.some((v) => v?.cardId === card.id)) {
          p.value = [...p.value, ref];
        }
      } else if (p.value && typeof p.value === "object") {
        if (!p.value.cardId) p.value = ref;
      } else {
        p.value = ref;
      }
    } else {
      tgtCp.push({
        id: tgtField,
        key: tgtField,
        name: "关联",
        type: "cardLink",
        value: ref,
      });
    }
    await query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
      targetCardId,
      JSON.stringify(tgtCp),
    ]);
  }

  return true;
}

/**
 * 卡片创建/更新后调用：依照该卡 card_type 下 enabled 的 card_link_rules，
 * 按 source_property 抽取候选值（custom_props 的 key、或 tags），
 * 在用户范围内查找/创建匹配的目标卡，建立 card_links（双向 if 'related'）。
 *
 * fire-and-forget 风格：单条规则失败不影响主流程，只打 console 日志。
 */
export async function runAutoLinkRulesForCard(userIdIn, cardId) {
  try {
    const userId = await resolveUserId(userIdIn);
    const cardRes = await query(
      `SELECT c.id, c.user_id, c.card_type_id, c.title, c.body, c.tags, c.custom_props,
              ct.kind, ct.preset_slug
         FROM cards c JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.id = $1 AND c.user_id = $2 AND c.trashed_at IS NULL`,
      [cardId, userId]
    );
    if (cardRes.rowCount === 0) return;
    const card = cardRes.rows[0];

    // (1) DB 表里的 card_link_rules（按源卡 card_type 沿祖先链匹配）
    const rulesRes = await query(
      `WITH RECURSIVE up AS (
         SELECT id, parent_type_id FROM card_types WHERE id = $1
         UNION ALL
         SELECT t.id, t.parent_type_id FROM card_types t JOIN up ON t.id = up.parent_type_id
       )
       SELECT r.* FROM card_link_rules r
        WHERE r.user_id = $2
          AND r.enabled = true
          AND r.source_type_id IN (SELECT id FROM up)
        ORDER BY r.sort_order ASC, r.id ASC`,
      [card.card_type_id, userId]
    );

    const customPropsArr = Array.isArray(card.custom_props) ? card.custom_props : [];
    const propMap = new Map();
    for (const p of customPropsArr) {
      if (!p || typeof p !== "object") continue;
      if (typeof p.key === "string" && p.key.trim()) {
        propMap.set(p.key.trim(), p.value);
      }
      if (typeof p.id === "string" && p.id.trim()) {
        propMap.set(p.id.trim(), p.value);
      }
    }
    const tags = Array.isArray(card.tags) ? card.tags : [];

    for (const rule of rulesRes.rows) {
      try {
        const candidates = extractRuleCandidates(rule, propMap, tags, card);
        for (const cand of candidates) {
          await applyAutoLinkRule(userId, cardId, rule, cand);
        }
      } catch (e) {
        console.warn(`[auto-link] rule ${rule.id} failed:`, e?.message || e);
      }
    }

    // (2) users.prefs_json.extraAutoLinkRules —— 用户自定义规则（catalog AutoLinkRule 形态）
    const prefRes = await query(`SELECT prefs_json FROM users WHERE id = $1`, [userId]);
    const prefs = prefRes.rows[0]?.prefs_json ?? {};
    const disabledRuleIds = new Set(
      Array.isArray(prefRes.rows[0]?.prefs_json?.disabledAutoLinkRuleIds)
        ? prefRes.rows[0].prefs_json.disabledAutoLinkRuleIds.filter((x) => typeof x === "string")
        : []
    );
    const clipCreatorTargetCollectionByPreset =
      prefs &&
      typeof prefs === "object" &&
      prefs.clipCreatorTargetCollectionByPreset &&
      typeof prefs.clipCreatorTargetCollectionByPreset === "object"
        ? {
            ...(typeof prefs.clipCreatorTargetCollectionByPreset.post_xhs === "string"
              ? {
                  post_xhs: prefs.clipCreatorTargetCollectionByPreset.post_xhs.trim(),
                }
              : {}),
            ...(typeof prefs.clipCreatorTargetCollectionByPreset.post_bilibili === "string"
              ? {
                  post_bilibili:
                    prefs.clipCreatorTargetCollectionByPreset.post_bilibili.trim(),
                }
              : {}),
          }
        : {};
    const extraRules = Array.isArray(prefRes.rows[0]?.prefs_json?.extraAutoLinkRules)
      ? prefRes.rows[0].prefs_json.extraAutoLinkRules
      : [];

    // (1.5) 按 cards.card_type_id 链收集 schema_json.autoLinkRules，动态执行
    // —— 让用户在 CollectionTemplateModal / 同步 schema 后写到 card_types.schema_json
    // 的规则不依赖硬编码路径，即可被服务端执行。
    const catalogRules = await collectEffectiveAutoLinkRules(card.card_type_id);
    const handledCatalogRuleIds = new Set();
    for (const rule of catalogRules) {
      try {
        const linked = await applyCatalogAutoLinkRule(
          userId,
          card,
          rule,
          disabledRuleIds,
          clipCreatorTargetCollectionByPreset
        );
        if (linked) {
          const rid =
            typeof rule.ruleId === "string" ? rule.ruleId.trim() : "";
          if (rid) handledCatalogRuleIds.add(rid);
        }
      } catch (e) {
        console.warn(
          `[auto-link] catalog rule ${rule?.ruleId || "?"} failed:`,
          e?.message || e
        );
      }
    }
    for (const rule of extraRules) {
      try {
        await applyExtraAutoLinkRule(userId, cardId, rule);
      } catch (e) {
        console.warn(`[auto-link] extra rule ${rule?.ruleId} failed:`, e?.message || e);
      }
    }
  } catch (e) {
    console.warn(`[auto-link] runAutoLinkRulesForCard failed:`, e?.message || e);
  }
}

/** 按 ruleId 对源合集已有卡片批量补跑 AutoLink（用于设置页“补跑”按钮） */
export async function backfillAutoLinkRuleById(userIdIn, ruleIdRaw) {
  const userId = await resolveUserId(userIdIn);
  const ruleId = String(ruleIdRaw || "").trim();
  if (!ruleId) {
    throw new Error("规则 ID 不能为空");
  }
  const prefRes = await query(`SELECT prefs_json FROM users WHERE id = $1`, [userId]);
  const prefs = prefRes.rows[0]?.prefs_json ?? {};
  const extraRules = Array.isArray(prefs?.extraAutoLinkRules) ? prefs.extraAutoLinkRules : [];
  const rule =
    extraRules.find(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof r.ruleId === "string" &&
        r.ruleId.trim() === ruleId
    ) || null;
  if (!rule) {
    throw new Error("规则不存在或已被删除");
  }

  let sourceCollectionId = String(rule.sourceCollectionId || "").trim();
  if (!sourceCollectionId) {
    const sourcePresetTypeId = String(rule.sourcePresetTypeId || "").trim();
    if (sourcePresetTypeId) {
      const srcCol = await query(
        `SELECT col.id
           FROM collections col
           JOIN card_types ct ON ct.id = col.bound_type_id
          WHERE col.user_id = $1 AND ct.preset_slug = $2
          ORDER BY col.sort_order ASC
          LIMIT 1`,
        [userId, sourcePresetTypeId]
      );
      sourceCollectionId = srcCol.rows[0]?.id || "";
    }
  }
  if (!sourceCollectionId) {
    throw new Error("这条规则未配置可用的源合集");
  }
  const sourceColMeta = await query(
    `SELECT id, name FROM collections WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sourceCollectionId, userId]
  );
  const sourceCollectionName = sourceColMeta.rows[0]?.name || sourceCollectionId;

  const cardsRes = await query(
    `SELECT c.id
       FROM card_placements p
       JOIN cards c ON c.id = p.card_id
      WHERE p.collection_id = $1
        AND c.user_id = $2
        AND c.trashed_at IS NULL
      ORDER BY p.sort_order ASC, c.created_at ASC, c.id ASC`,
    [sourceCollectionId, userId]
  );
  const cardIds = cardsRes.rows.map((r) => String(r.id || "").trim()).filter(Boolean);

  let succeeded = 0;
  let failed = 0;
  let noEffect = 0;
  let createdTargets = 0;
  const reasons = {};
  const resolvedRule = { ...rule, sourceCollectionId };
  for (const cardId of cardIds) {
    try {
      const ret = await applyExtraAutoLinkRule(userId, cardId, resolvedRule);
      if (ret?.applied) {
        succeeded += 1;
        createdTargets += Number(ret?.createdTargetCount || 0);
      } else {
        noEffect += 1;
        const rk = String(ret?.reason || "no_effect");
        reasons[rk] = (reasons[rk] || 0) + 1;
      }
    } catch {
      failed += 1;
    }
  }
  return {
    ok: true,
    sourceCollectionId,
    sourceCollectionName,
    scanned: cardIds.length,
    succeeded,
    createdTargets,
    noEffect,
    failed,
    reasons,
  };
}

/**
 * catalog 形态的 AutoLinkRule 执行（用户在笔记设置里"自定义规则"四步表单生成）。
 * 关键字段：sourceCollectionId / syncSchemaFieldId（源卡 cardLink 字段） /
 *           targetCollectionId / targetSyncSchemaFieldId（目标卡 cardLink 字段） /
 *           linkType。
 *
 * 行为：
 *   - 卡保存时检查源卡 syncSchemaFieldId 的 cardLink/cardLinks 值
 *   - 对每个目标 ref，写双向 card_links；并把源卡引用 append 到目标卡 targetSyncSchemaFieldId
 */
async function applyExtraAutoLinkRule(userId, sourceCardId, rule) {
  if (!rule || typeof rule !== "object") return;
  const srcColId = String(rule.sourceCollectionId || "").trim();
  const tgtColId = String(rule.targetCollectionId || "").trim();
  const srcField = String(rule.syncSchemaFieldId || "").trim();
  const tgtField = String(rule.targetSyncSchemaFieldId || "").trim();
  const linkType = String(rule.linkType || "related").trim() || "related";
  if (!srcColId || !tgtColId || !srcField || !tgtField)
    return { applied: false, reason: "invalid_rule" };

  // 源卡必须直接归属 srcColId
  const inSrc = await query(
    `SELECT 1 FROM card_placements WHERE card_id = $1 AND collection_id = $2`,
    [sourceCardId, srcColId]
  );
  if (inSrc.rowCount === 0) return { applied: false, reason: "not_in_source_collection" };

  // 读源卡 custom_props 找 srcField
  const cur = await query(
    `SELECT custom_props FROM cards WHERE id = $1 AND user_id = $2`,
    [sourceCardId, userId]
  );
  const srcProps = Array.isArray(cur.rows[0]?.custom_props) ? cur.rows[0].custom_props : [];
  const srcPropIdx = srcProps.findIndex(
    (p) => p?.id === srcField || p?.key === srcField
  );
  const srcProp = srcPropIdx >= 0 ? srcProps[srcPropIdx] : null;
  const srcVal = srcProp?.value;

  function extractSeedText(v) {
    if (typeof v === "string") return v.trim();
    if (!v || typeof v !== "object") return "";
    if (typeof v.seedTitle === "string" && v.seedTitle.trim()) return v.seedTitle.trim();
    if (typeof v.title === "string" && v.title.trim()) return v.title.trim();
    if (typeof v.name === "string" && v.name.trim()) return v.name.trim();
    if (typeof v.text === "string" && v.text.trim()) return v.text.trim();
    if (Array.isArray(v)) {
      for (const x of v) {
        const s = extractSeedText(x);
        if (s) return s;
      }
    }
    return "";
  }

  function readPropValueByIdOrKey(arr, propIdOrKey) {
    const hit = arr.find((p) => p?.id === propIdOrKey || p?.key === propIdOrKey);
    if (!hit || typeof hit !== "object") return null;
    return hit.value ?? hit.seedTitle ?? null;
  }

  // 解析 cardLink / cardLinks → 目标 ref 列表
  const targets = [];
  if (Array.isArray(srcVal)) {
    for (const v of srcVal) {
      if (v && typeof v === "object" && typeof v.cardId === "string") targets.push(v);
    }
  } else if (srcVal && typeof srcVal === "object" && typeof srcVal.cardId === "string") {
    targets.push(srcVal);
  }
  let createdFromTextTargetCardId = "";
  const srcTextSeed =
    extractSeedText(srcVal) ||
    extractSeedText(srcProp) ||
    // 兼容历史剪藏数据：规则字段无值时，回退到常见作者字段。
    extractSeedText(readPropValueByIdOrKey(srcProps, "sf-bili-author")) ||
    extractSeedText(readPropValueByIdOrKey(srcProps, "sf-xhs-author"));
  async function ensureTargetCardBySeed(seedText) {
    const seed = String(seedText || "").trim();
    if (!seed) return { id: "", created: false };
    const hit = await query(
      `SELECT c.id
         FROM cards c
         JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
        WHERE c.user_id = $1
          AND c.trashed_at IS NULL
          AND c.title = $3
        ORDER BY c.created_at ASC
        LIMIT 1`,
      [userId, tgtColId, seed]
    );
    let tgtCardId = hit.rows[0]?.id || "";
    if (tgtCardId) return { id: tgtCardId, created: false };
    const col = await query(
      `SELECT bound_type_id FROM collections WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [tgtColId, userId]
    );
    const targetTypeId = col.rows[0]?.bound_type_id || "";
    if (!targetTypeId) return { id: "", created: false };
    tgtCardId = newCardId("card");
    await query(
      `INSERT INTO cards (id, user_id, card_type_id, title, body)
       VALUES ($1,$2,$3,$4,'')`,
      [tgtCardId, userId, targetTypeId, seed]
    );
    const tk = await query(`SELECT kind FROM card_types WHERE id = $1`, [targetTypeId]);
    await writeSubtableForKindFromSlug(query, tgtCardId, tk.rows[0]?.kind || "note");
    const ord = (
      await query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
           FROM card_placements WHERE collection_id = $1`,
        [tgtColId]
      )
    ).rows[0]?.next;
    await query(
      `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
       VALUES ($1,$2,false,$3)
       ON CONFLICT (card_id, collection_id) DO NOTHING`,
      [tgtCardId, tgtColId, Number.isFinite(ord) ? ord : 0]
    );
    return { id: tgtCardId, created: true };
  }
  let createdTargetCount = 0;
  if (targets.length === 0 && srcTextSeed) {
    const seeded = await ensureTargetCardBySeed(srcTextSeed);
    if (seeded.id) {
      if (seeded.created) createdTargetCount += 1;
      createdFromTextTargetCardId = seeded.id;
      targets.push({ colId: tgtColId, cardId: seeded.id });
    }
  }
  if (targets.length === 0) {
    if (!srcProp) return { applied: false, reason: "missing_source_field" };
    if (!srcTextSeed) return { applied: false, reason: "missing_seed_text" };
    return { applied: false, reason: "no_target_candidates" };
  }

  const srcType = (
    await query(`SELECT card_type_id FROM cards WHERE id = $1`, [sourceCardId])
  ).rows[0]?.card_type_id;

  let linkedCount = 0;
  let skippedBlankTargetCount = 0;
  for (const tgt of targets) {
    const tgtCardId = String(tgt.cardId || "").trim();
    if (!tgtCardId || tgtCardId === sourceCardId) continue;

    // 目标卡必须直接归属 tgtColId 且属于同用户
    const tgtOwn = await query(
      `SELECT c.card_type_id, c.title, c.custom_props
         FROM cards c
         JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
        WHERE c.id = $1 AND c.user_id = $3 AND c.trashed_at IS NULL`,
      [tgtCardId, tgtColId, userId]
    );
    if (tgtOwn.rowCount === 0) continue;
    const tgtTitle = String(tgtOwn.rows[0].title || "").trim();
    if (!tgtTitle) {
      // 避免旧数据中的空白卡继续被复用；后续统一走 seed 回退创建/匹配。
      skippedBlankTargetCount += 1;
      continue;
    }
    const tgtTypeId = tgtOwn.rows[0].card_type_id;
    const tgtCp = Array.isArray(tgtOwn.rows[0].custom_props) ? tgtOwn.rows[0].custom_props.slice() : [];

    // 写双向 link
    await query(
      `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,0)
       ON CONFLICT DO NOTHING`,
      [sourceCardId, linkType, tgtCardId, tgtTypeId, userId]
    );
    await query(
      `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,0)
       ON CONFLICT DO NOTHING`,
      [tgtCardId, linkType, sourceCardId, srcType || null, userId]
    );

    // 把源卡引用 append 到目标卡 targetSyncSchemaFieldId
    const ref = { colId: srcColId, cardId: sourceCardId };
    const idx = tgtCp.findIndex((p) => p?.id === tgtField || p?.key === tgtField);
    if (idx >= 0) {
      const prop = tgtCp[idx];
      if (Array.isArray(prop.value)) {
        if (!prop.value.some((v) => v?.cardId === sourceCardId)) {
          prop.value = [...prop.value, ref];
        }
      } else if (prop.value && typeof prop.value === "object") {
        // 单 cardLink：若已指向其他人则不强改；空时设置
        if (!prop.value.cardId) prop.value = ref;
      } else {
        prop.value = ref;
      }
    } else {
      tgtCp.push({
        id: tgtField,
        key: tgtField,
        name: "关联",
        type: "cardLink",
        value: ref,
      });
    }
    await query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
      tgtCardId,
      JSON.stringify(tgtCp),
    ]);
    linkedCount += 1;
  }

  if (linkedCount === 0 && !createdFromTextTargetCardId && srcTextSeed) {
    const seeded = await ensureTargetCardBySeed(srcTextSeed);
    const fallbackTargetId = seeded.id;
    if (fallbackTargetId) {
      if (seeded.created) createdTargetCount += 1;
      const fallbackTarget = await query(
        `SELECT c.card_type_id, c.custom_props
           FROM cards c
           JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
          WHERE c.id = $1 AND c.user_id = $3 AND c.trashed_at IS NULL`,
        [fallbackTargetId, tgtColId, userId]
      );
      if (fallbackTarget.rowCount > 0) {
        const tgtTypeId = fallbackTarget.rows[0].card_type_id;
        const tgtCp = Array.isArray(fallbackTarget.rows[0].custom_props)
          ? fallbackTarget.rows[0].custom_props.slice()
          : [];
        await query(
          `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,0)
           ON CONFLICT DO NOTHING`,
          [sourceCardId, linkType, fallbackTargetId, tgtTypeId, userId]
        );
        await query(
          `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,0)
           ON CONFLICT DO NOTHING`,
          [fallbackTargetId, linkType, sourceCardId, srcType || null, userId]
        );
        const ref = { colId: srcColId, cardId: sourceCardId };
        const idx = tgtCp.findIndex((p) => p?.id === tgtField || p?.key === tgtField);
        if (idx >= 0) {
          const prop = tgtCp[idx];
          if (Array.isArray(prop.value)) {
            if (!prop.value.some((v) => v?.cardId === sourceCardId)) {
              prop.value = [...prop.value, ref];
            }
          } else if (prop.value && typeof prop.value === "object") {
            if (!prop.value.cardId) prop.value = ref;
          } else {
            prop.value = ref;
          }
        } else {
          tgtCp.push({
            id: tgtField,
            key: tgtField,
            name: "关联",
            type: "cardLink",
            value: ref,
          });
        }
        await query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
          fallbackTargetId,
          JSON.stringify(tgtCp),
        ]);
        createdFromTextTargetCardId = fallbackTargetId;
      }
    }
  }

  if (createdFromTextTargetCardId && srcPropIdx >= 0) {
    const nextSrcProps = srcProps.slice();
    const srcRef = { colId: tgtColId, cardId: createdFromTextTargetCardId };
    const old = nextSrcProps[srcPropIdx] || {};
    nextSrcProps[srcPropIdx] = {
      ...old,
      type: "cardLink",
      value: srcRef,
      ...(srcTextSeed ? { seedTitle: srcTextSeed } : {}),
    };
    await query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
      sourceCardId,
      JSON.stringify(nextSrcProps),
    ]);
  }
  if (linkedCount > 0) {
    return { applied: true, reason: "linked", createdTargetCount };
  }
  if (skippedBlankTargetCount > 0 && !srcTextSeed) {
    return { applied: false, reason: "missing_seed_text" };
  }
  return { applied: false, reason: "no_effect" };
}

function extractRuleCandidates(rule, propMap, tags, card) {
  const key = rule.source_property_key;
  const out = [];
  // 来自 custom_props
  if (propMap.has(key)) {
    const v = propMap.get(key);
    if (typeof v === "string" && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  }
  // 来自 tags（仅当 source_property_key === '__tag__' 或匹配某模式时）
  if (key === "__tag__" || key === "tags") {
    for (const t of tags) if (typeof t === "string" && t.trim()) out.push(t.trim());
  }
  // 来自标题
  if (key === "title" && typeof card.title === "string" && card.title.trim()) {
    out.push(card.title.trim());
  }
  return [...new Set(out)];
}

async function applyAutoLinkRule(userId, fromCardId, rule, candidateText) {
  if (!rule.target_type_id) return;

  // 找匹配的目标卡
  const matchSql = (() => {
    switch (rule.match_strategy) {
      case "contains_title":
        return `AND c.title ILIKE '%' || $3 || '%'`;
      case "alias_tag":
        return `AND $3 = ANY(c.tags)`;
      case "exact_title":
      default:
        return `AND c.title = $3`;
    }
  })();

  let target = await query(
    `SELECT c.id FROM cards c
      WHERE c.user_id = $1
        AND c.card_type_id = $2
        AND c.trashed_at IS NULL
        ${matchSql}
      LIMIT 1`,
    [userId, rule.target_type_id, candidateText]
  );

  let targetId = target.rows[0]?.id;

  // 不存在时按 auto_create 决定
  if (!targetId && rule.auto_create) {
    targetId = newCardId("card");
    await query(
      `INSERT INTO cards (id, user_id, card_type_id, title, body)
       VALUES ($1,$2,$3,$4,'')`,
      [targetId, userId, rule.target_type_id, candidateText]
    );
    // 写对应子表
    const tk = await query(`SELECT kind FROM card_types WHERE id = $1`, [rule.target_type_id]);
    await writeSubtableForKindFromSlug(query, targetId, tk.rows[0]?.kind || "note");
    // 放入 target_collection_id（若提供）
    if (rule.target_collection_id) {
      const ord = (
        await query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
          [rule.target_collection_id]
        )
      ).rows[0].next;
      await query(
        `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
         VALUES ($1,$2,false,$3)
         ON CONFLICT (card_id, collection_id) DO NOTHING`,
        [targetId, rule.target_collection_id, ord]
      );
    }
  }
  if (!targetId || targetId === fromCardId) return;

  await query(
    `INSERT INTO card_links (from_card_id, property_key, to_card_id, target_type_id, user_id, sort_order)
     VALUES ($1,$2,$3,$4,$5,0)
     ON CONFLICT (from_card_id, property_key, to_card_id) DO NOTHING`,
    [fromCardId, rule.link_property_key, targetId, rule.target_type_id, userId]
  );
}

// 一次性迁移函数：v2 不再保留。保留导出以免 import 报错，但调用即报错。
export const batchMigrateAttachmentsToFileCards = notImplemented(
  "removed",
  "batchMigrateAttachmentsToFileCards"
);
export const migrateRelatedRefsJsonToCardLinks = notImplemented(
  "removed",
  "migrateRelatedRefsJsonToCardLinks"
);
export const migrateClipTaggedNotesToPresetCards = notImplemented(
  "removed",
  "migrateClipTaggedNotesToPresetCards"
);
