import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import { useAppChrome } from "./i18n/useAppChrome";
import type { ParsedExportNote } from "./import/parseAppleNotesExport";
import {
  parseAppleNotesExportDirectory,
  parseAppleNotesExportLooseTextFiles,
} from "./import/parseAppleNotesExport";

type AppleNotesImportModalProps = {
  open: boolean;
  onClose: () => void;
  targetCollectionLabel: string;
  canImport: boolean;
  blockedHint?: string;
  onRunImport: (notes: ParsedExportNote[]) => Promise<number>;
};

export function AppleNotesImportModal({
  open,
  onClose,
  targetCollectionLabel,
  canImport,
  blockedHint,
  onRunImport,
}: AppleNotesImportModalProps) {
  const c = useAppChrome();
  const dirInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedExportNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !parsing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, parsing, onClose]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setStatus(null);
      setBusy(false);
      setParsing(false);
    }
  }, [open]);

  const onDirChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      // Snapshot before clearing: `FileList` is live; `value = ""` empties it.
      const files = e.target.files?.length
        ? Array.from(e.target.files)
        : [];
      e.target.value = "";
      if (files.length === 0) return;
      setParsing(true);
      setPreview(null);
      setStatus(null);
      try {
        const parsed = await parseAppleNotesExportDirectory(files);
        setPreview(parsed);
        if (parsed.length === 0) {
          setStatus(c.importAppleNotesErrNone);
        }
      } catch {
        setStatus(c.importAppleNotesParseErr);
      } finally {
        setParsing(false);
      }
    },
    [c.importAppleNotesErrNone, c.importAppleNotesParseErr]
  );

  const onZipChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const z = input.files?.[0] ?? null;
      input.value = "";
      if (!z) return;
      setParsing(true);
      setPreview(null);
      setStatus(null);
      try {
        const { filesFromZipExport } = await import(
          "./import/filesFromZipExport"
        );
        const virtualFiles = await filesFromZipExport(z);
        const parsed = await parseAppleNotesExportDirectory(virtualFiles);
        setPreview(parsed);
        if (parsed.length === 0) {
          setStatus(c.importAppleNotesErrNone);
        }
      } catch {
        setStatus(c.importAppleNotesParseErr);
      } finally {
        setParsing(false);
      }
    },
    [c.importAppleNotesErrNone, c.importAppleNotesParseErr]
  );

  const onLooseChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files?.length
        ? Array.from(e.target.files)
        : [];
      e.target.value = "";
      if (files.length === 0) return;
      setParsing(true);
      setPreview(null);
      setStatus(null);
      try {
        const parsed = await parseAppleNotesExportLooseTextFiles(files);
        setPreview(parsed);
        if (parsed.length === 0) {
          setStatus(c.importAppleNotesErrNone);
        }
      } catch {
        setStatus(c.importAppleNotesParseErr);
      } finally {
        setParsing(false);
      }
    },
    [c.importAppleNotesErrNone, c.importAppleNotesParseErr]
  );

  const run = useCallback(async () => {
    if (!preview?.length || !canImport || busy || parsing) return;
    setBusy(true);
    setStatus(c.importAppleNotesImporting);
    try {
      const n = await onRunImport(preview);
      setStatus(c.importAppleNotesDone(n));
      setPreview(null);
    } catch {
      setStatus(c.importAppleNotesRunErr);
    } finally {
      setBusy(false);
    }
  }, [
    preview,
    canImport,
    busy,
    parsing,
    onRunImport,
    c.importAppleNotesImporting,
    c.importAppleNotesDone,
    c.importAppleNotesRunErr,
  ]);

  if (!open) return null;

  const panel = (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={() => !busy && !parsing && onClose()}
    >
      <div
        className="auth-modal note-settings-modal apple-notes-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apple-notes-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="apple-notes-import-title" className="auth-modal__title">
          {c.importAppleNotesTitle}
        </h2>
        <p className="auth-modal__hint apple-notes-import-modal__hint">
          {c.importAppleNotesHint}
        </p>
        <p className="note-settings-modal__label">
          {c.importAppleNotesTargetLabel(targetCollectionLabel)}
        </p>
        {!canImport && blockedHint ? (
          <p className="auth-modal__err apple-notes-import-modal__blocked">
            {blockedHint}
          </p>
        ) : null}

        <input
          ref={dirInputRef}
          type="file"
          className="app__hidden-file-input"
          multiple
          {...({ webkitdirectory: "" } as Record<string, unknown>)}
          onChange={onDirChange}
          aria-hidden
          tabIndex={-1}
        />
        <input
          ref={zipInputRef}
          type="file"
          className="app__hidden-file-input"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={onZipChange}
          aria-hidden
          tabIndex={-1}
        />
        <input
          ref={filesInputRef}
          type="file"
          className="app__hidden-file-input"
          multiple
          accept=".md,.markdown,.txt,.html,.htm,text/plain,text/html"
          onChange={onLooseChange}
          aria-hidden
          tabIndex={-1}
        />

        <div className="apple-notes-import-modal__actions">
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary auth-modal__btn--primary--full"
            disabled={busy || parsing}
            onClick={() => zipInputRef.current?.click()}
          >
            {c.importAppleNotesPickZip}
          </button>
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary auth-modal__btn--primary--full"
            disabled={busy || parsing}
            onClick={() => dirInputRef.current?.click()}
          >
            {c.importAppleNotesPickFolder}
          </button>
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary auth-modal__btn--primary--full"
            disabled={busy || parsing}
            onClick={() => filesInputRef.current?.click()}
          >
            {c.importAppleNotesPickTextFiles}
          </button>
        </div>

        {parsing ? (
          <p
            className="apple-notes-import-modal__parsing"
            role="status"
            aria-live="polite"
          >
            {c.importAppleNotesParsing}
          </p>
        ) : null}
        {!parsing && preview && preview.length > 0 ? (
          <p className="apple-notes-import-modal__preview" role="status">
            {c.importAppleNotesPreview(preview.length)}
          </p>
        ) : null}
        {!parsing && status ? (
          <p className="apple-notes-import-modal__status" role="status">
            {status}
          </p>
        ) : null}

        <div className="auth-modal__actions">
          <button
            type="button"
            className="auth-modal__btn"
            disabled={busy || parsing}
            onClick={onClose}
          >
            {c.done}
          </button>
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary"
            disabled={
              busy || parsing || !canImport || !preview?.length
            }
            onClick={() => void run()}
          >
            {c.importAppleNotesImportBtn}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
