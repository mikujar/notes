import { htmlToPlainText } from "../noteEditor/plainHtml";
import type { Collection, NoteCard } from "../types";

export function walkCollections(
  cols: Collection[],
  visit: (c: Collection) => void
): void {
  for (const c of cols) {
    visit(c);
    if (c.children?.length) walkCollections(c.children, visit);
  }
}

/**
 * 以 server 树为准，把 local 各合集中「服务端尚无同 id」的卡片追加回去。
 * 用于首包种子 PUT 后立刻 GET：GET 若早于用户 POST 建卡完成，可避免乐观插入被整树覆盖而消失。
 */
export function mergeServerTreeWithLocalExtraCards(
  serverTree: Collection[],
  localTree: Collection[]
): Collection[] {
  const localById = new Map<string, Collection>();
  walkCollections(localTree, (c) => {
    localById.set(c.id, c);
  });

  function mergeCol(col: Collection): Collection {
    const mergedChildren = col.children?.length
      ? col.children.map(mergeCol)
      : col.children;
    const localCol = localById.get(col.id);
    let cards = col.cards ?? [];
    if (localCol?.cards?.length) {
      const haveIds = new Set(cards.map((c) => c.id));
      const extra = (localCol.cards ?? []).filter((c) => !haveIds.has(c.id));
      if (extra.length) cards = [...cards, ...extra];
    }
    return {
      ...col,
      ...(mergedChildren !== undefined ? { children: mergedChildren } : {}),
      cards,
    };
  }

  return serverTree.map(mergeCol);
}

/** 去掉已删除合集的折叠记录，避免 Set 无限增长 */
export function pruneCollapsedFolderIds(
  cols: Collection[],
  saved: Set<string>
): Set<string> {
  if (saved.size === 0) return new Set();
  const valid = new Set<string>();
  walkCollections(cols, (c) => valid.add(c.id));
  return new Set([...saved].filter((id) => valid.has(id)));
}

/** 全库卡片标签去重，中文排序，供侧栏底部展示 */
export function collectAllTagsFromCollections(cols: Collection[]): string[] {
  const seen = new Set<string>();
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      for (const raw of card.tags ?? []) {
        const t = raw.trim();
        if (t) seen.add(t);
      }
    }
  });
  return [...seen].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function collectCardsOnDate(
  cols: Collection[],
  date: string
): { col: Collection; card: NoteCard; order: number }[] {
  const out: {
    col: Collection;
    card: NoteCard;
    colWalkSeq: number;
    order: number;
  }[] = [];
  let colWalkSeq = 0;
  walkCollections(cols, (col) => {
    col.cards.forEach((card, order) => {
      if (card.addedOn === date) {
        out.push({ col, card, colWalkSeq, order });
      }
    });
    colWalkSeq++;
  });
  out.sort((a, b) => {
    if (a.colWalkSeq !== b.colWalkSeq) return a.colWalkSeq - b.colWalkSeq;
    return a.order - b.order;
  });
  return out.map(({ col, card, order }) => ({ col, card, order }));
}

export function collectReminderCardsOnDate(
  cols: Collection[],
  date: string
): { col: Collection; card: NoteCard; order: number }[] {
  const out: {
    col: Collection;
    card: NoteCard;
    colWalkSeq: number;
    order: number;
  }[] = [];
  let colWalkSeq = 0;
  walkCollections(cols, (col) => {
    col.cards.forEach((card, order) => {
      if (card.reminderOn === date) {
        out.push({ col, card, colWalkSeq, order });
      }
    });
    colWalkSeq++;
  });
  out.sort((a, b) => {
    if (a.colWalkSeq !== b.colWalkSeq) return a.colWalkSeq - b.colWalkSeq;
    return a.order - b.order;
  });
  return out.map(({ col, card, order }) => ({ col, card, order }));
}

export type ReminderListEntry = {
  col: Collection;
  card: NoteCard;
  reminderOn: string;
};

/** 全部带提醒日的卡片，按提醒日期、再按笔记时刻排序 */
export function collectAllReminderEntries(
  cols: Collection[]
): ReminderListEntry[] {
  const out: ReminderListEntry[] = [];
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      const r = card.reminderOn?.trim();
      if (!r) continue;
      out.push({ col, card, reminderOn: r });
    }
  });
  out.sort((a, b) => {
    const c = a.reminderOn.localeCompare(b.reminderOn);
    if (c !== 0) return c;
    return (a.card.minutesOfDay ?? 0) - (b.card.minutesOfDay ?? 0);
  });
  return out;
}

/** 月历底部小点：该日有笔记（addedOn） */
export function datesWithNoteAddedOn(cols: Collection[]): Set<string> {
  const s = new Set<string>();
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      if (card.addedOn) s.add(card.addedOn);
    }
  });
  return s;
}

/** 月历角标：该日有至少一条提醒（reminderOn） */
export function datesWithReminderOn(cols: Collection[]): Set<string> {
  const s = new Set<string>();
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      if (card.reminderOn?.trim()) s.add(card.reminderOn.trim());
    }
  });
  return s;
}

/** 遍历树，附带「父名 / 子名」路径 */
export function walkCollectionsWithPath(
  nodes: Collection[],
  prefix: string[]
): { col: Collection; path: string }[] {
  const out: { col: Collection; path: string }[] = [];
  for (const c of nodes) {
    const names = [...prefix, c.name];
    out.push({ col: c, path: names.join(" / ") });
    if (c.children?.length) {
      out.push(...walkCollectionsWithPath(c.children, names));
    }
  }
  return out;
}
export function findCollectionById(
  cols: Collection[],
  id: string
): Collection | undefined {
  for (const c of cols) {
    if (c.id === id) return c;
    if (c.children?.length) {
      const f = findCollectionById(c.children, id);
      if (f) return f;
    }
  }
  return undefined;
}

export function resolveActiveCollectionId(
  cols: Collection[],
  savedId: string | null
): string {
  if (savedId && findCollectionById(cols, savedId)) return savedId;
  return cols[0]?.id ?? "";
}

export function findCardInTree(
  cols: Collection[],
  colId: string,
  cardId: string
): { col: Collection; card: NoteCard } | null {
  const col = findCollectionById(cols, colId);
  if (!col) return null;
  const card = col.cards.find((c) => c.id === cardId);
  if (!card) return null;
  return { col, card };
}

export function mapEveryCard(
  cols: Collection[],
  mapper: (col: Collection, card: NoteCard) => NoteCard
): Collection[] {
  return cols.map((c) => ({
    ...c,
    cards: c.cards.map((card) => mapper(c, card)),
    children: c.children?.length
      ? mapEveryCard(c.children, mapper)
      : undefined,
  }));
}

export function stripRelatedRefsToTarget(
  cols: Collection[],
  targetColId: string,
  targetCardId: string
): Collection[] {
  return mapEveryCard(cols, (_col, card) => {
    const refs = card.relatedRefs ?? [];
    const filtered = refs.filter(
      (r) => !(r.colId === targetColId && r.cardId === targetCardId)
    );
    if (filtered.length === refs.length) return card;
    if (filtered.length === 0) {
      const { relatedRefs: _r, ...rest } = card;
      return rest;
    }
    return { ...card, relatedRefs: filtered };
  });
}

export function addBidirectionalRelated(
  cols: Collection[],
  colIdA: string,
  cardIdA: string,
  colIdB: string,
  cardIdB: string
): Collection[] {
  if (colIdA === colIdB && cardIdA === cardIdB) return cols;
  const refToB = { colId: colIdB, cardId: cardIdB };
  const refToA = { colId: colIdA, cardId: cardIdA };
  return mapEveryCard(cols, (col, card) => {
    if (col.id === colIdA && card.id === cardIdA) {
      const refs = card.relatedRefs ?? [];
      if (
        refs.some(
          (r) => r.colId === refToB.colId && r.cardId === refToB.cardId
        )
      ) {
        return card;
      }
      return { ...card, relatedRefs: [...refs, refToB] };
    }
    if (col.id === colIdB && card.id === cardIdB) {
      const refs = card.relatedRefs ?? [];
      if (
        refs.some(
          (r) => r.colId === refToA.colId && r.cardId === refToA.cardId
        )
      ) {
        return card;
      }
      return { ...card, relatedRefs: [...refs, refToA] };
    }
    return card;
  });
}

export function removeBidirectionalRelated(
  cols: Collection[],
  colIdA: string,
  cardIdA: string,
  colIdB: string,
  cardIdB: string
): Collection[] {
  return mapEveryCard(cols, (col, card) => {
    const refs = card.relatedRefs ?? [];
    const filtered = refs.filter(
      (r) =>
        !(
          (col.id === colIdA &&
            card.id === cardIdA &&
            r.colId === colIdB &&
            r.cardId === cardIdB) ||
          (col.id === colIdB &&
            card.id === cardIdB &&
            r.colId === colIdA &&
            r.cardId === cardIdA)
        )
    );
    if (filtered.length === refs.length) return card;
    if (filtered.length === 0) {
      const { relatedRefs: _r, ...rest } = card;
      return rest;
    }
    return { ...card, relatedRefs: filtered };
  });
}

export function flattenAllCardsWithPath(
  nodes: Collection[],
  prefix: string[]
): { col: Collection; card: NoteCard; path: string }[] {
  const out: { col: Collection; card: NoteCard; path: string }[] = [];
  for (const c of nodes) {
    const names = [...prefix, c.name];
    const pathStr = names.join(" / ");
    for (const card of c.cards) {
      out.push({ col: c, card, path: pathStr });
    }
    if (c.children?.length) {
      out.push(...flattenAllCardsWithPath(c.children, names));
    }
  }
  return out;
}

export function collectionPathLabel(cols: Collection[], colId: string): string {
  function walk(nodes: Collection[], prefix: string[]): string | null {
    for (const c of nodes) {
      const names = [...prefix, c.name];
      if (c.id === colId) return names.join(" / ");
      if (c.children?.length) {
        const inner = walk(c.children, names);
        if (inner) return inner;
      }
    }
    return null;
  }
  return walk(cols, []) ?? "";
}

export function previewCardTextOneLine(text: string, maxLen = 72): string {
  const line = htmlToPlainText(text).replace(/\s+/g, " ").trim();
  if (line.length <= maxLen) return line || "（无正文）";
  return `${line.slice(0, maxLen)}…`;
}

/** 侧栏角标：仅本合集一层的小笔记张数（子合集内的笔记不计入父行，避免空文件夹拖入子文件夹后父级误显示有笔记） */
export function countSidebarCollectionCardBadge(c: Collection): number {
  return c.cards.length;
}

/** 从根到 target 的父级 id（不含 target） */
export function ancestorIdsFor(cols: Collection[], targetId: string): string[] {
  function walk(nodes: Collection[], acc: string[]): string[] | null {
    for (const n of nodes) {
      if (n.id === targetId) return acc;
      if (n.children?.length) {
        const r = walk(n.children, [...acc, n.id]);
        if (r) return r;
      }
    }
    return null;
  }
  return walk(cols, []) ?? [];
}

export function mapCollectionById(
  cols: Collection[],
  colId: string,
  fn: (c: Collection) => Collection
): Collection[] {
  return cols.map((c) => {
    if (c.id === colId) return fn(c);
    if (c.children?.length) {
      return {
        ...c,
        children: mapCollectionById(c.children, colId, fn),
      };
    }
    return c;
  });
}

export function insertChildCollection(
  cols: Collection[],
  parentId: string,
  child: Collection
): Collection[] {
  return cols.map((c) => {
    if (c.id === parentId) {
      return { ...c, children: [...(c.children ?? []), child] };
    }
    if (c.children?.length) {
      return {
        ...c,
        children: insertChildCollection(c.children, parentId, child),
      };
    }
    return c;
  });
}

/** 从合集中取出一张小笔记卡片 */
export function extractCardFromCollections(
  cols: Collection[],
  colId: string,
  cardId: string
): { next: Collection[]; card: NoteCard | null } {
  let extracted: NoteCard | null = null;
  const next = mapCollectionById(cols, colId, (col) => ({
    ...col,
    cards: col.cards.filter((c) => {
      if (c.id !== cardId) return true;
      extracted = c;
      return false;
    }),
  }));
  return { next, card: extracted };
}

export function insertCardRelativeTo(
  cols: Collection[],
  colId: string,
  card: NoteCard,
  anchorCardId: string,
  place: "before" | "after"
): Collection[] {
  return mapCollectionById(cols, colId, (col) => {
    const cards = [...col.cards];
    const ai = cards.findIndex((c) => c.id === anchorCardId);
    if (ai < 0) return { ...col, cards: [...cards, card] };
    const insertIdx = place === "before" ? ai : ai + 1;
    cards.splice(insertIdx, 0, card);
    return { ...col, cards };
  });
}
export function appendCardToCollection(
  cols: Collection[],
  colId: string,
  card: NoteCard
): Collection[] {
  return mapCollectionById(cols, colId, (col) => ({
    ...col,
    cards: [...col.cards, card],
  }));
}

export function splitPinnedCards(cards: NoteCard[]): {
  pinned: NoteCard[];
  rest: NoteCard[];
} {
  const pinned = cards.filter((c) => c.pinned);
  const rest = cards.filter((c) => !c.pinned);
  return { pinned, rest };
}
