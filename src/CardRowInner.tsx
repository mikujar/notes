import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  MOBILE_CHROME_MEDIA,
  TABLET_WIDE_TOUCH_MEDIA,
} from "./appkit/appConstants";

/** 与 App `narrowUi`、卡片详情一致：窄屏或大屏触控平板时多为上下布局 */

type CardRowInnerProps = {
  hasGallery: boolean;
  className: string;
  children: ReactNode;
  /**
   * 时间线列数。多列瀑布时固定上下叠放；1 列时固定左右分栏（附件在右）。
   * 不再按纸张高度自动切上下：左右与上下切换会改变纸宽 → 高度剧变 → 在阈值附近来回振荡闪屏。
   */
  timelineColumnCount?: number;
};

/**
 * 仅由视口 + 列数决定是否上下叠放；不用 offsetHeight，避免布局↔测量反馈循环。
 */
function computeGalleryStack(
  hasGallery: boolean,
  timelineColumnCount: number | undefined
): boolean {
  if (!hasGallery) return false;
  const mqMobile = window.matchMedia(MOBILE_CHROME_MEDIA);
  const mqTablet = window.matchMedia(TABLET_WIDE_TOUCH_MEDIA);
  const mqPhoneNarrow = window.matchMedia("(max-width: 900px)");
  const mobileChrome = mqMobile.matches;
  const tabletWide = mqTablet.matches;
  const tabletSingleCol = tabletWide && timelineColumnCount === 1;
  const phoneNarrowOneCol =
    mqPhoneNarrow.matches && timelineColumnCount === 1;

  /**
   * 手机壳内仍「固定上下」：窄屏多列、或平板多列（卡宽不足并排）
   * 窄屏/平板 1 列：保持左右分栏（与桌面一致），避免高度驱动切换闪屏
   */
  if (mobileChrome && !tabletSingleCol && !phoneNarrowOneCol) {
    return true;
  }
  return false;
}

/**
 * 时间线/垃圾桶卡片内层：多列有附件时固定上下布局；
 * 单列表头有附件时为左右分栏（不再按正文高度自动切换上下）。
 */
export function CardRowInner({
  hasGallery,
  className,
  children,
  timelineColumnCount,
}: CardRowInnerProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [stackGallery, setStackGallery] = useState(false);

  useLayoutEffect(() => {
    if (!hasGallery) {
      setStackGallery(false);
      return;
    }

    const mqMobile = window.matchMedia(MOBILE_CHROME_MEDIA);
    const mqTablet = window.matchMedia(TABLET_WIDE_TOUCH_MEDIA);
    const mqPhoneNarrow = window.matchMedia("(max-width: 900px)");

    const apply = () => {
      setStackGallery(computeGalleryStack(hasGallery, timelineColumnCount));
    };

    apply();

    mqMobile.addEventListener("change", apply);
    mqTablet.addEventListener("change", apply);
    mqPhoneNarrow.addEventListener("change", apply);

    return () => {
      mqMobile.removeEventListener("change", apply);
      mqTablet.removeEventListener("change", apply);
      mqPhoneNarrow.removeEventListener("change", apply);
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
