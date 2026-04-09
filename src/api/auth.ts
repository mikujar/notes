import { authUsesHttpOnlyCookie, getAdminToken } from "../auth/token";
import { apiBase, apiFetchInit, remoteApiBase } from "./apiBase";

/** 与 /api/auth/me、登录返回的 user 一致 */
export type MediaQuotaInfo = {
  /** 自然月键 YYYY-MM（上海时区） */
  usageMonth: string;
  uploadedBytesMonth: number;
  monthlyLimitBytes: number;
  singleFileMaxBytes: number;
  /** 站长：不受普通/订阅月额度与单文件套餐限制（仅受服务端 UPLOAD_MAX_MB） */
  quotaUnlimited?: boolean;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  /** 站长 / 普通住民 / 订阅用户（附件额度随身份） */
  role: "admin" | "user" | "subscriber";
  avatarUrl: string;
  /** 邮箱注册或后台填写后可能有 */
  email?: string;
  mediaQuota: MediaQuotaInfo;
};

/**
 * 媒体地址：绝对 URL 原样返回（腾讯云 COS 私有桶时浏览器展示须再经 {@link resolveCosMediaUrlIfNeeded}）。
 * - `/uploads/…` 由后端（或 COS 回写为绝对地址）提供，分域部署时补全为 API 根。
 * - 其它以 `/` 开头的路径视为**前端静态资源**（Vite `public/` 等），与当前页面同源，
 *   不可拼到 API 上，否则云端未登录示例图会 404，与本地模式不一致。
 */
export function resolveMediaUrl(pathOrUrl: string): string {
  const p = pathOrUrl.trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  if (/^data:/i.test(p)) return p;
  if (/^blob:/i.test(p)) return p;
  const base = apiBase();
  const normalized = p.startsWith("/") ? p : `/${p}`;
  if (base && normalized.startsWith("/uploads/")) {
    return `${base}${normalized}`;
  }
  return normalized;
}

const cosReadUrlCache = new Map<string, { url: string; expiresAt: number }>();
const COS_READ_MARGIN_MS = 60 * 1000;

function viteCosPublicBase(): string {
  return (
    (import.meta.env.VITE_COS_PUBLIC_BASE as string | undefined)?.trim().replace(
      /\/$/,
      ""
    ) ?? ""
  );
}

/** 是否为腾讯云 COS 对象直链（用于判断是否要走 GET 预签名） */
export function looksLikeTencentCosObjectUrl(href: string): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  const h = u.hostname.toLowerCase();
  if (!h.includes("myqcloud.com")) return false;
  if (!h.includes("cos")) return false;
  return true;
}

/**
 * 经 {@link resolveMediaUrl} 后的地址是否可能需要 COS 私有读换签。
 * 自定义域与 `COS_PUBLIC_BASE` 一致时请在构建环境配置 `VITE_COS_PUBLIC_BASE`。
 */
export function needsCosReadUrl(resolvedUrl: string): boolean {
  const p = resolvedUrl.trim();
  if (!p || !/^https?:\/\//i.test(p)) return false;
  if (/^data:|^blob:/i.test(p)) return false;
  if (looksLikeTencentCosObjectUrl(p)) return true;
  const base = viteCosPublicBase();
  if (base && p.startsWith(base)) return true;
  return false;
}

/** 与 upload/users 等接口一致：Bearer JWT、构建期 API 令牌，或仅依赖 httpOnly Cookie */
function cosReadAuthHeaders(): Record<string, string> {
  const t = getAdminToken();
  if (t) return { Authorization: `Bearer ${t}` };
  const vt = (import.meta.env.VITE_API_TOKEN as string | undefined)?.trim();
  if (vt) return { Authorization: `Bearer ${vt}` };
  return {};
}

/** 是否存在任一会话手段（避免未登录时反复请求 cos-read → 401 刷屏） */
function mightHaveApiSession(): boolean {
  if (getAdminToken()) return true;
  if (authUsesHttpOnlyCookie()) return true;
  if ((import.meta.env.VITE_API_TOKEN as string | undefined)?.trim()) return true;
  return false;
}

/** 将 COS 对外 URL 换为短时 GET 预签名（需已登录且有权访问该对象） */
export async function resolveCosMediaUrlIfNeeded(
  resolvedUrl: string
): Promise<string> {
  if (!needsCosReadUrl(resolvedUrl)) return resolvedUrl;
  if (!mightHaveApiSession()) return resolvedUrl;
  const now = Date.now();
  const hit = cosReadUrlCache.get(resolvedUrl);
  if (hit && hit.expiresAt > now + COS_READ_MARGIN_MS) return hit.url;

  const base = apiBase();
  const q = new URLSearchParams({ url: resolvedUrl });
  const r = await fetch(`${base}/api/upload/cos-read?${q}`, apiFetchInit({
    headers: cosReadAuthHeaders(),
  }));
  if (!r.ok) return resolvedUrl;
  const j = (await r.json().catch(() => ({}))) as {
    url?: unknown;
    expiresIn?: unknown;
  };
  if (typeof j.url !== "string" || !j.url) return resolvedUrl;
  const ttlSec =
    typeof j.expiresIn === "number" && Number.isFinite(j.expiresIn)
      ? j.expiresIn
      : 900;
  const ttlMs = Math.min(3600, Math.max(60, ttlSec)) * 1000 * 0.85;
  cosReadUrlCache.set(resolvedUrl, { url: j.url, expiresAt: now + ttlMs });
  return j.url;
}

export async function fetchAuthStatus(): Promise<{
  writeRequiresLogin: boolean;
}> {
  const base = apiBase();
  const remoteBase = base.length > 0;
  try {
    const r = await fetch(`${base}/api/auth/status`, apiFetchInit());
    if (!r.ok) {
      // 已指向绝对地址的云端却拿不到状态：按「需要登录」处理，避免既不显示登录又无法同步
      return { writeRequiresLogin: remoteBase ? true : false };
    }
    const j = (await r.json()) as { writeRequiresLogin?: unknown };
    return { writeRequiresLogin: Boolean(j.writeRequiresLogin) };
  } catch {
    return { writeRequiresLogin: remoteBase ? true : false };
  }
}

export async function loginWithCredentials(
  username: string,
  password: string
): Promise<
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; error: string }
> {
  const base = remoteApiBase();
  try {
    const r = await fetch(
      `${base}/api/auth/login`,
      apiFetchInit({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      })
    );
    const j = (await r.json().catch(() => ({}))) as {
      token?: unknown;
      user?: unknown;
      error?: unknown;
    };
    if (!r.ok) {
      return {
        ok: false,
        error: typeof j.error === "string" ? j.error : "登录翻车啦，再检查一下？",
      };
    }
    if (typeof j.token !== "string" || !j.user || typeof j.user !== "object") {
      return { ok: false, error: "回信怪怪的，刷新下再试？" };
    }
    const u = j.user as AuthUser;
    if (!u.id || !u.username) {
      return { ok: false, error: "回信怪怪的，刷新下再试？" };
    }
    return { ok: true, token: j.token, user: u };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message.trim() : "";
    return {
      ok: false,
      error: detail ? `网络开小差：${detail}` : "网络开小差惹…",
    };
  }
}

export async function sendRegisterCode(
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = remoteApiBase();
  try {
    const r = await fetch(
      `${base}/api/auth/register/send-code`,
      apiFetchInit({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
    );
    const j = (await r.json().catch(() => ({}))) as { error?: unknown };
    if (!r.ok) {
      return {
        ok: false,
        error: typeof j.error === "string" ? j.error : "验证码没发出去…",
      };
    }
    return { ok: true };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message.trim() : "";
    return {
      ok: false,
      error: detail ? `网络开小差：${detail}` : "网络开小差惹…",
    };
  }
}

export async function registerWithEmail(
  email: string,
  code: string,
  password: string,
  displayName?: string
): Promise<
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; error: string }
> {
  const base = remoteApiBase();
  try {
    const r = await fetch(
      `${base}/api/auth/register`,
      apiFetchInit({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          password,
          displayName: displayName?.trim() ?? "",
        }),
      })
    );
    const j = (await r.json().catch(() => ({}))) as {
      token?: unknown;
      user?: unknown;
      error?: unknown;
    };
    if (!r.ok) {
      return {
        ok: false,
        error: typeof j.error === "string" ? j.error : "注册翻车啦，再试一次？",
      };
    }
    if (typeof j.token !== "string" || !j.user || typeof j.user !== "object") {
      return { ok: false, error: "回信怪怪的，刷新下再试？" };
    }
    const u = j.user as AuthUser;
    if (!u.id || !u.username) {
      return { ok: false, error: "回信怪怪的，刷新下再试？" };
    }
    return { ok: true, token: j.token, user: u };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message.trim() : "";
    return {
      ok: false,
      error: detail ? `网络开小差：${detail}` : "网络开小差惹…",
    };
  }
}

export async function fetchAuthMe(): Promise<{
  ok: boolean;
  admin: boolean;
  user: AuthUser | null;
  /** 仅 true 时应清除本地 JWT（401/403）；网络抖动、5xx 勿清，避免误像「掉登录」 */
  sessionInvalid?: boolean;
}> {
  const token = getAdminToken();
  const cookieMode = authUsesHttpOnlyCookie();
  if (!token && !cookieMode) {
    return { ok: false, admin: false, user: null };
  }
  const base = remoteApiBase();
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(
      `${base}/api/auth/me`,
      apiFetchInit({ headers })
    );
    if (r.status === 401 || r.status === 403) {
      return {
        ok: false,
        admin: false,
        user: null,
        sessionInvalid: true,
      };
    }
    if (!r.ok) {
      return { ok: false, admin: false, user: null };
    }
    const j = (await r.json()) as {
      ok?: unknown;
      admin?: unknown;
      user?: AuthUser | null;
    };
    return {
      ok: Boolean(j.ok),
      admin: Boolean(j.admin),
      user: j.user ?? null,
    };
  } catch {
    return { ok: false, admin: false, user: null };
  }
}

const ME_RETRY_COUNT = 3;
const ME_RETRY_DELAY_MS = 400;

/** 校验会话时带重试，减轻弱网下 /me 偶发失败 → 误当成未登录 */
export async function fetchAuthMeWithRetry(): Promise<{
  ok: boolean;
  admin: boolean;
  user: AuthUser | null;
  sessionInvalid?: boolean;
}> {
  let last = await fetchAuthMe();
  if (last.ok && last.user) return last;
  if (last.sessionInvalid) return last;
  const token = getAdminToken();
  if (!token && !authUsesHttpOnlyCookie()) return last;
  for (let i = 1; i < ME_RETRY_COUNT; i++) {
    await new Promise((r) => setTimeout(r, ME_RETRY_DELAY_MS));
    last = await fetchAuthMe();
    if (last.ok && last.user) return last;
    if (last.sessionInvalid) return last;
  }
  return last;
}

/** 清除服务端 httpOnly 会话 Cookie（失败静默） */
export async function logoutRemoteSession(): Promise<void> {
  const base = remoteApiBase();
  if (!base) return;
  try {
    const token = getAdminToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(
      `${base}/api/auth/logout`,
      apiFetchInit({ method: "POST", headers })
    );
  } catch {
    /* ignore */
  }
}
