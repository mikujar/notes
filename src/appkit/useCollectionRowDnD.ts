import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { DragEvent } from "react";
import type { AppDataMode } from "../appDataModeStorage";
import type { Collection } from "../types";
import { findCollectionById } from "./collectionModel";
import {
  COLLECTION_DRAG_MIME,
  dropPositionFromEvent,
  moveCollectionInTree,
  persistCollectionTreeLayoutRemoteWithRetry,
  type CollectionDropPosition,
} from "./collectionDrag";
import {
  applyNoteCardDrop,
  noteCardDragTypesInclude,
  persistNoteCardDropToRemote,
  readNoteCardDragPayload,
} from "./noteCardDrag";

type DropIndicatorState = {
  targetId: string;
  position: CollectionDropPosition;
} | null;

/**
 * 侧栏合集行：合集树拖拽排序 + 接收小笔记拖入。
 */
export function useCollectionRowDnD(p: {
  canEdit: boolean;
  dataMode: AppDataMode;
  /** 云端布局保存失败后拉回服务端合集树，避免侧栏与服务器长期不一致 */
  resyncCollectionsFromRemote?: () => Promise<unknown>;
  collectionLayoutSaveFailedMessage: string;
  noteMoveSaveFailedMessage: string;
  /** 与笔记设置「新笔记在时间线顶部」一致：拖到侧栏合集时插到该合集最前 */
  dropOnCollectionToTop: boolean;
  noteCardDragActiveRef: MutableRefObject<boolean>;
  draggingCollectionIdRef: MutableRefObject<string | null>;
  /** 拖拽放下时读取当前合集树（避免在 setState updater 里做异步保存） */
  getLatestCollections: () => Collection[];
  /** 远程写入整树布局时的进度条（与右键「移动至」一致；total 由 persist 内首次回调给出） */
  onCollectionLayoutRemoteSync?: {
    progress: (current: number, total: number) => void;
    end: () => void;
  };
  setCollections: Dispatch<SetStateAction<Collection[]>>;
  setCollapsedFolderIds: Dispatch<SetStateAction<Set<string>>>;
  setDraggingCollectionId: Dispatch<SetStateAction<string | null>>;
  setDropIndicator: Dispatch<SetStateAction<DropIndicatorState>>;
  setNoteCardDropCollectionId: Dispatch<SetStateAction<string | null>>;
  setCardDropMarker: Dispatch<
    SetStateAction<{
      colId: string;
      cardId: string;
      before: boolean;
    } | null>
  >;
  setDraggingNoteCardKey: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    canEdit,
    dataMode,
    resyncCollectionsFromRemote,
    collectionLayoutSaveFailedMessage,
    noteMoveSaveFailedMessage,
    dropOnCollectionToTop,
    noteCardDragActiveRef,
    draggingCollectionIdRef,
    getLatestCollections,
    onCollectionLayoutRemoteSync,
    setCollections,
    setCollapsedFolderIds,
    setDraggingCollectionId,
    setDropIndicator,
    setNoteCardDropCollectionId,
    setCardDropMarker,
    setDraggingNoteCardKey,
  } = p;

  const onCollectionRowDragStart = useCallback(
    (id: string, e: DragEvent) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("button, input, textarea")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(COLLECTION_DRAG_MIME, id);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
      draggingCollectionIdRef.current = id;
      setDraggingCollectionId(id);
    },
    [canEdit, draggingCollectionIdRef, setDraggingCollectionId]
  );

  const onCollectionRowDragEnd = useCallback(() => {
    draggingCollectionIdRef.current = null;
    setDraggingCollectionId(null);
    setDropIndicator(null);
    setNoteCardDropCollectionId(null);
  }, [
    draggingCollectionIdRef,
    setDraggingCollectionId,
    setDropIndicator,
    setNoteCardDropCollectionId,
  ]);

  const onCollectionRowDragOver = useCallback(
    (id: string, e: DragEvent) => {
      if (!canEdit) return;
      if (
        noteCardDragActiveRef.current ||
        noteCardDragTypesInclude(e.dataTransfer)
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setNoteCardDropCollectionId(id);
        return;
      }
      if (draggingCollectionIdRef.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const el = e.currentTarget as HTMLElement;
      setDropIndicator({
        targetId: id,
        position: dropPositionFromEvent(e, el),
      });
    },
    [
      canEdit,
      noteCardDragActiveRef,
      draggingCollectionIdRef,
      setNoteCardDropCollectionId,
      setDropIndicator,
    ]
  );

  const onCollectionRowDrop = useCallback(
    (targetId: string, e: DragEvent) => {
      if (!canEdit) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const noteFrom = readNoteCardDragPayload(e);
      if (noteFrom) {
        if (noteFrom.colId !== targetId) {
          setCollections((prev) => {
            const hadPlacementInTarget = Boolean(
              findCollectionById(prev, targetId)?.cards.some(
                (c) => c.id === noteFrom.cardId
              )
            );
            const next = applyNoteCardDrop(
              prev,
              noteFrom,
              {
                type: "collection",
                colId: targetId,
              },
              { dropOnCollectionToTop }
            );
            if (dataMode === "remote" && canEdit) {
              void persistNoteCardDropToRemote(noteFrom, next, {
                removeSourcePlacementOnly: hadPlacementInTarget,
              }).then(async (ok) => {
                if (!ok) {
                  await resyncCollectionsFromRemote?.();
                  window.alert(noteMoveSaveFailedMessage);
                }
              });
            }
            return next;
          });
        }
        setNoteCardDropCollectionId(null);
        setCardDropMarker(null);
        setDraggingNoteCardKey(null);
        return;
      }
      const dragId = (
        e.dataTransfer.getData(COLLECTION_DRAG_MIME) ||
        e.dataTransfer.getData("text/plain")
      ).trim();
      if (!dragId) return;
      const el = e.currentTarget as HTMLElement;
      const position = dropPositionFromEvent(e, el);
      const prev = getLatestCollections();
      const next = moveCollectionInTree(prev, dragId, targetId, position);
      if (next !== prev) {
        setCollections(next);
        if (dataMode === "remote" && canEdit) {
          void (async () => {
            try {
              const ok = await persistCollectionTreeLayoutRemoteWithRetry(
                next,
                onCollectionLayoutRemoteSync
                  ? (current, total) =>
                      onCollectionLayoutRemoteSync.progress(current, total)
                  : undefined,
                prev
              );
              if (!ok) {
                await resyncCollectionsFromRemote?.();
                window.alert(collectionLayoutSaveFailedMessage);
              }
            } finally {
              onCollectionLayoutRemoteSync?.end();
            }
          })();
        }
      }
      if (position === "inside") {
        setCollapsedFolderIds((prevCollapsed) => {
          const collapsedNext = new Set(prevCollapsed);
          collapsedNext.delete(targetId);
          return collapsedNext;
        });
      }
      draggingCollectionIdRef.current = null;
      setDraggingCollectionId(null);
      setDropIndicator(null);
    },
    [
      canEdit,
      dataMode,
      resyncCollectionsFromRemote,
      collectionLayoutSaveFailedMessage,
      noteMoveSaveFailedMessage,
      dropOnCollectionToTop,
      getLatestCollections,
      onCollectionLayoutRemoteSync,
      setCollections,
      setCollapsedFolderIds,
      setNoteCardDropCollectionId,
      setCardDropMarker,
      setDraggingNoteCardKey,
      draggingCollectionIdRef,
      setDraggingCollectionId,
      setDropIndicator,
    ]
  );

  return {
    onCollectionRowDragStart,
    onCollectionRowDragEnd,
    onCollectionRowDragOver,
    onCollectionRowDrop,
  };
}
