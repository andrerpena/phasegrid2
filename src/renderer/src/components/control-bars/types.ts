import type { ControlBarId } from "@renderer/config/registry-ids";
import type { ComponentType } from "react";

export type { ControlBarId };

/** The corners of the canvas a control bar can float in. */
export type ControlBarPosition =
  | "left-top"
  | "left-bottom"
  | "right-top"
  | "right-bottom";

export const CONTROL_BAR_POSITIONS: ControlBarPosition[] = [
  "left-top",
  "left-bottom",
  "right-top",
  "right-bottom",
];

export interface ControlBarProps {
  barId: ControlBarId;
  position: ControlBarPosition;
}

/** Where it goes is the layout's business, not the definition's. */
export interface ControlBarDefinition {
  id: ControlBarId;
  component: ComponentType<ControlBarProps>;
  defaultPosition?: ControlBarPosition;
}

/** What `layout.controlBars` holds. */
export type ControlBarLayout = Record<ControlBarPosition, ControlBarId[]>;
