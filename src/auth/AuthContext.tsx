import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  fetchAuthMeWithRetry,
  fetchAuthStatus,
  loginWithCredentials,
  logoutRemoteSession,
  registerWithEmail,
  sendRegisterCode,
  type AuthUser,
} from "../api/auth";
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
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

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
      if (!r.ok) setError(r.error ?? "登录失败惹，再检查一下？");
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
    const em = regEmail.trim();
    if (!em) {
      setError("请先填写邮箱");
      return;
    }
    setSendBusy(true);
    try {
      const r = await sendRegisterCode(em);
      if (!r.ok) setError(r.error);
      else setError("");
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
      if (!r.ok) setError(r.error ?? "注册失败");
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

  const legalTerms = `${import.meta.env.BASE_URL}legal/terms.html`;
  const legalPrivacy = `${import.meta.env.BASE_URL}legal/privacy.html`;

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
          onClick={(e) => e.stopPropagation()}
        >
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
        {panel === "login" ? (
          <>
            <h2 className="auth-modal__title">登录账号</h2>
            <p className="auth-modal__hint">
              支持用户名或邮箱 + 密码。登录后笔记和附件按账号隔离；新账号首次进入会带上站内导览笔记。
            </p>
            <input
              type="text"
              className="auth-modal__input"
              autoComplete="username"
              placeholder="用户名或邮箱"
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
              placeholder="口令 / 密码"
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
            <h2 className="auth-modal__title">邮箱注册</h2>
            <p className="auth-modal__hint">
              填写邮箱后发送验证码，收信后填入 6
              位数字并设置密码（至少 6 位）。生产环境需在服务端配置 SMTP。
            </p>
            <div className="auth-modal__input-row">
              <input
                type="email"
                className="auth-modal__input"
                autoComplete="email"
                placeholder="邮箱"
                value={regEmail}
                disabled={busy || sendBusy}
                onChange={(e) => setRegEmail(e.target.value)}
              />
              <button
                type="button"
                className="auth-modal__btn auth-modal__btn--ghost"
                disabled={busy || sendBusy || !regEmail.trim()}
                onClick={() => void sendCode()}
              >
                {sendBusy ? "…" : "发验证码"}
              </button>
            </div>
            <input
              type="text"
              inputMode="numeric"
              className="auth-modal__input"
              autoComplete="one-time-code"
              placeholder="6 位验证码"
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
              placeholder="密码（至少 6 位）"
              value={regPassword}
              disabled={busy}
              onChange={(e) => setRegPassword(e.target.value)}
            />
            <input
              type="text"
              className="auth-modal__input"
              autoComplete="nickname"
              placeholder="昵称（可选，默认同邮箱前缀）"
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
        {panel === "register" ? (
          <p className="auth-modal__consent">
            注册即表示你已阅读并同意
            <a
              href={legalTerms}
              target="_blank"
              rel="noopener noreferrer"
            >
              《用户协议》
            </a>
            与
            <a
              href={legalPrivacy}
              target="_blank"
              rel="noopener noreferrer"
            >
              《隐私政策》
            </a>
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
              稍后再说
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
              {busy ? "…" : "开罐！"}
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
              {busy ? "…" : "注册并登录"}
            </button>
          )}
        </div>
        <p className="auth-modal__sub">
          {panel === "login" ? (
            <>
              还没有账号？{" "}
              <button
                type="button"
                className="auth-modal__link"
                disabled={busy || sendBusy}
                onClick={() => {
                  setPanel("register");
                  setError("");
                }}
              >
                邮箱注册
              </button>
            </>
          ) : (
            <>
              已有账号？{" "}
              <button
                type="button"
                className="auth-modal__link"
                disabled={busy || sendBusy}
                onClick={() => {
                  setPanel("login");
                  setError("");
                }}
              >
                去登录
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
        <a
          href={legalTerms}
          target="_blank"
          rel="noopener noreferrer"
        >
          用户协议
        </a>
        <span className="auth-modal-backdrop__legal-sep" aria-hidden>
          {" "}
          ·{" "}
        </span>
        <a
          href={legalPrivacy}
          target="_blank"
          rel="noopener noreferrer"
        >
          隐私政策
        </a>
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
    if (isTauri()) return false;
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
