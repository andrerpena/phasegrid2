import type { PhasegridTheme } from "../theme";
import { dark } from "./dark";
import { light } from "./light";
import { paper } from "./paper";
import { terminal } from "./terminal";

/** Keyed, because `Set Theme` and the config's `ui.theme` both look a theme up by name. */
export const themeMap = {
  dark,
  light,
  paper,
  terminal,
} as const satisfies Record<string, PhasegridTheme>;

export type AvailableThemeId = keyof typeof themeMap;

export const THEMES: PhasegridTheme[] = Object.values(themeMap);
export const DEFAULT_THEME_ID: AvailableThemeId = "dark";

export function isThemeId(id: string): id is AvailableThemeId {
  return id in themeMap;
}

export function themeById(id: string): PhasegridTheme {
  // Falling back rather than throwing: a config file naming a theme this build removed should open the
  // application in the default theme, not refuse to start.
  return isThemeId(id) ? themeMap[id] : themeMap[DEFAULT_THEME_ID];
}

export { dark, light, paper, terminal };
