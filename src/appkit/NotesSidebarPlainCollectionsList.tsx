import { Fragment, type ReactNode } from "react";
import { useAppChrome } from "../i18n/useAppChrome";
import { toReadableSidebarDotColor } from "../sidebarDotColor";
import type { Collection } from "../types";
import {
  countSidebarCollectionCardBadge,
  LOOSE_NOTES_COLLECTION_ID,
} from "./collectionModel";
import { CollectionDragGripIcon } from "./AppIcons";
import type { CollectionSidebarTreeProps } from "./CollectionSidebarTree";
import { CollectionIconGlyph } from "./CollectionIconGlyph";

type PlainSubtypeRowsProps = CollectionSidebarTreeProps & {
  searchActive: boolean;
};

function PlainSubtypeRows(p: PlainSubtypeRowsProps): ReactNode {
  const ui = useAppChrome();
  const {
    items,
    depth,
    activeId,
    searchActive,
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

    const rowActive =
      !searchActive &&
      c.id === activeId &&
      !calendarDay &&
      !trashViewActive &&
      !allNotesViewActive &&
      !connectionsViewActive &&
      !attachmentsViewActive &&
      !remindersViewActive;

    return (
      <Fragment key={c.id}>
        <div
          className={
            "sidebar__file-subtype-row sidebar__file-subtype-row--notes-line sidebar__file-subtype-row--plain-folder" +
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
          role="listitem"
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
          <button
            type="button"
            className={
              "sidebar__file-subtype-hit sidebar__file-subtype-hit--notes-line" +
              (rowActive ? " is-active" : "")
            }
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
            aria-label={`${c.name} (${countSidebarCollectionCardBadge(c)})`}
          >
            <span className="sidebar__file-subtype-body">
              {!hideCollectionDots ? (
                <CollectionIconGlyph
                  className="sidebar__dot"
                  shape={c.iconShape}
                  color={toReadableSidebarDotColor(c.dotColor)}
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
            </span>
          </button>
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
          <PlainSubtypeRows
            {...p}
            items={childList}
            depth={depth + 1}
          />
        ) : null}
      </Fragment>
    );
  });
}

export type NotesSidebarPlainCollectionsListProps = Omit<
  CollectionSidebarTreeProps,
  "depth" | "items"
> & {
  collections: Collection[];
  searchActive: boolean;
};

/** 侧栏「笔记」下：无 preset 的合集树，行样式与「学习/灵感」等子类型一致 */
export function NotesSidebarPlainCollectionsList(
  props: NotesSidebarPlainCollectionsListProps
) {
  const { collections, ...rest } = props;
  return (
    <>
      <PlainSubtypeRows {...rest} items={collections} depth={0} />
    </>
  );
}
