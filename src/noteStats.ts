import type { Collection, NoteMediaItem } from "./types";

/** 从 data URL 估算解码后字节数（base64；非 base64 片段按 UTF-8 粗算） */
export function approxBytesFromDataUrl(dataUrl: string): number {
  const base64Idx = dataUrl.indexOf(";base64,");
  if (base64Idx >= 0) {
    const b64 = dataUrl.slice(base64Idx + 8).replace(/\s/g, "");
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const raw = dataUrl.slice(comma + 1);
  try {
    return new TextEncoder().encode(decodeURIComponent(raw)).length;
  } catch {
    return Math.max(0, raw.length);
  }
}

function bytesFromMediaUrl(url: string, sizeBytes?: number): number {
  if (
    typeof sizeBytes === "number" &&
    Number.isFinite(sizeBytes) &&
    sizeBytes >= 0
  ) {
    return Math.floor(sizeBytes);
  }
  const u = url.trim();
  if (u.startsWith("data:")) return approxBytesFromDataUrl(u);
  return 0;
}

function bytesFromMediaItem(m: NoteMediaItem): number {
  let n = bytesFromMediaUrl(m.url ?? "", m.sizeBytes);
  if (m.coverUrl?.trim()) {
    n += bytesFromMediaUrl(m.coverUrl, undefined);
  }
  if (m.thumbnailUrl?.trim()) {
    n += bytesFromMediaUrl(m.thumbnailUrl, undefined);
  }
  return n;
}

function mediaMainMayHaveUnknownSize(m: NoteMediaItem): boolean {
  const u = m.url?.trim() ?? "";
  if (!u) return false;
  if (typeof m.sizeBytes === "number" && m.sizeBytes >= 0) return false;
  if (u.startsWith("data:")) return false;
  return true;
}

export function formatByteSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export type NoteLibraryStats = {
  collectionCount: number;
  cardCount: number;
  attachmentCount: number;
  attachmentBytes: number;
  hasUnknownSizedAttachments: boolean;
};

export function summarizeNoteLibraryStats(cols: Collection[]): NoteLibraryStats {
  let collectionCount = 0;
  let cardCount = 0;
  let attachmentCount = 0;
  let attachmentBytes = 0;
  let hasUnknownSizedAttachments = false;

  const visit = (c: Collection) => {
    collectionCount += 1;
    for (const card of c.cards) {
      cardCount += 1;
      for (const m of card.media ?? []) {
        if (!m.url?.trim()) continue;
        attachmentCount += 1;
        attachmentBytes += bytesFromMediaItem(m);
        if (mediaMainMayHaveUnknownSize(m)) hasUnknownSizedAttachments = true;
        const cov = m.coverUrl?.trim();
        if (cov && !cov.startsWith("data:")) hasUnknownSizedAttachments = true;
        const th = m.thumbnailUrl?.trim();
        if (th && !th.startsWith("data:")) hasUnknownSizedAttachments = true;
      }
    }
    for (const ch of c.children ?? []) visit(ch);
  };

  for (const c of cols) visit(c);

  return {
    collectionCount,
    cardCount,
    attachmentCount,
    attachmentBytes,
    hasUnknownSizedAttachments,
  };
}
