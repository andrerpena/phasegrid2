import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "./selection-store";

beforeEach(() => {
  useSelectionStore.setState({ modules: [] });
});

describe("the selection", () => {
  it("starts empty", () => {
    expect(useSelectionStore.getState().isEmpty()).toBe(true);
  });

  it("holds what was selected", () => {
    useSelectionStore.getState().set(["osc", "amp"]);
    expect(useSelectionStore.getState().modules).toEqual(["osc", "amp"]);
    expect(useSelectionStore.getState().has("amp")).toBe(true);
    expect(useSelectionStore.getState().has("filter")).toBe(false);
  });

  it("keeps the same array when nothing changed", () => {
    // Clicking the same node again is a selection change that changes nothing, and every subscriber
    // that re-renders on a new reference would do so on each click.
    useSelectionStore.getState().set(["osc"]);
    const first = useSelectionStore.getState().modules;
    useSelectionStore.getState().set(["osc"]);
    expect(useSelectionStore.getState().modules).toBe(first);
  });

  it("notices order, because the order is the order they were picked in", () => {
    useSelectionStore.getState().set(["osc", "amp"]);
    const first = useSelectionStore.getState().modules;
    useSelectionStore.getState().set(["amp", "osc"]);
    expect(useSelectionStore.getState().modules).not.toBe(first);
  });

  it("copies rather than keeping the caller's array", () => {
    // The caller is a Pixi class handing over a spread of its own Set. Keeping the reference would be
    // fine today and a shared mutable list the first time it stops spreading.
    const ids = ["osc"];
    useSelectionStore.getState().set(ids);
    expect(useSelectionStore.getState().modules).not.toBe(ids);
  });

  it("clears", () => {
    useSelectionStore.getState().set(["osc"]);
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().isEmpty()).toBe(true);
  });
});
