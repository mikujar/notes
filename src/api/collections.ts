import type {
  Collection,
  CollectionCardSchema,
  NoteCard,
  NoteMediaItem,
  SchemaField,
  AutoLinkRule,
  UserNotePrefs,
} from "../types";
import { getAdminToken } from "../auth/token";
import { apiBase, apiFetchInit } from "./apiBase";

/** GET：多用户模式下需携带登录 JWT（或脚本用的 API_TOKEN + 服务端要求的 userId） */
export function buildHeadersGet(): Record<string, string> {
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
export function buildHeadersPut(
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
    const r = await fetch(
      `${base}/api/collections`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
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
    const r = await fetch(
      `${base}/api/collections`,
      apiFetchInit({
        method: "PUT",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
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
  /** 主区灰色说明；空串表示清除 */
  hint?: string;
  parentId?: string;
  sortOrder?: number;
}): Promise<Collection | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/collections`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as Collection;
  } catch {
    return null;
  }
}

/** 更新合集元数据（含类别合集与 card_schema）；返回是否成功 */
export async function updateCollectionApi(
  id: string,
  patch: Partial<
    Pick<Collection, "name" | "dotColor" | "hint" | "isCategory">
  > & {
    parentId?: string | null;
    sortOrder?: number;
    /** 传 null 可清空服务端 preset_type_id */
    presetTypeId?: string | null;
    /** 传 null 可清空为 {} */
    cardSchema?: CollectionCardSchema | null;
  }
): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/collections/${encodeURIComponent(id)}`,
      apiFetchInit({
        method: "PATCH",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      })
    );
    return r.ok;
  } catch {
    return false;
  }
}

/** 删除合集（子集级联；笔记不删，仅从该合集移除归属） */
export async function deleteCollectionApi(id: string): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/collections/${encodeURIComponent(id)}`,
      apiFetchInit({ method: "DELETE", headers: buildHeadersPut() })
    );
    return r.ok;
  } catch {
    return false;
  }
}

// ─── 粒度化卡片操作 ───────────────────────────────────────────────────────────

/** 仅把已有笔记加入目标合集（placement 行）；不写 cards 正文等大字段 */
export type AddCardPlacementResult = {
  cardId: string;
  collectionId: string;
  sortOrder: number;
  pinned: boolean;
};

export async function addCardPlacementApi(
  cardId: string,
  collectionId: string,
  opts?: { insertAtStart?: boolean; pinned?: boolean }
): Promise<AddCardPlacementResult | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}/placements`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          collectionId,
          ...(opts?.insertAtStart === true ? { insertAtStart: true } : {}),
          ...(opts?.pinned === true ? { pinned: true } : {}),
        }),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as AddCardPlacementResult;
  } catch {
    return null;
  }
}

/** 在合集内创建卡片；opts.insertAtStart 为 true 时插入到该合集列表最前（与客户端「新建在顶部」一致） */
export async function createCardApi(
  collectionId: string,
  card: NoteCard,
  opts?: { insertAtStart?: boolean }
): Promise<NoteCard | null> {
  const base = apiBase();
  try {
    const payload =
      opts?.insertAtStart === true
        ? { ...card, insertAtStart: true }
        : card;
    const r = await fetch(
      `${base}/api/collections/${encodeURIComponent(collectionId)}/cards`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as NoteCard;
  } catch {
    return null;
  }
}

/** GET /api/cards/:id/graph 响应 */
export type CardGraphNode = { id: string; objectKind: string };
export type CardGraphEdge = {
  from: string;
  to: string;
  linkType: string;
};

export type CardGraphResult = {
  root: string;
  maxDepth: number;
  linkTypes: string[];
  nodes: CardGraphNode[];
  edges: CardGraphEdge[];
};

/**
 * 服务端 GET /api/cards/:id/graph（深度 ≤4）。
 * 默认边类型含 related、attachment、creator、source 等；可用 linkTypes 收窄。
 */
export async function fetchCardGraphFromApi(
  cardId: string,
  opts?: { depth?: number; linkTypes?: string[] }
): Promise<CardGraphResult | null> {
  const base = apiBase();
  try {
    const sp = new URLSearchParams();
    if (opts?.depth != null) sp.set("depth", String(opts.depth));
    if (opts?.linkTypes?.length) sp.set("linkTypes", opts.linkTypes.join(","));
    const qs = sp.toString();
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}/graph${qs ? `?${qs}` : ""}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as CardGraphResult;
  } catch {
    return null;
  }
}

/** 服务端 PATCH 卡片（含跨合集 collectionId、排序 sortOrder） */
export type CardRemotePatch = Partial<
  Pick<
    NoteCard,
    | "text"
    | "tags"
    | "media"
    | "pinned"
    | "relatedRefs"
    | "minutesOfDay"
    | "addedOn"
    | "customProps"
    | "objectKind"
  >
> & {
  /** 传 null 表示清除提醒 */
  reminderOn?: string | null;
  /** 传 null 表示清除 */
  reminderTime?: string | null;
  /** 传 null 表示清除 */
  reminderNote?: string | null;
  /** 待办勾选完成时间（ISO）；传 null 清除 */
  reminderCompletedAt?: string | null;
  /** 完成时快照的提醒备注；传 null 清除 */
  reminderCompletedNote?: string | null;
  /** 更新置顶、排序或移动归属时必填：指哪一条「合集内出现」 */
  placementCollectionId?: string;
  collectionId?: string;
  sortOrder?: number;
};

/** 由笔记上的单个附件元数据创建「文件」对象卡，并建 attachment 双向边 */
export async function createFileCardForNoteMediaApi(
  noteCardId: string,
  body: { placementCollectionId: string; media: NoteMediaItem }
): Promise<{ fileCardId: string; noteCardId: string } | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(noteCardId)}/file-object`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as { fileCardId: string; noteCardId: string };
  } catch {
    return null;
  }
}

/** 更新卡片任意字段子集；返回是否成功 */
export async function updateCardApi(
  cardId: string,
  patch: CardRemotePatch
): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}`,
      apiFetchInit({
        method: "PATCH",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      })
    );
    return r.ok;
  } catch {
    return false;
  }
}

/** 再跑一遍自动建卡规则（人物 / 网页等）；成功后可拉合集树刷新卡片 */
export async function postCardAutoLinkApi(
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}/auto-link`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: "{}",
      })
    );
    if (!r.ok) {
      let detail = `${r.status}`;
      try {
        const j = (await r.json()) as { error?: unknown };
        if (typeof j?.error === "string" && j.error.trim()) detail = j.error.trim();
      } catch {
        /* ignore */
      }
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "network" };
  }
}

/** 按规则补跑：对该规则源合集内已有卡片批量执行自动建卡 */
export async function postAutoLinkRuleBackfillApi(
  ruleId: string
): Promise<{
  ok: boolean;
  sourceCollectionId?: string;
  sourceCollectionName?: string;
  scanned?: number;
  succeeded?: number;
  createdTargets?: number;
  noEffect?: number;
  failed?: number;
  reasons?: Record<string, number>;
  error?: string;
}> {
  const base = apiBase();
  const rid = String(ruleId || "").trim();
  if (!rid) return { ok: false, error: "ruleId" };
  try {
    const r = await fetch(
      `${base}/api/auto-link/rules/${encodeURIComponent(rid)}/backfill`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: "{}",
      })
    );
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      sourceCollectionId?: unknown;
      sourceCollectionName?: unknown;
      scanned?: number;
      succeeded?: number;
      createdTargets?: number;
      noEffect?: number;
      failed?: number;
      reasons?: unknown;
      error?: unknown;
    };
    if (!r.ok) {
      const detail =
        typeof j.error === "string" && j.error.trim() ? j.error.trim() : `${r.status}`;
      return { ok: false, error: detail };
    }
    return {
      ok: j.ok === true,
      sourceCollectionId:
        typeof j.sourceCollectionId === "string" ? j.sourceCollectionId : "",
      sourceCollectionName:
        typeof j.sourceCollectionName === "string" ? j.sourceCollectionName : "",
      scanned: Number.isFinite(j.scanned) ? Number(j.scanned) : 0,
      succeeded: Number.isFinite(j.succeeded) ? Number(j.succeeded) : 0,
      createdTargets: Number.isFinite(j.createdTargets) ? Number(j.createdTargets) : 0,
      noEffect: Number.isFinite(j.noEffect) ? Number(j.noEffect) : 0,
      failed: Number.isFinite(j.failed) ? Number(j.failed) : 0,
      reasons:
        j.reasons && typeof j.reasons === "object"
          ? (j.reasons as Record<string, number>)
          : {},
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "network" };
  }
}

/** 仅合并单条附件元数据（时长/分辨率/大小/缩略图）；服务端已有值不覆盖 */
export async function patchCardMediaItemApi(
  cardId: string,
  mediaIndex: number,
  patch: {
    durationSec?: number;
    sizeBytes?: number;
    widthPx?: number;
    heightPx?: number;
    thumbnailUrl?: string;
    coverUrl?: string;
  }
): Promise<{ ok: boolean; updated: boolean }> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}/media/${encodeURIComponent(String(mediaIndex))}`,
      apiFetchInit({
        method: "PATCH",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      })
    );
    if (!r.ok) return { ok: false, updated: false };
    const j = (await r.json()) as { updated?: unknown };
    return { ok: true, updated: j.updated === true };
  } catch {
    return { ok: false, updated: false };
  }
}

/** 删除卡片 */
export async function deleteCardApi(cardId: string): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}`,
      apiFetchInit({ method: "DELETE", headers: buildHeadersPut() })
    );
    return r.ok;
  } catch {
    return false;
  }
}

/** 从指定合集移除该笔记的一条归属（多合集之一）；204 表示成功 */
export async function removeCardFromCollectionApi(
  cardId: string,
  collectionId: string
): Promise<boolean> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}/collections/${encodeURIComponent(collectionId)}`,
      apiFetchInit({ method: "DELETE", headers: buildHeadersPut() })
    );
    return r.ok;
  } catch {
    return false;
  }
}

// ─── 对象类型 Schema / 管理 API ───────────────────────────────────────────────

/** GET /api/cards/:id/effective-schema — 卡片在所有合集（含父链）上的合并有效 Schema */
export async function fetchCardEffectiveSchema(cardId: string): Promise<{
  fields: SchemaField[];
  autoLinkRules: AutoLinkRule[];
} | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/cards/${encodeURIComponent(cardId)}/effective-schema`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as { fields: SchemaField[]; autoLinkRules: AutoLinkRule[] };
  } catch {
    return null;
  }
}

/** POST /api/admin/enable-preset-type — 启用预设类型合集（幂等） */
export async function enablePresetTypeApi(data: {
  presetTypeId: string;
  collectionId: string;
  name: string;
  dotColor?: string;
  cardSchema?: CollectionCardSchema;
  parentId?: string;
}): Promise<Collection | { alreadyExists: true; id: string } | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/admin/enable-preset-type`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(data),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as Collection | { alreadyExists: true; id: string };
  } catch {
    return null;
  }
}

/** POST /api/admin/migrate-attachments — 批量将卡片附件迁移为独立文件卡片 */
export async function migrateAttachmentsApi(opts: {
  fileCollectionId: string;
  clearOriginalMedia?: boolean;
}): Promise<{ processed: number; created: number; skipped: number } | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/admin/migrate-attachments`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(opts),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as { processed: number; created: number; skipped: number };
  } catch {
    return null;
  }
}

/** POST /api/admin/migrate-related-refs-json — 旧 JSON 关联写入 card_links */
export async function migrateRelatedRefsJsonApi(): Promise<{
  withJson: number;
  migrated: number;
} | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/admin/migrate-related-refs-json`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as { withJson: number; migrated: number };
  } catch {
    return null;
  }
}

/** POST /api/admin/migrate-clip-tagged-notes — 小红书/bilibili 标签 → 剪藏预设卡 */
export async function migrateClipTaggedNotesApi(): Promise<{
  scanned: number;
  migrated: number;
  skippedNoPreset: number;
  skippedNoKind: number;
  errors: number;
  backfillTitles?: number;
} | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/admin/migrate-clip-tagged-notes`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as {
      scanned: number;
      migrated: number;
      skippedNoPreset: number;
      skippedNoKind: number;
      errors: number;
      backfillTitles?: number;
    };
  } catch {
    return null;
  }
}

export type BackfillMediaThumbnailsResult = {
  scanned: number;
  updated: number;
  failed: number;
  remaining: number;
};

/** POST /api/me/backfill-media-thumbnails — 为当前用户补附件缩略图 / 时长 / 大小 */
export async function backfillMediaThumbnailsApi(
  limit = 20
): Promise<BackfillMediaThumbnailsResult | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/backfill-media-thumbnails`,
      apiFetchInit({
        method: "POST",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify({ limit }),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as BackfillMediaThumbnailsResult;
  } catch {
    return null;
  }
}

/** GET /api/me/note-prefs — 自动建卡规则等笔记偏好 */
export async function fetchMeNotePrefs(): Promise<UserNotePrefs | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/note-prefs`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as UserNotePrefs;
  } catch {
    return null;
  }
}

/** PUT /api/me/note-prefs */
export async function putMeNotePrefs(
  prefs: UserNotePrefs
): Promise<UserNotePrefs | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/me/note-prefs`,
      apiFetchInit({
        method: "PUT",
        headers: buildHeadersPut({ "Content-Type": "application/json" }),
        body: JSON.stringify(prefs),
      })
    );
    if (!r.ok) return null;
    return (await r.json()) as UserNotePrefs;
  } catch {
    return null;
  }
}
