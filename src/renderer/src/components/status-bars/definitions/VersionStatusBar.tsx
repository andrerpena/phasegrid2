import type { StatusBarItemDefinition } from "../types";

const VersionStatusBarComponent = () => <span>v{__APP_VERSION__}</span>;

export const versionStatusBar: StatusBarItemDefinition = {
  id: "version",
  component: VersionStatusBarComponent,
  defaultAlignment: "right",
};
