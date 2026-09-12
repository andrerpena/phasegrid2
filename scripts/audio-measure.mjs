#!/usr/bin/env node
/**
 * Measures a WAV the way the last three defects were found: not "is there a sound" but "is it the
 * right sound, and is it clean". Pure Node, no dependencies, so the harness and a scenario can import
 * it and a person can run it on anything the engine or the reference instrument wrote.
 *
 *   node scripts/audio-measure.mjs ours.wav                # one file, the table
 *   node scripts/audio-measure.mjs ours.wav reference.wav  # two files side by side, with deltas
 *   node scripts/audio-measure.mjs ours.wav --json         # the same numbers, for a script
 *
 * Three questions, three kinds of number, because each is blind to the other two:
 *
 *   level      rms, peak                 a click has an ordinary level; so does a distorted wave
 *   continuity maxStep                   the largest jump between consecutive samples; a wave's own
 *                                        slope bounds it, so anything near full scale is a click
 *   shape      crest, harmonics, THD     peak over RMS is 1.41 for a sine, 1.73 for a saw, 1 for a
 *                                        square; the harmonic series says which partials are there
 *
 * The shape numbers are read on the most stable window in the file -- the stretch where the level
 * varies least -- because a run of notes with gaps has no one shape and a chord has no one
 * fundamental. `f0` is found by zero crossings there, and the harmonics are measured by Goertzel at
 * exact multiples of it, which needs no FFT and lands on the harmonic rather than beside it.
 *
 * Non-WAV input (the reference instrument exports MP3 as readily as WAV) is converted with the
 * platform's `afconvert` when it is there.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// ---------------------------------------------------------------- reading

/** @returns {{ channels: Float32Array[], sampleRate: number }} */
export function readWav(path) {
  let file = path;
  if (!/\.wav$/i.test(path)) {
    // afconvert is macOS; elsewhere the caller converts first. Sixteen-bit is plenty for measuring.
    const out = join(
      mkdtempSync(join(tmpdir(), "pg-measure-")),
      `${basename(path)}.wav`,
    );
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", path, out], {
      stdio: "ignore",
    });
    file = out;
  }
  const b = readFileSync(file);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error(`${path}: not a WAV file`);
  let fmt = null;
  let data = null;
  let at = 12;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = b.subarray(at + 8, at + 8 + size);
    if (id === "fmt ") {
      fmt = {
        tag: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
      // WAVE_FORMAT_EXTENSIBLE carries the real tag in its sub-format GUID's first two bytes.
      if (fmt.tag === 0xfffe && size >= 26) fmt.tag = body.readUInt16LE(24);
    } else if (id === "data") data = body;
    at += 8 + size + (size & 1);
  }
  if (fmt === null || data === null)
    throw new Error(`${path}: no fmt or data chunk`);
  const { tag, channels: n, sampleRate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * n));
  const channels = Array.from({ length: n }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) {
      const o = (i * n + c) * bytes;
      let v;
      if (tag === 3 && bits === 32) v = data.readFloatLE(o);
      else if (tag === 3 && bits === 64) v = data.readDoubleLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648;
      else if (bits === 8) v = (data.readUInt8(o) - 128) / 128;
      else
        throw new Error(
          `${path}: unsupported format tag ${tag} at ${bits} bits`,
        );
      channels[c][i] = v;
    }
  return { channels, sampleRate };
}

// ---------------------------------------------------------------- measuring

function goertzel(x, sampleRate, hz) {
  const w = (2 * Math.PI * hz) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / x.length;
}

/** The start of the window whose 100 ms level varies least: where a note is being held. */
function stablestWindow(x, sampleRate, windowLength) {
  const hop = Math.max(1, Math.floor(sampleRate * 0.1));
  const levels = [];
  for (let s = 0; s + hop <= x.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + hop; i++) sum += x[i] * x[i];
    levels.push(Math.sqrt(sum / hop));
  }
  const per = Math.max(1, Math.round(windowLength / hop));
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let k = 0; k + per <= levels.length; k++) {
    const slice = levels.slice(k, k + per);
    const mean = slice.reduce((a, b) => a + b, 0) / per;
    if (mean < 0.01) continue; // silence is very stable and tells us nothing
    const spread = Math.max(...slice) - Math.min(...slice);
    const score = spread / mean;
    if (score < bestScore) {
      bestScore = score;
      best = k * hop;
    }
  }
  return best;
}

function fundamental(x, sampleRate) {
  const crossings = [];
  for (let i = 1; i < x.length; i++)
    if (x[i - 1] < 0 && x[i] >= 0) crossings.push(i);
  if (crossings.length < 3) return 0;
  return (
    (sampleRate * (crossings.length - 1)) /
    (crossings[crossings.length - 1] - crossings[0])
  );
}

/**
 * Every number for one channel.
 * @param {Float32Array} x
 * @param {number} sampleRate
 */
export function measureChannel(x, sampleRate) {
  let sumSquares = 0;
  let peak = 0;
  let maxStep = 0;
  let overs = 0; // samples at or beyond full scale: what a device would have clamped
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    sumSquares += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 1) overs++;
    if (i > 0) {
      const d = Math.abs(v - x[i - 1]);
      if (d > maxStep) maxStep = d;
    }
  }
  const rms = x.length === 0 ? 0 : Math.sqrt(sumSquares / x.length);

  const hop = Math.max(1, Math.floor(sampleRate * 0.1));
  const envelope = [];
  for (let s = 0; s + hop <= x.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + hop; i++) sum += x[i] * x[i];
    envelope.push(Math.sqrt(sum / hop));
  }

  // Shape, on the stablest window: crest there, and the harmonic series of whatever note is held.
  const windowLength = Math.min(x.length, 16384);
  const start = stablestWindow(x, sampleRate, windowLength);
  const seg = x.subarray(start, start + windowLength);
  let segSquares = 0;
  let segPeak = 0;
  for (let i = 0; i < seg.length; i++) {
    segSquares += seg[i] * seg[i];
    segPeak = Math.max(segPeak, Math.abs(seg[i]));
  }
  const segRms = seg.length === 0 ? 0 : Math.sqrt(segSquares / seg.length);
  const crest = segRms > 0 ? segPeak / segRms : 0;
  const f0 = fundamental(seg, sampleRate);
  const windowed = Float32Array.from(
    seg,
    (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / seg.length)),
  );
  const harmonics = [];
  if (f0 > 0) {
    const h1 = goertzel(windowed, sampleRate, f0);
    for (let k = 1; k <= 10; k++) {
      if (f0 * k >= sampleRate / 2) break;
      harmonics.push(h1 > 0 ? goertzel(windowed, sampleRate, f0 * k) / h1 : 0);
    }
  }
  const thd =
    harmonics.length > 1
      ? Math.sqrt(harmonics.slice(1).reduce((a, r) => a + r * r, 0)) * 100
      : 0;

  // A file over full scale is not what a listener hears; the device clamps it. When a file is hot, the
  // shape numbers are also given for the clamped signal, because that is the distortion in the room.
  const asHeard =
    overs > 0 && peak > 1
      ? (() => {
          const clamped = Float32Array.from(x, (v) =>
            Math.max(-1, Math.min(1, v)),
          );
          const m = measureChannel(clamped, sampleRate);
          return { crest: m.crest, thd: m.thd, harmonics: m.harmonics };
        })()
      : null;

  return {
    rms,
    peak,
    maxStep,
    overs,
    oversPercent: x.length === 0 ? 0 : (100 * overs) / x.length,
    asHeard,
    envelope,
    window: { start, seconds: start / sampleRate },
    crest,
    f0,
    harmonics, // ratio to the fundamental, index 0 is the fundamental itself (1)
    thd, // percent
  };
}

/** @returns {{ path: string, sampleRate: number, seconds: number, channels: ReturnType<typeof measureChannel>[] }} */
export function measureFile(path) {
  const { channels, sampleRate } = readWav(path);
  return {
    path,
    sampleRate,
    seconds: (channels[0]?.length ?? 0) / sampleRate,
    channels: channels.map((x) => measureChannel(x, sampleRate)),
  };
}

// ---------------------------------------------------------------- printing

const db = (ratio) =>
  ratio > 0 ? `${(20 * Math.log10(ratio)).toFixed(1)} dB` : "-inf";
const fix = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");

function envelopeLine(env) {
  const glyph = (a) =>
    a < 0.02 ? "." : a < 0.1 ? ":" : a < 0.4 ? "o" : a < 0.8 ? "O" : "#";
  return env.map(glyph).join("");
}

function printOne(m) {
  console.log(
    `${basename(m.path)}  ${m.sampleRate} Hz  ${m.seconds.toFixed(2)} s  ${m.channels.length} ch`,
  );
  m.channels.forEach((c, i) => {
    console.log(`  channel ${i}`);
    console.log(
      `    level       rms ${fix(c.rms)}   peak ${fix(c.peak)}${c.overs > 0 ? `   OVER FULL SCALE: ${c.overs} samples (${c.oversPercent.toFixed(1)}%)` : ""}`,
    );
    if (c.asHeard)
      console.log(
        `    as heard    after the device clamps at ±1: crest ${fix(c.asHeard.crest)}   THD ${c.asHeard.thd.toFixed(2)}%   h2 ${db(c.asHeard.harmonics[1] ?? 0)}`,
      );
    console.log(
      `    continuity  maxStep ${fix(c.maxStep, 4)}   (a click is ~0.1 or more; a sine at C4 moves by ~0.03)`,
    );
    console.log(
      `    shape       crest ${fix(c.crest)}   (sine 1.414, saw 1.732, square 1.000)   at ${c.window.seconds.toFixed(2)} s`,
    );
    if (c.f0 > 0) {
      const series = c.harmonics.map((r, k) => `h${k + 1} ${db(r)}`).join("  ");
      console.log(
        `    harmonics   f0 ${c.f0.toFixed(1)} Hz   THD ${c.thd.toFixed(2)}%`,
      );
      console.log(`                ${series}`);
    }
    console.log(
      `    envelope    |${envelopeLine(c.envelope)}|  (100 ms per glyph: . : o O #)`,
    );
  });
}

function printPair(a, b) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `${pad("", 14)}${pad(basename(a.path), 24)}${pad(basename(b.path), 24)}delta`,
  );
  const rows = [
    ["rms", (c) => c.rms, 3],
    ["peak", (c) => c.peak, 3],
    ["overs %", (c) => c.oversPercent, 1],
    ["crest", (c) => c.crest, 3],
    ["maxStep", (c) => c.maxStep, 4],
    ["f0 Hz", (c) => c.f0, 1],
    ["THD %", (c) => c.thd, 2],
    ["h2 (dB)", (c) => 20 * Math.log10(c.harmonics[1] || 1e-9), 1],
    ["h3 (dB)", (c) => 20 * Math.log10(c.harmonics[2] || 1e-9), 1],
    ["h5 (dB)", (c) => 20 * Math.log10(c.harmonics[4] || 1e-9), 1],
  ];
  const ca = a.channels[0];
  const cb = b.channels[0];
  for (const [label, get, d] of rows) {
    const va = get(ca);
    const vb = get(cb);
    console.log(
      `${pad(label, 14)}${pad(fix(va, d), 24)}${pad(fix(vb, d), 24)}${fix(va - vb, d)}`,
    );
  }
  console.log(`${pad("envelope", 14)}|${envelopeLine(ca.envelope)}|`);
  console.log(`${pad("", 14)}|${envelopeLine(cb.envelope)}|`);
}

// ---------------------------------------------------------------- cli

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0 || files.length > 2) {
    console.error("usage: audio-measure <file.wav> [reference.wav] [--json]");
    process.exit(2);
  }
  for (const f of files)
    if (!existsSync(f)) {
      console.error(`no such file: ${f}`);
      process.exit(2);
    }
  const measured = files.map(measureFile);
  if (json) console.log(JSON.stringify(measured, null, 2));
  else if (measured.length === 1) printOne(measured[0]);
  else printPair(measured[0], measured[1]);
}
