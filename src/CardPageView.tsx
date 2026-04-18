import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { NoteCardTiptap } from "./noteEditor/NoteCardTiptap";
import { CardPageTagsPanel } from "./CardPageTagsPanel";
import { formatCardTimeLabel } from "./cardTimeLabel";
import {
  collectAllTagsFromCollections,
  collectionIdsContainingCardId,
  collectionPathLabel,
} from "./appkit/collectionModel";
import type {
  CardProperty,
  CardPropertyOption,
  CardPropertyType,
  Collection,
  NoteCard,
  NoteMediaItem,
} from "./types";
import type { ReminderPickerTarget } from "./ReminderPickerModal";
import { useAppUiLang } from "./appUiLang";
import { useAppChrome } from "./i18n/useAppChrome";
import {
  copyImageToClipboard,
  downloadMediaItem,
  fileLabelFromUrl,
  noteMediaItemsEqual,
} from "./attachmentMediaMenu";
import {
  MediaLightboxAudio,
  MediaLightboxCover,
  MediaLightboxImage,
  MediaLightboxPdf,
  MediaLightboxVideo,
  MediaOpenLink,
  useMediaDisplaySrc,
} from "./mediaDisplay";
import { isPdfAttachment } from "./noteMediaPdf";
import { parseHeadingsFromStoredNote } from "./noteEditor/plainHtml";

const PROP_TYPE_LABELS: Record<CardPropertyType, string> = {
  text: "文字",
  number: "数字",
  select: "单选",
  multiSelect: "多选",
  date: "日期",
  checkbox: "勾选",
  url: "链接",
};

const PROP_TYPE_ICONS: Record<CardPropertyType, string> = {
  text: "T",
  number: "#",
  select: "≡",
  multiSelect: "☰",
  date: "◫",
  checkbox: "✓",
  url: "⊕",
};

function genId() {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 与 CardGallery 相同解析链（COS 预签名、本地 tauri: 等），避免直链 img 裂图 */
function CardPageAttachmentImage({
  item,
  className,
}: {
  item: NoteMediaItem;
  className: string;
}) {
  const raw = (item.thumbnailUrl ?? item.url).trim();
  const src = useMediaDisplaySrc(raw);
  if (!src) {
    return (
      <span
        className={`${className} card-page__attachment-thumb--pending`}
        aria-busy="true"
      />
    );
  }
  return (
    <img
      src={src}
      alt={item.name ?? ""}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}

function editorHeadingElements(root: Element | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll("h1, h2, h3, h4, h5, h6")
  ).filter((el) => (el as HTMLElement).innerText?.trim()) as HTMLElement[];
}

function FileDocIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}

export interface CardPageViewProps {
  card: NoteCard;
  colId: string;
  collections: Collection[];
  canEdit: boolean;
  canAttachMedia: boolean;
  onClose: () => void;
  setCardText: (colId: string, cardId: string, text: string) => void;
  setCardTags: (colId: string, cardId: string, tags: string[]) => void;
  setCardCustomProps: (cardId: string, props: CardProperty[]) => void;
  setReminderPicker: Dispatch<SetStateAction<ReminderPickerTarget | null>>;
  openAddToCollectionPicker: (colId: string, cardId: string) => void;
  setRelatedPanel: Dispatch<
    SetStateAction<{ colId: string; cardId: string } | null>
  >;
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
  /** 将附件移到 media 首位作为轮播封面；与 CardGallery 右键「设为封面」一致 */
  setCardMediaCoverItem?: (
    colId: string,
    cardId: string,
    item: NoteMediaItem
  ) => void;
}

function SelectPropEditor({
  prop,
  onChangeValue,
  onChangeOptions,
}: {
  prop: CardProperty;
  onChangeValue: (v: string | null) => void;
  onChangeOptions: (opts: CardPropertyOption[]) => void;
}) {
  const [val, setVal] = useState(
    typeof prop.value === "string" ? prop.value : ""
  );
  const opts = prop.options ?? [];
  const listId = `datalist-${prop.id}`;
  return (
    <div className="card-page__prop-select-wrap">
      <input
        type="text"
        className="card-page__prop-input"
        list={listId}
        placeholder="输入或选择…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          const v = val.trim();
          onChangeValue(v || null);
          if (v && !opts.find((o) => o.name === v)) {
            onChangeOptions([
              ...opts,
              { id: genId(), name: v, color: "#e0e0e0" },
            ]);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <datalist id={listId}>
        {opts.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>
    </div>
  );
}

function PropValueEditor({
  prop,
  canEdit,
  onChangeValue,
  onChangeOptions,
}: {
  prop: CardProperty;
  canEdit: boolean;
  onChangeValue: (v: CardProperty["value"]) => void;
  onChangeOptions: (opts: CardPropertyOption[]) => void;
}) {
  if (!canEdit) {
    if (prop.type === "checkbox") {
      return (
        <span className="card-page__prop-val-text">
          {prop.value ? "✓" : "—"}
        </span>
      );
    }
    if (prop.type === "multiSelect" && Array.isArray(prop.value)) {
      const vals = prop.value as string[];
      return vals.length ? (
        <span className="card-page__prop-chips">
          {vals.map((v) => (
            <span key={v} className="card-page__prop-chip">
              {v}
            </span>
          ))}
        </span>
      ) : (
        <span className="card-page__prop-empty">—</span>
      );
    }
    return (
      <span
        className={
          prop.value == null || prop.value === ""
            ? "card-page__prop-empty"
            : "card-page__prop-val-text"
        }
      >
        {prop.value == null || prop.value === "" ? "—" : String(prop.value)}
      </span>
    );
  }

  if (prop.type === "checkbox") {
    return (
      <input
        type="checkbox"
        className="card-page__prop-checkbox"
        checked={Boolean(prop.value)}
        onChange={(e) => onChangeValue(e.target.checked)}
      />
    );
  }

  if (prop.type === "multiSelect") {
    const tags = Array.isArray(prop.value) ? (prop.value as string[]) : [];
    return (
      <input
        type="text"
        className="card-page__prop-input"
        placeholder="用逗号分隔"
        defaultValue={tags.join("，")}
        onBlur={(e) => {
          const vals = e.target.value
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean);
          onChangeValue(vals.length ? vals : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  if (prop.type === "select") {
    return (
      <SelectPropEditor
        prop={prop}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
      />
    );
  }

  if (prop.type === "date") {
    return (
      <input
        type="date"
        className="card-page__prop-input"
        value={typeof prop.value === "string" ? prop.value : ""}
        onChange={(e) => onChangeValue(e.target.value || null)}
      />
    );
  }

  if (prop.type === "number") {
    return (
      <input
        type="number"
        className="card-page__prop-input"
        placeholder="—"
        defaultValue={typeof prop.value === "number" ? prop.value : ""}
        onBlur={(e) => {
          const v = e.target.value;
          onChangeValue(v === "" ? null : Number(v));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  if (prop.type === "url") {
    return (
      <input
        type="url"
        className="card-page__prop-input"
        placeholder="https://…"
        defaultValue={typeof prop.value === "string" ? prop.value : ""}
        onBlur={(e) => onChangeValue(e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <input
      type="text"
      className="card-page__prop-input"
      placeholder="—"
      defaultValue={typeof prop.value === "string" ? prop.value : ""}
      onBlur={(e) => onChangeValue(e.target.value || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function CardPageView({
  card,
  colId,
  collections,
  canEdit,
  canAttachMedia,
  onClose,
  setCardText,
  setCardTags,
  setCardCustomProps,
  setReminderPicker,
  openAddToCollectionPicker,
  setRelatedPanel,
  uploadFilesToCard,
  removeCardMediaItem,
  setCardMediaCoverItem,
}: CardPageViewProps) {
  const { lang } = useAppUiLang();
  const ui = useAppChrome();
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null);
  const [attachMenu, setAttachMenu] = useState<{
    x: number;
    y: number;
    item: NoteMediaItem;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const typePickerRef = useRef<HTMLDivElement>(null);
  const [propsPanelOpen, setPropsPanelOpen] = useState(true);
  const [tocPanelOpen, setTocPanelOpen] = useState(true);
  const [tocActiveIndex, setTocActiveIndex] = useState(0);

  const PROPS_WIDTH_KEY = "mikujar-card-page-props-width";
  const [propsWidth, setPropsWidth] = useState(() => {
    try {
      const v = localStorage.getItem(PROPS_WIDTH_KEY);
      return v ? Math.max(160, Math.min(520, Number(v))) : 260;
    } catch {
      return 260;
    }
  });
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    dragStartWidth.current = propsWidth;
  }, [propsWidth]);

  const onDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - dragStartX.current;
    const next = Math.max(160, Math.min(520, dragStartWidth.current + delta));
    setPropsWidth(next);
  }, []);

  const onDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const delta = e.clientX - dragStartX.current;
    const next = Math.max(160, Math.min(520, dragStartWidth.current + delta));
    try { localStorage.setItem(PROPS_WIDTH_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const customProps = card.customProps ?? [];
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const colIds = [...collectionIdsContainingCardId(collections, card.id)];
  const tagLibrary = useMemo(
    () => collectAllTagsFromCollections(collections),
    [collections]
  );
  const relatedCount = (card.relatedRefs ?? []).length;
  const hasReminder = Boolean(card.reminderOn);

  const tocHeadings = useMemo(
    () => parseHeadingsFromStoredNote(card.text),
    [card.text]
  );

  const tocActiveClamped =
    tocHeadings.length === 0
      ? 0
      : Math.min(tocActiveIndex, tocHeadings.length - 1);

  const scrollToHeading = useCallback((index: number) => {
    const root = editorAreaRef.current?.querySelector(".ProseMirror");
    if (!root) return;
    const hs = editorHeadingElements(root);
    if (index < 0 || index >= hs.length) return;
    hs[index]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTocActiveIndex(
      tocHeadings.length ? Math.min(index, tocHeadings.length - 1) : 0
    );
  }, [tocHeadings]);

  useEffect(() => {
    if (!tocPanelOpen || tocHeadings.length === 0) return;

    let cancelled = false;
    let pollRaf = 0;
    let scrollRaf = 0;
    let pmEl: HTMLElement | null = null;

    const syncActive = () => {
      const pm = editorAreaRef.current?.querySelector(
        ".ProseMirror"
      ) as HTMLElement | null;
      if (!pm) return;
      const hs = editorHeadingElements(pm);
      if (hs.length === 0) return;
      const rootRect = pm.getBoundingClientRect();
      const probe =
        rootRect.top + Math.min(96, Math.max(28, rootRect.height * 0.14));
      let active = 0;
      for (let i = 0; i < hs.length; i++) {
        if (hs[i].getBoundingClientRect().top <= probe) active = i;
        else break;
      }
      setTocActiveIndex((prev) => {
        const max = tocHeadings.length - 1;
        const next = Math.min(active, max);
        return prev === next ? prev : next;
      });
    };

    const onScroll = () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        syncActive();
      });
    };

    const poll = () => {
      if (cancelled) return;
      pmEl = editorAreaRef.current?.querySelector(
        ".ProseMirror"
      ) as HTMLElement | null;
      if (!pmEl) {
        pollRaf = requestAnimationFrame(poll);
        return;
      }
      syncActive();
      pmEl.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
    };

    pollRaf = requestAnimationFrame(poll);

    return () => {
      cancelled = true;
      cancelAnimationFrame(pollRaf);
      cancelAnimationFrame(scrollRaf);
      pmEl?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [tocPanelOpen, tocHeadings, card.id]);

  const n = media.length;
  const mediaKey = media
    .map((x) => `${x.kind}:${x.url}:${x.name ?? ""}`)
    .join("|");

  const goLightbox = useCallback(
    (delta: number) => {
      if (n <= 1) return;
      setLightbox((lb) => {
        if (!lb) return lb;
        return { index: (lb.index + delta + n * 100) % n };
      });
    },
    [n]
  );

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  const openAttachmentMenu = useCallback(
    (e: ReactMouseEvent<HTMLElement>, item: NoteMediaItem) => {
      e.preventDefault();
      e.stopPropagation();
      setAttachMenu({ x: e.clientX, y: e.clientY, item });
    },
    []
  );

  useEffect(() => {
    setLightbox((lb) => {
      if (!lb) return lb;
      if (n === 0) return null;
      if (lb.index >= n) return { index: n - 1 };
      if (lb.index < 0) return { index: 0 };
      return lb;
    });
  }, [n, mediaKey]);

  useEffect(() => {
    if (!lightbox && !attachMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (attachMenu) {
          e.preventDefault();
          setAttachMenu(null);
          return;
        }
        if (lightbox) {
          e.preventDefault();
          closeLightbox();
        }
        return;
      }
      if (lightbox && n > 1) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goLightbox(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          goLightbox(1);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, attachMenu, n, closeLightbox, goLightbox]);

  useEffect(() => {
    if (!lightbox) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightbox]);

  useEffect(() => {
    if (!showTypePicker) return;
    function onDown(e: PointerEvent) {
      if (
        typePickerRef.current &&
        !typePickerRef.current.contains(e.target as Node)
      ) {
        setShowTypePicker(false);
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showTypePicker]);

  useEffect(() => {
    if (!attachMenu) return;
    const onDown = (e: PointerEvent) => {
      const el = document.querySelector("[data-attachment-ctx-menu]");
      if (el?.contains(e.target as Node)) return;
      setAttachMenu(null);
    };
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [attachMenu]);

  function updateCustomProps(next: CardProperty[]) {
    setCardCustomProps(card.id, next);
  }

  function addProperty(type: CardPropertyType) {
    const newProp: CardProperty = {
      id: genId(),
      name: PROP_TYPE_LABELS[type],
      type,
      value: type === "checkbox" ? false : null,
    };
    updateCustomProps([...customProps, newProp]);
    setShowTypePicker(false);
  }

  const lbIdx =
    lightbox && n > 0 ? ((lightbox.index % n) + n) % n : 0;
  const lbItem =
    lightbox && n > 0 ? (media[lbIdx] ?? null) : null;

  const labelFromUrl = (url: string) =>
    fileLabelFromUrl(url, ui.uiFileFallback);

  function previewTitle(kind: NoteMediaItem["kind"]): string {
    const thumbCtx = Boolean(
      canEdit || (Boolean(setCardMediaCoverItem) && n > 1)
    );
    if (thumbCtx) {
      if (kind === "image") return ui.uiGalleryThumbTitleImageRich;
      if (kind === "file") return ui.uiGalleryThumbTitleFileRich;
      if (kind === "audio") return ui.uiGalleryThumbTitleAudioRich;
      return ui.uiGalleryThumbTitleVideoRich;
    }
    if (kind === "image") return ui.uiGalleryThumbTitleImagePlain;
    if (kind === "file") return ui.uiGalleryThumbTitleFilePlain;
    if (kind === "audio") return ui.uiGalleryThumbTitleAudioPlain;
    return ui.uiGalleryThumbTitleVideoPlain;
  }

  const lightboxPortal =
    lightbox &&
    lbItem &&
    createPortal(
      <div
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={
          n > 1 ? ui.uiLightboxAria(lbIdx + 1, n) : ui.uiLightboxPreview
        }
        onClick={closeLightbox}
      >
        <button
          type="button"
          className="image-lightbox__close"
          aria-label={ui.uiClose}
          onClick={(e) => {
            e.stopPropagation();
            closeLightbox();
          }}
        >
          ×
        </button>
        <div
          className="image-lightbox__swipe-area"
          onClick={(e) => e.stopPropagation()}
        >
          {n > 1 ? (
            <span className="image-lightbox__pager" aria-live="polite">
              {lbIdx + 1} / {n}
            </span>
          ) : null}
          {n > 1 ? (
            <>
              <button
                type="button"
                className="image-lightbox__arrow image-lightbox__arrow--prev"
                aria-label={ui.uiPrevItem}
                onClick={(e) => {
                  e.stopPropagation();
                  goLightbox(-1);
                }}
              />
              <button
                type="button"
                className="image-lightbox__arrow image-lightbox__arrow--next"
                aria-label={ui.uiNextItem}
                onClick={(e) => {
                  e.stopPropagation();
                  goLightbox(1);
                }}
              />
            </>
          ) : null}
          {lbItem.kind === "image" ? (
            <div
              className="image-lightbox__media-stack"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                if (lbItem) openAttachmentMenu(e, lbItem);
              }}
            >
              <MediaLightboxImage
                url={lbItem.url}
                className="image-lightbox__img"
              />
              <p className="image-lightbox__media-caption">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
            </div>
          ) : lbItem.kind === "video" ? (
            <div
              className="image-lightbox__media-stack"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                if (lbItem) openAttachmentMenu(e, lbItem);
              }}
            >
              <MediaLightboxVideo
                url={lbItem.url}
                className="image-lightbox__img image-lightbox__video"
              />
              <p className="image-lightbox__media-caption">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
            </div>
          ) : lbItem.kind === "audio" ? (
            <div
              className="image-lightbox__audio-wrap"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                if (lbItem) openAttachmentMenu(e, lbItem);
              }}
            >
              {lbItem.coverUrl ? (
                <MediaLightboxCover
                  url={lbItem.coverUrl}
                  className="image-lightbox__audio-cover"
                />
              ) : null}
              <p className="image-lightbox__audio-title">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
              <MediaLightboxAudio
                url={lbItem.url}
                className="image-lightbox__audio"
              />
            </div>
          ) : lbItem.kind === "file" && isPdfAttachment(lbItem) ? (
            <div
              className="image-lightbox__media-stack image-lightbox__media-stack--pdf"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                if (lbItem) openAttachmentMenu(e, lbItem);
              }}
            >
              <MediaLightboxPdf
                url={lbItem.url}
                className="image-lightbox__pdf"
                title={lbItem.name ?? labelFromUrl(lbItem.url)}
              />
              <p className="image-lightbox__media-caption">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
              <MediaOpenLink
                url={lbItem.url}
                className="image-lightbox__file-link image-lightbox__pdf-open-tab"
              >
                {ui.uiOpenInNewWindow}
              </MediaOpenLink>
            </div>
          ) : (
            <div
              className="image-lightbox__file"
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                if (lbItem) openAttachmentMenu(e, lbItem);
              }}
            >
              <FileDocIcon className="image-lightbox__file-icon" />
              <p className="image-lightbox__file-name">
                {lbItem.name ?? labelFromUrl(lbItem.url)}
              </p>
              <MediaOpenLink
                url={lbItem.url}
                className="image-lightbox__file-link"
              >
                {ui.uiOpenInNewWindow}
              </MediaOpenLink>
            </div>
          )}
        </div>
      </div>,
      document.body
    );

  const attachMenuPortal =
    attachMenu &&
    createPortal(
      <div
        data-attachment-ctx-menu
        className="attachment-ctx-menu"
        style={{
          position: "fixed",
          left: Math.min(
            attachMenu.x,
            typeof window !== "undefined"
              ? window.innerWidth - 180
              : attachMenu.x
          ),
          top: attachMenu.y,
          zIndex: 10001,
        }}
        role="menu"
      >
        {setCardMediaCoverItem &&
        n > 1 &&
        media.findIndex((m) => noteMediaItemsEqual(m, attachMenu.item)) >
          0 ? (
          <button
            type="button"
            className="attachment-ctx-menu__item"
            role="menuitem"
            onClick={() => {
              setCardMediaCoverItem?.(colId, card.id, attachMenu.item);
              setAttachMenu(null);
              setLightbox(null);
            }}
          >
            {ui.uiSetCover}
          </button>
        ) : null}
        {attachMenu.item.kind === "image" ? (
          <button
            type="button"
            className="attachment-ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void copyImageToClipboard(attachMenu.item);
              setAttachMenu(null);
            }}
          >
            {ui.uiCopyImage}
          </button>
        ) : null}
        <button
          type="button"
          className="attachment-ctx-menu__item"
          role="menuitem"
          onClick={() => {
            void downloadMediaItem(attachMenu.item, ui.uiFileFallback);
            setAttachMenu(null);
          }}
        >
          {ui.uiDownloadAttachment}
        </button>
        {canEdit ? (
          <button
            type="button"
            className="attachment-ctx-menu__item attachment-ctx-menu__item--danger"
            role="menuitem"
            onClick={() => {
              removeCardMediaItem(colId, card.id, attachMenu.item);
              setAttachMenu(null);
              setLightbox(null);
            }}
          >
            {ui.uiDeleteAttachment}
          </button>
        ) : null}
      </div>,
      document.body
    );

  return (
    <div className="card-page">
      <div className="card-page__header">
        <button
          type="button"
          className="card-page__back"
          onClick={onClose}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          返回
        </button>
        <span className="card-page__time">
          {formatCardTimeLabel(card, lang)}
        </span>
      </div>

      <div className="card-page__body">
        <div className="card-page__props" style={{ width: propsWidth, flexBasis: propsWidth }}>
          <div className="sidebar__section-row sidebar__section-row--collapsible card-page__props-sidebar-row">
            <button
              type="button"
              className="sidebar__section-hit"
              aria-expanded={propsPanelOpen}
              onClick={() => setPropsPanelOpen((v) => !v)}
            >
              <span
                className={
                  "sidebar__chevron" + (propsPanelOpen ? " is-expanded" : "")
                }
                aria-hidden
              >
                <span className="sidebar__chevron-icon">›</span>
              </span>
              <span className="sidebar__section">属性</span>
            </button>
          </div>
          {propsPanelOpen ? (
            <div className="card-page__props-panel-inner">
          {/* 标签 */}
          <div className="card-page__prop-row card-page__prop-row--tags">
            <span className="card-page__prop-label">标签</span>
            <div className="card-page__prop-content">
              <CardPageTagsPanel
                cardId={card.id}
                tags={card.tags}
                tagOptions={tagLibrary}
                canEdit={canEdit}
                onCommit={(tags) => setCardTags(colId, card.id, tags)}
              />
            </div>
          </div>

          {/* 提醒 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">提醒</span>
            <div className="card-page__prop-content">
              {hasReminder ? (
                <button
                  type="button"
                  className="card-page__prop-link"
                  onClick={() =>
                    setReminderPicker({ kind: "card", colId, cardId: card.id })
                  }
                >
                  {card.reminderOn}
                  {card.reminderTime ? ` ${card.reminderTime}` : ""}
                  {card.reminderNote ? ` · ${card.reminderNote}` : ""}
                </button>
              ) : canEdit ? (
                <button
                  type="button"
                  className="card-page__prop-link card-page__prop-link--placeholder"
                  onClick={() =>
                    setReminderPicker({ kind: "card", colId, cardId: card.id })
                  }
                >
                  添加提醒…
                </button>
              ) : (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 合集 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">合集</span>
            <div className="card-page__prop-content card-page__prop-content--row">
              {colIds.map((id) => (
                <span key={id} className="card-page__prop-chip card-page__prop-chip--col">
                  {collectionPathLabel(collections, id)}
                </span>
              ))}
              {canEdit && (
                <button
                  type="button"
                  className="card-page__prop-link card-page__prop-link--add"
                  onClick={() =>
                    openAddToCollectionPicker(colId, card.id)
                  }
                >
                  + 添加至合集
                </button>
              )}
            </div>
          </div>

          {/* 相关笔记 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">相关笔记</span>
            <div className="card-page__prop-content">
              {relatedCount > 0 ? (
                <button
                  type="button"
                  className="card-page__prop-link"
                  onClick={() =>
                    setRelatedPanel({ colId, cardId: card.id })
                  }
                >
                  {relatedCount} 条相关
                </button>
              ) : canEdit ? (
                <button
                  type="button"
                  className="card-page__prop-link card-page__prop-link--placeholder"
                  onClick={() =>
                    setRelatedPanel({ colId, cardId: card.id })
                  }
                >
                  添加关联…
                </button>
              ) : (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 附件 */}
          <div className="card-page__prop-row card-page__prop-row--attachments">
            <span className="card-page__prop-label">附件</span>
            <div className="card-page__prop-content card-page__prop-content--attachments">
              {media.map((item, idx) => (
                <div key={item.url} className="card-page__attachment">
                  <button
                    type="button"
                    className="card-page__attachment-trigger"
                    title={previewTitle(item.kind)}
                    aria-label={previewTitle(item.kind)}
                    onClick={() => setLightbox({ index: idx })}
                    onContextMenu={(e) => openAttachmentMenu(e, item)}
                  >
                    {item.kind === "image" ? (
                      <CardPageAttachmentImage
                        item={item}
                        className="card-page__attachment-thumb"
                      />
                    ) : (
                      <span className="card-page__attachment-name">
                        {item.name ?? item.url.split("/").pop()}
                      </span>
                    )}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="card-page__attachment-remove"
                      onClick={() =>
                        removeCardMediaItem(colId, card.id, item)
                      }
                      title="移除"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {canAttachMedia && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length)
                        void uploadFilesToCard(colId, card.id, files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="card-page__prop-link card-page__prop-link--add"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    + 上传附件
                  </button>
                </>
              )}
              {media.length === 0 && !canAttachMedia && (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 自定义属性 */}
          {customProps.map((prop) => (
            <div
              key={prop.id}
              className="card-page__prop-row card-page__prop-row--custom"
            >
              <div className="card-page__prop-label-wrap">
                <span className="card-page__prop-type-icon">
                  {PROP_TYPE_ICONS[prop.type]}
                </span>
                {canEdit ? (
                  <input
                    type="text"
                    className="card-page__prop-name-input"
                    defaultValue={prop.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim() || prop.name;
                      updateCustomProps(
                        customProps.map((p) =>
                          p.id === prop.id ? { ...p, name } : p
                        )
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="card-page__prop-label">{prop.name}</span>
                )}
              </div>
              <div className="card-page__prop-content">
                <PropValueEditor
                  prop={prop}
                  canEdit={canEdit}
                  onChangeValue={(v) =>
                    updateCustomProps(
                      customProps.map((p) =>
                        p.id === prop.id ? { ...p, value: v } : p
                      )
                    )
                  }
                  onChangeOptions={(opts) =>
                    updateCustomProps(
                      customProps.map((p) =>
                        p.id === prop.id ? { ...p, options: opts } : p
                      )
                    )
                  }
                />
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="card-page__prop-delete"
                  onClick={() =>
                    updateCustomProps(customProps.filter((p) => p.id !== prop.id))
                  }
                  title="删除属性"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {/* 添加属性 */}
          {canEdit && (
            <div className="card-page__prop-add-wrap" ref={typePickerRef}>
              <button
                type="button"
                className="card-page__prop-add"
                onClick={() => setShowTypePicker((v) => !v)}
              >
                + 添加属性
              </button>
              {showTypePicker && (
                <div className="card-page__prop-type-menu">
                  {(
                    Object.keys(PROP_TYPE_LABELS) as CardPropertyType[]
                  ).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="card-page__prop-type-option"
                      onClick={() => addProperty(type)}
                    >
                      <span className="card-page__prop-type-icon">
                        {PROP_TYPE_ICONS[type]}
                      </span>
                      {PROP_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
            </div>
          ) : null}

          <div className="sidebar__section-row sidebar__section-row--collapsible card-page__props-sidebar-row card-page__props-sidebar-row--toc">
            <button
              type="button"
              className="sidebar__section-hit"
              aria-expanded={tocPanelOpen}
              onClick={() => setTocPanelOpen((v) => !v)}
            >
              <span
                className={
                  "sidebar__chevron" + (tocPanelOpen ? " is-expanded" : "")
                }
                aria-hidden
              >
                <span className="sidebar__chevron-icon">›</span>
              </span>
              <span className="sidebar__section">目录</span>
            </button>
          </div>
          {tocPanelOpen ? (
            <nav className="card-page__toc" aria-label="正文目录">
              {tocHeadings.length === 0 ? (
                <span className="card-page__toc-empty">无标题</span>
              ) : (
                tocHeadings.map((h, i) => (
                  <button
                    key={`toc-${i}`}
                    type="button"
                    className={
                      "card-page__toc-item" +
                      (i === tocActiveClamped
                        ? " card-page__toc-item--active"
                        : "")
                    }
                    aria-current={
                      i === tocActiveClamped ? "location" : undefined
                    }
                    onClick={() => scrollToHeading(i)}
                  >
                    <span
                      className="card-page__toc-item-text"
                      style={{
                        paddingLeft: `${Math.max(0, h.level - 1) * 12}px`,
                      }}
                    >
                      {h.text}
                    </span>
                  </button>
                ))
              )}
            </nav>
          ) : null}
        </div>

        <div
          className="card-page__divider"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
        />

        <div className="card-page__editor-area" ref={editorAreaRef}>
          <NoteCardTiptap
            id={card.id}
            value={card.text}
            onChange={(text) => setCardText(colId, card.id, text)}
            canEdit={canEdit}
            showToolbar={canEdit}
          />
        </div>
      </div>
      {lightboxPortal}
      {attachMenuPortal}
    </div>
  );
}
