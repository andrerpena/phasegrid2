import { describe, expect, it } from "vitest";
import { isCompatibleProtocol, PROTOCOL_VERSION } from "./version";

describe("protocol version", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
  it("accepts only the same major", () => {
    expect(isCompatibleProtocol(1)).toBe(true);
    expect(isCompatibleProtocol(2)).toBe(false);
  });
});
