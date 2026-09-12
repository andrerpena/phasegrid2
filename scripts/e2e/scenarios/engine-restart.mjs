import { engineProcessId, until } from "../harness.mjs";

/**
 * The engine is killed outright, and the application puts itself back together.
 *
 * The supervisor's restart, back-off and give-up logic is the reason `src/main/engine/supervisor.ts`
 * exists, and until now it had only ever run against a fake: the unit tests inject a process handle
 * they control, and `engine.shutdown` over the protocol is a *clean* exit the supervisor
 * deliberately does not restart. So nothing had ever recovered from a real dead engine.
 *
 * A crash is not just a process coming back. Everything downstream has to notice: the renderer
 * re-runs the handshake, reloads the catalogue, resends the whole patch -- a fresh engine has our
 * revision number and none of our content -- and resubscribes its telemetry. This drives the lot
 * and then asks the engine to render, which is the only answer that proves the patch really is
 * there and not merely reported as there.
 */
export default {
  name: "engine-restart",
  description:
    "SIGKILL the engine; the supervisor brings it back and the patch is resent and audible again",
  async run({ pg, evaluate, idle, waitFor, check, expectErrors, screenshot }) {
    // A call that lands during the outage is refused, and the refusal is reported. That is the
    // point of the scenario rather than a fault in it; anything else it reports still fails.
    expectErrors(/is not running/, /connection closed/, /E_IO/);

    await idle();
    await pg('commands.run("project.new")');
    await pg('patch.addModule("osc.sawtooth", { id: "osc", x: 48, y: 48 })');
    await pg('patch.addModule("io.audioOut", { id: "out", x: 384, y: 72 })');
    await pg(
      'patch.connect({ module: "osc", port: "out" }, { module: "out", port: "inL" })',
    );
    await idle();

    const before = await pg("engine.render({ seconds: 0.25 })");
    check(
      "the patch is audible before the crash",
      before.rms[0] > 0.05,
      JSON.stringify(before),
    );
    const revisionBefore = (await pg("snapshot()")).engine.revision;

    // ── The kill ─────────────────────────────────────────────────────────────
    const shm = await pg("stores.engine.getState().shm.name");
    const pid = engineProcessId(shm);
    check(
      "the engine process was found by its segment",
      pid !== null,
      String(shm),
    );
    if (pid === null) throw new Error(`no engine process writing ${shm}`);

    process.kill(pid, "SIGKILL");
    await until(() => engineProcessId(shm) !== pid, {
      label: "the engine process goes away",
    });

    // Trap 4, for real: every pending call is rejected when the connection drops. A promise that can
    // never settle is worse than an error, because the interface waits on it forever with nothing to
    // show. Asserted as "it settles", not "it fails", because the supervisor may already have
    // reconnected by now -- either answer is correct, and hanging is the bug.
    const settled = await evaluate(`
      return await Promise.race([
        window.pg.engine
          .call("engine.ping", {})
          .then(() => "answered", (e) => "refused: " + (e.message ?? String(e))),
        new Promise((r) => setTimeout(() => r("never settled"), 8000)),
      ]);`);
    check(
      "a call made while the engine is gone settles rather than hanging",
      settled !== "never settled",
      settled,
    );

    // ── The recovery ─────────────────────────────────────────────────────────
    // `engine.connected` carries `restarted`, which is the supervisor saying this is a different
    // process from the one that was there. Nothing else in the log distinguishes a restart.
    await waitFor(
      `window.pg.log.tail(40).some((e) => /restarted engine/.test(e.message))`,
      {
        timeoutMs: 30000,
        label: "the supervisor reconnects to a restarted engine",
      },
    );
    check(
      "and says the old one died",
      (await pg("log.tail(40)")).some((e) => /exited with/.test(e.message)),
      JSON.stringify((await pg("log.tail(6)")).map((e) => e.message)),
    );
    check("a new engine process is running", engineProcessId(shm) !== null);

    // The strong one: the engine that came back is playing our patch. A fresh engine starts empty,
    // so this is false unless the whole document was actually resent to it.
    const after = await until(
      async () => {
        const rendered = await pg("engine.render({ seconds: 0.25 })").catch(
          () => null,
        );
        return rendered !== null && rendered.rms[0] > 0.05 ? rendered : null;
      },
      { timeoutMs: 30000, label: "the restarted engine plays the patch again" },
    );
    check(
      "the patch was resent and is audible again",
      after.rms[0] > 0.05,
      JSON.stringify(after),
    );
    check(
      "and it is a fresh engine, counting its revisions from the start",
      (await pg("snapshot()")).engine.revision < revisionBefore,
      `${revisionBefore} -> ${(await pg("snapshot()")).engine.revision}`,
    );

    // The interface came through it: the catalogue reloaded and the canvas still draws the patch.
    const snap = await pg("snapshot()");
    check(
      "the catalogue is loaded again",
      snap.catalog.status === "ready" && snap.catalog.count > 20,
      JSON.stringify(snap.catalog),
    );
    check(
      "the canvas still draws the patch",
      (await pg("grid.nodes()")).length === 2,
    );
    await screenshot("engine-restart");
  },
};
