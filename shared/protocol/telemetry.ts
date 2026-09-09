/**
 * The shared-memory telemetry layout, and a decoder for it.
 *
 * These bytes are written by `engine/src/services/Telemetry.hpp` in another process. Everything here is
 * a pure function over a buffer, with no addon and no Electron, so the whole decoder is testable against
 * a fixture and the parts that can only be checked against a live engine are kept to a minimum.
 *
 * Nothing in this file trusts the buffer. It was written by a process that may have died mid-write, so
 * the magic, the layout version and every length are checked before anything is indexed.
 */

/** 'PGTL' as a little-endian 32-bit word. */
export const TELEMETRY_MAGIC = 0x4c544750;
export const TELEMETRY_LAYOUT_VERSION = 1;
export const TELEMETRY_HEADER_BYTES = 64;
/**
 * 16 KiB. A scope slot holds one full window of `TELEMETRY_SCOPE_FRAMES` floats per channel, which is
 * 8192 bytes for two channels, and the slot header goes in front of that. The engine asserts the same
 * relationship at compile time, so the two cannot drift apart silently.
 */
export const TELEMETRY_SLOT_BYTES = 16384;
export const TELEMETRY_SLOT_HEADER_BYTES = 32;
export const TELEMETRY_SCOPE_FRAMES = 1024;
export const METER_FLOATS_PER_CHANNEL = 3;
/** The most parameters a module can have, and so the most floats a params slot carries. */
export const TELEMETRY_MAX_PARAMS = 64;

export enum TelemetryKind {
  None = 0,
  Meter = 1,
  Scope = 2,
  /**
   * The effective value of every parameter of a subscribed module, after modulation, in display
   * units and descriptor order. Written by the scheduler for any module that does not publish a kind
   * of its own; it is what lets a knob turn when something is plugged into it.
   */
  Params = 3,
  /**
   * One cycle of what a module would draw for the values it is running with: `Module::preview`,
   * published by the engine's message thread whenever those values move. One channel, `frames` long.
   */
  Preview = 4,
  /**
   * The last frame of the signal a readout module is fed, one float per channel. Signed, which is why
   * it is not a meter: a meter's peak is a magnitude, and +0.5 and -0.5 read the same through one.
   */
  Value = 5,
}

export interface TelemetryHeader {
  layoutVersion: number;
  slotCount: number;
  slotBytes: number;
  sampleRate: number;
  blockSize: number;
  /** Blocks rendered since the engine started. Stops moving when the engine does. */
  heartbeat: bigint;
}

export interface MeterReading {
  kind: TelemetryKind.Meter;
  blockIndex: bigint;
  /**
   * Per channel. `peak` is the held peak, falling towards the signal between transients, and
   * `clipped` is a held flag rather than a count: both are held by the module, because a reader at
   * frame rate sees one block in six and would otherwise miss exactly the moments a meter is for.
   */
  peak: number[];
  rms: number[];
  clipped: number[];
}

export interface ScopeReading {
  kind: TelemetryKind.Scope;
  blockIndex: bigint;
  /** One array per channel, each `frames` long. */
  channels: Float32Array[];
}

export interface ParamsReading {
  kind: TelemetryKind.Params;
  blockIndex: bigint;
  /** One per parameter, in the module descriptor's order. */
  values: number[];
}

export interface PreviewReading {
  kind: TelemetryKind.Preview;
  /** Counts publishes, so a reader can skip a picture it has already drawn. */
  blockIndex: bigint;
  /** One cycle, -1..1. */
  samples: Float32Array;
}

export interface ValueReading {
  kind: TelemetryKind.Value;
  blockIndex: bigint;
  /** The last value on the wire, per channel, as it was: signed, unscaled. */
  values: number[];
}

export type SlotReading =
  | MeterReading
  | ScopeReading
  | ParamsReading
  | PreviewReading
  | ValueReading;

/** Where a slot begins, given its index. */
export function slotOffset(index: number): number {
  return TELEMETRY_HEADER_BYTES + index * TELEMETRY_SLOT_BYTES;
}

/**
 * Reads the segment header, or null if these bytes are not a segment this build understands.
 *
 * A wrong magic means the engine has not written it yet, or something else owns the name. A wrong
 * layout version means an engine of a different vintage: refuse rather than guess, because the fields
 * would be read at the wrong offsets and the result would look like plausible garbage.
 */
export function readHeader(view: DataView): TelemetryHeader | null {
  if (view.byteLength < TELEMETRY_HEADER_BYTES) return null;
  if (view.getUint32(0, true) !== TELEMETRY_MAGIC) return null;
  const layoutVersion = view.getUint32(4, true);
  if (layoutVersion !== TELEMETRY_LAYOUT_VERSION) return null;
  return {
    layoutVersion,
    slotCount: view.getUint32(8, true),
    slotBytes: view.getUint32(12, true),
    sampleRate: view.getFloat64(16, true),
    blockSize: view.getUint32(24, true),
    heartbeat: view.getBigUint64(32, true),
  };
}

/**
 * Decodes one slot, or null when there is nothing usable to show.
 *
 * Null covers three different situations on purpose, because a caller does the same thing in all of
 * them: draw nothing and try again. The slot has never been written; the writer is inside it right now
 * (an odd counter); or the counter moved while we were copying, which means what we copied is part old
 * and part new. The last is the case the whole seqlock exists for.
 *
 * `bytes` must be a copy taken from the mapping, not a view onto it: the engine keeps writing, and a
 * view would change under this function between the two counter reads, which defeats the check.
 */
export function decodeSlot(bytes: Uint8Array): SlotReading | null {
  if (bytes.byteLength < TELEMETRY_SLOT_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const before = view.getUint32(0, true);
  if (before === 0) return null; // never written
  if (before % 2 !== 0) return null; // a write is in progress

  const kind = view.getUint32(4, true) as TelemetryKind;
  const channels = view.getUint32(8, true);
  const frames = view.getUint32(12, true);
  const blockIndex = view.getBigUint64(16, true);

  // Bounds before indexing. These numbers came from another process; a channel count of four billion is
  // not a thing that should be able to throw here, let alone read past the buffer. A params slot counts
  // parameters in the same field and is bounded on its own branch below.
  if (channels === 0) return null;
  if (kind !== TelemetryKind.Params && channels > 8) return null;

  const payload = TELEMETRY_SLOT_HEADER_BYTES;
  if (kind === TelemetryKind.Meter) {
    const need = channels * METER_FLOATS_PER_CHANNEL * 4;
    if (payload + need > bytes.byteLength) return null;
    const peak: number[] = [];
    const rms: number[] = [];
    const clipped: number[] = [];
    for (let c = 0; c < channels; c++) {
      const at = payload + c * METER_FLOATS_PER_CHANNEL * 4;
      peak.push(view.getFloat32(at, true));
      rms.push(view.getFloat32(at + 4, true));
      clipped.push(view.getFloat32(at + 8, true));
    }
    return { kind, blockIndex, peak, rms, clipped };
  }

  if (kind === TelemetryKind.Scope) {
    if (frames === 0 || frames > TELEMETRY_SCOPE_FRAMES) return null;
    const need = channels * TELEMETRY_SCOPE_FRAMES * 4;
    if (payload + need > bytes.byteLength) return null;
    const out: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      const at = payload + c * TELEMETRY_SCOPE_FRAMES * 4;
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++)
        samples[i] = view.getFloat32(at + i * 4, true);
      out.push(samples);
    }
    return { kind, blockIndex, channels: out };
  }

  if (kind === TelemetryKind.Preview) {
    if (frames === 0 || frames > TELEMETRY_SCOPE_FRAMES) return null;
    if (payload + frames * 4 > bytes.byteLength) return null;
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i++)
      samples[i] = view.getFloat32(payload + i * 4, true);
    return { kind, blockIndex, samples };
  }

  if (kind === TelemetryKind.Value) {
    if (payload + channels * 4 > bytes.byteLength) return null;
    const values: number[] = [];
    for (let c = 0; c < channels; c++)
      values.push(view.getFloat32(payload + c * 4, true));
    return { kind, blockIndex, values };
  }

  if (kind === TelemetryKind.Params) {
    // `channels` carries the count. Bounded like everything else: it came from another process.
    if (channels > TELEMETRY_MAX_PARAMS) return null;
    if (payload + channels * 4 > bytes.byteLength) return null;
    const values: number[] = [];
    for (let i = 0; i < channels; i++)
      values.push(view.getFloat32(payload + i * 4, true));
    return { kind, blockIndex, values };
  }

  return null; // kind None, or one this build does not know
}
