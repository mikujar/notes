import type { Collection } from "../types";
import { getAdminToken } from "../auth/token";

function apiBase(): string {
  const b = import.meta.env.VITE_API_BASE as string | undefined;
  return b?.replace(/\/$/, "") ?? "";
}

/** GET 合集公开，无需凭证 */
function buildHeadersGet(): Record<string, string> {
  return {};
}

/** PUT：优先会话中的管理员 JWT，其次兼容 VITE_API_TOKEN */
function buildHeadersPut(
  extra?: Record<string, string>
): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const admin = getAdminToken();
  if (admin) {
    h.Authorization = `Bearer ${admin}`;
    return h;
  }
  const t = (import.meta.env.VITE_API_TOKEN as string | undefined)?.trim();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

/** 拉取合集树；null 表示请求失败（网络或非 2xx） */
export async function fetchCollectionsFromApi(): Promise<
  Collection[] | null
> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/collections`, {
      headers: buildHeadersGet(),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as unknown;
    if (!Array.isArray(data)) return null;
    return data as Collection[];
  } catch {
    return null;
  }
}

export async function saveCollectionsToApi(
  data: Collection[]
): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/collections`, {
      method: "PUT",
      headers: buildHeadersPut({ "Content-Type": "application/json" }),
      body: JSON.stringify(data),
    });
    return r.ok;
  } catch {
    return false;
  }
}
