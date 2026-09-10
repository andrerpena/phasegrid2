#!/usr/bin/env node
/**
 * Renders our version of a reference case and measures it against the reference instrument's
 * recording of the same thing.
 *
 *   npm run compare:reference                     # every case under fixtures/reference
 *   npm run compare:reference -- osc.sine         # every case of one module
 *   npm run compare:reference -- osc.sine/pattern # one case
 *
 * A case is a directory `fixtures/reference/<module>/<case>/` holding:
 *
 *   reference.wav   what the reference instrument produced, exported by a person
 *   case.json       { "patch": <PatchDoc>, "tempo": 120, "bars": 2, "set": { "osc.fold": 0 },
 *                     "expect": { "crest": { "near": "reference", "tolerance": 0.05 },
 *                                 "maxStep": { "max": 0.1 },
 *                                 "thd": { "max": 1.5 } } }
 *
 * `expect` names the measurements that matter for this case and how close they have to be: a value,
 * or `"reference"` to mean the reference's own number. Everything is printed either way; only the
 * named ones decide the exit code. This is the shape that scales past oscillators -- a compressor, a
 * delay, a filter are compared the same way, the same signal in and features out -- and every module
 * ported from the reference instrument gets a case here before it is called done.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measureFile } from "./audio-measure.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = join(root, "build/engine/phasegrid-engine");
const fixtures = join(root, "fixtures/reference");

function cases(filter) {
  const found = [];
  if (!existsSync(fixtures)) return found;
  for (const mod of readdirSync(fixtures, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    for (const c of readdirSync(join(fixtures, mod.name), {
      withFileTypes: true,
    })) {
      if (!c.isDirectory()) continue;
      const id = `${mod.name}/${c.name}`;
      if (filter && id !== filter && mod.name !== filter) continue;
      found.push({ id, dir: join(fixtures, mod.name, c.name) });
    }
  }
  return found;
}

const metric = {
  crest: (m) => m.channels[0].crest,
  maxStep: (m) => m.channels[0].maxStep,
  thd: (m) => m.channels[0].thd,
  rms: (m) => m.channels[0].rms,
  peak: (m) => m.channels[0].peak,
  f0: (m) => m.channels[0].f0,
  h3: (m) => m.channels[0].harmonics[2] ?? 0,
};

function runCase({ id, dir }) {
  const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
  const referencePath = join(dir, "reference.wav");
  if (!existsSync(referencePath)) {
    console.log(
      `${id}: no reference.wav yet — export it from the reference instrument and drop it here`,
    );
    return true;
  }
  const outDir = join(root, "build/compare", id.replace("/", "__"));
  mkdirSync(outDir, { recursive: true });
  const patchPath = join(outDir, "patch.json");
  writeFileSync(patchPath, JSON.stringify(spec.patch, null, 2));
  const ours = join(outDir, "ours.wav");
  const args = [
    "--render",
    patchPath,
    "--out",
    ours,
    "--tempo",
    String(spec.tempo ?? 120),
  ];
  if (spec.bars) args.push("--bars", String(spec.bars));
  else args.push("--seconds", String(spec.seconds ?? 2));
  if (spec.period) args.push("--period", String(spec.period));
  for (const [k, v] of Object.entries(spec.set ?? {}))
    args.push("--set", `${k}=${v}`);
  const render = spawnSync(engine, args, {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (render.status !== 0) {
    console.log(`${id}: render failed`);
    return false;
  }
  const a = measureFile(ours);
  const b = measureFile(referencePath);

  console.log(`\n${id}`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `  ${pad("", 10)}${pad("ours", 12)}${pad("reference", 12)}${pad("delta", 12)}verdict`,
  );
  let ok = true;
  for (const [name, get] of Object.entries(metric)) {
    const va = get(a);
    const vb = get(b);
    const rule = spec.expect?.[name];
    let verdict = "";
    if (rule) {
      const target = rule.near === "reference" ? vb : rule.near;
      let pass = true;
      if (target !== undefined)
        pass = Math.abs(va - target) <= (rule.tolerance ?? 0);
      if (rule.max !== undefined) pass = pass && va <= rule.max;
      if (rule.min !== undefined) pass = pass && va >= rule.min;
      verdict = pass ? "ok" : "FAIL";
      ok = ok && pass;
    }
    const d = name === "f0" ? 1 : 3;
    console.log(
      `  ${pad(name, 10)}${pad(va.toFixed(d), 12)}${pad(vb.toFixed(d), 12)}${pad((va - vb).toFixed(d), 12)}${verdict}`,
    );
  }
  console.log(`  ours: ${ours}`);
  return ok;
}

const filter = process.argv[2];
const all = cases(filter);
if (all.length === 0) {
  console.error(
    filter ? `no case matches ${filter}` : `nothing under ${fixtures}`,
  );
  process.exit(2);
}
let good = true;
for (const c of all) good = runCase(c) && good;
process.exit(good ? 0 : 1);
