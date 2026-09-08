import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import pkg from "./package.json";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { outDir: "out/main" } },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/preload" },
  },
  renderer: {
    root: "src/renderer",
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "shared"),
      },
    },
    // Tailwind is the whole styling system; there are no CSS Modules left to configure.
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        output: {
          // Deliberately no entry for Monaco. Naming a package here force-includes it, and the
          // name that would go here is the `monaco-editor` barrel -- the very thing the narrow
          // imports in `components/monaco-editor.ts` exist to avoid. It gets its own chunk by being
          // reached only through the settings widget's dynamic import.
          manualChunks: {
            pixi: ["pixi.js"],
            "react-vendor": ["react", "react-dom"],
          },
        },
      },
    },
  },
});
