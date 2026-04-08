import { lazy, Suspense } from "react";
import { noteBodyToHtml } from "./plainHtml";
import type { NoteCardTiptapProps } from "./NoteCardTiptapCore";

export type { NoteCardTiptapProps };

const NoteCardTiptapCore = lazy(() =>
  import("./NoteCardTiptapCore").then((m) => ({
    default: m.NoteCardTiptapCore,
  }))
);

/**
 * 与 CardRowInner 测量 `.ProseMirror` 兼容；chunk 加载前即可显示正文 HTML，利于 LCP。
 */
function NoteCardTiptapFallback({
  id,
  value,
  canEdit,
  ariaLabel = "笔记正文",
}: NoteCardTiptapProps) {
  const html = noteBodyToHtml(value);
  return (
    <div
      className={
        canEdit
          ? "card__text-editor"
          : "card__text-editor card__text-editor--readonly"
      }
    >
      <div
        id={id}
        className="ProseMirror card__text"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-busy="true"
        {...(canEdit ? { role: "textbox" as const } : {})}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function NoteCardTiptap(props: NoteCardTiptapProps) {
  return (
    <Suspense fallback={<NoteCardTiptapFallback {...props} />}>
      <NoteCardTiptapCore {...props} />
    </Suspense>
  );
}
