import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
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
  /** 在编辑器上方显示固定格式工具栏 */
  showToolbar?: boolean;
  /**
   * 时间线卡片：视觉上把 H1–H6 当作正文（字号/字重与段落一致），DOM 仍为标题便于详情页与导出。
   * 卡片详情 / 全页编辑不传此项，保留标题样式。
   */
  timelineBodyHeadings?: boolean;
};

/* ——— 工具栏子组件 ——— */

function TBtn({
  active,
  title,
  onAction,
  children,
}: {
  active?: boolean;
  title: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={"note-toolbar__btn" + (active ? " note-toolbar__btn--active" : "")}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onAction}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="note-toolbar__sep" />;
}

function NoteEditorToolbar({ editor }: { editor: Editor }) {
  const headingLevel = ([1, 2, 3] as const).find((l) =>
    editor.isActive("heading", { level: l })
  );

  return (
    <div className="note-toolbar" aria-label="格式工具栏">
      {/* 撤销 / 重做 */}
      <TBtn title="撤销 (Ctrl+Z)" onAction={() => editor.chain().focus().undo().run()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 6.5h7a3 3 0 0 1 0 6H5" />
          <polyline points="2,4 2,7 5,7" />
        </svg>
      </TBtn>
      <TBtn title="重做 (Ctrl+Y)" onAction={() => editor.chain().focus().redo().run()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 6.5H5a3 3 0 0 0 0 6h4" />
          <polyline points="12,4 12,7 9,7" />
        </svg>
      </TBtn>

      <Sep />

      {/* 标题 */}
      {([1, 2, 3] as const).map((level) => (
        <TBtn
          key={level}
          active={headingLevel === level}
          title={`H${level}`}
          onAction={() =>
            editor.chain().focus().toggleHeading({ level }).run()
          }
        >
          <span style={{ fontWeight: 700, fontSize: 11 }}>H{level}</span>
        </TBtn>
      ))}

      <Sep />

      {/* 无序 / 有序列表 / 引用 / 分割线 */}
      <TBtn
        active={editor.isActive("bulletList")}
        title="无序列表"
        onAction={() => editor.chain().focus().toggleBulletList().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <circle cx="2.5" cy="3.5" r="1" /><circle cx="2.5" cy="7" r="1" /><circle cx="2.5" cy="10.5" r="1" />
          <rect x="5" y="2.75" width="7" height="1.5" rx=".5" />
          <rect x="5" y="6.25" width="7" height="1.5" rx=".5" />
          <rect x="5" y="9.75" width="7" height="1.5" rx=".5" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("orderedList")}
        title="有序列表"
        onAction={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <text x="1" y="5" fontSize="4.5" fontFamily="monospace" fontWeight="bold">1.</text>
          <text x="1" y="8.5" fontSize="4.5" fontFamily="monospace" fontWeight="bold">2.</text>
          <text x="1" y="12" fontSize="4.5" fontFamily="monospace" fontWeight="bold">3.</text>
          <rect x="6" y="2.75" width="6" height="1.5" rx=".5" />
          <rect x="6" y="6.25" width="6" height="1.5" rx=".5" />
          <rect x="6" y="9.75" width="6" height="1.5" rx=".5" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("blockquote")}
        title="引用"
        onAction={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h.5a.5.5 0 0 1 0 1h-.5a.5.5 0 0 0-.5.5v1h1a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5Zm7 0A1.5 1.5 0 0 1 10.5 2h.5a.5.5 0 0 1 0 1h-.5a.5.5 0 0 0-.5.5v1h1a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3.5Z" />
        </svg>
      </TBtn>

      <Sep />

      {/* 行内样式 */}
      <TBtn
        active={editor.isActive("bold")}
        title="粗体 (Ctrl+B)"
        onAction={() => editor.chain().focus().toggleBold().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <path d="M3.5 2h3.75a3 3 0 0 1 2.1 5.1A3.25 3.25 0 0 1 7.5 13H3.5a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5ZM4 6.5h3.25a2 2 0 0 0 0-4H4v4Zm0 1v4h3.5a2.25 2.25 0 0 0 0-4.5H4Z" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("italic")}
        title="斜体 (Ctrl+I)"
        onAction={() => editor.chain().focus().toggleItalic().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <path d="M5 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1H7.72L5.72 11H7.5a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1h1.78l2-8H4.5a.5.5 0 0 1-.5-.5Z" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("strike")}
        title="删除线 (Ctrl+Shift+S)"
        onAction={() => editor.chain().focus().toggleStrike().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
          <line x1="2" y1="7" x2="12" y2="7" />
          <path d="M4.5 4.5c0-1.1 1.1-2 2.5-2s2.5.9 2.5 2" />
          <path d="M4.5 10c0 1.1 1.1 2 2.5 2s2.5-.9 2.5-2" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("code")}
        title="行内代码 (Ctrl+E)"
        onAction={() => editor.chain().focus().toggleCode().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="4.5,3.5 1.5,7 4.5,10.5" />
          <polyline points="9.5,3.5 12.5,7 9.5,10.5" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("underline")}
        title="下划线 (Ctrl+U)"
        onAction={() => editor.chain().focus().toggleUnderline().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <path d="M3 2.5a.5.5 0 0 1 1 0v4a3 3 0 0 0 6 0v-4a.5.5 0 0 1 1 0v4a4 4 0 0 1-8 0v-4ZM2 12h10v1H2z" />
        </svg>
      </TBtn>

      {/* 荧光笔 */}
      {NOTE_HIGHLIGHT_COLORS.map((sw) => {
        const active = editor.isActive("highlight", { color: sw.color });
        return (
          <button
            key={sw.id}
            type="button"
            className={"note-toolbar__color" + (active ? " note-toolbar__color--active" : "")}
            title={`荧光笔：${sw.label}`}
            aria-label={`荧光笔 ${sw.label}`}
            aria-pressed={active}
            style={{ "--hl-color": sw.color } as React.CSSProperties}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              active
                ? editor.chain().focus().unsetHighlight().run()
                : editor.chain().focus().setHighlight({ color: sw.color }).run()
            }
          />
        );
      })}

      {/* 链接 */}
      <TBtn
        active={editor.isActive("link")}
        title="插入链接"
        onAction={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
          } else {
            const url = window.prompt("链接地址");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5.5 8.5a3.5 3.5 0 0 0 4.95 0l1.77-1.77a3.5 3.5 0 0 0-4.95-4.95L6 3" />
          <path d="M8.5 5.5a3.5 3.5 0 0 0-4.95 0L1.78 7.27a3.5 3.5 0 0 0 4.95 4.95L8 11" />
        </svg>
      </TBtn>

      <Sep />

      {/* 上标 / 下标 */}
      <TBtn
        active={editor.isActive("superscript")}
        title="上标"
        onAction={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <text x="1" y="11" fontSize="8" fontFamily="serif" fontStyle="italic">x</text>
          <text x="8" y="6" fontSize="5" fontFamily="serif">2</text>
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("subscript")}
        title="下标"
        onAction={() => editor.chain().focus().toggleSubscript().run()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
          <text x="1" y="9" fontSize="8" fontFamily="serif" fontStyle="italic">x</text>
          <text x="8" y="13" fontSize="5" fontFamily="serif">2</text>
        </svg>
      </TBtn>

      <Sep />

      {/* 对齐 */}
      {(["left", "center", "right", "justify"] as const).map((align) => {
        const icons: Record<string, React.ReactNode> = {
          left: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="12" height="1.5" rx=".5" />
              <rect x="1" y="5.5" width="8" height="1.5" rx=".5" />
              <rect x="1" y="8.5" width="12" height="1.5" rx=".5" />
              <rect x="1" y="11.5" width="6" height="1.5" rx=".5" />
            </svg>
          ),
          center: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="12" height="1.5" rx=".5" />
              <rect x="3" y="5.5" width="8" height="1.5" rx=".5" />
              <rect x="1" y="8.5" width="12" height="1.5" rx=".5" />
              <rect x="4" y="11.5" width="6" height="1.5" rx=".5" />
            </svg>
          ),
          right: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="12" height="1.5" rx=".5" />
              <rect x="5" y="5.5" width="8" height="1.5" rx=".5" />
              <rect x="1" y="8.5" width="12" height="1.5" rx=".5" />
              <rect x="7" y="11.5" width="6" height="1.5" rx=".5" />
            </svg>
          ),
          justify: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="12" height="1.5" rx=".5" />
              <rect x="1" y="5.5" width="12" height="1.5" rx=".5" />
              <rect x="1" y="8.5" width="12" height="1.5" rx=".5" />
              <rect x="1" y="11.5" width="12" height="1.5" rx=".5" />
            </svg>
          ),
        };
        const labels: Record<string, string> = {
          left: "左对齐",
          center: "居中",
          right: "右对齐",
          justify: "两端对齐",
        };
        return (
          <TBtn
            key={align}
            active={editor.isActive({ textAlign: align })}
            title={labels[align]}
            onAction={() => editor.chain().focus().setTextAlign(align).run()}
          >
            {icons[align]}
          </TBtn>
        );
      })}
    </div>
  );
}

/* ——— 主编辑器组件 ——— */

/** TipTap 实现层；界面请用 NoteCardTiptap。 */
export function NoteCardTiptapCore({
  id,
  value,
  onChange,
  canEdit,
  ariaLabel: ariaLabelProp,
  onPasteFiles,
  showToolbar = false,
  timelineBodyHeadings = false,
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
        codeBlock: false,
        link: {
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          shouldAutoLink: (url) => /^https?:\/\//i.test(url.trim()),
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        },
      }),
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Superscript,
      Subscript,
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
        (canEdit
          ? "card__text-editor"
          : "card__text-editor card__text-editor--readonly") +
        (timelineBodyHeadings ? " card__text-editor--timeline-body-headings" : "")
      }
    >
      {canEdit && showToolbar ? <NoteEditorToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
