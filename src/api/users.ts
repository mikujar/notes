import { getAdminToken } from "../auth/token";
import { apiBase, apiFetchInit } from "./apiBase";

function authHeaders(): Record<string, string> {
  const t = getAdminToken();
  if (t) return { Authorization: `Bearer ${t}` };
  const vt = (import.meta.env.VITE_API_TOKEN as string | undefined)?.trim();
  if (vt) return { Authorization: `Bearer ${vt}` };
  return {};
}

import type { MediaQuotaInfo } from "./auth";

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user" | "subscriber";
  avatarUrl: string;
  /** 未绑定则为空 */
  email?: string;
  mediaQuota: MediaQuotaInfo;
};

export async function fetchUsersList(): Promise<PublicUser[]> {
  const base = apiBase();
  const r = await fetch(
    `${base}/api/users`,
    apiFetchInit({ headers: authHeaders() })
  );
  if (!r.ok) throw new Error("无法加载用户列表");
  return (await r.json()) as PublicUser[];
}

export async function createUserApi(body: {
  username: string;
  password: string;
  displayName: string;
  role: "admin" | "user" | "subscriber";
  /** 可选；绑定后可用邮箱登录 */
  email?: string;
}): Promise<PublicUser> {
  const base = apiBase();
  const r = await fetch(
    `${base}/api/users`,
    apiFetchInit({
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const j = (await r.json().catch(() => ({}))) as PublicUser & {
    error?: string;
  };
  if (!r.ok) throw new Error(j.error ?? "创建失败");
  return j;
}

/** 换绑邮箱前先调用；需 JWT */
export async function sendMyEmailChangeCode(
  email: string
): Promise<{ ok: true }> {
  const base = apiBase();
  const r = await fetch(
    `${base}/api/users/me/email/send-code`,
    apiFetchInit({
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    })
  );
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? "发送失败");
  return { ok: true };
}

/** 当前登录用户自助更新（昵称、邮箱、密码）；需 JWT 用户会话 */
export async function updateMyProfileApi(body: {
  displayName?: string;
  password?: string;
  /** 传空字符串或 null 表示解绑邮箱（解绑不需验证码） */
  email?: string | null;
  /** 更换为非空新邮箱时必填 */
  emailCode?: string;
}): Promise<PublicUser> {
  const base = apiBase();
  const r = await fetch(
    `${base}/api/users/me`,
    apiFetchInit({
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const j = (await r.json().catch(() => ({}))) as PublicUser & {
    error?: string;
  };
  if (!r.ok) throw new Error(j.error ?? "更新失败");
  return j;
}

export async function updateUserApi(
  id: string,
  body: Partial<{
    displayName: string;
    username: string;
    /** 传空字符串或 null 表示解绑邮箱 */
    email: string | null;
    role: "admin" | "user" | "subscriber";
    password: string;
  }>
): Promise<PublicUser> {
  const base = apiBase();
  const r = await fetch(
    `${base}/api/users/${encodeURIComponent(id)}`,
    apiFetchInit({
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? "更新失败");
  return j as PublicUser;
}

export async function deleteUserApi(id: string): Promise<void> {
  const base = apiBase();
  const r = await fetch(
    `${base}/api/users/${encodeURIComponent(id)}`,
    apiFetchInit({ method: "DELETE", headers: authHeaders() })
  );
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? "删除失败");
}

export async function uploadMyAvatar(file: File): Promise<string> {
  const base = apiBase();
  const pres = await fetch(
    `${base}/api/users/me/avatar/presign`,
    apiFetchInit({
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
      }),
    })
  );
  const pj = (await pres.json().catch(() => ({}))) as {
    direct?: unknown;
    putUrl?: unknown;
    headers?: Record<string, string>;
    key?: unknown;
    error?: string;
  };
  if (!pres.ok) {
    throw new Error(pj.error ?? "头像上传预约失败，等等再试～");
  }
  if (pj.direct === true && typeof pj.putUrl === "string") {
    const putRes = await fetch(pj.putUrl, {
      method: "PUT",
      headers: { ...(pj.headers ?? {}) },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error("头像传一半卡住啦，再试一次？");
    }
    if (typeof pj.key !== "string" || !pj.key) {
      throw new Error("头像上传结果怪怪的…");
    }
    const c = await fetch(
      `${base}/api/users/me/avatar/confirm`,
      apiFetchInit({
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: pj.key }),
      })
    );
    const cj = (await c.json().catch(() => ({}))) as {
      avatarUrl?: string;
      error?: string;
    };
    if (!c.ok || typeof cj.avatarUrl !== "string") {
      throw new Error(cj.error ?? "头像没对上号…再传一次？");
    }
    return cj.avatarUrl;
  }

  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(
    `${base}/api/users/me/avatar`,
    apiFetchInit({ method: "POST", headers: authHeaders(), body: fd })
  );
  const j = (await r.json().catch(() => ({}))) as {
    avatarUrl?: string;
    error?: string;
  };
  if (!r.ok || typeof j.avatarUrl !== "string") {
    throw new Error(j.error ?? "头像没贴上去…再试一次？");
  }
  return j.avatarUrl;
}
