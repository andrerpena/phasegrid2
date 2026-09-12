import type { ConfigRecord, ConfigValue } from "@shared/protocol/storage";

/**
 * Every setting, with its type and its default.
 *
 * One table rather than a bare object of values, because three things need more than the value: the
 * settings editor's Defaults tab shows it, the Zod schema validates against it, and the description
 * is what Monaco puts in a tooltip. Keeping them together is what stops a new setting from being
 * added to the code and never appearing in the editor.
 */

export interface ConfigPropertySchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  default: ConfigValue;
  description: string;
  minimum?: number;
  maximum?: number;
  enum?: ConfigValue[];
}

export const CONFIG_SCHEMA: Record<string, ConfigPropertySchema> = {
  "ui.theme": {
    type: "string",
    default: "dark",
    description: "The theme the window opens in.",
  },
  "grid.snap": {
    type: "number",
    default: 8,
    description: "Grid spacing a dragged module snaps to, in patch units.",
    minimum: 1,
    maximum: 64,
  },
  "grid.showParamPorts": {
    type: "string",
    default: "hover",
    description:
      'When a module\'s parameter inputs are drawn: "always", "hover" or "never".',
    enum: ["always", "hover", "never"],
  },
  "engine.blockSize": {
    type: "number",
    default: 64,
    description:
      "Frames the engine renders per block. Smaller is lower latency and more overhead.",
    minimum: 16,
    maximum: 2048,
  },
  "telemetry.fps": {
    type: "number",
    default: 30,
    description:
      "How often the canvas reads the engine's meters and scopes, in frames per second.",
    minimum: 1,
    maximum: 120,
  },
  "layout.widgets": {
    type: "object",
    default: {
      "left-top": ["catalog"],
      "left-bottom": ["projects", "history"],
      center: ["grid", "settings"],
      "center-bottom": ["inspector", "log"],
      "right-top": ["mini-map"],
      "right-bottom": ["scope", "performance"],
    },
    description:
      "Which panel is in which dock slot. Column widths are not here -- those are about your display and live outside the workspace.",
  },
  "layout.controlBars": {
    type: "object",
    default: {
      "left-top": [],
      "left-bottom": [],
      "right-top": ["zoom-control"],
      "right-bottom": [],
    },
    description: "Which controls float over the canvas, and in which corner.",
  },
  "layout.statusBars": {
    type: "object",
    default: {
      left: ["workspace", "engine", "run-command"],
      right: ["theme", "version"],
    },
    description: "What the strip along the bottom shows, and in what order.",
  },
  theme: {
    type: "object",
    default: {},
    description:
      'Colour overrides on whichever theme is active, as flat dot-paths: "ui.background", "grid.gridLine", "signal.audio". Says what you changed rather than restating a palette.',
  },
  themes: {
    type: "object",
    default: {},
    description:
      'Themes this workspace defines, keyed by id. Each says only what differs from the theme it extends, e.g. { "midnight": { "name": "Midnight", "extends": "dark", "colors": { "background": "oklch(0.1 0.02 260)" } } }. An id matching a built-in replaces it.',
  },
  keybindings: {
    type: "array",
    default: [],
    /**
     * Empty by default: what ships is `DEFAULT_KEYBINDINGS`, and what is written here is added after
     * it, so a user's file says what they changed rather than restating everything they did not. The
     * key is listed all the same, so the settings editor shows it exists.
     */
    description:
      'Keystrokes to commands, added on top of the defaults. Use "remove": true to take a default away.',
  },
};

export function getDefaultConfig(): ConfigRecord {
  const defaults: ConfigRecord = {};
  for (const [key, property] of Object.entries(CONFIG_SCHEMA))
    defaults[key] = property.default;
  return defaults;
}

export const DEFAULT_CONFIG: ConfigRecord = getDefaultConfig();
