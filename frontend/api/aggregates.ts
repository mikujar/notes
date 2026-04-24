/**
 * aggregates.ts — 服务端聚合端点的前端数据层
 *
 * 对应后端 PR 2 新加的 7 个聚合路由。这些结果都是 lightweight 行
 * （id + snippet + metadata）；需要完整卡片时调用 collections-v2.ts
 * 的 fetchCardById。
 */

import { apiBase, apiFetchInit } from "./apiBase";
import { buildHeadersGet } from "./collections";

// ─── 通用轻量行 ─────────────────────────────────────────────────────────────

/** 聚合接口返回的精简卡片行（仅供列表/搜索结果展示，点进详情再 fetchCardById）。 */
export type LightCardRow = {
  id: string;
  title: string;
  snippet: string;
  addedOn: string | null;
  minutesOfDay: number | null;
  tags?: string[];
  collectionId: string | null;
  presetSlug: string | null;
};

export type ReminderRow = LightCardRow & {
  reminderOn: string | null;
  reminderTime: string | null;
  reminderCompletedAt: string | null;
  reminderNote?: string;
  reminderCompletedNote?: string;
};

// ─── /api/overview/summary ──────────────────────────────────────────────────

export type OverviewRecentCard = {
  id: string;
  collectionId: string | null;
  title: string;
  addedOn: string | null;
  minutesOfDay: number | null;
};

export type OverviewPresetSlice = {
  total: number;
  weekNew: number;
  recent: OverviewRecentCard[];
};

export type OverviewRandomCard = {
  id: string;
  collectionId: string | null;
  collectionName: string | null;
  snippet: string;
  addedOn: string | null;
};

export type OverviewImageItem = {
  cardId: string;
  collectionId: string | null;
  url: string;
  thumbUrl: string | null;
  name: string | null;
};

export type OverviewAudioItem = {
  cardId: string;
  collectionId: string | null;
  url: string;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  thumbUrl: string | null;
  name: string | null;
  displayName: string;
};

export type OverviewSummary = {
  todayYmd: string;
  weekStartYmd: string;
  weekNewCount: number;
  byPresetSlug: Record<string, OverviewPresetSlice>;
  taskReminders: { today: number; overdue: number; pending: number };
  randomCard: OverviewRandomCard | null;
  recentImages: OverviewImageItem[];
  recentAudio: OverviewAudioItem[];
};

export async function fetchOverviewSummary(args: {
  todayYmd: string;
  weekStartYmd: string;
}): Promise<OverviewSummary | null> {
  const base = apiBase();
  const params = new URLSearchParams();
  params.set("todayYmd", args.todayYmd);
  params.set("weekStartYmd", args.weekStartYmd);
  try {
    const r = await fetch(
      `${base}/api/overview/summary?${params}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as OverviewSummary;
  } catch {
    return null;
  }
}

// ─── /api/search ────────────────────────────────────────────────────────────

export type SearchResult = {
  cards: LightCardRow[];
  collections: { id: string; name: string; parentId: string | null }[];
};

export async function searchContent(
  q: string,
  opts: { limit?: number } = {}
): Promise<SearchResult | null> {
  const base = apiBase();
  const params = new URLSearchParams();
  params.set("q", q);
  if (opts.limit) params.set("limit", String(opts.limit));
  try {
    const r = await fetch(
      `${base}/api/search?${params}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as SearchResult;
  } catch {
    return null;
  }
}

// ─── /api/calendar/days + /api/calendar/:ymd/cards ──────────────────────────

export type CalendarDay = {
  ymd: string;
  noteCount: number;
  reminderCount: number;
};

export type CalendarMonthSummary = { days: CalendarDay[] };

export async function fetchCalendarMonth(
  monthYm: string
): Promise<CalendarMonthSummary | null> {
  const base = apiBase();
  const params = new URLSearchParams();
  params.set("month", monthYm);
  try {
    const r = await fetch(
      `${base}/api/calendar/days?${params}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as CalendarMonthSummary;
  } catch {
    return null;
  }
}

export type CalendarDayCards = {
  ymd: string;
  addedCards: LightCardRow[];
  reminderCards: ReminderRow[];
};

export async function fetchCalendarDay(
  ymd: string
): Promise<CalendarDayCards | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/calendar/${encodeURIComponent(ymd)}/cards`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as CalendarDayCards;
  } catch {
    return null;
  }
}

// ─── /api/notes — 全部笔记时间线 ───────────────────────────────────────────

export type NotesPage = {
  cards: LightCardRow[];
  hasMore: boolean;
  page: number;
  limit: number;
};

export async function fetchNotesPage(opts: {
  page?: number;
  limit?: number;
} = {}): Promise<NotesPage | null> {
  const base = apiBase();
  const params = new URLSearchParams();
  params.set("page", String(opts.page ?? 1));
  params.set("limit", String(opts.limit ?? 50));
  try {
    const r = await fetch(
      `${base}/api/notes?${params}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as NotesPage;
  } catch {
    return null;
  }
}

// ─── /api/reminders ─────────────────────────────────────────────────────────

export type RemindersFilter = "pending" | "all" | "completed";

export type RemindersPage = {
  entries: ReminderRow[];
  hasMore: boolean;
  page: number;
  limit: number;
};

export async function fetchReminders(
  opts: { filter?: RemindersFilter; page?: number; limit?: number } = {}
): Promise<RemindersPage | null> {
  const base = apiBase();
  const params = new URLSearchParams();
  if (opts.filter) params.set("filter", opts.filter);
  params.set("page", String(opts.page ?? 1));
  params.set("limit", String(opts.limit ?? 50));
  try {
    const r = await fetch(
      `${base}/api/reminders?${params}`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as RemindersPage;
  } catch {
    return null;
  }
}

// ─── /api/tags ──────────────────────────────────────────────────────────────

export type TagWithCount = { tag: string; count: number };
export type TagsResponse = { tags: TagWithCount[] };

export async function fetchTags(): Promise<TagsResponse | null> {
  const base = apiBase();
  try {
    const r = await fetch(
      `${base}/api/tags`,
      apiFetchInit({ headers: buildHeadersGet() })
    );
    if (!r.ok) return null;
    return (await r.json()) as TagsResponse;
  } catch {
    return null;
  }
}
