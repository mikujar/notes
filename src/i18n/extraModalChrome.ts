import type { LoginUiLang } from "../auth/loginUiI18n";

export type ExtraModalChrome = {
  profileTitle: string;
  /** 「登录名」/ “Username” */
  profileBeforeUsername: string;
  /** 紧跟在用户名后的说明（中文无前置空格；英文在句首含空格） */
  profileAfterUsername: string;
  profileTermsOfService: string;
  profilePrivacyPolicy: string;
  profileNickname: string;
  profileEmail: string;
  profileEmailPlaceholder: string;
  profileSendCode: string;
  profileNewEmailCode: string;
  profileEmailCodePh: string;
  profileAvatar: string;
  profileNoAvatar: string;
  profileChooseImage: string;
  profileAvatarDisabledTitle: string;
  profileAvatarPendingHint: string;
  profileNewPassword: string;
  profileConfirmPassword: string;
  profilePwdPlaceholder: string;
  profilePwd2Placeholder: string;
  profileCancel: string;
  profileSave: string;
  profileErrNeedRemote: string;
  profileErrNickEmpty: string;
  profileErrNickLen: string;
  profileErrEmailFmt: string;
  profileErrPwdMismatch: string;
  profileErrPwdLen: string;
  profileErrNeedVerify: string;
  profileErrAvatarCos: string;
  profileFlashSaved: string;
  profileErrSaveFail: string;
  profileErrEmailEmpty: string;
  profileErrEmailFmt2: string;
  profileErrSameEmail: string;
  profileEmailSendOk: string;
  profileErrSendFail: string;
  profileDeleteAccount: string;
  /** 未展开删除流程时的一行说明 */
  profileDeleteEntryLead: string;
  profileDeleteHint: string;
  profileDeletePasswordLabel: string;
  profileDeletePasswordPlaceholder: string;
  profileDeleteConfirm: string;
  profileDeleting: string;
  profileErrDeleteNeedRemote: string;
  profileErrDeletePwd: string;
  profileErrDeleteFail: string;
  /** 收起删除确认区 */
  profileDeleteBack: string;
  noteSettingsTitle: string;
  noteSettingsHint: string;
  noteSettingsPlacementLabel: string;
  noteSettingsTop: string;
  noteSettingsBottom: string;
  noteSettingsStorageLabel: string;
  noteSettingsLocal: string;
  noteSettingsCloud: string;
  noteSettingsPlacementAria: string;
  noteSettingsSidebarDotsLabel: string;
  noteSettingsSidebarDotsShow: string;
  noteSettingsSidebarDotsHide: string;
  noteSettingsSidebarDotsAria: string;
  noteSettingsStorageAria: string;
  /** 笔记设置内「导入笔记」区块标题 */
  noteSettingsImportSectionLabel: string;
  noteSettingsImportSourceAria: string;
  noteSettingsImportSourcePlaceholder: string;
  noteSettingsImportSourceApple: string;
  noteSettingsImportSourceFlomo: string;
  noteSettingsImportSourceEvernote: string;
  noteSettingsImportSourceYuque: string;
  dataStatsTitle: string;
  dataStatsHint: string;
  dataStatsCollections: string;
  dataStatsCards: string;
  dataStatsAttachments: string;
  dataStatsAttachmentLine: (count: number, size: string) => string;
  dataStatsQuotaHead: string;
  dataStatsRoleAdmin: string;
  dataStatsRoleSubscriber: string;
  dataStatsRoleUser: string;
  dataStatsAdminUnlimited: string;
  dataStatsQuotaAria: string;
  dataStatsQuotaLine: (uploaded: string, limit: string, month: string) => string;
  dataStatsSingleFile: (max: string) => string;
  dataStatsDeleteNoRefund: string;
  calPrevMonth: string;
  calNextMonth: string;
  calAriaYear: string;
  calAriaMonth: string;
  calYearSuffix: string;
  calMonthSuffix: string;
  calWeekdays: readonly [string, string, string, string, string, string, string];
  reminderAriaPrefix: string;
  remPickerTitle: string;
  remPickerHint: string;
  /** 我的待办「新建」时提醒弹窗说明 */
  remPickerNewTaskHint: string;
  remPickerDateLabel: string;
  remPickerTimeLabel: string;
  remPickerNoteLabel: string;
  remPickerNotePlaceholder: string;
  remPickerCancel: string;
  remPickerClear: string;
  remPickerSave: string;
  allRemEmpty: string;
  allRemFooter: (n: number) => string;
  /** 待办列表中空正文的占位 */
  taskListUntitled: string;
  /** 待办行勾选：清除提醒 */
  taskListCompleteAria: string;
  completionTimelineTitle: string;
  completionTimelineEmpty: string;
  completionTimelineAria: string;
};

const zh: ExtraModalChrome = {
  profileTitle: "个人中心",
  profileBeforeUsername: "登录名",
  profileAfterUsername: "不可修改。绑定邮箱后可用邮箱登录。",
  profileTermsOfService: "用户协议",
  profilePrivacyPolicy: "隐私政策",
  profileNickname: "昵称",
  profileEmail: "邮箱",
  profileEmailPlaceholder: "留空可解绑；换绑新邮箱需验证",
  profileSendCode: "发送验证码",
  profileNewEmailCode: "新邮箱验证码",
  profileEmailCodePh: "6 位数字",
  profileAvatar: "头像",
  profileNoAvatar: "无",
  profileChooseImage: "选择图片",
  profileAvatarDisabledTitle: "头像功能还在备货中…",
  profileAvatarPendingHint: "保存时上传；不选则保持原头像",
  profileNewPassword: "新密码（可选）",
  profileConfirmPassword: "确认新密码",
  profilePwdPlaceholder: "不修改请留空",
  profilePwd2Placeholder: "",
  profileCancel: "取消",
  profileSave: "保存",
  profileErrNeedRemote: "先把数据模式切到云端同步，再保存喔～",
  profileErrNickEmpty: "昵称空空的，罐子会不晓得怎么叫你…",
  profileErrNickLen: "昵称太长啦，64 字以内就好～",
  profileErrEmailFmt: "邮箱格式好像不太对…",
  profileErrPwdMismatch: "两次密码对不上诶，再对一下？",
  profileErrPwdLen: "新密码至少 4 位嘛～",
  profileErrNeedVerify: "换邮箱要先点「发送验证码」，再填 6 位数字喔～",
  profileErrAvatarCos: "头像功能还在备货中，暂时换不了啦…",
  profileFlashSaved: "个人中心已保存～",
  profileErrSaveFail: "保存翻车啦，再试一次？",
  profileErrEmailEmpty: "先填上要绑定的邮箱嘛～",
  profileErrEmailFmt2: "邮箱格式好像不太对…再检查一下？",
  profileErrSameEmail: "就是这个邮箱啦，不用再验证一遍～",
  profileEmailSendOk: "验证码在路上啦，10 分钟内填进来就好～",
  profileErrSendFail: "验证码没发出去…等等再试？",
  profileDeleteAccount: "删除账号",
  profileDeleteEntryLead: "注销后无法恢复，点击下方后将要求输入登录密码确认。",
  profileDeleteHint:
    "提交后立即标记注销并禁止登录；云端附件将在后台队列中删除，完成后移除账号数据。若你是唯一管理员，需先转让或新建其他管理员后再删。",
  profileDeletePasswordLabel: "确认密码",
  profileDeletePasswordPlaceholder: "输入当前登录密码",
  profileDeleteConfirm: "永久删除账号",
  profileDeleting: "正在删除…",
  profileErrDeleteNeedRemote: "请先在「笔记设置」中切换到云端同步后再操作。",
  profileErrDeletePwd: "请输入登录密码以确认。",
  profileErrDeleteFail: "删除失败，请稍后再试。",
  profileDeleteBack: "返回",
  noteSettingsTitle: "笔记设置",
  noteSettingsHint:
    "调整新建笔记出现的位置、侧栏合集彩色圆点是否显示，以及笔记数据保存在本机还是云端。",
  noteSettingsPlacementLabel: "新建笔记位置",
  noteSettingsTop: "时间线顶部",
  noteSettingsBottom: "时间线底部",
  noteSettingsStorageLabel: "数据存储位置",
  noteSettingsLocal: "本地（此设备）",
  noteSettingsCloud: "云端",
  noteSettingsPlacementAria: "新建笔记位置",
  noteSettingsSidebarDotsLabel: "合集前的圆点",
  noteSettingsSidebarDotsShow: "显示",
  noteSettingsSidebarDotsHide: "隐藏",
  noteSettingsSidebarDotsAria: "侧栏合集名称前的彩色圆点",
  noteSettingsStorageAria: "数据存储位置",
  noteSettingsImportSectionLabel: "导入笔记",
  noteSettingsImportSourceAria: "导入来源",
  noteSettingsImportSourcePlaceholder: "选择导入来源…",
  noteSettingsImportSourceApple: "Apple 备忘录",
  noteSettingsImportSourceFlomo: "flomo",
  noteSettingsImportSourceEvernote: "印象笔记 / Evernote",
  noteSettingsImportSourceYuque: "语雀知识库",
  dataStatsTitle: "数据统计",
  dataStatsHint:
    "当前工作区内的合集、卡片与附件占用（按本机已记录或可推算的数据汇总）。",
  dataStatsCollections: "合集",
  dataStatsCards: "卡片",
  dataStatsAttachments: "附件",
  dataStatsAttachmentLine: (count, size) => `${count} 个 · ${size}`,
  dataStatsQuotaHead: "云端附件额度",
  dataStatsRoleAdmin: "站长",
  dataStatsRoleSubscriber: "订阅用户",
  dataStatsRoleUser: "普通用户",
  dataStatsAdminUnlimited:
    "站长账号不按普通/订阅额度；单文件大小仅受服务器配置上限（UPLOAD_MAX_MB）。",
  dataStatsQuotaAria: "本月附件上传用量",
  dataStatsQuotaLine: (uploaded, limit, month) =>
    `本月已上传 ${uploaded} / ${limit}（自然月 ${month}，月初重置）`,
  dataStatsSingleFile: (max) => `单文件上限 ${max}`,
  dataStatsDeleteNoRefund: "删除已上传的附件不会恢复当月额度。",
  calPrevMonth: "上一月",
  calNextMonth: "下一月",
  calAriaYear: "年（四位数字）",
  calAriaMonth: "月（1–12）",
  calYearSuffix: "年",
  calMonthSuffix: "月",
  calWeekdays: ["一", "二", "三", "四", "五", "六", "日"],
  reminderAriaPrefix: "提醒",
  remPickerTitle: "设置提醒",
  remPickerHint:
    "在侧栏日历中选中该日期时，这条笔记会出现在当日列表最上方的「提醒」区域。",
  remPickerNewTaskHint:
    "选好提醒日与时间后保存，会新建一条空笔记并带上这里的提醒备注（可在笔记里再写正文）。",
  remPickerDateLabel: "提醒日期",
  remPickerTimeLabel: "提醒时间（可选）",
  remPickerNoteLabel: "备注",
  remPickerNotePlaceholder: "添加备注…",
  remPickerCancel: "取消",
  remPickerClear: "清除提醒",
  remPickerSave: "保存",
  allRemEmpty:
    "还没有待办～点顶栏或底部「新建待办」添加；有提醒的笔记会出现在此，勾选左侧圆圈可完成并取消提醒。",
  allRemFooter: (n) =>
    `共 ${n} 条，按提醒日分组；勾选圆圈可完成并取消提醒，点文字区域可编辑笔记。`,
  taskListUntitled: "（无内容）",
  taskListCompleteAria: "完成并清除提醒",
  completionTimelineTitle: "完成记录",
  completionTimelineEmpty: "在左侧勾选待办后，完成时间会出现在这里。",
  completionTimelineAria: "待办完成时间轴",
};

const en: ExtraModalChrome = {
  profileTitle: "Profile",
  profileBeforeUsername: "Username",
  profileAfterUsername:
    " can’t be changed. After you bind an email, you can sign in with it.",
  profileTermsOfService: "Terms of service",
  profilePrivacyPolicy: "Privacy policy",
  profileNickname: "Display name",
  profileEmail: "Email",
  profileEmailPlaceholder:
    "Leave empty to unbind; changing email requires verification",
  profileSendCode: "Send code",
  profileNewEmailCode: "Verification code",
  profileEmailCodePh: "6-digit code",
  profileAvatar: "Avatar",
  profileNoAvatar: "—",
  profileChooseImage: "Choose image",
  profileAvatarDisabledTitle: "Avatar upload isn’t available yet.",
  profileAvatarPendingHint: "Uploaded on save; leave empty to keep current.",
  profileNewPassword: "New password (optional)",
  profileConfirmPassword: "Confirm password",
  profilePwdPlaceholder: "Leave blank to keep current",
  profilePwd2Placeholder: "",
  profileCancel: "Cancel",
  profileSave: "Save",
  profileErrNeedRemote: "Switch to cloud sync first, then save.",
  profileErrNickEmpty: "Please enter a display name.",
  profileErrNickLen: "Display name must be 64 characters or fewer.",
  profileErrEmailFmt: "That email doesn’t look valid.",
  profileErrPwdMismatch: "Passwords don’t match.",
  profileErrPwdLen: "New password must be at least 4 characters.",
  profileErrNeedVerify:
    "Tap Send code and enter the 6-digit code before changing email.",
  profileErrAvatarCos: "Avatar upload isn’t available in this environment.",
  profileFlashSaved: "Profile saved.",
  profileErrSaveFail: "Couldn’t save. Try again?",
  profileErrEmailEmpty: "Enter the email to bind first.",
  profileErrEmailFmt2: "Check the email format.",
  profileErrSameEmail: "That’s already your current email.",
  profileEmailSendOk: "Code sent — enter it within 10 minutes.",
  profileErrSendFail: "Couldn’t send code. Try again?",
  profileDeleteAccount: "Delete account",
  profileDeleteEntryLead:
    "This can’t be undone. You’ll be asked for your password next.",
  profileDeleteHint:
    "Your account is locked immediately; cloud files are removed in a background job, then the database row is deleted. If you’re the only admin, add another admin first.",
  profileDeletePasswordLabel: "Confirm password",
  profileDeletePasswordPlaceholder: "Enter your current password",
  profileDeleteConfirm: "Delete account permanently",
  profileDeleting: "Deleting…",
  profileErrDeleteNeedRemote: "Switch to cloud sync in Note settings first.",
  profileErrDeletePwd: "Enter your password to confirm.",
  profileErrDeleteFail: "Couldn’t delete. Try again.",
  profileDeleteBack: "Back",
  noteSettingsTitle: "Note settings",
  noteSettingsHint:
    "Choose where new notes appear, whether to show color dots before collection names in the sidebar, and whether data stays on this device or syncs to the cloud.",
  noteSettingsPlacementLabel: "New note placement",
  noteSettingsTop: "Top of timeline",
  noteSettingsBottom: "Bottom of timeline",
  noteSettingsStorageLabel: "Data storage",
  noteSettingsLocal: "On this device",
  noteSettingsCloud: "Cloud",
  noteSettingsPlacementAria: "New note placement",
  noteSettingsSidebarDotsLabel: "Dots before collections",
  noteSettingsSidebarDotsShow: "Show",
  noteSettingsSidebarDotsHide: "Hide",
  noteSettingsSidebarDotsAria: "Color dots before collection names in the sidebar",
  noteSettingsStorageAria: "Data storage",
  noteSettingsImportSectionLabel: "Import notes",
  noteSettingsImportSourceAria: "Import source",
  noteSettingsImportSourcePlaceholder: "Choose import source…",
  noteSettingsImportSourceApple: "Apple Notes",
  noteSettingsImportSourceFlomo: "flomo",
  noteSettingsImportSourceEvernote: "Evernote",
  noteSettingsImportSourceYuque: "Yuque",
  dataStatsTitle: "Usage stats",
  dataStatsHint:
    "Collections, cards, and attachment size in this workspace (from local data).",
  dataStatsCollections: "Collections",
  dataStatsCards: "Cards",
  dataStatsAttachments: "Attachments",
  dataStatsAttachmentLine: (count, size) => `${count} · ${size}`,
  dataStatsQuotaHead: "Cloud attachment quota",
  dataStatsRoleAdmin: "Admin",
  dataStatsRoleSubscriber: "Subscriber",
  dataStatsRoleUser: "Standard",
  dataStatsAdminUnlimited:
    "Admin accounts aren’t limited by subscriber quotas; per-file max follows server settings (UPLOAD_MAX_MB).",
  dataStatsQuotaAria: "Upload usage this month",
  dataStatsQuotaLine: (uploaded, limit, month) =>
    `This month: ${uploaded} / ${limit} (month ${month}, resets at month start)`,
  dataStatsSingleFile: (max) => `Max file size ${max}`,
  dataStatsDeleteNoRefund: "Deleting uploads doesn’t refund this month’s quota.",
  calPrevMonth: "Previous month",
  calNextMonth: "Next month",
  calAriaYear: "Year (four digits)",
  calAriaMonth: "Month (1–12)",
  calYearSuffix: " / ",
  calMonthSuffix: "",
  calWeekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  reminderAriaPrefix: "Reminder",
  remPickerTitle: "Reminder",
  remPickerHint:
    "When you pick this day in the sidebar calendar, this note appears in the Reminders section at the top of that day.",
  remPickerNewTaskHint:
    "Save to create an empty note with the reminder date, time, and note below — then add the body in the editor.",
  remPickerDateLabel: "Reminder date",
  remPickerTimeLabel: "Time (optional)",
  remPickerNoteLabel: "Note",
  remPickerNotePlaceholder: "Add a note…",
  remPickerCancel: "Cancel",
  remPickerClear: "Clear reminder",
  remPickerSave: "Save",
  allRemEmpty:
    "No tasks yet — add with “New task” in the header or at the bottom. Notes with reminders appear here; check the circle to complete and clear the reminder.",
  allRemFooter: (n) =>
    `${n} task(s), grouped by date — check the circle to complete and clear the reminder; tap the text to edit.`,
  taskListUntitled: "(Empty)",
  taskListCompleteAria: "Complete and clear reminder",
  completionTimelineTitle: "Completed",
  completionTimelineEmpty: "Check off a task on the left — completion times show up here.",
  completionTimelineAria: "Completion timeline",
};

export function getExtraModalChrome(lang: LoginUiLang): ExtraModalChrome {
  return lang === "en" ? en : zh;
}
