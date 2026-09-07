import { beforeEach, describe, expect, it } from "vitest";
import { useHistoryStore } from "./history-store";

let value = 0;

/** An entry that sets a value, remembering what it was. */
function setTo(next: number, previous: number) {
  return {
    label: `set ${next}`,
    apply: () => {
      value = next;
    },
    revert: () => {
      value = previous;
    },
  };
}

beforeEach(() => {
  value = 0;
  useHistoryStore.setState({
    past: [],
    future: [],
    applying: false,
    limit: 200,
  });
});

describe("history", () => {
  it("steps back and forward", () => {
    value = 1;
    useHistoryStore.getState().push(setTo(1, 0));
    useHistoryStore.getState().undo();
    expect(value).toBe(0);
    useHistoryStore.getState().redo();
    expect(value).toBe(1);
  });

  it("steps back through several edits in order", () => {
    useHistoryStore.getState().push(setTo(1, 0));
    useHistoryStore.getState().push(setTo(2, 1));
    value = 2;
    useHistoryStore.getState().undo();
    expect(value).toBe(1);
    useHistoryStore.getState().undo();
    expect(value).toBe(0);
  });

  it("does nothing when there is nothing to undo", () => {
    useHistoryStore.getState().undo();
    useHistoryStore.getState().redo();
    expect(value).toBe(0);
  });

  it("does not record the changes an undo itself causes", () => {
    // Otherwise undo would push a redo of itself and the two would never converge, which looks to a
    // user like undo has stopped working.
    useHistoryStore.getState().push(setTo(1, 0));
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().past).toHaveLength(0);
    expect(useHistoryStore.getState().future).toHaveLength(1);
  });

  it("discards the redo branch when something new is done", () => {
    useHistoryStore.getState().push(setTo(1, 0));
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().canRedo()).toBe(true);
    useHistoryStore.getState().push(setTo(5, 0));
    expect(useHistoryStore.getState().canRedo()).toBe(false);
  });

  it("forgets the oldest entry rather than growing without limit", () => {
    useHistoryStore.setState({ limit: 3 });
    for (let i = 1; i <= 5; i++)
      useHistoryStore.getState().push(setTo(i, i - 1));
    expect(useHistoryStore.getState().past).toHaveLength(3);
    expect(useHistoryStore.getState().past[0].label).toBe("set 3");
  });

  it("records nothing done inside `silently`", () => {
    // Loading a project makes hundreds of changes that nobody wants to step back through one at a time.
    useHistoryStore.getState().silently(() => {
      useHistoryStore.getState().push(setTo(1, 0));
      useHistoryStore.getState().push(setTo(2, 1));
    });
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it("keeps recording after an entry throws", () => {
    useHistoryStore.getState().push({
      label: "bad",
      apply: () => {},
      revert: () => {
        throw new Error("revert failed");
      },
    });
    expect(() => useHistoryStore.getState().undo()).toThrow("revert failed");
    // The flag has to come back down, or nothing would ever be recorded again and undo would silently
    // stop working for the rest of the session.
    expect(useHistoryStore.getState().applying).toBe(false);
  });
});
