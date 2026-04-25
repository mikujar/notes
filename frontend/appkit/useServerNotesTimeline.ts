/**
 * useServerNotesTimeline — flag on 时拉 /api/notes:
 *   - 初始 mount: 拉全部页(cap 2000),首次填充 timeline
 *   - 后续 refreshKey 变化(本地创建/删除卡触发的 epoch bump):
 *     只拉第 1 页(新卡总在首页),merge 进现有 rows,避免每次写都 10 页全量重拉
 * flag off 或失败返回 null(调用方走本地遍历)。
 *
 * 注意:服务端口径 = `kind='note'` 的所有卡(与 isNoteForAllNotesView 严格一致)。
 */

import { useEffect, useRef, useState } from "react";
import { isLazyCollectionsEnabled } from "../lazyFeatureFlag";
import { fetchNotesPage, type LightCardRow } from "../api/aggregates";

const MAX_PAGES = 10;
const PAGE_LIMIT = 200;

export function useServerNotesTimeline(
  refreshKey: number | string = 0
): LightCardRow[] | null {
  const [rows, setRows] = useState<LightCardRow[] | null>(null);
  /** 已成功拉过初始全量?用来区分"第一次"vs"后续 refresh"。
      用 ref 而非 state 避免触发额外渲染。 */
  const initialFetchedRef = useRef(false);

  useEffect(() => {
    if (!isLazyCollectionsEnabled()) {
      setRows(null);
      initialFetchedRef.current = false;
      return;
    }
    let cancelled = false;

    (async () => {
      // 后续 refresh: 只拉第 1 页 + 按"日期范围"merge,大幅降低创建/删除的延迟
      // 同时正确处理:
      //  - 新建: 新卡在 fresh 顶部,自动 prepend
      //  - 删除: prev 中处于 page-1 日期范围内但不在 fresh 的 id → 被丢弃
      //  - 旧卡: addedOn 早于 fresh 最旧的保持不动(超出 page-1 范围)
      if (initialFetchedRef.current) {
        const res = await fetchNotesPage({ page: 1, limit: PAGE_LIMIT });
        if (cancelled || !res) return;
        setRows((prev) => {
          if (!prev || prev.length === 0) return res.cards;
          if (res.cards.length === 0) return prev;
          const oldestInFresh =
            res.cards[res.cards.length - 1]?.addedOn ?? "";
          const olderPrev = prev.filter(
            (c) => (c.addedOn ?? "") < oldestInFresh
          );
          return [...res.cards, ...olderPrev];
        });
        return;
      }

      // 初始全量
      const all: LightCardRow[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetchNotesPage({ page, limit: PAGE_LIMIT });
        if (cancelled) return;
        if (!res) return; // 失败 → 保持 null 让调用方 fallback
        all.push(...res.cards);
        if (!res.hasMore) break;
      }
      if (cancelled) return;
      setRows(all);
      initialFetchedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return rows;
}
