import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FocusEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { fetchApiHealth } from "./api/health";
import { fetchCollectionsFromApi, saveCollectionsToApi } from "./api/collections";
import { uploadCardMedia } from "./api/upload";
import { resolveMediaUrl } from "./api/auth";
import {
  createUserApi,
  deleteUserApi,
  fetchUsersList,
  updateUserApi,
  uploadMyAvatar,
  type PublicUser,
} from "./api/users";
import { useAuth } from "./auth/AuthContext";
import { collections as initialCollections } from "./data";
import { migrateCollectionTree } from "./migrateCollections";
import type {
  Collection,
  NoteCard,
  NoteMediaItem,
  NoteMediaKind,
} from "./types";
import "./App.css";

const DEFAULT_COLLECTION_HINT =
  "欢迎使用 mikujar「未来罐」—— 按一天里的时刻收纳零碎笔记。";

function cloneInitialCollections(): Collection[] {
  return structuredClone(initialCollections) as Collection[];
}

function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function walkCollections(
  cols: Collection[],
  visit: (c: Collection) => void
): void {
  for (const c of cols) {
    visit(c);
    if (c.children?.length) walkCollections(c.children, visit);
  }
}

/** 全库卡片标签去重，中文排序，供侧栏底部展示 */
function collectAllTagsFromCollections(cols: Collection[]): string[] {
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

function collectCardsOnDate(
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

function datesWithNotes(cols: Collection[]): Set<string> {
  const s = new Set<string>();
  walkCollections(cols, (col) => {
    for (const card of col.cards) {
      if (card.addedOn) s.add(card.addedOn);
    }
  });
  return s;
}

/** 遍历树，附带「父名 / 子名」路径 */
function walkCollectionsWithPath(
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

function cardTextMatchesQuery(card: NoteCard, q: string): boolean {
  if (card.text.toLowerCase().includes(q)) return true;
  for (const t of card.tags ?? []) {
    if (t.toLowerCase().includes(q)) return true;
  }
  for (const m of card.media ?? []) {
    if ((m.name ?? "").toLowerCase().includes(q)) return true;
  }
  return false;
}

function buildSearchResults(
  cols: Collection[],
  qRaw: string
): {
  collectionMatches: { col: Collection; path: string }[];
  groupedCards: { col: Collection; path: string; cards: NoteCard[] }[];
} {
  const q = qRaw.trim().toLowerCase();
  if (!q) {
    return { collectionMatches: [], groupedCards: [] };
  }
  const flat = walkCollectionsWithPath(cols, []);
  const collectionMatches: { col: Collection; path: string }[] = [];
  const seenNameHit = new Set<string>();
  const cardHits: { col: Collection; path: string; card: NoteCard }[] = [];

  for (const { col, path } of flat) {
    if (col.name.toLowerCase().includes(q) && !seenNameHit.has(col.id)) {
      seenNameHit.add(col.id);
      collectionMatches.push({ col, path });
    }
    for (const card of col.cards) {
      if (cardTextMatchesQuery(card, q)) {
        cardHits.push({ col, path, card });
      }
    }
  }

  const groupMap = new Map<
    string,
    { col: Collection; path: string; cards: NoteCard[] }
  >();
  for (const h of cardHits) {
    let g = groupMap.get(h.col.id);
    if (!g) {
      g = { col: h.col, path: h.path, cards: [] };
      groupMap.set(h.col.id, g);
    }
    g.cards.push(h.card);
  }
  return {
    collectionMatches,
    groupedCards: [...groupMap.values()],
  };
}

function formatChineseDayTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const wk = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
    dt.getDay()
  ];
  return `${y}年${m}月${d}日 ${wk}`;
}

/** 侧栏月历格：周一为列首 */
function buildCalendarCells(viewMonth: Date): (null | { day: number; dateStr: string })[] {
  const y = viewMonth.getFullYear();
  const mo = viewMonth.getMonth();
  const firstDow = new Date(y, mo, 1).getDay();
  const pad = (firstDow + 6) % 7;
  const dim = new Date(y, mo + 1, 0).getDate();
  const cells: (null | { day: number; dateStr: string })[] = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) {
    cells.push({
      day: d,
      dateStr: localDateString(new Date(y, mo, d)),
    });
  }
  return cells;
}

/** HH:mm，与横格行高无关，仅用于卡片角标 */
function formatClock(minutesOfDay: number) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 卡片左上角：按 addedOn 显示「今天 / 昨天 / M月D日」+ 时刻 */
function formatCardTimeLabel(card: NoteCard) {
  const clock = formatClock(card.minutesOfDay);
  const added = card.addedOn;
  if (!added) return `今天 ${clock}`;
  const today = localDateString();
  if (added === today) return `今天 ${clock}`;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (added === localDateString(yest)) return `昨天 ${clock}`;
  const [, mm, dd] = added.split("-");
  return `${Number(mm)}月${Number(dd)}日 ${clock}`;
}

/** 新建合集侧栏圆点：随机色相，饱和度与亮度控制在易辨认、不过分刺眼 */
function randomDotColor(): string {
  const h = Math.floor(Math.random() * 360);
  const s = 48 + Math.floor(Math.random() * 28);
  const l = 48 + Math.floor(Math.random() * 14);
  return `hsl(${h} ${s}% ${l}%)`;
}

function findCollectionById(
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

function findCardInTree(
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

function mapEveryCard(
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

function stripRelatedRefsToTarget(
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

function addBidirectionalRelated(
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

function removeBidirectionalRelated(
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

function flattenAllCardsWithPath(
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

function collectionPathLabel(cols: Collection[], colId: string): string {
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

function previewCardTextOneLine(text: string, maxLen = 72): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= maxLen) return line || "（无正文）";
  return `${line.slice(0, maxLen)}…`;
}

/** 侧栏角标：本合集及子树内小笔记总张数 */
function countCardsInCollectionSubtree(c: Collection): number {
  const own = c.cards.length;
  const sub = (c.children ?? []).reduce(
    (n, ch) => n + countCardsInCollectionSubtree(ch),
    0
  );
  return own + sub;
}

/** 从根到 target 的父级 id（不含 target） */
function ancestorIdsFor(cols: Collection[], targetId: string): string[] {
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

function mapCollectionById(
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

function insertChildCollection(
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
function extractCardFromCollections(
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

function insertCardRelativeTo(
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

type NoteCardDragPayload = {
  colId: string;
  cardId: string;
};

type NoteCardDropTarget =
  | { type: "before"; colId: string; cardId: string }
  | { type: "after"; colId: string; cardId: string }
  | { type: "collection"; colId: string };

const NOTE_CARD_DRAG_MIME = "application/x-mikujar-note-card";
const NOTE_CARD_TEXT_PREFIX = "mikujar-note-card:";

function noteCardDragTypesInclude(dt: DataTransfer): boolean {
  const want = NOTE_CARD_DRAG_MIME.toLowerCase();
  return [...dt.types].some((t) => t.toLowerCase() === want);
}

function readNoteCardDragPayload(e: DragEvent): NoteCardDragPayload | null {
  const dt = e.dataTransfer;
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

function applyNoteCardDrop(
  prev: Collection[],
  from: NoteCardDragPayload,
  to: NoteCardDropTarget
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
    return appendCardToCollection(next, to.colId, card);
  }

  const place = to.type === "before" ? "before" : "after";
  const toCol = findCollectionById(next, to.colId);
  const anchor = toCol?.cards.find((c) => c.id === to.cardId);
  if (!anchor) return appendCardToCollection(next, to.colId, card);

  return insertCardRelativeTo(next, to.colId, card, to.cardId, place);
}

function appendCardToCollection(
  cols: Collection[],
  colId: string,
  card: NoteCard
): Collection[] {
  return mapCollectionById(cols, colId, (col) => ({
    ...col,
    cards: [...col.cards, card],
  }));
}

const COLLECTION_DRAG_MIME = "application/x-note-collection";

type CollectionDropPosition = "before" | "after" | "inside";

function removeCollectionFromTree(
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

function collectSubtreeCollectionIds(root: Collection): string[] {
  const out = [root.id];
  for (const ch of root.children ?? []) {
    out.push(...collectSubtreeCollectionIds(ch));
  }
  return out;
}

function findParentAndIndex(
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

function isTargetUnderDragNode(
  dragNode: Collection,
  targetId: string
): boolean {
  function walk(n: Collection): boolean {
    if (n.id === targetId) return true;
    return n.children?.some(walk) ?? false;
  }
  return dragNode.children?.some(walk) ?? false;
}

function insertCollectionRelative(
  cols: Collection[],
  targetId: string,
  node: Collection,
  position: CollectionDropPosition
): Collection[] {
  if (position === "inside") {
    return mapCollectionById(cols, targetId, (t) => ({
      ...t,
      children: [node, ...(t.children ?? [])],
    }));
  }

  const info = findParentAndIndex(cols, targetId);
  if (!info) return cols;

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

function moveCollectionInTree(
  cols: Collection[],
  dragId: string,
  targetId: string,
  position: CollectionDropPosition
): Collection[] {
  if (dragId === targetId) return cols;

  const dragNode = findCollectionById(cols, dragId);
  if (!dragNode) return cols;
  if (isTargetUnderDragNode(dragNode, targetId)) return cols;

  const { tree: without, removed } = removeCollectionFromTree(
    cols,
    dragId
  );
  if (!removed) return cols;

  return insertCollectionRelative(
    without,
    targetId,
    removed,
    position
  );
}

function dropPositionFromEvent(
  e: DragEvent,
  el: HTMLElement
): CollectionDropPosition {
  const r = el.getBoundingClientRect();
  const y = e.clientY - r.top;
  const h = Math.max(r.height, 1);
  if (y < h * 0.28) return "before";
  if (y > h * 0.72) return "after";
  return "inside";
}

/** 置顶在上，其余保持合集内 cards 数组顺序（不按时刻排序） */
function splitPinnedCards(cards: NoteCard[]): {
  pinned: NoteCard[];
  rest: NoteCard[];
} {
  const pinned = cards.filter((c) => c.pinned);
  const rest = cards.filter((c) => !c.pinned);
  return { pinned, rest };
}

/** 从剪贴板或拖拽 DataTransfer 取出文件（含截图粘贴等） */
function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files?.length) return Array.from(dt.files);
  const items = dt.items;
  if (!items?.length) return [];
  const out: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it?.kind === "file") {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  if (!dt?.types) return false;
  return [...dt.types].some(
    (t) => t === "Files" || t.startsWith("image/")
  );
}

/** 将上传接口结果转为 NoteMediaItem */
function mediaItemFromUploadResult(r: {
  url: string;
  kind: NoteMediaKind;
  name?: string;
  coverUrl?: string;
}): NoteMediaItem {
  return {
    kind: r.kind,
    url: r.url,
    ...(r.name?.trim() ? { name: r.name.trim() } : {}),
    ...(r.kind === "audio" && r.coverUrl?.trim()
      ? { coverUrl: r.coverUrl.trim() }
      : {}),
  };
}

/** 仅允许 http(s)，避免 javascript: 等 */
function safeHttpUrlHref(raw: string): string | null {
  const t = raw.trim();
  const withScheme = /^www\./i.test(t) ? `https://${t}` : t;
  if (!/^https?:\/\//i.test(withScheme)) return null;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function splitTextWithUrls(text: string): Array<
  { type: "text"; value: string } | { type: "url"; value: string; href: string }
> {
  const re = /https?:\/\/[^\s<>"'`[\]{}|\\^]+|www\.[^\s<>"'`[\]{}|\\^]+/gi;
  const out: Array<
    { type: "text"; value: string } | { type: "url"; value: string; href: string }
  > = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const full = m[0];
    const trimmed = full.replace(/[.,;:!?)\]'"""»«\]]+$/u, "") || full;
    const href = safeHttpUrlHref(trimmed);
    if (start > last) {
      out.push({ type: "text", value: text.slice(last, start) });
    }
    const end = start + full.length;
    if (href) {
      out.push({ type: "url", value: trimmed, href });
      const tail = full.slice(trimmed.length);
      if (tail) out.push({ type: "text", value: tail });
    } else {
      out.push({ type: "text", value: full });
    }
    last = end;
  }
  if (last < text.length) {
    out.push({ type: "text", value: text.slice(last) });
  }
  return out;
}

function CardTextWithLinkPieces({ text }: { text: string }) {
  const parts = useMemo(() => splitTextWithUrls(text), [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "url" ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {p.value}
          </a>
        ) : (
          <Fragment key={i}>{p.value}</Fragment>
        )
      )}
    </>
  );
}

/** 可编辑时未聚焦为可点链接预览，点正文进入编辑；只读时始终为可点链接 */
function NoteCardBodyText({
  id,
  value,
  onChange,
  canEdit,
  minRows = 3,
  ariaLabel = "笔记正文",
  onPaste,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  canEdit: boolean;
  minRows?: number;
  ariaLabel?: string;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
    }
  }, [editing]);

  if (!canEdit) {
    return (
      <div id={id} className="card__text card__text--readonly" aria-label={ariaLabel}>
        <CardTextWithLinkPieces text={value} />
      </div>
    );
  }

  if (editing) {
    return (
      <AutoHeightTextarea
        ref={taRef}
        id={id}
        className="card__text"
        value={value}
        minRows={minRows}
        ariaLabel={ariaLabel}
        readOnly={false}
        onChange={onChange}
        onPaste={onPaste}
        onBlur={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      id={id}
      role="textbox"
      tabIndex={0}
      aria-multiline="true"
      aria-label={ariaLabel}
      className="card__text card__text--readonly card__text--preview"
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("a")) return;
        const sel = typeof window !== "undefined" ? window.getSelection()?.toString() ?? "" : "";
        if (sel.length > 0) return;
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target as HTMLElement).closest("a")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      <CardTextWithLinkPieces text={value} />
    </div>
  );
}

type AutoHeightTextareaProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void;
};

/** 高度随内容增高，并按行高取整，与横格背景对齐 */
const AutoHeightTextarea = forwardRef<HTMLTextAreaElement, AutoHeightTextareaProps>(
  function AutoHeightTextarea(
    {
      id,
      value,
      onChange,
      placeholder,
      minRows = 3,
      className,
      ariaLabel,
      readOnly,
      onPaste: onPasteExtra,
      onBlur,
    },
    forwardedRef
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        innerRef.current = el;
        if (typeof forwardedRef === "function") {
          forwardedRef(el);
        } else if (forwardedRef) {
          forwardedRef.current = el;
        }
      },
      [forwardedRef]
    );

    const syncHeight = useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const lineHeight = Number.isFinite(lh) && lh > 0 ? lh : 30;
      el.style.height = "0px";
      const contentH = el.scrollHeight;
      const lines = Math.max(minRows, Math.ceil(contentH / lineHeight));
      el.style.height = `${lines * lineHeight}px`;
    }, [minRows]);

    useLayoutEffect(() => {
      syncHeight();
    }, [value, syncHeight]);

    return (
      <textarea
        ref={setRefs}
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        rows={minRows}
        spellCheck={false}
        readOnly={readOnly}
        aria-label={ariaLabel ?? "笔记正文"}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          onPasteExtra?.(e);
        }}
        onBlur={onBlur}
      />
    );
  }
);

function formatTagsForInput(tags: string[] | undefined): string {
  return (tags ?? []).join("，");
}

function parseTagsFromInput(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function CardTagsRow({
  colId,
  card,
  canEdit,
  onCommit,
}: {
  colId: string;
  card: NoteCard;
  canEdit: boolean;
  onCommit: (colId: string, cardId: string, tags: string[]) => void;
}) {
  const tags = card.tags ?? [];
  const tagsKey = tags.join("\u0001");
  const [draft, setDraft] = useState(() => formatTagsForInput(tags));

  useEffect(() => {
    setDraft(formatTagsForInput(tags));
  }, [card.id, tagsKey]);

  if (!canEdit && tags.length === 0) return null;

  return (
    <div className="card__tags-row">
      <span className="card__tags-label">标签：</span>
      {canEdit ? (
        <input
          type="text"
          className="card__tags-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() =>
            onCommit(colId, card.id, parseTagsFromInput(draft))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="标签"
        />
      ) : (
        <span className="card__tags-view">{formatTagsForInput(tags)}</span>
      )}
    </div>
  );
}

function fileLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return "文件";
    return decodeURIComponent(last.replace(/\+/g, " "));
  } catch {
    return "文件";
  }
}

function FileDocIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}

function AudioGlyphIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

/** 侧栏管理：登录=锁，已登录=退出箭头 */
function AdminHeaderIcon({ mode }: { mode: "login" | "logout" }) {
  const cls = "sidebar__admin-icon-svg";
  if (mode === "login") {
    return (
      <svg
        className={cls}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="5" y="11" width="14" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  }
  return (
    <svg
      className={cls}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

type LightboxState = {
  url: string;
  kind: NoteMediaKind;
  name?: string;
  coverUrl?: string;
};

/** 卡片右侧媒体轮播：悬停箭头；多段时角标与圆点；单击全屏查看/播放；右键删除单项 */
function CardGallery({
  items,
  onRemoveItem,
}: {
  items: NoteMediaItem[];
  onRemoveItem?: (item: NoteMediaItem) => void;
}) {
  const [i, setI] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [attachMenu, setAttachMenu] = useState<{
    x: number;
    y: number;
    item: NoteMediaItem;
  } | null>(null);
  const n = items.length;

  const itemsKey = items
    .map(
      (x) =>
        `${x.kind}:${x.url}:${x.name ?? ""}:${x.coverUrl ?? ""}`
    )
    .join("|");
  useEffect(() => {
    setI((prev) => {
      if (n === 0) return 0;
      return Math.min(prev, n - 1);
    });
  }, [n, itemsKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (attachMenu) {
        e.preventDefault();
        setAttachMenu(null);
        return;
      }
      if (lightbox) setLightbox(null);
    };
    if (!attachMenu && !lightbox) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [attachMenu, lightbox]);

  useEffect(() => {
    if (!attachMenu) return;
    const onDown = (e: PointerEvent) => {
      const el = document.querySelector("[data-attachment-ctx-menu]");
      if (el?.contains(e.target as Node)) return;
      setAttachMenu(null);
    };
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [attachMenu]);

  useEffect(() => {
    if (!lightbox) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightbox]);

  if (n === 0) return null;

  const safeI = ((i % n) + n) % n;
  const current = items[safeI];
  const go = (delta: number) => {
    setI((x) => (x + delta + n * 100) % n);
  };

  const openCurrentLightbox = () => {
    setLightbox({
      url: current.url,
      kind: current.kind,
      name: current.name ?? fileLabelFromUrl(current.url),
      ...(current.kind === "audio" && current.coverUrl
        ? { coverUrl: current.coverUrl }
        : {}),
    });
  };

  const openAttachmentMenu = (
    e: MouseEvent<HTMLElement>,
    item: NoteMediaItem
  ) => {
    if (!onRemoveItem) return;
    e.preventDefault();
    e.stopPropagation();
    setAttachMenu({ x: e.clientX, y: e.clientY, item });
  };

  const lightboxAsItem = (): NoteMediaItem | null => {
    if (!lightbox) return null;
    if (lightbox.kind === "file") {
      return {
        kind: "file",
        url: lightbox.url,
        name: lightbox.name ?? fileLabelFromUrl(lightbox.url),
      };
    }
    if (lightbox.kind === "audio") {
      const name = lightbox.name ?? fileLabelFromUrl(lightbox.url);
      return {
        kind: "audio",
        url: lightbox.url,
        name,
        ...(lightbox.coverUrl ? { coverUrl: lightbox.coverUrl } : {}),
      };
    }
    if (lightbox.kind === "image" || lightbox.kind === "video") {
      const name = lightbox.name ?? fileLabelFromUrl(lightbox.url);
      return { kind: lightbox.kind, url: lightbox.url, name };
    }
    return { kind: lightbox.kind, url: lightbox.url };
  };

  const lightboxPortal =
    lightbox &&
    createPortal(
      <div
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="预览"
        onClick={() => setLightbox(null)}
      >
        <button
          type="button"
          className="image-lightbox__close"
          aria-label="关闭"
          onClick={(e) => {
            e.stopPropagation();
            setLightbox(null);
          }}
        >
          ×
        </button>
        {lightbox.kind === "image" ? (
          <div
            className="image-lightbox__media-stack"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              const it = lightboxAsItem();
              if (it) openAttachmentMenu(e, it);
            }}
          >
            <img
              src={lightbox.url}
              alt=""
              className="image-lightbox__img"
            />
            <p className="image-lightbox__media-caption">
              {lightbox.name ?? fileLabelFromUrl(lightbox.url)}
            </p>
          </div>
        ) : lightbox.kind === "video" ? (
          <div
            className="image-lightbox__media-stack"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              const it = lightboxAsItem();
              if (it) openAttachmentMenu(e, it);
            }}
          >
            <video
              key={lightbox.url}
              src={lightbox.url}
              className="image-lightbox__img image-lightbox__video"
              controls
              playsInline
              autoPlay
            />
            <p className="image-lightbox__media-caption">
              {lightbox.name ?? fileLabelFromUrl(lightbox.url)}
            </p>
          </div>
        ) : lightbox.kind === "audio" ? (
          <div
            className="image-lightbox__audio-wrap"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              const it = lightboxAsItem();
              if (it) openAttachmentMenu(e, it);
            }}
          >
            {lightbox.coverUrl ? (
              <img
                src={lightbox.coverUrl}
                alt=""
                className="image-lightbox__audio-cover"
              />
            ) : null}
            <p className="image-lightbox__audio-title">
              {lightbox.name ?? fileLabelFromUrl(lightbox.url)}
            </p>
            <audio
              key={lightbox.url}
              src={lightbox.url}
              controls
              autoPlay
              className="image-lightbox__audio"
            />
          </div>
        ) : (
          <div
            className="image-lightbox__file"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              const it = lightboxAsItem();
              if (it) openAttachmentMenu(e, it);
            }}
          >
            <FileDocIcon className="image-lightbox__file-icon" />
            <p className="image-lightbox__file-name">
              {lightbox.name ?? fileLabelFromUrl(lightbox.url)}
            </p>
            <a
              href={lightbox.url}
              target="_blank"
              rel="noopener noreferrer"
              className="image-lightbox__file-link"
            >
              在新窗口打开
            </a>
          </div>
        )}
      </div>,
      document.body
    );

  const attachMenuPortal =
    attachMenu &&
    onRemoveItem &&
    createPortal(
      <div
        data-attachment-ctx-menu
        className="attachment-ctx-menu"
        style={{
          position: "fixed",
          left: Math.min(
            attachMenu.x,
            typeof window !== "undefined"
              ? window.innerWidth - 148
              : attachMenu.x
          ),
          top: attachMenu.y,
          zIndex: 10001,
        }}
        role="menu"
      >
        <button
          type="button"
          className="attachment-ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onRemoveItem(attachMenu.item);
            setAttachMenu(null);
            setLightbox(null);
          }}
        >
          删除附件
        </button>
      </div>,
      document.body
    );

  return (
    <div className="card__gallery">
      {lightboxPortal}
      {attachMenuPortal}
      <div className="card__gallery-viewport">
        <div
          className={
            "card__gallery-thumb-hit" +
            (current.kind === "file"
              ? " card__gallery-thumb-hit--file"
              : current.kind === "audio"
                ? " card__gallery-thumb-hit--audio"
                : "")
          }
          role="button"
          tabIndex={0}
          title={
            onRemoveItem
              ? current.kind === "file"
                ? "点击查看，右键可删除"
                : current.kind === "audio"
                  ? "点击放大播放音频，右键可删除"
                  : "点击放大，右键可删除"
              : current.kind === "file"
                ? "点击查看"
                : current.kind === "audio"
                  ? "点击放大播放音频"
                  : "点击放大"
          }
          aria-label={
            current.kind === "video"
              ? "点击放大播放视频"
              : current.kind === "image"
                ? "点击放大查看图片"
                : current.kind === "audio"
                  ? "点击放大播放音频"
                  : "查看文件"
          }
          onClick={(e) => {
            e.stopPropagation();
            openCurrentLightbox();
          }}
          onContextMenu={(e) => {
            if (onRemoveItem) openAttachmentMenu(e, current);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              openCurrentLightbox();
            }
          }}
        >
          {current.kind === "image" ? (
            <img
              src={current.url}
              alt=""
              loading="lazy"
              decoding="async"
              className="card__gallery-thumb"
            />
          ) : current.kind === "audio" ? (
            <>
              <div className="card__gallery-audio-thumb">
                {current.coverUrl ? (
                  <>
                    <img
                      src={current.coverUrl}
                      alt=""
                      className="card__gallery-audio-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    <div
                      className="card__gallery-audio-cover-scrim"
                      aria-hidden
                    />
                    <span className="card__gallery-audio-name card__gallery-audio-name--on-cover">
                      {current.name ?? fileLabelFromUrl(current.url)}
                    </span>
                  </>
                ) : (
                  <>
                    <AudioGlyphIcon className="card__gallery-audio-icon" />
                    <span className="card__gallery-audio-name">
                      {current.name ?? fileLabelFromUrl(current.url)}
                    </span>
                  </>
                )}
              </div>
              <span className="card__gallery-play-badge" aria-hidden>
                ▶
              </span>
            </>
          ) : current.kind === "video" ? (
            <>
              <video
                className="card__gallery-thumb card__gallery-thumb--video"
                src={current.url}
                muted
                playsInline
                preload="metadata"
                tabIndex={-1}
                aria-hidden
              />
              <span className="card__gallery-play-badge" aria-hidden>
                ▶
              </span>
            </>
          ) : (
            <div className="card__gallery-file">
              <FileDocIcon className="card__gallery-file-icon" />
              <span className="card__gallery-file-name">
                {current.name ?? fileLabelFromUrl(current.url)}
              </span>
            </div>
          )}
        </div>
        {n > 1 ? (
          <span className="card__gallery-count">
            {safeI + 1}/{n}
          </span>
        ) : null}
        {n > 1 ? (
          <>
            <button
              type="button"
              className="card__gallery-arrow card__gallery-arrow--prev"
              aria-label="上一项"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
            />
            <button
              type="button"
              className="card__gallery-arrow card__gallery-arrow--next"
              aria-label="下一项"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
            />
          </>
        ) : null}
        {n > 1 ? (
          <div
            className="card__gallery-dots"
            role="tablist"
            aria-label="分页"
          >
            {items.map((_, idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={idx === safeI}
                className={
                  "card__gallery-dot" +
                  (idx === safeI ? " is-active" : "")
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setI(idx);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RelatedCardsSidePanel({
  sourceColId,
  sourceCardId,
  collections,
  canEdit,
  onClose,
  onRemoveRelation,
  onAddRelation,
  onNavigateToCard,
}: {
  sourceColId: string;
  sourceCardId: string;
  collections: Collection[];
  canEdit: boolean;
  onClose: () => void;
  onRemoveRelation: (targetColId: string, targetCardId: string) => void;
  onAddRelation: (targetColId: string, targetCardId: string) => void;
  onNavigateToCard: (targetColId: string, targetCardId: string) => void;
}) {
  const [pickQuery, setPickQuery] = useState("");
  const source = findCardInTree(collections, sourceColId, sourceCardId);

  useEffect(() => {
    setPickQuery("");
  }, [sourceColId, sourceCardId]);

  const relatedList = useMemo(() => {
    if (!source) return [];
    const refs = source.card.relatedRefs ?? [];
    return refs.map((ref) => {
      const hit = findCardInTree(collections, ref.colId, ref.cardId);
      return { ref, hit };
    });
  }, [source, collections]);

  const pickCandidates = useMemo(() => {
    const flat = flattenAllCardsWithPath(collections, []);
    const q = pickQuery.trim().toLowerCase();
    const relatedSet = new Set(
      (source?.card.relatedRefs ?? []).map(
        (r) => `${r.colId}\0${r.cardId}`
      )
    );
    relatedSet.add(`${sourceColId}\0${sourceCardId}`);
    const filtered = flat.filter(({ col, card }) => {
      if (relatedSet.has(`${col.id}\0${card.id}`)) return false;
      if (!q) return true;
      return (
        card.text.toLowerCase().includes(q) ||
        (card.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        col.name.toLowerCase().includes(q)
      );
    });
    return filtered.slice(0, 24);
  }, [collections, pickQuery, source, sourceColId, sourceCardId]);

  return (
    <div className="related-panel-mount">
      <div
        className="related-panel-backdrop"
        aria-hidden
        onClick={onClose}
      />
      <aside
        className="related-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="related-panel-title"
      >
        <div className="related-panel__head">
          <h2 id="related-panel-title" className="related-panel__title">
            相关笔记
          </h2>
          <button
            type="button"
            className="related-panel__close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="related-panel__body">
          {!source ? (
            <p className="related-panel__hint">源笔记已不存在。</p>
          ) : (
            <>
              {relatedList.length === 0 ? (
                <p className="related-panel__hint">暂无关联卡片。</p>
              ) : (
                <ul className="related-panel__list">
                  {relatedList.map(({ ref, hit }) => (
                    <li
                      key={`${ref.colId}-${ref.cardId}`}
                      className="related-panel__item"
                    >
                      {hit ? (
                        <>
                          <div className="related-panel__item-path">
                            {collectionPathLabel(collections, hit.col.id)}
                          </div>
                          <div className="related-panel__item-text">
                            {previewCardTextOneLine(hit.card.text)}
                          </div>
                          <div className="related-panel__item-actions">
                            <button
                              type="button"
                              className="related-panel__btn related-panel__btn--primary"
                              onClick={() =>
                                onNavigateToCard(hit.col.id, hit.card.id)
                              }
                            >
                              查看
                            </button>
                            {canEdit ? (
                              <button
                                type="button"
                                className="related-panel__btn"
                                onClick={() =>
                                  onRemoveRelation(ref.colId, ref.cardId)
                                }
                              >
                                取消关联
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <div className="related-panel__missing-wrap">
                          <p className="related-panel__missing">
                            笔记已删除或不可用
                          </p>
                          {canEdit ? (
                            <button
                              type="button"
                              className="related-panel__btn"
                              onClick={() =>
                                onRemoveRelation(ref.colId, ref.cardId)
                              }
                            >
                              移除无效关联
                            </button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <div className="related-panel__add">
                  <p className="related-panel__add-label">添加关联</p>
                  <input
                    type="text"
                    className="related-panel__add-input"
                    placeholder="搜索笔记…"
                    value={pickQuery}
                    onChange={(e) => setPickQuery(e.target.value)}
                    autoComplete="off"
                  />
                  {pickCandidates.length > 0 ? (
                    <ul className="related-panel__pick-list">
                      {pickCandidates.map(({ col, card, path }) => (
                        <li key={`${col.id}-${card.id}`}>
                          <button
                            type="button"
                            className="related-panel__pick-row"
                            onClick={() => {
                              onAddRelation(col.id, card.id);
                              setPickQuery("");
                            }}
                          >
                            <span className="related-panel__pick-path">
                              {path}
                            </span>
                            <span className="related-panel__pick-text">
                              {previewCardTextOneLine(card.text, 48)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : pickQuery.trim() ? (
                    <p className="related-panel__hint">无匹配笔记</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  const {
    isAdmin,
    authReady,
    writeRequiresLogin,
    openLogin,
    logout,
    currentUser,
    refreshMe,
  } = useAuth();

  const canEdit = useMemo(
    () => !writeRequiresLogin || Boolean(currentUser),
    [writeRequiresLogin, currentUser]
  );

  const [collections, setCollections] = useState<Collection[]>(() =>
    cloneInitialCollections()
  );
  const [activeId, setActiveId] = useState(
    () => initialCollections[0]?.id ?? ""
  );
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [collectionCtxMenu, setCollectionCtxMenu] = useState<{
    x: number;
    y: number;
    id: string;
    name: string;
    hasChildren: boolean;
  } | null>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<
    string | null
  >(null);
  const [draftCollectionName, setDraftCollectionName] = useState("");
  const collectionNameInputRef = useRef<HTMLInputElement>(null);
  const skipCollectionBlurCommitRef = useRef(false);
  const [editingHintCollectionId, setEditingHintCollectionId] = useState<
    string | null
  >(null);
  const [draftCollectionHint, setDraftCollectionHint] = useState("");
  const collectionHintTextareaRef = useRef<HTMLTextAreaElement>(null);
  const skipHintBlurCommitRef = useRef(false);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => new Set()
  );
  const [draggingCollectionId, setDraggingCollectionId] = useState<
    string | null
  >(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    position: CollectionDropPosition;
  } | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [apiOnline, setApiOnline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mediaUploadMode, setMediaUploadMode] = useState<
    "cos" | "local" | null
  >(null);
  const [uploadBusyCardId, setUploadBusyCardId] = useState<string | null>(
    null
  );
  const [cardDragOverId, setCardDragOverId] = useState<string | null>(null);
  /** 正在拖动的小笔记（左侧条），用于半透明与清理放置高亮 */
  const [draggingNoteCardKey, setDraggingNoteCardKey] = useState<
    string | null
  >(null);
  type CardDropMarker = {
    colId: string;
    cardId: string;
    before: boolean;
  };
  const [cardDropMarker, setCardDropMarker] =
    useState<CardDropMarker | null>(null);
  const [noteCardDropCollectionId, setNoteCardDropCollectionId] = useState<
    string | null
  >(null);
  const cardMediaUploadTargetRef = useRef<{
    colId: string;
    cardId: string;
  } | null>(null);
  const cardMediaFileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  /** 小笔记拖动会话：供 dragOver 识别（部分浏览器 types 不可靠） */
  const noteCardDragActiveRef = useRef(false);

  const [userAdminOpen, setUserAdminOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<PublicUser[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersErr, setAdminUsersErr] = useState<string | null>(null);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "user">("user");
  const [newUserBusy, setNewUserBusy] = useState(false);
  const [userAdminFormErr, setUserAdminFormErr] = useState<string | null>(
    null
  );
  const [pwdResetByUser, setPwdResetByUser] = useState<Record<string, string>>(
    {}
  );
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [sidebarFlash, setSidebarFlash] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [relatedPanel, setRelatedPanel] = useState<{
    colId: string;
    cardId: string;
  } | null>(null);
  const mobileNavSelRef = useRef<{
    activeId: string;
    calendarDay: string | null;
  } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const onMq = () => {
      if (!mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    const lockScroll = mobileNavOpen || relatedPanel !== null;
    if (!lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen, relatedPanel]);

  useEffect(() => {
    if (!relatedPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRelatedPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [relatedPanel]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    const cur = { activeId, calendarDay };
    if (mobileNavSelRef.current === null) {
      mobileNavSelRef.current = cur;
      return;
    }
    const prev = mobileNavSelRef.current;
    mobileNavSelRef.current = cur;
    if (
      prev.activeId !== cur.activeId ||
      prev.calendarDay !== cur.calendarDay
    ) {
      setMobileNavOpen(false);
    }
  }, [activeId, calendarDay]);

  useEffect(() => {
    if (!userAdminOpen || !isAdmin) return;
    let cancelled = false;
    setAdminUsersLoading(true);
    setAdminUsersErr(null);
    void fetchUsersList()
      .then((list) => {
        if (!cancelled) setAdminUsers(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAdminUsersErr(
            e instanceof Error ? e.message : "无法加载用户列表"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAdminUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userAdminOpen, isAdmin]);

  useEffect(() => {
    if (!userAdminOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserAdminOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userAdminOpen]);

  useEffect(() => {
    if (!sidebarFlash) return;
    const t = window.setTimeout(() => setSidebarFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [sidebarFlash]);

  const reloadAdminUsers = useCallback(async () => {
    try {
      const list = await fetchUsersList();
      setAdminUsers(list);
      setAdminUsersErr(null);
    } catch (e: unknown) {
      setAdminUsersErr(
        e instanceof Error ? e.message : "无法加载用户列表"
      );
    }
  }, []);

  const onAvatarFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !writeRequiresLogin) return;
      if (!mediaUploadMode) {
        setSidebarFlash(
          "头像上传需开启服务端媒体存储（COS 或本地 public 目录）"
        );
        return;
      }
      setAvatarBusy(true);
      setSidebarFlash(null);
      try {
        await uploadMyAvatar(file);
        await refreshMe();
        setSidebarFlash("头像已更新");
      } catch (err: unknown) {
        setSidebarFlash(
          err instanceof Error ? err.message : "头像上传失败"
        );
      } finally {
        setAvatarBusy(false);
      }
    },
    [writeRequiresLogin, mediaUploadMode, refreshMe]
  );

  const submitNewUser = useCallback(async () => {
    setUserAdminFormErr(null);
    const u = newUserUsername.trim();
    const p = newUserPassword;
    if (!u || !p) {
      setUserAdminFormErr("请填写用户名与密码");
      return;
    }
    setNewUserBusy(true);
    try {
      await createUserApi({
        username: u,
        password: p,
        displayName: newUserDisplayName.trim() || u,
        role: newUserRole,
      });
      setNewUserUsername("");
      setNewUserPassword("");
      setNewUserDisplayName("");
      setNewUserRole("user");
      await reloadAdminUsers();
    } catch (e: unknown) {
      setUserAdminFormErr(
        e instanceof Error ? e.message : "创建用户失败"
      );
    } finally {
      setNewUserBusy(false);
    }
  }, [
    newUserUsername,
    newUserPassword,
    newUserDisplayName,
    newUserRole,
    reloadAdminUsers,
  ]);

  const onDeleteUser = useCallback(
    async (u: PublicUser) => {
      if (!window.confirm(`确定删除用户「${u.username}」？`)) return;
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await deleteUserApi(u.id);
        if (currentUser?.id === u.id) {
          logout();
          setUserAdminOpen(false);
        } else {
          await reloadAdminUsers();
        }
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "删除失败"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [currentUser?.id, logout, reloadAdminUsers]
  );

  const onRoleChange = useCallback(
    async (u: PublicUser, role: "admin" | "user") => {
      if (u.role === role) return;
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await updateUserApi(u.id, { role });
        await reloadAdminUsers();
        if (currentUser?.id === u.id) await refreshMe();
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "更新角色失败"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [currentUser?.id, refreshMe, reloadAdminUsers]
  );

  const applyPasswordReset = useCallback(
    async (u: PublicUser) => {
      const pwd = (pwdResetByUser[u.id] ?? "").trim();
      if (pwd.length < 4) {
        setUserAdminFormErr("新密码至少 4 位");
        return;
      }
      setRowBusyId(u.id);
      setUserAdminFormErr(null);
      try {
        await updateUserApi(u.id, { password: pwd });
        setPwdResetByUser((prev) => ({ ...prev, [u.id]: "" }));
        setUserAdminFormErr(null);
        await reloadAdminUsers();
      } catch (e: unknown) {
        setUserAdminFormErr(
          e instanceof Error ? e.message : "重置密码失败"
        );
      } finally {
        setRowBusyId(null);
      }
    },
    [pwdResetByUser, reloadAdminUsers]
  );

  useEffect(() => {
    const clear = () => setCardDragOverId(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    (async () => {
      const health = await fetchApiHealth();
      if (cancelled) return;
      const mu = health?.mediaUpload;
      if (mu === "cos" || mu === "local") {
        setMediaUploadMode(mu);
      } else {
        setMediaUploadMode(null);
      }
      const online = Boolean(health?.ok);
      if (writeRequiresLogin && !currentUser) {
        setCollections(cloneInitialCollections());
        setLoadError(null);
        setSaveError(null);
        setApiOnline(online);
        setRemoteLoaded(true);
        return;
      }
      const data = await fetchCollectionsFromApi();
      if (cancelled) return;
      if (data !== null) {
        setCollections(migrateCollectionTree(data));
        setApiOnline(true);
        setLoadError(null);
      } else {
        if (writeRequiresLogin && currentUser) {
          setLoadError(
            "无法加载您的笔记，请检查网络或重新登录。"
          );
          setCollections([]);
        } else {
          setLoadError(
            "无法连接服务器，已使用本地示例；启动后端（见项目说明）后刷新即可同步。"
          );
          setApiOnline(online);
        }
      }
      setRemoteLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, writeRequiresLogin, currentUser?.id]);

  useEffect(() => {
    if (!remoteLoaded || !apiOnline || !authReady) return;
    if (writeRequiresLogin && !currentUser) return;
    const id = window.setTimeout(() => {
      void saveCollectionsToApi(collections).then((ok) => {
        setSaveError(
          ok ? null : "保存到服务器失败，请检查网络或后端日志。"
        );
      });
    }, 900);
    return () => window.clearTimeout(id);
  }, [
    collections,
    remoteLoaded,
    apiOnline,
    authReady,
    writeRequiresLogin,
    currentUser?.id,
  ]);

  const active = useMemo(() => {
    const found = findCollectionById(collections, activeId);
    if (found) return found;
    return collections[0];
  }, [collections, activeId]);

  useEffect(() => {
    if (activeId && !findCollectionById(collections, activeId)) {
      setActiveId(collections[0]?.id ?? "");
    }
  }, [collections, activeId]);

  const { pinned, rest } = useMemo(
    () => splitPinnedCards(active?.cards ?? []),
    [active?.cards]
  );

  const datesWithNotesSet = useMemo(
    () => datesWithNotes(collections),
    [collections]
  );

  const sidebarTags = useMemo(
    () => collectAllTagsFromCollections(collections),
    [collections]
  );

  const searchTrim = searchQuery.trim();
  const searchActive = searchTrim.length > 0;
  const { collectionMatches: searchCollectionMatches, groupedCards: searchGroupedCards } =
    useMemo(
      () => buildSearchResults(collections, searchTrim),
      [collections, searchTrim]
    );
  const searchHasResults =
    searchCollectionMatches.length > 0 || searchGroupedCards.length > 0;

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarViewMonth),
    [calendarViewMonth]
  );

  const dayEntries = useMemo(() => {
    if (!calendarDay) return [];
    return collectCardsOnDate(collections, calendarDay);
  }, [collections, calendarDay]);

  const cardToColIdForDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const { col, card } of dayEntries) m.set(card.id, col.id);
    return m;
  }, [dayEntries]);

  const { pinned: dayPinned, rest: dayRestCards } = useMemo(() => {
    const cards = dayEntries.map((e) => e.card);
    return splitPinnedCards(cards);
  }, [dayEntries]);

  const calendarRestByCol = useMemo(() => {
    const restIds = new Set(dayRestCards.map((c) => c.id));
    const m = new Map<string, { col: Collection; cards: NoteCard[] }>();
    for (const ent of dayEntries) {
      if (!restIds.has(ent.card.id)) continue;
      const cur = m.get(ent.col.id);
      if (cur) cur.cards.push(ent.card);
      else m.set(ent.col.id, { col: ent.col, cards: [ent.card] });
    }
    return [...m.values()];
  }, [dayRestCards, dayEntries]);

  const togglePin = useCallback(
    (colId: string, cardId: string) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((card) =>
            card.id === cardId
              ? { ...card, pinned: !card.pinned }
              : card
          ),
        }))
      );
    },
    []
  );

  const deleteCard = useCallback((colId: string, cardId: string) => {
    setCollections((prev) => {
      const next = mapCollectionById(prev, colId, (col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== cardId),
      }));
      return stripRelatedRefsToTarget(next, colId, cardId);
    });
    setCardMenuId(null);
    setRelatedPanel((p) =>
      p?.colId === colId && p?.cardId === cardId ? null : p
    );
  }, []);

  const removeRelatedPair = useCallback(
    (
      srcColId: string,
      srcCardId: string,
      tgtColId: string,
      tgtCardId: string
    ) => {
      setCollections((prev) =>
        removeBidirectionalRelated(
          prev,
          srcColId,
          srcCardId,
          tgtColId,
          tgtCardId
        )
      );
    },
    []
  );

  const addRelatedPair = useCallback(
    (
      srcColId: string,
      srcCardId: string,
      tgtColId: string,
      tgtCardId: string
    ) => {
      setCollections((prev) =>
        addBidirectionalRelated(
          prev,
          srcColId,
          srcCardId,
          tgtColId,
          tgtCardId
        )
      );
    },
    []
  );

  const setCardText = useCallback(
    (colId: string, cardId: string, text: string) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((card) =>
            card.id === cardId ? { ...card, text } : card
          ),
        }))
      );
    },
    []
  );

  const setCardTags = useCallback(
    (colId: string, cardId: string, tags: string[]) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((card) => {
            if (card.id !== cardId) return card;
            if (tags.length === 0) {
              const { tags: _t, ...rest } = card;
              return rest;
            }
            return { ...card, tags };
          }),
        }))
      );
    },
    []
  );

  const addMediaItemToCard = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  media: [...(card.media ?? []), item],
                }
              : card
          ),
        }))
      );
    },
    []
  );

  const uploadFilesToCard = useCallback(
    async (colId: string, cardId: string, files: File[]) => {
      if (files.length === 0) return;
      setUploadBusyCardId(cardId);
      try {
        for (const file of files) {
          const r = await uploadCardMedia(file);
          addMediaItemToCard(
            colId,
            cardId,
            mediaItemFromUploadResult(r)
          );
        }
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "上传失败"
        );
      } finally {
        setUploadBusyCardId(null);
      }
    },
    [addMediaItemToCard]
  );

  const beginCardMediaUpload = useCallback(
    (colId: string, cardId: string) => {
      setCardMenuId(null);
      cardMediaUploadTargetRef.current = { colId, cardId };
      cardMediaFileInputRef.current?.click();
    },
    []
  );

  const onCardMediaFileSelected = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const file = input.files?.[0];
      input.value = "";
      const t = cardMediaUploadTargetRef.current;
      cardMediaUploadTargetRef.current = null;
      if (!file || !t) return;
      void uploadFilesToCard(t.colId, t.cardId, [file]);
    },
    [uploadFilesToCard]
  );

  const clearCardMedia = useCallback((colId: string, cardId: string) => {
    setCollections((prev) =>
      mapCollectionById(prev, colId, (col) => ({
        ...col,
        cards: col.cards.map((card) => {
          if (card.id !== cardId) return card;
          const { media: _m, ...rest } = card;
          return rest;
        }),
      }))
    );
    setCardMenuId(null);
  }, []);

  const removeCardMediaItem = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((card) => {
            if (card.id !== cardId) return card;
            const raw = card.media ?? [];
            const idx = raw.findIndex(
              (m) =>
                m.url === item.url &&
                m.kind === item.kind &&
                (m.name ?? "") === (item.name ?? "") &&
                (m.coverUrl ?? "") === (item.coverUrl ?? "")
            );
            if (idx < 0) return card;
            const next = [...raw];
            next.splice(idx, 1);
            if (next.length === 0) {
              const { media: _m, ...rest } = card;
              return rest;
            }
            return { ...card, media: next };
          }),
        }))
      );
    },
    []
  );

  /**
   * 侧栏选中合集时：新卡片带当前时刻与今日 addedOn，便于日历聚合。
   * 选中日历某日（按日浏览）时不允许新建小笔记。
   */
  const addSmallNote = useCallback(() => {
    if (!canEdit) return;
    if (calendarDay !== null) return;
    const targetColId = active?.id;
    if (!targetColId) return;
    const now = new Date();
    const minutesOfDay = now.getHours() * 60 + now.getMinutes();
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const cardId = `n-${uid}`;
    const day = localDateString(now);
    const newCard: NoteCard = {
      id: cardId,
      text: "",
      minutesOfDay,
      addedOn: day,
    };

    setCollections((prev) =>
      mapCollectionById(prev, targetColId, (col) => ({
        ...col,
        cards: [...col.cards, newCard],
      }))
    );

    queueMicrotask(() => {
      document.getElementById(`card-text-${cardId}`)?.focus();
    });
  }, [canEdit, calendarDay, active?.id]);

  const commitCollectionRename = useCallback(() => {
    if (!editingCollectionId) return;
    const trimmed = draftCollectionName.trim();
    const name = trimmed.length > 0 ? trimmed : "新合集";
    setCollections((prev) =>
      mapCollectionById(prev, editingCollectionId, (col) => ({
        ...col,
        name,
      }))
    );
    setEditingCollectionId(null);
  }, [editingCollectionId, draftCollectionName]);

  const onCollectionNameBlur = useCallback(() => {
    if (skipCollectionBlurCommitRef.current) {
      skipCollectionBlurCommitRef.current = false;
      return;
    }
    commitCollectionRename();
  }, [commitCollectionRename]);

  const addCollection = useCallback(() => {
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newCol: Collection = {
      id,
      name: "新合集",
      dotColor: randomDotColor(),
      cards: [],
    };
    setCollections((prev) => [...prev, newCol]);
    setActiveId(id);
    setDraftCollectionName("新合集");
    setEditingCollectionId(id);
  }, []);

  const addSubCollection = useCallback((parentId: string) => {
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const child: Collection = {
      id,
      name: "新子合集",
      dotColor: randomDotColor(),
      cards: [],
    };
    setCollections((prev) =>
      insertChildCollection(prev, parentId, child)
    );
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
    setActiveId(id);
    setDraftCollectionName("新子合集");
    setEditingCollectionId(id);
  }, []);

  const removeCollection = useCallback(
    (id: string, displayName: string, hasSubtree: boolean) => {
      if (!canEdit) return;
      const msg = hasSubtree
        ? `确定删除「${displayName}」及其所有子合集？其中笔记将一并删除，且不可恢复。`
        : `确定删除「${displayName}」？其中笔记将一并删除，且不可恢复。`;
      if (!window.confirm(msg)) return;
      setCollectionCtxMenu(null);
      setDraggingCollectionId((d) => (d === id ? null : d));
      setDropIndicator((di) => (di?.targetId === id ? null : di));
      setEditingCollectionId((e) => (e === id ? null : e));

      let subtreeIds: string[] = [];
      setCollections((prev) => {
        const node = findCollectionById(prev, id);
        if (!node) return prev;
        subtreeIds = collectSubtreeCollectionIds(node);
        const { tree, removed } = removeCollectionFromTree(prev, id);
        return removed ? tree : prev;
      });
      if (subtreeIds.length > 0) {
        setCollapsedFolderIds((prev) => {
          const next = new Set(prev);
          for (const sid of subtreeIds) next.delete(sid);
          return next;
        });
      }
    },
    [canEdit]
  );

  const toggleFolderCollapsed = useCallback((folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const expandAncestorsOf = useCallback(
    (targetId: string) => {
      const ancestors = ancestorIdsFor(collections, targetId);
      if (ancestors.length === 0) return;
      setCollapsedFolderIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((id) => next.delete(id));
        return next;
      });
    },
    [collections]
  );

  const onCollectionRowDragStart = useCallback(
    (id: string, e: DragEvent) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("button, input, textarea")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(COLLECTION_DRAG_MIME, id);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
      setDraggingCollectionId(id);
    },
    [canEdit]
  );

  const onCollectionRowDragEnd = useCallback(() => {
    setDraggingCollectionId(null);
    setDropIndicator(null);
    setNoteCardDropCollectionId(null);
  }, []);

  const onCollectionRowDragOver = useCallback(
    (id: string, e: DragEvent) => {
      if (!canEdit) return;
      if (
        noteCardDragActiveRef.current ||
        noteCardDragTypesInclude(e.dataTransfer)
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setNoteCardDropCollectionId(id);
        return;
      }
      if (draggingCollectionId === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const el = e.currentTarget as HTMLElement;
      setDropIndicator({
        targetId: id,
        position: dropPositionFromEvent(e, el),
      });
    },
    [draggingCollectionId, canEdit]
  );

  const onCollectionRowDrop = useCallback(
    (targetId: string, e: DragEvent) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const noteFrom = readNoteCardDragPayload(e);
      if (noteFrom) {
        if (noteFrom.colId !== targetId) {
          setCollections((prev) =>
            applyNoteCardDrop(prev, noteFrom, {
              type: "collection",
              colId: targetId,
            })
          );
        }
        setNoteCardDropCollectionId(null);
        setCardDropMarker(null);
        setDraggingNoteCardKey(null);
        return;
      }
      const dragId =
        e.dataTransfer.getData(COLLECTION_DRAG_MIME) ||
        e.dataTransfer.getData("text/plain");
      if (!dragId) return;
      const el = e.currentTarget as HTMLElement;
      const position = dropPositionFromEvent(e, el);
      setCollections((prev) =>
        moveCollectionInTree(prev, dragId, targetId, position)
      );
      if (position === "inside") {
        setCollapsedFolderIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }
      setDraggingCollectionId(null);
      setDropIndicator(null);
    },
    [canEdit]
  );

  useLayoutEffect(() => {
    if (!editingCollectionId) return;
    const el = collectionNameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingCollectionId]);

  const commitCollectionHint = useCallback(() => {
    if (!editingHintCollectionId) return;
    const text = draftCollectionHint.trim();
    setCollections((prev) =>
      mapCollectionById(prev, editingHintCollectionId, (col) => ({
        ...col,
        ...(text.length > 0 ? { hint: text } : { hint: undefined }),
      }))
    );
    setEditingHintCollectionId(null);
  }, [editingHintCollectionId, draftCollectionHint]);

  const onCollectionHintBlur = useCallback(() => {
    if (skipHintBlurCommitRef.current) {
      skipHintBlurCommitRef.current = false;
      return;
    }
    commitCollectionHint();
  }, [commitCollectionHint]);

  useLayoutEffect(() => {
    if (!editingHintCollectionId) return;
    const el = collectionHintTextareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingHintCollectionId]);

  useLayoutEffect(() => {
    if (!editingHintCollectionId) return;
    const el = collectionHintTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editingHintCollectionId, draftCollectionHint]);

  useEffect(() => {
    setCardMenuId(null);
    setCollectionCtxMenu(null);
    setEditingHintCollectionId((prev) =>
      prev !== null && prev !== activeId ? null : prev
    );
  }, [activeId]);

  useEffect(() => {
    if (collectionCtxMenu === null) return;
    const onDown = (e: PointerEvent) => {
      const el = document.querySelector("[data-collection-ctx-menu]");
      if (!el?.contains(e.target as Node)) {
        setCollectionCtxMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollectionCtxMenu(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [collectionCtxMenu]);

  useEffect(() => {
    if (cardMenuId === null) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(`[data-card-menu-root="${cardMenuId}"]`)) {
        setCardMenuId(null);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [cardMenuId]);

  const renderCard = (card: NoteCard, colId: string) => {
    const media = (card.media ?? []).filter((m) => m.url?.trim());
    const hasGallery = media.length > 0;
    const noteKey = `${colId}-${card.id}`;
    const dropEdgeActive =
      cardDropMarker !== null &&
      cardDropMarker.colId === colId &&
      cardDropMarker.cardId === card.id;
    return (
      <li
        key={noteKey}
        className={
          "card" +
          (cardMenuId === card.id ? " is-menu-open" : "") +
          (cardDragOverId === card.id && canEdit && mediaUploadMode
            ? " card--file-drag-over"
            : "") +
          (dropEdgeActive
            ? cardDropMarker.before
              ? " card--note-drop-before"
              : " card--note-drop-after"
            : "") +
          (draggingNoteCardKey === noteKey ? " card--note-dragging" : "")
        }
        onDragOver={(e) => {
          if (!canEdit) return;
          if (noteCardDragActiveRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            const before =
              e.clientY < rect.top + rect.height * 0.5;
            setCardDropMarker({
              colId,
              cardId: card.id,
              before,
            });
            return;
          }
          if (!mediaUploadMode) return;
          if (!dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragEnter={(e) => {
          if (!canEdit) return;
          if (noteCardDragActiveRef.current) {
            e.preventDefault();
            return;
          }
          if (!mediaUploadMode) return;
          if (!dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          setCardDragOverId(card.id);
        }}
        onDragLeave={(e) => {
          if (!canEdit) return;
          const rel = e.relatedTarget as Node | null;
          if (rel && e.currentTarget.contains(rel)) return;
          if (noteCardDragActiveRef.current) {
            setCardDropMarker((m) =>
              m && m.cardId === card.id && m.colId === colId
                ? null
                : m
            );
            return;
          }
          if (!mediaUploadMode) return;
          setCardDragOverId((id) => (id === card.id ? null : id));
        }}
        onDrop={(e) => {
          if (!canEdit) return;
          const from = readNoteCardDragPayload(e);
          if (from) {
            e.preventDefault();
            e.stopPropagation();
            setCardDropMarker(null);
            setNoteCardDropCollectionId(null);
            const rect = e.currentTarget.getBoundingClientRect();
            const before =
              e.clientY < rect.top + rect.height * 0.5;
            const target = before
              ? ({
                  type: "before" as const,
                  colId,
                  cardId: card.id,
                } as const)
              : ({
                  type: "after" as const,
                  colId,
                  cardId: card.id,
                } as const);
            setCollections((prev) =>
              applyNoteCardDrop(prev, from, target)
            );
            setDraggingNoteCardKey(null);
            return;
          }
          if (!mediaUploadMode) return;
          e.preventDefault();
          setCardDragOverId(null);
          const files = filesFromDataTransfer(e.dataTransfer);
          if (files.length === 0) return;
          void uploadFilesToCard(colId, card.id, files);
        }}
      >
        <div
          className={
            "card__inner" + (hasGallery ? " card__inner--split" : "")
          }
        >
          {canEdit ? (
            <div
              className="card__move-rail"
              draggable
              aria-label="拖动以移动小笔记"
              title="按住拖到其他卡片旁或侧栏合集"
              onDragStart={(e: DragEvent<HTMLDivElement>) => {
                e.stopPropagation();
                const cardEl = e.currentTarget.closest(
                  "li.card"
                ) as HTMLElement | null;
                if (cardEl) {
                  const cr = cardEl.getBoundingClientRect();
                  const ox = Math.round(e.clientX - cr.left);
                  const oy = Math.round(e.clientY - cr.top);
                  e.dataTransfer.setDragImage(cardEl, ox, oy);
                }
                const payload: NoteCardDragPayload = {
                  colId,
                  cardId: card.id,
                };
                const json = JSON.stringify(payload);
                e.dataTransfer.setData(NOTE_CARD_DRAG_MIME, json);
                e.dataTransfer.setData(
                  "text/plain",
                  NOTE_CARD_TEXT_PREFIX + json
                );
                e.dataTransfer.effectAllowed = "move";
                noteCardDragActiveRef.current = true;
                setDraggingNoteCardKey(noteKey);
              }}
              onDragEnd={() => {
                noteCardDragActiveRef.current = false;
                setDraggingNoteCardKey(null);
                setCardDropMarker(null);
                setNoteCardDropCollectionId(null);
              }}
            />
          ) : null}
          <div
            className={
              "card__paper" +
              (hasGallery ? " card__paper--with-gallery" : "") +
              (canEdit ? " card__paper--with-move-rail" : "")
            }
          >
            <div className="card__toolbar">
              <span className="card__time">
                {formatCardTimeLabel(card)}
              </span>
              <div className="card__toolbar-actions">
                <div
                  className="card__menu-root"
                  data-card-menu-root={card.id}
                >
                  <button
                    type="button"
                    className="card__more"
                    aria-label="更多操作"
                    aria-expanded={cardMenuId === card.id}
                    onClick={() =>
                      setCardMenuId((id) =>
                        id === card.id ? null : card.id
                      )
                    }
                  >
                    …
                  </button>
                  {cardMenuId === card.id && (
                    <div
                      className="card__menu"
                      role="menu"
                      aria-orientation="vertical"
                    >
                      <button
                        type="button"
                        className={
                          "card__menu-item" +
                          (relatedPanel?.colId === colId &&
                          relatedPanel?.cardId === card.id
                            ? " is-active"
                            : "")
                        }
                        role="menuitem"
                        onClick={() => {
                          setRelatedPanel((p) =>
                            p?.colId === colId && p?.cardId === card.id
                              ? null
                              : { colId, cardId: card.id }
                          );
                          setCardMenuId(null);
                        }}
                      >
                        相关笔记
                      </button>
                      {canEdit && mediaUploadMode ? (
                        <button
                          type="button"
                          className="card__menu-item"
                          role="menuitem"
                          disabled={uploadBusyCardId === card.id}
                          onClick={() =>
                            beginCardMediaUpload(colId, card.id)
                          }
                        >
                          {uploadBusyCardId === card.id
                            ? "上传中…"
                            : "添加附件"}
                        </button>
                      ) : null}
                      {canEdit && hasGallery ? (
                        <button
                          type="button"
                          className="card__menu-item"
                          role="menuitem"
                          onClick={() =>
                            clearCardMedia(colId, card.id)
                          }
                        >
                          清空附件
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="card__menu-item"
                          role="menuitem"
                          onClick={() => {
                            togglePin(colId, card.id);
                            setCardMenuId(null);
                          }}
                        >
                          {card.pinned ? "取消置顶" : "置顶"}
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="card__menu-item card__menu-item--danger"
                          role="menuitem"
                          onClick={() =>
                            deleteCard(colId, card.id)
                          }
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <NoteCardBodyText
              id={`card-text-${card.id}`}
              value={card.text}
              canEdit={canEdit}
              minRows={3}
              ariaLabel="笔记正文"
              onChange={(next) => setCardText(colId, card.id, next)}
              onPaste={
                canEdit && mediaUploadMode
                  ? (e) => {
                      const files = filesFromDataTransfer(
                        e.clipboardData
                      );
                      if (files.length === 0) return;
                      e.preventDefault();
                      void uploadFilesToCard(colId, card.id, files);
                    }
                  : undefined
              }
            />
            <CardTagsRow
              colId={colId}
              card={card}
              canEdit={canEdit}
              onCommit={setCardTags}
            />
          </div>
          {hasGallery ? (
            <CardGallery
              items={media}
              onRemoveItem={
                canEdit
                  ? (item) =>
                      removeCardMediaItem(colId, card.id, item)
                  : undefined
              }
            />
          ) : null}
        </div>
      </li>
    );
  };

  const timelineEmpty = (active?.cards.length ?? 0) === 0;
  const listEmpty = pinned.length === 0 && rest.length === 0;

  const renderCollectionBranch = (
    items: Collection[],
    depth: number
  ): ReactNode =>
    items.map((c) => {
      const childList = c.children ?? [];
      const hasChildren = childList.length > 0;
      const collapsed = collapsedFolderIds.has(c.id);

      const dropCls =
        dropIndicator?.targetId === c.id
          ? dropIndicator.position === "before"
            ? " sidebar__tree-row--drop-before"
            : dropIndicator.position === "after"
              ? " sidebar__tree-row--drop-after"
              : " sidebar__tree-row--drop-inside"
          : "";

      return (
        <Fragment key={c.id}>
          <div
            className={
              "sidebar__tree-row" +
              (c.id === active?.id && !calendarDay ? " is-active" : "") +
              (c.id === draggingCollectionId
                ? " sidebar__tree-row--dragging"
                : "") +
              (noteCardDropCollectionId === c.id
                ? " sidebar__tree-row--note-card-drop"
                : "") +
              dropCls
            }
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={canEdit && editingCollectionId !== c.id}
            onDragStart={(e) => onCollectionRowDragStart(c.id, e)}
            onDragEnd={onCollectionRowDragEnd}
            onDragOver={(e) => onCollectionRowDragOver(c.id, e)}
            onDragLeave={(e) => {
              const rel = e.relatedTarget as Node | null;
              if (rel && e.currentTarget.contains(rel)) return;
              if (noteCardDragActiveRef.current) {
                setNoteCardDropCollectionId((id) =>
                  id === c.id ? null : id
                );
              }
            }}
            onDrop={(e) => onCollectionRowDrop(c.id, e)}
            onContextMenu={(e) => {
              if (!canEdit || editingCollectionId === c.id) return;
              e.preventDefault();
              setCollectionCtxMenu({
                x: e.clientX,
                y: e.clientY,
                id: c.id,
                name: c.name,
                hasChildren: (c.children?.length ?? 0) > 0,
              });
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                draggable={false}
                className={
                  "sidebar__chevron" +
                  (collapsed ? "" : " is-expanded")
                }
                aria-label={collapsed ? "展开子合集" : "折叠子合集"}
                aria-expanded={!collapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolderCollapsed(c.id);
                }}
              >
                <span className="sidebar__chevron-icon" aria-hidden>
                  ›
                </span>
              </button>
            ) : (
              <span className="sidebar__chevron-spacer" aria-hidden />
            )}
            <div
              role="button"
              tabIndex={editingCollectionId === c.id ? -1 : 0}
              className="sidebar__item-hit"
              onClick={() => {
                if (editingCollectionId === c.id) return;
                setCalendarDay(null);
                expandAncestorsOf(c.id);
                setActiveId(c.id);
              }}
              onKeyDown={(e) => {
                if (editingCollectionId === c.id) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setCalendarDay(null);
                  expandAncestorsOf(c.id);
                  setActiveId(c.id);
                }
              }}
            >
              <span
                className="sidebar__dot"
                style={{ backgroundColor: c.dotColor }}
                aria-hidden
              />
              {editingCollectionId === c.id ? (
                <input
                  ref={collectionNameInputRef}
                  type="text"
                  className="sidebar__name-input"
                  value={draftCollectionName}
                  aria-label="合集名称"
                  onChange={(e) =>
                    setDraftCollectionName(e.target.value)
                  }
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      skipCollectionBlurCommitRef.current = true;
                      setEditingCollectionId(null);
                    }
                  }}
                  onBlur={onCollectionNameBlur}
                />
              ) : (
                <span
                  className="sidebar__name"
                  title={
                    canEdit ? "双击修改名称；右键可删除合集" : undefined
                  }
                  onDoubleClick={
                    canEdit
                      ? (e) => {
                          e.stopPropagation();
                          setDraftCollectionName(c.name);
                          setEditingCollectionId(c.id);
                        }
                      : undefined
                  }
                >
                  {c.name}
                </span>
              )}
              <span className="sidebar__count">
                {countCardsInCollectionSubtree(c)}
              </span>
            </div>
            {canEdit ? (
              <button
                type="button"
                draggable={false}
                className="sidebar__add-sub"
                aria-label="添加子合集"
                title="子合集"
                onClick={(e) => {
                  e.stopPropagation();
                  addSubCollection(c.id);
                }}
              >
                +
              </button>
            ) : (
              <span className="sidebar__add-sub-spacer" aria-hidden />
            )}
          </div>
          {hasChildren && !collapsed
            ? renderCollectionBranch(childList, depth + 1)
            : null}
        </Fragment>
      );
    });

  return (
    <div
      className={
        "app" + (mobileNavOpen ? " app--mobile-nav-open" : "")
      }
    >
      <div
        className="app__mobile-backdrop"
        aria-hidden
        onClick={() => setMobileNavOpen(false)}
      />
      <aside className="sidebar" id="app-mobile-sidebar">
        <div className="sidebar__mobile-top">
          <span className="sidebar__mobile-title">菜单</span>
          <button
            type="button"
            className="sidebar__mobile-close"
            aria-label="关闭菜单"
            onClick={() => setMobileNavOpen(false)}
          >
            <span aria-hidden>×</span>
          </button>
        </div>
        <div className="sidebar__header">
          <div className="sidebar__header-row">
            <div className="sidebar__workspace">
              {writeRequiresLogin && currentUser ? (
                <>
                  <label
                    className={
                      "sidebar__avatar-hit" +
                      (avatarBusy ? " sidebar__avatar-hit--busy" : "")
                    }
                    title={
                      mediaUploadMode
                        ? "点击更换头像"
                        : "头像上传需配置媒体存储"
                    }
                  >
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="sidebar__avatar-file"
                      disabled={!mediaUploadMode || avatarBusy}
                      onChange={onAvatarFileChange}
                    />
                    {currentUser.avatarUrl ? (
                      <img
                        src={resolveMediaUrl(currentUser.avatarUrl)}
                        alt=""
                        className="sidebar__avatar-img"
                      />
                    ) : (
                      <span
                        className="sidebar__workspace-dot sidebar__workspace-dot--avatar"
                        aria-hidden
                      />
                    )}
                  </label>
                  <div className="sidebar__workspace-text">
                    <span className="sidebar__workspace-name">
                      {currentUser.displayName || currentUser.username}
                    </span>
                    <span className="sidebar__workspace-sub">
                      mikujar · 未来罐
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <span className="sidebar__workspace-dot" aria-hidden />
                  <span className="sidebar__workspace-name">mikujar</span>
                </>
              )}
            </div>
            {writeRequiresLogin ? (
              <div className="sidebar__header-actions">
                {isAdmin ? (
                  <button
                    type="button"
                    className="sidebar__users-btn"
                    onClick={() => setUserAdminOpen(true)}
                    title="用户管理"
                  >
                    用户
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    "sidebar__admin-icon-btn" +
                    (currentUser ? " sidebar__admin-icon-btn--on" : "")
                  }
                  onClick={currentUser ? logout : openLogin}
                  aria-label={currentUser ? "退出登录" : "登录"}
                  title={currentUser ? "退出登录" : "登录"}
                >
                  <AdminHeaderIcon
                    mode={currentUser ? "logout" : "login"}
                  />
                </button>
              </div>
            ) : null}
          </div>
          {sidebarFlash ? (
            <p className="sidebar__flash" role="status">
              {sidebarFlash}
            </p>
          ) : null}
        </div>

        <div className="sidebar__calendar" aria-label="按日期浏览">
          <div className="sidebar__cal-head">
            <button
              type="button"
              className="sidebar__cal-nav-btn"
              aria-label="上一月"
              onClick={() => {
                const d = new Date(calendarViewMonth);
                d.setMonth(d.getMonth() - 1);
                setCalendarViewMonth(
                  new Date(d.getFullYear(), d.getMonth(), 1)
                );
              }}
            >
              ‹
            </button>
            <span className="sidebar__cal-title">
              {calendarViewMonth.getFullYear()}年
              {calendarViewMonth.getMonth() + 1}月
            </span>
            <button
              type="button"
              className="sidebar__cal-nav-btn"
              aria-label="下一月"
              onClick={() => {
                const d = new Date(calendarViewMonth);
                d.setMonth(d.getMonth() + 1);
                setCalendarViewMonth(
                  new Date(d.getFullYear(), d.getMonth(), 1)
                );
              }}
            >
              ›
            </button>
          </div>
          <div className="sidebar__cal-weekdays" aria-hidden>
            {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
              <span key={w} className="sidebar__cal-wd">
                {w}
              </span>
            ))}
          </div>
          <div className="sidebar__cal-grid">
            {calendarCells.map((cell, i) =>
              cell ? (
                <button
                  key={cell.dateStr}
                  type="button"
                  className={
                    "sidebar__cal-day" +
                    (cell.dateStr === calendarDay ? " is-selected" : "") +
                    (cell.dateStr === localDateString() ? " is-today" : "") +
                    (datesWithNotesSet.has(cell.dateStr) ? " has-notes" : "")
                  }
                  onClick={() => {
                    setSearchQuery("");
                    setCalendarDay(cell.dateStr);
                    const [yy, mm] = cell.dateStr.split("-").map(Number);
                    setCalendarViewMonth(new Date(yy, mm - 1, 1));
                  }}
                >
                  {cell.day}
                </button>
              ) : (
                <span
                  key={`pad-${i}`}
                  className="sidebar__cal-day sidebar__cal-day--pad"
                  aria-hidden
                />
              )
            )}
          </div>
        </div>

        <div className="sidebar__collections">
          <div className="sidebar__section-row">
            <p className="sidebar__section">合集</p>
            {canEdit ? (
              <button
                type="button"
                className="sidebar__section-add"
                onClick={addCollection}
                aria-label="新建合集"
              >
                +
              </button>
            ) : null}
          </div>
          <nav className="sidebar__nav" aria-label="合集">
            {renderCollectionBranch(collections, 0)}
          </nav>
        </div>

        <div className="sidebar__tags" aria-label="全部标签">
          <div className="sidebar__section-row sidebar__tags-head">
            <p className="sidebar__section">标签</p>
          </div>
          {sidebarTags.length > 0 ? (
            <div className="sidebar__tags-cloud">
              {sidebarTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="sidebar__tags-chip"
                  onClick={() => {
                    setSearchQuery(tag);
                    setCalendarDay(null);
                    setMobileNavOpen(false);
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : (
            <p className="sidebar__tags-empty">暂无标签</p>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="main__header">
          <div className="main__header-row">
            <button
              type="button"
              className="main__nav-toggle"
              aria-label={mobileNavOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={mobileNavOpen}
              aria-controls="app-mobile-sidebar"
              onClick={() => setMobileNavOpen((o) => !o)}
            >
              <svg
                className="main__nav-toggle-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"
                />
              </svg>
            </button>
            <h1 className="main__heading">
              {searchActive
                ? "搜索"
                : calendarDay
                  ? formatChineseDayTitle(calendarDay)
                  : active?.name ?? "未选择合集"}
            </h1>
            <div className="main__header-actions">
              <div className="main__search" role="search">
                <input
                  id="app-main-search"
                  type="search"
                  className="main__search-input"
                  placeholder="搜索…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSearchQuery("");
                    }
                  }}
                  autoComplete="off"
                  aria-label="搜索笔记、附件名、合集名"
                />
                {searchActive ? (
                  <button
                    type="button"
                    className="main__search-clear"
                    aria-label="清除搜索"
                    onClick={() => setSearchQuery("")}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {canEdit && active && !calendarDay && !searchActive && (
                <button
                  type="button"
                  className="main__add-note"
                  onClick={addSmallNote}
                >
                  + 新建小笔记
                </button>
              )}
            </div>
          </div>
          {(loadError || saveError) && (
            <div className="main__banners">
              {loadError ? (
                <p className="main__banner main__banner--warn" role="status">
                  {loadError}
                </p>
              ) : null}
              {saveError ? (
                <p className="main__banner main__banner--err" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>
          )}
          {active && !calendarDay && !searchActive && (
            <div className="main__hint-wrap">
              {editingHintCollectionId === active.id ? (
                <textarea
                  ref={collectionHintTextareaRef}
                  className="main__hint-editor"
                  rows={1}
                  value={draftCollectionHint}
                  aria-label="合集说明"
                  onChange={(e) =>
                    setDraftCollectionHint(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      skipHintBlurCommitRef.current = true;
                      setEditingHintCollectionId(null);
                    }
                  }}
                  onBlur={onCollectionHintBlur}
                />
              ) : (
                <p
                  className="main__hint"
                  title={canEdit ? "双击修改说明" : undefined}
                  onDoubleClick={
                    canEdit
                      ? () => {
                          const raw = active.hint?.trim();
                          setDraftCollectionHint(
                            raw
                              ? active.hint!
                              : DEFAULT_COLLECTION_HINT
                          );
                          setEditingHintCollectionId(active.id);
                        }
                      : undefined
                  }
                >
                  {active.hint?.trim()
                    ? active.hint
                    : DEFAULT_COLLECTION_HINT}
                </p>
              )}
            </div>
          )}
        </header>

        <div
          className="timeline"
          role="feed"
          aria-label={
            searchActive ? "搜索结果" : "mikujar 时间线"
          }
        >
          {searchActive ? (
            !searchHasResults ? (
              <div className="timeline__empty">
                未找到与「{searchTrim}」相关的笔记或合集。
              </div>
            ) : (
              <>
                {searchCollectionMatches.length > 0 ? (
                  <section
                    className="search-section"
                    aria-label="名称匹配的合集"
                  >
                    <h2 className="timeline__pin-heading">合集</h2>
                    <ul className="search-col-list">
                      {searchCollectionMatches.map(({ col, path }) => (
                        <li key={col.id} className="search-col-list__item">
                          <span className="search-col-list__path">
                            {path}
                          </span>
                          <button
                            type="button"
                            className="search-col-list__open"
                            onClick={() => {
                              setActiveId(col.id);
                              setCalendarDay(null);
                              setSearchQuery("");
                            }}
                          >
                            打开
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {searchCollectionMatches.length > 0 &&
                searchGroupedCards.length > 0 ? (
                  <div
                    className="timeline__pin-divider"
                    role="separator"
                    aria-hidden
                  />
                ) : null}
                {searchGroupedCards.length > 0 ? (
                  <section
                    className="search-section"
                    aria-label="匹配的笔记"
                  >
                    <h2 className="timeline__pin-heading">笔记</h2>
                    {searchGroupedCards.map(({ col, path, cards }) => (
                      <div
                        key={col.id}
                        className="search-card-group"
                      >
                        <div className="search-card-group__head">
                          <span className="search-card-group__path">
                            {path}
                          </span>
                          <button
                            type="button"
                            className="search-card-group__open"
                            onClick={() => {
                              setActiveId(col.id);
                              setCalendarDay(null);
                              setSearchQuery("");
                            }}
                          >
                            打开合集
                          </button>
                        </div>
                        <ul className="cards">
                          {cards.map((card) =>
                            renderCard(card, col.id)
                          )}
                        </ul>
                      </div>
                    ))}
                  </section>
                ) : null}
              </>
            )
          ) : calendarDay ? (
            dayPinned.length === 0 && dayRestCards.length === 0 ? (
              <div className="timeline__empty">
                {canEdit
                  ? "这一天还没有带日期的笔记。请在侧栏选中合集后再用「+ 新建小笔记」；未写日期的卡片不会出现在日历里。"
                  : "这一天没有可显示的笔记。"}
              </div>
            ) : (
              <>
                {dayPinned.length > 0 && (
                  <section
                    className="timeline__pin-section"
                    aria-label="当日置顶"
                  >
                    <h2 className="timeline__pin-heading">置顶</h2>
                    <ul className="cards">
                      {dayPinned.map((card) =>
                        renderCard(
                          card,
                          cardToColIdForDay.get(card.id) ?? ""
                        )
                      )}
                    </ul>
                  </section>
                )}
                {dayPinned.length > 0 && dayRestCards.length > 0 && (
                  <div
                    className="timeline__pin-divider"
                    role="separator"
                    aria-hidden
                  />
                )}
                {calendarRestByCol.map(({ col, cards: dayColCards }) => (
                  <div
                    key={col.id}
                    className="timeline__cal-group"
                  >
                    <h2 className="timeline__cal-group-title">
                      「{col.name}」
                    </h2>
                    <ul className="cards">
                      {dayColCards.map((card) =>
                        renderCard(card, col.id)
                      )}
                    </ul>
                  </div>
                ))}
              </>
            )
          ) : listEmpty ? (
            <div className="timeline__empty">
              {timelineEmpty
                ? canEdit
                  ? "当前合集里还没有笔记。点击「+ 新建小笔记」会记在当前合集并打在今日日历上。"
                  : "当前合集里还没有笔记。"
                : "暂无笔记。"}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <section
                  className="timeline__pin-section"
                  aria-label="置顶笔记"
                >
                  <h2 className="timeline__pin-heading">置顶</h2>
                  <ul className="cards">
                    {pinned.map((card) =>
                      renderCard(card, active!.id)
                    )}
                  </ul>
                </section>
              )}
              {pinned.length > 0 && rest.length > 0 && (
                <div
                  className="timeline__pin-divider"
                  role="separator"
                  aria-hidden
                />
              )}
              <ul className="cards">
                {rest.map((card) => renderCard(card, active!.id))}
              </ul>
            </>
          )}
        </div>
      </main>
      <input
        ref={cardMediaFileInputRef}
        type="file"
        className="app__hidden-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={onCardMediaFileSelected}
      />
      {collectionCtxMenu
        ? createPortal(
            <div
              data-collection-ctx-menu
              className="attachment-ctx-menu"
              style={{
                position: "fixed",
                left: Math.min(
                  collectionCtxMenu.x,
                  typeof window !== "undefined"
                    ? window.innerWidth - 160
                    : collectionCtxMenu.x
                ),
                top: collectionCtxMenu.y,
                zIndex: 10002,
              }}
              role="menu"
            >
              <button
                type="button"
                className="attachment-ctx-menu__item"
                role="menuitem"
                onClick={() =>
                  removeCollection(
                    collectionCtxMenu.id,
                    collectionCtxMenu.name,
                    collectionCtxMenu.hasChildren
                  )
                }
              >
                删除合集
              </button>
            </div>,
            document.body
          )
        : null}
      {relatedPanel
        ? createPortal(
            <RelatedCardsSidePanel
              sourceColId={relatedPanel.colId}
              sourceCardId={relatedPanel.cardId}
              collections={collections}
              canEdit={canEdit}
              onClose={() => setRelatedPanel(null)}
              onRemoveRelation={(tgtCol, tgtCard) =>
                removeRelatedPair(
                  relatedPanel.colId,
                  relatedPanel.cardId,
                  tgtCol,
                  tgtCard
                )
              }
              onAddRelation={(tgtCol, tgtCard) =>
                addRelatedPair(
                  relatedPanel.colId,
                  relatedPanel.cardId,
                  tgtCol,
                  tgtCard
                )
              }
              onNavigateToCard={(tgtCol, _tgtCard) => {
                setActiveId(tgtCol);
                setCalendarDay(null);
                setSearchQuery("");
                setMobileNavOpen(false);
                setRelatedPanel(null);
              }}
            />,
            document.body
          )
        : null}
      {userAdminOpen && isAdmin
        ? createPortal(
            <div
              className="auth-modal-backdrop"
              role="presentation"
              onClick={() => setUserAdminOpen(false)}
            >
              <div
                className="auth-modal user-admin-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="user-admin-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="user-admin-title" className="auth-modal__title">
                  用户管理
                </h2>
                <p className="auth-modal__hint">
                  手动创建账号。登录用户均可编辑自己的笔记与上传附件；管理员额外可在此管理用户。
                </p>
                {adminUsersErr || userAdminFormErr ? (
                  <p className="auth-modal__err" role="alert">
                    {adminUsersErr ?? userAdminFormErr}
                  </p>
                ) : null}
                <div className="user-admin__new">
                  <p className="user-admin__new-title">新建用户</p>
                  <input
                    type="text"
                    className="auth-modal__input"
                    autoComplete="off"
                    placeholder="用户名"
                    value={newUserUsername}
                    disabled={newUserBusy}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                  />
                  <input
                    type="password"
                    className="auth-modal__input"
                    autoComplete="new-password"
                    placeholder="初始密码（至少 4 位）"
                    value={newUserPassword}
                    disabled={newUserBusy}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                  <input
                    type="text"
                    className="auth-modal__input"
                    autoComplete="off"
                    placeholder="显示名（可选，默认同用户名）"
                    value={newUserDisplayName}
                    disabled={newUserBusy}
                    onChange={(e) => setNewUserDisplayName(e.target.value)}
                  />
                  <div className="user-admin__new-row">
                    <label className="user-admin__role-label">
                      角色
                      <select
                        className="user-admin__role-select"
                        value={newUserRole}
                        disabled={newUserBusy}
                        onChange={(e) =>
                          setNewUserRole(
                            e.target.value === "admin" ? "admin" : "user"
                          )
                        }
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="auth-modal__btn auth-modal__btn--primary"
                      disabled={
                        newUserBusy ||
                        !newUserUsername.trim() ||
                        newUserPassword.length < 4
                      }
                      onClick={() => void submitNewUser()}
                    >
                      {newUserBusy ? "…" : "添加"}
                    </button>
                  </div>
                </div>
                <div className="user-admin__table-wrap">
                  {adminUsersLoading ? (
                    <p className="user-admin__loading">加载中…</p>
                  ) : (
                    <table className="user-admin__table">
                      <thead>
                        <tr>
                          <th>显示名</th>
                          <th>用户名</th>
                          <th>角色</th>
                          <th>重置密码</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers.map((u) => (
                          <tr key={u.id}>
                            <td>{u.displayName}</td>
                            <td className="user-admin__mono">{u.username}</td>
                            <td>
                              <select
                                className="user-admin__role-select user-admin__role-select--inline"
                                value={u.role}
                                disabled={rowBusyId === u.id}
                                onChange={(e) =>
                                  void onRoleChange(
                                    u,
                                    e.target.value === "admin"
                                      ? "admin"
                                      : "user"
                                  )
                                }
                              >
                                <option value="user">普通</option>
                                <option value="admin">管理</option>
                              </select>
                            </td>
                            <td className="user-admin__pwd-cell">
                              <div className="user-admin__pwd-inner">
                                <input
                                  type="password"
                                  className="user-admin__pwd-input"
                                  autoComplete="new-password"
                                  placeholder="新密码"
                                  value={pwdResetByUser[u.id] ?? ""}
                                  disabled={rowBusyId === u.id}
                                  onChange={(e) =>
                                    setPwdResetByUser((prev) => ({
                                      ...prev,
                                      [u.id]: e.target.value,
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  className="user-admin__mini-btn"
                                  disabled={rowBusyId === u.id}
                                  onClick={() => void applyPasswordReset(u)}
                                >
                                  应用
                                </button>
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="user-admin__mini-btn user-admin__mini-btn--danger"
                                disabled={rowBusyId === u.id}
                                onClick={() => void onDeleteUser(u)}
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="auth-modal__actions">
                  <button
                    type="button"
                    className="auth-modal__btn auth-modal__btn--ghost"
                    onClick={() => setUserAdminOpen(false)}
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
