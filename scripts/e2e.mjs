#!/usr/bin/env node
/**
 * Drives the built application through its scenarios.
 *
 * Run `npx electron-vite build` first (or `npm run e2e`, which does). Each scenario gets a fresh
 * throwaway workspace and user-data directory and an application on the silent audio backend, so a
 * run touches nothing of yours and makes no sound.
 *
 *   node scripts/e2e.mjs                       every scenario
 *   node scripts/e2e.mjs --only patch-editing  one (or a comma-separated few)
 *   node scripts/e2e.mjs --list                what there is
 *   node scripts/e2e.mjs --keep --only x       leave the application running afterwards
 *   node scripts/e2e.mjs --shots <dir>         where screenshots go (a temp dir otherwise)
 *   node scripts/e2e.mjs --attach 9222 --only x   run against an application already listening
 *
 * A scenario is a module under scripts/e2e/scenarios exporting `{ name, description, run }`. With
 * `seed(workspace)` it can put files in the folder before the application opens it; with
 * `launches: true` it starts the application itself, as many times as it needs.
 */
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  attach,
  failureCount,
  launch,
  newUserData,
  newWorkspace,
  ROOT,
} from "./e2e/harness.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
};
const has = (name) => argv.includes(name);

const only =
  flag("--only")
    ?.split(",")
    .map((s) => s.trim()) ?? null;
const keep = has("--keep");
const attachPort = flag("--attach");
const shots = flag("--shots") ?? mkdtempSync(join(tmpdir(), "pg-shot-"));

const dir = resolve(ROOT, "scripts/e2e/scenarios");
const scenarios = [];
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".mjs"))
  .sort()) {
  const mod = await import(pathToFileURL(join(dir, file)).href);
  scenarios.push(mod.default);
}

if (has("--list")) {
  for (const s of scenarios)
    console.log(`${s.name.padEnd(20)} ${s.description}`);
  process.exit(0);
}

const chosen =
  only === null ? scenarios : scenarios.filter((s) => only.includes(s.name));
const unknown = (only ?? []).filter(
  (n) => !scenarios.some((s) => s.name === n),
);
if (unknown.length > 0) {
  console.error(`no such scenario: ${unknown.join(", ")} (try --list)`);
  process.exit(2);
}

console.log(`screenshots: ${shots}\n`);
let crashed = 0;
for (const [index, scenario] of chosen.entries()) {
  const last = index === chosen.length - 1;
  console.log(`── ${scenario.name}: ${scenario.description}`);
  try {
    if (attachPort !== null) {
      if (scenario.launches) {
        console.log(
          "  skipped: it launches the application itself, and --attach was given",
        );
        continue;
      }
      await attach(Number(attachPort), (driver) => scenario.run(driver), {
        shots,
      });
      continue;
    }
    const workspace = newWorkspace();
    const userData = newUserData();
    scenario.seed?.(workspace);
    if (scenario.launches) {
      await scenario.run({
        launch: (options, run) =>
          launch({ userData, shots, keep: keep && last, ...options }, run),
        workspace,
        userData,
        shots,
        check: (await import("./e2e/harness.mjs")).check,
      });
    } else {
      await launch(
        { workspace, userData, shots, keep: keep && last },
        (driver) => scenario.run(driver),
      );
    }
  } catch (error) {
    crashed++;
    console.error(
      `\nscenario ${scenario.name} failed: ${error.stack ?? error.message}\n`,
    );
  }
  console.log("");
}

const failed = failureCount() + crashed;
console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
if (keep)
  console.log("(--keep: the last application is still running; ctrl-c to end)");
else process.exit(failed === 0 ? 0 : 1);
