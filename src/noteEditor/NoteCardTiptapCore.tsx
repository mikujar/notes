import Highlight from "@tiptap/extension-highlight";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef } from "react";
import { useAppChrome } from "../i18n/useAppChrome";
import { filesFromDataTransfer } from "../filesFromDataTransfer";
import { NOTE_HIGHLIGHT_COLORS } from "./highlightPalette";
import { noteBodyToHtml } from "./plainHtml";

export type NoteCardTiptapProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  canEdit: boolean;
  ariaLabel?: string;
  onPasteFiles?: (files: File[]) => void;
  /** 是否显示选区荧光笔气泡菜单；合集列表内为 false，仅笔记详情为 true */
  highlightBubble?: boolean;
};

/** TipTap 实现层；界面请用 NoteCardTiptap。 */
export function NoteCardTiptapCore({
  id,
  value,
  onChange,
  canEdit,
  ariaLabel: ariaLabelProp,
  onPasteFiles,
  highlightBubble = false,
}: NoteCardTiptapProps) {
  const c = useAppChrome();
  const ariaLabel = ariaLabelProp ?? c.uiNoteBodyAria;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        link: {
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          /** 仅显式 `http://` / `https://` 才自动成链，避免 `app.py` 等带点文件名被误识别 */
          shouldAutoLink: (url) => /^https?:\/\//i.test(url.trim()),
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        },
      }),
      Highlight.configure({ multicolor: true }),
    ],
    []
  );

  const editor = useEditor({
    extensions,
    content: noteBodyToHtml(value),
    editable: canEdit,
    editorProps: {
      attributes: {
        id,
        class: "card__text",
        spellcheck: "false",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        ...(canEdit ? { role: "textbox" as const } : {}),
      },
      handlePaste(_view, event) {
        const fn = onPasteFilesRef.current;
        if (!fn) return false;
        const files = filesFromDataTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        fn(files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(ed.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit);
  }, [canEdit, editor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const next = noteBodyToHtml(value);
    if (editor.getHTML() === next) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) {
    return (
      <div
        id={id}
        className="card__text card__text--readonly"
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <div
      className={
        canEdit
          ? "card__text-editor"
          : "card__text-editor card__text-editor--readonly"
      }
    >
      {canEdit && highlightBubble ? (
        <BubbleMenu
          editor={editor}
          pluginKey={`noteHighlightBubble-${id}`}
          appendTo={() => document.body}
          shouldShow={({ editor: ed }) =>
            ed.isEditable && !ed.state.selection.empty
          }
          className="card-highlight-bubble"
          options={{
            placement: "top",
            offset: 4,
            flip: true,
            shift: { padding: 8 },
          }}
        >
          {NOTE_HIGHLIGHT_COLORS.map((sw) => {
            const active = editor.isActive("highlight", { color: sw.color });
            return (
              <button
                key={sw.id}
                type="button"
                className={
                  "card-highlight-bubble__btn" +
                  (active ? " card-highlight-bubble__btn--active" : "")
                }
                title={sw.label}
                aria-label={c.uiHighlightAria(sw.label)}
                aria-pressed={active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (active) {
                    editor.chain().focus().unsetHighlight().run();
                  } else {
                    editor.chain().focus().setHighlight({ color: sw.color }).run();
                  }
                }}
              >
                <span
                  className="card-highlight-bubble__bar"
                  style={{ backgroundColor: sw.color }}
                />
                <span className="card-highlight-bubble__letter">A</span>
                {active ? (
                  <span className="card-highlight-bubble__check" aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
