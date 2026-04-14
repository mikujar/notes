import {
  deleteCollectionApi,
  updateCardApi,
  updateCollectionApi,
} from "../api/collections";
import type { Collection, NoteCard } from "../types";
import {
  collectCardsInSubtreeWithPathLabels,
  extractCardFromCollections,
  findCollectionById,
  mapCollectionById,
  rewireRelatedRefsAfterCardsMoved,
} from "./collectionModel";

export const COLLECTION_DRAG_MIME = "application/x-note-collection";

export type CollectionDropPosition = "before" | "after" | "inside";

export function removeCollectionFromTree(
  cols: Collection[],
  id: string
): { tree: Collection[]; removed: Collection | null } {
  let removed: Collection | null = null;

  function process(nodes: Collection[]): Collection[] {
    return nodes
      .filter((n) => {
        if (n.id === id) {
          removed = n;
          return false;
        }
        return true;
      })
      .map((n) => {
        if (!n.children?.length) return n;
        const nc = process(n.children);
        return {
          ...n,
          children: nc.length > 0 ? nc : undefined,
        };
      });
  }

  return { tree: process(cols), removed };
}

export function collectSubtreeCollectionIds(root: Collection): string[] {
  const out = [root.id];
  for (const ch of root.children ?? []) {
    out.push(...collectSubtreeCollectionIds(ch));
  }
  return out;
}

/**
 * 将 source 子树内全部卡片合并进 target（接在目标列表末尾），再移除 source 子树。
 * 不可合并到自身或自己的子孙合集。
 */
export function mergeCollectionSubtreeIntoTarget(
  cols: Collection[],
  sourceRootId: string,
  targetColId: string
): { nextTree: Collection[]; movedCardIds: string[] } | null {
  if (sourceRootId === targetColId) return null;
  const sourceNode = findCollectionById(cols, sourceRootId);
  const targetNode = findCollectionById(cols, targetColId);
  if (!sourceNode || !targetNode) return null;
  if (isTargetUnderDragNode(sourceNode, targetColId)) return null;

  const items = collectCardsInSubtreeWithPathLabels(cols, sourceRootId);
  const moves = items.map((it) => ({
    fromColId: it.colId,
    toColId: targetColId,
    cardId: it.card.id,
  }));
  const extracted: NoteCard[] = [];
  let next = cols;
  for (const { colId, card } of items) {
    const ex = extractCardFromCollections(next, colId, card.id);
    if (!ex.card) continue;
    next = ex.next;
    extracted.push(ex.card);
  }
  next = mapCollectionById(next, targetColId, (col) => ({
    ...col,
    cards: [...col.cards, ...extracted],
  }));
  next = rewireRelatedRefsAfterCardsMoved(next, moves);
  const { tree, removed } = removeCollectionFromTree(next, sourceRootId);
  if (!removed) return null;
  return {
    nextTree: tree,
    movedCardIds: extracted.map((c) => c.id),
  };
}

/**
 * 云端：仅为「从源子树移入」的卡片 PATCH（collectionId + 在目标列表中的 sortOrder）。
 * 合并时新卡接在目标原有卡片之后，原有卡片的顺序与 sort_order 在库中不变，无需重复请求。
 * 最后 DELETE 被合并掉的空合集根。
 */
export async function persistMergeCollectionsRemote(
  nextTree: Collection[],
  targetColId: string,
  movedCardIds: Set<string>,
  sourceRootId: string,
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  const targetCol = findCollectionById(nextTree, targetColId);
  if (!targetCol) return false;

  const totalSteps = movedCardIds.size + 1;
  let done = 0;

  for (let i = 0; i < targetCol.cards.length; i++) {
    const card = targetCol.cards[i]!;
    if (!movedCardIds.has(card.id)) continue;
    const ok = await updateCardApi(card.id, {
      sortOrder: i,
      collectionId: targetColId,
    });
    if (!ok) return false;
    done++;
    onProgress?.(done, totalSteps);
  }

  const okDel = await deleteCollectionApi(sourceRootId);
  if (!okDel) return false;
  onProgress?.(totalSteps, totalSteps);
  return true;
}

export function findParentAndIndex(
  cols: Collection[],
  targetId: string
): { parentId: string | null; index: number } | null {
  const rootIdx = cols.findIndex((c) => c.id === targetId);
  if (rootIdx >= 0) return { parentId: null, index: rootIdx };

  function walk(
    nodes: Collection[],
    parentId: string
  ): { parentId: string; index: number } | null {
    const idx = nodes.findIndex((c) => c.id === targetId);
    if (idx >= 0) return { parentId, index: idx };
    for (const n of nodes) {
      if (n.children?.length) {
        const r = walk(n.children, n.id);
        if (r) return r;
      }
    }
    return null;
  }

  for (const n of cols) {
    if (n.children?.length) {
      const r = walk(n.children, n.id);
      if (r) return r;
    }
  }
  return null;
}

export function isTargetUnderDragNode(
  dragNode: Collection,
  targetId: string
): boolean {
  function walk(n: Collection): boolean {
    if (n.id === targetId) return true;
    return n.children?.some(walk) ?? false;
  }
  return dragNode.children?.some(walk) ?? false;
}

/**
 * 将子树插入目标旁/内。找不到 target 时必须返回 null（调用方已先从树中摘掉 drag 节点，若误返回原 cols 会整棵丢失）。
 */
export function insertCollectionRelative(
  cols: Collection[],
  targetId: string,
  node: Collection,
  position: CollectionDropPosition
): Collection[] | null {
  if (position === "inside") {
    if (!findCollectionById(cols, targetId)) return null;
    return mapCollectionById(cols, targetId, (t) => ({
      ...t,
      children: [node, ...(t.children ?? [])],
    }));
  }

  const info = findParentAndIndex(cols, targetId);
  if (!info) return null;

  if (info.parentId === null) {
    const next = [...cols];
    const insertAt =
      position === "before" ? info.index : info.index + 1;
    next.splice(insertAt, 0, node);
    return next;
  }

  return mapCollectionById(cols, info.parentId, (p) => {
    const ch = [...(p.children ?? [])];
    const insertAt =
      position === "before" ? info.index : info.index + 1;
    ch.splice(insertAt, 0, node);
    return { ...p, children: ch };
  });
}

/** 合集树节点总数（含各级子合集），用于远程布局同步进度 */
export function countCollectionNodes(cols: Collection[]): number {
  let n = 0;
  const walk = (nodes: Collection[]) => {
    for (const c of nodes) {
      n += 1;
      if (c.children?.length) walk(c.children);
    }
  };
  walk(cols);
  return n;
}

export function moveCollectionInTree(
  cols: Collection[],
  dragId: string,
  targetId: string,
  position: CollectionDropPosition
): Collection[] {
  if (dragId === targetId) return cols;

  const dragNode = findCollectionById(cols, dragId);
  if (!dragNode) return cols;
  if (isTargetUnderDragNode(dragNode, targetId)) return cols;

  const nBefore = countCollectionNodes(cols);

  const { tree: without, removed } = removeCollectionFromTree(
    cols,
    dragId
  );
  if (!removed) return cols;

  const inserted = insertCollectionRelative(
    without,
    targetId,
    removed,
    position
  );
  if (inserted === null) {
    return cols;
  }
  if (countCollectionNodes(inserted) !== nBefore) {
    return cols;
  }
  return inserted;
}

export function dropPositionFromEvent(
  e: { clientY: number },
  el: HTMLElement
): CollectionDropPosition {
  const r = el.getBoundingClientRect();
  const y = e.clientY - r.top;
  const h = Math.max(r.height, 1);
  /** 上下边缘各留一条「细带」，矮行用像素下限，避免 28%/72% 在 min-height 36px 上过窄难操作 */
  const margin = Math.max(10, Math.min(16, h * 0.3));
  if (y < margin) return "before";
  if (y > h - margin) return "after";
  return "inside";
}

export type PersistCollectionLayoutProgress = {
  total: number;
  onProgress: (current: number, total: number) => void;
};

/** 远程模式：侧栏拖拽后的 parentId + 同级 sort_order 写入库 */
export async function persistCollectionTreeLayoutRemote(
  nodes: Collection[],
  parentId: string | null,
  progress?: PersistCollectionLayoutProgress
): Promise<boolean> {
  let completed = 0;
  async function walk(ns: Collection[], pid: string | null): Promise<boolean> {
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      const ok = await updateCollectionApi(n.id, {
        parentId: pid,
        sortOrder: i,
      });
      if (!ok) return false;
      if (progress) {
        completed++;
        progress.onProgress(completed, progress.total);
      }
      if (n.children?.length) {
        const sub = await walk(n.children, n.id);
        if (!sub) return false;
      }
    }
    return true;
  }
  return walk(nodes, parentId);
}

/** 顺序 PATCH 偶发失败时整树再试一次，减少「排了一半就报错」 */
export async function persistCollectionTreeLayoutRemoteWithRetry(
  nodes: Collection[],
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  const total = countCollectionNodes(nodes);
  const progress =
    onProgress && total > 0
      ? { total, onProgress }
      : undefined;
  const run = () => persistCollectionTreeLayoutRemote(nodes, null, progress);
  let ok = await run();
  if (ok) return true;
  await new Promise((r) => setTimeout(r, 400));
  ok = await run();
  return ok;
}
