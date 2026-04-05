import { getAdminToken } from "../auth/token";
import { apiBase } from "./apiBase";

function authHeaders(): Record<string, string> {
  const t = getAdminToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  avatarUrl: string;
};

export async function fetchUsersList(): Promise<PublicUser[]> {
  const base = apiBase();
  const r = await fetch(`${base}/api/users`, { headers: authHeaders() });
  if (!r.ok) throw new Error("无法加载用户列表");
  return (await r.json()) as PublicUser[];
}

export async function createUserApi(body: {
  username: string;
  password: string;
  displayName: string;
  role: "admin" | "user";
}): Promise<PublicUser> {
  const base = apiBase();
  const r = await fetch(`${base}/api/users`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as PublicUser & {
    error?: string;
  };
  if (!r.ok) throw new Error(j.error ?? "创建失败");
  return j;
}

/** 当前登录用户自助更新（昵称、密码）；需 JWT 用户会话 */
export async function updateMyProfileApi(body: {
  displayName?: string;
  password?: string;
}): Promise<PublicUser> {
  const base = apiBase();
  const r = await fetch(`${base}/api/users/me`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
    role: "admin" | "user";
    password: string;
  }>
): Promise<PublicUser> {
  const base = apiBase();
  const r = await fetch(`${base}/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? "更新失败");
  return j as PublicUser;
}

export async function deleteUserApi(id: string): Promise<void> {
  const base = apiBase();
  const r = await fetch(`${base}/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? "删除失败");
}

export async function uploadMyAvatar(file: File): Promise<string> {
  const base = apiBase();
  const pres = await fetch(`${base}/api/users/me/avatar/presign`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
    }),
  });
  const pj = (await pres.json().catch(() => ({}))) as {
    direct?: unknown;
    putUrl?: unknown;
    headers?: Record<string, string>;
    key?: unknown;
    error?: string;
  };
  if (!pres.ok) {
    throw new Error(pj.error ?? "头像预签名失败");
  }
  if (pj.direct === true && typeof pj.putUrl === "string") {
    const putRes = await fetch(pj.putUrl, {
      method: "PUT",
      headers: { ...(pj.headers ?? {}) },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`直传对象存储失败（HTTP ${putRes.status}）`);
    }
    if (typeof pj.key !== "string" || !pj.key) {
      throw new Error("头像上传响应无效");
    }
    const c = await fetch(`${base}/api/users/me/avatar/confirm`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: pj.key }),
    });
    const cj = (await c.json().catch(() => ({}))) as {
      avatarUrl?: string;
      error?: string;
    };
    if (!c.ok || typeof cj.avatarUrl !== "string") {
      throw new Error(cj.error ?? "头像确认失败");
    }
    return cj.avatarUrl;
  }

  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${base}/api/users/me/avatar`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const j = (await r.json().catch(() => ({}))) as {
    avatarUrl?: string;
    error?: string;
  };
  if (!r.ok || typeof j.avatarUrl !== "string") {
    throw new Error(j.error ?? "头像上传失败");
  }
  return j.avatarUrl;
}
