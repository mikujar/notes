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
  /** 迁移脚本后：笔记设置主区域顶部提示（条目来自 noteSettingsPostMigrateHints.ts） */
  noteSettingsPostMigrateTitle: string;
  noteSettingsPostMigrateAria: string;
  noteSettingsPostMigrateJumpGeneral: string;
  noteSettingsPostMigrateJumpObjectTypes: string;
  noteSettingsPostMigrateJumpAutoLink: string;
  noteSettingsPlacementLabel: string;
  noteSettingsTop: string;
  noteSettingsBottom: string;
  /** 时间线列表正文是否折叠预览（两行） */
  noteSettingsFoldLabel: string;
  noteSettingsFoldHint: string;
  noteSettingsFoldOff: string;
  noteSettingsFoldOn: string;
  noteSettingsFoldAria: string;
  /** 时间线分栏：附件轮播在左或右 */
  noteSettingsGallerySideLabel: string;
  noteSettingsGallerySideAria: string;
  noteSettingsGalleryRight: string;
  noteSettingsGalleryLeft: string;
  /** 清除无正文、无附件、无标签互链提醒置顶且自定义属性全空的卡片 */
  noteSettingsPurgeBlankTitle: string;
  noteSettingsPurgeBlankHint: string;
  noteSettingsPurgeBlankBtn: string;
  noteSettingsPurgeBlankBusy: string;
  noteSettingsPurgeBlankNone: string;
  noteSettingsPurgeBlankConfirm: (n: number) => string;
  noteSettingsPurgeBlankDone: (n: number) => string;
  noteSettingsStorageLabel: string;
  noteSettingsLocal: string;
  noteSettingsCloud: string;
  noteSettingsPlacementAria: string;
  noteSettingsSidebarDotsLabel: string;
  noteSettingsSidebarDotsShow: string;
  noteSettingsSidebarDotsHide: string;
  noteSettingsSidebarDotsAria: string;
  noteSettingsStorageAria: string;
  /** 保存笔记时按预设自动创建关联卡片的规则 */
  noteSettingsAutoLinkTitle: string;
  noteSettingsAutoLinkLead: string;
  noteSettingsAutoLinkLocalHint: string;
  /** 自动建卡规则行：无障碍名称前缀 */
  noteSettingsAutoLinkRuleAria: string;
  /** 云端同步偏好失败（仍保留在本浏览器） */
  noteSettingsAutoLinkSyncErr: string;
  /** 侧栏：自动建卡 */
  noteSettingsNavAutoLink: string;
  noteSettingsAutoLinkPanelTitle: string;
  noteSettingsAutoLinkPanelLead: string;
  noteSettingsAutoLinkSectionBuiltin: string;
  /** 内置「剪藏作者→人物」规则：指定新人物卡落在哪个合集 */
  noteSettingsAutoLinkCreatorTargetTitle: string;
  noteSettingsAutoLinkCreatorTargetXhs: string;
  noteSettingsAutoLinkCreatorTargetBili: string;
  noteSettingsAutoLinkCreatorTargetDefault: string;
  noteSettingsAutoLinkSectionCustom: string;
  noteSettingsAutoLinkSourceKind: string;
  noteSettingsAutoLinkSourcePreset: string;
  noteSettingsAutoLinkAnyPreset: string;
  noteSettingsAutoLinkTargetKind: string;
  noteSettingsAutoLinkTargetPreset: string;
  noteSettingsAutoLinkTargetCollection: string;
  noteSettingsAutoLinkLinkType: string;
  noteSettingsAutoLinkAdd: string;
  noteSettingsAutoLinkDelete: string;
  noteSettingsAutoLinkErrSource: string;
  noteSettingsAutoLinkErrTarget: string;
  noteSettingsAutoLinkCollectionsHint: string;
  /** 自动建卡：将新卡写回源卡上的 cardLink 属性 */
  noteSettingsAutoLinkSyncField: string;
  noteSettingsAutoLinkSyncFieldNone: string;
  noteSettingsAutoLinkSyncFieldEmpty: string;
  noteSettingsAutoLinkSyncFieldNoCardLink: string;
  /** 自定义规则：四步说明与步骤标题 */
  noteSettingsAutoLinkFourStepsHint: string;
  noteSettingsAutoLinkStep1: string;
  noteSettingsAutoLinkStep2: string;
  noteSettingsAutoLinkStep3: string;
  noteSettingsAutoLinkStep4: string;
  noteSettingsAutoLinkPickSourceColFirst: string;
  noteSettingsAutoLinkPickTargetColFirst: string;
  noteSettingsAutoLinkErrFourSteps: string;
  noteSettingsAutoLinkErrSameCollection: string;
  /** 笔记设置内「导入笔记」区块标题 */
  noteSettingsImportSectionLabel: string;
  noteSettingsImportSourceAria: string;
  noteSettingsImportSourcePlaceholder: string;
  noteSettingsImportSourceApple: string;
  noteSettingsImportSourceFlomo: string;
  noteSettingsImportSourceEvernote: string;
  noteSettingsImportSourceYuque: string;
  /** 大页面左侧：通用设置 */
  noteSettingsNavGeneral: string;
  /** 大页面左侧：对象类型预设 */
  noteSettingsNavObjectTypes: string;
  noteSettingsObjectTypesTitle: string;
  noteSettingsObjectTypesLead: string;
  /** 对象类型：一键启用目录内全部预设（云端） */
  noteSettingsEnableAllPresets: string;
  noteSettingsEnableAllPresetsBusy: string;
  /** 将当前代码目录中的字段定义写回已启用的内置类型合集（不删合集、不动卡片归属） */
  noteSettingsSyncBuiltinSchemaTitle: string;
  noteSettingsSyncBuiltinSchemaDesc: string;
  noteSettingsSyncBuiltinSchemaBtn: string;
  noteSettingsSyncBuiltinSchemaBusy: string;
  noteSettingsSyncBuiltinSchemaResult: (updated: number, failed: number) => string;
  /** 对象类型 · 第一层：类型（笔记/文件/主题/任务/网页/其他） */
  noteSettingsObjectTypesSectionTypes: string;
  /** 将 related_refs JSON 迁入 card_links */
  noteSettingsMigrateRelatedRefsTitle: string;
  noteSettingsMigrateRelatedRefsDesc: string;
  noteSettingsMigrateRelatedRefsBtn: string;
  noteSettingsMigrateRelatedRefsBusy: string;
  noteSettingsMigrateRelatedRefsResult: (withJson: number, migrated: number) => string;
  /** 扩展写入的「小红书」「bilibili」标签笔记 → 剪藏预设卡 */
  noteSettingsMigrateClipTaggedTitle: string;
  noteSettingsMigrateClipTaggedDesc: string;
  noteSettingsMigrateClipTaggedBtn: string;
  noteSettingsMigrateClipTaggedBusy: string;
  noteSettingsMigrateClipTaggedResult: (
    scanned: number,
    migrated: number,
    skippedNoPreset: number,
    skippedNoKind: number,
    errors: number,
    backfillTitles: number
  ) => string;
  /** 文件卡：正文首行或附件名 → 属性「标题」 */
  noteSettingsMigrateFileTitlesTitle: string;
  noteSettingsMigrateFileTitlesDesc: string;
  noteSettingsMigrateFileTitlesBtn: string;
  noteSettingsMigrateFileTitlesBusy: string;
  noteSettingsMigrateFileTitlesNone: string;
  noteSettingsMigrateFileTitlesConfirm: (n: number) => string;
  noteSettingsMigrateFileTitlesResult: (
    fileCards: number,
    eligible: number,
    updated: number,
    failed: number
  ) => string;
  /** 对象类型页标题栏右侧：添加自定义类型 */
  noteSettingsAddCustomType: string;
  /** 自定义对象类型弹窗 */
  noteSettingsCustomTypeTitleCreate: string;
  noteSettingsCustomTypeTitleEdit: string;
  noteSettingsCustomTypeName: string;
  noteSettingsCustomTypeNamePh: string;
  noteSettingsCustomTypeParent: string;
  noteSettingsCustomTypeParentTop: string;
  noteSettingsCustomTypeFields: string;
  noteSettingsCustomTypeAddField: string;
  noteSettingsCustomTypeFieldName: string;
  noteSettingsCustomTypeFieldType: string;
  noteSettingsCustomTypeSave: string;
  noteSettingsCustomTypeCancel: string;
  noteSettingsCustomTypeErrName: string;
  noteSettingsCustomTypeErrRemote: string;
  noteSettingsCustomTypeSectionCustom: string;
  noteSettingsCustomTypeEditSchema: string;
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
  noteSettingsHint: "",
  noteSettingsPostMigrateTitle: "迁移 / 发版后请在应用内配合的操作",
  noteSettingsPostMigrateAria: "数据库或发版后的设置内操作提示",
  noteSettingsPostMigrateJumpGeneral: "打开「通用」",
  noteSettingsPostMigrateJumpObjectTypes: "打开「合集模板」",
  noteSettingsPostMigrateJumpAutoLink: "打开「自动建卡」",
  noteSettingsPlacementLabel: "新建笔记位置",
  noteSettingsTop: "时间线顶部",
  noteSettingsBottom: "时间线底部",
  noteSettingsFoldLabel: "笔记折叠（时间线）",
  noteSettingsFoldHint: "",
  noteSettingsFoldOff: "关闭",
  noteSettingsFoldOn: "开启",
  noteSettingsFoldAria: "时间线笔记正文是否折叠预览",
  noteSettingsGallerySideLabel: "时间线中的附件栏",
  noteSettingsGallerySideAria: "有附件的笔记在时间线中附件显示在左侧或右侧",
  noteSettingsGalleryRight: "右侧",
  noteSettingsGalleryLeft: "左侧",
  noteSettingsPurgeBlankTitle: "空白卡片",
  noteSettingsPurgeBlankHint:
    "将符合条件的卡片移入回收站：无有效正文、无附件、无标签与互链、无提醒与置顶，且自定义属性均无有效值。",
  noteSettingsPurgeBlankBtn: "清除空白卡片",
  noteSettingsPurgeBlankBusy: "正在清除…",
  noteSettingsPurgeBlankNone: "当前没有符合条件的空白卡片。",
  noteSettingsPurgeBlankConfirm: (n) =>
    `确定将 ${n} 张空白卡片移入回收站吗？`,
  noteSettingsPurgeBlankDone: (n) => `已移入回收站 ${n} 张空白卡片。`,
  noteSettingsStorageLabel: "数据存储位置",
  noteSettingsLocal: "本地（此设备）",
  noteSettingsCloud: "云端",
  noteSettingsPlacementAria: "新建笔记位置",
  noteSettingsSidebarDotsLabel: "合集前的圆点",
  noteSettingsSidebarDotsShow: "显示",
  noteSettingsSidebarDotsHide: "隐藏",
  noteSettingsSidebarDotsAria: "侧栏合集名称前的彩色圆点",
  noteSettingsStorageAria: "数据存储位置",
  noteSettingsAutoLinkTitle: "自动建卡规则",
  noteSettingsAutoLinkLead:
    "保存卡片时，可按已启用类型的预设自动创建关联对象（例如剪藏卡关联人物卡与链接对象）。你可单独关闭某条规则；未在列表中的规则来自合集 schema，仍随类型预设生效。",
  noteSettingsAutoLinkLocalHint:
    "当前为仅本地数据时，偏好会保存在本浏览器；改用云端后会在保存笔记时由服务器执行相应规则。",
  noteSettingsAutoLinkRuleAria: "自动建卡规则",
  noteSettingsAutoLinkSyncErr: "偏好未能同步到云端，已暂存于本机。",
  noteSettingsNavAutoLink: "自动建卡",
  noteSettingsAutoLinkPanelTitle: "自动建卡",
  noteSettingsAutoLinkPanelLead:
    "保存到云端时，可按下面「自定义规则」自动新建一张关联卡并互链。预设模板自带的规则可在上方单独关闭。",
  noteSettingsAutoLinkSectionBuiltin: "预设模板中的规则",
  noteSettingsAutoLinkCreatorTargetTitle: "剪藏作者建卡目标合集",
  noteSettingsAutoLinkCreatorTargetXhs: "小红书作者（creator）",
  noteSettingsAutoLinkCreatorTargetBili: "B 站 UP 主（creator）",
  noteSettingsAutoLinkCreatorTargetDefault: "默认（人物预设合集）",
  noteSettingsAutoLinkSectionCustom: "自定义规则",
  noteSettingsAutoLinkSourceKind: "当源卡形态为",
  noteSettingsAutoLinkSourcePreset: "且归属预设（可选）",
  noteSettingsAutoLinkAnyPreset: "不限",
  noteSettingsAutoLinkTargetKind: "则新建对象形态",
  noteSettingsAutoLinkTargetPreset: "放入预设类型（按名称解析合集）",
  noteSettingsAutoLinkTargetCollection: "或指定合集",
  noteSettingsAutoLinkLinkType: "连接类型",
  noteSettingsAutoLinkAdd: "添加规则",
  noteSettingsAutoLinkDelete: "删除",
  noteSettingsAutoLinkErrSource: "请至少选择源卡形态或归属预设之一。",
  noteSettingsAutoLinkErrTarget: "请选择新建卡的形态，并选择预设类型或指定合集之一。",
  noteSettingsAutoLinkCollectionsHint: "启用云端并加载合集树后，可选择具体合集。",
  noteSettingsAutoLinkSyncField: "写入源卡属性（可选）",
  noteSettingsAutoLinkSyncFieldNone: "不写入",
  noteSettingsAutoLinkSyncFieldEmpty: "请先选择源卡形态或归属预设，以加载该类型的属性列表。",
  noteSettingsAutoLinkSyncFieldNoCardLink: "该类型预设中暂无「关联卡片」类属性，无法写回源卡字段。",
  noteSettingsAutoLinkFourStepsHint:
    "按顺序选四项即可：源合集 → 该合集上要关联的属性 → 目标合集 → 目标合集上的属性（仅列出类型里的「关联卡片」字段）。保存源笔记时，若没有对应关联卡会自动在目标合集建卡并双向写入这两个属性。",
  noteSettingsAutoLinkStep1: "① 源合集（笔记当前所在的文件夹）",
  noteSettingsAutoLinkStep2: "② 源合集上的属性",
  noteSettingsAutoLinkStep3: "③ 目标合集（新卡片放在这里）",
  noteSettingsAutoLinkStep4: "④ 目标合集上的属性",
  noteSettingsAutoLinkPickSourceColFirst: "请先选择源合集。",
  noteSettingsAutoLinkPickTargetColFirst: "请先选择目标合集。",
  noteSettingsAutoLinkErrFourSteps: "请完整选择四个选项。",
  noteSettingsAutoLinkErrSameCollection: "源合集与目标合集不能是同一个。",
  noteSettingsImportSectionLabel: "导入笔记",
  noteSettingsImportSourceAria: "导入来源",
  noteSettingsImportSourcePlaceholder: "选择导入来源…",
  noteSettingsImportSourceApple: "Apple 备忘录",
  noteSettingsImportSourceFlomo: "flomo",
  noteSettingsImportSourceEvernote: "印象笔记 / Evernote",
  noteSettingsImportSourceYuque: "语雀知识库",
  noteSettingsNavGeneral: "通用",
  noteSettingsNavObjectTypes: "合集模板",
  noteSettingsObjectTypesTitle: "合集模板",
  noteSettingsObjectTypesLead:
    "以下为内置合集模板目录（笔记、文件、主题、作品、剪藏、任务等）。剪藏含网页剪藏、小红书与 B 站；自动关联可为内容补建人物卡与网页剪藏卡。未添加的模板不会出现在侧栏。旧数据主要是笔记与附件；可在下方将附件迁为文件卡，或将仍留在 JSON 里的「相关笔记」迁入图谱边表。",
  noteSettingsEnableAllPresets: "添加全部合集模板",
  noteSettingsEnableAllPresetsBusy: "正在添加…",
  noteSettingsSyncBuiltinSchemaTitle: "同步内置类型的属性定义",
  noteSettingsSyncBuiltinSchemaDesc:
    "把当前应用版本里内置合集模板（人物、剪藏、文件子类等）的字段与自动建卡规则，写回你已添加的对应合集。不会删除合集或改变笔记放在哪个文件夹；仅更新「这类卡片有哪些属性」。自定义类型不受影响。",
  noteSettingsSyncBuiltinSchemaBtn: "从目录更新 schema",
  noteSettingsSyncBuiltinSchemaBusy: "正在更新…",
  noteSettingsSyncBuiltinSchemaResult: (updated, failed) =>
    `已更新 ${updated} 个内置类型合集${failed > 0 ? `，${failed} 个失败` : ""}。`,
  noteSettingsObjectTypesSectionTypes: "类型",
  noteSettingsMigrateRelatedRefsTitle: "迁移「相关笔记」到图谱边表",
  noteSettingsMigrateRelatedRefsDesc:
    "若数据库里仍有 cards.related_refs JSON，将一次性写入 card_links 并清空 JSON（面向对象图谱以边表为准）。",
  noteSettingsMigrateRelatedRefsBtn: "执行迁移",
  noteSettingsMigrateRelatedRefsBusy: "迁移中…",
  noteSettingsMigrateRelatedRefsResult: (withJson, migrated) =>
    `扫描 ${withJson} 张含 JSON 的卡片，完成 ${migrated} 张迁移。`,
  noteSettingsMigrateClipTaggedTitle: "剪藏标签笔记迁入合集模板",
  noteSettingsMigrateClipTaggedDesc:
    "将带「小红书」或「bilibili」标签的笔记（多为浏览器扩展保存）转为剪藏下的对应卡片：写入链接/作者等模板字段、去掉来源标签，并加入「小红书」「B 站」模板合集。需先在上方添加剪藏及对应子类型；其它合集内的归属会保留，仅从「未归类」移除。",
  noteSettingsMigrateClipTaggedBtn: "执行迁入",
  noteSettingsMigrateClipTaggedBusy: "迁入中…",
  noteSettingsMigrateClipTaggedResult: (
    scanned,
    migrated,
    skippedNoPreset,
    skippedNoKind,
    errors,
    backfillTitles
  ) =>
    `扫描 ${scanned} 张，已迁入 ${migrated} 张；未添加对应模板 ${skippedNoPreset} 张，未识别标签 ${skippedNoKind} 张，失败 ${errors} 张。` +
    (backfillTitles > 0 ? ` 已从正文补全剪藏「标题」${backfillTitles} 张。` : ""),
  noteSettingsMigrateFileTitlesTitle: "文件卡标题迁移",
  noteSettingsMigrateFileTitlesDesc:
    "对属性「标题」为空的文件卡：优先用正文第一行（例如以前的 ## 文件名）写入「标题」；正文没有可用文字时，再用首个附件的文件名。本地与云端均可执行；云端将逐张 PATCH 保存。",
  noteSettingsMigrateFileTitlesBtn: "执行迁移",
  noteSettingsMigrateFileTitlesBusy: "迁移中…",
  noteSettingsMigrateFileTitlesNone:
    "没有需要迁移的文件卡（均已填写标题，或正文与附件都无法推断标题）。",
  noteSettingsMigrateFileTitlesConfirm: (n) =>
    `将为 ${n} 张文件卡写入属性「标题」，是否继续？`,
  noteSettingsMigrateFileTitlesResult: (fileCards, eligible, updated, failed) =>
    `共 ${fileCards} 张文件卡，其中 ${eligible} 张待写入；已成功 ${updated} 张${failed > 0 ? `，失败 ${failed} 张` : ""}。`,
  noteSettingsAddCustomType: "添加自定义模板",
  noteSettingsCustomTypeTitleCreate: "新建合集模板",
  noteSettingsCustomTypeTitleEdit: "编辑合集模板与属性",
  noteSettingsCustomTypeName: "类型名称",
  noteSettingsCustomTypeNamePh: "例如：客户、书单…",
  noteSettingsCustomTypeParent: "归属位置",
  noteSettingsCustomTypeParentTop: "顶层类型（与笔记、剪藏同级）",
  noteSettingsCustomTypeFields: "卡片属性（Schema）",
  noteSettingsCustomTypeAddField: "添加属性",
  noteSettingsCustomTypeFieldName: "显示名称",
  noteSettingsCustomTypeFieldType: "类型",
  noteSettingsCustomTypeSave: "保存",
  noteSettingsCustomTypeCancel: "取消",
  noteSettingsCustomTypeErrName: "请填写类型名称。",
  noteSettingsCustomTypeErrRemote: "请先切换到云端同步后再管理合集模板。",
  noteSettingsCustomTypeSectionCustom: "自定义类型",
  noteSettingsCustomTypeEditSchema: "编辑属性",
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
  noteSettingsHint: "",
  noteSettingsPostMigrateTitle: "After migrations or releases",
  noteSettingsPostMigrateAria: "In-app steps after database or release changes",
  noteSettingsPostMigrateJumpGeneral: "Open General",
  noteSettingsPostMigrateJumpObjectTypes: "Open Collection templates",
  noteSettingsPostMigrateJumpAutoLink: "Open Auto-link rules",
  noteSettingsPlacementLabel: "New note placement",
  noteSettingsTop: "Top of timeline",
  noteSettingsBottom: "Bottom of timeline",
  noteSettingsFoldLabel: "Collapse note body (timeline)",
  noteSettingsFoldHint: "",
  noteSettingsFoldOff: "Off",
  noteSettingsFoldOn: "On",
  noteSettingsFoldAria: "Collapse timeline note body in the list",
  noteSettingsGallerySideLabel: "Attachments in timeline",
  noteSettingsGallerySideAria: "Show the attachment carousel on the left or right in timeline cards",
  noteSettingsGalleryRight: "Right",
  noteSettingsGalleryLeft: "Left",
  noteSettingsPurgeBlankTitle: "Blank cards",
  noteSettingsPurgeBlankHint:
    "Moves matching cards to trash: no body text, no attachments, no tags or links, no reminders or pin, and no meaningful custom properties.",
  noteSettingsPurgeBlankBtn: "Remove blank cards",
  noteSettingsPurgeBlankBusy: "Removing…",
  noteSettingsPurgeBlankNone: "No blank cards match right now.",
  noteSettingsPurgeBlankConfirm: (n) =>
    `Move ${n} blank card${n === 1 ? "" : "s"} to trash?`,
  noteSettingsPurgeBlankDone: (n) =>
    `Moved ${n} blank card${n === 1 ? "" : "s"} to trash.`,
  noteSettingsStorageLabel: "Data storage",
  noteSettingsLocal: "On this device",
  noteSettingsCloud: "Cloud",
  noteSettingsPlacementAria: "New note placement",
  noteSettingsSidebarDotsLabel: "Dots before collections",
  noteSettingsSidebarDotsShow: "Show",
  noteSettingsSidebarDotsHide: "Hide",
  noteSettingsSidebarDotsAria: "Color dots before collection names in the sidebar",
  noteSettingsStorageAria: "Data storage",
  noteSettingsAutoLinkTitle: "Auto-create linked cards",
  noteSettingsAutoLinkLead:
    "When you save a card, preset rules can silently create linked object cards (for example Clips → person + URL object). Turn off individual rules here. Rules not listed still come from collection schemas for enabled types.",
  noteSettingsAutoLinkLocalHint:
    "With local-only data, choices are stored in this browser; after switching to cloud, the server applies them when notes are saved.",
  noteSettingsAutoLinkRuleAria: "Auto-link rule",
  noteSettingsAutoLinkSyncErr: "Couldn’t sync preferences to the cloud; kept on this device.",
  noteSettingsNavAutoLink: "Auto-link",
  noteSettingsAutoLinkPanelTitle: "Auto-create linked cards",
  noteSettingsAutoLinkPanelLead:
    "When a note is saved to the cloud, custom rules below can auto-create a linked card. Turn off built-in preset rules in the section above if needed.",
  noteSettingsAutoLinkSectionBuiltin: "Rules from presets",
  noteSettingsAutoLinkCreatorTargetTitle: "Clip creator target collection",
  noteSettingsAutoLinkCreatorTargetXhs: "Xiaohongshu creator",
  noteSettingsAutoLinkCreatorTargetBili: "Bilibili uploader",
  noteSettingsAutoLinkCreatorTargetDefault: "Default (Person preset collection)",
  noteSettingsAutoLinkSectionCustom: "Custom rules",
  noteSettingsAutoLinkSourceKind: "When source card kind is",
  noteSettingsAutoLinkSourcePreset: "and under preset (optional)",
  noteSettingsAutoLinkAnyPreset: "Any",
  noteSettingsAutoLinkTargetKind: "create linked card of kind",
  noteSettingsAutoLinkTargetPreset: "in preset type (resolve collection)",
  noteSettingsAutoLinkTargetCollection: "or specific collection",
  noteSettingsAutoLinkLinkType: "Link type",
  noteSettingsAutoLinkAdd: "Add rule",
  noteSettingsAutoLinkDelete: "Remove",
  noteSettingsAutoLinkErrSource: "Pick at least a source card kind or a source preset.",
  noteSettingsAutoLinkErrTarget: "Pick the new card kind and either a preset type or a collection.",
  noteSettingsAutoLinkCollectionsHint: "Load the collection tree (cloud) to pick a folder.",
  noteSettingsAutoLinkSyncField: "Write back to source field (optional)",
  noteSettingsAutoLinkSyncFieldNone: "Don’t write",
  noteSettingsAutoLinkSyncFieldEmpty:
    "Choose a source card kind or preset first to load cardLink fields for that type.",
  noteSettingsAutoLinkSyncFieldNoCardLink:
    "This preset type has no cardLink fields in its schema.",
  noteSettingsAutoLinkFourStepsHint:
    "Pick four things in order: source collection → a cardLink field on that type → target collection → a cardLink field there. When you save the source card, a missing link creates a new card in the target folder and fills both fields.",
  noteSettingsAutoLinkStep1: "① Source collection (folder the note is in)",
  noteSettingsAutoLinkStep2: "② Field on the source type",
  noteSettingsAutoLinkStep3: "③ Target collection (new card goes here)",
  noteSettingsAutoLinkStep4: "④ Field on the target type",
  noteSettingsAutoLinkPickSourceColFirst: "Choose a source collection first.",
  noteSettingsAutoLinkPickTargetColFirst: "Choose a target collection first.",
  noteSettingsAutoLinkErrFourSteps: "Please fill in all four choices.",
  noteSettingsAutoLinkErrSameCollection: "Source and target collection must differ.",
  noteSettingsImportSectionLabel: "Import notes",
  noteSettingsImportSourceAria: "Import source",
  noteSettingsImportSourcePlaceholder: "Choose import source…",
  noteSettingsImportSourceApple: "Apple Notes",
  noteSettingsImportSourceFlomo: "flomo",
  noteSettingsImportSourceEvernote: "Evernote",
  noteSettingsImportSourceYuque: "Yuque",
  noteSettingsNavGeneral: "General",
  noteSettingsNavObjectTypes: "Collection templates",
  noteSettingsObjectTypesTitle: "Collection templates",
  noteSettingsObjectTypesLead:
    "Below is the built-in catalog of collection templates (notes, files, topics, works, clips, tasks, …). Clips include web bookmarks, Xiaohongshu, and Bilibili; auto-link can add person cards and bookmark clip cards when needed. Templates you haven't added stay out of the sidebar. Legacy data is mostly notes and attachments — migrate attachments to file cards below, or push any remaining related_refs JSON into card_links.",
  noteSettingsEnableAllPresets: "Add all collection templates",
  noteSettingsEnableAllPresetsBusy: "Adding…",
  noteSettingsSyncBuiltinSchemaTitle: "Sync built-in type fields",
  noteSettingsSyncBuiltinSchemaDesc:
    "Rewrite each added built-in collection-template’s card schema from the app catalog (person, clip, file subtypes, etc.). Does not delete collections or move cards; only updates which properties those types have. Custom types are skipped.",
  noteSettingsSyncBuiltinSchemaBtn: "Update schema from catalog",
  noteSettingsSyncBuiltinSchemaBusy: "Updating…",
  noteSettingsSyncBuiltinSchemaResult: (updated, failed) =>
    `Updated ${updated} built-in collection(s)${failed > 0 ? `; ${failed} failed` : ""}.`,
  noteSettingsObjectTypesSectionTypes: "Types",
  noteSettingsMigrateRelatedRefsTitle: "Migrate “related notes” JSON to graph edges",
  noteSettingsMigrateRelatedRefsDesc:
    "If cards.related_refs still has data, copy it into card_links once and clear the JSON column (the graph uses the edge table).",
  noteSettingsMigrateRelatedRefsBtn: "Run migration",
  noteSettingsMigrateRelatedRefsBusy: "Migrating…",
  noteSettingsMigrateRelatedRefsResult: (withJson, migrated) =>
    `Scanned ${withJson} card(s) with JSON; migrated ${migrated}.`,
  noteSettingsMigrateClipTaggedTitle: "Move clip-tagged notes into Clips",
  noteSettingsMigrateClipTaggedDesc:
    "Turn notes tagged 小红书 or bilibili (usually saved by the browser extension) into Clip template cards: preset URL/author fields, remove those tags, and add them to the Xiaohongshu / Bilibili template collections. Add Clips and the matching subtypes first. Placements in other folders are kept; only the inbox placement is removed when present.",
  noteSettingsMigrateClipTaggedBtn: "Run migration",
  noteSettingsMigrateClipTaggedBusy: "Migrating…",
  noteSettingsMigrateClipTaggedResult: (
    scanned,
    migrated,
    skippedNoPreset,
    skippedNoKind,
    errors,
    backfillTitles
  ) =>
    `Scanned ${scanned}; migrated ${migrated}. Skipped (preset off): ${skippedNoPreset}. Skipped (tags): ${skippedNoKind}. Errors: ${errors}.` +
    (backfillTitles > 0
      ? ` Filled missing Clip title from body for ${backfillTitles} card(s).`
      : ""),
  noteSettingsMigrateFileTitlesTitle: "File cards: fill Title property",
  noteSettingsMigrateFileTitlesDesc:
    "For file cards with an empty Title property: use the first line of the body (e.g. a former ## heading), or if that’s empty, the first attachment’s file name. Works in local and cloud mode; cloud saves each card via PATCH.",
  noteSettingsMigrateFileTitlesBtn: "Run migration",
  noteSettingsMigrateFileTitlesBusy: "Migrating…",
  noteSettingsMigrateFileTitlesNone:
    "No file cards need migration (titles already set, or no title could be inferred).",
  noteSettingsMigrateFileTitlesConfirm: (n) =>
    `Fill the Title property on ${n} file card(s)?`,
  noteSettingsMigrateFileTitlesResult: (fileCards, eligible, updated, failed) =>
    `${fileCards} file card(s) total; ${eligible} to update. Updated ${updated}.${failed > 0 ? ` Failed: ${failed}.` : ""}`,
  noteSettingsAddCustomType: "Add custom template",
  noteSettingsCustomTypeTitleCreate: "New collection template",
  noteSettingsCustomTypeTitleEdit: "Edit template & schema",
  noteSettingsCustomTypeName: "Type name",
  noteSettingsCustomTypeNamePh: "e.g. Customer, Reading list…",
  noteSettingsCustomTypeParent: "Place under",
  noteSettingsCustomTypeParentTop: "Top level (alongside Note, Clips, …)",
  noteSettingsCustomTypeFields: "Card properties (schema)",
  noteSettingsCustomTypeAddField: "Add property",
  noteSettingsCustomTypeFieldName: "Label",
  noteSettingsCustomTypeFieldType: "Type",
  noteSettingsCustomTypeSave: "Save",
  noteSettingsCustomTypeCancel: "Cancel",
  noteSettingsCustomTypeErrName: "Please enter a type name.",
  noteSettingsCustomTypeErrRemote: "Switch to cloud sync to manage collection templates.",
  noteSettingsCustomTypeSectionCustom: "Custom types",
  noteSettingsCustomTypeEditSchema: "Edit schema",
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
