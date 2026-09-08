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
          // Naming a package here also pulls it into the graph, so a chunk is only declared
          // once something actually imports it -- Monaco's entry arrives with the settings
          // widget in the phase that needs it.
          manualChunks: {
            pixi: ["pixi.js"],
            "react-vendor": ["react", "react-dom"],
          },
        },
      },
    },
  },
});
