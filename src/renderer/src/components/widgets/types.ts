import type { WidgetId } from "@renderer/config/registry-ids";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type { WidgetId };

/** The slots a widget can sit in. */
export type WidgetSlotId =
  | "left-top"
  | "left-bottom"
  | "center"
  | "center-bottom"
  | "right-top"
  | "right-bottom";

export const WIDGET_SLOT_IDS: WidgetSlotId[] = [
  "left-top",
  "left-bottom",
  "center",
  "center-bottom",
  "right-top",
  "right-bottom",
];

/**
 * How much room a widget needs.
 *
 * "wide" is the grid and the settings editor: things that want the middle of the window and are
 * useless squeezed into a sidebar. Keeping this declarative means the add-widget menu can simply not
 * offer them somewhere they would not work, rather than letting you put one there and discover it.
 */
export type WidgetSize = "normal" | "wide";

/** Where a wide widget may go. */
export const MAIN_SLOTS: WidgetSlotId[] = ["center", "center-bottom"];

export interface WidgetComponentProps {
  widgetId: WidgetId;
  slotId: WidgetSlotId;
}

export interface WidgetPlacement {
  /** Cannot be closed, and cannot leave its default slot. */
  pinned?: boolean;
  /** If set, the only slots this widget may go in. */
  allowedSlots?: WidgetSlotId[];
  /** At most one of these across the whole layout. */
  unique?: boolean;
}

export interface WidgetDefinition {
  id: WidgetId;
  /** What the tab says. */
  label: string;
  icon?: LucideIcon;
  component: ComponentType<WidgetComponentProps>;
  placement?: WidgetPlacement;
  defaultSlot?: WidgetSlotId;
  size?: WidgetSize;
  /**
   * Off for a widget that fills its slot exactly and should never scroll — a canvas, a minimap.
   * Otherwise pixel rounding flickers a scrollbar in and out as the dock is dragged.
   */
  scrollable?: boolean;
  /**
   * The keybinding focus region for anything inside this widget. A binding scoped to this name
   * applies while focus is here, which is how a widget overrides a global shortcut.
   */
  scope?: string;
}

/** Slot id to the widgets in it, in order. What `layout.widgets` holds. */
export type WidgetLayout = Record<WidgetSlotId, WidgetId[]>;
