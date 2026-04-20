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
      "左侧点「对象类型」：若发版后内置类型（如人物）多了新属性，先点「从目录更新 schema」写回合集定义，再视需要滚到最下方做数据迁移（相关笔记 JSON、文件卡标题、剪藏迁入、附件→文件卡等）。不要为刷新字段去关开「已启用」预设。",
    bodyEn:
      "Open Object types: after a release, use “Update schema from catalog” to refresh built-in type fields, then scroll down for data migrations if needed. Do not toggle presets off/on just to refresh fields.",
    focusPanel: "objectTypes",
  },
];
