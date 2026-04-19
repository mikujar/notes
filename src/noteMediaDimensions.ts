import type { NoteMediaItem, NoteMediaKind } from "./types";

/**
 * 从本地 File 读取图片或视频的像素尺寸（浏览器）。
 */
export async function probeDimensionsFromFile(
  file: File,
  kind: NoteMediaKind
): Promise<{ widthPx: number; heightPx: number } | null> {
  if (kind === "image") {
    try {
      const bmp = await createImageBitmap(file);
      try {
        const w = bmp.width;
        const h = bmp.height;
        if (w > 0 && h > 0 && w <= 32767 && h <= 32767) {
          return { widthPx: w, heightPx: h };
        }
      } finally {
        bmp.close();
      }
    } catch {
      /* createImageBitmap 不支持时走 Image */
    }
    const url = URL.createObjectURL(file);
    try {
      const d = await new Promise<{ w: number; h: number } | null>(
        (resolve) => {
          const img = new Image();
          img.onload = () =>
            resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = url;
        }
      );
      if (
        d &&
        d.w > 0 &&
        d.h > 0 &&
        d.w <= 32767 &&
        d.h <= 32767
      ) {
        return { widthPx: d.w, heightPx: d.h };
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    return null;
  }
  if (kind === "video") {
    const url = URL.createObjectURL(file);
    try {
      const d = await new Promise<{ w: number; h: number } | null>(
        (resolve) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.muted = true;
          v.onloadedmetadata = () =>
            resolve({ w: v.videoWidth, h: v.videoHeight });
          v.onerror = () => resolve(null);
          v.src = url;
        }
      );
      if (
        d &&
        d.w > 0 &&
        d.h > 0 &&
        d.w <= 32767 &&
        d.h <= 32767
      ) {
        return { widthPx: d.w, heightPx: d.h };
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    return null;
  }
  return null;
}

function itemHasResolution(item: NoteMediaItem): boolean {
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

/** 若尚无宽高且为图/视频，则用本地 File 补全（云端 finalize 已写入时跳过） */
export async function ensureMediaItemDimensionsFromFile(
  file: File,
  item: NoteMediaItem
): Promise<NoteMediaItem> {
  if (item.kind !== "image" && item.kind !== "video") return item;
  if (itemHasResolution(item)) return item;
  const d = await probeDimensionsFromFile(file, item.kind);
  if (!d) return item;
  return { ...item, widthPx: d.widthPx, heightPx: d.heightPx };
}
