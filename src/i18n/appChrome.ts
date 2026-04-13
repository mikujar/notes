import type { LoginUiLang } from "../auth/loginUiI18n";

export type AppChrome = {
  defaultCollectionHint: string;
  newCollectionName: string;
  newSubCollectionName: string;
  syncWelcomeSeedFail: string;
  syncLoadFail: string;
  syncOffline: string;
  errLocalQuota: string;
  errLocalSave: string;
  errTrashMove: string;
  errTrashRestoreOrigin: string;
  errTrashRestore: string;
  errTrashRestoreTag: string;
  confirmTrashDelete: string;
  errTrashDeleteOne: string;
  errTrashEmpty: string;
  confirmEmptyTrash: (n: number) => string;
  errLocalFolder: string;
  errBrowserBlob: string;
  errUpload: string;
  errRenameSync: string;
  errCreateCol: string;
  errCreateSub: string;
  errDeleteCol: string;
  errHintSave: string;
  accountMenu: string;
  restoringSession: string;
  logout: string;
  login: string;
  logoutTitle: string;
  loginTitle: string;
  doneEditStructure: string;
  editStructure: string;
  done: string;
  edit: string;
  newCollection: string;
  adminTitle: string;
  closeMenu: string;
  openMenu: string;
  browseByDate: string;
  remindersEntry: string;
  favoriteCols: string;
  unfavoriteAria: string;
  unfavoriteTitle: string;
  newCollectionAria: string;
  sidebarNav: string;
  allTags: string;
  trashAria: string;
  backToList: string;
  searchPlaceholder: string;
  searchAria: string;
  searchClear: string;
  searchCollapse: string;
  titleSearch: string;
  titleTrash: string;
  titleReminders: string;
  titleNoCollection: string;
  unfavoriteThis: string;
  favoriteThis: string;
  unfavoriteShort: string;
  favoriteShort: string;
  openSearchAria: string;
  /** 顶栏列数步进器 */
  masonryColumnsGroupAria: string;
  masonryCol1Title: string;
  /** 固定 N 列，{n} 为数字 */
  masonryColFixedTitle: string;
  masonryColumnDecAria: string;
  masonryColumnIncAria: string;
  /** 仅 1/2 列两种状态时：点击切换为双列 */
  masonryColumnBinaryTapFor2: string;
  /** 仅 1/2 列两种状态时：点击切换为单列 */
  masonryColumnBinaryTapFor1: string;
  emptyTrashAria: string;
  emptyTrashTitle: string;
  newNoteAria: string;
  collectionHintAria: string;
  resultsTitle: string;
  matchCollectionsAria: string;
  matchNotesAria: string;
  trashEmptyRich: string;
  trashEmptyPlain: string;
  deletedNotesAria: string;
  dayEmptyReminder: string;
  dayEmptyPlain: string;
  dayRemindersAria: string;
  dayPinnedAria: string;
  emptyNewUser: string;
  emptyCollection: string;
  emptyGlobal: string;
  pinnedNotesAria: string;
  newNoteBottomAria: string;
  scrollBottomAria: string;
  scrollBottomTitle: string;
  mobileDockAria: string;
  dockCalendarOpen: string;
  dockCalendarClose: string;
  remindersToggle: string;
  remindersTitle: string;
  dockRemindersOn: string;
  dockRemindersOff: string;
  fabBack: string;
  fabLogin: string;
  fabNewNote: string;
  fabTitleCalendar: string;
  fabTitleReminders: string;
  fabTitleLogin: string;
  fabTitleNewNote: string;
  searchDockAria: string;
  searchDockTitle: string;
  calendarCloseAria: string;
  calendarBrowseAria: string;
  profileRemoteOnly: string;
  menuProfile: string;
  menuNoteSettings: string;
  menuDataStats: string;
  sidebarFavorites: string;
  sidebarCollections: string;
  sidebarTags: string;
  favoritesEmpty: string;
  tagsEmpty: string;
  adminUsersShort: string;
  loading: string;
  loadingRemote: string;
  syncing: string;
  searchNoHit: (q: string) => string;
  timelineBrand: string;
  headingCollections: string;
  headingNotes: string;
  headingReminders: string;
  headingPinned: string;
  openBtn: string;
  openCollectionBtn: string;
  hintSuffixEdit: string;
  newNotePlus: string;
  clearTrashLabel: string;
  /** 主区时间线下拉刷新 */
  pullRefreshGuide: string;
  pullRefreshRelease: string;
  pullRefreshRunning: string;
};

const zh: AppChrome = {
  defaultCollectionHint:
    "欢迎光临 mikujar「未来罐」～ 一条笔记一件小事，按一天里的时刻慢慢堆满！左侧合集随便切；这段灰灰的字双击一下，就能换成你自己的开场白 ✨",
  newCollectionName: "新合集",
  newSubCollectionName: "新子合集",
  syncWelcomeSeedFail:
    "欢迎礼包准备好啦，但第一次同步绊了一下…等等再试就好～",
  syncLoadFail: "笔记加载摔了一跤… 看看网络或重新登录试试？",
  syncOffline: "跟罐子连不上线喵～看看网络或稍后再戳进来？",
  errLocalQuota: "本地存满啦，清掉点缓存或删掉大附件再试～",
  errLocalSave: "本地保存失败惹…",
  errTrashMove: "丢进回收站时绊倒啦，笔记还在原位…换个网络或确认登录后再试？",
  errTrashRestoreOrigin: "原合集不见啦，这条笔记捞不回去惹…",
  errTrashRestore: "笔记捞回来时卡住了…看看网络或再试一次？",
  errTrashRestoreTag:
    "笔记已经回家啦，但回收站标签可能还没撕干净…刷新一下就好～",
  confirmTrashDelete:
    "真的要永久删掉这条小笔记吗？（回收站记录也会一起消失，回不去那种）",
  errTrashDeleteOne: "这条从回收站删不掉耶…等等再试？",
  errTrashEmpty: "垃圾桶倒不干净…等等再清空一次？",
  confirmEmptyTrash: (n: number) =>
    `垃圾桶里一共 ${n} 条，要全部清空吗？会永久消失回不来的那种！`,
  errLocalFolder: "存到本地文件夹失败，再试一次？",
  errBrowserBlob:
    "浏览器怀里塞不下这个附件…换张小一点的或用桌面版更稳喔～",
  errUpload: "附件上传翻车啦，再试一次？",
  errRenameSync: "名字没同步上…刷新一下可能变回旧的喔～",
  errCreateCol: "新合集没建成功…看看网络或登录后再试？",
  errCreateSub: "子合集没塞进去…网络或登录再确认下？",
  errDeleteCol: "合集删不掉耶…等等再试或检查一下权限？",
  errHintSave: "说明没保存上…刷新可能变回上一版喔～",
  accountMenu: "账户菜单",
  restoringSession: "恢复会话…",
  logout: "退出登录",
  login: "登录",
  logoutTitle: "下次再见啦～",
  loginTitle: "开门登录～",
  doneEditStructure: "完成编辑",
  editStructure: "编辑合集结构",
  done: "完成",
  edit: "编辑",
  newCollection: "新建合集",
  adminTitle: "小伙伴管理台",
  closeMenu: "关闭菜单",
  openMenu: "打开菜单",
  browseByDate: "按日期浏览",
  remindersEntry: "全部提醒入口",
  favoriteCols: "收藏的合集",
  unfavoriteAria: "取消收藏",
  unfavoriteTitle: "取消收藏",
  newCollectionAria: "新建合集",
  sidebarNav: "合集",
  allTags: "全部标签",
  trashAria: "垃圾桶",
  backToList: "返回合集列表",
  searchPlaceholder: "搜搜笔记、合集、附件名～",
  searchAria: "搜索笔记、附件名、合集名",
  searchClear: "清除搜索",
  searchCollapse: "收起搜索",
  titleSearch: "搜索",
  titleTrash: "垃圾桶",
  titleReminders: "全部提醒",
  titleNoCollection: "未选择合集",
  unfavoriteThis: "取消收藏此合集",
  favoriteThis: "收藏此合集",
  unfavoriteShort: "取消收藏",
  favoriteShort: "收藏",
  openSearchAria: "打开搜索",
  masonryColumnsGroupAria: "时间线列数",
  masonryCol1Title: "单列列表",
  masonryColFixedTitle: "固定 {n} 列",
  masonryColumnDecAria: "减少列数",
  masonryColumnIncAria: "增加列数",
  masonryColumnBinaryTapFor2: "当前单列，点击改为双列瀑布",
  masonryColumnBinaryTapFor1: "当前双列，点击改为单列列表",
  emptyTrashAria: "清空垃圾桶",
  emptyTrashTitle: "清空垃圾桶",
  newNoteAria: "新建小笔记",
  collectionHintAria: "合集说明",
  resultsTitle: "搜索结果",
  matchCollectionsAria: "名称匹配的合集",
  matchNotesAria: "匹配的笔记",
  trashEmptyRich:
    "回收站空空如也～ 删掉的小卡片会乖乖躺在这，点「⋯」能捞回来或彻底粉碎。",
  trashEmptyPlain: "暂时没有已删除的笔记哟。",
  deletedNotesAria: "已删除的笔记",
  dayEmptyReminder:
    "这一天还没有笔记或提醒～ 带「日历日期」的笔记会按合集出现在下面；在卡片「⋯」里可设置提醒，提醒日会在月历格右上角显示角标。",
  dayEmptyPlain: "这一天没有可以展示的笔记～",
  dayRemindersAria: "当日提醒",
  dayPinnedAria: "当日置顶",
  emptyNewUser:
    "这里还光溜溜的！点顶栏「+」或底下罐子/「新建小笔记」，新卡会进当前合集并打上今天的日历～",
  emptyCollection: "这个合集还没有笔记～",
  emptyGlobal: "暂时没有任何小笔记～",
  pinnedNotesAria: "置顶笔记",
  newNoteBottomAria: "新建小笔记",
  scrollBottomAria: "跳转到时间线底部",
  scrollBottomTitle: "到底部",
  mobileDockAria: "底部快捷操作",
  dockCalendarOpen: "打开日历",
  dockCalendarClose: "关闭日历",
  remindersToggle: "全部提醒",
  remindersTitle: "全部提醒",
  dockRemindersOn: "关闭全部提醒",
  dockRemindersOff: "全部提醒",
  fabBack: "回到合集",
  fabLogin: "先登录再写笔记",
  fabNewNote: "新建小笔记",
  fabTitleCalendar: "退出按日浏览，回到当前合集",
  fabTitleReminders: "关闭全部提醒，回到当前合集",
  fabTitleLogin: "先登录再开罐写笔记～",
  fabTitleNewNote: "新建小笔记",
  searchDockAria: "搜索",
  searchDockTitle: "搜索",
  calendarCloseAria: "关闭日历",
  calendarBrowseAria: "按日期浏览",
  profileRemoteOnly: "先切到云端同步，再来开个人中心喔～",
  menuProfile: "个人中心",
  menuNoteSettings: "笔记设置",
  menuDataStats: "数据统计",
  sidebarFavorites: "收藏",
  sidebarCollections: "合集",
  sidebarTags: "标签",
  favoritesEmpty:
    "还没有星标？去主标题旁点那颗黄星星，常逛的合集一键直达～",
  tagsEmpty: "还没有标签出没，多写几条笔记就会长出来～",
  adminUsersShort: "用户",
  loading: "正在加载…",
  loadingRemote: "正在把笔记接进罐子…",
  syncing: "正在悄悄同步中…",
  searchNoHit: (q: string) =>
    `唔…「${q}」什么也没搜到，换个词或换个姿势试试？`,
  timelineBrand: "mikujar 时间线",
  headingCollections: "合集",
  headingNotes: "笔记",
  headingReminders: "提醒",
  headingPinned: "置顶",
  openBtn: "打开",
  openCollectionBtn: "打开合集",
  hintSuffixEdit: " · 双击改成自己的话 ✨",
  newNotePlus: "＋ 新建小笔记",
  clearTrashLabel: "清空",
  pullRefreshGuide: "下拉刷新",
  pullRefreshRelease: "松开以刷新",
  pullRefreshRunning: "正在刷新…",
};

const en: AppChrome = {
  defaultCollectionHint:
    "Welcome to mikujar — one note, one little thing, stacked through the day. Switch collections on the left; double‑click this gray line for your own intro ✨",
  newCollectionName: "New collection",
  newSubCollectionName: "New sub‑folder",
  syncWelcomeSeedFail:
    "Your starter pack is ready, but the first sync stumbled — try again in a moment.",
  syncLoadFail: "Couldn’t load notes. Check the network or sign in again.",
  syncOffline: "Can’t reach the server. Check the network or try again later.",
  errLocalQuota:
    "Local storage is full — free some cache or remove large attachments.",
  errLocalSave: "Couldn’t save locally.",
  errTrashMove:
    "Moving to trash failed; the note may still be in place. Check the network or sign in.",
  errTrashRestoreOrigin: "The original collection is gone — this note can’t be restored.",
  errTrashRestore: "Couldn’t restore the note. Check the network or retry.",
  errTrashRestoreTag:
    "Note restored, but trash labels may be stale — refresh if needed.",
  confirmTrashDelete:
    "Permanently delete this note? Trash history will be removed too.",
  errTrashDeleteOne: "Couldn’t delete from trash. Try again?",
  errTrashEmpty: "Couldn’t empty trash. Try again?",
  confirmEmptyTrash: (n: number) =>
    `Empty all ${n} item(s) in trash? This cannot be undone.`,
  errLocalFolder: "Couldn’t save to the local folder. Retry?",
  errBrowserBlob: "File too large for the browser — use a smaller file or the desktop app.",
  errUpload: "Upload failed. Try again?",
  errRenameSync: "Name didn’t sync — refresh may show the old one.",
  errCreateCol: "Couldn’t create collection. Check network or sign in.",
  errCreateSub: "Couldn’t add sub‑folder. Check network or sign in.",
  errDeleteCol: "Couldn’t delete collection. Retry or check permissions?",
  errHintSave: "Hint didn’t save — refresh may revert.",
  accountMenu: "Account menu",
  restoringSession: "Restoring session…",
  logout: "Log out",
  login: "Log in",
  logoutTitle: "See you next time",
  loginTitle: "Sign in",
  doneEditStructure: "Done",
  editStructure: "Edit folders",
  done: "Done",
  edit: "Edit",
  newCollection: "New collection",
  adminTitle: "User admin",
  closeMenu: "Close menu",
  openMenu: "Open menu",
  browseByDate: "Browse by date",
  remindersEntry: "All reminders",
  favoriteCols: "Starred collections",
  unfavoriteAria: "Remove from starred",
  unfavoriteTitle: "Remove from starred",
  newCollectionAria: "New collection",
  sidebarNav: "Collections",
  allTags: "All tags",
  trashAria: "Trash",
  backToList: "Back to collections",
  searchPlaceholder: "Search notes, collections, attachments…",
  searchAria: "Search notes, attachments, collections",
  searchClear: "Clear search",
  searchCollapse: "Collapse search",
  titleSearch: "Search",
  titleTrash: "Trash",
  titleReminders: "Reminders",
  titleNoCollection: "No collection selected",
  unfavoriteThis: "Remove star from this collection",
  favoriteThis: "Star this collection",
  unfavoriteShort: "Unstar",
  favoriteShort: "Star",
  openSearchAria: "Open search",
  masonryColumnsGroupAria: "Timeline columns",
  masonryCol1Title: "Single column list",
  masonryColFixedTitle: "Fixed {n} columns",
  masonryColumnDecAria: "Fewer columns",
  masonryColumnIncAria: "More columns",
  masonryColumnBinaryTapFor2: "Single column — tap for two columns",
  masonryColumnBinaryTapFor1: "Two columns — tap for single column",
  emptyTrashAria: "Empty trash",
  emptyTrashTitle: "Empty trash",
  newNoteAria: "New note",
  collectionHintAria: "Collection hint",
  resultsTitle: "Results",
  matchCollectionsAria: "Matching collections",
  matchNotesAria: "Matching notes",
  trashEmptyRich:
    "Trash is empty. Deleted cards sit here — use “⋯” to restore or delete forever.",
  trashEmptyPlain: "No deleted notes.",
  deletedNotesAria: "Deleted notes",
  dayEmptyReminder:
    "No notes or reminders this day. Notes with a calendar date appear below; set reminders from “⋯” on a card.",
  dayEmptyPlain: "Nothing to show for this day.",
  dayRemindersAria: "Reminders this day",
  dayPinnedAria: "Pinned this day",
  emptyNewUser:
    "Nothing here yet. Tap “+” in the header or the jar / “New note” — new cards go to the current collection with today’s date.",
  emptyCollection: "This collection has no notes yet.",
  emptyGlobal: "No notes yet.",
  pinnedNotesAria: "Pinned notes",
  newNoteBottomAria: "New note",
  scrollBottomAria: "Jump to bottom of timeline",
  scrollBottomTitle: "Bottom",
  mobileDockAria: "Quick actions",
  dockCalendarOpen: "Open calendar",
  dockCalendarClose: "Close calendar",
  remindersToggle: "All reminders",
  remindersTitle: "All reminders",
  dockRemindersOn: "Close reminders",
  dockRemindersOff: "All reminders",
  fabBack: "Back to collection",
  fabLogin: "Sign in to write",
  fabNewNote: "New note",
  fabTitleCalendar: "Leave day view, back to collection",
  fabTitleReminders: "Close reminders, back to collection",
  fabTitleLogin: "Sign in to add notes",
  fabTitleNewNote: "New note",
  searchDockAria: "Search",
  searchDockTitle: "Search",
  calendarCloseAria: "Close calendar",
  calendarBrowseAria: "Browse by date",
  profileRemoteOnly: "Switch to cloud sync to open profile.",
  menuProfile: "Profile",
  menuNoteSettings: "Note settings",
  menuDataStats: "Usage stats",
  sidebarFavorites: "Starred",
  sidebarCollections: "Collections",
  sidebarTags: "Tags",
  favoritesEmpty:
    "No starred collections yet — tap the star in the header to pin favorites.",
  tagsEmpty: "No tags yet — they appear as you add notes.",
  adminUsersShort: "Admin",
  loading: "Loading…",
  loadingRemote: "Loading your notes…",
  syncing: "Syncing…",
  searchNoHit: (q: string) =>
    `No results for “${q}”. Try different keywords.`,
  timelineBrand: "mikujar timeline",
  headingCollections: "Collections",
  headingNotes: "Notes",
  headingReminders: "Reminders",
  headingPinned: "Pinned",
  openBtn: "Open",
  openCollectionBtn: "Open collection",
  hintSuffixEdit: " · Double‑click to edit ✨",
  newNotePlus: "＋ New note",
  clearTrashLabel: "Empty",
  pullRefreshGuide: "Pull down to refresh",
  pullRefreshRelease: "Release to refresh",
  pullRefreshRunning: "Refreshing…",
};

export function getAppChrome(lang: LoginUiLang): AppChrome {
  return lang === "en" ? en : zh;
}
