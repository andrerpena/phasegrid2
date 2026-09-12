/**
 * A Chrome DevTools Protocol client small enough to read in one sitting.
 *
 * Node's own `WebSocket` against the page target of an Electron window started with
 * `--remote-debugging-port`. No Playwright: the application is driven with the protocol Chromium
 * exposes anyway, which means there is no second browser automation layer whose bugs look like
 * ours.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page target's debugger URL, once the window exists. Null after `attempts` polls. */
export async function findPage(port, attempts = 60, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl,
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(delayMs);
  }
  return null;
}

/**
 * Connects to a page target. `onConsole` receives the page's own console output and exceptions:
 * a driver that cannot see an exception in the renderer reports the symptom and hides the cause.
 */
export async function connect(url, { onConsole = () => {} } = {}) {
  const socket = new WebSocket(url);
  await new Promise((ok, bad) => {
    socket.addEventListener("open", ok, { once: true });
    socket.addEventListener("error", bad, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled")
      onConsole(
        message.params.type,
        message.params.args
          .map((a) => a.value ?? a.description ?? a.type)
          .join(" "),
      );
    if (message.method === "Runtime.exceptionThrown")
      onConsole(
        "error",
        message.params.exceptionDetails?.exception?.description ??
          JSON.stringify(message.params.exceptionDetails),
      );
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });

  const send = (method, params) => {
    const id = nextId++;
    return new Promise((ok) => {
      pending.set(id, ok);
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  /**
   * Runs `source` as the body of an async function in the page and returns what it returned, by
   * value. A throw in the page becomes a throw here, with the page's message.
   */
  const evaluate = async (source, prelude = "") => {
    const reply = await send("Runtime.evaluate", {
      expression: `(async () => { ${prelude} ${source} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = reply.result?.exceptionDetails;
    if (details)
      throw new Error(
        `evaluate threw: ${details.exception?.description ?? JSON.stringify(details)}`,
      );
    return reply.result?.result?.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");

  return {
    send,
    evaluate,
    close: () => {
      try {
        socket.close();
      } catch {}
    },
  };
}
