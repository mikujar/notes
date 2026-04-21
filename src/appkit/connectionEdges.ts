import type { Collection, NoteCard } from "../types";
import { findCardInTree } from "./collectionModel";

export type ConnectionEdge = {
  fromCol: Collection;
  fromCard: NoteCard;
  toCol: Collection;
  toCard: NoteCard;
};
export type ConnectionEdgesResult = {
  edges: ConnectionEdge[];
  truncated: boolean;
};

function nodeKey(colId: string, cardId: string) {
  return `${colId}\0${cardId}`;
}

/** 无向边键，避免 A→B 与 B→A 各画一条线 */
function undirectedPairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** 从全库 relatedRefs 收集无向连接边（含 related 与 attachment；字典序稳定朝向） */
export function collectConnectionEdges(
  cols: Collection[],
  maxEdges = Number.POSITIVE_INFINITY
): ConnectionEdgesResult {
  const seen = new Set<string>();
  const out: ConnectionEdge[] = [];
  let truncated = false;

  function pushEdge(
    fromCol: Collection,
    fromCard: NoteCard,
    toCol: Collection,
    toCard: NoteCard
  ): boolean {
    const a = nodeKey(fromCol.id, fromCard.id);
    const b = nodeKey(toCol.id, toCard.id);
    if (a === b) return false;
    const pk = undirectedPairKey(a, b);
    if (seen.has(pk)) return false;
    seen.add(pk);
    if (a < b) {
      out.push({ fromCol, fromCard, toCol, toCard });
    } else {
      out.push({
        fromCol: toCol,
        fromCard: toCard,
        toCol: fromCol,
        toCard: fromCard,
      });
    }
    if (out.length >= maxEdges) {
      truncated = true;
      return true;
    }
    return false;
  }

  function visit(nodes: Collection[]): boolean {
    for (const fromCol of nodes) {
      for (const fromCard of fromCol.cards ?? []) {
        for (const ref of fromCard.relatedRefs ?? []) {
          const hit = findCardInTree(cols, ref.colId, ref.cardId);
          if (!hit) continue;
          if (pushEdge(fromCol, fromCard, hit.col, hit.card)) return true;
        }
      }
      if (fromCol.children?.length && visit(fromCol.children)) return true;
    }
    return false;
  }

  visit(cols);
  return { edges: out, truncated };
}
