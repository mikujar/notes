import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { parseTagsFromInput } from "./CardTagsRow";
import { tagChipInlineStyle } from "./tagChipPalette";

type DropdownEntry =
  | { kind: "tag"; tag: string }
  | { kind: "create"; raw: string };

export function CardPageTagsPanel({
  cardId,
  tags: tagsProp,
  tagOptions = [],
  canEdit,
  onCommit,
}: {
  cardId: string;
  tags: string[] | undefined;
  /** 全库已有标签（与侧栏标签云同源），用于下拉候选 */
  tagOptions?: string[];
  canEdit: boolean;
  onCommit: (tags: string[]) => void;
}) {
  const tags = tagsProp ?? [];
  const tagsKey = tags.join("\u0001");
  const [list, setList] = useState(tags);
  const [addDraft, setAddDraft] = useState("");
  const addDraftRef = useRef("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const itemElsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [menuFixedStyle, setMenuFixedStyle] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    setList(tags);
  }, [cardId, tagsKey]);

  const dropdownEntries = useMemo((): DropdownEntry[] => {
    const raw = addDraft.trim();
    const q = raw.toLowerCase();
    const already = new Set(list);
    const candidates = tagOptions
      .filter((t) => !already.has(t))
      .filter((t) => !q || t.toLowerCase().includes(q));

    const inLibraryExact =
      raw.length > 0 && tagOptions.some((t) => t === raw);
    const onCardExact = raw.length > 0 && list.includes(raw);
    const showCreate =
      raw.length > 0 && !onCardExact && !inLibraryExact;

    return [
      ...candidates.map((tag) => ({ kind: "tag" as const, tag })),
      ...(showCreate ? [{ kind: "create" as const, raw }] : []),
    ];
  }, [addDraft, list, tagOptions]);

  useEffect(() => {
    if (!dropdownOpen) return;
    setHighlightIndex((hi) => {
      const n = dropdownEntries.length;
      if (n === 0) return -1;
      return Math.min(Math.max(hi, 0), n - 1);
    });
  }, [dropdownOpen, dropdownEntries]);

  useEffect(() => {
    if (!dropdownOpen || highlightIndex < 0) return;
    itemElsRef.current[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, dropdownOpen, dropdownEntries.length]);

  const updateMenuPosition = useCallback(() => {
    const root = fieldRef.current;
    if (!root || !dropdownOpen) return;
    const r = root.getBoundingClientRect();
    setMenuFixedStyle({
      left: r.left,
      top: r.bottom + 5,
      width: r.width,
    });
  }, [dropdownOpen]);

  useLayoutEffect(() => {
    if (!dropdownOpen) {
      setMenuFixedStyle(null);
      return;
    }
    updateMenuPosition();
    const onWin = () => updateMenuPosition();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [dropdownOpen, updateMenuPosition, list, addDraft, dropdownEntries]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (fieldRef.current?.contains(t)) return;
      if (portalRef.current?.contains(t)) return;
      setDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dropdownOpen]);

  const setAddDraftSynced = useCallback((v: string) => {
    addDraftRef.current = v;
    setAddDraft(v);
  }, []);

  const addOneTag = useCallback(
    (rawTag: string) => {
      const t = rawTag.trim();
      if (!t) return;
      setList((prev) => {
        if (prev.includes(t)) return prev;
        const next = [...prev, t];
        onCommit(next);
        return next;
      });
    },
    [onCommit]
  );

  const flushAddInput = useCallback(() => {
    const parsed = parseTagsFromInput(addDraftRef.current);
    setAddDraftSynced("");
    if (!parsed.length) return;
    setList((prev) => {
      const next = [...prev];
      for (const x of parsed) {
        if (!next.includes(x)) next.push(x);
      }
      onCommit(next);
      return next;
    });
  }, [onCommit, setAddDraftSynced]);

  const remove = useCallback(
    (t: string) => {
      setList((prev) => {
        const next = prev.filter((x) => x !== t);
        onCommit(next);
        return next;
      });
    },
    [onCommit]
  );

  if (!canEdit) {
    if (!tags.length) {
      return <span className="card-page__prop-empty">—</span>;
    }
    return (
      <div className="card-page__tags-panel card-page__tags-panel--readonly">
        <div className="card-page__tags-pills">
          {tags.map((t) => (
            <span
              key={t}
              className="card-page__tags-pill"
              style={tagChipInlineStyle(t)}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    );
  }

  itemElsRef.current.length = 0;

  return (
    <div className="card-page__tags-panel">
      <div className="card-page__tags-field" ref={fieldRef}>
        <div className="card-page__tags-inline">
          {list.map((t) => (
            <span
              key={t}
              className="card-page__tags-pill card-page__tags-pill--removable"
              style={tagChipInlineStyle(t)}
            >
              <span className="card-page__tags-pill-text">{t}</span>
              <button
                type="button"
                className="card-page__tags-pill-remove"
                aria-label={`移除标签 ${t}`}
                onClick={() => remove(t)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            className="card-page__tags-add-input"
            placeholder="添加标签…"
            value={addDraft}
            onChange={(e) => setAddDraftSynced(e.target.value)}
            onFocus={() => setDropdownOpen(true)}
            onBlur={flushAddInput}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setDropdownOpen(false);
                setHighlightIndex(-1);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!dropdownOpen) setDropdownOpen(true);
                setHighlightIndex((i) => {
                  const n = dropdownEntries.length;
                  if (n === 0) return -1;
                  if (i < 0) return 0;
                  return Math.min(i + 1, n - 1);
                });
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                if (!dropdownOpen) setDropdownOpen(true);
                setHighlightIndex((i) => {
                  const n = dropdownEntries.length;
                  if (n === 0) return -1;
                  if (i <= 0) return 0;
                  return i - 1;
                });
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (
                  dropdownOpen &&
                  highlightIndex >= 0 &&
                  highlightIndex < dropdownEntries.length
                ) {
                  const entry = dropdownEntries[highlightIndex];
                  const raw = entry.kind === "tag" ? entry.tag : entry.raw;
                  const t = raw.trim();
                  if (t) {
                    addOneTag(t);
                    setAddDraftSynced("");
                    return;
                  }
                }
                flushAddInput();
              }
            }}
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
            aria-controls="card-page-tags-listbox"
          />
        </div>
        {dropdownOpen && menuFixedStyle
          ? createPortal(
              <div
                id="card-page-tags-listbox"
                ref={portalRef}
                className="card-page__tags-dropdown card-page__tags-dropdown--fixed"
                style={{
                  position: "fixed",
                  left: menuFixedStyle.left,
                  top: menuFixedStyle.top,
                  width: menuFixedStyle.width,
                  zIndex: 60,
                }}
                role="listbox"
                aria-label="标签候选"
              >
                {dropdownEntries.length === 0 ? (
                  <div className="card-page__tags-dropdown-empty">
                    暂无可选标签；输入新名称后回车添加
                  </div>
                ) : (
                  dropdownEntries.map((entry, idx) => {
                    const active = idx === highlightIndex;
                    if (entry.kind === "tag") {
                      return (
                        <button
                          key={`tag-${entry.tag}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          ref={(el) => {
                            itemElsRef.current[idx] = el;
                          }}
                          className={
                            "card-page__tags-dropdown-item" +
                            (active ? " is-active" : "")
                          }
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => {
                            addOneTag(entry.tag);
                            setAddDraftSynced("");
                          }}
                        >
                          <span
                            className="card-page__tags-dropdown-pill"
                            style={tagChipInlineStyle(entry.tag)}
                          >
                            {entry.tag}
                          </span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={`create-${entry.raw}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        ref={(el) => {
                          itemElsRef.current[idx] = el;
                        }}
                        className={
                          "card-page__tags-dropdown-item card-page__tags-dropdown-item--create" +
                          (active ? " is-active" : "")
                        }
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => {
                          addOneTag(entry.raw);
                          setAddDraftSynced("");
                        }}
                      >
                        创建「{entry.raw}」
                      </button>
                    );
                  })
                )}
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}
