import { projectDoc, seedProject } from "../harness.mjs";

/**
 * The five modules with a declared face, drawn as the engine laid them out, beside one that left
 * its face to the interface; and a cable dropped on a knob landing in the socket at its foot.
 */
const PATCH = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [
    { id: "sine", type: "osc.sine", x: 48, y: 48 },
    { id: "saw", type: "osc.sawtooth", x: 48, y: 192 },
    { id: "pulse", type: "osc.pulse", x: 48, y: 336 },
    { id: "lfo", type: "mod.lfo", x: 312, y: 336 },
    { id: "out", type: "io.audioOut", x: 312, y: 48 },
    { id: "filter", type: "filter.multi", x: 312, y: 168 },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "sine", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

/** The rows the engine declared for a module, as the catalogue carries them. */
const declared = (catalog, type) =>
  catalog.modules.find((m) => m.id === type)?.face ?? null;

export default {
  name: "faces",
  description:
    "declared faces drawn block by block, a composed face for a module without one, and a cable dropped on a knob",
  seed(ws) {
    seedProject(
      ws,
      "faces",
      projectDoc({ id: "faces", name: "Faces", patch: PATCH }),
    );
  },
  async run({
    evaluate,
    pg,
    idle,
    dragTo,
    checkEventually,
    screenshot,
    check,
  }) {
    await evaluate(`click("button", "Faces");`);
    await idle();
    // Framed, so every module is on screen for the pointer to reach.
    await evaluate(
      `document.querySelector('button[aria-label="Zoom to fit"]').click();`,
    );
    await idle();

    const catalog = await pg("engine.call('catalog.get', {})");

    // ── Every declared face is drawn as declared ────────────────────────────
    for (const [id, type] of [
      ["sine", "osc.sine"],
      ["saw", "osc.sawtooth"],
      ["pulse", "osc.pulse"],
      ["lfo", "mod.lfo"],
      ["out", "io.audioOut"],
    ]) {
      const rows = declared(catalog, type);
      check(
        `${type} declares a face`,
        Array.isArray(rows),
        JSON.stringify(rows),
      );
      const blocks = await pg(`grid.face(${JSON.stringify(id)})`);
      const named = new Set(rows.flat().filter((t) => t !== "."));
      check(
        `${type} is drawn with its title first and one block per name on its face`,
        blocks !== null &&
          blocks[0]?.kind === "title" &&
          blocks.length === named.size + 1 &&
          blocks.slice(1).every((b) => named.has(b.name)),
        JSON.stringify(blocks?.map((b) => `${b.kind}:${b.name}`)),
      );
      const node = await pg(`grid.node(${JSON.stringify(id)})`);
      check(
        `${type}'s blocks all sit inside it`,
        blocks.every(
          (b) =>
            b.rect.x >= node.rect.x - 1 &&
            b.rect.y >= node.rect.y - 1 &&
            b.rect.x + b.rect.width <= node.rect.x + node.rect.width + 1 &&
            b.rect.y + b.rect.height <= node.rect.y + node.rect.height + 1,
        ),
        JSON.stringify({ node: node.rect, blocks: blocks.map((b) => b.rect) }),
      );
    }

    // The sine's face, in detail: the wave is a block, the knob carries the modulation socket, the
    // jacks in the outer columns sit on the module's borders.
    const sine = await pg('grid.face("sine")');
    const sineNode = await pg('grid.node("sine")');
    const wave = sine.find((b) => b.kind === "wave");
    const fold = sine.find((b) => b.name === "fold");
    const reset = sine.find((b) => b.name === "reset");
    const out = sine.find((b) => b.name === "out");
    check(
      "the sine has a wave block",
      wave !== undefined && wave.socket === undefined,
      JSON.stringify(wave),
    );
    check(
      "the knob carries the socket for its modulation port, facing down",
      fold?.socket?.port === "param:fold" && fold.socket.facing === "down",
      JSON.stringify(fold),
    );
    const inside = (b) =>
      b !== undefined &&
      b.socket.x > b.rect.x &&
      b.socket.x < b.rect.x + b.rect.width &&
      b.socket.y > b.rect.y &&
      b.socket.y < b.rect.y + b.rect.height;
    check(
      "a jack in the left column keeps its socket inside its tile, facing left",
      inside(reset) && reset.socket.facing === "left",
      JSON.stringify({ reset, node: sineNode.rect }),
    );
    check(
      "and one in the right column faces right",
      inside(out) && out.socket.facing === "right",
      JSON.stringify({ out, node: sineNode.rect }),
    );

    // ── A module with no declared face still has one ─────────────────────────
    check(
      "the filter declares no face",
      declared(catalog, "filter.multi") === null,
    );
    const filter = await pg('grid.face("filter")');
    check(
      "and is composed one: every port a jack, its primary params knobs",
      filter !== null &&
        filter.filter((b) => b.kind === "jack").length ===
          catalog.modules
            .find((m) => m.id === "filter.multi")
            .inputs.filter((p) => !p.implicit).length +
            catalog.modules.find((m) => m.id === "filter.multi").outputs
              .length &&
        filter.some((b) => b.kind === "knob" && b.name === "cutoff"),
      JSON.stringify(filter?.map((b) => `${b.kind}:${b.name}`)),
    );
    await screenshot("faces");

    // ── A cable dropped on a knob lands in the socket at its foot ────────────
    const lfoOut = await pg('grid.port("lfo", "out")');
    const knob = await pg('grid.knob("sine", "fold")');
    check(
      "the LFO's output and the sine's knob are on screen",
      lfoOut !== null && knob !== null,
    );
    await dragTo({ x: lfoOut.x, y: lfoOut.y }, { x: knob.x, y: knob.y }, 8);
    await checkEventually(
      "dropping a cable on the knob connects it to the knob's modulation port",
      `window.pg.snapshot().patch.edges.some((e) => e.from.module === "lfo" && e.to.module === "sine" && e.to.port === "param:fold")`,
    );
    await idle();
    await screenshot("faces-modulated");
  },
};
