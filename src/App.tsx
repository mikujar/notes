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
  ClipboardEvent,
  DragEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { fetchApiHealth } from "./api/health";
import { fetchCollectionsFromApi, saveCollectionsToApi } from "./api/collections";
import { uploadCardMedia } from "./api/upload";
import { useAuth } from "./auth/AuthContext";
import { collections as initialCollections } from "./data";
import type {
  Collection,
  NoteBlock,
  NoteCard,
  NoteMediaItem,
  NoteMediaKind,
} from "./types";
import "./App.css";

const DEFAULT_COLLECTION_HINT =
  "欢迎使用 mikujar「未来罐」—— 按一天里的时刻收纳零碎笔记。";

/** 固定 id：今日新建小笔记默认落入此合集 */
const INBOX_COLLECTION_ID = "inbox";

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

/** 根级若无收集箱则插入；若收集箱不在首位则提到最前 */
function ensureInboxFirst(cols: Collection[]): Collection[] {
  const rootInboxIdx = cols.findIndex((c) => c.id === INBOX_COLLECTION_ID);
  if (rootInboxIdx >= 0) {
    if (rootInboxIdx === 0) return cols;
    const copy = [...cols];
    const [inb] = copy.splice(rootInboxIdx, 1);
    return [inb, ...copy];
  }
  const inbox: Collection = {
    id: INBOX_COLLECTION_ID,
    name: "收集箱",
    dotColor: "#64748b",
    blocks: [],
    hint: "今日随手记默认落在这里；可用侧栏日历查看某天新增的笔记块，再整理到其他合集。",
  };
  return [inbox, ...cols];
}

function collectBlocksOnDate(
  cols: Collection[],
  date: string
): { col: Collection; block: NoteBlock }[] {
  const out: { col: Collection; block: NoteBlock }[] = [];
  walkCollections(cols, (col) => {
    for (const b of col.blocks) {
      if (b.addedOn === date) out.push({ col, block: b });
    }
  });
  out.sort((a, b) => a.block.minutesOfDay - b.block.minutesOfDay);
  return out;
}

function datesWithBlocks(cols: Collection[]): Set<string> {
  const s = new Set<string>();
  walkCollections(cols, (col) => {
    for (const b of col.blocks) {
      if (b.addedOn) s.add(b.addedOn);
    }
  });
  return s;
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
function formatCardTimeLabel(block: NoteBlock) {
  const clock = formatClock(block.minutesOfDay);
  const added = block.addedOn;
  if (!added) return `今天 ${clock}`;
  const today = localDateString();
  if (added === today) return `今天 ${clock}`;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (added === localDateString(yest)) return `昨天 ${clock}`;
  const [, mm, dd] = added.split("-");
  return `${Number(mm)}月${Number(dd)}日 ${clock}`;
}

function sortedBlocks(blocks: NoteBlock[]) {
  return [...blocks].sort((a, b) => a.minutesOfDay - b.minutesOfDay);
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

type CardRef = { block: NoteBlock; card: NoteCard };

/** 置顶条目（按时间块顺序 + 块内顺序）与剩余按块渲染的数据 */
function splitPinned(blocks: NoteBlock[]): {
  pinned: CardRef[];
  restBlocks: NoteBlock[];
} {
  const ordered = sortedBlocks(blocks);
  const pinned: CardRef[] = [];
  const restBlocks: NoteBlock[] = [];

  for (const block of ordered) {
    const unpinned: NoteCard[] = [];
    for (const card of block.cards) {
      if (card.pinned) pinned.push({ block, card });
      else unpinned.push(card);
    }
    if (unpinned.length > 0) {
      restBlocks.push({ ...block, cards: unpinned });
    }
  }

  return { pinned, restBlocks };
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

/** 高度随内容增高，并按行高取整，与横格背景对齐 */
function AutoHeightTextarea({
  id,
  value,
  onChange,
  placeholder,
  minRows = 3,
  className,
  ariaLabel,
  readOnly,
  onPaste: onPasteExtra,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const syncHeight = useCallback(() => {
    const el = ref.current;
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
      ref={ref}
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
    />
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

/** 按后缀与常见图床推断类型；否则视为普通文件并带展示名 */
function guessMediaFromUrl(href: string): NoteMediaItem {
  const path = href.trim().split(/[?#]/)[0].toLowerCase();
  let host = "";
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    /* ignore */
  }

  if (
    /\.(mp3|m4a|aac|wav|flac|opus|oga|ogg)(\b|\/|$)/i.test(path)
  ) {
    return { kind: "audio", url: href };
  }
  if (/\.(mp4|webm|ogv|mov|m4v)(\b|\/|$)/i.test(path)) {
    return { kind: "video", url: href };
  }
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\b|\/|$)/i.test(path)) {
    return { kind: "image", url: href };
  }
  if (
    host.includes("picsum.photos") ||
    host.includes("unsplash.com") ||
    host === "i.imgur.com" ||
    host === "imgur.com" ||
    host === "www.imgur.com" ||
    host.endsWith(".imgur.com")
  ) {
    return { kind: "image", url: href };
  }

  const name = fileLabelFromUrl(href);
  return { kind: "file", url: href, name };
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

export default function App() {
  const { isAdmin, authReady, writeRequiresLogin, openLogin, logout } =
    useAuth();
  const [collections, setCollections] = useState<Collection[]>(() =>
    ensureInboxFirst(initialCollections)
  );
  const [activeId, setActiveId] = useState(
    () => ensureInboxFirst(initialCollections)[0]?.id ?? ""
  );
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
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
  const cardMediaUploadTargetRef = useRef<{
    colId: string;
    blockId: string;
    cardId: string;
  } | null>(null);
  const cardMediaFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const clear = () => setCardDragOverId(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [data, health] = await Promise.all([
        fetchCollectionsFromApi(),
        fetchApiHealth(),
      ]);
      if (cancelled) return;
      const mu = health?.mediaUpload;
      if (mu === "cos" || mu === "local") {
        setMediaUploadMode(mu);
      } else {
        setMediaUploadMode(null);
      }
      if (data !== null) {
        if (data.length > 0) {
          setCollections(ensureInboxFirst(data));
        }
        setApiOnline(true);
      } else {
        setLoadError(
          "无法连接服务器，已使用本地示例；启动后端（见项目说明）后刷新即可同步。"
        );
      }
      setRemoteLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!remoteLoaded || !apiOnline || !authReady) return;
    if (writeRequiresLogin && !isAdmin) return;
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
    isAdmin,
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

  const blocks = active ? sortedBlocks(active.blocks) : [];
  const { pinned, restBlocks } = useMemo(
    () => splitPinned(active?.blocks ?? []),
    [active?.blocks]
  );

  const datesWithNotes = useMemo(
    () => datesWithBlocks(collections),
    [collections]
  );

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarViewMonth),
    [calendarViewMonth]
  );

  const dayEntries = useMemo(() => {
    if (!calendarDay) return [];
    return collectBlocksOnDate(collections, calendarDay);
  }, [collections, calendarDay]);

  const blockToColIdForDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const { col, block } of dayEntries) m.set(block.id, col.id);
    return m;
  }, [dayEntries]);

  const { pinned: dayPinned, restBlocks: dayRestBlocks } = useMemo(
    () => splitPinned(dayEntries.map((e) => e.block)),
    [dayEntries]
  );

  const calendarRestByCol = useMemo(() => {
    const m = new Map<string, { col: Collection; blocks: NoteBlock[] }>();
    for (const block of dayRestBlocks) {
      const ent = dayEntries.find((e) => e.block.id === block.id);
      if (!ent) continue;
      const cur = m.get(ent.col.id);
      if (cur) cur.blocks.push(block);
      else m.set(ent.col.id, { col: ent.col, blocks: [block] });
    }
    const arr = [...m.values()];
    for (const g of arr) {
      g.blocks.sort((a, b) => a.minutesOfDay - b.minutesOfDay);
    }
    arr.sort(
      (a, b) => a.blocks[0].minutesOfDay - b.blocks[0].minutesOfDay
    );
    return arr;
  }, [dayRestBlocks, dayEntries]);

  const togglePin = useCallback(
    (colId: string, blockId: string, cardId: string) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks.map((block) => {
            if (block.id !== blockId) return block;
            return {
              ...block,
              cards: block.cards.map((card) =>
                card.id === cardId
                  ? { ...card, pinned: !card.pinned }
                  : card
              ),
            };
          }),
        }))
      );
    },
    []
  );

  const deleteCard = useCallback(
    (colId: string, blockId: string, cardId: string) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks
            .map((block) => {
              if (block.id !== blockId) return block;
              return {
                ...block,
                cards: block.cards.filter((c) => c.id !== cardId),
              };
            })
            .filter((block) => block.cards.length > 0),
        }))
      );
      setCardMenuId(null);
    },
    []
  );

  const setCardText = useCallback(
    (colId: string, blockId: string, cardId: string, text: string) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks.map((block) => {
            if (block.id !== blockId) return block;
            return {
              ...block,
              cards: block.cards.map((card) =>
                card.id === cardId ? { ...card, text } : card
              ),
            };
          }),
        }))
      );
    },
    []
  );

  const addMediaToCard = useCallback(
    (colId: string, blockId: string, cardId: string, url: string) => {
      const trimmed = url.trim();
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        window.alert("请输入有效的 http(s) 文件地址");
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        window.alert("仅支持 http 或 https 链接");
        return;
      }
      const href = parsed.href;
      const item = guessMediaFromUrl(href);
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks.map((block) => {
            if (block.id !== blockId) return block;
            return {
              ...block,
              cards: block.cards.map((card) =>
                card.id === cardId
                  ? {
                      ...card,
                      media: [...(card.media ?? []), item],
                    }
                  : card
              ),
            };
          }),
        }))
      );
    },
    []
  );

  const addMediaItemToCard = useCallback(
    (colId: string, blockId: string, cardId: string, item: NoteMediaItem) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks.map((block) => {
            if (block.id !== blockId) return block;
            return {
              ...block,
              cards: block.cards.map((card) =>
                card.id === cardId
                  ? {
                      ...card,
                      media: [...(card.media ?? []), item],
                    }
                  : card
              ),
            };
          }),
        }))
      );
    },
    []
  );

  const uploadFilesToCard = useCallback(
    async (
      colId: string,
      blockId: string,
      cardId: string,
      files: File[]
    ) => {
      if (files.length === 0) return;
      setUploadBusyCardId(cardId);
      try {
        for (const file of files) {
          const r = await uploadCardMedia(file);
          addMediaItemToCard(
            colId,
            blockId,
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
    (colId: string, blockId: string, cardId: string) => {
      setCardMenuId(null);
      cardMediaUploadTargetRef.current = { colId, blockId, cardId };
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
      void uploadFilesToCard(t.colId, t.blockId, t.cardId, [file]);
    },
    [uploadFilesToCard]
  );

  const clearCardMedia = useCallback(
    (colId: string, blockId: string, cardId: string) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks.map((block) => {
            if (block.id !== blockId) return block;
            return {
              ...block,
              cards: block.cards.map((card) => {
                if (card.id !== cardId) return card;
                const { media: _m, ...rest } = card;
                return rest;
              }),
            };
          }),
        }))
      );
      setCardMenuId(null);
    },
    []
  );

  const removeCardMediaItem = useCallback(
    (
      colId: string,
      blockId: string,
      cardId: string,
      item: NoteMediaItem
    ) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          blocks: col.blocks.map((block) => {
            if (block.id !== blockId) return block;
            return {
              ...block,
              cards: block.cards.map((card) => {
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
            };
          }),
        }))
      );
    },
    []
  );

  /**
   * 侧栏选中合集时：记到该合集；仅选中日历某日（按日视图）时记到「收集箱」。
   * 新块均带 addedOn（今日），便于日历聚合。
   */
  const addSmallNote = useCallback(() => {
    if (!isAdmin) return;
    const targetColId =
      calendarDay !== null
        ? INBOX_COLLECTION_ID
        : (active?.id ?? INBOX_COLLECTION_ID);
    const now = new Date();
    const minutesOfDay = now.getHours() * 60 + now.getMinutes();
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const cardId = `n-${uid}`;
    const newCard: NoteCard = { id: cardId, text: "" };
    const day = localDateString(now);

    setCollections((prev) => {
      const ensured = ensureInboxFirst(prev);
      return mapCollectionById(ensured, targetColId, (col) => ({
        ...col,
        blocks: [
          ...col.blocks,
          {
            id: `b-${uid}`,
            minutesOfDay,
            addedOn: day,
            cards: [newCard],
          },
        ],
      }));
    });

    queueMicrotask(() => {
      document.getElementById(`card-text-${cardId}`)?.focus();
    });
  }, [isAdmin, calendarDay, active?.id]);

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
      blocks: [],
    };
    setCollections((prev) => {
      const e = ensureInboxFirst(prev);
      const inboxIdx = e.findIndex((c) => c.id === INBOX_COLLECTION_ID);
      const next = [...e];
      if (inboxIdx === 0) next.splice(1, 0, newCol);
      else next.push(newCol);
      return next;
    });
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
      blocks: [],
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
      if (!isAdmin) return;
      if (id === INBOX_COLLECTION_ID) {
        window.alert("「收集箱」为默认合集，不能删除。");
        return;
      }
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
    [isAdmin]
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
      if (!isAdmin) {
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
    [isAdmin]
  );

  const onCollectionRowDragEnd = useCallback(() => {
    setDraggingCollectionId(null);
    setDropIndicator(null);
  }, []);

  const onCollectionRowDragOver = useCallback(
    (id: string, e: DragEvent) => {
      if (!isAdmin || draggingCollectionId === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const el = e.currentTarget as HTMLElement;
      setDropIndicator({
        targetId: id,
        position: dropPositionFromEvent(e, el),
      });
    },
    [draggingCollectionId, isAdmin]
  );

  const onCollectionRowDrop = useCallback(
    (targetId: string, e: DragEvent) => {
      if (!isAdmin) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
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
    [isAdmin]
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

  const renderCard = (
    block: NoteBlock,
    card: NoteCard,
    colId: string
  ) => {
    const media = (card.media ?? []).filter((m) => m.url?.trim());
    const hasGallery = media.length > 0;
    const canEdit = isAdmin;
    return (
      <li
        key={`${colId}-${block.id}-${card.id}`}
        className={
          "card" +
          (cardMenuId === card.id ? " is-menu-open" : "") +
          (cardDragOverId === card.id && canEdit && mediaUploadMode
            ? " card--file-drag-over"
            : "")
        }
        onDragOver={(e) => {
          if (!canEdit || !mediaUploadMode) return;
          if (!dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragEnter={(e) => {
          if (!canEdit || !mediaUploadMode) return;
          if (!dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          setCardDragOverId(card.id);
        }}
        onDragLeave={(e) => {
          if (!canEdit || !mediaUploadMode) return;
          const rel = e.relatedTarget as Node | null;
          if (rel && e.currentTarget.contains(rel)) return;
          setCardDragOverId((id) => (id === card.id ? null : id));
        }}
        onDrop={(e) => {
          if (!canEdit || !mediaUploadMode) return;
          e.preventDefault();
          setCardDragOverId(null);
          const files = filesFromDataTransfer(e.dataTransfer);
          if (files.length === 0) return;
          void uploadFilesToCard(colId, block.id, card.id, files);
        }}
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
                {formatCardTimeLabel(block)}
              </span>
              {canEdit ? (
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
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          const u = window.prompt(
                            "文件链接（https://…；图片/视频按后缀或常见图床识别，其它显示为文件）"
                          );
                          if (u?.trim())
                            addMediaToCard(colId, block.id, card.id, u);
                          setCardMenuId(null);
                        }}
                      >
                        添加文件
                      </button>
                      {mediaUploadMode ? (
                        <button
                          type="button"
                          className="card__menu-item"
                          role="menuitem"
                          disabled={uploadBusyCardId === card.id}
                          onClick={() =>
                            beginCardMediaUpload(colId, block.id, card.id)
                          }
                        >
                          {uploadBusyCardId === card.id
                            ? "上传中…"
                            : mediaUploadMode === "cos"
                              ? "本地上传到 COS"
                              : "本地上传"}
                        </button>
                      ) : null}
                      {hasGallery ? (
                        <button
                          type="button"
                          className="card__menu-item"
                          role="menuitem"
                          onClick={() =>
                            clearCardMedia(colId, block.id, card.id)
                          }
                        >
                          清空附件
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          togglePin(colId, block.id, card.id);
                          setCardMenuId(null);
                        }}
                      >
                        {card.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        className="card__menu-item card__menu-item--danger"
                        role="menuitem"
                        onClick={() =>
                          deleteCard(colId, block.id, card.id)
                        }
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <span className="card__toolbar-spacer" aria-hidden />
              )}
            </div>
            <AutoHeightTextarea
              id={`card-text-${card.id}`}
              className={"card__text" + (canEdit ? "" : " card__text--readonly")}
              value={card.text}
              minRows={3}
              ariaLabel="笔记正文"
              readOnly={!canEdit}
              onChange={(next) =>
                setCardText(colId, block.id, card.id, next)
              }
              onPaste={
                canEdit && mediaUploadMode
                  ? (e) => {
                      const files = filesFromDataTransfer(
                        e.clipboardData
                      );
                      if (files.length === 0) return;
                      e.preventDefault();
                      void uploadFilesToCard(
                        colId,
                        block.id,
                        card.id,
                        files
                      );
                    }
                  : undefined
              }
            />
          </div>
          {hasGallery ? (
            <CardGallery
              items={media}
              onRemoveItem={
                canEdit
                  ? (item) =>
                      removeCardMediaItem(
                        colId,
                        block.id,
                        card.id,
                        item
                      )
                  : undefined
              }
            />
          ) : null}
        </div>
      </li>
    );
  };

  const timelineEmpty = blocks.length === 0;
  const listEmpty = pinned.length === 0 && restBlocks.length === 0;

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
              dropCls
            }
            style={{ paddingLeft: 8 + depth * 14 }}
            draggable={isAdmin && editingCollectionId !== c.id}
            onDragStart={(e) => onCollectionRowDragStart(c.id, e)}
            onDragEnd={onCollectionRowDragEnd}
            onDragOver={(e) => onCollectionRowDragOver(c.id, e)}
            onDrop={(e) => onCollectionRowDrop(c.id, e)}
            onContextMenu={(e) => {
              if (!isAdmin || editingCollectionId === c.id) return;
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
                    isAdmin ? "双击修改名称；右键可删除合集" : undefined
                  }
                  onDoubleClick={
                    isAdmin
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
              <span className="sidebar__count">{c.blocks.length}</span>
            </div>
            {isAdmin ? (
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
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="sidebar__header-row">
            <div className="sidebar__workspace">
              <span className="sidebar__workspace-dot" aria-hidden />
              <span className="sidebar__workspace-name">mikujar</span>
            </div>
            {writeRequiresLogin ? (
              <button
                type="button"
                className={
                  "sidebar__admin-icon-btn" +
                  (isAdmin ? " sidebar__admin-icon-btn--on" : "")
                }
                onClick={isAdmin ? logout : openLogin}
                aria-label={isAdmin ? "退出管理" : "管理员登录"}
                title={isAdmin ? "退出管理" : "管理员登录"}
              >
                <AdminHeaderIcon mode={isAdmin ? "logout" : "login"} />
              </button>
            ) : null}
          </div>
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
                    (datesWithNotes.has(cell.dateStr) ? " has-notes" : "")
                  }
                  onClick={() => {
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
            {isAdmin ? (
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
      </aside>

      <main className="main">
        <header className="main__header">
          <div className="main__header-row">
            <h1 className="main__heading">
              {calendarDay
                ? formatChineseDayTitle(calendarDay)
                : active?.name ?? "未选择合集"}
            </h1>
            {isAdmin && (calendarDay || active) && (
              <button
                type="button"
                className="main__add-note"
                onClick={addSmallNote}
              >
                + 新建小笔记
              </button>
            )}
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
          {active && !calendarDay && (
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
                  title={isAdmin ? "双击修改说明" : undefined}
                  onDoubleClick={
                    isAdmin
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

        <div className="timeline" role="feed" aria-label="mikujar 时间线">
          {calendarDay ? (
            dayPinned.length === 0 && dayRestBlocks.length === 0 ? (
              <div className="timeline__empty">
                {isAdmin
                  ? "这一天还没有带日期的笔记块。在日历视图下「+ 新建小笔记」会写入「收集箱」并记在今日；旧笔记块无日期时不会出现在日历里。"
                  : "这一天没有可显示的笔记块。"}
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
                      {dayPinned.map(({ block, card }) =>
                        renderCard(
                          block,
                          card,
                          blockToColIdForDay.get(block.id) ?? ""
                        )
                      )}
                    </ul>
                  </section>
                )}
                {dayPinned.length > 0 && dayRestBlocks.length > 0 && (
                  <div
                    className="timeline__pin-divider"
                    role="separator"
                    aria-hidden
                  />
                )}
                {calendarRestByCol.map(({ col, blocks: cblocks }) => (
                  <div
                    key={col.id}
                    className="timeline__cal-group"
                  >
                    <h2 className="timeline__cal-group-title">
                      「{col.name}」
                    </h2>
                    {cblocks.map((block) => (
                      <section
                        key={block.id}
                        className="timeblock"
                        aria-label={`${col.name} ${formatClock(block.minutesOfDay)}`}
                      >
                        <ul className="cards">
                          {block.cards.map((card) =>
                            renderCard(block, card, col.id)
                          )}
                        </ul>
                      </section>
                    ))}
                  </div>
                ))}
              </>
            )
          ) : listEmpty ? (
            <div className="timeline__empty">
              {timelineEmpty
                ? isAdmin
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
                    {pinned.map(({ block, card }) =>
                      renderCard(block, card, active!.id)
                    )}
                  </ul>
                </section>
              )}
              {pinned.length > 0 && restBlocks.length > 0 && (
                <div
                  className="timeline__pin-divider"
                  role="separator"
                  aria-hidden
                />
              )}
              {restBlocks.map((block) => (
                <section
                  key={block.id}
                  className="timeblock"
                  aria-label={`时间块 ${formatClock(block.minutesOfDay)}`}
                >
                  <ul className="cards">
                    {block.cards.map((card) =>
                      renderCard(block, card, active!.id)
                    )}
                  </ul>
                </section>
              ))}
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
    </div>
  );
}
