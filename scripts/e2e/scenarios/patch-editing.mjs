import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectDoc, seedProject } from "../harness.mjs";

const WIRING = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [
    { id: "osc", type: "osc.wavetable", x: 48, y: 48, params: { level: 0.7 } },
    { id: "out", type: "io.audioOut", x: 384, y: 72, params: { gain: 0.5 } },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "osc", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

/**
 * Editing a saved patch through the canvas, and taking it apart again.
 *
 * Every wait here names what it is waiting for. The gestures are real -- a pointer pressed, moved
 * and released -- and the pauses inside those live in `dragTo`, where they belong: a drag is not
 * waiting for anything, it is a hand moving over time.
 */
export default {
  name: "patch-editing",
  description:
    "open a patch, inspect, select, delete, undo, minimap, pan and zoom, and the canvas following its panel",
  seed(ws) {
    seedProject(
      ws,
      "wiring",
      projectDoc({ id: "wiring", name: "Wiring", patch: WIRING }),
    );
  },
  async run({
    workspace: ws,
    evaluate,
    pg,
    idle,
    waitFor,
    checkEventually,
    clickAt,
    dragTo,
    screenshot,
    check,
  }) {
    await evaluate(`click("button", "Wiring");`);
    await idle();
    const opened = await evaluate(
      `return [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.includes("Wiring") && t.getAttribute("aria-selected") === "true");`,
    );
    check("a saved patch opens", opened === true);

    const box = await pg("grid.canvas()");
    check("the grid has a canvas", box !== null, JSON.stringify(box));
    if (box === null) throw new Error("no canvas to drag on");
    await screenshot("grid");

    // ── The inspector: a form built from the engine's own descriptors ────────
    // The module is found by name and clicked on its title bar, wherever the view has put it.
    await evaluate(`click('[role="tab"]', "Inspector");`);
    await waitFor(
      `document.querySelector('[data-widget="inspector"]') !== null`,
      { label: "the inspector panel is in front" },
    );
    const osc = await pg('grid.node("osc")');
    check("the oscillator is on the canvas", osc !== null, JSON.stringify(osc));
    await clickAt(osc.title.x, osc.title.y);
    await idle();
    check(
      "clicking it selects it",
      (await pg("snapshot().selection")).join() === "osc",
    );
    const inspector = await evaluate(`
      const panel = document.querySelector('[data-widget="inspector"]');
      if (!panel) return null;
      return {
        labels: [...panel.querySelectorAll("label")].map((l) => l.textContent.trim()),
        inputs: panel.querySelectorAll("input").length,
      };`);
    check(
      "selecting a module fills the inspector from its descriptor",
      inspector !== null && inspector.inputs > 2,
      JSON.stringify(inspector),
    );
    check(
      "and its fields are the engine's own parameter names",
      inspector?.labels.includes("Level") === true,
      JSON.stringify(inspector?.labels?.slice(0, 12)),
    );
    await screenshot("inspector");

    // A marquee across the whole surface, from empty canvas above and left of everything.
    await dragTo(
      { x: box.x + 20, y: box.y + 20 },
      { x: box.x + box.width - 20, y: box.y + box.height - 20 },
    );
    await checkEventually(
      "a marquee selects everything it covers",
      "window.pg.snapshot().selection.length === 2",
    );
    check(
      "clicking the grid gives it focus",
      (await evaluate(
        `return document.activeElement?.closest("[data-kb-scope]")?.dataset.kbScope ?? "(none)";`,
      )) === "grid",
    );

    await evaluate(`press("Delete");`);
    await checkEventually(
      "deleting empties the patch",
      "window.pg.snapshot().patch.modules.length === 0",
    );
    await checkEventually(
      "and marks the project unsaved",
      "window.pg.snapshot().projects.open[0].dirty === true",
    );

    const file = join(ws, "projects", "wiring", "project.json");
    const saved = () =>
      waitFor("window.pg.snapshot().projects.open[0].dirty === false", {
        label: "the project is saved",
      });
    await evaluate(`press("s", { metaKey: true });`);
    await saved();
    const afterDelete = JSON.parse(readFileSync(file, "utf8"));
    check(
      "the modules are gone from the file too",
      afterDelete.patch.modules.length === 0,
      JSON.stringify(afterDelete.patch.modules),
    );
    check(
      "and so is the cable between them",
      afterDelete.patch.edges.length === 0,
      JSON.stringify(afterDelete.patch.edges),
    );

    await evaluate(`press("z", { metaKey: true });`);
    await checkEventually(
      "undo brings the modules back",
      "window.pg.snapshot().patch.modules.length === 2",
    );
    await evaluate(`press("s", { metaKey: true });`);
    await saved();
    const afterUndo = JSON.parse(readFileSync(file, "utf8"));
    check(
      "and the file has them under the ids they had",
      afterUndo.patch.modules
        .map((m) => m.id)
        .sort()
        .join(",") === "osc,out",
      JSON.stringify(afterUndo.patch.modules.map((m) => m.id)),
    );
    check(
      "undo brings the cable back too",
      afterUndo.patch.edges.length === 1,
      JSON.stringify(afterUndo.patch.edges),
    );

    // ── The minimap, which is the patch painted a pixel per cell ──────────────
    const map = await evaluate(`
      const canvas = document.querySelector('[data-testid="mini-map"] canvas');
      if (!canvas) return null;
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const ground = [pixels[0], pixels[1], pixels[2]].join(",");
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ([pixels[i], pixels[i + 1], pixels[i + 2]].join(",") !== ground) painted++;
      }
      const marker = document.querySelector('[data-testid="mini-map"] div');
      return { width: canvas.width, height: canvas.height, painted, marker: marker?.style.display };`);
    check(
      "the minimap sized itself to the patch",
      map !== null && map.width > 4 && map.height > 4,
      JSON.stringify(map),
    );
    check(
      "and painted the modules and cables into it",
      map !== null && map.painted > 10,
      JSON.stringify(map),
    );
    check(
      "the viewport rectangle is drawn",
      map?.marker === "block",
      JSON.stringify(map),
    );

    // ── Panning and zooming ──────────────────────────────────────────────────
    const zoomText = () =>
      evaluate(
        `return document.querySelector('output[aria-label="Zoom"]')?.textContent ?? "";`,
      );
    check("the zoom control reads out the zoom", (await zoomText()) === "100%");

    // A trackpad two-finger scroll: small pixel deltas, no modifier. This must pan, not zoom --
    // binding it to zoom is what made the canvas lurch instead of moving. The wait is for the view
    // to have MOVED; whether it zoomed is then asked of the viewport rather than of the readout,
    // which is polled five times a second by design and would answer about a moment ago.
    const beforePan = await pg("grid.viewport()");
    await evaluate(`
      const canvas = document.querySelector('[data-kb-scope="grid"] canvas');
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaY: 30, deltaMode: 0, bubbles: true, cancelable: true }));`);
    await waitFor(`window.pg.grid.viewport().x !== ${beforePan.x}`, {
      label: "a two-finger scroll moves the view",
    });
    check(
      "a two-finger scroll pans rather than zooming",
      (await pg("grid.viewport()")).zoom === 1,
      JSON.stringify(await pg("grid.viewport()")),
    );

    // And a wheel click zooms. Waited for on the readout, which is the slower of the two and the
    // one a person actually reads.
    await evaluate(`
      const canvas = document.querySelector('[data-kb-scope="grid"] canvas');
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, deltaMode: 0, bubbles: true, cancelable: true }));`);
    await checkEventually(
      "a wheel click zooms in, and the readout follows",
      `document.querySelector('output[aria-label="Zoom"]').textContent !== "100%"`,
    );
    check(
      "and the viewport zoomed with it",
      (await pg("grid.viewport()")).zoom !== 1,
    );

    // Zoom to fit recentres the view on the patch. That it frames it *exactly* is checked in
    // `viewport.test.ts`, where the arithmetic can be asserted rather than inferred.
    const markerLeft = `document.querySelector('[data-testid="mini-map"] div').style.left`;
    const framedBefore = await evaluate(`return ${markerLeft};`);
    await evaluate(
      `document.querySelector('button[aria-label="Zoom to fit"]').click();`,
    );
    await checkEventually(
      "zoom to fit recentres the view on the patch",
      `${markerLeft} !== ${JSON.stringify(framedBefore)}`,
    );

    // ── The canvas following its panel ───────────────────────────────────────
    // Pixi's own `resizeTo` follows the window and nothing else, so a dock drag used to leave the
    // canvas at whatever size the window last made it. Only a real drag of a real divider catches
    // that -- the unit tests cover when a size is applied, not whether anything told Pixi at all.
    const handle = await evaluate(`
      const inspector = document.querySelector('[data-widget="inspector"]');
      const host = document.querySelector('[data-kb-scope="grid"]');
      const grip = [...document.querySelectorAll('[data-component="ResizeHandle"]')].find((h) => h.parentElement.contains(inspector));
      if (!grip || !host) return null;
      const r = grip.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, height: host.clientHeight };`);
    check("the centre column has a divider to drag", handle !== null);
    if (handle === null) throw new Error("no divider above the inspector");

    // Downwards, which shrinks the bottom panel and gives the room to the grid -- the direction
    // that exposes a canvas too small for its box.
    await dragTo(
      { x: handle.x, y: handle.y },
      { x: handle.x, y: handle.y + 100 },
      5,
    );
    await checkEventually(
      "dragging the divider gives the room to the grid",
      `document.querySelector('[data-kb-scope="grid"]').clientHeight > ${handle.height + 40}`,
    );
    const resized = await evaluate(`
      const host = document.querySelector('[data-kb-scope="grid"]');
      const canvas = host?.querySelector("canvas");
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      return { host: { width: host.clientWidth, height: host.clientHeight }, canvas: { width: r.width, height: r.height } };`);
    check(
      "and the canvas grows with it, filling its panel",
      resized !== null &&
        Math.abs(resized.canvas.height - resized.host.height) <= 1 &&
        Math.abs(resized.canvas.width - resized.host.width) <= 1,
      JSON.stringify(resized),
    );
    await screenshot("dock-resize");
  },
};
