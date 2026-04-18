import type { AttachmentFilterKey } from "../noteMediaCategory";
import type { NoteCard, NoteMediaItem, TrashedNoteEntry } from "../types";
import { apiBase, apiFetchInit } from "./apiBase";
import { buildHeadersGet, buildHeadersPut } from "./collections";

/** 与 GET /api/me/attachments 单行一致 */
export type MeAttachmentListItem = {
  colId: string;
  cardId: string;
  mediaIndex: number;
  item: NoteMediaItem;
};

function isNoteMediaItem(x: unknown): x is NoteMediaItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.url !== "string" ||
    !(
      o.kind === "image" ||
      o.kind === "video" ||
      o.kind === "audio" ||
      o.kind === "file"
    )
  ) {
    return false;
  }
  if (
    o.durationSec !== undefined &&
    o.durationSec !== null &&
    (typeof o.durationSec !== "number" || !Number.isFinite(o.durationSec))
  ) {
    return false;
  }
  return true;
}

function parseMeAttachmentListItem(x: unknown): MeAttachmentListItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (
    typeof o.colId !== "string" ||
    typeof o.cardId !== "string" ||
    typeof o.mediaIndex !== "number" ||
    !isNoteMediaItem(o.item)
  ) {
    return null;
  }
  return {
    colId: o.colId,
    cardId: o.cardId,
    mediaIndex: o.mediaIndex,
    item: o.item,
  };
}

/** 拉取星标合集 id；null 表示失败 */
export async function fetchMeFavorites(): Promise<string[] | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/favorites`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { collectionIds?: unknown };
    if (!Array.isArray(j.collectionIds)) return null;
    return j.collectionIds.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

/** 整表替换星标 id 列表 */
export async function putMeFavorites(collectionIds: string[]): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/favorites`,
      apiFetchInit({
        method: "PUT",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify({ collectionIds }),
      })
    );
    return r.ok;
  } catch {
    return false;
  }
}

/** 当前用户附件总数（未回收站）；null 表示失败 */
export async function fetchMeAttachmentsCount(
  filterKey?: AttachmentFilterKey
): Promise<number | null> {
  const base = apiBase();
  const q =
    filterKey && filterKey !== "all"
      ? `?filter=${encodeURIComponent(filterKey)}`
      : "";
  try {
    const r = await fetch(
      `${base}/api/me/attachments/count${q}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { total?: unknown };
    if (typeof j.total !== "number" || !Number.isFinite(j.total)) return null;
    return j.total;
  } catch {
    return null;
  }
}

/** 分页附件列表；null 表示失败 */
export async function fetchMeAttachmentsPage(opts: {
  limit: number;
  offset: number;
  filterKey: AttachmentFilterKey;
}): Promise<{ items: MeAttachmentListItem[]; total: number } | null> {
  const base = apiBase();
  const q = new URLSearchParams();
  q.set("limit", String(opts.limit));
  q.set("offset", String(opts.offset));
  if (opts.filterKey !== "all") q.set("filter", opts.filterKey);
  try {
    const r = await fetch(
      `${base}/api/me/attachments?${q.toString()}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { items?: unknown; total?: unknown };
    if (typeof j.total !== "number" || !Number.isFinite(j.total)) return null;
    if (!Array.isArray(j.items)) return null;
    const items: MeAttachmentListItem[] = [];
    for (const row of j.items) {
      const parsed = parseMeAttachmentListItem(row);
      if (parsed) items.push(parsed);
    }
    return { items, total: j.total };
  } catch {
    return null;
  }
}

/** 拉取云端回收站；null 表示失败 */
export async function fetchMeTrash(): Promise<TrashedNoteEntry[] | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/trash`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { entries?: unknown };
    if (!Array.isArray(j.entries)) return null;
    const out: TrashedNoteEntry[] = [];
    for (const e of j.entries) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      if (
        typeof o.trashId !== "string" ||
        typeof o.colId !== "string" ||
        typeof o.card !== "object" ||
        o.card === null
      ) {
        continue;
      }
      out.push({
        trashId: o.trashId,
        colId: o.colId,
        colPathLabel: typeof o.colPathLabel === "string" ? o.colPathLabel : "",
        card: o.card as TrashedNoteEntry["card"],
        deletedAt: typeof o.deletedAt === "string" ? o.deletedAt : "",
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** 写入一条回收站快照（删除笔记前调用） */
/** 从回收站恢复到指定合集（服务端清除 trashed 标记并插入归属） */
export async function postMeTrashRestore(args: {
  cardId: string;
  targetCollectionId: string;
  insertAtStart?: boolean;
}): Promise<{ ok: true; card: NoteCard } | { ok: false }> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/trash/restore`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          cardId: args.cardId,
          targetCollectionId: args.targetCollectionId,
          insertAtStart: args.insertAtStart ?? false,
        }),
      })
    );
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { card?: unknown };
    if (!j.card || typeof j.card !== "object") return { ok: false };
    return { ok: true, card: j.card as NoteCard };
  } catch {
    return { ok: false };
  }
}

export async function postMeTrashEntry(entry: TrashedNoteEntry): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/trash`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(entry),
      })
    );
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteMeTrashEntry(trashId: string): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/trash/${encodeURIComponent(trashId)}`,
      apiFetchInit({ method: "DELETE", headers: buildHeadersPut() })
    );
    return r.ok;
  } catch {
    return false;
  }
}

export async function clearMeTrash(): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/trash`,
      apiFetchInit({ method: "DELETE", headers: buildHeadersPut() })
    );
    return r.ok;
  } catch {
    return false;
  }
}
