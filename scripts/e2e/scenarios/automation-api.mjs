import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * `window.pg`, the automation API, doing the things a script needs from it: reading the state,
 * running commands, editing the patch by name, finding things on the canvas, and waiting for the
 * engine rather than sleeping.
 */
export default {
  name: "automation-api",
  description:
    "pg.snapshot, commands, patch edits, grid geometry, idle, and the log",
  async run({ workspace: ws, pg, idle, clickAt, dragTo, check }) {
    await idle();
    const first = await pg("snapshot()");
    check(
      "the snapshot says which workspace is open",
      first.workspace.root === ws,
      JSON.stringify(first.workspace),
    );
    check(
      "and that the engine is ready",
      first.engine.status === "ready",
      JSON.stringify(first.engine),
    );
    check(
      "and lists the catalogue",
      first.catalog.status === "ready" && first.catalog.count > 20,
      JSON.stringify(first.catalog),
    );
    check(
      "and the log has the engine's ready line",
      first.log.some((e) => e.message.includes("ready")),
      JSON.stringify(first.log.slice(-3)),
    );
    check("help lists what there is", (await pg("help()")).length > 5);

    const commands = await pg("commands.list()");
    check(
      "commands are listed by id",
      commands.some((c) => c.id === "project.new") &&
        commands.some((c) => c.id === "transport.toggle"),
      JSON.stringify(commands.slice(0, 5)),
    );

    await pg('commands.run("project.new")');
    await idle();
    let snap = await pg("snapshot()");
    check(
      "a command opens a project",
      snap.projects.open.length === 1 && snap.projects.activeId !== null,
      JSON.stringify(snap.projects),
    );

    // ── Editing by name, by the same path the catalogue takes ──
    const osc = await pg(
      'patch.addModule("osc.sine", { id: "osc", x: 48, y: 48 })',
    );
    const out = await pg(
      'patch.addModule("io.audioOut", { id: "out", x: 384, y: 48 })',
    );
    await pg(
      `patch.connect({ module: "osc", port: "out" }, { module: "out", port: "inL" })`,
    );
    await pg('patch.setParam("osc", "fold", 6)');
    await idle();
    snap = await pg("snapshot()");
    check(
      "modules were added with the ids asked for",
      osc === "osc" &&
        out === "out" &&
        snap.patch.modules
          .map((m) => m.id)
          .sort()
          .join() === "osc,out",
      JSON.stringify(snap.patch.modules),
    );
    check(
      "and cabled",
      snap.patch.edges.length === 1,
      JSON.stringify(snap.patch.edges),
    );
    check(
      "and the parameter was set",
      snap.patch.modules.find((m) => m.id === "osc")?.params?.fold === 6,
      JSON.stringify(snap.patch.modules),
    );
    check(
      "every edit is in the history",
      snap.history.past.length === 4,
      JSON.stringify(snap.history),
    );
    check("and the project is dirty", snap.projects.open[0].dirty === true);
    // The engine has the same patch: idle waited for the queue, so the revision has moved.
    const revision = snap.engine.revision;
    check("the engine committed the edits", revision >= 3, String(revision));

    // ── Geometry: a real mouse aimed by name ──
    const node = await pg('grid.node("osc")');
    const knob = await pg('grid.knob("osc", "fold")');
    const port = await pg('grid.port("osc", "out")');
    const canvas = await pg("grid.canvas()");
    check(
      "the canvas has a box",
      canvas !== null && canvas.width > 100,
      JSON.stringify(canvas),
    );
    check(
      "a node has a rect inside the canvas",
      node !== null && node.rect.x >= canvas.x && node.rect.y >= canvas.y,
      JSON.stringify(node),
    );
    check(
      "a knob is inside its node",
      knob !== null &&
        knob.x > node.rect.x &&
        knob.x < node.rect.x + node.rect.width,
      JSON.stringify(knob),
    );
    check(
      "an output sits on the node's right edge",
      port !== null &&
        Math.abs(port.x - (node.rect.x + node.rect.width)) < 2 &&
        port.side === "output",
      JSON.stringify(port),
    );

    await clickAt(node.title.x, node.title.y);
    await idle();
    check(
      "clicking the title selects the module",
      (await pg("snapshot().selection")).join() === "osc",
    );

    // Dragging the knob upward raises the value: the document changes, by the same path a hand takes.
    const before = (await pg("snapshot()")).patch.modules.find(
      (m) => m.id === "osc",
    ).params.fold;
    await dragTo({ x: knob.x, y: knob.y }, { x: knob.x, y: knob.y - 40 });
    await idle();
    const after = (await pg("snapshot()")).patch.modules.find(
      (m) => m.id === "osc",
    ).params.fold;
    check(
      "dragging a knob found by name changes the parameter",
      after > before,
      `${before} -> ${after}`,
    );

    // ── Transport by command ──
    await pg('commands.run("transport.toggle")');
    await idle();
    check(
      "the transport plays by command",
      (await pg("snapshot().transport.playing")) === true,
    );
    await pg('commands.run("transport.stop")');
    await idle();
    check("and stops", (await pg("snapshot().transport.playing")) === false);

    // ── Saving by name ──
    check(
      "save as writes the file",
      (await pg('workspace.saveAs("Scripted")')) === true,
    );
    check(
      "where the workspace keeps it",
      existsSync(join(ws, "projects", "scripted", "project.json")),
    );
    snap = await pg("snapshot()");
    check(
      "and the project is clean and listed",
      snap.projects.open[0].dirty === false &&
        snap.workspace.projects.some((p) => p.slug === "scripted"),
      JSON.stringify(snap.workspace.projects),
    );

    // ── Undo by command, and the engine follows ──
    await pg('commands.run("edit.undo")');
    await idle();
    snap = await pg("snapshot()");
    check(
      "undo steps back one edit",
      snap.history.future.length === 1 && snap.projects.open[0].dirty === true,
    );

    // ── An example opens ──
    await pg('workspace.openExample("mod.lfo")');
    await idle();
    snap = await pg("snapshot()");
    check(
      "an example opens as a second tab",
      snap.projects.open.length === 2 &&
        snap.projects.open[1].kind === "example",
      JSON.stringify(snap.projects.open),
    );
    check(
      "with its patch on the canvas",
      (await pg("grid.nodes()")).length === 3,
    );
  },
};
