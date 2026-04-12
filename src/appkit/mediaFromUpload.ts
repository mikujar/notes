import type { NoteMediaItem, NoteMediaKind } from "../types";

/** 将上传接口结果转为 NoteMediaItem */
export function mediaItemFromUploadResult(r: {
  url: string;
  kind: NoteMediaKind;
  name?: string;
  coverUrl?: string;
  thumbnailUrl?: string;
  sizeBytes?: number;
}): NoteMediaItem {
  return {
    kind: r.kind,
    url: r.url,
    ...(r.name?.trim() ? { name: r.name.trim() } : {}),
    ...(typeof r.sizeBytes === "number" &&
    Number.isFinite(r.sizeBytes) &&
    r.sizeBytes >= 0
      ? { sizeBytes: Math.floor(r.sizeBytes) }
      : {}),
    ...(r.kind === "audio" && r.coverUrl?.trim()
      ? { coverUrl: r.coverUrl.trim() }
      : {}),
    ...(r.kind === "video" && r.thumbnailUrl?.trim()
      ? { thumbnailUrl: r.thumbnailUrl.trim() }
      : {}),
  };
}
