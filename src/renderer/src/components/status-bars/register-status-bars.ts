import {
  engineStatusBar,
  runCommandStatusBar,
  themeStatusBar,
  versionStatusBar,
  workspaceStatusBar,
} from "./definitions";
import { statusBarRegistry } from "./status-bar-registry";

export function registerBuiltInStatusBars(): void {
  statusBarRegistry.register(workspaceStatusBar);
  statusBarRegistry.register(engineStatusBar);
  statusBarRegistry.register(runCommandStatusBar);
  statusBarRegistry.register(themeStatusBar);
  statusBarRegistry.register(versionStatusBar);
}
