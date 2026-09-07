import { descriptor } from "@renderer/grid/fixtures";
import type { PatchModule } from "@shared/protocol/patch";
import { describe, expect, it } from "vitest";
import { paramDefault, paramValue } from "./params";

/**
 * The one rule for reading a value, which is why it is worth its own test: a knob, the inspector and
 * anything else that draws a parameter have to agree about what happens when the document does not
 * mention it, and a copy of this rule per view is a chance for two views to show different numbers.
 */

const vca = descriptor("amp.vca");
const module = (params?: Record<string, number>): PatchModule => ({
  id: "g",
  type: "amp.vca",
  ...(params !== undefined ? { params } : {}),
});

describe("reading a parameter's value", () => {
  it("takes the module's own value when it has one", () => {
    expect(paramValue(module({ gain: 0.25 }), vca, "gain")).toBe(0.25);
  });

  it("falls back to the descriptor's default", () => {
    const fallback = paramDefault(vca, "gain");
    expect(paramValue(module(), vca, "gain")).toBe(fallback);
    expect(paramValue(module({}), vca, "gain")).toBe(fallback);
    expect(paramValue(undefined, vca, "gain")).toBe(fallback);
  });

  it("keeps a zero rather than mistaking it for nothing", () => {
    // The whole reason this is `??` and not `||`. Zero is a perfectly ordinary gain, and a knob that
    // sprang back to its default every time it reached the bottom would be maddening.
    expect(paramValue(module({ gain: 0 }), vca, "gain")).toBe(0);
  });

  it("answers zero for a parameter the module does not have", () => {
    expect(paramValue(module(), vca, "nosuchparam")).toBe(0);
    expect(paramDefault(vca, "nosuchparam")).toBe(0);
  });
});
