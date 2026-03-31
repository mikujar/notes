import type { Collection } from "./types";

function t(h: number, m: number) {
  return h * 60 + m;
}

/** 内置示例：演示时间块、子合集、附件轮播等（刷新会恢复） */
export const collections: Collection[] = [
  {
    id: "c1",
    name: "示例 · 功能介绍",
    dotColor: "#5e9fe8",
    children: [
      {
        id: "c1-morning",
        name: "晨间",
        dotColor: "#fbbf24",
        blocks: [
          {
            id: "b-morning",
            minutesOfDay: t(7, 30),
            cards: [
              {
                id: "n-morning",
                text: "【示例子合集】「晨间」挂在「示例 · 一天怎么记」下面。子合集里的时间块、卡片与顶级合集完全一样，只是多了一层归类。\n可用来分：工作 / 生活、项目 A / 项目 B。",
              },
            ],
          },
        ],
      },
      {
        id: "c1-night",
        name: "夜间",
        dotColor: "#a78bfa",
        blocks: [
          {
            id: "b1n",
            minutesOfDay: t(23, 10),
            cards: [
              {
                id: "n-night",
                text: "【示例】睡前复盘、明日待办也可以单独放在一个子合集里，和白天记录分开看。",
              },
            ],
          },
        ],
      },
    ],
    blocks: [
      {
        id: "b1",
        minutesOfDay: t(1, 50),
        cards: [
          {
            id: "n1",
            text: "【示例 · 附件】本条右侧轮播里有：图片、示例 PDF、短视频。点击缩略图可看大图/播放；右键某一帧可「删除附件」。卡片菜单「⋯」里还能继续「添加文件」或「清空附件」。\n\n【示例 · 多行】多打几行字，背景横线会跟着走，像横格纸。",
            media: [
              {
                kind: "image",
                url: "https://picsum.photos/seed/notes1a/400/280",
              },
              {
                kind: "file",
                url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                name: "示例-dummy.pdf",
              },
              {
                kind: "video",
                url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
              },
              {
                kind: "image",
                url: "https://picsum.photos/seed/notes1c/400/280",
              },
            ],
          },
          {
            id: "n2",
            text: "【示例 · 置顶】这条被置顶了，会固定出现在本合集列表最上方（置顶区），和普通时间线之间有一条分隔。\n在「⋯」里可「取消置顶」。",
            pinned: true,
          },
        ],
      },
      {
        id: "b2",
        minutesOfDay: t(1, 52),
        cards: [
          {
            id: "n3",
            text: "【示例 · 会议】14:00 站会\n- 风险：依赖方未回确认\n- 负责人：@小陈 今天下班前跟进\n\n会后可以把结论拆成多条，分别塞进相关时间块。",
          },
        ],
      },
      {
        id: "b3",
        minutesOfDay: t(9, 15),
        cards: [
          {
            id: "n4",
            text: "【示例 · 想法】灵感不用写成完整文章——先记在「当下这一刻」，以后再整理也行。",
          },
          {
            id: "n5",
            text: "【示例 · 导航】左侧点不同合集，右侧只显示该合集下的时间线；标题下方灰色小字是合集说明（可双击改成你自己的介绍）。",
          },
        ],
      },
    ],
  },
  {
    id: "c2",
    name: "示例 · 工作项目",
    dotColor: "#c084fc",
    blocks: [
      {
        id: "b4",
        minutesOfDay: t(14, 30),
        cards: [
          {
            id: "n6",
            text: "【示例】可把「一个项目」做成一个合集，里面按会议时间、里程碑时间堆笔记。\n若以后要接后端，可把 GET /collections、POST /blocks 这类接口接在同样结构上。",
          },
        ],
      },
      {
        id: "b5",
        minutesOfDay: t(16, 5),
        cards: [
          {
            id: "n7",
            text: "【示例】排版参考了常见的浅色灵感笔记：主区灰底、卡片白底 + 淡横线，长时间写眼睛不那么累。",
          },
        ],
      },
    ],
  },
  {
    id: "c3",
    name: "示例 · 读书笔记",
    dotColor: "#6ee7b7",
    blocks: [
      {
        id: "b6",
        minutesOfDay: t(22, 40),
        cards: [
          {
            id: "n8",
            text: "【示例】读到某一段有感触，不必等「读完一章」——先记在现在的钟点，书名或章节可以写在正文里当标签。",
          },
        ],
      },
    ],
  },
];
