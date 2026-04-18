import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  mightHaveApiSession,
  needsCosReadUrl,
  resolveCosMediaUrlIfNeeded,
  resolveMediaUrl,
} from "./api/auth";
import {
  isLocalMediaRef,
  resolveLocalMediaDisplayUrl,
} from "./localMediaTauri";
import {
  getSessionCachedBlobUrl,
  resolveCosMediaDisplayWithPersistentCache,
} from "./mediaCache";
export function useMediaDisplaySrc(url: string | undefined): string {
  const [src, setSrc] = useState(() => {
    if (!url) return "";
    if (!isLocalMediaRef(url)) {
      const b = resolveMediaUrl(url);
      if (!needsCosReadUrl(b)) return b;
      // 无会话时 resolveCosReadUrl 也会退回直链，首帧即可用，避免轮播/大图「点了没反应」
      if (!mightHaveApiSession()) return b;
      const mem = getSessionCachedBlobUrl(b);
      if (mem) return mem;
      return "";
    }
    return "";
  });
  useEffect(() => {
    if (!url) {
      setSrc("");
      return;
    }
    if (!isLocalMediaRef(url)) {
      const base = resolveMediaUrl(url);
      if (!needsCosReadUrl(base)) {
        setSrc(base);
        return;
      }
      let c = false;
      void resolveCosMediaDisplayWithPersistentCache(base)
        .then((s) => {
          if (!c) {
            const v = typeof s === "string" ? s.trim() : "";
            if (v) setSrc(v);
            else if (!needsCosReadUrl(base)) setSrc(base);
          }
        })
        .catch(() => {
          if (!c) {
            if (!needsCosReadUrl(base)) setSrc(base);
            else {
              void resolveCosMediaUrlIfNeeded(base).then((p) => {
                if (!c) setSrc(typeof p === "string" && p.trim() ? p.trim() : "");
              });
            }
          }
        });
      return () => {
        c = true;
      };
    }
    let c = false;
    void resolveLocalMediaDisplayUrl(url).then((s) => {
      if (!c) setSrc(s);
    });
    return () => {
      c = true;
    };
  }, [url]);
  return src;
}

/** 卡片轮播内缩略图加载（供 Gallery 内联视频等复用） */
export function MediaThumbLoadingOverlay() {
  return (
    <div className="card__media-loading" aria-hidden>
      <span className="card__media-loading__spinner" />
    </div>
  );
}

export function MediaThumbImage({
  url,
  className,
  alt = "",
  /** 缩略图/封面等小图：优先拉取，减轻首屏灰块时间 */
  priority = false,
}: {
  url: string;
  className?: string;
  alt?: string;
  priority?: boolean;
}) {
  const src = useMediaDisplaySrc(url);
  const [decoded, setDecoded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setDecoded(false);
  }, [src]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) setDecoded(true);
  }, [src]);

  const showLoading = !src || !decoded;

  return (
    <div
      className="card__gallery-thumb-wrap"
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaThumbLoadingOverlay /> : null}
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className={[className, decoded ? "card__gallery-thumb--ready" : "card__gallery-thumb--pending"]
            .filter(Boolean)
            .join(" ")}
          onLoad={() => setDecoded(true)}
          onError={() => setDecoded(true)}
        />
      ) : null}
    </div>
  );
}

export function MediaThumbVideo({
  url,
  thumbnailUrl,
  coverUrl,
  className,
  playBadge = false,
  /** 无截帧小图时，video 的 preload；网格里用 metadata 可减轻多路并发拉流 */
  videoPreload = "auto",
  videoFetchPriority,
  thumbImagePriority = true,
}: {
  url: string;
  /** 上传时写入笔记的截帧小图；与 `coverUrl` 二有一即可走图片分支，不拉整段视频作首帧 */
  thumbnailUrl?: string;
  /** 少数数据或迁移里视频封面只写在 coverUrl；优先仍用 thumbnailUrl */
  coverUrl?: string;
  className?: string;
  /** 合集列表等：显示 ▶；须放在 wrap 内，避免 video 合成层盖住兄弟节点 */
  playBadge?: boolean;
  videoPreload?: "auto" | "metadata" | "none";
  videoFetchPriority?: "high" | "low" | "auto";
  /** 有静态封面时传给内层 MediaThumbImage（首屏格子可设 high） */
  thumbImagePriority?: boolean;
}) {
  const thumb = thumbnailUrl?.trim() || coverUrl?.trim() || "";
  const src = useMediaDisplaySrc(thumb ? undefined : url);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [src]);

  if (thumb) {
    return (
      <div className="card__gallery-thumb-wrap">
        <MediaThumbImage
          url={thumb}
          className={[className, "card__gallery-thumb--video"].filter(Boolean).join(" ")}
          alt=""
          priority={thumbImagePriority}
        />
        {playBadge ? (
          <span className="card__gallery-play-badge" aria-hidden>
            ▶
          </span>
        ) : null}
      </div>
    );
  }

  const showLoading = !src || !ready;

  return (
    <div
      className="card__gallery-thumb-wrap"
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaThumbLoadingOverlay /> : null}
      {src ? (
        <video
          className={[className, ready ? "card__gallery-thumb--ready" : "card__gallery-thumb--pending"]
            .filter(Boolean)
            .join(" ")}
          src={src}
          muted
          playsInline
          preload={videoPreload}
          tabIndex={-1}
          aria-hidden
          {...(videoFetchPriority
            ? { fetchPriority: videoFetchPriority }
            : {})}
          onLoadedData={() => setReady(true)}
          onCanPlay={() => setReady(true)}
          onError={() => setReady(true)}
        />
      ) : null}
      {playBadge && !showLoading ? (
        <span className="card__gallery-play-badge" aria-hidden>
          ▶
        </span>
      ) : null}
    </div>
  );
}

function MediaLightboxLoadingOverlay({
  surface = "dark",
}: {
  surface?: "dark" | "light";
}) {
  return (
    <div
      className={
        "image-lightbox__media-loading" +
        (surface === "light" ? " image-lightbox__media-loading--on-light" : "")
      }
      aria-hidden
    >
      <span className="image-lightbox__media-loading__spinner" />
    </div>
  );
}

export function MediaLightboxImage({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const src = useMediaDisplaySrc(url);
  const [decoded, setDecoded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setDecoded(false);
  }, [src]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) setDecoded(true);
  }, [src]);

  const showLoading = !src || !decoded;

  return (
    <div
      className={
        "image-lightbox__media-frame" +
        (!src ? " image-lightbox__media-frame--empty" : "")
      }
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaLightboxLoadingOverlay surface="dark" /> : null}
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          decoding="async"
          className={[
            className,
            decoded ? "image-lightbox__img--ready" : "image-lightbox__img--pending",
          ]
            .filter(Boolean)
            .join(" ")}
          onLoad={() => setDecoded(true)}
          onError={() => setDecoded(true)}
        />
      ) : null}
    </div>
  );
}

export function MediaLightboxVideo({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const src = useMediaDisplaySrc(url);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [src]);

  const showLoading = !src || !ready;

  return (
    <div
      className={
        "image-lightbox__media-frame" +
        (!src ? " image-lightbox__media-frame--empty" : "")
      }
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaLightboxLoadingOverlay surface="dark" /> : null}
      {src ? (
        <video
          key={src}
          src={src}
          className={[
            className,
            ready ? "image-lightbox__img--ready" : "image-lightbox__img--pending",
          ]
            .filter(Boolean)
            .join(" ")}
          controls
          playsInline
          autoPlay
          preload="auto"
          onLoadedData={() => setReady(true)}
          onCanPlay={() => setReady(true)}
          onError={() => setReady(true)}
        />
      ) : null}
    </div>
  );
}

export function MediaLightboxAudio({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const src = useMediaDisplaySrc(url);
  if (!src) return null;
  return (
    <audio
      key={src}
      src={src}
      controls
      autoPlay
      className={className}
    />
  );
}

/** 灯箱内嵌浏览器原生 PDF 阅读器（依赖 iframe + 直链 Content-Type） */
export function MediaLightboxPdf({
  url,
  className,
  title,
}: {
  url: string;
  className?: string;
  title?: string;
}) {
  const src = useMediaDisplaySrc(url);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [src]);

  useEffect(() => {
    if (!src) return;
    const t = window.setTimeout(() => setReady(true), 2200);
    return () => window.clearTimeout(t);
  }, [src]);

  const showLoading = !src || !ready;

  return (
    <div
      className={
        "image-lightbox__media-frame image-lightbox__media-frame--pdf" +
        (!src ? " image-lightbox__media-frame--empty" : "")
      }
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaLightboxLoadingOverlay surface="dark" /> : null}
      {src ? (
        <iframe
          key={src}
          src={src}
          title={title ?? "PDF"}
          className={[
            className ?? "image-lightbox__pdf",
            ready ? "image-lightbox__pdf--ready" : "image-lightbox__pdf--pending",
          ]
            .filter(Boolean)
            .join(" ")}
          onLoad={() => setReady(true)}
        />
      ) : null}
    </div>
  );
}

export function MediaLightboxCover({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const src = useMediaDisplaySrc(url);
  const [decoded, setDecoded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setDecoded(false);
  }, [src]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el?.complete) return;
    if (el.naturalWidth > 0) setDecoded(true);
  }, [src]);

  const showLoading = !src || !decoded;

  return (
    <div
      className={
        "image-lightbox__cover-frame" +
        (!src ? " image-lightbox__media-frame--empty" : "")
      }
      aria-busy={showLoading || undefined}
    >
      {showLoading ? <MediaLightboxLoadingOverlay surface="light" /> : null}
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt=""
          decoding="async"
          className={[
            className,
            decoded
              ? "image-lightbox__audio-cover--ready"
              : "image-lightbox__audio-cover--pending",
          ]
            .filter(Boolean)
            .join(" ")}
          onLoad={() => setDecoded(true)}
          onError={() => setDecoded(true)}
        />
      ) : null}
    </div>
  );
}

export function MediaOpenLink({
  url,
  className,
  children,
}: {
  url: string;
  className?: string;
  children: ReactNode;
}) {
  const href = useMediaDisplaySrc(url);
  if (!href) {
    return (
      <span className={className} aria-disabled>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
