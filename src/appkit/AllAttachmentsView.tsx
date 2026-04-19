import { useEffect, useMemo, useRef, useState } from "react";
import {
  mightHaveApiSession,
  needsCosReadUrl,
  resolveCosMediaUrlIfNeeded,
  resolveMediaUrl,
} from "../api/auth";
import { patchCardMediaItemApi } from "../api/collections";
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

function formatResolutionPx(w: number, h: number): string {
  if (
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0 ||
    w > 32767 ||
    h > 32767
  ) {
    return "";
  }
  return `${Math.round(w)}×${Math.round(h)}`;
}

function itemHasStoredResolution(item: NoteMediaItem): boolean {
  const w = item.widthPx;
  const h = item.heightPx;
  return (
    typeof w === "number" &&
    typeof h === "number" &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  );
}

/** 视频：时长 + 分辨率；优先用已存字段，缺则一次 loadedmetadata 探测并 PATCH */
function AttachmentVideoMetaProbe({
  item,
  cardId,
  mediaIndex,
  persistRemote,
  onRemotePersisted,
}: {
  item: NoteMediaItem;
  cardId: string;
  mediaIndex: number;
  persistRemote: boolean;
  onRemotePersisted?: () => void;
}) {
  const needDur = !(
    typeof item.durationSec === "number" &&
    Number.isFinite(item.durationSec) &&
    item.durationSec >= 0
  );
  const needRes = !itemHasStoredResolution(item);
  const [durText, setDurText] = useState(() =>
    needDur ? "" : formatDurationSec(item.durationSec!)
  );
  const [resText, setResText] = useState(() =>
    needRes
      ? ""
      : formatResolutionPx(item.widthPx!, item.heightPx!)
  );
  const [awaitingProbe, setAwaitingProbe] = useState(needDur || needRes);
  const persistOnceRef = useRef(false);

  useEffect(() => {
    if (!needDur && !needRes) return;
    let cancelled = false;
    const run = async () => {
      const raw = resolveMediaUrl(item.url);
      let src = raw;
      try {
        if (needsCosReadUrl(raw) && mightHaveApiSession()) {
          src = await resolveCosMediaUrlIfNeeded(raw);
        } else if (needsCosReadUrl(raw)) {
          if (!cancelled) setAwaitingProbe(false);
          return;
        }
      } catch {
        if (!cancelled) setAwaitingProbe(false);
        return;
      }
      if (cancelled || !src) {
        if (!cancelled) setAwaitingProbe(false);
        return;
      }
      const el = document.createElement("video");
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
        const w = el.videoWidth;
        const h = el.videoHeight;
        cleanup();
        const patch: {
          durationSec?: number;
          widthPx?: number;
          heightPx?: number;
        } = {};
        const nextDur = !needDur
          ? formatDurationSec(item.durationSec!)
          : Number.isFinite(d) && d >= 0
            ? formatDurationSec(Math.min(86400000, Math.round(d)))
            : "";
        const nextRes = !needRes
          ? formatResolutionPx(item.widthPx!, item.heightPx!)
          : Number.isFinite(w) &&
              Number.isFinite(h) &&
              w > 0 &&
              h > 0 &&
              w <= 32767 &&
              h <= 32767
            ? formatResolutionPx(w, h)
            : "";
        if (needDur && Number.isFinite(d) && d >= 0) {
          patch.durationSec = Math.min(86400000, Math.round(d));
        }
        if (
          needRes &&
          Number.isFinite(w) &&
          Number.isFinite(h) &&
          w > 0 &&
          h > 0 &&
          w <= 32767 &&
          h <= 32767
        ) {
          patch.widthPx = Math.round(w);
          patch.heightPx = Math.round(h);
        }
        if (nextDur) setDurText(nextDur);
        if (nextRes) setResText(nextRes);
        setAwaitingProbe(false);
        if (
          persistRemote &&
          Object.keys(patch).length > 0 &&
          !persistOnceRef.current &&
          mightHaveApiSession()
        ) {
          persistOnceRef.current = true;
          void patchCardMediaItemApi(cardId, mediaIndex, patch).then((r) => {
            if (r.ok && r.updated) onRemotePersisted?.();
          });
        }
      };
      const onErr = () => {
        if (cancelled) return;
        cleanup();
        setAwaitingProbe(false);
      };
      el.addEventListener("loadedmetadata", onMeta, { once: true });
      el.addEventListener("error", onErr, { once: true });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    item.url,
    item.durationSec,
    item.widthPx,
    item.heightPx,
    cardId,
    mediaIndex,
    needDur,
    needRes,
    persistRemote,
    onRemotePersisted,
  ]);

  if (awaitingProbe && !durText && !resText) return null;
  if (!durText && !resText) return null;
  return (
    <>
      {durText ? (
        <span className="all-attachments-page__meta-line all-attachments-page__meta-line--duration">
          {durText}
        </span>
      ) : null}
      {resText ? (
        <span className="all-attachments-page__meta-line all-attachments-page__meta-line--resolution">
          {resText}
        </span>
      ) : null}
    </>
  );
}

/** 音频：仅时长 */
function AttachmentAudioDurationProbe({
  item,
  cardId,
  mediaIndex,
  persistRemoteDuration,
  onRemoteDurationPersisted,
}: {
  item: NoteMediaItem;
  cardId: string;
  mediaIndex: number;
  persistRemoteDuration: boolean;
  onRemoteDurationPersisted?: () => void;
}) {
  type Phase = "loading" | "hidden" | "ok";
  const [phase, setPhase] = useState<Phase>("loading");
  const [text, setText] = useState("");
  const persistOnceRef = useRef(false);

  useEffect(() => {
    if (item.kind !== "audio") {
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
      const el = document.createElement("audio");
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
          const rounded =
            Number.isFinite(d) && d >= 0 ? Math.min(86400000, Math.round(d)) : -1;
          if (
            persistRemoteDuration &&
            rounded >= 0 &&
            !persistOnceRef.current &&
            mightHaveApiSession()
          ) {
            persistOnceRef.current = true;
            void patchCardMediaItemApi(cardId, mediaIndex, {
              durationSec: rounded,
            }).then((r) => {
              if (r.ok && r.updated) onRemoteDurationPersisted?.();
            });
          }
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
  }, [
    item.kind,
    item.url,
    cardId,
    mediaIndex,
    persistRemoteDuration,
    onRemoteDurationPersisted,
  ]);

  if (phase !== "ok" || !text) return null;
  return (
    <span className="all-attachments-page__meta-line all-attachments-page__meta-line--duration">
      {text}
    </span>
  );
}

/** 图片：分辨率（已存或探测） */
function AttachmentImageResolutionIfAny({
  item,
  cardId,
  mediaIndex,
  persistRemote,
  onRemotePersisted,
}: {
  item: NoteMediaItem;
  cardId: string;
  mediaIndex: number;
  persistRemote: boolean;
  onRemotePersisted?: () => void;
}) {
  if (item.kind !== "image") return null;
  if (itemHasStoredResolution(item)) {
    const t = formatResolutionPx(item.widthPx!, item.heightPx!);
    if (!t) return null;
    return (
      <span className="all-attachments-page__meta-line all-attachments-page__meta-line--resolution">
        {t}
      </span>
    );
  }
  return (
    <AttachmentImageResolutionProbe
      item={item}
      cardId={cardId}
      mediaIndex={mediaIndex}
      persistRemote={persistRemote}
      onRemotePersisted={onRemotePersisted}
    />
  );
}

function AttachmentImageResolutionProbe({
  item,
  cardId,
  mediaIndex,
  persistRemote,
  onRemotePersisted,
}: {
  item: NoteMediaItem;
  cardId: string;
  mediaIndex: number;
  persistRemote: boolean;
  onRemotePersisted?: () => void;
}) {
  type Phase = "loading" | "hidden" | "ok";
  const [phase, setPhase] = useState<Phase>("loading");
  const [text, setText] = useState("");
  const persistOnceRef = useRef(false);

  useEffect(() => {
    if (item.kind !== "image") {
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
      const img = new Image();
      const cleanup = () => {
        img.removeAttribute("src");
      };
      const onLoad = () => {
        if (cancelled) return;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        cleanup();
        const formatted = formatResolutionPx(w, h);
        if (!formatted) {
          setPhase("hidden");
          return;
        }
        setText(formatted);
        setPhase("ok");
        if (
          persistRemote &&
          !persistOnceRef.current &&
          mightHaveApiSession()
        ) {
          persistOnceRef.current = true;
          void patchCardMediaItemApi(cardId, mediaIndex, {
            widthPx: Math.round(w),
            heightPx: Math.round(h),
          }).then((r) => {
            if (r.ok && r.updated) onRemotePersisted?.();
          });
        }
      };
      const onErr = () => {
        if (cancelled) return;
        cleanup();
        setPhase("hidden");
      };
      img.addEventListener("load", onLoad, { once: true });
      img.addEventListener("error", onErr, { once: true });
      img.src = src;
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [item.kind, item.url, cardId, mediaIndex, persistRemote, onRemotePersisted]);

  if (phase !== "ok" || !text) return null;
  return (
    <span className="all-attachments-page__meta-line all-attachments-page__meta-line--resolution">
      {text}
    </span>
  );
}

/** 音/视频时长；视频分辨率见 AttachmentVideoMetaProbe / 内联展示 */
function AttachmentDurationIfAny({
  item,
  cardId,
  mediaIndex,
  persistRemoteDuration,
  onRemoteDurationPersisted,
}: {
  item: NoteMediaItem;
  cardId: string;
  mediaIndex: number;
  persistRemoteDuration: boolean;
  onRemoteDurationPersisted?: () => void;
}) {
  if (item.kind === "video") {
    const sec = item.durationSec;
    const durStored =
      typeof sec === "number" && Number.isFinite(sec) && sec >= 0;
    const resStored = itemHasStoredResolution(item);
    if (durStored && resStored) {
      const t = formatDurationSec(sec);
      const r = formatResolutionPx(item.widthPx!, item.heightPx!);
      return (
        <>
          {t ? (
            <span className="all-attachments-page__meta-line all-attachments-page__meta-line--duration">
              {t}
            </span>
          ) : null}
          {r ? (
            <span className="all-attachments-page__meta-line all-attachments-page__meta-line--resolution">
              {r}
            </span>
          ) : null}
        </>
      );
    }
    return (
      <AttachmentVideoMetaProbe
        item={item}
        cardId={cardId}
        mediaIndex={mediaIndex}
        persistRemote={persistRemoteDuration}
        onRemotePersisted={onRemoteDurationPersisted}
      />
    );
  }
  if (item.kind !== "audio") return null;
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
  return (
    <AttachmentAudioDurationProbe
      item={item}
      cardId={cardId}
      mediaIndex={mediaIndex}
      persistRemoteDuration={persistRemoteDuration}
      onRemoteDurationPersisted={onRemoteDurationPersisted}
    />
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
    const hasStaticPoster =
      !!item.thumbnailUrl?.trim() || !!item.coverUrl?.trim();
    return (
      <MediaThumbVideo
        url={item.url}
        thumbnailUrl={item.thumbnailUrl}
        coverUrl={item.coverUrl}
        className="all-attachments-page__preview-video"
        playBadge
        videoPreload="metadata"
        videoFetchPriority={eagerFirst ? "high" : undefined}
        thumbImagePriority={hasStaticPoster || eagerFirst}
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
  persistRemoteDuration,
  onRemoteDurationPersisted,
}: {
  colId: string;
  cardId: string;
  mediaIndex: number;
  item: NoteMediaItem;
  gridIndex: number;
  onOpenCard: (
    colId: string,
    cardId: string,
    mediaIndex: number
  ) => void | Promise<void>;
  persistRemoteDuration: boolean;
  onRemoteDurationPersisted?: () => void;
}) {
  const c = useAppChrome();
  const name = attachmentDisplayName(item);
  const sb = (item as { sizeBytes?: number | string | undefined }).sizeBytes;
  const sizeBytesNum =
    typeof sb === "number" && Number.isFinite(sb) && sb >= 0
      ? Math.floor(sb)
      : typeof sb === "string" && /^\d+$/.test(sb.trim())
        ? parseInt(sb.trim(), 10)
        : null;
  const sizeLine =
    sizeBytesNum != null && sizeBytesNum >= 0
      ? formatByteSize(sizeBytesNum)
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
          <AttachmentDurationIfAny
            item={item}
            cardId={cardId}
            mediaIndex={mediaIndex}
            persistRemoteDuration={persistRemoteDuration}
            onRemoteDurationPersisted={onRemoteDurationPersisted}
          />
          <AttachmentImageResolutionIfAny
            item={item}
            cardId={cardId}
            mediaIndex={mediaIndex}
            persistRemote={persistRemoteDuration}
            onRemotePersisted={onRemoteDurationPersisted}
          />
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
  onRemoteListInvalidate,
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
  onOpenCard: (
    colId: string,
    cardId: string,
    mediaIndex: number
  ) => void | Promise<void>;
  /** 浏览器探测到时长并写库后，使附件列表与笔记树刷新 */
  onRemoteListInvalidate?: () => void;
}) {
  const c = useAppChrome();
  const pageRootRef = useRef<HTMLDivElement>(null);
  const persistRemoteDuration = dataMode === "remote";

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
                      persistRemoteDuration={persistRemoteDuration}
                      onRemoteDurationPersisted={onRemoteListInvalidate}
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
                      persistRemoteDuration={persistRemoteDuration}
                      onRemoteDurationPersisted={onRemoteListInvalidate}
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
