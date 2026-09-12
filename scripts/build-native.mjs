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
// The telemetry addon is skipped when node_modules is not populated yet -- its CMakeLists says so and
// returns rather than failing, so asking for the target would then be an error. `npm install` runs this
// after installing dependencies, so the normal path has them.
const addonAvailable = existsSync(resolve(root, "node_modules/node-addon-api/napi.h"));
// `pg-sst-ref` runs an sst effect outside the engine, which is how a suspected adapter bug is told
// apart from the effect simply doing that (engine/tools/SstReference.cpp). It is small and it is
// only useful when it is already built, so it is built every time.
const targets = process.argv.includes("--tests")
  ? ["phasegrid-engine", "pg_tests", "pg-sst-ref"]
  : ["phasegrid-engine", "pg-sst-ref"];
if (addonAvailable) targets.push("pg_telemetry");
cmake(["--build", buildDir, "--target", ...targets, "--parallel"]);
console.log(
  addonAvailable
    ? "[build-native] ok: build/engine/phasegrid-engine, build/native/pg_telemetry.node"
    : "[build-native] ok: build/engine/phasegrid-engine (addon skipped, no node_modules)",
);
