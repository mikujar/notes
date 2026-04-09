import { useEffect, useRef, useState, type ReactNode } from "react";
import { resolveMediaUrl } from "./api/auth";
import {
  isLocalMediaRef,
  resolveLocalMediaDisplayUrl,
} from "./localMediaTauri";
export function useMediaDisplaySrc(url: string | undefined): string {
  const [src, setSrc] = useState(() => {
    if (!url) return "";
    if (!isLocalMediaRef(url)) return resolveMediaUrl(url);
    return "";
  });
  useEffect(() => {
    if (!url) {
      setSrc("");
      return;
    }
    if (!isLocalMediaRef(url)) {
      setSrc(resolveMediaUrl(url));
      return;
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

/** 卡片轮播内缩略图加载动画（供 Gallery 内联视频等复用） */
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
}: {
  url: string;
  className?: string;
  alt?: string;
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
          loading="lazy"
          decoding="async"
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
  className,
  playBadge = false,
}: {
  url: string;
  className?: string;
  /** 合集列表等：显示 ▶；须放在 wrap 内，避免 video 合成层盖住兄弟节点 */
  playBadge?: boolean;
}) {
  const src = useMediaDisplaySrc(url);
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
          className={[className, ready ? "card__gallery-thumb--ready" : "card__gallery-thumb--pending"]
            .filter(Boolean)
            .join(" ")}
          src={src}
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          aria-hidden
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
