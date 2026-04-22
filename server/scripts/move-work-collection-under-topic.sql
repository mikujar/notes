-- move-work-collection-under-topic.sql
--
-- 把每个用户的「作品」合集（bound_type → preset_slug='work'）挪到
-- 「主题」合集（preset_slug='topic'）底下，作为其最后一个子合集。
-- 与前端 catalog 把 work_* 移到 topic 组下保持一致。
--
-- 幂等：如果作品已经挂在主题下（或用户缺其一），该用户不会变。
--
-- 运行：psql "$DATABASE_URL" -f move-work-collection-under-topic.sql

BEGIN;

WITH user_anchors AS (
  SELECT
    ct.user_id,
    MAX(CASE WHEN ct.preset_slug = 'work'  THEN col.id END) AS work_col_id,
    MAX(CASE WHEN ct.preset_slug = 'topic' THEN col.id END) AS topic_col_id
  FROM collections col
  JOIN card_types ct ON ct.id = col.bound_type_id
  WHERE ct.preset_slug IN ('work', 'topic')
    AND ct.parent_type_id IS NULL  -- 仅顶层预设节点
  GROUP BY ct.user_id
),
targets AS (
  SELECT
    ua.user_id,
    ua.work_col_id,
    ua.topic_col_id,
    COALESCE(
      (
        SELECT MAX(child.sort_order)
        FROM collections child
        WHERE child.parent_id = ua.topic_col_id
      ),
      -1
    ) + 1 AS new_sort_order
  FROM user_anchors ua
  WHERE ua.work_col_id  IS NOT NULL
    AND ua.topic_col_id IS NOT NULL
)
UPDATE collections c
SET parent_id  = t.topic_col_id,
    sort_order = t.new_sort_order,
    updated_at = now()
FROM targets t
WHERE c.id = t.work_col_id
  AND (c.parent_id IS DISTINCT FROM t.topic_col_id);

-- 检查：打印每个用户的作品 / 主题合集和当前父节点，方便人工复核
SELECT
  ct.user_id,
  col.id           AS work_col_id,
  col.parent_id    AS work_parent_id,
  col.sort_order   AS work_sort_order,
  topic_col.id     AS topic_col_id
FROM collections col
JOIN card_types ct       ON ct.id = col.bound_type_id
LEFT JOIN collections topic_col
  ON topic_col.user_id = ct.user_id
 AND topic_col.bound_type_id IN (
       SELECT id FROM card_types
       WHERE user_id = ct.user_id AND preset_slug = 'topic' AND parent_type_id IS NULL
     )
WHERE ct.preset_slug = 'work'
  AND ct.parent_type_id IS NULL
ORDER BY ct.user_id;

COMMIT;
