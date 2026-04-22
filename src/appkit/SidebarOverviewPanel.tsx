import type { ReactNode } from "react";
import { useAppChrome } from "../i18n/useAppChrome";
import type { Collection } from "../types";
import { CollectionIconGlyph } from "./CollectionIconGlyph";
import { RailIcon } from "./RailIcon";
import type { RailIconKey } from "./RailIcon";
import { toContrastyGlyphColor } from "../sidebarDotColor";
import { RAIL_ITEMS, type RailKey } from "./SidebarRail";

type QuickLink = {
  key: RailKey;
  label: string;
  icon: RailIconKey;
  color: string;
  show: boolean;
};

/** 从 RAIL_ITEMS 找对应项的 icon / color，保持概览面板 与 rail 一致 */
function lookupRailItem(key: RailKey) {
  return RAIL_ITEMS.find((it) => it.key === key);
}

export type OverviewStats = {
  /** 整棵树里的卡片总数（note/file/task/… 全算上，按 id 去重） */
  cards: number;
  /** 整棵树里 isFileCard 的卡片数 */
  files: number;
  /** 合集节点数（排除虚拟未归类） */
  collections: number;
  /** 当前全部待办条目 */
  reminders: number;
};

export type SidebarOverviewPanelProps = {
  onPick: (key: RailKey, opts?: { collectionId?: string }) => void;
  /** 扁平化的顶层合集列表（只取前 N 个展示，作为「最近合集」占位） */
  recentCollections: Collection[];
  availability: {
    files: boolean;
    archived: boolean;
  };
  stats: OverviewStats;
};

/**
 * 「概览」主侧栏：快速入口 + 最近合集。
 * 当前无 LRU，recentCollections 由 App.tsx 传入顶层合集的 slice 占位。
 */
export function SidebarOverviewPanel(
  props: SidebarOverviewPanelProps
): ReactNode {
  const { onPick, recentCollections, availability, stats } = props;
  const ui = useAppChrome();

  const statCards = [
    {
      key: "cards" as const,
      label: ui.overviewStatCards,
      value: stats.cards,
      color: "#E88368",
    },
    {
      key: "files" as const,
      label: ui.overviewStatFiles,
      value: stats.files,
      color: "#7F8F4F",
    },
    {
      key: "collections" as const,
      label: ui.overviewStatCollections,
      value: stats.collections,
      color: "#8CB1D9",
    },
    {
      key: "reminders" as const,
      label: ui.overviewStatReminders,
      value: stats.reminders,
      color: "#B57A9A",
    },
  ];

  const make = (key: RailKey, label: string, show: boolean): QuickLink | null => {
    const src = lookupRailItem(key);
    if (!src) return null;
    return { key, icon: src.icon, color: src.color, label, show };
  };
  const quickLinks: QuickLink[] = [
    make("notes", ui.railNotes, true),
    make("files", ui.railFiles, availability.files),
    make("calendar", ui.railCalendar, true),
    make("reminders", ui.railReminders, true),
    make("connections", ui.railConnections, true),
    make("archived", ui.railArchived, availability.archived),
    make("trash", ui.railTrash, true),
  ].filter((q): q is QuickLink => q !== null);

  return (
    <div className="sidebar__overview" role="listbox" aria-label={ui.railOverview}>
      <div className="sidebar__overview-section">
        <div className="sidebar__overview-heading">
          {ui.overviewStatsHeading}
        </div>
        <div className="sidebar__overview-stats">
          {statCards.map((s) => (
            <div key={s.key} className="sidebar__overview-stat">
              <span
                className="sidebar__overview-stat-value"
                style={{ color: s.color }}
              >
                {s.value}
              </span>
              <span className="sidebar__overview-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar__overview-section">
        <div className="sidebar__overview-heading">
          {ui.overviewQuickLinksHeading}
        </div>
        <div className="sidebar__overview-list">
          {quickLinks
            .filter((q) => q.show)
            .map((q) => (
              <button
                key={q.key}
                type="button"
                className="sidebar__overview-row"
                onClick={() => onPick(q.key)}
              >
                <RailIcon
                  shape={q.icon}
                  color={q.color}
                  size={16}
                  className="sidebar__overview-icon"
                />
                <span className="sidebar__overview-label">{q.label}</span>
              </button>
            ))}
        </div>
      </div>

      {recentCollections.length > 0 ? (
        <div className="sidebar__overview-section">
          <div className="sidebar__overview-heading">
            {ui.overviewRecentCollectionsHeading}
          </div>
          <div className="sidebar__overview-list">
            {recentCollections.map((c) => (
              <button
                key={c.id}
                type="button"
                className="sidebar__overview-row"
                onClick={() => onPick("notes", { collectionId: c.id })}
                title={c.name}
              >
                <CollectionIconGlyph
                  shape={c.iconShape}
                  color={toContrastyGlyphColor(c.dotColor)}
                  size={13}
                  className="sidebar__overview-icon"
                />
                <span className="sidebar__overview-label">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
