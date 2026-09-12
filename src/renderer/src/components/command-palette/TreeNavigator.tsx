import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem } from "../../menu/types";
import { type FlatMenuItem, MenuItemComponent } from "./TreeNavigatorItem";

export interface TreeNavigatorProps {
  items: MenuItem[];
  searchInputRef?: RefObject<HTMLInputElement>;
  /** Id of the externally-selected item (e.g. the active tool). Marks the
   *  matching row with the accent style via `isActive`. */
  selectedItemId?: string;
  /**
   * Parents to start expanded. A tree that opens fully collapsed is right for a menu and wrong for
   * a catalogue, where the categories are headings rather than folders and hiding every item behind
   * one is a list that appears empty.
   */
  defaultExpandedIds?: string[];
  /** Test ID for the navigator container */
  "data-testid"?: string;
}

/** Walk a `MenuItem` tree into an ordered flat list, skipping subtrees of
 *  collapsed parents. Pure — kept outside the component so identity is stable
 *  per `(items, expandedItems)` pair via `useMemo` below. */
function flattenTree(
  items: MenuItem[],
  expandedItems: Set<string>,
  level = 0,
  parentId?: string,
): FlatMenuItem[] {
  const result: FlatMenuItem[] = [];
  for (const item of items) {
    const hasChildren = Boolean(item.children?.length);
    const isExpanded = expandedItems.has(item.id);
    result.push({ ...item, level, parentId, hasChildren, isExpanded });
    if (hasChildren && isExpanded && item.children) {
      result.push(
        ...flattenTree(item.children, expandedItems, level + 1, item.id),
      );
    }
  }
  return result;
}

export const TreeNavigator = ({
  items,
  searchInputRef,
  selectedItemId,
  defaultExpandedIds,
  "data-testid": testId,
}: TreeNavigatorProps) => {
  // No auto-focus on mount — the first ArrowDown/ArrowUp moves focus into the
  // list. `selectedItemId` still drives the `isActive` (prominent) row.
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    () => new Set(defaultExpandedIds),
  );
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const flatItems = useMemo(
    () => flattenTree(items, expandedItems),
    [items, expandedItems],
  );

  const toggleExpanded = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const itemsLength = flatItems.length;
      if (!itemsLength) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev === -1 ? 0 : (prev + 1) % itemsLength,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev === -1
            ? itemsLength - 1
            : (prev - 1 + itemsLength) % itemsLength,
        );
        return;
      }
      if (selectedIndex < 0) return;

      const currentItem = flatItems[selectedIndex];
      if (!currentItem) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (currentItem.hasChildren && !currentItem.isExpanded) {
          toggleExpanded(currentItem.id);
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (currentItem.hasChildren && currentItem.isExpanded) {
          toggleExpanded(currentItem.id);
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (currentItem.hasChildren) {
          toggleExpanded(currentItem.id);
        } else if (currentItem.onExecute) {
          currentItem.onExecute();
        } else {
          itemRefs.current[selectedIndex]?.click();
        }
      }
    },
    [flatItems, selectedIndex, toggleExpanded],
  );

  useEffect(() => {
    const searchInput = searchInputRef?.current;
    if (!searchInput) return undefined;
    // When the search input loses focus, clear the keyboard-focus index too —
    // otherwise the focused row keeps its highlight alongside the externally-
    // selected `isActive` row, giving the appearance of two selections.
    const handleBlur = () => setSelectedIndex(-1);
    searchInput.addEventListener("keydown", handleKeyDown);
    searchInput.addEventListener("blur", handleBlur);
    return () => {
      searchInput.removeEventListener("keydown", handleKeyDown);
      searchInput.removeEventListener("blur", handleBlur);
    };
  }, [handleKeyDown, searchInputRef]);

  // Fire `onFocus` and `scrollIntoView` only when the focused index actually
  // changes. Instant scroll avoids the visible smooth-scroll animation that
  // previously read as flicker on every arrow press. `flatItems` is stable
  // (memoized), so this effect doesn't fire on unrelated re-renders.
  useEffect(() => {
    if (selectedIndex < 0) return;
    flatItems[selectedIndex]?.onFocus?.();
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, flatItems]);

  if (!items.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No items found
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid={testId}>
      {flatItems.map((item, index) => (
        <MenuItemComponent
          key={item.id}
          item={item}
          isSelected={index === selectedIndex}
          isActive={selectedItemId !== undefined && item.id === selectedItemId}
          onToggleExpanded={toggleExpanded}
          itemRef={(el) => {
            itemRefs.current[index] = el;
          }}
          data-testid={testId ? `${testId}-item-${item.id}` : undefined}
        />
      ))}
    </div>
  );
};
