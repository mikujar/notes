import {
  deleteCollectionApi,
  removeCardFromCollectionApi,
  updateCardApi,
  updateCollectionApi,
} from "../api/collections";
import type { Collection, NoteCard, SchemaField } from "../types";
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
): {
  nextTree: Collection[];
  /** 源子树移入 target 且不在 target 中重名的卡：需云端 PATCH 归属到 target */
  movedCardIds: string[];
  /** 源子树中在 target 已有 placement 的卡：只需云端 DELETE 源 placement，不改 target */
  duplicateMoves: { cardId: string; fromColId: string }[];
  /** 需要 PATCH 的每张卡的源 placement colId */
  moves: { cardId: string; fromColId: string }[];
  /** 合并后应写到 target 的 cardSchema.fields（取双方字段按 id 去重后联集）；不变时为 null */
  mergedSchemaFields: SchemaField[] | null;
} | null {
  if (sourceRootId === targetColId) return null;
  const sourceNode = findCollectionById(cols, sourceRootId);
  const targetNode = findCollectionById(cols, targetColId);
  if (!sourceNode || !targetNode) return null;
  if (isTargetUnderDragNode(sourceNode, targetColId)) return null;

  /** 目标已有的 cardId，用来辨别哪些是重复 placement（合并后不该在 target 重复出现） */
  const existingInTarget = new Set(targetNode.cards.map((c) => c.id));

  const items = collectCardsInSubtreeWithPathLabels(cols, sourceRootId);
  const extracted: NoteCard[] = [];
  const patchMoves: { cardId: string; fromColId: string }[] = [];
  const duplicateMoves: { cardId: string; fromColId: string }[] = [];
  let next = cols;
  for (const { colId, card } of items) {
    const ex = extractCardFromCollections(next, colId, card.id);
    if (!ex.card) continue;
    next = ex.next;
    if (existingInTarget.has(card.id)) {
      /** target 已有同 id 卡：源 placement 只删不移 */
      duplicateMoves.push({ cardId: card.id, fromColId: colId });
    } else {
      existingInTarget.add(card.id);
      extracted.push(ex.card);
      patchMoves.push({ cardId: card.id, fromColId: colId });
    }
  }
  next = mapCollectionById(next, targetColId, (col) => ({
    ...col,
    cards: [...col.cards, ...extracted],
  }));
  next = rewireRelatedRefsAfterCardsMoved(
    next,
    items.map((it) => ({
      fromColId: it.colId,
      toColId: targetColId,
      cardId: it.card.id,
    }))
  );

  /** cardSchema.fields 合并：按 id 去重，target 字段先、source 字段补 */
  const targetFields = targetNode.cardSchema?.fields ?? [];
  const sourceFields = sourceNode.cardSchema?.fields ?? [];
  const seen = new Set(targetFields.map((f) => f.id).filter(Boolean));
  const mergedFields = [
    ...targetFields,
    ...sourceFields.filter((f) => f.id && !seen.has(f.id)),
  ].map((f, idx) => ({ ...f, order: idx }));
  if (mergedFields.length > targetFields.length) {
    next = mapCollectionById(next, targetColId, (col) => ({
      ...col,
      cardSchema: {
        ...(col.cardSchema ?? {}),
        version: col.cardSchema?.version ?? 1,
        fields: mergedFields,
      },
    }));
  }

  const { tree, removed } = removeCollectionFromTree(next, sourceRootId);
  if (!removed) return null;
  return {
    nextTree: tree,
    movedCardIds: extracted.map((c) => c.id),
    duplicateMoves,
    moves: patchMoves,
    mergedSchemaFields:
      mergedFields.length > targetFields.length ? mergedFields : null,
  };
}

/**
 * 云端：
 *   - 为「从源子树移入」的卡片 PATCH（collectionId + target 列表中的 sortOrder）
 *   - 源子树里在 target 已有 placement 的重复卡：DELETE 源 placement（避免 UNIQUE 冲突）
 *   - 可选同步合并后的 cardSchema.fields 到 target
 *   - 最后 DELETE 被合并掉的空合集根
 */
export async function persistMergeCollectionsRemote(
  nextTree: Collection[],
  targetColId: string,
  movedCardIds: Set<string>,
  sourceRootId: string,
  moves: { cardId: string; fromColId: string }[],
  onProgress?: (current: number, total: number) => void,
  duplicateMoves: { cardId: string; fromColId: string }[] = [],
  mergedSchemaFields: SchemaField[] | null = null
): Promise<boolean> {
  const targetCol = findCollectionById(nextTree, targetColId);
  if (!targetCol) return false;

  const fromByCard = new Map(moves.map((m) => [m.cardId, m.fromColId]));

  const totalSteps =
    movedCardIds.size +
    duplicateMoves.length +
    (mergedSchemaFields ? 1 : 0) +
    1;
  let done = 0;
  const tick = () => {
    done++;
    onProgress?.(done, totalSteps);
  };

  /** 先处理重复卡：只删源 placement；target 这条记录已经存在，不用 PATCH */
  for (const dup of duplicateMoves) {
    const ok = await removeCardFromCollectionApi(dup.cardId, dup.fromColId);
    if (!ok) return false;
    tick();
  }

  /** 再把新进 target 的卡 PATCH 改归属 + sort_order */
  for (let i = 0; i < targetCol.cards.length; i++) {
    const card = targetCol.cards[i]!;
    if (!movedCardIds.has(card.id)) continue;
    const fromColId = fromByCard.get(card.id);
    if (!fromColId) return false;
    const ok = await updateCardApi(card.id, {
      sortOrder: i,
      collectionId: targetColId,
      placementCollectionId: fromColId,
    });
    if (!ok) return false;
    tick();
  }

  if (mergedSchemaFields) {
    const ok = await updateCollectionApi(targetColId, {
      cardSchema: {
        version: 1,
        fields: mergedSchemaFields,
      },
    });
    if (!ok) return false;
    tick();
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

/** 单层布局：每个合集在树中的 parentId 与同级 sortOrder（与 DB 一致） */
export type CollectionLayoutEntry = {
  parentId: string | null;
  sortOrder: number;
};

function buildCollectionLayoutMap(
  cols: Collection[]
): Map<string, CollectionLayoutEntry> {
  const m = new Map<string, CollectionLayoutEntry>();
  function walk(nodes: Collection[], parentKey: string | null) {
    nodes.forEach((n, i) => {
      m.set(n.id, { parentId: parentKey, sortOrder: i });
      if (n.children?.length) walk(n.children, n.id);
    });
  }
  walk(cols, null);
  return m;
}

/**
 * 两棵树之间需要写入库的合集布局差量（仅 parentId / sortOrder 变化）。
 * 用于拖拽/移动后只 PATCH 变更行，避免整棵树 N 次串行请求。
 */
export function diffCollectionLayoutPatches(
  previousTree: Collection[],
  nextTree: Collection[]
): { id: string; parentId: string | null; sortOrder: number }[] {
  const before = buildCollectionLayoutMap(previousTree);
  const after = buildCollectionLayoutMap(nextTree);
  const patches: {
    id: string;
    parentId: string | null;
    sortOrder: number;
  }[] = [];
  for (const [id, pos] of after) {
    const old = before.get(id);
    if (!old) {
      patches.push({ id, parentId: pos.parentId, sortOrder: pos.sortOrder });
    } else if (
      old.parentId !== pos.parentId ||
      old.sortOrder !== pos.sortOrder
    ) {
      patches.push({ id, parentId: pos.parentId, sortOrder: pos.sortOrder });
    }
  }
  return patches;
}

const LAYOUT_PATCH_CONCURRENCY = 8;

async function persistCollectionLayoutPatchesRemote(
  patches: { id: string; parentId: string | null; sortOrder: number }[],
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  const total = patches.length;
  if (total === 0) return true;
  onProgress?.(0, total);
  let completed = 0;
  for (let i = 0; i < patches.length; i += LAYOUT_PATCH_CONCURRENCY) {
    const batch = patches.slice(i, i + LAYOUT_PATCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((p) =>
        updateCollectionApi(p.id, {
          parentId: p.parentId,
          sortOrder: p.sortOrder,
        })
      )
    );
    if (results.some((ok) => !ok)) return false;
    completed += batch.length;
    onProgress?.(completed, total);
  }
  return true;
}

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
  next: Collection[],
  onProgress?: (current: number, total: number) => void,
  /** 若传入移动/拖拽前的树，则只 PATCH 布局变化项并联请求；失败时再回退为整树顺序写 */
  previousTree?: Collection[] | null
): Promise<boolean> {
  const runFullSequential = () => {
    const total = countCollectionNodes(next);
    if (total === 0) return Promise.resolve(true);
    const progress =
      onProgress && total > 0
        ? { total, onProgress }
        : undefined;
    if (onProgress && total > 0) onProgress(0, total);
    return persistCollectionTreeLayoutRemote(next, null, progress);
  };

  if (previousTree != null) {
    const patches = diffCollectionLayoutPatches(previousTree, next);
    if (patches.length === 0) return true;
    let ok = await persistCollectionLayoutPatchesRemote(patches, onProgress);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 400));
    ok = await runFullSequential();
    return ok;
  }

  let ok = await runFullSequential();
  if (ok) return true;
  await new Promise((r) => setTimeout(r, 400));
  ok = await runFullSequential();
  return ok;
}
