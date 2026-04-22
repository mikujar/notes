import type { ReactNode } from "react";

/**
 * 左侧 rail / 概览面板专用的 20 个装饰形 glyph。
 * 独立于 CollectionIconGlyph：rail 想要更有形状感的一组抽象图标，
 * 不需要暴露成「用户可为合集挑选的图标」。
 * 所有路径在 24×24 viewBox 内，单色 fill / 可选 stroke 来自 currentColor。
 */

type ShapeDef = {
  body: ReactNode;
  /** 该形状的缺省配色（来自用户提供的参考图），调用方不传 color 时使用 */
  color: string;
};

/** 参考图的调色板 */
const PALETTE = {
  red: "#DE4A2C",
  orange: "#E68045",
  yellow: "#E6A82A",
  blue: "#8CB1D9",
  teal: "#1F5F57",
  pink: "#E3A0AB",
};

/**
 * 造型规则：所有 shape 尽量把 24×24 viewBox 撑到 ~80%，用 fat / 圆角 /
 * 实心填色去对齐参考图「胖乎乎撑出来」的风格；能用圆角胶囊就不用细线。
 */
const SHAPES = {
  heart: {
    color: PALETTE.red,
    body: (
      <path d="M12 20.8 C 10.4 19.6 2.5 14 2.5 8.2 C 2.5 5 5 2.8 8 2.8 C 9.8 2.8 11.1 3.8 12 5.4 C 12.9 3.8 14.2 2.8 16 2.8 C 19 2.8 21.5 5 21.5 8.2 C 21.5 14 13.6 19.6 12 20.8 Z" />
    ),
  },
  sparkle: {
    color: PALETTE.yellow,
    body: (
      <g>
        <rect x="10.2" y="1.5" width="3.6" height="21" rx="1.8" />
        <rect
          x="10.2"
          y="1.5"
          width="3.6"
          height="21"
          rx="1.8"
          transform="rotate(45 12 12)"
        />
        <rect
          x="10.2"
          y="1.5"
          width="3.6"
          height="21"
          rx="1.8"
          transform="rotate(90 12 12)"
        />
        <rect
          x="10.2"
          y="1.5"
          width="3.6"
          height="21"
          rx="1.8"
          transform="rotate(135 12 12)"
        />
      </g>
    ),
  },
  donut: {
    color: PALETTE.blue,
    // 胖甜甜圈：更大的外圆 + 更小的孔 + 稍大的中心点
    body: (
      <g>
        <path
          fillRule="evenodd"
          d="M 12 2 A 10 10 0 1 0 12 22 A 10 10 0 1 0 12 2 Z M 12 7.6 A 4.4 4.4 0 1 1 12 16.4 A 4.4 4.4 0 1 1 12 7.6 Z"
        />
        <circle cx="12" cy="12" r="2.4" />
      </g>
    ),
  },
  stair: {
    color: PALETTE.teal,
    body: (
      <path d="M2.5 21.5 V16.5 H9 V12 H14.5 V7 H21.5 V21.5 Z" />
    ),
  },
  peanut: {
    color: PALETTE.orange,
    body: (
      <g>
        <circle cx="12" cy="7.2" r="5.6" />
        <circle cx="12" cy="16.8" r="5.6" />
      </g>
    ),
  },
  arch: {
    color: PALETTE.pink,
    // 胖墓碑：更宽的底、更圆的顶
    body: <path d="M3 21.5 V12 A 9 9 0 0 1 21 12 V21.5 Z" />,
  },
  petal: {
    color: PALETTE.pink,
    // 更粗的圆角十字
    body: (
      <g>
        <rect x="8" y="1.5" width="8" height="21" rx="4" />
        <rect x="1.5" y="8" width="21" height="8" rx="4" />
      </g>
    ),
  },
  wave: {
    color: PALETTE.yellow,
    body: (
      <g>
        <path d="M2.5 5 Q 7 2.5 12 4 T 21.5 5 V10.5 Q 16 12 12 10.5 T 2.5 10 Z" />
        <path d="M2.5 13.5 Q 7 11 12 12.5 T 21.5 13.5 V19 Q 16 20.5 12 19 T 2.5 18.5 Z" />
      </g>
    ),
  },
  butterfly: {
    color: PALETTE.red,
    // 4 片更大的椭圆花瓣，彼此压到中心
    body: (
      <g>
        <ellipse cx="7" cy="7.5" rx="5" ry="5.2" />
        <ellipse cx="17" cy="7.5" rx="5" ry="5.2" />
        <ellipse cx="7" cy="16.5" rx="5" ry="5" />
        <ellipse cx="17" cy="16.5" rx="5" ry="5" />
      </g>
    ),
  },
  capsule: {
    color: PALETTE.blue,
    // 胖胶囊：更粗（7）更长（21），倾斜角稍收一点
    body: (
      <rect
        x="1.5"
        y="8.5"
        width="21"
        height="7"
        rx="3.5"
        transform="rotate(-32 12 12)"
      />
    ),
  },
  arc: {
    color: PALETTE.orange,
    // 更粗的 L 形 1/4 弧带
    body: (
      <path d="M4 21 A 15 15 0 0 1 21 4 L 21 11 A 9 9 0 0 0 11 21 Z" />
    ),
  },
  quad: {
    color: PALETTE.blue,
    // 4 颗胖圆互相重叠
    body: (
      <g>
        <circle cx="6.2" cy="12" r="5.8" />
        <circle cx="17.8" cy="12" r="5.8" />
        <circle cx="12" cy="6.2" r="5.8" />
        <circle cx="12" cy="17.8" r="5.8" />
      </g>
    ),
  },
  rainbow: {
    color: PALETTE.pink,
    // 更粗的空心拱桥
    body: (
      <path d="M2 21.5 V12 A 10 10 0 0 1 22 12 V21.5 H16.5 V12 A 4.5 4.5 0 0 0 7.5 12 V21.5 Z" />
    ),
  },
  dots: {
    color: PALETTE.orange,
    // 5 颗胖圆点，几乎贴到一起
    body: (
      <g>
        <circle cx="12" cy="4.8" r="3" />
        <circle cx="12" cy="19.2" r="3" />
        <circle cx="4.8" cy="12" r="3" />
        <circle cx="19.2" cy="12" r="3" />
        <circle cx="12" cy="12" r="3" />
      </g>
    ),
  },
  hourglass: {
    color: PALETTE.pink,
    body: (
      <path d="M3.5 2.5 H20.5 V6 L13.2 12 L20.5 18 V21.5 H3.5 V18 L10.8 12 L3.5 6 Z" />
    ),
  },
  sStep: {
    color: PALETTE.orange,
    // 更粗的上下两段圆角砖 + 连接腰
    body: (
      <g>
        <rect x="6" y="2" width="15" height="8" rx="4" />
        <rect x="3" y="14" width="15" height="8" rx="4" />
        <rect x="10" y="8" width="4" height="8" />
      </g>
    ),
  },
  scallop: {
    color: PALETTE.teal,
    // 顶端三个更高的圆峰
    body: (
      <path d="M2.5 21.5 V13 Q 6 7 9 13 Q 12 7 15 13 Q 18 7 21.5 13 V21.5 Z" />
    ),
  },
  ring: {
    color: PALETTE.red,
    // 粗壮的纯空心圆
    body: (
      <path
        fillRule="evenodd"
        d="M 12 2 A 10 10 0 1 0 12 22 A 10 10 0 1 0 12 2 Z M 12 6.5 A 5.5 5.5 0 1 1 12 17.5 A 5.5 5.5 0 1 1 12 6.5 Z"
      />
    ),
  },
  bloom: {
    color: PALETTE.pink,
    // 8 片胖花瓣围绕
    body: (
      <g>
        <circle cx="12" cy="4.2" r="3.5" />
        <circle cx="17.5" cy="6.5" r="3.5" />
        <circle cx="19.8" cy="12" r="3.5" />
        <circle cx="17.5" cy="17.5" r="3.5" />
        <circle cx="12" cy="19.8" r="3.5" />
        <circle cx="6.5" cy="17.5" r="3.5" />
        <circle cx="4.2" cy="12" r="3.5" />
        <circle cx="6.5" cy="6.5" r="3.5" />
        <circle cx="12" cy="12" r="3.5" />
      </g>
    ),
  },
  twinkle: {
    color: PALETTE.yellow,
    // 胖乎乎的 4 尖星：用 cubic 让腰部收得圆润
    body: (
      <path d="M12 1.5 C 13 7 14 10 16 11 C 18 11.5 20.5 12 22.5 12 C 20.5 12 18 12.5 16 13 C 14 14 13 17 12 22.5 C 11 17 10 14 8 13 C 6 12.5 3.5 12 1.5 12 C 3.5 12 6 11.5 8 11 C 10 10 11 7 12 1.5 Z" />
    ),
  },
  bin: {
    color: PALETTE.pink,
    // 胖垃圾桶：把手 + 盖 + 圆角渐窄桶身，全部实心填色
    body: (
      <g>
        <rect x="9.5" y="2.5" width="5" height="3" rx="1.5" />
        <rect x="3" y="5.5" width="18" height="4" rx="2" />
        <path d="M5 10.5 H19 L17.5 21.2 C 17.4 22 16.7 22.5 15.9 22.5 H8.1 C 7.3 22.5 6.6 22 6.5 21.2 Z" />
      </g>
    ),
  },
} satisfies Record<string, ShapeDef>;

export type RailIconKey = keyof typeof SHAPES;

export function RailIcon({
  shape,
  size = 22,
  color,
  className,
}: {
  shape: RailIconKey;
  size?: number;
  /** 不传则使用该 shape 在参考图里的缺省配色 */
  color?: string;
  className?: string;
}) {
  const def = SHAPES[shape];
  const fill = color ?? def.color;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="none"
      color={fill}
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
