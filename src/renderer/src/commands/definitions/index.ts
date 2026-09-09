import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { allExamples } from "@renderer/examples/registry";
import { useHistoryStore } from "@renderer/history/history-store";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { deleteSelection } from "@renderer/patch/delete-selection";
import { editModuleText } from "@renderer/patch/editor/edit-text";
import { emptyProject, useProjectStore } from "@renderer/project/project-store";
import { useTransportStore } from "@renderer/transport/transport-store";
import { SAVE_AS_MODAL } from "@renderer/workspace/SaveAsDialog";
import { closeProject, resolveUnsaved } from "@renderer/workspace/unsaved";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import { commandRegistry } from "../registry";
import type { CommandDefinition } from "../types";
import { workbenchSetTheme } from "./workbench.setTheme";

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
  workbenchSetTheme,
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
 *
 * Running one copies the example into the workspace and opens the copy: a project of the user's own,
 * with a folder of its own and nothing withheld. What you find out about the module you find out in
 * something you can then keep building in.
 */
export function exampleCommands(): CommandDefinition<never>[] {
  return allExamples().map((example) => ({
    id: `example.${example.moduleId}`,
    name: `Example: ${example.name}`,
    category: "Examples",
    description: `${example.description} (${example.moduleId})`,
    execute: async () => {
      await useWorkspaceStore.getState().copyExample(example);
    },
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
    execute: async () => {
      const id = useProjectStore.getState().activeId;
      if (id !== null) await closeProject(id);
    },
  },
  {
    /**
     * Saves where it already lives, or asks where to put it.
     *
     * A project that has been saved before has one right answer and is given it; one that has never
     * been saved gets the name dialog, because it has no name on disk yet to be right about.
     */
    id: "project.save",
    name: "Save Project",
    category: "Project",
    execute: async () => {
      const project = useProjectStore.getState().active();
      if (project === null) return;
      if (project.slug === undefined) {
        useModalStore.getState().show(SAVE_AS_MODAL);
        return;
      }
      await useWorkspaceStore.getState().saveProject(project.id);
    },
  },
  {
    id: "project.saveAs",
    name: "Save Project As…",
    category: "Project",
    execute: () => {
      if (useProjectStore.getState().activeId === null) return;
      useModalStore.getState().show(SAVE_AS_MODAL);
    },
  },
];

const PATCH_COMMANDS: CommandDefinition<never>[] = [
  {
    id: "patch.deleteSelection",
    name: "Delete Selection",
    category: "Patch",
    description:
      "Removes the selected modules, and the cables attached to them",
    execute: () => deleteSelection(),
  },
];

/**
 * Opening a module's text editor by name.
 *
 * Hidden, because the payload is a module id and a property id and nobody types that into a
 * palette. It exists so the gesture has a name a script can call before it has a button: the
 * inspector's expand button, a double-click on the face and a scenario all reach the same editor.
 */
const TEXT_COMMANDS: CommandDefinition<{ module: string; text: string }>[] = [
  {
    id: "patch.editText",
    name: "Edit Text Property",
    category: "Patch",
    hidden: true,
    execute: (_context, payload) =>
      editModuleText(payload.module, payload.text),
  },
];

/** Play and stop by name, so a key, the palette and a script reach the same button. */
const TRANSPORT_COMMANDS: CommandDefinition<never>[] = [
  {
    id: "transport.play",
    name: "Play",
    category: "Transport",
    execute: () => useTransportStore.getState().play(),
  },
  {
    id: "transport.stop",
    name: "Stop",
    category: "Transport",
    execute: () => useTransportStore.getState().stop(),
  },
  {
    id: "transport.toggle",
    name: "Play / Stop",
    category: "Transport",
    execute: () => useTransportStore.getState().toggle(),
  },
];

const WORKSPACE_COMMANDS: CommandDefinition<never>[] = [
  {
    id: "workspace.open",
    name: "Open Workspace…",
    category: "Workspace",
    description: "Switch to another folder of projects",
    execute: async () => {
      // Asked before the dialog rather than after: a person who is told they have unsaved work while a
      // folder chooser is up has already made a decision they did not know they were making.
      if (!(await resolveUnsaved())) return;
      await useWorkspaceStore.getState().choose();
    },
  },
];

export function registerShellCommands(): void {
  commandRegistry.registerAll(SHELL_COMMANDS);
  commandRegistry.registerAll(PROJECT_COMMANDS);
  commandRegistry.registerAll(PATCH_COMMANDS);
  commandRegistry.registerAll(TEXT_COMMANDS as CommandDefinition<never>[]);
  commandRegistry.registerAll(TRANSPORT_COMMANDS);
  commandRegistry.registerAll(WORKSPACE_COMMANDS);
  commandRegistry.registerAll(exampleCommands());
}
