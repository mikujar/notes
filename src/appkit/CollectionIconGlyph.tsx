import type { ReactNode } from "react";
import type { CollectionIconShape } from "../types";

/**
 * 合集侧栏图标集。全部 24×24 viewBox，纯填色（fill=currentColor），
 * 保证用户选的颜色真能"染色"到图形，不依赖系统 emoji 字体。
 */

type IconDef = {
  labelZh: string;
  labelEn: string;
  /** 子元素；外层 <svg> + fill 由 CollectionIconGlyph 负责 */
  body: ReactNode;
};

const ICON_LIBRARY = {
  dot: {
    labelZh: "圆点",
    labelEn: "Dot",
    /** 半径与旧版 .sidebar__dot 8×8 填充圆点视觉等价（viewBox 24 → r=10.5 ≈ 87%） */
    body: <circle cx="12" cy="12" r="10.5" />,
  },
  square: {
    labelZh: "方块",
    labelEn: "Square",
    body: <rect x="3" y="3" width="18" height="18" rx="2.5" />,
  },
  triangle: {
    labelZh: "三角",
    labelEn: "Triangle",
    body: <polygon points="12,3 22,20 2,20" />,
  },
  diamond: {
    labelZh: "菱形",
    labelEn: "Diamond",
    body: <polygon points="12,2 22,12 12,22 2,12" />,
  },
  star: {
    labelZh: "星星",
    labelEn: "Star",
    body: (
      <polygon points="12,2 14.9,8.9 22,9.5 16.5,14.3 18.2,21.2 12,17.3 5.8,21.2 7.5,14.3 2,9.5 9.1,8.9" />
    ),
  },
  cross: {
    labelZh: "叉",
    labelEn: "Cross",
    body: (
      <path d="M6.3 4.2 L4.2 6.3 L9.9 12 L4.2 17.7 L6.3 19.8 L12 14.1 L17.7 19.8 L19.8 17.7 L14.1 12 L19.8 6.3 L17.7 4.2 L12 9.9 Z" />
    ),
  },
  check: {
    labelZh: "勾",
    labelEn: "Check",
    body: (
      <path d="M10.5 16.5 L4.5 10.5 L6.6 8.4 L10.5 12.3 L17.7 5.1 L19.8 7.2 Z" />
    ),
  },
  heart: {
    labelZh: "心形",
    labelEn: "Heart",
    body: (
      <path d="M12 21 C 11 20 3 14 3 8.5 C 3 5.9 5 4 7.5 4 C 9.3 4 10.9 5 12 6.5 C 13.1 5 14.7 4 16.5 4 C 19 4 21 5.9 21 8.5 C 21 14 13 20 12 21 Z" />
    ),
  },
  moon: {
    labelZh: "月亮",
    labelEn: "Moon",
    body: (
      <path d="M17 17 A 9 9 0 1 1 15 4 A 7 7 0 1 0 17 17 Z" />
    ),
  },
  lightning: {
    labelZh: "闪电",
    labelEn: "Bolt",
    body: (
      <polygon points="13,2 4,13 11,13 11,22 20,11 13,11" />
    ),
  },
  clover: {
    labelZh: "四叶草",
    labelEn: "Clover",
    body: (
      <g>
        <circle cx="12" cy="7" r="3.8" />
        <circle cx="7" cy="12" r="3.8" />
        <circle cx="17" cy="12" r="3.8" />
        <circle cx="12" cy="17" r="3.8" />
      </g>
    ),
  },
  flower: {
    labelZh: "小花",
    labelEn: "Flower",
    body: (
      <g>
        <circle cx="12" cy="5.5" r="3" />
        <circle cx="18.5" cy="9" r="3" />
        <circle cx="17" cy="16" r="3" />
        <circle cx="7" cy="16" r="3" />
        <circle cx="5.5" cy="9" r="3" />
        <circle cx="12" cy="12" r="2.4" />
      </g>
    ),
  },
  plus: {
    labelZh: "加号",
    labelEn: "Plus",
    body: (
      <path d="M10 4 H14 V10 H20 V14 H14 V20 H10 V14 H4 V10 H10 Z" />
    ),
  },
  bell: {
    labelZh: "铃铛",
    labelEn: "Bell",
    body: (
      <g>
        <path d="M12 3 A 7 7 0 0 1 19 10 V14 L21 17 H3 L5 14 V10 A 7 7 0 0 1 12 3 Z" />
        <circle cx="12" cy="20" r="1.8" />
      </g>
    ),
  },
  bookmark: {
    labelZh: "书签",
    labelEn: "Bookmark",
    body: <polygon points="6,3 18,3 18,21 12,17 6,21" />,
  },
  fish: {
    labelZh: "小鱼",
    labelEn: "Fish",
    body: (
      <g>
        <path d="M15 12 C 15 8.5 12 6 8 6 C 4 6 2 9 2 12 C 2 15 4 18 8 18 C 12 18 15 15.5 15 12 Z" />
        <polygon points="15,9 22,6 22,18 15,15" />
        <circle cx="6" cy="11" r="0.9" fill="#ffffff" />
      </g>
    ),
  },
  paw: {
    labelZh: "猫爪",
    labelEn: "Paw",
    body: (
      <g>
        <ellipse cx="6" cy="9" rx="2" ry="2.6" />
        <ellipse cx="10" cy="5.5" rx="2" ry="2.6" />
        <ellipse cx="14" cy="5.5" rx="2" ry="2.6" />
        <ellipse cx="18" cy="9" rx="2" ry="2.6" />
        <path d="M12 11 C 8 11 6 14 6 17 C 6 19.5 8 21 10 21 C 11 21 11.5 20 12 20 C 12.5 20 13 21 14 21 C 16 21 18 19.5 18 17 C 18 14 16 11 12 11 Z" />
      </g>
    ),
  },
  rocket: {
    labelZh: "火箭",
    labelEn: "Rocket",
    body: (
      <g>
        <path d="M12 2 L16 7 V15 H8 V7 Z" />
        <path d="M8 15 L6 18 L8 18 L9 21 L12 18 L15 21 L16 18 L18 18 L16 15 Z" />
        <circle cx="12" cy="9" r="1.5" fill="#ffffff" />
      </g>
    ),
  },
  sword: {
    labelZh: "剑",
    labelEn: "Sword",
    body: (
      <g>
        <path d="M13 2 L18 7 L8 17 L5 14 Z" />
        <rect x="3" y="16" width="6" height="2" rx="0.5" transform="rotate(45 6 17)" />
        <rect x="4" y="18" width="2.5" height="4" rx="0.5" />
      </g>
    ),
  },
  crown: {
    labelZh: "皇冠",
    labelEn: "Crown",
    body: (
      <path d="M3 8 L7 13 L12 6 L17 13 L21 8 L20 19 H4 Z" />
    ),
  },
  music: {
    labelZh: "音符",
    labelEn: "Music",
    body: (
      <g>
        <path d="M19 3 V15.5 A 3 3 0 1 1 17 13 V7 L10 9 V17.5 A 3 3 0 1 1 8 15 V6 Z" />
      </g>
    ),
  },
  cloud: {
    labelZh: "云",
    labelEn: "Cloud",
    body: (
      <path d="M6.5 19 C 4 19 2 17 2 14.5 C 2 12 4 10 6.5 10 C 7 7 9.5 5 12.5 5 C 16 5 18.5 7.5 18.5 11 C 20.5 11 22 12.5 22 14.5 C 22 17 20 19 17.5 19 Z" />
    ),
  },
  skull: {
    labelZh: "骷髅",
    labelEn: "Skull",
    body: (
      <g>
        <path d="M12 3 C 7 3 3 7 3 12 C 3 14.5 4 17 6 18.5 V21 H9 V19 H11 V21 H13 V19 H15 V21 H18 V18.5 C 20 17 21 14.5 21 12 C 21 7 17 3 12 3 Z" />
        <circle cx="9" cy="12" r="2" fill="#ffffff" />
        <circle cx="15" cy="12" r="2" fill="#ffffff" />
      </g>
    ),
  },
  fire: {
    labelZh: "火焰",
    labelEn: "Fire",
    body: (
      <path d="M12 2 C 12 6 8 7 8 11 C 8 8.5 6 8 6 8 C 6 14 3 14 3 18 C 3 21 6 22 9 22 L 15 22 C 18 22 21 21 21 18 C 21 13 16 12 16 8 C 16 10 15 10.5 14 10 C 15 7 13 5 12 2 Z" />
    ),
  },
} satisfies Record<string, IconDef>;

export type CollectionIconKey = keyof typeof ICON_LIBRARY;

const KNOWN_KEYS = Object.keys(ICON_LIBRARY) as CollectionIconKey[];

export function normalizeCollectionIconShape(
  raw: unknown
): CollectionIconKey {
  if (typeof raw !== "string") return "dot";
  const v = raw.trim().toLowerCase();
  return (KNOWN_KEYS as readonly string[]).includes(v)
    ? (v as CollectionIconKey)
    : "dot";
}

export function COLLECTION_ICON_SHAPE_OPTIONS(): {
  value: CollectionIconKey;
  labelZh: string;
  labelEn: string;
}[] {
  return KNOWN_KEYS.map((k) => ({
    value: k,
    labelZh: ICON_LIBRARY[k].labelZh,
    labelEn: ICON_LIBRARY[k].labelEn,
  }));
}

export function CollectionIconGlyph({
  shape,
  color,
  size = 10,
  className,
}: {
  shape?: CollectionIconShape | string | null;
  color: string;
  size?: number;
  className?: string;
}) {
  const key = normalizeCollectionIconShape(shape);
  const def = ICON_LIBRARY[key];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke={color}
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        flex: "0 0 auto",
      }}
    >
      {def.body}
    </svg>
  );
}
