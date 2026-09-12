import { commandRegistry } from "@renderer/commands/registry";
import type { ProjectSummary } from "@shared/protocol/workspace";
import { useWorkspaceStore } from "./workspace-store";

/**
 * One command per project in the workspace, so the palette is a way to open your work by name.
 *
 * They exist because the projects do, so they are re-derived whenever the list changes rather than
 * registered once: a project you deleted must stop appearing, or the palette becomes a list of things
 * that used to be there.
 */

const PREFIX = "project.open:";

function register(projects: readonly ProjectSummary[]): void {
  for (const command of commandRegistry.all())
    if (command.id.startsWith(PREFIX)) commandRegistry.unregister(command.id);

  commandRegistry.registerAll(
    projects.map((summary) => ({
      id: `${PREFIX}${summary.slug}`,
      name: `Open: ${summary.name}`,
      category: "Project",
      description: `projects/${summary.slug}`,
      execute: () => {
        void useWorkspaceStore.getState().openProject(summary.slug);
      },
    })),
  );
}

export function startProjectCommands(): () => void {
  register(useWorkspaceStore.getState().projects);
  return useWorkspaceStore.subscribe((state, previous) => {
    if (state.projects !== previous.projects) register(state.projects);
  });
}
