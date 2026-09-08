import {
  forwardRef,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MenuItem } from "../../menu/types";
import { flattenForSearch, rankMenuItems } from "./rank";
import { SearchTextInput } from "./SearchTextInput";
import { TreeNavigator } from "./TreeNavigator";

/**
 * A searchable list of things, driven from the keyboard.
 *
 * One component for every place this shape appears: the command palette, the theme picker, the
 * module catalogue. They are the same interaction -- type to narrow, arrow to move, enter to choose
 * -- and one implementation means the keyboard behaves identically everywhere rather than almost
 * identically.
 */

export type SearchableTreeNavigatorProps = {
  items: MenuItem[];
  placeHolder: string;
  height?: "full" | number | string;
  /** Id of the externally-selected item (e.g. the currently active tool).
   *  Forwarded to `TreeNavigator` — renders the matching row with the
   *  prominent accent treatment. Omit for command-palette usage where no
   *  persistent selection exists. */
  selectedItemId?: string;
  /** Parents to start expanded. See `TreeNavigator`. */
  defaultExpandedIds?: string[];
  /** When true, focus the search input on mount. Defaults to `false` so the
   *  navigator doesn't steal focus when used as a sidebar widget. The
   *  command-palette modal sets this to `true`. */
  autoFocusInput?: boolean;
  /** Test ID for the navigator container */
  "data-testid"?: string;
};

export const SearchableTreeNavigator = forwardRef<
  HTMLInputElement,
  SearchableTreeNavigatorProps
>((props, ref) => {
  const internalRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Expose the internal ref through the forwarded ref
  useImperativeHandle(ref, () => internalRef.current as HTMLInputElement, []);

  // Focus the search input on mount when the caller asks for it. The previous
  // double-rAF was a HeadlessUI workaround we no longer need.
  useEffect(() => {
    if (!props.autoFocusInput) return;
    internalRef.current?.focus();
  }, [props.autoFocusInput]);

  // Searching flattens the tree, so an item nested under a collapsed parent is still reachable,
  // and ranks what is left. An empty query is the identity, which is what keeps a deliberately
  // ordered menu in its own order until someone actually types.
  const filteredItems = useMemo(() => {
    if (searchQuery.trim() === "") return props.items;
    return rankMenuItems(flattenForSearch(props.items), searchQuery);
  }, [props.items, searchQuery]);

  // Calculate container height and styles
  const getContainerStyle = () => {
    if (props.height === "full") {
      return { height: "100%" };
    }
    if (typeof props.height === "number") {
      return { height: `${props.height}px` };
    }
    if (typeof props.height === "string") {
      return { height: props.height };
    }
    return {};
  };

  const testId = props["data-testid"];

  return (
    <div
      className={props.height ? "flex flex-col gap-2" : "space-y-2"}
      style={getContainerStyle()}
      data-testid={testId}
    >
      {/* Search Input - Always visible */}
      <div className="flex-shrink-0">
        <SearchTextInput
          ref={internalRef}
          placeholder={props.placeHolder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid={testId ? `${testId}-search` : undefined}
        />
      </div>

      {/* Navigator List - Scrollable */}
      <div className={props.height ? "flex-1 overflow-y-auto min-h-0" : ""}>
        <TreeNavigator
          items={filteredItems}
          searchInputRef={internalRef as RefObject<HTMLInputElement>}
          selectedItemId={props.selectedItemId}
          defaultExpandedIds={props.defaultExpandedIds}
          data-testid={testId ? `${testId}-list` : undefined}
        />
      </div>
    </div>
  );
});

SearchableTreeNavigator.displayName = "SearchableTreeNavigator";
