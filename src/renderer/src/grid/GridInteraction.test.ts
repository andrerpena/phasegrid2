import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PortRef } from "@shared/protocol/patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeFace, hitKnob, hitSocket, socketOf } from "./face";
import { descriptor } from "./fixtures";
import { GridInteraction } from "./GridInteraction";
import type { GridRenderer } from "./GridRenderer";
import { CELL } from "./layout";

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
  face: ReturnType<typeof composeFace>;
  descriptor: ModuleDescriptor;
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
    face: composeFace(desc),
    descriptor: desc,
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
          point.x <= o.x + node.face.width &&
          point.y >= o.y &&
          point.y <= o.y + node.face.height
        )
          return { id, node };
      }
      return null;
    },
    allNodes: () => nodes,
    // The socket under a point, the way the real renderer finds it: by the same hit test, across
    // every node, border sockets included.
    portAt: (
      point: { x: number; y: number },
      options: { knobs?: boolean } = {},
    ) => {
      for (const [id, node] of nodes) {
        const socket =
          hitSocket(point, node.view.position, node.face) ??
          (options.knobs === true
            ? (hitKnob(point, node.view.position, node.face)?.socket ?? null)
            : null);
        if (socket !== null)
          return {
            module: id,
            socket,
            x: node.view.position.x + socket.x,
            y: node.view.position.y + socket.y,
          };
      }
      return null;
    },
    portPosition: (
      moduleId: string,
      portId: string,
      side: "input" | "output",
    ) => {
      const node = nodes.get(moduleId);
      const socket =
        node === undefined ? null : socketOf(node.face, portId, side);
      if (node === undefined || socket === null) return null;
      return {
        x: node.view.position.x + socket.x,
        y: node.view.position.y + socket.y,
        facing: socket.facing,
      };
    },
    portColor: () => 0,
    setSelection: (ids: Set<string>) => selection.push([...ids]),
    drawOverlay: vi.fn(),
    drawBackground: vi.fn(),
    refreshCables: vi.fn(),
    drawSelection: vi.fn(),
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
  documentValues.clear();
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

/**
 * The values the interaction is told the document holds. Written by a test, read through `readParam`,
 * exactly as `GridView` reads the real store: the interaction never asks the drawing what a value is.
 */
const documentValues = new Map<string, number>();
const readParam = (module: string, param: string): number =>
  documentValues.get(`${module}.${param}`) ??
  nodes.get(module)?.descriptor.params.find((p) => p.id === param)?.default ??
  0;
const setDocumentValue = (
  module: string,
  param: string,
  value: number,
): void => {
  documentValues.set(`${module}.${param}`, value);
};

interface ParamChange {
  module: string;
  param: string;
  value: number;
  done: boolean;
  previous: number;
}
const changes = (fn: ReturnType<typeof vi.fn>): ParamChange[] =>
  fn.mock.calls.map((c) => c[0] as ParamChange);

describe("dragging a knob", () => {
  /** The centre of a node's first knob, in patch coordinates. */
  function knobAt(id: string) {
    const node = nodes.get(id);
    if (node === undefined) throw new Error(id);
    const knob = node.face.knobs[0];
    return {
      x: node.view.position.x + knob.centre.x,
      y: node.view.position.y + knob.centre.y,
    };
  }

  it("reports every intermediate value, and marks only the release as final", () => {
    // The sound has to follow the knob, so each step is reported; the undo entry belongs to the
    // gesture, so only the release says it is done.
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onParamChange, readParam }),
    );
    const knob = knobAt("env");

    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 40);
    d.move(knob.x, knob.y - 80);
    d.up(knob.x, knob.y - 80);

    const calls = changes(onParamChange);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.slice(0, -1).every((c) => c.done === false)).toBe(true);
    expect(calls.at(-1)?.done).toBe(true);
    expect(calls[0].module).toBe("env");
  });

  it("starts from where the parameter is now, not where it was first drawn", () => {
    // The document is the only place a value lives, so a gesture has to begin from what it says. A
    // node that kept a copy from when it was built started every drag from that copy instead, which
    // made a knob jump back to its opening value the moment it was touched a second time.
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const node = nodes.get("env");
    if (node === undefined) throw new Error("env");
    const param = node.face.knobs[0].param;
    const moved = param.min + (param.max - param.min) * 0.8;
    setDocumentValue("env", param.id, moved);

    const d = driver(
      new GridInteraction(renderer, canvas, { onParamChange, readParam }),
    );
    const knob = knobAt("env");
    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 1); // the smallest move there is: the value must barely leave where it was

    const first = changes(onParamChange)[0];
    expect(first.value).toBeCloseTo(moved, 1);
    expect(first.previous).toBeCloseTo(moved, 5);
  });

  it("reports what the parameter was before the gesture, for undo to step back to", () => {
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const node = nodes.get("env");
    if (node === undefined) throw new Error("env");
    const param = node.face.knobs[0].param;
    setDocumentValue("env", param.id, param.min);

    const d = driver(
      new GridInteraction(renderer, canvas, { onParamChange, readParam }),
    );
    const knob = knobAt("env");
    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 60);
    d.up(knob.x, knob.y - 60);

    const last = changes(onParamChange).at(-1);
    expect(last?.done).toBe(true);
    expect(last?.previous).toBeCloseTo(param.min, 5);
    expect(last?.value).toBeGreaterThan(param.min);
  });

  it("increases when dragged upward", () => {
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onParamChange, readParam }),
    );
    const knob = knobAt("env");
    const start = readParam(
      "env",
      nodes.get("env")?.face.knobs[0].param.id ?? "",
    );

    d.down(knob.x, knob.y);
    d.move(knob.x, knob.y - 60);
    expect(changes(onParamChange).at(-1)?.value).toBeGreaterThan(start);
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
        new GridInteraction(renderer, canvas, { onParamChange, readParam }),
      );
      const knob = knobAt("env");
      d.down(knob.x, knob.y);
      d.move(knob.x, knob.y - 60, { shiftKey: shift });
    }
    const coarseValue = changes(coarse).at(-1)?.value ?? 0;
    const fineValue = changes(fine).at(-1)?.value ?? 0;
    expect(fineValue).toBeLessThan(coarseValue);
  });

  it("puts a knob back to its default when it is double-clicked", () => {
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const interaction = new GridInteraction(renderer, canvas, {
      onParamChange,
      readParam,
    });
    const node = nodes.get("env");
    if (node === undefined) throw new Error("env");
    const param = node.face.knobs[0].param;
    setDocumentValue("env", param.id, param.max);
    const knob = knobAt("env");
    (
      interaction as unknown as { onDoubleClick: (e: MouseEvent) => void }
    ).onDoubleClick(pointer(knob.x, knob.y) as unknown as MouseEvent);

    const change = changes(onParamChange).at(-1);
    expect(change?.value).toBe(param.default);
    expect(change?.previous).toBe(param.max);
    // Finished, because it is: one edit, one step back, nothing still under a hand.
    expect(change?.done).toBe(true);
  });

  it("has nothing to record when the knob is already at its default", () => {
    const onParamChange = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const interaction = new GridInteraction(renderer, canvas, {
      onParamChange,
      readParam,
    });
    const knob = knobAt("env");
    (
      interaction as unknown as { onDoubleClick: (e: MouseEvent) => void }
    ).onDoubleClick(pointer(knob.x, knob.y) as unknown as MouseEvent);
    expect(onParamChange).not.toHaveBeenCalled();
  });

  it("grabs the knob rather than the module under it", () => {
    // Otherwise every attempt to turn a control drags the module instead, which is the single most
    // annoying thing a patching interface can do.
    const onParamChange = vi.fn();
    const onNodesMoved = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, {
        onParamChange,
        readParam,
        onNodesMoved,
      }),
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

describe("patching a cable", () => {
  /** A socket's centre in patch coordinates. */
  function socket(id: string, portId: string, side: "input" | "output") {
    const node = nodes.get(id);
    if (node === undefined) throw new Error(id);
    const found = socketOf(node.face, portId, side);
    if (found === null) throw new Error(`${id}.${portId}`);
    return {
      x: node.view.position.x + found.x,
      y: node.view.position.y + found.y,
    };
  }

  /** What the document says is plugged into each input, for the interaction to ask. */
  let edges: { id: string; from: PortRef; to: PortRef }[] = [];
  const readEdgesInto = (module: string, port: string) =>
    edges
      .filter((e) => e.to.module === module && e.to.port === port)
      .map((e) => ({ id: e.id, from: e.from }));

  beforeEach(() => {
    edges = [];
  });

  it("connects an output dragged onto an input", () => {
    const onConnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onConnect, readEdgesInto }),
    );
    const out = socket("env", "out", "output");
    const gain = socket("vca", "gain", "input");
    d.down(out.x, out.y);
    d.move(gain.x - 40, gain.y + 20);
    expect(onConnect).not.toHaveBeenCalled();
    d.up(gain.x, gain.y);
    expect(onConnect).toHaveBeenCalledWith(
      { module: "env", port: "out" },
      { module: "vca", port: "gain" },
      {},
    );
  });

  it("orients the edge the right way when drawn from the input end", () => {
    const onConnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onConnect, readEdgesInto }),
    );
    const out = socket("env", "out", "output");
    const gain = socket("vca", "gain", "input");
    d.down(gain.x, gain.y);
    d.up(out.x, out.y);
    expect(onConnect).toHaveBeenCalledWith(
      { module: "env", port: "out" },
      { module: "vca", port: "gain" },
      {},
    );
  });

  it("plugs into the socket under a knob, which is the knob's modulation input", () => {
    const onConnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onConnect, readEdgesInto }),
    );
    const out = socket("env", "out", "output");
    const under = socket("vca", "param:gain", "input");
    d.down(out.x, out.y);
    d.up(under.x, under.y + 2); // a hair below the border: the socket sits on it
    expect(onConnect).toHaveBeenCalledWith(
      { module: "env", port: "out" },
      { module: "vca", port: "param:gain" },
      {},
    );
  });

  it("also takes a cable dropped on the knob itself", () => {
    // The socket is small; the knob is the thing you are aiming at. Dropping on it means the same.
    const onConnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onConnect, readEdgesInto }),
    );
    const out = socket("env", "out", "output");
    const node = nodes.get("vca");
    if (node === undefined) throw new Error("vca");
    const knob = node.face.knobs[0];
    d.down(out.x, out.y);
    d.up(
      node.view.position.x + knob.centre.x,
      node.view.position.y + knob.centre.y,
    );
    expect(onConnect).toHaveBeenCalledWith(
      { module: "env", port: "out" },
      { module: "vca", port: "param:gain" },
      {},
    );
  });

  it("connects nothing when the cable is dropped on empty canvas", () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, {
        onConnect,
        onDisconnect,
        readEdgesInto,
      }),
    );
    const out = socket("env", "out", "output");
    d.down(out.x, out.y);
    d.up(30, 700);
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("pulls a cable off a connected input and drops it on nothing to remove it", () => {
    edges = [
      {
        id: "e1",
        from: { module: "env", port: "out" },
        to: { module: "vca", port: "gain" },
      },
    ];
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, {
        onConnect,
        onDisconnect,
        readEdgesInto,
      }),
    );
    const gain = socket("vca", "gain", "input");
    d.down(gain.x, gain.y);
    d.up(30, 700);
    expect(onDisconnect).toHaveBeenCalledWith("e1");
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("re-routes a picked-up cable onto another input as one edit", () => {
    edges = [
      {
        id: "e1",
        from: { module: "env", port: "out" },
        to: { module: "vca", port: "gain" },
      },
    ];
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, {
        onConnect,
        onDisconnect,
        readEdgesInto,
      }),
    );
    const gain = socket("vca", "gain", "input");
    const input = socket("vca", "in", "input");
    d.down(gain.x, gain.y);
    d.up(input.x, input.y);
    expect(onConnect).toHaveBeenCalledWith(
      { module: "env", port: "out" },
      { module: "vca", port: "in" },
      { replaces: "e1" },
    );
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("changes nothing when a picked-up cable is dropped back where it was", () => {
    edges = [
      {
        id: "e1",
        from: { module: "env", port: "out" },
        to: { module: "vca", port: "gain" },
      },
    ];
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, {
        onConnect,
        onDisconnect,
        readEdgesInto,
      }),
    );
    const gain = socket("vca", "gain", "input");
    d.down(gain.x, gain.y);
    d.up(gain.x + 1, gain.y);
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("refuses a cable that already exists", () => {
    edges = [
      {
        id: "e1",
        from: { module: "env", port: "out" },
        to: { module: "vca", port: "gain" },
      },
    ];
    const onConnect = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onConnect, readEdgesInto }),
    );
    const out = socket("env", "out", "output");
    const gain = socket("vca", "gain", "input");
    d.down(out.x, out.y);
    d.up(gain.x, gain.y);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("does not move the module a socket belongs to", () => {
    const onNodesMoved = vi.fn();
    const { renderer, canvas } = rig(nodes);
    const d = driver(
      new GridInteraction(renderer, canvas, { onNodesMoved, readEdgesInto }),
    );
    const out = socket("env", "out", "output");
    d.down(out.x, out.y);
    d.move(out.x + 100, out.y + 100);
    d.up(out.x + 100, out.y + 100);
    expect(onNodesMoved).not.toHaveBeenCalled();
    expect(nodes.get("env")?.view.position.x).toBe(480);
  });
});
