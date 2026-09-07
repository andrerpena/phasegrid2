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

const bin = resolve(root, "node_modules/.bin/electron-vite");
const child = spawn(bin, ["dev"], { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
