import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const MOBILE_MQ = "(max-width: 900px)";

/** 与 .card 横格 --note-line-height 一致 */
const NOTE_LINE_PX = 30;
/** 正文 ProseMirror min-height 为 3 行；超过约第 4 行起视为长笔记 */
const SHORT_BODY_MAX_SCROLL_PX =
  3 * NOTE_LINE_PX + NOTE_LINE_PX * 0.92;
/** 高于此（分栏宽度下）改为上下叠放 */
const STACK_GALLERY_UPPER_PX = SHORT_BODY_MAX_SCROLL_PX + 10;
/**
 * 叠放态下低于此再恢复分栏。须明显小于 UPPER，且解叠时忽略极小 h（布局中间帧 scrollHeight 常为 0，会误触解叠→下一帧又叠上→狂闪）。
 */
const STACK_GALLERY_LOWER_PX = 2.5 * NOTE_LINE_PX;
/** 低于此高度的 scrollHeight 视为未稳定布局，不改变叠放状态 */
const STACK_GALLERY_MIN_TRUST_PX = NOTE_LINE_PX;

type CardRowInnerProps = {
  hasGallery: boolean;
  /** 正文变化时重新测量（Tiptap 高度变化由 ResizeObserver 覆盖） */
  textRev: string;
  className: string;
  children: ReactNode;
};

/**
 * 时间线/垃圾桶卡片内层：有附件时小屏默认仍左右分栏；正文变长后改为上下布局。
 */
export function CardRowInner({
  hasGallery,
  textRev,
  className,
  children,
}: CardRowInnerProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [stackGallery, setStackGallery] = useState(false);

  useEffect(() => {
    if (!hasGallery) {
      setStackGallery(false);
      return;
    }
    const root = innerRef.current;
    if (!root) return;

    const mq = window.matchMedia(MOBILE_MQ);

    let raf = 0;
    const measure = () => {
      if (!mq.matches) {
        setStackGallery(false);
        return;
      }
      const pm = root.querySelector(
        ".ProseMirror"
      ) as HTMLElement | null;
      if (!pm) return;

      const h = pm.scrollHeight;
      setStackGallery((prev) => {
        if (h < STACK_GALLERY_MIN_TRUST_PX) return prev;

        if (!prev) {
          return h > STACK_GALLERY_UPPER_PX;
        }
        if (h < STACK_GALLERY_LOWER_PX) return false;
        return prev;
      });
    };

    const scheduleMeasure = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };

    scheduleMeasure();

    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(root);
    const pm0 = root.querySelector(
      ".ProseMirror"
    ) as HTMLElement | null;
    if (pm0) ro.observe(pm0);

    mq.addEventListener("change", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [hasGallery, textRev]);

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
