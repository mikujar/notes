/**
 * useLazyEndpointsProbe — 启动后串测新端点的响应大小 / 耗时
 *
 * 仅在 isLazyCollectionsEnabled() = true 时运行。打印到 console，
 * 不改任何 UI 行为。用途：
 *   1. 验证 PR 1/2 的后端端点在部署后确实可用
 *   2. 对比新 vs 旧 payload 体积（判断是否值得切换全量切换到懒加载）
 *   3. 发现后端 bug（400/500）或响应 schema 偏差时尽早暴露
 *
 * 生产环境里打开 flag 跑一次，把 console 输出发给我，就能判断是否可以
 * 推进 PR 4 后续的视图迁移。
 */

import { useEffect } from "react";
import { isLazyCollectionsEnabled } from "../lazyFeatureFlag";
import {
  fetchMetaTree,
  fetchCardsForCollection,
  type CollectionMeta,
} from "../api/collections-v2";
import {
  fetchTags,
  fetchOverviewSummary,
  fetchNotesPage,
  fetchReminders,
} from "../api/aggregates";

type ProbeResult = {
  label: string;
  ok: boolean;
  ms: number;
  bytes: number | null;
  note?: string;
};

async function timed<T>(
  label: string,
  fn: () => Promise<T>
): Promise<[ProbeResult, T | null]> {
  const t0 = performance.now();
  try {
    const res = await fn();
    const ms = Math.round(performance.now() - t0);
    const bytes = res == null ? null : new Blob([JSON.stringify(res)]).size;
    return [{ label, ok: res != null, ms, bytes }, res];
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return [
      {
        label,
        ok: false,
        ms,
        bytes: null,
        note: (e as Error)?.message || String(e),
      },
      null,
    ];
  }
}

function flattenIds(tree: CollectionMeta[]): string[] {
  const out: string[] = [];
  function walk(nodes: CollectionMeta[]) {
    for (const n of nodes) {
      out.push(n.id);
      if (n.children?.length) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

export function useLazyEndpointsProbe(args: {
  /** 仅在真正登录到远程账户且首次同步完成之后再跑；否则新端点会 401 */
  ready: boolean;
}): void {
  const { ready } = args;

  useEffect(() => {
    if (!isLazyCollectionsEnabled()) return;
    if (!ready) return;

    let cancelled = false;

    (async () => {
      const now = new Date();
      const ymd = now.toISOString().slice(0, 10);
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartYmd = weekStart.toISOString().slice(0, 10);

      const results: ProbeResult[] = [];

      /* 1. meta tree */
      const [metaProbe, metaTree] = await timed("meta tree", fetchMetaTree);
      if (cancelled) return;
      results.push(metaProbe);

      /* 2. 一个合集的第一页卡片（从 meta 里挑一个有卡的） */
      if (metaTree && metaTree.length > 0) {
        const firstWithCards = flattenIds(metaTree).find((id) => {
          function find(nodes: CollectionMeta[]): CollectionMeta | null {
            for (const n of nodes) {
              if (n.id === id && n.cardCount > 0) return n;
              const hit = n.children?.length ? find(n.children) : null;
              if (hit) return hit;
            }
            return null;
          }
          return !!find(metaTree);
        });
        if (firstWithCards) {
          const [probe] = await timed(
            `cards for collection ${firstWithCards}`,
            () => fetchCardsForCollection(firstWithCards, { page: 1, limit: 50 })
          );
          if (cancelled) return;
          results.push(probe);
        }
      }

      /* 3. 聚合端点们 */
      const [pOv] = await timed("overview summary", () =>
        fetchOverviewSummary({ todayYmd: ymd, weekStartYmd })
      );
      if (cancelled) return;
      results.push(pOv);

      const [pTags] = await timed("tags", fetchTags);
      if (cancelled) return;
      results.push(pTags);

      const [pNotes] = await timed("notes page 1", () =>
        fetchNotesPage({ page: 1, limit: 50 })
      );
      if (cancelled) return;
      results.push(pNotes);

      const [pRem] = await timed("reminders (pending)", () =>
        fetchReminders({ filter: "pending", page: 1, limit: 50 })
      );
      if (cancelled) return;
      results.push(pRem);

      /* 输出表格 */
      const rows = results.map((r) => ({
        endpoint: r.label,
        ok: r.ok ? "✓" : "✗",
        ms: r.ms,
        kb: r.bytes != null ? +(r.bytes / 1024).toFixed(1) : "-",
        note: r.note ?? "",
      }));
      // eslint-disable-next-line no-console
      console.info("[lazy-endpoints-probe] VITE_LAZY_COLLECTIONS=1 smoke test");
      // eslint-disable-next-line no-console
      console.table(rows);
      const totalMs = results.reduce((s, r) => s + r.ms, 0);
      const totalKB = results.reduce((s, r) => s + (r.bytes ?? 0) / 1024, 0);
      // eslint-disable-next-line no-console
      console.info(
        `[lazy-endpoints-probe] total: ${totalMs} ms, ${totalKB.toFixed(1)} KB`
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [ready]);
}
