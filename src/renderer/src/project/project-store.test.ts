import { useHistoryStore } from "@renderer/history/history-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { EMPTY_PATCH, type PatchDoc } from "@shared/protocol/patch";
import type { ProjectDoc } from "@shared/protocol/project";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyProject, useProjectStore } from "./project-store";

function withModule(id: string): PatchDoc {
  return { ...EMPTY_PATCH, modules: [{ id, type: "amp.vca", x: 0, y: 0 }] };
}

function project(name: string, patch: PatchDoc): ProjectDoc {
  return { ...emptyProject(name), patch };
}

beforeEach(() => {
  useProjectStore.setState({ projects: [], activeId: null });
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
  useHistoryStore.setState({
    past: [],
    future: [],
    applying: false,
    limit: 200,
  });
});

describe("open projects", () => {
  it("makes an opened project the live document", () => {
    useProjectStore.getState().open(project("A", withModule("a")));
    expect(usePatchStore.getState().doc.modules[0].id).toBe("a");
  });

  it("keeps each tab's edits when switching between them", () => {
    // The live document is the active project's. Switching has to write the outgoing one back, or the
    // work done in a tab vanishes the moment you look at another.
    const a = project("A", withModule("a"));
    const b = project("B", withModule("b"));
    useProjectStore.getState().open(a);
    usePatchStore
      .getState()
      .apply([{ op: "moduleAdd", id: "extra", type: "amp.vca" }]);
    useProjectStore.getState().open(b);
    expect(usePatchStore.getState().doc.modules.map((m) => m.id)).toEqual([
      "b",
    ]);

    useProjectStore.getState().activate(a.id);
    expect(
      usePatchStore
        .getState()
        .doc.modules.map((m) => m.id)
        .sort(),
    ).toEqual(["a", "extra"]);
  });

  it("brings an already-open project forward rather than opening it twice", () => {
    // Two tabs of one project would be two documents that quietly disagree.
    const a = project("A", withModule("a"));
    useProjectStore.getState().open(a);
    useProjectStore.getState().open(project("B", withModule("b")));
    useProjectStore.getState().open(a);
    expect(useProjectStore.getState().projects).toHaveLength(2);
    expect(useProjectStore.getState().activeId).toBe(a.id);
  });

  it("clears the undo history on a switch", () => {
    // Stepping back past a tab switch would undo an edit in a project you are no longer looking at.
    const a = project("A", withModule("a"));
    const b = project("B", withModule("b"));
    useProjectStore.getState().open(a);
    usePatchStore
      .getState()
      .apply([{ op: "moduleAdd", id: "x", type: "amp.vca" }], { label: "Add" });
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    useProjectStore.getState().open(b);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it("shows another tab after closing the active one", () => {
    const a = project("A", withModule("a"));
    const b = project("B", withModule("b"));
    useProjectStore.getState().open(a);
    useProjectStore.getState().open(b);
    useProjectStore.getState().close(b.id);
    expect(useProjectStore.getState().activeId).toBe(a.id);
    expect(usePatchStore.getState().doc.modules[0].id).toBe("a");
  });

  it("empties the document when the last tab closes", () => {
    const a = project("A", withModule("a"));
    useProjectStore.getState().open(a);
    useProjectStore.getState().close(a.id);
    expect(useProjectStore.getState().activeId).toBeNull();
    expect(usePatchStore.getState().doc.modules).toHaveLength(0);
  });
});

describe("project properties", () => {
  it("holds tempo, meter and scale on the project rather than on the patch", () => {
    // They belong to the music, not to the wiring: the same patch in another project should not drag
    // the old tempo along with it.
    const a = project("A", EMPTY_PATCH);
    useProjectStore.getState().open(a);
    useProjectStore.getState().setTempo(96);
    useProjectStore
      .getState()
      .setTimeSignature({ numerator: 7, denominator: 8 });
    useProjectStore.getState().setScale({ root: 4, name: "minorPentatonic" });
    const active = useProjectStore.getState().active();
    expect(active).toMatchObject({
      tempo: 96,
      timeSignature: { numerator: 7, denominator: 8 },
      scale: { root: 4, name: "minorPentatonic" },
    });
  });

  it("keeps the tempo inside what the engine accepts", () => {
    useProjectStore.getState().open(project("A", EMPTY_PATCH));
    useProjectStore.getState().setTempo(1);
    expect(useProjectStore.getState().active()?.tempo).toBeGreaterThanOrEqual(
      20,
    );
    useProjectStore.getState().setTempo(10_000);
    expect(useProjectStore.getState().active()?.tempo).toBeLessThanOrEqual(400);
  });
});
