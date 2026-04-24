/**
 * collections-v2.ts — 懒加载路径的数据层
 *
 * 对应后端新增的三个端点（PR 1）：
 *   GET /api/collections?mode=meta
 *   GET /api/collections/:id/cards?page=&limit=&sort=
 *   GET /api/cards/:id
 *
 * 与老的 fetchCollectionsFromApi（整棵树一把梭）并存；接入到 App.tsx
 * 在 PR 4 里按 feature flag 灰度切换。
 */

import type {
  Collection,
  CollectionCardSchema,
  CollectionIconShape,
  NoteCard,
} from "../types";
import { apiBase, apiFetchInit } from "./apiBase";
import { buildHeadersGet } from "./collections";

/** 合集元信息：Collection 的"无 cards 版本" + 服务端算好的卡片计数。 */
export type CollectionMeta = {
  id: string;
  name: string;
  dotColor: string;
  iconShape?: CollectionIconShape;
  hint?: string;
  isCategory?: boolean;
  cardSchema?: CollectionCardSchema;
  presetTypeId?: string;
  parentId?: string;
  sortOrder?: number;
  /** 该合集本身直接包含的卡片数（不含子合集） */
  cardCount: number;
  /** 子树累加的卡片总数（含所有子合集） */
  totalCardCount: number;
  children: CollectionMeta[];
};

export type CardsPage = {
  cards: NoteCard[];
  hasMore: boolean;
  page: number;
  limit: number;
};

export type CollectionCardsSort = "sort_order" | "-added_on" | "-updated_at";

/** 拉合集元信息树；失败返回 null。 */
export async function fetchMetaTree(): Promise<CollectionMeta[] | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/collections?mode=meta`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    if (!Array.isArray(data)) return null;
    return data as CollectionMeta[];
  } catch {
    return null;
  }
}

/**
 * 拉某合集的卡片（分页）。特殊 id `__loose_notes` 返回孤儿卡。
 * 失败返回 null；合集不存在返回 null（后端 404 统一当成失败处理）。
 */
export async function fetchCardsForCollection(
  collectionId: string,
  opts: { page?: number; limit?: number; sort?: CollectionCardsSort } = {}
): Promise<CardsPage | null> {
  const base = apiBase();
  const params = new URLSearchParams();
  params.set("page", String(opts.page ?? 1));
  params.set("limit", String(opts.limit ?? 50));
  if (opts.sort) params.set("sort", opts.sort);
  try {
    const r = await fetch(
      `${base}/api/collections/${encodeURIComponent(collectionId)}/cards?${params}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as CardsPage;
  } catch {
    return null;
  }
}

/**
 * 按 id 单查卡片完整数据（含 media/reminders/relatedRefs/...）。
 * 用于搜索结果 / 提醒 / 日历跳转进来没有对应合集缓存的场景。
 */
export async function fetchCardById(cardId: string): Promise<NoteCard | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    if (!data || typeof data !== "object") return null;
    return data as NoteCard;
  } catch {
    return null;
  }
}

/**
 * CollectionMeta 转成 Collection（空 cards 数组）。用于临时兼容沿用老逻辑
 * 渲染侧栏的场景 —— 真正的卡片通过 useCardsForCollection 按需拉。
 */
export function metaToCollectionShell(m: CollectionMeta): Collection {
  return {
    id: m.id,
    name: m.name,
    dotColor: m.dotColor,
    ...(m.iconShape ? { iconShape: m.iconShape } : {}),
    ...(m.hint ? { hint: m.hint } : {}),
    ...(m.isCategory ? { isCategory: true } : {}),
    ...(m.cardSchema ? { cardSchema: m.cardSchema } : {}),
    ...(m.presetTypeId ? { presetTypeId: m.presetTypeId } : {}),
    cards: [],
    children: m.children.map(metaToCollectionShell),
  };
}
