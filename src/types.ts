export type NoteMediaKind = "image" | "video" | "audio" | "file";

/** 关联的另一张卡片所在位置（与对应卡片上的关联互为反向引用） */
export type NoteCardRelatedRef = {
  colId: string;
  cardId: string;
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
};

export type CardPropertyType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "date"
  | "checkbox"
  | "url";

export type CardPropertyOption = {
  id: string;
  name: string;
  color: string;
};

export type CardProperty = {
  id: string;
  name: string;
  type: CardPropertyType;
  value: string | number | boolean | string[] | null;
  options?: CardPropertyOption[];
};

export type NoteCard = {
  id: string;
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
};

export type Collection = {
  id: string;
  name: string;
  /** 侧栏列表前的彩色圆点（任意合法 CSS 颜色） */
  dotColor: string;
  /** 主区灰色说明文案（可双击编辑；未设置时用默认文案） */
  hint?: string;
  /** 小笔记列表（每张卡自带时刻与日期） */
  cards: NoteCard[];
  /** 子合集（侧栏树形折叠展示） */
  children?: Collection[];
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
