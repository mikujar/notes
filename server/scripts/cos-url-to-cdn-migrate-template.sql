-- 将库内「COS 默认访问域名」批量替换为「CDN 加速域名」（对象路径不变）。
-- 使用前：备份数据库；把下面 cdn_base、old_cos_roots 改成你的真实值；
--         在 psql 里：BEGIN → 执行 → 抽查 → COMMIT 或 ROLLBACK。
--
-- 与 COS_PUBLIC_BASE / VITE_COS_PUBLIC_BASE 应一致（一般 https，无末尾 /）。

BEGIN;

DO $$
DECLARE
  /** 你的 CDN 根，示例：attachment.hejiac.com 对应 https://attachment.hejiac.com */
  cdn_base CONSTANT text := 'https://attachment.hejiac.com';

  /**
   * 需要被替换掉的 COS 访问根（完整 origin，无路径）。
   * 至少填地域域名；若曾用全球加速，把 accelerate 那一行也放进数组。
   * 示例（请改成你的桶名、地域）：
   *   'https://mikujar-1310791405.cos.ap-guangzhou.myqcloud.com',
   *   'https://mikujar-1310791405.cos.accelerate.myqcloud.com',
   */
  /** 改成你线上实际出现过的 COS 根 URL；没有全球加速可只保留一行。 */
  old_cos_roots text[] := ARRAY[
    'https://mikujar-1310791405.cos.ap-singapore.myqcloud.com'::text
  ];

  old_root text;
BEGIN
  FOREACH old_root IN ARRAY old_cos_roots
  LOOP
    CONTINUE WHEN old_root IS NULL OR btrim(old_root) = '';

    UPDATE users
    SET
      avatar_url = replace(avatar_url, old_root, cdn_base),
      avatar_thumb_url = replace(avatar_thumb_url, old_root, cdn_base)
    WHERE avatar_url LIKE '%' || old_root || '%'
       OR avatar_thumb_url LIKE '%' || old_root || '%';

    UPDATE cards
    SET media = replace(media::text, old_root, cdn_base)::jsonb
    WHERE media::text LIKE '%' || old_root || '%';

    UPDATE trashed_notes
    SET card = replace(card::text, old_root, cdn_base)::jsonb
    WHERE card::text LIKE '%' || old_root || '%';
  END LOOP;
END $$;

-- 若正文 HTML 里直接贴过完整 COS 链，可取消注释并先确认影响行数：
-- UPDATE cards
-- SET text = replace(text, 'https://YOUR_BUCKET.cos.ap-REGION.myqcloud.com', 'https://attachment.hejiac.com')
-- WHERE text LIKE '%YOUR_BUCKET.cos.%myqcloud.com%';

-- 抽查（把域名换成你的 CDN）：
-- SELECT id, left(avatar_url, 120) FROM users WHERE avatar_url LIKE '%myqcloud.com%' LIMIT 5;
-- SELECT id, left(media::text, 400) FROM cards WHERE media::text LIKE '%myqcloud.com%' LIMIT 5;

-- 确认无误后 COMMIT，否则 ROLLBACK
