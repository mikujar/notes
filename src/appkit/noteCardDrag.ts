import {
  removeCardFromCollectionApi,
  updateCardApi,
  type CardRemotePatch,
} from "../api/collections";
import type { Collection } from "../types";
import {
  appendCardToCollection,
  extractCardFromCollections,
  findCollectionById,
  insertCardRelativeTo,
  prependCardToCollection,
  removeCardIdFromCollectionCards,
} from "./collectionModel";

export type NoteCardDragPayload = {
  colId: string;
  cardId: string;
};

export type NoteCardDropTarget =
  | { type: "before"; colId: string; cardId: string }
  | { type: "after"; colId: string; cardId: string }
  | { type: "collection"; colId: string };

export const NOTE_CARD_DRAG_MIME = "application/x-mikujar-note-card";
export const NOTE_CARD_TEXT_PREFIX = "mikujar-note-card:";

export function noteCardDragTypesInclude(dt: DataTransfer): boolean {
  const want = NOTE_CARD_DRAG_MIME.toLowerCase();
  return [...dt.types].some((t) => t.toLowerCase() === want);
}

export function readNoteCardDragPayload(
  e: { dataTransfer: DataTransfer | null }
): NoteCardDragPayload | null {
  const dt = e.dataTransfer;
  if (!dt) return null;
  let raw =
    dt.getData(NOTE_CARD_DRAG_MIME) || dt.getData("text/plain");
  if (!raw) return null;
  if (raw.startsWith(NOTE_CARD_TEXT_PREFIX)) {
    raw = raw.slice(NOTE_CARD_TEXT_PREFIX.length);
  }
  try {
    const o = JSON.parse(raw) as NoteCardDragPayload & { blockId?: string };
    if (o?.colId && o?.cardId) {
      return { colId: o.colId, cardId: o.cardId };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function findCollectionIdForCard(
  cols: Collection[],
  cardId: string
): string | null {
  for (const c of cols) {
    if (c.cards.some((x) => x.id === cardId)) return c.id;
    if (c.children?.length) {
      const r = findCollectionIdForCard(c.children, cardId);
      if (r) return r;
    }
  }
  return null;
}

/** 远程模式：把拖拽后的合集内顺序与跨合集归属写入 PostgreSQL */
export async function persistNoteCardDropToRemote(
  from: NoteCardDragPayload,
  nextTree: Collection[],
  opts?: {
    /**
     * 目标合集在拖拽前已有该笔记（多合集归属）：本地只看到「从来源抽出」；
     * 服务端应 DELETE 来源 placement，而不能把来源行 UPDATE 成目标（会与已有行冲突）。
     */
    removeSourcePlacementOnly?: boolean;
  }
): Promise<boolean> {
  const movedId = from.cardId;
  const fromColId = from.colId;
  const toColId = findCollectionIdForCard(nextTree, movedId);
  if (!toColId) return false;

  const toCol = findCollectionById(nextTree, toColId);
  if (!toCol) return false;

  if (
    opts?.removeSourcePlacementOnly === true &&
    fromColId !== toColId
  ) {
    const okDel = await removeCardFromCollectionApi(movedId, fromColId);
    if (!okDel) return false;
    for (let idx = 0; idx < toCol.cards.length; idx++) {
      const c = toCol.cards[idx];
      const ok = await updateCardApi(c.id, {
        sortOrder: idx,
        placementCollectionId: toColId,
      });
      if (!ok) return false;
    }
    return true;
  }

  const fromCol =
    fromColId !== toColId
      ? findCollectionById(nextTree, fromColId)
      : null;

  for (let idx = 0; idx < toCol.cards.length; idx++) {
    const c = toCol.cards[idx];
    const patch: CardRemotePatch = {
      sortOrder: idx,
      placementCollectionId: toColId,
    };
    if (c.id === movedId && fromColId !== toColId) {
      patch.collectionId = toColId;
      patch.placementCollectionId = fromColId;
    }
    const ok = await updateCardApi(c.id, patch);
    if (!ok) return false;
  }

  if (fromColId !== toColId && fromCol) {
    for (let idx = 0; idx < fromCol.cards.length; idx++) {
      const ok = await updateCardApi(fromCol.cards[idx].id, {
        sortOrder: idx,
        placementCollectionId: fromColId,
      });
      if (!ok) return false;
    }
  }

  return true;
}
export function applyNoteCardDrop(
  prev: Collection[],
  from: NoteCardDragPayload,
  to: NoteCardDropTarget,
  opts?: {
    /** 与「新笔记加到时间线顶部」一致：拖到侧栏合集时插到该合集最前 */
    dropOnCollectionToTop?: boolean;
  }
): Collection[] {
  if (
    to.type !== "collection" &&
    from.colId === to.colId &&
    (to.type === "before" || to.type === "after") &&
    from.cardId === to.cardId
  ) {
    return prev;
  }
  const fromCol = findCollectionById(prev, from.colId);
  const fromCard = fromCol?.cards.find((c) => c.id === from.cardId);
  if (!fromCard) return prev;

  const { next, card } = extractCardFromCollections(
    prev,
    from.colId,
    from.cardId
  );
  if (!card) return prev;

  if (to.type === "collection") {
    if (from.colId === to.colId) return prev;
    /** 目标合集里已有该卡（多归属）：仅从来源移除，勿再插入 */
    if (
      findCollectionById(next, to.colId)?.cards.some((c) => c.id === card.id)
    ) {
      return next;
    }
    return opts?.dropOnCollectionToTop
      ? prependCardToCollection(next, to.colId, card)
      : appendCardToCollection(next, to.colId, card);
  }

  const place = to.type === "before" ? "before" : "after";
  /** 插入前去掉目标合集中同 id，避免多归属时同列表出现两条 */
  const stripped = removeCardIdFromCollectionCards(next, to.colId, card.id);
  const toCol = findCollectionById(stripped, to.colId);
  const anchor = toCol?.cards.find((c) => c.id === to.cardId);
  if (!anchor) {
    return appendCardToCollection(stripped, to.colId, card);
  }

  return insertCardRelativeTo(
    stripped,
    to.colId,
    card,
    to.cardId,
    place
  );
}
