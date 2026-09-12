import { useThemeStore } from "@renderer/theming/theme-store";
import { Palette } from "lucide-react";
import { StatusBarButton } from "../StatusBarButton";
import type { StatusBarItemDefinition } from "../types";

/** The active theme. Clicking it opens the picker. */
const ThemeStatusBarComponent = () => {
  const theme = useThemeStore((s) => s.theme);
  return (
    <StatusBarButton
      text={theme.name}
      icon={Palette}
      title="Set theme"
      commandId="workbench.setTheme"
    />
  );
};

export const themeStatusBar: StatusBarItemDefinition = {
  id: "theme",
  component: ThemeStatusBarComponent,
  defaultAlignment: "right",
};
