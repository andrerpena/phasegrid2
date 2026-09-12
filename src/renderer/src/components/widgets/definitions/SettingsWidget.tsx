import { Settings } from "lucide-react";
import { lazy, Suspense } from "react";
import type { WidgetDefinition } from "../types";

/**
 * Loaded on first open, not at startup.
 *
 * Monaco is about five megabytes of JavaScript. Imported normally it lands in the chunk that has to
 * be parsed before the window can appear, which delays every launch to pay for a panel most launches
 * never look at. Behind a dynamic import it is its own chunk, fetched the first time the Settings tab
 * is selected.
 *
 * The tab is kept mounted after that -- see `keepMounted` on the centre slot -- so this happens once
 * per session rather than once per glance.
 */
const SettingsContent = lazy(async () => ({
  default: (await import("./settings")).SettingsContent,
}));

const SettingsWidgetComponent = () => (
  <Suspense
    fallback={
      <p className="m-0 p-3 text-xs text-muted-foreground">
        Loading the editor…
      </p>
    }
  >
    <SettingsContent />
  </Suspense>
);

/**
 * Wide, and in the centre, because the settings are a document you read and edit rather than a
 * sidebar you glance at.
 */
export const settingsWidget: WidgetDefinition = {
  id: "settings",
  label: "Settings",
  icon: Settings,
  component: SettingsWidgetComponent,
  placement: { allowedSlots: ["center"], unique: true },
  defaultSlot: "center",
  size: "wide",
  scrollable: false,
  scope: "settings",
};
