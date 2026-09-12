import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside } from "./path-guard";

const ROOT = "/tmp/pg-workspace";

describe("resolving a path inside the workspace", () => {
  it("resolves an ordinary path", () => {
    expect(resolveInside(ROOT, "projects", "my-track", "project.json")).toBe(
      join(ROOT, "projects", "my-track", "project.json"),
    );
  });

  it("refuses a segment that climbs out", () => {
    // The renderer is ours, and that is exactly why this is checked: a boundary that trusts its input
    // because of where the input came from is not a boundary.
    expect(() => resolveInside(ROOT, "projects", "../../etc/passwd")).toThrow();
    expect(() => resolveInside(ROOT, "..")).toThrow();
  });

  it("refuses an absolute segment, which would replace the root entirely", () => {
    expect(() => resolveInside(ROOT, "/etc/passwd")).toThrow();
  });

  it("refuses the root itself dressed up as a child", () => {
    expect(() => resolveInside(ROOT, "projects", "..", "..")).toThrow();
  });

  it("refuses a sibling folder whose name merely starts with the root", () => {
    // `/tmp/pg-workspace-evil` starts with `/tmp/pg-workspace`, so a prefix comparison would let it
    // through. The separator is what makes it a containment test rather than a string test.
    expect(() => resolveInside(ROOT, "..", "pg-workspace-evil")).toThrow();
  });
});
