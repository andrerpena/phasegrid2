import { useConfigStore } from "@renderer/config/config-store";
import { create } from "zustand";
import {
  MAIN_SLOTS,
  WIDGET_SLOT_IDS,
  type WidgetId,
  type WidgetLayout,
  type WidgetSlotId,
} from "./types";
import { widgetRegistry } from "./widget-registry";

/**
 * Which widget is in which slot.
 *
 * The layout lives in the workspace's settings under `layout.widgets`, not in this store — this is a
 * view of it that the dock can subscribe to, and the place the rules about what may go where are
 * enforced. Moving a panel and editing the settings file are the same operation reached two ways,
 * which is why both end up writing the same key.
 *
 * Column widths are *not* here. Those are about the size of your monitor rather than about the work,
 * so they stay in `layout-store` under `userData` and do not travel with a workspace.
 */

export const CONFIG_KEY = "layout.widgets";

/** Every slot present, so a caller never has to check for undefined. */
export function emptyLayout(): WidgetLayout {
  return {
    "left-top": [],
    "left-bottom": [],
    center: [],
    "center-bottom": [],
    "right-top": [],
    "right-bottom": [],
  };
}

/** Can this widget go there? */
export function canAddWidgetToSlot(
  widgetId: string,
  slotId: WidgetSlotId,
): boolean {
  const definition = widgetRegistry.get(widgetId);
  if (definition === undefined) return false;
  if (definition.size === "wide" && !MAIN_SLOTS.includes(slotId)) return false;
  const allowed = definition.placement?.allowedSlots;
  return allowed === undefined || allowed.includes(slotId);
}

export function canRemoveWidget(widgetId: string): boolean {
  return widgetRegistry.get(widgetId)?.placement?.pinned !== true;
}

/**
 * Reads a layout out of whatever the settings file happens to contain.
 *
 * Every part of this is defensive because the input is a file a person edits by hand: a slot that is
 * not a list, a widget id from a build that had one more module in it, the same widget listed twice.
 * None of those should cost more than the line they are on.
 */
function normalise(raw: unknown): WidgetLayout {
  const layout = emptyLayout();
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    for (const slot of WIDGET_SLOT_IDS) {
      const value = record[slot];
      if (!Array.isArray(value)) continue;
      for (const id of value) {
        if (typeof id !== "string" || !widgetRegistry.has(id)) continue;
        if (!layout[slot].includes(id as WidgetId))
          layout[slot].push(id as WidgetId);
      }
    }
  }
  return enforce(layout);
}

/**
 * Puts back what has to be there and removes what cannot be twice.
 *
 * A pinned widget missing from the file reappears in its own slot, so deleting the grid from
 * `workspace.json` gives you back a window with a grid in it rather than an empty frame you cannot
 * recover from by any means the application offers.
 */
function enforce(layout: WidgetLayout): WidgetLayout {
  const result: WidgetLayout = { ...layout };

  for (const definition of widgetRegistry.all()) {
    const slots = WIDGET_SLOT_IDS.filter((s) =>
      result[s].includes(definition.id),
    );

    if (definition.placement?.unique === true && slots.length > 1) {
      const keep =
        definition.defaultSlot !== undefined &&
        slots.includes(definition.defaultSlot)
          ? definition.defaultSlot
          : slots[0];
      for (const slot of slots)
        if (slot !== keep)
          result[slot] = result[slot].filter((id) => id !== definition.id);
    }

    if (
      definition.placement?.pinned === true &&
      definition.defaultSlot !== undefined &&
      !WIDGET_SLOT_IDS.some((s) => result[s].includes(definition.id))
    ) {
      result[definition.defaultSlot] = [
        definition.id,
        ...result[definition.defaultSlot],
      ];
    }
  }

  return result;
}

function readFromConfig(): WidgetLayout {
  return normalise(useConfigStore.getState().computed[CONFIG_KEY]);
}

function persist(layout: WidgetLayout): void {
  useConfigStore.getState().set(CONFIG_KEY, layout as never);
}

export interface WidgetLayoutStore {
  layout: WidgetLayout;
  /** Returns false when placement rules forbid it. */
  addWidgetToSlot: (widgetId: WidgetId, slotId: WidgetSlotId) => boolean;
  /** Takes a widget out of whichever slot it is in. False if it is pinned. */
  removeWidget: (widgetId: WidgetId) => boolean;
  /** Removes it from wherever it is and puts it in `slotId`. */
  moveWidget: (widgetId: WidgetId, slotId: WidgetSlotId) => boolean;
  reset: () => void;
}

export const useWidgetLayoutStore = create<WidgetLayoutStore>((set, get) => ({
  layout: readFromConfig(),

  addWidgetToSlot: (widgetId, slotId) => {
    if (!canAddWidgetToSlot(widgetId, slotId)) return false;
    const layout = { ...get().layout };
    if (layout[slotId].includes(widgetId)) return true;
    layout[slotId] = [...layout[slotId], widgetId];
    set({ layout });
    persist(layout);
    return true;
  },

  removeWidget: (widgetId) => {
    if (!canRemoveWidget(widgetId)) return false;
    const layout = { ...get().layout };
    for (const slot of WIDGET_SLOT_IDS)
      layout[slot] = layout[slot].filter((id) => id !== widgetId);
    set({ layout });
    persist(layout);
    return true;
  },

  moveWidget: (widgetId, slotId) => {
    if (!canAddWidgetToSlot(widgetId, slotId)) return false;
    const definition = widgetRegistry.get(widgetId);
    // A pinned widget stays where it is: it is pinned to a slot, not merely uncloseable.
    if (
      definition?.placement?.pinned === true &&
      definition.defaultSlot !== slotId
    )
      return false;
    const layout = { ...get().layout };
    for (const slot of WIDGET_SLOT_IDS)
      layout[slot] = layout[slot].filter((id) => id !== widgetId);
    layout[slotId] = [...layout[slotId], widgetId];
    set({ layout });
    persist(layout);
    return true;
  },

  reset: () => {
    useConfigStore.getState().remove(CONFIG_KEY);
    set({ layout: readFromConfig() });
  },
}));

/**
 * Follows the settings file.
 *
 * Editing `layout.widgets` in the settings editor has to move the panels, which is the whole reason
 * the layout lives there. Guarded against the write this store just made: `persist` sets the same
 * key, and re-reading it unconditionally would be a loop.
 */
export function watchWidgetLayout(): () => void {
  return useConfigStore.subscribe((state, previous) => {
    if (state.computed[CONFIG_KEY] === previous.computed[CONFIG_KEY]) return;
    const next = normalise(state.computed[CONFIG_KEY]);
    const current = useWidgetLayoutStore.getState().layout;
    if (JSON.stringify(next) !== JSON.stringify(current))
      useWidgetLayoutStore.setState({ layout: next });
  });
}

/** Re-reads the layout once every widget has registered. Called at startup, after registration. */
export function refreshWidgetLayout(): void {
  useWidgetLayoutStore.setState({ layout: readFromConfig() });
}

export const useWidgetsForSlot = (slotId: WidgetSlotId): WidgetId[] =>
  useWidgetLayoutStore((s) => s.layout[slotId]);
