import { useMemo, useState } from "react";
import { Tabs } from "../tabs";
import type { TabItem, TabVariant } from "../tabs/types";
import { SlotAddWidgetMenu } from "./SlotAddWidgetMenu";
import type { WidgetId, WidgetSlotId } from "./types";
import { WidgetTabContextMenu } from "./WidgetTabContextMenu";
import { useWidgetLayoutStore, useWidgetsForSlot } from "./widget-layout-store";
import { widgetRegistry } from "./widget-registry";

/**
 * One dock slot, as a tab strip.
 *
 * A slot with nothing in it renders nothing, which is what lets the dock give the room back — see
 * `Dock.tsx`. Tabs show even for a single widget, because the strip is where the panel's name, its
 * `⋮` menu and the `+` that adds another all live, and a panel with no strip is a panel you cannot
 * move or close.
 */
export const WidgetSlot = ({
  slotId,
  variant = "secondary",
  keepMounted = false,
}: {
  slotId: WidgetSlotId;
  variant?: TabVariant;
  /**
   * Keeps every panel in the slot mounted and hides the inactive ones.
   *
   * The centre needs it: the grid owns a canvas with a graphics context and an engine subscription,
   * and unmounting it to look at the settings would throw both away and rebuild them on the way back.
   */
  keepMounted?: boolean;
}) => {
  const widgetIds = useWidgetsForSlot(slotId);
  const removeWidget = useWidgetLayoutStore((s) => s.removeWidget);
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined);

  const tabs = useMemo<TabItem[]>(() => {
    const result: TabItem[] = [];
    for (const widgetId of widgetIds) {
      const definition = widgetRegistry.get(widgetId);
      // A name in the settings file with no widget behind it is skipped rather than fatal: the
      // layout is normalised on read, so this only happens for a widget unregistered at runtime.
      if (definition === undefined) continue;
      const Component = definition.component;
      result.push({
        id: widgetId,
        label: definition.label,
        icon: definition.icon,
        closable: definition.placement?.pinned !== true,
        scrollable: definition.scrollable,
        content: (
          <div
            className="h-full min-h-0"
            data-kb-scope={definition.scope}
            data-widget={widgetId}
          >
            <Component widgetId={widgetId} slotId={slotId} />
          </div>
        ),
        contextMenu: (
          <WidgetTabContextMenu widgetId={widgetId} currentSlotId={slotId} />
        ),
      });
    }
    return result;
  }, [widgetIds, slotId]);

  if (tabs.length === 0) return null;

  return (
    <Tabs
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      onTabClose={(tabId) => removeWidget(tabId as WidgetId)}
      variant={variant}
      keepMounted={keepMounted}
      className="h-full"
      trailingAction={<SlotAddWidgetMenu slotId={slotId} />}
    />
  );
};
