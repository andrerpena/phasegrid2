import { useHistoryStore } from "@renderer/history/history-store";
import { emptyProject, useProjectStore } from "@renderer/project/project-store";
import { useSelectionStore } from "@renderer/selection/selection-store";
import { EMPTY_PATCH, type PatchDoc } from "@shared/protocol/patch";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteSelection } from "./delete-selection";
import { usePatchStore } from "./patch-store";

const PATCH: PatchDoc = {
  ...EMPTY_PATCH,
  modules: [
    { id: "osc", type: "osc.sine", params: {} },
    { id: "amp", type: "amp.vca", params: {} },
    { id: "out", type: "io.out", params: {} },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "osc", port: "out" },
      to: { module: "amp", port: "in" },
    },
    {
      id: "e2",
      from: { module: "amp", port: "out" },
      to: { module: "out", port: "in" },
    },
  ],
};

function open(): void {
  useProjectStore.getState().open(emptyProject());
  usePatchStore.getState().replace(PATCH);
}

const ids = (): string[] =>
  usePatchStore.getState().doc.modules.map((m) => m.id);
const edges = (): string[] =>
  usePatchStore.getState().doc.edges.map((e) => e.id);

beforeEach(() => {
  useProjectStore.setState({ projects: [], activeId: null, dirtyIds: [] });
  useSelectionStore.setState({ modules: [] });
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
  useHistoryStore.getState().clear();
});

describe("deleting the selection", () => {
  it("removes a selected module", () => {
    open();
    useSelectionStore.getState().set(["amp"]);
    deleteSelection();
    expect(ids()).toEqual(["osc", "out"]);
  });

  it("takes the cables attached to it", () => {
    // A patch that kept an edge pointing at a module that is gone is a patch the engine has to cope
    // with, and one the user cannot see is broken.
    open();
    useSelectionStore.getState().set(["amp"]);
    deleteSelection();
    expect(edges()).toEqual([]);
  });

  it("leaves cables that touch nothing selected", () => {
    open();
    useSelectionStore.getState().set(["out"]);
    deleteSelection();
    expect(edges()).toEqual(["e1"]);
  });

  it("removes several at once", () => {
    open();
    useSelectionStore.getState().set(["osc", "amp"]);
    deleteSelection();
    expect(ids()).toEqual(["out"]);
  });

  it("is one step back, cables included", () => {
    open();
    useSelectionStore.getState().set(["osc", "amp"]);
    deleteSelection();
    useHistoryStore.getState().undo();
    expect(ids().sort()).toEqual(["amp", "osc", "out"]);
    expect(edges().sort()).toEqual(["e1", "e2"]);
  });

  it("clears the selection, which no longer describes anything", () => {
    open();
    useSelectionStore.getState().set(["amp"]);
    deleteSelection();
    expect(useSelectionStore.getState().isEmpty()).toBe(true);
  });

  it("does nothing with an empty selection", () => {
    open();
    deleteSelection();
    expect(ids()).toEqual(["osc", "amp", "out"]);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it("does nothing with no project open", () => {
    usePatchStore.getState().replace(PATCH);
    useSelectionStore.getState().set(["amp"]);
    deleteSelection();
    expect(ids()).toEqual(["osc", "amp", "out"]);
  });

  it("survives a selection naming something already gone", () => {
    open();
    useSelectionStore.getState().set(["ghost"]);
    deleteSelection();
    expect(ids()).toEqual(["osc", "amp", "out"]);
    expect(useSelectionStore.getState().isEmpty()).toBe(true);
  });

  it("removes the ones that are there and ignores the ones that are not", () => {
    open();
    useSelectionStore.getState().set(["amp", "ghost"]);
    deleteSelection();
    expect(ids()).toEqual(["osc", "out"]);
  });
});
