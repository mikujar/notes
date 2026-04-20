/**
 * 在仓库内执行 server/scripts 迁移或发版引入需用户配合的数据步骤时：
 * - 向 `NOTE_SETTINGS_POST_MIGRATE_HINTS` 追加条目，写清「笔记设置 → 哪一页 → 哪个按钮」（与界面文案一致）；
 * - 稳定后删除对应条目；无待办时可将数组置为 `[]`，提示条会隐藏。
 *
 * `focusPanel` 会渲染「跳转」按钮，方便用户直接打开该侧栏页签。
 */
export type NoteSettingsPostMigratePanel =
  | "general"
  | "objectTypes"
  | "autoLink";

export type NoteSettingsPostMigrateHint = {
  id: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  focusPanel?: NoteSettingsPostMigratePanel;
};

export const NOTE_SETTINGS_POST_MIGRATE_HINTS: NoteSettingsPostMigrateHint[] = [
  {
    id: "migration-buttons-object-types",
    titleZh: "跑完数据库脚本后，在设置里点哪里",
    titleEn: "After DB scripts: where to tap in Settings",
    bodyZh:
      "左侧点「对象类型」，把页面滚到最下方：按需要依次使用「执行迁移」（相关笔记 JSON）、「执行迁移」（文件卡标题）、「执行迁入」（剪藏标签笔记）、「开始迁移」（附件→文件卡，需已启用文件类型）。不要为了刷新内置字段去关开「已启用」预设，以免丢失卡片在该合集下的归属。",
    bodyEn:
      "Open Object types in the left nav, scroll to the bottom: run related_refs migration, file-card titles, clip-tagged import, and attachment→file migration as needed. Do not toggle preset types off/on just to refresh built-in fields—you may lose placements.",
    focusPanel: "objectTypes",
  },
];
