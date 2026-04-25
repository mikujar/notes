export type NoteMediaKind = "image" | "video" | "audio" | "file";

/** 关联的另一张卡片所在位置（与对应卡片上的关联互为反向引用） */
export type NoteCardRelatedRef = {
  colId: string;
  cardId: string;
  /** 来自 card_links.link_type（如 creator、source）；旧数据可能无此字段 */
  linkType?: string;
};

export type NoteMediaItem = {
  url: string;
  kind: NoteMediaKind;
  /** 展示用原始文件名（上传/COS 存储路径仍为随机名） */
  name?: string;
  /** 音频内嵌封面；个别视频数据也可能仅有此项作列表海报，UI 会与 thumbnailUrl 一并尝试 */
  coverUrl?: string;
  /** 列表预览小图 URL：视频截帧、图片 WebP、PDF 首页；灯箱仍用 `url` 原文件 */
  thumbnailUrl?: string;
  /** 附件字节数（上传时写入；旧数据可能缺失） */
  sizeBytes?: number;
  /** 音/视频时长（秒，整数；上传 finalize 时写入；旧数据可能缺失） */
  durationSec?: number;
  /** 图片或视频像素宽（与 heightPx 成对；上传或客户端探测后写入） */
  widthPx?: number;
  /** 图片或视频像素高 */
  heightPx?: number;
};

export type CardPropertyType =
  | "text"
  | "number"
  /** 原单选/多选合并：值为 string[] | null */
  | "choice"
  /** 关联合集路径：值为合集 id 的 string[] | null，不修改笔记实际归属 */
  | "collectionLink"
  /** 关联其它卡片（单或多）：值为 CardLinkRef[] | null；UI 统一渲染为 chip 列表 */
  | "cardLink"
  | "date"
  | "checkbox"
  | "url";

/** custom_props 中 cardLink 类型的取值 */
export type CardLinkRef = {
  colId: string;
  cardId: string;
};

export type CardPropertyOption = {
  id: string;
  name: string;
  color: string;
};

export type CardProperty = {
  id: string;
  name: string;
  type: CardPropertyType;
  value: string | number | boolean | string[] | CardLinkRef[] | null;
  options?: CardPropertyOption[];
  /** cardLink 自定义属性：新建关联卡时优先放入该合集；空值表示沿用默认逻辑 */
  targetCollectionId?: string;
  /**
   * 可选：`cardLink` 尚未指向卡片时，供服务端自动关联（如人物卡）生成初始标题。
   * 浏览器剪藏扩展写入；合并关联引用后仍可保留或手动清理。
   */
  seedTitle?: string;
};

/** 卡片对象类型：默认 note；file/link 等为后续对象化扩展预留 */
export type NoteObjectKind = string;

export type NoteCard = {
  id: string;
  /** 对象类型（默认笔记）；与类别合集 schema 配合 */
  objectKind?: NoteObjectKind;
  /** 卡片标题(可空)。文件卡:文件名;剪藏卡:页面标题;人物卡:姓名;笔记卡:用户填的话题。 */
  title?: string;
  /** 一段或多行笔记正文，无标题 */
  text: string;
  /** 当天内分钟数，用于排序与角标 HH:mm */
  minutesOfDay: number;
  /** 日历日 YYYY-MM-DD，用于按日浏览；新建笔记建议始终带 */
  addedOn?: string;
  /** 提醒日 YYYY-MM-DD；在日历中选该日时，该卡片出现在当日列表顶部「提醒」区 */
  reminderOn?: string;
  /** 提醒时间 HH:mm（可选） */
  reminderTime?: string;
  /** 提醒备注（可选，自由文本） */
  reminderNote?: string;
  /** 在「我的待办」勾选完成时记录（ISO 8601）；时间线卡片上原「提醒…」旁注改为展示该完成时刻 */
  reminderCompletedAt?: string;
  /** 勾选完成时快照的提醒备注（用于「完成记录」；此时 active 的 reminderNote 已清除） */
  reminderCompletedNote?: string;
  /** 置顶后固定显示在当前合集列表最上方 */
  pinned?: boolean;
  /** 展示在正文下方的标签（非正文；多个用中文/英文逗号录入） */
  tags?: string[];
  /** 与本条互相关联的其它卡片（存 colId + cardId） */
  relatedRefs?: NoteCardRelatedRef[];
  /** 右侧轮播：图片、视频、音频或任意文件链接 */
  media?: NoteMediaItem[];
  /** 用户自定义属性列表（每张卡片独立定义） */
  customProps?: CardProperty[];
  /**
   * 客户端临时桩(stub):懒加载模式下"全部笔记"等聚合视图,服务端只返回精简版
   * (snippet 等),前端用 stub 占位渲染。stub 卡的 text 是 snippet 截断版,
   * 不是真实正文,**绝对不能作为正文写回服务端**(否则原始正文被覆盖)。
   * 真实卡片(从 col.cards 取)不会带这个标志。
   */
  isStub?: boolean;
};

// ─── Schema Field ───────────────────────────────────────────────────────────

export type SchemaFieldType =
  | "text"
  | "number"
  | "choice"
  | "date"
  | "checkbox"
  | "url"
  | "collectionLink"
  | "cardLink";

/**
 * 合集类型 schema 中的单个属性定义。
 * 卡片归属该合集时，此字段会在属性面板顶部预先展示。
 */
export type SchemaField = {
  /** 稳定 UUID；与 CardProperty.id 对应，用于 schema 字段与卡片属性的匹配 */
  id: string;
  name: string;
  type: SchemaFieldType;
  required?: boolean;
  /** 仅展示，不允许编辑（如视频时长 / 分辨率，由媒体自动探测） */
  readonly?: boolean;
  /** choice 类型的可选项（复用 CardPropertyOption） */
  options?: CardPropertyOption[];
  /** 在 schema 字段列表中的显示顺序 */
  order: number;
  /**
   * `cardLink`：可从 `card_links` 的该边类型取对端卡片作为默认值（如 creator → 人物）
   */
  cardLinkFromEdge?: "creator" | "source";
};

// ─── Auto-Link Rule ─────────────────────────────────────────────────────────

export type AutoLinkRuleTrigger = "on_create" | "on_save";

/** 单条自动关联目标（多目标规则中的一步） */
export type AutoLinkTarget = {
  /** 在同一 ruleId 内唯一，用于合并 schema 与幂等判断辅助 */
  targetKey: string;
  targetObjectKind: string;
  linkType: string;
  targetPresetTypeId?: string;
  /** 新卡放入指定合集（优先于 targetPresetTypeId） */
  targetCollectionId?: string;
  /** 将新关联卡写入源卡 custom_props 中对应 schema 字段 id（通常为 cardLink） */
  syncSchemaFieldId?: string;
  /** 在新关联卡上写入指向源卡的 cardLink */
  targetSyncSchemaFieldId?: string;
};

/**
 * 合集 schema 中的自动关联卡片规则。
 * 卡片保存时，服务端检查是否已有匹配的关联卡片；若无则静默创建并双向连接。
 * 多目标：设 `targets`；单目标可仍用 `targetObjectKind` + `linkType`（与旧数据兼容）。
 */
export type AutoLinkRule = {
  /** 规则唯一键，防止重复执行 */
  ruleId: string;
  trigger: AutoLinkRuleTrigger;
  /**
   * 仅当源卡 object_kind 匹配时执行（未设置则不限，用于内置 schema 规则）。
   * 用户自定义规则建议至少与 sourcePresetTypeId 二选一。
   */
  sourceObjectKind?: string;
  /**
   * 仅当源卡至少有一个归属合集的父链上出现该 preset_type_id 时执行。
   */
  sourcePresetTypeId?: string;
  /**
   * 仅当源卡**直接**归属该合集（placements 含此 id）时执行；与设置里「源合集」一致。
   */
  sourceCollectionId?: string;
  /** 要自动创建的卡片的 objectKind（如 'person', 'file_video'） */
  targetObjectKind?: string;
  /** 连接边的 link_type（如 'creator', 'attachment', 'source'） */
  linkType?: string;
  /**
   * 新卡片放入哪个预设类型合集（通过 collections.preset_type_id 匹配）。
   * 未设置时放入源卡片的第一个合集。
   */
  targetPresetTypeId?: string;
  /**
   * 新卡片直接放入指定合集 id（若通过校验）；与 targetPresetTypeId 同时存在时优先此项。
   */
  targetCollectionId?: string;
  /**
   * 单目标简写：新建关联卡后把引用写入源卡上该 schema 字段（须为 cardLink，且与源卡归属预设字段一致）。
   */
  syncSchemaFieldId?: string;
  /**
   * 在目标卡上写入指向源卡的 cardLink（与 syncSchemaFieldId 成对，简单四步规则用）。
   */
  targetSyncSchemaFieldId?: string;
  /** 一次保存创建多张关联卡（如投稿 → 人物 + 链接对象） */
  targets?: AutoLinkTarget[];
  labelZh?: string;
  labelEn?: string;
};

/** 笔记设置中的用户偏好（本地缓存 + 云端 /api/me/note-prefs） */
export type UserNotePrefs = {
  /** 禁用的预设 autoLink ruleId；未列出的规则在保存卡片时仍会执行 */
  disabledAutoLinkRuleIds: string[];
  /** 高级：追加自定义 AutoLinkRule（与开发者文档中的结构一致） */
  extraAutoLinkRules?: AutoLinkRule[];
  /**
   * 内置剪藏作者自动建卡的目标合集覆盖：
   * - post_xhs: 小红书作者（creator/person）建卡放入该合集
   * - post_bilibili: B 站 UP 主（creator/person）建卡放入该合集
   * 未设置时沿用系统默认（人物预设合集）。
   */
  clipCreatorTargetCollectionByPreset?: Partial<
    Record<"post_xhs" | "post_bilibili", string>
  >;
  /**
   * 时间线左右分栏时附件轮播是否在右侧；缺省或 true 为右侧（历史行为），false 为左侧。
   */
  timelineGalleryOnRight?: boolean;
  /**
   * 是否启用 Sunrise Glow 全局渐变背景；缺省或 true 为启用，false 为纯色奶油底。
   */
  bgGradient?: boolean;
};

// ─── Collection Card Schema ──────────────────────────────────────────────────

/** 类别合集上的字段定义（JSON，服务端存储；子合集可继承并扩展） */
export type CollectionCardSchema = {
  /** 属性字段模板（按 order 排序展示在卡片属性面板顶部） */
  fields?: SchemaField[];
  /** 保存时自动创建关联卡片的规则 */
  autoLinkRules?: AutoLinkRule[];
  /** schema 版本号，从 1 开始；0 或未设置视为旧数据 */
  version?: number;
};

export type CollectionIconShape =
  | "dot"
  | "square"
  | "triangle"
  | "diamond"
  | "star"
  | "cross"
  | "check"
  | "heart"
  | "moon"
  | "lightning"
  | "clover"
  | "flower"
  | "plus"
  | "bell"
  | "bookmark"
  | "fish"
  | "paw"
  | "rocket"
  | "sword"
  | "crown"
  | "music"
  | "cloud"
  | "skull"
  | "fire"
  | "calendar"
  | "link"
  | "trash";

export type Collection = {
  id: string;
  name: string;
  /** 侧栏列表前的彩色图标颜色（任意合法 CSS 颜色；默认圆点形状） */
  dotColor: string;
  /** 侧栏列表前图标形状；缺省或未知值视为圆点 */
  iconShape?: CollectionIconShape;
  /** 主区灰色说明文案（可双击编辑；未设置时用默认文案） */
  hint?: string;
  /** 是否为「类别」合集（对象类型容器） */
  isCategory?: boolean;
  /** 该合集下卡片的 schema（字段模板） */
  cardSchema?: CollectionCardSchema;
  /** 预设类型标识（如 work/post 子类），可选 */
  presetTypeId?: string;
  /** 小笔记列表（每张卡自带时刻与日期） */
  cards: NoteCard[];
  /** 子合集（侧栏树形折叠展示） */
  children?: Collection[];
  /** 懒加载模式专用：该合集直接拥有的卡片数（服务端 meta 提供）。
   *  cards[] 可能是空数组（还没懒拉），但这个字段仍是权威数。 */
  cardCount?: number;
  /** 懒加载模式专用：子树累加的卡片总数（含子合集） */
  totalCardCount?: number;
};

/** 侧栏垃圾桶：删除的小笔记快照（本地模式存 localStorage；远程模式同步 PostgreSQL） */
export type TrashedNoteEntry = {
  trashId: string;
  colId: string;
  /** 删除时的合集路径，用于恢复提示 */
  colPathLabel: string;
  card: NoteCard;
  deletedAt: string;
};
