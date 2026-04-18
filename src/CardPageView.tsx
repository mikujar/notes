import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { NoteCardTiptap } from "./noteEditor/NoteCardTiptap";
import { formatTagsForInput, parseTagsFromInput } from "./CardTagsRow";
import { formatCardTimeLabel } from "./cardTimeLabel";
import {
  collectionIdsContainingCardId,
  collectionPathLabel,
} from "./appkit/collectionModel";
import type {
  CardProperty,
  CardPropertyOption,
  CardPropertyType,
  Collection,
  NoteCard,
  NoteMediaItem,
} from "./types";
import type { ReminderPickerTarget } from "./ReminderPickerModal";
import { useAppUiLang } from "./appUiLang";

const PROP_TYPE_LABELS: Record<CardPropertyType, string> = {
  text: "文字",
  number: "数字",
  select: "单选",
  multiSelect: "多选",
  date: "日期",
  checkbox: "勾选",
  url: "链接",
};

const PROP_TYPE_ICONS: Record<CardPropertyType, string> = {
  text: "T",
  number: "#",
  select: "≡",
  multiSelect: "☰",
  date: "◫",
  checkbox: "✓",
  url: "⊕",
};

function genId() {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface CardPageViewProps {
  card: NoteCard;
  colId: string;
  collections: Collection[];
  canEdit: boolean;
  canAttachMedia: boolean;
  onClose: () => void;
  setCardText: (colId: string, cardId: string, text: string) => void;
  setCardTags: (colId: string, cardId: string, tags: string[]) => void;
  setCardCustomProps: (cardId: string, props: CardProperty[]) => void;
  setReminderPicker: Dispatch<SetStateAction<ReminderPickerTarget | null>>;
  openAddToCollectionPicker: (colId: string, cardId: string) => void;
  setRelatedPanel: Dispatch<
    SetStateAction<{ colId: string; cardId: string } | null>
  >;
  uploadFilesToCard: (
    colId: string,
    cardId: string,
    files: File[]
  ) => void | Promise<void>;
  removeCardMediaItem: (
    colId: string,
    cardId: string,
    item: NoteMediaItem
  ) => void;
}

function SelectPropEditor({
  prop,
  onChangeValue,
  onChangeOptions,
}: {
  prop: CardProperty;
  onChangeValue: (v: string | null) => void;
  onChangeOptions: (opts: CardPropertyOption[]) => void;
}) {
  const [val, setVal] = useState(
    typeof prop.value === "string" ? prop.value : ""
  );
  const opts = prop.options ?? [];
  const listId = `datalist-${prop.id}`;
  return (
    <div className="card-page__prop-select-wrap">
      <input
        type="text"
        className="card-page__prop-input"
        list={listId}
        placeholder="输入或选择…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          const v = val.trim();
          onChangeValue(v || null);
          if (v && !opts.find((o) => o.name === v)) {
            onChangeOptions([
              ...opts,
              { id: genId(), name: v, color: "#e0e0e0" },
            ]);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <datalist id={listId}>
        {opts.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>
    </div>
  );
}

function PropValueEditor({
  prop,
  canEdit,
  onChangeValue,
  onChangeOptions,
}: {
  prop: CardProperty;
  canEdit: boolean;
  onChangeValue: (v: CardProperty["value"]) => void;
  onChangeOptions: (opts: CardPropertyOption[]) => void;
}) {
  if (!canEdit) {
    if (prop.type === "checkbox") {
      return (
        <span className="card-page__prop-val-text">
          {prop.value ? "✓" : "—"}
        </span>
      );
    }
    if (prop.type === "multiSelect" && Array.isArray(prop.value)) {
      const vals = prop.value as string[];
      return vals.length ? (
        <span className="card-page__prop-chips">
          {vals.map((v) => (
            <span key={v} className="card-page__prop-chip">
              {v}
            </span>
          ))}
        </span>
      ) : (
        <span className="card-page__prop-empty">—</span>
      );
    }
    return (
      <span
        className={
          prop.value == null || prop.value === ""
            ? "card-page__prop-empty"
            : "card-page__prop-val-text"
        }
      >
        {prop.value == null || prop.value === "" ? "—" : String(prop.value)}
      </span>
    );
  }

  if (prop.type === "checkbox") {
    return (
      <input
        type="checkbox"
        className="card-page__prop-checkbox"
        checked={Boolean(prop.value)}
        onChange={(e) => onChangeValue(e.target.checked)}
      />
    );
  }

  if (prop.type === "multiSelect") {
    const tags = Array.isArray(prop.value) ? (prop.value as string[]) : [];
    return (
      <input
        type="text"
        className="card-page__prop-input"
        placeholder="用逗号分隔"
        defaultValue={tags.join("，")}
        onBlur={(e) => {
          const vals = e.target.value
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean);
          onChangeValue(vals.length ? vals : null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  if (prop.type === "select") {
    return (
      <SelectPropEditor
        prop={prop}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
      />
    );
  }

  if (prop.type === "date") {
    return (
      <input
        type="date"
        className="card-page__prop-input"
        value={typeof prop.value === "string" ? prop.value : ""}
        onChange={(e) => onChangeValue(e.target.value || null)}
      />
    );
  }

  if (prop.type === "number") {
    return (
      <input
        type="number"
        className="card-page__prop-input"
        placeholder="—"
        defaultValue={typeof prop.value === "number" ? prop.value : ""}
        onBlur={(e) => {
          const v = e.target.value;
          onChangeValue(v === "" ? null : Number(v));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  if (prop.type === "url") {
    return (
      <input
        type="url"
        className="card-page__prop-input"
        placeholder="https://…"
        defaultValue={typeof prop.value === "string" ? prop.value : ""}
        onBlur={(e) => onChangeValue(e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <input
      type="text"
      className="card-page__prop-input"
      placeholder="—"
      defaultValue={typeof prop.value === "string" ? prop.value : ""}
      onBlur={(e) => onChangeValue(e.target.value || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function CardPageView({
  card,
  colId,
  collections,
  canEdit,
  canAttachMedia,
  onClose,
  setCardText,
  setCardTags,
  setCardCustomProps,
  setReminderPicker,
  openAddToCollectionPicker,
  setRelatedPanel,
  uploadFilesToCard,
  removeCardMediaItem,
}: CardPageViewProps) {
  const { lang } = useAppUiLang();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const typePickerRef = useRef<HTMLDivElement>(null);

  const PROPS_WIDTH_KEY = "mikujar-card-page-props-width";
  const [propsWidth, setPropsWidth] = useState(() => {
    try {
      const v = localStorage.getItem(PROPS_WIDTH_KEY);
      return v ? Math.max(160, Math.min(520, Number(v))) : 260;
    } catch {
      return 260;
    }
  });
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    dragStartWidth.current = propsWidth;
  }, [propsWidth]);

  const onDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - dragStartX.current;
    const next = Math.max(160, Math.min(520, dragStartWidth.current + delta));
    setPropsWidth(next);
  }, []);

  const onDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const delta = e.clientX - dragStartX.current;
    const next = Math.max(160, Math.min(520, dragStartWidth.current + delta));
    try { localStorage.setItem(PROPS_WIDTH_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const customProps = card.customProps ?? [];
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const colIds = [...collectionIdsContainingCardId(collections, card.id)];
  const relatedCount = (card.relatedRefs ?? []).length;
  const hasReminder = Boolean(card.reminderOn);

  useEffect(() => {
    if (!showTypePicker) return;
    function onDown(e: MouseEvent) {
      if (
        typePickerRef.current &&
        !typePickerRef.current.contains(e.target as Node)
      ) {
        setShowTypePicker(false);
      }
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showTypePicker]);

  function updateCustomProps(next: CardProperty[]) {
    setCardCustomProps(card.id, next);
  }

  function addProperty(type: CardPropertyType) {
    const newProp: CardProperty = {
      id: genId(),
      name: PROP_TYPE_LABELS[type],
      type,
      value: type === "checkbox" ? false : null,
    };
    updateCustomProps([...customProps, newProp]);
    setShowTypePicker(false);
  }

  return (
    <div className="card-page">
      <div className="card-page__header">
        <button
          type="button"
          className="card-page__back"
          onClick={onClose}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          返回
        </button>
        <span className="card-page__time">
          {formatCardTimeLabel(card, lang)}
        </span>
      </div>

      <div className="card-page__body">
        <div className="card-page__props" style={{ width: propsWidth, flexBasis: propsWidth }}>
          <div className="card-page__props-heading">属性</div>

          {/* 标签 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">标签</span>
            <div className="card-page__prop-content">
              {canEdit ? (
                <input
                  type="text"
                  className="card-page__prop-input"
                  placeholder="用逗号分隔"
                  defaultValue={formatTagsForInput(card.tags)}
                  onBlur={(e) =>
                    setCardTags(
                      colId,
                      card.id,
                      parseTagsFromInput(e.target.value)
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (card.tags ?? []).length ? (
                <span className="card-page__prop-chips">
                  {card.tags!.map((t) => (
                    <span key={t} className="card-page__prop-chip">
                      {t}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 提醒 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">提醒</span>
            <div className="card-page__prop-content">
              {hasReminder ? (
                <button
                  type="button"
                  className="card-page__prop-link"
                  onClick={() =>
                    setReminderPicker({ kind: "card", colId, cardId: card.id })
                  }
                >
                  {card.reminderOn}
                  {card.reminderTime ? ` ${card.reminderTime}` : ""}
                  {card.reminderNote ? ` · ${card.reminderNote}` : ""}
                </button>
              ) : canEdit ? (
                <button
                  type="button"
                  className="card-page__prop-link card-page__prop-link--placeholder"
                  onClick={() =>
                    setReminderPicker({ kind: "card", colId, cardId: card.id })
                  }
                >
                  添加提醒…
                </button>
              ) : (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 合集 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">合集</span>
            <div className="card-page__prop-content card-page__prop-content--row">
              {colIds.map((id) => (
                <span key={id} className="card-page__prop-chip card-page__prop-chip--col">
                  {collectionPathLabel(collections, id)}
                </span>
              ))}
              {canEdit && (
                <button
                  type="button"
                  className="card-page__prop-link card-page__prop-link--add"
                  onClick={() =>
                    openAddToCollectionPicker(colId, card.id)
                  }
                >
                  + 添加至合集
                </button>
              )}
            </div>
          </div>

          {/* 相关笔记 */}
          <div className="card-page__prop-row">
            <span className="card-page__prop-label">相关笔记</span>
            <div className="card-page__prop-content">
              {relatedCount > 0 ? (
                <button
                  type="button"
                  className="card-page__prop-link"
                  onClick={() =>
                    setRelatedPanel({ colId, cardId: card.id })
                  }
                >
                  {relatedCount} 条相关
                </button>
              ) : canEdit ? (
                <button
                  type="button"
                  className="card-page__prop-link card-page__prop-link--placeholder"
                  onClick={() =>
                    setRelatedPanel({ colId, cardId: card.id })
                  }
                >
                  添加关联…
                </button>
              ) : (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 附件 */}
          <div className="card-page__prop-row card-page__prop-row--attachments">
            <span className="card-page__prop-label">附件</span>
            <div className="card-page__prop-content card-page__prop-content--attachments">
              {media.map((item) => (
                <div key={item.url} className="card-page__attachment">
                  {item.kind === "image" ? (
                    <img
                      src={item.thumbnailUrl ?? item.url}
                      alt={item.name ?? ""}
                      className="card-page__attachment-thumb"
                    />
                  ) : (
                    <span className="card-page__attachment-name">
                      {item.name ?? item.url.split("/").pop()}
                    </span>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="card-page__attachment-remove"
                      onClick={() =>
                        removeCardMediaItem(colId, card.id, item)
                      }
                      title="移除"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {canAttachMedia && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length)
                        void uploadFilesToCard(colId, card.id, files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="card-page__prop-link card-page__prop-link--add"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    + 上传附件
                  </button>
                </>
              )}
              {media.length === 0 && !canAttachMedia && (
                <span className="card-page__prop-empty">—</span>
              )}
            </div>
          </div>

          {/* 自定义属性 */}
          {customProps.map((prop) => (
            <div
              key={prop.id}
              className="card-page__prop-row card-page__prop-row--custom"
            >
              <div className="card-page__prop-label-wrap">
                <span className="card-page__prop-type-icon">
                  {PROP_TYPE_ICONS[prop.type]}
                </span>
                {canEdit ? (
                  <input
                    type="text"
                    className="card-page__prop-name-input"
                    defaultValue={prop.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim() || prop.name;
                      updateCustomProps(
                        customProps.map((p) =>
                          p.id === prop.id ? { ...p, name } : p
                        )
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="card-page__prop-label">{prop.name}</span>
                )}
              </div>
              <div className="card-page__prop-content">
                <PropValueEditor
                  prop={prop}
                  canEdit={canEdit}
                  onChangeValue={(v) =>
                    updateCustomProps(
                      customProps.map((p) =>
                        p.id === prop.id ? { ...p, value: v } : p
                      )
                    )
                  }
                  onChangeOptions={(opts) =>
                    updateCustomProps(
                      customProps.map((p) =>
                        p.id === prop.id ? { ...p, options: opts } : p
                      )
                    )
                  }
                />
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="card-page__prop-delete"
                  onClick={() =>
                    updateCustomProps(customProps.filter((p) => p.id !== prop.id))
                  }
                  title="删除属性"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {/* 添加属性 */}
          {canEdit && (
            <div className="card-page__prop-add-wrap" ref={typePickerRef}>
              <button
                type="button"
                className="card-page__prop-add"
                onClick={() => setShowTypePicker((v) => !v)}
              >
                + 添加属性
              </button>
              {showTypePicker && (
                <div className="card-page__prop-type-menu">
                  {(
                    Object.keys(PROP_TYPE_LABELS) as CardPropertyType[]
                  ).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="card-page__prop-type-option"
                      onClick={() => addProperty(type)}
                    >
                      <span className="card-page__prop-type-icon">
                        {PROP_TYPE_ICONS[type]}
                      </span>
                      {PROP_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className="card-page__divider"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
        />

        <div className="card-page__editor-area">
          <NoteCardTiptap
            id={card.id}
            value={card.text}
            onChange={(text) => setCardText(colId, card.id, text)}
            canEdit={canEdit}
            showToolbar={canEdit}
          />
        </div>
      </div>
    </div>
  );
}
