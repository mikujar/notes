import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ReminderPickerTarget } from "./ReminderPickerModal";
import { createPortal, flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import {
  createCollectionApi,
  updateCollectionApi,
  deleteCollectionApi,
  createCardApi,
  addCardPlacementApi,
  updateCardApi,
  fetchCollectionsFromApi,
  fetchPresetCollectionIdApi,
  createFileCardForNoteMediaApi,
  removeCardFromCollectionApi,
  fetchMeNotePrefs,
} from "./api/collections";
import { noteBodyToHtml } from "./noteEditor/plainHtml";
import {
  collectMediaUrlsFromItems,
  stripMediaRefsFromNoteHtml,
} from "./noteEditor/stripMediaRefsFromNoteHtml";
import {
  clearMeTrash,
  deleteMeTrashEntry,
  fetchMeAttachmentsCount,
  fetchMeFavorites,
  fetchMeTrash,
  postMeTrashEntry,
  postMeTrashRestore,
  putMeFavorites,
} from "./api/mePreferences";
import { uploadCardMedia } from "./api/upload";
import { ensureMediaItemDimensionsFromFile } from "./noteMediaDimensions";
import { useAppDataMode } from "./appDataMode";
import { getAppDataMode } from "./appDataModeStorage";
import {
  readAttachmentsPreviewLayout,
  writeAttachmentsPreviewLayout,
} from "./allAttachmentsPreviewLayoutStorage";
import { clearRemoteAttachmentsListCacheForUser } from "./attachmentsListSessionCache";
import { useAuth } from "./auth/AuthContext";
import { useAppUiLang } from "./appUiLang";
import { useAppChrome } from "./i18n/useAppChrome";
import { getAdminToken } from "./auth/token";
import {
  loadLocalCollections,
  saveLocalCollections,
} from "./localCollectionsStorage";
import { saveLocalMediaInlineInBrowser } from "./localMediaBrowser";
import {
  deleteLocalMediaFile,
  saveLocalMediaToAppFolder,
} from "./localMediaTauri";
import {
  readNewNotePlacement,
  saveNewNotePlacement,
  type NewNotePlacement,
} from "./newNotePlacementStorage";
import {
  readHideSidebarCollectionDots,
  saveHideSidebarCollectionDots,
} from "./hideSidebarCollectionDotsStorage";
import {
  readTimelineFoldBodyThreeLines,
  saveTimelineFoldBodyThreeLines,
} from "./timelineFoldBodyStorage";
import {
  defaultSidebarSectionCollapseState,
  sidebarSectionsCollapseStorageKey,
  writeSidebarSectionsCollapsed,
  type SidebarSectionCollapseState,
} from "./sidebarSectionCollapseStorage";
import { toContrastyGlyphColor } from "./sidebarDotColor";
const UserProfileModal = lazy(() =>
  import("./UserProfileModal").then((m) => ({ default: m.UserProfileModal }))
);
const DataStatsModal = lazy(() =>
  import("./DataStatsModal").then((m) => ({ default: m.DataStatsModal }))
);
const NoteSettingsModal = lazy(() =>
  import("./NoteSettingsModal").then((m) => ({
    default: m.NoteSettingsModal,
  }))
);
const AppleNotesImportModal = lazy(() =>
  import("./AppleNotesImportModal").then((m) => ({
    default: m.AppleNotesImportModal,
  }))
);
const FlomoImportModal = lazy(() =>
  import("./FlomoImportModal").then((m) => ({
    default: m.FlomoImportModal,
  }))
);
const EvernoteImportModal = lazy(() =>
  import("./EvernoteImportModal").then((m) => ({
    default: m.EvernoteImportModal,
  }))
);
const YuqueImportModal = lazy(() =>
  import("./YuqueImportModal").then((m) => ({
    default: m.YuqueImportModal,
  }))
);
const CardDetail = lazy(() =>
  import("./CardDetail").then((m) => ({ default: m.CardDetail }))
);
const CardPageView = lazy(() =>
  import("./CardPageView").then((m) => ({ default: m.CardPageView }))
);
const ReminderPickerModal = lazy(() =>
  import("./ReminderPickerModal").then((m) => ({
    default: m.ReminderPickerModal,
  }))
);
const UserAdminPage = lazy(() =>
  import("./appkit/UserAdminPage").then((m) => ({ default: m.UserAdminPage }))
);
import type {
  CardProperty,
  Collection,
  CollectionCardSchema,
  CollectionIconShape,
  NoteCard,
  NoteMediaItem,
  SchemaField,
  TrashedNoteEntry,
  UserNotePrefs,
} from "./types";
import { collectBlankCardsInTree } from "./blankCardUtils";
import {
  mapEveryCardInCollections,
  mergeFileTitleIntoCustomProps,
  migrationTitleCandidateForFileCard,
} from "./migrateFileCardTitles";
import {
  deriveFileCardTitleFromMedia,
  objectKindFromNoteMediaKind,
} from "./fileCardTitle";
import { loadLocalNotePrefs, saveLocalNotePrefs } from "./notePrefsStorage";
import { migrateCollectionTree } from "./migrateCollections";
import type { ParsedExportNote } from "./import/parseAppleNotesExport";
import {
  remoteSnapshotUserKey,
  saveRemoteCollectionsSnapshot,
} from "./remoteCollectionsCache";
import "./App.css";

import {
  addBidirectionalRelated,
  AdminHeaderIcon,
  ancestorIdsFor,
  activeCollectionStorageKey,
  attachmentsFilterStorageKey,
  buildCalendarCells,
  buildSearchResults,
  CalendarBrowsePanel,
  CollectionContextMenu,
  CollectionTemplateModal,
  type CollectionTemplateDialogState,
  CollectionIconGlyph,
  CollectionDeleteDialog,
  CollectionMergeDialog,
  type CollectionMergeDialogState,
  CollectionMoveUnderDialog,
  type CollectionMoveUnderDialogState,
  NotesSidebarPlainCollectionsList,
  CollectionStarIcon,
  collapsedFoldersStorageKey,
  type CollectionDropPosition,
  collectAllMediaAttachmentEntries,
  collectAllReminderEntries,
  collectCardsOnDate,
  cloneInitialCollections,
  collectReminderCardsOnDate,
  collectCardsInSubtreeWithPathLabels,
  collectSubtreeCollectionIds,
  collectionPathLabel,
  createLooseNotesCollection,
  datesWithNoteAddedOn,
  datesWithReminderOn,
  favoriteCollectionsStorageKey,
  recentCollectionsStorageKey,
  RECENT_COLLECTIONS_LIMIT,
  findCardInTree,
  findCollectionById,
  readCollapsedFolderIdsFromStorage,
  readPersistedActiveCollectionId,
  readPersistedAttachmentsFilterKey,
  writePersistedAttachmentsFilterKey,
  PERSISTED_WORKSPACE_ALL_NOTES,
  PERSISTED_WORKSPACE_ALL_ATTACHMENTS,
  PERSISTED_WORKSPACE_CONNECTIONS,
  PERSISTED_WORKSPACE_OVERVIEW,
  PERSISTED_WORKSPACE_REMINDERS,
  formatCalendarDayTitle,
  initTimelineColumnPreferenceIfNeeded,
  insertChildCollection,
  INITIAL_WORKSPACE,
  loadFavoriteCollectionIds,
  loadRecentCollectionIds,
  loadTrashedNoteEntries,
  localDateString,
  LOOSE_NOTES_COLLECTION_ID,
  LOOSE_NOTES_DOT_COLOR,
  mapCollectionById,
  mergeCollectionSubtreeIntoTarget,
  moveCollectionInTree,
  MOBILE_CHROME_MEDIA,
  matchesMobileChromeMedia,
  TABLET_WIDE_TOUCH_MEDIA,
  TIMELINE_COLUMN_STEPS_WIDE,
  MasonryShortestColumns,
  type TimelineColumnPreference,
  mediaItemFromUploadResult,
  MobileDockJarIcon,
  IconTimelineMasonry1Col,
  IconTimelineMasonry2Col,
  NoteTimelineCard,
  appendCardCopyToCollection,
  buildCardPlacementCountIndex,
  collectionIdsContainingCardId,
  pickPlacementColIdForCard,
  patchNoteCardByIdInTree,
  removeCardIdFromAllCollections,
  stripCardsMediaByUrl,
  stripRelatedRefsToCardId,
  persistMergeCollectionsRemote,
  persistCollectionTreeLayoutRemoteWithRetry,
  pruneCollapsedFolderIds,
  resolveActiveCollectionId,
  randomDotColor,
  readTimelineColumnPreferenceFromStorage,
  writeTimelineColumnPreferenceToStorage,
  removeBidirectionalRelated,
  removeCollectionFromTree,
  saveFavoriteCollectionIds,
  saveRecentCollectionIds,
  saveTrashedNoteEntries,
  RailWorkspaceIdentity,
  SidebarWorkspaceIdentity,
  splitPinnedCards,
  stripRelatedRefsToTarget,
  trashCardsStorageKey,
  TrashNoteCardRow,
  UserAccountMenuDropdown,
  useCardTextRemoteAutosave,
  useCollectionRowDnD,
  useMobileNavSwipe,
  useRemoteCollectionsSync,
  useCollectionsRemotePush,
  usePullToRefresh,
  useUserAdmin,
  walkCollections,
} from "./appkit";
import { useLazyEndpointsProbe } from "./appkit/useLazyEndpointsProbe";
import { collectConnectionEdges } from "./appkit/connectionEdges";
import {
  findLinkedFileCardForNoteMedia,
  noteHasLinkedFileCardForMedia,
} from "./appkit/noteAttachmentFileCard";
import {
  countCollectionSubtreeCards,
  findCollectionByPresetType,
  findCollectionPathFromRoot,
  isFileCard,
  isNoteForAllNotesView,
  mergeServerTreeWithLocalExtraCards,
  removeCardPlacementFromTree,
} from "./appkit/collectionModel";
import { mergedTemplateSchemaFieldsForCollection } from "./appkit/schemaTemplateFields";
import {
  type AttachmentFilterKey,
  type AttachmentUiCategory,
  getAttachmentUiCategory,
  presetFileSubtypeIdToAttachmentFilterKey,
} from "./noteMediaCategory";
import {
  PRESET_OBJECT_TYPES_GROUPS,
  filterPlainFolderCollectionsForNotesSidebar,
  presetCatalogBaseIdForPresetTypeId,
  type PresetTypeGroup,
} from "./notePresetTypesCatalog";
import { SidebarRail, type RailKey } from "./appkit/SidebarRail";
import { SidebarOverviewPanel } from "./appkit/SidebarOverviewPanel";
import {
  OverviewDashboard,
  type OverviewPill,
  type OverviewReminderItem,
  type OverviewTypeWidget,
} from "./appkit/OverviewDashboard";
import type { RailIconKey } from "./appkit/RailIcon";
import { LandingPage } from "./LandingPage";

/** 时间线虚拟列表：每批挂载卡片数（全部笔记 / 单合集 / 日历 / 搜索等共用） */
const TIMELINE_VIRTUAL_BATCH = 40;
const CONNECTIONS_EDGE_BATCH = 500;

/** 侧栏「文件」下展示的子类型（与对象类型目录、附件筛选一致） */
const FILE_PRESET_SUBTYPE_ITEMS =
  PRESET_OBJECT_TYPES_GROUPS.find((g) => g.baseId === "file")?.children ?? [];

/** 侧栏文件子类型圆点：从大地色系里挑相邻 5 色，与 rail / 合集默认色一致 */
const FILE_SUBTYPE_SIDEBAR_DOT: Record<string, string> = {
  file_image: "#E88368", // salmon
  file_video: "#B57A9A", // mauve
  file_audio: "#4C6C9A", // navy
  file_document: "#7F8F4F", // olive
  file_other: "#9FAD72", // sage
};

/** 侧栏「主题」子类型（与对象类型目录一致） */
const TOPIC_PRESET_SUBTYPE_ITEMS =
  PRESET_OBJECT_TYPES_GROUPS.find((g) => g.baseId === "topic")?.children ?? [];

/** 侧栏中单独分区的 catalog 顶层 id（启用对应预设时显示；未启用则整块隐藏） */
const SIDEBAR_COLLAPSIBLE_PRESET_BASE_IDS = [
  "task",
  "project",
  "expense",
  "account",
] as const satisfies readonly (keyof SidebarSectionCollapseState)[];

/**
 * 两个本地 YMD 之间的天数差（|a - b|）。
 * 直接用 Date.parse：YYYY-MM-DD 被解析为 UTC 0 点，跨夏令时也稳定。
 */
function daysBetweenYmd(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.abs(Math.round((tb - ta) / 86400000));
}

function presetGroupNavRootCollection(
  cols: Collection[],
  group: PresetTypeGroup
): Collection | null {
  const parent = findCollectionByPresetType(cols, group.baseId);
  if (parent) return parent;
  for (const ch of group.children) {
    const c = findCollectionByPresetType(cols, ch.id);
    if (c) return c;
  }
  return null;
}

type SidebarSubtypeRow = {
  col: Collection;
  depth: number;
};

function collectSidebarSubtypeRows(
  root: Collection | null | undefined
): SidebarSubtypeRow[] {
  if (!root) return [];
  const out: SidebarSubtypeRow[] = [];
  const walk = (nodes: Collection[] | undefined, depth: number) => {
    if (!nodes?.length) return;
    for (const n of nodes) {
      out.push({ col: n, depth });
      walk(n.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return out;
}

function collectLegacyRootCollectionsForNotesMigration(
  roots: Collection[],
  noteRootId: string
): string[] {
  return roots
    .filter((col) => {
      if (col.id === noteRootId || col.id === LOOSE_NOTES_COLLECTION_ID) {
        return false;
      }
      /** 「已归档」是顶层特殊合集（与「笔记」同级），不要被折叠进笔记 */
      if (col.name === "已归档") return false;
      const pid = (col.presetTypeId ?? "").trim();
      if (pid) return false;
      if (col.isCategory) return false;
      return true;
    })
    .map((col) => col.id);
}


/** 「文件」视图面包屑：子级文案与顶栏筛选一致 */
function attachmentFilterCrumbLabel(
  k: AttachmentFilterKey,
  c: {
    allAttachmentsFilterAll: string;
    allAttachmentsFilterImage: string;
    allAttachmentsFilterVideo: string;
    allAttachmentsFilterAudio: string;
    allAttachmentsFilterDocument: string;
    allAttachmentsFilterOther: string;
  }
): string {
  switch (k) {
    case "all":
      return c.allAttachmentsFilterAll;
    case "image":
      return c.allAttachmentsFilterImage;
    case "video":
      return c.allAttachmentsFilterVideo;
    case "audio":
      return c.allAttachmentsFilterAudio;
    case "document":
      return c.allAttachmentsFilterDocument;
    case "other":
      return c.allAttachmentsFilterOther;
    default: {
      const _e: never = k;
      return _e;
    }
  }
}

function readInitialAttachmentsFilterKey(): AttachmentFilterKey {
  try {
    if (typeof window === "undefined") return "all";
    if (getAppDataMode() === "local") {
      return (
        readPersistedAttachmentsFilterKey(
          attachmentsFilterStorageKey("local", null)
        ) ?? "all"
      );
    }
    return (
      readPersistedAttachmentsFilterKey(
        attachmentsFilterStorageKey("remote", null)
      ) ?? "all"
    );
  } catch {
    return "all";
  }
}

function groupSearchHitsFromFlat(
  hits: { col: Collection; path: string; card: NoteCard }[]
): { col: Collection; path: string; cards: NoteCard[] }[] {
  const out: { col: Collection; path: string; cards: NoteCard[] }[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && last.col.id === h.col.id) last.cards.push(h.card);
    else out.push({ col: h.col, path: h.path, cards: [h.card] });
  }
  return out;
}

/** 卡片全页：写入 URL 后刷新仍停留在该笔记（与「返回」关闭时清除参数） */
const CARD_PAGE_Q_COL = "cardCol";
const CARD_PAGE_Q_NOTE = "cardNote";

function readCardPageParamsFromLocation(): {
  colId: string;
  cardId: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search);
    const colId = p.get(CARD_PAGE_Q_COL)?.trim();
    const cardId = p.get(CARD_PAGE_Q_NOTE)?.trim();
    if (!colId || !cardId) return null;
    return { colId, cardId };
  } catch {
    return null;
  }
}

function syncCardPageParamsToUrl(
  next: { colId: string; cardId: string } | null
) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set(CARD_PAGE_Q_COL, next.colId);
      url.searchParams.set(CARD_PAGE_Q_NOTE, next.cardId);
    } else {
      url.searchParams.delete(CARD_PAGE_Q_COL);
      url.searchParams.delete(CARD_PAGE_Q_NOTE);
    }
    const q = url.searchParams.toString();
    const path = `${url.pathname}${q ? `?${q}` : ""}${url.hash}`;
    window.history.replaceState(window.history.state, "", path);
  } catch {
    /* ignore */
  }
}

const NoteConnectionsView = lazy(() =>
  import("./appkit/NoteConnectionsView").then((m) => ({
    default: m.NoteConnectionsView,
  }))
);
const AllRemindersView = lazy(() =>
  import("./appkit/AllRemindersView").then((m) => ({
    default: m.AllRemindersView,
  }))
);
const AllFilesView = lazy(() =>
  import("./appkit/AllFilesView").then((m) => ({
    default: m.AllFilesView,
  }))
);
const RelatedCardsSidePanel = lazy(() =>
  import("./appkit/RelatedCardsSidePanel").then((m) => ({
    default: m.RelatedCardsSidePanel,
  }))
);

export default function App() {
  const {
    isAdmin,
    authReady,
    writeRequiresLogin,
    openLogin,
    logout,
    currentUser,
    refreshMe,
    loginWallBlocking,
  } = useAuth();

  const { dataMode, setDataMode } = useAppDataMode();
  const c = useAppChrome();
  const { lang: appUiLang } = useAppUiLang();

  /**
   * 本地数据模式一律可编辑（合集/拖拽/删除仅依赖本地存储）。
   * 云端模式：已带 JWT 即允许编辑（/me 偶发失败时仍可能暂无 currentUser）；桌面壳在未登录时仍可改界面。
   */
  const canEdit = useMemo(
    () =>
      dataMode === "local" ||
      !writeRequiresLogin ||
      Boolean(currentUser) ||
      (writeRequiresLogin && Boolean(getAdminToken())),
    [dataMode, writeRequiresLogin, currentUser]
  );

  const favoriteStorageKey = useMemo(
    () => favoriteCollectionsStorageKey(currentUser?.id ?? null),
    [currentUser?.id]
  );

  const recentCollectionsKey = useMemo(
    () => recentCollectionsStorageKey(currentUser?.id ?? null),
    [currentUser?.id]
  );

  const trashStorageKey = useMemo(
    () => trashCardsStorageKey(dataMode, currentUser?.id ?? null),
    [dataMode, currentUser?.id]
  );

  const activeCollectionKey = useMemo(
    () => activeCollectionStorageKey(dataMode, currentUser?.id ?? null),
    [dataMode, currentUser?.id]
  );

  const collapsedFoldersKey = useMemo(
    () => collapsedFoldersStorageKey(dataMode, currentUser?.id ?? null),
    [dataMode, currentUser?.id]
  );

  const sidebarSectionsKey = useMemo(
    () =>
      sidebarSectionsCollapseStorageKey(dataMode, currentUser?.id ?? null),
    [dataMode, currentUser?.id]
  );

  // rail 承担顶层切换后，每个分区被选中即视为展开；不再读回历史持久化的折叠状态
  const [sidebarSectionCollapsed, setSidebarSectionCollapsed] =
    useState<SidebarSectionCollapseState>(() =>
      defaultSidebarSectionCollapseState()
    );

  useEffect(() => {
    setSidebarSectionCollapsed(defaultSidebarSectionCollapseState());
  }, [sidebarSectionsKey]);

  useEffect(() => {
    writeSidebarSectionsCollapsed(sidebarSectionsKey, sidebarSectionCollapsed);
  }, [sidebarSectionsKey, sidebarSectionCollapsed]);

  const toggleSidebarSection = useCallback(
    (part: keyof SidebarSectionCollapseState) => {
      setSidebarSectionCollapsed((prev) => ({
        ...prev,
        [part]: !prev[part],
      }));
    },
    []
  );

  const sidebarSectionToggleAria = useCallback(
    (section: keyof SidebarSectionCollapseState, label: string) => {
      const collapsed = sidebarSectionCollapsed[section];
      if (appUiLang === "zh") {
        return collapsed ? `展开「${label}」` : `折叠「${label}」`;
      }
      return collapsed ? `Expand ${label}` : `Collapse ${label}`;
    },
    [appUiLang, sidebarSectionCollapsed]
  );

  const [collections, setCollections] = useState<Collection[]>(
    () => INITIAL_WORKSPACE.collections
  );
  const collectionsRef = useRef(collections);
  collectionsRef.current = collections;
  /** 「新建」：优先全页/分栏当前卡片类型，否则当前合集 preset；全部笔记/待办固定为笔记 */
  const objectKindForNewTimelineCardRef = useRef<string>("note");
  /** 同一笔记附件并发「建 file 卡」时串行化，避免本地/同步前双请求重复建卡 */
  const attachmentFileCardOpenInflightRef = useRef(
    new Map<string, Promise<void>>()
  );
  const getCollectionsForMerge = useCallback(
    () => collectionsRef.current,
    []
  );
  const [activeId, setActiveId] = useState(() => INITIAL_WORKSPACE.activeId);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** 未输入内容时是否展开顶栏搜索框（有内容时始终展开） */
  const [searchBarOpen, setSearchBarOpen] = useState(false);
  const mainSearchInputRef = useRef<HTMLInputElement>(null);
  const mainHeaderRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const allNotesLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const collectionRestSentinelRef = useRef<HTMLDivElement | null>(null);
  const calendarRestSentinelRef = useRef<HTMLDivElement | null>(null);
  const searchNotesSentinelRef = useRef<HTMLDivElement | null>(null);
  const allNotesViewSessionRef = useRef(false);
  const collectionTimelineSessionRef = useRef<string | undefined>(undefined);
  const calendarDayRestSessionRef = useRef<string | null>(null);
  const searchTimelineSessionRef = useRef("");
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  /** 从笔记详情等打开提醒弹窗（「新建待办」等） */
  const [reminderPicker, setReminderPicker] = useState<ReminderPickerTarget | null>(
    null
  );
  /**
   * 时间线列数（默认 2 列；localStorage 持久化）。
   */
  const [timelineColumnPref, setTimelineColumnPrefState] =
    useState<TimelineColumnPreference>(2);
  const [detailCard, setDetailCard] = useState<{
    card: NoteCard;
    colId: string;
    /** `card.media` 下标：从「文件」等入口打开时定位轮播 */
    openAtMediaIndex?: number;
  } | null>(null);
  const [cardPageCard, setCardPageCard] = useState<{
    cardId: string;
    colId: string;
  } | null>(() => readCardPageParamsFromLocation());
  const closeCardFullPage = useCallback(() => {
    setCardPageCard(null);
  }, []);
  const [collectionCtxMenu, setCollectionCtxMenu] = useState<{
    x: number;
    y: number;
    id: string;
    name: string;
    hasChildren: boolean;
  } | null>(null);
  const [collectionDeleteDialog, setCollectionDeleteDialog] = useState<{
    id: string;
    displayName: string;
    hasSubtree: boolean;
  } | null>(null);
  const [mergeCollectionDialog, setMergeCollectionDialog] =
    useState<CollectionMergeDialogState | null>(null);
  const [moveUnderCollectionDialog, setMoveUnderCollectionDialog] =
    useState<CollectionMoveUnderDialogState | null>(null);
  const [collectionTemplateDialog, setCollectionTemplateDialog] =
    useState<CollectionTemplateDialogState | null>(null);
  const [collectionCloudSyncProgress, setCollectionCloudSyncProgress] =
    useState<{
      current: number;
      total: number;
      variant: "merge" | "layoutMove";
    } | null>(null);
  const collectionLayoutRemoteSync = useMemo(
    () => ({
      progress: (current: number, total: number) => {
        setCollectionCloudSyncProgress({
          current,
          total,
          variant: "layoutMove",
        });
      },
      end: () => setCollectionCloudSyncProgress(null),
    }),
    []
  );
  const [editingCollectionId, setEditingCollectionId] = useState<
    string | null
  >(null);
  const [draftCollectionName, setDraftCollectionName] = useState("");
  const collectionNameInputRef = useRef<HTMLInputElement>(null);
  const skipCollectionBlurCommitRef = useRef(false);
  const [editingHintCollectionId, setEditingHintCollectionId] = useState<
    string | null
  >(null);
  const [draftCollectionHint, setDraftCollectionHint] = useState("");
  const collectionHintTextareaRef = useRef<HTMLTextAreaElement>(null);
  const skipHintBlurCommitRef = useRef(false);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
    () => INITIAL_WORKSPACE.collapsedFolderIds
  );
  const [favoriteCollectionIds, setFavoriteCollectionIds] = useState<
    Set<string>
  >(() => new Set());
  const [recentCollectionIds, setRecentCollectionIds] = useState<string[]>(
    () => []
  );
  const [trashEntries, setTrashEntries] = useState<TrashedNoteEntry[]>([]);
  const [trashViewActive, setTrashViewActive] = useState(false);
  const [allNotesViewActive, setAllNotesViewActive] = useState(() => {
    try {
      if (getAppDataMode() === "local") {
        const k = activeCollectionStorageKey("local", null);
        return (
          readPersistedActiveCollectionId(k) === PERSISTED_WORKSPACE_ALL_NOTES
        );
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  const [allNotesVisibleCount, setAllNotesVisibleCount] = useState(
    TIMELINE_VIRTUAL_BATCH
  );
  const [collectionRestVisibleCount, setCollectionRestVisibleCount] = useState(
    TIMELINE_VIRTUAL_BATCH
  );
  const [calendarRestFlatVisibleCount, setCalendarRestFlatVisibleCount] =
    useState(TIMELINE_VIRTUAL_BATCH);
  const [searchGroupedCardsVisibleCount, setSearchGroupedCardsVisibleCount] =
    useState(TIMELINE_VIRTUAL_BATCH);
  const [remindersViewActive, setRemindersViewActive] = useState(() => {
    try {
      if (getAppDataMode() === "local") {
        const k = activeCollectionStorageKey("local", null);
        return (
          readPersistedActiveCollectionId(k) === PERSISTED_WORKSPACE_REMINDERS
        );
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  const [connectionsViewActive, setConnectionsViewActive] = useState(() => {
    try {
      if (typeof window !== "undefined" && matchesMobileChromeMedia()) {
        return false;
      }
      if (getAppDataMode() === "local") {
        const k = activeCollectionStorageKey("local", null);
        return (
          readPersistedActiveCollectionId(k) ===
          PERSISTED_WORKSPACE_CONNECTIONS
        );
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  /** 首次点开「笔记探索」后才扫描 relatedRefs，避免常驻全库遍历 */
  const [connectionsPrimed, setConnectionsPrimed] = useState(() => {
    try {
      if (typeof window !== "undefined" && matchesMobileChromeMedia()) {
        return false;
      }
      if (getAppDataMode() === "local") {
        const k = activeCollectionStorageKey("local", null);
        return (
          readPersistedActiveCollectionId(k) ===
          PERSISTED_WORKSPACE_CONNECTIONS
        );
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  const [attachmentsViewActive, setAttachmentsViewActive] = useState(() => {
    try {
      if (getAppDataMode() === "local") {
        const k = activeCollectionStorageKey("local", null);
        return (
          readPersistedActiveCollectionId(k) ===
          PERSISTED_WORKSPACE_ALL_ATTACHMENTS
        );
      }
    } catch {
      /* ignore */
    }
    return false;
  });
  const [attachmentsFilterKey, setAttachmentsFilterKey] =
    useState<AttachmentFilterKey>(() => readInitialAttachmentsFilterKey());
  const [attachmentsPreviewLayout, setAttachmentsPreviewLayout] = useState<
    "contain" | "square"
  >(() => readAttachmentsPreviewLayout());
  /** 持久化主区时读取，避免 persist 的 useEffect 先于 layout 恢复「全部笔记」而用旧闭包把 sentinel 盖成合集 id */
  const allNotesViewForPersistRef = useRef(allNotesViewActive);
  const activeIdForPersistRef = useRef(activeId);
  const remindersViewForPersistRef = useRef(remindersViewActive);
  const connectionsViewForPersistRef = useRef(connectionsViewActive);
  const attachmentsViewForPersistRef = useRef(attachmentsViewActive);
  const [draggingCollectionId, setDraggingCollectionId] = useState<
    string | null
  >(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    position: CollectionDropPosition;
  } | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const legacyNoteRootMigrationDoneRef = useRef<Set<string>>(new Set());
  /** 云端：首屏已展示（含本地快照）但 GET /collections 仍在进行 */
  const [remoteBootSyncing, setRemoteBootSyncing] = useState(false);
  /** 云端模式下仅在一次成功的 GET /collections 之后才开放写入（粒度化 API 内部自行检查） */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_remoteSaveAllowed, setRemoteSaveAllowed] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_apiOnline, setApiOnline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mediaUploadMode, setMediaUploadMode] = useState<
    "cos" | "local" | null
  >(null);
  const canAttachMedia = useMemo(
    () => Boolean(mediaUploadMode) || dataMode === "local",
    [mediaUploadMode, dataMode]
  );
  const [uploadBusyCardId, setUploadBusyCardId] = useState<string | null>(
    null
  );
  /** 附件上传 0–100（仅 `uploadBusyCardId` 对应卡片展示） */
  const [uploadCardProgress, setUploadCardProgress] = useState<number | null>(
    null
  );
  const [cardDragOverId, setCardDragOverId] = useState<string | null>(null);
  /** 正在拖动的小笔记（左侧条），用于半透明与清理放置高亮 */
  const [draggingNoteCardKey, setDraggingNoteCardKey] = useState<
    string | null
  >(null);
  type CardDropMarker = {
    colId: string;
    cardId: string;
    before: boolean;
  };
  const [cardDropMarker, setCardDropMarker] =
    useState<CardDropMarker | null>(null);
  const [noteCardDropCollectionId, setNoteCardDropCollectionId] = useState<
    string | null
  >(null);

  const cardMediaUploadTargetRef = useRef<{
    colId: string;
    cardId: string;
  } | null>(null);
  const cardMediaFileInputRef = useRef<HTMLInputElement>(null);
  /** 小笔记拖动会话：供 dragOver 识别（部分浏览器 types 不可靠） */
  const noteCardDragActiveRef = useRef(false);
  /** 合集拖拽 id：在 dragStart 同步写入，避免 state 晚一帧时 dragOver 未 preventDefault 导致无法放置 */
  const draggingCollectionIdRef = useRef<string | null>(null);

  const userAdmin = useUserAdmin({
    isAdmin,
    currentUserId: currentUser?.id,
    logout,
    refreshMe,
  });

  const { setCardText, flushPendingCardTextToRemote } =
    useCardTextRemoteAutosave(dataMode, setCollections);

  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [userProfileModalOpen, setUserProfileModalOpen] =
    useState(false);
  const [userNoteSettingsOpen, setUserNoteSettingsOpen] =
    useState(false);
  const [userDataStatsOpen, setUserDataStatsOpen] = useState(false);
  const [userAppleNotesImportOpen, setUserAppleNotesImportOpen] =
    useState(false);
  const [userFlomoImportOpen, setUserFlomoImportOpen] = useState(false);
  const [userEvernoteImportOpen, setUserEvernoteImportOpen] =
    useState(false);
  const [userYuqueImportOpen, setUserYuqueImportOpen] = useState(false);
  const [userAccountMenuOpen, setUserAccountMenuOpen] =
    useState(false);
  const [newNotePlacement, setNewNotePlacementState] =
    useState<NewNotePlacement>(readNewNotePlacement);
  const setNewNotePlacement = useCallback((p: NewNotePlacement) => {
    setNewNotePlacementState(p);
    saveNewNotePlacement(p);
  }, []);
  const [hideSidebarCollectionDots, setHideSidebarCollectionDotsState] =
    useState(readHideSidebarCollectionDots);
  const setHideSidebarCollectionDots = useCallback((hide: boolean) => {
    setHideSidebarCollectionDotsState(hide);
    saveHideSidebarCollectionDots(hide);
  }, []);
  const [timelineFoldBodyThreeLines, setTimelineFoldBodyThreeLinesState] =
    useState(readTimelineFoldBodyThreeLines);
  const setTimelineFoldBodyThreeLines = useCallback((on: boolean) => {
    setTimelineFoldBodyThreeLinesState(on);
    saveTimelineFoldBodyThreeLines(on);
  }, []);
  const [userNotePrefs, setUserNotePrefs] = useState<UserNotePrefs>(() =>
    loadLocalNotePrefs()
  );
  const userAccountMenuRef = useRef<HTMLDivElement>(null);
  const [sidebarFlash, setSidebarFlash] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileBrowseEditMode, setMobileBrowseEditMode] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  /** 窄屏或大屏触控平板（与 App.css 抽屉、`matchesMobileChromeMedia` 一致） */
  const [narrowUi, setNarrowUi] = useState(() =>
    matchesMobileChromeMedia()
  );
  /** 大屏触控平板（宽屏）：左侧合集栏固定露出，主区仍用手机布局 */
  const [tabletSplitNav, setTabletSplitNav] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia(TABLET_WIDE_TOUCH_MEDIA).matches
  );
  /** 横竖屏切换时重算平板列数上限（2/3） */
  const [layoutTick, setLayoutTick] = useState(0);
  const [relatedPanel, setRelatedPanel] = useState<{
    colId: string;
    cardId: string;
  } | null>(null);
  const mobileNavSelRef = useRef<{
    activeId: string;
    calendarDay: string | null;
  } | null>(null);
  /** 新建合集/子合集会改 activeId；勿因此关掉手机侧栏，便于当场改名称 */
  const skipCloseMobileNavOnActiveChangeRef = useRef(false);

  useEffect(() => {
    initTimelineColumnPreferenceIfNeeded();
    setTimelineColumnPrefState(readTimelineColumnPreferenceFromStorage());
  }, []);

  const commitTimelineColumnPref = useCallback(
    (p: TimelineColumnPreference) => {
      setTimelineColumnPrefState(p);
      writeTimelineColumnPreferenceToStorage(p);
    },
    []
  );

  useEffect(() => {
    const bump = () => setLayoutTick((n) => n + 1);
    window.addEventListener("orientationchange", bump);
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("orientationchange", bump);
      window.removeEventListener("resize", bump);
    };
  }, []);

  /**
   * 手机（视口≤900）：最多 2 列；
   * 大屏触控平板：竖屏最多 2 列，横屏最多 3 列；
   * 桌面：不限制。
   */
  const columnLayoutProfile = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        desktop: true as const,
        cap: 6,
        steps: [...TIMELINE_COLUMN_STEPS_WIDE],
      };
    }
    if (!matchesMobileChromeMedia()) {
      return {
        desktop: true as const,
        cap: 6,
        steps: [...TIMELINE_COLUMN_STEPS_WIDE],
      };
    }
    const phoneNarrow = window.matchMedia("(max-width: 900px)").matches;
    const tabletWide = window.matchMedia(TABLET_WIDE_TOUCH_MEDIA).matches;
    const landscape =
      window.matchMedia("(orientation: landscape)").matches;
    if (phoneNarrow) {
      return {
        desktop: false as const,
        cap: 2,
        steps: [1, 2] as const,
      };
    }
    if (tabletWide) {
      if (landscape) {
        return {
          desktop: false as const,
          cap: 3,
          steps: [1, 2, 3] as const,
        };
      }
      return {
        desktop: false as const,
        cap: 2,
        steps: [1, 2] as const,
      };
    }
    return { desktop: false as const, cap: 2, steps: [1, 2] as const };
  }, [narrowUi, layoutTick]);

  const timelineColumnCount = useMemo((): 1 | 2 | 3 | 4 | 5 | 6 => {
    if (columnLayoutProfile.desktop) return timelineColumnPref;
    return Math.min(
      timelineColumnPref,
      columnLayoutProfile.cap
    ) as 1 | 2 | 3 | 4 | 5 | 6;
  }, [columnLayoutProfile, timelineColumnPref]);

  const columnStepList = useMemo(
    () => [...columnLayoutProfile.steps],
    [columnLayoutProfile]
  );

  const columnStepIndex = useMemo(() => {
    const i = columnStepList.indexOf(timelineColumnCount);
    return i >= 0 ? i : 0;
  }, [columnStepList, timelineColumnCount]);

  const stepColumnPrefUp = useCallback(() => {
    const next = columnStepList[columnStepIndex + 1];
    if (next !== undefined) commitTimelineColumnPref(next);
  }, [columnStepList, columnStepIndex, commitTimelineColumnPref]);

  const stepColumnPrefDown = useCallback(() => {
    const next = columnStepList[columnStepIndex - 1];
    if (next !== undefined) commitTimelineColumnPref(next);
  }, [columnStepList, columnStepIndex, commitTimelineColumnPref]);

  /** 手机等仅 1/2 两档时：单键在单列 ⟷ 双列间切换（与旧版图标一致） */
  const toggleBinaryTimelineColumns = useCallback(() => {
    if (columnStepList.length !== 2) return;
    const a = columnStepList[0];
    const b = columnStepList[1];
    commitTimelineColumnPref(timelineColumnCount === a ? b : a);
  }, [columnStepList, timelineColumnCount, commitTimelineColumnPref]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_CHROME_MEDIA);
    const onMq = () => {
      setNarrowUi(mq.matches);
      if (!mq.matches) {
        setMobileNavOpen(false);
        setMobileCalendarOpen(false);
      }
    };
    onMq();
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  /** 窄屏无「笔记探索」入口（文件保留，手机端也要能进「文件」视图） */
  useEffect(() => {
    if (!narrowUi) return;
    if (!connectionsViewActive) return;
    setConnectionsViewActive(false);
    setAllNotesViewActive(true);
  }, [narrowUi, connectionsViewActive]);

  useEffect(() => {
    const mq = window.matchMedia(TABLET_WIDE_TOUCH_MEDIA);
    const onMq = () => setTabletSplitNav(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  /** 进入平板分栏时收起「抽屉」态，避免 body overflow 被锁死 */
  useEffect(() => {
    if (tabletSplitNav) setMobileNavOpen(false);
  }, [tabletSplitNav]);

  /** 手机抽屉打开或平板固定侧栏：侧栏按手机「浏览态」展示 */
  const showMobileSidebarBrowseChrome =
    mobileNavOpen || tabletSplitNav;

  useEffect(() => {
    if (!mobileNavOpen && !tabletSplitNav) setMobileBrowseEditMode(false);
  }, [mobileNavOpen, tabletSplitNav]);

  useEffect(() => {
    const lockScroll =
      mobileNavOpen ||
      mobileCalendarOpen ||
      relatedPanel !== null;
    if (!lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen, mobileCalendarOpen, relatedPanel]);

  useEffect(() => {
    if (!relatedPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRelatedPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [relatedPanel]);

  /** 小屏「相关笔记」全屏样式（portal 在 body，用 class 驱动） */
  useEffect(() => {
    if (!relatedPanel) {
      document.body.classList.remove("app--related-panel-open");
      return;
    }
    document.body.classList.add("app--related-panel-open");
    return () => {
      document.body.classList.remove("app--related-panel-open");
    };
  }, [relatedPanel]);

  /** 笔记全页：html/body 与主区同为白底，避免底部安全区露出灰底 */
  useEffect(() => {
    const cl = "app--card-page-open";
    if (cardPageCard) document.body.classList.add(cl);
    else document.body.classList.remove(cl);
    return () => document.body.classList.remove(cl);
  }, [cardPageCard]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileCalendarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileCalendarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileCalendarOpen]);

  useEffect(() => {
    const cur = { activeId, calendarDay };
    if (mobileNavSelRef.current === null) {
      mobileNavSelRef.current = cur;
      return;
    }
    const prev = mobileNavSelRef.current;
    mobileNavSelRef.current = cur;
    if (
      prev.activeId !== cur.activeId ||
      prev.calendarDay !== cur.calendarDay
    ) {
      if (skipCloseMobileNavOnActiveChangeRef.current) {
        skipCloseMobileNavOnActiveChangeRef.current = false;
      } else {
        setMobileNavOpen(false);
      }
    }
  }, [activeId, calendarDay]);

  useEffect(() => {
    if (!sidebarFlash) return;
    const t = window.setTimeout(() => setSidebarFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [sidebarFlash]);

  useEffect(() => {
    if (!userAccountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = userAccountMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setUserAccountMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [userAccountMenuOpen]);

  useEffect(() => {
    if (!mobileNavOpen && !tabletSplitNav) setUserAccountMenuOpen(false);
  }, [mobileNavOpen, tabletSplitNav]);

  useEffect(() => {
    if (!currentUser) {
      setUserAccountMenuOpen(false);
      setUserNoteSettingsOpen(false);
    }
  }, [currentUser]);

  useEffect(() => {
    const clear = () => setCardDragOverId(null);
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  useRemoteCollectionsSync({
    authReady,
    dataMode,
    appUiLang,
    writeRequiresLogin,
    currentUser,
    getCollectionsForMerge,
    flushPendingTextBeforeRemoteFetch: flushPendingCardTextToRemote,
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
  });

  const refreshRemotePreferences = useCallback(async () => {
    if (dataMode !== "remote" || !remoteLoaded) return;
    if (writeRequiresLogin && !currentUser && !getAdminToken()) return;
    const [ids, entries] = await Promise.all([
      fetchMeFavorites(),
      fetchMeTrash(),
    ]);
    if (ids !== null) setFavoriteCollectionIds(new Set(ids));
    if (entries !== null) setTrashEntries(entries);
  }, [dataMode, remoteLoaded, writeRequiresLogin, currentUser]);

  useCollectionsRemotePush({
    authReady,
    dataMode,
    remoteLoaded,
    writeRequiresLogin,
    currentUserId: currentUser?.id,
    getCollectionsForMerge,
    flushPendingTextBeforePull: flushPendingCardTextToRemote,
    setCollections,
    setLoadError,
    setApiOnline,
    refreshRemotePreferences,
  });

  /* 懒加载端点探针：仅 VITE_LAZY_COLLECTIONS=1 时启动后跑一遍新端点，日志到 console。
     不改 UI 行为，用于验证 PR 1/2 的后端端点部署后是否可用。 */
  useLazyEndpointsProbe({
    ready: dataMode === "remote" && remoteLoaded,
  });

  /** 云端模式下在首次 remote 就绪前盖住主区（含未登录时等健康检查、登录后等 GET 合集） */
  const showRemoteLoading = useMemo(
    () => authReady && dataMode === "remote" && !remoteLoaded,
    [authReady, dataMode, remoteLoaded]
  );

  const ptrEnabled = useMemo(
    () =>
      authReady &&
      !showRemoteLoading &&
      (dataMode === "local" ||
        (dataMode === "remote" && remoteLoaded)),
    [authReady, showRemoteLoading, dataMode, remoteLoaded]
  );

  const resyncRemoteCollectionsTree = useCallback(
    async (opts?: {
      /** 仅对齐合集树时用：省掉收藏夹+回收站两次请求，明显快于默认全量刷新 */
      skipPreferenceRefresh?: boolean;
    }): Promise<Collection[] | null> => {
      if (dataMode !== "remote") return null;
      if (writeRequiresLogin && !currentUser && !getAdminToken()) {
        return null;
      }
      await flushPendingCardTextToRemote();
      const data = await fetchCollectionsFromApi();
      if (data === null) {
        setLoadError((prev) => prev ?? c.syncLoadFail);
        setApiOnline(false);
        return null;
      }
      setLoadError(null);
      setApiOnline(true);
      const tree = migrateCollectionTree(data);
      const merged = mergeServerTreeWithLocalExtraCards(
        tree,
        collectionsRef.current
      );
      setCollections(merged);
      const sk = remoteSnapshotUserKey(
        writeRequiresLogin,
        currentUser?.id?.trim() || null
      );
      if (sk) saveRemoteCollectionsSnapshot(sk, merged);
      if (!opts?.skipPreferenceRefresh) {
        await refreshRemotePreferences();
      }
      return merged;
    },
    [
      dataMode,
      c.syncLoadFail,
      writeRequiresLogin,
      currentUser,
      setCollections,
      setLoadError,
      setApiOnline,
      refreshRemotePreferences,
      flushPendingCardTextToRemote,
    ]
  );

  /** 设置里启用对象类型后：拉树 + 展开侧栏分区与文件夹，保证新类型立刻可见 */
  const onNoteSettingsCollectionsChange = useCallback(
    async (ctx?: { enabledCollectionId?: string; presetTypeId?: string }) => {
      const merged = await resyncRemoteCollectionsTree({
        skipPreferenceRefresh: true,
      });
      if (ctx?.enabledCollectionId && merged) {
        const ancestors = ancestorIdsFor(merged, ctx.enabledCollectionId);
        if (ancestors.length > 0) {
          setCollapsedFolderIds((prev) => {
            const next = new Set(prev);
            ancestors.forEach((id) => next.delete(id));
            return next;
          });
        }
      }
      const pid = ctx?.presetTypeId ?? "";
      const base = presetCatalogBaseIdForPresetTypeId(pid);
      if (base) {
        setSidebarSectionCollapsed((prev) => {
          const n = { ...prev };
          n.notes = false;
          if (base === "file") n.files = false;
          if (base === "clip") n.clip = false;
          if (base === "topic") n.topic = false;
          if (base === "task") n.task = false;
          if (base === "project") n.project = false;
          if (base === "expense") n.expense = false;
          if (base === "account") n.account = false;
          return n;
        });
      }
    },
    [resyncRemoteCollectionsTree, setCollapsedFolderIds, setSidebarSectionCollapsed]
  );

  useEffect(() => {
    if (!authReady) return;
    if (dataMode === "remote" && !remoteLoaded) return;

    const scopeKey =
      dataMode === "remote"
        ? `remote:${currentUser?.id?.trim() || "signed-out"}`
        : "local";
    if (legacyNoteRootMigrationDoneRef.current.has(scopeKey)) return;

    const noteRoot = findCollectionByPresetType(collections, "note");
    if (!noteRoot) {
      legacyNoteRootMigrationDoneRef.current.add(scopeKey);
      return;
    }
    if (dataMode === "remote" && !canEdit) {
      legacyNoteRootMigrationDoneRef.current.add(scopeKey);
      return;
    }

    const movableRootIds = collectLegacyRootCollectionsForNotesMigration(
      collections,
      noteRoot.id
    );
    if (movableRootIds.length === 0) {
      legacyNoteRootMigrationDoneRef.current.add(scopeKey);
      return;
    }

    const previousTree = collections;
    let nextTree = previousTree;
    for (const rootId of movableRootIds) {
      nextTree = moveCollectionInTree(nextTree, rootId, noteRoot.id, "inside");
    }
    legacyNoteRootMigrationDoneRef.current.add(scopeKey);
    setCollections(nextTree);
    setSidebarSectionCollapsed((prev) => ({ ...prev, notes: false }));
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(noteRoot.id);
      return next;
    });

    if (dataMode !== "remote") return;
    void (async () => {
      const ok = await persistCollectionTreeLayoutRemoteWithRetry(
        nextTree,
        undefined,
        previousTree
      );
      if (!ok) {
        legacyNoteRootMigrationDoneRef.current.delete(scopeKey);
        await resyncRemoteCollectionsTree();
      }
    })();
  }, [
    authReady,
    dataMode,
    remoteLoaded,
    currentUser?.id,
    canEdit,
    collections,
    setCollections,
    setSidebarSectionCollapsed,
    setCollapsedFolderIds,
    resyncRemoteCollectionsTree,
  ]);

  const handleTimelinePullRefresh = useCallback(async () => {
    if (dataMode === "remote") {
      await resyncRemoteCollectionsTree();
      return;
    }
    const cols = loadLocalCollections(() =>
      cloneInitialCollections(appUiLang)
    );
    setCollections(cols);
    const localKey = activeCollectionStorageKey("local", null);
    const collapsedKey = collapsedFoldersStorageKey("local", null);
    setActiveId((prev) =>
      findCollectionById(cols, prev)
        ? prev
        : resolveActiveCollectionId(
            cols,
            readPersistedActiveCollectionId(localKey)
          )
    );
    setCollapsedFolderIds(
      pruneCollapsedFolderIds(
        cols,
        readCollapsedFolderIdsFromStorage(collapsedKey)
      )
    );
  }, [
    dataMode,
    appUiLang,
    resyncRemoteCollectionsTree,
    setCollections,
    setActiveId,
    setCollapsedFolderIds,
  ]);

  const { pullOffset: timelinePullOffset, refreshing: timelinePtrRefreshing } =
    usePullToRefresh({
      scrollRef: timelineRef,
      onRefresh: handleTimelinePullRefresh,
      enabled: ptrEnabled,
    });

  const blockMainEdgeSwipe = useMemo(
    () =>
      mobileNavOpen ||
      tabletSplitNav ||
      mobileCalendarOpen ||
      relatedPanel !== null ||
      detailCard !== null ||
      userAdmin.userAdminOpen ||
      userProfileModalOpen ||
      userNoteSettingsOpen ||
      userDataStatsOpen ||
      userAppleNotesImportOpen ||
      userFlomoImportOpen ||
      userEvernoteImportOpen ||
      userYuqueImportOpen ||
      reminderPicker !== null ||
      collectionDeleteDialog !== null ||
      mergeCollectionDialog !== null ||
      moveUnderCollectionDialog !== null ||
      collectionCloudSyncProgress !== null ||
      showRemoteLoading,
    [
      mobileNavOpen,
      tabletSplitNav,
      mobileCalendarOpen,
      relatedPanel,
      detailCard,
      userAdmin.userAdminOpen,
      userProfileModalOpen,
      userNoteSettingsOpen,
      userDataStatsOpen,
      userAppleNotesImportOpen,
      userFlomoImportOpen,
      userEvernoteImportOpen,
      userYuqueImportOpen,
      reminderPicker,
      collectionDeleteDialog,
      mergeCollectionDialog,
      moveUnderCollectionDialog,
      collectionCloudSyncProgress,
      showRemoteLoading,
    ]
  );

  const {
    onMobileMainTouchStart,
    onMobileMainTouchEnd,
    onMobileMainTouchCancel,
    onMobileSidebarTouchStart,
    onMobileSidebarTouchEnd,
    onMobileSidebarTouchCancel,
  } = useMobileNavSwipe({
    mobileNavOpen,
    setMobileNavOpen,
    showRemoteLoading,
    blockMainEdgeSwipe,
  });

  useEffect(() => {
    setRecentCollectionIds(loadRecentCollectionIds(recentCollectionsKey));
  }, [recentCollectionsKey]);

  useEffect(() => {
    if (!authReady) return;
    if (dataMode === "local") {
      setFavoriteCollectionIds(loadFavoriteCollectionIds(favoriteStorageKey));
      setTrashEntries(loadTrashedNoteEntries(trashStorageKey));
      return;
    }
    if (!remoteLoaded) return;
    if (writeRequiresLogin && !currentUser && !getAdminToken()) {
      setFavoriteCollectionIds(new Set());
      setTrashEntries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [ids, entries] = await Promise.all([
        fetchMeFavorites(),
        fetchMeTrash(),
      ]);
      if (cancelled) return;
      if (ids !== null) setFavoriteCollectionIds(new Set(ids));
      if (entries !== null) setTrashEntries(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    dataMode,
    remoteLoaded,
    writeRequiresLogin,
    currentUser?.id,
    favoriteStorageKey,
    trashStorageKey,
  ]);

  useEffect(() => {
    if (!authReady || !remoteLoaded || dataMode !== "remote") return;
    if (writeRequiresLogin && !currentUser?.id?.trim() && !getAdminToken()) {
      return;
    }
    let cancelled = false;
    void fetchMeNotePrefs().then((r) => {
      if (cancelled || !r) return;
      saveLocalNotePrefs(r);
      setUserNotePrefs(r);
    });
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    remoteLoaded,
    dataMode,
    writeRequiresLogin,
    currentUser?.id,
  ]);

  useEffect(() => {
    if (userNoteSettingsOpen) return;
    setUserNotePrefs(loadLocalNotePrefs());
  }, [userNoteSettingsOpen]);

  useEffect(() => {
    if (calendarDay) {
      setTrashViewActive(false);
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
      setAttachmentsViewActive(false);
      setRemindersViewActive(false);
    }
  }, [calendarDay]);

  useEffect(() => {
    if (trashViewActive) {
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
      setAttachmentsViewActive(false);
      setRemindersViewActive(false);
    }
  }, [trashViewActive]);

  useEffect(() => {
    if (remindersViewActive) {
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
      setAttachmentsViewActive(false);
    }
  }, [remindersViewActive]);

  useEffect(() => {
    if (allNotesViewActive) {
      setRemindersViewActive(false);
      setConnectionsViewActive(false);
      setAttachmentsViewActive(false);
    }
  }, [allNotesViewActive]);

  useEffect(() => {
    if (connectionsViewActive) {
      setAllNotesViewActive(false);
      setRemindersViewActive(false);
      setAttachmentsViewActive(false);
    }
  }, [connectionsViewActive]);

  useEffect(() => {
    if (attachmentsViewActive) {
      setAllNotesViewActive(false);
      setRemindersViewActive(false);
      setConnectionsViewActive(false);
    }
  }, [attachmentsViewActive]);

  useEffect(() => {
    if (!remoteLoaded || !authReady) return;
    const valid = new Set<string>();
    walkCollections(collections, (c) => valid.add(c.id));
    setFavoriteCollectionIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      if (next.size === prev.size) return prev;
      if (dataMode === "local") {
        saveFavoriteCollectionIds(favoriteStorageKey, next);
      } else if (canEdit) {
        void putMeFavorites([...next]);
      }
      return next;
    });
  }, [
    collections,
    remoteLoaded,
    authReady,
    favoriteStorageKey,
    dataMode,
    canEdit,
  ]);

  useEffect(() => {
    if (!remoteLoaded || !authReady) return;

    if (dataMode === "local") {
      const id = window.setTimeout(() => {
        try {
          saveLocalCollections(collections);
          setSaveError(null);
        } catch (e) {
          const quota =
            e instanceof DOMException && e.name === "QuotaExceededError";
          setSaveError(
            quota ? c.errLocalQuota : c.errLocalSave
          );
        }
      }, 900);
      return () => window.clearTimeout(id);
    }

    // remote 模式：各操作函数已单独持久化到 PostgreSQL，不再做全量 PUT
  }, [
    collections,
    dataMode,
    remoteLoaded,
    authReady,
    appUiLang,
  ]);

  const active = useMemo(() => {
    const found = findCollectionById(collections, activeId);
    if (found) return found;
    return collections[0];
  }, [collections, activeId]);

  /** 「已归档」顶层特殊合集（与「笔记」「主题」同级）：按名称识别；用于专属侧栏段与 rail 定位 */
  const archivedCol = useMemo<Collection | null>(() => {
    let found: Collection | null = null;
    walkCollections(collections, (col) => {
      if (found) return;
      if (col.name === "已归档") found = col;
    });
    return found;
  }, [collections]);

  const archivedColId = archivedCol?.id ?? null;

  /** 单合集时间线顶栏：嵌套合集显示「父 / 子」面包屑（仅非特殊视图时） */
  const mainHeadingCollectionPath = useMemo((): Collection[] | null => {
    if (
      searchQuery.trim().length > 0 ||
      trashViewActive ||
      allNotesViewActive ||
      connectionsViewActive ||
      attachmentsViewActive ||
      remindersViewActive ||
      calendarDay !== null
    ) {
      return null;
    }
    // 概览模式：activeId 为空时 active 会兜底到第一张合集，这里不应给 active 建面包屑
    if (!activeId) return null;
    if (!active?.id) return null;
    return findCollectionPathFromRoot(collections, active.id);
  }, [
    collections,
    activeId,
    active?.id,
    searchQuery,
    trashViewActive,
    allNotesViewActive,
    connectionsViewActive,
    attachmentsViewActive,
    remindersViewActive,
    calendarDay,
  ]);

  const importTargetColId = useMemo(() => {
    if (allNotesViewActive || remindersViewActive) {
      return LOOSE_NOTES_COLLECTION_ID;
    }
    return active?.id ?? "";
  }, [allNotesViewActive, remindersViewActive, active?.id]);

  const importTargetLabel = useMemo(() => {
    if (allNotesViewActive) return c.titleAllNotes;
    if (remindersViewActive) return c.titleReminders;
    if (active?.name) return active.name;
    return c.titleNoCollection;
  }, [
    allNotesViewActive,
    remindersViewActive,
    active?.name,
    c.titleAllNotes,
    c.titleReminders,
    c.titleNoCollection,
  ]);

  const importAppleNotesBlockedHint = useMemo(() => {
    if (!canEdit) return c.importAppleNotesBlockedNoEdit;
    if (trashViewActive) return c.importAppleNotesBlockedTrash;
    if (connectionsViewActive) return c.importAppleNotesBlockedConnections;
    if (attachmentsViewActive) return c.importAppleNotesBlockedAttachments;
    if (remindersViewActive) return c.importAppleNotesBlockedReminders;
    if (calendarDay !== null) return c.importAppleNotesBlockedCalendar;
    if (searchQuery.trim().length > 0) return c.importAppleNotesBlockedSearch;
    if (!importTargetColId) return c.importAppleNotesBlockedNoCollection;
    return undefined;
  }, [
    canEdit,
    trashViewActive,
    connectionsViewActive,
    attachmentsViewActive,
    remindersViewActive,
    calendarDay,
    searchQuery,
    importTargetColId,
    c.importAppleNotesBlockedNoEdit,
    c.importAppleNotesBlockedTrash,
    c.importAppleNotesBlockedConnections,
    c.importAppleNotesBlockedAttachments,
    c.importAppleNotesBlockedReminders,
    c.importAppleNotesBlockedCalendar,
    c.importAppleNotesBlockedSearch,
    c.importAppleNotesBlockedNoCollection,
  ]);

  allNotesViewForPersistRef.current = allNotesViewActive;
  activeIdForPersistRef.current = activeId;
  remindersViewForPersistRef.current = remindersViewActive;
  connectionsViewForPersistRef.current = connectionsViewActive;
  attachmentsViewForPersistRef.current = attachmentsViewActive;

  useEffect(() => {
    if (activeId && !findCollectionById(collections, activeId)) {
      setActiveId(collections[0]?.id ?? "");
    }
  }, [collections, activeId]);

  /** 在 passive effect 写入 localStorage 之前恢复「全部笔记 / 待办 / 笔记探索」，避免 persist 用旧状态覆盖 sentinel（React 18 在 layout effect 内批处理 setState，勿用 flushSync） */
  useLayoutEffect(() => {
    if (!authReady) return;
    if (dataMode === "remote" && !remoteLoaded) return;
    try {
      const raw = readPersistedActiveCollectionId(activeCollectionKey);
      const attachmentFilterStoreKey = attachmentsFilterStorageKey(
        dataMode,
        currentUser?.id ?? null
      );
      const savedAttachmentFilter =
        readPersistedAttachmentsFilterKey(attachmentFilterStoreKey);

      if (raw === PERSISTED_WORKSPACE_OVERVIEW) {
        setAllNotesViewActive(false);
        setRemindersViewActive(false);
        setConnectionsViewActive(false);
        setAttachmentsViewActive(false);
        setActiveId("");
      } else if (raw === PERSISTED_WORKSPACE_ALL_NOTES) {
        setAllNotesViewActive(true);
        setRemindersViewActive(false);
        setConnectionsViewActive(false);
        setAttachmentsViewActive(false);
      } else if (raw === PERSISTED_WORKSPACE_REMINDERS) {
        setRemindersViewActive(true);
        setAllNotesViewActive(false);
        setConnectionsViewActive(false);
        setAttachmentsViewActive(false);
      } else if (raw === PERSISTED_WORKSPACE_CONNECTIONS) {
        if (matchesMobileChromeMedia()) {
          setConnectionsViewActive(false);
          setConnectionsPrimed(false);
          setAllNotesViewActive(true);
          setRemindersViewActive(false);
          setAttachmentsViewActive(false);
        } else {
          setConnectionsViewActive(true);
          setConnectionsPrimed(true);
          setAllNotesViewActive(false);
          setRemindersViewActive(false);
          setAttachmentsViewActive(false);
        }
      } else if (raw === PERSISTED_WORKSPACE_ALL_ATTACHMENTS) {
        setAttachmentsViewActive(true);
        setAllNotesViewActive(false);
        setRemindersViewActive(false);
        setConnectionsViewActive(false);
        setConnectionsPrimed(false);
      }
      if (savedAttachmentFilter) {
        setAttachmentsFilterKey(savedAttachmentFilter);
      }
    } catch {
      /* ignore */
    }
  }, [authReady, dataMode, remoteLoaded, activeCollectionKey, currentUser?.id]);

  /** 刷新后持久化主区：全部笔记 / 待办 / 笔记探索（sentinel）或选中合集 id */
  useEffect(() => {
    if (!authReady) return;
    if (dataMode === "remote" && !remoteLoaded) return;
    try {
      const allNotes = allNotesViewForPersistRef.current;
      const reminders = remindersViewForPersistRef.current;
      const connections = connectionsViewForPersistRef.current;
      const attachments = attachmentsViewForPersistRef.current;
      const aid = activeIdForPersistRef.current;
      if (allNotes) {
        localStorage.setItem(
          activeCollectionKey,
          PERSISTED_WORKSPACE_ALL_NOTES
        );
      } else if (reminders) {
        localStorage.setItem(
          activeCollectionKey,
          PERSISTED_WORKSPACE_REMINDERS
        );
      } else if (connections) {
        localStorage.setItem(
          activeCollectionKey,
          PERSISTED_WORKSPACE_CONNECTIONS
        );
      } else if (attachments) {
        localStorage.setItem(
          activeCollectionKey,
          PERSISTED_WORKSPACE_ALL_ATTACHMENTS
        );
      } else if (aid) {
        localStorage.setItem(activeCollectionKey, aid);
      } else {
        localStorage.setItem(
          activeCollectionKey,
          PERSISTED_WORKSPACE_OVERVIEW
        );
      }
    } catch {
      /* ignore */
    }
  }, [
    activeId,
    allNotesViewActive,
    remindersViewActive,
    connectionsViewActive,
    attachmentsViewActive,
    activeCollectionKey,
    authReady,
    dataMode,
    remoteLoaded,
  ]);

  /** 「文件」类型筛选：刷新后保持，与主区模式 / 用户分键 */
  useEffect(() => {
    if (!authReady) return;
    if (dataMode === "remote" && !remoteLoaded) return;
    try {
      writePersistedAttachmentsFilterKey(
        attachmentsFilterStorageKey(dataMode, currentUser?.id ?? null),
        attachmentsFilterKey
      );
    } catch {
      /* ignore */
    }
  }, [
    attachmentsFilterKey,
    authReady,
    dataMode,
    remoteLoaded,
    currentUser?.id,
  ]);

  /** 侧栏子合集折叠状态（与当前合集同样按模式与用户区分） */
  useEffect(() => {
    if (!authReady) return;
    if (dataMode === "remote" && !remoteLoaded) return;
    try {
      localStorage.setItem(
        collapsedFoldersKey,
        JSON.stringify([...collapsedFolderIds].sort())
      );
    } catch {
      /* ignore */
    }
  }, [
    collapsedFolderIds,
    collapsedFoldersKey,
    authReady,
    dataMode,
    remoteLoaded,
  ]);

  /** 树结构变化时剔除已不存在合集的折叠记录（不写回存储，交给上一 effect） */
  useEffect(() => {
    setCollapsedFolderIds((prev) => {
      const next = pruneCollapsedFolderIds(collections, prev);
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
        return prev;
      }
      return next;
    });
  }, [collections]);

  const activeNoteCards = useMemo(() => {
    if (!active) return [];
    /** 所有合集（含预设根、子类型、用户文件夹）都把整棵子树的卡聚合进来，
     *  避免「在 任务 / 待办 创建的卡在 任务 / 待办 / 2026 子合集里看不到」之类。 */
    const out: NoteCard[] = [];
    const seen = new Set<string>();
    const walk = (col: Collection) => {
      for (const card of col.cards ?? []) {
        if (isFileCard(card)) continue;
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        out.push(card);
      }
      for (const ch of col.children ?? []) walk(ch);
    };
    walk(active);
    return out;
  }, [active]);

  const { pinned, rest } = useMemo(
    () => splitPinnedCards(activeNoteCards),
    [activeNoteCards]
  );

  const restDisplayed = useMemo(
    () => rest.slice(0, collectionRestVisibleCount),
    [rest, collectionRestVisibleCount]
  );

  const datesWithNotesOnCalendarSet = useMemo(
    () => datesWithNoteAddedOn(collections),
    [collections]
  );
  const datesWithRemindersOnCalendarSet = useMemo(
    () => datesWithReminderOn(collections),
    [collections]
  );

  const allReminderEntries = useMemo(
    () => collectAllReminderEntries(collections),
    [collections]
  );

  const topicParentCol = useMemo(
    () => findCollectionByPresetType(collections, "topic"),
    [collections]
  );
  /** 主题区标题点击目标：优先「主题」父合集，否则第一个已存在的子类型合集（兼容无父级的旧数据） */
  const topicNavRootCol = useMemo(() => {
    if (topicParentCol) return topicParentCol;
    for (const item of TOPIC_PRESET_SUBTYPE_ITEMS) {
      const col = findCollectionByPresetType(collections, item.id);
      if (col) return col;
    }
    return null;
  }, [collections, topicParentCol]);
  /** 剪藏父合集；兼容旧库中仍用 preset「post」作父级的情况 */
  const clipParentCol = useMemo(() => {
    return (
      findCollectionByPresetType(collections, "clip") ??
      findCollectionByPresetType(collections, "post")
    );
  }, [collections]);
  const topicSectionCount = useMemo(() => {
    if (topicParentCol) return countCollectionSubtreeCards(topicParentCol);
    let sum = 0;
    let has = false;
    for (const item of TOPIC_PRESET_SUBTYPE_ITEMS) {
      const col = findCollectionByPresetType(collections, item.id);
      if (col) {
        has = true;
        sum += countCollectionSubtreeCards(col);
      }
    }
    return has ? sum : ("–" as const);
  }, [collections, topicParentCol]);
  const topicSubtypeCols = useMemo(
    () => collectSidebarSubtypeRows(topicNavRootCol),
    [topicNavRootCol]
  );
  const clipSectionCount = useMemo(() => {
    if (!clipParentCol) return "–" as const;
    return countCollectionSubtreeCards(clipParentCol);
  }, [clipParentCol]);
  const clipSubtypeCols = useMemo(
    () => collectSidebarSubtypeRows(clipParentCol),
    [clipParentCol]
  );

  const noteNavRootCol = useMemo(() => {
    return findCollectionByPresetType(collections, "note");
  }, [collections]);

  const archivedSubtreeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!archivedCol) return ids;
    const stack: Collection[] = [archivedCol];
    while (stack.length) {
      const n = stack.pop()!;
      ids.add(n.id);
      if (n.children?.length) stack.push(...n.children);
    }
    return ids;
  }, [archivedCol]);

  const collectionsForArchivedSidebar = useMemo(
    () => archivedCol?.children ?? [],
    [archivedCol]
  );

  const archivedSectionCount = useMemo(
    () => (archivedCol ? countCollectionSubtreeCards(archivedCol) : 0),
    [archivedCol]
  );

  const collectionsForNotesSidebar = useMemo(
    () =>
      noteNavRootCol?.children?.filter(
        (c) => c.id !== LOOSE_NOTES_COLLECTION_ID
      ) ?? filterPlainFolderCollectionsForNotesSidebar(collections),
    [collections, noteNavRootCol]
  );


  const allMediaAttachmentEntries = useMemo(() => {
    if (dataMode === "remote") return [];
    return collectAllMediaAttachmentEntries(collections);
  }, [collections, dataMode]);

  const localAttachmentCountsByCategory = useMemo(() => {
    const counts: Record<AttachmentUiCategory, number> = {
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
      other: 0,
    };
    for (const entry of allMediaAttachmentEntries) {
      counts[getAttachmentUiCategory(entry.item)]++;
    }
    return counts;
  }, [allMediaAttachmentEntries]);

  const [remoteAttachmentsTotal, setRemoteAttachmentsTotal] = useState<
    number | null
  >(null);

  const [remoteAttachmentCountsByCategory, setRemoteAttachmentCountsByCategory] =
    useState<Partial<Record<AttachmentUiCategory, number | null>>>({});

  useEffect(() => {
    if (dataMode !== "remote" || !remoteLoaded) {
      setRemoteAttachmentsTotal(null);
      return;
    }
    let cancelled = false;
    void fetchMeAttachmentsCount("all").then((n) => {
      if (!cancelled && n != null) setRemoteAttachmentsTotal(n);
    });
    return () => {
      cancelled = true;
    };
  }, [dataMode, remoteLoaded, attachmentsViewActive]);

  /** 远程模式下卡片附件增删后刷新侧边栏总数，并驱动「文件」列表重新拉取 */
  const [attachmentsRemoteListNonce, setAttachmentsRemoteListNonce] =
    useState(0);
  const notifyRemoteAttachmentsChanged = useCallback(() => {
    if (dataMode !== "remote" || !remoteLoaded) return;
    clearRemoteAttachmentsListCacheForUser(
      currentUser?.id?.trim() || "anon"
    );
    void fetchMeAttachmentsCount("all").then((n) => {
      if (n != null) setRemoteAttachmentsTotal(n);
    });
    setAttachmentsRemoteListNonce((x) => x + 1);
  }, [dataMode, remoteLoaded, currentUser?.id]);

  useEffect(() => {
    if (dataMode !== "remote" || !remoteLoaded) {
      setRemoteAttachmentCountsByCategory({});
      return;
    }
    const cats: AttachmentUiCategory[] = [
      "image",
      "video",
      "audio",
      "document",
      "other",
    ];
    let cancelled = false;
    void Promise.all(cats.map((k) => fetchMeAttachmentsCount(k))).then(
      (results) => {
        if (cancelled) return;
        const next: Partial<Record<AttachmentUiCategory, number | null>> = {};
        cats.forEach((k, i) => {
          next[k] = results[i];
        });
        setRemoteAttachmentCountsByCategory(next);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [dataMode, remoteLoaded, attachmentsRemoteListNonce]);

  const createFileCardFromNoteAttachment = useCallback(
    async (colId: string, cardId: string, item: NoteMediaItem) => {
      if (dataMode !== "remote") return;
      const res = await createFileCardForNoteMediaApi(cardId, {
        placementCollectionId: colId,
        media: item,
      });
      if (!res) {
        window.alert(c.errCreateFileCard);
        return;
      }
      await resyncRemoteCollectionsTree();
      notifyRemoteAttachmentsChanged();
    },
    [
      dataMode,
      c.errCreateFileCard,
      resyncRemoteCollectionsTree,
      notifyRemoteAttachmentsChanged,
    ]
  );

  /** 任意地方点开已有文件卡的附件 → 直接跳 CardPageView */
  const openFileCardForAttachment = useCallback(
    (noteCard: NoteCard, item: NoteMediaItem) => {
      const linked = findLinkedFileCardForNoteMedia(
        noteCard,
        item,
        collectionsRef.current
      );
      if (!linked) return false;
      setDetailCard(null);
      setCardPageCard({ colId: linked.colId, cardId: linked.card.id });
      return true;
    },
    []
  );

  /** 「文件」网格：打开文件时优先进入已关联的 file 卡；否则创建 file 卡并建双向连接后再打开 */
  const openFileFromAllFilesView = useCallback(
    (colId: string, noteCardId: string, mediaIndex: number) => {
      const resolveAttachmentCardHit = (
        cols: Collection[],
        preferredColId: string,
        cardId: string
      ) => {
        const direct = findCardInTree(cols, preferredColId, cardId);
        if (direct) return direct;
        for (const col of cols) {
          const card = col.cards.find((c) => c.id === cardId);
          if (card) return { col, card };
        }
        return null;
      };
      const tryOpen = async (depth = 0): Promise<void> => {
        if (depth > 12) return;
        const collectionsNow = collectionsRef.current;
        const hit = resolveAttachmentCardHit(collectionsNow, colId, noteCardId);
        if (!hit) return;

        // 附件页直接列出的是文件卡 — 直接打开 CardPageView
        if (isFileCard(hit.card)) {
          setDetailCard(null);
          setCardPageCard({ colId: hit.col.id, cardId: noteCardId });
          return;
        }

        const item = hit.card.media?.[mediaIndex];
        if (!item?.url?.trim()) {
          setDetailCard({
            card: hit.card,
            colId,
            openAtMediaIndex: mediaIndex,
          });
          return;
        }
        const linked = findLinkedFileCardForNoteMedia(
          hit.card,
          item,
          collectionsNow
        );
        if (linked) {
          setDetailCard(null);
          setCardPageCard({
            colId: linked.colId,
            cardId: linked.card.id,
          });
          return;
        }
        if (!canEdit) {
          setDetailCard({
            card: hit.card,
            colId,
            openAtMediaIndex: mediaIndex,
          });
          return;
        }

        const lockKey = `${noteCardId}\0${item.url.trim()}`;
        const inflight = attachmentFileCardOpenInflightRef.current;
        const prev = inflight.get(lockKey);
        if (prev) {
          await prev;
          return tryOpen(depth + 1);
        }

        let resolveChain!: () => void;
        const chainDone = new Promise<void>((r) => {
          resolveChain = r;
        });
        inflight.set(lockKey, chainDone);
        try {
          const hitAgain = resolveAttachmentCardHit(
            collectionsRef.current,
            colId,
            noteCardId
          );
          if (!hitAgain) return;
          const itemAgain = hitAgain.card.media?.[mediaIndex];
          if (!itemAgain?.url?.trim()) {
            setDetailCard({
              card: hitAgain.card,
              colId,
              openAtMediaIndex: mediaIndex,
            });
            return;
          }
          const linkedAgain = findLinkedFileCardForNoteMedia(
            hitAgain.card,
            itemAgain,
            collectionsRef.current
          );
          if (linkedAgain) {
            setDetailCard(null);
            setCardPageCard({
              colId: linkedAgain.colId,
              cardId: linkedAgain.card.id,
            });
            return;
          }
          if (!canEdit) {
            setDetailCard({
              card: hitAgain.card,
              colId,
              openAtMediaIndex: mediaIndex,
            });
            return;
          }

          if (dataMode === "remote") {
            const res = await createFileCardForNoteMediaApi(noteCardId, {
              placementCollectionId: hitAgain.col.id,
              media: itemAgain,
            });
            if (!res) {
              window.alert(c.errCreateFileCard);
              setDetailCard({
                card: hitAgain.card,
                colId,
                openAtMediaIndex: mediaIndex,
              });
              return;
            }
            const merged = await resyncRemoteCollectionsTree();
            notifyRemoteAttachmentsChanged();
            if (merged) {
              const fh = resolveAttachmentCardHit(merged, hitAgain.col.id, res.fileCardId);
              if (fh) {
                setDetailCard(null);
                setCardPageCard({
                  colId: fh.col.id,
                  cardId: fh.card.id,
                });
                return;
              }
            }
            setDetailCard({
              card: hitAgain.card,
              colId,
              openAtMediaIndex: mediaIndex,
            });
            return;
          }

          const fileCardId = `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const now = new Date();
          const minutesOfDay = now.getHours() * 60 + now.getMinutes();
          const day = localDateString(now);
          const mediaCopy: NoteMediaItem = { ...itemAgain };
          const fileTitle = deriveFileCardTitleFromMedia(mediaCopy);
          const newFileCard: NoteCard = {
            id: fileCardId,
            text: "",
            minutesOfDay,
            addedOn: day,
            objectKind: objectKindFromNoteMediaKind(mediaCopy.kind),
            media: [mediaCopy],
            ...(fileTitle
              ? {
                  customProps: [
                    {
                      id: "sf-file-title",
                      name: "标题",
                      type: "text",
                      value: fileTitle,
                    },
                  ],
                }
              : {}),
          };
          flushSync(() => {
            setCollections((prev) => {
              let next = mapCollectionById(prev, hitAgain.col.id, (col) => ({
                ...col,
                cards: [...col.cards, newFileCard],
              }));
              return addBidirectionalRelated(
                next,
                hitAgain.col.id,
                noteCardId,
                hitAgain.col.id,
                fileCardId
              );
            });
          });
          const fh = resolveAttachmentCardHit(
            collectionsRef.current,
            hitAgain.col.id,
            fileCardId
          );
          if (fh) {
            setDetailCard(null);
            setCardPageCard({ colId: fh.col.id, cardId: fh.card.id });
          } else {
            setDetailCard({
              card: hitAgain.card,
              colId,
              openAtMediaIndex: mediaIndex,
            });
          }
        } finally {
          inflight.delete(lockKey);
          resolveChain();
        }
      };
      void tryOpen();
    },
    [
      canEdit,
      dataMode,
      c.errCreateFileCard,
      resyncRemoteCollectionsTree,
      notifyRemoteAttachmentsChanged,
      setCollections,
      setDetailCard,
      setCardPageCard,
    ]
  );

  const [connectionsEdgeLimit, setConnectionsEdgeLimit] = useState(
    CONNECTIONS_EDGE_BATCH
  );
  const { connectionEdges, connectionEdgesTruncated } = useMemo(() => {
    if (!connectionsPrimed) {
      return { connectionEdges: [] as ReturnType<typeof collectConnectionEdges>["edges"], connectionEdgesTruncated: false };
    }
    const r = collectConnectionEdges(collections, connectionsEdgeLimit);
    return { connectionEdges: r.edges, connectionEdgesTruncated: r.truncated };
  }, [collections, connectionsPrimed, connectionsEdgeLimit]);
  /** 卡片探索徽章数（当前入口已隐藏；保留计算以便再开时零改动） */
  const _connectedCardsCount = useMemo(() => {
    let count = 0;
    walkCollections(collections, (col) => {
      for (const card of col.cards) {
        if ((card.relatedRefs ?? []).length > 0) count += 1;
      }
    });
    return count;
  }, [collections]);
  void _connectedCardsCount;

  const allNotesSorted = useMemo(() => {
    const entries: { col: Collection; card: NoteCard }[] = [];
    // 限定「全部笔记」为「笔记」preset 子树（含任意层子合集）+ 未归类虚拟合集。
    // 这样即便 task/person/file 子树里混入 objectKind==='note' 的历史卡，也不会漏进来。
    const noteRoot = findCollectionByPresetType(collections, "note");
    const allowedColIds = new Set<string>();
    allowedColIds.add(LOOSE_NOTES_COLLECTION_ID);
    if (noteRoot) {
      const stack: Collection[] = [noteRoot];
      while (stack.length) {
        const n = stack.pop()!;
        allowedColIds.add(n.id);
        if (n.children?.length) stack.push(...n.children);
      }
    }
    const useColFilter = allowedColIds.size > 1; // 有 note root 才启用
    walkCollections(collections, (col) => {
      if (useColFilter && !allowedColIds.has(col.id)) return;
      for (const card of col.cards) {
        // 全部笔记：仅笔记形态，不含文件/人物/网页/任务等对象卡
        if (!isNoteForAllNotesView(card)) continue;
        entries.push({ col, card });
      }
    });
    entries.sort((a, b) => {
      const dateA = a.card.addedOn ?? "";
      const dateB = b.card.addedOn ?? "";
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      return (b.card.minutesOfDay ?? 0) - (a.card.minutesOfDay ?? 0);
    });
    /** 同一张卡被「加入合集」后会存在多条 placement；全部笔记按 card.id 去重，仅保留一条 */
    const seen = new Set<string>();
    return entries.filter((ent) => {
      if (seen.has(ent.card.id)) return false;
      seen.add(ent.card.id);
      return true;
    });
  }, [collections]);

  const allNotesDisplayed = useMemo(
    () => allNotesSorted.slice(0, allNotesVisibleCount),
    [allNotesSorted, allNotesVisibleCount]
  );

  /** 进入/离开「全部笔记」、条数变化时校准窗口；异步加载完成后从 0 条到有数据时补首批 */
  useEffect(() => {
    if (!allNotesViewActive) {
      allNotesViewSessionRef.current = false;
      return;
    }
    const cap = allNotesSorted.length;
    const justEntered = !allNotesViewSessionRef.current;
    allNotesViewSessionRef.current = true;
    setAllNotesVisibleCount((prev) => {
      if (cap === 0) return 0;
      if (justEntered) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      if (prev === 0) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      return Math.min(prev, cap);
    });
  }, [allNotesViewActive, allNotesSorted.length]);

  useEffect(() => {
    if (!allNotesViewActive) return;
    const root = timelineRef.current;
    const target = allNotesLoadMoreSentinelRef.current;
    if (!root || !target) return;
    if (allNotesVisibleCount >= allNotesSorted.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0];
        if (!hit?.isIntersecting) return;
        setAllNotesVisibleCount((n) => {
          const total = allNotesSorted.length;
          if (n >= total) return n;
          return Math.min(n + TIMELINE_VIRTUAL_BATCH, total);
        });
      },
      { root, rootMargin: "520px 0px", threshold: 0 }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [
    allNotesViewActive,
    allNotesVisibleCount,
    allNotesSorted.length,
  ]);

  const searchTrim = searchQuery.trim();
  const searchActive = searchTrim.length > 0;
  const searchExpanded = searchBarOpen || searchActive;

  const renderSidebarSubtypeRows = (
    rows: SidebarSubtypeRow[],
    listAria: string
  ) => (
    <div className="sidebar__file-subtypes" role="list" aria-label={listAria}>
      {rows.map(({ col, depth }) => {
        const label = col.name;
        const subtypeActive =
          Boolean(active?.id === col.id) &&
          !searchActive &&
          !attachmentsViewActive &&
          !trashViewActive &&
          !allNotesViewActive &&
          !calendarDay &&
          !connectionsViewActive &&
          !remindersViewActive;
        const subtypeCount = countCollectionSubtreeCards(col);
        const isEditing = editingCollectionId === col.id;
        return (
          <div key={col.id} className="sidebar__file-subtype-row" role="listitem">
            <button
              type="button"
              className={
                "sidebar__file-subtype-hit" + (subtypeActive ? " is-active" : "")
              }
              onContextMenu={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setCollectionCtxMenu({
                  x: e.clientX,
                  y: e.clientY,
                  id: col.id,
                  name: col.name,
                  hasChildren: (col.children?.length ?? 0) > 0,
                });
              }}
              onClick={() => {
                if (isEditing) return;
                closeCardFullPage();
                setTrashViewActive(false);
                setCalendarDay(null);
                setSearchQuery("");
                setSearchBarOpen(false);
                setAllNotesViewActive(false);
                setAttachmentsViewActive(false);
                setConnectionsViewActive(false);
                setRemindersViewActive(false);
                setActiveId(col.id);
                expandAncestorsOf(col.id);
                setMobileNavOpen(false);
              }}
              aria-label={`${label} (${subtypeCount})`}
            >
              <span className="sidebar__file-subtype-body">
                {depth > 0 ? (
                  <span
                    aria-hidden
                    style={{ width: `${Math.min(depth, 8) * 12}px`, flex: "0 0 auto" }}
                  />
                ) : null}
                {!hideSidebarCollectionDots ? (
                  <CollectionIconGlyph
                    className="sidebar__dot"
                    shape={col.iconShape}
                    color={toContrastyGlyphColor(col.dotColor)}
                    size={13}
                  />
                ) : null}
                {isEditing ? (
                  <input
                    ref={collectionNameInputRef}
                    type="text"
                    className="sidebar__name-input"
                    value={draftCollectionName}
                    aria-label={c.uiCollectionNameAria}
                    onChange={(e) =>
                      setDraftCollectionName(e.target.value)
                    }
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        skipCollectionBlurCommitRef.current = true;
                        setEditingCollectionId(null);
                      }
                    }}
                    onBlur={() => onCollectionNameBlur()}
                  />
                ) : (
                  <span
                    className="sidebar__name"
                    title={canEdit ? c.uiCollectionNameHint : undefined}
                    onDoubleClick={
                      canEdit
                        ? (e) => {
                            e.stopPropagation();
                            setDraftCollectionName(col.name);
                            setEditingCollectionId(col.id);
                          }
                        : undefined
                    }
                  >
                    {label}
                  </span>
                )}
                <span className="sidebar__count">{subtypeCount}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );

  const renderPresetCatalogSidebarSection = (
    baseId: (typeof SIDEBAR_COLLAPSIBLE_PRESET_BASE_IDS)[number]
  ) => {
    const group = PRESET_OBJECT_TYPES_GROUPS.find((g) => g.baseId === baseId);
    if (!group) return null;
    const navRootCol = presetGroupNavRootCollection(collections, group);
    if (!navRootCol) return null;
    const sectionLabel =
      appUiLang === "en" ? group.baseLabelEn : group.baseLabelZh;
    const subtypeCollections = collectSidebarSubtypeRows(navRootCol);
    const listAria =
      appUiLang === "zh"
        ? `「${sectionLabel}」下的子类型`
        : `${sectionLabel} subtypes`;
    return (
      <div
        key={baseId}
        className="sidebar__preset-sidebar-section sidebar__preset-sidebar-section--expanded"
      >
        {renderSidebarSubtypeRows(subtypeCollections, listAria)}
        {canEdit && !showMobileSidebarBrowseChrome ? (
          <button
            type="button"
            className="sidebar__trailing-add"
            onClick={() =>
              void addSubCollection(navRootCol.id, { asCategory: true })
            }
            aria-label={c.newCollectionAria}
          >
            + {c.newCollection}
          </button>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    if (searchActive) {
      setTrashViewActive(false);
      setRemindersViewActive(false);
    }
  }, [searchActive]);

  useLayoutEffect(() => {
    if (!searchExpanded) return;
    const id = requestAnimationFrame(() => {
      if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
        mainSearchInputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [searchExpanded]);

  /** 展开搜索时滚到顶栏（含搜索框），并把时间线滚到顶，进入完整「搜索页」布局 */
  const prevSearchExpandedRef = useRef(false);
  useLayoutEffect(() => {
    const prev = prevSearchExpandedRef.current;
    prevSearchExpandedRef.current = searchExpanded;
    if (!searchExpanded || prev) return;
    const id = requestAnimationFrame(() => {
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      }
      mainHeaderRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      timelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [searchExpanded]);

  /** 开始输入关键词时把时间线滚到顶，直接看到搜索结果 */
  const prevSearchActiveRef = useRef(false);
  useLayoutEffect(() => {
    const prev = prevSearchActiveRef.current;
    prevSearchActiveRef.current = searchActive;
    if (!searchActive || prev) return;
    const el = timelineRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [searchActive]);

  const { collectionMatches: searchCollectionMatches, groupedCards: searchGroupedCards } =
    useMemo(
      () => buildSearchResults(collections, searchTrim),
      [collections, searchTrim]
    );
  const searchHasResults =
    searchCollectionMatches.length > 0 || searchGroupedCards.length > 0;

  const searchCardsFlat = useMemo(() => {
    const out: { col: Collection; path: string; card: NoteCard }[] = [];
    for (const g of searchGroupedCards) {
      for (const card of g.cards) {
        out.push({ col: g.col, path: g.path, card });
      }
    }
    return out;
  }, [searchGroupedCards]);

  const searchGroupedCardsDisplayed = useMemo(
    () =>
      groupSearchHitsFromFlat(
        searchCardsFlat.slice(0, searchGroupedCardsVisibleCount)
      ),
    [searchCardsFlat, searchGroupedCardsVisibleCount]
  );

  /** 单合集时间线：切换合集或离开搜索/日历等特殊视图时重置可视条数 */
  useEffect(() => {
    if (
      allNotesViewActive ||
      calendarDay ||
      searchActive ||
      trashViewActive ||
      remindersViewActive ||
      connectionsViewActive ||
      attachmentsViewActive ||
      !active
    ) {
      collectionTimelineSessionRef.current = undefined;
      return;
    }
    const id = active.id;
    const justSwitched = collectionTimelineSessionRef.current !== id;
    collectionTimelineSessionRef.current = id;
    const cap = rest.length;
    setCollectionRestVisibleCount((prev) => {
      if (cap === 0) return 0;
      if (justSwitched) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      if (prev === 0) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      return Math.min(prev, cap);
    });
  }, [
    active?.id,
    rest.length,
    allNotesViewActive,
    calendarDay,
    searchActive,
    trashViewActive,
    remindersViewActive,
    connectionsViewActive,
    attachmentsViewActive,
  ]);

  useEffect(() => {
    if (
      allNotesViewActive ||
      calendarDay ||
      searchActive ||
      trashViewActive ||
      remindersViewActive ||
      connectionsViewActive ||
      attachmentsViewActive ||
      !active
    )
      return;
    const root = timelineRef.current;
    const target = collectionRestSentinelRef.current;
    if (!root || !target) return;
    if (collectionRestVisibleCount >= rest.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0];
        if (!hit?.isIntersecting) return;
        setCollectionRestVisibleCount((n) => {
          const total = rest.length;
          if (n >= total) return n;
          return Math.min(n + TIMELINE_VIRTUAL_BATCH, total);
        });
      },
      { root, rootMargin: "520px 0px", threshold: 0 }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [
    active?.id,
    allNotesViewActive,
    calendarDay,
    searchActive,
    trashViewActive,
    remindersViewActive,
    connectionsViewActive,
    attachmentsViewActive,
    collectionRestVisibleCount,
    rest.length,
  ]);

  /** 搜索结果笔记列表：换关键词或结果集变化时校准窗口 */
  useEffect(() => {
    if (!searchActive) {
      searchTimelineSessionRef.current = "";
      return;
    }
    const cap = searchCardsFlat.length;
    const justNewQuery = searchTimelineSessionRef.current !== searchTrim;
    searchTimelineSessionRef.current = searchTrim;
    setSearchGroupedCardsVisibleCount((prev) => {
      if (cap === 0) return 0;
      if (justNewQuery) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      if (prev === 0) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      return Math.min(prev, cap);
    });
  }, [searchActive, searchTrim, searchCardsFlat.length]);

  useEffect(() => {
    if (!searchActive) return;
    const root = timelineRef.current;
    const target = searchNotesSentinelRef.current;
    if (!root || !target) return;
    if (searchGroupedCardsVisibleCount >= searchCardsFlat.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0];
        if (!hit?.isIntersecting) return;
        setSearchGroupedCardsVisibleCount((n) => {
          const total = searchCardsFlat.length;
          if (n >= total) return n;
          return Math.min(n + TIMELINE_VIRTUAL_BATCH, total);
        });
      },
      { root, rootMargin: "520px 0px", threshold: 0 }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [
    searchActive,
    searchGroupedCardsVisibleCount,
    searchCardsFlat.length,
  ]);

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarViewMonth),
    [calendarViewMonth]
  );

  const onPickCalendarDay = useCallback((dateStr: string) => {
    closeCardFullPage();
    setSearchQuery("");
    setSearchBarOpen(false);
    setRemindersViewActive(false);
    setCalendarDay(dateStr);
    const [yy, mm] = dateStr.split("-").map(Number);
    setCalendarViewMonth(new Date(yy, mm - 1, 1));
  }, [closeCardFullPage]);

  useEffect(() => {
    if (!remindersViewActive) return;
    setTrashViewActive(false);
    setCalendarDay(null);
    setSearchQuery("");
    setSearchBarOpen(false);
    setMobileCalendarOpen(false);
  }, [remindersViewActive]);

  /**
   * WebKit（含 iOS）：`.cards` 从 flex 列表切到瀑布流 Grid 时，首帧偶发未完成重算；
   * 开启后强制读几何并派发 resize，触发稳定重排。
   */
  useLayoutEffect(() => {
    if (timelineColumnCount <= 1) return;
    const root = timelineRef.current;
    if (!root) return;

    const bumpColLayout = () => {
      void root.getBoundingClientRect();
      root.querySelectorAll<HTMLElement>("ul.cards").forEach((ul) => {
        void ul.getBoundingClientRect();
      });
    };

    let id2 = 0;
    bumpColLayout();
    const id1 = requestAnimationFrame(() => {
      bumpColLayout();
      window.dispatchEvent(new Event("resize"));
      id2 = requestAnimationFrame(bumpColLayout);
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2 !== 0) cancelAnimationFrame(id2);
    };
  }, [timelineColumnCount]);

  const dayReminderEntries = useMemo(() => {
    if (!calendarDay) return [];
    return collectReminderCardsOnDate(collections, calendarDay);
  }, [collections, calendarDay]);

  const reminderIdsOnDay = useMemo(
    () => new Set(dayReminderEntries.map((e) => e.card.id)),
    [dayReminderEntries]
  );

  const dayEntriesRaw = useMemo(() => {
    if (!calendarDay) return [];
    return collectCardsOnDate(collections, calendarDay);
  }, [collections, calendarDay]);

  /** 当日列表里不再重复显示已在「提醒」区的卡片 */
  const dayEntriesForList = useMemo(
    () =>
      dayEntriesRaw.filter((e) => !reminderIdsOnDay.has(e.card.id)),
    [dayEntriesRaw, reminderIdsOnDay]
  );

  const cardToColIdForDay = useMemo(() => {
    const m = new Map<string, string>();
    for (const { col, card } of dayReminderEntries) m.set(card.id, col.id);
    for (const { col, card } of dayEntriesForList) m.set(card.id, col.id);
    return m;
  }, [dayReminderEntries, dayEntriesForList]);

  const { pinned: dayPinned, rest: dayRestCards } = useMemo(() => {
    const cards = dayEntriesForList.map((e) => e.card);
    return splitPinnedCards(cards);
  }, [dayEntriesForList]);

  const calendarRestByCol = useMemo(() => {
    const restIds = new Set(dayRestCards.map((c) => c.id));
    const m = new Map<string, { col: Collection; cards: NoteCard[] }>();
    for (const ent of dayEntriesForList) {
      if (!restIds.has(ent.card.id)) continue;
      const cur = m.get(ent.col.id);
      if (cur) cur.cards.push(ent.card);
      else m.set(ent.col.id, { col: ent.col, cards: [ent.card] });
    }
    return [...m.values()];
  }, [dayRestCards, dayEntriesForList]);

  const calendarRestFlat = useMemo(() => {
    const out: { col: Collection; card: NoteCard }[] = [];
    for (const g of calendarRestByCol) {
      for (const card of g.cards) out.push({ col: g.col, card });
    }
    return out;
  }, [calendarRestByCol]);

  /** 日历某日：非置顶笔记扁平列出，触底再挂载更多 */
  useEffect(() => {
    if (!calendarDay) {
      calendarDayRestSessionRef.current = null;
      return;
    }
    const cap = calendarRestFlat.length;
    const justEntered = calendarDayRestSessionRef.current !== calendarDay;
    calendarDayRestSessionRef.current = calendarDay;
    setCalendarRestFlatVisibleCount((prev) => {
      if (cap === 0) return 0;
      if (justEntered) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      if (prev === 0) return Math.min(TIMELINE_VIRTUAL_BATCH, cap);
      return Math.min(prev, cap);
    });
  }, [calendarDay, calendarRestFlat.length]);

  useEffect(() => {
    if (!calendarDay) return;
    const root = timelineRef.current;
    const target = calendarRestSentinelRef.current;
    if (!root || !target) return;
    if (calendarRestFlatVisibleCount >= calendarRestFlat.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries[0];
        if (!hit?.isIntersecting) return;
        setCalendarRestFlatVisibleCount((n) => {
          const total = calendarRestFlat.length;
          if (n >= total) return n;
          return Math.min(n + TIMELINE_VIRTUAL_BATCH, total);
        });
      },
      { root, rootMargin: "520px 0px", threshold: 0 }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [calendarDay, calendarRestFlatVisibleCount, calendarRestFlat.length]);

  const togglePin = useCallback(
    (colId: string, cardId: string) => {
      let newPinned: boolean | undefined;
      setCollections((prev) => {
        const hit = findCardInTree(prev, colId, cardId);
        if (!hit?.card) return prev;
        newPinned = !hit.card.pinned;
        return mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((cd) =>
            cd.id === cardId ? { ...cd, pinned: newPinned } : cd
          ),
        }));
      });
      if (dataMode !== "local") {
        Promise.resolve().then(() => {
          if (newPinned !== undefined) {
            void updateCardApi(cardId, {
              pinned: newPinned,
              placementCollectionId: colId,
            });
          }
        });
      }
    },
    [dataMode]
  );

  const commitCardReminder = useCallback(
    (
      _colId: string,
      cardId: string,
      isoDate: string | null,
      time?: string,
      note?: string
    ) => {
      setCollections((prev) =>
        patchNoteCardByIdInTree(prev, cardId, (cd) => {
          if (isoDate == null || isoDate === "") {
            const { reminderOn: _r, reminderTime: _t, reminderNote: _n, ...rest } =
              cd;
            return rest;
          }
          const {
            reminderCompletedAt: _done,
            reminderCompletedNote: _cnote,
            ...base
          } = cd;
          return {
            ...base,
            reminderOn: isoDate,
            ...(time ? { reminderTime: time } : { reminderTime: undefined }),
            ...(note ? { reminderNote: note } : { reminderNote: undefined }),
          };
        })
      );
      if (dataMode !== "local") {
        void updateCardApi(cardId, {
          reminderOn: isoDate && isoDate.length > 0 ? isoDate : null,
          reminderTime: isoDate ? (time || null) : null,
          reminderNote: isoDate ? (note || null) : null,
          reminderCompletedAt:
            isoDate && isoDate.length > 0 ? null : undefined,
          reminderCompletedNote:
            isoDate && isoDate.length > 0 ? null : undefined,
        });
      }
    },
    [dataMode]
  );

  /** 待办列表勾选：记录完成时间、快照提醒备注，并清除当前提醒 */
  const completeReminderTask = useCallback(
    (_colId: string, cardId: string) => {
      const doneAt = new Date().toISOString();
      let remoteCompletedNote: string | null = null;
      setCollections((prev) =>
        patchNoteCardByIdInTree(prev, cardId, (cd) => {
          const snap = cd.reminderNote?.trim();
          if (snap) remoteCompletedNote = snap;
          const {
            reminderOn: _ro,
            reminderTime: _rt,
            reminderNote: _rn,
            ...rest
          } = cd;
          return {
            ...rest,
            reminderCompletedAt: doneAt,
            ...(snap ? { reminderCompletedNote: snap } : {}),
          };
        })
      );
      if (dataMode !== "local") {
        void updateCardApi(cardId, {
          reminderOn: null,
          reminderTime: null,
          reminderNote: null,
          reminderCompletedAt: doneAt,
          reminderCompletedNote: remoteCompletedNote,
        });
      }
    },
    [dataMode]
  );

  const deleteCard = useCallback(
    async (colId: string, cardId: string) => {
      /** 父级 preset 视图会聚合整棵子树的卡，colId 此时是 root；
       *  卡本身并不直接挂在 root.cards 上，需要在全树里定位其真实 placement。 */
      let resolvedColId = colId;
      let resolvedCol = findCollectionById(collections, colId);
      let card = resolvedCol?.cards.find((c) => c.id === cardId);
      if (!card) {
        walkCollections(collections, (col) => {
          if (card) return;
          const hit = col.cards.find((c) => c.id === cardId);
          if (hit) {
            card = hit;
            resolvedCol = col;
            resolvedColId = col.id;
          }
        });
      }
      if (card && canEdit) {
        const entry: TrashedNoteEntry = {
          trashId:
            dataMode === "local"
              ? `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
              : card.id,
          colId: resolvedColId,
          colPathLabel: collectionPathLabel(collections, resolvedColId),
          card: structuredClone(card) as NoteCard,
          deletedAt: new Date().toISOString(),
        };
        if (dataMode !== "local") {
          const ok = await postMeTrashEntry({
            colId: entry.colId,
            colPathLabel: entry.colPathLabel,
            cardId: entry.card.id,
            deletedAt: entry.deletedAt,
          });
          if (!ok) {
            window.alert(c.errTrashMove);
            return;
          }
        }
        setTrashEntries((te) => {
          const next = [entry, ...te];
          if (dataMode === "local") {
            saveTrashedNoteEntries(trashStorageKey, next);
          }
          return next;
        });
      }
      setCollections((prev) => {
        const next = removeCardIdFromAllCollections(prev, cardId);
        return stripRelatedRefsToCardId(next, cardId);
      });
      setCardMenuId(null);
      setRelatedPanel((p) =>
        p?.colId === colId && p?.cardId === cardId ? null : p
      );
      setDetailCard((d) =>
        d && d.colId === colId && d.card.id === cardId ? null : d
      );
    },
    [canEdit, collections, trashStorageKey, dataMode, c.errTrashMove]
  );

  /** 「文件」网格右键删除：连带把其它笔记卡里指向同 URL 的附件也抹掉 */
  const deleteFileCardFromAllFilesView = useCallback(
    async (colId: string, cardId: string, item: NoteMediaItem) => {
      if (!canEdit) return;
      if (!window.confirm(c.uiDeleteAttachmentConfirm)) return;
      const url = item.url?.trim() ?? "";
      await deleteCard(colId, cardId);
      if (url) {
        setCollections((prev) => stripCardsMediaByUrl(prev, url));
      }
      if (dataMode === "remote") {
        notifyRemoteAttachmentsChanged();
        await resyncRemoteCollectionsTree({ skipPreferenceRefresh: true });
      }
    },
    [
      canEdit,
      c.uiDeleteAttachmentConfirm,
      deleteCard,
      dataMode,
      notifyRemoteAttachmentsChanged,
      resyncRemoteCollectionsTree,
    ]
  );

  const handlePurgeBlankCards = useCallback(async () => {
    const list = collectBlankCardsInTree(collectionsRef.current);
    if (list.length === 0) {
      window.alert(c.noteSettingsPurgeBlankNone);
      return;
    }
    if (!window.confirm(c.noteSettingsPurgeBlankConfirm(list.length))) return;
    for (const { colId, cardId } of list) {
      await deleteCard(colId, cardId);
    }
    window.alert(c.noteSettingsPurgeBlankDone(list.length));
  }, [deleteCard, c]);

  const handleMigrateFileCardTitles = useCallback(async () => {
    const roots = collectionsRef.current;
    let fileCards = 0;
    const pending: { card: NoteCard; title: string }[] = [];
    walkCollections(roots, (col) => {
      for (const card of col.cards) {
        if (!isFileCard(card)) continue;
        fileCards++;
        const title = migrationTitleCandidateForFileCard(card);
        if (title) pending.push({ card, title });
      }
    });
    if (pending.length === 0) {
      window.alert(c.noteSettingsMigrateFileTitlesNone);
      return null;
    }
    if (!window.confirm(c.noteSettingsMigrateFileTitlesConfirm(pending.length))) {
      return null;
    }
    let updated = 0;
    let failed = 0;
    if (dataMode === "remote") {
      for (const { card, title } of pending) {
        const customProps = mergeFileTitleIntoCustomProps(card, title);
        const ok = await updateCardApi(card.id, { customProps });
        if (ok) updated++;
        else failed++;
      }
      await resyncRemoteCollectionsTree();
    } else {
      const idToTitle = new Map(
        pending.map((p) => [p.card.id, p.title] as const)
      );
      setCollections((prev) =>
        mapEveryCardInCollections(prev, (card) => {
          const t = idToTitle.get(card.id);
          if (!t) return card;
          return {
            ...card,
            customProps: mergeFileTitleIntoCustomProps(card, t),
          };
        })
      );
      updated = pending.length;
    }
    return {
      fileCards,
      eligible: pending.length,
      updated,
      failed,
    };
  }, [dataMode, c, resyncRemoteCollectionsTree]);

  /** 与笔记详情页标签式「合集」栏相同的入树逻辑 */
  const executeAddCardPlacement = useCallback(
    async (sourceColId: string, cardId: string, targetColId: string) => {
      if (!canEdit) return;
      const hit = findCardInTree(collections, sourceColId, cardId);
      if (!hit?.card) return;
      if (
        collectionIdsContainingCardId(collections, cardId).has(targetColId)
      ) {
        window.alert(c.cardAddToCollectionAlreadyThere);
        return;
      }
      const preferTop = readNewNotePlacement() === "top";
      if (dataMode === "local") {
        setCollections((prev) =>
          appendCardCopyToCollection(
            prev,
            targetColId,
            hit.card,
            preferTop
          )
        );
        return;
      }
      const placement = await addCardPlacementApi(cardId, targetColId, {
        insertAtStart: preferTop,
        pinned: hit.card.pinned === true,
      });
      if (!placement) {
        window.alert(c.errMergeColSave);
        return;
      }
      const mergedAdd = appendCardCopyToCollection(
        collectionsRef.current,
        targetColId,
        { ...hit.card, pinned: placement.pinned },
        preferTop
      );
      setCollections(mergedAdd);
      const skAdd = remoteSnapshotUserKey(
        writeRequiresLogin,
        currentUser?.id?.trim() || null
      );
      if (skAdd) saveRemoteCollectionsSnapshot(skAdd, mergedAdd);
      void resyncRemoteCollectionsTree({ skipPreferenceRefresh: true });
    },
    [
      canEdit,
      collections,
      dataMode,
      c.cardAddToCollectionAlreadyThere,
      c.errMergeColSave,
      writeRequiresLogin,
      currentUser,
      resyncRemoteCollectionsTree,
    ]
  );

  /** 笔记详情页：从某一合集移除当前笔记（多合集之一）；本地写树，云端调 API 后重拉树 */
  const removeCardFromCollectionPlacementAt = useCallback(
    async (placementColId: string, cardId: string) => {
      if (!canEdit) return;
      if (
        placementColId === LOOSE_NOTES_COLLECTION_ID &&
        collectionIdsContainingCardId(collections, cardId).size <= 1
      ) {
        return;
      }
      if (dataMode === "local") {
        setCollections((prev) => {
          const next = removeCardPlacementFromTree(
            prev,
            placementColId,
            cardId,
            c.looseNotesCollectionName
          );
          queueMicrotask(() => {
            setCardPageCard((cp) => {
              if (!cp || cp.cardId !== cardId) return cp;
              const ids = [...collectionIdsContainingCardId(next, cardId)];
              if (ids.length === 0) return null;
              if (ids.includes(cp.colId)) return cp;
              return { colId: ids[0], cardId };
            });
          });
          return next;
        });
        return;
      }
      const ok = await removeCardFromCollectionApi(cardId, placementColId);
      if (!ok) {
        void resyncRemoteCollectionsTree();
        window.alert(c.cardRemovePlacementFail);
        return;
      }
      const mergedLocal = removeCardPlacementFromTree(
        collectionsRef.current,
        placementColId,
        cardId,
        c.looseNotesCollectionName
      );
      setCollections(mergedLocal);
      const skRm = remoteSnapshotUserKey(
        writeRequiresLogin,
        currentUser?.id?.trim() || null
      );
      if (skRm) saveRemoteCollectionsSnapshot(skRm, mergedLocal);
      setCardPageCard((cp) => {
        if (!cp || cp.cardId !== cardId) return cp;
        const ids = [...collectionIdsContainingCardId(mergedLocal, cardId)];
        if (ids.length === 0) return null;
        if (ids.includes(cp.colId)) return cp;
        return { colId: ids[0], cardId };
      });
      void resyncRemoteCollectionsTree({ skipPreferenceRefresh: true });
    },
    [
      canEdit,
      collections,
      dataMode,
      writeRequiresLogin,
      currentUser,
      c.looseNotesCollectionName,
      c.cardRemovePlacementFail,
      resyncRemoteCollectionsTree,
    ]
  );

  const restoreTrashedEntry = useCallback(
    async (entry: TrashedNoteEntry) => {
      if (!canEdit) return;
      const preferTop = readNewNotePlacement() === "top";
      const targetColId = findCollectionById(collections, entry.colId)
        ? entry.colId
        : LOOSE_NOTES_COLLECTION_ID;
      let cardToAppend: NoteCard = entry.card;
      if (dataMode !== "local") {
        let needCreateLooseOnServer = false;
        flushSync(() => {
          setCollections((prev) => {
            const missingLoose =
              targetColId === LOOSE_NOTES_COLLECTION_ID &&
              !findCollectionById(prev, LOOSE_NOTES_COLLECTION_ID);
            needCreateLooseOnServer = Boolean(missingLoose);
            let next = prev;
            if (missingLoose) {
              next = [
                ...prev,
                createLooseNotesCollection(c.looseNotesCollectionName),
              ];
            }
            return next;
          });
        });
        if (needCreateLooseOnServer) {
          const colOk = await createCollectionApi({
            id: LOOSE_NOTES_COLLECTION_ID,
            name: c.looseNotesCollectionName,
            dotColor: LOOSE_NOTES_DOT_COLOR,
          });
          if (!colOk) {
            window.alert(c.errTrashRestore);
            return;
          }
        }
        const restored = await postMeTrashRestore({
          cardId: entry.card.id,
          targetCollectionId: targetColId,
          insertAtStart: preferTop,
        });
        if (!restored.ok) {
          window.alert(c.errTrashRestore);
          return;
        }
        cardToAppend = restored.card;
      }
      setTrashEntries((te) => {
        const next = te.filter((t) => t.trashId !== entry.trashId);
        if (dataMode === "local") {
          saveTrashedNoteEntries(trashStorageKey, next);
        }
        return next;
      });
      setCollections((prev) => {
        let next = prev;
        if (
          targetColId === LOOSE_NOTES_COLLECTION_ID &&
          !findCollectionById(prev, LOOSE_NOTES_COLLECTION_ID)
        ) {
          next = [...prev, createLooseNotesCollection(c.looseNotesCollectionName)];
        }
        return mapCollectionById(next, targetColId, (col) => ({
          ...col,
          cards:
            preferTop
              ? [
                  structuredClone(cardToAppend) as NoteCard,
                  ...col.cards,
                ]
              : [...col.cards, structuredClone(cardToAppend) as NoteCard],
        }));
      });
      setTrashViewActive(false);
      setRemindersViewActive(false);
      setActiveId(targetColId);
      setCalendarDay(null);
      setMobileNavOpen(false);
    },
    [
      canEdit,
      collections,
      trashStorageKey,
      dataMode,
      c.looseNotesCollectionName,
      c.errTrashRestore,
    ]
  );

  const purgeTrashedEntry = useCallback(
    async (trashId: string) => {
      if (!canEdit) return;
      const victim = trashEntries.find((t) => t.trashId === trashId);
      if (
        !window.confirm(c.confirmTrashDelete)
      ) {
        return;
      }
      let deleteRelatedFiles = false;
      const relatedFileCount = victim?.card.media?.length ?? 0;
      if (dataMode !== "local" && relatedFileCount > 0) {
        deleteRelatedFiles = window.confirm(
          c.confirmDeleteRelatedFiles(relatedFileCount)
        );
      }
      if (dataMode !== "local") {
        const ok = await deleteMeTrashEntry(trashId, {
          deleteRelatedFiles,
        });
        if (!ok) {
          window.alert(c.errTrashDeleteOne);
          return;
        }
      }
      setTrashEntries((te) => {
        const victim = te.find((t) => t.trashId === trashId);
        if (victim) {
          for (const m of victim.card.media ?? []) {
            void deleteLocalMediaFile(m.url);
          }
        }
        const next = te.filter((t) => t.trashId !== trashId);
        if (dataMode === "local") {
          saveTrashedNoteEntries(trashStorageKey, next);
        }
        return next;
      });
    },
    [
      canEdit,
      trashEntries,
      trashStorageKey,
      dataMode,
      c.confirmTrashDelete,
      c.confirmDeleteRelatedFiles,
      c.errTrashDeleteOne,
    ]
  );

  const emptyTrash = useCallback(async () => {
    if (!canEdit || trashEntries.length === 0) return;
    if (
      !window.confirm(c.confirmEmptyTrash(trashEntries.length))
    ) {
      return;
    }
    let deleteRelatedFiles = false;
    const relatedFileCount = trashEntries.reduce(
      (sum, e) => sum + (e.card.media?.length ?? 0),
      0
    );
    if (dataMode !== "local" && relatedFileCount > 0) {
      deleteRelatedFiles = window.confirm(
        c.confirmDeleteRelatedFiles(relatedFileCount)
      );
    }
    if (dataMode !== "local") {
      const ok = await clearMeTrash({ deleteRelatedFiles });
      if (!ok) {
        window.alert(c.errTrashEmpty);
        return;
      }
    }
    for (const e of trashEntries) {
      for (const m of e.card.media ?? []) {
        void deleteLocalMediaFile(m.url);
      }
    }
    setTrashEntries([]);
    if (dataMode === "local") {
      saveTrashedNoteEntries(trashStorageKey, []);
    }
  }, [
    canEdit,
    trashEntries,
    trashStorageKey,
    dataMode,
    c.confirmEmptyTrash,
    c.confirmDeleteRelatedFiles,
    c.errTrashEmpty,
  ]);

  const removeRelatedPair = useCallback(
    (
      srcColId: string,
      srcCardId: string,
      tgtColId: string,
      tgtCardId: string
    ) => {
      setCollections((prev) => {
        const next = removeBidirectionalRelated(
          prev,
          srcColId,
          srcCardId,
          tgtColId,
          tgtCardId
        );
        if (dataMode !== "local") {
          const a = findCardInTree(next, srcColId, srcCardId);
          const b = findCardInTree(next, tgtColId, tgtCardId);
          queueMicrotask(() => {
            void updateCardApi(srcCardId, {
              relatedRefs: a?.card.relatedRefs ?? [],
            });
            void updateCardApi(tgtCardId, {
              relatedRefs: b?.card.relatedRefs ?? [],
            });
          });
        }
        return next;
      });
    },
    [dataMode]
  );

  const addRelatedPair = useCallback(
    (
      srcColId: string,
      srcCardId: string,
      tgtColId: string,
      tgtCardId: string
    ) => {
      setCollections((prev) => {
        const next = addBidirectionalRelated(
          prev,
          srcColId,
          srcCardId,
          tgtColId,
          tgtCardId
        );
        if (dataMode !== "local") {
          const a = findCardInTree(next, srcColId, srcCardId);
          const b = findCardInTree(next, tgtColId, tgtCardId);
          queueMicrotask(() => {
            void updateCardApi(srcCardId, {
              relatedRefs: a?.card.relatedRefs ?? [],
            });
            void updateCardApi(tgtCardId, {
              relatedRefs: b?.card.relatedRefs ?? [],
            });
          });
        }
        return next;
      });
    },
    [dataMode]
  );

  /** 问 AI：将回答存为新卡片，写入来源卡片所在合集，并与来源建立双向「相关」 */
  const saveAiAnswerToRelatedNote = useCallback(
    async (
      plainAnswer: string,
      sourceColId: string,
      sourceCardId: string
    ): Promise<boolean> => {
      const trimmed = plainAnswer.trim();
      if (!canEdit || !trimmed) return false;

      const sourceHit = findCardInTree(collections, sourceColId, sourceCardId);
      const srcKind = sourceHit?.card.objectKind ?? "note";
      const preferTop = readNewNotePlacement() === "top";
      const htmlBody = noteBodyToHtml(trimmed);
      const now = new Date();
      const minutesOfDay = now.getHours() * 60 + now.getMinutes();
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const provisionalId = `n-${uid}`;
      const day = localDateString(now);
      const newCard: NoteCard = {
        id: provisionalId,
        text: htmlBody,
        minutesOfDay,
        addedOn: day,
        ...(srcKind !== "note" ? { objectKind: srcKind } : {}),
      };

      flushSync(() => {
        setCollections((prev) =>
          mapCollectionById(prev, sourceColId, (col) => ({
            ...col,
            cards:
              preferTop
                ? [newCard, ...col.cards]
                : [...col.cards, newCard],
          }))
        );
      });

      if (dataMode === "local") {
        addRelatedPair(sourceColId, sourceCardId, sourceColId, provisionalId);
        return true;
      }

      const created = await createCardApi(sourceColId, newCard, {
        insertAtStart: preferTop,
      });
      if (!created) {
        flushSync(() => {
          setCollections((prev) =>
            mapCollectionById(prev, sourceColId, (col) => ({
              ...col,
              cards: col.cards.filter((c) => c.id !== provisionalId),
            }))
          );
        });
        return false;
      }

      const newId = created.id;
      if (newId !== provisionalId) {
        flushSync(() => {
          setCollections((prev) =>
            mapCollectionById(prev, sourceColId, (col) => ({
              ...col,
              cards: col.cards.map((c) =>
                c.id === provisionalId ? { ...c, id: newId } : c
              ),
            }))
          );
        });
      }

      addRelatedPair(sourceColId, sourceCardId, sourceColId, newId);
      return true;
    },
    [canEdit, dataMode, addRelatedPair, collections]
  );

  const setCardTags = useCallback(
    (_colId: string, cardId: string, tags: string[]) => {
      setCollections((prev) =>
        patchNoteCardByIdInTree(prev, cardId, (card) => {
          if (tags.length === 0) {
            const { tags: _t, ...rest } = card;
            return rest;
          }
          return { ...card, tags };
        })
      );
      if (dataMode !== "local") {
        void updateCardApi(cardId, { tags });
      }
    },
    [dataMode]
  );

  const setCardCustomProps = useCallback(
    (cardId: string, customProps: CardProperty[]) => {
      setCollections((prev) =>
        patchNoteCardByIdInTree(prev, cardId, (card) => {
          if (customProps.length === 0) {
            const { customProps: _cp, ...rest } = card;
            return rest;
          }
          return { ...card, customProps };
        })
      );
      if (dataMode !== "local") {
        void updateCardApi(cardId, { customProps });
      }
    },
    [dataMode]
  );

  const addMediaItemToCard = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      let nextMedia: NoteMediaItem[] | undefined;
      // 必须先同步落盘 React 状态，再 PATCH；否则微任务可能先于 updater 执行，nextMedia 仍为 undefined，附件不会写入服务端
      flushSync(() => {
        setCollections((prev) => {
          const hit = findCardInTree(prev, colId, cardId);
          nextMedia = [...(hit?.card?.media ?? []), item];
          return patchNoteCardByIdInTree(prev, cardId, (cd) => ({
            ...cd,
            media: nextMedia,
          }));
        });
      });
      if (dataMode !== "local" && nextMedia !== undefined) {
        void updateCardApi(cardId, { media: nextMedia }).then((ok) => {
          if (ok) notifyRemoteAttachmentsChanged();
        });
      }
    },
    [dataMode, notifyRemoteAttachmentsChanged]
  );

  const uploadFilesToCard = useCallback(
    async (
      colId: string,
      cardId: string,
      files: File[]
    ): Promise<NoteMediaItem[]> => {
      const out: NoteMediaItem[] = [];
      const uploadWarnings: string[] = [];
      if (files.length === 0) return out;
      setUploadBusyCardId(cardId);
      setUploadCardProgress(null);
      try {
        if (dataMode === "local") {
          if (isTauri()) {
            for (const file of files) {
              try {
                const r = await saveLocalMediaToAppFolder(file);
                const item = await ensureMediaItemDimensionsFromFile(
                  file,
                  mediaItemFromUploadResult(r)
                );
                addMediaItemToCard(colId, cardId, item);
                out.push(item);
              } catch (err) {
                window.alert(
                  err instanceof Error ? err.message : c.errLocalFolder
                );
              }
            }
          } else {
            for (const file of files) {
              try {
                const r = await saveLocalMediaInlineInBrowser(file);
                const item = await ensureMediaItemDimensionsFromFile(
                  file,
                  mediaItemFromUploadResult(r)
                );
                addMediaItemToCard(colId, cardId, item);
                out.push(item);
              } catch (err) {
                window.alert(
                  err instanceof Error ? err.message : c.errBrowserBlob
                );
              }
            }
          }
          return out;
        }
        setUploadCardProgress(0);
        const n = files.length;
        for (let i = 0; i < n; i++) {
          const file = files[i]!;
          const r = await uploadCardMedia(file, {
            onProgress: (p) =>
              setUploadCardProgress(
                Math.round(((i + p / 100) / n) * 100)
              ),
          });
          const item = await ensureMediaItemDimensionsFromFile(
            file,
            mediaItemFromUploadResult(r)
          );
          addMediaItemToCard(colId, cardId, item);
          out.push(item);
          if (Array.isArray(r.warnings)) {
            for (const w of r.warnings) {
              if (w.code === "thumbnail_missing") {
                uploadWarnings.push(file.name || w.name || "");
              }
            }
          }
        }
        if (uploadWarnings.length > 0) {
          const names = [...new Set(uploadWarnings.filter(Boolean))];
          const detail = names.slice(0, 3).join("、");
          const more =
            names.length > 3 ? `\n…以及另外 ${names.length - 3} 个文件。` : "";
          window.alert(
            `${c.warnUploadThumbMissing(uploadWarnings.length)}${
              detail ? `\n${detail}` : ""
            }${more}`
          );
        }
        return out;
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : c.errUpload
        );
        return out;
      } finally {
        setUploadBusyCardId(null);
        setUploadCardProgress(null);
      }
    },
    [
      addMediaItemToCard,
      dataMode,
      c.errLocalFolder,
      c.errBrowserBlob,
      c.errUpload,
      c.warnUploadThumbMissing,
    ]
  );

  const beginCardMediaUpload = useCallback(
    (colId: string, cardId: string) => {
      setCardMenuId(null);
      cardMediaUploadTargetRef.current = { colId, cardId };
      cardMediaFileInputRef.current?.click();
    },
    []
  );

  const onCardMediaFileSelected = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const files = Array.from(input.files ?? []);
      input.value = "";
      const t = cardMediaUploadTargetRef.current;
      cardMediaUploadTargetRef.current = null;
      if (files.length === 0 || !t) return;
      void uploadFilesToCard(t.colId, t.cardId, files);
    },
    [uploadFilesToCard]
  );

  const clearCardMedia = useCallback(
    (colId: string, cardId: string) => {
      let remotePatch: { media: []; text?: string } = { media: [] };
      setCollections((prev) => {
        const hit = findCardInTree(prev, colId, cardId);
        for (const m of hit?.card?.media ?? []) {
          void deleteLocalMediaFile(m.url);
        }
        return patchNoteCardByIdInTree(prev, cardId, (cd) => {
          const urls = collectMediaUrlsFromItems(cd.media ?? []);
          const stripped = stripMediaRefsFromNoteHtml(cd.text, urls);
          const { media: _m, ...rest } = cd;
          if (stripped !== (cd.text ?? "")) {
            remotePatch = { media: [], text: stripped };
            return { ...rest, text: stripped };
          }
          return rest;
        });
      });
      setCardMenuId(null);
      if (dataMode !== "local") {
        void updateCardApi(cardId, remotePatch).then((ok) => {
          if (ok) notifyRemoteAttachmentsChanged();
        });
      }
    },
    [dataMode, notifyRemoteAttachmentsChanged]
  );

  const removeCardMediaItem = useCallback(
    (_colId: string, cardId: string, item: NoteMediaItem) => {
      void deleteLocalMediaFile(item.url);
      let nextMedia: NoteMediaItem[] | undefined;
      let remotePatch:
        | { media: NoteMediaItem[]; text?: string }
        | undefined;
      flushSync(() => {
        setCollections((prev) =>
          patchNoteCardByIdInTree(prev, cardId, (card) => {
            const raw = card.media ?? [];
            const idx = raw.findIndex(
              (m) =>
                m.url === item.url &&
                m.kind === item.kind &&
                (m.name ?? "") === (item.name ?? "") &&
                (m.coverUrl ?? "") === (item.coverUrl ?? "") &&
                (m.thumbnailUrl ?? "") === (item.thumbnailUrl ?? "")
            );
            if (idx < 0) return card;
            const next = [...raw];
            next.splice(idx, 1);
            nextMedia = next;
            const stripUrls = collectMediaUrlsFromItems([item]);
            const stripped = stripMediaRefsFromNoteHtml(card.text, stripUrls);
            const textChanged = stripped !== (card.text ?? "");
            if (textChanged) {
              remotePatch = { media: next, text: stripped };
            } else {
              remotePatch = { media: next };
            }
            if (next.length === 0) {
              const { media: _m, ...rest } = card;
              return textChanged ? { ...rest, text: stripped } : rest;
            }
            return textChanged
              ? { ...card, media: next, text: stripped }
              : { ...card, media: next };
          })
        );
      });
      // 未找到对应项时不要 PATCH media: []，否则会误清空整张卡附件
      if (dataMode !== "local" && nextMedia !== undefined && remotePatch) {
        void updateCardApi(cardId, remotePatch).then((ok) => {
          if (ok) notifyRemoteAttachmentsChanged();
        });
      }
    },
    [dataMode, notifyRemoteAttachmentsChanged]
  );

  /** 将指定附件移到 media 数组首位，作为轮播默认首帧（封面） */
  const setCardMediaCoverItem = useCallback(
    (_colId: string, cardId: string, item: NoteMediaItem) => {
      let nextMedia: NoteMediaItem[] | undefined;
      flushSync(() => {
        setCollections((prev) =>
          patchNoteCardByIdInTree(prev, cardId, (card) => {
            const raw = card.media ?? [];
            const idx = raw.findIndex(
              (m) =>
                m.url === item.url &&
                m.kind === item.kind &&
                (m.name ?? "") === (item.name ?? "") &&
                (m.coverUrl ?? "") === (item.coverUrl ?? "") &&
                (m.thumbnailUrl ?? "") === (item.thumbnailUrl ?? "")
            );
            if (idx <= 0) return card;
            const next = [...raw];
            const [picked] = next.splice(idx, 1);
            next.unshift(picked);
            nextMedia = next;
            return { ...card, media: next };
          })
        );
      });
      if (dataMode !== "local" && nextMedia !== undefined) {
        void updateCardApi(cardId, { media: nextMedia });
      }
    },
    [dataMode]
  );

  /**
   * 向当前选中合集追加一张小笔记；返回新卡片 id，条件不满足时返回 null。
   * 云端模式下会 await POST 完成后再返回，避免紧接着的 PATCH 早于建卡导致正文未写入。
   * `afterLocalInsert` 在本地 state 已提交 DOM 后同步调用（不等待网络），用于立刻滚到底部等。
   */
  const appendNoteCardWithHtml = useCallback(
    async (
      htmlBody: string,
      timeOverride?: { minutesOfDay: number; addedOn: string },
      targetColIdOverride?: string,
      opts?: {
        afterLocalInsert?: () => void;
        reminderOn?: string;
        reminderTime?: string;
        reminderNote?: string;
        /** 覆盖推断的 objectKind（导入等场景） */
        objectKindOverride?: string;
      }
    ): Promise<string | null> => {
      if (!canEdit) return null;
      if (trashViewActive) return null;
      if (connectionsViewActive) return null;
      if (attachmentsViewActive) return null;
      if (remindersViewActive && !opts?.reminderOn) return null;
      if (calendarDay !== null) return null;
      if (searchQuery.trim().length > 0) return null;
      const preferTop = readNewNotePlacement() === "top";
      /** 全部笔记 / 提醒 / 概览：直接落到「笔记」preset 合集根本身（其子合集如「已归档」不作为默认）；缺失时回退未归类 */
      const resolveDefaultNoteTargetColId = (): string => {
        const noteRoot = findCollectionByPresetType(collections, "note");
        return noteRoot?.id ?? LOOSE_NOTES_COLLECTION_ID;
      };
      const trimmedActiveId = activeId.trim();
      let targetColId =
        targetColIdOverride?.trim() ||
        (allNotesViewActive || remindersViewActive || !trimmedActiveId
          ? resolveDefaultNoteTargetColId()
          : active?.id?.trim() ?? "");
      /** 无选中用户合集时写入未归类（不在 UI 中展示该虚拟合集名） */
      if (!targetColId) {
        targetColId = LOOSE_NOTES_COLLECTION_ID;
      }
      const now = new Date();
      const minutesOfDay =
        timeOverride?.minutesOfDay ??
        now.getHours() * 60 + now.getMinutes();
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const cardId = `n-${uid}`;
      const day = timeOverride?.addedOn ?? localDateString(now);
      const rOn = opts?.reminderOn?.trim();
      const rTime = opts?.reminderTime?.trim();
      const rNote = opts?.reminderNote?.trim();
      const overrideKind = opts?.objectKindOverride?.trim();
      let effectiveObjectKind = "note";
      if (overrideKind) {
        effectiveObjectKind = overrideKind;
      } else if (targetColIdOverride?.trim()) {
        const tcol = findCollectionById(collections, targetColIdOverride.trim());
        const pid = tcol?.presetTypeId?.trim();
        effectiveObjectKind = pid || "note";
      } else {
        effectiveObjectKind =
          objectKindForNewTimelineCardRef.current || "note";
      }
      const newCard: NoteCard = {
        id: cardId,
        text: htmlBody,
        minutesOfDay,
        addedOn: day,
        ...(rOn
          ? {
              reminderOn: rOn,
              ...(rTime ? { reminderTime: rTime } : {}),
              ...(rNote ? { reminderNote: rNote } : {}),
            }
          : {}),
        ...(effectiveObjectKind !== "note"
          ? { objectKind: effectiveObjectKind }
          : {}),
      };

      let needCreateLooseOnServer = false;
      flushSync(() => {
        setCollections((prev) => {
          const missingLoose =
            targetColId === LOOSE_NOTES_COLLECTION_ID &&
            !findCollectionById(prev, LOOSE_NOTES_COLLECTION_ID);
          needCreateLooseOnServer = Boolean(missingLoose);
          let next = prev;
          if (missingLoose) {
            next = [...prev, createLooseNotesCollection(c.looseNotesCollectionName)];
          }
          return mapCollectionById(next, targetColId, (col) => ({
            ...col,
            cards:
              preferTop
                ? [newCard, ...col.cards]
                : [...col.cards, newCard],
          }));
        });
      });
      opts?.afterLocalInsert?.();
      if (dataMode !== "local") {
        if (needCreateLooseOnServer) {
          const colOk = await createCollectionApi({
            id: LOOSE_NOTES_COLLECTION_ID,
            name: c.looseNotesCollectionName,
            dotColor: LOOSE_NOTES_DOT_COLOR,
          });
          if (!colOk) {
            window.alert(c.errCreateCol);
            flushSync(() => {
              setCollections((prev) => {
                let next = mapCollectionById(prev, targetColId, (col) => ({
                  ...col,
                  cards: col.cards.filter((x) => x.id !== cardId),
                }));
                const loose = findCollectionById(next, LOOSE_NOTES_COLLECTION_ID);
                if (loose && loose.cards.length === 0) {
                  const { tree, removed } = removeCollectionFromTree(
                    next,
                    LOOSE_NOTES_COLLECTION_ID
                  );
                  return removed ? tree : next;
                }
                return next;
              });
            });
            return null;
          }
        }
        const created = await createCardApi(targetColId, newCard, {
          insertAtStart: preferTop,
        });
        if (!created) {
          flushSync(() => {
            setCollections((prev) =>
              mapCollectionById(prev, targetColId, (col) => ({
                ...col,
                cards: col.cards.filter((x) => x.id !== cardId),
              }))
            );
          });
          return null;
        }
      }
      return cardId;
    },
    [
      canEdit,
      trashViewActive,
      connectionsViewActive,
      attachmentsViewActive,
      remindersViewActive,
      calendarDay,
      active?.id,
      activeId,
      searchQuery,
      dataMode,
      allNotesViewActive,
      c.looseNotesCollectionName,
      c.errCreateCol,
      collections,
    ]
  );

  const runFolderTreeNotesImport = useCallback(
    async (
      notes: ParsedExportNote[],
      onProgress: ((p: { current: number; total: number }) => void) | undefined,
      meta: { rootCollectionName: string; idPrefix: string }
    ): Promise<number> => {
      if (notes.length === 0) return 0;

      const hasNotebookFolders = notes.some(
        (x) => x.folderSegments.length > 0
      );

      if (!hasNotebookFolders && !importTargetColId) return 0;

      let sortedPaths: string[] = [];
      if (hasNotebookFolders) {
        const pathKeys = new Set<string>();
        for (const n of notes) {
          const segs = n.folderSegments;
          for (let i = 1; i <= segs.length; i++) {
            pathKeys.add(segs.slice(0, i).join("/"));
          }
        }
        sortedPaths = [...pathKeys].sort((a, b) => {
          const da = a.split("/").filter(Boolean).length;
          const db = b.split("/").filter(Boolean).length;
          if (da !== db) return da - db;
          return a.localeCompare(b, "zh-Hans-CN");
        });
      }

      const totalSteps =
        notes.length + (hasNotebookFolders ? 1 + sortedPaths.length : 0);
      let completed = 0;
      const bump = () => {
        completed += 1;
        onProgress?.({
          current: Math.min(completed, totalSteps),
          total: totalSteps,
        });
      };
      onProgress?.({ current: 0, total: totalSteps });

      let pathToId = new Map<string, string>();
      let structureRootId: string | null = null;
      const { rootCollectionName: rootName, idPrefix } = meta;

      if (hasNotebookFolders) {
        const rootId = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const rootCol: Collection = {
          id: rootId,
          name: rootName,
          dotColor: randomDotColor(),
          cards: [],
        };

        if (dataMode === "remote") {
          const created = await createCollectionApi({
            id: rootId,
            name: rootName,
            dotColor: rootCol.dotColor,
          });
          if (!created) {
            window.alert(c.errCreateCol);
            return 0;
          }
          flushSync(() => {
            setCollections((prev) => [
              ...prev,
              {
                ...rootCol,
                ...created,
                cards: [],
                children: undefined,
              },
            ]);
          });
        } else {
          flushSync(() => {
            setCollections((prev) => [...prev, rootCol]);
          });
        }

        pathToId.set("", rootId);
        structureRootId = rootId;
        bump();

        let childIdx = 0;
        for (const pathStr of sortedPaths) {
          const segs = pathStr.split("/").filter(Boolean);
          const parentPath = segs.slice(0, -1).join("/");
          const parentId = pathToId.get(parentPath);
          if (parentId === undefined) {
            bump();
            continue;
          }
          const segmentName = segs[segs.length - 1]!;
          const childId = `${idPrefix}-${Date.now()}-${childIdx++}-${Math.random().toString(36).slice(2, 9)}`;
          const childCol: Collection = {
            id: childId,
            name: segmentName,
            dotColor: randomDotColor(),
            cards: [],
          };
          if (dataMode === "remote") {
            const created = await createCollectionApi({
              id: childId,
              name: segmentName,
              dotColor: childCol.dotColor,
              parentId,
            });
            if (!created) {
              window.alert(c.errCreateSub);
              return 0;
            }
            flushSync(() => {
              setCollections((prev) =>
                insertChildCollection(prev, parentId, {
                  ...childCol,
                  ...created,
                  cards: [],
                  children: undefined,
                })
              );
            });
          } else {
            flushSync(() => {
              setCollections((prev) =>
                insertChildCollection(prev, parentId, childCol)
              );
            });
          }
          pathToId.set(pathStr, childId);
          bump();
        }

        setCollapsedFolderIds((prev) => {
          const next = new Set(prev);
          next.delete(rootId);
          return next;
        });
        setActiveId(rootId);
      }

      let n = 0;
      for (const note of notes) {
        const leafPath = note.folderSegments.join("/");
        const targetColId = hasNotebookFolders
          ? leafPath
            ? pathToId.get(leafPath)
            : structureRootId
          : importTargetColId;
        if (!targetColId) break;

        const tf = note.timeFromFilename;
        const cardId = await appendNoteCardWithHtml(
          note.bodyHtml,
          tf
            ? {
                minutesOfDay: tf.minutesOfDay,
                addedOn: tf.addedOn,
              }
            : undefined,
          targetColId
        );
        if (!cardId) break;
        n += 1;
        if (note.attachmentFiles.length > 0) {
          await uploadFilesToCard(targetColId, cardId, note.attachmentFiles);
        }
        bump();
      }
      return n;
    },
    [
      importTargetColId,
      appendNoteCardWithHtml,
      uploadFilesToCard,
      dataMode,
      c.errCreateCol,
      c.errCreateSub,
    ]
  );

  const runAppleNotesImport = useCallback(
    async (
      notes: ParsedExportNote[],
      onProgress?: (p: { current: number; total: number }) => void
    ): Promise<number> =>
      runFolderTreeNotesImport(notes, onProgress, {
        rootCollectionName: c.importAppleNotesRootCollectionName,
        idPrefix: "c-apple",
      }),
    [runFolderTreeNotesImport, c.importAppleNotesRootCollectionName]
  );

  const runFlomoImport = useCallback(
    async (
      notes: ParsedExportNote[],
      onProgress?: (p: { current: number; total: number }) => void
    ): Promise<number> =>
      runFolderTreeNotesImport(notes, onProgress, {
        rootCollectionName: c.importFlomoRootCollectionName,
        idPrefix: "c-flomo",
      }),
    [runFolderTreeNotesImport, c.importFlomoRootCollectionName]
  );

  const runEvernoteImport = useCallback(
    async (
      notes: ParsedExportNote[],
      onProgress?: (p: { current: number; total: number }) => void
    ): Promise<number> =>
      runFolderTreeNotesImport(notes, onProgress, {
        rootCollectionName: c.importEvernoteRootCollectionName,
        idPrefix: "c-evernote",
      }),
    [runFolderTreeNotesImport, c.importEvernoteRootCollectionName]
  );

  const runYuqueImport = useCallback(
    async (
      notes: ParsedExportNote[],
      onProgress?: (p: { current: number; total: number }) => void
    ): Promise<number> =>
      runFolderTreeNotesImport(notes, onProgress, {
        rootCollectionName: c.importYuqueRootCollectionName,
        idPrefix: "c-yuque",
      }),
    [runFolderTreeNotesImport, c.importYuqueRootCollectionName]
  );

  const scrollTimelineToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = timelineRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    []
  );

  const scrollTimelineToTop = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = timelineRef.current;
      if (!el) return;
      el.scrollTo({ top: 0, behavior });
    },
    []
  );

  /** 侧栏切换「主导航」时滚到时间线顶：合集 / 全部笔记 / 待办 / 回收站 / 探索 / 附件 / 日历某日 */
  const mainTimelineNavScrollKey = useMemo(() => {
    if (trashViewActive) return "trash";
    if (connectionsViewActive) return "connections";
    if (attachmentsViewActive) return "attachments";
    if (remindersViewActive) return "reminders";
    if (allNotesViewActive) return "all-notes";
    if (calendarDay !== null) {
      return `calendar:${calendarDay}`;
    }
    return `collection:${activeId}`;
  }, [
    trashViewActive,
    connectionsViewActive,
    attachmentsViewActive,
    remindersViewActive,
    allNotesViewActive,
    calendarDay,
    activeId,
  ]);

  const prevMainTimelineNavScrollKeyRef = useRef<string | undefined>(
    undefined
  );
  useLayoutEffect(() => {
    const prev = prevMainTimelineNavScrollKeyRef.current;
    prevMainTimelineNavScrollKeyRef.current = mainTimelineNavScrollKey;
    if (prev === undefined) {
      return;
    }
    if (prev === mainTimelineNavScrollKey) {
      return;
    }
    scrollTimelineToTop("auto");
  }, [mainTimelineNavScrollKey, scrollTimelineToTop]);

  /** 小屏：点击顶栏非控件区域时回到时间线顶部（类似系统「点顶栏回顶」） */
  const onMobileHeaderRowTapToTop = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (typeof window === "undefined") return;
      if (!matchesMobileChromeMedia()) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("button, a, input, textarea, select, [role='search']")) {
        return;
      }
      scrollTimelineToTop("smooth");
    },
    [scrollTimelineToTop]
  );

  /** 小屏：点击 main 顶部 padding（刘海安全区空白）时回顶 */
  const onMobileMainSurfaceTapToTop = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (typeof window === "undefined") return;
      if (!matchesMobileChromeMedia()) return;
      scrollTimelineToTop("smooth");
    },
    [scrollTimelineToTop]
  );

  /**
   * 侧栏选中合集时：新卡片带当前时刻与今日 addedOn，便于日历聚合。
   * 选中日历某日（按日浏览）时不允许新建小笔记。
   */
  const addSmallNote = useCallback(
    (opts?: { scrollTimelineToEnd?: boolean }) => {
      void (async () => {
        const afterLocal =
          opts?.scrollTimelineToEnd
            ? () => {
                if (newNotePlacement === "bottom") {
                  scrollTimelineToBottom("auto");
                  requestAnimationFrame(() => {
                    scrollTimelineToBottom("auto");
                    requestAnimationFrame(() =>
                      scrollTimelineToBottom("auto")
                    );
                  });
                } else {
                  scrollTimelineToTop("auto");
                  requestAnimationFrame(() => {
                    scrollTimelineToTop("auto");
                    requestAnimationFrame(() =>
                      scrollTimelineToTop("auto")
                    );
                  });
                }
              }
            : undefined;
        const cardId = await appendNoteCardWithHtml("", undefined, undefined, {
          afterLocalInsert: afterLocal,
        });
        if (!cardId) return;
        queueMicrotask(() => {
          const el = document.getElementById(`card-text-${cardId}`);
          // 避免浏览器为「滚入焦点」再改滚动位置，与上面 scrollTimelineTo* 叠成抖闪
          el?.focus({ preventScroll: true });
        });
      })();
    },
    [
      appendNoteCardWithHtml,
      newNotePlacement,
      scrollTimelineToBottom,
      scrollTimelineToTop,
    ]
  );

  /**
   * 小屏底部罐子：新建空笔记后直接进入全页编辑。
   * 合集 id 与 {@link appendNoteCardWithHtml} 内 `targetColId` 一致。
   */
  const addSmallNoteThenOpenCardFullPage = useCallback(() => {
    void (async () => {
      const afterLocal =
        newNotePlacement === "bottom"
          ? () => {
              scrollTimelineToBottom("auto");
              requestAnimationFrame(() => {
                scrollTimelineToBottom("auto");
              });
            }
          : () => {
              scrollTimelineToTop("auto");
              requestAnimationFrame(() => {
                scrollTimelineToTop("auto");
              });
            };
      const cardId = await appendNoteCardWithHtml("", undefined, undefined, {
        afterLocalInsert: afterLocal,
      });
      if (!cardId) return;
      const trimmedActiveId = activeId.trim();
      const noteRootId =
        findCollectionByPresetType(collections, "note")?.id ?? "";
      const targetColId =
        allNotesViewActive || remindersViewActive
          ? LOOSE_NOTES_COLLECTION_ID
          : trimmedActiveId
            ? active?.id?.trim() || LOOSE_NOTES_COLLECTION_ID
            : noteRootId || LOOSE_NOTES_COLLECTION_ID;
      setMobileNavOpen(false);
      queueMicrotask(() => {
        setCardPageCard({ colId: targetColId, cardId });
      });
    })();
  }, [
    active?.id,
    activeId,
    allNotesViewActive,
    appendNoteCardWithHtml,
    collections,
    newNotePlacement,
    remindersViewActive,
    scrollTimelineToBottom,
    scrollTimelineToTop,
  ]);

  /** 我的待办：先打开与卡片相同的「提醒」弹窗，保存后再建空笔记 */
  const openNewTaskReminderPicker = useCallback(() => {
    if (!canEdit) return;
    setReminderPicker({ kind: "new-task" });
  }, [canEdit]);

  const finishNewTaskFromReminder = useCallback(
    async (iso: string, time: string, note: string) => {
      if (!canEdit) return;
      const t = time.trim();
      const noteT = note.trim();
      let mod: number;
      if (t) {
        const parts = t.split(":");
        const h = Number(parts[0]);
        const m = Number(parts[1]);
        mod =
          Number.isFinite(h) && Number.isFinite(m)
            ? h * 60 + m
            : new Date().getHours() * 60 + new Date().getMinutes();
      } else {
        mod = new Date().getHours() * 60 + new Date().getMinutes();
      }
      const cardId = await appendNoteCardWithHtml(
        "",
        { minutesOfDay: mod, addedOn: iso },
        undefined,
        {
          afterLocalInsert: () => {
            scrollTimelineToBottom("auto");
            requestAnimationFrame(() => {
              scrollTimelineToBottom("auto");
            });
          },
          reminderOn: iso,
          reminderTime: t || undefined,
          reminderNote: noteT || undefined,
        }
      );
      if (!cardId) return;
      queueMicrotask(() => {
        setDetailCard({
          colId: LOOSE_NOTES_COLLECTION_ID,
          card: {
            id: cardId,
            text: "",
            minutesOfDay: mod,
            addedOn: iso,
            reminderOn: iso,
            ...(t ? { reminderTime: t } : {}),
            ...(noteT ? { reminderNote: noteT } : {}),
          },
        });
      });
    },
    [canEdit, appendNoteCardWithHtml, scrollTimelineToBottom]
  );

  const commitCollectionRename = useCallback(async () => {
    if (!editingCollectionId) return;
    const colId = editingCollectionId;
    const trimmed = draftCollectionName.trim();
    const name = trimmed.length > 0 ? trimmed : c.newCollectionName;
    setCollections((prev) =>
      mapCollectionById(prev, colId, (col) => ({
        ...col,
        name,
      }))
    );
    setEditingCollectionId(null);
    if (dataMode === "remote" && canEdit) {
      const ok = await updateCollectionApi(colId, { name });
      if (!ok) {
        window.alert(c.errRenameSync);
      }
    }
  }, [editingCollectionId, draftCollectionName, dataMode, canEdit, c.newCollectionName, c.errRenameSync]);

  const onCollectionNameBlur = useCallback(() => {
    if (skipCollectionBlurCommitRef.current) {
      skipCollectionBlurCommitRef.current = false;
      return;
    }
    commitCollectionRename();
  }, [commitCollectionRename]);

  const addCollection = useCallback(async () => {
    if (!canEdit) return;
    skipCloseMobileNavOnActiveChangeRef.current = true;
    setTrashViewActive(false);
    setRemindersViewActive(false);
    setAllNotesViewActive(false);
    setConnectionsViewActive(false);
    setAttachmentsViewActive(false);
    setCalendarDay(null);
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newCol: Collection = {
      id,
      name: c.newCollectionName,
      dotColor: randomDotColor(),
      cards: [],
    };
    if (dataMode === "remote") {
      const created = await createCollectionApi({
        id,
        name: newCol.name,
        dotColor: newCol.dotColor,
      });
      if (!created) {
        window.alert(c.errCreateCol);
        return;
      }
      const merged: Collection = {
        ...newCol,
        ...created,
        cards: [],
        children: undefined,
      };
      setCollections((prev) => [...prev, merged]);
    } else {
      setCollections((prev) => [...prev, newCol]);
    }
    setActiveId(id);
    setDraftCollectionName(c.newCollectionName);
    setEditingCollectionId(id);
  }, [canEdit, dataMode, c.newCollectionName, c.errCreateCol]);

  const addSubCollection = useCallback(
    async (
      parentId: string,
      options?: { asCategory?: boolean; inheritParentSchema?: boolean }
    ) => {
      if (!canEdit) return;
      skipCloseMobileNavOnActiveChangeRef.current = true;
      setTrashViewActive(false);
      setRemindersViewActive(false);
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
      setAttachmentsViewActive(false);
      setCalendarDay(null);
      const asCategory = options?.asCategory === true;
      const parentCol = findCollectionById(collections, parentId);
      const inheritedSchema =
        asCategory && options?.inheritParentSchema !== false
          ? parentCol?.cardSchema
          : undefined;
      const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const child: Collection = {
        id,
        name: c.newSubCollectionName,
        dotColor: randomDotColor(),
        cards: [],
        ...(asCategory ? { isCategory: true } : {}),
        ...(inheritedSchema ? { cardSchema: inheritedSchema } : {}),
      };
      if (dataMode === "remote") {
        const created = await createCollectionApi({
          id,
          name: child.name,
          dotColor: child.dotColor,
          parentId,
        });
        if (!created) {
          window.alert(c.errCreateSub);
          return;
        }
        if (asCategory) {
          const ok = await updateCollectionApi(id, {
            isCategory: true,
            cardSchema: inheritedSchema ?? { version: 1, fields: [] },
          });
          if (!ok) {
            await deleteCollectionApi(id);
            window.alert(c.errCreateSub);
            return;
          }
        }
        const merged: Collection = {
          ...child,
          ...created,
          cards: [],
          children: undefined,
        };
        setCollections((prev) =>
          insertChildCollection(prev, parentId, merged)
        );
      } else {
        setCollections((prev) =>
          insertChildCollection(prev, parentId, child)
        );
      }
      setCollapsedFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      setActiveId(id);
      setDraftCollectionName(c.newSubCollectionName);
      setEditingCollectionId(id);
    },
    [canEdit, collections, dataMode, c.newSubCollectionName, c.errCreateSub]
  );

  const toggleFavoriteCollection = useCallback(
    (id: string) => {
      if (id === LOOSE_NOTES_COLLECTION_ID) return;
      setFavoriteCollectionIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (dataMode === "local") {
          saveFavoriteCollectionIds(favoriteStorageKey, next);
        } else if (canEdit) {
          void putMeFavorites([...next]);
        }
        return next;
      });
    },
    [favoriteStorageKey, dataMode, canEdit]
  );

  const performRemoveCollection = useCallback(
    async (id: string) => {
      if (!canEdit) return;
      if (id === LOOSE_NOTES_COLLECTION_ID) return;

      const subtreeRoot = findCollectionById(collections, id);
      if (!subtreeRoot) return;

      const toTrash = collectCardsInSubtreeWithPathLabels(collections, id);
      const subtreeIds = collectSubtreeCollectionIds(subtreeRoot);

      const batchTs = Date.now();
      const newTrashEntries: TrashedNoteEntry[] = toTrash.map((item, idx) => ({
        trashId:
          dataMode === "remote"
            ? item.card.id
            : `t-${batchTs}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
        colId: LOOSE_NOTES_COLLECTION_ID,
        colPathLabel: item.colPathLabel,
        card: structuredClone(item.card) as NoteCard,
        deletedAt: new Date().toISOString(),
      }));

      if (dataMode === "remote") {
        for (const entry of newTrashEntries) {
          const ok = await postMeTrashEntry(entry);
          if (!ok) {
            window.alert(c.errTrashMove);
            return;
          }
        }
        const ok = await deleteCollectionApi(id);
        if (!ok) {
          window.alert(c.errDeleteCol);
          return;
        }
      }

      if (newTrashEntries.length > 0) {
        setTrashEntries((te) => {
          const next = [...newTrashEntries, ...te];
          if (dataMode === "local") {
            saveTrashedNoteEntries(trashStorageKey, next);
          }
          return next;
        });
      }

      setDraggingCollectionId((d) => (d === id ? null : d));
      setDropIndicator((di) => (di?.targetId === id ? null : di));
      setEditingCollectionId((e) => (e === id ? null : e));

      setCollections((prev) => {
        const node = findCollectionById(prev, id);
        if (!node) return prev;
        const { tree, removed } = removeCollectionFromTree(prev, id);
        if (!removed) return prev;
        let next = tree;
        for (const item of toTrash) {
          next = stripRelatedRefsToTarget(next, item.colId, item.card.id);
        }
        return next;
      });

      if (subtreeIds.length > 0) {
        setCollapsedFolderIds((prev) => {
          const next = new Set(prev);
          for (const sid of subtreeIds) next.delete(sid);
          return next;
        });
        setFavoriteCollectionIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const sid of subtreeIds) {
            if (next.has(sid)) {
              next.delete(sid);
              changed = true;
            }
          }
          if (!changed) return prev;
          if (dataMode === "local") {
            saveFavoriteCollectionIds(favoriteStorageKey, next);
          } else if (canEdit) {
            void putMeFavorites([...next]);
          }
          return next;
        });
      }
    },
    [
      canEdit,
      collections,
      dataMode,
      favoriteStorageKey,
      trashStorageKey,
      c.errDeleteCol,
      c.errTrashMove,
    ]
  );

  const openRemoveCollectionDialog = useCallback(
    (id: string, displayName: string, hasSubtree: boolean) => {
      if (!canEdit) return;
      setCollectionCtxMenu(null);
      setCollectionDeleteDialog({
        id,
        displayName,
        hasSubtree,
      });
    },
    [canEdit]
  );

  const openMergeCollectionDialog = useCallback(
    (id: string, displayName: string) => {
      if (!canEdit) return;
      if (id === LOOSE_NOTES_COLLECTION_ID) return;
      setCollectionCtxMenu(null);
      setMergeCollectionDialog({ sourceId: id, displayName });
    },
    [canEdit]
  );

  const performMergeCollection = useCallback(
    async (sourceId: string, targetId: string) => {
      if (!canEdit) return;
      if (sourceId === targetId) return;
      const subtreeRoot = findCollectionById(collections, sourceId);
      if (!subtreeRoot) return;

      const merged = mergeCollectionSubtreeIntoTarget(
        collections,
        sourceId,
        targetId
      );
      if (!merged) {
        window.alert(c.errMergeCol);
        return;
      }
      const { nextTree, movedCardIds, duplicateMoves, mergedSchemaFields } =
        merged;
      const subtreeIds = collectSubtreeCollectionIds(subtreeRoot);

      if (dataMode === "remote") {
        const totalSteps =
          movedCardIds.length +
          duplicateMoves.length +
          (mergedSchemaFields ? 1 : 0) +
          1;
        setCollectionCloudSyncProgress({
          current: 0,
          total: totalSteps,
          variant: "merge",
        });
        try {
          const ok = await persistMergeCollectionsRemote(
            nextTree,
            targetId,
            new Set(movedCardIds),
            sourceId,
            merged.moves,
            (current, total) => {
              setCollectionCloudSyncProgress({
                current,
                total,
                variant: "merge",
              });
            },
            duplicateMoves,
            mergedSchemaFields
          );
          if (!ok) {
            window.alert(c.errMergeColSave);
            return;
          }
        } finally {
          setCollectionCloudSyncProgress(null);
        }
      }

      setCollections(nextTree);
      if (subtreeIds.includes(activeId)) {
        setActiveId(targetId);
      }
      if (subtreeIds.length > 0) {
        setCollapsedFolderIds((prev) => {
          const next = new Set(prev);
          for (const sid of subtreeIds) next.delete(sid);
          return next;
        });
        setFavoriteCollectionIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const sid of subtreeIds) {
            if (next.has(sid)) {
              next.delete(sid);
              changed = true;
            }
          }
          if (!changed) return prev;
          if (dataMode === "local") {
            saveFavoriteCollectionIds(favoriteStorageKey, next);
          } else if (canEdit) {
            void putMeFavorites([...next]);
          }
          return next;
        });
      }
    },
    [
      activeId,
      canEdit,
      collections,
      dataMode,
      favoriteStorageKey,
      c.errMergeCol,
      c.errMergeColSave,
    ]
  );

  const openMoveUnderCollectionDialog = useCallback(
    (id: string, displayName: string) => {
      if (!canEdit) return;
      if (id === LOOSE_NOTES_COLLECTION_ID) return;
      setCollectionCtxMenu(null);
      setMoveUnderCollectionDialog({ sourceId: id, displayName });
    },
    [canEdit]
  );

  const openCollectionTemplateDialog = useCallback(
    (id: string, displayName: string) => {
      if (!canEdit) return;
      setCollectionCtxMenu(null);
      setCollectionTemplateDialog({ collectionId: id, displayName });
    },
    [canEdit]
  );

  const performCollectionTemplateSave = useCallback(
    async (
      collectionId: string,
      patch: {
        fields: SchemaField[] | null;
        dotColor: string;
        iconShape: CollectionIconShape;
      }
    ) => {
      if (!canEdit) return;
      const prevCol = findCollectionById(collections, collectionId);
      const nextDotColor = patch.dotColor.trim() || prevCol?.dotColor || "";
      const nextIconShape: CollectionIconShape = patch.iconShape;
      /** schema 只读场景：只更新颜色 / 形状，不重写 cardSchema.fields */
      const schema: CollectionCardSchema | null =
        patch.fields === null
          ? null
          : {
              ...(prevCol?.cardSchema ?? {}),
              version: 1,
              fields: patch.fields.map((f, idx) => ({ ...f, order: idx })),
            };
      setCollections((prev) =>
        mapCollectionById(prev, collectionId, (col) => ({
          ...col,
          ...(schema ? { cardSchema: schema } : {}),
          dotColor: nextDotColor,
          iconShape: nextIconShape,
        }))
      );
      if (dataMode === "remote" && canEdit) {
        const ok = await updateCollectionApi(collectionId, {
          ...(schema ? { cardSchema: schema } : {}),
          dotColor: nextDotColor,
          iconShape: nextIconShape,
        });
        if (!ok) window.alert(c.errCollectionTemplateSync);
      }
    },
    [canEdit, dataMode, c.errCollectionTemplateSync, collections]
  );

  const performMoveCollectionUnder = useCallback(
    async (sourceId: string, parentId: string) => {
      if (!canEdit) return;
      if (sourceId === parentId) return;
      if (sourceId === LOOSE_NOTES_COLLECTION_ID) return;

      const next = moveCollectionInTree(
        collections,
        sourceId,
        parentId,
        "inside"
      );
      if (next === collections) {
        window.alert(c.errMoveCollectionUnder);
        return;
      }

      if (dataMode === "remote") {
        try {
          const ok = await persistCollectionTreeLayoutRemoteWithRetry(
            next,
            (current, total) =>
              collectionLayoutRemoteSync.progress(current, total),
            collections
          );
          if (!ok) {
            await resyncRemoteCollectionsTree();
            window.alert(c.errCollectionLayoutSave);
            return;
          }
        } finally {
          collectionLayoutRemoteSync.end();
        }
      }

      setCollections(next);
      setCollapsedFolderIds((prev) => {
        const n = new Set(prev);
        n.delete(parentId);
        return n;
      });
    },
    [
      canEdit,
      collections,
      dataMode,
      resyncRemoteCollectionsTree,
      setCollapsedFolderIds,
      setCollections,
      c.errMoveCollectionUnder,
      c.errCollectionLayoutSave,
      collectionLayoutRemoteSync,
    ]
  );

  const toggleFolderCollapsed = useCallback((folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const expandAncestorsOf = useCallback(
    (targetId: string) => {
      const ancestors = ancestorIdsFor(collections, targetId);
      if (ancestors.length === 0) return;
      setCollapsedFolderIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((id) => next.delete(id));
        return next;
      });
    },
    [collections]
  );

  /**
   * 左侧 rail 活动项。基于现有状态派生，不引入新的持久化 state：
   *   trash/reminders/connections/calendar 视图标志 → 对应 key
   *   activeId 命中「已归档」合集 → "archived"
   *   activeId 命中 topic / clip / work … 子树 → 对应 key
   *   attachmentsViewActive 或文件子类型 activeId → "files"
   *   allNotesViewActive 或 notes 子树 activeId → "notes"
   *   否则 → "overview"
   */
  const presetCatalogRootIds = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const baseId of SIDEBAR_COLLAPSIBLE_PRESET_BASE_IDS) {
      const root = findCollectionByPresetType(collections, baseId);
      m[baseId] = root?.id ?? null;
    }
    return m;
  }, [collections]);

  const activeIdInSubtree = useCallback(
    (rootId: string | null | undefined): boolean => {
      if (!rootId || !activeId) return false;
      if (rootId === activeId) return true;
      let hit = false;
      walkCollections(collections, (col) => {
        if (hit) return;
        if (col.id !== rootId) return;
        walkCollections([col], (inner) => {
          if (inner.id === activeId) hit = true;
        });
      });
      return hit;
    },
    [activeId, collections]
  );

  const railKey: RailKey = useMemo(() => {
    if (trashViewActive) return "trash";
    if (remindersViewActive) return "reminders";
    if (connectionsViewActive) return "connections";
    if (calendarDay != null) return "calendar";
    if (activeId && archivedSubtreeIds.has(activeId)) return "archived";
    if (activeIdInSubtree(topicNavRootCol?.id)) return "topic";
    if (activeIdInSubtree(clipParentCol?.id)) return "clip";
    for (const baseId of SIDEBAR_COLLAPSIBLE_PRESET_BASE_IDS) {
      if (activeIdInSubtree(presetCatalogRootIds[baseId])) {
        return baseId as RailKey;
      }
    }
    if (attachmentsViewActive) return "files";
    if (
      activeIdInSubtree(findCollectionByPresetType(collections, "file")?.id)
    ) {
      return "files";
    }
    if (allNotesViewActive) return "notes";
    if (activeIdInSubtree(noteNavRootCol?.id)) return "notes";
    /* 新用户/无 preset-note 根：普通根合集（无 presetTypeId）及其后代也归到「笔记」rail，
       否则点进种子合集或新建合集时 railKey 会落到 overview，造成「跳回概览」与无法添加笔记。 */
    if (activeId) {
      for (const pf of filterPlainFolderCollectionsForNotesSidebar(collections)) {
        if (activeIdInSubtree(pf.id)) return "notes";
      }
    }
    return "overview";
  }, [
    trashViewActive,
    remindersViewActive,
    connectionsViewActive,
    calendarDay,
    archivedSubtreeIds,
    activeId,
    attachmentsViewActive,
    allNotesViewActive,
    topicNavRootCol?.id,
    clipParentCol?.id,
    presetCatalogRootIds,
    noteNavRootCol?.id,
    collections,
    activeIdInSubtree,
  ]);

  const railAvailability = useMemo(
    () => ({
      notes: true,
      files: Boolean(findCollectionByPresetType(collections, "file")),
      topic: Boolean(topicNavRootCol),
      clip: Boolean(clipParentCol),
      task: Boolean(presetCatalogRootIds.task),
      project: Boolean(presetCatalogRootIds.project),
      expense: Boolean(presetCatalogRootIds.expense),
      account: Boolean(presetCatalogRootIds.account),
      archived: Boolean(archivedColId),
    }),
    [
      collections,
      topicNavRootCol,
      clipParentCol,
      presetCatalogRootIds,
      archivedColId,
    ]
  );

  /** 展开 rail 时各入口右侧显示的总数；没有意义的入口（概览/日历/连接等）不提供 */
  const railCounts = useMemo((): Partial<Record<RailKey, number | string>> => {
    const m: Partial<Record<RailKey, number | string>> = {
      notes: allNotesSorted.length,
      files:
        dataMode === "remote"
          ? (remoteAttachmentsTotal ?? "–")
          : allMediaAttachmentEntries.length,
    };
    if (topicNavRootCol) m.topic = topicSectionCount;
    if (clipParentCol) m.clip = clipSectionCount;
    for (const baseId of SIDEBAR_COLLAPSIBLE_PRESET_BASE_IDS) {
      const group = PRESET_OBJECT_TYPES_GROUPS.find((g) => g.baseId === baseId);
      if (!group) continue;
      const navRootCol = presetGroupNavRootCollection(collections, group);
      if (!navRootCol) continue;
      m[baseId as RailKey] = countCollectionSubtreeCards(navRootCol);
    }
    if (archivedCol) m.archived = archivedSectionCount;
    return m;
  }, [
    allNotesSorted.length,
    dataMode,
    remoteAttachmentsTotal,
    allMediaAttachmentEntries.length,
    topicNavRootCol,
    topicSectionCount,
    clipParentCol,
    clipSectionCount,
    collections,
    archivedCol,
    archivedSectionCount,
  ]);

  const handleRailPick = useCallback(
    (key: RailKey, opts?: { collectionId?: string }) => {
      closeCardFullPage();
      setSearchQuery("");
      setSearchBarOpen(false);
      setMobileNavOpen(false);
      // 共同清空：所有 *ViewActive + calendarDay；具体分支再按需重置
      setTrashViewActive(false);
      setRemindersViewActive(false);
      setConnectionsViewActive(false);
      setAttachmentsViewActive(false);
      setAllNotesViewActive(false);
      setCalendarDay(null);

      if (opts?.collectionId) {
        setActiveId(opts.collectionId);
        expandAncestorsOf(opts.collectionId);
        return;
      }

      if (key === "overview") {
        setActiveId("");
        return;
      }
      if (key === "notes") {
        setAllNotesViewActive(true);
        if (!activeIdInSubtree(noteNavRootCol?.id)) {
          setActiveId("");
        }
        return;
      }
      if (key === "files") {
        setAttachmentsFilterKey("all");
        setAttachmentsViewActive(true);
        setActiveId("");
        return;
      }
      if (key === "topic" && topicNavRootCol) {
        setActiveId(topicNavRootCol.id);
        expandAncestorsOf(topicNavRootCol.id);
        return;
      }
      if (key === "clip" && clipParentCol) {
        setActiveId(clipParentCol.id);
        expandAncestorsOf(clipParentCol.id);
        return;
      }
      if (
        key === "task" ||
        key === "project" ||
        key === "expense" ||
        key === "account"
      ) {
        const rootId = presetCatalogRootIds[key];
        if (rootId) {
          setActiveId(rootId);
          expandAncestorsOf(rootId);
        }
        return;
      }
      if (key === "calendar") {
        setCalendarDay(localDateString());
        return;
      }
      if (key === "reminders") {
        setRemindersViewActive(true);
        setActiveId("");
        return;
      }
      if (key === "connections") {
        setConnectionsViewActive(true);
        setConnectionsPrimed(true);
        setActiveId("");
        return;
      }
      if (key === "archived" && archivedColId) {
        setActiveId(archivedColId);
        expandAncestorsOf(archivedColId);
        return;
      }
      if (key === "trash") {
        setTrashViewActive(true);
        setActiveId("");
        return;
      }
    },
    [
      closeCardFullPage,
      setSearchQuery,
      setSearchBarOpen,
      setMobileNavOpen,
      setTrashViewActive,
      setRemindersViewActive,
      setConnectionsViewActive,
      setAttachmentsViewActive,
      setAllNotesViewActive,
      setCalendarDay,
      setActiveId,
      setConnectionsPrimed,
      activeIdInSubtree,
      noteNavRootCol?.id,
      collections,
      topicNavRootCol,
      clipParentCol,
      presetCatalogRootIds,
      archivedColId,
      expandAncestorsOf,
    ]
  );

  /** 合集 id → 合集对象，供 LRU / 收藏按 id 查找 */
  const collectionsById = useMemo(() => {
    const m = new Map<string, Collection>();
    walkCollections(collections, (c) => {
      if (c.id !== LOOSE_NOTES_COLLECTION_ID) m.set(c.id, c);
    });
    return m;
  }, [collections]);

  /**
   * cardId → 出现合集数（含 __loose_notes）。
   * 渲染时间线每张卡片需要判断"是否多合集 placement"以决定是否展示从合集移除菜单，
   * 之前对每张卡 walk 整树是 O(N²)，改为整树预扫一次后 O(1) 查找。
   */
  const cardPlacementCountByCardId = useMemo(
    () => buildCardPlacementCountIndex(collections),
    [collections]
  );

  /**
   * 当 activeId 指向一个真实合集时，把它 MRU 提到「最近合集」队首。
   * 跳过 "" / 未归类 / 已不在树上的 id。
   */
  useEffect(() => {
    const id = activeId;
    if (!id) return;
    if (!collectionsById.has(id)) return;
    setRecentCollectionIds((prev) => {
      if (prev[0] === id) return prev;
      const next = [id, ...prev.filter((x) => x !== id)].slice(
        0,
        RECENT_COLLECTIONS_LIMIT
      );
      saveRecentCollectionIds(recentCollectionsKey, next);
      return next;
    });
  }, [activeId, collectionsById, recentCollectionsKey]);

  /** 概览主侧栏「最近合集」：按 MRU 顺序列出仍存在的合集 */
  const recentCollectionsForOverview = useMemo(() => {
    const out: Collection[] = [];
    for (const id of recentCollectionIds) {
      const col = collectionsById.get(id);
      if (col) out.push(col);
    }
    return out;
  }, [recentCollectionIds, collectionsById]);

  /** 概览主侧栏「收藏」：按稳定顺序（遍历树）列出被标星的合集 */
  const favoriteCollectionsForOverview = useMemo(() => {
    if (favoriteCollectionIds.size === 0) return [];
    const out: Collection[] = [];
    walkCollections(collections, (c) => {
      if (favoriteCollectionIds.has(c.id)) out.push(c);
    });
    return out;
  }, [favoriteCollectionIds, collections]);

  // ───────────────────────────────────────────────────────────────────────
  // 概览 Dashboard 聚合：今日/本周日期锚点 + 类型 widget + 提醒分拣
  // ───────────────────────────────────────────────────────────────────────

  /** 今日本地 YMD，用于"今日到期 / 本周新增" 判定 */
  const overviewTodayYmd = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  /** Hero 右上角"今天"人读文案：复用日历标题的格式化 */
  const overviewTodayLabel = useMemo(
    () => formatCalendarDayTitle(overviewTodayYmd, appUiLang),
    [overviewTodayYmd, appUiLang]
  );

  /** 7 天前本地 YMD（含今日共 7 天） */
  const overviewWeekStartYmd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  /** 本周新增卡片总数（全库，addedOn >= 7 天前） */
  const overviewWeekNewCount = useMemo(() => {
    let n = 0;
    walkCollections(collections, (col) => {
      for (const card of col.cards) {
        const on = card.addedOn ?? "";
        if (on && on >= overviewWeekStartYmd) n += 1;
      }
    });
    return n;
  }, [collections, overviewWeekStartYmd]);

  /** 各预设类型的 widget 聚合：总数 + 最近 2 条 + 类型特定 pills */
  const overviewTypeWidgets = useMemo((): OverviewTypeWidget[] => {
    const extractTitle = (card: NoteCard): string => {
      const raw = String(card.text || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!raw) return "";
      return raw.length > 40 ? raw.slice(0, 40) + "…" : raw;
    };
    const summarizeSubtree = (root: Collection | null | undefined) => {
      if (!root) {
        return {
          total: 0,
          weekNew: 0,
          recent: [] as Array<{ id: string; collectionId: string; title: string }>,
        };
      }
      let total = 0;
      let weekNew = 0;
      const entries: Array<{
        card: NoteCard;
        col: Collection;
        sortKey: string;
      }> = [];
      walkCollections([root], (col) => {
        for (const card of col.cards) {
          total += 1;
          const on = card.addedOn ?? "";
          if (on && on >= overviewWeekStartYmd) weekNew += 1;
          const sortKey = `${on}-${String(card.minutesOfDay ?? 0).padStart(6, "0")}`;
          entries.push({ card, col, sortKey });
        }
      });
      entries.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
      const recent = entries.slice(0, 2).map((e) => ({
        id: e.card.id,
        collectionId: e.col.id,
        title: extractTitle(e.card),
      }));
      return { total, weekNew, recent };
    };

    const out: OverviewTypeWidget[] = [];

    // 笔记：优先 preset-note 根；新用户没有该根时退回到所有普通根合集（与笔记侧栏 fallback 一致），
    // 否则首页类型汇总会缺失「笔记」一栏。
    {
      const notesRoots: Collection[] = noteNavRootCol
        ? [noteNavRootCol]
        : filterPlainFolderCollectionsForNotesSidebar(collections);
      if (notesRoots.length > 0) {
        let total = 0;
        let weekNew = 0;
        const recentAgg: Array<{
          card: NoteCard;
          col: Collection;
          sortKey: string;
        }> = [];
        for (const root of notesRoots) {
          walkCollections([root], (col) => {
            for (const card of col.cards) {
              total += 1;
              const on = card.addedOn ?? "";
              if (on && on >= overviewWeekStartYmd) weekNew += 1;
              const sortKey = `${on}-${String(card.minutesOfDay ?? 0).padStart(6, "0")}`;
              recentAgg.push({ card, col, sortKey });
            }
          });
        }
        recentAgg.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
        const recent = recentAgg.slice(0, 2).map((e) => ({
          id: e.card.id,
          collectionId: e.col.id,
          title: extractTitle(e.card),
        }));
        out.push({
          key: "preset-notes",
          railKey: "notes",
          label: c.railNotes,
          icon: "arch",
          color: "#E88368",
          mainCount: total,
          pills:
            weekNew > 0 ? [{ key: "week", label: `+${weekNew} 本周` }] : [],
          recentCards: recent,
        });
      }
    }

    // 文件：用附件扁平列表计数，按 kind 出胶囊
    {
      const total =
        dataMode === "remote"
          ? remoteAttachmentsTotal ?? allMediaAttachmentEntries.length
          : allMediaAttachmentEntries.length;
      const counts =
        dataMode === "remote"
          ? remoteAttachmentCountsByCategory
          : localAttachmentCountsByCategory;
      const kindEmoji: Record<AttachmentUiCategory, string> = {
        image: "🖼",
        video: "🎬",
        audio: "🎵",
        document: "📄",
        other: "📦",
      };
      const pills: OverviewPill[] = [];
      for (const k of [
        "image",
        "video",
        "audio",
        "document",
      ] as AttachmentUiCategory[]) {
        const n = counts[k];
        if (typeof n === "number" && n > 0) {
          pills.push({ key: k, label: `${kindEmoji[k]} ${n}` });
        }
      }
      const recentAtts = allMediaAttachmentEntries
        .slice(0, 2)
        .map((e) => ({
          id: e.card.id,
          collectionId: e.col.id,
          title: e.item.name || extractTitle(e.card),
        }));
      out.push({
        key: "preset-files",
        railKey: "files",
        label: c.railFiles,
        icon: "stair",
        color: "#E68045",
        mainCount: typeof total === "number" ? total : null,
        pills,
        recentCards: recentAtts,
      });
    }

    // 主题
    if (topicNavRootCol) {
      const s = summarizeSubtree(topicNavRootCol);
      out.push({
        key: "preset-topic",
        railKey: "topic",
        label: c.railTopic,
        icon: "quad",
        color: "#D98A3A",
        mainCount: s.total,
        pills:
          s.weekNew > 0
            ? [{ key: "week", label: `+${s.weekNew} 本周` }]
            : [],
        recentCards: s.recent,
      });
    }

    // 剪藏：按子类型（objectKind）分桶显示
    if (clipParentCol) {
      const s = summarizeSubtree(clipParentCol);
      const subCounts = new Map<string, number>();
      walkCollections([clipParentCol], (col) => {
        for (const card of col.cards) {
          const k = card.objectKind || "";
          if (k) subCounts.set(k, (subCounts.get(k) ?? 0) + 1);
        }
      });
      const subLabels: Array<[string, string]> = [
        ["post_xhs", "小红书"],
        ["post_bilibili", "B 站"],
        ["clip_wechat", "微信"],
        ["clip_bookmark", "网页"],
      ];
      const pills: OverviewPill[] = [];
      for (const [kind, label] of subLabels) {
        const n = subCounts.get(kind) ?? 0;
        if (n > 0) pills.push({ key: kind, label: `${label} ${n}` });
      }
      out.push({
        key: "preset-clip",
        railKey: "clip",
        label: c.railClip,
        icon: "arc",
        color: "#E6A82A",
        mainCount: s.total,
        pills,
        recentCards: s.recent,
      });
    }

    // 任务 / 项目 / 费用 / 账号：统一按 subtree summarize + "+本周"
    const extraDefs: Array<{
      baseId: (typeof SIDEBAR_COLLAPSIBLE_PRESET_BASE_IDS)[number];
      label: string;
      icon: RailIconKey;
      color: string;
    }> = [
      { baseId: "task", label: c.railTask, icon: "wave", color: "#7F8F4F" },
      { baseId: "project", label: c.railProject, icon: "butterfly", color: "#9FAD72" },
      { baseId: "expense", label: c.railExpense, icon: "capsule", color: "#1F5F57" },
      { baseId: "account", label: c.railAccount, icon: "heart", color: "#5C9D8F" },
    ];
    for (const def of extraDefs) {
      const rootId = presetCatalogRootIds[def.baseId];
      if (!rootId) continue;
      const root = collectionsById.get(rootId) ?? null;
      if (!root) continue;
      const s = summarizeSubtree(root);
      // 任务特例：pill 展示今日到期 / 逾期未完成
      let pills: OverviewPill[] = [];
      if (def.baseId === "task") {
        let todayCount = 0;
        let overdueCount = 0;
        walkCollections([root], (col) => {
          for (const card of col.cards) {
            if (card.reminderCompletedAt) continue;
            const r = card.reminderOn?.trim();
            if (!r) continue;
            if (r === overviewTodayYmd) todayCount += 1;
            else if (r < overviewTodayYmd) overdueCount += 1;
          }
        });
        if (todayCount > 0) {
          pills.push({ key: "today", label: `今日 ${todayCount}` });
        }
        if (overdueCount > 0) {
          pills.push({
            key: "overdue",
            label: `逾期 ${overdueCount}`,
            hot: true,
          });
        }
      } else if (s.weekNew > 0) {
        pills = [{ key: "week", label: `+${s.weekNew} 本周` }];
      }
      out.push({
        key: `preset-${def.baseId}`,
        railKey: def.baseId as RailKey,
        label: def.label,
        icon: def.icon,
        color: def.color,
        mainCount: s.total,
        pills,
        recentCards: s.recent,
      });
    }

    /** 自定义合集 widgets：用户标星的合集全部作为类型格追加；
     *  跳过已被预设 widget 代表的合集（避免和「笔记/文件/剪藏…」重复） */
    const presetRootColIds = new Set<string>();
    if (noteNavRootCol) presetRootColIds.add(noteNavRootCol.id);
    if (topicNavRootCol) presetRootColIds.add(topicNavRootCol.id);
    if (clipParentCol) presetRootColIds.add(clipParentCol.id);
    for (const def of extraDefs) {
      const rootId = presetCatalogRootIds[def.baseId];
      if (rootId) presetRootColIds.add(rootId);
    }
    for (const col of favoriteCollectionsForOverview) {
      if (presetRootColIds.has(col.id)) continue;
      const s = summarizeSubtree(col);
      out.push({
        key: `col-${col.id}`,
        railKey: "notes",
        collectionId: col.id,
        label: col.name,
        collectionIcon: { shape: col.iconShape, dotColor: col.dotColor },
        /** 自定义合集用它自己的圆点色做 accent；若没色用珊瑚兜底 */
        color: col.dotColor || "#E87866",
        mainCount: s.total,
        pills:
          s.weekNew > 0
            ? [{ key: "week", label: `+${s.weekNew} 本周` }]
            : [],
        recentCards: s.recent,
      });
    }

    return out;
  }, [
    c.railNotes,
    c.railFiles,
    c.railTopic,
    c.railClip,
    c.railTask,
    c.railProject,
    c.railExpense,
    c.railAccount,
    noteNavRootCol,
    topicNavRootCol,
    clipParentCol,
    presetCatalogRootIds,
    collectionsById,
    allMediaAttachmentEntries,
    localAttachmentCountsByCategory,
    remoteAttachmentCountsByCategory,
    remoteAttachmentsTotal,
    dataMode,
    overviewWeekStartYmd,
    overviewTodayYmd,
    favoriteCollectionsForOverview,
  ]);

  /** 今日日历：未完成 + reminderOn === 今日，最多 3 条 */
  const overviewTodayCalendar = useMemo((): OverviewReminderItem[] => {
    const out: OverviewReminderItem[] = [];
    for (const e of allReminderEntries) {
      if (e.card.reminderCompletedAt) continue;
      if (e.reminderOn !== overviewTodayYmd) continue;
      out.push({
        card: e.card,
        col: e.col,
        timeLabel: (e.card.reminderTime || "--:--").slice(0, 5),
        overdue: false,
      });
      if (out.length >= 3) break;
    }
    return out;
  }, [allReminderEntries, overviewTodayYmd]);

  /** 未完成提醒（到期时间升序），最多 5 条；reminderOn < 今日的标 hot */
  const overviewUpcomingReminders = useMemo((): OverviewReminderItem[] => {
    const entries: OverviewReminderItem[] = [];
    for (const e of allReminderEntries) {
      if (e.card.reminderCompletedAt) continue;
      if (e.reminderOn === overviewTodayYmd) continue; // 今日另一组
      if (e.reminderOn > overviewTodayYmd) {
        entries.push({
          card: e.card,
          col: e.col,
          timeLabel: e.reminderOn.slice(5),
          overdue: false,
        });
      } else {
        entries.push({
          card: e.card,
          col: e.col,
          timeLabel: `逾期 ${daysBetweenYmd(e.reminderOn, overviewTodayYmd)} 天`,
          overdue: true,
        });
      }
    }
    /** 逾期在前（最久逾期排最上），然后未来（最近的排最上） */
    entries.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.overdue && b.overdue) {
        return a.card.reminderOn!.localeCompare(b.card.reminderOn!);
      }
      return a.card.reminderOn!.localeCompare(b.card.reminderOn!);
    });
    return entries.slice(0, 5);
  }, [allReminderEntries, overviewTodayYmd]);

  /** 打开卡片大页（概览 dashboard 点击 recent / notification 使用） */
  const openOverviewCard = useCallback(
    (colId: string, cardId: string) => {
      setDetailCard(null);
      setCardPageCard({ colId, cardId });
    },
    []
  );

  /** 概览相册候选：所有图片附件，按卡 id + url 去重。直接走 collections 兼容云端模式。 */
  const overviewPhotoItems =
    useMemo((): import("./appkit/OverviewPhotoAlbum").OverviewPhotoItem[] => {
      const out: import("./appkit/OverviewPhotoAlbum").OverviewPhotoItem[] = [];
      const seen = new Set<string>();
      walkCollections(collections, (col) => {
        for (const card of col.cards) {
          const media = card.media;
          if (!Array.isArray(media) || media.length === 0) continue;
          for (const item of media) {
            if (item.kind !== "image") continue;
            if (!item.url) continue;
            const key = `${card.id}:${item.url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ card, col, item });
          }
        }
      });
      return out;
    }, [collections]);

  /** 概览音乐播放器候选：音频附件且带封面（coverUrl 或 thumbnailUrl），按卡 id 去重。
   *  直接走 collections，避免 allMediaAttachmentEntries 在云端模式被置空时漏掉轨。 */
  const overviewAudioTracks =
    useMemo((): import("./appkit/OverviewMusicPlayer").OverviewMusicTrack[] => {
      const out: import("./appkit/OverviewMusicPlayer").OverviewMusicTrack[] = [];
      const seen = new Set<string>();
      walkCollections(collections, (col) => {
        for (const card of col.cards) {
          const media = card.media;
          if (!Array.isArray(media) || media.length === 0) continue;
          for (const item of media) {
            if (item.kind !== "audio") continue;
            const hasCover = Boolean(
              (item.coverUrl && item.coverUrl.trim()) ||
                (item.thumbnailUrl && item.thumbnailUrl.trim())
            );
            if (!hasCover) continue;
            const key = `${card.id}:${item.url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              card,
              col,
              item,
              displayName:
                (item.name && item.name.trim()) ||
                (card.text
                  ? String(card.text)
                      .replace(/<[^>]+>/g, " ")
                      .trim()
                      .slice(0, 60)
                  : "") ||
                "（未命名）",
            });
          }
        }
      });
      return out;
    }, [collections]);

  // ─────────────────────────────────────────────────────────────────────
  // 概览 Hero 右侧「随手一翻」：随机抽一张有正文的笔记
  // ─────────────────────────────────────────────────────────────────────

  /** reroll 钥匙：每次点"换一条"产生一个新 float，触发 memo 重选 */
  const [overviewRandomRerollKey, setOverviewRandomRerollKey] = useState(
    () => Math.random()
  );
  const rerollOverviewRandom = useCallback(() => {
    setOverviewRandomRerollKey(Math.random());
  }, []);

  const overviewRandomCard =
    useMemo((): import("./appkit/OverviewDashboard").OverviewRandomCard | null => {
      /** 候选池：跳过纯文件卡 + 正文为空的卡；每张 card 仅按首次出现的 placement 记一次 */
      const pool: Array<{ card: NoteCard; col: Collection; snippet: string }> =
        [];
      const seen = new Set<string>();
      walkCollections(collections, (col) => {
        for (const card of col.cards) {
          if (seen.has(card.id)) continue;
          if (isFileCard(card)) continue;
          const snippet = String(card.text || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (!snippet) continue;
          seen.add(card.id);
          pool.push({
            card,
            col,
            snippet: snippet.length > 180 ? snippet.slice(0, 180) + "…" : snippet,
          });
        }
      });
      if (pool.length === 0) return null;
      const idx = Math.floor(overviewRandomRerollKey * pool.length);
      const picked = pool[Math.min(Math.max(0, idx), pool.length - 1)];
      const ymd = picked.card.addedOn ?? "";
      /** 日期标签：今天 / 昨天 / YYYY-MM-DD */
      let dateLabel = "";
      if (ymd) {
        if (ymd === overviewTodayYmd) dateLabel = "今天";
        else {
          const yest = new Date();
          yest.setDate(yest.getDate() - 1);
          const y = yest.getFullYear();
          const m = String(yest.getMonth() + 1).padStart(2, "0");
          const d = String(yest.getDate()).padStart(2, "0");
          dateLabel = ymd === `${y}-${m}-${d}` ? "昨天" : ymd;
        }
      }
      return {
        card: picked.card,
        col: picked.col,
        snippet: picked.snippet,
        dateLabel,
      };
    }, [collections, overviewRandomRerollKey, overviewTodayYmd]);

  /** rail 是否展开显示文字；持久化到 localStorage */
  const RAIL_EXPANDED_KEY = "ui:rail-expanded";
  const [railExpanded, setRailExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_EXPANDED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const handleToggleRailExpanded = useCallback(() => {
    setRailExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(RAIL_EXPANDED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const {
    onCollectionRowDragStart,
    onCollectionRowDragEnd,
    onCollectionRowDragOver,
    onCollectionRowDrop,
  } = useCollectionRowDnD({
    canEdit,
    dataMode,
    resyncCollectionsFromRemote: resyncRemoteCollectionsTree,
    collectionLayoutSaveFailedMessage: c.errCollectionLayoutSave,
    noteMoveSaveFailedMessage: c.errNoteMoveSave,
    dropOnCollectionToTop: readNewNotePlacement() === "top",
    noteCardDragActiveRef,
    draggingCollectionIdRef,
    getLatestCollections: () => collectionsRef.current,
    onCollectionLayoutRemoteSync: collectionLayoutRemoteSync,
    setCollections,
    setCollapsedFolderIds,
    setDraggingCollectionId,
    setDropIndicator,
    setNoteCardDropCollectionId,
    setCardDropMarker,
    setDraggingNoteCardKey,
  });

  useLayoutEffect(() => {
    if (!editingCollectionId) return;
    const el = collectionNameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingCollectionId]);

  const commitCollectionHint = useCallback(async () => {
    if (!editingHintCollectionId) return;
    const colId = editingHintCollectionId;
    const text = draftCollectionHint.trim();
    setCollections((prev) =>
      mapCollectionById(prev, colId, (col) => ({
        ...col,
        ...(text.length > 0 ? { hint: text } : { hint: undefined }),
      }))
    );
    setEditingHintCollectionId(null);
    if (dataMode === "remote" && canEdit) {
      const ok = await updateCollectionApi(colId, { hint: text });
      if (!ok) {
        window.alert(c.errHintSave);
      }
    }
  }, [editingHintCollectionId, draftCollectionHint, dataMode, canEdit, c.errHintSave]);

  const onCollectionHintBlur = useCallback(() => {
    if (skipHintBlurCommitRef.current) {
      skipHintBlurCommitRef.current = false;
      return;
    }
    commitCollectionHint();
  }, [commitCollectionHint]);

  useLayoutEffect(() => {
    if (!editingHintCollectionId) return;
    const el = collectionHintTextareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingHintCollectionId]);

  useLayoutEffect(() => {
    if (!editingHintCollectionId) return;
    const el = collectionHintTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editingHintCollectionId, draftCollectionHint]);

  useEffect(() => {
    setCardMenuId(null);
    setCollectionCtxMenu(null);
    setEditingHintCollectionId((prev) =>
      prev !== null && prev !== activeId ? null : prev
    );
  }, [activeId]);

  useEffect(() => {
    if (collectionCtxMenu === null) return;
    const onDocClick = (e: Event) => {
      const el = document.querySelector("[data-collection-ctx-menu]");
      if (!el?.contains(e.target as Node)) {
        setCollectionCtxMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollectionCtxMenu(null);
    };
    const tid = window.setTimeout(() => {
      document.addEventListener("click", onDocClick);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [collectionCtxMenu]);

  useEffect(() => {
    if (collectionDeleteDialog === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollectionDeleteDialog(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [collectionDeleteDialog]);

  useEffect(() => {
    if (mergeCollectionDialog === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMergeCollectionDialog(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mergeCollectionDialog]);

  useEffect(() => {
    if (moveUnderCollectionDialog === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoveUnderCollectionDialog(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moveUnderCollectionDialog]);

  useEffect(() => {
    if (collectionTemplateDialog === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollectionTemplateDialog(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [collectionTemplateDialog]);

  useEffect(() => {
    if (cardMenuId === null) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(`[data-card-menu-root="${cardMenuId}"]`)) {
        setCardMenuId(null);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [cardMenuId]);

  useEffect(() => {
    setCardMenuId(null);
  }, [trashViewActive]);

  const detailCardLive = useMemo(() => {
    if (!detailCard) return null;
    const col = findCollectionById(collections, detailCard.colId);
    const c = col?.cards.find((x) => x.id === detailCard.card.id);
    return c
      ? {
          colId: detailCard.colId,
          card: c,
          openAtMediaIndex: detailCard.openAtMediaIndex,
        }
      : null;
  }, [detailCard, collections]);

  useEffect(() => {
    if (detailCard && !detailCardLive) setDetailCard(null);
  }, [detailCard, detailCardLive]);

  const cardPageCardLive = useMemo(() => {
    if (!cardPageCard) return null;
    const col = findCollectionById(collections, cardPageCard.colId);
    const c = col?.cards.find((x) => x.id === cardPageCard.cardId);
    return c ? { colId: cardPageCard.colId, card: c } : null;
  }, [cardPageCard, collections]);

  const createLinkedCardFromProperty = useCallback(
    async (params: {
      title: string;
      targetCollectionId?: string;
      targetPresetTypeId?: string;
      targetObjectKind?: string;
    }): Promise<{ colId: string; cardId: string } | null> => {
      if (!canEdit || !cardPageCardLive) return null;
      const title = params.title.trim();
      if (!title) return null;

      let targetColId = params.targetCollectionId?.trim() ?? "";
      if (!targetColId && params.targetPresetTypeId?.trim()) {
        const localMatch = findCollectionByPresetType(
          collections,
          params.targetPresetTypeId.trim()
        );
        targetColId = localMatch?.id ?? "";
      }
      if (
        !targetColId &&
        dataMode === "remote" &&
        params.targetPresetTypeId?.trim()
      ) {
        targetColId =
          (await fetchPresetCollectionIdApi(params.targetPresetTypeId.trim())) ??
          "";
      }
      if (!targetColId || !findCollectionById(collections, targetColId)) {
        targetColId = cardPageCardLive.colId;
      }

      const now = new Date();
      const minutesOfDay = now.getHours() * 60 + now.getMinutes();
      const provisionalId = `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const newCard: NoteCard = {
        id: provisionalId,
        text: noteBodyToHtml(title),
        minutesOfDay,
        addedOn: localDateString(now),
        ...(params.targetObjectKind?.trim()
          ? { objectKind: params.targetObjectKind.trim() }
          : {}),
      };

      flushSync(() => {
        setCollections((prev) =>
          mapCollectionById(prev, targetColId, (col) => ({
            ...col,
            cards: [newCard, ...col.cards],
          }))
        );
      });

      if (dataMode === "local") {
        return { colId: targetColId, cardId: provisionalId };
      }

      const created = await createCardApi(targetColId, newCard, {
        insertAtStart: true,
      });
      if (!created) {
        flushSync(() => {
          setCollections((prev) =>
            mapCollectionById(prev, targetColId, (col) => ({
              ...col,
              cards: col.cards.filter((c) => c.id !== provisionalId),
            }))
          );
        });
        return null;
      }

      if (created.id !== provisionalId) {
        flushSync(() => {
          setCollections((prev) =>
            mapCollectionById(prev, targetColId, (col) => ({
              ...col,
              cards: col.cards.map((c) =>
                c.id === provisionalId ? { ...created } : c
              ),
            }))
          );
        });
      } else {
        flushSync(() => {
          setCollections((prev) =>
            mapCollectionById(prev, targetColId, (col) => ({
              ...col,
              cards: col.cards.map((c) =>
                c.id === provisionalId ? { ...created } : c
              ),
            }))
          );
        });
      }

      return { colId: targetColId, cardId: created.id };
    },
    [canEdit, cardPageCardLive, collections, dataMode]
  );

  useLayoutEffect(() => {
    let k = "note";
    if (allNotesViewActive || remindersViewActive) {
      objectKindForNewTimelineCardRef.current = k;
      return;
    }
    if (cardPageCardLive?.card) {
      k = cardPageCardLive.card.objectKind ?? "note";
    } else if (detailCardLive?.card) {
      k = detailCardLive.card.objectKind ?? "note";
    } else {
      const pid = active?.presetTypeId?.trim();
      if (pid) k = pid;
    }
    objectKindForNewTimelineCardRef.current = k;
  }, [
    allNotesViewActive,
    remindersViewActive,
    cardPageCardLive?.card?.id,
    cardPageCardLive?.card?.objectKind,
    detailCardLive?.card?.id,
    detailCardLive?.card?.objectKind,
    active?.presetTypeId,
  ]);

  useEffect(() => {
    syncCardPageParamsToUrl(cardPageCard);
  }, [cardPageCard]);

  useEffect(() => {
    if (!cardPageCard) return;
    if (cardPageCardLive) return;
    if (!authReady) return;
    /* 云端首包未到时 card 尚不在树里，勿误判为已删 */
    if (dataMode === "remote" && !remoteLoaded) return;
    const nextCol = pickPlacementColIdForCard(
      collections,
      cardPageCard.cardId,
      cardPageCard.colId
    );
    if (nextCol) {
      if (nextCol !== cardPageCard.colId) {
        setCardPageCard({ colId: nextCol, cardId: cardPageCard.cardId });
      }
      return;
    }
    setCardPageCard(null);
  }, [
    cardPageCard,
    cardPageCardLive,
    collections,
    authReady,
    dataMode,
    remoteLoaded,
  ]);

  const timelineEmpty = activeNoteCards.length === 0;
  const listEmpty = pinned.length === 0 && rest.length === 0;

  const hideAddsInMobileBrowse =
    showMobileSidebarBrowseChrome && !mobileBrowseEditMode;
  /** 小屏编辑态：整行 draggable 易与滚动冲突，仅右侧三杠发起拖拽 */
  const mobileCollectionDragByHandle =
    showMobileSidebarBrowseChrome && mobileBrowseEditMode;

  function renderNoteTimelineCard(card: NoteCard, colId: string) {
    return (
      <NoteTimelineCard
        key={`${colId}-${card.id}`}
        card={card}
        colId={colId}
        canEdit={canEdit}
        canAttachMedia={canAttachMedia}
        cardMenuId={cardMenuId}
        setCardMenuId={setCardMenuId}
        uploadBusyCardId={uploadBusyCardId}
        uploadCardProgress={uploadCardProgress}
        cardDragOverId={cardDragOverId}
        setCardDragOverId={setCardDragOverId}
        draggingNoteCardKey={draggingNoteCardKey}
        cardDropMarker={cardDropMarker}
        noteCardDragActiveRef={noteCardDragActiveRef}
        setCardDropMarker={setCardDropMarker}
        setNoteCardDropCollectionId={setNoteCardDropCollectionId}
        setDraggingNoteCardKey={setDraggingNoteCardKey}
        setCollections={setCollections}
        dataMode={dataMode}
        setDetailCard={setDetailCard}
        beginCardMediaUpload={beginCardMediaUpload}
        clearCardMedia={clearCardMedia}
        uploadFilesToCard={uploadFilesToCard}
        removeCardMediaItem={removeCardMediaItem}
        setCardMediaCoverItem={setCardMediaCoverItem}
        togglePin={togglePin}
        removeCardFromCollection={(cId, cardId) => {
          void removeCardFromCollectionPlacementAt(cId, cardId);
        }}
        showRemoveFromCollectionMenu={
          colId !== LOOSE_NOTES_COLLECTION_ID ||
          (cardPlacementCountByCardId.get(card.id) ?? 0) > 1
        }
        deleteCard={deleteCard}
        setCardText={setCardText}
        timelineColumnCount={timelineColumnCount}
        openCardPage={(cId, cardId) => {
          setDetailCard(null);
          setCardPageCard({ colId: cId, cardId });
        }}
        foldBodyMaxLines={timelineFoldBodyThreeLines ? 3 : undefined}
        timelineGalleryOnRight={userNotePrefs.timelineGalleryOnRight !== false}
        onCreateFileCardFromAttachment={
          dataMode === "remote" &&
          (card.objectKind ?? "note") === "note"
            ? (item) => {
                void createFileCardFromNoteAttachment(
                  colId,
                  card.id,
                  item
                );
              }
            : undefined
        }
        attachmentHasLinkedFileCard={(item) =>
          noteHasLinkedFileCardForMedia(card, item, collections)
        }
        onOpenFileCard={(item: NoteMediaItem) => openFileCardForAttachment(card, item)}
      />
    );
  }

  const openUserProfileModal = useCallback(() => {
    setUserAccountMenuOpen(false);
    setUserProfileModalOpen(true);
  }, []);

  const openNoteSettingsModal = useCallback(() => {
    setUserAccountMenuOpen(false);
    setUserAppleNotesImportOpen(false);
    setUserFlomoImportOpen(false);
    setUserEvernoteImportOpen(false);
    setUserYuqueImportOpen(false);
    setUserNoteSettingsOpen(true);
  }, []);

  const openAppleNotesImportModal = useCallback(() => {
    setUserNoteSettingsOpen(false);
    setUserFlomoImportOpen(false);
    setUserEvernoteImportOpen(false);
    setUserYuqueImportOpen(false);
    setUserAppleNotesImportOpen(true);
  }, []);

  const openFlomoImportModal = useCallback(() => {
    setUserNoteSettingsOpen(false);
    setUserAppleNotesImportOpen(false);
    setUserEvernoteImportOpen(false);
    setUserYuqueImportOpen(false);
    setUserFlomoImportOpen(true);
  }, []);

  const openEvernoteImportModal = useCallback(() => {
    setUserNoteSettingsOpen(false);
    setUserAppleNotesImportOpen(false);
    setUserFlomoImportOpen(false);
    setUserYuqueImportOpen(false);
    setUserEvernoteImportOpen(true);
  }, []);

  const openYuqueImportModal = useCallback(() => {
    setUserNoteSettingsOpen(false);
    setUserAppleNotesImportOpen(false);
    setUserFlomoImportOpen(false);
    setUserEvernoteImportOpen(false);
    setUserYuqueImportOpen(true);
  }, []);

  const openDataStatsModal = useCallback(() => {
    setUserAccountMenuOpen(false);
    setUserDataStatsOpen(true);
  }, []);

  const logoutFromAccountMenu = useCallback(() => {
    setUserAccountMenuOpen(false);
    logout();
  }, [logout]);

  const userAccountMenuDropdownEl = useMemo(() => {
    if (
      !userAccountMenuOpen ||
      !writeRequiresLogin ||
      !currentUser
    ) {
      return null;
    }
    return (
      <UserAccountMenuDropdown
        dataMode={dataMode}
        profileBusy={profileSaveBusy}
        isAdmin={isAdmin}
        onOpenProfile={openUserProfileModal}
        onOpenNoteSettings={openNoteSettingsModal}
        onOpenDataStats={openDataStatsModal}
        onOpenUserAdmin={() => {
          setUserAccountMenuOpen(false);
          userAdmin.setUserAdminOpen(true);
        }}
        onLogout={logoutFromAccountMenu}
      />
    );
  }, [
    userAccountMenuOpen,
    writeRequiresLogin,
    currentUser,
    dataMode,
    profileSaveBusy,
    isAdmin,
    openUserProfileModal,
    openNoteSettingsModal,
    openDataStatsModal,
    userAdmin,
    logoutFromAccountMenu,
    appUiLang,
  ]);

  if (!authReady) {
    return (
      <div className="app app--boot" aria-busy="true">
        <div className="app-boot-screen">
          <span className="app-boot-spinner" aria-hidden />
          <p>{c.loading}</p>
        </div>
      </div>
    );
  }

  /** 未登录：渲染粉色 Landing，点 CTA 才唤起 AuthProvider 里的登录模态 */
  if (loginWallBlocking) {
    return <LandingPage onStart={openLogin} />;
  }

  return (
    <div
      className={
        "app" +
        (showMobileSidebarBrowseChrome ? " app--mobile-nav-open" : "") +
        (tabletSplitNav ? " app--tablet-split-nav" : "") +
        (timelineColumnCount > 1 ? " app--masonry" : "") +
        (connectionsViewActive ? " app--connections-board" : "") +
        (railExpanded ? " app--rail-expanded" : "") +
        (railKey === "overview" ? " app--overview" : "") +
        (userNotePrefs.bgGradient === false ? " app--plain-bg" : "")
      }
    >
      {showRemoteLoading ? (
        <div
          className="app-remote-loading-overlay"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="app-remote-loading-inner">
            <span className="app-remote-loading-spinner" aria-hidden />
            <p>{c.loadingRemote}</p>
          </div>
        </div>
      ) : null}
      {remoteBootSyncing && remoteLoaded && dataMode === "remote" ? (
        <div
          className="app-remote-sync-banner"
          role="status"
          aria-live="polite"
        >
          {c.syncing}
        </div>
      ) : null}
      <div
        className="app__mobile-backdrop"
        aria-hidden
        onClick={() => setMobileNavOpen(false)}
      />
      <SidebarRail
        activeKey={railKey}
        onPick={handleRailPick}
        availability={railAvailability}
        expanded={railExpanded}
        onToggleExpanded={handleToggleRailExpanded}
        counts={railCounts}
        userSlot={
          <RailWorkspaceIdentity
            writeRequiresLogin={writeRequiresLogin}
            currentUser={currentUser}
            avatarBusy={profileSaveBusy}
            menuWrapRef={userAccountMenuRef}
            onAvatarClick={() => setUserAccountMenuOpen((o) => !o)}
            menuOpen={userAccountMenuOpen}
            menuDropdown={userAccountMenuDropdownEl}
            expanded={railExpanded}
          />
        }
      />
      <aside
        className="sidebar"
        id="app-mobile-sidebar"
        onTouchStart={onMobileSidebarTouchStart}
        onTouchEnd={onMobileSidebarTouchEnd}
        onTouchCancel={onMobileSidebarTouchCancel}
      >
        <div className="sidebar__mobile-browse-bar">
          {showMobileSidebarBrowseChrome ? (
            <div className="sidebar__mobile-browse-user">
              <SidebarWorkspaceIdentity
                writeRequiresLogin={writeRequiresLogin}
                currentUser={currentUser}
                avatarBusy={profileSaveBusy}
                menuWrapRef={userAccountMenuRef}
                onAvatarClick={() =>
                  setUserAccountMenuOpen((o) => !o)
                }
                menuOpen={userAccountMenuOpen}
                menuDropdown={userAccountMenuDropdownEl}
              />
              {dataMode === "remote" && !currentUser && !getAdminToken() ? (
                <button
                  type="button"
                  className="sidebar__admin-icon-btn sidebar__admin-icon-btn--mobile-browse"
                  onClick={() => openLogin()}
                  aria-label={c.login}
                  title={c.loginTitle}
                >
                  <AdminHeaderIcon mode="login" />
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="sidebar__mobile-browse-actions">
            {canEdit ? (
              <>
                <button
                  type="button"
                  className={
                    "sidebar__mobile-browse-action" +
                    (mobileBrowseEditMode
                      ? " sidebar__mobile-browse-action--on"
                      : "")
                  }
                  aria-pressed={mobileBrowseEditMode}
                  aria-label={
                    mobileBrowseEditMode
                      ? c.doneEditStructure
                      : c.editStructure
                  }
                  onClick={() =>
                    setMobileBrowseEditMode((v) => !v)
                  }
                >
                  {mobileBrowseEditMode ? c.done : c.edit}
                </button>
                <button
                  type="button"
                  className="sidebar__mobile-browse-action sidebar__mobile-browse-action--emph sidebar__mobile-browse-action--icon"
                  aria-label={c.newCollectionAria}
                  title={c.newCollection}
                  onClick={() => addCollection()}
                >
                  <svg
                    className="sidebar__mobile-browse-action__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="sidebar__header">
          <div className="sidebar__header-row">
            <div className="sidebar__header-actions">
              {dataMode === "remote" && !currentUser && !getAdminToken() ? (
                <button
                  type="button"
                  className="sidebar__admin-icon-btn"
                  onClick={() => openLogin()}
                  aria-label={c.login}
                  title={c.loginTitle}
                >
                  <AdminHeaderIcon mode="login" />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="sidebar__mobile-close"
              aria-label={c.closeMenu}
              onClick={() => setMobileNavOpen(false)}
            >
              <span aria-hidden>×</span>
            </button>
          </div>
          {sidebarFlash ? (
            <p className="sidebar__flash" role="status">
              {sidebarFlash}
            </p>
          ) : null}
        </div>

        {/* 「卡片探索」模块暂时隐藏；保留事件与状态不删，方便后续再开 */}

        {railKey === "overview" ? (
          <SidebarOverviewPanel
            onPick={handleRailPick}
            favoriteCollections={favoriteCollectionsForOverview}
            recentCollections={recentCollectionsForOverview}
          />
        ) : null}

        {railKey === "calendar" ? (
        <div
          className={
            "sidebar__calendar-section" +
            (allReminderEntries.length === 0 &&
            sidebarSectionCollapsed.calendar
              ? " sidebar__calendar-section--below-rule-desktop"
              : "")
          }
        >
          <div className="sidebar__section-row sidebar__section-row--collapsible sidebar__calendar-head">
            <button
              type="button"
              className="sidebar__section-hit"
              onClick={() => toggleSidebarSection("calendar")}
              aria-expanded={!sidebarSectionCollapsed.calendar}
              aria-label={sidebarSectionToggleAria("calendar", c.browseByDate)}
            >
              <span
                className={
                  "sidebar__chevron" +
                  (!sidebarSectionCollapsed.calendar ? " is-expanded" : "")
                }
                aria-hidden
              >
                <span className="sidebar__chevron-icon">›</span>
              </span>
              <span className="sidebar__section">{c.browseByDate}</span>
            </button>
          </div>
          {!sidebarSectionCollapsed.calendar ? (
            <div
              className={
                "sidebar__calendar" +
                (allReminderEntries.length === 0
                  ? " sidebar__calendar--below-rule-desktop"
                  : "")
              }
              aria-label={c.browseByDate}
            >
              <CalendarBrowsePanel
                calendarViewMonth={calendarViewMonth}
                setCalendarViewMonth={setCalendarViewMonth}
                calendarCells={calendarCells}
                calendarDay={calendarDay}
                datesWithNotesSet={datesWithNotesOnCalendarSet}
                datesWithRemindersSet={datesWithRemindersOnCalendarSet}
                onDayClick={onPickCalendarDay}
              />
            </div>
          ) : null}
        </div>
        ) : null}

        {railKey === "notes" ? (
        <div className="sidebar__notes-section sidebar__notes-section--expanded">
          <div className="sidebar__notes-section-main">
            <div className="sidebar__collections">
              <div
                className="sidebar__file-subtypes sidebar__file-subtypes--notes-scroll"
                role="list"
                aria-label={`${c.sidebarNotesSection} · ${c.sidebarNav}`}
              >
                <NotesSidebarPlainCollectionsList
                    collections={collectionsForNotesSidebar}
                    activeId={active?.id}
                    searchActive={searchActive}
                    calendarDay={calendarDay}
                    trashViewActive={trashViewActive}
                    allNotesViewActive={allNotesViewActive}
                    connectionsViewActive={connectionsViewActive}
                    attachmentsViewActive={attachmentsViewActive}
                    remindersViewActive={remindersViewActive}
                    collapsedFolderIds={collapsedFolderIds}
                    dropIndicator={dropIndicator}
                    draggingCollectionId={draggingCollectionId}
                    noteCardDropCollectionId={noteCardDropCollectionId}
                    canEdit={canEdit}
                    editingCollectionId={editingCollectionId}
                    mobileCollectionDragByHandle={mobileCollectionDragByHandle}
                    hideCollectionDots={hideSidebarCollectionDots}
                    hideAddsInMobileBrowse={hideAddsInMobileBrowse}
                    draftCollectionName={draftCollectionName}
                    collectionNameInputRef={collectionNameInputRef}
                    skipCollectionBlurCommitRef={skipCollectionBlurCommitRef}
                    noteCardDragActiveRef={noteCardDragActiveRef}
                    onCollectionRowDragStart={onCollectionRowDragStart}
                    onCollectionRowDragEnd={onCollectionRowDragEnd}
                    onCollectionRowDragOver={onCollectionRowDragOver}
                    onCollectionRowDrop={onCollectionRowDrop}
                    setNoteCardDropCollectionId={setNoteCardDropCollectionId}
                    setCollectionCtxMenu={setCollectionCtxMenu}
                    toggleFolderCollapsed={toggleFolderCollapsed}
                    expandAncestorsOf={expandAncestorsOf}
                    setTrashViewActive={setTrashViewActive}
                    setAllNotesViewActive={setAllNotesViewActive}
                    setConnectionsViewActive={setConnectionsViewActive}
                    setAttachmentsViewActive={setAttachmentsViewActive}
                    setRemindersViewActive={setRemindersViewActive}
                    setCalendarDay={setCalendarDay}
                    setActiveId={setActiveId}
                    onLeaveCardPage={closeCardFullPage}
                    setMobileNavOpen={setMobileNavOpen}
                    setDraftCollectionName={setDraftCollectionName}
                    setEditingCollectionId={setEditingCollectionId}
                    onCollectionNameBlur={onCollectionNameBlur}
                    addSubCollection={addSubCollection}
                  />
                </div>
                {dataMode === "local" && canEdit && !currentUser ? (
                  <div className="sidebar__local-note-tools">
                    <button
                      type="button"
                      className="sidebar__local-note-tools-btn"
                      onClick={() => {
                        setUserAppleNotesImportOpen(false);
                        setUserFlomoImportOpen(false);
                        setUserEvernoteImportOpen(false);
                        setUserYuqueImportOpen(false);
                        setUserNoteSettingsOpen(true);
                      }}
                    >
                      {c.menuNoteSettings}
                    </button>
                    <button
                      type="button"
                      className="sidebar__local-note-tools-btn"
                      onClick={() => {
                        setUserNoteSettingsOpen(false);
                        setUserFlomoImportOpen(false);
                        setUserEvernoteImportOpen(false);
                        setUserYuqueImportOpen(false);
                        setUserAppleNotesImportOpen(true);
                      }}
                    >
                      {c.importAppleNotesFromSettings}
                    </button>
                    <button
                      type="button"
                      className="sidebar__local-note-tools-btn"
                      onClick={() => {
                        setUserNoteSettingsOpen(false);
                        setUserAppleNotesImportOpen(false);
                        setUserEvernoteImportOpen(false);
                        setUserYuqueImportOpen(false);
                        setUserFlomoImportOpen(true);
                      }}
                    >
                      {c.importFlomoFromSettings}
                    </button>
                    <button
                      type="button"
                      className="sidebar__local-note-tools-btn"
                      onClick={() => {
                        setUserNoteSettingsOpen(false);
                        setUserAppleNotesImportOpen(false);
                        setUserFlomoImportOpen(false);
                        setUserYuqueImportOpen(false);
                        setUserEvernoteImportOpen(true);
                      }}
                    >
                      {c.importEvernoteFromSettings}
                    </button>
                    <button
                      type="button"
                      className="sidebar__local-note-tools-btn"
                      onClick={() => {
                        setUserNoteSettingsOpen(false);
                        setUserAppleNotesImportOpen(false);
                        setUserFlomoImportOpen(false);
                        setUserEvernoteImportOpen(false);
                        setUserYuqueImportOpen(true);
                      }}
                    >
                      {c.importYuqueFromSettings}
                    </button>
                  </div>
                ) : null}
              {canEdit && !showMobileSidebarBrowseChrome ? (
                <button
                  type="button"
                  className="sidebar__trailing-add"
                  onClick={addCollection}
                  aria-label={c.newCollectionAria}
                >
                  + {c.newCollection}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        ) : null}

        {railKey === "archived" && archivedCol ? (
        <div className="sidebar__notes-section sidebar__notes-section--expanded">
          <div className="sidebar__notes-section-main">
            <div className="sidebar__collections">
              <div
                className="sidebar__file-subtypes sidebar__file-subtypes--notes-scroll"
                role="list"
                aria-label={c.titleArchived}
              >
                <NotesSidebarPlainCollectionsList
                    collections={collectionsForArchivedSidebar}
                    activeId={active?.id}
                    searchActive={searchActive}
                    calendarDay={calendarDay}
                    trashViewActive={trashViewActive}
                    allNotesViewActive={allNotesViewActive}
                    connectionsViewActive={connectionsViewActive}
                    attachmentsViewActive={attachmentsViewActive}
                    remindersViewActive={remindersViewActive}
                    collapsedFolderIds={collapsedFolderIds}
                    dropIndicator={dropIndicator}
                    draggingCollectionId={draggingCollectionId}
                    noteCardDropCollectionId={noteCardDropCollectionId}
                    canEdit={canEdit}
                    editingCollectionId={editingCollectionId}
                    mobileCollectionDragByHandle={mobileCollectionDragByHandle}
                    hideCollectionDots={hideSidebarCollectionDots}
                    hideAddsInMobileBrowse={hideAddsInMobileBrowse}
                    draftCollectionName={draftCollectionName}
                    collectionNameInputRef={collectionNameInputRef}
                    skipCollectionBlurCommitRef={skipCollectionBlurCommitRef}
                    noteCardDragActiveRef={noteCardDragActiveRef}
                    onCollectionRowDragStart={onCollectionRowDragStart}
                    onCollectionRowDragEnd={onCollectionRowDragEnd}
                    onCollectionRowDragOver={onCollectionRowDragOver}
                    onCollectionRowDrop={onCollectionRowDrop}
                    setNoteCardDropCollectionId={setNoteCardDropCollectionId}
                    setCollectionCtxMenu={setCollectionCtxMenu}
                    toggleFolderCollapsed={toggleFolderCollapsed}
                    expandAncestorsOf={expandAncestorsOf}
                    setTrashViewActive={setTrashViewActive}
                    setAllNotesViewActive={setAllNotesViewActive}
                    setConnectionsViewActive={setConnectionsViewActive}
                    setAttachmentsViewActive={setAttachmentsViewActive}
                    setRemindersViewActive={setRemindersViewActive}
                    setCalendarDay={setCalendarDay}
                    setActiveId={setActiveId}
                    onLeaveCardPage={closeCardFullPage}
                    setMobileNavOpen={setMobileNavOpen}
                    setDraftCollectionName={setDraftCollectionName}
                    setEditingCollectionId={setEditingCollectionId}
                    onCollectionNameBlur={onCollectionNameBlur}
                    addSubCollection={addSubCollection}
                  />
              </div>
              {canEdit && !showMobileSidebarBrowseChrome ? (
                <button
                  type="button"
                  className="sidebar__trailing-add"
                  onClick={() => void addSubCollection(archivedCol.id)}
                  aria-label={c.newCollectionAria}
                >
                  + {c.newCollection}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        ) : null}

        {railKey === "files" ? (
        <div className="sidebar__files-section sidebar__files-section--expanded">
          <div
            className="sidebar__file-subtypes"
            role="list"
            aria-label={c.sidebarFileSubtypeListAria}
          >
              {FILE_PRESET_SUBTYPE_ITEMS.map((item) => {
                const fk = presetFileSubtypeIdToAttachmentFilterKey(item.id);
                if (!fk) return null;
                const subtypeCol = findCollectionByPresetType(collections, item.id);
                /** 用户没启用该子类型时，右键菜单退到父级「文件」合集，至少图标/颜色可改 */
                const ctxTargetCol =
                  subtypeCol ??
                  findCollectionByPresetType(collections, "file");
                const label =
                  appUiLang === "en" ? item.nameEn : item.nameZh;
                const subtypeActive =
                  attachmentsViewActive &&
                  !searchActive &&
                  attachmentsFilterKey === fk;
                const subtypeCount =
                  dataMode === "remote"
                    ? (remoteAttachmentCountsByCategory[fk] ?? "–")
                    : localAttachmentCountsByCategory[fk];
                return (
                  <div
                    key={item.id}
                    className="sidebar__file-subtype-row sidebar__file-subtype-row--with-tail"
                    role="listitem"
                  >
                    <button
                      type="button"
                      className={
                        "sidebar__file-subtype-hit" +
                        (subtypeActive ? " is-active" : "")
                      }
                      onContextMenu={(e) => {
                        if (!canEdit || !ctxTargetCol) return;
                        e.preventDefault();
                        setCollectionCtxMenu({
                          x: e.clientX,
                          y: e.clientY,
                          id: ctxTargetCol.id,
                          /** 菜单里仍显示用户点的那个子类型名（图片/视频…） */
                          name: label,
                          hasChildren:
                            (ctxTargetCol.children?.length ?? 0) > 0,
                        });
                      }}
                      onClick={() => {
                        closeCardFullPage();
                        setTrashViewActive(false);
                        setCalendarDay(null);
                        setSearchQuery("");
                        setSearchBarOpen(false);
                        setAllNotesViewActive(false);
                        setRemindersViewActive(false);
                        setConnectionsViewActive(false);
                        setAttachmentsFilterKey(fk);
                        setAttachmentsViewActive(true);
                        setMobileNavOpen(false);
                      }}
                      aria-label={`${label} (${subtypeCount})`}
                    >
                      <span className="sidebar__file-subtype-body">
                        {!hideSidebarCollectionDots ? (
                          <CollectionIconGlyph
                            className="sidebar__dot"
                            shape={subtypeCol?.iconShape}
                            color={toContrastyGlyphColor(
                              (subtypeCol?.dotColor?.trim()
                                ? subtypeCol.dotColor
                                : FILE_SUBTYPE_SIDEBAR_DOT[item.id]) ??
                                "rgba(55, 53, 47, 0.35)"
                            )}
                            size={13}
                          />
                        ) : null}
                        <span className="sidebar__name">{label}</span>
                        <span className="sidebar__count">{subtypeCount}</span>
                      </span>
                    </button>
                    {canEdit ? (
                      <div className="sidebar__fixed-subtype-tail">
                        {subtypeCol ? (
                          <button
                            type="button"
                            className="sidebar__add-sub"
                            aria-label={c.uiAddSubcollectionAria}
                            title={c.uiAddSubcollectionTitle}
                            onClick={() => void addSubCollection(subtypeCol.id)}
                          >
                            +
                          </button>
                        ) : (
                          <span className="sidebar__add-sub-spacer" aria-hidden />
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </div>
        ) : null}

        {railKey === "topic" && topicNavRootCol ? (
          <div className="sidebar__topic-section sidebar__topic-section--expanded">
            {renderSidebarSubtypeRows(
              topicSubtypeCols,
              c.sidebarTopicSubtypeListAria
            )}
            {canEdit && !showMobileSidebarBrowseChrome ? (
              <button
                type="button"
                className="sidebar__trailing-add"
                onClick={() =>
                  void addSubCollection(topicNavRootCol.id, {
                    asCategory: true,
                  })
                }
                aria-label={c.newCollectionAria}
              >
                + {c.newCollection}
              </button>
            ) : null}
          </div>
        ) : null}

        {railKey === "clip" && clipParentCol ? (
          <div className="sidebar__clip-section sidebar__clip-section--expanded">
            {renderSidebarSubtypeRows(
              clipSubtypeCols,
              c.sidebarClipSubtypeListAria
            )}
            {canEdit && !showMobileSidebarBrowseChrome ? (
              <button
                type="button"
                className="sidebar__trailing-add"
                onClick={() =>
                  void addSubCollection(clipParentCol.id, {
                    asCategory: true,
                  })
                }
                aria-label={c.newCollectionAria}
              >
                + {c.newCollection}
              </button>
            ) : null}
          </div>
        ) : null}

        {railKey === "task" ? renderPresetCatalogSidebarSection("task") : null}
        {railKey === "project"
          ? renderPresetCatalogSidebarSection("project")
          : null}
        {railKey === "expense"
          ? renderPresetCatalogSidebarSection("expense")
          : null}
        {railKey === "account"
          ? renderPresetCatalogSidebarSection("account")
          : null}

        {railKey === "reminders" ? (
          <div className="sidebar__empty-hint" role="note">
            {c.railReminders}
          </div>
        ) : null}
        {railKey === "connections" ? (
          <div className="sidebar__empty-hint" role="note">
            {c.railConnections}
          </div>
        ) : null}

        {railKey === "archived" || railKey === "trash"
          ? (() => {
          /** 递归找名称为「已归档」的第一个合集（任一层级）；找不到入口仍渲染，只是禁用 */
          const archivedColRef: { value: Collection | null } = { value: null };
          walkCollections(collections, (col) => {
            if (archivedColRef.value) return;
            if (col.name === "已归档") archivedColRef.value = col;
          });
          const archivedCol = archivedColRef.value;
          const archivedCount = archivedCol
            ? countCollectionSubtreeCards(archivedCol)
            : 0;
          const archivedActive =
            !!archivedCol &&
            !trashViewActive &&
            !searchActive &&
            !remindersViewActive &&
            !calendarDay &&
            !allNotesViewActive &&
            !attachmentsViewActive &&
            !connectionsViewActive &&
            activeId === archivedCol.id;
          return (
            <div className="sidebar__tail-row">
              {railKey === "archived" ? (
              <div
                className="sidebar__trash sidebar__tail-row-item"
                aria-label={c.archivedAria}
              >
                <button
                  type="button"
                  className={
                    "sidebar__trash-hit" +
                    (archivedActive ? " is-active" : "") +
                    (archivedCol ? "" : " is-disabled")
                  }
                  disabled={!archivedCol}
                  title={
                    archivedCol
                      ? undefined
                      : "尚无命名为「已归档」的合集"
                  }
                  onClick={() => {
                    if (!archivedCol) return;
                    closeCardFullPage();
                    setTrashViewActive(false);
                    setRemindersViewActive(false);
                    setSearchQuery("");
                    setSearchBarOpen(false);
                    setCalendarDay(null);
                    setAllNotesViewActive(false);
                    setAttachmentsViewActive(false);
                    setConnectionsViewActive(false);
                    setActiveId(archivedCol.id);
                    expandAncestorsOf(archivedCol.id);
                    setMobileNavOpen(false);
                  }}
                >
                  <svg
                    className="sidebar__trash-icon"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M21 8v13H3V8" />
                    <path d="M1 3h22v5H1z" />
                    <path d="M10 12h4" />
                  </svg>
                  <span className="sidebar__trash-label">
                    {c.titleArchived}
                  </span>
                  {archivedCount > 0 ? (
                    <span className="sidebar__trash-badge">
                      {archivedCount > 99 ? "99+" : archivedCount}
                    </span>
                  ) : null}
                </button>
              </div>
              ) : null}

              {railKey === "trash" ? (
              <div
                className="sidebar__trash sidebar__tail-row-item"
                aria-label={c.trashAria}
              >
                <button
                  type="button"
                  className={
                    "sidebar__trash-hit" +
                    (trashViewActive && !searchActive ? " is-active" : "")
                  }
                  onClick={() => {
                    closeCardFullPage();
                    setTrashViewActive(true);
                    setRemindersViewActive(false);
                    setSearchQuery("");
                    setSearchBarOpen(false);
                    setCalendarDay(null);
                    setMobileNavOpen(false);
                  }}
                >
                  <svg
                    className="sidebar__trash-icon"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  <span className="sidebar__trash-label">{c.titleTrash}</span>
                  {trashEntries.length > 0 ? (
                    <span className="sidebar__trash-badge">
                      {trashEntries.length > 99 ? "99+" : trashEntries.length}
                    </span>
                  ) : null}
                </button>
              </div>
              ) : null}
            </div>
          );
        })()
          : null}
      </aside>

      <main
        className={
          "main" +
          (connectionsViewActive ? " main--connections-board" : "") +
          (remindersViewActive ? " main--reminders" : "") +
          (cardPageCard ? " main--card-page" : "")
        }
        onClick={onMobileMainSurfaceTapToTop}
        onTouchStart={onMobileMainTouchStart}
        onTouchEnd={onMobileMainTouchEnd}
        onTouchCancel={onMobileMainTouchCancel}
      >
        <header
          ref={mainHeaderRef}
          className="main__header"
          id="app-main-header"
          /** 概览 dashboard 自带 hero（brand-strip + 大标题 + 日期），
           *  隐藏外层 main__header 避免页面顶部出现重复的"概览 ⭐"+欢迎条 */
          hidden={!!cardPageCard || railKey === "overview"}
        >
          <div
            className={
              "main__header-row" +
              (searchExpanded ? " main__header-row--search-open" : "")
            }
            onClick={onMobileHeaderRowTapToTop}
          >
            <button
              type="button"
              className="main__mobile-back"
              aria-label={c.backToList}
              onClick={() => {
                setSearchBarOpen(false);
                setSearchQuery("");
                setCalendarDay(null);
                setTrashViewActive(false);
                setAllNotesViewActive(false);
                setConnectionsViewActive(false);
                setAttachmentsViewActive(false);
                setRemindersViewActive(false);
                setMobileNavOpen(true);
              }}
            >
              <svg
                className="main__mobile-back-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
                />
              </svg>
            </button>
            {searchExpanded ? (
              <div
                className="main__search main__search--expanded main__search--row-slot"
                role="search"
              >
                <input
                  ref={mainSearchInputRef}
                  id="app-main-search"
                  type="search"
                  className="main__search-input"
                  placeholder={c.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSearchQuery("");
                      setSearchBarOpen(false);
                    }
                  }}
                  autoComplete="off"
                  aria-label={c.searchAria}
                />
                <button
                  type="button"
                  className="main__search-clear"
                  aria-label={
                    searchActive ? c.searchClear : c.searchCollapse
                  }
                  onClick={() => {
                    if (searchActive) setSearchQuery("");
                    else setSearchBarOpen(false);
                  }}
                >
                  ×
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="main__nav-toggle"
              aria-label={mobileNavOpen ? c.closeMenu : c.openMenu}
              aria-expanded={mobileNavOpen}
              aria-controls="app-mobile-sidebar"
              onClick={() => setMobileNavOpen((o) => !o)}
            >
              <svg
                className="main__nav-toggle-icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"
                />
              </svg>
            </button>
            <div className="main__heading-wrap">
              <h1
                className={
                  "main__heading" +
                  (attachmentsViewActive ||
                  (mainHeadingCollectionPath &&
                    mainHeadingCollectionPath.length > 1)
                    ? " main__heading--breadcrumb"
                    : "")
                }
              >
                {searchActive
                  ? c.titleSearch
                  : trashViewActive
                    ? c.titleTrash
                    : allNotesViewActive
                      ? c.titleAllNotes
                      : connectionsViewActive
                        ? c.titleConnections
                        : attachmentsViewActive
                          ? (
                              <nav
                                className="main__heading-bc-nav"
                                aria-label={c.allAttachmentsFiltersAria}
                              >
                                <ol className="main__heading-bc-list">
                                  {attachmentsFilterKey === "all" ? (
                                    <li className="main__heading-bc-item">
                                      <span
                                        className="main__heading-bc-current"
                                        aria-current="page"
                                      >
                                        {c.titleAllAttachments}
                                      </span>
                                    </li>
                                  ) : (
                                    <>
                                      <li className="main__heading-bc-item">
                                        <button
                                          type="button"
                                          className="main__heading-bc-link"
                                          onClick={() =>
                                            setAttachmentsFilterKey("all")
                                          }
                                        >
                                          {c.titleAllAttachments}
                                        </button>
                                      </li>
                                      <li className="main__heading-bc-item">
                                        <span
                                          className="main__heading-bc-current"
                                          aria-current="page"
                                        >
                                          {attachmentFilterCrumbLabel(
                                            attachmentsFilterKey,
                                            c
                                          )}
                                        </span>
                                      </li>
                                    </>
                                  )}
                                </ol>
                              </nav>
                            )
                          : remindersViewActive
                          ? c.titleReminders
                          : calendarDay
                            ? formatCalendarDayTitle(calendarDay, appUiLang)
                            : railKey === "overview"
                              ? c.railOverview
                            : mainHeadingCollectionPath &&
                                mainHeadingCollectionPath.length > 1
                              ? (
                                  <nav
                                    className="main__heading-bc-nav"
                                    aria-label={c.collectionPathBreadcrumbAria}
                                  >
                                    <ol className="main__heading-bc-list">
                                      {mainHeadingCollectionPath.map(
                                        (seg, i, arr) => (
                                          <li
                                            key={seg.id}
                                            className="main__heading-bc-item"
                                          >
                                            {i < arr.length - 1 ? (
                                              <button
                                                type="button"
                                                className="main__heading-bc-link"
                                                onClick={() => {
                                                  setActiveId(seg.id);
                                                  setMobileNavOpen(false);
                                                }}
                                              >
                                                {seg.name}
                                              </button>
                                            ) : (
                                              <span
                                                className="main__heading-bc-current"
                                                aria-current="page"
                                              >
                                                {seg.name}
                                              </span>
                                            )}
                                          </li>
                                        )
                                      )}
                                    </ol>
                                  </nav>
                                )
                              : active?.name ?? c.titleNoCollection}
              </h1>
              {active &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive &&
              !allNotesViewActive &&
              !connectionsViewActive &&
              !attachmentsViewActive &&
              !remindersViewActive ? (
                <button
                  type="button"
                  className={
                    "main__heading-fav" +
                    (favoriteCollectionIds.has(active.id)
                      ? " is-on"
                      : "")
                  }
                  aria-label={
                    favoriteCollectionIds.has(active.id)
                      ? c.unfavoriteThis
                      : c.favoriteThis
                  }
                  aria-pressed={favoriteCollectionIds.has(active.id)}
                  title={
                    favoriteCollectionIds.has(active.id)
                      ? c.unfavoriteShort
                      : c.favoriteShort
                  }
                  onClick={() => toggleFavoriteCollection(active.id)}
                >
                  <CollectionStarIcon
                    filled={favoriteCollectionIds.has(active.id)}
                    className="main__heading-fav__svg"
                  />
                </button>
              ) : null}
            </div>
            <div className="main__header-actions">
              {!searchExpanded ? (
                <button
                  type="button"
                  className="main__header-icon-btn"
                  aria-label={c.openSearchAria}
                  onClick={() => setSearchBarOpen(true)}
                >
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </button>
              ) : null}
              {attachmentsViewActive ? (
                <button
                  type="button"
                  className={
                    "main__header-icon-btn" +
                    (attachmentsPreviewLayout === "square"
                      ? " main__header-icon-btn--active"
                      : "")
                  }
                  aria-label={
                    attachmentsPreviewLayout === "square"
                      ? c.allAttachmentsPreviewToggleToOriginalAria
                      : c.allAttachmentsPreviewToggleToSquareAria
                  }
                  aria-pressed={attachmentsPreviewLayout === "square"}
                  title={
                    attachmentsPreviewLayout === "square"
                      ? c.allAttachmentsPreviewToggleToOriginalTitle
                      : c.allAttachmentsPreviewToggleToSquareTitle
                  }
                  onClick={() => {
                    setAttachmentsPreviewLayout((cur) => {
                      const next = cur === "square" ? "contain" : "square";
                      writeAttachmentsPreviewLayout(next);
                      return next;
                    });
                  }}
                >
                  {attachmentsPreviewLayout === "square" ? (
                    <svg
                      className="main__header-icon-btn__svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <rect x="3" y="8" width="18" height="8" rx="1.5" />
                    </svg>
                  ) : (
                    <svg
                      className="main__header-icon-btn__svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <rect x="5" y="5" width="14" height="14" rx="1.5" />
                    </svg>
                  )}
                </button>
              ) : null}
              {!remindersViewActive && !attachmentsViewActive ? (
                columnStepList.length === 2 ? (
                  <button
                    type="button"
                    className="main__header-icon-btn main__header-column-binary-masonry"
                    aria-label={
                      timelineColumnCount === 1
                        ? c.masonryColumnBinaryTapFor2
                        : c.masonryColumnBinaryTapFor1
                    }
                    title={
                      timelineColumnCount === 1
                        ? c.masonryColumnBinaryTapFor2
                        : c.masonryColumnBinaryTapFor1
                    }
                    aria-pressed={timelineColumnCount === 2}
                    onClick={toggleBinaryTimelineColumns}
                  >
                    {timelineColumnCount === 1 ? (
                      <IconTimelineMasonry1Col className="main__header-icon-btn__svg" />
                    ) : (
                      <IconTimelineMasonry2Col className="main__header-icon-btn__svg" />
                    )}
                  </button>
                ) : (
                  <div
                    className="main__header-column-stepper"
                    role="group"
                    aria-label={c.masonryColumnsGroupAria}
                  >
                    <button
                      type="button"
                      className="main__header-column-stepper__btn"
                      aria-label={c.masonryColumnIncAria}
                      title={c.masonryColumnIncAria}
                      disabled={
                        columnStepIndex >= columnStepList.length - 1
                      }
                      onClick={stepColumnPrefUp}
                    >
                      <svg
                        className="main__header-column-stepper__chev"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                    </button>
                    <span
                      className="main__header-column-stepper__value"
                      title={
                        timelineColumnCount === 1
                          ? c.masonryCol1Title
                          : c.masonryColFixedTitle.replace(
                              "{n}",
                              String(timelineColumnCount)
                            )
                      }
                      aria-live="polite"
                    >
                      {String(timelineColumnCount)}
                    </span>
                    <button
                      type="button"
                      className="main__header-column-stepper__btn"
                      aria-label={c.masonryColumnDecAria}
                      title={c.masonryColumnDecAria}
                      disabled={columnStepIndex <= 0}
                      onClick={stepColumnPrefDown}
                    >
                      <svg
                        className="main__header-column-stepper__chev"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                )
              ) : null}
              {canEdit &&
              trashViewActive &&
              !searchActive &&
              trashEntries.length > 0 ? (
                <button
                  type="button"
                  className="main__header-icon-btn main__header-icon-btn--danger-text"
                  aria-label={c.emptyTrashAria}
                  title={c.emptyTrashTitle}
                  onClick={emptyTrash}
                >
                  <span className="main__header-trash-empty-label">
                    {c.clearTrashLabel}
                  </span>
                </button>
              ) : null}
              {canEdit &&
              (active || allNotesViewActive || remindersViewActive) &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive &&
              !connectionsViewActive &&
              !attachmentsViewActive ? (
                <button
                  type="button"
                  className="main__header-icon-btn"
                  aria-label={
                    remindersViewActive
                      ? c.newReminderTaskAria
                      : c.newNoteAria
                  }
                  onClick={() =>
                    remindersViewActive ? openNewTaskReminderPicker() : addSmallNote()
                  }
                >
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
          {(loadError || saveError) && (
            <div className="main__banners">
              {loadError ? (
                <p className="main__banner main__banner--warn" role="status">
                  {loadError}
                </p>
              ) : null}
              {saveError ? (
                <p className="main__banner main__banner--err" role="alert">
                  {saveError}
                </p>
              ) : null}
            </div>
          )}
          {active &&
          !calendarDay &&
          !searchActive &&
          !trashViewActive &&
          !remindersViewActive &&
          !allNotesViewActive &&
          !connectionsViewActive &&
          !attachmentsViewActive && (
            <div className="main__hint-wrap">
              {editingHintCollectionId === active.id ? (
                <textarea
                  ref={collectionHintTextareaRef}
                  className="main__hint-editor"
                  rows={1}
                  value={draftCollectionHint}
                  aria-label={c.collectionHintAria}
                  onChange={(e) =>
                    setDraftCollectionHint(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      skipHintBlurCommitRef.current = true;
                      setEditingHintCollectionId(null);
                    }
                  }}
                  onBlur={onCollectionHintBlur}
                />
              ) : (
                <p
                  className="main__hint"
                  title={
                    (active.hint?.trim()
                      ? active.hint!
                      : c.defaultCollectionHint) +
                    (canEdit ? c.hintSuffixEdit : "")
                  }
                  onDoubleClick={
                    canEdit
                      ? () => {
                          const raw = active.hint?.trim();
                          setDraftCollectionHint(
                            raw
                              ? active.hint!
                              : c.defaultCollectionHint
                          );
                          setEditingHintCollectionId(active.id);
                        }
                      : undefined
                  }
                >
                  {active.hint?.trim()
                    ? active.hint
                    : c.defaultCollectionHint}
                </p>
              )}
            </div>
          )}
        </header>

        {cardPageCardLive ? (
          <Suspense fallback={null}>
            <CardPageView
              card={cardPageCardLive.card}
              colId={cardPageCardLive.colId}
              collections={collections}
              canEdit={canEdit}
              canAttachMedia={canAttachMedia}
              onClose={() => setCardPageCard(null)}
              setCardText={setCardText}
              setCardTags={setCardTags}
              setCardCustomProps={setCardCustomProps}
              setReminderPicker={setReminderPicker}
              setRelatedPanel={setRelatedPanel}
              uploadFilesToCard={uploadFilesToCard}
              removeCardMediaItem={removeCardMediaItem}
              setCardMediaCoverItem={setCardMediaCoverItem}
              onRemoveCardFromCollection={(placementColId) =>
                void removeCardFromCollectionPlacementAt(
                  placementColId,
                  cardPageCardLive.card.id
                )
              }
              hideCollectionDots={hideSidebarCollectionDots}
              onAddCardPlacement={(targetColId) =>
                void executeAddCardPlacement(
                  cardPageCardLive.colId,
                  cardPageCardLive.card.id,
                  targetColId
                )
              }
              onCreateFileCardFromAttachment={
                dataMode === "remote" &&
                (cardPageCardLive.card.objectKind ?? "note") === "note"
                  ? (item) => {
                      void createFileCardFromNoteAttachment(
                        cardPageCardLive.colId,
                        cardPageCardLive.card.id,
                        item
                      );
                    }
                  : undefined
              }
              attachmentHasLinkedFileCard={(item) =>
                noteHasLinkedFileCardForMedia(
                  cardPageCardLive.card,
                  item,
                  collections
                )
              }
              onOpenFileCard={(item) =>
                openFileCardForAttachment(cardPageCardLive.card, item)
              }
              onOpenLinkedCard={(targetColId, targetCardId) =>
                setCardPageCard({ colId: targetColId, cardId: targetCardId })
              }
              onCreateLinkedCard={createLinkedCardFromProperty}
              onAfterRemoteAutoLink={
                dataMode === "remote" && canEdit
                  ? async () => {
                      await resyncRemoteCollectionsTree({
                        skipPreferenceRefresh: true,
                      });
                    }
                  : undefined
              }
              onDeleteCard={
                canEdit
                  ? () => {
                      deleteCard(
                        cardPageCardLive.colId,
                        cardPageCardLive.card.id
                      );
                      setCardPageCard(null);
                    }
                  : undefined
              }
            />
          </Suspense>
        ) : cardPageCard ? (
          <div
            className="card-page card-page--loading"
            role="status"
            aria-busy="true"
          >
            <div className="card-page__header">
              <button
                type="button"
                className="card-page__back"
                onClick={() => setCardPageCard(null)}
                aria-label={c.uiBack}
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
              <span className="card-page__time" aria-hidden="true" />
            </div>
            <div className="card-page__loading-body">
              <span className="app-boot-spinner" aria-hidden="true" />
            </div>
          </div>
        ) : null}

        <div
          ref={timelineRef}
          className="timeline"
          role="feed"
          hidden={!!cardPageCard}
          aria-label={
            searchActive
              ? c.resultsTitle
              : trashViewActive
                ? c.titleTrash
                : remindersViewActive
                    ? c.titleReminders
                    : c.timelineBrand
          }
        >
          {ptrEnabled ? (
            <div
              className={
                "timeline__ptr" +
                (timelinePtrRefreshing ? " timeline__ptr--busy" : "")
              }
              style={{
                height: timelinePtrRefreshing
                  ? 44
                  : Math.round(timelinePullOffset),
              }}
              aria-live="polite"
              aria-busy={timelinePtrRefreshing || undefined}
            >
              <span className="timeline__ptr-label">
                {timelinePtrRefreshing
                  ? c.pullRefreshRunning
                  : timelinePullOffset >= 42
                    ? c.pullRefreshRelease
                    : c.pullRefreshGuide}
              </span>
            </div>
          ) : null}
          {searchActive ? (
            !searchHasResults ? (
              <div className="timeline__empty">
                {c.searchNoHit(searchTrim)}
              </div>
            ) : (
              <>
                {searchCollectionMatches.length > 0 ? (
                  <section
                    className="search-section"
                    aria-label={c.matchCollectionsAria}
                  >
                    <h2 className="timeline__pin-heading">
                      {c.headingCollections}
                    </h2>
                    <ul className="search-col-list">
                      {searchCollectionMatches.map(({ col, path }) => (
                        <li key={col.id} className="search-col-list__item">
                          <span className="search-col-list__path">
                            {path}
                          </span>
                          <button
                            type="button"
                            className="search-col-list__open"
                            onClick={() => {
                              setTrashViewActive(false);
                              setRemindersViewActive(false);
                              setActiveId(col.id);
                              setCalendarDay(null);
                              setSearchQuery("");
                              setSearchBarOpen(false);
                            }}
                          >
                            {c.openBtn}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {searchCollectionMatches.length > 0 &&
                searchGroupedCards.length > 0 ? (
                  <div
                    className="timeline__pin-divider"
                    role="separator"
                    aria-hidden
                  />
                ) : null}
                {searchGroupedCards.length > 0 ? (
                  <section
                    className="search-section"
                    aria-label={c.matchNotesAria}
                  >
                    <h2 className="timeline__pin-heading">{c.headingNotes}</h2>
                    {searchGroupedCardsDisplayed.map(({ col, path, cards }) => (
                      <div
                        key={col.id}
                        className="search-card-group"
                      >
                        <div className="search-card-group__head">
                          <span className="search-card-group__path">
                            {path}
                          </span>
                          <button
                            type="button"
                            className="search-card-group__open"
                            onClick={() => {
                              setTrashViewActive(false);
                              setRemindersViewActive(false);
                              setActiveId(col.id);
                              setCalendarDay(null);
                              setSearchQuery("");
                              setSearchBarOpen(false);
                            }}
                          >
                            {c.openCollectionBtn}
                          </button>
                        </div>
                        <MasonryShortestColumns
                          columnCount={timelineColumnCount}
                        >
                          {cards.map((card) =>
                            renderNoteTimelineCard(card, col.id)
                          )}
                        </MasonryShortestColumns>
                      </div>
                    ))}
                    {searchGroupedCardsVisibleCount <
                    searchCardsFlat.length ? (
                      <div
                        ref={searchNotesSentinelRef}
                        className="timeline__all-notes-sentinel"
                        aria-hidden
                      />
                    ) : null}
                  </section>
                ) : null}
              </>
            )
          ) : trashViewActive ? (
            trashEntries.length === 0 ? (
              <div className="timeline__empty trash-empty">
                {canEdit ? c.trashEmptyRich : c.trashEmptyPlain}
              </div>
            ) : (
              <MasonryShortestColumns
                columnCount={timelineColumnCount}
                ariaLabel={c.deletedNotesAria}
              >
                {trashEntries.map((entry) => (
                  <TrashNoteCardRow
                    key={entry.trashId}
                    entry={entry}
                    canEdit={canEdit}
                    cardMenuId={cardMenuId}
                    setCardMenuId={setCardMenuId}
                    restoreTrashedEntry={restoreTrashedEntry}
                    purgeTrashedEntry={purgeTrashedEntry}
                    timelineColumnCount={timelineColumnCount}
                    timelineGalleryOnRight={
                      userNotePrefs.timelineGalleryOnRight !== false
                    }
                  />
                ))}
              </MasonryShortestColumns>
            )
          ) : allNotesViewActive ? (
            allNotesSorted.length === 0 ? (
              <div className="timeline__empty">{c.emptyGlobal}</div>
            ) : (
              <>
                <MasonryShortestColumns columnCount={timelineColumnCount}>
                  {allNotesDisplayed.map(({ col, card }) =>
                    renderNoteTimelineCard(card, col.id)
                  )}
                </MasonryShortestColumns>
                {allNotesVisibleCount < allNotesSorted.length ? (
                  <div
                    ref={allNotesLoadMoreSentinelRef}
                    className="timeline__all-notes-sentinel"
                    aria-hidden
                  />
                ) : null}
              </>
            )
          ) : connectionsViewActive ? (
            <Suspense
              fallback={
                <div
                  className="connections-page connections-page--empty"
                  role="status"
                  aria-live="polite"
                >
                  <p className="timeline__empty">{c.loading}</p>
                </div>
              }
            >
              <NoteConnectionsView
                edges={connectionEdges}
                canEdit={canEdit}
                onLinkCards={addRelatedPair}
                onSaveAiAnswer={saveAiAnswerToRelatedNote}
                askAiGate={
                  !currentUser
                    ? "login"
                    : dataMode !== "remote"
                      ? "remote"
                      : "ok"
                }
                onOpenTarget={(colId, cardId) => {
                  const hit = findCardInTree(collections, colId, cardId);
                  if (!hit) return;
                  if (isFileCard(hit.card)) {
                    setDetailCard(null);
                    setCardPageCard({
                      colId: hit.col.id,
                      cardId: hit.card.id,
                    });
                  } else {
                    setDetailCard({ card: hit.card, colId: hit.col.id });
                  }
                }}
              />
              {connectionEdgesTruncated ? (
                <div className="connections-page__load-more-wrap">
                  <button
                    type="button"
                    className="all-attachments-page__pagination-btn"
                    onClick={() =>
                      setConnectionsEdgeLimit((n) => n + CONNECTIONS_EDGE_BATCH)
                    }
                  >
                    加载更多关联卡片
                  </button>
                </div>
              ) : null}
            </Suspense>
          ) : attachmentsViewActive ? (
            <Suspense
              fallback={
                <div
                  className={
                    "all-attachments-page" +
                    (attachmentsPreviewLayout === "square"
                      ? " all-attachments-page--preview-square"
                      : "")
                  }
                >
                  <ul
                    className="all-attachments-page__grid all-attachments-page__grid--skeleton"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    aria-label={c.loading}
                  >
                    {Array.from({ length: 12 }).map((_, i) => (
                      <li
                        key={i}
                        className={
                          "all-attachments-page__skeleton-cell" +
                          (attachmentsPreviewLayout === "square"
                            ? " all-attachments-page__skeleton-cell--square"
                            : "")
                        }
                      >
                        <div className="all-attachments-page__skeleton-preview" />
                        <div className="all-attachments-page__skeleton-info">
                          <div className="all-attachments-page__skeleton-line all-attachments-page__skeleton-line--name" />
                          <div className="all-attachments-page__skeleton-line all-attachments-page__skeleton-line--meta" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            >
              <AllFilesView
                dataMode={dataMode}
                entries={allMediaAttachmentEntries}
                filterKey={attachmentsFilterKey}
                previewLayout={attachmentsPreviewLayout}
                remoteListCacheUserKey={currentUser?.id?.trim() || "anon"}
                remoteListRefreshNonce={attachmentsRemoteListNonce}
                onRemoteListInvalidate={notifyRemoteAttachmentsChanged}
                onOpenCard={openFileFromAllFilesView}
                onDeleteFile={
                  canEdit ? deleteFileCardFromAllFilesView : undefined
                }
              />
            </Suspense>
          ) : remindersViewActive ? (
            <Suspense
              fallback={
                <div
                  className="connections-page connections-page--empty"
                  role="status"
                  aria-live="polite"
                >
                  <p className="timeline__empty">{c.loading}</p>
                </div>
              }
            >
              <AllRemindersView
                entries={allReminderEntries}
                canEdit={canEdit}
                onOpenCard={(colId, card) => {
                  const hit = findCardInTree(collections, colId, card.id);
                  if (hit) {
                    setDetailCard({ card: hit.card, colId });
                  }
                }}
                onCompleteTask={
                  canEdit ? completeReminderTask : undefined
                }
              />
            </Suspense>
          ) : calendarDay ? (
            dayReminderEntries.length === 0 &&
            dayPinned.length === 0 &&
            dayRestCards.length === 0 ? (
              <div className="timeline__empty">
                {canEdit ? c.dayEmptyReminder : c.dayEmptyPlain}
              </div>
            ) : (
              <>
                {dayReminderEntries.length > 0 && (
                  <section
                    className="timeline__pin-section timeline__reminder-section"
                    aria-label={c.dayRemindersAria}
                  >
                    <h2 className="timeline__pin-heading">
                      {c.headingReminders}
                    </h2>
                    <MasonryShortestColumns
                      columnCount={timelineColumnCount}
                    >
                      {dayReminderEntries.map(({ card }) =>
                        renderNoteTimelineCard(
                          card,
                          cardToColIdForDay.get(card.id) ?? ""
                        )
                      )}
                    </MasonryShortestColumns>
                  </section>
                )}
                {dayReminderEntries.length > 0 &&
                  (dayPinned.length > 0 || calendarRestByCol.length > 0) && (
                    <div
                      className="timeline__pin-divider"
                      role="separator"
                      aria-hidden
                    />
                  )}
                {dayPinned.length > 0 && (
                  <section
                    className="timeline__pin-section"
                    aria-label={c.dayPinnedAria}
                  >
                    <h2 className="timeline__pin-heading">{c.headingPinned}</h2>
                    <MasonryShortestColumns
                      columnCount={timelineColumnCount}
                    >
                      {dayPinned.map((card) =>
                        renderNoteTimelineCard(
                          card,
                          cardToColIdForDay.get(card.id) ?? ""
                        )
                      )}
                    </MasonryShortestColumns>
                  </section>
                )}
                {dayPinned.length > 0 && dayRestCards.length > 0 && (
                  <div
                    className="timeline__pin-divider"
                    role="separator"
                    aria-hidden
                  />
                )}
                {calendarRestFlat.length > 0 ? (
                  <MasonryShortestColumns columnCount={timelineColumnCount}>
                    {calendarRestFlat
                      .slice(0, calendarRestFlatVisibleCount)
                      .map(({ col, card }) =>
                        renderNoteTimelineCard(card, col.id)
                      )}
                  </MasonryShortestColumns>
                ) : null}
                {calendarRestFlatVisibleCount < calendarRestFlat.length ? (
                  <div
                    ref={calendarRestSentinelRef}
                    className="timeline__all-notes-sentinel"
                    aria-hidden
                  />
                ) : null}
              </>
            )
          ) : railKey === "overview" ? (
            <OverviewDashboard
              todayLabel={overviewTodayLabel}
              weekNewCount={overviewWeekNewCount}
              typeWidgets={overviewTypeWidgets}
              todayCalendar={overviewTodayCalendar}
              upcomingReminders={overviewUpcomingReminders}
              recentCollections={recentCollectionsForOverview}
              randomCard={overviewRandomCard}
              userNickname={currentUser?.displayName?.trim() ?? ""}
              audioTracks={overviewAudioTracks}
              photos={overviewPhotoItems}
              onPick={handleRailPick}
              onOpenCard={openOverviewCard}
              onRerollRandom={rerollOverviewRandom}
              i18n={{
                brandTop: c.overviewBrandTop,
                brandTopSub: c.overviewBrandTopSub,
                heroWeekNew: c.overviewHeroWeekNew,
                heroGreeting: c.overviewHeroGreeting,
                randomKicker: c.overviewRandomKicker,
                randomOpen: c.overviewRandomOpen,
                randomReroll: c.overviewRandomReroll,
                randomEmpty: c.overviewRandomEmpty,
                musicKicker: c.overviewMusicKicker,
                musicNoTracks: c.overviewMusicNoTracks,
                musicPrev: c.overviewMusicPrev,
                musicNext: c.overviewMusicNext,
                musicPlay: c.overviewMusicPlay,
                musicPause: c.overviewMusicPause,
                musicShuffle: c.overviewMusicShuffle,
                photoKicker: c.overviewPhotoKicker,
                photoEmpty: c.overviewPhotoEmpty,
                photoReroll: c.overviewPhotoReroll,
                photoPlay: c.overviewPhotoPlay,
                photoPause: c.overviewPhotoPause,
                sectionTypes: c.overviewSectionTypes,
                sectionNotifications: c.overviewSectionNotifications,
                sectionTodayCalendar: c.overviewSectionTodayCalendar,
                sectionUpcoming: c.overviewSectionUpcoming,
                sectionRecent: c.overviewSectionRecent,
                viewAll: c.overviewViewAll,
                emptyRecent: c.overviewEmptyRecent,
                emptyNotifications: c.overviewEmptyNotifications,
                emptyWidgetCards: c.overviewEmptyWidgetCards,
              }}
            />
          ) : listEmpty ? (
            <div className="timeline__empty">
              {timelineEmpty
                ? canEdit
                  ? c.emptyNewUser
                  : c.emptyCollection
                : c.emptyGlobal}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <section
                  className="timeline__pin-section"
                  aria-label={c.pinnedNotesAria}
                >
                  <h2 className="timeline__pin-heading">{c.headingPinned}</h2>
                  <MasonryShortestColumns
                    columnCount={timelineColumnCount}
                  >
                    {pinned.map((card) =>
                      renderNoteTimelineCard(card, active!.id)
                    )}
                  </MasonryShortestColumns>
                </section>
              )}
              {pinned.length > 0 && rest.length > 0 && (
                <div
                  className="timeline__pin-divider"
                  role="separator"
                  aria-hidden
                />
              )}
              <MasonryShortestColumns
                columnCount={timelineColumnCount}
              >
                {restDisplayed.map((card) =>
                  renderNoteTimelineCard(card, active!.id)
                )}
              </MasonryShortestColumns>
              {collectionRestVisibleCount < rest.length ? (
                <div
                  ref={collectionRestSentinelRef}
                  className="timeline__all-notes-sentinel"
                  aria-hidden
                />
              ) : null}
            </>
          )}
          {canEdit &&
          (active || allNotesViewActive || remindersViewActive) &&
          railKey !== "overview" &&
          !calendarDay &&
          !searchActive &&
          !trashViewActive &&
          !connectionsViewActive &&
          !attachmentsViewActive ? (
            <div className="timeline__add-bottom">
              <button
                type="button"
                className="timeline__add-bottom-btn"
                aria-label={
                  remindersViewActive
                    ? c.newReminderTaskAria
                    : c.newNoteAria
                }
                onClick={() =>
                  remindersViewActive ? openNewTaskReminderPicker() : addSmallNote()
                }
              >
                {remindersViewActive ? c.newReminderTaskPlus : c.newNotePlus}
              </button>
            </div>
          ) : null}
        </div>
      </main>
      {narrowUi &&
      active &&
      railKey !== "overview" &&
      !calendarDay &&
      !searchActive &&
      !trashViewActive &&
      !connectionsViewActive &&
      !attachmentsViewActive &&
      (!mobileNavOpen || tabletSplitNav) &&
      !mobileCalendarOpen &&
      !remindersViewActive &&
      !cardPageCard ? (
        <button
          type="button"
          className="main__scroll-to-bottom"
          aria-label={c.scrollBottomAria}
          title={c.scrollBottomTitle}
          onClick={() => scrollTimelineToBottom("smooth")}
        >
          <svg
            className="main__scroll-to-bottom__icon"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              fill="currentColor"
              d="M6 9h12L12 17 6 9z"
            />
          </svg>
        </button>
      ) : null}
      {!cardPageCard ? (
        <nav className="mobile-dock" aria-label={c.mobileDockAria}>
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--icon"
          aria-label={
            mobileCalendarOpen ? c.dockCalendarClose : c.dockCalendarOpen
          }
          aria-expanded={mobileCalendarOpen}
          onClick={() => {
            setMobileNavOpen(false);
            setMobileCalendarOpen((wasOpen) => {
              if (!wasOpen) setRemindersViewActive(false);
              return !wasOpen;
            });
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M3 10h18M8 2v4M16 2v4" />
          </svg>
        </button>
        <button
          type="button"
          className={
            "mobile-dock__btn mobile-dock__btn--icon mobile-dock__btn--reminders" +
            (remindersViewActive
              ? " mobile-dock__btn--reminders-active"
              : "")
          }
          aria-label={
            remindersViewActive ? c.dockRemindersOn : c.dockRemindersOff
          }
          title={c.remindersTitle}
          aria-expanded={remindersViewActive}
          onClick={() => {
            setMobileNavOpen(false);
            setMobileCalendarOpen(false);
            setAttachmentsViewActive(false);
            setRemindersViewActive((o) => !o);
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--fab"
          aria-label={
            calendarDay !== null
              ? c.fabBack
              : remindersViewActive
                ? c.newReminderTaskAria
                : writeRequiresLogin && !getAdminToken() && !isTauri()
                  ? c.fabLogin
                  : c.fabNewNote
          }
          title={
            calendarDay !== null
              ? c.fabTitleCalendar
              : remindersViewActive
                ? c.fabTitleNewReminderTask
                : writeRequiresLogin && !getAdminToken() && !isTauri()
                  ? c.fabTitleLogin
                  : c.fabTitleNewNote
          }
          disabled={
            calendarDay !== null
              ? false
              : writeRequiresLogin &&
                  !getAdminToken() &&
                  !isTauri()
                ? false
                : trashViewActive ||
                  searchQuery.trim().length > 0 ||
                  (!active && !allNotesViewActive && !remindersViewActive) ||
                  !canEdit ||
                  connectionsViewActive ||
                  attachmentsViewActive
          }
          onClick={() => {
            if (remindersViewActive) {
              if (writeRequiresLogin && !getAdminToken() && !isTauri()) {
                openLogin();
                return;
              }
              openNewTaskReminderPicker();
              return;
            }
            if (calendarDay !== null) {
              setCalendarDay(null);
              requestAnimationFrame(() => {
                timelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              });
              return;
            }
            if (writeRequiresLogin && !getAdminToken() && !isTauri()) {
              openLogin();
              return;
            }
            if (
              narrowUi &&
              canEdit &&
              (active || allNotesViewActive) &&
              !trashViewActive &&
              !remindersViewActive &&
              searchQuery.trim().length === 0
            ) {
              addSmallNoteThenOpenCardFullPage();
              return;
            }
            addSmallNote();
          }}
        >
          <MobileDockJarIcon className="mobile-dock__jar-svg" />
        </button>
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--icon"
          aria-label={c.searchDockAria}
          title={c.searchDockTitle}
          onClick={() => {
            setRemindersViewActive(false);
            setSearchBarOpen(true);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                timelineRef.current?.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
                if (typeof window !== "undefined") {
                  window.scrollTo({
                    top: 0,
                    left: 0,
                    behavior: "smooth",
                  });
                }
                mainHeaderRef.current?.scrollIntoView({
                  block: "start",
                  behavior: "smooth",
                });
                window.setTimeout(() => {
                  mainSearchInputRef.current?.focus({
                    preventScroll: true,
                  });
                }, 120);
              });
            });
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
        </nav>
      ) : null}
      {mobileCalendarOpen
        ? createPortal(
            <div className="mobile-cal-popup" role="presentation">
              <button
                type="button"
                className="mobile-cal-popup__backdrop"
                aria-label={c.calendarCloseAria}
                onClick={() => setMobileCalendarOpen(false)}
              />
              <div
                className="mobile-cal-popup__sheet"
                role="dialog"
                aria-modal="true"
                aria-label={c.calendarBrowseAria}
              >
                <div className="mobile-cal-popup__grab" aria-hidden />
                <div className="sidebar__calendar mobile-cal-popup__calendar">
                  <CalendarBrowsePanel
                    calendarViewMonth={calendarViewMonth}
                    setCalendarViewMonth={setCalendarViewMonth}
                    calendarCells={calendarCells}
                    calendarDay={calendarDay}
                    datesWithNotesSet={datesWithNotesOnCalendarSet}
                    datesWithRemindersSet={datesWithRemindersOnCalendarSet}
                    onDayClick={(dateStr) => {
                      onPickCalendarDay(dateStr);
                      setMobileCalendarOpen(false);
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      <input
        ref={cardMediaFileInputRef}
        type="file"
        multiple
        className="app__hidden-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={onCardMediaFileSelected}
      />
      <CollectionContextMenu
        menu={collectionCtxMenu}
        onAddSubcollection={(id) => {
          setCollectionCtxMenu(null);
          void addSubCollection(id);
        }}
        onMergeInto={(id, name) => {
          openMergeCollectionDialog(id, name);
        }}
        onMoveUnder={(id, name) => {
          openMoveUnderCollectionDialog(id, name);
        }}
        onEditTemplate={(id, name) => {
          openCollectionTemplateDialog(id, name);
        }}
        onRemove={(id, name, hasChildren) => {
          openRemoveCollectionDialog(id, name, hasChildren);
        }}
      />
      <CollectionMergeDialog
        dialog={mergeCollectionDialog}
        collections={collections}
        onClose={() => setMergeCollectionDialog(null)}
        onConfirmMerge={(sourceId, targetId) => {
          void performMergeCollection(sourceId, targetId);
        }}
      />
      <CollectionMoveUnderDialog
        dialog={moveUnderCollectionDialog}
        collections={collections}
        onClose={() => setMoveUnderCollectionDialog(null)}
        onConfirm={(sourceId, parentId) => {
          void performMoveCollectionUnder(sourceId, parentId);
        }}
      />
      <CollectionTemplateModal
        dialog={collectionTemplateDialog}
        initialFields={
          collectionTemplateDialog
            ? mergedTemplateSchemaFieldsForCollection(
                collections,
                collectionTemplateDialog.collectionId
              )
            : []
        }
        initialDotColor={
          (collectionTemplateDialog &&
            findCollectionById(
              collections,
              collectionTemplateDialog.collectionId
            )?.dotColor) ||
          ""
        }
        initialIconShape={
          collectionTemplateDialog
            ? findCollectionById(
                collections,
                collectionTemplateDialog.collectionId
              )?.iconShape ?? null
            : null
        }
        schemaReadonly={(() => {
          if (!collectionTemplateDialog) return false;
          const target = findCollectionById(
            collections,
            collectionTemplateDialog.collectionId
          );
          /** 预设子类型合集（如 文件/图片、主题/人物、任务/待办）：字段由目录写入，
           *  模态里允许改形状 / 颜色但不允许增删/改字段 */
          const pid = target?.presetTypeId?.trim() ?? "";
          return Boolean(pid) && pid !== "note";
        })()}
        onClose={() => setCollectionTemplateDialog(null)}
        onConfirm={(collectionId, patch) => {
          setCollectionTemplateDialog(null);
          void performCollectionTemplateSave(collectionId, patch);
        }}
      />
      {collectionCloudSyncProgress
        ? createPortal(
            <div
              className="auth-modal-backdrop"
              role="presentation"
              aria-busy="true"
            >
              <div
                className="auth-modal collection-merge-progress-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="collection-cloud-sync-progress-title"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="collection-cloud-sync-progress-title"
                  className="auth-modal__title"
                >
                  {collectionCloudSyncProgress.variant === "merge"
                    ? c.uiMergeCollectionProgressTitle
                    : c.uiMoveCollectionCloudProgressTitle}
                </h2>
                <p className="collection-merge-dialog__body">
                  {c.uiMergeCollectionProgressLine(
                    collectionCloudSyncProgress.current,
                    collectionCloudSyncProgress.total
                  )}
                </p>
                <div
                  className="apple-notes-import-modal__progress-wrap"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={collectionCloudSyncProgress.total}
                  aria-valuenow={collectionCloudSyncProgress.current}
                  aria-label={c.uiMergeCollectionProgressLine(
                    collectionCloudSyncProgress.current,
                    collectionCloudSyncProgress.total
                  )}
                >
                  <div className="apple-notes-import-modal__progress" aria-hidden>
                    <div
                      className="apple-notes-import-modal__progress-fill"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            (collectionCloudSyncProgress.current /
                              Math.max(1, collectionCloudSyncProgress.total)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="apple-notes-import-modal__progress-text">
                    {collectionCloudSyncProgress.current} /{" "}
                    {collectionCloudSyncProgress.total}
                  </span>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      <CollectionDeleteDialog
        dialog={collectionDeleteDialog}
        onClose={() => setCollectionDeleteDialog(null)}
        onConfirmRemove={(id) => performRemoveCollection(id)}
      />
      {relatedPanel
        ? createPortal(
            <Suspense fallback={null}>
              <RelatedCardsSidePanel
                sourceColId={relatedPanel.colId}
                sourceCardId={relatedPanel.cardId}
                collections={collections}
                canEdit={canEdit}
                onClose={() => setRelatedPanel(null)}
                onRemoveRelation={(tgtCol, tgtCard) =>
                  removeRelatedPair(
                    relatedPanel.colId,
                    relatedPanel.cardId,
                    tgtCol,
                    tgtCard
                  )
                }
                onAddRelation={(tgtCol, tgtCard) =>
                  addRelatedPair(
                    relatedPanel.colId,
                    relatedPanel.cardId,
                    tgtCol,
                    tgtCard
                  )
                }
                onNavigateToCard={(tgtCol, _tgtCard) => {
                  setTrashViewActive(false);
                  setActiveId(tgtCol);
                  setCalendarDay(null);
                  setSearchQuery("");
                  setSearchBarOpen(false);
                  setMobileNavOpen(false);
                  setRelatedPanel(null);
                }}
              />
            </Suspense>,
            document.body
          )
        : null}
      {userAdmin.userAdminOpen && isAdmin ? (
        <Suspense fallback={null}>
          <UserAdminPage
            open
            onClose={() => userAdmin.setUserAdminOpen(false)}
            adminUsersErr={userAdmin.adminUsersErr}
            userAdminFormErr={userAdmin.userAdminFormErr}
            newUserUsername={userAdmin.newUserUsername}
            setNewUserUsername={userAdmin.setNewUserUsername}
            newUserPassword={userAdmin.newUserPassword}
            setNewUserPassword={userAdmin.setNewUserPassword}
            newUserDisplayName={userAdmin.newUserDisplayName}
            setNewUserDisplayName={userAdmin.setNewUserDisplayName}
            newUserEmail={userAdmin.newUserEmail}
            setNewUserEmail={userAdmin.setNewUserEmail}
            newUserRole={userAdmin.newUserRole}
            setNewUserRole={userAdmin.setNewUserRole}
            newUserBusy={userAdmin.newUserBusy}
            submitNewUser={userAdmin.submitNewUser}
            adminUsers={userAdmin.adminUsers}
            adminUsersLoading={userAdmin.adminUsersLoading}
            rowBusyId={userAdmin.rowBusyId}
            pwdResetByUser={userAdmin.pwdResetByUser}
            setPwdResetByUser={userAdmin.setPwdResetByUser}
            profileDrafts={userAdmin.profileDrafts}
            setProfileDraft={userAdmin.setProfileDraft}
            saveUserProfile={userAdmin.saveUserProfile}
            onRoleChange={userAdmin.onRoleChange}
            applyPasswordReset={userAdmin.applyPasswordReset}
            onDeleteUser={userAdmin.onDeleteUser}
          />
        </Suspense>
      ) : null}
      {currentUser && userProfileModalOpen ? (
        <Suspense fallback={null}>
          <UserProfileModal
            open
            onClose={() => setUserProfileModalOpen(false)}
            currentUser={currentUser}
            mediaUploadMode={mediaUploadMode}
            dataMode={dataMode}
            onAfterSave={refreshMe}
            onAccountDeleted={logout}
            onFlash={setSidebarFlash}
            setSaving={setProfileSaveBusy}
          />
        </Suspense>
      ) : null}
      {canEdit &&
      (currentUser || dataMode === "local") &&
      userNoteSettingsOpen ? (
        <Suspense fallback={null}>
          <NoteSettingsModal
            open
            onClose={() => setUserNoteSettingsOpen(false)}
            newNotePlacement={newNotePlacement}
            setNewNotePlacement={setNewNotePlacement}
            hideSidebarCollectionDots={hideSidebarCollectionDots}
            setHideSidebarCollectionDots={setHideSidebarCollectionDots}
            timelineFoldBodyThreeLines={timelineFoldBodyThreeLines}
            setTimelineFoldBodyThreeLines={setTimelineFoldBodyThreeLines}
            dataMode={dataMode}
            setDataMode={setDataMode}
            onOpenAppleNotesImport={openAppleNotesImportModal}
            onOpenFlomoImport={openFlomoImportModal}
            onOpenEvernoteImport={openEvernoteImportModal}
            onOpenYuqueImport={openYuqueImportModal}
            collections={collections}
            onCollectionsChange={onNoteSettingsCollectionsChange}
            onPurgeBlankCards={handlePurgeBlankCards}
            onNotePrefsApplied={setUserNotePrefs}
            onMigrateFileCardTitles={handleMigrateFileCardTitles}
          />
        </Suspense>
      ) : null}
      {currentUser && userDataStatsOpen ? (
        <Suspense fallback={null}>
          <DataStatsModal
            open
            onClose={() => setUserDataStatsOpen(false)}
            collections={collections}
            mediaQuota={currentUser.mediaQuota}
            role={currentUser.role}
            onOpen={refreshMe}
          />
        </Suspense>
      ) : null}
      {canEdit &&
      (currentUser || dataMode === "local") &&
      userAppleNotesImportOpen ? (
        <Suspense fallback={null}>
          <AppleNotesImportModal
            open
            onClose={() => setUserAppleNotesImportOpen(false)}
            targetCollectionLabel={importTargetLabel}
            canImport={!importAppleNotesBlockedHint}
            blockedHint={importAppleNotesBlockedHint}
            onRunImport={runAppleNotesImport}
          />
        </Suspense>
      ) : null}
      {canEdit &&
      (currentUser || dataMode === "local") &&
      userFlomoImportOpen ? (
        <Suspense fallback={null}>
          <FlomoImportModal
            open
            onClose={() => setUserFlomoImportOpen(false)}
            targetCollectionLabel={importTargetLabel}
            canImport={!importAppleNotesBlockedHint}
            blockedHint={importAppleNotesBlockedHint}
            onRunImport={runFlomoImport}
          />
        </Suspense>
      ) : null}
      {canEdit &&
      (currentUser || dataMode === "local") &&
      userEvernoteImportOpen ? (
        <Suspense fallback={null}>
          <EvernoteImportModal
            open
            onClose={() => setUserEvernoteImportOpen(false)}
            targetCollectionLabel={importTargetLabel}
            canImport={!importAppleNotesBlockedHint}
            blockedHint={importAppleNotesBlockedHint}
            onRunImport={runEvernoteImport}
          />
        </Suspense>
      ) : null}
      {canEdit &&
      (currentUser || dataMode === "local") &&
      userYuqueImportOpen ? (
        <Suspense fallback={null}>
          <YuqueImportModal
            open
            onClose={() => setUserYuqueImportOpen(false)}
            targetCollectionLabel={importTargetLabel}
            canImport={!importAppleNotesBlockedHint}
            blockedHint={importAppleNotesBlockedHint}
            onRunImport={runYuqueImport}
          />
        </Suspense>
      ) : null}
      {detailCardLive ? (
        <Suspense fallback={null}>
          <CardDetail
          card={detailCardLive.card}
          openAtMediaIndex={detailCardLive.openAtMediaIndex}
          onClose={() => {
            setDetailCard(null);
            setCardMenuId(null);
          }}
          canEdit={canEdit}
          canAttachMedia={canAttachMedia}
          uploadBusy={uploadBusyCardId === detailCardLive.card.id}
          uploadProgress={
            uploadBusyCardId === detailCardLive.card.id
              ? uploadCardProgress
              : null
          }
          cardMenuId={cardMenuId}
          setCardMenuId={setCardMenuId}
          onBeginMediaUpload={() =>
            beginCardMediaUpload(
              detailCardLive.colId,
              detailCardLive.card.id
            )
          }
          onClearMedia={() =>
            clearCardMedia(detailCardLive.colId, detailCardLive.card.id)
          }
          onTogglePin={() =>
            togglePin(detailCardLive.colId, detailCardLive.card.id)
          }
          onDelete={() =>
            deleteCard(detailCardLive.colId, detailCardLive.card.id)
          }
          onChangeText={(next) =>
            setCardText(
              detailCardLive.colId,
              detailCardLive.card.id,
              next
            )
          }
          onPasteFiles={
            canEdit && canAttachMedia
              ? (files) => {
                  void uploadFilesToCard(
                    detailCardLive.colId,
                    detailCardLive.card.id,
                    files
                  );
                }
              : undefined
          }
          onRemoveGalleryItem={
            canEdit
              ? (item) =>
                  removeCardMediaItem(
                    detailCardLive.colId,
                    detailCardLive.card.id,
                    item
                  )
              : undefined
          }
          onSetGalleryCoverItem={
            canEdit
              ? (item) =>
                  setCardMediaCoverItem(
                    detailCardLive.colId,
                    detailCardLive.card.id,
                    item
                  )
              : undefined
          }
          onCreateFileCardFromAttachment={
            dataMode === "remote" &&
            (detailCardLive.card.objectKind ?? "note") === "note"
              ? (item) => {
                  void createFileCardFromNoteAttachment(
                    detailCardLive.colId,
                    detailCardLive.card.id,
                    item
                  );
                }
              : undefined
          }
          attachmentHasLinkedFileCard={(item) =>
            noteHasLinkedFileCardForMedia(
              detailCardLive.card,
              item,
              collections
            )
          }
          onOpenFileCard={(item) =>
            openFileCardForAttachment(detailCardLive.card, item)
          }
          onRemoveFromCollection={
            canEdit &&
            (detailCardLive.colId !== LOOSE_NOTES_COLLECTION_ID ||
              (cardPlacementCountByCardId.get(detailCardLive.card.id) ?? 0) > 1)
              ? () => {
                  void removeCardFromCollectionPlacementAt(
                    detailCardLive.colId,
                    detailCardLive.card.id
                  );
                  setDetailCard(null);
                  setCardMenuId(null);
                }
              : undefined
          }
        />
        </Suspense>
      ) : null}
      {reminderPicker ? (
        <Suspense fallback={null}>
          <ReminderPickerModal
            open
            mode={reminderPicker.kind === "new-task" ? "new-task" : "card"}
            collections={collections}
            colId={
              reminderPicker.kind === "card" ? reminderPicker.colId : ""
            }
            cardId={
              reminderPicker.kind === "card" ? reminderPicker.cardId : ""
            }
            onClose={() => setReminderPicker(null)}
            onSave={(iso, time, note) => {
              if (reminderPicker.kind === "new-task") {
                void finishNewTaskFromReminder(iso, time, note);
                return;
              }
              commitCardReminder(
                reminderPicker.colId,
                reminderPicker.cardId,
                iso,
                time,
                note
              );
            }}
            onClear={() => {
              if (reminderPicker.kind !== "card") return;
              commitCardReminder(
                reminderPicker.colId,
                reminderPicker.cardId,
                null
              );
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
