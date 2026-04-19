import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAppChrome } from "./i18n/useAppChrome";
import { useAppUiLang } from "./appUiLang";
import type { AppDataMode } from "./appDataModeStorage";
import type { NewNotePlacement } from "./newNotePlacementStorage";
import {
  PRESET_OBJECT_TYPES_GROUPS,
  PRESET_OBJECT_TYPES_RECOMMENDED,
  presetTypeGroupCards,
  type PresetObjectTypeItem,
} from "./notePresetTypesCatalog";

type NoteSettingsPanel = "general" | "objectTypes";

type NoteSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  newNotePlacement: NewNotePlacement;
  setNewNotePlacement: (p: NewNotePlacement) => void;
  hideSidebarCollectionDots: boolean;
  setHideSidebarCollectionDots: (hide: boolean) => void;
  timelineFoldBodyThreeLines: boolean;
  setTimelineFoldBodyThreeLines: (on: boolean) => void;
  dataMode: AppDataMode;
  setDataMode: (mode: AppDataMode) => void;
  onOpenAppleNotesImport?: () => void;
  onOpenFlomoImport?: () => void;
  onOpenEvernoteImport?: () => void;
  onOpenYuqueImport?: () => void;
};

function PresetTypeCard({
  item,
  label,
}: {
  item: PresetObjectTypeItem;
  label: string;
}) {
  const c = useAppChrome();
  return (
    <div
      className="note-settings-modal__preset-card"
      role="presentation"
      title={label}
    >
      <div
        className="note-settings-modal__preset-icon"
        style={{ background: item.tint }}
        aria-hidden
      >
        <span className="note-settings-modal__preset-emoji">{item.emoji}</span>
      </div>
      <span className="note-settings-modal__preset-name">{label}</span>
      <span className="note-settings-modal__preset-badge">{c.noteSettingsPresetComingSoon}</span>
    </div>
  );
}

export function NoteSettingsModal({
  open,
  onClose,
  newNotePlacement,
  setNewNotePlacement,
  hideSidebarCollectionDots,
  setHideSidebarCollectionDots,
  timelineFoldBodyThreeLines,
  setTimelineFoldBodyThreeLines,
  dataMode,
  setDataMode,
  onOpenAppleNotesImport,
  onOpenFlomoImport,
  onOpenEvernoteImport,
  onOpenYuqueImport,
}: NoteSettingsModalProps) {
  const c = useAppChrome();
  const { lang } = useAppUiLang();
  const [importSource, setImportSource] = useState<
    "" | "apple" | "flomo" | "evernote" | "yuque"
  >("");
  const [settingsPanel, setSettingsPanel] = useState<NoteSettingsPanel>(
    "general"
  );

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

  useEffect(() => {
    if (open) setSettingsPanel("general");
  }, [open]);

  if (!open) return null;

  const presetLabel = (item: PresetObjectTypeItem) =>
    lang === "en" ? item.nameEn : item.nameZh;

  const panelContent =
    settingsPanel === "general" ? (
      <div className="note-settings-modal__panel-scroll">
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
          {c.noteSettingsFoldLabel}
        </p>
        <div
          className="note-settings-modal__choice-row"
          role="group"
          aria-label={c.noteSettingsFoldAria}
        >
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (!timelineFoldBodyThreeLines
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={!timelineFoldBodyThreeLines}
            onClick={() => setTimelineFoldBodyThreeLines(false)}
          >
            {c.noteSettingsFoldOff}
          </button>
          <button
            type="button"
            className={
              "note-settings-modal__choice" +
              (timelineFoldBodyThreeLines
                ? " note-settings-modal__choice--active"
                : "")
            }
            aria-pressed={timelineFoldBodyThreeLines}
            onClick={() => setTimelineFoldBodyThreeLines(true)}
          >
            {c.noteSettingsFoldOn}
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

        {onOpenAppleNotesImport ||
        onOpenFlomoImport ||
        onOpenEvernoteImport ||
        onOpenYuqueImport ? (
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
                  | "evernote"
                  | "yuque";
                if (v === "apple" && onOpenAppleNotesImport) {
                  onOpenAppleNotesImport();
                } else if (v === "flomo" && onOpenFlomoImport) {
                  onOpenFlomoImport();
                } else if (v === "evernote" && onOpenEvernoteImport) {
                  onOpenEvernoteImport();
                } else if (v === "yuque" && onOpenYuqueImport) {
                  onOpenYuqueImport();
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
              {onOpenYuqueImport ? (
                <option value="yuque">{c.noteSettingsImportSourceYuque}</option>
              ) : null}
            </select>
          </>
        ) : null}
      </div>
    ) : (
      <div className="note-settings-modal__panel-scroll">
        <p className="note-settings-modal__object-types-lead">
          {c.noteSettingsObjectTypesLead}
        </p>

        <p className="note-settings-modal__preset-subhead note-settings-modal__preset-subhead--tier">
          {c.noteSettingsObjectTypesSectionTypes}
        </p>
        <div
          className="note-settings-modal__type-stack"
          aria-label={c.noteSettingsObjectTypesSectionTypes}
        >
          {PRESET_OBJECT_TYPES_GROUPS.map((group) => (
            <section
              key={group.baseId}
              className="note-settings-modal__type-group"
              aria-labelledby={`note-settings-type-${group.baseId}`}
            >
              <h4
                id={`note-settings-type-${group.baseId}`}
                className="note-settings-modal__preset-subhead note-settings-modal__preset-subhead--type-parent"
              >
                {lang === "en" ? group.baseLabelEn : group.baseLabelZh}
              </h4>
              <div
                className="note-settings-modal__preset-grid"
                role="list"
                aria-label={
                  lang === "en"
                    ? `${group.baseLabelEn} — subtypes`
                    : `${group.baseLabelZh} — 子类型`
                }
              >
                {presetTypeGroupCards(group).map((item) => (
                  <div key={item.id} role="listitem">
                    <PresetTypeCard item={item} label={presetLabel(item)} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="note-settings-modal__preset-subhead note-settings-modal__preset-subhead--tier">
          {c.noteSettingsObjectTypesTierRecommended}
        </p>
        <div
          className="note-settings-modal__preset-grid"
          role="list"
          aria-label={c.noteSettingsObjectTypesTierRecommended}
        >
          {PRESET_OBJECT_TYPES_RECOMMENDED.map((row) => {
            if (row.kind === "subhead") {
              return (
                <p
                  key={`sub-${row.id}`}
                  className="note-settings-modal__preset-subhead note-settings-modal__preset-subhead--span"
                >
                  {lang === "en" ? row.nameEn : row.nameZh}
                </p>
              );
            }
            const { kind: _k, ...item } = row;
            return (
              <div key={item.id} role="listitem">
                <PresetTypeCard item={item} label={presetLabel(item)} />
              </div>
            );
          })}
        </div>
      </div>
    );

  const modalTree = (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="auth-modal note-settings-modal note-settings-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="note-settings-modal__shell">
          <nav
            className="note-settings-modal__nav"
            aria-label={c.noteSettingsTitle}
          >
            <p className="note-settings-modal__nav-title" id="note-settings-title">
              {c.noteSettingsTitle}
            </p>
            <button
              type="button"
              className={
                "note-settings-modal__nav-item" +
                (settingsPanel === "general" ? " is-active" : "")
              }
              aria-current={settingsPanel === "general" ? "page" : undefined}
              onClick={() => setSettingsPanel("general")}
            >
              {c.noteSettingsNavGeneral}
            </button>
            <button
              type="button"
              className={
                "note-settings-modal__nav-item" +
                (settingsPanel === "objectTypes" ? " is-active" : "")
              }
              aria-current={
                settingsPanel === "objectTypes" ? "page" : undefined
              }
              onClick={() => setSettingsPanel("objectTypes")}
            >
              {c.noteSettingsNavObjectTypes}
            </button>
          </nav>
          <div className="note-settings-modal__main">
            {settingsPanel === "objectTypes" ? (
              <h3 className="note-settings-modal__content-title">
                {c.noteSettingsObjectTypesTitle}
              </h3>
            ) : null}
            {panelContent}
            <div className="note-settings-modal__footer-actions">
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
      </div>
    </div>
  );

  return createPortal(modalTree, document.body);
}
