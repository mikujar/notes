import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { LoginUiLang } from "../auth/loginUiI18n";
import { fetchApiHealth } from "../api/health";
import { getAppChrome } from "../i18n/appChrome";
import {
  fetchCollectionsFromApi,
  saveCollectionsToApi,
} from "../api/collections";
import type { AppDataMode } from "../appDataModeStorage";
import { getAdminToken } from "../auth/token";
import {
  cloneInitialCollections,
  cloneInitialCollectionsForRemoteUser,
} from "./initialWorkspace";
import { loadLocalCollections } from "../localCollectionsStorage";
import { migrateCollectionTree } from "../migrateCollections";
import {
  loadRemoteCollectionsSnapshot,
  remoteSnapshotUserKey,
  saveRemoteCollectionsSnapshot,
} from "../remoteCollectionsCache";
import type { Collection } from "../types";
import {
  activeCollectionStorageKey,
  collapsedFoldersStorageKey,
  readCollapsedFolderIdsFromStorage,
  readPersistedActiveCollectionId,
} from "./workspaceStorage";
import {
  mergeServerTreeWithLocalExtraCards,
  pruneCollapsedFolderIds,
  resolveActiveCollectionId,
} from "./collectionModel";

type MediaMode = "cos" | "local" | null;

/**
 * 云端：健康检查 + 拉取/缓存合集树；本地：读 localStorage。
 */
export function useRemoteCollectionsSync(p: {
  authReady: boolean;
  dataMode: AppDataMode;
  appUiLang: LoginUiLang;
  writeRequiresLogin: boolean;
  currentUser: { id: string } | null | undefined;
  setCollections: Dispatch<SetStateAction<Collection[]>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setCollapsedFolderIds: Dispatch<SetStateAction<Set<string>>>;
  setRemoteLoaded: Dispatch<SetStateAction<boolean>>;
  setRemoteBootSyncing: Dispatch<SetStateAction<boolean>>;
  setRemoteSaveAllowed: Dispatch<SetStateAction<boolean>>;
  setApiOnline: Dispatch<SetStateAction<boolean>>;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  setMediaUploadMode: Dispatch<SetStateAction<MediaMode>>;
  setSidebarFlash: Dispatch<SetStateAction<string | null>>;
  /** 与 merge 时 React 状态一致（勿在 effect 内 flushSync） */
  getCollectionsForMerge: () => Collection[];
  /** GET 整树前先把防抖中的正文写入服务端，避免 merge 用旧包覆盖未落库的编辑 */
  flushPendingTextBeforeRemoteFetch?: () => Promise<void>;
}): void {
  const {
    authReady,
    dataMode,
    appUiLang,
    writeRequiresLogin,
    currentUser,
    getCollectionsForMerge,
    flushPendingTextBeforeRemoteFetch,
    setCollections,
    setActiveId,
    setCollapsedFolderIds,
    setRemoteLoaded,
    setRemoteBootSyncing,
    setRemoteSaveAllowed,
    setApiOnline,
    setLoadError,
    setSaveError,
    setMediaUploadMode,
    setSidebarFlash,
  } = p;

  useEffect(() => {
    if (!authReady) return;

    const chrome = getAppChrome(appUiLang);

    if (dataMode === "local") {
      setMediaUploadMode(null);
      setApiOnline(true);
      setLoadError(null);
      setSaveError(null);
      setRemoteBootSyncing(false);
      const cols = loadLocalCollections(() =>
        cloneInitialCollections(appUiLang)
      );
      setCollections(cols);
      const localKey = activeCollectionStorageKey("local", null);
      const localCollapsedKey = collapsedFoldersStorageKey("local", null);
      setActiveId(
        resolveActiveCollectionId(cols, readPersistedActiveCollectionId(localKey))
      );
      setCollapsedFolderIds(
        pruneCollapsedFolderIds(
          cols,
          readCollapsedFolderIdsFromStorage(localCollapsedKey)
        )
      );
      setRemoteLoaded(true);
      return;
    }

    const snapshotKey = remoteSnapshotUserKey(
      writeRequiresLogin,
      currentUser?.id ?? null
    );
    const canTryRemoteCache =
      snapshotKey !== null &&
      (!writeRequiresLogin || Boolean(currentUser || getAdminToken()));

    let usedRemoteCache = false;
    if (canTryRemoteCache) {
      const cached = loadRemoteCollectionsSnapshot(snapshotKey);
      if (cached !== null) {
        const remoteUserId = writeRequiresLogin ? currentUser?.id ?? null : null;
        const remoteKey = activeCollectionStorageKey("remote", remoteUserId);
        const remoteCollapsedKey = collapsedFoldersStorageKey(
          "remote",
          remoteUserId
        );
        setCollections(cached);
        setActiveId(
          resolveActiveCollectionId(
            cached,
            readPersistedActiveCollectionId(remoteKey)
          )
        );
        setCollapsedFolderIds(
          pruneCollapsedFolderIds(
            cached,
            readCollapsedFolderIdsFromStorage(remoteCollapsedKey)
          )
        );
        setRemoteLoaded(true);
        setRemoteSaveAllowed(true);
        usedRemoteCache = true;
      }
    }

    if (!usedRemoteCache) {
      setRemoteSaveAllowed(false);
      setRemoteLoaded(false);
    }

    let cancelled = false;
    setRemoteBootSyncing(true);
    (async () => {
      try {
        const health = await fetchApiHealth();
        if (cancelled) return;
        const mu = health?.mediaUpload;
        if (mu === "cos" || mu === "local") {
          setMediaUploadMode(mu);
        } else {
          setMediaUploadMode(null);
        }
        const online = Boolean(health?.ok);
        if (writeRequiresLogin && !currentUser && !getAdminToken()) {
          setCollections([]);
          setLoadError(null);
          setSaveError(null);
          setApiOnline(online);
          setRemoteSaveAllowed(false);
          setRemoteLoaded(true);
          return;
        }
        await flushPendingTextBeforeRemoteFetch?.();
        const data = await fetchCollectionsFromApi();
        if (cancelled) return;
        if (data !== null) {
          let tree = migrateCollectionTree(data);
          const authed = Boolean(currentUser || getAdminToken());
          if (tree.length === 0 && authed && writeRequiresLogin) {
            tree = currentUser?.id
              ? cloneInitialCollectionsForRemoteUser(currentUser.id, appUiLang)
              : cloneInitialCollections(appUiLang);
            const seeded = await saveCollectionsToApi(tree);
            if (cancelled) return;
            if (!seeded) {
              setSidebarFlash(chrome.syncWelcomeSeedFail);
            } else {
              // await 期间用户可能已新建笔记；勿用保存前的 tree 覆盖乐观更新
              const pulled = await fetchCollectionsFromApi();
              if (cancelled) return;
              if (pulled !== null) {
                tree = migrateCollectionTree(pulled);
              }
            }
          }
          if (cancelled) return;
          /* 慢网/久未开：缓存先渲染后 GET 才返回时，若用户已乐观建卡而服务端尚无同 id，整树覆盖会闪没再出现 */
          const merged = mergeServerTreeWithLocalExtraCards(
            tree,
            getCollectionsForMerge()
          );
          setCollections(merged);
          tree = merged;
          const remoteKey = activeCollectionStorageKey(
            "remote",
            currentUser?.id ?? null
          );
          const remoteCollapsedKey = collapsedFoldersStorageKey(
            "remote",
            currentUser?.id ?? null
          );
          setActiveId(
            resolveActiveCollectionId(
              tree,
              readPersistedActiveCollectionId(remoteKey)
            )
          );
          setCollapsedFolderIds(
            pruneCollapsedFolderIds(
              tree,
              readCollapsedFolderIdsFromStorage(remoteCollapsedKey)
            )
          );
          if (snapshotKey) {
            saveRemoteCollectionsSnapshot(snapshotKey, tree);
          }
          setApiOnline(true);
          setLoadError(null);
          setRemoteSaveAllowed(true);
        } else {
          setRemoteSaveAllowed(false);
          if (writeRequiresLogin && (currentUser || getAdminToken())) {
            setLoadError(chrome.syncLoadFail);
            if (!usedRemoteCache) {
              setCollections([]);
              setApiOnline(false);
            } else {
              setApiOnline(false);
            }
          } else {
            setLoadError(chrome.syncOffline);
            if (!usedRemoteCache) {
              setCollections([]);
              setApiOnline(online);
            }
          }
        }
        setRemoteLoaded(true);
      } finally {
        if (!cancelled) setRemoteBootSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    dataMode,
    appUiLang,
    writeRequiresLogin,
    currentUser?.id,
    setCollections,
    setActiveId,
    setCollapsedFolderIds,
    setRemoteLoaded,
    setRemoteBootSyncing,
    setRemoteSaveAllowed,
    setApiOnline,
    setLoadError,
    setSaveError,
    setMediaUploadMode,
    setSidebarFlash,
    getCollectionsForMerge,
    flushPendingTextBeforeRemoteFetch,
  ]);
}
