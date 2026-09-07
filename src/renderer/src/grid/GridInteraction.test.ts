import type { ModuleDescriptor } from "@shared/protocol/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GridInteraction } from "./GridInteraction";
import type { GridRenderer } from "./GridRenderer";
import { CELL, measureNode } from "./layout";
import { descriptor } from "./stories/fixtures";

/**
 * The interaction controller against a fake renderer.
 *
 * Everything it needs from the renderer is small and stateless enough to stand in for, which is the
 * point: driving this through a real canvas would be slow, flaky and would test the browser more than
 * the logic.
 */

interface FakeNode {
  view: {
    position: { x: number; y: number; set: (x: number, y: number) => void };
  };
  layout: ReturnType<typeof measureNode>;
  descriptor: ModuleDescriptor;
  valueFor: (id: string) => number;
  setParamValue: (id: string, value: number) => void;
  setPosition: (x: number, y: number) => void;
}

function fakeNode(type: string, x: number, y: number): FakeNode {
  const desc = descriptor(type);
  const position = {
    x,
    y,
    set(nx: number, ny: number) {
      position.x = nx;
      position.y = ny;
    },
  };
  return {
    view: { position },
    layout: measureNode(desc),
    descriptor: desc,
    valueFor: (id) => desc.params.find((p) => p.id === id)?.default ?? 0,
    setParamValue: () => {},
    setPosition: (nx, ny) => position.set(nx, ny),
  };
}

function rig(nodes: Map<string, FakeNode>) {
  const selection: string[][] = [];
  const renderer = {
    viewport: {
      // Identity: patch coordinates are screen coordinates here, so the numbers in a test say what
      // they mean rather than being pre-multiplied by a zoom.
      toWorld: (p: { x: number; y: number }) => p,
      toScreen: (p: { x: number; y: number }) => p,
      panBy: vi.fn(),
      zoomAt: vi.fn(),
    },
    nodeAt: (point: { x: number; y: number }) => {
      for (const [id, node] of nodes) {
        const o = node.view.position;
        if (
          point.x >= o.x &&
          point.x <= o.x + node.layout.width &&
          point.y >= o.y &&
          point.y <= o.y + node.layout.height
        )
          return { id, node };
      }
      return null;
    },
    allNodes: () => nodes,
    setSelection: (ids: Set<string>) => selection.push([...ids]),
    drawOverlay: vi.fn(),
    drawBackground: vi.fn(),
    refreshCables: vi.fn(),
  } as unknown as GridRenderer;

  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
    }),
  } as unknown as HTMLCanvasElement;

  return { renderer, canvas, selection };
}

const pointer = (x: number, y: number, extra: Partial<PointerEvent> = {}) =>
  ({
    clientX: x,
    clientY: y,
    button: 0,
    shiftKey: false,
    ...extra,
  }) as PointerEvent;

let nodes: Map<string, FakeNode>;

beforeEach(() => {
  nodes = new Map([
    ["vca", fakeNode("amp.vca", 240, 120)],
    ["env", fakeNode("env.dahdsr", 480, 120)],
  ]);
});

/** Reaches the private handlers the way the attached listeners would. */
function driver(interaction: GridInteraction) {
  const i = interaction as unknown as {
    onDown: (e: PointerEvent) => void;
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
  };
  return {
    down: (x: number, y: number, extra?: Partial<PointerEvent>) =>
      i.onDown(pointer(x, y, extra)),
    move: (x: number, y: number, extra?: Partial<PointerEvent>) =>
      i.onMove(pointer(x, y, extra)),
    up: (x: number, y: number) => i.onUp(pointer(x, y)),
  };
}

describe("dragging a module", () => {
  it("reports the move once, on release, snapped to the grid", () => {
    // One gesture is one edit. Reporting every frame would flood the engine and leave a hundred undo
    // entries for something a person did once.
    const onNodesMoved = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(new GridInteraction(renderer, canvas, { onNodesMoved }));

    d.down(250, 130);
    d.move(300, 190);
    expect(onNodesMoved).not.toHaveBeenCalled();
    d.up(300, 190);

    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    const [moves] = onNodesMoved.mock.calls[0] as [
      { id: string; x: number; y: number }[],
    ];
    expect(moves[0].id).toBe("vca");
    expect(moves[0].x % CELL).toBe(0);
    expect(moves[0].y % CELL).toBe(0);
  });

  it("does not report a click that never moved", () => {
    const onNodesMoved = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(new GridInteraction(renderer, canvas, { onNodesMoved }));
    d.down(250, 130);
    d.move(251, 131);
    d.up(251, 131);
    expect(onNodesMoved).not.toHaveBeenCalled();
  });

  it("moves the node on the canvas while the drag is in progress", () => {
    const { renderer, canvas } = rig(nodes);
    const d = driver(new GridInteraction(renderer, canvas, {}));
    d.down(250, 130);
    d.move(350, 130);
    // Moved immediately, so the module follows the pointer rather than jumping on release.
    expect(nodes.get("vca")?.view.position.x).toBeGreaterThan(240);
  });

  it("selects what it grabs", () => {
    const { renderer, canvas, selection } = rig(nodes);
    const d = driver(new GridInteraction(renderer, canvas, {}));
    d.down(250, 130);
    expect(selection.at(-1)).toEqual(["vca"]);
  });
});

describe("dragging a knob", () => {
  /** The centre of a node's first knob, in patch coordinates. */
  function knobAt(id: string) {
    const node = nodes.get(id);
    if (node === undefined) throw new Error(id);
    const control = node.layout.controls[0];
    return {
      x: node.view.position.x + control.x,
      y: node.view.position.y + control.y,
    };
  }

  it("reports every intermediate value, and marks only the release as final", () => {
    // The sound has to follow the knob, so each step is reported; the undo entry belongs to the
    // gesture, so only the release says it is done.
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(new GridInteraction(renderer, canvas, { onParamChange }));
    const knob = knobAt("env");

    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 40);
    d.move(knob.x, knob.y - 80);
    d.up(knob.x, knob.y - 80);

    const calls = onParamChange.mock.calls as [
      string,
      string,
      number,
      boolean,
    ][];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.slice(0, -1).every((c) => c[3] === false)).toBe(true);
    expect(calls.at(-1)?.[3]).toBe(true);
    expect(calls[0][0]).toBe("env");
  });

  it("increases when dragged upward", () => {
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(new GridInteraction(renderer, canvas, { onParamChange }));
    const knob = knobAt("env");
    const start =
      nodes
        .get("env")
        ?.valueFor(nodes.get("env")?.layout.controls[0].param.id ?? "") ?? 0;

    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 60);
    const [, , value] = onParamChange.mock.calls.at(-1) as [
      string,
      string,
      number,
      boolean,
    ];
    expect(value).toBeGreaterThan(start);
  });

  it("moves less far with the fine modifier held", () => {
    const coarse = vi.fn();
    const fine = vi.fn();
    for (const [onParamChange, shift] of [
      [coarse, false],
      [fine, true],
    ] as const) {
      nodes = new Map([["env", fakeNode("env.dahdsr", 480, 120)]]);
      const { renderer, canvas } = rig(nodes);
      const d = driver(
        new GridInteraction(renderer, canvas, { onParamChange }),
      );
      const knob = knobAt("env");
      d.down(knob.x, knob.y);
      d.move(knob.x, knob.y - 60, { shiftKey: shift });
    }
    const coarseValue = (
      coarse.mock.calls.at(-1) as [string, string, number, boolean]
    )[2];
    const fineValue = (
      fine.mock.calls.at(-1) as [string, string, number, boolean]
    )[2];
    expect(fineValue).toBeLessThan(coarseValue);
  });

  it("grabs the knob rather than the module under it", () => {
    // Otherwise every attempt to turn a control drags the module instead, which is the single most
    // annoying thing a patching interface can do.
    const onParamChange = vi.fn();
    const onNodesMoved = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onParamChange, onNodesMoved }),
    );
    const knob = knobAt("env");
    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 50);
    d.up(knob.x, knob.y - 50);
    expect(onParamChange).toHaveBeenCalled();
    expect(onNodesMoved).not.toHaveBeenCalled();
  });
});

describe("selecting with a marquee", () => {
  it("selects what the rectangle touches", () => {
    const onSelectionChanged = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onSelectionChanged }),
    );
    d.down(10, 10);
    d.move(600, 400);
    d.up(600, 400);
    const last = onSelectionChanged.mock.calls.at(-1) as [string[]];
    expect(last[0].sort()).toEqual(["env", "vca"]);
  });

  it("clears the selection when the empty canvas is clicked", () => {
    const onSelectionChanged = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onSelectionChanged }),
    );
    d.down(250, 130);
    d.down(10, 600);
    expect((onSelectionChanged.mock.calls.at(-1) as [string[]])[0]).toEqual([]);
  });

  it("adds to the selection when the modifier is held", () => {
    const onSelectionChanged = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onSelectionChanged }),
    );
    d.down(250, 130);
    d.down(490, 130, { shiftKey: true });
    expect(
      (onSelectionChanged.mock.calls.at(-1) as [string[]])[0].sort(),
    ).toEqual(["env", "vca"]);
  });
});

describe("an example project, where only the parameters may change", () => {
  it("refuses to move a module", () => {
    // An example demonstrates a module. Letting someone rearrange one invites them to start working
    // in a project that has nowhere to save to, which is the trap this avoids.
    const onNodesMoved = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(
        renderer,
        canvas,
        { onNodesMoved },
        { parametersOnly: true },
      ),
    );
    d.down(250, 130);
    d.move(400, 300);
    d.up(400, 300);
    expect(onNodesMoved).not.toHaveBeenCalled();
    expect(nodes.get("vca")?.view.position.x).toBe(240);
  });

  it("still lets a knob be turned", () => {
    // Changing values is the entire point of a demonstration; only the wiring is withheld.
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(
        renderer,
        canvas,
        { onParamChange },
        { parametersOnly: true },
      ),
    );
    const node = nodes.get("env");
    if (node === undefined) throw new Error("env");
    const control = node.layout.controls[0];
    const knob = {
      x: node.view.position.x + control.x,
      y: node.view.position.y + control.y,
    };
    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 50);
    d.up(knob.x, knob.y - 50);
    expect(onParamChange).toHaveBeenCalled();
  });

  it("still lets a module be selected, so the inspector can show it", () => {
    const onSelectionChanged = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(
        renderer,
        canvas,
        { onSelectionChanged },
        { parametersOnly: true },
      ),
    );
    d.down(250, 130);
    expect((onSelectionChanged.mock.calls.at(-1) as [string[]])[0]).toEqual([
      "vca",
    ]);
  });

  it("does not start a marquee on the empty canvas", () => {
    const onSelectionChanged = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(
        renderer,
        canvas,
        { onSelectionChanged },
        { parametersOnly: true },
      ),
    );
    d.down(10, 600);
    d.move(600, 700);
    d.up(600, 700);
    // The click still clears the selection; it just does not sweep a rectangle.
    expect((onSelectionChanged.mock.calls.at(-1) as [string[]])[0]).toEqual([]);
  });
});
