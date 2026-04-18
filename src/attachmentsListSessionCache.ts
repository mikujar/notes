import type { AttachmentFilterKey } from "./noteMediaCategory";
import type { MeAttachmentListItem } from "./api/mePreferences";

const PREFIX = "mikujar-remote-attachments:v1:";

type CachedPayload = {
  items: MeAttachmentListItem[];
  total: number;
};

function pageKey(
  userKey: string,
  filterKey: AttachmentFilterKey,
  offset: number
): string {
  return `${PREFIX}${userKey}:${filterKey}:${offset}`;
}

/** 读取上一屏缓存（同标签页刷新后立即可用；附件变更后应先 {@link clearRemoteAttachmentsListCacheForUser}） */
export function readRemoteAttachmentsPageCache(
  userKey: string,
  filterKey: AttachmentFilterKey,
  offset: number
): { items: MeAttachmentListItem[]; total: number } | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(pageKey(userKey, filterKey, offset));
    if (!raw) return null;
    const j = JSON.parse(raw) as CachedPayload;
    if (!j || !Array.isArray(j.items) || typeof j.total !== "number") {
      return null;
    }
    return { items: j.items, total: j.total };
  } catch {
    return null;
  }
}

export function writeRemoteAttachmentsPageCache(
  userKey: string,
  filterKey: AttachmentFilterKey,
  offset: number,
  data: { items: MeAttachmentListItem[]; total: number }
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const payload: CachedPayload = {
      items: data.items,
      total: data.total,
    };
    sessionStorage.setItem(pageKey(userKey, filterKey, offset), JSON.stringify(payload));
  } catch {
    /* 配额或隐私模式 */
  }
}

/** 附件增删等导致列表失效时清空该用户的列表缓存（避免同会话内读到旧网格） */
export function clearRemoteAttachmentsListCacheForUser(userKey: string): void {
  if (typeof sessionStorage === "undefined") return;
  const head = `${PREFIX}${userKey}:`;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(head)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

const PAGE_INDEX_PREFIX = "mikujar-all-attachments-page-index:v1:";

function allAttachmentsPageIndexKey(
  userKey: string,
  dataMode: "local" | "remote",
  filterKey: AttachmentFilterKey
): string {
  return `${PAGE_INDEX_PREFIX}${userKey}:${dataMode}:${filterKey}`;
}

/** 刷新后恢复「所有附件」分页（按用户 / 模式 / 筛选） */
export function readAllAttachmentsStoredPageIndex(
  userKey: string,
  dataMode: "local" | "remote",
  filterKey: AttachmentFilterKey
): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(
      allAttachmentsPageIndexKey(userKey, dataMode, filterKey)
    );
    if (raw == null) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  } catch {
    return null;
  }
}

export function writeAllAttachmentsStoredPageIndex(
  userKey: string,
  dataMode: "local" | "remote",
  filterKey: AttachmentFilterKey,
  pageIndex: number
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!Number.isFinite(pageIndex) || pageIndex < 0) return;
    sessionStorage.setItem(
      allAttachmentsPageIndexKey(userKey, dataMode, filterKey),
      String(Math.trunc(pageIndex))
    );
  } catch {
    /* ignore */
  }
}
