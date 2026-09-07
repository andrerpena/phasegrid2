import type { PhasegridTheme } from "../theme";
import { dark } from "./dark";
import { light } from "./light";

export const THEMES: PhasegridTheme[] = [dark, light];
export const DEFAULT_THEME_ID = dark.id;

export function themeById(id: string): PhasegridTheme {
  // Falling back rather than throwing: a config file naming a theme this build removed should open the
  // application in the default theme, not refuse to start.
  return THEMES.find((t) => t.id === id) ?? dark;
}

export { dark, light };
