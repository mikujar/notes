import { useEffect, useMemo, useRef, useState } from "react";
import {
  mightHaveApiSession,
  needsCosReadUrl,
  resolveCosMediaUrlIfNeeded,
  resolveMediaUrl,
} from "../api/auth";
import { useAppChrome } from "../i18n/useAppChrome";
import { MediaThumbImage, MediaThumbVideo } from "../mediaDisplay";
import {
  type AttachmentFilterKey,
  getAttachmentUiCategory,
} from "../noteMediaCategory";
import { fetchMeAttachmentsPage } from "../api/mePreferences";
import type { MeAttachmentListItem } from "../api/mePreferences";
import {
  readAllAttachmentsStoredPageIndex,
  readRemoteAttachmentsPageCache,
  writeAllAttachmentsStoredPageIndex,
  writeRemoteAttachmentsPageCache,
} from "../attachmentsListSessionCache";
import { formatByteSize } from "../noteStats";
import type { NoteMediaItem } from "../types";
import type { MediaAttachmentListEntry } from "./collectionModel";

/** 每页条数（与主时间线批次 40 对齐） */
const ATTACHMENTS_PAGE_SIZE = 40;

/** 首屏格子 eager + fetchPriority:high（与 CardGallery / MediaThumbImage 一致，减轻顶行排队） */
const ATTACHMENTS_PREVIEW_PRIORITY_COUNT = 16;

function attachmentDisplayName(item: NoteMediaItem): string {
  const n = item.name?.trim();
  if (n) return n;
  try {
    const u = new URL(item.url, "https://local.invalid");
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
  } catch {
    /* ignore */
  }
  const tail = item.url.replace(/\s/g, "");
  return tail.length > 40 ? `…${tail.slice(-36)}` : tail || item.kind;
}

function formatDurationSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 仅音/视频：优先展示上传时写入的 durationSec；旧数据再尝试浏览器读 metadata */
function AttachmentDurationIfAny({ item }: { item: NoteMediaItem }) {
  if (item.kind !== "video" && item.kind !== "audio") return null;
  const sec = item.durationSec;
  if (typeof sec === "number" && Number.isFinite(sec) && sec >= 0) {
    const t = formatDurationSec(sec);
    if (!t) return null;
    return (
      <span className="all-attachments-page__meta-line all-attachments-page__meta-line--duration">
        {t}
      </span>
    );
  }
  return <AttachmentDurationProbe item={item} />;
}

function AttachmentDurationProbe({ item }: { item: NoteMediaItem }) {
  type Phase = "loading" | "hidden" | "ok";
  const [phase, setPhase] = useState<Phase>("loading");
  const [text, setText] = useState("");

  useEffect(() => {
    if (item.kind !== "video" && item.kind !== "audio") {
      setPhase("hidden");
      return;
    }
    let cancelled = false;
    const run = async () => {
      const raw = resolveMediaUrl(item.url);
      let src = raw;
      try {
        if (needsCosReadUrl(raw) && mightHaveApiSession()) {
          src = await resolveCosMediaUrlIfNeeded(raw);
        } else if (needsCosReadUrl(raw)) {
          if (!cancelled) setPhase("hidden");
          return;
        }
      } catch {
        if (!cancelled) setPhase("hidden");
        return;
      }
      if (cancelled || !src) {
        if (!cancelled) setPhase("hidden");
        return;
      }
      const el = document.createElement(
        item.kind === "video" ? "video" : "audio"
      );
      el.preload = "metadata";
      el.muted = true;
      el.src = src;
      const cleanup = () => {
        el.removeAttribute("src");
        el.load();
      };
      const onMeta = () => {
        if (cancelled) return;
        const d = el.duration;
        cleanup();
        const formatted = Number.isFinite(d) ? formatDurationSec(d) : "";
        if (!formatted) {
          setPhase("hidden");
        } else {
          setText(formatted);
          setPhase("ok");
        }
      };
      const onErr = () => {
        if (cancelled) return;
        cleanup();
        setPhase("hidden");
      };
      el.addEventListener("loadedmetadata", onMeta, { once: true });
      el.addEventListener("error", onErr, { once: true });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [item.kind, item.url]);

  if (phase !== "ok" || !text) return null;
  return (
    <span className="all-attachments-page__meta-line all-attachments-page__meta-line--duration">
      {text}
    </span>
  );
}

function AttachmentPreview({
  item,
  gridIndex,
}: {
  item: NoteMediaItem;
  gridIndex: number;
}) {
  const thumb = item.thumbnailUrl?.trim();
  const cover = item.coverUrl?.trim();
  const eagerFirst = gridIndex < ATTACHMENTS_PREVIEW_PRIORITY_COUNT;

  if (item.kind === "image") {
    const u = thumb || item.url;
    return (
      <MediaThumbImage
        url={u}
        className="all-attachments-page__preview-img"
        alt=""
        priority={!!thumb || eagerFirst}
      />
    );
  }
  if (item.kind === "video") {
    return (
      <MediaThumbVideo
        url={item.url}
        thumbnailUrl={item.thumbnailUrl}
        className="all-attachments-page__preview-video"
        playBadge
      />
    );
  }
  if (item.kind === "audio") {
    if (cover) {
      return (
        <MediaThumbImage
          url={cover}
          className="all-attachments-page__preview-img"
          alt=""
          priority
        />
      );
    }
    return (
      <span
        className="all-attachments-page__preview-ph all-attachments-page__preview-ph--audio"
        aria-hidden
      >
        ♪
      </span>
    );
  }
  if (thumb) {
    return (
      <MediaThumbImage
        url={thumb}
        className="all-attachments-page__preview-img"
        alt=""
        priority
      />
    );
  }
  return (
    <span
      className="all-attachments-page__preview-ph all-attachments-page__preview-ph--file"
      aria-hidden
    >
      FILE
    </span>
  );
}

function AttachmentGridCell({
  colId,
  cardId,
  mediaIndex,
  item,
  gridIndex,
  onOpenCard,
}: {
  colId: string;
  cardId: string;
  mediaIndex: number;
  item: NoteMediaItem;
  gridIndex: number;
  onOpenCard: (colId: string, cardId: string, mediaIndex: number) => void;
}) {
  const c = useAppChrome();
  const name = attachmentDisplayName(item);
  const sizeLine =
    typeof item.sizeBytes === "number" && item.sizeBytes >= 0
      ? formatByteSize(item.sizeBytes)
      : c.allAttachmentsMetaDash;
  return (
    <li key={`${colId}-${cardId}-${mediaIndex}`}>
      <button
        type="button"
        className="all-attachments-page__cell"
        onClick={() => onOpenCard(colId, cardId, mediaIndex)}
      >
        <div className="all-attachments-page__preview-box">
          <AttachmentPreview item={item} gridIndex={gridIndex} />
        </div>
        <div className="all-attachments-page__info">
          <span className="all-attachments-page__name" title={name}>
            {name}
          </span>
          <span className="all-attachments-page__meta-line">{sizeLine}</span>
          <AttachmentDurationIfAny item={item} />
        </div>
      </button>
    </li>
  );
}

export function AllAttachmentsView({
  dataMode,
  entries,
  filterKey,
  previewLayout = "contain",
  remoteListCacheUserKey = "anon",
  remoteListRefreshNonce = 0,
  onOpenCard,
}: {
  dataMode: "local" | "remote";
  entries: MediaAttachmentListEntry[];
  filterKey: AttachmentFilterKey;
  /** 缩略图：原比例完整显示 vs 正方形裁剪填满 */
  previewLayout?: "contain" | "square";
  /** 云端列表 sessionStorage 缓存分用户键 */
  remoteListCacheUserKey?: string;
  /** 远程模式下附件变更时递增，用于重新拉取当前页 */
  remoteListRefreshNonce?: number;
  onOpenCard: (colId: string, cardId: string, mediaIndex: number) => void;
}) {
  const c = useAppChrome();
  const pageRootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (filterKey === "all") return entries;
    return entries.filter(
      (e) => getAttachmentUiCategory(e.item) === filterKey
    );
  }, [entries, filterKey]);

  const filteredTotal = filtered.length;
  const localTotalPages = Math.max(
    1,
    Math.ceil(filteredTotal / ATTACHMENTS_PAGE_SIZE)
  );

  const [pageIndex, setPageIndex] = useState(() => {
    const stored = readAllAttachmentsStoredPageIndex(
      remoteListCacheUserKey,
      dataMode,
      filterKey
    );
    return stored ?? 0;
  });
  const [remoteRows, setRemoteRows] = useState<MeAttachmentListItem[]>([]);
  const [remoteTotal, setRemoteTotal] = useState(0);
  const [remoteLoading, setRemoteLoading] = useState(false);

  const pageResetPrevRef = useRef<{
    userKey: string;
    filterKey: AttachmentFilterKey;
    dataMode: "local" | "remote";
  } | null>(null);
  useEffect(() => {
    const cur = {
      userKey: remoteListCacheUserKey,
      filterKey,
      dataMode,
    };
    const prev = pageResetPrevRef.current;
    pageResetPrevRef.current = cur;
    if (!prev) return;
    const filterOrModeChanged =
      prev.filterKey !== cur.filterKey || prev.dataMode !== cur.dataMode;
    if (filterOrModeChanged) {
      setPageIndex(0);
      return;
    }
    if (prev.userKey !== cur.userKey) {
      const stored = readAllAttachmentsStoredPageIndex(
        cur.userKey,
        cur.dataMode,
        cur.filterKey
      );
      setPageIndex(stored ?? 0);
    }
  }, [remoteListCacheUserKey, filterKey, dataMode]);

  useEffect(() => {
    writeAllAttachmentsStoredPageIndex(
      remoteListCacheUserKey,
      dataMode,
      filterKey,
      pageIndex
    );
  }, [pageIndex, remoteListCacheUserKey, dataMode, filterKey]);

  useEffect(() => {
    if (dataMode !== "local") return;
    if (filteredTotal === 0) {
      setPageIndex(0);
      return;
    }
    const last = Math.ceil(filteredTotal / ATTACHMENTS_PAGE_SIZE) - 1;
    setPageIndex((p) => Math.min(p, last));
  }, [dataMode, filteredTotal]);

  useEffect(() => {
    if (dataMode !== "remote") return;
    let cancelled = false;
    const offset = pageIndex * ATTACHMENTS_PAGE_SIZE;
    const cached = readRemoteAttachmentsPageCache(
      remoteListCacheUserKey,
      filterKey,
      offset
    );
    if (cached) {
      setRemoteRows(cached.items);
      setRemoteTotal(cached.total);
      setRemoteLoading(false);
    } else {
      setRemoteRows([]);
      setRemoteLoading(true);
    }
    void fetchMeAttachmentsPage({
      limit: ATTACHMENTS_PAGE_SIZE,
      offset,
      filterKey,
    }).then((res) => {
      if (cancelled) return;
      if (!res) {
        if (!cached) {
          setRemoteRows([]);
          setRemoteTotal(0);
        }
        setRemoteLoading(false);
        return;
      }
      setRemoteRows(res.items);
      setRemoteTotal(res.total);
      writeRemoteAttachmentsPageCache(
        remoteListCacheUserKey,
        filterKey,
        offset,
        res
      );
      setRemoteLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    dataMode,
    filterKey,
    pageIndex,
    remoteListRefreshNonce,
    remoteListCacheUserKey,
  ]);

  useEffect(() => {
    if (dataMode !== "remote") return;
    /* total 尚未从接口/缓存写入时勿清零，否则刷新后无法恢复已存页码 */
    if (remoteTotal <= 0) return;
    const last = Math.ceil(remoteTotal / ATTACHMENTS_PAGE_SIZE) - 1;
    setPageIndex((p) => Math.min(p, last));
  }, [dataMode, remoteTotal]);

  useEffect(() => {
    const tl = pageRootRef.current?.closest(".timeline");
    if (tl instanceof HTMLElement) {
      tl.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [pageIndex, filterKey]);

  const start = pageIndex * ATTACHMENTS_PAGE_SIZE;
  const localPageSlice = useMemo(
    () => filtered.slice(start, start + ATTACHMENTS_PAGE_SIZE),
    [filtered, start]
  );

  const totalPages =
    dataMode === "remote"
      ? Math.max(1, Math.ceil(remoteTotal / ATTACHMENTS_PAGE_SIZE))
      : localTotalPages;

  const pageDisplay = pageIndex + 1;
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < totalPages - 1;

  if (dataMode === "local" && entries.length === 0) {
    return (
      <div className="timeline__empty all-attachments-page__empty">
        {c.allAttachmentsEmpty}
      </div>
    );
  }

  if (dataMode === "remote" && remoteLoading && pageIndex === 0) {
    return (
      <div className="timeline__empty all-attachments-page__empty" role="status">
        {c.loading}
      </div>
    );
  }

  if (dataMode === "remote" && !remoteLoading && remoteTotal === 0) {
    return (
      <div className="timeline__empty all-attachments-page__empty">
        {filterKey === "all"
          ? c.allAttachmentsEmpty
          : c.allAttachmentsEmptyFiltered}
      </div>
    );
  }

  const showFilteredEmptyLocal =
    dataMode === "local" && entries.length > 0 && filtered.length === 0;

  return (
    <div
      className={
        "all-attachments-page" +
        (previewLayout === "square"
          ? " all-attachments-page--preview-square"
          : "")
      }
      ref={pageRootRef}
    >
      {showFilteredEmptyLocal ? (
        <div className="timeline__empty all-attachments-page__empty">
          {c.allAttachmentsEmptyFiltered}
        </div>
      ) : (
        <>
          {dataMode === "remote" && remoteLoading ? (
            <div
              className="timeline__empty all-attachments-page__empty"
              role="status"
            >
              {c.loading}
            </div>
          ) : (
            <ul className="all-attachments-page__grid" role="list">
              {dataMode === "local"
                ? localPageSlice.map((ent, gridIndex) => (
                    <AttachmentGridCell
                      key={`${ent.col.id}-${ent.card.id}-${ent.mediaIndex}`}
                      colId={ent.col.id}
                      cardId={ent.card.id}
                      mediaIndex={ent.mediaIndex}
                      item={ent.item}
                      gridIndex={gridIndex}
                      onOpenCard={onOpenCard}
                    />
                  ))
                : remoteRows.map((ent, gridIndex) => (
                    <AttachmentGridCell
                      key={`${ent.colId}-${ent.cardId}-${ent.mediaIndex}`}
                      colId={ent.colId}
                      cardId={ent.cardId}
                      mediaIndex={ent.mediaIndex}
                      item={ent.item}
                      gridIndex={gridIndex}
                      onOpenCard={onOpenCard}
                    />
                  ))}
            </ul>
          )}
          {totalPages > 1 ? (
            <nav
              className="all-attachments-page__pagination"
              aria-label={c.allAttachmentsPaginationNavAria}
            >
              <button
                type="button"
                className="all-attachments-page__pagination-btn"
                disabled={!canPrev}
                aria-disabled={!canPrev}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              >
                {c.allAttachmentsPaginationPrev}
              </button>
              <span className="all-attachments-page__pagination-label">
                {c.allAttachmentsPaginationPageOf(pageDisplay, totalPages)}
              </span>
              <button
                type="button"
                className="all-attachments-page__pagination-btn"
                disabled={!canNext}
                aria-disabled={!canNext}
                onClick={() =>
                  setPageIndex((p) => Math.min(totalPages - 1, p + 1))
                }
              >
                {c.allAttachmentsPaginationNext}
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
