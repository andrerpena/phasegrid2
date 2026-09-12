import { describe, expect, it } from "vitest";
import { keyLayout, octaveStart } from "./PianoBlock";

describe("a keyboard's layout", () => {
  it("starts an octave where MIDI does: C-1 is 0, middle C is C4", () => {
    expect(octaveStart(-1)).toBe(0);
    expect(octaveStart(4)).toBe(60);
    expect(octaveStart(3)).toBe(48);
  });

  it("gives two octaves from C3 fourteen white keys and ten black ones, in order", () => {
    const keys = keyLayout(48, 2, 200, 60);
    const whites = keys.filter((k) => !k.black);
    const blacks = keys.filter((k) => k.black);
    expect(whites).toHaveLength(14);
    expect(blacks).toHaveLength(10);
    expect(whites[0].midi).toBe(48);
    expect(whites.map((k) => k.midi)).toEqual([
      48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71,
    ]);
    expect(blacks.map((k) => k.midi)).toEqual([
      49, 51, 54, 56, 58, 61, 63, 66, 68, 70,
    ]);
    // Whites first, then blacks, so drawing in order puts the blacks on top.
    expect(keys.findIndex((k) => k.black)).toBe(14);
  });

  it("makes black keys narrower and shorter than the whites, sitting on their boundary", () => {
    const keys = keyLayout(60, 1, 150, 50);
    const c = keys.find((k) => k.midi === 60);
    const cSharp = keys.find((k) => k.midi === 61);
    const d = keys.find((k) => k.midi === 62);
    if (c === undefined || cSharp === undefined || d === undefined)
      throw new Error("an octave has these");
    expect(cSharp.width).toBeLessThan(c.width);
    expect(cSharp.height).toBeLessThan(c.height);
    expect(cSharp.x).toBeGreaterThan(c.x);
    expect(cSharp.x + cSharp.width).toBeGreaterThan(d.x);
    expect(cSharp.x).toBeLessThan(d.x);
  });

  it("shares the width equally among the white keys, whatever the range", () => {
    const one = keyLayout(48, 1, 150, 50).filter((k) => !k.black);
    const three = keyLayout(48, 3, 150, 50).filter((k) => !k.black);
    expect(three).toHaveLength(21);
    expect(three[0].width * 3).toBeCloseTo(one[0].width);
    const last = three[three.length - 1];
    expect(last.x + last.width).toBeCloseTo(one[6].x + one[6].width);
  });
});
