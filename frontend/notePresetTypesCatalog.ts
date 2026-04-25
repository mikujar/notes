/**
 * 笔记设置「对象类型」目录（内置预设类型的平铺列表）。
 * 顶层类型一张卡 + 子类型列表。
 */

import type {
  AutoLinkRule,
  AutoLinkTarget,
  Collection,
  SchemaField,
} from "./types";

export type PresetObjectTypeItem = {
  id: string;
  nameZh: string;
  nameEn: string;
  emoji: string;
  tint: string;
  /** "标题"输入框的显示名(默认"标题"/"Title");person 类用"姓名"/"Name" */
  titleLabelZh?: string;
  titleLabelEn?: string;
  /** 启用该子类型时写入合集 card_schema 的字段模板 */
  schemaFields?: SchemaField[];
  /** 启用该子类型时写入合集 card_schema 的自动关联规则 */
  autoLinkRules?: AutoLinkRule[];
};

/** 类型分组：顶层类型一张卡 + 其下子类型列表（子类型为空则仅顶层卡，无下方 section） */
export type PresetTypeGroup = {
  baseId: string;
  baseLabelZh: string;
  baseLabelEn: string;
  baseEmoji: string;
  baseTint: string;
  children: PresetObjectTypeItem[];
  /** 顶层"标题"输入框的显示名(子类型 titleLabelZh 优先) */
  titleLabelZh?: string;
  titleLabelEn?: string;
  /** 顶层类型自身的字段模板（子类型继承并可扩展） */
  schemaFields?: SchemaField[];
  /** 顶层类型自身的自动关联规则 */
  autoLinkRules?: AutoLinkRule[];
};

function normalizeRuleTargets(r: AutoLinkRule): AutoLinkTarget[] {
  if (Array.isArray(r.targets) && r.targets.length > 0) return r.targets;
  if (r.targetObjectKind && r.linkType) {
    return [
      {
        targetKey: "default",
        targetObjectKind: r.targetObjectKind,
        linkType: r.linkType,
        targetPresetTypeId: r.targetPresetTypeId,
      },
    ];
  }
  return [];
}

function mergeAutoLinkRule(parentRule: AutoLinkRule, childRule: AutoLinkRule): AutoLinkRule {
  const ta = normalizeRuleTargets(parentRule);
  const tb = normalizeRuleTargets(childRule);
  const byKey = new Map<string, AutoLinkTarget>();
  for (const t of ta) byKey.set(t.targetKey, t);
  for (const t of tb) byKey.set(t.targetKey, t);
  const merged = [...byKey.values()];
  const base: AutoLinkRule = {
    ruleId: childRule.ruleId,
    trigger: childRule.trigger,
    labelZh: childRule.labelZh ?? parentRule.labelZh,
    labelEn: childRule.labelEn ?? parentRule.labelEn,
  };
  if (merged.length === 1) {
    base.targetObjectKind = merged[0].targetObjectKind;
    base.linkType = merged[0].linkType;
    base.targetPresetTypeId = merged[0].targetPresetTypeId;
  } else if (merged.length > 1) {
    base.targets = merged;
  }
  return base;
}

/** 顶层类型（平铺）+ 各类型下子类型 */
export const PRESET_OBJECT_TYPES_GROUPS: PresetTypeGroup[] = [
  {
    baseId: "note",
    baseLabelZh: "笔记",
    baseLabelEn: "Note",
    baseEmoji: "📝",
    baseTint: "rgba(91, 141, 239, 0.18)",
    children: [
      {
        id: "note_standard",
        nameZh: "学习",
        nameEn: "Study",
        emoji: "📚",
        tint: "rgba(91, 141, 239, 0.18)",
        schemaFields: [
          { id: "sf-study-subject", name: "科目 / 主题", type: "text", order: 0 },
          { id: "sf-study-source-url", name: "参考链接", type: "url", order: 1 },
          { id: "sf-study-review", name: "复习日", type: "date", order: 2 },
        ],
      },
      {
        id: "note_book",
        nameZh: "读书笔记",
        nameEn: "Book note",
        emoji: "📖",
        tint: "rgba(139, 92, 246, 0.16)",
        schemaFields: [
          { id: "sf-booknote-title", name: "书名", type: "text", order: 0 },
          { id: "sf-booknote-author", name: "作者", type: "text", order: 1 },
          { id: "sf-booknote-page", name: "页码 / 章节", type: "text", order: 2 },
        ],
      },
      {
        id: "note_video",
        nameZh: "视频笔记",
        nameEn: "Video note",
        emoji: "🎬",
        tint: "rgba(124, 58, 237, 0.14)",
        schemaFields: [
          {
            id: "sf-vidnote-source",
            name: "视频",
            type: "cardLink",
            order: 0,
            cardLinkFromEdge: "source",
          },
          { id: "sf-vidnote-time", name: "时间戳（秒）", type: "number", order: 1 },
        ],
      },
      {
        id: "idea",
        nameZh: "灵感",
        nameEn: "Idea",
        emoji: "💡",
        tint: "rgba(250, 204, 21, 0.18)",
        schemaFields: [
          { id: "sf-idea-context", name: "触发场景", type: "text", order: 0 },
          { id: "sf-idea-next", name: "下一步", type: "text", order: 1 },
        ],
      },
      {
        id: "journal",
        nameZh: "日记",
        nameEn: "Journal",
        emoji: "📔",
        tint: "rgba(180, 83, 9, 0.12)",
        schemaFields: [
          {
            id: "sf-journal-mood",
            name: "心情",
            type: "choice",
            order: 0,
            options: [
              { id: "o-mood-up", name: "不错", color: "#22c55e" },
              { id: "o-mood-mid", name: "平常", color: "#94a3b8" },
              { id: "o-mood-low", name: "低落", color: "#64748b" },
            ],
          },
          { id: "sf-journal-weather", name: "天气", type: "text", order: 1 },
        ],
      },
      {
        id: "quote",
        nameZh: "摘抄",
        nameEn: "Quote",
        emoji: "❝",
        tint: "rgba(239, 68, 68, 0.12)",
        schemaFields: [
          { id: "sf-quote-source", name: "出处", type: "text", order: 0 },
          { id: "sf-quote-source-url", name: "原文链接", type: "url", order: 1 },
        ],
      },
    ],
  },
  {
    baseId: "file",
    baseLabelZh: "文件",
    baseLabelEn: "File",
    baseEmoji: "📎",
    baseTint: "rgba(55, 53, 47, 0.1)",
    schemaFields: [
      // 由后端按 card_links(attachment) 入站链自动注入；UI 渲染为 cardLink 跳回源卡
      { id: "sf-file-source", name: "来源", type: "cardLink", order: 5, readonly: true },
    ],
    children: [
      {
        id: "file_image",
        nameZh: "图片",
        nameEn: "Image",
        emoji: "🖼",
        tint: "rgba(236, 72, 153, 0.12)",
        schemaFields: [
          { id: "sf-img-taken", name: "拍摄时间", type: "date", order: 1 },
          { id: "sf-img-location", name: "地点", type: "text", order: 2 },
        ],
      },
      {
        id: "file_video",
        nameZh: "视频",
        nameEn: "Video",
        emoji: "🎬",
        tint: "rgba(124, 58, 237, 0.14)",
        schemaFields: [
          { id: "sf-vid-duration-sec", name: "时长", type: "number", order: 1, readonly: true },
          { id: "sf-vid-resolution", name: "分辨率", type: "text", order: 2, readonly: true },
        ],
      },
      {
        id: "file_audio",
        nameZh: "音频",
        nameEn: "Audio",
        emoji: "🎵",
        tint: "rgba(14, 165, 233, 0.14)",
        schemaFields: [
          { id: "sf-aud-duration-sec", name: "时长", type: "number", order: 1, readonly: true },
          { id: "sf-aud-artist", name: "表演者 / 播客", type: "text", order: 2 },
        ],
      },
      {
        id: "file_document",
        nameZh: "文档",
        nameEn: "Document",
        emoji: "📄",
        tint: "rgba(55, 53, 47, 0.08)",
        schemaFields: [
          { id: "sf-doc-pages", name: "页数", type: "number", order: 1 },
          { id: "sf-doc-author", name: "作者", type: "text", order: 2 },
        ],
      },
      {
        id: "file_other",
        nameZh: "其他",
        nameEn: "Other",
        emoji: "📦",
        tint: "rgba(55, 53, 47, 0.07)",
        schemaFields: [
          { id: "sf-file-other-mime", name: "类型说明", type: "text", order: 1 },
          { id: "sf-file-other-note", name: "备注", type: "text", order: 2 },
        ],
      },
    ],
  },
  {
    baseId: "topic",
    baseLabelZh: "主题",
    baseLabelEn: "Topic",
    baseEmoji: "🎯",
    baseTint: "rgba(124, 58, 237, 0.14)",
    children: [
      {
        id: "person",
        nameZh: "人物",
        nameEn: "Person",
        emoji: "🧑",
        tint: "rgba(249, 115, 22, 0.14)",
        titleLabelZh: "姓名",
        titleLabelEn: "Name",
        schemaFields: [
          { id: "sf-person-role", name: "身份", type: "text", order: 1 },
          { id: "sf-person-org", name: "所属组织", type: "collectionLink", order: 2 },
          { id: "sf-person-url", name: "主页链接", type: "url", order: 3 },
          {
            id: "sf-person-works",
            name: "作品",
            type: "cardLink",
            order: 4,
          },
        ],
      },
      {
        id: "organization",
        nameZh: "组织",
        nameEn: "Organization",
        emoji: "🏢",
        tint: "rgba(234, 88, 12, 0.12)",
        schemaFields: [
          { id: "sf-org-type", name: "类型", type: "text", order: 0 },
          { id: "sf-org-url", name: "官网", type: "url", order: 1 },
        ],
      },
      {
        id: "event",
        nameZh: "事件",
        nameEn: "Event",
        emoji: "📌",
        tint: "rgba(251, 191, 36, 0.16)",
        schemaFields: [
          { id: "sf-event-start", name: "开始日期", type: "date", order: 0 },
          { id: "sf-event-end", name: "结束日期", type: "date", order: 1 },
          { id: "sf-event-place", name: "地点", type: "text", order: 2 },
        ],
      },
      {
        id: "place",
        nameZh: "地点",
        nameEn: "Place",
        emoji: "📍",
        tint: "rgba(34, 197, 94, 0.12)",
        schemaFields: [
          { id: "sf-place-address", name: "地址", type: "text", order: 0 },
          { id: "sf-place-map-url", name: "地图链接", type: "url", order: 1 },
        ],
      },
      {
        id: "topic_concept",
        nameZh: "概念",
        nameEn: "Concept",
        emoji: "🧩",
        tint: "rgba(124, 58, 237, 0.12)",
        schemaFields: [
          { id: "sf-concept-summary", name: "一句话定义", type: "text", order: 0 },
          { id: "sf-concept-ref-url", name: "参考链接", type: "url", order: 1 },
        ],
      },
      {
        id: "work_book",
        nameZh: "书籍",
        nameEn: "Book",
        emoji: "📚",
        tint: "rgba(139, 92, 246, 0.14)",
        schemaFields: [
          { id: "sf-book-author", name: "作者", type: "text", order: 0 },
          { id: "sf-book-isbn", name: "ISBN", type: "text", order: 1 },
          { id: "sf-book-rating", name: "评分", type: "number", order: 2 },
          {
            id: "sf-book-status",
            name: "状态",
            type: "choice",
            order: 3,
            options: [
              { id: "o-unread", name: "待读", color: "#a8a29e" },
              { id: "o-reading", name: "在读", color: "#3b82f6" },
              { id: "o-done", name: "已读", color: "#22c55e" },
            ],
          },
        ],
      },
      {
        id: "work_movie",
        nameZh: "影视",
        nameEn: "Movie / TV",
        emoji: "🎞",
        tint: "rgba(99, 102, 241, 0.14)",
        schemaFields: [
          { id: "sf-movie-director", name: "导演", type: "text", order: 0 },
          { id: "sf-movie-year", name: "年份", type: "number", order: 1 },
          { id: "sf-movie-rating", name: "评分", type: "number", order: 2 },
          {
            id: "sf-movie-status",
            name: "状态",
            type: "choice",
            order: 3,
            options: [
              { id: "o-unwatched", name: "待看", color: "#a8a29e" },
              { id: "o-watching", name: "在看", color: "#3b82f6" },
              { id: "o-watched", name: "已看", color: "#22c55e" },
            ],
          },
        ],
      },
      {
        id: "work_anime",
        nameZh: "动漫",
        nameEn: "Anime",
        emoji: "✨",
        tint: "rgba(236, 72, 153, 0.12)",
        schemaFields: [
          { id: "sf-anime-studio", name: "制作方", type: "text", order: 0 },
          { id: "sf-anime-season", name: "季 / 话数", type: "text", order: 1 },
          { id: "sf-anime-rating", name: "评分", type: "number", order: 2 },
          {
            id: "sf-anime-status",
            name: "状态",
            type: "choice",
            order: 3,
            options: [
              { id: "o-anime-watch", name: "在追", color: "#3b82f6" },
              { id: "o-anime-done", name: "已看完", color: "#22c55e" },
              { id: "o-anime-drop", name: "弃番", color: "#a8a29e" },
            ],
          },
        ],
      },
      {
        id: "work_music",
        nameZh: "音乐",
        nameEn: "Music",
        emoji: "🎼",
        tint: "rgba(16, 185, 129, 0.14)",
        schemaFields: [
          { id: "sf-music-artist", name: "艺术家", type: "text", order: 0 },
          { id: "sf-music-album", name: "专辑", type: "text", order: 1 },
          { id: "sf-music-year", name: "发行年", type: "number", order: 2 },
        ],
      },
      {
        id: "work_game",
        nameZh: "游戏",
        nameEn: "Game",
        emoji: "🎮",
        tint: "rgba(59, 130, 246, 0.14)",
        schemaFields: [
          {
            id: "sf-game-platform",
            name: "平台",
            type: "choice",
            order: 0,
            options: [
              { id: "o-game-pc", name: "PC", color: "#6366f1" },
              { id: "o-game-console", name: "主机", color: "#8b5cf6" },
              { id: "o-game-mobile", name: "手机", color: "#0ea5e9" },
              { id: "o-game-handheld", name: "掌机", color: "#14b8a6" },
            ],
          },
          { id: "sf-game-release", name: "发行日", type: "date", order: 1 },
        ],
      },
      {
        id: "work_course",
        nameZh: "课程",
        nameEn: "Course",
        emoji: "🎓",
        tint: "rgba(99, 102, 241, 0.12)",
        schemaFields: [
          { id: "sf-course-instructor", name: "讲师", type: "text", order: 0 },
          {
            id: "sf-course-progress",
            name: "进度",
            type: "choice",
            order: 1,
            options: [
              { id: "o-course-todo", name: "未开始", color: "#a8a29e" },
              { id: "o-course-doing", name: "学习中", color: "#3b82f6" },
              { id: "o-course-done", name: "已完成", color: "#22c55e" },
            ],
          },
        ],
      },
      {
        id: "work_app",
        nameZh: "应用",
        nameEn: "App",
        emoji: "📱",
        tint: "rgba(55, 53, 47, 0.1)",
        schemaFields: [
          { id: "sf-app-developer", name: "开发商", type: "text", order: 0 },
          {
            id: "sf-app-platform",
            name: "平台",
            type: "choice",
            order: 1,
            options: [
              { id: "o-app-ios", name: "iOS", color: "#64748b" },
              { id: "o-app-android", name: "Android", color: "#22c55e" },
              { id: "o-app-desktop", name: "桌面", color: "#3b82f6" },
              { id: "o-app-web", name: "Web", color: "#8b5cf6" },
            ],
          },
          { id: "sf-app-store-url", name: "商店链接", type: "url", order: 2 },
        ],
      },
    ],
  },
  {
    baseId: "clip",
    baseLabelZh: "剪藏",
    baseLabelEn: "Clip",
    baseEmoji: "🔖",
    baseTint: "rgba(59, 130, 246, 0.12)",
    schemaFields: [
      { id: "sf-clip-url", name: "链接", type: "url", order: 0 },
    ],
    children: [
      {
        id: "clip_bookmark",
        nameZh: "网页",
        nameEn: "Web",
        emoji: "🔖",
        tint: "rgba(59, 130, 246, 0.14)",
        schemaFields: [
          { id: "sf-bookmark-site", name: "网站名称", type: "text", order: 2 },
          { id: "sf-bookmark-highlight", name: "摘录 / 笔记", type: "text", order: 3 },
        ],
      },
      {
        id: "clip_email",
        nameZh: "邮件",
        nameEn: "Email",
        emoji: "✉️",
        tint: "rgba(59, 130, 246, 0.14)",
        schemaFields: [
          { id: "sf-email-from", name: "发件人", type: "text", order: 2 },
          { id: "sf-email-subject", name: "主题", type: "text", order: 3 },
          { id: "sf-email-received", name: "收件时间", type: "date", order: 4 },
        ],
      },
      {
        id: "post_xhs",
        nameZh: "小红书",
        nameEn: "Xiaohongshu",
        emoji: "📕",
        tint: "rgba(239, 68, 68, 0.12)",
        schemaFields: [
          {
            id: "sf-xhs-author",
            name: "作者",
            type: "text",
            order: 2,
          },
          { id: "sf-xhs-date", name: "发布日期", type: "date", order: 3 },
          {
            id: "sf-xhs-type",
            name: "类型",
            type: "choice",
            order: 4,
            options: [
              { id: "o-xhs-note", name: "图文", color: "#ef4444" },
              { id: "o-xhs-video", name: "视频", color: "#8b5cf6" },
            ],
          },
        ],
        autoLinkRules: [],
      },
      {
        id: "post_bilibili",
        nameZh: "B 站",
        nameEn: "Bilibili",
        emoji: "📺",
        tint: "rgba(0, 161, 214, 0.14)",
        schemaFields: [
          {
            id: "sf-bili-author",
            name: "UP 主",
            type: "text",
            order: 2,
          },
          { id: "sf-bili-date", name: "发布日期", type: "date", order: 3 },
          { id: "sf-bili-duration", name: "时长", type: "number", order: 4, readonly: true },
        ],
        autoLinkRules: [],
      },
      {
        id: "clip_wechat",
        nameZh: "微信公众号",
        nameEn: "WeChat article",
        emoji: "🟢",
        tint: "rgba(34, 197, 94, 0.14)",
        schemaFields: [
          { id: "sf-wechat-account", name: "公众号", type: "text", order: 2 },
          {
            id: "sf-wechat-author",
            name: "作者",
            type: "cardLink",
            order: 3,
            cardLinkFromEdge: "creator",
          },
          { id: "sf-wechat-date", name: "发布日期", type: "date", order: 4 },
        ],
      },
      {
        id: "clip_douyin",
        nameZh: "抖音",
        nameEn: "Douyin",
        emoji: "🎶",
        tint: "rgba(0, 0, 0, 0.14)",
        schemaFields: [
          {
            id: "sf-douyin-author",
            name: "作者",
            type: "cardLink",
            order: 2,
            cardLinkFromEdge: "creator",
          },
          { id: "sf-douyin-duration", name: "时长", type: "number", order: 3, readonly: true },
          { id: "sf-douyin-date", name: "发布日期", type: "date", order: 4 },
        ],
      },
      {
        id: "clip_weibo",
        nameZh: "微博",
        nameEn: "Weibo",
        emoji: "🟧",
        tint: "rgba(245, 158, 11, 0.14)",
        schemaFields: [
          {
            id: "sf-weibo-author",
            name: "作者",
            type: "cardLink",
            order: 2,
            cardLinkFromEdge: "creator",
          },
          { id: "sf-weibo-date", name: "发布日期", type: "date", order: 3 },
        ],
      },
      {
        id: "clip_zhihu",
        nameZh: "知乎",
        nameEn: "Zhihu",
        emoji: "📘",
        tint: "rgba(14, 165, 233, 0.14)",
        schemaFields: [
          { id: "sf-zhihu-author", name: "作者", type: "text", order: 2 },
          { id: "sf-zhihu-date", name: "发布日期", type: "date", order: 3 },
          {
            id: "sf-zhihu-kind",
            name: "类型",
            type: "choice",
            order: 4,
            options: [
              { id: "o-zhihu-answer", name: "回答", color: "#0ea5e9" },
              { id: "o-zhihu-article", name: "文章", color: "#3b82f6" },
              { id: "o-zhihu-thought", name: "想法", color: "#a855f7" },
            ],
          },
        ],
      },
      {
        id: "clip_douban",
        nameZh: "豆瓣",
        nameEn: "Douban",
        emoji: "🟢",
        tint: "rgba(34, 197, 94, 0.14)",
        schemaFields: [
          { id: "sf-douban-author", name: "作者", type: "text", order: 2 },
          { id: "sf-douban-date", name: "发布日期", type: "date", order: 3 },
          {
            id: "sf-douban-kind",
            name: "类型",
            type: "choice",
            order: 4,
            options: [
              { id: "o-douban-review-movie", name: "影评", color: "#10b981" },
              { id: "o-douban-review-book", name: "书评", color: "#22c55e" },
              { id: "o-douban-broadcast", name: "广播", color: "#84cc16" },
              { id: "o-douban-diary", name: "日记", color: "#a3e635" },
            ],
          },
        ],
      },
      {
        id: "clip_github",
        nameZh: "Github",
        nameEn: "GitHub",
        emoji: "🐙",
        tint: "rgba(55, 53, 47, 0.12)",
        schemaFields: [
          { id: "sf-github-repo", name: "仓库", type: "text", order: 2 },
          { id: "sf-github-author", name: "作者", type: "text", order: 3 },
          {
            id: "sf-github-kind",
            name: "类型",
            type: "choice",
            order: 4,
            options: [
              { id: "o-gh-repo", name: "Repo", color: "#22c55e" },
              { id: "o-gh-issue", name: "Issue", color: "#ef4444" },
              { id: "o-gh-pr", name: "Pull Request", color: "#a855f7" },
              { id: "o-gh-discussion", name: "Discussion", color: "#0ea5e9" },
              { id: "o-gh-gist", name: "Gist", color: "#94a3b8" },
            ],
          },
        ],
      },
      {
        id: "clip_twitter",
        nameZh: "推特 / X",
        nameEn: "Twitter / X",
        emoji: "🐦",
        tint: "rgba(96, 165, 250, 0.14)",
        schemaFields: [
          {
            id: "sf-twitter-author",
            name: "作者",
            type: "cardLink",
            order: 2,
            cardLinkFromEdge: "creator",
          },
          { id: "sf-twitter-date", name: "发布日期", type: "date", order: 3 },
        ],
      },
      {
        id: "clip_instagram",
        nameZh: "Instagram",
        nameEn: "Instagram",
        emoji: "📷",
        tint: "rgba(236, 72, 153, 0.14)",
        schemaFields: [
          { id: "sf-instagram-author", name: "作者", type: "text", order: 2 },
          { id: "sf-instagram-date", name: "发布日期", type: "date", order: 3 },
          {
            id: "sf-instagram-kind",
            name: "类型",
            type: "choice",
            order: 4,
            options: [
              { id: "o-ig-post", name: "帖子", color: "#ec4899" },
              { id: "o-ig-reel", name: "Reel", color: "#a855f7" },
              { id: "o-ig-story", name: "Story", color: "#f43f5e" },
            ],
          },
        ],
      },
      {
        id: "clip_reddit",
        nameZh: "Reddit",
        nameEn: "Reddit",
        emoji: "🔶",
        tint: "rgba(249, 115, 22, 0.14)",
        schemaFields: [
          { id: "sf-reddit-author", name: "作者", type: "text", order: 2 },
          { id: "sf-reddit-subreddit", name: "子版块", type: "text", order: 3 },
          { id: "sf-reddit-date", name: "发布日期", type: "date", order: 4 },
        ],
      },
      {
        id: "clip_appstore",
        nameZh: "App Store",
        nameEn: "App Store",
        emoji: "📱",
        tint: "rgba(96, 165, 250, 0.14)",
        schemaFields: [
          { id: "sf-appstore-developer", name: "开发商", type: "text", order: 2 },
          { id: "sf-appstore-price", name: "价格", type: "number", order: 3 },
          { id: "sf-appstore-rating", name: "评分", type: "number", order: 4 },
        ],
      },
    ],
  },
  {
    baseId: "task",
    baseLabelZh: "任务",
    baseLabelEn: "Task",
    baseEmoji: "☑",
    baseTint: "rgba(34, 197, 94, 0.14)",
    schemaFields: [
      { id: "sf-todo-due", name: "截止日期", type: "date", order: 0 },
      {
        id: "sf-todo-priority",
        name: "优先级",
        type: "choice",
        order: 1,
        options: [
          { id: "o-prio-high", name: "高", color: "#ef4444" },
          { id: "o-prio-mid", name: "中", color: "#f59e0b" },
          { id: "o-prio-low", name: "低", color: "#94a3b8" },
        ],
      },
    ],
    children: [
      {
        id: "task_todo",
        nameZh: "待办",
        nameEn: "Todo",
        emoji: "☑",
        tint: "rgba(34, 197, 94, 0.14)",
        schemaFields: [
          { id: "sf-todo-due", name: "截止日期", type: "date", order: 0 },
          {
            id: "sf-todo-priority",
            name: "优先级",
            type: "choice",
            order: 1,
            options: [
              { id: "o-prio-high", name: "高", color: "#ef4444" },
              { id: "o-prio-mid", name: "中", color: "#f59e0b" },
              { id: "o-prio-low", name: "低", color: "#94a3b8" },
            ],
          },
        ],
      },
      {
        id: "task_schedule",
        nameZh: "日程",
        nameEn: "Schedule",
        emoji: "🗓",
        tint: "rgba(14, 165, 233, 0.14)",
        schemaFields: [
          { id: "sf-schedule-start", name: "开始时间", type: "date", order: 0 },
          { id: "sf-schedule-end", name: "结束时间", type: "date", order: 1 },
          { id: "sf-schedule-location", name: "地点", type: "text", order: 2 },
        ],
      },
      {
        id: "habit_log",
        nameZh: "习惯",
        nameEn: "Habit",
        emoji: "✅",
        tint: "rgba(52, 211, 153, 0.14)",
        schemaFields: [
          { id: "sf-habit-streak", name: "连续天数", type: "number", order: 0 },
          { id: "sf-habit-note", name: "备注", type: "text", order: 1 },
        ],
      },
    ],
  },
  {
    baseId: "project",
    baseLabelZh: "项目",
    baseLabelEn: "Project",
    baseEmoji: "📁",
    baseTint: "rgba(14, 165, 233, 0.12)",
    schemaFields: [
      {
        id: "sf-project-status",
        name: "状态",
        type: "choice",
        order: 0,
        options: [
          { id: "o-proj-active", name: "进行中", color: "#3b82f6" },
          { id: "o-proj-done", name: "已完成", color: "#22c55e" },
          { id: "o-proj-paused", name: "暂停", color: "#a8a29e" },
        ],
      },
      { id: "sf-project-deadline", name: "截止日期", type: "date", order: 1 },
    ],
    children: [
      {
        id: "project_doing",
        nameZh: "在做",
        nameEn: "Doing",
        emoji: "🚧",
        tint: "rgba(59, 130, 246, 0.14)",
        schemaFields: [
          {
            id: "sf-projd-priority",
            name: "优先级",
            type: "choice",
            order: 2,
            options: [
              { id: "o-prio-high", name: "高", color: "#ef4444" },
              { id: "o-prio-mid", name: "中", color: "#f59e0b" },
              { id: "o-prio-low", name: "低", color: "#94a3b8" },
            ],
          },
        ],
      },
      {
        id: "project_archived",
        nameZh: "已归档",
        nameEn: "Archived",
        emoji: "📦",
        tint: "rgba(148, 163, 184, 0.14)",
        schemaFields: [
          { id: "sf-proja-finished", name: "完成日期", type: "date", order: 2 },
          {
            id: "sf-proja-outcome",
            name: "结果",
            type: "choice",
            order: 3,
            options: [
              { id: "o-out-success", name: "成功", color: "#22c55e" },
              { id: "o-out-failed", name: "失败", color: "#ef4444" },
              { id: "o-out-shelved", name: "搁置", color: "#94a3b8" },
            ],
          },
          { id: "sf-proja-review", name: "复盘", type: "text", order: 4 },
        ],
      },
    ],
  },
  {
    baseId: "expense",
    baseLabelZh: "开支",
    baseLabelEn: "Expense",
    baseEmoji: "💳",
    baseTint: "rgba(52, 211, 153, 0.12)",
    schemaFields: [
      { id: "sf-expense-amount", name: "金额", type: "number", order: 0 },
      { id: "sf-expense-date", name: "日期", type: "date", order: 1 },
      {
        id: "sf-expense-category",
        name: "分类",
        type: "choice",
        order: 2,
        options: [
          { id: "o-exp-food", name: "餐饮", color: "#f97316" },
          { id: "o-exp-transport", name: "交通", color: "#3b82f6" },
          { id: "o-exp-shopping", name: "购物", color: "#ec4899" },
          { id: "o-exp-other", name: "其他", color: "#a8a29e" },
        ],
      },
    ],
    children: [
      {
        id: "expense_daily",
        nameZh: "日常",
        nameEn: "Daily",
        emoji: "🛒",
        tint: "rgba(249, 115, 22, 0.14)",
        schemaFields: [
          {
            id: "sf-expd-pay",
            name: "支付方式",
            type: "choice",
            order: 3,
            options: [
              { id: "o-pay-cash", name: "现金", color: "#a8a29e" },
              { id: "o-pay-wechat", name: "微信", color: "#22c55e" },
              { id: "o-pay-alipay", name: "支付宝", color: "#3b82f6" },
              { id: "o-pay-card", name: "银行卡", color: "#8b5cf6" },
            ],
          },
        ],
      },
      {
        id: "expense_subscription",
        nameZh: "订阅",
        nameEn: "Subscription",
        emoji: "🔁",
        tint: "rgba(14, 165, 233, 0.14)",
        schemaFields: [
          {
            id: "sf-exps-cycle",
            name: "周期",
            type: "choice",
            order: 3,
            options: [
              { id: "o-cyc-month", name: "月", color: "#3b82f6" },
              { id: "o-cyc-quarter", name: "季", color: "#8b5cf6" },
              { id: "o-cyc-year", name: "年", color: "#22c55e" },
            ],
          },
          { id: "sf-exps-next", name: "下次扣费", type: "date", order: 4 },
          { id: "sf-exps-platform", name: "平台", type: "text", order: 5 },
        ],
      },
      {
        id: "expense_reimburse",
        nameZh: "报销",
        nameEn: "Reimburse",
        emoji: "🧾",
        tint: "rgba(168, 162, 158, 0.18)",
        schemaFields: [
          { id: "sf-expr-project", name: "报销项目", type: "text", order: 3 },
          {
            id: "sf-expr-status",
            name: "状态",
            type: "choice",
            order: 4,
            options: [
              { id: "o-reimb-todo", name: "待提交", color: "#a8a29e" },
              { id: "o-reimb-pending", name: "审批中", color: "#f59e0b" },
              { id: "o-reimb-done", name: "已报销", color: "#22c55e" },
            ],
          },
        ],
      },
    ],
  },
  {
    baseId: "account",
    baseLabelZh: "账户",
    baseLabelEn: "Account",
    baseEmoji: "🏦",
    baseTint: "rgba(59, 130, 246, 0.12)",
    schemaFields: [
      { id: "sf-account-platform", name: "平台", type: "text", order: 0 },
    ],
    children: [
      {
        id: "account_login",
        nameZh: "登录",
        nameEn: "Login",
        emoji: "🔐",
        tint: "rgba(59, 130, 246, 0.14)",
        schemaFields: [
          { id: "sf-account-username", name: "用户名", type: "text", order: 1 },
          { id: "sf-account-password", name: "密码", type: "text", order: 2 },
          { id: "sf-account-login-url", name: "登录链接", type: "url", order: 3 },
          { id: "sf-account-2fa", name: "启用 2FA", type: "checkbox", order: 4 },
        ],
      },
      {
        id: "account_bankcard",
        nameZh: "银行卡",
        nameEn: "Bank Card",
        emoji: "💳",
        tint: "rgba(34, 197, 94, 0.14)",
        schemaFields: [
          { id: "sf-bank-cardno", name: "卡号", type: "text", order: 1 },
          { id: "sf-bank-holder", name: "持卡人", type: "text", order: 2 },
          { id: "sf-bank-expiry", name: "有效期", type: "date", order: 3 },
          { id: "sf-bank-cvv", name: "CVV", type: "text", order: 4 },
        ],
      },
      {
        id: "account_id",
        nameZh: "证件",
        nameEn: "ID",
        emoji: "🪪",
        tint: "rgba(236, 72, 153, 0.14)",
        schemaFields: [
          {
            id: "sf-id-kind",
            name: "证件类型",
            type: "choice",
            order: 1,
            options: [
              { id: "o-id-cn", name: "身份证", color: "#ef4444" },
              { id: "o-id-passport", name: "护照", color: "#3b82f6" },
              { id: "o-id-driver", name: "驾照", color: "#22c55e" },
              { id: "o-id-other", name: "其他", color: "#94a3b8" },
            ],
          },
          { id: "sf-id-number", name: "证件号", type: "text", order: 2 },
          { id: "sf-id-holder", name: "持有人", type: "text", order: 3 },
          { id: "sf-id-expiry", name: "有效期", type: "date", order: 4 },
        ],
      },
    ],
  },
];

/** 侧栏「笔记」下文件夹树：仅保留无 preset_type_id 的合集（学习/灵感等预设子类单独列在分区标题下） */
export function filterPlainFolderCollectionsForNotesSidebar(
  roots: Collection[]
): Collection[] {
  function visit(col: Collection): Collection | null {
    if ((col.presetTypeId ?? "").trim()) return null;
    const raw = col.children ?? [];
    const children = raw
      .map(visit)
      .filter((c): c is Collection => c != null);
    return { ...col, children };
  }
  return roots.map(visit).filter((c): c is Collection => c != null);
}

/** preset_type_id → catalog 顶层 baseId（自定义类型等返回 null） */
export function presetCatalogBaseIdForPresetTypeId(
  presetTypeId: string | undefined | null
): string | null {
  const p = (presetTypeId ?? "").trim();
  if (!p) return null;
  for (const g of PRESET_OBJECT_TYPES_GROUPS) {
    if (g.baseId === p) return g.baseId;
    if (g.children.some((c) => c.id === p)) return g.baseId;
  }
  return null;
}

/** 顶层「类型」网格：每个父类型一张卡（与下方子类型 section 对应） */
export function presetTypeParentCard(group: PresetTypeGroup): PresetObjectTypeItem {
  return {
    id: group.baseId,
    nameZh: group.baseLabelZh,
    nameEn: group.baseLabelEn,
    emoji: group.baseEmoji,
    tint: group.baseTint,
  };
}

/** 设置页「自动建卡规则」列表：来自预设类型 catalog 的 ruleId 与展示文案 */
export type PresetAutoLinkRuleListItem = {
  ruleId: string;
  labelZh: string;
  labelEn: string;
  contextZh: string;
  contextEn: string;
  /** 与自定义规则同一套人话格式，便于列表对照 */
  summaryZh: string;
  summaryEn: string;
};

function schemaFieldDisplayName(fields: SchemaField[], id: string | undefined): string | null {
  if (!id?.trim()) return null;
  const f = fields.find((x) => x.id === id.trim());
  return f?.name ?? null;
}

const TARGET_KEY_LABEL_ZH: Record<string, string> = {
  creator: "创建者",
  source: "来源",
  default: "关联",
};

const TARGET_KEY_LABEL_EN: Record<string, string> = {
  creator: "Creator",
  source: "Source",
  default: "Link",
};

/** 目标预设形态上用于展示「右侧字段」的文案：优先 cardLink，其次 url，否则通用「互链」 */
function targetSideFieldLabelForBuiltin(targetObjectKind: string): { zh: string; en: string } {
  const ctx = findPresetGroupChildForCatalogId(targetObjectKind);
  if (!ctx) return { zh: "互链", en: "Link" };
  const tgtSchema = buildSchemaFromPreset(ctx.group, ctx.child);
  const tfields = tgtSchema.fields ?? [];
  const link = tfields.find((f) => f.type === "cardLink");
  if (link) return { zh: link.name, en: link.name };
  const url = tfields.find((f) => f.type === "url");
  if (url) return { zh: url.name, en: url.name };
  return { zh: "互链", en: "Link" };
}

/**
 * 预设内置规则的一行摘要，与设置里自定义规则同一套「合集路径」的「属性」↔「目标」的「属性」格式。
 */
export function presetBuiltinAutoLinkSummary(
  rule: AutoLinkRule,
  group: PresetTypeGroup,
  child: PresetObjectTypeItem | undefined,
  contextZh: string,
  contextEn: string
): { summaryZh: string; summaryEn: string } {
  const schema = buildSchemaFromPreset(group, child);
  const fields = schema.fields ?? [];
  const targets = normalizeRuleTargets(rule);
  const segsZh: string[] = [];
  const segsEn: string[] = [];

  targets.forEach((t, i) => {
    const meta = getPresetKindMeta(t.targetObjectKind);
    const tgtZh = meta?.nameZh ?? t.targetObjectKind;
    const tgtEn = meta?.nameEn ?? t.targetObjectKind;
    const { zh: tgtSideZh, en: tgtSideEn } = targetSideFieldLabelForBuiltin(t.targetObjectKind);
    const syncName = schemaFieldDisplayName(fields, t.syncSchemaFieldId);
    const key = t.targetKey ?? "default";
    const leftZh = syncName ?? TARGET_KEY_LABEL_ZH[key] ?? key;
    const leftEn = syncName ?? TARGET_KEY_LABEL_EN[key] ?? key;
    const rightZh = `「${tgtZh}」的「${tgtSideZh}」`;
    const rightEn = `${tgtEn} · ${tgtSideEn}`;
    if (i === 0) {
      segsZh.push(`「${contextZh}」的「${leftZh}」 ↔ ${rightZh}`);
      segsEn.push(`${contextEn} · ${leftEn} ↔ ${rightEn}`);
    } else {
      segsZh.push(`「${leftZh}」 ↔ ${rightZh}`);
      segsEn.push(`${leftEn} ↔ ${rightEn}`);
    }
  });

  if (segsZh.length === 0) {
    const fallbackZh = rule.labelZh ?? rule.ruleId;
    const fallbackEn = rule.labelEn ?? rule.ruleId;
    return {
      summaryZh: `「${contextZh}」${fallbackZh}`,
      summaryEn: `${contextEn} · ${fallbackEn}`,
    };
  }

  return {
    summaryZh: segsZh.join("；"),
    summaryEn: segsEn.join("; "),
  };
}

export function listPresetAutoLinkRulesForSettings(): PresetAutoLinkRuleListItem[] {
  const out: PresetAutoLinkRuleListItem[] = [];
  for (const group of PRESET_OBJECT_TYPES_GROUPS) {
    for (const r of group.autoLinkRules ?? []) {
      const contextZh = group.baseLabelZh;
      const contextEn = group.baseLabelEn;
      const { summaryZh, summaryEn } = presetBuiltinAutoLinkSummary(
        r,
        group,
        undefined,
        contextZh,
        contextEn
      );
      out.push({
        ruleId: r.ruleId,
        labelZh: r.labelZh ?? r.ruleId,
        labelEn: r.labelEn ?? r.ruleId,
        contextZh,
        contextEn,
        summaryZh,
        summaryEn,
      });
    }
    for (const child of group.children) {
      for (const r of child.autoLinkRules ?? []) {
        const contextZh = `${group.baseLabelZh} · ${child.nameZh}`;
        const contextEn = `${group.baseLabelEn} · ${child.nameEn}`;
        const { summaryZh, summaryEn } = presetBuiltinAutoLinkSummary(
          r,
          group,
          child,
          contextZh,
          contextEn
        );
        out.push({
          ruleId: r.ruleId,
          labelZh: r.labelZh ?? r.ruleId,
          labelEn: r.labelEn ?? r.ruleId,
          contextZh,
          contextEn,
          summaryZh,
          summaryEn,
        });
      }
    }
  }
  return out;
}

/** 设置里「对象形态 / object_kind」下拉：含顶层 baseId 与各子类型 id */
export type PresetKindOption = { id: string; labelZh: string; labelEn: string };

export function listPresetObjectKindOptions(): PresetKindOption[] {
  const out: PresetKindOption[] = [];
  for (const group of PRESET_OBJECT_TYPES_GROUPS) {
    out.push({
      id: group.baseId,
      labelZh: group.baseLabelZh,
      labelEn: group.baseLabelEn,
    });
    for (const ch of group.children) {
      out.push({
        id: ch.id,
        labelZh: `${group.baseLabelZh} · ${ch.nameZh}`,
        labelEn: `${group.baseLabelEn} · ${ch.nameEn}`,
      });
    }
  }
  return out;
}

/**
 * 按 catalog 中的 baseId 或子类型 id 找到预设分组（用于解析 schema）。
 */
export function findPresetGroupChildForCatalogId(
  id: string
): { group: PresetTypeGroup; child?: PresetObjectTypeItem } | null {
  const t = typeof id === "string" ? id.trim() : "";
  if (!t) return null;
  for (const group of PRESET_OBJECT_TYPES_GROUPS) {
    if (group.baseId === t) return { group };
    for (const ch of group.children) {
      if (ch.id === t) return { group, child: ch };
    }
  }
  return null;
}

/**
 * 根据源卡形态或归属预设 id，列出合并 schema 中的 cardLink 字段（供自动建卡写入源卡属性）。
 * 优先用归属预设 id；与设置表单中「归属预设优先于形态」一致。
 */
export function listCardLinkFieldsForCatalogKindOrPreset(
  sourcePresetTypeId: string,
  sourceObjectKind: string
): SchemaField[] {
  const preset = (sourcePresetTypeId ?? "").trim();
  const kind = (sourceObjectKind ?? "").trim();
  const lookup = preset || kind;
  if (!lookup) return [];
  const ctx = findPresetGroupChildForCatalogId(lookup);
  if (!ctx) return [];
  const schema = buildSchemaFromPreset(ctx.group, ctx.child);
  return (schema.fields ?? []).filter((f) => f.type === "cardLink");
}

/**
 * 根据预设类型构建 CollectionCardSchema。
 * 顶层类型：取 group.schemaFields + group.autoLinkRules
 * 子类型：父类型字段优先，子类型追加/覆盖（按 field.id 去重，子类型优先）
 */
export function buildSchemaFromPreset(
  group: PresetTypeGroup,
  child?: PresetObjectTypeItem
): import("./types").CollectionCardSchema {
  const parentFields = group.schemaFields ?? [];
  const parentRules = group.autoLinkRules ?? [];
  if (!child) {
    return { fields: parentFields, autoLinkRules: parentRules, version: 1 };
  }
  const childFields = child.schemaFields ?? [];
  const childRules = child.autoLinkRules ?? [];

  // 合并字段：子类型 id 优先
  const fieldMap = new Map<string, import("./types").SchemaField>();
  for (const f of parentFields) fieldMap.set(f.id, f);
  for (const f of childFields) fieldMap.set(f.id, f);

  // 合并规则：同 ruleId 时合并 targets；否则子类型 ruleId 覆盖
  const ruleMap = new Map<string, import("./types").AutoLinkRule>();
  for (const r of parentRules) ruleMap.set(r.ruleId, r);
  for (const r of childRules) {
    const prev = ruleMap.get(r.ruleId);
    ruleMap.set(r.ruleId, prev ? mergeAutoLinkRule(prev, r) : r);
  }

  return {
    fields: [...fieldMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    autoLinkRules: [...ruleMap.values()],
    version: 1,
  };
}

/** 从所有分组中按 objectKind id 找到对应的 emoji 和 tint */
export function getPresetKindMeta(objectKind: string): { emoji: string; tint: string; nameZh: string; nameEn: string } | null {
  for (const group of PRESET_OBJECT_TYPES_GROUPS) {
    if (group.baseId === objectKind) {
      return { emoji: group.baseEmoji, tint: group.baseTint, nameZh: group.baseLabelZh, nameEn: group.baseLabelEn };
    }
    for (const child of group.children) {
      if (child.id === objectKind) {
        return { emoji: child.emoji, tint: child.tint, nameZh: child.nameZh, nameEn: child.nameEn };
      }
    }
  }
  return null;
}

/** 取该类型"标题"输入框的显示名。子类型 titleLabel 优先,否则取顶层组的,最终默认"标题"/"Title"。 */
export function getPresetTitleLabel(
  objectKind: string | undefined,
  lang: "zh" | "en"
): string {
  const fallback = lang === "en" ? "Title" : "标题";
  if (!objectKind) return fallback;
  for (const group of PRESET_OBJECT_TYPES_GROUPS) {
    if (group.baseId === objectKind) {
      return (
        (lang === "en" ? group.titleLabelEn : group.titleLabelZh) || fallback
      );
    }
    for (const child of group.children) {
      if (child.id === objectKind) {
        const childLabel =
          lang === "en" ? child.titleLabelEn : child.titleLabelZh;
        if (childLabel) return childLabel;
        return (
          (lang === "en" ? group.titleLabelEn : group.titleLabelZh) || fallback
        );
      }
    }
  }
  return fallback;
}

let topicGroupEntityKindSet: Set<string> | null = null;

/**
 * 设置里「主题」分组下的类型（含顶层 topic 与各子类如人物、概念…）。
 * 用于时间线等：正文首条标题展示实体名称（人物名、主题名），与普通笔记区分。
 */
export function isTopicGroupEntityObjectKind(objectKind: string | undefined): boolean {
  if (!objectKind || objectKind === "note") return false;
  if (!topicGroupEntityKindSet) {
    const g = PRESET_OBJECT_TYPES_GROUPS.find((x) => x.baseId === "topic");
    topicGroupEntityKindSet = new Set(
      g ? [g.baseId, ...g.children.map((c) => c.id)] : []
    );
  }
  return topicGroupEntityKindSet.has(objectKind);
}

let clipGroupEntityKindSet: Set<string> | null = null;

/** 剪藏分组下类型（含 clip 父级与各子类），用于时间线标题等与人物卡类似的展示 */
export function isClipPresetObjectKind(objectKind: string | undefined): boolean {
  if (!objectKind || objectKind === "note") return false;
  if (!clipGroupEntityKindSet) {
    const g = PRESET_OBJECT_TYPES_GROUPS.find((x) => x.baseId === "clip");
    clipGroupEntityKindSet = new Set(
      g ? [g.baseId, ...g.children.map((c) => c.id)] : []
    );
  }
  return clipGroupEntityKindSet.has(objectKind);
}
