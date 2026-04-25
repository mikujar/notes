import type { NoteCard } from "./types";

/** 从笔记 HTML 正文得到纯文本（供 AI、摘要等） */
export function plainTextFromNoteHtml(html: string): string {
  if (!html?.trim()) return "";
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
}

/**
 * 严格的标题:只看 cards.title 列。空就返回空。
 * 用于"必须有就显示,没有就别假装"的场景(时间线、属性面板等)。
 */
export function cardHeadlinePlain(card: NoteCard): string {
  const t = (card.title ?? "").trim();
  return t ? t.slice(0, 160) : "";
}

/**
 * 兜底显示标签:列表/搜索/关联面板等"必须有点东西可读"的场景用。
 * 文件/剪藏/人物卡:标题为空就返回空(不要显示 card_id 或 url)。
 * 笔记卡:标题为空时回退到正文首行(保留旧行为)。
 */
export function cardDisplayLabel(card: NoteCard): string {
  const t = (card.title ?? "").trim();
  if (t) return t.slice(0, 160);
  const kind = card.objectKind ?? "note";
  if (kind === "note") {
    const plain = plainTextFromNoteHtml(card.text || "");
    const line = plain.split(/\n/)[0]?.trim() || "";
    return line.slice(0, 160);
  }
  return "";
}

export function buildTagsLineForAi(card: NoteCard): string | undefined {
  const tags = card.tags
    ?.map((t) => String(t).trim())
    .filter(Boolean);
  return tags?.length ? tags.join("、") : undefined;
}

export function buildAttachmentsLineForAi(card: NoteCard): string | undefined {
  const media = (card.media ?? []).filter((m) => m.url?.trim());
  if (!media.length) return undefined;
  return media
    .map((m) => {
      const n = m.name?.trim();
      return `${m.kind}${n ? `「${n}」` : ""}`;
    })
    .join("；");
}

/** 日历、提醒、置顶等（非正文） */
export function buildCardExtrasMetaForAi(card: NoteCard): string | undefined {
  const lines: string[] = [];
  if (card.addedOn) lines.push(`日历日：${card.addedOn}`);
  if (card.reminderOn) {
    let r = `提醒日：${card.reminderOn}`;
    if (card.reminderTime) r += ` ${card.reminderTime}`;
    lines.push(r);
  }
  if (card.reminderNote) lines.push(`提醒备注：${card.reminderNote}`);
  if (card.pinned) lines.push("在合集中置顶");
  return lines.length ? lines.join("\n") : undefined;
}
