import type { ReactNode } from "react";
import { useAppChrome } from "../i18n/useAppChrome";
import { RailIcon } from "./RailIcon";
import type { RailIconKey } from "./RailIcon";

/** Rail 顶层导航项的 key（与 App.tsx 的 railKey 派生一一对应）。 */
export type RailKey =
  | "overview"
  | "notes"
  | "files"
  | "topic"
  | "clip"
  | "work"
  | "task"
  | "project"
  | "expense"
  | "account"
  | "calendar"
  | "reminders"
  | "connections"
  | "archived"
  | "trash";

export type RailAvailability = {
  /** 笔记常驻，保留位以便未来做权限隐藏 */
  notes: boolean;
  files: boolean;
  topic: boolean;
  clip: boolean;
  work: boolean;
  task: boolean;
  project: boolean;
  expense: boolean;
  account: boolean;
  /** 是否存在名为「已归档」的合集 */
  archived: boolean;
};

type RailGroup = "content" | "system";

type RailItemDef = {
  key: RailKey;
  icon: RailIconKey;
  /** useAppChrome 里的 label 键 */
  labelKey:
    | "railOverview"
    | "railNotes"
    | "railFiles"
    | "railTopic"
    | "railClip"
    | "railWork"
    | "railTask"
    | "railProject"
    | "railExpense"
    | "railAccount"
    | "railCalendar"
    | "railReminders"
    | "railConnections"
    | "railArchived"
    | "railTrash";
  /** 未命中 availability 时本项整个不渲染 */
  availabilityKey?: keyof RailAvailability;
  /** 覆盖 shape 的缺省色：rail 里 15 项各用一个，保持「彩虹」但不跳出当前大地/暖粉色系 */
  color: string;
  group: RailGroup;
};

/**
 * 导航顺序：预设大类型全部平行放在 content 组；配色按彩虹顺序
 * 从上到下 红 → 橙 → 黄 → 绿 → 青 → 蓝 → 紫 → 粉，再回暖，整体
 * 留在大地 / 暖粉色系内。
 */
export const RAIL_ITEMS: RailItemDef[] = [
  {
    key: "overview",
    icon: "twinkle",
    labelKey: "railOverview",
    color: "#DE4A2C", // 红 · coral
    group: "content",
  },
  {
    key: "notes",
    icon: "arch",
    labelKey: "railNotes",
    color: "#E88368", // 红橙 · salmon
    group: "content",
  },
  {
    key: "files",
    icon: "stair",
    labelKey: "railFiles",
    availabilityKey: "files",
    color: "#E68045", // 橙 · orange
    group: "content",
  },
  {
    key: "topic",
    icon: "petal",
    labelKey: "railTopic",
    availabilityKey: "topic",
    color: "#D98A3A", // 琥珀 · amber
    group: "content",
  },
  {
    key: "clip",
    icon: "arc",
    labelKey: "railClip",
    availabilityKey: "clip",
    color: "#E6A82A", // 黄橙 · mustard
    group: "content",
  },
  {
    key: "work",
    icon: "hourglass",
    labelKey: "railWork",
    availabilityKey: "work",
    color: "#E5C263", // 黄 · gold
    group: "content",
  },
  {
    key: "task",
    icon: "dots",
    labelKey: "railTask",
    availabilityKey: "task",
    color: "#7F8F4F", // 黄绿 · olive
    group: "content",
  },
  {
    key: "project",
    icon: "butterfly",
    labelKey: "railProject",
    availabilityKey: "project",
    color: "#9FAD72", // 绿 · sage
    group: "content",
  },
  {
    key: "expense",
    icon: "capsule",
    labelKey: "railExpense",
    availabilityKey: "expense",
    color: "#1F5F57", // 青绿 · teal
    group: "content",
  },
  {
    key: "account",
    icon: "heart",
    labelKey: "railAccount",
    availabilityKey: "account",
    color: "#5C9D8F", // 青 · seafoam
    group: "content",
  },
  {
    key: "calendar",
    icon: "ring",
    labelKey: "railCalendar",
    color: "#8CB1D9", // 浅蓝 · periwinkle
    group: "system",
  },
  {
    key: "reminders",
    icon: "sparkle",
    labelKey: "railReminders",
    color: "#4C6C9A", // 蓝 · navy
    group: "system",
  },
  {
    key: "connections",
    icon: "peanut",
    labelKey: "railConnections",
    color: "#A696C4", // 蓝紫 · lavender
    group: "system",
  },
  {
    key: "archived",
    icon: "scallop",
    labelKey: "railArchived",
    availabilityKey: "archived",
    color: "#B57A9A", // 紫粉 · mauve
    group: "system",
  },
  {
    key: "trash",
    icon: "sStep",
    labelKey: "railTrash",
    color: "#E3A0AB", // 粉 · rose
    group: "system",
  },
];

function filterItems(
  items: RailItemDef[],
  availability: RailAvailability
): RailItemDef[] {
  return items.filter((it) => {
    if (!it.availabilityKey) return true;
    return availability[it.availabilityKey];
  });
}

export type SidebarRailProps = {
  activeKey: RailKey;
  onPick: (key: RailKey) => void;
  availability: RailAvailability;
};

/**
 * 窄导航条：所有顶层入口（大类型 + 工具/系统视图）集中在这里。
 * 纯图标 56px 宽，hover/focus 弹 tooltip；点击通过 onPick 委托给 App.tsx。
 */
export function SidebarRail(props: SidebarRailProps): ReactNode {
  const { activeKey, onPick, availability } = props;
  const ui = useAppChrome();
  const contentItems = filterItems(
    RAIL_ITEMS.filter((it) => it.group === "content"),
    availability
  );
  const systemItems = filterItems(
    RAIL_ITEMS.filter((it) => it.group === "system"),
    availability
  );

  const renderItem = (it: RailItemDef) => {
    const label = ui[it.labelKey];
    const isActive = it.key === activeKey;
    return (
      <button
        key={it.key}
        type="button"
        className={"rail__item" + (isActive ? " is-active" : "")}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        title={label}
        onClick={() => onPick(it.key)}
      >
        <RailIcon
          shape={it.icon}
          color={it.color}
          size={22}
          className="rail__icon"
        />
        <span className="rail__tip">{label}</span>
      </button>
    );
  };

  return (
    <nav className="rail" aria-label={ui.railAriaNav}>
      <div className="rail__group">{contentItems.map(renderItem)}</div>
      <hr className="rail__rule" />
      <div className="rail__group">{systemItems.map(renderItem)}</div>
    </nav>
  );
}
