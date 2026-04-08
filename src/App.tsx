import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import {
  createCollectionApi,
  updateCollectionApi,
  deleteCollectionApi,
  createCardApi,
  updateCardApi,
  deleteCardApi,
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
import { getAdminToken } from "./auth/token";
import { saveLocalCollections } from "./localCollectionsStorage";
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
import { UserProfileModal } from "./UserProfileModal";
import { DataStatsModal } from "./DataStatsModal";
import { NoteSettingsModal } from "./NoteSettingsModal";
import { CardDetail } from "./CardDetail";
import { ReminderPickerModal } from "./ReminderPickerModal";
import type {
  Collection,
  NoteCard,
  NoteMediaItem,
  TrashedNoteEntry,
} from "./types";
import "./App.css";

import {
  addBidirectionalRelated,
  AdminHeaderIcon,
  AllRemindersView,
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
  collectReminderCardsOnDate,
  collectSubtreeCollectionIds,
  collectionPathLabel,
  countSidebarCollectionCardBadge,
  datesWithNoteAddedOn,
  datesWithReminderOn,
  DEFAULT_COLLECTION_HINT,
  favoriteCollectionsStorageKey,
  findCollectionById,
  formatChineseDayTitle,
  insertChildCollection,
  INITIAL_WORKSPACE,
  loadFavoriteCollectionIds,
  loadTrashedNoteEntries,
  localDateString,
  MASONRY_LAYOUT_STORAGE_KEY,
  mapCollectionById,
  mediaItemFromUploadResult,
  MobileDockJarIcon,
  NoteTimelineCard,
  pruneCollapsedFolderIds,
  randomDotColor,
  readMasonryLayoutFromStorage,
  RelatedCardsSidePanel,
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
  UserAdminModal,
  useCardTextRemoteAutosave,
  useCollectionRowDnD,
  useMobileNavSwipe,
  useRemoteCollectionsSync,
  useUserAdmin,
  walkCollections,
  walkCollectionsWithPath,
} from "./appkit";
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

  /**
   * 本地数据模式一律可编辑（合集/拖拽/删除仅依赖本地存储）。
   * 云端模式：已带 JWT 即允许编辑（/me 偶发失败时仍可能暂无 currentUser）；桌面壳在未登录时仍可改界面。
   */
  const canEdit = useMemo(
    () =>
      dataMode === "local" ||
      !writeRequiresLogin ||
      Boolean(currentUser) ||
      (writeRequiresLogin && Boolean(getAdminToken())) ||
      isTauri(),
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
  /** 从卡片「⋯」打开提醒日期选择 */
  const [reminderPicker, setReminderPicker] = useState<{
    colId: string;
    cardId: string;
  } | null>(null);
  /** 瀑布流布局（localStorage 持久化） */
  const [masonryLayout, setMasonryLayout] = useState(readMasonryLayoutFromStorage);
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
  /** 与 CSS @media (max-width: 900px) 一致，用于小屏专属控件 */
  const [narrowUi, setNarrowUi] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 900px)").matches
  );
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
    const mq = window.matchMedia("(max-width: 900px)");
    const onMq = () => {
      setNarrowUi(mq.matches);
      if (!mq.matches) {
        setMobileNavOpen(false);
        setMobileCalendarOpen(false);
      }
    };
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) setMobileBrowseEditMode(false);
  }, [mobileNavOpen]);

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
    if (!mobileNavOpen) setUserAccountMenuOpen(false);
  }, [mobileNavOpen]);

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

  /** 云端模式下在首次 remote 就绪前盖住主区（含未登录时等健康检查、登录后等 GET 合集） */
  const showRemoteLoading = useMemo(
    () => authReady && dataMode === "remote" && !remoteLoaded,
    [authReady, dataMode, remoteLoaded]
  );

  const blockMainEdgeSwipe = useMemo(
    () =>
      mobileNavOpen ||
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
      setRemindersViewActive(false);
    }
  }, [calendarDay]);

  useEffect(() => {
    if (trashViewActive) setRemindersViewActive(false);
  }, [trashViewActive]);

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
            quota
              ? "本地存满啦，清掉点缓存或删掉大附件再试～"
              : "本地保存失败惹…"
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

  const toggleMasonryLayout = useCallback(() => {
    setMasonryLayout((v) => {
      const n = !v;
      try {
        localStorage.setItem(MASONRY_LAYOUT_STORAGE_KEY, n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });
  }, []);

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
    (colId: string, cardId: string, isoDate: string | null) => {
      setCollections((prev) =>
        mapCollectionById(prev, colId, (c) => ({
          ...c,
          cards: c.cards.map((cd) => {
            if (cd.id !== cardId) return cd;
            if (isoDate == null || isoDate === "") {
              const { reminderOn: _r, ...rest } = cd;
              return rest;
            }
            return { ...cd, reminderOn: isoDate };
          }),
        }))
      );
      if (dataMode !== "local") {
        void updateCardApi(cardId, {
          reminderOn: isoDate && isoDate.length > 0 ? isoDate : null,
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
            window.alert(
              "同步到云端回收站失败，笔记未删除。请检查网络或登录状态后重试。"
            );
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
    [canEdit, collections, trashStorageKey, dataMode]
  );

  const restoreTrashedEntry = useCallback(
    async (entry: TrashedNoteEntry) => {
      if (!canEdit) return;
      if (!findCollectionById(collections, entry.colId)) {
        setSidebarFlash("原合集不见啦，这条笔记捞不回去惹…");
        return;
      }
      let cardToAppend: NoteCard = entry.card;
      if (dataMode !== "local") {
        const created = await createCardApi(entry.colId, entry.card, {
          insertAtStart: newNotePlacement === "top",
        });
        if (!created) {
          window.alert("恢复笔记失败，请检查网络或权限后重试。");
          return;
        }
        cardToAppend = created;
        const delOk = await deleteMeTrashEntry(entry.trashId);
        if (!delOk) {
          window.alert(
            "笔记已写回合集，但云端回收站记录未清除，刷新后回收站里可能仍显示该条。"
          );
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
    [canEdit, collections, trashStorageKey, dataMode, newNotePlacement]
  );

  const purgeTrashedEntry = useCallback(
    async (trashId: string) => {
      if (!canEdit) return;
      if (
        !window.confirm(
          "真的要永久删掉这条小笔记吗？（回收站记录也会一起消失，回不去那种）"
        )
      ) {
        return;
      }
      if (dataMode !== "local") {
        const ok = await deleteMeTrashEntry(trashId);
        if (!ok) {
          window.alert("从云端回收站删除失败，请稍后重试。");
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
    [canEdit, trashStorageKey, dataMode]
  );

  const emptyTrash = useCallback(async () => {
    if (!canEdit || trashEntries.length === 0) return;
    if (
      !window.confirm(
        `垃圾桶里一共 ${trashEntries.length} 条，要全部清空吗？会永久消失回不来的那种！`
      )
    ) {
      return;
    }
    if (dataMode !== "local") {
      const ok = await clearMeTrash();
      if (!ok) {
        window.alert("清空云端回收站失败，请稍后重试。");
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
  }, [canEdit, trashEntries, trashStorageKey, dataMode]);

  const removeRelatedPair = useCallback(
    (
      srcColId: string,
      srcCardId: string,
      tgtColId: string,
      tgtCardId: string
    ) => {
      setCollections((prev) =>
        removeBidirectionalRelated(
          prev,
          srcColId,
          srcCardId,
          tgtColId,
          tgtCardId
        )
      );
    },
    []
  );

  const addRelatedPair = useCallback(
    (
      srcColId: string,
      srcCardId: string,
      tgtColId: string,
      tgtCardId: string
    ) => {
      setCollections((prev) =>
        addBidirectionalRelated(
          prev,
          srcColId,
          srcCardId,
          tgtColId,
          tgtCardId
        )
      );
    },
    []
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
                  err instanceof Error
                    ? err.message
                    : "存到本地文件夹失败，再试一次？"
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
                  err instanceof Error
                    ? err.message
                    : "内联保存附件失败，可换小文件或改用桌面版～"
                );
              }
            }
          }
          return;
        }
        for (const file of files) {
          const r = await uploadCardMedia(file);
          addMediaItemToCard(
            colId,
            cardId,
            mediaItemFromUploadResult(r)
          );
        }
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "附件上传翻车啦，再试一次？"
        );
      } finally {
        setUploadBusyCardId(null);
      }
    },
    [addMediaItemToCard, dataMode]
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
                  (m.coverUrl ?? "") === (item.coverUrl ?? "")
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
      afterLocalInsert?: () => void
    ): Promise<string | null> => {
      if (!canEdit) return null;
      if (trashViewActive) return null;
      if (remindersViewActive) return null;
      if (calendarDay !== null) return null;
      if (searchQuery.trim().length > 0) return null;
      const targetColId = targetColIdOverride?.trim() || active?.id;
      if (!targetColId) return null;
      const now = new Date();
      const minutesOfDay =
        timeOverride?.minutesOfDay ??
        now.getHours() * 60 + now.getMinutes();
      const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const cardId = `n-${uid}`;
      const day = timeOverride?.addedOn ?? localDateString(now);
      const newCard: NoteCard = {
        id: cardId,
        text: htmlBody,
        minutesOfDay,
        addedOn: day,
      };

      flushSync(() => {
        setCollections((prev) =>
          mapCollectionById(prev, targetColId, (col) => ({
            ...col,
            cards:
              newNotePlacement === "top"
                ? [newCard, ...col.cards]
                : [...col.cards, newCard],
          }))
        );
      });
      afterLocalInsert?.();
      if (dataMode !== "local") {
        const created = await createCardApi(targetColId, newCard, {
          insertAtStart: newNotePlacement === "top",
        });
        if (!created) {
          flushSync(() => {
            setCollections((prev) =>
              mapCollectionById(prev, targetColId, (col) => ({
                ...col,
                cards: col.cards.filter((c) => c.id !== cardId),
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
      remindersViewActive,
      calendarDay,
      active?.id,
      searchQuery,
      dataMode,
      newNotePlacement,
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
        const cardId = await appendNoteCardWithHtml(
          "",
          undefined,
          undefined,
          afterLocal
        );
        if (!cardId) return;
        queueMicrotask(() => {
          document.getElementById(`card-text-${cardId}`)?.focus();
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

  const commitCollectionRename = useCallback(async () => {
    if (!editingCollectionId) return;
    const colId = editingCollectionId;
    const trimmed = draftCollectionName.trim();
    const name = trimmed.length > 0 ? trimmed : "新合集";
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
        window.alert("名称同步到服务器失败，刷新后可能恢复旧名称。");
      }
    }
  }, [editingCollectionId, draftCollectionName, dataMode, canEdit]);

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
      name: "新合集",
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
        window.alert("新建合集失败，请检查网络或登录状态后重试。");
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
    setDraftCollectionName("新合集");
    setEditingCollectionId(id);
  }, [canEdit, dataMode]);

  const addSubCollection = useCallback(
    async (parentId: string) => {
      if (!canEdit) return;
      skipCloseMobileNavOnActiveChangeRef.current = true;
      setTrashViewActive(false);
      setRemindersViewActive(false);
      const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const child: Collection = {
        id,
        name: "新子合集",
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
          window.alert("新建子合集失败，请检查网络或登录状态后重试。");
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
      setDraftCollectionName("新子合集");
      setEditingCollectionId(id);
    },
    [canEdit, dataMode]
  );

  const toggleFavoriteCollection = useCallback(
    (id: string) => {
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
      if (dataMode === "remote") {
        const ok = await deleteCollectionApi(id);
        if (!ok) {
          window.alert("删除合集失败，请检查网络或权限后重试。");
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
    [canEdit, dataMode, favoriteStorageKey]
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
        window.alert("合集说明同步失败，刷新后可能恢复旧内容。");
      }
    }
  }, [editingHintCollectionId, draftCollectionHint, dataMode, canEdit]);

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
    mobileNavOpen && !mobileBrowseEditMode;
  /** 小屏编辑态：整行 draggable 易与滚动冲突，仅右侧三杠发起拖拽 */
  const mobileCollectionDragByHandle =
    mobileNavOpen && mobileBrowseEditMode;

  function renderNoteTimelineCard(card: NoteCard, colId: string) {
    return (
      <NoteTimelineCard
        key={`${colId}-${card.id}`}
        card={card}
        colId={colId}
        masonryLayout={masonryLayout}
        canEdit={canEdit}
        canAttachMedia={canAttachMedia}
        cardMenuId={cardMenuId}
        setCardMenuId={setCardMenuId}
        relatedPanel={relatedPanel}
        setRelatedPanel={setRelatedPanel}
        uploadBusyCardId={uploadBusyCardId}
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
        setReminderPicker={setReminderPicker}
        togglePin={togglePin}
        deleteCard={deleteCard}
        setCardText={setCardText}
        setCardTags={setCardTags}
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
  ]);

  if (!authReady) {
    return (
      <div className="app app--boot" aria-busy="true">
        <div className="app-boot-screen">
          <span className="app-boot-spinner" aria-hidden />
          <p>正在准备…</p>
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
        (mobileNavOpen ? " app--mobile-nav-open" : "") +
        (masonryLayout ? " app--masonry" : "")
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
            <p>正在同步笔记…</p>
          </div>
        </div>
      ) : null}
      {remoteBootSyncing && remoteLoaded && dataMode === "remote" ? (
        <div
          className="app-remote-sync-banner"
          role="status"
          aria-live="polite"
        >
          正在与服务器同步…
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
          {mobileNavOpen ? (
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
                    currentUser || getAdminToken() ? "退出登录" : "登录"
                  }
                  title={
                    currentUser || getAdminToken()
                      ? "下次再见啦～"
                      : "开门登录～"
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
                      ? "完成编辑"
                      : "编辑合集结构"
                  }
                  onClick={() =>
                    setMobileBrowseEditMode((v) => !v)
                  }
                >
                  {mobileBrowseEditMode ? "完成" : "编辑"}
                </button>
                <button
                  type="button"
                  className="sidebar__mobile-browse-action sidebar__mobile-browse-action--emph sidebar__mobile-browse-action--icon"
                  aria-label="新建合集"
                  title="新建合集"
                  onClick={() => addCollection()}
                >
                  <svg
                    className="sidebar__mobile-browse-action__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
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
            {!mobileNavOpen ? (
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
                      title="小伙伴管理台"
                    >
                      用户
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
                      currentUser || getAdminToken() ? "退出登录" : "登录"
                    }
                    title={
                      currentUser || getAdminToken()
                        ? "下次再见啦～"
                        : "开门登录～"
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
              aria-label="关闭菜单"
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

        <div
          className={
            "sidebar__calendar" +
            (allReminderEntries.length === 0
              ? " sidebar__calendar--below-rule-desktop"
              : "")
          }
          aria-label="按日期浏览"
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

        {allReminderEntries.length > 0 ? (
          <div
            className="sidebar__all-reminders"
            aria-label="全部提醒入口"
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
                setRemindersViewActive(true);
                setMobileNavOpen(false);
              }}
            >
              <span className="sidebar__all-reminders-label">全部提醒</span>
              <span className="sidebar__all-reminders-count">
                {allReminderEntries.length}
              </span>
            </button>
          </div>
        ) : null}

        <div className="sidebar__collections">
          <div className="sidebar__favorites">
            <div className="sidebar__section-row">
              <p className="sidebar__section">收藏</p>
            </div>
            {favoriteSidebarEntries.length === 0 ? (
              <p className="sidebar__favorites-empty">
                还没有星标？去主标题旁点那颗黄星星，常逛的合集一键直达～
              </p>
            ) : (
              <ul
                className="sidebar__favorites-list"
                aria-label="收藏的合集"
              >
                {favoriteSidebarEntries.map(({ col, path }) => (
                  <li key={col.id} className="sidebar__favorites-item">
                    <div
                      className={
                        "sidebar__favorites-row" +
                        (col.id === active?.id &&
                        !calendarDay &&
                        !trashViewActive &&
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
                        aria-label="取消收藏"
                        title="取消收藏"
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
            )}
          </div>
          <div className="sidebar__section-row">
            <p className="sidebar__section">合集</p>
            {canEdit && !mobileNavOpen ? (
              <button
                type="button"
                className="sidebar__section-add"
                onClick={addCollection}
                aria-label="新建合集"
              >
                +
              </button>
            ) : null}
          </div>
          <nav className="sidebar__nav" aria-label="合集">
            <CollectionSidebarTree
              collections={collections}
              activeId={active?.id}
              calendarDay={calendarDay}
              trashViewActive={trashViewActive}
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
        </div>

        <div className="sidebar__tags" aria-label="全部标签">
          <div className="sidebar__section-row sidebar__tags-head">
            <p className="sidebar__section">标签</p>
          </div>
          {sidebarTags.length > 0 ? (
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
            <p className="sidebar__tags-empty">
              还没有标签出没，多写几条笔记就会长出来～
            </p>
          )}
          <div className="sidebar__trash" aria-label="垃圾桶">
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
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              <span className="sidebar__trash-label">垃圾桶</span>
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
        className="main"
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
          >
            <button
              type="button"
              className="main__mobile-back"
              aria-label="返回合集列表"
              onClick={() => {
                setSearchBarOpen(false);
                setSearchQuery("");
                setCalendarDay(null);
                setTrashViewActive(false);
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
                  placeholder="搜搜笔记、合集、附件名～"
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
                  aria-label="搜索笔记、附件名、合集名"
                />
                <button
                  type="button"
                  className="main__search-clear"
                  aria-label={
                    searchActive ? "清除搜索" : "收起搜索"
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
              aria-label={mobileNavOpen ? "关闭菜单" : "打开菜单"}
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
                  ? "搜索"
                  : trashViewActive
                    ? "垃圾桶"
                    : remindersViewActive
                      ? "全部提醒"
                      : calendarDay
                        ? formatChineseDayTitle(calendarDay)
                        : active?.name ?? "未选择合集"}
              </h1>
              {active &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive &&
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
                      ? "取消收藏此合集"
                      : "收藏此合集"
                  }
                  aria-pressed={favoriteCollectionIds.has(active.id)}
                  title={
                    favoriteCollectionIds.has(active.id)
                      ? "取消收藏"
                      : "收藏"
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
                  aria-label="打开搜索"
                  onClick={() => setSearchBarOpen(true)}
                >
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="main__header-icon-btn main__header-icon-btn--masonry"
                aria-pressed={masonryLayout}
                aria-label={
                  masonryLayout
                    ? "切换为列表布局"
                    : "切换为瀑布流布局"
                }
                title={masonryLayout ? "列表布局" : "瀑布流"}
                onClick={toggleMasonryLayout}
              >
                {masonryLayout ? (
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {/* 单列列表：点击切换回列表 */}
                    <path
                      d="M4 7.5h16M4 12h16M4 16.5h10"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {/* 两列错落砖块：瀑布流 */}
                    <rect x="3" y="5" width="7.5" height="8" rx="1.5" />
                    <rect x="3" y="15" width="7.5" height="5" rx="1.5" />
                    <rect x="13.5" y="4" width="7.5" height="6" rx="1.5" />
                    <rect x="13.5" y="12" width="7.5" height="8" rx="1.5" />
                  </svg>
                )}
              </button>
              {canEdit &&
              trashViewActive &&
              !searchActive &&
              trashEntries.length > 0 ? (
                <button
                  type="button"
                  className="main__header-icon-btn main__header-icon-btn--danger-text"
                  aria-label="清空垃圾桶"
                  title="清空垃圾桶"
                  onClick={emptyTrash}
                >
                  <span className="main__header-trash-empty-label">
                    清空
                  </span>
                </button>
              ) : null}
              {canEdit &&
              active &&
              !calendarDay &&
              !searchActive &&
              !trashViewActive &&
              !remindersViewActive ? (
                <button
                  type="button"
                  className="main__header-icon-btn"
                  aria-label="新建小笔记"
                  onClick={() => addSmallNote()}
                >
                  <svg
                    className="main__header-icon-btn__svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
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
                  aria-label="合集说明"
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
                      : DEFAULT_COLLECTION_HINT) +
                    (canEdit ? " · 双击改成自己的话 ✨" : "")
                  }
                  onDoubleClick={
                    canEdit
                      ? () => {
                          const raw = active.hint?.trim();
                          setDraftCollectionHint(
                            raw
                              ? active.hint!
                              : DEFAULT_COLLECTION_HINT
                          );
                          setEditingHintCollectionId(active.id);
                        }
                      : undefined
                  }
                >
                  {active.hint?.trim()
                    ? active.hint
                    : DEFAULT_COLLECTION_HINT}
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
              ? "搜索结果"
              : trashViewActive
                ? "垃圾桶"
                : remindersViewActive
                  ? "全部提醒"
                  : "mikujar 时间线"
          }
        >
          {searchActive ? (
            !searchHasResults ? (
              <div className="timeline__empty">
                唔…「{searchTrim}」什么也没搜到，换个词或换个姿势试试？
              </div>
            ) : (
              <>
                {searchCollectionMatches.length > 0 ? (
                  <section
                    className="search-section"
                    aria-label="名称匹配的合集"
                  >
                    <h2 className="timeline__pin-heading">合集</h2>
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
                            打开
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
                    aria-label="匹配的笔记"
                  >
                    <h2 className="timeline__pin-heading">笔记</h2>
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
                            打开合集
                          </button>
                        </div>
                        <ul className="cards">
                          {cards.map((card) =>
                            renderNoteTimelineCard(card, col.id)
                          )}
                        </ul>
                      </div>
                    ))}
                  </section>
                ) : null}
              </>
            )
          ) : trashViewActive ? (
            trashEntries.length === 0 ? (
              <div className="timeline__empty trash-empty">
                {canEdit
                  ? "回收站空空如也～ 删掉的小卡片会乖乖躺在这，点「⋯」能捞回来或彻底粉碎。"
                  : "暂时没有已删除的笔记哟。"}
              </div>
            ) : (
              <ul className="cards" aria-label="已删除的笔记">
                {trashEntries.map((entry) => (
                  <TrashNoteCardRow
                    key={entry.trashId}
                    entry={entry}
                    canEdit={canEdit}
                    masonryLayout={masonryLayout}
                    cardMenuId={cardMenuId}
                    setCardMenuId={setCardMenuId}
                    restoreTrashedEntry={restoreTrashedEntry}
                    purgeTrashedEntry={purgeTrashedEntry}
                  />
                ))}
              </ul>
            )
          ) : remindersViewActive ? (
            <AllRemindersView
              entries={allReminderEntries}
              renderCard={(colId, card) =>
                renderNoteTimelineCard(card, colId)
              }
            />
          ) : calendarDay ? (
            dayReminderEntries.length === 0 &&
            dayPinned.length === 0 &&
            dayRestCards.length === 0 ? (
              <div className="timeline__empty">
                {canEdit
                  ? "这一天还没有笔记或提醒～ 带「日历日期」的笔记会按合集出现在下面；在卡片「⋯」里可设置提醒，提醒日会在月历格右上角显示角标。"
                  : "这一天没有可以展示的笔记～"}
              </div>
            ) : (
              <>
                {dayReminderEntries.length > 0 && (
                  <section
                    className="timeline__pin-section timeline__reminder-section"
                    aria-label="当日提醒"
                  >
                    <h2 className="timeline__pin-heading">提醒</h2>
                    <ul className="cards">
                      {dayReminderEntries.map(({ card }) =>
                        renderNoteTimelineCard(
                          card,
                          cardToColIdForDay.get(card.id) ?? ""
                        )
                      )}
                    </ul>
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
                    aria-label="当日置顶"
                  >
                    <h2 className="timeline__pin-heading">置顶</h2>
                    <ul className="cards">
                      {dayPinned.map((card) =>
                        renderNoteTimelineCard(
                          card,
                          cardToColIdForDay.get(card.id) ?? ""
                        )
                      )}
                    </ul>
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
                    <ul className="cards">
                      {dayColCards.map((card) =>
                        renderNoteTimelineCard(card, col.id)
                      )}
                    </ul>
                  </div>
                ))}
              </>
            )
          ) : listEmpty ? (
            <div className="timeline__empty">
              {timelineEmpty
                ? canEdit
                  ? "这里还光溜溜的！点顶栏「+」或底下罐子/「新建小笔记」，新卡会进当前合集并打上今天的日历～"
                  : "这个合集还没有笔记～"
                : "暂时没有任何小笔记～"}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <section
                  className="timeline__pin-section"
                  aria-label="置顶笔记"
                >
                  <h2 className="timeline__pin-heading">置顶</h2>
                  <ul className="cards">
                    {pinned.map((card) =>
                      renderNoteTimelineCard(card, active!.id)
                    )}
                  </ul>
                </section>
              )}
              {pinned.length > 0 && rest.length > 0 && (
                <div
                  className="timeline__pin-divider"
                  role="separator"
                  aria-hidden
                />
              )}
              <ul className="cards">
                {rest.map((card) => renderNoteTimelineCard(card, active!.id))}
              </ul>
            </>
          )}
          {canEdit &&
          active &&
          !calendarDay &&
          !searchActive &&
          !trashViewActive &&
          !remindersViewActive ? (
            <div className="timeline__add-bottom">
              <button
                type="button"
                className="timeline__add-bottom-btn"
                aria-label="新建小笔记"
                onClick={() => addSmallNote()}
              >
                ＋ 新建小笔记
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
      !mobileNavOpen &&
      !mobileCalendarOpen &&
      !remindersViewActive ? (
        <button
          type="button"
          className="main__scroll-to-bottom"
          aria-label="跳转到时间线底部"
          title="到底部"
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
      <nav className="mobile-dock" aria-label="底部快捷操作">
        <button
          type="button"
          className="mobile-dock__btn mobile-dock__btn--icon"
          aria-label={mobileCalendarOpen ? "关闭日历" : "打开日历"}
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
            strokeWidth="2"
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
            remindersViewActive ? "关闭全部提醒" : "全部提醒"
          }
          title="全部提醒"
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
            strokeWidth="2"
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
            calendarDay !== null || remindersViewActive
              ? "回到合集"
              : writeRequiresLogin && !getAdminToken() && !isTauri()
                ? "先登录再写笔记"
                : "新建小笔记"
          }
          title={
            calendarDay !== null
              ? "退出按日浏览，回到当前合集"
              : remindersViewActive
                ? "关闭全部提醒，回到当前合集"
                : writeRequiresLogin && !getAdminToken() && !isTauri()
                  ? "先登录再开罐写笔记～"
                  : "新建小笔记"
          }
          disabled={
            calendarDay !== null || remindersViewActive
              ? false
              : writeRequiresLogin &&
                  !getAdminToken() &&
                  !isTauri()
                ? false
                : trashViewActive ||
                  searchQuery.trim().length > 0 ||
                  !active ||
                  !canEdit
          }
          onClick={() => {
            if (remindersViewActive) {
              setRemindersViewActive(false);
              requestAnimationFrame(() => {
                timelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              });
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
              active &&
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
          aria-label="搜索"
          title="搜索"
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
            strokeWidth="2"
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
                aria-label="关闭日历"
                onClick={() => setMobileCalendarOpen(false)}
              />
              <div
                className="mobile-cal-popup__sheet"
                role="dialog"
                aria-modal="true"
                aria-label="按日期浏览"
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
      <UserAdminModal
        open={userAdmin.userAdminOpen && isAdmin}
        onClose={() => userAdmin.setUserAdminOpen(false)}
        adminUsersErr={userAdmin.adminUsersErr}
        userAdminFormErr={userAdmin.userAdminFormErr}
        newUserUsername={userAdmin.newUserUsername}
        setNewUserUsername={userAdmin.setNewUserUsername}
        newUserPassword={userAdmin.newUserPassword}
        setNewUserPassword={userAdmin.setNewUserPassword}
        newUserDisplayName={userAdmin.newUserDisplayName}
        setNewUserDisplayName={userAdmin.setNewUserDisplayName}
        newUserRole={userAdmin.newUserRole}
        setNewUserRole={userAdmin.setNewUserRole}
        newUserBusy={userAdmin.newUserBusy}
        submitNewUser={userAdmin.submitNewUser}
        adminUsers={userAdmin.adminUsers}
        adminUsersLoading={userAdmin.adminUsersLoading}
        rowBusyId={userAdmin.rowBusyId}
        pwdResetByUser={userAdmin.pwdResetByUser}
        setPwdResetByUser={userAdmin.setPwdResetByUser}
        onRoleChange={userAdmin.onRoleChange}
        applyPasswordReset={userAdmin.applyPasswordReset}
        onDeleteUser={userAdmin.onDeleteUser}
      />
      {currentUser ? (
        <UserProfileModal
          open={userProfileModalOpen}
          onClose={() => setUserProfileModalOpen(false)}
          currentUser={currentUser}
          mediaUploadMode={mediaUploadMode}
          dataMode={dataMode}
          onAfterSave={refreshMe}
          onFlash={setSidebarFlash}
          setSaving={setProfileSaveBusy}
        />
      ) : null}
      {currentUser ? (
        <NoteSettingsModal
          open={userNoteSettingsOpen}
          onClose={() => setUserNoteSettingsOpen(false)}
          newNotePlacement={newNotePlacement}
          setNewNotePlacement={setNewNotePlacement}
          dataMode={dataMode}
          setDataMode={setDataMode}
        />
      ) : null}
      {currentUser ? (
        <DataStatsModal
          open={userDataStatsOpen}
          onClose={() => setUserDataStatsOpen(false)}
          collections={collections}
        />
      ) : null}
      {detailCardLive ? (
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
        />
      ) : null}
      <ReminderPickerModal
        open={reminderPicker !== null}
        collections={collections}
        colId={reminderPicker?.colId ?? ""}
        cardId={reminderPicker?.cardId ?? ""}
        onClose={() => setReminderPicker(null)}
        onSave={(iso) => {
          if (!reminderPicker) return;
          commitCardReminder(
            reminderPicker.colId,
            reminderPicker.cardId,
            iso
          );
        }}
        onClear={() => {
          if (!reminderPicker) return;
          commitCardReminder(
            reminderPicker.colId,
            reminderPicker.cardId,
            null
          );
        }}
      />
    </div>
  );
}
