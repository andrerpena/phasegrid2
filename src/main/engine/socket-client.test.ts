import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../../shared/protocol/envelope";
import { EngineError, EngineSocketClient } from "./socket-client";

/**
 * These run against a real Unix domain socket, deliberately: the framing bug this client guards against
 * (trap 2) only exists because a real socket chunks wherever it likes. A mocked stream would deliver one
 * tidy message per callback and the test would pass with the bug still in place.
 *
 * Nothing here sleeps and nothing waits on a promise that the test itself cannot settle, so a client that
 * misbehaves fails the assertion rather than hanging the suite.
 */

interface Harness {
  path: string;
  /** Every client connection the server accepted, so a test can write to one or destroy it. */
  connections: Socket[];
  /** Resolves with the next line the server receives. */
  nextLine(): Promise<string>;
}

const servers: Server[] = [];
const clients: EngineSocketClient[] = [];
const directories: string[] = [];

/**
 * A server that collects the lines it is sent. `onLine` is where a test decides what to answer -- writing
 * a response, writing half of one, writing nothing at all.
 */
function startServer(
  onLine?: (line: string, socket: Socket) => void,
): Promise<Harness> {
  // The socket lives under the system temporary directory, which is short: `sun_path` runs out at 104
  // bytes and a test that cannot bind would look like a client bug.
  const dir = mkdtempSync(join(tmpdir(), "pg-sock-"));
  directories.push(dir);
  const path = join(dir, "e.sock");

  const connections: Socket[] = [];
  const received: string[] = [];
  const waiting: ((line: string) => void)[] = [];

  const server = createServer((socket) => {
    connections.push(socket);
    socket.setEncoding("utf8");
    let carry = "";
    socket.on("data", (chunk: string) => {
      carry += chunk;
      for (;;) {
        const nl = carry.indexOf("\n");
        if (nl < 0) break;
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        const next = waiting.shift();
        if (next) next(line);
        else received.push(line);
        onLine?.(line, socket);
      }
    });
    socket.on("error", () => {}); // a client that vanishes mid-write is the point of some of these tests
  });
  servers.push(server);

  return new Promise<Harness>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      resolve({
        path,
        connections,
        nextLine: () =>
          new Promise<string>((settle) => {
            const buffered = received.shift();
            if (buffered !== undefined) settle(buffered);
            else waiting.push(settle);
          }),
      });
    });
  });
}

async function connectedClient(path: string): Promise<EngineSocketClient> {
  const client = new EngineSocketClient(path);
  clients.push(client);
  await client.connect();
  return client;
}

/**
 * A call whose answer this test does not care about. It still has to be caught: a call the test leaves
 * outstanding is rejected when `afterEach` closes the client, and an unhandled rejection there would fail
 * a different test than the one that made it.
 */
function ignore(call: Promise<unknown>): void {
  call.catch(() => {});
}

/** The id the client put on its request, so a test can answer the call it actually made. */
function idOf(line: string): number {
  return (JSON.parse(line) as { id: number }).id;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("engine socket client", () => {
  it("carries a call to the engine and its result back", async () => {
    const harness = await startServer((line, socket) => {
      socket.write(
        `${JSON.stringify({ id: idOf(line), ok: true, result: { pong: true, revision: 7 } })}\n`,
      );
    });
    const client = await connectedClient(harness.path);

    await expect(client.call("engine.ping", {})).resolves.toEqual({
      pong: true,
      revision: 7,
    });
  });

  it("sends `{id, cmd, args}` and nothing else", async () => {
    const harness = await startServer();
    const client = await connectedClient(harness.path);

    ignore(
      client.call("param.set", { module: "vca", param: "gain", value: 0.5 }),
    );
    expect(JSON.parse(await harness.nextLine())).toEqual({
      id: 1,
      cmd: "param.set",
      args: { module: "vca", param: "gain", value: 0.5 },
    });
  });

  it("reassembles a response split across two writes (trap 2)", async () => {
    const harness = await startServer((line, socket) => {
      const whole = `${JSON.stringify({ id: idOf(line), ok: true, result: { pong: true, revision: 3 } })}\n`;
      // Split mid-token, inside the word `revision`, which is exactly where a naive reader loses it.
      const cut = whole.indexOf("revision") + 4;
      socket.write(whole.slice(0, cut));
      setTimeout(() => socket.write(whole.slice(cut)), 5);
    });
    const client = await connectedClient(harness.path);

    await expect(client.call("engine.ping", {})).resolves.toEqual({
      pong: true,
      revision: 3,
    });
  });

  it("answers two calls delivered in a single write (trap 2)", async () => {
    const seen: number[] = [];
    const harness = await startServer((line, socket) => {
      seen.push(idOf(line));
      if (seen.length < 2) return;
      // Both answers, and an event, in one packet: the reader must find all three newlines.
      socket.write(
        seen
          .map(
            (id) =>
              `${JSON.stringify({ id, ok: true, result: { pong: true, revision: id } })}\n`,
          )
          .join("") +
          `${JSON.stringify({ event: "patch.revision", seq: 1, data: { revision: 9 } })}\n`,
      );
    });
    const client = await connectedClient(harness.path);
    const events: EventEnvelope[] = [];
    client.onEvent((event) => events.push(event));

    const both = await Promise.all([
      client.call("engine.ping", {}),
      client.call("engine.ping", {}),
    ]);
    expect(both.map((r) => r.revision)).toEqual([1, 2]);
    expect(events).toEqual([
      { event: "patch.revision", seq: 1, data: { revision: 9 } },
    ]);
  });

  it("rejects every pending call when the connection drops (trap 4)", async () => {
    // The server takes the calls and never answers: the only thing that can settle these promises is the
    // close, which is the whole point.
    const harness = await startServer((_line, socket) => {
      if (harness.connections.length > 0) socket.write("");
    });
    const client = await connectedClient(harness.path);

    const first = client.call("engine.ping", {});
    const second = client.call("catalog.get", {});
    await harness.nextLine();
    await harness.nextLine();
    for (const socket of harness.connections) socket.destroy();

    await expect(first).rejects.toThrow(/engine.ping/);
    await expect(second).rejects.toBeInstanceOf(EngineError);
    await expect(second).rejects.toMatchObject({ code: "E_IO" });
    expect(client.connected).toBe(false);
  });

  it("rejects pending calls when the client itself is closed", async () => {
    const harness = await startServer();
    const client = await connectedClient(harness.path);

    const call = client.call("engine.ping", {});
    await harness.nextLine();
    client.close();

    await expect(call).rejects.toMatchObject({ code: "E_IO" });
  });

  it("fails a call made while disconnected instead of queueing it", async () => {
    const client = new EngineSocketClient("/tmp/pg-not-listening.sock");
    clients.push(client);

    await expect(client.call("engine.ping", {})).rejects.toMatchObject({
      code: "E_IO",
      message: expect.stringContaining("not connected"),
    });
  });

  it("rejects a connect to a socket nobody is listening on", async () => {
    const client = new EngineSocketClient(
      join(tmpdir(), "pg-absent-engine.sock"),
    );
    clients.push(client);

    await expect(client.connect()).rejects.toMatchObject({ code: "E_IO" });
    expect(client.connected).toBe(false);
  });

  it("rejects with the engine's own error code", async () => {
    const harness = await startServer((line, socket) => {
      socket.write(
        `${JSON.stringify({
          id: idOf(line),
          ok: false,
          error: {
            code: "E_UNKNOWN_TYPE",
            message: "no such module: osc.nope",
          },
        })}\n`,
      );
    });
    const client = await connectedClient(harness.path);

    await expect(
      client.call("module.add", { id: "a", type: "osc.nope" }),
    ).rejects.toMatchObject({
      code: "E_UNKNOWN_TYPE",
      message: "no such module: osc.nope",
    });
  });

  it("rejects a result that does not match the command table", async () => {
    const harness = await startServer((line, socket) => {
      // `revision` is meant to be a number. A client that passed this through would put a string where
      // the interface expects to do arithmetic.
      socket.write(
        `${JSON.stringify({ id: idOf(line), ok: true, result: { revision: "seven" } })}\n`,
      );
    });
    const client = await connectedClient(harness.path);

    await expect(
      client.call("module.add", { id: "a", type: "amp.vca" }),
    ).rejects.toMatchObject({ code: "E_SCHEMA" });
  });

  it("keeps unknown keys out of the way rather than rejecting them", async () => {
    const harness = await startServer((line, socket) => {
      socket.write(
        `${JSON.stringify({
          id: idOf(line),
          ok: true,
          result: { revision: 2, somethingNewer: true },
          alsoNewer: 1,
        })}\n`,
      );
    });
    const client = await connectedClient(harness.path);

    await expect(client.call("module.remove", { id: "a" })).resolves.toEqual({
      revision: 2,
    });
  });

  it("delivers events to listeners until they unsubscribe", async () => {
    const harness = await startServer((_line, socket) => {
      socket.write(
        `${JSON.stringify({ event: "engine.log", seq: 1, data: { level: "info", message: "one" } })}\n`,
      );
    });
    const client = await connectedClient(harness.path);
    const seen: string[] = [];
    const unsubscribe = client.onEvent((event) => seen.push(event.event));

    ignore(client.call("engine.ping", {}));
    await harness.nextLine();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(["engine.log"]);

    unsubscribe();
    ignore(client.call("engine.ping", {}));
    await harness.nextLine();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual(["engine.log"]);
  });

  it("reports a line it cannot parse instead of throwing on the socket", async () => {
    const harness = await startServer((_line, socket) => {
      socket.write("this is not json\n");
    });
    const client = await connectedClient(harness.path);
    const seen: EventEnvelope[] = [];
    client.onEvent((event) => seen.push(event));

    ignore(client.call("engine.ping", {}));
    await harness.nextLine();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.event).toBe("engine.error");
    expect(seen[0]?.seq).toBe(0); // zero marks an event the connection invented; the engine counts from 1
    expect(client.connected).toBe(true); // and the connection survives it
  });
});
