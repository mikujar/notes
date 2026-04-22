import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CollectionIconShape,
  SchemaField,
  SchemaFieldType,
} from "../types";
import { useAppUiLang } from "../appUiLang";
import { useAppChrome } from "../i18n/useAppChrome";
import {
  CollectionIconGlyph,
  COLLECTION_ICON_SHAPE_OPTIONS,
  normalizeCollectionIconShape,
} from "./CollectionIconGlyph";

export type CollectionTemplateDialogState = {
  collectionId: string;
  displayName: string;
};

export type CollectionSettingsPatch = {
  fields: SchemaField[];
  dotColor: string;
  iconShape: CollectionIconShape;
};

type Props = {
  dialog: CollectionTemplateDialogState | null;
  initialFields: SchemaField[];
  initialDotColor: string;
  initialIconShape: CollectionIconShape | string | null | undefined;
  onClose: () => void;
  onConfirm: (
    collectionId: string,
    patch: CollectionSettingsPatch
  ) => void;
};

const FIELD_TYPES: SchemaFieldType[] = [
  "text",
  "number",
  "choice",
  "cardLink",
  "cardLinks",
  "collectionLink",
  "date",
  "checkbox",
  "url",
];

const FIELD_TYPE_LABELS: Record<
  SchemaFieldType,
  { zh: string; en: string }
> = {
  text: { zh: "文本", en: "Text" },
  number: { zh: "数字", en: "Number" },
  choice: { zh: "单选", en: "Choice" },
  cardLink: { zh: "关联单卡", en: "Single card link" },
  cardLinks: { zh: "关联多卡", en: "Multi card links" },
  collectionLink: { zh: "关联合集", en: "Collection link" },
  date: { zh: "日期时间", en: "Date & time" },
  checkbox: { zh: "勾选", en: "Checkbox" },
  url: { zh: "链接", en: "URL" },
};

/** 预设调色板：和已有 randomDotColor 里用到的色相一致 */
const PRESET_COLORS: string[] = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#10b981",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#a8a29e",
  "#111827",
];

function createFieldId(index: number) {
  return `sf-u-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeCssColor(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "#a8a29e";
  return s;
}

export function CollectionTemplateModal({
  dialog,
  initialFields,
  initialDotColor,
  initialIconShape,
  onClose,
  onConfirm,
}: Props) {
  const { lang } = useAppUiLang();
  const c = useAppChrome();
  const [draft, setDraft] = useState<SchemaField[]>([]);
  const [dotColor, setDotColor] = useState<string>("#a8a29e");
  const [iconShape, setIconShape] = useState<CollectionIconShape>("dot");

  useEffect(() => {
    if (!dialog) return;
    const seeded = (initialFields ?? []).map((f, i) => ({
      ...f,
      id: f.id?.trim() || createFieldId(i),
      order: i,
    }));
    setDraft(
      seeded.length > 0
        ? seeded
        : [
            {
              id: createFieldId(0),
              name: lang === "en" ? "Title" : "标题",
              type: "text",
              order: 0,
            },
          ]
    );
    setDotColor(normalizeCssColor(initialDotColor));
    setIconShape(normalizeCollectionIconShape(initialIconShape));
  }, [dialog, initialFields, initialDotColor, initialIconShape, lang]);

  const title = useMemo(
    () =>
      lang === "en"
        ? `Collection settings: ${dialog?.displayName ?? ""}`
        : `合集设置：${dialog?.displayName ?? ""}`,
    [dialog?.displayName, lang]
  );

  if (!dialog) return null;

  const shapeOptions = COLLECTION_ICON_SHAPE_OPTIONS();

  return createPortal(
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-modal collection-template-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-template-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="collection-template-modal__head">
          <h3
            className="collection-template-modal__title"
            id="collection-template-modal-title"
          >
            {title}
          </h3>
          <p className="collection-template-modal__sub">
            {lang === "en"
              ? "Configure icon, color, and card schema fields."
              : "调整图标、颜色，以及该合集下卡片的属性模板。"}
          </p>
        </div>

        <div className="collection-template-modal__section">
          <div className="collection-template-modal__section-label">
            {lang === "en" ? "Icon shape" : "图标形状"}
          </div>
          <div
            className="collection-template-modal__shape-row"
            role="radiogroup"
            aria-label={lang === "en" ? "Icon shape" : "图标形状"}
          >
            {shapeOptions.map((opt) => {
              const active = opt.value === iconShape;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={lang === "en" ? opt.labelEn : opt.labelZh}
                  className={
                    "collection-template-modal__shape-btn" +
                    (active ? " is-active" : "")
                  }
                  onClick={() => setIconShape(opt.value)}
                >
                  <CollectionIconGlyph
                    shape={opt.value}
                    color={dotColor}
                    size={14}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="collection-template-modal__section">
          <div className="collection-template-modal__section-label">
            {lang === "en" ? "Icon color" : "图标颜色"}
          </div>
          <div className="collection-template-modal__color-row">
            {PRESET_COLORS.map((cc) => {
              const active = cc.toLowerCase() === dotColor.toLowerCase();
              return (
                <button
                  key={cc}
                  type="button"
                  className={
                    "collection-template-modal__color-swatch" +
                    (active ? " is-active" : "")
                  }
                  style={{ backgroundColor: cc }}
                  aria-label={cc}
                  onClick={() => setDotColor(cc)}
                />
              );
            })}
            <input
              type="color"
              className="collection-template-modal__color-input"
              value={
                dotColor.startsWith("#") && dotColor.length === 7
                  ? dotColor
                  : "#a8a29e"
              }
              onChange={(e) => setDotColor(e.target.value)}
              aria-label={lang === "en" ? "Custom color" : "自定义颜色"}
            />
          </div>
        </div>

        <div className="collection-template-modal__section">
          <div className="collection-template-modal__section-label">
            {lang === "en" ? "Card properties" : "卡片属性"}
          </div>
          <div className="collection-template-modal__fields">
            {draft.map((f, idx) => (
              <div
                key={`${f.id}-${idx}`}
                className="collection-template-modal__field-row"
              >
                <input
                  className="auth-modal__input"
                  aria-label={lang === "en" ? "Field name" : "属性名"}
                  placeholder={lang === "en" ? "Field name" : "属性名称"}
                  value={f.name}
                  onChange={(e) =>
                    setDraft((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], name: e.target.value };
                      return next;
                    })
                  }
                />
                <select
                  className="auth-modal__input"
                  aria-label={lang === "en" ? "Field type" : "属性类型"}
                  value={f.type}
                  onChange={(e) =>
                    setDraft((prev) => {
                      const next = [...prev];
                      next[idx] = {
                        ...next[idx],
                        type: e.target.value as SchemaFieldType,
                      };
                      return next;
                    })
                  }
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {lang === "en"
                        ? FIELD_TYPE_LABELS[t].en
                        : FIELD_TYPE_LABELS[t].zh}
                    </option>
                  ))}
                </select>
                {draft.length > 1 ? (
                  <button
                    type="button"
                    className="note-settings-modal__custom-type-remove-field"
                    aria-label={lang === "en" ? "Remove field" : "删除属性"}
                    onClick={() =>
                      setDraft((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    −
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="auth-modal__btn collection-template-modal__add-btn"
            onClick={() =>
              setDraft((prev) => [
                ...prev,
                {
                  id: createFieldId(prev.length),
                  name: "",
                  type: "text",
                  order: prev.length,
                },
              ])
            }
          >
            {lang === "en" ? "Add field" : "新增属性"}
          </button>
        </div>

        <div className="collection-template-modal__actions">
          <button type="button" className="auth-modal__btn" onClick={onClose}>
            {lang === "en" ? "Cancel" : "取消"}
          </button>
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary"
            onClick={() => {
              const fields = draft
                .map((f, idx) => ({
                  ...f,
                  id: f.id?.trim() || createFieldId(idx),
                  name: f.name.trim(),
                  order: idx,
                }))
                .filter((f) => f.name);
              onConfirm(dialog.collectionId, {
                fields,
                dotColor: normalizeCssColor(dotColor),
                iconShape,
              });
            }}
          >
            {c.done}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
