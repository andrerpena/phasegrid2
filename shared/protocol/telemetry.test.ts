import { describe, expect, it } from "vitest";
import {
  decodeSlot,
  METER_FLOATS_PER_CHANNEL,
  readHeader,
  slotOffset,
  TELEMETRY_HEADER_BYTES,
  TELEMETRY_LAYOUT_VERSION,
  TELEMETRY_MAGIC,
  TELEMETRY_SCOPE_FRAMES,
  TELEMETRY_SLOT_BYTES,
  TELEMETRY_SLOT_HEADER_BYTES,
  TelemetryKind,
} from "./telemetry";

/** Builds the bytes the engine would write, so the decoder is tested against the layout, not itself. */
function buildHeader(
  overrides: Partial<{
    magic: number;
    layoutVersion: number;
    slotCount: number;
  }> = {},
): DataView {
  const view = new DataView(new ArrayBuffer(TELEMETRY_HEADER_BYTES));
  view.setUint32(0, overrides.magic ?? TELEMETRY_MAGIC, true);
  view.setUint32(4, overrides.layoutVersion ?? TELEMETRY_LAYOUT_VERSION, true);
  view.setUint32(8, overrides.slotCount ?? 64, true);
  view.setUint32(12, TELEMETRY_SLOT_BYTES, true);
  view.setFloat64(16, 48000, true);
  view.setUint32(24, 64, true);
  view.setBigUint64(32, 12345n, true);
  return view;
}

function buildSlot(opts: {
  seq: number;
  kind: TelemetryKind;
  channels: number;
  frames: number;
  blockIndex?: bigint;
  fill?: (view: DataView, payload: number) => void;
}): Uint8Array {
  const bytes = new Uint8Array(TELEMETRY_SLOT_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, opts.seq, true);
  view.setUint32(4, opts.kind, true);
  view.setUint32(8, opts.channels, true);
  view.setUint32(12, opts.frames, true);
  view.setBigUint64(16, opts.blockIndex ?? 1n, true);
  opts.fill?.(view, TELEMETRY_SLOT_HEADER_BYTES);
  return bytes;
}

describe("the telemetry segment header", () => {
  it("reads the fields the engine wrote", () => {
    const header = readHeader(buildHeader());
    expect(header).not.toBeNull();
    expect(header?.slotCount).toBe(64);
    expect(header?.sampleRate).toBe(48000);
    expect(header?.blockSize).toBe(64);
    expect(header?.heartbeat).toBe(12345n);
  });

  it("refuses bytes that are not a segment", () => {
    // Before the engine writes it, or if something else owns the name, this is whatever was there.
    expect(readHeader(buildHeader({ magic: 0xdeadbeef }))).toBeNull();
  });

  it("refuses a layout it does not know rather than guessing at the offsets", () => {
    // An engine of a different vintage. Reading it anyway would produce plausible-looking garbage,
    // which is worse than showing nothing, because nobody would know to distrust it.
    expect(readHeader(buildHeader({ layoutVersion: 99 }))).toBeNull();
  });

  it("refuses a buffer too short to hold a header", () => {
    expect(readHeader(new DataView(new ArrayBuffer(16)))).toBeNull();
  });

  it("places slots after the header, one slot size apart", () => {
    expect(slotOffset(0)).toBe(TELEMETRY_HEADER_BYTES);
    expect(slotOffset(3)).toBe(
      TELEMETRY_HEADER_BYTES + 3 * TELEMETRY_SLOT_BYTES,
    );
  });
});

describe("decoding a slot", () => {
  it("reads a meter's peak, RMS and clip count per channel", () => {
    const slot = buildSlot({
      seq: 4,
      kind: TelemetryKind.Meter,
      channels: 2,
      frames: 64,
      fill: (view, at) => {
        const values = [0.5, 0.25, 0, 0.75, 0.5, 3];
        for (const [i, v] of values.entries())
          view.setFloat32(at + i * 4, v, true);
      },
    });
    const reading = decodeSlot(slot);
    expect(reading?.kind).toBe(TelemetryKind.Meter);
    if (reading?.kind !== TelemetryKind.Meter) return;
    expect(reading.peak).toEqual([0.5, 0.75]);
    expect(reading.rms).toEqual([0.25, 0.5]);
    expect(reading.clipped).toEqual([0, 3]);
  });

  it("reads a scope's samples, one array per channel", () => {
    const slot = buildSlot({
      seq: 2,
      kind: TelemetryKind.Scope,
      channels: 2,
      frames: 3,
      fill: (view, at) => {
        for (const [i, v] of [1, 2, 3].entries())
          view.setFloat32(at + i * 4, v, true);
        // The second channel starts a whole scope window in, not after the frames this block carried,
        // so the stride does not depend on how full the block happened to be.
        for (const [i, v] of [-1, -2, -3].entries())
          view.setFloat32(at + TELEMETRY_SCOPE_FRAMES * 4 + i * 4, v, true);
      },
    });
    const reading = decodeSlot(slot);
    if (reading?.kind !== TelemetryKind.Scope)
      throw new Error("expected a scope");
    expect(Array.from(reading.channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(reading.channels[1])).toEqual([-1, -2, -3]);
  });

  it("reads a params slot as one value per parameter, in order", () => {
    const bytes = buildSlot({
      seq: 2,
      kind: TelemetryKind.Params,
      channels: 3,
      frames: 1,
      blockIndex: 9n,
      fill: (view, payload) => {
        view.setFloat32(payload, 1.25, true);
        view.setFloat32(payload + 4, 0, true);
        view.setFloat32(payload + 8, -6, true);
      },
    });
    const reading = decodeSlot(bytes);
    expect(reading?.kind).toBe(TelemetryKind.Params);
    if (reading?.kind !== TelemetryKind.Params) return;
    expect(reading.values).toEqual([1.25, 0, -6]);
    expect(reading.blockIndex).toBe(9n);
  });

  it("declines a params slot claiming more parameters than a module can have", () => {
    // Sixty-four is the engine's own ceiling; anything past it is a torn header, not a big module.
    const bytes = buildSlot({
      seq: 2,
      kind: TelemetryKind.Params,
      channels: 65,
      frames: 1,
    });
    expect(decodeSlot(bytes)).toBeNull();
  });

  it("declines a slot nobody has written yet", () => {
    expect(
      decodeSlot(
        buildSlot({ seq: 0, kind: TelemetryKind.None, channels: 0, frames: 0 }),
      ),
    ).toBeNull();
  });

  it("declines a slot the engine is inside right now", () => {
    // An odd counter is the writer saying "not yet". This is the case the seqlock exists for: reading
    // through it would return a payload that is part old and part new, with nothing to mark it.
    const slot = buildSlot({
      seq: 5,
      kind: TelemetryKind.Meter,
      channels: 2,
      frames: 64,
    });
    expect(decodeSlot(slot)).toBeNull();
  });

  it("declines a channel count that could not be true", () => {
    // These numbers come from another process. A count of four billion must produce null, not an
    // exception and certainly not a read past the buffer.
    const slot = buildSlot({
      seq: 2,
      kind: TelemetryKind.Meter,
      channels: 0xffffffff,
      frames: 64,
    });
    expect(decodeSlot(slot)).toBeNull();
  });

  it("declines a frame count larger than a scope window", () => {
    const slot = buildSlot({
      seq: 2,
      kind: TelemetryKind.Scope,
      channels: 1,
      frames: TELEMETRY_SCOPE_FRAMES + 1,
    });
    expect(decodeSlot(slot)).toBeNull();
  });

  it("declines a kind it does not know", () => {
    const slot = buildSlot({
      seq: 2,
      kind: 99 as TelemetryKind,
      channels: 1,
      frames: 8,
    });
    expect(decodeSlot(slot)).toBeNull();
  });

  it("declines a truncated buffer rather than reading past it", () => {
    const full = buildSlot({
      seq: 2,
      kind: TelemetryKind.Meter,
      channels: 2,
      frames: 64,
    });
    // Enough for the slot header but not for two channels of meter values.
    const short = full.slice(
      0,
      TELEMETRY_SLOT_HEADER_BYTES + METER_FLOATS_PER_CHANNEL * 4,
    );
    expect(decodeSlot(short)).toBeNull();
  });

  it("declines a buffer too short even for a slot header", () => {
    expect(decodeSlot(new Uint8Array(8))).toBeNull();
  });
});
