import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { allExamples, projectForExample } from "@renderer/examples/registry";
import { useHistoryStore } from "@renderer/history/history-store";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { emptyProject, useProjectStore } from "@renderer/project/project-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { THEMES } from "@renderer/theming/themes";
import { commandRegistry } from "../registry";
import type { CommandDefinition } from "../types";

/**
 * Everything the shell can do, by name.
 *
 * A command exists even where a single button would do, because that is what puts it in the palette,
 * makes it bindable to a key, and gives it one implementation rather than one per way of reaching it.
 */
export const SHELL_COMMANDS: CommandDefinition<never>[] = [
  {
    id: "workbench.commandPalette",
    name: "Show All Commands",
    category: "Workbench",
    execute: () => useModalStore.getState().show("command-palette"),
  },
  {
    id: "workbench.cycleTheme",
    name: "Switch Theme",
    category: "Workbench",
    execute: () => {
      const current = useThemeStore.getState().theme.id;
      const index = THEMES.findIndex((t) => t.id === current);
      const next = THEMES[(index + 1) % THEMES.length];
      if (next !== undefined) useThemeStore.getState().setTheme(next.id);
    },
  },
  {
    id: "edit.undo",
    name: "Undo",
    category: "Edit",
    execute: () => useHistoryStore.getState().undo(),
  },
  {
    id: "edit.redo",
    name: "Redo",
    category: "Edit",
    execute: () => useHistoryStore.getState().redo(),
  },
  {
    id: "view.toggleLeft",
    name: "Toggle Left Panel",
    category: "View",
    execute: () => useLayoutStore.getState().toggle("leftVisible"),
  },
  {
    id: "view.toggleRight",
    name: "Toggle Right Panel",
    category: "View",
    execute: () => useLayoutStore.getState().toggle("rightVisible"),
  },
  {
    id: "view.toggleBottom",
    name: "Toggle Bottom Panel",
    category: "View",
    execute: () => useLayoutStore.getState().toggle("centerBottomVisible"),
  },
  {
    id: "view.resetLayout",
    name: "Reset Layout",
    category: "View",
    execute: () => useLayoutStore.getState().reset(),
  },
];

/**
 * One command per module example, so the palette is how you reach them.
 *
 * Searching for a module by name finds its example, which makes the palette the answer to "what does
 * this module do" as well as to "what can this application do".
 */
export function exampleCommands(): CommandDefinition<never>[] {
  return allExamples().map((example) => ({
    id: `example.${example.moduleId}`,
    name: `Example: ${example.name}`,
    category: "Examples",
    description: `${example.description} (${example.moduleId})`,
    execute: () => useProjectStore.getState().open(projectForExample(example)),
  }));
}

const PROJECT_COMMANDS: CommandDefinition<never>[] = [
  {
    id: "project.new",
    name: "New Project",
    category: "Project",
    execute: () => useProjectStore.getState().open(emptyProject()),
  },
  {
    id: "project.close",
    name: "Close Project",
    category: "Project",
    execute: () => {
      const id = useProjectStore.getState().activeId;
      if (id !== null) useProjectStore.getState().close(id);
    },
  },
];

export function registerShellCommands(): void {
  commandRegistry.registerAll(SHELL_COMMANDS);
  commandRegistry.registerAll(PROJECT_COMMANDS);
  commandRegistry.registerAll(exampleCommands());
}
