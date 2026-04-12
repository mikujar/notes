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
import { useAppUiLang } from "./appUiLang";
import { useAppChrome } from "./i18n/useAppChrome";
import { NoteCardTiptap } from "./noteEditor/NoteCardTiptap";
import type { NoteCard, NoteMediaItem } from "./types";

const detailMenuId = (cardId: string) => `__detail__${cardId}`;

const CARD_DETAIL_LAYOUT_KEY = "mikujar-card-detail-layout";

/** 与时间线 CardRowInner 一致：手机端固定上下布局 */
const CARD_DETAIL_MOBILE_MQ = "(max-width: 900px)";

/** 左右分栏：方框 + 正中竖线 */
function IconDetailLayoutSplit() {
  return (
    <svg
      className="card__detail-layout-toggle-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={true}
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <line
        x1="8"
        y1="3.75"
        x2="8"
        y2="12.25"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 上下分栏：方框 + 正中横线 */
function IconDetailLayoutStack() {
  return (
    <svg
      className="card__detail-layout-toggle-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={true}
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <line
        x1="3.75"
        y1="8"
        x2="12.25"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function readInitialDetailLayoutStack(): boolean {
  try {
    return localStorage.getItem(CARD_DETAIL_LAYOUT_KEY) === "stack";
  } catch {
    return false;
  }
}

export interface CardDetailProps {
  card: NoteCard;
  colId: string;
  onClose: () => void;
  canEdit: boolean;
  canAttachMedia: boolean;
  relatedPanelOpen: boolean;
  uploadBusy: boolean;
  /** 云端附件上传进度 0–100；非上传中为 null */
  uploadProgress?: number | null;
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
  /** 将附件设为轮播首项（封面） */
  onSetGalleryCoverItem?: (item: NoteMediaItem) => void;
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
  uploadProgress = null,
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
  onSetGalleryCoverItem,
}: CardDetailProps) {
  const { lang } = useAppUiLang();
  const c = useAppChrome();
  const menuId = useMemo(() => detailMenuId(card.id), [card.id]);
  const menuOpen = cardMenuId === menuId;
  const reminderBesideTime = formatCardReminderBesideTime(card, lang);
  const [fileDragOver, setFileDragOver] = useState(false);
  /** true = 上下分栏（附件在上、正文在下）；false = 左右分栏（仅宽屏可切换） */
  const [layoutStack, setLayoutStack] = useState(readInitialDetailLayoutStack);
  const [detailNarrow, setDetailNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(CARD_DETAIL_MOBILE_MQ).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(CARD_DETAIL_MOBILE_MQ);
    const onChange = () => setDetailNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /** 小屏强制上下，避免左右分栏 */
  const layoutStackEffective = detailNarrow || layoutStack;

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

  const toggleDetailLayout = useCallback(() => {
    setLayoutStack((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(
          CARD_DETAIL_LAYOUT_KEY,
          next ? "stack" : "split"
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
  const hasGallery = media.length > 0 || uploadBusy;

  const panel = (
    <div className="card-detail-overlay" onMouseDown={onClose}>
      <div
        className={
          "card-detail-wrap card-detail-wrap--square" +
          (hasGallery && layoutStackEffective
            ? " card-detail-wrap--layout-stack"
            : "")
        }
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
            (hasGallery && layoutStackEffective
              ? " card--detail-modal--layout-stack"
              : "") +
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
                  {formatCardTimeLabel(card, lang)}
                  {reminderBesideTime ? (
                    <span className="card__time-reminder">
                      {reminderBesideTime}
                    </span>
                  ) : null}
                </span>
                <div className="card__toolbar-actions">
                  {hasGallery && !detailNarrow ? (
                    <button
                      type="button"
                      className="card__detail-layout-toggle"
                      aria-pressed={layoutStack}
                      aria-label={
                        layoutStack
                          ? c.uiLayoutSplitTitle
                          : c.uiLayoutStackTitle
                      }
                      title={
                        layoutStack
                          ? c.uiLayoutSplitTitle
                          : c.uiLayoutStackTitle
                      }
                      onClick={toggleDetailLayout}
                    >
                      {layoutStack ? (
                        <IconDetailLayoutSplit />
                      ) : (
                        <IconDetailLayoutStack />
                      )}
                    </button>
                  ) : null}
                  <div
                    className="card__menu-root"
                    data-card-menu-root={menuId}
                  >
                    <button
                      type="button"
                      className="card__more"
                      aria-label={c.uiMoreActions}
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
                          {c.uiRelatedNotes}
                        </button>
                        {canEdit && canAttachMedia ? (
                          <button
                            type="button"
                            className="card__menu-item"
                            role="menuitem"
                            disabled={uploadBusy}
                            onClick={() => onBeginMediaUpload()}
                          >
                            {uploadBusy ? c.uiUploading : c.uiAddAttachment}
                          </button>
                        ) : null}
                        {canEdit && hasGallery ? (
                          <button
                            type="button"
                            className="card__menu-item"
                            role="menuitem"
                            onClick={() => onClearMedia()}
                          >
                            {c.uiClearAttachments}
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
                            {c.uiReminderEllipsis}
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
                            {card.pinned ? c.uiUnpin : c.uiPin}
                          </button>
                        ) : null}
                        {canEdit ? (
                          <button
                            type="button"
                            className="card__menu-item card__menu-item--danger"
                            role="menuitem"
                            onClick={() => onDelete()}
                          >
                            {c.uiDelete}
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
                onSetCoverItem={onSetGalleryCoverItem}
                uploadPending={uploadBusy}
                uploadProgress={uploadBusy ? uploadProgress : null}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
