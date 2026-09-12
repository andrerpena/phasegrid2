import { ChevronRight } from "lucide-react";
import type { MenuItem } from "../../menu/types";
import { cn } from "../../utils/cn";

/**
 * Internal flattened representation of a MenuItem for rendering.
 * Adds hierarchy metadata needed for tree display.
 */
export interface FlatMenuItem extends MenuItem {
  level: number;
  parentId?: string;
  isExpanded?: boolean;
  hasChildren: boolean;
}

interface MenuItemComponentProps {
  item: FlatMenuItem;
  isSelected: boolean;
  /** True when this item is the externally-selected one (e.g. the active
   *  tool). Distinct from `isSelected`, which tracks keyboard focus. Drawn
   *  with the prominent accent treatment (vs. the subdued muted treatment
   *  used for keyboard focus / hover). */
  isActive?: boolean;
  onToggleExpanded: (itemId: string) => void;
  itemRef: (el: HTMLButtonElement | null) => void;
  "data-testid"?: string;
}

export const MenuItemComponent = ({
  item,
  isSelected,
  isActive = false,
  onToggleExpanded,
  itemRef,
  "data-testid": testId,
}: MenuItemComponentProps) => {
  const handleClick = () => {
    if (item.hasChildren) {
      onToggleExpanded(item.id);
    } else if (item.onExecute) {
      item.onExecute();
    }
  };

  // Two-tier Discord-style highlight, bg-only (no color transition):
  //  - `isActive` (externally-selected row): accent bg + accent-foreground
  //    (brighter) + semibold. The prominent state.
  //  - `isSelected` (keyboard focus) or hover: muted bg. Subdued. Text color
  //    stays at the inherited foreground — dimming text on hover felt like
  //    flicker.
  // Active wins when both apply.
  const commonClassName = cn(
    "flex items-center gap-3 rounded-md py-2 pr-3 text-sm cursor-pointer w-full text-left",
    isActive
      ? "bg-accent text-accent-foreground font-semibold"
      : isSelected
        ? "bg-muted"
        : "hover:bg-muted",
  );

  const commonStyle = { paddingLeft: `${12 + item.level * 16}px` };

  // Instantiate icon if it's a component type
  const IconComponent = item.icon;
  const iconElement = IconComponent ? (
    <IconComponent size={16} className="flex-shrink-0" />
  ) : null;

  const content = (
    <>
      {iconElement && <div className="flex-shrink-0">{iconElement}</div>}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{item.label}</div>
        {item.subtitle && (
          <div className="text-xs truncate text-muted-foreground">
            {item.subtitle}
          </div>
        )}
      </div>
      {item.trailing && (
        <span className="flex-shrink-0 text-xs text-muted-foreground font-mono">
          {item.trailing}
        </span>
      )}
      {item.hasChildren && (
        <div className="flex-shrink-0">
          <div className="w-4 h-4 flex items-center justify-center">
            <ChevronRight
              size={12}
              className={cn(
                "transition-transform",
                item.isExpanded ? "rotate-90" : "rotate-0",
              )}
            />
          </div>
        </div>
      )}
    </>
  );

  return (
    <button
      key={item.id}
      ref={itemRef}
      type="button"
      className={commonClassName}
      style={commonStyle}
      onClick={handleClick}
      data-testid={testId}
    >
      {content}
    </button>
  );
};
