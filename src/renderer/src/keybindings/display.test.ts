import { describe, expect, it } from "vitest";
import { formatKey } from "./display";

describe("writing a keystroke out", () => {
  it("uses symbols on a Mac and words elsewhere", () => {
    expect(formatKey("mod+k", true)).toBe("⌘K");
    expect(formatKey("mod+k", false)).toBe("Ctrl+K");
  });

  it("orders the modifiers the way the platform does", () => {
    // A Mac puts command last, next to the key; Windows and Linux put control first.
    expect(formatKey("shift+mod+z", true)).toBe("⇧⌘Z");
    expect(formatKey("shift+mod+z", false)).toBe("Ctrl+Shift+Z");
  });

  it("names the keys that have no character", () => {
    expect(formatKey("escape", true)).toBe("Esc");
    expect(formatKey("mod+backspace", true)).toBe("⌘⌫");
    expect(formatKey("alt+arrowup", true)).toBe("⌥↑");
  });

  it("leaves a bare key alone but for its case", () => {
    expect(formatKey("g", true)).toBe("G");
    expect(formatKey("f2", false)).toBe("F2");
  });
});
