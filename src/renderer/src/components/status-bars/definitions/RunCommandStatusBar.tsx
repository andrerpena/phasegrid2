import { formatKey } from "@renderer/keybindings/display";
import { keybindingRegistry } from "@renderer/keybindings/keybindings";
import { Terminal } from "lucide-react";
import { StatusBarButton } from "../StatusBarButton";
import type { StatusBarItemDefinition } from "../types";

/**
 * The way in to everything else.
 *
 * Shows the key rather than just naming the palette, because the point of a status bar entry for a
 * command you can already reach by keystroke is to teach the keystroke.
 */
const RunCommandStatusBarComponent = () => {
  const key = keybindingRegistry.keyFor("workbench.commandPalette");
  return (
    <StatusBarButton
      text={key === undefined ? "Commands" : formatKey(key)}
      icon={Terminal}
      title="Run a command"
      commandId="workbench.commandPalette"
    />
  );
};

export const runCommandStatusBar: StatusBarItemDefinition = {
  id: "run-command",
  component: RunCommandStatusBarComponent,
  defaultAlignment: "left",
};
