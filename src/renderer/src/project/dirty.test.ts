import { usePatchStore } from "@renderer/patch/patch-store";
import { EMPTY_PATCH } from "@shared/protocol/patch";
import { beforeEach, describe, expect, it } from "vitest";
import { startDirtyTracking } from "./dirty";
import { emptyProject, useProjectStore } from "./project-store";

let stop = () => {};

beforeEach(() => {
  stop();
  useProjectStore.setState({ projects: [], activeId: null, dirtyIds: [] });
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
  stop = startDirtyTracking();
});

function addModule(): void {
  usePatchStore
    .getState()
    .apply([{ op: "moduleAdd", id: "osc", type: "osc.sine" }]);
}

describe("knowing a project has unsaved work", () => {
  it("marks the project in front when it is edited", () => {
    const project = emptyProject();
    useProjectStore.getState().open(project);
    expect(useProjectStore.getState().isDirty(project.id)).toBe(false);
    addModule();
    expect(useProjectStore.getState().isDirty(project.id)).toBe(true);
  });

  it("clears when the project is saved", () => {
    const project = emptyProject();
    useProjectStore.getState().open(project);
    addModule();
    useProjectStore.getState().markClean(project.id);
    expect(useProjectStore.getState().isDirty(project.id)).toBe(false);
  });

  it("does not mark anything for a project being loaded", () => {
    // Opening a file is not a change to it. If it were, every project would be unsaved the moment it
    // appeared, and the mark would stop meaning anything.
    const project = emptyProject();
    useProjectStore.getState().open(project);
    usePatchStore.getState().replace(EMPTY_PATCH);
    expect(useProjectStore.getState().isDirty(project.id)).toBe(false);
  });

  it("does not mark anything for an edit the engine told us about", () => {
    const project = emptyProject();
    useProjectStore.getState().open(project);
    usePatchStore
      .getState()
      .apply([{ op: "moduleAdd", id: "osc", type: "osc.sine" }], {
        source: "remote",
      });
    expect(useProjectStore.getState().isDirty(project.id)).toBe(false);
  });

  it("marks only the project that was edited", () => {
    const first = emptyProject("First");
    const second = emptyProject("Second");
    useProjectStore.getState().open(first);
    useProjectStore.getState().open(second);
    addModule();
    expect(useProjectStore.getState().isDirty(second.id)).toBe(true);
    expect(useProjectStore.getState().isDirty(first.id)).toBe(false);
  });

  it("leaves both alone when the tab is switched", () => {
    const first = emptyProject("First");
    const second = emptyProject("Second");
    useProjectStore.getState().open(first);
    addModule();
    useProjectStore.getState().open(second);
    useProjectStore.getState().activate(first.id);
    expect(useProjectStore.getState().isDirty(first.id)).toBe(true);
    expect(useProjectStore.getState().isDirty(second.id)).toBe(false);
  });

  it("marks the project when the tempo changes, because the tempo is part of the piece", () => {
    const project = emptyProject();
    useProjectStore.getState().open(project);
    useProjectStore.getState().setTempo(140);
    expect(useProjectStore.getState().isDirty(project.id)).toBe(true);
  });

  it("forgets a closed project rather than keeping it dirty forever", () => {
    const project = emptyProject();
    useProjectStore.getState().open(project);
    addModule();
    useProjectStore.getState().close(project.id);
    expect(useProjectStore.getState().dirtyIds).toEqual([]);
  });
});

describe("the document as it stands", () => {
  it("takes the active project's patch from the live document", () => {
    // The record only catches up when you switch tabs. Saving the record alone would write the patch
    // as it was at the last switch, which is a silent way to lose an afternoon.
    const project = emptyProject();
    useProjectStore.getState().open(project);
    addModule();
    expect(
      useProjectStore
        .getState()
        .snapshot(project.id)
        ?.patch.modules.map((m) => m.id),
    ).toEqual(["osc"]);
  });

  it("takes a background project's patch from its record", () => {
    const first = emptyProject("First");
    const second = emptyProject("Second");
    useProjectStore.getState().open(first);
    addModule();
    useProjectStore.getState().open(second);
    expect(
      useProjectStore
        .getState()
        .snapshot(first.id)
        ?.patch.modules.map((m) => m.id),
    ).toEqual(["osc"]);
    expect(
      useProjectStore
        .getState()
        .snapshot(second.id)
        ?.patch.modules.map((m) => m.id),
    ).toEqual([]);
  });
});
