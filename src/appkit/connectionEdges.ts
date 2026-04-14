import type { Collection, NoteCard } from "../types";
import { findCardInTree, walkCollections } from "./collectionModel";

export type ConnectionEdge = {
  fromCol: Collection;
  fromCard: NoteCard;
  toCol: Collection;
  toCard: NoteCard;
};

function nodeKey(colId: string, cardId: string) {
  return `${colId}\0${cardId}`;
}

/** 无向边键，避免 A→B 与 B→A 各画一条线 */
function undirectedPairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/** 从全库 relatedRefs 收集无向连接边（字典序稳定朝向） */
export function collectConnectionEdges(cols: Collection[]): ConnectionEdge[] {
  const raw: ConnectionEdge[] = [];
  walkCollections(cols, (fromCol) => {
    for (const fromCard of fromCol.cards) {
      for (const ref of fromCard.relatedRefs ?? []) {
        const hit = findCardInTree(cols, ref.colId, ref.cardId);
        if (hit) {
          raw.push({ fromCol, fromCard, toCol: hit.col, toCard: hit.card });
        }
      }
    }
  });
  const seen = new Set<string>();
  const out: ConnectionEdge[] = [];
  for (const e of raw) {
    const a = nodeKey(e.fromCol.id, e.fromCard.id);
    const b = nodeKey(e.toCol.id, e.toCard.id);
    if (a === b) continue;
    const pk = undirectedPairKey(a, b);
    if (seen.has(pk)) continue;
    seen.add(pk);
    if (a < b) {
      out.push(e);
    } else {
      out.push({
        fromCol: e.toCol,
        fromCard: e.toCard,
        toCol: e.fromCol,
        toCard: e.fromCard,
      });
    }
  }
  return out;
}
