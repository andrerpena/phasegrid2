import { applyTheme } from "@renderer/theming/apply-theme";
import { themeById } from "@renderer/theming/themes";
import type { Decorator, Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import "../src/renderer/src/css/index.css";

/**
 * Applies the real theme, the same way the application does.
 *
 * Stories read the theme through Tailwind's tokens exactly as the application does, so a component
 * that looks right here looks right there. Switching the toolbar's theme runs the same function the
 * application runs -- which now only sets `data-theme`, because `css/theme.css` owns the values.
 */
const withTheme: Decorator = (Story, context) => {
  const themeId = (context.globals.theme as string) ?? "dark";
  useEffect(() => {
    applyTheme(themeById(themeId));
  }, [themeId]);
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Theme",
      defaultValue: "dark",
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
          { value: "terminal", title: "Terminal" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // The application's own ground, so a component is judged against the background it will sit on
    // rather than against Storybook's white.
    backgrounds: { disable: true },
    a11y: { test: "todo" },
    controls: { matchers: { color: /(background|color)$/i } },
  },
};

export default preview;
