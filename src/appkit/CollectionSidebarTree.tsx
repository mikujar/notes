import {
  Fragment,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { DragEvent } from "react";
import type { Collection } from "../types";
import { countSidebarCollectionCardBadge } from "./collectionModel";
import { CollectionDragGripIcon } from "./AppIcons";
import type { CollectionDropPosition } from "./collectionDrag";

export type CollectionSidebarTreeProps = {
  items: Collection[];
  depth: number;
  activeId: string | undefined;
  calendarDay: string | null;
  trashViewActive: boolean;
  remindersViewActive: boolean;
  collapsedFolderIds: Set<string>;
  dropIndicator: {
    targetId: string;
    position: CollectionDropPosition;
  } | null;
  draggingCollectionId: string | null;
  noteCardDropCollectionId: string | null;
  canEdit: boolean;
  editingCollectionId: string | null;
  mobileCollectionDragByHandle: boolean;
  hideAddsInMobileBrowse: boolean;
  draftCollectionName: string;
  collectionNameInputRef: MutableRefObject<HTMLInputElement | null>;
  skipCollectionBlurCommitRef: MutableRefObject<boolean>;
  noteCardDragActiveRef: MutableRefObject<boolean>;
  onCollectionRowDragStart: (id: string, e: DragEvent) => void;
  onCollectionRowDragEnd: () => void;
  onCollectionRowDragOver: (id: string, e: DragEvent) => void;
  onCollectionRowDrop: (id: string, e: DragEvent) => void;
  setNoteCardDropCollectionId: Dispatch<SetStateAction<string | null>>;
  setCollectionCtxMenu: Dispatch<
    SetStateAction<{
      x: number;
      y: number;
      id: string;
      name: string;
      hasChildren: boolean;
    } | null>
  >;
  toggleFolderCollapsed: (folderId: string) => void;
  expandAncestorsOf: (targetId: string) => void;
  setTrashViewActive: Dispatch<SetStateAction<boolean>>;
  setRemindersViewActive: Dispatch<SetStateAction<boolean>>;
  setCalendarDay: Dispatch<SetStateAction<string | null>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setMobileNavOpen: Dispatch<SetStateAction<boolean>>;
  setDraftCollectionName: Dispatch<SetStateAction<string>>;
  setEditingCollectionId: Dispatch<SetStateAction<string | null>>;
  onCollectionNameBlur: () => void;
  addSubCollection: (parentId: string) => void;
};

function CollectionTreeRows(p: CollectionSidebarTreeProps): ReactNode {
  const {
    items,
    depth,
    activeId,
    calendarDay,
    trashViewActive,
    remindersViewActive,
    collapsedFolderIds,
    dropIndicator,
    draggingCollectionId,
    noteCardDropCollectionId,
    canEdit,
    editingCollectionId,
    mobileCollectionDragByHandle,
    hideAddsInMobileBrowse,
    draftCollectionName,
    collectionNameInputRef,
    skipCollectionBlurCommitRef,
    noteCardDragActiveRef,
    onCollectionRowDragStart,
    onCollectionRowDragEnd,
    onCollectionRowDragOver,
    onCollectionRowDrop,
    setNoteCardDropCollectionId,
    setCollectionCtxMenu,
    toggleFolderCollapsed,
    expandAncestorsOf,
    setTrashViewActive,
    setRemindersViewActive,
    setCalendarDay,
    setActiveId,
    setMobileNavOpen,
    setDraftCollectionName,
    setEditingCollectionId,
    onCollectionNameBlur,
    addSubCollection,
  } = p;

  return items.map((c) => {
    const childList = c.children ?? [];
    const hasChildren = childList.length > 0;
    const collapsed = collapsedFolderIds.has(c.id);

    const dropCls =
      dropIndicator?.targetId === c.id
        ? dropIndicator.position === "before"
          ? " sidebar__tree-row--drop-before"
          : dropIndicator.position === "after"
            ? " sidebar__tree-row--drop-after"
            : " sidebar__tree-row--drop-inside"
        : "";

    return (
      <Fragment key={c.id}>
        <div
          className={
            "sidebar__tree-row" +
            (c.id === activeId &&
            !calendarDay &&
            !trashViewActive &&
            !remindersViewActive
              ? " is-active"
              : "") +
            (c.id === draggingCollectionId
              ? " sidebar__tree-row--dragging"
              : "") +
            (noteCardDropCollectionId === c.id
              ? " sidebar__tree-row--note-card-drop"
              : "") +
            dropCls
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={
            canEdit &&
            editingCollectionId !== c.id &&
            !mobileCollectionDragByHandle
          }
          onDragStart={(e) => onCollectionRowDragStart(c.id, e)}
          onDragEnd={onCollectionRowDragEnd}
          onDragOver={(e) => onCollectionRowDragOver(c.id, e)}
          onDragLeave={(e) => {
            const rel = e.relatedTarget as Node | null;
            if (rel && e.currentTarget.contains(rel)) return;
            if (noteCardDragActiveRef.current) {
              setNoteCardDropCollectionId((id) =>
                id === c.id ? null : id
              );
            }
          }}
          onDrop={(e) => onCollectionRowDrop(c.id, e)}
          onContextMenu={(e) => {
            if (!canEdit || editingCollectionId === c.id) return;
            e.preventDefault();
            setCollectionCtxMenu({
              x: e.clientX,
              y: e.clientY,
              id: c.id,
              name: c.name,
              hasChildren: (c.children?.length ?? 0) > 0,
            });
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              draggable={false}
              className={
                "sidebar__chevron" +
                (collapsed ? "" : " is-expanded")
              }
              aria-label={collapsed ? "展开子合集" : "折叠子合集"}
              aria-expanded={!collapsed}
              onClick={(e) => {
                e.stopPropagation();
                toggleFolderCollapsed(c.id);
              }}
            >
              <span className="sidebar__chevron-icon" aria-hidden>
                ›
              </span>
            </button>
          ) : (
            <span className="sidebar__chevron-spacer" aria-hidden />
          )}
          <div
            role="button"
            tabIndex={editingCollectionId === c.id ? -1 : 0}
            className="sidebar__item-hit"
            onClick={() => {
              if (editingCollectionId === c.id) return;
              setTrashViewActive(false);
              setRemindersViewActive(false);
              setCalendarDay(null);
              expandAncestorsOf(c.id);
              setActiveId(c.id);
              setMobileNavOpen(false);
            }}
            onKeyDown={(e) => {
              if (editingCollectionId === c.id) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setTrashViewActive(false);
                setRemindersViewActive(false);
                setCalendarDay(null);
                expandAncestorsOf(c.id);
                setActiveId(c.id);
                setMobileNavOpen(false);
              }
            }}
          >
            <span
              className="sidebar__dot"
              style={{ backgroundColor: c.dotColor }}
              aria-hidden
            />
            {editingCollectionId === c.id ? (
              <input
                ref={collectionNameInputRef}
                type="text"
                className="sidebar__name-input"
                value={draftCollectionName}
                aria-label="合集名称"
                onChange={(e) =>
                  setDraftCollectionName(e.target.value)
                }
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    skipCollectionBlurCommitRef.current = true;
                    setEditingCollectionId(null);
                  }
                }}
                onBlur={onCollectionNameBlur}
              />
            ) : (
              <span
                className="sidebar__name"
                title={
                  canEdit ? "双击修改名称；右键可删除合集" : undefined
                }
                onDoubleClick={
                  canEdit
                    ? (e) => {
                        e.stopPropagation();
                        setDraftCollectionName(c.name);
                        setEditingCollectionId(c.id);
                      }
                    : undefined
                }
              >
                {c.name}
              </span>
            )}
            <span className="sidebar__count">
              {countSidebarCollectionCardBadge(c)}
            </span>
          </div>
          {canEdit ? (
            <div className="sidebar__tree-row__tail">
              {!hideAddsInMobileBrowse ? (
                <button
                  type="button"
                  draggable={false}
                  className="sidebar__add-sub"
                  aria-label="添加子合集"
                  title="子合集"
                  onClick={(e) => {
                    e.stopPropagation();
                    addSubCollection(c.id);
                  }}
                >
                  +
                </button>
              ) : (
                <span
                  className="sidebar__add-sub-spacer"
                  aria-hidden
                />
              )}
              {mobileCollectionDragByHandle ? (
                editingCollectionId !== c.id ? (
                  <div
                    className="sidebar__tree-drag-handle"
                    draggable
                    onDragStart={(e) =>
                      onCollectionRowDragStart(c.id, e)
                    }
                    onDragEnd={onCollectionRowDragEnd}
                    aria-label="拖动调整合集顺序"
                    title="拖动调整顺序"
                  >
                    <CollectionDragGripIcon className="sidebar__tree-drag-handle__svg" />
                  </div>
                ) : (
                  <span
                    className="sidebar__tree-drag-handle-spacer"
                    aria-hidden
                  />
                )
              ) : null}
            </div>
          ) : null}
        </div>
        {hasChildren && !collapsed ? (
          <CollectionTreeRows
            {...p}
            items={childList}
            depth={depth + 1}
          />
        ) : null}
      </Fragment>
    );
  });
}

/** 侧栏「合集」导航树（含子层级递归）。 */
export function CollectionSidebarTree(
  props: Omit<CollectionSidebarTreeProps, "depth" | "items"> & {
    collections: Collection[];
  }
) {
  const { collections, ...rest } = props;
  return (
    <>
      <CollectionTreeRows {...rest} items={collections} depth={0} />
    </>
  );
}
