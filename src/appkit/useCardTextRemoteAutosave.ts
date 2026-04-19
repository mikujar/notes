import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { updateCardApi } from "../api/collections";
import type { AppDataMode } from "../appDataModeStorage";
import type { Collection } from "../types";
import { patchNoteCardByIdInTree } from "./collectionModel";

const TEXT_SAVE_DEBOUNCE_MS = 400;

/**
 * 远程模式下卡片正文防抖 PATCH；切页/隐藏时 flush。
 */
export function useCardTextRemoteAutosave(
  dataMode: AppDataMode,
  setCollections: Dispatch<SetStateAction<Collection[]>>
) {
  const textSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const pendingCardTextById = useRef<Map<string, string>>(new Map());

  const flushPendingCardTextToRemote = useCallback(async () => {
    if (dataMode === "local") return;
    const timers = textSaveTimers.current;
    for (const h of timers.values()) clearTimeout(h);
    timers.clear();
    const pending = pendingCardTextById.current;
    const entries = [...pending.entries()];
    pending.clear();
    if (entries.length === 0) return;
    await Promise.all(
      entries.map(([cid, t]) => updateCardApi(cid, { text: t }))
    );
  }, [dataMode]);

  useEffect(() => {
    if (dataMode === "local") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        void flushPendingCardTextToRemote();
      }
    };
    const onPageHide = () => {
      void flushPendingCardTextToRemote();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [dataMode, flushPendingCardTextToRemote]);

  const setCardText = useCallback(
    (_colId: string, cardId: string, text: string) => {
      setCollections((prev) =>
        patchNoteCardByIdInTree(prev, cardId, (card) => ({ ...card, text }))
      );
      if (dataMode !== "local") {
        pendingCardTextById.current.set(cardId, text);
        const existing = textSaveTimers.current.get(cardId);
        if (existing) clearTimeout(existing);
        textSaveTimers.current.set(
          cardId,
          setTimeout(() => {
            const latest = pendingCardTextById.current.get(cardId);
            if (latest !== undefined) {
              void updateCardApi(cardId, { text: latest });
              pendingCardTextById.current.delete(cardId);
            }
            textSaveTimers.current.delete(cardId);
          }, TEXT_SAVE_DEBOUNCE_MS)
        );
      }
    },
    [dataMode, setCollections]
  );

  return { setCardText, flushPendingCardTextToRemote };
}
