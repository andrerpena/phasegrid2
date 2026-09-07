import { resolve } from "node:path";
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
    css: { modules: { localsConvention: "camelCase" } },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        output: { manualChunks: { "react-vendor": ["react", "react-dom"] } },
      },
    },
  },
});
