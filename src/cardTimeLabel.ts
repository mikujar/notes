import type { NoteCard } from "./types";

function localDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatClock(minutesOfDay: number) {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 卡片左上角：按 addedOn 显示「今天 / 昨天 / M月D日」+ 时刻 */
export function formatCardTimeLabel(card: NoteCard) {
  const clock = formatClock(card.minutesOfDay);
  const added = card.addedOn;
  if (!added) return `今天 ${clock}`;
  const today = localDateString();
  if (added === today) return `今天 ${clock}`;
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (added === localDateString(yest)) return `昨天 ${clock}`;
  const [, mm, dd] = added.split("-");
  return `${Number(mm)}月${Number(dd)}日 ${clock}`;
}

/**
 * 排在 {@link formatCardTimeLabel} 之后：有提醒日时返回「 · 提醒M月D日」（非今年则带年份）。
 * 无提醒返回空串。
 */
export function formatCardReminderBesideTime(card: NoteCard): string {
  const raw = card.reminderOn?.trim();
  if (!raw) return "";
  const parts = raw.split("-");
  if (parts.length !== 3) return ` · 提醒 ${raw}`;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !mo || !d) return ` · 提醒 ${raw}`;
  const yNow = new Date().getFullYear();
  const dateLabel = y === yNow ? `${mo}月${d}日` : `${y}年${mo}月${d}日`;
  return ` · 提醒${dateLabel}`;
}
