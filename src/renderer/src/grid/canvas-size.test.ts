import { describe, expect, it } from "vitest";
import { createSizeSync, type Size } from "./canvas-size";

/** A frame that runs when the test says so, standing in for `requestAnimationFrame`. */
function frames() {
  const queued = new Map<number, () => void>();
  let next = 1;
  return {
    schedule: (run: () => void) => {
      const handle = next++;
      queued.set(handle, run);
      return handle;
    },
    cancel: (handle: number) => {
      queued.delete(handle);
    },
    /** Runs everything queued, as the browser would at the start of the next frame. */
    run: () => {
      const due = [...queued.values()];
      queued.clear();
      for (const run of due) run();
    },
    get length() {
      return queued.size;
    },
  };
}

function sync() {
  const applied: Size[] = [];
  const frame = frames();
  const it = createSizeSync(
    (size) => applied.push(size),
    frame.schedule,
    frame.cancel,
  );
  return { applied, frame, sync: it };
}

describe("applying a canvas's size", () => {
  it("applies the latest size once per frame", () => {
    const { applied, frame, sync: it } = sync();
    // A divider drag reports many times between two paints.
    it.request({ width: 100, height: 100 });
    it.request({ width: 120, height: 100 });
    it.request({ width: 140, height: 100 });
    expect(applied).toEqual([]);
    frame.run();
    expect(applied).toEqual([{ width: 140, height: 100 }]);
  });

  it("drops a size with a zero in it", () => {
    const { applied, frame, sync: it } = sync();
    // A closed panel, or a box the browser has not laid out yet. Resizing a WebGL surface to
    // nothing loses the context.
    it.request({ width: 0, height: 400 });
    it.request({ width: 400, height: 0 });
    frame.run();
    expect(applied).toEqual([]);
  });

  it("does nothing when the size has not changed", () => {
    const { applied, frame, sync: it } = sync();
    it.request({ width: 300, height: 200 });
    frame.run();
    it.request({ width: 300, height: 200 });
    expect(frame.length).toBe(0);
    frame.run();
    expect(applied).toEqual([{ width: 300, height: 200 }]);
  });

  it("applies nothing when a frame's reports end where they started", () => {
    const { applied, frame, sync: it } = sync();
    it.request({ width: 300, height: 200 });
    frame.run();
    // Passed through and came back inside one frame: the size it passed through must not be left
    // queued as the one to apply.
    it.request({ width: 340, height: 200 });
    it.request({ width: 300, height: 200 });
    frame.run();
    expect(applied).toEqual([{ width: 300, height: 200 }]);
  });

  it("does not apply a size requested before it was disposed", () => {
    const { applied, frame, sync: it } = sync();
    it.request({ width: 300, height: 200 });
    it.dispose();
    frame.run();
    expect(applied).toEqual([]);
    expect(frame.length).toBe(0);
  });
});
