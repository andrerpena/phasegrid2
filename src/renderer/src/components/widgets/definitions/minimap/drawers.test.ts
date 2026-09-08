import { DEMO_PATCH, DESCRIPTORS } from "@renderer/grid/fixtures";
import { CELL } from "@renderer/grid/layout";
import { patchBounds } from "@renderer/grid/patch-bounds";
import { hexToRgb } from "@renderer/lib/color";
import { dark } from "@renderer/theming/themes";
import { describe, expect, it } from "vitest";
import { cablesDrawer } from "./cables-drawer";
import { modulesDrawer } from "./modules-drawer";
import { registerBuiltInMinimapDrawers } from "./register-drawers";
import { minimapDrawerRegistry } from "./registry";
import { type MinimapBuffer, type MinimapPaintContext, setCell } from "./types";

const colors = dark.grid;
const catalog = DESCRIPTORS;
const bounds = patchBounds(DEMO_PATCH, catalog);

/** A buffer with nothing browser-shaped about it -- see `MinimapBuffer`. */
function blank(width: number, height: number): MinimapBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** A buffer, and a way to ask what colour a patch cell came out. */
function surface() {
  const buffer = blank(bounds.width, bounds.height);
  const context: MinimapPaintContext = {
    paint: (x, y, r, g, b) => setCell(buffer, bounds, x, y, r, g, b),
    doc: DEMO_PATCH,
    catalog,
    colors,
    bounds,
  };
  const at = (cellX: number, cellY: number) => {
    const x = cellX - bounds.originX;
    const y = cellY - bounds.originY;
    const i = (y * buffer.width + x) * 4;
    return {
      r: buffer.data[i],
      g: buffer.data[i + 1],
      b: buffer.data[i + 2],
      a: buffer.data[i + 3],
    };
  };
  return { buffer, context, at };
}

describe("painting the modules", () => {
  it("fills a module's whole footprint", () => {
    const { context, at } = surface();
    modulesDrawer.draw(context);
    // `osc` sits at (336, 24) in patch units, which is cell (14, 1).
    expect(at(14, 1).a).toBe(255);
    expect(at(15, 2).a).toBe(255);
  });

  it("leaves the gaps between modules alone", () => {
    const { context, at } = surface();
    modulesDrawer.draw(context);
    // Well outside every module, inside the padding.
    expect(at(bounds.originX, bounds.originY).a).toBe(0);
  });

  it("colours a module by the role of what it puts out", () => {
    const { context, at } = surface();
    modulesDrawer.draw(context);
    // `osc.wavetable` outputs audio, so it is the audio colour rather than a generic fill.
    const audio = hexToRgb(colors.signal.audio);
    const painted = at(14, 1);
    expect({ r: painted.r, g: painted.g, b: painted.b }).toEqual(audio);
  });

  it("repaints only when the module list changes", () => {
    expect(modulesDrawer.layer).toBe("static");
    expect(modulesDrawer.staticKey?.(DEMO_PATCH)).toBe(DEMO_PATCH.modules);
  });
});

describe("painting the cables", () => {
  it("draws something between the modules a cable joins", () => {
    const { context, at } = surface();
    cablesDrawer.draw(context);
    // The osc → filter cable runs from cell ~(16,3) to ~(28,3); a point between them is coloured.
    let painted = 0;
    for (let x = bounds.originX; x < bounds.originX + bounds.width; x++)
      for (let y = bounds.originY; y < bounds.originY + bounds.height; y++)
        if (at(x, y).a === 255) painted++;
    expect(painted).toBeGreaterThan(20);
  });

  it("watches the edges, not the modules", () => {
    expect(cablesDrawer.layer).toBe("static");
    expect(cablesDrawer.staticKey?.(DEMO_PATCH)).toBe(DEMO_PATCH.edges);
  });

  it("survives an edge naming a module that is not there", () => {
    const { buffer } = surface();
    const orphaned = {
      ...DEMO_PATCH,
      edges: [
        {
          id: "gone",
          from: { module: "nonesuch", port: "out" },
          to: { module: "out", port: "in" },
        },
      ],
    };
    expect(() =>
      cablesDrawer.draw({
        paint: (x, y, r, g, b) => setCell(buffer, bounds, x, y, r, g, b),
        doc: orphaned,
        catalog,
        colors,
        bounds,
      }),
    ).not.toThrow();
  });
});

describe("writing outside the buffer", () => {
  it("is dropped rather than corrupting the row above", () => {
    // The buffer is a window onto an unbounded plane, so a drawer painting a cell that is off the
    // edge is ordinary. Without the bounds check the index wraps onto the previous row.
    const buffer = blank(4, 4);
    setCell(
      buffer,
      { originX: 0, originY: 0, width: 4, height: 4 },
      -1,
      2,
      255,
      0,
      0,
    );
    expect([...buffer.data].every((v) => v === 0)).toBe(true);
    setCell(
      buffer,
      { originX: 0, originY: 0, width: 4, height: 4 },
      9,
      1,
      255,
      0,
      0,
    );
    expect([...buffer.data].every((v) => v === 0)).toBe(true);
  });
});

describe("the registry", () => {
  it("paints cables under modules, so a connection reads as plugged in", () => {
    minimapDrawerRegistry.clear();
    registerBuiltInMinimapDrawers();
    expect(minimapDrawerRegistry.all().map((d) => d.id)).toEqual([
      "cables",
      "modules",
    ]);
  });
});

describe("the demo patch", () => {
  it("is wide enough to be worth mapping", () => {
    // A guard on the fixture rather than on the code: several tests above assume the patch spans
    // more than a few cells, and would pass vacuously on an empty one.
    expect(DEMO_PATCH.modules.length).toBeGreaterThan(4);
    expect(bounds.width).toBeGreaterThan(CELL);
  });
});
