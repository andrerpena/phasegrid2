import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../dropdown-menu";
import { SLOT_LABELS } from "./slot-labels";
import { WIDGET_SLOT_IDS, type WidgetId, type WidgetSlotId } from "./types";
import {
  canAddWidgetToSlot,
  canRemoveWidget,
  useWidgetLayoutStore,
} from "./widget-layout-store";

/**
 * A tab's `⋮` menu: move this panel somewhere else, or close it.
 *
 * Slots it cannot go in are left out rather than shown disabled — the list is short, and a menu of
 * mostly-grey entries reads as broken.
 */
export const WidgetTabContextMenu = ({
  widgetId,
  currentSlotId,
}: {
  widgetId: WidgetId;
  currentSlotId: WidgetSlotId;
}) => {
  const moveWidget = useWidgetLayoutStore((s) => s.moveWidget);
  const removeWidget = useWidgetLayoutStore((s) => s.removeWidget);

  const targets = WIDGET_SLOT_IDS.filter(
    (slot) => slot !== currentSlotId && canAddWidgetToSlot(widgetId, slot),
  );

  return (
    <>
      {targets.length > 0 && (
        <>
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {targets.map((slot) => (
            <DropdownMenuItem
              key={slot}
              onSelect={() => moveWidget(widgetId, slot)}
            >
              {SLOT_LABELS[slot]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        variant="destructive"
        disabled={!canRemoveWidget(widgetId)}
        onSelect={() => removeWidget(widgetId)}
      >
        Close
      </DropdownMenuItem>
    </>
  );
};
