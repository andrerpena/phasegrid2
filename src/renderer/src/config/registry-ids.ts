/**
 * Every id the layout can name, in one place.
 *
 * The settings file can move a widget between slots, reorder the status bar and bind a key to a
 * command, which means those names are part of a file a person edits. Listing them here is what lets
 * the config schema turn each into a Zod enum, and that is what makes the settings editor complete a
 * name and underline a typo instead of silently dropping a panel.
 *
 * Adding a widget is: a line here, a definition file, and a line in `register-widgets.ts`.
 */

export const WIDGET_IDS = [
  "grid",
  "settings",
  "catalog",
  "projects",
  "history",
  "inspector",
  "mini-map",
  "scope",
  "log",
  "performance",
] as const;

export const STATUS_BAR_IDS = [
  "workspace",
  "engine",
  "theme",
  "version",
  "run-command",
] as const;

export const CONTROL_BAR_IDS = ["zoom-control"] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];
export type StatusBarId = (typeof STATUS_BAR_IDS)[number];
export type ControlBarId = (typeof CONTROL_BAR_IDS)[number];

export function isWidgetId(id: string): id is WidgetId {
  return (WIDGET_IDS as readonly string[]).includes(id);
}
