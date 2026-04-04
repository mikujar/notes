import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  ReactNode,
  Ref,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { DEFAULT_TAURI_REMOTE_API } from "./api/apiBase";
import { fetchApiHealth } from "./api/health";
import {
  fetchCollectionsFromApi,
  createCardApi,
  updateCardApi,
  deleteCardApi,
} from "./api/collections";
import { uploadCardMedia } from "./api/upload";
import { resolveMediaUrl, type AuthUser } from "./api/auth";
import {
  createUserApi,
  deleteUserApi,
  fetchUsersList,
  updateUserApi,
  uploadMyAvatar,
  type PublicUser,
} from "./api/users";
import { useAppDataMode } from "./appDataMode";
import type { AppDataMode } from "./appDataModeStorage";
import { useAuth } from "./auth/AuthContext";
import { getAdminToken } from "./auth/token";
import { collections as initialCollections } from "./data";
import { loadLocalCollections, saveLocalCollections } from "./localCollectionsStorage";
import { saveLocalMediaInlineInBrowser } from "./localMediaBrowser";
import {
  deleteLocalMediaFile,
  LOCAL_MEDIA_PREFIX,
  saveLocalMediaToAppFolder,
} from "./localMediaTauri";
import {
  MediaLightboxAudio,
  MediaLightboxCover,
  MediaLightboxImage,
  MediaLightboxVideo,
  MediaOpenLink,
  MediaThumbImage,
  MediaThumbVideo,
} from "./mediaDisplay";
import { migrateCollectionTree } from "./migrateCollections";
import { filesFromDataTransfer } from "./filesFromDataTransfer";
import { NoteCardTiptap } from "./noteEditor/NoteCardTiptap";
import { htmlToPlainText, noteBodyToHtml } from "./noteEditor/plainHtml";
import type {
  Collection,
  NoteCard,
  NoteMediaItem,
  NoteMediaKind,
  TrashedNoteEntry,
} from "./types";
import "./App.css";

const DEFAULT_COLLECTION_HINT =
  "欢迎光临 mikujar「未来罐」～ 一条笔记一件小事，按一天里的时刻慢慢堆满！左侧合集随便切；这段灰灰的字双击一下，就能换成你自己的开场白 ✨";

/** 与 favicon 一致的未来罐，手机底栏「新建」用 */
function MobileDockJarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="34"
      height="34"
      viewBox="0 0 32 32"
      aria-hidden
    >
      <rect
        x="9"
        y="7"
        width="14"
        height="5"
        rx="2.5"
        fill="var(--mikujar-logo-lid)"
      />
      <rect
        x="12"
        y="11"
        width="8"
        height="5"
        rx="1"
        fill="var(--mikujar-logo-jar)"
      />
      <rect
        x="10"
        y="15"
        width="12"
        height="11"
        rx="2"
        fill="var(--mikujar-logo-jar)"
      />
      <circle cx="13" cy="18.5" r="1.25" fill="#fff" opacity="0.5" />
      <circle cx="16" cy="21.8" r="0.9" fill="#fff" opacity="0.38" />
    </svg>
  );
}

/** 圆角星形（描边 / 填充），主栏标题与侧栏收藏共用 */
/** 合集排序拖动手柄（三杠），与顶栏示意图标共用 */
function CollectionDragGripIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 6h10M8 12h10M8 18h10" />
    </svg>
  );
}

function CollectionStarIcon({
  filled,
  className,
}: {
  filled: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        d="M12 2.25 15.09 8.51 22 9.52 17 14.39 18.18 21.25 12 18.02 5.82 21.25 7 14.39 2 9.52 8.91 8.51 12 2.25z"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth={filled ? 0 : 1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

const FAVORITE_COLLECTIONS_STORAGE_PREFIX = "mikujar-favorite-collections:";

function favoriteCollectionsStorageKey(userId: string | null): string {
  return `${FAVORITE_COLLECTIONS_STORAGE_PREFIX}${userId ?? "guest"}`;
}

function loadFavoriteCollectionIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (x): x is string => typeof x === "string" && x.length > 0
      )
    );
  } catch {
    return new Set();
  }
}

function saveFavoriteCollectionIds(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* quota / 隐私模式 */
  }
}

const TRASH_CARDS_STORAGE_PREFIX = "mikujar-trash-cards:";

function trashCardsStorageKey(
  dataMode: AppDataMode,
  userId: string | null
): string {
  return `${TRASH_CARDS_STORAGE_PREFIX}${dataMode}:${userId ?? "guest"}`;
}

function isTrashedNoteEntry(x: unknown): x is TrashedNoteEntry {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.trashId === "string" &&
    o.trashId.length > 0 &&
    typeof o.colId === "string" &&
    typeof o.colPathLabel === "string" &&
    typeof o.deletedAt === "string" &&
    o.card !== null &&
    typeof o.card === "object" &&
    typeof (o.card as NoteCard).id === "string"
  );
}

function loadTrashedNoteEntries(key: string): TrashedNoteEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrashedNoteEntry);
  } catch {
    return [];
  }
}

function saveTrashedNoteEntries(
  key: string,
  entries: TrashedNoteEntry[]
): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

function cardTextMatchesQuery(card: NoteCard, q: string): boolean {
  if (htmlToPlainText(card.text).toLowerCase().includes(q)) return true;
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
  const line = htmlToPlainText(text).replace(/\s+/g, " ").trim();
  if (line.length <= maxLen) return line || "（无正文）";
  return `${line.slice(0, maxLen)}…`;
}

/** 侧栏角标：仅本合集一层的小笔记张数（子合集内的笔记不计入父行，避免空文件夹拖入子文件夹后父级误显示有笔记） */
function countSidebarCollectionCardBadge(c: Collection): number {
  return c.cards.length;
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
  /** 上下边缘各留一条「细带」，矮行用像素下限，避免 28%/72% 在 min-height 36px 上过窄难操作 */
  const margin = Math.max(10, Math.min(16, h * 0.3));
  if (y < margin) return "before";
  if (y > h - margin) return "after";
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
  if (url.startsWith(LOCAL_MEDIA_PREFIX)) {
    const seg =
      url.slice(LOCAL_MEDIA_PREFIX.length).split("/").pop() ?? "";
    const i = seg.indexOf("_");
    if (i >= 0 && i < seg.length - 1) {
      return decodeURIComponent(seg.slice(i + 1).replace(/\+/g, " "));
    }
    return seg || "文件";
  }
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

/** 侧栏头像+昵称；手机合集顶栏用 attachAvatarUpload=false 避免与顶栏 input 抢同一 ref */
function SidebarWorkspaceIdentity({
  writeRequiresLogin,
  currentUser,
  avatarInputRef,
  attachAvatarUpload,
  mediaUploadMode,
  avatarBusy,
  onAvatarFileChange,
}: {
  writeRequiresLogin: boolean;
  currentUser: AuthUser | null;
  avatarInputRef: Ref<HTMLInputElement>;
  attachAvatarUpload: boolean;
  mediaUploadMode: "cos" | "local" | null;
  avatarBusy: boolean;
  onAvatarFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="sidebar__workspace">
      {writeRequiresLogin && currentUser ? (
        <>
          {attachAvatarUpload ? (
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
          ) : (
            <div
              className="sidebar__avatar-hit sidebar__avatar-hit--static"
              aria-hidden
            >
              {currentUser.avatarUrl ? (
                <img
                  src={resolveMediaUrl(currentUser.avatarUrl)}
                  alt=""
                  className="sidebar__avatar-img"
                />
              ) : (
                <span className="sidebar__workspace-dot sidebar__workspace-dot--avatar" />
              )}
            </div>
          )}
          <div className="sidebar__workspace-text">
            <span className="sidebar__workspace-name">
              {currentUser.displayName || currentUser.username}
            </span>
          </div>
        </>
      ) : writeRequiresLogin && getAdminToken() ? (
        <>
          <span className="sidebar__workspace-dot" aria-hidden />
          <div className="sidebar__workspace-text">
            <span className="sidebar__workspace-name">恢复会话…</span>
          </div>
        </>
      ) : (
        <>
          <span className="sidebar__workspace-dot" aria-hidden />
          <span className="sidebar__workspace-name">mikujar</span>
        </>
      )}
    </div>
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
            <MediaLightboxImage
              url={lightbox.url}
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
            <MediaLightboxVideo
              url={lightbox.url}
              className="image-lightbox__img image-lightbox__video"
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
              <MediaLightboxCover
                url={lightbox.coverUrl}
                className="image-lightbox__audio-cover"
              />
            ) : null}
            <p className="image-lightbox__audio-title">
              {lightbox.name ?? fileLabelFromUrl(lightbox.url)}
            </p>
            <MediaLightboxAudio
              url={lightbox.url}
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
            <MediaOpenLink
              url={lightbox.url}
              className="image-lightbox__file-link"
            >
              在新窗口打开
            </MediaOpenLink>
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
            <MediaThumbImage
              url={current.url}
              className="card__gallery-thumb"
              alt=""
            />
          ) : current.kind === "audio" ? (
            <>
              <div className="card__gallery-audio-thumb">
                {current.coverUrl ? (
                  <>
                    <MediaThumbImage
                      url={current.coverUrl}
                      className="card__gallery-audio-cover"
                      alt=""
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
              <MediaThumbVideo
                url={current.url}
                className="card__gallery-thumb card__gallery-thumb--video"
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

/** 候选行大致高度（含 gap），供 ResizeObserver 估算可显示条数 */
const RELATED_PICK_ROW_EST_PX = 50;
const RELATED_PICK_POOL_MAX = 800;

/**
 * 源笔记与候选笔记的内容相似度（越大越靠前）。含标签、词片段、汉字重合与搜索词加权。
 */
function relatedPickSimilarity(
  sourceColId: string,
  sourceCard: NoteCard,
  col: Collection,
  card: NoteCard,
  path: string,
  query: string
): number {
  const srcText = htmlToPlainText(sourceCard.text ?? "").trim();
  const srcLower = srcText.toLowerCase();
  const srcTags = sourceCard.tags ?? [];
  const hay = `${htmlToPlainText(card.text ?? "").trim()}\n${(card.tags ?? []).join(" ")}\n${col.name}\n${path}`.toLowerCase();
  let score = 0;

  if (query) {
    const ql = query.toLowerCase();
    if (htmlToPlainText(card.text ?? "").toLowerCase().includes(ql)) score += 120;
    if (col.name.toLowerCase().includes(ql)) score += 60;
    if ((card.tags ?? []).some((t) => t.toLowerCase().includes(ql))) {
      score += 90;
    }
    if (path.toLowerCase().includes(ql)) score += 40;
  }

  for (const t of srcTags) {
    const tl = t.trim().toLowerCase();
    if (tl.length < 1) continue;
    if ((card.tags ?? []).some((x) => x.toLowerCase() === tl)) score += 85;
    else if (hay.includes(tl)) score += 28;
  }

  const tokens = srcLower.split(/[\s,.;，。；、\n\r]+/).filter((w) => w.length >= 2);
  const seen = new Set<string>();
  for (const w of tokens) {
    if (seen.has(w)) continue;
    seen.add(w);
    if (hay.includes(w)) score += Math.min(36, w.length * 4);
  }

  for (const ch of srcLower.replace(/\s/g, "")) {
    if (/[\u4e00-\u9fff]/.test(ch) && hay.includes(ch)) score += 1.15;
  }

  if (col.id === sourceColId) score += 18;

  return score;
}

/** 年月分栏输入；避免 type=month 受控时逐字改年会被浏览器解析成 1902 等错误值 */
function CalendarYearMonthFields({
  calendarViewMonth,
  setCalendarViewMonth,
}: {
  calendarViewMonth: Date;
  setCalendarViewMonth: (d: Date) => void;
}) {
  const syncKey = `${calendarViewMonth.getFullYear()}-${calendarViewMonth.getMonth()}`;
  const [yearField, setYearField] = useState(() =>
    String(calendarViewMonth.getFullYear())
  );
  const [monthField, setMonthField] = useState(() =>
    String(calendarViewMonth.getMonth() + 1)
  );

  useEffect(() => {
    setYearField(String(calendarViewMonth.getFullYear()));
    setMonthField(String(calendarViewMonth.getMonth() + 1));
  }, [syncKey]);

  const commit = useCallback(() => {
    const cy = calendarViewMonth.getFullYear();
    const cm = calendarViewMonth.getMonth() + 1;
    let y = parseInt(yearField.replace(/\D/g, ""), 10);
    let mo = parseInt(monthField.replace(/\D/g, ""), 10);
    if (yearField.trim() === "" || !Number.isFinite(y) || y < 1000 || y > 9999) {
      y = cy;
      setYearField(String(y));
    }
    if (
      monthField.trim() === "" ||
      !Number.isFinite(mo) ||
      mo < 1 ||
      mo > 12
    ) {
      mo = cm;
      setMonthField(String(mo));
    }
    setCalendarViewMonth(new Date(y, mo - 1, 1));
  }, [yearField, monthField, calendarViewMonth, setCalendarViewMonth]);

  return (
    <div className="sidebar__cal-title-wrap sidebar__cal-ym-fields">
      <input
        type="text"
        className="sidebar__cal-year-field"
        aria-label="年（四位数字）"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={yearField}
        onChange={(e) => {
          setYearField(e.target.value.replace(/\D/g, "").slice(0, 4));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="sidebar__cal-ym-sep" aria-hidden>
        年
      </span>
      <input
        type="text"
        className="sidebar__cal-month-field"
        aria-label="月（1–12）"
        inputMode="numeric"
        autoComplete="off"
        maxLength={2}
        value={monthField}
        onChange={(e) => {
          setMonthField(e.target.value.replace(/\D/g, "").slice(0, 2));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="sidebar__cal-ym-sep" aria-hidden>
        月
      </span>
    </div>
  );
}

type CalendarCellRow = (null | { day: number; dateStr: string })[];

function CalendarBrowsePanel({
  calendarViewMonth,
  setCalendarViewMonth,
  calendarCells,
  calendarDay,
  datesWithNotesSet,
  onDayClick,
}: {
  calendarViewMonth: Date;
  setCalendarViewMonth: (d: Date) => void;
  calendarCells: CalendarCellRow;
  calendarDay: string | null;
  datesWithNotesSet: ReadonlySet<string>;
  onDayClick: (dateStr: string) => void;
}) {
  return (
    <>
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
        <CalendarYearMonthFields
          calendarViewMonth={calendarViewMonth}
          setCalendarViewMonth={setCalendarViewMonth}
        />
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
              onClick={() => onDayClick(cell.dateStr)}
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
    </>
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
  const [pickSlots, setPickSlots] = useState(14);
  const pickGrowRef = useRef<HTMLDivElement>(null);
  const source = findCardInTree(collections, sourceColId, sourceCardId);

  useEffect(() => {
    setPickQuery("");
  }, [sourceColId, sourceCardId]);

  useLayoutEffect(() => {
    if (!canEdit || !source) return;
    const el = pickGrowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      const slots = Math.max(
        4,
        Math.min(120, Math.floor(h / RELATED_PICK_ROW_EST_PX))
      );
      setPickSlots(slots);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canEdit, source, sourceColId, sourceCardId, pickQuery]);

  const relatedList = useMemo(() => {
    if (!source) return [];
    const refs = source.card.relatedRefs ?? [];
    return refs.map((ref) => {
      const hit = findCardInTree(collections, ref.colId, ref.cardId);
      return { ref, hit };
    });
  }, [source, collections]);

  const pickCandidatesSorted = useMemo(() => {
    if (!source) return [];
    const flat = flattenAllCardsWithPath(collections, []);
    const q = pickQuery.trim().toLowerCase();
    const relatedSet = new Set(
      (source.card.relatedRefs ?? []).map(
        (r) => `${r.colId}\0${r.cardId}`
      )
    );
    relatedSet.add(`${sourceColId}\0${sourceCardId}`);
    const filtered = flat.filter(({ col, card }) => {
      if (relatedSet.has(`${col.id}\0${card.id}`)) return false;
      if (!q) return true;
      return (
        htmlToPlainText(card.text).toLowerCase().includes(q) ||
        (card.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        col.name.toLowerCase().includes(q)
      );
    });
    const scored = filtered.map((row) => ({
      col: row.col,
      card: row.card,
      path: row.path,
      score: relatedPickSimilarity(
        sourceColId,
        source.card,
        row.col,
        row.card,
        row.path,
        q
      ),
    }));
    scored.sort(
      (a, b) =>
        b.score - a.score || a.path.localeCompare(b.path, "zh-CN")
    );
    const top = scored.slice(0, RELATED_PICK_POOL_MAX);
    return top.map(({ col, card, path }) => ({ col, card, path }));
  }, [collections, pickQuery, source, sourceColId, sourceCardId]);

  const pickCandidatesShown = useMemo(
    () => pickCandidatesSorted.slice(0, pickSlots),
    [pickCandidatesSorted, pickSlots]
  );

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
        <div
          className={
            "related-panel__body" +
            (canEdit && source ? " related-panel__body--with-pick" : "")
          }
        >
          {!source ? (
            <p className="related-panel__hint">源笔记好像蒸发啦…</p>
          ) : (
            <>
              <div className="related-panel__upper">
                {relatedList.length === 0 ? (
                  <p className="related-panel__hint">
                    还没有贴上羁绊卡片，去下面搜一只来贴贴～
                  </p>
                ) : (
                  <ul className="related-panel__list">
                    {relatedList.map(({ ref, hit }) => (
                      <li
                        key={`${ref.colId}-${ref.cardId}`}
                        className={
                          "related-panel__item" +
                          (hit ? " related-panel__item--row" : "")
                        }
                      >
                        {hit ? (
                          <>
                            <button
                              type="button"
                              className="related-panel__item-hit"
                              onClick={() =>
                                onNavigateToCard(hit.col.id, hit.card.id)
                              }
                            >
                              <div className="related-panel__item-path">
                                {collectionPathLabel(collections, hit.col.id)}
                              </div>
                              <div className="related-panel__item-text">
                                {previewCardTextOneLine(hit.card.text)}
                              </div>
                            </button>
                            {canEdit ? (
                              <button
                                type="button"
                                className="related-panel__unlink"
                                aria-label="解除贴贴"
                                title="解除贴贴"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveRelation(ref.colId, ref.cardId);
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <div className="related-panel__missing-wrap related-panel__missing-row">
                            <p className="related-panel__missing">
                              那边笔记不见啦或打不开惹
                            </p>
                            {canEdit ? (
                              <button
                                type="button"
                                className="related-panel__unlink"
                                aria-label="撕掉坏掉的贴贴"
                                title="撕掉坏掉的贴贴"
                                onClick={() =>
                                  onRemoveRelation(ref.colId, ref.cardId)
                                }
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {canEdit ? (
                <div className="related-panel__add related-panel__add--fill">
                  <p className="related-panel__add-label">贴贴关联</p>
                  <input
                    type="text"
                    className="related-panel__add-input"
                    placeholder="搜一只笔记来贴贴…"
                    value={pickQuery}
                    onChange={(e) => setPickQuery(e.target.value)}
                    autoComplete="off"
                  />
                  <div
                    ref={pickGrowRef}
                    className="related-panel__pick-grow"
                  >
                    {pickCandidatesShown.length > 0 ? (
                      <>
                        <ul className="related-panel__pick-list">
                          {pickCandidatesShown.map(({ col, card, path }) => (
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
                        {pickCandidatesSorted.length >
                        pickCandidatesShown.length ? (
                          <p className="related-panel__pick-truncate-hint">
                            窗口里先塞得下相似度最高的{" "}
                            {pickCandidatesShown.length}{" "}
                            条，搜一搜可以缩圈～
                          </p>
                        ) : null}
                        <div
                          className="related-panel__pick-spacer"
                          aria-hidden
                        />
                      </>
                    ) : pickQuery.trim() ? (
                      <p className="related-panel__hint related-panel__hint--pick">
                        没找到合拍笔记，换个关键词试试？
                      </p>
                    ) : null}
                  </div>
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

  const { dataMode, setDataMode } = useAppDataMode();

  /**
   * 本地数据模式一律可编辑（合集/拖拽/删除仅依赖本地存储）。
   * 云端模式：已带 JWT 即允许编辑（/me 偶发失败时仍可能暂无 currentUser）；桌面壳在未登录时仍可改界面。
   */
  const canEdit = useMemo(
    () =>
      dataMode === "local" ||
      !writeRequiresLogin ||
      Boolean(currentUser) ||
      (writeRequiresLogin && Boolean(getAdminToken())) ||
      isTauri(),
    [dataMode, writeRequiresLogin, currentUser]
  );

  const favoriteStorageKey = useMemo(
    () => favoriteCollectionsStorageKey(currentUser?.id ?? null),
    [currentUser?.id]
  );

  const trashStorageKey = useMemo(
    () => trashCardsStorageKey(dataMode, currentUser?.id ?? null),
    [dataMode, currentUser?.id]
  );

  const [collections, setCollections] = useState<Collection[]>(() =>
    cloneInitialCollections()
  );
  const [activeId, setActiveId] = useState(
    () => initialCollections[0]?.id ?? ""
  );
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** 未输入内容时是否展开顶栏搜索框（有内容时始终展开） */
  const [searchBarOpen, setSearchBarOpen] = useState(false);
  const mainSearchInputRef = useRef<HTMLInputElement>(null);
  const mainHeaderRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
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
  const [collectionDeleteDialog, setCollectionDeleteDialog] = useState<{
    id: string;
    displayName: string;
    hasSubtree: boolean;
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
  const [favoriteCollectionIds, setFavoriteCollectionIds] = useState<
    Set<string>
  >(() => new Set());
  const [trashEntries, setTrashEntries] = useState<TrashedNoteEntry[]>([]);
  const [trashViewActive, setTrashViewActive] = useState(false);
  const [draggingCollectionId, setDraggingCollectionId] = useState<
    string | null
  >(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    position: CollectionDropPosition;
  } | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  /** 云端模式下仅在一次成功的 GET /collections 之后才开放写入（粒度化 API 内部自行检查） */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_remoteSaveAllowed, setRemoteSaveAllowed] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_apiOnline, setApiOnline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mediaUploadMode, setMediaUploadMode] = useState<
    "cos" | "local" | null
  >(null);
  const canAttachMedia = useMemo(
    () => Boolean(mediaUploadMode) || dataMode === "local",
    [mediaUploadMode, dataMode]
  );
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
  /** 卡片文本编辑的防抖计时器：key = cardId，value = setTimeout handle */
  const textSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const cardMediaUploadTargetRef = useRef<{
    colId: string;
    cardId: string;
  } | null>(null);
  const cardMediaFileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  /** 小笔记拖动会话：供 dragOver 识别（部分浏览器 types 不可靠） */
  const noteCardDragActiveRef = useRef(false);
  /** 合集拖拽 id：在 dragStart 同步写入，避免 state 晚一帧时 dragOver 未 preventDefault 导致无法放置 */
  const draggingCollectionIdRef = useRef<string | null>(null);

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
  const [mobileBrowseEditMode, setMobileBrowseEditMode] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  /** 手机底栏罐子：底部横线纸速记层 */
  const [mobileQuickCaptureOpen, setMobileQuickCaptureOpen] =
    useState(false);
  const [mobileQuickCaptureText, setMobileQuickCaptureText] =
    useState("");
  /** 打开速记层瞬间的时刻，与左上角展示、落库卡片一致 */
  const [mobileQuickCaptureHead, setMobileQuickCaptureHead] = useState<{
    minutesOfDay: number;
    addedOn: string;
  } | null>(null);
  const mobileQuickCaptureDraftRef = useRef("");
  const mobileQuickCaptureAreaRef = useRef<HTMLTextAreaElement>(null);
  const [relatedPanel, setRelatedPanel] = useState<{
    colId: string;
    cardId: string;
  } | null>(null);
  const mobileNavSelRef = useRef<{
    activeId: string;
    calendarDay: string | null;
  } | null>(null);
  /** 新建合集/子合集会改 activeId；勿因此关掉手机侧栏，便于当场改名称 */
  const skipCloseMobileNavOnActiveChangeRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onMq = () => {
      if (!mq.matches) {
        setMobileNavOpen(false);
        setMobileCalendarOpen(false);
        setMobileQuickCaptureOpen(false);
      }
    };
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) setMobileBrowseEditMode(false);
  }, [mobileNavOpen]);

  useEffect(() => {
    const lockScroll =
      mobileNavOpen ||
      mobileCalendarOpen ||
      mobileQuickCaptureOpen ||
      relatedPanel !== null;
    if (!lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen, mobileCalendarOpen, mobileQuickCaptureOpen, relatedPanel]);

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
    if (!mobileCalendarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileCalendarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileCalendarOpen]);

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
      if (skipCloseMobileNavOnActiveChangeRef.current) {
        skipCloseMobileNavOnActiveChangeRef.current = false;
      } else {
        setMobileNavOpen(false);
      }
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
            e instanceof Error ? e.message : "小伙伴名单没拉出来…"
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
        e instanceof Error ? e.message : "小伙伴名单没拉出来…"
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
          "头像上传要先开服务器媒体存储（COS 或本地 public）喵"
        );
        return;
      }
      setAvatarBusy(true);
      setSidebarFlash(null);
      try {
        await uploadMyAvatar(file);
        await refreshMe();
        setSidebarFlash("头像换新成功～");
      } catch (err: unknown) {
        setSidebarFlash(
          err instanceof Error ? err.message : "头像翻车啦，再试一次？"
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
      setUserAdminFormErr("用户名和密码都要填好噢");
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
        e instanceof Error ? e.message : "拉新失败惹，看看报错？"
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
      if (!window.confirm(`要把用户「${u.username}」请出群吗？（删除不可撤销）`))
        return;
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
          e instanceof Error ? e.message : "送走失败惹…"
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
          e instanceof Error ? e.message : "改身份失败惹…"
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
        setUserAdminFormErr("新口令至少 4 位啦");
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
          e instanceof Error ? e.message : "换口令失败惹…"
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

    if (dataMode === "local") {
      setMediaUploadMode(null);
      setApiOnline(true);
      setLoadError(null);
      setSaveError(null);
      setCollections(loadLocalCollections(cloneInitialCollections));
      setRemoteLoaded(true);
      return;
    }

    setRemoteSaveAllowed(false);
    // 已登录（含仅有 JWT、/me 尚未返回）：拉取完成前保持 remoteLoaded=false，避免示例数据被自动保存覆盖服务器
    if (writeRequiresLogin && (currentUser || getAdminToken())) {
      setRemoteLoaded(false);
    }
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
      /* 无 JWT 才当游客示例；仅有 token、/me 尚未成功时仍拉远程笔记，避免误显示未登录 */
      if (writeRequiresLogin && !currentUser && !getAdminToken()) {
        setCollections(cloneInitialCollections());
        setLoadError(null);
        setSaveError(null);
        setApiOnline(online);
        setRemoteSaveAllowed(false);
        setRemoteLoaded(true);
        return;
      }
      const data = await fetchCollectionsFromApi();
      if (cancelled) return;
      if (data !== null) {
        setCollections(migrateCollectionTree(data));
        setApiOnline(true);
        setLoadError(null);
        setRemoteSaveAllowed(true);
      } else {
        setRemoteSaveAllowed(false);
        if (writeRequiresLogin && (currentUser || getAdminToken())) {
          setLoadError(
            "笔记加载摔了一跤… 看看网络或重新登录试试？"
          );
          /* 勿置空数组：无合集时 active 为空，底栏加号等会全部禁用，像「啥也点不了」 */
          setCollections(cloneInitialCollections());
          setApiOnline(false);
        } else {
          setLoadError(
            "连不上服务器喵～先用本地示例顶一顶，把后端开起来（见说明）再刷新就能同步啦。"
          );
          setApiOnline(online);
        }
      }
      setRemoteLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, dataMode, writeRequiresLogin, currentUser?.id]);

  useEffect(() => {
    if (!authReady) return;
    setFavoriteCollectionIds(loadFavoriteCollectionIds(favoriteStorageKey));
  }, [authReady, favoriteStorageKey]);

  useEffect(() => {
    if (!authReady) return;
    setTrashEntries(loadTrashedNoteEntries(trashStorageKey));
  }, [authReady, trashStorageKey]);

  useEffect(() => {
    if (calendarDay) setTrashViewActive(false);
  }, [calendarDay]);

  useEffect(() => {
    if (!remoteLoaded || !authReady) return;
    const valid = new Set<string>();
    walkCollections(collections, (c) => valid.add(c.id));
    setFavoriteCollectionIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      if (next.size === prev.size) return prev;
      saveFavoriteCollectionIds(favoriteStorageKey, next);
      return next;
    });
  }, [collections, remoteLoaded, authReady, favoriteStorageKey]);

  useEffect(() => {
    if (!remoteLoaded || !authReady) return;

    if (dataMode === "local") {
      const id = window.setTimeout(() => {
        try {
          saveLocalCollections(collections);
          setSaveError(null);
        } catch (e) {
          const quota =
            e instanceof DOMException && e.name === "QuotaExceededError";
          setSaveError(
            quota
              ? "本地存满啦，清掉点缓存或删掉大附件再试～"
              : "本地保存失败惹…"
          );
        }
      }, 900);
      return () => window.clearTimeout(id);
    }

    // remote 模式：各操作函数已单独持久化到 PostgreSQL，不再做全量 PUT
  }, [
    collections,
    dataMode,
    remoteLoaded,
    authReady,
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

  const favoriteSidebarEntries = useMemo(() => {
    const all = walkCollectionsWithPath(collections, []);
    return all.filter(({ col }) => favoriteCollectionIds.has(col.id));
  }, [collections, favoriteCollectionIds]);

  const searchTrim = searchQuery.trim();
  const searchActive = searchTrim.length > 0;
  const searchExpanded = searchBarOpen || searchActive;

  useEffect(() => {
    if (searchActive) setTrashViewActive(false);
  }, [searchActive]);

  useLayoutEffect(() => {
    if (!searchExpanded) return;
    const id = requestAnimationFrame(() => {
      if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
        mainSearchInputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [searchExpanded]);

  /** 展开搜索时滚到顶栏（含搜索框），并把时间线滚到顶，进入完整「搜索页」布局 */
  const prevSearchExpandedRef = useRef(false);
  useLayoutEffect(() => {
    const prev = prevSearchExpandedRef.current;
    prevSearchExpandedRef.current = searchExpanded;
    if (!searchExpanded || prev) return;
    const id = requestAnimationFrame(() => {
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      }
      mainHeaderRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      timelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [searchExpanded]);

  /** 开始输入关键词时把时间线滚到顶，直接看到搜索结果 */
  const prevSearchActiveRef = useRef(false);
  useLayoutEffect(() => {
    const prev = prevSearchActiveRef.current;
    prevSearchActiveRef.current = searchActive;
    if (!searchActive || prev) return;
    const el = timelineRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [searchActive]);

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

  const onPickCalendarDay = useCallback((dateStr: string) => {
    setSearchQuery("");
    setSearchBarOpen(false);
    setCalendarDay(dateStr);
    const [yy, mm] = dateStr.split("-").map(Number);
    setCalendarViewMonth(new Date(yy, mm - 1, 1));
  }, []);

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
      let newPinned: boolean | undefined;
      setCollections((prev) => {
        const col = findCollectionById(prev, colId);
        const card = col?.cards.find((c) => c.id === cardId);
        newPinned = !card?.pinned;
        return mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) =>
            cd.id === cardId ? { ...cd, pinned: newPinned } : cd
          ),
        }));
      });
      if (dataMode !== "local") {
        // newPinned 在 setCollections 回调中同步赋值
        Promise.resolve().then(() => {
          if (newPinned !== undefined) {
            void updateCardApi(cardId, { pinned: newPinned });
          }
        });
      }
    },
    [dataMode]
  );

  const deleteCard = useCallback(
    (colId: string, cardId: string) => {
      const col = findCollectionById(collections, colId);
      const card = col?.cards.find((c) => c.id === cardId);
      if (card && canEdit) {
        const entry: TrashedNoteEntry = {
          trashId: `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          colId,
          colPathLabel: collectionPathLabel(collections, colId),
          card: structuredClone(card) as NoteCard,
          deletedAt: new Date().toISOString(),
        };
        setTrashEntries((te) => {
          const next = [entry, ...te];
          saveTrashedNoteEntries(trashStorageKey, next);
          return next;
        });
      }
      setCollections((prev) => {
        const next = mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.filter((c0) => c0.id !== cardId),
        }));
        return stripRelatedRefsToTarget(next, colId, cardId);
      });
      setCardMenuId(null);
      setRelatedPanel((p) =>
        p?.colId === colId && p?.cardId === cardId ? null : p
      );
      if (dataMode !== "local") {
        void deleteCardApi(cardId);
      }
    },
    [canEdit, collections, trashStorageKey, dataMode]
  );

  const restoreTrashedEntry = useCallback(
    (entry: TrashedNoteEntry) => {
      if (!canEdit) return;
      if (!findCollectionById(collections, entry.colId)) {
        setSidebarFlash("原合集不见啦，这条笔记捞不回去惹…");
        return;
      }
      setTrashEntries((te) => {
        const next = te.filter((t) => t.trashId !== entry.trashId);
        saveTrashedNoteEntries(trashStorageKey, next);
        return next;
      });
      setCollections((prev) =>
        mapCollectionById(prev, entry.colId, (col) => ({
          ...col,
          cards: [...col.cards, structuredClone(entry.card) as NoteCard],
        }))
      );
      setTrashViewActive(false);
      setActiveId(entry.colId);
      setCalendarDay(null);
      setMobileNavOpen(false);
    },
    [canEdit, collections, trashStorageKey]
  );

  const purgeTrashedEntry = useCallback(
    (trashId: string) => {
      if (!canEdit) return;
      if (
        !window.confirm(
          "真的要永久删掉这条小笔记吗？（回收站记录也会一起消失，回不去那种）"
        )
      ) {
        return;
      }
      setTrashEntries((te) => {
        const victim = te.find((t) => t.trashId === trashId);
        if (victim) {
          for (const m of victim.card.media ?? []) {
            void deleteLocalMediaFile(m.url);
          }
        }
        const next = te.filter((t) => t.trashId !== trashId);
        saveTrashedNoteEntries(trashStorageKey, next);
        return next;
      });
    },
    [canEdit, trashStorageKey]
  );

  const emptyTrash = useCallback(() => {
    if (!canEdit || trashEntries.length === 0) return;
    if (
      !window.confirm(
        `垃圾桶里一共 ${trashEntries.length} 条，要全部清空吗？会永久消失回不来的那种！`
      )
    ) {
      return;
    }
    for (const e of trashEntries) {
      for (const m of e.card.media ?? []) {
        void deleteLocalMediaFile(m.url);
      }
    }
    setTrashEntries([]);
    saveTrashedNoteEntries(trashStorageKey, []);
  }, [canEdit, trashEntries, trashStorageKey]);

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
      if (dataMode !== "local") {
        // 文本编辑高频触发，加 400ms 防抖后再持久化
        const existing = textSaveTimers.current.get(cardId);
        if (existing) clearTimeout(existing);
        textSaveTimers.current.set(
          cardId,
          setTimeout(() => {
            void updateCardApi(cardId, { text });
            textSaveTimers.current.delete(cardId);
          }, 400)
        );
      }
    },
    [dataMode]
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
      if (dataMode !== "local") {
        void updateCardApi(cardId, { tags });
      }
    },
    [dataMode]
  );

  const addMediaItemToCard = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      let nextMedia: NoteMediaItem[] | undefined;
      setCollections((prev) => {
        const col = findCollectionById(prev, colId);
        const card = col?.cards.find((c) => c.id === cardId);
        nextMedia = [...(card?.media ?? []), item];
        return mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) =>
            cd.id === cardId ? { ...cd, media: nextMedia } : cd
          ),
        }));
      });
      if (dataMode !== "local") {
        Promise.resolve().then(() => {
          if (nextMedia !== undefined) {
            void updateCardApi(cardId, { media: nextMedia });
          }
        });
      }
    },
    [dataMode]
  );

  const uploadFilesToCard = useCallback(
    async (colId: string, cardId: string, files: File[]) => {
      if (files.length === 0) return;
      setUploadBusyCardId(cardId);
      try {
        if (dataMode === "local") {
          if (isTauri()) {
            for (const file of files) {
              try {
                const r = await saveLocalMediaToAppFolder(file);
                addMediaItemToCard(
                  colId,
                  cardId,
                  mediaItemFromUploadResult(r)
                );
              } catch (err) {
                window.alert(
                  err instanceof Error
                    ? err.message
                    : "存到本地文件夹失败，再试一次？"
                );
              }
            }
          } else {
            for (const file of files) {
              try {
                const r = await saveLocalMediaInlineInBrowser(file);
                addMediaItemToCard(
                  colId,
                  cardId,
                  mediaItemFromUploadResult(r)
                );
              } catch (err) {
                window.alert(
                  err instanceof Error
                    ? err.message
                    : "内联保存附件失败，可换小文件或改用桌面版～"
                );
              }
            }
          }
          return;
        }
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
          err instanceof Error ? err.message : "附件上传翻车啦，再试一次？"
        );
      } finally {
        setUploadBusyCardId(null);
      }
    },
    [addMediaItemToCard, dataMode]
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

  const clearCardMedia = useCallback(
    (colId: string, cardId: string) => {
      setCollections((prev) => {
        const col = findCollectionById(prev, colId);
        const card = col?.cards.find((c) => c.id === cardId);
        for (const m of card?.media ?? []) {
          void deleteLocalMediaFile(m.url);
        }
        return mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) => {
            if (cd.id !== cardId) return cd;
            const { media: _m, ...rest } = cd;
            return rest;
          }),
        }));
      });
      setCardMenuId(null);
      if (dataMode !== "local") {
        void updateCardApi(cardId, { media: [] });
      }
    },
    [dataMode]
  );

  const removeCardMediaItem = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      void deleteLocalMediaFile(item.url);
      let nextMedia: NoteMediaItem[] | undefined;
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
            nextMedia = next;
            if (next.length === 0) {
              const { media: _m, ...rest } = card;
              return rest;
            }
            return { ...card, media: next };
          }),
        }))
      );
      if (dataMode !== "local") {
        Promise.resolve().then(() => {
          void updateCardApi(cardId, { media: nextMedia ?? [] });
        });
      }
    },
    [dataMode]
  );

  /**
   * 向当前选中合集追加一张小笔记；返回新卡片 id，条件不满足时返回 null。
   */
  const appendNoteCardWithHtml = useCallback(
    (
      htmlBody: string,
      timeOverride?: { minutesOfDay: number; addedOn: string }
    ) => {
      if (!canEdit) return null;
      if (trashViewActive) return null;
      if (calendarDay !== null) return null;
      if (searchQuery.trim().length > 0) return null;
      const targetColId = active?.id;
      if (!targetColId) return null;
      const now = new Date();
      const minutesOfDay =
        timeOverride?.minutesOfDay ??
        now.getHours() * 60 + now.getMinutes();
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const cardId = `n-${uid}`;
      const day = timeOverride?.addedOn ?? localDateString(now);
      const newCard: NoteCard = {
        id: cardId,
        text: htmlBody,
        minutesOfDay,
        addedOn: day,
      };

      setCollections((prev) =>
        mapCollectionById(prev, targetColId, (col) => ({
          ...col,
          cards: [...col.cards, newCard],
        }))
      );
      if (dataMode !== "local") {
        void createCardApi(targetColId, newCard);
      }
      return cardId;
    },
    [canEdit, trashViewActive, calendarDay, active?.id, searchQuery, dataMode]
  );

  const dismissMobileQuickCapture = useCallback(() => {
    setMobileQuickCaptureOpen(false);
    setMobileQuickCaptureText("");
    mobileQuickCaptureDraftRef.current = "";
    setMobileQuickCaptureHead(null);
  }, []);

  const commitMobileQuickCapture = useCallback(() => {
    const plain = mobileQuickCaptureDraftRef.current.trim();
    const headSnap = mobileQuickCaptureHead;
    dismissMobileQuickCapture();
    if (!plain) return;
    const cardId = appendNoteCardWithHtml(
      noteBodyToHtml(plain),
      headSnap
        ? {
            minutesOfDay: headSnap.minutesOfDay,
            addedOn: headSnap.addedOn,
          }
        : undefined
    );
    if (!cardId) return;
    const scrollTimelineToEnd = () => {
      const el = timelineRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollTimelineToEnd);
    });
  }, [
    appendNoteCardWithHtml,
    dismissMobileQuickCapture,
    mobileQuickCaptureHead,
  ]);

  /** 点遮罩：有字则保存并关闭，无字则直接关（同 flomo 类交互） */
  const onQuickCaptureBackdrop = useCallback(() => {
    const plain = mobileQuickCaptureDraftRef.current.trim();
    if (plain) commitMobileQuickCapture();
    else dismissMobileQuickCapture();
  }, [commitMobileQuickCapture, dismissMobileQuickCapture]);

  /**
   * 侧栏选中合集时：新卡片带当前时刻与今日 addedOn，便于日历聚合。
   * 选中日历某日（按日浏览）时不允许新建小笔记。
   */
  const addSmallNote = useCallback(() => {
    const cardId = appendNoteCardWithHtml("");
    if (!cardId) return;
    queueMicrotask(() => {
      document.getElementById(`card-text-${cardId}`)?.focus();
    });
  }, [appendNoteCardWithHtml]);

  /* 勿对 textarea 做「先 readOnly 再下一帧取消」：iOS 会认为可编辑时机已脱离用户手势，键盘不再弹出 */
  useLayoutEffect(() => {
    if (!mobileQuickCaptureOpen) return;
    mobileQuickCaptureAreaRef.current?.focus({ preventScroll: true });
  }, [mobileQuickCaptureOpen]);

  useEffect(() => {
    if (!mobileQuickCaptureOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissMobileQuickCapture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileQuickCaptureOpen, dismissMobileQuickCapture]);

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
    skipCloseMobileNavOnActiveChangeRef.current = true;
    setTrashViewActive(false);
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
    skipCloseMobileNavOnActiveChangeRef.current = true;
    setTrashViewActive(false);
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

  const toggleFavoriteCollection = useCallback(
    (id: string) => {
      setFavoriteCollectionIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveFavoriteCollectionIds(favoriteStorageKey, next);
        return next;
      });
    },
    [favoriteStorageKey]
  );

  const performRemoveCollection = useCallback(
    (id: string) => {
      if (!canEdit) return;
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
        setFavoriteCollectionIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const sid of subtreeIds) {
            if (next.has(sid)) {
              next.delete(sid);
              changed = true;
            }
          }
          if (!changed) return prev;
          saveFavoriteCollectionIds(favoriteStorageKey, next);
          return next;
        });
      }
    },
    [canEdit, favoriteStorageKey]
  );

  const openRemoveCollectionDialog = useCallback(
    (id: string, displayName: string, hasSubtree: boolean) => {
      if (!canEdit) return;
      setCollectionCtxMenu(null);
      setCollectionDeleteDialog({
        id,
        displayName,
        hasSubtree,
      });
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
      draggingCollectionIdRef.current = id;
      setDraggingCollectionId(id);
    },
    [canEdit]
  );

  const onCollectionRowDragEnd = useCallback(() => {
    draggingCollectionIdRef.current = null;
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
      if (draggingCollectionIdRef.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const el = e.currentTarget as HTMLElement;
      setDropIndicator({
        targetId: id,
        position: dropPositionFromEvent(e, el),
      });
    },
    [canEdit]
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
      const dragId = (
        e.dataTransfer.getData(COLLECTION_DRAG_MIME) ||
        e.dataTransfer.getData("text/plain")
      ).trim();
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
      draggingCollectionIdRef.current = null;
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
    const onDocClick = (e: Event) => {
      const el = document.querySelector("[data-collection-ctx-menu]");
      if (!el?.contains(e.target as Node)) {
        setCollectionCtxMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollectionCtxMenu(null);
    };
    const tid = window.setTimeout(() => {
      document.addEventListener("click", onDocClick);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [collectionCtxMenu]);

  useEffect(() => {
    if (collectionDeleteDialog === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollectionDeleteDialog(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [collectionDeleteDialog]);

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

  useEffect(() => {
    setCardMenuId(null);
  }, [trashViewActive]);

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
          (cardDragOverId === card.id && canEdit && canAttachMedia
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
          if (!canAttachMedia) return;
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
          if (!canAttachMedia) return;
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
          if (!canAttachMedia) return;
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
          if (!canAttachMedia) return;
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
          <div
            className={
              "card__move-rail" +
              (canEdit ? "" : " card__move-rail--readonly")
            }
            draggable={canEdit}
            aria-label={
              canEdit
                ? "拖动以移动小笔记"
                : "侧栏条（登录后可拖动排列）"
            }
            title={
              canEdit
                ? "按住拖到其他卡片旁或侧栏合集"
                : "登录后可拖动小笔记排序"
            }
            onDragStart={
              canEdit
                ? (e: DragEvent<HTMLDivElement>) => {
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
                  }
                : undefined
            }
            onDragEnd={
              canEdit
                ? () => {
                    noteCardDragActiveRef.current = false;
                    setDraggingNoteCardKey(null);
                    setCardDropMarker(null);
                    setNoteCardDropCollectionId(null);
                  }
                : undefined
            }
          />
          <div
            className={
              "card__paper" +
              (hasGallery ? " card__paper--with-gallery" : "") +
              " card__paper--with-move-rail"
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
                      {canEdit && canAttachMedia ? (
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
            <NoteCardTiptap
              id={`card-text-${card.id}`}
              value={card.text}
              canEdit={canEdit}
              ariaLabel="笔记正文"
              onChange={(next) => setCardText(colId, card.id, next)}
              onPasteFiles={
                canEdit && canAttachMedia
                  ? (files) => {
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

  /** 垃圾桶内：与普通小笔记相同的卡片布局，仅菜单为恢复 / 永久删除 */
  const renderTrashCard = (entry: TrashedNoteEntry) => {
    const card = entry.card;
    const media = (card.media ?? []).filter((m) => m.url?.trim());
    const hasGallery = media.length > 0;
    const menuId = `__trash__${entry.trashId}`;
    const noteKey = `trash-${entry.trashId}`;
    return (
      <li
        key={noteKey}
        className={
          "card card--in-trash" +
          (cardMenuId === menuId ? " is-menu-open" : "")
        }
        title={
          entry.colPathLabel
            ? `原所在合集：${entry.colPathLabel}`
            : undefined
        }
      >
        <div
          className={
            "card__inner" + (hasGallery ? " card__inner--split" : "")
          }
        >
          <div
            className={
              "card__paper" +
              (hasGallery ? " card__paper--with-gallery" : "")
            }
          >
            <div className="card__toolbar">
              <span className="card__time">
                {formatCardTimeLabel(card)}
              </span>
              <div className="card__toolbar-actions">
                {canEdit ? (
                  <div
                    className="card__menu-root"
                    data-card-menu-root={menuId}
                  >
                    <button
                      type="button"
                      className="card__more"
                      aria-label="更多操作"
                      aria-expanded={cardMenuId === menuId}
                      onClick={() =>
                        setCardMenuId((id) =>
                          id === menuId ? null : menuId
                        )
                      }
                    >
                      …
                    </button>
                    {cardMenuId === menuId ? (
                      <div
                        className="card__menu"
                        role="menu"
                        aria-orientation="vertical"
                      >
                        <button
                          type="button"
                          className="card__menu-item"
                          role="menuitem"
                          onClick={() => {
                            setCardMenuId(null);
                            restoreTrashedEntry(entry);
                          }}
                        >
                          恢复到原合集
                        </button>
                        <button
                          type="button"
                          className="card__menu-item card__menu-item--danger"
                          role="menuitem"
                          onClick={() => {
                            setCardMenuId(null);
                            purgeTrashedEntry(entry.trashId);
                          }}
                        >
                          永久删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="card__toolbar-spacer" aria-hidden />
                )}
              </div>
            </div>
            <NoteCardTiptap
              id={`trash-card-text-${entry.trashId}`}
              value={card.text}
              canEdit={false}
              ariaLabel="笔记正文"
              onChange={() => {}}
            />
            <CardTagsRow
              colId={entry.colId}
              card={card}
              canEdit={false}
              onCommit={() => {}}
            />
          </div>
          {hasGallery ? (
            <CardGallery items={media} />
          ) : null}
        </div>
      </li>
    );
  };

  const timelineEmpty = (active?.cards.length ?? 0) === 0;
  const listEmpty = pinned.length === 0 && rest.length === 0;

  const hideAddsInMobileBrowse =
    mobileNavOpen && !mobileBrowseEditMode;
  /** 小屏编辑态：整行 draggable 易与滚动冲突，仅右侧三杠发起拖拽 */
  const mobileCollectionDragByHandle =
    mobileNavOpen && mobileBrowseEditMode;

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
              (c.id === active?.id && !calendarDay && !trashViewActive
                ? " is-active"
                : "") +
              (c.id === draggingCollectionId
                ? " sidebar__tree-row--dragging"
                : "") +
              (noteCardDropCollectionId === c.id
                ? " sidebar__tree-row--note-card-drop"
                : "") +
              dropCls
            }
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={
              canEdit &&
              editingCollectionId !== c.id &&
              !mobileCollectionDragByHandle
            }
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
                setTrashViewActive(false);
                setCalendarDay(null);
                expandAncestorsOf(c.id);
                setActiveId(c.id);
                /* 与收藏行一致：手机点当前已选合集时 activeId 不变，仅靠 effect 不会关抽屉 */
                setMobileNavOpen(false);
              }}
              onKeyDown={(e) => {
                if (editingCollectionId === c.id) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTrashViewActive(false);
                  setCalendarDay(null);
                  expandAncestorsOf(c.id);
                  setActiveId(c.id);
                  setMobileNavOpen(false);
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
                {countSidebarCollectionCardBadge(c)}
              </span>
            </div>
            {canEdit ? (
              <div className="sidebar__tree-row__tail">
                {!hideAddsInMobileBrowse ? (
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
                  <span
                    className="sidebar__add-sub-spacer"
                    aria-hidden
                  />
                )}
                {mobileCollectionDragByHandle ? (
                  editingCollectionId !== c.id ? (
                    <div
                      className="sidebar__tree-drag-handle"
                      draggable
                      onDragStart={(e) =>
                        onCollectionRowDragStart(c.id, e)
                      }
                      onDragEnd={onCollectionRowDragEnd}
                      aria-label="拖动调整合集顺序"
                      title="拖动调整顺序"
                    >
                      <CollectionDragGripIcon className="sidebar__tree-drag-handle__svg" />
                    </div>
                  ) : (
                    <span
                      className="sidebar__tree-drag-handle-spacer"
                      aria-hidden
                    />
                  )
                ) : null}
              </div>
            ) : null}
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
        <div className="sidebar__mobile-browse-bar">
          {mobileNavOpen ? (
            <div className="sidebar__mobile-browse-user">
              <SidebarWorkspaceIdentity
                writeRequiresLogin={writeRequiresLogin}
                currentUser={currentUser}
                avatarInputRef={avatarInputRef}
                attachAvatarUpload={false}
                mediaUploadMode={mediaUploadMode}
                avatarBusy={avatarBusy}
                onAvatarFileChange={onAvatarFileChange}
              />
              {dataMode === "remote" ? (
                <button
                  type="button"
                  className={
                    "sidebar__admin-icon-btn sidebar__admin-icon-btn--mobile-browse" +
                    (currentUser || getAdminToken()
                      ? " sidebar__admin-icon-btn--on"
                      : "")
                  }
                  onClick={
                    currentUser || getAdminToken() ? logout : openLogin
                  }
                  aria-label={
                    currentUser || getAdminToken() ? "退出登录" : "登录"
                  }
                  title={
                    currentUser || getAdminToken()
                      ? "下次再见啦～"
                      : "开门登录～"
                  }
                >
                  <AdminHeaderIcon
                    mode={
                      currentUser || getAdminToken() ? "logout" : "login"
                    }
                  />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="sidebar__mobile-browse-actions">
            {canEdit ? (
              <>
                <button
                  type="button"
                  className={
                    "sidebar__mobile-browse-action" +
                    (mobileBrowseEditMode
                      ? " sidebar__mobile-browse-action--on"
                      : "")
                  }
                  aria-pressed={mobileBrowseEditMode}
                  aria-label={
                    mobileBrowseEditMode
                      ? "完成编辑"
                      : "编辑合集结构"
                  }
                  onClick={() =>
                    setMobileBrowseEditMode((v) => !v)
                  }
                >
                  {mobileBrowseEditMode ? "完成" : "编辑"}
                </button>
                <button
                  type="button"
                  className="sidebar__mobile-browse-action sidebar__mobile-browse-action--emph sidebar__mobile-browse-action--icon"
                  aria-label="新建合集"
                  title="新建合集"
                  onClick={() => addCollection()}
                >
                  <svg
                    className="sidebar__mobile-browse-action__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="sidebar__header">
          <div className="sidebar__header-row">
            {!mobileNavOpen ? (
              <SidebarWorkspaceIdentity
                writeRequiresLogin={writeRequiresLogin}
                currentUser={currentUser}
                avatarInputRef={avatarInputRef}
                attachAvatarUpload
                mediaUploadMode={mediaUploadMode}
                avatarBusy={avatarBusy}
                onAvatarFileChange={onAvatarFileChange}
              />
            ) : null}
            <div className="sidebar__header-actions">
              <div
                className="sidebar__data-mode"
                role="group"
                aria-label="数据存储方式"
              >
                {isTauri() ? (
                  <button
                    type="button"
                    className={
                      "sidebar__data-mode-btn" +
                      (dataMode === "local"
                        ? " sidebar__data-mode-btn--active"
                        : "")
                    }
                    aria-pressed={dataMode === "local"}
                    onClick={() => setDataMode("local")}
                    title="仅保存在本机，不上传服务器"
                  >
                    本地
                  </button>
                ) : null}
                <button
                  type="button"
                  className={
                    "sidebar__data-mode-btn" +
                    (dataMode === "remote"
                      ? " sidebar__data-mode-btn--active"
                      : "")
                  }
                  aria-pressed={dataMode === "remote"}
                  onClick={() => setDataMode("remote")}
                  title={`连接 ${DEFAULT_TAURI_REMOTE_API.replace(/^https?:\/\//, "")} 同步与登录`}
                >
                  云端
                </button>
              </div>
              {dataMode === "remote" ? (
                <>
                  {writeRequiresLogin && isAdmin ? (
                    <button
                      type="button"
                      className="sidebar__users-btn"
                      onClick={() => setUserAdminOpen(true)}
                      title="小伙伴管理台"
                    >
                      用户
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={
                      "sidebar__admin-icon-btn" +
                      (currentUser || getAdminToken()
                        ? " sidebar__admin-icon-btn--on"
                        : "")
                    }
                    onClick={
                      currentUser || getAdminToken() ? logout : openLogin
                    }
                    aria-label={
                      currentUser || getAdminToken() ? "退出登录" : "登录"
                    }
                    title={
                      currentUser || getAdminToken()
                        ? "下次再见啦～"
                        : "开门登录～"
                    }
                  >
                    <AdminHeaderIcon
                      mode={
                        currentUser || getAdminToken() ? "logout" : "login"
                      }
                    />
                  </button>
                </>
              ) : null}
            </div>
            <button
              type="button"
              className="sidebar__mobile-close"
              aria-label="关闭菜单"
              onClick={() => setMobileNavOpen(false)}
            >
              <span aria-hidden>×</span>
            </button>
          </div>
          {sidebarFlash ? (
            <p className="sidebar__flash" role="status">
              {sidebarFlash}
            </p>
          ) : null}
        </div>

        <div className="sidebar__calendar" aria-label="按日期浏览">
          <CalendarBrowsePanel
            calendarViewMonth={calendarViewMonth}
            setCalendarViewMonth={setCalendarViewMonth}
            calendarCells={calendarCells}
            calendarDay={calendarDay}
            datesWithNotesSet={datesWithNotesSet}
            onDayClick={onPickCalendarDay}
          />
        </div>

        <div className="sidebar__collections">
          <div className="sidebar__favorites">
            <div className="sidebar__section-row">
              <p className="sidebar__section">收藏</p>
            </div>
            {favoriteSidebarEntries.length === 0 ? (
              <p className="sidebar__favorites-empty">
                还没有星标？去主标题旁点那颗黄星星，常逛的合集一键直达～
              </p>
            ) : (
              <ul
                className="sidebar__favorites-list"
                aria-label="收藏的合集"
              >
                {favoriteSidebarEntries.map(({ col, path }) => (
                  <li key={col.id} className="sidebar__favorites-item">
                    <div
                      className={
                        "sidebar__favorites-row" +
                        (col.id === active?.id &&
                        !calendarDay &&
                        !trashViewActive
                          ? " is-active"
                          : "")
                      }
                    >
                      <button
                        type="button"
                        className="sidebar__favorites-hit"
                        onClick={() => {
                          setTrashViewActive(false);
                          setSearchQuery("");
                          setSearchBarOpen(false);
                          setCalendarDay(null);
                          expandAncestorsOf(col.id);
                          setActiveId(col.id);
                          setMobileNavOpen(false);
                        }}
                      >
                        <span
                          className="sidebar__dot"
                          style={{ backgroundColor: col.dotColor }}
                          aria-hidden
                        />
                        <span className="sidebar__name" title={path}>
                          {col.name}
                        </span>
                        <span className="sidebar__count">
                          {countSidebarCollectionCardBadge(col)}
                        </span>
                      </button>
                      <button
                        type="button"
                        draggable={false}
                        className="sidebar__favorites-remove"
                        aria-label="取消收藏"
                        title="取消收藏"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavoriteCollection(col.id);
                        }}
                      >
                        <span
                          className="sidebar__favorites-remove__icon"
                          aria-hidden
                        >
                          ×
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sidebar__section-row">
            <p className="sidebar__section">合集</p>
            {canEdit && !mobileNavOpen ? (
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
                    setTrashViewActive(false);
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
            <p className="sidebar__tags-empty">
              还没有标签出没，多写几条笔记就会长出来～
            </p>
          )}
          <div className="sidebar__trash" aria-label="垃圾桶">
            <button
              type="button"
              className={
                "sidebar__trash-hit" +
                (trashViewActive && !searchActive ? " is-active" : "")
              }
              onClick={() => {
                setTrashViewActive(true);
                setSearchQuery("");
                setSearchBarOpen(false);
                setCalendarDay(null);
                setMobileNavOpen(false);
              }}
            >
              <svg
                className="sidebar__trash-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              <span className="sidebar__trash-label">垃圾桶</span>
              {trashEntries.length > 0 ? (
                <span className="sidebar__trash-badge">
                  {trashEntries.length > 99 ? "99+" : trashEntries.length}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header ref={mainHeaderRef} className="main__header" id="app-main-header">
          <div
            className={
              "main__header-row" +
              (searchExpanded ? " main__header-row--search-open" : "")
            }
          >
            <button
              type="button"
              className="main__mobile-back"
              aria-label="返回合集列表"
              onClick={() => {
                setSearchBarOpen(false);
                setSearchQuery("");
                setCalendarDay(null);
                setTrashViewActive(false);
                setMobileNavOpen(true);
              }}
            >
              <svg
                className="main__mobile-back-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
                />
              </svg>
            </button>
            {searchExpanded ? (
              <div
                className="main__search main__search--expanded main__search--row-slot"
                role="search"
              >
                <input
                  ref={mainSearchInputRef}
                  id="app-main-search"
                  type="search"
                  className="main__search-input"
                  placeholder="搜搜笔记、合集、附件名～"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSearchQuery("");
                      setSearchBarOpen(false);
                    }
                  }}
                  autoComplete="off"
                  aria-label="搜索笔记、附件名、合集名"
                />
                <button
                  type="button"
                  className="main__search-clear"
                  aria-label={
                    searchActive ? "清除搜索" : "收起搜索"
                  }
                  onClick={() => {
                    if (searchActive) setSearchQuery("");
                    else setSearchBarOpen(false);
                  }}
                >
                  ×
                </button>
              </div>
            ) : null}
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
            <div className="main__heading-wrap">
              <h1 className="main__heading">
                {searchActive
                  ? "搜索"
                  : trashViewActive
                    ? "垃圾桶"
                    : calendarDay
                      ? formatChineseDayTitle(calendarDay)
                      : active?.name ?? "未选择合集"}
              </h1>
              {active &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive ? (
                <button
                  type="button"
                  className={
                    "main__heading-fav" +
                    (favoriteCollectionIds.has(active.id)
                      ? " is-on"
                      : "")
                  }
                  aria-label={
                    favoriteCollectionIds.has(active.id)
                      ? "取消收藏此合集"
                      : "收藏此合集"
                  }
                  aria-pressed={favoriteCollectionIds.has(active.id)}
                  title={
                    favoriteCollectionIds.has(active.id)
                      ? "取消收藏"
                      : "收藏"
                  }
                  onClick={() => toggleFavoriteCollection(active.id)}
                >
                  <CollectionStarIcon
                    filled={favoriteCollectionIds.has(active.id)}
                    className="main__heading-fav__svg"
                  />
                </button>
              ) : null}
            </div>
            <div className="main__header-actions">
              {!searchExpanded ? (
                <button
                  type="button"
                  className="main__header-icon-btn"
                  aria-label="打开搜索"
                  onClick={() => setSearchBarOpen(true)}
                >
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </button>
              ) : null}
              {canEdit &&
              trashViewActive &&
              !searchActive &&
              trashEntries.length > 0 ? (
                <button
                  type="button"
                  className="main__header-icon-btn main__header-icon-btn--danger-text"
                  aria-label="清空垃圾桶"
                  title="清空垃圾桶"
                  onClick={emptyTrash}
                >
                  <span className="main__header-trash-empty-label">
                    清空
                  </span>
                </button>
              ) : null}
              {canEdit &&
              active &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive ? (
                <button
                  type="button"
                  className="main__header-icon-btn"
                  aria-label="新建小笔记"
                  onClick={addSmallNote}
                >
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              ) : null}
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
          {active &&
          !calendarDay &&
          !searchActive &&
          !trashViewActive && (
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
                  title={
                    (active.hint?.trim()
                      ? active.hint!
                      : DEFAULT_COLLECTION_HINT) +
                    (canEdit ? " · 双击改成自己的话 ✨" : "")
                  }
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
          ref={timelineRef}
          className="timeline"
          role="feed"
          aria-label={
            searchActive
              ? "搜索结果"
              : trashViewActive
                ? "垃圾桶"
                : "mikujar 时间线"
          }
        >
          {searchActive ? (
            !searchHasResults ? (
              <div className="timeline__empty">
                唔…「{searchTrim}」什么也没搜到，换个词或换个姿势试试？
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
                              setTrashViewActive(false);
                              setActiveId(col.id);
                              setCalendarDay(null);
                              setSearchQuery("");
                              setSearchBarOpen(false);
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
                              setTrashViewActive(false);
                              setActiveId(col.id);
                              setCalendarDay(null);
                              setSearchQuery("");
                              setSearchBarOpen(false);
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
          ) : trashViewActive ? (
            trashEntries.length === 0 ? (
              <div className="timeline__empty trash-empty">
                {canEdit
                  ? "回收站空空如也～ 删掉的小卡片会乖乖躺在这，点「⋯」能捞回来或彻底粉碎。"
                  : "暂时没有已删除的笔记哟。"}
              </div>
            ) : (
              <ul className="cards" aria-label="已删除的笔记">
                {trashEntries.map((entry) => renderTrashCard(entry))}
              </ul>
            )
          ) : calendarDay ? (
            dayPinned.length === 0 && dayRestCards.length === 0 ? (
              <div className="timeline__empty">
                {canEdit
                  ? "这一天还没有带日期的小笔记～ 先选好合集，再用顶栏/底栏加号新建；没写日期的卡片不会出现在日历里哦。"
                  : "这一天没有可以展示的笔记～"}
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
                  ? "这里还光溜溜的！点顶栏「+」或底下罐子/「新建小笔记」，新卡会进当前合集并打上今天的日历～"
                  : "这个合集还没有笔记～"
                : "暂时没有任何小笔记～"}
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
          {canEdit &&
          active &&
          !calendarDay &&
          !searchActive &&
          !trashViewActive ? (
            <div className="timeline__add-bottom">
              <button
                type="button"
                className="timeline__add-bottom-btn"
                aria-label="新建小笔记"
                onClick={addSmallNote}
              >
                ＋ 新建小笔记
              </button>
            </div>
          ) : null}
        </div>
      </main>
      <nav className="mobile-dock" aria-label="底部快捷操作">
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--icon"
          aria-label={mobileCalendarOpen ? "关闭日历" : "打开日历"}
          aria-expanded={mobileCalendarOpen}
          onClick={() => {
            setMobileNavOpen(false);
            setMobileCalendarOpen((o) => !o);
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M3 10h18M8 2v4M16 2v4" />
          </svg>
        </button>
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--fab"
          aria-label={
            calendarDay !== null
              ? "回到合集"
              : writeRequiresLogin && !getAdminToken() && !isTauri()
                ? "先登录再写笔记"
                : "新建小笔记"
          }
          title={
            calendarDay !== null
              ? "退出按日浏览，回到当前合集"
              : writeRequiresLogin && !getAdminToken() && !isTauri()
                ? "先登录再开罐写笔记～"
                : "新建小笔记"
          }
          disabled={
            calendarDay !== null
              ? false
              : writeRequiresLogin &&
                  !getAdminToken() &&
                  !isTauri()
                ? false
                : trashViewActive ||
                  searchQuery.trim().length > 0 ||
                  !active ||
                  !canEdit
          }
          onClick={() => {
            if (calendarDay !== null) {
              setCalendarDay(null);
              requestAnimationFrame(() => {
                timelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              });
              return;
            }
            if (writeRequiresLogin && !getAdminToken() && !isTauri()) {
              openLogin();
              return;
            }
            const narrow =
              typeof window !== "undefined" &&
              window.matchMedia("(max-width: 900px)").matches;
            if (
              narrow &&
              canEdit &&
              active &&
              !trashViewActive &&
              searchQuery.trim().length === 0
            ) {
              const t = new Date();
              flushSync(() => {
                setMobileQuickCaptureHead({
                  minutesOfDay: t.getHours() * 60 + t.getMinutes(),
                  addedOn: localDateString(t),
                });
                setMobileQuickCaptureText("");
                mobileQuickCaptureDraftRef.current = "";
                setMobileQuickCaptureOpen(true);
              });
              mobileQuickCaptureAreaRef.current?.focus({
                preventScroll: true,
              });
              return;
            }
            addSmallNote();
          }}
        >
          <MobileDockJarIcon className="mobile-dock__jar-svg" />
        </button>
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--icon"
          aria-label="搜索"
          title="搜索"
          onClick={() => {
            setSearchBarOpen(true);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                timelineRef.current?.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
                if (typeof window !== "undefined") {
                  window.scrollTo({
                    top: 0,
                    left: 0,
                    behavior: "smooth",
                  });
                }
                mainHeaderRef.current?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                });
                window.setTimeout(() => {
                  mainSearchInputRef.current?.focus({
                    preventScroll: true,
                  });
                }, 120);
              });
            });
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </nav>
      {mobileCalendarOpen
        ? createPortal(
            <div className="mobile-cal-popup" role="presentation">
              <button
                type="button"
                className="mobile-cal-popup__backdrop"
                aria-label="关闭日历"
                onClick={() => setMobileCalendarOpen(false)}
              />
              <div
                className="mobile-cal-popup__sheet"
                role="dialog"
                aria-modal="true"
                aria-label="按日期浏览"
              >
                <div className="mobile-cal-popup__grab" aria-hidden />
                <div className="sidebar__calendar mobile-cal-popup__calendar">
                  <CalendarBrowsePanel
                    calendarViewMonth={calendarViewMonth}
                    setCalendarViewMonth={setCalendarViewMonth}
                    calendarCells={calendarCells}
                    calendarDay={calendarDay}
                    datesWithNotesSet={datesWithNotesSet}
                    onDayClick={(dateStr) => {
                      onPickCalendarDay(dateStr);
                      setMobileCalendarOpen(false);
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {mobileQuickCaptureOpen
        ? createPortal(
            <div className="mobile-quick-capture" role="presentation">
              <button
                type="button"
                className="mobile-quick-capture__backdrop"
                aria-label="关闭；已输入内容时保存"
                onClick={onQuickCaptureBackdrop}
              />
              <div
                className="mobile-quick-capture__sheet"
                role="dialog"
                aria-modal="true"
                aria-label="快速记录"
              >
                <div className="mobile-quick-capture__field-wrap">
                  <div className="mobile-quick-capture__lined">
                    <div className="mobile-quick-capture__head-row">
                      {mobileQuickCaptureHead ? (
                        <span className="mobile-quick-capture__time">
                          {formatCardTimeLabel({
                            id: "qc",
                            text: "",
                            minutesOfDay: mobileQuickCaptureHead.minutesOfDay,
                            addedOn: mobileQuickCaptureHead.addedOn,
                          })}
                        </span>
                      ) : (
                        <span className="mobile-quick-capture__head-row-spacer" />
                      )}
                      <button
                        type="button"
                        className="mobile-quick-capture__submit"
                        onClick={() => commitMobileQuickCapture()}
                      >
                        完成
                      </button>
                    </div>
                    <textarea
                      ref={mobileQuickCaptureAreaRef}
                      className="mobile-quick-capture__textarea"
                      value={mobileQuickCaptureText}
                      autoFocus
                      name="mikujar_quick_note_body"
                      autoComplete="off"
                      autoCapitalize="sentences"
                      autoCorrect="on"
                      spellCheck
                      enterKeyHint="enter"
                      inputMode="text"
                      aria-label="笔记内容"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      onChange={(e) => {
                        mobileQuickCaptureDraftRef.current = e.target.value;
                        setMobileQuickCaptureText(e.target.value);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
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
                onClick={(e) => {
                  e.stopPropagation();
                  openRemoveCollectionDialog(
                    collectionCtxMenu.id,
                    collectionCtxMenu.name,
                    collectionCtxMenu.hasChildren
                  );
                }}
              >
                删除合集
              </button>
            </div>,
            document.body
          )
        : null}
      {collectionDeleteDialog
        ? createPortal(
            <div
              className="auth-modal-backdrop"
              role="presentation"
              onClick={() => setCollectionDeleteDialog(null)}
            >
              <div
                className="auth-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="collection-delete-dialog-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="collection-delete-dialog-title"
                  className="auth-modal__title"
                >
                  删除合集
                </h2>
                <p className="auth-modal__hint">
                  {collectionDeleteDialog.hasSubtree
                    ? `要连「${collectionDeleteDialog.displayName}」带子文件夹一锅端吗？里面的笔记也会一起蒸发，救不回喔。`
                    : `确定拆掉「${collectionDeleteDialog.displayName}」这个合集？里面的笔记也会一起消失喔。`}
                </p>
                <div className="auth-modal__actions">
                  <button
                    type="button"
                    className="auth-modal__btn auth-modal__btn--ghost"
                    onClick={() => setCollectionDeleteDialog(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="auth-modal__btn auth-modal__btn--primary"
                    onClick={() => {
                      const d = collectionDeleteDialog;
                      setCollectionDeleteDialog(null);
                      performRemoveCollection(d.id);
                    }}
                  >
                    确定删除
                  </button>
                </div>
              </div>
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
                setTrashViewActive(false);
                setActiveId(tgtCol);
                setCalendarDay(null);
                setSearchQuery("");
                setSearchBarOpen(false);
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
                  小伙伴管理台
                </h2>
                <p className="auth-modal__hint">
                  在这儿给新来的发入住许可～ 登录后每人都有自己的笔记小窝和附件格子；站长还能改身份、换口令、送走来访者。
                </p>
                {adminUsersErr || userAdminFormErr ? (
                  <p className="auth-modal__err" role="alert">
                    {adminUsersErr ?? userAdminFormErr}
                  </p>
                ) : null}
                <div className="user-admin__new">
                  <p className="user-admin__new-title">拉新坑位</p>
                  <input
                    type="text"
                    className="auth-modal__input"
                    autoComplete="off"
                    placeholder="登录用小 ID"
                    value={newUserUsername}
                    disabled={newUserBusy}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                  />
                  <input
                    type="password"
                    className="auth-modal__input"
                    autoComplete="new-password"
                    placeholder="开局口令（至少 4 位）"
                    value={newUserPassword}
                    disabled={newUserBusy}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                  <input
                    type="text"
                    className="auth-modal__input"
                    autoComplete="off"
                    placeholder="对外昵称（可选，不填就用小 ID）"
                    value={newUserDisplayName}
                    disabled={newUserBusy}
                    onChange={(e) => setNewUserDisplayName(e.target.value)}
                  />
                  <div className="user-admin__new-row">
                    <label className="user-admin__role-label">
                      身份
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
                        <option value="user">住民</option>
                        <option value="admin">站长</option>
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
                      {newUserBusy ? "…" : "发放入住许可"}
                    </button>
                  </div>
                </div>
                <div className="user-admin__table-wrap">
                  {adminUsersLoading ? (
                    <p className="user-admin__loading">名单抓抓中…</p>
                  ) : (
                    <table className="user-admin__table">
                      <thead>
                        <tr>
                          <th>昵称</th>
                          <th>登录 ID</th>
                          <th>身份</th>
                          <th>换口令</th>
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
                                <option value="user">住民</option>
                                <option value="admin">站长</option>
                              </select>
                            </td>
                            <td className="user-admin__pwd-cell">
                              <div className="user-admin__pwd-inner">
                                <input
                                  type="password"
                                  className="user-admin__pwd-input"
                                  autoComplete="new-password"
                                  placeholder="新口令（≥4）"
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
                                  生效
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
                                送走
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
                    收工
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
