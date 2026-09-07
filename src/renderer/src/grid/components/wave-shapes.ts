/**
 * One cycle of each basic waveform, as plain numbers.
 *
 * These exist so a face can draw a wave without an engine behind it. They are drawing data and nothing
 * else: the sound comes from the wavetables the engine renders, and these are the same shapes described
 * again in the smallest form that a curve needs. Where the two could drift — a table swapped for another,
 * a pulse widened — the engine is right and this is only a picture, so nothing here is ever fed to audio.
 *
 * Every generator returns values in -1..1 over exactly one cycle, sampled evenly, with `samples[0]` at
 * phase 0. The last sample sits just before phase 1 rather than on it, so a cycle can be repeated end to
 * end without doubling a point.
 */

/** Enough points that a vertical edge stays vertical at any size a module face is drawn at. */
export const WAVE_RESOLUTION = 512;

export type WaveShape = "sine" | "triangle" | "square" | "saw" | "pulse";

function build(count: number, at: (phase: number) => number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = at(i / count);
  return out;
}

export function sineWave(count = WAVE_RESOLUTION): Float32Array {
  return build(count, (p) => Math.sin(2 * Math.PI * p));
}

/**
 * Starts at zero, peaks at a quarter turn, troughs at three quarters.
 *
 * Aligned with the sine rather than starting at -1, so the two can be drawn over each other and the
 * triangle reads as the sine with its corners pulled straight, which is what it is.
 */
export function triangleWave(count = WAVE_RESOLUTION): Float32Array {
  return build(count, (p) => {
    if (p < 0.25) return 4 * p;
    if (p < 0.75) return 2 - 4 * p;
    return 4 * p - 4;
  });
}

/** A pulse of the given width. Half is a square; a quarter is what the engine's Pulse table holds. */
export function pulseWave(width = 0.5, count = WAVE_RESOLUTION): Float32Array {
  return build(count, (p) => (p < width ? 1 : -1));
}

export function squareWave(count = WAVE_RESOLUTION): Float32Array {
  return pulseWave(0.5, count);
}

/** Rises from -1 to just under 1 across the cycle. The reset edge falls on the cycle boundary. */
export function sawWave(count = WAVE_RESOLUTION): Float32Array {
  return build(count, (p) => 2 * p - 1);
}

export function waveShape(
  shape: WaveShape,
  count = WAVE_RESOLUTION,
): Float32Array {
  switch (shape) {
    case "sine":
      return sineWave(count);
    case "triangle":
      return triangleWave(count);
    case "square":
      return squareWave(count);
    case "saw":
      return sawWave(count);
    case "pulse":
      return pulseWave(0.25, count);
  }
}

/**
 * The curve for one of an oscillator's named wavetables, or null when the name is not one of the basic
 * shapes.
 *
 * Null rather than a guess. A table like "Basic Shapes", which morphs across four waveforms, or one
 * loaded from a file has no single curve, and drawing a sine for it would be a confident picture of the
 * wrong thing. An empty panel says "no simple shape", which is true.
 *
 * The names come from the engine's own enum labels, which is the join between this file and the tables
 * it draws. `wave-shapes.test.ts` checks that the labels in the committed catalogue still resolve, so a
 * table renamed in the engine turns into a failing test rather than a face that quietly goes blank.
 */
export function waveShapeForLabel(label: string): Float32Array | null {
  switch (label.trim().toLowerCase()) {
    case "sine":
      return sineWave();
    case "triangle":
      return triangleWave();
    case "square":
      return squareWave();
    case "saw":
    case "sawtooth":
      return sawWave();
    case "pulse":
      // A quarter wide, which is what the engine's Pulse table actually holds; its harmonic nulls are
      // measured in engine/tests/test_osc_shapes.cpp.
      return pulseWave(0.25);
    default:
      return null;
  }
}
