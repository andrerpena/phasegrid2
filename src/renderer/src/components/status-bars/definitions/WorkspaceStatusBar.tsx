import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import { Folder } from "lucide-react";
import { StatusBarButton } from "../StatusBarButton";
import type { StatusBarItemDefinition } from "../types";

/**
 * Where your work is going.
 *
 * First on the strip: it is the one fact here that changes what saving means, and it is otherwise
 * invisible.
 */
const WorkspaceStatusBarComponent = () => {
  const name = useWorkspaceStore((s) => s.name);
  const root = useWorkspaceStore((s) => s.root);

  return (
    <StatusBarButton
      text={name === "" ? "No workspace" : name}
      icon={Folder}
      title={root ?? "No workspace"}
      commandId="workspace.open"
      className="min-w-0 max-w-56 truncate"
    />
  );
};

export const workspaceStatusBar: StatusBarItemDefinition = {
  id: "workspace",
  component: WorkspaceStatusBarComponent,
  defaultAlignment: "left",
};
