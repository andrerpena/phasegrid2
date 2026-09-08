import { describe, expect, it } from "vitest";
import {
  clampLabelWidth,
  DEFAULT_LABEL_WIDTH,
  MAX_LABEL_WIDTH,
  MIN_LABEL_WIDTH,
} from "./SchemaFormLayoutContext";

describe("clampLabelWidth", () => {
  it("passes through values inside [MIN, MAX]", () => {
    expect(clampLabelWidth(DEFAULT_LABEL_WIDTH)).toBe(DEFAULT_LABEL_WIDTH);
    expect(clampLabelWidth(DEFAULT_LABEL_WIDTH + 50)).toBe(
      DEFAULT_LABEL_WIDTH + 50,
    );
  });

  it("clamps below MIN", () => {
    expect(clampLabelWidth(0)).toBe(MIN_LABEL_WIDTH);
    expect(clampLabelWidth(-100)).toBe(MIN_LABEL_WIDTH);
    expect(clampLabelWidth(MIN_LABEL_WIDTH - 1)).toBe(MIN_LABEL_WIDTH);
  });

  it("clamps above MAX", () => {
    expect(clampLabelWidth(99999)).toBe(MAX_LABEL_WIDTH);
    expect(clampLabelWidth(MAX_LABEL_WIDTH + 1)).toBe(MAX_LABEL_WIDTH);
  });

  it("simulates the splitter drag math: startWidth + delta clamped", () => {
    // Starting at default, dragging right by 50px → label grows by 50px.
    expect(clampLabelWidth(DEFAULT_LABEL_WIDTH + 50)).toBe(
      DEFAULT_LABEL_WIDTH + 50,
    );
    // Dragging left far enough to underflow → clamps to MIN.
    expect(clampLabelWidth(DEFAULT_LABEL_WIDTH - 500)).toBe(MIN_LABEL_WIDTH);
    // Dragging right far enough to overflow → clamps to MAX.
    expect(clampLabelWidth(DEFAULT_LABEL_WIDTH + 1000)).toBe(MAX_LABEL_WIDTH);
  });
});
