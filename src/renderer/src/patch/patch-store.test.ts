import { useHistoryStore } from "@renderer/history/history-store";
import { EMPTY_PATCH, type PatchOp } from "@shared/protocol/patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePatchStore } from "./patch-store";

const add: PatchOp = {
  op: "moduleAdd",
  id: "osc",
  type: "osc.wavetable",
  x: 0,
  y: 0,
};

beforeEach(() => {
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
  useHistoryStore.setState({
    past: [],
    future: [],
    applying: false,
    limit: 200,
  });
});

describe("the patch document", () => {
  it("applies an edit and bumps the version", () => {
    usePatchStore.getState().apply([add]);
    expect(usePatchStore.getState().doc.modules).toHaveLength(1);
    expect(usePatchStore.getState().version).toBe(1);
  });

  it("ignores an empty edit rather than bumping the version for nothing", () => {
    usePatchStore.getState().apply([]);
    expect(usePatchStore.getState().version).toBe(0);
  });

  it("records one history entry for one edit, however many operations it took", () => {
    usePatchStore.getState().apply(
      [
        add,
        { op: "moduleAdd", id: "out", type: "io.audioOut" },
        {
          op: "edgeAdd",
          id: "e1",
          from: { module: "osc", port: "out" },
          to: { module: "out", port: "inL" },
        },
      ],
      { label: "Add oscillator" },
    );
    expect(useHistoryStore.getState().past).toHaveLength(1);
    expect(useHistoryStore.getState().past[0].label).toBe("Add oscillator");
  });

  it("undoes an edit back to the document it started from", () => {
    usePatchStore.getState().apply([add], { label: "Add" });
    useHistoryStore.getState().undo();
    expect(usePatchStore.getState().doc.modules).toHaveLength(0);
  });

  it("redoes it again", () => {
    usePatchStore.getState().apply([add], { label: "Add" });
    useHistoryStore.getState().undo();
    useHistoryStore.getState().redo();
    expect(usePatchStore.getState().doc.modules).toHaveLength(1);
  });

  it("does not record an unlabelled edit", () => {
    // A parameter drag applies dozens of these; each one becoming an undo step would make undo useless.
    usePatchStore.getState().apply([add]);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it("tells subscribers what changed and where it came from", () => {
    const heard = vi.fn();
    const stop = usePatchStore.getState().subscribeOps(heard);
    usePatchStore.getState().apply([add], { source: "user" });
    expect(heard).toHaveBeenCalledWith([add], "user");
    stop();
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const heard = vi.fn();
    usePatchStore.getState().subscribeOps(heard)();
    usePatchStore.getState().apply([add]);
    expect(heard).not.toHaveBeenCalled();
  });

  it("clears history when a whole document is opened", () => {
    // Nobody wants to step back through a file being opened one module at a time, and stepping back
    // past the open would leave a document that never existed.
    usePatchStore.getState().apply([add], { label: "Add" });
    usePatchStore
      .getState()
      .replace({ ...EMPTY_PATCH, modules: [{ id: "a", type: "amp.vca" }] });
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(usePatchStore.getState().doc.modules[0].id).toBe("a");
  });

  it("announces an opened document as a load rather than as operations", () => {
    const heard = vi.fn();
    const stop = usePatchStore.getState().subscribeOps(heard);
    usePatchStore.getState().replace(EMPTY_PATCH);
    expect(heard).toHaveBeenCalledWith([], "load");
    stop();
  });
});

describe("an edit that carries its own inverse", () => {
  /**
   * A knob drag writes the document on every frame and is recorded once, at the end. By then the
   * document no longer remembers where the knob was when the hand went down, so the gesture hands
   * over the inverse itself. Without it, undo steps back to the last frame of the drag, which looks
   * like undo doing nothing at all.
   */
  it("undoes to the value the caller named, not to the one the document had", () => {
    const store = usePatchStore.getState();
    store.replace(EMPTY_PATCH);
    store.apply([
      { op: "moduleAdd", id: "g", type: "amp.vca", params: { gain: 0.2 } },
    ]);

    // The gesture: three frames written straight into the document, none of them a step back.
    for (const value of [0.4, 0.6, 0.8])
      usePatchStore.getState().apply([
        {
          op: "paramSet",
          module: "g",
          param: "gain",
          value,
          transient: true,
        },
      ]);
    expect(useHistoryStore.getState().past).toHaveLength(0); // nothing recorded yet

    usePatchStore
      .getState()
      .apply([{ op: "paramSet", module: "g", param: "gain", value: 0.9 }], {
        label: "Set parameter",
        inverse: [{ op: "paramSet", module: "g", param: "gain", value: 0.2 }],
      });
    expect(gainOf()).toBe(0.9);

    useHistoryStore.getState().undo();
    expect(gainOf()).toBe(0.2);
  });

  it("derives the inverse from the document when the caller names none", () => {
    const store = usePatchStore.getState();
    store.replace(EMPTY_PATCH);
    store.apply([
      { op: "moduleAdd", id: "g", type: "amp.vca", params: { gain: 0.2 } },
    ]);
    usePatchStore
      .getState()
      .apply([{ op: "paramSet", module: "g", param: "gain", value: 0.7 }], {
        label: "Set parameter",
      });
    useHistoryStore.getState().undo();
    expect(gainOf()).toBe(0.2);
  });

  it("writes a mid-gesture value to the document without recording a step", () => {
    const store = usePatchStore.getState();
    store.replace(EMPTY_PATCH);
    store.apply([{ op: "moduleAdd", id: "g", type: "amp.vca" }]);
    const before = useHistoryStore.getState().past.length;
    usePatchStore.getState().apply([
      {
        op: "paramSet",
        module: "g",
        param: "gain",
        value: 0.33,
        transient: true,
      },
    ]);
    expect(gainOf()).toBe(0.33);
    expect(useHistoryStore.getState().past).toHaveLength(before);
  });
});

function gainOf(): number | undefined {
  return usePatchStore.getState().doc.modules.find((m) => m.id === "g")?.params
    ?.gain;
}
