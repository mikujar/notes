import type { NoteMediaItem } from "./types";

/** 由附件元数据得到文件卡「标题」初值(带扩展名,无则空串) */
export function deriveFileCardTitleFromMedia(item: NoteMediaItem): string {
  const name = item.name?.trim();
  if (name) return name;
  const url = item.url?.trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(seg);
  } catch {
    const noQuery = url.split("?")[0] ?? "";
    const seg = noQuery.split("/").filter(Boolean).pop() ?? "";
    return seg;
  }
}

/** 与云端 migrate / createFileCard 一致的 objectKind */
export function objectKindFromNoteMediaKind(
  kind: NoteMediaItem["kind"]
): string {
  if (kind === "image") return "file_image";
  if (kind === "video") return "file_video";
  if (kind === "audio") return "file_audio";
  return "file_document";
}
