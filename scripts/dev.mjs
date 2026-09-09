#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = spawnSync(
  process.execPath,
  [resolve(root, "scripts/build-native.mjs")],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);

// Anything after the script's own name goes to Electron: `npm run dev -- --audio null
// --remote-debugging-port=9222` is a development session an agent can attach to. electron-vite
// forwards what follows its own `--`.
const passthrough = process.argv.slice(2).filter((arg) => arg !== "--");
const bin = resolve(root, "node_modules/.bin/electron-vite");
const child = spawn(
  bin,
  ["dev", ...(passthrough.length > 0 ? ["--", ...passthrough] : [])],
  { cwd: root, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
