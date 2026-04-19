import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { authUsesHttpOnlyCookie, getAdminToken } from "../auth/token";
import { fetchCollectionsFromApi } from "../api/collections";
import { apiBase, remoteApiBase } from "../api/apiBase";
import { migrateCollectionTree } from "../migrateCollections";
import {
  remoteSnapshotUserKey,
  saveRemoteCollectionsSnapshot,
} from "../remoteCollectionsCache";
import type { Collection } from "../types";
import type { AppDataMode } from "../appDataModeStorage";
import { mergeServerTreeWithLocalExtraCards } from "./collectionModel";

const DEBOUNCE_MS = 400;

function buildSyncEventsUrl(): string | null {
  const base = apiBase();
  const path = "/api/me/sync/events";
  let qs = "";
  if (!authUsesHttpOnlyCookie()) {
    const admin = getAdminToken();
    const vt = (import.meta.env.VITE_API_TOKEN as string | undefined)?.trim();
    const tok = admin || vt;
    if (tok) qs = `?access_token=${encodeURIComponent(tok)}`;
  }
  if (!base) return `${path}${qs}`;
  return `${base.replace(/\/$/, "")}${path}${qs}`;
}

/**
 * 云端：订阅 SSE `/api/me/sync/events`，服务端在数据变更后推送，客户端防抖拉取合集树。
 */
export function useCollectionsRemotePush(p: {
  authReady: boolean;
  dataMode: AppDataMode;
  remoteLoaded: boolean;
  writeRequiresLogin: boolean;
  currentUserId: string | undefined;
  setCollections: Dispatch<SetStateAction<Collection[]>>;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  setApiOnline: Dispatch<SetStateAction<boolean>>;
  /** 与星标 / 回收站 GET 对齐，避免仅合集树更新、侧栏偏好仍旧 */
  refreshRemotePreferences: () => void | Promise<void>;
  getCollectionsForMerge: () => Collection[];
  /** GET 前落库防抖正文，避免 merge 覆盖未保存编辑（与 resync / boot 一致） */
  flushPendingTextBeforePull?: () => Promise<void>;
}): void {
  const {
    authReady,
    dataMode,
    remoteLoaded,
    writeRequiresLogin,
    currentUserId,
    getCollectionsForMerge,
    setCollections,
    setLoadError,
    setApiOnline,
    refreshRemotePreferences,
    flushPendingTextBeforePull,
  } = p;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(refreshRemotePreferences);
  refreshRef.current = refreshRemotePreferences;

  useEffect(() => {
    const canRemote =
      authReady &&
      dataMode === "remote" &&
      remoteLoaded &&
      (!writeRequiresLogin ||
        Boolean(currentUserId?.trim() || getAdminToken()));
    if (!canRemote) return;

    const url = buildSyncEventsUrl();
    if (!url) return;

    const useCreds =
      authUsesHttpOnlyCookie() && Boolean(remoteApiBase().replace(/\/$/, ""));
    const es = new EventSource(
      url,
      useCreds ? { withCredentials: true } : undefined
    );

    const runPull = async () => {
      await flushPendingTextBeforePull?.();
      const data = await fetchCollectionsFromApi();
      if (data === null) {
        setLoadError((prev) => prev ?? "同步更新失败，请刷新页面");
        setApiOnline(false);
        return;
      }
      setLoadError(null);
      setApiOnline(true);
      const tree = migrateCollectionTree(data);
      const merged = mergeServerTreeWithLocalExtraCards(
        tree,
        getCollectionsForMerge()
      );
      setCollections(merged);
      const sk = remoteSnapshotUserKey(
        writeRequiresLogin,
        currentUserId?.trim() || null
      );
      if (sk) saveRemoteCollectionsSnapshot(sk, merged);
      try {
        await refreshRef.current();
      } catch {
        /* ignore */
      }
    };

    const schedulePull = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runPull();
      }, DEBOUNCE_MS);
    };

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type?: string };
        if (msg.type === "collections_changed") schedulePull();
      } catch {
        /* ignore */
      }
    };

    return () => {
      es.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    authReady,
    dataMode,
    remoteLoaded,
    writeRequiresLogin,
    currentUserId,
    setCollections,
    setLoadError,
    setApiOnline,
    getCollectionsForMerge,
    flushPendingTextBeforePull,
    refreshRemotePreferences,
  ]);
}
