import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import type { WidgetSlotId } from "./types";
import {
  canAddWidgetToSlot,
  useWidgetLayoutStore,
} from "./widget-layout-store";
import { widgetRegistry } from "./widget-registry";

/**
 * The `+` at the end of a slot's tab strip: what else could go here.
 *
 * Only widgets that are not already somewhere and are allowed in this slot are offered, so the menu
 * never contains an entry that would do nothing. A slot with nothing to offer shows no button at all
 * rather than a button that opens an empty menu.
 */
export const SlotAddWidgetMenu = ({ slotId }: { slotId: WidgetSlotId }) => {
  const layout = useWidgetLayoutStore((s) => s.layout);
  const addWidgetToSlot = useWidgetLayoutStore((s) => s.addWidgetToSlot);

  const placed = new Set(Object.values(layout).flat());
  const available = widgetRegistry
    .all()
    .filter((w) => !placed.has(w.id) && canAddWidgetToSlot(w.id, slotId))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (available.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-accent hover:opacity-100"
          aria-label={`Add a panel to ${slotId}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuLabel>Add panel</DropdownMenuLabel>
        {available.map((widget) => (
          <DropdownMenuItem
            key={widget.id}
            onSelect={() => addWidgetToSlot(widget.id, slotId)}
          >
            {widget.icon !== undefined && <widget.icon />}
            {widget.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
