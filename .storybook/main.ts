import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import react from "@vitejs/plugin-react";

// This file is ESM, where `__dirname` does not exist.
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Storybook exists here for one reason above the usual ones: the canvas.
 *
 * Every Pixi component in this project takes plain data in and draws, with no store, no engine and no
 * socket. That is what makes each of them presentable on its own, and Storybook is where that is
 * exercised. A component that cannot be rendered from a fixture has a dependency it should not have,
 * and its story failing to exist is how that gets noticed.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-themes",
  ],
  framework: { name: "@storybook/react-vite", options: {} },
  viteFinal: (config) => ({
    ...config,
    // This project has no root `vite.config.ts` for the builder to inherit from -- the application is
    // built by electron-vite -- so the React plugin has to be added here or JSX compiles without the
    // automatic runtime and every story fails with "React is not defined".
    plugins: [...(config.plugins ?? []), react()],
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        "@renderer": resolve(here, "../src/renderer/src"),
        "@shared": resolve(here, "../shared"),
      },
    },
  }),
};

export default config;
