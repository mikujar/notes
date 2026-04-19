/**
 * 与 backfill-video-thumbnails 共用的「仍有附件缺元数据」判定（cards.media JSON）。
 * 注意：PG 里 `NOT (NULL::text ~ 'regex')` 为 NULL，故对 ->> 使用 COALESCE(...,'')。
 * SVG 图片：脚本不生成列表缩略图，勿把「缺 thumbnailUrl」算作待补，否则会永久占满待处理数。
 *
 * @param {string} tableAlias
 * @param {string} mediaColumn
 */
export function mediaNeedsWorkExists(tableAlias, mediaColumn) {
  return `EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(${tableAlias}.${mediaColumn}, '[]'::jsonb)) elem
  WHERE COALESCE(NULLIF(trim(elem->>'url'), ''), '') <> ''
  AND (
    (
      (elem->>'kind' IN ('image', 'video'))
      AND (elem->>'thumbnailUrl' IS NULL OR btrim(elem->>'thumbnailUrl') = '')
      AND NOT (
        (elem->>'kind') = 'image'
        AND (
          lower(COALESCE(elem->>'url', '')) ~* '\\.svg(\\?|#|$)'
          OR lower(COALESCE(elem->>'name', '')) ~* '\\.svg$'
        )
      )
    )
    OR (
      (elem->>'kind' = 'video')
      AND NOT (
        jsonb_typeof(elem->'durationSec') = 'number'
        AND (elem->>'durationSec')::double precision >= 0
      )
      AND NOT (
        COALESCE(elem->>'durationSec', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      )
    )
    OR (
      (elem->>'kind' IN ('image', 'video', 'audio', 'file'))
      AND NOT (
        (
          jsonb_typeof(elem->'sizeBytes') = 'number'
          AND (elem->>'sizeBytes')::numeric >= 0
          AND (elem->>'sizeBytes')::numeric = floor((elem->>'sizeBytes')::numeric)
        )
        OR (COALESCE(elem->>'sizeBytes', '') ~ '^[0-9]+$')
      )
    )
  )
)`;
}
