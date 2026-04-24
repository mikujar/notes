/**
 * useCardsByCollection — 按合集 LRU 缓存 + 懒加载 hook
 *
 * 用法：
 *   const { cards, hasMore, loading, loadMore, refetch, upsertCard, removeCard } =
 *     useCardsForCollection(activeCollectionId);
 *
 * 内部：
 *   - Map<collectionId, Slice> 内存缓存，LRU 最多 MAX_COLLECTIONS
 *   - 活跃合集切换时若无缓存则触发 fetchCardsForCollection
 *   - 乐观更新接口：upsertCard / removeCard 给编辑路径同步本地缓存
 *   - 可接多个并发订阅者，状态通过 useSyncExternalStore 广播
 *
 * 故意不做磁盘持久化：磁盘 LRU 在 lazyCollectionsCache.ts 里统一负责，
 * 这个 hook 只管内存里的"已经拉过的最近合集"。
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { NoteCard } from "../types";
import {
  fetchCardsForCollection,
  type CollectionCardsSort,
} from "../api/collections-v2";

/** 每个合集在内存里的状态 */
type Slice = {
  cards: NoteCard[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  /** 最后一次从服务端成功拉取的毫秒时间戳；用作 stale 判定 / LRU tie-break */
  fetchedAt: number;
  /** 发生过错误且还未成功重试 */
  errored: boolean;
};

/** 缓存上限（内存里最多保留的合集数量） */
const MAX_COLLECTIONS = 20;

/** 默认分页大小 */
const DEFAULT_LIMIT = 50;

/** 默认排序 */
const DEFAULT_SORT: CollectionCardsSort = "sort_order";

// ─── 内部存储 + 订阅广播 ───────────────────────────────────────────────────

const store = new Map<string, Slice>();
/** LRU 访问顺序：队尾是最近访问的；淘汰从队首 */
const lruOrder: string[] = [];
const listeners = new Set<() => void>();

function touchLru(collectionId: string) {
  const idx = lruOrder.indexOf(collectionId);
  if (idx >= 0) lruOrder.splice(idx, 1);
  lruOrder.push(collectionId);
  while (lruOrder.length > MAX_COLLECTIONS) {
    const evicted = lruOrder.shift();
    if (evicted != null) store.delete(evicted);
  }
}

function notify() {
  for (const l of listeners) l();
}

function setSlice(collectionId: string, slice: Slice) {
  store.set(collectionId, slice);
  touchLru(collectionId);
  notify();
}

function getSlice(collectionId: string): Slice | undefined {
  return store.get(collectionId);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ─── 对外导出的管理函数 ────────────────────────────────────────────────────

/** 清空所有缓存（登出 / 切换账号时用） */
export function clearCardsByCollection() {
  store.clear();
  lruOrder.length = 0;
  notify();
}

/** 有外部源（例如全量快照）给出的卡片时，直接写入（跳过网络） */
export function seedCollectionCards(
  collectionId: string,
  cards: NoteCard[],
  opts: { hasMore?: boolean; limit?: number } = {}
) {
  setSlice(collectionId, {
    cards,
    page: 1,
    limit: opts.limit ?? DEFAULT_LIMIT,
    hasMore: opts.hasMore ?? false,
    loading: false,
    fetchedAt: Date.now(),
    errored: false,
  });
}

/** 从某合集的已缓存卡片里按 id 更新一张卡（乐观更新用） */
export function upsertCardInCache(
  collectionId: string,
  card: NoteCard,
  opts: { insertAt?: "start" | "end" } = {}
) {
  const slice = getSlice(collectionId);
  if (!slice) return; // 合集没缓存就什么都不做——下次打开合集会从服务端拉到新状态
  const idx = slice.cards.findIndex((c) => c.id === card.id);
  let nextCards: NoteCard[];
  if (idx >= 0) {
    nextCards = slice.cards.slice();
    nextCards[idx] = card;
  } else if (opts.insertAt === "start") {
    nextCards = [card, ...slice.cards];
  } else {
    nextCards = [...slice.cards, card];
  }
  setSlice(collectionId, { ...slice, cards: nextCards });
}

/** 从合集缓存里移除一张卡（soft-trash / 移动到别的合集时用） */
export function removeCardFromCache(collectionId: string, cardId: string) {
  const slice = getSlice(collectionId);
  if (!slice) return;
  const nextCards = slice.cards.filter((c) => c.id !== cardId);
  if (nextCards.length === slice.cards.length) return;
  setSlice(collectionId, { ...slice, cards: nextCards });
}

/** 把一个合集标记为 dirty（下次访问时强制重新拉） */
export function invalidateCollection(collectionId: string) {
  if (!store.has(collectionId)) return;
  store.delete(collectionId);
  const idx = lruOrder.indexOf(collectionId);
  if (idx >= 0) lruOrder.splice(idx, 1);
  notify();
}

// ─── 主 hook ────────────────────────────────────────────────────────────────

export type UseCardsForCollectionResult = {
  cards: NoteCard[];
  hasMore: boolean;
  loading: boolean;
  errored: boolean;
  /** 下一页；已在加载或没有更多会 no-op */
  loadMore: () => void;
  /** 强制重新从第 1 页拉 */
  refetch: () => void;
};

/**
 * 订阅某合集的卡片 slice。首次访问时自动触发第一页加载。
 * 传入 null/空字符串时不触发任何加载（空态兜底）。
 */
export function useCardsForCollection(
  collectionId: string | null | undefined,
  opts: { limit?: number; sort?: CollectionCardsSort } = {}
): UseCardsForCollectionResult {
  const id = collectionId?.trim() || "";
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const sort = opts.sort ?? DEFAULT_SORT;

  const slice = useSyncExternalStore(
    subscribe,
    () => (id ? store.get(id) : undefined),
    () => undefined
  );

  /** 实际执行网络请求的内部实现 */
  const doFetch = useCallback(
    async (targetId: string, page: number, mode: "replace" | "append") => {
      /* 标记 loading 前，若已经在 load 同一个合集的同一页就跳过（防重复点击） */
      const existing = store.get(targetId);
      if (existing?.loading) return;

      setSlice(targetId, {
        cards: existing?.cards ?? [],
        page: existing?.page ?? 0,
        limit,
        hasMore: existing?.hasMore ?? false,
        loading: true,
        fetchedAt: existing?.fetchedAt ?? 0,
        errored: false,
      });

      const res = await fetchCardsForCollection(targetId, { page, limit, sort });
      const current = store.get(targetId);
      if (!current) return; // 期间被 evict 了就算了
      if (!res) {
        setSlice(targetId, {
          ...current,
          loading: false,
          errored: true,
        });
        return;
      }
      const cards =
        mode === "append" ? [...current.cards, ...res.cards] : res.cards;
      setSlice(targetId, {
        cards,
        page: res.page,
        limit: res.limit,
        hasMore: res.hasMore,
        loading: false,
        fetchedAt: Date.now(),
        errored: false,
      });
    },
    [limit, sort]
  );

  /** 第一次访问该合集（没缓存）时自动拉第一页 */
  useEffect(() => {
    if (!id) return;
    const existing = store.get(id);
    if (!existing && !listenersLocked.has(id)) {
      listenersLocked.add(id);
      void doFetch(id, 1, "replace").finally(() => listenersLocked.delete(id));
    } else if (existing) {
      touchLru(id); // 活跃合集，顶到 LRU 最前面
    }
  }, [id, doFetch]);

  const loadMore = useCallback(() => {
    if (!id) return;
    const current = store.get(id);
    if (!current || current.loading || !current.hasMore) return;
    void doFetch(id, current.page + 1, "append");
  }, [id, doFetch]);

  const refetch = useCallback(() => {
    if (!id) return;
    void doFetch(id, 1, "replace");
  }, [id, doFetch]);

  return {
    cards: slice?.cards ?? [],
    hasMore: slice?.hasMore ?? false,
    loading: slice?.loading ?? false,
    errored: slice?.errored ?? false,
    loadMore,
    refetch,
  };
}

/* 并发锁：同一合集同一时刻不开两个 auto-fetch。 */
const listenersLocked = new Set<string>();
