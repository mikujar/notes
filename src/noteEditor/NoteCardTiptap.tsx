import { useAppChrome } from "../i18n/useAppChrome";
import {
  NoteCardTiptapCore,
  type NoteCardTiptapProps,
} from "./NoteCardTiptapCore";

export type { NoteCardTiptapProps };

/** 直接挂载 TipTap，避免懒加载时静态占位再替换导致的抖闪；首包会包含编辑器依赖。 */
export function NoteCardTiptap(props: NoteCardTiptapProps) {
  const c = useAppChrome();
  const ariaLabel = props.ariaLabel ?? c.uiNoteBodyAria;
  return <NoteCardTiptapCore {...props} ariaLabel={ariaLabel} />;
}

