import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import styles from "./SearchableTreeNavigator.module.css";

/**
 * A searchable list of things, grouped, driven from the keyboard.
 *
 * One component for every place this shape appears: the command palette, the module catalogue, the
 * module explorer. They are the same interaction — type to narrow, arrow to move, enter to choose —
 * and having one implementation means the keyboard behaves identically everywhere rather than
 * almost identically.
 *
 * It owns the query and the highlight and nothing else. What the items are, how they rank and what
 * choosing one does all belong to the caller.
 */

export interface NavigatorItem {
  id: string;
  label: string;
  /** Shown right-aligned and dimmed: a command's id, a module's type. */
  hint?: string;
  /** The heading this item sits under. Items with no group are listed first, ungrouped. */
  group?: string;
  /** Free text the search also matches, beyond the label and hint. */
  keywords?: string;
  icon?: ReactNode;
}

export interface SearchableTreeNavigatorProps {
  items: NavigatorItem[];
  /** The item to highlight. Uncontrolled if omitted. */
  selectedId?: string;
  /** Enter, or a click. */
  onChoose: (item: NavigatorItem) => void;
  /** Arrow keys and typing. Called for every highlight change, which is what drives a preview pane. */
  onHighlight?: (item: NavigatorItem) => void;
  placeholder?: string;
  /** Focuses the search box on mount. The palette wants this; a docked panel does not. */
  autoFocus?: boolean;
  /** Replaces the default subsequence ranking. */
  rank?: (items: NavigatorItem[], query: string) => NavigatorItem[];
  emptyMessage?: string;
  ariaLabel?: string;
}

/**
 * Matches the query's characters in order rather than as a substring.
 *
 * People type what they remember, not a prefix: "adm" should find "Add Module". Consecutive matches
 * and matches at a word boundary score higher, so "add" ranks `Add Module` above something that merely
 * contains an a, a d and a d scattered through it.
 */
function score(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let total = 0;
  let at = 0;
  let previous = -2;
  for (const char of q) {
    const found = t.indexOf(char, at);
    if (found < 0) return null;
    if (found === previous + 1) total += 3;
    if (found === 0 || ".-_ /".includes(t[found - 1] ?? "")) total += 4;
    previous = found;
    at = found + 1;
  }
  // Shorter targets win ties: an exact-length match is likelier to be what was meant than a long name
  // that happens to contain the same letters.
  return total - t.length * 0.01;
}

/**
 * The fields are not equal, and weighting them is what makes the ranking usable.
 *
 * A label match is what someone meant. An id match is deliberate too. Keywords are prose, and a
 * subsequence of two or three letters can be found scattered through almost any sentence, so an
 * unweighted keyword match drowns the labels: typing "os" put the flanger above the oscillator,
 * because its description happened to contain an o and then an s.
 *
 * Keywords still earn their place, because they are how you find something by what it does rather
 * than by its name. They just cannot outrank the thing actually called that.
 */
const HINT_WEIGHT = 0.8;
const KEYWORD_WEIGHT = 0.25;
/** Whatever the prose scored, it ends up below every name match. */
const KEYWORD_CEILING = -1;

function defaultRank(items: NavigatorItem[], query: string): NavigatorItem[] {
  const trimmed = query.trim();
  if (trimmed === "") return items;
  const ranked: { item: NavigatorItem; score: number }[] = [];
  for (const item of items) {
    const label = score(trimmed, item.label);
    const hint = item.hint === undefined ? null : score(trimmed, item.hint);
    const keywords =
      item.keywords === undefined ? null : score(trimmed, item.keywords);
    const named = Math.max(
      label ?? Number.NEGATIVE_INFINITY,
      hint === null ? Number.NEGATIVE_INFINITY : hint * HINT_WEIGHT,
    );
    const best =
      named > Number.NEGATIVE_INFINITY
        ? named
        : keywords === null
          ? Number.NEGATIVE_INFINITY
          : Math.min(KEYWORD_CEILING, keywords * KEYWORD_WEIGHT);
    if (best > Number.NEGATIVE_INFINITY) ranked.push({ item, score: best });
  }
  return ranked
    .sort(
      (a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label),
    )
    .map((r) => r.item);
}

/** Keeps grouping when nothing is typed, and drops it while searching, where ranking is the order. */
function groupItems(
  items: NavigatorItem[],
  searching: boolean,
): [string, NavigatorItem[]][] {
  if (searching) return [["", items]];
  const groups = new Map<string, NavigatorItem[]>();
  for (const item of items) {
    const key = item.group ?? "";
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
}

export const SearchableTreeNavigator = ({
  items,
  selectedId,
  onChoose,
  onHighlight,
  placeholder = "Search",
  autoFocus = false,
  rank = defaultRank,
  emptyMessage = "Nothing matches",
  ariaLabel = "Search",
}: SearchableTreeNavigatorProps) => {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => rank(items, query), [items, query, rank]);
  const groups = useMemo(
    () => groupItems(visible, query.trim() !== ""),
    [visible, query],
  );

  // Typing narrows the list, so a highlight from the previous list may point past the end of this one.
  const index = Math.min(highlight, Math.max(0, visible.length - 1));
  const current = visible[index];

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (current !== undefined) onHighlight?.(current);
    // Only when the highlighted item itself changes: reporting on every render would re-run whatever
    // the caller does with it, which for the explorer means rebuilding a canvas.
  }, [current, onHighlight]);

  useEffect(() => {
    // Keeps the highlighted row on screen while arrowing through a long list.
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  const move = (delta: number) => {
    if (visible.length === 0) return;
    const next = Math.min(visible.length - 1, Math.max(0, index + delta));
    setHighlight(next);
    const element =
      listRef.current?.querySelectorAll<HTMLElement>("[data-nav-item]")[next];
    element?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        className={styles.search}
        value={query}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          }
          if (event.key === "Enter" && current !== undefined) {
            event.preventDefault();
            onChoose(current);
          }
        }}
      />
      <div
        className={styles.list}
        ref={listRef}
        role="listbox"
        aria-label={ariaLabel}
      >
        {visible.length === 0 && <p className={styles.empty}>{emptyMessage}</p>}
        {groups.map(([group, groupItems_]) => (
          <section key={group || "__ungrouped"} className={styles.group}>
            {group !== "" && <h3 className={styles.heading}>{group}</h3>}
            <ul className={styles.items}>
              {groupItems_.map((item) => {
                const isHighlighted = item.id === current?.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      data-nav-item
                      className={styles.item}
                      aria-selected={isHighlighted}
                      data-current={item.id === selectedId ? "true" : undefined}
                      title={item.keywords}
                      // Pointer down rather than click: a click blurs the search box first, and in a
                      // palette that blur can close the whole thing before the click lands.
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setHighlight(
                          visible.findIndex((v) => v.id === item.id),
                        );
                        onChoose(item);
                      }}
                      onMouseEnter={() =>
                        setHighlight(visible.findIndex((v) => v.id === item.id))
                      }
                    >
                      {item.icon !== undefined && (
                        <span className={styles.icon}>{item.icon}</span>
                      )}
                      <span className={styles.label}>{item.label}</span>
                      {item.hint !== undefined && (
                        <span className={styles.hint}>{item.hint}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};

export { defaultRank as rankNavigatorItems };
