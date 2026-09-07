#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, "build");

if (process.env.PHASEGRID_SKIP_NATIVE === "1") {
  console.log("[build-native] skipped (PHASEGRID_SKIP_NATIVE=1)");
  process.exit(0);
}

const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
if (!has("cmake")) {
  console.error("[build-native] cmake not found. macOS: `brew install cmake` and `xcode-select --install`.");
  process.exit(1);
}

const cmake = (args) => {
  const r = spawnSync("cmake", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Warnings-as-errors is opt-in: this script also runs from `postinstall` on end-user machines,
// where a warning from a future compiler must not turn `npm install` into a hard failure. CI
// sets PG_WERROR=ON. Re-configure when it is requested so an existing cache picks the flag up.
const werror = process.env.PG_WERROR === "ON" || process.argv.includes("--werror");
if (werror || !existsSync(resolve(buildDir, "CMakeCache.txt"))) {
  const gen = has("ninja") ? ["-G", "Ninja"] : [];
  cmake([
    "-S",
    root,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
    `-DPG_WERROR=${werror ? "ON" : "OFF"}`,
    ...gen,
  ]);
}
const targets = process.argv.includes("--tests") ? ["phasegrid-engine", "pg_tests"] : ["phasegrid-engine"];
cmake(["--build", buildDir, "--target", ...targets, "--parallel"]);
console.log("[build-native] ok: build/engine/phasegrid-engine");
