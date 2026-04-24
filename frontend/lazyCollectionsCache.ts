/**
 * lazyCollectionsCache.ts — 懒加载模式下的 localStorage 快照
 *
 * 与 remoteCollectionsCache.ts 并存：
 *   - remoteCollectionsCache (v:1) 给全量树路径用（老路径）
 *   - lazyCollectionsCache (v:2)  给懒加载路径用（新路径）
 *
 * 新快照只存 meta tree + 最近 N 个合集的卡片，便于离线快速渲染最近
 * 访问过的合集；其它合集用户打开时从服务端拉。
 *
 * PR 3 里只先把结构写出来；PR 4 里 useRemoteCollectionsSync 会在
 * VITE_LAZY_COLLECTIONS=1 时用这套替代 v:1 快照。
 */

import type { NoteCard } from "./types";
import type { CollectionMeta } from "./api/collections-v2";
import { safeGetItem, safeSetItem } from "./lib/localPref";

const KEY = "cardnote.remote.v2.lazySnapshot";

/** LRU 持久化上限：最近 10 个合集的卡片 */
const MAX_PERSIST_COLLECTIONS = 10;

export type PersistedCollectionCards = {
  cards: NoteCard[];
  hasMore: boolean;
  page: number;
  limit: number;
  savedAt: string;
};

export type LazyCollectionsSnapshotV2 = {
  v: 2;
  userKey: string;
  metaTree: CollectionMeta[];
  /** key = collectionId；按 savedAt 新旧 cap 到 MAX_PERSIST_COLLECTIONS */
  cardsByCollection: Record<string, PersistedCollectionCards>;
  metaEtag: string | null;
  savedAt: string;
};

export function loadLazySnapshot(
  userKey: string
): LazyCollectionsSnapshotV2 | null {
  const raw = safeGetItem(KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<LazyCollectionsSnapshotV2>;
    if (o.v !== 2 || o.userKey !== userKey || !Array.isArray(o.metaTree)) {
      return null;
    }
    return {
      v: 2,
      userKey: o.userKey,
      metaTree: o.metaTree as CollectionMeta[],
      cardsByCollection:
        (o.cardsByCollection as Record<string, PersistedCollectionCards>) ?? {},
      metaEtag: o.metaEtag ?? null,
      savedAt: o.savedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveLazySnapshot(
  userKey: string,
  payload: Omit<LazyCollectionsSnapshotV2, "v" | "userKey" | "savedAt"> & {
    savedAt?: string;
  }
): void {
  /* 按 savedAt 倒序截断到 MAX_PERSIST_COLLECTIONS 条；老的淘汰掉 */
  const entries = Object.entries(payload.cardsByCollection).sort((a, b) => {
    const ta = Date.parse(a[1].savedAt || "") || 0;
    const tb = Date.parse(b[1].savedAt || "") || 0;
    return tb - ta;
  });
  const capped = Object.fromEntries(entries.slice(0, MAX_PERSIST_COLLECTIONS));

  const snap: LazyCollectionsSnapshotV2 = {
    v: 2,
    userKey,
    metaTree: payload.metaTree,
    cardsByCollection: capped,
    metaEtag: payload.metaEtag ?? null,
    savedAt: payload.savedAt ?? new Date().toISOString(),
  };
  safeSetItem(KEY, JSON.stringify(snap));
}

/** 只更新 metaTree（保持 cardsByCollection 不变）。mutation 后刷新合集结构用。 */
export function updateLazySnapshotMeta(
  userKey: string,
  metaTree: CollectionMeta[],
  metaEtag: string | null = null
): void {
  const existing = loadLazySnapshot(userKey);
  saveLazySnapshot(userKey, {
    metaTree,
    cardsByCollection: existing?.cardsByCollection ?? {},
    metaEtag,
  });
}

/** 写入某合集的已加载卡片到 LRU 快照。 */
export function saveLazyCollectionCards(
  userKey: string,
  collectionId: string,
  data: Omit<PersistedCollectionCards, "savedAt">
): void {
  const existing = loadLazySnapshot(userKey);
  if (!existing) return; // 没有 meta tree 就别乱写
  const nextCards = {
    ...existing.cardsByCollection,
    [collectionId]: {
      ...data,
      savedAt: new Date().toISOString(),
    },
  };
  saveLazySnapshot(userKey, {
    metaTree: existing.metaTree,
    cardsByCollection: nextCards,
    metaEtag: existing.metaEtag,
  });
}

export function clearLazySnapshot(): void {
  safeSetItem(KEY, "");
}
