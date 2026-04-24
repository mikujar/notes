/**
 * useServerSubtreeSummaries — flag on 时拉多个合集子树的聚合（total / weekNew / recent）
 *
 * 用于 overview typeWidgets 的最终兜底：byPresetSlug 按卡类型分组，拿不到
 * 和合集子树语义一致的数据，这里按合集子树来。
 */

import { useEffect, useMemo, useState } from "react";
import { isLazyCollectionsEnabled } from "../lazyFeatureFlag";
import {
  fetchSubtreeSummaries,
  type SubtreeSummary,
} from "../api/aggregates";

export function useServerSubtreeSummaries(args: {
  colIds: string[];
  weekStartYmd: string;
  refreshKey?: number | string;
}): Record<string, SubtreeSummary> | null {
  const { colIds, weekStartYmd, refreshKey = 0 } = args;
  const [data, setData] = useState<Record<string, SubtreeSummary> | null>(null);

  /* 把 colIds stable serialize，避免 fn 签名里数组 reference 每次变动都触发拉取 */
  const key = useMemo(() => colIds.slice().sort().join(","), [colIds]);

  useEffect(() => {
    if (!isLazyCollectionsEnabled()) {
      setData(null);
      return;
    }
    if (!key || !weekStartYmd) return;
    const ids = key.split(",").filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const res = await fetchSubtreeSummaries(ids, { weekStartYmd });
      if (cancelled) return;
      setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, weekStartYmd, refreshKey]);

  return data;
}
