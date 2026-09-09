import { describe, expect, it } from "vitest";
import { isSlug, slugify, uniqueName, uniqueSlug } from "./workspace";

describe("slugs", () => {
  it("accepts what it produces and refuses what it does not", () => {
    expect(isSlug("my-track")).toBe(true);
    expect(isSlug("track2")).toBe(true);
    expect(isSlug("")).toBe(false);
    expect(isSlug("..")).toBe(false);
    expect(isSlug("-leading")).toBe(false);
    expect(isSlug("Upper")).toBe(false);
    expect(isSlug("with space")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("a".repeat(65))).toBe(false);
  });

  it("makes a slug out of a name a person would type", () => {
    expect(slugify("My Track")).toBe("my-track");
    expect(slugify("  Bass //  Line 2 ")).toBe("bass-line-2");
    expect(slugify("Café Noir")).toBe("caf-noir");
  });

  it("falls back rather than producing an empty slug", () => {
    // A name of nothing but punctuation is a name; it just is not a folder name.
    expect(isSlug(slugify("***"))).toBe(true);
    expect(isSlug(slugify(""))).toBe(true);
  });

  it("uniquifies against what is already there", () => {
    expect(uniqueSlug("my-track", [])).toBe("my-track");
    expect(uniqueSlug("my-track", ["my-track"])).toBe("my-track-2");
    expect(uniqueSlug("my-track", ["my-track", "my-track-2"])).toBe(
      "my-track-3",
    );
  });

  it("numbers a name the same way it numbers a folder", () => {
    // The two run in step, so the second copy of an example is "Sine 2" in "sine-2" rather than a
    // name and a folder that have nothing to do with each other.
    expect(uniqueName("Sine", [])).toBe("Sine");
    expect(uniqueName("Sine", ["Sine"])).toBe("Sine 2");
    expect(uniqueName("Sine", ["Sine", "Sine 2"])).toBe("Sine 3");
    expect(slugify(uniqueName("Sine", ["Sine"]))).toBe(
      uniqueSlug("sine", ["sine"]),
    );
  });
});
