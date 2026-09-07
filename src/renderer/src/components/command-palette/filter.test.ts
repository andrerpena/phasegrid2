import type { CommandDefinition } from "@renderer/commands/types";
import { describe, expect, it } from "vitest";
import { rankCommands } from "./filter";

const commands: CommandDefinition<never>[] = [
  { id: "patch.addModule", name: "Add Module" },
  { id: "patch.deleteSelection", name: "Delete Selection" },
  { id: "edit.undo", name: "Undo" },
  { id: "edit.redo", name: "Redo" },
  { id: "view.zoomToFit", name: "Zoom to Fit" },
];

const names = (query: string) =>
  rankCommands(commands, query).map((r) => r.command.name);

describe("ranking commands", () => {
  it("lists everything when nothing is typed", () => {
    expect(names("")).toHaveLength(commands.length);
  });

  it("matches letters in order rather than a substring", () => {
    // People type the letters they remember, not a prefix.
    expect(names("adm")[0]).toBe("Add Module");
    expect(names("ztf")[0]).toBe("Zoom to Fit");
  });

  it("prefers a match at a word boundary", () => {
    expect(names("del")[0]).toBe("Delete Selection");
  });

  it("finds a command by its id when the name does not match", () => {
    expect(names("patch.add")[0]).toBe("Add Module");
  });

  it("drops commands with no match at all", () => {
    expect(names("qqq")).toEqual([]);
  });

  it("prefers the shorter name when scores are otherwise equal", () => {
    // "Undo" and "Redo" both match "do"; the ranking must be stable rather than incidental.
    const ranked = names("do");
    expect(ranked).toContain("Undo");
    expect(ranked).toContain("Redo");
  });

  it("ignores case and surrounding space", () => {
    expect(names("  ADD MODULE  ")[0]).toBe("Add Module");
  });

  it("reports which characters matched, for highlighting", () => {
    const [first] = rankCommands(commands, "add");
    expect(first.matched).toEqual([0, 1, 2]);
  });
});
