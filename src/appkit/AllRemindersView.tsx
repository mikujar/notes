import type { ReactNode } from "react";
import type { NoteCard } from "../types";
import { formatReminderDateLabel } from "../cardTimeLabel";
import type { ReminderListEntry } from "./collectionModel";

export function AllRemindersView({
  entries,
  renderCard,
}: {
  entries: ReminderListEntry[];
  renderCard: (colId: string, card: NoteCard) => ReactNode;
}) {
  if (entries.length === 0) {
    return (
      <div className="timeline__empty all-reminders-page__empty">
        暂无带提醒的笔记～在卡片「⋯」里可设置提醒日；侧栏月历上有提醒的日期会显示小角标。
      </div>
    );
  }

  const sections: ReactNode[] = [];
  for (let i = 0; i < entries.length; ) {
    const date = entries[i].reminderOn;
    const group: ReminderListEntry[] = [];
    while (i < entries.length && entries[i].reminderOn === date) {
      group.push(entries[i]);
      i++;
    }
    sections.push(
      <section
        key={date}
        className="timeline__pin-section timeline__reminder-section"
        aria-label={`提醒 ${formatReminderDateLabel(date)}`}
      >
        <h2 className="timeline__pin-heading">
          {formatReminderDateLabel(date)}
        </h2>
        <ul className="cards">
          {group.map((ent) => renderCard(ent.col.id, ent.card))}
        </ul>
      </section>
    );
  }

  return (
    <div className="all-reminders-page">
      <p className="all-reminders-page__intro">
        共 {entries.length} 条提醒，按提醒日排序；与合集内卡片相同，可在此直接编辑或点「查看详情」。
      </p>
      {sections}
    </div>
  );
}
