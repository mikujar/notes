import { Children, type ReactNode } from "react";

/** 按顺序轮询分列：第 i 张进第 (i % n) 列，列内自上而下紧挨，不留网格那种行间空白 */
function splitRoundRobin(children: ReactNode, columnCount: number): ReactNode[][] {
  const items = Children.toArray(children);
  const cols: ReactNode[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((child, i) => {
    cols[i % columnCount].push(child);
  });
  return cols;
}

/**
 * 时间线多列：顺序轮询分列（非最短列），各列独立堆叠，中间不因同行等高而留空。
 */
export function MasonryShortestColumns({
  columnCount,
  className,
  ariaLabel,
  children,
}: {
  columnCount: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const enabled = columnCount > 1;
  const n = enabled ? columnCount : 1;

  if (!enabled) {
    return (
      <ul
        className={className ?? "cards"}
        data-masonry-pack="off"
        aria-label={ariaLabel}
      >
        {children}
      </ul>
    );
  }

  const columns = splitRoundRobin(children, n);
  const baseClass = className ?? "cards";

  return (
    <div
      className="masonry-shortest-pack"
      data-masonry-pack="on"
      data-masonry-cols={String(n)}
      aria-label={ariaLabel}
      role={ariaLabel ? "region" : undefined}
    >
      {columns.map((colChildren, colIndex) => (
        <ul
          key={colIndex}
          className={baseClass + " cards--masonry-column"}
        >
          {colChildren}
        </ul>
      ))}
    </div>
  );
}
