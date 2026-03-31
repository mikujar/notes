import { getAdminToken } from "../auth/token";

function apiBase(): string {
  const b = import.meta.env.VITE_API_BASE as string | undefined;
  return b?.replace(/\/$/, "") ?? "";
}

export async function fetchAuthStatus(): Promise<{
  writeRequiresLogin: boolean;
}> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/auth/status`);
    if (!r.ok) return { writeRequiresLogin: false };
    const j = (await r.json()) as { writeRequiresLogin?: unknown };
    return { writeRequiresLogin: Boolean(j.writeRequiresLogin) };
  } catch {
    return { writeRequiresLogin: false };
  }
}

export async function loginWithPassword(
  password: string
): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      token?: unknown;
      error?: unknown;
    };
    if (!r.ok) {
      return {
        ok: false,
        error: typeof j.error === "string" ? j.error : "登录失败",
      };
    }
    if (typeof j.token !== "string") {
      return { ok: false, error: "响应无效" };
    }
    return { ok: true, token: j.token };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}

export async function fetchAuthMe(): Promise<boolean> {
  const token = getAdminToken();
  if (!token) return false;
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: unknown; admin?: unknown };
    return Boolean(j.ok && j.admin);
  } catch {
    return false;
  }
}
