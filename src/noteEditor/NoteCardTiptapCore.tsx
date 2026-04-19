import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useAppChrome } from "../i18n/useAppChrome";
import type { NoteMediaItem } from "../types";
import { filesFromDataTransfer } from "../filesFromDataTransfer";
import { NOTE_HIGHLIGHT_COLORS } from "./highlightPalette";
import {
  NoteBodyAudio,
  NoteBodyImage,
  NoteBodyVideo,
} from "./noteBodyMediaNodes";
import {
  hasNoteMediaDragPayload,
  parseNoteMediaDragPayload,
  type NoteMediaDragPayload,
} from "./noteMediaDragMime";
import { noteBodyToHtml } from "./plainHtml";

/** 上传返回的媒体项 → 插入正文（与附件栏拖放结构一致） */
function editorInsertPayloadFromMediaItems(items: NoteMediaItem[]): unknown {
  const chunks: unknown[] = [];
  for (const m of items) {
    if (m.kind === "image") {
      chunks.push({
        type: "image",
        attrs: {
          src: m.url,
          alt: m.name ?? "",
          title: m.name ?? null,
        },
      });
    } else if (m.kind === "video") {
      chunks.push({
        type: "noteBodyVideo",
        attrs: { src: m.url, title: m.name ?? null },
      });
    } else if (m.kind === "audio") {
      chunks.push({
        type: "noteBodyAudio",
        attrs: { src: m.url, title: m.name ?? null },
      });
    } else {
      const label = m.name?.trim() || "文件";
      const href = encodeURI(m.url);
      const safe = (s: string) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      chunks.push(
        `<p><a href="${href}" rel="noopener noreferrer" target="_blank">${safe(label)}</a></p>`
      );
    }
  }
  if (chunks.length === 0) return null;
  return chunks.length === 1 ? chunks[0] : chunks;
}

export type NoteCardTiptapProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  canEdit: boolean;
  ariaLabel?: string;
  /**
   * 粘贴/拖入文件时回调；若同时开启 `insertUploadedImagesAtCursor`，
   * 需返回 `Promise<NoteMediaItem[]>`（与上传结果一致），以便将其中图片插入正文。
   */
  onPasteFiles?: (files: File[]) => void | Promise<NoteMediaItem[]>;
  /**
   * 笔记全页等：图片粘贴/拖入先写入附件，再把返回结果中的图片插入光标/落点。
   * 卡片详情弹层等不传，仅上传附件、不自动插入正文。
   */
  insertUploadedImagesAtCursor?: boolean;
  /** 在编辑器上方显示固定格式工具栏 */
  showToolbar?: boolean;
  /**
   * 时间线卡片：视觉上把 H1–H6 当作正文（字号/字重与段落一致），DOM 仍为标题便于详情页与导出。
   * 卡片详情 / 全页编辑不传此项，保留标题样式。
   */
  timelineBodyHeadings?: boolean;
  /**
   * 合集列表等：正文中不展示内嵌图/音视频（与 `timelineBodyHeadings` 叠加时共用样式；仅列表需要时可单独传）。
   */
  hideEmbeddedMedia?: boolean;
  /**
   * 时间线列表：折叠模式传 3 触发样式类（实际可见两行）。全页/详情不传。
   */
  foldBodyMaxLines?: number;
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
    <div className="note-toolbar-wrap">
    <div className="note-toolbar" aria-label="格式工具栏">
      {/* 撤销 / 重做 */}
      <TBtn title="撤销 (Ctrl+Z)" onAction={() => editor.chain().focus().undo().run()}>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {/* 左弯箭头 */}
          <path d="M3 8.5a5 5 0 1 1 1.5 3.5" />
          <polyline points="1,5.5 3,8.5 5.5,6.5" />
        </svg>
      </TBtn>
      <TBtn title="重做 (Ctrl+Y)" onAction={() => editor.chain().focus().redo().run()}>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {/* 右弯箭头 */}
          <path d="M12 8.5a5 5 0 1 0-1.5 3.5" />
          <polyline points="14,5.5 12,8.5 9.5,6.5" />
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
          <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "-0.3px" }}>H{level}</span>
        </TBtn>
      ))}

      <Sep />

      {/* 无序 / 有序列表 / 引用 */}
      <TBtn
        active={editor.isActive("bulletList")}
        title="无序列表"
        onAction={() => editor.chain().focus().toggleBulletList().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
          <circle cx="2.5" cy="3.75" r="1.1" />
          <circle cx="2.5" cy="7.5" r="1.1" />
          <circle cx="2.5" cy="11.25" r="1.1" />
          <rect x="5" y="3" width="8" height="1.5" rx=".6" />
          <rect x="5" y="6.75" width="8" height="1.5" rx=".6" />
          <rect x="5" y="10.5" width="8" height="1.5" rx=".6" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("orderedList")}
        title="有序列表"
        onAction={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
          <text x="1" y="5.5" fontSize="4.5" fontFamily="monospace" fontWeight="bold">1.</text>
          <text x="1" y="9.5" fontSize="4.5" fontFamily="monospace" fontWeight="bold">2.</text>
          <text x="1" y="13.5" fontSize="4.5" fontFamily="monospace" fontWeight="bold">3.</text>
          <rect x="6.5" y="3" width="7" height="1.5" rx=".6" />
          <rect x="6.5" y="7" width="7" height="1.5" rx=".6" />
          <rect x="6.5" y="11" width="7" height="1.5" rx=".6" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("blockquote")}
        title="引用"
        onAction={() => editor.chain().focus().toggleBlockquote().run()}
      >
        {/* 左侧竖条 + 两行文字，最直观的引用图标 */}
        <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
          <rect x="2" y="2.5" width="2" height="10" rx="1" />
          <rect x="5.5" y="4" width="7.5" height="1.5" rx=".6" />
          <rect x="5.5" y="7" width="6" height="1.5" rx=".6" />
          <rect x="5.5" y="10" width="7" height="1.5" rx=".6" />
        </svg>
      </TBtn>

      <Sep />

      {/* 行内样式 */}
      <TBtn
        active={editor.isActive("bold")}
        title="粗体 (Ctrl+B)"
        onAction={() => editor.chain().focus().toggleBold().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <text x="7.5" y="12" textAnchor="middle" fontSize="13" fontFamily="system-ui,-apple-system,sans-serif" fontWeight="800" fill="currentColor">B</text>
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("italic")}
        title="斜体 (Ctrl+I)"
        onAction={() => editor.chain().focus().toggleItalic().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <text x="7.5" y="12" textAnchor="middle" fontSize="13" fontFamily="system-ui,-apple-system,sans-serif" fontStyle="italic" fontWeight="500" fill="currentColor">I</text>
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("strike")}
        title="删除线"
        onAction={() => editor.chain().focus().toggleStrike().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <text x="7.5" y="12" textAnchor="middle" fontSize="13" fontFamily="system-ui,-apple-system,sans-serif" fontWeight="500" fill="currentColor">S</text>
          <line x1="2" y1="7.5" x2="13" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("code")}
        title="行内代码 (Ctrl+E)"
        onAction={() => editor.chain().focus().toggleCode().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="5.5,4 2.5,7.5 5.5,11" />
          <polyline points="9.5,4 12.5,7.5 9.5,11" />
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("underline")}
        title="下划线 (Ctrl+U)"
        onAction={() => editor.chain().focus().toggleUnderline().run()}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <text x="7.5" y="11" textAnchor="middle" fontSize="13" fontFamily="system-ui,-apple-system,sans-serif" fontWeight="500" fill="currentColor">U</text>
          <line x1="3" y1="13.5" x2="12" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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


      <Sep />

      {/* 上标 / 下标 */}
      <TBtn
        active={editor.isActive("superscript")}
        title="上标"
        onAction={() => editor.chain().focus().toggleSuperscript().run()}
      >
        {/* x 在下方，² 在右上 */}
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <line x1="1.5" y1="7.5" x2="7.5" y2="13.5" />
          <line x1="7.5" y1="7.5" x2="1.5" y2="13.5" />
          <text x="8.5" y="6.5" fontSize="5.5" fontFamily="system-ui, sans-serif" fontWeight="700" fill="currentColor" stroke="none">2</text>
        </svg>
      </TBtn>
      <TBtn
        active={editor.isActive("subscript")}
        title="下标"
        onAction={() => editor.chain().focus().toggleSubscript().run()}
      >
        {/* x 在上方，₂ 在右下 */}
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <line x1="1.5" y1="1.5" x2="7.5" y2="7.5" />
          <line x1="7.5" y1="1.5" x2="1.5" y2="7.5" />
          <text x="8.5" y="14" fontSize="5.5" fontFamily="system-ui, sans-serif" fontWeight="700" fill="currentColor" stroke="none">2</text>
        </svg>
      </TBtn>

      <Sep />

      {/* 对齐 */}
      {(["left", "center", "right", "justify"] as const).map((align) => {
        const icons: Record<string, React.ReactNode> = {
          left: (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="13" height="1.5" rx=".6" />
              <rect x="1" y="5.75" width="9" height="1.5" rx=".6" />
              <rect x="1" y="9" width="13" height="1.5" rx=".6" />
              <rect x="1" y="12.25" width="7" height="1.5" rx=".6" />
            </svg>
          ),
          center: (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="13" height="1.5" rx=".6" />
              <rect x="3" y="5.75" width="9" height="1.5" rx=".6" />
              <rect x="1" y="9" width="13" height="1.5" rx=".6" />
              <rect x="4" y="12.25" width="7" height="1.5" rx=".6" />
            </svg>
          ),
          right: (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="13" height="1.5" rx=".6" />
              <rect x="5" y="5.75" width="9" height="1.5" rx=".6" />
              <rect x="1" y="9" width="13" height="1.5" rx=".6" />
              <rect x="7" y="12.25" width="7" height="1.5" rx=".6" />
            </svg>
          ),
          justify: (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
              <rect x="1" y="2.5" width="13" height="1.5" rx=".6" />
              <rect x="1" y="5.75" width="13" height="1.5" rx=".6" />
              <rect x="1" y="9" width="13" height="1.5" rx=".6" />
              <rect x="1" y="12.25" width="13" height="1.5" rx=".6" />
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
    </div>
  );
}

/* ——— 主编辑器组件 ——— */

export type NoteCardTiptapEditorHandle = {
  /** 将附件栏媒体插入到视口坐标对应正文位置（桌面拖放） */
  insertNoteMediaAtClientCoords: (
    clientX: number,
    clientY: number,
    payload: NoteMediaDragPayload
  ) => boolean;
};

function insertNoteMediaPayloadAtPos(
  ed: Editor,
  pos: number,
  payload: NoteMediaDragPayload
): boolean {
  if (payload.kind === "image") {
    ed.chain()
      .focus()
      .insertContentAt(pos, {
        type: "image",
        attrs: {
          src: payload.url,
          alt: payload.name ?? "",
          title: payload.name,
        },
      })
      .run();
  } else if (payload.kind === "video") {
    ed.chain()
      .focus()
      .insertContentAt(pos, {
        type: "noteBodyVideo",
        attrs: {
          src: payload.url,
          title: payload.name ?? null,
        },
      })
      .run();
  } else if (payload.kind === "audio") {
    ed.chain()
      .focus()
      .insertContentAt(pos, {
        type: "noteBodyAudio",
        attrs: {
          src: payload.url,
          title: payload.name ?? null,
        },
      })
      .run();
  } else {
    const label = payload.name?.trim() || "文件";
    const safe = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const href = encodeURI(payload.url);
    ed.chain()
      .focus()
      .insertContentAt(
        pos,
        `<p><a href="${href}" rel="noopener noreferrer" target="_blank">${safe(label)}</a></p>`
      )
      .run();
  }
  return true;
}

function insertNoteMediaPayloadAtClient(
  ed: Editor,
  clientX: number,
  clientY: number,
  payload: NoteMediaDragPayload
): boolean {
  const coords = ed.view.posAtCoords({
    left: clientX,
    top: clientY,
  });
  if (coords == null) return false;
  return insertNoteMediaPayloadAtPos(ed, coords.pos, payload);
}

/** TipTap 实现层；界面请用 NoteCardTiptap。 */
export const NoteCardTiptapCore = forwardRef<
  NoteCardTiptapEditorHandle,
  NoteCardTiptapProps
>(function NoteCardTiptapCore(
  {
    id,
    value,
    onChange,
    canEdit,
    ariaLabel: ariaLabelProp,
    onPasteFiles,
    showToolbar = false,
    timelineBodyHeadings = false,
    hideEmbeddedMedia = false,
    insertUploadedImagesAtCursor = false,
    foldBodyMaxLines,
  },
  ref
) {
  const c = useAppChrome();
  const ariaLabel = ariaLabelProp ?? c.uiNoteBodyAria;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  const insertImagesRef = useRef(insertUploadedImagesAtCursor);
  insertImagesRef.current = insertUploadedImagesAtCursor;
  const editorRef = useRef<Editor | null>(null);

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
      NoteBodyImage,
      NoteBodyVideo,
      NoteBodyAudio,
      Highlight.configure({ multicolor: true }),
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
    onCreate({ editor: ed }) {
      editorRef.current = ed;
    },
    onDestroy() {
      editorRef.current = null;
    },
    editorProps: {
      attributes: {
        id,
        class: "card__text",
        spellcheck: "false",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        ...(canEdit ? { role: "textbox" as const } : {}),
      },
      handleDOMEvents: {
        dragover(_view, event) {
          if (hasNoteMediaDragPayload(event.dataTransfer)) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            return true;
          }
          if (
            insertImagesRef.current &&
            event.dataTransfer?.types?.length &&
            Array.from(event.dataTransfer.types).includes("Files")
          ) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            return true;
          }
          return false;
        },
      },
      handlePaste(view, event) {
        const fn = onPasteFilesRef.current;
        if (!fn) return false;
        const files = filesFromDataTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        const insertImg = insertImagesRef.current;
        if (insertImg) {
          const insertPos = view.state.selection.from;
          void Promise.resolve(fn(files)).then((maybeItems) => {
            const list = Array.isArray(maybeItems) ? maybeItems : [];
            const payload = editorInsertPayloadFromMediaItems(list);
            if (payload == null) return;
            const ed = editorRef.current;
            if (!ed?.isEditable) return;
            ed.chain().focus().insertContentAt(insertPos, payload).run();
          });
          return true;
        }
        void Promise.resolve(fn(files));
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const payload = parseNoteMediaDragPayload(event.dataTransfer);
        if (!payload) {
          const insertImg = insertImagesRef.current;
          const fn = onPasteFilesRef.current;
          const ed = editorRef.current;
          if (!insertImg || !fn || !ed?.isEditable) return false;
          const files = filesFromDataTransfer(event.dataTransfer);
          if (files.length === 0) return false;
          const coords = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (coords == null) return false;
          event.preventDefault();
          const pos = coords.pos;
          void Promise.resolve(fn(files)).then((maybeItems) => {
            const list = Array.isArray(maybeItems) ? maybeItems : [];
            const payload = editorInsertPayloadFromMediaItems(list);
            if (payload == null) return;
            const ed2 = editorRef.current;
            if (!ed2?.isEditable) return;
            ed2.chain().focus().insertContentAt(pos, payload).run();
          });
          return true;
        }
        const ed = editorRef.current;
        if (!ed?.isEditable) return false;
        event.preventDefault();
        return insertNoteMediaPayloadAtClient(
          ed,
          event.clientX,
          event.clientY,
          payload
        );
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(ed.getHTML());
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertNoteMediaAtClientCoords(clientX, clientY, payload) {
        const ed = editorRef.current;
        if (!ed?.isEditable) return false;
        return insertNoteMediaPayloadAtClient(ed, clientX, clientY, payload);
      },
    }),
    []
  );

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

  const hideEmb = Boolean(timelineBodyHeadings || hideEmbeddedMedia);
  const foldLines =
    typeof foldBodyMaxLines === "number" &&
    Number.isFinite(foldBodyMaxLines) &&
    foldBodyMaxLines > 0
      ? Math.min(20, Math.floor(foldBodyMaxLines))
      : 0;
  const foldClass =
    foldLines === 3 ? " card__text-editor--fold-body-3" : "";

  return (
    <div
      className={
        (canEdit
          ? "card__text-editor"
          : "card__text-editor card__text-editor--readonly") +
        (timelineBodyHeadings ? " card__text-editor--timeline-body-headings" : "") +
        (hideEmb ? " card__text-editor--hide-embedded-media" : "") +
        foldClass
      }
    >
      {canEdit && showToolbar ? <NoteEditorToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
});
