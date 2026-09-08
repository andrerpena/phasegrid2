export * from "./definitions";
export { registerBuiltInWidgets } from "./register-widgets";
export { SLOT_LABELS } from "./slot-labels";
export type {
  WidgetComponentProps,
  WidgetDefinition,
  WidgetId,
  WidgetLayout,
  WidgetSlotId,
} from "./types";
export { MAIN_SLOTS, WIDGET_SLOT_IDS } from "./types";
export { WidgetSlot } from "./WidgetSlot";
export {
  canAddWidgetToSlot,
  canRemoveWidget,
  emptyLayout,
  refreshWidgetLayout,
  useWidgetLayoutStore,
  useWidgetsForSlot,
  watchWidgetLayout,
} from "./widget-layout-store";
export { widgetRegistry } from "./widget-registry";
