import {
  Fragment,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { DragEvent } from "react";
import { useAppChrome } from "../i18n/useAppChrome";
import { toContrastyGlyphColor } from "../sidebarDotColor";
import type { Collection } from "../types";
import {
  countSidebarCollectionCardBadge,
  LOOSE_NOTES_COLLECTION_ID,
} from "./collectionModel";
import { CollectionDragGripIcon } from "./AppIcons";
import type { CollectionDropPosition } from "./collectionDrag";
import { CollectionIconGlyph } from "./CollectionIconGlyph";

export type CollectionSidebarTreeProps = {
  items: Collection[];
  depth: number;
  activeId: string | undefined;
  calendarDay: string | null;
  trashViewActive: boolean;
  allNotesViewActive: boolean;
  connectionsViewActive: boolean;
  attachmentsViewActive: boolean;
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
  /** 为 true 时不显示合集名称前的彩色圆点 */
  hideCollectionDots?: boolean;
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
  setAllNotesViewActive: Dispatch<SetStateAction<boolean>>;
  setConnectionsViewActive: Dispatch<SetStateAction<boolean>>;
  setAttachmentsViewActive: Dispatch<SetStateAction<boolean>>;
  setRemindersViewActive: Dispatch<SetStateAction<boolean>>;
  setCalendarDay: Dispatch<SetStateAction<string | null>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  /** 从全页笔记详情返回列表时调用（侧栏切换合集/视图） */
  onLeaveCardPage?: () => void;
  setMobileNavOpen: Dispatch<SetStateAction<boolean>>;
  setDraftCollectionName: Dispatch<SetStateAction<string>>;
  setEditingCollectionId: Dispatch<SetStateAction<string | null>>;
  onCollectionNameBlur: () => void;
  addSubCollection: (parentId: string) => void;
};

function CollectionTreeRows(p: CollectionSidebarTreeProps): ReactNode {
  const ui = useAppChrome();
  const {
    items,
    depth,
    activeId,
    calendarDay,
    trashViewActive,
    allNotesViewActive,
    connectionsViewActive,
    attachmentsViewActive,
    remindersViewActive,
    collapsedFolderIds,
    dropIndicator,
    draggingCollectionId,
    noteCardDropCollectionId,
    canEdit,
    editingCollectionId,
    mobileCollectionDragByHandle,
    hideCollectionDots = false,
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
    setAllNotesViewActive,
    setConnectionsViewActive,
    setAttachmentsViewActive,
    setRemindersViewActive,
    setCalendarDay,
    setActiveId,
    onLeaveCardPage,
    setMobileNavOpen,
    setDraftCollectionName,
    setEditingCollectionId,
    onCollectionNameBlur,
    addSubCollection,
  } = p;

  const visible = items.filter((c) => c.id !== LOOSE_NOTES_COLLECTION_ID);
  return visible.map((c) => {
    const childList = (c.children ?? []).filter(
      (ch) => ch.id !== LOOSE_NOTES_COLLECTION_ID
    );
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
            !allNotesViewActive &&
            !connectionsViewActive &&
            !attachmentsViewActive &&
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
              aria-label={
                collapsed
                  ? ui.uiExpandSubcollections
                  : ui.uiCollapseSubcollections
              }
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
              onLeaveCardPage?.();
              setTrashViewActive(false);
              setAllNotesViewActive(false);
              setConnectionsViewActive(false);
              setAttachmentsViewActive(false);
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
                onLeaveCardPage?.();
                setTrashViewActive(false);
                setAllNotesViewActive(false);
                setConnectionsViewActive(false);
                setAttachmentsViewActive(false);
                setRemindersViewActive(false);
                setCalendarDay(null);
                expandAncestorsOf(c.id);
                setActiveId(c.id);
                setMobileNavOpen(false);
              }
            }}
          >
            {!hideCollectionDots ? (
              <CollectionIconGlyph
                className="sidebar__dot"
                shape={c.iconShape}
                color={toContrastyGlyphColor(c.dotColor)}
                size={8}
              />
            ) : null}
            {editingCollectionId === c.id ? (
              <input
                ref={collectionNameInputRef}
                type="text"
                className="sidebar__name-input"
                value={draftCollectionName}
                aria-label={ui.uiCollectionNameAria}
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
                  canEdit ? ui.uiCollectionNameHint : undefined
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
                  aria-label={ui.uiAddSubcollectionAria}
                  title={ui.uiAddSubcollectionTitle}
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
                    aria-label={ui.uiDragCollectionAria}
                    title={ui.uiDragCollectionTitle}
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
