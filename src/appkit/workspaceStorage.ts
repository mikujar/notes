import type { AppDataMode } from "../appDataModeStorage";
import type { NoteCard, TrashedNoteEntry } from "../types";

export const ACTIVE_COLLECTION_STORAGE_PREFIX = "mikujar-active-collection:";

/** 存在 active 键上时表示主区为「全部笔记」，而非某个合集 id */
export const PERSISTED_WORKSPACE_ALL_NOTES = "__mikujar_workspace_all_notes__";

export function activeCollectionStorageKey(
  mode: AppDataMode,
  userId: string | null
): string {
  if (mode === "local") {
    return `${ACTIVE_COLLECTION_STORAGE_PREFIX}local`;
  }
  return `${ACTIVE_COLLECTION_STORAGE_PREFIX}remote:${userId ?? "guest"}`;
}

export function readPersistedActiveCollectionId(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const t = raw.trim();
    return t.length ? t : null;
  } catch {
    return null;
  }
}

export const COLLAPSED_FOLDERS_STORAGE_PREFIX = "mikujar-sidebar-collapsed:";

export function collapsedFoldersStorageKey(
  mode: AppDataMode,
  userId: string | null
): string {
  if (mode === "local") {
    return `${COLLAPSED_FOLDERS_STORAGE_PREFIX}local`;
  }
  return `${COLLAPSED_FOLDERS_STORAGE_PREFIX}remote:${userId ?? "guest"}`;
}

export function readCollapsedFolderIdsFromStorage(key: string): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      )
    );
  } catch {
    return new Set();
  }
}
export const FAVORITE_COLLECTIONS_STORAGE_PREFIX = "mikujar-favorite-collections:";

export function favoriteCollectionsStorageKey(userId: string | null): string {
  return `${FAVORITE_COLLECTIONS_STORAGE_PREFIX}${userId ?? "guest"}`;
}

export function loadFavoriteCollectionIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (x): x is string => typeof x === "string" && x.length > 0
      )
    );
  } catch {
    return new Set();
  }
}

export function saveFavoriteCollectionIds(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    /* quota / 隐私模式 */
  }
}

export const TRASH_CARDS_STORAGE_PREFIX = "mikujar-trash-cards:";

export function trashCardsStorageKey(
  dataMode: AppDataMode,
  userId: string | null
): string {
  return `${TRASH_CARDS_STORAGE_PREFIX}${dataMode}:${userId ?? "guest"}`;
}

export function isTrashedNoteEntry(x: unknown): x is TrashedNoteEntry {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.trashId === "string" &&
    o.trashId.length > 0 &&
    typeof o.colId === "string" &&
    typeof o.colPathLabel === "string" &&
    typeof o.deletedAt === "string" &&
    o.card !== null &&
    typeof o.card === "object" &&
    typeof (o.card as NoteCard).id === "string"
  );
}

export function loadTrashedNoteEntries(key: string): TrashedNoteEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrashedNoteEntry);
  } catch {
    return [];
  }
}

export function saveTrashedNoteEntries(
  key: string,
  entries: TrashedNoteEntry[]
): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}
