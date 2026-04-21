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
  /** 彻底删除时，是否一并删除该笔记相关文件卡 */
  confirmDeleteRelatedFiles: (n: number) => string;
  errTrashDeleteOne: string;
  errTrashEmpty: string;
  confirmEmptyTrash: (n: number) => string;
  errLocalFolder: string;
  errBrowserBlob: string;
  errUpload: string;
  /** 附件右键「创建文件卡」失败 */
  errCreateFileCard: string;
  errRenameSync: string;
  errCreateCol: string;
  errCreateSub: string;
  errDeleteCol: string;
  errHintSave: string;
  /** 侧栏合集拖拽排序未完全写入云端（已尝试从服务器重同步） */
  errCollectionLayoutSave: string;
  /** 笔记拖入侧栏合集未完全同步 */
  errNoteMoveSave: string;
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
  /** 侧栏主导航分区标题：全部笔记 / 待办 / 探索 / 附件 */
  sidebarFeaturesSection: string;
  /** 侧栏「笔记」分区（全部笔记 / 待办 / 连接） */
  sidebarNotesSection: string;
  /** 侧栏「文件」分区（库内文件列表） */
  sidebarFilesSection: string;
  /** 侧栏「主题」分区（对象类型 · 主题；仅当已启用人物预设时显示） */
  sidebarTopicSection: string;
  /** 侧栏「主题」下：人物类目（preset person） */
  sidebarTopicPersonEntry: string;
  /** 侧栏「主题」下人物子行列表无障碍标签 */
  sidebarTopicSubtypeListAria: string;
  /** 侧栏「剪藏」分区（启用剪藏预设时显示） */
  sidebarClipSection: string;
  /** 侧栏「剪藏」下子类型列表无障碍标签 */
  sidebarClipSubtypeListAria: string;
  /** 侧栏「文件」下：子类型列表（图片/视频…）无障碍标签 */
  sidebarFileSubtypeListAria: string;
  /** 侧栏「笔记」下笔记预设子类型（学习/灵感…）列表无障碍标签 */
  sidebarNoteSubtypeListAria: string;
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
  allAttachmentsEntry: string;
  titleAllAttachments: string;
  allAttachmentsEmpty: string;
  allAttachmentsEmptyFiltered: string;
  allAttachmentsFilterAll: string;
  allAttachmentsFilterImage: string;
  allAttachmentsFilterVideo: string;
  allAttachmentsFilterAudio: string;
  allAttachmentsFilterDocument: string;
  allAttachmentsFilterOther: string;
  allAttachmentsFiltersAria: string;
  allAttachmentsMetaDash: string;
  allAttachmentsPaginationPrev: string;
  allAttachmentsPaginationNext: string;
  allAttachmentsPaginationPageOf: (
    page: number,
    totalPages: number
  ) => string;
  allAttachmentsPaginationNavAria: string;
  /** 文件视图顶栏：缩略图在「原比例」与「正方形裁剪」之间切换 */
  allAttachmentsPreviewToggleToSquareAria: string;
  allAttachmentsPreviewToggleToOriginalAria: string;
  allAttachmentsPreviewToggleToSquareTitle: string;
  allAttachmentsPreviewToggleToOriginalTitle: string;
  cardMenuAddToCollection: string;
  /** 卡片 ⋯：仅从当前合集移除一条归属（多合集时笔记仍在其它处） */
  cardMenuRemoveFromCollection: string;
  /** 卡片 ⋯：删除笔记（进回收站并从所有合集移除） */
  cardMenuDeleteCard: string;
  cardAddToCollectionTitle: string;
  cardAddToCollectionHint: string;
  cardAddToCollectionEmpty: string;
  cardAddToCollectionCancel: string;
  cardAddToCollectionRemoteBlocked: string;
  cardAddToCollectionAlreadyThere: string;
  cardRemovePlacementFail: string;
  cardRemoveFromCollectionChipAria: (path: string) => string;
  /** 自定义属性「关联合集」选择器 */
  propCollectionLinkPickerTitle: string;
  propCollectionLinkPickerHint: string;
  propCollectionLinkPickerEmpty: string;
  propCollectionLinkAdd: string;
  propCollectionLinkRemoveAria: (path: string) => string;
  propUnknownCollection: string;
  /** 笔记详情：合集 / 关联合集 的标签式输入与下拉 */
  cardCollectionTagInputPlaceholder: string;
  cardCollectionTagDropdownEmpty: string;
  cardCollectionTagDropdownAria: string;
  /** 全页卡片：手动触发服务端自动建卡 */
  cardPageRerunAutoLinkSection: string;
  cardPageRerunAutoLink: string;
  cardPageRerunAutoLinkBusy: string;
  cardPageRerunAutoLinkTitle: string;
  cardPageRerunAutoLinkOk: string;
  cardPageRerunAutoLinkFail: (detail: string) => string;
  /** 笔记探索白板卡片左侧灰条：拖动拉线建立关联 */
  connectionsLinkRailAria: string;
  /** 笔记探索 · 问 AI 侧栏 */
  cardAskAiTitle: string;
  cardAskAiToolbar: string;
  cardAskAiPlaceholder: string;
  cardAskAiSend: string;
  cardAskAiClose: string;
  cardAskAiQuickAction: string;
  cardAskAiDive: string;
  cardAskAiExplain: string;
  cardAskAiSimplify: string;
  cardAskAiExample: string;
  cardAskAiWonder: string;
  cardAskAiLoading: string;
  cardAskAiAnswer: string;
  cardAskAiNeedLogin: string;
  cardAskAiNeedRemote: string;
  cardAskAiGeminiDisabled: string;
  /** 本月「问 AI」次数用尽（服务端会返回具体文案，此为兜底） */
  cardAskAiQuotaExceeded: string;
  cardAskAiError: string;
  cardAskAiSaveAsNote: string;
  cardAskAiSaveSuccess: string;
  cardAskAiSaveFail: string;
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
  /** 侧栏「已归档」入口：跳转到「笔记」preset 下命名为「已归档」的子合集 */
  titleArchived: string;
  archivedAria: string;
  titleReminders: string;
  titleNoCollection: string;
  /** 主区合集标题面包屑导航 */
  collectionPathBreadcrumbAria: string;
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
  /** 笔记设置：从 flomo 导出导入 */
  importFlomoFromSettings: string;
  /** flomo 导入时顶层合集名称 */
  importFlomoRootCollectionName: string;
  importFlomoTitle: string;
  importFlomoHint: string;
  importFlomoErrNone: string;
  /** 笔记设置：语雀知识库 Markdown 导出 */
  importYuqueFromSettings: string;
  /** 语雀知识库导入时顶层合集名称 */
  importYuqueRootCollectionName: string;
  importYuqueTitle: string;
  importYuqueHint: string;
  importYuqueErrNone: string;
  /** 笔记设置：印象笔记 / Evernote ENEX */
  importEvernoteFromSettings: string;
  importEvernoteRootCollectionName: string;
  importEvernoteTitle: string;
  importEvernoteHint: string;
  importEvernotePickFiles: string;
  importEvernoteErrNone: string;
  /** 导入卡片 HTML：加密正文占位（不含标题，标题由解析器单独加 h1） */
  importEvernoteEncryptedBodyHtml: string;
  /** 导入卡片 HTML：压缩正文无法解压时的占位 */
  importEvernoteCompressedBodyHtml: string;
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
  /** 导入执行中：当前步 / 总步；parsedNoteCount 为解析出的笔记条数（总步含创建合集目录，可大于条数） */
  importAppleNotesProgressLabel: (
    current: number,
    total: number,
    parsedNoteCount?: number
  ) => string;
  importAppleNotesImportBtn: string;
  importAppleNotesImporting: string;
  importAppleNotesDone: (n: number) => string;
  importAppleNotesErrNone: string;
  importAppleNotesParseErr: string;
  importAppleNotesRunErr: string;
  importAppleNotesBlockedNoEdit: string;
  importAppleNotesBlockedTrash: string;
  importAppleNotesBlockedConnections: string;
  importAppleNotesBlockedAttachments: string;
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
  confirmDeleteRelatedFiles: (n: number) =>
    `这条笔记关联了 ${n} 个文件，是否同时删除这些相关文件？`,
  errTrashDeleteOne: "这条从回收站删不掉耶…等等再试？",
  errTrashEmpty: "垃圾桶倒不干净…等等再清空一次？",
  confirmEmptyTrash: (n: number) =>
    `垃圾桶里一共 ${n} 条，要全部清空吗？会永久消失回不来的那种！`,
  errLocalFolder: "存到本地文件夹失败，再试一次？",
  errBrowserBlob:
    "浏览器怀里塞不下这个附件…换张小一点的或用桌面版更稳喔～",
  errUpload: "附件上传翻车啦，再试一次？",
  errCreateFileCard: "创建文件卡没成功，稍后再试？",
  errRenameSync: "名字没同步上…刷新一下可能变回旧的喔～",
  errCreateCol: "新合集没建成功…看看网络或登录后再试？",
  errCreateSub: "子合集没塞进去…网络或登录再确认下？",
  errDeleteCol: "合集删不掉耶…等等再试或检查一下权限？",
  errHintSave: "说明没保存上…刷新可能变回上一版喔～",
  errCollectionLayoutSave:
    "合集排序未完全保存，已从服务器重新同步侧栏；若仍不对请刷新页面。",
  errNoteMoveSave:
    "笔记搬家未完全保存，已从服务器重新同步；若仍不对请刷新或再拖一次。",
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
  sidebarFeaturesSection: "功能",
  sidebarNotesSection: "笔记",
  sidebarFilesSection: "文件",
  sidebarTopicSection: "主题",
  sidebarTopicPersonEntry: "人物",
  sidebarTopicSubtypeListAria: "主题下的人物类目",
  sidebarClipSection: "剪藏",
  sidebarClipSubtypeListAria: "剪藏下的子类型",
  sidebarFileSubtypeListAria: "文件子类型",
  sidebarNoteSubtypeListAria: "笔记类型（学习、灵感等）",
  allNotesEntry: "全部笔记",
  titleAllNotes: "全部笔记",
  looseNotesCollectionName: "未归类笔记",
  connectionsEntry: "笔记探索",
  titleConnections: "笔记探索",
  connectionsEmpty:
    "还没有可探索的笔记关联～在卡片「⋯」里点「笔记详情」打开全页，在「相关笔记」中即可建立。",
  connectionsIntro: "关联成对展示（A↔B 双向只计 1 条）。",
  connectionsOpenTarget: "打开目标笔记",
  connectionsBoardHint:
    "空白处拖曳平移画布，滚轮缩放。在卡片左侧灰条上按下并拖到另一张卡片可建立相关笔记。",
  allAttachmentsEntry: "文件",
  titleAllAttachments: "文件",
  allAttachmentsEmpty:
    "还没有可展示的文件～在笔记卡片里添加图片、视频或文件后会出现在这里。",
  allAttachmentsEmptyFiltered: "没有符合当前筛选的文件。",
  allAttachmentsFilterAll: "全部",
  allAttachmentsFilterImage: "图片",
  allAttachmentsFilterVideo: "视频",
  allAttachmentsFilterAudio: "音频",
  allAttachmentsFilterDocument: "文档",
  allAttachmentsFilterOther: "其他",
  allAttachmentsFiltersAria: "按类型筛选文件",
  allAttachmentsMetaDash: "—",
  allAttachmentsPaginationPrev: "上一页",
  allAttachmentsPaginationNext: "下一页",
  allAttachmentsPaginationPageOf: (page, totalPages) =>
    `第 ${page} / ${totalPages} 页`,
  allAttachmentsPaginationNavAria: "文件列表分页",
  allAttachmentsPreviewToggleToSquareAria: "切换到正方形裁剪预览",
  allAttachmentsPreviewToggleToOriginalAria: "切换到原比例预览",
  allAttachmentsPreviewToggleToSquareTitle: "缩略图改为正方形裁剪显示（点击切换）",
  allAttachmentsPreviewToggleToOriginalTitle: "缩略图改为原比例完整显示（点击切换）",
  cardMenuAddToCollection: "添加至合集",
  cardMenuRemoveFromCollection: "从合集移除",
  cardMenuDeleteCard: "删除卡片",
  cardAddToCollectionTitle: "添加至合集",
  cardAddToCollectionHint: "选择要加入的合集；同一张笔记会在多个合集中显示，内容会同步。",
  cardAddToCollectionEmpty: "没有可选的合集（已在所有合集中）。",
  cardAddToCollectionCancel: "取消",
  cardAddToCollectionRemoteBlocked:
    "云端数据模式下暂不支持将同一张笔记加入多个合集（需服务端结构升级）。请使用本地数据模式，或在「笔记详情」页的「相关笔记」中建立关联。",
  cardAddToCollectionAlreadyThere: "该合集里已经有这条笔记了。",
  cardRemovePlacementFail: "未能从该合集移除笔记，请稍后重试。",
  cardRemoveFromCollectionChipAria: (path: string) =>
    `从合集「${path}」移除`,
  propCollectionLinkPickerTitle: "关联合集",
  propCollectionLinkPickerHint:
    "仅保存在该属性中，不会把笔记加入所选合集。",
  propCollectionLinkPickerEmpty: "没有更多可选合集。",
  propCollectionLinkAdd: "+ 关联合集",
  propCollectionLinkRemoveAria: (path: string) => `移除关联「${path}」`,
  propUnknownCollection: "（无此合集）",
  cardCollectionTagInputPlaceholder: "添加或搜索合集…",
  cardCollectionTagDropdownEmpty: "暂无可添加的合集。",
  cardCollectionTagDropdownAria: "选择合集",
  cardPageRerunAutoLinkSection: "自动建卡",
  cardPageRerunAutoLink: "重新执行自动建卡",
  cardPageRerunAutoLinkBusy: "正在处理…",
  cardPageRerunAutoLinkTitle:
    "按当前合集上的自动建卡规则，补建缺失的关联卡（如人物、网页剪藏）并写回关联属性",
  cardPageRerunAutoLinkOk: "已执行自动建卡并刷新本页数据。",
  cardPageRerunAutoLinkFail: (detail) => `未能完成：${detail}`,
  connectionsLinkRailAria: "从此处拖动连线到另一张笔记",
  cardAskAiTitle: "问 AI",
  cardAskAiToolbar: "问 AI",
  cardAskAiPlaceholder: "向 AI 提问…",
  cardAskAiSend: "发送",
  cardAskAiClose: "关闭",
  cardAskAiQuickAction: "快捷操作",
  cardAskAiDive: "深入",
  cardAskAiExplain: "解释",
  cardAskAiSimplify: "简化",
  cardAskAiExample: "例子",
  cardAskAiWonder: "可补充的知识…",
  cardAskAiLoading: "生成中…",
  cardAskAiAnswer: "回答",
  cardAskAiNeedLogin: "请先登录账号后再使用问 AI。",
  cardAskAiNeedRemote: "问 AI 仅在云端数据模式下可用。",
  cardAskAiGeminiDisabled: "服务器未配置 AI（GEMINI_API_KEY），请稍后再试或联系管理员。",
  cardAskAiQuotaExceeded: "本月「问 AI」次数已用完，下月重置或升级订阅。",
  cardAskAiError: "请求失败，请检查网络后重试。",
  cardAskAiSaveAsNote: "保存为笔记",
  cardAskAiSaveSuccess: "已保存到当前合集，并与当前笔记建立了相关链接。",
  cardAskAiSaveFail: "保存失败，请稍后重试。",
  remindersEntry: "我的待办入口",
  favoriteCols: "收藏的合集",
  unfavoriteAria: "取消收藏",
  unfavoriteTitle: "取消收藏",
  newCollectionAria: "新建合集",
  sidebarNav: "合集",
  allTags: "全部标签",
  trashAria: "垃圾桶",
  archivedAria: "已归档",
  backToList: "返回合集列表",
  searchPlaceholder: "搜搜笔记、合集、文件名～",
  searchAria: "搜索笔记、文件名、合集名",
  searchClear: "清除搜索",
  searchCollapse: "收起搜索",
  titleSearch: "搜索",
  titleTrash: "垃圾桶",
  titleArchived: "已归档",
  titleReminders: "我的待办",
  titleNoCollection: "未选择合集",
  collectionPathBreadcrumbAria: "合集路径",
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
  importFlomoFromSettings: "从 flomo 导出导入…",
  importFlomoRootCollectionName: "Flomo",
  importFlomoTitle: "flomo 导出 → 导入",
  importFlomoHint:
    "在 flomo 中导出为 HTML（含主 HTML 与同级的 file 资源目录）。在此选择整个导出文件夹，或先打成 zip 再上传。每条 MEMO 对应一张小笔记，正文保留 HTML，图片/视频等会进入附件。若导出目录名作为子结构，会新建顶层「Flomo」合集并恢复子文件夹。手机浏览器可优先使用 zip。",
  importFlomoErrNone:
    "没有识别到 flomo 导出（需含「…的笔记.html」及 file 目录下的附件）。",
  importYuqueFromSettings: "从语雀知识库导出导入…",
  importYuqueRootCollectionName: "语雀知识库",
  importYuqueTitle: "语雀知识库导出 → 导入",
  importYuqueHint:
    "在语雀中将知识库导出为 Markdown（含 .md 与同级的 images 等资源目录）。在此选择整个导出文件夹，或先打成 zip 再上传。每个 .md 对应一张卡片；正文里相对路径的图片（Markdown 插图与 HTML <img>）会从正文移除并作为附件上传，外链图片保留在正文。子文件夹会恢复为侧栏子合集。",
  importYuqueErrNone: "没有识别到 .md 文件（请确认选中了语雀 Markdown 导出目录或 zip）。",
  importEvernoteFromSettings: "从印象笔记 / Evernote 导出导入…",
  importEvernoteRootCollectionName: "印象笔记",
  importEvernoteTitle: "印象笔记 / Evernote 导出 → 导入",
  importEvernoteHint:
    "支持 Evernote ENEX（.enex）。可选整个导出文件夹（例如含多个笔记本子文件夹的 output 目录）、ZIP，或直接多选 .enex 文件。选文件夹 / ZIP 时仍会扫描目录内符合格式的导出文件。选文件夹时会按相对路径恢复子合集（如「C - 我的日记」下的 enex 会进入对应子文件夹）。若正文为加密（base64:aes），无法解密，仅导入标题、时间与附件；未加密导出可完整导入 ENML 正文。超大单文件可能占用较多内存。",
  importEvernotePickFiles: "选择 .enex 文件…",
  importEvernoteErrNone:
    "未识别到可导入的 ENEX（需要 .enex 等导出文件，且内含笔记数据）。",
  importEvernoteEncryptedBodyHtml:
    "<p>本条为<strong>加密导出</strong>（<code>base64:aes</code>），正文无法在应用内解密。若需完整正文，请在印象笔记中改为未加密或使用未加密 ENEX 再导出。</p>",
  importEvernoteCompressedBodyHtml:
    "<p>本条正文为压缩封装，当前版本未能自动解压。请使用未加密的 Evernote ENEX，或改用可导出 HTML 的方式。</p>",
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
  importAppleNotesProgressLabel: (current, total, parsedNoteCount) => {
    if (
      parsedNoteCount !== undefined &&
      parsedNoteCount > 0 &&
      total > parsedNoteCount
    ) {
      const setup = total - parsedNoteCount;
      return `导入中 ${current}/${total}（${parsedNoteCount} 条笔记 + ${setup} 步创建合集）`;
    }
    return `导入中 ${current}/${total}`;
  },
  importAppleNotesImportBtn: "导入",
  importAppleNotesImporting: "正在导入…",
  importAppleNotesDone: (n: number) => `已导入 ${n} 条。`,
  importAppleNotesErrNone: "没有识别到可导入的笔记（需要每个文件夹里至少有一个 .md / .txt / .html）。",
  importAppleNotesParseErr: "解析所选文件时出错，请换一批文件再试。",
  importAppleNotesRunErr: "导入未完成，请稍后再试。",
  importAppleNotesBlockedNoEdit: "当前不可编辑，无法导入。",
  importAppleNotesBlockedTrash: "请先退出回收站视图再导入。",
  importAppleNotesBlockedConnections: "请先退出「笔记探索」视图再导入。",
  importAppleNotesBlockedAttachments: "请先退出「文件」视图再导入。",
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
  confirmDeleteRelatedFiles: (n: number) =>
    `This note has ${n} related file attachment(s). Delete those files too?`,
  errTrashDeleteOne: "Couldn’t delete from trash. Try again?",
  errTrashEmpty: "Couldn’t empty trash. Try again?",
  confirmEmptyTrash: (n: number) =>
    `Empty all ${n} item(s) in trash? This cannot be undone.`,
  errLocalFolder: "Couldn’t save to the local folder. Retry?",
  errBrowserBlob: "File too large for the browser — use a smaller file or the desktop app.",
  errUpload: "Upload failed. Try again?",
  errCreateFileCard: "Couldn’t create file card. Try again?",
  errRenameSync: "Name didn’t sync — refresh may show the old one.",
  errCreateCol: "Couldn’t create collection. Check network or sign in.",
  errCreateSub: "Couldn’t add sub‑folder. Check network or sign in.",
  errDeleteCol: "Couldn’t delete collection. Retry or check permissions?",
  errHintSave: "Hint didn’t save — refresh may revert.",
  errCollectionLayoutSave:
    "Couldn’t save the full sidebar order — synced from the server; refresh if it still looks wrong.",
  errNoteMoveSave:
    "Couldn’t finish moving the note — synced from the server; refresh or try dragging again.",
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
  sidebarFeaturesSection: "Features",
  sidebarNotesSection: "Notes",
  sidebarFilesSection: "Files",
  sidebarTopicSection: "Topics",
  sidebarTopicPersonEntry: "People",
  sidebarTopicSubtypeListAria: "People under Topics",
  sidebarClipSection: "Clips",
  sidebarClipSubtypeListAria: "Clip subtypes",
  sidebarFileSubtypeListAria: "File subtypes",
  sidebarNoteSubtypeListAria: "Note subtypes (study, ideas, …)",
  allNotesEntry: "All notes",
  titleAllNotes: "All Notes",
  looseNotesCollectionName: "Inbox",
  connectionsEntry: "Explore",
  titleConnections: "Explore notes",
  connectionsEmpty:
    "Nothing to explore yet — use “⋯” on a card, choose Note detail, then add links under Related notes.",
  connectionsIntro: "Linked pairs (A↔B counts as one link).",
  connectionsOpenTarget: "Open target",
  connectionsBoardHint:
    "Drag empty space to pan. Scroll wheel to zoom. Drag from the left rail on a card to another to link.",
  allAttachmentsEntry: "Files",
  titleAllAttachments: "Files",
  allAttachmentsEmpty:
    "No files yet — add images, video, or other files to a note to see them here.",
  allAttachmentsEmptyFiltered: "Nothing matches the current filter.",
  allAttachmentsFilterAll: "All",
  allAttachmentsFilterImage: "Images",
  allAttachmentsFilterVideo: "Video",
  allAttachmentsFilterAudio: "Audio",
  allAttachmentsFilterDocument: "Documents",
  allAttachmentsFilterOther: "Other",
  allAttachmentsFiltersAria: "Filter files by type",
  allAttachmentsMetaDash: "—",
  allAttachmentsPaginationPrev: "Previous",
  allAttachmentsPaginationNext: "Next",
  allAttachmentsPaginationPageOf: (page, totalPages) =>
    `Page ${page} of ${totalPages}`,
  allAttachmentsPaginationNavAria: "Files pagination",
  allAttachmentsPreviewToggleToSquareAria: "Switch to square-cropped previews",
  allAttachmentsPreviewToggleToOriginalAria: "Switch to original-aspect previews",
  allAttachmentsPreviewToggleToSquareTitle: "Crop previews to a square (tap)",
  allAttachmentsPreviewToggleToOriginalTitle: "Show previews at original aspect (tap)",
  cardMenuAddToCollection: "Add to collection",
  cardMenuRemoveFromCollection: "Remove from this collection",
  cardMenuDeleteCard: "Delete note",
  cardAddToCollectionTitle: "Add to collection",
  cardAddToCollectionHint:
    "Pick a collection. The same note can appear in several places and stays in sync.",
  cardAddToCollectionEmpty: "No collections left to pick (it’s already in all of them).",
  cardAddToCollectionCancel: "Cancel",
  cardAddToCollectionRemoteBlocked:
    "Adding the same note to multiple collections isn’t supported in cloud mode yet. Use local data mode, or open Note detail and link under Related notes.",
  cardAddToCollectionAlreadyThere: "This note is already in that collection.",
  cardRemovePlacementFail:
    "Couldn’t remove this note from that collection. Try again in a moment.",
  cardRemoveFromCollectionChipAria: (path: string) =>
    `Remove from collection “${path}”`,
  propCollectionLinkPickerTitle: "Link collections",
  propCollectionLinkPickerHint:
    "Saved on this property only; the note is not added to the collections you pick.",
  propCollectionLinkPickerEmpty: "No more collections available.",
  propCollectionLinkAdd: "+ Link collection",
  propCollectionLinkRemoveAria: (path: string) => `Remove link “${path}”`,
  propUnknownCollection: "(Missing collection)",
  cardCollectionTagInputPlaceholder: "Add or search collections…",
  cardCollectionTagDropdownEmpty: "No collections available to add.",
  cardCollectionTagDropdownAria: "Pick a collection",
  cardPageRerunAutoLinkSection: "Auto-link",
  cardPageRerunAutoLink: "Run auto-link rules again",
  cardPageRerunAutoLinkBusy: "Working…",
  cardPageRerunAutoLinkTitle:
    "Re-run preset auto-link rules to create missing linked cards (e.g. person, bookmark clip) and update link fields",
  cardPageRerunAutoLinkOk: "Auto-link finished; data refreshed.",
  cardPageRerunAutoLinkFail: (detail) => `Couldn’t complete: ${detail}`,
  connectionsLinkRailAria: "Drag a line from here to another note",
  cardAskAiTitle: "Ask AI",
  cardAskAiToolbar: "Ask AI",
  cardAskAiPlaceholder: "Ask a question…",
  cardAskAiSend: "Send",
  cardAskAiClose: "Close",
  cardAskAiQuickAction: "Quick action",
  cardAskAiDive: "Dive in",
  cardAskAiExplain: "Explain",
  cardAskAiSimplify: "Simplify",
  cardAskAiExample: "Example",
  cardAskAiWonder: "Knowledge to add…",
  cardAskAiLoading: "Generating…",
  cardAskAiAnswer: "Answer",
  cardAskAiNeedLogin: "Sign in to use Ask AI.",
  cardAskAiNeedRemote: "Ask AI is only available in cloud data mode.",
  cardAskAiQuotaExceeded:
    "Monthly Ask AI limit reached. Resets next month or upgrade your plan.",
  cardAskAiGeminiDisabled:
    "AI isn’t configured on the server (GEMINI_API_KEY). Try again later or contact an admin.",
  cardAskAiError: "Request failed. Check your network and try again.",
  cardAskAiSaveAsNote: "Save as note",
  cardAskAiSaveSuccess:
    "Saved to the current collection and linked with this note.",
  cardAskAiSaveFail: "Couldn’t save. Try again later.",
  remindersEntry: "All reminders",
  favoriteCols: "Starred collections",
  unfavoriteAria: "Remove from starred",
  unfavoriteTitle: "Remove from starred",
  newCollectionAria: "New collection",
  sidebarNav: "Collections",
  allTags: "All tags",
  trashAria: "Trash",
  archivedAria: "Archived",
  backToList: "Back to collections",
  searchPlaceholder: "Search notes, collections, file names…",
  searchAria: "Search notes, file names, collections",
  searchClear: "Clear search",
  searchCollapse: "Collapse search",
  titleSearch: "Search",
  titleTrash: "Trash",
  titleArchived: "Archived",
  titleReminders: "Reminders",
  titleNoCollection: "No collection selected",
  collectionPathBreadcrumbAria: "Collection path",
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
  importFlomoFromSettings: "Import from flomo export…",
  importFlomoRootCollectionName: "Flomo",
  importFlomoTitle: "Import flomo export",
  importFlomoHint:
    "Export from flomo as HTML (main `.html` plus the sibling `file/` asset folder). Choose the whole export folder here, or zip it first and upload the archive. Each MEMO becomes one card; HTML is preserved and images/videos go to attachments. If the export uses subfolders, a top-level “Flomo” collection is created. On mobile, ZIP is easiest.",
  importFlomoErrNone:
    "No flomo export detected (need the main “…notes.html” with flomo branding and the `file/` assets folder).",
  importYuqueFromSettings: "Import from Yuque knowledge base export…",
  importYuqueRootCollectionName: "Yuque",
  importYuqueTitle: "Import Yuque knowledge base export",
  importYuqueHint:
    "Export a Yuque knowledge base as Markdown (`.md` files plus sibling folders like `images/`). Choose the whole export folder here, or zip it first. Each `.md` becomes one card; local images in Markdown or HTML img tags are removed from the text and uploaded as attachments; remote images stay in the body. Subfolders become nested collections.",
  importYuqueErrNone:
    "No `.md` files found (choose the Yuque Markdown export folder or a zip of it).",
  importEvernoteFromSettings: "Import from Evernote / Yinxiang Biji export…",
  importEvernoteRootCollectionName: "Evernote",
  importEvernoteTitle: "Import Evernote / Yinxiang export",
  importEvernoteHint:
    "Supports Evernote ENEX (`.enex`). Choose a whole export folder, a ZIP, or multi-select `.enex` files. Folder/ZIP import still scans for supported exports inside the tree. Sub-collections follow relative paths (e.g. notebooks under “C - …”). Encrypted bodies (base64:aes) cannot be decrypted here; unencrypted exports import full ENML. Very large files may use a lot of memory.",
  importEvernotePickFiles: "Choose .enex files…",
  importEvernoteErrNone:
    "No importable ENEX found (need `.enex` exports with note data).",
  importEvernoteEncryptedBodyHtml:
    "<p>This note was exported <strong>encrypted</strong> (<code>base64:aes</code>); the body cannot be decrypted here. Export an <strong>unencrypted</strong> ENEX from Evernote/Yinxiang for full text.</p>",
  importEvernoteCompressedBodyHtml:
    "<p>This note’s body is compressed and could not be expanded in this build. Try an unencrypted ENEX export or an HTML-based export.</p>",
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
  importAppleNotesProgressLabel: (current, total, parsedNoteCount) => {
    if (
      parsedNoteCount !== undefined &&
      parsedNoteCount > 0 &&
      total > parsedNoteCount
    ) {
      const setup = total - parsedNoteCount;
      return `Importing ${current}/${total} (${parsedNoteCount} notes + ${setup} folder step(s))`;
    }
    return `Importing ${current}/${total}`;
  },
  importAppleNotesImportBtn: "Import",
  importAppleNotesImporting: "Importing…",
  importAppleNotesDone: (n: number) => `Imported ${n} note(s).`,
  importAppleNotesErrNone:
    "No notes found (each folder needs at least one .md / .txt / .html).",
  importAppleNotesParseErr: "Could not parse these files. Try a different selection.",
  importAppleNotesRunErr: "Import did not finish. Please try again.",
  importAppleNotesBlockedNoEdit: "Editing is disabled; import is unavailable.",
  importAppleNotesBlockedTrash: "Leave the trash view before importing.",
  importAppleNotesBlockedConnections: "Leave Explore before importing.",
  importAppleNotesBlockedAttachments: "Leave Files before importing.",
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
