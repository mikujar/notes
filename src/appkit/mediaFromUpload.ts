import type { NoteMediaItem, NoteMediaKind } from "../types";

/** 将上传接口结果转为 NoteMediaItem */
export function mediaItemFromUploadResult(r: {
  url: string;
  kind: NoteMediaKind;
  name?: string;
  coverUrl?: string;
  thumbnailUrl?: string;
  sizeBytes?: number;
  durationSec?: number;
  widthPx?: number;
  heightPx?: number;
}): NoteMediaItem {
  const dSec = r.durationSec;
  const durationOk =
    (r.kind === "audio" || r.kind === "video") &&
    typeof dSec === "number" &&
    Number.isFinite(dSec) &&
    dSec >= 0;
  const w = r.widthPx;
  const h = r.heightPx;
  const dimsOk =
    (r.kind === "image" || r.kind === "video") &&
    typeof w === "number" &&
    typeof h === "number" &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0 &&
    w <= 32767 &&
    h <= 32767;
  return {
    kind: r.kind,
    url: r.url,
    ...(r.name?.trim() ? { name: r.name.trim() } : {}),
    ...(typeof r.sizeBytes === "number" &&
    Number.isFinite(r.sizeBytes) &&
    r.sizeBytes >= 0
      ? { sizeBytes: Math.floor(r.sizeBytes) }
      : {}),
    ...(durationOk ? { durationSec: Math.round(dSec) } : {}),
    ...(dimsOk ? { widthPx: Math.round(w), heightPx: Math.round(h) } : {}),
    ...(r.kind === "audio" && r.coverUrl?.trim()
      ? { coverUrl: r.coverUrl.trim() }
      : {}),
    ...((r.kind === "video" ||
      r.kind === "image" ||
      r.kind === "file") &&
    r.thumbnailUrl?.trim()
      ? { thumbnailUrl: r.thumbnailUrl.trim() }
      : {}),
  };
}
