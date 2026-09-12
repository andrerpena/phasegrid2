import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The same path aliases the application builds with.
 *
 * Without them a test importing a runtime value through `@shared` or `@renderer` fails to resolve.
 * Type-only imports hide the problem, because those are erased before anything tries to load them, so
 * the gap only appears the first time a test needs an actual value.
 */
const alias = {
  "@renderer": resolve(__dirname, "src/renderer/src"),
  "@shared": resolve(__dirname, "shared"),
};

export default defineConfig({
  resolve: { alias },
  // The automatic runtime, as the application is built with: a component test written as JSX must
  // not need to import React to say so.
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "unit",
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "shared/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
