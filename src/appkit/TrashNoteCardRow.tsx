import type { Dispatch, SetStateAction } from "react";
import { CardGallery } from "../CardGallery";
import { CardRowInner } from "../CardRowInner";
import { CardTagsRow } from "../CardTagsRow";
import { useAppChrome } from "../i18n/useAppChrome";
import { useAppUiLang } from "../appUiLang";
import { NoteCardTiptap } from "../noteEditor/NoteCardTiptap";
import {
  formatCardReminderBesideTime,
  formatCardTimeLabel,
} from "../cardTimeLabel";
import type { TrashedNoteEntry } from "../types";

export type TrashNoteCardRowProps = {
  entry: TrashedNoteEntry;
  canEdit: boolean;
  cardMenuId: string | null;
  setCardMenuId: Dispatch<SetStateAction<string | null>>;
  restoreTrashedEntry: (entry: TrashedNoteEntry) => void;
  purgeTrashedEntry: (trashId: string) => void;
  timelineColumnCount: number;
};

export function TrashNoteCardRow(p: TrashNoteCardRowProps) {
  const {
    entry,
    canEdit,
    cardMenuId,
    setCardMenuId,
    restoreTrashedEntry,
    purgeTrashedEntry,
    timelineColumnCount,
  } = p;

  const { lang } = useAppUiLang();
  const c = useAppChrome();
  const card = entry.card;
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  const hasGallery = media.length > 0;
  const trashReminderBeside = formatCardReminderBesideTime(card, lang);
  const menuId = `__trash__${entry.trashId}`;
  return (
    <li
      data-masonry-key={entry.trashId}
      className={
        "card card--in-trash" +
        (cardMenuId === menuId ? " is-menu-open" : "")
      }
      title={
        entry.colPathLabel
          ? c.uiTrashFromCollection(entry.colPathLabel)
          : undefined
      }
    >
      <CardRowInner
        hasGallery={hasGallery}
        timelineColumnCount={timelineColumnCount}
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
              {formatCardTimeLabel(card, lang)}
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
                    aria-label={c.uiMoreActions}
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
                        {c.uiTrashRestore}
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
                        {c.uiTrashDeleteForever}
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
