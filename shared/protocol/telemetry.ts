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
/** Notes one slot may carry, and the bytes each takes. Both are fixed by the engine's record. */
export const TELEMETRY_MAX_NOTES = 256;
export const TELEMETRY_NOTE_BYTES = 32;
/** Floats in front of the notes: quarters per cycle, quarters per bar, the playhead, and a spare. */
export const TELEMETRY_NOTE_HEADER_FLOATS = 4;
/** Keys a `Keys` slot may carry: one per MIDI note number. */
export const TELEMETRY_MAX_KEYS = 128;
/** `flags` bit 0 of a note record: it is sounding right now. */
export const TELEMETRY_NOTE_SOUNDING = 1;

/**
 * What a module publishes, as opposed to what the bytes in a slot are.
 *
 * A `TelemetryKind` says what a slot CONTAINS; a channel says who writes it and why. They are not the
 * same axis: `display` carries four different kinds depending on the module, and one module may hold
 * several channels at once -- a pattern draws its own piano roll AND has knobs that modulation turns,
 * which are two publishers writing two kinds. A slot each, so neither can overwrite the other.
 *
 * `telemetry.subscribe` speaks these names and no others. The engine's `TelemetryChannel`
 * (`engine/src/core/TelemetryChannel.hpp`) is the same list.
 */
export const TELEMETRY_CHANNELS = ["params", "display", "preview"] as const;
export type TelemetryChannel = (typeof TELEMETRY_CHANNELS)[number];

export enum TelemetryKind {
  None = 0,
  Meter = 1,
  Scope = 2,
  /**
   * The effective value of every parameter of a subscribed module, after modulation, in display
   * units and descriptor order. Written by the scheduler for any module watched on the `params`
   * channel; it is what lets a knob turn when something is plugged into it.
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
  /**
   * The notes a note source is playing: the window it is in, in musical time, with the playhead
   * and enough of the meter to rule a grid under them. What a piano roll on a module's face is
   * drawn from -- the engine has already worked out where the notes are, and an interface that
   * recomputed them would be guessing at a pattern it cannot parse.
   */
  Notes = 6,
  /**
   * Which keys are down: one float per MIDI note number, 1 held and 0 up, `frames` of them. What a
   * keyboard on a module's face lights. Per note rather than per voice, so a reader never has to
   * know how many voices the program runs.
   */
  Keys = 7,
  /**
   * The picture an envelope draws of itself: where each stage ends, the level it sustains at, the
   * curve, and where it has got to. Written by the same publisher as `Preview` and on the same
   * channel -- both answer "what would this module draw for the values it is running with", and both
   * have to keep answering while the patch is held and a knob is being turned.
   *
   * Not samples alone, because an envelope is not one cycle of anything: without the breakpoints a
   * reader could draw the curve but not say where the decay ends, so it could not dash the sustain
   * or put a dot on a corner.
   */
  Envelope = 8,
}

/**
 * The floats in front of an `Envelope` reading's curve, in order. The engine writes this layout in
 * `engine/src/core/Module.hpp`; the two are one description in two languages.
 */
export const ENVELOPE_PICTURE_HEADER = 8;

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

/**
 * An envelope's picture. `x` is a fraction of the drawn width and `y` a level in 0..1, so a block
 * scales it to its own rectangle and never has to know about seconds.
 */
export interface EnvelopeReading {
  kind: TelemetryKind.Envelope;
  blockIndex: bigint;
  /** Where the attack reaches full scale, where the decay reaches the sustain, where the release begins. */
  attackEnd: number;
  decayEnd: number;
  sustainEnd: number;
  /** The level the decay ends at, 0..1: the height of the dashed run between the two breakpoints. */
  sustain: number;
  /** Where the envelope has got to, or null when it is not running. */
  playhead: { x: number; y: number } | null;
  /** The stage, as the engine's own numbering. Carried for a reader that wants to name it. */
  stage: number;
  /** The curve itself, 0..1, evenly spaced across the whole width. */
  curve: Float32Array;
}

export interface ValueReading {
  kind: TelemetryKind.Value;
  blockIndex: bigint;
  /** The last value on the wire, per channel, as it was: signed, unscaled. */
  values: number[];
}

/** One note in a `Notes` reading. Times are in cycles from the start of the window. */
export interface TelemetryNote {
  start: number;
  length: number;
  /** MIDI note number, after the module's transpose. */
  pitch: number;
  velocity: number;
  /** The character range of the step in the module's text property `textIndex`. */
  from: number;
  to: number;
  textIndex: number;
  sounding: boolean;
}

export interface NotesReading {
  kind: TelemetryKind.Notes;
  blockIndex: bigint;
  notes: TelemetryNote[];
  /** How long the window is, and how long a bar is, both in quarter notes: enough to rule a grid. */
  quartersPerCycle: number;
  quartersPerBar: number;
  /** Where the playhead is in the window, 0..1. */
  phase: number;
}

export interface KeysReading {
  kind: TelemetryKind.Keys;
  blockIndex: bigint;
  /** The MIDI note numbers that are down, ascending. Already what a keyboard draws. */
  held: number[];
}

export type SlotReading =
  | MeterReading
  | ScopeReading
  | ParamsReading
  | PreviewReading
  | EnvelopeReading
  | ValueReading
  | NotesReading
  | KeysReading;

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

  if (kind === TelemetryKind.Envelope) {
    if (frames <= ENVELOPE_PICTURE_HEADER || frames > TELEMETRY_SCOPE_FRAMES)
      return null;
    if (payload + frames * 4 > bytes.byteLength) return null;
    const at = (i: number) => view.getFloat32(payload + i * 4, true);
    const points = frames - ENVELOPE_PICTURE_HEADER;
    const curve = new Float32Array(points);
    for (let i = 0; i < points; i++) curve[i] = at(ENVELOPE_PICTURE_HEADER + i);
    const x = at(4);
    return {
      kind,
      blockIndex,
      attackEnd: at(0),
      decayEnd: at(1),
      sustainEnd: at(2),
      sustain: at(3),
      // The engine writes -1 for an envelope that is not running, which is not a place on the picture.
      playhead: x < 0 ? null : { x, y: at(5) },
      stage: at(6),
      curve,
    };
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

  if (kind === TelemetryKind.Notes) {
    // `frames` carries the note count. Bounded before it is used as a length, like every other
    // number that arrived from the engine's process.
    if (frames > TELEMETRY_MAX_NOTES) return null;
    const first = payload + TELEMETRY_NOTE_HEADER_FLOATS * 4;
    if (first + frames * TELEMETRY_NOTE_BYTES > bytes.byteLength) return null;
    const notes: TelemetryNote[] = [];
    for (let i = 0; i < frames; i++) {
      const at = first + i * TELEMETRY_NOTE_BYTES;
      notes.push({
        start: view.getFloat32(at, true),
        length: view.getFloat32(at + 4, true),
        pitch: view.getFloat32(at + 8, true),
        velocity: view.getFloat32(at + 12, true),
        from: view.getUint32(at + 16, true),
        to: view.getUint32(at + 20, true),
        textIndex: view.getUint32(at + 24, true),
        sounding:
          (view.getUint32(at + 28, true) & TELEMETRY_NOTE_SOUNDING) !== 0,
      });
    }
    return {
      kind,
      blockIndex,
      notes,
      quartersPerCycle: view.getFloat32(payload, true),
      quartersPerBar: view.getFloat32(payload + 4, true),
      phase: view.getFloat32(payload + 8, true),
    };
  }

  if (kind === TelemetryKind.Keys) {
    // `frames` carries the key count. Bounded before it is used as a length.
    if (frames > TELEMETRY_MAX_KEYS) return null;
    if (payload + frames * 4 > bytes.byteLength) return null;
    const held: number[] = [];
    for (let i = 0; i < frames; i++)
      if (view.getFloat32(payload + i * 4, true) > 0.5) held.push(i);
    return { kind, blockIndex, held };
  }

  return null; // kind None, or one this build does not know
}
