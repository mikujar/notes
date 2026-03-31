import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchAuthMe, fetchAuthStatus, loginWithPassword } from "../api/auth";
import { clearAdminToken, getAdminToken, setAdminToken } from "./token";

type AuthContextValue = {
  authReady: boolean;
  writeRequiresLogin: boolean;
  isAdmin: boolean;
  login: (password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  openLogin: () => void;
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function LoginModal({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (password: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await onLogin(password);
      if (!r.ok) setError(r.error ?? "登录失败");
      else setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="auth-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="auth-modal-title" className="auth-modal__title">
          管理员登录
        </h2>
        <p className="auth-modal__hint">输入管理密码后可编辑并保存到服务器。</p>
        <input
          type="password"
          className="auth-modal__input"
          autoComplete="current-password"
          placeholder="密码"
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
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="auth-modal__btn auth-modal__btn--primary"
            onClick={() => void submit()}
            disabled={busy || !password.trim()}
          >
            {busy ? "…" : "登录"}
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
  const [loginOpen, setLoginOpen] = useState(false);

  const refreshSession = useCallback(async () => {
    const status = await fetchAuthStatus();
    setWriteRequiresLogin(status.writeRequiresLogin);
    if (!status.writeRequiresLogin) {
      setIsAdmin(true);
      setAuthReady(true);
      return;
    }
    const token = getAdminToken();
    if (!token) {
      setIsAdmin(false);
      setAuthReady(true);
      return;
    }
    const ok = await fetchAuthMe();
    if (ok) setIsAdmin(true);
    else {
      clearAdminToken();
      setIsAdmin(false);
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (password: string) => {
    const r = await loginWithPassword(password);
    if (!r.ok) return { ok: false, error: r.error };
    setAdminToken(r.token);
    setIsAdmin(true);
    setLoginOpen(false);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    if (writeRequiresLogin) setIsAdmin(false);
    setLoginOpen(false);
  }, [writeRequiresLogin]);

  const value: AuthContextValue = {
    authReady,
    writeRequiresLogin,
    isAdmin,
    login,
    logout,
    openLogin: () => setLoginOpen(true),
    loginOpen,
    setLoginOpen,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {loginOpen ? (
        <LoginModal onClose={() => setLoginOpen(false)} onLogin={login} />
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 须在 AuthProvider 内使用");
  return ctx;
}
