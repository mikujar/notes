import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { AuthUser } from "./api/auth";
import { useMediaDisplaySrc } from "./mediaDisplay";
import {
  deleteMyAccountApi,
  sendMyEmailChangeCode,
  updateMyProfileApi,
  uploadMyAvatar,
} from "./api/users";
import { useAppChrome } from "./i18n/useAppChrome";
import { useLegalPages } from "./legalPages";

type UserProfileModalProps = {
  open: boolean;
  onClose: () => void;
  currentUser: AuthUser;
  mediaUploadMode: "cos" | "local" | null;
  dataMode: "local" | "remote";
  onAfterSave: () => Promise<void>;
  /** 账号已从服务端删除后调用（用于登出、关弹窗） */
  onAccountDeleted?: () => void;
  onFlash: (message: string | null) => void;
  setSaving: (busy: boolean) => void;
};

export function UserProfileModal({
  open,
  onClose,
  currentUser,
  mediaUploadMode,
  dataMode,
  onAfterSave,
  onAccountDeleted,
  onFlash,
  setSaving,
}: UserProfileModalProps) {
  const c = useAppChrome();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailSendBusy, setEmailSendBusy] = useState(false);
  const [emailSentHint, setEmailSentHint] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** 头像上传 0–100，非上传中为 null */
  const [avatarUploadProgress, setAvatarUploadProgress] = useState<
    number | null
  >(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** 点击「删除账号」后才展示密码与确认 */
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const deletePwdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDisplayName(
      currentUser.displayName?.trim() || currentUser.username
    );
    setEmail((currentUser.email ?? "").trim());
    setEmailCode("");
    setEmailSentHint(null);
    setPassword("");
    setPassword2("");
    setPendingFile(null);
    setPreviewUrl(null);
    setErr(null);
    setAvatarUploadProgress(null);
    setDeletePassword("");
    setDeleteBusy(false);
    setDeleteConfirmOpen(false);
    setDeleteErr(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [open, currentUser]);

  useEffect(() => {
    if (!open || !deleteConfirmOpen) return;
    const t = window.setTimeout(() => deletePwdRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, deleteConfirmOpen]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const onPickFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setPendingFile(f);
      setPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });
    },
    []
  );

  const prevEmailNorm = (currentUser.email ?? "").trim().toLowerCase();

  const handleSendEmailCode = useCallback(async () => {
    setErr(null);
    setEmailSentHint(null);
    const em = email.trim();
    if (!em) {
      setErr(c.profileErrEmailEmpty);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr(c.profileErrEmailFmt2);
      return;
    }
    if (em.toLowerCase() === prevEmailNorm) {
      setErr(c.profileErrSameEmail);
      return;
    }
    setEmailSendBusy(true);
    try {
      await sendMyEmailChangeCode(em);
      setEmailSentHint(c.profileEmailSendOk);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : c.profileErrSendFail);
    } finally {
      setEmailSendBusy(false);
    }
  }, [c, email, prevEmailNorm]);

  const handleSubmit = useCallback(async () => {
    setErr(null);
    onFlash(null);
    if (dataMode !== "remote") {
      setErr(c.profileErrNeedRemote);
      return;
    }
    const nick = displayName.trim();
    if (!nick) {
      setErr(c.profileErrNickEmpty);
      return;
    }
    if (nick.length > 64) {
      setErr(c.profileErrNickLen);
      return;
    }
    const emailTrim = email.trim();
    if (emailTrim) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        setErr(c.profileErrEmailFmt);
        return;
      }
    }
    if (password || password2) {
      if (password !== password2) {
        setErr(c.profileErrPwdMismatch);
        return;
      }
      if (password.length < 4) {
        setErr(c.profileErrPwdLen);
        return;
      }
    }

    const patch: {
      displayName?: string;
      password?: string;
      email?: string | null;
      emailCode?: string;
    } = {};
    if (nick !== (currentUser.displayName || "").trim()) {
      patch.displayName = nick;
    }
    const prevEmail = (currentUser.email ?? "").trim();
    const changingToNewEmail =
      Boolean(emailTrim) && emailTrim.toLowerCase() !== prevEmailNorm;
    if (emailTrim !== prevEmail) {
      if (changingToNewEmail) {
        if (!/^\d{6}$/.test(emailCode.trim())) {
          setErr(c.profileErrNeedVerify);
          return;
        }
        patch.email = emailTrim;
        patch.emailCode = emailCode.trim();
      } else {
        patch.email = emailTrim || null;
      }
    }
    if (password) patch.password = password;

    if (pendingFile && !mediaUploadMode) {
      setErr(c.profileErrAvatarCos);
      return;
    }

    if (Object.keys(patch).length === 0 && !pendingFile) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      if (Object.keys(patch).length > 0) {
        await updateMyProfileApi(patch);
      }
      if (pendingFile) {
        setAvatarUploadProgress(0);
        try {
          await uploadMyAvatar(pendingFile, {
            onProgress: (p) => setAvatarUploadProgress(p),
          });
        } finally {
          setAvatarUploadProgress(null);
        }
      }
      await onAfterSave();
      onFlash(c.profileFlashSaved);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : c.profileErrSaveFail);
    } finally {
      setSaving(false);
    }
  }, [
    currentUser.displayName,
    currentUser.email,
    dataMode,
    displayName,
    email,
    emailCode,
    mediaUploadMode,
    prevEmailNorm,
    onAfterSave,
    onClose,
    onFlash,
    password,
    password2,
    pendingFile,
    setSaving,
    c,
  ]);

  const serverAvatarSrc = useMediaDisplaySrc(
    previewUrl ? undefined : currentUser.avatarUrl
  );

  const { openTerms, openPrivacy } = useLegalPages();

  const handleDeleteAccount = useCallback(async () => {
    setDeleteErr(null);
    if (dataMode !== "remote") {
      setDeleteErr(c.profileErrDeleteNeedRemote);
      return;
    }
    const pwd = deletePassword.trim();
    if (!pwd) {
      setDeleteErr(c.profileErrDeletePwd);
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteMyAccountApi(pwd);
      onClose();
      onAccountDeleted?.();
    } catch (e: unknown) {
      setDeleteErr(e instanceof Error ? e.message : c.profileErrDeleteFail);
    } finally {
      setDeleteBusy(false);
    }
  }, [c, dataMode, deletePassword, onAccountDeleted, onClose]);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirmOpen(false);
    setDeleteErr(null);
    setDeletePassword("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (deleteConfirmOpen) {
        e.stopPropagation();
        closeDeleteConfirm();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, deleteConfirmOpen, closeDeleteConfirm]);

  if (!open) return null;

  const avatarSrc = previewUrl ? previewUrl : serverAvatarSrc;

  const panel = (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="auth-modal user-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="user-profile-title" className="auth-modal__title">
          {c.profileTitle}
        </h2>
        <p className="auth-modal__hint user-profile-modal__sub">
          {c.profileBeforeUsername}{" "}
          <span className="user-profile-modal__mono">
            {currentUser.username}
          </span>
          {c.profileAfterUsername}
        </p>

        <label className="user-profile-modal__label" htmlFor="profile-display">
          {c.profileNickname}
        </label>
        <input
          id="profile-display"
          type="text"
          className="auth-modal__input"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={64}
        />

        <label className="user-profile-modal__label" htmlFor="profile-email">
          {c.profileEmail}
        </label>
        <div className="user-profile-modal__email-row">
          <input
            id="profile-email"
            type="email"
            className="auth-modal__input user-profile-modal__email-input"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailCode("");
              setEmailSentHint(null);
            }}
            placeholder={c.profileEmailPlaceholder}
          />
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--ghost user-profile-modal__send-code-btn"
            disabled={
              emailSendBusy ||
              dataMode !== "remote" ||
              !email.trim() ||
              email.trim().toLowerCase() === prevEmailNorm ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
            }
            onClick={() => void handleSendEmailCode()}
          >
            {emailSendBusy ? "…" : c.profileSendCode}
          </button>
        </div>
        {emailSentHint ? (
          <p className="user-profile-modal__email-hint">{emailSentHint}</p>
        ) : null}
        {email.trim() &&
        email.trim().toLowerCase() !== prevEmailNorm &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? (
          <>
            <label
              className="user-profile-modal__label"
              htmlFor="profile-email-code"
            >
              {c.profileNewEmailCode}
            </label>
            <input
              id="profile-email-code"
              type="text"
              inputMode="numeric"
              className="auth-modal__input"
              autoComplete="one-time-code"
              placeholder={c.profileEmailCodePh}
              value={emailCode}
              maxLength={6}
              onChange={(e) =>
                setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </>
        ) : null}

        <p className="user-profile-modal__label">{c.profileAvatar}</p>
        <div className="user-profile-modal__avatar-row">
          <div
            className="user-profile-modal__avatar-preview"
            aria-hidden={!avatarSrc}
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt="" />
            ) : (
              <span className="user-profile-modal__avatar-ph">
                {c.profileNoAvatar}
              </span>
            )}
          </div>
          <div className="user-profile-modal__avatar-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="app__hidden-file-input"
              aria-hidden
              tabIndex={-1}
              disabled={!mediaUploadMode}
              onChange={onPickFile}
            />
            <button
              type="button"
              className="auth-modal__btn auth-modal__btn--ghost user-profile-modal__file-btn"
              disabled={!mediaUploadMode}
              title={
                mediaUploadMode
                  ? undefined
                  : c.profileAvatarDisabledTitle
              }
              onClick={() => fileRef.current?.click()}
            >
              {c.profileChooseImage}
            </button>
            {pendingFile ? (
              <span className="user-profile-modal__file-name">
                {pendingFile.name}
              </span>
            ) : (
              <span className="user-profile-modal__file-hint">
                {c.profileAvatarPendingHint}
              </span>
            )}
          </div>
        </div>
        {avatarUploadProgress != null ? (
          <div className="user-profile-modal__upload-row">
            <div
              className="user-profile-modal__upload-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(
                Math.max(0, Math.min(100, avatarUploadProgress))
              )}
            >
              <div
                className="user-profile-modal__upload-progress-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, avatarUploadProgress))}%`,
                }}
              />
            </div>
            <span className="user-profile-modal__upload-pct">
              {Math.round(Math.max(0, Math.min(100, avatarUploadProgress)))}%
            </span>
          </div>
        ) : null}

        <label className="user-profile-modal__label" htmlFor="profile-pwd">
          {c.profileNewPassword}
        </label>
        <input
          id="profile-pwd"
          type="password"
          className="auth-modal__input"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={c.profilePwdPlaceholder}
        />
        <label
          className="user-profile-modal__label"
          htmlFor="profile-pwd2"
        >
          {c.profileConfirmPassword}
        </label>
        <input
          id="profile-pwd2"
          type="password"
          className="auth-modal__input"
          autoComplete="new-password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />

        {err ? <p className="auth-modal__err">{err}</p> : null}

        <div className="user-profile-modal__danger-zone" aria-labelledby="profile-delete-heading">
          <h3 id="profile-delete-heading" className="user-profile-modal__danger-title">
            {c.profileDeleteAccount}
          </h3>
          {!deleteConfirmOpen ? (
            <>
              <p className="user-profile-modal__danger-hint user-profile-modal__danger-hint--entry">
                {c.profileDeleteEntryLead}
              </p>
              <button
                type="button"
                className="auth-modal__btn user-profile-modal__delete-entry"
                disabled={dataMode !== "remote"}
                title={
                  dataMode !== "remote" ? c.profileErrDeleteNeedRemote : undefined
                }
                onClick={() => {
                  setDeleteConfirmOpen(true);
                  setDeleteErr(null);
                  setDeletePassword("");
                }}
              >
                {c.profileDeleteAccount}
              </button>
            </>
          ) : (
            <>
              <p className="user-profile-modal__danger-hint">{c.profileDeleteHint}</p>
              {deleteErr ? (
                <p className="auth-modal__err user-profile-modal__delete-err" role="alert">
                  {deleteErr}
                </p>
              ) : null}
              <label className="user-profile-modal__label" htmlFor="profile-delete-pwd">
                {c.profileDeletePasswordLabel}
              </label>
              <input
                ref={deletePwdRef}
                id="profile-delete-pwd"
                type="password"
                className="auth-modal__input"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder={c.profileDeletePasswordPlaceholder}
                disabled={dataMode !== "remote" || deleteBusy}
              />
              <div className="user-profile-modal__delete-actions">
                <button
                  type="button"
                  className="auth-modal__btn auth-modal__btn--ghost"
                  disabled={deleteBusy}
                  onClick={closeDeleteConfirm}
                >
                  {c.profileDeleteBack}
                </button>
                <button
                  type="button"
                  className="auth-modal__btn user-profile-modal__delete-btn"
                  disabled={dataMode !== "remote" || deleteBusy}
                  onClick={() => void handleDeleteAccount()}
                >
                  {deleteBusy ? c.profileDeleting : c.profileDeleteConfirm}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="user-profile-modal__footer">
          <p className="user-profile-modal__legal user-profile-modal__legal--footer">
            <button
              type="button"
              className="user-profile-modal__legal-btn"
              onClick={openTerms}
            >
              {c.profileTermsOfService}
            </button>
            <span className="user-profile-modal__legal-sep" aria-hidden>
              {" "}
              ·{" "}
            </span>
            <button
              type="button"
              className="user-profile-modal__legal-btn"
              onClick={openPrivacy}
            >
              {c.profilePrivacyPolicy}
            </button>
          </p>
          <div className="auth-modal__actions">
            <button
              type="button"
              className="auth-modal__btn auth-modal__btn--ghost"
              onClick={onClose}
            >
              {c.profileCancel}
            </button>
            <button
              type="button"
              className="auth-modal__btn auth-modal__btn--primary"
              onClick={() => void handleSubmit()}
            >
              {c.profileSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
