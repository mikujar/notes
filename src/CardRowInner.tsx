import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DESKTOP_TIMELINE_GALLERY_STACK_PAPER_EXIT_HEIGHT_PX,
  DESKTOP_TIMELINE_GALLERY_STACK_PAPER_MIN_HEIGHT_PX,
  MOBILE_CHROME_MEDIA,
  TABLET_WIDE_TOUCH_MEDIA,
} from "./appkit/appConstants";

/** 与 App `narrowUi`、卡片详情一致：窄屏或大屏触控平板时多为上下布局 */

type CardRowInnerProps = {
  hasGallery: boolean;
  className: string;
  children: ReactNode;
  /**
   * 时间线列数。多列瀑布时固定上下叠放；1 列时（含窄屏≤900px、大屏触控平板）与桌面相同按纸张高度在左右/上下间自动切换。
   */
  timelineColumnCount?: number;
};

function computeGalleryStack(
  hasGallery: boolean,
  paper: HTMLElement | null,
  timelineColumnCount: number | undefined,
  wasStacked: boolean
): boolean {
  if (!hasGallery) return false;
  const mqMobile = window.matchMedia(MOBILE_CHROME_MEDIA);
  const mqTablet = window.matchMedia(TABLET_WIDE_TOUCH_MEDIA);
  const mqPhoneNarrow = window.matchMedia("(max-width: 900px)");
  const mobileChrome = mqMobile.matches;
  const tabletWide = mqTablet.matches;
  const tabletSingleCol =
    tabletWide && timelineColumnCount === 1;
  /** 视口 ≤900px 且时间线 1 列：与平板 1 列、桌面相同，按高度自动切换左右/上下 */
  const phoneNarrowOneCol =
    mqPhoneNarrow.matches && timelineColumnCount === 1;

  /**
   * 手机壳内仍「固定上下」：窄屏多列、或平板多列（卡宽不足并排）
   * 不含：窄屏 1 列、平板 1 列（见下方高度分支）
   */
  if (
    mobileChrome &&
    !tabletSingleCol &&
    !phoneNarrowOneCol
  ) {
    return true;
  }

  /** 桌面、大屏触控 1 列、窄屏 1 列：按纸张高度滞回 */
  const h = paper?.offsetHeight ?? 0;
  if (h === 0) {
    return wasStacked;
  }
  if (wasStacked) {
    return h >= DESKTOP_TIMELINE_GALLERY_STACK_PAPER_EXIT_HEIGHT_PX;
  }
  return h >= DESKTOP_TIMELINE_GALLERY_STACK_PAPER_MIN_HEIGHT_PX;
}

/**
 * 时间线/垃圾桶卡片内层：多列有附件时固定上下布局；
 * 桌面、平板 1 列、窄屏（≤900px）1 列时按正文高度在左右/上下间自动切换（同一套阈值与滞回）。
 */
export function CardRowInner({
  hasGallery,
  className,
  children,
  timelineColumnCount,
}: CardRowInnerProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [stackGallery, setStackGallery] = useState(false);
  const roRafRef = useRef(0);

  /* useLayoutEffect：在绘制前同步；桌面用 ResizeObserver 跟正文高度（滞回 + rAF 防抖，减轻闪屏） */
  useLayoutEffect(() => {
    if (!hasGallery) {
      setStackGallery(false);
      return;
    }

    const mqMobile = window.matchMedia(MOBILE_CHROME_MEDIA);
    const mqTablet = window.matchMedia(TABLET_WIDE_TOUCH_MEDIA);
    const mqPhoneNarrow = window.matchMedia("(max-width: 900px)");

    const getPaper = () =>
      innerRef.current?.querySelector(".card__paper") as HTMLElement | null;

    const apply = () => {
      setStackGallery((prev) => {
        const next = computeGalleryStack(
          hasGallery,
          getPaper(),
          timelineColumnCount,
          prev
        );
        return next === prev ? prev : next;
      });
    };

    /** 视口 / 媒体变化：立即算 */
    const syncImmediate = () => {
      if (roRafRef.current) {
        cancelAnimationFrame(roRafRef.current);
        roRafRef.current = 0;
      }
      apply();
    };

    /** 尺寸抖动：合并到下一帧，减少同布局周期内多次翻转 */
    const syncFromResize = () => {
      if (roRafRef.current) {
        cancelAnimationFrame(roRafRef.current);
      }
      roRafRef.current = requestAnimationFrame(() => {
        roRafRef.current = 0;
        apply();
      });
    };

    apply();
    /* 再等两帧：TipTap/图片布局后纸张高度才稳定，合并进同一轮重算减轻闪屏 */
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        id2 = 0;
        apply();
      });
    });

    mqMobile.addEventListener("change", syncImmediate);
    mqTablet.addEventListener("change", syncImmediate);
    mqPhoneNarrow.addEventListener("change", syncImmediate);

    const paper = getPaper();
    const ro =
      typeof ResizeObserver !== "undefined" && paper
        ? new ResizeObserver(syncFromResize)
        : null;
    if (ro && paper) ro.observe(paper);

    const inner = innerRef.current;
    const roInner =
      typeof ResizeObserver !== "undefined" && inner
        ? new ResizeObserver(syncFromResize)
        : null;
    if (roInner && inner) roInner.observe(inner);

    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
      if (roRafRef.current) {
        cancelAnimationFrame(roRafRef.current);
        roRafRef.current = 0;
      }
      mqMobile.removeEventListener("change", syncImmediate);
      mqTablet.removeEventListener("change", syncImmediate);
      mqPhoneNarrow.removeEventListener("change", syncImmediate);
      ro?.disconnect();
      roInner?.disconnect();
    };
  }, [hasGallery, timelineColumnCount]);

  const cls =
    className +
    (hasGallery && stackGallery
      ? " card__inner--mobile-gallery-stack"
      : "");

  return (
    <div ref={innerRef} className={cls}>
      {children}
    </div>
  );
}
