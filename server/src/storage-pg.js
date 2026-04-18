/**
 * storage-pg.js
 * PostgreSQL 数据访问层：合集 + 卡片 CRUD。
 * COS 工具函数（presign、putCosObject 等）继续留在 storage.js，不在此文件。
 */

import { query, getClient } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把数据库行（snake_case）转换为前端期望的卡片格式（camelCase）。
 */
function rowToCard(row) {
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
    relatedRefs: row.related_refs ?? [],
    media: row.media ?? [],
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
    const hint = hintFromRow(row.hint);
    map.set(row.id, {
      id: row.id,
      name: row.name,
      dotColor: row.dot_color,
      ...(hint ? { hint } : {}),
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
    `SELECT id, user_id, parent_id, name, dot_color, sort_order, hint
     FROM collections
     WHERE ${uidSql}
     ORDER BY sort_order`,
    uidParams
  );

  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 1);
  const orphanRes = await query(
    `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
            c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
            c.tags, c.related_refs, c.media, c.custom_props
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
            c.tags, c.related_refs, c.media, c.custom_props,
            p.collection_id, p.pinned, p.sort_order
     FROM card_placements p
     INNER JOIN cards c ON c.id = p.card_id AND c.trashed_at IS NULL
     WHERE p.collection_id = ANY($1)
     ORDER BY p.collection_id, p.sort_order`,
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
 * 更新合集元数据（name / dotColor / parentId / sortOrder）。
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

  if (fields.length === 0) throw new Error("未提供任何可更新字段");

  const { sql: uidSql, params: uidParams } = userIdCondition(userId, i + 1);
  params.push(collectionId);

  const res = await query(
    `UPDATE collections SET ${fields.join(", ")}
     WHERE id = $${i} AND ${uidSql}
     RETURNING id, name, dot_color, parent_id, sort_order, hint`,
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
 * 在指定合集内创建卡片（默认末尾；card.insertAtStart 为 true 时插在 sort_order 最前）。
 * 在插入前先验证 collectionId 属于该用户。
 * @param {string|null} userId
 * @param {string} collectionId
 * @param {object} card
 */
export async function createCard(userId, collectionId, card) {
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const colCheck = await query(
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
    insertAtStart = false,
  } = card;

  if (!id) throw new Error("card.id 为必填项");

  let sortOrder;
  if (insertAtStart) {
    const minRes = await query(
      `SELECT MIN(sort_order) AS m FROM card_placements WHERE collection_id = $1`,
      [collectionId]
    );
    const m = minRes.rows[0]?.m;
    sortOrder = m === null || m === undefined ? 0 : m - 1;
  } else {
    const orderRes = await query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM card_placements WHERE collection_id = $1`,
      [collectionId]
    );
    sortOrder = orderRes.rows[0].next;
  }

  const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, 2);
  const existing = await query(
    `SELECT id, user_id, trashed_at FROM cards WHERE id = $1 AND ${cUidSql}`,
    [id, ...cUidParams]
  );

  if (existing.rowCount > 0) {
    if (existing.rows[0].trashed_at != null) {
      throw new Error("该笔记在回收站中，请先恢复");
    }
    await query(
      `INSERT INTO card_placements (card_id, collection_id, pinned, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (card_id, collection_id) DO UPDATE SET
         pinned = EXCLUDED.pinned,
         sort_order = EXCLUDED.sort_order`,
      [id, collectionId, pinned, sortOrder]
    );
    const row = await query(
      `SELECT c.id, c.text, c.minutes_of_day, c.added_on, c.reminder_on,
              c.reminder_time, c.reminder_note, c.reminder_completed_at, c.reminder_completed_note,
              c.tags, c.related_refs, c.media, c.custom_props, p.pinned
       FROM cards c
       JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
       WHERE c.id = $1`,
      [id, collectionId]
    );
    const r = row.rows[0];
    return rowToCard(r);
  }

  await query(
    `INSERT INTO cards
       (id, user_id, text, minutes_of_day, added_on, reminder_on,
        reminder_time, reminder_note, reminder_completed_at, reminder_completed_note, tags, related_refs, media, custom_props)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
    ]
  );

  await query(
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
    ...(Array.isArray(customProps) && customProps.length > 0
      ? { customProps }
      : {}),
  };
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
  if (Array.isArray(patch.relatedRefs)) {
    cardCols.push(`related_refs = $${i++}`);
    cardParams.push(JSON.stringify(patch.relatedRefs));
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

  if (cardCols.length === 0 && !hasPlacementPatch) {
    throw new Error("未提供任何可更新字段");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    if (cardCols.length > 0) {
      const { sql: cUidSql, params: cUidParams } = userIdCondition(userId, i + 1);
      const res = await client.query(
        `UPDATE cards SET ${cardCols.join(", ")}
         WHERE id = $${i} AND (${cUidSql}) AND trashed_at IS NULL`,
        [...cardParams, cardId, ...cUidParams]
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
      const { sql: pUidSql, params: pUidParams } = userIdCondition(
        userId,
        k + 2
      );
      const pUidQualified = pUidSql.replace(/\buser_id\b/g, "c.user_id");
      const res = await client.query(
        `UPDATE card_placements p
         SET ${pCols.join(", ")}
         FROM cards c
         WHERE p.card_id = c.id
           AND p.card_id = $${k}
           AND p.collection_id = $${k + 1}
           AND (${pUidQualified})`,
        [...pParams, cardId, placementCollectionId, ...pUidParams]
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
 * 删除整张笔记（所有合集中的出现一并删除）。
 * @param {string|null} userId
 * @param {string} cardId
 */
export async function deleteCard(userId, cardId) {
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const res = await query(
    `DELETE FROM cards
     WHERE id = $1 AND (${uidSql})`,
    [cardId, ...uidParams]
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
            c.tags, c.related_refs, c.media, c.custom_props,
            c.trashed_at, c.trash_col_id, c.trash_col_path_label
     FROM cards c
     WHERE (${uidSql}) AND c.trashed_at IS NOT NULL
     ORDER BY c.trashed_at DESC`,
    uidParams
  );
  return res.rows.map((r) => ({
    trashId: r.id,
    colId: r.trash_col_id ?? "",
    colPathLabel: r.trash_col_path_label ?? "",
    card: rowToCard({ ...r, pinned: false }),
    deletedAt:
      r.trashed_at instanceof Date
        ? r.trashed_at.toISOString()
        : String(r.trashed_at),
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
            c.tags, c.related_refs, c.media, c.custom_props, p.pinned
     FROM cards c
     JOIN card_placements p ON p.card_id = c.id AND p.collection_id = $2
     WHERE c.id = $1`,
    [cardId, targetCollectionId]
  );
  const r = row.rows[0];
  return r ? rowToCard(r) : { id: cardId };
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
     INNER JOIN cards c ON c.id = a.card_id AND c.trashed_at IS NULL AND (${cUidQ})
     WHERE ${filt}`,
    cUidParams
  );
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * 分页附件列表（用于「所有附件」页，避免拉全树）。
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
            a.duration_sec
     FROM card_attachments a
     INNER JOIN cards c ON c.id = a.card_id AND c.trashed_at IS NULL AND (${cUidQ})
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
    const item = {
      url: r.url,
      kind: r.kind,
      ...(r.name ? { name: r.name } : {}),
      ...(r.thumbnail_url ? { thumbnailUrl: r.thumbnail_url } : {}),
      ...(r.cover_url ? { coverUrl: r.cover_url } : {}),
      ...(r.size_bytes != null
        ? { sizeBytes: Number(r.size_bytes) }
        : {}),
      ...(r.duration_sec != null &&
      Number.isFinite(Number(r.duration_sec)) &&
      Number(r.duration_sec) >= 0
        ? { durationSec: Math.round(Number(r.duration_sec)) }
        : {}),
    };
    return {
      colId: r.col_id,
      cardId: r.card_id,
      mediaIndex: r.sort_order,
      item,
    };
  });
  return { items, total };
}
