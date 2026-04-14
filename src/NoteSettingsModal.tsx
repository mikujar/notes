import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAppChrome } from "./i18n/useAppChrome";
import type { AppDataMode } from "./appDataModeStorage";
import type { NewNotePlacement } from "./newNotePlacementStorage";

type NoteSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  newNotePlacement: NewNotePlacement;
  setNewNotePlacement: (p: NewNotePlacement) => void;
  hideSidebarCollectionDots: boolean;
  setHideSidebarCollectionDots: (hide: boolean) => void;
  dataMode: AppDataMode;
  setDataMode: (mode: AppDataMode) => void;
  onOpenAppleNotesImport?: () => void;
  onOpenFlomoImport?: () => void;
  onOpenEvernoteImport?: () => void;
};

export function NoteSettingsModal({
  open,
  onClose,
  newNotePlacement,
  setNewNotePlacement,
  hideSidebarCollectionDots,
  setHideSidebarCollectionDots,
  dataMode,
  setDataMode,
  onOpenAppleNotesImport,
  onOpenFlomoImport,
  onOpenEvernoteImport,
}: NoteSettingsModalProps) {
  const c = useAppChrome();
  const [importSource, setImportSource] = useState<
    "" | "apple" | "flomo" | "evernote"
  >("");

  useEffect(() => {
    if (!open) setImportSource("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const panel = (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="auth-modal note-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="note-settings-title" className="auth-modal__title">
          {c.noteSettingsTitle}
        </h2>
        <p className="auth-modal__hint note-settings-modal__hint">
          {c.noteSettingsHint}
        </p>

        <p className="note-settings-modal__label">
          {c.noteSettingsPlacementLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsPlacementAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (newNotePlacement === "top"
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={newNotePlacement === "top"}
            onClick={() => setNewNotePlacement("top")}
          >
            {c.noteSettingsTop}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (newNotePlacement === "bottom"
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={newNotePlacement === "bottom"}
            onClick={() => setNewNotePlacement("bottom")}
          >
            {c.noteSettingsBottom}
          </button>
        </div>

        <p className="note-settings-modal__label">
          {c.noteSettingsSidebarDotsLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsSidebarDotsAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (!hideSidebarCollectionDots
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={!hideSidebarCollectionDots}
            onClick={() => setHideSidebarCollectionDots(false)}
          >
            {c.noteSettingsSidebarDotsShow}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (hideSidebarCollectionDots
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={hideSidebarCollectionDots}
            onClick={() => setHideSidebarCollectionDots(true)}
          >
            {c.noteSettingsSidebarDotsHide}
          </button>
        </div>

        <p className="note-settings-modal__label">
          {c.noteSettingsStorageLabel}
        </p>
        <div
          className="note-settings-modal__choice-row note-settings-modal__choice-row--stack"
          role="group"
          aria-label={c.noteSettingsStorageAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice note-settings-modal__choice--block" +
              (dataMode === "remote"
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={dataMode === "remote"}
            onClick={() => setDataMode("remote")}
          >
            {c.noteSettingsCloud}
          </button>
        </div>

        {onOpenAppleNotesImport || onOpenFlomoImport || onOpenEvernoteImport ? (
          <>
            <p className="note-settings-modal__label">
              {c.noteSettingsImportSectionLabel}
            </p>
            <select
              className="auth-modal__input note-settings-modal__import-select"
              aria-label={c.noteSettingsImportSourceAria}
              value={importSource}
              onChange={(e) => {
                const v = e.target.value as
                  | ""
                  | "apple"
                  | "flomo"
                  | "evernote";
                if (v === "apple" && onOpenAppleNotesImport) {
                  onOpenAppleNotesImport();
                } else if (v === "flomo" && onOpenFlomoImport) {
                  onOpenFlomoImport();
                } else if (v === "evernote" && onOpenEvernoteImport) {
                  onOpenEvernoteImport();
                }
                setImportSource("");
              }}
            >
              <option value="">{c.noteSettingsImportSourcePlaceholder}</option>
              {onOpenAppleNotesImport ? (
                <option value="apple">{c.noteSettingsImportSourceApple}</option>
              ) : null}
              {onOpenFlomoImport ? (
                <option value="flomo">{c.noteSettingsImportSourceFlomo}</option>
              ) : null}
              {onOpenEvernoteImport ? (
                <option value="evernote">
                  {c.noteSettingsImportSourceEvernote}
                </option>
              ) : null}
            </select>
          </>
        ) : null}

        <div className="auth-modal__actions">
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary auth-modal__btn--primary--full"
            onClick={onClose}
          >
            {c.done}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
