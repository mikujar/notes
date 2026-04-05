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
  type AuthUser,
} from "../api/auth";
import { getAppDataMode } from "../appDataModeStorage";
import { clearAdminToken, getAdminToken, setAdminToken } from "./token";

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

function LoginModal({
  onClose,
  onLogin,
  blockingWall,
}: {
  onClose: () => void;
  onLogin: (
    username: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  /** 为 true 时不可点遮罩关闭、无「稍后再说」、Esc 不关闭 */
  blockingWall: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (blockingWall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, blockingWall]);

  const submit = async () => {
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

  return (
    <div
      className="auth-modal-backdrop auth-modal-backdrop--login"
      role="presentation"
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
        <h2 className="auth-modal__title">登录账号</h2>
        <p className="auth-modal__hint">
          用站长/管理员发你的账号口令开罐就好 ✨
          登录后笔记和附件都存在你自己的小地盘；新账号首次进入会自动带上站内内置导览笔记。管理员还能在这里招呼小伙伴～
        </p>
        <input
          type="text"
          className="auth-modal__input"
          autoComplete="username"
          placeholder="用户名（发你的那个）"
          value={username}
          disabled={busy}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
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
            if (e.key === "Enter") void submit();
          }}
        />
        {error ? (
          <p className="auth-modal__err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="auth-modal__actions">
          {blockingWall ? null : (
            <button
              type="button"
              className="auth-modal__btn auth-modal__btn--ghost"
              onClick={onClose}
              disabled={busy}
            >
              稍后再说
            </button>
          )}
          <button
            type="button"
            className={
              "auth-modal__btn auth-modal__btn--primary" +
              (blockingWall ? " auth-modal__btn--primary--full" : "")
            }
            onClick={() => void submit()}
            disabled={busy || !username.trim() || !password}
          >
            {busy ? "…" : "开罐！"}
          </button>
        </div>
      </div>
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
    if (!token) {
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

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await loginWithCredentials(username, password);
      if (!r.ok) return { ok: false, error: r.error };
      setAdminToken(r.token);
      setCurrentUser(r.user);
      setIsAdmin(r.user.role === "admin");
      setLoginOpen(false);
      return { ok: true };
    },
    []
  );

  const logout = useCallback(() => {
    clearAdminToken();
    setIsAdmin(false);
    setCurrentUser(null);
    setLoginOpen(false);
  }, []);

  const loginWallBlocking = useMemo(() => {
    if (!authReady || !writeRequiresLogin) return false;
    if (getAppDataMode() !== "remote") return false;
    if (isTauri()) return false;
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
