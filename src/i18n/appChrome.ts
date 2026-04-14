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
  allNotesEntry: string;
  titleAllNotes: string;
  /** 内部「未归类」合集展示名（侧栏不显示该合集） */
  looseNotesCollectionName: string;
  connectionsEntry: string;
  titleConnections: string;
  connectionsEmpty: string;
  connectionsIntro: string;
  connectionsOpenTarget: string;
  connectionsBoardHint: string;
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
  /** 我的待办：新建任务（带提醒的空卡片） */
  newReminderTaskAria: string;
  newReminderTaskPlus: string;
  fabTitleNewReminderTask: string;
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
  /** 笔记设置内：打开苹果备忘录导入 */
  importAppleNotesFromSettings: string;
  /** 导入时新建的顶层合集名称（下挂导出的笔记本子合集） */
  importAppleNotesRootCollectionName: string;
  importAppleNotesTitle: string;
  importAppleNotesHint: string;
  importAppleNotesTargetLabel: (collectionLabel: string) => string;
  importAppleNotesPickFolder: string;
  /** 无文件夹 API 时（手机浏览器等）：上传 zip */
  importAppleNotesPickZip: string;
  importAppleNotesPickTextFiles: string;
  importAppleNotesPreview: (n: number) => string;
  /** 选择文件夹 / zip 后解析中 */
  importAppleNotesParsing: string;
  /** 导入执行中：当前步 / 总步 */
  importAppleNotesProgressLabel: (current: number, total: number) => string;
  importAppleNotesImportBtn: string;
  importAppleNotesImporting: string;
  importAppleNotesDone: (n: number) => string;
  importAppleNotesErrNone: string;
  importAppleNotesParseErr: string;
  importAppleNotesRunErr: string;
  importAppleNotesBlockedNoEdit: string;
  importAppleNotesBlockedTrash: string;
  importAppleNotesBlockedConnections: string;
  importAppleNotesBlockedReminders: string;
  importAppleNotesBlockedCalendar: string;
  importAppleNotesBlockedSearch: string;
  importAppleNotesBlockedNoCollection: string;
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
  browseByDate: "日历",
  allNotesEntry: "全部笔记",
  titleAllNotes: "全部笔记",
  looseNotesCollectionName: "未归类笔记",
  connectionsEntry: "笔记连接",
  titleConnections: "笔记连接",
  connectionsEmpty: "还没有笔记之间的连接～在卡片「⋯」里点「相关笔记」可建立连接。",
  connectionsIntro: "笔记之间的成对关联（A↔B 双向只计 1 条）。",
  connectionsOpenTarget: "打开目标笔记",
  connectionsBoardHint: "空白处拖曳平移画布，滚轮缩放。",
  remindersEntry: "我的待办入口",
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
  titleReminders: "我的待办",
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
  newReminderTaskAria: "新建待办任务",
  newReminderTaskPlus: "＋ 新建待办",
  fabTitleNewReminderTask: "新建一条带今日提醒的笔记",
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
  dayRemindersAria: "当日我的待办",
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
  remindersToggle: "我的待办",
  remindersTitle: "我的待办",
  dockRemindersOn: "关闭我的待办",
  dockRemindersOff: "我的待办",
  fabBack: "回到合集",
  fabLogin: "先登录再写笔记",
  fabNewNote: "新建小笔记",
  fabTitleCalendar: "退出按日浏览，回到当前合集",
  fabTitleReminders: "关闭我的待办，回到当前合集",
  fabTitleLogin: "先登录再开罐写笔记～",
  fabTitleNewNote: "新建小笔记",
  searchDockAria: "搜索",
  searchDockTitle: "搜索",
  calendarCloseAria: "关闭日历",
  calendarBrowseAria: "日历",
  profileRemoteOnly: "先切到云端同步，再来开个人中心喔～",
  menuProfile: "个人中心",
  menuNoteSettings: "笔记设置",
  menuDataStats: "数据统计",
  importAppleNotesFromSettings: "从苹果备忘录导出导入…",
  importAppleNotesRootCollectionName: "Apple 备忘录",
  importAppleNotesTitle: "苹果备忘录导出 → 导入",
  importAppleNotesHint:
    "系统自带备忘录没有「一键全部导出」开放接口；可在 Mac 上单条用「文件 → 导出为…」（如 Markdown），或用第三方工具批量导出为文件夹。此处支持两种目录结构：① 选择整个导出文件夹——每条笔记一个子文件夹，内含正文（.txt / .md / .html）与同目录附件；② 多选若干 .md / .txt 文件——每条文件一张卡片。Markdown 里 data URL 内嵌图会拆成附件。若文件夹名或文件名里带有日期/时间（如 2024-03-15、14-30、202403151430 等），会写入卡片的日历日与时刻。若你为 Mac「导出为 HTML」得到多个「YYYY-MM-DD HHMM 标题.html」与同前缀的「…(Attachments)」附件夹，会按该前缀自动合并为一条笔记并带上附件。手机或部分浏览器没有「选文件夹」时，请先在电脑上把导出目录打成 zip 再选「ZIP 压缩包」上传。若导出里带有 iCloud 下的多个笔记本子文件夹，会新建顶层「Apple 备忘录」合集并把各子文件夹恢复为子合集。",
  importAppleNotesTargetLabel: (collectionLabel: string) =>
    `将导入到当前视图：${collectionLabel}`,
  importAppleNotesPickFolder: "选择导出文件夹（桌面浏览器）",
  importAppleNotesPickZip: "选择 ZIP 压缩包（任意浏览器 / 手机）",
  importAppleNotesPickTextFiles: "仅选择文本文件（可多选）",
  importAppleNotesPreview: (n: number) => `已解析 ${n} 条，可点击下方导入。`,
  importAppleNotesParsing: "正在解析所选文件，请稍候…",
  importAppleNotesProgressLabel: (current, total) =>
    `导入中 ${current}/${total}`,
  importAppleNotesImportBtn: "导入",
  importAppleNotesImporting: "正在导入…",
  importAppleNotesDone: (n: number) => `已导入 ${n} 条。`,
  importAppleNotesErrNone: "没有识别到可导入的笔记（需要每个文件夹里至少有一个 .md / .txt / .html）。",
  importAppleNotesParseErr: "解析所选文件时出错，请换一批文件再试。",
  importAppleNotesRunErr: "导入未完成，请稍后再试。",
  importAppleNotesBlockedNoEdit: "当前不可编辑，无法导入。",
  importAppleNotesBlockedTrash: "请先退出回收站视图再导入。",
  importAppleNotesBlockedConnections: "请先退出「笔记连接」视图再导入。",
  importAppleNotesBlockedReminders: "请先退出「我的待办」入口再导入。",
  importAppleNotesBlockedCalendar: "请先关闭日历单日视图再导入。",
  importAppleNotesBlockedSearch: "请先清空搜索再导入。",
  importAppleNotesBlockedNoCollection: "请先选中一个合集（或进入「全部笔记」）再导入。",
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
  headingReminders: "我的待办",
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
  allNotesEntry: "All notes",
  titleAllNotes: "All Notes",
  looseNotesCollectionName: "Inbox",
  connectionsEntry: "Connections",
  titleConnections: "Note connections",
  connectionsEmpty:
    "No links yet — use “⋯” on a card and Related notes to connect.",
  connectionsIntro: "Pairs of linked notes (A↔B counts as one link).",
  connectionsOpenTarget: "Open target",
  connectionsBoardHint: "Drag empty space to pan. Scroll wheel to zoom.",
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
  newReminderTaskAria: "New task",
  newReminderTaskPlus: "＋ New task",
  fabTitleNewReminderTask: "New note with today’s reminder",
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
  importAppleNotesFromSettings: "Import from Apple Notes export…",
  importAppleNotesRootCollectionName: "Apple Notes",
  importAppleNotesTitle: "Import Apple Notes export",
  importAppleNotesHint:
    "Apple Notes has no official bulk export API. On a Mac you can export individual notes (e.g. File → Export as Markdown), or use a third-party exporter to write a folder tree. This importer supports: (1) choose a folder where each note is a subfolder containing a .txt / .md / .html plus attachments; or (2) multi-select .md / .txt files—one file becomes one card. Inline data-URL images in Markdown are split into attachments. If a folder or file name contains a date/time (e.g. 2024-03-15, 14-30, 202403151430), it is applied to the card’s day and clock time. If you used “Export as HTML” on Mac and got many “YYYY-MM-DD HHMM title.html” files plus matching “…(Attachments)” folders, they are merged by that timestamp prefix into one card with attachments. On phones or browsers without a folder picker, zip the export folder on a computer and use “Choose ZIP archive”. If the export includes several notebook folders under iCloud, a top-level “Apple Notes” collection is created and each subfolder becomes a sub-collection.",
  importAppleNotesTargetLabel: (collectionLabel: string) =>
    `Import into current view: ${collectionLabel}`,
  importAppleNotesPickFolder: "Choose export folder (desktop browsers)",
  importAppleNotesPickZip: "Choose ZIP archive (any browser / phone)",
  importAppleNotesPickTextFiles: "Choose text files only (multi-select)",
  importAppleNotesPreview: (n: number) =>
    `Parsed ${n} note(s). Tap Import below to continue.`,
  importAppleNotesParsing: "Parsing selected files…",
  importAppleNotesProgressLabel: (current, total) =>
    `Importing ${current}/${total}`,
  importAppleNotesImportBtn: "Import",
  importAppleNotesImporting: "Importing…",
  importAppleNotesDone: (n: number) => `Imported ${n} note(s).`,
  importAppleNotesErrNone:
    "No notes found (each folder needs at least one .md / .txt / .html).",
  importAppleNotesParseErr: "Could not parse these files. Try a different selection.",
  importAppleNotesRunErr: "Import did not finish. Please try again.",
  importAppleNotesBlockedNoEdit: "Editing is disabled; import is unavailable.",
  importAppleNotesBlockedTrash: "Leave the trash view before importing.",
  importAppleNotesBlockedConnections: "Leave the connections view before importing.",
  importAppleNotesBlockedReminders: "Leave the reminders entry before importing.",
  importAppleNotesBlockedCalendar: "Close the calendar day view before importing.",
  importAppleNotesBlockedSearch: "Clear search before importing.",
  importAppleNotesBlockedNoCollection:
    "Select a collection or open “All notes” before importing.",
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
