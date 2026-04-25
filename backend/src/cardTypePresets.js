/**
 * cardTypePresets.js — 预设 card_types 类型树定义与种子函数。
 *
 * 严格镜像前端 src/notePresetTypesCatalog.ts，确保两端数据一致：
 *   - card_types.preset_slug = 前端 child.id 或 group.baseId
 *   - card_types.name        = 前端 nameZh / baseLabelZh
 *   - card_types.schema_json = { fields: [{ id, name, type, order, options? }] }
 *     字段对象与前端 SchemaField 一一对应（id 形如 'sf-img-taken' 必须保留）
 *
 * 每个用户注册后调用 seedPresetCardTypesForUser(userId, client)。
 */

import crypto from "crypto";

/** 顶层大类（kind） + 子类型，与前端 PRESET_OBJECT_TYPES_GROUPS 完全对齐。 */
export const PRESET_TREE = [
  {
    slug: "note",
    kind: "note",
    name: "笔记",
    schema: {},
    children: [
      {
        slug: "note_standard",
        name: "学习",
        schema: {
          fields: [
            { id: "sf-study-subject", name: "科目 / 主题", type: "text", order: 0 },
            { id: "sf-study-source-url", name: "参考链接", type: "url", order: 1 },
            { id: "sf-study-review", name: "复习日", type: "date", order: 2 },
          ],
        },
      },
      {
        slug: "note_book",
        name: "读书笔记",
        schema: {
          fields: [
            { id: "sf-booknote-title", name: "书名", type: "text", order: 0 },
            { id: "sf-booknote-author", name: "作者", type: "text", order: 1 },
            { id: "sf-booknote-page", name: "页码 / 章节", type: "text", order: 2 },
          ],
        },
      },
      {
        slug: "note_video",
        name: "视频笔记",
        schema: {
          fields: [
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
      },
      {
        slug: "idea",
        name: "灵感",
        schema: {
          fields: [
            { id: "sf-idea-context", name: "触发场景", type: "text", order: 0 },
            { id: "sf-idea-next", name: "下一步", type: "text", order: 1 },
          ],
        },
      },
      {
        slug: "journal",
        name: "日记",
        schema: {
          fields: [
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
      },
      {
        slug: "quote",
        name: "摘抄",
        schema: {
          fields: [
            { id: "sf-quote-source", name: "出处", type: "text", order: 0 },
            { id: "sf-quote-source-url", name: "原文链接", type: "url", order: 1 },
          ],
        },
      },
    ],
  },
  {
    slug: "file",
    kind: "file",
    name: "文件",
    schema: {
      fields: [
        { id: "sf-file-source", name: "来源", type: "cardLink", order: 5, readonly: true },
      ],
    },
    children: [
      {
        slug: "file_image",
        name: "图片",
        schema: {
          fields: [
            { id: "sf-img-taken", name: "拍摄时间", type: "date", order: 1 },
            { id: "sf-img-location", name: "地点", type: "text", order: 2 },
          ],
        },
      },
      {
        slug: "file_video",
        name: "视频",
        schema: {
          fields: [
            { id: "sf-vid-duration-sec", name: "时长", type: "number", order: 1, readonly: true },
            { id: "sf-vid-resolution", name: "分辨率", type: "text", order: 2, readonly: true },
          ],
        },
      },
      {
        slug: "file_audio",
        name: "音频",
        schema: {
          fields: [
            { id: "sf-aud-duration-sec", name: "时长", type: "number", order: 1, readonly: true },
            { id: "sf-aud-artist", name: "表演者 / 播客", type: "text", order: 2 },
          ],
        },
      },
      {
        slug: "file_document",
        name: "文档",
        schema: {
          fields: [
            { id: "sf-doc-pages", name: "页数", type: "number", order: 1 },
            { id: "sf-doc-author", name: "作者", type: "text", order: 2 },
          ],
        },
      },
      {
        slug: "file_other",
        name: "其他",
        schema: {
          fields: [
            { id: "sf-file-other-mime", name: "类型说明", type: "text", order: 1 },
            { id: "sf-file-other-note", name: "备注", type: "text", order: 2 },
          ],
        },
      },
    ],
  },
  {
    slug: "topic",
    kind: "custom",
    name: "主题",
    schema: {},
    children: [
      {
        slug: "person",
        name: "人物",
        titleLabel: "姓名",
        schema: {
          fields: [
            { id: "sf-person-role", name: "身份", type: "text", order: 1 },
            { id: "sf-person-org", name: "所属组织", type: "collectionLink", order: 2 },
            { id: "sf-person-url", name: "主页链接", type: "url", order: 3 },
            { id: "sf-person-works", name: "作品", type: "cardLinks", order: 4 },
          ],
        },
      },
      {
        slug: "organization",
        name: "组织",
        schema: {
          fields: [
            { id: "sf-org-type", name: "类型", type: "text", order: 0 },
            { id: "sf-org-url", name: "官网", type: "url", order: 1 },
          ],
        },
      },
      {
        slug: "event",
        name: "事件",
        schema: {
          fields: [
            { id: "sf-event-start", name: "开始日期", type: "date", order: 0 },
            { id: "sf-event-end", name: "结束日期", type: "date", order: 1 },
            { id: "sf-event-place", name: "地点", type: "text", order: 2 },
          ],
        },
      },
      {
        slug: "place",
        name: "地点",
        schema: {
          fields: [
            { id: "sf-place-address", name: "地址", type: "text", order: 0 },
            { id: "sf-place-map-url", name: "地图链接", type: "url", order: 1 },
          ],
        },
      },
      {
        slug: "topic_concept",
        name: "概念",
        schema: {
          fields: [
            { id: "sf-concept-summary", name: "一句话定义", type: "text", order: 0 },
            { id: "sf-concept-ref-url", name: "参考链接", type: "url", order: 1 },
          ],
        },
      },
      {
        slug: "work_book",
        name: "书籍",
        schema: {
          fields: [
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
      },
      {
        slug: "work_movie",
        name: "影视",
        schema: {
          fields: [
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
      },
      {
        slug: "work_anime",
        name: "动漫",
        schema: {
          fields: [
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
      },
      {
        slug: "work_music",
        name: "音乐",
        schema: {
          fields: [
            { id: "sf-music-artist", name: "艺术家", type: "text", order: 0 },
            { id: "sf-music-album", name: "专辑", type: "text", order: 1 },
            { id: "sf-music-year", name: "发行年", type: "number", order: 2 },
          ],
        },
      },
      {
        slug: "work_game",
        name: "游戏",
        schema: {
          fields: [
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
      },
      {
        slug: "work_course",
        name: "课程",
        schema: {
          fields: [
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
      },
      {
        slug: "work_app",
        name: "应用",
        schema: {
          fields: [
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
      },
    ],
  },
  {
    slug: "clip",
    kind: "custom",
    name: "剪藏",
    schema: {
      fields: [
        { id: "sf-clip-url", name: "链接", type: "url", order: 0 },
      ],
    },
    children: [
      {
        slug: "clip_bookmark",
        name: "网页",
        schema: {
          fields: [
            { id: "sf-bookmark-site", name: "网站名称", type: "text", order: 2 },
            { id: "sf-bookmark-highlight", name: "摘录 / 笔记", type: "text", order: 3 },
          ],
        },
      },
      {
        slug: "clip_email",
        name: "邮件",
        schema: {
          fields: [
            { id: "sf-email-from", name: "发件人", type: "text", order: 2 },
            { id: "sf-email-subject", name: "主题", type: "text", order: 3 },
            { id: "sf-email-received", name: "收件时间", type: "date", order: 4 },
          ],
        },
      },
      {
        slug: "post_xhs",
        name: "小红书",
        schema: {
          fields: [
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
      },
      {
        slug: "post_bilibili",
        name: "B 站",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_wechat",
        name: "微信公众号",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_douyin",
        name: "抖音",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_weibo",
        name: "微博",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_zhihu",
        name: "知乎",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_douban",
        name: "豆瓣",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_github",
        name: "Github",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_twitter",
        name: "推特 / X",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_instagram",
        name: "Instagram",
        schema: {
          fields: [
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
      },
      {
        slug: "clip_reddit",
        name: "Reddit",
        schema: {
          fields: [
            { id: "sf-reddit-author", name: "作者", type: "text", order: 2 },
            { id: "sf-reddit-subreddit", name: "子版块", type: "text", order: 3 },
            { id: "sf-reddit-date", name: "发布日期", type: "date", order: 4 },
          ],
        },
      },
      {
        slug: "clip_appstore",
        name: "App Store",
        schema: {
          fields: [
            { id: "sf-appstore-developer", name: "开发商", type: "text", order: 2 },
            { id: "sf-appstore-price", name: "价格", type: "number", order: 3 },
            { id: "sf-appstore-rating", name: "评分", type: "number", order: 4 },
          ],
        },
      },
    ],
  },
  {
    slug: "task",
    kind: "custom",
    name: "任务",
    schema: {
      fields: [
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
    children: [
      {
        slug: "task_todo",
        name: "待办",
        schema: {
          fields: [
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
      },
      {
        slug: "task_schedule",
        name: "日程",
        schema: {
          fields: [
            { id: "sf-schedule-start", name: "开始时间", type: "date", order: 0 },
            { id: "sf-schedule-end", name: "结束时间", type: "date", order: 1 },
            { id: "sf-schedule-location", name: "地点", type: "text", order: 2 },
          ],
        },
      },
      {
        slug: "habit_log",
        name: "习惯",
        schema: {
          fields: [
            { id: "sf-habit-streak", name: "连续天数", type: "number", order: 0 },
            { id: "sf-habit-note", name: "备注", type: "text", order: 1 },
          ],
        },
      },
    ],
  },
  {
    slug: "project",
    kind: "custom",
    name: "项目",
    schema: {
      fields: [
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
    },
    children: [
      {
        slug: "project_doing",
        name: "在做",
        schema: {
          fields: [
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
      },
      {
        slug: "project_archived",
        name: "已归档",
        schema: {
          fields: [
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
      },
    ],
  },
  {
    slug: "expense",
    kind: "custom",
    name: "开支",
    schema: {
      fields: [
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
    },
    children: [
      {
        slug: "expense_daily",
        name: "日常",
        schema: {
          fields: [
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
      },
      {
        slug: "expense_subscription",
        name: "订阅",
        schema: {
          fields: [
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
      },
      {
        slug: "expense_reimburse",
        name: "报销",
        schema: {
          fields: [
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
      },
    ],
  },
  {
    slug: "account",
    kind: "custom",
    name: "账户",
    schema: {
      fields: [
        { id: "sf-account-platform", name: "平台", type: "text", order: 0 },
      ],
    },
    children: [
      {
        slug: "account_login",
        name: "登录",
        schema: {
          fields: [
            { id: "sf-account-username", name: "用户名", type: "text", order: 1 },
            { id: "sf-account-password", name: "密码", type: "text", order: 2 },
            { id: "sf-account-login-url", name: "登录链接", type: "url", order: 3 },
            { id: "sf-account-2fa", name: "启用 2FA", type: "checkbox", order: 4 },
          ],
        },
      },
      {
        slug: "account_bankcard",
        name: "银行卡",
        schema: {
          fields: [
            { id: "sf-bank-cardno", name: "卡号", type: "text", order: 1 },
            { id: "sf-bank-holder", name: "持卡人", type: "text", order: 2 },
            { id: "sf-bank-expiry", name: "有效期", type: "date", order: 3 },
            { id: "sf-bank-cvv", name: "CVV", type: "text", order: 4 },
          ],
        },
      },
      {
        slug: "account_id",
        name: "证件",
        schema: {
          fields: [
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
      },
    ],
  },
];

function flattenPresets(tree) {
  const out = [];
  for (let rootSort = 0; rootSort < tree.length; rootSort += 1) {
    const root = tree[rootSort];
    out.push({
      slug: root.slug,
      kind: root.kind,
      name: root.name,
      schema: root.schema || {},
      parentSlug: null,
      sortOrder: rootSort,
    });
    const children = root.children || [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      out.push({
        slug: child.slug,
        kind: root.kind,
        name: child.name,
        schema: child.schema || {},
        parentSlug: root.slug,
        sortOrder: i,
      });
    }
  }
  return out;
}

function newTypeId() {
  return `ct_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * 在给定用户下种入全部预设类型树。调用方负责事务（传入 client）。
 * 返回 { slugToId } 映射。
 */
export async function seedPresetCardTypesForUser(userId, client) {
  if (!userId) throw new Error("seedPresetCardTypesForUser: userId required");
  if (!client) throw new Error("seedPresetCardTypesForUser: client required");

  const flat = flattenPresets(PRESET_TREE);
  const slugToId = new Map();

  for (const node of flat.filter((n) => n.parentSlug === null)) {
    const id = newTypeId();
    slugToId.set(node.slug, id);
    await client.query(
      `INSERT INTO card_types (id, user_id, parent_type_id, kind, name, schema_json, is_preset, preset_slug, sort_order)
       VALUES ($1,$2,NULL,$3,$4,$5::jsonb,true,$6,$7)`,
      [id, userId, node.kind, node.name, JSON.stringify(node.schema), node.slug, node.sortOrder]
    );
  }
  for (const node of flat.filter((n) => n.parentSlug !== null)) {
    const id = newTypeId();
    const parentId = slugToId.get(node.parentSlug);
    if (!parentId) throw new Error(`missing parent for preset ${node.slug}`);
    slugToId.set(node.slug, id);
    await client.query(
      `INSERT INTO card_types (id, user_id, parent_type_id, kind, name, schema_json, is_preset, preset_slug, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,$7,$8)`,
      [id, userId, parentId, node.kind, node.name, JSON.stringify(node.schema), node.slug, node.sortOrder]
    );
  }

  return { slugToId };
}

export async function findPresetTypeIdBySlug(userId, slug, client) {
  const res = await client.query(
    `SELECT id FROM card_types WHERE user_id=$1 AND preset_slug=$2 LIMIT 1`,
    [userId, slug]
  );
  return res.rows[0]?.id || null;
}

/**
 * 按最新 PRESET_TREE 刷新所有用户的预设 card_types。
 * 调用方负责事务（传入 client）。
 */
export async function refreshPresetCardTypesForAllUsers(client) {
  if (!client) throw new Error("refreshPresetCardTypesForAllUsers: client required");
  const flat = flattenPresets(PRESET_TREE);
  const users = (await client.query(`SELECT id FROM users`)).rows;
  let updated = 0;
  let inserted = 0;

  for (const u of users) {
    const userId = u.id;
    const slugToId = new Map();

    for (const node of flat.filter((n) => n.parentSlug === null)) {
      const existing = await client.query(
        `SELECT id FROM card_types WHERE user_id = $1 AND preset_slug = $2`,
        [userId, node.slug]
      );
      if (existing.rowCount > 0) {
        const id = existing.rows[0].id;
        slugToId.set(node.slug, id);
        await client.query(
          `UPDATE card_types
              SET name = $2, kind = $3, schema_json = $4::jsonb,
                  is_preset = true, parent_type_id = NULL, sort_order = $5
            WHERE id = $1`,
          [id, node.name, node.kind, JSON.stringify(node.schema), node.sortOrder]
        );
        updated += 1;
      } else {
        const id = newTypeId();
        slugToId.set(node.slug, id);
        await client.query(
          `INSERT INTO card_types (id, user_id, parent_type_id, kind, name, schema_json, is_preset, preset_slug, sort_order)
           VALUES ($1,$2,NULL,$3,$4,$5::jsonb,true,$6,$7)`,
          [id, userId, node.kind, node.name, JSON.stringify(node.schema), node.slug, node.sortOrder]
        );
        inserted += 1;
      }
    }

    for (const node of flat.filter((n) => n.parentSlug !== null)) {
      const parentId = slugToId.get(node.parentSlug);
      if (!parentId) continue;
      const existing = await client.query(
        `SELECT id FROM card_types WHERE user_id = $1 AND preset_slug = $2`,
        [userId, node.slug]
      );
      if (existing.rowCount > 0) {
        await client.query(
          `UPDATE card_types
              SET name = $2, kind = $3, schema_json = $4::jsonb,
                  is_preset = true, parent_type_id = $5, sort_order = $6
            WHERE id = $1`,
          [
            existing.rows[0].id,
            node.name,
            node.kind,
            JSON.stringify(node.schema),
            parentId,
            node.sortOrder,
          ]
        );
        updated += 1;
      } else {
        const id = newTypeId();
        await client.query(
          `INSERT INTO card_types (id, user_id, parent_type_id, kind, name, schema_json, is_preset, preset_slug, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,$7,$8)`,
          [id, userId, parentId, node.kind, node.name, JSON.stringify(node.schema), node.slug, node.sortOrder]
        );
        inserted += 1;
      }
    }
  }

  return { users: users.length, updated, inserted };
}
