import {
  Children,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
function escapeAttrSelector(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function roundRobinBuckets(
  nItems: number,
  columnCount: number
): number[][] {
  const cols: number[][] = Array.from({ length: columnCount }, () => []);
  for (let i = 0; i < nItems; i++) {
    cols[i % columnCount].push(i);
  }
  return cols;
}

function pickShortestColumnIndex(
  colHeights: number[],
  cols: number[][],
  columnCount: number,
  itemIndex: number
): number {
  let minH = Infinity;
  for (let c = 0; c < columnCount; c++) {
    if (colHeights[c] < minH) minH = colHeights[c];
  }
  const atMinH: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    if (colHeights[c] <= minH + 1e-6) atMinH.push(c);
  }
  let minCards = Infinity;
  for (const c of atMinH) {
    if (cols[c].length < minCards) minCards = cols[c].length;
  }
  const candidates = atMinH.filter((c) => cols[c].length === minCards);
  if (candidates.length === 1) return candidates[0];

  const totalPlaced = cols.reduce((s, col) => s + col.length, 0);
  /* 前几格按序铺一行，避免首卡全挤最右/最左 */
  if (totalPlaced < columnCount) {
    return candidates.includes(itemIndex % columnCount)
      ? itemIndex % columnCount
      : candidates[0];
  }
  /*
   * 累计高度与卡数仍并列时：用「笔记序号」在候选列间轮转。
   * 若用 Math.max 固定偏右，在高度被估成相同（如第二张超长文尚未量准）时，
   * 第三张会错误地继续进右列，出现「左 1、右 23」而应为「左 13、右 2」。
   */
  const sorted = [...candidates].sort((a, b) => a - b);
  return sorted[itemIndex % sorted.length];
}

function packShortestColumn(
  orderedKeys: string[],
  heights: Record<string, number>,
  columnCount: number,
  defaultHeight: number
): number[][] {
  const colHeights = Array(columnCount).fill(0) as number[];
  const cols: number[][] = Array.from({ length: columnCount }, () => []);
  for (let i = 0; i < orderedKeys.length; i++) {
    const k = orderedKeys[i];
    const h = heights[k] ?? defaultHeight;
    const best = pickShortestColumnIndex(
      colHeights,
      cols,
      columnCount,
      i
    );
    cols[best].push(i);
    colHeights[best] += h;
  }
  return cols;
}

function bucketsEqual(a: number[][], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j] !== b[i][j]) return false;
    }
  }
  return true;
}

const DEFAULT_CARD_H = 280;

/**
 * 读卡片在列里的**实际占位高度**（与布局一致）。
 *
 * 勿用 `scrollHeight`：正文区可滚时它往往是全文高度，会远大于 `li.card` 的可见高度，
 * 瀑布流会误以为该列已极高，后续笔记全挤到另一列、旁列大片留白。
 *
 * `getBoundingClientRect` 在首帧/图为 0 时仍是 0，与 offsetHeight 取 max 后仍过小再回退默认。
 */
function readCardHeight(el: HTMLElement | null): number {
  if (!el) return DEFAULT_CARD_H;
  const br = el.getBoundingClientRect().height;
  const oh = el.offsetHeight;
  const h = Math.max(
    Number.isFinite(br) ? br : 0,
    Number.isFinite(oh) ? oh : 0
  );
  if (!Number.isFinite(h) || h < 8) return DEFAULT_CARD_H;
  return Math.ceil(h);
}

/** 图加载/布局抖动时多跑几步直到分桶与高度指纹都稳定 */
const PACK_SETTLE_MAX_PASSES = 18;

/**
 * 瀑布流：按时间线顺序将每张卡放入「当前累计高度最短」的一列（Pinterest 式接龙）。
 * 依赖子节点根元素 `li.card` 上的 `data-masonry-key` 以测量高度。
 */
export function MasonryShortestColumns({
  columnCount,
  className,
  ariaLabel,
  children,
}: {
  /** `1` 为单列列表；`2`–`6` 为瀑布流最短列接龙 */
  columnCount: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  /** 启用瀑布流时包在容器上；单列时为 ul 的 aria-label */
  ariaLabel?: string;
  children: ReactNode;
}) {
  const enabled = columnCount > 1;
  const packColumns = (enabled ? columnCount : 2) as 2 | 3 | 4 | 5 | 6;
  const childList = useMemo(
    () => Children.toArray(children) as ReactElement[],
    [children]
  );

  const orderedKeys = useMemo(
    () =>
      childList.map((c, i) => {
        if (c.key != null && c.key !== "") return String(c.key);
        return `__idx_${i}`;
      }),
    [childList]
  );

  const keysSig = orderedKeys.join("\u0001");

  const [buckets, setBuckets] = useState<number[][]>(() =>
    roundRobinBuckets(childList.length, packColumns)
  );
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;

  const packRef = useRef<HTMLDivElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const roRafRef = useRef(0);
  const lastHeightFpRef = useRef<string | null>(null);
  /** 供 settle 链内同步比较，避免 setState 后 bucketsRef 尚未更新导致重复改桶 */
  const lastPackedRef = useRef<number[][] | null>(null);
  const loadCleanRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    setBuckets(roundRobinBuckets(childList.length, packColumns));
  }, [enabled, keysSig, childList.length, packColumns]);

  useLayoutEffect(() => {
    if (!enabled || childList.length === 0) return;
    const root = packRef.current;
    if (!root) return;

    lastHeightFpRef.current = null;
    lastPackedRef.current = null;

    const schedulePackFromResize = () => {
      cancelAnimationFrame(roRafRef.current);
      roRafRef.current = requestAnimationFrame(() => {
        roRafRef.current = 0;
        runSettleChain(0);
      });
    };

    const runSettleChain = (pass: number) => {
      if (pass > PACK_SETTLE_MAX_PASSES) return;

      const heights: Record<string, number> = {};
      const hparts: string[] = [];
      for (const k of orderedKeys) {
        const el = root.querySelector<HTMLElement>(
          `[data-masonry-key="${escapeAttrSelector(k)}"]`
        );
        const h = readCardHeight(el);
        heights[k] = h;
        hparts.push(`${h.toFixed(1)}`);
      }
      const heightFp = hparts.join("\u0002");

      const next = packShortestColumn(
        orderedKeys,
        heights,
        packColumns,
        DEFAULT_CARD_H
      );

      const prev = lastPackedRef.current ?? bucketsRef.current;
      const packChanged = !bucketsEqual(prev, next);
      const heightChanged =
        lastHeightFpRef.current === null || heightFp !== lastHeightFpRef.current;
      lastHeightFpRef.current = heightFp;

      if (packChanged) {
        lastPackedRef.current = next;
        setBuckets(next);
      }

      if ((packChanged || heightChanged) && pass < PACK_SETTLE_MAX_PASSES) {
        requestAnimationFrame(() => runSettleChain(pass + 1));
      }
    };

    runSettleChain(0);

    roRef.current?.disconnect();
    const ro = new ResizeObserver(() => {
      schedulePackFromResize();
    });
    roRef.current = ro;
    orderedKeys.forEach((k) => {
      const el = root.querySelector<HTMLElement>(
        `[data-masonry-key="${escapeAttrSelector(k)}"]`
      );
      if (el) ro.observe(el);
    });

    const onLoadCapture = () => schedulePackFromResize();
    root.addEventListener("load", onLoadCapture, true);

    loadCleanRef.current = () => {
      root.removeEventListener("load", onLoadCapture, true);
    };

    return () => {
      cancelAnimationFrame(roRafRef.current);
      roRafRef.current = 0;
      ro.disconnect();
      roRef.current = null;
      loadCleanRef.current?.();
      loadCleanRef.current = null;
    };
  }, [enabled, keysSig, packColumns, childList.length, orderedKeys]);

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

  return (
    <div
      ref={packRef}
      className="masonry-shortest-pack"
      data-masonry-pack="on"
      data-masonry-cols={String(packColumns)}
      aria-label={ariaLabel}
      role={ariaLabel ? "region" : undefined}
    >
      {buckets.map((indices, colIdx) => (
        <ul
          key={colIdx}
          className={(className ?? "cards") + " cards--masonry-column"}
          data-masonry-col={colIdx}
        >
          {indices.map((i) => childList[i])}
        </ul>
      ))}
    </div>
  );
}
