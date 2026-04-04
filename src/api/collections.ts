import type { Collection, NoteCard } from "../types";
import { getAdminToken } from "../auth/token";
import { apiBase } from "./apiBase";

/** GET：多用户模式下需携带登录 JWT（或脚本用的 API_TOKEN + 服务端要求的 userId） */
function buildHeadersGet(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = getAdminToken();
  if (token) h.Authorization = `Bearer ${token}`;
  else {
    const t = (import.meta.env.VITE_API_TOKEN as string | undefined)?.trim();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

/** PUT / PATCH / POST / DELETE：优先会话中的管理员 JWT，其次兼容 VITE_API_TOKEN */
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

// ─── 合集树读取 ───────────────────────────────────────────────────────────────

/** 拉取合集树；null 表示请求失败（网络或非 2xx） */
export async function fetchCollectionsFromApi(): Promise<Collection[] | null> {
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

/** 批量覆写（仅用于导入/迁移，日常写操作请用下方粒度化函数） */
export async function saveCollectionsToApi(data: Collection[]): Promise<boolean> {
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

// ─── 粒度化合集操作 ───────────────────────────────────────────────────────────

/** 创建合集；成功返回合集对象，失败返回 null */
export async function createCollectionApi(data: {
  id: string;
  name: string;
  dotColor?: string;
  hint?: string;
  parentId?: string;
  sortOrder?: number;
}): Promise<Collection | null> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/collections`, {
      method: "POST",
      headers: buildHeadersPut({ "Content-Type": "application/json" }),
      body: JSON.stringify(data),
    });
    if (!r.ok) return null;
    return (await r.json()) as Collection;
  } catch {
    return null;
  }
}

/** 更新合集元数据（name / dotColor / hint / parentId / sortOrder）；返回是否成功 */
export async function updateCollectionApi(
  id: string,
  patch: Partial<Pick<Collection, "name" | "dotColor" | "hint">> & {
    parentId?: string | null;
    sortOrder?: number;
  }
): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/collections/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: buildHeadersPut({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** 删除合集（级联删子集和所有卡片） */
export async function deleteCollectionApi(id: string): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/collections/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: buildHeadersPut(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ─── 粒度化卡片操作 ───────────────────────────────────────────────────────────

/** 在合集末尾创建卡片；成功返回卡片对象，失败返回 null */
export async function createCardApi(
  collectionId: string,
  card: NoteCard
): Promise<NoteCard | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/collections/${encodeURIComponent(collectionId)}/cards`,
      {
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(card),
      }
    );
    if (!r.ok) return null;
    return (await r.json()) as NoteCard;
  } catch {
    return null;
  }
}

/** 更新卡片任意字段子集；返回是否成功 */
export async function updateCardApi(
  cardId: string,
  patch: Partial<Pick<NoteCard, "text" | "tags" | "media" | "pinned" | "relatedRefs" | "minutesOfDay" | "addedOn">>
): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/cards/${encodeURIComponent(cardId)}`, {
      method: "PATCH",
      headers: buildHeadersPut({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** 删除卡片 */
export async function deleteCardApi(cardId: string): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(`${base}/api/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      headers: buildHeadersPut(),
    });
    return r.ok;
  } catch {
    return false;
  }
}
