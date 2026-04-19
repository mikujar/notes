import {
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import type { AppDataMode } from "../appDataModeStorage";
import { useAppChrome } from "../i18n/useAppChrome";
import { useAppUiLang } from "../appUiLang";
import { CardGallery } from "../CardGallery";
import { CardRowInner } from "../CardRowInner";
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
import {
  NOTE_CARD_DRAG_MIME,
  NOTE_CARD_TEXT_PREFIX,
  type NoteCardDragPayload,
  applyNoteCardDrop,
  persistNoteCardDropToRemote,
  readNoteCardDragPayload,
} from "./noteCardDrag";
import {
  MOBILE_CHROME_MEDIA,
  matchesMobileChromeMedia,
} from "./appConstants";

function subscribeMobileChromeMedia(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_CHROME_MEDIA);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** 窄屏手机合集时间线：正文只读，须进全页编辑（与 App 侧栏断点一致） */
const PHONE_NARROW_MEDIA = "(max-width: 900px)";

function subscribePhoneNarrowMedia(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(PHONE_NARROW_MEDIA);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export type NoteTimelineCardProps = {
  card: NoteCard;
  colId: string;
  canEdit: boolean;
  canAttachMedia: boolean;
  cardMenuId: string | null;
  setCardMenuId: Dispatch<SetStateAction<string | null>>;
  uploadBusyCardId: string | null;
  /** 当前 busy 卡片的上传进度 0–100，无上传或非本卡为 null */
  uploadCardProgress: number | null;
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
  ) => Promise<NoteMediaItem[]>;
  removeCardMediaItem: (
    colId: string,
    cardId: string,
    item: NoteMediaItem
  ) => void;
  setCardMediaCoverItem: (
    colId: string,
    cardId: string,
    item: NoteMediaItem
  ) => void;
  togglePin: (colId: string, cardId: string) => void;
  /** 仅从当前合集移除一条归属（与详情页 ⋯ 一致） */
  removeCardFromCollection: (colId: string, cardId: string) => void;
  /** 未归类且仅此一处时不显示「从合集移除」 */
  showRemoveFromCollectionMenu: boolean;
  deleteCard: (colId: string, cardId: string) => void;
  setCardText: (colId: string, cardId: string, text: string) => void;
  /** 双击左侧条 / 折叠只读时打开全页或详情 */
  openCardPage: (colId: string, cardId: string) => void;
  /** 时间线列数（用于大屏触控平板 1 列时附件与正文左右分栏） */
  timelineColumnCount: number;
  /** 笔记设置「折叠」：限制正文显示行数（仅时间线列表，如 3） */
  foldBodyMaxLines?: number;
  /** MasonryShortestColumns 注入，须落到根 li 供量高 */
  "data-masonry-slot"?: number;
};

export function NoteTimelineCard(p: NoteTimelineCardProps) {
  const {
    card,
    colId,
    canEdit,
    canAttachMedia,
    cardMenuId,
    setCardMenuId,
    uploadBusyCardId,
    uploadCardProgress,
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
    setCardMediaCoverItem,
    togglePin,
    removeCardFromCollection,
    showRemoveFromCollectionMenu,
    deleteCard,
    setCardText,
    openCardPage,
    timelineColumnCount,
    foldBodyMaxLines,
    "data-masonry-slot": dataMasonrySlot,
  } = p;

  const { lang } = useAppUiLang();
  const c = useAppChrome();
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const mediaUploadPending = uploadBusyCardId === card.id;
  const galleryUploadProgress = mediaUploadPending ? uploadCardProgress : null;
  const hasGallery = media.length > 0 || mediaUploadPending;
  const reminderBesideTime = formatCardReminderBesideTime(card, lang);
  const noteKey = `${colId}-${card.id}`;
  /** 手机端：双击正文打开全页 */
  const mobileChromeUi = useSyncExternalStore(
    subscribeMobileChromeMedia,
    () => matchesMobileChromeMedia(),
    () => false
  );
  const phoneNarrow = useSyncExternalStore(
    subscribePhoneNarrowMedia,
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(PHONE_NARROW_MEDIA).matches,
    () => false
  );
  /** 笔记设置「折叠」开启时：时间线正文仅预览，须进弹窗或全页编辑 */
  const foldTimelineReadOnly = foldBodyMaxLines === 3;
  /** 仅控制时间线内联改字与编辑器粘贴；折叠模式为 false，窄屏为 false */
  const canEditTextInTimeline =
    canEdit && !phoneNarrow && !foldTimelineReadOnly;
  /** 灰条拖拽、卡片重排：与完整模式一致，折叠时仍可用；仅窄屏手机禁用 */
  const canDragNotesInTimeline = canEdit && !phoneNarrow;
  /** 折叠/只读正文时仍允许：拖入上传、图库右键设封面与删附件 */
  const canDropFilesOnCard = Boolean(canEdit && canAttachMedia);
  /** ⋯：与完整模式一致（由 canEdit 控制）；与内联改字无关 */
  const showCardOverflowMenu = canEdit;
  const dropEdgeActive =
    cardDropMarker !== null &&
    cardDropMarker.colId === colId &&
    cardDropMarker.cardId === card.id;

  const mobileTextDblTapRef = useRef<{
    t: number;
    x: number;
    y: number;
  } | null>(null);
  const onCardTextTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!mobileChromeUi) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const t = e.timeStamp;
      const x = touch.clientX;
      const y = touch.clientY;
      const prev = mobileTextDblTapRef.current;
      mobileTextDblTapRef.current = { t, x, y };
      if (!prev) return;
      if (t - prev.t > 380) return;
      if (Math.hypot(x - prev.x, y - prev.y) > 52) return;
      mobileTextDblTapRef.current = null;
      openCardPage(colId, card.id);
      e.preventDefault();
      e.stopPropagation();
    },
    [mobileChromeUi, colId, card.id, openCardPage]
  );

  const onFoldReadOnlyTextDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!foldTimelineReadOnly) return;
      e.stopPropagation();
      openCardPage(colId, card.id);
    },
    [foldTimelineReadOnly, colId, card.id, openCardPage]
  );

  return (
    <li
      data-masonry-key={noteKey}
      data-masonry-slot={dataMasonrySlot}
      className={
        "card" +
        (cardMenuId === card.id ? " is-menu-open" : "") +
        (foldBodyMaxLines === 3 ? " card--timeline-fold-body" : "") +
        (cardDragOverId === card.id && canDropFilesOnCard
          ? " card--file-drag-over"
          : "") +
        (dropEdgeActive
          ? cardDropMarker.before
            ? " card--note-drop-before"
            : " card--note-drop-after"
          : "") +
        (draggingNoteCardKey === noteKey ? " card--note-dragging" : "")
      }
      onDragOver={(e) => {
        if (noteCardDragActiveRef.current) {
          if (!canDragNotesInTimeline) return;
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
        if (!canDropFilesOnCard) return;
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragEnter={(e) => {
        if (noteCardDragActiveRef.current) {
          if (!canDragNotesInTimeline) return;
          e.preventDefault();
          return;
        }
        if (!canDropFilesOnCard) return;
        if (!dataTransferHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setCardDragOverId(card.id);
      }}
      onDragLeave={(e) => {
        const rel = e.relatedTarget as Node | null;
        if (rel && e.currentTarget.contains(rel)) return;
        if (noteCardDragActiveRef.current) {
          if (!canDragNotesInTimeline) return;
          setCardDropMarker((m) =>
            m && m.cardId === card.id && m.colId === colId
              ? null
              : m
          );
          return;
        }
        if (!canDropFilesOnCard) return;
        setCardDragOverId((id) => (id === card.id ? null : id));
      }}
      onDrop={(e) => {
        const from = readNoteCardDragPayload(e);
        if (from) {
          if (!canDragNotesInTimeline) return;
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
            if (dataMode === "remote" && canDragNotesInTimeline) {
              void persistNoteCardDropToRemote(from, next).then((ok) => {
                if (!ok) {
                  window.alert(c.uiDropIncomplete);
                }
              });
            }
            return next;
          });
          setDraggingNoteCardKey(null);
          return;
        }
        if (!canDropFilesOnCard) return;
        e.preventDefault();
        setCardDragOverId(null);
        const files = filesFromDataTransfer(e.dataTransfer);
        if (files.length === 0) return;
        void uploadFilesToCard(colId, card.id, files);
      }}
    >
      <CardRowInner
        hasGallery={hasGallery}
        timelineColumnCount={timelineColumnCount}
        className={
          "card__inner" + (hasGallery ? " card__inner--split" : "")
        }
      >
        <div
          className={
            "card__move-rail" +
            (canDragNotesInTimeline ? "" : " card__move-rail--readonly")
          }
          draggable={canDragNotesInTimeline}
          aria-label={
            canDragNotesInTimeline ? c.uiDragHandleLoggedIn : c.uiDragHandleGuest
          }
          title={
            canDragNotesInTimeline ? c.uiDragHintLoggedIn : c.uiDragHintGuest
          }
          onDoubleClick={(e) => {
            e.stopPropagation();
            openCardPage(colId, card.id);
          }}
          onDragStart={
            canDragNotesInTimeline
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
            canDragNotesInTimeline
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
              {formatCardTimeLabel(card, lang)}
              {reminderBesideTime ? (
                <span className="card__time-reminder">
                  {reminderBesideTime}
                </span>
              ) : null}
              {card.reminderNote ? (
                <span className="card__time-reminder">
                  {" · "}
                  {card.reminderNote}
                </span>
              ) : null}
            </span>
            <div className="card__toolbar-actions">
              <button
                type="button"
                className="card__icon-btn card__detail-btn"
                title={c.uiViewDetail}
                aria-label={c.uiViewDetail}
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
              {showCardOverflowMenu ? (
              <div
                className="card__menu-root"
                data-card-menu-root={card.id}
              >
                <button
                  type="button"
                  className="card__more"
                  aria-label={c.uiMoreActions}
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
                          ? c.uiUploading
                          : c.uiAddAttachment}
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
                        {c.uiClearAttachments}
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
                        {card.pinned ? c.uiUnpin : c.uiPin}
                      </button>
                    ) : null}
                    {canEdit && showRemoveFromCollectionMenu ? (
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          removeCardFromCollection(colId, card.id);
                          setCardMenuId(null);
                        }}
                      >
                        {c.cardMenuRemoveFromCollection}
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
                        {c.cardMenuDeleteCard}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              ) : null}
            </div>
          </div>
          <div
            className="card__text-dbltap-host"
            onTouchEnd={onCardTextTouchEnd}
            onDoubleClick={
              foldTimelineReadOnly ? onFoldReadOnlyTextDoubleClick : undefined
            }
          >
            <NoteCardTiptap
              id={`card-text-${card.id}`}
              value={card.text}
              canEdit={canEditTextInTimeline}
              timelineBodyHeadings
              foldBodyMaxLines={foldBodyMaxLines}
              onChange={(next) => setCardText(colId, card.id, next)}
              onPasteFiles={
                canEditTextInTimeline && canAttachMedia
                  ? (files) => {
                      void uploadFilesToCard(colId, card.id, files);
                    }
                  : undefined
              }
            />
          </div>
        </div>
        {hasGallery ? (
          <CardGallery
            items={media}
            onRemoveItem={
              canDropFilesOnCard
                ? (item) =>
                    removeCardMediaItem(colId, card.id, item)
                : undefined
            }
            onSetCoverItem={
              canDropFilesOnCard
                ? (item) =>
                    setCardMediaCoverItem(colId, card.id, item)
                : undefined
            }
            uploadPending={mediaUploadPending}
            uploadProgress={galleryUploadProgress}
          />
        ) : null}
      </CardRowInner>
    </li>
  );
}
