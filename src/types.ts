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
  /** 音频内嵌封面提取后的图片 URL（上传音频可能有） */
  coverUrl?: string;
};

export type NoteCard = {
  id: string;
  /** 一段或多行笔记正文，无标题 */
  text: string;
  /** 当天内分钟数，用于排序与角标 HH:mm */
  minutesOfDay: number;
  /** 日历日 YYYY-MM-DD，用于按日浏览；新建笔记建议始终带 */
  addedOn?: string;
  /** 置顶后固定显示在当前合集列表最上方 */
  pinned?: boolean;
  /** 展示在正文下方的标签（非正文；多个用中文/英文逗号录入） */
  tags?: string[];
  /** 与本条互相关联的其它卡片（存 colId + cardId） */
  relatedRefs?: NoteCardRelatedRef[];
  /** 右侧轮播：图片、视频、音频或任意文件链接 */
  media?: NoteMediaItem[];
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
