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
        { id: "sf-file-title", name: "标题", type: "text", order: 0 },
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
    kind: "topic",
    name: "主题",
    schema: {},
    children: [
      {
        slug: "person",
        name: "人物",
        schema: {
          fields: [
            { id: "sf-person-name", name: "名称", type: "text", order: 0 },
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
    ],
  },
  {
    slug: "work",
    kind: "work",
    name: "作品",
    schema: {
      fields: [{ id: "sf-work-title", name: "标题", type: "text", order: -1 }],
    },
    children: [
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
        slug: "work_article",
        name: "文章",
        schema: {
          fields: [
            { id: "sf-article-author", name: "作者", type: "text", order: 0 },
            { id: "sf-article-url", name: "原文链接", type: "url", order: 1 },
            { id: "sf-article-published", name: "发布日", type: "date", order: 2 },
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
    kind: "clip",
    name: "剪藏",
    schema: {
      fields: [
        { id: "sf-clip-url", name: "链接", type: "url", order: 0 },
        { id: "sf-clip-title", name: "标题", type: "text", order: 1 },
      ],
    },
    children: [
      {
        slug: "clip_bookmark",
        name: "网页剪藏",
        schema: {
          fields: [
            { id: "sf-bookmark-site", name: "网站名称", type: "text", order: 2 },
            { id: "sf-bookmark-highlight", name: "摘录 / 笔记", type: "text", order: 3 },
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
              type: "cardLink",
              order: 2,
              cardLinkFromEdge: "creator",
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
          autoLinkRules: [
            {
              ruleId: "xhs-auto-graph",
              trigger: "on_create",
              targets: [
                {
                  targetKey: "creator",
                  targetObjectKind: "person",
                  linkType: "creator",
                  targetPresetTypeId: "person",
                  syncSchemaFieldId: "sf-xhs-author",
                },
              ],
            },
          ],
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
              type: "cardLink",
              order: 2,
              cardLinkFromEdge: "creator",
            },
            { id: "sf-bili-date", name: "发布日期", type: "date", order: 3 },
            { id: "sf-bili-duration", name: "时长", type: "number", order: 4, readonly: true },
          ],
          autoLinkRules: [
            {
              ruleId: "bili-auto-graph",
              trigger: "on_create",
              targets: [
                {
                  targetKey: "creator",
                  targetObjectKind: "person",
                  linkType: "creator",
                  targetPresetTypeId: "person",
                  syncSchemaFieldId: "sf-bili-author",
                },
              ],
            },
          ],
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
        slug: "clip_other",
        name: "其他剪藏",
        schema: {
          fields: [
            { id: "sf-clip-other-source", name: "来源", type: "text", order: 2 },
            { id: "sf-clip-other-note", name: "备注", type: "text", order: 3 },
          ],
        },
      },
    ],
  },
  {
    slug: "task",
    kind: "task",
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
        slug: "habit_log",
        name: "习惯打卡",
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
    kind: "project",
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
    children: [],
  },
  {
    slug: "expense",
    kind: "expense",
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
    children: [],
  },
  {
    slug: "account",
    kind: "account",
    name: "账户",
    schema: {
      fields: [
        { id: "sf-account-platform", name: "平台", type: "text", order: 0 },
        { id: "sf-account-username", name: "用户名", type: "text", order: 1 },
        { id: "sf-account-password", name: "密码", type: "text", order: 2 },
        { id: "sf-account-login-url", name: "登录链接", type: "url", order: 3 },
      ],
    },
    children: [],
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
