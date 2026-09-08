import { SettingsPanel } from "@renderer/widgets/SettingsPanel";
import { Settings } from "lucide-react";
import type { WidgetDefinition } from "../types";

/**
 * Wide, and in the centre, because the settings are a document you read and edit rather than a
 * sidebar you glance at.
 */
export const settingsWidget: WidgetDefinition = {
  id: "settings",
  label: "Settings",
  icon: Settings,
  component: SettingsPanel,
  placement: { allowedSlots: ["center"], unique: true },
  defaultSlot: "center",
  size: "wide",
  scrollable: false,
  scope: "settings",
};
