import type { LoginUiLang } from "../auth/loginUiI18n";

/** 主界面零散 UI（卡片、侧栏、图库、法律页等），不含登录框品牌/logo 文案 */
export type ScatteredUiChrome = {
  uiClose: string;
  uiBack: string;
  uiNoteBodyAria: string;
  uiMoreActions: string;
  uiViewDetail: string;
  uiRelatedNotes: string;
  uiUploading: string;
  uiAddAttachment: string;
  uiClearAttachments: string;
  uiReminderEllipsis: string;
  uiUnpin: string;
  uiPin: string;
  uiDelete: string;
  uiTagsLabel: string;
  uiTagsAria: string;
  uiLayoutSplitTitle: string;
  uiLayoutStackTitle: string;
  uiDropIncomplete: string;
  uiDragHandleLoggedIn: string;
  uiDragHandleGuest: string;
  uiDragHintLoggedIn: string;
  uiDragHintGuest: string;
  uiTrashFromCollection: (path: string) => string;
  uiTrashRestore: string;
  uiTrashDeleteForever: string;
  uiRelatedSourceMissing: string;
  uiRelatedEmptySearch: string;
  uiRelatedEmptyPlain: string;
  uiRelatedUnlink: string;
  uiRelatedUnlinkBroken: string;
  uiRelatedPeerMissing: string;
  uiRelatedPasteLabel: string;
  uiRelatedSearchPlaceholder: string;
  uiRelatedNoResults: string;
  uiRelatedReadOnly: string;
  uiFileFallback: string;
  uiLightboxPreview: string;
  uiLightboxAria: (index: number, total: number) => string;
  uiPrevItem: string;
  uiNextItem: string;
  uiPagination: string;
  uiOpenInNewWindow: string;
  uiSetCover: string;
  uiCopyImage: string;
  uiDownloadAttachment: string;
  uiDeleteAttachment: string;
  uiGalleryThumbTitleImageRich: string;
  uiGalleryThumbTitleFileRich: string;
  uiGalleryThumbTitleAudioRich: string;
  uiGalleryThumbTitleVideoRich: string;
  uiGalleryThumbTitleImagePlain: string;
  uiGalleryThumbTitleFilePlain: string;
  uiGalleryThumbTitleAudioPlain: string;
  uiGalleryThumbTitleVideoPlain: string;
  uiGalleryAriaVideo: string;
  uiGalleryAriaImage: string;
  uiGalleryAriaAudio: string;
  uiGalleryAriaFile: string;
  uiExpandSubcollections: string;
  uiCollapseSubcollections: string;
  uiCollectionNameAria: string;
  uiCollectionNameHint: string;
  uiAddSubcollectionAria: string;
  uiAddSubcollectionTitle: string;
  uiDragCollectionAria: string;
  uiDragCollectionTitle: string;
  uiDeleteCollectionMenu: string;
  uiDeleteCollectionDialogTitle: string;
  uiDeleteCollectionWithSubtree: (name: string) => string;
  uiDeleteCollectionLeaf: (name: string) => string;
  uiConfirmDelete: string;
  uiHighlightAria: (colorLabel: string) => string;
  adminBackToNotes: string;
  adminTitle: string;
  adminLead: string;
  adminNewUserHeading: string;
  adminLabelLoginId: string;
  adminPhLoginId: string;
  adminLabelPassword: string;
  adminPhPassword: string;
  adminLabelDisplayName: string;
  adminPhDisplayName: string;
  adminLabelEmail: string;
  adminPhEmail: string;
  adminLabelRole: string;
  adminRoleUser: string;
  adminRoleSubscriber: string;
  adminRoleAdmin: string;
  adminCreating: string;
  adminCreateUser: string;
  adminAllUsers: string;
  adminLoadingList: string;
  adminThInternalId: string;
  adminThNickname: string;
  adminThLoginId: string;
  adminThEmail: string;
  adminThRole: string;
  adminThResetPwd: string;
  adminThProfile: string;
  adminThActions: string;
  adminPhUnbound: string;
  adminPhNewPassword: string;
  adminApplyPwd: string;
  adminSave: string;
  adminDelete: string;
  /** 已排队异步删除（清云中） */
  adminDeletionPending: string;
  adminDeleteConfirm: (username: string) => string;
  adminAriaDisplayName: (loginId: string) => string;
  adminAriaLoginId: (loginId: string) => string;
  adminAriaEmail: (loginId: string) => string;
  adminAriaRole: (loginId: string) => string;
};

const zh: ScatteredUiChrome = {
  uiClose: "关闭",
  uiBack: "返回",
  uiNoteBodyAria: "笔记正文",
  uiMoreActions: "更多操作",
  uiViewDetail: "查看详情",
  uiRelatedNotes: "相关笔记",
  uiUploading: "上传中…",
  uiAddAttachment: "添加附件",
  uiClearAttachments: "清空附件",
  uiReminderEllipsis: "提醒…",
  uiUnpin: "取消置顶",
  uiPin: "置顶",
  uiDelete: "删除",
  uiTagsLabel: "标签：",
  uiTagsAria: "标签",
  uiLayoutSplitTitle: "切换为左右分栏",
  uiLayoutStackTitle: "切换为上下分栏（附件在上，正文在下可滚动）",
  uiDropIncomplete: "笔记搬家没搬完…刷新一下再拖拖看？",
  uiDragHandleLoggedIn: "拖动以移动小笔记",
  uiDragHandleGuest: "侧栏条（登录后可拖动排列）",
  uiDragHintLoggedIn: "按住拖到其他卡片旁或侧栏合集",
  uiDragHintGuest: "登录后可拖动小笔记排序",
  uiTrashFromCollection: (path) => `原所在合集：${path}`,
  uiTrashRestore: "恢复到原合集",
  uiTrashDeleteForever: "永久删除",
  uiRelatedSourceMissing: "源笔记好像蒸发啦…",
  uiRelatedEmptySearch:
    "还没有关联笔记，可在下方按相似度搜索并粘贴关联～",
  uiRelatedEmptyPlain: "还没有关联笔记。",
  uiRelatedUnlink: "解除贴贴",
  uiRelatedUnlinkBroken: "撕掉坏掉的贴贴",
  uiRelatedPeerMissing: "那边笔记不见啦或打不开惹",
  uiRelatedPasteLabel: "粘贴关联",
  uiRelatedSearchPlaceholder: "搜索笔记（按与当前内容的相似度排序）…",
  uiRelatedNoResults: "没找到合拍笔记，换个关键词试试？",
  uiRelatedReadOnly: "只读模式下无法搜索或添加关联。",
  uiFileFallback: "文件",
  uiLightboxPreview: "预览",
  uiLightboxAria: (index, total) => `预览第 ${index} 项，共 ${total} 项`,
  uiPrevItem: "上一项",
  uiNextItem: "下一项",
  uiPagination: "分页",
  uiOpenInNewWindow: "在新窗口打开",
  uiSetCover: "设为封面",
  uiCopyImage: "复制图片",
  uiDownloadAttachment: "下载附件",
  uiDeleteAttachment: "删除附件",
  uiGalleryThumbTitleImageRich: "点击放大，右键可复制图片或更多",
  uiGalleryThumbTitleFileRich: "点击查看，右键更多",
  uiGalleryThumbTitleAudioRich: "点击放大播放音频，右键更多",
  uiGalleryThumbTitleVideoRich: "点击放大，右键更多",
  uiGalleryThumbTitleImagePlain: "点击放大，右键可复制图片",
  uiGalleryThumbTitleFilePlain: "点击查看",
  uiGalleryThumbTitleAudioPlain: "点击放大播放音频",
  uiGalleryThumbTitleVideoPlain: "点击放大",
  uiGalleryAriaVideo: "点击放大播放视频",
  uiGalleryAriaImage: "点击放大查看图片",
  uiGalleryAriaAudio: "点击放大播放音频",
  uiGalleryAriaFile: "查看文件",
  uiExpandSubcollections: "展开子合集",
  uiCollapseSubcollections: "折叠子合集",
  uiCollectionNameAria: "合集名称",
  uiCollectionNameHint: "双击修改名称；右键可删除合集",
  uiAddSubcollectionAria: "添加子合集",
  uiAddSubcollectionTitle: "子合集",
  uiDragCollectionAria: "拖动调整合集顺序",
  uiDragCollectionTitle: "拖动调整顺序",
  uiDeleteCollectionMenu: "删除合集",
  uiDeleteCollectionDialogTitle: "删除合集",
  uiDeleteCollectionWithSubtree: (name) =>
    `要连「${name}」带子文件夹一锅端吗？里面的笔记也会一起蒸发，救不回喔。`,
  uiDeleteCollectionLeaf: (name) =>
    `确定拆掉「${name}」这个合集？里面的笔记也会一起消失喔。`,
  uiConfirmDelete: "确定删除",
  uiHighlightAria: (colorLabel) => `${colorLabel}高亮`,
  adminBackToNotes: "← 返回笔记",
  adminTitle: "用户管理",
  adminLead:
    "新建账号、修改昵称与登录 ID、绑定邮箱、调整身份或重置口令。删除后该用户的笔记与附件将一并清理（不可恢复）。",
  adminNewUserHeading: "新建用户",
  adminLabelLoginId: "登录 ID",
  adminPhLoginId: "2–32 位字母、数字或下划线",
  adminLabelPassword: "初始密码",
  adminPhPassword: "至少 4 位",
  adminLabelDisplayName: "显示昵称",
  adminPhDisplayName: "侧栏与笔记旁显示；不填则用登录 ID",
  adminLabelEmail: "邮箱（可选）",
  adminPhEmail: "绑定后可用邮箱登录",
  adminLabelRole: "身份",
  adminRoleUser: "住民（普通）",
  adminRoleSubscriber: "订阅",
  adminRoleAdmin: "站长",
  adminCreating: "创建中…",
  adminCreateUser: "创建用户",
  adminAllUsers: "全部用户",
  adminLoadingList: "名单加载中…",
  adminThInternalId: "内部 ID",
  adminThNickname: "昵称",
  adminThLoginId: "登录 ID",
  adminThEmail: "邮箱",
  adminThRole: "身份",
  adminThResetPwd: "重置口令",
  adminThProfile: "资料",
  adminThActions: "",
  adminPhUnbound: "未绑定",
  adminPhNewPassword: "新口令",
  adminApplyPwd: "生效",
  adminSave: "保存",
  adminDelete: "删除",
  adminDeletionPending: "清理云中…",
  adminDeleteConfirm: (username) =>
    `要把「${username}」标记为删除吗？云端附件将在后台清理，完成后从列表消失。`,
  adminAriaDisplayName: (loginId) => `${loginId} 的昵称`,
  adminAriaLoginId: (loginId) => `${loginId} 的登录 ID`,
  adminAriaEmail: (loginId) => `${loginId} 的邮箱`,
  adminAriaRole: (loginId) => `${loginId} 的身份`,
};

const en: ScatteredUiChrome = {
  uiClose: "Close",
  uiBack: "Back",
  uiNoteBodyAria: "Note body",
  uiMoreActions: "More actions",
  uiViewDetail: "View details",
  uiRelatedNotes: "Related notes",
  uiUploading: "Uploading…",
  uiAddAttachment: "Add attachment",
  uiClearAttachments: "Clear attachments",
  uiReminderEllipsis: "Reminder…",
  uiUnpin: "Unpin",
  uiPin: "Pin",
  uiDelete: "Delete",
  uiTagsLabel: "Tags:",
  uiTagsAria: "Tags",
  uiLayoutSplitTitle: "Switch to side‑by‑side layout",
  uiLayoutStackTitle:
    "Switch to stacked layout (media on top, body scrolls below)",
  uiDropIncomplete:
    "Move didn’t finish… refresh and try dragging again?",
  uiDragHandleLoggedIn: "Drag to move this note",
  uiDragHandleGuest: "Sidebar (drag to reorder when signed in)",
  uiDragHintLoggedIn: "Drag onto another card or a collection in the sidebar",
  uiDragHintGuest: "Sign in to drag and reorder notes",
  uiTrashFromCollection: (path) => `Originally in: ${path}`,
  uiTrashRestore: "Restore to collection",
  uiTrashDeleteForever: "Delete permanently",
  uiRelatedSourceMissing: "This note seems to be gone…",
  uiRelatedEmptySearch:
    "No links yet — search below and tap to add by similarity.",
  uiRelatedEmptyPlain: "No linked notes yet.",
  uiRelatedUnlink: "Remove link",
  uiRelatedUnlinkBroken: "Remove broken link",
  uiRelatedPeerMissing: "That note is missing or unavailable",
  uiRelatedPasteLabel: "Add link",
  uiRelatedSearchPlaceholder:
    "Search notes (sorted by similarity to current content)…",
  uiRelatedNoResults: "No matches — try another keyword.",
  uiRelatedReadOnly: "Read-only: search and linking are disabled.",
  uiFileFallback: "File",
  uiLightboxPreview: "Preview",
  uiLightboxAria: (index, total) => `Preview item ${index} of ${total}`,
  uiPrevItem: "Previous",
  uiNextItem: "Next",
  uiPagination: "Slides",
  uiOpenInNewWindow: "Open in new window",
  uiSetCover: "Set as cover",
  uiCopyImage: "Copy image",
  uiDownloadAttachment: "Download attachment",
  uiDeleteAttachment: "Remove attachment",
  uiGalleryThumbTitleImageRich:
    "Click to enlarge; right‑click for image options",
  uiGalleryThumbTitleFileRich: "Click to view; right‑click for more",
  uiGalleryThumbTitleAudioRich:
    "Click to play audio; right‑click for more",
  uiGalleryThumbTitleVideoRich: "Click to enlarge; right‑click for more",
  uiGalleryThumbTitleImagePlain: "Click to enlarge; right‑click to copy image",
  uiGalleryThumbTitleFilePlain: "Click to view",
  uiGalleryThumbTitleAudioPlain: "Click to play audio",
  uiGalleryThumbTitleVideoPlain: "Click to enlarge",
  uiGalleryAriaVideo: "Play video",
  uiGalleryAriaImage: "View image",
  uiGalleryAriaAudio: "Play audio",
  uiGalleryAriaFile: "View file",
  uiExpandSubcollections: "Expand subcollections",
  uiCollapseSubcollections: "Collapse subcollections",
  uiCollectionNameAria: "Collection name",
  uiCollectionNameHint: "Double‑click to rename; right‑click to delete",
  uiAddSubcollectionAria: "Add subcollection",
  uiAddSubcollectionTitle: "Subcollection",
  uiDragCollectionAria: "Drag to reorder collections",
  uiDragCollectionTitle: "Drag to reorder",
  uiDeleteCollectionMenu: "Delete collection",
  uiDeleteCollectionDialogTitle: "Delete collection",
  uiDeleteCollectionWithSubtree: (name) =>
    `Delete “${name}” and all subfolders? Notes inside will be removed and can’t be restored.`,
  uiDeleteCollectionLeaf: (name) =>
    `Delete collection “${name}”? Notes inside will be removed.`,
  uiConfirmDelete: "Delete",
  uiHighlightAria: (colorLabel) => `${colorLabel} highlight`,
  adminBackToNotes: "← Back to notes",
  adminTitle: "User management",
  adminLead:
    "Create accounts, edit display name and login ID, bind email, change role, or reset password. Deleting a user removes their notes and attachments (cannot be undone).",
  adminNewUserHeading: "New user",
  adminLabelLoginId: "Login ID",
  adminPhLoginId: "2–32 letters, digits, or underscore",
  adminLabelPassword: "Initial password",
  adminPhPassword: "At least 4 characters",
  adminLabelDisplayName: "Display name",
  adminPhDisplayName: "Shown in sidebar; defaults to login ID if empty",
  adminLabelEmail: "Email (optional)",
  adminPhEmail: "Use for sign-in after binding",
  adminLabelRole: "Role",
  adminRoleUser: "Member",
  adminRoleSubscriber: "Subscriber",
  adminRoleAdmin: "Admin",
  adminCreating: "Creating…",
  adminCreateUser: "Create user",
  adminAllUsers: "All users",
  adminLoadingList: "Loading users…",
  adminThInternalId: "Internal ID",
  adminThNickname: "Name",
  adminThLoginId: "Login ID",
  adminThEmail: "Email",
  adminThRole: "Role",
  adminThResetPwd: "Reset password",
  adminThProfile: "Profile",
  adminThActions: "",
  adminPhUnbound: "Not bound",
  adminPhNewPassword: "New password",
  adminApplyPwd: "Apply",
  adminSave: "Save",
  adminDelete: "Delete",
  adminDeletionPending: "Cleaning up…",
  adminDeleteConfirm: (username) =>
    `Mark “${username}” for deletion? Cloud files are removed in the background; the row disappears when done.`,
  adminAriaDisplayName: (loginId) => `Display name for ${loginId}`,
  adminAriaLoginId: (loginId) => `Login ID for ${loginId}`,
  adminAriaEmail: (loginId) => `Email for ${loginId}`,
  adminAriaRole: (loginId) => `Role for ${loginId}`,
};

export function getScatteredUiChrome(lang: LoginUiLang): ScatteredUiChrome {
  return lang === "en" ? en : zh;
}
