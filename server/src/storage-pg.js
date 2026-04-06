/**
 * storage-pg.js
 * PostgreSQL 数据访问层：合集 + 卡片 CRUD。
 * COS 工具函数（presign、putCosPublicObject 等）继续留在 storage.js，不在此文件。
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
    ...(row.reminder_on
      ? { reminderOn: row.reminder_on }
      : {}),
    pinned: row.pinned,
    tags: row.tags ?? [],
    relatedRefs: row.related_refs ?? [],
    media: row.media ?? [],
  };
}

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
 * 把嵌套 Collection[] 平铺成 { collections: Row[], cards: Row[] }，并分配 sort_order。
 * @param {string|null} userId
 * @param {Array} tree
 */
function flattenTree(userId, tree) {
  const collections = [];
  const cards = [];

  function walk(nodes, parentId, depth) {
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
      // 卡片（旧 JSON 有时叫 blocks，统一读两个字段）
      const cardList = col.cards ?? col.blocks ?? [];
      cardList.forEach((card, ci) => {
        cards.push({
          id: card.id,
          collection_id: col.id,
          text: card.text ?? "",
          minutes_of_day: card.minutesOfDay ?? 0,
          added_on: card.addedOn ?? null,
          reminder_on: card.reminderOn ?? null,
          pinned: card.pinned ?? false,
          tags: card.tags ?? [],
          related_refs: card.relatedRefs ?? [],
          media: card.media ?? [],
          sort_order: ci,
        });
      });
      if (Array.isArray(col.children) && col.children.length > 0) {
        walk(col.children, col.id, depth + 1);
      }
    });
  }

  walk(tree, null, 0);
  return { collections, cards };
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

  // 按 sort_order 取全部合集
  const colRes = await query(
    `SELECT id, user_id, parent_id, name, dot_color, sort_order, hint
     FROM collections
     WHERE ${uidSql}
     ORDER BY sort_order`,
    uidParams
  );

  if (colRes.rows.length === 0) return [];

  const colIds = colRes.rows.map((r) => r.id);

  // 一次取出所有相关卡片
  const cardRes = await query(
    `SELECT id, collection_id, text, minutes_of_day, added_on, reminder_on,
            pinned, tags, related_refs, media, sort_order
     FROM cards
     WHERE collection_id = ANY($1)
     ORDER BY sort_order`,
    [colIds]
  );

  return buildTree(colRes.rows, cardRes.rows);
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
  const { collections, cards } = flattenTree(userId, collectionsArray);
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 1);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    // SET CONSTRAINTS DEFERRED 允许 parent_id FK 在事务结束时才校验
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    // 删除旧数据（ON DELETE CASCADE 自动删卡片）
    await client.query(`DELETE FROM collections WHERE ${uidSql}`, uidParams);

    // 批量插入合集
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

    // 批量插入卡片
    if (cards.length > 0) {
      const vals = cards
        .map(
          (_, i) =>
            `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, ` +
            `$${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, ` +
            `$${i * 11 + 11})`
        )
        .join(",");
      const flat = cards.flatMap((c) => [
        c.id,
        c.collection_id,
        c.text,
        c.minutes_of_day,
        c.added_on,
        c.reminder_on ?? null,
        c.pinned,
        c.tags,
        JSON.stringify(c.related_refs),
        JSON.stringify(c.media),
        c.sort_order,
      ]);
      await client.query(
        `INSERT INTO cards
           (id, collection_id, text, minutes_of_day, added_on, reminder_on,
            pinned, tags, related_refs, media, sort_order)
         VALUES ${vals}`,
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
 * 删除合集（ON DELETE CASCADE 自动删子合集和所有卡片）。
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
 * 在指定合集末尾创建卡片。
 * 在插入前先验证 collectionId 属于该用户。
 * @param {string|null} userId
 * @param {string} collectionId
 * @param {object} card
 */
export async function createCard(userId, collectionId, card) {
  // 验证合集属于该用户
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const colCheck = await query(
    `SELECT id FROM collections WHERE id = $1 AND ${uidSql}`,
    [collectionId, ...uidParams]
  );
  if (colCheck.rowCount === 0) throw new Error("合集不存在或无权限");

  // sort_order = 当前最大值 + 1
  const orderRes = await query(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM cards WHERE collection_id = $1",
    [collectionId]
  );
  const sortOrder = orderRes.rows[0].next;

  const {
    id,
    text = "",
    minutesOfDay = 0,
    addedOn = null,
    reminderOn = null,
    pinned = false,
    tags = [],
    relatedRefs = [],
    media = [],
  } = card;

  if (!id) throw new Error("card.id 为必填项");

  await query(
    `INSERT INTO cards
       (id, collection_id, text, minutes_of_day, added_on, reminder_on, pinned, tags, related_refs, media, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      collectionId,
      text,
      minutesOfDay,
      addedOn,
      reminderOn,
      pinned,
      tags,
      JSON.stringify(relatedRefs),
      JSON.stringify(media),
      sortOrder,
    ]
  );

  return {
    id,
    text,
    minutesOfDay,
    addedOn,
    ...(reminderOn ? { reminderOn } : {}),
    pinned,
    tags,
    relatedRefs,
    media,
  };
}

/**
 * 更新卡片的任意字段子集。
 * 验证卡片所属合集的 user_id 与传入 userId 一致。
 * @param {string|null} userId
 * @param {string} cardId
 * @param {object} patch — { text?, tags?, media?, pinned?, relatedRefs?, minutesOfDay?, addedOn?, reminderOn?, collectionId?, sortOrder? }
 */
export async function updateCard(userId, cardId, patch) {
  const fields = [];
  const params = [];
  let i = 1;

  if (typeof patch.text === "string") {
    fields.push(`text = $${i++}`);
    params.push(patch.text);
  }
  if (Array.isArray(patch.tags)) {
    fields.push(`tags = $${i++}`);
    params.push(patch.tags);
  }
  if (Array.isArray(patch.media)) {
    fields.push(`media = $${i++}`);
    params.push(JSON.stringify(patch.media));
  }
  if (typeof patch.pinned === "boolean") {
    fields.push(`pinned = $${i++}`);
    params.push(patch.pinned);
  }
  if (Array.isArray(patch.relatedRefs)) {
    fields.push(`related_refs = $${i++}`);
    params.push(JSON.stringify(patch.relatedRefs));
  }
  if (typeof patch.minutesOfDay === "number") {
    fields.push(`minutes_of_day = $${i++}`);
    params.push(patch.minutesOfDay);
  }
  if ("addedOn" in patch) {
    fields.push(`added_on = $${i++}`);
    params.push(patch.addedOn ?? null);
  }
  if ("reminderOn" in patch) {
    fields.push(`reminder_on = $${i++}`);
    params.push(patch.reminderOn ?? null);
  }

  let newColId = null;
  if (typeof patch.collectionId === "string" && patch.collectionId.trim()) {
    newColId = patch.collectionId.trim();
    fields.push(`collection_id = $${i++}`);
    params.push(newColId);
  }
  if (typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)) {
    fields.push(`sort_order = $${i++}`);
    params.push(patch.sortOrder);
  }

  if (fields.length === 0) throw new Error("未提供任何可更新字段");

  if (newColId) {
    if (userId === null || userId === undefined) {
      const chk = await query(
        `SELECT 1 FROM collections nc WHERE nc.id = $1 AND nc.user_id IS NULL`,
        [newColId]
      );
      if (chk.rowCount === 0) throw new Error("目标合集不存在或无权限");
    } else {
      const chk = await query(
        `SELECT 1 FROM collections nc WHERE nc.id = $1 AND nc.user_id = $2`,
        [newColId, userId]
      );
      if (chk.rowCount === 0) throw new Error("目标合集不存在或无权限");
    }
  }

  // 通过 JOIN 同时验证归属（迁移合集前须仍位于当前用户名下某合集内）
  params.push(cardId); // $i
  const cardIdParam = i++;

  const { sql: uidSql, params: uidParams } = userIdCondition(userId, i);

  const res = await query(
    `UPDATE cards
     SET ${fields.join(", ")}
     WHERE id = $${cardIdParam}
       AND collection_id IN (
         SELECT id FROM collections WHERE ${uidSql}
       )
     RETURNING id`,
    [...params, ...uidParams]
  );
  if (res.rowCount === 0) throw new Error("卡片不存在或无权限");
}

/**
 * 删除卡片。同样验证归属。
 * @param {string|null} userId
 * @param {string} cardId
 */
export async function deleteCard(userId, cardId) {
  const { sql: uidSql, params: uidParams } = userIdCondition(userId, 2);
  const res = await query(
    `DELETE FROM cards
     WHERE id = $1
       AND collection_id IN (
         SELECT id FROM collections WHERE ${uidSql}
       )`,
    [cardId, ...uidParams]
  );
  if (res.rowCount === 0) throw new Error("卡片不存在或无权限");
}

// ─────────────────────────────────────────────────────────────────────────────
// 侧栏：星标合集 + 垃圾桶（owner_key：多用户为 JWT sub，单用户模式 __single__）
// ─────────────────────────────────────────────────────────────────────────────

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
 * @param {string} ownerKey
 * @returns {Promise<string[]>}
 */
export async function listFavoriteCollectionIds(ownerKey) {
  const res = await query(
    `SELECT collection_id FROM user_favorite_collections
     WHERE owner_key = $1 ORDER BY created_at ASC`,
    [ownerKey]
  );
  return res.rows.map((r) => r.collection_id);
}

/**
 * 整表替换星标 id 列表；仅插入仍属于该用户的合集 id。
 * @param {string} ownerKey
 * @param {string[]} collectionIds
 * @param {string|null|undefined} userId
 */
export async function replaceFavoriteCollectionIds(ownerKey, collectionIds, userId) {
  const ids = Array.isArray(collectionIds) ? collectionIds : [];
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM user_favorite_collections WHERE owner_key = $1`, [ownerKey]);
    for (const cid of ids) {
      if (typeof cid !== "string" || !cid.trim()) continue;
      const id = cid.trim();
      const ok = await collectionOwnedByUser(client, id, userId);
      if (!ok) continue;
      await client.query(
        `INSERT INTO user_favorite_collections (owner_key, collection_id) VALUES ($1, $2)
         ON CONFLICT (owner_key, collection_id) DO NOTHING`,
        [ownerKey, id]
      );
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
  const res = await query(
    `SELECT trash_id, col_id, col_path_label, card, deleted_at FROM trashed_notes
     WHERE owner_key = $1 ORDER BY deleted_at DESC`,
    [ownerKey]
  );
  return res.rows.map((r) => ({
    trashId: r.trash_id,
    colId: r.col_id,
    colPathLabel: r.col_path_label ?? "",
    card: r.card,
    deletedAt:
      r.deleted_at instanceof Date
        ? r.deleted_at.toISOString()
        : String(r.deleted_at),
  }));
}

/**
 * @param {string} ownerKey
 * @param {{ trashId: string, colId: string, colPathLabel?: string, card: object, deletedAt?: string }} row
 */
export async function insertTrashedNote(ownerKey, row) {
  const {
    trashId,
    colId,
    colPathLabel = "",
    card,
    deletedAt,
  } = row;
  if (!trashId || !colId || !card || typeof card !== "object") {
    throw new Error("回收站条目缺少 trashId、colId 或 card");
  }
  await query(
    `INSERT INTO trashed_notes (trash_id, owner_key, col_id, col_path_label, card, deleted_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
    [
      trashId,
      ownerKey,
      colId,
      String(colPathLabel ?? ""),
      JSON.stringify(card),
      deletedAt || new Date().toISOString(),
    ]
  );
}

/**
 * @param {string} ownerKey
 * @param {string} trashId
 */
export async function deleteTrashedNote(ownerKey, trashId) {
  const res = await query(
    `DELETE FROM trashed_notes WHERE owner_key = $1 AND trash_id = $2`,
    [ownerKey, trashId]
  );
  if (res.rowCount === 0) throw new Error("回收站记录不存在或无权限");
}

/**
 * @param {string} ownerKey
 */
export async function clearTrashedNotes(ownerKey) {
  await query(`DELETE FROM trashed_notes WHERE owner_key = $1`, [ownerKey]);
}
