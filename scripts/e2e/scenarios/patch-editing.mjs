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

/** Editing a saved patch through the canvas, and taking it apart again. */
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
    text,
    pg,
    idle,
    mouse,
    clickAt,
    screenshot,
    sleep,
    check,
  }) {
    await evaluate(`click("button", "Wiring");`);
    await idle();
    const opened = await evaluate(
      `return [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.includes("Wiring") && t.getAttribute("aria-selected") === "true");`,
    );
    check("a saved patch opens", opened === true);

    const box = await evaluate(`
      const el = document.querySelector('[data-kb-scope="grid"] canvas');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };`);
    check("the grid has a canvas", box !== null, JSON.stringify(box));
    if (box === null) throw new Error("no canvas to drag on");
    await screenshot("grid");

    // ── The inspector: a form built from the engine's own descriptors ────────
    // The module is found by name and clicked on its title bar, wherever the view has put it.
    await evaluate(`click('[role="tab"]', "Inspector");`);
    await sleep(300);
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

    // A marquee across the whole surface.
    await mouse("mousePressed", box.x + 20, box.y + 20);
    await sleep(80);
    for (let i = 1; i <= 6; i++) {
      await mouse(
        "mouseMoved",
        box.x + 20 + ((box.w - 40) * i) / 6,
        box.y + 20 + ((box.h - 40) * i) / 6,
      );
      await sleep(40);
    }
    await mouse("mouseReleased", box.x + box.w - 20, box.y + box.h - 20);
    await sleep(300);
    check(
      "clicking the grid gives it focus",
      (await evaluate(
        `return document.activeElement?.closest("[data-kb-scope]")?.dataset.kbScope ?? "(none)";`,
      )) === "grid",
    );

    await evaluate(`press("Delete");`);
    await sleep(300);
    check("deleting marks the project unsaved", (await text()).includes("•"));

    await evaluate(`press("s", { metaKey: true });`);
    await sleep(700);
    const file = join(ws, "projects", "wiring", "project.json");
    const afterDelete = JSON.parse(readFileSync(file, "utf8"));
    check(
      "the modules are gone",
      afterDelete.patch.modules.length === 0,
      JSON.stringify(afterDelete.patch.modules),
    );
    check(
      "and so is the cable between them",
      afterDelete.patch.edges.length === 0,
      JSON.stringify(afterDelete.patch.edges),
    );

    await evaluate(`press("z", { metaKey: true });`);
    await sleep(400);
    await evaluate(`press("s", { metaKey: true });`);
    await sleep(700);
    const afterUndo = JSON.parse(readFileSync(file, "utf8"));
    check(
      "undo brings the modules back",
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
    await evaluate(`
      const canvas = document.querySelector('[data-kb-scope="grid"] canvas');
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaY: 30, deltaMode: 0, bubbles: true, cancelable: true }));`);
    await sleep(300);
    check(
      "a two-finger scroll pans rather than zooming",
      (await zoomText()) === "100%",
      await zoomText(),
    );
    await evaluate(`
      const canvas = document.querySelector('[data-kb-scope="grid"] canvas');
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, deltaMode: 0, bubbles: true, cancelable: true }));`);
    await sleep(300);
    const zoomedIn = await zoomText();
    check("a wheel click zooms in", zoomedIn !== "100%", zoomedIn);
    const framed = await evaluate(
      `const marker = document.querySelector('[data-testid="mini-map"] div');
       const before = marker.style.left;
       document.querySelector('button[aria-label="Zoom to fit"]').click();
       await new Promise(r => setTimeout(r, 400));
       return { before, after: marker.style.left };`,
    );
    await sleep(300);
    check(
      "zoom to fit recentres the view on the patch",
      framed.before !== framed.after,
      JSON.stringify(framed),
    );

    // ── The canvas following its panel ───────────────────────────────────────
    const handle = await evaluate(`
      const inspector = document.querySelector('[data-widget="inspector"]');
      const host = document.querySelector('[data-kb-scope="grid"]');
      const grip = [...document.querySelectorAll('[data-component="ResizeHandle"]')].find((h) => h.parentElement.contains(inspector));
      if (!grip || !host) return null;
      const r = grip.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, height: host.clientHeight };`);
    check("the centre column has a divider to drag", handle !== null);
    if (handle === null) throw new Error("no divider above the inspector");
    await mouse("mousePressed", handle.x, handle.y);
    await sleep(80);
    for (let i = 1; i <= 5; i++) {
      await mouse("mouseMoved", handle.x, handle.y + i * 20);
      await sleep(40);
    }
    await mouse("mouseReleased", handle.x, handle.y + 100);
    await sleep(400);
    const resized = await evaluate(`
      const host = document.querySelector('[data-kb-scope="grid"]');
      const canvas = host?.querySelector("canvas");
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      return { host: { width: host.clientWidth, height: host.clientHeight }, canvas: { width: r.width, height: r.height } };`);
    check(
      "dragging the divider gives the room to the grid",
      resized !== null && resized.host.height > handle.height + 40,
      JSON.stringify({ was: handle.height, now: resized?.host.height }),
    );
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
