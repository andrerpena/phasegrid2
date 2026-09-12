import type { Keybinding } from "./keybindings";

/**
 * The bindings this build ships with.
 *
 * Registered first; a user's file is loaded after and therefore wins on any key it repeats. Nothing
 * here is scoped except where a global binding would be wrong, and everything destructive carries a
 * condition, because a shortcut that deletes with nothing selected is a shortcut that eventually
 * deletes the wrong thing.
 */
export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { key: "mod+shift+p", command: "workbench.commandPalette" },
  { key: "mod+k", command: "workbench.commandPalette" },
  { key: "mod+z", command: "edit.undo", when: "!modalOpen" },
  { key: "mod+shift+z", command: "edit.redo", when: "!modalOpen" },
  { key: "mod+b", command: "view.toggleLeft" },
  { key: "mod+alt+b", command: "view.toggleRight" },
  { key: "mod+j", command: "view.toggleBottom" },
  { key: "mod+alt+t", command: "workbench.setTheme" },
  { key: "mod+s", command: "project.save" },
  { key: "mod+shift+s", command: "project.saveAs" },
  // Scoped to the grid and conditional on a selection, because a shortcut that deletes with nothing
  // selected is a shortcut that eventually deletes the wrong thing. Backspace as well as delete: the
  // key a laptop keyboard actually has is the one people press.
  {
    key: "delete",
    command: "patch.deleteSelection",
    scope: "grid",
    when: "hasSelection",
  },
  {
    key: "backspace",
    command: "patch.deleteSelection",
    scope: "grid",
    when: "hasSelection",
  },
];
