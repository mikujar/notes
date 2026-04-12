import {
  Children,
  cloneElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/** 首帧未量到高度前：轮询占位，避免单列撑满 */
function assignmentRoundRobin(length: number, columnCount: number): number[] {
  return Array.from({ length }, (_, i) => i % columnCount);
}

/**
 * 贪心最短列：按 children 顺序，每张卡放入当前累计高度最小的列（并列取最左列）。
 */
function packShortestColumn(heights: number[], columnCount: number): number[] {
  const n = columnCount;
  const colHeights = new Array(n).fill(0);
  const assignment: number[] = new Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    let j = 0;
    for (let k = 1; k < n; k++) {
      if (colHeights[k] < colHeights[j]) j = k;
    }
    assignment[i] = j;
    colHeights[j] += h;
  }
  return assignment;
}

function assignmentEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 时间线多列：瀑布流 — 每张卡接在当前总高度最小的列后面（需测量高度）。
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [packAssignment, setPackAssignment] = useState<number[] | null>(null);
  const rafRef = useRef(0);

  const items = Children.toArray(children);
  const m = items.length;
  /** 避免把 `children` 引用放进 effect 依赖导致每帧重绑 ResizeObserver */
  const childSig = items
    .map((c, i) => (isValidElement(c) ? String(c.key ?? i) : `_${i}`))
    .join("|");

  const tagged = items.map((child, i) =>
    isValidElement(child)
      ? cloneElement(child as ReactElement<{ "data-masonry-slot"?: number }>, {
          "data-masonry-slot": i,
        })
      : child
  );

  const assignment =
    packAssignment && packAssignment.length === m
      ? packAssignment
      : assignmentRoundRobin(m, n);

  const columns: ReactNode[][] = Array.from({ length: n }, () => []);
  tagged.forEach((node, i) => {
    columns[assignment[i]].push(node);
  });

  useLayoutEffect(() => {
    if (!enabled || m === 0) {
      setPackAssignment(null);
      return;
    }

    const root = containerRef.current;
    if (!root) return;

    const measureAndPack = () => {
      const heights: number[] = [];
      for (let i = 0; i < m; i++) {
        const el = root.querySelector(
          `[data-masonry-slot="${i}"]`
        ) as HTMLElement | null;
        if (!el) {
          heights.push(0);
          continue;
        }
        /* offsetHeight 偶发为 0（尚未完成排版）；与 getBoundingClientRect 取较大值 */
        const h = Math.max(
          el.offsetHeight,
          el.getBoundingClientRect().height
        );
        heights.push(h);
      }
      /**
       * 高度全为 0 时「最短列」始终为第 0 列，会把所有卡叠进第一列、右侧空一列。
       * 尚未量到有效高度时用轮询分列；有任一高度后再按最短列打包。
       */
      const hasAnySize = heights.some((h) => h > 0.5);
      const next = hasAnySize
        ? packShortestColumn(heights, n)
        : assignmentRoundRobin(m, n);

      setPackAssignment((prev) => {
        if (prev && prev.length === next.length && assignmentEqual(prev, next)) {
          return prev;
        }
        return next;
      });
    };

    measureAndPack();
    /* 再等一帧，避免首帧布局未完成导致全 0 误判 */
    const id0 = requestAnimationFrame(() => {
      measureAndPack();
    });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = 0;
              measureAndPack();
            });
          })
        : null;
    ro?.observe(root);

    return () => {
      cancelAnimationFrame(id0);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      ro?.disconnect();
    };
  }, [enabled, m, n, childSig]);

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

  const baseClass = className ?? "cards";

  return (
    <div
      ref={containerRef}
      className="masonry-shortest-pack"
      data-masonry-pack="on"
      data-masonry-cols={String(n)}
      aria-label={ariaLabel}
      role={ariaLabel ? "region" : undefined}
    >
      {columns.map((colChildren, colIndex) => (
        <ul key={colIndex} className={baseClass + " cards--masonry-column"}>
          {colChildren}
        </ul>
      ))}
    </div>
  );
}
