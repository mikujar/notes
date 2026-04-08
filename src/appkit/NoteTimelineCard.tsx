import type {
  Dispatch,
  DragEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { AppDataMode } from "../appDataModeStorage";
import { CardGallery } from "../CardGallery";
import { CardRowInner } from "../CardRowInner";
import { CardTagsRow } from "../CardTagsRow";
import { NoteCardTiptap } from "../noteEditor/NoteCardTiptap";
import {
  formatCardReminderBesideTime,
  formatCardTimeLabel,
} from "../cardTimeLabel";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
} from "../filesFromDataTransfer";
import type { Collection, NoteCard, NoteMediaItem } from "../types";
import { cardNeedsMasonryCollapse } from "./masonryLayout";
import {
  NOTE_CARD_DRAG_MIME,
  NOTE_CARD_TEXT_PREFIX,
  type NoteCardDragPayload,
  applyNoteCardDrop,
  persistNoteCardDropToRemote,
  readNoteCardDragPayload,
} from "./noteCardDrag";

export type NoteTimelineCardProps = {
  card: NoteCard;
  colId: string;
  masonryLayout: boolean;
  canEdit: boolean;
  canAttachMedia: boolean;
  cardMenuId: string | null;
  setCardMenuId: Dispatch<SetStateAction<string | null>>;
  relatedPanel: { colId: string; cardId: string } | null;
  setRelatedPanel: Dispatch<
    SetStateAction<{ colId: string; cardId: string } | null>
  >;
  uploadBusyCardId: string | null;
  cardDragOverId: string | null;
  setCardDragOverId: Dispatch<SetStateAction<string | null>>;
  draggingNoteCardKey: string | null;
  cardDropMarker: {
    colId: string;
    cardId: string;
    before: boolean;
  } | null;
  noteCardDragActiveRef: MutableRefObject<boolean>;
  setCardDropMarker: Dispatch<
    SetStateAction<{
      colId: string;
      cardId: string;
      before: boolean;
    } | null>
  >;
  setNoteCardDropCollectionId: Dispatch<SetStateAction<string | null>>;
  setDraggingNoteCardKey: Dispatch<SetStateAction<string | null>>;
  setCollections: Dispatch<SetStateAction<Collection[]>>;
  dataMode: AppDataMode;
  setDetailCard: Dispatch<
    SetStateAction<{ card: NoteCard; colId: string } | null>
  >;
  beginCardMediaUpload: (colId: string, cardId: string) => void;
  clearCardMedia: (colId: string, cardId: string) => void;
  uploadFilesToCard: (
    colId: string,
    cardId: string,
    files: File[]
  ) => void | Promise<void>;
  removeCardMediaItem: (
    colId: string,
    cardId: string,
    item: NoteMediaItem
  ) => void;
  setReminderPicker: Dispatch<
    SetStateAction<{ colId: string; cardId: string } | null>
  >;
  togglePin: (colId: string, cardId: string) => void;
  deleteCard: (colId: string, cardId: string) => void;
  setCardText: (colId: string, cardId: string, text: string) => void;
  setCardTags: (colId: string, cardId: string, tags: string[]) => void;
};

export function NoteTimelineCard(p: NoteTimelineCardProps) {
  const {
    card,
    colId,
    masonryLayout,
    canEdit,
    canAttachMedia,
    cardMenuId,
    setCardMenuId,
    relatedPanel,
    setRelatedPanel,
    uploadBusyCardId,
    cardDragOverId,
    setCardDragOverId,
    draggingNoteCardKey,
    cardDropMarker,
    noteCardDragActiveRef,
    setCardDropMarker,
    setNoteCardDropCollectionId,
    setDraggingNoteCardKey,
    setCollections,
    dataMode,
    setDetailCard,
    beginCardMediaUpload,
    clearCardMedia,
    uploadFilesToCard,
    removeCardMediaItem,
    setReminderPicker,
    togglePin,
    deleteCard,
    setCardText,
    setCardTags,
  } = p;

  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const hasGallery = media.length > 0;
  const reminderBesideTime = formatCardReminderBesideTime(card);
  const hugeForMasonry =
    masonryLayout && cardNeedsMasonryCollapse(card);
  const noteKey = `${colId}-${card.id}`;
  const dropEdgeActive =
    cardDropMarker !== null &&
    cardDropMarker.colId === colId &&
    cardDropMarker.cardId === card.id;

  return (
    <li
      className={
        "card" +
        (cardMenuId === card.id ? " is-menu-open" : "") +
        (cardDragOverId === card.id && canEdit && canAttachMedia
          ? " card--file-drag-over"
          : "") +
        (dropEdgeActive
          ? cardDropMarker.before
            ? " card--note-drop-before"
            : " card--note-drop-after"
          : "") +
        (draggingNoteCardKey === noteKey ? " card--note-dragging" : "") +
        (hugeForMasonry ? " card--masonry-collapsed" : "")
      }
      onDragOver={(e) => {
        if (!canEdit) return;
        if (noteCardDragActiveRef.current) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          const before =
            e.clientY < rect.top + rect.height * 0.5;
          setCardDropMarker({
            colId,
            cardId: card.id,
            before,
          });
          return;
        }
        if (!canAttachMedia) return;
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragEnter={(e) => {
        if (!canEdit) return;
        if (noteCardDragActiveRef.current) {
          e.preventDefault();
          return;
        }
        if (!canAttachMedia) return;
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setCardDragOverId(card.id);
      }}
      onDragLeave={(e) => {
        if (!canEdit) return;
        const rel = e.relatedTarget as Node | null;
        if (rel && e.currentTarget.contains(rel)) return;
        if (noteCardDragActiveRef.current) {
          setCardDropMarker((m) =>
            m && m.cardId === card.id && m.colId === colId
              ? null
              : m
          );
          return;
        }
        if (!canAttachMedia) return;
        setCardDragOverId((id) => (id === card.id ? null : id));
      }}
      onDrop={(e) => {
        if (!canEdit) return;
        const from = readNoteCardDragPayload(e);
        if (from) {
          e.preventDefault();
          e.stopPropagation();
          setCardDropMarker(null);
          setNoteCardDropCollectionId(null);
          const rect = e.currentTarget.getBoundingClientRect();
          const before =
            e.clientY < rect.top + rect.height * 0.5;
          const target = before
            ? ({
                type: "before" as const,
                colId,
                cardId: card.id,
              } as const)
            : ({
                type: "after" as const,
                colId,
                cardId: card.id,
              } as const);
          setCollections((prev) => {
            const next = applyNoteCardDrop(prev, from, target);
            if (dataMode === "remote" && canEdit) {
              void persistNoteCardDropToRemote(from, next).then((ok) => {
                if (!ok) {
                  window.alert(
                    "笔记移动同步失败，请刷新后重试。"
                  );
                }
              });
            }
            return next;
          });
          setDraggingNoteCardKey(null);
          return;
        }
        if (!canAttachMedia) return;
        e.preventDefault();
        setCardDragOverId(null);
        const files = filesFromDataTransfer(e.dataTransfer);
        if (files.length === 0) return;
        void uploadFilesToCard(colId, card.id, files);
      }}
    >
      <CardRowInner
        hasGallery={hasGallery}
        textRev={card.text}
        masonryLayout={masonryLayout}
        className={
          "card__inner" + (hasGallery ? " card__inner--split" : "")
        }
      >
        <div
          className={
            "card__move-rail" +
            (canEdit ? "" : " card__move-rail--readonly")
          }
          draggable={canEdit}
          aria-label={
            canEdit
              ? "拖动以移动小笔记"
              : "侧栏条（登录后可拖动排列）"
          }
          title={
            canEdit
              ? "按住拖到其他卡片旁或侧栏合集"
              : "登录后可拖动小笔记排序"
          }
          onDragStart={
            canEdit
              ? (e: DragEvent<HTMLDivElement>) => {
                  e.stopPropagation();
                  const cardEl = e.currentTarget.closest(
                    "li.card"
                  ) as HTMLElement | null;
                  if (cardEl) {
                    const cr = cardEl.getBoundingClientRect();
                    const ox = Math.round(e.clientX - cr.left);
                    const oy = Math.round(e.clientY - cr.top);
                    e.dataTransfer.setDragImage(cardEl, ox, oy);
                  }
                  const payload: NoteCardDragPayload = {
                    colId,
                    cardId: card.id,
                  };
                  const json = JSON.stringify(payload);
                  e.dataTransfer.setData(NOTE_CARD_DRAG_MIME, json);
                  e.dataTransfer.setData(
                    "text/plain",
                    NOTE_CARD_TEXT_PREFIX + json
                  );
                  e.dataTransfer.effectAllowed = "move";
                  noteCardDragActiveRef.current = true;
                  setDraggingNoteCardKey(noteKey);
                }
              : undefined
          }
          onDragEnd={
            canEdit
              ? () => {
                  noteCardDragActiveRef.current = false;
                  setDraggingNoteCardKey(null);
                  setCardDropMarker(null);
                  setNoteCardDropCollectionId(null);
                }
              : undefined
          }
        />
        <div
          className={
            "card__paper" +
            (hasGallery ? " card__paper--with-gallery" : "") +
            " card__paper--with-move-rail"
          }
        >
          <div className="card__toolbar">
            <span className="card__time">
              {formatCardTimeLabel(card)}
              {reminderBesideTime ? (
                <span className="card__time-reminder">
                  {reminderBesideTime}
                </span>
              ) : null}
            </span>
            <div className="card__toolbar-actions">
              <button
                type="button"
                className="card__icon-btn card__detail-btn"
                title={
                  hugeForMasonry
                    ? "查看完整笔记"
                    : "查看详情"
                }
                aria-label={
                  hugeForMasonry
                    ? "查看完整笔记"
                    : "查看详情"
                }
                onClick={() =>
                  setDetailCard({
                    card,
                    colId,
                  })
                }
              >
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M1 1h5v1.5H2.5V5H1V1zm9 0h5v4h-1.5V2.5H10V1zM1 10h1.5v2.5H5V14H1v-4zM15 10h-1.5v2.5H11V14H15v-4z" />
                </svg>
              </button>
              <div
                className="card__menu-root"
                data-card-menu-root={card.id}
              >
                <button
                  type="button"
                  className="card__more"
                  aria-label="更多操作"
                  aria-expanded={cardMenuId === card.id}
                  onClick={() =>
                    setCardMenuId((id) =>
                      id === card.id ? null : card.id
                    )
                  }
                >
                  …
                </button>
                {cardMenuId === card.id && (
                  <div
                    className="card__menu"
                    role="menu"
                    aria-orientation="vertical"
                  >
                    <button
                      type="button"
                      className={
                        "card__menu-item" +
                        (relatedPanel?.colId === colId &&
                        relatedPanel?.cardId === card.id
                          ? " is-active"
                          : "")
                      }
                      role="menuitem"
                      onClick={() => {
                        setRelatedPanel((rp) =>
                          rp?.colId === colId && rp?.cardId === card.id
                            ? null
                            : { colId, cardId: card.id }
                        );
                        setCardMenuId(null);
                      }}
                    >
                      相关笔记
                    </button>
                    {canEdit && canAttachMedia ? (
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        disabled={uploadBusyCardId === card.id}
                        onClick={() =>
                          beginCardMediaUpload(colId, card.id)
                        }
                      >
                        {uploadBusyCardId === card.id
                          ? "上传中…"
                          : "添加附件"}
                      </button>
                    ) : null}
                    {canEdit && hasGallery ? (
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() =>
                          clearCardMedia(colId, card.id)
                        }
                      >
                        清空附件
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          setReminderPicker({
                            colId,
                            cardId: card.id,
                          });
                          setCardMenuId(null);
                        }}
                      >
                        提醒…
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          togglePin(colId, card.id);
                          setCardMenuId(null);
                        }}
                      >
                        {card.pinned ? "取消置顶" : "置顶"}
                      </button>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="card__menu-item card__menu-item--danger"
                        role="menuitem"
                        onClick={() =>
                          deleteCard(colId, card.id)
                        }
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
          <NoteCardTiptap
            id={`card-text-${card.id}`}
            value={card.text}
            canEdit={canEdit}
            ariaLabel="笔记正文"
            onChange={(next) => setCardText(colId, card.id, next)}
            onPasteFiles={
              canEdit && canAttachMedia
                ? (files) => {
                    void uploadFilesToCard(colId, card.id, files);
                  }
                : undefined
            }
          />
          <CardTagsRow
            colId={colId}
            card={card}
            canEdit={canEdit}
            onCommit={setCardTags}
          />
        </div>
        {hasGallery ? (
          <CardGallery
            items={media}
            onRemoveItem={
              canEdit
                ? (item) =>
                    removeCardMediaItem(colId, card.id, item)
                : undefined
            }
          />
        ) : null}
      </CardRowInner>
    </li>
  );
}
