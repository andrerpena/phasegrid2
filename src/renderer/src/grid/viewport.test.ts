import type { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, Viewport } from "./viewport";

/** Just enough of a container to record what the viewport does to it. */
function fakeWorld() {
  const state = { x: 0, y: 0, scale: 1 };
  return {
    container: {
      position: {
        set: (x: number, y: number) => {
          state.x = x;
          state.y = y;
        },
      },
      scale: {
        set: (s: number) => {
          state.scale = s;
        },
      },
    } as unknown as Container,
    state,
  };
}

describe("the viewport", () => {
  it("applies the transform when the zoom is set directly", () => {
    // This was a real bug. `zoom` was a plain field, so assigning it changed every calculation that
    // read it while never touching the container: the background redrew at the new zoom and the patch
    // stayed exactly where it was.
    const { container, state } = fakeWorld();
    const viewport = new Viewport(container);
    viewport.zoom = 2;
    expect(state.scale).toBe(2);
  });

  it("applies the transform when the position is set directly", () => {
    const { container, state } = fakeWorld();
    const viewport = new Viewport(container);
    viewport.x = 30;
    viewport.y = -10;
    expect(state).toMatchObject({ x: 30, y: -10 });
  });

  it("keeps the patch under the pointer while zooming", () => {
    // Zooming about the origin is what makes a canvas feel broken: what you were looking at slides
    // away exactly as you try to look at it more closely.
    const { container } = fakeWorld();
    const viewport = new Viewport(container);
    const pointer = { x: 400, y: 300 };
    const before = viewport.toWorld(pointer);
    viewport.zoomAt(pointer, 2);
    const after = viewport.toWorld(pointer);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("clamps the zoom at both ends", () => {
    const { container } = fakeWorld();
    const viewport = new Viewport(container);
    viewport.zoom = 1000;
    expect(viewport.zoom).toBe(MAX_ZOOM);
    viewport.zoom = 0.0001;
    expect(viewport.zoom).toBe(MIN_ZOOM);
  });

  it("round-trips a point between screen and patch coordinates", () => {
    // Every hit test happens in patch coordinates and every event arrives in screen ones, so this
    // conversion is what everything else on the canvas depends on.
    const { container } = fakeWorld();
    const viewport = new Viewport(container);
    viewport.zoomAt({ x: 100, y: 100 }, 1.7);
    viewport.panBy(37, -19);
    const screen = { x: 512, y: 288 };
    const back = viewport.toScreen(viewport.toWorld(screen));
    expect(back.x).toBeCloseTo(screen.x, 6);
    expect(back.y).toBeCloseTo(screen.y, 6);
  });

  it("frames a rectangle with room around it", () => {
    const { container } = fakeWorld();
    const viewport = new Viewport(container);
    viewport.fit(
      { x: 0, y: 0, width: 400, height: 200 },
      { width: 800, height: 600 },
    );
    const topLeft = viewport.toScreen({ x: 0, y: 0 });
    const bottomRight = viewport.toScreen({ x: 400, y: 200 });
    expect(topLeft.x).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(800);
  });

  it("ignores a request to frame nothing", () => {
    const { container } = fakeWorld();
    const viewport = new Viewport(container);
    viewport.fit(
      { x: 0, y: 0, width: 0, height: 0 },
      { width: 800, height: 600 },
    );
    expect(viewport.zoom).toBe(1);
  });
});
