/**
 * Asks the one question a module's tests kept failing to ask: does turning this knob change what
 * you hear?
 *
 *   npm run module:probe -- fx.reverb
 *   npm run module:probe -- fx.reverb --tail        # and print the decay envelope
 *   npm run module:probe -- --all                   # every module that has an example
 *
 * The reverb this was written for measured well on every aggregate its tests took -- level, stereo
 * balance, correlation -- and was still, in the application, a module whose knobs did nothing you
 * could hear. Two things caused that, and this checks for both.
 *
 * **The example.** An effect is demonstrated by its example patch, and a reverb's example was a bare
 * oscillator held forever: no notes, no gaps, and the output patched to one channel. A tail is only
 * audible in the gaps, so Reverb Time, Size, Diffusion and Buildup were all genuinely inaudible
 * there. So the example is audited before anything is measured.
 *
 * **The knobs.** Each parameter is swept across its own range, ON ITS OWN TAPER (the same
 * `paramValueAt` a drag uses, so "a quarter turn" means what it means on screen), and the render is
 * compared with the untouched one. A knob whose whole range barely moves the output is reported as
 * dead, which is either a bug or a default that hides it.
 *
 * The render is the engine's `--render`, the same code path the device callback takes, so what this
 * prints is what a scenario would assert.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allExamples, exampleFor } from "@renderer/examples/registry";
import type { ModuleDescriptor, ParamDesc } from "@shared/protocol/catalog";
import { paramValueAt } from "@shared/protocol/param-curve";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = join(root, "build/engine/phasegrid-engine");
const outDir = join(root, "build/probe");

/** Below this a knob's whole range has not changed the sound: dead. */
const DEAD = 0.02;
/** Below this it changed it, but barely: worth a look. */
const WEAK = 0.1;
/** Where each knob is sampled, as a fraction of its turn. */
const POINTS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Controls that do nothing in their module's example ON PURPOSE, and why.
 *
 * A dead knob is usually a bug, but not always: a formant control on a filter set to Ladder, or a
 * clip light with nothing clipping, is inert because its partner is where it is. The difference
 * between that and the reverb's dead knobs is that this is KNOWN, so it is written down. An entry
 * here is a claim that has to stay true; a control that stops being conditional should lose its
 * line, and one that is merely inconvenient should never gain one. Anything not listed that measures
 * dead fails the probe.
 */
const CONDITIONAL: Record<string, Record<string, string>> = {
  "filter.multi": {
    blend_transpose: "only the Comb and Phaser models use it",
    formant_resonance: "Formant model only",
    formant_spread: "Formant model only",
    formant_transpose: "Formant model only",
    formant_x: "Formant model only",
    formant_y: "Formant model only",
    keytrack:
      "needs a pitch in its keytrack input, which the example does not patch",
  },
  "fx.chorus": {
    frequency: "the example is tempo-synced, so Tempo sets the rate instead",
  },
  "fx.compressor": {
    high_upper_ratio:
      "the signal never reaches the upper threshold in this example",
    low_upper_ratio:
      "the signal never reaches the upper threshold in this example",
  },
  "fx.distortion": {
    filter_blend:
      "the example's Filter Order is None, so there is no filter to shape",
    filter_cutoff: "the example's Filter Order is None",
    filter_resonance: "the example's Filter Order is None",
  },
  "fx.eq": {
    band_cutoff:
      "the example leaves the middle band flat; its gain is what brings it in",
    band_resonance: "the example leaves the middle band flat",
  },
  "io.audioOut": {
    clip: "nothing in the example reaches the clipping level, which is the point of the example",
    clipLevel: "nothing in the example clips",
    lifetime: "decides when a voice ends, not what it sounds like",
    silence: "a voice-lifetime threshold, not an audio control",
    hold: "a voice-lifetime time, not an audio control",
  },
  "mix.mixer": {
    level3: "the example patches two of the four inputs",
    level4: "the example patches two of the four inputs",
  },
  "mod.random": {
    frequency: "the example is tempo-synced, so Tempo sets the rate instead",
    keytrack_transpose: "needs a pitch in its keytrack input",
    keytrack_tune: "needs a pitch in its keytrack input",
  },
  "note.toCv": {
    mode: "the example plays one note at a time, so the voice rule cannot show",
  },
  "notefx.humanize": {
    velocity: "the example's notes carry no velocity to humanise",
  },
  "notefx.quantize": { mode: "the example's notes are already in the scale" },
};

// ---------------------------------------------------------------------------------- the measuring

interface Wav {
  left: Float32Array;
  right: Float32Array;
}

function readWav(path: string): Wav {
  const buf = readFileSync(path);
  let i = 12;
  let channels = 2;
  let data: Buffer | null = null;
  while (i < buf.length - 8) {
    const id = buf.toString("ascii", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === "fmt ") channels = buf.readUInt16LE(i + 10);
    if (id === "data") {
      data = buf.subarray(i + 8, i + 8 + size);
      break;
    }
    i += 8 + size + (size & 1);
  }
  if (data === null) throw new Error(`no data chunk in ${path}`);
  const frames = Math.floor(data.length / 4 / channels);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    left[f] = data.readFloatLE((f * channels + 0) * 4);
    right[f] = data.readFloatLE((f * channels + (channels > 1 ? 1 : 0)) * 4);
  }
  return { left, right };
}

function rms(w: Wav): number {
  let sum = 0;
  for (let i = 0; i < w.left.length; i++)
    sum += w.left[i] ** 2 + w.right[i] ** 2;
  return Math.sqrt(sum / Math.max(1, 2 * w.left.length));
}

/**
 * How different two renders are, as a fraction of how big the reference is.
 *
 * A plain level comparison would miss the thing that matters most about a reverb -- a longer tail at
 * the same loudness -- so this is the RMS of the sample-by-sample difference, which catches a change
 * in level, in timing and in timbre alike. Above about 1 the two renders share no waveform at all.
 */
function difference(reference: Wav, other: Wav): number {
  const n = Math.min(reference.left.length, other.left.length);
  let diff = 0;
  let base = 0;
  for (let i = 0; i < n; i++) {
    diff +=
      (reference.left[i] - other.left[i]) ** 2 +
      (reference.right[i] - other.right[i]) ** 2;
    base += reference.left[i] ** 2 + reference.right[i] ** 2;
  }
  return base > 0 ? Math.sqrt(diff / base) : 0;
}

// ----------------------------------------------------------------------------------- the rendering

function catalog(): ModuleDescriptor[] {
  const got = spawnSync(engine, ["--catalog"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (got.status !== 0) throw new Error(`--catalog failed: ${got.stderr}`);
  const parsed = JSON.parse(got.stdout);
  return Array.isArray(parsed) ? parsed : parsed.modules;
}

function render(
  patchPath: string,
  out: string,
  bars: number,
  tempo: number,
  sets: string[],
): Wav {
  const args = [
    "--render",
    patchPath,
    "--out",
    out,
    "--bars",
    String(bars),
    "--tempo",
    String(tempo),
    "--period",
    "512",
  ];
  for (const s of sets) args.push("--set", s);
  const got = spawnSync(engine, args, { encoding: "utf8" });
  if (got.status !== 0)
    throw new Error(`render failed: ${got.stderr || got.stdout}`);
  return readWav(out);
}

// -------------------------------------------------------------------------------- the example audit

/** Modules that make a source gated rather than continuous, so its sound has gaps to ring into. */
const GATED = new Set([
  "notes.pattern",
  "notes.clip",
  "note.toPoly",
  "note.toCv",
  "env.adsr",
]);

interface Finding {
  ok: boolean;
  text: string;
}

function auditExample(
  desc: ModuleDescriptor,
  patch: {
    modules: { id: string; type: string }[];
    edges: {
      from: { module: string; port: string };
      to: { module: string; port: string };
    }[];
  },
): Finding[] {
  const out: Finding[] = [];
  const node = patch.modules.find((m) => m.type === desc.id);
  if (node === undefined)
    return [{ ok: false, text: `the example does not contain a ${desc.id}` }];

  if (desc.category === "Audio FX") {
    const gated = patch.modules.some((m) => GATED.has(m.type));
    out.push({
      ok: gated,
      text: gated
        ? "the source is gated, so the sound has gaps an effect can be heard in"
        : "the source plays continuously: a tail, a repeat or a sweep has no gap to be heard in. " +
          "Give the example a gated source (notes.pattern into note.toPoly into env.adsr)",
    });

    const outs = patch.edges.filter((e) => e.from.module === node.id);
    const sinks = new Set(outs.map((e) => `${e.to.module}.${e.to.port}`));
    const bothChannels =
      [...sinks].some((s) => s.endsWith(".inL")) &&
      [...sinks].some((s) => s.endsWith(".inR"));
    const reachesOutput = outs.length > 0;
    out.push({
      ok: reachesOutput && bothChannels,
      text: bothChannels
        ? "its output reaches both channels, so its stereo image survives"
        : "its output reaches only one channel of io.audioOut, which mirrors that channel and " +
          "discards the other: patch it to inL and inR",
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- run

function probe(moduleId: string, wantTail: boolean): boolean {
  const example = exampleFor(moduleId);
  if (example === undefined) {
    console.log(
      `${moduleId}: no example — a module without one cannot be probed, or demonstrated`,
    );
    return false;
  }
  const desc = catalog().find((m) => m.id === moduleId);
  if (desc === undefined) throw new Error(`no ${moduleId} in the catalog`);

  mkdirSync(outDir, { recursive: true });
  const patchPath = join(outDir, `${moduleId}.patch.json`);
  writeFileSync(patchPath, JSON.stringify(example.patch, null, 2));
  const tempo = example.tempo ?? 120;
  const bars = 8;
  const node = example.patch.modules.find((m) => m.type === moduleId);
  if (node === undefined)
    throw new Error(`no ${moduleId} node in its own example`);

  console.log(`\n── ${moduleId}  ${desc.name}`);
  let ok = true;

  for (const f of auditExample(desc, example.patch as never)) {
    console.log(`  ${f.ok ? "ok  " : "FAIL"}  example: ${f.text}`);
    ok &&= f.ok;
  }

  const reference = render(
    patchPath,
    join(outDir, `${moduleId}.ref.wav`),
    bars,
    tempo,
    [],
  );
  if (rms(reference) < 1e-4) {
    console.log("  FAIL  the example is silent, so nothing can be measured");
    return false;
  }

  console.log(
    `  ${"knob".padEnd(16)} ${"change".padStart(8)}  ${"level".padStart(8)}   verdict`,
  );
  // A module that draws rather than sounds is measured for the sound it passes THROUGH, so its own
  // controls are expected to leave that alone: a piano's octave range changes the picture on its
  // face. The sweep still runs and still prints, so a control that ought to be audible and is not
  // still shows up -- it just does not fail the module.
  const audible = desc.category !== "Display";
  for (const p of desc.params) {
    if (p.flags.hidden) continue;
    // Structural params rebuild the node rather than move a value; several of them choose what is
    // drawn. They are swept and printed, never failed.
    const why = CONDITIONAL[desc.id]?.[p.id];
    const gates = audible && !p.flags.structural && why === undefined;
    let worst = 0;
    let quietest = Infinity;
    let loudest = 0;
    for (const t of POINTS) {
      const value =
        p.flags.enum || p.flags.integer
          ? Math.round(p.min + (p.max - p.min) * t)
          : paramValueAt(p as ParamDesc, t);
      const w = render(
        patchPath,
        join(outDir, `${moduleId}.${p.id}.${t}.wav`),
        bars,
        tempo,
        [`${node.id}.${p.id}=${value}`],
      );
      worst = Math.max(worst, difference(reference, w));
      quietest = Math.min(quietest, rms(w));
      loudest = Math.max(loudest, rms(w));
    }
    const verdict =
      worst < DEAD
        ? gates
          ? "DEAD"
          : why !== undefined
            ? `conditional: ${why}`
            : "silent"
        : worst < WEAK
          ? "weak"
          : "ok";
    if (verdict === "DEAD") ok = false;
    const levelDb = quietest > 0 ? 20 * Math.log10(loudest / quietest) : 0;
    console.log(
      `  ${p.id.padEnd(16)} ${worst.toFixed(3).padStart(8)}  ${`${levelDb.toFixed(1)}dB`.padStart(8)}   ${verdict}`,
    );
  }

  if (wantTail) {
    const w = readWav(join(outDir, `${moduleId}.ref.wav`));
    const win = 24000;
    const bins: string[] = [];
    for (let k = 0; k * win < w.left.length && k < 12; k++) {
      let sum = 0;
      let n = 0;
      for (
        let i = k * win;
        i < Math.min((k + 1) * win, w.left.length);
        i++, n++
      )
        sum += w.left[i] ** 2;
      bins.push(
        (20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) + 1e-12))
          .toFixed(0)
          .padStart(5),
      );
    }
    console.log(`  tail dB per 0.5 s: ${bins.join(" ")}`);
  }
  return ok;
}

const argv = process.argv.slice(2);
if (!existsSync(engine)) {
  console.error(`no engine at ${engine}; run npm run engine:build first`);
  process.exit(2);
}
const wantTail = argv.includes("--tail");
const ids = argv.includes("--all")
  ? allExamples().map((e) => e.moduleId)
  : argv.filter((a) => !a.startsWith("--"));
if (ids.length === 0) {
  console.error(
    "usage: npm run module:probe -- <moduleId> [--tail]   |   -- --all",
  );
  process.exit(2);
}
let allOk = true;
// Not `&&=`: that short-circuits, and a run over every module would stop probing at the first
// failure and report the rest as fine.
for (const id of ids) {
  const ok = probe(id, wantTail);
  allOk = allOk && ok;
}
console.log(
  allOk ? "\nALL PROBES PASSED" : "\nPROBE FAILURES — see FAIL and DEAD above",
);
process.exit(allOk ? 0 : 1);
