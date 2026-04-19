/**
 * storage-pg.js
 * PostgreSQL 数据访问层：合集 + 卡片 CRUD。
 * COS 工具函数（presign、putCosObject 等）继续留在 storage.js，不在此文件。
 */

import { query, getClient } from "./db.js";

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

/** @param {{ url?: string, name?: string }} mediaItem */
function deriveFileCardTitleFromMediaItem(mediaItem) {
  const name = typeof mediaItem.name === "string" ? mediaItem.name.trim() : "";
  if (name) return stripExtFilename(name);
  const url = typeof mediaItem.url === "string" ? mediaItem.url.trim() : "";
  if (!url) return "";
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const seg = parts[parts.length - 1] || "";
    return stripExtFilename(decodeURIComponent(seg));
  } catch {
    const noQuery = url.split("?")[0] || "";
    const parts = noQuery.split("/").filter(Boolean);
    const seg = parts[parts.length - 1] || "";
    return stripExtFilename(seg);
  }
}

/** @param {string} kind */
function objectKindForFileMediaKind(kind) {
  if (kind === "image") return "file_image";
  if (kind === "video") return "file_video";
  if (kind === "audio") return "file_audio";
  return "file_document";
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把数据库行（snake_case）转换为前端期望的卡片格式（camelCase）。
 */
function rowToCard(row) {
  const ok =
    row.object_kind &&
    typeof row.object_kind === "string" &&
    row.object_kind !== "note";
  return {
    id: row.id,
    text: row.text,
    minutesOfDay: row.minutes_of_day,
    addedOn: row.added_on ?? undefined,
    ...(row.reminder_on ? { reminderOn: row.reminder_on } : {}),
    ...(row.reminder_time ? { reminderTime: row.reminder_time } : {}),
    ...(row.reminder_note ? { reminderNote: row.reminder_note } : {}),
    ...(row.reminder_completed_at
      ? { reminderCompletedAt: row.reminder_completed_at }
      : {}),
    ...(row.reminder_completed_note
      ? { reminderCompletedNote: row.reminder_completed_note }
      : {}),
    pinned: row.pinned ?? false,
    tags: row.tags ?? [],
    relatedRefs: Array.isArray(row.related_refs) ? row.related_refs : [],
    media: row.media ?? [],
    ...(ok ? { objectKind: row.object_kind } : {}),
    ...(Array.isArray(row.custom_props) && row.custom_props.length > 0
      ? { customProps: row.custom_props }
      : {}),
  };
}

const LOOSE_NOTES_COLLECTION_ID = "__loose_notes";
const LOOSE_NOTES_DOT_COLOR = "#a8a29e";

/**
 * 把数据库行（snake_case）转换为前端期望的合集格式（不含 cards/children，由调用方组装）。
 */
function hintFromRow(val) {
  const t = String(val ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function rowToCollection(row) {
  const schema = row.card_schema;
  const hasSchema =
    schema &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    Object.keys(schema).length > 0;
  return {
    id: row.id,
    name: row.name,
    dotColor: row.dot_color,
    ...(() => {
      const h = hintFromRow(row.hint);
      return h ? { hint: h } : {};
    })(),
    parentId: row.parent_id ?? undefined,
    sortOrder: row.sort_order,
    ...(row.is_category === true ? { isCategory: true } : {}),
    ...(hasSchema ? { cardSchema: schema } : {}),
    ...(typeof row.preset_type_id === "string" && row.preset_type_id.trim()
      ? { presetTypeId: row.preset_type_id.trim() }
      : {}),
  };
}

/**
 * 从 card_links 批量解析 relatedRefs（含 to_card 的 placement colId）。
 * @param {string|null} userId
 * @param {string[]} cardIds
 * @returns {Promise<Map<string, Array<{ colId: string, cardId: string }>>>}
 */
async function loadRelatedRefsMapFromLinks(userId, cardIds) {
  const unique = [...new Set(cardIds.filter(Boolean))];
  const out = new Map();
  if (unique.length === 0) return out;
  for (const id of unique) out.set(id, []);

  let linksRes;
  if (userId === null || userId === undefined) {
    linksRes = await query(
      `SELECT l.from_card_id, l.to_card_id, l.link_type
       FROM card_links l
       INNER JOIN cards fr ON fr.id = l.from_card_id AND fr.trashed_at IS NULL
       WHERE l.from_card_id = ANY($1) AND fr.user_id IS NULL`,
      [unique]
    );
  } else {
    linksRes = await query(
      `SELECT l.from_card_id, l.to_card_id, l.link_type
       FROM card_links l
       INNER JOIN cards fr ON fr.id = l.from_card_id AND fr.trashed_at IS NULL
       WHERE l.from_card_id = ANY($1)
         AND (fr.user_id = $2 OR fr.user_id IS NULL)`,
      [unique, userId]
    );
  }

  const toIds = [...new Set(linksRes.rows.map((r) => r.to_card_id))];
  /** @type {Map<string, string>} */
  const placementMap = new Map();
  if (toIds.length > 0) {
    const plRes = await query(
      `SELECT DISTINCT ON (card_id) card_id, collection_id
       FROM card_placements WHERE card_id = ANY($1)
       ORDER BY card_id, collection_id`,
      [toIds]
    );
    for (const row of plRes.rows) {
      placementMap.set(row.card_id, row.collection_id);
    }
  }

  /** @type {Map<string, Array<{ from_card_id: string, to_card_id: string }>>} */
  const byFrom = new Map();
  for (const row of linksRes.rows) {
    const arr = byFrom.get(row.from_card_id) ?? [];
    arr.push(row);
    byFrom.set(row.from_card_id, arr);
  }
  for (const id of unique) {
    const rows = byFrom.get(id) ?? [];
    const refs = [];
    for (const r of rows) {
      const colId = placementMap.get(r.to_card_id);
      if (colId) {
        const lt =
          typeof r.link_type === "string" && r.link_type.trim()
            ? r.link_type.trim()
            : undefined;
        refs.push(
          lt ? { colId, cardId: r.to_card_id, linkType: lt } : { colId, cardId: r.to_card_id }
        );
      }
    }
    out.set(id, refs);
  }
  return out;
}

/**
 * @param {string|null} userId
 * @param {unknown[]} roots
 */
async function applyRelatedRefsFromLinksToTree(userId, roots) {
  const ids = [];
  function collect(cols) {
    for (const col of cols) {
      for (const card of col.cards || []) ids.push(card.id);
      if (col.children?.length) collect(col.children);
    }
  }
  collect(roots);
  const map = await loadRelatedRefsMapFromLinks(userId, ids);
  function walk(cols) {
    for (const col of cols) {
      col.cards = (col.cards || []).map((card) => ({
        ...card,
        relatedRefs: map.get(card.id) ?? [],
      }));
      if (col.children?.length) walk(col.children);
    }
  }
  walk(roots);
}

/**
 * 同步「相关」关系到 card_links（双向边），并清空 cards.related_refs JSON 列。
 * @param {import("pg").PoolClient} client
 * @param {string|null} userId
 * @param {string} cardId
 * @param {Array<{ colId?: string, cardId: string }>} relatedRefs
 */
async function syncCardRelatedLinksWithClient(client, userId, cardId, relatedRefs) {
  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 2);
  const own = await client.query(
    `SELECT user_id FROM cards WHERE id = $1 AND (${cOwnSql}) AND trashed_at IS NULL`,
    [cardId, ...cOwnParams]
  );
  if (own.rowCount === 0) throw new Error("卡片不存在或无权限");
  const uid = own.rows[0].user_id;

  await client.query(
    `DELETE FROM card_links WHERE link_type = 'related' AND (from_card_id = $1 OR to_card_id = $1)`,
    [cardId]
  );

  const seen = new Set();
  for (const ref of relatedRefs) {
    const toId =
      ref && typeof ref.cardId === "string" ? ref.cardId.trim() : "";
    if (!toId || toId === cardId) continue;
    if (seen.has(toId)) continue;
    seen.add(toId);

    const { sql: tOwnSql, params: tOwnParams } = cardOwnershipCondition(
      userId,
      2
    );
    const t = await client.query(
      `SELECT id FROM cards WHERE id = $1 AND (${tOwnSql}) AND trashed_at IS NULL`,
      [toId, ...tOwnParams]
    );
    if (t.rowCount === 0) continue;

    await client.query(
      `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
       VALUES ($1, $2, $3, 'related')
       ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
      [uid, cardId, toId]
    );
    await client.query(
      `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
       VALUES ($1, $2, $3, 'related')
       ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
      [uid, toId, cardId]
    );
  }
  await client.query(
    `UPDATE cards SET related_refs = '[]'::jsonb WHERE id = $1`,
    [cardId]
  );
}

/**
 * 基础图谱查询：从 root 出发按层扩展，maxDepth=1 表示只含与 root 直接相连的边与端点。
 * @param {string|null} userId
 * @param {string} rootCardId
 * @param {{ depth?: number, linkTypes?: string[] }} opts
 */
export async function queryCardGraph(userId, rootCardId, opts = {}) {
  const maxDepth = Math.min(Math.max(parseInt(String(opts.depth ?? 1), 10) || 1, 1), 4);
  const linkTypes =
    Array.isArray(opts.linkTypes) && opts.linkTypes.length > 0
      ? opts.linkTypes
      : ["related", "attachment", "creator", "source", "source_url"];

  const { sql: uidSql, params: uidParams } = cardOwnershipCondition(userId, 2);
  const rootOk = await query(
    `SELECT id, object_kind FROM cards WHERE id = $1 AND (${uidSql}) AND trashed_at IS NULL`,
    [rootCardId, ...uidParams]
  );
  if (rootOk.rowCount === 0) throw new Error("卡片不存在或无权限");

  /** @type {Map<string, { id: string, objectKind: string }>} */
  const nodes = new Map();
  nodes.set(rootCardId, {
    id: rootCardId,
    objectKind: rootOk.rows[0].object_kind ?? "note",
  });

  const edges = [];
  const seenEdge = new Set();

  let frontier = [rootCardId];
  const dist = new Map([[rootCardId, 0]]);

  for (let level = 0; level < maxDepth; level++) {
    const nextFrontier = [];
    for (const nid of frontier) {
      const lr = await query(
        `SELECT l.from_card_id, l.to_card_id, l.link_type
         FROM card_links l
         WHERE (l.from_card_id = $1 OR l.to_card_id = $1) AND l.link_type = ANY($2::text[])`,
        [nid, linkTypes]
      );

      for (const r of lr.rows) {
        const a = r.from_card_id;
        const b = r.to_card_id;
        const ek =
          a < b
            ? `${a}|${b}|${r.link_type}`
            : `${b}|${a}|${r.link_type}`;
        if (!seenEdge.has(ek)) {
          seenEdge.add(ek);
          edges.push({ from: a, to: b, linkType: r.link_type });
        }

        const other = a === nid ? b : a;
        const { sql: oSql, params: oParams } = cardOwnershipCondition(userId, 2);
        const oc = await query(
          `SELECT id, object_kind FROM cards WHERE id = $1 AND (${oSql}) AND trashed_at IS NULL`,
          [other, ...oParams]
        );
        if (oc.rowCount === 0) continue;

        if (!nodes.has(other)) {
          nodes.set(other, {
            id: other,
            objectKind: oc.rows[0].object_kind ?? "note",
          });
        }
        if (!dist.has(other)) {
          dist.set(other, level + 1);
          nextFrontier.push(other);
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    root: rootCardId,
    maxDepth,
    linkTypes,
    nodes: [...nodes.values()],
    edges,
  };
}

/**
 * 把平铺的 collections 行 + cards 行重建为嵌套树（与旧 JSON 格式兼容）。
 * 根节点（parent_id IS NULL）组成顶层数组，其余挂入父节点 children。
 */
function buildTree(colRows, cardRows) {
  // 按 collection_id 分组 cards
  const cardsByColId = new Map();
  for (const c of cardRows) {
    const arr = cardsByColId.get(c.collection_id) ?? [];
    arr.push(rowToCard(c));
    cardsByColId.set(c.collection_id, arr);
  }

  // 构建 collections Map，并挂上 cards
  const map = new Map();
  for (const row of colRows) {
    const base = rowToCollection(row);
    map.set(row.id, {
      ...base,
      children: [],
      cards: cardsByColId.get(row.id) ?? [],
    });
  }

  // 第二遍：把有 parent_id 的挂入父节点 children
  const roots = [];
  for (const row of colRows) {
    const node = map.get(row.id);
    if (row.parent_id) {
      const parent = map.get(row.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // 父节点不存在（数据异常）→ 当根节点处理，防止数据丢失
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * 把嵌套 Collection[] 平铺成 collections + 去重后的 cards + placements（同 id 多合集只存一条 cards 行）。
 * @param {string|null} userId
 * @param {Array} tree
 */
function flattenTree(userId, tree) {
  const collections = [];
  /** @type {Map<string, object>} */
  const cardById = new Map();
  const placements = [];

  function walk(nodes, parentId) {
    nodes.forEach((col, idx) => {
      collections.push({
        id: col.id,
        user_id: userId,
        parent_id: parentId ?? null,
        name: col.name ?? "",
        dot_color: col.dotColor ?? "",
        sort_order: idx,
        hint: typeof col.hint === "string" ? col.hint : "",
      });
      const cardList = col.cards ?? col.blocks ?? [];
      cardList.forEach((card, ci) => {
        if (!cardById.has(card.id)) {
          cardById.set(card.id, {
            id: card.id,
            user_id: userId,
            text: card.text ?? "",
            minutes_of_day: card.minutesOfDay ?? 0,
            added_on: card.addedOn ?? null,
            reminder_on: card.reminderOn ?? null,
            reminder_time: card.reminderTime ?? null,
            reminder_note: card.reminderNote ?? null,
            reminder_completed_at: card.reminderCompletedAt ?? null,
            reminder_completed_note: card.reminderCompletedNote ?? null,
            tags: card.tags ?? [],
            related_refs: card.relatedRefs ?? [],
            media: card.media ?? [],
            custom_props: card.customProps ?? [],
          });
        }
        placements.push({
          card_id: card.id,
          collection_id: col.id,
          pinned: card.pinned ?? false,
          sort_order: ci,
        });
      });
      if (Array.isArray(col.children) && col.children.length > 0) {
        walk(col.children, col.id);
      }
    });
  }

  walk(tree, null);
  return { collections, cards: [...cardById.values()], placements };
}

/**
 * 返回用于 user_id 比较的 SQL 片段。
 * userId = null  → `user_id IS NULL`
 * userId = 'xxx' → `user_id = $N`
 */
function userIdCondition(userId, paramIdx) {
  if (userId === null || userId === undefined) {
    return { sql: "user_id IS NULL", params: [] };
  }
  return { sql: `user_id = $${paramIdx}`, params: [userId] };
}

/**
 * 卡片行归属：已登录用户允许 `user_id = 本人` 或 `user_id IS NULL`（迁移/单库遗留），
 * 避免「侧栏/详情已显示多合集」但 DELETE placement 因条件过严返回 0 行。
 */
function cardOwnershipCondition(userId, paramIdx) {
  if (userId === null || userId === undefined) {
    return { sql: "user_id IS NULL", params: [] };
  }
  return {
    sql: `(user_id = $${paramIdx} OR user_id IS NULL)`,
    params: [userId],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 合集树读取
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 读取某用户（或单用户模式 userId=null）的全部合集，返回嵌套树。
 * 格式与旧 GET /api/collections JSON 完全一致。
 * @param {string|null} userId
 * @returns {Promise<Array>}
 */
export async function getCollectionsTree(userId) {
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 1);

  const colRes = await query(
    `SELECT id, user_id, parent_id, name, dot_color, sort_order, hint,
            is_category, card_schema, preset_type_id
     FROM collections
     WHERE ${uidSql}
     ORDER BY sort_order`,
    uidParams
  );

  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 1);
  const orphanRes = await query(
    `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
            c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
            c.tags, c.related_refs, c.media, c.custom_props, c.object_kind
     FROM cards c
     WHERE (${cUidSql})
       AND c.trashed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM card_placements p WHERE p.card_id = c.id)
     ORDER BY c.updated_at DESC`,
    cUidParams
  );

  if (colRes.rows.length === 0) {
    if (orphanRes.rows.length === 0) return [];
    const looseCards = orphanRes.rows.map((r) => ({
      ...rowToCard({ ...r, pinned: false }),
    }));
    return [
      {
        id: LOOSE_NOTES_COLLECTION_ID,
        name: "",
        dotColor: LOOSE_NOTES_DOT_COLOR,
        cards: looseCards,
        children: [],
      },
    ];
  }

  const colIds = colRes.rows.map((r) => r.id);

  const cardRes = await query(
    `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
            c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
            c.tags, c.related_refs, c.media, c.custom_props, c.object_kind,
            p.collection_id, p.pinned, p.sort_order
     FROM card_placements p
     INNER JOIN cards c ON c.id = p.card_id AND c.trashed_at IS NULL
     WHERE p.collection_id = ANY($1)
     ORDER BY p.collection_id, p.sort_order ASC, c.id ASC`,
    [colIds]
  );

  const roots = buildTree(colRes.rows, cardRes.rows);

  if (orphanRes.rows.length > 0) {
    const looseCards = orphanRes.rows.map((r) => ({
      ...rowToCard({ ...r, pinned: false }),
    }));
    roots.push({
      id: LOOSE_NOTES_COLLECTION_ID,
      name: "",
      dotColor: LOOSE_NOTES_DOT_COLOR,
      cards: looseCards,
      children: [],
    });
  }

  await applyRelatedRefsFromLinksToTree(userId, roots);
  return roots;
}

// ─────────────────────────────────────────────────────────────────────────────
// 批量替换（迁移 / 导入）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 在单事务内：删除该用户所有合集（级联删卡片），再把树形数组平铺插入。
 * 用于 PUT /api/collections（迁移 / 导入），生产日常写操作不走这里。
 * @param {string|null} userId
 * @param {Array} collectionsArray
 */
export async function replaceCollectionsTree(userId, collectionsArray) {
  const { collections, cards, placements } = flattenTree(
    userId,
    collectionsArray
  );
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 1);
  const { sql: cardUidSql, params: cardUidParams } = userIdCondition(
    userId,
    1
  );

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    await client.query(
      `DELETE FROM cards WHERE ${cardUidSql}`,
      cardUidParams
    );
    await client.query(`DELETE FROM collections WHERE ${uidSql}`, uidParams);

    if (collections.length > 0) {
      const vals = collections
        .map(
          (_, i) =>
            `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`
        )
        .join(",");
      const flat = collections.flatMap((c) => [
        c.id,
        c.user_id,
        c.parent_id,
        c.name,
        c.dot_color,
        c.sort_order,
        c.hint ?? "",
      ]);
      await client.query(
        `INSERT INTO collections (id, user_id, parent_id, name, dot_color, sort_order, hint) VALUES ${vals}`,
        flat
      );
    }

    if (cards.length > 0) {
      const vals = cards
        .map(
          (_, i) =>
            `($${i * 14 + 1}, $${i * 14 + 2}, $${i * 14 + 3}, $${i * 14 + 4}, $${i * 14 + 5}, ` +
            `$${i * 14 + 6}, $${i * 14 + 7}, $${i * 14 + 8}, $${i * 14 + 9}, $${i * 14 + 10}, ` +
            `$${i * 14 + 11}, $${i * 14 + 12}, $${i * 14 + 13}, $${i * 14 + 14})`
        )
        .join(",");
      const flat = cards.flatMap((c) => [
        c.id,
        c.user_id,
        c.text,
        c.minutes_of_day,
        c.added_on,
        c.reminder_on ?? null,
        c.reminder_time ?? null,
        c.reminder_note ?? null,
        c.reminder_completed_at ?? null,
        c.reminder_completed_note ?? null,
        c.tags,
        JSON.stringify(c.related_refs),
        JSON.stringify(c.media),
        JSON.stringify(c.custom_props ?? []),
      ]);
      await client.query(
        `INSERT INTO cards
           (id, user_id, text, minutes_of_day, added_on, reminder_on,
            reminder_time, reminder_note, reminder_completed_at, reminder_completed_note,
            tags, related_refs, media, custom_props)
         VALUES ${vals}`,
        flat
      );
    }

    if (placements.length > 0) {
      const vals = placements
        .map(
          (_, i) =>
            `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
        )
        .join(",");
      const flat = placements.flatMap((p) => [
        p.card_id,
        p.collection_id,
        p.pinned,
        p.sort_order,
      ]);
      await client.query(
        `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order) VALUES ${vals}`,
        flat
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 合集粒度化操作
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 创建单个合集。
 * @param {string|null} userId
 * @param {{ id, name, dotColor?, parentId?, sortOrder? }} data
 */
export async function createCollection(userId, data) {
  const {
    id,
    name,
    dotColor = "",
    hint: hintRaw = "",
    parentId = null,
    sortOrder,
  } = data;
  if (!id || !name) throw new Error("id 和 name 为必填项");
  const hint = typeof hintRaw === "string" ? hintRaw : "";

  // 未指定 sortOrder 时追加到末尾
  let order = sortOrder;
  if (order === undefined || order === null) {
    const { sql: uidSql, params: uidParams } = userIdCondition(userId, 1);
    const res = await query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collections WHERE ${uidSql}`,
      uidParams
    );
    order = res.rows[0].next;
  }

  await query(
    `INSERT INTO collections (id, user_id, parent_id, name, dot_color, sort_order, hint)
     VALUES ($1, ${userId === null ? "NULL" : "$7"}, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    userId === null
      ? [id, parentId, name, dotColor, order, hint]
      : [id, parentId, name, dotColor, order, hint, userId]
  );

  return {
    id,
    name,
    dotColor,
    ...(hint.trim() ? { hint: hint.trim() } : {}),
    parentId: parentId ?? undefined,
    sortOrder: order,
  };
}

/**
 * 更新合集元数据（name / dotColor / parentId / sortOrder / 类别与 schema）。
 * @param {string|null} userId
 * @param {string} collectionId
 * @param {object} patch
 */
export async function updateCollection(userId, collectionId, patch) {
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
  if ("parentId" in patch) {
    fields.push(`parent_id = $${i++}`);
    params.push(patch.parentId ?? null);
  }
  if (typeof patch.sortOrder === "number") {
    fields.push(`sort_order = $${i++}`);
    params.push(patch.sortOrder);
  }
  if (typeof patch.hint === "string") {
    fields.push(`hint = $${i++}`);
    params.push(patch.hint);
  }
  if (typeof patch.isCategory === "boolean") {
    fields.push(`is_category = $${i++}`);
    params.push(patch.isCategory);
  }
  if ("cardSchema" in patch) {
    fields.push(`card_schema = $${i++}::jsonb`);
    const v = patch.cardSchema;
    params.push(
      v === null || v === undefined
        ? "{}"
        : typeof v === "string"
          ? v
          : JSON.stringify(v)
    );
  }
  if ("presetTypeId" in patch) {
    fields.push(`preset_type_id = $${i++}`);
    const v = patch.presetTypeId;
    params.push(
      v === null || v === undefined || v === ""
        ? null
        : String(v).trim() || null
    );
  }

  if (fields.length === 0) throw new Error("未提供任何可更新字段");

  const { sql: uidSql, params: uidParams } = userIdCondition(userId, i + 1);
  params.push(collectionId);

  const res = await query(
    `UPDATE collections SET ${fields.join(", ")}
     WHERE id = $${i} AND ${uidSql}
     RETURNING id, name, dot_color, parent_id, sort_order, hint,
               is_category, card_schema, preset_type_id`,
    [...params, ...uidParams]
  );
  if (res.rowCount === 0) throw new Error("合集不存在或无权限");
  return rowToCollection(res.rows[0]);
}

/**
 * 删除合集（子合集随 parent_id CASCADE；笔记归属行随 collection CASCADE，cards 表不删）。
 * @param {string|null} userId
 * @param {string} collectionId
 */
export async function deleteCollection(userId, collectionId) {
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const res = await query(
    `DELETE FROM collections WHERE id = $1 AND ${uidSql}`,
    [collectionId, ...uidParams]
  );
  if (res.rowCount === 0) throw new Error("合集不存在或无权限");
}

// ─────────────────────────────────────────────────────────────────────────────
// 卡片粒度化操作
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 仅写入 card_placements：把已有笔记加入另一合集（不读/不写 cards 正文等大字段）。
 * @param {string|null} userId
 * @param {string} cardId
 * @param {string} collectionId
 * @param {{ insertAtStart?: boolean, pinned?: boolean }} opts
 * @returns {{ cardId: string, collectionId: string, sortOrder: number, pinned: boolean }}
 */
export async function addCardToCollectionPlacement(
  userId,
  cardId,
  collectionId,
  opts = {}
) {
  const colId = String(collectionId || "").trim();
  const cid = String(cardId || "").trim();
  if (!cid || !colId) throw new Error("缺少卡片或合集");

  const insertAtStart = opts.insertAtStart === true;
  const pinned = Boolean(opts.pinned);

  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const colCheck = await query(
    `SELECT id FROM collections WHERE id = $1 AND ${uidSql}`,
    [colId, ...uidParams]
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

  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 2);
  const existing = await query(
    `SELECT id, trashed_at FROM cards WHERE id = $1 AND (${cOwnSql})`,
    [cid, ...cOwnParams]
  );
  if (existing.rowCount === 0) throw new Error("卡片不存在或无权限");
  if (existing.rows[0].trashed_at != null) {
    throw new Error("该笔记在回收站中，请先恢复");
  }

  await query(
    `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (card_id, collection_id) DO UPDATE SET
       pinned = EXCLUDED.pinned,
       sort_order = EXCLUDED.sort_order`,
    [cid, colId, pinned, sortOrder]
  );

  return {
    cardId: cid,
    collectionId: colId,
    sortOrder,
    pinned,
  };
}

/**
 * 在指定合集内创建卡片（默认末尾；card.insertAtStart 为 true 时插在 sort_order 最前）。
 * 在插入前先验证 collectionId 属于该用户。
 * @param {string|null} userId
 * @param {string} collectionId
 * @param {object} card
 * @param {import("pg").PoolClient|null} [pgClient] 传入时在同一连接上执行（用于事务）
 */
export async function createCard(userId, collectionId, card, pgClient = null) {
  const q = pgClient ? (sql, params) => pgClient.query(sql, params) : query;
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const colCheck = await q(
    `SELECT id FROM collections WHERE id = $1 AND ${uidSql}`,
    [collectionId, ...uidParams]
  );
  if (colCheck.rowCount === 0) throw new Error("合集不存在或无权限");

  const {
    id,
    text = "",
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
  } = card;

  /** 仅显式布尔 true 插入到最前，避免 "false" 等真值误判或客户端异常字段 */
  const insertAtStart = card.insertAtStart === true;

  if (!id) throw new Error("card.id 为必填项");

  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 2);
  const existing = await q(
    `SELECT id, user_id, trashed_at FROM cards WHERE id = $1 AND (${cOwnSql})`,
    [id, ...cOwnParams]
  );

  if (existing.rowCount > 0) {
    if (existing.rows[0].trashed_at != null) {
      throw new Error("该笔记在回收站中，请先恢复");
    }
    await addCardToCollectionPlacement(userId, id, collectionId, {
      insertAtStart,
      pinned,
    });
    const row = await q(
      `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
              c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
              c.tags, c.related_refs, c.media, c.custom_props, c.object_kind, p.pinned
       FROM cards c
       JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
       WHERE c.id = $1`,
      [id, collectionId]
    );
    const r = row.rows[0];
    const base = rowToCard(r);
    const relMap = await loadRelatedRefsMapFromLinks(userId, [id]);
    return { ...base, relatedRefs: relMap.get(id) ?? [] };
  }

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

  const objectKind =
    typeof card.objectKind === "string" && card.objectKind.trim()
      ? String(card.objectKind).trim().slice(0, 64)
      : "note";

  await q(
    `INSERT INTO cards
       (id, user_id, text, minutes_of_day, added_on, reminder_on,
        reminder_time, reminder_note, reminder_completed_at, reminder_completed_note, tags, related_refs, media, custom_props, object_kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      userId ?? null,
      text,
      minutesOfDay,
      addedOn,
      reminderOn,
      reminderTime,
      reminderNote,
      reminderCompletedAt,
      reminderCompletedNote,
      tags,
      JSON.stringify(relatedRefs),
      JSON.stringify(media),
      JSON.stringify(customProps),
      objectKind,
    ]
  );

  await q(
    `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
     VALUES ($1, $2, $3, $4)`,
    [id, collectionId, pinned, sortOrder]
  );

  return {
    id,
    text,
    minutesOfDay,
    addedOn,
    ...(reminderOn ? { reminderOn } : {}),
    ...(reminderTime ? { reminderTime } : {}),
    ...(reminderNote ? { reminderNote } : {}),
    ...(reminderCompletedAt ? { reminderCompletedAt } : {}),
    ...(reminderCompletedNote ? { reminderCompletedNote } : {}),
    pinned,
    tags,
    relatedRefs,
    media,
    ...(objectKind !== "note" ? { objectKind } : {}),
    ...(Array.isArray(customProps) && customProps.length > 0
      ? { customProps }
      : {}),
  };
}

/**
 * 由笔记上的单个附件元数据创建「文件」对象卡，并与笔记建双向 attachment 边。
 * @param {string|null} userId
 * @param {string} noteCardId
 * @param {{ media: object, placementCollectionId: string }} body
 * @returns {{ fileCardId: string, noteCardId: string }}
 */
export async function createFileCardForNoteMedia(userId, noteCardId, body) {
  const placementCollectionId =
    typeof body.placementCollectionId === "string"
      ? body.placementCollectionId.trim()
      : "";
  const raw = body.media;
  if (!placementCollectionId || !raw || typeof raw !== "object") {
    throw new Error("缺少 placementCollectionId 或 media");
  }
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url) throw new Error("media.url 为必填");

  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 2);
  const noteRow = await query(
    `SELECT id, user_id FROM cards WHERE id = $1 AND (${cOwnSql}) AND trashed_at IS NULL`,
    [noteCardId, ...cOwnParams]
  );
  if (noteRow.rowCount === 0) throw new Error("笔记不存在或无权限");

  const plCheck = await query(
    `SELECT 1 FROM card_placements WHERE card_id = $1 AND collection_id = $2`,
    [noteCardId, placementCollectionId]
  );
  if (plCheck.rowCount === 0) {
    throw new Error("该笔记不在指定合集中");
  }

  const uid = noteRow.rows[0].user_id;

  const kind =
    raw.kind === "image" ||
    raw.kind === "video" ||
    raw.kind === "audio" ||
    raw.kind === "file"
      ? raw.kind
      : "file";
  /** @type {Record<string, unknown>} */
  const mediaItem = {
    url,
    kind,
  };
  if (typeof raw.name === "string" && raw.name.trim())
    mediaItem.name = raw.name.trim();
  if (typeof raw.coverUrl === "string" && raw.coverUrl.trim())
    mediaItem.coverUrl = raw.coverUrl.trim();
  if (typeof raw.thumbnailUrl === "string" && raw.thumbnailUrl.trim())
    mediaItem.thumbnailUrl = raw.thumbnailUrl.trim();
  if (typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes))
    mediaItem.sizeBytes = raw.sizeBytes;
  if (typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec))
    mediaItem.durationSec = raw.durationSec;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [
      `fileobj:${noteCardId}\0${url}`,
    ]);

    const existingFile = await client.query(
      `SELECT c.id
       FROM card_links l
       INNER JOIN cards c ON c.id = l.to_card_id
       WHERE l.from_card_id = $1
         AND l.link_type = 'attachment'
         AND c.user_id = $2
         AND c.object_kind LIKE 'file%'
         AND c.trashed_at IS NULL
         AND (c.media->0->>'url') = $3
       LIMIT 1`,
      [noteCardId, uid, url]
    );
    if (existingFile.rowCount > 0) {
      const fid = existingFile.rows[0].id;
      await client.query("COMMIT");
      return { fileCardId: fid, noteCardId };
    }

    const now = new Date();
    const minutesOfDay = now.getHours() * 60 + now.getMinutes();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const da = String(now.getDate()).padStart(2, "0");
    const day = `${y}-${mo}-${da}`;
    const newId = `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const fileObjectKind = objectKindForFileMediaKind(kind);
    const title = deriveFileCardTitleFromMediaItem(mediaItem);
    const customProps = title
      ? [
          {
            id: "sf-file-title",
            name: "标题",
            type: "text",
            value: title,
          },
        ]
      : [];

    await createCard(
      userId,
      placementCollectionId,
      {
        id: newId,
        text: "",
        minutesOfDay,
        addedOn: day,
        media: [mediaItem],
        tags: [],
        relatedRefs: [],
        objectKind: fileObjectKind,
        customProps,
        insertAtStart: false,
      },
      client
    );

    await client.query(
      `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
       VALUES ($1, $2, $3, 'attachment')
       ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
      [uid, noteCardId, newId]
    );
    await client.query(
      `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
       VALUES ($1, $2, $3, 'attachment')
       ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
      [uid, newId, noteCardId]
    );

    await client.query("COMMIT");
    return { fileCardId: newId, noteCardId };
  } catch (e) {
    await safeRollback(client);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 更新卡片：正文等在 cards 表；置顶、排序、跨合集在 card_placements。
 * patch.placementCollectionId 在更新 pinned / sortOrder / collectionId（移动）时必填。
 * @param {string|null} userId
 * @param {string} cardId
 * @param {object} patch
 */
export async function updateCard(userId, cardId, patch) {
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
    (typeof patch.sortOrder === "number" &&
      Number.isFinite(patch.sortOrder)) ||
    Boolean(moveToColId);

  if (hasPlacementPatch && !placementCollectionId) {
    throw new Error("placementCollectionId 为必填（置顶、排序或移动归属时）");
  }

  if (moveToColId) {
    if (userId === null || userId === undefined) {
      const chk = await query(
        `SELECT 1 FROM collections nc WHERE nc.id = $1 AND nc.user_id IS NULL`,
        [moveToColId]
      );
      if (chk.rowCount === 0) throw new Error("目标合集不存在或无权限");
    } else {
      const chk = await query(
        `SELECT 1 FROM collections nc WHERE nc.id = $1 AND nc.user_id = $2`,
        [moveToColId, userId]
      );
      if (chk.rowCount === 0) throw new Error("目标合集不存在或无权限");
    }
  }

  const hasRelatedSync = Array.isArray(patch.relatedRefs);

  const cardCols = [];
  const cardParams = [];
  let i = 1;

  if (typeof patch.text === "string") {
    cardCols.push(`text = $${i++}`);
    cardParams.push(patch.text);
  }
  if (Array.isArray(patch.tags)) {
    cardCols.push(`tags = $${i++}`);
    cardParams.push(patch.tags);
  }
  if (Array.isArray(patch.media)) {
    cardCols.push(`media = $${i++}`);
    cardParams.push(JSON.stringify(patch.media));
  }
  if (typeof patch.objectKind === "string") {
    const ok = patch.objectKind.trim().slice(0, 64);
    cardCols.push(`object_kind = $${i++}`);
    cardParams.push(ok.length > 0 ? ok : "note");
  }
  if (Array.isArray(patch.customProps)) {
    cardCols.push(`custom_props = $${i++}`);
    cardParams.push(JSON.stringify(patch.customProps));
  }
  if (typeof patch.minutesOfDay === "number") {
    cardCols.push(`minutes_of_day = $${i++}`);
    cardParams.push(patch.minutesOfDay);
  }
  if ("addedOn" in patch) {
    cardCols.push(`added_on = $${i++}`);
    cardParams.push(patch.addedOn ?? null);
  }
  if ("reminderOn" in patch) {
    cardCols.push(`reminder_on = $${i++}`);
    cardParams.push(patch.reminderOn ?? null);
  }
  if ("reminderTime" in patch) {
    cardCols.push(`reminder_time = $${i++}`);
    cardParams.push(patch.reminderTime ?? null);
  }
  if ("reminderNote" in patch) {
    cardCols.push(`reminder_note = $${i++}`);
    cardParams.push(patch.reminderNote ?? null);
  }
  if ("reminderCompletedAt" in patch) {
    cardCols.push(`reminder_completed_at = $${i++}`);
    cardParams.push(patch.reminderCompletedAt ?? null);
  }
  if ("reminderCompletedNote" in patch) {
    cardCols.push(`reminder_completed_note = $${i++}`);
    cardParams.push(patch.reminderCompletedNote ?? null);
  }

  if (cardCols.length === 0 && !hasPlacementPatch && !hasRelatedSync) {
    throw new Error("未提供任何可更新字段");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    if (hasRelatedSync) {
      await syncCardRelatedLinksWithClient(
        client,
        userId,
        cardId,
        patch.relatedRefs
      );
    }

    if (cardCols.length > 0) {
      const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(
        userId,
        i + 1
      );
      const res = await client.query(
        `UPDATE cards SET ${cardCols.join(", ")}
         WHERE id = $${i} AND (${cOwnSql}) AND trashed_at IS NULL`,
        [...cardParams, cardId, ...cOwnParams]
      );
      if (res.rowCount === 0) throw new Error("卡片不存在或无权限");
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
      if (
        typeof patch.sortOrder === "number" &&
        Number.isFinite(patch.sortOrder)
      ) {
        pCols.push(`sort_order = $${k++}`);
        pParams.push(patch.sortOrder);
      }
      if (pCols.length === 0) {
        throw new Error("未提供可更新的归属字段");
      }
      const { sql: pOwnSql, params: pOwnParams } = cardOwnershipCondition(
        userId,
        k + 2
      );
      const pOwnQualified = pOwnSql.replace(/\buser_id\b/g, "c.user_id");
      const res = await client.query(
        `UPDATE card_placements p
         SET ${pCols.join(", ")}
         FROM cards c
         WHERE p.card_id = c.id
           AND p.card_id = $${k}
           AND p.collection_id = $${k + 1}
           AND (${pOwnQualified})`,
        [...pParams, cardId, placementCollectionId, ...pOwnParams]
      );
      if (res.rowCount === 0) throw new Error("卡片归属不存在或无权限");
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 是否已有可展示的时长（与前端一致）
 * @param {unknown} o
 */
function mediaItemHasServerDurationSec(o) {
  if (!o || typeof o !== "object") return false;
  const d = /** @type {{ durationSec?: unknown }} */ (o).durationSec;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) return true;
  if (typeof d === "string" && /^-?\d+(\.\d+)?$/.test(String(d).trim()))
    return true;
  return false;
}

/**
 * 是否已有完整分辨率（宽高均为正整数）
 * @param {unknown} o
 */
function mediaItemHasResolution(o) {
  if (!o || typeof o !== "object") return false;
  const x = /** @type {{ widthPx?: unknown; heightPx?: unknown }} */ (o);
  const w = x.widthPx;
  const h = x.heightPx;
  if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || w > 32767)
    return false;
  if (typeof h !== "number" || !Number.isFinite(h) || h <= 0 || h > 32767)
    return false;
  return true;
}

/**
 * 合并单条附件元数据（仅填空项）：供浏览器探测到时长/分辨率后写回，避免整卡 PATCH。
 * @param {string|null} userId
 * @param {string} cardId
 * @param {number} mediaIndex
 * @param {{ durationSec?: number; sizeBytes?: number; widthPx?: number; heightPx?: number }} patch
 * @returns {Promise<{ updated: boolean }>}
 */
export async function patchCardMediaItemAtIndex(
  userId,
  cardId,
  mediaIndex,
  patch
) {
  const cid = String(cardId || "").trim();
  if (!cid) throw new Error("缺少卡片 id");
  const idx = Math.floor(Number(mediaIndex));
  if (!Number.isFinite(idx) || idx < 0) throw new Error("附件索引无效");

  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(
    userId,
    2
  );
  const r = await query(
    `SELECT media FROM cards WHERE id = $1 AND (${cOwnSql}) AND trashed_at IS NULL`,
    [cid, ...cOwnParams]
  );
  if (r.rowCount === 0) throw new Error("笔记不存在或无权限");

  const raw = r.rows[0].media;
  /** @type {unknown[]} */
  const media = Array.isArray(raw)
    ? JSON.parse(JSON.stringify(raw))
    : [];
  if (idx >= media.length) throw new Error("附件索引无效");

  const cur = media[idx];
  if (!cur || typeof cur !== "object") throw new Error("附件数据无效");

  let changed = false;
  const p = patch && typeof patch === "object" ? patch : {};

  if (
    typeof p.durationSec === "number" &&
    Number.isFinite(p.durationSec) &&
    p.durationSec >= 0 &&
    p.durationSec <= 86400000
  ) {
    if (!mediaItemHasServerDurationSec(cur)) {
      /** @type {Record<string, unknown>} */ (cur).durationSec = Math.round(
        p.durationSec
      );
      changed = true;
    }
  }

  if (
    typeof p.sizeBytes === "number" &&
    Number.isFinite(p.sizeBytes) &&
    p.sizeBytes >= 0 &&
    p.sizeBytes <= 9223372036854775807
  ) {
    const sb = /** @type {Record<string, unknown>} */ (cur).sizeBytes;
    const has =
      (typeof sb === "number" &&
        Number.isFinite(sb) &&
        sb >= 0 &&
        Number.isInteger(sb)) ||
      (typeof sb === "string" && /^[0-9]+$/.test(String(sb).trim()));
    if (!has) {
      /** @type {Record<string, unknown>} */ (cur).sizeBytes = Math.floor(
        p.sizeBytes
      );
      changed = true;
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
    p.heightPx <= 32767
  ) {
    if (!mediaItemHasResolution(cur)) {
      /** @type {Record<string, unknown>} */ (cur).widthPx = Math.round(
        p.widthPx
      );
      /** @type {Record<string, unknown>} */ (cur).heightPx = Math.round(
        p.heightPx
      );
      changed = true;
    }
  }

  if (!changed) return { updated: false };

  await query(
    `UPDATE cards SET media = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(media), cid]
  );
  return { updated: true };
}

/**
 * 从指定合集移除一条 card 归属（多合集）；删后若无任何 placement，卡片在 GET 树中会以「未归类」孤儿形式出现。
 * @param {string|null} userId
 * @param {string} cardId
 * @param {string} collectionId
 */
export async function removeCardFromCollectionPlacement(
  userId,
  cardId,
  collectionId
) {
  const cid = String(cardId || "").trim();
  const colId = String(collectionId || "").trim();
  if (!cid || !colId) throw new Error("缺少卡片或合集");

  const { sql: ownSql, params: ownParams } = cardOwnershipCondition(userId, 3);
  const ownOnC = ownSql.replace(/\buser_id\b/g, "c.user_id");
  const res = await query(
    `DELETE FROM card_placements p
     USING cards c
     WHERE p.card_id = c.id
       AND p.card_id = $1
       AND p.collection_id = $2
       AND c.trashed_at IS NULL
       AND (${ownOnC})`,
    [cid, colId, ...ownParams]
  );
  if (res.rowCount === 0) {
    throw new Error("归属不存在或无权限");
  }
}

/**
 * 删除整张笔记（所有合集中的出现一并删除）。
 * @param {string|null} userId
 * @param {string} cardId
 */
export async function deleteCard(userId, cardId) {
  const { sql: ownSql, params: ownParams } = cardOwnershipCondition(userId, 2);
  const res = await query(
    `DELETE FROM cards
     WHERE id = $1 AND (${ownSql})`,
    [cardId, ...ownParams]
  );
  if (res.rowCount === 0) throw new Error("卡片不存在或无权限");
}

// ─────────────────────────────────────────────────────────────────────────────
// 侧栏：星标（collections.is_favorite）+ 垃圾桶（软删除在 cards.trashed_at）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * preferences owner_key → cards.user_id（与 listFavoriteCollectionIds 一致）
 * @param {string} ownerKey
 * @returns {string|null}
 */
function ownerKeyToUserId(ownerKey) {
  if (!ownerKey || ownerKey === "__single__") return null;
  return ownerKey;
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} collectionId
 * @param {string|null|undefined} userId — 与 getCollectionsTree 一致；null 表示单用户库
 */
async function collectionOwnedByUser(client, collectionId, userId) {
  if (userId === null || userId === undefined) {
    const r = await client.query(
      `SELECT 1 FROM collections WHERE id = $1 AND user_id IS NULL`,
      [collectionId]
    );
    return r.rowCount > 0;
  }
  const r = await client.query(
    `SELECT 1 FROM collections WHERE id = $1 AND user_id = $2`,
    [collectionId, userId]
  );
  return r.rowCount > 0;
}

/**
 * 星标合集 id 列表（顺序与侧栏一致）。
 * @param {string} ownerKey 多用户为 JWT sub；单库为 __single__
 * @returns {Promise<string[]>}
 */
export async function listFavoriteCollectionIds(ownerKey) {
  if (!ownerKey || ownerKey === "__single__") {
    const res = await query(
      `SELECT id FROM collections
       WHERE user_id IS NULL AND is_favorite = true
       ORDER BY favorite_sort ASC NULLS LAST, sort_order ASC, id ASC`,
      []
    );
    return res.rows.map((r) => r.id);
  }
  const res = await query(
    `SELECT id FROM collections
     WHERE user_id = $1 AND is_favorite = true
     ORDER BY favorite_sort ASC NULLS LAST, sort_order ASC, id ASC`,
    [ownerKey]
  );
  return res.rows.map((r) => r.id);
}

/**
 * 整表替换星标：先清空当前用户名下所有 is_favorite，再按数组顺序写回。
 * @param {string} ownerKey 与 preferencesOwnerKey 一致（保留参数供调用方对齐）
 * @param {string[]} collectionIds
 * @param {string|null|undefined} userId
 */
export async function replaceFavoriteCollectionIds(
  _ownerKey,
  collectionIds,
  userId
) {
  const ids = Array.isArray(collectionIds) ? collectionIds : [];
  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (userId === null || userId === undefined) {
      await client.query(
        `UPDATE collections SET is_favorite = false, favorite_sort = NULL WHERE user_id IS NULL`
      );
    } else {
      await client.query(
        `UPDATE collections SET is_favorite = false, favorite_sort = NULL WHERE user_id = $1`,
        [userId]
      );
    }
    let sort = 0;
    for (const cid of ids) {
      if (typeof cid !== "string" || !cid.trim()) continue;
      const id = cid.trim();
      const ok = await collectionOwnedByUser(client, id, userId);
      if (!ok) continue;
      if (userId === null || userId === undefined) {
        await client.query(
          `UPDATE collections SET is_favorite = true, favorite_sort = $1 WHERE id = $2 AND user_id IS NULL`,
          [sort, id]
        );
      } else {
        await client.query(
          `UPDATE collections SET is_favorite = true, favorite_sort = $1 WHERE id = $2 AND user_id = $3`,
          [sort, id, userId]
        );
      }
      sort += 1;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {string} ownerKey
 */
export async function listTrashedNotes(ownerKey) {
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 1);
  const res = await query(
    `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
            c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
            c.tags, c.related_refs, c.media, c.custom_props, c.object_kind,
            c.trashed_at, c.trash_col_id, c.trash_col_path_label
     FROM cards c
     WHERE (${uidSql}) AND c.trashed_at IS NOT NULL
     ORDER BY c.trashed_at DESC`,
    uidParams
  );
  const entries = res.rows.map((r) => ({
    trashId: r.id,
    colId: r.trash_col_id ?? "",
    colPathLabel: r.trash_col_path_label ?? "",
    card: rowToCard({ ...r, pinned: false }),
    deletedAt:
      r.trashed_at instanceof Date
        ? r.trashed_at.toISOString()
        : String(r.trashed_at),
  }));
  const ids = entries.map((e) => e.card.id);
  const relMap = await loadRelatedRefsMapFromLinks(userId, ids);
  return entries.map((e) => ({
    ...e,
    card: { ...e.card, relatedRefs: relMap.get(e.card.id) ?? [] },
  }));
}

/**
 * 软删除：移除所有归属行并标记 trashed_at（不再使用独立 trashed_notes 表）。
 * @param {string} ownerKey
 * @param {{ colId: string, colPathLabel?: string, cardId: string, deletedAt?: string }} row
 */
export async function softTrashCard(ownerKey, row) {
  const { colId, colPathLabel = "", cardId, deletedAt } = row;
  if (!colId || !cardId) {
    throw new Error("回收站条目缺少 colId 或 card.id");
  }
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 2);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const chk = await client.query(
      `SELECT trashed_at FROM cards WHERE id = $1 AND (${cUidSql})`,
      [cardId, ...cUidParams]
    );
    if (chk.rowCount === 0) throw new Error("卡片不存在或无权限");
    if (chk.rows[0].trashed_at != null) {
      throw new Error("卡片已在回收站中");
    }
    await client.query(`DELETE FROM card_placements WHERE card_id = $1`, [
      cardId,
    ]);
    const ts = deletedAt ? new Date(deletedAt) : new Date();
    const { sql: uSql, params: uParams } = userIdCondition(userId, 5);
    const up = await client.query(
      `UPDATE cards SET trashed_at = $1::timestamptz, trash_col_id = $2, trash_col_path_label = $3
       WHERE id = $4 AND (${uSql}) AND trashed_at IS NULL`,
      [
        ts.toISOString(),
        colId,
        String(colPathLabel ?? ""),
        cardId,
        ...uParams,
      ]
    );
    if (up.rowCount === 0) throw new Error("无法移入回收站");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 从回收站恢复到指定合集（清除 trashed 标记并插入一条归属）。
 * @param {string} ownerKey
 * @param {string} cardId
 * @param {string} targetCollectionId
 * @param {boolean} [insertAtStart]
 * @returns {Promise<object>}
 */
export async function restoreTrashedCard(
  ownerKey,
  cardId,
  targetCollectionId,
  insertAtStart = false
) {
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: colUidSql, params: colUidParams } = userIdCondition(
    userId,
    2
  );
  const colCheck = await query(
    `SELECT id FROM collections WHERE id = $1 AND (${colUidSql})`,
    [targetCollectionId, ...colUidParams]
  );
  if (colCheck.rowCount === 0) throw new Error("合集不存在或无权限");

  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 2);
  const cardChk = await query(
    `SELECT id FROM cards WHERE id = $1 AND (${cUidSql}) AND trashed_at IS NOT NULL`,
    [cardId, ...cUidParams]
  );
  if (cardChk.rowCount === 0) {
    throw new Error("回收站中找不到该笔记或无权恢复");
  }

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
    const { sql: uSql, params: uParams } = userIdCondition(userId, 2);
    const up = await client.query(
      `UPDATE cards SET trashed_at = NULL, trash_col_id = NULL, trash_col_path_label = ''
       WHERE id = $1 AND (${uSql}) AND trashed_at IS NOT NULL`,
      [cardId, ...uParams]
    );
    if (up.rowCount === 0) throw new Error("恢复失败");
    await client.query(
      `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
       VALUES ($1, $2, false, $3)`,
      [cardId, targetCollectionId, sortOrder]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const row = await query(
    `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
            c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
            c.tags, c.related_refs, c.media, c.custom_props, c.object_kind, p.pinned
     FROM cards c
     JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
     WHERE c.id = $1`,
    [cardId, targetCollectionId]
  );
  const r = row.rows[0];
  if (!r) return { id: cardId };
  const card = rowToCard(r);
  const relMap = await loadRelatedRefsMapFromLinks(userId, [cardId]);
  return { ...card, relatedRefs: relMap.get(cardId) ?? [] };
}

/**
 * 永久删除回收站中的一条（按卡片 id，与 trashId 一致）。
 * @param {string} ownerKey
 * @param {string} trashId
 */
export async function deleteTrashedNote(ownerKey, trashId) {
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const res = await query(
    `DELETE FROM cards
     WHERE id = $1 AND (${uidSql}) AND trashed_at IS NOT NULL`,
    [trashId, ...uidParams]
  );
  if (res.rowCount === 0) throw new Error("回收站记录不存在或无权限");
}

/**
 * @param {string} ownerKey
 */
export async function clearTrashedNotes(ownerKey) {
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 1);
  await query(`DELETE FROM cards WHERE (${uidSql}) AND trashed_at IS NOT NULL`, uidParams);
}

// ─────────────────────────────────────────────────────────────────────────────
// 附件索引（card_attachments，与 cards.media 触发器同步）
// ─────────────────────────────────────────────────────────────────────────────

/** 与前端 noteMediaCategory 文档扩展名规则一致 */
const ATTACH_DOC_RE =
  "\\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|pages|numbers|key|epub|json|xml|yml|yaml)$";

/**
 * @param {string} filterKey
 * @param {string} [alias]
 */
function attachmentWhereSql(filterKey, alias = "a") {
  const tail = `lower(regexp_replace(regexp_replace(split_part(${alias}.url, '?', 1), '#.*$', ''), '^.*[/\\\\\\\\]', ''))`;
  const docPred = `(${alias}.kind = 'file' AND (
    COALESCE(${alias}.name, '') ~* '${ATTACH_DOC_RE}'
    OR ${tail} ~* '${ATTACH_DOC_RE}'
  ))`;
  switch (filterKey) {
    case "image":
      return `${alias}.kind = 'image'`;
    case "video":
      return `${alias}.kind = 'video'`;
    case "audio":
      return `${alias}.kind = 'audio'`;
    case "document":
      return docPred;
    case "other":
      return `NOT (${alias}.kind IN ('image','video','audio')) AND NOT (${docPred})`;
    default:
      return "TRUE";
  }
}

/**
 * @param {string} raw
 */
function normalizeAttachmentFilterKey(raw) {
  const k = String(raw || "all").trim().toLowerCase();
  if (
    k === "image" ||
    k === "video" ||
    k === "audio" ||
    k === "document" ||
    k === "other" ||
    k === "all"
  ) {
    return k;
  }
  return "all";
}

/**
 * 当前用户附件条数（未进回收站的卡片）。
 * @param {string} ownerKey
 * @param {string} [filterKey]
 */
export async function countCardAttachments(ownerKey, filterKey = "all") {
  const fk = normalizeAttachmentFilterKey(filterKey);
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 1);
  const cUidQ = cUidSql.replace(/\buser_id\b/g, "c.user_id");
  const filt = attachmentWhereSql(fk);
  const res = await query(
    `SELECT COUNT(*)::bigint AS n
     FROM card_attachments a
     INNER JOIN cards c ON c.id = a.card_id AND c.trashed_at IS NULL
       AND (${cUidQ}) AND c.object_kind LIKE 'file%'
     WHERE ${filt}`,
    cUidParams
  );
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * 分页附件列表（用于「文件」页，避免拉全树）。
 * @param {string} ownerKey
 * @param {{ filterKey?: string, limit?: number, offset?: number }} opts
 */
export async function listCardAttachmentsPage(ownerKey, opts = {}) {
  const fk = normalizeAttachmentFilterKey(opts.filterKey);
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 40));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const total = await countCardAttachments(ownerKey, fk);
  if (total === 0) {
    return { items: [], total: 0 };
  }
  const userId = ownerKeyToUserId(ownerKey);
  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 1);
  const cUidQ = cUidSql.replace(/\buser_id\b/g, "c.user_id");
  const filt = attachmentWhereSql(fk);
  const limIdx = cUidParams.length + 1;
  const offIdx = cUidParams.length + 2;
  const res = await query(
    `SELECT COALESCE(pl.cid, '${LOOSE_NOTES_COLLECTION_ID}') AS col_id,
            a.card_id, a.sort_order,
            a.kind, a.url, a.name, a.thumbnail_url, a.cover_url, a.size_bytes,
            a.duration_sec, c.media AS card_media
     FROM card_attachments a
     INNER JOIN cards c ON c.id = a.card_id AND c.trashed_at IS NULL
       AND (${cUidQ}) AND c.object_kind LIKE 'file%'
     LEFT JOIN LATERAL (
       SELECT p.collection_id AS cid
       FROM card_placements p
       WHERE p.card_id = a.card_id
       ORDER BY p.collection_id ASC
       LIMIT 1
     ) pl ON TRUE
     WHERE ${filt}
     ORDER BY c.added_on DESC NULLS LAST, c.minutes_of_day DESC,
              COALESCE(pl.cid, '') ASC, a.card_id ASC, a.sort_order ASC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    [...cUidParams, limit, offset]
  );
  const items = res.rows.map((r) => {
    const th = r.thumbnail_url != null ? String(r.thumbnail_url).trim() : "";
    const cv = r.cover_url != null ? String(r.cover_url).trim() : "";
    const item = {
      url: r.url,
      kind: r.kind,
      ...(r.name ? { name: r.name } : {}),
      ...(th ? { thumbnailUrl: th } : {}),
      ...(cv ? { coverUrl: cv } : {}),
      ...(r.size_bytes != null
        ? { sizeBytes: Number(r.size_bytes) }
        : {}),
      ...(r.duration_sec != null &&
      Number.isFinite(Number(r.duration_sec)) &&
      Number(r.duration_sec) >= 0
        ? { durationSec: Math.round(Number(r.duration_sec)) }
        : {}),
    };
    try {
      let arr = r.card_media;
      if (typeof arr === "string") arr = JSON.parse(arr);
      if (Array.isArray(arr)) {
        const idx = Number(r.sort_order);
        const el = Number.isFinite(idx) && idx >= 0 ? arr[idx] : null;
        if (el && typeof el === "object") {
          const w = /** @type {{ widthPx?: unknown }} */ (el).widthPx;
          const h = /** @type {{ heightPx?: unknown }} */ (el).heightPx;
          if (
            typeof w === "number" &&
            typeof h === "number" &&
            Number.isFinite(w) &&
            Number.isFinite(h) &&
            w > 0 &&
            h > 0
          ) {
            item.widthPx = Math.round(w);
            item.heightPx = Math.round(h);
          }
        }
      }
    } catch {
      /* 列表项不强制带分辨率 */
    }
    return {
      colId: r.col_id,
      cardId: r.card_id,
      mediaIndex: r.sort_order,
      item,
    };
  });
  return { items, total };
}

/**
 * 每位用户「库内」附件总字节（card_attachments.size_bytes 之和，仅未进回收站的卡片）。
 * @returns {Promise<Map<string, number>>} userId → bytes（无附件的用户不在 Map 中）
 */
export async function attachmentStorageBytesByUserId() {
  const res = await query(
    `SELECT c.user_id AS uid, COALESCE(SUM(a.size_bytes), 0)::bigint AS n
     FROM card_attachments a
     INNER JOIN cards c ON c.id = a.card_id AND c.trashed_at IS NULL
     WHERE c.user_id IS NOT NULL
     GROUP BY c.user_id`
  );
  const map = new Map();
  for (const row of res.rows) {
    if (row.uid == null) continue;
    const id = String(row.uid).trim();
    if (!id) continue;
    const n = Number(row.n);
    map.set(id, Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 对象类型 Schema / 自动关联引擎 / 附件迁移
// ─────────────────────────────────────────────────────────────────────────────

/** 从当前时间生成 YYYY-MM-DD 和 minutesOfDay */
function nowDateParts() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const da = String(now.getDate()).padStart(2, "0");
  return { addedOn: `${y}-${mo}-${da}`, minutesOfDay: now.getHours() * 60 + now.getMinutes() };
}

/** 生成与现有代码一致的卡片 id */
function newCardId() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 展开 AutoLinkRule（支持 targets[] 或单 targetObjectKind + linkType）。
 * @param {object} rule
 * @returns {Array<{ ruleId: string, trigger: string, targetKey: string, targetObjectKind: string, linkType: string, targetPresetTypeId?: string }>}
 */
function expandAutoLinkRuleSteps(rule) {
  const rid = rule.ruleId;
  const trig = rule.trigger ?? "on_save";
  const ruleLevelCol =
    typeof rule.targetCollectionId === "string" && rule.targetCollectionId.trim()
      ? rule.targetCollectionId.trim()
      : undefined;
  const ruleTargetSync =
    typeof rule.targetSyncSchemaFieldId === "string" &&
    rule.targetSyncSchemaFieldId.trim()
      ? rule.targetSyncSchemaFieldId.trim()
      : undefined;
  if (Array.isArray(rule.targets) && rule.targets.length > 0) {
    return rule.targets.map((t) => {
      const stepCol =
        typeof t.targetCollectionId === "string" && t.targetCollectionId.trim()
          ? t.targetCollectionId.trim()
          : ruleLevelCol;
      const tSync =
        typeof t.targetSyncSchemaFieldId === "string" &&
        t.targetSyncSchemaFieldId.trim()
          ? t.targetSyncSchemaFieldId.trim()
          : ruleTargetSync;
      return {
        ruleId: rid,
        trigger: trig,
        targetKey: t.targetKey ?? "default",
        targetObjectKind: t.targetObjectKind,
        linkType: t.linkType,
        targetPresetTypeId: t.targetPresetTypeId,
        targetCollectionId: stepCol,
        syncSchemaFieldId:
          typeof t.syncSchemaFieldId === "string" && t.syncSchemaFieldId.trim()
            ? t.syncSchemaFieldId.trim()
            : undefined,
        targetSyncSchemaFieldId: tSync,
      };
    });
  }
  if (rule.targetObjectKind && rule.linkType) {
    const ruleSync =
      typeof rule.syncSchemaFieldId === "string" && rule.syncSchemaFieldId.trim()
        ? rule.syncSchemaFieldId.trim()
        : undefined;
    return [
      {
        ruleId: rid,
        trigger: trig,
        targetKey: "default",
        targetObjectKind: rule.targetObjectKind,
        linkType: rule.linkType,
        targetPresetTypeId: rule.targetPresetTypeId,
        targetCollectionId: ruleLevelCol,
        syncSchemaFieldId: ruleSync,
        targetSyncSchemaFieldId: ruleTargetSync,
      },
    ];
  }
  return [];
}

const AUTO_LINK_NEW_CARD_TITLE_MAX = 500;

/** @param {object|undefined|null} prop custom_props 单项 */
function customPropValueAsAutoLinkTitle(prop) {
  if (!prop || prop.value == null || prop.value === "") return "";
  const v = prop.value;
  const t = prop.type;
  if (t === "text" || t === "url" || t === "date") return String(v).trim();
  if (t === "number") return String(v).trim();
  if (t === "choice") {
    if (Array.isArray(v)) return v.map(String).filter(Boolean).join(", ").trim();
    return String(v).trim();
  }
  if (t === "checkbox" || t === "cardLink") return "";
  if (t === "collectionLink") {
    if (Array.isArray(v)) return v.length ? v.join(", ") : "";
    return "";
  }
  return typeof v === "string" ? v.trim() : "";
}

function truncateAutoLinkCardTitle(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t.length <= AUTO_LINK_NEW_CARD_TITLE_MAX) return t;
  return t.slice(0, AUTO_LINK_NEW_CARD_TITLE_MAX);
}

/**
 * 自动建卡：用源卡 schema 属性作为目标卡标题（cards.text）。
 * 优先 step.syncSchemaFieldId；无则 source 类目标尝试源上首个 url 字段；再回落正文首行。
 *
 * @param {{ syncSchemaFieldId?: string, linkType?: string, targetKey?: string }} step
 * @param {{ text?: string, custom_props?: unknown }} sourceCardRow
 * @param {Map<string, object>} mergedFieldMap
 */
function autoLinkNewCardTitleFromSource(step, sourceCardRow, mergedFieldMap) {
  const props = Array.isArray(sourceCardRow.custom_props) ? sourceCardRow.custom_props : [];
  const readByFieldId = (fid) => {
    const id = typeof fid === "string" ? fid.trim() : "";
    if (!id) return "";
    const p = props.find((x) => x && x.id === id);
    return customPropValueAsAutoLinkTitle(p);
  };

  const syncId =
    typeof step.syncSchemaFieldId === "string" && step.syncSchemaFieldId.trim()
      ? step.syncSchemaFieldId.trim()
      : "";
  if (syncId) {
    return truncateAutoLinkCardTitle(readByFieldId(syncId));
  }

  const key = typeof step.targetKey === "string" ? step.targetKey : "";
  const ltype = typeof step.linkType === "string" ? step.linkType : "";
  if (key === "source" || ltype === "source") {
    const urlFields = [...mergedFieldMap.values()].filter((f) => f && f.type === "url");
    urlFields.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const f of urlFields) {
      const t = readByFieldId(f.id);
      if (t) return truncateAutoLinkCardTitle(t);
    }
  }

  const body = typeof sourceCardRow.text === "string" ? sourceCardRow.text.trim() : "";
  if (body) {
    const line = body.split("\n")[0].trim();
    if (line) return truncateAutoLinkCardTitle(line);
  }
  return "";
}

/** 目标合集无 preset_type_id 时新建卡默认 note */
function objectKindFromCollectionRow(colRow) {
  if (!colRow) return "note";
  const pid =
    typeof colRow.preset_type_id === "string" ? colRow.preset_type_id.trim() : "";
  return pid || "note";
}

function normalizeCardObjectKindRow(row) {
  const raw = row?.object_kind;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "note";
}

/**
 * 未设置 source 条件时视为匹配（兼容内置 schema 规则）。
 * @param {object} cardRow cards 行（须含 object_kind）
 * @param {string[]} colIds 源卡 placement 合集 id
 * @param {Map<string, object>} colMap collections 行映射（须含 preset_type_id、parent_id）
 * @param {object} rule
 */
function cardMatchesAutoLinkRuleSource(cardRow, colIds, colMap, rule) {
  const scol =
    typeof rule.sourceCollectionId === "string" && rule.sourceCollectionId.trim()
      ? rule.sourceCollectionId.trim()
      : "";
  if (scol && !colIds.includes(scol)) return false;

  const so =
    typeof rule.sourceObjectKind === "string" && rule.sourceObjectKind.trim()
      ? rule.sourceObjectKind.trim()
      : "";
  const sp =
    typeof rule.sourcePresetTypeId === "string" && rule.sourcePresetTypeId.trim()
      ? rule.sourcePresetTypeId.trim()
      : "";
  if (!so && !sp) return true;

  if (so) {
    const got = normalizeCardObjectKindRow(cardRow);
    if (got !== so) return false;
  }
  if (sp) {
    let found = false;
    for (const colId of colIds) {
      let cur = colMap.get(colId);
      while (cur) {
        const pid =
          typeof cur.preset_type_id === "string" ? cur.preset_type_id.trim() : "";
        if (pid && pid === sp) {
          found = true;
          break;
        }
        cur = cur.parent_id ? colMap.get(cur.parent_id) : null;
      }
      if (found) break;
    }
    if (!found) return false;
  }
  return true;
}

/** preset_type_id 候选（网页链接可回落到父类型 web） */
function presetTypeIdCandidates(presetTypeId, objectKind) {
  /** @type {string[]} */
  const out = [];
  const add = (x) => {
    if (typeof x === "string" && x.trim() && !out.includes(x)) out.push(x.trim());
  };
  add(presetTypeId);
  add(objectKind);
  if (objectKind === "web_page") add("web");
  return out;
}

/**
 * 为自动关联规则解析目标类别合集 id；找不到则返回 null（调用方用源卡首个合集）。
 * @param {string|null} userId
 * @param {string|undefined} presetTypeId
 * @param {string} objectKind
 */
async function findPresetCollectionIdForAutoLink(userId, presetTypeId, objectKind) {
  const { sql: tUidSql, params: tUidParams } = userIdCondition(userId, 2);
  for (const pid of presetTypeIdCandidates(presetTypeId, objectKind)) {
    const tColRes = await query(
      `SELECT id FROM collections WHERE preset_type_id = $1 AND ${tUidSql} LIMIT 1`,
      [pid, ...tUidParams]
    );
    if (tColRes.rowCount > 0) return tColRes.rows[0].id;
  }
  return null;
}

/**
 * 按 preset_type_id 查找用户（或单用户 null）的类别合集 id。
 * @param {string|null} userId
 * @param {string} presetTypeId
 * @returns {Promise<string|null>}
 */
export async function getPresetCollectionId(userId, presetTypeId) {
  const pid = String(presetTypeId || "").trim();
  if (!pid) return null;
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const res = await query(
    `SELECT id FROM collections WHERE preset_type_id = $1 AND ${uidSql} LIMIT 1`,
    [pid, ...uidParams]
  );
  return res.rowCount > 0 ? res.rows[0].id : null;
}

/**
 * 将 cardLink 引用写入源卡 custom_props（与 auto-link 同事务）。
 * @param {import("pg").PoolClient} client
 * @param {string|null} userId
 * @param {string} sourceCardId
 * @param {string} fieldId
 * @param {{ colId: string, cardId: string }} ref
 * @param {Map<string, object>} mergedFieldMap
 */
async function mergeCardLinkCustomPropWithClient(
  client,
  userId,
  sourceCardId,
  fieldId,
  ref,
  mergedFieldMap
) {
  if (!fieldId || !ref?.colId || !ref?.cardId) return;
  const { sql: ownSql, params: ownParams } = cardOwnershipCondition(userId, 2);
  const res = await client.query(
    `SELECT custom_props FROM cards WHERE id = $1 AND (${ownSql}) AND trashed_at IS NULL`,
    [sourceCardId, ...ownParams]
  );
  if (res.rowCount === 0) return;
  const props = Array.isArray(res.rows[0].custom_props)
    ? res.rows[0].custom_props
    : [];
  const fieldMeta = mergedFieldMap.get(fieldId);
  const name = fieldMeta?.name ?? fieldId;
  const idx = props.findIndex((p) => p && p.id === fieldId);
  const nextVal = { colId: ref.colId, cardId: ref.cardId };
  let nextProps;
  if (idx >= 0) {
    nextProps = props.map((p, i) =>
      i === idx
        ? { ...p, id: fieldId, name: p.name || name, type: "cardLink", value: nextVal }
        : p
    );
  } else {
    nextProps = [...props, { id: fieldId, name, type: "cardLink", value: nextVal }];
  }
  await client.query(
    `UPDATE cards SET custom_props = $2::jsonb WHERE id = $1 AND (${ownSql}) AND trashed_at IS NULL`,
    [sourceCardId, JSON.stringify(nextProps), ...ownParams]
  );
}

/**
 * 解析合集树中一条合集链（colId → 父 → 爷…）的有效 Schema，
 * 合并 autoLinkRules（子优先覆盖父，按 ruleId 去重）。
 *
 * @param {Map<string, object>} colMap  - 所有合集的 id → row 映射
 * @param {string} colId
 * @returns {{ rules: Array, fields: Array }}
 */
function resolveSchemaFromChain(colMap, colId) {
  const chain = [];
  let cur = colMap.get(colId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_id ? colMap.get(cur.parent_id) : null;
  }
  const ruleMap = new Map();
  const fieldMap = new Map();
  for (const node of chain) {
    const schema = node.card_schema ?? {};
    for (const r of (schema.autoLinkRules ?? [])) ruleMap.set(r.ruleId, r);
    for (const f of (schema.fields ?? [])) fieldMap.set(f.id, f);
  }
  return {
    rules: [...ruleMap.values()],
    fields: [...fieldMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  };
}

/**
 * 用户笔记偏好（与 trashed_notes.owner_key 一致：JWT sub 或 __single__）。
 * @param {Map<string, object>} ruleMap
 * @param {{ disabledAutoLinkRuleIds?: string[], extraAutoLinkRules?: object[] }} prefs
 */
function applyNotePrefsToAutoLinkRuleMap(ruleMap, prefs) {
  if (!prefs || typeof prefs !== "object") return;
  const raw = prefs.disabledAutoLinkRuleIds;
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (typeof id === "string" && id.trim()) ruleMap.delete(id.trim());
    }
  }
  const extras = prefs.extraAutoLinkRules;
  if (Array.isArray(extras)) {
    for (const r of extras) {
      if (r && typeof r === "object" && typeof r.ruleId === "string" && r.ruleId.trim()) {
        ruleMap.set(r.ruleId.trim(), r);
      }
    }
  }
}

/**
 * @param {string} ownerKey
 * @returns {Promise<{ disabledAutoLinkRuleIds: string[], extraAutoLinkRules: object[] }>}
 */
export async function getNotePrefsForOwnerKey(ownerKey) {
  const key = typeof ownerKey === "string" && ownerKey.trim() ? ownerKey.trim() : "__single__";
  const empty = { disabledAutoLinkRuleIds: [], extraAutoLinkRules: [] };
  const res = await query(
    `SELECT prefs FROM user_note_prefs WHERE owner_key = $1`,
    [key]
  );
  if (res.rowCount === 0) return empty;
  const p = res.rows[0].prefs;
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
  return out;
}

const NOTE_PREFS_MAX_DISABLED = 80;
const NOTE_PREFS_MAX_EXTRA_RULES = 24;

/**
 * @param {unknown} body
 * @returns {{ disabledAutoLinkRuleIds: string[], extraAutoLinkRules: object[] }}
 */
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
  return normalized;
}

/**
 * @param {string} ownerKey
 * @param {{ disabledAutoLinkRuleIds: string[], extraAutoLinkRules: object[] }} prefs
 */
export async function replaceNotePrefsForOwnerKey(ownerKey, prefs) {
  const key = typeof ownerKey === "string" && ownerKey.trim() ? ownerKey.trim() : "__single__";
  const normalized = normalizeNotePrefsPayload(prefs);
  await query(
    `INSERT INTO user_note_prefs (owner_key, prefs, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (owner_key) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
    [key, JSON.stringify(normalized)]
  );
  return normalized;
}

/**
 * 保存卡片后，根据所在合集的 autoLinkRules 静默创建缺失的关联卡片并双向连接。
 * fire-and-forget 设计：规则级异常单独 catch + 日志，不影响主请求。
 *
 * @param {string|null} userId
 * @param {string} cardId
 */
export async function runAutoLinkRulesForCard(userId, cardId) {
  try {
    // 1. 验证卡片存在
    const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 2);
    const cardRes = await query(
      `SELECT id, user_id, object_kind, text, custom_props FROM cards WHERE id = $1 AND (${cOwnSql}) AND trashed_at IS NULL`,
      [cardId, ...cOwnParams]
    );
    if (cardRes.rowCount === 0) return;
    const uid = cardRes.rows[0].user_id;
    const cardRow = cardRes.rows[0];

    // 2. 找到卡片所在的所有合集
    const placementsRes = await query(
      `SELECT collection_id FROM card_placements WHERE card_id = $1`,
      [cardId]
    );
    const colIds = placementsRes.rows.map((r) => r.collection_id);
    if (colIds.length === 0) return;

    // 3. 加载当前用户的全部合集（用于父链遍历）
    const { sql: colUidSql, params: colUidParams } = userIdCondition(userId, 1);
    const allColsRes = await query(
      `SELECT id, parent_id, is_category, card_schema, preset_type_id FROM collections WHERE ${colUidSql}`,
      colUidParams
    );
    const colMap = new Map(allColsRes.rows.map((r) => [r.id, r]));

    // 4. 合并所有合集的规则（按 ruleId 去重，后合集覆盖前）
    const allRules = new Map();
    for (const colId of colIds) {
      const { rules } = resolveSchemaFromChain(colMap, colId);
      for (const rule of rules) {
        if (!allRules.has(rule.ruleId)) allRules.set(rule.ruleId, rule);
      }
    }

    const prefsOwnerKey = uid != null ? String(uid) : "__single__";
    const notePrefs = await getNotePrefsForOwnerKey(prefsOwnerKey);
    applyNotePrefsToAutoLinkRuleMap(allRules, notePrefs);

    if (allRules.size === 0) return;

    const mergedFieldMap = new Map();
    for (const cid of colIds) {
      const { fields } = resolveSchemaFromChain(colMap, cid);
      for (const f of fields) mergedFieldMap.set(f.id, f);
    }

    // 5. 对每条规则的每个 target：按需建卡 + 写入 cardLink 型 custom_props
    for (const [, rule] of allRules) {
      if (!cardMatchesAutoLinkRuleSource(cardRow, colIds, colMap, rule)) continue;
      const steps = expandAutoLinkRuleSteps(rule);
      if (steps.length === 0) continue;

      for (const step of steps) {
        try {
          const existLink = await query(
            `SELECT l.to_card_id
             FROM card_links l
             INNER JOIN cards tc ON tc.id = l.to_card_id AND tc.trashed_at IS NULL
             WHERE l.from_card_id = $1 AND l.link_type = $2 AND tc.object_kind = $3
             LIMIT 1`,
            [cardId, step.linkType, step.targetObjectKind]
          );

          if (existLink.rowCount > 0 && !step.syncSchemaFieldId) continue;

          const client = await getClient();
          try {
            await client.query("BEGIN");
            let linkedColId;
            let linkedCardId;

            if (existLink.rowCount > 0) {
              linkedCardId = existLink.rows[0].to_card_id;
              const pl = await client.query(
                `SELECT collection_id FROM card_placements WHERE card_id = $1 ORDER BY collection_id LIMIT 1`,
                [linkedCardId]
              );
              linkedColId = pl.rows[0]?.collection_id ?? colIds[0];
            } else {
              let targetColId = colIds[0];
              const explicitCol =
                typeof step.targetCollectionId === "string"
                  ? step.targetCollectionId.trim()
                  : "";
              if (explicitCol) {
                const { sql: ownColSql, params: ownColParams } = userIdCondition(
                  userId,
                  2
                );
                const colOk = await client.query(
                  `SELECT id FROM collections WHERE id = $1 AND (${ownColSql})`,
                  [explicitCol, ...ownColParams]
                );
                if (colOk.rowCount > 0) targetColId = explicitCol;
              } else {
                const resolved = await findPresetCollectionIdForAutoLink(
                  userId,
                  step.targetPresetTypeId,
                  step.targetObjectKind
                );
                if (resolved) targetColId = resolved;
              }

              const { addedOn, minutesOfDay } = nowDateParts();
              const newId = newCardId();
              const colRowForKind = colMap.get(targetColId);
              const effectiveObjectKind =
                step.targetObjectKind && String(step.targetObjectKind).trim()
                  ? String(step.targetObjectKind).trim()
                  : objectKindFromCollectionRow(colRowForKind);
              const newCardTitle = autoLinkNewCardTitleFromSource(
                step,
                cardRow,
                mergedFieldMap
              );
              /** 人物卡列表标题读 sf-person-name；网页卡可读 sf-web-url */
              let initialCustomProps = [];
              if (newCardTitle && effectiveObjectKind === "person") {
                initialCustomProps = [
                  {
                    id: "sf-person-name",
                    name: "名称",
                    type: "text",
                    value: newCardTitle,
                  },
                ];
              } else if (
                newCardTitle &&
                (effectiveObjectKind === "web" ||
                  effectiveObjectKind === "web_page") &&
                /^https?:\/\//i.test(newCardTitle)
              ) {
                initialCustomProps = [
                  {
                    id: "sf-web-url",
                    name: "链接",
                    type: "url",
                    value: newCardTitle,
                  },
                ];
              }

              await createCard(
                userId,
                targetColId,
                {
                  id: newId,
                  text: newCardTitle,
                  minutesOfDay,
                  addedOn,
                  objectKind: effectiveObjectKind,
                  tags: [],
                  relatedRefs: [],
                  media: [],
                  customProps: initialCustomProps,
                  insertAtStart: false,
                },
                client
              );
              await client.query(
                `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
                [uid, cardId, newId, step.linkType]
              );
              await client.query(
                `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
                [uid, newId, cardId, step.linkType]
              );
              linkedColId = targetColId;
              linkedCardId = newId;
            }

            if (step.syncSchemaFieldId) {
              await mergeCardLinkCustomPropWithClient(
                client,
                userId,
                cardId,
                step.syncSchemaFieldId,
                { colId: linkedColId, cardId: linkedCardId },
                mergedFieldMap
              );
            }

            if (step.targetSyncSchemaFieldId) {
              const targetMerged = new Map();
              const { fields: tf } = resolveSchemaFromChain(colMap, linkedColId);
              for (const f of tf) targetMerged.set(f.id, f);
              const srcColForRef =
                typeof rule.sourceCollectionId === "string" &&
                rule.sourceCollectionId.trim() &&
                colIds.includes(rule.sourceCollectionId.trim())
                  ? rule.sourceCollectionId.trim()
                  : colIds[0];
              await mergeCardLinkCustomPropWithClient(
                client,
                userId,
                linkedCardId,
                step.targetSyncSchemaFieldId,
                { colId: srcColForRef, cardId: cardId },
                targetMerged
              );
            }

            await client.query("COMMIT");
          } catch (e) {
            await safeRollback(client);
            console.error(
              `[auto-link] rule ${step.ruleId}/${step.targetKey} card ${cardId}:`,
              e.message
            );
          } finally {
            client.release();
          }
        } catch (e) {
          console.error(`[auto-link] rule check ${rule.ruleId}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error("[auto-link] outer error:", e.message);
  }
}

/**
 * 计算卡片在所有 category 合集（含父链）上的合并有效 Schema。
 * 用于前端展示 Schema 感知属性面板。
 *
 * @param {string|null} userId
 * @param {string} cardId
 * @returns {Promise<{ fields: Array, autoLinkRules: Array }>}
 */
export async function getEffectiveSchemaForCard(userId, cardId) {
  const empty = { fields: [], autoLinkRules: [] };

  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 2);
  const exists = await query(
    `SELECT user_id FROM cards WHERE id = $1 AND (${cOwnSql}) AND trashed_at IS NULL`,
    [cardId, ...cOwnParams]
  );
  if (exists.rowCount === 0) return empty;
  const cardUid = exists.rows[0].user_id;

  const placementsRes = await query(
    `SELECT collection_id FROM card_placements WHERE card_id = $1`,
    [cardId]
  );
  const colIds = placementsRes.rows.map((r) => r.collection_id);
  if (colIds.length === 0) return empty;

  const { sql: colUidSql, params: colUidParams } = userIdCondition(userId, 1);
  const allColsRes = await query(
    `SELECT id, parent_id, is_category, card_schema FROM collections WHERE ${colUidSql}`,
    colUidParams
  );
  const colMap = new Map(allColsRes.rows.map((r) => [r.id, r]));

  const mergedFields = new Map();
  const mergedRules = new Map();
  for (const colId of colIds) {
    const { fields, rules } = resolveSchemaFromChain(colMap, colId);
    for (const f of fields) mergedFields.set(f.id, f);
    for (const r of rules) mergedRules.set(r.ruleId, r);
  }

  const prefsOwnerKey = cardUid != null ? String(cardUid) : "__single__";
  const notePrefs = await getNotePrefsForOwnerKey(prefsOwnerKey);
  applyNotePrefsToAutoLinkRuleMap(mergedRules, notePrefs);

  return {
    fields: [...mergedFields.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    autoLinkRules: [...mergedRules.values()],
  };
}

/**
 * 批量将现有卡片的 media[] 附件迁移为独立文件卡片，并双向连接。
 * 幂等：通过检查已有 attachment 链接 + 匹配 URL 跳过已处理项。
 *
 * @param {string|null} userId
 * @param {{ fileCollectionId: string, clearOriginalMedia?: boolean }} opts
 * @returns {Promise<{ processed: number, created: number, skipped: number }>}
 */
export async function batchMigrateAttachmentsToFileCards(userId, opts) {
  const { fileCollectionId, clearOriginalMedia = false } = opts ?? {};
  if (!fileCollectionId) throw new Error("缺少 fileCollectionId");

  const { sql: colUidSql, params: colUidParams } = userIdCondition(userId, 2);
  const colCheck = await query(
    `SELECT id FROM collections WHERE id = $1 AND ${colUidSql}`,
    [fileCollectionId, ...colUidParams]
  );
  if (colCheck.rowCount === 0) throw new Error("目标文件合集不存在或无权限");

  const { sql: cUidSql, params: cUidParams } = cardOwnershipCondition(userId, 1);
  const cardsRes = await query(
    `SELECT id, user_id, media FROM cards
     WHERE (${cUidSql})
       AND trashed_at IS NULL
       AND jsonb_array_length(COALESCE(media, '[]'::jsonb)) > 0`,
    cUidParams
  );

  let processed = 0;
  let created = 0;
  let skipped = 0;

  for (const cardRow of cardsRes.rows) {
    const noteCardId = cardRow.id;
    const uid = cardRow.user_id;
    const mediaItems = Array.isArray(cardRow.media) ? cardRow.media : [];

    for (const raw of mediaItems) {
      const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!url) { skipped++; continue; }
      processed++;

      try {
        // 幂等检查
        const existLink = await query(
          `SELECT l.to_card_id
           FROM card_links l
           INNER JOIN cards tc ON tc.id = l.to_card_id AND tc.trashed_at IS NULL
           WHERE l.from_card_id = $1
             AND l.link_type = 'attachment'
             AND (tc.media->0->>'url') = $2
           LIMIT 1`,
          [noteCardId, url]
        );
        if (existLink.rowCount > 0) { skipped++; continue; }

        const kind = ["image", "video", "audio", "file"].includes(raw.kind) ? raw.kind : "file";
        const objectKind =
          kind === "image" ? "file_image"
          : kind === "video" ? "file_video"
          : kind === "audio" ? "file_audio"
          : "file_document";

        const mediaItem = { url, kind };
        if (raw.name) mediaItem.name = raw.name;
        if (raw.coverUrl) mediaItem.coverUrl = raw.coverUrl;
        if (raw.thumbnailUrl) mediaItem.thumbnailUrl = raw.thumbnailUrl;
        if (typeof raw.sizeBytes === "number") mediaItem.sizeBytes = raw.sizeBytes;
        if (typeof raw.durationSec === "number") mediaItem.durationSec = raw.durationSec;

        const { addedOn, minutesOfDay } = nowDateParts();
        const newId = newCardId();
        const titleFromMigrate =
          typeof raw.name === "string" && raw.name.trim()
            ? stripExtFilename(raw.name.trim())
            : deriveFileCardTitleFromMediaItem(mediaItem);
        const customPropsMigrate = titleFromMigrate
          ? [
              {
                id: "sf-file-title",
                name: "标题",
                type: "text",
                value: titleFromMigrate,
              },
            ]
          : [];

        const client = await getClient();
        try {
          await client.query("BEGIN");
          await createCard(
            userId,
            fileCollectionId,
            {
              id: newId,
              text: raw.name ? `## ${raw.name}` : "",
              minutesOfDay,
              addedOn,
              objectKind,
              tags: [],
              relatedRefs: [],
              media: [mediaItem],
              customProps: customPropsMigrate,
              insertAtStart: false,
            },
            client
          );
          await client.query(
            `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
             VALUES ($1, $2, $3, 'attachment')
             ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
            [uid, noteCardId, newId]
          );
          await client.query(
            `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
             VALUES ($1, $2, $3, 'attachment')
             ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
            [uid, newId, noteCardId]
          );

          if (clearOriginalMedia) {
            await client.query(
              `UPDATE cards
               SET media = (
                 SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
                 FROM jsonb_array_elements(COALESCE(media, '[]'::jsonb)) AS elem
                 WHERE trim(elem->>'url') <> $2
               )
               WHERE id = $1`,
              [noteCardId, url]
            );
          }

          await client.query("COMMIT");
          created++;
        } catch (e) {
          await safeRollback(client);
          console.error(`[migrate-attachments] card ${noteCardId} url ${url}:`, e.message);
          skipped++;
        } finally {
          client.release();
        }
      } catch (e) {
        console.error(`[migrate-attachments] outer card ${noteCardId}:`, e.message);
        skipped++;
      }
    }
  }

  return { processed, created, skipped };
}

/** @param {unknown} raw */
function bilibiliAuthorFromCustomProps(raw) {
  const props = Array.isArray(raw) ? raw : [];
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    const id = typeof p.id === "string" ? p.id : "";
    const typ = typeof p.type === "string" ? p.type : "";
    if (id === "sf-bili-author" && typ === "cardLink") {
      const v = p.value;
      const cid =
        v && typeof v === "object" && typeof v.cardId === "string" ? v.cardId.trim() : "";
      if (cid) return null;
    }
    if (typ === "cardLink" && typeof p.name === "string" && p.name.trim() === "UP 主") {
      const v = p.value;
      const cid =
        v && typeof v === "object" && typeof v.cardId === "string" ? v.cardId.trim() : "";
      if (cid) return null;
    }
  }
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    const id = typeof p.id === "string" ? p.id : "";
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const typ = typeof p.type === "string" ? p.type : "";
    if (id === "sf-bili-author" && typ === "text") {
      const v = p.value;
      const s = typeof v === "string" ? v.trim() : "";
      if (s) return s;
    }
    if (name === "作者" && typ === "text") {
      const v = p.value;
      const s = typeof v === "string" ? v.trim() : "";
      if (s) return s;
    }
  }
  return null;
}

/** @param {unknown} raw */
function bilibiliAuthorCardLinkAlreadySet(raw) {
  const props = Array.isArray(raw) ? raw : [];
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    const id = typeof p.id === "string" ? p.id : "";
    const typ = typeof p.type === "string" ? p.type : "";
    if (id !== "sf-bili-author" || typ !== "cardLink") continue;
    const v = p.value;
    if (v && typeof v === "object") {
      const cid = typeof v.cardId === "string" ? v.cardId.trim() : "";
      if (cid) return true;
    }
  }
  return false;
}

/** @param {string} text */
function personHeadlineNormForMatch(text) {
  let t = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = t.match(/^#{1,6}\s+(.+)$/m);
  if (m) t = m[1].trim().replace(/\s+/g, " ");
  return t.trim().toLowerCase();
}

/** @param {unknown[]} props @param {{ colId: string, cardId: string }} ref */
function mergeBilibiliAuthorCustomProps(props, ref) {
  const list = Array.isArray(props) ? [...props] : [];
  const filtered = list.filter((p) => {
    if (!p || typeof p !== "object") return true;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const typ = typeof p.type === "string" ? p.type : "";
    if (name === "作者" && typ === "text") return false;
    return true;
  });
  const fieldId = "sf-bili-author";
  const fieldName = "UP 主";
  const idx = filtered.findIndex((p) => p && p.id === fieldId);
  const nextVal = { colId: ref.colId, cardId: ref.cardId };
  if (idx >= 0) {
    return filtered.map((p, i) =>
      i === idx
        ? { ...p, id: fieldId, name: fieldName, type: "cardLink", value: nextVal }
        : p
    );
  }
  return [...filtered, { id: fieldId, name: fieldName, type: "cardLink", value: nextVal }];
}

/** @param {unknown} raw */
function readSfPersonNameFromPropsJson(raw) {
  const props = Array.isArray(raw) ? raw : [];
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    if (p.id === "sf-person-name" && p.type === "text") {
      const v = p.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

/** @param {unknown[]} props @param {string} name */
function mergePersonNameIntoPropsArray(props, name) {
  const list = Array.isArray(props) ? [...props] : [];
  const idx = list.findIndex((p) => p && p.id === "sf-person-name");
  const v = String(name || "").trim();
  if (idx >= 0) {
    return list.map((p, i) =>
      i === idx
        ? { ...p, id: "sf-person-name", name: p.name || "名称", type: "text", value: v }
        : p
    );
  }
  return [...list, { id: "sf-person-name", name: "名称", type: "text", value: v }];
}

/**
 * 正文仅为单个标题（HTML h* 或行首 # 的 Markdown）时返回名称，否则 null。
 * @param {unknown} raw
 */
function legacyPersonNameFromBodyText(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const hm = t.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (hm) {
    const inner = hm[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!inner) return null;
    const after = t.slice(t.indexOf(hm[0]) + hm[0].length).trim();
    const afterPlain = after.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (afterPlain) return null;
    return inner;
  }
  const plain = t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const m = plain.match(/^#{1,6}\s+(.+)$/);
  if (m) {
    const rest = plain.slice(m[0].length).trim();
    if (rest) return null;
    return m[1].trim();
  }
  return null;
}

/** @param {unknown} text @param {unknown} customProps */
function personCardNameMatchKey(text, customProps) {
  const fromProp = readSfPersonNameFromPropsJson(customProps);
  if (fromProp) return personHeadlineNormForMatch(fromProp);
  return personHeadlineNormForMatch(text);
}

/**
 * 将旧版「正文只有 ## 名」的人物卡迁入 sf-person-name 并清空正文。
 * @param {string|null} userId
 * @param {string} personColId
 * @param {boolean} dryRun
 * @param {{ migratedPersonNameFromBody: number, errors: number }} stats
 */
async function repairLegacyPersonCardsInCollection(userId, personColId, dryRun, stats) {
  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 1);
  const colParamIdx = cOwnParams.length + 1;
  const r = await query(
    `SELECT c.id, c.text, c.custom_props
     FROM cards c
     INNER JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $${colParamIdx}
     WHERE (${cOwnSql.replace(/\buser_id\b/g, "c.user_id")})
       AND c.trashed_at IS NULL
       AND c.object_kind = 'person'`,
    [...cOwnParams, personColId]
  );
  for (const row of r.rows) {
    const prop = readSfPersonNameFromPropsJson(row.custom_props);
    const legacy = legacyPersonNameFromBodyText(row.text);
    /** @type {unknown[] | null} */
    let nextProps = null;
    let nextText = null;
    if (!prop && legacy) {
      nextProps = mergePersonNameIntoPropsArray(
        Array.isArray(row.custom_props) ? row.custom_props : [],
        legacy
      );
      nextText = "";
    } else if (prop && legacy && personHeadlineNormForMatch(legacy) === personHeadlineNormForMatch(prop)) {
      nextProps = mergePersonNameIntoPropsArray(
        Array.isArray(row.custom_props) ? row.custom_props : [],
        prop
      );
      nextText = "";
    } else {
      continue;
    }
    if (dryRun) {
      stats.migratedPersonNameFromBody++;
      continue;
    }
    const client = await getClient();
    try {
      await client.query(
        `UPDATE cards SET custom_props = $2::jsonb, text = $3
         WHERE id = $1 AND trashed_at IS NULL`,
        [row.id, JSON.stringify(nextProps), nextText ?? ""]
      );
      stats.migratedPersonNameFromBody++;
    } catch (e) {
      console.error(`[backfill-bilibili-person] repair person ${row.id}:`, e.message);
      stats.errors++;
    } finally {
      client.release();
    }
  }
}

const PERSON_PRESET_BACKFILL = "person";
const PERSON_DOT_BACKFILL = "rgba(249, 115, 22, 0.14)";

/**
 * @param {string|null} userId
 */
async function ensurePersonCollectionForBackfill(userId) {
  const ex =
    userId === null || userId === undefined
      ? await query(
          `SELECT id FROM collections WHERE user_id IS NULL AND preset_type_id = $1`,
          [PERSON_PRESET_BACKFILL]
        )
      : await query(
          `SELECT id FROM collections WHERE user_id = $1 AND preset_type_id = $2`,
          [userId, PERSON_PRESET_BACKFILL]
        );
  if (ex.rowCount > 0) return ex.rows[0].id;

  const id = `preset-${PERSON_PRESET_BACKFILL}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await createCollection(userId, {
    id,
    name: "人物",
    dotColor: PERSON_DOT_BACKFILL,
    parentId: null,
  });
  await updateCollection(userId, id, {
    isCategory: true,
    presetTypeId: PERSON_PRESET_BACKFILL,
    cardSchema: {},
  });
  return id;
}

/**
 * 扫描带 bilibili 标签的笔记：从 custom_props 读取扩展写入的「作者」或 sf-bili-author（text），
 * 在人物预设合集建/复用人物卡，写入 creator 双边边与 sf-bili-author（cardLink）。
 *
 * @param {{ userId?: string|null, dryRun?: boolean }} opts
 *   userId 省略=全部用户；userId: null 仅匿名 user_id IS NULL。
 * @returns {Promise<object>}
 */
export async function backfillBilibiliCreatorsAsPersonCards(opts = {}) {
  const dryRun = opts.dryRun === true;
  const filterUserId = opts.userId;
  const params = [];
  let pIdx = 1;
  let userClause = "";
  if (filterUserId !== undefined) {
    if (filterUserId === null) {
      userClause = "AND c.user_id IS NULL";
    } else {
      userClause = `AND c.user_id = $${pIdx++}`;
      params.push(filterUserId);
    }
  }

  const listRes = await query(
    `SELECT c.id, c.user_id, c.custom_props
     FROM cards c
     WHERE c.trashed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM unnest(c.tags) AS t(tag)
         WHERE lower(tag) = 'bilibili'
       )
       ${userClause}`,
    params
  );

  const stats = {
    notesSeen: listRes.rowCount,
    skippedNoAuthor: 0,
    skippedAlreadyCardLink: 0,
    skippedNoPersonCollection: 0,
    ensuredPersonCollections: 0,
    createdPersonCards: 0,
    reusedPersonCards: 0,
    linkedNotes: 0,
    filledPersonNameProp: 0,
    migratedPersonNameFromBody: 0,
    errors: 0,
  };

  /** @type {Map<string, { userId: string|null, rows: object[] }>} */
  const byUser = new Map();
  for (const row of listRes.rows) {
    const key = row.user_id == null ? "__null__" : String(row.user_id);
    if (!byUser.has(key)) {
      byUser.set(key, { userId: row.user_id ?? null, rows: [] });
    }
    byUser.get(key).rows.push(row);
  }

  for (const { userId: uid, rows } of byUser.values()) {
    let personColId = await findPresetCollectionIdForAutoLink(uid, "person", "person");
    const hadPersonCol = Boolean(personColId);
    if (!personColId && !dryRun) {
      personColId = await ensurePersonCollectionForBackfill(uid);
      if (!hadPersonCol) stats.ensuredPersonCollections++;
    }
    if (!personColId) {
      for (const row of rows) {
        const author = bilibiliAuthorFromCustomProps(row.custom_props);
        if (!author) stats.skippedNoAuthor++;
        else if (bilibiliAuthorCardLinkAlreadySet(row.custom_props))
          stats.skippedAlreadyCardLink++;
        else stats.skippedNoPersonCollection++;
      }
      console.error(
        `[backfill-bilibili-person] user_id=${uid ?? "null"}: 无人物预设合集；` +
          (dryRun ? "请先启用「人物」或去掉 --dry-run 以自动创建。" : "未能创建合集。")
      );
      continue;
    }

    const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(uid, 1);
    const colParamIdx = cOwnParams.length + 1;
    const pmapRes = await query(
      `SELECT c.id, c.text, c.custom_props
       FROM cards c
       INNER JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $${colParamIdx}
       WHERE (${cOwnSql.replace(/\buser_id\b/g, "c.user_id")})
         AND c.trashed_at IS NULL
         AND (c.object_kind = 'person' OR c.object_kind IS NULL)`,
      [...cOwnParams, personColId]
    );
    /** @type {Map<string, string>} */
    const nameToPersonId = new Map();
    for (const pr of pmapRes.rows) {
      const k = personCardNameMatchKey(pr.text, pr.custom_props);
      if (k && !nameToPersonId.has(k)) nameToPersonId.set(k, pr.id);
    }

    for (const row of rows) {
      const noteId = row.id;
      try {
        if (bilibiliAuthorCardLinkAlreadySet(row.custom_props)) {
          stats.skippedAlreadyCardLink++;
          continue;
        }
        const author = bilibiliAuthorFromCustomProps(row.custom_props);
        if (!author) {
          stats.skippedNoAuthor++;
          continue;
        }
        const authorKey = personHeadlineNormForMatch(author);
        if (!authorKey) {
          stats.skippedNoAuthor++;
          continue;
        }

        const exCr = await query(
          `SELECT l.to_card_id
           FROM card_links l
           INNER JOIN cards tc ON tc.id = l.to_card_id AND tc.trashed_at IS NULL
           WHERE l.from_card_id = $1
             AND l.link_type = 'creator'
             AND tc.object_kind = 'person'
           LIMIT 1`,
          [noteId]
        );

        let personCardId =
          exCr.rowCount > 0 ? exCr.rows[0].to_card_id : nameToPersonId.get(authorKey) ?? null;
        let createdNew = false;

        if (!personCardId) {
          createdNew = true;
          personCardId = dryRun ? `__dry_${noteId}__` : newCardId();
          if (dryRun) {
            nameToPersonId.set(authorKey, personCardId);
            stats.createdPersonCards++;
            stats.linkedNotes++;
            continue;
          }
        }

        const reusedByName = !createdNew && exCr.rowCount === 0;

        if (dryRun) {
          stats.linkedNotes++;
          if (reusedByName) stats.reusedPersonCards++;
          continue;
        }

        const client = await getClient();
        try {
          await client.query("BEGIN");
          if (createdNew) {
            const { addedOn, minutesOfDay } = nowDateParts();
            await createCard(
              uid,
              personColId,
              {
                id: personCardId,
                text: "",
                minutesOfDay,
                addedOn,
                objectKind: "person",
                tags: [],
                relatedRefs: [],
                media: [],
                customProps: mergePersonNameIntoPropsArray([], author),
                insertAtStart: false,
              },
              client
            );
            nameToPersonId.set(authorKey, personCardId);
          } else {
            const prow = await client.query(
              `SELECT text, custom_props FROM cards WHERE id = $1 AND trashed_at IS NULL`,
              [personCardId]
            );
            if (prow.rowCount > 0) {
              let pProps = Array.isArray(prow.rows[0].custom_props)
                ? prow.rows[0].custom_props
                : [];
              let t = String(prow.rows[0].text ?? "");
              let changed = false;
              if (!readSfPersonNameFromPropsJson(pProps)) {
                pProps = mergePersonNameIntoPropsArray(pProps, author);
                changed = true;
              }
              const leg = legacyPersonNameFromBodyText(t);
              if (
                leg &&
                personHeadlineNormForMatch(leg) === personHeadlineNormForMatch(author)
              ) {
                t = "";
                changed = true;
              }
              if (changed) {
                await client.query(
                  `UPDATE cards SET custom_props = $2::jsonb, text = $3 WHERE id = $1`,
                  [personCardId, JSON.stringify(pProps), t]
                );
                stats.filledPersonNameProp++;
              }
            }
          }

          await client.query(
            `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
             VALUES ($1, $2, $3, 'creator')
             ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
            [uid, noteId, personCardId]
          );
          await client.query(
            `INSERT INTO card_links (user_id, from_card_id, to_card_id, link_type)
             VALUES ($1, $2, $3, 'creator')
             ON CONFLICT (from_card_id, to_card_id, link_type) DO NOTHING`,
            [uid, personCardId, noteId]
          );

          const props = Array.isArray(row.custom_props) ? row.custom_props : [];
          const nextProps = mergeBilibiliAuthorCustomProps(props, {
            colId: personColId,
            cardId: personCardId,
          });
          await client.query(`UPDATE cards SET custom_props = $2::jsonb WHERE id = $1`, [
            noteId,
            JSON.stringify(nextProps),
          ]);

          await client.query("COMMIT");
          stats.linkedNotes++;
          if (createdNew) stats.createdPersonCards++;
          else if (reusedByName) stats.reusedPersonCards++;
        } catch (e) {
          await safeRollback(client);
          console.error(`[backfill-bilibili-person] note ${noteId}:`, e.message);
          stats.errors++;
        } finally {
          client.release();
        }
      } catch (e) {
        console.error(`[backfill-bilibili-person] outer ${noteId}:`, e.message);
        stats.errors++;
      }
    }

    await repairLegacyPersonCardsInCollection(uid, personColId, dryRun, stats);
  }

  return stats;
}

/** @param {unknown} tags */
function clipPresetTypeForTags(tags) {
  if (!Array.isArray(tags)) return null;
  const hasBili = tags.some((t) => String(t).toLowerCase() === "bilibili");
  const hasXhs = tags.some((t) => t === "小红书");
  if (hasBili) return "post_bilibili";
  if (hasXhs) return "post_xhs";
  return null;
}

/** @param {unknown} tags */
function stripClipSourceTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t) => t !== "小红书" && String(t).toLowerCase() !== "bilibili");
}

/** @param {unknown} raw */
function readLegacyClipUrlFromProps(raw) {
  const props = Array.isArray(raw) ? raw : [];
  for (const p of props) {
    if (!p || typeof p !== "object" || p.type !== "url") continue;
    const id = typeof p.id === "string" ? p.id : "";
    if (id === "sf-xhs-url" || id === "sf-bili-url" || id === "sf-clip-url") {
      const v = p.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  for (const p of props) {
    if (!p || typeof p !== "object" || p.type !== "url") continue;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (name === "链接") {
      const v = p.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** @param {unknown} raw */
function readLegacyClipAuthorTextFromProps(raw) {
  const fromBili = bilibiliAuthorFromCustomProps(raw);
  if (fromBili) return fromBili;
  const props = Array.isArray(raw) ? raw : [];
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    if (p.id === "sf-xhs-author" && p.type === "text") {
      const v = p.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    if (typeof p.name === "string" && p.name.trim() === "作者" && p.type === "text") {
      const v = p.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** @param {unknown} raw */
function readLegacyClipTitleFromProps(raw) {
  const props = Array.isArray(raw) ? raw : [];
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    if (p.id === "sf-clip-title" && p.type === "text") {
      const v = p.value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** 扩展/旧正文首段 <p><strong>标题</strong></p> */
function titleFromClipNoteHtml(html) {
  const raw = String(html ?? "");
  const m = raw.match(/<p>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/i);
  if (!m) return "";
  return String(m[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function clipHtmlStripLeadingTitleParagraph(html) {
  return String(html ?? "")
    .replace(/^\s*<p>\s*<strong>[\s\S]*?<\/strong>\s*<\/p>\s*/i, "")
    .trim();
}

/**
 * 为已存在子类字段的剪藏卡补父级「链接」「标题」，不删其它自定义字段。
 * @param {unknown[]} rawProps
 * @param {string} url
 * @param {string} clipTitle
 */
function patchClipParentFieldsIntoProps(rawProps, url, clipTitle) {
  const list = Array.isArray(rawProps) ? [...rawProps] : [];
  const u = typeof url === "string" ? url.trim() : "";
  const t = typeof clipTitle === "string" ? clipTitle.trim() : "";
  const idxX = list.findIndex((p) => p && p.id === "sf-xhs-url");
  const idxB = list.findIndex((p) => p && p.id === "sf-bili-url");
  const anchor = idxX >= 0 ? idxX : idxB >= 0 ? idxB : list.length;

  if (u && !list.some((p) => p && p.id === "sf-clip-url")) {
    list.splice(anchor, 0, {
      id: "sf-clip-url",
      name: "链接",
      type: "url",
      value: u,
    });
  }
  if (t && !list.some((p) => p && p.id === "sf-clip-title")) {
    const clipUrlIdx = list.findIndex((p) => p && p.id === "sf-clip-url");
    const ins = clipUrlIdx >= 0 ? clipUrlIdx + 1 : anchor;
    list.splice(ins, 0, {
      id: "sf-clip-title",
      name: "标题",
      type: "text",
      value: t,
    });
  }
  return list;
}

/**
 * @param {string} presetTypeId
 * @param {string} url
 * @param {string} authorText
 * @param {string} clipTitle
 */
function buildPresetClipCustomPropsArray(presetTypeId, url, authorText, clipTitle) {
  const u = typeof url === "string" ? url.trim() : "";
  const a = typeof authorText === "string" ? authorText.trim() : "";
  const tit = typeof clipTitle === "string" ? clipTitle.trim() : "";
  const clipBase = [
    { id: "sf-clip-url", name: "链接", type: "url", value: u || null },
    { id: "sf-clip-title", name: "标题", type: "text", value: tit || null },
  ];
  if (presetTypeId === "post_xhs") {
    return [
      ...clipBase,
      { id: "sf-xhs-url", name: "原始链接", type: "url", value: u || null },
      { id: "sf-xhs-author", name: "作者", type: "text", value: a || null },
    ];
  }
  if (presetTypeId === "post_bilibili") {
    return [
      ...clipBase,
      { id: "sf-bili-url", name: "视频链接", type: "url", value: u || null },
      { id: "sf-bili-author", name: "UP 主", type: "text", value: a || null },
    ];
  }
  return [];
}

/**
 * @param {unknown} raw
 * @param {string} presetTypeId
 * @param {object[]} baseProps
 */
function mergeAuthorCardLinkFromLegacy(raw, presetTypeId, baseProps) {
  const idAuthor =
    presetTypeId === "post_bilibili" ? "sf-bili-author" : "sf-xhs-author";
  const props = Array.isArray(raw) ? raw : [];
  const existing = props.find(
    (p) =>
      p &&
      typeof p === "object" &&
      p.id === idAuthor &&
      p.type === "cardLink" &&
      p.value &&
      typeof p.value === "object" &&
      typeof p.value.cardId === "string" &&
      p.value.cardId.trim()
  );
  if (!existing) return baseProps;
  return baseProps.map((p) =>
    p.id === idAuthor ? { ...existing, name: p.name } : p
  );
}

/**
 * 将带扩展写入的「小红书」「bilibili」标签的笔记迁入剪藏预设子类（post_xhs / post_bilibili），
 * 去掉来源标签，写入 schema 字段 id，并从「未归类」移除归属（若存在）。
 *
 * @param {string|null} userId
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function migrateClipTaggedNotesToPresetCards(userId, opts = {}) {
  const dryRun = opts.dryRun === true;
  /** @type {{ scanned: number, migrated: number, skippedNoPreset: number, skippedNoKind: number, errors: number, backfillTitles: number }} */
  const stats = {
    scanned: 0,
    migrated: 0,
    skippedNoPreset: 0,
    skippedNoKind: 0,
    errors: 0,
    backfillTitles: 0,
  };

  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 1);
  const listRes = await query(
    `SELECT c.id, c.tags, c.custom_props, c.text
     FROM cards c
     WHERE c.trashed_at IS NULL
       AND (c.object_kind IS NULL OR c.object_kind = 'note')
       AND (
         EXISTS (SELECT 1 FROM unnest(c.tags) AS t(tag) WHERE tag = '小红书')
         OR EXISTS (SELECT 1 FROM unnest(c.tags) AS t(tag) WHERE lower(tag) = 'bilibili')
       )
       AND (${cOwnSql.replace(/\buser_id\b/g, "c.user_id")})`,
    [...cOwnParams]
  );

  for (const row of listRes.rows) {
    stats.scanned++;
    const tags = row.tags ?? [];
    const presetType = clipPresetTypeForTags(tags);
    if (!presetType) {
      stats.skippedNoKind++;
      continue;
    }
    const tgtCol = await getPresetCollectionId(userId, presetType);
    if (!tgtCol) {
      stats.skippedNoPreset++;
      continue;
    }

    if (dryRun) {
      stats.migrated++;
      continue;
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");
      const url = readLegacyClipUrlFromProps(row.custom_props);
      const author = readLegacyClipAuthorTextFromProps(row.custom_props);
      const fromHtmlTitle = titleFromClipNoteHtml(row.text);
      const clipTitle =
        readLegacyClipTitleFromProps(row.custom_props) || fromHtmlTitle;
      let nextProps = buildPresetClipCustomPropsArray(
        presetType,
        url,
        author,
        clipTitle
      );
      nextProps = mergeAuthorCardLinkFromLegacy(row.custom_props, presetType, nextProps);
      const nextTags = stripClipSourceTags(tags);
      let nextText = row.text;
      if (fromHtmlTitle) {
        const stripped = clipHtmlStripLeadingTitleParagraph(row.text);
        nextText = stripped || "<p>（无正文）</p>";
      }

      await client.query(
        `UPDATE cards
         SET object_kind = $2, tags = $3, custom_props = $4::jsonb, text = $5
         WHERE id = $1 AND trashed_at IS NULL`,
        [row.id, presetType, nextTags, JSON.stringify(nextProps), nextText]
      );

      const orderRes = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
        [tgtCol]
      );
      const sortOrder = orderRes.rows[0].next;
      await client.query(
        `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
         VALUES ($1, $2, false, $3)
         ON CONFLICT (card_id, collection_id) DO NOTHING`,
        [row.id, tgtCol, sortOrder]
      );

      await client.query(
        `DELETE FROM card_placements WHERE card_id = $1 AND collection_id = $2`,
        [row.id, LOOSE_NOTES_COLLECTION_ID]
      );

      await client.query("COMMIT");
      stats.migrated++;
      runAutoLinkRulesForCard(userId, row.id).catch((e) =>
        console.error("[migrate-clip-tagged] auto-link:", e.message)
      );
    } catch (e) {
      await safeRollback(client);
      console.error(`[migrate-clip-tagged] card ${row.id}:`, e.message);
      stats.errors++;
    } finally {
      client.release();
    }
  }

  if (!dryRun) {
    const bf = await backfillClipPresetTitlesFromHtml(userId);
    stats.backfillTitles = bf.updated;
  }

  return stats;
}

/**
 * 已为剪藏子类、但缺少父级「标题」的旧数据：从正文首段 strong 补 sf-clip-title（及缺省时 sf-clip-url）。
 * @param {string|null} userId
 * @returns {Promise<{ updated: number }>}
 */
export async function backfillClipPresetTitlesFromHtml(userId) {
  let updated = 0;
  const { sql: cOwnSql, params: cOwnParams } = cardOwnershipCondition(userId, 1);
  const listRes = await query(
    `SELECT c.id, c.text, c.custom_props, c.object_kind
     FROM cards c
     WHERE c.trashed_at IS NULL
       AND c.object_kind IN ('post_xhs', 'post_bilibili')
       AND (${cOwnSql.replace(/\buser_id\b/g, "c.user_id")})`,
    [...cOwnParams]
  );

  for (const row of listRes.rows) {
    const props = Array.isArray(row.custom_props) ? row.custom_props : [];
    const hasTitle = props.some(
      (p) =>
        p &&
        p.id === "sf-clip-title" &&
        typeof p.value === "string" &&
        p.value.trim()
    );
    if (hasTitle) continue;
    const fromHtml = titleFromClipNoteHtml(row.text);
    if (!fromHtml) continue;
    const url = readLegacyClipUrlFromProps(props);
    const nextProps = patchClipParentFieldsIntoProps(props, url, fromHtml);
    const nextText =
      clipHtmlStripLeadingTitleParagraph(row.text) || "<p>（无正文）</p>";
    try {
      await query(
        `UPDATE cards SET custom_props = $2::jsonb, text = $3
         WHERE id = $1 AND trashed_at IS NULL`,
        [row.id, JSON.stringify(nextProps), nextText]
      );
      updated++;
    } catch (e) {
      console.error(`[backfill-clip-title] card ${row.id}:`, e.message);
    }
  }
  return { updated };
}

/**
 * 将仍留在 cards.related_refs JSON 中的引用写入 card_links（双向 related），并清空 JSON 列。
 * 供旧库或未跑全量迁移的实例一次性执行。
 *
 * @param {string|null} userId
 * @returns {Promise<{ withJson: number, migrated: number }>}
 */
export async function migrateRelatedRefsJsonToCardLinks(userId) {
  const { sql: cUidSql, params: cUidParams } = cardOwnershipCondition(userId, 1);
  const res = await query(
    `SELECT id, related_refs FROM cards
     WHERE (${cUidSql}) AND trashed_at IS NULL
       AND jsonb_array_length(COALESCE(related_refs, '[]'::jsonb)) > 0`,
    cUidParams
  );
  let migrated = 0;
  for (const row of res.rows) {
    const raw = row.related_refs;
    const refs = [];
    if (Array.isArray(raw)) {
      for (const r of raw) {
        const cardId = r && typeof r.cardId === "string" ? r.cardId.trim() : "";
        if (!cardId) continue;
        const colId =
          r && typeof r.colId === "string" && r.colId.trim() ? r.colId.trim() : undefined;
        refs.push(colId ? { colId, cardId } : { cardId });
      }
    }
    if (refs.length === 0) continue;
    const client = await getClient();
    try {
      await syncCardRelatedLinksWithClient(client, userId, row.id, refs);
      migrated++;
    } catch (e) {
      console.error(`[migrate-related-refs-json] card ${row.id}:`, e.message);
    } finally {
      client.release();
    }
  }
  return { withJson: res.rowCount, migrated };
}
