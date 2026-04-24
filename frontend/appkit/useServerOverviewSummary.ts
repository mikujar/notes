/**
 * useServerOverviewSummary — flag on 时拉 /api/overview/summary
 *
 * 只在 flag 开 + 必需参数齐备时请求；失败或 flag off 返回 null，
 * 调用方使用原有本地 useMemo 结果。
 *
 * refreshKey 用于触发重拉（例如本地新建卡后）；未传时不重拉。
 */

import { useEffect, useState } from "react";
import { isLazyCollectionsEnabled } from "../lazyFeatureFlag";
import {
  fetchOverviewSummary,
  type OverviewSummary,
} from "../api/aggregates";

export function useServerOverviewSummary(args: {
  todayYmd: string;
  weekStartYmd: string;
  refreshKey?: number | string;
}): OverviewSummary | null {
  const { todayYmd, weekStartYmd, refreshKey = 0 } = args;
  const [data, setData] = useState<OverviewSummary | null>(null);

  useEffect(() => {
    if (!isLazyCollectionsEnabled()) {
      setData(null);
      return;
    }
    if (!todayYmd || !weekStartYmd) return;
    let cancelled = false;
    (async () => {
      const res = await fetchOverviewSummary({ todayYmd, weekStartYmd });
      if (cancelled) return;
      setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [todayYmd, weekStartYmd, refreshKey]);

  return data;
}
