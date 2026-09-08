import type { StatusBarId } from "@renderer/config/registry-ids";
import type { ComponentType } from "react";

export type { StatusBarId };

export type StatusBarAlignment = "left" | "right";

export interface StatusBarItemProps {
  itemId: StatusBarId;
}

export interface StatusBarItemDefinition {
  id: StatusBarId;
  component: ComponentType<StatusBarItemProps>;
  /** Where it sits when the settings file does not say. */
  defaultAlignment?: StatusBarAlignment;
}

/** What `layout.statusBars` holds: alignment to item ids, in order. */
export type StatusBarLayout = Record<StatusBarAlignment, StatusBarId[]>;
