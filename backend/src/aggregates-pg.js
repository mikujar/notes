/**
 * aggregates-pg.js — 服务端聚合端点的 SQL 层
 *
 * 对应 /api/overview/summary, /api/search, /api/calendar/*, /api/notes,
 * /api/reminders, /api/tags 等"全局聚合"接口。前端原本在内存里遍历整棵
 * 合集树算这些数，现在都下沉到 DB，前端只拉聚合结果。
 *
 * 这些查询特意返回"轻量"行（id + 必要字段），不走 assembleCards 装配
 * 子数据；前端点进某张卡要详情时，再调 GET /api/cards/:id。
 */

import { query } from "./db.js";

/* 从 storage-pg 私有 resolveUserId 复制的简化版：
 * API 层 userId 只会是 string 或 null；null 时取第一个活跃用户作为兜底（单用户部署）。 */
let cachedFallbackUserId = null;
async function resolveUserId(userId) {
  if (userId && typeof userId === "string") return userId;
  if (cachedFallbackUserId) return cachedFallbackUserId;
  const r = await query(
    `SELECT id FROM users WHERE deletion_state = 'active'
      ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1`
  );
  if (r.rowCount === 0) throw new Error("no active user in DB");
  cachedFallbackUserId = r.rows[0].id;
  return cachedFallbackUserId;
}

/** 合集 placement 中为某卡挑选"主展示合集"的子查询（置顶优先，其次排序，再其次创建序）。 */
const PRIMARY_PLACEMENT_SQL = `
  (SELECT p.collection_id FROM card_placements p
    WHERE p.card_id = c.id
    ORDER BY p.pinned DESC, p.sort_order ASC, p.collection_id ASC
    LIMIT 1)
`;

/** 从 body 提取前 N 字的纯文本片段（粗糙去除 HTML 标签；用在 snippet 展示）。 */
function extractSnippet(body, n = 180) {
  if (!body) return "";
  const s = String(body)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

/** 提取 title 时用的更短长度。 */
function extractTitle(body, n = 40) {
  return extractSnippet(body, n);
}

// ─────────────────────────────────────────────────────────────────────────────
// 标签
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/tags — 全局标签列表 + count。
 * 返回 [{tag, count}]，按 count DESC + 标签字面排序。
 */
export async function getTagsWithCounts(userIdIn) {
  const userId = await resolveUserId(userIdIn);
  const r = await query(
    `SELECT tag, COUNT(*)::int AS n
       FROM (
         SELECT UNNEST(tags) AS tag
           FROM cards
          WHERE user_id = $1 AND trashed_at IS NULL
            AND tags IS NOT NULL
       ) t
      WHERE tag IS NOT NULL AND TRIM(tag) <> ''
      GROUP BY tag
      ORDER BY n DESC, tag ASC`,
    [userId]
  );
  return r.rows.map((row) => ({ tag: row.tag, count: row.n }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 概览
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/overview/summary — 首页所需全部聚合数据。
 * todayYmd / weekStartYmd 由调用方传入（YYYY-MM-DD，客户端时区）。
 *
 * 返回 shape：
 *   {
 *     todayYmd, weekStartYmd,
 *     weekNewCount,
 *     byPresetSlug: { [slug]: { total, weekNew, recent: [{id, collectionId, title, addedOn, minutesOfDay}] } },
 *     taskReminders: { today, overdue, pending },
 *     randomCard: { id, collectionId, collectionName, snippet, addedOn } | null,
 *     recentImages: [{cardId, collectionId, url, thumbUrl, name}],   // 最多 12 条
 *     recentAudio:  [{cardId, collectionId, url, coverUrl, thumbUrl, name, displayName}]  // 最多 6 条
 *   }
 */
export async function getOverviewSummary(userIdIn, { todayYmd, weekStartYmd }) {
  const userId = await resolveUserId(userIdIn);

  const [
    countsRes,
    weekTotalRes,
    taskRemRes,
    recentPerSlugRes,
    randomRes,
    imagesRes,
    audioRes,
  ] = await Promise.all([
    /* 1. 每种 preset_slug 的总数 + 本周新增 */
    query(
      `SELECT ct.preset_slug AS slug,
              COUNT(*)::int AS total,
              SUM(CASE WHEN c.added_on >= $2 THEN 1 ELSE 0 END)::int AS week_new
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
        GROUP BY ct.preset_slug`,
      [userId, weekStartYmd]
    ),

    /* 2. 总的本周新增 */
    query(
      `SELECT COUNT(*)::int AS n
         FROM cards
        WHERE user_id = $1 AND trashed_at IS NULL AND added_on >= $2`,
      [userId, weekStartYmd]
    ),

    /* 3. task 相关：今天 / 逾期 / 全部 pending */
    query(
      `SELECT
         SUM(CASE WHEN r.due_at::date = $2::date AND r.completed_at IS NULL THEN 1 ELSE 0 END)::int AS today,
         SUM(CASE WHEN r.due_at::date < $2::date AND r.completed_at IS NULL THEN 1 ELSE 0 END)::int AS overdue,
         SUM(CASE WHEN r.completed_at IS NULL THEN 1 ELSE 0 END)::int AS pending
       FROM card_reminders r
       JOIN cards c ON c.id = r.card_id
      WHERE c.user_id = $1 AND c.trashed_at IS NULL`,
      [userId, todayYmd]
    ),

    /* 4. 每种 preset_slug 的最近 2 张卡 */
    query(
      `WITH ranked AS (
         SELECT c.id, c.body, c.added_on, c.minutes_of_day, ct.preset_slug,
                ${PRIMARY_PLACEMENT_SQL} AS collection_id,
                ROW_NUMBER() OVER (
                  PARTITION BY ct.preset_slug
                  ORDER BY c.added_on DESC NULLS LAST,
                           c.minutes_of_day DESC NULLS LAST,
                           c.id DESC
                ) AS rn
           FROM cards c
           JOIN card_types ct ON ct.id = c.card_type_id
          WHERE c.user_id = $1 AND c.trashed_at IS NULL
       )
       SELECT * FROM ranked WHERE rn <= 2`,
      [userId]
    ),

    /* 5. 随机笔记一张（排除文件类型，body 非空） */
    query(
      `SELECT c.id, c.body, c.added_on, ct.preset_slug,
              ${PRIMARY_PLACEMENT_SQL} AS collection_id,
              (SELECT col.name FROM collections col WHERE col.id = ${PRIMARY_PLACEMENT_SQL}) AS collection_name
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND (ct.preset_slug IS NULL OR ct.preset_slug NOT LIKE 'file%')
          AND LENGTH(TRIM(COALESCE(c.body, ''))) > 0
        ORDER BY RANDOM()
        LIMIT 1`,
      [userId]
    ),

    /* 6. 最近 12 张图片（file_image 卡 + 来源卡） */
    query(
      `SELECT c.id AS card_id, f.url AS url, f.thumb_url, f.original_name,
              ${PRIMARY_PLACEMENT_SQL} AS collection_id
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id AND ct.preset_slug = 'file_image'
         JOIN card_files f ON f.card_id = c.id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND f.url <> ''
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 12`,
      [userId]
    ),

    /* 7. 最近 6 段带封面的音频（file_audio 卡 + cover_url） */
    query(
      `SELECT c.id AS card_id, c.body, f.url AS url,
              f.cover_url, f.cover_thumb_url, f.thumb_url, f.original_name,
              ${PRIMARY_PLACEMENT_SQL} AS collection_id
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id AND ct.preset_slug = 'file_audio'
         JOIN card_files f ON f.card_id = c.id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND f.url <> ''
          AND (f.cover_url IS NOT NULL OR f.cover_thumb_url IS NOT NULL)
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 6`,
      [userId]
    ),
  ]);

  /* 组装 byPresetSlug */
  const byPresetSlug = {};
  for (const row of countsRes.rows) {
    const slug = row.slug || "note";
    byPresetSlug[slug] = {
      total: row.total,
      weekNew: row.week_new ?? 0,
      recent: [],
    };
  }
  for (const row of recentPerSlugRes.rows) {
    const slug = row.preset_slug || "note";
    const entry = byPresetSlug[slug];
    if (!entry) continue;
    entry.recent.push({
      id: row.id,
      collectionId: row.collection_id,
      title: extractTitle(row.body),
      addedOn: row.added_on,
      minutesOfDay: row.minutes_of_day,
    });
  }

  /* random card */
  const rr = randomRes.rows[0];
  const randomCard = rr
    ? {
        id: rr.id,
        collectionId: rr.collection_id,
        collectionName: rr.collection_name,
        snippet: extractSnippet(rr.body),
        addedOn: rr.added_on,
      }
    : null;

  return {
    todayYmd,
    weekStartYmd,
    weekNewCount: weekTotalRes.rows[0]?.n ?? 0,
    byPresetSlug,
    taskReminders: {
      today: taskRemRes.rows[0]?.today ?? 0,
      overdue: taskRemRes.rows[0]?.overdue ?? 0,
      pending: taskRemRes.rows[0]?.pending ?? 0,
    },
    randomCard,
    recentImages: imagesRes.rows.map((r) => ({
      cardId: r.card_id,
      collectionId: r.collection_id,
      url: r.url,
      thumbUrl: r.thumb_url,
      name: r.original_name,
    })),
    recentAudio: audioRes.rows.map((r) => ({
      cardId: r.card_id,
      collectionId: r.collection_id,
      url: r.url,
      coverUrl: r.cover_url,
      coverThumbUrl: r.cover_thumb_url,
      thumbUrl: r.thumb_url,
      name: r.original_name,
      displayName: r.original_name || extractTitle(r.body, 60) || "（未命名）",
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 搜索
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/search?q=... — 全局搜索。
 * 当前实现：ILIKE 子串匹配（case-insensitive）+ 标签精确匹配。
 * 后续可升级为 pg_trgm 或 tsvector+zhparser，接口不变。
 *
 * 返回：
 *   { cards: [{id, title, snippet, collectionId, addedOn}], collections: [{id, name, parentId}] }
 */
export async function searchUserContent(userIdIn, q, { limit = 50 } = {}) {
  const userId = await resolveUserId(userIdIn);
  const normalized = String(q || "").trim();
  if (!normalized) return { cards: [], collections: [] };
  const ilike = `%${normalized.replace(/[%_]/g, "\\$&")}%`;

  const [cardsRes, colsRes] = await Promise.all([
    query(
      /* 利用 schema 中的 cards_content_trgm_gin 索引（title || ' ' || body 上的 GIN trgm）。
         单独的 c.title ILIKE / c.body ILIKE 不会命中那个表达式索引，合并成一个 ILIKE 才能走。 */
      `SELECT c.id, c.title, c.body, c.added_on, ct.preset_slug,
              ${PRIMARY_PLACEMENT_SQL} AS collection_id,
              (CASE
                 WHEN c.title ILIKE $2 THEN 0
                 WHEN (c.title || ' ' || c.body) ILIKE $2 THEN 1
                 WHEN EXISTS (SELECT 1 FROM UNNEST(c.tags) AS t WHERE t ILIKE $2) THEN 2
                 ELSE 3
               END) AS rank_order
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND (ct.preset_slug IS NULL OR ct.preset_slug NOT LIKE 'file%')
          AND (
            (c.title || ' ' || c.body) ILIKE $2
            OR EXISTS (SELECT 1 FROM UNNEST(c.tags) AS t WHERE t ILIKE $2)
          )
        ORDER BY rank_order, c.updated_at DESC, c.id DESC
        LIMIT $3`,
      [userId, ilike, limit]
    ),
    query(
      `SELECT id, name, parent_id
         FROM collections
        WHERE user_id = $1
          AND (name ILIKE $2 OR description ILIKE $2)
        ORDER BY sort_order ASC
        LIMIT 20`,
      [userId, ilike]
    ),
  ]);

  return {
    cards: cardsRes.rows.map((r) => ({
      id: r.id,
      title: r.title || extractTitle(r.body),
      snippet: extractSnippet(r.body),
      collectionId: r.collection_id,
      addedOn: r.added_on,
      presetSlug: r.preset_slug,
    })),
    collections: colsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 日历
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/calendar/days?month=YYYY-MM — 某月每天的笔记/提醒 count map。
 * 返回 { days: [{ymd, noteCount, reminderCount}] }
 */
export async function getCalendarMonthSummary(userIdIn, monthYm) {
  const userId = await resolveUserId(userIdIn);
  const [y, m] = String(monthYm).split("-");
  if (!y || !m) throw new Error("invalid month format, expect YYYY-MM");
  const start = `${y}-${m}-01`;

  const r = await query(
    `WITH notes AS (
       SELECT added_on::text AS ymd, COUNT(*)::int AS n
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND c.added_on IS NOT NULL
          AND c.added_on >= $2::date
          AND c.added_on < ($2::date + INTERVAL '1 month')
          AND (ct.preset_slug IS NULL OR ct.preset_slug NOT LIKE 'file%')
        GROUP BY c.added_on
     ),
     rems AS (
       SELECT r.due_at::date::text AS ymd, COUNT(*)::int AS n
         FROM card_reminders r
         JOIN cards c ON c.id = r.card_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND r.due_at IS NOT NULL
          AND r.due_at >= $2::date
          AND r.due_at < ($2::date + INTERVAL '1 month')
        GROUP BY r.due_at::date
     )
     SELECT COALESCE(notes.ymd, rems.ymd) AS ymd,
            COALESCE(notes.n, 0) AS note_count,
            COALESCE(rems.n, 0) AS reminder_count
       FROM notes FULL OUTER JOIN rems ON notes.ymd = rems.ymd
       ORDER BY ymd`,
    [userId, start]
  );

  return {
    days: r.rows.map((row) => ({
      ymd: row.ymd,
      noteCount: row.note_count,
      reminderCount: row.reminder_count,
    })),
  };
}

/** GET /api/calendar/:ymd/cards — 某一天添加的卡 + 有提醒的卡。 */
export async function getCardsAndRemindersOnDate(userIdIn, ymd) {
  const userId = await resolveUserId(userIdIn);

  const [addedRes, reminderRes] = await Promise.all([
    query(
      `SELECT c.id, c.title, c.body, c.added_on, c.minutes_of_day, c.tags,
              ct.preset_slug,
              ${PRIMARY_PLACEMENT_SQL} AS collection_id
         FROM cards c
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND c.added_on = $2::date
          AND (ct.preset_slug IS NULL OR ct.preset_slug NOT LIKE 'file%')
        ORDER BY c.minutes_of_day ASC NULLS LAST, c.id ASC`,
      [userId, ymd]
    ),
    query(
      `SELECT c.id, c.title, c.body, c.added_on, c.minutes_of_day, c.tags,
              ct.preset_slug,
              ${PRIMARY_PLACEMENT_SQL} AS collection_id,
              r.due_at, r.completed_at, r.note AS reminder_note,
              r.completed_note AS reminder_completed_note
         FROM card_reminders r
         JOIN cards c ON c.id = r.card_id
         JOIN card_types ct ON ct.id = c.card_type_id
        WHERE c.user_id = $1 AND c.trashed_at IS NULL
          AND r.due_at::date = $2::date
        ORDER BY r.due_at ASC, c.id ASC`,
      [userId, ymd]
    ),
  ]);

  const lightCard = (r) => ({
    id: r.id,
    title: r.title || extractTitle(r.body),
    snippet: extractSnippet(r.body),
    addedOn: r.added_on,
    minutesOfDay: r.minutes_of_day,
    tags: r.tags ?? [],
    collectionId: r.collection_id,
    presetSlug: r.preset_slug,
  });

  return {
    ymd,
    addedCards: addedRes.rows.map(lightCard),
    reminderCards: reminderRes.rows.map((r) => ({
      ...lightCard(r),
      reminderOn: r.due_at ? new Date(r.due_at).toISOString().slice(0, 10) : null,
      reminderTime: r.due_at ? new Date(r.due_at).toISOString().slice(11, 16) : null,
      reminderCompletedAt: r.completed_at
        ? new Date(r.completed_at).toISOString()
        : null,
      reminderNote: r.reminder_note ?? undefined,
      reminderCompletedNote: r.reminder_completed_note ?? undefined,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 全部笔记时间线
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/notes?page=1&limit=50 — 分页全部笔记（排除 file_* 类型）。
 * 按 added_on DESC + minutes_of_day DESC 排。
 */
export async function getAllNotesTimeline(userIdIn, { page = 1, limit = 50 } = {}) {
  const userId = await resolveUserId(userIdIn);
  const p = Math.max(1, Number(page) || 1);
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (p - 1) * lim;

  const r = await query(
    `SELECT c.id, c.title, c.body, c.added_on, c.minutes_of_day, c.tags,
            ct.preset_slug,
            ${PRIMARY_PLACEMENT_SQL} AS collection_id
       FROM cards c
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.user_id = $1 AND c.trashed_at IS NULL
        AND (ct.preset_slug IS NULL OR ct.preset_slug NOT LIKE 'file%')
      ORDER BY c.added_on DESC NULLS LAST,
               c.minutes_of_day DESC NULLS LAST,
               c.id DESC
      LIMIT $2 OFFSET $3`,
    [userId, lim + 1, offset]
  );

  const hasMore = r.rows.length > lim;
  const rows = hasMore ? r.rows.slice(0, lim) : r.rows;
  return {
    cards: rows.map((row) => ({
      id: row.id,
      title: row.title || extractTitle(row.body),
      snippet: extractSnippet(row.body),
      addedOn: row.added_on,
      minutesOfDay: row.minutes_of_day,
      tags: row.tags ?? [],
      collectionId: row.collection_id,
      presetSlug: row.preset_slug,
    })),
    hasMore,
    page: p,
    limit: lim,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 提醒列表
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/reminders?filter=pending|all|completed&page=1&limit=50
 * 返回按 due_at 正序（pending 在前，completed 在后）的卡片条目。
 */
export async function getAllReminders(
  userIdIn,
  { filter = "pending", page = 1, limit = 50 } = {}
) {
  const userId = await resolveUserId(userIdIn);
  const p = Math.max(1, Number(page) || 1);
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const offset = (p - 1) * lim;

  let where = "";
  if (filter === "pending") where = "AND r.completed_at IS NULL";
  else if (filter === "completed") where = "AND r.completed_at IS NOT NULL";

  const r = await query(
    `SELECT c.id, c.title, c.body, c.added_on, c.minutes_of_day, c.tags,
            ct.preset_slug,
            ${PRIMARY_PLACEMENT_SQL} AS collection_id,
            r.due_at, r.completed_at, r.note AS reminder_note,
            r.completed_note AS reminder_completed_note
       FROM card_reminders r
       JOIN cards c ON c.id = r.card_id
       JOIN card_types ct ON ct.id = c.card_type_id
      WHERE c.user_id = $1 AND c.trashed_at IS NULL
      ${where}
      ORDER BY
        CASE WHEN r.completed_at IS NULL THEN 0 ELSE 1 END,
        r.due_at ASC,
        c.id ASC
      LIMIT $2 OFFSET $3`,
    [userId, lim + 1, offset]
  );

  const hasMore = r.rows.length > lim;
  const rows = hasMore ? r.rows.slice(0, lim) : r.rows;
  return {
    entries: rows.map((row) => ({
      id: row.id,
      title: row.title || extractTitle(row.body),
      snippet: extractSnippet(row.body),
      addedOn: row.added_on,
      minutesOfDay: row.minutes_of_day,
      tags: row.tags ?? [],
      collectionId: row.collection_id,
      presetSlug: row.preset_slug,
      reminderOn: row.due_at ? new Date(row.due_at).toISOString().slice(0, 10) : null,
      reminderTime: row.due_at ? new Date(row.due_at).toISOString().slice(11, 16) : null,
      reminderCompletedAt: row.completed_at
        ? new Date(row.completed_at).toISOString()
        : null,
      reminderNote: row.reminder_note ?? undefined,
      reminderCompletedNote: row.reminder_completed_note ?? undefined,
    })),
    hasMore,
    page: p,
    limit: lim,
  };
}
