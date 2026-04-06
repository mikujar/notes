import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { CardGallery } from "./CardGallery";
import { CardTagsRow } from "./CardTagsRow";
import {
  formatCardReminderBesideTime,
  formatCardTimeLabel,
} from "./cardTimeLabel";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
} from "./filesFromDataTransfer";
import { NoteCardTiptap } from "./noteEditor/NoteCardTiptap";
import type { NoteCard, NoteMediaItem } from "./types";

const detailMenuId = (cardId: string) => `__detail__${cardId}`;

export interface CardDetailProps {
  card: NoteCard;
  colId: string;
  onClose: () => void;
  canEdit: boolean;
  canAttachMedia: boolean;
  relatedPanelOpen: boolean;
  uploadBusy: boolean;
  cardMenuId: string | null;
  setCardMenuId: (id: string | null) => void;
  onToggleRelatedPanel: () => void;
  onBeginMediaUpload: () => void;
  onClearMedia: () => void;
  onTogglePin: () => void;
  /** 打开提醒日期选择（与列表卡片「⋯」一致） */
  onOpenReminderPicker?: () => void;
  onDelete: () => void;
  onChangeText: (html: string) => void;
  onTagsCommit: (colId: string, cardId: string, tags: string[]) => void;
  onPasteFiles?: (files: File[]) => void;
  onRemoveGalleryItem?: (item: NoteMediaItem) => void;
}

/** 详情覆层：与主时间线相同的 card / card__paper / 轮播结构；音视频在侧栏内直接播放 */
export function CardDetail({
  card,
  colId,
  onClose,
  canEdit,
  canAttachMedia,
  relatedPanelOpen,
  uploadBusy,
  cardMenuId,
  setCardMenuId,
  onToggleRelatedPanel,
  onBeginMediaUpload,
  onClearMedia,
  onTogglePin,
  onOpenReminderPicker,
  onDelete,
  onChangeText,
  onTagsCommit,
  onPasteFiles,
  onRemoveGalleryItem,
}: CardDetailProps) {
  const menuId = useMemo(() => detailMenuId(card.id), [card.id]);
  const menuOpen = cardMenuId === menuId;
  const reminderBesideTime = formatCardReminderBesideTime(card);
  const [fileDragOver, setFileDragOver] = useState(false);

  const attachEnabled =
    Boolean(canEdit && canAttachMedia && onPasteFiles);

  const onDetailDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!attachEnabled) return;
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    [attachEnabled]
  );

  const onDetailDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!attachEnabled) return;
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setFileDragOver(true);
    },
    [attachEnabled]
  );

  const onDetailDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!attachEnabled) return;
      const rel = e.relatedTarget as Node | null;
      if (rel && e.currentTarget.contains(rel)) return;
      setFileDragOver(false);
    },
    [attachEnabled]
  );

  const onDetailDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!attachEnabled || !onPasteFiles) return;
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setFileDragOver(false);
      const files = filesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) return;
      onPasteFiles(files);
    },
    [attachEnabled, onPasteFiles]
  );

  const onDetailPasteCapture = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      if (!attachEnabled || !onPasteFiles) return;
      const files = filesFromDataTransfer(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      onPasteFiles(files);
    },
    [attachEnabled, onPasteFiles]
  );

  useEffect(() => {
    setFileDragOver(false);
  }, [card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const hasGallery = media.length > 0;

  const panel = (
    <div className="card-detail-overlay" onMouseDown={onClose}>
      <div
        className="card-detail-wrap card-detail-wrap--square"
        onMouseDown={(e) => e.stopPropagation()}
        onDragOver={onDetailDragOver}
        onDragEnter={onDetailDragEnter}
        onDragLeave={onDetailDragLeave}
        onDrop={onDetailDrop}
        onPasteCapture={onDetailPasteCapture}
      >
        <div
          className={
            "card card--detail-modal" +
            (hasGallery ? " card--detail-modal--has-gallery" : "") +
            (menuOpen ? " is-menu-open" : "") +
            (fileDragOver && attachEnabled ? " card--file-drag-over" : "")
          }
        >
          <div
            className={
              "card__inner" + (hasGallery ? " card__inner--split" : "")
            }
          >
            <div
              className={
                "card__paper" +
                (hasGallery ? " card__paper--with-gallery" : "")
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
                  <div
                    className="card__menu-root"
                    data-card-menu-root={menuId}
                  >
                    <button
                      type="button"
                      className="card__more"
                      aria-label="更多操作"
                      aria-expanded={menuOpen}
                      onClick={() =>
                        setCardMenuId(
                          cardMenuId === menuId ? null : menuId
                        )
                      }
                    >
                      …
                    </button>
                    {menuOpen ? (
                      <div
                        className="card__menu"
                        role="menu"
                        aria-orientation="vertical"
                      >
                        <button
                          type="button"
                          className={
                            "card__menu-item" +
                            (relatedPanelOpen ? " is-active" : "")
                          }
                          role="menuitem"
                          onClick={() => {
                            onToggleRelatedPanel();
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
                            disabled={uploadBusy}
                            onClick={() => onBeginMediaUpload()}
                          >
                            {uploadBusy ? "上传中…" : "添加附件"}
                          </button>
                        ) : null}
                        {canEdit && hasGallery ? (
                          <button
                            type="button"
                            className="card__menu-item"
                            role="menuitem"
                            onClick={() => onClearMedia()}
                          >
                            清空附件
                          </button>
                        ) : null}
                        {canEdit && onOpenReminderPicker ? (
                          <button
                            type="button"
                            className="card__menu-item"
                            role="menuitem"
                            onClick={() => {
                              onOpenReminderPicker();
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
                              onTogglePin();
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
                            onClick={() => onDelete()}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <NoteCardTiptap
                id={`card-detail-${card.id}`}
                value={card.text}
                canEdit={canEdit}
                onChange={onChangeText}
                ariaLabel="笔记正文"
                onPasteFiles={onPasteFiles}
                highlightBubble
              />
              <CardTagsRow
                colId={colId}
                card={card}
                canEdit={canEdit}
                onCommit={onTagsCommit}
              />
            </div>
            {hasGallery ? (
              <CardGallery
                items={media}
                playback="inlineAv"
                onRemoveItem={onRemoveGalleryItem}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
