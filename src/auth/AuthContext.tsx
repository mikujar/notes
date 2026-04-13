import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchAuthMeWithRetry,
  fetchAuthStatus,
  loginWithCredentials,
  logoutRemoteSession,
  registerWithEmail,
  sendRegisterCode,
  type AuthUser,
} from "../api/auth";
import { useLegalPages } from "../legalPages";
import { loginUiT } from "./loginUiI18n";
import { useAppUiLang } from "../appUiLang";
import { getAppDataMode } from "../appDataModeStorage";
import {
  authUsesHttpOnlyCookie,
  clearAdminToken,
  getAdminToken,
  setAdminToken,
} from "./token";

type AuthContextValue = {
  authReady: boolean;
  writeRequiresLogin: boolean;
  /** 可编辑笔记、上传附件、管理用户 */
  isAdmin: boolean;
  /** 已登录用户信息（未启用登录或脚本模式时可能为 null） */
  currentUser: AuthUser | null;
  login: (
    username: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  openLogin: () => void;
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
  /** 登录成功后刷新 /me（改头像后调用） */
  refreshMe: () => Promise<void>;
  /**
   * 浏览器 + 云端 + 要求登录且未带 JWT：须先登录，主应用不渲染（仅登录框）
   */
  loginWallBlocking: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type LoginPanel = "login" | "register";

function LoginModal({
  onClose,
  onLogin,
  onRegister,
  blockingWall,
}: {
  onClose: () => void;
  onLogin: (
    username: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (
    email: string,
    code: string,
    password: string,
    displayName: string
  ) => Promise<{ ok: boolean; error?: string }>;
  /** 为 true 时不可点遮罩关闭、无「稍后再说」、Esc 不关闭 */
  blockingWall: boolean;
}) {
  const [panel, setPanel] = useState<LoginPanel>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regCode, setRegCode] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [error, setError] = useState("");
  /** 发验证码成功后的提示（成功时 error 为空，否则用户会感觉「没反应」） */
  const [sendSuccessHint, setSendSuccessHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const { lang: uiLang, setLang: setUiLang } = useAppUiLang();
  const t = useMemo(() => loginUiT(uiLang), [uiLang]);

  useEffect(() => {
    if (blockingWall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, blockingWall]);

  const submitLogin = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await onLogin(username.trim(), password);
      if (!r.ok) setError(r.error ?? t.errLoginDefault);
      else {
        setPassword("");
        setUsername("");
      }
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setError("");
    setSendSuccessHint("");
    const em = regEmail.trim();
    if (!em) {
      setError(t.errEnterEmail);
      return;
    }
    setSendBusy(true);
    try {
      const r = await sendRegisterCode(em);
      if (!r.ok) {
        setError(r.error);
      } else {
        setError("");
        setSendSuccessHint(t.sendCodeOk);
      }
    } finally {
      setSendBusy(false);
    }
  };

  const submitRegister = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await onRegister(
        regEmail.trim(),
        regCode.trim(),
        regPassword,
        regDisplayName.trim()
      );
      if (!r.ok) setError(r.error ?? t.errRegisterDefault);
      else {
        setRegEmail("");
        setRegCode("");
        setRegPassword("");
        setRegDisplayName("");
      }
    } finally {
      setBusy(false);
    }
  };

  const { openTerms, openPrivacy } = useLegalPages();

  return (
    <div
      className="auth-modal-backdrop auth-modal-backdrop--login"
      role="presentation"
    >
      <div
        className="auth-modal-backdrop__login-body"
        onClick={blockingWall ? undefined : onClose}
      >
        <div
          className="auth-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-brand-name"
          lang={uiLang === "en" ? "en" : "zh-CN"}
          onClick={(e) => e.stopPropagation()}
        >
        <div className="auth-modal__head-row">
          <div className="auth-modal__brand">
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt=""
              width={48}
              height={48}
              className="auth-modal__brand-logo"
              draggable={false}
            />
            <div className="auth-modal__brand-text">
              <span
                id="auth-modal-brand-name"
                className="auth-modal__brand-title"
              >
                未来罐
              </span>
              <span className="auth-modal__brand-slug">mikujar</span>
            </div>
          </div>
          <div
            className="auth-modal__lang"
            role="group"
            aria-label={t.langSwitchAria}
          >
            <button
              type="button"
              className={
                "auth-modal__lang-btn" +
                (uiLang === "zh" ? " auth-modal__lang-btn--active" : "")
              }
              aria-pressed={uiLang === "zh"}
              onClick={() => setUiLang("zh")}
            >
              中
            </button>
            <button
              type="button"
              className={
                "auth-modal__lang-btn" +
                (uiLang === "en" ? " auth-modal__lang-btn--active" : "")
              }
              aria-pressed={uiLang === "en"}
              onClick={() => setUiLang("en")}
            >
              EN
            </button>
          </div>
        </div>
        {panel === "login" ? (
          <>
            <h2 className="auth-modal__title">{t.loginTitle}</h2>
            <p className="auth-modal__hint">{t.loginHint}</p>
            <input
              type="text"
              className="auth-modal__input"
              autoComplete="username"
              placeholder={t.phUser}
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitLogin();
              }}
            />
            <input
              type="password"
              className="auth-modal__input"
              autoComplete="current-password"
              placeholder={t.phPassword}
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitLogin();
              }}
            />
          </>
        ) : (
          <>
            <h2 className="auth-modal__title">{t.registerTitle}</h2>
            <p className="auth-modal__hint">{t.registerHint}</p>
            <div className="auth-modal__input-row">
              <input
                type="email"
                className="auth-modal__input"
                autoComplete="email"
                placeholder={t.phEmail}
                value={regEmail}
                disabled={busy || sendBusy}
                onChange={(e) => {
                  setRegEmail(e.target.value);
                  setSendSuccessHint("");
                }}
              />
              <button
                type="button"
                className="auth-modal__btn auth-modal__btn--ghost"
                disabled={busy || sendBusy || !regEmail.trim()}
                onClick={() => void sendCode()}
              >
                {sendBusy ? "…" : t.sendCode}
              </button>
            </div>
            <input
              type="text"
              inputMode="numeric"
              className="auth-modal__input"
              autoComplete="one-time-code"
              placeholder={t.phCode}
              value={regCode}
              disabled={busy}
              onChange={(e) => setRegCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitRegister();
              }}
            />
            <input
              type="password"
              className="auth-modal__input"
              autoComplete="new-password"
              placeholder={t.phRegPassword}
              value={regPassword}
              disabled={busy}
              onChange={(e) => setRegPassword(e.target.value)}
            />
            <input
              type="text"
              className="auth-modal__input"
              autoComplete="nickname"
              placeholder={t.phNickname}
              value={regDisplayName}
              disabled={busy}
              onChange={(e) => setRegDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitRegister();
              }}
            />
          </>
        )}
        {error ? (
          <p className="auth-modal__err" role="alert">
            {error}
          </p>
        ) : null}
        {panel === "register" && sendSuccessHint && !error ? (
          <p className="auth-modal__ok" role="status" aria-live="polite">
            {sendSuccessHint}
          </p>
        ) : null}
        {panel === "register" ? (
          <p className="auth-modal__consent">
            {t.consentBefore}
            <button
              type="button"
              className="auth-modal__consent-link"
              onClick={openTerms}
            >
              {t.termsLink}
            </button>
            {t.consentBetween}
            <button
              type="button"
              className="auth-modal__consent-link"
              onClick={openPrivacy}
            >
              {t.privacyLink}
            </button>
          </p>
        ) : null}
        <div className="auth-modal__actions">
          {blockingWall ? null : (
            <button
              type="button"
              className="auth-modal__btn auth-modal__btn--ghost"
              onClick={onClose}
              disabled={busy || sendBusy}
            >
              {t.later}
            </button>
          )}
          {panel === "login" ? (
            <button
              type="button"
              className={
                "auth-modal__btn auth-modal__btn--primary" +
                (blockingWall ? " auth-modal__btn--primary--full" : "")
              }
              onClick={() => void submitLogin()}
              disabled={busy || !username.trim() || !password}
            >
              {busy ? "…" : t.loginSubmit}
            </button>
          ) : (
            <button
              type="button"
              className={
                "auth-modal__btn auth-modal__btn--primary" +
                (blockingWall ? " auth-modal__btn--primary--full" : "")
              }
              onClick={() => void submitRegister()}
              disabled={
                busy ||
                !regEmail.trim() ||
                regCode.trim().length !== 6 ||
                regPassword.length < 6
              }
            >
              {busy ? "…" : t.registerSubmit}
            </button>
          )}
        </div>
        <p className="auth-modal__sub">
          {panel === "login" ? (
            <>
              {t.subNoAccount}{" "}
              <button
                type="button"
                className="auth-modal__link"
                disabled={busy || sendBusy}
                onClick={() => {
                  setPanel("register");
                  setError("");
                  setSendSuccessHint("");
                }}
              >
                {t.linkRegister}
              </button>
            </>
          ) : (
            <>
              {t.subHasAccount}{" "}
              <button
                type="button"
                className="auth-modal__link"
                disabled={busy || sendBusy}
                onClick={() => {
                  setPanel("login");
                  setError("");
                  setSendSuccessHint("");
                }}
              >
                {t.linkLogin}
              </button>
            </>
          )}
        </p>
        </div>
      </div>
      <footer
        className="auth-modal-backdrop__legal"
        role="contentinfo"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="auth-modal-backdrop__legal-btn"
          onClick={openTerms}
        >
          {t.footerTerms}
        </button>
        <span className="auth-modal-backdrop__legal-sep" aria-hidden>
          {" "}
          ·{" "}
        </span>
        <button
          type="button"
          className="auth-modal-backdrop__legal-btn"
          onClick={openPrivacy}
        >
          {t.footerPrivacy}
        </button>
      </footer>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [writeRequiresLogin, setWriteRequiresLogin] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!writeRequiresLogin) return;
    const me = await fetchAuthMeWithRetry();
    if (me.ok && me.user) {
      setCurrentUser(me.user);
      setIsAdmin(me.admin);
    } else if (me.sessionInvalid) {
      clearAdminToken();
      setCurrentUser(null);
      setIsAdmin(false);
    }
  }, [writeRequiresLogin]);

  const refreshSession = useCallback(async () => {
    if (getAppDataMode() === "local") {
      setWriteRequiresLogin(false);
      const token = getAdminToken();
      if (token) {
        const me = await fetchAuthMeWithRetry();
        if (me.ok && me.user) {
          setCurrentUser(me.user);
          setIsAdmin(me.admin);
        } else {
          if (me.sessionInvalid) clearAdminToken();
          setCurrentUser(null);
          setIsAdmin(false);
        }
      } else {
        setCurrentUser(null);
        setIsAdmin(false);
      }
      setAuthReady(true);
      return;
    }

    const status = await fetchAuthStatus();
    setWriteRequiresLogin(status.writeRequiresLogin);
    if (!status.writeRequiresLogin) {
      setIsAdmin(true);
      setCurrentUser(null);
      setAuthReady(true);
      return;
    }
    const token = getAdminToken();
    if (!token && !authUsesHttpOnlyCookie()) {
      setIsAdmin(false);
      setCurrentUser(null);
      setAuthReady(true);
      return;
    }
    const me = await fetchAuthMeWithRetry();
    if (me.ok && me.user) {
      setCurrentUser(me.user);
      setIsAdmin(me.admin);
    } else {
      if (me.sessionInvalid) clearAdminToken();
      setCurrentUser(null);
      setIsAdmin(false);
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const applyAuthSuccess = useCallback((token: string, user: AuthUser) => {
    if (authUsesHttpOnlyCookie()) {
      clearAdminToken();
    } else {
      setAdminToken(token);
    }
    setCurrentUser(user);
    setIsAdmin(user.role === "admin");
    setLoginOpen(false);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await loginWithCredentials(username, password);
      if (!r.ok) return { ok: false, error: r.error };
      applyAuthSuccess(r.token, r.user);
      return { ok: true };
    },
    [applyAuthSuccess]
  );

  const register = useCallback(
    async (
      email: string,
      code: string,
      password: string,
      displayName: string
    ) => {
      const r = await registerWithEmail(email, code, password, displayName);
      if (!r.ok) return { ok: false, error: r.error };
      applyAuthSuccess(r.token, r.user);
      return { ok: true };
    },
    [applyAuthSuccess]
  );

  const logout = useCallback(() => {
    void (async () => {
      await logoutRemoteSession();
      clearAdminToken();
      setIsAdmin(false);
      setCurrentUser(null);
      setLoginOpen(false);
    })();
  }, []);

  const loginWallBlocking = useMemo(() => {
    if (!authReady || !writeRequiresLogin) return false;
    if (getAppDataMode() !== "remote") return false;
    if (currentUser) return false;
    if (getAdminToken()) return false;
    return true;
  }, [authReady, writeRequiresLogin, currentUser?.id]);

  const showLoginModal = loginWallBlocking || loginOpen;

  const value: AuthContextValue = {
    authReady,
    writeRequiresLogin,
    isAdmin,
    currentUser,
    login,
    logout,
    openLogin: () => setLoginOpen(true),
    loginOpen,
    setLoginOpen,
    refreshMe,
    loginWallBlocking,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {showLoginModal ? (
        <LoginModal
          blockingWall={loginWallBlocking}
          onClose={() => {
            if (loginWallBlocking) return;
            setLoginOpen(false);
          }}
          onLogin={login}
          onRegister={register}
        />
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 须在 AuthProvider 内使用");
  return ctx;
}
