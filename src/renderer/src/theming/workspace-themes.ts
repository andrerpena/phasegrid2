import { useConfigStore } from "@renderer/config/config-store";
import type { ConfigRecord } from "@shared/protocol/storage";
import { z } from "zod";
import type {
  GridColors,
  PhasegridTheme,
  SignalColors,
  UIColors,
} from "./theme";
import { useThemeStore } from "./theme-store";
import { DEFAULT_THEME_ID, THEMES, themeById } from "./themes";

/**
 * Themes a workspace defines for itself, and colour overrides on top of whatever is active.
 *
 * Two settings, one path. `themes` names new palettes; `theme` tweaks colours on the one you are
 * using. Both are resolved here into the finished list the store holds, which is then both injected
 * as CSS and read by the canvas — so a colour written in `workspace.json` reaches the panels and the
 * grid by the same route, and there is one place that decides what a colour ends up being.
 *
 * This is only possible because the palette is data. When the values lived in a hand-written
 * stylesheet, `theme`'s `ui.*` paths were offered by the settings editor's autocomplete and silently
 * did nothing, because nothing could write them into CSS.
 */

/** A partial theme: say what differs from the one you are extending. */
function partialOf<T extends object>(example: T) {
  return z
    .object(
      Object.fromEntries(
        Object.keys(example).map((key) => [key, z.string().optional()]),
      ) as Record<keyof T, z.ZodOptional<z.ZodString>>,
    )
    .strict();
}

const base = themeById(DEFAULT_THEME_ID);
const { signal: signalExample, ...gridExample } = base.grid;

export const WorkspaceThemeSchema = z
  .object({
    name: z.string().min(1).optional().describe("What the picker calls it."),
    type: z
      .enum(["light", "dark"])
      .optional()
      .describe(
        "Which way round it is. Drives `color-scheme`, so the platform's own scrollbars and controls follow.",
      ),
    extends: z
      .string()
      .optional()
      .describe(
        `The theme to start from; anything not mentioned is inherited. Defaults to "${DEFAULT_THEME_ID}".`,
      ),
    colors: partialOf(base.colors).optional().describe("Interface colours."),
    grid: partialOf(gridExample)
      .extend({ signal: partialOf(signalExample).optional() })
      .strict()
      .optional()
      .describe(
        "Canvas colours. These must be `#rrggbb`; the canvas parses nothing else.",
      ),
  })
  .strict();

export const WorkspaceThemesSchema = z
  .record(z.string().min(1), WorkspaceThemeSchema)
  .describe(
    "Themes this workspace defines, keyed by id. Each says only what differs from the theme it extends. An id matching a built-in replaces it.",
  );

export type WorkspaceTheme = z.infer<typeof WorkspaceThemeSchema>;

/** Only `#rrggbb` reaches the canvas — `hexToNumber` parses nothing else, and would give black. */
function isDrawableColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** One workspace theme, resolved against the theme it extends. */
function resolve(
  id: string,
  declared: WorkspaceTheme,
  from: PhasegridTheme[],
): PhasegridTheme {
  const parent =
    from.find((t) => t.id === declared.extends) ?? themeById(DEFAULT_THEME_ID);

  const { signal: signalOverride, ...gridOverride } = declared.grid ?? {};
  const grid: GridColors = {
    ...parent.grid,
    signal: { ...parent.grid.signal },
  };

  for (const [key, value] of Object.entries(gridOverride))
    if (value !== undefined && isDrawableColour(value))
      grid[key as keyof Omit<GridColors, "signal">] = value;
  for (const [role, value] of Object.entries(signalOverride ?? {}))
    if (value !== undefined && isDrawableColour(value))
      grid.signal[role as keyof SignalColors] = value;

  return {
    id,
    name: declared.name ?? id,
    type: declared.type ?? parent.type,
    colors: { ...parent.colors, ...(declared.colors as Partial<UIColors>) },
    grid,
  };
}

const UI_PREFIX = "ui.";
const GRID_PREFIX = "grid.";
const SIGNAL_PREFIX = "signal.";

/**
 * Applies the flat `theme` overrides to one theme.
 *
 * Dot-paths, so they read the way they are written:
 *
 *     "theme": { "ui.background": "oklch(0.1 0 0)", "grid.gridLine": "#202430" }
 *
 * Applied to every theme rather than only the active one. Observationally the same — one theme is
 * active at a time — and it means the generated stylesheet is correct without knowing which.
 * Anything unrecognised is ignored: a settings file naming a colour this build removed should lose
 * that line, not fail to load.
 */
function applyOverrides(
  theme: PhasegridTheme,
  overrides: Record<string, string>,
): PhasegridTheme {
  const colors: UIColors = { ...theme.colors };
  const grid: GridColors = { ...theme.grid, signal: { ...theme.grid.signal } };

  for (const [path, value] of Object.entries(overrides)) {
    if (typeof value !== "string") continue;

    if (path.startsWith(UI_PREFIX)) {
      const key = path.slice(UI_PREFIX.length);
      if (Object.hasOwn(colors, key)) colors[key as keyof UIColors] = value;
      continue;
    }
    // The canvas cannot read anything but hex, so a `grid.*` or `signal.*` override that is not hex
    // is dropped rather than drawn as black.
    if (!isDrawableColour(value)) continue;
    if (path.startsWith(GRID_PREFIX)) {
      const key = path.slice(GRID_PREFIX.length);
      if (key !== "signal" && Object.hasOwn(grid, key))
        grid[key as keyof Omit<GridColors, "signal">] = value;
      continue;
    }
    if (path.startsWith(SIGNAL_PREFIX)) {
      const role = path.slice(SIGNAL_PREFIX.length);
      if (Object.hasOwn(grid.signal, role))
        grid.signal[role as keyof SignalColors] = value;
    }
  }

  return { ...theme, colors, grid };
}

/**
 * Every theme that can be chosen, given the settings.
 *
 * The built-ins first, then the workspace's own — one with a built-in's id replaces it, because "I
 * want dark, but a bit different" is the obvious thing to want and the alternative is making people
 * invent a second name for it.
 *
 * A theme that does not validate is left out and the rest are kept. One malformed entry should cost
 * that entry, not every theme in the file.
 */
export function resolveThemes(config: ConfigRecord): PhasegridTheme[] {
  const resolved = [...THEMES];

  const declared = WorkspaceThemesSchema.safeParse(config.themes);
  if (declared.success) {
    for (const [id, theme] of Object.entries(declared.data)) {
      const built = resolve(id, theme, resolved);
      const at = resolved.findIndex((t) => t.id === id);
      if (at < 0) resolved.push(built);
      else resolved[at] = built;
    }
  }

  const overrides = z.record(z.string(), z.string()).safeParse(config.theme);
  if (!overrides.success) return resolved;
  return resolved.map((theme) => applyOverrides(theme, overrides.data));
}

/**
 * Keeps the theme set in step with the settings. Returns the way to stop.
 *
 * Both keys are watched, because both change what a theme is: `themes` adds and replaces palettes,
 * `theme` tweaks colours in whichever one is active.
 */
export function watchWorkspaceThemes(): () => void {
  const apply = () =>
    useThemeStore
      .getState()
      .setAvailable(resolveThemes(useConfigStore.getState().computed));
  apply();
  return useConfigStore.subscribe((state, previous) => {
    if (
      state.computed.themes !== previous.computed.themes ||
      state.computed.theme !== previous.computed.theme
    )
      apply();
  });
}
