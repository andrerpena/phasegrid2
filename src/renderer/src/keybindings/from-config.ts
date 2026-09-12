import type { ConfigValue } from "@shared/protocol/storage";
import { z } from "zod";
import { DEFAULT_KEYBINDINGS } from "./defaults";
import { type Keybinding, KeybindingSchema } from "./keybindings";

/**
 * The bindings the application should be running, given the settings.
 *
 * The defaults first and the user's after, because the registry resolves ties by "last registered wins".
 * That is what lets a settings file say only what it changed rather than restating everything it did
 * not, and what makes `remove` meaningful.
 */

const KeybindingsSchema = z.array(KeybindingSchema);

export interface BindingsResult {
  bindings: Keybinding[];
  /** What to show in the settings editor when the value was rejected. Null when it was fine. */
  error: string | null;
}

export function bindingsFromConfig(value: ConfigValue): BindingsResult {
  // Absent is not wrong: most workspaces never set this.
  if (value === null || value === undefined)
    return { bindings: [...DEFAULT_KEYBINDINGS], error: null };

  const parsed = KeybindingsSchema.safeParse(value);
  if (!parsed.success) {
    // The defaults, not nothing. A malformed settings file must not leave the application with no
    // keyboard — including no way to open the settings editor and fix it.
    return {
      bindings: [...DEFAULT_KEYBINDINGS],
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }
  return {
    bindings: [...DEFAULT_KEYBINDINGS, ...(parsed.data as Keybinding[])],
    error: null,
  };
}
