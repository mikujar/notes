import type { CSSProperties } from "react";
import type { CollectionIconShape } from "../types";

const KNOWN_SHAPES: CollectionIconShape[] = [
  "dot",
  "square",
  "triangle",
  "diamond",
  "star",
  "cross",
  "check",
];

export function normalizeCollectionIconShape(
  raw: unknown
): CollectionIconShape {
  if (typeof raw !== "string") return "dot";
  const v = raw.trim().toLowerCase();
  return (KNOWN_SHAPES as readonly string[]).includes(v)
    ? (v as CollectionIconShape)
    : "dot";
}

export function COLLECTION_ICON_SHAPE_OPTIONS(): {
  value: CollectionIconShape;
  labelZh: string;
  labelEn: string;
}[] {
  return [
    { value: "dot", labelZh: "圆点", labelEn: "Dot" },
    { value: "square", labelZh: "方块", labelEn: "Square" },
    { value: "triangle", labelZh: "三角", labelEn: "Triangle" },
    { value: "diamond", labelZh: "菱形", labelEn: "Diamond" },
    { value: "star", labelZh: "星星", labelEn: "Star" },
    { value: "cross", labelZh: "叉", labelEn: "Cross" },
    { value: "check", labelZh: "勾", labelEn: "Check" },
  ];
}

/** 侧栏合集图标：7 种形状共用一个小渲染器，填色统一；SVG 形状无需依赖字体 */
export function CollectionIconGlyph({
  shape,
  color,
  size = 8,
  className,
}: {
  shape?: CollectionIconShape | string | null;
  color: string;
  size?: number;
  className?: string;
}) {
  const effective = normalizeCollectionIconShape(shape);
  const cls = className ?? "";
  const boxStyle: CSSProperties = {
    width: size,
    height: size,
    display: "inline-block",
    verticalAlign: "middle",
    flex: "0 0 auto",
  };

  if (effective === "dot") {
    return (
      <span
        className={cls}
        aria-hidden
        style={{ ...boxStyle, borderRadius: "50%", backgroundColor: color }}
      />
    );
  }
  if (effective === "square") {
    return (
      <span
        className={cls}
        aria-hidden
        style={{ ...boxStyle, borderRadius: 1, backgroundColor: color }}
      />
    );
  }
  if (effective === "diamond") {
    /** 外层撑尺寸，内层旋转 45° — 避免旋转把外框拉大影响 flex 布局 */
    return (
      <span className={cls} aria-hidden style={boxStyle}>
        <span
          style={{
            display: "block",
            width: size * 0.72,
            height: size * 0.72,
            margin: "auto",
            marginTop: (size - size * 0.72) / 2,
            backgroundColor: color,
            transform: "rotate(45deg)",
            transformOrigin: "center",
          }}
        />
      </span>
    );
  }

  const svgProps = {
    className: cls,
    "aria-hidden": true as const,
    width: size,
    height: size,
    viewBox: "0 0 10 10",
    style: boxStyle,
  };
  if (effective === "triangle") {
    return (
      <svg {...svgProps}>
        <polygon points="5,1 9.2,9 0.8,9" fill={color} />
      </svg>
    );
  }
  if (effective === "star") {
    return (
      <svg {...svgProps}>
        <polygon
          points="5,0.6 6.1,3.8 9.5,3.8 6.8,5.9 7.8,9.4 5,7.2 2.2,9.4 3.2,5.9 0.5,3.8 3.9,3.8"
          fill={color}
        />
      </svg>
    );
  }
  if (effective === "cross") {
    return (
      <svg {...svgProps}>
        <line
          x1="2"
          y1="2"
          x2="8"
          y2="8"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <line
          x1="8"
          y1="2"
          x2="2"
          y2="8"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  /** check */
  return (
    <svg {...svgProps}>
      <polyline
        points="1.6,5.4 4.2,8 8.6,2.6"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
