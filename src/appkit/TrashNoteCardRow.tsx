import type { Dispatch, SetStateAction } from "react";
import { CardGallery } from "../CardGallery";
import { CardRowInner } from "../CardRowInner";
import { CardTagsRow } from "../CardTagsRow";
import { NoteCardTiptap } from "../noteEditor/NoteCardTiptap";
import {
  formatCardReminderBesideTime,
  formatCardTimeLabel,
} from "../cardTimeLabel";
import type { TrashedNoteEntry } from "../types";
import { cardNeedsMasonryCollapse } from "./masonryLayout";

export type TrashNoteCardRowProps = {
  entry: TrashedNoteEntry;
  canEdit: boolean;
  masonryLayout: boolean;
  cardMenuId: string | null;
  setCardMenuId: Dispatch<SetStateAction<string | null>>;
  restoreTrashedEntry: (entry: TrashedNoteEntry) => void;
  purgeTrashedEntry: (trashId: string) => void;
};

export function TrashNoteCardRow(p: TrashNoteCardRowProps) {
  const {
    entry,
    canEdit,
    masonryLayout,
    cardMenuId,
    setCardMenuId,
    restoreTrashedEntry,
    purgeTrashedEntry,
  } = p;

  const card = entry.card;
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const hasGallery = media.length > 0;
  const trashReminderBeside = formatCardReminderBesideTime(card);
  const trashHugeMasonry =
    masonryLayout && cardNeedsMasonryCollapse(card);
  const menuId = `__trash__${entry.trashId}`;
  return (
    <li
      className={
        "card card--in-trash" +
        (cardMenuId === menuId ? " is-menu-open" : "") +
        (trashHugeMasonry ? " card--masonry-collapsed" : "")
      }
      title={
        entry.colPathLabel
          ? `原所在合集：${entry.colPathLabel}`
          : undefined
      }
    >
      <CardRowInner
        hasGallery={hasGallery}
        textRev={card.text}
        masonryLayout={masonryLayout}
        className={
          "card__inner" + (hasGallery ? " card__inner--split" : "")
        }
      >
        <div
          className={
            "card__paper" +
            (hasGallery ? " card__paper--with-gallery" : "")
          }
        >
          <div className="card__toolbar">
            <span className="card__time">
              {formatCardTimeLabel(card)}
              {trashReminderBeside ? (
                <span className="card__time-reminder">
                  {trashReminderBeside}
                </span>
              ) : null}
            </span>
            <div className="card__toolbar-actions">
              {canEdit ? (
                <div
                  className="card__menu-root"
                  data-card-menu-root={menuId}
                >
                  <button
                    type="button"
                    className="card__more"
                    aria-label="更多操作"
                    aria-expanded={cardMenuId === menuId}
                    onClick={() =>
                      setCardMenuId((id) =>
                        id === menuId ? null : menuId
                      )
                    }
                  >
                    …
                  </button>
                  {cardMenuId === menuId ? (
                    <div
                      className="card__menu"
                      role="menu"
                      aria-orientation="vertical"
                    >
                      <button
                        type="button"
                        className="card__menu-item"
                        role="menuitem"
                        onClick={() => {
                          setCardMenuId(null);
                          restoreTrashedEntry(entry);
                        }}
                      >
                        恢复到原合集
                      </button>
                      <button
                        type="button"
                        className="card__menu-item card__menu-item--danger"
                        role="menuitem"
                        onClick={() => {
                          setCardMenuId(null);
                          purgeTrashedEntry(entry.trashId);
                        }}
                      >
                        永久删除
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="card__toolbar-spacer" aria-hidden />
              )}
            </div>
          </div>
          <NoteCardTiptap
            id={`trash-card-text-${entry.trashId}`}
            value={card.text}
            canEdit={false}
            ariaLabel="笔记正文"
            onChange={() => {}}
          />
          <CardTagsRow
            colId={entry.colId}
            card={card}
            canEdit={false}
            onCommit={() => {}}
          />
        </div>
        {hasGallery ? (
          <CardGallery items={media} />
        ) : null}
      </CardRowInner>
    </li>
  );
}
