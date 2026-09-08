import {
  CONTROL_BAR_IDS,
  STATUS_BAR_IDS,
  WIDGET_IDS,
} from "@renderer/config/registry-ids";
import { GRID_VAR_NAMES } from "@renderer/theming/theme";
import { dark } from "@renderer/theming/themes";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CONFIG_SCHEMA } from "./defaults";

/**
 * The settings, as a schema.
 *
 * Two jobs, one definition. At runtime it validates what someone typed, so a slot name from a build
 * that had one more panel in it is reported rather than silently dropping a panel. At edit time it
 * becomes a JSON Schema, which is what makes the settings editor complete a key, describe it in a
 * tooltip and underline a typo — the difference between a settings file you can explore and one you
 * have to read the source to use.
 *
 * `.strict()` on purpose: an unknown key is almost always a misspelling of a known one, and a
 * misspelling that validates is a setting that appears to be set and is not.
 */

const WidgetIdSchema = z.enum(WIDGET_IDS);
const StatusBarIdSchema = z.enum(STATUS_BAR_IDS);
const ControlBarIdSchema = z.enum(CONTROL_BAR_IDS);

const WidgetLayoutSchema = z
  .object({
    "left-top": z.array(WidgetIdSchema).optional(),
    "left-bottom": z.array(WidgetIdSchema).optional(),
    center: z.array(WidgetIdSchema).optional(),
    "center-bottom": z.array(WidgetIdSchema).optional(),
    "right-top": z.array(WidgetIdSchema).optional(),
    "right-bottom": z.array(WidgetIdSchema).optional(),
  })
  // Strict, like the outer object and for the same reason: a slot name that is not a slot is a
  // misspelling, and one that validated would be a panel that quietly went nowhere. It also keeps
  // the generated JSON Schema honest -- `zodToJsonSchema` writes `additionalProperties: false`
  // either way, so a non-strict object here would validate in the editor and not at runtime.
  .strict()
  .describe(CONFIG_SCHEMA["layout.widgets"].description);

const StatusBarLayoutSchema = z
  .object({
    left: z.array(StatusBarIdSchema).optional(),
    right: z.array(StatusBarIdSchema).optional(),
  })
  .strict()
  .describe(CONFIG_SCHEMA["layout.statusBars"].description);

const ControlBarLayoutSchema = z
  .object({
    "left-top": z.array(ControlBarIdSchema).optional(),
    "left-bottom": z.array(ControlBarIdSchema).optional(),
    "right-top": z.array(ControlBarIdSchema).optional(),
    "right-bottom": z.array(ControlBarIdSchema).optional(),
  })
  .strict()
  .describe("Which controls float over the canvas, and where.");

/**
 * Colours, as flat dot-paths.
 *
 * A record rather than an enum of known paths, because the set is open: `getConfigJsonSchema` injects
 * the ones this build knows for autocomplete, and anything else still validates as a string so a
 * settings file written against a build with one more signal role in it does not fail to load.
 */
const ThemeOverridesSchema = z
  .record(z.string(), z.string())
  .describe(CONFIG_SCHEMA.theme.description);

const KeybindingEntrySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .describe(
        'The keystroke, e.g. "mod+k" or "shift+alt+f". `mod` is command on a Mac and control elsewhere, so one file suits both.',
      ),
    // Not an enum: commands are registered at runtime, and one per project in the workspace means the
    // set is not knowable when this schema is built.
    command: z.string().describe("The command to run.").optional(),
    payload: z.unknown().describe("Passed to the command.").optional(),
    scope: z
      .string()
      .describe(
        "The focus region this applies in. A scoped binding beats an unscoped one.",
      )
      .optional(),
    when: z
      .string()
      .describe(
        'A condition, e.g. "hasSelection && !modalOpen". False means the binding does not apply.',
      )
      .optional(),
    remove: z
      .boolean()
      .describe(
        "Takes a default binding away instead of adding one. Needed because your bindings are added on top of the defaults rather than replacing them.",
      )
      .optional(),
  })
  .strict()
  .describe("One keystroke, and what it does.");

export const ConfigOverridesSchema = z
  .object({
    "ui.theme": z
      .string()
      .describe(CONFIG_SCHEMA["ui.theme"].description)
      .optional(),
    "grid.snap": z
      .number()
      .min(1)
      .max(64)
      .describe(CONFIG_SCHEMA["grid.snap"].description)
      .optional(),
    "grid.showParamPorts": z
      .enum(["always", "hover", "never"])
      .describe(CONFIG_SCHEMA["grid.showParamPorts"].description)
      .optional(),
    "engine.blockSize": z
      .number()
      .min(16)
      .max(2048)
      .describe(CONFIG_SCHEMA["engine.blockSize"].description)
      .optional(),
    "engine.voiceCount": z
      .number()
      .min(1)
      .max(32)
      .describe(CONFIG_SCHEMA["engine.voiceCount"].description)
      .optional(),
    "telemetry.fps": z
      .number()
      .min(1)
      .max(120)
      .describe(CONFIG_SCHEMA["telemetry.fps"].description)
      .optional(),
    "layout.widgets": WidgetLayoutSchema.optional(),
    "layout.statusBars": StatusBarLayoutSchema.optional(),
    "layout.controlBars": ControlBarLayoutSchema.optional(),
    theme: ThemeOverridesSchema.optional(),
    keybindings: z
      .array(KeybindingEntrySchema)
      .describe(CONFIG_SCHEMA.keybindings.description)
      .optional(),
  })
  .strict();

export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>;

/** The colour paths this build recognises, for the editor to offer. */
export function knownColourPaths(): { path: string; value: string }[] {
  const paths: { path: string; value: string }[] = [];
  for (const key of Object.keys(GRID_VAR_NAMES))
    paths.push({
      path: `grid.${key}`,
      value: dark.grid[key as keyof typeof GRID_VAR_NAMES],
    });
  for (const [role, value] of Object.entries(dark.grid.signal))
    paths.push({ path: `signal.${role}`, value });
  for (const [role, value] of Object.entries(dark.colors))
    paths.push({ path: `ui.${role}`, value });
  return paths;
}

/**
 * The schema as JSON Schema, for the editor.
 *
 * `theme` is post-processed: Zod says "an object of strings", which is true and useless to complete
 * against, so every colour path this build knows is injected as a property with its default in the
 * description. `additionalProperties` stays, so an unknown path is still valid — see
 * `ThemeOverridesSchema`.
 */
export function getConfigJsonSchema(): object {
  // No `name`, so the result is the object schema itself rather than a `$ref` into a `definitions`
  // block, and `$refStrategy: "none"` inlines the rest. What the editor gets is one self-contained
  // schema with nothing to resolve -- the shape that behaves the same in every JSON language client.
  const schema = zodToJsonSchema(ConfigOverridesSchema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;

  const properties = (schema as { properties?: Record<string, unknown> })
    .properties;
  const themeSchema = properties?.theme as Record<string, unknown> | undefined;

  if (themeSchema !== undefined) {
    const offered: Record<string, object> = {};
    for (const { path, value } of knownColourPaths())
      offered[path] = {
        type: "string",
        default: value,
        description: `Colour override (theme's own value: ${value})`,
      };
    themeSchema.properties = offered;
  }

  return schema;
}
