import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { AuthUser } from "./api/auth";
import { resolveMediaUrl } from "./api/auth";
import {
  sendMyEmailChangeCode,
  updateMyProfileApi,
  uploadMyAvatar,
} from "./api/users";

type UserProfileModalProps = {
  open: boolean;
  onClose: () => void;
  currentUser: AuthUser;
  mediaUploadMode: "cos" | "local" | null;
  dataMode: "local" | "remote";
  onAfterSave: () => Promise<void>;
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
  onFlash,
  setSaving,
}: UserProfileModalProps) {
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
    if (fileRef.current) fileRef.current.value = "";
  }, [open, currentUser]);

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
      setErr("请先填写要绑定的新邮箱。");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("邮箱格式不正确。");
      return;
    }
    if (em.toLowerCase() === prevEmailNorm) {
      setErr("当前已是该邮箱，无需验证。");
      return;
    }
    setEmailSendBusy(true);
    try {
      await sendMyEmailChangeCode(em);
      setEmailSentHint("验证码已发至该邮箱，10 分钟内有效。");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "发送失败");
    } finally {
      setEmailSendBusy(false);
    }
  }, [email, prevEmailNorm]);

  const handleSubmit = useCallback(async () => {
    setErr(null);
    onFlash(null);
    if (dataMode !== "remote") {
      setErr("请先切换到云端后再保存到服务器。");
      return;
    }
    const nick = displayName.trim();
    if (!nick) {
      setErr("昵称不能为空。");
      return;
    }
    if (nick.length > 64) {
      setErr("昵称最长 64 字。");
      return;
    }
    const emailTrim = email.trim();
    if (emailTrim) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        setErr("邮箱格式不正确。");
        return;
      }
    }
    if (password || password2) {
      if (password !== password2) {
        setErr("两次输入的密码不一致。");
        return;
      }
      if (password.length < 4) {
        setErr("新密码至少 4 位。");
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
          setErr("更换邮箱须先点击「发送验证码」，并填写 6 位数字。");
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
      setErr("头像上传需配置服务器媒体存储。");
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
        await uploadMyAvatar(pendingFile);
      }
      await onAfterSave();
      onFlash("个人中心已保存～");
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "保存失败");
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
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const avatarSrc = previewUrl
    ? previewUrl
    : currentUser.avatarUrl
      ? resolveMediaUrl(currentUser.avatarUrl)
      : "";

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
          个人中心
        </h2>
        <p className="auth-modal__hint user-profile-modal__sub">
          登录名{" "}
          <span className="user-profile-modal__mono">
            {currentUser.username}
          </span>
          不可修改。绑定邮箱后可用邮箱登录。
        </p>

        <label className="user-profile-modal__label" htmlFor="profile-display">
          昵称
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
          邮箱
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
            placeholder="留空可解绑；换绑新邮箱需验证"
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
            {emailSendBusy ? "…" : "发送验证码"}
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
              新邮箱验证码
            </label>
            <input
              id="profile-email-code"
              type="text"
              inputMode="numeric"
              className="auth-modal__input"
              autoComplete="one-time-code"
              placeholder="6 位数字"
              value={emailCode}
              maxLength={6}
              onChange={(e) =>
                setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </>
        ) : null}

        <p className="user-profile-modal__label">头像</p>
        <div className="user-profile-modal__avatar-row">
          <div
            className="user-profile-modal__avatar-preview"
            aria-hidden={!avatarSrc}
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt="" />
            ) : (
              <span className="user-profile-modal__avatar-ph">无</span>
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
                  : "头像上传需配置服务器媒体存储"
              }
              onClick={() => fileRef.current?.click()}
            >
              选择图片
            </button>
            {pendingFile ? (
              <span className="user-profile-modal__file-name">
                {pendingFile.name}
              </span>
            ) : (
              <span className="user-profile-modal__file-hint">
                保存时上传；不选则保持原头像
              </span>
            )}
          </div>
        </div>

        <label className="user-profile-modal__label" htmlFor="profile-pwd">
          新密码（可选）
        </label>
        <input
          id="profile-pwd"
          type="password"
          className="auth-modal__input"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="不修改请留空"
        />
        <label
          className="user-profile-modal__label"
          htmlFor="profile-pwd2"
        >
          确认新密码
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

        <p className="user-profile-modal__legal">
          <a
            href={`${import.meta.env.BASE_URL}legal/terms.html`}
            target="_blank"
            rel="noopener noreferrer"
          >
            用户协议
          </a>
          <span className="user-profile-modal__legal-sep" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <a
            href={`${import.meta.env.BASE_URL}legal/privacy.html`}
            target="_blank"
            rel="noopener noreferrer"
          >
            隐私政策
          </a>
        </p>

        <div className="auth-modal__actions">
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--ghost"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary"
            onClick={() => void handleSubmit()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
