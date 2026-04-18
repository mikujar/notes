import Image from "@tiptap/extension-image";
import { mergeAttributes, Node } from "@tiptap/core";
import type { Editor, NodeViewProps } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import {
  MediaThumbLoadingOverlay,
  useMediaDisplaySrc,
} from "../mediaDisplay";
import { useAppChrome } from "../i18n/useAppChrome";

const NOTE_BODY_IMG_MIN_W = 48;

function parseHtmlImgSize(
  element: HTMLElement,
  key: "width" | "height"
): number | null {
  const a = element.getAttribute(key);
  if (a) {
    const n = parseInt(a, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const sh = element.style?.[key] as string | undefined;
  if (sh && /px$/i.test(sh)) {
    const n = parseInt(sh, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function proseMirrorMaxContentWidthPx(editor: Editor): number {
  const root = editor.view.dom as HTMLElement;
  const cs = getComputedStyle(root);
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  const inner = Math.max(0, root.clientWidth - pl - pr);
  return Math.max(NOTE_BODY_IMG_MIN_W, inner);
}

function NoteInlineMediaPendingBlock({
  title,
  hint,
}: {
  title?: string | null;
  hint: string;
}) {
  const name = title?.trim();
  return (
    <div className="note-inline-media-pending" aria-busy="true">
      <div className="note-inline-media-pending__visual">
        <MediaThumbLoadingOverlay />
      </div>
      <div className="note-inline-media-pending__meta">
        {name ? (
          <div className="note-inline-media-pending__title" title={name}>
            {name}
          </div>
        ) : null}
        <div className="note-inline-media-pending__hint">{hint}</div>
      </div>
    </div>
  );
}

function NoteBodyImageView(props: NodeViewProps) {
  const { editor, node, updateAttributes, selected } = props;
  const ui = useAppChrome();
  const raw = String(props.node.attrs.src ?? "").trim();
  const displaySrc = useMediaDisplaySrc(raw || undefined);
  const alt = String(props.node.attrs.alt ?? "");
  const title = props.node.attrs.title as string | null | undefined;
  const pendingLabel =
    (title ?? alt).trim() || ui.uiNoteInlineMediaLoadingImage;

  const attrW = node.attrs.width;
  const storedW =
    attrW != null && String(attrW).trim() !== ""
      ? Math.round(Number(attrW))
      : null;
  const validStoredW =
    storedW != null && Number.isFinite(storedW) && storedW > 0
      ? storedW
      : null;

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragW, setDragW] = useState<number | null>(null);

  const editable = editor.isEditable;
  const showHandles = Boolean(
    editable &&
      displaySrc &&
      (selected || hovered || dragW !== null)
  );

  const onResizePointerDown = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      const handle = e.currentTarget;
      if (!img) return;
      const maxW0 = proseMirrorMaxContentWidthPx(editor);
      const rect = img.getBoundingClientRect();
      const startW = Math.min(rect.width, maxW0);
      const startX = e.clientX;
      const pointerId = e.pointerId;
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      setDragW(Math.round(startW));

      const onMove = (ev: PointerEvent) => {
        const maxW = proseMirrorMaxContentWidthPx(editor);
        const dx = ev.clientX - startX;
        const next =
          side === "right" ? startW + dx : startW - dx;
        const clamped = Math.min(
          maxW,
          Math.max(NOTE_BODY_IMG_MIN_W, next)
        );
        setDragW(Math.round(clamped));
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
        const maxW = proseMirrorMaxContentWidthPx(editor);
        const dx = ev.clientX - startX;
        const next =
          side === "right" ? startW + dx : startW - dx;
        const clamped = Math.min(
          maxW,
          Math.max(NOTE_BODY_IMG_MIN_W, next)
        );
        setDragW(null);
        updateAttributes({
          width: Math.round(clamped),
          height: null,
        });
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [editable, editor, updateAttributes]
  );

  const shownW =
    dragW ??
    (validStoredW != null
      ? Math.min(validStoredW, proseMirrorMaxContentWidthPx(editor))
      : null);

  return (
    <NodeViewWrapper
      as="span"
      className={
        "note-body-img-nodeview" +
        (showHandles ? " note-body-img-nodeview--handles" : "")
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!displaySrc ? (
        <span
          className="note-inline-img note-inline-img--pending"
          aria-busy="true"
          title={pendingLabel}
        >
          <span
            className="note-inline-img-pending__spinner"
            aria-hidden="true"
          />
          <span className="note-inline-img-pending__label">{pendingLabel}</span>
          <span className="note-inline-img-pending__dots" aria-hidden="true">
            <span className="note-inline-img-pending__dot" />
            <span className="note-inline-img-pending__dot" />
            <span className="note-inline-img-pending__dot" />
          </span>
        </span>
      ) : (
        <>
          <img
            ref={imgRef}
            src={displaySrc}
            alt={alt}
            title={title ?? undefined}
            className="note-inline-img"
            draggable={false}
            width={undefined}
            height={undefined}
            style={
              shownW != null
                ? {
                    width: `${shownW}px`,
                    maxWidth: "100%",
                    height: "auto",
                  }
                : { maxWidth: "100%", height: "auto" }
            }
          />
          {showHandles ? (
            <>
              <span
                className="note-body-img-resize-handle note-body-img-resize-handle--left"
                contentEditable={false}
                draggable={false}
                role="separator"
                aria-orientation="vertical"
                aria-label={ui.uiNoteBodyImageResizeHandleAria}
                onPointerDown={onResizePointerDown("left")}
              />
              <span
                className="note-body-img-resize-handle note-body-img-resize-handle--right"
                contentEditable={false}
                draggable={false}
                role="separator"
                aria-orientation="vertical"
                aria-label={ui.uiNoteBodyImageResizeHandleAria}
                onPointerDown={onResizePointerDown("right")}
              />
            </>
          ) : null}
        </>
      )}
    </NodeViewWrapper>
  );
}

/** 正文图片：持久化仍用 attrs.src 存存储 URL，展示经 COS/本地 解析 */
export const NoteBodyImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null as number | null,
        parseHTML: (element) =>
          parseHtmlImgSize(element as HTMLElement, "width"),
        renderHTML: (attributes) => {
          const w = attributes.width;
          if (w == null || w === "") return {};
          const n = typeof w === "number" ? w : parseInt(String(w), 10);
          if (!Number.isFinite(n) || n <= 0) return {};
          return { width: String(Math.round(n)) };
        },
      },
      height: {
        default: null as number | null,
        parseHTML: (element) =>
          parseHtmlImgSize(element as HTMLElement, "height"),
        renderHTML: (attributes) => {
          const h = attributes.height;
          if (h == null || h === "") return {};
          const n = typeof h === "number" ? h : parseInt(String(h), 10);
          if (!Number.isFinite(n) || n <= 0) return {};
          return { height: String(Math.round(n)) };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(NoteBodyImageView, {
      as: "span",
      update: ({ oldNode, newNode }) =>
        oldNode.type === newNode.type &&
        oldNode.attrs.src === newNode.attrs.src &&
        oldNode.attrs.alt === newNode.attrs.alt &&
        oldNode.attrs.title === newNode.attrs.title &&
        oldNode.attrs.width === newNode.attrs.width &&
        oldNode.attrs.height === newNode.attrs.height,
    });
  },
}).configure({
  inline: true,
  allowBase64: true,
  HTMLAttributes: { class: "note-inline-img" },
});

function NoteBodyVideoView(props: NodeViewProps) {
  const ui = useAppChrome();
  const raw = String(props.node.attrs.src ?? "").trim();
  const src = useMediaDisplaySrc(raw || undefined);
  const title = props.node.attrs.title as string | null | undefined;
  return (
    <NodeViewWrapper className="note-inline-video-wrap">
      {!src ? (
        <NoteInlineMediaPendingBlock
          title={title}
          hint={ui.uiNoteInlineMediaLoadingVideo}
        />
      ) : (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          className="note-inline-video"
          title={title ?? undefined}
        />
      )}
    </NodeViewWrapper>
  );
}

export type NoteBodyVideoOptions = {
  HTMLAttributes: Record<string, unknown>;
};

export const NoteBodyVideo = Node.create<NoteBodyVideoOptions>({
  name: "noteBodyVideo",

  group: "block",

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: { default: null as string | null },
      title: { default: null as string | null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "video",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const src =
            el.getAttribute("src")?.trim() ||
            el.querySelector("source")?.getAttribute("src")?.trim();
          if (!src) return false;
          return {
            src,
            title: el.getAttribute("title"),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(
        {
          controls: true,
          playsInline: true,
          preload: "metadata",
          class: "note-inline-video",
        },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteBodyVideoView, {
      update: ({ oldNode, newNode }) =>
        oldNode.type === newNode.type &&
        oldNode.attrs.src === newNode.attrs.src &&
        oldNode.attrs.title === newNode.attrs.title,
    });
  },
});

function NoteBodyAudioView(props: NodeViewProps) {
  const ui = useAppChrome();
  const raw = String(props.node.attrs.src ?? "").trim();
  const src = useMediaDisplaySrc(raw || undefined);
  const title = props.node.attrs.title as string | null | undefined;
  return (
    <NodeViewWrapper className="note-inline-audio-wrap">
      {!src ? (
        <NoteInlineMediaPendingBlock
          title={title}
          hint={ui.uiNoteInlineMediaLoadingAudio}
        />
      ) : (
        <audio
          src={src}
          controls
          preload="metadata"
          className="note-inline-audio"
          title={title ?? undefined}
        />
      )}
    </NodeViewWrapper>
  );
}

export type NoteBodyAudioOptions = {
  HTMLAttributes: Record<string, unknown>;
};

export const NoteBodyAudio = Node.create<NoteBodyAudioOptions>({
  name: "noteBodyAudio",

  group: "block",

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: { default: null as string | null },
      title: { default: null as string | null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "audio",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const src =
            el.getAttribute("src")?.trim() ||
            el.querySelector("source")?.getAttribute("src")?.trim();
          if (!src) return false;
          return {
            src,
            title: el.getAttribute("title"),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "audio",
      mergeAttributes(
        {
          controls: true,
          preload: "metadata",
          class: "note-inline-audio",
        },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteBodyAudioView, {
      update: ({ oldNode, newNode }) =>
        oldNode.type === newNode.type &&
        oldNode.attrs.src === newNode.attrs.src &&
        oldNode.attrs.title === newNode.attrs.title,
    });
  },
});
