/**
 * Renders a built-in example project to a WAV and measures it, from the command line, in one step.
 *
 *   npm run render:example -- osc.sine
 *   npm run render:example -- osc.sine --bars 2 --set osc.fold=12 --period 512 --out /tmp/sine.wav
 *   npm run render:example -- --list
 *
 * Runs under vite-node so it can import the example registry the application uses, with the same
 * path aliases (`vitest.config.ts`); the examples live in TypeScript beside the renderer because they
 * are also what the command palette opens. The render itself is the engine's `--render`, which is the
 * same code path the device callback takes (`--period` chooses how big a callback to pretend), and the
 * measurement is `scripts/audio-measure.mjs`, so what this prints is what a scenario would assert.
 *
 * Flags after the module id go to `--render` as they are: `--bars`, `--seconds`, `--tempo`, `--period`,
 * `--set module.param=value` (repeatable), `--out`. Tempo defaults to the example's own.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allExamples, exampleFor } from "@renderer/examples/registry";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = join(root, "build/engine/phasegrid-engine");

const argv = process.argv.slice(2);
if (argv.includes("--list") || argv.length === 0) {
  for (const e of allExamples())
    console.log(`${e.moduleId.padEnd(18)} ${e.name}  —  ${e.description}`);
  process.exit(argv.length === 0 ? 2 : 0);
}

const moduleId = argv[0];
const example = exampleFor(moduleId);
if (example === undefined) {
  console.error(`no example for ${moduleId}; --list shows what there is`);
  process.exit(2);
}
if (!existsSync(engine)) {
  console.error(`no engine at ${engine}; run npm run engine:build first`);
  process.exit(2);
}

const passthrough = argv.slice(1);
let out = "";
for (let i = 0; i < passthrough.length; i++)
  if (passthrough[i] === "--out" && passthrough[i + 1] !== undefined)
    out = passthrough[i + 1];
if (out === "") {
  mkdirSync(join(root, "build/renders"), { recursive: true });
  out = join(root, "build/renders", `${moduleId}.wav`);
  passthrough.push("--out", out);
}
if (!passthrough.includes("--tempo") && example.tempo !== undefined)
  passthrough.push("--tempo", String(example.tempo));
if (!passthrough.includes("--bars") && !passthrough.includes("--seconds"))
  passthrough.push("--bars", "2");

const patchPath = join(dirname(out), `${moduleId}.patch.json`);
writeFileSync(patchPath, JSON.stringify(example.patch, null, 2));

const render = spawnSync(engine, ["--render", patchPath, ...passthrough], {
  stdio: "inherit",
});
if (render.status !== 0) process.exit(render.status ?? 1);

const measure = spawnSync(
  process.execPath,
  [join(root, "scripts/audio-measure.mjs"), out],
  {
    stdio: "inherit",
  },
);
process.exit(measure.status ?? 1);
