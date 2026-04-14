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
  updateCardApi,
  deleteCardApi,
  fetchCollectionsFromApi,
} from "./api/collections";
import {
  clearMeTrash,
  deleteMeTrashEntry,
  fetchMeFavorites,
  fetchMeTrash,
  postMeTrashEntry,
  putMeFavorites,
} from "./api/mePreferences";
import { uploadCardMedia } from "./api/upload";
import { useAppDataMode } from "./appDataMode";
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
  readSidebarSectionsCollapsed,
  sidebarSectionsCollapseStorageKey,
  writeSidebarSectionsCollapsed,
  type SidebarSectionCollapseState,
} from "./sidebarSectionCollapseStorage";
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
const CardDetail = lazy(() =>
  import("./CardDetail").then((m) => ({ default: m.CardDetail }))
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
  Collection,
  NoteCard,
  NoteMediaItem,
  TrashedNoteEntry,
} from "./types";
import { migrateCollectionTree } from "./migrateCollections";
import {
  remoteSnapshotUserKey,
  saveRemoteCollectionsSnapshot,
} from "./remoteCollectionsCache";
import "./App.css";

import {
  addBidirectionalRelated,
  AdminHeaderIcon,
  AllRemindersView,
  NoteConnectionsView,
  collectConnectionEdges,
  ancestorIdsFor,
  activeCollectionStorageKey,
  buildCalendarCells,
  buildSearchResults,
  CalendarBrowsePanel,
  CollectionContextMenu,
  CollectionDeleteDialog,
  CollectionSidebarTree,
  CollectionStarIcon,
  collapsedFoldersStorageKey,
  type CollectionDropPosition,
  collectAllTagsFromCollections,
  collectAllReminderEntries,
  collectCardsOnDate,
  cloneInitialCollections,
  collectReminderCardsOnDate,
  collectSubtreeCollectionIds,
  collectionPathLabel,
  countSidebarCollectionCardBadge,
  createLooseNotesCollection,
  datesWithNoteAddedOn,
  datesWithReminderOn,
  favoriteCollectionsStorageKey,
  findCardInTree,
  findCollectionById,
  readCollapsedFolderIdsFromStorage,
  readPersistedActiveCollectionId,
  formatCalendarDayTitle,
  initTimelineColumnPreferenceIfNeeded,
  insertChildCollection,
  INITIAL_WORKSPACE,
  loadFavoriteCollectionIds,
  loadTrashedNoteEntries,
  localDateString,
  LOOSE_NOTES_COLLECTION_ID,
  LOOSE_NOTES_DOT_COLOR,
  mapCollectionById,
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
  pruneCollapsedFolderIds,
  resolveActiveCollectionId,
  randomDotColor,
  readTimelineColumnPreferenceFromStorage,
  RelatedCardsSidePanel,
  writeTimelineColumnPreferenceToStorage,
  removeBidirectionalRelated,
  removeCollectionFromTree,
  saveFavoriteCollectionIds,
  saveTrashedNoteEntries,
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
  walkCollectionsWithPath,
} from "./appkit";
import { mergeServerTreeWithLocalExtraCards } from "./appkit/collectionModel";
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

  const [sidebarSectionCollapsed, setSidebarSectionCollapsed] =
    useState<SidebarSectionCollapseState>(() =>
      readSidebarSectionsCollapsed(
        sidebarSectionsCollapseStorageKey(
          dataMode,
          currentUser?.id ?? null
        )
      )
    );

  useEffect(() => {
    setSidebarSectionCollapsed(
      readSidebarSectionsCollapsed(sidebarSectionsKey)
    );
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
  const [activeId, setActiveId] = useState(() => INITIAL_WORKSPACE.activeId);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** 未输入内容时是否展开顶栏搜索框（有内容时始终展开） */
  const [searchBarOpen, setSearchBarOpen] = useState(false);
  const mainSearchInputRef = useRef<HTMLInputElement>(null);
  const mainHeaderRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [calendarViewMonth, setCalendarViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  /** 从卡片「⋯」或「新建待办」打开提醒弹窗 */
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
  } | null>(null);
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
  const [trashEntries, setTrashEntries] = useState<TrashedNoteEntry[]>([]);
  const [trashViewActive, setTrashViewActive] = useState(false);
  const [allNotesViewActive, setAllNotesViewActive] = useState(false);
  const [connectionsViewActive, setConnectionsViewActive] = useState(false);
  const [remindersViewActive, setRemindersViewActive] = useState(false);
  const [draggingCollectionId, setDraggingCollectionId] = useState<
    string | null
  >(null);
  const [dropIndicator, setDropIndicator] = useState<{
    targetId: string;
    position: CollectionDropPosition;
  } | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
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

  const { setCardText } = useCardTextRemoteAutosave(dataMode, setCollections);

  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [userProfileModalOpen, setUserProfileModalOpen] =
    useState(false);
  const [userNoteSettingsOpen, setUserNoteSettingsOpen] =
    useState(false);
  const [userDataStatsOpen, setUserDataStatsOpen] = useState(false);
  const [userAccountMenuOpen, setUserAccountMenuOpen] =
    useState(false);
  const [newNotePlacement, setNewNotePlacementState] =
    useState<NewNotePlacement>(readNewNotePlacement);
  const setNewNotePlacement = useCallback((p: NewNotePlacement) => {
    setNewNotePlacementState(p);
    saveNewNotePlacement(p);
  }, []);
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
    setCollections,
    setLoadError,
    setApiOnline,
    refreshRemotePreferences,
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

  const handleTimelinePullRefresh = useCallback(async () => {
    if (dataMode === "remote") {
      if (writeRequiresLogin && !currentUser && !getAdminToken()) {
        return;
      }
      const data = await fetchCollectionsFromApi();
      if (data === null) {
        setLoadError((prev) => prev ?? c.syncLoadFail);
        setApiOnline(false);
        return;
      }
      setLoadError(null);
      setApiOnline(true);
      const tree = migrateCollectionTree(data);
      let merged = tree;
      flushSync(() => {
        setCollections((prev) => {
          merged = mergeServerTreeWithLocalExtraCards(tree, prev);
          return merged;
        });
      });
      const sk = remoteSnapshotUserKey(
        writeRequiresLogin,
        currentUser?.id?.trim() || null
      );
      if (sk) saveRemoteCollectionsSnapshot(sk, merged);
      await refreshRemotePreferences();
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
    c,
    writeRequiresLogin,
    currentUser,
    setCollections,
    setLoadError,
    setApiOnline,
    setActiveId,
    setCollapsedFolderIds,
    refreshRemotePreferences,
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
      reminderPicker !== null ||
      collectionDeleteDialog !== null ||
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
      reminderPicker,
      collectionDeleteDialog,
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
    if (calendarDay) {
      setTrashViewActive(false);
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
      setRemindersViewActive(false);
    }
  }, [calendarDay]);

  useEffect(() => {
    if (trashViewActive) {
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
      setRemindersViewActive(false);
    }
  }, [trashViewActive]);

  useEffect(() => {
    if (remindersViewActive) {
      setAllNotesViewActive(false);
      setConnectionsViewActive(false);
    }
  }, [remindersViewActive]);

  useEffect(() => {
    if (allNotesViewActive) {
      setRemindersViewActive(false);
      setConnectionsViewActive(false);
    }
  }, [allNotesViewActive]);

  useEffect(() => {
    if (connectionsViewActive) {
      setAllNotesViewActive(false);
      setRemindersViewActive(false);
    }
  }, [connectionsViewActive]);

  const allNotesViewActiveRef = useRef(false);
  useEffect(() => {
    allNotesViewActiveRef.current = allNotesViewActive;
  }, [allNotesViewActive]);
  const connectionsViewActiveRef = useRef(false);
  useEffect(() => {
    connectionsViewActiveRef.current = connectionsViewActive;
  }, [connectionsViewActive]);
  useEffect(() => {
    if (allNotesViewActiveRef.current) setAllNotesViewActive(false);
    if (connectionsViewActiveRef.current) setConnectionsViewActive(false);
  }, [activeId]);

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

  useEffect(() => {
    if (activeId && !findCollectionById(collections, activeId)) {
      setActiveId(collections[0]?.id ?? "");
    }
  }, [collections, activeId]);

  /** 刷新后回到上次选中的合集（按数据模式与用户区分） */
  useEffect(() => {
    if (!authReady) return;
    if (dataMode === "remote" && !remoteLoaded) return;
    if (!activeId) return;
    try {
      localStorage.setItem(activeCollectionKey, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId, activeCollectionKey, authReady, dataMode, remoteLoaded]);

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

  const { pinned, rest } = useMemo(
    () => splitPinnedCards(active?.cards ?? []),
    [active?.cards]
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

  const connectionEdges = useMemo(
    () => collectConnectionEdges(collections),
    [collections]
  );

  const allNotesSorted = useMemo(() => {
    const entries: { col: Collection; card: NoteCard }[] = [];
    walkCollections(collections, (col) => {
      for (const card of col.cards) entries.push({ col, card });
    });
    entries.sort((a, b) => {
      const dateA = a.card.addedOn ?? "";
      const dateB = b.card.addedOn ?? "";
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      return (b.card.minutesOfDay ?? 0) - (a.card.minutesOfDay ?? 0);
    });
    return entries;
  }, [collections]);

  const sidebarTags = useMemo(
    () => collectAllTagsFromCollections(collections),
    [collections]
  );

  const favoriteSidebarEntries = useMemo(() => {
    const all = walkCollectionsWithPath(collections, []);
    return all.filter(({ col }) => favoriteCollectionIds.has(col.id));
  }, [collections, favoriteCollectionIds]);

  const searchTrim = searchQuery.trim();
  const searchActive = searchTrim.length > 0;
  const searchExpanded = searchBarOpen || searchActive;

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

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarViewMonth),
    [calendarViewMonth]
  );

  const onPickCalendarDay = useCallback((dateStr: string) => {
    setSearchQuery("");
    setSearchBarOpen(false);
    setRemindersViewActive(false);
    setCalendarDay(dateStr);
    const [yy, mm] = dateStr.split("-").map(Number);
    setCalendarViewMonth(new Date(yy, mm - 1, 1));
  }, []);

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

  const togglePin = useCallback(
    (colId: string, cardId: string) => {
      let newPinned: boolean | undefined;
      setCollections((prev) => {
        const col = findCollectionById(prev, colId);
        const card = col?.cards.find((c) => c.id === cardId);
        newPinned = !card?.pinned;
        return mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) =>
            cd.id === cardId ? { ...cd, pinned: newPinned } : cd
          ),
        }));
      });
      if (dataMode !== "local") {
        // newPinned 在 setCollections 回调中同步赋值
        Promise.resolve().then(() => {
          if (newPinned !== undefined) {
            void updateCardApi(cardId, { pinned: newPinned });
          }
        });
      }
    },
    [dataMode]
  );

  const commitCardReminder = useCallback(
    (
      colId: string,
      cardId: string,
      isoDate: string | null,
      time?: string,
      note?: string
    ) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) => {
            if (cd.id !== cardId) return cd;
            if (isoDate == null || isoDate === "") {
              const { reminderOn: _r, reminderTime: _t, reminderNote: _n, ...rest } = cd;
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
          }),
        }))
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
    (colId: string, cardId: string) => {
      const doneAt = new Date().toISOString();
      let remoteCompletedNote: string | null = null;
      setCollections((prev) =>
        mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) => {
            if (cd.id !== cardId) return cd;
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
          }),
        }))
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
      const col = findCollectionById(collections, colId);
      const card = col?.cards.find((c) => c.id === cardId);
      if (card && canEdit) {
        const entry: TrashedNoteEntry = {
          trashId: `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          colId,
          colPathLabel: collectionPathLabel(collections, colId),
          card: structuredClone(card) as NoteCard,
          deletedAt: new Date().toISOString(),
        };
        if (dataMode !== "local") {
          const ok = await postMeTrashEntry(entry);
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
        const next = mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.filter((c0) => c0.id !== cardId),
        }));
        return stripRelatedRefsToTarget(next, colId, cardId);
      });
      setCardMenuId(null);
      setRelatedPanel((p) =>
        p?.colId === colId && p?.cardId === cardId ? null : p
      );
      setDetailCard((d) =>
        d && d.colId === colId && d.card.id === cardId ? null : d
      );
      if (dataMode !== "local") {
        void deleteCardApi(cardId);
      }
    },
    [canEdit, collections, trashStorageKey, dataMode, c.errTrashMove]
  );

  const restoreTrashedEntry = useCallback(
    async (entry: TrashedNoteEntry) => {
      if (!canEdit) return;
      if (!findCollectionById(collections, entry.colId)) {
        setSidebarFlash(c.errTrashRestoreOrigin);
        return;
      }
      let cardToAppend: NoteCard = entry.card;
      if (dataMode !== "local") {
        const created = await createCardApi(entry.colId, entry.card, {
          insertAtStart: newNotePlacement === "top",
        });
        if (!created) {
          window.alert(c.errTrashRestore);
          return;
        }
        cardToAppend = created;
        const delOk = await deleteMeTrashEntry(entry.trashId);
        if (!delOk) {
          window.alert(c.errTrashRestoreTag);
        }
      }
      setTrashEntries((te) => {
        const next = te.filter((t) => t.trashId !== entry.trashId);
        if (dataMode === "local") {
          saveTrashedNoteEntries(trashStorageKey, next);
        }
        return next;
      });
      setCollections((prev) =>
        mapCollectionById(prev, entry.colId, (col) => ({
          ...col,
          cards:
            newNotePlacement === "top"
              ? [
                  structuredClone(cardToAppend) as NoteCard,
                  ...col.cards,
                ]
              : [...col.cards, structuredClone(cardToAppend) as NoteCard],
        }))
      );
      setTrashViewActive(false);
      setRemindersViewActive(false);
      setActiveId(entry.colId);
      setCalendarDay(null);
      setMobileNavOpen(false);
    },
    [
      canEdit,
      collections,
      trashStorageKey,
      dataMode,
      newNotePlacement,
      c.errTrashRestoreOrigin,
      c.errTrashRestore,
      c.errTrashRestoreTag,
    ]
  );

  const purgeTrashedEntry = useCallback(
    async (trashId: string) => {
      if (!canEdit) return;
      if (
        !window.confirm(c.confirmTrashDelete)
      ) {
        return;
      }
      if (dataMode !== "local") {
        const ok = await deleteMeTrashEntry(trashId);
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
    [canEdit, trashStorageKey, dataMode, c.confirmTrashDelete, c.errTrashDeleteOne]
  );

  const emptyTrash = useCallback(async () => {
    if (!canEdit || trashEntries.length === 0) return;
    if (
      !window.confirm(c.confirmEmptyTrash(trashEntries.length))
    ) {
      return;
    }
    if (dataMode !== "local") {
      const ok = await clearMeTrash();
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

  const setCardTags = useCallback(
    (colId: string, cardId: string, tags: string[]) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (col) => ({
          ...col,
          cards: col.cards.map((card) => {
            if (card.id !== cardId) return card;
            if (tags.length === 0) {
              const { tags: _t, ...rest } = card;
              return rest;
            }
            return { ...card, tags };
          }),
        }))
      );
      if (dataMode !== "local") {
        void updateCardApi(cardId, { tags });
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
          const col = findCollectionById(prev, colId);
          const card = col?.cards.find((c) => c.id === cardId);
          nextMedia = [...(card?.media ?? []), item];
          return mapCollectionById(prev, colId, (c) => ({
            ...c,
            cards: c.cards.map((cd) =>
              cd.id === cardId ? { ...cd, media: nextMedia } : cd
            ),
          }));
        });
      });
      if (dataMode !== "local" && nextMedia !== undefined) {
        void updateCardApi(cardId, { media: nextMedia });
      }
    },
    [dataMode]
  );

  const uploadFilesToCard = useCallback(
    async (colId: string, cardId: string, files: File[]) => {
      if (files.length === 0) return;
      setUploadBusyCardId(cardId);
      setUploadCardProgress(null);
      try {
        if (dataMode === "local") {
          if (isTauri()) {
            for (const file of files) {
              try {
                const r = await saveLocalMediaToAppFolder(file);
                addMediaItemToCard(
                  colId,
                  cardId,
                  mediaItemFromUploadResult(r)
                );
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
                addMediaItemToCard(
                  colId,
                  cardId,
                  mediaItemFromUploadResult(r)
                );
              } catch (err) {
                window.alert(
                  err instanceof Error ? err.message : c.errBrowserBlob
                );
              }
            }
          }
          return;
        }
        setUploadCardProgress(0);
        for (const file of files) {
          const r = await uploadCardMedia(file, {
            onProgress: (p) => setUploadCardProgress(p),
          });
          addMediaItemToCard(
            colId,
            cardId,
            mediaItemFromUploadResult(r)
          );
        }
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : c.errUpload
        );
      } finally {
        setUploadBusyCardId(null);
        setUploadCardProgress(null);
      }
    },
    [addMediaItemToCard, dataMode, c.errLocalFolder, c.errBrowserBlob, c.errUpload]
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
      const file = input.files?.[0];
      input.value = "";
      const t = cardMediaUploadTargetRef.current;
      cardMediaUploadTargetRef.current = null;
      if (!file || !t) return;
      void uploadFilesToCard(t.colId, t.cardId, [file]);
    },
    [uploadFilesToCard]
  );

  const clearCardMedia = useCallback(
    (colId: string, cardId: string) => {
      setCollections((prev) => {
        const col = findCollectionById(prev, colId);
        const card = col?.cards.find((c) => c.id === cardId);
        for (const m of card?.media ?? []) {
          void deleteLocalMediaFile(m.url);
        }
        return mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) => {
            if (cd.id !== cardId) return cd;
            const { media: _m, ...rest } = cd;
            return rest;
          }),
        }));
      });
      setCardMenuId(null);
      if (dataMode !== "local") {
        void updateCardApi(cardId, { media: [] });
      }
    },
    [dataMode]
  );

  const removeCardMediaItem = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      void deleteLocalMediaFile(item.url);
      let nextMedia: NoteMediaItem[] | undefined;
      flushSync(() => {
        setCollections((prev) =>
          mapCollectionById(prev, colId, (col) => ({
            ...col,
            cards: col.cards.map((card) => {
              if (card.id !== cardId) return card;
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
              if (next.length === 0) {
                const { media: _m, ...rest } = card;
                return rest;
              }
              return { ...card, media: next };
            }),
          }))
        );
      });
      // 未找到对应项时不要 PATCH media: []，否则会误清空整张卡附件
      if (dataMode !== "local" && nextMedia !== undefined) {
        void updateCardApi(cardId, { media: nextMedia });
      }
    },
    [dataMode]
  );

  /** 将指定附件移到 media 数组首位，作为轮播默认首帧（封面） */
  const setCardMediaCoverItem = useCallback(
    (colId: string, cardId: string, item: NoteMediaItem) => {
      let nextMedia: NoteMediaItem[] | undefined;
      flushSync(() => {
        setCollections((prev) =>
          mapCollectionById(prev, colId, (col) => ({
            ...col,
            cards: col.cards.map((card) => {
              if (card.id !== cardId) return card;
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
            }),
          }))
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
      }
    ): Promise<string | null> => {
      if (!canEdit) return null;
      if (trashViewActive) return null;
      if (connectionsViewActive) return null;
      if (remindersViewActive && !opts?.reminderOn) return null;
      if (calendarDay !== null) return null;
      if (searchQuery.trim().length > 0) return null;
      const targetColId =
        targetColIdOverride?.trim() ||
        (allNotesViewActive || remindersViewActive
          ? LOOSE_NOTES_COLLECTION_ID
          : active?.id ?? "");
      if (!targetColId) return null;
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
              newNotePlacement === "top"
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
          insertAtStart: newNotePlacement === "top",
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
      remindersViewActive,
      calendarDay,
      active?.id,
      searchQuery,
      dataMode,
      newNotePlacement,
      allNotesViewActive,
      c.looseNotesCollectionName,
      c.errCreateCol,
    ]
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
    async (parentId: string) => {
      if (!canEdit) return;
      skipCloseMobileNavOnActiveChangeRef.current = true;
      setTrashViewActive(false);
      setRemindersViewActive(false);
      const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const child: Collection = {
        id,
        name: c.newSubCollectionName,
        dotColor: randomDotColor(),
        cards: [],
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
    [canEdit, dataMode, c.newSubCollectionName, c.errCreateSub]
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
      if (dataMode === "remote") {
        const ok = await deleteCollectionApi(id);
        if (!ok) {
          window.alert(c.errDeleteCol);
          return;
        }
      }
      setDraggingCollectionId((d) => (d === id ? null : d));
      setDropIndicator((di) => (di?.targetId === id ? null : di));
      setEditingCollectionId((e) => (e === id ? null : e));

      let subtreeIds: string[] = [];
      setCollections((prev) => {
        const node = findCollectionById(prev, id);
        if (!node) return prev;
        subtreeIds = collectSubtreeCollectionIds(node);
        const { tree, removed } = removeCollectionFromTree(prev, id);
        return removed ? tree : prev;
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
    [canEdit, dataMode, favoriteStorageKey, c.errDeleteCol]
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

  const {
    onCollectionRowDragStart,
    onCollectionRowDragEnd,
    onCollectionRowDragOver,
    onCollectionRowDrop,
  } = useCollectionRowDnD({
    canEdit,
    dataMode,
    noteCardDragActiveRef,
    draggingCollectionIdRef,
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
    return c ? { colId: detailCard.colId, card: c } : null;
  }, [detailCard, collections]);

  useEffect(() => {
    if (detailCard && !detailCardLive) setDetailCard(null);
  }, [detailCard, detailCardLive]);

  const timelineEmpty = (active?.cards.length ?? 0) === 0;
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
        relatedPanel={relatedPanel}
        setRelatedPanel={setRelatedPanel}
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
        setReminderPicker={setReminderPicker}
        togglePin={togglePin}
        deleteCard={deleteCard}
        setCardText={setCardText}
        setCardTags={setCardTags}
        timelineColumnCount={timelineColumnCount}
      />
    );
  }

  const openUserProfileModal = useCallback(() => {
    setUserAccountMenuOpen(false);
    setUserProfileModalOpen(true);
  }, []);

  const openNoteSettingsModal = useCallback(() => {
    setUserAccountMenuOpen(false);
    setUserNoteSettingsOpen(true);
  }, []);

  const openDataStatsModal = useCallback(() => {
    setUserAccountMenuOpen(false);
    setUserDataStatsOpen(true);
  }, []);

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
        onOpenProfile={openUserProfileModal}
        onOpenNoteSettings={openNoteSettingsModal}
        onOpenDataStats={openDataStatsModal}
      />
    );
  }, [
    userAccountMenuOpen,
    writeRequiresLogin,
    currentUser,
    dataMode,
    profileSaveBusy,
    openUserProfileModal,
    openNoteSettingsModal,
    openDataStatsModal,
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

  /** 未登录：不渲染侧栏/时间线，仅全屏底 + 登录层（由 AuthProvider 挂载） */
  if (loginWallBlocking) {
    return (
      <div
        className="app app--login-wall"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={
        "app" +
        (showMobileSidebarBrowseChrome ? " app--mobile-nav-open" : "") +
        (tabletSplitNav ? " app--tablet-split-nav" : "") +
        (timelineColumnCount > 1 ? " app--masonry" : "") +
        (connectionsViewActive ? " app--connections-board" : "")
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
              {dataMode === "remote" ? (
                <button
                  type="button"
                  className={
                    "sidebar__admin-icon-btn sidebar__admin-icon-btn--mobile-browse" +
                    (currentUser || getAdminToken()
                      ? " sidebar__admin-icon-btn--on"
                      : "")
                  }
                  onClick={
                    currentUser || getAdminToken() ? logout : openLogin
                  }
                  aria-label={
                    currentUser || getAdminToken() ? c.logout : c.login
                  }
                  title={
                    currentUser || getAdminToken()
                      ? c.logoutTitle
                      : c.loginTitle
                  }
                >
                  <AdminHeaderIcon
                    mode={
                      currentUser || getAdminToken() ? "logout" : "login"
                    }
                  />
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
            {!showMobileSidebarBrowseChrome ? (
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
            ) : null}
            <div className="sidebar__header-actions">
              {dataMode === "remote" ? (
                <>
                  {writeRequiresLogin && isAdmin ? (
                    <button
                      type="button"
                      className="sidebar__users-btn"
                      onClick={() => userAdmin.setUserAdminOpen(true)}
                      title={c.adminTitle}
                    >
                      {c.adminUsersShort}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={
                      "sidebar__admin-icon-btn" +
                      (currentUser || getAdminToken()
                        ? " sidebar__admin-icon-btn--on"
                        : "")
                    }
                    onClick={
                      currentUser || getAdminToken() ? logout : openLogin
                    }
                    aria-label={
                      currentUser || getAdminToken() ? c.logout : c.login
                    }
                    title={
                      currentUser || getAdminToken()
                        ? c.logoutTitle
                        : c.loginTitle
                    }
                  >
                    <AdminHeaderIcon
                      mode={
                        currentUser || getAdminToken() ? "logout" : "login"
                      }
                    />
                  </button>
                </>
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

        <div className="sidebar__all-notes">
          <button
            type="button"
            className={
              "sidebar__all-notes-hit" +
              (allNotesViewActive && !searchActive ? " is-active" : "")
            }
            onClick={() => {
              setTrashViewActive(false);
              setCalendarDay(null);
              setSearchQuery("");
              setSearchBarOpen(false);
              setAllNotesViewActive(true);
              setMobileNavOpen(false);
            }}
          >
            <span className="sidebar__all-notes-label">{c.allNotesEntry}</span>
            <span className="sidebar__all-notes-count">
              {allNotesSorted.length}
            </span>
          </button>
        </div>

        {allReminderEntries.length > 0 ? (
          <div
            className="sidebar__all-reminders"
            aria-label={c.remindersEntry}
          >
            <button
              type="button"
              className={
                "sidebar__all-reminders-hit" +
                (remindersViewActive && !searchActive ? " is-active" : "")
              }
              onClick={() => {
                setTrashViewActive(false);
                setCalendarDay(null);
                setSearchQuery("");
                setSearchBarOpen(false);
                setAllNotesViewActive(false);
                setConnectionsViewActive(false);
                setRemindersViewActive(true);
                setMobileNavOpen(false);
              }}
            >
              <span className="sidebar__all-reminders-label">
                {c.remindersTitle}
              </span>
              <span className="sidebar__all-reminders-count">
                {allReminderEntries.length}
              </span>
            </button>
          </div>
        ) : null}

        <div className="sidebar__all-notes sidebar__connections">
          <button
            type="button"
            className={
              "sidebar__all-notes-hit" +
              (connectionsViewActive && !searchActive ? " is-active" : "")
            }
            onClick={() => {
              setTrashViewActive(false);
              setCalendarDay(null);
              setSearchQuery("");
              setSearchBarOpen(false);
              setConnectionsViewActive(true);
              setMobileNavOpen(false);
            }}
          >
            <span className="sidebar__all-notes-label">{c.connectionsEntry}</span>
            <span className="sidebar__all-notes-count">
              {connectionEdges.length}
            </span>
          </button>
        </div>

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

        <div className="sidebar__collections">
          <div className="sidebar__favorites">
            <div className="sidebar__section-row sidebar__section-row--collapsible">
              <button
                type="button"
                className="sidebar__section-hit"
                onClick={() => toggleSidebarSection("favorites")}
                aria-expanded={!sidebarSectionCollapsed.favorites}
                aria-label={sidebarSectionToggleAria(
                  "favorites",
                  c.sidebarFavorites
                )}
              >
                <span
                  className={
                    "sidebar__chevron" +
                    (!sidebarSectionCollapsed.favorites ? " is-expanded" : "")
                  }
                  aria-hidden
                >
                  <span className="sidebar__chevron-icon">›</span>
                </span>
                <span className="sidebar__section">{c.sidebarFavorites}</span>
              </button>
            </div>
            {!sidebarSectionCollapsed.favorites ? (
              favoriteSidebarEntries.length === 0 ? (
                <p className="sidebar__favorites-empty">{c.favoritesEmpty}</p>
              ) : (
                <ul
                  className="sidebar__favorites-list"
                  aria-label={c.favoriteCols}
                >
                  {favoriteSidebarEntries.map(({ col, path }) => (
                    <li key={col.id} className="sidebar__favorites-item">
                      <div
                        className={
                          "sidebar__favorites-row" +
                          (col.id === active?.id &&
                          !calendarDay &&
                          !trashViewActive &&
                          !allNotesViewActive &&
                          !connectionsViewActive &&
                          !remindersViewActive
                            ? " is-active"
                            : "")
                        }
                      >
                        <button
                          type="button"
                          className="sidebar__favorites-hit"
                          onClick={() => {
                            setTrashViewActive(false);
                            setAllNotesViewActive(false);
                            setConnectionsViewActive(false);
                            setRemindersViewActive(false);
                            setSearchQuery("");
                            setSearchBarOpen(false);
                            setCalendarDay(null);
                            expandAncestorsOf(col.id);
                            setActiveId(col.id);
                            setMobileNavOpen(false);
                          }}
                        >
                          <span
                            className="sidebar__dot"
                            style={{ backgroundColor: col.dotColor }}
                            aria-hidden
                          />
                          <span className="sidebar__name" title={path}>
                            {col.name}
                          </span>
                          <span className="sidebar__count">
                            {countSidebarCollectionCardBadge(col)}
                          </span>
                        </button>
                        <button
                          type="button"
                          draggable={false}
                          className="sidebar__favorites-remove"
                          aria-label={c.unfavoriteAria}
                          title={c.unfavoriteTitle}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavoriteCollection(col.id);
                          }}
                        >
                          <span
                            className="sidebar__favorites-remove__icon"
                            aria-hidden
                          >
                            ×
                          </span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
          <div className="sidebar__section-row sidebar__section-row--collapsible">
            <button
              type="button"
              className="sidebar__section-hit"
              onClick={() => toggleSidebarSection("collections")}
              aria-expanded={!sidebarSectionCollapsed.collections}
              aria-label={sidebarSectionToggleAria(
                "collections",
                c.sidebarCollections
              )}
            >
              <span
                className={
                  "sidebar__chevron" +
                  (!sidebarSectionCollapsed.collections ? " is-expanded" : "")
                }
                aria-hidden
              >
                <span className="sidebar__chevron-icon">›</span>
              </span>
              <span className="sidebar__section">{c.sidebarCollections}</span>
            </button>
            {canEdit && !showMobileSidebarBrowseChrome ? (
              <button
                type="button"
                className="sidebar__section-add"
                onClick={addCollection}
                aria-label={c.newCollectionAria}
              >
                +
              </button>
            ) : null}
          </div>
          {!sidebarSectionCollapsed.collections ? (
          <nav className="sidebar__nav" aria-label={c.sidebarNav}>
            <CollectionSidebarTree
              collections={collections}
              activeId={active?.id}
              calendarDay={calendarDay}
              trashViewActive={trashViewActive}
              allNotesViewActive={allNotesViewActive}
              connectionsViewActive={connectionsViewActive}
              remindersViewActive={remindersViewActive}
              collapsedFolderIds={collapsedFolderIds}
              dropIndicator={dropIndicator}
              draggingCollectionId={draggingCollectionId}
              noteCardDropCollectionId={noteCardDropCollectionId}
              canEdit={canEdit}
              editingCollectionId={editingCollectionId}
              mobileCollectionDragByHandle={mobileCollectionDragByHandle}
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
              setRemindersViewActive={setRemindersViewActive}
              setCalendarDay={setCalendarDay}
              setActiveId={setActiveId}
              setMobileNavOpen={setMobileNavOpen}
              setDraftCollectionName={setDraftCollectionName}
              setEditingCollectionId={setEditingCollectionId}
              onCollectionNameBlur={onCollectionNameBlur}
              addSubCollection={addSubCollection}
            />
          </nav>
          ) : null}
        </div>

        <div className="sidebar__tags" aria-label={c.allTags}>
          <div className="sidebar__section-row sidebar__tags-head sidebar__section-row--collapsible">
            <button
              type="button"
              className="sidebar__section-hit"
              onClick={() => toggleSidebarSection("tags")}
              aria-expanded={!sidebarSectionCollapsed.tags}
              aria-label={sidebarSectionToggleAria("tags", c.sidebarTags)}
            >
              <span
                className={
                  "sidebar__chevron" +
                  (!sidebarSectionCollapsed.tags ? " is-expanded" : "")
                }
                aria-hidden
              >
                <span className="sidebar__chevron-icon">›</span>
              </span>
              <span className="sidebar__section">{c.sidebarTags}</span>
            </button>
          </div>
          {!sidebarSectionCollapsed.tags ? (
            sidebarTags.length > 0 ? (
              <div className="sidebar__tags-cloud">
                {sidebarTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="sidebar__tags-chip"
                    onClick={() => {
                      setTrashViewActive(false);
                      setRemindersViewActive(false);
                      setSearchQuery(tag);
                      setCalendarDay(null);
                      setMobileNavOpen(false);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : (
              <p className="sidebar__tags-empty">{c.tagsEmpty}</p>
            )
          ) : null}
          <div className="sidebar__trash" aria-label={c.trashAria}>
            <button
              type="button"
              className={
                "sidebar__trash-hit" +
                (trashViewActive && !searchActive ? " is-active" : "")
              }
              onClick={() => {
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
        </div>
      </aside>

      <main
        className={
          "main" +
          (connectionsViewActive ? " main--connections-board" : "") +
          (remindersViewActive ? " main--reminders" : "")
        }
        onClick={onMobileMainSurfaceTapToTop}
        onTouchStart={onMobileMainTouchStart}
        onTouchEnd={onMobileMainTouchEnd}
        onTouchCancel={onMobileMainTouchCancel}
      >
        <header ref={mainHeaderRef} className="main__header" id="app-main-header">
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
              <h1 className="main__heading">
                {searchActive
                  ? c.titleSearch
                  : trashViewActive
                    ? c.titleTrash
                    : allNotesViewActive
                      ? c.titleAllNotes
                      : connectionsViewActive
                        ? c.titleConnections
                        : remindersViewActive
                          ? c.titleReminders
                          : calendarDay
                            ? formatCalendarDayTitle(calendarDay, appUiLang)
                            : active?.name ?? c.titleNoCollection}
              </h1>
              {active &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive &&
              !allNotesViewActive &&
              !connectionsViewActive &&
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
              {!remindersViewActive ? (
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
              !connectionsViewActive ? (
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
          !remindersViewActive && (
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

        <div
          ref={timelineRef}
          className="timeline"
          role="feed"
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
                    {searchGroupedCards.map(({ col, path, cards }) => (
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
                  />
                ))}
              </MasonryShortestColumns>
            )
          ) : allNotesViewActive ? (
            allNotesSorted.length === 0 ? (
              <div className="timeline__empty">{c.emptyGlobal}</div>
            ) : (
              <MasonryShortestColumns columnCount={timelineColumnCount}>
                {allNotesSorted.map(({ col, card }) =>
                  renderNoteTimelineCard(card, col.id)
                )}
              </MasonryShortestColumns>
            )
          ) : connectionsViewActive ? (
            <NoteConnectionsView
              collections={collections}
              onOpenTarget={(colId, cardId) => {
                const hit = findCardInTree(collections, colId, cardId);
                if (hit) {
                  setDetailCard({ card: hit.card, colId });
                }
              }}
            />
          ) : remindersViewActive ? (
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
                {calendarRestByCol.map(({ col, cards: dayColCards }) => (
                  <div
                    key={col.id}
                    className="timeline__cal-group"
                  >
                    <h2 className="timeline__cal-group-title">
                      「{col.name}」
                    </h2>
                    <MasonryShortestColumns
                      columnCount={timelineColumnCount}
                    >
                      {dayColCards.map((card) =>
                        renderNoteTimelineCard(card, col.id)
                      )}
                    </MasonryShortestColumns>
                  </div>
                ))}
              </>
            )
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
                {rest.map((card) => renderNoteTimelineCard(card, active!.id))}
              </MasonryShortestColumns>
            </>
          )}
          {canEdit &&
          (active || allNotesViewActive || remindersViewActive) &&
          !calendarDay &&
          !searchActive &&
          !trashViewActive &&
          !connectionsViewActive ? (
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
      !calendarDay &&
      !searchActive &&
      !trashViewActive &&
      !connectionsViewActive &&
      (!mobileNavOpen || tabletSplitNav) &&
      !mobileCalendarOpen &&
      !remindersViewActive ? (
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
                  connectionsViewActive
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
              addSmallNote({ scrollTimelineToEnd: true });
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
        className="app__hidden-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={onCardMediaFileSelected}
      />
      <CollectionContextMenu
        menu={collectionCtxMenu}
        onRemove={(id, name, hasChildren) => {
          openRemoveCollectionDialog(id, name, hasChildren);
        }}
      />
      <CollectionDeleteDialog
        dialog={collectionDeleteDialog}
        onClose={() => setCollectionDeleteDialog(null)}
        onConfirmRemove={(id) => performRemoveCollection(id)}
      />
      {relatedPanel
        ? createPortal(
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
            />,
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
      {currentUser && userNoteSettingsOpen ? (
        <Suspense fallback={null}>
          <NoteSettingsModal
            open
            onClose={() => setUserNoteSettingsOpen(false)}
            newNotePlacement={newNotePlacement}
            setNewNotePlacement={setNewNotePlacement}
            dataMode={dataMode}
            setDataMode={setDataMode}
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
      {detailCardLive ? (
        <Suspense fallback={null}>
          <CardDetail
          card={detailCardLive.card}
          colId={detailCardLive.colId}
          onClose={() => {
            setDetailCard(null);
            setCardMenuId(null);
          }}
          canEdit={canEdit}
          canAttachMedia={canAttachMedia}
          relatedPanelOpen={
            relatedPanel?.colId === detailCardLive.colId &&
            relatedPanel?.cardId === detailCardLive.card.id
          }
          uploadBusy={uploadBusyCardId === detailCardLive.card.id}
          uploadProgress={
            uploadBusyCardId === detailCardLive.card.id
              ? uploadCardProgress
              : null
          }
          cardMenuId={cardMenuId}
          setCardMenuId={setCardMenuId}
          onToggleRelatedPanel={() =>
            setRelatedPanel((p) =>
              p?.colId === detailCardLive.colId &&
              p?.cardId === detailCardLive.card.id
                ? null
                : {
                    colId: detailCardLive.colId,
                    cardId: detailCardLive.card.id,
                  }
            )
          }
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
          onOpenReminderPicker={
            canEdit
              ? () =>
                  setReminderPicker({
                    kind: "card",
                    colId: detailCardLive.colId,
                    cardId: detailCardLive.card.id,
                  })
              : undefined
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
          onTagsCommit={setCardTags}
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
