import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
  type ReactNode,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { NoteCardTiptap } from "./noteEditor/NoteCardTiptap";
import { CardPageTagsPanel } from "./CardPageTagsPanel";
import { tagChipInlineStyle } from "./tagChipPalette";
import { formatCardTimeLabel, localDateString } from "./cardTimeLabel";
import { CardPageCollectionTagsPanel } from "./CardPageCollectionTagsPanel";
import {
  collectionIdsContainingCardId,
  findCardInTree,
  isFileCard,
  LOOSE_NOTES_COLLECTION_ID,
  walkCollectionsWithPath,
} from "./appkit/collectionModel";
import { useTagsLibrary } from "./appkit/useTagsLibrary";
import { mergedTemplateSchemaFieldsForPlacements } from "./appkit/schemaTemplateFields";
import { DatePropPopover } from "./appkit/DatePropPopover";
import { formatByteSize } from "./noteStats";
import { migrateCustomPropsList } from "./noteCardCustomProps";
import type {
  AutoLinkRule,
  CardLinkRef,
  CardProperty,
  CardPropertyOption,
  CardPropertyType,
  Collection,
  NoteCard,
  NoteMediaItem,
  SchemaField,
} from "./types";
import { cardDisplayLabel, cardHeadlinePlain } from "./notePlainText";
import { getPresetTitleLabel } from "./notePresetTypesCatalog";
import {
  fetchCardEffectiveSchema,
  patchCardMediaItemApi,
  postCardAutoLinkApi,
} from "./api/collections";
import {
  needsCosReadUrl,
  resolveCosMediaUrlIfNeeded,
  resolveMediaUrl,
} from "./api/auth";
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
  MediaThumbImage,
  MediaThumbVideo,
  useMediaDisplaySrc,
} from "./mediaDisplay";
import { isPdfAttachment } from "./noteMediaPdf";
import { NOTE_MEDIA_ITEM_DRAG_MIME } from "./noteEditor/noteMediaDragMime";
import {
  MOBILE_CHROME_MEDIA,
  matchesMobileChromeMedia,
} from "./appkit/appConstants";
import { parseHeadingsFromStoredNote } from "./noteEditor/plainHtml";

function subscribeCardPageCompactLayout(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_CHROME_MEDIA);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** 双击 / 双次轻点空白收键盘时，排除工具栏与可点控件 */
function gestureTargetAllowsBlankDismiss(t: HTMLElement | null): boolean {
  return Boolean(
    t &&
      !t.closest(
        "button, a, input, select, textarea, .note-toolbar-wrap, .note-toolbar"
      )
  );
}

/** 自定义属性「链接」：仅允许 http(s)，避免 javascript: 等危险协议 */
function safeHttpHrefFromPropValue(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return null;
  let candidate = t;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_LOCAL_RE = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDatePropDisplay(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return "";
  if (DATE_ONLY_RE.test(t)) return t;
  const m = t.match(DATE_TIME_LOCAL_RE);
  if (m) return `${m[1]} ${m[2]}`;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return t;
  const d = new Date(ms);
  return `${localDateString(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function hasDraggedFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (Array.from(dt.types ?? []).includes("Files")) return true;
  const items = Array.from(dt.items ?? []);
  return items.some((it) => it.kind === "file");
}

function isDurationSecondsProp(prop: CardProperty): boolean {
  if (prop.type !== "number") return false;
  const id = prop.id.trim().toLowerCase();
  return id.includes("duration");
}

function formatDurationHms(raw: unknown): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "—";
  const total = Math.floor(n);
  const s = total % 60;
  const mins = Math.floor(total / 60);
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const PROP_TYPE_LABELS: Record<CardPropertyType, string> = {
  text: "文字",
  number: "数字",
  choice: "选择",
  collectionLink: "关联",
  cardLink: "关联",
  cardLinks: "关联",
  date: "日期",
  checkbox: "勾选",
  url: "链接",
};

const PROP_TYPE_PICKER_TYPES: CardPropertyType[] = [
  "text",
  "number",
  "choice",
  "date",
  "checkbox",
  "url",
  "collectionLink",
  "cardLinks",
];

function propTypePickerLabel(type: CardPropertyType, lang: "zh" | "en"): string {
  if (type === "cardLink") return lang === "en" ? "Link Card" : "关联单张卡片";
  if (type === "collectionLink") return lang === "en" ? "Link Collection" : "关联合集";
  if (type === "cardLinks") return lang === "en" ? "Link Cards" : "关联卡片";
  return PROP_TYPE_LABELS[type];
}

function genId() {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseCardLinkRef(v: unknown): CardLinkRef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const colId = typeof o.colId === "string" ? o.colId.trim() : "";
  const cardId = typeof o.cardId === "string" ? o.cardId.trim() : "";
  if (!colId || !cardId) return null;
  return { colId, cardId };
}

function dedupeCardLinkRefs(refs: CardLinkRef[]): CardLinkRef[] {
  const seen = new Set<string>();
  const out: CardLinkRef[] = [];
  for (const r of refs) {
    const k = `${r.colId}\t${r.cardId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function parseCardLinkRefList(v: unknown): CardLinkRef[] {
  if (!Array.isArray(v)) return [];
  const parsed = v
    .map((item) => parseCardLinkRef(item))
    .filter((x): x is CardLinkRef => x != null);
  return dedupeCardLinkRefs(parsed);
}

function normalizeSchemaPropNameKey(name: string | undefined): string {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function schemaFieldIdentityKey(field: SchemaField): string {
  return `${field.type}::${normalizeSchemaPropNameKey(field.name)}`;
}

function propHasMeaningfulValue(prop: CardProperty): boolean {
  if (prop.type === "cardLinks") return parseCardLinkRefList(prop.value).length > 0;
  if (prop.type === "cardLink") {
    return (
      parseCardLinkRef(prop.value) != null ||
      Boolean(cardLinkSeedTitleText(prop))
    );
  }
  if (prop.type === "choice") return Array.isArray(prop.value) && prop.value.length > 0;
  if (prop.type === "collectionLink") return collectionLinkIds(prop.value).length > 0;
  if (prop.type === "checkbox") return prop.value === true;
  if (typeof prop.value === "string") return prop.value.trim().length > 0;
  return prop.value != null;
}

function resolveCardLinkCreateTarget(
  fieldId: string,
  rules: AutoLinkRule[] | null | undefined
): {
  targetCollectionId?: string;
  targetPresetTypeId?: string;
  targetObjectKind?: string;
} | null {
  if (!fieldId.trim() || !Array.isArray(rules) || rules.length === 0) return null;
  for (const rule of rules) {
    const multiTargets = Array.isArray(rule.targets) ? rule.targets : [];
    for (const target of multiTargets) {
      if (target.syncSchemaFieldId !== fieldId) continue;
      return {
        ...(target.targetCollectionId?.trim()
          ? { targetCollectionId: target.targetCollectionId.trim() }
          : {}),
        ...(target.targetPresetTypeId?.trim()
          ? { targetPresetTypeId: target.targetPresetTypeId.trim() }
          : {}),
        ...(target.targetObjectKind?.trim()
          ? { targetObjectKind: target.targetObjectKind.trim() }
          : {}),
      };
    }
    if (rule.syncSchemaFieldId !== fieldId) continue;
    return {
      ...(rule.targetCollectionId?.trim()
        ? { targetCollectionId: rule.targetCollectionId.trim() }
        : {}),
      ...(rule.targetPresetTypeId?.trim()
        ? { targetPresetTypeId: rule.targetPresetTypeId.trim() }
        : {}),
      ...(rule.targetObjectKind?.trim()
        ? { targetObjectKind: rule.targetObjectKind.trim() }
        : {}),
    };
  }
  return null;
}

function mergeLegacyNamedPropsIntoSchema(
  props: CardProperty[],
  schemaFields: SchemaField[]
): CardProperty[] {
  if (props.length === 0 || schemaFields.length === 0) return props;
  const schemaById = new Map(schemaFields.map((f) => [f.id, f] as const));
  const schemaByName = new Map<string, SchemaField>();
  for (const field of schemaFields) {
    const key = normalizeSchemaPropNameKey(field.name);
    if (!key || schemaByName.has(key)) continue;
    schemaByName.set(key, field);
  }

  let changed = false;
  const next: CardProperty[] = [];
  const indexById = new Map<string, number>();

  function upsert(prop: CardProperty) {
    const idx = indexById.get(prop.id);
    if (idx == null) {
      indexById.set(prop.id, next.length);
      next.push(prop);
    } else {
      next[idx] = prop;
    }
  }

  function mergeIntoSchemaProp(
    target: CardProperty | undefined,
    legacy: CardProperty,
    field: SchemaField
  ): CardProperty | undefined {
    const base: CardProperty =
      target ??
      ({
        id: field.id,
        name: field.name,
        type: field.type as CardPropertyType,
        value: field.type === "checkbox" ? false : null,
        ...(field.options ? { options: field.options } : {}),
      } as CardProperty);

    if (field.type === "cardLink") {
      if (parseCardLinkRef(base.value) != null || cardLinkSeedTitleText(base)) {
        return base;
      }
      if (legacy.type === "cardLink" && parseCardLinkRef(legacy.value)) {
        return {
          ...base,
          value: legacy.value as CardProperty["value"],
        };
      }
      if (legacy.type === "text") {
        const seed = typeof legacy.value === "string" ? legacy.value.trim() : "";
        if (seed) {
          return { ...base, seedTitle: seed };
        }
      }
      return target ? base : undefined;
    }

    if (field.type === "cardLinks") {
      if (parseCardLinkRefList(base.value).length > 0 || cardLinkSeedTitleText(base)) {
        return base;
      }
      if (legacy.type === "cardLinks") {
        const refs = parseCardLinkRefList(legacy.value);
        if (refs.length > 0) return { ...base, value: refs };
      }
      if (legacy.type === "text") {
        const seed = typeof legacy.value === "string" ? legacy.value.trim() : "";
        if (seed) return { ...base, seedTitle: seed };
      }
      return target ? base : undefined;
    }

    if (!propHasMeaningfulValue(base) && legacy.type === field.type) {
      return {
        ...base,
        value: legacy.value,
        ...(legacy.options ? { options: legacy.options } : {}),
      };
    }
    return target ? base : undefined;
  }

  for (const prop of props) {
    if (schemaById.has(prop.id)) {
      upsert(prop);
      continue;
    }
    const field = schemaByName.get(normalizeSchemaPropNameKey(prop.name));
    if (!field) {
      upsert(prop);
      continue;
    }
    const existing =
      indexById.get(field.id) != null ? next[indexById.get(field.id)!] : undefined;
    const merged = mergeIntoSchemaProp(existing, prop, field);
    if (merged) upsert(merged);
    changed = true;
  }

  return changed ? next : props;
}

function normalizeCustomPropsAgainstSchema(
  props: CardProperty[],
  schemaFields: SchemaField[],
  collections: Collection[]
): CardProperty[] {
  if (props.length === 0 || schemaFields.length === 0) return props;
  const schemaById = new Map(schemaFields.map((f) => [f.id, f] as const));
  let changed = false;
  const next = props.map((prop) => {
    const field = schemaById.get(prop.id);
    if (!field) return prop;
    if (field.type === "text" && prop.type === "cardLink") {
      const ref = parseCardLinkRef(prop.value);
      const seed = cardLinkSeedTitleText(prop);
      const text =
        seed ||
        (ref ? cardLinkDisplayLabel(collections, ref) : "") ||
        (typeof prop.value === "string" ? prop.value.trim() : "");
      changed = true;
      return {
        id: prop.id,
        name: field.name,
        type: "text" as CardPropertyType,
        value: text || null,
        ...(prop.options ? { options: prop.options } : {}),
      };
    }
    if (prop.type !== field.type) {
      return { ...prop, name: field.name };
    }
    return prop;
  });
  return changed ? next : props;
}

/** 将 schema 定义的 cardLink 与已存的 customProps 对齐（兼容旧 text 作者字段） */
function coerceSchemaPropForEditor(
  field: SchemaField,
  matchProp: CardProperty | undefined
): CardProperty | undefined {
  if (field.type === "cardLinks") {
    if (!matchProp) return undefined;
    if (matchProp.type === "cardLinks") return matchProp;
    if (matchProp.type === "text") {
      return {
        id: field.id,
        name: field.name,
        type: "cardLinks",
        value: null,
      };
    }
    return {
      id: matchProp.id,
      name: field.name,
      type: "cardLinks",
      value: null,
    };
  }
  if (field.type !== "cardLink") return matchProp;
  if (!matchProp) return undefined;
  if (matchProp.type === "cardLink") return matchProp;
  if (matchProp.type === "text") {
    const textVal =
      typeof matchProp.value === "string" ? matchProp.value.trim() : "";
    // 剪藏作者等场景：若源值是文本，优先展示该文本，避免被历史/误匹配的 creator 边覆盖显示。
    // 若用户希望采用关联边，可通过“填入关联”显式替换。
    return {
      id: field.id,
      name: field.name,
      type: "cardLink",
      value: null,
      ...(textVal ? { seedTitle: textVal } : {}),
    };
  }
  return {
    id: matchProp.id,
    name: field.name,
    type: "cardLink",
    value: null,
  };
}

function cardLinkDisplayLabel(
  collections: Collection[],
  ref: CardLinkRef
): string {
  const hit = findCardInTree(collections, ref.colId, ref.cardId);
  if (!hit) return "（未能加载卡片）";
  const h = cardDisplayLabel(hit.card);
  return h || "卡片";
}

/** 剪藏扩展等在关联写入前写入的昵称，需在 UI 展示（value 仍为 null 时） */
function cardLinkSeedTitleText(prop: CardProperty): string {
  return typeof prop.seedTitle === "string" ? prop.seedTitle.trim() : "";
}

function collectionPathDisplayLabel(path: string, colName: string): string {
  const cleanPath = path.trim();
  if (!cleanPath) return colName.trim();
  return cleanPath.endsWith(colName) ? cleanPath : `${cleanPath} / ${colName}`;
}

function CardLinksValueEditor({
  prop,
  collections,
  onChangeValue,
  onChangeSeedTitle,
  onOpenLinkedCard,
}: {
  prop: CardProperty;
  collections: Collection[];
  onChangeValue: (v: CardProperty["value"]) => void;
  onChangeSeedTitle?: (v: string | null) => void;
  onOpenLinkedCard?: (colId: string, cardId: string) => void;
}) {
  const refs = parseCardLinkRefList(prop.value);
  const seed = cardLinkSeedTitleText(prop);

  const setRefs = (next: CardLinkRef[]) => {
    onChangeValue(next.length ? next : null);
  };

  return (
    <div className="card-page__tags-panel card-page__tags-panel--cardlinks">
      {refs.length === 0 ? (
        <div className="card-page__prop-text-edit-row">
          <input
            type="text"
            className="card-page__tags-add-input card-page__tags-add-input--prop-field"
            placeholder="可先填写文字，再补充关联…"
            defaultValue={seed}
            onBlur={(e) => onChangeSeedTitle?.(e.target.value.trim() || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      ) : null}
      {refs.length > 0 ? (
        <div className="card-page__prop-cardlinks-list">
          {refs.map((ref) => (
            <span
              key={`${ref.colId}-${ref.cardId}`}
              className="card-page__prop-cardlink-chip-wrap"
            >
              {onOpenLinkedCard ? (
                <button
                  type="button"
                  className="card-page__tags-hit-btn card-page__prop-author-link"
                  onClick={() => onOpenLinkedCard(ref.colId, ref.cardId)}
                >
                  {seed || cardLinkDisplayLabel(collections, ref)}
                </button>
              ) : (
                <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
                  {seed || cardLinkDisplayLabel(collections, ref)}
                </span>
              )}
              <button
                type="button"
                className="card-page__prop-cardlink-clear"
                title="移除"
                aria-label="移除"
                onClick={() =>
                  setRefs(
                    refs.filter(
                      (x) =>
                        !(x.colId === ref.colId && x.cardId === ref.cardId)
                    )
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 与笔记标签一致：按选项名稳定哈希的 pastel，不用 options 里的固定灰 */
function choicePillStyle(valueName: string): CSSProperties {
  return tagChipInlineStyle(valueName);
}

function collectionLinkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (x): x is string =>
          typeof x === "string" &&
          Boolean(x.trim()) &&
          x !== LOOSE_NOTES_COLLECTION_ID
      )
    ),
  ];
}

function computeFallbackSchemaFieldsFromPlacements(
  collections: Collection[],
  placementIds: string[]
): SchemaField[] {
  return mergedTemplateSchemaFieldsForPlacements(collections, placementIds);
}

/** 与 CardGallery 相同解析链(COS 预签名等),避免直链 img 裂图 */
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
      draggable={false}
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

function AudioGlyphIcon({ className }: { className?: string }) {
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
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

/** 右侧附件栏：各类型均展示缩略图（与 CardGallery 同一套媒体解析） */
function attachmentCaption(item: NoteMediaItem, fileFallback: string): string {
  return item.name?.trim() || fileLabelFromUrl(item.url, fileFallback);
}

function CardPageAttachmentThumb({
  item,
}: {
  item: NoteMediaItem;
}) {
  const thumbClass = "card-page__attachment-thumb";

  let thumb: ReactNode;
  if (item.kind === "image") {
    thumb = <CardPageAttachmentImage item={item} className={thumbClass} />;
  } else if (item.kind === "video") {
    thumb = (
      <MediaThumbVideo
        url={item.url}
        thumbnailUrl={item.thumbnailUrl}
        coverUrl={item.coverUrl}
        className={`${thumbClass} card__gallery-thumb card__gallery-thumb--video`}
        playBadge
        videoPreload="metadata"
        thumbImagePriority={false}
      />
    );
  } else if (item.kind === "audio") {
    const cover = (item.coverUrl ?? item.thumbnailUrl)?.trim();
    thumb = cover ? (
      <MediaThumbImage url={cover} className={thumbClass} alt="" />
    ) : (
      <div className="card-page__attachment-thumb-fallback">
        <AudioGlyphIcon className="card-page__attachment-kind-icon" />
      </div>
    );
  } else {
    const t = item.thumbnailUrl?.trim();
    thumb = t ? (
      <MediaThumbImage url={t} className={thumbClass} alt="" />
    ) : (
      <div className="card-page__attachment-thumb-fallback">
        <FileDocIcon className="card-page__attachment-kind-icon" />
      </div>
    );
  }

  return (
    <span className="card-page__attachment-thumb-wrap">{thumb}</span>
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
  setCardTitle: (cardId: string, title: string) => void;
  setCardTags: (colId: string, cardId: string, tags: string[]) => void;
  setCardCustomProps: (cardId: string, props: CardProperty[]) => void;
  setReminderPicker: Dispatch<SetStateAction<ReminderPickerTarget | null>>;
  setRelatedPanel: Dispatch<
    SetStateAction<{ colId: string; cardId: string } | null>
  >;
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
  /** 从某一合集移除当前笔记的一条归属（与标签上的 × 一致） */
  onRemoveCardFromCollection?: (placementColId: string) => void;
  /** 将附件移到 media 首位作为轮播封面；与 CardGallery 右键「设为封面」一致 */
  setCardMediaCoverItem?: (
    colId: string,
    cardId: string,
    item: NoteMediaItem
  ) => void;
  /** 与侧栏「隐藏合集圆点」一致 */
  hideCollectionDots?: boolean;
  /** 笔记详情：标签式「合集」栏添加归属（与 ⋯ 添加至合集逻辑一致） */
  onAddCardPlacement?: (targetColId: string) => void | Promise<void>;
  /** 云端：附件右键创建文件卡 */
  onCreateFileCardFromAttachment?: (item: NoteMediaItem) => void;
  attachmentHasLinkedFileCard?: (item: NoteMediaItem) => boolean;
  /** 已有文件卡时点击直接打开卡片页 */
  onOpenFileCard?: (item: NoteMediaItem) => boolean;
  /** 打开属性面板中链到的人物卡（如作者 → person） */
  onOpenLinkedCard?: (targetColId: string, targetCardId: string) => void;
  /** 属性面板：cardLink 搜索无结果时直接创建目标卡片 */
  onCreateLinkedCard?: (params: {
    title: string;
    targetCollectionId?: string;
    targetPresetTypeId?: string;
    targetObjectKind?: string;
  }) => Promise<{ colId: string; cardId: string } | null>;
  /** 云端：自动建卡请求成功后拉取合集树（刷新 custom_props / 关联） */
  onAfterRemoteAutoLink?: () => Promise<void>;
  /** 全页删除当前卡片（移入回收站） */
  onDeleteCard?: () => void;
}

function PropValueEditor({
  prop,
  canEdit,
  onChangeValue,
  onChangeSeedTitle,
  onChangeOptions,
  collections,
  hideCollectionDots = false,
  linkFillRef = null,
  cardLinkCreateTarget = null,
  onCreateLinkedCard,
  onOpenLinkedCard,
}: {
  prop: CardProperty;
  canEdit: boolean;
  onChangeValue: (v: CardProperty["value"]) => void;
  onChangeSeedTitle?: (v: string | null) => void;
  onChangeOptions: (opts: CardPropertyOption[]) => void;
  collections: Collection[];
  hideCollectionDots?: boolean;
  /** cardLink：可从图谱边一键填入（如 creator） */
  linkFillRef?: { colId: string; cardId: string } | null;
  cardLinkCreateTarget?: {
    targetCollectionId?: string;
    targetPresetTypeId?: string;
    targetObjectKind?: string;
  } | null;
  onCreateLinkedCard?: (params: {
    title: string;
    targetCollectionId?: string;
    targetPresetTypeId?: string;
    targetObjectKind?: string;
  }) => Promise<{ colId: string; cardId: string } | null>;
  onOpenLinkedCard?: (colId: string, cardId: string) => void;
}) {
  const ui = useAppChrome();
  const { lang } = useAppUiLang();
  const [cardLinkPickerOpen, setCardLinkPickerOpen] = useState(false);
  const [cardLinkQuery, setCardLinkQuery] = useState("");
  const [cardLinkCreateBusy, setCardLinkCreateBusy] = useState(false);
  const cardLinkPickerRef = useRef<HTMLDivElement>(null);

  const cardLinkOptions = useMemo(() => {
    const q = cardLinkQuery.trim().toLowerCase();
    const seen = new Set<string>();
    const out: Array<{
      colId: string;
      cardId: string;
      title: string;
      path: string;
    }> = [];
    for (const { col, path } of walkCollectionsWithPath(collections, [])) {
      for (const card of col.cards ?? []) {
        const title = cardDisplayLabel(card).trim() || card.id;
        const key = `${col.id}\t${card.id}`;
        if (seen.has(key)) continue;
        if (q) {
          const hay = `${title}\n${path}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        seen.add(key);
        out.push({ colId: col.id, cardId: card.id, title, path });
      }
    }
    return out.slice(0, 80);
  }, [collections, cardLinkQuery]);

  useEffect(() => {
    if (!cardLinkPickerOpen) return;
    const onDown = (e: PointerEvent) => {
      if (cardLinkPickerRef.current?.contains(e.target as Node)) return;
      setCardLinkPickerOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [cardLinkPickerOpen]);

  async function handleCreateLinkedCard() {
    const title = cardLinkQuery.trim();
    if (!title || !onCreateLinkedCard || cardLinkCreateBusy) return;
    setCardLinkCreateBusy(true);
    try {
      const created = await onCreateLinkedCard({
        title,
        ...(cardLinkCreateTarget?.targetCollectionId
          ? { targetCollectionId: cardLinkCreateTarget.targetCollectionId }
          : {}),
        ...(cardLinkCreateTarget?.targetPresetTypeId
          ? { targetPresetTypeId: cardLinkCreateTarget.targetPresetTypeId }
          : {}),
        ...(cardLinkCreateTarget?.targetObjectKind
          ? { targetObjectKind: cardLinkCreateTarget.targetObjectKind }
          : {}),
      });
      if (!created) {
        window.alert(
          lang === "en"
            ? "Could not create the linked card right now."
            : "暂时无法创建这张关联卡片。"
        );
        return;
      }
      onChangeValue({ colId: created.colId, cardId: created.cardId });
      onChangeSeedTitle?.(title);
      setCardLinkPickerOpen(false);
      setCardLinkQuery("");
    } finally {
      setCardLinkCreateBusy(false);
    }
  }

  if (!canEdit) {
    if (prop.type === "checkbox") {
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          {prop.value ? (
            <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
              ✓
            </span>
          ) : (
            <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
              —
            </span>
          )}
        </div>
      );
    }
    if (prop.type === "choice") {
      const vals = Array.isArray(prop.value)
        ? (prop.value as string[])
        : [];
      return (
        <CardPageTagsPanel
          cardId={prop.id}
          tags={vals}
          tagOptions={[]}
          canEdit={false}
          onCommit={() => {}}
          getPillStyle={(t) => choicePillStyle(t)}
          chipShape="rect"
        />
      );
    }
    if (prop.type === "collectionLink") {
      const ids = collectionLinkIds(prop.value);
      return (
        <CardPageCollectionTagsPanel
          instanceId={prop.id}
          collections={collections}
          selectedCollectionIds={ids}
          pickerExcludeIds={new Set()}
          canEdit={false}
          onAdd={() => {}}
          onRemove={() => {}}
          addInputPlaceholder=""
          dropdownEmptyText=""
          dropdownAriaLabel=""
          removePillAriaLabel={() => ""}
          unknownLabel={ui.propUnknownCollection}
          chipShape="rect"
        />
      );
    }
    if (prop.type === "cardLinks") {
      const refs = parseCardLinkRefList(prop.value);
      const seed = cardLinkSeedTitleText(prop);
      if (refs.length === 0) {
        return (
          <div className="card-page__tags-panel card-page__tags-panel--single-hit">
            {seed ? (
              <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
                {seed}
              </span>
            ) : (
              <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
                —
              </span>
            )}
          </div>
        );
      }
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          <div className="card-page__prop-cardlinks-list">
            {refs.map((ref) =>
              onOpenLinkedCard ? (
                <button
                  key={`${ref.colId}-${ref.cardId}`}
                  type="button"
                  className="card-page__tags-hit-btn card-page__prop-author-link"
                  onClick={() => onOpenLinkedCard(ref.colId, ref.cardId)}
                >
                  {cardLinkDisplayLabel(collections, ref)}
                </button>
              ) : (
                <span
                  key={`${ref.colId}-${ref.cardId}`}
                  className="card-page__prop-val-text card-page__prop-val-text--tags-panel"
                >
                  {cardLinkDisplayLabel(collections, ref)}
                </span>
              )
            )}
          </div>
        </div>
      );
    }
    if (prop.type === "cardLink") {
      const ref = parseCardLinkRef(prop.value);
      const seed = cardLinkSeedTitleText(prop);
      if (!ref) {
        if (seed) {
          return (
            <div className="card-page__tags-panel card-page__tags-panel--single-hit">
              <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
                {seed}
              </span>
            </div>
          );
        }
        return (
          <div className="card-page__tags-panel card-page__tags-panel--single-hit">
            <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
              —
            </span>
          </div>
        );
      }
      const linkLabel = cardLinkDisplayLabel(collections, ref);
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          <div className="card-page__prop-cardlink-row">
            {seed ? (
              <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel card-page__prop-cardlink-text">
                {seed}
              </span>
            ) : null}
            {onOpenLinkedCard ? (
              <button
                type="button"
                className="card-page__tags-hit-btn card-page__prop-author-link card-page__prop-cardlink-side"
                onClick={() => onOpenLinkedCard(ref.colId, ref.cardId)}
              >
                {linkLabel}
              </button>
            ) : (
              <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel card-page__prop-cardlink-side">
                {linkLabel}
              </span>
            )}
          </div>
        </div>
      );
    }
    if (prop.type === "date") {
      const text = formatDatePropDisplay(prop.value);
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          {text ? (
            <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
              {text}
            </span>
          ) : (
            <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
              —
            </span>
          )}
        </div>
      );
    }
    if (prop.type === "url") {
      const raw = typeof prop.value === "string" ? prop.value.trim() : "";
      if (!raw) {
        return (
          <div className="card-page__tags-panel card-page__tags-panel--single-hit">
            <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
              —
            </span>
          </div>
        );
      }
      const href = safeHttpHrefFromPropValue(raw);
      if (!href) {
        return (
          <div className="card-page__tags-panel card-page__tags-panel--single-hit">
            <span
              className="card-page__tags-hit-btn card-page__tags-hit-btn--readonly-text"
              title={raw}
            >
              {raw}
            </span>
          </div>
        );
      }
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          <a
            className="card-page__prop-val-link card-page__prop-val-link--tags-panel"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={raw}
          >
            {raw}
          </a>
        </div>
      );
    }
    if (isDurationSecondsProp(prop)) {
      const text = formatDurationHms(prop.value);
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
            {text}
          </span>
        </div>
      );
    }
    const empty = prop.value == null || prop.value === "";
    return (
      <div className="card-page__tags-panel card-page__tags-panel--single-hit">
        {empty ? (
          <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
            —
          </span>
        ) : (
          <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
            {String(prop.value)}
          </span>
        )}
      </div>
    );
  }

  if (prop.type === "checkbox") {
    return (
      <div className="card-page__tags-panel card-page__tags-panel--single-hit card-page__tags-panel--checkbox">
        <div className="card-page__prop-checkbox-cell">
          <input
            type="checkbox"
            className="card-page__prop-checkbox"
            checked={Boolean(prop.value)}
            onChange={(e) => onChangeValue(e.target.checked)}
          />
        </div>
      </div>
    );
  }

  if (prop.type === "choice") {
    return (
      <CardPageTagsPanel
        cardId={prop.id}
        tags={Array.isArray(prop.value) ? (prop.value as string[]) : []}
        tagOptions={(prop.options ?? []).map((o) => o.name)}
        canEdit
        chipShape="rect"
        getPillStyle={(t) => choicePillStyle(t)}
        addInputPlaceholder="添加选项…"
        dropdownEmptyText="暂无可选项；输入新名称后回车添加"
        dropdownAriaLabel="选择项候选"
        removePillAriaLabel={(t) => `移除选项 ${t}`}
        onCommit={(tags) => {
          onChangeValue(tags.length ? tags : null);
          const opts = prop.options ?? [];
          const names = new Set(opts.map((o) => o.name));
          const next = [...opts];
          for (const t of tags) {
            if (!names.has(t)) {
              next.push({ id: genId(), name: t, color: "#e0e0e0" });
              names.add(t);
            }
          }
          if (next.length !== opts.length) {
            onChangeOptions(next);
          }
        }}
      />
    );
  }

  if (prop.type === "collectionLink") {
    const ids = collectionLinkIds(prop.value);
    const exclude = new Set([...ids, LOOSE_NOTES_COLLECTION_ID]);
    return (
      <CardPageCollectionTagsPanel
        instanceId={prop.id}
        collections={collections}
        selectedCollectionIds={ids}
        pickerExcludeIds={exclude}
        canEdit
        hideCollectionDots={hideCollectionDots}
        onAdd={(cid) => {
          if (ids.includes(cid)) return;
          onChangeValue([...ids, cid]);
        }}
        onRemove={(cid) => {
          const next = ids.filter((x) => x !== cid);
          onChangeValue(next.length ? next : null);
        }}
        addInputPlaceholder={ui.cardCollectionTagInputPlaceholder}
        dropdownEmptyText={ui.cardCollectionTagDropdownEmpty}
        dropdownAriaLabel={ui.cardCollectionTagDropdownAria}
        removePillAriaLabel={ui.propCollectionLinkRemoveAria}
        unknownLabel={ui.propUnknownCollection}
        chipShape="rect"
      />
    );
  }

  if (prop.type === "cardLinks") {
    return (
      <CardLinksValueEditor
        prop={prop}
        collections={collections}
        onChangeValue={onChangeValue}
        onChangeSeedTitle={onChangeSeedTitle}
        onOpenLinkedCard={onOpenLinkedCard}
      />
    );
  }

  if (prop.type === "cardLink") {
    const ref = parseCardLinkRef(prop.value);
    const seed = cardLinkSeedTitleText(prop);
    const linkLabel = ref ? cardLinkDisplayLabel(collections, ref) : "";
    const showFillFromEdge =
      Boolean(
        linkFillRef?.colId &&
          linkFillRef?.cardId &&
          (!ref ||
            ref.cardId !== linkFillRef.cardId ||
            ref.colId !== linkFillRef.colId)
      );
    return (
      <div className="card-page__tags-panel card-page__tags-panel--single-hit">
        <div className="card-page__prop-cardlink-row">
          <div className="card-page__prop-text-edit-row card-page__prop-cardlink-main">
            <input
              type="text"
              className="card-page__tags-add-input card-page__tags-add-input--prop-field"
              placeholder="填写文字…"
              defaultValue={seed}
              onBlur={(e) => {
                const next = e.target.value.trim();
                onChangeSeedTitle?.(next || null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          {ref && onOpenLinkedCard ? (
            <button
              type="button"
              className="card-page__tags-hit-btn card-page__prop-author-link card-page__prop-cardlink-side"
              onClick={() => onOpenLinkedCard(ref.colId, ref.cardId)}
            >
              {linkLabel}
            </button>
          ) : ref ? (
            <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel card-page__prop-cardlink-side">
              {linkLabel}
            </span>
          ) : (
            <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel card-page__prop-cardlink-side">
              —
            </span>
          )}
          <div
            className="card-page__prop-cardlink-picker"
            ref={cardLinkPickerRef}
          >
            <button
              type="button"
              className="card-page__prop-cardlink-pick"
              onClick={() =>
                setCardLinkPickerOpen((v) => {
                  const next = !v;
                  if (!next) setCardLinkQuery("");
                  return next;
                })
              }
            >
              {lang === "en" ? "Select card" : "选择卡片"}
            </button>
            {cardLinkPickerOpen ? (
              <div className="card-page__tags-dropdown card-page__prop-cardlink-dropdown">
                <input
                  type="text"
                  className="card-page__tags-add-input card-page__prop-cardlink-search"
                  value={cardLinkQuery}
                  onChange={(e) => setCardLinkQuery(e.target.value)}
                  placeholder={lang === "en" ? "Search cards…" : "搜索卡片…"}
                  autoFocus
                />
                {cardLinkOptions.length > 0 ? (
                  cardLinkOptions.map((opt) => (
                    <button
                      key={`${opt.colId}-${opt.cardId}`}
                      type="button"
                      className={
                        "card-page__tags-dropdown-item" +
                        (ref &&
                        ref.colId === opt.colId &&
                        ref.cardId === opt.cardId
                          ? " is-active"
                          : "")
                      }
                      onClick={() => {
                        onChangeValue({
                          colId: opt.colId,
                          cardId: opt.cardId,
                        });
                        setCardLinkPickerOpen(false);
                        setCardLinkQuery("");
                      }}
                    >
                      <span className="card-page__prop-cardlink-option-main">
                        {opt.title}
                      </span>
                      <span className="card-page__prop-cardlink-option-sub">
                        {opt.path}
                      </span>
                    </button>
                  ))
                ) : (
                  <>
                    <div className="card-page__tags-dropdown-empty">
                      {lang === "en" ? "No matching cards." : "没有匹配的卡片。"}
                    </div>
                    {cardLinkQuery.trim() && onCreateLinkedCard ? (
                      <button
                        type="button"
                        className="card-page__tags-dropdown-item"
                        onClick={() => {
                          void handleCreateLinkedCard();
                        }}
                        disabled={cardLinkCreateBusy}
                      >
                        <span className="card-page__prop-cardlink-option-main">
                          {cardLinkCreateBusy
                            ? lang === "en"
                              ? "Creating..."
                              : "创建中..."
                            : lang === "en"
                              ? `Create "${cardLinkQuery.trim()}"`
                              : `创建“${cardLinkQuery.trim()}”`}
                        </span>
                        <span className="card-page__prop-cardlink-option-sub">
                          {lang === "en"
                            ? "Create and link a new card directly"
                            : "直接新建卡片并写入当前关联"}
                        </span>
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          {ref ? (
            <button
              type="button"
              className="card-page__prop-cardlink-clear"
              title="清除关联"
              aria-label="清除关联"
              onClick={() => onChangeValue(null)}
            >
              ×
            </button>
          ) : null}
          {showFillFromEdge && linkFillRef ? (
            <button
              type="button"
              className="card-page__prop-cardlink-fill"
              onClick={() =>
                onChangeValue({
                  colId: linkFillRef.colId,
                  cardId: linkFillRef.cardId,
                })
              }
            >
              填入关联
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (prop.type === "date") {
    const strValue = typeof prop.value === "string" ? prop.value : "";
    return (
      <div className="card-page__tags-panel card-page__tags-panel--single-hit">
        <DatePropPopover
          value={strValue}
          onChange={(next) => onChangeValue(next)}
          className="card-page__prop-datetime-popover"
        />
      </div>
    );
  }

  if (prop.type === "number") {
    if (isDurationSecondsProp(prop)) {
      return (
        <div className="card-page__tags-panel card-page__tags-panel--single-hit">
          <span className="card-page__prop-val-text card-page__prop-val-text--tags-panel">
            {formatDurationHms(prop.value)}
          </span>
        </div>
      );
    }
    return (
      <div className="card-page__tags-panel card-page__tags-panel--single-hit">
        <input
          type="number"
          className="card-page__tags-add-input card-page__tags-add-input--prop-field"
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
      </div>
    );
  }

  if (prop.type === "url") {
    const strVal = typeof prop.value === "string" ? prop.value : "";
    const openHref = safeHttpHrefFromPropValue(strVal);
    return (
      <div className="card-page__tags-panel card-page__tags-panel--single-hit">
        <div className="card-page__prop-url-edit-row card-page__prop-url-edit-row--tags-plain">
          <input
            type="url"
            className="card-page__tags-add-input card-page__tags-add-input--url-field"
            placeholder="https://…"
            defaultValue={strVal}
            onBlur={(e) => onChangeValue(e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          {openHref ? (
            <a
              className="card-page__prop-url-external"
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              title={ui.uiOpenInNewWindow}
              aria-label={ui.uiOpenInNewWindow}
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="card-page__tags-panel card-page__tags-panel--single-hit">
      <input
        type="text"
        className="card-page__tags-add-input card-page__tags-add-input--prop-field"
        placeholder="—"
        defaultValue={typeof prop.value === "string" ? prop.value : ""}
        onBlur={(e) => onChangeValue(e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
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
  setCardTitle,
  setCardTags,
  setCardCustomProps,
  setReminderPicker,
  uploadFilesToCard,
  removeCardMediaItem,
  setCardMediaCoverItem,
  hideCollectionDots = false,
  onRemoveCardFromCollection,
  onAddCardPlacement,
  onCreateFileCardFromAttachment,
  onOpenFileCard,
  onOpenLinkedCard,
  onCreateLinkedCard,
  onAfterRemoteAutoLink,
  onDeleteCard,
}: CardPageViewProps) {
  const { lang } = useAppUiLang();
  const ui = useAppChrome();
  /** 与主站 narrowUi / MOBILE_CHROME 一致：小屏全页改为纵向叠放，避免固定侧栏挤扁正文 */
  const compactLayout = useSyncExternalStore(
    subscribeCardPageCompactLayout,
    () => matchesMobileChromeMedia(),
    () => false
  );
  /** 顶栏：对象卡主标题（人物名 / 剪藏标题 / 文件名等），普通笔记不占用避免与正文重复 */
  const cardPageHeaderTitle = useMemo(() => {
    const kind = card.objectKind ?? "note";
    if (kind === "note") return "";
    return cardHeadlinePlain(card).trim();
  }, [card]);
  /** 所有卡片(笔记/文件/人物/剪藏/...)的属性面板用同一套卡片式样式;
   *  原 --file-card modifier 已下沉到基类。 */
  const propsPanelInnerClassName = "card-page__props-panel-inner";
  const showTocPanel = !isFileCard(card);
  /** 小屏：软键盘占位时隐藏底部附件栏（visualViewport 与 layout viewport 高度差） */
  const [compactKeyboardHidesAttachments, setCompactKeyboardHidesAttachments] =
    useState(false);
  /** 小屏可编辑：焦点在正文编辑区（含工具栏）时隐藏附件，打字即生效、不必等键盘动画 */
  const [compactEditorAreaFocused, setCompactEditorAreaFocused] =
    useState(false);
  /** 小屏：标题栏「属性 / 目录」打开侧栏抽屉 */
  const [mobileOverlay, setMobileOverlay] = useState<
    null | "toc" | "props"
  >(null);
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null);
  const [attachMenu, setAttachMenu] = useState<{
    x: number;
    y: number;
    item: NoteMediaItem;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentDropDepthRef = useRef(0);
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const cardPageRootRef = useRef<HTMLDivElement>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const typePickerRef = useRef<HTMLDivElement>(null);
  const [propsPanelOpen, setPropsPanelOpen] = useState(true);
  const [effectiveSchema, setEffectiveSchema] = useState<{
    fields: SchemaField[];
    autoLinkRules: AutoLinkRule[];
  } | null | undefined>(undefined);
  const [tocPanelOpen, setTocPanelOpen] = useState(true);
  const [tocActiveIndex, setTocActiveIndex] = useState(0);
  const [rerunAutoLinkBusy, setRerunAutoLinkBusy] = useState(false);
  const [rerunAutoLinkMessage, setRerunAutoLinkMessage] = useState<
    string | null
  >(null);
  const [propLinkTargetMenu, setPropLinkTargetMenu] = useState<{
    propId: string;
    x: number;
    y: number;
  } | null>(null);
  const [propLinkTargetQuery, setPropLinkTargetQuery] = useState("");
  const mediaMetaPersistAttemptedRef = useRef<Set<string>>(new Set());
  const cardTitleEditableRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = cardTitleEditableRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const next = card.title ?? "";
    if (el.textContent !== next) el.textContent = next;
  }, [card.title, card.id]);

  const PROPS_WIDTH_KEY = "cardnote-card-page-props-width";
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
  const cardLinkTargetCollectionOptions = useMemo(
    () =>
      walkCollectionsWithPath(collections, []).map(({ col, path }) => ({
        id: col.id,
        label: collectionPathDisplayLabel(path, col.name),
      })),
    [collections]
  );

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

  const customPropsKey = useMemo(
    () => JSON.stringify(card.customProps ?? []),
    [card.customProps]
  );
  const customProps = useMemo(
    () => migrateCustomPropsList(card.customProps ?? []),
    [customPropsKey]
  );
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  /** 侧栏不展示「未归类」；详情里也不出 chip，避免与真实用户合集并列造成困惑 */
  const colIds = [
    ...collectionIdsContainingCardId(collections, card.id),
  ].filter((id) => id !== LOOSE_NOTES_COLLECTION_ID);
  const placementPickerExclude = useMemo(
    () => collectionIdsContainingCardId(collections, card.id),
    [collections, card.id]
  );
  const fallbackSchemaFields = useMemo(() => {
    const placementIds = [
      colId,
      ...collectionIdsContainingCardId(collections, card.id),
    ].filter((id) => id && id !== LOOSE_NOTES_COLLECTION_ID);
    return computeFallbackSchemaFieldsFromPlacements(collections, placementIds);
  }, [collections, card.id, colId]);
  /* flag on 时走 /api/tags；flag off 或失败则本地遍历兜底 */
  const tagLibrary = useTagsLibrary(collections);
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

  useEffect(() => {
    const normalizeStableMediaUrl = (v: string | undefined): string => {
      const s = (v ?? "").trim();
      if (!s) return "";
      const lower = s.toLowerCase();
      // 不把临时签名 URL 回写数据库，避免过期
      if (
        lower.includes("x-amz-signature=") ||
        lower.includes("x-amz-security-token=") ||
        lower.includes("x-cos-signature=") ||
        lower.includes("x-cos-security-token=") ||
        lower.includes("signature=")
      ) {
        return "";
      }
      return s;
    };

    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      const needDur =
        (item.kind === "video" || item.kind === "audio") &&
        !(
          typeof item.durationSec === "number" &&
          Number.isFinite(item.durationSec) &&
          item.durationSec >= 0
        );
      const needRes =
        (item.kind === "video" || item.kind === "image") &&
        !(
          typeof item.widthPx === "number" &&
          typeof item.heightPx === "number" &&
          Number.isFinite(item.widthPx) &&
          Number.isFinite(item.heightPx) &&
          item.widthPx > 0 &&
          item.heightPx > 0 &&
          item.widthPx <= 32767 &&
          item.heightPx <= 32767
        );
      const needThumb = !((item.thumbnailUrl ?? "").trim()) && (item.kind === "image" || item.kind === "video");
      if (!needDur && !needRes && !needThumb) continue;
      const key = `${card.id}:${i}:${item.url}:${needDur ? "d" : ""}${needRes ? "r" : ""}${needThumb ? "t" : ""}`;
      if (mediaMetaPersistAttemptedRef.current.has(key)) continue;
      mediaMetaPersistAttemptedRef.current.add(key);
      void (async () => {
        try {
          let src = resolveMediaUrl(item.url);
          if (needsCosReadUrl(src)) {
            src = await resolveCosMediaUrlIfNeeded(src);
          }
          if (!src) return;
          const patch: {
            durationSec?: number;
            widthPx?: number;
            heightPx?: number;
            thumbnailUrl?: string;
          } = {};
          if (needThumb) {
            const fallbackThumb = normalizeStableMediaUrl(
              item.coverUrl || (item.kind === "image" ? item.url : "")
            );
            if (fallbackThumb) {
              patch.thumbnailUrl = fallbackThumb;
            }
          }
          if (item.kind === "image" && needRes) {
            const dim = await new Promise<{ w: number; h: number } | null>((resolve) => {
              const img = new Image();
              img.onload = () =>
                resolve({
                  w: Number(img.naturalWidth) || 0,
                  h: Number(img.naturalHeight) || 0,
                });
              img.onerror = () => resolve(null);
              img.src = src;
            });
            if (
              dim &&
              dim.w > 0 &&
              dim.h > 0 &&
              dim.w <= 32767 &&
              dim.h <= 32767
            ) {
              patch.widthPx = Math.round(dim.w);
              patch.heightPx = Math.round(dim.h);
            }
          } else if (item.kind === "video" || item.kind === "audio") {
            const meta = await new Promise<{ d: number; w: number; h: number } | null>(
              (resolve) => {
                const el = document.createElement(item.kind === "audio" ? "audio" : "video");
                el.preload = "metadata";
                el.src = src;
                const done = (v: { d: number; w: number; h: number } | null) => {
                  el.removeAttribute("src");
                  el.load();
                  resolve(v);
                };
                el.onloadedmetadata = () =>
                  done({
                    d: Number(el.duration) || NaN,
                    w: Number((el as HTMLVideoElement).videoWidth) || 0,
                    h: Number((el as HTMLVideoElement).videoHeight) || 0,
                  });
                el.onerror = () => done(null);
              }
            );
            if (meta) {
              if (needDur && Number.isFinite(meta.d) && meta.d >= 0) {
                patch.durationSec = Math.min(86400000, Math.round(meta.d));
              }
              if (
                item.kind === "video" &&
                needRes &&
                meta.w > 0 &&
                meta.h > 0 &&
                meta.w <= 32767 &&
                meta.h <= 32767
              ) {
                patch.widthPx = Math.round(meta.w);
                patch.heightPx = Math.round(meta.h);
              }
            }
          }
          if (Object.keys(patch).length === 0) return;
          void patchCardMediaItemApi(card.id, i, patch);
        } catch {
          // ignore metadata probe failures
        }
      })();
    }
  }, [card.id, media]);

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

  /** 小屏全页：空白处双击 / 双次轻点收起键盘（不误伤双击选词、工具栏与按钮） */
  const scheduleBlurEditorIfNoWordSelection = useCallback(() => {
    const pm = editorAreaRef.current?.querySelector(
      ".ProseMirror"
    ) as HTMLElement | null;
    if (!pm) return;
    const ae = document.activeElement;
    if (!(ae instanceof HTMLElement) || !pm.contains(ae)) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ae2 = document.activeElement;
        if (!(ae2 instanceof HTMLElement) || !pm.contains(ae2)) return;
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) return;
        ae2.blur();
      });
    });
  }, []);

  const onCardPageDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!compactLayout || !canEdit) return;
      if (!gestureTargetAllowsBlankDismiss(e.target as HTMLElement | null))
        return;
      scheduleBlurEditorIfNoWordSelection();
    },
    [compactLayout, canEdit, scheduleBlurEditorIfNoWordSelection]
  );

  useEffect(() => {
    if (!compactLayout || !canEdit) return;
    const root = cardPageRootRef.current;
    if (!root) return;

    let lastEnd = 0;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    const MOVE_PX = 14;
    const DOUBLE_MS = 380;
    const DOUBLE_DIST = 44;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      moved = false;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (Math.hypot(x - lastX, y - lastY) > MOVE_PX) moved = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      if (moved) {
        lastEnd = 0;
        return;
      }
      const now = Date.now();
      const x = touch.clientX;
      const y = touch.clientY;
      const isDouble =
        lastEnd > 0 &&
        now - lastEnd < DOUBLE_MS &&
        Math.hypot(x - lastX, y - lastY) < DOUBLE_DIST;
      lastEnd = now;
      lastX = x;
      lastY = y;
      if (!isDouble) return;
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!gestureTargetAllowsBlankDismiss(el)) return;
      scheduleBlurEditorIfNoWordSelection();
    };

    const onTouchCancel = () => {
      lastEnd = 0;
      moved = false;
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: true });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [compactLayout, canEdit, card.id, scheduleBlurEditorIfNoWordSelection]);

  /** 小屏全页：正文区向下滚动时收起键盘（失焦 ProseMirror） */
  useEffect(() => {
    if (!compactLayout || !canEdit) return;
    const root = editorAreaRef.current;
    if (!root) return;

    let detachScroll: (() => void) | null = null;
    let detachTouch: (() => void) | null = null;
    let pmEl: HTMLElement | null = null;
    let lastScrollTop = 0;
    /** 累计向下滚动：iOS 快速滑时常连续多帧小增量，单帧小于约 12px 会永远不收键盘 */
    let accScrollDown = 0;

    const blurEditorIfFocused = (pm: HTMLElement) => {
      const ae = document.activeElement;
      if (!(ae instanceof HTMLElement)) return;
      if (!pm.contains(ae)) return;
      ae.blur();
      accScrollDown = 0;
    };

    const bind = (pm: HTMLElement) => {
      detachScroll?.();
      pmEl = pm;
      lastScrollTop = pm.scrollTop;
      accScrollDown = 0;
      const onScroll = () => {
        const t = pm.scrollTop;
        const delta = t - lastScrollTop;
        lastScrollTop = t;
        if (delta <= 0) {
          accScrollDown = 0;
          return;
        }
        accScrollDown += delta;
        if (accScrollDown < 6) return;
        blurEditorIfFocused(pm);
      };
      pm.addEventListener("scroll", onScroll, { passive: true });
      detachScroll = () => {
        pm.removeEventListener("scroll", onScroll);
        detachScroll = null;
      };
    };

    /** 手指快速上划（内容向下滚）时尽早失焦，不必等 scrollTop 追上 */
    let touchY0: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY0 = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY0 == null) return;
      const y = e.touches[0]?.clientY;
      if (y == null) return;
      if (touchY0 - y < 20) return;
      const pm = root.querySelector(".ProseMirror") as HTMLElement | null;
      if (pm) blurEditorIfFocused(pm);
      touchY0 = y;
    };
    const onTouchEnd = () => {
      touchY0 = null;
    };
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: true });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchEnd, { passive: true });
    detachTouch = () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      detachTouch = null;
    };

    const sync = () => {
      const pm = root.querySelector(".ProseMirror") as HTMLElement | null;
      if (pm === pmEl) return;
      detachScroll?.();
      pmEl = pm;
      if (pm) bind(pm);
    };

    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      detachScroll?.();
      detachTouch?.();
    };
  }, [compactLayout, canEdit, card.id]);

  useEffect(() => {
    if (!compactLayout) {
      setCompactKeyboardHidesAttachments(false);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    const KEYBOARD_HEIGHT_DELTA_PX = 72;

    const sync = () => {
      const delta = window.innerHeight - vv.height;
      setCompactKeyboardHidesAttachments(delta > KEYBOARD_HEIGHT_DELTA_PX);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [compactLayout]);

  useEffect(() => {
    if (!compactLayout || !canEdit) {
      setCompactEditorAreaFocused(false);
      return;
    }
    const root = editorAreaRef.current;
    if (!root) return;

    const contains = (n: EventTarget | null) =>
      n instanceof Node && root.contains(n);

    const onFocusIn = (e: FocusEvent) => {
      if (contains(e.target)) setCompactEditorAreaFocused(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!contains(e.relatedTarget)) setCompactEditorAreaFocused(false);
    };

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      setCompactEditorAreaFocused(false);
    };
  }, [compactLayout, canEdit, card.id]);

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
    if (!compactLayout) setMobileOverlay(null);
  }, [compactLayout]);

  useEffect(() => {
    if (!compactLayout || !mobileOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileOverlay(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [compactLayout, mobileOverlay]);

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
    if (!propLinkTargetMenu) return;
    const onDown = (e: PointerEvent) => {
      const menu = document.querySelector("[data-prop-link-target-menu]");
      if (menu?.contains(e.target as Node)) return;
      setPropLinkTargetMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPropLinkTargetMenu(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [propLinkTargetMenu]);

  const filteredCardLinkTargetCollectionOptions = useMemo(() => {
    const q = propLinkTargetQuery.trim().toLowerCase();
    if (!q) return cardLinkTargetCollectionOptions;
    return cardLinkTargetCollectionOptions.filter((opt) =>
      opt.label.toLowerCase().includes(q)
    );
  }, [cardLinkTargetCollectionOptions, propLinkTargetQuery]);

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

  useEffect(() => {
    const raw = card.customProps ?? [];
    const normalized = migrateCustomPropsList(raw);
    if (JSON.stringify(raw) === JSON.stringify(normalized)) return;
    setCardCustomProps(card.id, normalized);
  }, [card.id, customPropsKey, setCardCustomProps]);

  // 拉取当前卡片在所有合集（含父链）上的合并有效 Schema
  useEffect(() => {
    let cancelled = false;
    setEffectiveSchema(undefined);
    fetchCardEffectiveSchema(card.id).then((s) => {
      if (!cancelled) setEffectiveSchema(s);
    });
    return () => { cancelled = true; };
  }, [card.id]);

  /** 文件卡：服务端 schema 可能尚未含父级「标题」时，补一条便于展示与编辑 */
  const schemaFieldsForPanel = useMemo(() => {
    const remoteFields =
      effectiveSchema && Array.isArray(effectiveSchema.fields)
        ? effectiveSchema.fields
        : [];
    const map = new Map<string, SchemaField>();
    const identitySeen = new Set<string>();
    for (const f of remoteFields) {
      if (!f?.id?.trim()) continue;
      map.set(f.id, f);
      const ident = schemaFieldIdentityKey(f);
      if (ident !== `${f.type}::`) identitySeen.add(ident);
    }
    for (const f of fallbackSchemaFields) {
      if (!f?.id?.trim()) continue;
      const ident = schemaFieldIdentityKey(f);
      if (!map.has(f.id) && ident !== `${f.type}::` && identitySeen.has(ident)) {
        continue;
      }
      map.set(f.id, f);
      if (ident !== `${f.type}::`) identitySeen.add(ident);
    }
    const fields =
      map.size > 0
        ? [...map.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [];
    if (!isFileCard(card)) return fields;
    const hiddenFileMetaFieldIds = new Set([
      "sf-vid-duration-sec",
      "sf-aud-duration-sec",
      "sf-vid-resolution",
      "sf-file-resolution",
    ]);
    return fields.filter((f) => !hiddenFileMetaFieldIds.has(f.id));
  }, [effectiveSchema, fallbackSchemaFields, card]);

  useEffect(() => {
    const raw = card.customProps ?? [];
    const migrated = migrateCustomPropsList(raw);
    const normalized = normalizeCustomPropsAgainstSchema(
      migrated,
      schemaFieldsForPanel,
      collections
    );
    const merged = mergeLegacyNamedPropsIntoSchema(
      normalized,
      schemaFieldsForPanel
    );
    if (JSON.stringify(raw) === JSON.stringify(merged)) return;
    setCardCustomProps(card.id, merged);
  }, [
    card.id,
    customPropsKey,
    schemaFieldsForPanel,
    collections,
    setCardCustomProps,
  ]);

  function updateCustomProps(next: CardProperty[]) {
    setCardCustomProps(card.id, migrateCustomPropsList(next));
  }

  function upsertCardLinkTargetForProp(
    propId: string,
    meta: { name: string; type: CardPropertyType; options?: CardPropertyOption[] },
    targetCollectionId?: string
  ) {
    const nextTargetId = targetCollectionId?.trim() ?? "";
    const found = customProps.find((p) => p.id === propId);
    if (found) {
      updateCustomProps(
        customProps.map((p) =>
          p.id === propId
            ? {
                ...p,
                name: meta.name,
                type: meta.type,
                options: meta.options,
                ...(nextTargetId
                  ? { targetCollectionId: nextTargetId }
                  : { targetCollectionId: undefined }),
              }
            : p
        )
      );
      return;
    }
    updateCustomProps([
      ...customProps,
      {
        id: propId,
        name: meta.name,
        type: meta.type,
        value: null,
        options: meta.options,
        ...(nextTargetId ? { targetCollectionId: nextTargetId } : {}),
      },
    ]);
  }

  function openPropLinkTargetMenu(
    event:
      | ReactMouseEvent<HTMLElement>
      | SyntheticEvent<HTMLElement, MouseEvent>,
    propId: string
  ) {
    const native = event.nativeEvent;
    event.preventDefault();
    event.stopPropagation();
    setPropLinkTargetQuery("");
    setPropLinkTargetMenu({
      propId,
      x: native.clientX,
      y: native.clientY,
    });
  }

  async function handleRerunAutoLink() {
    if (!onAfterRemoteAutoLink || rerunAutoLinkBusy) return;
    setRerunAutoLinkMessage(null);
    setRerunAutoLinkBusy(true);
    try {
      const res = await postCardAutoLinkApi(card.id);
      if (res.ok) {
        await onAfterRemoteAutoLink();
        setRerunAutoLinkMessage(ui.cardPageRerunAutoLinkOk);
      } else {
        setRerunAutoLinkMessage(
          ui.cardPageRerunAutoLinkFail(res.error ?? "—")
        );
      }
    } finally {
      setRerunAutoLinkBusy(false);
    }
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

  function renderPropertyTypePickerChrome() {
    if (!canEdit) return null;
    return (
      <div className="card-page__prop-type-picker" ref={typePickerRef}>
        <button
          type="button"
          className="sidebar__section-add"
          onClick={() => setShowTypePicker((v) => !v)}
          aria-label={lang === "en" ? "Add property" : "添加属性"}
        >
          +
        </button>
        {showTypePicker ? (
          <div className="card-page__prop-type-menu">
            {PROP_TYPE_PICKER_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="card-page__prop-type-option"
                onClick={() => addProperty(type)}
              >
                {propTypePickerLabel(type, lang)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderFileMetaBlock() {
    const m = card.media?.[0];
    if (!m) return null;

    function metaRow(label: string, value: string, propId: string) {
      return (
        <div
          className="card-page__prop-row card-page__file-meta-row"
          key={label}
          data-prop-id={propId}
        >
          <span className="card-page__prop-label">{label}</span>
          <div className="card-page__prop-content">
            <span className="card-page__file-meta-val">{value}</span>
          </div>
        </div>
      );
    }

    const ext = (() => {
      const name = m.name?.trim() || m.url;
      const dot = name.lastIndexOf(".");
      return dot > 0 ? name.slice(dot + 1).toUpperCase() : "—";
    })();

    const rows: JSX.Element[] = [];
    rows.push(metaRow(lang === "en" ? "Format" : "格式", ext, "format"));
    if (m.sizeBytes != null && m.sizeBytes > 0) {
      rows.push(metaRow(lang === "en" ? "Size" : "大小", formatByteSize(m.sizeBytes), "size"));
    }
    if (m.durationSec != null && m.durationSec >= 0) {
      const t = formatDurationHms(m.durationSec);
      rows.push(metaRow(lang === "en" ? "Duration" : "时长", t, "duration"));
    }
    if (
      typeof m.widthPx === "number" &&
      typeof m.heightPx === "number" &&
      Number.isFinite(m.widthPx) &&
      Number.isFinite(m.heightPx) &&
      m.widthPx > 0 &&
      m.heightPx > 0
    ) {
      rows.push(
        metaRow(
          lang === "en" ? "Resolution" : "分辨率",
          `${Math.round(m.widthPx)}×${Math.round(m.heightPx)}`,
          "resolution"
        )
      );
    }

    return <>{rows}</>;
  }

  function renderSchemaFieldRow(field: SchemaField) {
    const matchProp = customProps.find((p) => p.id === field.id);
    const editorProp = coerceSchemaPropForEditor(field, matchProp);
    const cardLinkCreateTarget =
      field.type === "cardLink"
        ? resolveCardLinkCreateTarget(field.id, effectiveSchema?.autoLinkRules)
        : null;
    const linkedTargetLabel =
      field.type === "cardLink"
        ? (
            cardLinkTargetCollectionOptions.find(
              (opt) => opt.id === (matchProp?.targetCollectionId?.trim() ?? "")
            )?.label ??
            (lang === "en"
              ? "Follow current card collection"
              : "跟随当前卡片合集")
          )
        : "";
    const linkFillRef =
      field.type === "cardLink" && field.cardLinkFromEdge
        ? card.relatedRefs?.find((r) => r.linkType === field.cardLinkFromEdge)
        : undefined;
    const fieldReadonly = field.readonly === true;
    return (
      <div
        key={`schema-${field.id}`}
        className="card-page__prop-row card-page__prop-row--tags card-page__prop-row--custom"
        data-prop-id={field.id}
        data-prop-type={field.type}
      >
        <div
          className={
            "card-page__prop-label-wrap" +
            (field.type === "cardLink" && !fieldReadonly
              ? " card-page__prop-label-wrap--link-target"
              : "")
          }
          title={
            field.type === "cardLink" && !fieldReadonly
              ? `${lang === "en" ? "Choose linked card target collection" : "选择这个关联字段的目标合集"}\n${linkedTargetLabel}`
              : undefined
          }
        >
          <span className="card-page__prop-label">{field.name}</span>
          {field.type === "cardLink" && !fieldReadonly ? (
            <button
              type="button"
              className="card-page__prop-target-hint card-page__prop-target-hint--button"
              onClick={(e) => openPropLinkTargetMenu(e, field.id)}
            >
              {lang === "en" ? "Target" : "目标"}
            </button>
          ) : null}
        </div>
        <div className="card-page__prop-content">
          {editorProp ? (
            <PropValueEditor
              prop={editorProp}
              canEdit={canEdit && !fieldReadonly}
              collections={collections}
              hideCollectionDots={hideCollectionDots}
              linkFillRef={linkFillRef}
              cardLinkCreateTarget={cardLinkCreateTarget}
              onCreateLinkedCard={onCreateLinkedCard}
              onOpenLinkedCard={onOpenLinkedCard}
              onChangeSeedTitle={(seed) => {
                const baseId = editorProp.id;
                const nextType = field.type as CardPropertyType;
                const nextName = field.name;
                if (matchProp) {
                  updateCustomProps(
                    customProps.map((p) =>
                      p.id === baseId
                        ? {
                            ...p,
                            type: nextType,
                            name: nextName,
                            ...(seed ? { seedTitle: seed } : { seedTitle: undefined }),
                          }
                        : p
                    )
                  );
                } else {
                  updateCustomProps([
                    ...customProps,
                    {
                      id: baseId,
                      name: nextName,
                      type: nextType,
                      value: null,
                      ...(seed ? { seedTitle: seed } : {}),
                      options: field.options,
                    },
                  ]);
                }
              }}
              onChangeValue={(v) => {
                const baseId = editorProp.id;
                const nextType = field.type as CardPropertyType;
                const nextName = field.name;
                if (matchProp) {
                  updateCustomProps(
                    customProps.map((p) =>
                      p.id === baseId
                        ? {
                            ...p,
                            type: nextType,
                            name: nextName,
                            value: v,
                          }
                        : p
                    )
                  );
                } else {
                  updateCustomProps([
                    ...customProps,
                    {
                      id: baseId,
                      name: nextName,
                      type: nextType,
                      value: v as CardProperty["value"],
                      options: field.options,
                    },
                  ]);
                }
              }}
              onChangeOptions={(opts) =>
                updateCustomProps(
                  customProps.map((p) =>
                    p.id === editorProp.id ? { ...p, options: opts } : p
                  )
                )
              }
            />
          ) : canEdit ? (
            <div className="card-page__tags-panel card-page__tags-panel--single-hit">
              <button
                type="button"
                className="card-page__tags-hit-btn card-page__tags-hit-btn--placeholder"
                onClick={() => {
                  const seedProp: CardProperty = {
                    id: field.id,
                    name: field.name,
                    type: field.type as CardPropertyType,
                    value: field.type === "checkbox" ? false : null,
                    options: field.options,
                  };
                  updateCustomProps([...customProps, seedProp]);
                }}
              >
                {field.type === "date"
                  ? "设置日期时间…"
                  : field.type === "cardLinks"
                    ? "添加作品关联…"
                    : "填写…"}
              </button>
            </div>
          ) : (
            <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
              —
            </span>
          )}
        </div>
      </div>
    );
  }

  function renderPropLinkTargetMenu() {
    if (!propLinkTargetMenu || !canEdit) return null;
    const activeProp = customProps.find((p) => p.id === propLinkTargetMenu.propId);
    const activeSchemaField = schemaFieldsForPanel.find(
      (f) => f.id === propLinkTargetMenu.propId && f.type === "cardLink"
    );
    const activeMeta = activeProp
      ? {
          id: activeProp.id,
          name: activeProp.name,
          type: activeProp.type,
          options: activeProp.options,
        }
      : activeSchemaField
        ? {
            id: activeSchemaField.id,
            name: activeSchemaField.name,
            type: activeSchemaField.type as CardPropertyType,
            options: activeSchemaField.options,
          }
        : null;
    if (!activeMeta || activeMeta.type !== "cardLink") return null;
    const currentTargetId = activeProp?.targetCollectionId?.trim() ?? "";
    return createPortal(
      <div
        className="card-page__prop-target-menu"
        data-prop-link-target-menu
        style={{
          left: Math.min(propLinkTargetMenu.x, window.innerWidth - 280),
          top: Math.min(propLinkTargetMenu.y, window.innerHeight - 320),
        }}
      >
        <div className="card-page__prop-target-menu-title">
          {lang === "en" ? "Linked card target" : "关联卡目标合集"}
        </div>
        <div className="card-page__prop-target-menu-search-wrap">
          <input
            type="text"
            className="card-page__tags-add-input card-page__prop-target-menu-search"
            value={propLinkTargetQuery}
            onChange={(e) => setPropLinkTargetQuery(e.target.value)}
            placeholder={
              lang === "en" ? "Search collections..." : "搜索合集..."
            }
            autoFocus
          />
        </div>
        <button
          type="button"
          className={
            "card-page__tags-dropdown-item" +
            (!currentTargetId ? " is-active" : "")
          }
          onClick={() => {
            upsertCardLinkTargetForProp(activeMeta.id, activeMeta, undefined);
            setPropLinkTargetQuery("");
            setPropLinkTargetMenu(null);
          }}
        >
          <span className="card-page__prop-cardlink-option-main">
            {lang === "en"
              ? "Follow current card collection"
              : "跟随当前卡片合集"}
          </span>
          <span className="card-page__prop-cardlink-option-sub">
            {lang === "en"
              ? "Use the default creation target"
              : "沿用默认建卡目标"}
          </span>
        </button>
        <div className="card-page__prop-target-menu-list">
          {filteredCardLinkTargetCollectionOptions.length > 0 ? (
            filteredCardLinkTargetCollectionOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={
                  "card-page__tags-dropdown-item" +
                  (currentTargetId === opt.id ? " is-active" : "")
                }
                onClick={() => {
                  upsertCardLinkTargetForProp(activeMeta.id, activeMeta, opt.id);
                  setPropLinkTargetQuery("");
                  setPropLinkTargetMenu(null);
                }}
              >
                <span className="card-page__prop-cardlink-option-main">
                  {opt.label}
                </span>
              </button>
            ))
          ) : (
            <div className="card-page__tags-dropdown-empty">
              {lang === "en" ? "No matching collections." : "没有匹配的合集。"}
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  }

  function renderCardTitleRow() {
    const titleLabel = getPresetTitleLabel(card.objectKind, lang);
    const titlePlaceholder =
      lang === "en" ? "Add a title…" : "填写…";
    if (isFileCard(card)) {
      return (
        <div
          className="card-page__prop-row card-page__file-meta-row"
          data-prop-id="__card_title"
          data-prop-type="text"
        >
          <span className="card-page__prop-label">{titleLabel}</span>
          <div className="card-page__prop-content">
            <span
              ref={cardTitleEditableRef}
              className="card-page__file-meta-val card-page__file-meta-val--editable"
              contentEditable={canEdit}
              suppressContentEditableWarning
              spellCheck={false}
              data-placeholder={titlePlaceholder}
              onInput={(e) => {
                const next = (e.currentTarget.textContent ?? "").replace(/\r?\n/g, "");
                setCardTitle(card.id, next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData("text/plain").replace(/\r?\n/g, " ");
                document.execCommand("insertText", false, text);
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <div
        className="card-page__prop-row card-page__prop-row--tags card-page__prop-row--custom"
        data-prop-id="__card_title"
        data-prop-type="text"
      >
        <div className="card-page__prop-label-wrap">
          <span className="card-page__prop-label">{titleLabel}</span>
        </div>
        <div className="card-page__prop-content">
          <input
            type="text"
            className="card-page__tags-add-input card-page__tags-add-input--prop-field"
            value={card.title ?? ""}
            placeholder={titlePlaceholder}
            disabled={!canEdit}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setCardTitle(card.id, next);
            }}
          />
        </div>
      </div>
    );
  }

  function renderPropsFieldsBlock() {
    const isFile = isFileCard(card);
    const schemaFieldsBody = schemaFieldsForPanel;
    const hiddenFileMetaPropIds = new Set([
      "sf-vid-duration-sec",
      "sf-aud-duration-sec",
      "sf-vid-resolution",
      "sf-file-resolution",
    ]);
    return (
      <>
        {renderCardTitleRow()}
        {isFile ? renderFileMetaBlock() : (
          <div
            className="card-page__prop-row card-page__prop-row--tags"
            data-prop-id="tags"
          >
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
        )}

        <div
          className="card-page__prop-row card-page__prop-row--tags"
          data-prop-id="collection"
        >
          <span className="card-page__prop-label">合集</span>
          <div className="card-page__prop-content">
            <CardPageCollectionTagsPanel
              instanceId={`${card.id}-placement`}
              collections={collections}
              selectedCollectionIds={colIds}
              pickerExcludeIds={placementPickerExclude}
              canEdit={Boolean(canEdit && onRemoveCardFromCollection)}
              hideCollectionDots={hideCollectionDots}
              onAdd={(targetColId) => void onAddCardPlacement?.(targetColId)}
              onRemove={(placementColId) =>
                onRemoveCardFromCollection?.(placementColId)
              }
              addInputPlaceholder={ui.cardCollectionTagInputPlaceholder}
              dropdownEmptyText={ui.cardCollectionTagDropdownEmpty}
              dropdownAriaLabel={ui.cardCollectionTagDropdownAria}
              removePillAriaLabel={ui.cardRemoveFromCollectionChipAria}
              unknownLabel={ui.propUnknownCollection}
              chipShape="rect"
            />
          </div>
        </div>

        {!isFile && (<><div
            className="card-page__prop-row card-page__prop-row--tags"
            data-prop-id="reminder"
          >
            <span className="card-page__prop-label">提醒</span>
            <div className="card-page__prop-content">
              <div className="card-page__tags-panel card-page__tags-panel--single-hit">
                {hasReminder ? (
                  <button
                    type="button"
                    className="card-page__tags-hit-btn"
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
                    className="card-page__tags-hit-btn card-page__tags-hit-btn--placeholder"
                    onClick={() =>
                      setReminderPicker({ kind: "card", colId, cardId: card.id })
                    }
                  >
                    添加提醒…
                  </button>
                ) : (
                  <span className="card-page__prop-empty card-page__prop-empty--in-tags-panel">
                    —
                  </span>
                )}
              </div>
            </div>
          </div>

        </>
        )}

        {/* ── Schema 字段区：来自合集类型定义，优先展示（含文件卡） ── */}
        {schemaFieldsBody.map((field) => renderSchemaFieldRow(field))}

          {/* ── 卡片自有属性区：id 不在 schema 字段集合内的额外属性 ── */}
        {customProps
            .filter(
              (prop) =>
                !schemaFieldsForPanel.some((f) => f.id === prop.id) &&
                !(isFile && hiddenFileMetaPropIds.has(prop.id))
            )
            .map((prop) => (
            (() => {
              const linkedTargetLabel =
                prop.type === "cardLink"
                  ? (
                      cardLinkTargetCollectionOptions.find(
                        (opt) => opt.id === (prop.targetCollectionId?.trim() ?? "")
                      )?.label ??
                      (lang === "en"
                        ? "Follow current card collection"
                        : "跟随当前卡片合集")
                    )
                  : "";
              return (
            <div
              key={prop.id}
              className="card-page__prop-row card-page__prop-row--tags card-page__prop-row--custom"
              data-prop-id={prop.id}
              data-prop-type={prop.type}
            >
              <div
                className={
                  "card-page__prop-label-wrap" +
                  (prop.type === "cardLink"
                    ? " card-page__prop-label-wrap--link-target"
                    : "")
                }
                title={
                  prop.type === "cardLink"
                    ? `${lang === "en" ? "Right-click to choose linked card target collection" : "右键选择这个关联属性的目标合集"}\n${linkedTargetLabel}`
                    : undefined
                }
                onContextMenuCapture={(e) => {
                  if (prop.type !== "cardLink") return;
                  openPropLinkTargetMenu(e, prop.id);
                }}
              >
                {canEdit ? (
                  <input
                    type="text"
                    className="card-page__prop-name-input"
                    defaultValue={prop.name}
                    onContextMenuCapture={(e) => {
                      if (prop.type !== "cardLink") return;
                      openPropLinkTargetMenu(e, prop.id);
                    }}
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
                {prop.type === "cardLink" ? (
                  <button
                    type="button"
                    className="card-page__prop-target-hint card-page__prop-target-hint--button"
                    onClick={(e) => openPropLinkTargetMenu(e, prop.id)}
                  >
                    {lang === "en" ? "Target" : "目标"}
                  </button>
                ) : null}
              </div>
              <div className="card-page__prop-content">
                <PropValueEditor
                  prop={prop}
                  canEdit={canEdit}
                  collections={collections}
                  hideCollectionDots={hideCollectionDots}
                  linkFillRef={null}
                  cardLinkCreateTarget={
                    prop.type === "cardLink" && prop.targetCollectionId?.trim()
                      ? { targetCollectionId: prop.targetCollectionId.trim() }
                      : null
                  }
                  onCreateLinkedCard={onCreateLinkedCard}
                  onOpenLinkedCard={onOpenLinkedCard}
                  onChangeSeedTitle={(seed) =>
                    updateCustomProps(
                      customProps.map((p) =>
                        p.id === prop.id
                          ? { ...p, ...(seed ? { seedTitle: seed } : { seedTitle: undefined }) }
                          : p
                      )
                    )
                  }
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
          );
            })()
          ))}

        {renderPropLinkTargetMenu()}

        {(globalThis as { __CARDNOTE_SHOW_CARD_RERUN_AUTO_LINK__?: boolean })
          .__CARDNOTE_SHOW_CARD_RERUN_AUTO_LINK__ === true &&
        canEdit &&
        onAfterRemoteAutoLink ? (
          <div className="card-page__prop-row card-page__prop-row--tags card-page__prop-row--custom">
            <span className="card-page__prop-label">
              {ui.cardPageRerunAutoLinkSection}
            </span>
            <div className="card-page__prop-content">
              <button
                type="button"
                className="card-page__rerun-auto-link"
                disabled={rerunAutoLinkBusy}
                title={ui.cardPageRerunAutoLinkTitle}
                onClick={() => void handleRerunAutoLink()}
              >
                {rerunAutoLinkBusy
                  ? ui.cardPageRerunAutoLinkBusy
                  : ui.cardPageRerunAutoLink}
              </button>
              {rerunAutoLinkMessage ? (
                <p
                  className="card-page__rerun-auto-link-msg"
                  role="status"
                >
                  {rerunAutoLinkMessage}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </>
    );
  }

  function renderTocNavBlock() {
    return (
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
    );
  }

  const lbIdx =
    lightbox && n > 0 ? ((lightbox.index % n) + n) % n : 0;
  const lbItem =
    lightbox && n > 0 ? (media[lbIdx] ?? null) : null;

  const labelFromUrl = (url: string) =>
    fileLabelFromUrl(url, ui.uiFileFallback);

  /** 文件卡中央预览：图片/视频/音频/PDF/通用下载占位；没有附件时返回 null */
  function renderFilePrimaryAttachment(): ReactNode {
    const m = media[0];
    if (!m) return null;
    const kind = m.kind;
    if (kind === "image") {
      return (
        <div className="card-page__file-primary card-page__file-primary--image">
          <MediaLightboxImage
            url={m.url}
            className="card-page__file-primary-img"
          />
        </div>
      );
    }
    if (kind === "video") {
      return (
        <div className="card-page__file-primary card-page__file-primary--video">
          <MediaLightboxVideo
            url={m.url}
            className="card-page__file-primary-video"
          />
        </div>
      );
    }
    if (kind === "audio") {
      return (
        <div className="card-page__file-primary card-page__file-primary--audio">
          {(m.coverUrl ?? m.thumbnailUrl)?.trim() ? (
            <MediaLightboxImage
              url={(m.coverUrl ?? m.thumbnailUrl)!}
              className="card-page__file-primary-img"
            />
          ) : null}
          <MediaLightboxAudio
            url={m.url}
            className="card-page__file-primary-audio"
          />
        </div>
      );
    }
    if (isPdfAttachment(m)) {
      return (
        <div className="card-page__file-primary card-page__file-primary--pdf">
          <MediaLightboxPdf
            url={m.url}
            className="card-page__file-primary-pdf"
            title={m.name ?? labelFromUrl(m.url)}
          />
        </div>
      );
    }
    const caption = m.name?.trim() || labelFromUrl(m.url);
    return (
      <div className="card-page__file-primary card-page__file-primary--doc">
        <FileDocIcon className="card-page__file-primary-icon" />
        <div className="card-page__file-primary-name">{caption}</div>
        <MediaOpenLink url={m.url} className="card-page__file-primary-open">
          {lang === "en" ? "Open" : "打开"}
        </MediaOpenLink>
      </div>
    );
  }

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
        {onOpenFileCard ? (
          <button
            type="button"
            className="attachment-ctx-menu__item"
            role="menuitem"
            onClick={() => {
              const it = attachMenu.item;
              setAttachMenu(null);
              setLightbox(null);
              if (!onOpenFileCard(it)) {
                onCreateFileCardFromAttachment?.(it);
              }
            }}
          >
            {ui.uiOpenFileCard}
          </button>
        ) : onCreateFileCardFromAttachment ? (
          <button
            type="button"
            className="attachment-ctx-menu__item"
            role="menuitem"
            onClick={() => {
              const it = attachMenu.item;
              setAttachMenu(null);
              setLightbox(null);
              onCreateFileCardFromAttachment(it);
            }}
          >
            {ui.uiCreateFileCard}
          </button>
        ) : null}
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
    <div
      ref={cardPageRootRef}
      className={
        "card-page" + (compactLayout ? " card-page--compact" : "")
      }
      onDoubleClick={
        compactLayout && canEdit ? onCardPageDoubleClick : undefined
      }
    >
      <div className="card-page__header">
        <button
          type="button"
          className="card-page__back"
          onClick={onClose}
          aria-label={ui.uiBack}
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
        </button>
        <div className="card-page__header-main">
          {cardPageHeaderTitle ? (
            <span
              className="card-page__title"
              title={cardPageHeaderTitle}
            >
              {cardPageHeaderTitle}
            </span>
          ) : null}
        </div>
        <div className="card-page__header-meta">
          <span className="card-page__time">
            {formatCardTimeLabel(card, lang)}
          </span>
          {canEdit && onDeleteCard ? (
            <button
              type="button"
              className="card-page__header-delete"
              onClick={onDeleteCard}
            >
              {ui.cardMenuDeleteCard}
            </button>
          ) : null}
        </div>
        {compactLayout ? (
          <nav
            className="card-page__header-panels"
            aria-label="属性与目录"
          >
            <button
              type="button"
              className={
                "card-page__header-panel-btn" +
                (mobileOverlay === "props" ? " is-active" : "")
              }
              aria-pressed={mobileOverlay === "props"}
              onClick={() =>
                setMobileOverlay((o) => (o === "props" ? null : "props"))
              }
            >
              属性
            </button>
            {showTocPanel ? (
              <button
                type="button"
                className={
                  "card-page__header-panel-btn" +
                  (mobileOverlay === "toc" ? " is-active" : "")
                }
                aria-pressed={mobileOverlay === "toc"}
                onClick={() =>
                  setMobileOverlay((o) => (o === "toc" ? null : "toc"))
                }
              >
                目录
              </button>
            ) : null}
          </nav>
        ) : null}
        {compactLayout ? (
          <button
            type="button"
            className="card-page__done"
            onClick={() => {
              setMobileOverlay(null);
              onClose();
            }}
          >
            {ui.done}
          </button>
        ) : null}
      </div>

      <div className="card-page__body">
        {!compactLayout ? (
          <>
            <div
              className="card-page__props"
              style={{ width: propsWidth, flexBasis: propsWidth }}
            >
              <div className="sidebar__section-row sidebar__section-row--collapsible card-page__props-sidebar-row">
                <button
                  type="button"
                  className="sidebar__section-hit"
                  aria-expanded={propsPanelOpen}
                  onClick={() => setPropsPanelOpen((v) => !v)}
                >
                  <span
                    className={
                      "sidebar__chevron" +
                      (propsPanelOpen ? " is-expanded" : "")
                    }
                    aria-hidden
                  >
                    <span className="sidebar__chevron-icon">›</span>
                  </span>
                  <span className="sidebar__section">属性</span>
                </button>
                {renderPropertyTypePickerChrome()}
              </div>
              {propsPanelOpen ? (
                <div className={propsPanelInnerClassName}>
                  {renderPropsFieldsBlock()}
                </div>
              ) : null}

              {showTocPanel ? (
                <>
                  <div className="sidebar__section-row sidebar__section-row--collapsible card-page__props-sidebar-row card-page__props-sidebar-row--toc">
                    <button
                      type="button"
                      className="sidebar__section-hit"
                      aria-expanded={tocPanelOpen}
                      onClick={() => setTocPanelOpen((v) => !v)}
                    >
                      <span
                        className={
                          "sidebar__chevron" +
                          (tocPanelOpen ? " is-expanded" : "")
                        }
                        aria-hidden
                      >
                        <span className="sidebar__chevron-icon">›</span>
                      </span>
                      <span className="sidebar__section">目录</span>
                    </button>
                  </div>
                  {tocPanelOpen ? renderTocNavBlock() : null}
                </>
              ) : null}
            </div>

            <div
              className="card-page__divider"
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
              onPointerUp={onDividerPointerUp}
            />
          </>
        ) : null}

        <div
          className={
            "card-page__main" +
            (compactLayout ? " card-page__main--compact" : "")
          }
        >
          <div className="card-page__center">
          {isFileCard(card) ? (
            renderFilePrimaryAttachment()
          ) : (
            <>
          <div className="card-page__editor-area" ref={editorAreaRef}>
            <NoteCardTiptap
              id={card.id}
              value={card.text}
              onChange={(text) => setCardText(colId, card.id, text)}
              canEdit={canEdit}
              showToolbar={canEdit}
              insertUploadedImagesAtCursor={Boolean(
                canAttachMedia && canEdit
              )}
              onPasteFiles={
                canAttachMedia && canEdit
                  ? (files) => uploadFilesToCard(colId, card.id, files)
                  : undefined
              }
            />
          </div>
          {media.length > 0 || canAttachMedia ? (
            <aside
              className={
                "card-page__attachments-rail" +
                (compactLayout &&
                (compactKeyboardHidesAttachments || compactEditorAreaFocused)
                  ? " card-page__attachments-rail--keyboard-hidden"
                  : "") +
                (attachmentDropActive ? " card-page__attachments-rail--drop-active" : "")
              }
              aria-label="附件"
              onDragEnter={(e) => {
                if (!canAttachMedia || !canEdit) return;
                if (!hasDraggedFiles(e.dataTransfer)) return;
                e.preventDefault();
                attachmentDropDepthRef.current += 1;
                setAttachmentDropActive(true);
              }}
              onDragOver={(e) => {
                if (!canAttachMedia || !canEdit) return;
                if (!hasDraggedFiles(e.dataTransfer)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (!attachmentDropActive) setAttachmentDropActive(true);
              }}
              onDragLeave={(e) => {
                if (!canAttachMedia || !canEdit) return;
                if (!hasDraggedFiles(e.dataTransfer)) return;
                e.preventDefault();
                attachmentDropDepthRef.current = Math.max(
                  0,
                  attachmentDropDepthRef.current - 1
                );
                if (attachmentDropDepthRef.current === 0) {
                  setAttachmentDropActive(false);
                }
              }}
              onDrop={(e) => {
                if (!canAttachMedia || !canEdit) return;
                if (!hasDraggedFiles(e.dataTransfer)) return;
                e.preventDefault();
                attachmentDropDepthRef.current = 0;
                setAttachmentDropActive(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length > 0) {
                  void uploadFilesToCard(colId, card.id, files);
                }
              }}
            >
              <div className="card-page__attachments-rail-scroll">
                <div className="card-page__attachments-rail-head-row">
                  <div className="card-page__attachments-rail-head">附件</div>
                  {canAttachMedia ? (
                    <button
                      type="button"
                      className="card-page__attachments-rail-add"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      添加附件
                    </button>
                  ) : null}
                </div>
                {canAttachMedia ? (
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
                ) : null}
                <div className="card-page__attachments-rail-list">
                {media.map((item, idx) => (
                  <div
                    key={item.url}
                    className={
                      "card-page__attachment" +
                      (canEdit && !compactLayout
                        ? " card-page__attachment--draggable"
                        : "")
                    }
                    draggable={Boolean(canEdit && !compactLayout)}
                    onDragStart={(e) => {
                      if (!canEdit || compactLayout) return;
                      if (
                        (e.target as HTMLElement).closest(
                          ".card-page__attachment-remove, .card-page__attachment-open-card"
                        )
                      ) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer?.setData(
                        NOTE_MEDIA_ITEM_DRAG_MIME,
                        JSON.stringify({
                          url: item.url,
                          kind: item.kind,
                          name: item.name,
                        })
                      );
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = "copy";
                      }
                    }}
                  >
                    <button
                      type="button"
                      draggable={false}
                      className="card-page__attachment-trigger"
                      title={previewTitle(item.kind)}
                      aria-label={previewTitle(item.kind)}
                      onClick={() => setLightbox({ index: idx })}
                      onContextMenu={(e) => openAttachmentMenu(e, item)}
                    >
                      <CardPageAttachmentThumb item={item} />
                    </button>
                    <div className="card-page__attachment-meta">
                      <span
                        className="card-page__attachment-label"
                        title={attachmentCaption(item, ui.uiFileFallback)}
                      >
                        {attachmentCaption(item, ui.uiFileFallback)}
                      </span>
                      <button
                        type="button"
                        className="card-page__attachment-open-card"
                        title="打开文件卡"
                        aria-label="打开文件卡"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onOpenFileCard?.(item)) return;
                          if (canEdit && onCreateFileCardFromAttachment) {
                            onCreateFileCardFromAttachment(item);
                            return;
                          }
                          setLightbox({ index: idx });
                        }}
                      >
                        ↗
                      </button>
                    </div>
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
                </div>
              </div>
            </aside>
          ) : null}
            </>
          )}
        </div>
        </div>
      </div>
      {compactLayout && mobileOverlay ? (
        <>
          <div
            className="card-page__sheet-backdrop"
            role="presentation"
            onClick={() => setMobileOverlay(null)}
          />
          {mobileOverlay === "toc" && showTocPanel ? (
            <aside
              className="card-page__sheet card-page__sheet--from-left is-open"
              aria-label="正文目录"
            >
              <div className="card-page__sheet-head">
                <span className="card-page__sheet-title">目录</span>
                <button
                  type="button"
                  className="card-page__sheet-close"
                  aria-label={ui.uiClose}
                  onClick={() => setMobileOverlay(null)}
                >
                  ×
                </button>
              </div>
              <div className="card-page__sheet-body">
                {renderTocNavBlock()}
              </div>
            </aside>
          ) : null}
          {mobileOverlay === "props" ? (
            <aside
              className="card-page__sheet card-page__sheet--from-right is-open"
              aria-label="笔记属性"
            >
              <div className="card-page__sheet-head">
                <span className="card-page__sheet-title">属性</span>
                <div className="card-page__sheet-head-trail">
                  {renderPropertyTypePickerChrome()}
                  <button
                    type="button"
                    className="card-page__sheet-close"
                    aria-label={ui.uiClose}
                    onClick={() => setMobileOverlay(null)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="card-page__sheet-body card-page__sheet-body--props">
                <div className={propsPanelInnerClassName}>
                  {renderPropsFieldsBlock()}
                </div>
              </div>
            </aside>
          ) : null}
        </>
      ) : null}
      {lightboxPortal}
      {attachMenuPortal}
    </div>
  );
}
