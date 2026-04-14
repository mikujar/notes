import { updateCollectionApi } from "../api/collections";
import type { Collection } from "../types";
import { findCollectionById, mapCollectionById } from "./collectionModel";

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

function countCollectionNodes(cols: Collection[]): number {
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

/** 远程模式：侧栏拖拽后的 parentId + 同级 sort_order 写入库 */
export async function persistCollectionTreeLayoutRemote(
  nodes: Collection[],
  parentId: string | null
): Promise<boolean> {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const ok = await updateCollectionApi(n.id, {
      parentId,
      sortOrder: i,
    });
    if (!ok) return false;
    if (n.children?.length) {
      const sub = await persistCollectionTreeLayoutRemote(
        n.children,
        n.id
      );
      if (!sub) return false;
    }
  }
  return true;
}

/** 顺序 PATCH 偶发失败时整树再试一次，减少「排了一半就报错」 */
export async function persistCollectionTreeLayoutRemoteWithRetry(
  nodes: Collection[]
): Promise<boolean> {
  const run = () => persistCollectionTreeLayoutRemote(nodes, null);
  let ok = await run();
  if (ok) return true;
  await new Promise((r) => setTimeout(r, 400));
  ok = await run();
  return ok;
}
