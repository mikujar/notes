import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useAppChrome } from "./i18n/useAppChrome";
import type { NoteMediaItem } from "./types";
import { resolveCosMediaUrlIfNeeded, resolveMediaUrl } from "./api/auth";
import { LOCAL_MEDIA_PREFIX } from "./localMediaTauri";
import {
  MediaLightboxAudio,
  MediaLightboxCover,
  MediaLightboxImage,
  MediaLightboxVideo,
  MediaOpenLink,
  MediaThumbImage,
  MediaThumbLoadingOverlay,
  MediaThumbVideo,
  useMediaDisplaySrc,
} from "./mediaDisplay";

const SWIPE_MIN_PX = 44;
const SWIPE_DOMINANCE_OVER_VERTICAL = 1.12;
const SWIPE_SUPPRESS_CLICK_MS = 220;

function mediaSwipePointerTargetOk(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.closest("button, [role='tab'], audio")) return false;
  return true;
}

function noteMediaItemsEqual(a: NoteMediaItem, b: NoteMediaItem): boolean {
  return (
    a.url === b.url &&
    a.kind === b.kind &&
    (a.name ?? "") === (b.name ?? "") &&
    (a.coverUrl ?? "") === (b.coverUrl ?? "") &&
    (a.thumbnailUrl ?? "") === (b.thumbnailUrl ?? "")
  );
}

/**
 * 将任意栅格图 Blob 转为 PNG（聊天软件多数只认剪贴板里的 image/png，直接写 webp/jpeg 常粘贴失败）
 */
async function rasterBlobToPngBlob(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const maxEdge = 4096;
    let w = bmp.width;
    let h = bmp.height;
    if (w > maxEdge || h > maxEdge) {
      const s = maxEdge / Math.max(w, h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
    if (!out || out.size < 1) throw new Error("empty png");
    return out;
  } finally {
    bmp.close?.();
  }
}

/** 仅图片：写入剪贴板（统一为 PNG，便于粘贴到微信等） */
async function copyImageToClipboard(item: NoteMediaItem) {
  if (item.kind !== "image") return;
  if (typeof ClipboardItem === "undefined") return;
  const url = resolveMediaUrl(item.url);
  try {
    const fetchUrl = await resolveCosMediaUrlIfNeeded(url);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    let png: Blob;
    try {
      png = await rasterBlobToPngBlob(blob);
    } catch {
      const mime =
        blob.type && /^image\//i.test(blob.type) ? blob.type : "image/png";
      await navigator.clipboard.write([
        new ClipboardItem({ [mime]: blob }),
      ]);
      return;
    }
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
  } catch {
    /* 非安全上下文无 clipboard、或换签/解码失败 */
  }
}

function guessDownloadExt(mime: string, kind: NoteMediaItem["kind"]): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("gif")) return ".gif";
  if (m.includes("webp")) return ".webp";
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("quicktime")) return ".mov";
  if (m.includes("mpeg") && m.includes("audio")) return ".mp3";
  if (m.includes("wav")) return ".wav";
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("mpeg")) return ".mp3";
  if (kind === "image") return ".jpg";
  if (kind === "video") return ".mp4";
  if (kind === "audio") return ".mp3";
  return "";
}

/** 拉取附件（含 COS 私有换签）并触发浏览器下载 */
async function downloadMediaItem(item: NoteMediaItem, fileFallback: string) {
  const base = resolveMediaUrl(item.url);
  if (!base) return;
  try {
    const fetchUrl = await resolveCosMediaUrlIfNeeded(base);
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    let name =
      (item.name && item.name.trim()) ||
      fileLabelFromUrl(item.url, fileFallback);
    name = name.replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 180);
    if (!name) name = fileFallback;
    if (!/\.\w{1,8}$/i.test(name)) {
      name += guessDownloadExt(blob.type, item.kind);
    }
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    /* 跨域、未登录无法换签、或下载失败时静默 */
  }
}

function fileLabelFromUrl(url: string, fileFallback: string): string {
  if (url.startsWith(LOCAL_MEDIA_PREFIX)) {
    const seg =
      url.slice(LOCAL_MEDIA_PREFIX.length).split("/").pop() ?? "";
    const i = seg.indexOf("_");
    if (i >= 0 && i < seg.length - 1) {
      return decodeURIComponent(seg.slice(i + 1).replace(/\+/g, " "));
    }
    return seg || fileFallback;
  }
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return fileFallback;
    return decodeURIComponent(last.replace(/\+/g, " "));
  } catch {
    return fileFallback;
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

function GalleryInlineVideo({
  url,
  posterUrl,
}: {
  url: string;
  /** 上传生成的缩略图，作 poster，减轻首帧前整段拉流 */
  posterUrl?: string;
}) {
  const src = useMediaDisplaySrc(url);
  const posterSrc = useMediaDisplaySrc(posterUrl?.trim() || undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [src]);

  const showLoading = !src || !ready;

  return (
    <div
      className="card__gallery-thumb-wrap"
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaThumbLoadingOverlay /> : null}
      {src ? (
        <video
          className={[
            "card__gallery-thumb",
            "card__gallery-thumb--video",
            ready ? "card__gallery-thumb--ready" : "card__gallery-thumb--pending",
          ].join(" ")}
          src={src}
          poster={posterSrc || undefined}
          controls
          playsInline
          preload={posterSrc ? "metadata" : "auto"}
          onLoadedData={() => setReady(true)}
          onCanPlay={() => setReady(true)}
          onError={() => setReady(true)}
        />
      ) : null}
    </div>
  );
}

function GalleryInlineAudioBar({ url }: { url: string }) {
  const src = useMediaDisplaySrc(url);
  if (!src) return null;
  return <audio src={src} controls className="card__gallery-inline-audio" />;
}

/** 大图预览：用 `items` 下标驱动，便于左右切换与列表轮播同步 */
type LightboxState = { index: number };

export type CardGalleryPlayback = "default" | "inlineAv";

/** 卡片右侧媒体轮播；inlineAv 时音视频在区内直接 controls，点图/文件仍开 lightbox */
export function CardGallery({
  items,
  onRemoveItem,
  onSetCoverItem,
  playback = "default",
  uploadPending = false,
  uploadProgress = null,
}: {
  items: NoteMediaItem[];
  onRemoveItem?: (item: NoteMediaItem) => void;
  /** 将该项移到 media 数组首位，作为默认首帧 */
  onSetCoverItem?: (item: NoteMediaItem) => void;
  playback?: CardGalleryPlayback;
  /** 正在上传附件：在轮播区显示占位与进度圈 */
  uploadPending?: boolean;
  /** 云端直传 0–100；未就绪时为 null（显示转圈文案） */
  uploadProgress?: number | null;
}) {
  const ui = useAppChrome();
  const labelFromUrl = (url: string) =>
    fileLabelFromUrl(url, ui.uiFileFallback);
  const [i, setI] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  /** 水平滑动切图后短时间内屏蔽误触发的 click（含视频上的幽灵点击） */
  const suppressClicksUntilRef = useRef(0);
  const swipeTrackRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const lightboxSwipeTrackRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
  } | null>(null);
  const lightboxSuppressClicksUntilRef = useRef(0);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [attachMenu, setAttachMenu] = useState<{
    x: number;
    y: number;
    item: NoteMediaItem;
  } | null>(null);
  const n = items.length;
  const inlineAv = playback === "inlineAv";

  const itemsKey = items
    .map(
      (x) =>
        `${x.kind}:${x.url}:${x.name ?? ""}:${x.coverUrl ?? ""}:${x.thumbnailUrl ?? ""}`
    )
    .join("|");

  const safeI = n > 0 ? ((i % n) + n) % n : 0;
  const current = n > 0 ? items[safeI] : items[0];
  const go = (delta: number) => {
    if (n <= 0) return;
    setI((x) => (x + delta + n * 100) % n);
  };
  const goLightbox = useCallback((delta: number) => {
    if (n <= 1) return;
    setLightbox((lb) => {
      if (!lb) return lb;
      const next = (lb.index + delta + n * 100) % n;
      setI(next);
      return { index: next };
    });
  }, [n]);
  const closeLightbox = useCallback(() => {
    setLightbox((lb) => {
      if (lb) setI(lb.index);
      return null;
    });
  }, []);

  useEffect(() => {
    setI((prev) => {
      if (n === 0) return 0;
      return Math.min(prev, n - 1);
    });
  }, [n, itemsKey]);

  useEffect(() => {
    setLightbox((lb) => {
      if (!lb) return lb;
      if (n === 0) return null;
      if (lb.index >= n) return { index: n - 1 };
      if (lb.index < 0) return { index: 0 };
      return lb;
    });
  }, [n, itemsKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (attachMenu) {
          e.preventDefault();
          setAttachMenu(null);
          return;
        }
        if (lightbox) {
          e.preventDefault();
          closeLightbox();
        }
        return;
      }
      if (lightbox && n > 1) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goLightbox(-1);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          goLightbox(1);
        }
      }
    };
    if (!attachMenu && !lightbox) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [attachMenu, lightbox, n, closeLightbox, goLightbox]);

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

  if (n === 0 && !uploadPending) return null;

  if (n === 0 && uploadPending) {
    const pct =
      uploadProgress != null && Number.isFinite(uploadProgress)
        ? Math.max(0, Math.min(100, uploadProgress))
        : null;
    return (
      <div className="card__gallery">
        <div className="card__gallery-viewport">
          <div
            className="card__gallery-upload-slot card__gallery-upload-slot--solo"
            aria-busy
            aria-label={ui.uiUploading}
          >
            {pct != null ? (
              <>
                <div
                  className="card__gallery-upload-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                >
                  <div
                    className="card__gallery-upload-progress__fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="card__gallery-upload-slot__text">
                  {Math.round(pct)}%
                </span>
              </>
            ) : (
              <>
                <span className="card__gallery-upload-spinner" aria-hidden />
                <span className="card__gallery-upload-slot__text">
                  {ui.uiUploading}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function onGalleryViewportPointerDown(
    e: ReactPointerEvent<HTMLDivElement>
  ) {
    if (n <= 1) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!mediaSwipePointerTargetOk(e.target)) return;
    swipeTrackRef.current = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
    };
    /* 不在 viewport 上 setPointerCapture：否则部分浏览器上子元素单击放大不触发 click */
  }

  function onGalleryViewportPointerUp(
    e: ReactPointerEvent<HTMLDivElement>
  ) {
    const st = swipeTrackRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    swipeTrackRef.current = null;
    if (n <= 1) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (
      Math.abs(dx) < SWIPE_MIN_PX ||
      Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE_OVER_VERTICAL
    ) {
      return;
    }
    suppressClicksUntilRef.current =
      performance.now() + SWIPE_SUPPRESS_CLICK_MS;
    go(dx < 0 ? 1 : -1);
  }

  function onGalleryViewportPointerCancel(
    e: ReactPointerEvent<HTMLDivElement>
  ) {
    const st = swipeTrackRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    swipeTrackRef.current = null;
  }

  function onGalleryViewportClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLButtonElement) return;
    if (performance.now() >= suppressClicksUntilRef.current) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onLightboxSwipePointerDown(
    e: ReactPointerEvent<HTMLDivElement>
  ) {
    if (n <= 1) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!mediaSwipePointerTargetOk(e.target)) return;
    lightboxSwipeTrackRef.current = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
    };
  }

  function onLightboxSwipePointerUp(
    e: ReactPointerEvent<HTMLDivElement>
  ) {
    const st = lightboxSwipeTrackRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    lightboxSwipeTrackRef.current = null;
    if (n <= 1) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (
      Math.abs(dx) < SWIPE_MIN_PX ||
      Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE_OVER_VERTICAL
    ) {
      return;
    }
    lightboxSuppressClicksUntilRef.current =
      performance.now() + SWIPE_SUPPRESS_CLICK_MS;
    goLightbox(dx < 0 ? 1 : -1);
  }

  function onLightboxSwipePointerCancel(
    e: ReactPointerEvent<HTMLDivElement>
  ) {
    const st = lightboxSwipeTrackRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    lightboxSwipeTrackRef.current = null;
  }

  function onLightboxSwipeAreaClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLButtonElement) return;
    if (performance.now() >= lightboxSuppressClicksUntilRef.current) return;
    e.preventDefault();
    e.stopPropagation();
  }

  const openCurrentLightbox = () => {
    setLightbox({ index: safeI });
  };

  const openAttachmentMenu = (
    e: MouseEvent<HTMLElement>,
    item: NoteMediaItem
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setAttachMenu({ x: e.clientX, y: e.clientY, item });
  };

  function lightboxActiveItem(): NoteMediaItem | null {
    if (!lightbox || n === 0) return null;
    const idx = ((lightbox.index % n) + n) % n;
    return items[idx] ?? null;
  }

  const lbItem = lightboxActiveItem();
  const lbIdx = lightbox
    ? ((lightbox.index % n) + n) % n
    : 0;

  const lightboxPortal =
    lightbox &&
    lbItem &&
    createPortal(
      <div
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={
          n > 1 ? ui.uiLightboxAria(lbIdx + 1, n) : ui.uiLightboxPreview
        }
        onClick={() => {
          if (
            performance.now() < lightboxSuppressClicksUntilRef.current
          ) {
            return;
          }
          closeLightbox();
        }}
      >
        <button
          type="button"
          className="image-lightbox__close"
          aria-label={ui.uiClose}
          onClick={(e) => {
            e.stopPropagation();
            closeLightbox();
          }}
        >
          ×
        </button>
        <div
          className="image-lightbox__swipe-area"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onLightboxSwipePointerDown}
          onPointerUp={onLightboxSwipePointerUp}
          onPointerCancel={onLightboxSwipePointerCancel}
          onClickCapture={onLightboxSwipeAreaClickCapture}
        >
          {n > 1 ? (
            <span className="image-lightbox__pager" aria-live="polite">
              {lbIdx + 1} / {n}
            </span>
          ) : null}
          {n > 1 ? (
            <>
              <button
                type="button"
                className="image-lightbox__arrow image-lightbox__arrow--prev"
                aria-label={ui.uiPrevItem}
                onClick={(e) => {
                  e.stopPropagation();
                  goLightbox(-1);
                }}
              />
              <button
                type="button"
                className="image-lightbox__arrow image-lightbox__arrow--next"
                aria-label={ui.uiNextItem}
                onClick={(e) => {
                  e.stopPropagation();
                  goLightbox(1);
                }}
              />
            </>
          ) : null}
          {lbItem.kind === "image" ? (
            <div
              className="image-lightbox__media-stack"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                const it = lightboxActiveItem();
                if (it) openAttachmentMenu(e, it);
              }}
            >
              <MediaLightboxImage
                url={lbItem.url}
                className="image-lightbox__img"
              />
              <p className="image-lightbox__media-caption">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
            </div>
          ) : lbItem.kind === "video" ? (
            <div
              className="image-lightbox__media-stack"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                const it = lightboxActiveItem();
                if (it) openAttachmentMenu(e, it);
              }}
            >
              <MediaLightboxVideo
                url={lbItem.url}
                className="image-lightbox__img image-lightbox__video"
              />
              <p className="image-lightbox__media-caption">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
            </div>
          ) : lbItem.kind === "audio" ? (
            <div
              className="image-lightbox__audio-wrap"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                const it = lightboxActiveItem();
                if (it) openAttachmentMenu(e, it);
              }}
            >
              {lbItem.coverUrl ? (
                <MediaLightboxCover
                  url={lbItem.coverUrl}
                  className="image-lightbox__audio-cover"
                />
              ) : null}
              <p className="image-lightbox__audio-title">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
              <MediaLightboxAudio
                url={lbItem.url}
                className="image-lightbox__audio"
              />
            </div>
          ) : (
            <div
              className="image-lightbox__file"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                const it = lightboxActiveItem();
                if (it) openAttachmentMenu(e, it);
              }}
            >
              <FileDocIcon className="image-lightbox__file-icon" />
              <p className="image-lightbox__file-name">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
              <MediaOpenLink
                url={lbItem.url}
                className="image-lightbox__file-link"
              >
                {ui.uiOpenInNewWindow}
              </MediaOpenLink>
            </div>
          )}
        </div>
      </div>,
      document.body
    );

  const attachMenuPortal =
    attachMenu &&
    createPortal(
      <div
        data-attachment-ctx-menu
        className="attachment-ctx-menu"
        style={{
          position: "fixed",
          left: Math.min(
            attachMenu.x,
            typeof window !== "undefined"
              ? window.innerWidth - 180
              : attachMenu.x
          ),
          top: attachMenu.y,
          zIndex: 10001,
        }}
        role="menu"
      >
        {onSetCoverItem &&
        n > 1 &&
        items.findIndex((m) => noteMediaItemsEqual(m, attachMenu.item)) > 0 ? (
          <button
            type="button"
            className="attachment-ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onSetCoverItem(attachMenu.item);
              setI(0);
              setAttachMenu(null);
              setLightbox(null);
            }}
          >
            {ui.uiSetCover}
          </button>
        ) : null}
        {attachMenu.item.kind === "image" ? (
          <button
            type="button"
            className="attachment-ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void copyImageToClipboard(attachMenu.item);
              setAttachMenu(null);
            }}
          >
            {ui.uiCopyImage}
          </button>
        ) : null}
        <button
          type="button"
          className="attachment-ctx-menu__item"
          role="menuitem"
          onClick={() => {
            void downloadMediaItem(attachMenu.item, ui.uiFileFallback);
            setAttachMenu(null);
          }}
        >
          {ui.uiDownloadAttachment}
        </button>
        {onRemoveItem ? (
          <button
            type="button"
            className="attachment-ctx-menu__item attachment-ctx-menu__item--danger"
            role="menuitem"
            onClick={() => {
              onRemoveItem(attachMenu.item);
              setAttachMenu(null);
              setLightbox(null);
            }}
          >
            {ui.uiDeleteAttachment}
          </button>
        ) : null}
      </div>,
      document.body
    );

  const showPlayBadge =
    !inlineAv &&
    (current.kind === "audio" || current.kind === "video");

  const thumbCtx = Boolean(onRemoveItem || onSetCoverItem);
  const galleryThumbTitle = (kind: NoteMediaItem["kind"]): string => {
    if (thumbCtx) {
      if (kind === "image") return ui.uiGalleryThumbTitleImageRich;
      if (kind === "file") return ui.uiGalleryThumbTitleFileRich;
      if (kind === "audio") return ui.uiGalleryThumbTitleAudioRich;
      return ui.uiGalleryThumbTitleVideoRich;
    }
    if (kind === "image") return ui.uiGalleryThumbTitleImagePlain;
    if (kind === "file") return ui.uiGalleryThumbTitleFilePlain;
    if (kind === "audio") return ui.uiGalleryThumbTitleAudioPlain;
    return ui.uiGalleryThumbTitleVideoPlain;
  };
  const galleryThumbAria = (kind: NoteMediaItem["kind"]): string => {
    if (kind === "video") return ui.uiGalleryAriaVideo;
    if (kind === "image") return ui.uiGalleryAriaImage;
    if (kind === "audio") return ui.uiGalleryAriaAudio;
    return ui.uiGalleryAriaFile;
  };

  const thumbInteractive = (() => {
    if (inlineAv && (current.kind === "video" || current.kind === "audio")) {
      return (
        <div
          className={
            "card__gallery-thumb-hit card__gallery-thumb-hit--inline-av" +
            (current.kind === "audio"
              ? " card__gallery-thumb-hit--audio-inline"
              : "")
          }
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            openAttachmentMenu(e, current);
          }}
        >
          {current.kind === "video" ? (
            <GalleryInlineVideo
              url={current.url}
              posterUrl={current.thumbnailUrl}
            />
          ) : (
            <>
              <div className="card__gallery-audio-thumb card__gallery-audio-thumb--inline">
                {current.coverUrl ? (
                  <>
                    <MediaThumbImage
                      url={current.coverUrl}
                      className="card__gallery-audio-cover"
                      alt=""
                    />
                    <div className="card__gallery-audio-cover-caption">
                      <span className="card__gallery-audio-name card__gallery-audio-name--on-cover">
                        {current.name ?? labelFromUrl(current.url)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <AudioGlyphIcon className="card__gallery-audio-icon" />
                    <span className="card__gallery-audio-name">
                      {current.name ?? labelFromUrl(current.url)}
                    </span>
                  </>
                )}
              </div>
              <GalleryInlineAudioBar url={current.url} />
            </>
          )}
        </div>
      );
    }

    return (
      <div
        role="button"
        tabIndex={0}
        className={
          "card__gallery-thumb-hit" +
          (current.kind === "file"
            ? " card__gallery-thumb-hit--file"
            : current.kind === "audio"
              ? " card__gallery-thumb-hit--audio"
              : "")
        }
        title={galleryThumbTitle(current.kind)}
        aria-label={galleryThumbAria(current.kind)}
        onClick={(e) => {
          e.stopPropagation();
          openCurrentLightbox();
        }}
        onContextMenu={(e) => {
          openAttachmentMenu(e, current);
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
            url={current.thumbnailUrl ?? current.url}
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
                  <div className="card__gallery-audio-cover-caption">
                    <span className="card__gallery-audio-name card__gallery-audio-name--on-cover">
                      {current.name ?? labelFromUrl(current.url)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <AudioGlyphIcon className="card__gallery-audio-icon" />
                  <span className="card__gallery-audio-name">
                    {current.name ?? labelFromUrl(current.url)}
                  </span>
                </>
              )}
            </div>
            {showPlayBadge ? (
              <span className="card__gallery-play-badge" aria-hidden>
                ▶
              </span>
            ) : null}
          </>
        ) : current.kind === "video" ? (
          <MediaThumbVideo
            url={current.url}
            thumbnailUrl={current.thumbnailUrl}
            className="card__gallery-thumb card__gallery-thumb--video"
            playBadge={showPlayBadge}
          />
        ) : (
          <div className="card__gallery-file">
            <FileDocIcon className="card__gallery-file-icon" />
            <span className="card__gallery-file-name">
              {current.name ?? labelFromUrl(current.url)}
            </span>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div className="card__gallery">
      {lightboxPortal}
      {attachMenuPortal}
      <div
        ref={viewportRef}
        className="card__gallery-viewport"
        onPointerDown={onGalleryViewportPointerDown}
        onPointerUp={onGalleryViewportPointerUp}
        onPointerCancel={onGalleryViewportPointerCancel}
        onClickCapture={onGalleryViewportClickCapture}
      >
        {thumbInteractive}
        {uploadPending && n > 0 ? (
          <div
            className="card__gallery-upload-strip"
            aria-busy
            aria-label={ui.uiUploading}
          >
            {uploadProgress != null && Number.isFinite(uploadProgress) ? (
              <>
                <div
                  className="card__gallery-upload-progress card__gallery-upload-progress--strip"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(
                    Math.max(0, Math.min(100, uploadProgress))
                  )}
                >
                  <div
                    className="card__gallery-upload-progress__fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, uploadProgress))}%`,
                    }}
                  />
                </div>
                <span className="card__gallery-upload-strip__text">
                  {Math.round(Math.max(0, Math.min(100, uploadProgress)))}%
                </span>
              </>
            ) : (
              <>
                <span className="card__gallery-upload-spinner" aria-hidden />
                <span className="card__gallery-upload-strip__text">
                  {ui.uiUploading}
                </span>
              </>
            )}
          </div>
        ) : null}
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
              aria-label={ui.uiPrevItem}
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
            />
            <button
              type="button"
              className="card__gallery-arrow card__gallery-arrow--next"
              aria-label={ui.uiNextItem}
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
            aria-label={ui.uiPagination}
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
