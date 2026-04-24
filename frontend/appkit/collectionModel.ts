import { htmlToPlainText } from "../noteEditor/plainHtml";
import type { Collection, NoteCard, NoteMediaItem } from "../types";
import {
  PERSISTED_WORKSPACE_ALL_ATTACHMENTS,
  PERSISTED_WORKSPACE_ALL_NOTES,
  PERSISTED_WORKSPACE_CONNECTIONS,
  PERSISTED_WORKSPACE_OVERVIEW,
  PERSISTED_WORKSPACE_REMINDERS,
} from "./workspaceStorage";

/** 侧栏不展示；「全部笔记」里新建的笔记进此合集，语义上为未归入用户自建合集 */
export const LOOSE_NOTES_COLLECTION_ID = "__loose_notes";
export const LOOSE_NOTES_DOT_COLOR = "#a8a29e";

export function createLooseNotesCollection(displayName: string): Collection {
  return {
    id: LOOSE_NOTES_COLLECTION_ID,
    name: displayName,
    dotColor: LOOSE_NOTES_DOT_COLOR,
    cards: [],
  };
}

/** 文件卡：objectKind 以 'file' 开头，属于独立的附件对象系统，不混入笔记视图 */
export function isFileCard(card: NoteCard): boolean {
  return (card.objectKind ?? "note").startsWith("file");
}

/** 「全部笔记」列表与计数：仅笔记形态（不含人物/组织/网页/文件等对象卡） */
export function isNoteForAllNotesView(card: NoteCard): boolean {
  return (card.objectKind ?? "note") === "note";
}

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
 * 合并同一合集内的卡片列表：同 id 优先用服务端对象。
 * - 若存在「仅本地已有、本包 GET 尚无」的 id（典型：乐观新建、POST 尚未进库）：**顺序跟本地**，
 *   避免慢 GET 把新卡接在末尾再随下次同步顶上去而闪动。
 * - 否则：**顺序跟服务端**（与历史行为一致，多设备 sort_order 一致）。
 */
function mergeCollectionCards(
  serverCards: NoteCard[],
  localCards: NoteCard[]
): NoteCard[] {
  const serverById = new Map(serverCards.map((c) => [c.id, c]));
  const serverIdSet = new Set(serverCards.map((c) => c.id));
  const hasPendingOnlyLocal = localCards.some((c) => !serverIdSet.has(c.id));

  if (!hasPendingOnlyLocal) {
    return serverCards;
  }

  const out: NoteCard[] = [];
  const included = new Set<string>();

  for (const lc of localCards) {
    const s = serverById.get(lc.id);
    if (s !== undefined) {
      if (!included.has(s.id)) {
        out.push(s);
        included.add(s.id);
      }
    } else {
      out.push(lc);
      included.add(lc.id);
    }
  }
  for (const s of serverCards) {
    if (!included.has(s.id)) {
      out.push(s);
      included.add(s.id);
    }
  }
  return out;
}

/**
 * 以 server 树为准，把 local 各合集中「服务端尚无同 id」的卡片按**本地顺序**并回。
 * 用于首包种子 PUT 后立刻 GET：GET 若早于用户 POST 建卡完成，可避免乐观插入被整树覆盖而消失，
 * 且避免慢网时新卡先被画在列表底部再跳到顶部。
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
    const serverCards = col.cards ?? [];
    const cards =
      localCol?.cards?.length ?
        mergeCollectionCards(serverCards, localCol.cards)
      : serverCards;
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
      if (isFileCard(card)) return;
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

export type ReminderCompletionEntry = {
  col: Collection;
  card: NoteCard;
  completedAt: string;
};

/** 曾在待办中勾选完成的卡片，按完成时间新→旧 */
export function collectReminderCompletionEntries(
  cols: Collection[]
): ReminderCompletionEntry[] {
  const out: ReminderCompletionEntry[] = [];
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      const at = card.reminderCompletedAt?.trim();
      if (at) out.push({ col, card, completedAt: at });
    }
  });
  out.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return out;
}

export type MediaAttachmentListEntry = {
  col: Collection;
  card: NoteCard;
  mediaIndex: number;
  item: NoteMediaItem;
};

/** 全库卡片附件扁平列表，新笔记优先（addedOn / 时刻），同卡按附件顺序 */
export function collectAllMediaAttachmentEntries(
  cols: Collection[]
): MediaAttachmentListEntry[] {
  const out: MediaAttachmentListEntry[] = [];
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      if (!isFileCard(card)) continue;
      const media = card.media;
      if (!media?.length) continue;
      media.forEach((item, mediaIndex) => {
        out.push({ col, card, mediaIndex, item });
      });
    }
  });
  out.sort((a, b) => {
    const dateA = a.card.addedOn ?? "";
    const dateB = b.card.addedOn ?? "";
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    const minDiff = (b.card.minutesOfDay ?? 0) - (a.card.minutesOfDay ?? 0);
    if (minDiff !== 0) return minDiff;
    if (a.col.id !== b.col.id) return a.col.id.localeCompare(b.col.id);
    if (a.card.id !== b.card.id) return a.card.id.localeCompare(b.card.id);
    return a.mediaIndex - b.mediaIndex;
  });
  return out;
}

/** 月历底部小点：该日有笔记（addedOn） */
export function datesWithNoteAddedOn(cols: Collection[]): Set<string> {
  const s = new Set<string>();
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      if (isFileCard(card)) continue;
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

/**
 * 从根到目标合集的一条链（含目标）；用于主区标题面包屑。找不到则 null。
 */
export function findCollectionPathFromRoot(
  cols: Collection[],
  id: string,
  prefix: Collection[] = []
): Collection[] | null {
  for (const c of cols) {
    const chain = [...prefix, c];
    if (c.id === id) return chain;
    if (c.children?.length) {
      const hit = findCollectionPathFromRoot(c.children, id, chain);
      if (hit) return hit;
    }
  }
  return null;
}

export function resolveActiveCollectionId(
  cols: Collection[],
  savedId: string | null
): string {
  if (savedId === PERSISTED_WORKSPACE_OVERVIEW) return "";
  if (
    savedId === PERSISTED_WORKSPACE_ALL_NOTES ||
    savedId === PERSISTED_WORKSPACE_REMINDERS ||
    savedId === PERSISTED_WORKSPACE_CONNECTIONS ||
    savedId === PERSISTED_WORKSPACE_ALL_ATTACHMENTS
  ) {
    return cols[0]?.id ?? "";
  }
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

/** 卡片跨合集移动后，修正其它笔记里指向 (fromColId, cardId) 的 relatedRefs */
export function rewireRelatedRefsAfterCardsMoved(
  cols: Collection[],
  moves: { fromColId: string; toColId: string; cardId: string }[]
): Collection[] {
  if (moves.length === 0) return cols;
  const key = (a: string, b: string) => `${a}\0${b}`;
  const match = new Map<string, string>();
  for (const m of moves) {
    match.set(key(m.fromColId, m.cardId), m.toColId);
  }
  return mapEveryCard(cols, (_col, card) => {
    const refs = card.relatedRefs;
    if (!refs?.length) return card;
    let changed = false;
    const nextRefs = refs.map((r) => {
      const to = match.get(key(r.colId, r.cardId));
      if (to !== undefined && to !== r.colId) {
        changed = true;
        return { ...r, colId: to };
      }
      return r;
    });
    if (!changed) return card;
    return { ...card, relatedRefs: nextRefs };
  });
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

/** 移除所有指向「该 cardId」的 relatedRefs（多合集下同一 id 多处出现时，删除/解链用） */
export function stripRelatedRefsToCardId(
  cols: Collection[],
  cardId: string
): Collection[] {
  return mapEveryCard(cols, (_col, card) => {
    const refs = card.relatedRefs ?? [];
    const filtered = refs.filter((r) => r.cardId !== cardId);
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
  if (colId === LOOSE_NOTES_COLLECTION_ID) return "";
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

/**
 * 删除合集前：子树内每张卡片及当时侧栏路径（用于回收站展示；恢复时 colId 会落到未归类）。
 */
export function collectCardsInSubtreeWithPathLabels(
  cols: Collection[],
  subtreeRootId: string
): { colId: string; colPathLabel: string; card: NoteCard }[] {
  const node = findCollectionById(cols, subtreeRootId);
  if (!node) return [];
  const out: { colId: string; colPathLabel: string; card: NoteCard }[] = [];
  function walk(c: Collection) {
    const label = collectionPathLabel(cols, c.id);
    for (const card of c.cards) {
      out.push({ colId: c.id, colPathLabel: label, card });
    }
    for (const ch of c.children ?? []) walk(ch);
  }
  walk(node);
  return out;
}

export function previewCardTextOneLine(text: string, maxLen = 72): string {
  const line = htmlToPlainText(text).replace(/\s+/g, " ").trim();
  if (line.length <= maxLen) return line || "（无正文）";
  return `${line.slice(0, maxLen)}…`;
}

/** 侧栏角标：含本合集 + 所有后代合集的卡片总数（与主区聚合一致） */
export function countSidebarCollectionCardBadge(c: Collection): number {
  return countCollectionSubtreeCards(c);
}

/** 侧栏分区角标等：合集子树内卡片总数 */
export function countCollectionSubtreeCards(c: Collection): number {
  /* 懒加载模式：本地 walk 受单次 limit=200 截断，只能反映"已加载进
     collections.cards 的那部分"，并非真实总数。每一层都跟 meta 的
     totalCardCount 取 max，保证侧栏 / rail 角标显示服务端真实子树总数，
     而不是部分加载后停在某个偏小数。 */
  let n = c.cards.length;
  for (const ch of c.children ?? []) n += countCollectionSubtreeCards(ch);
  if (typeof c.totalCardCount === "number" && c.totalCardCount > n) {
    return c.totalCardCount;
  }
  return n;
}

/** 按预设类型 id 在树中查找首个合集（深度优先） */
export function findCollectionByPresetType(
  cols: Collection[],
  presetTypeId: string
): Collection | undefined {
  const key = presetTypeId.trim();
  if (!key) return undefined;
  for (const c of cols) {
    if (c.presetTypeId?.trim() === key) return c;
    if (c.children?.length) {
      const f = findCollectionByPresetType(c.children, key);
      if (f) return f;
    }
  }
  return undefined;
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

/** 全树内所有「同一 cardId」的卡片同步 patch（多合集镜像） */
export function patchNoteCardByIdInTree(
  cols: Collection[],
  cardId: string,
  patcher: (card: NoteCard) => NoteCard
): Collection[] {
  return mapEveryCard(cols, (_col, card) =>
    card.id === cardId ? patcher(card) : card
  );
}

/**
 * 把某个合集的 cards 数组整体替换（递归查 id）。
 * 懒加载模式下，按需拉某合集卡片后用这个写回 collections state。
 */
export function setCollectionCardsAtId(
  cols: Collection[],
  collectionId: string,
  cards: NoteCard[]
): Collection[] {
  let changed = false;
  function visit(nodes: Collection[]): Collection[] {
    return nodes.map((n) => {
      if (n.id === collectionId) {
        changed = true;
        return { ...n, cards };
      }
      if (n.children?.length) {
        const nextChildren = visit(n.children);
        if (nextChildren !== n.children) {
          return { ...n, children: nextChildren };
        }
      }
      return n;
    });
  }
  const out = visit(cols);
  return changed ? out : cols;
}

/** 已包含该 cardId 的合集 id（含子树） */
export function collectionIdsContainingCardId(
  cols: Collection[],
  cardId: string
): Set<string> {
  const out = new Set<string>();
  walkCollections(cols, (col) => {
    if (col.cards.some((c) => c.id === cardId)) out.add(col.id);
  });
  return out;
}

/**
 * 一次遍历构建 cardId → 出现合集数 的索引。
 * 用于把"每张卡片单独 walk 整棵树"的 O(N²) 渲染降到 O(N)。
 */
export function buildCardPlacementCountIndex(
  cols: Collection[]
): Map<string, number> {
  const counts = new Map<string, number>();
  walkCollections(cols, (col) => {
    for (const c of col.cards) {
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
  });
  return counts;
}

/**
 * 全页笔记视图用：在仍包含该 `cardId` 的合集中选一个 `colId`。
 * 多合集时优先保留 URL 里的 `preferredColId`；否则优先非「未归类」，最后 `__loose_notes`。
 */
export function pickPlacementColIdForCard(
  cols: Collection[],
  cardId: string,
  preferredColId: string | null | undefined
): string | null {
  const ids = [...collectionIdsContainingCardId(cols, cardId)];
  if (ids.length === 0) return null;
  const pref = String(preferredColId || "").trim();
  if (pref && ids.includes(pref)) return pref;
  const nonLoose = ids.filter((id) => id !== LOOSE_NOTES_COLLECTION_ID);
  if (nonLoose.length > 0) return nonLoose[0];
  return ids[0];
}

/**
 * 从某一合集中去掉该笔记的一条出现（多合集镜像）。
 * 若去掉后不再出现在任何合集，则放入「未归类」合集（不存在则创建），与侧栏语义一致。
 */
export function removeCardPlacementFromTree(
  cols: Collection[],
  placementColId: string,
  cardId: string,
  looseDisplayName: string
): Collection[] {
  const before = collectionIdsContainingCardId(cols, cardId);
  if (!before.has(placementColId)) return cols;
  const sourceCol = findCollectionById(cols, placementColId);
  const cardSnapshot = sourceCol?.cards.find((c) => c.id === cardId) ?? null;
  let next = mapCollectionById(cols, placementColId, (col) => ({
    ...col,
    cards: col.cards.filter((c) => c.id !== cardId),
  }));
  const after = collectionIdsContainingCardId(next, cardId);
  if (after.size > 0) return next;
  if (!cardSnapshot) return next;
  if (!findCollectionById(next, LOOSE_NOTES_COLLECTION_ID)) {
    next = [...next, createLooseNotesCollection(looseDisplayName)];
  }
  return appendCardToCollection(
    next,
    LOOSE_NOTES_COLLECTION_ID,
    structuredClone(cardSnapshot) as NoteCard
  );
}

/** 将卡片深拷贝一份追加到目标合集（同 id；目标内已存在同 id 则不变） */
export function appendCardCopyToCollection(
  cols: Collection[],
  targetColId: string,
  card: NoteCard,
  insertAtStart: boolean
): Collection[] {
  return mapCollectionById(cols, targetColId, (col) => {
    if (col.cards.some((c) => c.id === card.id)) return col;
    const copy = structuredClone(card) as NoteCard;
    const cards = insertAtStart ? [copy, ...col.cards] : [...col.cards, copy];
    return { ...col, cards };
  });
}

/** 从全树所有非文件卡的 media[] 中移除匹配 URL 的附件（文件卡删除后级联清理引用） */
export function stripCardsMediaByUrl(
  cols: Collection[],
  url: string
): Collection[] {
  const key = url.trim();
  if (!key) return cols;
  return mapEveryCard(cols, (_col, card) => {
    if (isFileCard(card)) return card;
    const media = card.media;
    if (!media?.length) return card;
    const nextMedia = media.filter((m) => m.url?.trim() !== key);
    if (nextMedia.length === media.length) return card;
    if (nextMedia.length === 0) {
      const { media: _m, ...rest } = card;
      return rest;
    }
    return { ...card, media: nextMedia };
  });
}

/** 从全树移除所有该 cardId 的卡片行 */
export function removeCardIdFromAllCollections(
  cols: Collection[],
  cardId: string
): Collection[] {
  function rec(nodes: Collection[]): Collection[] {
    return nodes.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => c.id !== cardId),
      children: col.children?.length ? rec(col.children) : undefined,
    }));
  }
  return rec(cols);
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
/** 从某一合集的列表里去掉指定卡片（若存在），避免多合集归属时拖拽重复插入 */
export function removeCardIdFromCollectionCards(
  cols: Collection[],
  colId: string,
  cardId: string
): Collection[] {
  return mapCollectionById(cols, colId, (col) => ({
    ...col,
    cards: col.cards.filter((c) => c.id !== cardId),
  }));
}

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

export function prependCardToCollection(
  cols: Collection[],
  colId: string,
  card: NoteCard
): Collection[] {
  return mapCollectionById(cols, colId, (col) => ({
    ...col,
    cards: [card, ...col.cards],
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
