import { compileWhen, type WhenContext } from "./when";

/**
 * Keystrokes to commands.
 *
 * A binding may carry a `when` clause and a `scope`. Both narrow when it applies, and the difference is
 * how ties break: a scoped binding beats an unscoped one, so a widget can override a global shortcut
 * without having to know what the global one is. Among equals, the last registered wins, which is what
 * makes a user's file override the defaults simply by being loaded after them.
 *
 * The shell this is copied from had neither scopes nor when clauses, so a shortcut that made sense over
 * the canvas also fired inside a text field. That is the flaw being fixed rather than reproduced.
 */

export interface Keybinding {
  /** Normalised form, e.g. `mod+z`, `shift+alt+f`, `escape`. */
  key: string;
  command: string;
  payload?: unknown;
  /** The focus region this belongs to, matched against `context.focus`. */
  scope?: string;
  /** An expression over the context; see `when.ts`. */
  when?: string;
}

export interface KeybindingContext extends WhenContext {
  /** Which region has focus, from the nearest `data-kb-scope` ancestor of the focused element. */
  focus: string;
  modalOpen: boolean;
  hasSelection: boolean;
  engineReady: boolean;
}

/**
 * A keyboard event as a canonical string.
 *
 * `mod` is command on Apple platforms and control elsewhere, so one keybindings file suits both and a
 * person reading it sees the shortcut they were taught rather than a platform conditional.
 */
export function eventToKey(
  event: KeyboardEvent,
  isApple = /mac|iphone|ipad/i.test(navigator.platform),
): string {
  const parts: string[] = [];
  const mod = isApple ? event.metaKey : event.ctrlKey;
  if (mod) parts.push("mod");
  // The other of the two, when it is not acting as `mod`, is still a real modifier and must be recorded
  // or `ctrl+z` on an Apple keyboard would be indistinguishable from `z`.
  if (isApple ? event.ctrlKey : event.metaKey)
    parts.push(isApple ? "ctrl" : "meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  const key =
    event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

interface Compiled extends Keybinding {
  index: number;
  test: (context: WhenContext) => boolean;
}

export class KeybindingRegistry {
  private compiled: Compiled[] = [];

  /** Replaces everything. Defaults are registered first, then the user's file on top. */
  setBindings(bindings: Keybinding[]): void {
    this.compiled = bindings.map((binding, index) => ({
      ...binding,
      index,
      // A clause that does not parse never matches, rather than throwing on a keystroke or, worse,
      // matching everything.
      test: binding.when === undefined ? () => true : safeCompile(binding.when),
    }));
  }

  /**
   * The binding that should run for this key, or undefined.
   *
   * Scoped beats unscoped; among equals the last registered wins. Both rules exist so that adding a
   * binding never silently changes which of the others applies.
   */
  resolve(key: string, context: KeybindingContext): Keybinding | undefined {
    let best: Compiled | undefined;
    for (const binding of this.compiled) {
      if (binding.key !== key) continue;
      if (binding.scope !== undefined && binding.scope !== context.focus)
        continue;
      if (!binding.test(context)) continue;
      if (best === undefined) {
        best = binding;
        continue;
      }
      const bestScoped = best.scope !== undefined;
      const thisScoped = binding.scope !== undefined;
      if (thisScoped && !bestScoped) best = binding;
      else if (thisScoped === bestScoped && binding.index > best.index)
        best = binding;
    }
    return best;
  }

  all(): Keybinding[] {
    return this.compiled.map(
      ({ index: _index, test: _test, ...binding }) => binding,
    );
  }
}

function safeCompile(clause: string): (context: WhenContext) => boolean {
  try {
    return compileWhen(clause);
  } catch {
    return () => false;
  }
}

export const keybindingRegistry = new KeybindingRegistry();

/** The focus region of the element with focus, from the nearest ancestor that declares one. */
export function focusScope(element: Element | null): string {
  return (
    element?.closest<HTMLElement>("[data-kb-scope]")?.dataset.kbScope ?? "none"
  );
}
