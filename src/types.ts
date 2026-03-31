export type NoteMediaKind = "image" | "video" | "audio" | "file";

export type NoteMediaItem = {
  url: string;
  kind: NoteMediaKind;
  /** 非图片/视频时在轮播中展示的文件名 */
  name?: string;
};

export type NoteCard = {
  id: string;
  /** 一段或多行笔记正文，无标题 */
  text: string;
  /** 置顶后固定显示在当前合集列表最上方 */
  pinned?: boolean;
  /** 右侧轮播：图片、视频、音频或任意文件链接，由「⋯ → 添加文件」维护 */
  media?: NoteMediaItem[];
};

export type NoteBlock = {
  id: string;
  /** 当天内的分钟数，用于排序与展示 HH:mm */
  minutesOfDay: number;
  cards: NoteCard[];
};

export type Collection = {
  id: string;
  name: string;
  /** 侧栏列表前的彩色圆点（任意合法 CSS 颜色） */
  dotColor: string;
  /** 主区灰色说明文案（可双击编辑；未设置时用默认文案） */
  hint?: string;
  blocks: NoteBlock[];
  /** 子合集（侧栏树形折叠展示） */
  children?: Collection[];
};
