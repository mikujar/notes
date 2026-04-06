import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Collection, NoteCard } from "./types";

function findCard(
  cols: Collection[],
  colId: string,
  cardId: string
): NoteCard | null {
  const walk = (nodes: Collection[]): NoteCard | null => {
    for (const c of nodes) {
      if (c.id === colId) {
        const card = c.cards.find((x) => x.id === cardId);
        if (card) return card;
      }
      if (c.children?.length) {
        const f = walk(c.children);
        if (f) return f;
      }
    }
    return null;
  };
  return walk(cols);
}

export function ReminderPickerModal({
  open,
  collections,
  colId,
  cardId,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  collections: Collection[];
  colId: string;
  cardId: string;
  onClose: () => void;
  onSave: (isoDate: string) => void;
  onClear: () => void;
}) {
  const card = open ? findCard(collections, colId, cardId) : null;
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open || !card) return;
    setValue(card.reminderOn ?? "");
  }, [open, card, cardId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !card) return null;

  return createPortal(
    <div
      className="reminder-picker-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-picker-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="reminder-picker-modal__panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="reminder-picker-title" className="reminder-picker-modal__title">
          设置提醒
        </h2>
        <p className="reminder-picker-modal__hint">
          在侧栏日历中选中该日期时，这条笔记会出现在当日列表最上方的「提醒」区域。
        </p>
        <label className="reminder-picker-modal__label">
          提醒日期
          <input
            type="date"
            className="reminder-picker-modal__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="reminder-picker-modal__actions">
          <button
            type="button"
            className="reminder-picker-modal__btn reminder-picker-modal__btn--ghost"
            onClick={onClose}
          >
            取消
          </button>
          {card.reminderOn ? (
            <button
              type="button"
              className="reminder-picker-modal__btn reminder-picker-modal__btn--ghost"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              清除提醒
            </button>
          ) : null}
          <button
            type="button"
            className="reminder-picker-modal__btn reminder-picker-modal__btn--primary"
            disabled={!value}
            onClick={() => {
              if (!value) return;
              onSave(value);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
