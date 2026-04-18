import { resolveCosMediaUrlIfNeeded, resolveMediaUrl } from "./api/auth";
import { LOCAL_MEDIA_PREFIX } from "./localMediaTauri";
import type { NoteMediaItem } from "./types";

export function noteMediaItemsEqual(a: NoteMediaItem, b: NoteMediaItem): boolean {
  return (
    a.url === b.url &&
    a.kind === b.kind &&
    (a.name ?? "") === (b.name ?? "") &&
    (a.coverUrl ?? "") === (b.coverUrl ?? "") &&
    (a.thumbnailUrl ?? "") === (b.thumbnailUrl ?? "") &&
    (a.durationSec ?? null) === (b.durationSec ?? null)
  );
}

export function fileLabelFromUrl(url: string, fileFallback: string): string {
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
export async function copyImageToClipboard(item: NoteMediaItem) {
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
export async function downloadMediaItem(
  item: NoteMediaItem,
  fileFallback: string
) {
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
