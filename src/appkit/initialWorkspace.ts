import { readStoredLoginUiLang } from "../auth/loginUiI18n";
import type { LoginUiLang } from "../auth/loginUiI18n";
import { getAppDataMode } from "../appDataModeStorage";
import { getSeedCollections } from "../data";
import { loadLocalCollections } from "../localCollectionsStorage";
import type { Collection, NoteCard } from "../types";
import { resolveActiveCollectionId } from "./collectionModel";
import {
  activeCollectionStorageKey,
  readPersistedActiveCollectionId,
} from "./workspaceStorage";

export function cloneInitialCollections(
  lang: LoginUiLang = readStoredLoginUiLang()
): Collection[] {
  return getSeedCollections(lang) as Collection[];
}

/**
 * 云端多用户：PostgreSQL 里 `collections.id` 是全局主键，内置示例的 c1/c2… 不能给第二个用户再 INSERT。
 * 在首次 PUT 种子前为当前用户整树换 id，并改写卡片上的 relatedRefs。
 */
export function cloneInitialCollectionsForRemoteUser(
  userId: string,
  lang: LoginUiLang = readStoredLoginUiLang()
): Collection[] {
  const raw = getSeedCollections(lang) as Collection[];
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]+/g, "_");
  const p = `seed-${safe}-`;
  const colOldToNew = new Map<string, string>();
  const cardOldToNew = new Map<string, string>();

  function register(nodes: Collection[]) {
    for (const col of nodes) {
      colOldToNew.set(col.id, p + col.id);
      for (const card of col.cards ?? []) {
        cardOldToNew.set(card.id, p + card.id);
      }
      if (col.children?.length) register(col.children);
    }
  }
  register(raw);

  function remapCard(card: NoteCard): NoteCard {
    const relatedRefs = card.relatedRefs?.map((r) => ({
      colId: colOldToNew.get(r.colId) ?? r.colId,
      cardId: cardOldToNew.get(r.cardId) ?? r.cardId,
    }));
    return {
      ...card,
      id: cardOldToNew.get(card.id) ?? card.id,
      ...(relatedRefs?.length ? { relatedRefs } : {}),
    };
  }

  function remapCol(col: Collection): Collection {
    return {
      ...col,
      id: colOldToNew.get(col.id) ?? col.id,
      cards: (col.cards ?? []).map(remapCard),
      children: col.children?.map(remapCol),
    };
  }

  return raw.map(remapCol);
}

/** 首屏：本地模式读缓存/内置；云端模式不预填示例，避免未登录时闪一下样例 */
export function initialWorkspaceFromStorage(): {
  collections: Collection[];
  activeId: string;
  collapsedFolderIds: Set<string>;
} {
  if (getAppDataMode() === "local") {
    const cols = loadLocalCollections(() =>
      cloneInitialCollections(readStoredLoginUiLang())
    );
    const activeKey = activeCollectionStorageKey("local", null);
    return {
      collections: cols,
      activeId: resolveActiveCollectionId(
        cols,
        readPersistedActiveCollectionId(activeKey)
      ),
      // 合集树始终自动展开；历史存储里的折叠状态不再读回
      collapsedFolderIds: new Set<string>(),
    };
  }
  return {
    collections: [],
    activeId: "",
    collapsedFolderIds: new Set(),
  };
}

export const INITIAL_WORKSPACE = initialWorkspaceFromStorage();
